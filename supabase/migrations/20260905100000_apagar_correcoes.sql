-- Correções das regras de apagar, vindas da revisão adversarial de 03/09/2026.
--
-- Três defeitos distintos, todos no mesmo par de funções:
--
-- 1. QUEM APAGOU ficava errado. apagar_mensagem_do_paciente gravava
--    origem = 'paciente' fixo, casando só por (clinic_id, wa_message_id). Mas o
--    provedor emite o evento 'Deleted' para TODO MUNDO, inclusive quando quem
--    apagou fomos nós ou a clínica pelo celular pareado. O WhatsApp não deixa
--    ninguém revogar mensagem alheia para todos, então uma linha de SAÍDA
--    apagada só pode ter sido apagada pela clínica. A lápide dizia "O paciente
--    apagou esta mensagem" sobre um ato da própria recepção.
--
-- 2. O ECO PODIA GANHAR A CORRIDA. O apagamento 'todos' revoga no provedor e só
--    depois grava aqui. Nesse intervalo o webhook do eco pode chegar primeiro e
--    marcar a linha; a gravação seguinte então encontrava deleted_at preenchido,
--    devolvia 'ja_apagada', e a atendente via "Não foi possível apagar agora"
--    logo depois de uma revogação que funcionou e não tem volta.
--
-- 3. APAGAR SÓ AQUI ERA BECO SEM SAÍDA. A guarda 'ja_apagada' vinha antes de
--    olhar o escopo, então quem apagasse 'local' por engano nunca mais
--    conseguia tirar a mensagem do celular do paciente, mesmo com o prazo de 60
--    horas inteiro pela frente.
--
-- pode_apagar_mensagem passa a devolver, além do veredito, QUAL AÇÃO cabe:
--   'apagar'   a linha está viva: arquiva no cofre e limpa.
--   'escalar'  já apagada como 'local': promove o escopo para 'todos'.
--   'adotar'   já apagada pelo eco do provedor, sem autoria: grava quem foi.

create or replace function public.pode_apagar_mensagem(
  p_message_id uuid,
  p_escopo text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  v_uid uuid := auth.uid();
  v_acao text;
  v_prazo constant interval := interval '60 hours';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  if p_escopo not in ('todos', 'local') then
    return jsonb_build_object('ok', false, 'motivo', 'escopo_invalido');
  end if;

  select id, clinic_id, direction, author_user_id, is_internal_note,
         wa_message_id, media_url, content_type, created_at,
         deleted_at, deleted_by, deleted_source, deleted_escopo
    into m
    from public.message
   where id = p_message_id;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;

  -- Papel primeiro: 'leitura' e 'pendente' não passam daqui. Repete a regra da
  -- policy de escrita de propósito, porque esta função é SECURITY DEFINER e
  -- portanto a RLS não roda dentro dela.
  if not public.user_can_write(m.clinic_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Quem escreveu, mais administrador e gestor. Mensagem do paciente e de
  -- 'ia'/'sistema' tem author_user_id nulo, então só a chefia as apaga.
  if m.author_user_id is distinct from v_uid
     and not public.user_has_role(m.clinic_id, array['admin', 'gestor']) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_sua');
  end if;

  if m.deleted_at is null then
    v_acao := 'apagar';
  elsif m.deleted_escopo = 'local' and p_escopo = 'todos' then
    -- Arrependimento legítimo: apagou só aqui e agora quer tirar do celular do
    -- paciente. O conteúdo já foi para o cofre e wa_message_id continua na
    -- linha, então só falta revogar lá fora e promover o escopo.
    v_acao := 'escalar';
  elsif m.deleted_by is null
        and m.deleted_source = 'clinica'
        and p_escopo = 'todos' then
    -- O eco do provedor chegou antes da nossa gravação. A mensagem JÁ sumiu do
    -- celular do paciente; o que falta é registrar quem mandou apagar.
    v_acao := 'adotar';
  else
    return jsonb_build_object('ok', false, 'motivo', 'ja_apagada');
  end if;

  -- 'adotar' não reconfere o prazo: a revogação já aconteceu lá fora, e recusar
  -- agora deixaria um apagamento consumado sem dono no registro.
  if p_escopo = 'todos' and v_acao <> 'adotar' then
    if m.is_internal_note then
      return jsonb_build_object('ok', false, 'motivo', 'nota_e_local');
    end if;
    if m.direction <> 'saida' then
      return jsonb_build_object('ok', false, 'motivo', 'do_paciente');
    end if;
    if m.wa_message_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'nunca_saiu');
    end if;
    if now() - m.created_at > v_prazo then
      return jsonb_build_object('ok', false, 'motivo', 'prazo_vencido');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'acao', v_acao,
    'clinic_id', m.clinic_id,
    'wa_message_id', m.wa_message_id,
    -- Em 'escalar' e 'adotar' a linha já foi limpa: o caminho do arquivo só
    -- existe no cofre, e é de lá que ele tem de vir para ser removido do acervo.
    'media_url', coalesce(
      m.media_url,
      (select a.media_url from public.message_apagada a
        where a.message_id = m.id)
    ),
    'nota_interna', m.is_internal_note
  );
end;
$$;

create or replace function public.apagar_mensagem(
  p_message_id uuid,
  p_escopo text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_veredito jsonb := public.pode_apagar_mensagem(p_message_id, p_escopo);
  v_acao text := v_veredito ->> 'acao';
begin
  if (v_veredito ->> 'ok')::boolean is not true then
    return v_veredito;
  end if;

  if v_acao = 'apagar' then
    perform public.arquivar_e_limpar_mensagem(
      p_message_id, p_escopo, 'clinica', auth.uid()
    );
  else
    -- 'escalar' e 'adotar': o conteúdo já está no cofre e a linha já está
    -- limpa. Só o registro de escopo e de autoria muda. Em 'escalar' o
    -- deleted_by original é PRESERVADO (quem apagou primeiro apagou mesmo); em
    -- 'adotar' ele estava nulo e passa a ter dono.
    update public.message
       set deleted_escopo = p_escopo,
           deleted_by = coalesce(deleted_by, auth.uid())
     where id = p_message_id;
    update public.message_apagada
       set escopo = p_escopo,
           apagada_por = coalesce(apagada_por, auth.uid())
     where message_id = p_message_id;
  end if;

  -- Trilha: apagar conteúdo de conversa de paciente é ato que precisa de dono e
  -- hora. O cofre guarda o que era; o audit_log guarda que alguém apagou.
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (
    (v_veredito ->> 'clinic_id')::uuid,
    auth.uid(),
    case
      when v_acao = 'escalar' then 'ampliou_apagamento_para_todos'
      when p_escopo = 'todos' then 'apagou_mensagem_para_todos'
      else 'apagou_mensagem_local'
    end,
    'message',
    p_message_id
  );

  return v_veredito;
end;
$$;

-- Renomeada de apagar_mensagem_do_paciente: o nome antigo afirmava o que a
-- função não tinha como saber. Ela reage a um evento 'Deleted' do provedor, e o
-- provedor não diz quem apagou.
create or replace function public.registrar_apagamento_do_whatsapp(
  p_clinic_id uuid,
  p_wa_message_id text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  m record;
  v_origem text;
begin
  select id, media_url, direction into m
    from public.message
   where clinic_id = p_clinic_id
     and wa_message_id = p_wa_message_id
     and deleted_at is null
   limit 1;

  if not found then
    -- Também é o caso normal quando fomos nós que apagamos: a linha já tem
    -- deleted_at, e o eco não sobrescreve a autoria do primeiro.
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;

  -- QUEM apagou, deduzido do que o WhatsApp permite: ninguém revoga para todos
  -- a mensagem de outra pessoa. Linha de saída só pode ter sido apagada pela
  -- clínica (pelo celular pareado, ou por nós com o eco chegando primeiro);
  -- linha de entrada, só pelo paciente.
  v_origem := case when m.direction = 'saida' then 'clinica' else 'paciente' end;

  perform public.arquivar_e_limpar_mensagem(m.id, 'todos', v_origem, null);

  return jsonb_build_object(
    'ok', true, 'message_id', m.id, 'media_url', m.media_url, 'origem', v_origem
  );
end;
$$;

revoke all on function public.registrar_apagamento_do_whatsapp(uuid, text)
  from public, anon, authenticated;

drop function if exists public.apagar_mensagem_do_paciente(uuid, text);
