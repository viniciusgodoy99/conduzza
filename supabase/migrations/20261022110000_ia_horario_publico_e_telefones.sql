-- ---------------------------------------------------------------------------
-- Horario do assistente, publico, fora do assunto, excluir telefone e
-- telefone de paciente como teste (onda 2, itens 7, 4, 5, 9 e 3)
-- ---------------------------------------------------------------------------
-- Plano aprovado pelo dono em 20/10/2026 (segunda reuniao com o Victor);
-- contrato entre as frentes em ~/.claude/plans/onda2-agente/contrato.md,
-- secao 2. Decisoes do dono de 20 e 21/10/2026: P4a (o publico mora na
-- configuracao do agente, versionada), P4b (o filtro vale para os
-- telefones da equipe), P7a (so voltam para a IA as conversas que ficaram
-- com a equipe por causa do horario e que ninguem da equipe tocou), P3 (a)
-- (o administrador forca o telefone de um paciente que aceitou testar, com
-- a confirmacao na trilha). Vem DEPOIS da 20261022100000 (conversao na
-- aprovacao); o ensaio confere os corpos de producao lidos depois dela.
--
-- 1. HORARIO (item 7): o banco decide; a conversa do expediente nasce com a
--    equipe e volta para a IA no horario do assistente.
--    - ia_horario_do_assistente(clinica, agora): espelho exato de
--      horarioDoBanco + agenteAtendeAgora (lib/domain/agente/config.ts)
--      sobre a ULTIMA versao publicada, no fuso da clinica (vazio ou
--      invalido cai em America/Fortaleza). Devolve 'atende',
--      'no_expediente', 'modo_nao_suportado' (o modo "Se a equipe nao
--      responder"), 'sem_versao' ou 'indisponivel' (erro inesperado; quem
--      chama trata como "fica com a equipe"). Nunca lanca. A tabela verdade
--      unica (tests/fixtures/ia/horario-do-assistente.ts) roda no TS e no
--      ensaio. Residuo conhecido: fuso em offset POSIX ('+03:00') o banco le
--      a oeste e o TS a leste; a tela so grava fusos IANA do Brasil.
--    - ingest_inbound_message (marca [onda 2: horario da ia], so dentro de
--      "if v_candidata", o telefone da equipe): a conversa nova so nasce na
--      IA com a liberacao E o horario; a que ja esta na IA so segue com os
--      dois. Quando a UNICA razao e o horario, a conversa nova fica
--      aguardando_humano com o evento no_expediente (ou
--      horario_nao_suportado) em vez de parada, e a que estava na IA vai
--      para a equipe com fora_do_horario (ou horario_nao_suportado); no
--      expediente, a conversa ganha a linha de espera em
--      ia_conversa_fora_do_horario (a nova desde agora, origem 'ingestao';
--      a que estava na IA desde a janela que ja tinha, origem 'turno').
--      Outra razao: parada, como hoje. Fora do telefone da equipe e com o
--      horario do assistente, NADA muda. Preparo inerte da M3 (marca
--      [onda 2: preparo da producao]): v_candidata tambem casa a clinica liberada
--      em numero_inteiro, que o CHECK de hoje nao deixa existir.
--    - ia_tirar_conversa (interna): com o motivo fora_do_horario (a
--      passagem do executor no comeco do expediente) e a conversa de fato
--      tirada, a mesma linha de espera, origem 'turno'.
--    - ia_retomar_conversas_no_horario(limite, incluir_teste): a cada minuto
--      pela motor_manutencao. Antes do laco, a linha de mais de 24 horas
--      sai, de qualquer clinica (a da clinica que saiu da fase e a da
--      conversa apagada nao guardam o telefone para sempre). Por linha
--      (FOR UPDATE SKIP LOCKED; depois FOR SHARE SKIP LOCKED na liberacao
--      e no interruptor, sem esperar: a manutencao ja travou conversas no
--      bloco [resposta da ia] e esperar por uma definir_* fecharia um
--      deadlock; trava ocupada, a linha fica; e a conversa FOR NO KEY
--      UPDATE SKIP LOCKED, a ordem do E3): descarta sem tocar a conversa
--      quando ela sumiu, nao esta aguardando a equipe (resolvida, em
--      atendimento, na IA), tem responsavel, mudou de contato, telefone ou
--      numero, tem mensagem de pessoa da equipe (author 'usuario': pelo
--      sistema, pelo celular ou nota) desde a espera, ou a linha passou de
--      24 horas; ainda fora do horario do assistente, fica; no horario e com
--      ia_atende_no_whatsapp (liberacao, teto, publico, trava K, versao),
--      a conversa volta para a IA (janela aberta_por 'horario' com o desde
--      da espera; a conversa nova e a que tinha a janela da ingestao, desde
--      a primeira mensagem da conversa, para a rajada cuja transacao
--      comecou antes da que criou a conversa entrar), com o evento
--      retomou_no_horario, e a ultima mensagem do
--      paciente vai para a fila (enfileirar_resposta_da_ia confere tudo de
--      novo); sem ia_atende_no_whatsapp, a linha sai e a conversa fica com a
--      equipe. Nunca lanca por linha. Devolve {retomadas, descartadas,
--      enfileiradas, erros_por_linha}.
--    - motor_manutencao (diff minimo): no bloco [resposta da ia], "o
--      paciente espera ha mais de 3 minutos" conta de greatest(ultima
--      mensagem, janela) (a retomada as 18h com mensagem das 17h30 tem 3
--      minutos a partir da retomada; sem janela e como antes); bloco novo
--      [onda 2: horario da ia] depois dele, com exception proprio (ia_horario:
--      <SQLSTATE> e ia_horario_erros:<n> no planner_erro); o retorno ganha
--      horario_da_ia.
--    - ia_janela_da_conversa: o CHECK aceita aberta_por 'horario' (tem o
--      corte do desde, como 'devolver', em ia_marcar_respondida e no
--      historico; o codigo endurecido ja le assim).
--    - rotulo_do_motivo_da_ia: no_expediente, retomou_no_horario, o texto
--      novo de horario_nao_suportado e fora_do_assunto (textos propostos no
--      contrato, secao 9; o espelho TEXTO_DO_EVENTO_DA_IA muda junto).
--
-- 2. PUBLICO (item 4): ai_agent_config.publico_atendido ('leads',
--    'pacientes', 'todos'; nula = ainda nao escolhido), com a permissao por
--    coluna de skills (o rascunho pela sessao de administrador e gestor; a
--    publicada nao muda). agente_garantir_rascunho e
--    restaurar_versao_do_agente copiam a coluna (marca [onda 2: publico da ia]).
--    ia_publico_aceita(clinica, telefone): o publico da ultima publicada e
--    o kind do contato pela chave (sem contato = lead); nulo aceita no modo
--    contatos (o teste de hoje nao muda) e recusa em qualquer outro.
--    ia_atende_no_whatsapp passa a exigir ia_publico_aceita (so na
--    entrada; ia_pode_falar_com nao muda). situacao_da_ia_na_clinica ganha
--    telefones_fora_do_publico.
--
-- 3. FORA DO ASSUNTO (item 5, parte do banco): o CHECK de
--    ai_decision_log.escalation_reason aceita 'fora_do_assunto', o rotulo
--    do evento (acima) e o indice parcial ai_decision_log_fora_do_assunto_idx
--    (conversation_id, created_at), para a contagem que o executor faz em
--    todo turno (foraDoAssuntoNaJanela). O resto e codigo.
--
-- 4. EXCLUIR TELEFONE (item 9): excluir_contato_liberado_da_ia(clinica,
--    id): o guarda de quem libera (administrador ativo da propria clinica
--    habilitada, super admin, servidor; o resto 42501), 22004 em nulo,
--    FOR UPDATE na liberacao da clinica (a ordem das definir_*), apaga a
--    linha (sem linha: false, sem trilha), ia_desligar (a conversa desse
--    telefone volta para a equipe) e a trilha excluiu_telefone_da_ia (o id,
--    nunca o telefone). Excluir telefone forcado apaga o forcar.
--
-- 5. TELEFONE DE PACIENTE COMO TESTE (item 3, P3 (a)):
--    definir_contato_liberado_da_ia ganha p_confirmou_teste_com_paciente
--    boolean default false (DROP da assinatura de 6 parametros e CREATE da
--    de 7, os mesmos grants, como a 20261019120000 fez). O FORCAR deixa de
--    exigir a equipe Conduzza: basta o guarda de sempre mais a confirmacao
--    (sem ela, 23514 teste_com_paciente_nao_confirmado, conferido antes de
--    qualquer leitura), e as trilhas forcou_telefone_de_paciente_na_ia e
--    confirmou_teste_com_paciente no nome de quem forcou. Vale para o
--    super admin tambem (a confirmacao e de quem forca).
--
-- Funcoes trocadas (corpo de PRODUCAO lido por fndef.js em 21/10/2026,
-- guardado em supabase/operacao/rollback/20261022110000-corpos-anteriores.sql
-- com o md5 do prosrc; o ensaio confere que o banco ainda esta assim):
-- ingest_inbound_message, motor_manutencao, ia_tirar_conversa,
-- ia_atende_no_whatsapp, rotulo_do_motivo_da_ia, situacao_da_ia_na_clinica,
-- agente_garantir_rascunho, restaurar_versao_do_agente (CREATE OR REPLACE:
-- security, search_path e grants como eram) e
-- definir_contato_liberado_da_ia (DROP e CREATE, grants refeitos). O trecho
-- novo de cada uma esta entre "-- [<marca>] inicio" e "... fim"; o resto e
-- o corpo de producao linha a linha. Funcoes novas: ia_horario_do_assistente,
-- ia_publico_aceita, ia_retomar_conversas_no_horario (so service_role) e
-- excluir_contato_liberado_da_ia (authenticated e service_role). Tabela
-- nova: ia_conversa_fora_do_horario (RLS ligada, sem policy, nada para anon
-- e authenticated; so as funcoes do banco escrevem). Erros de regra: 22004,
-- 22023, 23514 (teste_com_paciente_nao_confirmado) e 42501. Nunca
-- 40001/40P01. Nenhum texto de paciente em erro, evento ou trilha.
--
-- LOCKS: lock_timeout de 3 s. ACCESS EXCLUSIVE curto em ai_agent_config
-- (fria, 3 linhas), ai_decision_log (fria, 3 linhas; o indice novo nasce
-- na mesma trava) e
-- ia_janela_da_conversa (1 linha), nessa ordem, ate o commit; a FK nova
-- segura SHARE ROW EXCLUSIVE em clinic ate o commit (escrita em clinic
-- espera; leitura nao). ingest_inbound_message e motor_manutencao: CREATE
-- OR REPLACE, sem trava de tabela. Nenhum ALTER em message, conversation,
-- contact, clinic_member, job_queue nem clinic. Horario calmo.
--
-- ORDEM: o codigo endurecido da janela (aberta_por desconhecido com o corte
-- do desde) ANTES; ensaio (~/.claude/plans/onda2-agente/
-- ensaio-20261022110000.sql), esta migration, conferir os md5 novos, os
-- testes de RLS e de integracao, e so DEPOIS o codigo que le
-- publico_atendido e chama as RPCs novas (antes dela, 42703 e a IA das
-- duas clinicas para). O codigo de hoje com a migration: a aba le a
-- situacao sem a chave nova (o leitor tolerante a ignora); "Usar mesmo
-- assim" do super admin sem a confirmacao da 23514 (falha generica);
-- nenhuma versao publicada esta em fora_expediente (21/10/2026), entao o
-- horario nao muda nada ate alguem publicar um.
--
-- ROLLBACK (manual): o codigo antes; depois, numa transacao, no SQL editor,
-- supabase/operacao/rollback/20261022110000-corpos-anteriores.sql (os oito
-- corpos de antes, a definir_contato_liberado_da_ia de 6 parametros, as
-- funcoes novas, a tabela e o indice saem, a coluna publico_atendido por
-- ultimo). Os valores novos dos dois CHECKs ficam (inofensivos).

set local lock_timeout = '3s';

-- ===========================================================================
-- 1. As tabelas, na ordem das travas: ai_agent_config, ai_decision_log,
--    ia_janela_da_conversa e a tabela nova
-- ===========================================================================

alter table public.ai_agent_config
  add column publico_atendido text
    constraint ai_agent_config_publico_valido
      check (publico_atendido in ('leads', 'pacientes', 'todos'));

-- As mesmas permissoes por coluna de skills (a tabela nao tem grant de
-- tabela para authenticated, so por coluna, e nada para anon). A policy de
-- UPDATE continua so no rascunho, so administrador e gestor (e o super
-- admin); a publicada nao muda (proteger_versao_publicada_do_agente).
grant select (publico_atendido), update (publico_atendido)
  on public.ai_agent_config to authenticated;

comment on column public.ai_agent_config.publico_atendido is
  'Quem o assistente atende no WhatsApp (onda 2, item 4): leads, pacientes ou todos. Nula = a clinica ainda nao escolheu (no teste vale tudo; fora do teste, falha fechada). Versionada: vale ao publicar. Conferida na entrada da conversa por ia_publico_aceita.';

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
      'pedido_de_agenda',
      -- onda 2, item 5: a pessoa insistiu num assunto fora da clinica
      'fora_do_assunto'));

-- Onda 2, item 5 (revisao): o executor conta, em todo turno da IA, as
-- respostas de fora do assunto da conversa desde a janela
-- (foraDoAssuntoNaJanela, lib/agente/whatsapp.ts). Sem este indice o count
-- varreria as decisoes da clinica inteira. Parcial: so as linhas que a
-- contagem le. A tabela ja esta travada (o CHECK acima) e e fria.
create index ai_decision_log_fora_do_assunto_idx
  on public.ai_decision_log (conversation_id, created_at)
  where tool_used = 'fora_do_assunto' and desfecho = 'respondeu';

alter table public.ia_janela_da_conversa
  drop constraint ia_janela_aberta_por_valida;
alter table public.ia_janela_da_conversa
  add constraint ia_janela_aberta_por_valida
    check (aberta_por in ('ingestao', 'devolver',
                          -- onda 2, item 7: a retomada no horario do assistente
                          'horario'));

comment on table public.ia_janela_da_conversa is
  'De quando a IA pode ler a conversa (desde) e com qual contato e chave de telefone. Gravada pela ingestao (conversa nova na IA), por devolver_para_ia e pela retomada no horario do assistente (ia_retomar_conversas_no_horario, aberta_por horario). Janela aberta pela ingestao (conversa nova) vale para a conversa inteira; a do devolver e a do horario, a partir de desde.';

create table public.ia_conversa_fora_do_horario (
  -- Sem FK para conversation (como ia_janela_da_conversa): nao trava a
  -- tabela quente. A retomada descarta a linha da conversa que sumiu.
  conversation_id uuid primary key,
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null,
  phone_key text not null
    constraint ia_conversa_fora_do_horario_telefone_valido
      check (phone_key ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_account_id uuid not null,
  desde timestamptz not null default now(),
  origem text not null
    constraint ia_conversa_fora_do_horario_origem_valida
      check (origem in ('ingestao', 'turno')),
  criada_em timestamptz not null default now()
);

create index ia_conversa_fora_do_horario_clinic_id_idx
  on public.ia_conversa_fora_do_horario (clinic_id);

alter table public.ia_conversa_fora_do_horario enable row level security;

-- Nenhuma sessao le nem escreve (sem policy): so as funcoes do banco.
revoke all on table public.ia_conversa_fora_do_horario from anon, authenticated;

comment on table public.ia_conversa_fora_do_horario is
  'A conversa espera o horario do assistente (onda 2, item 7): ficou com a equipe so por causa do horario (conversa nova no expediente, origem ingestao; ou estava na IA quando o expediente comecou, origem turno). desde: de quando a IA vai ler na retomada (a nova, desde a primeira mensagem; a que estava na IA, desde a janela que ja tinha). criada_em: quando a linha nasceu (passou de 24 horas, sai). Escrita pela ingestao e por ia_tirar_conversa; lida e apagada por ia_retomar_conversas_no_horario. Nenhuma sessao le.';

-- ===========================================================================
-- 2. O horario do assistente no banco
-- ===========================================================================

create function public.ia_horario_do_assistente(
  p_clinic_id uuid,
  p_agora timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_modo text;
  v_horas jsonb;
  v_fuso text;
  v_local timestamp;
  v_dia text;
  v_faixa jsonb;
  v_aberto boolean;
  v_inicio text;
  v_fim text;
  v_inicio_min integer;
  v_fim_min integer;
  v_minutos integer;
begin
  -- A ultima versao publicada (a que o executor le: status publicada, a
  -- maior version).
  select a.operating_mode, a.operating_hours
    into v_modo, v_horas
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if not found then
    return 'sem_versao';
  end if;

  -- horarioDoBanco: modo que o codigo nao conhece vira o padrao (24h).
  if v_modo is null or v_modo not in ('24h', 'fora_expediente', 'fallback') then
    v_modo := '24h';
  end if;
  if v_modo = '24h' then
    return 'atende';
  end if;
  -- "Se a equipe nao responder" ainda nao atende no WhatsApp.
  if v_modo = 'fallback' then
    return 'modo_nao_suportado';
  end if;
  -- fora_expediente com instante invalido falha fechado (agenteAtendeAgora).
  if p_agora is null or not isfinite(p_agora) then
    return 'no_expediente';
  end if;

  -- O fuso da clinica; vazio ou invalido cai em America/Fortaleza (o
  -- "at time zone" invalido levanta 22023: a licao do E0).
  select nullif(c.timezone, '') into v_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  begin
    v_local := p_agora at time zone coalesce(v_fuso, 'America/Fortaleza');
  exception when others then
    v_local := p_agora at time zone 'America/Fortaleza';
  end;
  v_dia := (array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'])
           [extract(dow from v_local)::integer + 1];

  -- faixaDoBanco: o dia da grade (so se a grade e um objeto); dia ausente,
  -- que nao e objeto ou sem "aberto" booleano usa a padrao do dia (segunda
  -- a sexta 08:00 a 18:00 abertas, sabado e domingo fechados).
  if jsonb_typeof(v_horas) = 'object' then
    v_faixa := v_horas -> v_dia;
  end if;
  if jsonb_typeof(v_faixa) = 'object'
     and jsonb_typeof(v_faixa -> 'aberto') = 'boolean' then
    v_aberto := (v_faixa ->> 'aberto')::boolean;
    if jsonb_typeof(v_faixa -> 'inicio') = 'string' then
      v_inicio := v_faixa ->> 'inicio';
    end if;
    if jsonb_typeof(v_faixa -> 'fim') = 'string' then
      v_fim := v_faixa ->> 'fim';
    end if;
  else
    v_aberto := v_dia not in ('dom', 'sab');
    v_inicio := '08:00';
    v_fim := '18:00';
  end if;

  -- estaNoExpediente: dia fechado nunca e expediente.
  if not v_aberto then
    return 'atende';
  end if;
  -- Dia aberto com hora fora do formato HH:mm (00:00 a 23:59) ou com o fim
  -- antes do inicio (ou igual) vale 08:00 a 18:00.
  v_inicio_min := 480;
  v_fim_min := 1080;
  if v_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and v_fim ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    if left(v_fim, 2)::integer * 60 + right(v_fim, 2)::integer
       > left(v_inicio, 2)::integer * 60 + right(v_inicio, 2)::integer then
      v_inicio_min := left(v_inicio, 2)::integer * 60 + right(v_inicio, 2)::integer;
      v_fim_min := left(v_fim, 2)::integer * 60 + right(v_fim, 2)::integer;
    end if;
  end if;

  -- Dentro = minutos locais (hora x 60 + minuto, sem os segundos) >= inicio
  -- e < fim.
  v_minutos := extract(hour from v_local)::integer * 60
               + extract(minute from v_local)::integer;
  if v_minutos >= v_inicio_min and v_minutos < v_fim_min then
    return 'no_expediente';
  end if;
  return 'atende';
exception when others then
  -- Nunca lanca: quem chama trata como "fica com a equipe".
  return 'indisponivel';
end;
$$;

revoke all on function public.ia_horario_do_assistente(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ia_horario_do_assistente(uuid, timestamptz)
  to service_role;

comment on function public.ia_horario_do_assistente(uuid, timestamptz) is
  'O horario do assistente agora (onda 2, item 7): espelho de horarioDoBanco + agenteAtendeAgora sobre a ultima versao publicada, no fuso da clinica (vazio ou invalido: America/Fortaleza). atende, no_expediente, modo_nao_suportado (fallback), sem_versao ou indisponivel (erro inesperado; quem chama fica com a equipe). Nunca lanca. So service_role (e as funcoes do banco).';

-- ===========================================================================
-- 3. O publico do assistente
-- ===========================================================================

create function public.ia_publico_aceita(p_clinic_id uuid, p_telefone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_clinic_id is null or p_telefone is null then false
    else coalesce(
      case (
        select a.publico_atendido
          from public.ai_agent_config a
         where a.clinic_id = p_clinic_id
           and a.status = 'publicada'
         order by a.version desc
         limit 1
      )
        when 'todos' then true
        -- Sem contato e o contato novo da ingestao: lead.
        when 'leads' then coalesce((
          select k.kind
            from public.contact k
           where k.clinic_id = p_clinic_id
             and k.phone_key = public.chave_telefone(btrim(p_telefone))
        ), 'lead') = 'lead'
        when 'pacientes' then (
          select k.kind
            from public.contact k
           where k.clinic_id = p_clinic_id
             and k.phone_key = public.chave_telefone(btrim(p_telefone))
        ) = 'paciente'
        -- Ainda nao escolhido: so no teste (modo contatos); em qualquer
        -- outro modo, falha fechada.
        else (
          select l.modo
            from public.ia_liberacao l
           where l.clinic_id = p_clinic_id
        ) = 'contatos'
      end,
      false)
  end
$$;

revoke all on function public.ia_publico_aceita(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ia_publico_aceita(uuid, text)
  to service_role;

comment on function public.ia_publico_aceita(uuid, text) is
  'O publico da ultima versao publicada aceita o contato deste telefone (onda 2, item 4)? todos aceita; leads so lead; pacientes so paciente (o kind pela chave do telefone; sem contato = lead). Nulo (ainda nao escolhido) aceita so no modo contatos. Nulo em qualquer argumento: falso. So service_role (e as funcoes do banco).';

create or replace function public.ia_atende_no_whatsapp(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_telefone)
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    -- [onda 2: publico da ia] inicio
    -- Onda 2, item 4: o publico da versao publicada (so leads, so
    -- pacientes ou os dois). So na ENTRADA (conversa nova, Devolver,
    -- retomada no horario): o lead que vira paciente no meio da conversa
    -- continua (ia_pode_falar_com nao olha o publico).
    and public.ia_publico_aceita(p_clinic_id, p_telefone)
    -- [onda 2: publico da ia] fim
    and not public.telefone_e_numero_da_plataforma(p_telefone),
    false
  )
$function$;

comment on function public.ia_atende_no_whatsapp(uuid, uuid, text) is
  'Conversa NOVA deste telefone neste numero entra na IA? ia_pode_atender (liberacao, teto, numero, lista) mais a trava K (o forcado passa), a versao publicada, o publico da versao publicada (ia_publico_aceita, onda 2) e nunca numero da plataforma. So na entrada: conversa nova, Devolver e retomada no horario. So service_role (e as funcoes do banco).';

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

create or replace function public.situacao_da_ia_na_clinica(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_teto boolean;
  v_versao integer;
  v_invalidos jsonb;
  v_sem_autorizacao jsonb;
  v_abertas jsonb;
  v_motor jsonb;
  -- [conversa aberta por numero] inicio
  v_conversas jsonb;
  -- [conversa aberta por numero] fim
  -- [onda 2: publico da ia] inicio
  v_fora_do_publico jsonb;
  -- [onda 2: publico da ia] fim
begin
  if not (
    (auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role')
    or public.is_product_admin()
    or public.ia_membro_ve_a_liberacao(p_clinic_id)
  ) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select coalesce((
    select (
      select coalesce(sum(u.custo_microdolar), 0)
        from public.ia_uso u
       where u.clinic_id = l.clinic_id
         and u.created_at >= now() - interval '24 hours'
    ) >= l.teto_diario_centavos_usd::bigint * 10000
      from public.ia_liberacao l
     where l.clinic_id = p_clinic_id
  ), false) into v_teto;

  select max(a.version) into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada';

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_invalidos
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and (public.telefone_e_numero_da_plataforma(k.phone_key)
          or (not k.forcado
              and public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key)));

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_sem_autorizacao
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and exists (
       select 1
         from public.contact ct
        where ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and (
            select cc.revoked_at is not null
              from public.contact_consent cc
             where cc.clinic_id = p_clinic_id
               and cc.contact_id = ct.id
               and cc.channel = 'whatsapp'
             order by cc.granted_at desc, cc.created_at desc
             limit 1
          ) is true
     );

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_abertas
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and exists (
       select 1
         from public.conversation c
         join public.contact ct on ct.id = c.contact_id
        where c.clinic_id = p_clinic_id
          and ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and c.status in ('aguardando_humano', 'em_atendimento')
          and c.whatsapp_account_id in (
            select n.whatsapp_account_id
              from public.ia_numero_liberado n
              join public.whatsapp_account w on w.id = n.whatsapp_account_id
             where n.clinic_id = p_clinic_id
               and n.ativo
               and w.removido_em is null
          )
     );

  -- [conversa aberta por numero] inicio
  -- Por telefone ATIVO da lista e por numero LIGADO (nao removido) da
  -- clinica: a conversa aberta com a equipe (aguardando ou em atendimento)
  -- do contato desse telefone naquele numero. A ingestao so poe na IA a
  -- conversa NOVA; enquanto esta estiver aberta, a mensagem do telefone
  -- nesse numero fica com a equipe. A aba diz o numero e leva a conversa
  -- (o id), para alguem assumir e resolver. No maximo uma por par: o
  -- contato e unico pela chave na clinica, e conversation_aberta_por_numero
  -- so deixa uma conversa nao resolvida por contato e numero (o distinct on
  -- e so a segunda camada, com a mais recente).
  select coalesce(jsonb_agg(jsonb_build_object(
           'telefone_id', a.telefone_id,
           'whatsapp_account_id', a.whatsapp_account_id,
           'conversation_id', a.conversation_id
         ) order by a.telefone_criado, a.telefone_id, a.numero_criado, a.whatsapp_account_id), '[]'::jsonb)
    into v_conversas
    from (
      select distinct on (k.id, n.whatsapp_account_id)
             k.id as telefone_id,
             k.created_at as telefone_criado,
             n.whatsapp_account_id,
             n.created_at as numero_criado,
             c.id as conversation_id
        from public.ia_contato_liberado k
        join public.contact ct
          on ct.clinic_id = p_clinic_id
         and ct.phone_key = k.phone_key
        join public.conversation c
          on c.clinic_id = p_clinic_id
         and c.contact_id = ct.id
         and c.status in ('aguardando_humano', 'em_atendimento')
        join public.ia_numero_liberado n
          on n.clinic_id = p_clinic_id
         and n.whatsapp_account_id = c.whatsapp_account_id
         and n.ativo
        join public.whatsapp_account w
          on w.id = n.whatsapp_account_id
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
       where k.clinic_id = p_clinic_id
         and k.ativo
       order by k.id, n.whatsapp_account_id, c.created_at desc, c.id
    ) a;
  -- [conversa aberta por numero] fim

  -- [onda 2: publico da ia] inicio
  -- Onda 2, item 4: os telefones ATIVOS da lista cujo contato nao cabe no
  -- publico da versao publicada. O filtro vale no teste tambem (P4b): a
  -- aba diz por que eles nao acionam o assistente.
  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb)
    into v_fora_do_publico
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and not public.ia_publico_aceita(p_clinic_id, k.phone_key);
  -- [onda 2: publico da ia] fim

  v_motor := public.ia_estado_do_motor();

  return jsonb_build_object(
    'teto_atingido', v_teto,
    'versao_publicada', v_versao,
    'telefones_invalidos', v_invalidos,
    'telefones_sem_autorizacao', v_sem_autorizacao,
    'telefones_com_conversa_aberta', v_abertas,
    -- [conversa aberta por numero] inicio
    'conversas_abertas', v_conversas,
    -- [conversa aberta por numero] fim
    -- [onda 2: publico da ia] inicio
    'telefones_fora_do_publico', v_fora_do_publico,
    -- [onda 2: publico da ia] fim
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$;

-- ===========================================================================
-- 4. Os eventos e as funcoes quentes
-- ===========================================================================

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

create or replace function public.ia_tirar_conversa(p_conversation_id uuid, p_motivo text, p_aguardando boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_corpo text := public.rotulo_do_motivo_da_ia(p_motivo);
  v_clinica uuid;
begin
  if v_corpo is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = coalesce(p_aguardando, c.awaiting_reply)
   where c.id = p_conversation_id
     and c.status = 'ia_atendendo'
  returning c.clinic_id into v_clinica;
  if v_clinica is null then
    return false;
  end if;

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'conversa_fora_da_ia'
   where j.id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.status = 'pendente'
        and q.payload ->> 'conversation_id' = p_conversation_id::text
        for update skip locked
   );

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, p_conversation_id, 'saida', 'sistema', 'evento', v_corpo,
    false, 0
  );
  -- [onda 2: horario da ia] inicio
  -- Onda 2, item 7: a passagem do executor por fora do horario (o job que
  -- venceu na virada do expediente) guarda a conversa para a retomada no
  -- horario do assistente, desde a janela que ela ja tinha (a mensagem que
  -- chegou na virada continua pendente na retomada). Sem numero ou com
  -- telefone fora do formato, nada e guardado (fica com a equipe).
  if p_motivo = 'fora_do_horario' then
    insert into public.ia_conversa_fora_do_horario as f (
      conversation_id, clinic_id, contact_id, phone_key,
      whatsapp_account_id, desde, origem, criada_em
    )
    select c.id, c.clinic_id, c.contact_id, k.phone_key, c.whatsapp_account_id,
           coalesce((select w.desde
                       from public.ia_janela_da_conversa w
                      where w.conversation_id = c.id), now()),
           'turno', now()
      from public.conversation c
      join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
     where c.id = p_conversation_id
       and c.whatsapp_account_id is not null
       and k.phone_key ~ '^\+[1-9][0-9]{7,14}$'
    on conflict (conversation_id) do update
       set clinic_id = excluded.clinic_id,
           contact_id = excluded.contact_id,
           phone_key = excluded.phone_key,
           whatsapp_account_id = excluded.whatsapp_account_id,
           desde = excluded.desde,
           origem = excluded.origem,
           criada_em = excluded.criada_em;
  end if;
  -- [onda 2: horario da ia] fim
  return true;
end;
$function$;

create or replace function public.ingest_inbound_message(p_clinic_id uuid, p_phone_e164 text, p_name text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_mimetype text DEFAULT NULL::text, p_whatsapp_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contact_id uuid;
  v_contact_created boolean := false;
  v_conversation_id uuid;
  v_conta_da_conversa uuid;
  v_message_id uuid;
  v_filename text;
  v_mimetype text;
  v_conta uuid;
  v_removido_em timestamptz;
  -- [resposta da ia] inicio
  v_candidata boolean := false;
  v_ia_nova boolean := false;
  v_ia_segue boolean := false;
  v_conversa_nova uuid;
  v_status_antes text;
  v_status text;
  -- [resposta da ia] fim
  -- [onda 2: horario da ia] inicio
  v_horario text;
  v_so_horario_nova boolean := false;
  v_so_horario_segue boolean := false;
  v_motivo_parada text;
  -- [onda 2: horario da ia] fim
begin
  -- NUMERO que recebeu. Nulo e o webhook de hoje, que nao conhece numero:
  -- vale o principal ativo (e nulo se a clinica nao tem numero, como antes).
  if p_whatsapp_account_id is null then
    select id into v_conta
      from whatsapp_account
     where clinic_id = p_clinic_id
       and principal
       and removido_em is null;
  else
    select id, removido_em into v_conta, v_removido_em
      from whatsapp_account
     where id = p_whatsapp_account_id
       and clinic_id = p_clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;
    if v_removido_em is not null then
      -- Corrida com a remocao (a URL do numero removido ja recebe 401):
      -- nada e gravado.
      return jsonb_build_object(
        'inserted', false,
        'ignorada', 'numero_removido',
        'contact_id', null,
        'contact_created', false,
        'conversation_id', null,
        'message_id', null,
        'whatsapp_account_id', v_conta,
        -- [resposta da ia] inicio
        'ia_atendendo', false
        -- [resposta da ia] fim
      );
    end if;
  end if;

  -- FILTRO DE NUMERO PROPRIO (achado 1 do desenho): o numero A da clinica
  -- escrevendo para o numero B nao e paciente. Sem o filtro, o B criava um
  -- contato com o telefone da propria clinica, e a mensagem ainda se perdia
  -- no unique global de wa_message_id (o envio do A ja gravou o mesmo id).
  -- display_phone guarda digitos (ou, em conta antiga, o nome do perfil: sem
  -- 10 a 15 digitos, nao entra na comparacao). A comparacao e pela chave
  -- canonica, que ignora o nono digito.
  if exists (
    select 1
      from whatsapp_account a
     where a.clinic_id = p_clinic_id
       and a.removido_em is null
       and a.display_phone is not null
       and length(regexp_replace(a.display_phone, '\D', '', 'g'))
           between 10 and 15
       and public.chave_telefone(
             '+' || regexp_replace(a.display_phone, '\D', '', 'g')
           ) = public.chave_telefone(p_phone_e164)
  ) then
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_proprio',
      'contact_id', null,
      'contact_created', false,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta,
      -- [resposta da ia] inicio
      'ia_atendendo', false
      -- [resposta da ia] fim
    );
  end if;

  -- [resposta da ia] inicio
  -- PRE-CHECAGEM DA IA (E3, 13/10/2026): so o telefone ATIVO na lista de
  -- telefones da equipe (ia_contato_liberado) entra no ramo novo. Sem ela,
  -- o caminho e o de antes, linha a linha. Com ela, trava a liberacao e o
  -- interruptor em FOR SHARE antes de tocar a conversa (a mesma ordem das
  -- definir_*) e decide duas coisas: se uma conversa NOVA nasce na IA (com o
  -- teto de 24 h) e se a conversa que JA esta na IA continua (sem o teto).
  v_candidata := exists (
    select 1 from public.ia_contato_liberado k
     where k.clinic_id = p_clinic_id
       and k.ativo
       and k.phone_key = public.chave_telefone(btrim(p_phone_e164))
  )
  -- [onda 2: preparo da producao] inicio
  -- Onda 2 (M2, preparo inerte da M3): tambem a clinica liberada no modo
  -- numero_inteiro (todos os contatos), pela chave primaria. Com o CHECK
  -- de hoje (simulador ou contatos) este ramo nunca casa.
  or exists (
    select 1 from public.ia_liberacao l
     where l.clinic_id = p_clinic_id
       and l.modo = 'numero_inteiro'
       and l.liberada
  )
  -- [onda 2: preparo da producao] fim
  ;
  if v_candidata then
    perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for share;
    perform 1 from public.ia_interruptor i where i.id for share;
    v_ia_nova := public.ia_atende_no_whatsapp(p_clinic_id, v_conta, p_phone_e164);
    v_ia_segue := public.ia_pode_falar_com(p_clinic_id, v_conta, p_phone_e164);
    -- [onda 2: horario da ia] inicio
    -- Onda 2, item 7: o banco decide o horario do assistente (a ultima
    -- versao publicada, no fuso da clinica; espelho de horarioDoBanco e
    -- agenteAtendeAgora). Fora do horario dele a conversa nova nao nasce
    -- na IA e a que estava na IA vai para a equipe aqui, sem esperar o
    -- executor. v_so_horario_*: a UNICA razao e o horario (a liberacao
    -- deixaria), para o evento certo e a espera do horario.
    v_horario := public.ia_horario_do_assistente(p_clinic_id);
    v_so_horario_nova := coalesce(v_ia_nova, false) and v_horario is distinct from 'atende';
    v_so_horario_segue := coalesce(v_ia_segue, false) and v_horario is distinct from 'atende';
    v_ia_nova := coalesce(v_ia_nova, false) and v_horario = 'atende';
    v_ia_segue := coalesce(v_ia_segue, false) and v_horario = 'atende';
    -- [onda 2: horario da ia] fim
  end if;
  -- [resposta da ia] fim

  -- CONTATO, achado pela CHAVE canonica e nao pelo texto exato: o WhatsApp
  -- entrega +558499990000 e a recepcao cadastrou +5584999990000; e a mesma
  -- pessoa.
  --
  -- ON CONFLICT DO NOTHING SEM alvo de proposito: contact tem DOIS indices
  -- unicos (phone_e164 e phone_key). Com alvo em um so, duas entregas
  -- simultaneas do primeiro contato podiam estourar 23505 no outro indice
  -- (o nao arbitro e conferido na hora e erra em vez de esperar). Sem alvo,
  -- todos os unicos arbitram e a corrida vira "ja existe".
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict do nothing
  returning id into v_contact_id;

  if v_contact_id is not null then
    v_contact_created := true;
  else
    -- Ja existia (inclusive gravado pela recepcao na OUTRA forma). O telefone
    -- passa a ser o que o WhatsApp entregou: e a forma que com certeza recebe
    -- mensagem, e o toque seguinte vai para ela.
    update contact
      set last_contact_at = now(),
          name = coalesce(contact.name, nullif(trim(p_name), '')),
          phone_e164 = p_phone_e164
      where clinic_id = p_clinic_id
        and phone_key = public.chave_telefone(p_phone_e164)
      returning id into v_contact_id;
  end if;

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

  -- Uma conversa aberta por contato E NUMERO (decisao 1 do dono). SEM alvo
  -- de proposito: hoje arbitra conversation_aberta_por_contato; na Fase 3,
  -- o indice por numero. Corrida vira "ja existe".
  insert into conversation (
    clinic_id, contact_id, status, last_message_at, whatsapp_account_id
  )
  values (
    p_clinic_id, v_contact_id, 'aguardando_humano', now(), v_conta
  )
  on conflict do nothing
  -- [resposta da ia] inicio
  returning id into v_conversa_nova;
  -- [resposta da ia] fim

  -- A conversa aberta DESTE numero, ou uma aberta sem numero (clinica que
  -- ganhou numero depois, ou legado), que este numero adota.
  -- [resposta da ia] o status de antes tambem (v_status_antes)
  select id, whatsapp_account_id, status
    into v_conversation_id, v_conta_da_conversa, v_status_antes
  from conversation
  where clinic_id = p_clinic_id and contact_id = v_contact_id
    and status <> 'resolvida'
    and (whatsapp_account_id = v_conta or whatsapp_account_id is null)
  order by (whatsapp_account_id is null)
  limit 1;

  if v_conta is not null
     and v_conversation_id is not null
     and v_conta_da_conversa is null
  then
    update conversation
       set whatsapp_account_id = v_conta
     where id = v_conversation_id
       and whatsapp_account_id is null;
  end if;

  -- Nome do arquivo: defesa em profundidade (o parser ja saneia). Sem barra
  -- nem caractere de controle, ate 200 caracteres; vazio vira nulo.
  v_filename := nullif(
    btrim(left(regexp_replace(coalesce(p_media_filename, ''),
                              '[[:cntrl:]/\\]', '', 'g'), 200)),
    ''
  );
  -- Tipo: so o formato tipo/subtipo, minusculo e sem parametros ("audio/ogg;
  -- codecs=opus" vira "audio/ogg"); qualquer outra coisa e nulo.
  v_mimetype := lower(btrim(split_part(coalesce(p_media_mimetype, ''), ';', 1)));
  if v_mimetype !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
     or length(v_mimetype) > 100 then
    v_mimetype := null;
  end if;

  -- O numero da mensagem vem da conversa (gatilho mensagem_herda_numero).
  insert into message (
    clinic_id, conversation_id, wa_message_id, direction, author,
    content_type, body, media_url, transcript, billable, cost_cents,
    media_filename, media_mimetype
  ) values (
    p_clinic_id, v_conversation_id, p_wa_message_id, 'entrada', 'paciente',
    coalesce(p_content_type, 'texto'), p_body, p_media_url, p_transcript,
    false, 0,
    v_filename, v_mimetype
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    update conversation
      set last_message_at = now(),
          -- A chave de ordenacao do Inbox. Escrita SO aqui, no recebimento:
          -- responder nao pode mover a conversa de lugar.
          last_inbound_at = now(),
          unread_count = unread_count + 1,
          awaiting_reply = true,
          -- [resposta da ia] inicio
          -- Nenhuma conversa fica num estado que ninguem atende: o paciente
          -- escreveu e a IA nao pode mais falar com ele, a conversa volta
          -- para a fila da recepcao (contador do menu e "Aguardando voce").
          -- So a conversa NOVA deste telefone liberado nasce na IA; nunca uma
          -- que ja existia (em_atendimento ou aguardando_humano).
          status = case
            when status = 'ia_atendendo' and coalesce(v_ia_segue, false) then 'ia_atendendo'
            when status = 'ia_atendendo' then 'aguardando_humano'
            when id = v_conversa_nova and status = 'aguardando_humano'
                 and coalesce(v_ia_nova, false) then 'ia_atendendo'
            else status
          end
          -- [resposta da ia] fim
      where id = v_conversation_id
      -- [resposta da ia] inicio
      returning status into v_status;
      -- [resposta da ia] fim

    -- [resposta da ia] inicio
    if v_candidata then
      if v_status = 'ia_atendendo' and v_conversation_id = v_conversa_nova then
        -- A janela da conversa: a IA so le o que chegou a partir daqui.
        insert into public.ia_janela_da_conversa (
          conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por, updated_at
        ) values (
          v_conversation_id, p_clinic_id, v_contact_id,
          public.chave_telefone(btrim(p_phone_e164)), now(), 'ingestao', now()
        )
        on conflict (conversation_id) do update
          set clinic_id = excluded.clinic_id,
              contact_id = excluded.contact_id,
              phone_key = excluded.phone_key,
              desde = excluded.desde,
              aberta_por = excluded.aberta_por,
              updated_at = excluded.updated_at;
      elsif v_status is distinct from 'ia_atendendo'
            and ((v_status_antes = 'ia_atendendo' and not coalesce(v_ia_segue, false))
                 or (v_conversation_id = v_conversa_nova and not coalesce(v_ia_nova, false))) then
        -- O telefone e da equipe, mas o assistente esta parado para ele: a
        -- equipe ve o porque no fio. So quando o motivo e a IA parada; a
        -- conversa que saiu da IA por outra transacao no meio (Assumir,
        -- passagem do executor) nao ganha evento.
        -- [onda 2: horario da ia] inicio
        -- Quando a UNICA razao e o horario: a conversa nova fica com a
        -- equipe com no_expediente (ou horario_nao_suportado no modo "Se a
        -- equipe nao responder"); a que estava na IA vai para a equipe com
        -- fora_do_horario (ou horario_nao_suportado). No expediente, ela
        -- espera o horario do assistente em ia_conversa_fora_do_horario: a
        -- nova desde agora (origem ingestao; a mensagem desta transacao
        -- entra), a que estava na IA desde a janela que ja tinha (origem
        -- turno). Outra razao: parada, como antes. Telefone fora do
        -- formato ou sem numero: nada e guardado (fica com a equipe).
        v_motivo_parada := 'parada';
        if v_status_antes = 'ia_atendendo' and v_so_horario_segue then
          v_motivo_parada := case v_horario
            when 'no_expediente' then 'fora_do_horario'
            when 'modo_nao_suportado' then 'horario_nao_suportado'
            else 'parada'
          end;
        elsif v_conversation_id = v_conversa_nova and v_so_horario_nova then
          v_motivo_parada := case v_horario
            when 'no_expediente' then 'no_expediente'
            when 'modo_nao_suportado' then 'horario_nao_suportado'
            else 'parada'
          end;
        end if;
        if v_horario = 'no_expediente'
           and v_motivo_parada in ('no_expediente', 'fora_do_horario')
           and v_conta is not null
        then
          insert into public.ia_conversa_fora_do_horario as f (
            conversation_id, clinic_id, contact_id, phone_key,
            whatsapp_account_id, desde, origem, criada_em
          )
          select v_conversation_id, p_clinic_id, k.id, k.phone_key, v_conta,
                 case when v_motivo_parada = 'fora_do_horario'
                      then coalesce((select w.desde
                                       from public.ia_janela_da_conversa w
                                      where w.conversation_id = v_conversation_id), now())
                      else now()
                 end,
                 case when v_motivo_parada = 'fora_do_horario' then 'turno' else 'ingestao' end,
                 now()
            from public.contact k
           where k.id = v_contact_id
             and k.clinic_id = p_clinic_id
             and k.phone_key ~ '^\+[1-9][0-9]{7,14}$'
          on conflict (conversation_id) do update
             set clinic_id = excluded.clinic_id,
                 contact_id = excluded.contact_id,
                 phone_key = excluded.phone_key,
                 whatsapp_account_id = excluded.whatsapp_account_id,
                 desde = excluded.desde,
                 origem = excluded.origem,
                 criada_em = excluded.criada_em;
        end if;
        -- [onda 2: horario da ia] fim
        insert into public.message (
          clinic_id, conversation_id, direction, author, content_type, body,
          billable, cost_cents
        ) values (
          p_clinic_id, v_conversation_id, 'saida', 'sistema', 'evento',
          -- [onda 2: horario da ia] o motivo: parada, no_expediente, fora_do_horario
          -- ou horario_nao_suportado (acima)
          public.rotulo_do_motivo_da_ia(v_motivo_parada), false, 0
        );
      end if;
    end if;
    -- [resposta da ia] fim
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'contact_created', v_contact_created,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'whatsapp_account_id', v_conta,
    -- [resposta da ia] inicio
    'ia_atendendo', coalesce(v_message_id is not null and v_status = 'ia_atendendo', false)
    -- [resposta da ia] fim
  );
end;
$function$;

create function public.ia_retomar_conversas_no_horario(
  p_limite integer default 50,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha record;
  v_status text;
  v_responsavel uuid;
  v_clinica uuid;
  v_contato uuid;
  v_numero uuid;
  v_aguardando boolean;
  v_chave text;
  v_desde timestamptz;
  v_ultima uuid;
  v_fila jsonb;
  v_vencidas integer := 0;
  v_retomadas integer := 0;
  v_descartadas integer := 0;
  v_enfileiradas integer := 0;
  v_erros integer := 0;
begin
  -- 0. A linha de mais de 24 horas sai, de QUALQUER clinica (revisao da
  --    onda 2): a da clinica que saiu da fase controlada (desligada ou
  --    suspensa) e a da conversa apagada (sem FK) nunca passariam pelo
  --    laco abaixo e guardariam o telefone e o contato do paciente para
  --    sempre (minimizacao, LGPD). A regra das 24 horas ja as
  --    descartaria. Sem esperar ninguem: a travada sai na proxima
  --    passagem. Conta como descartada.
  delete from public.ia_conversa_fora_do_horario f
   where f.conversation_id in (
     select v.conversation_id
       from public.ia_conversa_fora_do_horario v
      where v.criada_em < now() - interval '24 hours'
        for update skip locked
   );
  get diagnostics v_vencidas = row_count;
  v_descartadas := v_vencidas;

  -- So as linhas que andam agora: o assistente ja esta no horario dele, ou
  -- a linha passou de 24 horas (sai). As que ainda esperam nem sao
  -- travadas: nao ocupam o limite da passagem (uma clinica com o
  -- expediente aberto nao segura a retomada de outra).
  for v_linha in
    select f.conversation_id, f.clinic_id, f.contact_id, f.phone_key,
           f.whatsapp_account_id, f.desde, f.origem, f.criada_em
      from public.ia_conversa_fora_do_horario f
      join public.clinic c on c.id = f.clinic_id
     where ((c.id = any (public.ia_clinicas_da_fase_controlada()) and not c.e_de_teste)
            or (coalesce(p_incluir_teste, false) and c.e_de_teste))
       and (f.criada_em < now() - interval '24 hours'
            or public.ia_horario_do_assistente(f.clinic_id) = 'atende')
     order by f.criada_em, f.conversation_id
     limit greatest(least(coalesce(p_limite, 50), 500), 0)
       for update of f skip locked
  loop
    begin
      -- A ordem de travas do E3: liberacao e interruptor antes da conversa,
      -- SEM esperar (revisao da onda 2): a motor_manutencao chama esta
      -- funcao depois do bloco [resposta da ia], que ja travou e mudou
      -- conversas na mesma transacao; esperar aqui por uma definir_* (que
      -- trava a liberacao e depois as conversas, no ia_desligar) ou por
      -- quem trava o interruptor fecharia um deadlock (40P01). Trava
      -- ocupada: a linha fica para a proxima passagem. Linha ausente:
      -- segue (ia_atende_no_whatsapp, abaixo, diz nao).
      perform 1 from public.ia_liberacao l
       where l.clinic_id = v_linha.clinic_id
         for share skip locked;
      if not found and exists (
        select 1 from public.ia_liberacao l where l.clinic_id = v_linha.clinic_id
      ) then
        continue;
      end if;
      perform 1 from public.ia_interruptor i where i.id for share skip locked;
      if not found and exists (select 1 from public.ia_interruptor i where i.id) then
        continue;
      end if;
      select c.status, c.assignee_user_id, c.clinic_id, c.contact_id,
             c.whatsapp_account_id, c.awaiting_reply
        into v_status, v_responsavel, v_clinica, v_contato, v_numero, v_aguardando
        from public.conversation c
       where c.id = v_linha.conversation_id
         for no key update skip locked;
      if not found then
        if not exists (
          select 1 from public.conversation c where c.id = v_linha.conversation_id
        ) then
          -- 1. A conversa sumiu.
          delete from public.ia_conversa_fora_do_horario f
           where f.conversation_id = v_linha.conversation_id;
          v_descartadas := v_descartadas + 1;
        end if;
        -- Travada por outra transacao (a ingestao, alguem assumindo): a
        -- linha fica para a proxima passagem.
        continue;
      end if;
      select k.phone_key into v_chave
        from public.contact k
       where k.id = v_contato
         and k.clinic_id = v_clinica;

      -- O corte da leitura (revisao da onda 2). A conversa nova (origem
      -- ingestao) e a que estava na IA com a janela da ingestao (que le a
      -- conversa inteira, lib/agente/historico.ts) leem desde a PRIMEIRA
      -- mensagem da conversa: o desde e o now() do inicio da transacao
      -- que criou a conversa, e a mensagem de uma rajada cuja transacao
      -- comecou um pouco antes fica com created_at < desde. Sem isto a IA
      -- nao a leria nem a responderia (ia_marcar_respondida corta pelo
      -- desde fora da janela da ingestao). As outras (devolver, horario),
      -- desde a espera. O mesmo corte vale no passo 1, na janela e na
      -- ultima mensagem do paciente.
      v_desde := v_linha.desde;
      if v_linha.origem = 'ingestao'
         or exists (
           select 1 from public.ia_janela_da_conversa w
            where w.conversation_id = v_linha.conversation_id
              and w.aberta_por = 'ingestao'
         )
      then
        select least(v_linha.desde, min(m.created_at)) into v_desde
          from public.message m
         where m.conversation_id = v_linha.conversation_id;
      end if;

      -- 1. Descarta sem tocar a conversa: nao esta mais esperando a equipe
      --    (resolvida, em atendimento, na IA), tem responsavel, mudou de
      --    contato, telefone ou numero, alguem da equipe escreveu desde a
      --    espera (o lado seguro: a equipe olhou, a IA nao volta sozinha),
      --    ou a linha passou de 24 horas.
      if v_status is distinct from 'aguardando_humano'
         or v_responsavel is not null
         or v_clinica is distinct from v_linha.clinic_id
         or v_contato is distinct from v_linha.contact_id
         or v_chave is distinct from v_linha.phone_key
         or v_numero is distinct from v_linha.whatsapp_account_id
         or v_linha.criada_em < now() - interval '24 hours'
         or exists (
           select 1
             from public.message m
            where m.conversation_id = v_linha.conversation_id
              and m.author = 'usuario'
              and m.created_at >= v_desde
         )
      then
        delete from public.ia_conversa_fora_do_horario f
         where f.conversation_id = v_linha.conversation_id;
        v_descartadas := v_descartadas + 1;
        continue;
      end if;

      -- 2. Ainda nao e o horario do assistente: a linha fica.
      if public.ia_horario_do_assistente(v_linha.clinic_id) is distinct from 'atende' then
        continue;
      end if;

      -- 4. O assistente nao pode atender este telefone neste numero
      --    (liberacao, teto, publico, trava K, versao; a regra de conversa
      --    nova): a linha sai, a conversa fica com a equipe.
      if not public.ia_atende_no_whatsapp(v_linha.clinic_id, v_numero, v_chave) then
        delete from public.ia_conversa_fora_do_horario f
         where f.conversation_id = v_linha.conversation_id;
        v_descartadas := v_descartadas + 1;
        continue;
      end if;

      -- 3. A conversa volta para a IA. A janela le desde o corte acima (a
      --    nova: desde a primeira mensagem dela; a que estava na IA: desde
      --    a janela que ja tinha, ou a conversa inteira se a janela era a
      --    da ingestao); pelo passo 1, nenhuma mensagem da equipe existe
      --    nesse trecho. updated_at = agora: a espera de 3 minutos da
      --    manutencao conta daqui.
      update public.conversation c
         set status = 'ia_atendendo',
             assignee_user_id = null
       where c.id = v_linha.conversation_id;

      insert into public.ia_janela_da_conversa (
        conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por, updated_at
      ) values (
        v_linha.conversation_id, v_linha.clinic_id, v_contato, v_chave,
        v_desde, 'horario', now()
      )
      on conflict (conversation_id) do update
        set clinic_id = excluded.clinic_id,
            contact_id = excluded.contact_id,
            phone_key = excluded.phone_key,
            desde = excluded.desde,
            aberta_por = excluded.aberta_por,
            updated_at = excluded.updated_at;

      insert into public.message (
        clinic_id, conversation_id, direction, author, content_type, body,
        billable, cost_cents
      ) values (
        v_linha.clinic_id, v_linha.conversation_id, 'saida', 'sistema', 'evento',
        public.rotulo_do_motivo_da_ia('retomou_no_horario'), false, 0
      );

      delete from public.ia_conversa_fora_do_horario f
       where f.conversation_id = v_linha.conversation_id;
      v_retomadas := v_retomadas + 1;

      -- A ultima mensagem do paciente desde a espera vai para a fila; o
      -- enfileirar confere tudo de novo (fase, conversa na IA sem
      -- responsavel, a mensagem, a janela e ia_pode_falar_com).
      if v_aguardando then
        select m.id into v_ultima
          from public.message m
         where m.conversation_id = v_linha.conversation_id
           and m.direction = 'entrada'
           and m.author = 'paciente'
           and m.deleted_at is null
           and m.created_at >= v_desde
         order by m.created_at desc, m.id desc
         limit 1;
        if v_ultima is not null then
          v_fila := public.enfileirar_resposta_da_ia(
            v_linha.clinic_id, v_linha.conversation_id, v_ultima,
            coalesce(p_incluir_teste, false));
          if v_fila ->> 'codigo' in ('enfileirado', 'juntou') then
            v_enfileiradas := v_enfileiradas + 1;
          end if;
        end if;
      end if;
    exception when others then
      -- Nunca lanca por linha. A linha com erro sai (o lado seguro: a
      -- conversa fica com a equipe) para nao voltar a cada passagem.
      v_erros := v_erros + 1;
      begin
        delete from public.ia_conversa_fora_do_horario f
         where f.conversation_id = v_linha.conversation_id;
      exception when others then
        null;
      end;
    end;
  end loop;

  return jsonb_build_object(
    'retomadas', v_retomadas,
    'descartadas', v_descartadas,
    'enfileiradas', v_enfileiradas,
    'erros_por_linha', v_erros
  );
end;
$$;

revoke all on function public.ia_retomar_conversas_no_horario(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.ia_retomar_conversas_no_horario(integer, boolean)
  to service_role;

comment on function public.ia_retomar_conversas_no_horario(integer, boolean) is
  'Onda 2, item 7 (P7a): as conversas que ficaram com a equipe so por causa do horario (ia_conversa_fora_do_horario) voltam para a IA quando o horario do assistente comeca, se ninguem da equipe tocou nelas (sem resposta, sem responsavel, aguardando, mesmo contato, telefone e numero, ate 24 horas) e ia_atende_no_whatsapp deixa; a ultima mensagem do paciente vai para a fila. A conversa nova e a que tinha a janela da ingestao leem desde a primeira mensagem da conversa (a rajada); as outras, desde a espera. Ate p_limite linhas (no maximo 500) por chamada, FOR UPDATE SKIP LOCKED, e a liberacao e o interruptor sem esperar (trava ocupada: a linha fica para a proxima passagem). Antes, a linha de mais de 24 horas sai, de qualquer clinica. e_de_teste so com p_incluir_teste (as suites). Nunca lanca por linha. Devolve {retomadas, descartadas, enfileiradas, erros_por_linha}. So service_role (a motor_manutencao chama a cada minuto).';

create or replace function public.motor_manutencao()
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

-- ===========================================================================
-- 5. Excluir telefone da equipe
-- ===========================================================================

create function public.excluir_contato_liberado_da_ia(
  p_clinic_id uuid,
  p_contato_liberado_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Administrador ativo da propria clinica habilitada (ou e_de_teste, nas
  -- suites), super admin ou o servidor; o resto, 42501.
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or p_contato_liberado_id is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e o telefone.';
  end if;

  -- A ordem de travas das definir_*: a linha da clinica primeiro.
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  delete from public.ia_contato_liberado k
   where k.id = p_contato_liberado_id
     and k.clinic_id = p_clinic_id
  returning k.id into v_id;
  if v_id is null then
    return false;
  end if;

  -- A conversa desse telefone na IA volta para a equipe (evento desligada).
  perform public.ia_desligar(array[p_clinic_id]);

  -- O id, nunca o telefone.
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'excluiu_telefone_da_ia', 'ia_contato_liberado', v_id);

  return true;
end;
$$;

revoke all on function public.excluir_contato_liberado_da_ia(uuid, uuid)
  from public, anon;
grant execute on function public.excluir_contato_liberado_da_ia(uuid, uuid)
  to authenticated, service_role;

comment on function public.excluir_contato_liberado_da_ia(uuid, uuid) is
  'Exclui um telefone da equipe da lista do assistente (onda 2, item 9). Quem chama: administrador ativo da propria clinica habilitada (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera; o resto 42501). 22004 em nulo. Trava a liberacao da clinica, apaga a linha (sem linha: false, sem trilha), devolve a conversa desse telefone para a equipe (ia_desligar) e grava excluiu_telefone_da_ia (o id, nunca o telefone). Excluir telefone forcado apaga o forcar.';

-- ===========================================================================
-- 6. Telefone de paciente como teste: a assinatura nova
-- ===========================================================================

drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean);

create function public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean, p_forcar_contato_existente boolean DEFAULT false, p_confirmou_aviso_da_openai boolean DEFAULT false, p_confirmou_teste_com_paciente boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_telefone text := btrim(p_telefone_e164);
  v_chave text;
  v_rotulo text := nullif(btrim(p_rotulo), '');
  v_id uuid;
  -- [whatsapp so pela equipe] inicio
  v_forcou boolean := false;
  -- [whatsapp so pela equipe] fim
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  -- [telefone pelo administrador] inicio
  -- Ligar telefone (adicionar ou "Ligar de novo") basta o guarda acima:
  -- administrador ativo da propria clinica da lista fechada (ou e_de_teste,
  -- nas suites), super admin ou o servidor. Decisao do dono de 19/10/2026;
  -- [onda 2: teste com paciente] inicio
  -- de 13/10 ate ela, ligar exigia a equipe Conduzza. Desligar, como
  -- sempre, so com o guarda acima. SAIU daqui (onda 2, item 3, P3 (a)):
  -- o FORCAR era so da equipe Conduzza. O trecho de antes, comentado:
  --   de 13/10 ate ela, ligar exigia a equipe Conduzza. O FORCAR continua so
  --   da equipe Conduzza: conferido aqui, antes de qualquer leitura, mesmo
  --   quando o telefone nao tem sinal de paciente. Desligar, como sempre, so
  --   com o guarda acima.
  --   if p_ativo and coalesce(p_forcar_contato_existente, false) then
  --     perform public.ia_exigir_equipe_conduzza();
  --   end if;
  -- No lugar, o forcar exige a confirmacao do teste (logo abaixo).
  -- [onda 2: teste com paciente] fim
  -- [telefone pelo administrador] fim
  -- [onda 2: teste com paciente] inicio
  -- Onda 2, item 3 (P3 (a), decisao do dono de 21/10/2026): o FORCAR deixa
  -- de ser so da equipe Conduzza. Basta o guarda acima MAIS a confirmacao,
  -- no nome de quem forca, de que a pessoa deste telefone sabe que vai
  -- conversar com um assistente virtual de teste e que o que escrever vai
  -- para a OpenAI, nos EUA (p_confirmou_teste_com_paciente). Conferida
  -- aqui, antes de qualquer leitura, com ou sem sinal de paciente (o erro
  -- nao revela se o telefone e de paciente). Sem ela, 23514
  -- teste_com_paciente_nao_confirmado e nada muda.
  if p_ativo and coalesce(p_forcar_contato_existente, false)
     and not coalesce(p_confirmou_teste_com_paciente, false) then
    raise exception using errcode = '23514', message = 'teste_com_paciente_nao_confirmado';
  end if;
  -- [onda 2: teste com paciente] fim
  if p_clinic_id is null or v_telefone is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o telefone e se ele fica liberado.';
  end if;
  if v_telefone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023',
      message = 'Telefone inválido: use o formato internacional, por exemplo +5585999990000.';
  end if;
  if char_length(v_rotulo) > 80 then
    raise exception using errcode = '22023',
      message = 'O rótulo tem no máximo 80 caracteres.';
  end if;
  v_chave := public.chave_telefone(v_telefone);

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- [whatsapp so pela equipe] inicio
  -- So ao LIGAR: numero de WhatsApp de qualquer clinica do Conduzza nunca;
  -- telefone com sinal de paciente so com o forcar ([onda 2: teste com paciente]:
  -- com a confirmacao conferida acima), com trilha propria. Desligar
  -- nunca e recusado. Nenhuma mensagem leva o telefone.
  if p_ativo then
    if public.telefone_e_numero_da_plataforma(v_telefone) then
      raise exception using errcode = '23514', message = 'telefone_invalido_para_equipe';
    end if;
    if public.contato_tem_sinal_de_paciente(p_clinic_id, v_chave) then
      if not coalesce(p_forcar_contato_existente, false) then
        raise exception using errcode = '23514', message = 'contato_de_paciente';
      end if;
      v_forcou := true;
    end if;
  end if;
  -- [whatsapp so pela equipe] fim

  -- [whatsapp so pela equipe] inicio
  -- forcado (D-B da revisao): verdadeiro so ao ligar com o forcar e o sinal
  -- de paciente; falso ao ligar sem sinal e ao desligar. O gatilho
  -- ia_contato_liberado_forcado_so_pela_funcao so aceita forcado com esta
  -- flag local, desligada logo depois da gravacao.
  if v_forcou then
    perform set_config('conduzza.forcar_telefone_da_ia', 'sim', true);
  end if;
  -- [whatsapp so pela equipe] fim
  update public.ia_contato_liberado k
     set ativo = p_ativo,
         rotulo = coalesce(v_rotulo, k.rotulo),
         -- [whatsapp so pela equipe] inicio
         forcado = v_forcou,
         -- [whatsapp so pela equipe] fim
         alterado_por = auth.uid()
   where k.clinic_id = p_clinic_id
     and k.phone_key = v_chave
  returning k.id into v_id;
  if not found then
    -- [aviso da openai no banco] inicio
    -- Telefone que NAO esta na lista. Desligar nao cria linha nem trilha
    -- (nada foi gravado; o desligar chega aqui sem o forcar), mas a
    -- varredura de sempre roda: conversa na IA que nao pode mais ficar nela
    -- volta para a equipe. Ligar cria a linha so com a confirmacao do aviso
    -- da OpenAI (LGPD, D32), chamada por nome; sem ela, 23514 e nada muda. A
    -- mensagem nunca leva o telefone.
    if not p_ativo then
      perform public.ia_desligar(array[p_clinic_id]);
      return false;
    end if;
    if not coalesce(p_confirmou_aviso_da_openai, false) then
      raise exception using errcode = '23514', message = 'aviso_da_openai_nao_confirmado';
    end if;
    -- [aviso da openai no banco] fim
    insert into public.ia_contato_liberado (clinic_id, phone_key, rotulo, ativo, alterado_por,
                                            -- [whatsapp so pela equipe] inicio
                                            forcado
                                            -- [whatsapp so pela equipe] fim
                                            )
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid(),
            -- [whatsapp so pela equipe] inicio
            v_forcou
            -- [whatsapp so pela equipe] fim
            )
    returning id into v_id;
  end if;
  -- [whatsapp so pela equipe] inicio
  perform set_config('conduzza.forcar_telefone_da_ia', '', true);
  -- [whatsapp so pela equipe] fim

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_contato_liberado', v_id);

  -- [aviso da openai no banco] inicio
  -- A confirmacao do aviso da OpenAI na trilha, na mesma transacao, no nome
  -- de quem liga (nulo pelo servidor): toda vez que liga com ela (o
  -- formulario de adicionar sempre manda; o "Ligar de novo" nao).
  if p_ativo and coalesce(p_confirmou_aviso_da_openai, false) then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'confirmou_aviso_da_openai', 'ia_contato_liberado', v_id);
  end if;
  -- [aviso da openai no banco] fim

  -- [whatsapp so pela equipe] inicio
  if v_forcou then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'forcou_telefone_de_paciente_na_ia', 'ia_contato_liberado', v_id);
    -- [onda 2: teste com paciente] inicio
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'confirmou_teste_com_paciente', 'ia_contato_liberado', v_id);
    -- [onda 2: teste com paciente] fim
  end if;
  -- [whatsapp so pela equipe] fim

  return p_ativo;
end;
$function$;

revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean) to authenticated, service_role;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean) is
  'Liga ou desliga um telefone da equipe para a IA (T5). Quem chama: administrador ativo da propria clinica da lista (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera); o forcar (telefone de paciente que aceitou testar, onda 2, P3), o mesmo guarda com p_confirmou_teste_com_paciente (sem ela, 23514 teste_com_paciente_nao_confirmado, antes de qualquer leitura). Ao ligar recusa numero de WhatsApp do Conduzza e contato com sinal de paciente sem o forcar (23514). Telefone fora da lista: ligar exige p_confirmou_aviso_da_openai (23514 aviso_da_openai_nao_confirmado), desligar nao cria linha. Grava audit_log: editou, confirmou_aviso_da_openai (ligar com a confirmacao), forcou_telefone_de_paciente_na_ia e confirmou_teste_com_paciente (no nome de quem forca). Sempre por nome de parametro.';
