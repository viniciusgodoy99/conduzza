-- ---------------------------------------------------------------------------
-- A IA marca consulta pelo WhatsApp (E4, 20/10/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026, depois do primeiro teste no WhatsApp ("O
-- intuito do agente e marcar reuniao e ele delegou para um atendente e nao
-- marcou"). Plano em ~/.claude/plans/e4-agenda/plano.md; esta migration e a
-- secao 1 do contrato entre as frentes (~/.claude/plans/e4-agenda/
-- contrato.md). Decisoes do dono de 20/10/2026: a consulta da IA nasce
-- pendente da aprovacao da equipe (D12); a antecedencia minima e o
-- horizonte sao da clinica, na aba do agente, e sem os dois a habilidade
-- Agendar nao liga (D13, ninguem inventa valor); a regua de confirmacao so
-- comeca depois que a equipe aprova; recusar devolve a conversa para a
-- equipe. Vale so onde a IA ja atende (ia_pode_atender): a teste123 e a
-- Conduzza Teste, com os telefones da equipe, e as clinicas e_de_teste no
-- WhatsApp falso.
--
-- Quatro funcoes de producao mudam, todas a partir do corpo de PRODUCAO
-- lido em 20/10/2026 (fndef.js, so leitura) e guardado em
-- supabase/operacao/rollback/20261020130000-corpos-anteriores.sql, com o
-- md5 do prosrc de cada um (o ensaio confere que o banco ainda esta assim).
-- O trecho novo de cada uma esta entre "-- [<marca>] inicio" e "... fim"; o
-- resto e o corpo de producao linha a linha (so limpar_holds_vencidos troca
-- uma linha, dentro da marca).
--
-- 1. ai_agent_config: agenda_antecedencia_horas (inteiro de 0 a 720) e
--    agenda_horizonte_dias (inteiro de 1 a 365), nulas: nula e "a clinica
--    ainda nao escolheu". Permissao por coluna como a de skills: a sessao le
--    e atualiza (a policy de UPDATE continua so o rascunho, so do
--    administrador e do gestor); anon nada; a service_role ja tem a tabela.
--    agente_garantir_rascunho e restaurar_versao_do_agente (CREATE OR
--    REPLACE, mesmas assinaturas, security e grants), marca [agenda da ia],
--    copiam as duas: sem isso o valor publicado se perde no proximo
--    rascunho. publicar_agente nao muda (publica a propria linha do
--    rascunho), e proteger_versao_publicada_do_agente compara a linha
--    inteira (to_jsonb): a versao publicada tambem nao muda nas colunas
--    novas.
--
-- 2. conferir_horario_da_ia (NOVA, interna: nenhum papel da API executa):
--    as conferencias 4 a 9 do contrato, numa funcao so, para o reservar e o
--    agendar conferirem EXATAMENTE o mesmo. Devolve o primeiro motivo de
--    recusa, na ordem do contrato, ou nulo; e o contato, o profissional, o
--    fim, o recurso, o fuso e os nomes que o chamador usa:
--      4. conversa da clinica, em ia_atendendo, e ia_pode_atender(clinica,
--         numero da conversa, phone_key do contato) -> ia_desligada;
--      5. a versao publicada EM USO (a ultima publicada) com skills.agendar
--         = true e as duas colunas preenchidas -> agenda_nao_configurada;
--      6. vinculo ativo da clinica com bookable_by_ai, de procedimento
--         ativo com bookable_by_ai e de profissional ATIVO (o catalogo do
--         agente so oferece profissional ativo) -> vinculo_invalido;
--      7. fim = inicio + service_link.duration_min (ou o fim da reserva, no
--         agendar); inicio antes de now() + antecedencia ->
--         antes_da_antecedencia; inicio depois de now() + horizonte ->
--         depois_do_horizonte;
--      8. cabe inteiro na jornada do profissional (professional_schedule,
--         todas as unidades) no dia e na hora LOCAIS do fuso da clinica
--         (clinic.timezone, padrao America/Fortaleza), com a regra do motor
--         da Agenda (lib/domain/scheduling.ts): weekday 0 = domingo, janela
--         com fim <= inicio vira o dia, janelas encostadas se somam
--         (range_agg) -> fora_da_jornada;
--      9. sobreposicao com bloqueio do profissional -> bloqueado; com
--         consulta nao cancelada do profissional (o encaixe conta) ou com
--         consulta nao cancelada de qualquer profissional no recurso do
--         procedimento -> ocupado; com reserva viva (expires_at > now() e
--         nao consumida) de OUTRA conversa no mesmo profissional, a
--         reserva sem conversa (da recepcao) inclusive, ou (revisao da E4,
--         marca [recurso da reserva]) num vinculo de qualquer profissional
--         cujo procedimento usa o mesmo recurso ->
--         reservado_por_outra_conversa.
--
-- 3. reservar_horario_da_ia(p_clinic_id, p_conversation_id,
--    p_service_link_id, p_starts_at, p_job_id) returns jsonb, SO a
--    service_role. Na ordem: parametro nulo 22004; trava da conversa,
--    trava do profissional do vinculo e, quando o procedimento tem recurso,
--    trava do recurso; idempotencia pelo job_id (a reserva
--    deste job, viva ou consumida, volta com reutilizado true; job de outra
--    conversa: 22023); conferir_horario_da_ia; apaga as reservas vencidas
--    NAO consumidas do profissional e as nao consumidas desta conversa (uma
--    por conversa); cria a reserva (created_by 'ia', contato da conversa,
--    10 minutos). Devolve {ok:true, hold_id, starts_at, ends_at,
--    expires_at, reutilizado} ou {ok:false, motivo}.
--
-- 4. agendar_pela_ia(p_clinic_id, p_conversation_id, p_job_id) returns
--    jsonb, SO a service_role (sem p_hold_id: o contrato manda; a reserva e
--    a viva desta conversa). Na ordem: parametro nulo 22004; trava da
--    conversa; idempotencia (a reserva desta conversa consumida por este
--    job volta com a consulta e reutilizado true; job de outra conversa:
--    22023); a reserva viva nao consumida mais nova da conversa, senao
--    reserva_inexistente, e vencida -> reserva_vencida; trava do
--    profissional, a reserva travada (FOR UPDATE) e a trava do recurso,
--    quando o procedimento tem; conferir_horario_da_ia
--    sem a propria reserva, com o fim da reserva; mensagem do paciente
--    (entrada, autor paciente) DEPOIS da pergunta da IA, que e a primeira
--    resposta da IA gravada depois da reserva e que nao falhou (revisao da
--    E4, marca [confirmacao depois da pergunta]: a mensagem que chegou
--    entre a reserva e a pergunta nao e confirmacao), senao
--    sem_confirmacao_do_paciente; a consulta (agendado, created_by 'ia',
--    approval_status 'pendente', send_confirmation false,
--    oferecer_vaga_ao_cancelar false, is_overbooking false, source
--    'interna', o recurso do procedimento); 23P01 -> conflito sem gravar
--    nada; a reserva consumida (consumido_em, appointment_id,
--    job_id_do_agendar e expires_at = agora, para a Agenda parar de
--    desenhar a reserva por cima da consulta); o evento na conversa
--    ("A IA marcou dd/mm às HH:MM (procedimento, profissional), pendente de
--    aprovação da equipe."). Devolve {ok:true, appointment_id, starts_at,
--    ends_at, reutilizado} ou {ok:false, motivo}.
--    - source 'interna': o CHECK appointment_source_check so aceita
--      'interna' e 'externa' (conferido na producao em 20/10/2026); a
--      origem IA ja esta em created_by 'ia'.
--    - consulta que passou a ocupar o horario da reserva (a recepcao marcou
--      por cima durante a reserva) volta como conflito, como o 23P01: e o
--      motivo que o plano da ao caso. O reservar continua dizendo ocupado.
--    - send_confirmation false: o planejador da regua (planejar_reguas) so
--      planeja consulta com send_confirmation; aprovar volta a coluna para
--      true no mesmo update (Server Action da Agenda).
--
-- 5. devolver_conversa_da_consulta_recusada(p_clinic_id, p_appointment_id)
--    returns boolean: authenticated com escrita na clinica
--    (user_can_write; o profissional, so na propria agenda, como a policy de
--    appointment) e service_role; anon e PUBLIC nao. A consulta e da
--    clinica, created_by 'ia', approval_status 'recusado'; a conversa vem
--    da reserva consumida (slot_hold.appointment_id). Conversa em
--    ia_atendendo vai para a equipe pelo mesmo caminho da IA
--    (ia_tirar_conversa: aguardando_humano, "Aguardando voce" e os jobs
--    pendentes de responder_com_ia da conversa cancelados), sem o evento de
--    motivo: um motivo novo em rotulo_do_motivo_da_ia exigiria mudar junto
--    o espelho TEXTO_DO_EVENTO_DA_IA (lib/domain/agente/config.ts, teste
--    espelhos.test.ts). Em qualquer caso, UM evento: "A equipe recusou a
--    consulta marcada pela IA. Avise o paciente." Devolve se achou a
--    conversa. O contrato fala em gatilho que cancela os jobs: nao existe
--    gatilho em conversation (conferido em 20/10/2026); quem cancela e o
--    proprio caminho, aqui repetido.
--
-- 6. slot_hold (a reserva temporaria), POR ULTIMO (trava curta nas tabelas
--    quentes): colunas novas, todas nulas: service_link_id (FK on delete
--    cascade), conversation_id (FK on delete cascade), job_id (o job do
--    reservar), consumido_em, appointment_id (FK on delete set null) e
--    job_id_do_agendar (o job do agendar; o contrato deixa criar "se
--    precisar": precisa, o job_id e o do reservar e os dois podem ser jobs
--    diferentes).
--    - CHECK slot_hold_reserva_da_ia_completa: reserva da IA (created_by
--      'ia' com conversa) tem vinculo e job_id.
--    - CHECK slot_hold_consumo_coerente: consulta e job do agendar so em
--      reserva consumida.
--    - Unicos parciais em job_id e em job_id_do_agendar (idempotencia);
--      indice parcial (conversation_id) where consumido_em is null (a
--      reserva viva da conversa); indices das FKs service_link_id e
--      appointment_id.
--    - exigir_cadastro_da_mesma_clinica (CREATE OR REPLACE, marca [reserva
--      da ia]): o vinculo e da clinica e do MESMO profissional; a conversa e
--      a consulta sao da clinica. O gatilho da tabela passa a olhar tambem
--      service_link_id, conversation_id e appointment_id.
--    - SEM exclusion constraint (o vencimento nao e imutavel): a exclusao
--      mutua vem de pg_advisory_xact_lock(hashtextextended('slot_hold:' ||
--      professional_id, 0)) nas duas RPCs, e de uma trava por conversa
--      (hashtextextended('slot_hold_conversa:' || conversation_id, 0)),
--      tomada sempre ANTES da do profissional, que garante uma reserva por
--      conversa mesmo com dois turnos da mesma conversa ao mesmo tempo. Com
--      recurso no procedimento (revisao da E4), uma terceira, por recurso
--      (hashtextextended('slot_hold_recurso:' || resource_id, 0)), sempre
--      DEPOIS da do profissional: duas conversas em dois profissionais que
--      usam a mesma sala nao reservam o mesmo horario. Ordem fixa
--      (conversa, profissional, recurso) nas duas RPCs: sem ciclo de
--      espera.
--    - limpar_holds_vencidos (CREATE OR REPLACE, marca [reserva da ia]) so
--      apaga reserva vencida NAO consumida: a consumida e o elo entre a
--      consulta e a conversa (a recusa acha a conversa por ela) e a
--      idempotencia do reservar e do agendar. Sem isso a manutencao do
--      motor (a cada minuto) apagava a consumida.
--
-- Resultado de negocio volta em JSON, nunca em excecao; nada aqui levanta
-- 40001 nem 40P01 (o PostgREST repetiria sem limite). Nenhum ALTER em
-- message, conversation ou contact (as FKs novas apontam para conversation
-- e appointment, ver LOCKS). Nenhum texto de paciente em erro, log ou
-- evento: os eventos levam data, hora, procedimento e profissional.
--
-- NADA LIGA SOZINHO: a habilidade agendar nasce desligada (skills sem a
-- chave) e as colunas nulas; sem as duas e a chave, as RPCs dizem
-- agenda_nao_configurada.
--
-- LOCKS: lock_timeout de 3 s. Ordem fixa: ai_agent_config em ACCESS
-- EXCLUSIVE (fria, poucas linhas; ADD COLUMN nula com CHECK, so catalogo e
-- a varredura do CHECK), depois as funcoes (CREATE e CREATE OR REPLACE, sem
-- trava de tabela) e, POR ULTIMO, slot_hold em ACCESS EXCLUSIVE (0 linhas
-- em 20/10/2026) com SHARE ROW EXCLUSIVE em service_link, conversation e
-- appointment pelas FKs novas: escrita nessas tres espera so o fim da
-- migration (alvo: bem menos de 1 s). Se cair por 55P03, nada fica
-- gravado: tentar de novo minutos depois. Horario calmo.
--
-- ORDEM: ensaio (~/.claude/plans/e4-agenda/ensaio-20261020130000.sql),
-- esta migration, regenerar os tipos e so DEPOIS o codigo. O codigo novo
-- antes da migration: a aba do agente nao salva (colunas inexistentes) e as
-- ferramentas de agenda falham (PGRST202). A migration com o codigo de
-- hoje: nada muda (colunas nulas, RPCs sem chamador; a limpeza das reservas
-- e a mesma para a reserva nao consumida).
--
-- ROLLBACK manual: PRIMEIRO voltar o codigo; depois rodar
-- supabase/operacao/rollback/20261020130000-corpos-anteriores.sql inteiro
-- (apaga as quatro funcoes novas, devolve os quatro corpos e os dois
-- comentarios, o gatilho da slot_hold como era e apaga as colunas novas).
-- As consultas que a IA marcou ficam (sao consultas como as outras); as
-- reservas perdem o elo com a conversa.
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- ===========================================================================
-- 1. ai_agent_config: antecedencia minima e horizonte da agenda
-- ===========================================================================

alter table public.ai_agent_config
  add column agenda_antecedencia_horas integer
    constraint ai_agent_config_agenda_antecedencia_faixa
      check (agenda_antecedencia_horas between 0 and 720),
  add column agenda_horizonte_dias integer
    constraint ai_agent_config_agenda_horizonte_faixa
      check (agenda_horizonte_dias between 1 and 365);

-- As mesmas permissoes por coluna de skills. A tabela nao tem grant de
-- tabela para authenticated (so por coluna) nem nada para anon.
grant select (agenda_antecedencia_horas, agenda_horizonte_dias),
      update (agenda_antecedencia_horas, agenda_horizonte_dias)
  on public.ai_agent_config to authenticated;

comment on column public.ai_agent_config.agenda_antecedencia_horas is
  'Antecedencia minima, em horas (0 a 720), para a IA marcar consulta: so oferece e so reserva horario que comeca a partir de agora + isto. Nula = a clinica ainda nao escolheu; sem ela (e sem agenda_horizonte_dias) a habilidade agendar nao liga.';
comment on column public.ai_agent_config.agenda_horizonte_dias is
  'Ate quantos dias a frente (1 a 365) a IA marca consulta: o inicio do horario vai ate agora + isto. Nula = a clinica ainda nao escolheu; sem ela (e sem agenda_antecedencia_horas) a habilidade agendar nao liga.';

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
    )
    select p_clinic_id, v_versao, a.agent_name, a.tone, a.use_emoji,
           a.greeting, a.closing, a.skills, a.operating_mode,
           a.fallback_minutes, a.operating_hours, a.escalation_rules,
           a.instrucoes
           -- [agenda da ia] inicio
           , a.agenda_antecedencia_horas, a.agenda_horizonte_dias
           -- [agenda da ia] fim
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
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

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
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- ===========================================================================
-- 2. Funcoes (sem trava de tabela)
-- ===========================================================================

-- 2a. O gatilho de clinica: na slot_hold, o vinculo, a conversa e a consulta
-- tambem sao da clinica (e o vinculo, do mesmo profissional).
create or replace function public.exigir_cadastro_da_mesma_clinica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profissional_do_vinculo uuid;
  v_pacote_ativo boolean;
begin
  if tg_table_name = 'appointment' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    select sl.professional_id into v_profissional_do_vinculo
      from service_link sl
     where sl.id = new.service_link_id and sl.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado não pertence a esta clínica.';
    end if;
    if v_profissional_do_vinculo is distinct from new.professional_id then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado é de outro profissional.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;
    if new.package_balance_id is not null and not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;
    -- Pacote com varios procedimentos (29/09/2026): o item de saldo que a
    -- consulta descontou e desta clinica e, quando a consulta tambem aponta
    -- o saldo, e um item DESSE saldo.
    if new.package_balance_item_id is not null and not exists (
      select 1 from package_balance_item
       where id = new.package_balance_item_id
         and clinic_id = new.clinic_id
         and (new.package_balance_id is null
              or package_balance_id = new.package_balance_id)
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'slot_hold' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    -- [reserva da ia] inicio
    -- A reserva da IA (E4, 20/10/2026): o vinculo e desta clinica e do
    -- mesmo profissional; a conversa e a consulta sao desta clinica. A FK
    -- so confere existencia, e a checagem de FK ignora RLS.
    if new.service_link_id is not null and not exists (
      select 1 from service_link
       where id = new.service_link_id
         and clinic_id = new.clinic_id
         and professional_id = new.professional_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado não é deste profissional nesta clínica.';
    end if;
    if new.conversation_id is not null and not exists (
      select 1 from conversation
       where id = new.conversation_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A conversa informada não pertence a esta clínica.';
    end if;
    if new.appointment_id is not null and not exists (
      select 1 from appointment
       where id = new.appointment_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A consulta informada não pertence a esta clínica.';
    end if;
    -- [reserva da ia] fim

  elsif tg_table_name = 'procedure' then
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'resource' then
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'service_link' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    if new.insurance_id is not null and not exists (
      select 1 from insurance
       where id = new.insurance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O convênio informado não pertence a esta clínica.';
    end if;
    -- A consulta exige vinculo DO MESMO profissional (acima). Trocar o
    -- profissional de um vinculo que ja tem consulta quebraria essa regra
    -- nas consultas antigas: o caminho e desativar e criar outro.
    if tg_op = 'UPDATE'
       and new.professional_id is distinct from old.professional_id
       and exists (select 1 from appointment where service_link_id = new.id)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este vínculo já tem consultas. Desative e crie outro.';
    end if;

  elsif tg_table_name = 'professional_schedule' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'professional_block' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package' then
    -- Desde 29/09/2026 os procedimentos do pacote moram em package_item, e
    -- package.procedure_id e legado (o codigo novo grava null). So confere
    -- quando vem preenchido: e o caminho do codigo publicado antes da troca.
    -- O congelamento depois da venda passou para package_item (gatilho
    -- travar_itens_de_pacote_vendido), onde vale para todo item.
    if new.procedure_id is not null and not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package_item' then
    if not exists (
      select 1 from package
       where id = new.package_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package_balance' then
    select p.active into v_pacote_ativo
      from package p
     where p.id = new.package_id and p.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    -- (2) Venda nova so de pacote ativo. Ajuste de saldo ja vendido
    -- (sessions_used) nao passa por aqui: o gatilho so olha INSERT e troca
    -- de package_id/clinic_id.
    if tg_op = 'INSERT' and v_pacote_ativo is not true then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote está desativado e não pode ser vendido.';
    end if;

  elsif tg_table_name = 'package_balance_item' then
    if not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    -- O item vendido e a copia do pacote no dia da venda: o procedimento e o
    -- saldo a que ele pertence nao mudam depois. Sessoes usadas mudam pelo
    -- debito e pelo ajuste (com motivo), nunca trocando o procedimento.
    if tg_op = 'UPDATE'
       and (new.procedure_id is distinct from old.procedure_id
            or new.package_balance_id is distinct from old.package_balance_id)
    then
      raise exception using errcode = 'check_violation',
        message = 'O procedimento de um pacote vendido não muda. Ajuste o saldo ou cancele a venda.';
    end if;

  elsif tg_table_name = 'clinic_member' then
    -- Vinculo usuario -> profissional (a tela e da leva 2): a policy de
    -- update de clinic_member so confere o papel do editor na clinica da
    -- linha, e a FK clinic_member_professional_fk so confere existencia.
    if new.professional_id is not null and not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account' then
    -- Unidade opcional do numero (decisao 3 do dono, 25/09/2026).
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account_secret' then
    -- account_id nulo e o caminho legado (so clinic_id): o gatilho
    -- preencher_conta_do_segredo, que roda DEPOIS deste pela ordem do nome,
    -- escolhe o principal da MESMA clinica, e o NOT NULL fecha o resto.
    if new.account_id is not null and not exists (
      select 1 from whatsapp_account
       where id = new.account_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_envio_automatico' then
    -- Modo fixo: o numero e desta clinica e nao foi removido. A mesma
    -- mensagem para "de outra clinica" e "nao existe": nada a aprender.
    if new.conta_fixa_id is not null then
      if not exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and clinic_id = new.clinic_id
      ) then
        raise exception using errcode = 'foreign_key_violation',
          message = 'O número escolhido não pertence a esta clínica.';
      end if;
      if exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and removido_em is not null
      ) then
        raise exception using errcode = 'check_violation',
          message = 'O número escolhido foi removido da clínica.';
      end if;
    end if;

  elsif tg_table_name = 'cadence' then
    -- Regua vinculada (29/09/2026): o procedimento e o profissional da regua
    -- sao desta clinica. A FK so confere existencia, e a checagem de FK
    -- ignora RLS: sem isto, o gestor de uma clinica apontava a regua dele
    -- para o cadastro de outra.
    if new.procedure_id is not null and not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    if new.professional_id is not null and not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
  end if;

  return new;
end;
$function$;

-- 2b. As conferencias do reservar e do agendar (4 a 9 do contrato).
create function public.conferir_horario_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_service_link_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reserva_propria uuid,
  out o_motivo text,
  out o_contato uuid,
  out o_profissional uuid,
  out o_fim timestamptz,
  out o_recurso uuid,
  out o_fuso text,
  out o_procedimento text,
  out o_nome_do_profissional text
)
language plpgsql
stable
set search_path = ''
as $$
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
$$;

revoke execute on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

comment on function public.conferir_horario_da_ia(uuid, uuid, uuid, timestamptz, timestamptz, uuid) is
  'Interna (nenhum papel da API executa): as conferencias que reservar_horario_da_ia e agendar_pela_ia repetem, na ordem do contrato da E4. o_motivo nulo = pode; senao ia_desligada, agenda_nao_configurada, vinculo_invalido, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado ou reservado_por_outra_conversa (reserva viva de outra conversa no mesmo profissional ou, quando o procedimento tem recurso, num vinculo de procedimento com o mesmo recurso). p_ends_at nulo = inicio + duracao do vinculo; p_reserva_propria fica fora da conferencia de reservas.';

-- 2c. A IA reserva um horario por 10 minutos.
create function public.reservar_horario_da_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_service_link_id uuid,
  p_starts_at timestamptz,
  p_job_id uuid
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
$$;

revoke execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid)
  to service_role;

comment on function public.reservar_horario_da_ia(uuid, uuid, uuid, timestamptz, uuid) is
  'So o servidor (service_role). A IA reserva por 10 minutos o horario p_starts_at do vinculo p_service_link_id para a conversa (uma reserva por conversa). Confere tudo de novo no banco (conferir_horario_da_ia) sob trava da conversa, do profissional e, quando o procedimento tem, do recurso. Devolve {ok:true, hold_id, starts_at, ends_at, expires_at, reutilizado} ou {ok:false, motivo}: ia_desligada, agenda_nao_configurada, vinculo_invalido, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, ocupado, reservado_por_outra_conversa. Idempotente pelo job_id (a reserva do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';

-- 2d. A IA marca a consulta reservada, pendente da aprovacao da equipe.
create function public.agendar_pela_ia(
  p_clinic_id uuid,
  p_conversation_id uuid,
  p_job_id uuid
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
$$;

revoke execute on function public.agendar_pela_ia(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agendar_pela_ia(uuid, uuid, uuid)
  to service_role;

comment on function public.agendar_pela_ia(uuid, uuid, uuid) is
  'So o servidor (service_role). Marca a consulta da reserva viva da conversa, depois de uma mensagem do paciente posterior a pergunta da IA (a primeira resposta da IA gravada depois da reserva, que nao falhou): agendado, created_by ia, approval_status pendente, send_confirmation false (a regua so comeca com a aprovacao), oferecer_vaga_ao_cancelar false, source interna; consome a reserva e grava o evento na conversa. Devolve {ok:true, appointment_id, starts_at, ends_at, reutilizado} ou {ok:false, motivo}: reserva_inexistente, reserva_vencida, ia_desligada, agenda_nao_configurada, vinculo_invalido, antes_da_antecedencia, depois_do_horizonte, fora_da_jornada, bloqueado, conflito (consulta no horario, inclusive o 23P01, sem gravar nada), reservado_por_outra_conversa, sem_confirmacao_do_paciente. Idempotente pelo job_id (a consulta do job volta com reutilizado true; job de outra conversa: 22023). Parametro nulo: 22004.';

-- 2e. Recusar a consulta da IA devolve a conversa para a equipe.
create function public.devolver_conversa_da_consulta_recusada(
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
$$;

revoke execute on function public.devolver_conversa_da_consulta_recusada(uuid, uuid)
  from public, anon;
grant execute on function public.devolver_conversa_da_consulta_recusada(uuid, uuid)
  to authenticated, service_role;

comment on function public.devolver_conversa_da_consulta_recusada(uuid, uuid) is
  'Depois de recusar a consulta que a IA marcou (created_by ia, approval_status recusado): acha a conversa pela reserva consumida (slot_hold.appointment_id); se ela estiver com a IA, passa para a equipe como a IA passa (aguardando_humano, Aguardando voce, jobs pendentes de responder_com_ia cancelados); em qualquer caso grava o evento "A equipe recusou a consulta marcada pela IA. Avise o paciente.". Quem escreve na clinica (user_can_write; o profissional so na propria agenda) e o servidor; senao 42501. Devolve se achou a conversa (consulta que nao e da IA, nao recusada ou sem reserva: false). Parametro nulo: 22004.';

-- ===========================================================================
-- 3. slot_hold, POR ULTIMO (trava curta em service_link, conversation e
--    appointment pelas FKs novas)
-- ===========================================================================

alter table public.slot_hold
  add column service_link_id uuid references public.service_link (id) on delete cascade,
  add column conversation_id uuid references public.conversation (id) on delete cascade,
  add column job_id uuid,
  add column consumido_em timestamptz,
  add column appointment_id uuid references public.appointment (id) on delete set null,
  add column job_id_do_agendar uuid,
  add constraint slot_hold_reserva_da_ia_completa check (
    created_by is distinct from 'ia'
    or conversation_id is null
    or (service_link_id is not null and job_id is not null)
  ),
  add constraint slot_hold_consumo_coerente check (
    consumido_em is not null
    or (appointment_id is null and job_id_do_agendar is null)
  );

create unique index slot_hold_job_id_unico
  on public.slot_hold (job_id)
  where job_id is not null;
create unique index slot_hold_job_id_do_agendar_unico
  on public.slot_hold (job_id_do_agendar)
  where job_id_do_agendar is not null;
create index slot_hold_reserva_viva_da_conversa
  on public.slot_hold (conversation_id)
  where consumido_em is null;
create index slot_hold_service_link_id_idx
  on public.slot_hold (service_link_id)
  where service_link_id is not null;
create index slot_hold_appointment_id_idx
  on public.slot_hold (appointment_id)
  where appointment_id is not null;

drop trigger if exists exigir_cadastro_da_mesma_clinica on public.slot_hold;
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, professional_id, service_link_id,
    conversation_id, appointment_id
  on public.slot_hold
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

create or replace function public.limpar_holds_vencidos()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  with apagados as (
    -- [reserva da ia] inicio: a reserva consumida fica (cabecalho da
    -- migration 20261020130000)
    delete from slot_hold where expires_at < now() and consumido_em is null returning 1
    -- [reserva da ia] fim
  )
  select count(*)::integer from apagados
$function$;

comment on column public.slot_hold.service_link_id is
  'Vinculo (procedimento e profissional) que a IA reservou. Da clinica e do mesmo profissional (gatilho exigir_cadastro_da_mesma_clinica).';
comment on column public.slot_hold.conversation_id is
  'Conversa do WhatsApp em que a IA reservou. Uma reserva viva por conversa (reservar_horario_da_ia solta a anterior).';
comment on column public.slot_hold.job_id is
  'Job (job_queue.id) do reservar_horario_da_ia: repetir o job devolve a mesma reserva. Sem FK: a fila e podada.';
comment on column public.slot_hold.consumido_em is
  'Quando a reserva virou consulta (agendar_pela_ia). A consumida nao e apagada pela limpeza: e o elo entre a consulta e a conversa.';
comment on column public.slot_hold.appointment_id is
  'A consulta que a reserva virou. devolver_conversa_da_consulta_recusada acha a conversa por aqui.';
comment on column public.slot_hold.job_id_do_agendar is
  'Job do agendar_pela_ia que consumiu a reserva: repetir o job devolve a mesma consulta.';
