-- Rollback manual da migration 20261029100000_lista_de_espera_pela_ia.sql
-- (a IA coloca o paciente na lista de espera, AG5, parte de banco; 27/10/2026).
--
-- Corpos lidos da producao em 27/10/2026 (fndef.js, so leitura), antes da
-- migration, com o md5(prosrc) na leitura (o ensaio confere que o banco
-- ainda esta assim antes de trocar, e o fim deste arquivo confere que
-- voltaram):
--   aceitar_oferta_de_espera(uuid,uuid,uuid,uuid)   ee00dcac054a8e54129543f567604b38 (sem comentario)
--   podar_agendamento_da_ia()                       2adc71187aaf5c4bacfc58abc073473e
--
-- O QUE A MIGRATION FEZ: o CHECK ai_turno_lidas_sem_nulo em ai_turno; em
-- waitlist, as colunas origem, ia_job_id, conversation_id, insurance_id (FK
-- para insurance) e particular, os cinco CHECKs, os indices
-- waitlist_ia_job_id_unico e waitlist_insurance_id_idx e o gatilho
-- exigir_entrada_da_ia (com a funcao); a tabela ia_pedido_de_espera (com os
-- indices, a RLS e os grants); as funcoes preferencia_da_espera_valida,
-- descrever_preferencia_da_espera, lista_de_espera_da_ia_ligada,
-- entrada_da_espera_no_grupo, conferir_pedido_de_espera_da_ia,
-- pedir_lista_de_espera_pela_ia, entrar_na_lista_de_espera_pela_ia e
-- marcar_mensagem_tratada_pelo_sistema; trocou os corpos (e o comentario)
-- de aceitar_oferta_de_espera e podar_agendamento_da_ia.
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); recusa se houver entrada
-- ATIVA na fila com pagamento declarado que a regra de antes nao reproduz
-- (convenio declarado; ou particular declarado de contato com convenio no
-- cadastro): sem a coluna, a oferta e o aceite voltariam ao convenio do
-- contato, senao o particular. Desative essas entradas na Lista de espera
-- (ou todas as da IA, avisando a clinica) antes. Depois tira o gatilho,
-- as RPCs novas, devolve os dois corpos de antes (com o comentario de
-- antes; os grants nao mudaram) ANTES de apagar o que eles nao chamam mais,
-- apaga a tabela, as funcoes internas, os indices, os CHECKs e as colunas
-- novas e o CHECK de ai_turno; confere no fim os dois md5, os comentarios,
-- os grants e que nada novo ficou (com qualquer diferenca, falha e desfaz
-- tudo). Sem IF EXISTS: com qualquer objeto faltando ou diferente, falha e
-- desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG5 chama as RPCs novas, le as
-- colunas novas e a tabela nova, e a reoferta em TypeScript le a origem e o
-- pagamento), DEPOIS este arquivo. O codigo de antes da AG5 (o main com a
-- AG4) funciona antes e depois deste arquivo.
--
-- O QUE SE PERDE: a origem, o job, a conversa e o pagamento das entradas
-- (elas ficam, como entradas comuns da fila) e os pedidos (vivos e
-- consumidos). Os eventos da conversa ficam. As linhas sinteticas de
-- ai_turno (a mensagem tratada pelo sistema) ficam: sao turnos encerrados
-- comuns.
--
-- TRAVAS: ACCESS EXCLUSIVE em waitlist, ai_turno e ia_pedido_de_espera (os
-- DROP) e TAMBEM em insurance e clinic (medido no Postgres local: tirar uma
-- FK pega ACCESS EXCLUSIVE na tabela referenciada; a migration so pegava
-- SHARE ROW EXCLUSIVE nelas). Todas no comeco, numa ordem fixa, com NOWAIT:
-- com uma ocupada, solta as que pegou (o savepoint do bloco), espera 100 ms
-- sem trava nenhuma e tenta de novo, ate 10 vezes (uns 1 s, menos que os 3 s
-- da migration, de proposito); depois falha inteiro com 55P03, nada
-- desfeito: rodar de novo. Nunca espera trava com outra na mao (nao fecha
-- ciclo, 40P01, com sessao nenhuma). Ate o commit (milissegundos), NINGUEM
-- le clinic nem insurance (quase toda tela e o motor esperam), nem a fila,
-- os turnos da IA e os pedidos. Horario calmo.
--
-- Rodar inteiro, numa transacao, no SQL editor, em horario calmo.

begin;
set local lock_timeout = '1s';

-- 0. As travas, todas aqui, antes de qualquer mudanca (cabecalho, TRAVAS).
do $travas$
declare
  v_tentativas integer := 0;
begin
  loop
    begin
      lock table public.waitlist, public.ai_turno, public.ia_pedido_de_espera, public.insurance,
                 public.clinic
        in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261029100000: uma das tabelas seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- 1. Nenhuma entrada ativa com pagamento declarado que a regra de antes nao
--    reproduz: sem a coluna, a oferta e o aceite voltariam ao convenio do
--    contato, senao o particular.
do $entradas$
declare
  v_entradas bigint;
begin
  select count(*) into v_entradas
    from public.waitlist w
    left join public.contact k on k.id = w.contact_id
   where w.active
     and w.particular is not null
     and (not w.particular or k.insurance_id is not null);
  if v_entradas > 0 then
    raise exception using errcode = 'object_in_use',
      message = format('Rollback de 20261029100000: %s entrada(s) ativa(s) da lista de espera com o pagamento que a regra de antes nao reproduz (convenio declarado, ou particular de contato com convenio). Desative na Lista de espera (ou todas as da IA, avisando a clinica) antes. Nada foi desfeito.', v_entradas);
  end if;
end;
$entradas$;

-- 2. O gatilho da entrada da IA e a funcao dele.
drop trigger exigir_entrada_da_ia on public.waitlist;
drop function public.exigir_entrada_da_ia();

-- 3. As RPCs novas.
drop function public.marcar_mensagem_tratada_pelo_sistema(uuid, uuid, uuid);
drop function public.entrar_na_lista_de_espera_pela_ia(uuid, uuid, uuid);
drop function public.pedir_lista_de_espera_pela_ia(uuid, uuid, uuid, uuid, uuid, uuid, boolean, text[], smallint[]);

-- 4. Os dois corpos de antes (os grants nao mudaram: CREATE OR REPLACE
--    mantem), com o comentario de antes.
CREATE OR REPLACE FUNCTION public.aceitar_oferta_de_espera(p_clinic_id uuid, p_offer_id uuid, p_contact_id uuid, p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

comment on function public.aceitar_oferta_de_espera(uuid, uuid, uuid, uuid) is null;

CREATE OR REPLACE FUNCTION public.podar_agendamento_da_ia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_atendimentos integer := 0;
  v_dados integer := 0;
begin
  -- O estado do atendimento: da conversa que sumiu, resolvida ha mais de 30
  -- dias, de janela que nao e mais a da conversa (Devolver, ou a janela
  -- podada) e o parado ha mais de 90 dias. Ate 1000 por passagem, sem
  -- esperar ninguem.
  delete from public.ia_atendimento a
   where a.id in (
     select x.id
       from public.ia_atendimento x
       left join public.conversation c on c.id = x.conversation_id
      where c.id is null
         or (c.status = 'resolvida' and c.updated_at < now() - interval '30 days')
         or not exists (
              select 1 from public.ia_janela_da_conversa w
               where w.conversation_id = x.conversation_id
                 and w.desde = x.janela_desde)
         or x.updated_at < now() - interval '90 days'
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_atendimentos = row_count;

  -- Os dados informados (dado pessoal: o minimo de tempo). A linha aberta
  -- (sem consulta) 7 dias depois de mexida, ou da conversa que sumiu. A da
  -- consulta 30 dias depois de a consulta deixar de estar pendente (aprovada
  -- e aplicada, recusada) ou 30 dias depois do dia da consulta. A consulta
  -- apagada leva a linha (FK em cascata).
  delete from public.dados_informados_na_marcacao d
   where d.id in (
     select x.id
       from public.dados_informados_na_marcacao x
       left join public.appointment a on a.id = x.appointment_id
      where (x.appointment_id is null
             and (x.updated_at < now() - interval '7 days'
                  or not exists (select 1 from public.conversation c where c.id = x.conversation_id)))
         or (x.appointment_id is not null
             and ((a.approval_status is distinct from 'pendente' and x.updated_at < now() - interval '30 days')
                  or a.starts_at < now() - interval '30 days'))
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_dados = row_count;

  return jsonb_build_object('atendimentos', v_atendimentos, 'dados', v_dados);
end;
$function$
;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados}.';

-- 5. As funcoes internas, a tabela, os indices, os CHECKs e as colunas
--    novas, e o CHECK de ai_turno.
drop function public.conferir_pedido_de_espera_da_ia(uuid, uuid, timestamptz, uuid, uuid, uuid, uuid);
drop function public.entrada_da_espera_no_grupo(uuid, uuid, uuid, uuid);
drop function public.lista_de_espera_da_ia_ligada(uuid);
drop function public.descrever_preferencia_da_espera(text[], smallint[]);
drop table public.ia_pedido_de_espera;
drop function public.preferencia_da_espera_valida(text[], smallint[]);
drop index public.waitlist_insurance_id_idx;
drop index public.waitlist_ia_job_id_unico;
alter table public.waitlist
  drop constraint waitlist_entrada_da_ia_completa,
  drop constraint waitlist_pagamento_coerente,
  drop constraint waitlist_conversa_so_da_ia,
  drop constraint waitlist_ia_job_coerente,
  drop constraint waitlist_origem_valida,
  drop column particular,
  drop column insurance_id,
  drop column conversation_id,
  drop column ia_job_id,
  drop column origem;
alter table public.ai_turno drop constraint ai_turno_lidas_sem_nulo;

-- 6. A conferencia: os corpos, os comentarios e os grants de antes, e nada
--    novo de pe.
do $conferencia$
declare
  v_caso record;
begin
  for v_caso in
    select *
      from (values
        ('public.aceitar_oferta_de_espera(uuid,uuid,uuid,uuid)',
         'ee00dcac054a8e54129543f567604b38', null,
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.podar_agendamento_da_ia()',
         '2adc71187aaf5c4bacfc58abc073473e', '6c7c26eb44d891a0bfb27e7b212f355e',
         'postgres=X/postgres')
      ) as t(assinatura, md5, md5_comentario, grants)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.md5
    then
      raise exception 'ROLLBACK 20261029100000: % nao voltou ao corpo de antes', v_caso.assinatura;
    end if;
    if md5(obj_description(to_regprocedure(v_caso.assinatura), 'pg_proc')) is distinct from v_caso.md5_comentario then
      raise exception 'ROLLBACK 20261029100000: o comentario de % nao e o de antes', v_caso.assinatura;
    end if;
    if (select string_agg(a::text, ',' order by a::text)
          from pg_proc p, unnest(p.proacl) a where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.grants
    then
      raise exception 'ROLLBACK 20261029100000: os grants de % nao sao os de antes', v_caso.assinatura;
    end if;
  end loop;
  if exists (
       select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('exigir_entrada_da_ia', 'preferencia_da_espera_valida',
                            'descrever_preferencia_da_espera', 'lista_de_espera_da_ia_ligada',
                            'entrada_da_espera_no_grupo', 'conferir_pedido_de_espera_da_ia',
                            'pedir_lista_de_espera_pela_ia', 'entrar_na_lista_de_espera_pela_ia',
                            'marcar_mensagem_tratada_pelo_sistema'))
     or exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'waitlist'
          and c.column_name in ('origem', 'ia_job_id', 'conversation_id', 'insurance_id', 'particular'))
     or exists (select 1 from pg_trigger t where t.tgname = 'exigir_entrada_da_ia')
     or exists (
       select 1 from pg_constraint c
        where c.conname in ('ai_turno_lidas_sem_nulo', 'waitlist_origem_valida', 'waitlist_ia_job_coerente',
                            'waitlist_conversa_so_da_ia', 'waitlist_pagamento_coerente',
                            'waitlist_entrada_da_ia_completa', 'waitlist_insurance_id_fkey'))
     or to_regclass('public.ia_pedido_de_espera') is not null
     or to_regclass('public.waitlist_ia_job_id_unico') is not null
     or to_regclass('public.waitlist_insurance_id_idx') is not null
  then
    raise exception 'ROLLBACK 20261029100000: um objeto da migration ficou';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
