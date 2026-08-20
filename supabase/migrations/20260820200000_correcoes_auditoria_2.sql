-- Segunda leva de correcoes da auditoria de 20/08/2026, com os achados que
-- sobreviveram a verificacao adversarial e ainda nao tinham sido tratados.

-- ---------------------------------------------------------------------------
-- I3. Tabelas estruturais ainda visiveis para membro PENDENTE
-- ---------------------------------------------------------------------------
-- unit, whatsapp_account e message_template continuavam com user_clinic_ids(),
-- que inclui vinculo pendente. Quem pediu entrada por codigo e ainda nao foi
-- aprovado lia endereco e telefone das unidades, o numero e o estado da conta
-- de WhatsApp, e o corpo dos modelos de mensagem.

drop policy "membro le unidades" on public.unit;
create policy "membro ativo le unidades" on public.unit
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
    or public.is_product_admin()
  );

drop policy "membro le a conta whatsapp" on public.whatsapp_account;
create policy "membro ativo le a conta whatsapp" on public.whatsapp_account
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
  );

drop policy "membro le modelos" on public.message_template;
create policy "membro ativo le modelos" on public.message_template
  for select using (
    clinic_id in (select public.user_active_clinic_ids())
  );

-- ---------------------------------------------------------------------------
-- I3b. Codigo de acesso legivel por QUALQUER membro ativo, inclusive leitura
-- ---------------------------------------------------------------------------
-- A matriz de papeis diz que Configuracoes e exclusiva de administrador, mas
-- o codigo morava em clinic, legivel por todo membro ativo. Qualquer pessoa
-- da clinica podia copiar o codigo e distribuir, o que esvazia a rotacao.
-- O codigo sai de clinic e vai para tabela propria, so de administrador.

create table public.clinic_access_code (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  code text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.clinic_access_code (clinic_id, code)
select id, access_code from public.clinic
on conflict (clinic_id) do nothing;

alter table public.clinic_access_code enable row level security;

create policy "admin le o codigo da clinica" on public.clinic_access_code
  for select using (public.user_has_role(clinic_id, array['admin']));

create policy "admin gira o codigo da clinica" on public.clinic_access_code
  for update using (public.user_has_role(clinic_id, array['admin']))
  with check (public.user_has_role(clinic_id, array['admin']));

create trigger set_updated_at before update on public.clinic_access_code
  for each row execute function public.set_updated_at();

-- Toda clinica nova ganha codigo automaticamente.
create or replace function public.criar_codigo_de_acesso()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into clinic_access_code (clinic_id, code)
  values (
    new.id,
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  )
  on conflict (clinic_id) do nothing;
  return new;
end;
$$;

create trigger criar_codigo_de_acesso
  after insert on public.clinic
  for each row execute function public.criar_codigo_de_acesso();

-- A coluna antiga sai de cena: quem precisa do codigo usa a tabela nova.
alter table public.clinic drop column access_code;

-- ---------------------------------------------------------------------------
-- I4. Entrada por codigo ligada por padrao em toda clinica nova
-- ---------------------------------------------------------------------------
-- Toda clinica nascia aceitando entrada por codigo. Como o codigo e um
-- oraculo consultavel por anonimo, o padrao seguro e nascer desligado: quem
-- quiser distribuir codigo liga na tela, de propria vontade.
alter table public.clinic alter column allow_code_signup set default false;

-- ---------------------------------------------------------------------------
-- Gatilho e funcao passam a usar a tabela nova do codigo
-- ---------------------------------------------------------------------------

create or replace function public.validar_codigo_clinica(p_codigo text)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  select c.name into v_nome
  from clinic_access_code a
  join clinic c on c.id = a.clinic_id
  where a.code = upper(trim(p_codigo))
    and c.allow_code_signup
  limit 1;

  if v_nome is null then
    return null;
  end if;
  -- Devolve SO o nome: nao expor id nem qualquer outro dado a anonimo.
  return json_build_object('nome', v_nome);
end;
$$;

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

    select a.clinic_id into v_clinic_id
    from clinic_access_code a
    join clinic c on c.id = a.clinic_id
    where a.code = v_codigo and c.allow_code_signup
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

-- ---------------------------------------------------------------------------
-- I1. Consentimento: o vetor que sobrou era INSERIR linha nova
-- ---------------------------------------------------------------------------
-- O gatilho anterior impedia reativar a linha revogada, mas nada impedia
-- inserir uma linha nova com revoked_at nulo, e a checagem de envio pergunta
-- "existe alguma linha ativa". O paciente que pediu para nao receber voltava
-- a receber. Agora todo registro de consentimento posterior a uma revogacao
-- exige evidencia declarada de quem autorizou, e a decisao de envio passa a
-- olhar o registro MAIS RECENTE, nao "qualquer um ativo".

create or replace function public.exigir_evidencia_de_reconsentimento()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from contact_consent
    where contact_id = new.contact_id
      and channel = new.channel
      and revoked_at is not null
  ) and coalesce(trim(new.evidence), '') = '' then
    raise exception 'Este contato já pediu para não receber mensagens. Registre como ele autorizou de novo no campo de evidência.';
  end if;
  return new;
end;
$$;

create trigger exigir_evidencia_de_reconsentimento
  before insert on public.contact_consent
  for each row execute function public.exigir_evidencia_de_reconsentimento();

-- Consentimento vigente do contato: o registro mais recente manda. Se o mais
-- recente e revogado, nao ha consentimento, mesmo que exista linha antiga
-- ativa. Usada pela decisao de envio.
create or replace function public.consentimento_vigente(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_channel text default 'whatsapp'
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select revoked_at is null
     from contact_consent
     where clinic_id = p_clinic_id
       and contact_id = p_contact_id
       and channel = p_channel
     order by granted_at desc, created_at desc
     limit 1),
    false
  )
$$;

grant execute on function public.consentimento_vigente(uuid, uuid, text)
  to authenticated, service_role;

create index on public.contact_consent (contact_id, channel, granted_at desc);
