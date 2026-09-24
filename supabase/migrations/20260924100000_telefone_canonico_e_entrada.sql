-- Telefone canonico e entrada do WhatsApp (revisao de liberacao, 24/09/2026).
--
-- Cinco coisas, todas na porta de entrada do contato e da mensagem:
--
-- 1. NONO DIGITO. O WhatsApp entrega o celular de muitos DDDs SEM o 9
--    (+558499990000) e o cadastro manual grava COM ele (+5584999990000). O
--    ingest casava por texto exato: a mesma pessoa virava dois contatos, a
--    resposta "1" ao toque de confirmacao caia no contato novo e a consulta
--    ficava aguardando para sempre. Agora existe UMA chave canonica
--    (chave_telefone, espelho de lib/domain/telefone.ts:chaveDeTelefone),
--    materializada em contact.phone_key com indice unico por clinica, e o
--    ingest acha o contato por ela.
--    Conferido em producao antes de escrever: nenhum par de contatos da mesma
--    clinica colide pela chave (0 linhas), entao o indice unico nasce limpo.
--    O indice unico antigo de phone_e164 continua: nenhum caminho depende de
--    remove-lo e ele segue barrando texto repetido.
--
-- 2. IA ATENDENDO SEM AGENTE. Nao existe agente de IA (a tela /agente e
--    placeholder). Conversa em 'ia_atendendo' nao aparece no contador nem em
--    "Aguardando voce": o paciente escrevia e ninguem via. O ingest passa a
--    tira-la desse estado, e as que estiverem nele hoje (0 em producao na
--    conferencia) voltam para a fila.
--
-- 3. FIGURINHA. O parser nao reconhecia sticker e gravava 'texto' com midia;
--    a bolha tratava como video quebrado. O parser foi corrigido; aqui as
--    linhas antigas passam a 'imagem' pelo mimetype REAL do arquivo guardado
--    no Storage (59 linhas image/webp na conferencia).
--
-- 4. NOME E TIPO DO DOCUMENTO. message.media_filename e message.media_mimetype
--    guardam o nome do arquivo e o tipo declarados pelo WhatsApp (a legenda
--    continua no body). Contrato com o grupo de midia: nomes EXATOS.
--
-- 5. ingest_inbound_message ganha os dois parametros novos (opcionais). Troca
--    de assinatura exige drop + create; security definer, search_path e
--    grants (so service_role) preservados.

-- ---------------------------------------------------------------------------
-- 1. Chave canonica do telefone
-- ---------------------------------------------------------------------------

-- MESMA regra de chaveDeTelefone (lib/domain/telefone.ts): +55, DDD que existe
-- e numero local de 8 digitos comecando em 6 a 9 (celular no formato anterior
-- ao nono digito) ganha o 9. Fixo (2 a 5), celular que ja tem o 9,
-- estrangeiro e qualquer coisa fora do padrao voltam iguais. IMMUTABLE porque
-- alimenta coluna gerada; search_path vazio porque so usa pg_catalog.
create or replace function public.chave_telefone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_phone ~ '^\+55[0-9]{2}[6-9][0-9]{7}$'
     and substr(p_phone, 4, 2) = any (array[
       '11','12','13','14','15','16','17','18','19',
       '21','22','24','27','28',
       '31','32','33','34','35','37','38',
       '41','42','43','44','45','46','47','48','49',
       '51','53','54','55',
       '61','62','63','64','65','66','67','68','69',
       '71','73','74','75','77','79',
       '81','82','83','84','85','86','87','88','89',
       '91','92','93','94','95','96','97','98','99'
     ])
    then '+55' || substr(p_phone, 4, 2) || '9' || substr(p_phone, 6)
    else p_phone
  end
$$;

comment on function public.chave_telefone(text) is
  'Forma canonica do telefone para comparar (celular BR sem o nono digito ganha o 9). Espelho EXATO de chaveDeTelefone em lib/domain/telefone.ts.';

alter table public.contact
  add column if not exists phone_key text
    generated always as (public.chave_telefone(phone_e164)) stored;

comment on column public.contact.phone_key is
  'Chave canonica do telefone (chave_telefone(phone_e164)). Unica por clinica: com e sem o nono digito sao a mesma pessoa. Gerada, nunca escrita.';

create unique index if not exists contact_clinic_phone_key_unico
  on public.contact (clinic_id, phone_key);

-- ---------------------------------------------------------------------------
-- 2. Nome e tipo do arquivo recebido
-- ---------------------------------------------------------------------------

alter table public.message
  add column if not exists media_filename text,
  add column if not exists media_mimetype text;

comment on column public.message.media_filename is
  'Nome do arquivo declarado pelo WhatsApp (documento). Saneado: ate 200 caracteres, sem barra nem caractere de controle. A legenda fica no body.';
comment on column public.message.media_mimetype is
  'Tipo do arquivo declarado pelo WhatsApp (ex.: application/pdf). Informativo: o Storage guarda o tipo que o worker aceitou.';

-- ---------------------------------------------------------------------------
-- 3. Ingest: acha pela chave, atualiza para a forma do WhatsApp, tira a
--    conversa de 'ia_atendendo', grava nome e tipo do arquivo
-- ---------------------------------------------------------------------------

drop function if exists public.ingest_inbound_message(
  uuid, text, text, text, text, text, text, text
);

create function public.ingest_inbound_message(
  p_clinic_id uuid,
  p_phone_e164 text,
  p_name text,
  p_wa_message_id text,
  p_content_type text default 'texto',
  p_body text default null,
  p_media_url text default null,
  p_transcript text default null,
  p_media_filename text default null,
  p_media_mimetype text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_contact_id uuid;
  v_contact_created boolean := false;
  v_conversation_id uuid;
  v_message_id uuid;
  v_filename text;
  v_mimetype text;
begin
  -- CONTATO, achado pela CHAVE canonica e nao pelo texto exato: o WhatsApp
  -- entrega +558499990000 e a recepcao cadastrou +5584999990000; e a mesma
  -- pessoa.
  --
  -- ON CONFLICT DO NOTHING SEM alvo de proposito: contact tem DOIS indices
  -- unicos (phone_e164 e phone_key). Com alvo em um so, duas entregas
  -- simultaneas do primeiro contato podiam estourar 23505 no outro indice
  -- (o nao arbitro e conferido na hora e erra em vez de esperar). Sem alvo,
  -- todos os unicos arbitram e a corrida vira "ja existe".
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict do nothing
  returning id into v_contact_id;

  if v_contact_id is not null then
    v_contact_created := true;
  else
    -- Ja existia (inclusive gravado pela recepcao na OUTRA forma). O telefone
    -- passa a ser o que o WhatsApp entregou: e a forma que com certeza recebe
    -- mensagem, e o toque seguinte vai para ela.
    update contact
      set last_contact_at = now(),
          name = coalesce(contact.name, nullif(trim(p_name), '')),
          phone_e164 = p_phone_e164
      where clinic_id = p_clinic_id
        and phone_key = public.chave_telefone(p_phone_e164)
      returning id into v_contact_id;
  end if;

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

  -- Nome do arquivo: defesa em profundidade (o parser ja saneia). Sem barra
  -- nem caractere de controle, ate 200 caracteres; vazio vira nulo.
  v_filename := nullif(
    btrim(left(regexp_replace(coalesce(p_media_filename, ''),
                              '[[:cntrl:]/\\]', '', 'g'), 200)),
    ''
  );
  -- Tipo: so o formato tipo/subtipo, minusculo e sem parametros ("audio/ogg;
  -- codecs=opus" vira "audio/ogg"); qualquer outra coisa e nulo.
  v_mimetype := lower(btrim(split_part(coalesce(p_media_mimetype, ''), ';', 1)));
  if v_mimetype !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
     or length(v_mimetype) > 100 then
    v_mimetype := null;
  end if;

  insert into message (
    clinic_id, conversation_id, wa_message_id, direction, author,
    content_type, body, media_url, transcript, billable, cost_cents,
    media_filename, media_mimetype
  ) values (
    p_clinic_id, v_conversation_id, p_wa_message_id, 'entrada', 'paciente',
    coalesce(p_content_type, 'texto'), p_body, p_media_url, p_transcript,
    false, 0,
    v_filename, v_mimetype
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
          awaiting_reply = true,
          -- Enquanto nao houver agente de IA, nenhuma conversa fica num
          -- estado que ninguem atende: o paciente escreveu, a conversa volta
          -- para a fila da recepcao (contador do menu e "Aguardando voce").
          status = case
            when status = 'ia_atendendo' then 'aguardando_humano'
            else status
          end
      where id = v_conversation_id;
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'contact_created', v_contact_created,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id
  );
end;
$function$;

revoke all on function public.ingest_inbound_message(
  uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(
  uuid, text, text, text, text, text, text, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Conversas presas em 'ia_atendendo' sem responsavel voltam para a fila
-- ---------------------------------------------------------------------------

-- Na conferencia de 24/09/2026 eram 0. O update fica para o caso de alguem ter
-- clicado "Devolver para a IA" entre a conferencia e a aplicacao.
update public.conversation
  set status = 'aguardando_humano'
  where status = 'ia_atendendo'
    and assignee_user_id is null;

-- ---------------------------------------------------------------------------
-- 5. Figurinhas antigas gravadas como 'texto' passam a 'imagem'
-- ---------------------------------------------------------------------------

-- Criterio seguro: o arquivo JA baixado para o Storage (caminho
-- clinic_id/message_id no balde midia-conversas, o mesmo do worker) tem
-- mimetype de imagem. So mensagem de ENTRADA com content_type 'texto': video
-- (video/mp4) nao casa e fica como esta. Na conferencia: 59 linhas, todas
-- image/webp.
update public.message m
  set content_type = 'imagem'
  from storage.objects o
  where o.bucket_id = 'midia-conversas'
    and o.name = m.clinic_id::text || '/' || m.id::text
    and o.metadata ->> 'mimetype' like 'image/%'
    and m.content_type = 'texto'
    and m.direction = 'entrada';
