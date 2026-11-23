-- Venda pela Jornada (decisao do dono de 23/11/2026): a marca "Esta etapa e
-- uma venda" da Jornada (funnel_stage_def.is_sale) passa a gerar numeros em
-- Resultados: Vendas e Valor das vendas, separados do faturamento estimado
-- (que continua vindo das consultas com comparecimento; o retorno das
-- campanhas nao muda).
--
-- Depende da 20261123100000_metricas_certas (campanhas_do_periodo parte do
-- corpo DELA, nao do da producao). Aplicar depois dela.
--
-- ROLLBACK (manual, numa transacao, depois de voltar o codigo):
--   1. reaplicar campanhas_do_periodo da 20261123100000 (create or replace,
--      mesma assinatura; os grants ficam);
--   2. drop function public.vendas_do_periodo(uuid, timestamptz, timestamptz, text);
--   3. drop trigger registrar_venda_da_jornada on public.contact;
--      drop function public.registrar_venda_da_jornada();
--   4. drop table public.venda_da_jornada (as vendas registradas somem; sao
--      so derivadas do movimento do funil, nao ha outro lugar com elas).
--
-- O QUE E UMA VENDA: cada ENTRADA de um contato numa etapa marcada como
-- venda, a partir de quando a etapa esta marcada. Sair e voltar conta de novo
-- (diferente de conversion_event, que e uma por contato e etapa). Desmarcar a
-- etapa nao apaga as vendas ja registradas. O valor e o da conversao da etapa
-- (valor_da_conversao: fixo, o preco da consulta do agendamento, ou nulo),
-- fotografado na entrada. A marca vale mesmo com a conversao da Meta pausada
-- (conversao_ativa) ou sem evento: so is_sale decide.
--
-- QUEM VE: a mesma regra do faturamento (faturamento_do_periodo e os valores
-- de campanhas_do_periodo): admin e gestor da clinica, e o service_role.
-- Contagem e valor juntos: para os outros papeis a RPC devolve null e as
-- colunas da tabela Campanhas vem nulas.
--
-- TRAVAS: lock_timeout de 3 s. A tabela e nova. O create trigger em contact
-- pega SHARE ROW EXCLUSIVE ate o commit (a gravacao de contato espera, a
-- leitura nao); a carga inicial vem DEPOIS do gatilho, com a trava ja na mao:
-- nenhum movimento fica de fora nem conta duas vezes. Os create or replace so
-- tocam o catalogo. Horario calmo.

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) A tabela
-- ---------------------------------------------------------------------------

create table public.venda_da_jornada (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- Apagar o contato (pedido do titular, LGPD) leva as vendas dele.
  contact_id uuid not null references public.contact (id) on delete cascade,
  -- A chave da etapa no momento da venda. Nao e FK para funnel_stage_def de
  -- proposito (como conversion_event.stage_chave): excluir a etapa depois
  -- nao apaga a venda.
  etapa_chave text not null,
  -- Nulo quando a etapa nao tem valor (ou o preco da consulta nao existe).
  value_cents integer check (value_cents is null or value_cents >= 0),
  vendido_em timestamptz not null default now()
);

comment on table public.venda_da_jornada is
  'Venda pela Jornada (23/11/2026): uma linha por entrada de um contato numa etapa com is_sale, gravada so pelo gatilho registrar_venda_da_jornada (e pela carga inicial da migration). Le: admin e gestor da clinica. Ninguem da sessao grava.';

create index venda_da_jornada_periodo_idx
  on public.venda_da_jornada (clinic_id, vendido_em);
-- A cascata de contact procura por aqui.
create index venda_da_jornada_contato_idx
  on public.venda_da_jornada (contact_id);

alter table public.venda_da_jornada enable row level security;

-- So leitura, e so de quem ve o faturamento. NENHUMA policy de escrita.
create policy "gestao le as vendas da clinica" on public.venda_da_jornada
  for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- Os privilegios padrao do schema dao tudo a anon, authenticated e
-- service_role: so fica a leitura. O service_role tambem nao grava (so o
-- gatilho, security definer); a cascata da chave estrangeira nao depende
-- de grant.
revoke all on table public.venda_da_jornada from anon, authenticated, service_role;
grant select on table public.venda_da_jornada to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) O gatilho
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER: dispara na sessao de quem moveu o lead, que nao grava a
-- tabela (o mesmo padrao de registrar_conversao_do_funil). Melhor esforco de
-- verdade: venda perdida e melhor que arrastar do Kanban quebrado.
create function public.registrar_venda_da_jornada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def record;
begin
  if new.funnel_stage is null
     or (tg_op = 'UPDATE'
         and new.funnel_stage is not distinct from old.funnel_stage) then
    return new;
  end if;

  select d.value_source, d.value_cents
    into v_def
    from public.funnel_stage_def d
   where d.clinic_id = new.clinic_id
     and d.chave = new.funnel_stage
     and d.is_sale;
  if not found then
    return new;
  end if;

  insert into public.venda_da_jornada
    (clinic_id, contact_id, etapa_chave, value_cents)
  values (
    new.clinic_id,
    new.id,
    new.funnel_stage,
    public.valor_da_conversao(
      new.clinic_id, new.id, v_def.value_source, v_def.value_cents)
  );
  return new;
exception when others then
  -- Nunca bloquear o movimento do funil. Warning sem dado de paciente.
  raise warning 'registro de venda da jornada falhou (clinic %): %',
    new.clinic_id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.registrar_venda_da_jornada() from public, anon, authenticated, service_role;

comment on function public.registrar_venda_da_jornada() is
  'Gatilho de contact (23/11/2026): ao ENTRAR numa etapa com is_sale grava uma linha em venda_da_jornada, com o valor de valor_da_conversao. Sair e voltar conta de novo. Erro vira warning sem dado de paciente: nunca trava o movimento do funil. Ninguem executa direto.';

create trigger registrar_venda_da_jornada
  after insert or update of funnel_stage on public.contact
  for each row execute function public.registrar_venda_da_jornada();

-- ---------------------------------------------------------------------------
-- 3) Carga inicial: quem ja esta numa etapa de venda
-- ---------------------------------------------------------------------------
-- Em 23/11/2026 nenhuma etapa da producao tem is_sale: zero linhas. O
-- momento e a entrada na etapa (funnel_stage_changed_at; sem ele, a criacao
-- do contato).

insert into public.venda_da_jornada
  (clinic_id, contact_id, etapa_chave, value_cents, vendido_em)
select c.clinic_id,
       c.id,
       c.funnel_stage,
       public.valor_da_conversao(c.clinic_id, c.id, d.value_source, d.value_cents),
       coalesce(c.funnel_stage_changed_at, c.created_at)
  from public.contact c
  join public.funnel_stage_def d
    on d.clinic_id = c.clinic_id
   and d.chave = c.funnel_stage
   and d.is_sale;

-- ---------------------------------------------------------------------------
-- 4) vendas_do_periodo: os cartoes Vendas e Valor das vendas
-- ---------------------------------------------------------------------------

create function public.vendas_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_grupo text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    -- A regra do faturamento: so admin e gestor da clinica pedida.
    -- service_role (auth.uid() nulo) passa; anon nao tem grant.
    when auth.uid() is not null
         and not public.user_has_role(p_clinic_id, array['admin', 'gestor'])
      then null::jsonb
    else (
      select jsonb_build_object(
        -- Sem nenhuma etapa marcada, a tela explica como marcar.
        'tem_etapa_de_venda', exists (
          select 1 from public.funnel_stage_def d
           where d.clinic_id = p_clinic_id and d.is_sale
        ),
        'vendas', count(*),
        'valor_cents', coalesce(sum(v.value_cents), 0),
        'sem_valor', count(*) filter (where v.value_cents is null)
      )
        from public.venda_da_jornada v
       where v.clinic_id = p_clinic_id
         -- Pelo momento da venda, nao pela chegada do lead.
         and v.vendido_em >= p_de and v.vendido_em < p_ate
         -- O filtro de origem da tela, pelo grupo do contato (nulo: todas).
         and (p_grupo is null or exists (
           select 1 from public.contact c
            where c.id = v.contact_id and c.clinic_id = p_clinic_id
              and public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) = p_grupo
         ))
    )
  end
$$;

revoke all on function public.vendas_do_periodo(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.vendas_do_periodo(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

comment on function public.vendas_do_periodo(uuid, timestamptz, timestamptz, text) is
  'Resultados, Vendas e Valor das vendas (23/11/2026): as linhas de venda_da_jornada com vendido_em em [p_de, p_ate), com p_grupo filtrando pelo grupo de origem do contato (nulo: todas). {tem_etapa_de_venda, vendas, valor_cents, sem_valor}. null para quem nao e admin nem gestor da clinica. SECURITY INVOKER (RLS de venda_da_jornada).';

-- ---------------------------------------------------------------------------
-- 5) campanhas_do_periodo: Vendas e Valor das vendas por campanha
-- ---------------------------------------------------------------------------
-- Corpo da 20261123100000 (metricas certas); os trechos novos estao marcados
-- com [venda pela jornada]. Mesma assinatura (create or replace mantem os
-- grants). A venda entra na campanha do contato pela MESMA regra do lead
-- (anuncio -> meta_anuncio, senao id de campanha conhecido, senao o texto),
-- pelo momento da venda, sem o filtro de origem (como o resto da tabela).
-- Uma campanha so com venda no periodo (sem lead nem gasto) vira linha.

CREATE OR REPLACE FUNCTION public.campanhas_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with params as (
        select coalesce(
                 (select c.timezone from public.clinic c where c.id = p_clinic_id),
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
          from public.meta_anuncio an
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
                   -- [metricas certas] o divisor do custo por lead e o grupo
                   -- "Meta Ads" do painel por origem (grupo_de_origem).
                   (public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) = 'meta') as de_anuncio,
                   exists (
                     select 1 from public.appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                        -- [metricas certas] Agendou da Jornada: sem a pendente e a recusada
                        and coalesce(a.approval_status, 'aprovado') = 'aprovado'
                   ) as agendou,
                   cmp.comparecimentos > 0 as compareceu,
                   -- [metricas certas] as consultas com comparecimento do lead
                   cmp.comparecimentos,
                   -- [faturamento] inicio
                   -- O que o lead ja rendeu: as consultas com comparecimento
                   -- dele, com o MESMO preco de faturamento_do_periodo (o do
                   -- vinculo; sem ele, o base do procedimento; "Coberto" pelo
                   -- convenio sem preco no vinculo nao soma). So para quem ve
                   -- valores.
                   case when pr.ve_reais then cmp.valor_cents end as valor_cents,
                   -- [faturamento] fim
                   -- [metricas certas] as que nao tem preco para somar
                   case when pr.ve_reais then cmp.sem_preco end as sem_preco
              from public.contact c
              left join public.meta_anuncio an
                on an.clinic_id = p_clinic_id and an.ad_id = c.source_ad_id
              left join campanha_meta cr
                on cr.campaign_id = c.source_campaign_id
              -- [metricas certas] uma passada pelas consultas com
              -- comparecimento do lead: quantas, o valor e as sem preco.
              cross join lateral (
                select count(*) as comparecimentos,
                       coalesce(sum(x.valor), 0)::bigint as valor_cents,
                       count(*) filter (where x.valor is null) as sem_preco
                  from public.appointment a
                  join public.service_link sl on sl.id = a.service_link_id
                  join public.procedure p2 on p2.id = sl.procedure_id
                  cross join lateral (
                    select case
                             when sl.price_cents is not null then sl.price_cents
                             when sl.covered_by_insurance then null
                             else p2.base_price_cents
                           end as valor
                  ) x
                 where a.clinic_id = p_clinic_id and a.contact_id = c.id
                   and a.status = 'compareceu'
              ) cmp
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= j.de and c.first_contact_at < j.ate
               -- [metricas certas] so o lead de verdade
               and public.contato_e_lead(c)
          ),
          -- [venda pela jornada] inicio
          -- As vendas do periodo (pelo momento da venda), com a campanha do
          -- contato pela mesma regra dos leads. So para quem ve valores (a
          -- RLS de venda_da_jornada tambem so deixa a gestao).
          vendas as (
            select coalesce(an.campaign_id, cr.campaign_id) as meta_campaign_id,
                   nullif(btrim(c.source_campaign), '') as rotulo_texto,
                   v.value_cents
              from public.venda_da_jornada v
              join public.contact c
                on c.id = v.contact_id and c.clinic_id = p_clinic_id
              left join public.meta_anuncio an
                on an.clinic_id = p_clinic_id and an.ad_id = c.source_ad_id
              left join campanha_meta cr
                on cr.campaign_id = c.source_campaign_id
             where pr.ve_reais
               and v.clinic_id = p_clinic_id
               and v.vendido_em >= j.de and v.vendido_em < j.ate
          ),
          vendas_meta as (
            select meta_campaign_id,
                   count(*) as vendas,
                   coalesce(sum(value_cents), 0)::bigint as valor_cents,
                   count(*) filter (where value_cents is null) as sem_valor
              from vendas
             where meta_campaign_id is not null
             group by meta_campaign_id
          ),
          vendas_texto as (
            select rotulo_texto,
                   count(*) as vendas,
                   coalesce(sum(value_cents), 0)::bigint as valor_cents,
                   count(*) filter (where value_cents is null) as sem_valor
              from vendas
             where meta_campaign_id is null and rotulo_texto is not null
             group by rotulo_texto
          ),
          -- [venda pela jornada] fim
          -- Gasto por campanha (BRL) no periodo. Para quem nao ve valor a
          -- RLS ja esvazia; o filtro deixa explicito e poupa a leitura.
          gasto_campanha as (
            select g.campaign_id,
                   sum(g.spend_cents)::bigint as cents,
                   (array_agg(g.campaign_name order by g.dia desc)
                      filter (where g.campaign_name is not null))[1] as nome
              from public.meta_gasto_diario g
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
                   coalesce(sum(l.valor_cents), 0)::bigint as faturamento_cents,
                   -- [metricas certas]
                   coalesce(sum(l.comparecimentos), 0)::bigint as comparecimentos,
                   coalesce(sum(l.sem_preco), 0)::bigint as comparecimentos_sem_preco,
                   -- [venda pela jornada] uma linha de vendas_meta por campanha
                   coalesce(max(vm.vendas), 0)::bigint as vendas,
                   coalesce(max(vm.valor_cents), 0)::bigint as vendas_valor_cents,
                   coalesce(max(vm.sem_valor), 0)::bigint as vendas_sem_valor
              -- A campanha de toda venda ja esta em campanha_meta (o id vem
              -- de meta_anuncio da clinica ou de campanha_meta).
              from (
                select campaign_id from campanha_meta
                union
                select campaign_id from gasto_campanha
              ) k
              left join campanha_meta cm on cm.campaign_id = k.campaign_id
              left join gasto_campanha gc on gc.campaign_id = k.campaign_id
              left join leads l on l.meta_campaign_id = k.campaign_id
              -- [venda pela jornada]
              left join vendas_meta vm on vm.meta_campaign_id = k.campaign_id
             group by k.campaign_id, cm.campaign_name, gc.nome
            having count(l.id) > 0 or coalesce(max(gc.cents), 0) > 0
                   -- [venda pela jornada]
                   or coalesce(max(vm.vendas), 0) > 0
          ),
          por_texto as (
            -- [venda pela jornada] os leads de texto juntos das vendas de
            -- texto: um texto so com venda no periodo tambem vira linha.
            select coalesce(lt.rotulo, vt.rotulo_texto) as rotulo,
                   coalesce(lt.leads, 0) as leads,
                   coalesce(lt.agendaram, 0) as agendaram,
                   coalesce(lt.compareceram, 0) as compareceram,
                   coalesce(lt.faturamento_cents, 0)::bigint as faturamento_cents,
                   coalesce(lt.comparecimentos, 0)::bigint as comparecimentos,
                   coalesce(lt.comparecimentos_sem_preco, 0)::bigint as comparecimentos_sem_preco,
                   coalesce(vt.vendas, 0)::bigint as vendas,
                   coalesce(vt.valor_cents, 0)::bigint as vendas_valor_cents,
                   coalesce(vt.sem_valor, 0)::bigint as vendas_sem_valor
              from (
                select l.rotulo_texto as rotulo,
                       count(*) as leads,
                       count(*) filter (where l.agendou) as agendaram,
                       count(*) filter (where l.compareceu) as compareceram,
                       -- [faturamento]
                       coalesce(sum(l.valor_cents), 0)::bigint as faturamento_cents,
                       -- [metricas certas]
                       coalesce(sum(l.comparecimentos), 0)::bigint as comparecimentos,
                       coalesce(sum(l.sem_preco), 0)::bigint as comparecimentos_sem_preco
                  from leads l
                 where l.meta_campaign_id is null and l.rotulo_texto is not null
                 group by l.rotulo_texto
              ) lt
              full join vendas_texto vt on vt.rotulo_texto = lt.rotulo
          ),
          linhas as (
            select 'meta'::text as tipo,
                   'meta:' || m.campaign_id as chave,
                   m.campaign_id as meta_campaign_id,
                   m.rotulo,
                   m.leads, m.agendaram, m.compareceram,
                   case when pr.ve_reais then m.cents end as investimento_cents,
                   -- [faturamento]
                   case when pr.ve_reais then m.faturamento_cents end as faturamento_cents,
                   -- [metricas certas]
                   m.comparecimentos,
                   case when pr.ve_reais then m.comparecimentos_sem_preco end as comparecimentos_sem_preco,
                   -- [venda pela jornada]
                   case when pr.ve_reais then m.vendas end as vendas,
                   case when pr.ve_reais then m.vendas_valor_cents end as vendas_valor_cents,
                   case when pr.ve_reais then m.vendas_sem_valor end as vendas_sem_valor
              from por_meta m
            union all
            select 'texto', 'texto:' || t.rotulo, null, t.rotulo,
                   t.leads, t.agendaram, t.compareceram, null::bigint,
                   -- [faturamento]
                   case when pr.ve_reais then t.faturamento_cents end,
                   -- [metricas certas]
                   t.comparecimentos,
                   case when pr.ve_reais then t.comparecimentos_sem_preco end,
                   -- [venda pela jornada]
                   case when pr.ve_reais then t.vendas end,
                   case when pr.ve_reais then t.vendas_valor_cents end,
                   case when pr.ve_reais then t.vendas_sem_valor end
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
            -- [venda pela jornada] a tela explica as colunas zeradas
            'tem_etapa_de_venda', case when pr.ve_reais then exists (
              select 1 from public.funnel_stage_def d
               where d.clinic_id = p_clinic_id and d.is_sale
            ) end,
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
                       'faturamento_cents', x.faturamento_cents,
                       -- [metricas certas]
                       'comparecimentos', x.comparecimentos,
                       'comparecimentos_sem_preco', x.comparecimentos_sem_preco,
                       -- [venda pela jornada]
                       'vendas', x.vendas,
                       'valor_das_vendas_cents', x.vendas_valor_cents,
                       'vendas_sem_valor', x.vendas_sem_valor
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
                    from public.meta_gasto_conta_diario gc
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
                -- [venda pela jornada] a linha so com venda (sem lead e sem
                -- gasto) nao e "campanha com investimento sem lead".
                'campanhas_sem_lead', (select count(*) from por_meta m where m.leads = 0 and m.cents > 0),
                'outra_moeda', (
                  exists (
                    select 1 from public.meta_gasto_conta_diario gc
                     where gc.clinic_id = p_clinic_id
                       and gc.currency <> 'BRL'
                       and gc.dia between d.dia_de and d.dia_ate
                  )
                  or exists (
                    select 1 from public.meta_gasto_diario g
                     where g.clinic_id = p_clinic_id
                       and g.currency <> 'BRL'
                       and g.dia between d.dia_de and d.dia_ate
                  )
                )
              )
                from dias d
                left join public.meta_ads_account ma on ma.clinic_id = p_clinic_id
                left join public.meta_gasto_leitura lt on lt.clinic_id = p_clinic_id
            ) end
          ) as corpo
        ) bloco
    )
  end
$function$;

comment on function public.campanhas_do_periodo(uuid, timestamptz, timestamptz, timestamptz) is
  'Resultados, Campanhas e custo por lead: leads (contato_e_lead) por chegada em [p_de, p_ate) casados com a campanha da Meta so por id (source_ad_id -> meta_anuncio, depois source_campaign_id conhecido), linhas meta e texto com comparecimentos e, para a gestao, faturamento, comparecimentos sem preco e, desde 23/11/2026, vendas, valor_das_vendas_cents e vendas_sem_valor (venda_da_jornada pelo momento da venda, na campanha do contato; uma campanha so com venda vira linha) e tem_etapa_de_venda; contagens de leads, de anuncio (o grupo meta de grupo_de_origem) e casados, e o investimento (total da conta e por campanha, BRL, dias civis da clinica). Mesmas contagens em todo papel; valores null fora de admin e gestor; null para o profissional. SECURITY INVOKER.';

notify pgrst, 'reload schema';
