-- Rollback da 20261110120000: o CHECK volta a exigir o "virtual" (o da
-- 20261109120000, copiado byte a byte) e o comentario de antes. Rodar
-- DEPOIS de voltar o codigo. Se alguma clinica ja gravou frase sem
-- "virtual", a validacao falha com 23514 e nada muda: listar com
--   select clinic_id, version, status from public.ai_agent_config
--    where frase_do_assistente is not null;
-- e acertar a frase (ou limpar o rascunho) antes.
begin;
set local lock_timeout = '3s';
-- inicio do rollback
alter table public.ai_agent_config
  drop constraint ai_agent_config_frase_do_assistente_valida,
  add constraint ai_agent_config_frase_do_assistente_valida check (
    frase_do_assistente is null
    or (
      char_length(frase_do_assistente) <= 300
      and frase_do_assistente !~* '(http|://|www\.)'
      and translate(
            lower(frase_do_assistente),
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
          ) ~ '\m(virtual|inteligencia[^[:alnum:]]+artificial)\M'
    )
  );

comment on column public.ai_agent_config.frase_do_assistente is
  'A frase de assistente virtual da clinica (decisao do dono de 09/11/2026): o aviso que o sistema cola antes da primeira resposta da IA em cada janela da conversa e a resposta ao "você é um robô?". Nula: a frase padrao do codigo (FRASE_DO_ASSISTENTE_VIRTUAL). Versionada: grava no rascunho, vale ao publicar e volta no restaurar; o rascunho copia a ultima publicada. Ate 300 caracteres, sem link e dizendo que e virtual (ai_agent_config_frase_do_assistente_valida); o filtro do CFM roda na Server Action, no publicar e em cada resposta.';
-- fim do rollback
commit;
