-- Migration 20261023110000 (M2 da onda 3): so cria o gatilho
-- passagem_da_ia_move_o_lead em conversation; nenhum corpo anterior a guardar
-- (a funcao do gatilho nasce na M1). ROLLBACK manual ANTES de desfazer a M1
-- (20261023100000), que apaga a funcao e PARA se o gatilho ainda existir.
-- O codigo da onda 3 nao depende do gatilho: nao precisa voltar.
-- TRAVA: DROP TRIGGER pega ACCESS EXCLUSIVE em conversation (bloqueia
-- leitura e escrita) por milissegundos; lock_timeout de 3 s, de madrugada.
-- Se cair por 55P03, nada mudou: tentar de novo minutos depois.
-- O que fica: os leads que a passagem ja levou para Aguardando resposta, a
-- trilha ia_moveu_etapa e as pendencias (a manutencao do funil ainda as
-- processa ate o rollback da M1).

begin;
set local lock_timeout = '3s';
drop trigger if exists passagem_da_ia_move_o_lead on public.conversation;
commit;
