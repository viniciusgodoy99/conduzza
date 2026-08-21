-- Etapa A da auditoria de escala (21/08/2026): indices que faltam nos
-- caminhos quentes e de cascade, e tabela de perfil para aposentar a chamada
-- admin.listUsers do projeto inteiro.
--
-- NOTA DE PRODUCAO: enquanto as tabelas estao pequenas, CREATE INDEX comum
-- resolve. Quando message/audit_log passarem de milhoes de linhas, criar
-- indice assim TRAVA escrita. A partir dai, todo indice novo deve usar
-- CREATE INDEX CONCURRENTLY fora de transacao (checklist de migration da
-- Etapa B). Estes aqui sao baratos agora e caros depois: fazer cedo.

-- ---------------------------------------------------------------------------
-- Indices de chave estrangeira e de caminho quente
-- ---------------------------------------------------------------------------
-- FK sem indice trava DELETE (cascade) e JOIN. Offboarding de clinica e
-- exclusao de contato pela LGPD viravam varredura de tabela inteira com lock.

-- ai_decision_log: nenhum indice util hoje. fetchComplianceDecisions roda a
-- cada abertura de conversa; o parcial cobre so as decisoes que a tela mostra.
create index if not exists ai_decision_log_conversa_bloqueada_idx
  on public.ai_decision_log (conversation_id)
  where compliance_blocked;
create index if not exists ai_decision_log_clinic_idx
  on public.ai_decision_log (clinic_id);

-- conversation(contact_id): o unico indice era parcial (where status <>
-- 'resolvida'), inutil para o cascade de exclusao de contato.
create index if not exists conversation_contact_idx
  on public.conversation (contact_id);
create index if not exists conversation_clinic_assignee_idx
  on public.conversation (clinic_id, assignee_user_id);

-- Cascade de exclusao de clinica nas tabelas grandes.
create index if not exists message_clinic_idx
  on public.message (clinic_id);
create index if not exists contact_consent_clinic_idx
  on public.contact_consent (clinic_id);
create index if not exists message_template_clinic_idx
  on public.message_template (clinic_id);

-- audit_log(user_id): a policy nova filtra por user_id; e usado em consulta.
create index if not exists audit_log_user_idx
  on public.audit_log (user_id);

-- ---------------------------------------------------------------------------
-- Tabela de perfil: nome do usuario sem admin.listUsers
-- ---------------------------------------------------------------------------
-- A tela de Atendimento e a de Configuracoes chamavam
-- admin.auth.admin.listUsers(page 1, perPage 100) em toda carga, listando o
-- GoTrue do PROJETO INTEIRO. A partir de ~100 usuarios, quem ficava fora da
-- primeira pagina aparecia como "Atendente", parecendo bug aleatorio, e a
-- chamada admin por page view pressionava o rate limit da Auth API,
-- compartilhado entre todas as clinicas.
--
-- profile espelha o nome, populado no cadastro e legivel por colegas de
-- clinica. Nada de dado sensivel: so id e nome de exibicao.

create table public.profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now()
);

alter table public.profile enable row level security;

-- Um membro le o proprio perfil e o de quem compartilha clinica ATIVA com ele.
create policy "usuario le perfis de colegas de clinica" on public.profile
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from clinic_member meu
      join clinic_member outro on outro.clinic_id = meu.clinic_id
      where meu.user_id = auth.uid()
        and meu.status = 'ativo'
        and outro.user_id = profile.user_id
    )
    or public.is_product_admin()
  );

create trigger set_updated_at before update on public.profile
  for each row execute function public.set_updated_at();

-- Preenche o perfil no cadastro (mesmo gatilho que cria clinica/vinculo).
create or replace function public.sincronizar_perfil()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  v_nome := nullif(trim(new.raw_user_meta_data ->> 'name'), '');
  if v_nome is null then
    v_nome := split_part(coalesce(new.email, 'Usuário'), '@', 1);
  end if;
  insert into profile (user_id, name)
  values (new.id, v_nome)
  on conflict (user_id) do update set name = excluded.name, updated_at = now();
  return new;
end;
$$;

create trigger sincronizar_perfil_insert
  after insert on auth.users
  for each row execute function public.sincronizar_perfil();

create trigger sincronizar_perfil_update
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sincronizar_perfil();

-- Semeia os perfis dos usuarios que ja existem.
insert into public.profile (user_id, name)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(u.email, 'Usuário'), '@', 1)
  )
from auth.users u
on conflict (user_id) do nothing;
