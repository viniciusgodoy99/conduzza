-- ---------------------------------------------------------------------------
-- Midia na conversa com a IA (AG6b, parte de banco): a leitura do audio, da
-- imagem e do documento, o aviso novo dos telefones da equipe, o gasto da
-- transcricao e do leitor, e a passagem e a atribuicao com a midia
-- ---------------------------------------------------------------------------
-- Decisoes do dono (28/10/2026): D-56 ("Pode usar o whisper": a transcricao
-- e nossa, pela API de transcricao da OpenAI, no nosso servidor; a uazapi
-- nunca mais transcreve) e D-14/D-58 ("Ta confirmado": so o leitor de midia
-- ve o arquivo, com saida fechada; resultado, laudo, receita, foto do corpo,
-- carteirinha, guia e documento pessoal vao para a equipe). As outras
-- (D-90 a D-101) seguem a recomendacao do desenho
-- (~/.claude/plans/agente-completo/ag6/desenho-ag6b.md, secoes 3, 7, 9 e
-- 11), cada uma uma constante nomeada. Esta migration e o BANCO da AG6b; o
-- motor (a transcricao, o leitor, o plano da midia) e as telas (Tela 6 e
-- Atendimento) vem em outras frentes, lendo o contrato
-- (~/.claude/plans/agente-completo/ag6/contrato-ag6b.md).
--
-- DECISOES DESTA FRENTE (fora do texto do desenho, faceis de trocar):
--   - ligar um telefone SEM a confirmacao do aviso ("Ligar de novo", ou so o
--     rotulo) deixa a versao do aviso como estava se o telefone estava
--     ligado, e volta a 1 se estava desligado (o lado seguro, mesmo que a
--     linha tenha sido desligada sem a funcao);
--   - na leitura, o resumo e obrigatorio na imagem e no documento, menos na
--     figurinha (a tabela 1.2 do desenho: toda leitura de arquivo tem um
--     resumo na bolha, menos a figurinha, que nao tem linha); a confianca e
--     obrigatoria na imagem e no documento (a figurinha local grava alta);
--     o pedido tem pelo menos um item ou fora_do_cadastro >= 1; a
--     transcricao e o resumo nunca em branco;
--   - "sem repetido" num CHECK pede funcao (subconsulta nao vale em CHECK):
--     ia_lista_sem_repetido(uuid[]), imutavel, que ninguem da API executa;
--   - a gravacao trava a mensagem SO se ela e da conversa e da clinica do
--     job (a mensagem de outra clinica nunca fica travada por esta funcao);
--   - a policy de leitura le message (a mensagem nao apagada, defesa em
--     profundidade): o parse dela pega ACCESS SHARE em message, que entra
--     no bloco de travas com NOWAIT (nunca esperar com trava na mao); nao
--     bloqueia leitura nem escrita em message;
--   - a atribuicao conta a midia lida que foi apagada depois (a leitura saiu
--     com ela): o lado seguro (a fila);
--   - as recusas devolvem sempre {ok:false, motivo}; a reutilizada devolve
--     tambem o id.
--
-- O QUE MUDA:
--   1. ai_decision_log: o CHECK ai_decision_log_escalation_reason_valida (a
--      lista da AG6a, com urgencia) mais midia_clinica, documento_do_paciente
--      e midia_nao_identificada. Drop e add do mesmo nome, NOT VALID e
--      VALIDATE (toda linha valida no antigo e valida no novo).
--      gatilho_entrada nao muda (o leitor nao e o portao).
--   2. rotulo_do_motivo_da_ia (CREATE OR REPLACE do corpo da AG6a): os tres
--      motivos novos.
--   3. ia_uso: o CHECK ia_uso_papel_valido mais transcricao e leitor_de_midia
--      (NOT VALID e VALIDATE). Nenhuma coluna nova.
--   4. llm_preco: a coluna audio_microdolar_por_minuto (default 0) e a linha
--      whisper-1 (os precos de token 0; US$ 0,006 por minuto, da pagina
--      oficial de precos da OpenAI, consultada em 30/10/2026).
--   5. ia_contato_liberado: a coluna aviso_da_openai_versao (1 o aviso de
--      hoje, 2 o aviso com audio, foto e documento; default 1).
--   6. definir_contato_liberado_da_ia: DROP e CREATE com o parametro novo
--      p_versao_do_aviso (default 1) no fim; o corpo de producao inteiro, os
--      mesmos grants; a versao gravada e a trilha com detalhes {versao}.
--   7. midia_da_ia_liberada (nova, so service role): o telefone da equipe,
--      ligado, com o aviso novo (versao 2). Nesta entrega nao ha outro
--      caminho (D-95).
--   8. ia_leitura_da_midia (tabela nova): a transcricao e a leitura, uma
--      linha por mensagem, imutavel, RLS da mensagem, so a RPC grava; fora do
--      Realtime. Sem FK para message (nao trava message): a RPC confere a
--      mensagem, o apagamento e a poda tiram a linha.
--   9. gravar_leitura_da_midia (nova, so service role): a gravacao, com a
--      posse do job, a trava da mensagem antes da trava da conversa, D-A, a
--      conversa com a IA, a mensagem lida pelo job, a habilidade publicada,
--      o aviso do telefone e o Cadastro. Idempotente pela mensagem.
--  10. arquivar_e_limpar_mensagem (CREATE OR REPLACE do corpo de producao):
--      a mensagem apagada leva a leitura, DEPOIS do update da mensagem.
--  11. atribuir_conversa_passada_pela_ia (CREATE OR REPLACE do corpo FINAL da
--      AG6a): midia_clinica e midia_nao_identificada nunca atribuem; a
--      recusa nova midia_nao_lida (D-96).
--  12. podar_agendamento_da_ia (CREATE OR REPLACE do corpo da AG6a): mais a
--      leitura com mais de 90 dias e a da mensagem apagada; chave leituras.
--   Sem mudanca: message (nenhuma coluna, nenhum gatilho),
--   passar_conversa_da_ia_para_equipe, mensagem_ia_exige_aprovacao,
--   frase_de_escalonamento_da_ia, acertar_gasto_da_ia, reservar_gasto_da_ia,
--   ia_pode_falar_com, apagar_mensagem, registrar_apagamento_do_whatsapp,
--   ai_agent_config (as chaves skills.ler_audio e
--   skills.ler_imagem_e_documento moram no jsonb que a Tela 6 ja grava),
--   ia_requisito_da_producao (D-94: a chave transcricao_com_nossa_chave
--   fica), a publicacao do Realtime, as policies do Storage.
--
-- AS RECUSAS de gravar_leitura_da_midia, na ordem: 22004 parametro_nulo ->
-- 22023 (midia_invalida, tipo_invalido, transcricao_invalida,
-- segundos_invalidos, itens_invalidos, fora_do_cadastro_invalido,
-- confianca_invalida, resumo_invalido, modelo_invalido, versao_invalida) ->
-- sem_posse -> (trava da mensagem, depois da conversa) -> job_antigo ->
-- fora_da_ia -> mensagem_invalida -> mensagem_nao_lida -> leitura_desligada
-- -> midia_bloqueada -> procedimento_invalido -> {ok, reutilizado} ou
-- {ok, id}.
-- AS RECUSAS da atribuicao, na ordem: sem_posse -> (trava da conversa) ->
-- job_antigo -> sem_passagem -> motivo_nao_atribui -> fora_da_fila ->
-- com_responsavel -> urgente -> mensagem_nova -> midia_nao_lida ->
-- regra_fila -> sem_responsavel -> responsavel_inapto; qualquer erro: erro.
--
-- Producao em 30/10/2026 (q.js e fndef.js, so leitura): a ultima migration
-- aplicada e a 20261028100000 (a AG4); a AG5 (20261029100000) e a AG6a
-- (20261029120000) vao antes desta e ainda nao foram aplicadas. Corpos que
-- esta migration troca, por md5 de prosrc (o ensaio confere de novo, na
-- hora): arquivar_e_limpar_mensagem 9a949b8acd0d38c72adc498efbddb4bd e
-- definir_contato_liberado_da_ia 88c5fa98f271c16cf783acffba347179 (os de
-- producao); atribuir_conversa_passada_pela_ia, rotulo_do_motivo_da_ia e
-- podar_agendamento_da_ia os da AG6a final (migration md5
-- 7ada4024c0d34c12907eb74d5b67a048). Nos ultimos 30 dias: 772 audios de
-- paciente, todos audio/mpeg, nenhum com transcricao; 2 telefones na lista
-- da equipe; 7 linhas em ia_uso; 5 linhas em llm_preco. Nenhuma linha muda
-- de valor.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa: ai_decision_log e ia_uso em ACCESS EXCLUSIVE (os CHECKs),
-- llm_preco e ia_contato_liberado em ACCESS EXCLUSIVE (a coluna nova com
-- default constante e CHECK; tabelas frias, 5 e 2 linhas), clinic e
-- conversation em SHARE ROW EXCLUSIVE (as FKs da tabela nova: bloqueiam
-- ESCRITA, nao leitura; conversation e a quente) e message em ACCESS SHARE
-- (so o parse da policy; nao bloqueia leitura nem escrita). Cada tentativa
-- pede todas com NOWAIT; com uma ocupada, solta as que pegou (o savepoint do
-- bloco), espera 100 ms SEM trava nenhuma e tenta de novo, ate 30 vezes (uns
-- 3 s); depois falha inteira com 55P03, nada gravado: rodar de novo. Nunca
-- espera trava com outra na mao e nao fecha ciclo (40P01) com sessao
-- nenhuma. Depois do bloco, so pede travas que ja tem (ou mais fracas, ou da
-- tabela nova) e nunca espera; o lock_timeout de 3 s fica de rede. As
-- funcoes que leem tabela sao plpgsql (o corpo nao e validado contra as
-- tabelas no CREATE), menos midia_da_ia_liberada (sql, so le
-- ia_contato_liberado, ja travada). Nesse tempo (milissegundos): o turno da
-- IA espera ai_decision_log e ia_uso (gravar a decisao e o gasto) e a
-- liberacao do telefone; a ingestao, o Assumir, o Transferir, o Resolver e a
-- passagem esperam para GRAVAR em conversation; a gravacao de dados da
-- clinica espera. A LEITURA de conversation e de clinic segue; message segue
-- inteira. ZERO trava em contact, job_queue, audit_log, ia_atendimento,
-- ai_turno, procedure e ai_agent_config. No ensaio na producao, a FK segura a
-- escrita em conversation durante o ensaio inteiro: janela calma, poucos
-- ensaios.
--
-- ORDEM DE PUBLICACAO: a AG5 e a AG6a aplicadas e publicadas antes; esta
-- migration (ensaio na producao, ENSAIO OK, md5); os tipos
-- (lib/supabase/database.types.ts foi escrito a mao no formato do gerador;
-- regenerar depois de aplicar); as provas de banco na producao (clinicas
-- e_de_teste, com a licao de 30/10/2026); e SO DEPOIS o codigo da AG6b. Esta
-- migration com o codigo de antes (o main com a AG6a): quase nada muda (a
-- tabela e as RPCs novas ficam sem chamador; os CHECKs so acrescentam; a
-- coluna e a linha de llm_preco nao pesam: o lerPrecos de hoje acha uma
-- linha com tokens 0 que nenhum modelo do agente usa; o telefone nasce 1 e o
-- formulario de hoje grava 1; o apagamento apaga leitura que nao existe; a
-- poda devolve uma chave a mais). MUDA, para o lado seguro: a atribuicao
-- recusa midia_nao_lida quando o job leu audio, imagem ou documento (o motor
-- de hoje so loga o codigo desconhecido, e a conversa fica na fila) e nao
-- atribui midia_clinica nem midia_nao_identificada (que o codigo de hoje nem
-- grava). O codigo da AG6b antes desta migration (NUNCA):
-- midia_da_ia_liberada da PGRST202 e o motor marca toda midia fora (nada sai
-- a OpenAI); a leitura das leituras no fio falha ("Leitura do assistente
-- indisponivel agora."); a action do telefone com p_versao_do_aviso da
-- PGRST202. Os espelhos (tests/unit/ia-whatsapp/espelhos.test.ts e
-- tests/unit/agente/config.test.ts) leem o CHECK, o rotulo e a atribuicao
-- DESTA migration.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo da AG6b; DEPOIS, numa
-- transacao, no SQL editor,
-- supabase/operacao/rollback/20261030100000-corpos-anteriores.sql (as RPCs
-- novas e a tabela saem; definir_contato_liberado_da_ia volta aos 7
-- parametros com o corpo e o comentario de antes; as duas colunas saem; os
-- corpos de antes do apagamento, da atribuicao, do rotulo e da poda; os
-- CHECKs de antes, NOT VALID se ja houver linha com valor novo; a linha
-- whisper-1 de llm_preco sai sempre, e as linhas dela em ia_uso ficam;
-- confere no fim). O rollback recusa se houve uso do whisper-1 nos ultimos
-- 15 minutos (sinal do codigo da AG6b ainda no ar), mas enquanto
-- TRANSCRICAO_CALIBRADA for falsa nenhum uso acontece e essa trava nao ve o
-- codigo no ar: a ordem acima e a unica protecao. SE PERDE:
-- as transcricoes e as leituras, e a versao do aviso dos telefones (todos
-- voltam ao aviso de hoje). Ficam: as decisoes com os motivos novos, os
-- eventos no fio, o gasto em ia_uso e a trilha.
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
      lock table public.ai_decision_log, public.ia_uso in access exclusive mode nowait;
      lock table public.llm_preco, public.ia_contato_liberado in access exclusive mode nowait;
      lock table public.clinic, public.conversation in share row exclusive mode nowait;
      lock table public.message in access share mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261030100000: ai_decision_log, ia_uso, llm_preco, ia_contato_liberado, clinic, conversation ou message seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) ai_decision_log: os tres motivos da midia
-- ---------------------------------------------------------------------------
-- O CHECK da AG6a inteiro (a lista da AG4 mais urgencia), mais os tres. Drop
-- e add com o MESMO nome, NOT VALID (o add nao varre a tabela) e VALIDATE em
-- seguida. gatilho_entrada nao muda.

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
      'fora_do_prazo', 'urgencia',
      'midia_clinica', 'documento_do_paciente', 'midia_nao_identificada')) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_escalation_reason_valida;

comment on constraint ai_decision_log_escalation_reason_valida on public.ai_decision_log is
  'Os motivos da passagem para a equipe (espelho: MOTIVOS_DE_ESCALONAMENTO em lib/domain/agente/config.ts). AG6a: mais urgencia (o portao achou sinal de emergencia; a conversa vai para a fila marcada como urgente, conversa_urgente). AG6b: mais midia_clinica (resultado, laudo, receita ou foto do corpo), documento_do_paciente (carteirinha, guia ou documento pessoal) e midia_nao_identificada (o leitor de midia nao identificou o arquivo, o pedido tem item fora do Cadastro ou a leitura nao foi segura).';

-- ---------------------------------------------------------------------------
-- 2) rotulo_do_motivo_da_ia: os tres motivos da midia
-- ---------------------------------------------------------------------------
-- O corpo da AG6a (20261029120000), com o trecho [AG6b midia].

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
    -- [AG6b midia] inicio
    when 'midia_clinica' then 'A IA passou a conversa para a equipe: o paciente mandou um arquivo que só a equipe pode avaliar.'
    when 'documento_do_paciente' then 'A IA passou a conversa para a equipe: o paciente mandou a carteirinha, uma guia do convênio ou um documento pessoal.'
    when 'midia_nao_identificada' then 'A IA passou a conversa para a equipe: o assistente não identificou o arquivo que o paciente mandou.'
    -- [AG6b midia] fim
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
-- 3) ia_uso: os dois papeis da midia
-- ---------------------------------------------------------------------------
-- O CHECK de hoje (20261006100000) mais transcricao e leitor_de_midia. Drop e
-- add com o MESMO nome, NOT VALID e VALIDATE. Nenhuma coluna nova: a linha da
-- transcricao grava os tokens 0 e o custo calculado pelo codigo (os segundos
-- ficam na leitura, ia_leitura_da_midia).

alter table public.ia_uso
  drop constraint ia_uso_papel_valido;

alter table public.ia_uso
  add constraint ia_uso_papel_valido
    check (papel in ('agente', 'verificador', 'classificador',
                     'transcricao', 'leitor_de_midia')) not valid;

alter table public.ia_uso
  validate constraint ia_uso_papel_valido;

comment on constraint ia_uso_papel_valido on public.ia_uso is
  'Os papeis do modelo no livro de gasto (espelho: PapelDoModelo em lib/agente/uso.ts). AG6b: mais transcricao (o whisper-1, pela API de transcricao: tokens 0, o custo pelo minuto de audio de llm_preco) e leitor_de_midia (a imagem ou o documento, pela Responses API).';

comment on table public.ia_uso is
  'Livro de gasto da IA: uma linha por chamada ao modelo (origem whatsapp, simulador ou avaliacao; papel agente, verificador, classificador, transcricao ou leitor_de_midia). custo_microdolar calculado pelo codigo a partir de llm_preco (na transcricao, pelo minuto de audio). So o sistema escreve; o super admin le. A soma das ultimas 24 horas (janela movel) contra ia_liberacao.teto_diario_centavos_usd entra em ia_pode_atender. job_id sem FK (a fila e podada).';

-- ---------------------------------------------------------------------------
-- 4) llm_preco: o preco por minuto de audio e a linha do whisper-1
-- ---------------------------------------------------------------------------
-- Fonte (CLAUDE.md, secao 7: nunca um valor plausivel): a tabela oficial de
-- precos da OpenAI (developers.openai.com/api/docs/pricing), consultada em
-- 30/10/2026, secao "Transcription models", linha "Whisper": "$0.006 /
-- minute"; a pagina do modelo (developers.openai.com/api/docs/models/
-- whisper-1) diz o mesmo. US$ 0,006 por minuto = 6.000 microdolares por
-- minuto. A mesma documentacao marca o whisper-1 como Deprecated, com
-- remocao da API em 26/02/2027 (developers.openai.com/api/docs/deprecations,
-- aviso de 26/08/2026): fica registrado na fonte da linha.

alter table public.llm_preco
  add column audio_microdolar_por_minuto bigint not null default 0
    constraint llm_preco_audio_valido check (audio_microdolar_por_minuto >= 0);

comment on column public.llm_preco.audio_microdolar_por_minuto is
  'AG6b: o preco da transcricao, em microdolar por minuto de audio (0 nos modelos de texto). O custo de uma transcricao e ceil(segundos x audio_microdolar_por_minuto / 60). O motor le esta coluna numa consulta propria e tolerante (sem ela, nenhum audio sai).';

insert into public.llm_preco (
  modelo,
  entrada_microdolar_por_milhao,
  saida_microdolar_por_milhao,
  cache_leitura_microdolar_por_milhao,
  cache_escrita_microdolar_por_milhao,
  vigente_desde,
  fonte,
  audio_microdolar_por_minuto
) values
  ('whisper-1', 0, 0, 0, 0, date '2026-10-30',
   'Tabela de precos da OpenAI, developers.openai.com/api/docs/pricing (consultada em 30/10/2026), Transcription models, Whisper: US$ 0,006 por minuto de audio (o mesmo em developers.openai.com/api/docs/models/whisper-1); sem preco por token. Modelo marcado Deprecated, remocao da API em 26/02/2027 (developers.openai.com/api/docs/deprecations)',
   6000);

comment on table public.llm_preco is
  'Preco por modelo de linguagem, em microdolar por milhao de tokens (entrada comum, saida com o raciocinio, leitura e escrita de cache) e, na transcricao, microdolar por minuto de audio (audio_microdolar_por_minuto). Global, sem clinic_id, como message_pricing: o preco vive em tabela, nunca no codigo. fonte diz de onde veio o numero. Provedor em uso: OpenAI (gpt-6-luna e gpt-6.1-sol, faixa Standard; whisper-1 na transcricao de audio, AG6b); as linhas claude-* ficaram da Anthropic e nenhum codigo as le.';

-- ---------------------------------------------------------------------------
-- 5) ia_contato_liberado: a versao do aviso da OpenAI (D-60, D-95)
-- ---------------------------------------------------------------------------
-- Default constante: nenhuma linha regravada; o CHECK varre as linhas de
-- hoje (2). Todas nascem 1 (o aviso de hoje).

alter table public.ia_contato_liberado
  add column aviso_da_openai_versao smallint not null default 1
    constraint ia_contato_liberado_aviso_versao_valida check (aviso_da_openai_versao between 1 and 2);

comment on column public.ia_contato_liberado.aviso_da_openai_versao is
  'AG6b (D-60, D-95): o aviso da OpenAI que quem liga confirmou para este telefone. 1 = o aviso de hoje (o que escrever vai para a OpenAI); 2 = o aviso com audio, foto e documento. So definir_contato_liberado_da_ia escreve: ligar com a confirmacao grava p_versao_do_aviso; desligar volta a 1; ligar de novo sem a confirmacao mantem a versao do telefone ligado e volta a 1 o desligado. midia_da_ia_liberada exige 2.';

-- ---------------------------------------------------------------------------
-- 6) definir_contato_liberado_da_ia: o parametro da versao do aviso
-- ---------------------------------------------------------------------------
-- DROP e CREATE (o parametro novo muda a assinatura; CREATE OR REPLACE
-- criaria uma segunda funcao). O corpo de producao (lido com fndef.js em
-- 30/10/2026, md5 de prosrc 88c5fa98f271c16cf783acffba347179) inteiro, com os
-- trechos [AG6b midia]; os mesmos grants (authenticated e service_role). O
-- codigo de hoje chama por nome sem o parametro e grava 1 (o lado seguro).

drop function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean);

create function public.definir_contato_liberado_da_ia(
  p_clinic_id uuid,
  p_telefone_e164 text,
  p_rotulo text,
  p_ativo boolean,
  p_forcar_contato_existente boolean default false,
  p_confirmou_aviso_da_openai boolean default false,
  p_confirmou_teste_com_paciente boolean default false,
  p_versao_do_aviso smallint default 1
)
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
  -- [AG6b midia] inicio
  -- A versao do aviso confirmado (1 o de hoje, 2 com audio, foto e
  -- documento). Nulo vale 1, o lado seguro.
  v_versao smallint := coalesce(p_versao_do_aviso, 1);
  -- [AG6b midia] fim
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
  -- [AG6b midia] inicio
  -- So 1 (o aviso de hoje) ou 2 (com audio, foto e documento), antes de
  -- qualquer gravacao.
  if v_versao not between 1 and 2 then
    raise exception using errcode = '22023', message = 'versao_do_aviso_invalida';
  end if;
  -- [AG6b midia] fim
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
         -- [AG6b midia] inicio
         -- Desligar volta a 1; ligar com a confirmacao grava a versao
         -- confirmada; ligar sem ela mantem a do telefone ligado e volta a 1
         -- o desligado (k.ativo e o valor de antes deste update).
         aviso_da_openai_versao = case
           when not p_ativo then 1
           when coalesce(p_confirmou_aviso_da_openai, false) then v_versao
           when not k.ativo then 1
           else k.aviso_da_openai_versao
         end,
         -- [AG6b midia] fim
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
                                            forcado,
                                            -- [whatsapp so pela equipe] fim
                                            -- [AG6b midia] inicio
                                            aviso_da_openai_versao
                                            -- [AG6b midia] fim
                                            )
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid(),
            -- [whatsapp so pela equipe] inicio
            v_forcou,
            -- [whatsapp so pela equipe] fim
            -- [AG6b midia] inicio
            v_versao
            -- [AG6b midia] fim
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
  -- [AG6b midia] com a versao confirmada em detalhes.
  if p_ativo and coalesce(p_confirmou_aviso_da_openai, false) then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id,
                                  -- [AG6b midia]
                                  detalhes)
    values (p_clinic_id, auth.uid(), 'confirmou_aviso_da_openai', 'ia_contato_liberado', v_id,
            -- [AG6b midia]
            jsonb_build_object('versao', v_versao));
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

revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint) to authenticated, service_role;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean, smallint) is
  'Liga ou desliga um telefone da equipe para a IA (T5). Quem chama: administrador ativo da propria clinica da lista (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera); o forcar (telefone de paciente que aceitou testar, onda 2, P3), o mesmo guarda com p_confirmou_teste_com_paciente (sem ela, 23514 teste_com_paciente_nao_confirmado, antes de qualquer leitura). Ao ligar recusa numero de WhatsApp do Conduzza e contato com sinal de paciente sem o forcar (23514). Telefone fora da lista: ligar exige p_confirmou_aviso_da_openai (23514 aviso_da_openai_nao_confirmado), desligar nao cria linha. Grava audit_log: editou, confirmou_aviso_da_openai (ligar com a confirmacao; AG6b: detalhes {versao}), forcou_telefone_de_paciente_na_ia e confirmou_teste_com_paciente (no nome de quem forca). AG6b (D-60, D-95): p_versao_do_aviso (1 o aviso de hoje, o padrao; 2 o aviso com audio, foto e documento; nulo vale 1; fora de 1 ou 2, 22023 versao_do_aviso_invalida, depois do rotulo): ligar com a confirmacao grava a versao em aviso_da_openai_versao; desligar volta a 1; ligar sem a confirmacao mantem a versao do telefone ligado e volta a 1 o desligado. Sempre por nome de parametro.';

-- ---------------------------------------------------------------------------
-- 7) midia_da_ia_liberada: o telefone que pode mandar midia a OpenAI (D-95)
-- ---------------------------------------------------------------------------
-- O motor confere ANTES de mandar qualquer midia (PGRST202, sem esta
-- migration: nada sai); a RPC da leitura confere de novo ao gravar. Nesta
-- entrega nao ha outro caminho: so o telefone da lista da equipe (ou o de
-- paciente forcado), ligado, com o aviso novo (versao 2). Contato fora da
-- lista (modo numero inteiro) e sempre falso.

create function public.midia_da_ia_liberada(p_clinic_id uuid, p_telefone text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.ia_contato_liberado k
     where k.clinic_id = p_clinic_id
       and k.phone_key = public.chave_telefone(btrim(p_telefone))
       and k.ativo
       and k.aviso_da_openai_versao >= 2
  )
$function$;

revoke all on function public.midia_da_ia_liberada(uuid, text)
  from public, anon, authenticated;
grant execute on function public.midia_da_ia_liberada(uuid, text)
  to service_role;

comment on function public.midia_da_ia_liberada(uuid, text) is
  'So o servidor (service_role; o motor da IA e gravar_leitura_da_midia). AG6b (D-60, D-95): verdadeiro so se a clinica tem em ia_contato_liberado o telefone (pela chave canonica, chave_telefone(btrim(p_telefone))), ativo, com aviso_da_openai_versao >= 2 (o aviso com audio, foto e documento). Qualquer nulo: falso. Nesta entrega nao ha outro caminho: contato fora da lista nunca manda midia a OpenAI.';

-- ---------------------------------------------------------------------------
-- 8) ia_leitura_da_midia: a transcricao e a leitura
-- ---------------------------------------------------------------------------
-- Uma linha por mensagem (a primeira vale), imutavel. Sem FK para message
-- (de proposito: nao trava message nesta migration); a RPC confere a
-- mensagem, o apagamento (arquivar_e_limpar_mensagem) e a poda tiram a
-- linha. FKs para clinic e conversation em cascata (a conversa apagada leva
-- as leituras). Fora do Realtime (a linha tem texto do paciente).

-- "Sem repetido" num CHECK (subconsulta nao vale em CHECK). Imutavel;
-- ninguem da API executa (a RPC e o CHECK rodam como o dono).
create function public.ia_lista_sem_repetido(p_lista uuid[])
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select count(distinct x.id) = count(x.id) from unnest(p_lista) as x(id)
$function$;

revoke all on function public.ia_lista_sem_repetido(uuid[])
  from public, anon, authenticated, service_role;

comment on function public.ia_lista_sem_repetido(uuid[]) is
  'Interna (AG6b): verdadeiro se a lista nao tem id repetido (os nulos nao contam; quem chama confere o nulo a parte). Usada no CHECK ia_leitura_da_midia_procedimentos_validos e em gravar_leitura_da_midia. Nenhum papel da API executa.';

create table public.ia_leitura_da_midia (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null
    constraint ia_leitura_da_midia_clinic_id_fkey references public.clinic (id) on delete cascade,
  conversation_id uuid not null
    constraint ia_leitura_da_midia_conversation_id_fkey references public.conversation (id) on delete cascade,
  message_id uuid not null
    constraint ia_leitura_da_midia_message_id_key unique,
  job_id uuid not null,
  midia text not null,
  tipo text not null,
  transcricao text,
  segundos_de_audio integer,
  procedimentos uuid[] not null default '{}',
  fora_do_cadastro integer not null default 0,
  confianca text,
  resumo text,
  modelo text not null,
  versao text not null,
  created_at timestamptz not null default now(),
  constraint ia_leitura_da_midia_midia_valida check (
    midia in ('audio', 'imagem', 'documento')),
  constraint ia_leitura_da_midia_tipo_valido check (
    (midia = 'audio' and tipo in ('transcricao', 'sem_fala'))
    or (midia in ('imagem', 'documento') and tipo in (
      'pedido_de_exame_ou_procedimento', 'guia_ou_autorizacao', 'carteirinha',
      'documento_de_identidade', 'resultado_ou_laudo', 'receita',
      'foto_do_corpo', 'figurinha', 'outro', 'ilegivel'))),
  constraint ia_leitura_da_midia_transcricao_coerente check (
    (tipo = 'transcricao') = (transcricao is not null)
    and (transcricao is null
         or (char_length(transcricao) <= 4000 and transcricao ~ '[^[:space:]]'))),
  constraint ia_leitura_da_midia_segundos_coerentes check (
    (midia = 'audio') = (segundos_de_audio is not null)
    and (segundos_de_audio is null or segundos_de_audio between 1 and 150)),
  constraint ia_leitura_da_midia_procedimentos_validos check (
    coalesce(array_ndims(procedimentos), 1) = 1
    and cardinality(procedimentos) <= 10
    and array_position(procedimentos, null) is null
    and public.ia_lista_sem_repetido(procedimentos)),
  constraint ia_leitura_da_midia_procedimentos_so_no_pedido check (
    tipo = 'pedido_de_exame_ou_procedimento' or cardinality(procedimentos) = 0),
  constraint ia_leitura_da_midia_pedido_com_itens check (
    tipo <> 'pedido_de_exame_ou_procedimento'
    or cardinality(procedimentos) >= 1 or fora_do_cadastro >= 1),
  constraint ia_leitura_da_midia_fora_do_cadastro_valido check (
    fora_do_cadastro between 0 and 20
    and (fora_do_cadastro = 0 or tipo = 'pedido_de_exame_ou_procedimento')),
  constraint ia_leitura_da_midia_confianca_coerente check (
    (midia = 'audio' and confianca is null)
    or (midia in ('imagem', 'documento') and confianca is not null
        and confianca in ('alta', 'media', 'baixa'))),
  constraint ia_leitura_da_midia_resumo_coerente check (
    case when midia = 'audio' or tipo = 'figurinha' then resumo is null
         else resumo is not null and char_length(resumo) <= 300 and resumo ~ '[^[:space:]]' end),
  constraint ia_leitura_da_midia_modelo_valido check (
    modelo ~ '^[a-z0-9][a-z0-9.-]{0,99}$'
    and (modelo <> 'local' or (midia in ('imagem', 'documento') and tipo = 'figurinha'))),
  constraint ia_leitura_da_midia_versao_coerente check (
    case when midia = 'audio' then versao ~ '^transcricao-[0-9a-f]{12}$'
         when modelo = 'local' then versao ~ '^figurinha-[0-9a-f]{12}$'
         else versao ~ '^leitor-[0-9a-f]{12}$' end)
);

-- A cascata da conversa e a poda por clinica e data (a leitura por mensagem
-- usa o UNIQUE de message_id).
create index ia_leitura_da_midia_conversa_idx
  on public.ia_leitura_da_midia (conversation_id);
create index ia_leitura_da_midia_poda_idx
  on public.ia_leitura_da_midia (clinic_id, created_at);

-- Imutavel: so INSERT (a RPC) e DELETE (o apagamento, a poda, a cascata).
create function public.ia_leitura_da_midia_nao_muda()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  raise exception using errcode = '23514', message = 'leitura_nao_muda';
end;
$function$;

revoke all on function public.ia_leitura_da_midia_nao_muda()
  from public, anon, authenticated, service_role;

comment on function public.ia_leitura_da_midia_nao_muda() is
  'Funcao do gatilho leitura_nao_muda de ia_leitura_da_midia (AG6b): todo UPDATE da 23514 leitura_nao_muda (a leitura gravada nunca muda; a primeira vale). Ninguem executa direto.';

create trigger leitura_nao_muda
  before update on public.ia_leitura_da_midia
  for each row
  execute function public.ia_leitura_da_midia_nao_muda();

comment on trigger leitura_nao_muda on public.ia_leitura_da_midia is
  'AG6b: a leitura e imutavel (23514 leitura_nao_muda em todo UPDATE).';

alter table public.ia_leitura_da_midia enable row level security;

-- Ninguem grava pela API: so a RPC gravar_leitura_da_midia (SECURITY
-- DEFINER). A sessao e a service role so leem.
revoke all on table public.ia_leitura_da_midia from public, anon, authenticated, service_role;
grant select on table public.ia_leitura_da_midia to authenticated, service_role;

-- A regra de leitura de message (membro ativo; o profissional so a conversa
-- que esta com ele), mais a mensagem nao apagada (defesa em profundidade: o
-- apagamento ja tira a linha).
create policy "membro ativo le a leitura da midia conforme papel"
  on public.ia_leitura_da_midia
  for select
  to authenticated
  using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
         where c.id = ia_leitura_da_midia.conversation_id
           and c.assignee_user_id = auth.uid()
      )
    )
    and exists (
      select 1 from public.message m
       where m.id = ia_leitura_da_midia.message_id
         and m.deleted_at is null
    )
  );

comment on table public.ia_leitura_da_midia is
  'A transcricao do audio e a leitura da imagem ou do documento que o paciente mandou na conversa com a IA (AG6b, D-56, D-14/D-58, D-93): uma linha por mensagem (a primeira vale; imutavel, gatilho leitura_nao_muda). So gravar_leitura_da_midia grava (SECURITY DEFINER); a sessao e a service role so leem. RLS: a regra de message (membro ativo; o profissional so a conversa com ele) mais a mensagem nao apagada. Sem FK para message: o apagamento da mensagem (arquivar_e_limpar_mensagem) leva a linha; a conversa apagada tambem (cascata); a poda tira a de mais de 90 dias e a da mensagem apagada (podar_agendamento_da_ia). Fora do Realtime (texto do paciente): a tela rele no evento de message. Nunca guarda texto do arquivo: o tipo, os ids do Cadastro e um resumo montado pelo servidor.';
comment on column public.ia_leitura_da_midia.clinic_id is
  'A clinica da conversa (sempre a do job e da conversa: so a RPC grava).';
comment on column public.ia_leitura_da_midia.conversation_id is
  'A conversa da mensagem (FK em cascata).';
comment on column public.ia_leitura_da_midia.message_id is
  'A mensagem de entrada do paciente (audio, imagem ou documento). UNIQUE (uma leitura por mensagem). Sem FK: a RPC confere a mensagem; o apagamento e a poda tiram a linha.';
comment on column public.ia_leitura_da_midia.job_id is
  'O job responder_com_ia que gravou. Sem FK: a fila e podada.';
comment on column public.ia_leitura_da_midia.midia is
  'audio, imagem ou documento: o content_type da mensagem.';
comment on column public.ia_leitura_da_midia.tipo is
  'Audio: transcricao ou sem_fala (silencio, ruido, frase-fantasma). Imagem e documento: pedido_de_exame_ou_procedimento, guia_ou_autorizacao, carteirinha, documento_de_identidade, resultado_ou_laudo, receita, foto_do_corpo, figurinha, outro ou ilegivel (o leitor de midia, saida fechada; a figurinha do WhatsApp reconhecida no servidor, modelo local).';
comment on column public.ia_leitura_da_midia.transcricao is
  'O texto transcrito (so com tipo transcricao; 1 a 4000 caracteres, nunca em branco). Dado de saude: nunca em log.';
comment on column public.ia_leitura_da_midia.segundos_de_audio is
  'Os segundos do audio que entram no custo (o maior entre o que a OpenAI devolveu e o medido; 1 a 150). Obrigatorio no audio, nulo no arquivo.';
comment on column public.ia_leitura_da_midia.procedimentos is
  'Os procedimentos do Cadastro (ids de procedure ativos da clinica) que o leitor achou no pedido; ate 10, sem nulo, sem repetido; vazio fora do pedido.';
comment on column public.ia_leitura_da_midia.fora_do_cadastro is
  'Quantos itens do pedido nao estao no Cadastro (0 a 20; acima de 0 so no pedido: a conversa vai para a equipe). O pedido tem pelo menos um item ou fora_do_cadastro >= 1.';
comment on column public.ia_leitura_da_midia.confianca is
  'alta, media ou baixa (obrigatoria na imagem e no documento; a figurinha local grava alta); nula no audio.';
comment on column public.ia_leitura_da_midia.resumo is
  'O que a equipe ve embaixo do arquivo ("Lido pelo assistente: ..."), montado pelo servidor so com nomes do Cadastro e textos fixos (1 a 300; nunca texto do arquivo). Obrigatorio na imagem e no documento, menos na figurinha; nulo no audio.';
comment on column public.ia_leitura_da_midia.modelo is
  'O modelo que leu (formato de llm_preco.modelo), ou local (a figurinha reconhecida no servidor, sem modelo).';
comment on column public.ia_leitura_da_midia.versao is
  'A versao fixa de quem leu: transcricao-<12 hex> no audio; leitor-<12 hex> no arquivo lido por modelo; figurinha-<12 hex> na figurinha local.';

-- ---------------------------------------------------------------------------
-- 9) gravar_leitura_da_midia: a unica escrita em ia_leitura_da_midia
-- ---------------------------------------------------------------------------
-- O motor transcreve ou le DENTRO do turno da IA, depois de todas as travas,
-- e grava aqui antes de usar o resultado. A funcao confere de novo tudo o
-- que o banco consegue conferir e trava a MENSAGEM antes da CONVERSA (a
-- ordem do apagamento e do download: a mensagem, depois a conversa pelo
-- gatilho da previa), entao nunca fecha ciclo com eles. Nunca levanta 40001
-- nem 40P01 (o PostgREST repetiria sem limite). Nada em log com texto.

create function public.gravar_leitura_da_midia(
  p_job_id uuid, p_worker text, p_message_id uuid,
  p_midia text, p_tipo text,
  p_transcricao text, p_segundos integer,
  p_procedimentos uuid[], p_fora_do_cadastro integer,
  p_confianca text, p_resumo text,
  p_modelo text, p_versao text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  -- Os tipos de cada midia (o CHECK ia_leitura_da_midia_tipo_valido).
  c_tipos_do_audio constant text[] := array['transcricao', 'sem_fala'];
  c_tipos_do_arquivo constant text[] := array['pedido_de_exame_ou_procedimento', 'guia_ou_autorizacao', 'carteirinha', 'documento_de_identidade', 'resultado_ou_laudo', 'receita', 'foto_do_corpo', 'figurinha', 'outro', 'ilegivel'];
  c_confiancas constant text[] := array['alta', 'media', 'baixa'];
  c_pedido constant text := 'pedido_de_exame_ou_procedimento';
  c_figurinha constant text := 'figurinha';
  -- A figurinha do WhatsApp reconhecida no servidor, sem modelo (D-98).
  c_modelo_local constant text := 'local';
  -- Os limites (os mesmos dos CHECKs da tabela).
  c_limite_da_transcricao constant integer := 4000;
  c_limite_do_resumo constant integer := 300;
  c_maximo_de_segundos constant integer := 150;
  c_maximo_de_itens constant integer := 10;
  c_maximo_fora_do_cadastro constant integer := 20;
  -- A habilidade de cada midia, no jsonb skills da ultima versao publicada.
  c_habilidade_do_audio constant text := 'ler_audio';
  c_habilidade_do_arquivo constant text := 'ler_imagem_e_documento';
  v_itens uuid[] := coalesce(p_procedimentos, '{}'::uuid[]);
  v_fora integer := coalesce(p_fora_do_cadastro, 0);
  v_arquivo boolean;
  v_conversa uuid;
  v_clinica uuid;
  v_criado timestamptz;
  v_status text;
  v_atendente uuid;
  v_contato uuid;
  v_telefone text;
  v_lidas uuid[];
  v_skills jsonb;
  v_id uuid;
  v_leitura record;
begin
  -- 1. Os obrigatorios.
  if p_job_id is null or p_worker is null or p_message_id is null
     or p_midia is null or p_tipo is null or p_modelo is null or p_versao is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- 2. As regras dos CHECKs, na ordem do contrato (o motor sabe o que errou).
  if p_midia not in ('audio', 'imagem', 'documento') then
    raise exception using errcode = '22023', message = 'midia_invalida';
  end if;
  v_arquivo := p_midia <> 'audio';
  if not (case when v_arquivo then p_tipo = any (c_tipos_do_arquivo)
               else p_tipo = any (c_tipos_do_audio) end) then
    raise exception using errcode = '22023', message = 'tipo_invalido';
  end if;
  if (p_tipo = 'transcricao') <> (p_transcricao is not null)
     or (p_transcricao is not null
         and (char_length(p_transcricao) > c_limite_da_transcricao
              or p_transcricao !~ '[^[:space:]]')) then
    raise exception using errcode = '22023', message = 'transcricao_invalida';
  end if;
  if v_arquivo = (p_segundos is not null)
     or (p_segundos is not null and p_segundos not between 1 and c_maximo_de_segundos) then
    raise exception using errcode = '22023', message = 'segundos_invalidos';
  end if;
  if coalesce(array_ndims(v_itens), 1) <> 1
     or cardinality(v_itens) > c_maximo_de_itens
     or array_position(v_itens, null) is not null
     or not public.ia_lista_sem_repetido(v_itens)
     or (p_tipo <> c_pedido and cardinality(v_itens) > 0)
     or (p_tipo = c_pedido and cardinality(v_itens) = 0 and v_fora < 1) then
    raise exception using errcode = '22023', message = 'itens_invalidos';
  end if;
  if v_fora not between 0 and c_maximo_fora_do_cadastro
     or (v_fora > 0 and p_tipo <> c_pedido) then
    raise exception using errcode = '22023', message = 'fora_do_cadastro_invalido';
  end if;
  if (v_arquivo and not coalesce(p_confianca = any (c_confiancas), false))
     or (not v_arquivo and p_confianca is not null) then
    raise exception using errcode = '22023', message = 'confianca_invalida';
  end if;
  if (not v_arquivo or p_tipo = c_figurinha) <> (p_resumo is null)
     or (p_resumo is not null
         and (char_length(p_resumo) > c_limite_do_resumo
              or p_resumo !~ '[^[:space:]]')) then
    raise exception using errcode = '22023', message = 'resumo_invalido';
  end if;
  if p_modelo !~ '^[a-z0-9][a-z0-9.-]{0,99}$'
     or (p_modelo = c_modelo_local and not (v_arquivo and p_tipo = c_figurinha)) then
    raise exception using errcode = '22023', message = 'modelo_invalido';
  end if;
  if not (case when not v_arquivo then p_versao ~ '^transcricao-[0-9a-f]{12}$'
               when p_modelo = c_modelo_local then p_versao ~ '^figurinha-[0-9a-f]{12}$'
               else p_versao ~ '^leitor-[0-9a-f]{12}$' end) then
    raise exception using errcode = '22023', message = 'versao_invalida';
  end if;

  -- 3. A posse do job. O CHECK job_queue_ia_tem_conversa garante o uuid no
  -- payload do kind.
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
    return jsonb_build_object('ok', false, 'motivo', 'sem_posse');
  end if;

  -- 4. As travas: a MENSAGEM (FOR SHARE: barra o update do apagamento ate o
  -- fim desta transacao), so se ela e desta conversa e clinica; DEPOIS a
  -- conversa (FOR NO KEY UPDATE, a da passagem). Um apagamento que chegou
  -- antes ja aparece abaixo (deleted_at); um que vem depois espera e, no
  -- fim, apaga a leitura. Um Assumir, um Devolver ou uma passagem que vem
  -- depois espera esta transacao.
  perform 1 from public.message m
   where m.id = p_message_id
     and m.conversation_id = v_conversa
     and m.clinic_id = v_clinica
     for share;
  select c.status, c.assignee_user_id, c.contact_id
    into v_status, v_atendente, v_contato
    from public.conversation c
   where c.id = v_conversa
     for no key update;

  -- 5. D-A: o job de antes da janela atual nao mexe na sessao nova.
  if exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = v_conversa
       and v_criado < w.desde
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'job_antigo');
  end if;

  -- 6. A conversa segue com a IA, sem responsavel.
  if v_status is distinct from 'ia_atendendo' or v_atendente is not null then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;

  -- 7. A mensagem: desta conversa e clinica, de entrada, do paciente, fora
  -- de nota interna, nao apagada, com o arquivo no Storage e da midia dita.
  if not exists (
    select 1 from public.message m
     where m.id = p_message_id
       and m.conversation_id = v_conversa
       and m.clinic_id = v_clinica
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and not m.is_internal_note
       and m.deleted_at is null
       and starts_with(m.media_url, 'storage://')
       and m.content_type = p_midia
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_invalida');
  end if;

  -- 8. O job leu a mensagem (o motor grava ai_turno.mensagens_lidas antes do
  -- laco; sem a linha do turno, nada lido).
  select t.mensagens_lidas into v_lidas
    from public.ai_turno t
   where t.job_id = p_job_id
     and t.clinic_id = v_clinica
     and t.conversation_id = v_conversa;
  if not coalesce(p_message_id = any (v_lidas), false) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_nao_lida');
  end if;

  -- 9. A habilidade da midia ligada na ULTIMA versao publicada (a que o
  -- agente le no WhatsApp). A figurinha local tambem exige a de arquivo.
  select a.skills into v_skills
    from public.ai_agent_config a
   where a.clinic_id = v_clinica
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if (v_skills ->> (case when v_arquivo then c_habilidade_do_arquivo
                         else c_habilidade_do_audio end)) is distinct from 'true' then
    return jsonb_build_object('ok', false, 'motivo', 'leitura_desligada');
  end if;

  -- 10. O telefone do contato pode mandar midia a OpenAI (D-95).
  select k.phone_e164 into v_telefone
    from public.contact k
   where k.id = v_contato
     and k.clinic_id = v_clinica;
  if not public.midia_da_ia_liberada(v_clinica, v_telefone) then
    return jsonb_build_object('ok', false, 'motivo', 'midia_bloqueada');
  end if;

  -- 11. Os itens do pedido sao procedimentos ativos desta clinica.
  if exists (
    select 1 from unnest(v_itens) as x(id)
     where not exists (
       select 1 from public.procedure p
        where p.id = x.id
          and p.clinic_id = v_clinica
          and p.active
     )
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'procedimento_invalido');
  end if;

  -- 12 e 13. A primeira leitura vale: grava, ou devolve a que ja existe
  -- (de qualquer job), sem regravar.
  insert into public.ia_leitura_da_midia (
    clinic_id, conversation_id, message_id, job_id, midia, tipo,
    transcricao, segundos_de_audio, procedimentos, fora_do_cadastro,
    confianca, resumo, modelo, versao
  ) values (
    v_clinica, v_conversa, p_message_id, p_job_id, p_midia, p_tipo,
    p_transcricao, p_segundos, v_itens, v_fora,
    p_confianca, p_resumo, p_modelo, p_versao
  )
  on conflict (message_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'reutilizado', false, 'id', v_id);
  end if;

  select l.id, l.midia, l.tipo, l.transcricao, l.segundos_de_audio,
         l.procedimentos, l.fora_do_cadastro, l.confianca, l.resumo
    into v_leitura
    from public.ia_leitura_da_midia l
   where l.message_id = p_message_id;
  return jsonb_build_object(
    'ok', true,
    'reutilizado', true,
    'id', v_leitura.id,
    'leitura', jsonb_build_object(
      'midia', v_leitura.midia,
      'tipo', v_leitura.tipo,
      'transcricao', v_leitura.transcricao,
      'segundos_de_audio', v_leitura.segundos_de_audio,
      'procedimentos', to_jsonb(v_leitura.procedimentos),
      'fora_do_cadastro', v_leitura.fora_do_cadastro,
      'confianca', v_leitura.confianca,
      'resumo', v_leitura.resumo
    )
  );
end;
$function$;

revoke execute on function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text)
  to service_role;

comment on function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text) is
  'So o servidor (service_role; o motor da IA, no turno). AG6b: grava a transcricao do audio ou a leitura da imagem ou do documento da mensagem p_message_id em ia_leitura_da_midia. Na ordem: 22004 parametro_nulo (job, worker, mensagem, midia, tipo, modelo ou versao nulo); 22023 com o codigo, as regras dos CHECKs: midia_invalida, tipo_invalido, transcricao_invalida, segundos_invalidos, itens_invalidos, fora_do_cadastro_invalido, confianca_invalida, resumo_invalido, modelo_invalido, versao_invalida (p_procedimentos nulo vale vazio; p_fora_do_cadastro nulo vale 0); {ok:false, motivo:sem_posse} (o job nao e responder_com_ia em executando com o worker, ou a conversa nao e da clinica do job); a trava da mensagem (FOR SHARE, so a desta conversa e clinica) e DEPOIS a da conversa (FOR NO KEY UPDATE); job_antigo (D-A); fora_da_ia (a conversa nao esta em ia_atendendo sem responsavel); mensagem_invalida (nao e desta conversa e clinica, de entrada, do paciente, fora de nota interna, nao apagada, com media_url storage:// e content_type = p_midia); mensagem_nao_lida (fora de ai_turno.mensagens_lidas do job; sem o turno, nada lido); leitura_desligada (a ultima versao publicada sem skills ->> ler_audio = true no audio, ou sem skills ->> ler_imagem_e_documento = true na imagem e no documento); midia_bloqueada (midia_da_ia_liberada falso para o telefone do contato); procedimento_invalido (item que nao e procedure ativo da clinica). Ja existe leitura da mensagem: {ok:true, reutilizado:true, id, leitura:{midia, tipo, transcricao, segundos_de_audio, procedimentos, fora_do_cadastro, confianca, resumo}} (a primeira vale; nunca regrava). Senao grava e devolve {ok:true, reutilizado:false, id}. Nunca 40001 nem 40P01.';

-- ---------------------------------------------------------------------------
-- 10) A mensagem apagada leva a leitura
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE do corpo de producao (lido com fndef.js em 30/10/2026,
-- md5 de prosrc 9a949b8acd0d38c72adc498efbddb4bd): a mesma assinatura, o
-- mesmo search_path (public), SECURITY DEFINER e os mesmos grants. O trecho
-- [AG6b midia] vem DEPOIS do update da mensagem (nunca antes: a gravacao da
-- leitura trava a mensagem com FOR SHARE, e o update espera por ela; o
-- delete de depois do update ve a leitura ja gravada). A transcricao NAO vai
-- ao cofre (D-93: o cofre ja guarda o audio).

create or replace function public.arquivar_e_limpar_mensagem(p_message_id uuid, p_escopo text, p_origem text, p_por uuid)
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

  -- [AG6b midia] inicio
  -- A transcricao e a leitura do assistente saem com a mensagem (D-93),
  -- DEPOIS do update: a gravacao que chegou antes ja comitou (o update
  -- esperou a trava dela) e aparece aqui.
  delete from public.ia_leitura_da_midia l
   where l.message_id = p_message_id;
  -- [AG6b midia] fim
end;
$function$;

comment on function public.arquivar_e_limpar_mensagem(uuid, text, text, uuid) is
  'Interna (service_role; apagar_mensagem e registrar_apagamento_do_whatsapp): o conteudo da mensagem vai para o cofre message_apagada (uma vez) e a linha fica com o corpo, a midia e a transcricao nulos, deleted_at e quem apagou. AG6b (D-93): DEPOIS do update, apaga a leitura do assistente (ia_leitura_da_midia) da mensagem; a transcricao nao vai ao cofre.';

-- ---------------------------------------------------------------------------
-- 11) A atribuicao: a midia que ninguem leu nao vai ao responsavel (D-96)
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE do corpo FINAL da AG6a (20261029120000, com as revisoes
-- R1 e R2): a mesma assinatura, o mesmo retorno e os mesmos grants (so
-- service_role). Os trechos [AG6b midia]: os dois motivos da midia que
-- nunca atribuem e a recusa midia_nao_lida, depois de mensagem_nova e antes
-- de regra_fila.

create or replace function public.atribuir_conversa_passada_pela_ia(p_job_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
  -- midia, e a resposta que o filtro do CFM barrou). [AG6b midia] (D-96): o
  -- arquivo que so a equipe pode avaliar (midia_clinica) e o que o
  -- assistente nao identificou (midia_nao_identificada); o documento do
  -- paciente (documento_do_paciente) atribui, e administrativo.
  c_motivos_que_nunca_atribuem constant text[] := array['urgencia', 'fora_do_horario', 'sintoma', 'assunto_clinico', 'midia_nao_suportada', 'conformidade', 'midia_clinica', 'midia_nao_identificada'];
  -- [AG6b midia] O conteudo de midia (o do content_type; a mensagem texto
  -- com media_url, video, localizacao ou cartao, tambem conta).
  c_conteudos_de_midia constant text[] := array['audio', 'imagem', 'documento'];
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

    -- [AG6b midia] inicio
    -- (D-96) A midia que o job leu e que o assistente nao transcreveu nem
    -- leu: a mensagem de entrada do paciente entre as lidas do turno deste
    -- job, de audio, imagem ou documento (ou texto com media_url: video,
    -- localizacao, cartao), SEM linha em ia_leitura_da_midia ou com a linha
    -- sem_fala. Pode ser uma emergencia que ninguem ouviu: alguem de
    -- plantao precisa ver na fila. A apagada depois conta (a leitura saiu
    -- com ela; o lado seguro). Depois da trava da conversa: a gravacao da
    -- leitura trava a mesma conversa, entao a que comitou antes aparece aqui.
    if exists (
      select 1 from public.message m
       where m.id = any (v_lidas)
         and m.conversation_id = v_conversa
         and m.clinic_id = v_clinica
         and m.direction = 'entrada'
         and m.author = 'paciente'
         and (m.content_type = any (c_conteudos_de_midia)
              or (m.content_type = 'texto' and m.media_url is not null))
         and not exists (
           select 1 from public.ia_leitura_da_midia l
            where l.message_id = m.id
              and l.tipo <> 'sem_fala'
         )
    ) then
      return jsonb_build_object('atribuida', false, 'codigo', 'midia_nao_lida');
    end if;
    -- [AG6b midia] fim

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
$function$;

comment on function public.atribuir_conversa_passada_pela_ia(uuid, text) is
  'So o servidor (service_role; o executor da IA), DEPOIS da tentativa da frase de sempre (AG6a, D-15, D-55; revisao de 28/10/2026): a conversa que o job passou para a equipe fica com o responsavel do lead. Recusas na ordem, {atribuida:false, codigo}: sem_posse (o job nao e responder_com_ia em executando com o worker, ou a conversa nao e da clinica do job); (trava da conversa) job_antigo (D-A: job de antes da janela atual); sem_passagem (a ultima decisao do job, em ai_decision_log, nao e escalou, bloqueou ou falhou com escalation_reason); motivo_nao_atribui (urgencia, fora_do_horario e, pela revisao 2, sintoma, assunto_clinico, midia_nao_suportada e conformidade; AG6b, D-96: midia_clinica e midia_nao_identificada); fora_da_fila (a conversa nao esta em aguardando_humano); com_responsavel; urgente (a marca aberta em conversa_urgente); mensagem_nova (revisao 2: mensagem de entrada do paciente, nao apagada, desde a criacao do job e fora de ai_turno.mensagens_lidas do job; sem o turno, nada lido); midia_nao_lida (AG6b, D-96: entre as lidas do job, mensagem de entrada do paciente de audio, imagem ou documento, ou texto com media_url, apagada ou nao, sem linha em ia_leitura_da_midia ou com a linha sem_fala); regra_fila (a ultima versao publicada sem escalation_rules ->> passagem_para = responsavel_do_lead); sem_responsavel (o contato sem owner_user_id); responsavel_inapto (sem clinic_member ativo da clinica com papel admin, gestor, recepcao ou profissional). Atribuiu, {atribuida:true, codigo:atribuida}: o update so de aguardando_humano sem responsavel para em_atendimento com ele (nunca rouba) e o evento "A conversa ficou com {nome}, responsavel pelo lead." (profile.name em uma linha, ate 80; sem nome, "A conversa ficou com o responsavel pelo lead."). Qualquer erro: WARNING com a clinica e o SQLSTATE, nada muda, {atribuida:false, codigo:erro}. Idempotente: a segunda chamada devolve fora_da_fila.';

-- ---------------------------------------------------------------------------
-- 12) A poda, com a leitura da midia
-- ---------------------------------------------------------------------------
-- O corpo da AG6a (20261029120000), com o trecho [AG6b midia].

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
  -- [AG6b midia] inicio
  -- A transcricao e a leitura da midia (D-93): 90 dias. A da mensagem
  -- apagada (o apagamento ja a tira; aqui, a que sobrar) e a da mensagem que
  -- nao existe mais saem na hora.
  c_leitura_antiga constant interval := interval '90 days';
  v_leituras integer := 0;
  -- [AG6b midia] fim
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

  -- [AG6b midia] inicio
  -- A leitura da midia com mais de 90 dias, a da mensagem apagada e a da
  -- mensagem que nao existe mais (AG6b). Ate 1000 por passagem, sem esperar
  -- ninguem (SKIP LOCKED).
  delete from public.ia_leitura_da_midia l
   where l.id in (
     select x.id
       from public.ia_leitura_da_midia x
       left join public.message m on m.id = x.message_id
      where x.created_at < now() - c_leitura_antiga
         or m.id is null
         or m.deleted_at is not null
      limit 1000
        for update of x skip locked
   );
  get diagnostics v_leituras = row_count;
  -- [AG6b midia] fim

  return jsonb_build_object('atendimentos', v_atendimentos, 'dados', v_dados
                            -- [lista pela IA]
                            , 'pedidos_de_espera', v_pedidos
                            -- [AG6 urgencia]
                            , 'urgencias', v_urgencias
                            -- [AG6b midia]
                            , 'leituras', v_leituras);
end;
$$;

comment on function public.podar_agendamento_da_ia() is
  'Interna (motor_manutencao; nenhum papel da API executa): a poda do agendamento completo pela IA (AG3), do pedido da lista de espera (AG5), da marca de urgencia (AG6a) e da leitura da midia (AG6b). ia_atendimento: conversa que sumiu, resolvida ha mais de 30 dias, janela que nao e mais a da conversa, ou parado ha mais de 90 dias. dados_informados_na_marcacao: a linha aberta 7 dias depois de mexida (ou da conversa que sumiu); a da consulta 30 dias depois de deixar de estar pendente, ou 30 dias depois do dia da consulta. ia_pedido_de_espera: o vivo (sem consumo) com 7 dias ou da conversa que sumiu; o consumido com 30 dias. conversa_urgente: a marca encerrada ha mais de 30 dias (a aberta nunca). ia_leitura_da_midia: a de mais de 90 dias, a da mensagem apagada e a da mensagem que nao existe mais. Ate 1000 linhas de cada por passagem, SKIP LOCKED. Devolve {atendimentos, dados, pedidos_de_espera, urgencias, leituras}.';

notify pgrst, 'reload schema';
