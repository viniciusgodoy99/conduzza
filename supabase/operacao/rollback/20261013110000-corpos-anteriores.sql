-- Migration 20261013110000 (M3 do E3): so cria os dois gatilhos de message;
-- nenhum corpo anterior a guardar (a funcao mensagem_ia_exige_aprovacao nasce
-- na M1). ROLLBACK manual, DEPOIS de desfazer a M2 (20261013120000) e ANTES
-- de desfazer a M1 (20261013100000). Trava SHARE ROW EXCLUSIVE em message por
-- milissegundos: horario calmo.

set local lock_timeout = '3s';
drop trigger if exists mensagem_ia_exige_aprovacao_ins on public.message;
drop trigger if exists mensagem_ia_exige_aprovacao_upd on public.message;
