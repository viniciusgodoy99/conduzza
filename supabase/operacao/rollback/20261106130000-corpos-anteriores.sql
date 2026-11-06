-- Rollback manual da migration 20261106130000_leitor_carteirinha_e_ilegivel.sql
-- (a matriz de arquivos do dono, 06/11/2026).
--
-- O QUE A MIGRATION FEZ: a coluna ia_leitura_da_midia.convenio_lido_id e o CHECK
-- dela; gravar_leitura_da_midia com os dois parametros novos, a gravacao da
-- carteirinha no contato e as notas; dados_que_faltam_para_marcar com p_contato;
-- e os tres que a chamam (agendar_pela_ia, registrar_dados_da_marcacao e
-- ler_atendimento_da_ia).
--
-- O QUE ESTE ARQUIVO FAZ: tira a coluna e devolve as cinco funcoes aos corpos e
-- comentarios de antes, com os grants, e confere o md5(prosrc).
--
-- ORDEM: primeiro voltar o codigo, depois este arquivo. Com o codigo novo e o
-- banco de antes, toda midia vai para a equipe (42703 na leitura das leituras).
--
-- O QUE SE PERDE: o convenio lido de cada carteirinha. O QUE FICA: os numeros e os
-- planos ja gravados em contact (saem so pela ficha do paciente; a trilha
-- gravou_carteirinha_lida diz em quais contatos) e as notas internas. Conferir
-- antes, se for preciso:
--   select entity_id, detalhes, created_at from public.audit_log
--    where action = 'gravou_carteirinha_lida' order by created_at desc;
--
-- TRAVAS: ACCESS EXCLUSIVE em ia_leitura_da_midia (o DROP COLUMN, sem reescrever) e
-- catalogo. lock_timeout de 3 s: o rollback falha inteiro e roda-se de novo.

begin;
-- inicio do rollback
set local lock_timeout = '3s';

drop function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text, uuid, text);
drop function public.carteirinha_na_resposta_da_leitura(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.gravar_leitura_da_midia(p_job_id uuid, p_worker text, p_message_id uuid, p_midia text, p_tipo text, p_transcricao text, p_segundos integer, p_procedimentos uuid[], p_fora_do_cadastro integer, p_confianca text, p_resumo text, p_modelo text, p_versao text)
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
  -- A habilidade de cada midia, no jsonb skills da ultima versao publicada.
  c_habilidade_do_audio constant text := 'ler_audio';
  c_habilidade_do_arquivo constant text := 'ler_imagem_e_documento';
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
  v_skills jsonb;
  v_id uuid;
  v_leitura record;
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

  -- 9. A habilidade da midia ligada na ULTIMA versao publicada (a que o
  -- agente le no WhatsApp). A figurinha local tambem exige a de arquivo.
  select a.skills into v_skills
    from public.ai_agent_config a
   where a.clinic_id = v_clinica
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if (v_skills ->> (case when v_arquivo then c_habilidade_do_arquivo
                         else c_habilidade_do_audio end)) is distinct from 'true' then
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

  -- 12 e 13. A primeira leitura vale: grava, ou devolve a que ja existe
  -- (de qualquer job), sem regravar.
  insert into public.ia_leitura_da_midia (
    clinic_id, conversation_id, message_id, job_id, midia, tipo,
    transcricao, segundos_de_audio, procedimentos, fora_do_cadastro,
    confianca, resumo, modelo, versao
  ) values (
    v_clinica, v_conversa, p_message_id, p_job_id, p_midia, p_tipo,
    p_transcricao, p_segundos, v_itens, v_fora,
    p_confianca, p_resumo, p_modelo, p_versao
  )
  on conflict (message_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'reutilizado', false, 'id', v_id);
  end if;

  select l.id, l.midia, l.tipo, l.transcricao, l.segundos_de_audio,
         l.procedimentos, l.fora_do_cadastro, l.confianca, l.resumo
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
      'resumo', v_leitura.resumo
    )
  );
end;
$function$;

revoke execute on function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text)
  to service_role;

comment on function public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text) is
  'So o servidor (service_role; o motor da IA, no turno). AG6b: grava a transcricao do audio ou a leitura da imagem ou do documento da mensagem p_message_id em ia_leitura_da_midia. Na ordem: 22004 parametro_nulo (job, worker, mensagem, midia, tipo, modelo ou versao nulo); 22023 com o codigo, as regras dos CHECKs: midia_invalida, tipo_invalido, transcricao_invalida, segundos_invalidos, itens_invalidos, fora_do_cadastro_invalido, confianca_invalida, resumo_invalido, modelo_invalido, versao_invalida (p_procedimentos nulo vale vazio; p_fora_do_cadastro nulo vale 0); {ok:false, motivo:sem_posse} (o job nao e responder_com_ia em executando com o worker, ou a conversa nao e da clinica do job); a trava da mensagem (FOR SHARE, so a desta conversa e clinica) e DEPOIS a da conversa (FOR NO KEY UPDATE); job_antigo (D-A); fora_da_ia (a conversa nao esta em ia_atendendo sem responsavel); mensagem_invalida (nao e desta conversa e clinica, de entrada, do paciente, fora de nota interna, nao apagada, com media_url storage:// e content_type = p_midia); mensagem_nao_lida (fora de ai_turno.mensagens_lidas do job; sem o turno, nada lido); leitura_desligada (a ultima versao publicada sem skills ->> ler_audio = true no audio, ou sem skills ->> ler_imagem_e_documento = true na imagem e no documento); midia_bloqueada (midia_da_ia_liberada falso para o telefone do contato); procedimento_invalido (item que nao e procedure ativo da clinica). Ja existe leitura da mensagem: {ok:true, reutilizado:true, id, leitura:{midia, tipo, transcricao, segundos_de_audio, procedimentos, fora_do_cadastro, confianca, resumo}} (a primeira vale; nunca regrava). Senao grava e devolve {ok:true, reutilizado:false, id}. Nunca 40001 nem 40P01.';

drop function public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text, uuid);

CREATE OR REPLACE FUNCTION public.dados_que_faltam_para_marcar(p_clinic_id uuid, p_service_link_id uuid, p_nome_completo text, p_data_nascimento date, p_cpf text, p_carteirinha text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_config record;
  v_vinculo record;
  v_faltam text[] := array[]::text[];
begin
  -- A versao em uso e a ultima publicada (a mesma de conferir_horario_da_ia).
  select a.exige_nome_completo, a.exige_nascimento, a.exige_cpf
    into v_config
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  if found then
    if v_config.exige_nome_completo and p_nome_completo is null then
      v_faltam := array_append(v_faltam, 'nome_completo');
    end if;
    if v_config.exige_nascimento and p_data_nascimento is null then
      v_faltam := array_append(v_faltam, 'data_nascimento');
    end if;
    if v_config.exige_cpf and p_cpf is null then
      v_faltam := array_append(v_faltam, 'cpf');
    end if;
  end if;
  -- A carteirinha (D-6: so se a clinica ligar): so na consulta pelo
  -- convenio, quando o convenio tem "Carteirinha obrigatoria"
  -- (insurance.requires_card, o Cadastro de convenios) ou o procedimento tem
  -- o requisito carteirinha ativo para todos ou para esse convenio
  -- (procedure_requirement, o cadastro da AG1).
  if p_carteirinha is null and p_service_link_id is not null then
    select sl.procedure_id, sl.insurance_id into v_vinculo
      from public.service_link sl
     where sl.id = p_service_link_id
       and sl.clinic_id = p_clinic_id;
    if found and v_vinculo.insurance_id is not null and (
      exists (
        select 1
          from public.insurance i
         where i.id = v_vinculo.insurance_id
           and i.clinic_id = p_clinic_id
           and i.requires_card
      )
      or exists (
        select 1
          from public.procedure_requirement q
         where q.clinic_id = p_clinic_id
           and q.procedure_id = v_vinculo.procedure_id
           and q.tipo = 'carteirinha'
           and q.ativo
           and (q.insurance_id is null or q.insurance_id = v_vinculo.insurance_id)
      )
    ) then
      v_faltam := array_append(v_faltam, 'carteirinha');
    end if;
  end if;
  return v_faltam;
end;
$function$;

revoke execute on function public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text)
  from public, anon, authenticated, service_role;

comment on function public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text) is
  'Interna (nenhum papel da API executa): os dados que faltam para a IA marcar, em ordem (nome_completo, data_nascimento, cpf, carteirinha). Os tres primeiros pela ultima versao publicada (exige_nome_completo, exige_nascimento, exige_cpf; sem versao publicada, nenhum). A carteirinha so com vinculo de convenio e, nele, o convenio com Carteirinha obrigatoria (insurance.requires_card) ou o requisito carteirinha ativo do procedimento para todos ou para esse convenio (procedure_requirement). Nulo = nao informado.';

CREATE OR REPLACE FUNCTION public.agendar_pela_ia(p_clinic_id uuid, p_conversation_id uuid, p_job_id uuid, p_slot_hold_id uuid DEFAULT NULL::uuid, p_remarcar uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reserva public.slot_hold%rowtype;
  v_conf record;
  v_consulta uuid;
  v_recurso uuid;
  v_pergunta timestamptz;
  -- [agendamento completo] inicio
  v_ja_marcada uuid;
  v_dados public.dados_informados_na_marcacao%rowtype;
  v_faltam text[];
  v_nascimento_no_cadastro date;
  -- [agendamento completo] fim
  -- [remarcar e cancelar] inicio
  v_config record;
  v_pedido record;
  v_antiga record;
  v_vinculo_novo record;
  v_restricao text;
  v_situacao_da_antiga text;
  -- O inicio da antiga num escalar: o campo de um record nao atribuido
  -- falha ate num ramo do CASE que nao roda (o PL/pgSQL avalia antes).
  v_inicio_da_antiga timestamptz;
  v_sim timestamptz;
  -- [remarcar e cancelar] fim
  -- [revisao curta] inicio
  -- B3 (DECISAO DO DONO A CONFIRMAR, cabecalho, ANCORA FORTE NA MARCACAO):
  -- a ancora forte e a mensagem_nova_do_paciente tambem na marcacao da AG3
  -- (sem p_remarcar). Para desfazer, false aqui (uma migration que troca so
  -- esta palavra): a marcacao volta a regra da AG3, e a remarcacao fica
  -- como esta.
  c_ancora_forte_na_marcacao constant boolean := true;
  v_ultima_pergunta timestamptz;
  v_lidas uuid[];
  v_desde_da_reserva timestamptz;
  -- [revisao curta] fim
  -- [revisao final] inicio
  -- A folga do consulta_mudou da remarcacao (cabecalho, REVISAO FINAL, B2):
  -- a mudanca da antiga com changed_at ate 5 s antes da criacao do job da
  -- reserva conta. A mesma constante esta em cancelar_consulta_pela_ia:
  -- trocar o valor e trocar nos dois.
  c_folga_da_mudanca constant interval := interval '5 seconds';
  -- As lidas de todo turno que conta (M1).
  v_respondidas uuid[];
  -- [revisao final] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- Idempotencia: a reserva que este job consumiu devolve a consulta.
  select h.* into v_reserva
    from public.slot_hold h
   where h.job_id_do_agendar = p_job_id;
  if found then
    if v_reserva.clinic_id is distinct from p_clinic_id
       or v_reserva.conversation_id is distinct from p_conversation_id then
      raise exception using errcode = '22023', message = 'job_de_outra_conversa';
    end if;
    -- [revisao final] A reserva que este job consumiu nao e a pedida.
    if p_slot_hold_id is not null and v_reserva.id is distinct from p_slot_hold_id then
      return jsonb_build_object('ok', false, 'motivo', 'reserva_diferente');
    end if;
    if v_reserva.appointment_id is null then
      -- A consulta deste job foi apagada depois: nada a repetir.
      return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
    end if;
    return (
      select jsonb_build_object(
               'ok', true,
               'appointment_id', a.id,
               'starts_at', a.starts_at,
               'ends_at', a.ends_at,
               'reutilizado', true
             )
             -- [remarcar e cancelar] a antiga, quando a consulta e remarcacao
             || case when a.remarcacao_de is null then '{}'::jsonb
                     else jsonb_build_object(
                            'remarcacao_de', a.remarcacao_de,
                            'remarcacao_de_starts_at', (
                              select x.starts_at from public.appointment x
                               where x.id = a.remarcacao_de))
                end
        from public.appointment a
       where a.id = v_reserva.appointment_id
    );
  end if;

  -- A reserva viva desta conversa (no maximo uma; a mais nova, por garantia).
  select h.* into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
   order by h.created_at desc, h.id desc
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
  end if;
  -- [revisao final] A reserva viva nao e a que o "Confirma ...?" perguntou
  -- (outro turno reservou outra depois): o "sim" do paciente nao vale para
  -- ela. Nada grava.
  if p_slot_hold_id is not null and v_reserva.id is distinct from p_slot_hold_id then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_diferente');
  end if;
  if v_reserva.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_vencida');
  end if;

  -- Trava do profissional e a reserva travada: o que foi lido antes da
  -- trava e lido de novo.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold:' || v_reserva.professional_id::text, 0)
  );
  select h.* into v_reserva
    from public.slot_hold h
   where h.id = v_reserva.id
     for update;
  if not found or v_reserva.consumido_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_inexistente');
  end if;
  if v_reserva.expires_at <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'reserva_vencida');
  end if;
  -- [recurso da reserva] (revisao da E4): a trava do recurso do
  -- procedimento, depois da do profissional (a ordem do reservar).
  select pr.resource_id into v_recurso
    from public.service_link sl
    join public.procedure pr
      on pr.id = sl.procedure_id and pr.clinic_id = sl.clinic_id
   where sl.id = v_reserva.service_link_id
     and sl.clinic_id = p_clinic_id;
  if v_recurso is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('slot_hold_recurso:' || v_recurso::text, 0)
    );
  end if;

  -- As mesmas conferencias do reservar, sem a propria reserva e com o fim
  -- dela. Consulta que passou a ocupar o horario (a recepcao marcou por
  -- cima durante a reserva) e conflito, como o 23P01.
  select * into v_conf
    from public.conferir_horario_da_ia(
      p_clinic_id, p_conversation_id, v_reserva.service_link_id,
      v_reserva.starts_at, v_reserva.ends_at, v_reserva.id
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
    );
  if v_conf.o_motivo is not null then
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_conf.o_motivo = 'ocupado' then 'conflito' else v_conf.o_motivo end
    );
  end if;
  if v_conf.o_profissional is distinct from v_reserva.professional_id
     or v_conf.o_recurso is distinct from v_recurso then
    return jsonb_build_object('ok', false, 'motivo', 'vinculo_invalido');
  end if;

  -- [remarcar e cancelar] inicio
  -- A remarcacao (AG4, D-10 e D-26), na ordem: a habilidade e o prazo da
  -- versao em uso, o pedido do estado com o foco na antiga, a antiga
  -- TRAVADA (depois da conversa, do profissional, da reserva e do recurso:
  -- ninguem trava a antiga e depois a nova), a antiga que a IA pode
  -- remarcar (conferir_consulta_da_ia, lida sob a trava: duas remarcacoes
  -- da mesma consulta param aqui, em remarcacao_pendente, antes do insert),
  -- o vinculo da reserva com o mesmo procedimento, profissional e convenio
  -- (ou particular) e, [revisao final] DEPOIS da mensagem nova (abaixo), a
  -- antiga que nao mudou de horario nem de profissional desde o comeco do
  -- turno da reserva (a pergunta T3, que o "sim" confirma, saiu no turno da
  -- reserva e disse o horario da antiga, lido depois da criacao do job;
  -- [revisao curta] antes, a reserva menos 2 minutos, que ainda vale sem o
  -- job).
  if p_remarcar is not null then
    select a.skills, a.remarcar_antecedencia_horas into v_config
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1;
    if not found
       or (v_config.skills ->> 'remarcar') is distinct from 'true'
       or v_config.remarcar_antecedencia_horas is null
    then
      return jsonb_build_object('ok', false, 'motivo', 'remarcacao_desligada');
    end if;
    select * into v_pedido
      from public.pedido_da_ia_na_conversa(p_clinic_id, p_conversation_id, p_job_id);
    if v_pedido.o_pedido is distinct from 'remarcar'
       or v_pedido.o_appointment_id is distinct from p_remarcar
    then
      return jsonb_build_object('ok', false, 'motivo', 'sem_pedido_de_remarcacao');
    end if;
    perform 1
      from public.appointment a
     where a.id = p_remarcar
       and a.clinic_id = p_clinic_id
       for update;
    select * into v_antiga
      from public.conferir_consulta_da_ia(p_clinic_id, v_conf.o_contato, p_remarcar, 'remarcar',
                                          v_config.remarcar_antecedencia_horas);
    if v_antiga.o_motivo is not null then
      return jsonb_build_object('ok', false, 'motivo', v_antiga.o_motivo);
    end if;
    v_inicio_da_antiga := v_antiga.o_inicio;
    select sl.procedure_id, sl.professional_id, sl.insurance_id into v_vinculo_novo
      from public.service_link sl
     where sl.id = v_reserva.service_link_id
       and sl.clinic_id = p_clinic_id;
    if v_vinculo_novo.procedure_id is distinct from v_antiga.o_procedimento
       or v_vinculo_novo.professional_id is distinct from v_antiga.o_profissional
       or v_vinculo_novo.insurance_id is distinct from v_antiga.o_convenio
    then
      return jsonb_build_object('ok', false, 'motivo', 'remarcacao_invalida');
    end if;
  end if;
  -- [remarcar e cancelar] fim

  -- [revisao curta] inicio
  -- Na remarcacao e (B3, c_ancora_forte_na_marcacao) na marcacao: o "sim"
  -- e a pergunta que ele responde, lidos uma vez (a ancora forte, abaixo):
  -- v_sim e a ULTIMA mensagem do paciente; v_ultima_pergunta, a ULTIMA
  -- saida da IA (que nao falhou) gravada depois da reserva e antes do
  -- "sim". E um turno leu o "sim" (a regra de cancelar_consulta_pela_ia): a
  -- ultima mensagem do paciente e toda mensagem dele depois da pergunta
  -- estao entre as que o job leu antes do turno (ai_turno.mensagens_lidas);
  -- a que chegou depois da leitura, ou a lida que foi apagada, e
  -- mensagem_nova_do_paciente (o turno seguinte le de novo).
  -- [revisao final] M1: so e nova a que NENHUM turno leu (as lidas do job
  -- MAIS as dos turnos desta conversa em enviado ou passou_para_equipe e as
  -- dos decididos de outro job: o idsRespondidos do motor); a lida e
  -- apagada continua so pelas lidas do job. M1b: logo depois das recusas
  -- estruturais (a reserva, o horario e, na remarcacao, a habilidade, o
  -- pedido, a antiga travada e conferida e remarcacao_invalida) e ANTES de
  -- tudo o que depende da pessoa: o consulta_mudou da remarcacao, os dados
  -- informados (consulta_para_outra_pessoa, menor_de_idade), ja_tem_consulta,
  -- faltam_dados e as recusas por falta de confirmacao. Nada foi gravado ate
  -- aqui (so travas e leituras).
  if p_remarcar is not null or c_ancora_forte_na_marcacao then
    select max(m.created_at) into v_sim
      from public.message m
     where m.conversation_id = p_conversation_id
       and m.clinic_id = p_clinic_id
       and m.direction = 'entrada'
       and m.author = 'paciente';
    select max(x.created_at) into v_ultima_pergunta
      from public.message x
     where x.conversation_id = p_conversation_id
       and x.clinic_id = p_clinic_id
       and x.direction = 'saida'
       and x.author = 'ia'
       and x.content_type <> 'evento'
       and not x.is_internal_note
       and x.delivery_status is distinct from 'falhou'
       and x.created_at > v_reserva.created_at
       and x.created_at < v_sim;
    select t.mensagens_lidas into v_lidas
      from public.ai_turno t
     where t.job_id = p_job_id
       and t.clinic_id = p_clinic_id
       and t.conversation_id = p_conversation_id;
    v_lidas := coalesce(v_lidas, '{}'::uuid[]);
    select coalesce(array_agg(l.id), '{}'::uuid[]) into v_respondidas
      from public.ai_turno t
      cross join lateral unnest(t.mensagens_lidas) as l(id)
     where t.conversation_id = p_conversation_id
       and t.clinic_id = p_clinic_id
       and (t.job_id = p_job_id
            or t.estado in ('enviado', 'passou_para_equipe')
            or (t.estado = 'decidido' and t.job_id <> p_job_id));
    if exists (
      select 1
        from public.message m
       where m.conversation_id = p_conversation_id
         and m.clinic_id = p_clinic_id
         and m.direction = 'entrada'
         and m.author = 'paciente'
         and (m.created_at >= v_sim or m.created_at > v_ultima_pergunta)
         and ((m.deleted_at is null and not (m.id = any (v_respondidas)))
              or (m.deleted_at is not null and m.id = any (v_lidas)))
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'mensagem_nova_do_paciente');
    end if;
  end if;
  -- [revisao curta] fim

  -- [remarcar e cancelar] inicio
  -- A antiga que nao mudou desde o comeco do turno da reserva ([revisao
  -- final] depois da mensagem nova: o consulta_mudou leva o modelo a
  -- reservar e perguntar de novo).
  if p_remarcar is not null then
    -- [revisao curta] O comeco do turno que fez a reserva (e a pergunta T3,
    -- com o horario da antiga): a criacao do job da reserva
    -- (slot_hold.job_id). Sem o job, a reserva menos 2 minutos (a regra de
    -- antes). Assim a reserva feita de novo depois de um consulta_mudou (com
    -- a hora atual da antiga) vale, logo que o job dela nasce mais de 5 s
    -- depois da mudanca. [revisao final] B2: com o job, menos
    -- c_folga_da_mudanca (5 s): o changed_at da trilha e o comeco da
    -- transacao da recepcao.
    select j.created_at - c_folga_da_mudanca into v_desde_da_reserva
      from public.job_queue j
     where j.id = v_reserva.job_id
       and j.clinic_id = p_clinic_id
       and j.created_at <= v_reserva.created_at;
    if exists (
      select 1
        from public.appointment_status_history h
       where h.appointment_id = p_remarcar
         and h.clinic_id = p_clinic_id
         and h.kind = 'remarcacao'
         and h.changed_at > coalesce(v_desde_da_reserva, v_reserva.created_at - interval '2 minutes')
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'consulta_mudou');
    end if;
  end if;
  -- [remarcar e cancelar] fim

  -- [agendamento completo] inicio
  -- Na ordem: primeiro o que passa para a equipe (D-8), depois a consulta
  -- que ja existe e por fim os dados que faltam (a IA nao pede dado para
  -- uma consulta que nao vai marcar). [revisao final] Tudo isto depois da
  -- mensagem nova (acima): depende do que a pessoa informou ou pede uma
  -- resposta dela.
  -- (a) Os dados informados: a linha aberta da conversa, do contato de
  -- agora (registrar_dados_da_marcacao, sob a mesma trava da conversa) e
  -- [revisao final] da janela atual da IA (a de outra janela, inclusive a
  -- marca de outra pessoa, nao vale depois do Devolver), lidas na mesma
  -- foto.
  select d.* into v_dados
    from public.dados_informados_na_marcacao d
    join public.ia_janela_da_conversa w
      on w.conversation_id = d.conversation_id
     and w.clinic_id = d.clinic_id
     and w.desde = d.janela_desde
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     and d.contact_id = v_conf.o_contato
     for update of d;
  -- (b) D-8: consulta para outra pessoa passa para a equipe.
  if v_dados.id is not null and not v_dados.para_o_titular then
    return jsonb_build_object('ok', false, 'motivo', 'consulta_para_outra_pessoa');
  end if;
  -- (c) D-8: menor de 18 anos no dia da consulta (no fuso da clinica) passa
  -- para a equipe, pelo nascimento informado ou pelo do cadastro do contato
  -- (basta um dos dois).
  select k.birth_date into v_nascimento_no_cadastro
    from public.contact k
   where k.id = v_conf.o_contato
     and k.clinic_id = p_clinic_id;
  if exists (
    select 1
      from unnest(array[v_dados.data_nascimento, v_nascimento_no_cadastro]) as n(nascimento)
     where n.nascimento > ((v_reserva.starts_at at time zone v_conf.o_fuso)::date - interval '18 years')::date
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'menor_de_idade');
  end if;
  -- (d) ja_tem_consulta: o contato da conversa ja tem consulta futura ativa
  -- (nao cancelada, nao recusada, nem faltou nem compareceu; a pendente da
  -- IA conta) do mesmo procedimento, com qualquer profissional. Devolve a
  -- consulta (a mais proxima), para a IA oferecer remarcar. [remarcar e
  -- cancelar] So fora da remarcacao (a remarcacao troca uma consulta por
  -- outra).
  select a.id into v_ja_marcada
    from public.appointment a
    join public.service_link sl on sl.id = a.service_link_id and sl.clinic_id = a.clinic_id
   where a.clinic_id = p_clinic_id
     and a.contact_id = v_conf.o_contato
     and sl.procedure_id = (
       select x.procedure_id from public.service_link x
        where x.id = v_reserva.service_link_id and x.clinic_id = p_clinic_id)
     and a.starts_at > now()
     and a.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou', 'compareceu')
     and a.approval_status is distinct from 'recusado'
     -- [remarcar e cancelar] So fora da remarcacao: nenhuma conta (nem a
     -- antiga, nem outra do mesmo procedimento, nem a pendente da IA)
     and p_remarcar is null
   order by a.starts_at, a.id
   limit 1;
  if v_ja_marcada is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_consulta', 'appointment_id', v_ja_marcada);
  end if;
  -- (e) D-6: os dados que a clinica exige para marcar. [remarcar e
  -- cancelar] A remarcacao nao pede dado (D-26): a consulta e a mesma.
  if p_remarcar is null then
    v_faltam := public.dados_que_faltam_para_marcar(
      p_clinic_id, v_reserva.service_link_id, v_dados.nome_completo, v_dados.data_nascimento,
      v_dados.cpf, v_dados.carteirinha);
    if cardinality(v_faltam) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'faltam_dados', 'faltam', to_jsonb(v_faltam));
    end if;
  end if;
  -- [agendamento completo] fim

  -- [confirmacao depois da pergunta] (revisao da E4): o paciente confirmou
  -- numa mensagem PROPRIA, depois de a IA perguntar. A pergunta e a
  -- PRIMEIRA resposta da IA gravada depois da reserva (o "Confirma ...?" do
  -- turno que reservou), e so a que nao falhou (a que falhou nao chegou ao
  -- paciente). A mensagem do paciente que chegou entre a reserva e a
  -- pergunta nao vale: ele ainda nao tinha visto dia, hora, profissional e
  -- procedimento, e o historico do turno seguinte a mostra depois da
  -- pergunta (as pendentes vao para o fim).
  select min(x.created_at) into v_pergunta
    from public.message x
   where x.conversation_id = p_conversation_id
     and x.clinic_id = p_clinic_id
     and x.direction = 'saida'
     and x.author = 'ia'
     and x.created_at > v_reserva.created_at
     and x.delivery_status is distinct from 'falhou';
  if v_pergunta is null or not exists (
    select 1
      from public.message m
     where m.conversation_id = p_conversation_id
       and m.clinic_id = p_clinic_id
       and m.direction = 'entrada'
       and m.author = 'paciente'
       and m.created_at > v_pergunta
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
  end if;
  -- [remarcar e cancelar] inicio
  -- Na remarcacao e (B3, revisao curta: c_ancora_forte_na_marcacao) na
  -- marcacao, alem disso, a ancora forte (a de cancelar_consulta_pela_ia,
  -- com a reserva no lugar do pedido): a ULTIMA mensagem do paciente tem,
  -- como ultima mensagem de saida antes dela, a resposta da IA (que nao
  -- falhou) gravada depois da reserva (a pergunta "Confirma ...?" sai no
  -- turno da reserva). Conta toda saida que nao e evento nem nota interna,
  -- de qualquer autor e em qualquer situacao de entrega; empate no instante
  -- conta como outra no meio. Com c_ancora_forte_na_marcacao false, a
  -- marcacao fica so com a regra acima (a da AG3).
  if p_remarcar is not null or c_ancora_forte_na_marcacao then
    if v_ultima_pergunta is null or exists (
      select 1
        from public.message o
       where o.conversation_id = p_conversation_id
         and o.clinic_id = p_clinic_id
         and o.direction = 'saida'
         and o.content_type <> 'evento'
         and not o.is_internal_note
         and (o.author is distinct from 'ia' or o.delivery_status is not distinct from 'falhou')
         and o.created_at >= v_ultima_pergunta
         and o.created_at < v_sim
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'sem_confirmacao_do_paciente');
    end if;
  end if;
  -- [remarcar e cancelar] fim

  -- A consulta pendente (D12), sem regua ate a aprovacao e sem oferecer a
  -- vaga a lista de espera se for recusada. 23P01: conflito, nada gravado.
  begin
    insert into public.appointment (
      clinic_id, contact_id, professional_id, service_link_id, resource_id,
      starts_at, ends_at, status, created_by, approval_status,
      send_confirmation, oferecer_vaga_ao_cancelar, is_overbooking, source
      -- [agendamento completo] a unidade da reserva
      , unit_id
      -- [remarcar e cancelar] a antiga
      , remarcacao_de
    ) values (
      p_clinic_id, v_conf.o_contato, v_reserva.professional_id, v_reserva.service_link_id,
      v_conf.o_recurso, v_reserva.starts_at, v_reserva.ends_at, 'agendado', 'ia', 'pendente',
      false, false, false, 'interna'
      -- [agendamento completo] a unidade da reserva
      , v_reserva.unit_id
      -- [remarcar e cancelar] a antiga (nula fora da remarcacao)
      , p_remarcar
    )
    returning id into v_consulta;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'motivo', 'conflito');
    -- [remarcar e cancelar] O indice unico de uma remarcacao pendente por
    -- consulta (a defesa em profundidade: a leitura sob a trava da antiga
    -- ja recusa antes). Outro 23505 sobe como esta.
    when unique_violation then
      get stacked diagnostics v_restricao = constraint_name;
      if v_restricao = 'appointment_uma_remarcacao_pendente' then
        return jsonb_build_object('ok', false, 'motivo', 'remarcacao_pendente');
      end if;
      raise;
  end;

  -- A reserva vira a consulta: consumida (fica, e o elo e a idempotencia) e
  -- vencida agora (a Agenda so desenha reserva com expires_at > now()).
  update public.slot_hold h
     set consumido_em = now(),
         appointment_id = v_consulta,
         job_id_do_agendar = p_job_id,
         expires_at = least(h.expires_at, now())
   where h.id = v_reserva.id;

  -- [agendamento completo] inicio
  -- Os dados informados ficam com a reserva consumida e a consulta (D-7: a
  -- aprovacao os aplica ao cadastro do contato). [remarcar e cancelar] Na
  -- remarcacao, nao (D-26: ela nao pede dado; a linha aberta fica como
  -- estava, para a proxima marcacao da janela).
  if v_dados.id is not null and p_remarcar is null then
    update public.dados_informados_na_marcacao d
       set appointment_id = v_consulta,
           slot_hold_id = v_reserva.id
     where d.id = v_dados.id;
  end if;
  -- [agendamento completo] fim

  -- [remarcar e cancelar] inicio
  -- Na antiga (D-10: ela vale ate a aprovacao), o que o botao Remarcar faz
  -- (pedir_remarcacao_pelo_paciente): a marca "Pediu para remarcar" (a
  -- que ja existia fica), os toques da regua que ainda nao sairam pulados
  -- (remarcacao_pedida) e a linha de evento da trilha, agora com autor ia,
  -- repetindo a situacao atual (ela nao muda).
  if p_remarcar is not null then
    update public.appointment a
       set remarcacao_pedida_em = coalesce(a.remarcacao_pedida_em, now())
     where a.id = p_remarcar
       and a.clinic_id = p_clinic_id
    returning a.status into v_situacao_da_antiga;
    update public.cadence_run r
       set skipped_reason = 'remarcacao_pedida'
     where r.clinic_id = p_clinic_id
       and r.appointment_id = p_remarcar
       and r.sent_at is null
       and r.skipped_reason is null;
    insert into public.appointment_status_history (
      clinic_id, appointment_id, status, changed_by_user_id, changed_by, event
    ) values (
      p_clinic_id, p_remarcar, v_situacao_da_antiga, null, 'ia', 'remarcacao_pedida'
    );
  end if;
  -- [remarcar e cancelar] fim

  if p_remarcar is null then
    insert into public.message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'A IA marcou '
        || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'DD/MM') || ' às '
        || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'HH24:MI')
        || ' (' || v_conf.o_procedimento || ', ' || v_conf.o_nome_do_profissional
        || '), pendente de aprovação da equipe.',
      false, 0
    );
  else
    -- [remarcar e cancelar] o evento da remarcacao
    insert into public.message (
      clinic_id, conversation_id, direction, author, content_type, body,
      billable, cost_cents
    ) values (
      p_clinic_id, p_conversation_id, 'saida', 'sistema', 'evento',
      'A IA pediu a remarcação da consulta de '
        || to_char(v_inicio_da_antiga at time zone v_conf.o_fuso, 'DD/MM') || ' às '
        || to_char(v_inicio_da_antiga at time zone v_conf.o_fuso, 'HH24:MI')
        || ' para '
        || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'DD/MM') || ' às '
        || to_char(v_reserva.starts_at at time zone v_conf.o_fuso, 'HH24:MI')
        || ' (' || v_conf.o_procedimento || ', ' || v_conf.o_nome_do_profissional
        || '), pendente de aprovação da equipe.',
      false, 0
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_consulta,
    'starts_at', v_reserva.starts_at,
    'ends_at', v_reserva.ends_at,
    'reutilizado', false
  )
  -- [remarcar e cancelar] a antiga, na remarcacao
  || case when p_remarcar is null then '{}'::jsonb
          else jsonb_build_object('remarcacao_de', p_remarcar,
                                  'remarcacao_de_starts_at', v_inicio_da_antiga)
     end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_dados_da_marcacao(p_clinic_id uuid, p_conversation_id uuid, p_job_id uuid, p_para_o_titular boolean, p_nome_completo text DEFAULT NULL::text, p_data_nascimento date DEFAULT NULL::date, p_cpf text DEFAULT NULL::text, p_carteirinha text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_brancos constant text := '[' || E'\u0009\u000a\u000b\u000c\u000d                  　﻿' || ']+';
  v_conversa record;
  v_fuso text;
  v_hoje date;
  v_nome text;
  v_cpf text;
  v_carteirinha text;
  v_invalidos text[] := array[]::text[];
  v_reserva public.slot_hold%rowtype;
  v_aberta public.dados_informados_na_marcacao%rowtype;
  v_id uuid;
  v_faltam text[];
  -- [revisao final] inicio
  v_desde timestamptz;
  v_de_outra_janela uuid;
  -- [revisao final] fim
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null
     or p_para_o_titular is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- A trava da conversa, a mesma do reservar e do agendar: o agendar que
  -- confere os dados espera este terminar, e vice-versa.
  perform pg_advisory_xact_lock(
    hashtextextended('slot_hold_conversa:' || p_conversation_id::text, 0)
  );

  -- O job de outra conversa (a mesma regra do reservar e do agendar).
  if exists (
    select 1 from public.dados_informados_na_marcacao d
     where d.job_id = p_job_id
       and (d.clinic_id is distinct from p_clinic_id
            or d.conversation_id is distinct from p_conversation_id)
  ) then
    raise exception using errcode = '22023', message = 'job_de_outra_conversa';
  end if;

  -- A conversa e da clinica, esta com a IA, e a IA pode atender este contato
  -- neste numero (a regra 4 de conferir_horario_da_ia).
  select c.contact_id, c.status, c.whatsapp_account_id, k.phone_key
    into v_conversa
    from public.conversation c
    join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  if not found
     or v_conversa.status is distinct from 'ia_atendendo'
     or not public.ia_pode_atender(p_clinic_id, v_conversa.whatsapp_account_id, v_conversa.phone_key)
  then
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;
  -- [revisao final] inicio
  -- A janela atual da IA na conversa (o Devolver abre outra). Sem janela, a
  -- IA nao esta atendendo: ia_desligada, nada grava.
  select w.desde into v_desde
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_desde is null then
    return jsonb_build_object('ok', false, 'motivo', 'ia_desligada');
  end if;
  -- [revisao final] fim

  select coalesce(nullif(c.timezone, ''), 'America/Fortaleza') into v_fuso
    from public.clinic c where c.id = p_clinic_id;
  v_hoje := (now() at time zone coalesce(v_fuso, 'America/Fortaleza'))::date;

  -- A reserva viva da conversa, se houver (a linha guarda qual era).
  select h.* into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
     and h.expires_at > now()
   order by h.created_at desc, h.id desc
   limit 1;

  -- A linha aberta da conversa (no maximo uma), travada.
  select d.* into v_aberta
    from public.dados_informados_na_marcacao d
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     for update;
  -- [revisao final] inicio
  -- A linha aberta de outra janela nao vale (nem a marca de outra pessoa):
  -- daqui em diante e como se nao houvesse linha, e ela sai na gravacao
  -- (abaixo). Com dado invalido nada grava, e ela fica, ignorada.
  if v_aberta.id is not null and v_aberta.janela_desde is distinct from v_desde then
    v_de_outra_janela := v_aberta.id;
    v_aberta := null;
  end if;
  -- [revisao final] fim

  -- D-8: a consulta e para outra pessoa. Nenhum dado pessoal fica (o de
  -- antes desta conversa sai), so a marca, e a IA passa para a equipe.
  if not p_para_o_titular then
    -- [revisao final] a linha de outra janela sai
    delete from public.dados_informados_na_marcacao d
     where d.id = v_de_outra_janela;
    if v_aberta.id is null then
      insert into public.dados_informados_na_marcacao (
        clinic_id, conversation_id, contact_id, slot_hold_id, para_o_titular, job_id
        -- [revisao final] a janela
        , janela_desde
      ) values (
        p_clinic_id, p_conversation_id, v_conversa.contact_id, v_reserva.id, false, p_job_id
        -- [revisao final] a janela
        , v_desde
      );
    else
      update public.dados_informados_na_marcacao d
         set contact_id = v_conversa.contact_id,
             slot_hold_id = v_reserva.id,
             nome_completo = null,
             data_nascimento = null,
             cpf = null,
             carteirinha = null,
             para_o_titular = false,
             job_id = p_job_id
       where d.id = v_aberta.id;
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'consulta_para_outra_pessoa');
  end if;

  -- A forma de cada dado informado; o que veio nulo nao muda o que ja
  -- estava. Nome: brancos juntados, aparado, de 2 a 120, com pelo menos duas
  -- palavras e sem digito nem simbolo. Nascimento: de 1900 ate hoje (no fuso
  -- da clinica). CPF: so os digitos, 11, com os verificadores. Carteirinha:
  -- brancos juntados, aparada, ate 60, so letras sem acento, digitos,
  -- espaco, ponto, hifen e barra, e pelo menos 4 digitos. Errado: nada
  -- grava, e a lista diz quais (nunca o valor).
  if p_nome_completo is not null then
    v_nome := btrim(regexp_replace(p_nome_completo, v_brancos, ' ', 'g'), ' ');
    if char_length(v_nome) not between 2 and 120
       or v_nome !~ '[^ ] +[^ ]'
       or v_nome ~ '[0-9@#$%&*_=+<>{}|/:;"!?()\[\]\\]'
       or not public.cadastro_texto_valido(v_nome, 120)
    then
      v_invalidos := array_append(v_invalidos, 'nome_completo');
    end if;
  end if;
  if p_data_nascimento is not null
     and (p_data_nascimento < date '1900-01-01' or p_data_nascimento > v_hoje) then
    v_invalidos := array_append(v_invalidos, 'data_nascimento');
  end if;
  if p_cpf is not null then
    v_cpf := regexp_replace(p_cpf, '[^0-9]', '', 'g');
    if not public.cpf_valido(v_cpf) or p_cpf !~ '^[0-9 .\-]+$' then
      v_invalidos := array_append(v_invalidos, 'cpf');
    end if;
  end if;
  if p_carteirinha is not null then
    v_carteirinha := btrim(regexp_replace(p_carteirinha, v_brancos, ' ', 'g'), ' ');
    if char_length(v_carteirinha) not between 1 and 60
       or v_carteirinha !~ '^[0-9A-Za-z .\-/]+$'
       or char_length(regexp_replace(v_carteirinha, '[^0-9]', '', 'g')) < 4
       or not public.cadastro_texto_valido(v_carteirinha, 60)
    then
      v_invalidos := array_append(v_invalidos, 'carteirinha');
    end if;
  end if;
  if cardinality(v_invalidos) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'dados_invalidos', 'invalidos', to_jsonb(v_invalidos));
  end if;

  -- A linha aberta: a de antes, se for do mesmo contato e para o titular (o
  -- que veio nulo fica como estava); senao, comeca de novo.
  if v_aberta.id is not null
     and (v_aberta.contact_id is distinct from v_conversa.contact_id or not v_aberta.para_o_titular)
  then
    v_aberta.nome_completo := null;
    v_aberta.data_nascimento := null;
    v_aberta.cpf := null;
    v_aberta.carteirinha := null;
  end if;
  v_aberta.nome_completo := coalesce(v_nome, v_aberta.nome_completo);
  v_aberta.data_nascimento := coalesce(p_data_nascimento, v_aberta.data_nascimento);
  v_aberta.cpf := coalesce(v_cpf, v_aberta.cpf);
  v_aberta.carteirinha := coalesce(v_carteirinha, v_aberta.carteirinha);
  -- [revisao final] a linha de outra janela sai
  delete from public.dados_informados_na_marcacao d
   where d.id = v_de_outra_janela;
  if v_aberta.id is null then
    insert into public.dados_informados_na_marcacao (
      clinic_id, conversation_id, contact_id, slot_hold_id, nome_completo, data_nascimento,
      cpf, carteirinha, para_o_titular, job_id
      -- [revisao final] a janela
      , janela_desde
    ) values (
      p_clinic_id, p_conversation_id, v_conversa.contact_id, v_reserva.id, v_aberta.nome_completo,
      v_aberta.data_nascimento, v_aberta.cpf, v_aberta.carteirinha, true, p_job_id
      -- [revisao final] a janela
      , v_desde
    )
    returning id into v_id;
  else
    update public.dados_informados_na_marcacao d
       set contact_id = v_conversa.contact_id,
           slot_hold_id = v_reserva.id,
           nome_completo = v_aberta.nome_completo,
           data_nascimento = v_aberta.data_nascimento,
           cpf = v_aberta.cpf,
           carteirinha = v_aberta.carteirinha,
           para_o_titular = true,
           job_id = p_job_id
     where d.id = v_aberta.id;
    v_id := v_aberta.id;
  end if;

  -- D-8: menor de 18 anos (no dia da reserva viva, ou hoje sem ela) passa
  -- para a equipe. O dado fica (e do proprio paciente): o agendar recusa.
  if v_aberta.data_nascimento is not null
     and v_aberta.data_nascimento > (coalesce((v_reserva.starts_at at time zone v_fuso)::date, v_hoje)
                                     - interval '18 years')::date
  then
    return jsonb_build_object('ok', false, 'motivo', 'menor_de_idade', 'dados_id', v_id);
  end if;

  v_faltam := public.dados_que_faltam_para_marcar(
    p_clinic_id, v_reserva.service_link_id, v_aberta.nome_completo, v_aberta.data_nascimento,
    v_aberta.cpf, v_aberta.carteirinha);
  return jsonb_build_object('ok', true, 'dados_id', v_id, 'faltam', to_jsonb(v_faltam));
end;
$function$;

CREATE OR REPLACE FUNCTION public.ler_atendimento_da_ia(p_clinic_id uuid, p_conversation_id uuid, p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conversa record;
  v_desde timestamptz;
  v_contato_da_janela uuid;
  v_job record;
  v_linha public.ia_atendimento%rowtype;
  v_estado jsonb;
  v_versao integer;
  v_dados public.dados_informados_na_marcacao%rowtype;
  v_reserva uuid;
begin
  if p_clinic_id is null or p_conversation_id is null or p_job_id is null then
    raise exception using errcode = '22004', message = 'parametro_nulo';
  end if;

  -- O job e desta conversa (senao 22023: erro de quem chama).
  select j.created_at into v_job
    from public.job_queue j
   where j.id = p_job_id
     and j.kind = 'responder_com_ia'
     and j.clinic_id = p_clinic_id
     and j.payload ->> 'conversation_id' = p_conversation_id::text;
  if not found then
    raise exception using errcode = '22023', message = 'job_invalido';
  end if;

  -- A conversa e da clinica, esta com a IA, sem responsavel, com a janela
  -- do contato de agora.
  select c.status, c.assignee_user_id, c.contact_id into v_conversa
    from public.conversation c
   where c.id = p_conversation_id
     and c.clinic_id = p_clinic_id;
  select w.desde, w.contact_id into v_desde, v_contato_da_janela
    from public.ia_janela_da_conversa w
   where w.conversation_id = p_conversation_id
     and w.clinic_id = p_clinic_id;
  if v_conversa.status is distinct from 'ia_atendendo'
     or v_conversa.assignee_user_id is not null
     or v_desde is null
     or v_contato_da_janela is distinct from v_conversa.contact_id
  then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_ia');
  end if;
  -- D-A do E3: o job de antes da janela atual (Assumir e Devolver no meio)
  -- nao le o estado da janela nova.
  if v_job.created_at < v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'job_antigo');
  end if;

  select a.* into v_linha
    from public.ia_atendimento a
   where a.conversation_id = p_conversation_id
     and a.janela_desde = v_desde;
  if v_linha.id is null then
    v_estado := public.ia_estado_do_atendimento(null::public.ia_atendimento);
    v_versao := 0;
  elsif v_linha.job_id = p_job_id then
    -- O mesmo job de novo (outra tentativa): parte do estado de antes dele.
    v_estado := coalesce(v_linha.anterior, public.ia_estado_do_atendimento(null::public.ia_atendimento));
    v_versao := v_linha.versao - 1;
  else
    v_estado := public.ia_estado_do_atendimento(v_linha);
    v_versao := v_linha.versao;
  end if;

  -- O que o paciente ja informou (so se informou; nunca o valor) e o que
  -- falta, pela reserva viva da conversa. [revisao final] So a linha da
  -- janela atual: a de antes do Devolver nao vale.
  select d.* into v_dados
    from public.dados_informados_na_marcacao d
   where d.clinic_id = p_clinic_id
     and d.conversation_id = p_conversation_id
     and d.appointment_id is null
     and d.contact_id = v_conversa.contact_id
     and d.janela_desde = v_desde;
  select h.service_link_id into v_reserva
    from public.slot_hold h
   where h.clinic_id = p_clinic_id
     and h.conversation_id = p_conversation_id
     and h.consumido_em is null
     and h.expires_at > now()
   order by h.created_at desc, h.id desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'versao', v_versao,
    'janela_desde', v_desde,
    'estado', v_estado,
    'dados', jsonb_build_object(
      'nome_completo', v_dados.nome_completo is not null,
      'data_nascimento', v_dados.data_nascimento is not null,
      'cpf', v_dados.cpf is not null,
      'carteirinha', v_dados.carteirinha is not null,
      'para_o_titular', v_dados.para_o_titular,
      'faltam', to_jsonb(public.dados_que_faltam_para_marcar(
        p_clinic_id, v_reserva, v_dados.nome_completo, v_dados.data_nascimento, v_dados.cpf,
        v_dados.carteirinha))));
end;
$function$;

alter table public.ia_leitura_da_midia
  drop constraint ia_leitura_da_midia_convenio_so_na_carteirinha,
  drop column convenio_lido_id;

comment on column public.ia_leitura_da_midia.fora_do_cadastro is
  'Quantos itens do pedido nao estao no Cadastro (0 a 20; acima de 0 so no pedido: a conversa vai para a equipe). O pedido tem pelo menos um item ou fora_do_cadastro >= 1.';

do $conferencia$
declare
  v_dif text;
begin
  select string_agg(x.nome, ', ') into v_dif
    from (values
      ('gravar_leitura_da_midia', to_regprocedure('public.gravar_leitura_da_midia(uuid, text, uuid, text, text, text, integer, uuid[], integer, text, text, text, text)'), 'd97c6bdcaefa8a0082f613e052286dbd'),
      ('dados_que_faltam_para_marcar', to_regprocedure('public.dados_que_faltam_para_marcar(uuid, uuid, text, date, text, text)'), '275422b4e036651f6757f1d70789b3d1'),
      ('agendar_pela_ia', to_regprocedure('public.agendar_pela_ia(uuid, uuid, uuid, uuid, uuid)'), 'a6ea708b537e4e048f2e13e528350e22'),
      ('registrar_dados_da_marcacao', to_regprocedure('public.registrar_dados_da_marcacao(uuid, uuid, uuid, boolean, text, date, text, text)'), '86651bc0e9b53c9b64bc0d1e9768d83f'),
      ('ler_atendimento_da_ia', to_regprocedure('public.ler_atendimento_da_ia(uuid, uuid, uuid)'), '96a23f92438b9c362c31ab8ac40fa4df')
    ) as x(nome, oid, esperado)
    left join pg_catalog.pg_proc p on p.oid = x.oid
   where md5(p.prosrc) is distinct from x.esperado;
  if v_dif is not null then
    raise exception using errcode = 'P0001', message = 'rollback_corpo_diferente',
      hint = 'Nao voltaram ao corpo de antes da 20261106130000: ' || v_dif;
  end if;
end;
$conferencia$;

notify pgrst, 'reload schema';
-- fim do rollback
commit;
