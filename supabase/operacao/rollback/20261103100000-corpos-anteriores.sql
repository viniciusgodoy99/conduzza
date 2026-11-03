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
-- delas (preparo_texto_valido, responsavel_tecnico_vigente,
-- responsavel_tecnico_nao_muda, preparo_do_procedimento_ao_inserir e
-- preparo_do_procedimento_nao_muda); as funcoes de leitura e do servidor
-- (user_e_responsavel_tecnico, preparo_em_vigor, mensagem_do_preparo,
-- ler_preparo_para_envio, preparos_em_vigor_da_clinica,
-- textos_de_preparo_da_clinica, preparo_em_vigor_do_procedimento); as RPCs
-- das telas (salvar, aprovar, devolver, descartar e suspender o preparo;
-- definir e encerrar o RT); o corpo novo de mensagem_ia_exige_aprovacao
-- (com um comentario); a copia do texto antigo (as versoes texto_antigo).
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); confere que nenhuma
-- decisao enviou_preparo e recente (o codigo de antes ja no ar; senao falha,
-- nada desfeito); avisa (NOTICE, so contagens) o que fica; devolve o corpo
-- de antes de mensagem_ia_exige_aprovacao (sem comentario; os grants nao
-- mudaram: CREATE OR REPLACE mantem) ANTES de tirar as funcoes que o corpo
-- novo chama; tira as funcoes do servidor e as RPCs; tira o CHECK
-- ai_decision_log_preparo_coerente e a coluna preparo_versao_id (o grant sai
-- junto); devolve os CHECKs de antes do desfecho e da saida (NOT VALID e,
-- sem linha com valor novo, VALIDATE: com linha enviou_preparo ou preparo,
-- o CHECK de antes fica NOT VALID e a linha fica), sem comentario; confere
-- no fim o corpo, o comentario, os grants, os CHECKs, que as funcoes e a
-- coluna sairam e que as tabelas ficaram (com qualquer diferenca, falha e
-- desfaz tudo). Sem IF EXISTS: com qualquer objeto faltando ou diferente,
-- falha e desfaz tudo.
--
-- O QUE FICA, DE PROPOSITO (o contrato, secao 1.8): AS DUAS TABELAS, com as
-- linhas (os RTs e as versoes, a prova de quem aprovou o que), os gatilhos,
-- os CHECKs, os indices, a RLS, as policies e as funcoes que elas usam
-- (preparo_texto_valido, responsavel_tecnico_vigente e as dos tres
-- gatilhos). A trilha (audit_log) fica. ATENCAO: para aplicar a migration
-- de novo depois deste rollback, as tabelas que ficaram precisam sair antes
-- (a migration cria as duas e nao e idempotente).
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
-- (preparo_em_vigor sai neste arquivo: rodar o update ANTES.)
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG7 chama as RPCs e as funcoes do
-- servidor, le as duas tabelas, grava a decisao enviou_preparo e a saida
-- preparo e manda a mensagem do sistema que so o corpo novo aceita), DEPOIS
-- este arquivo. O codigo de antes da AG7 (o main com a AG6b) funciona antes
-- e depois deste arquivo. Um turno decidido com saida preparo no meio do
-- rollback: o codigo de antes le a saida desconhecida como nula e fecha
-- sem_envio; a conversa fica na IA sem resposta ate a proxima mensagem do
-- paciente.
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
-- para gravar a decisao e o turno. Nenhuma trava em message, conversation,
-- clinic, procedure nem nas tabelas que ficam. Horario calmo.
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

-- 1. O codigo de antes ja no ar: nenhuma decisao enviou_preparo nos ultimos
--    15 minutos (um turno do codigo da AG7 ainda podia estar mandando).
do $codigo$
begin
  if exists (select 1 from public.ai_decision_log d
              where d.desfecho = 'enviou_preparo'
                and d.created_at > now() - interval '15 minutes') then
    raise exception using errcode = 'object_in_use',
      message = 'Rollback de 20261103100000: houve envio de preparo pela IA nos ultimos 15 minutos. Volte o codigo da AG7 primeiro e rode de novo depois. Nada foi desfeito.';
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
  raise notice 'Rollback de 20261103100000: ficam % designacao(oes) de RT e % versao(oes) de preparo (% aprovada(s)); ficam % decisao(oes) enviou_preparo e % turno(s) com saida preparo (com elas, o CHECK de antes volta NOT VALID).',
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

-- 4. As RPCs das telas e as funcoes do servidor e de leitura. Ficam as que
--    as tabelas usam (preparo_texto_valido, no CHECK; responsavel_tecnico_vigente,
--    no gatilho de aprovacao; as tres dos gatilhos).
drop function public.salvar_preparo_do_procedimento(uuid, text, integer);
drop function public.aprovar_preparo_do_procedimento(uuid, text);
drop function public.devolver_preparo_do_procedimento(uuid, text);
drop function public.descartar_preparo_do_procedimento(uuid);
drop function public.suspender_preparo_do_procedimento(uuid, text);
drop function public.definir_responsavel_tecnico(uuid, uuid, text, text, text, text);
drop function public.encerrar_responsavel_tecnico(uuid);
drop function public.ler_preparo_para_envio(uuid, uuid, boolean);
drop function public.preparos_em_vigor_da_clinica(uuid);
drop function public.textos_de_preparo_da_clinica(uuid);
drop function public.preparo_em_vigor_do_procedimento(uuid, uuid);
drop function public.mensagem_do_preparo(uuid);
drop function public.preparo_em_vigor(uuid, uuid);
drop function public.user_e_responsavel_tecnico(uuid);

-- 5. ai_decision_log: o CHECK novo e a coluna (o grant da coluna sai junto).
alter table public.ai_decision_log
  drop constraint ai_decision_log_preparo_coerente;
alter table public.ai_decision_log
  drop column preparo_versao_id;

-- 6. Os CHECKs de antes, sem os valores novos: NOT VALID e, sem linha com
--    valor novo, VALIDATE. Sem comentario, como antes.
alter table public.ai_decision_log
  drop constraint ai_decision_log_desfecho_valido;
alter table public.ai_decision_log
  add constraint ai_decision_log_desfecho_valido
    check (desfecho is null or desfecho in ('respondeu', 'escalou', 'bloqueou', 'falhou')) not valid;

alter table public.ai_turno
  drop constraint ai_turno_saida_valida;
alter table public.ai_turno
  add constraint ai_turno_saida_valida
    check (saida in ('resposta', 'frase', 'nenhuma')) not valid;

do $validar$
begin
  if not exists (select 1 from public.ai_decision_log d where d.desfecho = 'enviou_preparo') then
    alter table public.ai_decision_log validate constraint ai_decision_log_desfecho_valido;
  end if;
  if not exists (select 1 from public.ai_turno t where t.saida = 'preparo') then
    alter table public.ai_turno validate constraint ai_turno_saida_valida;
  end if;
end;
$validar$;

-- 7. A conferencia: o corpo, o comentario e os grants de antes, os CHECKs
--    de antes (a definicao sem o sufixo NOT VALID, que ele ganha com linha
--    de valor novo), o que saiu e o que ficou.
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
                                  'user_e_responsavel_tecnico'))
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
     or to_regprocedure('public.responsavel_tecnico_vigente(uuid)') is null
     or to_regprocedure('public.responsavel_tecnico_nao_muda()') is null
     or to_regprocedure('public.preparo_do_procedimento_ao_inserir()') is null
     or to_regprocedure('public.preparo_do_procedimento_nao_muda()') is null
  then
    raise exception 'ROLLBACK 20261103100000: uma das tabelas ou das funcoes que ficam saiu';
  end if;
  if (select count(*) from pg_constraint k
       where obj_description(k.oid, 'pg_constraint') is null
         and ((k.conrelid = 'public.ai_decision_log'::regclass
               and k.conname = 'ai_decision_log_desfecho_valido'
               and md5(regexp_replace(pg_get_constraintdef(k.oid), ' NOT VALID$', '')) = 'c0d83395337e74d559861d5b8fa58801'
               and k.convalidated = not exists (select 1 from public.ai_decision_log d where d.desfecho = 'enviou_preparo'))
              or (k.conrelid = 'public.ai_turno'::regclass
                  and k.conname = 'ai_turno_saida_valida'
                  and md5(regexp_replace(pg_get_constraintdef(k.oid), ' NOT VALID$', '')) = '36975878604a6c0dabc28538f3cdf1f8'
                  and k.convalidated = not exists (select 1 from public.ai_turno t where t.saida = 'preparo')))) <> 2
  then
    raise exception 'ROLLBACK 20261103100000: os CHECKs do desfecho ou da saida nao sao os de antes';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
