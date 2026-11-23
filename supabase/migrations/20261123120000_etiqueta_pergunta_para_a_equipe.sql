-- ROLLBACK (manual, nesta ordem):
--   1) reaplicar public.semear_etiquetas_padrao de
--      20260921100000_etiquetas_de_conversa.sql (as quatro etiquetas);
--   2) delete from public.conversation_tag_def
--       where chave = 'pergunta_para_a_equipe';
--      (o gatilho proteger_etiqueta_de_conversa tira a chave das conversas).
--
-- Etiqueta "Pergunta para a equipe" (decisao do dono de 23/11/2026, "anota e
-- continua"). Quando a pessoa pergunta algo que a clinica nao cadastrou
-- (valor, procedimento, profissional, unidade, requisito, convenio, resposta
-- da base), a IA nao passa mais a conversa: anota a pergunta numa nota
-- interna e aplica esta etiqueta, o sinal na lista do Atendimento (o chip do
-- cartao e o filtro por etiqueta ja existem). A conversa continua com a IA; a
-- equipe responde por aqui e tira a etiqueta.
--
-- Nenhuma tabela nem coluna nova: o catalogo de etiquetas por clinica
-- (conversation_tag_def, RLS e clinic_id NOT NULL desde 20260921100000) e a
-- RPC etiquetar_conversa, que a IA chama com o service role
-- (lib/agente/whatsapp.ts, anotarPerguntasParaAEquipe). Sem esta migration, a
-- nota interna sai do mesmo jeito e a etiqueta fica de fora (o validador da
-- conversa recusa a chave que nao esta no catalogo; o executor so registra o
-- codigo no log).
--
-- 1) Toda clinica que existe ganha SO a etiqueta nova (rodar a semeadura
--    inteira devolveria as quatro padrao a quem as excluiu). Sem alvo no
--    ON CONFLICT, como na semeadura: a clinica que ja tem uma etiqueta com
--    esse nome fica com a dela (e a IA nao etiqueta ali).
-- 2) A clinica que nascer ganha junto (a semeadura padrao, com a quinta).

insert into public.conversation_tag_def (clinic_id, chave, nome, tom)
select c.id, 'pergunta_para_a_equipe', 'Pergunta para a equipe', 'warning'
  from public.clinic c
on conflict do nothing;

create or replace function public.semear_etiquetas_padrao(p_clinic_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.conversation_tag_def (clinic_id, chave, nome, tom)
  values
    (p_clinic_id, 'urgente',             'Urgente',             'alert'),
    (p_clinic_id, 'orcamento_enviado',   'Orçamento enviado',   'info'),
    (p_clinic_id, 'aguardando_convenio', 'Aguardando convênio', 'warning'),
    (p_clinic_id, 'aguardando_paciente', 'Aguardando paciente', 'neutral'),
    -- 23/11/2026: a pergunta que a IA anotou para a equipe responder.
    (p_clinic_id, 'pergunta_para_a_equipe', 'Pergunta para a equipe', 'warning')
  -- Sem ALVO de proposito: cobre tanto (clinic_id, chave) quanto o indice
  -- unico de nome. Com alvo, uma clinica que ja tivesse "Urgente" com outra
  -- chave faria a semeadura inteira falhar.
  on conflict do nothing;
$$;

revoke all on function public.semear_etiquetas_padrao(uuid)
  from public, anon, authenticated;
