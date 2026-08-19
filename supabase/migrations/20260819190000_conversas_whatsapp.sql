-- Tarefa 1.1: contatos, consentimento, conversas, mensagens e conta WhatsApp
-- (docs/04 secoes 3, 4 e 8, adaptado ao canal plugavel decidido em 19/08/2026:
-- provider uazapi/fake agora, cloud_api oficial depois).
--
-- Antecipacao registrada no plano: contact e contact_consent (Fase 4) entram
-- aqui porque conversation.contact_id e FK obrigatoria e o bloqueio de envio
-- sem consentimento (aceite da 1.4) depende deles. package_balance fica na 4.1.
--
-- Regra do projeto: tabela de negocio nasce com clinic_id not null, RLS e
-- policy na MESMA migration. Excecoes documentadas: whatsapp_account_secret
-- (RLS sem policy: so service role; guarda token de instancia e webhook_secret)
-- e message_pricing (configuracao global do produto, sem clinic_id).

-- ---------------------------------------------------------------------------
-- Contatos e consentimento (docs/04 secao 3)
-- ---------------------------------------------------------------------------

create table public.contact (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  phone_e164 text not null,
  name text,
  cpf text,
  email text,
  birth_date date,
  insurance_id uuid,            -- FK para insurance na Fase 2 (tabela ainda nao existe)
  insurance_card text,
  kind text not null default 'lead' check (kind in ('lead', 'paciente')),
  funnel_stage text not null default 'novo' check (funnel_stage in
    ('novo', 'em_contato', 'aguardando_resposta', 'agendou', 'compareceu', 'perdido')),
  lost_reason text,
  owner_user_id uuid references auth.users (id),
  tags text[] not null default '{}',
  -- atribuicao de origem, preservada para sempre (logica na Fase 4)
  source_channel text,
  source_origin text,
  source_medium text,
  source_campaign text,
  source_captured_at timestamptz,
  source_method text,
  first_contact_at timestamptz not null default now(),
  last_contact_at timestamptz,
  inactive_since timestamptz,
  no_show_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, phone_e164)
);

-- Consentimento: sem ele nao ha disparo. Nunca.
create table public.contact_consent (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  channel text not null default 'whatsapp',
  source text not null check (source in
    ('formulario_site', 'anuncio_ctwa', 'recepcao', 'importacao_planilha', 'conversa')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  active boolean generated always as (revoked_at is null) stored,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Conversas e mensagens (docs/04 secao 4)
-- ---------------------------------------------------------------------------

create table public.conversation (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  status text not null default 'aguardando_humano' check (status in
    ('ia_atendendo', 'aguardando_humano', 'em_atendimento', 'resolvida')),
  assignee_user_id uuid references auth.users (id),
  -- Janela de 24h da Meta: so se aplica a canal oficial (cloud_api). O uazapi
  -- nao tem janela; o webhook grava sempre e a UI so exibe no canal oficial.
  window_expires_at timestamptz,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma conversa aberta por contato: e a trava que torna o webhook concorrente
-- correto (modelo WhatsApp e um fio por contato; resolvida arquiva).
create unique index conversation_aberta_por_contato
  on public.conversation (clinic_id, contact_id)
  where status <> 'resolvida';

create table public.message (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  conversation_id uuid not null references public.conversation (id) on delete cascade,
  wa_message_id text unique,               -- IDEMPOTENCIA do webhook
  direction text not null check (direction in ('entrada', 'saida')),
  author text not null check (author in ('paciente', 'ia', 'usuario', 'sistema')),
  author_user_id uuid references auth.users (id),
  content_type text not null default 'texto' check (content_type in
    ('texto', 'imagem', 'audio', 'documento', 'template', 'evento')),
  body text,
  media_url text,
  transcript text,                          -- transcricao de audio recebido
  template_id uuid,
  is_internal_note boolean not null default false,
  -- Custo: no canal oficial (cloud_api) vem da tabela message_pricing; no
  -- uazapi/fake e sempre 0 e billable false.
  pricing_category text check (pricing_category in
    ('utility', 'marketing', 'service', 'authentication')),
  billable boolean not null default false,
  cost_cents integer,
  delivery_status text check (delivery_status in
    ('enviada', 'entregue', 'lida', 'falhou')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_decision_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  conversation_id uuid not null references public.conversation (id) on delete cascade,
  message_id uuid references public.message (id),
  tool_used text,
  context_read jsonb,
  escalation_reason text,
  compliance_blocked boolean not null default false,
  compliance_rule text,                     -- triagem | promessa_resultado | medicamento | oferta_casada
  blocked_draft text,                       -- o que a IA ia responder, para auditoria
  latency_ms integer,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Conta WhatsApp por clinica (canal plugavel) e segredos (docs/04 secao 8,
-- adaptada: token_ref vira tabela irma so-service-role)
-- ---------------------------------------------------------------------------

create table public.whatsapp_account (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  provider text not null default 'fake' check (provider in ('fake', 'uazapi', 'cloud_api')),
  -- uazapi
  server_url text,                          -- null = usa o do ambiente
  instance_id text,
  display_phone text,
  connection_status text not null default 'desconectado' check (connection_status in
    ('desconectado', 'aguardando_qr', 'conectando', 'conectado')),
  connected_at timestamptz,
  disconnected_at timestamptz,
  -- canal oficial futuro (cloud_api)
  phone_number_id text,
  waba_id text,
  business_verified boolean not null default false,
  quality_rating text,                      -- GREEN | YELLOW | RED
  messaging_limit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Segredos: RLS ligada e NENHUMA policy de proposito. So service role le e
-- escreve. QR code e credencial de pareamento, tambem fica aqui.
create table public.whatsapp_account_secret (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  instance_token text,
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  qr_code text,
  qr_code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.message_template (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  name text not null,
  language text not null default 'pt_BR',
  category text not null check (category in ('utility', 'marketing', 'authentication')),
  body text not null,
  buttons jsonb,
  meta_status text not null default 'rascunho',
  meta_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Preco por mensagem da Meta (canal oficial): configuracao GLOBAL do produto,
-- sem clinic_id (excecao documentada). Nasce VAZIA: o preco em BRL e a
-- pendencia P1 do backlog e nao se inventa valor.
create table public.message_pricing (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  currency text not null default 'BRL',
  cents integer not null,
  valid_from date not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.contact
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contact_consent
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.conversation
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.message
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.whatsapp_account
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.whatsapp_account_secret
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.message_template
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS e policies
-- ---------------------------------------------------------------------------

alter table public.contact enable row level security;
alter table public.contact_consent enable row level security;
alter table public.conversation enable row level security;
alter table public.message enable row level security;
alter table public.ai_decision_log enable row level security;
alter table public.whatsapp_account enable row level security;
alter table public.whatsapp_account_secret enable row level security;
alter table public.message_template enable row level security;
alter table public.message_pricing enable row level security;

-- contact e consent: membro le e escreve na propria clinica.
create policy "membro le contatos" on public.contact
  for select using (clinic_id in (select public.user_clinic_ids()));
create policy "membro cria contato" on public.contact
  for insert with check (clinic_id in (select public.user_clinic_ids()));
create policy "membro edita contato" on public.contact
  for update using (clinic_id in (select public.user_clinic_ids()))
  with check (clinic_id in (select public.user_clinic_ids()));

create policy "membro le consentimento" on public.contact_consent
  for select using (clinic_id in (select public.user_clinic_ids()));
create policy "membro registra consentimento" on public.contact_consent
  for insert with check (clinic_id in (select public.user_clinic_ids()));
create policy "membro atualiza consentimento" on public.contact_consent
  for update using (clinic_id in (select public.user_clinic_ids()))
  with check (clinic_id in (select public.user_clinic_ids()));

-- conversation: conversa de paciente e dado de saude. O papel profissional ve
-- SO as proprias conversas (matriz da secao 5 do brief), e isso precisa estar
-- na POLICY porque o Realtime entrega eventos direto ao browser via RLS.
create policy "membro le conversas conforme papel" on public.conversation
  for select using (
    clinic_id in (select public.user_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or assignee_user_id = auth.uid()
    )
  );
create policy "membro cria conversa" on public.conversation
  for insert with check (
    clinic_id in (select public.user_clinic_ids())
    and not public.user_has_role(clinic_id, array['profissional'])
  );
create policy "membro atualiza conversa conforme papel" on public.conversation
  for update using (
    clinic_id in (select public.user_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or assignee_user_id = auth.uid()
    )
  )
  with check (clinic_id in (select public.user_clinic_ids()));

-- message: mesma visibilidade da conversa a que pertence.
create policy "membro le mensagens conforme papel" on public.message
  for select using (
    clinic_id in (select public.user_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );
create policy "membro escreve mensagem" on public.message
  for insert with check (
    clinic_id in (select public.user_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );

-- ai_decision_log: leitura segue a visibilidade da conversa; escrita e do
-- agente (service role, Fase 3).
create policy "membro le decisoes da IA conforme papel" on public.ai_decision_log
  for select using (
    clinic_id in (select public.user_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );

-- whatsapp_account: todo membro precisa ver o status (faixa de desconectado);
-- escrita so via service role nas Server Actions com checagem de papel.
create policy "membro le a conta whatsapp" on public.whatsapp_account
  for select using (clinic_id in (select public.user_clinic_ids()));

-- message_template: membro le; admin gerencia (Configuracoes e admin-only).
create policy "membro le modelos" on public.message_template
  for select using (clinic_id in (select public.user_clinic_ids()));
create policy "admin cria modelo" on public.message_template
  for insert with check (public.user_has_role(clinic_id, array['admin']));
create policy "admin edita modelo" on public.message_template
  for update using (public.user_has_role(clinic_id, array['admin']))
  with check (public.user_has_role(clinic_id, array['admin']));
create policy "admin remove modelo" on public.message_template
  for delete using (public.user_has_role(clinic_id, array['admin']));

-- message_pricing: leitura para autenticados; escrita so service role.
create policy "autenticado le precos" on public.message_pricing
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Ingestao idempotente de mensagem recebida (nucleo do webhook)
-- ---------------------------------------------------------------------------
-- Resolve atomicamente: contato (upsert por telefone), consentimento
-- source='conversa' na primeira mensagem, conversa aberta (uma por contato),
-- mensagem idempotente por wa_message_id e contadores. Reutilizavel pela
-- futura Edge Function. Execucao restrita ao service role.

create or replace function public.ingest_inbound_message(
  p_clinic_id uuid,
  p_phone_e164 text,
  p_name text,
  p_wa_message_id text,
  p_content_type text default 'texto',
  p_body text default null,
  p_media_url text default null,
  p_transcript text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
begin
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict (clinic_id, phone_e164) do update
    set last_contact_at = now(),
        name = coalesce(contact.name, excluded.name)
  returning id into v_contact_id;

  -- Consentimento automatico source='conversa': quem escreve para a clinica
  -- autoriza a resposta. Disparo proativo continua exigindo consent ativo.
  if not exists (
    select 1 from contact_consent
    where contact_id = v_contact_id and channel = 'whatsapp' and active
  ) then
    insert into contact_consent (clinic_id, contact_id, channel, source, evidence)
    values (p_clinic_id, v_contact_id, 'whatsapp', 'conversa',
            'Primeira mensagem recebida do contato');
  end if;

  -- Uma conversa aberta por contato; corrida resolvida pelo indice unico parcial.
  -- TODO(3.4): quando o agente existir, conversa nova nasce ia_atendendo
  -- conforme a configuracao da clinica.
  insert into conversation (clinic_id, contact_id, status, last_message_at)
  values (p_clinic_id, v_contact_id, 'aguardando_humano', now())
  on conflict (clinic_id, contact_id) where status <> 'resolvida' do nothing;

  select id into v_conversation_id
  from conversation
  where clinic_id = p_clinic_id and contact_id = v_contact_id
    and status <> 'resolvida'
  limit 1;

  insert into message (
    clinic_id, conversation_id, wa_message_id, direction, author,
    content_type, body, media_url, transcript, billable, cost_cents
  ) values (
    p_clinic_id, v_conversation_id, p_wa_message_id, 'entrada', 'paciente',
    coalesce(p_content_type, 'texto'), p_body, p_media_url, p_transcript,
    false, 0
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    update conversation
      set last_message_at = now(),
          unread_count = unread_count + 1
      where id = v_conversation_id;
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id
  );
end;
$$;

revoke execute on function public.ingest_inbound_message from public, anon, authenticated;
grant execute on function public.ingest_inbound_message to service_role;

-- ---------------------------------------------------------------------------
-- Indices (docs/04 secao 9, pertinentes a fase)
-- ---------------------------------------------------------------------------

create index on public.message (conversation_id, created_at desc);
create index on public.conversation (clinic_id, status, last_message_at desc);
create index on public.contact (clinic_id, funnel_stage, last_contact_at desc);
create index on public.contact (clinic_id, source_campaign);
create index on public.contact_consent (contact_id) where active;

-- ---------------------------------------------------------------------------
-- Realtime: Inbox e faixa de conexao atualizam sozinhos
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'conversation') then
      alter publication supabase_realtime add table public.conversation;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'message') then
      alter publication supabase_realtime add table public.message;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'whatsapp_account') then
      alter publication supabase_realtime add table public.whatsapp_account;
    end if;
  end if;
end $$;
