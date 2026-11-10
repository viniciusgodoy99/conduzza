-- Rollback manual da migration 20261109120000_frase_do_assistente.sql (a frase
-- de assistente virtual de cada clinica, decisao do dono de 09/11/2026).
--
-- O QUE A MIGRATION FEZ: a coluna ai_agent_config.frase_do_assistente, com o
-- CHECK ai_agent_config_frase_do_assistente_valida e o grant por coluna da
-- sessao (select e update); agente_garantir_rascunho e
-- restaurar_versao_do_agente passaram a copiar a coluna, com os comentarios
-- dizendo isso.
--
-- O QUE ESTE ARQUIVO FAZ: devolve as duas funcoes aos corpos e aos
-- comentarios de antes (os da migration 20261028100000, lidos da producao
-- antes desta: md5(prosrc) c6ad117041028ca33d0fcc52b137aedc e
-- fa36784333b7415152ae972f286cb691), com os mesmos atributos e grants
-- (CREATE OR REPLACE os mantem); tira o CHECK e a coluna (o DROP COLUMN leva o
-- grant por coluna); e confere no fim os md5 dos corpos e dos comentarios e
-- que a coluna saiu. Com qualquer diferenca, falha e desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo (o de agora le e grava a coluna: com o
-- banco de antes, 42703, a Tela 6 nao abre e a IA de todas as clinicas falha
-- fechada), DEPOIS este arquivo. O codigo de antes funciona antes e depois
-- deste arquivo.
--
-- O QUE SE PERDE: as frases escritas pelas clinicas, em todas as versoes (o
-- assistente volta a frase padrao, FRASE_DO_ASSISTENTE_VIRTUAL). Conferir
-- antes, se for preciso (texto da clinica, nao de paciente):
--   select clinic_id, version, status, frase_do_assistente
--     from public.ai_agent_config
--    where frase_do_assistente is not null
--    order by clinic_id, version;
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_agent_config (o DROP COLUMN, sem reescrever a
-- tabela) e catalogo. lock_timeout de 3 s: com a tabela ocupada, o rollback
-- falha inteiro e roda-se de novo, em horario calmo.

begin;
-- inicio do rollback
set local lock_timeout = '3s';

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

alter table public.ai_agent_config
  drop constraint ai_agent_config_frase_do_assistente_valida,
  drop column frase_do_assistente;

do $conferencia$
declare
  v_dif text;
begin
  select string_agg(x.nome, ', ') into v_dif
    from (values
      ('agente_garantir_rascunho', to_regprocedure('public.agente_garantir_rascunho(uuid)'), 'c6ad117041028ca33d0fcc52b137aedc', '28de88b91a4d3465cf6dc512855f4067'),
      ('restaurar_versao_do_agente', to_regprocedure('public.restaurar_versao_do_agente(uuid, integer)'), 'fa36784333b7415152ae972f286cb691', 'fea4318a09f08d1220c9671c15a8ba1d')
    ) as x(nome, oid, corpo, comentario)
    left join pg_catalog.pg_proc p on p.oid = x.oid
   where md5(p.prosrc) is distinct from x.corpo
      or md5(pg_catalog.obj_description(p.oid, 'pg_proc')) is distinct from x.comentario;
  if v_dif is not null then
    raise exception using errcode = 'P0001', message = 'rollback_corpo_diferente',
      hint = 'Nao voltaram ao corpo ou ao comentario de antes da 20261109120000: ' || v_dif;
  end if;
  if exists (
    select 1
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.ai_agent_config'::regclass
       and a.attname = 'frase_do_assistente'
       and not a.attisdropped
  ) then
    raise exception using errcode = 'P0001', message = 'rollback_coluna_ficou';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';
-- fim do rollback
commit;
