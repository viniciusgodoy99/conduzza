-- ---------------------------------------------------------------------------
-- A passagem da IA leva o lead para Aguardando resposta (onda 3, M2 de duas)
-- ---------------------------------------------------------------------------
-- Item 10 do plano (pedido do dono em 20/10/2026, segunda reuniao com o
-- Victor); decisao D1 = A do dono em 21/10/2026: toda saida da IA para a
-- fila com o paciente esperando move o lead (a IA decidiu passar, filtro do
-- CFM, tetos, travas, os 3 minutos sem resposta, falha tecnica, IA desligada
-- ou parada, consulta da IA recusada), nunca quando alguem ja respondeu pelo
-- celular. Contrato em ~/.claude/plans/onda3-funil/contrato.md, secao 2.
-- Esta e a M2 de duas e a UNICA DDL da onda 3 em tabela quente. Ordem de
-- APLICACAO: a M1 (20261023100000, que cria a funcao do gatilho, a pendencia
-- e a manutencao do funil) e depois esta, de madrugada.
--
-- O que faz: um gatilho AFTER UPDATE OF status em conversation que, so na
-- transicao ia_atendendo -> aguardando_humano com awaiting_reply verdadeiro,
-- chama passagem_da_ia_move_o_lead() (mover_lead_para_aguardando: so lead,
-- nunca para tras, nunca espera o contato; ocupado vira pendencia que a
-- entrada funil-da-passagem do pg_cron tenta de novo a cada minuto). Uma
-- regra so para todos os caminhos de passagem (ia_tirar_conversa, chamada
-- por passar_conversa_da_ia_para_equipe, tirar_conversa_da_ia_pelo_servidor
-- e pela varredura de motor_manutencao; ia_desligar; a ingestao com a IA
-- parada; a consulta da IA recusada), inclusive os que a onda 2 criar com o
-- mesmo status, sem trocar o corpo de nenhuma funcao quente. O celular fica
-- de fora sozinho: a resposta da pessoa derruba awaiting_reply antes de
-- ia_tirar_conversa(..., 'celular') (salvo quando o paciente escreveu nos 8
-- segundos em volta da resposta: ai a conversa continua esperando a equipe,
-- e o lead move, como em "Aguardando voce"). A varredura com
-- liberacao_perdida so move se o paciente estava esperando. Paciente nao
-- muda de etapa (D2).
--
-- Ordem de travas: a ingestao ja segura o contato (a trava da propria
-- transacao nao conta como ocupada); nas outras passagens o SKIP LOCKED no
-- contato nunca espera, entao nao nasce deadlock. A passagem nunca falha por
-- causa do funil: qualquer erro da funcao vira WARNING (clinica e SQLSTATE).
-- Custo: o WHEN em cada update de status de conversa (barato); a funcao so
-- na passagem.
--
-- LOCKS: APLICAR DE MADRUGADA. CREATE TRIGGER pega SHARE ROW EXCLUSIVE em
-- conversation por milissegundos (bloqueia escrita em conversation, nao
-- leitura). lock_timeout de 3 s: se cair por 55P03, nada fica gravado;
-- tentar de novo minutos depois. Nenhum ALTER TABLE; nenhuma linha muda.
--
-- ROLLBACK manual (ANTES do rollback da M1, que apaga a funcao):
--   drop trigger passagem_da_ia_move_o_lead on public.conversation;
--   (supabase/operacao/rollback/20261023110000-corpos-anteriores.sql)
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

create trigger passagem_da_ia_move_o_lead
  after update of status on public.conversation
  for each row
  when (old.status = 'ia_atendendo' and new.status = 'aguardando_humano' and new.awaiting_reply)
  execute function public.passagem_da_ia_move_o_lead();
