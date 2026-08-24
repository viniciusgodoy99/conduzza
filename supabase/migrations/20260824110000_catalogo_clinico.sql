-- Fase 2, tarefa 2.1: catalogo clinico (docs/04 secao 2), com RLS.
--
-- Oito tabelas: profissionais, jornada semanal, bloqueios, recursos,
-- procedimentos, convenios, a matriz de vinculo de tres pontas e pacotes.
-- Revisadas pela convencao da casa: created_at/updated_at + trigger em tudo,
-- indice em toda FK, RLS e policies NA MESMA migration.
--
-- Papeis (matriz do brief secao 5): TODO membro ativo LE o catalogo (a
-- recepcao precisa de preco e duracao para atender; a IA le por service
-- role); escrita e SO de administrador e gestor.

-- ---------------------------------------------------------------------------
-- Profissionais
-- ---------------------------------------------------------------------------

create table public.professional (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  name text not null,
  photo_url text,
  -- Campo LIVRE de proposito (CRM, CRO, CREFITO, CRBM, CRN, ou nulo para
  -- esteticista sem conselho). Nunca dropdown fechado: spec 3.1.
  council_type text,
  council_number text,
  specialties text[] not null default '{}',
  calendar_color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Jornada semanal por faixas. Almoco = DUAS faixas no mesmo weekday (decisao
-- do dono em 24/08/2026); bloqueio e para evento pontual, nunca recorrente.
create table public.professional_schedule (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  professional_id uuid not null references public.professional (id) on delete cascade,
  unit_id uuid references public.unit (id),
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  -- ends_at menor ou igual a starts_at significa janela que VIRA O DIA
  -- (plantao 22:00 as 02:00); igualdade seria janela vazia.
  check (starts_at <> ends_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bloqueio pontual (ferias, congresso, imprevisto). Nunca agendamento falso.
create table public.professional_block (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  professional_id uuid not null references public.professional (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at),
  reason text not null,
  blocks_overbooking boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Recursos, procedimentos e convenios
-- ---------------------------------------------------------------------------

-- Sala, cabine ou equipamento. Exigencia do nicho de estetica: dois
-- procedimentos que usam o mesmo laser nao podem coexistir no horario,
-- mesmo com profissionais diferentes (a trava vive em appointment, 2.3).
create table public.resource (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  unit_id uuid references public.unit (id),
  name text not null,
  kind text not null check (kind in ('sala', 'cabine', 'equipamento')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.procedure (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  name text not null,
  description text,
  default_duration_min integer not null default 30
    check (default_duration_min > 0),
  base_price_cents integer,
  requires_evaluation boolean not null default false,
  prep_instructions text,
  resource_id uuid references public.resource (id) on delete set null,
  bookable_by_ai boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.insurance (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  name text not null,
  plan_name text,
  requires_card boolean not null default true,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- A matriz de vinculo de tres pontas (o coracao do cadastro, aceite 2.1)
-- ---------------------------------------------------------------------------
-- Cada combinacao profissional + procedimento + convenio tem preco e duracao
-- PROPRIOS. price_cents = 0, covered_by_insurance = true e price_cents null
-- sao TRES estados diferentes ("R$ 0,00", "Coberto", vazio): confundir isso
-- faz a IA informar preco errado ao paciente.

create table public.service_link (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  professional_id uuid not null references public.professional (id) on delete cascade,
  procedure_id uuid not null references public.procedure (id) on delete cascade,
  insurance_id uuid references public.insurance (id), -- null = particular
  price_cents integer,
  covered_by_insurance boolean not null default false,
  duration_min integer not null check (duration_min > 0),
  bookable_by_ai boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- PG15+: NULLS NOT DISTINCT faz dois vinculos "particular" (convenio nulo)
  -- do mesmo profissional+procedimento COLIDIREM, que e o unique verdadeiro
  -- que o aceite exige. (Confirmado: o projeto roda Postgres 17.)
  constraint service_link_vinculo_unico
    unique nulls not distinct (professional_id, procedure_id, insurance_id),
  -- "Coberto pelo convenio" sem convenio e estado impossivel.
  constraint coberto_exige_convenio
    check (insurance_id is not null or covered_by_insurance = false)
);

-- Pacote de sessoes (metade do nicho de estetica depende disto).
create table public.package (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  procedure_id uuid not null references public.procedure (id),
  sessions integer not null check (sessions > 0),
  price_cents integer not null,
  validity_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- FKs pendentes de fases anteriores
-- ---------------------------------------------------------------------------

alter table public.contact
  add constraint contact_insurance_fk
  foreign key (insurance_id) references public.insurance (id) on delete set null;

alter table public.clinic_member
  add constraint clinic_member_professional_fk
  foreign key (professional_id) references public.professional (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helper de RLS: o professional do usuario logado naquela clinica
-- ---------------------------------------------------------------------------
-- Usada pelas policies da agenda (2.3): papel 'profissional' ve e mexe SO na
-- propria agenda (clinic_member.professional_id e o elo).

create or replace function public.user_professional_id(p_clinic_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select professional_id from clinic_member
  where clinic_id = p_clinic_id
    and user_id = auth.uid()
    and status = 'ativo'
$$;

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.professional
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.professional_schedule
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.professional_block
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.resource
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.procedure
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.insurance
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.service_link
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.package
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indices (toda FK indexada + caminhos quentes do motor e das telas)
-- ---------------------------------------------------------------------------

create index on public.professional (clinic_id);
create index on public.professional_schedule (clinic_id);
create index on public.professional_schedule (professional_id, weekday);
create index on public.professional_schedule (unit_id);
create index on public.professional_block (clinic_id);
create index on public.professional_block (professional_id, starts_at);
create index on public.resource (clinic_id);
create index on public.resource (unit_id);
create index on public.procedure (clinic_id);
create index on public.procedure (resource_id);
create index on public.insurance (clinic_id);
create index on public.service_link (clinic_id);
create index on public.service_link (professional_id);
create index on public.service_link (procedure_id);
create index on public.service_link (insurance_id);
create index on public.package (clinic_id);
create index on public.package (procedure_id);
create index on public.contact (insurance_id);
create index on public.clinic_member (professional_id);

-- ---------------------------------------------------------------------------
-- RLS: leitura para membro ativo; escrita so admin e gestor
-- ---------------------------------------------------------------------------

alter table public.professional enable row level security;
alter table public.professional_schedule enable row level security;
alter table public.professional_block enable row level security;
alter table public.resource enable row level security;
alter table public.procedure enable row level security;
alter table public.insurance enable row level security;
alter table public.service_link enable row level security;
alter table public.package enable row level security;

create policy "membro ativo le profissionais" on public.professional
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem profissionais" on public.professional
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le jornadas" on public.professional_schedule
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem jornadas" on public.professional_schedule
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le bloqueios" on public.professional_block
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem bloqueios" on public.professional_block
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le recursos" on public.resource
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem recursos" on public.resource
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le procedimentos" on public.procedure
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem procedimentos" on public.procedure
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le convenios" on public.insurance
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem convenios" on public.insurance
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le vinculos" on public.service_link
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem vinculos" on public.service_link
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "membro ativo le pacotes" on public.package
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "admin e gestor escrevem pacotes" on public.package
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

comment on table public.service_link is
  'Matriz de tres pontas: cada combinacao profissional+procedimento+convenio tem preco e duracao proprios. insurance_id nulo = particular. Os tres estados de preco (0, coberto, vazio) sao distintos e a interface mostra os tres de formas diferentes.';
