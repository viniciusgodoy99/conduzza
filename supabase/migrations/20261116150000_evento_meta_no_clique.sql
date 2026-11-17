-- ---------------------------------------------------------------------------
-- Evento para a Meta no clique do link rastreado (etapa 3e do plano de
-- 16/11/2026, "Rastreio completo"), como no Q5
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026: o link da origem pode avisar a Meta na hora
-- do clique. Com a chave da origem ligada (campaign_link.avisar_meta_no_clique)
-- e o Pixel e o envio de conversoes ligados na clinica, o redirect mostra uma
-- pagina intermediaria que dispara PageView e Contact no Pixel e segue para o
-- WhatsApp, e manda o mesmo Contact pelo servidor com o MESMO id (o id do
-- clique), para a Meta contar uma vez so.
--
-- O banco so diz ao redirect QUAL Pixel e qual id de evento: o token da API
-- de conversoes continua so na tabela-secret, lido pelo servidor.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. O codigo antigo ignora
-- os dois campos novos da resposta. A chave nasce desligada em toda origem.
--
-- TRAVAS: campaign_link esta vazia em producao (16/11/2026). lock_timeout 4s.
--
-- ROLLBACK (manual): reaplicar registrar_clique_do_link de 20261116130000 e
-- dropar campaign_link.avisar_meta_no_clique.

set local lock_timeout = '4s';

alter table public.campaign_link
  add column avisar_meta_no_clique boolean not null default false;

comment on column public.campaign_link.avisar_meta_no_clique is
  'Com verdadeiro, o link rastreado desta origem avisa a Meta na hora do clique (pagina intermediaria com o Pixel e o mesmo evento pelo servidor), se a clinica tem o Pixel e o envio de conversoes ligados. Nasce falso.';

-- Corpo de 20261116130000 com o que e novo entre os marcadores
-- "[evento no clique]". Mesma assinatura: create or replace mantem os grants.

create or replace function public.registrar_clique_do_link(
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
  p_utm_term text default null,
  p_numero_fixado uuid default null
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
  -- [rodizio] inicio
  v_so_os_escolhidos boolean;
  v_escolhido boolean;
  -- [rodizio] fim
  -- [evento no clique] inicio
  v_avisar boolean;
  v_pixel text;
  v_retorno jsonb;
  -- [evento no clique] fim
begin
  if p_codigo_publico is null
     or p_codigo_publico !~ '^[23456789abcdefghjkmnpqrstuvwxyz]{8}$'
  then
    return jsonb_build_object('resultado', 'indisponivel');
  end if;

  select l.id, l.clinic_id, l.token, l.default_message, l.avisar_meta_no_clique
    into v_link_id, v_clinic, v_token, v_mensagem, v_avisar
    from public.campaign_link l
   where l.codigo_publico = p_codigo_publico
     and l.active;
  if v_link_id is null or v_mensagem is null then
    return jsonb_build_object('resultado', 'indisponivel');
  end if;

  -- [rodizio] inicio
  -- Os numeros que servem: ativos e com telefone; os ESCOLHIDOS para o link
  -- ou, sem escolha (ou se nenhum escolhido serve mais), os da clinica. So os
  -- conectados; se todos cairam, qualquer um (melhor que perder o lead).
  -- Entre eles: o fixado do visitante, se ainda serve; depois o de menor
  -- entregues/peso (rodizio com peso, so entre os escolhidos); depois o
  -- principal. Sem trava de linha: dois cliques no mesmo instante podem
  -- escolher o mesmo numero, e o rodizio se corrige nos seguintes.
  v_so_os_escolhidos := exists (
    select 1 from public.campaign_link_numero n
     where n.campaign_link_id = v_link_id
  );
  loop
    with candidatos as (
      select a.id,
             regexp_replace(a.display_phone, '\D', '', 'g') as digitos,
             (a.connection_status = 'conectado') as conectado,
             a.principal, a.created_at,
             (n.campaign_link_id is not null) as escolhido,
             n.peso, n.entregues
        from public.whatsapp_account a
        left join public.campaign_link_numero n
          on n.whatsapp_account_id = a.id
         and n.campaign_link_id = v_link_id
       where a.clinic_id = v_clinic
         and a.removido_em is null
         and char_length(regexp_replace(coalesce(a.display_phone, ''), '\D', '', 'g')) between 10 and 15
         and (not v_so_os_escolhidos or n.campaign_link_id is not null)
    )
    select c.id, c.digitos, c.escolhido
      into v_numero, v_digitos, v_escolhido
      from candidatos c
     where c.conectado
        or not exists (select 1 from candidatos x where x.conectado)
     order by (c.id is not distinct from p_numero_fixado) desc,
              case when c.escolhido then c.entregues::numeric / c.peso end nulls last,
              c.principal desc, c.created_at, c.id
     limit 1;
    exit when v_numero is not null or not v_so_os_escolhidos;
    v_so_os_escolhidos := false;
  end loop;
  -- [rodizio] fim
  if v_numero is null then
    return jsonb_build_object('resultado', 'sem_numero');
  end if;

  v_destino := jsonb_build_object(
    'digitos', v_digitos,
    'mensagem', v_mensagem,
    'codigo_fixo', upper(v_token),
    -- [rodizio] o redirect grava este numero no cookie do visitante
    'numero', v_numero
  );

  if not coalesce(p_gravar, true) then
    return v_destino || jsonb_build_object('resultado', 'sem_gravar');
  end if;

  -- [rodizio] inicio
  -- Gente de verdade conta no rodizio, mesmo se o clique nao for gravado
  -- adiante (limite): a pessoa vai para o numero do mesmo jeito.
  if v_escolhido then
    update public.campaign_link_numero
       set entregues = entregues + 1
     where campaign_link_id = v_link_id
       and whatsapp_account_id = v_numero;
  end if;
  -- [rodizio] fim

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

  v_retorno := v_destino || jsonb_build_object('resultado', 'ok', 'codigo', v_codigo);
  -- [evento no clique] inicio
  -- A origem pediu para avisar a Meta no clique e a clinica tem o Pixel e o
  -- envio de conversoes ligados: o redirect recebe o Pixel e o id do clique
  -- (o id do evento, igual no navegador e no servidor, para a Meta contar uma
  -- vez so). O token nunca sai por aqui.
  if v_avisar then
    select a.pixel_id into v_pixel
      from public.meta_ads_account a
     where a.clinic_id = v_clinic
       and a.envio_ativado
       and a.pixel_id ~ '^[0-9]{1,20}$';
    if v_pixel is not null then
      v_retorno := v_retorno
        || jsonb_build_object(
             'pixel_id', v_pixel,
             'clique_id', v_id,
             -- So para o servidor achar o token; nunca vai ao navegador.
             'clinica', v_clinic
           );
    end if;
  end if;
  -- [evento no clique] fim
  return v_retorno;
end;
$$;

comment on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid) is
  'Redirect do link rastreado (rota publica, service role): acha a origem ativa pelo codigo publico, escolhe o numero (os escolhidos para o link, ou os da clinica; so conectados, se houver; o fixado do visitante, depois o rodizio com peso, depois o principal), grava o clique com um codigo por clique e os sinais da URL, conta o clique do dia e devolve {resultado, digitos, mensagem, codigo_fixo, numero, codigo}. Com a chave da origem ligada e o Pixel e o envio ligados na clinica, o ok traz tambem pixel_id, clique_id (o id do evento) e clinica. Resultados: ok, sem_gravar, limite, indisponivel, sem_numero. 22023 com sinal fora do formato. So service_role.';

notify pgrst, 'reload schema';
