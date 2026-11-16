-- ---------------------------------------------------------------------------
-- Rodizio entre numeros no link rastreado (etapa 3b do plano de 16/11/2026,
-- "Rastreio completo"), como no Q5
-- ---------------------------------------------------------------------------
-- Decisao do dono em 16/11/2026: o link da origem pode distribuir entre
-- varios numeros de WhatsApp da clinica, com peso, e o mesmo visitante cai
-- sempre no mesmo numero.
--   - campaign_link_numero: os numeros escolhidos para o link e o peso de
--     cada um (1 a 10). Sem linha nenhuma, vale o de antes: o principal da
--     clinica, ou outro conectado se ele caiu.
--   - registrar_clique_do_link ganha p_numero_fixado (o numero que o cookie
--     do visitante guarda) e devolve "numero" (para o redirect gravar o
--     cookie). Entre os numeros que servem: so os conectados (se todos
--     cairam, qualquer um); o fixado, se ainda serve; senao o de menor
--     entregues/peso (rodizio com peso), contado no banco.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. O codigo antigo chama
-- registrar_clique_do_link pelos nomes dos argumentos de antes (o novo tem
-- default) e ignora o campo "numero" da resposta. O codigo novo, sem ela,
-- nao acha "numero" na resposta e mostra a pagina de indisponivel.
--
-- TRAVAS: campaign_link esta vazia e whatsapp_account tem 7 linhas
-- (16/11/2026): as duas chaves unicas novas nascem em milissegundos, com a
-- trava exclusiva da tabela pelo tempo da transacao. lock_timeout de 4s.
--
-- ROLLBACK (manual): reaplicar registrar_clique_do_link de 20261116120000
-- (dropando antes a assinatura nova), drop de campaign_link_numero e das
-- duas chaves unicas.

set local lock_timeout = '4s';

-- ---------------------------------------------------------------------------
-- 1) Chaves para a FK composta com a clinica
-- ---------------------------------------------------------------------------
-- O numero do link e a origem tem de ser da MESMA clinica: a FK composta
-- garante no banco (a clinica A nunca aponta o link dela para o numero da B).

alter table public.campaign_link
  add constraint campaign_link_id_clinica_unico unique (id, clinic_id);

alter table public.whatsapp_account
  add constraint whatsapp_account_id_clinica_unico unique (id, clinic_id);

-- ---------------------------------------------------------------------------
-- 2) campaign_link_numero
-- ---------------------------------------------------------------------------

create table public.campaign_link_numero (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  campaign_link_id uuid not null,
  whatsapp_account_id uuid not null,
  -- De cada (soma dos pesos) pessoas, quantas vao para este numero.
  peso integer not null default 1
    constraint campaign_link_numero_peso check (peso between 1 and 10),
  -- Quantas pessoas o rodizio ja mandou para este numero por este link. So o
  -- sistema escreve (registrar_clique_do_link).
  entregues bigint not null default 0
    constraint campaign_link_numero_entregues check (entregues >= 0),
  created_at timestamptz not null default now(),
  primary key (campaign_link_id, whatsapp_account_id),
  constraint campaign_link_numero_da_origem
    foreign key (campaign_link_id, clinic_id)
    references public.campaign_link (id, clinic_id) on delete cascade,
  constraint campaign_link_numero_do_numero
    foreign key (whatsapp_account_id, clinic_id)
    references public.whatsapp_account (id, clinic_id) on delete cascade
);

create index campaign_link_numero_da_clinica
  on public.campaign_link_numero (clinic_id);

alter table public.campaign_link_numero enable row level security;

-- Como campaign_link: membro ativo le; administrador e gestor escolhem.
create policy "membro le os numeros do link" on public.campaign_link_numero
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao escolhe os numeros do link" on public.campaign_link_numero
  for insert to authenticated
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao muda o peso do numero do link" on public.campaign_link_numero
  for update to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao tira o numero do link" on public.campaign_link_numero
  for delete to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- A sessao nunca escreve "entregues" nem troca a linha de clinica, de origem
-- ou de numero: insere so as quatro colunas e atualiza so o peso.
revoke all on table public.campaign_link_numero from anon, authenticated;
grant select, delete on table public.campaign_link_numero to authenticated;
grant insert (clinic_id, campaign_link_id, whatsapp_account_id, peso)
  on table public.campaign_link_numero to authenticated;
grant update (peso) on table public.campaign_link_numero to authenticated;

comment on table public.campaign_link_numero is
  'Os numeros de WhatsApp que o link rastreado de uma origem usa, com o peso do rodizio (1 a 10) e quantas pessoas cada um ja recebeu (entregues, so o sistema escreve). Sem linha para a origem, o link usa o numero principal da clinica. Membro ativo le; administrador e gestor escolhem.';

-- ---------------------------------------------------------------------------
-- 3) registrar_clique_do_link: o rodizio e o numero fixado
-- ---------------------------------------------------------------------------
-- Corpo de 20261116120000 com o que e novo entre os marcadores "[rodizio]".
-- A assinatura muda (p_numero_fixado no fim), entao a antiga sai antes.

drop function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text);

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

  return v_destino || jsonb_build_object('resultado', 'ok', 'codigo', v_codigo);
end;
$$;

revoke all on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid)
  to service_role;

comment on function public.registrar_clique_do_link(text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid) is
  'Redirect do link rastreado (rota publica, service role): acha a origem ativa pelo codigo publico, escolhe o numero (os escolhidos para o link, ou os da clinica; so conectados, se houver; o fixado do visitante, depois o rodizio com peso, depois o principal), grava o clique com um codigo por clique e os sinais da URL, conta o clique do dia e devolve {resultado, digitos, mensagem, codigo_fixo, numero, codigo}. Resultados: ok, sem_gravar, limite, indisponivel, sem_numero. 22023 com sinal fora do formato. So service_role.';

notify pgrst, 'reload schema';
