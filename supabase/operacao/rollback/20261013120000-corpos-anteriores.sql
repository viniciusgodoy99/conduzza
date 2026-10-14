-- Corpos lidos da producao em 13/10/2026, antes da migration 20261013120000
-- (M2 do E3). ROLLBACK manual da migration (cabecalho dela): reaplicar os
-- dois corpos ANTES do rollback da M3 e da M1. CREATE OR REPLACE mantem os
-- grants de hoje (so service_role).

-- ingest_inbound_message: corpo do banco ANTES da 20261013120000
CREATE OR REPLACE FUNCTION public.ingest_inbound_message(p_clinic_id uuid, p_phone_e164 text, p_name text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_mimetype text DEFAULT NULL::text, p_whatsapp_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contact_id uuid;
  v_contact_created boolean := false;
  v_conversation_id uuid;
  v_conta_da_conversa uuid;
  v_message_id uuid;
  v_filename text;
  v_mimetype text;
  v_conta uuid;
  v_removido_em timestamptz;
begin
  -- NUMERO que recebeu. Nulo e o webhook de hoje, que nao conhece numero:
  -- vale o principal ativo (e nulo se a clinica nao tem numero, como antes).
  if p_whatsapp_account_id is null then
    select id into v_conta
      from whatsapp_account
     where clinic_id = p_clinic_id
       and principal
       and removido_em is null;
  else
    select id, removido_em into v_conta, v_removido_em
      from whatsapp_account
     where id = p_whatsapp_account_id
       and clinic_id = p_clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;
    if v_removido_em is not null then
      -- Corrida com a remocao (a URL do numero removido ja recebe 401):
      -- nada e gravado.
      return jsonb_build_object(
        'inserted', false,
        'ignorada', 'numero_removido',
        'contact_id', null,
        'contact_created', false,
        'conversation_id', null,
        'message_id', null,
        'whatsapp_account_id', v_conta
      );
    end if;
  end if;

  -- FILTRO DE NUMERO PROPRIO (achado 1 do desenho): o numero A da clinica
  -- escrevendo para o numero B nao e paciente. Sem o filtro, o B criava um
  -- contato com o telefone da propria clinica, e a mensagem ainda se perdia
  -- no unique global de wa_message_id (o envio do A ja gravou o mesmo id).
  -- display_phone guarda digitos (ou, em conta antiga, o nome do perfil: sem
  -- 10 a 15 digitos, nao entra na comparacao). A comparacao e pela chave
  -- canonica, que ignora o nono digito.
  if exists (
    select 1
      from whatsapp_account a
     where a.clinic_id = p_clinic_id
       and a.removido_em is null
       and a.display_phone is not null
       and length(regexp_replace(a.display_phone, '\D', '', 'g'))
           between 10 and 15
       and public.chave_telefone(
             '+' || regexp_replace(a.display_phone, '\D', '', 'g')
           ) = public.chave_telefone(p_phone_e164)
  ) then
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_proprio',
      'contact_id', null,
      'contact_created', false,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta
    );
  end if;

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

  -- Uma conversa aberta por contato E NUMERO (decisao 1 do dono). SEM alvo
  -- de proposito: hoje arbitra conversation_aberta_por_contato; na Fase 3,
  -- o indice por numero. Corrida vira "ja existe".
  insert into conversation (
    clinic_id, contact_id, status, last_message_at, whatsapp_account_id
  )
  values (
    p_clinic_id, v_contact_id, 'aguardando_humano', now(), v_conta
  )
  on conflict do nothing;

  -- A conversa aberta DESTE numero, ou uma aberta sem numero (clinica que
  -- ganhou numero depois, ou legado), que este numero adota.
  select id, whatsapp_account_id
    into v_conversation_id, v_conta_da_conversa
  from conversation
  where clinic_id = p_clinic_id and contact_id = v_contact_id
    and status <> 'resolvida'
    and (whatsapp_account_id = v_conta or whatsapp_account_id is null)
  order by (whatsapp_account_id is null)
  limit 1;

  if v_conta is not null
     and v_conversation_id is not null
     and v_conta_da_conversa is null
  then
    update conversation
       set whatsapp_account_id = v_conta
     where id = v_conversation_id
       and whatsapp_account_id is null;
  end if;

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

  -- O numero da mensagem vem da conversa (gatilho mensagem_herda_numero).
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
    'message_id', v_message_id,
    'whatsapp_account_id', v_conta
  );
end;
$function$;

-- registrar_mensagem_do_celular: corpo do banco ANTES da 20261013120000
CREATE OR REPLACE FUNCTION public.registrar_mensagem_do_celular(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_e164 text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_mimetype text DEFAULT NULL::text, p_quoted_wa_message_id text DEFAULT NULL::text, p_enviada_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tipo text := coalesce(p_content_type, 'texto');
  v_conta uuid;
  v_removido_em timestamptz;
  v_existente record;
  v_tentou boolean := false;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_status text;
  v_ultima_entrada timestamptz;
  v_enviada timestamptz;
  v_base timestamptz;
  v_automatica boolean;
  v_derruba_espera boolean;
  v_envio_ultima_entrada timestamptz;
  v_body text;
  v_filename text;
  v_mimetype text;
  v_message_id uuid;
begin
  -- 1) Entrada
  if p_clinic_id is null
     or p_whatsapp_account_id is null
     or p_phone_e164 is null
     or btrim(p_phone_e164) = ''
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica, número e telefone do contato são obrigatórios.';
  end if;
  if p_wa_message_id is null or btrim(p_wa_message_id) = '' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'O id da mensagem no WhatsApp é obrigatório.';
  end if;
  if v_tipo not in ('texto', 'imagem', 'audio', 'documento') then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Tipo de conteúdo inválido para mensagem enviada pelo celular.';
  end if;

  -- 2) Numero
  select a.id, a.removido_em
    into v_conta, v_removido_em
    from public.whatsapp_account a
   where a.id = p_whatsapp_account_id
     and a.clinic_id = p_clinic_id
     for key share;
  if not found then
    raise exception using errcode = 'foreign_key_violation',
      message = 'O número informado não pertence a esta clínica.';
  end if;
  if v_removido_em is not null then
    -- Corrida com a remocao (a URL do numero removido ja recebe 401).
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_removido',
      'contact_id', null,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta,
      'automatica', null
    );
  end if;

  -- Horarios (passo 7): o do payload so vale se plausivel.
  v_enviada := case
    when p_enviada_em between now() - interval '7 days'
                          and now() + interval '1 minute'
    then p_enviada_em
  end;
  v_base := coalesce(v_enviada, now());

  -- 3) Numero proprio: o mesmo filtro da ingestao (display_phone com 10 a
  -- 15 digitos, comparado pela chave canonica, que ignora o nono digito),
  -- aplicado ao DESTINO.
  if exists (
    select 1
      from public.whatsapp_account a
     where a.clinic_id = p_clinic_id
       and a.removido_em is null
       and a.display_phone is not null
       and length(regexp_replace(a.display_phone, '\D', '', 'g'))
           between 10 and 15
       and public.chave_telefone(
             '+' || regexp_replace(a.display_phone, '\D', '', 'g')
           ) = public.chave_telefone(p_phone_e164)
  ) then
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_proprio',
      'contact_id', null,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta,
      'automatica', null
    );
  end if;

  -- 3b) Numero ativo de OUTRA clinica da plataforma: o wa_message_id e da
  -- ingestao de la (unique global; ver o cabecalho). Nada e gravado aqui.
  if exists (
    select 1
      from public.whatsapp_account a
     where a.clinic_id <> p_clinic_id
       and a.removido_em is null
       and a.display_phone is not null
       and length(regexp_replace(a.display_phone, '\D', '', 'g'))
           between 10 and 15
       and public.chave_telefone(
             '+' || regexp_replace(a.display_phone, '\D', '', 'g')
           ) = public.chave_telefone(p_phone_e164)
  ) then
    v_contact_id := public.espera_pelo_celular_sem_linha(
      p_clinic_id, v_conta, p_phone_e164, v_base
    );
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_da_plataforma',
      'contact_id', v_contact_id,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta,
      'automatica', null
    );
  end if;

  loop
    -- 4) Ja gravado? (unique global de wa_message_id: no maximo uma linha)
    select m.id, m.clinic_id, m.conversation_id, m.whatsapp_account_id,
           c.contact_id
      into v_existente
      from public.message m
      join public.conversation c on c.id = m.conversation_id
     where m.wa_message_id = p_wa_message_id;
    if found then
      if v_existente.clinic_id <> p_clinic_id then
        -- Nenhum id da outra clinica sai daqui; o contato e o DESTA.
        v_contact_id := public.espera_pelo_celular_sem_linha(
          p_clinic_id, v_conta, p_phone_e164, v_base
        );
        return jsonb_build_object(
          'inserted', false,
          'ignorada', 'colisao_wa_message_id',
          'contact_id', v_contact_id,
          'conversation_id', null,
          'message_id', null,
          'whatsapp_account_id', v_conta,
          'automatica', null
        );
      end if;
      return jsonb_build_object(
        'inserted', false,
        'contact_id', v_existente.contact_id,
        'conversation_id', v_existente.conversation_id,
        'message_id', v_existente.id,
        'whatsapp_account_id', v_existente.whatsapp_account_id,
        'automatica', null
      );
    end if;
    if v_tentou then
      -- O insert nao entrou e a linha que o impediu ja nao existe (apagada
      -- no meio do caminho). Nao e erro de serializacao do Postgres: codigo
      -- proprio, e o provedor reenvia.
      raise exception using errcode = 'CZ409',
        message = 'A mensagem mudou durante o registro. Tente de novo.';
    end if;
    v_tentou := true;

    -- 5) Contato que ja existe, pela chave canonica (o WhatsApp entrega
    -- +558499990000 e a recepcao cadastrou +5584999990000). Sem insert e
    -- sem update.
    select k.id
      into v_contact_id
      from public.contact k
     where k.clinic_id = p_clinic_id
       and k.phone_key = public.chave_telefone(p_phone_e164);
    if v_contact_id is null then
      return jsonb_build_object(
        'inserted', false,
        'ignorada', 'contato_desconhecido',
        'contact_id', null,
        'conversation_id', null,
        'message_id', null,
        'whatsapp_account_id', v_conta,
        'automatica', null
      );
    end if;

    -- 6) Conversa aberta DESTE numero, travada.
    v_conversation_id := null;
    v_status := null;
    for v_tentativa in 1..3 loop
      v_conversation_id := public.garantir_conversa_aberta(
        p_clinic_id, v_contact_id, v_conta
      );
      select c.status, c.last_inbound_at
        into v_status, v_ultima_entrada
        from public.conversation c
       where c.id = v_conversation_id
         for no key update;
      exit when found and v_status <> 'resolvida';
      v_conversation_id := null;
    end loop;
    if v_conversation_id is null then
      raise exception using errcode = 'CZ409',
        message = 'A conversa mudou durante o registro. Tente de novo.';
    end if;

    -- 8) Resposta automatica do app Business e espera (ver o passo 8 no
    -- comentario acima). A ultima mensagem do paciente e a de chegada mais
    -- recente da conversa, a mesma que deu o last_inbound_at.
    select m.enviada_no_aparelho_em
      into v_envio_ultima_entrada
      from public.message m
     where m.conversation_id = v_conversation_id
       and m.direction = 'entrada'
     order by m.created_at desc, m.id desc
     limit 1;
    if v_enviada is not null and v_envio_ultima_entrada is not null then
      v_automatica := exists (
        select 1
          from public.message m
         where m.conversation_id = v_conversation_id
           and m.direction = 'entrada'
           and m.created_at >= v_enviada - interval '1 minute'
           and m.enviada_no_aparelho_em
               between v_enviada - interval '8 seconds'
                   and v_enviada + interval '2 seconds'
      );
      v_derruba_espera :=
        v_envio_ultima_entrada < v_enviada - interval '8 seconds';
    else
      v_automatica := v_ultima_entrada is not null
        and v_ultima_entrada between v_base - interval '8 seconds'
                                 and v_base + interval '10 seconds';
      v_derruba_espera := v_ultima_entrada is null
        or v_ultima_entrada < v_base - interval '8 seconds';
    end if;

    -- Saneamento, o mesmo da ingestao. Texto em branco vira nulo.
    v_body := nullif(btrim(p_body, E' \t\r\n'), '');
    v_filename := nullif(
      btrim(left(regexp_replace(coalesce(p_media_filename, ''),
                                '[[:cntrl:]/\\]', '', 'g'), 200)),
      ''
    );
    v_mimetype := lower(btrim(split_part(coalesce(p_media_mimetype, ''), ';', 1)));
    if v_mimetype !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
       or length(v_mimetype) > 100 then
      v_mimetype := null;
    end if;

    -- 9) A linha. O numero vem da conversa (gatilho mensagem_herda_numero);
    -- created_at e o default now() (hora de chegada, como a ingestao).
    insert into public.message (
      clinic_id, conversation_id, wa_message_id, direction, author,
      author_user_id, content_type, body, media_url, media_filename,
      media_mimetype, billable, cost_cents, delivery_status, pelo_celular,
      reply_to_wa_message_id, enviada_no_aparelho_em
    ) values (
      p_clinic_id, v_conversation_id, p_wa_message_id, 'saida',
      case when v_automatica then 'sistema' else 'usuario' end,
      null, v_tipo, v_body, nullif(btrim(p_media_url), ''), v_filename,
      v_mimetype, false, 0, 'enviada', true,
      nullif(btrim(p_quoted_wa_message_id), ''), v_enviada
    )
    on conflict (wa_message_id) do nothing
    returning id into v_message_id;

    exit when v_message_id is not null;
  end loop;

  -- 10) Conversa
  update public.conversation c
     set last_message_at = greatest(coalesce(c.last_message_at, now()), now()),
         -- A resposta automatica nao e ninguem atendendo: derrubar a espera
         -- por ela fazia toda conversa da noite sumir de "Aguardando voce".
         -- A pergunta que chegou depois do envio tambem segue esperando.
         awaiting_reply = case when v_derruba_espera then false else c.awaiting_reply end
   where c.id = v_conversation_id;

  return jsonb_build_object(
    'inserted', true,
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'whatsapp_account_id', v_conta,
    'automatica', v_automatica
  );
end;
$function$;

notify pgrst, 'reload schema';
