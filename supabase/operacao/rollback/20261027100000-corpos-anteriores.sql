-- Rollback manual da migration 20261027100000_cadastro_para_o_agente.sql
-- (cadastro para o agente, AG1: o endereco estruturado e o horario da
-- unidade, o que o procedimento exige do paciente e o Salvar dele numa
-- transacao, a idade e a grade do profissional, a chave ia_pode_informar e
-- a prontidao do cadastro; 26 e 27/10/2026).
--
-- O QUE A MIGRATION FEZ (so acrescimo): criou as funcoes
-- cadastro_texto_valido(text, integer), horario_de_funcionamento_valido
-- (jsonb), exigir_requisito_da_mesma_clinica(), prontidao_do_cadastro_da_ia
-- (uuid) e salvar_requisitos_do_procedimento(uuid, jsonb, uuid[]); 13
-- colunas em unit, com os CHECKs; a tabela procedure_requirement (indices,
-- gatilhos, RLS, policies e grants); 3 colunas em professional, com os
-- CHECKs; procedure.ia_pode_informar. Nenhuma funcao, policy, gatilho ou
-- constraint que ja existia foi trocada ou apagada, entao nao ha corpo
-- anterior a devolver: o nome do arquivo segue o padrao dos rollbacks.
--
-- O QUE ESTE ARQUIVO FAZ: pega as travas (abaixo); apaga tudo isso, na
-- ordem das dependencias (as duas funcoes que a sessao chama, a do Salvar e
-- a da prontidao; a tabela, que leva os gatilhos, as policies e os indices;
-- a funcao do gatilho; as colunas, que levam os CHECKs; por ultimo as duas
-- funcoes de validacao, que os CHECKs usavam). Sem IF EXISTS: com qualquer
-- objeto faltando ou diferente, falha e desfaz tudo. Confere no fim que
-- nada ficou.
--
-- ORDEM: PRIMEIRO voltar o codigo (o de agente-completo le as colunas, a
-- tabela e a prontidao e grava os requisitos pela RPC; o do main 922fb4b nao
-- le nada disto), DEPOIS este arquivo.
--
-- O QUE SE PERDE: o que foi cadastrado nas colunas e na tabela novas
-- (endereco estruturado, horario de funcionamento, referencia,
-- estacionamento, acessibilidade, link do mapa, observacao ao paciente,
-- requisitos dos procedimentos, idades, grade e a chave ia_pode_informar).
-- O `address` de texto da unidade fica (a tela grava nele o endereco
-- composto). A trilha editou_requisitos_do_procedimento fica em audit_log.
--
-- TRAVAS (medidas no Postgres local: pg_locks da transacao): ACCESS
-- EXCLUSIVE em procedure_requirement, procedure, professional e unit (os
-- DROP e os ALTER) e TAMBEM em clinic e insurance (o DROP TABLE tira os
-- gatilhos das FKs da tabela nova nas tabelas referenciadas: clinic,
-- procedure e insurance). Todas no comeco, numa ordem fixa, com NOWAIT: com
-- uma ocupada, solta as que pegou (o savepoint do bloco), espera 100 ms sem
-- trava nenhuma e tenta de novo, ate 10 vezes (uns 1 s, menos que os 3 s da
-- migration, de proposito); depois falha inteiro com 55P03, nada desfeito:
-- rodar de novo. Nunca espera trava com outra na mao (nao fecha ciclo,
-- 40P01, com sessao nenhuma). Ate o commit (de 17 a 28 ms no Postgres
-- local, 5 rodadas: os DROP COLUMN so marcam a coluna no catalogo, sem
-- reescrever), ninguem le nem grava clinic, procedure, professional, unit
-- nem insurance: quem chega espera. clinic e lida em quase toda tela, por
-- isso horario calmo.
--
-- Rodar inteiro, numa transacao, no SQL editor, em horario calmo.

begin;
set local lock_timeout = '1s';

-- As travas, todas aqui, antes de qualquer mudanca (cabecalho, TRAVAS).
do $travas$
declare
  v_tentativas integer := 0;
begin
  loop
    begin
      lock table public.procedure_requirement, public.procedure, public.professional,
                 public.unit, public.clinic, public.insurance
        in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      v_tentativas := v_tentativas + 1;
      if v_tentativas >= 10 then
        raise exception using errcode = 'lock_not_available',
          message = 'Rollback de 20261027100000: uma das tabelas seguiu ocupada por 1 s. Nada foi desfeito: rode de novo em horario calmo.';
      end if;
      perform pg_sleep(0.1);
    end;
  end loop;
end;
$travas$;

drop function public.salvar_requisitos_do_procedimento(uuid, jsonb, uuid[]);
drop function public.prontidao_do_cadastro_da_ia(uuid);

drop table public.procedure_requirement;
drop function public.exigir_requisito_da_mesma_clinica();

alter table public.procedure
  drop column ia_pode_informar;

alter table public.professional
  drop column idade_minima,
  drop column idade_maxima,
  drop column grade_minutos;

alter table public.unit
  drop column logradouro,
  drop column numero,
  drop column complemento,
  drop column bairro,
  drop column cidade,
  drop column uf,
  drop column cep,
  drop column referencia,
  drop column estacionamento,
  drop column acessibilidade,
  drop column link_do_mapa,
  drop column horario_de_funcionamento,
  drop column observacao_ao_paciente;

drop function public.horario_de_funcionamento_valido(jsonb);
drop function public.cadastro_texto_valido(text, integer);

do $conferencia$
begin
  if to_regclass('public.procedure_requirement') is not null
     or to_regprocedure('public.salvar_requisitos_do_procedimento(uuid,jsonb,uuid[])') is not null
     or to_regprocedure('public.prontidao_do_cadastro_da_ia(uuid)') is not null
     or to_regprocedure('public.exigir_requisito_da_mesma_clinica()') is not null
     or to_regprocedure('public.horario_de_funcionamento_valido(jsonb)') is not null
     or to_regprocedure('public.cadastro_texto_valido(text,integer)') is not null
  then
    raise exception 'ROLLBACK: uma funcao ou a tabela de 20261027100000 ficou';
  end if;
  if exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public'
       and (c.table_name, c.column_name) in (
             ('unit', 'logradouro'), ('unit', 'numero'), ('unit', 'complemento'),
             ('unit', 'bairro'), ('unit', 'cidade'), ('unit', 'uf'), ('unit', 'cep'),
             ('unit', 'referencia'), ('unit', 'estacionamento'), ('unit', 'acessibilidade'),
             ('unit', 'link_do_mapa'), ('unit', 'horario_de_funcionamento'),
             ('unit', 'observacao_ao_paciente'),
             ('professional', 'idade_minima'), ('professional', 'idade_maxima'),
             ('professional', 'grade_minutos'), ('procedure', 'ia_pode_informar'))
  ) then
    raise exception 'ROLLBACK: uma coluna de 20261027100000 ficou';
  end if;
  if exists (
    select 1 from pg_constraint k
     where k.conrelid in ('public.unit'::regclass, 'public.professional'::regclass,
                          'public.procedure'::regclass)
       and k.contype = 'c'
       and k.conname in ('unit_logradouro_valido', 'unit_numero_valido', 'unit_complemento_valido',
                         'unit_bairro_valido', 'unit_cidade_valida', 'unit_uf_valida', 'unit_cep_valido',
                         'unit_referencia_valida', 'unit_estacionamento_valido',
                         'unit_acessibilidade_valida', 'unit_link_do_mapa_valido',
                         'unit_horario_de_funcionamento_valido', 'unit_observacao_ao_paciente_valida',
                         'professional_idade_minima_valida', 'professional_idade_maxima_valida',
                         'professional_idades_coerentes', 'professional_grade_minutos_valida')
  ) then
    raise exception 'ROLLBACK: um CHECK de 20261027100000 ficou';
  end if;
end;
$conferencia$;

commit;
