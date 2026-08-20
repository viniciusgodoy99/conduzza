-- Cadastro self-service de clinicas (decisao do dono em 20/08/2026, escopo
-- novo fora do backlog). Modelo inspirado no projeto mdrepresentacoes, com
-- duas correcoes deliberadas:
--   1. Mantemos clinic_member como tabela de juncao (uma pessoa pode servir
--      varias clinicas, exigencia da persona agencia), em vez de uma coluna
--      empresa_id no perfil.
--   2. Quem entra por CODIGO nasce PENDENTE e nao enxerga dado de paciente
--      ate um administrador aprovar. O codigo e permanente e pratico de
--      distribuir, mas um codigo vazado nao vira porta aberta para conversa
--      de paciente, que e dado de saude (LGPD art. 11).
-- Convite por e-mail continua entrando ativo, porque ja e nominal.

-- ---------------------------------------------------------------------------
-- Codigo de acesso da clinica
-- ---------------------------------------------------------------------------

alter table public.clinic
  add column access_code text unique not null
    default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8)),
  add column allow_code_signup boolean not null default true;

comment on column public.clinic.access_code is
  'Codigo que a pessoa digita no cadastro para pedir entrada. Rotacionavel pelo admin.';
comment on column public.clinic.allow_code_signup is
  'Chave de liga e desliga da entrada por codigo. Convite por e-mail nao depende disto.';

-- ---------------------------------------------------------------------------
-- Estado do vinculo: ativo ou pendente de aprovacao
-- ---------------------------------------------------------------------------

alter table public.clinic_member
  add column status text not null default 'ativo'
    check (status in ('ativo', 'pendente'));

comment on column public.clinic_member.status is
  'pendente = entrou por codigo e aguarda aprovacao; nao le dado de paciente.';

-- Funcao de vinculo ATIVO: substitui user_clinic_ids nas tabelas de paciente.
-- user_clinic_ids continua existindo para o que e estrutural (a pessoa precisa
-- ver o nome da clinica e o proprio vinculo mesmo estando pendente).
create or replace function public.user_active_clinic_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from clinic_member
  where user_id = auth.uid() and status = 'ativo'
$$;

-- user_has_role passa a exigir vinculo ativo: quem esta pendente nao exerce
-- papel nenhum, nem que o papel gravado seja admin.
create or replace function public.user_has_role(p_clinic_id uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and status = 'ativo'
      and role = any (p_roles)
  )
$$;

-- ---------------------------------------------------------------------------
-- Policies das tabelas com dado de paciente passam a exigir vinculo ativo
-- ---------------------------------------------------------------------------

drop policy "membro le contatos" on public.contact;
create policy "membro ativo le contatos" on public.contact
  for select using (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro cria contato" on public.contact;
create policy "membro ativo cria contato" on public.contact
  for insert with check (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro edita contato" on public.contact;
create policy "membro ativo edita contato" on public.contact
  for update using (clinic_id in (select public.user_active_clinic_ids()))
  with check (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro le consentimento" on public.contact_consent;
create policy "membro ativo le consentimento" on public.contact_consent
  for select using (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro registra consentimento" on public.contact_consent;
create policy "membro ativo registra consentimento" on public.contact_consent
  for insert with check (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro atualiza consentimento" on public.contact_consent;
create policy "membro ativo atualiza consentimento" on public.contact_consent
  for update using (clinic_id in (select public.user_active_clinic_ids()))
  with check (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro le conversas conforme papel" on public.conversation;
create policy "membro ativo le conversas conforme papel" on public.conversation
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or assignee_user_id = auth.uid()
    )
  );

drop policy "membro cria conversa" on public.conversation;
create policy "membro ativo cria conversa" on public.conversation
  for insert with check (
    clinic_id in (select public.user_active_clinic_ids())
    and not public.user_has_role(clinic_id, array['profissional'])
  );

drop policy "membro atualiza conversa conforme papel" on public.conversation;
create policy "membro ativo atualiza conversa conforme papel" on public.conversation
  for update using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or assignee_user_id = auth.uid()
    )
  )
  with check (clinic_id in (select public.user_active_clinic_ids()));

drop policy "membro le mensagens conforme papel" on public.message;
create policy "membro ativo le mensagens conforme papel" on public.message
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );

drop policy "membro escreve mensagem" on public.message;
create policy "membro ativo escreve mensagem" on public.message
  for insert with check (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );

drop policy "membro le decisoes da IA conforme papel" on public.ai_decision_log;
create policy "membro ativo le decisoes da IA conforme papel" on public.ai_decision_log
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Gestao do proprio vinculo e aprovacao de pendentes
-- ---------------------------------------------------------------------------

-- Todo membro (inclusive pendente) precisa ler o proprio vinculo, senao a
-- aplicacao nao sabe dizer que ele esta aguardando aprovacao e trata como
-- sessao orfa. Licao aprendida do mdrepresentacoes, onde isso virou laco de
-- logout em producao.
drop policy "membro ve o time da clinica" on public.clinic_member;
create policy "membro ve o time e o proprio vinculo" on public.clinic_member
  for select using (
    user_id = auth.uid()
    or clinic_id in (select public.user_active_clinic_ids())
    or public.is_product_admin()
  );

-- Impede escalacao de privilegio: ninguem muda o proprio papel nem se
-- autoaprova. SECURITY INVOKER de proposito, para enxergar o papel real de
-- quem faz a requisicao.
create or replace function public.impedir_auto_aprovacao()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if new.user_id = auth.uid()
     and auth.uid() is not null
     and (new.role is distinct from old.role
          or new.status is distinct from old.status) then
    raise exception 'Você não pode alterar o próprio papel nem aprovar o próprio acesso.';
  end if;
  return new;
end;
$$;

create trigger impedir_auto_aprovacao
  before update on public.clinic_member
  for each row execute function public.impedir_auto_aprovacao();

-- ---------------------------------------------------------------------------
-- Conferencia do codigo sem sessao (a pessoa ainda nao existe no sistema)
-- ---------------------------------------------------------------------------

create or replace function public.validar_codigo_clinica(p_codigo text)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  select name into v_nome
  from clinic
  where access_code = upper(trim(p_codigo))
    and allow_code_signup
  limit 1;

  if v_nome is null then
    return null;
  end if;
  -- Devolve SO o nome: nao expor id nem qualquer outro dado a anonimo.
  return json_build_object('nome', v_nome);
end;
$$;

grant execute on function public.validar_codigo_clinica(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- O coracao do cadastro: cria clinica ou vincula, na mesma transacao do signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_nome_clinica text;
  v_codigo text;
  v_clinic_id uuid;
  v_slug text;
begin
  v_tipo := coalesce(new.raw_user_meta_data ->> 'tipo', '');

  if v_tipo = 'clinica' then
    v_nome_clinica := nullif(trim(new.raw_user_meta_data ->> 'nome_clinica'), '');
    if v_nome_clinica is null then
      raise exception 'Nome da clínica é obrigatório no cadastro.';
    end if;

    -- Slug legivel e unico, derivado do nome.
    v_slug := regexp_replace(lower(v_nome_clinica), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'clinica';
    end if;
    if exists (select 1 from clinic where slug = v_slug) then
      v_slug := v_slug || '-' || substr(encode(gen_random_bytes(3), 'hex'), 1, 5);
    end if;

    insert into clinic (name, slug)
    values (v_nome_clinica, v_slug)
    returning id into v_clinic_id;

    insert into clinic_branding (clinic_id) values (v_clinic_id);

    insert into clinic_member (clinic_id, user_id, role, status)
    values (v_clinic_id, new.id, 'admin', 'ativo');

  elsif v_tipo = 'codigo' then
    v_codigo := upper(trim(coalesce(new.raw_user_meta_data ->> 'codigo', '')));

    select id into v_clinic_id
    from clinic
    where access_code = v_codigo and allow_code_signup
    limit 1;

    if v_clinic_id is null then
      raise exception 'Código da clínica inválido ou desativado.';
    end if;

    -- Pendente: entra no sistema, mas sem enxergar dado de paciente ate a
    -- clinica aprovar. O papel definitivo e escolhido na aprovacao.
    insert into clinic_member (clinic_id, user_id, role, status)
    values (v_clinic_id, new.id, 'leitura', 'pendente');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create index on public.clinic_member (user_id, status);
