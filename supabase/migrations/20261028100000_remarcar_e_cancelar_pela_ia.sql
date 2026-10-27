-- ---------------------------------------------------------------------------
-- Remarcar e cancelar pela IA (AG4, parte de banco): o cancelamento da
-- consulta pela IA, a remarcacao como consulta nova pendente ligada a
-- antiga, os prazos da clinica e os tres pontos que a AG3 deixou (33.14)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: a IA faz todo o atendimento e o agendamento,
-- e isso inclui cancelar e remarcar a consulta que a pessoa ja tem. Ate aqui
-- (AG3, 20261027120000) a IA busca, reserva e marca a consulta pendente;
-- cancelar e remarcar passam para a equipe (pedido_de_agenda). Esta
-- migration e o BANCO da etapa AG4; o codigo do agente (lib/agente) e as
-- telas vem em outras frentes, lendo este contrato.
--
-- DECISOES DO DONO QUE VALEM: D-9 (cancelar pela IA como o botao da
-- confirmacao, com a confirmacao numa mensagem nova e o prazo da clinica;
-- dentro do prazo, passa para a equipe), D-10 (remarcar cria consulta nova
-- pendente, ligada a antiga; a antiga vale ate a aprovacao), D-13 (ao
-- modelo, so dia e hora das consultas que a pessoa ja tem) e D-2 (a
-- consulta da IA nasce pendente). DECISOES AINDA PENDENTES, construidas com
-- a recomendacao (trocar e uma migration pequena): D-24 (os prazos sao dois
-- campos versionados da configuracao, vazios; sem o prazo, a habilidade nao
-- liga e as RPCs recusam); D-25 (a IA mexe em toda consulta futura do
-- contato numa das quatro situacoes antes do atendimento, inclusive as da
-- recepcao, e cancela a pendente que ela marcou; nunca encaixe,
-- procedimento ou vinculo so com a equipe, remarcacao pendente, passada,
-- recusada ou encerrada); D-26 (a remarcacao muda dia, hora e unidade,
-- mantem procedimento, profissional e convenio ou particular, nao pede dado,
-- mantem as recusas de outra pessoa e de menor, exige Agendar ligada, e a
-- consulta ainda pendente da equipe nao se remarca pela IA); D-27 (na
-- aprovacao, a antiga vira Cancelado pelo paciente, com a reoferta); D-29
-- (na recusa, a antiga fica como esta, com a marca de pedido de
-- remarcacao); D-32 (a recepcao nao move a antiga com remarcacao pendente).
--
-- O QUE MUDA:
--   1. appointment.remarcacao_de (uuid nulo, FK para a propria tabela, on
--      delete set null; CHECK de nao apontar para si): a consulta nova que
--      a IA pediu como remarcacao aponta a antiga. Indice UNICO parcial
--      appointment_uma_remarcacao_pendente (uma remarcacao pendente e nao
--      cancelada por consulta: o banco impede duas) e o indice parcial da
--      leitura (a FK e os gatilhos). Tres gatilhos:
--      - exigir_remarcacao_da_ia (BEFORE INSERT OR UPDATE OF remarcacao_de):
--        a sessao nunca grava (42501 sem_permissao); a antiga e da mesma
--        clinica e do mesmo contato (23503); o valor nao muda depois de
--        gravado (23514 remarcacao_nao_muda), so vira nulo pela FK, ao
--        apagar a antiga;
--      - remarcacao_pendente_trava_a_antiga (BEFORE UPDATE OF starts_at,
--        ends_at, professional_id, unit_id; D-32): mover a antiga com
--        remarcacao pendente (o inicio, o fim, o profissional ou a unidade)
--        e 23514 remarcacao_pendente, com a dica para a tela;
--      - remarcacao_na_aprovacao (AFTER UPDATE OF approval_status, o ultimo
--        na ordem alfabetica, depois de dados_informados_na_aprovacao; D-27):
--        a remarcacao aprovada trava a antiga e, numa das quatro situacoes
--        antes do atendimento (mesmo no passado: o pedido veio antes da
--        hora, nao e inferir falta), a cancela como Cancelado pelo
--        paciente, com a trilha de quem aprovou (sem sessao, sistema); a
--        reoferta e o gatilho de sempre (so consulta futura); a antiga ja
--        cancelada fica; na recepcao, em atendimento, compareceu ou faltou,
--        23514 remarcacao_consulta_antiga_encerrada e a aprovacao nao
--        acontece.
--   2. appointment_status_history.ia_job_id (uuid nulo; CHECK: so com
--      changed_by ia e sem usuario, o que a policy de insert da sessao
--      nunca deixa; unico parcial): o job da IA que cancelou a consulta, a
--      idempotencia de cancelar_consulta_pela_ia. Sem FK (a fila e podada).
--   3. ai_agent_config.cancelar_antecedencia_horas e
--      remarcar_antecedencia_horas (integer nulo, 0 a 720; grant por coluna
--      de select e update para authenticated, como os exige_*; versionadas;
--      nascem nulas, a clinica preenche): a IA so age se a consulta comeca
--      depois de agora + o prazo (na remarcacao, o inicio da ANTIGA; o
--      horario novo segue a antecedencia e o horizonte da agenda).
--      agente_garantir_rascunho e restaurar_versao_do_agente copiam as duas
--      (CREATE OR REPLACE do corpo de producao, marca [remarcar e
--      cancelar]).
--   4. ai_decision_log_escalation_reason_valida ganha fora_do_prazo (drop e
--      add do mesmo nome, NOT VALID e VALIDATE), e rotulo_do_motivo_da_ia o
--      texto dele.
--   5. Duas funcoes internas (nenhum papel da API executa):
--      conferir_consulta_da_ia (a consulta que a IA pode cancelar ou
--      remarcar, com as recusas na ordem do contrato) e
--      pedido_da_ia_na_conversa (o pedido armado no estado da janela atual,
--      para o job).
--   6. cancelar_consulta_pela_ia (RPC nova, so service role): a mesma
--      transicao do botao (cancelar_pelo_paciente: o mesmo update
--      condicional para cancelado_paciente, a reoferta e a regua parada
--      pelos gatilhos e pelo executor de sempre) com as travas da IA: a
--      trava da conversa, o job, a idempotencia pela trilha, a conversa com
--      a IA, a habilidade e o prazo, o pedido armado, a consulta travada e
--      conferida, a consulta que nao mudou, o pedido ainda valido
--      (pedido_vencido, VALIDADE DO PEDIDO abaixo) e a confirmacao do
--      paciente pela ancora forte: a ultima mensagem de saida antes da
--      ultima mensagem do paciente e a resposta da IA (que nao falhou)
--      gravada depois do pedido; qualquer outra saida no meio (regua,
--      campanha, agendada, a equipe, o sistema; evento e nota interna nao
--      contam) e sem_confirmacao_do_paciente. A trilha leva autor ia e o
--      job; o evento da conversa diz procedimento e profissional. O botao
--      nao muda.
--   7. reservar_horario_da_ia e agendar_pela_ia ganham p_remarcar (DROP e
--      CREATE com os grants de antes; o codigo de hoje chama por nome com 6
--      e 4 parametros e continua igual): a remarcacao. O agendar trava a
--      antiga, cria a nova pendente com remarcacao_de e, na antiga, faz o
--      que o botao Remarcar faz (a marca, os toques pulados e a linha de
--      evento, agora com autor ia). Na remarcacao, o ja_tem_consulta nao
--      vale (33.14, ponto 3; a remarcacao troca uma consulta por outra:
--      outra consulta do mesmo procedimento, inclusive a pendente da IA,
--      nao barra), e o "sim" do agendar segue a ancora forte do cancelar,
--      com a reserva no lugar do pedido. Sem p_remarcar, os dois ficam
--      como na producao (AG3).
--   8. gravar_atendimento_da_ia (CREATE OR REPLACE, mesma assinatura): a
--      reserva lida uma vez so (33.14, ponto 1); o instante do pedido e do
--      banco (agora quando o pedido ou o foco mudam; o do estado de antes
--      quando nao mudam e ele ainda vale; vencido, agora de novo: a IA que
--      pergunta outra vez re-arma o pedido; o que o codigo manda e
--      ignorado); pedido sem consulta em foco e 22023.
--   9. ler_dados_informados_na_marcacao ganha p_campo (DROP e CREATE com os
--      grants de antes; 33.14, ponto 2): com cpf ou carteirinha, so aquele
--      dado volta e a trilha e revelou_dado_da_marcacao com o campo.
--  10. devolver_conversa_da_consulta_recusada (CREATE OR REPLACE): o texto
--      do evento quando a recusada e uma remarcacao.
--
-- CONTRATO para as frentes de codigo e de telas: os COMMENT ON de cada
-- funcao, coluna e gatilho abaixo (assinatura, retorno, motivos, erros) e o
-- arquivo do desenho (scratchpad/ag4, com as mudancas em
-- contrato-mudancas.md). Nos espelhos do TypeScript, MOTIVOS_DE_ESCALONAMENTO
-- e TEXTO_DO_EVENTO_DA_IA ganham fora_do_prazo.
--
-- VALIDADE DO PEDIDO (revisao de 27/10/2026; DECISAO A CONFIRMAR COM O
-- DONO): o pedido de cancelar vale por 60 MINUTOS a partir do instante dele
-- (c_validade_do_pedido: a MESMA constante no corpo de
-- cancelar_consulta_pela_ia e no de gravar_atendimento_da_ia; trocar o
-- valor e trocar nos dois). Depois disso, cancelar_consulta_pela_ia recusa
-- pedido_vencido (depois de consulta_mudou, antes de
-- sem_confirmacao_do_paciente), e o gravar, com o mesmo pedido e o mesmo
-- foco, carimba o instante de novo (a IA pergunta outra vez e o pedido e
-- re-armado; sem isso, todo "sim" seguinte daria pedido_vencido). Por que:
-- o "sim" de horas ou dias depois da pergunta pode responder outra coisa. A
-- remarcacao nao usa a validade: a ancora dela e a reserva, que vence em 10
-- minutos.
--
-- Producao em 27/10/2026 (q.js, so leitura): a ultima migration aplicada e a
-- 20261027120000; 15 consultas (nenhuma da IA, nenhuma futura, nenhuma
-- pendente), 30 linhas na trilha delas (nenhuma de evento), 3 versoes do
-- agente (todas publicadas, skills vazio), 3 decisoes da IA (2 com motivo,
-- nenhum fora_do_prazo). Nenhuma linha muda de valor: as colunas novas
-- nascem nulas.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa: ai_agent_config, ai_decision_log, appointment e
-- appointment_status_history em ACCESS EXCLUSIVE (os ALTER; appointment
-- tambem pelos gatilhos, pela FK para si mesma e pelos indices). Cada
-- tentativa pede as quatro com NOWAIT; com uma ocupada, solta as que pegou
-- (o savepoint do bloco), espera 100 ms SEM trava nenhuma e tenta de novo,
-- ate 30 vezes (uns 3 s); depois falha inteira com 55P03, nada gravado:
-- rodar de novo. Assim a migration nunca espera trava com outra na mao e nao
-- fecha ciclo (40P01) com sessao nenhuma. Depois do bloco, so pede travas
-- que ja tem e nunca espera; o lock_timeout de 3 s fica de rede. Os DROP e
-- CREATE de funcao so pegam a trava do objeto da funcao.
-- Quanto tempo: do bloco ao commit, de 11 a 54 ms no Postgres local (15
-- rodadas em tres momentos, com o commit; a diferenca e a carga da maquina):
-- os ADD COLUMN sao so de catalogo (sem default, nao reescrevem), a FK, o
-- CHECK e os dois indices de appointment varrem as 15 consultas, o VALIDATE
-- varre as 3 decisoes da IA, e o resto e catalogo.
-- Nesse tempo, as quatro tabelas nem leem nem gravam: a Agenda (leitura e
-- escrita de consultas), o turno da IA e a Tela 6 esperam os milissegundos.
-- Nenhuma trava em message, conversation, contact, slot_hold, job_queue,
-- audit_log, cadence_run, ia_atendimento nem ia_janela_da_conversa.
-- Horario calmo.
--
-- ORDEM DE PUBLICACAO: esta migration, os tipos
-- (lib/supabase/database.types.ts foi escrito a mao no formato do gerador;
-- regenerar depois de aplicar) e SO DEPOIS o codigo da AG4. Esta migration
-- com o codigo de hoje: nada muda (os parametros novos sao nulos, as
-- colunas novas sao nulas, a RPC nova nao tem quem chame, os gatilhos so
-- agem com remarcacao_de, o gravar tem a mesma semantica para quem nunca
-- arma pedido (o codigo de hoje nao arma), ler_dados sem o campo e igual, a
-- configuracao e lida por colunas explicitas). O codigo da AG4 antes desta
-- migration: 42703 nas colunas novas da configuracao, e a IA de todas as
-- clinicas falha fechada. Os testes de unidade dos espelhos
-- (tests/unit/agente/config.test.ts e tests/unit/ia-whatsapp/espelhos.test.ts)
-- leem o CHECK de escalation_reason: este arquivo e fora_do_prazo nos
-- espelhos entram no MESMO commit.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo da AG4 e resolver
-- (aprovar ou recusar) as remarcacoes pendentes (o rollback se recusa com
-- uma pendente); DEPOIS, numa transacao, no SQL editor,
-- supabase/operacao/rollback/20261028100000-corpos-anteriores.sql (os oito
-- corpos de antes, com os comentarios e os grants: o reservar de 6, o
-- agendar de 4 e o ler_dados de 2 voltam; as funcoes, os gatilhos, as
-- colunas e os indices novos saem; o CHECK de antes, NOT VALID se ja houver
-- decisao com fora_do_prazo; confere no fim). SE PERDE: o elo das
-- remarcacoes ja resolvidas (as consultas ficam), o job da IA na trilha dos
-- cancelamentos (a linha fica, com autor ia) e os prazos escolhidos.
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 0) As travas, todas aqui, antes de qualquer mudanca (cabecalho, TRAVAS)
-- ---------------------------------------------------------------------------
-- Ordem fixa, cada tabela ja no modo mais forte que a migration pede nela.
-- NOWAIT: tabela ocupada solta o que esta tentativa pegou (o savepoint do
-- bloco) e espera 100 ms sem trava nenhuma; 30 tentativas, depois 55P03 e
-- nada gravado. Nunca espera com trava na mao: nao fecha ciclo com sessao.

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
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261028100000: ai_agent_config, ai_decision_log, appointment ou appointment_status_history seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) appointment.remarcacao_de: a remarcacao pedida pela IA
-- ---------------------------------------------------------------------------

alter table public.appointment
  add column remarcacao_de uuid
    constraint appointment_remarcacao_de_fkey references public.appointment (id) on delete set null,
  add constraint appointment_remarcacao_de_outra_consulta check (remarcacao_de <> id);

-- Uma remarcacao pendente (e nao cancelada) por consulta: duas conversas
-- pedindo a remarcacao da mesma consulta param no banco. A leitura sob a
-- trava da antiga (agendar_pela_ia) ja recusa antes; isto e a defesa em
-- profundidade.
create unique index appointment_uma_remarcacao_pendente
  on public.appointment (remarcacao_de)
  where remarcacao_de is not null
    and approval_status = 'pendente'
    and status not in ('cancelado_paciente', 'cancelado_clinica');

-- A leitura (os gatilhos, a Agenda) e a FK (apagar a antiga).
create index appointment_remarcacao_de_idx
  on public.appointment (remarcacao_de)
  where remarcacao_de is not null;

comment on column public.appointment.remarcacao_de is
  'A consulta antiga, quando esta e a remarcacao que a IA pediu (AG4, D-10): a nova nasce pendente e a antiga vale ate a aprovacao (o gatilho remarcacao_na_aprovacao a cancela). So o servidor grava (agendar_pela_ia com p_remarcar; a sessao, 42501), da mesma clinica e do mesmo contato, e o valor nao muda; vira nulo se a antiga for apagada. Uma remarcacao pendente por consulta (appointment_uma_remarcacao_pendente).';

-- ---------------------------------------------------------------------------
-- 2) appointment_status_history.ia_job_id: o job da IA que cancelou
-- ---------------------------------------------------------------------------

alter table public.appointment_status_history
  add column ia_job_id uuid,
  add constraint appointment_status_history_ia_job_id_coerente check (
    ia_job_id is null or (changed_by = 'ia' and changed_by_user_id is null));

create unique index appointment_status_history_ia_job_id_unico
  on public.appointment_status_history (ia_job_id)
  where ia_job_id is not null;

comment on column public.appointment_status_history.ia_job_id is
  'O job da IA (job_queue, sem FK: a fila e podada) que cancelou a consulta (cancelar_consulta_pela_ia, AG4): a idempotencia do cancelamento, uma linha por job. So com changed_by ia e sem usuario (CHECK): a sessao nunca grava (a policy de insert exige o proprio usuario).';

-- ---------------------------------------------------------------------------
-- 3) ai_agent_config: os prazos para a IA cancelar e remarcar
-- ---------------------------------------------------------------------------

alter table public.ai_agent_config
  add column cancelar_antecedencia_horas integer,
  add column remarcar_antecedencia_horas integer,
  add constraint ai_agent_config_cancelar_antecedencia_faixa check (
    cancelar_antecedencia_horas between 0 and 720),
  add constraint ai_agent_config_remarcar_antecedencia_faixa check (
    remarcar_antecedencia_horas between 0 and 720);

-- As mesmas permissoes por coluna de skills e dos exige_* (a tabela nao tem
-- grant de tabela para authenticated, so por coluna, e nada para anon). A
-- policy de UPDATE continua so no rascunho, so administrador e gestor (e o
-- super admin); a publicada nao muda (proteger_versao_publicada_do_agente).
grant select (cancelar_antecedencia_horas, remarcar_antecedencia_horas),
      update (cancelar_antecedencia_horas, remarcar_antecedencia_horas)
  on public.ai_agent_config to authenticated;

comment on column public.ai_agent_config.cancelar_antecedencia_horas is
  'O prazo da clinica para a IA cancelar (AG4, D-24): a IA so cancela consulta que comeca depois de agora + estas horas; com menos tempo, passa para a equipe (fora_do_prazo). 0 a 720. Versionada: vale ao publicar; o rascunho copia a ultima publicada. Nula (o padrao): a habilidade cancelar nao liga e cancelar_consulta_pela_ia recusa (cancelamento_desligado).';
comment on column public.ai_agent_config.remarcar_antecedencia_horas is
  'O prazo da clinica para a IA remarcar (AG4, D-24): a IA so remarca consulta que comeca depois de agora + estas horas (o inicio da antiga; o horario novo segue a antecedencia e o horizonte da agenda); com menos tempo, passa para a equipe (fora_do_prazo). 0 a 720. Versionada: vale ao publicar; o rascunho copia a ultima publicada. Nula (o padrao): a habilidade remarcar nao liga e o reservar e o agendar da remarcacao recusam (remarcacao_desligada).';

create or replace function public.agente_garantir_rascunho(p_clinic_id uuid)
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
      -- [remarcar e cancelar] inicio
      , cancelar_antecedencia_horas, remarcar_antecedencia_horas
      -- [remarcar e cancelar] fim
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
           -- [remarcar e cancelar] inicio
           , a.cancelar_antecedencia_horas, a.remarcar_antecedencia_horas
           -- [remarcar e cancelar] fim
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
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda, o publico atendido, os dados que a IA exige para marcar e os prazos para cancelar e remarcar) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

create or replace function public.restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer)
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
         -- [remarcar e cancelar] inicio
         cancelar_antecedencia_horas = v_origem.cancelar_antecedencia_horas,
         remarcar_antecedencia_horas = v_origem.remarcar_antecedencia_horas,
         -- [remarcar e cancelar] fim
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
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda, o publico atendido, os dados que a IA exige para marcar e os prazos para cancelar e remarcar, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- ---------------------------------------------------------------------------
-- 4) ai_decision_log: o motivo novo de passar para a equipe e o evento dele
-- ---------------------------------------------------------------------------
-- O CHECK de hoje (20261027120000) inteiro, mais fora_do_prazo. Drop e add
-- com o MESMO nome, NOT VALID (o add nao varre a tabela) e VALIDATE em
-- seguida (toda linha valida no CHECK antigo e valida no novo).

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
      'consulta_para_outra_pessoa', 'ja_tem_consulta', 'faltam_dados',
      'fora_do_prazo')) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_escalation_reason_valida;

create or replace function public.rotulo_do_motivo_da_ia(p_motivo text)
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
    -- [remarcar e cancelar] inicio
    when 'fora_do_prazo' then 'A IA passou a conversa para a equipe: o pedido de cancelar ou remarcar ficou dentro do prazo da clínica.'
    -- [remarcar e cancelar] fim
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

-- ---------------------------------------------------------------------------
-- 5) As funcoes internas
-- ---------------------------------------------------------------------------

-- 5a. A consulta que a IA pode cancelar ou remarcar (D-25 e D-26).
create function public.conferir_consulta_da_ia(
  p_clinic_id uuid,
  p_contato uuid,
  p_appointment_id uuid,
  p_acao text,
  p_prazo_horas integer,
  out o_motivo text,
  out o_vinculo uuid,
  out o_procedimento uuid,
  out o_profissional uuid,
  out o_convenio uuid,
  out o_unidade uuid,
  out o_inicio timestamptz,
  out o_fim timestamptz,
  out o_situacao text,
  out o_fuso text,
  out o_nome_do_procedimento text,
  out o_nome_do_profissional text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_consulta record;
begin
  if p_clinic_id is null or p_appointment_id is null or p_acao is null or p_prazo_horas is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if p_acao not in ('cancelar', 'remarcar') then
    raise exception using errcode = '22023', message = 'acao_invalida';
  end if;

  -- 1. A consulta e da clinica e do contato da conversa.
  select a.service_link_id, a.professional_id, a.unit_id, a.starts_at, a.ends_at, a.status,
         a.approval_status, a.is_overbooking, a.remarcacao_de,
         sl.procedure_id, sl.insurance_id,
         sl.active as vinculo_ativo, sl.bookable_by_ai as vinculo_da_ia,
         pr.active as procedimento_ativo, pr.bookable_by_ai as procedimento_da_ia,
         pr.name as nome_do_procedimento, pf.name as nome_do_profissional
    into v_consulta
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
    join public.procedure pr on pr.id = sl.procedure_id and pr.clinic_id = a.clinic_id
    join public.professional pf on pf.id = a.professional_id and pf.clinic_id = a.clinic_id
   where a.id = p_appointment_id
     and a.clinic_id = p_clinic_id
     and a.contact_id = p_contato;
  if not found then
    o_motivo := 'consulta_nao_encontrada';
    return;
  end if;
  o_vinculo := v_consulta.service_link_id;
  o_procedimento := v_consulta.procedure_id;
  o_profissional := v_consulta.professional_id;
  o_convenio := v_consulta.insurance_id;
  o_unidade := v_consulta.unit_id;
  o_inicio := v_consulta.starts_at;
  o_fim := v_consulta.ends_at;
  o_situacao := v_consulta.status;
  o_nome_do_procedimento := v_consulta.nome_do_procedimento;
  o_nome_do_profissional := v_consulta.nome_do_profissional;
  select coalesce(c.timezone, 'America/Fortaleza') into o_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  o_fuso := coalesce(o_fuso, 'America/Fortaleza');

  -- 2. Encerrada: fora das quatro situacoes de antes do atendimento,
  -- passada ou recusada pela equipe. A IA nunca fala de falta (D-25).
  if v_consulta.status not in ('agendado', 'aguardando_confirmacao',
                               'confirmado_paciente', 'confirmado_recepcao')
     or v_consulta.starts_at <= now()
     or v_consulta.approval_status is not distinct from 'recusado'
  then
    o_motivo := 'consulta_encerrada';
    return;
  end if;
  -- 3. Encaixe e sempre da equipe.
  if v_consulta.is_overbooking then
    o_motivo := 'encaixe';
    return;
  end if;
  -- 4. O vinculo ou o procedimento que a IA nao agenda (ou inativo): so com
  -- a equipe.
  if not (v_consulta.vinculo_ativo and v_consulta.vinculo_da_ia
          and v_consulta.procedimento_ativo and v_consulta.procedimento_da_ia)
  then
    o_motivo := 'so_com_a_equipe';
    return;
  end if;
  -- 5. Remarcar a consulta ainda pendente da equipe, nao (D-26). Cancelar,
  -- sim: inclusive a pendente que a IA marcou (conta como recusada).
  if p_acao = 'remarcar' and v_consulta.approval_status is not distinct from 'pendente' then
    o_motivo := 'pendente_da_equipe';
    return;
  end if;
  -- 6. A remarcacao pendente, ou a consulta que tem uma: com a equipe.
  if (v_consulta.remarcacao_de is not null
      and v_consulta.approval_status is not distinct from 'pendente')
     or exists (
       select 1
         from public.appointment n
        where n.remarcacao_de = p_appointment_id
          and n.clinic_id = p_clinic_id
          and n.approval_status = 'pendente'
          and n.status not in ('cancelado_paciente', 'cancelado_clinica'))
  then
    o_motivo := 'remarcacao_pendente';
    return;
  end if;
  -- 7. O prazo da clinica: a IA so age se a consulta comeca depois de
  -- agora + o prazo.
  if v_consulta.starts_at < now() + make_interval(hours => p_prazo_horas) then
    o_motivo := 'fora_do_prazo';
    return;
  end if;
end;
$$;

revoke execute on function public.conferir_consulta_da_ia(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;

comment on function public.conferir_consulta_da_ia(uuid, uuid, uuid, text, integer) is
  'Interna (nenhum papel da API executa): a consulta p_appointment_id que a IA pode cancelar ou remarcar (p_acao cancelar ou remarcar; AG4, D-25 e D-26). o_motivo nulo = pode; senao, nesta ordem: consulta_nao_encontrada (de outra clinica ou de outro contato que p_contato), consulta_encerrada (fora de agendado, aguardando_confirmacao, confirmado_paciente e confirmado_recepcao, ja comecou ou recusada), encaixe, so_com_a_equipe (vinculo ou procedimento sem IA pode agendar, ou inativo), pendente_da_equipe (so em remarcar: ainda pendente de aprovacao), remarcacao_pendente (e uma remarcacao pendente, ou tem uma), fora_do_prazo (comeca antes de agora + p_prazo_horas). Devolve tambem o vinculo, o procedimento, o profissional, o convenio (nulo = particular), a unidade, inicio, fim, situacao, o fuso da clinica e os nomes do procedimento e do profissional (nulos so em consulta_nao_encontrada). Nao trava: quem chama trava a consulta antes, quando vai gravar. Parametro nulo (fora p_contato): 22004; acao fora da lista: 22023.';

-- 5b. O pedido armado no estado do atendimento, para o job.
create function public.pedido_da_ia_na_conversa(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  out o_pedido text,
  out o_appointment_id uuid,
  out o_pedido_em timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_desde timestamptz;
  v_job_criado_em timestamptz;
  v_linha public.ia_atendimento%rowtype;
  v_estado jsonb;
begin
  -- A janela atual da conversa, do contato de agora (como
  -- ler_atendimento_da_ia).
  select w.desde into v_desde
    from public.ia_janela_da_conversa w
    join public.conversation c on c.id = w.conversation_id and c.clinic_id = w.clinic_id
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id
     and w.contact_id = c.contact_id;
  if v_desde is null then
    return;
  end if;
  -- O job e desta conversa e da janela atual (o de antes do Devolver nao
  -- arma nada na janela nova).
  select j.created_at into v_job_criado_em
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if v_job_criado_em is null or v_job_criado_em < v_desde then
    return;
  end if;
  select a.* into v_linha
    from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.clinic_id = p_clinic_id
     and a.janela_desde = v_desde;
  if v_linha.id is null then
    return;
  end if;
  -- O mesmo job que ja gravou parte do estado de antes dele (a
  -- idempotencia por job de ler_atendimento_da_ia).
  if v_linha.job_id = p_job_id then
    v_estado := v_linha.anterior;
  else
    v_estado := public.ia_estado_do_atendimento(v_linha);
  end if;
  if v_estado is null then
    return;
  end if;
  o_pedido := v_estado ->> 'pedido_pendente';
  o_appointment_id := (v_estado ->> 'appointment_id')::uuid;
  o_pedido_em := (v_estado ->> 'pedido_pendente_em')::timestamptz;
end;
$$;

revoke execute on function public.pedido_da_ia_na_conversa(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.pedido_da_ia_na_conversa(uuid, uuid, uuid) is
  'Interna (nenhum papel da API executa): o pedido armado no estado do atendimento da IA (ia_atendimento) da janela atual da conversa, como o job p_job_id o le: o_pedido (cancelar, remarcar ou nulo), o_appointment_id (a consulta em foco) e o_pedido_em (o instante do pedido, carimbado pelo banco em gravar_atendimento_da_ia). O mesmo job que ja gravou le o estado de antes dele (anterior). Tudo nulo sem janela (ou com a janela de outro contato), sem estado, ou com job que nao e responder_com_ia desta clinica e conversa ou que e de antes da janela.';

-- ---------------------------------------------------------------------------
-- 6) O cancelamento pela IA
-- ---------------------------------------------------------------------------

create function public.cancelar_consulta_pela_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A validade do pedido (cabecalho, VALIDADE DO PEDIDO; DECISAO A
  -- CONFIRMAR COM O DONO). A mesma constante esta em
  -- gravar_atendimento_da_ia: trocar o valor e trocar nos dois.
  c_validade_do_pedido constant interval := interval '60 minutes';
  v_trilha record;
  v_conversa record;
  v_config record;
  v_pedido record;
  v_conf record;
  v_pergunta timestamptz;
  v_sim timestamptz;
  v_inicio timestamptz;
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null
     or p_appointment_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A trava da conversa, a mesma do reservar, do agendar e do registrar
  -- dados: um turno por vez mexe na agenda desta conversa. Depois dela, so
  -- a consulta (abaixo). Ninguem trava a consulta e depois a conversa.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- O job e desta conversa (senao 22023, erro de quem chama).
  if not exists (
    select 1
      from public.job_queue j
     where j.id = p_job_id
       and j.kind = 'responder_com_ia'
       and j.clinic_id = p_clinic_id
       and j.payload ->> 'conversation_id' = p_conversation_id::text
  ) then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;

  -- Idempotencia: o cancelamento deste job volta como foi.
  select h.appointment_id, h.clinic_id into v_trilha
    from public.appointment_status_history h
   where h.ia_job_id = p_job_id;
  if found then
    if v_trilha.clinic_id is distinct from p_clinic_id
       or v_trilha.appointment_id is distinct from p_appointment_id then
      raise exception using errcode = '22023', message = 'job_de_outra_consulta';
    end if;
    return jsonb_build_object(
      'ok', true,
      'starts_at', (select a.starts_at from public.appointment a where a.id = p_appointment_id),
      'reutilizado', true);
  end if;

  -- A conversa e da clinica, esta com a IA, e a IA pode atender este
  -- contato neste numero (a mesma pergunta do reservar e do agendar).
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
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;

  -- A versao em uso (a ultima publicada): Cancelar ligada e o prazo
  -- preenchido (D-24: ninguem inventa o prazo).
  select a.skills, a.cancelar_antecedencia_horas into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found
     or (v_config.skills ->> 'cancelar') is distinct from 'true'
     or v_config.cancelar_antecedencia_horas is null
  then
    return jsonb_build_object('ok', false, 'motivo', 'cancelamento_desligado');
  end if;

  -- O pedido: o turno anterior perguntou "Confirma o cancelamento ...?"
  -- desta consulta (o estado da janela atual com o pedido cancelar e o foco
  -- nela).
  select * into v_pedido
    from public.pedido_da_ia_na_conversa(p_clinic_id, p_conversation_id, p_job_id);
  if v_pedido.o_pedido is distinct from 'cancelar'
     or v_pedido.o_appointment_id is distinct from p_appointment_id
     or v_pedido.o_pedido_em is null
  then
    return jsonb_build_object('ok', false, 'motivo', 'sem_pedido_de_cancelamento');
  end if;

  -- A consulta travada e conferida (o que foi lido antes da trava e lido
  -- de novo): do contato, numa das quatro situacoes, futura, nao encaixe,
  -- de vinculo que a IA agenda, sem remarcacao pendente e fora do prazo.
  perform 1
    from public.appointment a
   where a.id = p_appointment_id
     and a.clinic_id = p_clinic_id
     for update;
  select * into v_conf
    from public.conferir_consulta_da_ia(p_clinic_id, v_conversa.contact_id, p_appointment_id,
                                        'cancelar', v_config.cancelar_antecedencia_horas);
  if v_conf.o_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_conf.o_motivo);
  end if;

  -- A consulta mudou de horario ou de profissional desde a pergunta (a
  -- pergunta disse o horario de antes). Folga de 2 minutos: a pergunta foi
  -- montada com a leitura do comeco do turno, e o instante do pedido e o do
  -- fim (um turno dura no maximo 60 s).
  if exists (
    select 1
      from public.appointment_status_history h
     where h.appointment_id = p_appointment_id
       and h.clinic_id = p_clinic_id
       and h.kind = 'remarcacao'
       and h.changed_at > v_pedido.o_pedido_em - interval '2 minutes'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_mudou');
  end if;

  -- O pedido ainda vale (c_validade_do_pedido, 60 minutos depois do
  -- instante dele): o "sim" de horas ou dias depois da pergunta pode
  -- responder outra coisa. Vencido, a IA pergunta de novo (o gravar carimba
  -- o instante outra vez).
  if v_pedido.o_pedido_em <= now() - c_validade_do_pedido then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_vencido');
  end if;

  -- O "sim" responde a pergunta da IA (a ancora forte): a ULTIMA mensagem
  -- do paciente tem, como ultima mensagem de saida antes dela, a resposta da
  -- IA (que nao falhou) gravada depois do instante do pedido. Conta toda
  -- saida que nao e evento nem nota interna, de qualquer autor (regua,
  -- campanha, agendada, a equipe, o sistema) e em qualquer situacao de
  -- entrega: com outra mensagem no meio, o "sim" pode ser a resposta a ela.
  -- Empate no instante conta como outra no meio (o lado seguro). O que
  -- chega depois da ultima mensagem do paciente nao conta.
  select max(m.created_at) into v_sim
    from public.message m
   where m.conversation_id = p_conversation_id
     and m.clinic_id = p_clinic_id
     and m.direction = 'entrada'
     and m.author = 'paciente';
  select max(x.created_at) into v_pergunta
    from public.message x
   where x.conversation_id = p_conversation_id
     and x.clinic_id = p_clinic_id
     and x.direction = 'saida'
     and x.author = 'ia'
     and x.content_type <> 'evento'
     and not x.is_internal_note
     and x.delivery_status is distinct from 'falhou'
     and x.created_at > v_pedido.o_pedido_em
     and x.created_at < v_sim;
  if v_pergunta is null or exists (
    select 1
      from public.message o
     where o.conversation_id = p_conversation_id
       and o.clinic_id = p_clinic_id
       and o.direction = 'saida'
       and o.content_type <> 'evento'
       and not o.is_internal_note
       and (o.author is distinct from 'ia' or o.delivery_status is not distinct from 'falhou')
       and o.created_at >= v_pergunta
       and o.created_at < v_sim
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
  end if;

  -- A transicao do botao (cancelar_pelo_paciente): o mesmo update
  -- condicional. A reoferta (oferecer_ao_cancelar) e a marca de pedido de
  -- remarcacao (limpar_pedido_de_remarcacao) sao os gatilhos de sempre; a
  -- regua para no executor (a consulta cancelada).
  update public.appointment a
     set status = 'cancelado_paciente'
   where a.id = p_appointment_id
     and a.clinic_id = p_clinic_id
     and a.contact_id = v_conversa.contact_id
     and a.status in ('agendado', 'aguardando_confirmacao',
                      'confirmado_paciente', 'confirmado_recepcao')
     and a.starts_at > now()
  returning a.starts_at into v_inicio;
  if v_inicio is null then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_encerrada');
  end if;

  -- A trilha, com autor ia e o job (a idempotencia).
  insert into public.appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by, ia_job_id
  ) values (
    p_clinic_id, p_appointment_id, 'cancelado_paciente', null, 'ia', p_job_id
  );

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
    'A IA cancelou a consulta de '
      || to_char(v_inicio at time zone v_conf.o_fuso, 'DD/MM') || ' às '
      || to_char(v_inicio at time zone v_conf.o_fuso, 'HH24:MI')
      || ' (' || v_conf.o_nome_do_procedimento || ', ' || v_conf.o_nome_do_profissional
      || '), a pedido do paciente.',
    false, 0
  );

  return jsonb_build_object('ok', true, 'starts_at', v_inicio, 'reutilizado', false);
end;
$$;

revoke execute on function public.cancelar_consulta_pela_ia(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancelar_consulta_pela_ia(uuid, uuid, uuid, uuid)
  to service_role;

comment on function public.cancelar_consulta_pela_ia(uuid, uuid, uuid, uuid) is
  'So o servidor (service_role). A IA cancela a consulta p_appointment_id a pedido do paciente (AG4, D-9), com a mesma transicao do botao da confirmacao (cancelar_pelo_paciente: cancelado_paciente pelo mesmo update condicional; reoferta e regua pelos gatilhos e pelo executor de sempre). Na ordem: a trava da conversa (a do reservar e do agendar); o job responder_com_ia desta clinica e conversa (senao 22023 job_invalido); a idempotencia (a linha da trilha com ia_job_id = p_job_id devolve {ok:true, starts_at, reutilizado:true}; de outra consulta, 22023 job_de_outra_consulta); ia_desligada (conversa de outra clinica, fora da IA, ou contato que a IA nao atende); cancelamento_desligado (a ultima versao publicada sem skills.cancelar ou sem cancelar_antecedencia_horas); sem_pedido_de_cancelamento (o estado da janela atual sem o pedido cancelar com o foco nesta consulta, pedido_da_ia_na_conversa); a consulta travada (FOR UPDATE) e os motivos de conferir_consulta_da_ia (consulta_nao_encontrada, consulta_encerrada, encaixe, so_com_a_equipe, remarcacao_pendente, fora_do_prazo); consulta_mudou (linha kind remarcacao na trilha depois do instante do pedido menos 2 minutos); pedido_vencido (o pedido armado ha 60 minutos ou mais, c_validade_do_pedido; a confirmar com o dono); sem_confirmacao_do_paciente (a ancora forte: a ultima mensagem de saida antes da ultima mensagem do paciente nao e a resposta da IA, que nao falhou, gravada depois do instante do pedido; conta toda saida que nao e evento nem nota interna, de qualquer autor e em qualquer situacao de entrega; empate no instante conta como outra saida). Grava a trilha (cancelado_paciente, changed_by ia, ia_job_id) e o evento na conversa ("A IA cancelou a consulta de DD/MM às HH:MI (procedimento, profissional), a pedido do paciente."), nunca a resposta ao paciente. Devolve {ok:true, starts_at, reutilizado:false} ou {ok:false, motivo}. Parametro nulo: 22004. Nunca 40001 nem 40P01.';

-- ---------------------------------------------------------------------------
-- 7) A reserva e o agendar, com a remarcacao
-- ---------------------------------------------------------------------------

-- 7a. Um parametro a mais com default: o codigo de hoje (6 parametros por
-- nome) continua chamando, e o PostgREST nao ve duas funcoes.
drop function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid);

create function public.reservar_horario_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_service_link_id uuid,
  p_starts_at timestamptz,
  p_job_id uuid,
  p_unit_id uuid default null,
  -- [remarcar e cancelar] a consulta antiga, na remarcacao (nula = como antes)
  p_remarcar uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profissional uuid;
  v_recurso uuid;
  v_reserva public.slot_hold%rowtype;
  v_conf record;
  -- [revisao final] inicio
  v_ja_marcada uuid;
  v_ja_marcada_em timestamptz;
  -- [revisao final] fim
  -- [remarcar e cancelar] inicio
  v_config record;
  v_pedido record;
  v_antiga record;
  v_vinculo_novo record;
  -- [remarcar e cancelar] fim
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

  -- [remarcar e cancelar] inicio
  -- A remarcacao (AG4, D-10 e D-26): a habilidade e o prazo da versao em
  -- uso, o pedido do estado com o foco na antiga, a antiga que a IA pode
  -- remarcar (conferir_consulta_da_ia) e o vinculo novo com o mesmo
  -- procedimento, profissional e convenio (ou particular) da antiga. A
  -- conferencia do horario, acima, ja exige Agendar ligada
  -- (agenda_nao_configurada). Nada grava na antiga.
  if p_remarcar is not null then
    select a.skills, a.remarcar_antecedencia_horas into v_config
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1;
    if not found
       or (v_config.skills ->> 'remarcar') is distinct from 'true'
       or v_config.remarcar_antecedencia_horas is null
    then
      return jsonb_build_object('ok', false, 'motivo', 'remarcacao_desligada');
    end if;
    select * into v_pedido
      from public.pedido_da_ia_na_conversa(p_clinic_id, p_conversation_id, p_job_id);
    if v_pedido.o_pedido is distinct from 'remarcar'
       or v_pedido.o_appointment_id is distinct from p_remarcar
    then
      return jsonb_build_object('ok', false, 'motivo', 'sem_pedido_de_remarcacao');
    end if;
    select * into v_antiga
      from public.conferir_consulta_da_ia(p_clinic_id, v_conf.o_contato, p_remarcar, 'remarcar',
                                          v_config.remarcar_antecedencia_horas);
    if v_antiga.o_motivo is not null then
      return jsonb_build_object('ok', false, 'motivo', v_antiga.o_motivo);
    end if;
    select sl.procedure_id, sl.professional_id, sl.insurance_id into v_vinculo_novo
      from public.service_link sl
     where sl.id = p_service_link_id
       and sl.clinic_id = p_clinic_id;
    if v_vinculo_novo.procedure_id is distinct from v_antiga.o_procedimento
       or v_vinculo_novo.professional_id is distinct from v_antiga.o_profissional
       or v_vinculo_novo.insurance_id is distinct from v_antiga.o_convenio
    then
      return jsonb_build_object('ok', false, 'motivo', 'remarcacao_invalida');
    end if;
  end if;
  -- [remarcar e cancelar] fim

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
     -- [remarcar e cancelar] So fora da remarcacao: a remarcacao troca uma
     -- consulta por outra, e nenhuma conta (nem a antiga, nem outra do
     -- mesmo procedimento, nem a pendente que a IA marcou)
     and p_remarcar is null
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
$$;

revoke execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid, uuid)
  to service_role;

comment on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid, uuid, uuid) is
  'So o servidor (service_role). A IA reserva por 10 minutos o horario p_starts_at do vinculo p_service_link_id para a conversa (uma reserva por conversa), na unidade p_unit_id (AG3; nula = como antes, a jornada de todas as unidades). Confere tudo de novo no banco (conferir_horario_da_ia) sob trava da conversa, do profissional e, quando o procedimento tem, do recurso. p_remarcar (AG4; nulo = como antes): a consulta antiga da remarcacao; depois da conferencia do horario, recusa remarcacao_desligada (habilidade remarcar desligada ou sem remarcar_antecedencia_horas na versao em uso), sem_pedido_de_remarcacao (o estado da janela atual nao tem o pedido remarcar com o foco nela, pedido_da_ia_na_conversa), os motivos de conferir_consulta_da_ia (consulta_nao_encontrada, consulta_encerrada, encaixe, so_com_a_equipe, pendente_da_equipe, remarcacao_pendente, fora_do_prazo) e remarcacao_invalida (o vinculo novo com outro procedimento, profissional ou convenio); nada grava na antiga, e o ja_tem_consulta nao vale (a remarcacao troca uma consulta por outra: outra consulta futura do mesmo procedimento, inclusive a pendente da IA, nao barra). Devolve {ok:true, hold_id, starts_at, ends_at, expires_at, reutilizado, unit_id} ou {ok:false, motivo}: ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado, reservado_por_outra_conversa; depois os da remarcacao; depois, so sem p_remarcar, ja_tem_consulta (revisao final; com appointment_id e starts_at da consulta futura ativa do mesmo procedimento que o contato ja tem, com qualquer profissional, a mais proxima, pela mesma regra do agendar; nada grava). Idempotente pelo job_id (a reserva do job volta com reutilizado true, como esta; job de outra conversa: 22023). Parametro nulo: 22004.';

-- 7b. Idem (o codigo de hoje chama com 4 parametros por nome).
drop function public.agendar_pela_ia(uuid, uuid, uuid, uuid);

create function public.agendar_pela_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_slot_hold_id uuid default null,
  -- [remarcar e cancelar] a consulta antiga, na remarcacao (nula = como antes)
  p_remarcar uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  -- [remarcar e cancelar] inicio
  v_config record;
  v_pedido record;
  v_antiga record;
  v_vinculo_novo record;
  v_restricao text;
  v_situacao_da_antiga text;
  -- O inicio da antiga num escalar: o campo de um record nao atribuido
  -- falha ate num ramo do CASE que nao roda (o PL/pgSQL avalia antes).
  v_inicio_da_antiga timestamptz;
  v_sim timestamptz;
  -- [remarcar e cancelar] fim
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
             -- [remarcar e cancelar] a antiga, quando a consulta e remarcacao
             || case when a.remarcacao_de is null then '{}'::jsonb
                     else jsonb_build_object(
                            'remarcacao_de', a.remarcacao_de,
                            'remarcacao_de_starts_at', (
                              select x.starts_at from public.appointment x
                               where x.id = a.remarcacao_de))
                end
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

  -- [remarcar e cancelar] inicio
  -- A remarcacao (AG4, D-10 e D-26), na ordem: a habilidade e o prazo da
  -- versao em uso, o pedido do estado com o foco na antiga, a antiga
  -- TRAVADA (depois da conversa, do profissional, da reserva e do recurso:
  -- ninguem trava a antiga e depois a nova), a antiga que a IA pode
  -- remarcar (conferir_consulta_da_ia, lida sob a trava: duas remarcacoes
  -- da mesma consulta param aqui, em remarcacao_pendente, antes do insert),
  -- o vinculo da reserva com o mesmo procedimento, profissional e convenio
  -- (ou particular) e a antiga que nao mudou de horario nem de profissional
  -- desde a reserva (a pergunta T3, que o "sim" confirma, saiu no turno da
  -- reserva e disse o horario da antiga; folga de 2 minutos: a leitura do
  -- turno vem antes da reserva, e um turno dura no maximo 60 s).
  if p_remarcar is not null then
    select a.skills, a.remarcar_antecedencia_horas into v_config
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1;
    if not found
       or (v_config.skills ->> 'remarcar') is distinct from 'true'
       or v_config.remarcar_antecedencia_horas is null
    then
      return jsonb_build_object('ok', false, 'motivo', 'remarcacao_desligada');
    end if;
    select * into v_pedido
      from public.pedido_da_ia_na_conversa(p_clinic_id, p_conversation_id, p_job_id);
    if v_pedido.o_pedido is distinct from 'remarcar'
       or v_pedido.o_appointment_id is distinct from p_remarcar
    then
      return jsonb_build_object('ok', false, 'motivo', 'sem_pedido_de_remarcacao');
    end if;
    perform 1
      from public.appointment a
     where a.id = p_remarcar
       and a.clinic_id = p_clinic_id
       for update;
    select * into v_antiga
      from public.conferir_consulta_da_ia(p_clinic_id, v_conf.o_contato, p_remarcar, 'remarcar',
                                          v_config.remarcar_antecedencia_horas);
    if v_antiga.o_motivo is not null then
      return jsonb_build_object('ok', false, 'motivo', v_antiga.o_motivo);
    end if;
    v_inicio_da_antiga := v_antiga.o_inicio;
    select sl.procedure_id, sl.professional_id, sl.insurance_id into v_vinculo_novo
      from public.service_link sl
     where sl.id = v_reserva.service_link_id
       and sl.clinic_id = p_clinic_id;
    if v_vinculo_novo.procedure_id is distinct from v_antiga.o_procedimento
       or v_vinculo_novo.professional_id is distinct from v_antiga.o_profissional
       or v_vinculo_novo.insurance_id is distinct from v_antiga.o_convenio
    then
      return jsonb_build_object('ok', false, 'motivo', 'remarcacao_invalida');
    end if;
    if exists (
      select 1
        from public.appointment_status_history h
       where h.appointment_id = p_remarcar
         and h.clinic_id = p_clinic_id
         and h.kind = 'remarcacao'
         and h.changed_at > v_reserva.created_at - interval '2 minutes'
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'consulta_mudou');
    end if;
  end if;
  -- [remarcar e cancelar] fim

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
  -- consulta (a mais proxima), para a IA oferecer remarcar. [remarcar e
  -- cancelar] So fora da remarcacao (a remarcacao troca uma consulta por
  -- outra).
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
     -- [remarcar e cancelar] So fora da remarcacao: nenhuma conta (nem a
     -- antiga, nem outra do mesmo procedimento, nem a pendente da IA)
     and p_remarcar is null
   order by a.starts_at, a.id
   limit 1;
  if v_ja_marcada is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta', 'appointment_id', v_ja_marcada);
  end if;
  -- (e) D-6: os dados que a clinica exige para marcar. [remarcar e
  -- cancelar] A remarcacao nao pede dado (D-26): a consulta e a mesma.
  if p_remarcar is null then
    v_faltam := public.dados_que_faltam_para_marcar(
      p_clinic_id, v_reserva.service_link_id, v_dados.nome_completo, v_dados.data_nascimento,
      v_dados.cpf, v_dados.carteirinha);
    if cardinality(v_faltam) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'faltam_dados', 'faltam', to_jsonb(v_faltam));
    end if;
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
  -- [remarcar e cancelar] inicio
  -- Na remarcacao, alem disso, a ancora forte (a de
  -- cancelar_consulta_pela_ia, com a reserva no lugar do pedido): a ULTIMA
  -- mensagem do paciente tem, como ultima mensagem de saida antes dela, a
  -- resposta da IA (que nao falhou) gravada depois da reserva (a pergunta
  -- T3 sai no turno da reserva). Conta toda saida que nao e evento nem nota
  -- interna, de qualquer autor e em qualquer situacao de entrega; empate no
  -- instante conta como outra no meio. Sem p_remarcar (AG3, a regra acima),
  -- nada muda.
  if p_remarcar is not null then
    select max(m.created_at) into v_sim
      from public.message m
     where m.conversation_id = p_conversation_id
       and m.clinic_id = p_clinic_id
       and m.direction = 'entrada'
       and m.author = 'paciente';
    select max(x.created_at) into v_pergunta
      from public.message x
     where x.conversation_id = p_conversation_id
       and x.clinic_id = p_clinic_id
       and x.direction = 'saida'
       and x.author = 'ia'
       and x.content_type <> 'evento'
       and not x.is_internal_note
       and x.delivery_status is distinct from 'falhou'
       and x.created_at > v_reserva.created_at
       and x.created_at < v_sim;
    if v_pergunta is null or exists (
      select 1
        from public.message o
       where o.conversation_id = p_conversation_id
         and o.clinic_id = p_clinic_id
         and o.direction = 'saida'
         and o.content_type <> 'evento'
         and not o.is_internal_note
         and (o.author is distinct from 'ia' or o.delivery_status is not distinct from 'falhou')
         and o.created_at >= v_pergunta
         and o.created_at < v_sim
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
    end if;
  end if;
  -- [remarcar e cancelar] fim

  -- A consulta pendente (D12), sem regua ate a aprovacao e sem oferecer a
  -- vaga a lista de espera se for recusada. 23P01: conflito, nada gravado.
  begin
    insert into public.appointment (
      clinic_id, contact_id, professional_id, service_link_id, resource_id,
      starts_at, ends_at, status, created_by, approval_status,
      send_confirmation, oferecer_vaga_ao_cancelar, is_overbooking, source
      -- [agendamento completo] a unidade da reserva
      , unit_id
      -- [remarcar e cancelar] a antiga
      , remarcacao_de
    ) values (
      p_clinic_id, v_conf.o_contato, v_reserva.professional_id, v_reserva.service_link_id,
      v_conf.o_recurso, v_reserva.starts_at, v_reserva.ends_at, 'agendado', 'ia', 'pendente',
      false, false, false, 'interna'
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
      -- [remarcar e cancelar] a antiga (nula fora da remarcacao)
      , p_remarcar
    )
    returning id into v_consulta;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'motivo', 'conflito');
    -- [remarcar e cancelar] O indice unico de uma remarcacao pendente por
    -- consulta (a defesa em profundidade: a leitura sob a trava da antiga
    -- ja recusa antes). Outro 23505 sobe como esta.
    when unique_violation then
      get stacked diagnostics v_restricao = constraint_name;
      if v_restricao = 'appointment_uma_remarcacao_pendente' then
        return jsonb_build_object('ok', false, 'motivo', 'remarcacao_pendente');
      end if;
      raise;
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
  -- aprovacao os aplica ao cadastro do contato). [remarcar e cancelar] Na
  -- remarcacao, nao (D-26: ela nao pede dado; a linha aberta fica como
  -- estava, para a proxima marcacao da janela).
  if v_dados.id is not null and p_remarcar is null then
    update public.dados_informados_na_marcacao d
       set appointment_id = v_consulta,
           slot_hold_id = v_reserva.id
     where d.id = v_dados.id;
  end if;
  -- [agendamento completo] fim

  -- [remarcar e cancelar] inicio
  -- Na antiga (D-10: ela vale ate a aprovacao), o que o botao Remarcar faz
  -- (pedir_remarcacao_pelo_paciente): a marca "Pediu para remarcar" (a
  -- que ja existia fica), os toques da regua que ainda nao sairam pulados
  -- (remarcacao_pedida) e a linha de evento da trilha, agora com autor ia,
  -- repetindo a situacao atual (ela nao muda).
  if p_remarcar is not null then
    update public.appointment a
       set remarcacao_pedida_em = coalesce(a.remarcacao_pedida_em, now())
     where a.id = p_remarcar
       and a.clinic_id = p_clinic_id
    returning a.status into v_situacao_da_antiga;
    update public.cadence_run r
       set skipped_reason = 'remarcacao_pedida'
     where r.clinic_id = p_clinic_id
       and r.appointment_id = p_remarcar
       and r.sent_at is null
       and r.skipped_reason is null;
    insert into public.appointment_status_history (
      clinic_id, appointment_id, status, changed_by_user_id, changed_by, event
    ) values (
      p_clinic_id, p_remarcar, v_situacao_da_antiga, null, 'ia', 'remarcacao_pedida'
    );
  end if;
  -- [remarcar e cancelar] fim

  if p_remarcar is null then
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
  else
    -- [remarcar e cancelar] o evento da remarcacao
    insert into public.message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'A IA pediu a remarcação da consulta de '
        || to_char(v_inicio_da_antiga at time zone v_conf.o_fuso, 'DD/MM') || ' às '
        || to_char(v_inicio_da_antiga at time zone v_conf.o_fuso, 'HH24:MI')
        || ' para '
        || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'DD/MM') || ' às '
        || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'HH24:MI')
        || ' (' || v_conf.o_procedimento || ', ' || v_conf.o_nome_do_profissional
        || '), pendente de aprovação da equipe.',
      false, 0
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_consulta,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'reutilizado', false
  )
  -- [remarcar e cancelar] a antiga, na remarcacao
  || case when p_remarcar is null then '{}'::jsonb
          else jsonb_build_object('remarcacao_de', p_remarcar,
                                  'remarcacao_de_starts_at', v_inicio_da_antiga)
     end;
end;
$$;

revoke execute on function public.agendar_pela_ia(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agendar_pela_ia(uuid, uuid, uuid, uuid, uuid)
  to service_role;

comment on function public.agendar_pela_ia(uuid, uuid, uuid, uuid, uuid) is
  'So o servidor (service_role). Marca a consulta da reserva viva da conversa, depois de uma mensagem do paciente posterior a pergunta da IA (a primeira resposta da IA gravada depois da reserva, que nao falhou): agendado, created_by ia, approval_status pendente, send_confirmation false (a regua so comeca com a aprovacao), oferecer_vaga_ao_cancelar false, source interna, a unidade da reserva; consome a reserva, liga os dados informados (dados_informados_na_marcacao, a linha aberta da janela atual da IA) a consulta e grava o evento na conversa. p_slot_hold_id (revisao final; nulo = como antes): a reserva que o "Confirma ...?" perguntou; se a reserva viva da conversa (ou, no mesmo job de novo, a que ele consumiu) for outra, reserva_diferente, sem gravar nada. p_remarcar (AG4; nulo = como antes): a consulta antiga da remarcacao (D-10); depois da conferencia do horario, recusa remarcacao_desligada, sem_pedido_de_remarcacao, trava a antiga e recusa os motivos de conferir_consulta_da_ia (consulta_nao_encontrada, consulta_encerrada, encaixe, so_com_a_equipe, pendente_da_equipe, remarcacao_pendente, fora_do_prazo), remarcacao_invalida (a reserva com outro procedimento, profissional ou convenio) e consulta_mudou (a antiga mudou de horario ou de profissional desde a reserva, com folga de 2 minutos); nao pede dado (sem faltam_dados) e nao liga os dados informados; a consulta nova leva remarcacao_de (o indice unico de uma remarcacao pendente por consulta, 23505, vira remarcacao_pendente); a antiga ganha remarcacao_pedida_em (se ainda nao tinha), os toques pendentes como remarcacao_pedida e a linha de evento remarcacao_pedida com autor ia; o evento da conversa diz o par de horarios; o retorno ganha remarcacao_de e remarcacao_de_starts_at (tambem na repeticao do job). Devolve {ok:true, appointment_id, starts_at, ends_at, reutilizado} ou {ok:false, motivo}: reserva_inexistente, reserva_diferente, reserva_vencida, ia_desligada, agenda_nao_configurada, vinculo_invalido, unidade_invalida, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, conflito (consulta no horario, inclusive o 23P01, sem gravar nada), reservado_por_outra_conversa; depois os da remarcacao; depois, nesta ordem, consulta_para_outra_pessoa (a marca da janela atual), menor_de_idade (menos de 18 anos no dia da consulta, pelo nascimento informado ou pelo do cadastro do contato), ja_tem_consulta (com appointment_id: o contato ja tem consulta futura ativa do mesmo procedimento; nunca na remarcacao; o reservar ja recusa antes, e o agendar confere de novo) e faltam_dados (com faltam: a lista do que falta; nunca na remarcacao); e sem_confirmacao_do_paciente (na remarcacao, tambem a ancora forte de cancelar_consulta_pela_ia com a reserva no lugar do pedido: a ultima mensagem de saida antes da ultima mensagem do paciente tem de ser a resposta da IA, que nao falhou, gravada depois da reserva; evento e nota interna nao contam; sem p_remarcar, como antes). Idempotente pelo job_id (a consulta do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';

-- ---------------------------------------------------------------------------
-- 8) O estado do atendimento e os dados informados
-- ---------------------------------------------------------------------------

create or replace function public.gravar_atendimento_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_versao integer,
  p_estado jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  -- [remarcar e cancelar] inicio
  -- A validade do pedido (cabecalho, VALIDADE DO PEDIDO; DECISAO A
  -- CONFIRMAR COM O DONO). A mesma constante esta em
  -- cancelar_consulta_pela_ia: trocar o valor e trocar nos dois.
  c_validade_do_pedido constant interval := interval '60 minutes';
  v_reserva record;
  v_base jsonb;
  v_pedido_em timestamptz;
  -- [remarcar e cancelar] fim
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
    -- [remarcar e cancelar] O instante do pedido e do banco (abaixo, depois
    -- da trava da conversa): o que o codigo manda e ignorado. Aqui so um
    -- valor da forma certa, para a conferencia (o pedido e o instante
    -- andam juntos).
    v_estado := v_estado || jsonb_build_object('pedido_pendente_em',
      case when jsonb_typeof(p_estado -> 'pedido_pendente') = 'string'
           then to_char(now() at time zone 'UTC', v_formato) end);
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
  -- [remarcar e cancelar] O pedido (cancelar ou remarcar) e sempre sobre
  -- uma consulta: a consulta em foco.
  if v_estado ->> 'pedido_pendente' is not null and v_estado ->> 'appointment_id' is null then
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
  -- outra conversa continua 22023. [remarcar e cancelar] Uma leitura so
  -- (AG3, 33.14 ponto 1): eram duas, e a reserva apagada entre elas dava
  -- 22023 em vez de nula.
  if v_estado ->> 'slot_hold_id' is not null then
    select x.clinic_id, x.conversation_id into v_reserva
      from public.slot_hold x
     where x.id = (v_estado ->> 'slot_hold_id')::uuid;
    if not found then
      v_estado := v_estado || jsonb_build_object('slot_hold_id', null);
    elsif v_reserva.clinic_id is distinct from p_clinic_id
          or v_reserva.conversation_id is distinct from p_conversation_id
    then
      raise exception using errcode = '22023', message = 'estado_invalido';
    end if;
  end if;

  -- Os ids sao desta clinica: o procedimento, o profissional, o convenio e a
  -- unidade; a consulta e do contato da conversa; e os vinculos,
  -- profissionais e unidades dos horarios. (A reserva, acima.)
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

  -- [remarcar e cancelar] inicio
  -- O instante do pedido (AG4): o do estado de antes do job (o anterior,
  -- no mesmo job de novo) quando o pedido e o foco nao mudam e ele ainda
  -- vale (c_validade_do_pedido); agora quando mudam ou quando ele venceu (a
  -- IA perguntou de novo: o pedido e re-armado; senao todo "sim" seguinte
  -- daria pedido_vencido); nulo sem pedido. E a ancora de
  -- cancelar_consulta_pela_ia (a pergunta e a confirmacao vem depois dele).
  if v_linha.id is null then
    v_base := null;
  elsif v_linha.job_id = p_job_id then
    v_base := v_linha.anterior;
  else
    v_base := public.ia_estado_do_atendimento(v_linha);
  end if;
  if v_estado ->> 'pedido_pendente' is null then
    v_pedido_em := null;
  elsif v_base ->> 'pedido_pendente' is not distinct from v_estado ->> 'pedido_pendente'
        and v_base ->> 'appointment_id' is not distinct from v_estado ->> 'appointment_id'
        and v_base ->> 'pedido_pendente_em' is not null
        and (v_base ->> 'pedido_pendente_em')::timestamptz > now() - c_validade_do_pedido
  then
    v_pedido_em := (v_base ->> 'pedido_pendente_em')::timestamptz;
  else
    v_pedido_em := now();
  end if;
  -- [remarcar e cancelar] fim

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
      v_estado ->> 'pedido_pendente', v_pedido_em,
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
         pedido_pendente_em = v_pedido_em,
         falhas_seguidas = (v_estado ->> 'falhas_seguidas')::integer,
         desfecho = v_estado ->> 'desfecho',
         anterior = case when v_linha.job_id = p_job_id then a.anterior
                         else public.ia_estado_do_atendimento(v_linha) end,
         job_id = p_job_id,
         versao = v_versao
   where a.id = v_linha.id;
  return jsonb_build_object('ok', true, 'versao', v_versao, 'reutilizado', v_linha.job_id = p_job_id);
end;
$$;

comment on function public.gravar_atendimento_da_ia(uuid, uuid, uuid, integer, jsonb) is
  'So o servidor (service_role). Grava o estado do atendimento da IA (p_estado, a forma de ia_estado_do_atendimento_valido; os instantes viram UTC com Z) na janela atual da conversa, pelo job p_job_id, que leu a versao p_versao (ler_atendimento_da_ia). Trava a conversa antes de ler a janela (D-A do E3). Idempotente por job: o mesmo job grava de novo sobre o estado de antes dele (versao - 1), a versao e o anterior ficam; job novo sobe a versao e guarda o estado de antes em anterior. Apaga o estado de outra janela da conversa. A reserva do estado que ja nao existe (apagada no meio do turno) e gravada nula (revisao final), sem erro, numa leitura so (AG4). O instante do pedido (pedido_pendente_em) e do banco (AG4): o que vem em p_estado e ignorado; agora quando o pedido ou o foco (appointment_id) mudam em relacao ao estado de antes do job, o de antes quando os dois ficam iguais e ele ainda vale (menos de 60 minutos, c_validade_do_pedido; vencido, agora de novo: o pedido e re-armado), nulo sem pedido; pedido sem appointment_id e 22023. Devolve {ok:true, versao, reutilizado} ou {ok:false, motivo}: fora_da_ia (conversa de outra clinica, fora da IA, com responsavel, sem janela ou com a janela de outro contato), sem_posse (job fora de execucao), job_antigo, estado_mudou (outro job gravou depois da leitura: ler de novo). Forma errada, id de outra clinica ou conversa (a reserva que existe e e de outra conversa inclusive), pedido sem consulta, ou job que nao e desta conversa: 22023 (estado_invalido, job_invalido). Parametro nulo: 22004.';

-- Um parametro a mais com default: o codigo de hoje (2 parametros por nome)
-- continua chamando.
drop function public.ler_dados_informados_na_marcacao(uuid, uuid);

create function public.ler_dados_informados_na_marcacao(
  p_clinic_id uuid,
  p_appointment_id uuid,
  -- [remarcar e cancelar] o dado que a tela revela inteiro (cpf ou
  -- carteirinha); nulo = como antes, tudo
  p_campo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  -- [remarcar e cancelar] So os dois dados que a tela mascara.
  if p_campo is not null and p_campo not in ('cpf', 'carteirinha') then
    raise exception using errcode = '22023', message = 'campo_invalido';
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

  -- [remarcar e cancelar] inicio
  -- O dado revelado (AG3, 33.14 ponto 2): a trilha diz qual campo, e so ele
  -- volta.
  if p_campo is not null then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
    values (p_clinic_id, auth.uid(), 'revelou_dado_da_marcacao', 'appointment', p_appointment_id,
            jsonb_build_object('campo', p_campo));
    return jsonb_build_object('dados', jsonb_build_object(
      p_campo, case p_campo when 'cpf' then v_dados.cpf else v_dados.carteirinha end));
  end if;
  -- [remarcar e cancelar] fim

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
$$;

revoke execute on function public.ler_dados_informados_na_marcacao(uuid, uuid, text) from public, anon;
grant execute on function public.ler_dados_informados_na_marcacao(uuid, uuid, text) to authenticated, service_role;

comment on function public.ler_dados_informados_na_marcacao(uuid, uuid, text) is
  'O que o paciente informou a IA para a consulta p_appointment_id (AG3, D-7): {dados: {nome_completo, data_nascimento, cpf, carteirinha, para_o_titular, informado_em, atualizado_em, aplicado_em, aplicado_por}} ou {dados: null}, com a trilha leu_dados_da_marcacao (entity appointment, sem conteudo) quando ha dado. p_campo (AG4; cpf ou carteirinha, outro valor 22023): so aquele dado volta ({dados: {cpf}} ou {dados: {carteirinha}}, nulo se nao informado) e a trilha e revelou_dado_da_marcacao com detalhes {campo}, quando ha dado. A unica leitura humana da tabela. Quem aprova a consulta (escrita na clinica, user_can_write; o profissional so na propria agenda), a service role e o SQL editor; o resto 42501 (anon sem EXECUTE). 22004 (nulo) e P0002 (consulta que nao e da clinica).';

-- ---------------------------------------------------------------------------
-- 9) A recusa da remarcacao devolve a conversa com o texto dela
-- ---------------------------------------------------------------------------

create or replace function public.devolver_conversa_da_consulta_recusada(
  p_clinic_id uuid,
  p_appointment_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profissional uuid;
  v_conversa uuid;
  v_servidor boolean :=
    auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role';
  -- [remarcar e cancelar] inicio
  v_antiga uuid;
  v_antiga_lida record;
  v_fuso text;
  v_texto text := 'A equipe recusou a consulta marcada pela IA. Avise o paciente.';
  -- [remarcar e cancelar] fim
begin
  if p_clinic_id is null or p_appointment_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica e a consulta.';
  end if;
  if not v_servidor and not public.user_can_write(p_clinic_id) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select a.professional_id, a.remarcacao_de into v_profissional, v_antiga
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

  -- [remarcar e cancelar] inicio
  -- A recusada era uma remarcacao pedida pela IA (AG4, D-29): a antiga fica
  -- como estava. O evento so diz que ela continua marcada quando continua.
  if v_antiga is not null then
    select a.starts_at, a.status into v_antiga_lida
      from public.appointment a
     where a.id = v_antiga
       and a.clinic_id = p_clinic_id;
    select c.timezone into v_fuso from public.clinic c where c.id = p_clinic_id;
    v_fuso := coalesce(v_fuso, 'America/Fortaleza');
    if v_antiga_lida.status in ('agendado', 'aguardando_confirmacao',
                                'confirmado_paciente', 'confirmado_recepcao') then
      v_texto := 'A equipe recusou a remarcação pedida pela IA. A consulta de '
        || to_char(v_antiga_lida.starts_at at time zone v_fuso, 'DD/MM') || ' às '
        || to_char(v_antiga_lida.starts_at at time zone v_fuso, 'HH24:MI')
        || ' continua marcada. Avise o paciente.';
    else
      v_texto := 'A equipe recusou a remarcação pedida pela IA. Avise o paciente.';
    end if;
  end if;
  -- [remarcar e cancelar] fim

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    p_clinic_id, v_conversa, 'saida', 'sistema', 'evento',
    v_texto,
    false, 0
  );
  return true;
end;
$$;

comment on function public.devolver_conversa_da_consulta_recusada(uuid, uuid) is
  'Depois de recusar a consulta que a IA marcou (created_by ia, approval_status recusado): acha a conversa pela reserva consumida (slot_hold.appointment_id); se ela estiver com a IA, passa para a equipe como a IA passa (aguardando_humano, Aguardando voce, jobs pendentes de responder_com_ia cancelados); em qualquer caso grava o evento "A equipe recusou a consulta marcada pela IA. Avise o paciente." ou, quando a recusada era uma remarcacao pedida pela IA (AG4, remarcacao_de), "A equipe recusou a remarcação pedida pela IA. A consulta de DD/MM às HH:MI continua marcada. Avise o paciente." (sem a frase do meio se a antiga ja nao esta numa das quatro situacoes de antes do atendimento). Quem escreve na clinica (user_can_write; o profissional so na propria agenda) e o servidor; senao 42501. Devolve se achou a conversa (consulta que nao e da IA, nao recusada ou sem reserva: false). Parametro nulo: 22004.';

-- ---------------------------------------------------------------------------
-- 10) Os gatilhos da remarcacao em appointment
-- ---------------------------------------------------------------------------

-- 10a. So o servidor grava o elo, da mesma clinica e do mesmo contato, e ele
-- nao muda.
create function public.exigir_remarcacao_da_ia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.remarcacao_de is null then
      return new;
    end if;
  elsif new.remarcacao_de is not distinct from old.remarcacao_de then
    return new;
  end if;
  -- A sessao (a Agenda, o Atendimento) nunca grava o elo: so
  -- agendar_pela_ia, pelo servidor.
  if auth.uid() is not null then
    raise exception using errcode = '42501', message = 'sem_permissao',
      hint = 'Só o assistente grava a remarcação que ele pediu.';
  end if;
  if tg_op = 'UPDATE' then
    -- O elo nao muda. So vira nulo pela FK (on delete set null), quando a
    -- antiga ja nao existe.
    if new.remarcacao_de is not null or exists (
      select 1 from public.appointment a where a.id = old.remarcacao_de
    ) then
      raise exception using errcode = '23514', message = 'remarcacao_nao_muda';
    end if;
    return new;
  end if;
  -- A FK so confere existencia (e ignora RLS): a antiga e da mesma clinica e
  -- do mesmo contato.
  if not exists (
    select 1
      from public.appointment a
     where a.id = new.remarcacao_de
       and a.clinic_id = new.clinic_id
       and a.contact_id = new.contact_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'A consulta remarcada não é deste paciente nesta clínica.';
  end if;
  return new;
end;
$$;

revoke all on function public.exigir_remarcacao_da_ia()
  from public, anon, authenticated, service_role;

comment on function public.exigir_remarcacao_da_ia() is
  'Gatilho BEFORE INSERT OR UPDATE OF remarcacao_de de appointment (AG4): o elo da remarcacao pedida pela IA so pelo servidor (sessao: 42501 sem_permissao), com a antiga da mesma clinica e do mesmo contato (23503), e sem mudar depois de gravado (23514 remarcacao_nao_muda; so vira nulo pela FK, com a antiga apagada). Ninguem executa direto.';

create trigger exigir_remarcacao_da_ia
  before insert or update of remarcacao_de on public.appointment
  for each row execute function public.exigir_remarcacao_da_ia();

-- 10b. D-32: a recepcao nao move a antiga com remarcacao pendente (nem o
-- inicio, nem o fim, nem o profissional, nem a unidade). So le a nova (sem
-- trava): mover trava so a antiga.
create function public.remarcacao_pendente_trava_a_antiga()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- So roda pelo WHEN do gatilho: o inicio, o fim, o profissional ou a
  -- unidade mudou.
  if exists (
    select 1
      from public.appointment n
     where n.remarcacao_de = new.id
       and n.clinic_id = new.clinic_id
       and n.approval_status = 'pendente'
       and n.status not in ('cancelado_paciente', 'cancelado_clinica')
  ) then
    raise exception using errcode = '23514', message = 'remarcacao_pendente',
      hint = 'Aprove ou recuse a remarcação pedida pela IA antes de mover esta consulta.';
  end if;
  return new;
end;
$$;

revoke all on function public.remarcacao_pendente_trava_a_antiga()
  from public, anon, authenticated, service_role;

comment on function public.remarcacao_pendente_trava_a_antiga() is
  'Gatilho BEFORE UPDATE OF starts_at, ends_at, professional_id, unit_id de appointment (remarcacao_pendente_trava_a_antiga; AG4, D-32): a consulta com uma remarcacao pendente pedida pela IA nao muda o inicio, o fim (a duracao), o profissional nem a unidade (23514 remarcacao_pendente, com a dica). So le a nova, sem trava. Ninguem executa direto.';

create trigger remarcacao_pendente_trava_a_antiga
  before update of starts_at, ends_at, professional_id, unit_id on public.appointment
  for each row
  when (old.starts_at is distinct from new.starts_at
        or old.ends_at is distinct from new.ends_at
        or old.professional_id is distinct from new.professional_id
        or old.unit_id is distinct from new.unit_id)
  execute function public.remarcacao_pendente_trava_a_antiga();

comment on trigger remarcacao_pendente_trava_a_antiga on public.appointment is
  'AG4 (D-32): a consulta com remarcacao pendente pedida pela IA so se move (inicio, fim, profissional ou unidade) depois de a equipe aprovar ou recusar a remarcacao (23514 remarcacao_pendente).';

-- 10c. D-27: a remarcacao aprovada cancela a antiga. A nova ja esta travada
-- (o update da aprovacao); a antiga e travada aqui, depois: ninguem trava a
-- antiga e depois a nova.
create function public.remarcacao_na_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antiga record;
begin
  -- So roda pelo WHEN do gatilho: a remarcacao passou de pendente para
  -- aprovada (e nao esta cancelada).
  select a.id, a.status into v_antiga
    from public.appointment a
   where a.id = new.remarcacao_de
     and a.clinic_id = new.clinic_id
     for update;
  if not found or v_antiga.status in ('cancelado_paciente', 'cancelado_clinica') then
    return null;
  end if;
  if v_antiga.status not in ('agendado', 'aguardando_confirmacao',
                             'confirmado_paciente', 'confirmado_recepcao') then
    raise exception using errcode = '23514', message = 'remarcacao_consulta_antiga_encerrada',
      hint = 'A consulta antiga já foi atendida ou teve a falta marcada. Recuse esta remarcação e fale com o paciente.';
  end if;
  -- Mesmo no passado (o pedido veio antes da hora: nao e inferir falta). A
  -- reoferta so sai se ela ainda for futura (o WHEN de oferecer_ao_cancelar)
  -- e se a antiga oferece a vaga.
  update public.appointment a
     set status = 'cancelado_paciente'
   where a.id = v_antiga.id;
  insert into public.appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    new.clinic_id, v_antiga.id, 'cancelado_paciente', auth.uid(),
    case when auth.uid() is null then 'sistema' else 'usuario' end
  );
  return null;
end;
$$;

revoke all on function public.remarcacao_na_aprovacao()
  from public, anon, authenticated, service_role;

comment on function public.remarcacao_na_aprovacao() is
  'Gatilho AFTER UPDATE OF approval_status de appointment (remarcacao_na_aprovacao; AG4, D-27): a remarcacao pedida pela IA aprovada trava a antiga (remarcacao_de) e, numa das quatro situacoes antes do atendimento (mesmo no passado), a cancela como cancelado_paciente, com a trilha de quem aprovou (changed_by usuario; sem sessao, sistema); a reoferta e a marca de pedido de remarcacao seguem os gatilhos de sempre. A antiga ja cancelada fica. Na recepcao, em atendimento, compareceu ou faltou: 23514 remarcacao_consulta_antiga_encerrada (com a dica), e a aprovacao nao acontece. Ninguem executa direto.';

create trigger remarcacao_na_aprovacao
  after update of approval_status on public.appointment
  for each row
  when (old.approval_status = 'pendente' and new.approval_status = 'aprovado'
        and new.remarcacao_de is not null
        and new.status not in ('cancelado_paciente', 'cancelado_clinica'))
  execute function public.remarcacao_na_aprovacao();

comment on trigger remarcacao_na_aprovacao on public.appointment is
  'AG4 (D-27): a remarcacao pedida pela IA aprovada cancela a antiga (cancelado_paciente, com a reoferta). Roda depois de avancar_funil_na_aprovacao, converter_lead_na_aprovacao e dados_informados_na_aprovacao (ordem alfabetica): o funil, a conversao e os dados veem a consulta nova aprovada antes. Antiga encerrada: 23514, e a aprovacao nao acontece.';
