-- ---------------------------------------------------------------------------
-- A frase de assistente virtual sem exigir o "virtual" (decisao do dono de
-- 10/11/2026)
-- ---------------------------------------------------------------------------
-- O dono, sobre a regra da frase da aba Persona ("Ela precisa dizer
-- 'assistente virtual' ou 'inteligência artificial'"): "nao precisa disso".
-- O CHECK ai_agent_config_frase_do_assistente_valida (20261109120000) fica so
-- com o tamanho (ate 300 caracteres) e o link (http, :// ou www.); a tela, a
-- Server Action e o publicar deixam de exigir o "virtual"
-- (problemaNoTextoDoAgente). O filtro do CFM continua na Server Action, no
-- publicar e em cada resposta.
--
-- O QUE NAO MUDA: a resposta ao "você é um robô?" continua dizendo que e a
-- assistente virtual: e a frase da clinica quando ela diz, senao a padrao
-- (respostaAoRobo em lib/domain/agente/config.ts; codigo, nao banco).
--
-- TRAVAS: ACCESS EXCLUSIVE em ai_agent_config pelo ALTER (a troca do CHECK e
-- a validacao, que varre as poucas versoes), ate o commit. lock_timeout de
-- 3 s.
-- ORDEM: antes do codigo (com o codigo antes, a frase sem "virtual" que a
-- tela aceita seria recusada pelo banco com 23514).
-- ROLLBACK: supabase/operacao/rollback/20261110120000-frase-exige-virtual.sql,
-- depois de voltar o codigo.

set local lock_timeout = '3s';

alter table public.ai_agent_config
  drop constraint ai_agent_config_frase_do_assistente_valida,
  add constraint ai_agent_config_frase_do_assistente_valida check (
    frase_do_assistente is null
    or (
      char_length(frase_do_assistente) <= 300
      and frase_do_assistente !~* '(http|://|www\.)'
    )
  );

comment on column public.ai_agent_config.frase_do_assistente is
  'A frase de assistente virtual da clinica (decisao do dono de 09/11/2026): o aviso que o sistema cola antes da primeira resposta da IA em cada janela da conversa e, quando diz que e virtual, a resposta ao "você é um robô?" (senao, a padrao). Nula: a frase padrao do codigo (FRASE_DO_ASSISTENTE_VIRTUAL). Versionada: grava no rascunho, vale ao publicar e volta no restaurar; o rascunho copia a ultima publicada. Ate 300 caracteres e sem link (ai_agent_config_frase_do_assistente_valida); desde 10/11/2026 nao precisa dizer que e virtual. O filtro do CFM roda na Server Action, no publicar e em cada resposta.';
