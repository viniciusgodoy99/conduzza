-- ---------------------------------------------------------------------------
-- Audio, foto e PDF sempre ligados (decisao do dono de 06/11/2026)
-- ---------------------------------------------------------------------------
-- O dono: "Preciso que sempre esteja ligado, nao precisar apertar um botao, pode
-- tirar da UI e UX e pode ligar isso". As habilidades "Entender audio" e "Ler
-- imagem e documento" saem da tela e valem sempre (HABILIDADES_DO_AGENTE, travada).
-- Aqui so sai a conferencia delas em gravar_leitura_da_midia: o resto da funcao
-- e igual ao da migration 20261106130000, com as mesmas permissoes (create or
-- replace mantem os grants e o comentario).
--
-- O QUE NAO MUDA: a trava por telefone (midia_da_ia_liberada, D-95: so telefone
-- da lista com o aviso novo), a posse do job, a janela e as outras recusas. O
-- motivo leitura_desligada fica para a clinica sem versao publicada.
--
-- TRAVAS: so catalogo, nenhuma tabela. ORDEM: esta migration ANTES do codigo.
-- Com ela e o codigo antigo, nada muda (o codigo antigo so le com a chave
-- ligada). Com o codigo novo e o banco antigo, toda midia iria para a equipe.
-- ROLLBACK: supabase/operacao/rollback/20261106140000-corpo-anterior.sql.

CREATE OR REPLACE FUNCTION public.gravar_leitura_da_midia(p_job_id uuid, p_worker text, p_message_id uuid, p_midia text, p_tipo text, p_transcricao text, p_segundos integer, p_procedimentos uuid[], p_fora_do_cadastro integer, p_confianca text, p_resumo text, p_modelo text, p_versao text, p_convenio_lido uuid DEFAULT NULL::uuid, p_numero_da_carteirinha text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Os tipos de cada midia (o CHECK ia_leitura_da_midia_tipo_valido).
  c_tipos_do_audio constant text[] := array['transcricao', 'sem_fala'];
  c_tipos_do_arquivo constant text[] := array['pedido_de_exame_ou_procedimento', 'guia_ou_autorizacao', 'carteirinha', 'documento_de_identidade', 'resultado_ou_laudo', 'receita', 'foto_do_corpo', 'figurinha', 'outro', 'ilegivel'];
  c_confiancas constant text[] := array['alta', 'media', 'baixa'];
  c_pedido constant text := 'pedido_de_exame_ou_procedimento';
  c_figurinha constant text := 'figurinha';
  -- A figurinha do WhatsApp reconhecida no servidor, sem modelo (D-98).
  c_modelo_local constant text := 'local';
  -- Os limites (os mesmos dos CHECKs da tabela).
  c_limite_da_transcricao constant integer := 4000;
  c_limite_do_resumo constant integer := 300;
  c_maximo_de_segundos constant integer := 150;
  c_maximo_de_itens constant integer := 10;
  c_maximo_fora_do_cadastro constant integer := 20;
  v_itens uuid[] := coalesce(p_procedimentos, '{}'::uuid[]);
  v_fora integer := coalesce(p_fora_do_cadastro, 0);
  v_arquivo boolean;
  v_conversa uuid;
  v_clinica uuid;
  v_criado timestamptz;
  v_status text;
  v_atendente uuid;
  v_contato uuid;
  v_telefone text;
  v_lidas uuid[];
  v_id uuid;
  v_leitura record;
  -- [matriz de 06/11/2026] inicio
  c_carteirinha constant text := 'carteirinha';
  c_cabecalho_da_nota constant text := 'Resumo do assistente para a equipe (montado pelo sistema, sem dados do paciente).';
  v_cadastro record;
  v_cartao_de_antes text;
  v_plano_diferente boolean;
  v_numero_novo boolean;
  v_plano_novo boolean;
  v_numero_diferente boolean;
  v_nota text;
  v_campos text[] := array[]::text[];
  -- [matriz de 06/11/2026] fim
begin
  -- 1. Os obrigatorios.
  if p_job_id is null or p_worker is null or p_message_id is null
     or p_midia is null or p_tipo is null or p_modelo is null or p_versao is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- 2. As regras dos CHECKs, na ordem do contrato (o motor sabe o que errou).
  if p_midia not in ('audio', 'imagem', 'documento') then
    raise exception using errcode = '22023', message = 'midia_invalida';
  end if;
  v_arquivo := p_midia <> 'audio';
  if not (case when v_arquivo then p_tipo = any (c_tipos_do_arquivo)
               else p_tipo = any (c_tipos_do_audio) end) then
    raise exception using errcode = '22023', message = 'tipo_invalido';
  end if;
  if (p_tipo = 'transcricao') <> (p_transcricao is not null)
     or (p_transcricao is not null
         and (char_length(p_transcricao) > c_limite_da_transcricao
              or p_transcricao !~ '[^[:space:]]')) then
    raise exception using errcode = '22023', message = 'transcricao_invalida';
  end if;
  if v_arquivo = (p_segundos is not null)
     or (p_segundos is not null and p_segundos not between 1 and c_maximo_de_segundos) then
    raise exception using errcode = '22023', message = 'segundos_invalidos';
  end if;
  if coalesce(array_ndims(v_itens), 1) <> 1
     or cardinality(v_itens) > c_maximo_de_itens
     or array_position(v_itens, null) is not null
     or not public.ia_lista_sem_repetido(v_itens)
     or (p_tipo <> c_pedido and cardinality(v_itens) > 0)
     or (p_tipo = c_pedido and cardinality(v_itens) = 0 and v_fora < 1) then
    raise exception using errcode = '22023', message = 'itens_invalidos';
  end if;
  if v_fora not between 0 and c_maximo_fora_do_cadastro
     or (v_fora > 0 and p_tipo <> c_pedido) then
    raise exception using errcode = '22023', message = 'fora_do_cadastro_invalido';
  end if;
  if (v_arquivo and not coalesce(p_confianca = any (c_confiancas), false))
     or (not v_arquivo and p_confianca is not null) then
    raise exception using errcode = '22023', message = 'confianca_invalida';
  end if;
  if (not v_arquivo or p_tipo = c_figurinha) <> (p_resumo is null)
     or (p_resumo is not null
         and (char_length(p_resumo) > c_limite_do_resumo
              or p_resumo !~ '[^[:space:]]')) then
    raise exception using errcode = '22023', message = 'resumo_invalido';
  end if;
  if p_modelo !~ '^[a-z0-9][a-z0-9.-]{0,99}$'
     or (p_modelo = c_modelo_local and not (v_arquivo and p_tipo = c_figurinha)) then
    raise exception using errcode = '22023', message = 'modelo_invalido';
  end if;
  if not (case when not v_arquivo then p_versao ~ '^transcricao-[0-9a-f]{12}$'
               when p_modelo = c_modelo_local then p_versao ~ '^figurinha-[0-9a-f]{12}$'
               else p_versao ~ '^leitor-[0-9a-f]{12}$' end) then
    raise exception using errcode = '22023', message = 'versao_invalida';
  end if;
  -- [matriz de 06/11/2026] O convenio e o numero so na carteirinha; o numero so
  -- com confianca alta e na validacao estreita (o espelho:
  -- numeroDaCarteirinhaLido). A recusa nunca leva o valor.
  if p_convenio_lido is not null and p_tipo <> c_carteirinha then
    raise exception using errcode = '22023', message = 'convenio_invalido';
  end if;
  if p_numero_da_carteirinha is not null and not (
       p_tipo = c_carteirinha
       and p_confianca = 'alta'
       and p_numero_da_carteirinha ~ '^[0-9A-Z]{5,30}$'
       and char_length(regexp_replace(p_numero_da_carteirinha, '[^0-9]', '', 'g')) >= 4
       and char_length(regexp_replace(p_numero_da_carteirinha, '[0-9]', '', 'g')) <= 6
  ) then
    raise exception using errcode = '22023', message = 'carteirinha_invalida';
  end if;

  -- 3. A posse do job. O CHECK job_queue_ia_tem_conversa garante o uuid no
  -- payload do kind.
  select (j.payload ->> 'conversation_id')::uuid, j.clinic_id, j.created_at
    into v_conversa, v_clinica, v_criado
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.status = 'executando'
     and j.locked_by = p_worker;
  if v_conversa is null or not exists (
    select 1 from public.conversation c
     where c.id = v_conversa and c.clinic_id = v_clinica
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posse');
  end if;

  -- 4. As travas: a MENSAGEM (FOR SHARE: barra o update do apagamento ate o
  -- fim desta transacao), so se ela e desta conversa e clinica; DEPOIS a
  -- conversa (FOR NO KEY UPDATE, a da passagem). Um apagamento que chegou
  -- antes ja aparece abaixo (deleted_at); um que vem depois espera e, no
  -- fim, apaga a leitura. Um Assumir, um Devolver ou uma passagem que vem
  -- depois espera esta transacao.
  perform 1 from public.message m
   where m.id = p_message_id
     and m.conversation_id = v_conversa
     and m.clinic_id = v_clinica
     for share;
  select c.status, c.assignee_user_id, c.contact_id
    into v_status, v_atendente, v_contato
    from public.conversation c
   where c.id = v_conversa
     for no key update;

  -- 5. D-A: o job de antes da janela atual nao mexe na sessao nova.
  if exists (
    select 1 from public.ia_janela_da_conversa w
     where w.conversation_id = v_conversa
       and v_criado < w.desde
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'job_antigo');
  end if;

  -- 6. A conversa segue com a IA, sem responsavel.
  if v_status is distinct from 'ia_atendendo' or v_atendente is not null then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;

  -- 7. A mensagem: desta conversa e clinica, de entrada, do paciente, fora
  -- de nota interna, nao apagada, com o arquivo no Storage e da midia dita.
  if not exists (
    select 1 from public.message m
     where m.id = p_message_id
       and m.conversation_id = v_conversa
       and m.clinic_id = v_clinica
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and not m.is_internal_note
       and m.deleted_at is null
       and starts_with(m.media_url, 'storage://')
       and m.content_type = p_midia
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_invalida');
  end if;

  -- 8. O job leu a mensagem (o motor grava ai_turno.mensagens_lidas antes do
  -- laco; sem a linha do turno, nada lido).
  select t.mensagens_lidas into v_lidas
    from public.ai_turno t
   where t.job_id = p_job_id
     and t.clinic_id = v_clinica
     and t.conversation_id = v_conversa;
  if not coalesce(p_message_id = any (v_lidas), false) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_nao_lida');
  end if;

  -- 9. Decisao do dono de 06/11/2026: a midia vale sempre, sem chave na tela.
  -- So falta haver versao publicada (o agente que le no WhatsApp).
  if not exists (
    select 1
      from public.ai_agent_config a
     where a.clinic_id = v_clinica
       and a.status = 'publicada'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'leitura_desligada');
  end if;

  -- 10. O telefone do contato pode mandar midia a OpenAI (D-95).
  select k.phone_e164 into v_telefone
    from public.contact k
   where k.id = v_contato
     and k.clinic_id = v_clinica;
  if not public.midia_da_ia_liberada(v_clinica, v_telefone) then
    return jsonb_build_object('ok', false, 'motivo', 'midia_bloqueada');
  end if;

  -- 11. Os itens do pedido sao procedimentos ativos desta clinica.
  if exists (
    select 1 from unnest(v_itens) as x(id)
     where not exists (
       select 1 from public.procedure p
        where p.id = x.id
          and p.clinic_id = v_clinica
          and p.active
     )
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'procedimento_invalido');
  end if;
  -- [matriz de 06/11/2026] O convenio lido e ativo e desta clinica.
  if p_convenio_lido is not null and not exists (
    select 1 from public.insurance i
     where i.id = p_convenio_lido
       and i.clinic_id = v_clinica
       and i.active
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'convenio_invalido');
  end if;

  -- 12 e 13. A primeira leitura vale: grava, ou devolve a que ja existe
  -- (de qualquer job), sem regravar.
  insert into public.ia_leitura_da_midia (
    clinic_id, conversation_id, message_id, job_id, midia, tipo,
    transcricao, segundos_de_audio, procedimentos, fora_do_cadastro,
    confianca, resumo, modelo, versao, convenio_lido_id
  ) values (
    v_clinica, v_conversa, p_message_id, p_job_id, p_midia, p_tipo,
    p_transcricao, p_segundos, v_itens, v_fora,
    p_confianca, p_resumo, p_modelo, p_versao, p_convenio_lido
  )
  on conflict (message_id) do nothing
  returning id into v_id;
  if v_id is not null then
    -- [matriz de 06/11/2026] inicio
    -- O que a leitura faz vale so na primeira vez: o job repetido nao grava de
    -- novo. O pedido com item achado e o resto fora, com a conversa ainda na IA:
    -- a nota para a equipe (so a contagem).
    if p_tipo = c_pedido and cardinality(v_itens) > 0 and v_fora > 0
       and p_confianca in ('alta', 'media') then
      v_nota := format('O pedido que a pessoa mandou tem item fora do Cadastro (%s). O assistente respondeu sobre os outros e disse que a equipe confere o resto: veja o arquivo nesta conversa.', v_fora);
    end if;
    -- A carteirinha, so com confianca alta: cada campo so se estiver vazio; o
    -- diferente nao muda e vira nota, sem o valor. SKIP LOCKED: a ingestao trava
    -- o contato e depois a conversa, e a conversa ja esta travada aqui.
    if p_tipo = c_carteirinha and p_confianca = 'alta'
       and (p_numero_da_carteirinha is not null or p_convenio_lido is not null) then
      select k.insurance_card, k.insurance_id into v_cadastro
        from public.contact k
       where k.id = v_contato
         and k.clinic_id = v_clinica
         for no key update skip locked;
      if not found then
        v_nota := 'A carteirinha que a pessoa mandou não foi gravada no cadastro agora, que estava em uso: confira o arquivo nesta conversa.';
      else
        v_cartao_de_antes := regexp_replace(upper(coalesce(v_cadastro.insurance_card, '')), '[^0-9A-Z]', '', 'g');
        v_plano_diferente := p_convenio_lido is not null
          and v_cadastro.insurance_id is not null
          and v_cadastro.insurance_id <> p_convenio_lido;
        v_plano_novo := p_convenio_lido is not null and v_cadastro.insurance_id is null;
        v_numero_novo := p_numero_da_carteirinha is not null
          and v_cartao_de_antes = ''
          and not v_plano_diferente;
        v_numero_diferente := p_numero_da_carteirinha is not null
          and v_cartao_de_antes <> ''
          and v_cartao_de_antes <> p_numero_da_carteirinha;
        if v_numero_novo then v_campos := array_append(v_campos, 'insurance_card'); end if;
        if v_plano_novo then v_campos := array_append(v_campos, 'insurance_id'); end if;
        if cardinality(v_campos) > 0 then
          update public.contact k
             set insurance_card = case when v_numero_novo then p_numero_da_carteirinha else k.insurance_card end,
                 insurance_id = case when v_plano_novo then p_convenio_lido else k.insurance_id end
           where k.id = v_contato
             and k.clinic_id = v_clinica;
          -- A trilha: quais campos e de qual mensagem, nunca o valor.
          insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
          values (v_clinica, auth.uid(), 'gravou_carteirinha_lida', 'contact', v_contato,
                  jsonb_build_object('campos', to_jsonb(v_campos), 'message_id', p_message_id));
        end if;
        if v_numero_diferente or v_plano_diferente then
          v_nota := format('A carteirinha que a pessoa mandou tem %s diferente do cadastro, e o cadastro não mudou: confira o arquivo nesta conversa.',
                           case when v_numero_diferente and v_plano_diferente then 'número e convênio'
                                when v_numero_diferente then 'número'
                                else 'convênio' end);
        end if;
      end if;
    end if;
    if v_nota is not null then
      -- O caminho de anotarPassagemParaAEquipe: nota interna do sistema, sem job e
      -- sem cobranca. A conversa continua com a IA.
      insert into public.message (clinic_id, conversation_id, direction, author, content_type,
                                  body, is_internal_note, billable, cost_cents)
      values (v_clinica, v_conversa, 'saida', 'sistema', 'texto',
              c_cabecalho_da_nota || E'\n' || v_nota, true, false, 0);
    end if;
    -- [matriz de 06/11/2026] fim
    return jsonb_build_object('ok', true, 'reutilizado', false, 'id', v_id)
      || public.carteirinha_na_resposta_da_leitura(v_clinica, v_contato, p_tipo);
  end if;

  select l.id, l.midia, l.tipo, l.transcricao, l.segundos_de_audio,
         l.procedimentos, l.fora_do_cadastro, l.confianca, l.resumo, l.convenio_lido_id
    into v_leitura
    from public.ia_leitura_da_midia l
   where l.message_id = p_message_id;
  return jsonb_build_object(
    'ok', true,
    'reutilizado', true,
    'id', v_leitura.id,
    'leitura', jsonb_build_object(
      'midia', v_leitura.midia,
      'tipo', v_leitura.tipo,
      'transcricao', v_leitura.transcricao,
      'segundos_de_audio', v_leitura.segundos_de_audio,
      'procedimentos', to_jsonb(v_leitura.procedimentos),
      'fora_do_cadastro', v_leitura.fora_do_cadastro,
      'confianca', v_leitura.confianca,
      'resumo', v_leitura.resumo,
      'convenio_lido_id', v_leitura.convenio_lido_id
    )
  ) || public.carteirinha_na_resposta_da_leitura(v_clinica, v_contato, v_leitura.tipo);
end;
$function$;
