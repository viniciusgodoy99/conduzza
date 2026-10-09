-- Corpos, policies e grants lidos da producao em 06/10/2026, antes da
-- migration 20261006150000 (Tela 6, Agente de IA). Passo 3 do ROLLBACK
-- manual da migration (cabecalho dela): rodar DEPOIS dos passos 0 a 2 (o
-- codigo sem a Tela 6 nova no ar e as funcoes e o gatilho novos fora) e
-- ANTES do passo 4. Nao aplicar fora de um rollback. Roda inteiro numa
-- transacao so (o SQL editor faz assim): ou volta tudo, ou nada.

-- proteger_versao_publicada_do_agente: corpo do banco ANTES da 20261006150000
-- (sem a GUC conduzza.agente_publicado_por e sem a excecao da FK on delete
-- set null de published_by). Sem comentario e com execute so do dono e da
-- service role, como estava.
CREATE OR REPLACE FUNCTION public.proteger_versao_publicada_do_agente()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and old.status = 'publicada' then
    raise exception using errcode = 'P0001',
      message = 'Versão publicada não muda: crie uma nova versão.';
  end if;
  if new.status = 'publicada' then
    new.published_at := now();
    new.published_by := auth.uid();
  else
    new.published_at := null;
    new.published_by := null;
  end if;
  return new;
end;
$function$;

comment on function public.proteger_versao_publicada_do_agente() is null;

-- A coluna instrucoes sai ANTES de a sessao ganhar de volta o SELECT de
-- tabela (que cobre toda coluna): as instrucoes do super admin nunca ficam
-- legiveis para a sessao no meio do rollback. Por isso o passo 4 do
-- cabecalho da migration nao apaga mais esta coluna.
alter table public.ai_agent_config drop column instrucoes;

-- Grants de ai_agent_config ANTES (relacl: authenticated=rd; por coluna:
-- INSERT em clinic_id e nas colunas de conteudo e em version, UPDATE nas de
-- conteudo e em version). Primeiro tira o SELECT por coluna, depois devolve
-- o de tabela; devolve tambem o INSERT por coluna e o DELETE de tabela, que
-- a migration tirou.
revoke select on table public.ai_agent_config from authenticated;
grant select on table public.ai_agent_config to authenticated;
grant update (version) on table public.ai_agent_config to authenticated;
grant insert (
  agent_name, clinic_id, closing, escalation_rules, fallback_minutes,
  greeting, operating_hours, operating_mode, skills, tone, use_emoji, version
) on table public.ai_agent_config to authenticated;
grant delete on table public.ai_agent_config to authenticated;

-- Policies ANTES (iguais as do E0, 20261006100000, sem o super admin). A
-- migration apagou as de criar e de apagar versao sem recriar: if exists.
drop policy "membro ativo le a configuracao do agente" on public.ai_agent_config;
drop policy if exists "gestao cria versao do agente" on public.ai_agent_config;
drop policy "gestao edita rascunho do agente" on public.ai_agent_config;
drop policy if exists "gestao apaga rascunho do agente" on public.ai_agent_config;

create policy "membro ativo le a configuracao do agente"
  on public.ai_agent_config
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao cria versao do agente"
  on public.ai_agent_config
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao edita rascunho do agente"
  on public.ai_agent_config
  for update to authenticated
  using (
    status = 'rascunho'
    and public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  )
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao apaga rascunho do agente"
  on public.ai_agent_config
  for delete to authenticated
  using (
    status = 'rascunho'
    and public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

drop policy "membro ativo le a base de conhecimento" on public.knowledge_item;
drop policy "gestao cria item de conhecimento" on public.knowledge_item;
drop policy "gestao edita item de conhecimento" on public.knowledge_item;
drop policy "gestao apaga item de conhecimento" on public.knowledge_item;

create policy "membro ativo le a base de conhecimento"
  on public.knowledge_item
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao cria item de conhecimento"
  on public.knowledge_item
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao edita item de conhecimento"
  on public.knowledge_item
  for update to authenticated
  using (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  )
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

create policy "gestao apaga item de conhecimento"
  on public.knowledge_item
  for delete to authenticated
  using (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and public.user_can_write(clinic_id)
  );

-- Comentarios das tabelas ANTES.
comment on table public.ai_agent_config is
  'Configuracao do agente de IA por versao (3.1). status rascunho ou publicada; a publicada e imutavel (gatilho, P0001 para qualquer papel). Membro ativo le; administrador e gestor criam, editam e apagam rascunho. published_at e published_by sao carimbados pelo gatilho; a sessao nao grava status (publicar e do sistema, depois do filtro, no E5).';
comment on table public.knowledge_item is
  'Base de conhecimento do agente (perguntas e respostas da clinica, 3.1). source manual, correcao_humana ou documento. Membro ativo le; administrador e gestor escrevem. created_by e o default auth.uid() (a sessao nao grava a coluna).';
