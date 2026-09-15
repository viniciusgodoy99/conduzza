-- Correcao de RAIZ da revisao das correcoes (15/09/2026): a oferta passa a
-- GUARDAR qual entrada da fila casou com a vaga.
--
-- O problema: quem monta a onda (lib/domain/lista-espera.ts, casaComSlot)
-- filtra por profissional, procedimento ATENDIDO, turno e dia da semana; a
-- RPC do aceite adivinhava a entrada de novo, com um subconjunto da regra
-- (sem turno e sem dia). Contato com duas entradas ativas (permitido de
-- proposito pelo indice waitlist_ativa_unica) recebia a oferta por causa da
-- entrada B e, ao aceitar, era agendado com o service_link da entrada A:
-- procedimento, preco e duracao errados na agenda, e a fila baixava o pedido
-- que ele NAO ganhou.
--
-- A adivinhacao acaba: o job manda o waitlist_id de cada destinatario e a
-- oferta guarda o array PAREADO com offered_to. A heuristica antiga fica so
-- como fallback para ofertas criadas antes desta migration.

alter table public.waitlist_offer
  add column matched_waitlist_ids uuid[] not null default '{}';

comment on column public.waitlist_offer.matched_waitlist_ids is
  'Entrada da fila que casou com a vaga, pareada por posicao com offered_to.';

create or replace function public.criar_oferta_de_espera(
  p_clinic_id uuid,
  p_source_appointment_id uuid,
  p_professional_id uuid,
  p_slot_starts_at timestamptz,
  p_slot_ends_at timestamptz,
  p_expires_at timestamptz,
  -- [{"contact_id": "...", "waitlist_id": "...", "body": "..."}]
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
      slot_starts_at, slot_ends_at, expires_at,
      offered_to, matched_waitlist_ids
    )
    select
      p_clinic_id, p_source_appointment_id, p_professional_id,
      p_slot_starts_at, p_slot_ends_at, p_expires_at,
      -- Os dois arrays sao PAREADOS por posicao: a ordinalidade do jsonb
      -- manda nos dois, senao o indice do aceite apontaria para a entrada
      -- de outra pessoa.
      coalesce(array_agg((d->>'contact_id')::uuid order by ord), '{}'::uuid[]),
      coalesce(array_agg((d->>'waitlist_id')::uuid order by ord), '{}'::uuid[])
    from jsonb_array_elements(p_destinatarios) with ordinality as t(d, ord)
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
  v_indice integer;
  v_entrada_id uuid;
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

  -- A entrada que o JOB casou com esta vaga, pela posicao no array. Sem
  -- adivinhacao: turno, dia da semana e procedimento ja foram conferidos
  -- na montagem da onda.
  v_indice := array_position(v_oferta.offered_to, p_contact_id);
  if v_indice is not null
     and coalesce(array_length(v_oferta.matched_waitlist_ids, 1), 0) >= v_indice
  then
    v_entrada_id := v_oferta.matched_waitlist_ids[v_indice];
  end if;
  if v_entrada_id is not null then
    select * into v_entrada
      from public.waitlist w
     where w.id = v_entrada_id
       and w.clinic_id = p_clinic_id
       and w.active;
  end if;

  -- Fallback para ofertas criadas ANTES desta migration (ou entrada que
  -- saiu da fila no meio tempo): a heuristica antiga, com o procedimento
  -- atendido pelo profissional na frente.
  if v_entrada.id is null then
    select w.* into v_entrada
      from public.waitlist w
     where w.clinic_id = p_clinic_id
       and w.contact_id = p_contact_id
       and w.active
       and (w.professional_id is null
            or w.professional_id = v_oferta.professional_id)
     order by
       (w.procedure_id is not null and exists (
          select 1 from public.service_link sl
           where sl.clinic_id = p_clinic_id
             and sl.professional_id = v_oferta.professional_id
             and sl.procedure_id = w.procedure_id
             and sl.active
       )) desc,
       (w.procedure_id is not null) desc,
       w.priority, w.created_at
     limit 1;
  end if;

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
