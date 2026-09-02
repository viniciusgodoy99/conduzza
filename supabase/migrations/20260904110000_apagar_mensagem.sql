-- Apagar mensagem (fase 8 do escopo acrescentado do Atendimento).
--
-- Duas operacoes diferentes, com o mesmo botao no WhatsApp e regras opostas:
--
--   'todos'  some do celular do paciente tambem. So vale para mensagem que NOS
--            enviamos, que ja saiu (tem wa_message_id) e esta dentro do prazo
--            que o WhatsApp concede a quem enviou.
--   'local'  some so da conversa da clinica. Vale para qualquer mensagem, sem
--            prazo, e o paciente continua vendo a dele.
--
-- PRAZO: 60 horas. E o que o WhatsApp concede para "apagar para todos" desde
-- 2022 (2 dias e 12 horas), confirmado a pedido do dono do produto em
-- 02/09/2026. Vencido o prazo, o aplicativo do paciente recusa a revogacao, e
-- deixar o botao ativo faria a clinica acreditar que apagou algo que continua
-- na tela do paciente. Falhar antes e mais honesto que falhar depois.
--
-- QUEM APAGA (decisao do dono, 02/09/2026): quem escreveu a mensagem, mais
-- administrador e gestor. O papel 'leitura' nunca, e isso nao depende de
-- esconder botao: user_can_write ja o exclui, e a checagem vive aqui.
--
-- NOTA INTERNA e diferente, tambem por decisao do dono: ela nunca saiu do
-- predio, entao nao tem prazo, nao chama o provedor, e so pode ser apagada
-- como 'local' (pedir 'todos' para uma nota nao significa nada).

-- 1. O escopo, ao lado das colunas que a fase da midia ja criou.
alter table public.message
  add column if not exists deleted_escopo text
    check (deleted_escopo is null or deleted_escopo in ('todos', 'local'));

comment on column public.message.deleted_escopo is
  'todos: revogada tambem no WhatsApp do paciente. local: some so da conversa da clinica.';

-- 2. O cofre.
--
-- A linha em message continua existindo (com o corpo anulado) para a conversa
-- manter a lapide e a ordem; o CONTEUDO vem para ca. Isso nao e preciosismo de
-- auditoria: message esta publicada no tempo real e a tela assina os eventos,
-- entao deixar o texto na linha faria o apagamento empurrar o texto apagado
-- por websocket para todas as abas abertas da clinica, que e o oposto de
-- apagar.
create table if not exists public.message_apagada (
  message_id uuid primary key references public.message(id) on delete cascade,
  clinic_id uuid not null references public.clinic(id) on delete cascade,
  conversation_id uuid not null,
  content_type text,
  body text,
  media_url text,
  transcript text,
  wa_message_id text,
  escopo text not null check (escopo in ('todos', 'local')),
  origem text not null check (origem in ('clinica', 'paciente')),
  apagada_por uuid references auth.users(id),
  apagada_em timestamptz not null default now()
);

alter table public.message_apagada enable row level security;

create index if not exists message_apagada_clinica_idx
  on public.message_apagada (clinic_id, apagada_em desc);

-- Conteudo apagado e o material mais sensivel da tabela: e justamente o que
-- alguem quis tirar da tela. So administrador e gestor alcancam, e ninguem
-- escreve pela sessao (nao existe policy de insert, update ou delete): o cofre
-- so e preenchido pelas funcoes abaixo.
drop policy if exists "admin e gestor leem o cofre de apagadas" on public.message_apagada;
create policy "admin e gestor leem o cofre de apagadas"
  on public.message_apagada for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- 3. Move o conteudo para o cofre e limpa a linha viva.
--
-- Interna: nenhum navegador a alcanca. Existe para que as duas portas de
-- entrada (a clinica apagando, o paciente apagando) nao tenham cada uma a sua
-- copia da regra "primeiro arquiva, depois limpa". Uma copia que envelhece
-- viraria apagamento sem cofre.
create or replace function public.arquivar_e_limpar_mensagem(
  p_message_id uuid,
  p_escopo text,
  p_origem text,
  p_por uuid
) returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  insert into public.message_apagada (
    message_id, clinic_id, conversation_id, content_type, body, media_url,
    transcript, wa_message_id, escopo, origem, apagada_por
  )
  select id, clinic_id, conversation_id, content_type, body, media_url,
         transcript, wa_message_id, p_escopo, p_origem, p_por
    from public.message
   where id = p_message_id
  on conflict (message_id) do nothing;

  update public.message
     set body = null,
         media_url = null,
         transcript = null,
         deleted_at = now(),
         deleted_by = p_por,
         deleted_source = p_origem,
         deleted_escopo = p_escopo
   where id = p_message_id;
end;
$$;

revoke all on function public.arquivar_e_limpar_mensagem(uuid, text, text, uuid)
  from public, anon, authenticated;

-- 4. As regras, num lugar so.
--
-- Devolve o veredito E os dados que o servidor precisa depois (o id no
-- WhatsApp para revogar, o caminho do arquivo para remover do acervo). Fica
-- separada da que grava porque o apagamento 'todos' tem tres passos em ordem
-- obrigatoria: conferir, revogar no WhatsApp, so entao gravar. Gravar antes de
-- revogar deixaria a clinica achando que a mensagem sumiu do celular do
-- paciente quando o provedor recusou.
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
  v_prazo constant interval := interval '60 hours';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  if p_escopo not in ('todos', 'local') then
    return jsonb_build_object('ok', false, 'motivo', 'escopo_invalido');
  end if;

  select id, clinic_id, direction, author_user_id, is_internal_note,
         wa_message_id, media_url, content_type, created_at, deleted_at
    into m
    from public.message
   where id = p_message_id;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;

  -- Papel primeiro: 'leitura' e 'pendente' nao passam daqui. Repete a regra da
  -- policy de escrita de proposito, porque esta funcao e SECURITY DEFINER e
  -- portanto a RLS nao roda dentro dela.
  if not public.user_can_write(m.clinic_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Quem escreveu, mais administrador e gestor. Mensagem do paciente e de
  -- 'ia'/'sistema' tem author_user_id nulo, entao so a chefia as apaga.
  if m.author_user_id is distinct from v_uid
     and not public.user_has_role(m.clinic_id, array['admin', 'gestor']) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_e_sua');
  end if;

  if m.deleted_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_apagada');
  end if;

  if p_escopo = 'todos' then
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
    'clinic_id', m.clinic_id,
    'wa_message_id', m.wa_message_id,
    'media_url', m.media_url,
    'nota_interna', m.is_internal_note
  );
end;
$$;

-- 5. Grava. Reconfere TUDO antes, porque entre a conferencia e a gravacao a
-- clinica pode ter mudado o papel de quem pediu, ou o prazo pode ter vencido.
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
begin
  if (v_veredito ->> 'ok')::boolean is not true then
    return v_veredito;
  end if;

  perform public.arquivar_e_limpar_mensagem(
    p_message_id, p_escopo, 'clinica', auth.uid()
  );

  -- Trilha: apagar conteudo de conversa de paciente e ato que precisa de dono
  -- e hora. O cofre guarda o que era; o audit_log guarda que alguem apagou.
  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (
    (v_veredito ->> 'clinic_id')::uuid,
    auth.uid(),
    case when p_escopo = 'todos'
      then 'apagou_mensagem_para_todos'
      else 'apagou_mensagem_local' end,
    'message',
    p_message_id
  );

  return v_veredito;
end;
$$;

grant execute on function public.pode_apagar_mensagem(uuid, text) to authenticated;
grant execute on function public.apagar_mensagem(uuid, text) to authenticated;

-- 6. O paciente apagou do lado dele.
--
-- Chega como messages_update com Type 'Deleted'. Sem isto, a conversa da
-- clinica continuaria mostrando um texto que o paciente ja tirou da tela dele,
-- e a recepcao responderia a uma mensagem que, para quem escreveu, nao existe
-- mais.
--
-- Casa por (clinic_id, wa_message_id): o id do WhatsApp nao e unico entre
-- clinicas, cada instancia numera os seus.
create or replace function public.apagar_mensagem_do_paciente(
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
begin
  select id, media_url into m
    from public.message
   where clinic_id = p_clinic_id
     and wa_message_id = p_wa_message_id
     and deleted_at is null
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;

  perform public.arquivar_e_limpar_mensagem(m.id, 'todos', 'paciente', null);

  return jsonb_build_object(
    'ok', true, 'message_id', m.id, 'media_url', m.media_url
  );
end;
$$;

revoke all on function public.apagar_mensagem_do_paciente(uuid, text)
  from public, anon, authenticated;
