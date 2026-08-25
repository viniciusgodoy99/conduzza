-- Equipe e papeis na tela de Configuracoes (escopo antecipado da Tela 12,
-- decisao do dono em 25/08/2026).
--
-- Duas decisoes do dono: (1) administrador E gestor gerenciam a equipe, os
-- papeis e a conexao do WhatsApp; (2) tirar acesso DESATIVA o vinculo, em vez
-- de apagar, para preservar o historico e permitir reativar.
--
-- Como o gestor passa a mexer em quem tem acesso, entram duas travas novas no
-- banco, nao so na tela: gestor nao mexe em administrador, e a clinica nunca
-- fica sem administrador ativo (hoje o unico admin consegue se autoexcluir e
-- travar a clinica para sempre).

-- ---------------------------------------------------------------------------
-- 1. Vinculo desativado
-- ---------------------------------------------------------------------------
-- Todo controle de acesso do banco confere status = 'ativo' (checagem
-- POSITIVA: user_active_clinic_ids, user_has_role, user_can_write,
-- user_professional_id), entao o vinculo inativo perde acesso sozinho em toda
-- a RLS, sem tocar em policy nenhuma.

alter table public.clinic_member drop constraint clinic_member_status_check;
alter table public.clinic_member add constraint clinic_member_status_check
  check (status in ('ativo', 'pendente', 'inativo'));

-- ---------------------------------------------------------------------------
-- 2. Gestor tambem gerencia a equipe
-- ---------------------------------------------------------------------------

drop policy "admin adiciona membro" on public.clinic_member;
drop policy "admin edita membro" on public.clinic_member;
drop policy "admin remove membro" on public.clinic_member;

create policy "gestao adiciona membro" on public.clinic_member
  for insert with check (
    public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao edita membro" on public.clinic_member
  for update using (
    public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao remove membro" on public.clinic_member
  for delete using (
    public.user_has_role(clinic_id, array['admin', 'gestor']));

-- ---------------------------------------------------------------------------
-- 3. Gestor nao mexe em administrador
-- ---------------------------------------------------------------------------
-- Sem esta trava o gestor viraria administrador por triangulacao: promove um
-- colega a admin e pede para ser promovido de volta. security invoker de
-- proposito, para enxergar o papel REAL de quem esta executando.
-- Service role (auth.uid() nulo) passa: e o caminho de manutencao e de seed.

create or replace function public.proteger_papel_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Bootstrap: a primeira linha da clinica nasce admin no cadastro da dona
  -- (gatilho handle_new_user) e nao ha ninguem para autorizar.
  if not exists (
    select 1 from clinic_member where clinic_id = new.clinic_id
  ) then
    return new;
  end if;
  if public.user_has_role(new.clinic_id, array['admin']) then
    return new;
  end if;
  if new.role = 'admin' then
    raise exception 'Somente um administrador cria outro administrador.';
  end if;
  if tg_op = 'UPDATE' and old.role = 'admin' then
    raise exception 'Somente um administrador altera o acesso de outro administrador.';
  end if;
  return new;
end;
$$;

create trigger proteger_papel_admin
  before insert or update on public.clinic_member
  for each row execute function public.proteger_papel_admin();

-- Delete tem gatilho proprio: o corpo acima usa new, que nao existe em DELETE.
create or replace function public.proteger_remocao_de_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  if old.role = 'admin'
     and not public.user_has_role(old.clinic_id, array['admin']) then
    raise exception 'Somente um administrador remove outro administrador.';
  end if;
  return old;
end;
$$;

create trigger proteger_remocao_de_admin
  before delete on public.clinic_member
  for each row execute function public.proteger_remocao_de_admin();

-- ---------------------------------------------------------------------------
-- 4. A clinica nunca fica sem administrador ativo
-- ---------------------------------------------------------------------------
-- Vale para rebaixar, desativar e excluir, inclusive a propria linha (o
-- impedir_auto_aprovacao cobre so UPDATE do proprio papel; DELETE passava).
-- AFTER, para enxergar o estado ja aplicado; a excecao desfaz a transacao.

create or replace function public.exigir_admin_ativo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_restantes integer;
begin
  v_clinic_id := coalesce(new.clinic_id, old.clinic_id);
  -- So confere quando a operacao pode ter TIRADO um administrador ativo.
  if tg_op = 'UPDATE'
     and not (old.role = 'admin' and old.status = 'ativo')
  then
    return null;
  end if;
  if tg_op = 'DELETE' and not (old.role = 'admin' and old.status = 'ativo') then
    return null;
  end if;

  select count(*) into v_restantes
  from clinic_member
  where clinic_id = v_clinic_id and role = 'admin' and status = 'ativo';

  if v_restantes = 0 then
    raise exception 'A clínica precisa de pelo menos um administrador ativo.';
  end if;
  return null;
end;
$$;

create trigger exigir_admin_ativo
  after update or delete on public.clinic_member
  for each row execute function public.exigir_admin_ativo();
