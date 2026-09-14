-- Tarefa 4.9, fase 2: a reoferta de ponta a ponta no banco.
--
-- Aceite que governa: "cancelar um agendamento dispara oferta e o segundo a
-- responder recebe recusa educada, nao o horario."
--
-- Pecas: o kind novo de job; o gatilho de cancelamento (AFTER UPDATE em
-- appointment, precedente exato de avancar_funil_ao_comparecer: os caminhos
-- de cancelamento sao multiplos e um so gancho no banco pega todos); as
-- RPCs atomicas da onda (criar), do vencedor (aceitar, com FOR UPDATE: o
-- primeiro leva) e da recusa; e a expiracao dentro de motor_manutencao, que
-- o pg_cron ja roda a cada minuto.

-- ---------------------------------------------------------------------------
-- 1. Kind novo

alter table public.job_queue drop constraint job_queue_kind_check;
alter table public.job_queue add constraint job_queue_kind_check
  check (kind in (
    'enviar_mensagem_ativa',
    'baixar_midia',
    'executar_passo_de_regua',
    'enviar_conversao_meta',
    'oferecer_lista_espera'
  ));

-- ---------------------------------------------------------------------------
-- 2. Gatilho de cancelamento

create or replace function public.oferecer_ao_cancelar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Clinica sem fila ativa nao ganha job (higiene da job_queue).
  if exists (
    select 1 from public.waitlist w
     where w.clinic_id = new.clinic_id and w.active
  ) then
    insert into public.job_queue (clinic_id, kind, payload)
    values (
      new.clinic_id,
      'oferecer_lista_espera',
      jsonb_build_object('appointment_id', new.id)
    );
  end if;
  return new;
exception when others then
  -- NUNCA bloquear um cancelamento (padrao registrar_conversao_do_funil).
  raise warning 'reoferta nao enfileirada (clinic %): %',
    new.clinic_id, sqlstate;
  return new;
end;
$$;

-- Encaixe (is_overbooking) cancelado nao libera slot nenhum: fica fora pelo
-- WHEN. Horario ja passado idem.
create trigger oferecer_ao_cancelar
  after update of status on public.appointment
  for each row
  when (
    new.status in ('cancelado_paciente', 'cancelado_clinica')
    and old.status not in ('cancelado_paciente', 'cancelado_clinica')
    and new.is_overbooking = false
    and new.starts_at > now()
  )
  execute function public.oferecer_ao_cancelar();

-- ---------------------------------------------------------------------------
-- 3. A onda nasce ATOMICA: oferta + mensagens na mesma transacao

create or replace function public.criar_oferta_de_espera(
  p_clinic_id uuid,
  p_source_appointment_id uuid,
  p_professional_id uuid,
  p_slot_starts_at timestamptz,
  p_slot_ends_at timestamptz,
  p_expires_at timestamptz,
  -- [{"contact_id": "...", "body": "..."}]
  p_destinatarios jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_id uuid;
begin
  begin
    insert into public.waitlist_offer (
      clinic_id, source_appointment_id, professional_id,
      slot_starts_at, slot_ends_at, expires_at, offered_to
    )
    values (
      p_clinic_id, p_source_appointment_id, p_professional_id,
      p_slot_starts_at, p_slot_ends_at, p_expires_at,
      (select coalesce(array_agg((d->>'contact_id')::uuid), '{}'::uuid[])
         from jsonb_array_elements(p_destinatarios) d)
    )
    returning id into v_offer_id;
  exception when unique_violation then
    -- Onda concorrente ja criou a oferta deste horario: nada a fazer.
    return null;
  end;

  -- As mensagens saem pelo executor de envio ativo EXISTENTE, que reconfere
  -- consentimento e grava custo; aqui elas so nascem, junto da oferta, para
  -- retry do job nao criar envio orfao nem oferta muda.
  insert into public.job_queue (clinic_id, kind, payload)
  select p_clinic_id,
         'enviar_mensagem_ativa',
         jsonb_build_object(
           'contact_id', d->>'contact_id',
           'body', d->>'body'
         )
    from jsonb_array_elements(p_destinatarios) d;

  return v_offer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. O primeiro que responder leva (FOR UPDATE arbitra)

create or replace function public.aceitar_oferta_de_espera(
  p_clinic_id uuid,
  p_offer_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oferta record;
  v_entrada record;
  v_service_link uuid;
  v_appointment uuid;
  v_profissional text;
  v_timezone text;
begin
  select * into v_oferta
    from public.waitlist_offer
   where id = p_offer_id
     and clinic_id = p_clinic_id
     and status = 'aberta'
     and expires_at > now()
     and p_contact_id = any(offered_to)
     and not (p_contact_id = any(declined_by))
     for update;
  if not found then
    -- Segundo a responder, oferta cancelada, vencida ou recusada por ele.
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  -- O vinculo do vencedor: a entrada ativa dele com procedimento compativel
  -- com o profissional da oferta; sem isso, o vinculo do proprio appointment
  -- cancelado (sempre existe: source_appointment_id e NOT NULL).
  select w.* into v_entrada
    from public.waitlist w
   where w.clinic_id = p_clinic_id
     and w.contact_id = p_contact_id
     and w.active
     and (w.professional_id is null
          or w.professional_id = v_oferta.professional_id)
   order by (w.procedure_id is not null) desc, w.priority, w.created_at
   limit 1;

  if v_entrada.procedure_id is not null then
    select sl.id into v_service_link
      from public.service_link sl
     where sl.clinic_id = p_clinic_id
       and sl.professional_id = v_oferta.professional_id
       and sl.procedure_id = v_entrada.procedure_id
       and sl.active
     limit 1;
  end if;
  if v_service_link is null then
    select a.service_link_id into v_service_link
      from public.appointment a
     where a.id = v_oferta.source_appointment_id;
  end if;

  -- A trava REAL contra corrida com marcacao manual e a exclusion
  -- constraint: se alguem ocupou o horario no meio tempo, o insert falha e
  -- a oferta morre com honestidade.
  begin
    insert into public.appointment (
      clinic_id, contact_id, professional_id, service_link_id,
      starts_at, ends_at, status, created_by, source
    )
    select p_clinic_id, p_contact_id, v_oferta.professional_id,
           v_service_link, v_oferta.slot_starts_at, v_oferta.slot_ends_at,
           'agendado', 'sistema', 'interna'
    returning id into v_appointment;
  exception when exclusion_violation then
    update public.waitlist_offer
       set status = 'cancelada'
     where id = p_offer_id;
    return jsonb_build_object('ok', false, 'erro', 'horario_ocupado');
  end;

  update public.waitlist_offer
     set status = 'preenchida',
         responded_by = p_contact_id,
         responded_at = now(),
         appointment_id = v_appointment
   where id = p_offer_id;

  -- O vencedor sai da fila (a entrada que casou; active=false, nunca delete).
  if v_entrada.id is not null then
    update public.waitlist set active = false where id = v_entrada.id;
  end if;

  -- Evento na conversa, como confirmar_pelo_paciente faz.
  if p_conversation_id is not null then
    insert into public.message (
      clinic_id, conversation_id, direction, author,
      content_type, body, billable, cost_cents
    )
    values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema',
      'evento', 'O paciente aceitou o horário oferecido pela lista de espera.',
      false, 0
    );
  end if;

  select p.name into v_profissional
    from public.professional p where p.id = v_oferta.professional_id;
  select c.timezone into v_timezone
    from public.clinic c where c.id = p_clinic_id;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment,
    'starts_at', v_oferta.slot_starts_at,
    'profissional', v_profissional,
    'timezone', v_timezone
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Recusa educada: sai DESTA oferta, continua na fila

create or replace function public.recusar_oferta_de_espera(
  p_clinic_id uuid,
  p_offer_id uuid,
  p_contact_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oferta record;
begin
  select * into v_oferta
    from public.waitlist_offer
   where id = p_offer_id
     and clinic_id = p_clinic_id
     and status = 'aberta'
     and p_contact_id = any(offered_to)
     and not (p_contact_id = any(declined_by))
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  update public.waitlist_offer
     set declined_by = declined_by || p_contact_id
   where id = p_offer_id;

  -- Todos recusaram: nao ha por que esperar a janela vencer; a proxima onda
  -- ja parte.
  if cardinality(v_oferta.declined_by) + 1 >= cardinality(v_oferta.offered_to) then
    update public.waitlist_offer
       set status = 'expirada'
     where id = p_offer_id;
    insert into public.job_queue (clinic_id, kind, payload)
    values (
      p_clinic_id,
      'oferecer_lista_espera',
      jsonb_build_object('origem_offer_id', p_offer_id)
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Expiracao passa adiante (motor_manutencao, cron de 1 minuto)

create or replace function public.expirar_ofertas_de_espera()
returns integer
language sql
security definer
set search_path = ''
as $$
  with vencidas as (
    update public.waitlist_offer
       set status = 'expirada'
     where status = 'aberta' and expires_at < now()
    returning id, clinic_id
  ),
  enfileiradas as (
    insert into public.job_queue (clinic_id, kind, payload)
    select clinic_id, 'oferecer_lista_espera',
           jsonb_build_object('origem_offer_id', id)
      from vencidas
    returning 1
  )
  select count(*)::integer from vencidas;
$$;

create or replace function public.motor_manutencao()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
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

  -- Janela de reoferta vencida vira 'expirada' e a proxima onda parte (4.9).
  begin
    select expirar_ofertas_de_espera() into v_ofertas;
  exception when others then
    v_erros := v_erros || ('expirar_ofertas:' || sqlstate);
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
    v_holds + v_orfas + v_ofertas,
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
    'ofertas_expiradas', v_ofertas,
    'reguas', v_reguas,
    'erros', v_erros
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants: tudo do sistema, nada de sessao (a licao das funcoes abertas)

revoke all on function public.criar_oferta_de_espera(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.criar_oferta_de_espera(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, jsonb) to service_role;
revoke all on function public.aceitar_oferta_de_espera(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.aceitar_oferta_de_espera(uuid, uuid, uuid, uuid) to service_role;
revoke all on function public.recusar_oferta_de_espera(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.recusar_oferta_de_espera(uuid, uuid, uuid) to service_role;
revoke all on function public.expirar_ofertas_de_espera() from public, anon, authenticated;
grant execute on function public.expirar_ofertas_de_espera() to service_role;
