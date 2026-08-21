-- Correcoes da revisao adversarial da Etapa B (21/08/2026). O tema unico dos
-- achados criticos: caminhos em que o PACIENTE RECEBE A MESMA MENSAGEM DUAS
-- VEZES. Num canal nao oficial, mensagem duplicada e o acelerador de denuncia
-- e banimento, alem de constrangedor para a clinica.

-- ---------------------------------------------------------------------------
-- 1. Idempotencia do envio por job
-- ---------------------------------------------------------------------------
-- A linha de message passa a poder nascer ANTES do envio (delivery_status
-- 'enviando'), amarrada ao job pelo unique de job_id. Um retry encontra a
-- linha e sabe: se o envio pode ter saido, NAO reenvia.

alter table public.message
  drop constraint message_delivery_status_check;
alter table public.message
  add constraint message_delivery_status_check
  check (delivery_status in
    ('enviando', 'enviada', 'entregue', 'lida', 'falhou'));

alter table public.message
  add column job_id uuid unique references public.job_queue (id)
    on delete set null;

comment on column public.message.job_id is
  'Job da fila que originou este envio. O unique e a chave de idempotencia: um retry do job encontra a linha e nao reenvia o que pode ja ter saido.';

-- ---------------------------------------------------------------------------
-- 2. Conclusao e falha exigem a POSSE do claim
-- ---------------------------------------------------------------------------
-- Antes, concluir_job/falhar_job filtravam so por status: um worker atrasado
-- (lease vencido) concluia ou derrubava o claim VIGENTE de outro worker,
-- abrindo execucao dupla e ate tripla. Agora só o dono do claim mexe no job.

drop function public.concluir_job(uuid);
drop function public.falhar_job(uuid, text, boolean);

create or replace function public.concluir_job(p_id uuid, p_worker text)
returns void
language sql
set search_path = public
as $$
  update job_queue
  set status = 'concluido', locked_by = null, locked_at = null
  where id = p_id and status = 'executando' and locked_by = p_worker
$$;

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
        else now() + make_interval(secs => least(600, 15 * power(2, attempts)))
      end,
      last_error = left(p_erro, 200),
      locked_by = null,
      locked_at = null
  where id = p_id and status = 'executando' and locked_by = p_worker
$$;

-- Reconferencia de posse com renovacao de lease (heartbeat). O worker chama
-- ANTES de executar cada job do lote: se outro worker ja assumiu (lease tinha
-- vencido no meio do lote), devolve false e o job e PULADO sem executar.
-- E esta chamada que garante que dois workers nunca executam o mesmo job.
create or replace function public.confirmar_posse_job(
  p_id uuid,
  p_worker text
) returns boolean
language sql
set search_path = public
as $$
  update job_queue
  set locked_at = now()
  where id = p_id and status = 'executando' and locked_by = p_worker
  returning true
$$;

revoke execute on function public.concluir_job(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.falhar_job(uuid, text, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.confirmar_posse_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.concluir_job(uuid, text) to service_role;
grant execute on function public.falhar_job(uuid, text, boolean, text)
  to service_role;
grant execute on function public.confirmar_posse_job(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Reserva de slot devolve a ESPERA, nao o horario
-- ---------------------------------------------------------------------------
-- A espera era calculada comparando o horario do Postgres com o Date.now()
-- do Node: desvio de relogio adiantado desativava o espacamento em silencio.
-- Devolvendo a espera em ms, calculada inteira no banco, o relogio do worker
-- deixa de importar.

drop function public.reservar_slot_envio(uuid, integer);

create or replace function public.reservar_slot_envio(
  p_clinic_id uuid,
  p_espaco_ms integer
) returns double precision
language sql
set search_path = public
as $$
  update whatsapp_account
  set next_send_at =
        greatest(coalesce(next_send_at, now()), now())
        + make_interval(secs => p_espaco_ms / 1000.0)
  where clinic_id = p_clinic_id
  returning greatest(
    0,
    extract(epoch from (
      next_send_at - make_interval(secs => p_espaco_ms / 1000.0) - now()
    )) * 1000
  )
$$;

revoke execute on function public.reservar_slot_envio(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reservar_slot_envio(uuid, integer)
  to service_role;
