-- ---------------------------------------------------------------------------
-- O preparo do procedimento enviado palavra por palavra, so com o texto
-- aprovado pelo responsavel tecnico (RT) da clinica (AG7, parte de banco)
-- ---------------------------------------------------------------------------
-- Decisoes do dono: D-80 (AUTORIZADA em 03/11/2026: remedio, dose e jejum sao
-- aceitos dentro do texto aprovado pelo RT; o sistema envia esse texto
-- palavra por palavra; a IA nunca escreve, le nem resume o preparo) e D-4
-- (opcao B na AG7: o texto aprovado, conferido por hash). D-70 a D-79 e D-81
-- a D-86 seguem a recomendacao do desenho
-- (~/.claude/plans/agente-completo/ag7/desenho.md, secao 7), com os ajustes
-- do contrato (~/.claude/plans/agente-completo/ag7/contrato.md, secao 0).
-- D-85: o RT e de cada clinica; a AG6c (a frase do 192) reaproveita
-- responsavel_tecnico e responsavel_tecnico_vigente. Fora da mensagem do
-- preparo, o CLAUDE.md 3.2 continua valendo: o filtro na saida barra
-- qualquer preparo escrito pelo modelo. Esta migration e o BANCO da AG7; o
-- motor, o envio, a regua, o filtro e as telas vem em outras frentes, lendo
-- o contrato.
--
-- O QUE MUDA:
--   1. ai_decision_log: a coluna preparo_versao_id (uuid, sem FK, como o
--      resto da tabela; a versao do preparo que o turno mandou), com SELECT
--      para a sessao (o grant por coluna do M1: a sessao le todas as colunas
--      menos blocked_draft; e um id de versao, sem dado de paciente); o CHECK
--      ai_decision_log_desfecho_valido mais enviou_preparo (drop e add do
--      mesmo nome, NOT VALID e VALIDATE); o CHECK novo
--      ai_decision_log_preparo_coerente (enviou_preparo se e so se a versao;
--      com ele, o hash da mensagem, sem aprovado, sem bloqueio, sem camada,
--      sem falha, sem gatilho de entrada e sem motivo de passagem).
--   2. ai_turno: o CHECK ai_turno_saida_valida mais preparo (o texto do turno
--      continua nulo: ai_turno_texto_coerente nao muda).
--   3. preparo_texto_valido (nova, sql, imutavel): a regra do texto do
--      preparo (de 1 a 3.500 caracteres, aparado como o trim() do
--      JavaScript, NFC, sem CR, sem controle alem do LF, sem invisivel, sem
--      chaves duplas). preparo_texto_recusado (nova, sql, imutavel): o
--      conteudo que o banco recusa sozinho, um pedaco do que
--      problemasDoTextoDoPreparo recusa no TS (CFM-2): link, valor em reais,
--      arroba e os invisiveis que o filtro recusa e preparo_texto_valido nao
--      (promessa, oferta casada e antes e depois ficam so no TS). As RPCs de
--      salvar e de aprovar e a copia do texto antigo a usam.
--      preparo_nome_valido (nova, sql, imutavel): o nome do procedimento e o
--      do RT, que vao no cabecalho da mensagem ao paciente (1 a 120,
--      aparado, sem controle, sem invisivel e sem marca de direcao).
--   4. responsavel_tecnico (tabela nova): o RT de cada clinica, uma linha por
--      designacao, com o historico; so as RPCs gravam; o gatilho
--      responsavel_tecnico_nao_muda (so o encerramento, uma vez).
--   5. preparo_do_procedimento (tabela nova): as versoes imutaveis do texto,
--      com o hash, a situacao e a aprovacao; so as RPCs gravam; os gatilhos
--      preparo_do_procedimento_ao_inserir (o hash; nasce aguardando o RT; o
--      procedimento da mesma clinica) e preparo_do_procedimento_nao_muda (o
--      texto nunca muda; a maquina de estados; a aprovacao so pelo RT
--      vigente, com o hash conferido).
--   6. As funcoes internas (responsavel_tecnico_vigente, preparo_em_vigor,
--      mensagem_do_preparo), a da tela (user_e_responsavel_tecnico: falsa na
--      clinica de conta suspensa e para o super admin), as do
--      servidor (ler_preparo_para_envio, preparos_em_vigor_da_clinica,
--      textos_de_preparo_da_clinica, preparo_em_vigor_do_procedimento) e as
--      RPCs das telas (salvar, aprovar, devolver, descartar e suspender o
--      preparo; definir e encerrar o RT), com a trilha em audit_log (so ids e
--      o codigo do texto, nunca texto).
--   7. mensagem_ia_exige_aprovacao (CREATE OR REPLACE do corpo do M1,
--      20261013100000; a AG5 e a AG6 nao mexeram nele): o ramo `ia` byte a
--      byte igual; o ramo do outro autor no job da IA ganha, depois da frase
--      de escalonamento, o ramo do preparo [AG7 preparo]: a mensagem
--      `sistema` do job so passa se uma decisao enviou_preparo do MESMO job,
--      clinica e conversa tem o hash do corpo, as conferencias de liberacao
--      do ramo `ia` valem (CZIA2 ia_nao_liberada), e o corpo e EXATAMENTE a
--      mensagem remontada da versao em vigor (CZIA3 frase_divergente). A
--      forma da linha e a frase seguem com o efeito de hoje.
--   8. A copia do texto antigo (D-83): cada prep_instructions que cabe na
--      regra e passa nas recusas de preparo_texto_recusado vira a versao 1,
--      aguardando o RT, origem texto_antigo; o resto fica so em
--      prep_instructions (e entra nos textos que o filtro e o historico
--      escondem). NOTICE so com as contagens (copiados, fora da regra e
--      recusados), nunca o texto.
--   Sem mudanca: message (nenhuma coluna, nenhum gatilho novo; so o corpo da
--   funcao do gatilho), conversation, contact, procedure (prep_instructions
--   fica onde esta, sem uso, ate a limpeza depois da AG8), job_queue,
--   audit_log (nenhuma policy nova: ver LIMITE), clinic_member, professional,
--   ai_agent_config (a chave skills.enviar_preparo mora no jsonb que a Tela 6
--   ja grava), os motivos de passagem (sem texto aprovado passa como
--   assunto_clinico; so com a equipe, regra_do_procedimento: os dois ja
--   existem), o rotulo dos motivos, a passagem, a atribuicao (enviou_preparo
--   da sem_passagem) e a frase de escalonamento.
--
-- DEFINICOES (o contrato, secao 1.4):
--   - VIGENTE: a linha de responsavel_tecnico da clinica com ate nulo cujo
--     user_id tem clinic_member da clinica com status ativo. O RT que perde o
--     acesso deixa de ser vigente na hora, sem gatilho (falha fechada).
--   - EM VIGOR (preparo_em_vigor): a versao e da clinica, aprovada, o hash
--     recalculado bate com texto_sha256 (falha fechada se alguem mexeu na
--     linha com o gatilho desligado), rt_id e o vigente de agora (D-73), o
--     nome do procedimento e o da aprovacao (renomear tira a aprovacao) e o
--     procedimento e da mesma clinica. O procedimento inativo continua em
--     vigor para a regua das consultas que ja existem; a IA so ve o ativo.
--   - A MENSAGEM (mensagem_do_preparo): o cabecalho "Orientação de preparo
--     para {procedimento}", a linha do RT ("Responsável técnico da clínica:
--     {nome} ({conselho}-{uf} {numero})"), o texto aprovado e o rodape fixo
--     (PROPOSTA, D-77). Abaixo de 3.950 caracteres (o WhatsApp aceita 4.096,
--     D-84).
--
-- AS RECUSAS das RPCs das telas, na ordem de cada uma (a permissao, 42501,
-- antes de qualquer trava): 22004 parametro_nulo; 22023 com o codigo da
-- entrada invalida; 42501 com a frase da tela; P0001 com o codigo de negocio.
--   salvar: 22004 -> texto_invalido -> texto_recusado -> versao_lida_invalida
--     -> procedimento_inexistente -> 42501 (escrever) -> (trava o
--     procedimento) -> nome_do_procedimento_invalido -> (trava a aguardando)
--     -> texto_mudou -> texto_igual_ao_em_vigor -> {versao_id, versao,
--     texto_sha256}.
--   aprovar: 22004 -> sha256_invalido -> versao_inexistente -> 42501
--     (aprovar) -> (trava o procedimento, a versao, a aprovada e o RT) ->
--     42501 de novo (o RT mudou) -> nao_aguarda_aprovacao -> texto_mudou ->
--     nome_mudou -> texto_recusado (P0001: a versao que chegou sem passar
--     pelo salvar, como uma linha gravada pelo dono) -> (23505 do indice:
--     outra_aprovacao) -> {versao_id, versao, texto_sha256, aprovado_em}.
--   devolver: 22004 -> comentario_invalido -> versao_inexistente -> 42501
--     (aprovar) -> (trava o procedimento e a versao) -> nao_aguarda_aprovacao.
--   descartar: 22004 -> versao_inexistente -> 42501 (descartar) -> (trava o
--     procedimento e a versao) -> nao_aguarda_aprovacao.
--   suspender: 22004 -> comentario_invalido -> procedimento_inexistente ->
--     42501 (suspender) -> (trava o procedimento e a aprovada) ->
--     sem_preparo_aprovado -> {versao_id}.
--   definir o RT: 22004 -> nome_invalido -> conselho_invalido ->
--     numero_invalido -> uf_invalida -> 42501 (RT) -> 42501 (RT) de novo se
--     a pessoa escolhida e super admin (TELA-9) ->
--     responsavel_nao_e_membro_ativo -> (trava a linha aberta) ->
--     outra_definicao (a linha aberta nasceu depois do comeco desta
--     transacao: outra definicao ganhou a corrida) -> (23505:
--     outra_definicao) -> o id.
--   encerrar o RT: 22004 -> 42501 (RT) -> (trava a linha aberta) ->
--     sem_responsavel_tecnico -> outra_definicao (a linha aberta nasceu
--     depois do comeco desta transacao).
-- QUEM PASSA: escrever, descartar e suspender: administrador ou gestor
-- ativo, o super admin ou o RT vigente (de qualquer papel; o pendente nunca,
-- porque nao e ativo); aprovar e devolver: so o RT vigente (nem o
-- administrador, nem o super admin: aprovar e ato clinico, D-71); definir e
-- encerrar o RT: so o administrador pleno (sem a marca de Implementador) ou
-- o super admin. A sessao so age como RT (user_e_responsavel_tecnico) fora
-- da clinica de conta suspensa (como user_has_role: a equipe da clinica
-- suspensa nao escreve nada) e nunca sendo super admin, mesmo com vinculo
-- ativo e designada antes (D-71); e o super admin nunca e escolhido como RT.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao depois da
-- migration). TODAS no comeco, no bloco 0, antes de qualquer mudanca, numa
-- ordem fixa: ai_decision_log e ai_turno em ACCESS EXCLUSIVE (a coluna e os
-- CHECKs), clinic e procedure em SHARE ROW EXCLUSIVE (as FKs das tabelas
-- novas: bloqueiam ESCRITA, nao leitura). Cada tentativa pede todas com
-- NOWAIT; com uma ocupada, solta as que pegou (o savepoint do bloco), espera
-- 100 ms SEM trava nenhuma e tenta de novo, ate 30 vezes (uns 3 s); depois
-- falha inteira com 55P03, nada gravado: rodar de novo. Nunca espera trava
-- com outra na mao e nao fecha ciclo (40P01) com sessao nenhuma. Depois do
-- bloco, so pede travas que ja tem (ou mais fracas, ou das tabelas novas) e
-- nunca espera; o lock_timeout de 3 s fica de rede. As funcoes que leem
-- tabela sao plpgsql (o corpo nao e validado contra as tabelas no CREATE);
-- a unica sql e preparo_texto_valido, que nao le tabela. As policies novas
-- so chamam funcoes. ZERO trava em message, conversation, contact,
-- job_queue, audit_log, clinic_member, professional, ai_agent_config,
-- ia_atendimento, slot_hold e waitlist. A copia do texto antigo (passo 10)
-- pega, pelas FKs da tabela nova, FOR KEY SHARE nas linhas de procedure e de
-- clinic dos procedimentos copiados (na producao, uma de cada): com as duas
-- tabelas ja em SHARE ROW EXCLUSIVE, so esperaria um SELECT ... FOR UPDATE
-- delas, que nenhuma funcao de hoje faz; e o lock_timeout de 3 s falharia a
-- migration inteira, sem gravar. Nesse tempo (milissegundos): o turno da IA
-- espera para gravar a decisao e o turno; a gravacao de dados da clinica e
-- do Cadastro de procedimentos espera. A LEITURA de clinic e de procedure
-- segue.
--
-- TRAVAS EM USO (sem 40P01; o contrato, secao 1.7). Ordem global: o
-- procedimento (FOR NO KEY UPDATE, nas RPCs, como em
-- salvar_requisitos_do_procedimento: serializa as RPCs e o rename do
-- procedimento sem segurar a FK de quem grava algo que aponta para ele), a
-- versao aguardando, a versao aprovada, o RT (FOR SHARE). O gatilho de
-- message trava so a versao e o RT (FOR SHARE), nunca o procedimento (senao
-- fecharia ciclo com aprovar, que trava o procedimento e depois a
-- aprovada). Suspender: o procedimento,
-- depois a aprovada. Salvar: o procedimento, depois a aguardando. Devolver e
-- descartar: o procedimento, depois a versao. Definir e encerrar o RT: so a
-- linha aberta do RT. Nenhum caminho trava o RT e depois a versao, nem a
-- versao e depois o procedimento. JANELAS ACEITAS (o gatilho nao trava a
-- linha): o rename do procedimento e o RT que perde o acesso (clinic_member)
-- so sao vistos se o commit vier antes da conferencia do gatilho; a mensagem
-- que passou foi aprovada naquele instante.
--
-- LIMITE ACEITO (o contrato, secao 6, item 11): a policy restritiva "ninguem
-- grava as acoes da conta pela sessao" de audit_log nao lista as acoes novas
-- (escreveu_preparo, aprovou_preparo, devolveu_preparo, descartou_preparo,
-- suspendeu_preparo, definiu_responsavel_tecnico,
-- encerrou_responsavel_tecnico). A sessao ainda consegue inserir uma linha
-- falsa na trilha, mas a aprovacao de verdade mora em
-- preparo_do_procedimento, que a sessao nao escreve. Fechar quando a trilha
-- for revista (AG8), sem pegar ACCESS EXCLUSIVE em audit_log agora.
--
-- Producao em 03/11/2026 (q.js e fndef.js, so leitura): a ultima migration
-- aplicada e a 20261028100000 (a AG4); a AG5 (20261029100000, md5
-- 803392216f3045ca9270e65ebc1b4e80), a AG6a (20261029120000, md5
-- 7ada4024c0d34c12907eb74d5b67a048) e a AG6b (20261030100000, md5
-- d4bab40de33e5cba300a0a94d1d94e6c) vao antes desta e ainda nao foram
-- aplicadas. O corpo que esta migration troca, por md5 de prosrc (o ensaio
-- confere de novo, na hora): mensagem_ia_exige_aprovacao
-- 1129cfc16036215e538422fba7371a1c (o do M1, igual na producao; sem
-- comentario; grants so do dono). Os CHECKs trocados, por md5 de
-- pg_get_constraintdef: ai_decision_log_desfecho_valido
-- c0d83395337e74d559861d5b8fa58801 e ai_turno_saida_valida
-- 36975878604a6c0dabc28538f3cdf1f8 (os do M1, iguais na producao). Ha 16
-- procedimentos; so 1 tem prep_instructions (9 caracteres, cabe na regra e
-- passa nas recusas: 1 copiado, 0 fora e 0 recusado). Nenhum objeto com
-- nome de preparo ou de RT existe.
-- Nenhuma linha muda de valor.
--
-- ORDEM DE PUBLICACAO: a AG5, a AG6a e a AG6b aplicadas e publicadas antes;
-- esta migration (ensaio na producao em horario calmo, ENSAIO OK, md5 dos
-- corpos, tipos gerados conferidos com ferramentas/canon-tipos.cjs); as
-- provas de banco na producao (clinicas e_de_teste, com a licao de
-- 30/10/2026); e SO DEPOIS, no mesmo dia, o codigo da AG7. Esta migration
-- com o codigo de antes (o main com a AG6b): nada muda. As tabelas nao tem
-- leitor; a coluna fica nula e o grant e de uma coluna nula; os CHECKs so
-- acrescentam valores; o gatilho aceita um caso a mais, que o codigo de
-- antes nunca grava; a regua velha continua mandando prep_instructions
-- (opcao A); as versoes copiadas ficam invisiveis. O codigo da AG7 antes
-- desta migration (NUNCA): preparo_em_vigor_do_procedimento da PGRST202 e a
-- confirmacao para em todas as clinicas; o catalogo lanca e a IA das
-- clinicas da fase falha fechado; Cadastros nao carrega a secao. Os
-- espelhos (tests/unit/ia-whatsapp/espelhos.test.ts e
-- tests/unit/agente/ag7-espelhos.test.ts) leem o grant e os CHECKs DESTA
-- migration. Esta migration nao recria os CHECKs nem as funcoes que os
-- outros espelhos leem da migration mais nova (o motivo de passagem, o
-- gatilho de entrada, o rotulo, a passagem, a atribuicao, a frase e o kind
-- da fila).
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo da AG7; DEPOIS, numa
-- transacao, no SQL editor,
-- supabase/operacao/rollback/20261103100000-corpos-anteriores.sql (volta o
-- corpo de mensagem_ia_exige_aprovacao, md5
-- 1129cfc16036215e538422fba7371a1c, sem comentario; voltam o CHECK do
-- desfecho e o da saida, NOT VALID se ja houver enviou_preparo ou preparo;
-- sai o CHECK ai_decision_log_preparo_coerente; sai a coluna
-- preparo_versao_id, e o grant sai junto; saem as RPCs e as funcoes do
-- servidor). AS DUAS TABELAS FICAM, com os gatilhos, as policies e as
-- funcoes que elas usam (preparo_texto_valido, responsavel_tecnico_vigente e
-- as dos gatilhos): sao a prova de quem aprovou o que. Opcional: copiar o
-- texto em vigor para prep_instructions, para a regua velha mandar o
-- aprovado. Um turno decidido com saida preparo no meio do rollback: o
-- codigo velho le a saida desconhecida como nula e fecha sem_envio; a
-- conversa fica na IA sem resposta ate a proxima mensagem.
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
      lock table public.ai_decision_log, public.ai_turno in access exclusive mode nowait;
      lock table public.clinic, public.procedure in share row exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 30 then
        raise exception using errcode = 'lock_not_available',
          message = 'Migration 20261103100000: ai_decision_log, ai_turno, clinic ou procedure seguiu ocupada por 3 s. Nada foi gravado: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

-- ---------------------------------------------------------------------------
-- 1) ai_decision_log: a versao do preparo e o desfecho enviou_preparo
-- ---------------------------------------------------------------------------
-- A coluna sem FK, como job_id e conversation_id da tabela (a versao vive em
-- preparo_do_procedimento, que nunca apaga versao fora da cascata da
-- clinica). A sessao le a coluna (o grant por coluna do M1).

alter table public.ai_decision_log
  add column preparo_versao_id uuid;

comment on column public.ai_decision_log.preparo_versao_id is
  'AG7: a versao de preparo_do_procedimento que o turno mandou (so com desfecho enviou_preparo; nula em qualquer outro). Sem FK, como o resto da tabela. O gatilho de message confere a mensagem do sistema por esta versao e pelo hash (texto_sha256) da mensagem montada. A sessao le (um id de versao, sem dado de paciente).';

grant select (preparo_versao_id) on public.ai_decision_log to authenticated;

-- O desfecho: o CHECK do M1 inteiro, mais enviou_preparo. Drop e add com o
-- MESMO nome, NOT VALID (o add nao varre a tabela) e VALIDATE em seguida
-- (toda linha valida no antigo e valida no novo).
alter table public.ai_decision_log
  drop constraint ai_decision_log_desfecho_valido;

alter table public.ai_decision_log
  add constraint ai_decision_log_desfecho_valido
    check (desfecho is null or desfecho in ('respondeu', 'escalou', 'bloqueou', 'falhou', 'enviou_preparo')) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_desfecho_valido;

comment on constraint ai_decision_log_desfecho_valido on public.ai_decision_log is
  'O desfecho do turno da IA: respondeu, escalou, bloqueou ou falhou (o M1) e, na AG7, enviou_preparo (o sistema mandou a orientacao de preparo aprovada pelo RT, palavra por palavra, sem texto do modelo; com a versao em preparo_versao_id e o hash da mensagem em texto_sha256: ai_decision_log_preparo_coerente).';

-- A coerencia do preparo: enviou_preparo se e so se a versao; com ele, o
-- hash da mensagem e nada do filtro nem da passagem (nao e texto do modelo,
-- nao passou pelo filtro e nao passou a conversa).
alter table public.ai_decision_log
  add constraint ai_decision_log_preparo_coerente
    check ((desfecho is not distinct from 'enviou_preparo') = (preparo_versao_id is not null)
           and (desfecho is distinct from 'enviou_preparo'
                or (texto_sha256 is not null and aprovado is not true and not compliance_blocked
                    and compliance_rule is null and camada is null and motivo_da_falha is null
                    and gatilho_entrada is null and escalation_reason is null))) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_preparo_coerente;

comment on constraint ai_decision_log_preparo_coerente on public.ai_decision_log is
  'AG7: desfecho enviou_preparo se e so se preparo_versao_id preenchido; com ele, texto_sha256 (o hash da mensagem montada pelo banco) obrigatorio e aprovado nunca verdadeiro (a mensagem nao passou pelo filtro: aprovado e do texto do modelo), sem bloqueio (compliance_blocked falso, compliance_rule e camada nulos), sem falha (motivo_da_falha nulo), sem gatilho de entrada e sem motivo de passagem.';

-- ---------------------------------------------------------------------------
-- 2) ai_turno: a saida preparo
-- ---------------------------------------------------------------------------
-- O CHECK do M1 inteiro, mais preparo. O texto do turno do preparo e nulo
-- (ai_turno_texto_coerente nao muda: texto so com saida resposta).

alter table public.ai_turno
  drop constraint ai_turno_saida_valida;

alter table public.ai_turno
  add constraint ai_turno_saida_valida
    check (saida in ('resposta', 'frase', 'nenhuma', 'preparo')) not valid;

alter table public.ai_turno
  validate constraint ai_turno_saida_valida;

comment on constraint ai_turno_saida_valida on public.ai_turno is
  'A saida decidida do turno: resposta (o texto aprovado pelo filtro), frase (a frase fixa de escalonamento), nenhuma e, na AG7, preparo (a orientacao de preparo aprovada pelo RT, montada pelo banco; o texto do turno fica nulo e o hash e o da mensagem). Nula antes de decidir.';

-- ---------------------------------------------------------------------------
-- 3) preparo_texto_valido, preparo_texto_recusado e preparo_nome_valido: as
--    regras do texto e do nome
-- ---------------------------------------------------------------------------
-- Vem antes das tabelas (os CHECKs as usam). sql e imutaveis: nao leem
-- tabela. Ninguem da API executa (os CHECKs e as RPCs rodam como o dono).

create function public.preparo_texto_valido(p_texto text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select p_texto is not null
     -- De 1 a 3.500 caracteres, aparado pelos 25 brancos do trim() do
     -- JavaScript (D-84: a mensagem inteira cabe nos 4.096 do WhatsApp).
     and public.cadastro_texto_valido(p_texto, 3500)
     -- Ja normalizado: NFC, so LF (a tela normaliza antes de mandar).
     and p_texto is nfc normalized
     and position(E'\r' in p_texto) = 0
     -- Nenhum caractere de controle alem do LF (o tab tambem fica fora).
     and p_texto !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]'
     -- Nenhum invisivel (hifen suave, larguras zero, marcas de direcao,
     -- separadores de linha e de paragrafo, BOM).
     and p_texto !~ '[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]'
     -- Sem chaves duplas: a regua as apagaria (o renderizador tira toda
     -- sobra de marcador), e o texto que sai tem de ser o aprovado.
     and position('{{' in p_texto) = 0
     and position('}}' in p_texto) = 0
$function$;

revoke all on function public.preparo_texto_valido(text)
  from public, anon, authenticated, service_role;

comment on function public.preparo_texto_valido(text) is
  'Interna (AG7; nenhum papel da API executa: o CHECK preparo_do_procedimento_texto_valido e as RPCs rodam como o dono). Verdadeiro so se o texto da orientacao de preparo nao e nulo, tem de 1 a 3.500 caracteres e esta aparado pela regra do trim() do JavaScript (cadastro_texto_valido), esta em NFC, nao tem CR, nao tem caractere de controle alem do LF (o tab tambem fica fora), nao tem invisivel (U+00AD, U+200B a U+200F, U+2028, U+2029, U+202A a U+202E, U+2060 a U+2064, U+FEFF) e nao tem {{ nem }} (a regua as apagaria). Espelho: textoDoPreparoValido em lib/domain/preparo.ts. Pura. O conteudo e outra conferencia: preparo_texto_recusado.';

-- O conteudo que o banco recusa sozinho (CFM-2): um PEDACO do que
-- problemasDoTextoDoPreparo (lib/domain/conformidade/preparo-aprovado.ts)
-- recusa no TS, o que da para conferir com seguranca em SQL. Tudo o que
-- esta funcao recusa o TS tambem recusa (a paridade do harness confere num
-- corpus): a visao base aqui e mais curta que a do filtro (NFKD, sem os
-- acentos U+0300 a U+036F, minusculas), e os padroes sao os do filtro ou
-- mais estreitos. Fica SO no TS: promessa, oferta casada, antes e depois, o
-- preco por extenso ou sem numero, a moeda estrangeira, o desconto, o link
-- espacado ou por extenso ("ponto com"), o alfabeto estranho e as marcas
-- empilhadas. Vem antes da tabela, como preparo_texto_valido; nao le
-- tabela.
create function public.preparo_texto_recusado(p_texto text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select coalesce(
           -- O link: "://", http ou https como palavra, "www." ou um dominio
           -- (2 ou mais letras, digitos ou hifen, o ponto e uma das
           -- terminacoes do filtro, com o pais opcional).
           b.base ~ '(://|\mhttps?\M|\mwww\.|\m[a-z0-9-]{2,}\.(com|net|org|br|io|ly|me|gl|co|app|link|site|info|xyz|online|store|shop|page|to|cc|ai|gg|tk|ml)(\.[a-z]{2})?\M)'
           -- O valor em reais: "R$" seguido do numero, ou o numero seguido
           -- de "reais".
           or b.base ~ '(\mr\$ ?[0-9]|\m[0-9]+([.,][0-9]+)* ?reais\M)'
           -- O arroba: "@" seguido de 2 ou mais letras, digitos, ponto ou
           -- sublinhado, no comeco ou depois de branco ou pontuacao (nunca
           -- o e-mail, que o dominio ja pega), e a palavra "arroba".
           or b.base ~ '((^|[[:space:](){}"'',;:!?/*<>=|])@[a-z0-9_.]{2,}|\marroba\M)'
           -- No texto como veio: os invisiveis que o filtro recusa e
           -- preparo_texto_valido nao (U+034F, U+061C, U+115F, U+1160,
           -- U+180E, U+2066 a U+2069, U+2800, U+3164, U+FFA0, as etiquetas
           -- U+E0000 a U+E007F) e o seletor de variacao colado numa letra
           -- ou digito (o "1" do emoji de tecla).
           or p_texto ~ '[\u034f\u061c\u115f\u1160\u180e\u2066-\u2069\u2800\u3164\uffa0\U000e0000-\U000e007f]'
           or p_texto ~ '[0-9A-Za-z][\ufe00-\ufe0f]',
           false)
    from (select regexp_replace(lower(normalize(p_texto, nfkd)), '[\u0300-\u036f]', '', 'g') as base) as b
$function$;

revoke all on function public.preparo_texto_recusado(text)
  from public, anon, authenticated, service_role;

comment on function public.preparo_texto_recusado(text) is
  'Interna (AG7, CFM-2; nenhum papel da API executa: as RPCs salvar_preparo_do_procedimento e aprovar_preparo_do_procedimento e a copia do texto antigo rodam como o dono). Verdadeiro se o texto da orientacao de preparo tem link ("://", http ou https, "www." ou dominio com uma das terminacoes do filtro), valor em reais ("R$" com numero ou numero com "reais"), arroba ("@" com 2 ou mais caracteres, fora de e-mail, ou a palavra) ou um invisivel que o filtro recusa e preparo_texto_valido nao. Um pedaco do que problemasDoTextoDoPreparo recusa no TS (tudo o que esta recusa, o TS recusa): promessa, oferta casada, antes e depois e o resto ficam so no TS. Nulo: falso. Pura.';

-- O nome que vai no cabecalho da mensagem ao paciente: o do procedimento
-- (preparo_do_procedimento.nome_do_procedimento) e o do RT
-- (responsavel_tecnico.nome). Vem antes das tabelas (os CHECKs a usam).
create function public.preparo_nome_valido(p_nome text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $function$
  select p_nome is not null
     -- De 1 a 120 caracteres, aparado pelos 25 brancos do trim() do
     -- JavaScript.
     and public.cadastro_texto_valido(p_nome, 120)
     -- Nenhum caractere de controle (C0, DEL e C1).
     and p_nome !~ '[\x00-\x1f\x7f-\x9f]'
     -- Nenhum invisivel nem marca ou isolamento de direcao (os do texto e os
     -- que o filtro tambem recusa): reordenariam a linha que o paciente le.
     and p_nome !~ '[\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2800\u3164\ufeff\uffa0\U000e0000-\U000e007f]'
$function$;

revoke all on function public.preparo_nome_valido(text)
  from public, anon, authenticated, service_role;

comment on function public.preparo_nome_valido(text) is
  'Interna (AG7; nenhum papel da API executa: os CHECKs responsavel_tecnico_nome_valido e preparo_do_procedimento_nome_valido e as RPCs rodam como o dono). Verdadeiro so se o nome (o do procedimento ou o do RT, que vao no cabecalho da mensagem ao paciente) nao e nulo, tem de 1 a 120 caracteres, esta aparado pela regra do trim() do JavaScript (cadastro_texto_valido), nao tem caractere de controle (C0, DEL, C1) e nao tem invisivel nem marca ou isolamento de direcao (U+00AD, U+034F, U+061C, U+115F, U+1160, U+180E, U+200B a U+200F, U+2028, U+2029, U+202A a U+202E, U+2060 a U+2064, U+2066 a U+2069, U+2800, U+3164, U+FEFF, U+FFA0 e U+E0000 a U+E007F). Pura.';

-- ---------------------------------------------------------------------------
-- 4) responsavel_tecnico: o RT de cada clinica
-- ---------------------------------------------------------------------------
-- Uma linha por designacao, com o historico (a linha encerrada fica). Sem FK
-- para auth.users nem para clinic_member (nao trava login nem a equipe): a
-- RPC exige o vinculo ativo, e o vigente o confere a cada leitura. Sem
-- professional_id (o contrato, secao 0, item 4: nenhuma tela o le, e a FK
-- travaria professional).

create table public.responsavel_tecnico (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null
    constraint responsavel_tecnico_clinic_id_fkey references public.clinic (id) on delete cascade,
  user_id uuid not null,
  nome text not null,
  conselho text not null,
  numero text not null,
  uf text not null,
  desde timestamptz not null default now(),
  ate timestamptz,
  definido_por uuid,
  encerrado_por uuid,
  constraint responsavel_tecnico_nome_valido check (
    public.preparo_nome_valido(nome)),
  constraint responsavel_tecnico_conselho_valido check (
    conselho in ('CRM', 'CRO', 'CRBM', 'CRF', 'COREN', 'CREFITO', 'CRN', 'CRP', 'CRFa', 'CREF')),
  constraint responsavel_tecnico_numero_valido check (
    numero ~ '^[0-9A-Za-z./-]{1,20}$'),
  constraint responsavel_tecnico_uf_valida check (
    uf in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
           'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO')),
  constraint responsavel_tecnico_encerramento_coerente check (
    (ate is null) = (encerrado_por is null) and (ate is null or ate >= desde))
);

-- Um RT aberto por clinica (D-86: uma unidade, um RT).
create unique index responsavel_tecnico_um_aberto
  on public.responsavel_tecnico (clinic_id)
  where ate is null;

-- So o encerramento muda a linha: ate e encerrado_por, de nulo para
-- preenchido, uma vez. Vale para todo papel (a service role e o dono
-- inclusive).
create function public.responsavel_tecnico_nao_muda()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.id is distinct from old.id
     or new.clinic_id is distinct from old.clinic_id
     or new.user_id is distinct from old.user_id
     or new.nome is distinct from old.nome
     or new.conselho is distinct from old.conselho
     or new.numero is distinct from old.numero
     or new.uf is distinct from old.uf
     or new.desde is distinct from old.desde
     or new.definido_por is distinct from old.definido_por
     or old.ate is not null
     or old.encerrado_por is not null
     or new.ate is null
     or new.encerrado_por is null
  then
    raise exception using errcode = '23514', message = 'responsavel_tecnico_nao_muda';
  end if;
  return new;
end;
$function$;

revoke all on function public.responsavel_tecnico_nao_muda()
  from public, anon, authenticated, service_role;

comment on function public.responsavel_tecnico_nao_muda() is
  'Funcao do gatilho responsavel_tecnico_nao_muda (AG7): so o encerramento muda a linha do RT (ate e encerrado_por, de nulo para preenchido, uma vez); qualquer outra mudanca da 23514 responsavel_tecnico_nao_muda. Vale para todo papel. Ninguem executa direto.';

create trigger responsavel_tecnico_nao_muda
  before update on public.responsavel_tecnico
  for each row
  execute function public.responsavel_tecnico_nao_muda();

comment on trigger responsavel_tecnico_nao_muda on public.responsavel_tecnico is
  'AG7: a designacao do RT e imutavel; so o encerramento, uma vez (23514 responsavel_tecnico_nao_muda).';

alter table public.responsavel_tecnico enable row level security;

-- Ninguem grava pela API: so as RPCs (SECURITY DEFINER). A sessao e a
-- service role so leem.
revoke all on table public.responsavel_tecnico from public, anon, authenticated, service_role;
grant select on table public.responsavel_tecnico to authenticated, service_role;

comment on table public.responsavel_tecnico is
  'O responsavel tecnico (RT) de cada clinica (AG7, D-70, D-85, D-86): uma linha por designacao, com o historico (a encerrada fica). Um aberto por clinica (responsavel_tecnico_um_aberto). O VIGENTE e o aberto cujo user_id tem clinic_member ativo na clinica (responsavel_tecnico_vigente): o RT que perde o acesso deixa de ser vigente na hora. So definir_responsavel_tecnico e encerrar_responsavel_tecnico gravam (SECURITY DEFINER); a sessao e a service role so leem. RLS: membro ativo da clinica ou super admin. Nome, conselho, numero e UF sao os do conselho, informados pela clinica (nunca os do cadastro do profissional); a conferencia no portal do conselho e do checklist da producao (AG8). A AG6c reaproveita a tabela.';
comment on column public.responsavel_tecnico.clinic_id is
  'A clinica (FK em cascata).';
comment on column public.responsavel_tecnico.user_id is
  'A pessoa com acesso ao sistema que e o RT (qualquer papel, inclusive Somente leitura). Sem FK (nao trava auth.users nem clinic_member): definir_responsavel_tecnico exige clinic_member ativo, e o vigente o confere a cada leitura.';
comment on column public.responsavel_tecnico.nome is
  'O nome como esta no conselho (preparo_nome_valido: 1 a 120, aparado, sem controle, sem invisivel e sem marca de direcao). Vai na mensagem do preparo ao paciente.';
comment on column public.responsavel_tecnico.conselho is
  'O conselho: CRM, CRO, CRBM, CRF, COREN, CREFITO, CRN, CRP, CRFa ou CREF (D-70, PROPOSTA).';
comment on column public.responsavel_tecnico.numero is
  'O numero do registro no conselho (1 a 20 de letras, digitos, ponto, barra e hifen).';
comment on column public.responsavel_tecnico.uf is
  'A UF do registro (uma das 27).';
comment on column public.responsavel_tecnico.desde is
  'Quando a designacao comecou.';
comment on column public.responsavel_tecnico.ate is
  'Quando a designacao acabou (nula enquanto aberta). Com ela, encerrado_por.';
comment on column public.responsavel_tecnico.definido_por is
  'Quem definiu (auth.uid() de quem chamou definir_responsavel_tecnico).';
comment on column public.responsavel_tecnico.encerrado_por is
  'Quem encerrou (auth.uid() de quem chamou encerrar_responsavel_tecnico ou definiu outro RT). Preenchido se e so se ate.';

-- ---------------------------------------------------------------------------
-- 5) preparo_do_procedimento: as versoes do texto
-- ---------------------------------------------------------------------------
-- Versoes imutaveis: o texto, o hash, o procedimento, a clinica, o numero,
-- o nome do procedimento, a origem e a autoria nunca mudam; so a situacao
-- anda (aguardando_rt para aprovado, devolvido ou descartado; aprovado para
-- substituido ou suspenso; o resto e terminal). A aprovacao vale para o
-- texto, o nome do procedimento da versao e o RT que aprovou. FK para
-- procedure NO ACTION (o historico fica; a cascata da clinica apaga as duas
-- no mesmo comando).

create table public.preparo_do_procedimento (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null
    constraint preparo_do_procedimento_clinic_id_fkey references public.clinic (id) on delete cascade,
  procedure_id uuid not null
    constraint preparo_do_procedimento_procedure_id_fkey references public.procedure (id),
  versao integer not null,
  texto text not null,
  texto_sha256 text not null,
  nome_do_procedimento text not null,
  origem text not null,
  situacao text not null,
  escrito_por uuid,
  escrito_em timestamptz not null default now(),
  aprovado_por uuid,
  aprovado_em timestamptz,
  rt_id uuid
    constraint preparo_do_procedimento_rt_id_fkey references public.responsavel_tecnico (id),
  encerrado_por uuid,
  encerrado_em timestamptz,
  comentario text,
  constraint preparo_do_procedimento_procedure_id_versao_key unique (procedure_id, versao),
  constraint preparo_do_procedimento_situacao_valida check (
    situacao in ('aguardando_rt', 'aprovado', 'devolvido', 'descartado', 'substituido', 'suspenso')),
  constraint preparo_do_procedimento_origem_valida check (
    origem in ('cadastro', 'texto_antigo')),
  constraint preparo_do_procedimento_versao_valida check (
    versao >= 1),
  constraint preparo_do_procedimento_texto_valido check (
    public.preparo_texto_valido(texto)),
  constraint preparo_do_procedimento_sha_formato check (
    texto_sha256 ~ '^[0-9a-f]{64}$'),
  constraint preparo_do_procedimento_nome_valido check (
    public.preparo_nome_valido(nome_do_procedimento)),
  constraint preparo_do_procedimento_comentario_valido check (
    public.cadastro_texto_valido(comentario, 300)),
  constraint preparo_do_procedimento_autoria_coerente check (
    origem = 'texto_antigo' or escrito_por is not null),
  constraint preparo_do_procedimento_aprovacao_coerente check (
    (aprovado_em is null) = (aprovado_por is null)
    and (aprovado_em is null) = (rt_id is null)
    and (aprovado_em is not null) = (situacao in ('aprovado', 'substituido', 'suspenso'))),
  constraint preparo_do_procedimento_encerramento_coerente check (
    (encerrado_em is null) = (encerrado_por is null)
    and (encerrado_em is not null) = (situacao in ('devolvido', 'descartado', 'substituido', 'suspenso'))),
  constraint preparo_do_procedimento_comentario_coerente check (
    (comentario is null or situacao in ('devolvido', 'descartado', 'suspenso'))
    and (situacao <> 'devolvido' or comentario is not null))
);

-- Uma aprovada e uma aguardando por procedimento; a tela le por clinica e
-- situacao.
create unique index preparo_do_procedimento_um_aprovado
  on public.preparo_do_procedimento (procedure_id)
  where situacao = 'aprovado';
create unique index preparo_do_procedimento_um_aguardando
  on public.preparo_do_procedimento (procedure_id)
  where situacao = 'aguardando_rt';
create index preparo_do_procedimento_clinica_idx
  on public.preparo_do_procedimento (clinic_id, situacao);

-- Ao inserir: o hash do texto (convert_to e STABLE: nao serve em coluna
-- gerada), a versao nasce aguardando o RT, sem aprovacao nem encerramento, e
-- o procedimento e da mesma clinica. Vale para todo papel.
create function public.preparo_do_procedimento_ao_inserir()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_clinica uuid;
begin
  new.texto_sha256 := encode(sha256(convert_to(new.texto, 'UTF8')), 'hex');
  if new.situacao is distinct from 'aguardando_rt'
     or new.aprovado_por is not null
     or new.aprovado_em is not null
     or new.rt_id is not null
     or new.encerrado_por is not null
     or new.encerrado_em is not null
  then
    raise exception using errcode = '23514', message = 'versao_nasce_aguardando';
  end if;
  select p.clinic_id into v_clinica
    from public.procedure p
   where p.id = new.procedure_id;
  if v_clinica is distinct from new.clinic_id then
    raise exception using errcode = '23514', message = 'procedimento_de_outra_clinica';
  end if;
  return new;
end;
$function$;

revoke all on function public.preparo_do_procedimento_ao_inserir()
  from public, anon, authenticated, service_role;

comment on function public.preparo_do_procedimento_ao_inserir() is
  'Funcao do gatilho preparo_do_procedimento_ao_inserir (AG7): grava texto_sha256 (sha256 do texto em UTF-8, hexadecimal); a versao nasce aguardando_rt, sem aprovacao e sem encerramento (senao 23514 versao_nasce_aguardando); o procedimento e da mesma clinica (senao 23514 procedimento_de_outra_clinica). Vale para todo papel. Ninguem executa direto.';

create trigger preparo_do_procedimento_ao_inserir
  before insert on public.preparo_do_procedimento
  for each row
  execute function public.preparo_do_procedimento_ao_inserir();

comment on trigger preparo_do_procedimento_ao_inserir on public.preparo_do_procedimento is
  'AG7: o hash da versao, a versao nasce aguardando o RT e o procedimento e da mesma clinica (23514 versao_nasce_aguardando ou procedimento_de_outra_clinica).';

-- Ao mudar: nada da versao muda; so a situacao anda pelas transicoes
-- permitidas; a aprovacao (defesa em profundidade da D-71) so com o RT
-- vigente, quem aprova e ele, e o hash recalculado confere. Vale para todo
-- papel (a service role e o dono inclusive).
create function public.preparo_do_procedimento_nao_muda()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_rt uuid;
  v_usuario_do_rt uuid;
begin
  if new.id is distinct from old.id
     or new.texto is distinct from old.texto
     or new.texto_sha256 is distinct from old.texto_sha256
     or new.procedure_id is distinct from old.procedure_id
     or new.clinic_id is distinct from old.clinic_id
     or new.versao is distinct from old.versao
     or new.nome_do_procedimento is distinct from old.nome_do_procedimento
     or new.origem is distinct from old.origem
     or new.escrito_por is distinct from old.escrito_por
     or new.escrito_em is distinct from old.escrito_em
  then
    raise exception using errcode = '23514', message = 'preparo_nao_muda';
  end if;
  if not ((old.situacao = 'aguardando_rt' and new.situacao in ('aprovado', 'devolvido', 'descartado'))
          or (old.situacao = 'aprovado' and new.situacao in ('substituido', 'suspenso')))
  then
    raise exception using errcode = '23514', message = 'transicao_invalida';
  end if;
  if new.situacao = 'aprovado' then
    -- A passagem para aprovado: o RT vigente de agora, quem aprova e ele, e
    -- o texto ainda e o do hash.
    v_rt := public.responsavel_tecnico_vigente(new.clinic_id);
    select r.user_id into v_usuario_do_rt
      from public.responsavel_tecnico r
     where r.id = v_rt;
    if v_rt is null
       or new.rt_id is distinct from v_rt
       or new.aprovado_por is distinct from v_usuario_do_rt
       or encode(sha256(convert_to(new.texto, 'UTF8')), 'hex') is distinct from new.texto_sha256
    then
      raise exception using errcode = '23514', message = 'aprovacao_incoerente';
    end if;
  elsif new.aprovado_por is distinct from old.aprovado_por
        or new.aprovado_em is distinct from old.aprovado_em
        or new.rt_id is distinct from old.rt_id
  then
    -- Nas outras passagens, a aprovacao fica como estava.
    raise exception using errcode = '23514', message = 'aprovacao_incoerente';
  end if;
  return new;
end;
$function$;

revoke all on function public.preparo_do_procedimento_nao_muda()
  from public, anon, authenticated, service_role;

comment on function public.preparo_do_procedimento_nao_muda() is
  'Funcao do gatilho preparo_do_procedimento_nao_muda (AG7): o texto, o hash, o procedimento, a clinica, a versao, o nome do procedimento, a origem e a autoria nunca mudam (23514 preparo_nao_muda); so as transicoes aguardando_rt para aprovado, devolvido ou descartado e aprovado para substituido ou suspenso (23514 transicao_invalida); na passagem para aprovado, rt_id e o RT vigente da clinica, aprovado_por e o user_id dele e o hash recalculado confere; nas outras, a aprovacao fica como estava (23514 aprovacao_incoerente). Vale para todo papel. Ninguem executa direto.';

create trigger preparo_do_procedimento_nao_muda
  before update on public.preparo_do_procedimento
  for each row
  execute function public.preparo_do_procedimento_nao_muda();

comment on trigger preparo_do_procedimento_nao_muda on public.preparo_do_procedimento is
  'AG7: a versao e imutavel; so a situacao anda, e a aprovacao so pelo RT vigente com o hash conferido (23514 preparo_nao_muda, transicao_invalida ou aprovacao_incoerente).';

alter table public.preparo_do_procedimento enable row level security;

-- Ninguem grava pela API: so as RPCs (SECURITY DEFINER). O DELETE so pela
-- cascata da clinica (a acao de FK roda como dono).
revoke all on table public.preparo_do_procedimento from public, anon, authenticated, service_role;
grant select on table public.preparo_do_procedimento to authenticated, service_role;

comment on table public.preparo_do_procedimento is
  'As versoes da orientacao de preparo de cada procedimento (AG7, D-72, D-80, D-83): imutaveis (gatilho preparo_do_procedimento_nao_muda), com o hash do texto, a situacao (aguardando_rt, aprovado, devolvido, descartado, substituido, suspenso) e a aprovacao (o RT vigente, quem aprovou e quando). Uma aprovada e uma aguardando por procedimento. A aprovacao vale para o texto, o nome do procedimento da versao e o RT que aprovou: EM VIGOR (preparo_em_vigor) so com os tres de agora. Remedio, dose e jejum sao aceitos no texto (D-80): ele sai como mensagem do sistema, palavra por palavra, nunca pelo modelo. So as RPCs gravam (SECURITY DEFINER); a sessao e a service role so leem. RLS: membro ativo da clinica ou super admin. O texto nao e dado de paciente.';
comment on column public.preparo_do_procedimento.clinic_id is
  'A clinica (FK em cascata); a mesma do procedimento (gatilho de insert).';
comment on column public.preparo_do_procedimento.procedure_id is
  'O procedimento (FK NO ACTION: o historico fica; a cascata da clinica apaga as duas no mesmo comando).';
comment on column public.preparo_do_procedimento.versao is
  'O numero da versao no procedimento (1, 2, 3...; unico com o procedimento).';
comment on column public.preparo_do_procedimento.texto is
  'O texto da orientacao de preparo, exatamente como sai (preparo_texto_valido: 1 a 3.500, NFC, so LF, sem controle, sem invisivel, sem chaves duplas). Nunca muda.';
comment on column public.preparo_do_procedimento.texto_sha256 is
  'O sha256 do texto em UTF-8, hexadecimal minusculo, gravado pelo gatilho de insert. O codigo na tela sao os 8 primeiros.';
comment on column public.preparo_do_procedimento.nome_do_procedimento is
  'O nome do procedimento quando a versao nasceu (preparo_nome_valido): a aprovacao vale para este nome (renomear o procedimento tira a aprovacao).';
comment on column public.preparo_do_procedimento.origem is
  'cadastro (escrito na tela) ou texto_antigo (copiado de procedure.prep_instructions pela migration, D-83).';
comment on column public.preparo_do_procedimento.situacao is
  'aguardando_rt (nasce assim), aprovado (o RT aprovou), devolvido (o RT devolveu, com comentario), descartado (descartado ou trocado por um texto novo), substituido (outra versao foi aprovada) ou suspenso (o envio foi suspenso).';
comment on column public.preparo_do_procedimento.escrito_por is
  'Quem escreveu (auth.uid() de quem salvou); nulo so no texto_antigo.';
comment on column public.preparo_do_procedimento.escrito_em is
  'Quando a versao nasceu.';
comment on column public.preparo_do_procedimento.aprovado_por is
  'O user_id do RT que aprovou (preenchido com aprovado_em e rt_id, so na passagem para aprovado).';
comment on column public.preparo_do_procedimento.aprovado_em is
  'Quando o RT aprovou.';
comment on column public.preparo_do_procedimento.rt_id is
  'A designacao do RT que aprovou (FK responsavel_tecnico): a mensagem leva o nome e o registro dela, e a aprovacao so vale enquanto ela for a vigente.';
comment on column public.preparo_do_procedimento.encerrado_por is
  'Quem devolveu, descartou, substituiu (aprovando outra) ou suspendeu.';
comment on column public.preparo_do_procedimento.encerrado_em is
  'Quando a versao saiu de aguardando ou de aprovado.';
comment on column public.preparo_do_procedimento.comentario is
  'O comentario do RT ao devolver (obrigatorio), o motivo ao suspender (opcional) ou "Trocado por um texto novo." no descarte pelo texto novo. 1 a 300, aparado. Nunca dado de paciente.';
comment on constraint preparo_do_procedimento_texto_valido on public.preparo_do_procedimento is
  'AG7: o texto segue preparo_texto_valido (espelho: textoDoPreparoValido em lib/domain/preparo.ts).';
comment on constraint preparo_do_procedimento_aprovacao_coerente on public.preparo_do_procedimento is
  'AG7: aprovado_por, aprovado_em e rt_id preenchidos juntos, e so nas situacoes aprovado, substituido e suspenso.';
comment on constraint preparo_do_procedimento_encerramento_coerente on public.preparo_do_procedimento is
  'AG7: encerrado_por e encerrado_em preenchidos juntos, e so nas situacoes devolvido, descartado, substituido e suspenso.';
comment on constraint preparo_do_procedimento_comentario_coerente on public.preparo_do_procedimento is
  'AG7: comentario so em devolvido, descartado ou suspenso; obrigatorio em devolvido.';

-- ---------------------------------------------------------------------------
-- 6) As funcoes internas e as de leitura
-- ---------------------------------------------------------------------------

-- O RT vigente da clinica: o aberto com acesso ativo (falha fechada).
create function public.responsavel_tecnico_vigente(p_clinic_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  select r.id into v_id
    from public.responsavel_tecnico r
   where r.clinic_id = p_clinic_id
     and r.ate is null
     and exists (
       select 1 from public.clinic_member m
        where m.clinic_id = r.clinic_id
          and m.user_id = r.user_id
          and m.status = 'ativo'
     );
  return v_id;
end;
$function$;

revoke all on function public.responsavel_tecnico_vigente(uuid)
  from public, anon, authenticated, service_role;

comment on function public.responsavel_tecnico_vigente(uuid) is
  'Interna (AG7; nenhum papel da API executa): o id da designacao aberta (ate nulo) de responsavel_tecnico da clinica cujo user_id tem clinic_member da clinica com status ativo; nulo se nao houver. O RT que perde o acesso deixa de ser vigente na hora (falha fechada). Usada pelo gatilho de aprovacao, por preparo_em_vigor e pelas RPCs.';

-- A sessao e o RT vigente desta clinica? (as telas e as RPCs)
create function public.user_e_responsavel_tecnico(p_clinic_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or p_clinic_id is null then
    return false;
  end if;
  -- Conta suspensa: a equipe da clinica nao le nem escreve nada (como
  -- user_has_role, user_active_clinic_ids e user_can_write; BANCO-1).
  if exists (select 1 from public.clinica_suspensa s where s.clinic_id = p_clinic_id) then
    return false;
  end if;
  -- O super admin nunca age como RT, nem com vinculo ativo e designado antes
  -- (D-71: aprovar e ato clinico; TELA-9).
  if public.is_product_admin() then
    return false;
  end if;
  return exists (
    select 1 from public.responsavel_tecnico r
     where r.id = public.responsavel_tecnico_vigente(p_clinic_id)
       and r.user_id = auth.uid()
  );
end;
$function$;

revoke all on function public.user_e_responsavel_tecnico(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.user_e_responsavel_tecnico(uuid)
  to authenticated, service_role;

comment on function public.user_e_responsavel_tecnico(uuid) is
  'A sessao (auth.uid()) e o RT vigente desta clinica e pode agir como RT? (AG7; as telas e as RPCs.) Falso sem sessao ou sem clinica, na clinica de conta suspensa (clinica_suspensa: a equipe da clinica nao escreve nada, como em user_has_role) e para o super admin (is_product_admin, mesmo com vinculo ativo e designado antes: D-71). Nao entra em policy de dado de paciente.';

-- A versao esta em vigor? (a definicao do cabecalho)
create function public.preparo_em_vigor(p_clinic_id uuid, p_versao_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_versao record;
  v_nome text;
  v_clinica_do_procedimento uuid;
begin
  if p_clinic_id is null or p_versao_id is null then
    return false;
  end if;
  select v.clinic_id, v.procedure_id, v.situacao, v.texto, v.texto_sha256, v.rt_id, v.nome_do_procedimento
    into v_versao
    from public.preparo_do_procedimento v
   where v.id = p_versao_id;
  if not found
     or v_versao.clinic_id is distinct from p_clinic_id
     or v_versao.situacao is distinct from 'aprovado'
  then
    return false;
  end if;
  -- O hash recalculado (falha fechada se a linha foi mexida com o gatilho
  -- desligado).
  if encode(sha256(convert_to(v_versao.texto, 'UTF8')), 'hex') is distinct from v_versao.texto_sha256 then
    return false;
  end if;
  -- O RT que aprovou e o vigente de agora (D-73).
  if v_versao.rt_id is null
     or v_versao.rt_id is distinct from public.responsavel_tecnico_vigente(p_clinic_id)
  then
    return false;
  end if;
  -- O procedimento da mesma clinica, com o nome da aprovacao.
  select p.name, p.clinic_id into v_nome, v_clinica_do_procedimento
    from public.procedure p
   where p.id = v_versao.procedure_id;
  if not found
     or v_clinica_do_procedimento is distinct from p_clinic_id
     or v_nome is distinct from v_versao.nome_do_procedimento
  then
    return false;
  end if;
  return true;
end;
$function$;

revoke all on function public.preparo_em_vigor(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.preparo_em_vigor(uuid, uuid) is
  'Interna (AG7; nenhum papel da API executa): verdadeiro so se a versao e da clinica, esta aprovada, o hash recalculado do texto bate com texto_sha256, rt_id e o RT vigente de agora (D-73), o procedimento e da mesma clinica e o nome dele e o nome_do_procedimento da versao (renomear tira a aprovacao). O procedimento inativo continua em vigor (a regua das consultas que ja existem). Qualquer nulo: falso.';

-- A mensagem do preparo, montada pelo banco (o espelho TS e
-- mensagemDoPreparo em lib/domain/preparo.ts).
create function public.mensagem_do_preparo(p_versao_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_mensagem text;
begin
  select format(E'Orientação de preparo para %s\nResponsável técnico da clínica: %s (%s-%s %s)\n\n%s\n\nSe tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda.',
                v.nome_do_procedimento, r.nome, r.conselho, r.uf, r.numero, v.texto)
    into v_mensagem
    from public.preparo_do_procedimento v
    join public.responsavel_tecnico r on r.id = v.rt_id
   where v.id = p_versao_id;
  return v_mensagem;
end;
$function$;

revoke all on function public.mensagem_do_preparo(uuid)
  from public, anon, authenticated, service_role;

comment on function public.mensagem_do_preparo(uuid) is
  'Interna (AG7; nenhum papel da API executa): a mensagem do preparo da versao, como o paciente recebe: "Orientação de preparo para {nome_do_procedimento}", a linha "Responsável técnico da clínica: {nome} ({conselho}-{uf} {numero})" do RT que aprovou (rt_id), uma linha em branco, o texto, uma linha em branco e o rodape "Se tiver qualquer dúvida sobre o preparo, responda por aqui que a equipe da clínica te ajuda." (PROPOSTA, D-77). Nula sem a versao ou sem o RT dela. Espelho: mensagemDoPreparo em lib/domain/preparo.ts. Nao confere se esta em vigor (quem chama confere).';

-- A mensagem para o envio (o executor e o simulador).
create function public.ler_preparo_para_envio(p_clinic_id uuid, p_versao_id uuid, p_simulador boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_skills jsonb;
  v_mensagem text;
  v_procedimento uuid;
  v_numero integer;
begin
  if p_clinic_id is null or p_versao_id is null or p_simulador is null then
    return null;
  end if;
  if not public.preparo_em_vigor(p_clinic_id, p_versao_id) then
    return null;
  end if;
  -- A habilidade na ULTIMA versao publicada (a que o agente le no
  -- WhatsApp). O simulador testa o rascunho: ali a chave e do rascunho.
  if not p_simulador then
    select a.skills into v_skills
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1;
    if (v_skills ->> 'enviar_preparo') is distinct from 'true' then
      return null;
    end if;
  end if;
  v_mensagem := public.mensagem_do_preparo(p_versao_id);
  if v_mensagem is null then
    return null;
  end if;
  select v.procedure_id, v.versao into v_procedimento, v_numero
    from public.preparo_do_procedimento v
   where v.id = p_versao_id;
  return jsonb_build_object(
    'versao_id', p_versao_id,
    'procedure_id', v_procedimento,
    'versao', v_numero,
    'mensagem', v_mensagem,
    'sha256', encode(sha256(convert_to(v_mensagem, 'UTF8')), 'hex'));
end;
$function$;

revoke all on function public.ler_preparo_para_envio(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.ler_preparo_para_envio(uuid, uuid, boolean)
  to service_role;

comment on function public.ler_preparo_para_envio(uuid, uuid, boolean) is
  'So o servidor (service_role; o executor da IA e o simulador da Tela 6). AG7: a mensagem do preparo pronta para sair: {versao_id, procedure_id, versao, mensagem, sha256}, com o sha256 da mensagem montada (UTF-8, hexadecimal). Nulo em tres casos: algum parametro nulo; a versao nao esta em vigor (preparo_em_vigor); ou, fora do simulador (p_simulador falso, o padrao), a ULTIMA versao publicada do agente sem skills ->> enviar_preparo = true (o simulador testa o rascunho e pula essa conferencia). O texto nunca vai ao modelo: so o sistema envia.';

-- Os preparos em vigor da clinica, sem o texto (o catalogo do turno).
create function public.preparos_em_vigor_da_clinica(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'procedure_id', v.procedure_id,
             'versao_id', v.id,
             'versao', v.versao,
             'texto_sha256', v.texto_sha256,
             'rt_nome', r.nome,
             'aprovado_em', v.aprovado_em) order by v.procedure_id)
      from public.preparo_do_procedimento v
      join public.responsavel_tecnico r on r.id = v.rt_id
     where v.clinic_id = p_clinic_id
       and v.situacao = 'aprovado'
       and public.preparo_em_vigor(p_clinic_id, v.id)
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.preparos_em_vigor_da_clinica(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preparos_em_vigor_da_clinica(uuid)
  to service_role;

comment on function public.preparos_em_vigor_da_clinica(uuid) is
  'So o servidor (service_role; o catalogo do agente). AG7: a lista [{procedure_id, versao_id, versao, texto_sha256, rt_nome, aprovado_em}] das versoes em vigor da clinica (preparo_em_vigor; o procedimento inativo entra: quem monta o catalogo filtra os ativos), SEM o texto, em ordem de procedure_id; sem nenhuma, []. Clinica nula: 22004 parametro_nulo.';

-- Os textos da clinica que o filtro e o historico escondem (nunca vao ao
-- modelo): so o que pode ter chegado a paciente (BANCO-3: a lista so cresce
-- com a aprovacao do RT, e nao com cada Salvar).
create function public.textos_de_preparo_da_clinica(p_clinic_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  -- Os 25 brancos do trim() do JavaScript (os de cadastro_texto_valido).
  c_brancos constant text := E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
begin
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  return coalesce((
    select array_agg(t.texto order by t.texto collate "C")
      from (
        -- A versao que ja valeu (aprovado_em nao nulo: aprovado, substituido
        -- ou suspenso, pelo CHECK preparo_do_procedimento_aprovacao_coerente;
        -- a IA e a regua so mandam a em vigor) e a copia do texto antigo, de
        -- qualquer situacao (a regua de antes da AG7 ja o mandou, opcao A).
        -- Aguardando, devolvida e descartada de origem cadastro nunca sairam
        -- do sistema e nao entram (o teto do filtro).
        select v.texto
          from public.preparo_do_procedimento v
         where v.clinic_id = p_clinic_id
           and (v.aprovado_em is not null or v.origem = 'texto_antigo')
        union
        -- O que a regua mandou antes da AG7 (opcao A) e a copia deixou de
        -- fora, aparado como o trim() do JavaScript.
        select btrim(p.prep_instructions, c_brancos)
          from public.procedure p
         where p.clinic_id = p_clinic_id
           and p.prep_instructions is not null
           and btrim(p.prep_instructions, c_brancos) <> ''
      ) as t(texto)
  ), '{}'::text[]);
end;
$function$;

revoke all on function public.textos_de_preparo_da_clinica(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.textos_de_preparo_da_clinica(uuid)
  to service_role;

comment on function public.textos_de_preparo_da_clinica(uuid) is
  'So o servidor (service_role; o catalogo do agente, para o filtro, regra trecho_do_preparo_da_clinica, e para o historico que vai ao modelo). AG7: o texto das versoes de preparo_do_procedimento da clinica que ja valeram (aprovado_em nao nulo: aprovado, substituido ou suspenso) e de toda copia do texto antigo (origem texto_antigo, de qualquer situacao), mais o prep_instructions nao vazio de todo procedimento da clinica (o que a regua mandou antes da AG7; aparado pela regra do trim() do JavaScript, sem outra mudanca), sem repetidos, em ordem binaria (collate C); sem nenhum, {}. A versao de cadastro que nunca valeu (aguardando, devolvida, descartada) fica fora: nunca saiu do sistema, e so a aprovacao do RT faz a lista crescer (o teto do filtro). Nunca vai ao modelo. Clinica nula: 22004 parametro_nulo.';

-- O texto em vigor do procedimento (a regua).
create function public.preparo_em_vigor_do_procedimento(p_clinic_id uuid, p_procedure_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_texto text;
  v_sha text;
begin
  if p_clinic_id is null or p_procedure_id is null then
    return null;
  end if;
  select v.id, v.texto, v.texto_sha256 into v_id, v_texto, v_sha
    from public.preparo_do_procedimento v
   where v.clinic_id = p_clinic_id
     and v.procedure_id = p_procedure_id
     and v.situacao = 'aprovado';
  if v_id is null or not public.preparo_em_vigor(p_clinic_id, v_id) then
    return null;
  end if;
  return jsonb_build_object('versao_id', v_id, 'texto', v_texto, 'texto_sha256', v_sha);
end;
$function$;

revoke all on function public.preparo_em_vigor_do_procedimento(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preparo_em_vigor_do_procedimento(uuid, uuid)
  to service_role;

comment on function public.preparo_em_vigor_do_procedimento(uuid, uuid) is
  'So o servidor (service_role; a regua, {{preparo}}). AG7: {versao_id, texto, texto_sha256} da versao em vigor (preparo_em_vigor) do procedimento da clinica, ou nulo (sem versao aprovada, fora de vigor ou algum parametro nulo). O procedimento inativo continua valendo para as consultas que ja existem. A regua confere o hash antes de renderizar.';

-- ---------------------------------------------------------------------------
-- 7) As policies de leitura das duas tabelas (so chamam funcoes)
-- ---------------------------------------------------------------------------

create policy "membro ativo le o responsavel tecnico"
  on public.responsavel_tecnico
  for select
  to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()) or public.is_product_admin());

create policy "membro ativo le o preparo do procedimento"
  on public.preparo_do_procedimento
  for select
  to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()) or public.is_product_admin());

-- ---------------------------------------------------------------------------
-- 8) As RPCs das telas (Cadastros e Configuracoes)
-- ---------------------------------------------------------------------------
-- A convencao das recusas esta no cabecalho. A trilha vai para audit_log com
-- user_id = auth.uid(): entity preparo_do_procedimento (o entity_id da
-- versao) ou responsavel_tecnico; detalhes so com ids e o codigo do texto (os
-- 8 primeiros do hash). Nunca texto.

-- Salvar um texto novo: vira a versao seguinte, aguardando o RT.
create function public.salvar_preparo_do_procedimento(p_procedure_id uuid, p_texto text, p_versao_lida integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_escrever constant text := 'Somente administradores, gestores ou o responsável técnico escrevem a orientação de preparo.';
  v_clinica uuid;
  v_nome text;
  v_aguardando uuid;
  v_maior integer;
  v_aprovada record;
  v_id uuid;
  v_numero integer;
  v_sha text;
begin
  if p_procedure_id is null or p_texto is null or p_versao_lida is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if not public.preparo_texto_valido(p_texto) then
    raise exception using errcode = '22023', message = 'texto_invalido';
  end if;
  -- O conteudo que o banco recusa sozinho (CFM-2): a tela recusa antes, com
  -- a frase; isto vale para a chamada direta da API.
  if public.preparo_texto_recusado(p_texto) then
    raise exception using errcode = '22023', message = 'texto_recusado';
  end if;
  if p_versao_lida < 0 then
    raise exception using errcode = '22023', message = 'versao_lida_invalida';
  end if;
  select p.clinic_id into v_clinica
    from public.procedure p
   where p.id = p_procedure_id;
  if v_clinica is null then
    raise exception using errcode = 'P0001', message = 'procedimento_inexistente';
  end if;
  if not (public.user_has_role(v_clinica, array['admin', 'gestor'])
          or public.is_product_admin()
          or public.user_e_responsavel_tecnico(v_clinica))
  then
    raise exception using errcode = '42501', message = c_frase_escrever;
  end if;
  -- As travas: o procedimento, depois a aguardando.
  select p.name into v_nome
    from public.procedure p
   where p.id = p_procedure_id
     for no key update;
  if not public.preparo_nome_valido(v_nome) then
    raise exception using errcode = '22023', message = 'nome_do_procedimento_invalido';
  end if;
  select v.id into v_aguardando
    from public.preparo_do_procedimento v
   where v.procedure_id = p_procedure_id
     and v.situacao = 'aguardando_rt'
     for update;
  select coalesce(max(v.versao), 0) into v_maior
    from public.preparo_do_procedimento v
   where v.procedure_id = p_procedure_id;
  if p_versao_lida <> v_maior then
    raise exception using errcode = 'P0001', message = 'texto_mudou';
  end if;
  -- O mesmo texto da aprovada que esta valendo nao entra; se ela nao vale
  -- mais (RT novo, nome mudado, suspensa), o mesmo texto entra: e o
  -- "Aprovar de novo".
  select v.id, v.texto into v_aprovada
    from public.preparo_do_procedimento v
   where v.procedure_id = p_procedure_id
     and v.situacao = 'aprovado';
  if v_aprovada.id is not null
     and v_aprovada.texto = p_texto
     and public.preparo_em_vigor(v_clinica, v_aprovada.id)
  then
    raise exception using errcode = 'P0001', message = 'texto_igual_ao_em_vigor';
  end if;
  if v_aguardando is not null then
    update public.preparo_do_procedimento
       set situacao = 'descartado',
           encerrado_por = auth.uid(),
           encerrado_em = now(),
           comentario = 'Trocado por um texto novo.'
     where id = v_aguardando;
  end if;
  insert into public.preparo_do_procedimento (clinic_id, procedure_id, versao, texto, nome_do_procedimento,
                                              origem, situacao, escrito_por)
  values (v_clinica, p_procedure_id, v_maior + 1, p_texto, v_nome, 'cadastro', 'aguardando_rt', auth.uid())
  returning id, versao, texto_sha256 into v_id, v_numero, v_sha;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_clinica, auth.uid(), 'escreveu_preparo', 'preparo_do_procedimento', v_id,
          jsonb_build_object('procedure_id', p_procedure_id, 'versao', v_numero, 'codigo', left(v_sha, 8)));
  return jsonb_build_object('versao_id', v_id, 'versao', v_numero, 'texto_sha256', v_sha);
end;
$function$;

revoke all on function public.salvar_preparo_do_procedimento(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.salvar_preparo_do_procedimento(uuid, text, integer)
  to authenticated;

comment on function public.salvar_preparo_do_procedimento(uuid, text, integer) is
  'Cadastros (authenticated). AG7: salva um texto novo da orientacao de preparo do procedimento como a versao seguinte (a maior mais 1), aguardando o RT, com nome_do_procedimento = o nome de agora, origem cadastro e escrito_por = auth.uid(); o texto aguardando que houver vira descartado ("Trocado por um texto novo."). Na ordem: 22004 parametro_nulo; 22023 texto_invalido (fora de preparo_texto_valido: o texto chega JA normalizado), texto_recusado (preparo_texto_recusado: link, valor em reais, arroba ou invisivel que o filtro recusa; CFM-2) e versao_lida_invalida (< 0); P0001 procedimento_inexistente; 42501 "Somente administradores, gestores ou o responsável técnico escrevem a orientação de preparo." (passam: administrador ou gestor ativo, super admin, RT vigente fora da clinica suspensa); a trava do procedimento (FOR NO KEY UPDATE); 22023 nome_do_procedimento_invalido (o nome de agora fora de preparo_nome_valido); a trava da aguardando (FOR UPDATE); P0001 texto_mudou (p_versao_lida diferente da maior versao; 0 sem versao); P0001 texto_igual_ao_em_vigor (o mesmo texto da aprovada EM VIGOR; fora de vigor, o mesmo texto entra: o "Aprovar de novo"). Trilha escreveu_preparo {procedure_id, versao, codigo}. Devolve {versao_id, versao, texto_sha256}. Nunca 40001 nem 40P01.';

-- Aprovar: so o RT vigente.
create function public.aprovar_preparo_do_procedimento(p_versao_id uuid, p_texto_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_aprovar constant text := 'Só o responsável técnico da clínica aprova a orientação de preparo.';
  v_clinica uuid;
  v_procedimento uuid;
  v_versao record;
  v_nome text;
  v_aprovada uuid;
  v_rt uuid;
  v_quando timestamptz := now();
begin
  if p_versao_id is null or p_texto_sha256 is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if p_texto_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'sha256_invalido';
  end if;
  select v.clinic_id, v.procedure_id into v_clinica, v_procedimento
    from public.preparo_do_procedimento v
   where v.id = p_versao_id;
  if v_clinica is null then
    raise exception using errcode = 'P0001', message = 'versao_inexistente';
  end if;
  if not public.user_e_responsavel_tecnico(v_clinica) then
    raise exception using errcode = '42501', message = c_frase_aprovar;
  end if;
  -- As travas, na ordem global: o procedimento, a versao, a aprovada de
  -- agora e o RT vigente (FOR SHARE).
  select p.name into v_nome
    from public.procedure p
   where p.id = v_procedimento
     for no key update;
  select v.situacao, v.versao, v.texto, v.texto_sha256, v.nome_do_procedimento into v_versao
    from public.preparo_do_procedimento v
   where v.id = p_versao_id
     for update;
  select v.id into v_aprovada
    from public.preparo_do_procedimento v
   where v.procedure_id = v_procedimento
     and v.clinic_id = v_clinica
     and v.situacao = 'aprovado'
     for update;
  v_rt := public.responsavel_tecnico_vigente(v_clinica);
  perform 1 from public.responsavel_tecnico r
   where r.id = v_rt
     for share;
  -- O RT pode ter mudado enquanto esta chamada esperava as travas.
  v_rt := public.responsavel_tecnico_vigente(v_clinica);
  if not public.user_e_responsavel_tecnico(v_clinica) then
    raise exception using errcode = '42501', message = c_frase_aprovar;
  end if;
  if v_versao.situacao is distinct from 'aguardando_rt' then
    raise exception using errcode = 'P0001', message = 'nao_aguarda_aprovacao';
  end if;
  if v_versao.texto_sha256 is distinct from p_texto_sha256 then
    raise exception using errcode = 'P0001', message = 'texto_mudou';
  end if;
  if v_versao.nome_do_procedimento is distinct from v_nome then
    raise exception using errcode = 'P0001', message = 'nome_mudou';
  end if;
  -- A reconferencia do conteudo (CFM-2): a versao que chegou aguardando sem
  -- passar pelo salvar (uma linha gravada pelo dono) nao e aprovada.
  if public.preparo_texto_recusado(v_versao.texto) then
    raise exception using errcode = 'P0001', message = 'texto_recusado';
  end if;
  begin
    if v_aprovada is not null then
      update public.preparo_do_procedimento
         set situacao = 'substituido',
             encerrado_por = auth.uid(),
             encerrado_em = v_quando
       where id = v_aprovada;
    end if;
    update public.preparo_do_procedimento
       set situacao = 'aprovado',
           aprovado_por = auth.uid(),
           aprovado_em = v_quando,
           rt_id = v_rt
     where id = p_versao_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'outra_aprovacao';
  end;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_clinica, auth.uid(), 'aprovou_preparo', 'preparo_do_procedimento', p_versao_id,
          jsonb_build_object('procedure_id', v_procedimento, 'versao', v_versao.versao,
                             'codigo', left(v_versao.texto_sha256, 8)));
  return jsonb_build_object('versao_id', p_versao_id, 'versao', v_versao.versao,
                            'texto_sha256', v_versao.texto_sha256, 'aprovado_em', v_quando);
end;
$function$;

revoke all on function public.aprovar_preparo_do_procedimento(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.aprovar_preparo_do_procedimento(uuid, text)
  to authenticated;

comment on function public.aprovar_preparo_do_procedimento(uuid, text) is
  'Cadastros (authenticated). AG7: o RT vigente aprova a versao aguardando (D-71). Na ordem: 22004 parametro_nulo; 22023 sha256_invalido (formato); P0001 versao_inexistente; 42501 "Só o responsável técnico da clínica aprova a orientação de preparo." (so o RT vigente, pela sessao: user_e_responsavel_tecnico; o super admin tambem recebe, mesmo designado RT, e o RT da clinica de conta suspensa tambem); as travas (o procedimento FOR NO KEY UPDATE, a versao FOR UPDATE, a aprovada de agora FOR UPDATE, a linha do RT vigente FOR SHARE); 42501 de novo se o RT mudou enquanto esperava; P0001 nao_aguarda_aprovacao; P0001 texto_mudou (p_texto_sha256 diferente do hash da versao); P0001 nome_mudou (o procedimento foi renomeado depois da versao: salvar de novo); P0001 texto_recusado (preparo_texto_recusado: a versao que chegou aguardando sem passar pelo salvar; CFM-2); a aprovada de agora vira substituido; a versao vira aprovado com aprovado_por = auth.uid(), aprovado_em = now() e rt_id = o vigente; o 23505 do indice vira P0001 outra_aprovacao. Trilha aprovou_preparo {procedure_id, versao, codigo}. Devolve {versao_id, versao, texto_sha256, aprovado_em}. Nunca 40001 nem 40P01.';

-- Devolver: so o RT vigente, com o comentario.
create function public.devolver_preparo_do_procedimento(p_versao_id uuid, p_comentario text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_aprovar constant text := 'Só o responsável técnico da clínica aprova a orientação de preparo.';
  v_clinica uuid;
  v_procedimento uuid;
  v_versao record;
begin
  if p_versao_id is null or p_comentario is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if not public.cadastro_texto_valido(p_comentario, 300) then
    raise exception using errcode = '22023', message = 'comentario_invalido';
  end if;
  select v.clinic_id, v.procedure_id into v_clinica, v_procedimento
    from public.preparo_do_procedimento v
   where v.id = p_versao_id;
  if v_clinica is null then
    raise exception using errcode = 'P0001', message = 'versao_inexistente';
  end if;
  if not public.user_e_responsavel_tecnico(v_clinica) then
    raise exception using errcode = '42501', message = c_frase_aprovar;
  end if;
  -- As travas: o procedimento, depois a versao.
  perform 1 from public.procedure p
   where p.id = v_procedimento
     for no key update;
  select v.situacao, v.versao, v.texto_sha256 into v_versao
    from public.preparo_do_procedimento v
   where v.id = p_versao_id
     for update;
  if v_versao.situacao is distinct from 'aguardando_rt' then
    raise exception using errcode = 'P0001', message = 'nao_aguarda_aprovacao';
  end if;
  update public.preparo_do_procedimento
     set situacao = 'devolvido',
         encerrado_por = auth.uid(),
         encerrado_em = now(),
         comentario = p_comentario
   where id = p_versao_id;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_clinica, auth.uid(), 'devolveu_preparo', 'preparo_do_procedimento', p_versao_id,
          jsonb_build_object('procedure_id', v_procedimento, 'versao', v_versao.versao,
                             'codigo', left(v_versao.texto_sha256, 8)));
end;
$function$;

revoke all on function public.devolver_preparo_do_procedimento(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.devolver_preparo_do_procedimento(uuid, text)
  to authenticated;

comment on function public.devolver_preparo_do_procedimento(uuid, text) is
  'Cadastros (authenticated). AG7: o RT vigente devolve a versao aguardando, com o comentario. Na ordem: 22004 parametro_nulo (a versao ou o comentario nulo); 22023 comentario_invalido (cadastro_texto_valido(.., 300): 1 a 300, aparado); P0001 versao_inexistente; 42501 "Só o responsável técnico da clínica aprova a orientação de preparo." (so o RT vigente, pela sessao: nem o super admin, nem o RT da clinica de conta suspensa); as travas (o procedimento, depois a versao); P0001 nao_aguarda_aprovacao; a versao vira devolvido com o comentario. Trilha devolveu_preparo {procedure_id, versao, codigo}. Nunca 40001 nem 40P01.';

-- Descartar o texto que espera o RT.
create function public.descartar_preparo_do_procedimento(p_versao_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_descartar constant text := 'Somente administradores, gestores ou o responsável técnico descartam o texto novo da orientação de preparo.';
  v_clinica uuid;
  v_procedimento uuid;
  v_versao record;
begin
  if p_versao_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  select v.clinic_id, v.procedure_id into v_clinica, v_procedimento
    from public.preparo_do_procedimento v
   where v.id = p_versao_id;
  if v_clinica is null then
    raise exception using errcode = 'P0001', message = 'versao_inexistente';
  end if;
  if not (public.user_has_role(v_clinica, array['admin', 'gestor'])
          or public.is_product_admin()
          or public.user_e_responsavel_tecnico(v_clinica))
  then
    raise exception using errcode = '42501', message = c_frase_descartar;
  end if;
  -- As travas: o procedimento, depois a versao.
  perform 1 from public.procedure p
   where p.id = v_procedimento
     for no key update;
  select v.situacao, v.versao, v.texto_sha256 into v_versao
    from public.preparo_do_procedimento v
   where v.id = p_versao_id
     for update;
  if v_versao.situacao is distinct from 'aguardando_rt' then
    raise exception using errcode = 'P0001', message = 'nao_aguarda_aprovacao';
  end if;
  update public.preparo_do_procedimento
     set situacao = 'descartado',
         encerrado_por = auth.uid(),
         encerrado_em = now()
   where id = p_versao_id;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_clinica, auth.uid(), 'descartou_preparo', 'preparo_do_procedimento', p_versao_id,
          jsonb_build_object('procedure_id', v_procedimento, 'versao', v_versao.versao,
                             'codigo', left(v_versao.texto_sha256, 8)));
end;
$function$;

revoke all on function public.descartar_preparo_do_procedimento(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.descartar_preparo_do_procedimento(uuid)
  to authenticated;

comment on function public.descartar_preparo_do_procedimento(uuid) is
  'Cadastros (authenticated). AG7: descarta a versao aguardando o RT. Na ordem: 22004 parametro_nulo; P0001 versao_inexistente; 42501 "Somente administradores, gestores ou o responsável técnico descartam o texto novo da orientação de preparo." (passam: administrador ou gestor ativo, super admin, RT vigente fora da clinica suspensa); as travas (o procedimento, depois a versao); P0001 nao_aguarda_aprovacao; a versao vira descartado. Trilha descartou_preparo {procedure_id, versao, codigo}. Nunca 40001 nem 40P01.';

-- Suspender o envio do texto aprovado (parar e sempre o lado seguro).
create function public.suspender_preparo_do_procedimento(p_procedure_id uuid, p_comentario text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_suspender constant text := 'Somente administradores, gestores ou o responsável técnico suspendem o envio da orientação de preparo.';
  v_clinica uuid;
  v_aprovada record;
begin
  if p_procedure_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if p_comentario is not null and not public.cadastro_texto_valido(p_comentario, 300) then
    raise exception using errcode = '22023', message = 'comentario_invalido';
  end if;
  select p.clinic_id into v_clinica
    from public.procedure p
   where p.id = p_procedure_id;
  if v_clinica is null then
    raise exception using errcode = 'P0001', message = 'procedimento_inexistente';
  end if;
  if not (public.user_has_role(v_clinica, array['admin', 'gestor'])
          or public.is_product_admin()
          or public.user_e_responsavel_tecnico(v_clinica))
  then
    raise exception using errcode = '42501', message = c_frase_suspender;
  end if;
  -- As travas: o procedimento, depois a aprovada.
  perform 1 from public.procedure p
   where p.id = p_procedure_id
     for no key update;
  select v.id, v.versao, v.texto_sha256 into v_aprovada
    from public.preparo_do_procedimento v
   where v.procedure_id = p_procedure_id
     and v.clinic_id = v_clinica
     and v.situacao = 'aprovado'
     for update;
  if v_aprovada.id is null then
    raise exception using errcode = 'P0001', message = 'sem_preparo_aprovado';
  end if;
  update public.preparo_do_procedimento
     set situacao = 'suspenso',
         encerrado_por = auth.uid(),
         encerrado_em = now(),
         comentario = p_comentario
   where id = v_aprovada.id;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_clinica, auth.uid(), 'suspendeu_preparo', 'preparo_do_procedimento', v_aprovada.id,
          jsonb_build_object('procedure_id', p_procedure_id, 'versao', v_aprovada.versao,
                             'codigo', left(v_aprovada.texto_sha256, 8)));
  return jsonb_build_object('versao_id', v_aprovada.id);
end;
$function$;

revoke all on function public.suspender_preparo_do_procedimento(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.suspender_preparo_do_procedimento(uuid, text)
  to authenticated;

comment on function public.suspender_preparo_do_procedimento(uuid, text) is
  'Cadastros (authenticated). AG7: suspende o envio da versao aprovada do procedimento (D-72; parar e sempre o lado seguro). Na ordem: 22004 parametro_nulo (o procedimento nulo); 22023 comentario_invalido (o comentario veio e nao cabe em cadastro_texto_valido(.., 300)); P0001 procedimento_inexistente; 42501 "Somente administradores, gestores ou o responsável técnico suspendem o envio da orientação de preparo." (passam: administrador ou gestor ativo, super admin, RT vigente fora da clinica suspensa); as travas (o procedimento, depois a aprovada); P0001 sem_preparo_aprovado; a aprovada vira suspenso (com o comentario, se veio). Retomar e aprovar de novo, numa versao nova com o mesmo texto. Trilha suspendeu_preparo {procedure_id, versao, codigo}. Devolve {versao_id}. Nunca 40001 nem 40P01.';

-- Definir o RT da clinica (encerra o anterior, se houver).
create function public.definir_responsavel_tecnico(p_clinic_id uuid, p_user_id uuid, p_nome text,
                                                   p_conselho text, p_numero text, p_uf text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_rt constant text := 'Só o administrador da clínica define o responsável técnico.';
  v_aberto uuid;
  v_desde_do_aberto timestamptz;
  v_id uuid;
  v_quando timestamptz := now();
begin
  if p_clinic_id is null or p_user_id is null or p_nome is null or p_conselho is null
     or p_numero is null or p_uf is null
  then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if not public.preparo_nome_valido(p_nome) then
    raise exception using errcode = '22023', message = 'nome_invalido';
  end if;
  if p_conselho not in ('CRM', 'CRO', 'CRBM', 'CRF', 'COREN', 'CREFITO', 'CRN', 'CRP', 'CRFa', 'CREF') then
    raise exception using errcode = '22023', message = 'conselho_invalido';
  end if;
  if p_numero !~ '^[0-9A-Za-z./-]{1,20}$' then
    raise exception using errcode = '22023', message = 'numero_invalido';
  end if;
  if p_uf not in ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO') then
    raise exception using errcode = '22023', message = 'uf_invalida';
  end if;
  if not (public.user_e_admin_pleno(p_clinic_id) or public.is_product_admin()) then
    raise exception using errcode = '42501', message = c_frase_rt;
  end if;
  -- O super admin nunca e o RT (D-71: aprovar e ato clinico; TELA-9), nem com
  -- vinculo ativo: nem se definindo, nem escolhido pelo administrador.
  if exists (select 1 from public.product_admin pa where pa.user_id = p_user_id) then
    raise exception using errcode = '42501', message = c_frase_rt;
  end if;
  if not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = p_clinic_id
       and m.user_id = p_user_id
       and m.status = 'ativo'
  ) then
    raise exception using errcode = 'P0001', message = 'responsavel_nao_e_membro_ativo';
  end if;
  -- A trava: so a linha aberta do RT.
  select r.id, r.desde into v_aberto, v_desde_do_aberto
    from public.responsavel_tecnico r
   where r.clinic_id = p_clinic_id
     and r.ate is null
     for update;
  -- A linha aberta nasceu depois do comeco desta transacao (now() e o do
  -- comeco): outra definicao ganhou a corrida, e encerra-la com ate antes do
  -- desde dela daria 23514 (BANCO-6).
  if v_aberto is not null and v_desde_do_aberto > v_quando then
    raise exception using errcode = 'P0001', message = 'outra_definicao';
  end if;
  begin
    if v_aberto is not null then
      update public.responsavel_tecnico
         set ate = v_quando,
             encerrado_por = auth.uid()
       where id = v_aberto;
    end if;
    insert into public.responsavel_tecnico (clinic_id, user_id, nome, conselho, numero, uf, desde, definido_por)
    values (p_clinic_id, p_user_id, p_nome, p_conselho, p_numero, p_uf, v_quando, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'outra_definicao';
  end;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'definiu_responsavel_tecnico', 'responsavel_tecnico', v_id,
          jsonb_build_object('user_id', p_user_id));
  return v_id;
end;
$function$;

revoke all on function public.definir_responsavel_tecnico(uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.definir_responsavel_tecnico(uuid, uuid, text, text, text, text)
  to authenticated;

comment on function public.definir_responsavel_tecnico(uuid, uuid, text, text, text, text) is
  'Configuracoes (authenticated). AG7: define o RT da clinica (D-70): encerra a designacao aberta (ate, encerrado_por) e cria a nova (desde, definido_por = auth.uid()), na mesma transacao. As aprovacoes do anterior param de valer na hora (D-73). Na ordem: 22004 parametro_nulo; 22023 nome_invalido (preparo_nome_valido: 1 a 120, aparado, sem controle, sem invisivel e sem marca de direcao), conselho_invalido (CRM, CRO, CRBM, CRF, COREN, CREFITO, CRN, CRP, CRFa, CREF), numero_invalido (1 a 20 de letras, digitos, ponto, barra e hifen) e uf_invalida (as 27); 42501 "Só o administrador da clínica define o responsável técnico." (so o administrador pleno, sem a marca de Implementador, ou o super admin); 42501 com a mesma frase se a pessoa escolhida e super admin (product_admin; nem ele mesmo, nem com vinculo ativo: D-71, TELA-9); P0001 responsavel_nao_e_membro_ativo (a pessoa sem clinic_member ativo na clinica, de qualquer papel); a trava da linha aberta (FOR UPDATE); P0001 outra_definicao se a linha aberta nasceu depois do comeco desta transacao (outra definicao ganhou a corrida; BANCO-6); o 23505 vira P0001 outra_definicao. Trilha definiu_responsavel_tecnico {user_id}. Devolve o id da designacao nova. Nunca 40001 nem 40P01.';

-- Encerrar o RT da clinica (a clinica fica sem RT: nada sai).
create function public.encerrar_responsavel_tecnico(p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_frase_rt constant text := 'Só o administrador da clínica define o responsável técnico.';
  v_aberto record;
begin
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;
  if not (public.user_e_admin_pleno(p_clinic_id) or public.is_product_admin()) then
    raise exception using errcode = '42501', message = c_frase_rt;
  end if;
  -- A trava: so a linha aberta do RT.
  select r.id, r.user_id, r.desde into v_aberto
    from public.responsavel_tecnico r
   where r.clinic_id = p_clinic_id
     and r.ate is null
     for update;
  if v_aberto.id is null then
    raise exception using errcode = 'P0001', message = 'sem_responsavel_tecnico';
  end if;
  -- A linha aberta nasceu depois do comeco desta transacao: e um RT que quem
  -- clicou nunca viu (BANCO-6). Nada muda.
  if v_aberto.desde > now() then
    raise exception using errcode = 'P0001', message = 'outra_definicao';
  end if;
  update public.responsavel_tecnico
     set ate = now(),
         encerrado_por = auth.uid()
   where id = v_aberto.id;
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'encerrou_responsavel_tecnico', 'responsavel_tecnico', v_aberto.id,
          jsonb_build_object('user_id', v_aberto.user_id));
end;
$function$;

revoke all on function public.encerrar_responsavel_tecnico(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.encerrar_responsavel_tecnico(uuid)
  to authenticated;

comment on function public.encerrar_responsavel_tecnico(uuid) is
  'Configuracoes (authenticated). AG7: encerra a designacao aberta do RT (ate, encerrado_por = auth.uid()); a clinica fica sem RT e nenhuma orientacao de preparo sai ate definir outro e ele aprovar de novo (D-73). Na ordem: 22004 parametro_nulo; 42501 "Só o administrador da clínica define o responsável técnico." (so o administrador pleno ou o super admin); a trava da linha aberta (FOR UPDATE); P0001 sem_responsavel_tecnico; P0001 outra_definicao se a linha aberta nasceu depois do comeco desta transacao (um RT que quem clicou nunca viu; BANCO-6). Trilha encerrou_responsavel_tecnico {user_id}. Nunca 40001 nem 40P01.';

-- ---------------------------------------------------------------------------
-- 9) mensagem_ia_exige_aprovacao: o ramo do preparo
-- ---------------------------------------------------------------------------
-- O corpo do M1 (20261013100000; a AG5 e a AG6 nao mexeram), com os trechos
-- [AG7 preparo]. O ramo `ia` fica byte a byte igual. No ramo do outro autor
-- com job da IA, a forma da linha (CZIA3) e a frase de escalonamento seguem
-- com o efeito de hoje; o ramo novo vem depois da frase. Os passos 7 e 8 sao
-- comandos separados: na funcao VOLATILE, cada comando le um retrato novo
-- (READ COMMITTED), e depois de esperar a trava a conferencia enxerga a
-- suspensao ou a troca de RT ja gravada. O gatilho nunca trava procedure.

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
  -- [AG7 preparo] inicio
  v_sha text;
  v_versao uuid;
  v_rt uuid;
  -- [AG7 preparo] fim
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
  -- [AG7 preparo] inicio
  -- 3) a forma da linha: so sistema, saida, texto, fora de nota, sem midia,
  --    com corpo (o efeito de hoje: CZIA3).
  if new.author is distinct from 'sistema'
     or new.direction is distinct from 'saida'
     or new.content_type is distinct from 'texto'
     or new.is_internal_note
     or new.media_url is not null
     or new.body is null
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  -- 4) a frase de escalonamento: passa, sem conferir a conversa (e a
  --    passagem). Igual a hoje.
  if new.body = public.frase_de_escalonamento_da_ia() then
    return new;
  end if;
  -- 5) o preparo: a decisao enviou_preparo do MESMO job, clinica e conversa
  --    com o hash do corpo (a mais recente), sem autor humano.
  v_sha := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  select d.preparo_versao_id into v_versao
    from public.ai_decision_log d
   where d.clinic_id = new.clinic_id
     and d.conversation_id = new.conversation_id
     and d.job_id = new.job_id
     and d.desfecho = 'enviou_preparo'
     and d.texto_sha256 = v_sha
     and d.preparo_versao_id is not null
   order by d.created_at desc, d.id desc
   limit 1;
  if v_versao is null or new.author_user_id is not null then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  -- 6) as conferencias de liberacao do ramo ia (o passo 4 dele): o job
  --    responder_com_ia em executando da mesma clinica e conversa, a
  --    conversa na IA sem responsavel, a janela e o telefone liberado.
  select j.status, j.clinic_id, j.payload ->> 'conversation_id', j.created_at
    into v_job_status, v_job_clinica, v_job_conversa, v_job_criado
    from public.job_queue j
   where j.id = new.job_id;
  if v_job_status is distinct from 'executando'
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
  -- 7) as travas: a versao (FOR SHARE), depois o RT dela (FOR SHARE). Nunca
  --    o procedimento.
  perform 1 from public.preparo_do_procedimento v
   where v.id = v_versao
     and v.clinic_id = new.clinic_id
     for share;
  select v.rt_id into v_rt
    from public.preparo_do_procedimento v
   where v.id = v_versao
     and v.clinic_id = new.clinic_id;
  perform 1 from public.responsavel_tecnico r
   where r.id = v_rt
     for share;
  -- 8) em vigor e a mensagem remontada, palavra por palavra (um retrato novo,
  --    depois das travas).
  if not public.preparo_em_vigor(new.clinic_id, v_versao)
     or new.body is distinct from public.mensagem_do_preparo(v_versao)
  then
    raise exception using errcode = 'CZIA3', message = 'frase_divergente';
  end if;
  return new;
  -- [AG7 preparo] fim
end;
$function$;

comment on function public.mensagem_ia_exige_aprovacao() is
  'Funcao dos gatilhos mensagem_ia_exige_aprovacao_ins e _upd de message (M1 e M3; AG7). Linha author = ia: exige job responder_com_ia em execucao da mesma clinica e conversa, conversa na IA sem responsavel, janela que confere, ia_pode_falar_com e decisao APROVADA do mesmo job com o mesmo hash do corpo (CZIA1 ia_sem_aprovacao; CZIA2 ia_nao_liberada); clinica e_de_teste sem job_id passa. Linha de outro autor com job responder_com_ia: clinica fora da fase controlada e nao de teste, CZIA2; fora de sistema, saida, texto, fora de nota, sem midia e com corpo, CZIA3 frase_divergente; a frase de escalonamento passa. AG7: a mensagem do preparo passa so com a decisao enviou_preparo do mesmo job, clinica e conversa com o hash do corpo e sem autor humano (senao CZIA3), as conferencias de liberacao do ramo ia (senao CZIA2 ia_nao_liberada), as travas da versao e do RT (FOR SHARE, nessa ordem; nunca o procedimento), a versao em vigor e o corpo IGUAL a mensagem remontada (mensagem_do_preparo; senao CZIA3 frase_divergente).';

-- ---------------------------------------------------------------------------
-- 10) A copia do texto antigo (D-83)
-- ---------------------------------------------------------------------------
-- Cada procedure com prep_instructions: CR LF e CR viram LF, depois NFC,
-- depois o trim() do JavaScript (a ordem de normalizarTextoDoPreparo). Entra
-- como versao 1, aguardando o RT, origem texto_antigo, escrito_por nulo e o
-- nome de agora, so se o normalizado nao e vazio, cabe na regra do texto, o
-- nome cabe na regra do nome (preparo_nome_valido) e o texto passa nas
-- recusas de preparo_texto_recusado (CFM-2: o texto antigo nunca passou
-- pelas recusas da tela, e nao pode chegar ao RT com link, valor em reais,
-- arroba ou invisivel). Fora disso, o texto fica so em prep_instructions (e
-- entra nos textos que o filtro e o historico escondem). prep_instructions
-- fica onde esta, sem uso. O NOTICE so traz as contagens, nunca o texto.

do $copia$
declare
  -- Os 25 brancos do trim() do JavaScript (os de cadastro_texto_valido).
  c_brancos constant text := E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_copiados bigint;
  v_fora bigint;
  v_recusados bigint;
begin
  with antigos as (
    select p.id, p.clinic_id, p.name,
           btrim(normalize(replace(replace(p.prep_instructions, E'\r\n', E'\n'), E'\r', E'\n'), nfc), c_brancos) as texto
      from public.procedure p
     where p.prep_instructions is not null
  ), avaliados as (
    select a.id, a.clinic_id, a.name, a.texto,
           (public.preparo_texto_valido(a.texto) and public.preparo_nome_valido(a.name)) as cabe,
           public.preparo_texto_recusado(a.texto) as recusado
      from antigos a
     where a.texto <> ''
  ), copiados as (
    insert into public.preparo_do_procedimento (clinic_id, procedure_id, versao, texto, nome_do_procedimento,
                                                origem, situacao, escrito_por)
    select a.clinic_id, a.id, 1, a.texto, a.name, 'texto_antigo', 'aguardando_rt', null
      from avaliados a
     where a.cabe
       and not a.recusado
    returning 1
  )
  select (select count(*) from copiados),
         (select count(*) from avaliados a where not a.cabe),
         (select count(*) from avaliados a where a.cabe and a.recusado)
    into v_copiados, v_fora, v_recusados;
  raise notice 'Migration 20261103100000: % texto(s) antigo(s) de preparo copiado(s) como versao 1 aguardando o RT; % fora da regra e % recusado(s) por link, valor em reais, arroba ou invisivel (ficam so em prep_instructions).',
    v_copiados, v_fora, v_recusados;
end;
$copia$;

notify pgrst, 'reload schema';
