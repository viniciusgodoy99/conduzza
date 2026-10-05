-- ---------------------------------------------------------------------------
-- Mensagem enviada pelo celular (Pelo WhatsApp), banco (05/10/2026)
-- ---------------------------------------------------------------------------
-- O que a clinica envia DIRETO pelo WhatsApp do numero pareado (celular,
-- WhatsApp Web, outro aparelho vinculado), sem passar pelo sistema, chega
-- ao webhook como evento "messages" com fromMe (sem wasSentByApi e sem a
-- nossa marca de rastreio). Ate aqui ele so derrubava awaiting_reply e
-- rodava o termo-chave: o conteudo era descartado, e a conversa do Inbox
-- nao mostrava o que o paciente leu. Quem abria a conversa via a pergunta
-- do paciente "sem resposta" e respondia de novo; o "apagar para todos"
-- feito no celular nao deixava rastro; a citacao do paciente a uma mensagem
-- do celular dizia "nao esta neste historico".
--
-- Agora a mensagem VIRA LINHA de message, de saida, marcada pelo_celular,
-- na conversa aberta daquele numero. A interface mostra a bolha com o
-- rotulo "Pelo WhatsApp". Desenho e decisoes em docs/04_modelo_dados.md,
-- secao 16.
--
-- 1. message.pelo_celular boolean not null default false. Autoria da linha:
--    'usuario' sem author_user_id quando e uma PESSOA da clinica (o caso
--    comum), 'sistema' sem author_user_id quando e a RESPOSTA AUTOMATICA do
--    app WhatsApp Business (saudacao, ausencia), reconhecida pelo tempo: a
--    ultima mensagem do paciente (conversation.last_inbound_at) chegou entre
--    8 s antes e 10 s depois do horario de envio do eco (colada nele). Se o
--    eco e processado ANTES da mensagem do paciente (os dois webhooks correm
--    em paralelo), a ingestao corrige depois (reclassificar_resposta_
--    automatica, item 5). Assim nenhum consumidor muda: primeira resposta
--    (so conta 'usuario'),
--    interceptador ("humana" = usuario/ia), exportacao e por_autor ja tratam
--    a pessoa como equipe e a automatica como automacao. Os checks de author
--    (message e conversation.last_preview_author) NAO mudam.
-- 2. CHECK message_pelo_celular_coerente: a linha do celular e sempre de
--    saida, de 'usuario' ou 'sistema', sem pessoa do sistema, sem job, sem
--    nota interna e de texto, imagem, audio ou documento. Com a policy de
--    INSERT de hoje (20260924106000: 'usuario' exige author_user_id =
--    auth.uid(); 'sistema' exige content_type 'evento'), nenhuma sessao
--    consegue forjar o rotulo: so o service role grava pelo_celular.
-- 3. registrar_mensagem_do_celular (so service_role): a gravacao inteira
--    numa transacao (idempotencia por wa_message_id, numero proprio,
--    contato que ja existe, conversa aberta do numero, resposta automatica e
--    a descida da espera). Ver o comentario da funcao (secao 2).
-- 4. adotar_eco_do_envio (so service_role): rede de seguranca do envio. Se
--    o eco de um envio NOSSO escapar dos dois filtros (excludeMessages
--    wasSentByApi e a marca track_source) e for gravado como pelo_celular
--    ANTES de o send.ts gravar o wa_message_id, o update do send.ts bate no
--    unique (23505). Esta funcao apaga a linha do celular e passa o id para
--    a nossa. Ver o comentario da funcao (secao 3).
-- 5. reclassificar_resposta_automatica (so service_role): chamada pela
--    ingestao de cada mensagem do paciente, com o horario de envio dela.
--    Grava esse horario (message.enviada_no_aparelho_em, item 6) e troca
--    para 'sistema' o eco de pessoa que chegou colado nela e saiu depois
--    dela: a resposta automatica do app que correu na frente. Ver o
--    comentario da funcao (secao 4).
-- 6. message.enviada_no_aparelho_em: o horario de envio que o WhatsApp
--    informa, nas linhas do celular e do paciente. So para separar pessoa de
--    resposta automatica quando as mensagens chegam fora de ordem ou em
--    rajada; a ordem do fio continua sendo a chegada.
--
-- CUSTO (regra 3.3): billable false e cost_cents 0 explicitos (cost_cents
-- aceita nulo e nao tem default): a mensagem nao saiu pelo sistema.
-- CONSENTIMENTO: nao e lido nem escrito. Quem enviou foi a clinica, pelo
-- aparelho dela; gravar nao e disparar, e o descadastro continua valendo
-- para tudo o que o sistema envia.
-- CONTATO: nunca criado nem atualizado por mensagem de saida. Criar daria
-- um lead "novo" sem consentimento, contaria conversa iniciada que nao
-- existiu, poderia mandar conversao falsa para a Meta e dispararia as
-- automacoes de entrada; atualizar last_contact_at faria o follow-up e a
-- automacao "sem resposta" lerem a fala da clinica como resposta do lead.
-- Destino desconhecido volta ignorada 'contato_desconhecido' (decisao
-- padrao; o dono pode pedir para criar).
-- NUMERO DE OUTRA CLINICA DA PLATAFORMA: nunca gravado. O wa_message_id e o
-- mesmo para quem envia e para quem recebe, e o unique ainda e global
-- (docs/07, Fase 5): se o eco de X gravasse primeiro, a ingestao de Y daria
-- on conflict do nothing e a mensagem que Y RECEBEU sumiria sem aviso. O id
-- fica com quem recebeu (ignorada 'numero_da_plataforma').
--
-- Nada aqui grava dado de paciente em log (nenhum raise com conteudo).
-- Erros: SQLSTATE padrao (22023, 23503) ou CZ409; nunca 40001 nem 40P01
-- (o PostgREST repete esses sem limite, ver 20261002150000).
--
-- Producao em 05/10/2026 (so contagens): 7.348 linhas em message (64 MB
-- com indices). A coluna nova com default constante nao reescreve a
-- tabela; o CHECK percorre as 7.348 linhas sob o lock exclusivo do ALTER
-- (milissegundos).
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo. Com ela e o codigo
-- antigo nada muda (coluna com default false, funcoes sem chamador). Com o
-- codigo novo e sem ela, a lista e o fio do Atendimento (que passam a pedir
-- pelo_celular) falham com 42703, o webhook responde 500 a toda mensagem
-- do celular (PGRST202) e cada mensagem do paciente deixa um log de erro da
-- reclassificacao (a ingestao segue).
--
-- ROLLBACK (manual): drop das funcoes registrar_mensagem_do_celular,
-- adotar_eco_do_envio, reclassificar_resposta_automatica e
-- espera_pelo_celular_sem_linha, drop do CHECK message_pelo_celular_coerente
-- e das colunas pelo_celular e enviada_no_aparelho_em. As linhas ja gravadas pelo celular FICAM (saida,
-- 'usuario' ou 'sistema', sem pessoa), so perdem o rotulo; o codigo antigo
-- as mostra como bolha da clinica sem autor.

-- ---------------------------------------------------------------------------
-- 1) message.pelo_celular e a coerencia da linha
-- ---------------------------------------------------------------------------

alter table public.message
  add column pelo_celular boolean not null default false,
  add column enviada_no_aparelho_em timestamptz,
  add constraint message_pelo_celular_coerente check (
    not pelo_celular
    or (
      direction = 'saida'
      and author in ('usuario', 'sistema')
      and author_user_id is null
      and job_id is null
      and not is_internal_note
      and content_type in ('texto', 'imagem', 'audio', 'documento')
    )
  );

comment on column public.message.pelo_celular is
  'Enviada direto pelo WhatsApp do numero pareado (celular, WhatsApp Web, outro aparelho vinculado), fora do sistema. Gravada so por registrar_mensagem_do_celular (service role): saida, author usuario (pessoa da clinica) ou sistema (resposta automatica do app WhatsApp Business), sem author_user_id, custo zero. A interface mostra "Pelo WhatsApp".';
comment on column public.message.enviada_no_aparelho_em is
  'Horario de envio que o WhatsApp informa (messageTimestamp do payload), so quando plausivel. Gravado na mensagem pelo celular (registrar_mensagem_do_celular) e na do paciente (reclassificar_resposta_automatica, chamada pela ingestao). Serve so para separar a resposta automatica do app WhatsApp Business da fala de pessoa quando as mensagens chegam fora de ordem ou em rajada (reconexao); a ordem do fio continua sendo created_at (chegada).';
comment on constraint message_pelo_celular_coerente on public.message is
  'Linha pelo_celular: saida, author usuario ou sistema, sem author_user_id, sem job_id, sem nota interna, conteudo texto, imagem, audio ou documento. Com a policy de INSERT da sessao, so o service role grava o rotulo.';

-- ---------------------------------------------------------------------------
-- 1b) espera_pelo_celular_sem_linha (auxiliar, so dentro das funcoes abaixo)
-- ---------------------------------------------------------------------------
-- O eco que NAO vira linha porque o wa_message_id e de outra clinica (destino
-- e numero de outra clinica da plataforma, ou colisao) continua sendo uma
-- resposta da equipe pelo celular. Antes desta migration ele tirava a
-- conversa da espera e rodava o termo-chave; isso continua: acha o contato
-- (sem criar), a conversa ABERTA daquele numero (sem abrir), trava e derruba
-- a espera pela mesma regra de chegada do passo 8 (a ultima mensagem do
-- paciente chegou antes de base - 8 s). Devolve o contato, para a rota seguir
-- com o termo-chave. Sem execute para ninguem alem do dono: roda dentro de
-- registrar_mensagem_do_celular.

create function public.espera_pelo_celular_sem_linha(
  p_clinic_id uuid,
  p_whatsapp_account_id uuid,
  p_phone_e164 text,
  p_base timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_conversation_id uuid;
  v_ultima_entrada timestamptz;
begin
  select k.id
    into v_contact_id
    from public.contact k
   where k.clinic_id = p_clinic_id
     and k.phone_key = public.chave_telefone(p_phone_e164);
  if v_contact_id is null then
    return null;
  end if;

  select c.id, c.last_inbound_at
    into v_conversation_id, v_ultima_entrada
    from public.conversation c
   where c.clinic_id = p_clinic_id
     and c.contact_id = v_contact_id
     and c.whatsapp_account_id = p_whatsapp_account_id
     and c.status <> 'resolvida'
     for no key update;
  if found
     and (v_ultima_entrada is null
          or v_ultima_entrada < p_base - interval '8 seconds')
  then
    update public.conversation c
       set awaiting_reply = false
     where c.id = v_conversation_id
       and c.awaiting_reply;
  end if;
  return v_contact_id;
end;
$$;

revoke all on function public.espera_pelo_celular_sem_linha(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated, service_role;

comment on function public.espera_pelo_celular_sem_linha(
  uuid, uuid, text, timestamptz
) is
  'Auxiliar de registrar_mensagem_do_celular: para o eco que nao vira linha (numero_da_plataforma, colisao_wa_message_id), acha o contato e a conversa aberta do numero sem criar nada, derruba awaiting_reply pela regra de chegada (ultima mensagem do paciente antes de base - 8 s) e devolve o contato. Sem execute para public, anon, authenticated e service_role.';

-- ---------------------------------------------------------------------------
-- 2) registrar_mensagem_do_celular (webhook, so service_role)
-- ---------------------------------------------------------------------------
-- Passos, na ordem:
--   1. Valida: clinica, numero e telefone presentes, wa_message_id nao
--      vazio, tipo entre texto, imagem, audio e documento (22023).
--   2. Numero: de outra clinica ou inexistente, 23503; removido, ignorada
--      'numero_removido' sem gravar nada (como a ingestao). A leitura trava
--      o numero com FOR KEY SHARE (a mesma trava que a FK do insert pediria
--      depois): remover_numero, que trava o numero e depois as conversas,
--      espera a gravacao terminar, ou a gravacao espera a remocao e ja ve
--      removido_em. Sem isso as duas podiam se travar em ciclo (40P01).
--   3. Numero proprio: destino com a chave de telefone de um numero ATIVO
--      da clinica (o A escrevendo para o B pelo celular) volta ignorada
--      'numero_proprio' (o mesmo filtro da ingestao, sobre o destino). Numero
--      ativo de OUTRA clinica da plataforma volta 'numero_da_plataforma'
--      (o wa_message_id e da ingestao de la; ver o cabecalho), sem linha,
--      mas com a espera derrubada e o contact_id para o termo-chave
--      (espera_pelo_celular_sem_linha).
--   4. wa_message_id ja gravado: da mesma clinica, inserted false com os
--      ids da linha (reentrega do provedor, ou envio nosso cujo eco escapou
--      dos filtros e ja tem o id); de OUTRA clinica, ignorada
--      'colisao_wa_message_id' sem nenhum id de la (o unique ainda e
--      global, docs/07), tambem com a espera derrubada e o contact_id
--      (espera_pelo_celular_sem_linha).
--   5. Contato pela chave do telefone, sem criar e sem atualizar. Nao achou:
--      ignorada 'contato_desconhecido'.
--   6. Conversa: garantir_conversa_aberta (acha ou abre a aberta daquele
--      numero, como a regua; nunca reabre resolvida) e trava dela com FOR
--      NO KEY UPDATE, que serializa com o update da ingestao: a decisao da
--      espera e atomica. Resolvida entre achar e travar: tenta de novo (3
--      vezes; depois, CZ409 e o provedor reenvia).
--   7. Horarios: o horario do payload so vale se plausivel (de 7 dias atras
--      ate 1 minuto a frente) e so serve para as decisoes abaixo. created_at
--      e SEMPRE now(), a mesma regra de chegada da ingestao: o fio e ordenado
--      por created_at, e misturar o horario do payload de um lado com a hora
--      de chegada do outro punha a resposta acima da pergunta depois de uma
--      reconexao (a ingestao grava a hora de chegada de tudo o que chega
--      atrasado) e fazia a midia atrasada nascer "indisponivel".
--   8. Automatica e espera. Quando o eco traz horario de envio e a ultima
--      mensagem do paciente na conversa tambem tem o dela
--      (enviada_no_aparelho_em, gravado pela reclassificacao logo depois da
--      ingestao), a decisao e pelos HORARIOS DE ENVIO, que nao mudam com
--      atraso, fila ou rajada de reconexao: automatica se o paciente enviou
--      alguma mensagem de 8 s antes a 2 s depois do eco (a folga de 2 s e o
--      relogio); a espera desce se a ultima mensagem do paciente foi enviada
--      antes de eco - 8 s. Sem um dos dois horarios, vale a regra de
--      CHEGADA: base = horario do envio (ou now() sem ele); automatica se
--      last_inbound_at esta entre base - 8 s e base + 10 s (folga da hora de
--      chegada do paciente); a espera desce se last_inbound_at e nulo ou
--      anterior a base - 8 s. Nos dois casos a mensagem do paciente que veio
--      depois do envio (ou colada nele) segue esperando resposta, mesmo
--      quando o eco e de pessoa.
--   9. Insert com ON CONFLICT (wa_message_id) DO NOTHING. Sem insercao (a
--      outra entrega do mesmo eco gravou entre o passo 4 e aqui): volta ao
--      passo 4, que agora acha a linha.
--  10. Conversa, so quando inseriu: last_message_at avanca (nunca volta);
--      awaiting_reply desce pela regra do passo 8. last_inbound_at,
--      unread_count, status, responsavel e previa nao sao tocados aqui (a
--      previa e do gatilho manter_previa_ao_inserir_mensagem).
--
-- Concorrencia:
--   - duas entregas do mesmo eco: as duas passam do passo 4; a segunda
--     espera a trava da conversa (ou o indice unico) e, com a primeira
--     confirmada, nao insere e devolve inserted false. Uma linha so.
--   - eco junto com a mensagem do paciente: a trava da conversa ordena os
--     dois. Ingestao primeiro: o eco ve o last_inbound_at novo (automatica
--     se colado nela) e nao derruba a espera que ela levantou. Eco
--     primeiro: ele grava como pessoa e derruba a espera; a ingestao levanta
--     a espera de novo e reclassificar_resposta_automatica troca o autor
--     para 'sistema'. Nos dois casos espera e autoria terminam certas.
--   - ordem das travas: numero (FOR KEY SHARE), conversa, depois o insert
--     (que so espera pelo indice unico do mesmo wa_message_id, e o passo 4
--     ja descartou esse caso). adotar_eco_do_envio trava mensagens e so depois a conversa,
--     como o apagamento; esta funcao nunca espera por linha de mensagem
--     existente segurando a conversa, entao nao ha ciclo.
--
-- A citacao (reply_to_message_id) e resolvida DEPOIS, pelo TypeScript, com
-- vincular_citacao_recebida, igual a ingestao. Aqui so o
-- reply_to_wa_message_id.
--
-- Retorno: {inserted, ignorada?, contact_id, conversation_id, message_id,
-- whatsapp_account_id, automatica}. automatica e nula quando nada foi
-- decidido agora (ignorada ou linha que ja existia). Nas ignoradas
-- numero_da_plataforma e colisao_wa_message_id, contact_id vem preenchido
-- quando o contato existe (para o termo-chave); nas outras, nulo.

create function public.registrar_mensagem_do_celular(
  p_clinic_id uuid,
  p_whatsapp_account_id uuid,
  p_phone_e164 text,
  p_wa_message_id text,
  p_content_type text default 'texto',
  p_body text default null,
  p_media_url text default null,
  p_media_filename text default null,
  p_media_mimetype text default null,
  p_quoted_wa_message_id text default null,
  p_enviada_em timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.registrar_mensagem_do_celular(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.registrar_mensagem_do_celular(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz
) to service_role;

comment on function public.registrar_mensagem_do_celular(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz
) is
  'Grava a mensagem que a clinica enviou pelo celular pareado (fora do sistema) na conversa aberta daquele numero: saida, pelo_celular, author usuario (pessoa) ou sistema (resposta automatica do app Business: o paciente enviou de 8 s antes a 2 s depois do eco, pelos horarios de envio; sem eles, chegou de 8 s antes a 10 s depois), custo zero, enviada, created_at = chegada, enviada_no_aparelho_em = horario do payload. Idempotente por wa_message_id. Nunca cria nem atualiza contato. Derruba awaiting_reply so quando a ultima mensagem do paciente e anterior ao envio (fora da janela de 8 s); tambem nas ignoradas numero_da_plataforma e colisao_wa_message_id, que devolvem o contact_id. Devolve {inserted, ignorada?, contact_id, conversation_id, message_id, whatsapp_account_id, automatica}; ignorada: numero_removido, numero_proprio, numero_da_plataforma, colisao_wa_message_id, contato_desconhecido. 22023 com entrada invalida, 23503 com numero de outra clinica, CZ409 em corrida rara. So service_role.';

-- ---------------------------------------------------------------------------
-- 3) adotar_eco_do_envio (send.ts no 23505, so service_role)
-- ---------------------------------------------------------------------------
-- O send.ts grava a linha 'enviando' sem wa_message_id ANTES de chamar o
-- provedor e so grava o id depois que ele responde. O eco do envio volta
-- marcado (wasSentByApi e track_source) e o webhook o descarta; se os dois
-- filtros falharem e o eco chegar nessa janela, ele vira linha pelo_celular
-- com o id, e o update do send.ts bate no unique. Sem esta funcao a nossa
-- linha ficava 'enviando' para sempre e a conversa mostrava a mesma
-- mensagem duas vezes.
--
-- Numa transacao: trava as duas linhas (na ordem do id), confere que a
-- nossa e de saida, nao e do celular, nao tem wa_message_id e e da clinica;
-- que o eco e pelo_celular, da MESMA clinica e do MESMO numero e nao foi
-- apagado (apagado, o arquivo em message_apagada e trilha: nada a adotar).
-- Quem citava o eco passa a citar a nossa linha; o eco sai (e uma copia da
-- nossa mensagem, nao uma fala a mais: a trilha continua na nossa linha);
-- a nossa ganha o wa_message_id e o recibo mais avancado entre 'enviada' e
-- o do eco (entregue ou lida, que os recibos ja gravaram nele); a previa
-- das conversas envolvidas e recalculada (DELETE nao tem gatilho de
-- previa).
--
-- Devolve true quando adotou, e tambem quando a nossa linha ja tem este
-- mesmo wa_message_id (repeticao da chamada); false quando nao ha o que
-- adotar (sem eco, eco de outra clinica ou de outro numero, linha nossa
-- inexistente ou que ja tem outro id).
--
-- Travas: mensagens primeiro, conversa depois (pelo recalculo da previa),
-- a mesma ordem do apagamento. registrar_mensagem_do_celular trava a
-- conversa mas nunca espera por linha de mensagem existente: sem ciclo.
--
-- Depois do delete, o que o eco mexeu na conversa e desfeito:
--   - o eco abriu uma conversa NOVA (a nossa foi resolvida no meio do envio)
--     e ela ficou sem nenhuma mensagem: e resolvida, senao sobrava na fila do
--     Atendimento um atendimento vazio "Sem atendente";
--   - o eco foi gravado como PESSOA e derrubou a espera, mas o envio adotado
--     e automatico (author 'sistema', regua ou toque, que de proposito nao
--     derruba): a espera volta quando o paciente escreveu depois da ultima
--     fala humana que restou (usuario ou ia, fora nota).
-- Efeito que fica (raro, aceito): se o eco era midia, o job baixar_midia dele
-- aponta para uma linha que nao existe mais (o worker nao acha a linha e
-- desiste de vez).

create function public.adotar_eco_do_envio(
  p_clinic_id uuid,
  p_message_id uuid,
  p_wa_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eco_id uuid;
  v_nossa record;
  v_eco record;
  v_status text;
begin
  if p_clinic_id is null
     or p_message_id is null
     or p_wa_message_id is null
     or btrim(p_wa_message_id) = ''
  then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica, mensagem e id do WhatsApp são obrigatórios.';
  end if;

  select e.id into v_eco_id
    from public.message e
   where e.wa_message_id = p_wa_message_id;

  -- Travas das duas linhas, sempre na mesma ordem.
  perform 1
    from public.message m
   where m.id in (p_message_id, v_eco_id)
   order by m.id
     for update;

  select m.id, m.clinic_id, m.conversation_id, m.whatsapp_account_id,
         m.wa_message_id, m.direction, m.pelo_celular, m.author
    into v_nossa
    from public.message m
   where m.id = p_message_id
     and m.clinic_id = p_clinic_id;
  if not found
     or v_nossa.direction <> 'saida'
     or v_nossa.pelo_celular
  then
    return false;
  end if;
  if v_nossa.wa_message_id is not null then
    -- Ja adotado (repeticao) ou com outro id: nada a fazer.
    return v_nossa.wa_message_id = p_wa_message_id;
  end if;

  if v_eco_id is null then
    return false;
  end if;
  select e.id, e.clinic_id, e.conversation_id, e.whatsapp_account_id,
         e.pelo_celular, e.delivery_status, e.deleted_at, e.author
    into v_eco
    from public.message e
   where e.id = v_eco_id
     and e.wa_message_id = p_wa_message_id;
  if not found
     or v_eco.clinic_id <> p_clinic_id
     or not v_eco.pelo_celular
     or v_eco.whatsapp_account_id <> v_nossa.whatsapp_account_id
     or v_eco.deleted_at is not null
  then
    return false;
  end if;

  v_status := case v_eco.delivery_status
    when 'lida' then 'lida'
    when 'entregue' then 'entregue'
    else 'enviada'
  end;

  -- A citacao do paciente ao eco (vincular_citacao_recebida) segue para a
  -- nossa linha; sem isto o ON DELETE SET NULL a perderia.
  update public.message r
     set reply_to_message_id = p_message_id
   where r.reply_to_message_id = v_eco.id
     and r.clinic_id = p_clinic_id;

  delete from public.message e
   where e.id = v_eco.id;

  update public.message m
     set wa_message_id = p_wa_message_id,
         delivery_status = v_status
   where m.id = p_message_id;

  -- Conversa que o eco abriu e que ficou vazia: resolvida (o mesmo que o
  -- "Resolver" grava), para nao sobrar atendimento vazio na fila.
  if v_eco.conversation_id <> v_nossa.conversation_id then
    update public.conversation c
       set status = 'resolvida',
           awaiting_reply = false
     where c.id = v_eco.conversation_id
       and c.status <> 'resolvida'
       and not exists (
         select 1 from public.message r where r.conversation_id = c.id
       );
  end if;

  -- O eco de pessoa derrubou a espera que o envio automatico adotado nao
  -- derrubaria: volta, se o paciente escreveu depois da ultima fala humana.
  if v_nossa.author = 'sistema' and v_eco.author = 'usuario' then
    update public.conversation c
       set awaiting_reply = true
     where c.id = v_eco.conversation_id
       and c.status <> 'resolvida'
       and not c.awaiting_reply
       and c.last_inbound_at is not null
       and not exists (
         select 1
           from public.message h
          where h.conversation_id = c.id
            and h.direction = 'saida'
            and h.author in ('usuario', 'ia')
            and not h.is_internal_note
            and h.created_at >= c.last_inbound_at
       );
  end if;

  perform public.recalcular_previa_da_conversa(v_nossa.conversation_id);
  if v_eco.conversation_id <> v_nossa.conversation_id then
    perform public.recalcular_previa_da_conversa(v_eco.conversation_id);
  end if;

  return true;
end;
$$;

revoke all on function public.adotar_eco_do_envio(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.adotar_eco_do_envio(uuid, uuid, text)
  to service_role;

comment on function public.adotar_eco_do_envio(uuid, uuid, text) is
  'Rede de seguranca do envio (send.ts, no 23505 do update do wa_message_id): apaga a linha pelo_celular com este wa_message_id da mesma clinica e do mesmo numero da linha p_message_id (de saida, sem wa_message_id), passa o id e o recibo mais avancado (enviada, entregue ou lida) para ela, leva junto quem citava o eco, resolve a conversa que o eco abriu e ficou vazia, devolve a espera que o eco de pessoa derrubou quando o envio adotado e automatico, e recalcula a previa. true quando adotou (ou ja estava adotado); false quando nao ha o que adotar. 22023 com entrada vazia. So service_role.';

-- ---------------------------------------------------------------------------
-- 4) reclassificar_resposta_automatica (ingestao, so service_role)
-- ---------------------------------------------------------------------------
-- A resposta automatica do app WhatsApp Business sai do celular 1 ou 2 s
-- depois da mensagem do paciente, e os dois webhooks correm em paralelo. Se
-- o eco grava primeiro (a ingestao e mais longa, ou pegou partida a frio a
-- noite, justo quando a ausencia esta ligada), registrar_mensagem_do_celular
-- ainda nao ve a mensagem do paciente e grava o eco como PESSOA. Sem
-- correcao, a ausencia contava como primeira resposta da equipe e, pior, o
-- interceptador a lia como "a clinica falou depois do toque": o "Confirmar"
-- tocado pelo paciente deixava de confirmar a consulta sozinho.
--
-- A ingestao chama esta funcao para cada mensagem do paciente que acabou de
-- gravar, ANTES do interceptador, com o horario de envio do payload dela:
--   1. grava esse horario na linha do paciente (enviada_no_aparelho_em), se
--      plausivel e ainda vazio: e o que registrar_mensagem_do_celular usa
--      para decidir os ecos que chegarem depois;
--   2. o eco de pessoa da mesma conversa que chegou de 8 s antes a 2 s depois
--      dela (a folga de cima e a corrida das transacoes: o eco pode ter
--      tomado o relogio depois da ingestao e confirmado antes) vira
--      'sistema', desde que os horarios de ENVIO confirmem que ele saiu
--      depois do paciente (de 2 s antes a 8 s depois do envio do paciente).
--      Sem um dos dois horarios, so a janela de chegada decide.
-- O filtro pelo envio e o que protege a rajada de reconexao: a fala da
-- equipe enviada meia hora antes chega colada na mensagem seguinte do
-- paciente, mas o envio dela e anterior e ela continua 'usuario'.
--
-- A espera nao muda aqui: a ingestao ja a levantou.
--
-- Travas: linhas de mensagem e depois a conversa (recalculo da previa), a
-- mesma ordem do apagamento e de adotar_eco_do_envio.
--
-- Devolve quantas linhas de eco mudaram de autor (0 no comum).

create function public.reclassificar_resposta_automatica(
  p_clinic_id uuid,
  p_message_id uuid,
  p_enviada_em timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entrada record;
  v_enviada timestamptz;
  v_envio_paciente timestamptz;
  v_qtd integer;
begin
  if p_clinic_id is null or p_message_id is null then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'Clínica e mensagem são obrigatórias.';
  end if;

  select m.id, m.conversation_id, m.created_at, m.enviada_no_aparelho_em
    into v_entrada
    from public.message m
   where m.id = p_message_id
     and m.clinic_id = p_clinic_id
     and m.direction = 'entrada'
     and m.author = 'paciente'
     for no key update;
  if not found then
    return 0;
  end if;

  v_enviada := case
    when p_enviada_em between now() - interval '7 days'
                          and now() + interval '1 minute'
    then p_enviada_em
  end;
  if v_enviada is not null and v_entrada.enviada_no_aparelho_em is null then
    update public.message m
       set enviada_no_aparelho_em = v_enviada
     where m.id = v_entrada.id;
  end if;
  v_envio_paciente := coalesce(v_entrada.enviada_no_aparelho_em, v_enviada);

  update public.message e
     set author = 'sistema'
   where e.conversation_id = v_entrada.conversation_id
     and e.clinic_id = p_clinic_id
     and e.pelo_celular
     and e.author = 'usuario'
     and e.deleted_at is null
     and e.created_at between v_entrada.created_at - interval '8 seconds'
                          and v_entrada.created_at + interval '2 seconds'
     and (
       v_envio_paciente is null
       or e.enviada_no_aparelho_em is null
       or e.enviada_no_aparelho_em
          between v_envio_paciente - interval '2 seconds'
              and v_envio_paciente + interval '8 seconds'
     );
  get diagnostics v_qtd = row_count;

  if v_qtd > 0 then
    -- O gatilho da previa nao olha author: a autoria da previa e refeita.
    perform public.recalcular_previa_da_conversa(v_entrada.conversation_id);
  end if;
  return v_qtd;
end;
$$;

revoke all on function public.reclassificar_resposta_automatica(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.reclassificar_resposta_automatica(
  uuid, uuid, timestamptz
) to service_role;

comment on function public.reclassificar_resposta_automatica(
  uuid, uuid, timestamptz
) is
  'Chamada pela ingestao para cada mensagem do paciente recem-gravada, antes do interceptador, com o horario de envio do payload: grava esse horario na linha (enviada_no_aparelho_em, se plausivel e vazio) e troca para author sistema a linha pelo_celular de pessoa da mesma conversa que chegou de 8 s antes a 2 s depois dela e, quando os dois horarios de envio existem, saiu de 2 s antes a 8 s depois do paciente (a resposta automatica do app WhatsApp Business que correu na frente da ingestao). A previa e recalculada. Devolve quantas linhas mudaram de autor. 22023 com entrada vazia. So service_role.';
