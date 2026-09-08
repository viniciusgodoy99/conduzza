-- Mapa de conversao: liga cada etapa do funil a um evento de conversao da
-- plataforma de anuncios. E o "Jornada de Compra" do Tintim trazido para
-- dentro do Conduzza, e configuravel por clinica (decisao do dono em
-- 08/09/2026, Caminho B do docs/06_resultados_atribuicao_e_retorno_meta.md).
--
-- ESTA MIGRATION SO CRIA A CONFIGURACAO. Ela NAO dispara nada para a Meta: o
-- retorno de conversao (CAPI) e escopo novo e entra em migration propria
-- quando a integracao existir (tarefas R3/R4 do docs/06). Nasce vazia: nao se
-- semeia mapeamento padrao, porque qual etapa conta como venda e decisao da
-- clinica (regra "nao invente dado", CLAUDE.md secao 7).
--
-- Espelha o padrao de campaign_link (20260825100000): leitura para membro
-- ativo, gestao para admin/gestor, updated_at por trigger.

create table public.funnel_conversion_map (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  -- etapa do funil que dispara o evento; strings identicas ao check de contact
  trigger_stage text not null check (trigger_stage in (
    'novo', 'em_contato', 'aguardando_resposta', 'agendou', 'compareceu')),
  -- nome do evento na plataforma (padrao Meta: Lead, Schedule, Purchase, ...);
  -- texto livre de proposito, para acompanhar eventos custom sem migration
  meta_event_name text not null,
  platform text not null default 'meta' check (platform in ('meta', 'google')),
  -- "Etapa que representa uma venda?" do Tintim
  is_sale boolean not null default false,
  -- "Etapa que representa um primeiro contato?" do Tintim
  is_first_contact boolean not null default false,
  -- de onde tirar o valor da conversao: 'service_link' usa o preco da consulta
  -- vinculada; 'fixo' usa value_cents; null = sem valor (default_value do Tintim)
  value_source text check (value_source in ('service_link', 'fixo')),
  value_cents integer check (value_cents is null or value_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- uma etapa mapeia no maximo um evento por clinica
  unique (clinic_id, trigger_stage),
  -- valor fixo exige o centavo; service_link e "sem valor" nao usam value_cents
  constraint valor_fixo_exige_cents
    check (value_source is distinct from 'fixo' or value_cents is not null)
);

create index on public.funnel_conversion_map (clinic_id) where active;

create trigger set_updated_at before update on public.funnel_conversion_map
  for each row execute function public.set_updated_at();

alter table public.funnel_conversion_map enable row level security;

create policy "membro le mapa de conversao" on public.funnel_conversion_map
  for select using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao gerencia mapa de conversao" on public.funnel_conversion_map
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));
