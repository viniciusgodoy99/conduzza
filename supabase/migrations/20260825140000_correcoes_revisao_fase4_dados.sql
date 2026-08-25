-- Correcoes da revisao adversarial do bloco 4.1/4.2 (25/08/2026).
-- Achados confirmados: (1) ALTO consentimento revogado era reativado por
-- qualquer mensagem recebida; (2) ALTO triggers SECURITY DEFINER de funil
-- escreviam em contato de OUTRA clinica via appointment forjado (incluindo o
-- pre-existente converter_lead_em_paciente); (3) MEDIO sem coerencia
-- contact<->clinic em appointment/package_balance/contact_consent/slot_hold;
-- (4) MEDIO papel profissional escrevia package_balance contra a matriz;
-- (5) MEDIO validade de pacote comparada em data UTC, nao no dia civil da
-- clinica.

-- ---------------------------------------------------------------------------
-- (1) ingest_inbound_message v3: mensagem recebida NUNCA desfaz descadastro.
-- O consentimento automatico source='conversa' so nasce quando o par contato+
-- canal NUNCA teve linha nenhuma (nem revogada). Depois de uma revogacao, so
-- o reconsentimento explicito com evidencia (concederConsentimentoAction)
-- reabre o envio; ate la a clinica nao responde nem 1:1, que e o comportamento
-- fail-safe da regra 3.4 (descadastro definitivo ate o paciente autorizar de
-- novo, com registro).
-- ---------------------------------------------------------------------------

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

  -- Consentimento automatico source='conversa' SO na primeira relacao do
  -- contato com o canal: qualquer linha anterior (ativa OU revogada) impede o
  -- insert. Revogou, so reconsentimento explicito com evidencia reabre.
  if not exists (
    select 1 from contact_consent
    where clinic_id = p_clinic_id
      and contact_id = v_contact_id
      and channel = 'whatsapp'
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
-- (2) Triggers SECURITY DEFINER sempre amarrados a clinica da linha que os
-- disparou: um appointment forjado da clinica A referenciando contato da B
-- nao toca mais o contato da B (e o item 3 impede o proprio appointment).
-- ---------------------------------------------------------------------------

create or replace function public.converter_lead_em_paciente()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update contact
  set kind = 'paciente'
  where id = new.contact_id
    and clinic_id = new.clinic_id
    and kind = 'lead';
  return new;
end;
$$;

create or replace function public.avancar_funil_ao_agendar()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update contact
     set funnel_stage = 'agendou', lost_reason = null, lost_reason_note = null
   where id = new.contact_id
     and clinic_id = new.clinic_id
     and funnel_stage in ('novo', 'em_contato', 'aguardando_resposta', 'perdido');
  return new;
end;
$$;

create or replace function public.avancar_funil_ao_comparecer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update contact set funnel_stage = 'compareceu'
   where id = new.contact_id
     and clinic_id = new.clinic_id
     and funnel_stage <> 'compareceu';
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- (3) Coerencia contato <-> clinica no banco: linha que referencia contato de
-- OUTRA clinica nao nasce. A FK simples nao confere tenant; este trigger
-- confere, para qualquer papel (inclusive service role).
-- ---------------------------------------------------------------------------

create or replace function public.exigir_contato_da_mesma_clinica()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  if new.contact_id is null then
    return new;
  end if;
  select clinic_id into v_clinic_id from contact where id = new.contact_id;
  if v_clinic_id is distinct from new.clinic_id then
    raise exception 'O contato informado não pertence a esta clínica.';
  end if;
  return new;
end;
$$;

create trigger exigir_contato_da_mesma_clinica
  before insert or update of contact_id on public.appointment
  for each row execute function public.exigir_contato_da_mesma_clinica();

create trigger exigir_contato_da_mesma_clinica
  before insert or update of contact_id on public.package_balance
  for each row execute function public.exigir_contato_da_mesma_clinica();

create trigger exigir_contato_da_mesma_clinica
  before insert or update of contact_id on public.contact_consent
  for each row execute function public.exigir_contato_da_mesma_clinica();

create trigger exigir_contato_da_mesma_clinica
  before insert or update of contact_id on public.slot_hold
  for each row execute function public.exigir_contato_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- (4) Matriz de papeis: profissional VE leads e pacientes, nao escreve.
-- user_can_write inclui profissional (correto para agenda propria); saldo de
-- pacote e dinheiro do paciente, escrita so de admin, gestor e recepcao.
-- ---------------------------------------------------------------------------

drop policy "membro com escrita vende pacote" on public.package_balance;
drop policy "membro com escrita ajusta saldo" on public.package_balance;

create policy "recepcao e gestao vendem pacote" on public.package_balance
  for insert with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));
create policy "recepcao e gestao ajustam saldo" on public.package_balance
  for update using (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']))
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']));

-- ---------------------------------------------------------------------------
-- (5) Validade de pacote no DIA CIVIL da clinica (regra 3.6), nao na data
-- UTC do servidor: o pacote vendido "ate 25/08" vale ate o fim do dia 25/08
-- em Fortaleza, nao ate as 21h locais.
-- ---------------------------------------------------------------------------

create or replace function public.consumir_sessao_de_pacote()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance_id uuid;
  v_hoje_local date;
begin
  if new.package_balance_id is not null then
    return new;  -- ja debitado (compareceu e terminal no dominio; defesa extra)
  end if;
  select (now() at time zone c.timezone)::date into v_hoje_local
    from clinic c where c.id = new.clinic_id;
  select pb.id into v_balance_id
    from package_balance pb
    join package p on p.id = pb.package_id
    join service_link sl on sl.id = new.service_link_id
   where pb.clinic_id = new.clinic_id
     and pb.contact_id = new.contact_id
     and p.procedure_id = sl.procedure_id
     and pb.sessions_used < pb.sessions_total
     and (pb.expires_at is null or pb.expires_at >= v_hoje_local)
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
  cross join lateral (
    select (now() at time zone cl.timezone)::date as hoje_local
    from clinic cl where cl.id = p_clinic_id
  ) tz
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
        where b.expires_at is null or b.expires_at >= tz.hoje_local
      ) as saldo_sessoes,
      sum(b.sessions_total) as saldo_total
    from package_balance b
    where b.contact_id = c.id
  ) pb on true
  where c.clinic_id = p_clinic_id
    and c.kind = 'paciente'
$$;
