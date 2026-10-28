-- Rollback manual da migration 20261029120000_urgencia_e_passagem_da_ia.sql
-- (urgencia e passagem da IA ao responsavel do lead, AG6a, parte de banco;
-- 28/10/2026).
--
-- Corpos de ANTES da migration: o modelo local (a producao de 28/10/2026,
-- lida com q.js e fndef.js, so leitura, mais a AG4 e a AG5, que vao antes
-- desta e ainda nao foram aplicadas), com o md5(prosrc) (o ensaio confere
-- que o banco ainda esta assim antes de trocar, e o fim deste arquivo
-- confere que voltaram):
--   passar_conversa_da_ia_para_equipe(uuid,text,text)  bc305ae8af0f10c98e2f181c5aa72d30 (o de producao, M1; sem comentario)
--   rotulo_do_motivo_da_ia(text)                       0cfbd4cde199c421d3e644a2307373f9 (o da AG4; sem comentario)
--   podar_agendamento_da_ia()                          5db27895d8a149788f1e12dd0f3b8dbe (o da AG5; comentario 7ce7fc5d49033292bbff34e091ffcf47)
-- SE A AG5 OU A AG4 MUDAREM antes de aplicar (revisao), estes corpos e os
-- md5 mudam junto: refazer este arquivo com o corpo vigente.
--
-- O QUE A MIGRATION FEZ: os CHECKs ai_decision_log_escalation_reason_valida
-- e ai_decision_log_gatilho_entrada_valido com urgencia (e um comentario em
-- cada); o rotulo de urgencia; a tabela conversa_urgente (o indice, a RLS,
-- a policy, os grants e a publicacao do Realtime); o gatilho
-- urgencia_sai_quando_alguem_pega em conversation (com a funcao); a
-- passagem com p_atribuir (DROP e CREATE: a de 3 parametros deixou de
-- existir); a poda com a marca.
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); avisa (NOTICE, so
-- contagens) quantas marcas saem e quantas decisoes com urgencia ficam; tira
-- a tabela da publicacao; tira o gatilho e a funcao dele; devolve a
-- passagem de 3 parametros (o corpo e os grants de antes, sem comentario,
-- como antes), o rotulo e a poda de antes (com o comentario de antes da
-- poda; os grants nao mudaram: CREATE OR REPLACE mantem) ANTES de apagar a
-- tabela que a poda e a passagem de agora leem; apaga a tabela; devolve os
-- CHECKs de antes (NOT VALID e, sem decisao com urgencia, VALIDATE: com
-- decisao com urgencia, o CHECK de antes fica NOT VALID e a decisao fica);
-- confere no fim os tres md5, os comentarios, os grants, os CHECKs e que
-- nada novo ficou (com qualquer diferenca, falha e desfaz tudo). Sem IF
-- EXISTS: com qualquer objeto faltando ou diferente, falha e desfaz tudo.
--
-- ORDEM: PRIMEIRO voltar o codigo (o da AG6a chama a passagem com
-- p_atribuir, grava urgencia na decisao e le conversa_urgente), DEPOIS este
-- arquivo. O codigo de antes da AG6a (o main com a AG5) funciona antes e
-- depois deste arquivo.
--
-- O QUE SE PERDE: as marcas (abertas e encerradas): a conversa urgente
-- continua na fila, sem o destaque. FICAM: as decisoes com urgencia, os
-- eventos no fio e as conversas que ja ficaram com o responsavel.
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_decision_log (os CHECKs), conversa_urgente
-- (o DROP), conversation (o DROP TRIGGER e as FKs da tabela que sai) e
-- clinic (a FK da tabela que sai), medido no Postgres local: tirar gatilho
-- e tirar FK pegam ACCESS EXCLUSIVE na tabela do gatilho e na referenciada
-- (a migration so pegava SHARE ROW EXCLUSIVE nelas). Todas no comeco, numa
-- ordem fixa, com NOWAIT: com uma ocupada, solta as que pegou (o savepoint
-- do bloco), espera 100 ms sem trava nenhuma e tenta de novo, ate 10 vezes
-- (uns 1 s, menos que os 3 s da migration, de proposito); depois falha
-- inteiro com 55P03, nada desfeito: rodar de novo. Nunca espera trava com
-- outra na mao (nao fecha ciclo, 40P01, com sessao nenhuma). Ate o commit
-- (milissegundos), NINGUEM le conversation nem clinic (o Atendimento, quase
-- toda tela, a ingestao e o motor esperam), nem as decisoes da IA. Horario
-- calmo.
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
      lock table public.ai_decision_log, public.conversa_urgente, public.conversation, public.clinic
        in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261029120000: uma das tabelas seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- 1. O que sai e o que fica (so contagens, nenhum dado de paciente).
do $aviso$
declare
  v_marcas bigint;
  v_abertas bigint;
  v_decisoes bigint;
begin
  select count(*), count(*) filter (where u.encerrada_em is null)
    into v_marcas, v_abertas
    from public.conversa_urgente u;
  select count(*) into v_decisoes
    from public.ai_decision_log d
   where d.escalation_reason = 'urgencia' or d.gatilho_entrada = 'urgencia';
  raise notice 'Rollback de 20261029120000: saem % marca(s) de urgencia (% aberta(s)); ficam % decisao(oes) com urgencia (com elas, o CHECK de antes volta NOT VALID).',
    v_marcas, v_abertas, v_decisoes;
end;
$aviso$;

-- 2. A tabela sai da publicacao do Realtime.
do $realtime$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public'
                and tablename = 'conversa_urgente') then
    alter publication supabase_realtime drop table public.conversa_urgente;
  end if;
end;
$realtime$;

-- 3. O gatilho que fecha a marca e a funcao dele.
drop trigger urgencia_sai_quando_alguem_pega on public.conversation;
drop function public.urgencia_sai_quando_alguem_pega();

-- 4. A passagem de 3 parametros: o corpo de antes (o de producao, M1), com
--    os grants de antes; sem comentario, como antes.
drop function public.passar_conversa_da_ia_para_equipe(uuid, text, text, boolean);
CREATE OR REPLACE FUNCTION public.passar_conversa_da_ia_para_equipe(p_job_id uuid, p_worker text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conversa uuid;
  v_clinica uuid;
  v_criado timestamptz;
begin
  if public.rotulo_do_motivo_da_ia(p_motivo) is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

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
    return jsonb_build_object('passou', false, 'codigo', 'sem_posse');
  end if;

  -- D-A: trava a conversa ANTES de ler a janela (o Devolver trava a
  -- conversa e depois grava a janela): um Devolver que comitou antes ja
  -- aparece aqui; um que vem depois espera esta transacao.
  perform 1 from public.conversation c where c.id = v_conversa for no key update;
  if exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = v_conversa
       and v_criado < w.desde
  ) then
    return jsonb_build_object('passou', false, 'codigo', 'job_antigo');
  end if;

  if public.ia_tirar_conversa(v_conversa, p_motivo, true) then
    return jsonb_build_object('passou', true, 'codigo', 'passou');
  end if;
  return jsonb_build_object('passou', false, 'codigo', 'ja_fora_da_ia');
end;
$function$
;

revoke execute on function public.passar_conversa_da_ia_para_equipe(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.passar_conversa_da_ia_para_equipe(uuid, text, text)
  to service_role;

-- 5. O rotulo (o da AG4) e a poda (o da AG5) de antes; os grants nao
--    mudaram (CREATE OR REPLACE mantem). O rotulo nao tinha comentario; a
--    poda volta com o comentario de antes.
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

  return jsonb_build_object('atendimentos', v_atendimentos, 'dados', v_dados
                            -- [lista pela IA]
                            , 'pedidos_de_espera', v_pedidos);
end;
$function$
;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3) e do pedido da lista de espera (AG5). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. ia_pedido_de_espera: o vivo (sem consumo) com 7 dias ou da conversa que sumiu; o consumido com 30 dias. Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados, pedidos_de_espera}.';

-- 6. A tabela (a policy, o indice, os CHECKs e as FKs dela vao junto).
drop table public.conversa_urgente;

-- 7. Os CHECKs de antes, sem urgencia: NOT VALID e, sem decisao com
--    urgencia, VALIDATE. Sem comentario, como antes.
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
  drop constraint ai_decision_log_gatilho_entrada_valido;

alter table public.ai_decision_log
  add constraint ai_decision_log_gatilho_entrada_valido
    check (gatilho_entrada is null or gatilho_entrada in (
      'sintoma', 'assunto_clinico', 'pedido_humano', 'insatisfacao',
      'menor_de_idade', 'valor_fora_da_tabela', 'manipulacao', 'midia',
      'mensagem_longa')) not valid;

do $validar$
begin
  if not exists (select 1 from public.ai_decision_log d where d.escalation_reason = 'urgencia') then
    alter table public.ai_decision_log validate constraint ai_decision_log_escalation_reason_valida;
  end if;
  if not exists (select 1 from public.ai_decision_log d where d.gatilho_entrada = 'urgencia') then
    alter table public.ai_decision_log validate constraint ai_decision_log_gatilho_entrada_valido;
  end if;
end;
$validar$;

-- 8. A conferencia: os corpos, os comentarios e os grants de antes, os
--    CHECKs de antes, e nada novo de pe.
do $conferencia$
declare
  v_caso record;
begin
  for v_caso in
    select *
      from (values
        ('public.passar_conversa_da_ia_para_equipe(uuid,text,text)',
         'bc305ae8af0f10c98e2f181c5aa72d30', null,
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.rotulo_do_motivo_da_ia(text)',
         '0cfbd4cde199c421d3e644a2307373f9', null,
         'postgres=X/postgres,service_role=X/postgres'),
        ('public.podar_agendamento_da_ia()',
         '5db27895d8a149788f1e12dd0f3b8dbe', '7ce7fc5d49033292bbff34e091ffcf47',
         'postgres=X/postgres')
      ) as t(assinatura, md5, md5_comentario, grants)
  loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.md5
    then
      raise exception 'ROLLBACK 20261029120000: % nao voltou ao corpo de antes', v_caso.assinatura;
    end if;
    if md5(obj_description(to_regprocedure(v_caso.assinatura), 'pg_proc')) is distinct from v_caso.md5_comentario then
      raise exception 'ROLLBACK 20261029120000: o comentario de % nao e o de antes', v_caso.assinatura;
    end if;
    if (select string_agg(a::text, ',' order by a::text)
          from pg_proc p, unnest(p.proacl) a where p.oid = to_regprocedure(v_caso.assinatura))
       is distinct from v_caso.grants
    then
      raise exception 'ROLLBACK 20261029120000: os grants de % nao sao os de antes', v_caso.assinatura;
    end if;
  end loop;
  if to_regclass('public.conversa_urgente') is not null
     or to_regprocedure('public.passar_conversa_da_ia_para_equipe(uuid,text,text,boolean)') is not null
     or exists (select 1 from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname = 'urgencia_sai_quando_alguem_pega')
     or exists (select 1 from pg_trigger t where t.tgname = 'urgencia_sai_quando_alguem_pega')
     or exists (select 1 from pg_publication_tables x
                 where x.schemaname = 'public' and x.tablename = 'conversa_urgente')
  then
    raise exception 'ROLLBACK 20261029120000: um objeto da migration ficou';
  end if;
  if exists (
       select 1 from pg_constraint k
        where k.conrelid = 'public.ai_decision_log'::regclass
          and k.conname in ('ai_decision_log_escalation_reason_valida', 'ai_decision_log_gatilho_entrada_valido')
          and (position('urgencia' in pg_get_constraintdef(k.oid)) > 0
               or obj_description(k.oid, 'pg_constraint') is not null))
     or (select count(*) from pg_constraint k
          where k.conrelid = 'public.ai_decision_log'::regclass
            and ((k.conname = 'ai_decision_log_escalation_reason_valida'
                  and position('fora_do_prazo' in pg_get_constraintdef(k.oid)) > 0
                  and k.convalidated = not exists (select 1 from public.ai_decision_log d
                                                    where d.escalation_reason = 'urgencia'))
                 or (k.conname = 'ai_decision_log_gatilho_entrada_valido'
                     and position('mensagem_longa' in pg_get_constraintdef(k.oid)) > 0
                     and k.convalidated = not exists (select 1 from public.ai_decision_log d
                                                       where d.gatilho_entrada = 'urgencia')))) <> 2
  then
    raise exception 'ROLLBACK 20261029120000: os CHECKs de ai_decision_log nao sao os de antes';
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';

commit;
