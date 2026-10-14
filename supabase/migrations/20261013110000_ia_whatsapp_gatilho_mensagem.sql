-- ---------------------------------------------------------------------------
-- E3, a IA no WhatsApp: gatilho de message (13/10/2026)
-- ---------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/10/2026; contrato em
-- ~/.claude/plans/e3-whatsapp/contrato.md (secoes 2.29 e 2.30). Esta e a M3
-- de tres e a UNICA DDL desta leva em tabela quente. Ordem de APLICACAO: M1
-- (20261013100000, que cria a funcao mensagem_ia_exige_aprovacao), esta M3,
-- e por ultimo a M2 (20261013120000): quando a ingestao puder por conversa
-- na IA, o gatilho ja protege message.
--
-- O que faz: dois gatilhos BEFORE em message que chamam
-- mensagem_ia_exige_aprovacao() (trava Q do plano):
--   - author = 'ia': exige job responder_com_ia em execucao da mesma
--     clinica e conversa, conversa na IA sem responsavel, janela que
--     confere, ia_pode_falar_com e decisao APROVADA do mesmo job com o
--     mesmo sha256 do corpo (CZIA1 ia_sem_aprovacao, CZIA2 ia_nao_liberada);
--     fora das duas clinicas e nao de teste, CZIA2 sempre; clinica
--     e_de_teste sem job_id passa (fixtures e seed antigos);
--   - outro autor com job_id de um job responder_com_ia: so a frase fixa,
--     como sistema (CZIA3 frase_divergente).
-- O nome vem DEPOIS de mensagem_herda_numero na ordem alfabetica dos BEFORE:
-- o numero da mensagem ja esta preenchido quando a funcao roda.
-- Passam sem disparar (condicao WHEN e lista de colunas): recibo
-- (delivery_status, error_code, wa_message_id), apagar (body vira nulo),
-- poda da fila (job_id vira nulo) e toda linha de paciente, de pessoa e de
-- evento sem job. O caminho quente da ingestao e do celular nao paga nada.
--
-- NADA LIGA SOZINHO: nenhuma linha muda; so passa a recusar 'ia' sem
-- aprovacao, o que hoje nao existe em producao (0 linhas 'ia').
--
-- LOCKS: APLICAR DE MADRUGADA. Dois CREATE TRIGGER pegam SHARE ROW
-- EXCLUSIVE em message por milissegundos (bloqueia escrita em message, nao
-- leitura). lock_timeout de 3 s: se cair por 55P03, nada fica gravado;
-- tentar de novo minutos depois. Nenhum ALTER TABLE.
--
-- ROLLBACK manual (antes do rollback da M1, que apaga a funcao):
--   1. drop trigger mensagem_ia_exige_aprovacao_ins on public.message;
--   2. drop trigger mensagem_ia_exige_aprovacao_upd on public.message;
--   (supabase/operacao/rollback/20261013110000-corpos-anteriores.sql)
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

create trigger mensagem_ia_exige_aprovacao_ins
  before insert on public.message for each row
  when (new.author = 'ia' or new.job_id is not null)
  execute function public.mensagem_ia_exige_aprovacao();

create trigger mensagem_ia_exige_aprovacao_upd
  before update of author, body, job_id on public.message for each row
  when ((new.author = 'ia' and new.author is distinct from old.author)
     or (new.job_id is not null and new.job_id is distinct from old.job_id)
     or (new.body is not null and new.body is distinct from old.body
         and (new.author = 'ia' or new.job_id is not null)))
  execute function public.mensagem_ia_exige_aprovacao();
