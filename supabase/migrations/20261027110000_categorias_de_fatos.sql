-- ---------------------------------------------------------------------------
-- Fatos do turno (AG2): as quatro categorias novas do filtro de saida no
-- CHECK de ai_decision_log.compliance_rule
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: o agente faz todo o atendimento e o
-- agendamento, e a etapa seguinte da a IA ferramentas novas (unidades com
-- endereco e horario, requisitos do procedimento, profissionais). A regra de
-- ouro da conformidade continua: fato critico so vale se uma ferramenta do
-- turno disse. O preco ja era assim (preco_nao_verificado); a etapa AG2 poe
-- no filtro deterministico (lib/domain/conformidade/fatos-do-turno.ts) mais
-- quatro categorias, que o turno da IA grava em
-- ai_decision_log.compliance_rule quando bloqueia (lib/agente/whatsapp.ts,
-- linhaDaDecisao, com a categoria que o filtro devolveu):
--   - acao_nao_executada: a resposta diz que marcou, reservou, confirmou,
--     cancelou, remarcou ou colocou na lista de espera sem a ferramenta ter
--     feito isso neste turno;
--   - cobertura_nao_verificada: diz que o convenio cobre, e aceito ou nao
--     atende sem um resultado de cobertura do turno;
--   - horario_nao_verificado: data ou hora que nao veio de ferramenta do
--     turno, do texto publicado nem da mensagem nova do paciente;
--   - endereco_nao_verificado: logradouro com numero que nao veio de
--     ferramenta do turno nem do texto publicado.
-- Espelho no codigo: CATEGORIAS_DE_CONFORMIDADE
-- (lib/domain/conformidade/categorias.ts), conferido por
-- tests/unit/conformidade/categorias.test.ts contra ESTE arquivo.
--
-- O QUE MUDA (SO o CHECK e o comentario da coluna; nenhuma linha muda de
-- valor, nenhuma funcao, policy, gatilho, grant ou indice):
--   1. ai_decision_log_compliance_rule_valida: as 11 categorias de hoje
--      (20261006100000, iguais) e as 4 novas. Drop e add com o MESMO nome,
--      NOT VALID (o add nao varre a tabela), e VALIDATE em seguida (varre e
--      confere as linhas de hoje: toda linha valida no CHECK antigo e
--      valida no novo, que so acrescenta valores).
--   2. o comentario da coluna compliance_rule, com as 15 categorias.
--
-- Producao em 26/10/2026 (q.js, so leitura): ai_decision_log com 3 linhas,
-- todas com compliance_rule nulo (120 kB); o CHECK de hoje e o de
-- 20261006100000, validado; o comentario da coluna com md5
-- 1d3235fe3ab6c93e247e54bc2d2187b8; nenhuma funcao do schema public e
-- nenhuma view le compliance_rule (a escrita e do servidor, pela service
-- role; a sessao le pela policy de SELECT, que nao muda). A ultima
-- migration aplicada e a 20261026130000. A 20261027100000 (a outra frente
-- da AG1, cadastro para o agente) nao mexe em ai_decision_log: as duas
-- valem em qualquer ordem.
--
-- TRAVAS: lock_timeout de 3 s. ai_decision_log e escrita a cada turno da
-- IA: o drop e o add pegam ACCESS EXCLUSIVE nela ate o commit (escrita e
-- leitura da tabela esperam o commit; com o lock_timeout, se a tabela
-- estiver ocupada, a migration falha inteira e roda de novo). O VALIDATE
-- pega SHARE UPDATE EXCLUSIVE, ja coberto pela trava do drop na mesma
-- transacao, e varre a tabela (3 linhas hoje: milissegundos). Com a tabela
-- grande, o VALIDATE pode ir numa transacao separada: o CHECK NOT VALID ja
-- confere toda escrita nova. Nenhuma outra tabela e travada. Nada levanta
-- 40001 nem 40P01 (o PostgREST repetiria sem limite): a migration nao
-- levanta erro proprio, e a unica trava e numa tabela so (sem ordem de
-- travas para fechar deadlock).
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo que grava as
-- categorias novas (o filtro da AG2). O codigo de hoje so grava as 11
-- antigas, que o CHECK novo aceita: a migration sozinha nao muda nada. O
-- codigo novo sem esta migration: o primeiro bloqueio de fato do turno
-- falharia no insert da decisao (23514; gravarDecisao lanca
-- decisao_nao_gravada), o job falha e tenta de novo, e nada vai ao
-- paciente sem a decisao gravada (nem a resposta, nem a frase fixa) ate
-- aplicar. Os tipos gerados nao mudam (compliance_rule e text).
--
-- ROLLBACK (manual): o codigo antes (o que grava as categorias novas);
-- depois, numa transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261027110000-corpos-anteriores.sql: o CHECK
-- de 20261006100000 de volta (validado, quando nenhuma linha tem categoria
-- nova; com linha de categoria nova, o CHECK volta NOT VALID e a linha
-- fica como esta: a trilha de auditoria nunca e apagada nem reescrita) e o
-- comentario de antes (md5 conferido no fim do arquivo).
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

alter table public.ai_decision_log
  drop constraint ai_decision_log_compliance_rule_valida;

alter table public.ai_decision_log
  add constraint ai_decision_log_compliance_rule_valida
    check (compliance_rule is null or compliance_rule in (
      'triagem', 'orientacao_clinica', 'promessa_resultado', 'medicamento',
      'dosagem', 'diagnostico', 'oferta_casada', 'antes_depois',
      'preco_nao_verificado', 'formato_invalido', 'falha_verificador',
      'acao_nao_executada', 'cobertura_nao_verificada',
      'horario_nao_verificado', 'endereco_nao_verificado'
    )) not valid;

alter table public.ai_decision_log
  validate constraint ai_decision_log_compliance_rule_valida;

comment on column public.ai_decision_log.compliance_rule is
  'Categoria que bloqueou (filtro do E1 e fatos do turno da AG2): triagem, orientacao_clinica, promessa_resultado, medicamento, dosagem, diagnostico, oferta_casada, antes_depois, preco_nao_verificado, acao_nao_executada, cobertura_nao_verificada, horario_nao_verificado, endereco_nao_verificado, formato_invalido, falha_verificador.';
