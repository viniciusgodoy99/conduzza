-- ---------------------------------------------------------------------------
-- Fechar o balde de midia no Postgres, nao no codigo
-- ---------------------------------------------------------------------------
-- CONTEXTO. Ate hoje o unico controle de privacidade do acervo de audio e foto
-- de PACIENTE era o flag public=false do balde: nao existia NENHUMA policy em
-- storage.objects (grep nas migrations devolvia zero). Isso funcionava porque o
-- unico leitor era o service role, no worker. A tela do Atendimento vai passar
-- a exibir essa midia, e isso cria o PRIMEIRO caminho de leitura de arquivo de
-- paciente pelo navegador.
--
-- A regra 3.1 do CLAUDE.md e explicita: "Nunca filtrar tenant so no codigo da
-- aplicacao. O filtro vive na policy do Postgres. Se a RLS falhar, o dado nao
-- pode vazar." Assinar a URL com service role e conferir a clinica num if do
-- TypeScript seria exatamente o que a regra proibe. Por isso a rota vai assinar
-- com o cliente de SESSAO, e quem decide e a policy abaixo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. deleted_at nasce aqui, e nao na fase de apagar
-- ---------------------------------------------------------------------------
-- A policy precisa da coluna para nascer completa. Criar a policy agora e
-- reescreve-la depois seria deixar uma janela em que a midia de uma mensagem
-- apagada continua acessivel, justamente o caso que o apagamento existe para
-- fechar.

alter table public.message
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deleted_source text
    check (deleted_source is null or deleted_source in ('clinica', 'paciente'));

comment on column public.message.deleted_at is
  'Quando a mensagem foi apagada. A linha NAO e removida: conversa de paciente e dado de saude e a trilha de quem falou o que continua obrigatoria (LGPD). O conteudo vai para message_apagada.';

create index if not exists message_nao_apagada_idx
  on public.message (conversation_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. O caminho do objeto e o contrato
-- ---------------------------------------------------------------------------
-- lib/jobs/worker.ts grava sempre em `${clinic_id}/${message_id}`. A funcao
-- abaixo le o segundo segmento como uuid e devolve null para qualquer coisa
-- fora do formato, para um caminho torto nunca virar excecao de cast dentro de
-- uma policy (o que derrubaria a consulta inteira em vez de negar o acesso).
--
-- IMMUTABLE de proposito: permite ao planejador reusar o resultado e mantem a
-- policy barata.

create or replace function public.midia_mensagem_do_caminho(p_caminho text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when p_caminho ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_caminho, '/', 2)::uuid
    else null
  end
$$;

comment on function public.midia_mensagem_do_caminho(text) is
  'Le o message_id do caminho clinic_id/message_id usado no balde midia-conversas. Devolve null fora do formato, para caminho torto negar acesso em vez de lancar erro dentro da policy.';

-- ---------------------------------------------------------------------------
-- 3. A policy de leitura
-- ---------------------------------------------------------------------------
-- Tres condicoes, e nenhuma delas e redundante:
--
--   a) a mensagem existe e o usuario PODE LE-LA. A subconsulta em
--      public.message roda como o usuario da sessao, entao a RLS de message
--      aplica: o recorte por clinica e a regra do papel 'profissional' (que so
--      ve conversa atribuida a ele, migration 20260820100000:126-135) valem de
--      graca e NAO sao duplicadas aqui. Duplicar seria criar um segundo lugar
--      para errar.
--
--   b) o clinic_id do CAMINHO bate com o da mensagem. Sem isso, um caminho
--      forjado `${clinica_alheia}/${minha_mensagem}` passaria: o atacante
--      informa o caminho, nao nos.
--
--   c) a mensagem nao esta apagada.

drop policy if exists "membro le midia da propria mensagem" on storage.objects;

create policy "membro le midia da propria mensagem"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'midia-conversas'
    and exists (
      select 1
      from public.message m
      where m.id = public.midia_mensagem_do_caminho(storage.objects.name)
        and m.clinic_id::text = split_part(storage.objects.name, '/', 1)
        and m.deleted_at is null
    )
  );

-- NAO existe policy de INSERT, UPDATE ou DELETE de proposito: escrita no balde
-- continua exclusiva do service role (o worker). Quando o atendente puder
-- ENVIAR midia, a policy de insert entra na fase propria, com user_can_write.

-- ---------------------------------------------------------------------------
-- 4. Teto de tamanho do balde
-- ---------------------------------------------------------------------------
-- 48 MB. O teto de download do provedor e 40 MB de base64
-- (MAX_DOWNLOAD_BYTES em uazapi.ts:36), o que da cerca de 30 MB de binario. O
-- limite do balde vale TAMBEM para o service role, entao apertar demais faria
-- midia grande recebida falhar em 'storage_falhou', longe da causa real.

update storage.buckets
set file_size_limit = 50331648
where id = 'midia-conversas';

-- allowed_mime_types fica NULO de proposito: lib/jobs/worker.ts:203-205 sobe
-- como application/octet-stream o que nao casa a lista dele, e uma segunda
-- lista aqui faria a mesma midia ser aceita num lugar e recusada no outro.
