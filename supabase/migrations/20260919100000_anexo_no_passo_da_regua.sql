-- Anexo no passo da regua (decisao do dono em 19/09/2026): cada passo pode
-- carregar UM anexo (foto, audio ou arquivo) alem do texto, e a composicao e
-- por passo (pode ser so o audio, sem texto). O anexo vale para TODAS as
-- reguas, inclusive a confirmacao (que passa a mandar duas mensagens quando
-- tem anexo: a midia e depois os botoes).
--
-- Onde a midia VIVE e onde ela CHEGA sao lugares diferentes, de proposito:
-- o anexo do passo mora no balde proprio midia-de-regua (path
-- clinic_id/cadence_step_id) e, NA HORA DO ENVIO, o executor copia os bytes
-- para midia-conversas/<clinic>/<message_id>. Assim a mensagem que nasce e
-- indistinguivel de um anexo enviado pelo atendente: a policy de leitura, a
-- rota de midia, os renderizadores e o fluxo de apagar funcionam sem nenhuma
-- excecao nova.

-- ---------------------------------------------------------------------------
-- 1. Colunas do anexo em cadence_step
-- ---------------------------------------------------------------------------

alter table public.cadence_step
  add column media_path text,
  add column media_type text
    check (media_type is null or media_type in ('image', 'audio', 'document')),
  add column media_mimetype text,
  add column media_filename text,
  -- Anexo e tudo-ou-nada: path sem tipo (ou vice-versa) e estado impossivel.
  add constraint anexo_completo check (
    (media_path is null) = (media_type is null)
    and (media_path is null) = (media_mimetype is null)
  );

comment on column public.cadence_step.media_path is
  'Caminho do anexo no balde midia-de-regua (clinic_id/cadence_step_id). No envio, o executor copia os bytes para midia-conversas em nome da message nova.';
comment on column public.cadence_step.media_filename is
  'Nome exibido do arquivo, so para document (o WhatsApp mostra).';

-- fixed_body continua nullable: com anexo, o texto e opcional (vira legenda).
-- A regra "texto OU anexo" vive no executor e nas actions, nao num CHECK,
-- porque o fluxo de criacao legitimamente passa por estados intermediarios.

-- ---------------------------------------------------------------------------
-- 2. Balde midia-de-regua
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('midia-de-regua', 'midia-de-regua', false)
on conflict (id) do update set public = false;

-- Mesmo teto do balde de conversas (48 MB); o teto de verdade e o da action
-- (3,8 MB, limite de Server Action da plataforma).
update storage.buckets set file_size_limit = 50331648
 where id = 'midia-de-regua';

-- ---------------------------------------------------------------------------
-- 3. Leitura: membro ativo ve o anexo dos passos da propria clinica
-- ---------------------------------------------------------------------------
-- Mesmo desenho de midia_mensagem_do_caminho: o segundo segmento e o
-- cadence_step_id, null fora do formato (caminho torto nega acesso em vez de
-- lancar erro dentro da policy). A subconsulta em cadence_step roda como o
-- usuario da sessao, entao a RLS de cadence_step ("membro ativo le passos")
-- faz o recorte por clinica de graca. A conferencia do clinic_id do CAMINHO
-- contra o da linha impede caminho forjado clinica_alheia/meu_passo.
--
-- SEM policy de INSERT/UPDATE/DELETE de proposito: escrita e do service role
-- (Server Action com guard admin/gestor), como no balde de conversas.

create or replace function public.midia_passo_do_caminho(p_caminho text)
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

comment on function public.midia_passo_do_caminho(text) is
  'Le o cadence_step_id do caminho clinic_id/cadence_step_id usado no balde midia-de-regua. Devolve null fora do formato.';

drop policy if exists "membro le anexo do passo da regua" on storage.objects;

create policy "membro le anexo do passo da regua"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'midia-de-regua'
    and exists (
      select 1
      from public.cadence_step s
      where s.id = public.midia_passo_do_caminho(storage.objects.name)
        and s.clinic_id::text = split_part(storage.objects.name, '/', 1)
    )
  );
