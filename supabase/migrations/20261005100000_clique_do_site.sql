-- ---------------------------------------------------------------------------
-- Clique rastreado pelo site, banco (F1 do Google, 05/10/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 04/10/2026: o anuncio do Google leva ao SITE da clinica;
-- origem e campanha reais do Google no lead, sem cadastro manual. O site
-- ganha uma linha de script (public/rastreio/v1.js) que, so em visita vinda
-- de anuncio do Google, acrescenta um codigo por clique ao texto do wa.me
-- (" [#K7Q2MX]", alfabeto de lib/domain/attribution.ts) e avisa a rota
-- publica app/api/publico/clique, que chama registrar_clique_do_site com a
-- service role. A ingestao, quando o codigo da mensagem nao casa com
-- campaign_link, chama casar_clique_do_site. Contrato em
-- scratchpad/google/critica.md, secao 2, F1.
--
-- 1. contact: colunas source_google_campaign_id e source_google_adgroup_id
--    (so digitos). contact_source_method_valido (corpo de producao em
--    04/10/2026, com anuncio_ctwa) ganha clique_site. CHECK novo
--    contact_origem_do_clique_do_site_coerente: com clique_site, canal
--    trafego_pago, origem Google, meio e source_campaign nulos; e os ids do
--    Google so existem com clique_site (o Google nunca grava ctwa_clid,
--    source_ad_id nem source_campaign_id, e a Meta nunca grava os do Google).
-- 2. proteger_atribuicao_de_anuncio (corpo de producao, o da 20261004100000)
--    ganha os blocos "[clique do site]": a sessao que tenta gravar
--    clique_site ou mudar os ids do Google recebe 42501 (reenviar o valor
--    que ja estava gravado passa); e, num contato com origem clique_site,
--    ninguem (nem o sistema) troca os ids do Google: P0001, como o gatilho
--    impedir_reatribuicao_de_origem. O gatilho passa a vigiar as duas
--    colunas novas.
-- 3. rastreio_do_site: uma linha por clinica, chave publica e rotacionavel
--    (nunca o slug nem o codigo de cadastro). Administrador e gestor leem,
--    criam a linha (so clinic_id e ativo) e ligam ou desligam (so ativo);
--    a chave nasce no banco e so troca por trocar_chave_do_rastreio.
-- 4. clique_do_site: um clique de anuncio do Google por linha, com o codigo
--    unico por clinica (nunca reaproveitado: casado fica para sempre),
--    validade de 7 dias, gclid, gbraid, wbraid (ate 512), gad_source, id da
--    campanha e do grupo (so digitos) e o host do site. Sem IP, sem user
--    agent, sem caminho da pagina (o caminho pode revelar interesse de
--    saude). gclid e identificador: RLS ligada, nenhuma policy e nenhum grant
--    para anon e authenticated; so o sistema le e escreve.
-- 5. Funcoes (SECURITY DEFINER, search_path vazio):
--    - registrar_clique_do_site (so service_role): ok, chave_invalida,
--      desligado, limite (30 por minuto por clinica), duplicado ou
--      codigo_reservado (codigo igual a token de campaign_link). Teto de
--      2.000 vivos (nao casados e no prazo) por clinica: cheio, o clique novo
--      entra e o vivo que vence primeiro sai (nunca recusa o novo; a chave e
--      publica e recusar travaria a rota por 7 dias);
--    - casar_clique_do_site (so service_role): origem_gravada, vinculado,
--      nao_achado ou expirado. So casa clique da mesma clinica, nao casado e
--      no prazo; grava a origem so em contato sem origem e sem sinal de
--      anuncio da Meta (precedencia: anuncio da Meta, codigo fixo, clique do
--      site, mensagem padrao, palavra-chave);
--    - trocar_chave_do_rastreio e situacao_do_rastreio (authenticated, com
--      checagem de papel: administrador ou gestor ativo; a situacao so
--      devolve agregados);
--    - podar_cliques_do_site (so service_role): clique nao casado sai 1 dia
--      depois de vencer; o casado perde gclid, gbraid e wbraid 90 dias depois
--      do clique.
-- 6. motor_manutencao: corpo de PRODUCAO (pg_get_functiondef em 04/10/2026,
--    o mesmo da 20261003100000) com a poda entre os marcadores
--    "[clique do site]". Fora deles, identico (o ensaio confere).
--
-- Funcoes e restricoes recriadas partem do pg_get_functiondef e do
-- pg_get_constraintdef de producao em 04/10/2026, depois da 20261004100000.
-- A origem do contato e imutavel (impedir_reatribuicao_de_origem, nao
-- tocado aqui): por isso tudo que grava origem so grava com prova.
--
-- Nada aqui grava dado de paciente em log (nenhum raise notice com dado).
--
-- ROLLBACK (manual): reaplicar motor_manutencao e proteger_atribuicao_de_anuncio
-- (e o gatilho) de 20261003100000 e 20261004100000; drop das 5 funcoes
-- novas e das tabelas clique_do_site e rastreio_do_site; recriar
-- contact_source_method_valido sem clique_site e drop dos checks
-- contact_origem_do_clique_do_site_coerente e contact_ids_do_google_validos
-- e das colunas source_google_*. Contato que ja ganhou origem clique_site
-- impede recriar o check sem o metodo: a origem e imutavel e NAO volta.

-- ---------------------------------------------------------------------------
-- 1) contact: metodo clique_site, ids do Google e coerencia
-- ---------------------------------------------------------------------------

alter table public.contact
  add column source_google_campaign_id text,
  add column source_google_adgroup_id text,
  drop constraint contact_source_method_valido,
  add constraint contact_source_method_valido check (
    source_method is null or source_method in (
      'link_token', 'mensagem_padrao', 'palavra_chave', 'manual', 'importacao',
      'anuncio_ctwa', 'clique_site'
    )
  ),
  add constraint contact_ids_do_google_validos check (
    (source_google_campaign_id is null or source_google_campaign_id ~ '^[0-9]{1,20}$')
    and (source_google_adgroup_id is null or source_google_adgroup_id ~ '^[0-9]{1,20}$')
  ),
  add constraint contact_origem_do_clique_do_site_coerente check (
    (
      source_method is distinct from 'clique_site'
      or (
        source_channel is not distinct from 'trafego_pago'
        and source_origin is not distinct from 'Google'
        -- Campanha e grupo do Google ficam nas colunas proprias, nunca em
        -- source_campaign (o nome chega na F2 pelo id). A origem e imutavel:
        -- o banco recusa em vez de gravar errado para sempre.
        and source_medium is null
        and source_campaign is null
      )
    )
    and (
      (source_google_campaign_id is null and source_google_adgroup_id is null)
      or source_method is not distinct from 'clique_site'
    )
  );

comment on column public.contact.source_google_campaign_id is
  'Id da campanha do Google Ads (gad_campaignid ou o sufixo {campaignid}) do clique no site que deu a origem. So com source_method clique_site; gravado por casar_clique_do_site junto com a origem. Nunca em source_campaign_id (que e da Meta).';
comment on column public.contact.source_google_adgroup_id is
  'Id do grupo de anuncios do Google Ads (sufixo {adgroupid}) do clique no site que deu a origem. So com source_method clique_site; gravado por casar_clique_do_site junto com a origem.';
comment on constraint contact_origem_do_clique_do_site_coerente on public.contact is
  'Origem de clique no site (source_method clique_site): canal trafego_pago, origem Google, meio e source_campaign nulos. Os ids do Google (source_google_*) so existem com clique_site.';

-- ---------------------------------------------------------------------------
-- 2) A sessao nao forja lead de anuncio nem de clique no site
-- ---------------------------------------------------------------------------

create or replace function public.proteger_atribuicao_de_anuncio()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- [clique do site] inicio
  -- Os ids do Google sao parte da origem do clique no site: gravados com
  -- ela, nem o sistema os troca (impedir_reatribuicao_de_origem nao vigia
  -- estas colunas). Mesma mensagem e mesmo codigo (P0001) daquele gatilho.
  if tg_op = 'UPDATE'
     and old.source_method is not distinct from 'clique_site'
     and (new.source_google_campaign_id is distinct from old.source_google_campaign_id
       or new.source_google_adgroup_id is distinct from old.source_google_adgroup_id)
  then
    raise exception 'A origem do contato é capturada uma vez e preservada para sempre.';
  end if;
  -- [clique do site] fim
  if auth.uid() is null then
    return new;
  end if;
  -- [origem real] inicio
  -- O metodo anuncio_ctwa so nasce pelo sistema (ingestao do anuncio ou a
  -- correcao da migration 20261004100000). Reenviar o valor que ja estava
  -- gravado passa (formulario que manda a linha inteira).
  if new.source_method is not distinct from 'anuncio_ctwa' then
    if tg_op = 'INSERT' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem de anúncio é registrada só pelo sistema.';
    elsif old.source_method is distinct from 'anuncio_ctwa' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem de anúncio é registrada só pelo sistema.';
    end if;
  end if;
  -- [origem real] fim
  -- [clique do site] inicio
  -- O metodo clique_site e os ids do Google so nascem pelo sistema
  -- (casar_clique_do_site). Reenviar o valor que ja estava gravado passa.
  if new.source_method is not distinct from 'clique_site' then
    if tg_op = 'INSERT' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem do clique no site é registrada só pelo sistema.';
    elsif old.source_method is distinct from 'clique_site' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A origem do clique no site é registrada só pelo sistema.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.source_google_campaign_id is not null
       or new.source_google_adgroup_id is not null
    then
      raise exception using errcode = 'insufficient_privilege',
        message = 'A campanha do Google é registrada só pelo sistema.';
    end if;
  elsif new.source_google_campaign_id is distinct from old.source_google_campaign_id
     or new.source_google_adgroup_id is distinct from old.source_google_adgroup_id
  then
    raise exception using errcode = 'insufficient_privilege',
      message = 'A campanha do Google é registrada só pelo sistema.';
  end if;
  -- [clique do site] fim
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
  before insert or update of ctwa_clid, source_ad_id, source_adset_id, source_campaign_id, source_method,
    source_google_campaign_id, source_google_adgroup_id
  on public.contact
  for each row execute function public.proteger_atribuicao_de_anuncio();

-- ---------------------------------------------------------------------------
-- 3) rastreio_do_site: a chave do site de cada clinica
-- ---------------------------------------------------------------------------
-- A chave vai no HTML do site (data-chave): e publica, nao e segredo. Serve
-- so para achar a clinica sem expor slug nem codigo de cadastro, e troca
-- quando a clinica quiser (a chave velha passa a dar chave_invalida). 20
-- caracteres hexadecimais (80 bits) de gen_random_uuid (gerador forte).

create table public.rastreio_do_site (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  chave text not null
    default left(md5(gen_random_uuid()::text || gen_random_uuid()::text), 20)
    check (chave ~ '^[0-9a-f]{20}$'),
  ativo boolean not null default false,
  -- Quando a chave atual nasceu (criacao da linha ou ultima troca).
  chave_trocada_em timestamptz not null default now(),
  ultimo_clique_em timestamptz,
  constraint rastreio_do_site_chave_unica unique (chave)
);

alter table public.rastreio_do_site enable row level security;

-- A sessao le a linha, cria (so clinic_id e ativo; a chave e o default) e
-- liga ou desliga (so ativo). Trocar a chave so pela RPC. Sem DELETE. Sem
-- upsert pelo PostgREST: o ON CONFLICT DO UPDATE dele grava clinic_id, que
-- nao tem grant de UPDATE (a acao faz update e, sem linha, insert).
revoke all on table public.rastreio_do_site from anon, authenticated;
grant select on table public.rastreio_do_site to authenticated;
grant insert (clinic_id, ativo) on table public.rastreio_do_site to authenticated;
grant update (ativo) on table public.rastreio_do_site to authenticated;

create policy "gestao le o rastreio do site"
  on public.rastreio_do_site
  for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao cria o rastreio do site"
  on public.rastreio_do_site
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao liga e desliga o rastreio do site"
  on public.rastreio_do_site
  for update to authenticated
  using (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  )
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

comment on table public.rastreio_do_site is
  'Rastreio do site da clinica (F1 do Google): chave publica e rotacionavel que a linha de script do site manda junto com o clique. Administrador e gestor leem, criam (clinic_id e ativo) e ligam ou desligam (ativo). A chave nasce no banco e so troca por trocar_chave_do_rastreio; ultimo_clique_em e gravado por registrar_clique_do_site.';

-- ---------------------------------------------------------------------------
-- 4) clique_do_site: os cliques de anuncio do Google (so o sistema)
-- ---------------------------------------------------------------------------

create table public.clique_do_site (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- Mesmo alfabeto e tamanho de TOKEN_ALPHABET/TOKEN_LENGTH
  -- (lib/domain/attribution.ts), em maiusculas.
  codigo text not null check (codigo ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  criado_em timestamptz not null default now(),
  valido_ate timestamptz not null default (now() + interval '7 days'),
  -- Identificadores do clique no Google (o Google nao publica o tamanho
  -- maximo; 512 de folga; o regex do Postgres nao repete mais de 255, por
  -- isso o tamanho vai no char_length). Zerados 90 dias depois do clique.
  gclid text check (gclid is null or (gclid ~ '^[A-Za-z0-9._~+/=-]+$' and char_length(gclid) <= 512)),
  gbraid text check (gbraid is null or (gbraid ~ '^[A-Za-z0-9._~+/=-]+$' and char_length(gbraid) <= 512)),
  wbraid text check (wbraid is null or (wbraid ~ '^[A-Za-z0-9._~+/=-]+$' and char_length(wbraid) <= 512)),
  gad_source text check (gad_source is null or gad_source ~ '^[A-Za-z0-9_-]{1,32}$'),
  google_campaign_id text check (google_campaign_id is null or google_campaign_id ~ '^[0-9]{1,20}$'),
  google_adgroup_id text check (google_adgroup_id is null or google_adgroup_id ~ '^[0-9]{1,20}$'),
  -- So o host (do cabecalho Origin). Nunca o caminho da pagina.
  site_host text check (site_host is null or site_host ~ '^[a-z0-9.-]{1,253}$'),
  -- Apagar o contato (LGPD) leva o clique junto.
  contact_id uuid references public.contact (id) on delete cascade,
  casado_em timestamptz,
  -- Codigo unico por clinica em qualquer estado: casado fica para sempre,
  -- entao uma mensagem encaminhada com o codigo usado nunca casa de novo.
  constraint clique_do_site_codigo_unico unique (clinic_id, codigo),
  constraint clique_do_site_validade
    check (valido_ate > criado_em and valido_ate <= criado_em + interval '7 days'),
  constraint clique_do_site_casamento
    check ((contact_id is null) = (casado_em is null)),
  -- Pelo menos um sinal do Google ao nascer. Depois de casado a poda zera
  -- gclid, gbraid e wbraid, entao o check nao vale para o casado.
  constraint clique_do_site_tem_sinal_do_google check (
    casado_em is not null
    or gclid is not null or gbraid is not null or wbraid is not null
    or gad_source is not null or google_campaign_id is not null
    or google_adgroup_id is not null
  )
);

-- Limite por minuto e cliques dos ultimos 7 dias (situacao).
create index clique_do_site_por_hora
  on public.clique_do_site (clinic_id, criado_em);
-- Teto de vivos por clinica (contagem e o que vence primeiro).
create index clique_do_site_vivos
  on public.clique_do_site (clinic_id, valido_ate)
  where contact_id is null;
-- Poda do nao casado vencido (todas as clinicas).
create index clique_do_site_vencidos
  on public.clique_do_site (valido_ate)
  where contact_id is null;
-- Poda dos identificadores do casado.
create index clique_do_site_ids_a_zerar
  on public.clique_do_site (criado_em)
  where contact_id is not null
    and (gclid is not null or gbraid is not null or wbraid is not null);
-- Apagar o contato (cascata).
create index clique_do_site_contato
  on public.clique_do_site (contact_id)
  where contact_id is not null;

alter table public.clique_do_site enable row level security;

-- Nenhuma policy e nenhum grant para anon e authenticated: a sessao nem
-- chega na tabela (42501), nenhum humano ve gclid e nao ha leitura a
-- auditar. O TRUNCATE (que ignora RLS) tambem deixa de existir.
revoke all on table public.clique_do_site from anon, authenticated;

comment on table public.clique_do_site is
  'Cliques de anuncio do Google no site da clinica (F1). Um codigo por clique, unico por clinica e nunca reaproveitado; vale 7 dias. Teto de 2.000 vivos (nao casados e no prazo) por clinica: cheio, sai o que vence primeiro. Sem IP, user agent ou caminho da pagina. Escrita e lida so pelo sistema: registrar_clique_do_site (rota publica), casar_clique_do_site (ingestao), situacao_do_rastreio (agregados) e podar_cliques_do_site (motor_manutencao: nao casado sai 1 dia depois de vencer; casado perde gclid, gbraid e wbraid 90 dias depois do clique).';

-- ---------------------------------------------------------------------------
-- 5) registrar_clique_do_site (rota publica, so service_role)
-- ---------------------------------------------------------------------------
-- A rota responde sempre 204 e valida o corpo com Zod antes (mesmos
-- formatos daqui). Ordem: chave (formato e existencia), ligado, codigo
-- reservado por campaign_link (qualquer token da clinica, ativo ou nao),
-- duplicado (o mesmo codigo em qualquer estado: o aviso repetido do mesmo
-- clique e idempotente), limite, grava e so entao confere o teto de vivos.
-- Limite: 30 cliques por minuto por clinica. A primeira contagem e sem
-- trava (enxurrada de pedidos so le); a definitiva roda com a linha do
-- rastreio travada, o que serializa os cliques da mesma clinica (uma linha
-- so por chamada: sem deadlock).
-- Teto de vivos: 2.000 nao casados e no prazo por clinica. Cheio, o clique
-- novo entra e sai o vivo que vence primeiro (o mais antigo, o que menos
-- chance tem de virar mensagem). Recusar o novo deixaria a rota travada:
-- a chave e publica (fica no HTML), 67 minutos de cliques falsos a 30 por
-- minuto enchiam o teto e todo clique real voltava limite por 7 dias, sem
-- a clinica perceber (a rota responde sempre 204) e sem a troca de chave
-- resolver. Com o despejo, a perda dura so enquanto o ataque dura (e ai o
-- limite por minuto, que e por clinica e sem IP, ja e disputado). Ordem de
-- trava: rastreio, depois clique; casar_clique_do_site trava contato,
-- depois clique, e nunca o rastreio: sem ciclo. O DELETE confere de novo
-- contact_id nulo na propria linha (READ COMMITTED reavalia na versao
-- nova): o clique casado ao mesmo tempo nao sai.
-- Dado fora do formato (codigo, ids, nenhum sinal do Google) e erro 22023:
-- a rota nunca deveria mandar. O host fora do formato vira nulo (nao e
-- essencial e nao pode custar o clique).

create or replace function public.registrar_clique_do_site(
  p_chave text,
  p_codigo text,
  p_gclid text default null,
  p_gbraid text default null,
  p_wbraid text default null,
  p_gad_source text default null,
  p_google_campaign_id text default null,
  p_google_adgroup_id text default null,
  p_site_host text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_por_minuto constant integer := 30;
  c_vivos constant integer := 2000;
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
     or coalesce(p_gclid, p_gbraid, p_wbraid, p_gad_source, p_google_campaign_id, p_google_adgroup_id) is null
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
    google_campaign_id, google_adgroup_id, site_host
  ) values (
    v_clinic, p_codigo, p_gclid, p_gbraid, p_wbraid, p_gad_source,
    p_google_campaign_id, p_google_adgroup_id, v_host
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

revoke all on function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text)
  to service_role;

comment on function public.registrar_clique_do_site(text, text, text, text, text, text, text, text, text) is
  'Grava o clique de anuncio do Google avisado pelo site (rota publica, service role). Devolve ok, chave_invalida, desligado, limite (30 por minuto por clinica), duplicado ou codigo_reservado. Teto de 2.000 vivos (nao casados e no prazo) por clinica: cheio, o clique novo entra e o vivo que vence primeiro sai. 22023 com dado fora do formato. So service_role.';

-- ---------------------------------------------------------------------------
-- 6) casar_clique_do_site (ingestao, so service_role)
-- ---------------------------------------------------------------------------
-- Numa transacao so: trava o contato (da clinica) e o clique (da mesma
-- clinica, pelo codigo). Sempre nessa ordem, uma linha de cada: sem
-- deadlock. Duas mensagens com o mesmo codigo: a segunda espera a primeira
-- e, depois dela, encontra o clique casado (nao_achado). Codigos:
-- - nao_achado: codigo fora do formato, contato de outra clinica, codigo
--   de outra clinica ou ja usado por outro contato;
-- - expirado: clique da clinica, nao casado, fora do prazo (nada muda);
-- - vinculado: o clique ficou (ou ja estava) ligado a este contato, sem
--   gravar origem (o contato ja tinha origem, campanha em texto, metodo,
--   ou sinal de anuncio da Meta, que vem antes na precedencia);
-- - origem_gravada: clique ligado e origem Trafego pago, Google, metodo
--   clique_site, com os ids da campanha e do grupo.

create or replace function public.casar_clique_do_site(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_codigo text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := upper(btrim(p_codigo));
  v_clique public.clique_do_site%rowtype;
  v_n integer;
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

  -- Origem so em contato sem origem (canal, metodo e campanha em texto
  -- nulos) e sem sinal de anuncio da Meta. A origem e imutavel: na duvida
  -- fica vazia (preenche-se depois), nunca errada.
  update public.contact c
     set source_channel = 'trafego_pago',
         source_origin = 'Google',
         source_medium = null,
         source_campaign = null,
         source_method = 'clique_site',
         source_captured_at = now(),
         source_google_campaign_id = v_clique.google_campaign_id,
         source_google_adgroup_id = v_clique.google_adgroup_id
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
    return 'origem_gravada';
  end if;
  return 'vinculado';
end;
$$;

revoke all on function public.casar_clique_do_site(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.casar_clique_do_site(uuid, uuid, text)
  to service_role;

comment on function public.casar_clique_do_site(uuid, uuid, text) is
  'Casa o codigo da mensagem com um clique do site da mesma clinica, nao casado e no prazo (ingestao, depois do codigo fixo de campaign_link). Devolve origem_gravada, vinculado, nao_achado ou expirado. Grava a origem (Trafego pago, Google, clique_site, ids da campanha e do grupo) so em contato sem origem e sem sinal de anuncio da Meta. 22023 sem clinica ou contato. So service_role.';

-- ---------------------------------------------------------------------------
-- 7) trocar_chave_do_rastreio e situacao_do_rastreio (Configuracoes)
-- ---------------------------------------------------------------------------
-- Pela sessao: administrador ou gestor ativo da clinica (e que escreve).
-- Sem sessao (auth.uid() nulo) so o sistema: service_role ou conexao direta.

create or replace function public.trocar_chave_do_rastreio(p_clinic_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text;
begin
  if p_clinic_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica obrigatória.';
  end if;
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = 'insufficient_privilege',
        message = 'Somente administradores e gestores alteram o rastreio do site.';
    end if;
  elsif not (
    public.user_has_role(p_clinic_id, array['admin', 'gestor'])
    and public.user_can_write(p_clinic_id)
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Somente administradores e gestores alteram o rastreio do site.';
  end if;

  insert into public.rastreio_do_site as r (clinic_id, chave, chave_trocada_em)
  values (
    p_clinic_id,
    left(md5(gen_random_uuid()::text || gen_random_uuid()::text), 20),
    now()
  )
  on conflict (clinic_id) do update
    set chave = excluded.chave,
        chave_trocada_em = excluded.chave_trocada_em
  returning r.chave into v_chave;

  return v_chave;
end;
$$;

revoke all on function public.trocar_chave_do_rastreio(uuid)
  from public, anon, authenticated;
grant execute on function public.trocar_chave_do_rastreio(uuid)
  to authenticated, service_role;

comment on function public.trocar_chave_do_rastreio(uuid) is
  'Gera uma chave nova para o rastreio do site da clinica (cria a linha desligada se nao existir) e devolve a chave. A chave velha passa a dar chave_invalida; cliques ja registrados continuam valendo. Administrador ou gestor ativo; 42501 para os demais.';

create or replace function public.situacao_do_rastreio(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.situacao_do_rastreio(uuid)
  from public, anon, authenticated;
grant execute on function public.situacao_do_rastreio(uuid)
  to authenticated, service_role;

comment on function public.situacao_do_rastreio(uuid) is
  'Situacao do rastreio do site, so agregados: {configurado, ativo, chave_trocada_em, ultimo_clique_em, cliques_7_dias, casados_7_dias}. Nunca a chave, gclid ou contato. Administrador ou gestor ativo; 42501 para os demais.';

-- ---------------------------------------------------------------------------
-- 8) podar_cliques_do_site (motor_manutencao, so service_role)
-- ---------------------------------------------------------------------------
-- Clique nao casado sai 1 dia depois de vencer (8 dias depois do clique).
-- O casado perde gclid, gbraid e wbraid 90 dias depois do clique (o alcance
-- do click_view do Google); a linha fica (campanha, grupo e o vinculo com o
-- contato). Ate 5.000 de cada por passagem. p_agora e p_clinic_ids so para
-- testes: data futura so com a lista de clinicas (nenhuma clinica real e
-- podada antes da hora).

create or replace function public.podar_cliques_do_site(
  p_agora timestamptz default now(),
  p_clinic_ids uuid[] default null
)
returns jsonb
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
       and (k.gclid is not null or k.gbraid is not null or k.wbraid is not null)
       and k.criado_em < v_agora - interval '90 days'
       and (p_clinic_ids is null or k.clinic_id = any (p_clinic_ids))
     limit 5000
  )
  update public.clique_do_site k
     set gclid = null,
         gbraid = null,
         wbraid = null
    from alvo
   where k.id = alvo.id;
  get diagnostics v_zerados = row_count;

  return jsonb_build_object('apagados', v_apagados, 'zerados', v_zerados);
end;
$$;

revoke all on function public.podar_cliques_do_site(timestamptz, uuid[])
  from public, anon, authenticated;
grant execute on function public.podar_cliques_do_site(timestamptz, uuid[])
  to service_role;

comment on function public.podar_cliques_do_site(timestamptz, uuid[]) is
  'Retencao dos cliques do site: apaga o nao casado 1 dia depois de vencer e zera gclid, gbraid e wbraid do casado 90 dias depois do clique. Devolve {apagados, zerados}. Chamada por motor_manutencao sem argumentos; p_agora e p_clinic_ids so para testes (data futura exige a lista). So service_role.';

-- ---------------------------------------------------------------------------
-- 9) motor_manutencao
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 04/10/2026; a ultima definicao em
-- arquivo e a 20261003100000_investimento_da_meta.sql) com o que e novo
-- entre os marcadores "[clique do site]". Fora deles, identico (o ensaio
-- confere). O codigo curto cliques_do_site:<sqlstate> cai em planner_erro
-- como os outros. Grants mantidos pelo CREATE OR REPLACE (postgres e
-- service_role).

CREATE OR REPLACE FUNCTION public.motor_manutencao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] inicio
  v_automacoes jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] fim
  -- [gasto meta] inicio
  v_gasto integer := 0;
  -- [gasto meta] fim
  -- [clique do site] inicio
  v_cliques jsonb := '{}'::jsonb;
  -- [clique do site] fim
begin
  begin
    select limpar_holds_vencidos() into v_holds;
  exception when others then
    v_erros := v_erros || ('limpar_holds:' || sqlstate);
  end;

  begin
    select fechar_runs_orfas() into v_orfas;
  exception when others then
    v_erros := v_erros || ('fechar_runs_orfas:' || sqlstate);
  end;

  -- Janela de reoferta vencida vira 'expirada' e a proxima onda parte (4.9).
  begin
    select expirar_ofertas_de_espera() into v_ofertas;
  exception when others then
    v_erros := v_erros || ('expirar_ofertas:' || sqlstate);
  end;

  -- [automacoes de fluxo] inicio
  -- Automacoes de fluxo (02/10/2026): registra as regras de tempo vencidas
  -- e executa as pendentes (um salto por passagem). Antes das reguas, para o
  -- follow-up da etapa para onde a automacao moveu ja nascer nesta passagem.
  begin
    v_automacoes := jsonb_build_object('planejadas', planejar_automacoes_de_fluxo());
  exception when others then
    v_erros := v_erros || ('planejar_automacoes:' || sqlstate);
  end;

  begin
    v_automacoes := v_automacoes || executar_automacoes_de_fluxo();
  exception when others then
    v_erros := v_erros || ('executar_automacoes:' || sqlstate);
  end;

  -- [automacoes de fluxo] fim
  begin
    select planejar_reguas() into v_reguas;
  exception when others then
    v_erros := v_erros || ('planejar_reguas:' || sqlstate);
  end;

  -- [gasto meta] inicio
  -- Investimento da Meta (Fase 4, 03/10/2026): a partir das 06:00 no fuso de
  -- cada clinica, enfileira uma leitura do gasto por dia (ate 3 clinicas por
  -- passagem). Cada clinica erra sozinha dentro da funcao (raise warning);
  -- aqui so chega erro estrutural, que vira gasto_meta:<sqlstate> no
  -- planner_erro como as outras rotinas.
  begin
    v_gasto := enfileirar_gasto_meta_do_dia();
  exception when others then
    v_erros := v_erros || ('gasto_meta:' || sqlstate);
  end;

  -- [gasto meta] fim
  -- [clique do site] inicio
  -- Clique rastreado pelo site (F1 do Google, 05/10/2026): o clique nao
  -- casado sai 1 dia depois de vencer e o casado perde gclid, gbraid e
  -- wbraid 90 dias depois do clique. Erro vira cliques_do_site:<sqlstate>.
  begin
    v_cliques := podar_cliques_do_site();
  exception when others then
    v_erros := v_erros || ('cliques_do_site:' || sqlstate);
  end;

  -- [clique do site] fim
  -- Higiene: as linhas de hostname:pid da VPS, que reiniciava a cada 1 a 2
  -- minutos e nada podava.
  begin
    delete from worker_heartbeat
    where worker_id not in ('motor-fila', 'motor-planner')
      and batida_em < now() - interval '1 hour';
  exception when others then
    v_erros := v_erros || ('higiene:' || sqlstate);
  end;

  -- Reafirma a privacidade do balde de midia (de hora em hora basta, mas
  -- rodar sempre e barato e nao depende de mais um agendamento).
  begin
    update storage.buckets set public = false
    where id = 'midia-conversas' and public is distinct from false;
  exception when others then
    v_erros := v_erros || ('balde:' || sqlstate);
  end;

  insert into worker_heartbeat (worker_id, batida_em, ultimo_lote, ultimo_erro, ultimo_erro_em)
  values (
    'motor-planner',
    now(),
    v_holds + v_orfas + v_ofertas,
    case when array_length(v_erros, 1) is null then null
         else array_to_string(v_erros, ',') end,
    case when array_length(v_erros, 1) is null then null else now() end
  )
  on conflict (worker_id) do update
  set batida_em = now(),
      ultimo_lote = excluded.ultimo_lote,
      ultimo_erro = excluded.ultimo_erro,
      ultimo_erro_em = coalesce(excluded.ultimo_erro_em, worker_heartbeat.ultimo_erro_em);

  return jsonb_build_object(
    'holds', v_holds,
    'runs_orfas', v_orfas,
    'ofertas_expiradas', v_ofertas,
    'reguas', v_reguas,
    'erros', v_erros
    -- [automacoes de fluxo] inicio
    , 'automacoes', v_automacoes
    -- [automacoes de fluxo] fim
    -- [gasto meta] inicio
    , 'gasto_meta', v_gasto
    -- [gasto meta] fim
    -- [clique do site] inicio
    , 'cliques_do_site', v_cliques
    -- [clique do site] fim
  );
end;
$function$;
