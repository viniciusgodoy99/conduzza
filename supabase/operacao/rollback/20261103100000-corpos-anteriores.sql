-- Rollback manual da migration 20261103100000_preparo_aprovado_pelo_rt.sql
-- (o preparo do procedimento enviado palavra por palavra, so com o texto
-- aprovado pelo responsavel tecnico da clinica, AG7, parte de banco;
-- 03/11/2026).
--
-- O corpo de ANTES da migration: o do M1 (20261013100000, linhas 1686 a
-- 1805; a AG5 e a AG6 nao mexeram nele; igual na producao em 03/11/2026,
-- lida com fndef.js, so leitura), com o md5(prosrc) (o ensaio confere que o
-- banco ainda esta assim antes de trocar, e o fim deste arquivo confere que
-- voltou):
--   mensagem_ia_exige_aprovacao()  1129cfc16036215e538422fba7371a1c (sem comentario; grants so do dono)
-- Os CHECKs de antes (md5 de pg_get_constraintdef, sem comentario):
--   ai_decision_log_desfecho_valido  c0d83395337e74d559861d5b8fa58801
--   ai_turno_saida_valida            36975878604a6c0dabc28538f3cdf1f8
-- e os da AG7 (os que ficam com linha de valor novo, passo 6):
--   ai_decision_log_desfecho_valido  f26a44dbe96858015f0d31e706c4fe65
--   ai_turno_saida_valida            a5972473c772c7dfa70bdb8001362830
-- SE A AG5, A AG6a OU A AG6b MUDAREM o corpo antes de aplicar (revisao),
-- refazer este arquivo com o corpo vigente
-- (~/.claude/plans/agente-completo/ag7/banco/dev/montar/montar_rollback.py).
--
-- O QUE A MIGRATION FEZ: a coluna ai_decision_log.preparo_versao_id (com o
-- comentario e o SELECT da sessao); o CHECK do desfecho com enviou_preparo e
-- o CHECK novo ai_decision_log_preparo_coerente (com os comentarios); o
-- CHECK da saida do turno com preparo (com o comentario); as tabelas
-- responsavel_tecnico e preparo_do_procedimento (os CHECKs, os indices, os
-- gatilhos, a RLS, as policies, os grants, os comentarios) e as funcoes
-- delas (preparo_texto_valido, preparo_nome_valido,
-- responsavel_tecnico_vigente, responsavel_tecnico_nao_muda,
-- preparo_do_procedimento_ao_inserir e preparo_do_procedimento_nao_muda);
-- as regras do conteudo das RPCs (preparo_texto_recusado e
-- preparo_conselho_recusa_texto); as funcoes de
-- leitura e do servidor (user_e_responsavel_tecnico, preparo_em_vigor,
-- mensagem_do_preparo, ler_preparo_para_envio,
-- preparos_em_vigor_da_clinica, textos_de_preparo_da_clinica,
-- preparo_em_vigor_do_procedimento); as RPCs das telas (salvar, aprovar,
-- devolver, descartar e suspender o preparo; definir e encerrar o RT;
-- conferir o registro do RT); o
-- corpo novo de mensagem_ia_exige_aprovacao (com um comentario); a copia do
-- texto antigo (as versoes texto_antigo).
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); confere que o codigo da
-- AG7 ja saiu do ar (passo 1: nenhum envio do preparo pela IA nem pela
-- regua nos ultimos 15 minutos; senao falha, nada desfeito); avisa
-- (NOTICE, so contagens) o que fica; devolve o corpo de antes de
-- mensagem_ia_exige_aprovacao (sem comentario; os grants nao mudaram:
-- CREATE OR REPLACE mantem) ANTES de tirar as funcoes que o corpo novo
-- chama; tira as funcoes do servidor, as RPCs, preparo_texto_recusado e
-- preparo_conselho_recusa_texto;
-- tira o CHECK ai_decision_log_preparo_coerente e a coluna
-- preparo_versao_id (o grant sai junto); devolve os CHECKs de antes do
-- desfecho e da saida (NOT VALID e VALIDATE, sem comentario), salvo com
-- linha enviou_preparo (ou preparo): ai fica o CHECK da AG7, que so
-- acrescenta o valor, com um comentario que diz por que ficou (um CHECK de
-- antes NOT VALID recusaria o UPDATE do codigo de antes que fecha o turno
-- que sobrou); confere no fim o corpo, o comentario, os grants, os CHECKs,
-- que as funcoes e a coluna sairam e que as tabelas ficaram (com qualquer
-- diferenca, falha e desfaz tudo). Sem IF EXISTS: com qualquer objeto
-- faltando ou diferente, falha e desfaz tudo.
--
-- O QUE FICA, DE PROPOSITO (o contrato, secao 1.8): AS DUAS TABELAS, com as
-- linhas (os RTs, a conferencia do registro e as versoes, a prova de quem
-- aprovou e de quem conferiu o que), os gatilhos,
-- os CHECKs, os indices, a RLS, as policies e as SEIS funcoes que elas usam
-- (preparo_texto_valido e preparo_nome_valido, nos CHECKs;
-- responsavel_tecnico_vigente, no gatilho de aprovacao; e as dos tres
-- gatilhos). A trilha (audit_log) fica. Com decisao enviou_preparo ou turno
-- com saida preparo, ficam tambem essas linhas e o CHECK da AG7 do desfecho
-- ou da saida.
--
-- PARA APLICAR A MIGRATION DE NOVO depois deste rollback (ela usa create
-- function e create table sem or replace e nao e idempotente), numa
-- transacao, antes:
--   1. tirar as duas tabelas (drop table public.preparo_do_procedimento e
--      depois drop table public.responsavel_tecnico, nessa ordem, pela FK)
--      e as seis funcoes que ficaram (preparo_texto_valido(text),
--      preparo_nome_valido(text), responsavel_tecnico_vigente(uuid),
--      responsavel_tecnico_nao_muda(), preparo_do_procedimento_ao_inserir()
--      e preparo_do_procedimento_nao_muda()), decidido com o dono: as
--      tabelas sao a prova de quem aprovou o que;
--   2. apagar a linha 20261103100000 de supabase_migrations.schema_migrations
--      (nenhum rollback do projeto mexe nela);
--   3. as decisoes enviou_preparo que ficaram perderam a versao (a coluna
--      saiu): o CHECK ai_decision_log_preparo_coerente da migration nao
--      valida com elas. Decidir com o dono antes (apaga-las, ou reaplicar
--      com esse CHECK so NOT VALID).
--   Os CHECKs do desfecho e da saida (os de antes ou os da AG7 que ficaram)
--   a migration troca sozinha (drop e add do mesmo nome).
--
-- OPCIONAL, ANTES deste arquivo (numa transacao propria, se o dono quiser
-- que a regua velha mande o texto aprovado): copiar o texto em vigor para
-- prep_instructions (a regua de antes le prep_instructions; o texto em vigor
-- e o aprovado pelo RT):
--   update public.procedure p
--      set prep_instructions = v.texto
--     from public.preparo_do_procedimento v
--    where v.procedure_id = p.id
--      and v.situacao = 'aprovado'
--      and public.preparo_em_vigor(v.clinic_id, v.id);
-- (preparo_em_vigor sai neste arquivo: rodar o update ANTES, e so depois de
-- conferir que o deploy do codigo de antes entrou: com o texto aprovado em
-- prep_instructions, a trava da regua do passo 1 deixa de ve-lo.)
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG7 chama as RPCs e as funcoes do
-- servidor, le as duas tabelas, grava a decisao enviou_preparo e a saida
-- preparo e manda a mensagem do sistema que so o corpo novo aceita), DEPOIS
-- este arquivo. O codigo de antes da AG7 (o main com a AG6b) funciona antes
-- e depois deste arquivo. Um turno decidido com saida preparo no meio do
-- rollback: o codigo de antes le a saida desconhecida como nula e fecha
-- sem_envio (o UPDATE dele nao mexe na saida, e o CHECK da AG7, que fica com
-- a linha, aceita); a conversa fica na IA sem resposta ate a proxima
-- mensagem do paciente.
--
-- A TRAVA DO CODIGO (passo 1) olha dois sinais dos ultimos 15 minutos (so
-- contagens, nunca texto): (a) a IA, uma decisao enviou_preparo; (b) a
-- regua, uma mensagem do sistema de um toque (o job executar_passo_de_regua
-- da mensagem) cujo passo (cadence_step.fixed_body) tem {{preparo}} e cujo
-- corpo leva, palavra por palavra, o texto de uma versao da clinica que ja
-- valeu (aprovado_em nao nulo). A regua da AG7 so manda o texto aprovado; a
-- de antes manda prep_instructions: o texto aprovado que tambem esta num
-- prep_instructions da clinica (o texto antigo aprovado como veio) nao
-- conta, porque as duas reguas mandariam o mesmo corpo (LIMITE: nesse caso
-- a trava nao ve a regua da AG7). A trava so ve o toque que SAIU com a
-- linha: a regua da AG7 sem a funcao (depois do rollback) tira a linha e
-- nao e vista, mas ai o rollback ja passou. Sem toque nem decisao nos 15
-- minutos, a trava passa: ela prova o que viu, nao que o deploy entrou.
--
-- O QUE SE PERDE: o envio do preparo pela IA (a regua de antes volta a
-- mandar prep_instructions). FICAM: as tabelas e as linhas delas, as
-- decisoes enviou_preparo (sem a versao: a coluna sai), os turnos com saida
-- preparo e a trilha.
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_decision_log (o CHECK e a coluna) e
-- ai_turno (o CHECK). Todas no comeco, numa ordem fixa, com NOWAIT: com uma
-- ocupada, solta as que pegou (o savepoint do bloco), espera 100 ms sem
-- trava nenhuma e tenta de novo, ate 10 vezes (uns 1 s, menos que os 3 s da
-- migration, de proposito); depois falha inteiro com 55P03, nada desfeito:
-- rodar de novo. Nunca espera trava com outra na mao (nao fecha ciclo, 40P01,
-- com sessao nenhuma). Ate o commit (milissegundos), o turno da IA espera
-- para gravar a decisao e o turno, e a LEITURA das duas tabelas tambem
-- espera (ACCESS EXCLUSIVE segura o SELECT: abrir uma conversa no
-- Atendimento espera). Em message, job_queue, cadence_run, cadence_step,
-- procedure e preparo_do_procedimento, so a leitura do passo 1 (ACCESS
-- SHARE, que nao barra ninguem); nenhuma trava em conversation, clinic nem
-- nas tabelas que ficam. Horario calmo.
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
      lock table public.ai_decision_log, public.ai_turno in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261103100000: ai_decision_log ou ai_turno seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- 1. O codigo de antes ja no ar (cabecalho, A TRAVA DO CODIGO): nada do
--    codigo da AG7 mandou o preparo nos ultimos 15 minutos, nem a IA (uma
--    decisao enviou_preparo) nem a regua (um toque de passo com {{preparo}}
--    que levou o texto de uma versao que ja valeu, fora de prep_instructions).
do $codigo$
begin
  if exists (select 1 from public.ai_decision_log d
              where d.desfecho = 'enviou_preparo'
                and d.created_at > now() - interval '15 minutes') then
    raise exception using errcode = 'object_in_use',
      message = 'Rollback de 20261103100000: houve envio de preparo pela IA nos ultimos 15 minutos. Volte o codigo da AG7 primeiro e rode de novo depois. Nada foi desfeito.';
  end if;
  if exists (
    select 1
      from public.preparo_do_procedimento v
      join public.message m
        on m.clinic_id = v.clinic_id
       and m.created_at > now() - interval '15 minutes'
       and m.direction = 'saida'
       and m.author = 'sistema'
       and m.job_id is not null
       and position(v.texto in m.body) > 0
      join public.job_queue j
        on j.id = m.job_id
       and j.kind = 'executar_passo_de_regua'
      join public.cadence_run r
        on r.id = case when j.payload ->> 'cadence_run_id' ~ '^[0-9a-fA-F-]{36}$'
                       then (j.payload ->> 'cadence_run_id')::uuid end
      join public.cadence_step s
        on s.id = r.cadence_step_id
     where v.aprovado_em is not null
       and s.fixed_body ~ '\{\{\s*preparo\s*\}\}'
       and not exists (
         select 1 from public.procedure p
          where p.clinic_id = v.clinic_id
            and position(v.texto in coalesce(p.prep_instructions, '')) > 0)
  ) then
    raise exception using errcode = 'object_in_use',
      message = 'Rollback de 20261103100000: a regua mandou uma orientacao de preparo aprovada pelo RT nos ultimos 15 minutos (o codigo da AG7 ainda no ar). Volte o codigo da AG7 primeiro e rode de novo depois. Nada foi desfeito.';
  end if;
end;
$codigo$;

-- 2. O que fica (so contagens, nenhum dado de paciente).
do $aviso$
declare
  v_rts bigint;
  v_versoes bigint;
  v_aprovadas bigint;
  v_decisoes bigint;
  v_turnos bigint;
begin
  select count(*) into v_rts from public.responsavel_tecnico;
  select count(*), count(*) filter (where v.situacao = 'aprovado') into v_versoes, v_aprovadas
    from public.preparo_do_procedimento v;
  select count(*) into v_decisoes from public.ai_decision_log d where d.desfecho = 'enviou_preparo';
  select count(*) into v_turnos from public.ai_turno t where t.saida = 'preparo';
  raise notice 'Rollback de 20261103100000: ficam % designacao(oes) de RT e % versao(oes) de preparo (% aprovada(s)); ficam % decisao(oes) enviou_preparo e % turno(s) com saida preparo (com elas, fica o CHECK da AG7).',
    v_rts, v_versoes, v_aprovadas, v_decisoes, v_turnos;
end;
$aviso$;

-- 3. O gatilho de message: o corpo de antes (o do M1), sem comentario. Os
--    grants nao mudaram. ANTES de tirar as funcoes que o corpo novo chama.
create or replace function public.mensagem_ia_exige_aprovacao()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_lista boolean;
  v_teste boolean;
  v_kind text;
  v_job_status text;
  v_job_clinica uuid;
  v_job_conversa text;
  v_job_criado timestamptz;
  v_status text;
  v_responsavel uuid;
  v_contato uuid;
  v_chave text;
begin
  if new.author = 'ia' then
    select c.id = any (public.ia_clinicas_da_fase_controlada()), c.e_de_teste
      into v_lista, v_teste
      from public.clinic c
     where c.id = new.clinic_id;
    -- 1) fora das duas clinicas e nao de teste: nunca
    if not coalesce(v_lista, false) and not coalesce(v_teste, false) then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    -- 2) fixture e seed antigos em clinica de teste
    if coalesce(v_teste, false) and new.job_id is null then
      return new;
    end if;
    -- 3) forma
    if new.direction is distinct from 'saida'
       or new.job_id is null
       or new.author_user_id is not null
       or new.is_internal_note
       or new.content_type is distinct from 'texto'
       or new.media_url is not null
       or new.body is null
    then
      raise exception using errcode = 'CZIA1', message = 'ia_sem_aprovacao';
    end if;
    -- 4) job, conversa, janela e liberacao
    select j.kind, j.status, j.clinic_id, j.payload ->> 'conversation_id', j.created_at
      into v_kind, v_job_status, v_job_clinica, v_job_conversa, v_job_criado
      from public.job_queue j
     where j.id = new.job_id;
    if v_kind is distinct from 'responder_com_ia'
       or v_job_status is distinct from 'executando'
       or v_job_clinica is distinct from new.clinic_id
       or v_job_conversa is distinct from new.conversation_id::text
    then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    select c.status, c.assignee_user_id, c.contact_id
      into v_status, v_responsavel, v_contato
      from public.conversation c
     where c.id = new.conversation_id
       and c.clinic_id = new.clinic_id;
    if v_status is distinct from 'ia_atendendo' or v_responsavel is not null then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    select k.phone_key into v_chave
      from public.contact k
     where k.id = v_contato;
    if not exists (
      select 1 from public.ia_janela_da_conversa w
       where w.conversation_id = new.conversation_id
         and w.contact_id = v_contato
         and w.phone_key = v_chave
         and v_job_criado >= w.desde
    ) or not public.ia_pode_falar_com(new.clinic_id, new.whatsapp_account_id, v_chave)
    then
      raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
    end if;
    -- 5) decisao aprovada do mesmo job com o mesmo hash
    if not exists (
      select 1 from public.ai_decision_log d
       where d.clinic_id = new.clinic_id
         and d.conversation_id = new.conversation_id
         and d.job_id = new.job_id
         and d.aprovado
         and not d.compliance_blocked
         and d.texto_sha256 = encode(sha256(convert_to(new.body, 'UTF8')), 'hex')
    ) then
      raise exception using errcode = 'CZIA1', message = 'ia_sem_aprovacao';
    end if;
    return new;
  end if;

  if new.job_id is null then
    return new;
  end if;
  select j.kind into v_kind
    from public.job_queue j
   where j.id = new.job_id;
  if v_kind is distinct from 'responder_com_ia' then
    return new;
  end if;

  select c.id = any (public.ia_clinicas_da_fase_controlada()), c.e_de_teste
    into v_lista, v_teste
    from public.clinic c
   where c.id = new.clinic_id;
  if not coalesce(v_lista, false) and not coalesce(v_teste, false) then
    raise exception using errcode = 'CZIA2', message = 'ia_nao_liberada';
  end if;
  if new.author is distinct from 'sistema'
     or new.direction is distinct from 'saida'
     or new.content_type is distinct from 'texto'
     or new.is_internal_note
     or new.media_url is not null
     or new.body is distinct from public.frase_de_escalonamento_da_ia()
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  return new;
end;
$function$;

comment on function public.mensagem_ia_exige_aprovacao() is null;

-- 4. As RPCs das telas, as funcoes do servidor e de leitura e as regras do
--    conteudo das RPCs (preparo_texto_recusado e
--    preparo_conselho_recusa_texto). Ficam as que as tabelas usam
--    (preparo_texto_valido e preparo_nome_valido, nos CHECKs;
--    responsavel_tecnico_vigente, no gatilho de aprovacao; as tres dos
--    gatilhos).
drop function public.salvar_preparo_do_procedimento(uuid, text, integer);
drop function public.aprovar_preparo_do_procedimento(uuid, text);
drop function public.devolver_preparo_do_procedimento(uuid, text);
drop function public.descartar_preparo_do_procedimento(uuid);
drop function public.suspender_preparo_do_procedimento(uuid, text);
drop function public.definir_responsavel_tecnico(uuid, uuid, text, text, text, text);
drop function public.encerrar_responsavel_tecnico(uuid);
drop function public.conferir_registro_do_responsavel_tecnico(uuid);
drop function public.ler_preparo_para_envio(uuid, uuid, boolean);
drop function public.preparos_em_vigor_da_clinica(uuid);
drop function public.textos_de_preparo_da_clinica(uuid);
drop function public.preparo_em_vigor_do_procedimento(uuid, uuid);
drop function public.mensagem_do_preparo(uuid);
drop function public.preparo_em_vigor(uuid, uuid);
drop function public.user_e_responsavel_tecnico(uuid);
drop function public.preparo_texto_recusado(text);
drop function public.preparo_conselho_recusa_texto(text, text);

-- 5. ai_decision_log: o CHECK novo e a coluna (o grant da coluna sai junto).
alter table public.ai_decision_log
  drop constraint ai_decision_log_preparo_coerente;
alter table public.ai_decision_log
  drop column preparo_versao_id;

-- 6. Os CHECKs do desfecho e da saida. Sem linha com o valor novo, os de
--    antes (NOT VALID e VALIDATE, sem comentario, como antes). Com linha
--    enviou_preparo (ou preparo), fica o da AG7, que so acrescenta o valor:
--    o codigo de antes nunca grava esse valor, e o UPDATE dele que fecha o
--    turno que sobrou (sem mexer na saida) passa; um CHECK de antes NOT
--    VALID recusaria esse UPDATE (vale para toda linha nova ou alterada). O
--    comentario passa a dizer por que ficou.
do $checks$
begin
  if exists (select 1 from public.ai_decision_log d where d.desfecho = 'enviou_preparo') then
    comment on constraint ai_decision_log_desfecho_valido on public.ai_decision_log is
      'O desfecho do turno da IA: respondeu, escalou, bloqueou ou falhou (o M1). Ficou com enviou_preparo no rollback de 20261103100000 porque ha decisoes da AG7 com esse desfecho; o codigo de antes nunca o grava.';
  else
    alter table public.ai_decision_log
      drop constraint ai_decision_log_desfecho_valido;
    alter table public.ai_decision_log
      add constraint ai_decision_log_desfecho_valido
        check (desfecho is null or desfecho in ('respondeu', 'escalou', 'bloqueou', 'falhou')) not valid;
    alter table public.ai_decision_log validate constraint ai_decision_log_desfecho_valido;
  end if;
  if exists (select 1 from public.ai_turno t where t.saida = 'preparo') then
    comment on constraint ai_turno_saida_valida on public.ai_turno is
      'A saida decidida do turno: resposta, frase ou nenhuma (o M1); nula antes de decidir. Ficou com preparo no rollback de 20261103100000 porque ha turnos da AG7 com essa saida; o codigo de antes nunca a grava.';
  else
    alter table public.ai_turno
      drop constraint ai_turno_saida_valida;
    alter table public.ai_turno
      add constraint ai_turno_saida_valida
        check (saida in ('resposta', 'frase', 'nenhuma')) not valid;
    alter table public.ai_turno validate constraint ai_turno_saida_valida;
  end if;
end;
$checks$;

-- 7. A conferencia: o corpo, o comentario e os grants de antes, os CHECKs
--    (sem linha com o valor novo, os de antes, validados e sem comentario;
--    com linha, os da AG7, validados e com o comentario do passo 6), o que
--    saiu e o que ficou.
do $conferencia$
begin
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'public.mensagem_ia_exige_aprovacao()'::regprocedure)
       is distinct from '1129cfc16036215e538422fba7371a1c'
     or obj_description('public.mensagem_ia_exige_aprovacao()'::regprocedure, 'pg_proc') is not null
     or (select string_agg(a::text, ',' order by a::text)
           from pg_proc p, unnest(p.proacl) a where p.oid = 'public.mensagem_ia_exige_aprovacao()'::regprocedure)
        is distinct from 'postgres=X/postgres'
     or (select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',')
           from pg_proc p where p.oid = 'public.mensagem_ia_exige_aprovacao()'::regprocedure)
        is distinct from 'true|search_path=""'
  then
    raise exception 'ROLLBACK 20261103100000: mensagem_ia_exige_aprovacao nao voltou ao corpo de antes';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('salvar_preparo_do_procedimento', 'aprovar_preparo_do_procedimento',
                                  'devolver_preparo_do_procedimento', 'descartar_preparo_do_procedimento',
                                  'suspender_preparo_do_procedimento', 'definir_responsavel_tecnico',
                                  'encerrar_responsavel_tecnico', 'ler_preparo_para_envio',
                                  'preparos_em_vigor_da_clinica', 'textos_de_preparo_da_clinica',
                                  'preparo_em_vigor_do_procedimento', 'mensagem_do_preparo', 'preparo_em_vigor',
                                  'user_e_responsavel_tecnico', 'preparo_texto_recusado',
                                  'conferir_registro_do_responsavel_tecnico', 'preparo_conselho_recusa_texto'))
     or exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'ai_decision_log'
                   and c.column_name = 'preparo_versao_id')
     or exists (select 1 from pg_constraint k
                 where k.conrelid = 'public.ai_decision_log'::regclass
                   and k.conname = 'ai_decision_log_preparo_coerente')
  then
    raise exception 'ROLLBACK 20261103100000: uma funcao, a coluna ou o CHECK novo ficou';
  end if;
  if to_regclass('public.responsavel_tecnico') is null
     or to_regclass('public.preparo_do_procedimento') is null
     or to_regprocedure('public.preparo_texto_valido(text)') is null
     or to_regprocedure('public.preparo_nome_valido(text)') is null
     or to_regprocedure('public.responsavel_tecnico_vigente(uuid)') is null
     or to_regprocedure('public.responsavel_tecnico_nao_muda()') is null
     or to_regprocedure('public.preparo_do_procedimento_ao_inserir()') is null
     or to_regprocedure('public.preparo_do_procedimento_nao_muda()') is null
  then
    raise exception 'ROLLBACK 20261103100000: uma das tabelas ou das funcoes que ficam saiu';
  end if;
  -- Os CHECKs: validados; sem linha com o valor novo, os de antes (md5 de
  -- pg_get_constraintdef c0d83395... e 36975878..., sem comentario); com
  -- linha, os da AG7 (f26a44db... e a5972473..., com comentario).
  if (select count(*) from pg_constraint k
       where k.convalidated
         and ((k.conrelid = 'public.ai_decision_log'::regclass
               and k.conname = 'ai_decision_log_desfecho_valido'
               and case when exists (select 1 from public.ai_decision_log d where d.desfecho = 'enviou_preparo')
                        then md5(pg_get_constraintdef(k.oid)) = 'f26a44dbe96858015f0d31e706c4fe65'
                             and obj_description(k.oid, 'pg_constraint') is not null
                        else md5(pg_get_constraintdef(k.oid)) = 'c0d83395337e74d559861d5b8fa58801'
                             and obj_description(k.oid, 'pg_constraint') is null
                   end)
              or (k.conrelid = 'public.ai_turno'::regclass
                  and k.conname = 'ai_turno_saida_valida'
                  and case when exists (select 1 from public.ai_turno t where t.saida = 'preparo')
                           then md5(pg_get_constraintdef(k.oid)) = 'a5972473c772c7dfa70bdb8001362830'
                                and obj_description(k.oid, 'pg_constraint') is not null
                           else md5(pg_get_constraintdef(k.oid)) = '36975878604a6c0dabc28538f3cdf1f8'
                                and obj_description(k.oid, 'pg_constraint') is null
                      end))) <> 2
  then
    raise exception 'ROLLBACK 20261103100000: os CHECKs do desfecho ou da saida nao sao os esperados';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
