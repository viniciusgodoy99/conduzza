-- Midia que nunca vai chegar ganha estado final explicito.
--
-- Revisao de liberacao de 24/09/2026, achados 11, 24 e 130. A bolha do
-- Atendimento so conhecia dois estados de arquivo: pronto (storage://) e
-- "Baixando o arquivo" (todo o resto). Quando o download desistia de vez, ou
-- a mensagem chegava sem URL e o job nem nascia, a recepcao via "Baixando o
-- arquivo" para sempre e nao sabia que precisava pedir ao paciente para mandar
-- de novo.
--
-- A partir de agora o worker grava media_url = 'indisponivel://<motivo>'
-- quando o job baixar_midia desiste (lib/jobs/worker.ts), e a bolha le a
-- sentinela (lib/domain/midia-recebida.ts). Sem coluna nova: o estado e do
-- ARQUIVO, e media_url ja e a coluna que diz onde ele esta. Quem so conhece
-- storage:// (a rota de midia, o apagamento) continua recusando o resto.
--
-- Esta migration so corrige o passado, com a mesma regra:
--   (a) job baixar_midia que falhou de vez (menos mensagem apagada);
--   (b) media_url nula ha mais de 1 dia, sem job pendente ou executando.
--
-- Producao em 24/09/2026, ANTES (so contagens, conferidas com SELECT):
--   7 documentos de entrada com job 'falhou' / last_error 'storage_falhou'
--     (8 de 8 tentativas), media_url ainda na URL do provedor;
--   16 imagens de entrada com media_url nula, sem job nenhum, de 03/09 a 23/09.
--   Nenhuma midia de SAIDA fora de storage://.
-- DEPOIS (ensaiado em transacao desfeita): 23 linhas com a sentinela, 0 midias
-- de entrada presas fora de storage://, seed:// e indisponivel://.
--
-- Nenhum conteudo de mensagem e lido ou escrito: so media_url e o tipo.

-- (a) O job desistiu de vez. O motivo sai do last_error, com a mesma regra de
-- lib/domain/midia-recebida.ts (motivoDaDesistencia).
update public.message m
set media_url = 'indisponivel://' || (
  select case
           when j.last_error = 'download:uazapi_download_413'
             or j.last_error ~ '^storage_falhou:413(:|$)'
             or j.last_error ~ ':EntityTooLarge$' then 'grande_demais'
           when j.last_error like 'storage_falhou%' then 'storage_falhou'
           when j.last_error like 'download:%' then 'download_falhou'
           else 'desistiu'
         end
  from public.job_queue j
  where j.kind = 'baixar_midia'
    and j.clinic_id = m.clinic_id
    and j.payload->>'message_id' = m.id::text
    and j.status = 'falhou'
    and coalesce(j.last_error, '') <> 'mensagem_apagada'
  order by j.created_at desc
  limit 1
)
where m.direction = 'entrada'
  and m.deleted_at is null
  and (m.media_url is null
       or (m.media_url not like 'storage://%'
           and m.media_url not like 'seed://%'
           and m.media_url not like 'indisponivel://%'))
  and exists (
    select 1
    from public.job_queue j
    where j.kind = 'baixar_midia'
      and j.clinic_id = m.clinic_id
      and j.payload->>'message_id' = m.id::text
      and j.status = 'falhou'
      and coalesce(j.last_error, '') <> 'mensagem_apagada'
  )
  and not exists (
    select 1
    from public.job_queue j
    where j.kind = 'baixar_midia'
      and j.clinic_id = m.clinic_id
      and j.payload->>'message_id' = m.id::text
      and j.status in ('pendente', 'executando')
  );

-- (b) Chegou sem URL ha mais de 1 dia e ninguem vai baixar: o webhook so
-- enfileira quando o provedor manda a URL.
update public.message m
set media_url = 'indisponivel://sem_url'
where m.direction = 'entrada'
  and m.deleted_at is null
  and m.media_url is null
  and m.content_type in ('imagem', 'documento', 'audio')
  and m.created_at < now() - interval '1 day'
  and not exists (
    select 1
    from public.job_queue j
    where j.kind = 'baixar_midia'
      and j.clinic_id = m.clinic_id
      and j.payload->>'message_id' = m.id::text
      and j.status in ('pendente', 'executando')
  );

-- (c) Tipo real dos arquivos que JA estao no balde (achados 28 e 29).
--
-- O worker passa a gravar message.media_mimetype no download. Para o passado,
-- o Storage guardou o tipo nos metadados do objeto (o caminho e
-- <clinica>/<mensagem>): e ele que faz a figurinha antiga (image/webp gravada
-- como 'texto') aparecer como imagem e o PDF antigo baixar com .pdf. O
-- application/octet-stream fica de fora, porque nao diz nada.
--
-- A coluna nasce na migration do grupo de entrada do WhatsApp. Se ela ainda
-- nao existir quando esta rodar, o bloco nao faz nada (e diz isso no log da
-- migration), em vez de derrubar o deploy.
do $$
declare
  v_linhas integer;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'message'
      and column_name = 'media_mimetype'
  ) then
    raise notice 'message.media_mimetype ainda nao existe: tipo real do passado nao preenchido';
    return;
  end if;

  execute $sql$
    update public.message m
    set media_mimetype = lower(split_part(o.metadata->>'mimetype', ';', 1))
    from storage.objects o
    where o.bucket_id = 'midia-conversas'
      and o.name = m.clinic_id::text || '/' || m.id::text
      and m.media_url like 'storage://%'
      and m.media_mimetype is null
      and coalesce(o.metadata->>'mimetype', '') <> ''
      and lower(o.metadata->>'mimetype') <> 'application/octet-stream'
  $sql$;
  get diagnostics v_linhas = row_count;
  raise notice 'tipo real preenchido em % mensagens', v_linhas;
end
$$;
