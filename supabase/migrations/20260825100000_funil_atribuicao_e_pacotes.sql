-- Fase 4, tarefas 4.1 e 4.2: funil de leads, atribuicao de origem e pacotes.
--
-- A Fase 3 (agente de IA) foi ADIADA por decisao do dono em 25/08/2026: tudo
-- aqui e deterministico. contact e contact_consent ja existem desde a Fase 1;
-- esta migration entrega o que faltava da 4.1 (package_balance, correcoes de
-- contact), a configuracao de atribuicao (campaign_link), a automacao de
-- funil por trigger e as RPCs de apoio das telas de Leads e Pacientes.

-- ---------------------------------------------------------------------------
-- contact: correcoes e taxonomias
-- ---------------------------------------------------------------------------

-- FK sem indice (pendencia da regra "toda FK indexada").
create index on public.contact (owner_user_id);

-- Os 8 canais de origem (spec 10.2, padrao HubSpot). Banco vazio de origem
-- confirmado antes do check.
alter table public.contact add constraint contact_source_channel_valido
  check (source_channel is null or source_channel in (
    'trafego_pago', 'busca_organica', 'redes_sociais', 'doctoralia_diretorios',
    'indicacao', 'retorno', 'offline', 'direto'));

alter table public.contact add constraint contact_source_method_valido
  check (source_method is null or source_method in (
    'link_token', 'mensagem_padrao', 'palavra_chave', 'manual', 'importacao'));

-- Motivo de perda: enum fechado dos 5 da spec 5.9 + 'outro' com nota livre.
-- O aceite da 4.3 ("arrastar para Perdido exige motivo") vale NO BANCO, nao
-- so na action.
alter table public.contact add column lost_reason_note text;
alter table public.contact add constraint contact_lost_reason_valido
  check (lost_reason is null or lost_reason in (
    'preco', 'distancia', 'horario', 'nao_respondeu',
    'agendou_em_outro_lugar', 'outro'));
alter table public.contact add constraint contact_perdido_exige_motivo
  check (funnel_stage <> 'perdido' or lost_reason is not null);
alter table public.contact add constraint contact_outro_exige_nota
  check (lost_reason is distinct from 'outro' or lost_reason_note is not null);

-- Origem "preservada para sempre" (docs/04) com dente: capturada uma vez,
-- nunca muda, para NINGUEM (o trigger dispara para qualquer papel, inclusive
-- service role). Preencher quando ainda esta vazia continua permitido.
create or replace function public.impedir_reatribuicao_de_origem()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.source_channel is not null and (
       new.source_channel     is distinct from old.source_channel
    or new.source_origin      is distinct from old.source_origin
    or new.source_medium      is distinct from old.source_medium
    or new.source_campaign    is distinct from old.source_campaign
    or new.source_method      is distinct from old.source_method
    or new.source_captured_at is distinct from old.source_captured_at
  ) then
    raise exception 'A origem do contato é capturada uma vez e preservada para sempre.';
  end if;
  return new;
end;
$$;

create trigger impedir_reatribuicao_de_origem
  before update on public.contact
  for each row execute function public.impedir_reatribuicao_de_origem();

-- ---------------------------------------------------------------------------
-- campaign_link: configuracao de atribuicao (uma linha = uma campanha)
-- ---------------------------------------------------------------------------
-- Os 3 mecanismos deterministicos vivem na mesma linha: token do link
-- click-to-WhatsApp, mensagem padrao exata do anuncio e palavras-chave.
-- "Pergunta da IA" (4o mecanismo da spec) chega com a fase do agente.

create table public.campaign_link (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  name text not null,
  token text,                     -- codigo curto do link; nulo em regra so de palavra-chave
  channel text not null check (channel in (
    'trafego_pago', 'busca_organica', 'redes_sociais', 'doctoralia_diretorios',
    'indicacao', 'retorno', 'offline', 'direto')),
  origin text,
  medium text,
  campaign text,
  default_message text,           -- texto EXATO pre-preenchido do anuncio
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index campaign_link_token_unico
  on public.campaign_link (clinic_id, upper(token)) where token is not null;
create index on public.campaign_link (clinic_id) where active;

create trigger set_updated_at before update on public.campaign_link
  for each row execute function public.set_updated_at();

alter table public.campaign_link enable row level security;
create policy "membro le campanhas" on public.campaign_link
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "gestao gerencia campanhas" on public.campaign_link
  for all using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- ---------------------------------------------------------------------------
-- package_balance: saldo de sessoes do paciente (docs/04 secao 3)
-- ---------------------------------------------------------------------------

create table public.package_balance (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  package_id uuid not null references public.package (id),
  sessions_total integer not null check (sessions_total > 0),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sessions_used <= sessions_total)
);

create index on public.package_balance (clinic_id);
create index on public.package_balance (contact_id);
create index on public.package_balance (package_id);

create trigger set_updated_at before update on public.package_balance
  for each row execute function public.set_updated_at();

alter table public.package_balance enable row level security;
create policy "membro le saldo de pacote" on public.package_balance
  for select using (clinic_id in (select public.user_active_clinic_ids()));
create policy "membro com escrita vende pacote" on public.package_balance
  for insert with check (public.user_can_write(clinic_id));
create policy "membro com escrita ajusta saldo" on public.package_balance
  for update using (public.user_can_write(clinic_id))
  with check (public.user_can_write(clinic_id));
create policy "gestao remove saldo" on public.package_balance
  for delete using (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- Rastreio do consumo: qual saldo esta consulta debitou. Nulo = avulsa.
alter table public.appointment
  add column package_balance_id uuid references public.package_balance (id);
create index on public.appointment (package_balance_id);

-- ---------------------------------------------------------------------------
-- Automacao de funil (triggers; padrao converter_lead_em_paciente, que fica
-- intocado cuidando so de kind)
-- ---------------------------------------------------------------------------

-- Criar consulta move o funil para 'agendou', SO avancando. 'perdido' e
-- elegivel de proposito: lead perdido que agenda deixou de estar perdido, e o
-- motivo de perda e limpo junto. Etapa ja em 'agendou'/'compareceu' nunca
-- regride por automacao.
create or replace function public.avancar_funil_ao_agendar()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update contact
     set funnel_stage = 'agendou', lost_reason = null, lost_reason_note = null
   where id = new.contact_id
     and funnel_stage in ('novo', 'em_contato', 'aguardando_resposta', 'perdido');
  return new;
end;
$$;

create trigger avancar_funil_ao_agendar
  after insert on public.appointment
  for each row execute function public.avancar_funil_ao_agendar();

-- Compareceu na agenda = topo do funil (o que o produto vende). Nunca regride.
create or replace function public.avancar_funil_ao_comparecer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update contact set funnel_stage = 'compareceu'
   where id = new.contact_id and funnel_stage <> 'compareceu';
  return new;
end;
$$;

create trigger avancar_funil_ao_comparecer
  after update of status on public.appointment
  for each row
  when (new.status = 'compareceu' and old.status is distinct from new.status)
  execute function public.avancar_funil_ao_comparecer();

-- ---------------------------------------------------------------------------
-- Consumo de sessao de pacote no comparecimento
-- ---------------------------------------------------------------------------
-- Trigger (e nao codigo na action) porque 'compareceu' sera setado por
-- caminhos multiplos (recepcao hoje, RPC de confirmacao, IA e PMS no futuro)
-- e saldo errado e cobranca errada: o debito e atomico com a mudanca de
-- status e impossivel de esquecer. Casamento deterministico: o procedimento
-- do vinculo da consulta e o procedimento do pacote. Debita primeiro o saldo
-- que vence primeiro. Sem saldo valido, a consulta e avulsa.

create or replace function public.consumir_sessao_de_pacote()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance_id uuid;
begin
  if new.package_balance_id is not null then
    return new;  -- ja debitado (compareceu e terminal no dominio; defesa extra)
  end if;
  select pb.id into v_balance_id
    from package_balance pb
    join package p on p.id = pb.package_id
    join service_link sl on sl.id = new.service_link_id
   where pb.clinic_id = new.clinic_id
     and pb.contact_id = new.contact_id
     and p.procedure_id = sl.procedure_id
     and pb.sessions_used < pb.sessions_total
     and (pb.expires_at is null or pb.expires_at >= current_date)
   order by pb.expires_at asc nulls last, pb.created_at asc
   limit 1
   for update of pb skip locked;
  if v_balance_id is not null then
    update package_balance
       set sessions_used = sessions_used + 1
     where id = v_balance_id;
    new.package_balance_id := v_balance_id;
  end if;
  return new;
end;
$$;

create trigger consumir_sessao_de_pacote
  before update of status on public.appointment
  for each row
  when (new.status = 'compareceu' and old.status is distinct from new.status)
  execute function public.consumir_sessao_de_pacote();

-- ---------------------------------------------------------------------------
-- ingest_inbound_message v2: sinaliza contato NOVO (gancho da atribuicao)
-- ---------------------------------------------------------------------------
-- Mesma assinatura; o retorno ganha contact_created. A atribuicao roda no
-- codigo (lib/integrations/whatsapp/ingest.ts) SO quando o contato nasceu:
-- fora do caminho critico de toda mensagem. (xmax = 0) e o jeito confiavel
-- de distinguir insert de update num on conflict do update.

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
  v_contact_created boolean;
  v_conversation_id uuid;
  v_message_id uuid;
begin
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict (clinic_id, phone_e164) do update
    set last_contact_at = now(),
        name = coalesce(contact.name, excluded.name)
  returning id, (xmax = 0) into v_contact_id, v_contact_created;

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
    'contact_created', coalesce(v_contact_created, false),
    'conversation_id', v_conversation_id,
    'message_id', v_message_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Etiquetas em massa (arrays nao se editam bem via PostgREST; read-modify-
-- write no cliente teria corrida). security invoker: a RLS de contact manda.
-- ---------------------------------------------------------------------------

create or replace function public.etiquetar_contatos(
  p_clinic_id uuid,
  p_contact_ids uuid[],
  p_adicionar text[],
  p_remover text[]
) returns integer
language sql
set search_path = public
as $$
  with alterados as (
    update contact
       set tags = (
         select coalesce(array_agg(distinct t order by t), '{}')
           from unnest(tags || p_adicionar) as t
          where t <> all (p_remover)
       )
     where clinic_id = p_clinic_id and id = any (p_contact_ids)
     returning 1
  )
  select count(*)::integer from alterados
$$;

revoke execute on function public.etiquetar_contatos(uuid, uuid[], text[], text[])
  from public, anon;
grant execute on function public.etiquetar_contatos(uuid, uuid[], text[], text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pacientes_resumo: agregados da lista de Pacientes (Tela 9) numa ida so.
-- security invoker: as policies de contact/appointment/package_balance valem
-- (inclusive o recorte de clinica). A etiqueta de inativo e DERIVADA no
-- cliente a partir de ultima/proxima consulta.
-- ---------------------------------------------------------------------------

create or replace function public.pacientes_resumo(p_clinic_id uuid)
returns table (
  contact_id uuid,
  name text,
  phone_e164 text,
  insurance_id uuid,
  no_show_count integer,
  tags text[],
  ultima_consulta timestamptz,
  proxima_consulta timestamptz,
  total_compareceu bigint,
  total_faltou bigint,
  saldo_sessoes bigint,
  saldo_total bigint
)
language sql stable
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone_e164,
    c.insurance_id,
    c.no_show_count,
    c.tags,
    a.ultima_consulta,
    a.proxima_consulta,
    coalesce(a.total_compareceu, 0),
    coalesce(a.total_faltou, 0),
    coalesce(pb.saldo_sessoes, 0),
    coalesce(pb.saldo_total, 0)
  from contact c
  left join lateral (
    select
      max(ap.starts_at) filter (
        where ap.starts_at <= now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as ultima_consulta,
      min(ap.starts_at) filter (
        where ap.starts_at > now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as proxima_consulta,
      count(*) filter (where ap.status = 'compareceu') as total_compareceu,
      count(*) filter (where ap.status = 'faltou') as total_faltou
    from appointment ap
    where ap.contact_id = c.id
  ) a on true
  left join lateral (
    select
      sum(b.sessions_total - b.sessions_used) filter (
        where b.expires_at is null or b.expires_at >= current_date
      ) as saldo_sessoes,
      sum(b.sessions_total) as saldo_total
    from package_balance b
    where b.contact_id = c.id
  ) pb on true
  where c.clinic_id = p_clinic_id
    and c.kind = 'paciente'
$$;

revoke execute on function public.pacientes_resumo(uuid) from public, anon;
grant execute on function public.pacientes_resumo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime: o Kanban de leads assina contact (a RLS por assinante continua
-- valendo; nunca assinar DELETE, filtro de coluna nao vale para DELETE)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'contact') then
      alter publication supabase_realtime add table public.contact;
    end if;
  end if;
end;
$$;
