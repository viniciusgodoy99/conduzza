-- Correcoes da revisao adversarial da Parte B (4.9), lado do banco:
--
-- 1. PRIORIDADE: o default 0 furava a fila renumerada (10, 20...): entrada
--    nova nascia NO TOPO de um grupo ja reordenado. O default vira 1000000:
--    quem entra vai para o FIM (o desempate por created_at preserva a ordem
--    de chegada) e a renumeracao do reordenar normaliza.
-- 2. TENANT: waitlist ganha o MESMO gatilho de appointment/slot_hold contra
--    contact_id de outra clinica (a RLS confere clinic_id da LINHA, nao da
--    referencia).
-- 3. aceitar_oferta_de_espera: a selecao da entrada do vencedor replica o
--    casamento da onda (procedimento atendido pelo profissional vem
--    primeiro), senao baixava a entrada errada e podia agendar procedimento
--    que o profissional nao atende via fallback.

alter table public.waitlist alter column priority set default 1000000;

create trigger exigir_contato_da_mesma_clinica
  before insert or update of contact_id on public.waitlist
  for each row execute function public.exigir_contato_da_mesma_clinica();

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

  -- A entrada do vencedor: a que CASA com a oferta, replicando a montagem
  -- da onda (correcao da revisao de 15/09: a versao anterior podia baixar a
  -- entrada errada e agendar procedimento que o profissional nem atende).
  -- Preferencia: procedimento ATENDIDO pelo profissional da oferta; depois
  -- procedimento declarado; depois prioridade e antiguidade.
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

