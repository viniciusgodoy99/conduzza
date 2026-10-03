-- ---------------------------------------------------------------------------
-- Campanhas do periodo e atribuicao de anuncio protegida (Fase 4, 03/10/2026)
-- ---------------------------------------------------------------------------
-- O QUE FAZ (contrato fechado em scratchpad/fase4/critica.md, secao 4.2):
--
-- 1. Gatilho proteger_atribuicao_de_anuncio em contact: com sessao
--    (auth.uid() nao nulo), o INSERT zera e o UPDATE preserva ctwa_clid,
--    source_ad_id, source_adset_id e source_campaign_id. Hoje a sessao (admin,
--    gestor e recepcao, pela policy de UPDATE de contact) podia reescrever
--    esses ids pela API e mover lead de campanha, o que mente no custo por
--    lead e no retorno de conversao. Escritores conferidos em 03/10: so a
--    ingestao (service role) e os testes com service role, que continuam
--    livres. Molde de proteger_relogios_do_contato (20261002130000).
--    O gatilho NAO protege a atribuicao contra o service role: a regra "o
--    primeiro anuncio vence" (um referral seguinte, com ou sem clid, nao
--    troca o source_ad_id ja gravado) e da captura na ingestao,
--    lib/integrations/whatsapp/ingest.ts, que so atualiza enquanto ctwa_clid
--    E source_ad_id estao nulos. campanhas_do_periodo casa primeiro por
--    source_ad_id: sem essa regra, o lead mudaria de campanha depois de o
--    periodo fechar.
--
-- 2. campanhas_do_periodo: a tabela Campanhas e o custo por lead de
--    Resultados. SECURITY INVOKER (a RLS recorta clinica e papel), null para
--    o profissional (mesma regra de funil_do_periodo), investimento null
--    para quem nao e admin nem gestor (mesma regra de
--    faturamento_do_periodo). As contagens de leads sao as MESMAS em todos os
--    papeis: dependem so de contact, appointment e meta_anuncio, que todo
--    membro ativo le.
--
--    Lead: chegada por first_contact_at em [p_de, p_ate) (o criterio de
--    "Leads recebidos" do funil). Gasto: dia em [dia_de, dia_ate], os dias
--    civis da clinica tocados pela janela (o dia do gasto e o rotulo do dia
--    da conta de anuncios: sem quebra por hora nao ha conversao).
--
--    Casamento SO POR ID, nunca por nome, nesta ordem:
--      a) contact.source_ad_id -> meta_anuncio.ad_id -> campaign_id;
--      b) contact.source_campaign_id, se for campanha conhecida em
--         meta_anuncio.
--    Cada lead cai numa linha so: 'meta' (casado), 'texto' (so tem
--    source_campaign digitado ou importado: conta lead, nunca casa com
--    gasto) ou fica em leads_sem_campanha. Invariante: soma dos leads das
--    linhas + leads_sem_campanha = leads = leads do funil_do_periodo.
--
--    Lead de anuncio: tem ctwa_clid, source_ad_id ou source_campaign_id (o
--    lead casado e sempre de anuncio). O divisor do custo por lead e
--    escolhido no TS (decisao D2 do dono pendente), por isso a funcao
--    devolve as tres contagens: leads, leads_de_anuncio e leads_casados.
--
--    Moeda: so linhas em BRL entram nas somas; havendo linha em outra moeda
--    no periodo, outra_moeda = true. Nunca converte.
--
-- O que NAO esta aqui, de proposito: o caminho do lead de link
-- (campaign_link.meta_campaign_id, decisao D1) e a origem gravada do lead de
-- anuncio (source_channel trafego_pago, decisao D3). Os dois esperam o dono.
--
-- ROLLBACK (manual): drop function campanhas_do_periodo; drop trigger
-- proteger_atribuicao_de_anuncio on contact; drop function
-- proteger_atribuicao_de_anuncio.

-- ---------------------------------------------------------------------------
-- 1) Atribuicao de anuncio: a sessao nao escreve
-- ---------------------------------------------------------------------------

create or replace function public.proteger_atribuicao_de_anuncio()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ctwa_clid := null;
    new.source_ad_id := null;
    new.source_adset_id := null;
    new.source_campaign_id := null;
    return new;
  end if;
  new.ctwa_clid := old.ctwa_clid;
  new.source_ad_id := old.source_ad_id;
  new.source_adset_id := old.source_adset_id;
  new.source_campaign_id := old.source_campaign_id;
  return new;
end;
$$;

revoke all on function public.proteger_atribuicao_de_anuncio()
  from public, anon, authenticated;

drop trigger if exists proteger_atribuicao_de_anuncio on public.contact;
create trigger proteger_atribuicao_de_anuncio
  before insert or update of ctwa_clid, source_ad_id, source_adset_id, source_campaign_id
  on public.contact
  for each row execute function public.proteger_atribuicao_de_anuncio();

-- ---------------------------------------------------------------------------
-- 2) campanhas_do_periodo
-- ---------------------------------------------------------------------------
-- Formato: {atual: Bloco, anterior?: Bloco} (anterior so com p_de_anterior;
-- janela [p_de_anterior, p_de)). Bloco:
--   leads, leads_de_anuncio, leads_casados, leads_de_anuncio_sem_campanha,
--   leads_sem_campanha: inteiros
--   linhas: [{chave, tipo: 'meta'|'texto', meta_campaign_id (null em texto),
--             rotulo (nome mais recente da campanha, pode ser null em meta;
--             o texto digitado em texto), leads, agendaram, compareceram,
--             investimento_cents (BRL; null fora da gestao e sempre null em
--             texto)}]
--     ordem: meta antes de texto; investimento desc; leads desc; chave.
--     Campanha da Meta com 0 lead so aparece para a gestao (quando teve
--     gasto em BRL no periodo).
--   investimento: null fora da gestao; para admin, gestor e service role:
--     {configurada (conta salva e linha de leitura existente), situacao,
--      problema, moeda, fuso_da_conta, lido_desde, lido_ate,
--      sincronizado_em, dia_de, dia_ate,
--      investimento_cents (total da conta em BRL no periodo),
--      investimento_casado_cents (campanhas com lead casado no periodo),
--      investimento_sem_lead_cents (campanhas sem lead casado),
--      campanhas_sem_lead, outra_moeda}

create or replace function public.campanhas_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_de_anterior timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with params as (
        select coalesce(
                 (select c.timezone from clinic c where c.id = p_clinic_id),
                 'America/Fortaleza'
               ) as tz,
               -- Valor em reais so para admin e gestor da clinica pedida.
               -- service_role (auth.uid() nulo) passa; anon nao tem grant.
               (auth.uid() is null
                or public.user_has_role(p_clinic_id, array['admin', 'gestor'])) as ve_reais
      ),
      -- Campanha conhecida: o mapa anuncio -> campanha (todo membro ativo
      -- le), com o nome mais recente informado pela Meta.
      campanha_meta as (
        select distinct on (an.campaign_id) an.campaign_id, an.campaign_name
          from meta_anuncio an
         where an.clinic_id = p_clinic_id
         order by an.campaign_id, an.ultimo_dia_com_entrega desc,
                  an.atualizado_em desc, an.ad_id
      ),
      janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
        from janelas j
        cross join params pr
        cross join lateral (
          with dias as (
            select (j.de at time zone pr.tz)::date as dia_de,
                   ((j.ate at time zone pr.tz) - interval '1 microsecond')::date as dia_ate
          ),
          leads as (
            select c.id,
                   nullif(btrim(c.source_campaign), '') as rotulo_texto,
                   coalesce(an.campaign_id, cr.campaign_id) as meta_campaign_id,
                   (c.ctwa_clid is not null
                    or c.source_ad_id is not null
                    or c.source_campaign_id is not null) as de_anuncio,
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
              left join meta_anuncio an
                on an.clinic_id = p_clinic_id and an.ad_id = c.source_ad_id
              left join campanha_meta cr
                on cr.campaign_id = c.source_campaign_id
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= j.de and c.first_contact_at < j.ate
          ),
          -- Gasto por campanha (BRL) no periodo. Para quem nao ve valor a
          -- RLS ja esvazia; o filtro deixa explicito e poupa a leitura.
          gasto_campanha as (
            select g.campaign_id,
                   sum(g.spend_cents)::bigint as cents,
                   (array_agg(g.campaign_name order by g.dia desc)
                      filter (where g.campaign_name is not null))[1] as nome
              from meta_gasto_diario g
             cross join dias d
             where pr.ve_reais
               and g.clinic_id = p_clinic_id
               and g.currency = 'BRL'
               and g.dia between d.dia_de and d.dia_ate
             group by g.campaign_id
          ),
          por_meta as (
            select k.campaign_id,
                   coalesce(cm.campaign_name, gc.nome) as rotulo,
                   count(l.id) as leads,
                   count(l.id) filter (where l.agendou) as agendaram,
                   count(l.id) filter (where l.compareceu) as compareceram,
                   coalesce(max(gc.cents), 0)::bigint as cents
              from (
                select campaign_id from campanha_meta
                union
                select campaign_id from gasto_campanha
              ) k
              left join campanha_meta cm on cm.campaign_id = k.campaign_id
              left join gasto_campanha gc on gc.campaign_id = k.campaign_id
              left join leads l on l.meta_campaign_id = k.campaign_id
             group by k.campaign_id, cm.campaign_name, gc.nome
            having count(l.id) > 0 or coalesce(max(gc.cents), 0) > 0
          ),
          por_texto as (
            select l.rotulo_texto as rotulo,
                   count(*) as leads,
                   count(*) filter (where l.agendou) as agendaram,
                   count(*) filter (where l.compareceu) as compareceram
              from leads l
             where l.meta_campaign_id is null and l.rotulo_texto is not null
             group by l.rotulo_texto
          ),
          linhas as (
            select 'meta'::text as tipo,
                   'meta:' || m.campaign_id as chave,
                   m.campaign_id as meta_campaign_id,
                   m.rotulo,
                   m.leads, m.agendaram, m.compareceram,
                   case when pr.ve_reais then m.cents end as investimento_cents
              from por_meta m
            union all
            select 'texto', 'texto:' || t.rotulo, null, t.rotulo,
                   t.leads, t.agendaram, t.compareceram, null::bigint
              from por_texto t
          )
          select jsonb_build_object(
            'leads', (select count(*) from leads),
            'leads_de_anuncio', (select count(*) from leads where de_anuncio),
            'leads_casados', (select count(*) from leads where meta_campaign_id is not null),
            'leads_de_anuncio_sem_campanha', (
              select count(*) from leads where de_anuncio and meta_campaign_id is null
            ),
            'leads_sem_campanha', (
              select count(*) from leads
               where meta_campaign_id is null and rotulo_texto is null
            ),
            'linhas', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'chave', x.chave,
                       'tipo', x.tipo,
                       'meta_campaign_id', x.meta_campaign_id,
                       'rotulo', x.rotulo,
                       'leads', x.leads,
                       'agendaram', x.agendaram,
                       'compareceram', x.compareceram,
                       'investimento_cents', x.investimento_cents
                     ) order by (x.tipo = 'texto'), coalesce(x.investimento_cents, 0) desc,
                                x.leads desc, x.chave), '[]'::jsonb)
                from linhas x
            ),
            'investimento', case when pr.ve_reais then (
              select jsonb_build_object(
                'configurada', (ma.ad_account_id is not null and lt.clinic_id is not null),
                'situacao', lt.situacao,
                'problema', lt.problema,
                'moeda', lt.moeda,
                'fuso_da_conta', lt.fuso_da_conta,
                'lido_desde', lt.lido_desde,
                'lido_ate', lt.lido_ate,
                'sincronizado_em', lt.sincronizado_em,
                'dia_de', d.dia_de,
                'dia_ate', d.dia_ate,
                'investimento_cents', coalesce((
                  select sum(gc.spend_cents)::bigint
                    from meta_gasto_conta_diario gc
                   where gc.clinic_id = p_clinic_id
                     and gc.currency = 'BRL'
                     and gc.dia between d.dia_de and d.dia_ate
                ), 0),
                'investimento_casado_cents', coalesce((
                  select sum(m.cents)::bigint from por_meta m where m.leads > 0
                ), 0),
                'investimento_sem_lead_cents', coalesce((
                  select sum(m.cents)::bigint from por_meta m where m.leads = 0
                ), 0),
                'campanhas_sem_lead', (select count(*) from por_meta m where m.leads = 0),
                'outra_moeda', (
                  exists (
                    select 1 from meta_gasto_conta_diario gc
                     where gc.clinic_id = p_clinic_id
                       and gc.currency <> 'BRL'
                       and gc.dia between d.dia_de and d.dia_ate
                  )
                  or exists (
                    select 1 from meta_gasto_diario g
                     where g.clinic_id = p_clinic_id
                       and g.currency <> 'BRL'
                       and g.dia between d.dia_de and d.dia_ate
                  )
                )
              )
                from dias d
                left join meta_ads_account ma on ma.clinic_id = p_clinic_id
                left join meta_gasto_leitura lt on lt.clinic_id = p_clinic_id
            ) end
          ) as corpo
        ) bloco
    )
  end
$$;

revoke all on function public.campanhas_do_periodo(uuid, timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.campanhas_do_periodo(uuid, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.campanhas_do_periodo(uuid, timestamptz, timestamptz, timestamptz) is
  'Resultados, Campanhas e custo por lead: leads por chegada em [p_de, p_ate) casados com a campanha da Meta so por id (source_ad_id -> meta_anuncio, depois source_campaign_id conhecido), linhas meta e texto, contagens de leads, de anuncio e casados, e o investimento (total da conta e por campanha, BRL, dias civis da clinica). Mesmas contagens em todo papel; investimento null fora de admin e gestor; null para o profissional. SECURITY INVOKER.';
