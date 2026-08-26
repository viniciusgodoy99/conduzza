# Modelo de Dados
### Conduzza Clínicas, V1

SQL de referência. Não é a migration final: o Claude Code deve gerar as migrations a partir daqui, uma por fase do backlog, revisando nomes e índices.

**Convenções:** `snake_case`, chave primária `uuid default gen_random_uuid()`, todo timestamp em `timestamptz`, toda tabela de negócio com `clinic_id not null` e RLS habilitada, `created_at` e `updated_at` em tudo.

---

## 1. Núcleo e acesso

```sql
create table clinic (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  timezone text not null default 'America/Fortaleza',
  spend_cap_cents integer,
  spend_cap_action text not null default 'pausar',   -- pausar | avisar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table clinic_branding (
  clinic_id uuid primary key references clinic(id) on delete cascade,
  product_name text not null default 'Conduzza Clínicas',
  primary_color text not null default '#5B9CFF',
  logo_wide_light text, logo_wide_dark text,
  logo_icon_light text, logo_icon_dark text,
  labels jsonb not null default '{"profissional":"profissional","procedimento":"procedimento","paciente":"paciente","consulta":"consulta"}'
);

create table clinic_member (
  clinic_id uuid not null references clinic(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','gestor','recepcao','profissional','leitura')),
  professional_id uuid,                 -- preenchido quando role = profissional
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table unit (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null, address text, phone text,
  active boolean not null default true
);
```

---

## 2. Catálogo clínico

```sql
create table professional (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null,
  photo_url text,
  council_type text,          -- LIVRE: CRM, CRO, CREFITO, CRBM, CRN, ou null p/ esteticista
  council_number text,
  specialties text[] not null default '{}',
  calendar_color text,
  active boolean not null default true
);

create table professional_schedule (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  unit_id uuid references unit(id),
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null
);

create table professional_block (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  blocks_overbooking boolean not null default true
);

create table resource (                       -- sala, cabine, equipamento
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  unit_id uuid references unit(id),
  name text not null,
  kind text not null check (kind in ('sala','cabine','equipamento')),
  active boolean not null default true
);

create table procedure (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null,
  description text,
  default_duration_min integer not null default 30,
  base_price_cents integer,
  requires_evaluation boolean not null default false,
  prep_instructions text,
  resource_id uuid references resource(id),
  bookable_by_ai boolean not null default true,
  active boolean not null default true
);

create table insurance (                      -- convênio
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null,
  plan_name text,
  requires_card boolean not null default true,
  notes text,
  active boolean not null default true
);

-- A MATRIZ DE TRÊS PONTAS. É o coração do cadastro.
create table service_link (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id) on delete cascade,
  procedure_id uuid not null references procedure(id) on delete cascade,
  insurance_id uuid references insurance(id),        -- null = particular
  price_cents integer,                                -- null = coberto pelo convênio
  covered_by_insurance boolean not null default false,-- diferencia "coberto" de "zero" e de "vazio"
  duration_min integer not null,
  bookable_by_ai boolean not null default true,
  active boolean not null default true,
  unique (professional_id, procedure_id, insurance_id)
);

create table package (                        -- pacote de sessões, exigência do nicho de estética
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  procedure_id uuid not null references procedure(id),
  sessions integer not null check (sessions > 0),
  price_cents integer not null,
  validity_days integer
);
```

> **Atenção de produto:** `price_cents = 0` e `covered_by_insurance = true` e `price_cents is null` são **três coisas diferentes** e a interface precisa mostrar as três de forma diferente ("R$ 0,00", "Coberto", campo vazio). Confundir isso faz a IA informar preço errado ao paciente.

---

## 3. Contatos, leads e pacientes

```sql
create table contact (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  phone_e164 text not null,
  name text,
  cpf text, email text, birth_date date,
  insurance_id uuid references insurance(id),
  insurance_card text,
  kind text not null default 'lead' check (kind in ('lead','paciente')),
  funnel_stage text not null default 'novo'
    check (funnel_stage in ('novo','em_contato','aguardando_resposta','agendou','compareceu','perdido')),
  lost_reason text,
  owner_user_id uuid references auth.users(id),
  tags text[] not null default '{}',
  -- atribuição de origem, preservada para sempre
  source_channel text, source_origin text, source_medium text, source_campaign text,
  source_captured_at timestamptz, source_method text,
  first_contact_at timestamptz not null default now(),
  last_contact_at timestamptz,
  inactive_since timestamptz,
  no_show_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone_e164)
);

-- Consentimento. Sem isso o disparo derruba o quality rating do número.
create table contact_consent (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  channel text not null default 'whatsapp',
  source text not null,          -- formulario_site | anuncio_ctwa | recepcao | importacao_planilha | conversa
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  active boolean generated always as (revoked_at is null) stored,
  evidence text
);

create table package_balance (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  package_id uuid not null references package(id),
  sessions_used integer not null default 0,
  sessions_total integer not null,
  expires_at date
);
```

---

## 4. Conversas e mensagens

```sql
create table conversation (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  status text not null default 'ia_atendendo'
    check (status in ('ia_atendendo','aguardando_humano','em_atendimento','resolvida')),
  assignee_user_id uuid references auth.users(id),
  window_expires_at timestamptz,           -- janela de 24h da Meta
  unread_count integer not null default 0, -- por LER; zera ao abrir a conversa
  awaiting_reply boolean not null default false, -- ver nota abaixo
  last_message_at timestamptz,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
```

**`awaiting_reply` não é o mesmo que `unread_count > 0`, e não é o mesmo que `status = 'aguardando_humano'`.** As três respondem perguntas diferentes, e confundi-las já custou dois defeitos:

| Coluna | Pergunta que responde | Por que não serve de contador |
|---|---|---|
| `status` | quem é o dono da conversa agora | a régua abre conversa em `aguardando_humano` só para enviar a confirmação: 40 disparos viram badge 40 |
| `unread_count` | tem mensagem por ler | zera quando alguém apenas ABRE para ler, e o lembrete some sem ninguém ter respondido |
| `awaiting_reply` | a última mensagem veio do paciente e ninguém respondeu | é este que o badge de Atendimento e a ordem do Inbox usam |

Sobe em `ingest_inbound_message` (mensagem de entrada). Desce **só** em envio com `author = 'usuario'` e ao resolver a conversa: toque automático de régua (`author = 'sistema'`) não apaga pergunta de paciente.

```sql
create table message (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  wa_message_id text unique,               -- IDEMPOTÊNCIA do webhook
  direction text not null check (direction in ('entrada','saida')),
  author text not null check (author in ('paciente','ia','usuario','sistema')),
  author_user_id uuid references auth.users(id),
  content_type text not null default 'texto',  -- texto | imagem | audio | documento | template | evento
  body text,
  media_url text,
  transcript text,                         -- transcrição de áudio recebido
  template_id uuid,
  is_internal_note boolean not null default false,
  pricing_category text,                   -- utility | marketing | service | authentication
  billable boolean not null default false,
  cost_cents integer,
  delivery_status text,                    -- enviada | entregue | lida | falhou
  error_code text,
  created_at timestamptz not null default now()
);

create table ai_decision_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  message_id uuid references message(id),
  tool_used text,
  context_read jsonb,
  escalation_reason text,
  compliance_blocked boolean not null default false,
  compliance_rule text,                    -- triagem | promessa_resultado | medicamento | oferta_casada
  blocked_draft text,                      -- o que a IA ia responder, para auditoria
  latency_ms integer,
  created_at timestamptz not null default now()
);
```

---

## 5. Agenda, com as travas de concorrência

```sql
create extension if not exists btree_gist;

create table appointment (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  unit_id uuid references unit(id),
  contact_id uuid not null references contact(id),
  professional_id uuid not null references professional(id),
  service_link_id uuid not null references service_link(id),
  resource_id uuid references resource(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'agendado' check (status in (
    'agendado','aguardando_confirmacao',
    'confirmado_paciente','confirmado_recepcao',
    'na_recepcao','em_atendimento','compareceu',
    'cancelado_paciente','cancelado_clinica','faltou'
  )),
  confirmed_by_user_id uuid references auth.users(id),
  confirmation_channel text,               -- whatsapp | telefone | presencial
  is_overbooking boolean not null default false,
  source text not null default 'interna' check (source in ('interna','externa')),
  external_id text,                        -- prepara integração com PMS no V2
  notes text,
  created_at timestamptz not null default now()
);

-- A trava. Impede duas marcações no mesmo horário mesmo em requisições simultâneas.
alter table appointment add constraint sem_sobreposicao_profissional
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado_paciente','cancelado_clinica') and is_overbooking = false);

alter table appointment add constraint sem_sobreposicao_recurso
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (resource_id is not null and status not in ('cancelado_paciente','cancelado_clinica'));

create table appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  appointment_id uuid not null references appointment(id) on delete cascade,
  status text not null,
  changed_by_user_id uuid references auth.users(id),
  changed_by text not null default 'usuario' check (changed_by in ('usuario','ia','paciente','sistema')),
  changed_at timestamptz not null default now()
);

-- Reserva temporária: a IA oferece o horário, o slot trava por 10 minutos.
create table slot_hold (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  professional_id uuid not null references professional(id),
  contact_id uuid references contact(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  created_by text not null default 'ia'
);

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  procedure_id uuid references procedure(id),
  professional_id uuid references professional(id),
  preferred_shifts text[],                 -- manha | tarde | noite
  preferred_weekdays smallint[],
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table waitlist_offer (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  slot_starts_at timestamptz not null,
  professional_id uuid not null references professional(id),
  offered_to uuid[] not null,
  responded_by uuid references contact(id),
  expires_at timestamptz not null,
  status text not null default 'aberta' check (status in ('aberta','preenchida','expirada','cancelada'))
);
```

---

## 6. Agente de IA

```sql
create table ai_agent_config (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  version integer not null default 1,
  published boolean not null default false,
  agent_name text not null default 'Assistente',
  tone text not null default 'cordial' check (tone in ('formal','cordial','proximo')),
  use_emoji boolean not null default false,
  greeting text, closing text,
  skills jsonb not null default '{}',       -- { "agendar": true, "informar_preco": true, ... }
  operating_mode text not null default '24h' check (operating_mode in ('24h','fora_expediente','fallback')),
  fallback_minutes integer default 5,
  operating_hours jsonb,
  escalation_rules jsonb not null default '{}',
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (clinic_id, version)
);

create table knowledge_item (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  question text not null,
  answer text not null,
  source text not null default 'manual',    -- manual | correcao_humano | documento
  active boolean not null default true
);
```

---

## 7. Réguas e fila de jobs

```sql
create table cadence (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  kind text not null check (kind in ('confirmacao','followup','pos_falta','reativacao','lista_espera')),
  name text not null,
  trigger_stage text,                       -- para followup
  procedure_id uuid references procedure(id),-- exceção por procedimento
  for_no_show_history boolean not null default false,
  send_window_start time, send_window_end time,
  send_weekdays smallint[],
  active boolean not null default false
);

create table cadence_step (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  cadence_id uuid not null references cadence(id) on delete cascade,
  offset_minutes integer not null,          -- negativo = antes do evento
  use_ai boolean not null default false,
  template_id uuid,
  fixed_body text,
  stop_conditions text[] not null default '{respondeu,agendou,perdido}'
);

create table cadence_run (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  cadence_step_id uuid not null references cadence_step(id) on delete cascade,
  contact_id uuid not null references contact(id) on delete cascade,
  appointment_id uuid references appointment(id),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  skipped_reason text,                      -- sem_consentimento | fora_janela | teto_gasto | condicao_parada
  message_id uuid references message(id),
  -- Não duplica envio. appointment_id ENTRA na chave: sem ele, duas consultas
  -- do mesmo paciente no mesmo passo colidiam no toque manual ("Cobrar agora",
  -- que usa o minuto corrente como scheduled_for) e a segunda sumia em
  -- silêncio. nulls not distinct preserva a trava para régua sem consulta.
  unique nulls not distinct
    (cadence_step_id, contact_id, appointment_id, scheduled_for)
);

create table job_queue (
  id bigserial primary key,
  clinic_id uuid references clinic(id) on delete cascade,
  kind text not null,                       -- process_inbound | run_cadence_step | expire_holds | waitlist_offer
  payload jsonb not null,
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text
);
create index on job_queue (run_at) where completed_at is null;
```

---

## 8. WhatsApp, custo, auditoria e assinatura

```sql
create table whatsapp_account (
  clinic_id uuid primary key references clinic(id) on delete cascade,
  phone_number_id text, waba_id text, display_phone text,
  business_verified boolean not null default false,
  quality_rating text,                      -- GREEN | YELLOW | RED
  messaging_limit text,
  connected_at timestamptz,
  token_ref text                            -- referência ao segredo, NUNCA o token em texto
);

create table message_template (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic(id) on delete cascade,
  name text not null, language text not null default 'pt_BR',
  category text not null,                   -- utility | marketing | authentication
  body text not null,
  buttons jsonb,                            -- os botões de resposta rápida são margem, não estética
  meta_status text not null default 'rascunho',
  meta_template_id text
);

create table message_pricing (               -- preço NUNCA fixo no código
  id uuid primary key default gen_random_uuid(),
  category text not null, currency text not null default 'BRL',
  cents integer not null, valid_from date not null
);

create table audit_log (
  id bigserial primary key,
  clinic_id uuid references clinic(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,                     -- leu | criou | editou | excluiu | exportou | assumiu_conversa
  entity text not null, entity_id uuid,
  ip text, user_agent text,
  created_at timestamptz not null default now()
);

create table subscription (
  clinic_id uuid primary key references clinic(id) on delete cascade,
  plan text not null check (plan in ('essencial','completo')),
  status text not null default 'trial' check (status in ('trial','ativa','atrasada','suspensa','cancelada')),
  billing_cycle text not null default 'mensal',
  gateway_customer_id text, gateway_subscription_id text,
  trial_ends_at timestamptz, current_period_end timestamptz
);
```

---

## 9. Índices que importam

```sql
create index on message (conversation_id, created_at desc);
create index on conversation (clinic_id, status, last_message_at desc);
create index on appointment (clinic_id, professional_id, starts_at);
create index on appointment (clinic_id, starts_at) where status = 'aguardando_confirmacao';
create index on contact (clinic_id, funnel_stage, last_contact_at desc);
create index on contact (clinic_id, source_campaign);
create index on cadence_run (scheduled_for) where sent_at is null;
create index on slot_hold (expires_at);
```

---

## 10. Seeds para desenvolvimento

Criar uma clínica fictícia completa: 2 unidades, 4 profissionais (2 médicos com CRM, 1 esteticista sem conselho, 1 dentista com CRO), 10 procedimentos (incluindo 1 com preparo e 1 que exige equipamento), 4 convênios, a matriz de vínculo preenchida com preço e cobertura variando, 1 pacote de 10 sessões, 60 contatos espalhados pelas 6 etapas do funil, 40 agendamentos nos 10 status, 15 conversas em estados diferentes (incluindo uma com bloqueio de conformidade registrado) e 1 régua de confirmação ativa.

**Sem seed realista, ninguém consegue avaliar se a tela funciona.**
