-- ---------------------------------------------------------------------------
-- Codigo da clinica com o gestor, entrada por codigo por RPC e conta que ja
-- existe no convite (revisao de liberacao, achados 0, 3, 121, 122 e 124)
-- ---------------------------------------------------------------------------
-- 1) Decisao do dono (24/09/2026): o gestor gerencia o codigo da clinica,
--    como ja gerencia a equipe desde 25/08 (20260825160000_equipe_e_papeis).
--    As policies de clinic_access_code continuavam so do administrador: o
--    gestor via a caixa do codigo vazia, e "Gerar novo" atingia zero linhas
--    sem erro nenhum. Ler e girar passam a valer para administrador e gestor.
--
-- 2) allow_code_signup mora em clinic, cuja policy de UPDATE e so do
--    administrador, e tem de continuar assim: ela tambem abre o nome (que o
--    paciente le nas mensagens) e o fuso (que move a regua e a agenda). O
--    gestor liga e desliga a entrada por codigo por esta RPC, que confere o
--    papel e altera SO essa coluna.
--
-- 3) Convite de conta que ja existe: o GoTrue recusa convidar e-mail ja
--    confirmado, e nao havia outro caminho para vincular essa conta (quem foi
--    recusado por engano, quem criou clinica por engano, quem trabalha em
--    duas clinicas). A busca do user_id pelo e-mail le auth.users, entao e
--    security definer e so o service_role executa (molde de
--    emails_da_equipe): dar isso a authenticated seria um oraculo de "este
--    e-mail tem conta". O vinculo continua sendo inserido com a sessao de
--    quem convida, entao a policy e os gatilhos de clinic_member (papel de
--    administrador, autoaprovacao) continuam decidindo.

-- 1) Codigo da clinica: administrador e gestor leem e giram.
drop policy "admin le o codigo da clinica" on public.clinic_access_code;
drop policy "admin gira o codigo da clinica" on public.clinic_access_code;

create policy "gestao le o codigo da clinica" on public.clinic_access_code
  for select using (public.user_has_role(clinic_id, array['admin', 'gestor']));

create policy "gestao gira o codigo da clinica" on public.clinic_access_code
  for update using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (public.user_has_role(clinic_id, array['admin', 'gestor']));

-- 2) Entrada por codigo ligada ou desligada, sem abrir o UPDATE de clinic.
create function public.definir_entrada_por_codigo(
  p_clinic_id uuid,
  p_ativo boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe se a entrada por código fica ligada ou desligada.';
  end if;
  if not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
    raise exception using errcode = '42501',
      message = 'Somente administradores e gestores alteram a entrada por código.';
  end if;

  update clinic
     set allow_code_signup = p_ativo
   where id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Clínica não encontrada.';
  end if;

  return p_ativo;
end;
$$;

revoke execute on function public.definir_entrada_por_codigo(uuid, boolean)
  from public, anon;
grant execute on function public.definir_entrada_por_codigo(uuid, boolean)
  to authenticated;

-- 3) Conta pelo e-mail, so para o servidor (convite de conta que ja existe).
-- O GoTrue grava o e-mail em minusculas; o lower dos dois lados cobre conta
-- antiga e digitacao com maiuscula. Conta apagada (soft delete) e anonima
-- nao contam. SSO fica por ultimo: o unico indice unico de e-mail e o das
-- contas sem SSO.
create function public.conta_por_email(p_email text)
returns table (user_id uuid, confirmada boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email_confirmed_at is not null
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.deleted_at is null
     and not coalesce(u.is_anonymous, false)
   order by u.is_sso_user asc
   limit 1
$$;

revoke execute on function public.conta_por_email(text)
  from public, anon, authenticated;
grant execute on function public.conta_por_email(text) to service_role;
