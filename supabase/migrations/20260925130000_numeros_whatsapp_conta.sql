-- ---------------------------------------------------------------------------
-- Mais de um numero de WhatsApp por clinica, Fase 1A (expansao): o numero
-- ---------------------------------------------------------------------------
-- Desenho aprovado: docs/07_multiplos_numeros_whatsapp.md (25/09/2026).
-- Esta migration so EXPANDE. O codigo de hoje continua funcionando sem
-- nenhuma mudanca, porque tudo o que ele usa continua valendo:
--
--   - whatsapp_account continua com UMA linha por clinica. A PK passa a ser
--     id, mas o unique TEMPORARIO whatsapp_account_uma_por_clinica (clinic_id)
--     segura o resto: o upsert do loadAccount (onConflict: "clinic_id") e o
--     ".eq('clinic_id').maybeSingle()" de todas as leituras continuam certos.
--     Ele sai na Fase 3, junto com o do segredo.
--   - whatsapp_account_secret ganha account_id (a PK nova), mas quem grava
--     so com clinic_id (loadAccount, fixtures, seeds) continua gravando: o
--     gatilho TEMPORARIO preencher_conta_do_segredo escolhe o principal da
--     clinica. O unique temporario (clinic_id) mantem o upsert do segredo.
--   - Nenhuma FK apontava para whatsapp_account(clinic_id) nem para
--     whatsapp_account_secret(clinic_id) (conferido em pg_constraint), e nao
--     ha embed PostgREST de whatsapp_account em lugar nenhum (achado 12).
--   - Realtime: a tabela esta na publicacao com REPLICA IDENTITY DEFAULT,
--     que passa a usar a PK nova. O app so assina UPDATE com filtro
--     clinic_id, que o Realtime avalia na linha NOVA (completa): nada muda.
--
-- Backfill: a conta que ja existe em cada clinica vira "Numero principal"
-- (D1) e principal = true. A coluna principal nasce com DEFAULT true (sem
-- UPDATE, sem evento de Realtime) e o default vira false logo depois.
--
-- clinic.limite_de_numeros: nulo = sem limite (decisao 4 do dono), e so o
-- dono do produto altera (gatilho proteger_limite_de_numeros).
--
-- whatsapp_envio_automatico: a politica de numero das mensagens automaticas
-- (decisao 2). Sem linha, vale 'ultimo_usado'. Quem le a politica e
-- conta_de_envio, que nasce na Fase 1B.

-- ---------------------------------------------------------------------------
-- 1) whatsapp_account: id como PK, nome, unidade, principal e remocao logica
-- ---------------------------------------------------------------------------

alter table public.whatsapp_account
  add column id uuid not null default gen_random_uuid(),
  add column nome text not null default 'Número principal',
  add column unit_id uuid references public.unit (id) on delete set null,
  -- DEFAULT true so neste ALTER: as linhas que ja existem (uma por clinica)
  -- nascem principais sem UPDATE. O default de verdade (false) vem abaixo.
  add column principal boolean not null default true,
  add column removido_em timestamptz,
  add column removido_por uuid references auth.users (id) on delete set null;

alter table public.whatsapp_account
  alter column principal set default false;

alter table public.whatsapp_account
  drop constraint whatsapp_account_pkey;
alter table public.whatsapp_account
  add constraint whatsapp_account_pkey primary key (id);

-- TEMPORARIO (sai na Fase 3): uma linha por clinica enquanto o codigo ainda
-- le e grava por clinic_id.
alter table public.whatsapp_account
  add constraint whatsapp_account_uma_por_clinica unique (clinic_id);

comment on constraint whatsapp_account_uma_por_clinica
  on public.whatsapp_account is
  'Temporario (Fase 1A a Fase 3): uma linha por clinica enquanto o codigo le e grava por clinic_id. Sai no contrato da Fase 3.';

alter table public.whatsapp_account
  add constraint whatsapp_account_nome_tamanho
    check (char_length(nome) between 1 and 40 and btrim(nome) <> ''),
  add constraint whatsapp_account_principal_ativo
    check (not (principal and removido_em is not null));

-- Nome unico entre os numeros ativos da clinica (sem diferenciar maiuscula).
create unique index whatsapp_account_nome_unico
  on public.whatsapp_account (clinic_id, lower(nome))
  where removido_em is null;

-- No maximo um principal ativo por clinica.
create unique index whatsapp_account_um_principal
  on public.whatsapp_account (clinic_id)
  where principal and removido_em is null;

-- A mesma instancia nao serve dois numeros ativos.
create unique index whatsapp_account_instancia_unica
  on public.whatsapp_account (provider, instance_id)
  where instance_id is not null and removido_em is null;

comment on column public.whatsapp_account.nome is
  'Nome livre do numero, visto pela equipe (decisao 3 do dono, 25/09/2026).';
comment on column public.whatsapp_account.principal is
  'Numero principal da clinica: entrada sem numero e envio sem conversa anterior saem por ele.';
comment on column public.whatsapp_account.removido_em is
  'Remocao logica (RPC remover_numero). O historico das conversas fica.';

-- Unidade da mesma clinica: ramo novo do gatilho que ja guarda os cadastros.
-- O corpo e o de producao (pg_get_functiondef em 25/09/2026) com tres ramos
-- novos no fim: whatsapp_account, whatsapp_account_secret e
-- whatsapp_envio_automatico. SECURITY DEFINER, search_path e grants iguais.
create or replace function public.exigir_cadastro_da_mesma_clinica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profissional_do_vinculo uuid;
  v_pacote_ativo boolean;
begin
  if tg_table_name = 'appointment' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    select sl.professional_id into v_profissional_do_vinculo
      from service_link sl
     where sl.id = new.service_link_id and sl.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado não pertence a esta clínica.';
    end if;
    if v_profissional_do_vinculo is distinct from new.professional_id then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O vínculo informado é de outro profissional.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;
    if new.package_balance_id is not null and not exists (
      select 1 from package_balance
       where id = new.package_balance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O saldo de pacote informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'slot_hold' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'procedure' then
    if new.resource_id is not null and not exists (
      select 1 from resource
       where id = new.resource_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O recurso informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'resource' then
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'service_link' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    if new.insurance_id is not null and not exists (
      select 1 from insurance
       where id = new.insurance_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O convênio informado não pertence a esta clínica.';
    end if;
    -- A consulta exige vinculo DO MESMO profissional (acima). Trocar o
    -- profissional de um vinculo que ja tem consulta quebraria essa regra
    -- nas consultas antigas: o caminho e desativar e criar outro.
    if tg_op = 'UPDATE'
       and new.professional_id is distinct from old.professional_id
       and exists (select 1 from appointment where service_link_id = new.id)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este vínculo já tem consultas. Desative e crie outro.';
    end if;

  elsif tg_table_name = 'professional_schedule' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'professional_block' then
    if not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'package' then
    if not exists (
      select 1 from procedure
       where id = new.procedure_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O procedimento informado não pertence a esta clínica.';
    end if;
    -- (3) Procedimento congelado depois da primeira venda.
    if tg_op = 'UPDATE'
       and new.procedure_id is distinct from old.procedure_id
       and exists (select 1 from package_balance where package_id = new.id)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote já foi vendido. Para outro procedimento, crie um pacote novo.';
    end if;

  elsif tg_table_name = 'package_balance' then
    select p.active into v_pacote_ativo
      from package p
     where p.id = new.package_id and p.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O pacote informado não pertence a esta clínica.';
    end if;
    -- (2) Venda nova so de pacote ativo. Ajuste de saldo ja vendido
    -- (sessions_used) nao passa por aqui: o gatilho so olha INSERT e troca
    -- de package_id/clinic_id.
    if tg_op = 'INSERT' and v_pacote_ativo is not true then
      raise exception using errcode = 'check_violation',
        message = 'Este pacote está desativado e não pode ser vendido.';
    end if;

  elsif tg_table_name = 'clinic_member' then
    -- Vinculo usuario -> profissional (a tela e da leva 2): a policy de
    -- update de clinic_member so confere o papel do editor na clinica da
    -- linha, e a FK clinic_member_professional_fk so confere existencia.
    if new.professional_id is not null and not exists (
      select 1 from professional
       where id = new.professional_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O profissional informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account' then
    -- Unidade opcional do numero (decisao 3 do dono, 25/09/2026).
    if new.unit_id is not null and not exists (
      select 1 from unit where id = new.unit_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'A unidade informada não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_account_secret' then
    -- account_id nulo e o caminho legado (so clinic_id): o gatilho
    -- preencher_conta_do_segredo, que roda DEPOIS deste pela ordem do nome,
    -- escolhe o principal da MESMA clinica, e o NOT NULL fecha o resto.
    if new.account_id is not null and not exists (
      select 1 from whatsapp_account
       where id = new.account_id and clinic_id = new.clinic_id
    ) then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;

  elsif tg_table_name = 'whatsapp_envio_automatico' then
    -- Modo fixo: o numero e desta clinica e nao foi removido. A mesma
    -- mensagem para "de outra clinica" e "nao existe": nada a aprender.
    if new.conta_fixa_id is not null then
      if not exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and clinic_id = new.clinic_id
      ) then
        raise exception using errcode = 'foreign_key_violation',
          message = 'O número escolhido não pertence a esta clínica.';
      end if;
      if exists (
        select 1 from whatsapp_account
         where id = new.conta_fixa_id and removido_em is not null
      ) then
        raise exception using errcode = 'check_violation',
          message = 'O número escolhido foi removido da clínica.';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, unit_id on public.whatsapp_account
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- 2) clinic.limite_de_numeros e a trava de quem pode mudar
-- ---------------------------------------------------------------------------

alter table public.clinic
  add column limite_de_numeros integer
    constraint clinic_limite_de_numeros_positivo
      check (limite_de_numeros > 0);

comment on column public.clinic.limite_de_numeros is
  'Quantos numeros de WhatsApp ativos a clinica pode ter. Nulo = sem limite (padrao). So o dono do produto altera.';

-- A policy de UPDATE de clinic e do administrador da clinica e continua
-- sendo: ela abre nome e fuso. O limite e do PLANO, entao a trava e um
-- gatilho: sessao de usuario sem is_product_admin() nao muda o valor. O
-- service role (auth.uid() nulo) e o dono do produto mudam.
create function public.proteger_limite_de_numeros()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.is_product_admin()
     and new.limite_de_numeros is distinct from (
       case when tg_op = 'UPDATE' then old.limite_de_numeros end
     )
  then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza altera o limite de números da clínica.';
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_limite_de_numeros()
  from public, anon, authenticated;

create trigger proteger_limite_de_numeros
  before insert or update of limite_de_numeros on public.clinic
  for each row execute function public.proteger_limite_de_numeros();

-- ---------------------------------------------------------------------------
-- 3) Criar (ou restaurar) numero: limite do plano e principal automatico
-- ---------------------------------------------------------------------------
-- Roda no INSERT e no UPDATE que tira removido_em (restaurar). A trava
-- consultiva por clinica serializa dois cadastros simultaneos: sem ela, os
-- dois contariam N-1 e passariam juntos do limite. Sem principal ativo, o
-- numero novo vira o principal (a primeira conta de toda clinica nasce
-- principal sem ninguem pedir).
--
-- Nesta fase o unique temporario (clinic_id) ainda impede o segundo numero.
-- Como o gatilho roda ANTES da checagem do unique, com limite 1 o segundo
-- numero recebe 23514 (limite) e sem limite recebe 23505 (unique). O upsert
-- do loadAccount (ON CONFLICT DO NOTHING) tambem passa por aqui: com limite
-- nulo (o padrao de todas as clinicas) nada muda; com limite preenchido ele
-- recebe 23514 em vez de "nada a fazer", e o loadAccount de hoje ignora o
-- erro do upsert e segue lendo a conta que ja existe.
create function public.antes_de_criar_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite integer;
  v_ativos integer;
begin
  if tg_op = 'UPDATE'
     and not (old.removido_em is not null and new.removido_em is null)
  then
    return new;
  end if;
  if new.removido_em is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp_account:' || new.clinic_id::text, 0)
  );

  select limite_de_numeros into v_limite
    from clinic
   where id = new.clinic_id;
  if v_limite is not null then
    select count(*) into v_ativos
      from whatsapp_account
     where clinic_id = new.clinic_id
       and removido_em is null
       and id <> new.id;
    if v_ativos >= v_limite then
      raise exception using errcode = '23514',
        message = 'Esta clínica atingiu o limite de números do plano.';
    end if;
  end if;

  if not exists (
    select 1 from whatsapp_account
     where clinic_id = new.clinic_id
       and principal
       and removido_em is null
       and id <> new.id
  ) then
    new.principal := true;
  end if;

  return new;
end;
$$;

revoke all on function public.antes_de_criar_numero()
  from public, anon, authenticated;

create trigger antes_de_criar_numero
  before insert or update of removido_em on public.whatsapp_account
  for each row execute function public.antes_de_criar_numero();

-- ---------------------------------------------------------------------------
-- 4) whatsapp_account_secret: chaveado pelo numero
-- ---------------------------------------------------------------------------

alter table public.whatsapp_account_secret
  add column account_id uuid;

update public.whatsapp_account_secret s
   set account_id = a.id
  from public.whatsapp_account a
 where a.clinic_id = s.clinic_id
   and s.account_id is null;

-- Fase 0 contou zero segredos orfaos. Se aparecer um ate a aplicacao, a
-- migration para aqui em vez de apagar segredo em silencio.
do $$
begin
  if exists (
    select 1 from public.whatsapp_account_secret where account_id is null
  ) then
    raise exception using errcode = '23502',
      message = 'Há segredo de WhatsApp sem número correspondente. Corrija antes de aplicar esta migration.';
  end if;
end;
$$;

alter table public.whatsapp_account_secret
  alter column account_id set not null;

alter table public.whatsapp_account_secret
  drop constraint whatsapp_account_secret_pkey;
alter table public.whatsapp_account_secret
  add constraint whatsapp_account_secret_pkey primary key (account_id);

alter table public.whatsapp_account_secret
  add constraint whatsapp_account_secret_account_id_fkey
    foreign key (account_id) references public.whatsapp_account (id)
    on delete cascade;

-- TEMPORARIO (sai na Fase 3): o upsert do segredo no loadAccount usa
-- onConflict: "clinic_id".
alter table public.whatsapp_account_secret
  add constraint whatsapp_account_secret_uma_por_clinica unique (clinic_id);

comment on constraint whatsapp_account_secret_uma_por_clinica
  on public.whatsapp_account_secret is
  'Temporario (Fase 1A a Fase 3): o upsert do segredo ainda usa onConflict clinic_id. Sai no contrato da Fase 3.';

-- TEMPORARIO (sai na Fase 3): quem grava o segredo so com clinic_id recebe
-- o principal ativo da clinica.
create function public.preencher_conta_do_segredo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select id into new.account_id
    from whatsapp_account
   where clinic_id = new.clinic_id
     and principal
     and removido_em is null;
  if new.account_id is null then
    raise exception using errcode = '23502',
      message = 'Cadastre o número de WhatsApp da clínica antes de guardar a conexão dele.';
  end if;
  return new;
end;
$$;

revoke all on function public.preencher_conta_do_segredo()
  from public, anon, authenticated;

create trigger preencher_conta_do_segredo
  before insert on public.whatsapp_account_secret
  for each row
  when (new.account_id is null)
  execute function public.preencher_conta_do_segredo();

-- Coerencia permanente: o segredo e da clinica do numero.
create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, account_id
  on public.whatsapp_account_secret
  for each row execute function public.exigir_cadastro_da_mesma_clinica();

-- ---------------------------------------------------------------------------
-- 5) whatsapp_envio_automatico: por qual numero saem as automaticas
-- ---------------------------------------------------------------------------

create table public.whatsapp_envio_automatico (
  clinic_id uuid primary key
    references public.clinic (id) on delete cascade,
  modo text not null default 'ultimo_usado'
    constraint whatsapp_envio_automatico_modo_check
      check (modo in ('ultimo_usado', 'fixo')),
  -- NO ACTION: numero nao se apaga (remocao e logica); o cascade de apagar
  -- a clinica leva as duas linhas no mesmo comando.
  conta_fixa_id uuid references public.whatsapp_account (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_envio_automatico_fixo_tem_numero
    check ((modo = 'fixo') = (conta_fixa_id is not null))
);

comment on table public.whatsapp_envio_automatico is
  'Politica de numero das mensagens automaticas. Sem linha, vale ultimo_usado (o ultimo numero para o qual o paciente escreveu; senao o principal).';

alter table public.whatsapp_envio_automatico enable row level security;

create policy "membro ativo le o envio automatico"
  on public.whatsapp_envio_automatico
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

create policy "gestao define o envio automatico"
  on public.whatsapp_envio_automatico
  for insert to authenticated
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao altera o envio automatico"
  on public.whatsapp_envio_automatico
  for update to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

revoke all on table public.whatsapp_envio_automatico from anon;
revoke delete, truncate on table public.whatsapp_envio_automatico
  from authenticated;

create trigger set_updated_at
  before update on public.whatsapp_envio_automatico
  for each row execute function public.set_updated_at();

create trigger exigir_cadastro_da_mesma_clinica
  before insert or update of clinic_id, conta_fixa_id
  on public.whatsapp_envio_automatico
  for each row execute function public.exigir_cadastro_da_mesma_clinica();
