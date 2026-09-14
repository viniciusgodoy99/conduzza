-- Fase 3 da tarefa 4.8 (follow-up de leads), parte 2: o MOTOR.
--
-- Regua kind='followup' por ETAPA da jornada configuravel: trigger_stage
-- guarda a chave da etapa, o planner materializa "ancora + offset" e as
-- paradas da spec 7.2 sao ESTRUTURAIS, sem tabela nova:
-- - sair da etapa (agendou, perdido, qualquer movimento) tira o contato do
--   recorte do join (c.trigger_stage = ct.funnel_stage);
-- - responder e last_contact_at > funnel_stage_changed_at (so a ingestao de
--   mensagem recebida escreve last_contact_at).
--
-- Uma regua por etapa (indice unico proprio): o planner fica deterministico
-- sem lateral novo. Excecao por procedimento/reforco nao se aplica a
-- followup (checks abaixo).

-- 1. Integridade do kind novo.
alter table public.cadence
  add constraint followup_exige_etapa
  check ((kind = 'followup') = (trigger_stage is not null));
alter table public.cadence
  add constraint followup_sem_excecao
  check (kind <> 'followup' or (procedure_id is null and not for_no_show_history));

-- 2. Unicidade: a chave geral passa a ignorar followup; followup tem a sua.
drop index public.cadence_configuracao_unica;
create unique index cadence_configuracao_unica on public.cadence
  using btree (
    clinic_id, kind,
    coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid),
    for_no_show_history
  )
  where kind <> 'followup';
create unique index cadence_followup_unico_por_etapa on public.cadence
  (clinic_id, trigger_stage)
  where kind = 'followup';

-- 3. Etapa com regua de follow-up nao se exclui (falha alta, padrao da casa;
--    o join do planner com funnel_stage_def e a defesa em profundidade).
create or replace function public.proteger_jornada()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.chave is distinct from old.chave then
      raise exception 'A chave de uma etapa não muda. Renomeie o nome da etapa.';
    end if;
    if new.papel is distinct from old.papel then
      raise exception 'O papel de sistema de uma etapa não muda.';
    end if;
    return new;
  end if;
  -- DELETE. Se a CLINICA inteira esta sendo apagada, o cascade manda: as
  -- protecoes abaixo valem para apagar UMA etapa, nao para desmontar a
  -- clinica (sem isto, nenhuma clinica conseguiria ser excluida, e todo
  -- afterAll de teste quebraria).
  if not exists (select 1 from public.clinic where id = old.clinic_id) then
    return old;
  end if;
  if old.papel is not null then
    raise exception 'Etapa de sistema não pode ser excluída. Renomeie ou reordene.';
  end if;
  if exists (
    select 1 from public.contact
     where clinic_id = old.clinic_id and funnel_stage = old.chave
  ) then
    raise exception 'Mova os contatos desta etapa antes de excluí-la.';
  end if;
  if exists (
    select 1 from public.cadence
     where clinic_id = old.clinic_id
       and kind = 'followup'
       and trigger_stage = old.chave
  ) then
    raise exception 'Exclua a régua de follow-up desta etapa antes de excluí-la.';
  end if;
  return old;
end;
$$;

-- 4. O terceiro CTE do planner: follow-up ancorado na entrada da etapa.
create or replace function public.planejar_reguas()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_confirmacao integer := 0;
  v_pos_falta integer := 0;
  v_followup integer := 0;
begin
  -- Confirmacao: eixo em appointment.starts_at.
  with devidas as (
    select
      a.clinic_id,
      s.id as step_id,
      a.contact_id,
      a.id as appointment_id,
      a.starts_at + make_interval(mins => s.offset_minutes) as scheduled_for
    from appointment a
    join contact ct on ct.id = a.contact_id
    join lateral (
      select c.*
      from cadence c
      where c.clinic_id = a.clinic_id
        and c.kind = 'confirmacao'
        and c.active
        and (
          c.procedure_id is null
          or c.procedure_id = (
            select sl.procedure_id from service_link sl
            where sl.id = a.service_link_id
          )
        )
        and (not c.for_no_show_history or ct.no_show_count >= c.no_show_threshold)
      order by (c.procedure_id is not null) desc, c.for_no_show_history desc
      limit 1
    ) c on true
    join cadence_step s on s.cadence_id = c.id
    where a.send_confirmation
      and a.status in ('agendado', 'aguardando_confirmacao')
      and a.starts_at > now()
      and a.starts_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (clinic_id, kind, payload, run_at)
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now())
    from novas
    returning 1
  )
  select count(*)::integer into v_confirmacao from jobs;

  -- Pos falta: eixo no instante em que a falta foi marcada.
  with faltas as (
    select
      a.clinic_id,
      a.contact_id,
      a.id as appointment_id,
      (
        select max(h.changed_at)
        from appointment_status_history h
        where h.appointment_id = a.id and h.status = 'faltou'
      ) as marcada_em
    from appointment a
    where a.status = 'faltou'
      and a.starts_at > now() - interval '30 days'
  ),
  devidas as (
    select
      f.clinic_id,
      s.id as step_id,
      f.contact_id,
      f.appointment_id,
      f.marcada_em + make_interval(mins => s.offset_minutes) as scheduled_for
    from faltas f
    join lateral (
      select c.* from cadence c
      where c.clinic_id = f.clinic_id and c.kind = 'pos_falta' and c.active
      limit 1
    ) c on true
    join cadence_step s on s.cadence_id = c.id
    where f.marcada_em is not null
      and f.marcada_em + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (clinic_id, kind, payload, run_at)
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now())
    from novas
    returning 1
  )
  select count(*)::integer into v_pos_falta from jobs;

  -- Follow-up: eixo na entrada da etapa (funnel_stage_changed_at).
  -- O contato so esta no recorte enquanto CONTINUA na etapa da regua e sem
  -- resposta desde que entrou: sair ou responder e a parada da spec 7.2. O
  -- join com funnel_stage_def descarta regua orfa de etapa excluida (defesa
  -- em profundidade; o gatilho da jornada ja impede a exclusao).
  with devidas as (
    select
      ct.clinic_id,
      s.id as step_id,
      ct.id as contact_id,
      ct.funnel_stage_changed_at
        + make_interval(mins => s.offset_minutes) as scheduled_for
    from contact ct
    join cadence c
      on c.clinic_id = ct.clinic_id
     and c.kind = 'followup'
     and c.active
     and c.trigger_stage = ct.funnel_stage
    join funnel_stage_def d
      on d.clinic_id = ct.clinic_id and d.chave = ct.funnel_stage
    join cadence_step s on s.cadence_id = c.id
    where s.offset_minutes > 0
      and (ct.last_contact_at is null
           or ct.last_contact_at <= ct.funnel_stage_changed_at)
      and ct.funnel_stage_changed_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, null, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (clinic_id, kind, payload, run_at)
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now())
    from novas
    returning 1
  )
  select count(*)::integer into v_followup from jobs;

  return jsonb_build_object(
    'confirmacao', v_confirmacao,
    'pos_falta', v_pos_falta,
    'followup', v_followup
  );
end;
$$;
