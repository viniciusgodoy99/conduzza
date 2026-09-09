-- Retorno de conversao a Meta, fase 1 de schema (R3+R4+R6 do docs/06,
-- Caminho B: substituir o Tintim). Decisao do dono em 09/09/2026: construir
-- registrando desde ja e ENVIANDO NADA ate a decisao D6 (LGPD) e as
-- credenciais existirem. Por isso envio_ativado nasce false e modo_user_data
-- nasce nulo: o modo de dados pessoais e configuracao, nao codigo.
--
-- Tres tabelas:
-- 1. meta_ads_account: configuracao legivel pela gestao (pixel, conta,
--    codigo de teste, interruptores).
-- 2. meta_ads_account_secret: o token da CAPI. RLS ligada e NENHUMA policy,
--    de proposito, mesmo contrato de whatsapp_account_secret: so service
--    role le e escreve.
-- 3. conversion_event: o registro interno de conversao. SEM telefone e sem
--    conteudo de mensagem, NUNCA: o hash do telefone (se a D6 permitir)
--    acontece em memoria na hora do envio. unique por (clinic, contato,
--    etapa) e a semantica do Tintim: UMA conversao por contato por etapa.

-- ---------------------------------------------------------------------------
-- 1. Conta de anuncios

create table public.meta_ads_account (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  pixel_id text,
  ad_account_id text,
  test_event_code text,
  envio_ativado boolean not null default false,
  -- ctwa_apenas: so o identificador do clique, nenhum dado pessoal.
  -- telefone_hasheado: SHA-256 do telefone, so com consentimento ativo.
  -- Nulo = a decisao D6 ainda nao foi tomada; o envio nao liga sem ela.
  modo_user_data text
    check (modo_user_data in ('ctwa_apenas', 'telefone_hasheado')),
  send_unmatched boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nao liga sem o minimo declarado. O token (outra tabela) e conferido
  -- pelo gatilho abaixo.
  constraint envio_exige_configuracao check (
    envio_ativado = false
    or (pixel_id is not null and modo_user_data is not null)
  )
);

create trigger set_updated_at
  before update on public.meta_ads_account
  for each row execute function public.set_updated_at();

alter table public.meta_ads_account enable row level security;

-- Configuracao de anuncio e assunto da gestao; recepcao e leitura nao
-- precisam dela para atender.
create policy "gestao le a conta meta" on public.meta_ads_account
  for select using (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao gerencia a conta meta" on public.meta_ads_account
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- Ligar o envio exige o token na tabela-secret. A checagem vive AQUI, nao na
-- tela: policy de gestao nao pode ser porta para ligar envio sem token.
-- SECURITY DEFINER porque a tabela-secret nao tem policy nenhuma.
create or replace function public.conferir_token_antes_de_ligar_envio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.envio_ativado and not old.envio_ativado then
    if not exists (
      select 1
        from public.meta_ads_account_secret s
       where s.clinic_id = new.clinic_id
         and s.capi_access_token is not null
    ) then
      raise exception
        'Para ligar o envio, cadastre o token da API de conversões.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Segredo do token

-- Segredos: RLS ligada e NENHUMA policy de proposito. So service role le e
-- escreve (contrato de whatsapp_account_secret).
create table public.meta_ads_account_secret (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  capi_access_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.meta_ads_account_secret
  for each row execute function public.set_updated_at();

alter table public.meta_ads_account_secret enable row level security;

-- O gatilho de ligar envio so nasce depois da tabela-secret existir.
create trigger conferir_token_antes_de_ligar_envio
  before update on public.meta_ads_account
  for each row execute function public.conferir_token_antes_de_ligar_envio();

-- ---------------------------------------------------------------------------
-- 3. Registro de conversao

create table public.conversion_event (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  -- A chave da etapa NO MOMENTO do registro. Nao e FK para funnel_stage_def
  -- de proposito: excluir uma etapa livre depois nao pode apagar o registro
  -- historico de conversao.
  stage_chave text not null,
  event_name text not null,
  -- Dedupe na Meta: event_id + event_name identificam o evento la. Reenviar
  -- apos resposta perdida e seguro por causa desta coluna.
  event_id uuid not null default gen_random_uuid() unique,
  value_cents integer check (value_cents is null or value_cents >= 0),
  currency text not null default 'BRL',
  -- Snapshot do contato no momento do registro (a captura e primeiro clique
  -- vence, mas o snapshot congela o que valia aqui).
  ctwa_clid text,
  status text not null default 'registrado' check (status in
    ('registrado', 'enfileirado', 'enviado', 'falhou', 'descartado')),
  sent_at timestamptz,
  -- Codigo curto de maquina (token_invalido, fora_da_janela_capi...).
  -- NUNCA dado de paciente.
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Semantica do Tintim: UMA conversao por contato por etapa; reentrar na
  -- etapa nao redispara.
  unique (clinic_id, contact_id, stage_chave)
);

create index conversion_event_painel_idx
  on public.conversion_event (clinic_id, status);
create index conversion_event_contact_idx
  on public.conversion_event (contact_id);

create trigger set_updated_at
  before update on public.conversion_event
  for each row execute function public.set_updated_at();

alter table public.conversion_event enable row level security;

-- Membro le os registros da clinica (transparencia do painel de Resultados).
-- NENHUMA policy de escrita: quem escreve e o sistema (gatilho de funil e
-- job), por service role, como em job_queue.
create policy "membro le as conversoes da clinica" on public.conversion_event
  for select using (clinic_id in (select public.user_active_clinic_ids()));

-- ---------------------------------------------------------------------------
-- 4. Agregado do painel "Conversoes devolvidas a Meta"

-- SECURITY INVOKER: a RLS de conversion_event decide o que o usuario enxerga
-- (mesmo padrao de resultados_da_clinica). So contagens e somas, nenhum dado
-- de paciente.
create or replace function public.conversoes_devolvidas_da_clinica(
  p_clinic_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'por_status', (
      select coalesce(jsonb_object_agg(s.status, s.total), '{}'::jsonb)
        from (
          select status, count(*) as total
            from conversion_event
           where clinic_id = p_clinic_id
           group by status
        ) s
    ),
    'valor_enviado_cents', (
      select coalesce(sum(value_cents), 0)
        from conversion_event
       where clinic_id = p_clinic_id and status = 'enviado'
    ),
    'com_ctwa', (
      select count(*)
        from conversion_event
       where clinic_id = p_clinic_id and ctwa_clid is not null
    ),
    'ultimo_envio', (
      select max(sent_at)
        from conversion_event
       where clinic_id = p_clinic_id
    )
  );
$$;
