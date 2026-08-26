-- Correcoes da revisao adversarial das proprias correcoes do motor de reguas.
-- Duas mudancas de schema, cada uma fechando uma familia inteira de defeitos.
--
-- ---------------------------------------------------------------------------
-- 1. A chave de nao duplicacao passa a incluir a consulta
-- ---------------------------------------------------------------------------
-- A chave era (cadence_step_id, contact_id, scheduled_for). Ela cumpre o papel
-- para a regua automatica, onde scheduled_for sai de appointment.starts_at e
-- portanto ja e diferente para consultas diferentes. Mas o toque MANUAL usa o
-- minuto corrente como scheduled_for, e ai duas consultas do mesmo paciente no
-- mesmo passo colidem: a segunda some em silencio, com a recepcao vendo
-- "cobrado". A correcao anterior desempatava por POSICAO na lista, o que
-- resolvia o clique unico e quebrava o clique repetido (a mesma consulta ganha
-- posicao diferente em selecoes diferentes, e vira uma cobranca duplicada ou
-- uma cobranca perdida, dependendo da ordem que o Postgres devolveu).
--
-- Com appointment_id na chave, a identidade do toque e o que ela sempre
-- deveria ter sido: este passo, para esta pessoa, sobre ESTA consulta, neste
-- instante. Clicar duas vezes na mesma consulta continua criando uma run so, e
-- consultas diferentes nunca mais se atropelam.
--
-- nulls not distinct (Postgres 15+) preserva a trava para regua sem consulta
-- (appointment_id nulo): dois nulos contam como iguais, entao o
-- on conflict do nothing continua valendo.

alter table public.cadence_run
  drop constraint cadence_run_cadence_step_id_contact_id_scheduled_for_key;

alter table public.cadence_run
  add constraint cadence_run_passo_contato_consulta_horario_key
  unique nulls not distinct
  (cadence_step_id, contact_id, appointment_id, scheduled_for);

-- ---------------------------------------------------------------------------
-- 2. "Esperando resposta" deixa de ser adivinhado
-- ---------------------------------------------------------------------------
-- O contador de Atendimento precisava responder "quantas conversas esperam uma
-- pessoa da clinica?". Ele contava status = 'aguardando_humano', e a regua abre
-- conversa nesse status para enviar a confirmacao: numa manha de 40 disparos o
-- contador mostrava 40 e a mensagem de paciente de verdade ficava enterrada.
--
-- Trocar por unread_count > 0 corrigia isso e criava outro buraco: abrir a
-- conversa para LER zera unread_count, entao a recepcionista que leu e saiu
-- para atender o balcao perdia o lembrete de que ninguem respondeu.
--
-- Nenhuma das duas colunas responde a pergunta, porque a pergunta e sobre a
-- ULTIMA mensagem: veio do paciente e ninguem respondeu ainda? Agora existe
-- uma coluna que guarda exatamente isso. Ela sobe quando o paciente escreve e
-- so desce quando um HUMANO responde: resposta automatica da regua nao apaga
-- pergunta de paciente.

alter table public.conversation
  add column if not exists awaiting_reply boolean not null default false;

comment on column public.conversation.awaiting_reply is
  'A ultima mensagem veio do paciente e nenhuma pessoa da clinica respondeu. Sobe em ingest_inbound_message, desce so em envio com author usuario. Nao confundir com unread_count, que e "por ler" e zera ao abrir.';

create index if not exists conversation_esperando_resposta_idx
  on public.conversation (clinic_id)
  where awaiting_reply;

-- Backfill: quem tem mensagem por ler tem, por construcao, mensagem de
-- paciente sem resposta. E a melhor aproximacao disponivel para o passado.
update public.conversation
   set awaiting_reply = true
 where unread_count > 0
   and status <> 'resolvida';

-- ---------------------------------------------------------------------------
-- 3. ingest_inbound_message v4: marca a espera
-- ---------------------------------------------------------------------------
-- Igual a v3 (migration 20260825140000), com uma linha a mais no update da
-- conversa. Reescrita inteira de proposito: a funcao e a fronteira do webhook
-- e ler a versao vigente num arquivo so vale mais que economizar linhas.

create or replace function public.ingest_inbound_message(
  p_clinic_id uuid,
  p_phone_e164 text,
  p_name text,
  p_wa_message_id text,
  p_content_type text default 'texto',
  p_body text default null,
  p_media_url text default null,
  p_transcript text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_contact_created boolean;
  v_conversation_id uuid;
  v_message_id uuid;
begin
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict (clinic_id, phone_e164) do update
    set last_contact_at = now(),
        name = coalesce(contact.name, excluded.name)
  returning id, (xmax = 0) into v_contact_id, v_contact_created;

  -- Consentimento automatico source='conversa' SO na primeira relacao do
  -- contato com o canal: qualquer linha anterior (ativa OU revogada) impede o
  -- insert. Revogou, so reconsentimento explicito com evidencia reabre.
  if not exists (
    select 1 from contact_consent
    where clinic_id = p_clinic_id
      and contact_id = v_contact_id
      and channel = 'whatsapp'
  ) then
    insert into contact_consent (clinic_id, contact_id, channel, source, evidence)
    values (p_clinic_id, v_contact_id, 'whatsapp', 'conversa',
            'Primeira mensagem recebida do contato');
  end if;

  -- Uma conversa aberta por contato; corrida resolvida pelo indice unico parcial.
  insert into conversation (clinic_id, contact_id, status, last_message_at)
  values (p_clinic_id, v_contact_id, 'aguardando_humano', now())
  on conflict (clinic_id, contact_id) where status <> 'resolvida' do nothing;

  select id into v_conversation_id
  from conversation
  where clinic_id = p_clinic_id and contact_id = v_contact_id
    and status <> 'resolvida'
  limit 1;

  insert into message (
    clinic_id, conversation_id, wa_message_id, direction, author,
    content_type, body, media_url, transcript, billable, cost_cents
  ) values (
    p_clinic_id, v_conversation_id, p_wa_message_id, 'entrada', 'paciente',
    coalesce(p_content_type, 'texto'), p_body, p_media_url, p_transcript,
    false, 0
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    update conversation
      set last_message_at = now(),
          unread_count = unread_count + 1,
          awaiting_reply = true
      where id = v_conversation_id;
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'contact_created', coalesce(v_contact_created, false),
    'conversation_id', v_conversation_id,
    'message_id', v_message_id
  );
end;
$$;

-- Os grants da v3 seguem valendo: create or replace nao os derruba.


-- ---------------------------------------------------------------------------
-- 4. planejar_reguas: o alvo do on conflict acompanha a chave nova
-- ---------------------------------------------------------------------------
-- Sem isto a RPC quebraria em execucao ("there is no unique or exclusion
-- constraint matching the ON CONFLICT specification") e a regua inteira pararia
-- de planejar. O corpo e o mesmo da migration 20260826100000, com os dois
-- alvos atualizados.

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

  return jsonb_build_object(
    'confirmacao', v_confirmacao,
    'pos_falta', v_pos_falta
  );
end;
$$;
