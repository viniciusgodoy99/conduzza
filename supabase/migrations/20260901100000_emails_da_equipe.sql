-- ---------------------------------------------------------------------------
-- E-mails da equipe numa consulta so
-- ---------------------------------------------------------------------------
-- E-mail de usuario so existe no GoTrue (auth.users), que o PostgREST nao
-- expoe. A tela de Configuracoes fazia UMA chamada HTTP a API admin POR
-- MEMBRO da equipe em cada carga (equipe de 15 pessoas = 15 requests antes de
-- renderizar). Esta funcao devolve os e-mails dos membros da clinica numa ida
-- so.
--
-- Execucao restrita ao service_role: quem chama e o cliente admin do
-- servidor, nunca o usuario logado. Dar isso a authenticated exporia e-mail
-- de equipe de outra clinica, ja que a funcao e security definer e nao passa
-- pela RLS de clinic_member.

create function public.emails_da_equipe(p_clinic_id uuid)
returns table (user_id uuid, email text)
language sql stable security definer
set search_path = public
as $$
  select u.id, coalesce(u.email, '')::text
  from auth.users u
  join clinic_member m on m.user_id = u.id
  where m.clinic_id = p_clinic_id
$$;

revoke execute on function public.emails_da_equipe(uuid)
  from public, anon, authenticated;
grant execute on function public.emails_da_equipe(uuid) to service_role;
