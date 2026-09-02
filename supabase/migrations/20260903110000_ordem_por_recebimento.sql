-- ---------------------------------------------------------------------------
-- A fila do Atendimento passa a ser ordem de RECEBIMENTO
-- ---------------------------------------------------------------------------
-- QUEIXA QUE ISTO RESOLVE. "Precisa estar na ordem de recebimento": responder
-- uma conversa antiga a jogava para o topo. A causa e que last_message_at e
-- escrito nos DOIS sentidos: no recebimento (ingest_inbound_message) e tambem
-- no envio (lib/integrations/whatsapp/send.ts:457-466). O campo mede "ultima
-- atividade", nao "ultima fala do paciente", e a lista mostra esse mesmo campo
-- como horario, entao a coluna de horarios parecia embaralhar sozinha.
--
-- POR QUE COLUNA NOVA E NAO REDEFINIR last_message_at. Quatro consumidores leem
-- last_message_at como atividade (lib/queries/leads.ts:183,
-- lib/queries/pacientes.ts:278, e as duas listas do Inbox). Mudar o significado
-- da coluna consertaria uma tela e estragaria as outras em silencio.
--
-- POR QUE NAO ORDENAR POR EXPRESSAO. Ordenar por "o maior created_at das
-- mensagens de entrada" vira subconsulta correlacionada, que o PostgREST nao
-- aceita em .order() e que custaria uma varredura por conversa a cada carga do
-- Inbox.
-- ---------------------------------------------------------------------------

alter table public.conversation
  add column if not exists last_inbound_at timestamptz;

comment on column public.conversation.last_inbound_at is
  'Quando o PACIENTE falou pela ultima vez. Escrita SO no recebimento. E a chave de ordenacao do Inbox: responder nao pode mover a conversa de lugar. Nao confundir com last_message_at, que e ultima atividade (inclui envio da clinica) e continua alimentando Leads e Pacientes.';

-- Preenche o historico: sem isto toda conversa existente ficaria nula e cairia
-- para o fim da lista, o que pareceria perda de dado.
update public.conversation c
set last_inbound_at = (
  select max(m.created_at)
  from public.message m
  where m.conversation_id = c.id
    and m.direction = 'entrada'
)
where last_inbound_at is null;

-- Indice da ordenacao do Inbox. Parcial pelo mesmo recorte da consulta
-- (lib/queries/conversations.ts:91-106 filtra status <> 'resolvida'), para o
-- indice ser pequeno e servir de fato ao order by.
create index if not exists conversation_fila_idx
  on public.conversation (clinic_id, last_inbound_at desc nulls last)
  where status <> 'resolvida';

-- ---------------------------------------------------------------------------
-- A RPC de ingestao passa a carimbar a coluna nova
-- ---------------------------------------------------------------------------
-- MESMA assinatura da versao vigente, com os mesmos valores padrao. Isso nao e
-- detalhe: acrescentar parametro criaria uma SEGUNDA funcao e o PostgREST
-- devolveria PGRST203 por ambiguidade, parando de ingerir mensagem de
-- paciente; e mudar os defaults faz o Postgres recusar o replace.
--
-- A definicao abaixo foi EXTRAIDA DO BANCO com pg_get_functiondef e tem uma
-- linha a mais. Reescreve-la de memoria apagaria o bloco que cria o
-- consentimento automatico do paciente na primeira mensagem, que e o registro
-- de autorizacao para receber mensagens exigido pela LGPD.

CREATE OR REPLACE FUNCTION public.ingest_inbound_message(p_clinic_id uuid, p_phone_e164 text, p_name text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          -- A chave de ordenacao do Inbox. Escrita SO aqui, no recebimento:
          -- responder nao pode mover a conversa de lugar.
          last_inbound_at = now(),
          unread_count = unread_count + 1,
          awaiting_reply = true
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
$function$;

revoke execute on function public.ingest_inbound_message(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(uuid, text, text, text, text, text, text, text)
  to service_role;
