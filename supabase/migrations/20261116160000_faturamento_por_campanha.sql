-- ---------------------------------------------------------------------------
-- Faturamento por campanha em Resultados (etapa 5 do plano de 16/11/2026,
-- "Rastreio completo")
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026 (benchmark do Tintim: faturamento e ROAS por
-- campanha). Cada linha de campanhas_do_periodo ganha faturamento_cents: o
-- que os leads DAQUELA campanha que chegaram no periodo ja renderam, somando
-- as consultas com comparecimento deles pelo mesmo preco de
-- faturamento_do_periodo (o do vinculo; sem ele, o base do procedimento;
-- "Coberto" pelo convenio sem preco no vinculo nao soma).
--
-- E por COORTE, como as colunas Agendados e Compareceram da mesma tabela: o
-- lead entra pelo primeiro contato no periodo, e as consultas dele contam
-- quando forem. Assim o retorno (faturamento / investimento, calculado na
-- tela) compara o gasto do periodo com o que os leads trazidos por ele
-- renderam. Por isso a soma das linhas NAO e o "Faturamento estimado" do
-- cartao, que e das consultas do periodo, de qualquer paciente.
--
-- So administrador e gestor recebem o valor (o mesmo ve_reais do
-- investimento); para os outros papeis vem nulo. Mesma assinatura e mesmos
-- grants (create or replace); a funcao continua SEM security definer: a RLS
-- de quem chama recorta as consultas.
--
-- ORDEM DE PUBLICACAO: tanto faz. O codigo antigo ignora o campo novo; o
-- codigo novo, sem a migration, mostra "Não medido" nas duas colunas.
--
-- ROLLBACK: reaplicar campanhas_do_periodo de 20261004100000.

create or replace function public.campanhas_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_de_anterior timestamptz default null
) returns jsonb
language sql
stable
set search_path = 'public'
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
         order by an.campaign_id, an.ultimo_dia_com_entrega desc nulls last,
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
                   ) as compareceu,
                   -- [faturamento] inicio
                   -- O que o lead ja rendeu: as consultas com comparecimento
                   -- dele, com o MESMO preco de faturamento_do_periodo (o do
                   -- vinculo; sem ele, o base do procedimento; "Coberto" pelo
                   -- convenio sem preco no vinculo nao soma). So para quem ve
                   -- valores.
                   case when pr.ve_reais then (
                     select coalesce(sum(
                              case
                                when sl.price_cents is not null then sl.price_cents
                                when sl.covered_by_insurance then null
                                else p2.base_price_cents
                              end
                            ), 0)::bigint
                       from appointment a
                       join service_link sl on sl.id = a.service_link_id
                       join procedure p2 on p2.id = sl.procedure_id
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                        and a.status = 'compareceu'
                   ) end as valor_cents
                   -- [faturamento] fim
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
                   coalesce(max(gc.cents), 0)::bigint as cents,
                   -- [faturamento]
                   coalesce(sum(l.valor_cents), 0)::bigint as faturamento_cents
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
                   count(*) filter (where l.compareceu) as compareceram,
                   -- [faturamento]
                   coalesce(sum(l.valor_cents), 0)::bigint as faturamento_cents
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
                   case when pr.ve_reais then m.cents end as investimento_cents,
                   -- [faturamento]
                   case when pr.ve_reais then m.faturamento_cents end as faturamento_cents
              from por_meta m
            union all
            select 'texto', 'texto:' || t.rotulo, null, t.rotulo,
                   t.leads, t.agendaram, t.compareceram, null::bigint,
                   -- [faturamento]
                   case when pr.ve_reais then t.faturamento_cents end
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
                       'investimento_cents', x.investimento_cents,
                       -- [faturamento]
                       'faturamento_cents', x.faturamento_cents
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

notify pgrst, 'reload schema';
