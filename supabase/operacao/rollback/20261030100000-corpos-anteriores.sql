-- Rollback manual da migration 20261030100000_midia_pela_ia.sql (midia na
-- conversa com a IA: audio pelo Whisper, imagem e documento, AG6b, parte de
-- banco; 30/10/2026).
--
-- Corpos de ANTES da migration: o modelo local (a producao de 30/10/2026,
-- ja com a AG4, lida com q.js e fndef.js, so leitura, mais a AG5 e a AG6a,
-- que vao antes desta e ainda nao foram aplicadas), com o md5(prosrc) (o
-- ensaio confere que o banco ainda esta assim antes de trocar, e o fim deste
-- arquivo confere que voltaram):
--   arquivar_e_limpar_mensagem(uuid,text,text,uuid)                       9a949b8acd0d38c72adc498efbddb4bd (o de producao; sem comentario)
--   definir_contato_liberado_da_ia(uuid,text,text,boolean,boolean,boolean,boolean)  88c5fa98f271c16cf783acffba347179 (o de producao; comentario 84b35e68ff4e8c5666de0f38501148b0)
--   atribuir_conversa_passada_pela_ia(uuid,text)                          dbef687c38a1966cb30a16accdbb1b89 (o da AG6a final; comentario bb548d23cdf37f5842216d9da0e27e0e)
--   rotulo_do_motivo_da_ia(text)                                          20f2194170f8aa6ed0cceec21a0dca20 (o da AG6a; sem comentario)
--   podar_agendamento_da_ia()                                             9fcaf98cd23c11867d6f14af22ef407a (o da AG6a; comentario adc20b1ebfaf01255c8d5ac0ef5a9e00)
-- SE A AG6a OU A AG5 MUDAREM antes de aplicar (revisao), estes corpos e os
-- md5 mudam junto: refazer este arquivo com o corpo vigente
-- (~/.claude/plans/agente-completo/ag6/banco-b/dev/montar/montar_rollback.py).
--
-- O QUE A MIGRATION FEZ: o CHECK ai_decision_log_escalation_reason_valida com
-- os tres motivos da midia (e o comentario); o rotulo deles; o CHECK
-- ia_uso_papel_valido com transcricao e leitor_de_midia (e um comentario) e
-- o comentario da tabela ia_uso; a coluna llm_preco.audio_microdolar_por_minuto
-- (com o CHECK e o comentario), a linha whisper-1 e o comentario da tabela
-- llm_preco; a coluna ia_contato_liberado.aviso_da_openai_versao (com o CHECK
-- e o comentario); definir_contato_liberado_da_ia com 8 parametros (DROP e
-- CREATE); as funcoes novas midia_da_ia_liberada, ia_lista_sem_repetido,
-- ia_leitura_da_midia_nao_muda e gravar_leitura_da_midia; a tabela
-- ia_leitura_da_midia (os indices, o gatilho, a RLS, a policy, os grants);
-- arquivar_e_limpar_mensagem com o apagamento da leitura (e um comentario);
-- a atribuicao com os motivos e a recusa da midia; a poda com a leitura.
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); confere que nenhum uso do
-- whisper-1 e recente (o codigo de antes ja no ar; senao falha, nada
-- desfeito); avisa (NOTICE, so contagens) o que sai e o que fica; tira as
-- RPCs novas; devolve os corpos de antes do apagamento, da atribuicao, do
-- rotulo e da poda (com os comentarios de antes; os grants nao mudaram:
-- CREATE OR REPLACE mantem) ANTES de apagar a tabela que eles leem; apaga a
-- tabela e as duas funcoes dela; devolve definir_contato_liberado_da_ia com
-- os 7 parametros, o corpo, os grants e o comentario de antes; tira as duas
-- colunas e a linha whisper-1; devolve os comentarios das tabelas e os
-- CHECKs de antes (NOT VALID e, sem linha com valor novo, VALIDATE: com
-- linha com valor novo, o CHECK de antes fica NOT VALID e a linha fica);
-- confere no fim os cinco md5, os comentarios, os grants, os CHECKs e que
-- nada novo ficou (com qualquer diferenca, falha e desfaz tudo). Sem IF
-- EXISTS: com qualquer objeto faltando ou diferente, falha e desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG6b chama gravar_leitura_da_midia e
-- midia_da_ia_liberada, le ia_leitura_da_midia e as duas colunas, grava os
-- papeis e os motivos novos e manda p_versao_do_aviso), DEPOIS este arquivo.
-- O codigo de antes da AG6b (o main com a AG6a) funciona antes e depois
-- deste arquivo.
--
-- O QUE SE PERDE: as transcricoes e as leituras (ia_leitura_da_midia) e a
-- versao do aviso dos telefones (todos voltam ao aviso de hoje). FICAM: as
-- decisoes com os motivos da midia, os eventos no fio, o gasto em ia_uso
-- (com os papeis novos) e a trilha (audit_log, com detalhes).
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_decision_log e ia_uso (os CHECKs),
-- llm_preco e ia_contato_liberado (as colunas), ia_leitura_da_midia (o
-- DROP), clinic e conversation (as FKs da tabela que sai), medido no
-- Postgres local: tirar FK pega ACCESS EXCLUSIVE na tabela referenciada (a
-- migration so pegava SHARE ROW EXCLUSIVE nelas); e ACCESS SHARE em message
-- (a policy que sai le message). Todas no comeco, numa ordem fixa, com
-- NOWAIT: com uma ocupada, solta as que pegou (o savepoint do bloco), espera
-- 100 ms sem trava nenhuma e tenta de novo, ate 10 vezes (uns 1 s, menos que
-- os 3 s da migration, de proposito); depois falha inteiro com 55P03, nada
-- desfeito: rodar de novo. Nunca espera trava com outra na mao (nao fecha
-- ciclo, 40P01, com sessao nenhuma). Ate o commit (milissegundos), NINGUEM
-- le conversation nem clinic (o Atendimento, quase toda tela, a ingestao e o
-- motor esperam), nem as decisoes e o gasto da IA. Horario calmo.
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
      lock table public.ai_decision_log, public.ia_uso, public.llm_preco, public.ia_contato_liberado,
                 public.ia_leitura_da_midia, public.clinic, public.conversation
        in access exclusive mode nowait;
      lock table public.message in access share mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261030100000: uma das tabelas seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- 1. O codigo de antes ja no ar: nenhum uso do whisper-1 nos ultimos 15
--    minutos (um turno do codigo da AG6b ainda podia estar usando o preco).
do $codigo$
begin
  if exists (select 1 from public.ia_uso u
              where u.modelo = 'whisper-1'
                and u.created_at > now() - interval '15 minutes') then
    raise exception using errcode = 'object_in_use',
      message = 'Rollback de 20261030100000: houve uso do whisper-1 nos ultimos 15 minutos. Volte o codigo da AG6b primeiro e rode de novo depois. Nada foi desfeito.';
  end if;
end;
$codigo$;

-- 2. O que sai e o que fica (so contagens, nenhum dado de paciente).
do $aviso$
declare
  v_leituras bigint;
  v_transcricoes bigint;
  v_telefones bigint;
  v_decisoes bigint;
  v_usos bigint;
begin
  select count(*), count(*) filter (where l.tipo = 'transcricao')
    into v_leituras, v_transcricoes
    from public.ia_leitura_da_midia l;
  select count(*) into v_telefones
    from public.ia_contato_liberado k
   where k.aviso_da_openai_versao <> 1;
  select count(*) into v_decisoes
    from public.ai_decision_log d
   where d.escalation_reason in ('midia_clinica', 'documento_do_paciente', 'midia_nao_identificada');
  select count(*) into v_usos
    from public.ia_uso u
   where u.papel in ('transcricao', 'leitor_de_midia');
  raise notice 'Rollback de 20261030100000: saem % leitura(s) da midia (% transcricao(oes)) e a versao do aviso de % telefone(s); ficam % decisao(oes) com os motivos da midia e % linha(s) de gasto com os papeis da midia (com elas, o CHECK de antes volta NOT VALID).',
    v_leituras, v_transcricoes, v_telefones, v_decisoes, v_usos;
end;
$aviso$;

-- 3. As RPCs novas.
drop function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text);
drop function public.midia_da_ia_liberada(uuid, text);

-- 4. O apagamento: o corpo de antes (o de producao); sem comentario, como
--    antes. Os grants nao mudaram.
CREATE OR REPLACE FUNCTION public.arquivar_e_limpar_mensagem(p_message_id uuid, p_escopo text, p_origem text, p_por uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.message_apagada (
    message_id, clinic_id, conversation_id, content_type, body, media_url,
    transcript, wa_message_id, escopo, origem, apagada_por
  )
  select id, clinic_id, conversation_id, content_type, body, media_url,
         transcript, wa_message_id, p_escopo, p_origem, p_por
    from public.message
   where id = p_message_id
  on conflict (message_id) do nothing;

  update public.message
     set body = null,
         media_url = null,
         transcript = null,
         deleted_at = now(),
         deleted_by = p_por,
         deleted_source = p_origem,
         deleted_escopo = p_escopo
   where id = p_message_id;
end;
$function$
;

comment on function public.arquivar_e_limpar_mensagem(uuid, text, text, uuid) is null;

-- 5. A atribuicao: o corpo de antes (o da AG6a final), com o comentario de
--    antes. Os grants nao mudaram.
CREATE OR REPLACE FUNCTION public.atribuir_conversa_passada_pela_ia(p_job_id uuid, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- A decisao que passou a conversa para a equipe (as saidas com a frase):
  -- escalou (o motivo), bloqueou (conformidade, que pela revisao 2 nunca
  -- atribui) ou falhou (falha_tecnica), sempre com o motivo da passagem em
  -- escalation_reason. A resposta e a falha sem passagem
  -- (liberacao_suspensa, sem_mensagem) nao atribuem.
  c_desfechos_que_passam constant text[] := array['escalou', 'bloqueou', 'falhou'];
  -- Estes motivos nunca atribuem: D-54 (urgente vai sempre para a fila); a
  -- retomada no horario (so pega conversa sem responsavel); e, pela revisao
  -- 2 (a mesma razao da D-54: o responsavel pode estar fora), os clinicos e
  -- o conteudo que ninguem leu, onde cai a emergencia que a lista
  -- deterministica nao pega (sintoma, assunto clinico, o audio ou outra
  -- midia, e a resposta que o filtro do CFM barrou).
  c_motivos_que_nunca_atribuem constant text[] := array['urgencia', 'fora_do_horario', 'sintoma', 'assunto_clinico', 'midia_nao_suportada', 'conformidade'];
  -- D-55: o recorte de Transferir e da mensagem agendada (Somente leitura
  -- nao atende conversa).
  c_papeis_que_recebem constant text[] := array['admin', 'gestor', 'recepcao', 'profissional'];
  -- O valor de escalation_rules.passagem_para que liga a atribuicao
  -- (qualquer outro, ou a chave ausente, e a fila).
  c_regra_do_responsavel constant text := 'responsavel_do_lead';
  -- O nome no evento: uma linha, ate 80 caracteres.
  c_limite_do_nome constant integer := 80;
  v_conversa uuid;
  v_clinica uuid;
  v_criado timestamptz;
  v_status text;
  v_atendente uuid;
  v_contato uuid;
  v_desfecho text;
  v_motivo text;
  v_regra text;
  v_responsavel uuid;
  v_nome text;
  v_lidas uuid[];
begin
  -- Qualquer erro desfaz o que esta chamada fez, vira WARNING (a clinica e
  -- o SQLSTATE, nenhum dado de paciente) e devolve o codigo erro: a conversa
  -- fica na fila.
  begin
    -- O CHECK job_queue_ia_tem_conversa garante o uuid no payload do kind.
    select (j.payload ->> 'conversation_id')::uuid, j.clinic_id, j.created_at
      into v_conversa, v_clinica, v_criado
      from public.job_queue j
     where j.id = p_job_id
       and j.kind = 'responder_com_ia'
       and j.status = 'executando'
       and j.locked_by = p_worker;
    if v_conversa is null or not exists (
      select 1 from public.conversation c
       where c.id = v_conversa and c.clinic_id = v_clinica
    ) then
      return jsonb_build_object('atribuida', false, 'codigo', 'sem_posse');
    end if;

    -- A trava da conversa ANTES de ler a janela e o estado (a ordem de
    -- passar_conversa_da_ia_para_equipe): um Devolver, um Assumir ou um
    -- Resolver que comitou antes ja aparece aqui; um que vem depois espera
    -- esta transacao.
    select c.status, c.assignee_user_id, c.contact_id
      into v_status, v_atendente, v_contato
      from public.conversation c
     where c.id = v_conversa
       for no key update;

    -- D-A: o job de antes da janela atual nao mexe na sessao nova.
    if exists (
      select 1 from public.ia_janela_da_conversa w
       where w.conversation_id = v_conversa
         and v_criado < w.desde
    ) then
      return jsonb_build_object('atribuida', false, 'codigo', 'job_antigo');
    end if;

    -- A passagem foi deste job: a ULTIMA decisao dele passou a conversa
    -- para a equipe, com um motivo que pode atribuir.
    select d.desfecho, d.escalation_reason
      into v_desfecho, v_motivo
      from public.ai_decision_log d
     where d.job_id = p_job_id
       and d.clinic_id = v_clinica
       and d.conversation_id = v_conversa
     order by d.created_at desc, d.id desc
     limit 1;
    if v_motivo is null or not coalesce(v_desfecho = any (c_desfechos_que_passam), false) then
      return jsonb_build_object('atribuida', false, 'codigo', 'sem_passagem');
    end if;
    if v_motivo = any (c_motivos_que_nunca_atribuem) then
      return jsonb_build_object('atribuida', false, 'codigo', 'motivo_nao_atribui');
    end if;

    -- A conversa na fila, sem responsavel e sem a marca de urgencia aberta.
    if v_status is distinct from 'aguardando_humano' then
      return jsonb_build_object('atribuida', false, 'codigo', 'fora_da_fila');
    end if;
    if v_atendente is not null then
      return jsonb_build_object('atribuida', false, 'codigo', 'com_responsavel');
    end if;
    if exists (
      select 1 from public.conversa_urgente u
       where u.conversation_id = v_conversa
         and u.encerrada_em is null
    ) then
      return jsonb_build_object('atribuida', false, 'codigo', 'urgente');
    end if;

    -- (revisao 2) O paciente escreveu o que o job nao leu: a mensagem de
    -- entrada dele, nao apagada, desde a criacao do job e fora das lidas do
    -- turno deste job (ai_turno.mensagens_lidas, que o motor grava antes de
    -- toda passagem com frase; sem a linha do turno, nada lido). A que
    -- chegou depois da passagem e a que chegou durante o turno (o modelo
    -- nao a viu): alguem de plantao precisa ver na fila. Depois da trava da
    -- conversa: a ingestao grava a mensagem e mexe na conversa na mesma
    -- transacao, entao a que pegou a conversa antes ja aparece aqui; a que
    -- vem depois espera esta transacao e chega a conversa ja atribuida.
    select t.mensagens_lidas into v_lidas
      from public.ai_turno t
     where t.job_id = p_job_id
       and t.clinic_id = v_clinica
       and t.conversation_id = v_conversa;
    v_lidas := coalesce(v_lidas, '{}'::uuid[]);
    if exists (
      select 1 from public.message m
       where m.conversation_id = v_conversa
         and m.clinic_id = v_clinica
         and m.direction = 'entrada'
         and m.author = 'paciente'
         and m.deleted_at is null
         and m.created_at >= v_criado
         and not coalesce(m.id = any (v_lidas), false)
    ) then
      return jsonb_build_object('atribuida', false, 'codigo', 'mensagem_nova');
    end if;

    -- A regra da ULTIMA versao publicada (a que o agente le no WhatsApp).
    select a.escalation_rules ->> 'passagem_para' into v_regra
      from public.ai_agent_config a
     where a.clinic_id = v_clinica
       and a.status = 'publicada'
     order by a.version desc
     limit 1;
    if v_regra is distinct from c_regra_do_responsavel then
      return jsonb_build_object('atribuida', false, 'codigo', 'regra_fila');
    end if;

    -- O responsavel do lead: membro ativo desta clinica com papel que atende.
    select k.owner_user_id into v_responsavel
      from public.contact k
     where k.id = v_contato
       and k.clinic_id = v_clinica;
    if v_responsavel is null then
      return jsonb_build_object('atribuida', false, 'codigo', 'sem_responsavel');
    end if;
    if not exists (
      select 1 from public.clinic_member m
       where m.clinic_id = v_clinica
         and m.user_id = v_responsavel
         and m.status = 'ativo'
         and m.role = any (c_papeis_que_recebem)
    ) then
      return jsonb_build_object('atribuida', false, 'codigo', 'responsavel_inapto');
    end if;

    -- Nunca rouba: so a conversa ainda na fila e sem responsavel (com a
    -- trava, e a mesma linha que as conferencias viram).
    update public.conversation c
       set status = 'em_atendimento',
           assignee_user_id = v_responsavel
     where c.id = v_conversa
       and c.clinic_id = v_clinica
       and c.status = 'aguardando_humano'
       and c.assignee_user_id is null;
    if not found then
      return jsonb_build_object('atribuida', false, 'codigo', 'fora_da_fila');
    end if;

    -- O nome em uma linha (espacos, tabulacoes e quebras viram um espaco),
    -- ate c_limite_do_nome; sem perfil ou vazio, o generico.
    select btrim(regexp_replace(p.name, '\s+', ' ', 'g')) into v_nome
      from public.profile p
     where p.user_id = v_responsavel;
    v_nome := btrim(left(coalesce(v_nome, ''), c_limite_do_nome));
    insert into public.message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      v_clinica, v_conversa, 'saida', 'sistema', 'evento',
      case when v_nome = '' then 'A conversa ficou com o responsável pelo lead.'
           else 'A conversa ficou com ' || v_nome || ', responsável pelo lead.' end,
      false, 0
    );
    return jsonb_build_object('atribuida', true, 'codigo', 'atribuida');
  exception when others then
    raise warning 'a atribuicao da conversa passada pela IA nao aconteceu (clinic %): %', v_clinica, sqlstate;
    return jsonb_build_object('atribuida', false, 'codigo', 'erro');
  end;
end;
$function$
;

comment on function public.atribuir_conversa_passada_pela_ia(uuid, text) is
  'So o servidor (service_role; o executor da IA), DEPOIS da tentativa da frase de sempre (AG6a, D-15, D-55; revisao de 28/10/2026): a conversa que o job passou para a equipe fica com o responsavel do lead. Recusas na ordem, {atribuida:false, codigo}: sem_posse (o job nao e responder_com_ia em executando com o worker, ou a conversa nao e da clinica do job); (trava da conversa) job_antigo (D-A: job de antes da janela atual); sem_passagem (a ultima decisao do job, em ai_decision_log, nao e escalou, bloqueou ou falhou com escalation_reason); motivo_nao_atribui (urgencia, fora_do_horario e, pela revisao 2, sintoma, assunto_clinico, midia_nao_suportada e conformidade); fora_da_fila (a conversa nao esta em aguardando_humano); com_responsavel; urgente (a marca aberta em conversa_urgente); mensagem_nova (revisao 2: mensagem de entrada do paciente, nao apagada, desde a criacao do job e fora de ai_turno.mensagens_lidas do job; sem o turno, nada lido); regra_fila (a ultima versao publicada sem escalation_rules ->> passagem_para = responsavel_do_lead); sem_responsavel (o contato sem owner_user_id); responsavel_inapto (sem clinic_member ativo da clinica com papel admin, gestor, recepcao ou profissional). Atribuiu, {atribuida:true, codigo:atribuida}: o update so de aguardando_humano sem responsavel para em_atendimento com ele (nunca rouba) e o evento "A conversa ficou com {nome}, responsavel pelo lead." (profile.name em uma linha, ate 80; sem nome, "A conversa ficou com o responsavel pelo lead."). Qualquer erro: WARNING com a clinica e o SQLSTATE, nada muda, {atribuida:false, codigo:erro}. Idempotente: a segunda chamada devolve fora_da_fila.';

-- 6. O rotulo de antes (o da AG6a; sem comentario, como antes).
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
    -- [remarcar e cancelar] inicio
    when 'fora_do_prazo' then 'A IA passou a conversa para a equipe: o pedido de cancelar ou remarcar ficou dentro do prazo da clínica.'
    -- [remarcar e cancelar] fim
    -- [AG6 urgencia] inicio
    when 'urgencia' then 'A IA passou a conversa para a equipe: a pessoa descreveu algo que pode ser uma emergência.'
    -- [AG6 urgencia] fim
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
$function$
;

-- 7. A poda de antes (o corpo da AG6a), com o comentario de antes.
CREATE OR REPLACE FUNCTION public.podar_agendamento_da_ia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_atendimentos integer := 0;
  v_dados integer := 0;
  -- [lista pela IA] inicio
  -- O pedido vivo (sem consumo) vale ate a resposta seguinte: 7 dias e
  -- folga. O consumido e so a trilha de quem pediu: 30 dias.
  c_pedido_vivo constant interval := interval '7 days';
  c_pedido_consumido constant interval := interval '30 days';
  v_pedidos integer := 0;
  -- [lista pela IA] fim
  -- [AG6 urgencia] inicio
  -- A marca de urgencia encerrada e so a trilha de quem pegou: 30 dias. A
  -- aberta (a conversa ainda espera a equipe) nunca e podada.
  c_marca_encerrada constant interval := interval '30 days';
  v_urgencias integer := 0;
  -- [AG6 urgencia] fim
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

  -- [lista pela IA] inicio
  -- O pedido da lista de espera (AG5): o vivo com 7 dias ou da conversa que
  -- sumiu; o consumido com 30 dias. Ate 1000 por passagem, sem esperar
  -- ninguem (a fase 1 e a 2 travam o pedido: SKIP LOCKED).
  delete from public.ia_pedido_de_espera p
   where p.id in (
     select x.id
       from public.ia_pedido_de_espera x
      where (x.consumido_em is null
             and (x.created_at < now() - c_pedido_vivo
                  or not exists (select 1 from public.conversation c where c.id = x.conversation_id)))
         or (x.consumido_em is not null and x.consumido_em < now() - c_pedido_consumido)
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_pedidos = row_count;
  -- [lista pela IA] fim

  -- [AG6 urgencia] inicio
  -- A marca de urgencia encerrada ha mais de 30 dias (AG6a). Ate 1000 por
  -- passagem, sem esperar ninguem (o gatilho que fecha e a passagem que
  -- reabre travam a linha: SKIP LOCKED).
  delete from public.conversa_urgente u
   where u.conversation_id in (
     select x.conversation_id
       from public.conversa_urgente x
      where x.encerrada_em is not null
        and x.encerrada_em < now() - c_marca_encerrada
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_urgencias = row_count;
  -- [AG6 urgencia] fim

  return jsonb_build_object('atendimentos', v_atendimentos, 'dados', v_dados
                            -- [lista pela IA]
                            , 'pedidos_de_espera', v_pedidos
                            -- [AG6 urgencia]
                            , 'urgencias', v_urgencias);
end;
$function$
;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3), do pedido da lista de espera (AG5) e da marca de urgencia (AG6a). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. ia_pedido_de_espera: o vivo (sem consumo) com 7 dias ou da conversa que sumiu; o consumido com 30 dias. conversa_urgente: a marca encerrada ha mais de 30 dias (a aberta nunca). Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados, pedidos_de_espera, urgencias}.';

-- 8. A tabela (com os indices, o gatilho, a policy e os grants) e as duas
--    funcoes dela.
drop table public.ia_leitura_da_midia;
drop function public.ia_leitura_da_midia_nao_muda();
drop function public.ia_lista_sem_repetido(uuid[]);

-- 9. definir_contato_liberado_da_ia: de volta aos 7 parametros, com o corpo,
--    os grants e o comentario de antes.
drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint);

CREATE OR REPLACE FUNCTION public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean, p_forcar_contato_existente boolean DEFAULT false, p_confirmou_aviso_da_openai boolean DEFAULT false, p_confirmou_teste_com_paciente boolean DEFAULT false)
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
$function$
;

revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean) to authenticated, service_role;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean) is
  'Liga ou desliga um telefone da equipe para a IA (T5). Quem chama: administrador ativo da propria clinica da lista (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera); o forcar (telefone de paciente que aceitou testar, onda 2, P3), o mesmo guarda com p_confirmou_teste_com_paciente (sem ela, 23514 teste_com_paciente_nao_confirmado, antes de qualquer leitura). Ao ligar recusa numero de WhatsApp do Conduzza e contato com sinal de paciente sem o forcar (23514). Telefone fora da lista: ligar exige p_confirmou_aviso_da_openai (23514 aviso_da_openai_nao_confirmado), desligar nao cria linha. Grava audit_log: editou, confirmou_aviso_da_openai (ligar com a confirmacao), forcou_telefone_de_paciente_na_ia e confirmou_teste_com_paciente (no nome de quem forca). Sempre por nome de parametro.';

-- 10. As duas colunas (com os CHECKs e os comentarios delas), a linha
--     whisper-1 e os comentarios das tabelas de antes.
alter table public.ia_contato_liberado drop column aviso_da_openai_versao;
delete from public.llm_preco where modelo = 'whisper-1';
alter table public.llm_preco drop column audio_microdolar_por_minuto;

comment on table public.llm_preco is
  'Preco por modelo de linguagem, em microdolar por milhao de tokens (entrada comum, saida com o raciocinio, leitura e escrita de cache). Global, sem clinic_id, como message_pricing: o preco vive em tabela, nunca no codigo. fonte diz de onde veio o numero. Provedor em uso: OpenAI (gpt-6-luna e gpt-6.1-sol, faixa Standard); as linhas claude-* ficaram da Anthropic e nenhum codigo as le.';
comment on table public.ia_uso is
  'Livro de gasto da IA: uma linha por chamada ao modelo (origem whatsapp, simulador ou avaliacao; papel agente, verificador ou classificador). custo_microdolar calculado pelo codigo a partir de llm_preco. So o sistema escreve; o super admin le. A soma das ultimas 24 horas (janela movel) contra ia_liberacao.teto_diario_centavos_usd entra em ia_pode_atender. job_id sem FK (a fila e podada).';

-- 11. Os CHECKs de antes, sem os valores da midia: NOT VALID e, sem linha
--     com valor novo, VALIDATE. O de escalation_reason com o comentario de
--     antes (o da AG6a); o de papel sem comentario, como antes.
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
      'fora_do_prazo', 'urgencia')) not valid;

comment on constraint ai_decision_log_escalation_reason_valida on public.ai_decision_log is
  'Os motivos da passagem para a equipe (espelho: MOTIVOS_DE_ESCALONAMENTO em lib/domain/agente/config.ts). AG6a: mais urgencia (o portao achou sinal de emergencia; a conversa vai para a fila marcada como urgente, conversa_urgente).';

alter table public.ia_uso
  drop constraint ia_uso_papel_valido;

alter table public.ia_uso
  add constraint ia_uso_papel_valido
    check (papel in ('agente', 'verificador', 'classificador')) not valid;

do $validar$
begin
  if not exists (select 1 from public.ai_decision_log d
                  where d.escalation_reason in ('midia_clinica', 'documento_do_paciente', 'midia_nao_identificada')) then
    alter table public.ai_decision_log validate constraint ai_decision_log_escalation_reason_valida;
  end if;
  if not exists (select 1 from public.ia_uso u
                  where u.papel in ('transcricao', 'leitor_de_midia')) then
    alter table public.ia_uso validate constraint ia_uso_papel_valido;
  end if;
end;
$validar$;

-- 12. A conferencia: os corpos, os comentarios e os grants de antes, os
--     CHECKs e as colunas de antes, e nada novo de pe.
do $conferencia$
declare
  v_caso record;
begin
  for v_caso in
    select *
      from (values
        ('public.arquivar_e_limpar_mensagem(uuid,text,text,uuid)',
         '9a949b8acd0d38c72adc498efbddb4bd', null,
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.definir_contato_liberado_da_ia(uuid,text,text,boolean,boolean,boolean,boolean)',
         '88c5fa98f271c16cf783acffba347179', '84b35e68ff4e8c5666de0f38501148b0',
         'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'),
        ('public.atribuir_conversa_passada_pela_ia(uuid,text)',
         'dbef687c38a1966cb30a16accdbb1b89', 'bb548d23cdf37f5842216d9da0e27e0e',
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.rotulo_do_motivo_da_ia(text)',
         '20f2194170f8aa6ed0cceec21a0dca20', null,
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.podar_agendamento_da_ia()',
         '9fcaf98cd23c11867d6f14af22ef407a', 'adc20b1ebfaf01255c8d5ac0ef5a9e00',
         'postgres=X/postgres')
      ) as t(assinatura, md5, md5_comentario, grants)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.md5
    then
      raise exception 'ROLLBACK 20261030100000: % nao voltou ao corpo de antes', v_caso.assinatura;
    end if;
    if md5(obj_description(to_regprocedure(v_caso.assinatura), 'pg_proc')) is distinct from v_caso.md5_comentario then
      raise exception 'ROLLBACK 20261030100000: o comentario de % nao e o de antes', v_caso.assinatura;
    end if;
    if (select string_agg(a::text, ',' order by a::text)
          from pg_proc p, unnest(p.proacl) a where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.grants
    then
      raise exception 'ROLLBACK 20261030100000: os grants de % nao sao os de antes', v_caso.assinatura;
    end if;
  end loop;
  if to_regclass('public.ia_leitura_da_midia') is not null
     or exists (select 1 from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('gravar_leitura_da_midia', 'midia_da_ia_liberada',
                                     'ia_lista_sem_repetido', 'ia_leitura_da_midia_nao_muda'))
     or (select count(*) from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'definir_contato_liberado_da_ia') <> 1
     or exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public'
                   and (c.table_name, c.column_name) in (('llm_preco', 'audio_microdolar_por_minuto'),
                                                         ('ia_contato_liberado', 'aviso_da_openai_versao')))
     or exists (select 1 from public.llm_preco p where p.modelo = 'whisper-1')
  then
    raise exception 'ROLLBACK 20261030100000: um objeto da migration ficou';
  end if;
  if md5(obj_description('public.llm_preco'::regclass, 'pg_class')) is distinct from md5('Preco por modelo de linguagem, em microdolar por milhao de tokens (entrada comum, saida com o raciocinio, leitura e escrita de cache). Global, sem clinic_id, como message_pricing: o preco vive em tabela, nunca no codigo. fonte diz de onde veio o numero. Provedor em uso: OpenAI (gpt-6-luna e gpt-6.1-sol, faixa Standard); as linhas claude-* ficaram da Anthropic e nenhum codigo as le.')
     or md5(obj_description('public.ia_uso'::regclass, 'pg_class')) is distinct from md5('Livro de gasto da IA: uma linha por chamada ao modelo (origem whatsapp, simulador ou avaliacao; papel agente, verificador ou classificador). custo_microdolar calculado pelo codigo a partir de llm_preco. So o sistema escreve; o super admin le. A soma das ultimas 24 horas (janela movel) contra ia_liberacao.teto_diario_centavos_usd entra em ia_pode_atender. job_id sem FK (a fila e podada).')
  then
    raise exception 'ROLLBACK 20261030100000: os comentarios das tabelas nao sao os de antes';
  end if;
  if exists (
       select 1 from pg_constraint k
        where k.conrelid = 'public.ai_decision_log'::regclass
          and k.conname = 'ai_decision_log_escalation_reason_valida'
          and (position('midia_clinica' in pg_get_constraintdef(k.oid)) > 0
               or position('documento_do_paciente' in pg_get_constraintdef(k.oid)) > 0
               or position('midia_nao_identificada' in pg_get_constraintdef(k.oid)) > 0
               or md5(obj_description(k.oid, 'pg_constraint')) is distinct from md5('Os motivos da passagem para a equipe (espelho: MOTIVOS_DE_ESCALONAMENTO em lib/domain/agente/config.ts). AG6a: mais urgencia (o portao achou sinal de emergencia; a conversa vai para a fila marcada como urgente, conversa_urgente).')))
     or exists (
       select 1 from pg_constraint k
        where k.conrelid = 'public.ia_uso'::regclass
          and k.conname = 'ia_uso_papel_valido'
          and (position('transcricao' in pg_get_constraintdef(k.oid)) > 0
               or position('leitor_de_midia' in pg_get_constraintdef(k.oid)) > 0
               or obj_description(k.oid, 'pg_constraint') is not null))
     or (select count(*) from pg_constraint k
          where (k.conrelid = 'public.ai_decision_log'::regclass
                 and k.conname = 'ai_decision_log_escalation_reason_valida'
                 and position('urgencia' in pg_get_constraintdef(k.oid)) > 0
                 and k.convalidated = not exists (
                       select 1 from public.ai_decision_log d
                        where d.escalation_reason in ('midia_clinica', 'documento_do_paciente', 'midia_nao_identificada')))
             or (k.conrelid = 'public.ia_uso'::regclass
                 and k.conname = 'ia_uso_papel_valido'
                 and position('classificador' in pg_get_constraintdef(k.oid)) > 0
                 and k.convalidated = not exists (
                       select 1 from public.ia_uso u where u.papel in ('transcricao', 'leitor_de_midia')))) <> 2
  then
    raise exception 'ROLLBACK 20261030100000: os CHECKs de ai_decision_log ou de ia_uso nao sao os de antes';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
