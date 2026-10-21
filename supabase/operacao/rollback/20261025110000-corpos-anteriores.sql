-- Corpos lidos da producao em 21/10/2026, antes da migration 20261025110000
-- (papel Implementador, onda 5, item 18). md5(prosrc) na leitura (o ensaio
-- confere que o banco ainda esta assim antes de trocar):
--   proteger_papel_admin()       670394f1ee4035092e1cca2e4cd3f4ca
--   proteger_remocao_de_admin()  d89ed9fa1b5c37ea4d85f5c08fef44a9
--   exigir_admin_ativo()         99997bdbf50abbb1535805400b7007bb
-- Nenhuma das tres tinha comentario (o que a migration pos sai). Os grants
-- ficam (CREATE OR REPLACE os mantem). exigir_admin_ativo volta a SECURITY
-- INVOKER com search_path public (o corpo abaixo e o de producao, sem
-- SECURITY DEFINER): volta tambem o buraco de hoje, em que o unico
-- administrador consegue excluir o proprio vinculo pelo PostgREST.
--
-- ROLLBACK manual da migration (cabecalho dela). ORDEM:
--   1. Voltar o CODIGO (o de hoje le a marca, mostra "Implementador" e
--      chama entrar_como_implementador e deixar_de_ser_implementador).
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor: sai o
--      gatilho de limpeza em clinic_member e as duas RPCs; os tres corpos e
--      os comentarios de antes voltam ANTES de as funcoes da marca sairem
--      (os corpos novos as chamam); sai a tabela membro_implementador (com
--      as policies, os gatilhos e a FK) e, por ultimo, as funcoes da marca.
-- O que se perde: as marcas. Todo Implementador vira administrador pleno
-- (o vinculo dele ja e admin): ANTES do passo 2, se alguem nao deve ficar
-- como administrador pleno, mudar o papel dele pela tela.
-- O que fica: a trilha (marcou_implementador, tirou_implementador) e os
-- vinculos como estao.
-- TRAVAS: o DROP TRIGGER e o DROP da tabela (FK para clinic_member) seguram
-- SHARE ROW EXCLUSIVE em clinic_member ate o commit (a leitura segue; a
-- escrita na equipe espera); lock_timeout de 3 s, horario calmo.
-- Conferir no fim: os tres md5 acima, nenhuma das dez funcoes novas, a
-- tabela fora (consultas do rodape).

begin;
set local lock_timeout = '3s';

-- 1. O gatilho de limpeza em clinic_member e as RPCs.
drop trigger if exists limpar_marca_de_implementador on public.clinic_member;
drop function if exists public.limpar_marca_de_implementador();
drop function if exists public.entrar_como_implementador(uuid, uuid, text, text);
drop function if exists public.deixar_de_ser_implementador(uuid, uuid, text);

-- 2. Os tres corpos de antes e os comentarios de antes (nenhum).
CREATE OR REPLACE FUNCTION public.proteger_papel_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_clinic_id uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  v_clinic_id := coalesce(old.clinic_id, new.clinic_id);
  if not exists (
    select 1 from clinic_member where clinic_id = v_clinic_id
  ) then
    return new;
  end if;
  if public.user_has_role(v_clinic_id, array['admin']) then
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
$function$;
comment on function public.proteger_papel_admin() is null;

CREATE OR REPLACE FUNCTION public.proteger_remocao_de_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;
comment on function public.proteger_remocao_de_admin() is null;

CREATE OR REPLACE FUNCTION public.exigir_admin_ativo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_clinic_id uuid;
  v_restantes integer;
begin
  v_clinic_id := old.clinic_id;
  if not (old.role = 'admin' and old.status = 'ativo') then
    return null;
  end if;

  if not exists (select 1 from clinic where id = v_clinic_id) then
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
$function$;
comment on function public.exigir_admin_ativo() is null;

-- 3. A tabela da marca (com as policies, os gatilhos e a FK) e, depois, as
-- funcoes que ela e os corpos novos usavam.
drop table if exists public.membro_implementador;
drop function if exists public.conferir_marca_de_implementador();
drop function if exists public.conferir_retirada_de_implementador();
drop function if exists public.fixar_marca_de_implementador();
drop function if exists public.exigir_admin_pleno_ativo();
drop function if exists public.user_e_admin_pleno(uuid);
drop function if exists public.user_e_implementador(uuid);
drop function if exists public.admins_plenos_ativos(uuid);

commit;

-- Conferencia (so leitura), depois do commit:
-- select p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.proconfig
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('proteger_papel_admin', 'proteger_remocao_de_admin',
--                      'exigir_admin_ativo', 'user_e_implementador',
--                      'user_e_admin_pleno', 'admins_plenos_ativos',
--                      'entrar_como_implementador', 'deixar_de_ser_implementador',
--                      'conferir_marca_de_implementador',
--                      'conferir_retirada_de_implementador',
--                      'fixar_marca_de_implementador',
--                      'exigir_admin_pleno_ativo', 'limpar_marca_de_implementador');
--   (so as tres primeiras, com os md5 acima, prosecdef falso e search_path=public)
-- select to_regclass('public.membro_implementador');  (nulo)
