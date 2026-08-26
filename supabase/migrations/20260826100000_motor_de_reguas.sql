-- Fase 4, tarefas 4.6 (motor de reguas) e 4.7 (confirmacao de consulta).
--
-- A regua e uma sequencia de mensagens disparada em momentos definidos: 72h,
-- 24h e 3h antes da consulta (premissa declarada na propria spec 8.1), e D+0
-- e D+2 depois de uma falta. O paciente responde e o status muda sozinho na
-- agenda.
--
-- Decisoes do dono em 25/08/2026:
--   1. Sem modo de ensaio: a regua nasce DESLIGADA e so envia quando alguem a
--      ativa conscientemente.
--   2. A CLINICA configura a janela de envio. Nenhum horario e fixado no
--      codigo: a regua nao pode ser ativada sem janela e dias preenchidos (o
--      check active_exige_janela). Isso honra a decisao sem inventar numero e
--      sem deixar a regua mandar mensagem as 23h (spec 7.4).
--
-- A trava de nao duplicacao vive em cadence_run (unique da tripla) e nasce na
-- MESMA transacao do job: dois planners rodando juntos nao geram dois envios.

-- ---------------------------------------------------------------------------
-- 1. Reguas
-- ---------------------------------------------------------------------------

create table public.cadence (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  kind text not null check (kind in
    ('confirmacao', 'followup', 'pos_falta', 'reativacao', 'lista_espera')),
  name text not null,
  trigger_stage text,                     -- followup (tarefa 4.8)
  procedure_id uuid references public.procedure (id) on delete cascade,
  for_no_show_history boolean not null default false,
  -- Mesmo limiar da etiqueta de risco da ficha (spec 6.4): duas faltas.
  no_show_threshold integer not null default 2 check (no_show_threshold >= 1),
  -- Janela de envio, no fuso da clinica. Nula de proposito: a clinica informa.
  send_window_start time,
  send_window_end time,
  send_weekdays smallint[],
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A regua so liga com janela definida: e o que impede mensagem as 23h sem
  -- inventar horario padrao no codigo.
  constraint active_exige_janela check (
    not active or (
      send_window_start is not null
      and send_window_end is not null
      and send_weekdays is not null
      and array_length(send_weekdays, 1) > 0
    )
  ),
  constraint janela_coerente check (
    send_window_start is null
    or send_window_end is null
    or send_window_end > send_window_start
  )
);

-- No maximo UMA regua por combinacao: o planner sempre sabe qual aplicar.
create unique index cadence_configuracao_unica on public.cadence (
  clinic_id, kind,
  coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid),
  for_no_show_history
);
create index on public.cadence (clinic_id) where active;
create index on public.cadence (procedure_id);

create trigger set_updated_at before update on public.cadence
  for each row execute function public.set_updated_at();

create table public.cadence_step (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  cadence_id uuid not null references public.cadence (id) on delete cascade,
  -- Negativo = antes do evento. O evento e sempre appointment.starts_at na
  -- confirmacao, e o instante da marcacao de falta no pos_falta.
  offset_minutes integer not null,
  -- A Fase 3 (agente de IA) foi adiada. Texto de LLM sem o filtro de
  -- conformidade violaria a regra 3.2 do CLAUDE.md, entao o banco recusa.
  use_ai boolean not null default false check (use_ai = false),
  template_id uuid references public.message_template (id) on delete set null,
  fixed_body text,
  stop_conditions text[] not null default '{respondeu,agendou,perdido}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cadence_id, offset_minutes)
);

create index on public.cadence_step (clinic_id);
create index on public.cadence_step (template_id);

create trigger set_updated_at before update on public.cadence_step
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Execucoes
-- ---------------------------------------------------------------------------
-- O unique da tripla e A TRAVA de nao duplicacao (docs/03 secao 5: chave
-- natural contact_id + step_id + scheduled_for). A linha nasce ANTES do job e
-- na mesma transacao, entao dois planners concorrentes nao geram dois envios.

create table public.cadence_run (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  cadence_step_id uuid not null references public.cadence_step (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  appointment_id uuid references public.appointment (id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  skipped_reason text check (skipped_reason in (
    'sem_consentimento', 'fora_janela', 'condicao_parada',
    'falha_envio', 'desconectado', 'teto_gasto')),
  message_id uuid references public.message (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cadence_step_id, contact_id, scheduled_for)
);

create index on public.cadence_run (scheduled_for) where sent_at is null;
create index on public.cadence_run (clinic_id, contact_id, sent_at desc);
create index on public.cadence_run (appointment_id);
create index on public.cadence_run (contact_id);
create index on public.cadence_run (message_id);

create trigger set_updated_at before update on public.cadence_run
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Fila: o toque de regua vira job
-- ---------------------------------------------------------------------------

alter table public.job_queue drop constraint job_queue_kind_check;
alter table public.job_queue add constraint job_queue_kind_check
  check (kind in (
    'enviar_mensagem_ativa', 'baixar_midia', 'executar_passo_de_regua'));

-- ---------------------------------------------------------------------------
-- 4. Correcao: conversa de regua nascia em limbo
-- ---------------------------------------------------------------------------
-- garantir_conversa_aberta criava a conversa como 'ia_atendendo', mas o agente
-- de IA foi adiado. Toda conversa aberta por disparo aparecia no Inbox com o
-- compositor BLOQUEADO ("A IA esta atendendo") e ficava assim para sempre:
-- nem a resposta do paciente muda esse status (ingest_inbound_message usa
-- on conflict do nothing). Nasce aguardando_humano, como o ingest ja faz.

create or replace function public.garantir_conversa_aberta(
  p_clinic_id uuid,
  p_contact_id uuid
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  insert into conversation (clinic_id, contact_id, status, last_message_at)
  values (p_clinic_id, p_contact_id, 'aguardando_humano', now())
  on conflict (clinic_id, contact_id) where status <> 'resolvida' do nothing;

  select id into v_conversation_id
  from conversation
  where clinic_id = p_clinic_id and contact_id = p_contact_id
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
-- 5. Reagendar job sem queimar tentativa
-- ---------------------------------------------------------------------------
-- Fora da janela de envio nao e falha: e "ainda nao". falhar_job nao serve
-- (queima tentativa e limita o adiamento a 10 minutos, entao um toque fora da
-- janela morreria em 5 passagens). Guardado pela posse, como as demais.

create or replace function public.reagendar_job(
  p_id uuid,
  p_worker text,
  p_run_at timestamptz
) returns boolean
language sql
set search_path = public
as $$
  update job_queue
     set status = 'pendente',
         run_at = p_run_at,
         locked_by = null,
         locked_at = null,
         attempts = greatest(attempts - 1, 0)
   where id = p_id
     and status = 'executando'
     and locked_by = p_worker
  returning true
$$;

revoke execute on function public.reagendar_job(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reagendar_job(uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Mudancas de status que a regua e o paciente provocam
-- ---------------------------------------------------------------------------
-- A policy de insert do historico exige changed_by_user_id = auth.uid(), e no
-- webhook nao existe usuario. Por isso estas tres funcoes tem privilegio
-- proprio: e o caminho que o comment da tabela ja previa ("RPC de confirmacao
-- do paciente"). Todas fazem update CONDICIONAL no status atual, entao corrida
-- perde educadamente (0 linhas = ja tratado).

create or replace function public.marcar_aguardando_confirmacao(
  p_clinic_id uuid,
  p_appointment_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update appointment
     set status = 'aguardando_confirmacao'
   where id = p_appointment_id
     and clinic_id = p_clinic_id
     and status = 'agendado'
   returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    p_clinic_id, p_appointment_id, 'aguardando_confirmacao', null, 'sistema'
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- Confirmacao pelo paciente. Aceita tambem a partir de 'agendado' para cobrir
-- a corrida rara em que a mensagem saiu mas o status ainda nao tinha virado:
-- a intencao do paciente e inequivoca. confirmed_by_user_id fica NULO de
-- proposito (e FK para auth.users e paciente nao e usuario): a autoria vive no
-- status confirmado_paciente e na trilha com changed_by 'paciente'.
create or replace function public.confirmar_pelo_paciente(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update appointment
     set status = 'confirmado_paciente',
         confirmation_channel = 'whatsapp'
   where id = p_appointment_id
     and clinic_id = p_clinic_id
     and contact_id = p_contact_id
     and status in ('agendado', 'aguardando_confirmacao')
     and starts_at > now()
   returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    p_clinic_id, p_appointment_id, 'confirmado_paciente', null, 'paciente'
  );

  if p_conversation_id is not null then
    insert into message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'O paciente confirmou a consulta pelo WhatsApp.', false, 0
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancelar_pelo_paciente(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update appointment
     set status = 'cancelado_paciente'
   where id = p_appointment_id
     and clinic_id = p_clinic_id
     and contact_id = p_contact_id
     and status in ('agendado', 'aguardando_confirmacao',
                    'confirmado_paciente', 'confirmado_recepcao')
     and starts_at > now()
   returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'ja_tratado');
  end if;

  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    p_clinic_id, p_appointment_id, 'cancelado_paciente', null, 'paciente'
  );

  if p_conversation_id is not null then
    insert into message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'O paciente cancelou a consulta pelo WhatsApp.', false, 0
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.marcar_aguardando_confirmacao(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.marcar_aguardando_confirmacao(uuid, uuid)
  to service_role;
revoke execute on function public.confirmar_pelo_paciente(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirmar_pelo_paciente(uuid, uuid, uuid, uuid)
  to service_role;
revoke execute on function public.cancelar_pelo_paciente(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancelar_pelo_paciente(uuid, uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Planner: materializa os toques devidos e enfileira, numa transacao so
-- ---------------------------------------------------------------------------
-- Horizonte curto de proposito: so nasce o que vence entre 30 minutos atras e
-- 60 minutos a frente. Consulta marcada em cima da hora nao leva a rajada dos
-- tres toques de uma vez, e remarcacao nao deixa run velha pendurada (a chave
-- muda junto com starts_at).
--
-- Regua mais especifica vence: excecao por procedimento, depois reforcada por
-- historico de falta, depois a padrao.

create or replace function public.planejar_reguas()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_confirmacao integer := 0;
  v_pos_falta integer := 0;
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
    on conflict (cadence_step_id, contact_id, scheduled_for) do nothing
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
    on conflict (cadence_step_id, contact_id, scheduled_for) do nothing
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

  return jsonb_build_object(
    'confirmacao', v_confirmacao,
    'pos_falta', v_pos_falta
  );
end;
$$;

revoke execute on function public.planejar_reguas() from public, anon, authenticated;
grant execute on function public.planejar_reguas() to service_role;

-- ---------------------------------------------------------------------------
-- 8. Reguas padrao: nascem DESLIGADAS e SEM janela
-- ---------------------------------------------------------------------------
-- Os tres toques (72h, 24h, 3h) sao a premissa declarada na spec 8.1. A janela
-- fica nula: a clinica preenche na tela antes de conseguir ativar (o check
-- active_exige_janela recusa ligar sem ela).

create or replace function public.seed_reguas_padrao(p_clinic_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_confirmacao uuid;
  v_pos_falta uuid;
begin
  insert into cadence (clinic_id, kind, name, active)
  values (p_clinic_id, 'confirmacao', 'Confirmação de consulta', false)
  on conflict do nothing
  returning id into v_confirmacao;

  if v_confirmacao is not null then
    insert into cadence_step (clinic_id, cadence_id, offset_minutes, fixed_body)
    values
      (p_clinic_id, v_confirmacao, -4320,
       'Olá, {{nome}}! Aqui é da {{clinica}}. Sua consulta de {{procedimento}} com {{profissional}} está marcada para {{data}} às {{hora}}. Podemos confirmar sua presença?'),
      (p_clinic_id, v_confirmacao, -1440,
       'Oi, {{nome}}! Amanhã, {{data}} às {{hora}}, você tem {{procedimento}} com {{profissional}}.
{{preparo}}
Podemos confirmar sua presença?'),
      (p_clinic_id, v_confirmacao, -180,
       '{{nome}}, sua consulta é hoje às {{hora}} com {{profissional}}. Está tudo certo para você vir?');
  end if;

  insert into cadence (clinic_id, kind, name, active)
  values (p_clinic_id, 'pos_falta', 'Recuperação depois da falta', false)
  on conflict do nothing
  returning id into v_pos_falta;

  if v_pos_falta is not null then
    insert into cadence_step (clinic_id, cadence_id, offset_minutes, fixed_body)
    values
      (p_clinic_id, v_pos_falta, 0,
       'Oi, {{nome}}. Sentimos sua falta hoje na {{clinica}}. Aconteceu algum imprevisto? Se quiser remarcar, é só responder esta mensagem.'),
      (p_clinic_id, v_pos_falta, 2880,
       'Olá, {{nome}}! Ainda dá tempo de remarcar seu {{procedimento}}. Quer que a gente encontre um novo horário para você?');
  end if;
end;
$$;

create or replace function public.seed_reguas_da_clinica_nova()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.seed_reguas_padrao(new.id);
  return new;
end;
$$;

create trigger seed_reguas_da_clinica_nova
  after insert on public.clinic
  for each row execute function public.seed_reguas_da_clinica_nova();

-- Clinicas que ja existem ganham as reguas padrao, tambem desligadas.
do $$
declare
  v_clinic record;
begin
  for v_clinic in select id from clinic loop
    perform public.seed_reguas_padrao(v_clinic.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------
-- Regua e configuracao: admin e gestor escrevem (mesmo recorte de Automacoes
-- na matriz). cadence_run e registro do sistema: ninguem escreve pela sessao.

alter table public.cadence enable row level security;
alter table public.cadence_step enable row level security;
alter table public.cadence_run enable row level security;

create policy "membro ativo le reguas" on public.cadence
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "gestao escreve reguas" on public.cadence
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le passos" on public.cadence_step
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "gestao escreve passos" on public.cadence_step
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le execucoes" on public.cadence_run
  for select using (clinic_id in (select public.user_active_clinic_ids()));
-- Sem policy de escrita: quem grava e o worker, por service role.
