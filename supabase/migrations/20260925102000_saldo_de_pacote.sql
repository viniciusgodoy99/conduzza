-- Saldo de pacote na ficha do paciente e indicadores da lista de Pacientes
-- (revisao de liberacao, achado 71, e decisao C28 do dono, 25/09/2026).
--
-- (1) Ajuste de saldo e cancelamento de venda, com motivo guardado. A ficha
--     so sabia VENDER: pacote vendido errado ficava para sempre (e o gatilho
--     consumir_sessao_de_pacote seguia debitando dele), e sessao usada fora do
--     sistema nao tinha como entrar. As policies de package_balance ja
--     permitiam UPDATE (admin, gestor e recepcao) e DELETE (admin e gestor);
--     faltava onde guardar O MOTIVO: audit_log nao tem campo de detalhe, e um
--     motivo obrigatorio que nao fica gravado em lugar nenhum e so enfeite.
--     A tabela package_balance_adjustment guarda quem mudou, o antes, o
--     depois e o motivo. As duas funcoes fazem a mudanca e o registro na
--     MESMA transacao (ou os dois acontecem, ou nenhum).
--     SECURITY INVOKER de proposito: quem manda continua sendo a RLS de
--     package_balance e desta tabela, as mesmas regras do resto do app.
--     Venda que ja descontou sessao de consulta nao se cancela: a consulta
--     guarda package_balance_id, e apagar o saldo apagaria o rastro do
--     debito. Ali o caminho e o ajuste.
--
-- (2) pacientes_resumo ganha primeira_consulta (a mais antiga nao
--     cancelada), para o indicador "Novos no mes" da lista. Mudar o tipo de
--     retorno exige drop e create; o corpo e o de producao (conferido com
--     pg_get_functiondef em 25/09), so com a coluna nova no fim, e os grants
--     voltam como estavam (authenticated e service_role, nunca anon).
--     Continua SECURITY INVOKER: a RLS de appointment recorta o profissional
--     para a propria agenda, e a tela diz isso.

-- ---------------------------------------------------------------------------
-- (1) Historico de ajuste e cancelamento
-- ---------------------------------------------------------------------------

create table if not exists public.package_balance_adjustment (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  contact_id uuid not null references public.contact (id) on delete cascade,
  -- set null: o cancelamento apaga o saldo, e o registro do cancelamento
  -- precisa sobreviver a ele.
  package_balance_id uuid references public.package_balance (id)
    on delete set null,
  package_id uuid not null references public.package (id),
  user_id uuid not null references auth.users (id),
  kind text not null check (kind in ('ajuste', 'cancelamento')),
  sessions_total integer not null,
  sessions_used_before integer not null,
  sessions_used_after integer,
  expires_at_before date,
  expires_at_after date,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);

create index if not exists package_balance_adjustment_clinic_contact_idx
  on public.package_balance_adjustment (clinic_id, contact_id, created_at desc);
create index if not exists package_balance_adjustment_balance_idx
  on public.package_balance_adjustment (package_balance_id);

alter table public.package_balance_adjustment enable row level security;

-- Leitura: quem le a trilha (admin e gestor), como audit_log. O motivo e
-- texto livre da recepcao e pode citar o paciente.
drop policy if exists "gestao le ajustes de saldo"
  on public.package_balance_adjustment;
create policy "gestao le ajustes de saldo"
  on public.package_balance_adjustment
  for select to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- Escrita: so a propria pessoa, e com o papel que a policy do saldo exige.
-- Ajuste: admin, gestor e recepcao (= "recepcao e gestao ajustam saldo").
-- Cancelamento: admin e gestor (= "gestao remove saldo"). Sem UPDATE nem
-- DELETE: o historico nao se reescreve.
drop policy if exists "quem ajusta saldo registra o proprio ajuste"
  on public.package_balance_adjustment;
create policy "quem ajusta saldo registra o proprio ajuste"
  on public.package_balance_adjustment
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      (kind = 'ajuste'
        and public.user_has_role(clinic_id, array['admin', 'gestor', 'recepcao']))
      or (kind = 'cancelamento'
        and public.user_has_role(clinic_id, array['admin', 'gestor']))
    )
  );

revoke all on table public.package_balance_adjustment from anon;
revoke update, delete, truncate on table public.package_balance_adjustment
  from authenticated;

-- Ajuste: sessoes usadas (entre 0 e o total, os CHECKs da tabela conferem de
-- novo) e validade (null = nao vence). Nada mudou = recusa, para a trilha
-- nao encher de ajuste vazio.
create or replace function public.ajustar_saldo_de_pacote(
  p_balance_id uuid,
  p_sessions_used integer,
  p_expires_at date,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saldo package_balance%rowtype;
  v_linhas integer;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'check_violation',
      message = 'Escreva o motivo do ajuste.';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'check_violation',
      message = 'O motivo passa de 500 caracteres.';
  end if;

  -- FOR UPDATE com RLS: so volta linha que a pessoa pode alterar.
  select * into v_saldo
    from package_balance
   where id = p_balance_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Saldo de pacote não encontrado.';
  end if;

  if p_sessions_used is null
     or p_sessions_used < 0
     or p_sessions_used > v_saldo.sessions_total then
    raise exception using errcode = 'check_violation',
      message = 'As sessões usadas vão de 0 até o total do pacote.';
  end if;
  if p_sessions_used = v_saldo.sessions_used
     and p_expires_at is not distinct from v_saldo.expires_at then
    raise exception using errcode = 'check_violation',
      message = 'Nada mudou no saldo.';
  end if;

  update package_balance
     set sessions_used = p_sessions_used,
         expires_at = p_expires_at
   where id = p_balance_id;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Seu perfil não pode ajustar saldo de pacote.';
  end if;

  insert into package_balance_adjustment (
    clinic_id, contact_id, package_balance_id, package_id, user_id, kind,
    sessions_total, sessions_used_before, sessions_used_after,
    expires_at_before, expires_at_after, reason
  ) values (
    v_saldo.clinic_id, v_saldo.contact_id, v_saldo.id, v_saldo.package_id,
    auth.uid(), 'ajuste',
    v_saldo.sessions_total, v_saldo.sessions_used, p_sessions_used,
    v_saldo.expires_at, p_expires_at, btrim(p_reason)
  );
end;
$$;

revoke execute on function public.ajustar_saldo_de_pacote(uuid, integer, date, text)
  from public, anon;
grant execute on function public.ajustar_saldo_de_pacote(uuid, integer, date, text)
  to authenticated, service_role;

-- Cancelamento: o registro entra ANTES do delete (a FK do historico vira
-- null com o delete). Sem permissao de DELETE, o insert do historico ja
-- recusa pela policy (so admin e gestor registram cancelamento), e o delete
-- confere de novo pela contagem de linhas.
create or replace function public.cancelar_venda_de_pacote(
  p_balance_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saldo package_balance%rowtype;
  v_linhas integer;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'check_violation',
      message = 'Escreva o motivo do cancelamento.';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'check_violation',
      message = 'O motivo passa de 500 caracteres.';
  end if;

  select * into v_saldo
    from package_balance
   where id = p_balance_id
   for update;
  if not found then
    raise exception using errcode = 'no_data_found',
      message = 'Saldo de pacote não encontrado.';
  end if;

  if exists (
    select 1 from appointment where package_balance_id = p_balance_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'Esta venda já descontou sessão de consulta e não pode ser cancelada. Para corrigir, ajuste o saldo.';
  end if;

  insert into package_balance_adjustment (
    clinic_id, contact_id, package_balance_id, package_id, user_id, kind,
    sessions_total, sessions_used_before, sessions_used_after,
    expires_at_before, expires_at_after, reason
  ) values (
    v_saldo.clinic_id, v_saldo.contact_id, v_saldo.id, v_saldo.package_id,
    auth.uid(), 'cancelamento',
    v_saldo.sessions_total, v_saldo.sessions_used, null,
    v_saldo.expires_at, null, btrim(p_reason)
  );

  delete from package_balance where id = p_balance_id;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Só administrador e gestor cancelam venda de pacote.';
  end if;
end;
$$;

revoke execute on function public.cancelar_venda_de_pacote(uuid, text)
  from public, anon;
grant execute on function public.cancelar_venda_de_pacote(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (2) pacientes_resumo com primeira_consulta
-- ---------------------------------------------------------------------------

drop function if exists public.pacientes_resumo(uuid);

create function public.pacientes_resumo(p_clinic_id uuid)
returns table (
  contact_id uuid,
  name text,
  phone_e164 text,
  insurance_id uuid,
  insurance_name text,
  no_show_count integer,
  tags text[],
  ultima_consulta timestamptz,
  proxima_consulta timestamptz,
  total_compareceu bigint,
  total_faltou bigint,
  saldo_sessoes bigint,
  saldo_total bigint,
  profissionais_ids uuid[],
  primeira_consulta timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.phone_e164,
    c.insurance_id,
    i.name,
    c.no_show_count,
    c.tags,
    a.ultima_consulta,
    a.proxima_consulta,
    coalesce(a.total_compareceu, 0),
    coalesce(a.total_faltou, 0),
    coalesce(pb.saldo_sessoes, 0),
    coalesce(pb.saldo_total, 0),
    coalesce(a.profissionais_ids, '{}'),
    a.primeira_consulta
  from contact c
  cross join lateral (
    select (now() at time zone cl.timezone)::date as hoje_local
    from clinic cl where cl.id = p_clinic_id
  ) tz
  left join insurance i on i.id = c.insurance_id
  left join lateral (
    select
      max(ap.starts_at) filter (
        where ap.starts_at <= now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as ultima_consulta,
      min(ap.starts_at) filter (
        where ap.starts_at > now()
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as proxima_consulta,
      count(*) filter (where ap.status = 'compareceu') as total_compareceu,
      count(*) filter (where ap.status = 'faltou') as total_faltou,
      array_agg(distinct ap.professional_id) filter (
        where ap.professional_id is not null
          and ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as profissionais_ids,
      min(ap.starts_at) filter (
        where ap.status not in ('cancelado_paciente', 'cancelado_clinica')
      ) as primeira_consulta
    from appointment ap
    where ap.contact_id = c.id
  ) a on true
  left join lateral (
    select
      sum(b.sessions_total - b.sessions_used) filter (
        where b.expires_at is null or b.expires_at >= tz.hoje_local
      ) as saldo_sessoes,
      sum(b.sessions_total) as saldo_total
    from package_balance b
    where b.contact_id = c.id
  ) pb on true
  where c.clinic_id = p_clinic_id
    and c.kind = 'paciente'
  order by c.name nulls last, c.id
$$;

revoke execute on function public.pacientes_resumo(uuid) from public, anon;
grant execute on function public.pacientes_resumo(uuid)
  to authenticated, service_role;
