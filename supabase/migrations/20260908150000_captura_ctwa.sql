-- Captura do clique de anuncio Click-to-WhatsApp (R1 do docs/06, com uma
-- mudanca de rota decidida pelo dono em 08/09/2026: o teste R0 do docs/07 NAO
-- sera feito. Em vez de provar antes se a uazapi entrega o ctwa_clid, a
-- estrutura de captura nasce pronta e defensiva: se QUALQUER dado de anuncio
-- chegar no webhook, ele e gravado. A propria producao vira o teste, sem
-- gastar anuncio de laboratorio.
--
-- Consequencia honesta dessa escolha: enquanto nenhuma linha aparecer com
-- ctwa_clid preenchido, nao se sabe se e porque nenhum paciente veio de
-- anuncio ou porque a uazapi nao repassa o referral. O Tintim continua ligado
-- ate essas colunas provarem que enchem (docs/07 continua valendo como
-- criterio de leitura).
--
-- As colunas espelham o payload que o Tintim entrega hoje (docs/06 secao 2.2),
-- que e a especificacao dos campos a reproduzir. Os source_* de NOME que ja
-- existem em contact (source_campaign etc.) continuam com o significado
-- antigo; estes aqui sao os IDS da Meta, que e o que o retorno de conversao
-- (CAPI, R3/R4) vai precisar.
--
-- Primeiro clique vence: a escrita em ingest.ts so preenche quando ctwa_clid
-- ainda esta nulo, no mesmo espirito do trigger impedir_reatribuicao_de_origem
-- (que continua valendo para os source_* de nome e nao e tocado aqui).

alter table public.contact
  add column if not exists ctwa_clid text,
  add column if not exists source_ad_id text,
  add column if not exists source_adset_id text,
  add column if not exists source_campaign_id text;

comment on column public.contact.ctwa_clid is
  'Id do clique no anuncio Click-to-WhatsApp, quando o canal o entrega. E a chave de qualidade do retorno de conversao para a Meta (CAPI).';
comment on column public.contact.source_ad_id is
  'Id do ANUNCIO na Meta (nao o nome). Vem do referral do CTWA ou da ponte de migracao.';
comment on column public.contact.source_adset_id is
  'Id do CONJUNTO de anuncios na Meta.';
comment on column public.contact.source_campaign_id is
  'Id da CAMPANHA na Meta. O nome legivel continua em source_campaign.';
