-- ---------------------------------------------------------------------------
-- Urgencia e passagem da IA ao responsavel do lead (AG6a, parte de banco):
-- o motivo urgencia, a marca de conversa urgente (com o gatilho que a fecha)
-- e a atribuicao da conversa passada ao responsavel do lead
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: a IA faz todo o atendimento. D-5 (urgencia
-- com o 192: a frase do 192 e da AG6c, depois da AG7; aqui o contato recebe
-- a frase de sempre) e D-15 (a conversa passada vai ao responsavel do lead,
-- se houver; senao, a fila). Esta migration e o BANCO da etapa AG6a; o
-- codigo do agente (lib/agente, a lista de urgencia, o audio) e as telas
-- (Atendimento e Tela 6) vem em outras frentes, lendo este contrato
-- (~/.claude/plans/agente-completo/ag6/contrato.md). O audio (a
-- transcricao) nao tem nada de banco.
--
-- DECISOES DO DONO QUE VALEM: D-5, D-15, D-2, D-4 (opcao A), D-8. DECISOES
-- AINDA PENDENTES, construidas com a recomendacao do desenho (cada uma e uma
-- constante nomeada; trocar e uma migration pequena com o mesmo corpo e
-- outro valor):
--   D-52 so o portao deterministico decide a urgencia (o banco so aceita o
--        motivo e o gatilho urgencia; quem decide e o motor);
--   D-53 a conversa urgente fica marcada ate alguem assumir, transferir ou
--        resolver (o gatilho urgencia_sai_quando_alguem_pega);
--   D-54 urgente vai sempre para a fila, nunca para o responsavel
--        (c_motivos_que_nunca_atribuem em passar_conversa_da_ia_para_equipe);
--   D-55 a atribuicao e opcao da clinica (escalation_rules.passagem_para,
--        fila por padrao), so para responsavel ativo com papel que atende
--        conversa (c_papeis_que_recebem), como a mensagem agendada; a etapa
--        do lead fica em Aguardando resposta.
-- DECISOES DESTA FRENTE (fora do texto do desenho, faceis de trocar):
--   - a marca e a atribuicao rodam cada uma num begin ... exception: erro
--     vira WARNING e a passagem continua valendo (o desenho pedia isso so
--     para a atribuicao; na urgencia, falhar a passagem inteira atrasaria a
--     equipe, que e o mais importante; o evento ja diz "pode ser uma
--     emergencia");
--   - fora_do_horario tambem nunca atribui, no banco (o desenho, 1.3: a
--     retomada no horario so pega conversa sem responsavel);
--   - clinic entra no bloco de travas (SHARE ROW EXCLUSIVE: a FK da tabela
--     nova para clinic pede essa trava; fora do bloco, ela seria pedida com
--     as outras na mao);
--   - encerrada_por sem FK (como job_id: a trilha curta da marca, podada 30
--     dias depois do fim; um usuario apagado deixa o id) e nulo quando quem
--     tirou a conversa de "Aguardando voce" foi o sistema (sem sessao); por
--     isso o CHECK e "encerrada_em e encerrada_como nulos juntos, e
--     encerrada_por so com encerrada_em";
--   - a service role tambem LE a marca (os testes e o motor), e ninguem
--     grava pela API;
--   - em_atendimento sem responsavel fecha como outra; o sistema (sem sessao)
--     pondo a conversa com alguem fecha como transferida;
--   - a passagem devolve sempre as quatro chaves (nas recusas, urgente e
--     atribuida falsos); p_atribuir nulo vale como falso.
--
-- O QUE MUDA:
--   1. ai_decision_log: os CHECKs ai_decision_log_escalation_reason_valida
--      (a lista da AG4 mais urgencia) e ai_decision_log_gatilho_entrada_valido
--      (a lista de hoje mais urgencia). Drop e add do mesmo nome, NOT VALID
--      e VALIDATE (toda linha valida no antigo e valida no novo).
--   2. rotulo_do_motivo_da_ia (CREATE OR REPLACE do corpo vigente, o da
--      AG4; a AG5 nao o troca): mais urgencia.
--   3. conversa_urgente (tabela nova): a marca, uma linha por conversa (so
--      ids e instantes, nenhum dado de paciente). RLS ligada: a sessao e a
--      service role so leem (a mesma regra de conversation: membro ativo; o
--      papel profissional so a conversa que esta com ele); ninguem grava
--      pela API. Entra na publicacao do Realtime.
--   4. urgencia_sai_quando_alguem_pega (gatilho AFTER UPDATE OF status em
--      conversation, so na saida de aguardando_humano): fecha a marca aberta
--      com quem tirou e como (assumida, transferida, resolvida, outra). A
--      transicao nunca falha por causa da marca.
--   5. passar_conversa_da_ia_para_equipe ganha p_atribuir (DROP e CREATE com
--      os grants de antes: so service role; o codigo de hoje chama por nome
--      com 3 parametros e continua igual, sem atribuir). Com urgencia, a
--      marca (nunca atribui); senao, com p_atribuir e a regra da clinica, a
--      conversa fica com o responsavel do lead (update condicional: nunca
--      rouba). Devolve {passou, codigo, urgente, atribuida}.
--   6. podar_agendamento_da_ia (CREATE OR REPLACE do corpo vigente, o da
--      AG5): mais a marca encerrada ha mais de 30 dias; chave urgencias.
--   Sem mudanca: mensagem_ia_exige_aprovacao, frase_de_escalonamento_da_ia
--   (a frase de sempre), ia_tirar_conversa, ai_agent_config (a regra mora em
--   escalation_rules, jsonb que a Tela 6 ja grava por coluna), ia_uso.
--
-- AS RECUSAS da passagem (iguais as de hoje, na mesma ordem): 22023
-- motivo_invalido -> sem_posse -> (trava da conversa) -> job_antigo (D-A) ->
-- ja_fora_da_ia. Depois de passar: a marca (urgencia) ou a atribuicao.
--
-- Producao em 28/10/2026 (q.js, so leitura): a ultima migration aplicada e a
-- 20261027120000 (a AG4, 20261028100000, e a AG5, 20261029100000, vao antes
-- desta e ainda nao foram aplicadas); 3 decisoes da IA (2 com motivo,
-- nenhuma urgencia); 549 conversas (396 em "Aguardando voce"); 545 contatos,
-- NENHUM com responsavel (owner_user_id): a atribuicao nao muda nada ate
-- alguma clinica atribuir responsaveis em Leads e escolher a regra; 3
-- versoes do agente, todas com escalation_rules '{}' (fila). Nenhuma linha
-- muda de valor.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa: ai_decision_log em ACCESS EXCLUSIVE (os CHECKs), conversation
-- e clinic em SHARE ROW EXCLUSIVE (o CREATE TRIGGER e a FK da tabela nova
-- para conversation; a FK para clinic: bloqueiam ESCRITA, nao leitura).
-- Cada tentativa pede as tres com NOWAIT; com uma ocupada, solta as que
-- pegou (o savepoint do bloco), espera 100 ms SEM trava nenhuma e tenta de
-- novo, ate 30 vezes (uns 3 s); depois falha inteira com 55P03, nada
-- gravado: rodar de novo. Nunca espera trava com outra na mao e nao fecha
-- ciclo (40P01) com sessao nenhuma. Depois do bloco, so pede travas que ja
-- tem (ou mais fracas, ou da tabela nova) e nunca espera; o lock_timeout de
-- 3 s fica de rede. As funcoes sao plpgsql (o corpo nao e validado contra as
-- tabelas no CREATE: nenhuma trava nelas). Nesse tempo (milissegundos): a
-- ingestao (conversa nova, mensagem que mexe na conversa), o Assumir, o
-- Transferir, o Resolver e a passagem da IA esperam para GRAVAR em
-- conversation; o turno da IA espera ai_decision_log (gravar a decisao, e
-- a Tela 6 e o Atendimento leem as decisoes); a gravacao de dados da clinica
-- espera. A LEITURA de conversation e de clinic segue. ZERO ALTER em
-- message, contact, job_queue, audit_log, ia_atendimento e ai_agent_config.
-- No ensaio na producao, o CREATE TRIGGER segura a escrita em conversation
-- durante o ensaio inteiro: janela calma, poucos ensaios.
--
-- ORDEM DE PUBLICACAO: a AG5 aplicada e publicada antes; esta migration
-- (ensaio na producao, ENSAIO OK, md5); os tipos
-- (lib/supabase/database.types.ts foi escrito a mao no formato do gerador;
-- regenerar depois de aplicar); as provas de banco na producao (clinicas
-- e_de_teste); e SO DEPOIS o codigo da AG6a. Esta migration com o codigo de
-- hoje: nada muda (a passagem chamada com 3 parametros nao atribui e devolve
-- o passou e o codigo de hoje, com duas chaves a mais que ninguem le; o
-- codigo de hoje nunca manda urgencia; os CHECKs so acrescentam; a tabela
-- nova fica vazia; o gatilho novo so roda na saida de "Aguardando voce" e
-- nao acha linha; a poda devolve uma chave a mais). O codigo da AG6a antes
-- desta migration (NUNCA): p_atribuir da PGRST202 e toda passagem com frase
-- falha (o job tenta de novo e a varredura de 3 minutos devolve a conversa
-- sem frase); urgencia da 23514 na decisao e 22023 no rotulo; a lista do
-- Atendimento com o embutido de conversa_urgente cai no erro. Os espelhos
-- (tests/unit/ia-whatsapp/espelhos.test.ts e tests/unit/agente/config.test.ts)
-- leem o CHECK e o rotulo DESTA migration: urgencia entra em
-- MOTIVOS_DE_ESCALONAMENTO e em TEXTO_DO_EVENTO_DA_IA no mesmo commit.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo da AG6a; DEPOIS, numa
-- transacao, no SQL editor,
-- supabase/operacao/rollback/20261029120000-corpos-anteriores.sql (a
-- passagem de 3 parametros e os corpos de antes do rotulo e da poda, com os
-- comentarios e os grants; o gatilho, a funcao dele e a tabela saem, a
-- tabela antes tirada da publicacao; os CHECKs de antes, NOT VALID se ja
-- houver decisao com urgencia; confere no fim). SE PERDE: as marcas
-- (abertas e encerradas). Ficam: as decisoes com urgencia, os eventos no fio
-- e as conversas que ja ficaram com o responsavel.
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
      lock table public.ai_decision_log in access exclusive mode nowait;
      lock table public.conversation, public.clinic in share row exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261029120000: ai_decision_log, conversation ou clinic seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) ai_decision_log: o motivo e o gatilho urgencia
-- ---------------------------------------------------------------------------
-- Os CHECKs de hoje inteiros (escalation_reason: o da AG4,
-- 20261028100000, que a AG5 nao troca; gatilho_entrada: o de
-- 20261006100000), mais urgencia. Drop e add com o MESMO nome, NOT VALID (o
-- add nao varre a tabela) e VALIDATE em seguida.

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

alter table public.ai_decision_log
  validate constraint ai_decision_log_escalation_reason_valida;

alter table public.ai_decision_log
  drop constraint ai_decision_log_gatilho_entrada_valido;

alter table public.ai_decision_log
  add constraint ai_decision_log_gatilho_entrada_valido
    check (gatilho_entrada is null or gatilho_entrada in (
      'sintoma', 'assunto_clinico', 'pedido_humano', 'insatisfacao',
      'menor_de_idade', 'valor_fora_da_tabela', 'manipulacao', 'midia',
      'mensagem_longa', 'urgencia')) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_gatilho_entrada_valido;

comment on constraint ai_decision_log_escalation_reason_valida on public.ai_decision_log is
  'Os motivos da passagem para a equipe (espelho: MOTIVOS_DE_ESCALONAMENTO em lib/domain/agente/config.ts). AG6a: mais urgencia (o portao achou sinal de emergencia; a conversa vai para a fila marcada como urgente, conversa_urgente).';
comment on constraint ai_decision_log_gatilho_entrada_valido on public.ai_decision_log is
  'Os gatilhos do portao de entrada (espelho: GATILHOS_DE_ENTRADA em lib/domain/conformidade/categorias.ts). AG6a: mais urgencia (a lista curta e deterministica de sinais de emergencia, antes do teto, da reserva e de qualquer modelo).';

-- ---------------------------------------------------------------------------
-- 2) rotulo_do_motivo_da_ia: mais urgencia
-- ---------------------------------------------------------------------------
-- O corpo vigente (o da AG4, 20261028100000), com o trecho [AG6 urgencia].

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
$function$;

-- ---------------------------------------------------------------------------
-- 3) conversa_urgente: a marca da conversa urgente
-- ---------------------------------------------------------------------------

create table public.conversa_urgente (
  conversation_id uuid primary key
    constraint conversa_urgente_conversation_id_fkey references public.conversation (id) on delete cascade,
  clinic_id uuid not null
    constraint conversa_urgente_clinic_id_fkey references public.clinic (id) on delete cascade,
  desde timestamptz not null,
  job_id uuid not null,
  encerrada_em timestamptz,
  encerrada_por uuid,
  encerrada_como text,
  constraint conversa_urgente_como_valido check (
    encerrada_como is null or encerrada_como in ('assumida', 'transferida', 'resolvida', 'outra')),
  constraint conversa_urgente_encerramento_coerente check (
    (encerrada_em is null) = (encerrada_como is null)
    and (encerrada_por is null or encerrada_em is not null))
);

-- As abertas da clinica: a lista do Atendimento, o contador do menu e o
-- aviso na tela.
create index conversa_urgente_aberta_idx
  on public.conversa_urgente (clinic_id)
  where encerrada_em is null;

alter table public.conversa_urgente enable row level security;

-- Ninguem grava pela API: so a passagem (passar_conversa_da_ia_para_equipe)
-- e o gatilho (urgencia_sai_quando_alguem_pega), SECURITY DEFINER. A sessao
-- e a service role so leem.
revoke all on table public.conversa_urgente from public, anon, authenticated, service_role;
grant select on table public.conversa_urgente to authenticated, service_role;

-- A mesma regra de leitura de conversation: membro ativo da clinica; o papel
-- profissional so a marca da conversa que esta com ele.
create policy "membro ativo le a marca de urgencia conforme papel"
  on public.conversa_urgente
  for select
  to authenticated
  using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
         where c.id = conversa_urgente.conversation_id
           and c.assignee_user_id = auth.uid()
      )
    )
  );

comment on table public.conversa_urgente is
  'A marca da conversa urgente (AG6a, D-5, D-53, D-54): uma linha por conversa. Nasce (ou reabre) quando a IA passa a conversa para a equipe com o motivo urgencia (passar_conversa_da_ia_para_equipe: desde = now(), o job, encerrada_* nulos); fecha quando a conversa sai de "Aguardando voce" (gatilho urgencia_sai_quando_alguem_pega: assumida, transferida, resolvida ou outra). ABERTA = encerrada_em nulo (indice conversa_urgente_aberta_idx). Nenhum dado de paciente (ids e instantes). RLS: a regra de leitura de conversation (membro ativo; o profissional so a conversa com ele); a sessao e a service role so leem; ninguem grava pela API. No Realtime (supabase_realtime). Podada 30 dias depois de encerrada (podar_agendamento_da_ia); a aberta nunca.';
comment on column public.conversa_urgente.conversation_id is
  'A conversa marcada (PK: uma marca por conversa; FK em cascata). Embutido 1 para 1 na lista do Atendimento: conversation.select(''..., conversa_urgente ( desde, encerrada_em )'').';
comment on column public.conversa_urgente.clinic_id is
  'A clinica da conversa (sempre a da conversa: so a passagem grava, lendo da conversa). A RLS e o indice das abertas usam esta coluna.';
comment on column public.conversa_urgente.desde is
  'O now() da ultima passagem por urgencia (a ordem das urgentes no topo da lista, D-53).';
comment on column public.conversa_urgente.job_id is
  'O job responder_com_ia que passou a conversa por urgencia (a decisao em ai_decision_log tem o mesmo job_id). Sem FK: a fila e podada.';
comment on column public.conversa_urgente.encerrada_em is
  'Quando a conversa saiu de "Aguardando voce" (a marca fechou). Nulo: a marca esta ABERTA.';
comment on column public.conversa_urgente.encerrada_por is
  'auth.uid() de quem tirou a conversa de "Aguardando voce" (Assumir, Transferir, Resolver). Nulo quando foi o sistema, sem sessao. Sem FK.';
comment on column public.conversa_urgente.encerrada_como is
  'Como a marca fechou: assumida (em atendimento com quem tirou), transferida (em atendimento com outra pessoa, inclusive pelo sistema), resolvida, ou outra (de volta para a IA, ou em atendimento sem responsavel). Nulo junto com encerrada_em.';

-- O Realtime: o Atendimento e o contador do menu (o mesmo bloco idempotente
-- das outras tabelas).
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public'
                     and tablename = 'conversa_urgente') then
      alter publication supabase_realtime add table public.conversa_urgente;
    end if;
  end if;
end;
$realtime$;

-- ---------------------------------------------------------------------------
-- 4) O gatilho que fecha a marca
-- ---------------------------------------------------------------------------

create function public.urgencia_sai_quando_alguem_pega()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_quem uuid;
  v_como text;
begin
  -- A transicao da conversa nunca falha por causa da marca: qualquer erro
  -- vira so um aviso, sem dado de paciente (a clinica e o SQLSTATE).
  begin
    v_quem := auth.uid();
    v_como := case
      when new.status = 'em_atendimento' and new.assignee_user_id is not null
           and new.assignee_user_id = v_quem then 'assumida'
      when new.status = 'em_atendimento' and new.assignee_user_id is not null then 'transferida'
      when new.status = 'resolvida' then 'resolvida'
      else 'outra'
    end;
    update public.conversa_urgente u
       set encerrada_em = now(),
           encerrada_por = v_quem,
           encerrada_como = v_como
     where u.conversation_id = new.id
       and u.encerrada_em is null;
  exception when others then
    raise warning 'a marca de urgencia nao fechou (clinic %): %', new.clinic_id, sqlstate;
  end;
  return null;
end;
$function$;

revoke all on function public.urgencia_sai_quando_alguem_pega()
  from public, anon, authenticated, service_role;

comment on function public.urgencia_sai_quando_alguem_pega() is
  'Funcao do gatilho urgencia_sai_quando_alguem_pega de conversation (AG6a, D-53): quando a conversa sai de "Aguardando voce", fecha a marca ABERTA de conversa_urgente (encerrada_em = now(), encerrada_por = auth.uid(), nulo sem sessao) como assumida (em_atendimento com quem tirou), transferida (em_atendimento com outra pessoa, inclusive pelo sistema), resolvida, ou outra (o resto). A marca ja encerrada nao muda. Qualquer erro vira WARNING com a clinica e o SQLSTATE: a transicao nunca falha por causa da marca. Ninguem executa direto.';

create trigger urgencia_sai_quando_alguem_pega
  after update of status on public.conversation
  for each row
  when (old.status = 'aguardando_humano' and new.status <> 'aguardando_humano')
  execute function public.urgencia_sai_quando_alguem_pega();

comment on trigger urgencia_sai_quando_alguem_pega on public.conversation is
  'AG6a (D-53): a marca de urgencia sai quando alguem pega a conversa (Assumir, Transferir, Resolver, ou ela volta para a IA). So na saida de aguardando_humano; um update com a marca de uma linha (indice da PK). Roda depois de passagem_da_ia_move_o_lead (ordem alfabetica), que tem outro WHEN. A transicao nunca falha por causa da marca.';

-- ---------------------------------------------------------------------------
-- 5) A passagem: a marca de urgencia e a atribuicao ao responsavel do lead
-- ---------------------------------------------------------------------------
-- DROP e CREATE (o parametro novo muda a assinatura). O codigo de hoje chama
-- por nome com 3 parametros: cai nesta, com p_atribuir falso, e le so passou
-- e codigo. O corpo de antes (M1, 20261013100000, igual ao de producao lido
-- com fndef.js em 28/10/2026, md5 bc305ae8af0f10c98e2f181c5aa72d30) inteiro,
-- com as chaves novas no retorno e o trecho [AG6 passagem] depois de passar.

drop function public.passar_conversa_da_ia_para_equipe(uuid, text, text);

create function public.passar_conversa_da_ia_para_equipe(
  p_job_id uuid, p_worker text, p_motivo text, p_atribuir boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  -- D-54 (urgente vai sempre para a fila) e a retomada no horario (so pega
  -- conversa sem responsavel): estes motivos nunca atribuem.
  c_motivos_que_nunca_atribuem constant text[] := array['urgencia', 'fora_do_horario'];
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
  v_urgente boolean := false;
  v_atribuida boolean := false;
  v_regra text;
  v_responsavel uuid;
  v_nome text;
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
    return jsonb_build_object('passou', false, 'codigo', 'sem_posse', 'urgente', false, 'atribuida', false);
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
    return jsonb_build_object('passou', false, 'codigo', 'job_antigo', 'urgente', false, 'atribuida', false);
  end if;

  if not public.ia_tirar_conversa(v_conversa, p_motivo, true) then
    return jsonb_build_object('passou', false, 'codigo', 'ja_fora_da_ia', 'urgente', false, 'atribuida', false);
  end if;

  -- [AG6 passagem] inicio
  -- A conversa passou ("Aguardando voce", o evento do motivo, os pendentes
  -- cancelados, o gatilho do funil) e segue travada por esta transacao.
  -- Depois disso, so leituras (configuracao, contato, membro, perfil) e as
  -- escritas da marca ou da atribuicao. Nenhuma das duas derruba a passagem:
  -- erro vira WARNING (a clinica e o SQLSTATE) e a conversa fica na fila.
  if p_motivo = 'urgencia' then
    -- A marca (D-53): nasce, ou reabre a encerrada de antes. Nunca atribui.
    begin
      insert into public.conversa_urgente as u (conversation_id, clinic_id, desde, job_id)
      values (v_conversa, v_clinica, now(), p_job_id)
      on conflict (conversation_id) do update
         set clinic_id = excluded.clinic_id,
             desde = excluded.desde,
             job_id = excluded.job_id,
             encerrada_em = null,
             encerrada_por = null,
             encerrada_como = null;
      v_urgente := true;
    exception when others then
      v_urgente := false;
      raise warning 'a passagem por urgencia nao marcou a conversa (clinic %): %', v_clinica, sqlstate;
    end;
  elsif coalesce(p_atribuir, false) and not (p_motivo = any (c_motivos_que_nunca_atribuem)) then
    -- D-15 e D-55: a conversa fica com o responsavel do lead, como a
    -- mensagem agendada (so a conversa aguardando e sem atendente: nunca
    -- rouba de quem pegou no meio).
    begin
      -- A regra da ULTIMA versao publicada (a que o agente le no WhatsApp).
      select a.escalation_rules ->> 'passagem_para' into v_regra
        from public.ai_agent_config a
       where a.clinic_id = v_clinica
         and a.status = 'publicada'
       order by a.version desc
       limit 1;
      if v_regra is not distinct from c_regra_do_responsavel then
        select k.owner_user_id into v_responsavel
          from public.conversation c
          join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
         where c.id = v_conversa;
        if v_responsavel is not null and exists (
             select 1 from public.clinic_member m
              where m.clinic_id = v_clinica
                and m.user_id = v_responsavel
                and m.status = 'ativo'
                and m.role = any (c_papeis_que_recebem))
        then
          update public.conversation c
             set status = 'em_atendimento',
                 assignee_user_id = v_responsavel
           where c.id = v_conversa
             and c.clinic_id = v_clinica
             and c.status = 'aguardando_humano'
             and c.assignee_user_id is null;
          if found then
            -- O nome em uma linha (espacos, tabulacoes e quebras viram um
            -- espaco), ate c_limite_do_nome; sem perfil ou vazio, o generico.
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
            v_atribuida := true;
          end if;
        end if;
      end if;
    exception when others then
      v_atribuida := false;
      raise warning 'a passagem nao atribuiu ao responsavel (clinic %): %', v_clinica, sqlstate;
    end;
  end if;
  -- [AG6 passagem] fim

  return jsonb_build_object('passou', true, 'codigo', 'passou', 'urgente', v_urgente, 'atribuida', v_atribuida);
end;
$function$;

revoke execute on function public.passar_conversa_da_ia_para_equipe(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.passar_conversa_da_ia_para_equipe(uuid, text, text, boolean)
  to service_role;

comment on function public.passar_conversa_da_ia_para_equipe(uuid, text, text, boolean) is
  'So o servidor (service_role; o executor da IA). O job (com posse) passa a conversa para a equipe ("Aguardando voce", o evento do motivo, os pendentes cancelados). Recusas na ordem: 22023 motivo_invalido; {passou:false, codigo:sem_posse}; (trava da conversa) {codigo:job_antigo} (D-A: job de antes da janela atual); {codigo:ja_fora_da_ia}. AG6a: com p_motivo urgencia, a marca em conversa_urgente (nasce ou reabre; nunca atribui). Senao, com p_atribuir verdadeiro (nulo = falso), motivo fora de urgencia e fora_do_horario, a ULTIMA versao publicada com escalation_rules ->> passagem_para = responsavel_do_lead e o owner_user_id do contato membro ativo da clinica com papel admin, gestor, recepcao ou profissional: a conversa vira em_atendimento com ele (update so de aguardando_humano sem responsavel: nunca rouba) e o evento "A conversa ficou com {nome}, responsavel pelo lead." (profile.name em uma linha, ate 80; sem nome, "A conversa ficou com o responsavel pelo lead."). A marca e a atribuicao nunca derrubam a passagem (erro vira WARNING). Devolve sempre {passou, codigo, urgente, atribuida}. Chamar por nome; com 3 parametros (o codigo de antes da AG6a), nunca atribui.';

-- ---------------------------------------------------------------------------
-- 6) A poda, com a marca de urgencia encerrada
-- ---------------------------------------------------------------------------
-- O corpo vigente (o da AG5, 20261029100000), com o trecho [AG6 urgencia].

create or replace function public.podar_agendamento_da_ia()
returns jsonb
language plpgsql
set search_path = ''
as $$
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
$$;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3), do pedido da lista de espera (AG5) e da marca de urgencia (AG6a). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. ia_pedido_de_espera: o vivo (sem consumo) com 7 dias ou da conversa que sumiu; o consumido com 30 dias. conversa_urgente: a marca encerrada ha mais de 30 dias (a aberta nunca). Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados, pedidos_de_espera, urgencias}.';

notify pgrst, 'reload schema';
