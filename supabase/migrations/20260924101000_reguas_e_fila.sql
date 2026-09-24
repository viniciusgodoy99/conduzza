-- Reguas e fila (revisao de liberacao de 24/09/2026, grupo reguas-e-fila).
--
-- Seis mudancas, todas aditivas ou redefinicao de funcao que so este grupo
-- mexe:
--
--   1. Motivos novos de toque pulado: 'consulta_remarcada', 'remarcacao_pedida'
--      e 'toque_atrasado'. Sao CONTRATO com os grupos da agenda e do
--      interceptador de resposta.
--   2. appointment.remarcacao_pedida_em: o paciente pediu para remarcar (o
--      interceptador grava e limpa). Enquanto estiver preenchida, a regua de
--      confirmacao nao pergunta "podemos confirmar?" para essa consulta.
--   3. job_queue.prioridade: 0 = resposta ao paciente, confirmacao, pos falta,
--      oferta de espera, toque manual; 1 = follow-up. O claim ordena por
--      prioridade e depois por run_at: uma rajada de follow-up nunca fica na
--      frente de um toque de confirmacao vencido.
--   4. whatsapp_account.next_bulk_send_at: o slot anti-ban dos envios
--      AUTOMATICOS, separado do next_send_at, que passa a guardar so o
--      intervalo curto desde o ultimo envio real. A resposta digitada pela
--      recepcao no Inbox respeita so o intervalo curto e nunca espera a fila
--      das mensagens automaticas (decisao do dono de 24/09/2026: atendimento
--      primeiro).
--   5. contact.criado_por_importacao: contato que nasce pela planilha NAO
--      entra no follow-up da etapa em que nasceu. O relogio da etapa
--      (funnel_stage_changed_at) continua sendo carimbado no insert, porque a
--      coluna e NOT NULL e outras telas leem; quem ignora esse relogio e o
--      planner. Uma mudanca de etapa posterior (ato explicito de alguem,
--      inclusive a mudanca em massa) move o relogio e inscreve normalmente.
--   6. planejar_reguas, claim_jobs_por_clinica e reservar_slot_envio_v2
--      redefinidas para usar o que esta acima.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do deploy do codigo. O codigo
-- novo chama reservar_slot_envio_v2 com dois argumentos a mais; o codigo
-- antigo continua funcionando contra a funcao nova (os argumentos novos tem
-- padrao e o padrao e o comportamento de 1:1).

-- 1. Motivos de toque pulado --------------------------------------------------

alter table public.cadence_run
  drop constraint if exists cadence_run_skipped_reason_check;
alter table public.cadence_run
  add constraint cadence_run_skipped_reason_check
  check (skipped_reason in (
    'sem_consentimento',
    'fora_janela',
    'condicao_parada',
    'falha_envio',
    'desconectado',
    'teto_gasto',
    'canal_ocupado',
    -- O horario da consulta mudou depois de o toque ser planejado: o toque
    -- velho aponta para o horario antigo e morre sozinho (o planner cria o
    -- toque do horario novo).
    'consulta_remarcada',
    -- O paciente pediu para remarcar (appointment.remarcacao_pedida_em): nao
    -- faz sentido perguntar se ele confirma a consulta que quer trocar.
    'remarcacao_pedida',
    -- A janela de envio (ou o canal fora do ar) empurrou o toque para outro
    -- dia civil e existe um toque seguinte da mesma regua que ainda sai antes
    -- da consulta: o texto deste ("amanha") passaria a mentir.
    'toque_atrasado'
  ));

-- 2. Pedido de remarcacao -----------------------------------------------------

alter table public.appointment
  add column if not exists remarcacao_pedida_em timestamptz null;

comment on column public.appointment.remarcacao_pedida_em is
  'Quando o paciente pediu para remarcar (resposta ao toque). Gravada e limpa pelo interceptador de resposta. Preenchida, a regua de confirmacao nao planeja nem envia toque para esta consulta.';

-- 3. Prioridade na fila -------------------------------------------------------

alter table public.job_queue
  add column if not exists prioridade smallint not null default 0;

alter table public.job_queue
  drop constraint if exists job_queue_prioridade_valida;
alter table public.job_queue
  add constraint job_queue_prioridade_valida
  check (prioridade in (0, 1));

comment on column public.job_queue.prioridade is
  '0 = resposta ao paciente, confirmacao, pos falta, oferta de espera e toque manual; 1 = follow-up. claim_jobs_por_clinica reivindica por prioridade e depois por run_at.';

-- O lateral do claim procura, por clinica, o pendente de menor prioridade e
-- mais antigo. O indice antigo (clinic_id, run_at) continua servindo o resto.
create index if not exists job_queue_clinica_prioridade_idx
  on public.job_queue (clinic_id, prioridade, run_at)
  where status = 'pendente';

-- 4. Slot de massa separado ---------------------------------------------------

alter table public.whatsapp_account
  add column if not exists next_bulk_send_at timestamptz null;

comment on column public.whatsapp_account.next_bulk_send_at is
  'Proximo slot livre dos envios AUTOMATICOS deste numero (regua, follow-up, oferta, eco, toque manual), com o espacamento de massa. Reservado atomicamente por reservar_slot_envio_v2 com p_massa = true.';
comment on column public.whatsapp_account.next_send_at is
  'Fim do intervalo curto desde o ultimo envio real deste numero (1,5 a 4 s). A resposta humana 1:1 so respeita este; o envio automatico respeita este E o next_bulk_send_at. Reservado atomicamente por reservar_slot_envio_v2; NUNCA enviar sem reservar.';

-- 5. Contato criado pela importacao -------------------------------------------

alter table public.contact
  add column if not exists criado_por_importacao boolean not null default false;

comment on column public.contact.criado_por_importacao is
  'O contato nasceu pela importacao de planilha. O planner ignora o relogio de etapa carimbado no nascimento (nao inscreve no follow-up da etapa inicial); uma mudanca de etapa posterior inscreve normalmente.';

-- 6a. Reserva do slot de envio ------------------------------------------------
--
-- Dois trilhos no MESMO lock de linha:
--
--   1:1 (p_massa = false, a resposta digitada no Inbox): livre quando o
--     intervalo curto do ultimo envio real passou (next_send_at). Reserva
--     next_send_at = livre + p_espaco_ms. NAO olha nem mexe no slot de massa.
--
--   massa (p_massa = true, tudo que o motor envia): livre quando o slot de
--     massa E o intervalo curto passaram. Reserva next_bulk_send_at = livre +
--     p_espaco_ms (10 a 30 s hoje, o limite anti-ban por instancia) e
--     next_send_at = livre + o intervalo curto, que nunca passa do proprio
--     espacamento pedido (o par midia + botoes pede 1,5 s e o segundo envio
--     do par tem de caber no teto de espera de 3 s).
--
-- 'adiado' continua sem escrever NADA: nenhum slot e queimado.
--
-- A assinatura muda (dois argumentos com padrao), entao a velha sai antes:
-- com as duas no banco, a chamada de tres argumentos ficaria ambigua.

drop function if exists public.reservar_slot_envio_v2(uuid, integer, integer);

create function public.reservar_slot_envio_v2(
  p_clinic_id uuid,
  p_espaco_ms integer,
  p_espera_maxima_ms integer,
  p_massa boolean default false,
  p_espaco_curto_ms integer default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_livre_em timestamptz;
  v_espera_ms double precision;
  v_curto_ms integer;
begin
  -- O lock de linha serializa concorrentes; a transacao dura microssegundos.
  select case
           when p_massa then greatest(
             coalesce(next_bulk_send_at, now()),
             coalesce(next_send_at, now()),
             now()
           )
           else greatest(coalesce(next_send_at, now()), now())
         end
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

  if p_massa then
    v_curto_ms := least(coalesce(p_espaco_curto_ms, p_espaco_ms), p_espaco_ms);
    update whatsapp_account
    set next_bulk_send_at = v_livre_em + make_interval(secs => p_espaco_ms / 1000.0),
        next_send_at = v_livre_em + make_interval(secs => v_curto_ms / 1000.0)
    where clinic_id = p_clinic_id;
  else
    update whatsapp_account
    set next_send_at = v_livre_em + make_interval(secs => p_espaco_ms / 1000.0)
    where clinic_id = p_clinic_id;
  end if;

  return jsonb_build_object(
    'estado', 'reservado',
    'espera_ms', v_espera_ms
  );
end;
$function$;

-- Mesma superficie de antes: so o service role (worker e Server Actions com o
-- admin client) reserva slot.
revoke all on function public.reservar_slot_envio_v2(uuid, integer, integer, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.reservar_slot_envio_v2(uuid, integer, integer, boolean, integer)
  to service_role;

-- 6b. Claim por clinica, com prioridade ----------------------------------------

create or replace function public.claim_jobs_por_clinica(
  p_worker text,
  p_max_clinicas integer,
  p_kinds text[],
  p_incluir_teste boolean default false
)
returns setof job_queue
language plpgsql
set search_path to 'public'
as $function$
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

  -- Ramos 2 e 3: um job elegivel por clinica. Dentro da clinica, a menor
  -- prioridade primeiro e, empatado, o mais atrasado: confirmacao vencida
  -- sai antes de follow-up, mesmo que o follow-up esteja na fila ha mais
  -- tempo. Entre clinicas, a mesma regra: clinica com confirmacao pendente
  -- passa na frente de clinica que so tem follow-up.
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
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.clinic_id = c.id
        and q.kind = any(p_kinds)
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) escolhido
    where (p_incluir_teste or not c.e_de_teste)
    order by escolhido.prioridade, escolhido.run_at
    limit p_max_clinicas
    for update skip locked
  )
  returning j.*;
end;
$function$;

-- 6c. Planner --------------------------------------------------------------------
--
-- Mudancas em relacao a versao de producao (20260914190000):
--   - confirmacao: consulta com pedido de remarcacao nao ganha toque novo;
--   - follow-up: contato criado pela importacao nao e inscrito pelo relogio
--     do nascimento (so por uma mudanca de etapa posterior), e o job nasce
--     com prioridade 1.

create or replace function public.planejar_reguas()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      -- Paciente pediu para remarcar: perguntar se ele confirma a consulta
      -- que ele quer trocar confunde e atrapalha a recepcao que esta
      -- remarcando. Quando o pedido for resolvido (coluna limpa), os toques
      -- que ainda couberem voltam a ser planejados.
      and a.remarcacao_pedida_em is null
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
    insert into job_queue (clinic_id, kind, payload, run_at, prioridade)
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0
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
    insert into job_queue (clinic_id, kind, payload, run_at, prioridade)
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0
    from novas
    returning 1
  )
  select count(*)::integer into v_pos_falta from jobs;

  -- Follow-up: eixo na entrada da etapa (funnel_stage_changed_at).
  -- O contato so esta no recorte enquanto CONTINUA na etapa da regua e sem
  -- resposta desde que entrou: sair ou responder e a parada da spec 7.2. O
  -- join com funnel_stage_def descarta regua orfa de etapa excluida (defesa
  -- em profundidade; o gatilho da jornada ja impede a exclusao).
  --
  -- IMPORTACAO NAO INSCREVE (decisao do dono de 24/09/2026): o contato criado
  -- pela planilha tem o relogio da etapa carimbado no insert, igual a qualquer
  -- outro, mas esse relogio nao e um ato de ninguem. Enquanto ele nao mudar
  -- de etapa (funnel_stage_changed_at continua igual ao created_at, que o
  -- insert grava com o MESMO now()), o follow-up nao o alcanca. A primeira
  -- mudanca de etapa, ato explicito de alguem (inclusive em massa), move o
  -- relogio e inscreve.
  --
  -- O job de follow-up nasce com prioridade 1: nunca passa na frente de
  -- confirmacao, pos falta, resposta ao paciente ou oferta de espera.
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
    where s.offset_minutes >= 0
      and not (
        ct.criado_por_importacao
        and ct.funnel_stage_changed_at <= ct.created_at
      )
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
    insert into job_queue (clinic_id, kind, payload, run_at, prioridade)
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           1
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
$function$;

-- create or replace preserva os grants, mas a superficie fica explicita aqui
-- (as duas continuam so do service role, como em producao).
revoke all on function public.planejar_reguas() from public, anon, authenticated;
grant execute on function public.planejar_reguas() to service_role;
revoke all on function public.claim_jobs_por_clinica(text, integer, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.claim_jobs_por_clinica(text, integer, text[], boolean)
  to service_role;
