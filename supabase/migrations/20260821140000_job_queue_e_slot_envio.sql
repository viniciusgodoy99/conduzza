-- Etapa B da auditoria de escala (21/08/2026): a fila de jobs que o disparo
-- de confirmacao de atendimento exige, e a reserva de slot anti-ban movida
-- para o banco.
--
-- Por que agora: o dono decidiu que o produto faz atendimento 1:1 E disparo
-- ativo (confirmacao de consulta). Disparo ativo roda num worker, que e um
-- SEGUNDO processo ao lado do servidor web; a partir dai o espacamento
-- anti-ban em memoria deixa de proteger, porque cada processo tem a sua
-- memoria. O slot compartilhado passa a viver aqui.

-- ---------------------------------------------------------------------------
-- 1. Reserva de slot de envio por numero (anti-ban compartilhado)
-- ---------------------------------------------------------------------------

alter table public.whatsapp_account
  add column next_send_at timestamptz;

comment on column public.whatsapp_account.next_send_at is
  'Proximo slot livre de envio deste numero. Reservado atomicamente por reservar_slot_envio; NUNCA enviar sem reservar.';

-- Reserva atomica: um UPDATE so (lock de linha do Postgres serializa os
-- concorrentes). Devolve o MOMENTO reservado para este envio; quem chamou
-- dorme ate la. Envio isolado recebe slot imediato (greatest com now()).
-- O espacamento e de quem chama: resposta 1:1 usa 1,5 a 4s; disparo em massa
-- usa 10 a 30s, conforme a especificacao do canal.
create or replace function public.reservar_slot_envio(
  p_clinic_id uuid,
  p_espaco_ms integer
) returns timestamptz
language sql
set search_path = public
as $$
  update whatsapp_account
  set next_send_at =
        greatest(coalesce(next_send_at, now()), now())
        + make_interval(secs => p_espaco_ms / 1000.0)
  where clinic_id = p_clinic_id
  returning next_send_at - make_interval(secs => p_espaco_ms / 1000.0)
$$;

revoke execute on function public.reservar_slot_envio(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reservar_slot_envio(uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Conversa aberta para disparo ativo
-- ---------------------------------------------------------------------------
-- O disparo de confirmacao pode alcancar um contato SEM conversa aberta.
-- Mesmo padrao do ingest: uma conversa aberta por contato, corrida resolvida
-- pelo indice unico parcial conversation_aberta_por_contato.

create or replace function public.garantir_conversa_aberta(
  p_clinic_id uuid,
  p_contact_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  insert into conversation (clinic_id, contact_id, status, last_message_at)
  values (p_clinic_id, p_contact_id, 'ia_atendendo', now())
  on conflict (clinic_id, contact_id) where status <> 'resolvida' do nothing;

  select id into v_conversation_id
  from conversation
  where clinic_id = p_clinic_id
    and contact_id = p_contact_id
    and status <> 'resolvida'
  limit 1;

  return v_conversation_id;
end;
$$;

revoke execute on function public.garantir_conversa_aberta(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.garantir_conversa_aberta(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. A fila de jobs
-- ---------------------------------------------------------------------------
-- Contrato no banco (claim atomico com FOR UPDATE SKIP LOCKED, lease com
-- expiracao, retry com backoff): o executor e intercambiavel. Hoje e um
-- worker Node no mesmo servidor 24/7 (decisao de deploy do dono); uma Edge
-- Function agendada por pg_cron pode assumir depois sem mudar nada aqui.

create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  kind text not null check (kind in ('enviar_mensagem_ativa', 'baixar_midia')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendente' check (status in
    ('pendente', 'executando', 'concluido', 'falhou', 'cancelado')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_by text,
  locked_at timestamptz,
  -- Codigo curto de erro. NUNCA conteudo de mensagem nem dado de contato:
  -- o worker so grava codigos (regra 3.1 do CLAUDE.md).
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_queue_prontos_idx
  on public.job_queue (run_at)
  where status = 'pendente';
create index job_queue_clinic_idx on public.job_queue (clinic_id);
create index job_queue_lease_idx
  on public.job_queue (locked_at)
  where status = 'executando';

create trigger set_updated_at before update on public.job_queue
  for each row execute function public.set_updated_at();

alter table public.job_queue enable row level security;

-- Administrador da clinica enxerga os jobs dela (transparencia operacional).
-- Nenhuma policy de escrita: quem escreve e o sistema, por service role.
create policy "admin le os jobs da clinica" on public.job_queue
  for select using (public.user_has_role(clinic_id, array['admin']));

-- ---------------------------------------------------------------------------
-- 4. Claim, conclusao e falha
-- ---------------------------------------------------------------------------

-- Pega ate p_limit jobs prontos, de forma segura com varios workers (SKIP
-- LOCKED). Tambem recolhe lease vencido: job preso em 'executando' ha mais de
-- 5 minutos (worker morreu no meio) volta a ser elegivel; se ja gastou as
-- tentativas, vira 'falhou' em vez de rodar para sempre.
create or replace function public.claim_jobs(
  p_worker text,
  p_limit integer default 5
) returns setof public.job_queue
language plpgsql
set search_path = public
as $$
begin
  -- Enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    and locked_at < now() - interval '5 minutes'
    and attempts >= max_attempts;

  return query
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (
    select id from job_queue
    where (status = 'pendente' and run_at <= now())
       or (status = 'executando'
           and locked_at < now() - interval '5 minutes'
           and attempts < max_attempts)
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$$;

create or replace function public.concluir_job(p_id uuid)
returns void
language sql
set search_path = public
as $$
  update job_queue
  set status = 'concluido', locked_by = null, locked_at = null
  where id = p_id and status = 'executando'
$$;

-- Falha com retry e backoff exponencial (30s, 60s, 120s..., teto 10min).
-- p_definitivo pula o retry: erro que nao muda com repeticao (ex.: contato
-- sem consentimento) nao deve ser martelado.
create or replace function public.falhar_job(
  p_id uuid,
  p_erro text,
  p_definitivo boolean default false
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
        else now() + make_interval(secs => least(600, 15 * power(2, attempts)))
      end,
      last_error = left(p_erro, 200),
      locked_by = null,
      locked_at = null
  where id = p_id and status = 'executando'
$$;

revoke execute on function public.claim_jobs(text, integer)
  from public, anon, authenticated;
revoke execute on function public.concluir_job(uuid)
  from public, anon, authenticated;
revoke execute on function public.falhar_job(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer) to service_role;
grant execute on function public.concluir_job(uuid) to service_role;
grant execute on function public.falhar_job(uuid, text, boolean)
  to service_role;
