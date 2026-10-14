-- ---------------------------------------------------------------------------
-- E3, a IA no WhatsApp: funcoes quentes da ingestao e do celular (13/10/2026)
-- ---------------------------------------------------------------------------
-- Plano aprovado pelo dono em 13/10/2026; contrato em
-- ~/.claude/plans/e3-whatsapp/contrato.md (secoes 2.31 e 2.32). Esta e a M2
-- de tres e a ULTIMA a ser aplicada (ordem: M1 20261013100000, M3
-- 20261013110000, esta): quando a ingestao puder por conversa na IA, o
-- gatilho de message (M3) ja protege as linhas 'ia'.
--
-- So CREATE OR REPLACE FUNCTION, partindo do corpo de PRODUCAO de
-- 13/10/2026 (guardado em
-- supabase/operacao/rollback/20261013120000-corpos-anteriores.sql). Mesma
-- assinatura, mesmo search_path, mesmos grants. Cada trecho novo esta entre
-- "-- [resposta da ia] inicio" e "-- [resposta da ia] fim".
--
--   1. ingest_inbound_message: depois do filtro numero_proprio, uma
--      pre-checagem barata (o telefone esta ATIVO em ia_contato_liberado da
--      clinica?). Sem ela, o caminho e o de hoje linha a linha (a salud-care
--      e as outras clinicas nunca entram no ramo novo: nao podem ter linha
--      de telefone). Com ela: FOR SHARE em ia_liberacao e ia_interruptor
--      antes da conversa; conversa NOVA nasce na IA se ia_atende_no_whatsapp
--      (com o teto de 24 h), e ganha a janela; conversa que JA esta na IA
--      continua se ia_pode_falar_com (sem o teto); conversa que ja existia
--      (em_atendimento ou aguardando_humano) NUNCA entra; se a IA esta
--      parada para esse telefone (as duas funcoes de decisao dizem nao,
--      inclusive pelo sinal de paciente sem o forcar), o fio ganha o evento
--      'parada'; corrida de status (Assumir ou passagem comitando no meio)
--      nao grava evento. O retorno ganha ia_atendendo (falso nos ramos
--      ignorada e quando nada entrou).
--   2. registrar_mensagem_do_celular: linha de PESSOA (nao a resposta
--      automatica do app) numa conversa que estava na IA tira a conversa da
--      IA com o evento 'celular', sem mexer em awaiting_reply, e cancela o
--      pendente; o eco do envio da propria IA so quando o CORPO bate (hash
--      de uma decisao aprovada da conversa nos ultimos 10 min, ou a frase
--      fixa logo depois de a IA mandar a frase) nao tira. Qualquer outro
--      texto da pessoa tira. Fora de conversa na IA, nada muda.
--
-- NADA LIGA SOZINHO: com nenhum telefone ativo em ia_contato_liberado (a
-- linha atual da teste123 continua como esta, e ia_atende_no_whatsapp e
-- falso enquanto a teste123 estiver em simulador e o interruptor
-- desligado), o ramo novo nunca devolve verdadeiro.
--
-- LOCKS: nenhuma trava de tabela (so CREATE OR REPLACE FUNCTION). Horario
-- calmo. Nenhum ALTER.
--
-- ROLLBACK manual: reaplicar os dois corpos de
-- supabase/operacao/rollback/20261013120000-corpos-anteriores.sql (antes do
-- rollback da M3 e da M1, que apagam as funcoes que estes corpos chamam).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) ingest_inbound_message
-- ---------------------------------------------------------------------------

create or replace function public.ingest_inbound_message(p_clinic_id uuid, p_phone_e164 text, p_name text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_mimetype text DEFAULT NULL::text, p_whatsapp_account_id uuid DEFAULT NULL::uuid)
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
  -- [resposta da ia] inicio
  v_candidata boolean := false;
  v_ia_nova boolean := false;
  v_ia_segue boolean := false;
  v_conversa_nova uuid;
  v_status_antes text;
  v_status text;
  -- [resposta da ia] fim
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
        'whatsapp_account_id', v_conta,
        -- [resposta da ia] inicio
        'ia_atendendo', false
        -- [resposta da ia] fim
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
      'whatsapp_account_id', v_conta,
      -- [resposta da ia] inicio
      'ia_atendendo', false
      -- [resposta da ia] fim
    );
  end if;

  -- [resposta da ia] inicio
  -- PRE-CHECAGEM DA IA (E3, 13/10/2026): so o telefone ATIVO na lista de
  -- telefones da equipe (ia_contato_liberado) entra no ramo novo. Sem ela,
  -- o caminho e o de antes, linha a linha. Com ela, trava a liberacao e o
  -- interruptor em FOR SHARE antes de tocar a conversa (a mesma ordem das
  -- definir_*) e decide duas coisas: se uma conversa NOVA nasce na IA (com o
  -- teto de 24 h) e se a conversa que JA esta na IA continua (sem o teto).
  v_candidata := exists (
    select 1 from public.ia_contato_liberado k
     where k.clinic_id = p_clinic_id
       and k.ativo
       and k.phone_key = public.chave_telefone(btrim(p_phone_e164))
  );
  if v_candidata then
    perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for share;
    perform 1 from public.ia_interruptor i where i.id for share;
    v_ia_nova := public.ia_atende_no_whatsapp(p_clinic_id, v_conta, p_phone_e164);
    v_ia_segue := public.ia_pode_falar_com(p_clinic_id, v_conta, p_phone_e164);
  end if;
  -- [resposta da ia] fim

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
  on conflict do nothing
  -- [resposta da ia] inicio
  returning id into v_conversa_nova;
  -- [resposta da ia] fim

  -- A conversa aberta DESTE numero, ou uma aberta sem numero (clinica que
  -- ganhou numero depois, ou legado), que este numero adota.
  -- [resposta da ia] o status de antes tambem (v_status_antes)
  select id, whatsapp_account_id, status
    into v_conversation_id, v_conta_da_conversa, v_status_antes
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
          -- [resposta da ia] inicio
          -- Nenhuma conversa fica num estado que ninguem atende: o paciente
          -- escreveu e a IA nao pode mais falar com ele, a conversa volta
          -- para a fila da recepcao (contador do menu e "Aguardando voce").
          -- So a conversa NOVA deste telefone liberado nasce na IA; nunca uma
          -- que ja existia (em_atendimento ou aguardando_humano).
          status = case
            when status = 'ia_atendendo' and coalesce(v_ia_segue, false) then 'ia_atendendo'
            when status = 'ia_atendendo' then 'aguardando_humano'
            when id = v_conversa_nova and status = 'aguardando_humano'
                 and coalesce(v_ia_nova, false) then 'ia_atendendo'
            else status
          end
          -- [resposta da ia] fim
      where id = v_conversation_id
      -- [resposta da ia] inicio
      returning status into v_status;
      -- [resposta da ia] fim

    -- [resposta da ia] inicio
    if v_candidata then
      if v_status = 'ia_atendendo' and v_conversation_id = v_conversa_nova then
        -- A janela da conversa: a IA so le o que chegou a partir daqui.
        insert into public.ia_janela_da_conversa (
          conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por, updated_at
        ) values (
          v_conversation_id, p_clinic_id, v_contact_id,
          public.chave_telefone(btrim(p_phone_e164)), now(), 'ingestao', now()
        )
        on conflict (conversation_id) do update
          set clinic_id = excluded.clinic_id,
              contact_id = excluded.contact_id,
              phone_key = excluded.phone_key,
              desde = excluded.desde,
              aberta_por = excluded.aberta_por,
              updated_at = excluded.updated_at;
      elsif v_status is distinct from 'ia_atendendo'
            and ((v_status_antes = 'ia_atendendo' and not coalesce(v_ia_segue, false))
                 or (v_conversation_id = v_conversa_nova and not coalesce(v_ia_nova, false))) then
        -- O telefone e da equipe, mas o assistente esta parado para ele: a
        -- equipe ve o porque no fio. So quando o motivo e a IA parada; a
        -- conversa que saiu da IA por outra transacao no meio (Assumir,
        -- passagem do executor) nao ganha evento.
        insert into public.message (
          clinic_id, conversation_id, direction, author, content_type, body,
          billable, cost_cents
        ) values (
          p_clinic_id, v_conversation_id, 'saida', 'sistema', 'evento',
          public.rotulo_do_motivo_da_ia('parada'), false, 0
        );
      end if;
    end if;
    -- [resposta da ia] fim
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'contact_created', v_contact_created,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'whatsapp_account_id', v_conta,
    -- [resposta da ia] inicio
    'ia_atendendo', coalesce(v_message_id is not null and v_status = 'ia_atendendo', false)
    -- [resposta da ia] fim
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) registrar_mensagem_do_celular
-- ---------------------------------------------------------------------------

create or replace function public.registrar_mensagem_do_celular(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_e164 text, p_wa_message_id text, p_content_type text DEFAULT 'texto'::text, p_body text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_mimetype text DEFAULT NULL::text, p_quoted_wa_message_id text DEFAULT NULL::text, p_enviada_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
  -- [resposta da ia] inicio
  v_eco boolean;
  -- [resposta da ia] fim
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

  -- [resposta da ia] inicio
  -- Alguem respondeu pelo celular numa conversa da IA (E3, 13/10/2026): a
  -- conversa sai da IA (evento 'celular', pendente cancelado), sem mexer em
  -- awaiting_reply (vale a regra de chegada acima). So conversa que estava
  -- na IA (status lido com a trava do passo 6) e so linha de PESSOA: a
  -- resposta automatica do app nao tira. O eco do proprio envio da IA,
  -- chegando antes de o envio gravar o wa_message_id, tambem nao tira, mas
  -- so quando o CORPO bate (B3 da revisao): hash de uma decisao aprovada da
  -- conversa, ou a frase fixa. Outro texto da pessoa sempre tira.
  if v_status = 'ia_atendendo' and not coalesce(v_automatica, false) then
    v_eco := exists (
      select 1
        from public.ai_decision_log d
       where d.conversation_id = v_conversation_id
         and d.aprovado
         and d.created_at >= now() - interval '10 minutes'
         and d.texto_sha256 in (
           encode(sha256(convert_to(p_body, 'UTF8')), 'hex'),
           encode(sha256(convert_to(v_body, 'UTF8')), 'hex')
         )
    )
    or (
      v_body = public.frase_de_escalonamento_da_ia()
      and exists (
        select 1
          from public.message m
          join public.job_queue j on j.id = m.job_id
         where m.conversation_id = v_conversation_id
           and m.id <> v_message_id
           and m.direction = 'saida'
           and m.author = 'sistema'
           and m.created_at >= now() - interval '10 minutes'
           and j.kind = 'responder_com_ia'
      )
    );
    if not coalesce(v_eco, false) then
      perform public.ia_tirar_conversa(v_conversation_id, 'celular', null);
    end if;
  end if;
  -- [resposta da ia] fim

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
