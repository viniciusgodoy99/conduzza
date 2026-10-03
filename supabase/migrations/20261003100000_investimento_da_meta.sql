-- ---------------------------------------------------------------------------
-- Investimento da Meta, banco (Fase 4 do plano "Metricas do design", 03/10/2026)
-- ---------------------------------------------------------------------------
-- O QUE FAZ: guarda o investimento lido da conta de anuncios da Meta da
-- clinica (por anuncio e por dia, mais o total da conta), o mapa anuncio ->
-- campanha e a situacao da leitura, e cria o job sincronizar_gasto_meta com
-- as funcoes que o enfileiram e gravam o resultado. Contrato fechado em
-- scratchpad/fase4/critica.md, secao 4.1.
--
-- 1. meta_ads_account_secret ganha insights_access_token (token de leitura,
--    coluna propria, sem cair sozinho no token da CAPI: C1). A tabela perde
--    TODOS os grants de anon e authenticated (antes a protecao era so a RLS
--    sem policy; o TRUNCATE ignorava a RLS). So a service role le e escreve.
-- 2. meta_ads_account.ad_account_id passa a ser sempre act_<digitos> (CHECK;
--    0 linhas em producao em 02/10). A action normaliza antes de gravar.
-- 3. Quatro tabelas, todas escritas SO pelo sistema (service role ou as
--    funcoes SECURITY DEFINER abaixo); a sessao nao tem INSERT, UPDATE nem
--    DELETE nelas:
--    - meta_gasto_leitura: situacao da leitura (tabela propria, C2: em
--      meta_ads_account a policy FOR ALL da gestao deixaria forjar
--      "funcionando" pela API). Admin e gestor leem.
--    - meta_gasto_diario: gasto por anuncio e por dia (dia no fuso da CONTA).
--      Admin e gestor leem. Chave sem a conta, com a coluna ad_account_id
--      (C3): trocar de conta apaga as linhas da conta antiga na regravacao.
--    - meta_gasto_conta_diario: total da conta por dia (level=account, C18),
--      que e o numerador do custo por lead. Admin e gestor leem.
--    - meta_anuncio: anuncio -> campanha, SEM dinheiro. Todo membro ativo le
--      (C4), para a recepcao ver os leads de anuncio na mesma campanha que a
--      gestao ve.
-- 4. job_queue aceita sincronizar_gasto_meta, com no maximo UM job vivo
--    (pendente ou executando) por clinica (indice unico parcial).
-- 5. Funcoes (todas SECURITY DEFINER, search_path vazio, EXECUTE so da
--    service_role):
--    - enfileirar_sincronizacao_de_gasto_meta: o "Atualizar agora", o teste
--      que deu certo e o diario passam por aqui (dedupe, 10 minutos entre
--      pedidos manuais, pausa, clinica de teste).
--    - enfileirar_gasto_meta_do_dia: o diario, 06:00 no fuso da clinica, ate
--      3 clinicas por passagem, chamado por motor_manutencao.
--    As duas aceitam p_incluir_teste (padrao false), no molde de
--    planejar_automacoes_de_fluxo: so os testes de integracao o usam, para
--    exercitar o caminho real com a clinica SEMPRE de teste (o claim e o
--    motor_manutencao de producao nunca a enxergam). O diario so inclui
--    clinica de teste que esteja na lista p_clinic_ids.
--    - regravar_gasto_meta: grava o que o job leu numa transacao so (confere
--      a posse do job e se a configuracao mudou pelo sha256 do token).
--    - registrar_falha_do_gasto_meta: grava o problema da leitura.
--    Nenhuma funcao devolve o token (C14): o job le o segredo pelo cliente de
--    servico e manda so o sha256 dele para conferir.
-- 6. Gatilho em meta_ads_account: trocar a conta (UPDATE do ad_account_id,
--    ou apagar e criar de novo) volta a leitura para 'nao_testada' e limpa o
--    problema (C13). Nunca bloqueia a gravacao da conta.
-- 7. motor_manutencao: corpo de PRODUCAO (pg_get_functiondef em 03/10/2026;
--    a ultima definicao em arquivo e a 20261002130000_automacoes_de_fluxo.sql)
--    com o que e novo entre os marcadores "[gasto meta]". Fora deles,
--    identico (o ensaio confere).
--
-- Nada aqui toca dado de paciente nem conteudo de mensagem. O valor do token
-- nunca vai para log, last_error nem retorno de funcao.
--
-- ROLLBACK (manual): drop das 4 tabelas e das 4 funcoes, drop do indice
-- job_queue_gasto_meta_vivo, recriar job_queue_kind_check sem o tipo novo
-- (antes, cancelar os jobs do tipo), drop da constraint ad_account_id_formato,
-- drop da coluna insights_access_token, reaplicar motor_manutencao de
-- 20261002130000 e, se quiser voltar os grants, grant all em
-- meta_ads_account_secret para anon e authenticated (nao recomendado).

-- ---------------------------------------------------------------------------
-- 1) Segredo e conta
-- ---------------------------------------------------------------------------

alter table public.meta_ads_account_secret
  add column insights_access_token text
    constraint insights_access_token_tamanho
    check (insights_access_token is null
           or char_length(insights_access_token) between 20 and 500);

comment on column public.meta_ads_account_secret.insights_access_token is
  'Token de leitura de anuncios (permissao ads_read na conta). Separado do token da CAPI de proposito. So a service role le e escreve; nunca volta para a tela nem para log.';

-- A RLS sem policy ja escondia as linhas; agora a sessao nem chega na tabela
-- (42501), e o TRUNCATE (que ignora RLS) deixa de existir para ela.
revoke all on table public.meta_ads_account_secret from anon, authenticated;

alter table public.meta_ads_account
  add constraint ad_account_id_formato
    check (ad_account_id is null or ad_account_id ~ '^act_[0-9]{5,20}$');

-- ---------------------------------------------------------------------------
-- 2) Situacao da leitura (so o sistema escreve)
-- ---------------------------------------------------------------------------

create table public.meta_gasto_leitura (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  -- Conta dos dados lidos (gravada so pela regravacao que deu certo).
  ad_account_id text
    check (ad_account_id is null or ad_account_id ~ '^act_[0-9]{5,20}$'),
  situacao text not null default 'nao_testada'
    check (situacao in ('nao_testada', 'funcionando', 'com_problema')),
  problema text
    check (problema in (
      'token_invalido', 'sem_permissao', 'conta_sem_acesso', 'exige_prova_do_app',
      'parametro_recusado', 'versao_descontinuada', 'consulta_pesada',
      'limite_da_meta', 'meta_indisponivel', 'resposta_invalida',
      'prazo_esgotado', 'outro'
    )),
  -- error.code bruto da Meta, para o suporte. Nunca a mensagem.
  codigo_da_meta integer,
  nome_da_conta text check (char_length(nome_da_conta) <= 200),
  moeda text check (moeda ~ '^[A-Z]{3}$'),
  fuso_da_conta text check (char_length(fuso_da_conta) <= 64),
  conta_ativa boolean,
  testada_em timestamptz,
  -- Dias no fuso da CONTA de anuncios.
  lido_desde date,
  lido_ate date,
  sincronizado_em timestamptz,
  tentado_em timestamptz,
  atualizacao_pedida_em timestamptz,
  -- Dia no fuso da CLINICA em que o diario ja enfileirou.
  ultimo_diario_dia date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint problema_so_com_problema
    check ((situacao = 'com_problema') = (problema is not null)),
  constraint janela_lida
    check (lido_desde is null or lido_ate is null or lido_desde <= lido_ate)
);

create trigger set_updated_at
  before update on public.meta_gasto_leitura
  for each row execute function public.set_updated_at();

alter table public.meta_gasto_leitura enable row level security;

create policy "gestao le a leitura do gasto meta" on public.meta_gasto_leitura
  for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

comment on table public.meta_gasto_leitura is
  'Situacao da leitura do investimento da Meta, uma linha por clinica. Escrita so pelo sistema (job, Server Action pelo cliente de servico e funcoes SECURITY DEFINER). Admin e gestor leem. A pausa do diario e situacao=com_problema com problema em token_invalido, sem_permissao, conta_sem_acesso ou exige_prova_do_app.';

-- ---------------------------------------------------------------------------
-- 3) Gasto por anuncio e por dia, e total da conta (dinheiro: so a gestao le)
-- ---------------------------------------------------------------------------

create table public.meta_gasto_diario (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]{5,20}$'),
  -- date_start do insights: dia civil NO FUSO DA CONTA.
  dia date not null,
  ad_id text not null check (ad_id ~ '^[0-9]{1,32}$'),
  adset_id text check (adset_id is null or adset_id ~ '^[0-9]{1,32}$'),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,32}$'),
  campaign_name text
    check (campaign_name is null or char_length(campaign_name) <= 400),
  -- Centesimos da moeda da conta. Nunca convertido.
  spend_cents bigint not null check (spend_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sincronizado_em timestamptz not null default now(),
  primary key (clinic_id, dia, ad_id)
);

create index meta_gasto_diario_campanha_idx
  on public.meta_gasto_diario (clinic_id, campaign_id, dia);

alter table public.meta_gasto_diario enable row level security;

create policy "gestao le o gasto da meta" on public.meta_gasto_diario
  for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

comment on table public.meta_gasto_diario is
  'Investimento lido da Meta por anuncio e por dia (dia no fuso da conta de anuncios, centesimos da moeda da conta). Regravado por janela pela funcao regravar_gasto_meta. So admin e gestor leem; ninguem escreve pela sessao.';

create table public.meta_gasto_conta_diario (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]{5,20}$'),
  dia date not null,
  spend_cents bigint not null check (spend_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  sincronizado_em timestamptz not null default now(),
  primary key (clinic_id, dia)
);

alter table public.meta_gasto_conta_diario enable row level security;

create policy "gestao le o total da conta meta" on public.meta_gasto_conta_diario
  for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

comment on table public.meta_gasto_conta_diario is
  'Total de controle da conta de anuncios por dia (insights level=account). Cobre anuncio arquivado ou apagado que some do level=ad; e o numerador do custo por lead. So admin e gestor leem.';

-- ---------------------------------------------------------------------------
-- 4) Anuncio -> campanha (sem dinheiro: todo membro ativo le)
-- ---------------------------------------------------------------------------

create table public.meta_anuncio (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  ad_id text not null check (ad_id ~ '^[0-9]{1,32}$'),
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]{5,20}$'),
  adset_id text check (adset_id is null or adset_id ~ '^[0-9]{1,32}$'),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,32}$'),
  campaign_name text
    check (campaign_name is null or char_length(campaign_name) <= 400),
  ultimo_dia_com_entrega date not null,
  atualizado_em timestamptz not null default now(),
  primary key (clinic_id, ad_id)
);

create index meta_anuncio_campanha_idx
  on public.meta_anuncio (clinic_id, campaign_id);

alter table public.meta_anuncio enable row level security;

create policy "membro ativo le os anuncios da meta" on public.meta_anuncio
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

comment on table public.meta_anuncio is
  'Mapa anuncio -> campanha da Meta, tirado dos proprios insights, sem valor nenhum. Todo membro ativo le (a recepcao agrupa os leads de anuncio pela mesma campanha que a gestao). Mantido pela regravar_gasto_meta; ninguem escreve pela sessao.';

-- Nas 4 tabelas: anon nao tem nada; authenticated so le (pela policy).
revoke all on table public.meta_gasto_leitura from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.meta_gasto_leitura from authenticated;
revoke all on table public.meta_gasto_diario from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.meta_gasto_diario from authenticated;
revoke all on table public.meta_gasto_conta_diario from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.meta_gasto_conta_diario from authenticated;
revoke all on table public.meta_anuncio from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.meta_anuncio from authenticated;

-- ---------------------------------------------------------------------------
-- 5) Fila: o tipo novo e um job vivo por clinica
-- ---------------------------------------------------------------------------

alter table public.job_queue drop constraint job_queue_kind_check;
alter table public.job_queue add constraint job_queue_kind_check check (kind in (
  'enviar_mensagem_ativa',
  'baixar_midia',
  'executar_passo_de_regua',
  'enviar_conversao_meta',
  'oferecer_lista_espera',
  'sincronizar_gasto_meta'
));

-- 'executando' entra no conjunto de proposito: o claim (pendente ->
-- executando), falhar_job e reagendar_job (-> pendente) mexem na MESMA
-- linha, sem colisao; so o INSERT disputa o indice. O PostgREST nao sabe
-- usar indice parcial em on_conflict: quem insere direto trata 23505 como
-- "ja na fila". As funcoes abaixo usam on conflict ... where.
create unique index job_queue_gasto_meta_vivo
  on public.job_queue (clinic_id)
  where kind = 'sincronizar_gasto_meta' and status in ('pendente', 'executando');

-- ---------------------------------------------------------------------------
-- 6) enfileirar_sincronizacao_de_gasto_meta
-- ---------------------------------------------------------------------------
-- Devolve {codigo} e, em 'aguarde', {liberado_em}. Codigos:
--   enfileirado       job criado agora
--   ja_na_fila        ja havia um job vivo (pendente ou executando)
--   aguarde           pedido manual menos de 10 minutos depois do anterior
--   sem_configuracao  sem conta de anuncios ou sem token de leitura
--   pausada           a Meta recusou o token ou a conta (origens diario e
--                     manual; a origem configuracao, chamada depois de um
--                     teste que deu certo, passa)
--   clinica_de_teste  clinica de teste nunca ganha job (o claim a ignora e
--                     o job pendente acenderia fila_atrasada no monitor),
--                     salvo com p_incluir_teste
-- Origens: diario (motor_manutencao), manual ("Atualizar agora") e
-- configuracao (teste de leitura que deu certo). Origem fora da lista e
-- erro de programacao: 22023.
-- p_agora existe para o teste do relogio; o job sempre nasce com run_at =
-- now() real.
-- p_incluir_teste (padrao false) e SO para os testes de integracao: a
-- clinica continua de teste o tempo todo, entao o claim de producao
-- (p_incluir_teste=false) nunca reivindica o job; quem chama adia o job e
-- apaga a clinica no fim (saude_do_motor conta pendente de qualquer
-- clinica). Server Action e motor nunca o passam.

create or replace function public.enfileirar_sincronizacao_de_gasto_meta(
  p_clinic_id uuid,
  p_origem text,
  p_agora timestamptz default now(),
  p_incluir_teste boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e_de_teste boolean;
  v_tz text;
  v_leitura public.meta_gasto_leitura%rowtype;
  v_job uuid;
begin
  if p_origem is null or p_origem not in ('diario', 'manual', 'configuracao') then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Origem de sincronização inválida.';
  end if;

  select c.e_de_teste, coalesce(c.timezone, 'America/Fortaleza')
    into v_e_de_teste, v_tz
    from public.clinic c
   where c.id = p_clinic_id;
  if not found then
    return jsonb_build_object('codigo', 'sem_configuracao');
  end if;
  if v_e_de_teste and not coalesce(p_incluir_teste, false) then
    return jsonb_build_object('codigo', 'clinica_de_teste');
  end if;

  if not exists (
    select 1
      from public.meta_ads_account a
      join public.meta_ads_account_secret s on s.clinic_id = a.clinic_id
     where a.clinic_id = p_clinic_id
       and a.ad_account_id is not null
       and s.insights_access_token is not null
  ) then
    return jsonb_build_object('codigo', 'sem_configuracao');
  end if;

  -- Serializa os pedidos da clinica (cliques simultaneos, diario junto com
  -- o botao) na linha da leitura.
  insert into public.meta_gasto_leitura (clinic_id)
  values (p_clinic_id)
  on conflict (clinic_id) do nothing;

  select * into v_leitura
    from public.meta_gasto_leitura
   where clinic_id = p_clinic_id
   for update;

  if p_origem <> 'configuracao'
     and v_leitura.situacao = 'com_problema'
     and v_leitura.problema in (
       'token_invalido', 'sem_permissao', 'conta_sem_acesso', 'exige_prova_do_app'
     )
  then
    return jsonb_build_object('codigo', 'pausada');
  end if;

  if p_origem = 'manual' then
    if v_leitura.atualizacao_pedida_em is not null
       and v_leitura.atualizacao_pedida_em > p_agora - interval '10 minutes'
    then
      return jsonb_build_object(
        'codigo', 'aguarde',
        'liberado_em', v_leitura.atualizacao_pedida_em + interval '10 minutes'
      );
    end if;
    update public.meta_gasto_leitura
       set atualizacao_pedida_em = p_agora
     where clinic_id = p_clinic_id;
  end if;

  insert into public.job_queue (clinic_id, kind, payload, max_attempts)
  values (
    p_clinic_id,
    'sincronizar_gasto_meta',
    jsonb_build_object('origem', p_origem),
    5
  )
  on conflict (clinic_id)
    where kind = 'sincronizar_gasto_meta' and status in ('pendente', 'executando')
    do nothing
  returning id into v_job;

  if p_origem = 'diario' then
    -- Inclusive no ja_na_fila: o dia esta atendido.
    update public.meta_gasto_leitura
       set ultimo_diario_dia = (p_agora at time zone v_tz)::date
     where clinic_id = p_clinic_id;
  end if;

  return jsonb_build_object(
    'codigo', case when v_job is null then 'ja_na_fila' else 'enfileirado' end
  );
end;
$$;

revoke all on function public.enfileirar_sincronizacao_de_gasto_meta(uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.enfileirar_sincronizacao_de_gasto_meta(uuid, text, timestamptz, boolean)
  to service_role;

comment on function public.enfileirar_sincronizacao_de_gasto_meta(uuid, text, timestamptz, boolean) is
  'Enfileira a leitura do investimento da Meta da clinica (job sincronizar_gasto_meta, max_attempts 5, um vivo por clinica). Devolve {codigo: enfileirado|ja_na_fila|aguarde|sem_configuracao|pausada|clinica_de_teste, liberado_em?}. Origens diario, manual (10 minutos entre pedidos) e configuracao (ignora a pausa). p_incluir_teste so para testes de integracao. So service_role.';

-- ---------------------------------------------------------------------------
-- 7) enfileirar_gasto_meta_do_dia (o diario)
-- ---------------------------------------------------------------------------
-- Clinica elegivel: nao e de teste, tem conta e token de leitura, ja foi
-- testada (situacao diferente de nao_testada), nao esta pausada, ja passou
-- das 06:00 no fuso DELA e ainda nao foi atendida no dia local. Ordem:
-- quem esta ha mais tempo sem diario primeiro; para em p_limite clinicas
-- atendidas (job criado ou ja na fila). Cada clinica num bloco proprio: um
-- fuso invalido ou uma falha de uma clinica vira raise warning e nao derruba
-- as outras. Devolve quantas clinicas foram atendidas.
-- p_clinic_ids e p_incluir_teste sao SO para os testes de integracao
-- (motor_manutencao chama sem argumentos): a lista restringe a varredura as
-- clinicas do teste (nenhuma clinica real e tocada com p_agora de mentira) e
-- clinica de teste so entra com p_incluir_teste E dentro da lista, para o
-- teste nunca criar job vivo nas clinicas de teste das outras suites.

create or replace function public.enfileirar_gasto_meta_do_dia(
  p_agora timestamptz default now(),
  p_limite integer default 3,
  p_clinic_ids uuid[] default null,
  p_incluir_teste boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_local timestamp;
  v_res jsonb;
  v_atendidas integer := 0;
  v_limite constant integer := greatest(coalesce(p_limite, 3), 0);
begin
  for r in
    select c.id, coalesce(c.timezone, 'America/Fortaleza') as tz, l.ultimo_diario_dia
      from public.clinic c
      join public.meta_ads_account a
        on a.clinic_id = c.id and a.ad_account_id is not null
      join public.meta_ads_account_secret s
        on s.clinic_id = c.id and s.insights_access_token is not null
      join public.meta_gasto_leitura l on l.clinic_id = c.id
     where (p_clinic_ids is null or c.id = any (p_clinic_ids))
       and (not c.e_de_teste
            or (coalesce(p_incluir_teste, false) and p_clinic_ids is not null))
       and l.situacao <> 'nao_testada'
       and not (
         l.situacao = 'com_problema'
         and l.problema in (
           'token_invalido', 'sem_permissao', 'conta_sem_acesso', 'exige_prova_do_app'
         )
       )
     order by l.ultimo_diario_dia nulls first, c.id
  loop
    exit when v_atendidas >= v_limite;
    begin
      v_local := p_agora at time zone r.tz;
      if v_local::time < time '06:00'
         or r.ultimo_diario_dia is not distinct from v_local::date
      then
        continue;
      end if;
      v_res := public.enfileirar_sincronizacao_de_gasto_meta(
        r.id, 'diario', p_agora, coalesce(p_incluir_teste, false)
      );
      if v_res ->> 'codigo' in ('enfileirado', 'ja_na_fila') then
        v_atendidas := v_atendidas + 1;
      end if;
    exception when others then
      raise warning 'enfileirar_gasto_meta_do_dia: clinica %, sqlstate %', r.id, sqlstate;
    end;
  end loop;
  return v_atendidas;
end;
$$;

revoke all on function public.enfileirar_gasto_meta_do_dia(timestamptz, integer, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.enfileirar_gasto_meta_do_dia(timestamptz, integer, uuid[], boolean)
  to service_role;

comment on function public.enfileirar_gasto_meta_do_dia(timestamptz, integer, uuid[], boolean) is
  'Diario do investimento da Meta: a partir das 06:00 no fuso de cada clinica, enfileira uma leitura por dia (origem diario), pulando clinica de teste, nao testada ou pausada. Para em p_limite clinicas atendidas e devolve quantas foram. Chamado por motor_manutencao sem argumentos; p_clinic_ids e p_incluir_teste so para testes de integracao (clinica de teste so entra se estiver na lista). So service_role.';

-- ---------------------------------------------------------------------------
-- 8) regravar_gasto_meta
-- ---------------------------------------------------------------------------
-- Grava o que o job leu, numa transacao so. Devolve:
--   ok               gravado
--   sem_posse        o job nao esta executando com este worker (lease
--                    perdido): nada e gravado
--   config_mudou     a conta salva nao e p_ad_account_id, ou o token salvo
--                    nao tem o sha256 recebido (a gestao trocou no meio da
--                    leitura): nada e gravado, o job reagenda
--   janela_invalida  p_desde/p_ate nulos, invertidos ou mais de 92 dias
-- Passos: posse (trava a linha do job) -> configuracao (trava conta e
-- segredo em modo compartilhado, para a troca de conta esperar o fim desta
-- gravacao) -> janela -> apaga as linhas de OUTRA conta nas 3 tabelas ->
-- apaga a janela e insere as linhas novas -> mapa anuncio -> campanha ->
-- leitura 'funcionando'. lido_desde recomeca em p_desde quando a conta mudou
-- ou quando a janela nova nao encosta na anterior (buraco de leitura);
-- senao fica o menor. lido_ate fica o maior (ou p_ate, se recomecou).
--
-- Formato das linhas (jsonb array, chaves snake_case; linha com dia fora
-- da janela e ignorada; moeda de todas = p_moeda):
--   p_por_anuncio: [{dia:'AAAA-MM-DD', ad_id, adset_id|null, campaign_id,
--                    campaign_name|null, spend_cents}]
--   p_da_conta:    [{dia:'AAAA-MM-DD', spend_cents}]
-- (dia, ad_id) repetido em p_por_anuncio, ou dia repetido em p_da_conta, e
-- erro 23505: o job deduplica antes. p_nome_da_conta vazio vira null (o tipo
-- gerado exige string).

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

comment on function public.regravar_gasto_meta(uuid, text, uuid, text, text, date, date, text, text, text, boolean, jsonb, jsonb) is
  'Grava a leitura do investimento da Meta numa transacao: confere a posse do job e a configuracao (conta e sha256 do token), apaga as linhas de outra conta, substitui a janela [p_desde, p_ate] (dias da conta), atualiza o mapa anuncio -> campanha e marca a leitura funcionando. Devolve ok|sem_posse|config_mudou|janela_invalida. So service_role.';

-- ---------------------------------------------------------------------------
-- 9) registrar_falha_do_gasto_meta
-- ---------------------------------------------------------------------------
-- Mesma posse e mesma conferencia da configuracao da regravacao: um job que
-- leu com o token velho nao pausa a clinica que acabou de salvar um token
-- novo (config_mudou). Problema fora da lista e erro de programacao: 22023.
-- p_codigo e o error.code da Meta (null quando nao houve resposta dela).
-- Nao mexe no que ja foi lido (lido_desde, lido_ate, sincronizado_em).

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
      and j.kind = 'sincronizar_gasto_meta'
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
  'Grava o problema da leitura do investimento da Meta (situacao com_problema, codigo da Meta sem a mensagem), com a mesma posse e conferencia de configuracao da regravar_gasto_meta. Devolve ok|sem_posse|config_mudou. So service_role.';

-- ---------------------------------------------------------------------------
-- 10) Troca de conta volta a leitura para 'nao_testada'
-- ---------------------------------------------------------------------------
-- A gestao grava meta_ads_account direto pela API (policy FOR ALL), entao a
-- regra vive no banco: trocar o ad_account_id, ou apagar a linha e criar de
-- novo, exige testar de novo (o diario so roda depois do teste) e tira a
-- pausa. SECURITY DEFINER porque meta_gasto_leitura nao tem policy de
-- escrita. Nunca bloqueia a gravacao da conta: erro vira raise warning. Os
-- dados da conta antiga ficam ate a primeira regravacao da conta nova, que
-- os apaga.

create or replace function public.reiniciar_leitura_do_gasto_meta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
begin
  if tg_op = 'DELETE' then
    v_clinic_id := old.clinic_id;
  else
    v_clinic_id := new.clinic_id;
  end if;
  begin
    update public.meta_gasto_leitura
       set situacao = 'nao_testada',
           problema = null,
           codigo_da_meta = null
     where clinic_id = v_clinic_id
       and (situacao <> 'nao_testada' or problema is not null or codigo_da_meta is not null);
  exception when others then
    raise warning 'reiniciar_leitura_do_gasto_meta: sqlstate %', sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.reiniciar_leitura_do_gasto_meta()
  from public, anon, authenticated;

create trigger reiniciar_leitura_do_gasto_meta
  after update of ad_account_id on public.meta_ads_account
  for each row
  when (old.ad_account_id is distinct from new.ad_account_id)
  execute function public.reiniciar_leitura_do_gasto_meta();

create trigger reiniciar_leitura_do_gasto_meta_ao_criar_ou_apagar
  after insert or delete on public.meta_ads_account
  for each row
  execute function public.reiniciar_leitura_do_gasto_meta();

-- ---------------------------------------------------------------------------
-- 11) motor_manutencao
-- ---------------------------------------------------------------------------
-- Corpo de PRODUCAO (pg_get_functiondef em 03/10/2026; a ultima definicao em
-- arquivo e a 20261002130000_automacoes_de_fluxo.sql) com o que e novo entre
-- os marcadores "[gasto meta]". Fora deles, identico (o ensaio confere). O
-- codigo curto gasto_meta:<sqlstate> cai em planner_erro como os outros, e o
-- monitor responde 503 planner_com_erro. Grants mantidos pelo CREATE OR
-- REPLACE (postgres e service_role).

create or replace function public.motor_manutencao()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  );
end;
$function$;
