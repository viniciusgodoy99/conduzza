-- Saúde do motor de automação.
--
-- CONTEXTO QUE ESTA MIGRATION RESOLVE: pg_cron nao existe neste projeto. Tudo
-- que e ativo (planejar_reguas, limpar_holds_vencidos, envio de toque, download
-- de midia, "Cobrar agora") depende de UM processo Node, o `npm run worker`.
-- Se ele nao esta de pe, a Tela 2 fica IDENTICA a uma clinica saudavel: a regua
-- aparece "ligada", as consultas aparecem "pendentes" (que tambem e o estado
-- normal de um toque que ainda nao venceu) e "Cobrar agora" responde
-- "cobranca na fila" com sucesso. O produto vira vitrine em silencio, e a
-- clinica so descobre quando o paciente falta.
--
-- Duas partes:
--   1. um carimbo de vida do worker, que a interface le para avisar;
--   2. o fechamento das runs orfas, que hoje ficam penduradas para sempre.

-- ---------------------------------------------------------------------------
-- 1. Carimbo de vida
-- ---------------------------------------------------------------------------
-- Tabela de UMA linha por worker. Nao tem clinic_id de proposito: o motor e do
-- produto inteiro, nao de uma clinica, e o aviso precisa aparecer para todas.
-- Por isso a leitura e liberada a qualquer usuario autenticado e nao ha
-- escrita por sessao: quem grava e o service_role.

create table if not exists public.worker_heartbeat (
  worker_id text primary key,
  batida_em timestamptz not null default now(),
  -- O que a ultima passagem fez. Serve para diferenciar "vivo e ocioso" de
  -- "vivo e trabalhando" no diagnostico.
  ultimo_lote integer not null default 0,
  criado_em timestamptz not null default now()
);

comment on table public.worker_heartbeat is
  'Prova de vida do worker de automacao (npm run worker). Sem pg_cron neste projeto, ele e o unico executor: regua, fila, midia. A interface avisa quando a batida envelhece.';

alter table public.worker_heartbeat enable row level security;

-- Leitura para qualquer pessoa logada: o aviso de motor parado precisa
-- aparecer em qualquer clinica, e a linha nao guarda dado de paciente.
drop policy if exists "logado le a saude do motor" on public.worker_heartbeat;
create policy "logado le a saude do motor"
  on public.worker_heartbeat for select
  to authenticated
  using (true);

-- Sem policy de escrita: so o service_role (o proprio worker) grava.

create or replace function public.bater_ponto_do_worker(
  p_worker_id text,
  p_ultimo_lote integer default 0
) returns void
language sql
security definer
set search_path = public
as $$
  insert into worker_heartbeat (worker_id, batida_em, ultimo_lote)
  values (p_worker_id, now(), coalesce(p_ultimo_lote, 0))
  on conflict (worker_id) do update
    set batida_em = now(),
        ultimo_lote = coalesce(excluded.ultimo_lote, 0);
$$;

revoke execute on function public.bater_ponto_do_worker(text, integer)
  from public, anon, authenticated;
grant execute on function public.bater_ponto_do_worker(text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Run orfa: job morreu, toque ficou pendurado
-- ---------------------------------------------------------------------------
-- Quando um job de regua termina em 'falhou' (esgotou tentativas ou foi
-- enterrado por lease vencido em claim_jobs), a cadence_run correspondente
-- podia ficar sem sent_at e sem skipped_reason para sempre. Nessa forma ela e
-- indistinguivel de um toque que ainda vai sair: nao aparece como problema em
-- lugar nenhum e nunca mais e tentada, porque o planner usa
-- "on conflict do nothing" e a linha ja existe.
--
-- Esta funcao fecha essas runs. O worker a chama junto do planejamento.

create or replace function public.fechar_runs_orfas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fechadas integer;
begin
  with orfas as (
    select distinct (j.payload->>'cadence_run_id')::uuid as run_id
    from job_queue j
    where j.kind = 'executar_passo_de_regua'
      and j.status = 'falhou'
      and j.payload ? 'cadence_run_id'
  )
  update cadence_run r
     set skipped_reason = 'falha_envio'
    from orfas o
   where r.id = o.run_id
     and r.sent_at is null
     and r.skipped_reason is null;
  get diagnostics v_fechadas = row_count;
  return v_fechadas;
end;
$$;

revoke execute on function public.fechar_runs_orfas() from public, anon, authenticated;
grant execute on function public.fechar_runs_orfas() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Retry mais longo para falha de canal
-- ---------------------------------------------------------------------------
-- O backoff era least(600, 15 * 2^attempts) com max_attempts 5: a janela
-- inteira de retry dava cerca de 8 minutos. O uazapi roda num servidor
-- COMPARTILHADO; uma manutencao de 20 minutos consumia as cinco tentativas e o
-- toque morria, com o canal perfeito logo depois. Oito minutos e curto demais
-- para a realidade do canal.
--
-- Com teto de 30 minutos e 8 tentativas, a janela passa de ~8 minutos para
-- ~1h45. O toque de confirmacao tem horas de folga ate a consulta, entao
-- esperar mais nunca e pior do que nao enviar.

alter table public.job_queue
  alter column max_attempts set default 8;

create or replace function public.falhar_job(
  p_id uuid,
  p_erro text,
  p_definitivo boolean,
  p_worker text
) returns void
language sql
set search_path = public
as $$
  update job_queue
  set status = case
        when p_definitivo or attempts >= max_attempts then 'falhou'
        else 'pendente'
      end,
      run_at = case
        when p_definitivo or attempts >= max_attempts then run_at
        -- Teto de 30 minutos (era 10). Ver o comentario do bloco.
        else now() + make_interval(secs => least(1800, 15 * power(2, attempts)))
      end,
      last_error = left(p_erro, 200),
      locked_by = null,
      locked_at = null
  where id = p_id and status = 'executando' and locked_by = p_worker
$$;
