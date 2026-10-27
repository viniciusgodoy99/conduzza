-- Rollback manual da migration 20261028100000_remarcar_e_cancelar_pela_ia.sql
-- (remarcar e cancelar pela IA, AG4, parte de banco: o cancelamento pela
-- IA, a remarcacao como consulta nova pendente ligada a antiga, os prazos
-- da clinica e os tres pontos que a AG3 deixou; 27/10/2026).
--
-- Corpos lidos da producao em 27/10/2026 (fndef.js, so leitura), antes da
-- migration, com o md5(prosrc) na leitura (o ensaio confere que o banco
-- ainda esta assim antes de trocar, e o fim deste arquivo confere que
-- voltaram):
--   reservar_horario_da_ia(uuid,uuid,uuid,timestamptz,uuid,uuid)           13bd61f096bd61d194f39a630694cc10
--   agendar_pela_ia(uuid,uuid,uuid,uuid)                                   ace69ce71ab735a09ad41700a194730e
--   gravar_atendimento_da_ia(uuid,uuid,uuid,integer,jsonb)                 bdebcd02a01e928168507df35224ad6e
--   ler_dados_informados_na_marcacao(uuid,uuid)                            9348184a8b779629b73b91f1d01f6dbe
--   devolver_conversa_da_consulta_recusada(uuid,uuid)                      64d9f45b93d75bab7fb7db71b230815c
--   rotulo_do_motivo_da_ia(text)                                           e838e6a41922942af0d7d50407fb6bb6
--   agente_garantir_rascunho(uuid)                                         da4d6c48e91598262b9b5ca3268dbf0f
--   restaurar_versao_do_agente(uuid,integer)                               f27df55375103068a3ddc21d29adf4a9
--
-- O QUE A MIGRATION FEZ: criou conferir_consulta_da_ia,
-- pedido_da_ia_na_conversa, cancelar_consulta_pela_ia e as funcoes dos tres
-- gatilhos novos de appointment (exigir_remarcacao_da_ia,
-- remarcacao_pendente_trava_a_antiga, remarcacao_na_aprovacao);
-- appointment.remarcacao_de (FK para a propria tabela, CHECK, indice unico
-- parcial e indice parcial); appointment_status_history.ia_job_id (CHECK e
-- indice unico parcial); ai_agent_config.cancelar_antecedencia_horas e
-- remarcar_antecedencia_horas (CHECKs e grants por coluna); o CHECK
-- ai_decision_log_escalation_reason_valida com fora_do_prazo; trocou
-- reservar_horario_da_ia (6 para 7 parametros) e agendar_pela_ia (4 para 5)
-- com p_remarcar, ler_dados_informados_na_marcacao (2 para 3) com p_campo, e
-- os corpos de gravar_atendimento_da_ia,
-- devolver_conversa_da_consulta_recusada, rotulo_do_motivo_da_ia,
-- agente_garantir_rascunho e restaurar_versao_do_agente.
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); recusa se houver
-- remarcacao pedida pela IA ainda pendente (resolva antes: aprovar ou
-- recusar na Agenda); tira os tres gatilhos; devolve os oito corpos de
-- antes, com os comentarios e os grants de antes (o reservar, o agendar e o
-- ler_dados com a assinatura de antes: as de agora saem), ANTES de apagar o
-- que eles chamariam; apaga as funcoes e as colunas novas (com os CHECKs,
-- os indices e os grants delas); devolve o CHECK de antes (validado sem
-- decisao com fora_do_prazo; NOT VALID com ela, com um NOTICE: a trilha de
-- auditoria nunca e apagada nem reescrita); confere no fim os oito md5, os
-- comentarios, os grants e que nada novo ficou (com qualquer diferenca,
-- falha e desfaz tudo). Sem IF EXISTS: com qualquer objeto faltando ou
-- diferente, falha e desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG4 chama a RPC nova, le as colunas
-- novas e passa p_remarcar e p_campo) e resolver as remarcacoes pendentes,
-- DEPOIS este arquivo. O codigo de antes da AG4 (main de 27/10/2026) chama
-- reservar_horario_da_ia com 6 parametros por nome, agendar_pela_ia com 4 e
-- ler_dados_informados_na_marcacao com 2: funciona antes e depois deste
-- arquivo.
--
-- O QUE SE PERDE: o elo das remarcacoes ja resolvidas (as duas consultas
-- ficam, como consultas comuns; a antiga ja cancelada fica cancelada), o job
-- da IA na trilha dos cancelamentos (a linha fica, com autor ia), os prazos
-- escolhidos nas versoes do agente. Os eventos da conversa ficam.
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_agent_config, ai_decision_log, appointment
-- e appointment_status_history (os DROP TRIGGER e DROP COLUMN). Todas no
-- comeco, numa ordem fixa, com NOWAIT: com uma ocupada, solta as que pegou
-- (o savepoint do bloco), espera 100 ms sem trava nenhuma e tenta de novo,
-- ate 10 vezes (uns 1 s, menos que os 3 s da migration, de proposito);
-- depois falha inteiro com 55P03, nada desfeito: rodar de novo. Nunca espera
-- trava com outra na mao (nao fecha ciclo, 40P01, com sessao nenhuma). Ate
-- o commit, ninguem le nem grava consultas, a trilha delas, a configuracao
-- do agente nem as decisoes da IA: a Agenda e o turno da IA esperam os
-- milissegundos. Horario calmo.
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
      lock table public.ai_agent_config, public.ai_decision_log, public.appointment,
                 public.appointment_status_history
        in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261028100000: uma das tabelas seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- 1. Nenhuma remarcacao pedida pela IA pendente: sem o elo e sem o gatilho
--    da aprovacao, aprovar a nova depois deixaria as duas consultas de pe.
do $pendentes$
declare
  v_pendentes bigint;
begin
  select count(*) into v_pendentes
    from public.appointment a
   where a.remarcacao_de is not null
     and a.approval_status = 'pendente'
     and a.status not in ('cancelado_paciente', 'cancelado_clinica');
  if v_pendentes > 0 then
    raise exception using errcode = 'object_in_use',
      message = format('Rollback de 20261028100000: %s remarcacao(oes) pedida(s) pela IA ainda pendente(s). Aprove ou recuse na Agenda antes. Nada foi desfeito.', v_pendentes);
  end if;
end;
$pendentes$;

-- 2. Os tres gatilhos da remarcacao e as funcoes deles.
drop trigger remarcacao_na_aprovacao on public.appointment;
drop trigger remarcacao_pendente_trava_a_antiga on public.appointment;
drop trigger exigir_remarcacao_da_ia on public.appointment;
drop function public.remarcacao_na_aprovacao();
drop function public.remarcacao_pendente_trava_a_antiga();
drop function public.exigir_remarcacao_da_ia();

-- 3. A RPC nova.
drop function public.cancelar_consulta_pela_ia(uuid, uuid, uuid, uuid);

-- 4. O reservar de 6 parametros, o agendar de 4 e o ler_dados de 2, com os
--    grants e os comentarios de antes (os de agora saem antes: o PostgREST
--    nao ve duas funcoes).
drop function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid, uuid);
drop function public.agendar_pela_ia(uuid, uuid, uuid, uuid, uuid);
drop function public.ler_dados_informados_na_marcacao(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.reservar_horario_da_ia(p_clinic_id uuid, p_conversation_id uuid, p_service_link_id uuid, p_starts_at timestamp with time zone, p_job_id uuid, p_unit_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profissional uuid;
  v_recurso uuid;
  v_reserva public.slot_hold%rowtype;
  v_conf record;
  -- [revisao final] inicio
  v_ja_marcada uuid;
  v_ja_marcada_em timestamptz;
  -- [revisao final] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_service_link_id is null
     or p_starts_at is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- Trava da conversa (uma reserva por conversa, mesmo com dois turnos ao
  -- mesmo tempo) e, depois dela, a do profissional do vinculo e, quando o
  -- procedimento tem recurso, a do recurso (ordem fixa: conversa,
  -- profissional, recurso). Vinculo de outra clinica fica sem as duas
  -- ultimas e cai em vinculo_invalido.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );
  select sl.professional_id, pr.resource_id into v_profissional, v_recurso
    from public.service_link sl
    left join public.procedure pr
      on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
   where sl.id = p_service_link_id
     and sl.clinic_id = p_clinic_id;
  if v_profissional is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold:' || v_profissional::text, 0)
    );
  end if;
  -- [recurso da reserva] (revisao da E4): duas conversas em dois
  -- profissionais que usam o mesmo recurso esperam uma pela outra.
  if v_recurso is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold_recurso:' || v_recurso::text, 0)
    );
  end if;

  -- Idempotencia: a reserva deste job, viva ou consumida, volta como esta.
  select h.* into v_reserva
    from public.slot_hold h
   where h.job_id = p_job_id;
  if found then
    if v_reserva.clinic_id is distinct from p_clinic_id
       or v_reserva.conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '22023', message = 'job_de_outra_conversa';
    end if;
    return jsonb_build_object(
      'ok', true,
      'hold_id', v_reserva.id,
      'starts_at', v_reserva.starts_at,
      'ends_at', v_reserva.ends_at,
      'expires_at', v_reserva.expires_at,
      'reutilizado', true
      -- [agendamento completo] inicio
      , 'unit_id', v_reserva.unit_id
      -- [agendamento completo] fim
    );
  end if;

  select * into v_conf
    from public.conferir_horario_da_ia(
      p_clinic_id, p_conversation_id, p_service_link_id, p_starts_at, null, null
      -- [agendamento completo] a unidade
      , p_unit_id
    );
  if v_conf.o_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo);
  end if;
  -- O vinculo trocou de profissional (ou o procedimento, de recurso) entre a
  -- trava e a conferencia.
  if v_conf.o_profissional is distinct from v_profissional
     or v_conf.o_recurso is distinct from v_recurso then
    return jsonb_build_object('ok', false, 'motivo', 'vinculo_invalido');
  end if;

  -- [revisao final] inicio
  -- ja_tem_consulta ANTES de reservar (a mesma regra do agendar, que
  -- confere de novo): o contato da conversa ja tem consulta futura ativa do
  -- mesmo procedimento, com qualquer profissional (a pendente da IA conta;
  -- cancelada, recusada, faltou e compareceu nao). Devolve a mais proxima e
  -- o inicio dela (a IA diz so o dia e a hora); nada grava, e a reserva que
  -- a conversa ja tinha fica. Antes, o paciente informava todos os dados e
  -- so no agendar ouvia que ja tinha consulta.
  select a.id, a.starts_at into v_ja_marcada, v_ja_marcada_em
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic_id
     and a.contact_id = v_conf.o_contato
     and sl.procedure_id = (
       select x.procedure_id from public.service_link x
        where x.id = p_service_link_id and x.clinic_id = p_clinic_id)
     and a.starts_at > now()
     and a.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou', 'compareceu')
     and a.approval_status is distinct from 'recusado'
   order by a.starts_at, a.id
   limit 1;
  if v_ja_marcada is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta',
                              'appointment_id', v_ja_marcada, 'starts_at', v_ja_marcada_em);
  end if;
  -- [revisao final] fim

  -- As vencidas nao consumidas do profissional e as nao consumidas desta
  -- conversa saem (a consumida fica: e a consulta e a idempotencia). SKIP
  -- LOCKED: a linha travada por outro e a que outro ja esta apagando ou
  -- consumindo.
  delete from public.slot_hold h
   where h.id in (
     select x.id
       from public.slot_hold x
      where x.consumido_em is null
        and ((x.professional_id = v_profissional and x.expires_at <= now())
             or (x.clinic_id = p_clinic_id and x.conversation_id = p_conversation_id))
        for update skip locked
   );

  insert into public.slot_hold (
    clinic_id, professional_id, contact_id, service_link_id, conversation_id,
    job_id, starts_at, ends_at, expires_at, created_by
    -- [agendamento completo] a unidade
    , unit_id
  ) values (
    p_clinic_id, v_profissional, v_conf.o_contato, p_service_link_id, p_conversation_id,
    p_job_id, p_starts_at, v_conf.o_fim, now() + interval '10 minutes', 'ia'
    -- [agendamento completo] a unidade
    , p_unit_id
  )
  returning * into v_reserva;

  return jsonb_build_object(
    'ok', true,
    'hold_id', v_reserva.id,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'expires_at', v_reserva.expires_at,
    'reutilizado', false
    -- [agendamento completo] inicio
    , 'unit_id', v_reserva.unit_id
    -- [agendamento completo] fim
  );
end;
$function$;
revoke execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid)
  to service_role;
comment on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid) is
  'So o servidor (service_role). A IA reserva por 10 minutos o horario p_starts_at do vinculo p_service_link_id para a conversa (uma reserva por conversa), na unidade p_unit_id (AG3; nula = como antes, a jornada de todas as unidades). Confere tudo de novo no banco (conferir_horario_da_ia) sob trava da conversa, do profissional e, quando o procedimento tem, do recurso. Devolve {ok:true, hold_id, starts_at, ends_at, expires_at, reutilizado, unit_id} ou {ok:false, motivo}: ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado, reservado_por_outra_conversa; depois, ja_tem_consulta (revisao final; com appointment_id e starts_at da consulta futura ativa do mesmo procedimento que o contato ja tem, com qualquer profissional, a mais proxima, pela mesma regra do agendar; nada grava). Idempotente pelo job_id (a reserva do job volta com reutilizado true, como esta; job de outra conversa: 22023). Parametro nulo: 22004.';

CREATE OR REPLACE FUNCTION public.agendar_pela_ia(p_clinic_id uuid, p_conversation_id uuid, p_job_id uuid, p_slot_hold_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reserva public.slot_hold%rowtype;
  v_conf record;
  v_consulta uuid;
  v_recurso uuid;
  v_pergunta timestamptz;
  -- [agendamento completo] inicio
  v_ja_marcada uuid;
  v_dados public.dados_informados_na_marcacao%rowtype;
  v_faltam text[];
  v_nascimento_no_cadastro date;
  -- [agendamento completo] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- Idempotencia: a reserva que este job consumiu devolve a consulta.
  select h.* into v_reserva
    from public.slot_hold h
   where h.job_id_do_agendar = p_job_id;
  if found then
    if v_reserva.clinic_id is distinct from p_clinic_id
       or v_reserva.conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '22023', message = 'job_de_outra_conversa';
    end if;
    -- [revisao final] A reserva que este job consumiu nao e a pedida.
    if p_slot_hold_id is not null and v_reserva.id is distinct from p_slot_hold_id then
      return jsonb_build_object('ok', false, 'motivo', 'reserva_diferente');
    end if;
    if v_reserva.appointment_id is null then
      -- A consulta deste job foi apagada depois: nada a repetir.
      return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
    end if;
    return (
      select jsonb_build_object(
               'ok', true,
               'appointment_id', a.id,
               'starts_at', a.starts_at,
               'ends_at', a.ends_at,
               'reutilizado', true
             )
        from public.appointment a
       where a.id = v_reserva.appointment_id
    );
  end if;

  -- A reserva viva desta conversa (no maximo uma; a mais nova, por garantia).
  select h.* into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
   order by h.created_at desc, h.id desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
  end if;
  -- [revisao final] A reserva viva nao e a que o "Confirma ...?" perguntou
  -- (outro turno reservou outra depois): o "sim" do paciente nao vale para
  -- ela. Nada grava.
  if p_slot_hold_id is not null and v_reserva.id is distinct from p_slot_hold_id then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_diferente');
  end if;
  if v_reserva.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_vencida');
  end if;

  -- Trava do profissional e a reserva travada: o que foi lido antes da
  -- trava e lido de novo.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold:' || v_reserva.professional_id::text, 0)
  );
  select h.* into v_reserva
    from public.slot_hold h
   where h.id = v_reserva.id
     for update;
  if not found or v_reserva.consumido_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
  end if;
  if v_reserva.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_vencida');
  end if;
  -- [recurso da reserva] (revisao da E4): a trava do recurso do
  -- procedimento, depois da do profissional (a ordem do reservar).
  select pr.resource_id into v_recurso
    from public.service_link sl
    join public.procedure pr
      on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
   where sl.id = v_reserva.service_link_id
     and sl.clinic_id = p_clinic_id;
  if v_recurso is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold_recurso:' || v_recurso::text, 0)
    );
  end if;

  -- As mesmas conferencias do reservar, sem a propria reserva e com o fim
  -- dela. Consulta que passou a ocupar o horario (a recepcao marcou por
  -- cima durante a reserva) e conflito, como o 23P01.
  select * into v_conf
    from public.conferir_horario_da_ia(
      p_clinic_id, p_conversation_id, v_reserva.service_link_id,
      v_reserva.starts_at, v_reserva.ends_at, v_reserva.id
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
    );
  if v_conf.o_motivo is not null then
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_conf.o_motivo = 'ocupado' then 'conflito' else v_conf.o_motivo end
    );
  end if;
  if v_conf.o_profissional is distinct from v_reserva.professional_id
     or v_conf.o_recurso is distinct from v_recurso then
    return jsonb_build_object('ok', false, 'motivo', 'vinculo_invalido');
  end if;

  -- [agendamento completo] inicio
  -- Na ordem: primeiro o que passa para a equipe (D-8), depois a consulta
  -- que ja existe e por fim os dados que faltam (a IA nao pede dado para
  -- uma consulta que nao vai marcar).
  -- (a) Os dados informados: a linha aberta da conversa, do contato de
  -- agora (registrar_dados_da_marcacao, sob a mesma trava da conversa) e
  -- [revisao final] da janela atual da IA (a de outra janela, inclusive a
  -- marca de outra pessoa, nao vale depois do Devolver), lidas na mesma
  -- foto.
  select d.* into v_dados
    from public.dados_informados_na_marcacao d
    join public.ia_janela_da_conversa w
      on w.conversation_id = d.conversation_id
     and w.clinic_id = d.clinic_id
     and w.desde = d.janela_desde
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     and d.contact_id = v_conf.o_contato
     for update of d;
  -- (b) D-8: consulta para outra pessoa passa para a equipe.
  if v_dados.id is not null and not v_dados.para_o_titular then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_para_outra_pessoa');
  end if;
  -- (c) D-8: menor de 18 anos no dia da consulta (no fuso da clinica) passa
  -- para a equipe, pelo nascimento informado ou pelo do cadastro do contato
  -- (basta um dos dois).
  select k.birth_date into v_nascimento_no_cadastro
    from public.contact k
   where k.id = v_conf.o_contato
     and k.clinic_id = p_clinic_id;
  if exists (
    select 1
      from unnest(array[v_dados.data_nascimento, v_nascimento_no_cadastro]) as n(nascimento)
     where n.nascimento > ((v_reserva.starts_at at time zone v_conf.o_fuso)::date - interval '18 years')::date
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'menor_de_idade');
  end if;
  -- (d) ja_tem_consulta: o contato da conversa ja tem consulta futura ativa
  -- (nao cancelada, nao recusada, nem faltou nem compareceu; a pendente da
  -- IA conta) do mesmo procedimento, com qualquer profissional. Devolve a
  -- consulta (a mais proxima), para a IA oferecer remarcar.
  select a.id into v_ja_marcada
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic_id
     and a.contact_id = v_conf.o_contato
     and sl.procedure_id = (
       select x.procedure_id from public.service_link x
        where x.id = v_reserva.service_link_id and x.clinic_id = p_clinic_id)
     and a.starts_at > now()
     and a.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou', 'compareceu')
     and a.approval_status is distinct from 'recusado'
   order by a.starts_at, a.id
   limit 1;
  if v_ja_marcada is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta', 'appointment_id', v_ja_marcada);
  end if;
  -- (e) D-6: os dados que a clinica exige para marcar.
  v_faltam := public.dados_que_faltam_para_marcar(
    p_clinic_id, v_reserva.service_link_id, v_dados.nome_completo, v_dados.data_nascimento,
    v_dados.cpf, v_dados.carteirinha);
  if cardinality(v_faltam) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'faltam_dados', 'faltam', to_jsonb(v_faltam));
  end if;
  -- [agendamento completo] fim

  -- [confirmacao depois da pergunta] (revisao da E4): o paciente confirmou
  -- numa mensagem PROPRIA, depois de a IA perguntar. A pergunta e a
  -- PRIMEIRA resposta da IA gravada depois da reserva (o "Confirma ...?" do
  -- turno que reservou), e so a que nao falhou (a que falhou nao chegou ao
  -- paciente). A mensagem do paciente que chegou entre a reserva e a
  -- pergunta nao vale: ele ainda nao tinha visto dia, hora, profissional e
  -- procedimento, e o historico do turno seguinte a mostra depois da
  -- pergunta (as pendentes vao para o fim).
  select min(x.created_at) into v_pergunta
    from public.message x
   where x.conversation_id = p_conversation_id
     and x.clinic_id = p_clinic_id
     and x.direction = 'saida'
     and x.author = 'ia'
     and x.created_at > v_reserva.created_at
     and x.delivery_status is distinct from 'falhou';
  if v_pergunta is null or not exists (
    select 1
      from public.message m
     where m.conversation_id = p_conversation_id
       and m.clinic_id = p_clinic_id
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and m.created_at > v_pergunta
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
  end if;

  -- A consulta pendente (D12), sem regua ate a aprovacao e sem oferecer a
  -- vaga a lista de espera se for recusada. 23P01: conflito, nada gravado.
  begin
    insert into public.appointment (
      clinic_id, contact_id, professional_id, service_link_id, resource_id,
      starts_at, ends_at, status, created_by, approval_status,
      send_confirmation, oferecer_vaga_ao_cancelar, is_overbooking, source
      -- [agendamento completo] a unidade da reserva
      , unit_id
    ) values (
      p_clinic_id, v_conf.o_contato, v_reserva.professional_id, v_reserva.service_link_id,
      v_conf.o_recurso, v_reserva.starts_at, v_reserva.ends_at, 'agendado', 'ia', 'pendente',
      false, false, false, 'interna'
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
    )
    returning id into v_consulta;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'conflito');
  end;

  -- A reserva vira a consulta: consumida (fica, e o elo e a idempotencia) e
  -- vencida agora (a Agenda so desenha reserva com expires_at > now()).
  update public.slot_hold h
     set consumido_em = now(),
         appointment_id = v_consulta,
         job_id_do_agendar = p_job_id,
         expires_at = least(h.expires_at, now())
   where h.id = v_reserva.id;

  -- [agendamento completo] inicio
  -- Os dados informados ficam com a reserva consumida e a consulta (D-7: a
  -- aprovacao os aplica ao cadastro do contato).
  if v_dados.id is not null then
    update public.dados_informados_na_marcacao d
       set appointment_id = v_consulta,
           slot_hold_id = v_reserva.id
     where d.id = v_dados.id;
  end if;
  -- [agendamento completo] fim

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
    'A IA marcou '
      || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'DD/MM') || ' às '
      || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'HH24:MI')
      || ' (' || v_conf.o_procedimento || ', ' || v_conf.o_nome_do_profissional
      || '), pendente de aprovação da equipe.',
    false, 0
  );

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_consulta,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'reutilizado', false
  );
end;
$function$;
revoke execute on function public.agendar_pela_ia(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agendar_pela_ia(uuid, uuid, uuid, uuid)
  to service_role;
comment on function public.agendar_pela_ia(uuid, uuid, uuid, uuid) is
  'So o servidor (service_role). Marca a consulta da reserva viva da conversa, depois de uma mensagem do paciente posterior a pergunta da IA (a primeira resposta da IA gravada depois da reserva, que nao falhou): agendado, created_by ia, approval_status pendente, send_confirmation false (a regua so comeca com a aprovacao), oferecer_vaga_ao_cancelar false, source interna, a unidade da reserva; consome a reserva, liga os dados informados (dados_informados_na_marcacao, a linha aberta da janela atual da IA) a consulta e grava o evento na conversa. p_slot_hold_id (revisao final; nulo = como antes): a reserva que o "Confirma ...?" perguntou; se a reserva viva da conversa (ou, no mesmo job de novo, a que ele consumiu) for outra, reserva_diferente, sem gravar nada. Devolve {ok:true, appointment_id, starts_at, ends_at, reutilizado} ou {ok:false, motivo}: reserva_inexistente, reserva_diferente, reserva_vencida, ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, conflito (consulta no horario, inclusive o 23P01, sem gravar nada), reservado_por_outra_conversa; depois, nesta ordem, consulta_para_outra_pessoa (a marca da janela atual), menor_de_idade (menos de 18 anos no dia da consulta, pelo nascimento informado ou pelo do cadastro do contato), ja_tem_consulta (com appointment_id: o contato ja tem consulta futura ativa do mesmo procedimento; o reservar ja recusa antes, e o agendar confere de novo) e faltam_dados (com faltam: a lista do que falta); e sem_confirmacao_do_paciente. Idempotente pelo job_id (a consulta do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';

CREATE OR REPLACE FUNCTION public.ler_dados_informados_na_marcacao(p_clinic_id uuid, p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profissional uuid;
  v_dados public.dados_informados_na_marcacao%rowtype;
begin
  -- Guarda: com sessao, quem aprova a consulta (a policy de UPDATE de
  -- appointment: escrita na clinica e, o profissional, so na propria
  -- agenda); sem sessao, a service role e o SQL editor. O resto, 42501.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501', message = 'sem_permissao';
    end if;
  elsif p_clinic_id is null or not public.user_can_write(p_clinic_id) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;
  if p_clinic_id is null or p_appointment_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica e a consulta.';
  end if;

  select a.professional_id into v_profissional
    from public.appointment a
   where a.id = p_appointment_id
     and a.clinic_id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'consulta_nao_encontrada';
  end if;
  if auth.uid() is not null
     and public.user_has_role(p_clinic_id, array['profissional'])
     and v_profissional is distinct from public.user_professional_id(p_clinic_id)
  then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select d.* into v_dados
    from public.dados_informados_na_marcacao d
   where d.appointment_id = p_appointment_id
     and d.clinic_id = p_clinic_id;
  if not found then
    return jsonb_build_object('dados', null);
  end if;

  -- A trilha da leitura de dado de paciente: quem, quando e qual consulta,
  -- nunca o conteudo.
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'leu_dados_da_marcacao', 'appointment', p_appointment_id);

  return jsonb_build_object('dados', jsonb_build_object(
    'nome_completo', v_dados.nome_completo,
    'data_nascimento', v_dados.data_nascimento,
    'cpf', v_dados.cpf,
    'carteirinha', v_dados.carteirinha,
    'para_o_titular', v_dados.para_o_titular,
    'informado_em', v_dados.created_at,
    'atualizado_em', v_dados.updated_at,
    'aplicado_em', v_dados.aplicado_em,
    'aplicado_por', v_dados.aplicado_por));
end;
$function$;
revoke execute on function public.ler_dados_informados_na_marcacao(uuid, uuid) from public, anon;
grant execute on function public.ler_dados_informados_na_marcacao(uuid, uuid) to authenticated, service_role;
comment on function public.ler_dados_informados_na_marcacao(uuid, uuid) is
  'O que o paciente informou a IA para a consulta p_appointment_id (AG3, D-7): {dados: {nome_completo, data_nascimento, cpf, carteirinha, para_o_titular, informado_em, atualizado_em, aplicado_em, aplicado_por}} ou {dados: null}. A unica leitura humana da tabela: grava audit_log leu_dados_da_marcacao (entity appointment, sem conteudo) quando ha dado. Quem aprova a consulta (escrita na clinica, user_can_write; o profissional so na propria agenda), a service role e o SQL editor; o resto 42501 (anon sem EXECUTE). 22004 (nulo) e P0002 (consulta que nao e da clinica).';

-- 5. As duas internas (ninguem mais as chama).
drop function public.conferir_consulta_da_ia(uuid, uuid, uuid, text, integer);
drop function public.pedido_da_ia_na_conversa(uuid, uuid, uuid);

-- 6. Os corpos de antes de gravar_atendimento_da_ia (a leitura dupla da
--    reserva, o instante do pedido que o codigo manda),
--    devolver_conversa_da_consulta_recusada (o texto unico),
--    rotulo_do_motivo_da_ia (sem fora_do_prazo), agente_garantir_rascunho e
--    restaurar_versao_do_agente (sem os prazos), com os comentarios de antes
--    (CREATE OR REPLACE mantem os grants).
CREATE OR REPLACE FUNCTION public.gravar_atendimento_da_ia(p_clinic_id uuid, p_conversation_id uuid, p_job_id uuid, p_versao integer, p_estado jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_estado jsonb;
  v_conversa record;
  v_desde timestamptz;
  v_contato_da_janela uuid;
  v_job record;
  v_linha public.ia_atendimento%rowtype;
  v_versao integer;
  v_item jsonb;
  v_horarios jsonb := '[]'::jsonb;
  v_formato constant text := 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null
     or p_versao is null or p_estado is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A forma (22023, erro de quem chama). Os instantes viram UTC com Z e os
  -- ids, minusculos, antes de conferir.
  if jsonb_typeof(p_estado) <> 'object'
     or jsonb_typeof(p_estado -> 'horarios_oferecidos') is distinct from 'array'
     or p_versao < 0
  then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;
  begin
    for v_item in select e.value from jsonb_array_elements(p_estado -> 'horarios_oferecidos') as e loop
      v_horarios := v_horarios || jsonb_build_array(
        case when jsonb_typeof(v_item) = 'object'
               and jsonb_typeof(v_item -> 'starts_at') = 'string'
               and jsonb_typeof(v_item -> 'ends_at') = 'string'
               and jsonb_typeof(v_item -> 'oferecido_em') = 'string'
             then v_item
                  || jsonb_build_object(
                       'starts_at', to_char((v_item ->> 'starts_at')::timestamptz at time zone 'UTC', v_formato),
                       'ends_at', to_char((v_item ->> 'ends_at')::timestamptz at time zone 'UTC', v_formato),
                       'oferecido_em', to_char((v_item ->> 'oferecido_em')::timestamptz at time zone 'UTC', v_formato))
                  || case when jsonb_typeof(v_item -> 'service_link_id') = 'string'
                          then jsonb_build_object('service_link_id', lower(v_item ->> 'service_link_id'))
                          else '{}'::jsonb end
                  || case when jsonb_typeof(v_item -> 'professional_id') = 'string'
                          then jsonb_build_object('professional_id', lower(v_item ->> 'professional_id'))
                          else '{}'::jsonb end
                  || case when jsonb_typeof(v_item -> 'unit_id') = 'string'
                          then jsonb_build_object('unit_id', lower(v_item ->> 'unit_id'))
                          else '{}'::jsonb end
             else v_item end);
    end loop;
    v_estado := p_estado || jsonb_build_object('horarios_oferecidos', v_horarios);
    if jsonb_typeof(p_estado -> 'pedido_pendente_em') = 'string' then
      v_estado := v_estado || jsonb_build_object('pedido_pendente_em',
        to_char((p_estado ->> 'pedido_pendente_em')::timestamptz at time zone 'UTC', v_formato));
    end if;
    v_estado := v_estado
      || (select coalesce(jsonb_object_agg(k.chave, lower(p_estado ->> k.chave)), '{}'::jsonb)
            from unnest(array['procedure_id', 'professional_id', 'insurance_id', 'unit_id',
                              'slot_hold_id', 'appointment_id']) as k (chave)
           where jsonb_typeof(p_estado -> k.chave) = 'string');
  exception when others then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end;
  if not public.ia_estado_do_atendimento_valido(v_estado) then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;

  -- D-A do E3: trava a conversa ANTES de ler a janela (o Devolver trava a
  -- conversa e depois grava a janela).
  select c.status, c.assignee_user_id, c.contact_id into v_conversa
    from public.conversation c
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id
     for no key update;
  select w.desde, w.contact_id into v_desde, v_contato_da_janela
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_conversa.status is distinct from 'ia_atendendo'
     or v_conversa.assignee_user_id is not null
     or v_desde is null
     or v_contato_da_janela is distinct from v_conversa.contact_id
  then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;

  -- O job: desta conversa (senao 22023), em execucao (senao sem_posse) e da
  -- janela atual (senao job_antigo).
  select j.status, j.created_at into v_job
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if not found then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;
  if v_job.status is distinct from 'executando' then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posse');
  end if;
  if v_job.created_at < v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'job_antigo');
  end if;

  -- [revisao final] A reserva do estado que ja nao existe (o
  -- limpar_holds_vencidos apagou a vencida no meio do turno) e gravada
  -- nula: nao e erro de quem chama. A que existe e de outra clinica ou de
  -- outra conversa continua 22023 (abaixo).
  if v_estado ->> 'slot_hold_id' is not null and not exists (
       select 1 from public.slot_hold x
        where x.id = (v_estado ->> 'slot_hold_id')::uuid)
  then
    v_estado := v_estado || jsonb_build_object('slot_hold_id', null);
  end if;

  -- Os ids sao desta clinica: o procedimento, o profissional, o convenio e a
  -- unidade; a reserva e desta conversa; a consulta e do contato da
  -- conversa; e os vinculos, profissionais e unidades dos horarios.
  if (v_estado ->> 'procedure_id' is not null and not exists (
        select 1 from public.procedure x
         where x.id = (v_estado ->> 'procedure_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'professional_id' is not null and not exists (
        select 1 from public.professional x
         where x.id = (v_estado ->> 'professional_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'insurance_id' is not null and not exists (
        select 1 from public.insurance x
         where x.id = (v_estado ->> 'insurance_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'unit_id' is not null and not exists (
        select 1 from public.unit x
         where x.id = (v_estado ->> 'unit_id')::uuid and x.clinic_id = p_clinic_id))
     or (v_estado ->> 'slot_hold_id' is not null and not exists (
        select 1 from public.slot_hold x
         where x.id = (v_estado ->> 'slot_hold_id')::uuid and x.clinic_id = p_clinic_id
           and x.conversation_id = p_conversation_id))
     or (v_estado ->> 'appointment_id' is not null and not exists (
        select 1 from public.appointment x
         where x.id = (v_estado ->> 'appointment_id')::uuid and x.clinic_id = p_clinic_id
           and x.contact_id = v_conversa.contact_id))
     or exists (
        select 1
          from jsonb_array_elements(v_estado -> 'horarios_oferecidos') as e
         where not exists (
                 select 1 from public.service_link x
                  where x.id = (e.value ->> 'service_link_id')::uuid and x.clinic_id = p_clinic_id
                    and x.professional_id = (e.value ->> 'professional_id')::uuid)
            or (e.value ->> 'unit_id' is not null and not exists (
                 select 1 from public.unit x
                  where x.id = (e.value ->> 'unit_id')::uuid and x.clinic_id = p_clinic_id)))
  then
    raise exception using errcode = '22023', message = 'estado_invalido';
  end if;

  -- O estado de outra janela desta conversa sai (Devolver: comeca do zero).
  delete from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.janela_desde is distinct from v_desde;

  select a.* into v_linha
    from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.janela_desde = v_desde
     for update;

  if v_linha.id is null then
    -- Primeira gravacao da janela: o job leu o vazio (versao 0).
    if p_versao <> 0 then
      return jsonb_build_object('ok', false, 'motivo', 'estado_mudou');
    end if;
    insert into public.ia_atendimento (
      clinic_id, conversation_id, janela_desde, etapa, intencao, procedure_id, professional_id,
      insurance_id, particular, unit_id, horarios_oferecidos, slot_hold_id, appointment_id,
      pedido_pendente, pedido_pendente_em, falhas_seguidas, desfecho, job_id, versao, anterior
    ) values (
      p_clinic_id, p_conversation_id, v_desde, v_estado ->> 'etapa', v_estado ->> 'intencao',
      (v_estado ->> 'procedure_id')::uuid, (v_estado ->> 'professional_id')::uuid,
      (v_estado ->> 'insurance_id')::uuid, (v_estado ->> 'particular')::boolean,
      (v_estado ->> 'unit_id')::uuid, v_estado -> 'horarios_oferecidos',
      (v_estado ->> 'slot_hold_id')::uuid, (v_estado ->> 'appointment_id')::uuid,
      v_estado ->> 'pedido_pendente', (v_estado ->> 'pedido_pendente_em')::timestamptz,
      (v_estado ->> 'falhas_seguidas')::integer, v_estado ->> 'desfecho', p_job_id, 1, null
    );
    return jsonb_build_object('ok', true, 'versao', 1, 'reutilizado', false);
  end if;

  if v_linha.job_id = p_job_id then
    -- O mesmo job de novo: o job leu o estado de antes dele (versao - 1), e
    -- a gravacao troca a dele; a versao e o anterior ficam.
    if p_versao <> v_linha.versao - 1 then
      return jsonb_build_object('ok', false, 'motivo', 'estado_mudou');
    end if;
    v_versao := v_linha.versao;
  else
    if p_versao <> v_linha.versao then
      return jsonb_build_object('ok', false, 'motivo', 'estado_mudou');
    end if;
    v_versao := v_linha.versao + 1;
  end if;

  update public.ia_atendimento a
     set etapa = v_estado ->> 'etapa',
         intencao = v_estado ->> 'intencao',
         procedure_id = (v_estado ->> 'procedure_id')::uuid,
         professional_id = (v_estado ->> 'professional_id')::uuid,
         insurance_id = (v_estado ->> 'insurance_id')::uuid,
         particular = (v_estado ->> 'particular')::boolean,
         unit_id = (v_estado ->> 'unit_id')::uuid,
         horarios_oferecidos = v_estado -> 'horarios_oferecidos',
         slot_hold_id = (v_estado ->> 'slot_hold_id')::uuid,
         appointment_id = (v_estado ->> 'appointment_id')::uuid,
         pedido_pendente = v_estado ->> 'pedido_pendente',
         pedido_pendente_em = (v_estado ->> 'pedido_pendente_em')::timestamptz,
         falhas_seguidas = (v_estado ->> 'falhas_seguidas')::integer,
         desfecho = v_estado ->> 'desfecho',
         anterior = case when v_linha.job_id = p_job_id then a.anterior
                         else public.ia_estado_do_atendimento(v_linha) end,
         job_id = p_job_id,
         versao = v_versao
   where a.id = v_linha.id;
  return jsonb_build_object('ok', true, 'versao', v_versao, 'reutilizado', v_linha.job_id = p_job_id);
end;
$function$;
comment on function public.gravar_atendimento_da_ia(uuid, uuid, uuid, integer, jsonb) is
  'So o servidor (service_role). Grava o estado do atendimento da IA (p_estado, a forma de ia_estado_do_atendimento_valido; os instantes viram UTC com Z) na janela atual da conversa, pelo job p_job_id, que leu a versao p_versao (ler_atendimento_da_ia). Trava a conversa antes de ler a janela (D-A do E3). Idempotente por job: o mesmo job grava de novo sobre o estado de antes dele (versao - 1), a versao e o anterior ficam; job novo sobe a versao e guarda o estado de antes em anterior. Apaga o estado de outra janela da conversa. A reserva do estado que ja nao existe (apagada no meio do turno) e gravada nula (revisao final), sem erro. Devolve {ok:true, versao, reutilizado} ou {ok:false, motivo}: fora_da_ia (conversa de outra clinica, fora da IA, com responsavel, sem janela ou com a janela de outro contato), sem_posse (job fora de execucao), job_antigo, estado_mudou (outro job gravou depois da leitura: ler de novo). Forma errada, id de outra clinica ou conversa (a reserva que existe e e de outra conversa inclusive), ou job que nao e desta conversa: 22023 (estado_invalido, job_invalido). Parametro nulo: 22004.';

CREATE OR REPLACE FUNCTION public.devolver_conversa_da_consulta_recusada(p_clinic_id uuid, p_appointment_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profissional uuid;
  v_conversa uuid;
  v_servidor boolean :=
    auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role';
begin
  if p_clinic_id is null or p_appointment_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica e a consulta.';
  end if;
  if not v_servidor and not public.user_can_write(p_clinic_id) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select a.professional_id into v_profissional
    from public.appointment a
   where a.id = p_appointment_id
     and a.clinic_id = p_clinic_id
     and a.created_by = 'ia'
     and a.approval_status = 'recusado';
  if not found then
    return false;
  end if;
  -- O profissional so mexe na propria agenda (a policy de appointment).
  if not v_servidor
     and public.user_has_role(p_clinic_id, array['profissional'])
     and v_profissional is distinct from public.user_professional_id(p_clinic_id)
  then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select h.conversation_id into v_conversa
    from public.slot_hold h
    join public.conversation c on c.id = h.conversation_id and c.clinic_id = h.clinic_id
   where h.appointment_id = p_appointment_id
     and h.clinic_id = p_clinic_id
   order by h.consumido_em desc nulls last
   limit 1;
  if v_conversa is null then
    return false;
  end if;

  -- O caminho da IA ao passar (ia_tirar_conversa), sem o evento de motivo:
  -- "Aguardando voce" e os jobs pendentes da conversa cancelados.
  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = true
   where c.id = v_conversa
     and c.clinic_id = p_clinic_id
     and c.status = 'ia_atendendo';
  if found then
    update public.job_queue j
       set status = 'cancelado',
           last_error = 'conversa_fora_da_ia'
     where j.id in (
       select q.id
         from public.job_queue q
        where q.kind = 'responder_com_ia'
          and q.status = 'pendente'
          and q.payload ->> 'conversation_id' = v_conversa::text
          for update skip locked
     );
  end if;

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    p_clinic_id, v_conversa, 'saida', 'sistema', 'evento',
    'A equipe recusou a consulta marcada pela IA. Avise o paciente.',
    false, 0
  );
  return true;
end;
$function$;
comment on function public.devolver_conversa_da_consulta_recusada(uuid, uuid) is
  'Depois de recusar a consulta que a IA marcou (created_by ia, approval_status recusado): acha a conversa pela reserva consumida (slot_hold.appointment_id); se ela estiver com a IA, passa para a equipe como a IA passa (aguardando_humano, Aguardando voce, jobs pendentes de responder_com_ia cancelados); em qualquer caso grava o evento "A equipe recusou a consulta marcada pela IA. Avise o paciente.". Quem escreve na clinica (user_can_write; o profissional so na propria agenda) e o servidor; senao 42501. Devolve se achou a conversa (consulta que nao e da IA, nao recusada ou sem reserva: false). Parametro nulo: 22004.';

CREATE OR REPLACE FUNCTION public.rotulo_do_motivo_da_ia(p_motivo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_motivo
    when 'sintoma' then 'A IA passou a conversa para a equipe: o paciente descreveu um sintoma.'
    when 'pedido_humano' then 'A IA passou a conversa para a equipe: o paciente pediu para falar com uma pessoa.'
    when 'insatisfacao' then 'A IA passou a conversa para a equipe: o paciente demonstrou insatisfação.'
    when 'menor_de_idade' then 'A IA passou a conversa para a equipe: o paciente é menor de idade.'
    when 'valor_fora_da_tabela' then 'A IA passou a conversa para a equipe: o assunto envolve valor fora da tabela.'
    when 'falhas_seguidas' then 'A IA passou a conversa para a equipe: o assistente não resolveu em duas tentativas.'
    when 'assunto_clinico' then 'A IA passou a conversa para a equipe: o assunto é clínico.'
    when 'midia_nao_suportada' then 'A IA passou a conversa para a equipe: o paciente mandou um conteúdo que o assistente não lê.'
    when 'tentativa_de_manipulacao' then 'A IA passou a conversa para a equipe: a mensagem tentou mudar o comportamento do assistente.'
    when 'conformidade' then 'A IA passou a conversa para a equipe: a resposta não passou na conformidade.'
    when 'agente_pediu' then 'A IA passou a conversa para a equipe: o assistente preferiu passar para a equipe.'
    -- [onda 2: fora do assunto] inicio
    when 'fora_do_assunto' then 'A IA passou a conversa para a equipe: a pessoa insistiu num assunto fora da clínica.'
    -- [onda 2: fora do assunto] fim
    -- [agendamento completo] inicio
    when 'consulta_para_outra_pessoa' then 'A IA passou a conversa para a equipe: a consulta é para outra pessoa.'
    when 'ja_tem_consulta' then 'A IA passou a conversa para a equipe: o paciente já tem consulta marcada deste procedimento.'
    when 'faltam_dados' then 'A IA passou a conversa para a equipe: faltaram dados do paciente para marcar.'
    -- [agendamento completo] fim
    when 'teto_atingido' then 'A IA passou a conversa para a equipe: o limite de gasto de hoje acabou.'
    when 'regra_do_procedimento' then 'A IA passou a conversa para a equipe: o procedimento pede contato da equipe.'
    when 'falha_tecnica' then 'A IA passou a conversa para a equipe: o assistente teve uma falha técnica.'
    when 'teto_de_respostas' then 'A IA passou a conversa para a equipe: o limite de respostas desta conversa na última hora acabou.'
    when 'pedido_de_agenda' then 'A IA passou a conversa para a equipe: o paciente quer marcar, remarcar ou cancelar.'
    when 'nao_individual' then 'Chegou uma mensagem de grupo ou de status. A conversa voltou para a equipe.'
    when 'fora_do_horario' then 'A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.'
    -- [onda 2: horario da ia] inicio
    when 'horario_nao_suportado' then 'O assistente não atende pelo WhatsApp no modo de horário escolhido. A conversa ficou com a equipe.'
    when 'no_expediente' then 'O assistente não respondeu: agora é o horário da equipe. Se ninguém da equipe responder, ele assume quando o horário dele começar.'
    when 'retomou_no_horario' then 'Começou o horário do assistente: ele assumiu esta conversa, que ninguém da equipe tinha respondido.'
    -- [onda 2: horario da ia] fim
    when 'sem_versao_publicada' then 'A IA passou a conversa para a equipe: o assistente ainda não tem versão publicada.'
    when 'liberacao_perdida' then 'A IA passou a conversa para a equipe: o assistente deixou de estar liberado para este telefone ou este número.'
    when 'numero_desconectado' then 'A IA passou a conversa para a equipe: o número do assistente está desconectado.'
    when 'envio_incerto' then 'A IA pode não ter enviado a última resposta. A conversa voltou para a equipe.'
    when 'aviso_nao_enviado' then 'O aviso automático ao contato não foi enviado.'
    when 'celular' then 'Alguém respondeu pelo celular. A IA parou de responder nesta conversa.'
    when 'sem_resposta' then 'A IA não respondeu a tempo. A conversa voltou para a equipe.'
    when 'desligada' then 'O assistente foi desligado. A conversa voltou para a equipe.'
    -- [parada neutra] inicio
    when 'parada' then 'O assistente não atendeu esta mensagem: ele está parado para este telefone ou este número.'
    -- [parada neutra] fim
    when 'sem_autorizacao' then 'A IA passou a conversa para a equipe: o contato não tem autorização para receber mensagens.'
  end
$function$;
comment on function public.rotulo_do_motivo_da_ia(text) is null;

CREATE OR REPLACE FUNCTION public.agente_garantir_rascunho(p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_versao integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ai_agent_config:' || p_clinic_id::text, 0)
  );

  select a.id into v_id
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'rascunho';
  if found then
    return v_id;
  end if;

  select coalesce(max(a.version), 0) + 1 into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id;

  begin
    insert into public.ai_agent_config (
      clinic_id, version, agent_name, tone, use_emoji, greeting, closing,
      skills, operating_mode, fallback_minutes, operating_hours,
      escalation_rules, instrucoes
      -- [agenda da ia] inicio
      , agenda_antecedencia_horas, agenda_horizonte_dias
      -- [agenda da ia] fim
      -- [onda 2: publico da ia] inicio
      , publico_atendido
      -- [onda 2: publico da ia] fim
      -- [agendamento completo] inicio
      , exige_nome_completo, exige_nascimento, exige_cpf
      -- [agendamento completo] fim
    )
    select p_clinic_id, v_versao, a.agent_name, a.tone, a.use_emoji,
           a.greeting, a.closing, a.skills, a.operating_mode,
           a.fallback_minutes, a.operating_hours, a.escalation_rules,
           a.instrucoes
           -- [agenda da ia] inicio
           , a.agenda_antecedencia_horas, a.agenda_horizonte_dias
           -- [agenda da ia] fim
           -- [onda 2: publico da ia] inicio
           , a.publico_atendido
           -- [onda 2: publico da ia] fim
           -- [agendamento completo] inicio
           , a.exige_nome_completo, a.exige_nascimento, a.exige_cpf
           -- [agendamento completo] fim
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1
    returning id into v_id;

    if v_id is null then
      insert into public.ai_agent_config (clinic_id, version)
      values (p_clinic_id, v_versao)
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'CZ409',
      message = 'O agente de IA foi alterado ao mesmo tempo por outra pessoa. Tente de novo.';
  end;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'criou_rascunho_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;
comment on function public.agente_garantir_rascunho(uuid) is
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda, o publico atendido e os dados que a IA exige para marcar) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

CREATE OR REPLACE FUNCTION public.restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_origem public.ai_agent_config%rowtype;
  v_id uuid;
begin
  if p_clinic_id is null or p_versao is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e a versão.';
  end if;
  perform public.agente_exigir_quem_configura(p_clinic_id);
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  select * into v_origem
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.version = p_versao
     and a.status = 'publicada';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Versão não encontrada.';
  end if;

  v_id := public.agente_garantir_rascunho(p_clinic_id);

  update public.ai_agent_config
     set agent_name = v_origem.agent_name,
         -- [agenda da ia] inicio
         agenda_antecedencia_horas = v_origem.agenda_antecedencia_horas,
         agenda_horizonte_dias = v_origem.agenda_horizonte_dias,
         -- [agenda da ia] fim
         -- [onda 2: publico da ia] inicio
         publico_atendido = v_origem.publico_atendido,
         -- [onda 2: publico da ia] fim
         -- [agendamento completo] inicio
         exige_nome_completo = v_origem.exige_nome_completo,
         exige_nascimento = v_origem.exige_nascimento,
         exige_cpf = v_origem.exige_cpf,
         -- [agendamento completo] fim
         tone = v_origem.tone,
         use_emoji = v_origem.use_emoji,
         greeting = v_origem.greeting,
         closing = v_origem.closing,
         skills = v_origem.skills,
         operating_mode = v_origem.operating_mode,
         fallback_minutes = v_origem.fallback_minutes,
         operating_hours = v_origem.operating_hours,
         escalation_rules = v_origem.escalation_rules,
         instrucoes = v_origem.instrucoes
   where id = v_id;

  -- A base viva passa a valer como a congelada daquela versao, sem apagar
  -- nada: o item ativo que nao esta nela fica DESATIVADO (guardado, como a
  -- tela promete; os ja desativados ficam como estao), volta com a mesma id
  -- o que foi excluido, e o que esta nela fica com o texto dela e ativo.
  update public.knowledge_item k
     set active = false
   where k.clinic_id = p_clinic_id
     and k.active
     and not exists (
       select 1
         from jsonb_array_elements(v_origem.conhecimento) e
        where (e ->> 'id')::uuid = k.id
     );

  insert into public.knowledge_item as k (id, clinic_id, question, answer, active)
  select (e ->> 'id')::uuid, p_clinic_id, e ->> 'pergunta', e ->> 'resposta', true
    from jsonb_array_elements(v_origem.conhecimento) e
  on conflict (id) do update
     set question = excluded.question,
         answer = excluded.answer,
         active = true
   where k.clinic_id = excluded.clinic_id
     and (k.question, k.answer, k.active)
         is distinct from (excluded.question, excluded.answer, true);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'restaurou_versao_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;
comment on function public.restaurar_versao_do_agente(uuid, integer) is
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda, o publico atendido e os dados que a IA exige para marcar, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- 7. O CHECK de escalation_reason de 20261027120000 (21 motivos, a mesma
--    ordem), validado quando nenhuma decisao tem fora_do_prazo; senao NOT
--    VALID (a trilha de auditoria nunca e apagada nem reescrita; um NOTICE
--    diz quantas).
alter table public.ai_decision_log
  drop constraint ai_decision_log_escalation_reason_valida;

alter table public.ai_decision_log
  add constraint ai_decision_log_escalation_reason_valida
    check (escalation_reason is null or escalation_reason in (
      'sintoma', 'pedido_humano', 'insatisfacao', 'menor_de_idade',
      'valor_fora_da_tabela', 'falhas_seguidas', 'assunto_clinico',
      'midia_nao_suportada', 'tentativa_de_manipulacao', 'conformidade',
      'agente_pediu', 'teto_atingido', 'regra_do_procedimento',
      'falha_tecnica', 'teto_de_respostas', 'nao_individual',
      'pedido_de_agenda', 'fora_do_assunto',
      'consulta_para_outra_pessoa', 'ja_tem_consulta', 'faltam_dados')) not valid;

do $motivos$
declare
  v_com_motivo_novo bigint;
begin
  select count(*) into v_com_motivo_novo
    from public.ai_decision_log
   where escalation_reason = 'fora_do_prazo';
  if v_com_motivo_novo = 0 then
    alter table public.ai_decision_log
      validate constraint ai_decision_log_escalation_reason_valida;
  else
    raise notice 'ROLLBACK 20261028100000: % decisao(oes) com fora_do_prazo ficam como estao; o CHECK volta NOT VALID (as escritas novas sao conferidas).',
      v_com_motivo_novo;
  end if;
end;
$motivos$;

-- 8. As colunas novas (com a FK, os CHECKs, os indices e os grants delas).
alter table public.appointment
  drop column remarcacao_de;
alter table public.appointment_status_history
  drop column ia_job_id;
alter table public.ai_agent_config
  drop column cancelar_antecedencia_horas,
  drop column remarcar_antecedencia_horas;

-- 9. A conferencia: os oito corpos de antes (md5 da leitura de 27/10/2026),
--    os comentarios de antes, os grants de antes e nada novo.
do $conferencia$
declare
  v_caso record;
begin
  for v_caso in
    select *
      from (values
        ('public.reservar_horario_da_ia(uuid,uuid,uuid,timestamptz,uuid,uuid)',
         '13bd61f096bd61d194f39a630694cc10', '4b90828c9aa3f1d0fa9f2de08a66db4f',
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.agendar_pela_ia(uuid,uuid,uuid,uuid)',
         'ace69ce71ab735a09ad41700a194730e', 'b7cbe1ca6d73c01c1e05283ddac91be4',
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.gravar_atendimento_da_ia(uuid,uuid,uuid,integer,jsonb)',
         'bdebcd02a01e928168507df35224ad6e', '0570d0ab5fa8e07baaf900a94912a00a',
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.ler_dados_informados_na_marcacao(uuid,uuid)',
         '9348184a8b779629b73b91f1d01f6dbe', '17f783cb4fcc36fade079273bbb1d4fc',
         'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
        ('public.devolver_conversa_da_consulta_recusada(uuid,uuid)',
         '64d9f45b93d75bab7fb7db71b230815c', 'fd5c5a25545c292975b6936f15f5421f',
         'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
        ('public.rotulo_do_motivo_da_ia(text)',
         'e838e6a41922942af0d7d50407fb6bb6', null,
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.agente_garantir_rascunho(uuid)',
         'da4d6c48e91598262b9b5ca3268dbf0f', '4795f9abf5ea3a0a4b0f185acbeacd23',
         'postgres=X/postgres'),
        ('public.restaurar_versao_do_agente(uuid,integer)',
         'f27df55375103068a3ddc21d29adf4a9', 'e3a0ba1224d6e604e1f8d66133380210',
         'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres')
      ) as t(assinatura, md5, md5_comentario, grants)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.md5
    then
      raise exception 'ROLLBACK 20261028100000: % nao voltou ao corpo de antes', v_caso.assinatura;
    end if;
    if md5(obj_description(to_regprocedure(v_caso.assinatura), 'pg_proc')) is distinct from v_caso.md5_comentario then
      raise exception 'ROLLBACK 20261028100000: o comentario de % nao e o de antes', v_caso.assinatura;
    end if;
    if (select string_agg(a::text, ',' order by a::text)
          from pg_proc p, unnest(p.proacl) a where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.grants
    then
      raise exception 'ROLLBACK 20261028100000: os grants de % nao sao os de antes', v_caso.assinatura;
    end if;
  end loop;
  if exists (
       select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('conferir_consulta_da_ia', 'pedido_da_ia_na_conversa', 'cancelar_consulta_pela_ia',
                            'exigir_remarcacao_da_ia', 'remarcacao_pendente_trava_a_antiga',
                            'remarcacao_na_aprovacao'))
     or (select count(*) from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('reservar_horario_da_ia', 'agendar_pela_ia',
                              'ler_dados_informados_na_marcacao')) <> 3
     or exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and ((c.table_name = 'appointment' and c.column_name = 'remarcacao_de')
               or (c.table_name = 'appointment_status_history' and c.column_name = 'ia_job_id')
               or (c.table_name = 'ai_agent_config'
                   and c.column_name in ('cancelar_antecedencia_horas', 'remarcar_antecedencia_horas'))))
     or exists (
       select 1 from pg_trigger t
        where t.tgname in ('exigir_remarcacao_da_ia', 'remarcacao_pendente_trava_a_antiga',
                           'remarcacao_na_aprovacao'))
     or to_regclass('public.appointment_uma_remarcacao_pendente') is not null
     or to_regclass('public.appointment_remarcacao_de_idx') is not null
     or to_regclass('public.appointment_status_history_ia_job_id_unico') is not null
  then
    raise exception 'ROLLBACK 20261028100000: um objeto da migration ficou';
  end if;
  if (select regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '')
        from pg_constraint c
       where c.conrelid = 'public.ai_decision_log'::regclass
         and c.conname = 'ai_decision_log_escalation_reason_valida')
     is distinct from
     'CHECK (((escalation_reason IS NULL) OR (escalation_reason = ANY (ARRAY[''sintoma''::text, ''pedido_humano''::text, ''insatisfacao''::text, ''menor_de_idade''::text, ''valor_fora_da_tabela''::text, ''falhas_seguidas''::text, ''assunto_clinico''::text, ''midia_nao_suportada''::text, ''tentativa_de_manipulacao''::text, ''conformidade''::text, ''agente_pediu''::text, ''teto_atingido''::text, ''regra_do_procedimento''::text, ''falha_tecnica''::text, ''teto_de_respostas''::text, ''nao_individual''::text, ''pedido_de_agenda''::text, ''fora_do_assunto''::text, ''consulta_para_outra_pessoa''::text, ''ja_tem_consulta''::text, ''faltam_dados''::text]))))'
  then
    raise exception 'ROLLBACK 20261028100000: o CHECK de escalation_reason nao e o de 20261027120000';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
