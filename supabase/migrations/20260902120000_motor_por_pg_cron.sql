-- ---------------------------------------------------------------------------
-- Motor de automacao sem processo: o banco manda, a rota executa
-- ---------------------------------------------------------------------------
-- CONTEXTO. A migration 20260831100000 registrou que "pg_cron nao existe neste
-- projeto" e desenhou o motor como processo Node 24/7 com prova de vida. Em
-- 02/09/2026 a premissa foi conferida e e FALSA: pg_cron 1.6.4 e pg_net 0.20.4
-- estao disponiveis. Esta migration prepara o desenho que a 20260821140000 ja
-- antecipava ("uma Edge Function agendada por pg_cron pode assumir depois sem
-- mudar nada aqui"): manutencao em SQL dentro do banco, fila numa rota HTTP.
--
-- O QUE ESTA MIGRATION NAO FAZ, DE PROPOSITO:
--   create extension, cron.schedule e o segredo do Vault NAO entram aqui. Sao
--   passo de operacao, uma vez, no projeto remoto (ver supabase/operacao/
--   motor-por-cron.md). Em migration eles rodariam no db:reset e em banco de
--   teste, e no pior caso um Postgres de laptop viraria um SEGUNDO motor
--   batendo na producao, dobrando as reservas de slot e envenenando o
--   espacamento anti-banimento do numero da clinica. Por isso motor_agendar e
--   disparar_ciclo_do_motor referenciam cron e net por execute format(),
--   resolvido em runtime: assim esta migration continua aplicavel num banco
--   que nem tem as extensoes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Clinica de teste: isolamento por DADO, nao por interruptor global
-- ---------------------------------------------------------------------------
-- A suite de testes roda contra o banco REMOTO (tests/rls/stack.ts le o
-- .env.local). Uma tabela global de "pausa" entregaria a chave de desligar a
-- automacao de clinicas reais para qualquer vitest na maquina de qualquer
-- pessoa, e um Ctrl+C no meio deixaria o produto pausado ate alguem ver a
-- faixa. Escopado por clinica nao tem estado que vaza.

alter table public.clinic
  add column if not exists e_de_teste boolean not null default false;

comment on column public.clinic.e_de_teste is
  'Clinica descartavel de suite automatizada. O motor de producao a ignora, para o tick nao roubar os jobs das fixtures.';

-- ---------------------------------------------------------------------------
-- 2. Diagnostico da fila: por que um job foi adiado, e quantas vezes
-- ---------------------------------------------------------------------------
-- Com adiamento no lugar de sono (secao 4), um job pode ir e voltar sem nunca
-- ser executado. Sem contador, isso e invisivel: o job fica 'pendente' com
-- run_at no futuro, que e exatamente o estado de um job saudavel.

alter table public.job_queue
  add column if not exists devolucoes integer not null default 0,
  add column if not exists ultimo_motivo_devolucao text;

comment on column public.job_queue.devolucoes is
  'Quantas vezes o job foi adiado sem executar (canal ocupado, fora da janela). Teto vira falha definitiva.';

-- Indice do claim por clinica: transforma a varredura da fila em um seek por
-- clinica. Custo passa a ser O(clinicas), nao O(fila).
create index if not exists job_queue_clinica_pendente_idx
  on public.job_queue (clinic_id, run_at)
  where status = 'pendente';

-- ---------------------------------------------------------------------------
-- 3. Prova de vida: dois papeis, e o erro da ultima passagem
-- ---------------------------------------------------------------------------
-- Com dois executores (o planner dentro do banco e a fila na rota), a leitura
-- "a batida mais recente de qualquer worker" mentiria: o planner vivo
-- esconderia a rota morta e a clinica veria tudo verde com nada saindo. E
-- exatamente o silencio que a 20260831100000 foi escrita para acabar.

alter table public.worker_heartbeat
  add column if not exists ultimo_erro text,
  add column if not exists ultimo_erro_em timestamptz;

comment on column public.worker_heartbeat.ultimo_erro is
  'Codigo curto do ultimo erro (ex: planejar_reguas:P0001). NUNCA SQLERRM: a mensagem do Postgres pode carregar valor de linha, e dado de paciente nao vai para log (regra 3.1).';

-- ---------------------------------------------------------------------------
-- 4. reservar_slot_envio_v2: consultar antes, reservar so quando vai enviar
-- ---------------------------------------------------------------------------
-- DEFEITO QUE ISTO CORRIGE. A v1 avanca next_send_at ANTES da espera e nao tem
-- devolucao. Quando a espera estoura o teto, o slot fica queimado e o retry
-- reserva de novo: next_send_at anda 10 a 30 segundos por tentativa SEM
-- NINGUEM TER ENVIADO, cumulativamente. Hoje e quase inofensivo porque so ha
-- um executor em serie; qualquer paralelizacao acorda o problema.
--
-- SEGUNDO DEFEITO, vivo hoje: sem linha em whatsapp_account o update casa zero
-- linhas, a v1 devolve null, o cliente converte em espera 0 e a mensagem sai
-- SEM ESPACAMENTO NENHUM. O comentario da v1 promete "falha FECHADA" e o
-- codigo entrega falha aberta. A v2 devolve 'sem_conta' explicitamente.
--
-- A v1 CONTINUA VIVA, sem chamador de producao, ate a VPS ser descartada.
-- Trocar o retorno in place exigiria drop function, e entre a migration e o
-- deploy o codigo em producao receberia jsonb onde espera number, cairia no
-- `typeof esperaMs === "number" ? esperaMs : 0` e DESLIGARIA o espacamento em
-- todo envio 1:1, em silencio, na direcao perigosa.

create or replace function public.reservar_slot_envio_v2(
  p_clinic_id uuid,
  p_espaco_ms integer,
  p_espera_maxima_ms integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_livre_em timestamptz;
  v_espera_ms double precision;
begin
  -- O lock de linha serializa concorrentes; a transacao dura microssegundos.
  select greatest(coalesce(next_send_at, now()), now())
    into v_livre_em
  from whatsapp_account
  where clinic_id = p_clinic_id
  for update;

  if not found then
    -- Falha FECHADA de verdade: sem conta, nao ha envio sem espacamento.
    return jsonb_build_object('estado', 'sem_conta');
  end if;

  v_espera_ms := greatest(0, extract(epoch from (v_livre_em - now())) * 1000);

  if v_espera_ms > p_espera_maxima_ms then
    -- ADIADO: nao escreve NADA. Nenhum slot e queimado. O chamador reagenda
    -- o job para livre_em e ninguem espera segurando uma requisicao.
    return jsonb_build_object(
      'estado', 'adiado',
      'livre_em', v_livre_em
    );
  end if;

  update whatsapp_account
  set next_send_at = v_livre_em + make_interval(secs => p_espaco_ms / 1000.0)
  where clinic_id = p_clinic_id;

  return jsonb_build_object(
    'estado', 'reservado',
    'espera_ms', v_espera_ms
  );
end;
$$;

revoke execute on function public.reservar_slot_envio_v2(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reservar_slot_envio_v2(uuid, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. claim_jobs_por_clinica: um job por clinica, clinicas em paralelo
-- ---------------------------------------------------------------------------
-- next_send_at vive em whatsapp_account por clinic_id, entao clinicas NAO
-- competem entre si. Dentro de uma clinica, o segundo job em voo seria adiado
-- de qualquer jeito: reivindica-lo e trabalho perdido e e a origem da reserva
-- queimada.
--
-- Justica sai de graca: uma clinica com 200 toques cede UM job por passagem e
-- a vizinha continua sendo servida. Com o `order by run_at limit 3` global de
-- hoje, um lote inteiro sairia da mesma clinica.
--
-- Os TRES ramos do claim_jobs original sao preservados. O terceiro (recuperar
-- lease vencido) nao e detalhe: sem ele, todo job cortado pelo limite de
-- duracao da plataforma ficaria preso para sempre, porque o indice parcial
-- `where status = 'pendente'` nao enxerga 'executando'.
--
-- Lease de 5 minutos para 180 segundos: e o triplo da invocacao maxima, e o
-- claim incrementa attempts no recolhimento. Com lease de 90s, uma
-- instabilidade de plataforma queimaria as 8 tentativas em 12 minutos.

create or replace function public.claim_jobs_por_clinica(
  p_worker text,
  p_max_clinicas integer,
  p_kinds text[],
  p_incluir_teste boolean default false
) returns setof public.job_queue
language plpgsql
set search_path = public
as $$
begin
  -- Ramo 1: enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    and locked_at < now() - interval '180 seconds'
    and attempts >= max_attempts
    and kind = any(p_kinds);

  -- Ramos 2 e 3: um job elegivel por clinica, as mais atrasadas primeiro.
  return query
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (
    select escolhido.id
    from clinic c
    cross join lateral (
      select q.id, q.run_at
      from job_queue q
      where q.clinic_id = c.id
        and q.kind = any(p_kinds)
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.run_at
      limit 1
    ) escolhido
    where (p_incluir_teste or not c.e_de_teste)
    order by escolhido.run_at
    limit p_max_clinicas
    for update skip locked
  )
  returning j.*;
end;
$$;

revoke execute on function public.claim_jobs_por_clinica(text, integer, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.claim_jobs_por_clinica(text, integer, text[], boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. reagendar_job com motivo e teto de devolucoes
-- ---------------------------------------------------------------------------
-- A versao de 20260826100000 devolve a tentativa (attempts - 1), o que e certo
-- para adiamento. Mas sem teto, um job de clinica com canal permanentemente
-- ocupado ficaria indo e voltando para sempre, invisivel.

-- DROP da versao de tres argumentos e obrigatorio, nao higiene: create or
-- replace com um parametro novo cria uma SEGUNDA funcao, e uma chamada por
-- nome com tres argumentos passaria a casar as duas (ambiguidade). O retorno
-- continua boolean para o codigo ja publicado, que confere `reagendou === true`,
-- seguir funcionando entre esta migration e o proximo deploy.
drop function if exists public.reagendar_job(uuid, text, timestamptz);

create or replace function public.reagendar_job(
  p_id uuid,
  p_worker text,
  p_run_at timestamptz,
  p_motivo text default null
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_devolucoes integer;
begin
  select devolucoes + 1 into v_devolucoes
  from job_queue
  where id = p_id and locked_by = p_worker and status = 'executando';

  if v_devolucoes is null then
    return false; -- perdeu a posse; outro executor cuida
  end if;

  if v_devolucoes >= 20 then
    -- Teto: 20 adiamentos e sinal de canal que nao abre, nao de fila cheia.
    update job_queue
    set status = 'falhou',
        last_error = coalesce(p_motivo, 'devolucoes_demais'),
        devolucoes = v_devolucoes,
        ultimo_motivo_devolucao = p_motivo,
        locked_by = null,
        locked_at = null
    where id = p_id;
    return true;
  end if;

  update job_queue
  set status = 'pendente',
      run_at = p_run_at,
      attempts = greatest(attempts - 1, 0),
      devolucoes = v_devolucoes,
      ultimo_motivo_devolucao = p_motivo,
      locked_by = null,
      locked_at = null
  where id = p_id;
  return true;
end;
$$;

revoke execute on function public.reagendar_job(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reagendar_job(uuid, text, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Balde de midia: privacidade garantida no banco, nao no caminho quente
-- ---------------------------------------------------------------------------
-- garantirBucketDeMidia era chamada uma vez no boot do worker e perde o unico
-- chamador de producao. Ela fazia duas coisas, e a segunda e a que importa:
-- reafirmar public = false (audio e imagem de paciente). Envolver isso num
-- try/catch dentro de uma rota que "nunca lanca" transformaria o unico
-- controle de privacidade do balde em melhor esforco.

insert into storage.buckets (id, name, public)
values ('midia-conversas', 'midia-conversas', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- 8. motor_manutencao: as rotinas periodicas, dentro do banco
-- ---------------------------------------------------------------------------
-- Estas rotinas sao so chamadas de funcao: nao precisam da rede nem da Vercel.
-- Tira-las de la elimina o modo de falha mais bobo (a rota nao responde, o
-- planner nao roda) e mata o defeito estrutural do worker atual, em que as
-- quatro rotinas ficam FORA do try que abraca processarLote, entao um throw
-- ali mata o processo (e a causa do ciclo de reinicio medido em 02/09).
--
-- Cada bloco tem o proprio exception: uma falha nao impede as outras.
-- A batida prova que o cron rodou; ultimo_erro prova se o trabalho deu certo.
-- Um exception que bate ponto e cala seria o planner morto ficando verde.

create or replace function public.motor_manutencao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
begin
  begin
    select limpar_holds_vencidos() into v_holds;
  exception when others then
    v_erros := v_erros || ('limpar_holds:' || sqlstate);
  end;

  begin
    select fechar_runs_orfas() into v_orfas;
  exception when others then
    v_erros := v_erros || ('fechar_runs_orfas:' || sqlstate);
  end;

  begin
    select planejar_reguas() into v_reguas;
  exception when others then
    v_erros := v_erros || ('planejar_reguas:' || sqlstate);
  end;

  -- Higiene: as linhas de hostname:pid da VPS, que reiniciava a cada 1 a 2
  -- minutos e nada podava.
  begin
    delete from worker_heartbeat
    where worker_id not in ('motor-fila', 'motor-planner')
      and batida_em < now() - interval '1 hour';
  exception when others then
    v_erros := v_erros || ('higiene:' || sqlstate);
  end;

  -- Reafirma a privacidade do balde de midia (de hora em hora basta, mas
  -- rodar sempre e barato e nao depende de mais um agendamento).
  begin
    update storage.buckets set public = false
    where id = 'midia-conversas' and public is distinct from false;
  exception when others then
    v_erros := v_erros || ('balde:' || sqlstate);
  end;

  insert into worker_heartbeat (worker_id, batida_em, ultimo_lote, ultimo_erro, ultimo_erro_em)
  values (
    'motor-planner',
    now(),
    v_holds + v_orfas,
    case when array_length(v_erros, 1) is null then null
         else array_to_string(v_erros, ',') end,
    case when array_length(v_erros, 1) is null then null else now() end
  )
  on conflict (worker_id) do update
  set batida_em = now(),
      ultimo_lote = excluded.ultimo_lote,
      ultimo_erro = excluded.ultimo_erro,
      ultimo_erro_em = coalesce(excluded.ultimo_erro_em, worker_heartbeat.ultimo_erro_em);

  return jsonb_build_object(
    'holds', v_holds,
    'runs_orfas', v_orfas,
    'reguas', v_reguas,
    'erros', v_erros
  );
end;
$$;

revoke execute on function public.motor_manutencao() from public, anon, authenticated;
grant execute on function public.motor_manutencao() to service_role;

-- ---------------------------------------------------------------------------
-- 9. saude_do_motor: o que a tela precisa saber, numa chamada
-- ---------------------------------------------------------------------------
-- Substitui a leitura crua de worker_heartbeat pelos tres leitores (layout,
-- motor-status, global-setup do e2e), que hoje fazem "a batida mais recente de
-- QUALQUER worker" e por isso seriam enganados por um npm run motor:local
-- esquecido num laptop.
--
-- So contadores e carimbos. Nenhum dado de paciente, nenhum clinic_id: o motor
-- e do produto inteiro, nao de uma clinica.

create or replace function public.saude_do_motor()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'fila', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-fila'
    ),
    'planner', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-planner'
    ),
    'atrasados', (
      select count(*) from job_queue
      where status = 'pendente' and run_at < now() - interval '5 minutes'
    )
  );
$$;

revoke execute on function public.saude_do_motor() from public, anon;
grant execute on function public.saude_do_motor() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Agendamento: funcoes que a OPERACAO chama, nunca a migration
-- ---------------------------------------------------------------------------
-- execute format() de proposito: assim esta migration e aplicavel num banco
-- sem pg_cron e sem pg_net (o CLI local pode nao ter pg_cron em
-- shared_preload_libraries, e um create extension aqui derrubaria a cadeia de
-- migrations junto com a suite de RLS, que e item da definicao de pronto).
--
-- A URL e o segredo ficam no Vault, nao literais em cron.job.command: o
-- comando e copiado para cron.job_run_details a cada execucao, onde nenhuma
-- poda alcanca.

create or replace function public.disparar_ciclo_do_motor()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'motor_tick_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'motor_tick_secret';

  if v_url is null or v_secret is null then
    raise exception 'motor_tick_url ou motor_tick_secret ausente no Vault';
  end if;

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 58000)',
    v_url,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::text,
    jsonb_build_object('origem', 'cron', 'disparado_em', now())::text
  );
end;
$$;

revoke execute on function public.disparar_ciclo_do_motor() from public, anon, authenticated;
grant execute on function public.disparar_ciclo_do_motor() to service_role;

create or replace function public.motor_agendar()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  execute $cron$ select cron.schedule('motor-manutencao', '* * * * *', 'select public.motor_manutencao()') $cron$;
  execute $cron$ select cron.schedule('motor-fila', '20 seconds', 'select public.disparar_ciclo_do_motor()') $cron$;
  return 'motor-manutencao (60s) e motor-fila (20s) agendados';
end;
$$;

create or replace function public.motor_desagendar()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  execute $cron$ select cron.unschedule('motor-fila') $cron$;
  execute $cron$ select cron.unschedule('motor-manutencao') $cron$;
  return 'motor desagendado';
end;
$$;

revoke execute on function public.motor_agendar() from public, anon, authenticated;
revoke execute on function public.motor_desagendar() from public, anon, authenticated;
