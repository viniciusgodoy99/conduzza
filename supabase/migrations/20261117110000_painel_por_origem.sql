-- Painel por origem em Resultados (decisao do dono de 17/11/2026, da revisao
-- da frente "substituir o Tintim"): os quatro grupos do Tintim, Meta Ads,
-- Google Ads, Outras origens e Nao rastreada, como filtro e como grafico por
-- dia. Nenhuma tabela nem coluna nova.
--
-- 1) grupo_de_origem: a regra dos quatro grupos, num lugar so.
-- 2) funil_do_periodo ganha p_grupo (nulo: todas as origens) e devolve
--    por_grupo (leads do periodo em cada grupo, sem o filtro).
-- 3) serie_diaria_do_periodo ganha p_grupo e devolve por_grupo em cada dia.
--
-- As duas funcoes foram tiradas da producao (pg_get_functiondef) em
-- 17/11/2026 e so os trechos marcados com [painel por origem] mudaram.
-- Continuam security invoker: a RLS de contact e de appointment decide.
-- O parametro novo tem default: o codigo publicado antes (que chama sem ele)
-- continua funcionando. drop + create (e nao create or replace) porque a
-- assinatura muda; duas versoes lado a lado deixariam a chamada ambigua.
--
-- ROLLBACK (manual): drop das duas funcoes novas e de grupo_de_origem;
-- reaplicar funil_do_periodo de 20260918100000_agregados_por_periodo.sql e
-- serie_diaria_do_periodo de 20261002110000_metricas_da_fase_3.sql.

-- ---------------------------------------------------------------------------
-- 1) Os quatro grupos
-- ---------------------------------------------------------------------------

create function public.grupo_de_origem(
  p_canal text,
  p_origem text,
  p_ctwa_clid text,
  p_anuncio text,
  p_campanha_meta text,
  p_campanha_google text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Anuncio da Meta: o que abre o WhatsApp (ctwa), o que leva ao site ou ao
    -- link com o numero do anuncio, e a origem 'Meta' (reservada ao anuncio).
    when p_origem = 'Meta' or p_ctwa_clid is not null
      or p_anuncio is not null or p_campanha_meta is not null then 'meta'
    -- Anuncio do Google: a origem 'Google' (reservada ao anuncio) ou a campanha.
    when p_origem = 'Google' or p_campanha_google is not null then 'google'
    when p_canal is null then 'nao_rastreada'
    else 'outras'
  end
$$;

revoke all on function public.grupo_de_origem(text, text, text, text, text, text) from public, anon;
grant execute on function public.grupo_de_origem(text, text, text, text, text, text) to authenticated, service_role;

comment on function public.grupo_de_origem(text, text, text, text, text, text) is
  'Os quatro grupos do painel por origem (meta, google, outras, nao_rastreada) a partir da origem do contato. Usada por funil_do_periodo e serie_diaria_do_periodo (17/11/2026).';

-- ---------------------------------------------------------------------------
-- 2) funil_do_periodo com o filtro de grupo
-- ---------------------------------------------------------------------------

drop function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz);

CREATE FUNCTION public.funil_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone, p_grupo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
        from janelas j
        cross join lateral (
          with leads as (
            select c.id,
                   c.source_channel,
                   c.source_campaign,
                   c.source_campaign_id,
                   exists (
                     select 1 from appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                   ) as agendou,
                   exists (
                     select 1 from appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                        and a.status = 'compareceu'
                   ) as compareceu
              from contact c
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= j.de and c.first_contact_at < j.ate
               -- [painel por origem] o filtro da tela (nulo: todas as origens)
               and (p_grupo is null or public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) = p_grupo)
          )
          select jsonb_build_object(
            'leads', (select count(*) from leads),
            'agendamentos_criados', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id
                 and a.created_at >= j.de and a.created_at < j.ate
                 -- [painel por origem] a consulta entra pelo grupo do contato dela
                 and (p_grupo is null or exists (
                   select 1 from contact c2
                    where c2.id = a.contact_id and c2.clinic_id = p_clinic_id
                      and public.grupo_de_origem(c2.source_channel, c2.source_origin, c2.ctwa_clid, c2.source_ad_id, c2.source_campaign_id, c2.source_google_campaign_id) = p_grupo
                 ))
            ),
            'comparecimentos', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id and a.status = 'compareceu'
                 and a.starts_at >= j.de and a.starts_at < j.ate
                 -- [painel por origem] a consulta entra pelo grupo do contato dela
                 and (p_grupo is null or exists (
                   select 1 from contact c2
                    where c2.id = a.contact_id and c2.clinic_id = p_clinic_id
                      and public.grupo_de_origem(c2.source_channel, c2.source_origin, c2.ctwa_clid, c2.source_ad_id, c2.source_campaign_id, c2.source_google_campaign_id) = p_grupo
                 ))
            ),
            'faltas', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id and a.status = 'faltou'
                 and a.starts_at >= j.de and a.starts_at < j.ate
                 -- [painel por origem] a consulta entra pelo grupo do contato dela
                 and (p_grupo is null or exists (
                   select 1 from contact c2
                    where c2.id = a.contact_id and c2.clinic_id = p_clinic_id
                      and public.grupo_de_origem(c2.source_channel, c2.source_origin, c2.ctwa_clid, c2.source_ad_id, c2.source_campaign_id, c2.source_google_campaign_id) = p_grupo
                 ))
            ),
            -- [painel por origem] quantos leads do periodo em cada grupo, SEM
            -- o filtro: e o que a tela mostra ao lado de cada opcao.
            'por_grupo', (
              select coalesce(jsonb_object_agg(t.grupo, t.n), '{}'::jsonb)
                from (
                  select public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) as grupo, count(*) as n
                    from contact c
                   where c.clinic_id = p_clinic_id
                     and c.first_contact_at >= j.de and c.first_contact_at < j.ate
                   group by 1
                ) t
            ),
            'coorte', (
              select jsonb_build_object(
                'leads', count(*),
                'agendaram', count(*) filter (where agendou),
                'compareceram', count(*) filter (where compareceu)
              ) from leads
            ),
            'por_canal', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'canal', t.canal, 'leads', t.n,
                       'agendaram', t.ag, 'compareceram', t.comp
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select source_channel as canal, count(*) as n,
                         count(*) filter (where agendou) as ag,
                         count(*) filter (where compareceu) as comp
                    from leads group by 1
                ) t
            ),
            'por_campanha', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'campanha', t.campanha, 'campanha_id', t.campanha_id,
                       'leads', t.n, 'agendaram', t.ag, 'compareceram', t.comp
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select source_campaign as campanha,
                         source_campaign_id as campanha_id,
                         count(*) as n,
                         count(*) filter (where agendou) as ag,
                         count(*) filter (where compareceu) as comp
                    from leads group by 1, 2
                ) t
            )
          ) as corpo
        ) bloco
    )
  end
$function$;

revoke all on function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz, text) to authenticated, service_role;

comment on function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz, text) is
  'Resultados: leads, agendamentos, comparecimentos, faltas, coorte, por_canal e por_campanha do periodo (e do anterior). p_grupo (meta, google, outras, nao_rastreada) filtra pelo grupo de origem do contato; nulo, todas as origens. por_grupo traz os leads de cada grupo sem o filtro. Security invoker (RLS).';

-- ---------------------------------------------------------------------------
-- 3) serie_diaria_do_periodo com o filtro e a serie por grupo
-- ---------------------------------------------------------------------------

drop function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.serie_diaria_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_grupo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with fuso as (
        select coalesce(
                 (select c.timezone from clinic c where c.id = p_clinic_id),
                 'America/Fortaleza'
               ) as tz
      ),
      -- Todo dia civil tocado por [p_de, p_ate), sem pular dia vazio. O
      -- generate_series vai em timestamp sem fuso para o ::date nao passar
      -- pelo fuso da sessao.
      dias as (
        select s.dia_local::date as dia
          from fuso f
         cross join generate_series(
                (p_de at time zone f.tz)::date::timestamp,
                ((p_ate at time zone f.tz) - interval '1 microsecond')::date::timestamp,
                interval '1 day'
              ) as s (dia_local)
      ),
      -- Mesmos criterios de funil_do_periodo: leads por first_contact_at,
      -- agendamentos por created_at, janela semiaberta.
      l as (
        select (c.first_contact_at at time zone f.tz)::date as dia, count(*) as n
          from contact c
         cross join fuso f
         where c.clinic_id = p_clinic_id
           and c.first_contact_at >= p_de and c.first_contact_at < p_ate
           -- [painel por origem] o filtro da tela (nulo: todas as origens)
           and (p_grupo is null or public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) = p_grupo)
         group by 1
      ),
      -- [painel por origem] leads por dia em cada grupo, SEM o filtro: o
      -- grafico "Origem dos leads por dia".
      lg as (
        select t.dia,
               count(*) filter (where t.grupo = 'meta') as meta,
               count(*) filter (where t.grupo = 'google') as google,
               count(*) filter (where t.grupo = 'outras') as outras,
               count(*) filter (where t.grupo = 'nao_rastreada') as nao_rastreada
          from (
            select (c.first_contact_at at time zone f.tz)::date as dia,
                   public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) as grupo
              from contact c
             cross join fuso f
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= p_de and c.first_contact_at < p_ate
          ) t
         group by 1
      ),
      g as (
        select (a.created_at at time zone f.tz)::date as dia, count(*) as n
          from appointment a
         cross join fuso f
         where a.clinic_id = p_clinic_id
           and a.created_at >= p_de and a.created_at < p_ate
           -- [painel por origem] a consulta entra pelo grupo do contato dela
           and (p_grupo is null or exists (
             select 1 from contact c2
              where c2.id = a.contact_id and c2.clinic_id = p_clinic_id
                and public.grupo_de_origem(c2.source_channel, c2.source_origin, c2.ctwa_clid, c2.source_ad_id, c2.source_campaign_id, c2.source_google_campaign_id) = p_grupo
           ))
         group by 1
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'dia', d.dia,
               'leads', coalesce(l.n, 0),
               'agendadas', coalesce(g.n, 0),
               'por_grupo', jsonb_build_object(
                 'meta', coalesce(lg.meta, 0),
                 'google', coalesce(lg.google, 0),
                 'outras', coalesce(lg.outras, 0),
                 'nao_rastreada', coalesce(lg.nao_rastreada, 0)
               )
             ) order by d.dia), '[]'::jsonb)
        from dias d
        left join l on l.dia = d.dia
        left join g on g.dia = d.dia
        left join lg on lg.dia = d.dia
    )
  end
$function$;

revoke all on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

comment on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz, text) is
  'Resultados, por dia civil da clinica em [p_de, p_ate): leads (por first_contact_at) e consultas agendadas (por created_at), com p_grupo filtrando pelo grupo de origem do contato (nulo: todas), e por_grupo com os leads do dia em cada grupo, sem o filtro. Security invoker (RLS).';

notify pgrst, 'reload schema';
