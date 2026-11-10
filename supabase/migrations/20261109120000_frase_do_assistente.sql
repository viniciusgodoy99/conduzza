-- ---------------------------------------------------------------------------
-- A frase de assistente virtual de cada clinica (decisao do dono de
-- 09/11/2026)
-- ---------------------------------------------------------------------------
-- O dono: "Isso é pra ser configurado na aba de agente de IA de cada
-- clinica". A frase que o sistema cola antes da primeira resposta da IA em
-- cada janela da conversa (P11a) e que responde o "você é um robô?" (P5c) era
-- a constante FRASE_DO_ASSISTENTE_VIRTUAL (lib/domain/conformidade/
-- frase-fixa.ts), igual para todas. Agora cada clinica escreve a sua na aba
-- Persona da Tela 6, e a constante vira a frase PADRAO.
--
-- O QUE MUDA:
--   1. ai_agent_config.frase_do_assistente (text, nula, sem default): a frase
--      da clinica. Nula = a padrao (o codigo, fraseDoAssistenteVirtual).
--      Versionada como a saudacao: grava no rascunho (pela persona), vale ao
--      publicar e volta no restaurar. As versoes que ja existem leem nula (a
--      padrao, o que esta no ar): nada muda para o paciente ate a clinica
--      escrever e publicar.
--   2. O CHECK ai_agent_config_frase_do_assistente_valida, o espelho do que a
--      tela e a Server Action conferem (nunca mais estrito que elas): ate 300
--      caracteres, sem link (http, :// ou www.) e dizendo que e virtual
--      ("virtual" ou "inteligencia artificial", palavras inteiras, sem caixa
--      e sem os acentos do portugues; dizQueEVirtual em
--      lib/domain/agente/config.ts). O filtro do CFM nao cabe no banco: fica
--      na Server Action e no publicar (problemaNoTextoDoAgente), e a frase
--      passa pelo filtro de saida inteiro em cada resposta, como a saudacao.
--   3. O grant por coluna da sessao (select e update), como o dos exige_* e
--      o dos prazos (a tabela nao tem grant de tabela para authenticated, so
--      por coluna, e nada para anon). A policy de UPDATE continua so no
--      rascunho, so administrador e gestor (e o super admin); a publicada nao
--      muda (proteger_versao_publicada_do_agente).
--   4. agente_garantir_rascunho e restaurar_versao_do_agente copiam a coluna:
--      CREATE OR REPLACE do corpo da migration 20261028100000 (a ultima que os
--      trocou; md5 do prosrc na producao c6ad117041028ca33d0fcc52b137aedc e
--      fa36784333b7415152ae972f286cb691), so com as linhas do marcador
--      [frase do assistente]. Seguranca, search_path e grants ficam (CREATE OR
--      REPLACE mantem os grants); os comentarios ganham a frase.
--   publicar_agente nao muda: publicar so troca o status da linha do
--   rascunho, que ja tem a frase.
--
-- TRAVAS (lock_timeout de 3 s): ACCESS EXCLUSIVE em ai_agent_config pelo ADD
-- COLUMN e pelo CHECK (a coluna nasce nula, sem reescrever a tabela; o CHECK
-- varre as poucas versoes), ate o commit: a Tela 6 e o turno da IA esperam os
-- milissegundos. Com a tabela ocupada por 3 s, falha inteira (55P03) e nada e
-- gravado: rodar de novo, em horario calmo. O resto e catalogo.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. O codigo novo le a
-- coluna (sem ela, 42703: a Tela 6 nao abre e a IA de todas as clinicas falha
-- fechada) e a grava ao salvar a persona. Com a migration e o codigo de hoje,
-- nada muda: a coluna nasce nula, e o codigo de hoje nao a le nem a grava.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo; DEPOIS, numa
-- transacao, no SQL editor,
-- supabase/operacao/rollback/20261109120000-corpos-anteriores.sql (os dois
-- corpos e os dois comentarios de antes, conferidos por md5; a coluna sai,
-- com o CHECK e o grant). SE PERDE: as frases escritas pelas clinicas (o
-- assistente volta a padrao).
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) A coluna, o CHECK e o grant
-- ---------------------------------------------------------------------------

alter table public.ai_agent_config
  add column frase_do_assistente text,
  add constraint ai_agent_config_frase_do_assistente_valida check (
    frase_do_assistente is null
    or (
      char_length(frase_do_assistente) <= 300
      and frase_do_assistente !~* '(http|://|www\.)'
      and translate(
            lower(frase_do_assistente),
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
          ) ~ '\m(virtual|inteligencia[^[:alnum:]]+artificial)\M'
    )
  );

grant select (frase_do_assistente), update (frase_do_assistente)
  on public.ai_agent_config to authenticated;

comment on column public.ai_agent_config.frase_do_assistente is
  'A frase de assistente virtual da clinica (decisao do dono de 09/11/2026): o aviso que o sistema cola antes da primeira resposta da IA em cada janela da conversa e a resposta ao "você é um robô?". Nula: a frase padrao do codigo (FRASE_DO_ASSISTENTE_VIRTUAL). Versionada: grava no rascunho, vale ao publicar e volta no restaurar; o rascunho copia a ultima publicada. Ate 300 caracteres, sem link e dizendo que e virtual (ai_agent_config_frase_do_assistente_valida); o filtro do CFM roda na Server Action, no publicar e em cada resposta.';

-- ---------------------------------------------------------------------------
-- 2) O rascunho copia a frase da ultima publicada
-- ---------------------------------------------------------------------------

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
      -- [frase do assistente] inicio
      , frase_do_assistente
      -- [frase do assistente] fim
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
           -- [frase do assistente] inicio
           , a.frase_do_assistente
           -- [frase do assistente] fim
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
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda, o publico atendido, os dados que a IA exige para marcar, os prazos para cancelar e remarcar e a frase de assistente virtual) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

-- ---------------------------------------------------------------------------
-- 3) Restaurar uma versao devolve a frase dela
-- ---------------------------------------------------------------------------

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
         -- [frase do assistente] inicio
         frase_do_assistente = v_origem.frase_do_assistente,
         -- [frase do assistente] fim
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
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda, o publico atendido, os dados que a IA exige para marcar, os prazos para cancelar e remarcar e a frase de assistente virtual, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';
