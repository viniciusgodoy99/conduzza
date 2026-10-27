-- Rollback manual da migration 20261026130000_anuncios_com_plataforma.sql
-- (Resultados, aba Marketing: o anuncio com o texto, o link e a plataforma,
-- 26/10/2026).
--
-- O QUE A MIGRATION FEZ: o create or replace de anuncios_do_periodo com as
-- chaves novas ("descricao", "link" e "plataformas" em cada linha;
-- "plataformas" em nao_identificado), o REVOKE e o GRANT de sempre e o
-- comentario novo. Nenhuma tabela, nenhuma outra funcao.
--
-- O QUE ESTE ARQUIVO FAZ: devolve anuncios_do_periodo ao corpo de PRODUCAO
-- de 26/10/2026 (lido com fndef.js, so leitura, copiado sem mudanca;
-- md5(prosrc) 34d995f4f676fd52e66b85089383bde0, o da migration
-- 20261020100000) e ao comentario de entao (md5
-- 3905630f3aef4242d1307a246140865f), com os grants de sempre (EXECUTE so
-- para authenticated e service_role); confere os dois md5 e os grants no
-- fim (com outro valor, falha e desfaz tudo).
--
-- ORDEM: tanto faz. O leitor publicado (lib/queries/relatorios.ts,
-- fetchAnunciosDoPeriodo, do commit 1d48781) le os dois corpos (ignora as
-- chaves novas). Com um leitor no ar que mostre as chaves novas, a tela
-- perde o texto, o link e a divisao por plataforma ate reaplicar (conferir,
-- antes, que esse leitor aceita a falta delas).
--
-- O QUE SE PERDE: nenhum dado (a funcao so le).
--
-- TRAVAS: so catalogo (pg_proc e pg_description), nenhuma tabela.
-- lock_timeout de 1 s (menor que o da migration, de proposito): com o
-- catalogo ocupado, o rollback falha inteiro e roda-se de novo.
--
-- Rodar inteiro, numa transacao, no SQL editor, em horario calmo.

begin;
set local lock_timeout = '1s';

-- O corpo de producao de 26/10/2026 (fndef.js), sem mudanca.
CREATE OR REPLACE FUNCTION public.anuncios_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with leads as (
        select c.id,
               case
                 when aparado.id ~ '^[0-9]{1,32}$' then aparado.id
               end as ad_id,
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
          cross join lateral (
            select btrim(c.source_ad_id, E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') as id
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
                   'compareceram', p.compareceram
                 ) order by p.leads desc, p.ad_id)
            from por_anuncio p
            left join public.anuncio_do_whatsapp w
              on w.clinic_id = p_clinic_id and w.ad_id = p.ad_id
            left join public.meta_anuncio m
              on m.clinic_id = p_clinic_id and m.ad_id = p.ad_id
        ), '[]'::jsonb),
        'nao_identificado', (
          select jsonb_build_object(
                   'leads', count(*),
                   'agendaram', count(*) filter (where l.agendou),
                   'compareceram', count(*) filter (where l.compareceu))
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
$function$
;

revoke all on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz) is
  'Leads do periodo (pela chegada) por anuncio (o id aparado como no JavaScript), com o titulo guardado e o nome na Meta, mais os de anuncio sem id e os sem anuncio da Meta. SECURITY INVOKER; nulo para o profissional.';

do $conferencia$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.anuncios_do_periodo(uuid,timestamptz,timestamptz)'))
     is distinct from '34d995f4f676fd52e66b85089383bde0'
     or md5(obj_description(to_regprocedure('public.anuncios_do_periodo(uuid,timestamptz,timestamptz)'), 'pg_proc'))
     is distinct from '3905630f3aef4242d1307a246140865f'
  then
    raise exception 'ROLLBACK: anuncios_do_periodo nao voltou ao corpo e ao comentario de 26/10/2026';
  end if;
  if (select string_agg(a::text, ',' order by a::text)
        from pg_proc p, unnest(p.proacl) a
       where p.oid = to_regprocedure('public.anuncios_do_periodo(uuid,timestamptz,timestamptz)'))
     is distinct from 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'
  then
    raise exception 'ROLLBACK: os grants de anuncios_do_periodo nao sao os de 26/10/2026';
  end if;
end;
$conferencia$;

commit;
