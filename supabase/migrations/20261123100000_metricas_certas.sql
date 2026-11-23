-- Metricas certas (decisao do dono de 23/11/2026: "metricas certas").
--
-- ROLLBACK (manual, numa transacao, depois de voltar o codigo):
--   1. drop function public.passagens_da_ia_do_periodo(uuid, timestamptz, timestamptz);
--   2. reaplicar, do pg_get_functiondef da producao de 23/11/2026 (o corpo
--      de antes de cada uma esta nas migrations citadas, mais o search_path
--      'public'): funil_do_periodo e serie_diaria_do_periodo
--      (20261117110000), campanhas_do_periodo (20261116160000),
--      anuncios_do_periodo (20261026130000), atendimento_do_periodo
--      (20261104120000), agenda_do_periodo (20261002110000) e
--      ia_tirar_conversa (20261022110000);
--   3. drop function public.contato_e_lead(public.contact) (depois do passo 2,
--      que tira as chamadas);
--   4. drop trigger apagar_rascunho_sem_conversa on public.ai_decision_log e
--      drop function public.apagar_rascunho_da_decisao_sem_conversa();
--   5. as chaves de ai_decision_log de volta: conversation_id com on delete
--      cascade (as linhas com conversation_id nulo, de conversa apagada
--      depois desta migration, saem antes: delete ... where conversation_id
--      is null) e set not null; message_id sem acao (no action).
--   As linhas de ai_decision_log que a varredura gravou ficam (sao fatos).
--
-- O que muda (itens da decisao):
--
-- 1) Lead de verdade. Lead e o contato que NASCEU de uma mensagem do
--    paciente: a ingestao (ingest_inbound_message) cria o contato e, na MESMA
--    transacao, a autorizacao automatica contact_consent source 'conversa'
--    ("Primeira mensagem recebida do contato"), as duas com o mesmo now().
--    Contato importado (criado_por_importacao), paciente novo da Agenda e
--    cadastro manual nao tem essa linha com o mesmo instante: nao sao lead.
--    A regra vive em contato_e_lead(contact), usada por funil, serie,
--    campanhas (e o custo por lead) e anuncios. Sem coluna nova, sem ALTER
--    em contact nem em message, sem mexer na ingestao; resiste a conversa
--    apagada (a autorizacao fica). Producao em 23/11/2026: 666 contatos
--    nasceram de mensagem (232 deles ja sem conversa), 13 nao (todos da
--    Agenda), 0 importados.
-- 2) "Agendou" igual a etapa Agendou da Jornada (20261022100000): consulta
--    pendente ou recusada nao conta (coalesce(approval_status,'aprovado') =
--    'aprovado'; o CHECK so aceita pendente, aprovado e recusado).
-- 3) Remarcacao pela IA conta uma vez: a consulta nova (remarcacao_de nao
--    nulo) nao e agendamento novo (nem nos agendamentos pela IA); a antiga,
--    trocada por uma remarcacao aprovada (que a cancela), sai da agenda do
--    periodo, entao nao e cancelamento.
-- 4) Custo por lead da Meta: o divisor (leads_de_anuncio de
--    campanhas_do_periodo) passa a ser o grupo "Meta Ads" do painel
--    (grupo_de_origem = 'meta').
-- 5) passagens_da_ia_do_periodo: por que a conversa foi para a equipe, por
--    motivo (escalation_reason) e camada derivada. A varredura de 3 minutos
--    sem resposta (motor_manutencao -> ia_tirar_conversa 'sem_resposta')
--    passa a gravar a linha em ai_decision_log, nos CHECKs de hoje:
--    escalation_reason 'falha_tecnica', desfecho 'falhou', motivo_da_falha
--    'prazo' (nenhum valor novo de CHECK: os espelhos do agente ficam como
--    estao).
-- 6) ai_decision_log.conversation_id: on delete set null (antes cascade) e
--    nulo permitido; clinic_id continua em cascata. Dependia da cascata:
--    message_id (sem acao: apagar a conversa apagaria a mensagem e a decisao
--    ficaria apontando para ela) passa a set null; o rascunho barrado
--    (ai_rascunho_bloqueado, texto) saia junto e continua saindo, pelo
--    gatilho apagar_rascunho_sem_conversa.
-- 8) campanhas_do_periodo: cada linha ganha comparecimentos (consultas com
--    comparecimento dos leads da linha) e comparecimentos_sem_preco (so para
--    quem ve valores).
--
-- Todas as funcoes foram tiradas da producao (pg_get_functiondef) em
-- 23/11/2026; os trechos novos estao marcados com [metricas certas]. Nenhuma
-- assinatura muda (create or replace mantem os grants); o search_path passa a
-- vazio, com os nomes qualificados. Continuam security invoker (a RLS de
-- quem chama decide) e nulas para o profissional.
--
-- TRAVAS: lock_timeout de 3 s. Os create or replace so tocam o catalogo. O
-- ALTER de ai_decision_log (no fim, para segurar menos) troca as duas chaves
-- estrangeiras: trava ai_decision_log, conversation e message ate o commit.
-- A tabela tem poucas linhas; aplicar em horario calmo.

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) O lead de verdade
-- ---------------------------------------------------------------------------

create function public.contato_e_lead(p_contato public.contact)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Nasceu de uma mensagem do paciente: a autorizacao 'conversa' gravada pela
  -- ingestao na mesma transacao que criou o contato (o mesmo now()). Uma
  -- autorizacao 'conversa' registrada depois pela equipe tem outro instante.
  select not p_contato.criado_por_importacao
     and exists (
       select 1
         from public.contact_consent k
        where k.contact_id = p_contato.id
          and k.channel = 'whatsapp'
          and k.source = 'conversa'
          and k.created_at = p_contato.created_at
     )
$$;

revoke all on function public.contato_e_lead(public.contact) from public, anon;
grant execute on function public.contato_e_lead(public.contact) to authenticated, service_role;

comment on function public.contato_e_lead(public.contact) is
  'Metricas certas (23/11/2026): o contato e lead quando nasceu de uma mensagem do paciente (a autorizacao contact_consent source conversa da ingestao, com o mesmo created_at do contato) e nao foi importado. Paciente novo da Agenda e cadastro manual nao sao lead. Usada pelas funcoes de Resultados. Security invoker (RLS de contact_consent).';

-- ---------------------------------------------------------------------------
-- 2) funil_do_periodo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.funil_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone, p_grupo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
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
                     select 1 from public.appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                        -- [metricas certas] Agendou da Jornada: sem a pendente e a recusada
                        and coalesce(a.approval_status, 'aprovado') = 'aprovado'
                   ) as agendou,
                   exists (
                     select 1 from public.appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                        and a.status = 'compareceu'
                   ) as compareceu
              from public.contact c
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= j.de and c.first_contact_at < j.ate
               -- [metricas certas] so o lead de verdade
               and public.contato_e_lead(c)
               -- [painel por origem] o filtro da tela (nulo: todas as origens)
               and (p_grupo is null or public.grupo_de_origem(c.source_channel, c.source_origin, c.ctwa_clid, c.source_ad_id, c.source_campaign_id, c.source_google_campaign_id) = p_grupo)
          )
          select jsonb_build_object(
            'leads', (select count(*) from leads),
            'agendamentos_criados', (
              select count(*) from public.appointment a
               where a.clinic_id = p_clinic_id
                 and a.created_at >= j.de and a.created_at < j.ate
                 -- [metricas certas] Agendou da Jornada, e a remarcacao nao e agendamento novo
                 and coalesce(a.approval_status, 'aprovado') = 'aprovado'
                 and a.remarcacao_de is null
                 -- [painel por origem] a consulta entra pelo grupo do contato dela
                 and (p_grupo is null or exists (
                   select 1 from public.contact c2
                    where c2.id = a.contact_id and c2.clinic_id = p_clinic_id
                      and public.grupo_de_origem(c2.source_channel, c2.source_origin, c2.ctwa_clid, c2.source_ad_id, c2.source_campaign_id, c2.source_google_campaign_id) = p_grupo
                 ))
            ),
            'comparecimentos', (
              select count(*) from public.appointment a
               where a.clinic_id = p_clinic_id and a.status = 'compareceu'
                 and a.starts_at >= j.de and a.starts_at < j.ate
                 -- [painel por origem] a consulta entra pelo grupo do contato dela
                 and (p_grupo is null or exists (
                   select 1 from public.contact c2
                    where c2.id = a.contact_id and c2.clinic_id = p_clinic_id
                      and public.grupo_de_origem(c2.source_channel, c2.source_origin, c2.ctwa_clid, c2.source_ad_id, c2.source_campaign_id, c2.source_google_campaign_id) = p_grupo
                 ))
            ),
            'faltas', (
              select count(*) from public.appointment a
               where a.clinic_id = p_clinic_id and a.status = 'faltou'
                 and a.starts_at >= j.de and a.starts_at < j.ate
                 -- [painel por origem] a consulta entra pelo grupo do contato dela
                 and (p_grupo is null or exists (
                   select 1 from public.contact c2
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
                    from public.contact c
                   where c.clinic_id = p_clinic_id
                     and c.first_contact_at >= j.de and c.first_contact_at < j.ate
                     -- [metricas certas] so o lead de verdade
                     and public.contato_e_lead(c)
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

comment on function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz, text) is
  'Resultados: leads, agendamentos, comparecimentos, faltas, coorte, por_canal e por_campanha do periodo (e do anterior). Lead: contato_e_lead (23/11/2026). Agendamento: sem a consulta pendente, a recusada e a nova da remarcacao. p_grupo (meta, google, outras, nao_rastreada) filtra pelo grupo de origem do contato; nulo, todas as origens. por_grupo traz os leads de cada grupo sem o filtro. Security invoker (RLS).';

-- ---------------------------------------------------------------------------
-- 3) serie_diaria_do_periodo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.serie_diaria_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_grupo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with fuso as (
        select coalesce(
                 (select c.timezone from public.clinic c where c.id = p_clinic_id),
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
          from public.contact c
         cross join fuso f
         where c.clinic_id = p_clinic_id
           and c.first_contact_at >= p_de and c.first_contact_at < p_ate
           -- [metricas certas] so o lead de verdade
           and public.contato_e_lead(c)
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
              from public.contact c
             cross join fuso f
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= p_de and c.first_contact_at < p_ate
               -- [metricas certas] so o lead de verdade
               and public.contato_e_lead(c)
          ) t
         group by 1
      ),
      g as (
        select (a.created_at at time zone f.tz)::date as dia, count(*) as n
          from public.appointment a
         cross join fuso f
         where a.clinic_id = p_clinic_id
           and a.created_at >= p_de and a.created_at < p_ate
           -- [metricas certas] Agendou da Jornada, e a remarcacao nao e agendamento novo
           and coalesce(a.approval_status, 'aprovado') = 'aprovado'
           and a.remarcacao_de is null
           -- [painel por origem] a consulta entra pelo grupo do contato dela
           and (p_grupo is null or exists (
             select 1 from public.contact c2
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

comment on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz, text) is
  'Resultados, por dia civil da clinica em [p_de, p_ate): leads (contato_e_lead, por first_contact_at) e consultas agendadas (por created_at, sem a pendente, a recusada e a nova da remarcacao), com p_grupo filtrando pelo grupo de origem do contato (nulo: todas), e por_grupo com os leads do dia em cada grupo, sem o filtro. Security invoker (RLS).';

-- ---------------------------------------------------------------------------
-- 4) campanhas_do_periodo
-- ---------------------------------------------------------------------------

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
                   coalesce(sum(l.sem_preco), 0)::bigint as comparecimentos_sem_preco
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
                   coalesce(sum(l.valor_cents), 0)::bigint as faturamento_cents,
                   -- [metricas certas]
                   coalesce(sum(l.comparecimentos), 0)::bigint as comparecimentos,
                   coalesce(sum(l.sem_preco), 0)::bigint as comparecimentos_sem_preco
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
                   case when pr.ve_reais then m.faturamento_cents end as faturamento_cents,
                   -- [metricas certas]
                   m.comparecimentos,
                   case when pr.ve_reais then m.comparecimentos_sem_preco end as comparecimentos_sem_preco
              from por_meta m
            union all
            select 'texto', 'texto:' || t.rotulo, null, t.rotulo,
                   t.leads, t.agendaram, t.compareceram, null::bigint,
                   -- [faturamento]
                   case when pr.ve_reais then t.faturamento_cents end,
                   -- [metricas certas]
                   t.comparecimentos,
                   case when pr.ve_reais then t.comparecimentos_sem_preco end
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
                       'faturamento_cents', x.faturamento_cents,
                       -- [metricas certas]
                       'comparecimentos', x.comparecimentos,
                       'comparecimentos_sem_preco', x.comparecimentos_sem_preco
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
                'campanhas_sem_lead', (select count(*) from por_meta m where m.leads = 0),
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
  'Resultados, Campanhas e custo por lead: leads (contato_e_lead) por chegada em [p_de, p_ate) casados com a campanha da Meta so por id (source_ad_id -> meta_anuncio, depois source_campaign_id conhecido), linhas meta e texto com comparecimentos e, para a gestao, faturamento e comparecimentos sem preco; contagens de leads, de anuncio (o grupo meta de grupo_de_origem, desde 23/11/2026) e casados, e o investimento (total da conta e por campanha, BRL, dias civis da clinica). Mesmas contagens em todo papel; valores null fora de admin e gestor; null para o profissional. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 5) anuncios_do_periodo
-- ---------------------------------------------------------------------------

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
                    -- [metricas certas] Agendou da Jornada: sem a pendente e a recusada
                    and coalesce(a.approval_status, 'aprovado') = 'aprovado'
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
            select btrim(c.source_ad_id, E'\u0009\u000a\u000b\u000c\u000d                  　﻿') as id,
                   btrim(c.source_medium, E'\u0009\u000a\u000b\u000c\u000d                  　﻿') as plataforma
          ) aparado
         where c.clinic_id = p_clinic_id
           and c.first_contact_at >= p_de and c.first_contact_at < p_ate
           -- [metricas certas] so o lead de verdade
           and public.contato_e_lead(c)
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
$function$;

comment on function public.anuncios_do_periodo(uuid, timestamptz, timestamptz) is
  'Leads do periodo (contato_e_lead, pela chegada) por anuncio (o id aparado como no JavaScript), com o titulo, a descricao e o link guardados (anuncio_do_whatsapp), o nome na Meta e os leads por plataforma (contact.source_medium aparado como no JavaScript, vazio vira nulo; desde 20261026130000_anuncios_com_plataforma.sql, com o formato exato no comentario dela), mais os de anuncio sem id (tambem por plataforma) e os sem anuncio da Meta. Agendou: sem a consulta pendente e a recusada (23/11/2026). SECURITY INVOKER; nulo para o profissional.';

-- ---------------------------------------------------------------------------
-- 6) atendimento_do_periodo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atendimento_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
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
          with candidatas as (
            select conversation_id, min(created_at) as entrada_em
              from public.message
             where clinic_id = p_clinic_id and direction = 'entrada'
               and created_at >= j.de and created_at < j.ate
             group by 1
          ), elegiveis as (
            -- Garante que e a primeira entrada DA CONVERSA, nao so da janela.
            select c.* from candidatas c
             where not exists (
                     select 1 from public.message ant
                      where ant.conversation_id = c.conversation_id
                        and ant.direction = 'entrada'
                        and ant.created_at < c.entrada_em
                   )
          ), medidas as (
            select e.entrada_em,
                   (select min(m.created_at) from public.message m
                     where m.conversation_id = e.conversation_id
                       and m.direction = 'saida' and m.author = 'usuario'
                       and not m.is_internal_note
                       and m.created_at > e.entrada_em
                       -- [mensagem agendada] inicio
                       and not exists (
                         select 1 from public.mensagem_agendada ma
                          where ma.message_id = m.id
                       )
                       -- [mensagem agendada] fim
                   ) as resposta_em
              from elegiveis e
          )
          -- [desempenho do agente] inicio
          -- A primeira resposta da IA, sobre as mesmas conversas de medidas.
          , medidas_da_ia as (
            select e.entrada_em,
                   (select min(m.created_at) from public.message m
                     where m.conversation_id = e.conversation_id
                       and m.direction = 'saida' and m.author = 'ia'
                       and not m.is_internal_note
                       and m.delivery_status in ('enviada', 'entregue', 'lida')
                       and m.created_at > e.entrada_em
                   ) as resposta_em
              from elegiveis e
          ), saidas_da_janela as (
            -- Resposta da IA so conta com recibo de que saiu (os mesmos de
            -- RECIBOS_DE_ENVIADA, lib/agente/whatsapp.ts). A que falhou ou
            -- ficou em 'enviando' passou para a equipe SEM escalation_reason
            -- (passarSemFraseEFechar): a conversa nao foi resolvida pela IA.
            select m.conversation_id,
                   count(*) filter (where m.author = 'ia'
                     and m.delivery_status in ('enviada', 'entregue', 'lida')) as da_ia_que_sairam,
                   count(*) filter (where m.author = 'ia'
                     and m.delivery_status in ('enviando', 'falhou')) as da_ia_sem_recibo,
                   count(*) filter (where m.author = 'usuario') as da_equipe
              from public.message m
             where m.clinic_id = p_clinic_id
               and m.created_at >= j.de and m.created_at < j.ate
               and m.direction = 'saida' and not m.is_internal_note
               and m.author in ('ia', 'usuario')
             group by 1
          ), transferidas as (
            -- [metricas certas] a decisao de conversa ja apagada (conversation_id
            -- nulo desde 23/11/2026) conta sozinha, nao num grupo nulo so.
            select coalesce(d.conversation_id, d.id) as conversation_id,
                   bool_or(d.escalation_reason = 'insatisfacao') as por_insatisfacao
              from public.ai_decision_log d
             where d.clinic_id = p_clinic_id
               and d.created_at >= j.de and d.created_at < j.ate
               and d.escalation_reason is not null
             group by 1
          )
          -- [desempenho do agente] fim
          select jsonb_build_object(
            'conversas_iniciadas', (
              select count(*) from public.conversation cv
               where cv.clinic_id = p_clinic_id
                 and cv.created_at >= j.de and cv.created_at < j.ate
            ),
            'primeira_resposta', (
              select jsonb_build_object(
                'conversas', count(*),
                'respondidas', count(resposta_em),
                'mediana_segundos', round(percentile_cont(0.5) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric),
                'p90_segundos', round(percentile_cont(0.9) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric)
              ) from medidas
            ),
            'mensagens', (
              select jsonb_build_object(
                'por_autor', coalesce((
                  select jsonb_object_agg(t.author, t.n)
                    from (
                      select author, count(*) as n from public.message
                       where clinic_id = p_clinic_id
                         and created_at >= j.de and created_at < j.ate
                         and not is_internal_note
                       group by 1
                    ) t
                ), '{}'::jsonb),
                'entrada', count(*) filter (where direction = 'entrada'),
                'saida', count(*) filter (where direction = 'saida' and not is_internal_note),
                'notas_internas', count(*) filter (where is_internal_note)
              )
                from public.message
               where clinic_id = p_clinic_id
                 and created_at >= j.de and created_at < j.ate
            )
            -- [desempenho do agente] inicio
            , 'agente', jsonb_build_object(
              'atendidas', (
                select count(*) from saidas_da_janela s where s.da_ia_que_sairam > 0
              ),
              'resolvidas_sem_humano', (
                select count(*) from saidas_da_janela s
                 where s.da_ia_que_sairam > 0
                   and s.da_ia_sem_recibo = 0
                   and s.da_equipe = 0
                   and not exists (
                     select 1 from transferidas t
                      where t.conversation_id = s.conversation_id
                   )
              ),
              'transferidas', (select count(*) from transferidas),
              'insatisfacao', (select count(*) from transferidas t where t.por_insatisfacao),
              'primeira_resposta_mediana_segundos', (
                select round(percentile_cont(0.5) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric)
                  from medidas_da_ia
              ),
              'agendamentos', (
                select count(*) from public.appointment a
                 where a.clinic_id = p_clinic_id
                   and a.created_by = 'ia'
                   and a.created_at >= j.de and a.created_at < j.ate
                   -- [metricas certas] Agendou da Jornada (sem a pendente e a
                   -- recusada; nulo e o fluxo sem aprovacao), e a remarcacao
                   -- nao soma: a consulta ja contou quando foi marcada.
                   and coalesce(a.approval_status, 'aprovado') = 'aprovado'
                   and a.remarcacao_de is null
              )
            )
            -- [desempenho do agente] fim
          ) as corpo
        ) bloco
    )
  end
$function$;

-- ---------------------------------------------------------------------------
-- 7) agenda_do_periodo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agenda_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone, p_professional_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional'])
         and (p_professional_id is null
              or p_professional_id is distinct from public.user_professional_id(p_clinic_id))
      then null::jsonb
    else (
      with janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
             || jsonb_build_object('pivo', (
                  select case when s.min_sent is null then null
                    else jsonb_build_object(
                      'primeira_regua_em', s.min_sent,
                      'antes', (
                        select jsonb_build_object(
                          'com_desfecho', count(*) filter (where a.status in ('compareceu', 'faltou')),
                          'faltas', count(*) filter (where a.status = 'faltou')
                        ) from public.appointment a
                         where a.clinic_id = p_clinic_id and a.starts_at < s.min_sent
                           and (p_professional_id is null or a.professional_id = p_professional_id)
                      ),
                      'depois', (
                        select jsonb_build_object(
                          'com_desfecho', count(*) filter (where a.status in ('compareceu', 'faltou')),
                          'faltas', count(*) filter (where a.status = 'faltou')
                        ) from public.appointment a
                         where a.clinic_id = p_clinic_id and a.starts_at >= s.min_sent
                           and (p_professional_id is null or a.professional_id = p_professional_id)
                      )
                    )
                  end
                  from (
                    select min(sent_at) as min_sent from public.cadence_run
                     where clinic_id = p_clinic_id and sent_at is not null
                  ) s
                ))
        from janelas j
        cross join lateral (
          with consultas as (
            select a.id, a.status, a.professional_id, a.service_link_id,
                   a.contact_id, a.starts_at
              from public.appointment a
             where a.clinic_id = p_clinic_id
               and a.starts_at >= j.de and a.starts_at < j.ate
               and (p_professional_id is null or a.professional_id = p_professional_id)
               -- [metricas certas] so a consulta da agenda (a pendente e a
               -- recusada nao sao), e a antiga trocada por uma remarcacao
               -- aprovada sai: a remarcacao conta uma vez, pela nova, e a
               -- antiga nao vira cancelamento.
               and coalesce(a.approval_status, 'aprovado') = 'aprovado'
               and not exists (
                 select 1 from public.appointment n
                  where n.remarcacao_de = a.id
                    and n.approval_status = 'aprovado'
               )
          )
          select jsonb_build_object(
            'total', (select count(*) from consultas),
            'criados', (
              select count(*) from public.appointment a
               where a.clinic_id = p_clinic_id
                 and a.created_at >= j.de and a.created_at < j.ate
                 and (p_professional_id is null or a.professional_id = p_professional_id)
                 -- [metricas certas] Agendou da Jornada, e a remarcacao nao e agendamento novo
                 and coalesce(a.approval_status, 'aprovado') = 'aprovado'
                 and a.remarcacao_de is null
            ),
            'por_status', (
              select coalesce(jsonb_object_agg(t.status, t.n), '{}'::jsonb)
                from (select status, count(*) as n from consultas group by 1) t
            ),
            'confirmadas_alguma_vez', (
              select count(*) from consultas a
               where a.status in ('confirmado_paciente', 'confirmado_recepcao')
                  or exists (
                       select 1 from public.appointment_status_history h
                        where h.appointment_id = a.id
                          and h.status in ('confirmado_paciente', 'confirmado_recepcao')
                     )
            ),
            'por_profissional', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'professional_id', t.pid, 'nome', t.nome, 'total', t.n,
                       'compareceu', t.comp, 'faltou', t.falt, 'cancelados', t.canc
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select a.professional_id as pid, p.name as nome, count(*) as n,
                         count(*) filter (where a.status = 'compareceu') as comp,
                         count(*) filter (where a.status = 'faltou') as falt,
                         count(*) filter (where a.status in ('cancelado_paciente', 'cancelado_clinica')) as canc
                    from consultas a
                    join public.professional p on p.id = a.professional_id
                   group by 1, 2
                ) t
            ),
            'por_procedimento', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'procedure_id', t.prid, 'nome', t.nome, 'total', t.n,
                       'compareceu', t.comp, 'faltou', t.falt
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select pr.id as prid, pr.name as nome, count(*) as n,
                         count(*) filter (where a.status = 'compareceu') as comp,
                         count(*) filter (where a.status = 'faltou') as falt
                    from consultas a
                    join public.service_link sl on sl.id = a.service_link_id
                    join public.procedure pr on pr.id = sl.procedure_id
                   group by 1, 2
                ) t
            ),
            'recuperadas', (
              select jsonb_build_object(
                'total', count(*),
                -- Fase 3 (02/10): valor em reais so para admin e gestor;
                -- service_role (auth.uid() nulo) passa.
                'receita_cents', case
                  when auth.uid() is null
                       or public.user_has_role(p_clinic_id, array['admin', 'gestor'])
                    then coalesce(sum(sl.price_cents), 0)
                end,
                'sem_preco', count(*) filter (where sl.price_cents is null)
              )
                from public.waitlist_offer o
                left join public.appointment a2 on a2.id = o.appointment_id
                left join public.service_link sl on sl.id = a2.service_link_id
               where o.clinic_id = p_clinic_id and o.status = 'preenchida'
                 and o.slot_starts_at >= j.de and o.slot_starts_at < j.ate
                 and (p_professional_id is null or o.professional_id = p_professional_id)
            ),
            'remarcadas_apos_falta', (
              select jsonb_build_object(
                'faltas', count(*),
                'remarcadas', count(*) filter (where exists (
                  select 1 from public.appointment n
                   where n.clinic_id = p_clinic_id
                     and n.contact_id = f.contact_id
                     and n.id <> f.id
                     and n.created_at > f.starts_at
                     and n.created_at < f.starts_at + interval '30 days'
                     and n.status not in ('cancelado_paciente', 'cancelado_clinica')
                     -- [metricas certas] Agendou da Jornada: sem a pendente e a recusada
                     and coalesce(n.approval_status, 'aprovado') = 'aprovado'
                ))
              ) from consultas f where f.status = 'faltou'
            )
          ) as corpo
        ) bloco
    )
  end
$function$;

comment on function public.agenda_do_periodo(uuid, timestamptz, timestamptz, timestamptz, uuid) is
  'Agenda por periodo (Resultados e Inicio): totais, status, confirmadas alguma vez, por profissional e procedimento, recuperadas pela lista de espera e remarcadas apos falta, mais o pivo da primeira regua. Desde 23/11/2026: sem a consulta pendente e a recusada; a antiga trocada por remarcacao aprovada sai (nao e cancelamento) e a nova nao conta em criados. recuperadas.receita_cents e null para quem nao e admin nem gestor (Fase 3). null para o profissional sem o proprio recorte. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 8) Por que a conversa foi para a equipe
-- ---------------------------------------------------------------------------

create function public.passagens_da_ia_do_periodo(
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
      select jsonb_build_object(
        'total', coalesce(sum(t.n), 0),
        'por_motivo', coalesce(jsonb_agg(jsonb_build_object(
          'camada', t.camada,
          'motivo', t.motivo,
          'passagens', t.n
        ) order by t.n desc, t.camada, t.motivo), '[]'::jsonb)
      )
        from (
          -- Cada linha de ai_decision_log com motivo e uma passagem. A
          -- camada sai das colunas, nesta ordem: o portao de entrada
          -- (o classificador ou a regra antes do modelo), o filtro de
          -- conformidade, a falha tecnica e, sem nenhuma, o agente.
          select case
                   when d.gatilho_entrada is not null then 'portao'
                   when d.compliance_blocked then 'filtro'
                   when d.motivo_da_falha is not null then 'falha'
                   else 'agente'
                 end as camada,
                 d.escalation_reason as motivo,
                 count(*) as n
            from public.ai_decision_log d
           where d.clinic_id = p_clinic_id
             and d.created_at >= p_de and d.created_at < p_ate
             and d.escalation_reason is not null
           group by 1, 2
        ) t
    )
  end
$$;

revoke all on function public.passagens_da_ia_do_periodo(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.passagens_da_ia_do_periodo(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.passagens_da_ia_do_periodo(uuid, timestamptz, timestamptz) is
  'Resultados, aba Agente de IA (23/11/2026): as passagens da IA para a equipe em [p_de, p_ate), por motivo (escalation_reason) e camada (portao quando ha gatilho_entrada, filtro quando compliance_blocked, falha quando motivo_da_falha, senao agente): {total, por_motivo: [{camada, motivo, passagens}]}. Conta linhas de ai_decision_log (uma conversa pode passar mais de uma vez). Security invoker (RLS de ai_decision_log); null para o profissional.';

-- ---------------------------------------------------------------------------
-- 9) A varredura de 3 minutos grava a decisao
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ia_tirar_conversa(p_conversation_id uuid, p_motivo text, p_aguardando boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_corpo text := public.rotulo_do_motivo_da_ia(p_motivo);
  v_clinica uuid;
begin
  if v_corpo is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = coalesce(p_aguardando, c.awaiting_reply)
   where c.id = p_conversation_id
     and c.status = 'ia_atendendo'
  returning c.clinic_id into v_clinica;
  if v_clinica is null then
    return false;
  end if;

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'conversa_fora_da_ia'
   where j.id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.status = 'pendente'
        and q.payload ->> 'conversation_id' = p_conversation_id::text
        for update skip locked
   );

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, p_conversation_id, 'saida', 'sistema', 'evento', v_corpo,
    false, 0
  );
  -- [metricas certas] inicio
  -- A varredura de 3 minutos sem resposta (motor_manutencao, o unico que
  -- tira com 'sem_resposta') entra na conta de "Por que foi para a equipe":
  -- a linha da decisao, sem job, com os valores que os CHECKs ja aceitam
  -- (falha tecnica por prazo). Nenhum texto.
  if p_motivo = 'sem_resposta' then
    insert into public.ai_decision_log (
      clinic_id, conversation_id, escalation_reason, desfecho, motivo_da_falha
    ) values (
      v_clinica, p_conversation_id, 'falha_tecnica', 'falhou', 'prazo'
    );
  end if;
  -- [metricas certas] fim
  -- [onda 2: horario da ia] inicio
  -- Onda 2, item 7: a passagem do executor por fora do horario (o job que
  -- venceu na virada do expediente) guarda a conversa para a retomada no
  -- horario do assistente, desde a janela que ela ja tinha (a mensagem que
  -- chegou na virada continua pendente na retomada). Sem numero ou com
  -- telefone fora do formato, nada e guardado (fica com a equipe).
  if p_motivo = 'fora_do_horario' then
    insert into public.ia_conversa_fora_do_horario as f (
      conversation_id, clinic_id, contact_id, phone_key,
      whatsapp_account_id, desde, origem, criada_em
    )
    select c.id, c.clinic_id, c.contact_id, k.phone_key, c.whatsapp_account_id,
           coalesce((select w.desde
                       from public.ia_janela_da_conversa w
                      where w.conversation_id = c.id), now()),
           'turno', now()
      from public.conversation c
      join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
     where c.id = p_conversation_id
       and c.whatsapp_account_id is not null
       and k.phone_key ~ '^\+[1-9][0-9]{7,14}$'
    on conflict (conversation_id) do update
       set clinic_id = excluded.clinic_id,
           contact_id = excluded.contact_id,
           phone_key = excluded.phone_key,
           whatsapp_account_id = excluded.whatsapp_account_id,
           desde = excluded.desde,
           origem = excluded.origem,
           criada_em = excluded.criada_em;
  end if;
  -- [onda 2: horario da ia] fim
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10) A trilha da IA nao some com a conversa
-- ---------------------------------------------------------------------------

-- O rascunho barrado (texto escrito para o paciente) saia com a conversa
-- pela cascata decisao -> rascunho. A decisao agora fica; o rascunho
-- continua saindo junto com a conversa.
create function public.apagar_rascunho_da_decisao_sem_conversa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_rascunho_bloqueado r where r.decision_id = old.id;
  return null;
end;
$$;

revoke all on function public.apagar_rascunho_da_decisao_sem_conversa() from public, anon, authenticated;

comment on function public.apagar_rascunho_da_decisao_sem_conversa() is
  'Gatilho de ai_decision_log (23/11/2026): quando a conversa da decisao e apagada (conversation_id vira nulo pela chave estrangeira), o rascunho barrado dela (ai_rascunho_bloqueado) sai, como saia pela cascata. Ninguem executa direto.';

create trigger apagar_rascunho_sem_conversa
  after update of conversation_id on public.ai_decision_log
  for each row
  when (old.conversation_id is not null and new.conversation_id is null)
  execute function public.apagar_rascunho_da_decisao_sem_conversa();

-- No fim: as travas das chaves estrangeiras ficam o menor tempo possivel.
alter table public.ai_decision_log
  alter column conversation_id drop not null,
  drop constraint ai_decision_log_conversation_id_fkey,
  add constraint ai_decision_log_conversation_id_fkey
    foreign key (conversation_id) references public.conversation (id) on delete set null,
  drop constraint ai_decision_log_message_id_fkey,
  add constraint ai_decision_log_message_id_fkey
    foreign key (message_id) references public.message (id) on delete set null;

comment on column public.ai_decision_log.conversation_id is
  'A conversa da decisao. Nula depois que a conversa e apagada (on delete set null desde 23/11/2026): a trilha da IA e as metricas ficam; o rascunho barrado sai (apagar_rascunho_sem_conversa).';

notify pgrst, 'reload schema';
