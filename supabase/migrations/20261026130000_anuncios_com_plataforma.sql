-- ---------------------------------------------------------------------------
-- Resultados (aba Marketing): o anuncio com o texto, o link e a plataforma
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026: sem a conta da Meta ligada, a Salud Care
-- (682edca6-cc7d-4bb7-8db6-4c68e2510549) ve o quadro "Campanhas" vazio,
-- embora o uazapi grave, por lead, o anuncio (o id em contact.source_ad_id;
-- o titulo, o texto e o link em anuncio_do_whatsapp, um por anuncio) e a
-- plataforma (Instagram ou Facebook, em contact.source_medium). O dono quer
-- ver isso em Resultados. Decisao dele, literal: "Pode, e aplicar no ok do
-- ensaio". A tela (outra frente) mostra no quadro Campanhas uma linha por
-- anuncio com titulo, plataforma, leads, agendaram e compareceram, e o "Ver
-- anuncio" (o texto e o link); no quadro Origem dos leads, a divisao por
-- plataforma dos leads de anuncio. Esta migration da a tela o que faltava:
-- o texto, o link e a plataforma, pela mesma funcao que ja da as linhas por
-- anuncio.
--
-- O QUE MUDA: anuncios_do_periodo(p_clinic_id, p_de, p_ate), create or
-- replace a partir do corpo APLICADO (fndef.js, so leitura; md5(prosrc)
-- 34d995f4f676fd52e66b85089383bde0, o da migration 20261020100000). SO
-- ACRESCIMO:
--   - em cada item de "linhas": "descricao" e "link" (de
--     anuncio_do_whatsapp, pela mesma juncao que ja da o titulo; null sem a
--     linha do anuncio ou sem o campo) e "plataformas";
--   - em "nao_identificado": "plataformas".
-- "plataformas": os leads do grupo no periodo (os do anuncio da linha; em
-- nao_identificado, os de anuncio sem id reconhecido), agrupados pela
-- plataforma do lead: contact.source_medium aparado pela regra do
-- JavaScript (o mesmo btrim, com a lista dos 25 brancos de
-- String.prototype.trim, que ja apara o id do anuncio; o btrim sem lista so
-- tiraria o espaco ASCII) e vazio virando null. Sem mudar a caixa:
-- "instagram" e "Instagram" sao duas plataformas (a funcao mostra o que esta
-- gravado: a ingestao do anuncio so grava Facebook, Instagram ou nulo, e o
-- banco recusa outro valor no lead de anuncio_ctwa; a atribuicao de origem
-- pelo link, pela mensagem padrao ou pela palavra-chave grava o meio da
-- regra, texto livre, que aparece como esta, aparado, num lead que tambem
-- tenha id de anuncio). So as plataformas com lead. Ordem: mais leads
-- primeiro, depois a plataforma em ordem de byte (collate "C": a mesma em
-- qualquer versao do ICU, como em reguas_por_etiqueta), null por ultimo. A
-- soma dos "leads" de "plataformas" e o "leads" do grupo: o mesmo conjunto
-- de leads (o mesmo recorte do periodo e o mesmo id aparado). Na linha nunca
-- vem vazio (toda linha tem lead); em nao_identificado vem [] sem lead.
-- NADA MAIS MUDA: "leads", "agendaram", "compareceram", "titulo",
-- "nome_na_meta", "ad_id", a ordem das linhas (mais leads, depois o id), o
-- recorte do periodo (first_contact_at em [p_de, p_ate)), "sem_anuncio"
-- inteiro, null para o profissional da clinica (user_has_role), a
-- assinatura, o retorno (jsonb), LANGUAGE sql, STABLE, SECURITY INVOKER (a
-- RLS de quem chama recorta contact, appointment, anuncio_do_whatsapp e
-- meta_anuncio, como hoje: outra clinica ve zeros, e "plataformas" vazio em
-- nao_identificado), o search_path vazio, o dono e os grants (EXECUTE so
-- para authenticated e service_role; anon e public sem nada, reemitidos
-- aqui como em 20261020100000). O comentario da funcao diz as chaves novas.
--
-- FORMATO EXATO do jsonb devolvido (toda chave sempre presente; null so onde
-- esta escrito; contagens inteiras, nunca negativas). "NOVO" marca o que
-- esta migration acrescenta; o resto e o de 20261020100000, sem mudanca.
-- null para o profissional da clinica (como hoje). Senao:
-- {
--   "leads": int,                     leads que chegaram no periodo (first_contact_at em [p_de, p_ate)); o mesmo numero do funil
--   "linhas": [                       uma por id de anuncio valido (source_ad_id aparado como no JavaScript, ^[0-9]{1,32}$); ordem: leads desc, depois ad_id
--     {
--       "ad_id": text,
--       "titulo": text | null,        anuncio_do_whatsapp.titulo
--       "nome_na_meta": text | null,  meta_anuncio.ad_name
--       "leads": int,
--       "agendaram": int,             leads com alguma consulta
--       "compareceram": int,          leads com consulta compareceu
--       "descricao": text | null,     NOVO: anuncio_do_whatsapp.descricao (null sem a linha do anuncio)
--       "link": text | null,          NOVO: anuncio_do_whatsapp.link (null sem a linha do anuncio)
--       "plataformas": [              NOVO: nunca vazio; a soma dos "leads" = o "leads" da linha
--         { "plataforma": text | null, "leads": int }
--                                     contact.source_medium aparado, vazio = null; ordem: leads desc, plataforma (collate "C") asc, null por ultimo
--       ]
--     }
--   ],
--   "nao_identificado": {             leads de anuncio (clique, id de anuncio, de conjunto ou de campanha, ou metodo anuncio_ctwa) sem id valido
--     "leads": int,
--     "agendaram": int,
--     "compareceram": int,
--     "plataformas": [                NOVO: a mesma regra e a mesma ordem; [] sem lead; a soma dos "leads" = o "leads" daqui
--       { "plataforma": text | null, "leads": int }
--     ]
--   },
--   "sem_anuncio": {                  o resto; sem mudanca (sem "plataformas")
--     "leads": int,
--     "agendaram": int,
--     "compareceram": int
--   }
-- }
-- Invariante de 20261020100000, a mesma: soma dos "leads" das linhas +
-- nao_identificado + sem_anuncio = "leads".
--
-- Producao em 26/10/2026 (q.js, so leitura, so contagens): a Salud Care tem
-- os unicos leads de anuncio (51 de 157 contatos), em dois anuncios, todos
-- com id; a plataforma gravada e Instagram ou nula (nenhum Facebook ainda,
-- nenhum valor com espaco ou vazio em contact.source_medium); um dos dois
-- anuncios tem a linha em anuncio_do_whatsapp (titulo, texto e link). De
-- 27/09 a 26/10/2026 em Fortaleza (a funcao de hoje mais a contagem direta
-- pela regra nova): 120240624148610289 com 26 leads (Instagram 18, sem
-- plataforma 8; sem a linha do anuncio), 120248355615910289 com 25
-- (Instagram 25; com titulo, texto e link), nao_identificado 0 e
-- sem_anuncio 106, de 157; ninguem agendou ainda.
--
-- TRAVAS: so catalogo, nenhuma tabela. O create or replace, o REVOKE, o
-- GRANT e o COMMENT so escrevem em pg_proc e pg_description (o COMMENT pega
-- ShareUpdateExclusiveLock no objeto da funcao, que quem chama a funcao nao
-- pega): nenhuma leitura nem escrita de dado espera. lock_timeout de 3 s por
-- garantia (com o catalogo ocupado, falha inteira e roda de novo). Nada
-- levanta 40001 nem 40P01.
--
-- ORDEM DE PUBLICACAO: a migration pode ir ANTES do codigo. O leitor
-- publicado (lib/queries/relatorios.ts, fetchAnunciosDoPeriodo, do commit
-- 1d48781, igual no main e71c37e) le so as chaves que conhece ("leads";
-- "ad_id", "titulo", "nome_na_meta", "leads", "agendaram" e "compareceram"
-- de cada linha; "leads", "agendaram" e "compareceram" de nao_identificado
-- e de sem_anuncio, por lerContagem) e monta um objeto novo: chave
-- desconhecida e ignorada, sem validacao estrita; a exportacao de
-- Resultados (lib/domain/exportacao-de-resultados.ts) e a paridade com a
-- lista de Leads usam esse objeto. Os tipos gerados nao mudam (Returns:
-- Json). O leitor novo (a outra frente, ainda nao publicado; como estava no
-- disco em 26/10/2026) trata a falta das chaves novas como "sem divisao":
-- conferir de novo antes de publicar o codigo antes da migration. A suite
-- tests/rls/anuncio-do-whatsapp.test.ts compara o jsonb inteiro (toEqual) e
-- foi atualizada junto com esta migration: roda depois de aplicar.
--
-- ROLLBACK (manual), numa transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261026130000-corpos-anteriores.sql: devolve
-- o corpo e o comentario de 26/10/2026 (md5(prosrc)
-- 34d995f4f676fd52e66b85089383bde0 e comentario
-- 3905630f3aef4242d1307a246140865f, conferidos no fim do arquivo). Nenhum
-- dado se perde. O leitor publicado hoje le os dois corpos; com um leitor
-- que dependa das chaves novas no ar, a tela perde o texto, o link e a
-- plataforma ate reaplicar.
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

create or replace function public.anuncios_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with leads as (
        select c.id,
               case
                 when aparado.id ~ '^[0-9]{1,32}$' then aparado.id
               end as ad_id,
               -- A plataforma do lead (20261026130000): source_medium aparado
               -- como o id; vazio vira null.
               nullif(aparado.plataforma, '') as plataforma,
               (c.ctwa_clid is not null
                or c.source_ad_id is not null
                or c.source_adset_id is not null
                or c.source_campaign_id is not null
                or c.source_method is not distinct from 'anuncio_ctwa') as de_anuncio,
               exists (
                 select 1 from public.appointment a
                  where a.clinic_id = p_clinic_id and a.contact_id = c.id
               ) as agendou,
               exists (
                 select 1 from public.appointment a
                  where a.clinic_id = p_clinic_id and a.contact_id = c.id
                    and a.status = 'compareceu'
               ) as compareceu
          from public.contact c
          -- O id aparado pela regra do JavaScript (String.prototype.trim): a
          -- mesma lista de apararIdDoAnuncio, que a ingestao usa no contato e
          -- nos detalhes. O btrim sem lista so tiraria o espaco ASCII.
          -- A plataforma (source_medium), pela mesma regra (20261026130000).
          cross join lateral (
            select btrim(c.source_ad_id, E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') as id,
                   btrim(c.source_medium, E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') as plataforma
          ) aparado
         where c.clinic_id = p_clinic_id
           and c.first_contact_at >= p_de and c.first_contact_at < p_ate
      ),
      por_anuncio as (
        select l.ad_id,
               count(*) as leads,
               count(*) filter (where l.agendou) as agendaram,
               count(*) filter (where l.compareceu) as compareceram
          from leads l
         where l.ad_id is not null
         group by l.ad_id
      ),
      -- Os leads de anuncio por grupo e plataforma (20261026130000): o grupo
      -- e o anuncio da linha, ou null para os de anuncio sem id valido (os
      -- de nao_identificado). Os mesmos leads das linhas e de
      -- nao_identificado: as somas batem.
      por_plataforma as (
        select l.ad_id,
               l.plataforma,
               count(*) as leads
          from leads l
         where l.ad_id is not null or l.de_anuncio
         group by l.ad_id, l.plataforma
      ),
      plataformas as (
        select x.ad_id,
               jsonb_agg(
                 jsonb_build_object('plataforma', x.plataforma, 'leads', x.leads)
                 order by x.leads desc, x.plataforma collate "C" asc nulls last
               ) as lista
          from por_plataforma x
         group by x.ad_id
      )
      select jsonb_build_object(
        'leads', (select count(*) from leads),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'ad_id', p.ad_id,
                   'titulo', w.titulo,
                   'nome_na_meta', m.ad_name,
                   'leads', p.leads,
                   'agendaram', p.agendaram,
                   'compareceram', p.compareceram,
                   'descricao', w.descricao,
                   'link', w.link,
                   'plataformas', f.lista
                 ) order by p.leads desc, p.ad_id)
            from por_anuncio p
            left join public.anuncio_do_whatsapp w
              on w.clinic_id = p_clinic_id and w.ad_id = p.ad_id
            left join public.meta_anuncio m
              on m.clinic_id = p_clinic_id and m.ad_id = p.ad_id
            left join plataformas f
              on f.ad_id = p.ad_id
        ), '[]'::jsonb),
        'nao_identificado', (
          select jsonb_build_object(
                   'leads', count(*),
                   'agendaram', count(*) filter (where l.agendou),
                   'compareceram', count(*) filter (where l.compareceu),
                   'plataformas', coalesce((
                     select f.lista from plataformas f where f.ad_id is null
                   ), '[]'::jsonb))
            from leads l
           where l.ad_id is null and l.de_anuncio
        ),
        'sem_anuncio', (
          select jsonb_build_object(
                   'leads', count(*),
                   'agendaram', count(*) filter (where l.agendou),
                   'compareceram', count(*) filter (where l.compareceu))
            from leads l
           where l.ad_id is null and not l.de_anuncio
        )
      )
    )
  end
$$;

revoke all on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz) is
  'Leads do periodo (pela chegada) por anuncio (o id aparado como no JavaScript), com o titulo, a descricao e o link guardados (anuncio_do_whatsapp), o nome na Meta e os leads por plataforma (contact.source_medium aparado como no JavaScript, vazio vira nulo; desde 20261026130000_anuncios_com_plataforma.sql, com o formato exato no comentario dela), mais os de anuncio sem id (tambem por plataforma) e os sem anuncio da Meta. SECURITY INVOKER; nulo para o profissional.';
