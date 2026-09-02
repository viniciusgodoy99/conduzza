-- Responder citando uma mensagem (fase 7 do escopo acrescentado do Atendimento).
--
-- SAO DUAS COLUNAS, e nao uma, por um caso que acontece de verdade:
--
--   reply_to_message_id     a mensagem citada, quando ela e uma linha NOSSA.
--                           E o que a tela usa para desenhar a previa da
--                           citacao e para rolar ate o original.
--   reply_to_wa_message_id  o id da mensagem no WhatsApp. Existe porque o
--                           paciente pode citar algo que nunca virou linha
--                           nossa: mensagem anterior a conexao da clinica,
--                           mensagem de um evento que o webhook perdeu, ou
--                           resposta enviada pelo celular pareado. Sem esta
--                           coluna, a citacao seria descartada em silencio e a
--                           conversa perderia o "responder" que o paciente fez.
--
-- A referencia e ON DELETE SET NULL, nao CASCADE: apagar a mensagem citada nao
-- pode apagar a resposta. Quem apaga uma pergunta nao esta apagando o que a
-- clinica respondeu, e o contrario destruiria historico de atendimento.

alter table public.message
  add column if not exists reply_to_message_id uuid
    references public.message(id) on delete set null,
  add column if not exists reply_to_wa_message_id text;

comment on column public.message.reply_to_message_id is
  'Mensagem citada, quando ela existe como linha nossa. ON DELETE SET NULL: apagar a citada nao apaga a resposta.';
comment on column public.message.reply_to_wa_message_id is
  'Id da citada no WhatsApp. Preenchido tambem quando a citada nunca virou linha nossa (anterior a conexao, ou perdida pelo webhook).';

-- Indice necessario por dois motivos independentes: o ON DELETE SET NULL faz
-- varredura por esta coluna a cada apagamento, e a tela pede a citada junto
-- com a pagina de mensagens.
create index if not exists message_reply_to_idx
  on public.message (reply_to_message_id)
  where reply_to_message_id is not null;

-- Resolve a citacao que chegou do paciente: o webhook so conhece o id do
-- WhatsApp, e a linha correspondente pode ou nao existir do nosso lado.
--
-- Roda como funcao, e nao como update solto no codigo do webhook, porque o
-- clinic_id PRECISA entrar na busca: wa_message_id nao e unico entre clinicas
-- (cada instancia numera as suas), e casar so pelo id faria a citacao de uma
-- clinica apontar para a mensagem de outra. Isso e vazamento entre clinicas,
-- que a regra 3.1 do CLAUDE.md trata como falha grave.
create or replace function public.vincular_citacao_recebida(
  p_clinic_id uuid,
  p_message_id uuid,
  p_quoted_wa_id text
) returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.message m
     set reply_to_wa_message_id = p_quoted_wa_id,
         reply_to_message_id = (
           select c.id
             from public.message c
            where c.clinic_id = p_clinic_id
              and c.wa_message_id = p_quoted_wa_id
              and c.conversation_id = m.conversation_id
            limit 1
         )
   where m.id = p_message_id
     and m.clinic_id = p_clinic_id;
$$;

-- Chamada apenas pelo webhook, com service role. Nenhum navegador precisa
-- dela, entao ninguem alem do servidor a enxerga.
revoke all on function public.vincular_citacao_recebida(uuid, uuid, text)
  from public, anon, authenticated;
