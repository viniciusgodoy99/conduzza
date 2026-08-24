-- Fase 2, tarefa 2.3: agenda e travas de concorrencia (docs/04 secao 5).
--
-- A regra que da nome a fase: conflito de horario e impedido PELO BANCO, com
-- exclusion constraint, nao por checagem no codigo. Duas requisicoes
-- simultaneas nao marcam o mesmo slot (aceite: teste de concorrencia 23P01).

-- Primeira extensao do projeto. btree_gist e inevitavel: exclusion com
-- igualdade de uuid + sobreposicao de intervalo exige as opclasses dele.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------------

create table public.appointment (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  unit_id uuid references public.unit (id),
  contact_id uuid not null references public.contact (id),
  professional_id uuid not null references public.professional (id),
  service_link_id uuid not null references public.service_link (id),
  resource_id uuid references public.resource (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at),
  -- Os 10 status, identicos as chaves de lib/design/status.ts.
  status text not null default 'agendado' check (status in (
    'agendado', 'aguardando_confirmacao',
    'confirmado_paciente', 'confirmado_recepcao',
    'na_recepcao', 'em_atendimento', 'compareceu',
    'cancelado_paciente', 'cancelado_clinica', 'faltou')),
  confirmed_by_user_id uuid references auth.users (id),
  confirmation_channel text
    check (confirmation_channel in ('whatsapp', 'telefone', 'presencial')),
  is_overbooking boolean not null default false,
  -- Encaixe da IA com aprovacao (decisao do dono em 24/08/2026): quem criou e
  -- se precisa de aprovacao da recepcao. approval_status nulo = fluxo normal,
  -- sem aprovacao. Encaixe da IA nasce is_overbooking=true e 'pendente';
  -- recusar vira status cancelado_clinica + 'recusado'.
  created_by text not null default 'usuario'
    check (created_by in ('usuario', 'ia', 'paciente', 'sistema')),
  approval_status text
    check (approval_status in ('pendente', 'aprovado', 'recusado')),
  -- Chave "enviar confirmacao automatica" do modal: por ora so a intencao;
  -- a regua que consome isto e a tarefa 4.7.
  send_confirmation boolean not null default true,
  source text not null default 'interna'
    check (source in ('interna', 'externa')),
  external_id text, -- prepara integracao com PMS no V2
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A TRAVA (aceite 2.3). Range semiaberto [inicio, fim): slots adjacentes nao
-- colidem. Cancelamento LIBERA o horario. Encaixe (is_overbooking) fica fora
-- de proposito: e a sobreposicao consciente. 'faltou' nao libera: so e
-- marcado depois que o horario passou, entao nao ha o que liberar.
alter table public.appointment add constraint sem_sobreposicao_profissional
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (
    status not in ('cancelado_paciente', 'cancelado_clinica')
    and is_overbooking = false
  );

-- Mesma trava para o recurso fisico (sala, laser): dois profissionais
-- diferentes nao usam o mesmo equipamento no mesmo horario. Vale ate para
-- encaixe: o aparelho nao se duplica.
alter table public.appointment add constraint sem_sobreposicao_recurso
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (
    resource_id is not null
    and status not in ('cancelado_paciente', 'cancelado_clinica')
  );

-- ---------------------------------------------------------------------------
-- Historico de status (append-only, como audit_log)
-- ---------------------------------------------------------------------------

create table public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  appointment_id uuid not null references public.appointment (id) on delete cascade,
  status text not null,
  changed_by_user_id uuid references auth.users (id),
  changed_by text not null default 'usuario'
    check (changed_by in ('usuario', 'ia', 'paciente', 'sistema')),
  changed_at timestamptz not null default now()
);

comment on table public.appointment_status_history is
  'Trilha de status da consulta. CONTRATO: a linha inicial nasce por trigger no INSERT do appointment; cada MUDANCA de status e gravada EXPLICITAMENTE por quem muda (Server Action, ferramenta da IA, RPC de confirmacao do paciente), informando changed_by e changed_by_user_id. Append-only: sem update nem delete.';

-- ---------------------------------------------------------------------------
-- Reserva temporaria (hold)
-- ---------------------------------------------------------------------------
-- A IA oferece um horario e o slot trava por 10 minutos (valor de aplicacao).
-- SEM exclusion aqui (docs): o hold e consultivo, participa do motor de
-- disponibilidade; a trava real e o insert do appointment. Expira SOZINHO
-- porque toda leitura filtra expires_at > now(); a limpeza fisica e higiene
-- do worker (limpar_holds_vencidos).

create table public.slot_hold (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  professional_id uuid not null references public.professional (id),
  contact_id uuid references public.contact (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at),
  expires_at timestamptz not null,
  created_by text not null default 'ia',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.limpar_holds_vencidos()
returns integer
language sql
set search_path = public
as $$
  with apagados as (
    delete from slot_hold where expires_at < now() returning 1
  )
  select count(*)::integer from apagados
$$;

revoke execute on function public.limpar_holds_vencidos()
  from public, anon, authenticated;
grant execute on function public.limpar_holds_vencidos() to service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Linha inicial do historico no INSERT (as mudancas seguintes sao explicitas,
-- ver o comment da tabela de historico).
create or replace function public.registrar_status_inicial()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into appointment_status_history (
    clinic_id, appointment_id, status, changed_by_user_id, changed_by
  ) values (
    new.clinic_id, new.id, new.status, auth.uid(), new.created_by
  );
  return new;
end;
$$;

create trigger registrar_status_inicial
  after insert on public.appointment
  for each row execute function public.registrar_status_inicial();

-- Conversao lead -> paciente ao criar agendamento (spec 5.12), automatica e
-- valida para todos os caminhos: recepcao, IA (service role) e PMS futuro.
-- Nao mexe em funnel_stage (a logica de funil e da Fase 4).
create or replace function public.converter_lead_em_paciente()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update contact
  set kind = 'paciente'
  where id = new.contact_id and kind = 'lead';
  return new;
end;
$$;

create trigger converter_lead_em_paciente
  after insert on public.appointment
  for each row execute function public.converter_lead_em_paciente();

create trigger set_updated_at before update on public.appointment
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.slot_hold
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indices (docs/04 secao 9 + toda FK indexada)
-- ---------------------------------------------------------------------------

create index on public.appointment (clinic_id, professional_id, starts_at);
create index on public.appointment (clinic_id, starts_at)
  where status = 'aguardando_confirmacao';
create index on public.appointment (clinic_id, starts_at)
  where approval_status = 'pendente';
create index on public.appointment (contact_id);
create index on public.appointment (service_link_id);
create index on public.appointment (resource_id);
create index on public.appointment (unit_id);
create index on public.appointment (confirmed_by_user_id);
create index on public.appointment_status_history (appointment_id, changed_at desc);
create index on public.appointment_status_history (clinic_id);
create index on public.appointment_status_history (changed_by_user_id);
create index on public.slot_hold (expires_at);
create index on public.slot_hold (clinic_id);
create index on public.slot_hold (professional_id, starts_at);
create index on public.slot_hold (contact_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- O recorte do papel 'profissional' (ve e mexe SO na propria agenda) vive
-- DENTRO da policy, porque o Realtime entrega eventos por assinante
-- aplicando RLS: filtrar no cliente nao protegeria nada.

alter table public.appointment enable row level security;
alter table public.appointment_status_history enable row level security;
alter table public.slot_hold enable row level security;

create policy "membro le agenda conforme papel" on public.appointment
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  );

create policy "membro com escrita cria consulta" on public.appointment
  for insert with check (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  );

create policy "membro com escrita atualiza consulta" on public.appointment
  for update using (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  )
  with check (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  );
-- Sem policy de DELETE: cancelar e mudanca de status, nunca exclusao.

create policy "membro le historico conforme a consulta" on public.appointment_status_history
  for select using (
    exists (
      select 1 from appointment a
      where a.id = appointment_id
        and a.clinic_id in (select public.user_active_clinic_ids())
        and (
          not public.user_has_role(a.clinic_id, array['profissional'])
          or a.professional_id = public.user_professional_id(a.clinic_id)
        )
    )
  );

create policy "membro com escrita registra historico" on public.appointment_status_history
  for insert with check (public.user_can_write(clinic_id));
-- Sem update nem delete: trilha imutavel.

create policy "membro le holds conforme papel" on public.slot_hold
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or professional_id = public.user_professional_id(clinic_id)
    )
  );

create policy "membro com escrita cria hold" on public.slot_hold
  for insert with check (public.user_can_write(clinic_id));

create policy "membro com escrita libera hold" on public.slot_hold
  for delete using (public.user_can_write(clinic_id));
