-- ---------------------------------------------------------------------------
-- Clique do site com o anuncio da Meta e as UTMs (etapa 2 do plano de
-- 16/11/2026, "Rastreio completo")
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026, depois do benchmark do Tintim e do Q5: o
-- script do site (public/rastreio/v1.js, no MESMO endereco) deixa de agir so
-- em anuncio do Google. Passa a levar tambem o fbclid, o numero do anuncio da
-- Meta (cz_anuncio, dos parametros de URL do anuncio) e as cinco UTMs. O
-- clique guarda isso; quando a mensagem chega com o codigo, o contato sem
-- origem ganha:
--   - sinal do Google: como antes (Trafego pago, Google, ids do Google);
--   - fbclid ou numero do anuncio: Trafego pago, Meta, plataforma pela
--     utm_source (ig, fb), e o numero do anuncio em source_ad_id, que o job
--     resolver_anuncio_meta ja liga a campanha e ao conjunto;
--   - so UTMs: o canal pela utm_medium (regra abaixo) e origem, meio e
--     campanha pelas UTMs.
-- O fbclid do clique casado vai no evento de conversao da Meta como fbc
-- (lib/jobs/conversao-meta.ts) e e zerado 90 dias depois do clique, como o
-- gclid. Continua sem IP, navegador e pagina visitada.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. O codigo antigo chama
-- registrar_clique_do_site pelos nomes dos argumentos antigos, que continuam
-- valendo (os novos tem default). O codigo novo, sem ela, recebe erro do
-- banco no aviso do clique (a rota responde 204 e o link nunca quebra) e o
-- job de conversao repete (clique_indisponivel) ate ela chegar.
--
-- TRAVAS: clique_do_site esta vazia em producao (16/11/2026) e contact tem
-- 653 linhas, nenhuma com clique_site: a troca do check confere tudo em
-- milissegundos, com a trava exclusiva de contact pelo tempo da transacao.
-- lock_timeout de 4s: se a trava nao vier, a migration falha inteira e nada
-- muda. Aplicar em horario calmo.
--
-- ROLLBACK (manual): reaplicar registrar_clique_do_site, casar_clique_do_site
-- e podar_cliques_do_site de 20261005100000 (dropando antes a assinatura
-- nova de registrar), recriar clique_do_site_tem_sinal_do_google e dropar as
-- colunas novas. O check de contact so volta ao que era se nenhum contato
-- tiver ganho origem clique_site fora do Google (a origem e imutavel).

set local lock_timeout = '4s';

-- ---------------------------------------------------------------------------
-- 1) clique_do_site: as colunas novas e o check de "tem sinal"
-- ---------------------------------------------------------------------------

alter table public.clique_do_site
  -- Identificador do clique na Meta. Zerado 90 dias depois do clique.
  add column fbclid text
    check (fbclid is null or (fbclid ~ '^[A-Za-z0-9._~+/=-]+$' and char_length(fbclid) <= 512)),
  -- Numero do anuncio da Meta ({{ad.id}} nos parametros de URL do anuncio).
  add column meta_ad_id text
    check (meta_ad_id is null or meta_ad_id ~ '^[0-9]{1,20}$'),
  -- UTMs: texto livre de 1 a 100 caracteres, sem controle nem quebra de
  -- linha (o mesmo formato de FORMATO_DA_UTM, lib/domain/rastreio-do-site.ts).
  add column utm_source text
    check (utm_source is null or (char_length(utm_source) between 1 and 100 and utm_source !~ '[\x01-\x1f\x7f-\x9f  ]')),
  add column utm_medium text
    check (utm_medium is null or (char_length(utm_medium) between 1 and 100 and utm_medium !~ '[\x01-\x1f\x7f-\x9f  ]')),
  add column utm_campaign text
    check (utm_campaign is null or (char_length(utm_campaign) between 1 and 100 and utm_campaign !~ '[\x01-\x1f\x7f-\x9f  ]')),
  add column utm_content text
    check (utm_content is null or (char_length(utm_content) between 1 and 100 and utm_content !~ '[\x01-\x1f\x7f-\x9f  ]')),
  add column utm_term text
    check (utm_term is null or (char_length(utm_term) between 1 and 100 and utm_term !~ '[\x01-\x1f\x7f-\x9f  ]')),
  drop constraint clique_do_site_tem_sinal_do_google,
  -- Pelo menos um sinal ao nascer (Google, Meta ou UTM). Depois de casado a
  -- poda zera os identificadores, entao o check nao vale para o casado.
  add constraint clique_do_site_tem_sinal check (
    casado_em is not null
    or gclid is not null or gbraid is not null or wbraid is not null
    or gad_source is not null or google_campaign_id is not null
    or google_adgroup_id is not null
    or fbclid is not null or meta_ad_id is not null
    or utm_source is not null or utm_medium is not null
    or utm_campaign is not null or utm_content is not null
    or utm_term is not null
  );

-- ---------------------------------------------------------------------------
-- 2) contact: a origem "clique no site" deixa de ser so do Google
-- ---------------------------------------------------------------------------
-- Com clique_site: canal e origem preenchidos. Origem 'Google' e 'Meta'
-- (exatas) seguem as regras de anuncio: canal trafego_pago, source_campaign
-- nulo (a campanha vem pelos ids), meio nulo no Google e Facebook, Instagram
-- ou nulo na Meta. As demais origens (UTM) vao em minusculas, por
-- casar_clique_do_site, e nunca colidem com as duas. Os ids do Google so
-- existem com clique_site de origem Google.

alter table public.contact
  drop constraint contact_origem_do_clique_do_site_coerente,
  add constraint contact_origem_do_clique_do_site_coerente check (
    (
      source_method is distinct from 'clique_site'
      or (
        source_channel is not null
        and source_origin is not null
        and (
          source_origin <> 'Google'
          or (
            source_channel = 'trafego_pago'
            and source_medium is null
            and source_campaign is null
          )
        )
        and (
          source_origin <> 'Meta'
          or (
            source_channel = 'trafego_pago'
            and (source_medium is null or source_medium in ('Facebook', 'Instagram'))
            and source_campaign is null
          )
        )
      )
    )
    and (
      (source_google_campaign_id is null and source_google_adgroup_id is null)
      or (
        source_method is not distinct from 'clique_site'
        and source_origin is not distinct from 'Google'
      )
    )
  );

comment on constraint contact_origem_do_clique_do_site_coerente on public.contact is
  'Origem de clique no site (source_method clique_site): canal e origem preenchidos. Origem Google: trafego_pago, meio e source_campaign nulos. Origem Meta: trafego_pago, meio Facebook, Instagram ou nulo, source_campaign nulo. Outras origens (UTM): livres. Os ids do Google (source_google_*) so existem com clique_site de origem Google.';

-- ---------------------------------------------------------------------------
-- 3) registrar_clique_do_site: os argumentos novos
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 16/11/2026) com o que e novo: a
-- validacao e a gravacao de fbclid, meta_ad_id e utm_*, e "nenhum sinal"
-- contando os novos. A assinatura muda, entao a antiga sai antes.

drop function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text);

create function public.registrar_clique_do_site(
  p_chave text,
  p_codigo text,
  p_gclid text default null,
  p_gbraid text default null,
  p_wbraid text default null,
  p_gad_source text default null,
  p_google_campaign_id text default null,
  p_google_adgroup_id text default null,
  p_site_host text default null,
  p_fbclid text default null,
  p_meta_ad_id text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_por_minuto constant integer := 30;
  c_vivos constant integer := 2000;
  c_controle constant text := '[\x01-\x1f\x7f-\x9f  ]';
  v_clinic uuid;
  v_ativo boolean;
  v_host text;
  v_n integer;
  v_id uuid;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{20}$' then
    return 'chave_invalida';
  end if;

  if p_codigo is null
     or p_codigo !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'
     or (p_gclid is not null and (p_gclid !~ '^[A-Za-z0-9._~+/=-]+$' or char_length(p_gclid) > 512))
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
     or coalesce(
          p_gclid, p_gbraid, p_wbraid, p_gad_source, p_google_campaign_id,
          p_google_adgroup_id, p_fbclid, p_meta_ad_id, p_utm_source,
          p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term
        ) is null
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clique do site fora do formato.';
  end if;

  v_host := lower(btrim(p_site_host));
  if v_host is not null and v_host !~ '^[a-z0-9.-]{1,253}$' then
    v_host := null;
  end if;

  select r.clinic_id, r.ativo
    into v_clinic, v_ativo
    from public.rastreio_do_site r
   where r.chave = p_chave;
  if v_clinic is null then
    return 'chave_invalida';
  end if;
  if not v_ativo then
    return 'desligado';
  end if;

  if exists (
    select 1 from public.campaign_link l
     where l.clinic_id = v_clinic
       and l.token is not null
       and upper(l.token) = p_codigo
  ) then
    return 'codigo_reservado';
  end if;

  if exists (
    select 1 from public.clique_do_site k
     where k.clinic_id = v_clinic and k.codigo = p_codigo
  ) then
    return 'duplicado';
  end if;

  select count(*) into v_n
    from public.clique_do_site k
   where k.clinic_id = v_clinic
     and k.criado_em > now() - interval '1 minute';
  if v_n >= c_por_minuto then
    return 'limite';
  end if;

  -- Trava da clinica. Se a chave trocou ou o rastreio desligou entre a
  -- leitura e a trava, a linha nao volta e a resposta segue o estado novo.
  perform 1
    from public.rastreio_do_site r
   where r.clinic_id = v_clinic and r.chave = p_chave and r.ativo
     for update;
  if not found then
    perform 1 from public.rastreio_do_site r where r.chave = p_chave;
    if not found then
      return 'chave_invalida';
    end if;
    return 'desligado';
  end if;

  select count(*) into v_n
    from public.clique_do_site k
   where k.clinic_id = v_clinic
     and k.criado_em > now() - interval '1 minute';
  if v_n >= c_por_minuto then
    return 'limite';
  end if;

  insert into public.clique_do_site (
    clinic_id, codigo, gclid, gbraid, wbraid, gad_source,
    google_campaign_id, google_adgroup_id, site_host,
    fbclid, meta_ad_id, utm_source, utm_medium, utm_campaign, utm_content,
    utm_term
  ) values (
    v_clinic, p_codigo, p_gclid, p_gbraid, p_wbraid, p_gad_source,
    p_google_campaign_id, p_google_adgroup_id, v_host,
    p_fbclid, p_meta_ad_id, p_utm_source, p_utm_medium, p_utm_campaign,
    p_utm_content, p_utm_term
  )
  on conflict (clinic_id, codigo) do nothing
  returning id into v_id;
  if v_id is null then
    return 'duplicado';
  end if;

  -- Teto de vivos, so depois de gravar (o aviso repetido que chega junto e
  -- volta duplicado nao tira ninguem): passou de 2.000, sai o excesso pelo
  -- que vence primeiro, nunca o recem-gravado. Vencido e casado nao saem
  -- por aqui (a poda cuida deles).
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

  update public.rastreio_do_site
     set ultimo_clique_em = now()
   where clinic_id = v_clinic;

  return 'ok';
end;
$$;

revoke all on function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

comment on function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) is
  'Grava o clique avisado pelo site (rota publica, service role), com os sinais do Google, da Meta (fbclid e numero do anuncio) e as UTMs. Devolve ok, chave_invalida, desligado, limite (30 por minuto por clinica), duplicado ou codigo_reservado. Teto de 2.000 vivos (nao casados e no prazo) por clinica: cheio, o clique novo entra e o vivo que vence primeiro sai. 22023 com dado fora do formato ou sem sinal. So service_role.';

-- ---------------------------------------------------------------------------
-- 4) casar_clique_do_site: a origem pelo sinal do clique
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 16/11/2026) com o que e novo
-- entre os marcadores "[meta e utm]". Mesma assinatura, mesmos retornos.

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
  -- De onde veio o clique, nesta ordem: sinal do Google; fbclid ou numero do
  -- anuncio da Meta; so UTMs.
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

  if v_clique.gclid is not null or v_clique.gbraid is not null
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

  -- Origem so em contato sem origem (canal, metodo e campanha em texto
  -- nulos) e sem sinal de anuncio da Meta. A origem e imutavel: na duvida
  -- fica vazia (preenche-se depois), nunca errada.
  update public.contact c
     set source_channel = v_canal,
         source_origin = v_origem,
         source_medium = v_plataforma,
         source_campaign = v_campanha,
         source_method = 'clique_site',
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
  'Casa o codigo da mensagem com um clique do site da mesma clinica, nao casado e no prazo (ingestao, depois do codigo fixo de campaign_link). Devolve origem_gravada, vinculado, nao_achado ou expirado. Grava a origem so em contato sem origem e sem sinal de anuncio da Meta: sinal do Google (Trafego pago, Google, ids da campanha e do grupo); fbclid ou numero do anuncio (Trafego pago, Meta, plataforma e o anuncio em source_ad_id, com o pedido da campanha a Meta); so UTMs (canal pela utm_medium, origem, meio e campanha pelas UTMs). 22023 sem clinica ou contato. So service_role.';

-- ---------------------------------------------------------------------------
-- 5) podar_cliques_do_site: o fbclid tambem e zerado em 90 dias
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 16/11/2026) com o fbclid.

create or replace function public.podar_cliques_do_site(
  p_agora timestamptz default now(),
  p_clinic_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora constant timestamptz := coalesce(p_agora, now());
  v_apagados integer := 0;
  v_zerados integer := 0;
begin
  if v_agora > now() and p_clinic_ids is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Poda com data futura só com a lista de clínicas.';
  end if;

  with alvo as (
    select k.id
      from public.clique_do_site k
     where k.contact_id is null
       and k.valido_ate < v_agora - interval '1 day'
       and (p_clinic_ids is null or k.clinic_id = any (p_clinic_ids))
     limit 5000
  )
  delete from public.clique_do_site k
   using alvo
   where k.id = alvo.id;
  get diagnostics v_apagados = row_count;

  with alvo as (
    select k.id
      from public.clique_do_site k
     where k.contact_id is not null
       and (k.gclid is not null or k.gbraid is not null or k.wbraid is not null
            or k.fbclid is not null)
       and k.criado_em < v_agora - interval '90 days'
       and (p_clinic_ids is null or k.clinic_id = any (p_clinic_ids))
     limit 5000
  )
  update public.clique_do_site k
     set gclid = null,
         gbraid = null,
         wbraid = null,
         fbclid = null
    from alvo
   where k.id = alvo.id;
  get diagnostics v_zerados = row_count;

  return jsonb_build_object('apagados', v_apagados, 'zerados', v_zerados);
end;
$$;

comment on function public.podar_cliques_do_site(timestamptz, uuid[]) is
  'Retencao dos cliques do site: apaga o nao casado 1 dia depois de vencer e zera gclid, gbraid, wbraid e fbclid do casado 90 dias depois do clique. Devolve {apagados, zerados}. Chamada por motor_manutencao sem argumentos; p_agora e p_clinic_ids so para testes (data futura exige a lista). So service_role.';

notify pgrst, 'reload schema';
