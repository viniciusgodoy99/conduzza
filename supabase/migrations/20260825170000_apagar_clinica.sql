-- Correcao do gatilho exigir_admin_ativo (migration 20260825160000).
--
-- Do jeito que ele foi escrito, NENHUMA clinica podia mais ser apagada: o
-- cascade de clinic apaga os vinculos, o gatilho AFTER roda por linha no fim
-- da instrucao, ja com todos os vinculos fora, conta zero administrador ativo
-- e derruba a transacao inteira com "A clínica precisa de pelo menos um
-- administrador ativo.". A clinica ficava presa no banco para sempre.
--
-- Isso quebrava tambem o teardown das suites (tests/rls e o limpar() das
-- fixtures de e2e apagam a clinica de teste), que engolia o erro em silencio e
-- deixava clinica e usuarios de teste acumulando no projeto.
--
-- Apagar a clinica inteira nao e "a clinica ficar sem administrador": nao ha
-- mais clinica para proteger. A saida nova confere exatamente isso.

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

  -- A clinica ja saiu do banco: o vinculo caiu por cascade, nao por alguem
  -- tirando o acesso do ultimo administrador.
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
$$;
