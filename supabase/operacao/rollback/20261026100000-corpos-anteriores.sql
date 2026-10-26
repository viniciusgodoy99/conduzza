-- Rollback manual da migration 20261026100000_painel_cs.sql (o Painel geral
-- como acompanhamento de cliente, 26/10/2026). A migration SO acrescenta
-- tres funcoes (painel_cs_das_clinicas, equipe_da_clinica_no_painel e
-- definir_agente_da_clinica_no_painel): nenhum corpo existente mudou, entao
-- nao ha corpo anterior para voltar (o nome do arquivo segue o padrao dos
-- outros rollbacks).
--
-- ORDEM:
--   1. Voltar o CODIGO (o novo chama as tres funcoes: lib/queries/
--      painel-geral.ts, app/(app)/painel-geral/actions.ts e as telas do
--      Painel geral). O codigo de antes le painel_geral_das_clinicas e muda
--      o agente por definir_agente_da_clinica, que a migration nao tocou.
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor.
-- TRAVAS: so catalogo (DROP FUNCTION); nenhuma tabela e tocada.
-- O que fica: as mudancas de agente feitas pelo painel enquanto a funcao
-- nova existiu (ia_clinica_habilitada, ia_liberacao e a trilha
-- mudou_agente_da_clinica), que sao as de definir_agente_da_clinica de
-- sempre. As duas de leitura nao gravam nada.
-- Conferir no fim: nenhuma das tres funcoes existe, e
-- painel_geral_das_clinicas(boolean) continua com o md5(prosrc)
-- 646ff584c89d9271f747658e729ce036 (o de 26/10/2026) e
-- definir_agente_da_clinica(uuid, text, text) com o
-- dcef8e7efde222a64ea8647dc075f7c0.

begin;
set local lock_timeout = '3s';

drop function if exists public.definir_agente_da_clinica_no_painel(uuid, text, text, text);
drop function if exists public.equipe_da_clinica_no_painel(uuid);
drop function if exists public.painel_cs_das_clinicas(boolean);

commit;
