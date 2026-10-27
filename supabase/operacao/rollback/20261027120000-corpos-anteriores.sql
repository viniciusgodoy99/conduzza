-- Rollback manual da migration 20261027120000_agendamento_completo_da_ia.sql
-- (agendamento completo pela IA, AG3, parte de banco: o estado do
-- atendimento entre os turnos, os dados que o paciente informa para marcar,
-- a unidade da reserva, as recusas novas do agendar, os tres dados que a
-- clinica exige e os tres motivos novos de passar para a equipe;
-- 27/10/2026).
--
-- Corpos lidos da producao em 27/10/2026 (fndef.js, so leitura), antes da
-- migration, com o md5(prosrc) na leitura (o ensaio confere que o banco
-- ainda esta assim antes de trocar, e o fim deste arquivo confere que
-- voltaram):
--   conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid)  cd6ac62d847eac56bf22fb4d8f053ab8
--   reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid)               b851ca98637689e5baf45978e35b5392
--   agendar_pela_ia(uuid, uuid, uuid)                                          adc2fb06ca46d90b5b7f9ee6485731ec
--   agente_garantir_rascunho(uuid)                                             dc75e6be0704deda235132fdfc0cc328
--   restaurar_versao_do_agente(uuid, integer)                                  da40be6b16a3cd80f2f1419dba56caa7
--   rotulo_do_motivo_da_ia(text)                                               cd7db37c0b1229a49b198307ce819187
--   motor_manutencao()                                                         3af33e2f420b05e0e25093e78242cd4b
--
-- O QUE A MIGRATION FEZ: criou cpf_valido, ia_horarios_oferecidos_validos,
-- ia_estado_do_atendimento_valido, exigir_unidade_da_reserva_da_mesma_
-- clinica, dados_que_faltam_para_marcar, ia_estado_do_atendimento,
-- registrar_dados_da_marcacao, ler_dados_informados_na_marcacao,
-- ler_atendimento_da_ia, gravar_atendimento_da_ia, aplicar_dados_na_
-- aprovacao e podar_agendamento_da_ia; as tabelas ia_atendimento e
-- dados_informados_na_marcacao; slot_hold.unit_id (FK, indice e gatilho);
-- ai_agent_config.exige_nome_completo, exige_nascimento e exige_cpf (com os
-- grants por coluna); o gatilho dados_informados_na_aprovacao em
-- appointment; o CHECK ai_decision_log_escalation_reason_valida com tres
-- motivos novos; trocou conferir_horario_da_ia (6 para 7 parametros) e
-- reservar_horario_da_ia (5 para 6, o ultimo com default), e os corpos de
-- agendar_pela_ia, agente_garantir_rascunho, restaurar_versao_do_agente,
-- rotulo_do_motivo_da_ia e motor_manutencao.
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); tira o gatilho da
-- aprovacao; devolve os sete corpos de antes, com os comentarios e os
-- grants de antes, ANTES de apagar o que eles chamariam; apaga as funcoes,
-- as tabelas e as colunas novas; devolve o CHECK de antes (validado sem
-- decisao de motivo novo; NOT VALID com ela, com um NOTICE: a trilha de
-- auditoria nunca e apagada nem reescrita); confere no fim os sete md5,
-- os comentarios e que nada novo ficou (com qualquer diferenca, falha e
-- desfaz tudo). Sem IF EXISTS: com qualquer objeto faltando ou diferente,
-- falha e desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG3 chama as RPCs novas, le as
-- colunas novas e passa p_unit_id), DEPOIS este arquivo. O codigo de antes
-- da AG3 (agente-completo antes da AG3, ou main) chama reservar_horario_
-- da_ia com 5 parametros por nome e agendar_pela_ia com 3: funciona antes
-- e depois deste arquivo.
--
-- O QUE SE PERDE: o estado dos atendimentos (ia_atendimento: so ids e
-- listas fechadas) e os dados que os pacientes informaram e ainda nao foram
-- aplicados (dados_informados_na_marcacao; o que a aprovacao ja aplicou
-- fica no cadastro do contato); a unidade das reservas (a consulta marcada
-- guarda a dela em appointment.unit_id); as escolhas de exige_* nas
-- versoes do agente. A trilha (leu_dados_da_marcacao,
-- aplicou_dados_da_marcacao) fica em audit_log. As consultas que a IA
-- marcou ficam (sao consultas como as outras).
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao): ACCESS
-- EXCLUSIVE em ai_agent_config, ai_decision_log, slot_hold, appointment,
-- unit, clinic e nas duas tabelas novas (os DROP TRIGGER, DROP COLUMN e
-- DROP TABLE tiram os gatilhos das FKs tambem nas tabelas referenciadas).
-- Todas no comeco, numa ordem fixa, com NOWAIT: com uma ocupada, solta as
-- que pegou (o savepoint do bloco), espera 100 ms sem trava nenhuma e tenta
-- de novo, ate 10 vezes (uns 1 s, menos que os 3 s da migration, de
-- proposito); depois falha inteiro com 55P03, nada desfeito: rodar de novo.
-- Nunca espera trava com outra na mao (nao fecha ciclo, 40P01, com sessao
-- nenhuma). Ate o commit, ninguem le nem grava appointment, clinic, unit,
-- slot_hold, ai_agent_config nem ai_decision_log: a Agenda e o
-- Atendimento esperam (de 15 a 18 ms no Postgres local, em 5 rodadas, com
-- o commit). Horario calmo.
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
      lock table public.ai_agent_config, public.ai_decision_log, public.slot_hold,
                 public.appointment, public.unit, public.clinic,
                 public.dados_informados_na_marcacao, public.ia_atendimento
        in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261027120000: uma das tabelas seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- 1. O gatilho da aprovacao e a funcao dele (o dado ja aplicado ao contato
--    fica).
drop trigger dados_informados_na_aprovacao on public.appointment;
drop function public.aplicar_dados_na_aprovacao();

-- 2. A manutencao de antes (sem a poda) e, depois, a poda.
CREATE OR REPLACE FUNCTION public.motor_manutencao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] inicio
  v_automacoes jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] fim
  -- [gasto meta] inicio
  v_gasto integer := 0;
  -- [gasto meta] fim
  -- [clique do site] inicio
  v_cliques jsonb := '{}'::jsonb;
  -- [clique do site] fim
  -- [mensagem agendada] inicio
  v_agendadas jsonb := '{}'::jsonb;
  v_reconciliadas jsonb;
  v_erros_agendadas integer := 0;
  -- [mensagem agendada] fim
  -- [resposta da ia] inicio
  v_ia_sem_resposta integer := 0;
  v_ia_liberacao_perdida integer := 0;
  v_ia_alerta integer := 0;
  v_ia record;
  -- [resposta da ia] fim
  -- [onda 2: horario da ia] inicio
  v_horario_da_ia jsonb := '{}'::jsonb;
  -- [onda 2: horario da ia] fim
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

  -- [automacoes de fluxo] inicio
  -- Automacoes de fluxo (02/10/2026): registra as regras de tempo vencidas
  -- e executa as pendentes (um salto por passagem). Antes das reguas, para o
  -- follow-up da etapa para onde a automacao moveu ja nascer nesta passagem.
  begin
    v_automacoes := jsonb_build_object('planejadas', planejar_automacoes_de_fluxo());
  exception when others then
    v_erros := v_erros || ('planejar_automacoes:' || sqlstate);
  end;

  begin
    v_automacoes := v_automacoes || executar_automacoes_de_fluxo();
  exception when others then
    v_erros := v_erros || ('executar_automacoes:' || sqlstate);
  end;

  -- [automacoes de fluxo] fim
  begin
    select planejar_reguas() into v_reguas;
  exception when others then
    v_erros := v_erros || ('planejar_reguas:' || sqlstate);
  end;

  -- [gasto meta] inicio
  -- Investimento da Meta (Fase 4, 03/10/2026): a partir das 06:00 no fuso de
  -- cada clinica, enfileira uma leitura do gasto por dia (ate 3 clinicas por
  -- passagem). Cada clinica erra sozinha dentro da funcao (raise warning);
  -- aqui so chega erro estrutural, que vira gasto_meta:<sqlstate> no
  -- planner_erro como as outras rotinas.
  begin
    v_gasto := enfileirar_gasto_meta_do_dia();
  exception when others then
    v_erros := v_erros || ('gasto_meta:' || sqlstate);
  end;

  -- [gasto meta] fim
  -- [clique do site] inicio
  -- Clique rastreado pelo site (F1 do Google, 05/10/2026): o clique nao
  -- casado sai 1 dia depois de vencer e o casado perde gclid, gbraid e
  -- wbraid 90 dias depois do clique. Erro vira cliques_do_site:<sqlstate>.
  begin
    v_cliques := podar_cliques_do_site();
  exception when others then
    v_erros := v_erros || ('cliques_do_site:' || sqlstate);
  end;

  -- [clique do site] fim
  -- Higiene: as linhas de hostname:pid da VPS, que reiniciava a cada 1 a 2
  -- minutos e nada podava.
  begin
    delete from worker_heartbeat
    -- [resposta da ia] inicio
    where worker_id not in ('motor-fila', 'motor-planner', 'motor-ia')
    -- [resposta da ia] fim
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

  -- [mensagem agendada] inicio
  -- Mensagem agendada (06/10/2026). Por ultimo: as linhas travadas pela
  -- planejadora so soltam no fim desta transacao. A planejadora cria o job
  -- da vencida; a reconciliacao fecha o que o executor nao fechou, aplica a
  -- retencao de 30 dias e conta as presas ('enviando' ha mais de 13 h), que
  -- viram agendadas_presas:<n> no planner_erro (runbook do motor). Cada
  -- agendada erra sozinha nas duas: as linhas com erro desta passagem (soma
  -- das duas) viram agendadas_erros:<n>; erro estrutural continua
  -- mensagem_agendada:<SQLSTATE> e agendada_reconciliar:<SQLSTATE>.
  begin
    v_agendadas := public.planejar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_agendadas ->> 'erros_por_linha')::integer, 0);
  exception when others then
    v_erros := v_erros || ('mensagem_agendada:' || sqlstate);
  end;

  begin
    v_reconciliadas := public.reconciliar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_reconciliadas ->> 'erros_por_linha')::integer, 0);
    v_agendadas := v_agendadas || (v_reconciliadas - 'erros_por_linha');
    if coalesce((v_agendadas ->> 'presas')::integer, 0) > 0 then
      v_erros := v_erros || ('agendadas_presas:' || (v_agendadas ->> 'presas'));
    end if;
  exception when others then
    v_erros := v_erros || ('agendada_reconciliar:' || sqlstate);
  end;

  v_agendadas := v_agendadas
    || jsonb_build_object('erros_por_linha', v_erros_agendadas);
  if v_erros_agendadas > 0 then
    v_erros := v_erros || ('agendadas_erros:' || v_erros_agendadas);
  end if;

  -- [mensagem agendada] fim
  -- [resposta da ia] inicio
  -- Resposta da IA no WhatsApp (E3, 13/10/2026). Depois da agendada (este
  -- bloco tambem trava conversa). Ate 50 conversas na IA por passagem (da
  -- lista, ou de teste com janela), sem esperar ninguem: (a) o paciente espera ha mais de 3 minutos sem
  -- resposta, ou (b) a IA deixou de poder falar com ela (liberacao,
  -- numero, telefone, versao) ou a janela nao confere. Nenhuma mensagem ao
  -- contato; awaiting_reply fica como esta. As de (a) em clinica da lista
  -- (nao de teste) viram ia_sem_resposta:<n> no planner_erro. Erro
  -- estrutural vira ia_sem_resposta:<SQLSTATE>. Depois, as retencoes.
  begin
    for v_ia in
      select c.id,
             c.clinic_id,
             (c.awaiting_reply
              -- [onda 2: horario da ia] a espera conta da retomada (greatest)
              and greatest(c.last_inbound_at, w.updated_at) < now() - interval '3 minutes') as sem_resposta
        from public.conversation c
        join public.clinic cl on cl.id = c.clinic_id
        left join public.contact k on k.id = c.contact_id
        left join public.ia_janela_da_conversa w on w.conversation_id = c.id
       where c.status = 'ia_atendendo'
         -- So onde a IA pode existir: clinica da lista (sempre) ou de teste
         -- com janela (posta na IA pela ingestao ou pelo Devolver). Conversa
         -- de teste sem janela e fixture; nas outras clinicas, como hoje.
         and (cl.id = any (public.ia_clinicas_da_fase_controlada())
              or (cl.e_de_teste and w.conversation_id is not null))
         and (
           -- [onda 2: horario da ia] a espera conta da retomada (greatest; sem janela,
           -- greatest ignora o nulo e e o de antes)
           (c.awaiting_reply
            and greatest(c.last_inbound_at, w.updated_at) < now() - interval '3 minutes')
           or not public.ia_pode_falar_com(c.clinic_id, c.whatsapp_account_id, k.phone_key)
           or w.conversation_id is null
           or w.contact_id is distinct from c.contact_id
           or w.phone_key is distinct from k.phone_key
         )
       limit 50
         for update of c skip locked
    loop
      if v_ia.sem_resposta then
        if public.ia_tirar_conversa(v_ia.id, 'sem_resposta', null) then
          v_ia_sem_resposta := v_ia_sem_resposta + 1;
          if exists (
            select 1 from public.clinic k
             where k.id = v_ia.clinic_id
               and k.id = any (public.ia_clinicas_da_fase_controlada())
               and not k.e_de_teste
          ) then
            v_ia_alerta := v_ia_alerta + 1;
          end if;
        end if;
      elsif public.ia_tirar_conversa(v_ia.id, 'liberacao_perdida', null) then
        v_ia_liberacao_perdida := v_ia_liberacao_perdida + 1;
      end if;
    end loop;
    if v_ia_alerta > 0 then
      v_erros := v_erros || ('ia_sem_resposta:' || v_ia_alerta);
    end if;

    delete from public.ai_rascunho_bloqueado
     where created_at < now() - interval '90 days';
    update public.ai_turno
       set texto = null
     where texto is not null
       and created_at < now() - interval '1 hour';
    delete from public.ai_turno
     where created_at < now() - interval '30 days';
    delete from public.ia_janela_da_conversa w
     where w.updated_at < now() - interval '30 days'
       and not exists (
         select 1 from public.conversation c
          where c.id = w.conversation_id
            and c.status = 'ia_atendendo'
       );
  exception when others then
    v_erros := v_erros || ('ia_sem_resposta:' || sqlstate);
  end;

  -- [resposta da ia] fim
  -- [onda 2: horario da ia] inicio
  -- Horario do assistente (onda 2, item 7). Depois da resposta da IA (que
  -- tira da IA a conversa sem resposta): ate 50 conversas que ficaram com
  -- a equipe por causa do horario voltam para a IA quando o horario do
  -- assistente comeca (ia_retomar_conversas_no_horario). Linha com erro
  -- vira ia_horario_erros:<n>; erro estrutural, ia_horario:<SQLSTATE>.
  begin
    v_horario_da_ia := public.ia_retomar_conversas_no_horario(50, false);
    if coalesce((v_horario_da_ia ->> 'erros_por_linha')::integer, 0) > 0 then
      v_erros := v_erros || ('ia_horario_erros:' || (v_horario_da_ia ->> 'erros_por_linha'));
    end if;
  exception when others then
    v_erros := v_erros || ('ia_horario:' || sqlstate);
  end;

  -- [onda 2: horario da ia] fim
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
    -- [automacoes de fluxo] inicio
    , 'automacoes', v_automacoes
    -- [automacoes de fluxo] fim
    -- [gasto meta] inicio
    , 'gasto_meta', v_gasto
    -- [gasto meta] fim
    -- [clique do site] inicio
    , 'cliques_do_site', v_cliques
    -- [clique do site] fim
    -- [mensagem agendada] inicio
    , 'mensagens_agendadas', v_agendadas
    -- [mensagem agendada] fim
    -- [resposta da ia] inicio
    , 'resposta_da_ia', jsonb_build_object(
        'sem_resposta', v_ia_sem_resposta,
        'liberacao_perdida', v_ia_liberacao_perdida)
    -- [resposta da ia] fim
    -- [onda 2: horario da ia] inicio
    , 'horario_da_ia', v_horario_da_ia
    -- [onda 2: horario da ia] fim
  );
end;
$function$;
comment on function public.motor_manutencao() is null;
drop function public.podar_agendamento_da_ia();

-- 3. As RPCs novas.
drop function public.gravar_atendimento_da_ia(uuid, uuid, uuid, integer, jsonb);
drop function public.ler_atendimento_da_ia(uuid, uuid, uuid);
drop function public.ler_dados_informados_na_marcacao(uuid, uuid);
drop function public.registrar_dados_da_marcacao(uuid, uuid, uuid, boolean, text, date, text, text);

-- 4. O reservar de 5 parametros, a conferencia de 6 e o agendar de antes,
--    com os grants e os comentarios de antes; as duas funcoes internas
--    novas saem.
drop function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid);
drop function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid, uuid);
CREATE OR REPLACE FUNCTION public.conferir_horario_da_ia(p_clinic_id uuid, p_conversation_id uuid, p_service_link_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_reserva_propria uuid, OUT o_motivo text, OUT o_contato uuid, OUT o_profissional uuid, OUT o_fim timestamp with time zone, OUT o_recurso uuid, OUT o_fuso text, OUT o_procedimento text, OUT o_nome_do_profissional text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_conversa record;
  v_config record;
  v_vinculo record;
  v_na_jornada boolean;
begin
  -- 4. A conversa e da clinica, esta com a IA, e a IA pode atender este
  -- contato neste numero (a mesma pergunta da ingestao e do envio).
  select c.whatsapp_account_id, c.contact_id, c.status, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
  then
    o_motivo := 'ia_desligada';
    return;
  end if;
  o_contato := v_conversa.contact_id;

  -- 5. A versao em uso e a ultima publicada (a que o agente le no WhatsApp):
  -- Agendar ligada e as duas colunas preenchidas. Ninguem inventa valor.
  select a.skills, a.agenda_antecedencia_horas, a.agenda_horizonte_dias
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found
     or (v_config.skills ->> 'agendar') is distinct from 'true'
     or v_config.agenda_antecedencia_horas is null
     or v_config.agenda_horizonte_dias is null
  then
    o_motivo := 'agenda_nao_configurada';
    return;
  end if;

  -- 6. O vinculo que a IA pode agendar: ativo, com bookable_by_ai, de
  -- procedimento ativo com bookable_by_ai e de profissional ativo.
  select sl.professional_id, sl.duration_min, pr.resource_id,
         pr.name as procedimento, pf.name as profissional
    into v_vinculo
    from public.service_link sl
    join public.procedure pr on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
    join public.professional pf on pf.id = sl.professional_id and pf.clinic_id = sl.clinic_id
   where sl.id = p_service_link_id
     and sl.clinic_id = p_clinic_id
     and sl.active
     and sl.bookable_by_ai
     and pr.active
     and pr.bookable_by_ai
     and pf.active;
  if not found then
    o_motivo := 'vinculo_invalido';
    return;
  end if;
  o_profissional := v_vinculo.professional_id;
  o_recurso := v_vinculo.resource_id;
  o_procedimento := v_vinculo.procedimento;
  o_nome_do_profissional := v_vinculo.profissional;
  o_fim := coalesce(p_ends_at, p_starts_at + make_interval(mins => v_vinculo.duration_min));
  if o_fim <= p_starts_at then
    o_motivo := 'vinculo_invalido';
    return;
  end if;

  -- 7. Antecedencia minima e horizonte, a partir de agora.
  if p_starts_at < now() + make_interval(hours => v_config.agenda_antecedencia_horas) then
    o_motivo := 'antes_da_antecedencia';
    return;
  end if;
  if p_starts_at > now() + make_interval(days => v_config.agenda_horizonte_dias) then
    o_motivo := 'depois_do_horizonte';
    return;
  end if;

  -- 8. A jornada no fuso da clinica, como o motor da Agenda: cada dia civil
  -- local do horario (e a vespera, pela janela que vira o dia) da as faixas
  -- do seu weekday (0 = domingo); faixa com fim <= inicio termina no dia
  -- seguinte; faixas encostadas se somam. O horario cabe inteiro numa delas.
  select coalesce(c.timezone, 'America/Fortaleza') into o_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  o_fuso := coalesce(o_fuso, 'America/Fortaleza');
  select coalesce(
           range_agg(tstzrange(j.inicio, j.fim, '[)')) @> tstzrange(p_starts_at, o_fim, '[)'),
           false)
    into v_na_jornada
    from (
      select (d.dia + s.starts_at) at time zone o_fuso as inicio,
             ((d.dia + case when s.ends_at <= s.starts_at then 1 else 0 end) + s.ends_at)
               at time zone o_fuso as fim
        from generate_series(
               -1,
               (o_fim at time zone o_fuso)::date - (p_starts_at at time zone o_fuso)::date
             ) as g(n)
        cross join lateral (
          select (p_starts_at at time zone o_fuso)::date + g.n as dia
        ) as d
        join public.professional_schedule s
          on s.professional_id = o_profissional
         and s.clinic_id = p_clinic_id
         and s.weekday = extract(dow from d.dia)::smallint
    ) as j;
  if not v_na_jornada then
    o_motivo := 'fora_da_jornada';
    return;
  end if;

  -- 9. O que ja ocupa o horario.
  if exists (
    select 1
      from public.professional_block b
     where b.professional_id = o_profissional
       and b.clinic_id = p_clinic_id
       and b.starts_at < o_fim
       and b.ends_at > p_starts_at
  ) then
    o_motivo := 'bloqueado';
    return;
  end if;
  if exists (
    select 1
      from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.professional_id = o_profissional
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < o_fim
       and a.ends_at > p_starts_at
  ) then
    o_motivo := 'ocupado';
    return;
  end if;
  if o_recurso is not null and exists (
    select 1
      from public.appointment a
     where a.clinic_id = p_clinic_id
       and a.resource_id = o_recurso
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and a.starts_at < o_fim
       and a.ends_at > p_starts_at
  ) then
    o_motivo := 'ocupado';
    return;
  end if;
  if exists (
    select 1
      from public.slot_hold h
     where h.clinic_id = p_clinic_id
       and h.professional_id = o_profissional
       and h.expires_at > now()
       and h.consumido_em is null
       and h.conversation_id is distinct from p_conversation_id
       and h.id is distinct from p_reserva_propria
       and h.starts_at < o_fim
       and h.ends_at > p_starts_at
  ) then
    o_motivo := 'reservado_por_outra_conversa';
    return;
  end if;
  -- [recurso da reserva] (revisao da E4): a reserva viva de OUTRA conversa,
  -- em qualquer profissional, num vinculo cujo procedimento usa o mesmo
  -- recurso. Sem isto, duas conversas reservavam o mesmo horario da mesma
  -- sala (em dois profissionais) e a segunda so descobria no agendar,
  -- depois de o paciente confirmar.
  if o_recurso is not null and exists (
    select 1
      from public.slot_hold h
      join public.service_link sl
        on sl.id = h.service_link_id and sl.clinic_id = h.clinic_id
      join public.procedure pr
        on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
     where h.clinic_id = p_clinic_id
       and pr.resource_id = o_recurso
       and h.expires_at > now()
       and h.consumido_em is null
       and h.conversation_id is distinct from p_conversation_id
       and h.id is distinct from p_reserva_propria
       and h.starts_at < o_fim
       and h.ends_at > p_starts_at
  ) then
    o_motivo := 'reservado_por_outra_conversa';
    return;
  end if;
end;
$function$;
revoke execute on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
comment on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid) is
  'Interna (nenhum papel da API executa): as conferencias que reservar_horario_da_ia e agendar_pela_ia repetem, na ordem do contrato da E4. o_motivo nulo = pode; senao ia_desligada, agenda_nao_configurada, vinculo_invalido, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado ou reservado_por_outra_conversa (reserva viva de outra conversa no mesmo profissional ou, quando o procedimento tem recurso, num vinculo de procedimento com o mesmo recurso). p_ends_at nulo = inicio + duracao do vinculo; p_reserva_propria fica fora da conferencia de reservas.';
CREATE OR REPLACE FUNCTION public.reservar_horario_da_ia(p_clinic_id uuid, p_conversation_id uuid, p_service_link_id uuid, p_starts_at timestamp with time zone, p_job_id uuid)
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
    );
  end if;

  select * into v_conf
    from public.conferir_horario_da_ia(
      p_clinic_id, p_conversation_id, p_service_link_id, p_starts_at, null, null
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
  ) values (
    p_clinic_id, v_profissional, v_conf.o_contato, p_service_link_id, p_conversation_id,
    p_job_id, p_starts_at, v_conf.o_fim, now() + interval '10 minutes', 'ia'
  )
  returning * into v_reserva;

  return jsonb_build_object(
    'ok', true,
    'hold_id', v_reserva.id,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'expires_at', v_reserva.expires_at,
    'reutilizado', false
  );
end;
$function$;
revoke execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid)
  to service_role;
comment on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid) is
  'So o servidor (service_role). A IA reserva por 10 minutos o horario p_starts_at do vinculo p_service_link_id para a conversa (uma reserva por conversa). Confere tudo de novo no banco (conferir_horario_da_ia) sob trava da conversa, do profissional e, quando o procedimento tem, do recurso. Devolve {ok:true, hold_id, starts_at, ends_at, expires_at, reutilizado} ou {ok:false, motivo}: ia_desligada, agenda_nao_configurada, vinculo_invalido, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado, reservado_por_outra_conversa. Idempotente pelo job_id (a reserva do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';
CREATE OR REPLACE FUNCTION public.agendar_pela_ia(p_clinic_id uuid, p_conversation_id uuid, p_job_id uuid)
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
    ) values (
      p_clinic_id, v_conf.o_contato, v_reserva.professional_id, v_reserva.service_link_id,
      v_conf.o_recurso, v_reserva.starts_at, v_reserva.ends_at, 'agendado', 'ia', 'pendente',
      false, false, false, 'interna'
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
comment on function public.agendar_pela_ia(uuid, uuid, uuid) is
  'So o servidor (service_role). Marca a consulta da reserva viva da conversa, depois de uma mensagem do paciente posterior a pergunta da IA (a primeira resposta da IA gravada depois da reserva, que nao falhou): agendado, created_by ia, approval_status pendente, send_confirmation false (a regua so comeca com a aprovacao), oferecer_vaga_ao_cancelar false, source interna; consome a reserva e grava o evento na conversa. Devolve {ok:true, appointment_id, starts_at, ends_at, reutilizado} ou {ok:false, motivo}: reserva_inexistente, reserva_vencida, ia_desligada, agenda_nao_configurada, vinculo_invalido, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, conflito (consulta no horario, inclusive o 23P01, sem gravar nada), reservado_por_outra_conversa, sem_confirmacao_do_paciente. Idempotente pelo job_id (a consulta do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';
drop function public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text);
drop function public.ia_estado_do_atendimento(public.ia_atendimento);

-- 5. O rascunho e a restauracao de antes (sem as tres colunas).
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
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda e o publico atendido) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';
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
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda e o publico atendido, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- 6. Os eventos de antes (sem os tres motivos novos).
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

-- 7. O CHECK de escalation_reason de 20261022110000 (18 motivos, a mesma
--    ordem), validado quando nenhuma decisao tem motivo novo; senao NOT
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
      'pedido_de_agenda', 'fora_do_assunto')) not valid;

do $motivos$
declare
  v_com_motivo_novo bigint;
begin
  select count(*) into v_com_motivo_novo
    from public.ai_decision_log
   where escalation_reason in ('consulta_para_outra_pessoa', 'ja_tem_consulta', 'faltam_dados');
  if v_com_motivo_novo = 0 then
    alter table public.ai_decision_log
      validate constraint ai_decision_log_escalation_reason_valida;
  else
    raise notice 'ROLLBACK 20261027120000: % decisao(oes) com motivo novo ficam como estao; o CHECK volta NOT VALID (as escritas novas sao conferidas).',
      v_com_motivo_novo;
  end if;
end;
$motivos$;

-- 8. As duas tabelas novas (com as FKs, os gatilhos e os indices).
drop table public.dados_informados_na_marcacao;
drop table public.ia_atendimento;

-- 9. A unidade da reserva (com a FK, o indice e o gatilho).
drop trigger exigir_unidade_da_reserva_da_mesma_clinica on public.slot_hold;
drop function public.exigir_unidade_da_reserva_da_mesma_clinica();
alter table public.slot_hold
  drop column unit_id;

-- 10. As tres colunas de ai_agent_config (com os grants delas).
alter table public.ai_agent_config
  drop column exige_nome_completo,
  drop column exige_nascimento,
  drop column exige_cpf;

-- 11. Por ultimo, as funcoes dos CHECKs.
drop function public.ia_estado_do_atendimento_valido(jsonb);
drop function public.ia_horarios_oferecidos_validos(jsonb);
drop function public.cpf_valido(text);

-- 12. A conferencia: os sete corpos de antes (md5 da leitura de 27/10/2026),
--     os comentarios de antes, os grants de antes e nada novo.
do $conferencia$
declare
  v_caso record;
begin
  for v_caso in
    select *
      from (values
        ('public.conferir_horario_da_ia(uuid,uuid,uuid,timestamptz,timestamptz,uuid)',
         'cd6ac62d847eac56bf22fb4d8f053ab8', 'eea81b700e276c5e522fdbafd2192254', 'postgres=X/postgres'),
        ('public.reservar_horario_da_ia(uuid,uuid,uuid,timestamptz,uuid)',
         'b851ca98637689e5baf45978e35b5392', '65c3787f755aa9702bacdf57a705ede3',
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.agendar_pela_ia(uuid,uuid,uuid)',
         'adc2fb06ca46d90b5b7f9ee6485731ec', '92aa10f780dcf0f192d179377e09f694',
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.agente_garantir_rascunho(uuid)',
         'dc75e6be0704deda235132fdfc0cc328', 'b40c641a6ad8eaae7c86dcd0fd175cf7', 'postgres=X/postgres'),
        ('public.restaurar_versao_do_agente(uuid,integer)',
         'da40be6b16a3cd80f2f1419dba56caa7', '5f5358359697a72adfed86d0db88af3d',
         'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
        ('public.rotulo_do_motivo_da_ia(text)',
         'cd7db37c0b1229a49b198307ce819187', null, 'postgres=X/postgres,service_role=X/postgres'),
        ('public.motor_manutencao()',
         '3af33e2f420b05e0e25093e78242cd4b', null, 'postgres=X/postgres,service_role=X/postgres')
      ) as t(assinatura, md5, md5_comentario, grants)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.md5
    then
      raise exception 'ROLLBACK 20261027120000: % nao voltou ao corpo de antes', v_caso.assinatura;
    end if;
    if md5(obj_description(to_regprocedure(v_caso.assinatura), 'pg_proc')) is distinct from v_caso.md5_comentario then
      raise exception 'ROLLBACK 20261027120000: o comentario de % nao e o de antes', v_caso.assinatura;
    end if;
    if (select string_agg(a::text, ',' order by a::text)
          from pg_proc p, unnest(p.proacl) a where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.grants
    then
      raise exception 'ROLLBACK 20261027120000: os grants de % nao sao os de antes', v_caso.assinatura;
    end if;
  end loop;
  if to_regclass('public.ia_atendimento') is not null
     or to_regclass('public.dados_informados_na_marcacao') is not null
     or exists (
       select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('cpf_valido', 'ia_horarios_oferecidos_validos', 'ia_estado_do_atendimento_valido',
                            'exigir_unidade_da_reserva_da_mesma_clinica', 'dados_que_faltam_para_marcar',
                            'ia_estado_do_atendimento', 'registrar_dados_da_marcacao',
                            'ler_dados_informados_na_marcacao', 'ler_atendimento_da_ia',
                            'gravar_atendimento_da_ia', 'aplicar_dados_na_aprovacao', 'podar_agendamento_da_ia'))
     or (select count(*) from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('reservar_horario_da_ia', 'conferir_horario_da_ia')) <> 2
     or exists (
       select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and ((c.table_name = 'slot_hold' and c.column_name = 'unit_id')
               or (c.table_name = 'ai_agent_config'
                   and c.column_name in ('exige_nome_completo', 'exige_nascimento', 'exige_cpf'))))
     or exists (
       select 1 from pg_trigger t
        where t.tgname in ('dados_informados_na_aprovacao', 'exigir_unidade_da_reserva_da_mesma_clinica'))
  then
    raise exception 'ROLLBACK 20261027120000: um objeto da migration ficou';
  end if;
  if (select regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '')
        from pg_constraint c
       where c.conrelid = 'public.ai_decision_log'::regclass
         and c.conname = 'ai_decision_log_escalation_reason_valida')
     is distinct from
     'CHECK (((escalation_reason IS NULL) OR (escalation_reason = ANY (ARRAY[''sintoma''::text, ''pedido_humano''::text, ''insatisfacao''::text, ''menor_de_idade''::text, ''valor_fora_da_tabela''::text, ''falhas_seguidas''::text, ''assunto_clinico''::text, ''midia_nao_suportada''::text, ''tentativa_de_manipulacao''::text, ''conformidade''::text, ''agente_pediu''::text, ''teto_atingido''::text, ''regra_do_procedimento''::text, ''falha_tecnica''::text, ''teto_de_respostas''::text, ''nao_individual''::text, ''pedido_de_agenda''::text, ''fora_do_assunto''::text]))))'
  then
    raise exception 'ROLLBACK 20261027120000: o CHECK de escalation_reason nao e o de 20261022110000';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
