-- Autoria da previa da conversa.
--
-- Revisao da leva 2 (achado L2). A previa do cartao (migration
-- 20260925100000) mostra a ultima mensagem que o paciente ve, venha de quem
-- vier, mas nao dizia QUEM escreveu. Depois que a recepcao respondia, o cartao
-- mostrava "Custa R$ 200." sem marca nenhuma, ao lado da hora da ultima fala
-- do paciente: quem olhava a lista lia a resposta da clinica como se fosse o
-- paciente falando. A triagem pela previa (quem quer preco, quem quer
-- remarcar) se perdia em toda conversa ja respondida.
--
-- Duas colunas novas em conversation, DERIVADAS da mesma mensagem da previa e
-- mantidas pelo MESMO recalculo (recalcular_previa_da_conversa):
--   last_preview_author          quem escreveu a mensagem da previa:
--                                paciente, usuario, ia ou sistema (os mesmos
--                                valores de message.author). Nulo quando a
--                                conversa ainda nao tem mensagem visivel.
--   last_preview_author_user_id  a pessoa da equipe, quando o autor e
--                                'usuario'. A tela escreve "Voce:" quando e
--                                quem esta olhando e "Clinica:" nos outros
--                                casos. Sem chave estrangeira: e copia
--                                derivada de message.author_user_id, que ja
--                                tem a dela.
--
-- PRIVACIDADE: nao e conteudo de mensagem (so o papel de quem escreveu e o id
-- de uma pessoa da equipe, que o fio ja mostra). Fica na propria linha de
-- conversation, sob a MESMA RLS que ja recorta a conversa por clinica e por
-- papel, e chega ao Realtime pelo mesmo filtro.
--
-- ESCRITA: igual a da previa. So a funcao de recalculo escreve; o guarda
-- proteger_previa_da_conversa passa a cobrir as duas colunas novas, e uma
-- escrita direta (INSERT ou UPDATE vindo da API ou do service role fora da
-- funcao) volta ao valor anterior.
--
-- As funcoes partem da definicao VIGENTE em producao (conferida em
-- 24/09/2026, identica a da migration 20260925100000); a unica mudanca e
-- levar author e author_user_id junto com o tipo e o trecho.
--
-- Producao em 24/09/2026 (so contagens): 172 conversas; mensagens visiveis
-- ao paciente: 5262 entrada/paciente, 14 saida/usuario (todas com a pessoa),
-- 4 saida/sistema, 1 saida/ia.
-- APLICAR ANTES do deploy do codigo: o select da lista do Atendimento passa a
-- pedir last_preview_author e last_preview_author_user_id.

alter table public.conversation
  add column if not exists last_preview_author text,
  add column if not exists last_preview_author_user_id uuid;

alter table public.conversation
  drop constraint if exists conversation_last_preview_author_check,
  add constraint conversation_last_preview_author_check
    check (
      last_preview_author is null
      or last_preview_author in ('paciente', 'usuario', 'ia', 'sistema')
    );

comment on column public.conversation.last_preview_author is
  'Quem escreveu a mensagem da previa (paciente, usuario, ia, sistema). Derivado de message por gatilho, junto com last_preview.';
comment on column public.conversation.last_preview_author_user_id is
  'Pessoa da equipe que escreveu a mensagem da previa, quando o autor e usuario. Derivado de message por gatilho.';

-- Recalcula a previa de UMA conversa a partir da ultima mensagem que conta.
-- Mesma escolha de mensagem de antes (ultima que nao e nota nem evento).
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
  v_autor text;
  v_autor_usuario uuid;
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
    end,
    m.author,
    case when m.author = 'usuario' then m.author_user_id end
  into v_kind, v_previa, v_autor, v_autor_usuario
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
      last_preview_kind = v_kind,
      last_preview_author = v_autor,
      last_preview_author_user_id = v_autor_usuario
  where c.id = p_conversation_id
    and (
      c.last_preview is distinct from v_previa
      or c.last_preview_kind is distinct from v_kind
      or c.last_preview_author is distinct from v_autor
      or c.last_preview_author_user_id is distinct from v_autor_usuario
    );
  perform set_config('conduzza.escrevendo_previa', '', true);
end;
$$;

revoke all on function public.recalcular_previa_da_conversa(uuid)
  from public, anon, authenticated;

-- Guarda de escrita, agora cobrindo a autoria tambem.
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
      new.last_preview_author := null;
      new.last_preview_author_user_id := null;
    else
      new.last_preview := old.last_preview;
      new.last_preview_kind := old.last_preview_kind;
      new.last_preview_author := old.last_preview_author;
      new.last_preview_author_user_id := old.last_preview_author_user_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_previa_da_conversa()
  from public, anon, authenticated;

drop trigger if exists proteger_previa_da_conversa on public.conversation;
create trigger proteger_previa_da_conversa
  before insert or update of last_preview, last_preview_kind,
    last_preview_author, last_preview_author_user_id
  on public.conversation
  for each row
  execute function public.proteger_previa_da_conversa();

-- Backfill: todas as conversas, pela mesma funcao que o gatilho usa. So as
-- que ganham autoria sao atualizadas (o UPDATE e condicional).
select public.recalcular_previa_da_conversa(c.id)
from public.conversation c;
