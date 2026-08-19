-- Tarefa 0.4: nucleo e acesso (docs/04 secao 1 + audit_log da secao 8).
-- Regra do projeto: tabela de negocio nasce com clinic_id not null, RLS
-- habilitada e policy na MESMA migration. Excecoes documentadas: audit_log tem
-- clinic_id nullable de proposito (acao do dono do produto e cross-clinic) e
-- product_admin e o acesso global do dono do produto, fora de clinic_member.

-- ---------------------------------------------------------------------------
-- Funcao utilitaria de updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.clinic (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  timezone text not null default 'America/Fortaleza',
  spend_cap_cents integer,
  spend_cap_action text not null default 'pausar'
    check (spend_cap_action in ('pausar', 'avisar')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinic_branding (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  product_name text not null default 'Conduzza Clínicas',
  -- Identidade Conduzza como marca padrao do tenant (decisao de 19/08/2026);
  -- white-label continua valendo, cada clinica pode trocar.
  primary_color text not null default '#A8D318',
  logo_wide_light text,
  logo_wide_dark text,
  logo_icon_light text,
  logo_icon_dark text,
  labels jsonb not null default
    '{"profissional":"profissional","procedimento":"procedimento","paciente":"paciente","consulta":"consulta"}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinic_member (
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    check (role in ('admin', 'gestor', 'recepcao', 'profissional', 'leitura')),
  professional_id uuid, -- preenchido quando role = profissional (FK na Fase 2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table public.unit (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  name text not null,
  address text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trilha de auditoria (LGPD): append-only, sem update nem delete.
-- clinic_id nullable: acoes do dono do produto nao pertencem a uma clinica.
create table public.audit_log (
  id bigserial primary key,
  clinic_id uuid references public.clinic (id) on delete cascade,
  user_id uuid references auth.users (id),
  action text not null, -- leu | criou | editou | excluiu | exportou | assumiu_conversa
  entity text not null,
  entity_id uuid,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Acesso global do dono do produto (decisao registrada no plano da Fase 0).
-- Escrita somente via service role; a tela de administracao e a tarefa 5.5.
create table public.product_admin (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.clinic
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.clinic_branding
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.clinic_member
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.unit
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Funcoes auxiliares de RLS (security definer para nao recursar nas policies
-- de clinic_member; search_path fixo por seguranca)
-- ---------------------------------------------------------------------------

create or replace function public.user_clinic_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from clinic_member where user_id = auth.uid()
$$;

create or replace function public.user_has_role(p_clinic_id uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and role = any (p_roles)
  )
$$;

create or replace function public.is_product_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from product_admin where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- RLS e policies (matriz de papeis: brief de telas, secao 5)
-- ---------------------------------------------------------------------------

alter table public.clinic enable row level security;
alter table public.clinic_branding enable row level security;
alter table public.clinic_member enable row level security;
alter table public.unit enable row level security;
alter table public.audit_log enable row level security;
alter table public.product_admin enable row level security;

-- clinic: membro le a propria clinica; admin da clinica edita; criacao e
-- exclusao ficam sem policy (somente service role, fluxo do dono do produto).
create policy "membro le a propria clinica" on public.clinic
  for select using (
    id in (select public.user_clinic_ids()) or public.is_product_admin()
  );

create policy "admin da clinica edita a clinica" on public.clinic
  for update using (public.user_has_role(id, array['admin']))
  with check (public.user_has_role(id, array['admin']));

-- clinic_branding: membro le (o layout precisa), admin escreve.
create policy "membro le o branding" on public.clinic_branding
  for select using (
    clinic_id in (select public.user_clinic_ids()) or public.is_product_admin()
  );

create policy "admin cria o branding" on public.clinic_branding
  for insert with check (public.user_has_role(clinic_id, array['admin']));

create policy "admin edita o branding" on public.clinic_branding
  for update using (public.user_has_role(clinic_id, array['admin']))
  with check (public.user_has_role(clinic_id, array['admin']));

-- clinic_member: membro ve o time da propria clinica; admin gerencia.
create policy "membro ve o time da clinica" on public.clinic_member
  for select using (
    clinic_id in (select public.user_clinic_ids()) or public.is_product_admin()
  );

create policy "admin adiciona membro" on public.clinic_member
  for insert with check (public.user_has_role(clinic_id, array['admin']));

create policy "admin edita membro" on public.clinic_member
  for update using (public.user_has_role(clinic_id, array['admin']))
  with check (public.user_has_role(clinic_id, array['admin']));

create policy "admin remove membro" on public.clinic_member
  for delete using (public.user_has_role(clinic_id, array['admin']));

-- unit: membro le; admin e gestor escrevem (matriz: gestor tem tudo em Cadastros).
create policy "membro le unidades" on public.unit
  for select using (
    clinic_id in (select public.user_clinic_ids()) or public.is_product_admin()
  );

create policy "admin e gestor criam unidade" on public.unit
  for insert with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "admin e gestor editam unidade" on public.unit
  for update using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "admin e gestor removem unidade" on public.unit
  for delete using (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- audit_log: trilha imutavel. Admin e gestor leem a da propria clinica;
-- qualquer membro insere na propria clinica; dono do produto insere acoes
-- globais (clinic_id null). Sem policy de update ou delete.
create policy "admin e gestor leem a trilha" on public.audit_log
  for select using (
    (clinic_id is not null
      and public.user_has_role(clinic_id, array['admin', 'gestor']))
    or public.is_product_admin()
  );

create policy "membro registra na trilha" on public.audit_log
  for insert with check (
    (clinic_id is not null and clinic_id in (select public.user_clinic_ids()))
    or (clinic_id is null and public.is_product_admin())
  );

-- product_admin: cada um ve so o proprio registro; escrita so via service role.
create policy "ve o proprio registro" on public.product_admin
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------

create index on public.clinic_member (user_id);
create index on public.unit (clinic_id) where active = true;
create index on public.audit_log (clinic_id, created_at desc);
