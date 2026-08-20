-- Correcoes de seguranca encontradas na auditoria de 20/08/2026.
-- Cada bloco cita o defeito concreto que corrige.

-- ---------------------------------------------------------------------------
-- 1. Papel 'leitura' escrevia dado de paciente
-- ---------------------------------------------------------------------------
-- As policies de escrita so tratavam o papel 'profissional'. Resultado: quem
-- tem acesso 'ver' na matriz (leitura, e profissional em Leads e Pacientes)
-- conseguia INSERT e UPDATE em contato, conversa e mensagem.
-- Passa a existir a funcao que responde "este papel pode ESCREVER nesta
-- clinica", usada em toda policy de escrita de dado de paciente.

create or replace function public.user_can_write(p_clinic_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from clinic_member
    where clinic_id = p_clinic_id
      and user_id = auth.uid()
      and status = 'ativo'
      and role in ('admin', 'gestor', 'recepcao', 'profissional')
  )
$$;

comment on function public.user_can_write(uuid) is
  'Papel com permissao de escrita em dado de paciente. Exclui leitura.';

drop policy "membro ativo cria contato" on public.contact;
create policy "membro com escrita cria contato" on public.contact
  for insert with check (public.user_can_write(clinic_id));

drop policy "membro ativo edita contato" on public.contact;
create policy "membro com escrita edita contato" on public.contact
  for update using (public.user_can_write(clinic_id))
  with check (public.user_can_write(clinic_id));

drop policy "membro ativo registra consentimento" on public.contact_consent;
create policy "membro com escrita registra consentimento" on public.contact_consent
  for insert with check (public.user_can_write(clinic_id));

drop policy "membro ativo cria conversa" on public.conversation;
create policy "membro com escrita cria conversa" on public.conversation
  for insert with check (
    public.user_can_write(clinic_id)
    and not public.user_has_role(clinic_id, array['profissional'])
  );

drop policy "membro ativo atualiza conversa conforme papel" on public.conversation;
create policy "membro com escrita atualiza conversa" on public.conversation
  for update using (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or assignee_user_id = auth.uid()
    )
  )
  with check (public.user_can_write(clinic_id));

drop policy "membro ativo escreve mensagem" on public.message;
create policy "membro com escrita escreve mensagem" on public.message
  for insert with check (
    public.user_can_write(clinic_id)
    and (
      not public.user_has_role(clinic_id, array['profissional'])
      or exists (
        select 1 from public.conversation c
        where c.id = conversation_id and c.assignee_user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Consentimento revogado podia ser reativado
-- ---------------------------------------------------------------------------
-- A policy de UPDATE deixava qualquer membro zerar revoked_at, ressuscitando
-- o consentimento de um paciente que pediu para nao receber mensagem. Isso
-- derruba o descadastro exigido pela LGPD e pela regra 3.3 do CLAUDE.md.
-- Agora o UPDATE so pode REVOGAR, nunca reativar.

drop policy "membro ativo atualiza consentimento" on public.contact_consent;
create policy "membro com escrita revoga consentimento" on public.contact_consent
  for update using (public.user_can_write(clinic_id) and revoked_at is null)
  with check (public.user_can_write(clinic_id) and revoked_at is not null);

create or replace function public.impedir_reativacao_consentimento()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'Consentimento revogado não pode ser reativado. O paciente precisa autorizar de novo.';
  end if;
  return new;
end;
$$;

create trigger impedir_reativacao_consentimento
  before update on public.contact_consent
  for each row execute function public.impedir_reativacao_consentimento();

-- ---------------------------------------------------------------------------
-- 3. Trilha de auditoria era forjavel
-- ---------------------------------------------------------------------------
-- A policy de insert so exigia pertencer a clinica: qualquer membro (inclusive
-- PENDENTE) podia gravar linha em nome de outro usuario, o que destroi o valor
-- da trilha como prova. Agora a linha e obrigatoriamente do proprio autor e o
-- membro precisa estar ativo.

drop policy "membro registra na trilha" on public.audit_log;
create policy "membro ativo registra a propria acao na trilha" on public.audit_log
  for insert with check (
    user_id = auth.uid()
    and (
      (clinic_id is not null
        and clinic_id in (select public.user_active_clinic_ids()))
      or (clinic_id is null and public.is_product_admin())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Codigo de acesso visivel para quem ainda esta pendente
-- ---------------------------------------------------------------------------
-- clinic era legivel por qualquer membro, inclusive pendente. Quem entrou por
-- codigo lia o proprio codigo da clinica e podia repassa-lo, o que anula a
-- rotacao. A leitura da clinica passa a exigir vinculo ATIVO; quem esta
-- pendente ve o nome pela funcao dedicada abaixo, sem enxergar o codigo.

drop policy "membro le a propria clinica" on public.clinic;
create policy "membro ativo le a propria clinica" on public.clinic
  for select using (
    id in (select public.user_active_clinic_ids()) or public.is_product_admin()
  );

-- Nome da clinica para quem esta pendente, sem expor codigo nem mais nada.
create or replace function public.minhas_clinicas_pendentes()
returns table (clinic_id uuid, clinic_name text)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.name
  from clinic_member m
  join clinic c on c.id = m.clinic_id
  where m.user_id = auth.uid() and m.status = 'pendente'
$$;

grant execute on function public.minhas_clinicas_pendentes() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Fallback de slug quebrava no gatilho de cadastro
-- ---------------------------------------------------------------------------
-- handle_new_user usa gen_random_bytes, que vive na extensao pgcrypto. Com
-- search_path fixado em public, a chamada falha se a extensao estiver em
-- outro esquema, e o cadastro inteiro quebra justamente no caso de nome de
-- clinica repetido. Troca por gen_random_uuid, que e nativa do Postgres 13+.

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

    v_slug := regexp_replace(lower(v_nome_clinica), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then
      v_slug := 'clinica';
    end if;
    if exists (select 1 from clinic where slug = v_slug) then
      v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
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

    insert into clinic_member (clinic_id, user_id, role, status)
    values (v_clinic_id, new.id, 'leitura', 'pendente');
  end if;

  return new;
end;
$$;

-- Mesmo motivo: o default do codigo de acesso usa gen_random_bytes.
alter table public.clinic
  alter column access_code
  set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

-- E o webhook_secret idem.
alter table public.whatsapp_account_secret
  alter column webhook_secret
  set default replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '');
