-- Previa da ultima mensagem no cartao da conversa.
--
-- Revisao de liberacao de 24/09/2026, achado 14. O cartao da lista do
-- Atendimento mostrava "Lead · Novo contato" em 150 de 155 conversas: para
-- saber quem queria preco, quem queria remarcar e quem mandou exame, a
-- recepcionista precisava abrir uma a uma, e abrir marca como lida para a
-- equipe inteira. O brief (docs/02, Tela 1) pede "Previa da ultima mensagem,
-- 12px, uma linha com reticencias".
--
-- Duas colunas novas em conversation, DERIVADAS de message e mantidas so por
-- gatilho:
--   last_preview      trecho de ate 120 caracteres da ultima mensagem que o
--                     paciente ve (texto, legenda da midia ou nome do
--                     documento), com espacos e quebras de linha colapsados;
--                     nulo quando a ultima mensagem nao tem texto ou foi
--                     apagada.
--   last_preview_kind o tipo dessa mensagem: texto, template, imagem, video,
--                     audio, documento, ou 'apagada' (a tela escreve
--                     "Mensagem apagada"). Nulo quando a conversa ainda nao
--                     tem mensagem visivel.
-- Nota interna e evento de sistema NUNCA entram: nao sao conversa com o
-- paciente (a nota nem sai do sistema).
--
-- Mensagem apagada (arquivar_e_limpar_mensagem zera o corpo e grava
-- deleted_at): o gatilho de UPDATE recalcula, a previa vira 'apagada' e o
-- texto sai da conversa na mesma transacao em que sai da mensagem. Nenhum
-- trecho apagado sobra na lista.
--
-- PRIVACIDADE: e dado de paciente (conversa conta como dado de saude, regra
-- 3.1). Fica na propria linha de conversation, sob a MESMA RLS que ja recorta
-- a conversa por clinica e por papel (o profissional so ve a dele), e chega
-- ao Realtime pelo mesmo filtro. Nenhum log le ou escreve estas colunas.
--
-- ESCRITA: so a funcao de recalculo escreve (chamada pelo gatilho de message
-- e pelo backfill). Um BEFORE em conversation desfaz qualquer tentativa
-- direta (INSERT ou UPDATE vindo da API) de forjar a previa: a funcao liga
-- uma configuracao local da transacao que nenhum cliente da API alcanca.
--
-- Custo: um SELECT com LIMIT 1 pelo indice message(conversation_id,
-- created_at desc) e um UPDATE condicional (so quando muda) por mensagem.
--
-- Producao em 24/09/2026, ANTES: 164 conversas, nenhuma coluna de previa.
-- DEPOIS (ensaiado em transacao desfeita, so contagens): 129 texto (1 sem
-- trecho), 20 imagem, 13 audio, 2 documento; nenhum trecho acima de 120.
-- Gatilho conferido no mesmo ensaio: nota interna e evento ignorados, video
-- pelo mimetype, apagada sem texto (via arquivar_e_limpar_mensagem), escrita
-- direta desfeita pelo guarda, status de entrega sem efeito.
-- APLICAR ANTES do deploy do codigo: o select da lista do Atendimento ja pede
-- last_preview e last_preview_kind.

alter table public.conversation
  add column if not exists last_preview text,
  add column if not exists last_preview_kind text;

alter table public.conversation
  drop constraint if exists conversation_last_preview_tamanho,
  add constraint conversation_last_preview_tamanho
    check (last_preview is null or char_length(last_preview) <= 120),
  drop constraint if exists conversation_last_preview_kind_check,
  add constraint conversation_last_preview_kind_check
    check (
      last_preview_kind is null
      or last_preview_kind in (
        'texto', 'template', 'imagem', 'video', 'audio', 'documento', 'apagada'
      )
    );

comment on column public.conversation.last_preview is
  'Trecho (ate 120 caracteres) da ultima mensagem visivel ao paciente. Derivado de message por gatilho; dado de paciente sob a RLS de conversation.';
comment on column public.conversation.last_preview_kind is
  'Tipo da ultima mensagem visivel ao paciente (texto, template, imagem, video, audio, documento) ou apagada. Derivado de message por gatilho.';

-- Recalcula a previa de UMA conversa a partir da ultima mensagem que conta.
create or replace function public.recalcular_previa_da_conversa(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_previa text;
begin
  select
    case
      when m.deleted_at is not null then 'apagada'
      when m.content_type = 'imagem'
        and coalesce(m.media_mimetype, '') like 'video/%' then 'video'
      else m.content_type
    end,
    case
      when m.deleted_at is not null then null
      else nullif(
        btrim(left(
          regexp_replace(
            btrim(coalesce(
              nullif(btrim(m.body), ''),
              case when m.content_type = 'documento' then m.media_filename end,
              ''
            )),
            '\s+', ' ', 'g'
          ),
          120
        )),
        ''
      )
    end
  into v_kind, v_previa
  from public.message m
  where m.conversation_id = p_conversation_id
    and not m.is_internal_note
    and m.content_type <> 'evento'
  order by m.created_at desc, m.id desc
  limit 1;

  -- Senha local da transacao para o guarda de escrita (proteger_previa_da_
  -- conversa): so esta funcao escreve a previa. Nenhum cliente da API
  -- consegue ligar esta configuracao.
  perform set_config('conduzza.escrevendo_previa', 'sim', true);
  update public.conversation c
  set last_preview = v_previa,
      last_preview_kind = v_kind
  where c.id = p_conversation_id
    and (
      c.last_preview is distinct from v_previa
      or c.last_preview_kind is distinct from v_kind
    );
  perform set_config('conduzza.escrevendo_previa', '', true);
end;
$$;

revoke all on function public.recalcular_previa_da_conversa(uuid)
  from public, anon, authenticated;

create or replace function public.manter_previa_da_conversa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalcular_previa_da_conversa(new.conversation_id);
  return null;
end;
$$;

revoke all on function public.manter_previa_da_conversa()
  from public, anon, authenticated;

drop trigger if exists manter_previa_ao_inserir_mensagem on public.message;
create trigger manter_previa_ao_inserir_mensagem
  after insert on public.message
  for each row
  when (not new.is_internal_note and new.content_type <> 'evento')
  execute function public.manter_previa_da_conversa();

-- Apagar (deleted_at e corpo), trocar legenda ou tipo: recalcula. Status de
-- entrega, media_url e transcricao mudam o tempo todo e nao mexem na previa,
-- por isso ficam fora da lista de colunas.
drop trigger if exists manter_previa_ao_mudar_mensagem on public.message;
create trigger manter_previa_ao_mudar_mensagem
  after update of body, deleted_at, content_type, is_internal_note,
    media_filename, media_mimetype
  on public.message
  for each row
  when (
    old.body is distinct from new.body
    or old.deleted_at is distinct from new.deleted_at
    or old.content_type is distinct from new.content_type
    or old.is_internal_note is distinct from new.is_internal_note
    or old.media_filename is distinct from new.media_filename
    or old.media_mimetype is distinct from new.media_mimetype
  )
  execute function public.manter_previa_da_conversa();

-- Guarda de escrita: a previa e derivada. Escrita direta (API, Server Action,
-- service role fora da funcao de recalculo) volta ao valor anterior; conversa
-- nova nasce sem previa e o gatilho de message preenche.
create or replace function public.proteger_previa_da_conversa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('conduzza.escrevendo_previa', true), '') <> 'sim'
  then
    if tg_op = 'INSERT' then
      new.last_preview := null;
      new.last_preview_kind := null;
    else
      new.last_preview := old.last_preview;
      new.last_preview_kind := old.last_preview_kind;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_previa_da_conversa()
  from public, anon, authenticated;

drop trigger if exists proteger_previa_da_conversa on public.conversation;
create trigger proteger_previa_da_conversa
  before insert or update of last_preview, last_preview_kind
  on public.conversation
  for each row
  execute function public.proteger_previa_da_conversa();

-- Backfill: todas as conversas, pela mesma funcao que o gatilho usa.
select public.recalcular_previa_da_conversa(c.id)
from public.conversation c;
