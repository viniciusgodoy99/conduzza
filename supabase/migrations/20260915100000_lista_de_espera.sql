-- Tarefa 4.9 (Tela 10), fase 1: o SCHEMA da lista de espera, dormindo.
-- Nenhum comportamento muda neste deploy; o gatilho de cancelamento, o job
-- de reoferta e as RPCs chegam na fase seguinte, e a tela na terceira.
--
-- Origem do desenho: docs/04_modelo_dados.md (secao 5) + o rascunho da Fase
-- 3 (docs/drafts), com os acrescimos justificados em comentario. Decisoes do
-- dono: tamanho da onda CONFIGURAVEL por clinica (padrao 5) e janela de
-- resposta padrao 30 minutos; a reoferta e mecanica de fila com autoria
-- sistema (IA fica para a Fase 3).

-- ---------------------------------------------------------------------------
-- 1. A fila

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  procedure_id uuid references public.procedure (id) on delete cascade,
  professional_id uuid references public.professional (id) on delete cascade,
  -- 0=domingo..6=sabado, convencao getDay do JS (a mesma de
  -- cadence.send_weekdays e da logica pura em lib/domain/lista-espera.ts).
  preferred_shifts text[] not null default '{}'
    check (preferred_shifts <@ array['manha', 'tarde', 'noite']),
  preferred_weekdays smallint[] not null default '{}'
    check (preferred_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.waitlist
  for each row execute function public.set_updated_at();

-- A ordem da onda: prioridade, depois quem espera ha mais tempo.
create index waitlist_ordem_da_onda
  on public.waitlist (clinic_id, priority, created_at)
  where active;
create index waitlist_por_contato on public.waitlist (contact_id);
create index waitlist_por_procedimento on public.waitlist (procedure_id);
create index waitlist_por_profissional on public.waitlist (professional_id);

-- Uma entrada ATIVA por (contato, procedimento, profissional): entrar de
-- novo no mesmo pedido e conflito, nao duplicata silenciosa.
create unique index waitlist_ativa_unica on public.waitlist (
  clinic_id,
  contact_id,
  coalesce(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where active;

alter table public.waitlist enable row level security;

-- Matriz do brief (secao 5): Confirmacoes e Lista de espera sao "ver" ate
-- para profissional e leitura; escreve quem escreve dado de paciente
-- (admin, gestor, recepcao), o mesmo recorte de user_can_write.
create policy "membro le a fila da clinica" on public.waitlist
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "quem escreve gerencia a fila" on public.waitlist
  for insert with check (public.user_can_write(clinic_id));
create policy "quem escreve edita a fila" on public.waitlist
  for update using (public.user_can_write(clinic_id))
  with check (public.user_can_write(clinic_id));
-- SEM policy de delete: sair da fila e active=false (preserva metrica e o
-- tempo real nunca precisa de evento DELETE, que nao filtra por clinica).

-- ---------------------------------------------------------------------------
-- 2. A oferta (uma onda de reoferta para um horario vago)

create table public.waitlist_offer (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- O appointment cancelado que abriu o horario: rastreio das ondas do mesmo
  -- slot, fallback de service_link do vencedor e agrupamento na tela.
  source_appointment_id uuid not null
    references public.appointment (id) on delete cascade,
  professional_id uuid not null
    references public.professional (id) on delete cascade,
  slot_starts_at timestamptz not null,
  slot_ends_at timestamptz not null,
  constraint oferta_com_fim_depois_do_inicio
    check (slot_ends_at > slot_starts_at),
  offered_to uuid[] not null,
  -- Quem respondeu "nao quero" ESTA oferta (continua na fila para a proxima).
  declined_by uuid[] not null default '{}',
  responded_by uuid references public.contact (id),
  responded_at timestamptz,
  -- O horario recuperado (appointment novo do vencedor): alimenta a receita
  -- associada do painel.
  appointment_id uuid references public.appointment (id),
  expires_at timestamptz not null,
  status text not null default 'aberta'
    check (status in ('aberta', 'preenchida', 'expirada', 'cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.waitlist_offer
  for each row execute function public.set_updated_at();

-- UMA oferta aberta por horario: idempotencia da onda (dois gatilhos ou uma
-- expiracao concorrente nao criam duas) e a busca da faixa da tela.
create unique index waitlist_offer_aberta_unica
  on public.waitlist_offer (clinic_id, professional_id, slot_starts_at)
  where status = 'aberta';
create index waitlist_offer_por_situacao
  on public.waitlist_offer (clinic_id, status);
create index waitlist_offer_por_origem
  on public.waitlist_offer (source_appointment_id);

alter table public.waitlist_offer enable row level security;

create policy "membro le as ofertas da clinica" on public.waitlist_offer
  for select using (clinic_id in (select public.user_active_clinic_ids()));
-- Update pela sessao SO para o botao Cancelar reoferta (a action restringe);
-- INSERT nao tem policy: oferta nasce pelo motor, por service role.
create policy "quem escreve cancela a reoferta" on public.waitlist_offer
  for update using (public.user_can_write(clinic_id))
  with check (public.user_can_write(clinic_id));

-- ---------------------------------------------------------------------------
-- 3. Configuracao por clinica

alter table public.clinic
  add column waitlist_wave_size integer not null default 5
    check (waitlist_wave_size between 1 and 20),
  add column waitlist_response_minutes integer not null default 30
    check (waitlist_response_minutes between 5 and 240);

-- ---------------------------------------------------------------------------
-- 4. Tempo real (o mesmo bloco idempotente da agenda)

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'waitlist') then
      alter publication supabase_realtime add table public.waitlist;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'waitlist_offer') then
      alter publication supabase_realtime add table public.waitlist_offer;
    end if;
  end if;
end;
$$;
