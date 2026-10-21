-- Corpos lidos da producao em 21/10/2026 (fndef.js, so leitura), antes da
-- migration 20261022110000 (horario do assistente, publico, fora do
-- assunto, excluir telefone e telefone de paciente como teste; onda 2).
-- md5(prosrc) na leitura (o ensaio confere que o banco ainda esta assim
-- antes de trocar):
--   ingest_inbound_message(uuid, text, text, text, text, text, text, text, text, text, uuid)  0018309d666ba49211a53059e7a7ffe0
--   motor_manutencao()                                                                        faab2582aa9a8f5aba01a5daaa0a2ec6
--   ia_tirar_conversa(uuid, text, boolean)                                                    568dbf1b2d45b4e61261de96429bc7fc
--   ia_atende_no_whatsapp(uuid, uuid, text)                                                   516dadadde02b064c7be806df5157b52
--   rotulo_do_motivo_da_ia(text)                                                              ffb97d9cafc2f4762ba7360d3ad3e938
--   situacao_da_ia_na_clinica(uuid)                                                           e3511c98e850a1c864583bb7a18d810c
--   agente_garantir_rascunho(uuid)                                                            2a4305acdb90c15f523e845ad3197669
--   restaurar_versao_do_agente(uuid, integer)                                                 276b8e5633fa3ac7b87a905e2e73cea0
--   definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean)               fb255417969a243fb52b8c1ec81dec33
--
-- ROLLBACK manual da migration (cabecalho dela). Se a 20261022120000
-- (M3) estiver aplicada, desfazer a M3 ANTES: as funcoes dela chamam
-- ia_publico_aceita, que sai aqui. ORDEM:
--   1. Voltar o CODIGO que le ai_agent_config.publico_atendido e chama as
--      RPCs novas (excluir telefone, o forcar do administrador com a
--      confirmacao); senao a IA para (42703) e a aba mostra erro.
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor: os oito
--      corpos de antes voltam PRIMEIRO (eles chamam as funcoes, a tabela e
--      a coluna que saem depois), com os comentarios de antes; a
--      definir_contato_liberado_da_ia de 7 parametros sai e a de 6 volta,
--      com os grants e o comentario; as quatro funcoes novas, a tabela
--      ia_conversa_fora_do_horario e o indice
--      ai_decision_log_fora_do_assunto_idx saem; a coluna publico_atendido
--      sai por ultimo (com o CHECK e os grants dela).
-- O que fica: os valores novos dos CHECKs ia_janela_aberta_por_valida
-- ('horario') e ai_decision_log_escalation_reason_valida
-- ('fora_do_assunto'), inofensivos (tirar exigiria mexer em linha gravada);
-- a trilha gravada no meio (excluiu_telefone_da_ia,
-- confirmou_teste_com_paciente); as conversas retomadas pelo horario (com a
-- janela 'horario', que o codigo endurecido le com o corte do desde); o
-- telefone forcado pelo administrador continua forcado (desligar e ligar
-- de novo exige o forcar da equipe Conduzza, como antes).
-- TRAVAS: DROP TABLE solta a FK para clinic (SHARE ROW EXCLUSIVE em clinic
-- ate o commit); DROP INDEX segura ACCESS EXCLUSIVE em ai_decision_log
-- (fria) e DROP COLUMN em ai_agent_config (fria) ate o commit;
-- lock_timeout de 3 s, horario calmo.
-- Conferir no fim: os md5 acima, nenhuma das quatro funcoes novas, a
-- definir_contato_liberado_da_ia so de 6 parametros, nenhuma
-- ia_conversa_fora_do_horario, nenhum ai_decision_log_fora_do_assunto_idx
-- e nenhuma coluna publico_atendido.

begin;
set local lock_timeout = '3s';

-- 1. Os corpos de antes e os comentarios de antes.
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
comment on function public.ingest_inbound_message(uuid, text, text, text, text, text, text, text, text, text, uuid) is null;

CREATE OR REPLACE FUNCTION public.motor_manutencao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] inicio
  v_automacoes jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] fim
  -- [gasto meta] inicio
  v_gasto integer := 0;
  -- [gasto meta] fim
  -- [clique do site] inicio
  v_cliques jsonb := '{}'::jsonb;
  -- [clique do site] fim
  -- [mensagem agendada] inicio
  v_agendadas jsonb := '{}'::jsonb;
  v_reconciliadas jsonb;
  v_erros_agendadas integer := 0;
  -- [mensagem agendada] fim
  -- [resposta da ia] inicio
  v_ia_sem_resposta integer := 0;
  v_ia_liberacao_perdida integer := 0;
  v_ia_alerta integer := 0;
  v_ia record;
  -- [resposta da ia] fim
begin
  begin
    select limpar_holds_vencidos() into v_holds;
  exception when others then
    v_erros := v_erros || ('limpar_holds:' || sqlstate);
  end;

  begin
    select fechar_runs_orfas() into v_orfas;
  exception when others then
    v_erros := v_erros || ('fechar_runs_orfas:' || sqlstate);
  end;

  -- Janela de reoferta vencida vira 'expirada' e a proxima onda parte (4.9).
  begin
    select expirar_ofertas_de_espera() into v_ofertas;
  exception when others then
    v_erros := v_erros || ('expirar_ofertas:' || sqlstate);
  end;

  -- [automacoes de fluxo] inicio
  -- Automacoes de fluxo (02/10/2026): registra as regras de tempo vencidas
  -- e executa as pendentes (um salto por passagem). Antes das reguas, para o
  -- follow-up da etapa para onde a automacao moveu ja nascer nesta passagem.
  begin
    v_automacoes := jsonb_build_object('planejadas', planejar_automacoes_de_fluxo());
  exception when others then
    v_erros := v_erros || ('planejar_automacoes:' || sqlstate);
  end;

  begin
    v_automacoes := v_automacoes || executar_automacoes_de_fluxo();
  exception when others then
    v_erros := v_erros || ('executar_automacoes:' || sqlstate);
  end;

  -- [automacoes de fluxo] fim
  begin
    select planejar_reguas() into v_reguas;
  exception when others then
    v_erros := v_erros || ('planejar_reguas:' || sqlstate);
  end;

  -- [gasto meta] inicio
  -- Investimento da Meta (Fase 4, 03/10/2026): a partir das 06:00 no fuso de
  -- cada clinica, enfileira uma leitura do gasto por dia (ate 3 clinicas por
  -- passagem). Cada clinica erra sozinha dentro da funcao (raise warning);
  -- aqui so chega erro estrutural, que vira gasto_meta:<sqlstate> no
  -- planner_erro como as outras rotinas.
  begin
    v_gasto := enfileirar_gasto_meta_do_dia();
  exception when others then
    v_erros := v_erros || ('gasto_meta:' || sqlstate);
  end;

  -- [gasto meta] fim
  -- [clique do site] inicio
  -- Clique rastreado pelo site (F1 do Google, 05/10/2026): o clique nao
  -- casado sai 1 dia depois de vencer e o casado perde gclid, gbraid e
  -- wbraid 90 dias depois do clique. Erro vira cliques_do_site:<sqlstate>.
  begin
    v_cliques := podar_cliques_do_site();
  exception when others then
    v_erros := v_erros || ('cliques_do_site:' || sqlstate);
  end;

  -- [clique do site] fim
  -- Higiene: as linhas de hostname:pid da VPS, que reiniciava a cada 1 a 2
  -- minutos e nada podava.
  begin
    delete from worker_heartbeat
    -- [resposta da ia] inicio
    where worker_id not in ('motor-fila', 'motor-planner', 'motor-ia')
    -- [resposta da ia] fim
      and batida_em < now() - interval '1 hour';
  exception when others then
    v_erros := v_erros || ('higiene:' || sqlstate);
  end;

  -- Reafirma a privacidade do balde de midia (de hora em hora basta, mas
  -- rodar sempre e barato e nao depende de mais um agendamento).
  begin
    update storage.buckets set public = false
    where id = 'midia-conversas' and public is distinct from false;
  exception when others then
    v_erros := v_erros || ('balde:' || sqlstate);
  end;

  -- [mensagem agendada] inicio
  -- Mensagem agendada (06/10/2026). Por ultimo: as linhas travadas pela
  -- planejadora so soltam no fim desta transacao. A planejadora cria o job
  -- da vencida; a reconciliacao fecha o que o executor nao fechou, aplica a
  -- retencao de 30 dias e conta as presas ('enviando' ha mais de 13 h), que
  -- viram agendadas_presas:<n> no planner_erro (runbook do motor). Cada
  -- agendada erra sozinha nas duas: as linhas com erro desta passagem (soma
  -- das duas) viram agendadas_erros:<n>; erro estrutural continua
  -- mensagem_agendada:<SQLSTATE> e agendada_reconciliar:<SQLSTATE>.
  begin
    v_agendadas := public.planejar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_agendadas ->> 'erros_por_linha')::integer, 0);
  exception when others then
    v_erros := v_erros || ('mensagem_agendada:' || sqlstate);
  end;

  begin
    v_reconciliadas := public.reconciliar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_reconciliadas ->> 'erros_por_linha')::integer, 0);
    v_agendadas := v_agendadas || (v_reconciliadas - 'erros_por_linha');
    if coalesce((v_agendadas ->> 'presas')::integer, 0) > 0 then
      v_erros := v_erros || ('agendadas_presas:' || (v_agendadas ->> 'presas'));
    end if;
  exception when others then
    v_erros := v_erros || ('agendada_reconciliar:' || sqlstate);
  end;

  v_agendadas := v_agendadas
    || jsonb_build_object('erros_por_linha', v_erros_agendadas);
  if v_erros_agendadas > 0 then
    v_erros := v_erros || ('agendadas_erros:' || v_erros_agendadas);
  end if;

  -- [mensagem agendada] fim
  -- [resposta da ia] inicio
  -- Resposta da IA no WhatsApp (E3, 13/10/2026). Depois da agendada (este
  -- bloco tambem trava conversa). Ate 50 conversas na IA por passagem (da
  -- lista, ou de teste com janela), sem esperar ninguem: (a) o paciente espera ha mais de 3 minutos sem
  -- resposta, ou (b) a IA deixou de poder falar com ela (liberacao,
  -- numero, telefone, versao) ou a janela nao confere. Nenhuma mensagem ao
  -- contato; awaiting_reply fica como esta. As de (a) em clinica da lista
  -- (nao de teste) viram ia_sem_resposta:<n> no planner_erro. Erro
  -- estrutural vira ia_sem_resposta:<SQLSTATE>. Depois, as retencoes.
  begin
    for v_ia in
      select c.id,
             c.clinic_id,
             (c.awaiting_reply
              and c.last_inbound_at < now() - interval '3 minutes') as sem_resposta
        from public.conversation c
        join public.clinic cl on cl.id = c.clinic_id
        left join public.contact k on k.id = c.contact_id
        left join public.ia_janela_da_conversa w on w.conversation_id = c.id
       where c.status = 'ia_atendendo'
         -- So onde a IA pode existir: clinica da lista (sempre) ou de teste
         -- com janela (posta na IA pela ingestao ou pelo Devolver). Conversa
         -- de teste sem janela e fixture; nas outras clinicas, como hoje.
         and (cl.id = any (public.ia_clinicas_da_fase_controlada())
              or (cl.e_de_teste and w.conversation_id is not null))
         and (
           (c.awaiting_reply and c.last_inbound_at < now() - interval '3 minutes')
           or not public.ia_pode_falar_com(c.clinic_id, c.whatsapp_account_id, k.phone_key)
           or w.conversation_id is null
           or w.contact_id is distinct from c.contact_id
           or w.phone_key is distinct from k.phone_key
         )
       limit 50
         for update of c skip locked
    loop
      if v_ia.sem_resposta then
        if public.ia_tirar_conversa(v_ia.id, 'sem_resposta', null) then
          v_ia_sem_resposta := v_ia_sem_resposta + 1;
          if exists (
            select 1 from public.clinic k
             where k.id = v_ia.clinic_id
               and k.id = any (public.ia_clinicas_da_fase_controlada())
               and not k.e_de_teste
          ) then
            v_ia_alerta := v_ia_alerta + 1;
          end if;
        end if;
      elsif public.ia_tirar_conversa(v_ia.id, 'liberacao_perdida', null) then
        v_ia_liberacao_perdida := v_ia_liberacao_perdida + 1;
      end if;
    end loop;
    if v_ia_alerta > 0 then
      v_erros := v_erros || ('ia_sem_resposta:' || v_ia_alerta);
    end if;

    delete from public.ai_rascunho_bloqueado
     where created_at < now() - interval '90 days';
    update public.ai_turno
       set texto = null
     where texto is not null
       and created_at < now() - interval '1 hour';
    delete from public.ai_turno
     where created_at < now() - interval '30 days';
    delete from public.ia_janela_da_conversa w
     where w.updated_at < now() - interval '30 days'
       and not exists (
         select 1 from public.conversation c
          where c.id = w.conversation_id
            and c.status = 'ia_atendendo'
       );
  exception when others then
    v_erros := v_erros || ('ia_sem_resposta:' || sqlstate);
  end;

  -- [resposta da ia] fim
  insert into worker_heartbeat (worker_id, batida_em, ultimo_lote, ultimo_erro, ultimo_erro_em)
  values (
    'motor-planner',
    now(),
    v_holds + v_orfas + v_ofertas,
    case when array_length(v_erros, 1) is null then null
         else array_to_string(v_erros, ',') end,
    case when array_length(v_erros, 1) is null then null else now() end
  )
  on conflict (worker_id) do update
  set batida_em = now(),
      ultimo_lote = excluded.ultimo_lote,
      ultimo_erro = excluded.ultimo_erro,
      ultimo_erro_em = coalesce(excluded.ultimo_erro_em, worker_heartbeat.ultimo_erro_em);

  return jsonb_build_object(
    'holds', v_holds,
    'runs_orfas', v_orfas,
    'ofertas_expiradas', v_ofertas,
    'reguas', v_reguas,
    'erros', v_erros
    -- [automacoes de fluxo] inicio
    , 'automacoes', v_automacoes
    -- [automacoes de fluxo] fim
    -- [gasto meta] inicio
    , 'gasto_meta', v_gasto
    -- [gasto meta] fim
    -- [clique do site] inicio
    , 'cliques_do_site', v_cliques
    -- [clique do site] fim
    -- [mensagem agendada] inicio
    , 'mensagens_agendadas', v_agendadas
    -- [mensagem agendada] fim
    -- [resposta da ia] inicio
    , 'resposta_da_ia', jsonb_build_object(
        'sem_resposta', v_ia_sem_resposta,
        'liberacao_perdida', v_ia_liberacao_perdida)
    -- [resposta da ia] fim
  );
end;
$function$;
comment on function public.motor_manutencao() is null;

CREATE OR REPLACE FUNCTION public.ia_tirar_conversa(p_conversation_id uuid, p_motivo text, p_aguardando boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_corpo text := public.rotulo_do_motivo_da_ia(p_motivo);
  v_clinica uuid;
begin
  if v_corpo is null then
    raise exception using errcode = '22023', message = 'motivo_invalido';
  end if;

  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = coalesce(p_aguardando, c.awaiting_reply)
   where c.id = p_conversation_id
     and c.status = 'ia_atendendo'
  returning c.clinic_id into v_clinica;
  if v_clinica is null then
    return false;
  end if;

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'conversa_fora_da_ia'
   where j.id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.status = 'pendente'
        and q.payload ->> 'conversation_id' = p_conversation_id::text
        for update skip locked
   );

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, p_conversation_id, 'saida', 'sistema', 'evento', v_corpo,
    false, 0
  );
  return true;
end;
$function$;
comment on function public.ia_tirar_conversa(uuid, text, boolean) is null;

CREATE OR REPLACE FUNCTION public.ia_atende_no_whatsapp(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_telefone)
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    and not public.telefone_e_numero_da_plataforma(p_telefone),
    false
  )
$function$;
comment on function public.ia_atende_no_whatsapp(uuid, uuid, text) is null;

CREATE OR REPLACE FUNCTION public.rotulo_do_motivo_da_ia(p_motivo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_motivo
    when 'sintoma' then 'A IA passou a conversa para a equipe: o paciente descreveu um sintoma.'
    when 'pedido_humano' then 'A IA passou a conversa para a equipe: o paciente pediu para falar com uma pessoa.'
    when 'insatisfacao' then 'A IA passou a conversa para a equipe: o paciente demonstrou insatisfação.'
    when 'menor_de_idade' then 'A IA passou a conversa para a equipe: o paciente é menor de idade.'
    when 'valor_fora_da_tabela' then 'A IA passou a conversa para a equipe: o assunto envolve valor fora da tabela.'
    when 'falhas_seguidas' then 'A IA passou a conversa para a equipe: o assistente não resolveu em duas tentativas.'
    when 'assunto_clinico' then 'A IA passou a conversa para a equipe: o assunto é clínico.'
    when 'midia_nao_suportada' then 'A IA passou a conversa para a equipe: o paciente mandou um conteúdo que o assistente não lê.'
    when 'tentativa_de_manipulacao' then 'A IA passou a conversa para a equipe: a mensagem tentou mudar o comportamento do assistente.'
    when 'conformidade' then 'A IA passou a conversa para a equipe: a resposta não passou na conformidade.'
    when 'agente_pediu' then 'A IA passou a conversa para a equipe: o assistente preferiu passar para a equipe.'
    when 'teto_atingido' then 'A IA passou a conversa para a equipe: o limite de gasto de hoje acabou.'
    when 'regra_do_procedimento' then 'A IA passou a conversa para a equipe: o procedimento pede contato da equipe.'
    when 'falha_tecnica' then 'A IA passou a conversa para a equipe: o assistente teve uma falha técnica.'
    when 'teto_de_respostas' then 'A IA passou a conversa para a equipe: o limite de respostas desta conversa na última hora acabou.'
    when 'pedido_de_agenda' then 'A IA passou a conversa para a equipe: o paciente quer marcar, remarcar ou cancelar.'
    when 'nao_individual' then 'Chegou uma mensagem de grupo ou de status. A conversa voltou para a equipe.'
    when 'fora_do_horario' then 'A IA passou a conversa para a equipe: agora está fora do horário escolhido para o assistente.'
    when 'horario_nao_suportado' then 'A IA passou a conversa para a equipe: o modo de horário escolhido ainda não funciona no WhatsApp.'
    when 'sem_versao_publicada' then 'A IA passou a conversa para a equipe: o assistente ainda não tem versão publicada.'
    when 'liberacao_perdida' then 'A IA passou a conversa para a equipe: o assistente deixou de estar liberado para este telefone ou este número.'
    when 'numero_desconectado' then 'A IA passou a conversa para a equipe: o número do assistente está desconectado.'
    when 'envio_incerto' then 'A IA pode não ter enviado a última resposta. A conversa voltou para a equipe.'
    when 'aviso_nao_enviado' then 'O aviso automático ao contato não foi enviado.'
    when 'celular' then 'Alguém respondeu pelo celular. A IA parou de responder nesta conversa.'
    when 'sem_resposta' then 'A IA não respondeu a tempo. A conversa voltou para a equipe.'
    when 'desligada' then 'O assistente foi desligado. A conversa voltou para a equipe.'
    -- [parada neutra] inicio
    when 'parada' then 'O assistente não atendeu esta mensagem: ele está parado para este telefone ou este número.'
    -- [parada neutra] fim
    when 'sem_autorizacao' then 'A IA passou a conversa para a equipe: o contato não tem autorização para receber mensagens.'
  end
$function$;
comment on function public.rotulo_do_motivo_da_ia(text) is null;

CREATE OR REPLACE FUNCTION public.situacao_da_ia_na_clinica(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_teto boolean;
  v_versao integer;
  v_invalidos jsonb;
  v_sem_autorizacao jsonb;
  v_abertas jsonb;
  v_motor jsonb;
  -- [conversa aberta por numero] inicio
  v_conversas jsonb;
  -- [conversa aberta por numero] fim
begin
  if not (
    (auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role')
    or public.is_product_admin()
    or public.ia_membro_ve_a_liberacao(p_clinic_id)
  ) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select coalesce((
    select (
      select coalesce(sum(u.custo_microdolar), 0)
        from public.ia_uso u
       where u.clinic_id = l.clinic_id
         and u.created_at >= now() - interval '24 hours'
    ) >= l.teto_diario_centavos_usd::bigint * 10000
      from public.ia_liberacao l
     where l.clinic_id = p_clinic_id
  ), false) into v_teto;

  select max(a.version) into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada';

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_invalidos
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and (public.telefone_e_numero_da_plataforma(k.phone_key)
          or (not k.forcado
              and public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key)));

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_sem_autorizacao
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and exists (
       select 1
         from public.contact ct
        where ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and (
            select cc.revoked_at is not null
              from public.contact_consent cc
             where cc.clinic_id = p_clinic_id
               and cc.contact_id = ct.id
               and cc.channel = 'whatsapp'
             order by cc.granted_at desc, cc.created_at desc
             limit 1
          ) is true
     );

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_abertas
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and exists (
       select 1
         from public.conversation c
         join public.contact ct on ct.id = c.contact_id
        where c.clinic_id = p_clinic_id
          and ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and c.status in ('aguardando_humano', 'em_atendimento')
          and c.whatsapp_account_id in (
            select n.whatsapp_account_id
              from public.ia_numero_liberado n
              join public.whatsapp_account w on w.id = n.whatsapp_account_id
             where n.clinic_id = p_clinic_id
               and n.ativo
               and w.removido_em is null
          )
     );

  -- [conversa aberta por numero] inicio
  -- Por telefone ATIVO da lista e por numero LIGADO (nao removido) da
  -- clinica: a conversa aberta com a equipe (aguardando ou em atendimento)
  -- do contato desse telefone naquele numero. A ingestao so poe na IA a
  -- conversa NOVA; enquanto esta estiver aberta, a mensagem do telefone
  -- nesse numero fica com a equipe. A aba diz o numero e leva a conversa
  -- (o id), para alguem assumir e resolver. No maximo uma por par: o
  -- contato e unico pela chave na clinica, e conversation_aberta_por_numero
  -- so deixa uma conversa nao resolvida por contato e numero (o distinct on
  -- e so a segunda camada, com a mais recente).
  select coalesce(jsonb_agg(jsonb_build_object(
           'telefone_id', a.telefone_id,
           'whatsapp_account_id', a.whatsapp_account_id,
           'conversation_id', a.conversation_id
         ) order by a.telefone_criado, a.telefone_id, a.numero_criado, a.whatsapp_account_id), '[]'::jsonb)
    into v_conversas
    from (
      select distinct on (k.id, n.whatsapp_account_id)
             k.id as telefone_id,
             k.created_at as telefone_criado,
             n.whatsapp_account_id,
             n.created_at as numero_criado,
             c.id as conversation_id
        from public.ia_contato_liberado k
        join public.contact ct
          on ct.clinic_id = p_clinic_id
         and ct.phone_key = k.phone_key
        join public.conversation c
          on c.clinic_id = p_clinic_id
         and c.contact_id = ct.id
         and c.status in ('aguardando_humano', 'em_atendimento')
        join public.ia_numero_liberado n
          on n.clinic_id = p_clinic_id
         and n.whatsapp_account_id = c.whatsapp_account_id
         and n.ativo
        join public.whatsapp_account w
          on w.id = n.whatsapp_account_id
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
       where k.clinic_id = p_clinic_id
         and k.ativo
       order by k.id, n.whatsapp_account_id, c.created_at desc, c.id
    ) a;
  -- [conversa aberta por numero] fim

  v_motor := public.ia_estado_do_motor();

  return jsonb_build_object(
    'teto_atingido', v_teto,
    'versao_publicada', v_versao,
    'telefones_invalidos', v_invalidos,
    'telefones_sem_autorizacao', v_sem_autorizacao,
    'telefones_com_conversa_aberta', v_abertas,
    -- [conversa aberta por numero] inicio
    'conversas_abertas', v_conversas,
    -- [conversa aberta por numero] fim
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$;
comment on function public.situacao_da_ia_na_clinica(uuid) is null;

CREATE OR REPLACE FUNCTION public.agente_garantir_rascunho(p_clinic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_versao integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ai_agent_config:' || p_clinic_id::text, 0)
  );

  select a.id into v_id
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'rascunho';
  if found then
    return v_id;
  end if;

  select coalesce(max(a.version), 0) + 1 into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id;

  begin
    insert into public.ai_agent_config (
      clinic_id, version, agent_name, tone, use_emoji, greeting, closing,
      skills, operating_mode, fallback_minutes, operating_hours,
      escalation_rules, instrucoes
      -- [agenda da ia] inicio
      , agenda_antecedencia_horas, agenda_horizonte_dias
      -- [agenda da ia] fim
    )
    select p_clinic_id, v_versao, a.agent_name, a.tone, a.use_emoji,
           a.greeting, a.closing, a.skills, a.operating_mode,
           a.fallback_minutes, a.operating_hours, a.escalation_rules,
           a.instrucoes
           -- [agenda da ia] inicio
           , a.agenda_antecedencia_horas, a.agenda_horizonte_dias
           -- [agenda da ia] fim
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1
    returning id into v_id;

    if v_id is null then
      insert into public.ai_agent_config (clinic_id, version)
      values (p_clinic_id, v_versao)
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'CZ409',
      message = 'O agente de IA foi alterado ao mesmo tempo por outra pessoa. Tente de novo.';
  end;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'criou_rascunho_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;
comment on function public.agente_garantir_rascunho(uuid) is
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes, antecedencia e horizonte da agenda) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

CREATE OR REPLACE FUNCTION public.restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_origem public.ai_agent_config%rowtype;
  v_id uuid;
begin
  if p_clinic_id is null or p_versao is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e a versão.';
  end if;
  perform public.agente_exigir_quem_configura(p_clinic_id);
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  select * into v_origem
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.version = p_versao
     and a.status = 'publicada';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Versão não encontrada.';
  end if;

  v_id := public.agente_garantir_rascunho(p_clinic_id);

  update public.ai_agent_config
     set agent_name = v_origem.agent_name,
         -- [agenda da ia] inicio
         agenda_antecedencia_horas = v_origem.agenda_antecedencia_horas,
         agenda_horizonte_dias = v_origem.agenda_horizonte_dias,
         -- [agenda da ia] fim
         tone = v_origem.tone,
         use_emoji = v_origem.use_emoji,
         greeting = v_origem.greeting,
         closing = v_origem.closing,
         skills = v_origem.skills,
         operating_mode = v_origem.operating_mode,
         fallback_minutes = v_origem.fallback_minutes,
         operating_hours = v_origem.operating_hours,
         escalation_rules = v_origem.escalation_rules,
         instrucoes = v_origem.instrucoes
   where id = v_id;

  -- A base viva passa a valer como a congelada daquela versao, sem apagar
  -- nada: o item ativo que nao esta nela fica DESATIVADO (guardado, como a
  -- tela promete; os ja desativados ficam como estao), volta com a mesma id
  -- o que foi excluido, e o que esta nela fica com o texto dela e ativo.
  update public.knowledge_item k
     set active = false
   where k.clinic_id = p_clinic_id
     and k.active
     and not exists (
       select 1
         from jsonb_array_elements(v_origem.conhecimento) e
        where (e ->> 'id')::uuid = k.id
     );

  insert into public.knowledge_item as k (id, clinic_id, question, answer, active)
  select (e ->> 'id')::uuid, p_clinic_id, e ->> 'pergunta', e ->> 'resposta', true
    from jsonb_array_elements(v_origem.conhecimento) e
  on conflict (id) do update
     set question = excluded.question,
         answer = excluded.answer,
         active = true
   where k.clinic_id = excluded.clinic_id
     and (k.question, k.answer, k.active)
         is distinct from (excluded.question, excluded.answer, true);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'restaurou_versao_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$function$;
comment on function public.restaurar_versao_do_agente(uuid, integer) is
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, a antecedencia e o horizonte da agenda, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- 2. definir_contato_liberado_da_ia: a de 7 parametros sai, a de 6 volta.
drop function if exists public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean, boolean);
create function public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean, p_forcar_contato_existente boolean DEFAULT false, p_confirmou_aviso_da_openai boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_telefone text := btrim(p_telefone_e164);
  v_chave text;
  v_rotulo text := nullif(btrim(p_rotulo), '');
  v_id uuid;
  -- [whatsapp so pela equipe] inicio
  v_forcou boolean := false;
  -- [whatsapp so pela equipe] fim
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  -- [telefone pelo administrador] inicio
  -- Ligar telefone (adicionar ou "Ligar de novo") basta o guarda acima:
  -- administrador ativo da propria clinica da lista fechada (ou e_de_teste,
  -- nas suites), super admin ou o servidor. Decisao do dono de 19/10/2026;
  -- de 13/10 ate ela, ligar exigia a equipe Conduzza. O FORCAR continua so
  -- da equipe Conduzza: conferido aqui, antes de qualquer leitura, mesmo
  -- quando o telefone nao tem sinal de paciente. Desligar, como sempre, so
  -- com o guarda acima.
  if p_ativo and coalesce(p_forcar_contato_existente, false) then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [telefone pelo administrador] fim
  if p_clinic_id is null or v_telefone is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o telefone e se ele fica liberado.';
  end if;
  if v_telefone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023',
      message = 'Telefone inválido: use o formato internacional, por exemplo +5585999990000.';
  end if;
  if char_length(v_rotulo) > 80 then
    raise exception using errcode = '22023',
      message = 'O rótulo tem no máximo 80 caracteres.';
  end if;
  v_chave := public.chave_telefone(v_telefone);

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- [whatsapp so pela equipe] inicio
  -- So ao LIGAR: numero de WhatsApp de qualquer clinica do Conduzza nunca;
  -- telefone com sinal de paciente so com o forcar (equipe Conduzza, que ja
  -- passou em ia_exigir_equipe_conduzza acima), com trilha propria. Desligar
  -- nunca e recusado. Nenhuma mensagem leva o telefone.
  if p_ativo then
    if public.telefone_e_numero_da_plataforma(v_telefone) then
      raise exception using errcode = '23514', message = 'telefone_invalido_para_equipe';
    end if;
    if public.contato_tem_sinal_de_paciente(p_clinic_id, v_chave) then
      if not coalesce(p_forcar_contato_existente, false) then
        raise exception using errcode = '23514', message = 'contato_de_paciente';
      end if;
      v_forcou := true;
    end if;
  end if;
  -- [whatsapp so pela equipe] fim

  -- [whatsapp so pela equipe] inicio
  -- forcado (D-B da revisao): verdadeiro so ao ligar com o forcar e o sinal
  -- de paciente; falso ao ligar sem sinal e ao desligar. O gatilho
  -- ia_contato_liberado_forcado_so_pela_funcao so aceita forcado com esta
  -- flag local, desligada logo depois da gravacao.
  if v_forcou then
    perform set_config('conduzza.forcar_telefone_da_ia', 'sim', true);
  end if;
  -- [whatsapp so pela equipe] fim
  update public.ia_contato_liberado k
     set ativo = p_ativo,
         rotulo = coalesce(v_rotulo, k.rotulo),
         -- [whatsapp so pela equipe] inicio
         forcado = v_forcou,
         -- [whatsapp so pela equipe] fim
         alterado_por = auth.uid()
   where k.clinic_id = p_clinic_id
     and k.phone_key = v_chave
  returning k.id into v_id;
  if not found then
    -- [aviso da openai no banco] inicio
    -- Telefone que NAO esta na lista. Desligar nao cria linha nem trilha
    -- (nada foi gravado; o desligar chega aqui sem o forcar), mas a
    -- varredura de sempre roda: conversa na IA que nao pode mais ficar nela
    -- volta para a equipe. Ligar cria a linha so com a confirmacao do aviso
    -- da OpenAI (LGPD, D32), chamada por nome; sem ela, 23514 e nada muda. A
    -- mensagem nunca leva o telefone.
    if not p_ativo then
      perform public.ia_desligar(array[p_clinic_id]);
      return false;
    end if;
    if not coalesce(p_confirmou_aviso_da_openai, false) then
      raise exception using errcode = '23514', message = 'aviso_da_openai_nao_confirmado';
    end if;
    -- [aviso da openai no banco] fim
    insert into public.ia_contato_liberado (clinic_id, phone_key, rotulo, ativo, alterado_por,
                                            -- [whatsapp so pela equipe] inicio
                                            forcado
                                            -- [whatsapp so pela equipe] fim
                                            )
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid(),
            -- [whatsapp so pela equipe] inicio
            v_forcou
            -- [whatsapp so pela equipe] fim
            )
    returning id into v_id;
  end if;
  -- [whatsapp so pela equipe] inicio
  perform set_config('conduzza.forcar_telefone_da_ia', '', true);
  -- [whatsapp so pela equipe] fim

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_contato_liberado', v_id);

  -- [aviso da openai no banco] inicio
  -- A confirmacao do aviso da OpenAI na trilha, na mesma transacao, no nome
  -- de quem liga (nulo pelo servidor): toda vez que liga com ela (o
  -- formulario de adicionar sempre manda; o "Ligar de novo" nao).
  if p_ativo and coalesce(p_confirmou_aviso_da_openai, false) then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'confirmou_aviso_da_openai', 'ia_contato_liberado', v_id);
  end if;
  -- [aviso da openai no banco] fim

  -- [whatsapp so pela equipe] inicio
  if v_forcou then
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    values (p_clinic_id, auth.uid(), 'forcou_telefone_de_paciente_na_ia', 'ia_contato_liberado', v_id);
  end if;
  -- [whatsapp so pela equipe] fim

  return p_ativo;
end;
$function$;
revoke execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) to authenticated, service_role;
comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean, boolean) is
  'Liga ou desliga um telefone da equipe para a IA (T5). Quem chama: administrador ativo da propria clinica da lista (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera); o forcar, so a equipe Conduzza (ia_exigir_equipe_conduzza). Ao ligar recusa numero de WhatsApp do Conduzza e contato com sinal de paciente sem o forcar (23514). Telefone fora da lista: ligar exige p_confirmou_aviso_da_openai (23514 aviso_da_openai_nao_confirmado), desligar nao cria linha. Grava audit_log: editou, confirmou_aviso_da_openai (ligar com a confirmacao) e forcou_telefone_de_paciente_na_ia. Sempre por nome de parametro.';

-- 3. As funcoes novas.
drop function if exists public.ia_retomar_conversas_no_horario(integer, boolean);
drop function if exists public.excluir_contato_liberado_da_ia(uuid, uuid);
drop function if exists public.ia_publico_aceita(uuid, text);
drop function if exists public.ia_horario_do_assistente(uuid, timestamp with time zone);

-- 4. A tabela nova (com a FK), o indice novo de ai_decision_log e o
--    comentario de antes da janela.
drop table if exists public.ia_conversa_fora_do_horario;
drop index if exists public.ai_decision_log_fora_do_assunto_idx;
comment on table public.ia_janela_da_conversa is
  'De quando a IA pode ler a conversa (desde) e com qual contato e chave de telefone. Gravada pela ingestao (conversa nova na IA) e por devolver_para_ia. Janela aberta pela ingestao (conversa nova) vale para a conversa inteira.';

-- 5. Por ultimo, a coluna do publico (com o CHECK e os grants dela).
alter table public.ai_agent_config drop column if exists publico_atendido;

commit;

-- Conferencia (so leitura), depois do commit:
-- select p.oid::regprocedure, md5(p.prosrc)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('ingest_inbound_message', 'motor_manutencao', 'ia_tirar_conversa',
--                      'ia_atende_no_whatsapp', 'rotulo_do_motivo_da_ia',
--                      'situacao_da_ia_na_clinica', 'agente_garantir_rascunho',
--                      'restaurar_versao_do_agente', 'definir_contato_liberado_da_ia',
--                      'ia_retomar_conversas_no_horario', 'excluir_contato_liberado_da_ia',
--                      'ia_publico_aceita', 'ia_horario_do_assistente');
-- select to_regclass('public.ia_conversa_fora_do_horario'),
--        to_regclass('public.ai_decision_log_fora_do_assunto_idx');
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'ai_agent_config'
--    and column_name = 'publico_atendido';
