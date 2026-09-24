-- Interceptador da resposta do paciente: pedido de remarcacao registrado e
-- eventos com data e hora (revisao de liberacao de 24/09, achados 55, 56 e 61).
--
-- O que muda:
--
-- 1. appointment.remarcacao_pedida_em: a MARCA de que o paciente tocou em
--    "Remarcar". A coluna nasce na migration do grupo reguas-e-fila (o planner
--    e o executor da regua pulam consulta com a marca); o "if not exists" aqui
--    deixa a ordem de aplicacao indiferente.
-- 2. cadence_run.skipped_reason ganha 'remarcacao_pedida' SE ainda nao tiver
--    (mesma razao: o valor e do outro grupo; aqui so se garante, preservando
--    todos os valores que a constraint ja tem, sem lista escrita a mao).
-- 3. appointment_status_history.event: linha de EVENTO na trilha, com autoria,
--    que nao e mudanca de status. Sem ela, o pedido de remarcacao so poderia
--    entrar como uma linha repetindo o status atual "por Paciente", o que a
--    folha de historico mostraria como se o paciente tivesse mudado a
--    situacao da consulta.
-- 4. pedir_remarcacao_pelo_paciente: atomica e idempotente, no molde de
--    confirmar_pelo_paciente/cancelar_pelo_paciente. Grava a marca, fecha os
--    toques pendentes da consulta, registra o evento com autoria do paciente
--    SEM mudar o status e deixa a conversa esperando a recepcao.
-- 5. confirmar_pelo_paciente e cancelar_pelo_paciente redefinidas (base: a
--    definicao VIGENTE em producao em 24/09): o evento da conversa passa a
--    dizer QUAL consulta ("de 24/09 as 09:00"), e o retorno traz starts_at e
--    timezone para o eco ao paciente dizer o mesmo.
-- 6. Gatilho que limpa a marca quando ela perde o sentido: a consulta mudou de
--    horario ou de profissional (foi remarcada), ou saiu da fila de
--    confirmacao por uma decisao (confirmada pela recepcao, cancelada,
--    compareceu, faltou...).

-- 1. A marca na consulta ------------------------------------------------------

alter table public.appointment
  add column if not exists remarcacao_pedida_em timestamptz;

comment on column public.appointment.remarcacao_pedida_em is
  'Quando o paciente pediu para remarcar pelo WhatsApp. Nulo quando nao ha pedido pendente; o gatilho limpar_pedido_de_remarcacao zera ao mover a consulta ou ao decidir o status.';

-- 2. Motivo de toque pulado ----------------------------------------------------

do $$
declare
  v_def text;
  v_valores text[];
begin
  select pg_get_constraintdef(c.oid)
    into v_def
    from pg_constraint c
   where c.conrelid = 'public.cadence_run'::regclass
     and c.conname = 'cadence_run_skipped_reason_check';

  -- Constraint com outro nome (ou ja com o valor): nada a fazer aqui.
  if v_def is null or v_def like '%''remarcacao_pedida''%' then
    return;
  end if;

  select array_agg(m[1] order by ord)
    into v_valores
    from regexp_matches(v_def, '''([a-z_]+)''', 'g') with ordinality as t(m, ord);

  alter table public.cadence_run
    drop constraint cadence_run_skipped_reason_check;
  execute format(
    'alter table public.cadence_run add constraint cadence_run_skipped_reason_check check (skipped_reason = any (%L::text[]))',
    v_valores || array['remarcacao_pedida']
  );
end;
$$;

-- 3. Evento na trilha da consulta ----------------------------------------------

alter table public.appointment_status_history
  add column if not exists event text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointment_status_history'::regclass
       and conname = 'appointment_status_history_event_check'
  ) then
    alter table public.appointment_status_history
      add constraint appointment_status_history_event_check
      check (event is null or event = any (array['remarcacao_pedida']));
  end if;
end;
$$;

comment on column public.appointment_status_history.event is
  'Nulo numa mudanca de status. Preenchido numa linha de evento que NAO muda o status (status repete o atual): remarcacao_pedida.';

-- 4. Pedido de remarcacao pelo paciente ----------------------------------------

create or replace function public.pedir_remarcacao_pelo_paciente(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_inicio timestamptz;
  v_tz text;
begin
  -- Update condicional e a trava: dois "Remarcar" juntos (ou o mesmo evento
  -- reentregue) marcam uma vez so; o segundo recebe ja_tratado, sem eco.
  update appointment
     set remarcacao_pedida_em = now()
   where id = p_appointment_id
     and clinic_id = p_clinic_id
     and contact_id = p_contact_id
     and status in ('agendado', 'aguardando_confirmacao',
                    'confirmado_paciente', 'confirmado_recepcao')
     and starts_at > now()
     and remarcacao_pedida_em is null
   returning status, starts_at into v_status, v_inicio;

  if v_status is null then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  -- Quem ja disse que quer outro horario nao recebe mais "Podemos confirmar
  -- sua presenca?" para ESTE horario. So os toques que ainda nao sairam.
  update cadence_run
     set skipped_reason = 'remarcacao_pedida'
   where clinic_id = p_clinic_id
     and appointment_id = p_appointment_id
     and sent_at is null
     and skipped_reason is null;

  -- Evento na trilha, com autoria do paciente, repetindo o status atual: a
  -- situacao da consulta NAO mudou (horario novo e escolha humana).
  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by, event
  ) values (
    p_clinic_id, p_appointment_id, v_status, null, 'paciente',
    'remarcacao_pedida'
  );

  select c.timezone into v_tz from clinic c where c.id = p_clinic_id;
  v_tz := coalesce(v_tz, 'America/Fortaleza');

  if p_conversation_id is not null then
    insert into message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'O paciente pediu para remarcar a consulta de '
        || to_char(v_inicio at time zone v_tz, 'DD/MM') || ' às '
        || to_char(v_inicio at time zone v_tz, 'HH24:MI')
        || ' pelo WhatsApp.',
      false, 0
    );

    -- Alguem da clinica TEM de agir: a conversa fica no contador de
    -- Atendimento. Conversa ja conduzida por alguem continua com essa pessoa.
    update conversation
       set awaiting_reply = true,
           status = case when status = 'ia_atendendo'
                         then 'aguardando_humano' else status end
     where id = p_conversation_id
       and clinic_id = p_clinic_id;
  end if;

  return jsonb_build_object('ok', true, 'starts_at', v_inicio, 'timezone', v_tz);
end;
$function$;

revoke all on function public.pedir_remarcacao_pelo_paciente(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.pedir_remarcacao_pelo_paciente(uuid, uuid, uuid, uuid)
  to service_role;

-- 5. Confirmar e cancelar dizem QUAL consulta -----------------------------------

create or replace function public.confirmar_pelo_paciente(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_inicio timestamptz;
  v_tz text;
begin
  update appointment
     set status = 'confirmado_paciente',
         confirmation_channel = 'whatsapp'
   where id = p_appointment_id
     and clinic_id = p_clinic_id
     and contact_id = p_contact_id
     and status in ('agendado', 'aguardando_confirmacao')
     and starts_at > now()
   returning id, starts_at into v_id, v_inicio;

  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    p_clinic_id, p_appointment_id, 'confirmado_paciente', null, 'paciente'
  );

  select c.timezone into v_tz from clinic c where c.id = p_clinic_id;
  v_tz := coalesce(v_tz, 'America/Fortaleza');

  if p_conversation_id is not null then
    insert into message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'O paciente confirmou a consulta de '
        || to_char(v_inicio at time zone v_tz, 'DD/MM') || ' às '
        || to_char(v_inicio at time zone v_tz, 'HH24:MI')
        || ' pelo WhatsApp.',
      false, 0
    );
  end if;

  return jsonb_build_object('ok', true, 'starts_at', v_inicio, 'timezone', v_tz);
end;
$function$;

create or replace function public.cancelar_pelo_paciente(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_inicio timestamptz;
  v_tz text;
begin
  update appointment
     set status = 'cancelado_paciente'
   where id = p_appointment_id
     and clinic_id = p_clinic_id
     and contact_id = p_contact_id
     and status in ('agendado', 'aguardando_confirmacao',
                    'confirmado_paciente', 'confirmado_recepcao')
     and starts_at > now()
   returning id, starts_at into v_id, v_inicio;

  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    p_clinic_id, p_appointment_id, 'cancelado_paciente', null, 'paciente'
  );

  select c.timezone into v_tz from clinic c where c.id = p_clinic_id;
  v_tz := coalesce(v_tz, 'America/Fortaleza');

  if p_conversation_id is not null then
    insert into message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'O paciente cancelou a consulta de '
        || to_char(v_inicio at time zone v_tz, 'DD/MM') || ' às '
        || to_char(v_inicio at time zone v_tz, 'HH24:MI')
        || ' pelo WhatsApp.',
      false, 0
    );
  end if;

  return jsonb_build_object('ok', true, 'starts_at', v_inicio, 'timezone', v_tz);
end;
$function$;

-- create or replace preserva o ACL; reafirmado para o arquivo ser a verdade.
revoke all on function public.confirmar_pelo_paciente(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirmar_pelo_paciente(uuid, uuid, uuid, uuid)
  to service_role;
revoke all on function public.cancelar_pelo_paciente(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancelar_pelo_paciente(uuid, uuid, uuid, uuid)
  to service_role;

-- 6. A marca some quando perde o sentido ----------------------------------------

create or replace function public.limpar_pedido_de_remarcacao()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Remarcada (horario ou profissional novo) ou decidida por alguem: o
  -- pedido foi atendido. Voltar para agendado/aguardando_confirmacao sem
  -- mexer no horario NAO atende o pedido, entao a marca fica.
  if new.starts_at is distinct from old.starts_at
     or new.professional_id is distinct from old.professional_id
     or (new.status is distinct from old.status
         and new.status not in ('agendado', 'aguardando_confirmacao'))
  then
    new.remarcacao_pedida_em := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.limpar_pedido_de_remarcacao()
  from public, anon, authenticated;

drop trigger if exists limpar_pedido_de_remarcacao on public.appointment;
create trigger limpar_pedido_de_remarcacao
  before update on public.appointment
  for each row
  when (old.remarcacao_pedida_em is not null)
  execute function public.limpar_pedido_de_remarcacao();
