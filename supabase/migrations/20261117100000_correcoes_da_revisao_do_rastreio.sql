-- Correcoes da revisao da frente "substituir o Tintim" (pedido do dono de
-- 17/11/2026: "revise se tudo que foi feito foi feito certo"). Nenhuma tabela
-- nem coluna nova; nenhuma assinatura de funcao muda.
--
-- 1) Rodizio do link: a contagem (entregues) e zerada quando entra ou sai um
--    numero, ou muda o peso. Era vitalicia: numero novo recebia TODOS os
--    cliques ate alcancar os outros.
-- 2) casar_clique_do_site: quem chega com o codigo retoma o clique que estava
--    com outro contato so como provavel; fbclid sozinho vira Redes sociais
--    (decisao do dono de 17/11/2026), trafego pago da Meta so com o numero do
--    anuncio ou UTM de anuncio.
-- 3) situacao_do_rastreio: conta so cliques do site (via = 'site').
-- 4) resumo_dos_links_rastreados: leads e provaveis contam pessoas.
-- 5) campaign_link.codigo_publico: a sessao do usuario nao escolhe nem troca
--    o codigo (so o sorteio do banco). Um gestor podia tomar o codigo de um
--    link excluido de outra clinica.
-- 6) Indices: a poda de 90 dias (com fbclid) e as tres chaves estrangeiras
--    para whatsapp_account.
-- 7) conversoes_para_o_google: prefere o clique com gclid.
-- 8) valor_da_conversao: a mesma regra de preco do faturamento.
--
-- As funcoes foram tiradas da producao (pg_get_functiondef) em 17/11/2026 e
-- so os trechos marcados com [revisao 17/11] mudaram. create or replace
-- mantem donos e grants.
--
-- ROLLBACK (manual): reaplicar as funcoes de 20261005100000
-- (situacao_do_rastreio), 20261116120000 (casar_clique_do_site),
-- 20261116140000 (resumo_dos_links_rastreados), 20261116170000
-- (conversoes_para_o_google) e 20260910150000 (valor_da_conversao); drop dos
-- tres gatilhos e das duas funcoes de gatilho; recriar
-- clique_do_site_ids_a_zerar sem o fbclid; drop dos tres indices novos.

-- ---------------------------------------------------------------------------
-- 1) Rodizio: zera a contagem do link quando a lista de numeros muda
-- ---------------------------------------------------------------------------

create function public.zerar_rodizio_do_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A sessao nao grava entregues (sem grant na coluna): por isso definer.
  -- Todos os numeros do link recomecam do zero e o peso volta a valer ja no
  -- proximo clique.
  update public.campaign_link_numero n
     set entregues = 0
   where n.campaign_link_id = coalesce(new.campaign_link_id, old.campaign_link_id)
     and n.entregues <> 0;
  return null;
end;
$$;

revoke all on function public.zerar_rodizio_do_link() from public, anon, authenticated;

comment on function public.zerar_rodizio_do_link() is
  'Gatilho de campaign_link_numero: zera entregues de todos os numeros do link quando entra ou sai um numero, ou muda o peso (revisao de 17/11/2026).';

create trigger zerar_rodizio_ao_entrar_ou_sair
  after insert or delete on public.campaign_link_numero
  for each row execute function public.zerar_rodizio_do_link();

create trigger zerar_rodizio_ao_mudar_o_peso
  after update of peso on public.campaign_link_numero
  for each row
  when (old.peso is distinct from new.peso)
  execute function public.zerar_rodizio_do_link();

-- ---------------------------------------------------------------------------
-- 2) casar_clique_do_site
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.casar_clique_do_site(p_clinic_id uuid, p_contact_id uuid, p_codigo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_codigo text := upper(btrim(p_codigo));
  v_clique public.clique_do_site%rowtype;
  v_n integer;
  -- [meta e utm] inicio
  v_fonte text;
  v_meio text;
  v_pago boolean;
  v_canal text;
  v_origem text;
  v_plataforma text;
  v_campanha text;
  v_anuncio text;
  v_campanha_google text;
  v_grupo_google text;
  -- [meta e utm] fim
  -- [link] inicio
  v_metodo text := 'clique_site';
  v_tem_sinal boolean;
  -- [link] fim
begin
  if p_clinic_id is null or p_contact_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica e contato são obrigatórios.';
  end if;
  if v_codigo is null or v_codigo !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$' then
    return 'nao_achado';
  end if;

  -- FOR NO KEY UPDATE: nao bloqueia quem so referencia o contato (mensagem).
  perform 1
    from public.contact c
   where c.id = p_contact_id and c.clinic_id = p_clinic_id
     for no key update;
  if not found then
    return 'nao_achado';
  end if;

  select k.* into v_clique
    from public.clique_do_site k
   where k.clinic_id = p_clinic_id and k.codigo = v_codigo
     for update;
  if not found then
    return 'nao_achado';
  end if;
  if v_clique.contact_id is not null then
    if v_clique.contact_id = p_contact_id then
      return 'vinculado';
    end if;
    -- [revisao 17/11] inicio
    -- O clique estava com OUTRO contato so como PROVAVEL (janela de 10
    -- minutos, sem codigo). Quem chega com o CODIGO e o dono de verdade e
    -- retoma o clique, com as UTMs e os identificadores dele. Clique
    -- confirmado de outro contato (mensagem encaminhada) continua sem casar.
    if not v_clique.provavel then
      return 'nao_achado';
    end if;
    -- [revisao 17/11] fim
  end if;
  if v_clique.valido_ate <= now() then
    return 'expirado';
  end if;

  update public.clique_do_site
     set contact_id = p_contact_id,
         casado_em = now(),
         -- [revisao 17/11] casado pelo codigo e confirmado, nunca provavel.
         provavel = false
   where id = v_clique.id;

  -- [meta e utm] inicio
  -- De onde veio o clique, nesta ordem: a origem cadastrada do link; sinal
  -- do Google; fbclid ou numero do anuncio da Meta; so UTMs.
  v_fonte := lower(btrim(coalesce(v_clique.utm_source, '')));
  v_meio := lower(btrim(coalesce(v_clique.utm_medium, '')));
  v_pago := v_meio in (
    'cpc', 'ppc', 'paid', 'paidsocial', 'paid_social', 'paid-social', 'cpm',
    'display', 'ads'
  );
  v_plataforma := case
    when v_fonte in ('ig', 'instagram') then 'Instagram'
    when v_fonte in ('fb', 'facebook') then 'Facebook'
  end;
  -- [link] inicio
  v_tem_sinal := coalesce(
    v_clique.gclid, v_clique.gbraid, v_clique.wbraid, v_clique.gad_source,
    v_clique.google_campaign_id, v_clique.google_adgroup_id, v_clique.fbclid,
    v_clique.meta_ad_id, v_clique.utm_source, v_clique.utm_medium,
    v_clique.utm_campaign, v_clique.utm_content, v_clique.utm_term
  ) is not null;

  if v_clique.campaign_link_id is not null then
    -- A origem do link sempre vence: UTMs e identificadores ficam no clique,
    -- como detalhe e para a conversao. O numero do anuncio da Meta, se veio,
    -- vai para o contato (a campanha chega pela Meta).
    select l.channel, l.origin, l.medium, l.campaign
      into v_canal, v_origem, v_plataforma, v_campanha
      from public.campaign_link l
     where l.id = v_clique.campaign_link_id;
    v_metodo := 'link_token';
    v_anuncio := v_clique.meta_ad_id;
  elsif v_clique.via = 'link' and not v_tem_sinal then
    -- Clique de um link cuja origem foi excluida, sem sinal nenhum: nao ha
    -- de onde tirar a origem. Fica so o vinculo.
    return 'vinculado';
  -- [link] fim
  elsif v_clique.gclid is not null or v_clique.gbraid is not null
     or v_clique.wbraid is not null or v_clique.gad_source is not null
     or v_clique.google_campaign_id is not null
     or v_clique.google_adgroup_id is not null
     or (v_pago and v_fonte in ('google', 'googleads', 'google_ads', 'adwords')
         and v_clique.fbclid is null and v_clique.meta_ad_id is null)
  then
    v_canal := 'trafego_pago';
    v_origem := 'Google';
    v_plataforma := null;
    v_campanha_google := v_clique.google_campaign_id;
    v_grupo_google := v_clique.google_adgroup_id;
  -- [revisao 17/11] Decisao do dono: o fbclid SOZINHO nao prova anuncio (a
  -- Meta o poe tambem em clique de post, de bio e de mensagem). Trafego pago
  -- da Meta so com o numero do anuncio (cz_anuncio) ou com UTM de anuncio.
  elsif v_clique.meta_ad_id is not null
     or (v_pago and (v_clique.fbclid is not null
                     or v_fonte in ('ig', 'instagram', 'fb', 'facebook', 'meta')))
  then
    v_canal := 'trafego_pago';
    v_origem := 'Meta';
    v_anuncio := v_clique.meta_ad_id;
  else
    -- So UTMs. A origem vai em minusculas: nunca e 'Google' nem 'Meta', que
    -- o check do contato reserva para o anuncio.
    v_canal := case
      when v_pago then 'trafego_pago'
      when v_meio = 'organic' then 'busca_organica'
      when v_meio in ('social', 'social-media', 'social_media')
        or v_fonte in (
          'ig', 'instagram', 'fb', 'facebook', 'tiktok', 'youtube',
          'linkedin', 'twitter', 'x', 'threads', 'whatsapp'
        )
        -- [revisao 17/11] fbclid sem anuncio: veio do Facebook ou do Instagram.
        or v_clique.fbclid is not null then 'redes_sociais'
      else 'direto'
    end;
    v_origem := coalesce(
      nullif(v_fonte, ''),
      case when v_clique.fbclid is not null then 'facebook ou instagram' else 'site' end
    );
    v_plataforma := nullif(btrim(v_clique.utm_medium), '');
    v_campanha := nullif(btrim(v_clique.utm_campaign), '');
  end if;
  -- [meta e utm] fim
  -- [link] inicio
  -- A origem do link sumiu entre a leitura do clique e aqui: so o vinculo.
  if v_canal is null then
    return 'vinculado';
  end if;
  -- [link] fim

  -- Origem so em contato sem origem (canal, metodo e campanha em texto
  -- nulos) e sem sinal de anuncio da Meta. A origem e imutavel: na duvida
  -- fica vazia (preenche-se depois), nunca errada.
  update public.contact c
     set source_channel = v_canal,
         source_origin = v_origem,
         source_medium = v_plataforma,
         source_campaign = v_campanha,
         source_method = v_metodo,
         source_captured_at = now(),
         source_google_campaign_id = v_campanha_google,
         source_google_adgroup_id = v_grupo_google,
         source_ad_id = v_anuncio
   where c.id = p_contact_id
     and c.clinic_id = p_clinic_id
     and c.source_channel is null
     and c.source_method is null
     and c.source_campaign is null
     and c.ctwa_clid is null
     and c.source_ad_id is null
     and c.source_adset_id is null
     and c.source_campaign_id is null;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    -- [meta e utm] inicio
    -- Com o numero do anuncio, pede a campanha e o conjunto a Meta (o mesmo
    -- pedido do anuncio de WhatsApp). Melhor esforco: nunca desfaz a origem.
    if v_anuncio is not null then
      begin
        perform public.enfileirar_resolucao_de_anuncios_meta(p_clinic_id, 'ingestao');
      exception when others then
        null;
      end;
    end if;
    -- [meta e utm] fim
    return 'origem_gravada';
  end if;
  return 'vinculado';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) situacao_do_rastreio
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.situacao_do_rastreio(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existe boolean := false;
  v_ativo boolean := false;
  v_trocada timestamptz;
  v_ultimo timestamptz;
  v_cliques integer := 0;
  v_casados integer := 0;
begin
  if p_clinic_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica obrigatória.';
  end if;
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Somente administradores e gestores veem o rastreio do site.';
    end if;
  elsif not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores veem o rastreio do site.';
  end if;

  select true, r.ativo, r.chave_trocada_em, r.ultimo_clique_em
    into v_existe, v_ativo, v_trocada, v_ultimo
    from public.rastreio_do_site r
   where r.clinic_id = p_clinic_id;

  select count(*)::integer,
         (count(*) filter (where k.contact_id is not null))::integer
    into v_cliques, v_casados
    from public.clique_do_site k
   where k.clinic_id = p_clinic_id
     -- [revisao 17/11] So os cliques do SITE: o clique do link rastreado
     -- (via = 'link') inflava o cartao e fazia parecer que o script estava
     -- instalado.
     and k.via = 'site'
     and k.criado_em >= now() - interval '7 days';

  return jsonb_build_object(
    'configurado', coalesce(v_existe, false),
    'ativo', coalesce(v_ativo, false),
    'chave_trocada_em', v_trocada,
    'ultimo_clique_em', v_ultimo,
    'cliques_7_dias', v_cliques,
    'casados_7_dias', v_casados
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) resumo_dos_links_rastreados
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resumo_dos_links_rastreados(p_clinic_id uuid, p_dias integer DEFAULT 30)
 RETURNS TABLE(campaign_link_id uuid, cliques bigint, leads bigint, provaveis bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dias constant integer := least(greatest(coalesce(p_dias, 30), 1), 365);
  v_fuso text;
  v_desde date;
begin
  if p_clinic_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica obrigatória.';
  end if;
  -- Quem le as origens (membro ativo da clinica) le o resumo delas.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Somente a equipe da clínica vê os cliques dos links.';
    end if;
  elsif p_clinic_id not in (select public.user_active_clinic_ids()) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente a equipe da clínica vê os cliques dos links.';
  end if;

  select coalesce(c.timezone, 'America/Fortaleza') into v_fuso
    from public.clinic c
   where c.id = p_clinic_id;
  v_desde := (now() at time zone coalesce(v_fuso, 'America/Fortaleza'))::date - (v_dias - 1);

  return query
    select l.id,
           coalesce((
             select sum(d.cliques)
               from public.clique_do_link_dia d
              where d.campaign_link_id = l.id
                and d.dia >= v_desde
           ), 0)::bigint,
           (
             -- [revisao 17/11] Pessoas, nao cliques: quem toca duas vezes e
             -- uma pessoa so.
             select count(distinct k.contact_id)
               from public.clique_do_site k
              where k.campaign_link_id = l.id
                and k.contact_id is not null
                and not k.provavel
                and k.casado_em >= (v_desde::timestamp at time zone coalesce(v_fuso, 'America/Fortaleza'))
           )::bigint,
           (
             -- [revisao 17/11] Pessoas, nao cliques: quem toca duas vezes e
             -- uma pessoa so.
             select count(distinct k.contact_id)
               from public.clique_do_site k
              where k.campaign_link_id = l.id
                and k.contact_id is not null
                and k.provavel
                and k.casado_em >= (v_desde::timestamp at time zone coalesce(v_fuso, 'America/Fortaleza'))
           )::bigint
      from public.campaign_link l
     where l.clinic_id = p_clinic_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5) codigo_publico: so o sorteio do banco
-- ---------------------------------------------------------------------------

create function public.proteger_codigo_publico_do_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- So a sessao de usuario e travada: o servico (sem auth.uid()) continua
  -- podendo escrever, para manutencao.
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.codigo_publico := public.sortear_codigo(8);
    else
      new.codigo_publico := old.codigo_publico;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.proteger_codigo_publico_do_link() is
  'Gatilho de campaign_link: a sessao de usuario nao escolhe nem troca o codigo_publico (revisao de 17/11/2026).';

create trigger proteger_codigo_publico_ao_criar
  before insert on public.campaign_link
  for each row execute function public.proteger_codigo_publico_do_link();

create trigger proteger_codigo_publico_ao_mudar
  before update of codigo_publico on public.campaign_link
  for each row execute function public.proteger_codigo_publico_do_link();

-- ---------------------------------------------------------------------------
-- 6) Indices
-- ---------------------------------------------------------------------------

-- A poda de 90 dias zera tambem o fbclid (20261116110000); o indice parcial
-- de antes nao o incluia e a poda deixava de usa-lo.
drop index if exists public.clique_do_site_ids_a_zerar;
create index clique_do_site_ids_a_zerar
  on public.clique_do_site (criado_em)
  where contact_id is not null
    and (gclid is not null or gbraid is not null or wbraid is not null
         or fbclid is not null);

-- Chaves estrangeiras para whatsapp_account sem indice proprio: remover um
-- numero varria as tres tabelas.
create index if not exists clique_do_site_do_numero
  on public.clique_do_site (whatsapp_account_id)
  where whatsapp_account_id is not null;
create index if not exists clique_do_link_dia_do_numero
  on public.clique_do_link_dia (whatsapp_account_id);
create index if not exists campaign_link_numero_do_numero
  on public.campaign_link_numero (whatsapp_account_id);

-- ---------------------------------------------------------------------------
-- 7) conversoes_para_o_google
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.conversoes_para_o_google(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_linhas jsonb;
  v_sem_gclid integer;
begin
  if p_clinic_id is null or p_de is null or p_ate is null or p_ate <= p_de then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica e período são obrigatórios.';
  end if;
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Somente administradores e gestores exportam as conversões.';
    end if;
  elsif not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores exportam as conversões.';
  end if;

  with conversoes as (
    select e.event_id, e.stage_chave, e.created_at, e.value_cents, e.currency,
           k.gclid
      from public.conversion_event e
      join lateral (
        select q.gclid
          from public.clique_do_site q
         where q.clinic_id = e.clinic_id
           and q.contact_id = e.contact_id
           and not q.provavel
           and (q.gclid is not null or q.gbraid is not null or q.wbraid is not null)
           and q.criado_em <= e.created_at
         -- [revisao 17/11] O clique COM gclid primeiro: o arquivo so leva
         -- gclid, e um clique mais novo so com gbraid escondia o valido.
         order by (q.gclid is not null) desc, q.criado_em desc
         limit 1
      ) k on true
     where e.clinic_id = p_clinic_id
       and e.created_at >= p_de
       and e.created_at < p_ate
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'gclid', c.gclid,
               'etapa', c.stage_chave,
               'convertido_em', c.created_at,
               'valor_cents', c.value_cents,
               'moeda', c.currency,
               'evento_id', c.event_id
             ) order by c.created_at, c.event_id
           ) filter (where c.gclid is not null),
           '[]'::jsonb
         ),
         (count(*) filter (where c.gclid is null))::integer
    into v_linhas, v_sem_gclid
    from conversoes c;

  return jsonb_build_object('linhas', v_linhas, 'sem_gclid', v_sem_gclid);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8) valor_da_conversao
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.valor_da_conversao(p_clinic_id uuid, p_contact_id uuid, p_value_source text, p_value_cents integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_value_source = 'fixo' then p_value_cents
    when p_value_source = 'service_link' then (
      -- [revisao 17/11] O MESMO preco do faturamento (faturamento_do_periodo
      -- e campanhas_do_periodo): o do vinculo; sem ele, o base do
      -- procedimento; coberto pelo convenio sem preco nao tem valor.
      select case
               when sl.price_cents is not null then sl.price_cents
               when sl.covered_by_insurance then null
               else p.base_price_cents
             end
        from public.appointment a
        join public.service_link sl on sl.id = a.service_link_id
        join public.procedure p on p.id = sl.procedure_id
       where a.clinic_id = p_clinic_id
         and a.contact_id = p_contact_id
         and a.status not in
           ('cancelado_paciente', 'cancelado_clinica', 'faltou')
       order by abs(extract(epoch from (a.starts_at - now())))
       limit 1
    )
    else null
  end;
$function$;
