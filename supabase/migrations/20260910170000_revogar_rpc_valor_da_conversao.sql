-- Fecha o oraculo de preco (achado GRAVE da revisao das correcoes,
-- 09/09/2026, provado por chamada HTTP real com a chave anon).
--
-- valor_da_conversao nasceu SECURITY DEFINER (precisa ler appointment e
-- service_link por baixo da RLS quando chamada pelo gatilho) e ficou com o
-- EXECUTE default para public/anon/authenticated: qualquer portador da chave
-- publicavel, sem login, chamava POST /rest/v1/rpc/valor_da_conversao com um
-- clinic_id e contact_id alheios e lia o preco do servico da consulta do
-- contato, confirmando de quebra que a consulta existe (dado de saude por
-- inferencia; regra 3.1: se a RLS falhar, o dado nao pode vazar).
--
-- O unico chamador legitimo e registrar_conversao_do_funil, que e SECURITY
-- DEFINER do dono postgres: a revogacao nao o afeta. Nenhum codigo de
-- aplicacao chama a funcao (conferido por grep).

revoke execute on function public.valor_da_conversao(uuid, uuid, text, integer)
  from public, anon, authenticated;
