-- Rollback manual da migration 20261025100000 (regras de origem dos leads,
-- onda 5, item 17). A migration nao troca corpo de funcao de producao: o que
-- volta e o catalogo de campaign_link como estava em 21/10/2026 (lido com
-- q.js, so leitura):
--   - CHECKs de conteudo: nenhum (so o de channel, que a migration nao toca);
--   - gatilhos: so set_updated_at;
--   - grants: os de fabrica do Supabase (ALL para anon, authenticated e
--     service_role; arwdDxtm no Postgres 17);
--   - comentario da tabela: nenhum.
--
-- ORDEM: PRIMEIRO voltar o codigo (a aba Origem dos leads e as actions
-- traduzem os CHECKs e o limite; sem eles a tela segue, mas o banco volta a
-- aceitar pelo PostgREST o que o Zod recusa), DEPOIS rodar ESTE arquivo
-- inteiro, numa transacao, no SQL editor.
-- O que fica: as regras gravadas (todas passaram nos CHECKs) e a trilha.
-- TRAVAS: o ALTER TABLE segura ACCESS EXCLUSIVE em campaign_link ate o
-- commit (a ingestao le a tabela a cada contato novo); lock_timeout de 3 s,
-- horario calmo.
-- Conferir no fim (so leitura): as consultas do rodape.

begin;
set local lock_timeout = '3s';

-- 1. O limite de origens ativas.
drop trigger if exists limitar_origens_ativas on public.campaign_link;
drop function if exists public.limitar_origens_ativas();

-- 2. Os sete CHECKs.
alter table public.campaign_link
  drop constraint if exists campaign_link_nome,
  drop constraint if exists campaign_link_textos,
  drop constraint if exists campaign_link_mensagem,
  drop constraint if exists campaign_link_palavras_de_1_dimensao,
  drop constraint if exists campaign_link_palavras_no_formato,
  drop constraint if exists campaign_link_codigo,
  drop constraint if exists campaign_link_reconhece_algo;

-- 3. Os grants de fabrica e o comentario de antes (nenhum).
grant all on table public.campaign_link to anon, authenticated;
comment on table public.campaign_link is null;

commit;

-- Conferencia (so leitura), depois do commit:
-- select conname from pg_constraint where conrelid = 'public.campaign_link'::regclass order by 1;
--   (campaign_link_channel_check, campaign_link_clinic_id_fkey, campaign_link_pkey)
-- select tgname from pg_trigger where tgrelid = 'public.campaign_link'::regclass and not tgisinternal;
--   (set_updated_at)
-- select relacl from pg_class where oid = 'public.campaign_link'::regclass;
--   (anon e authenticated com arwdDxtm)
-- select to_regprocedure('public.limitar_origens_ativas()');  (nulo)
