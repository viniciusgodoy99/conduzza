-- Correcoes da revisao de liberacao (24/09/2026) na lista de espera.
--
-- 1. A VAGA PRECISA EXISTIR (achados 32 e 62). Horario em bloqueio (ferias,
--    doenca), de profissional desativado ou fora da jornada era oferecido por
--    WhatsApp, e o SIM do paciente criava consulta nesse periodo. A regra
--    "a vaga existe?" vira UMA funcao (vaga_de_espera_indisponivel), usada
--    pelo job que monta a onda, pelo aceite e pelo envio de cada mensagem.
--    Qualquer bloqueio conta (com ou sem blocks_overbooking): a oferta nunca
--    e encaixe. Encaixe marcado no horario tambem ocupa o profissional (a
--    mesma regra de availableSlots na Agenda).
-- 2. "NAO OFERECER" NO CANCELAMENTO (achado 62): appointment ganha
--    oferecer_vaga_ao_cancelar (padrao true). A recepcao desliga no dialogo
--    de cancelar e o gatilho oferecer_ao_cancelar respeita.
-- 3. O ENVIO AMARRADO A OFERTA (achados 26 e 63): cada enviar_mensagem_ativa
--    da onda leva o offer_id. O executor so envia se a oferta continua
--    aberta, com folga de prazo e a vaga livre. Cancelar pela tela
--    (cancelar_reoferta_de_espera), preencher, perder a vaga ou expirar
--    cancelam os envios que ainda estavam na fila.
-- 4. O ACEITE CASA O VINCULO CERTO (achado 59): o vinculo sai do convenio do
--    contato (ou particular), com ordem explicita; o fim da consulta sai da
--    duracao do vinculo e o recurso sai do procedimento, como
--    criarAgendamentoAction faz. Entrada "qualquer procedimento" herda o
--    PROCEDIMENTO da consulta cancelada, nunca o vinculo (que carrega o
--    convenio de quem cancelou).
-- 5. PERMISSAO NO BANCO (achados 68 e 7a): a fila e a oferta seguem a matriz
--    (admin, gestor e recepcao escrevem; profissional e leitura so veem). O
--    UPDATE de sessao em waitlist_offer fica restrito a transicao aberta
--    para cancelada, e so na coluna status. mover_na_lista_de_espera e
--    SECURITY INVOKER: o recorte novo da policy de UPDATE vale para ela.

-- ---------------------------------------------------------------------------
-- 1. Opcao de nao oferecer a vaga ao cancelar

alter table public.appointment
  add column if not exists oferecer_vaga_ao_cancelar boolean not null default true;

comment on column public.appointment.oferecer_vaga_ao_cancelar is
  'false = ao cancelar, este horario NAO e oferecido a lista de espera (a recepcao escolhe no dialogo de cancelar). Lido pelo gatilho oferecer_ao_cancelar e pelo job oferecer_lista_espera.';

-- ---------------------------------------------------------------------------
-- 2. A regra unica "a vaga existe?"

-- Devolve NULL quando o intervalo pode ser oferecido/agendado, ou o motivo:
-- 'intervalo_invalido', 'profissional_inativo', 'bloqueado',
-- 'fora_da_jornada' ou 'ocupado'. A jornada e hora LOCAL da clinica (coluna
-- time); janela com fim <= inicio vira o dia (mesma convencao de
-- lib/domain/scheduling.ts). Janelas encostadas se unem (range_agg), entao
-- 08-12 + 12-18 cobre um horario 11:30-12:30. Unidade: a janela vale se ela
-- ou a consulta nao tiver unidade, ou se forem a mesma.
create or replace function public.vaga_de_espera_indisponivel(
  p_clinic_id uuid,
  p_professional_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_unit_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_jornada tstzmultirange;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return 'intervalo_invalido';
  end if;

  if not exists (
    select 1 from public.professional p
     where p.id = p_professional_id
       and p.clinic_id = p_clinic_id
       and p.active
  ) then
    return 'profissional_inativo';
  end if;

  if exists (
    select 1 from public.professional_block b
     where b.clinic_id = p_clinic_id
       and b.professional_id = p_professional_id
       and b.starts_at < p_ends_at
       and b.ends_at > p_starts_at
  ) then
    return 'bloqueado';
  end if;

  select c.timezone into v_timezone
    from public.clinic c
   where c.id = p_clinic_id;
  v_timezone := coalesce(v_timezone, 'America/Fortaleza');

  select range_agg(
           tstzrange(
             (d.dia + s.starts_at) at time zone v_timezone,
             ((case when s.ends_at <= s.starts_at then d.dia + 1 else d.dia end)
               + s.ends_at) at time zone v_timezone
           )
         )
    into v_jornada
    from (
      -- A vespera entra por causa da janela que vira o dia.
      select g::date as dia
        from generate_series(
               ((p_starts_at at time zone v_timezone)::date - 1)::timestamp,
               ((p_ends_at at time zone v_timezone)::date)::timestamp,
               interval '1 day'
             ) g
    ) d
    join public.professional_schedule s
      on s.clinic_id = p_clinic_id
     and s.professional_id = p_professional_id
     and s.weekday = extract(dow from d.dia)::integer
     and (s.unit_id is null or p_unit_id is null or s.unit_id = p_unit_id);

  if v_jornada is null
     or not (v_jornada @> tstzrange(p_starts_at, p_ends_at)) then
    return 'fora_da_jornada';
  end if;

  if exists (
    select 1 from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.professional_id = p_professional_id
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < p_ends_at
       and a.ends_at > p_starts_at
  ) then
    return 'ocupado';
  end if;

  return null;
end;
$$;

revoke all on function public.vaga_de_espera_indisponivel(uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.vaga_de_espera_indisponivel(uuid, uuid, timestamptz, timestamptz, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Envios pendentes de uma oferta encerrada

-- Os envios da onda que ainda estao na fila (pendentes) morrem junto com a
-- oferta. O executor reconfere a oferta de qualquer jeito (o job que ja esta
-- executando nao e tocado aqui); isto so evita a passagem inutil.
create or replace function public.encerrar_envios_da_oferta(
  p_clinic_id uuid,
  p_offer_id uuid
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with encerrados as (
    update public.job_queue
       set status = 'cancelado',
           last_error = 'oferta_encerrada'
     where clinic_id = p_clinic_id
       and kind = 'enviar_mensagem_ativa'
       and status = 'pendente'
       and payload->>'offer_id' = p_offer_id::text
    returning 1
  )
  select count(*)::integer from encerrados;
$$;

revoke all on function public.encerrar_envios_da_oferta(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.encerrar_envios_da_oferta(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Gatilho do cancelamento respeita a escolha da recepcao

create or replace function public.oferecer_ao_cancelar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A recepcao escolheu nao oferecer este horario (medica doente, ferias,
  -- horario que ja foi passado a alguem por telefone).
  if not coalesce(new.oferecer_vaga_ao_cancelar, true) then
    return new;
  end if;
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

-- ---------------------------------------------------------------------------
-- 5. A oferta nasce com o offer_id em cada envio

create or replace function public.criar_oferta_de_espera(
  p_clinic_id uuid,
  p_source_appointment_id uuid,
  p_professional_id uuid,
  p_slot_starts_at timestamptz,
  p_slot_ends_at timestamptz,
  p_expires_at timestamptz,
  -- [{"contact_id": "...", "waitlist_id": "...", "body": "..."}]
  p_destinatarios jsonb
)
returns uuid
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
  -- consentimento e grava custo. O offer_id amarra cada envio a oferta: o
  -- executor so envia enquanto ela esta aberta, com folga de prazo e com a
  -- vaga livre (desconexao com retry, canal ocupado, cancelamento e vaga
  -- preenchida deixam de entregar oferta morta).
  insert into public.job_queue (clinic_id, kind, payload)
  select p_clinic_id,
         'enviar_mensagem_ativa',
         jsonb_build_object(
           'contact_id', d->>'contact_id',
           'body', d->>'body',
           'offer_id', v_offer_id
         )
    from jsonb_array_elements(p_destinatarios) d;

  return v_offer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. O aceite

create or replace function public.aceitar_oferta_de_espera(
  p_clinic_id uuid,
  p_offer_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oferta record;
  v_indice integer;
  v_entrada_id uuid;
  v_entrada_ativa uuid;
  v_procedimento uuid;
  v_procedimento_da_vaga uuid;
  v_unidade uuid;
  v_convenio uuid;
  v_vinculo uuid;
  v_duracao integer;
  v_recurso uuid;
  v_fim timestamptz;
  v_motivo text;
  v_restricao text;
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

  -- A entrada que o JOB casou com esta vaga, pela posicao no array.
  -- Variaveis escalares de proposito: campo de record nunca atribuido e
  -- erro em plpgsql ("record is not assigned yet").
  v_indice := array_position(v_oferta.offered_to, p_contact_id);
  if v_indice is not null
     and coalesce(array_length(v_oferta.matched_waitlist_ids, 1), 0) >= v_indice
  then
    v_entrada_id := v_oferta.matched_waitlist_ids[v_indice];
  end if;
  if v_entrada_id is not null then
    select w.id, w.procedure_id into v_entrada_ativa, v_procedimento
      from public.waitlist w
     where w.id = v_entrada_id
       and w.clinic_id = p_clinic_id
       and w.active;
  end if;

  -- Fallback para ofertas criadas antes de matched_waitlist_ids (ou entrada
  -- que saiu da fila no meio tempo): a heuristica antiga, com o
  -- procedimento atendido pelo profissional na frente.
  if v_entrada_ativa is null then
    select w.id, w.procedure_id into v_entrada_ativa, v_procedimento
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
       w.priority, w.created_at, w.id
     limit 1;
  end if;

  -- Entrada "qualquer procedimento" herda o PROCEDIMENTO da consulta
  -- cancelada; a unidade tambem vem dela (o horario e o mesmo).
  select sl.procedure_id, a.unit_id
    into v_procedimento_da_vaga, v_unidade
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id
   where a.id = v_oferta.source_appointment_id
     and a.clinic_id = p_clinic_id;
  v_procedimento := coalesce(v_procedimento, v_procedimento_da_vaga);

  -- O vinculo pelo CONVENIO DO CONTATO, senao o particular. Ordem explicita:
  -- service_link e unico por (profissional, procedimento, convenio), entao
  -- ha no maximo um de cada e o convenio vem na frente.
  select c.insurance_id into v_convenio
    from public.contact c
   where c.id = p_contact_id
     and c.clinic_id = p_clinic_id;
  if v_procedimento is not null then
    select sl.id, sl.duration_min, pr.resource_id
      into v_vinculo, v_duracao, v_recurso
      from public.service_link sl
      join public.procedure pr
        on pr.id = sl.procedure_id
       and pr.clinic_id = sl.clinic_id
     where sl.clinic_id = p_clinic_id
       and sl.professional_id = v_oferta.professional_id
       and sl.procedure_id = v_procedimento
       and sl.active
       and pr.active
       and (sl.insurance_id is null or sl.insurance_id = v_convenio)
     order by (sl.insurance_id is not null) desc, sl.id
     limit 1;
  end if;
  if v_vinculo is null then
    -- O catalogo mudou depois da onda: esta pessoa nao tem como ser
    -- agendada aqui. A oferta segue aberta para o resto da onda.
    return jsonb_build_object('ok', false, 'erro', 'sem_vinculo');
  end if;

  v_fim := v_oferta.slot_starts_at + make_interval(mins => v_duracao);
  if v_fim > v_oferta.slot_ends_at then
    return jsonb_build_object('ok', false, 'erro', 'nao_cabe');
  end if;

  -- A vaga ainda existe? Bloqueio criado depois da onda, profissional
  -- desativado, jornada mudada ou horario ocupado (inclusive encaixe): a
  -- oferta morre com honestidade.
  v_motivo := public.vaga_de_espera_indisponivel(
    p_clinic_id, v_oferta.professional_id,
    v_oferta.slot_starts_at, v_fim, v_unidade
  );
  if v_motivo is not null then
    update public.waitlist_offer
       set status = 'cancelada'
     where id = p_offer_id;
    perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);
    return jsonb_build_object(
      'ok', false, 'erro', 'horario_ocupado', 'motivo', v_motivo
    );
  end if;

  -- A trava REAL contra corrida com marcacao manual continua sendo a
  -- exclusion constraint.
  begin
    insert into public.appointment (
      clinic_id, unit_id, contact_id, professional_id, service_link_id,
      resource_id, starts_at, ends_at, status, created_by, source
    )
    values (
      p_clinic_id, v_unidade, p_contact_id, v_oferta.professional_id,
      v_vinculo, v_recurso, v_oferta.slot_starts_at, v_fim,
      'agendado', 'sistema', 'interna'
    )
    returning id into v_appointment;
  exception when exclusion_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'sem_sobreposicao_recurso' then
      -- So a SALA/EQUIPAMENTO do procedimento desta pessoa esta ocupado: o
      -- horario do profissional continua livre para o resto da onda.
      return jsonb_build_object(
        'ok', false, 'erro', 'horario_ocupado', 'motivo', 'recurso_ocupado'
      );
    end if;
    update public.waitlist_offer
       set status = 'cancelada'
     where id = p_offer_id;
    perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);
    return jsonb_build_object(
      'ok', false, 'erro', 'horario_ocupado', 'motivo', 'ocupado'
    );
  end;

  update public.waitlist_offer
     set status = 'preenchida',
         responded_by = p_contact_id,
         responded_at = now(),
         appointment_id = v_appointment
   where id = p_offer_id;
  -- Quem ainda nao recebeu a mensagem nao recebe mais.
  perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);

  -- O vencedor sai da fila (a entrada que casou; active=false, nunca delete).
  if v_entrada_ativa is not null then
    update public.waitlist set active = false where id = v_entrada_ativa;
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
-- 7. A expiracao tambem encerra os envios que ficaram na fila

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
  ),
  envios_encerrados as (
    update public.job_queue j
       set status = 'cancelado',
           last_error = 'oferta_encerrada'
      from vencidas v
     where j.clinic_id = v.clinic_id
       and j.kind = 'enviar_mensagem_ativa'
       and j.status = 'pendente'
       and j.payload->>'offer_id' = v.id::text
    returning 1
  )
  select count(*)::integer from vencidas;
$$;

-- ---------------------------------------------------------------------------
-- 8. Cancelar a reoferta pela tela

-- O botao "Cancelar reoferta" passa por aqui: a oferta aberta vira
-- cancelada e os envios dela que ainda estao na fila morrem junto (a sessao
-- nao escreve em job_queue). O papel e conferido aqui dentro, com a mesma
-- matriz das policies da fila.
create or replace function public.cancelar_reoferta_de_espera(
  p_clinic_id uuid,
  p_offer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.user_has_role(
    p_clinic_id, array['admin', 'gestor', 'recepcao']
  ) then
    raise exception 'Seu perfil não cancela a reoferta.'
      using errcode = '42501';
  end if;

  update public.waitlist_offer
     set status = 'cancelada'
   where id = p_offer_id
     and clinic_id = p_clinic_id
     and status = 'aberta'
  returning id into v_id;
  if v_id is null then
    return false;
  end if;

  perform public.encerrar_envios_da_oferta(p_clinic_id, p_offer_id);
  return true;
end;
$$;

revoke all on function public.cancelar_reoferta_de_espera(uuid, uuid)
  from public, anon;
grant execute on function public.cancelar_reoferta_de_espera(uuid, uuid)
  to authenticated, service_role;

-- As versoes redefinidas acima mantem as permissoes da migration original
-- (create or replace preserva grants), reafirmadas aqui por clareza.
revoke all on function public.criar_oferta_de_espera(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.criar_oferta_de_espera(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, jsonb)
  to service_role;
revoke all on function public.aceitar_oferta_de_espera(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.aceitar_oferta_de_espera(uuid, uuid, uuid, uuid)
  to service_role;
revoke all on function public.expirar_ofertas_de_espera()
  from public, anon, authenticated;
grant execute on function public.expirar_ofertas_de_espera()
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. Policies pela matriz (admin, gestor e recepcao escrevem)

drop policy if exists "quem escreve gerencia a fila" on public.waitlist;
drop policy if exists "quem escreve edita a fila" on public.waitlist;
drop policy if exists "recepcao e gestao gerenciam a fila" on public.waitlist;
drop policy if exists "recepcao e gestao editam a fila" on public.waitlist;

create policy "recepcao e gestao gerenciam a fila" on public.waitlist
  for insert
  with check (public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));
-- Vale tambem para mover_na_lista_de_espera (SECURITY INVOKER): o SELECT
-- ... FOR UPDATE dela so enxerga linha que passa por este USING, entao
-- profissional e leitura recebem "Entrada nao encontrada".
create policy "recepcao e gestao editam a fila" on public.waitlist
  for update
  using (public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

drop policy if exists "quem escreve cancela a reoferta" on public.waitlist_offer;
drop policy if exists "recepcao e gestao cancelam a reoferta" on public.waitlist_offer;

-- Sessao so leva oferta ABERTA para CANCELADA: reabrir, preencher, mudar
-- destinatarios ou prazo nao passa. O caminho da tela e a RPC acima; esta
-- policy fica como a unica porta de UPDATE direto e ja no formato certo.
create policy "recepcao e gestao cancelam a reoferta" on public.waitlist_offer
  for update
  using (
    status = 'aberta'
    and public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao'])
  )
  with check (
    status = 'cancelada'
    and public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao'])
  );

-- E so a coluna status: sem isto, o mesmo UPDATE que cancela poderia mudar
-- offered_to, expires_at ou responded_by junto.
revoke update on public.waitlist_offer from anon, authenticated;
grant update (status) on public.waitlist_offer to authenticated;
