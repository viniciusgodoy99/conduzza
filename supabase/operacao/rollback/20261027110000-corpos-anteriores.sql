-- Rollback manual da migration 20261027110000_categorias_de_fatos.sql
-- (fatos do turno da AG2: as quatro categorias novas do filtro de saida no
-- CHECK de ai_decision_log.compliance_rule, 27/10/2026).
--
-- O QUE A MIGRATION FEZ: trocou o CHECK ai_decision_log_compliance_rule_valida
-- (drop e add com o mesmo nome, NOT VALID e VALIDATE) pelo das 11
-- categorias de 20261006100000 mais acao_nao_executada,
-- cobertura_nao_verificada, horario_nao_verificado e
-- endereco_nao_verificado, e o comentario da coluna compliance_rule. Nenhuma
-- linha, funcao, policy, gatilho, grant ou indice.
--
-- O QUE ESTE ARQUIVO FAZ: devolve o CHECK de 20261006100000 (as 11
-- categorias, com o mesmo nome) e o comentario de PRODUCAO de 26/10/2026
-- (lido com q.js, so leitura; md5 1d3235fe3ab6c93e247e54bc2d2187b8), e
-- confere os dois no fim (com outro valor, falha e desfaz tudo).
-- O CHECK volta validado quando nenhuma decisao tem categoria nova. Com
-- alguma (o codigo da AG2 chegou a bloquear por fato do turno), o CHECK
-- volta NOT VALID: as escritas novas sao conferidas pela lista antiga e a
-- linha de categoria nova fica como esta (a trilha de auditoria nunca e
-- apagada nem reescrita; um NOTICE diz quantas). Validar depois disso e
-- decisao do dono.
--
-- ORDEM: o codigo antes (o que grava as categorias novas: o filtro da AG2
-- no turno da IA). Com esse codigo no ar e este rollback aplicado, o
-- primeiro bloqueio por fato do turno falharia no insert da decisao
-- (23514) e o job tentaria de novo sem mandar nada ao paciente.
--
-- O QUE SE PERDE: nada (nenhuma linha muda).
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_decision_log (drop e add do CHECK) ate o
-- commit, e o VALIDATE varre a tabela. lock_timeout de 1 s (menor que o da
-- migration, de proposito): com a tabela ocupada, o rollback falha inteiro
-- e roda-se de novo. Nada levanta 40001 nem 40P01.
--
-- Rodar inteiro, numa transacao, no SQL editor, em horario calmo.

begin;
set local lock_timeout = '1s';

alter table public.ai_decision_log
  drop constraint ai_decision_log_compliance_rule_valida;

-- O CHECK de 20261006100000, com a mesma lista e a mesma ordem.
alter table public.ai_decision_log
  add constraint ai_decision_log_compliance_rule_valida
    check (compliance_rule is null or compliance_rule in (
      'triagem', 'orientacao_clinica', 'promessa_resultado', 'medicamento',
      'dosagem', 'diagnostico', 'oferta_casada', 'antes_depois',
      'preco_nao_verificado', 'formato_invalido', 'falha_verificador'
    )) not valid;

do $rollback_20261027110000$
declare
  v_com_categoria_nova bigint;
begin
  select count(*) into v_com_categoria_nova
    from public.ai_decision_log
   where compliance_rule in ('acao_nao_executada', 'cobertura_nao_verificada',
                             'horario_nao_verificado', 'endereco_nao_verificado');
  if v_com_categoria_nova = 0 then
    alter table public.ai_decision_log
      validate constraint ai_decision_log_compliance_rule_valida;
  else
    raise notice 'ROLLBACK 20261027110000: % decisao(oes) com categoria dos fatos do turno ficam como estao; o CHECK volta NOT VALID (as escritas novas sao conferidas).',
      v_com_categoria_nova;
  end if;
end;
$rollback_20261027110000$;

comment on column public.ai_decision_log.compliance_rule is
  'Categoria que bloqueou (filtro do E1): triagem, orientacao_clinica, promessa_resultado, medicamento, dosagem, diagnostico, oferta_casada, antes_depois, preco_nao_verificado, formato_invalido, falha_verificador.';

-- Conferencia: o comentario de 26/10/2026 e o CHECK de 20261006100000.
do $conferencia_20261027110000$
declare
  v_comentario text;
  v_definicao text;
begin
  select md5(col_description('public.ai_decision_log'::regclass, a.attnum))
    into v_comentario
    from pg_attribute a
   where a.attrelid = 'public.ai_decision_log'::regclass
     and a.attname = 'compliance_rule';
  if v_comentario is distinct from '1d3235fe3ab6c93e247e54bc2d2187b8' then
    raise exception 'ROLLBACK 20261027110000: o comentario de compliance_rule nao e o de 26/10/2026 (md5 %)',
      v_comentario;
  end if;
  select pg_get_constraintdef(c.oid)
    into v_definicao
    from pg_constraint c
   where c.conrelid = 'public.ai_decision_log'::regclass
     and c.conname = 'ai_decision_log_compliance_rule_valida';
  if v_definicao is distinct from
     'CHECK (((compliance_rule IS NULL) OR (compliance_rule = ANY (ARRAY[''triagem''::text, ''orientacao_clinica''::text, ''promessa_resultado''::text, ''medicamento''::text, ''dosagem''::text, ''diagnostico''::text, ''oferta_casada''::text, ''antes_depois''::text, ''preco_nao_verificado''::text, ''formato_invalido''::text, ''falha_verificador''::text]))))'
     and v_definicao is distinct from
     'CHECK (((compliance_rule IS NULL) OR (compliance_rule = ANY (ARRAY[''triagem''::text, ''orientacao_clinica''::text, ''promessa_resultado''::text, ''medicamento''::text, ''dosagem''::text, ''diagnostico''::text, ''oferta_casada''::text, ''antes_depois''::text, ''preco_nao_verificado''::text, ''formato_invalido''::text, ''falha_verificador''::text])))) NOT VALID'
  then
    raise exception 'ROLLBACK 20261027110000: o CHECK de compliance_rule nao e o de 20261006100000 (%)',
      v_definicao;
  end if;
end;
$conferencia_20261027110000$;

commit;
