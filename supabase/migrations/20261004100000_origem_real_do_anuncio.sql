-- ---------------------------------------------------------------------------
-- Origem real do lead de anuncio, banco (04/10/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 04/10/2026 ("tire realmente da Meta"). Decisao D3: o lead
-- de anuncio Click-to-WhatsApp ganha origem gravada (canal trafego_pago,
-- origem Meta, meio = plataforma Facebook ou Instagram quando o canal
-- informar, metodo anuncio_ctwa). Campanha e conjunto vem da Meta pelo id do
-- anuncio e NUNCA entram em source_campaign: a fonte unica e meta_anuncio,
-- casada por source_ad_id. Contrato fechado em scratchpad/origem/critica.md,
-- secao 2, frente A.
--
-- 1. contact: contact_source_method_valido aceita anuncio_ctwa; o CHECK novo
--    contact_origem_de_anuncio_coerente exige, com esse metodo, canal
--    trafego_pago, origem Meta, meio Facebook, Instagram ou nulo e
--    source_campaign nulo (D3; com IS NOT DISTINCT FROM: CHECK com NULL
--    passaria).
-- 2. proteger_atribuicao_de_anuncio passa a vigiar source_method: a sessao
--    que tenta gravar anuncio_ctwa recebe 42501 (o sistema continua livre;
--    reenviar o valor que ja estava gravado passa). Os ids do anuncio seguem
--    como na Fase 4: a sessao nao os escreve (INSERT zera, UPDATE preserva).
-- 3. meta_anuncio: ultimo_dia_com_entrega aceita nulo (anuncio resolvido pela
--    consulta por id, sem gasto lido); colunas novas adset_name e ad_name
--    (ate 400), origem ('insights' ou 'consulta': quem CRIOU a linha) e
--    consultado_em (ultima consulta por id; nulo = nunca consultado).
-- 4. Tabela meta_anuncio_recusado: as recusas da Meta por anuncio, que valem
--    so para a MESMA conta e o MESMO token (sha256). Trocar um dos dois
--    libera nova tentativa. RLS ligada, nenhuma policy e nenhum grant para
--    anon e authenticated: so o sistema le e escreve.
-- 5. job_queue aceita resolver_anuncio_meta, um job vivo por clinica.
-- 6. regravar_gasto_meta: linha antiga com ultimo_dia_com_entrega nulo (so da
--    consulta) recebe o nome do insights. Nao mexe em adset_name, ad_name,
--    origem nem consultado_em.
-- 7. registrar_falha_do_gasto_meta aceita a posse de um job
--    resolver_anuncio_meta: token ou permissao recusados na resolucao pausam
--    a leitura igual ao gasto (sem isso o job do resolvedor so receberia
--    sem_posse).
-- 8. campanhas_do_periodo: o nome da campanha prefere a linha com entrega
--    (ultimo_dia_com_entrega desc NULLS LAST; no Postgres DESC poe nulo
--    primeiro).
-- 9. Funcoes do resolvedor (SECURITY DEFINER, search_path vazio, EXECUTE so
--    da service_role):
--    - anuncios_meta_a_resolver: lista os anuncios pendentes da clinica;
--    - enfileirar_resolucao_de_anuncios_meta: ingestao, fim do gasto e teste
--      de leitura passam por aqui;
--    - gravar_resolucao_de_anuncios_meta: grava o que o job leu da Meta.
-- 10. Correcao dos contatos de anuncio ja existentes (8 em producao em
--    04/10): UPDATE condicionado e idempotente, sem plataforma, so com
--    ctwa_clid (id de anuncio sem clique pode ser post).
--
-- Anuncio pendente: source_ad_id numerico de contato da clinica sem linha em
-- meta_anuncio, ou com linha nunca consultada por id (linha so do insights,
-- sem o nome do conjunto), e sem recusa valida (mesma conta, mesmo token e
-- nova tentativa ainda no futuro ou nunca).
--
-- Funcoes recriadas (proteger_atribuicao_de_anuncio, regravar_gasto_meta,
-- registrar_falha_do_gasto_meta, campanhas_do_periodo): corpo de PRODUCAO
-- (pg_get_functiondef em 04/10/2026, igual ao das migrations
-- 20261003100000 e 20261003110000) com o que e novo entre os marcadores
-- "[origem real]" ou na unica linha trocada. O ensaio confere.
--
-- Nada aqui grava dado de paciente em log; o token nunca sai do banco (as
-- funcoes so comparam o sha256).
--
-- ROLLBACK (manual): cancelar os jobs resolver_anuncio_meta; drop das 3
-- funcoes novas, da tabela meta_anuncio_recusado e do indice
-- job_queue_resolver_anuncio_meta_vivo; recriar job_queue_kind_check sem o
-- tipo novo; reaplicar proteger_atribuicao_de_anuncio (e o gatilho) e
-- campanhas_do_periodo de 20261003110000, regravar_gasto_meta e
-- registrar_falha_do_gasto_meta de 20261003100000; apagar de meta_anuncio as
-- linhas com origem 'consulta' e ultimo_dia_com_entrega nulo, depois as
-- colunas novas e voltar o NOT NULL. A origem gravada nos contatos NAO volta
-- (o gatilho impedir_reatribuicao_de_origem a preserva para sempre).

-- ---------------------------------------------------------------------------
-- 1) contact: metodo anuncio_ctwa e coerencia da origem de anuncio
-- ---------------------------------------------------------------------------

alter table public.contact
  drop constraint contact_source_method_valido,
  add constraint contact_source_method_valido check (
    source_method is null or source_method in (
      'link_token', 'mensagem_padrao', 'palavra_chave', 'manual', 'importacao',
      'anuncio_ctwa'
    )
  ),
  add constraint contact_origem_de_anuncio_coerente check (
    source_method is distinct from 'anuncio_ctwa'
    or (
      source_channel is not distinct from 'trafego_pago'
      and source_origin is not distinct from 'Meta'
      and (source_medium is null or source_medium in ('Facebook', 'Instagram'))
      -- D3: campanha e conjunto nunca em source_campaign (fonte unica:
      -- meta_anuncio por source_ad_id). A origem e imutavel: o banco recusa
      -- em vez de gravar errado para sempre.
      and source_campaign is null
    )
  );

comment on constraint contact_origem_de_anuncio_coerente on public.contact is
  'Origem de anuncio Click-to-WhatsApp (source_method anuncio_ctwa): canal trafego_pago, origem Meta, meio = plataforma (Facebook, Instagram ou nulo quando o canal nao informa) e source_campaign nulo. Campanha e conjunto vem de meta_anuncio por source_ad_id.';

-- ---------------------------------------------------------------------------
-- 2) A sessao nao forja lead de anuncio
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
  before insert or update of ctwa_clid, source_ad_id, source_adset_id, source_campaign_id, source_method
  on public.contact
  for each row execute function public.proteger_atribuicao_de_anuncio();

-- ---------------------------------------------------------------------------
-- 3) meta_anuncio: anuncio resolvido por id, conjunto e nome do anuncio
-- ---------------------------------------------------------------------------

alter table public.meta_anuncio
  alter column ultimo_dia_com_entrega drop not null,
  add column adset_name text
    check (adset_name is null or char_length(adset_name) <= 400),
  add column ad_name text
    check (ad_name is null or char_length(ad_name) <= 400),
  add column origem text not null default 'insights'
    check (origem in ('insights', 'consulta')),
  add column consultado_em timestamptz,
  -- Sem dia de entrega so a linha criada pela consulta por id (a regravacao
  -- sempre grava o dia, e o greatest nunca o apaga).
  add constraint meta_anuncio_sem_entrega_so_da_consulta
    check (ultimo_dia_com_entrega is not null or origem = 'consulta'),
  add constraint meta_anuncio_consulta_tem_hora
    check (origem <> 'consulta' or consultado_em is not null);

comment on column public.meta_anuncio.ultimo_dia_com_entrega is
  'Dia (fuso da conta) mais recente com entrega lida pelo insights. Nulo so na linha criada pela consulta por id (anuncio sem gasto lido): campanhas_do_periodo a poe por ultimo ao escolher o nome.';
comment on column public.meta_anuncio.adset_name is
  'Nome do conjunto informado pela Meta na consulta por id. A regravacao do gasto nao mexe.';
comment on column public.meta_anuncio.ad_name is
  'Nome do anuncio informado pela Meta na consulta por id. A regravacao do gasto nao mexe.';
comment on column public.meta_anuncio.origem is
  'Quem criou a linha: insights (regravar_gasto_meta) ou consulta (gravar_resolucao_de_anuncios_meta). Nao muda depois.';
comment on column public.meta_anuncio.consultado_em is
  'Ultima consulta do anuncio pelo id (gravar_resolucao_de_anuncios_meta). Nulo: nunca consultado (o anuncio continua pendente para ganhar o nome do conjunto).';
comment on table public.meta_anuncio is
  'Mapa anuncio -> campanha e conjunto da Meta, sem valor nenhum. Todo membro ativo le (a recepcao agrupa os leads de anuncio pela mesma campanha que a gestao). Mantido pela regravar_gasto_meta (insights) e pela gravar_resolucao_de_anuncios_meta (consulta por id); ninguem escreve pela sessao.';

-- ---------------------------------------------------------------------------
-- 4) Recusas da Meta por anuncio (so o sistema)
-- ---------------------------------------------------------------------------

create table public.meta_anuncio_recusado (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  ad_id text not null check (ad_id ~ '^[0-9]{1,32}$'),
  motivo text not null
    check (motivo in ('sem_entrega_ainda', 'inacessivel', 'outra_conta', 'resposta_invalida')),
  -- error.code bruto da Meta, para o suporte. Nunca a mensagem.
  codigo_da_meta integer,
  -- Conta salva e sha256 do token no momento da recusa: a recusa so vale
  -- enquanto os dois forem os mesmos.
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]{5,20}$'),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  tentativas integer not null default 1 check (tentativas >= 1),
  primeira_recusa_em timestamptz not null default now(),
  recusado_em timestamptz not null default now(),
  -- Nulo: so tenta de novo quando a conta ou o token mudarem.
  tentar_de_novo_em timestamptz,
  primary key (clinic_id, ad_id),
  constraint recusa_definitiva_sem_nova_tentativa
    check (motivo in ('sem_entrega_ainda', 'resposta_invalida') or tentar_de_novo_em is null)
);

alter table public.meta_anuncio_recusado enable row level security;

-- Nenhuma policy: a sessao nao enxerga nada. E sem grant nenhum, a sessao nem
-- chega na tabela (42501), e o TRUNCATE (que ignora RLS) deixa de existir.
revoke all on table public.meta_anuncio_recusado from anon, authenticated;

comment on table public.meta_anuncio_recusado is
  'Recusas da Meta na consulta de anuncio por id (sem_entrega_ainda, inacessivel, outra_conta, resposta_invalida). Valem so para a mesma conta e o mesmo token (sha256); trocar um dos dois libera nova tentativa. Escrita e lida so pelo sistema (gravar_resolucao_de_anuncios_meta e anuncios_meta_a_resolver).';

-- ---------------------------------------------------------------------------
-- 5) Fila: o tipo novo e um job vivo por clinica
-- ---------------------------------------------------------------------------

alter table public.job_queue
  drop constraint job_queue_kind_check,
  add constraint job_queue_kind_check check (kind in (
    'enviar_mensagem_ativa',
    'baixar_midia',
    'executar_passo_de_regua',
    'enviar_conversao_meta',
    'oferecer_lista_espera',
    'sincronizar_gasto_meta',
    'resolver_anuncio_meta'
  ));

-- Mesmo molde de job_queue_gasto_meta_vivo: 'executando' entra no conjunto;
-- quem insere direto pelo PostgREST trata 23505 como "ja na fila".
create unique index job_queue_resolver_anuncio_meta_vivo
  on public.job_queue (clinic_id)
  where kind = 'resolver_anuncio_meta' and status in ('pendente', 'executando');

-- ---------------------------------------------------------------------------
-- 6) regravar_gasto_meta (corpo de producao + o ramo "[origem real]")
-- ---------------------------------------------------------------------------

create or replace function public.regravar_gasto_meta(
  p_job_id uuid,
  p_worker text,
  p_clinic_id uuid,
  p_ad_account_id text,
  p_token_sha256 text,
  p_desde date,
  p_ate date,
  p_moeda text,
  p_fuso text,
  p_nome_da_conta text,
  p_conta_ativa boolean,
  p_por_anuncio jsonb,
  p_da_conta jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta text;
  v_token text;
  v_leitura public.meta_gasto_leitura%rowtype;
  v_apagadas integer := 0;
  v_n integer;
  v_recomeca boolean;
  v_por_anuncio constant jsonb := coalesce(p_por_anuncio, '[]'::jsonb);
  v_da_conta constant jsonb := coalesce(p_da_conta, '[]'::jsonb);
begin
  -- 1. Posse
  perform 1
     from public.job_queue j
    where j.id = p_job_id
      and j.clinic_id = p_clinic_id
      and j.kind = 'sincronizar_gasto_meta'
      and j.status = 'executando'
      and j.locked_by = p_worker
    for update;
  if not found then
    return 'sem_posse';
  end if;

  -- 2. Configuracao atual
  select a.ad_account_id into v_conta
    from public.meta_ads_account a
   where a.clinic_id = p_clinic_id
   for share;
  select s.insights_access_token into v_token
    from public.meta_ads_account_secret s
   where s.clinic_id = p_clinic_id
   for share;
  if v_conta is null
     or v_token is null
     or v_conta is distinct from p_ad_account_id
     or p_token_sha256 is null
     or encode(sha256(convert_to(v_token, 'UTF8')), 'hex') <> lower(p_token_sha256)
  then
    return 'config_mudou';
  end if;

  -- 3. Janela
  if p_desde is null or p_ate is null or p_desde > p_ate or p_ate - p_desde >= 92 then
    return 'janela_invalida';
  end if;
  if jsonb_typeof(v_por_anuncio) <> 'array' or jsonb_typeof(v_da_conta) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'As linhas do investimento são inválidas.';
  end if;

  select * into v_leitura
    from public.meta_gasto_leitura
   where clinic_id = p_clinic_id
   for update;

  -- 4. Linhas de outra conta (troca de conta)
  delete from public.meta_gasto_diario
   where clinic_id = p_clinic_id and ad_account_id <> p_ad_account_id;
  get diagnostics v_n = row_count;
  v_apagadas := v_apagadas + v_n;
  delete from public.meta_gasto_conta_diario
   where clinic_id = p_clinic_id and ad_account_id <> p_ad_account_id;
  get diagnostics v_n = row_count;
  v_apagadas := v_apagadas + v_n;
  delete from public.meta_anuncio
   where clinic_id = p_clinic_id and ad_account_id <> p_ad_account_id;
  get diagnostics v_n = row_count;
  v_apagadas := v_apagadas + v_n;

  -- 5. A janela inteira e substituida (delete + insert, nao upsert: anuncio
  --    que sumiu dos insights ou gasto estornado nao pode deixar linha velha)
  delete from public.meta_gasto_diario
   where clinic_id = p_clinic_id and dia between p_desde and p_ate;
  insert into public.meta_gasto_diario (
    clinic_id, ad_account_id, dia, ad_id, adset_id, campaign_id,
    campaign_name, spend_cents, currency
  )
  select p_clinic_id, p_ad_account_id, x.dia, x.ad_id, x.adset_id, x.campaign_id,
         left(x.campaign_name, 400), x.spend_cents, p_moeda
    from jsonb_to_recordset(v_por_anuncio) as x (
           dia date, ad_id text, adset_id text, campaign_id text,
           campaign_name text, spend_cents bigint
         )
   where x.dia between p_desde and p_ate;

  delete from public.meta_gasto_conta_diario
   where clinic_id = p_clinic_id and dia between p_desde and p_ate;
  insert into public.meta_gasto_conta_diario (
    clinic_id, ad_account_id, dia, spend_cents, currency
  )
  select p_clinic_id, p_ad_account_id, x.dia, x.spend_cents, p_moeda
    from jsonb_to_recordset(v_da_conta) as x (dia date, spend_cents bigint)
   where x.dia between p_desde and p_ate;

  -- 6. Mapa anuncio -> campanha: a linha do dia mais recente de cada anuncio
  insert into public.meta_anuncio (
    clinic_id, ad_id, ad_account_id, adset_id, campaign_id, campaign_name,
    ultimo_dia_com_entrega
  )
  select distinct on (x.ad_id)
         p_clinic_id, x.ad_id, p_ad_account_id, x.adset_id, x.campaign_id,
         left(x.campaign_name, 400), x.dia
    from jsonb_to_recordset(v_por_anuncio) as x (
           dia date, ad_id text, adset_id text, campaign_id text,
           campaign_name text
         )
   where x.dia between p_desde and p_ate
   order by x.ad_id, x.dia desc
  on conflict (clinic_id, ad_id) do update
    set ad_account_id = excluded.ad_account_id,
        adset_id = coalesce(excluded.adset_id, public.meta_anuncio.adset_id),
        campaign_id = excluded.campaign_id,
        campaign_name = case
          -- [origem real] inicio
          -- Linha so da consulta por id (sem dia de entrega): vale o nome do
          -- insights. adset_name, ad_name, origem e consultado_em ficam.
          when public.meta_anuncio.ultimo_dia_com_entrega is null
            then coalesce(excluded.campaign_name, public.meta_anuncio.campaign_name)
          -- [origem real] fim
          when excluded.ultimo_dia_com_entrega >= public.meta_anuncio.ultimo_dia_com_entrega
            then coalesce(excluded.campaign_name, public.meta_anuncio.campaign_name)
          else coalesce(public.meta_anuncio.campaign_name, excluded.campaign_name)
        end,
        ultimo_dia_com_entrega = greatest(
          public.meta_anuncio.ultimo_dia_com_entrega,
          excluded.ultimo_dia_com_entrega
        ),
        atualizado_em = now();

  -- 7. Leitura
  v_recomeca := v_apagadas > 0
    or v_leitura.ad_account_id is distinct from p_ad_account_id
    or v_leitura.lido_desde is null
    or v_leitura.lido_ate is null
    or p_desde > v_leitura.lido_ate + 1;

  insert into public.meta_gasto_leitura (
    clinic_id, ad_account_id, situacao, problema, codigo_da_meta,
    nome_da_conta, moeda, fuso_da_conta, conta_ativa,
    lido_desde, lido_ate, sincronizado_em, tentado_em
  )
  values (
    p_clinic_id, p_ad_account_id, 'funcionando', null, null,
    left(nullif(btrim(p_nome_da_conta), ''), 200), p_moeda, p_fuso, p_conta_ativa,
    p_desde, p_ate, now(), now()
  )
  on conflict (clinic_id) do update
    set ad_account_id = excluded.ad_account_id,
        situacao = 'funcionando',
        problema = null,
        codigo_da_meta = null,
        nome_da_conta = excluded.nome_da_conta,
        moeda = excluded.moeda,
        fuso_da_conta = excluded.fuso_da_conta,
        conta_ativa = excluded.conta_ativa,
        lido_desde = case
          when v_recomeca then excluded.lido_desde
          else least(public.meta_gasto_leitura.lido_desde, excluded.lido_desde)
        end,
        lido_ate = case
          when v_recomeca then excluded.lido_ate
          else greatest(public.meta_gasto_leitura.lido_ate, excluded.lido_ate)
        end,
        sincronizado_em = now(),
        tentado_em = now();

  return 'ok';
end;
$$;

revoke all on function public.regravar_gasto_meta(uuid, text, uuid, text, text, date, date, text, text, text, boolean, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.regravar_gasto_meta(uuid, text, uuid, text, text, date, date, text, text, text, boolean, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7) registrar_falha_do_gasto_meta (corpo de producao; so a linha do kind)
-- ---------------------------------------------------------------------------
-- O job resolver_anuncio_meta registra a falha de token ou de permissao pela
-- mesma funcao (mesma pausa da leitura diaria). A posse continua exigindo o
-- job executando com este worker, da mesma clinica.

create or replace function public.registrar_falha_do_gasto_meta(
  p_job_id uuid,
  p_worker text,
  p_clinic_id uuid,
  p_ad_account_id text,
  p_token_sha256 text,
  p_problema text,
  p_codigo integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta text;
  v_token text;
begin
  if p_problema is null or p_problema not in (
    'token_invalido', 'sem_permissao', 'conta_sem_acesso', 'exige_prova_do_app',
    'parametro_recusado', 'versao_descontinuada', 'consulta_pesada',
    'limite_da_meta', 'meta_indisponivel', 'resposta_invalida',
    'prazo_esgotado', 'outro'
  ) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Problema de leitura inválido.';
  end if;

  perform 1
     from public.job_queue j
    where j.id = p_job_id
      and j.clinic_id = p_clinic_id
      and j.kind in ('sincronizar_gasto_meta', 'resolver_anuncio_meta')
      and j.status = 'executando'
      and j.locked_by = p_worker
    for update;
  if not found then
    return 'sem_posse';
  end if;

  select a.ad_account_id into v_conta
    from public.meta_ads_account a
   where a.clinic_id = p_clinic_id
   for share;
  select s.insights_access_token into v_token
    from public.meta_ads_account_secret s
   where s.clinic_id = p_clinic_id
   for share;
  if v_conta is null
     or v_token is null
     or v_conta is distinct from p_ad_account_id
     or p_token_sha256 is null
     or encode(sha256(convert_to(v_token, 'UTF8')), 'hex') <> lower(p_token_sha256)
  then
    return 'config_mudou';
  end if;

  insert into public.meta_gasto_leitura (
    clinic_id, situacao, problema, codigo_da_meta, tentado_em
  )
  values (p_clinic_id, 'com_problema', p_problema, p_codigo, now())
  on conflict (clinic_id) do update
    set situacao = 'com_problema',
        problema = excluded.problema,
        codigo_da_meta = excluded.codigo_da_meta,
        tentado_em = now();

  return 'ok';
end;
$$;

revoke all on function public.registrar_falha_do_gasto_meta(uuid, text, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.registrar_falha_do_gasto_meta(uuid, text, uuid, text, text, text, integer)
  to service_role;

comment on function public.registrar_falha_do_gasto_meta(uuid, text, uuid, text, text, text, integer) is
  'Grava o problema da leitura do investimento da Meta (situacao com_problema, codigo da Meta sem a mensagem), com a mesma posse e conferencia de configuracao da regravar_gasto_meta. A posse aceita job sincronizar_gasto_meta ou resolver_anuncio_meta. Devolve ok|sem_posse|config_mudou. So service_role.';

-- ---------------------------------------------------------------------------
-- 8) campanhas_do_periodo (corpo de producao; so o NULLS LAST)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 9) anuncios_meta_a_resolver
-- ---------------------------------------------------------------------------
-- Lista os anuncios pendentes da clinica para o job (e para o enfileirar).
-- Devolve {codigo: 'config_mudou'} quando a conta salva nao e
-- p_ad_account_id ou o token salvo nao tem o sha256 recebido; senao
-- {codigo: 'ok', ad_ids: [texto, ...], restantes, proxima_tentativa_em}:
--   ad_ids               ate p_limite (1 a 50, padrao 20) anuncios devidos em
--                        p_agora: nunca recusados (ou recusados com outra
--                        conta ou outro token) primeiro, depois as novas
--                        tentativas vencidas; dentro de cada grupo, o
--                        contato mais recente primeiro;
--   restantes            quantos devidos ficaram fora do limite;
--   proxima_tentativa_em a menor nova tentativa ainda no futuro (recusa
--                        valida), ou null.
-- So le: nunca muda nada.

create or replace function public.anuncios_meta_a_resolver(
  p_clinic_id uuid,
  p_ad_account_id text,
  p_token_sha256 text,
  p_limite integer default 20,
  p_agora timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conta text;
  v_token text;
  v_sha constant text := lower(p_token_sha256);
  v_limite constant integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_momento constant timestamptz := coalesce(p_agora, now());
  v_ids jsonb;
  v_devidos integer;
  v_proxima timestamptz;
begin
  select a.ad_account_id into v_conta
    from public.meta_ads_account a
   where a.clinic_id = p_clinic_id;
  select s.insights_access_token into v_token
    from public.meta_ads_account_secret s
   where s.clinic_id = p_clinic_id;
  if v_conta is null
     or v_token is null
     or v_conta is distinct from p_ad_account_id
     or p_token_sha256 is null
     or encode(sha256(convert_to(v_token, 'UTF8')), 'hex') <> v_sha
  then
    return jsonb_build_object('codigo', 'config_mudou');
  end if;

  with anuncios as (
    select c.source_ad_id as ad_id, max(c.first_contact_at) as ultimo_contato
      from public.contact c
     where c.clinic_id = p_clinic_id
       and c.source_ad_id ~ '^[0-9]{1,32}$'
     group by c.source_ad_id
  ),
  candidatos as (
    select an.ad_id,
           an.ultimo_contato,
           (r.ad_id is not null
            and r.ad_account_id = p_ad_account_id
            and r.token_sha256 = v_sha) as recusa_vale,
           r.tentar_de_novo_em
      from anuncios an
      left join public.meta_anuncio m
        on m.clinic_id = p_clinic_id and m.ad_id = an.ad_id
      left join public.meta_anuncio_recusado r
        on r.clinic_id = p_clinic_id and r.ad_id = an.ad_id
     -- sem linha no mapa (m.* nulo) ou linha nunca consultada por id
     where m.consultado_em is null
  ),
  devidos as (
    select cd.ad_id, cd.ultimo_contato, cd.recusa_vale
      from candidatos cd
     where not cd.recusa_vale
        or cd.tentar_de_novo_em <= v_momento
  )
  select (
           select coalesce(jsonb_agg(x.ad_id order by x.recusa_vale, x.ultimo_contato desc, x.ad_id), '[]'::jsonb)
             from (
               select d.ad_id, d.recusa_vale, d.ultimo_contato
                 from devidos d
                order by d.recusa_vale, d.ultimo_contato desc, d.ad_id
                limit v_limite
             ) x
         ),
         (select count(*)::integer from devidos),
         (select min(cd.tentar_de_novo_em)
            from candidatos cd
           where cd.recusa_vale and cd.tentar_de_novo_em > v_momento)
    into v_ids, v_devidos, v_proxima;

  return jsonb_build_object(
    'codigo', 'ok',
    'ad_ids', v_ids,
    'restantes', greatest(v_devidos - jsonb_array_length(v_ids), 0),
    'proxima_tentativa_em', v_proxima
  );
end;
$$;

revoke all on function public.anuncios_meta_a_resolver(uuid, text, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.anuncios_meta_a_resolver(uuid, text, text, integer, timestamptz)
  to service_role;

comment on function public.anuncios_meta_a_resolver(uuid, text, text, integer, timestamptz) is
  'Anuncios pendentes da clinica para a consulta por id: source_ad_id numerico de contato sem linha em meta_anuncio ou com linha nunca consultada, sem recusa valida (mesma conta, mesmo token, nova tentativa no futuro ou nunca). Devolve {codigo: ok|config_mudou, ad_ids, restantes, proxima_tentativa_em}. So le. So service_role.';

-- ---------------------------------------------------------------------------
-- 10) enfileirar_resolucao_de_anuncios_meta
-- ---------------------------------------------------------------------------
-- Devolve {codigo} e, em 'enfileirado', {run_at}. Codigos:
--   enfileirado       job criado (run_at = p_run_at, nunca no passado; ou a
--                     proxima nova tentativa, se nada esta devido agora)
--   ja_na_fila        ja havia um job vivo; se ele estava pendente para
--                     depois, e puxado para o run_at pedido
--   sem_configuracao  clinica inexistente, sem conta de anuncios ou sem token
--   pausada           a leitura do gasto esta pausada (token ou conta
--                     recusados); a origem teste (teste de leitura que deu
--                     certo) passa
--   nada_a_resolver   nenhum anuncio pendente agora nem nova tentativa
--                     marcada
--   clinica_de_teste  clinica de teste nunca ganha job, salvo com
--                     p_incluir_teste (so os testes de integracao)
-- Origens: ingestao (primeiro clique num anuncio), gasto (fim do
-- sincronizar_gasto_meta que deu certo) e teste ("Testar leitura" que deu
-- certo). Fora da lista: 22023. Job: kind resolver_anuncio_meta, payload
-- {origem}, max_attempts 5, um vivo por clinica.

create or replace function public.enfileirar_resolucao_de_anuncios_meta(
  p_clinic_id uuid,
  p_origem text,
  p_run_at timestamptz default null,
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e_de_teste boolean;
  v_conta text;
  v_token text;
  v_situacao text;
  v_problema text;
  v_momento constant timestamptz := greatest(coalesce(p_run_at, now()), now());
  v_lista jsonb;
  v_quando timestamptz;
  v_job uuid;
begin
  if p_origem is null or p_origem not in ('ingestao', 'gasto', 'teste') then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Origem da resolução de anúncios inválida.';
  end if;

  select c.e_de_teste into v_e_de_teste
    from public.clinic c
   where c.id = p_clinic_id;
  if not found then
    return jsonb_build_object('codigo', 'sem_configuracao');
  end if;
  if v_e_de_teste and not coalesce(p_incluir_teste, false) then
    return jsonb_build_object('codigo', 'clinica_de_teste');
  end if;

  select a.ad_account_id into v_conta
    from public.meta_ads_account a
   where a.clinic_id = p_clinic_id;
  select s.insights_access_token into v_token
    from public.meta_ads_account_secret s
   where s.clinic_id = p_clinic_id;
  if v_conta is null or v_token is null then
    return jsonb_build_object('codigo', 'sem_configuracao');
  end if;

  if p_origem <> 'teste' then
    select l.situacao, l.problema into v_situacao, v_problema
      from public.meta_gasto_leitura l
     where l.clinic_id = p_clinic_id;
    if v_situacao = 'com_problema'
       and v_problema in (
         'token_invalido', 'sem_permissao', 'conta_sem_acesso', 'exige_prova_do_app'
       )
    then
      return jsonb_build_object('codigo', 'pausada');
    end if;
  end if;

  v_lista := public.anuncios_meta_a_resolver(
    p_clinic_id,
    v_conta,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    1,
    v_momento
  );
  if jsonb_array_length(coalesce(v_lista -> 'ad_ids', '[]'::jsonb)) > 0 then
    v_quando := v_momento;
  elsif v_lista ->> 'proxima_tentativa_em' is not null then
    v_quando := (v_lista ->> 'proxima_tentativa_em')::timestamptz;
  else
    return jsonb_build_object('codigo', 'nada_a_resolver');
  end if;

  insert into public.job_queue (clinic_id, kind, payload, max_attempts, run_at)
  values (
    p_clinic_id,
    'resolver_anuncio_meta',
    jsonb_build_object('origem', p_origem),
    5,
    v_quando
  )
  on conflict (clinic_id)
    where kind = 'resolver_anuncio_meta' and status in ('pendente', 'executando')
    do nothing
  returning id into v_job;

  if v_job is null then
    -- Um anuncio novo nao espera a nova tentativa marcada para depois.
    update public.job_queue
       set run_at = v_quando
     where clinic_id = p_clinic_id
       and kind = 'resolver_anuncio_meta'
       and status = 'pendente'
       and run_at > v_quando;
    return jsonb_build_object('codigo', 'ja_na_fila');
  end if;

  return jsonb_build_object('codigo', 'enfileirado', 'run_at', v_quando);
end;
$$;

revoke all on function public.enfileirar_resolucao_de_anuncios_meta(uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.enfileirar_resolucao_de_anuncios_meta(uuid, text, timestamptz, boolean)
  to service_role;

comment on function public.enfileirar_resolucao_de_anuncios_meta(uuid, text, timestamptz, boolean) is
  'Enfileira a consulta por id dos anuncios pendentes da clinica (job resolver_anuncio_meta, payload {origem}, max_attempts 5, um vivo por clinica). Origens ingestao, gasto e teste (a teste ignora a pausa). Devolve {codigo: enfileirado|ja_na_fila|sem_configuracao|pausada|nada_a_resolver|clinica_de_teste, run_at?}. p_incluir_teste so para testes de integracao. So service_role.';

-- ---------------------------------------------------------------------------
-- 11) gravar_resolucao_de_anuncios_meta
-- ---------------------------------------------------------------------------
-- Grava o que o job leu da Meta, numa transacao so. Devolve:
--   ok            gravado
--   sem_posse     o job nao esta executando com este worker (nada gravado)
--   config_mudou  a conta salva nao e p_ad_account_id ou o token salvo nao
--                 tem o sha256 recebido (nada gravado)
-- Formato (jsonb array, chaves snake_case):
--   p_resolvidos: [{ad_id, ad_account_id ('act_<digitos>' ou so os digitos),
--                   campaign_id, campaign_name|null, adset_id|null,
--                   adset_name|null, ad_name|null}]
--   p_recusas:    [{ad_id, motivo: sem_entrega_ainda|inacessivel|outra_conta|
--                   resposta_invalida, codigo: inteiro|null}]
-- ad_id fora de ^[0-9]{1,32}$, motivo fora da lista, codigo nao inteiro ou
-- lista que nao e array: 22023 (erro de programacao; nada gravado).
-- Resolvido de outra conta vira recusa outra_conta; resolvido sem campanha
-- valida (ou conta ilegivel) vira recusa resposta_invalida: nunca entram no
-- mapa. Anuncio gravado no mapa perde a recusa e nunca vira recusa na mesma
-- chamada. Novas tentativas (contadas so com a mesma conta, o mesmo token e
-- o mesmo motivo; senao recomeca em 1):
--   sem_entrega_ainda  1 h, 6 h e 24 h; depois a cada 24 h ate 7 dias da
--                      primeira recusa; depois nunca
--   resposta_invalida  24 h
--   inacessivel, outra_conta  nunca (so com outra conta ou outro token)

create or replace function public.gravar_resolucao_de_anuncios_meta(
  p_job_id uuid,
  p_worker text,
  p_clinic_id uuid,
  p_ad_account_id text,
  p_token_sha256 text,
  p_resolvidos jsonb,
  p_recusas jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta text;
  v_token text;
  v_sha text;
  v_resolvidos constant jsonb := coalesce(p_resolvidos, '[]'::jsonb);
  v_recusas constant jsonb := coalesce(p_recusas, '[]'::jsonb);
  v_extra jsonb := '[]'::jsonb;
  v_gravados text[] := array[]::text[];
  r record;
  v_antiga public.meta_anuncio_recusado%rowtype;
  v_mesma boolean;
  v_tentativas integer;
  v_primeira timestamptz;
  v_proxima timestamptz;
begin
  -- 1. Posse
  perform 1
     from public.job_queue j
    where j.id = p_job_id
      and j.clinic_id = p_clinic_id
      and j.kind = 'resolver_anuncio_meta'
      and j.status = 'executando'
      and j.locked_by = p_worker
    for update;
  if not found then
    return 'sem_posse';
  end if;

  -- 2. Configuracao atual (em modo compartilhado: a troca de conta espera)
  select a.ad_account_id into v_conta
    from public.meta_ads_account a
   where a.clinic_id = p_clinic_id
   for share;
  select s.insights_access_token into v_token
    from public.meta_ads_account_secret s
   where s.clinic_id = p_clinic_id
   for share;
  if v_conta is null
     or v_token is null
     or v_conta is distinct from p_ad_account_id
     or p_token_sha256 is null
     or encode(sha256(convert_to(v_token, 'UTF8')), 'hex') <> lower(p_token_sha256)
  then
    return 'config_mudou';
  end if;
  v_sha := lower(p_token_sha256);

  -- 3. Formato
  if jsonb_typeof(v_resolvidos) <> 'array' or jsonb_typeof(v_recusas) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A resolução de anúncios é inválida.';
  end if;
  if exists (
       select 1 from jsonb_array_elements(v_resolvidos) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'ad_id', '') !~ '^[0-9]{1,32}$'
     )
     or exists (
       select 1 from jsonb_array_elements(v_recusas) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'ad_id', '') !~ '^[0-9]{1,32}$'
           or coalesce(e ->> 'motivo', '') not in (
                'sem_entrega_ainda', 'inacessivel', 'outra_conta', 'resposta_invalida'
              )
           or (e -> 'codigo' is not null
               and jsonb_typeof(e -> 'codigo') <> 'null'
               and coalesce(e ->> 'codigo', '') !~ '^-?[0-9]{1,9}$')
     )
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A resolução de anúncios é inválida.';
  end if;

  -- Serializa com a regravacao do gasto da mesma clinica (as duas mexem em
  -- meta_anuncio; a regravacao trava esta linha antes de mexer no mapa).
  perform 1
     from public.meta_gasto_leitura l
    where l.clinic_id = p_clinic_id
    for update;

  -- 4. Resolvidos: so a conta salva entra no mapa (em ordem de ad_id)
  for r in
    select distinct on (x.ad_id)
           x.ad_id,
           case
             when btrim(x.ad_account_id) ~ '^[0-9]{5,20}$' then 'act_' || btrim(x.ad_account_id)
             else btrim(x.ad_account_id)
           end as conta,
           nullif(btrim(x.adset_id), '') as adset_id,
           nullif(btrim(x.campaign_id), '') as campaign_id,
           left(nullif(btrim(x.campaign_name), ''), 400) as campaign_name,
           left(nullif(btrim(x.adset_name), ''), 400) as adset_name,
           left(nullif(btrim(x.ad_name), ''), 400) as ad_name
      from jsonb_to_recordset(v_resolvidos) as x (
             ad_id text, ad_account_id text, adset_id text, adset_name text,
             campaign_id text, campaign_name text, ad_name text
           )
     order by x.ad_id
  loop
    if r.conta is null
       or r.conta !~ '^act_[0-9]{5,20}$'
       or r.campaign_id is null
       or r.campaign_id !~ '^[0-9]{1,32}$'
       or (r.adset_id is not null and r.adset_id !~ '^[0-9]{1,32}$')
    then
      v_extra := v_extra || jsonb_build_array(jsonb_build_object(
        'ad_id', r.ad_id, 'motivo', 'resposta_invalida', 'codigo', null
      ));
    elsif r.conta <> p_ad_account_id then
      v_extra := v_extra || jsonb_build_array(jsonb_build_object(
        'ad_id', r.ad_id, 'motivo', 'outra_conta', 'codigo', null
      ));
    else
      insert into public.meta_anuncio (
        clinic_id, ad_id, ad_account_id, adset_id, campaign_id, campaign_name,
        adset_name, ad_name, ultimo_dia_com_entrega, origem, consultado_em,
        atualizado_em
      )
      values (
        p_clinic_id, r.ad_id, r.conta, r.adset_id, r.campaign_id, r.campaign_name,
        r.adset_name, r.ad_name, null, 'consulta', now(), now()
      )
      on conflict (clinic_id, ad_id) do update
        set ad_account_id = excluded.ad_account_id,
            adset_id = coalesce(excluded.adset_id, public.meta_anuncio.adset_id),
            campaign_id = excluded.campaign_id,
            campaign_name = coalesce(excluded.campaign_name, public.meta_anuncio.campaign_name),
            adset_name = coalesce(excluded.adset_name, public.meta_anuncio.adset_name),
            ad_name = coalesce(excluded.ad_name, public.meta_anuncio.ad_name),
            consultado_em = excluded.consultado_em,
            atualizado_em = now();
      v_gravados := v_gravados || r.ad_id;
    end if;
  end loop;

  -- O anuncio que entrou no mapa deixa de ser recusado.
  delete from public.meta_anuncio_recusado
   where clinic_id = p_clinic_id
     and ad_id = any (v_gravados);

  -- 5. Recusas (as informadas antes das convertidas, uma por anuncio)
  for r in
    select distinct on (y.ad_id) y.ad_id, y.motivo, y.codigo
      from (
        select x.ad_id, x.motivo, x.codigo, 1 as ordem
          from jsonb_to_recordset(v_recusas) as x (ad_id text, motivo text, codigo integer)
        union all
        select x.ad_id, x.motivo, x.codigo, 2
          from jsonb_to_recordset(v_extra) as x (ad_id text, motivo text, codigo integer)
      ) y
     where not (y.ad_id = any (v_gravados))
     order by y.ad_id, y.ordem
  loop
    select * into v_antiga
      from public.meta_anuncio_recusado ar
     where ar.clinic_id = p_clinic_id and ar.ad_id = r.ad_id
     for update;
    v_mesma := found
      and v_antiga.ad_account_id = p_ad_account_id
      and v_antiga.token_sha256 = v_sha
      and v_antiga.motivo = r.motivo;
    v_tentativas := case when v_mesma then v_antiga.tentativas + 1 else 1 end;
    v_primeira := case when v_mesma then v_antiga.primeira_recusa_em else now() end;
    v_proxima := case r.motivo
      when 'sem_entrega_ainda' then now() + case v_tentativas
                                              when 1 then interval '1 hour'
                                              when 2 then interval '6 hours'
                                              else interval '24 hours'
                                            end
      when 'resposta_invalida' then now() + interval '24 hours'
      else null
    end;
    if r.motivo = 'sem_entrega_ainda' and v_proxima > v_primeira + interval '7 days' then
      v_proxima := null;
    end if;

    insert into public.meta_anuncio_recusado (
      clinic_id, ad_id, motivo, codigo_da_meta, ad_account_id, token_sha256,
      tentativas, primeira_recusa_em, recusado_em, tentar_de_novo_em
    )
    values (
      p_clinic_id, r.ad_id, r.motivo, r.codigo, p_ad_account_id, v_sha,
      v_tentativas, v_primeira, now(), v_proxima
    )
    on conflict (clinic_id, ad_id) do update
      set motivo = excluded.motivo,
          codigo_da_meta = excluded.codigo_da_meta,
          ad_account_id = excluded.ad_account_id,
          token_sha256 = excluded.token_sha256,
          tentativas = excluded.tentativas,
          primeira_recusa_em = excluded.primeira_recusa_em,
          recusado_em = excluded.recusado_em,
          tentar_de_novo_em = excluded.tentar_de_novo_em;
  end loop;

  return 'ok';
end;
$$;

revoke all on function public.gravar_resolucao_de_anuncios_meta(uuid, text, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.gravar_resolucao_de_anuncios_meta(uuid, text, uuid, text, text, jsonb, jsonb)
  to service_role;

comment on function public.gravar_resolucao_de_anuncios_meta(uuid, text, uuid, text, text, jsonb, jsonb) is
  'Grava a consulta por id dos anuncios da Meta: confere a posse do job resolver_anuncio_meta e a configuracao (conta e sha256 do token), faz upsert em meta_anuncio (origem consulta) so do anuncio da conta salva, apaga a recusa do resolvido e grava as recusas com a proxima tentativa. Devolve ok|sem_posse|config_mudou. So service_role.';

-- ---------------------------------------------------------------------------
-- 12) Correcao dos contatos de anuncio ja existentes (D3)
-- ---------------------------------------------------------------------------
-- Idempotente e por condicao, sem id fixo: so o contato com clique de anuncio
-- (ctwa_clid, o unico sinal guardado que a Meta gera so para clique em
-- anuncio) e NENHUM campo de origem gravado. source_ad_id sem clique fica de
-- fora: a ingestao anterior a frente D grava o sourceID de qualquer
-- externalAdReply, inclusive de post (sourceType 'post'), e a origem e
-- imutavel (impedir_reatribuicao_de_origem). Origem vazia se preenche depois;
-- origem errada nao se desfaz. Grava sem plataforma (nao foi capturada).
-- source_captured_at = first_contact_at: os 8 de 04/10/2026 nasceram da
-- mensagem do anuncio (created_at = first_contact_at, conferido). Contato
-- antigo que clicar num anuncio antes da frente D ganha os ids sem origem;
-- por isso este bloco NAO deve rodar de novo depois de aplicado (a hora de
-- captura sairia falsa e permanente). Roda sem sessao (o gatilho
-- proteger_atribuicao_de_anuncio recusa anuncio_ctwa vindo da sessao). Em
-- 04/10/2026 pega 8 contatos de uma clinica; a segunda execucao nao muda nada
-- (o canal ja esta gravado).

-- [correcao dos contatos de anuncio] inicio
do $$
declare
  v_n integer;
begin
  if auth.uid() is not null then
    raise exception 'A correção da origem de anúncio roda sem sessão de usuário.';
  end if;

  update public.contact
     set source_channel = 'trafego_pago',
         source_origin = 'Meta',
         source_medium = null,
         source_method = 'anuncio_ctwa',
         source_captured_at = first_contact_at
   where source_channel is null
     and source_method is null
     and source_origin is null
     and source_medium is null
     and source_campaign is null
     and source_captured_at is null
     and ctwa_clid is not null;
  get diagnostics v_n = row_count;

  raise notice 'origem real do anuncio: % contatos corrigidos', v_n;
end $$;
-- [correcao dos contatos de anuncio] fim
