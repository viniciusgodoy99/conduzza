-- ---------------------------------------------------------------------------
-- Link rastreado da origem (etapa 3a do plano de 16/11/2026, "Rastreio
-- completo"): o link da bio com endereco proprio, como no Q5
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026: cada origem cadastrada (campaign_link) ganha
-- um endereco do Conduzza, <sistema>/l/<codigo publico>, que grava o clique
-- (UTMs e identificadores do Google e da Meta que vierem na URL), escolhe o
-- numero de WhatsApp da clinica e redireciona para o wa.me com a mensagem
-- pronta e um codigo POR CLIQUE (" [#K7Q2MX]", o mesmo do clique do site).
-- Quando a mensagem chega, casar_clique_do_site da ao contato sem origem a
-- origem DA ORIGEM CADASTRADA (canal, origem, meio e campanha do
-- campaign_link, metodo link_token). O link direto do wa.me, com o codigo
-- fixo, continua valendo.
--
-- Nesta entrega (3a) o link usa um numero so: o principal da clinica, ou
-- outro conectado se o principal caiu. O rodizio entre numeros e a 3b.
--
-- Sem IP, sem navegador e sem pagina: o clique guarda o que ja guardava.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. O codigo antigo nao
-- conhece as colunas novas e segue igual. O codigo novo, sem ela, mostra o
-- link direto de sempre (a leitura de codigo_publico falha e a aba cai no
-- estado de erro), entao nao publicar o codigo antes.
--
-- TRAVAS: campaign_link esta vazia em producao (16/11/2026), clique_do_site
-- tambem. lock_timeout de 4s.
--
-- ROLLBACK (manual): reaplicar casar_clique_do_site de 20261116110000; drop
-- de registrar_clique_do_link, resumo_dos_links_rastreados e sortear_codigo;
-- drop de clique_do_link_dia; recriar clique_do_site_tem_sinal sem "via" e
-- dropar via, campaign_link_id e whatsapp_account_id de clique_do_site e
-- codigo_publico de campaign_link. Contato que ganhou origem pelo link
-- continua com ela (a origem e imutavel).

set local lock_timeout = '4s';

-- ---------------------------------------------------------------------------
-- 1) Sorteio de codigo curto (o alfabeto de lib/domain/attribution.ts)
-- ---------------------------------------------------------------------------

create function public.sortear_codigo(p_tamanho integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + get_byte(s.b, i) % 31, 1),
           '' order by i
         )
    from (select decode(md5(gen_random_uuid()::text), 'hex') as b) s,
         generate_series(0, least(greatest(p_tamanho, 1), 16) - 1) as i
$$;

-- E o default de campaign_link.codigo_publico: quem insere a origem pela
-- sessao (administrador e gestor) precisa executar.
revoke all on function public.sortear_codigo(integer) from public, anon;
grant execute on function public.sortear_codigo(integer) to authenticated, service_role;

comment on function public.sortear_codigo(integer) is
  'Codigo curto sorteado, em minusculas, no alfabeto sem 0, 1, i, l e o (ate 16 caracteres). Default de campaign_link.codigo_publico e, em maiusculas, o codigo por clique de registrar_clique_do_link.';

-- ---------------------------------------------------------------------------
-- 2) campaign_link: o codigo publico do link rastreado
-- ---------------------------------------------------------------------------
-- Unico no sistema inteiro (o token e unico so dentro da clinica): e ele que
-- vai no endereco publico. Nao e segredo.

alter table public.campaign_link
  add column codigo_publico text not null default public.sortear_codigo(8)
    constraint campaign_link_codigo_publico_formato
      check (codigo_publico ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{8}$');

create unique index campaign_link_codigo_publico_unico
  on public.campaign_link (codigo_publico);

comment on column public.campaign_link.codigo_publico is
  'Codigo do endereco publico do link rastreado (<sistema>/l/<codigo>). Sorteado ao criar a origem, unico no sistema inteiro, 8 caracteres minusculos. Nao e segredo.';

-- ---------------------------------------------------------------------------
-- 3) clique_do_site: o clique que veio do link
-- ---------------------------------------------------------------------------

alter table public.clique_do_site
  -- 'site': avisado pelo script do site. 'link': gravado pelo redirect.
  add column via text not null default 'site'
    constraint clique_do_site_via_valida check (via in ('site', 'link')),
  -- A origem cadastrada do link. Excluir a origem solta o clique (o casado
  -- guarda os identificadores para a conversao).
  add column campaign_link_id uuid
    references public.campaign_link (id) on delete set null,
  -- O numero para onde o link mandou a pessoa.
  add column whatsapp_account_id uuid
    references public.whatsapp_account (id) on delete set null,
  drop constraint clique_do_site_tem_sinal,
  -- O clique do site so nasce com sinal. O do link pode nao ter nenhum (o
  -- toque na bio nao traz parametro).
  add constraint clique_do_site_tem_sinal check (
    casado_em is not null
    or via = 'link'
    or gclid is not null or gbraid is not null or wbraid is not null
    or gad_source is not null or google_campaign_id is not null
    or google_adgroup_id is not null
    or fbclid is not null or meta_ad_id is not null
    or utm_source is not null or utm_medium is not null
    or utm_campaign is not null or utm_content is not null
    or utm_term is not null
  );

create index clique_do_site_do_link
  on public.clique_do_site (campaign_link_id, casado_em)
  where campaign_link_id is not null;

-- ---------------------------------------------------------------------------
-- 4) clique_do_link_dia: a contagem que fica
-- ---------------------------------------------------------------------------
-- O clique nao usado e apagado 8 dias depois; a contagem por origem, por
-- numero e por dia (no fuso da clinica) fica. So o sistema le e escreve: a
-- tela le por resumo_dos_links_rastreados.

create table public.clique_do_link_dia (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  campaign_link_id uuid not null references public.campaign_link (id) on delete cascade,
  whatsapp_account_id uuid not null references public.whatsapp_account (id) on delete cascade,
  dia date not null,
  cliques integer not null default 0 check (cliques >= 0),
  primary key (campaign_link_id, whatsapp_account_id, dia)
);

create index clique_do_link_dia_da_clinica
  on public.clique_do_link_dia (clinic_id, dia);

alter table public.clique_do_link_dia enable row level security;
-- Nenhuma policy e nenhum grant para anon e authenticated, como em
-- clique_do_site.
revoke all on table public.clique_do_link_dia from anon, authenticated;

comment on table public.clique_do_link_dia is
  'Cliques do link rastreado por origem, por numero e por dia (no fuso da clinica). Gravada por registrar_clique_do_link; lida pela tela por resumo_dos_links_rastreados. RLS ligada, sem policy e sem grant para a sessao.';

-- ---------------------------------------------------------------------------
-- 5) registrar_clique_do_link: o redirect grava e pergunta para onde ir
-- ---------------------------------------------------------------------------
-- Devolve sempre o destino quando o link serve (numero, mensagem e o codigo
-- fixo da origem), com um resultado:
--   ok            clique gravado; "codigo" e o codigo por clique;
--   sem_gravar    p_gravar falso (robo, previa): nada gravado;
--   limite        30 por minuto por clinica, ou sem codigo livre: nada
--                 gravado; o redirect usa o codigo fixo;
--   indisponivel  link que nao existe, desativado ou sem mensagem pronta;
--   sem_numero    a clinica nao tem numero de WhatsApp com telefone.
-- O limite por minuto e o teto de vivos sao os MESMOS do clique do site (a
-- conta e por clinica). Sem a trava de linha do site: duas requisicoes no
-- mesmo instante podem passar um pouco do limite, o que so adia a poda.

create function public.registrar_clique_do_link(
  p_codigo_publico text,
  p_gravar boolean default true,
  p_gclid text default null,
  p_gbraid text default null,
  p_wbraid text default null,
  p_gad_source text default null,
  p_google_campaign_id text default null,
  p_google_adgroup_id text default null,
  p_fbclid text default null,
  p_meta_ad_id text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_por_minuto constant integer := 30;
  c_vivos constant integer := 2000;
  c_controle constant text := '[\x01-\x1f\x7f-\x9f  ]';
  v_link_id uuid;
  v_clinic uuid;
  v_token text;
  v_mensagem text;
  v_numero uuid;
  v_digitos text;
  v_destino jsonb;
  v_codigo text;
  v_fuso text;
  v_n integer;
  v_id uuid;
begin
  if p_codigo_publico is null
     or p_codigo_publico !~ '^[23456789abcdefghjkmnpqrstuvwxyz]{8}$'
  then
    return jsonb_build_object('resultado', 'indisponivel');
  end if;

  select l.id, l.clinic_id, l.token, l.default_message
    into v_link_id, v_clinic, v_token, v_mensagem
    from public.campaign_link l
   where l.codigo_publico = p_codigo_publico
     and l.active;
  if v_link_id is null or v_mensagem is null then
    return jsonb_build_object('resultado', 'indisponivel');
  end if;

  -- O numero: ativo e com telefone; conectado antes, e entre eles o
  -- principal. Se nenhum esta conectado, vai o principal assim mesmo (melhor
  -- que perder o lead).
  select a.id, regexp_replace(a.display_phone, '\D', '', 'g')
    into v_numero, v_digitos
    from public.whatsapp_account a
   where a.clinic_id = v_clinic
     and a.removido_em is null
     and char_length(regexp_replace(coalesce(a.display_phone, ''), '\D', '', 'g')) between 10 and 15
   order by (a.connection_status = 'conectado') desc, a.principal desc,
            a.created_at, a.id
   limit 1;
  if v_numero is null then
    return jsonb_build_object('resultado', 'sem_numero');
  end if;

  v_destino := jsonb_build_object(
    'digitos', v_digitos,
    'mensagem', v_mensagem,
    'codigo_fixo', upper(v_token)
  );

  if not coalesce(p_gravar, true) then
    return v_destino || jsonb_build_object('resultado', 'sem_gravar');
  end if;

  -- Os mesmos formatos de registrar_clique_do_site. O redirect ja filtra
  -- (sinaisDaUrl): 22023 aqui e defeito, e o redirect cai no codigo fixo.
  if (p_gclid is not null and (p_gclid !~ '^[A-Za-z0-9._~+/=-]+$' or char_length(p_gclid) > 512))
     or (p_gbraid is not null and (p_gbraid !~ '^[A-Za-z0-9._~+/=-]+$' or char_length(p_gbraid) > 512))
     or (p_wbraid is not null and (p_wbraid !~ '^[A-Za-z0-9._~+/=-]+$' or char_length(p_wbraid) > 512))
     or (p_gad_source is not null and p_gad_source !~ '^[A-Za-z0-9_-]{1,32}$')
     or (p_google_campaign_id is not null and p_google_campaign_id !~ '^[0-9]{1,20}$')
     or (p_google_adgroup_id is not null and p_google_adgroup_id !~ '^[0-9]{1,20}$')
     or (p_fbclid is not null and (p_fbclid !~ '^[A-Za-z0-9._~+/=-]+$' or char_length(p_fbclid) > 512))
     or (p_meta_ad_id is not null and p_meta_ad_id !~ '^[0-9]{1,20}$')
     or (p_utm_source is not null and (char_length(p_utm_source) not between 1 and 100 or p_utm_source ~ c_controle))
     or (p_utm_medium is not null and (char_length(p_utm_medium) not between 1 and 100 or p_utm_medium ~ c_controle))
     or (p_utm_campaign is not null and (char_length(p_utm_campaign) not between 1 and 100 or p_utm_campaign ~ c_controle))
     or (p_utm_content is not null and (char_length(p_utm_content) not between 1 and 100 or p_utm_content ~ c_controle))
     or (p_utm_term is not null and (char_length(p_utm_term) not between 1 and 100 or p_utm_term ~ c_controle))
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clique do link fora do formato.';
  end if;

  select count(*) into v_n
    from public.clique_do_site k
   where k.clinic_id = v_clinic
     and k.criado_em > now() - interval '1 minute';
  if v_n >= c_por_minuto then
    return v_destino || jsonb_build_object('resultado', 'limite');
  end if;

  -- O codigo por clique nasce aqui: nunca igual a um codigo fixo da clinica
  -- (a ingestao daria a origem fixa) nem a outro clique dela.
  for tentativa in 1..5 loop
    v_codigo := upper(public.sortear_codigo(6));
    if not exists (
      select 1 from public.campaign_link l
       where l.clinic_id = v_clinic
         and l.token is not null
         and upper(l.token) = v_codigo
    ) then
      insert into public.clique_do_site (
        clinic_id, codigo, via, campaign_link_id, whatsapp_account_id,
        gclid, gbraid, wbraid, gad_source, google_campaign_id,
        google_adgroup_id, fbclid, meta_ad_id, utm_source, utm_medium,
        utm_campaign, utm_content, utm_term
      ) values (
        v_clinic, v_codigo, 'link', v_link_id, v_numero,
        p_gclid, p_gbraid, p_wbraid, p_gad_source, p_google_campaign_id,
        p_google_adgroup_id, p_fbclid, p_meta_ad_id, p_utm_source,
        p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term
      )
      on conflict (clinic_id, codigo) do nothing
      returning id into v_id;
      exit when v_id is not null;
    end if;
  end loop;
  if v_id is null then
    return v_destino || jsonb_build_object('resultado', 'limite');
  end if;

  -- Teto de vivos, igual ao do clique do site: passou de 2.000, sai o
  -- excesso pelo que vence primeiro, nunca o recem-gravado.
  select count(*) into v_n
    from public.clique_do_site k
   where k.clinic_id = v_clinic
     and k.contact_id is null
     and k.valido_ate > now();
  if v_n > c_vivos then
    delete from public.clique_do_site k
     where k.contact_id is null
       and k.id in (
         select k2.id
           from public.clique_do_site k2
          where k2.clinic_id = v_clinic
            and k2.contact_id is null
            and k2.valido_ate > now()
            and k2.id <> v_id
          order by k2.valido_ate, k2.id
          limit v_n - c_vivos
       );
  end if;

  -- A contagem do dia, no fuso da clinica.
  select coalesce(c.timezone, 'America/Fortaleza') into v_fuso
    from public.clinic c
   where c.id = v_clinic;
  insert into public.clique_do_link_dia as d (
    clinic_id, campaign_link_id, whatsapp_account_id, dia, cliques
  ) values (
    v_clinic, v_link_id, v_numero, (now() at time zone v_fuso)::date, 1
  )
  on conflict (campaign_link_id, whatsapp_account_id, dia)
  do update set cliques = d.cliques + 1;

  return v_destino || jsonb_build_object('resultado', 'ok', 'codigo', v_codigo);
end;
$$;

revoke all on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

comment on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text) is
  'Redirect do link rastreado (rota publica, service role): acha a origem ativa pelo codigo publico, escolhe o numero (conectado antes, principal antes), grava o clique com um codigo por clique e os sinais da URL, conta o clique do dia e devolve {resultado, digitos, mensagem, codigo_fixo, codigo}. Resultados: ok, sem_gravar, limite, indisponivel, sem_numero. 22023 com sinal fora do formato. So service_role.';

-- ---------------------------------------------------------------------------
-- 6) casar_clique_do_site: o clique do link da a origem da origem cadastrada
-- ---------------------------------------------------------------------------
-- Corpo de 20261116110000 com o que e novo entre os marcadores "[link]".
-- Mesma assinatura, mesmos retornos.

create or replace function public.casar_clique_do_site(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_codigo text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
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
    return 'nao_achado';
  end if;
  if v_clique.valido_ate <= now() then
    return 'expirado';
  end if;

  update public.clique_do_site
     set contact_id = p_contact_id,
         casado_em = now()
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
  elsif v_clique.fbclid is not null or v_clique.meta_ad_id is not null
     or (v_pago and v_fonte in ('ig', 'instagram', 'fb', 'facebook', 'meta'))
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
        ) then 'redes_sociais'
      else 'direto'
    end;
    v_origem := coalesce(nullif(v_fonte, ''), 'site');
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
$$;

comment on function public.casar_clique_do_site(uuid, uuid, text) is
  'Casa o codigo da mensagem com um clique (do site ou do link rastreado) da mesma clinica, nao casado e no prazo (ingestao, depois do codigo fixo de campaign_link). Devolve origem_gravada, vinculado, nao_achado ou expirado. Grava a origem so em contato sem origem e sem sinal de anuncio da Meta: clique do link (a origem cadastrada, metodo link_token, e o anuncio da Meta se veio); sinal do Google (Trafego pago, Google, ids); fbclid ou numero do anuncio (Trafego pago, Meta, o anuncio em source_ad_id, com o pedido da campanha a Meta); so UTMs (canal pela utm_medium, origem, meio e campanha pelas UTMs). 22023 sem clinica ou contato. So service_role.';

-- ---------------------------------------------------------------------------
-- 7) resumo_dos_links_rastreados: cliques e leads por origem, para a tela
-- ---------------------------------------------------------------------------

create function public.resumo_dos_links_rastreados(
  p_clinic_id uuid,
  p_dias integer default 30
) returns table (campaign_link_id uuid, cliques bigint, leads bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
             select count(*)
               from public.clique_do_site k
              where k.campaign_link_id = l.id
                and k.contact_id is not null
                and k.casado_em >= (v_desde::timestamp at time zone coalesce(v_fuso, 'America/Fortaleza'))
           )::bigint
      from public.campaign_link l
     where l.clinic_id = p_clinic_id;
end;
$$;

revoke all on function public.resumo_dos_links_rastreados(uuid, integer)
  from public, anon;
grant execute on function public.resumo_dos_links_rastreados(uuid, integer)
  to authenticated, service_role;

comment on function public.resumo_dos_links_rastreados(uuid, integer) is
  'Cliques (clique_do_link_dia) e leads (cliques casados) de cada origem da clinica nos ultimos p_dias dias (1 a 365, padrao 30), no fuso da clinica. Membro ativo da clinica ou service_role; 42501 fora disso.';

notify pgrst, 'reload schema';
