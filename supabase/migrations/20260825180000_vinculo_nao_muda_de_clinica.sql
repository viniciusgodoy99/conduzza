-- Correcao de falha ALTA encontrada na revisao adversarial de 25/08/2026 e
-- provada contra o banco real.
--
-- A coluna clinic_id de clinic_member era mutavel, e as duas travas novas
-- perguntavam pela clinica ERRADA:
--   proteger_papel_admin usava new.clinic_id (a clinica de DESTINO) para saber
--   se quem chama tem autoridade;
--   exigir_admin_ativo contava administradores em coalesce(new, old), que em
--   UPDATE e sempre a de destino, nunca a que PERDEU o vinculo.
--
-- Com isso, quem fosse gestor da clinica B e administrador da clinica A movia
-- o vinculo do administrador de B para A com um unico PATCH no PostgREST: a
-- policy aprovava (USING na origem, WITH CHECK no destino), os gatilhos
-- liberavam, e a clinica B ficava com ZERO administrador ativo, sem volta pela
-- aplicacao e sem uma linha sequer em audit_log. O mesmo PATCH movia qualquer
-- membro entre clinicas, o que e vazamento de fronteira: a pessoa passava a
-- enxergar dado de paciente da outra clinica.
--
-- Nada disso passava por Server Action (que so usa clinic_id como filtro),
-- entao guard, Zod e trilha eram todos contornados. E o caso exato que a regra
-- 3.1 do CLAUDE.md cobre: o filtro de tenant vive na policy, nunca so no
-- codigo.

-- ---------------------------------------------------------------------------
-- 1. O vinculo pertence a UMA clinica e a UMA pessoa, para sempre
-- ---------------------------------------------------------------------------
-- Mover alguem de clinica nao e editar o vinculo: e tirar o acesso de uma e
-- conceder na outra, cada passo com as proprias travas. Vale para todo mundo,
-- inclusive service role: nao existe caminho legitimo que troque essas duas
-- colunas.

create or replace function public.fixar_vinculo_de_membro()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'O vínculo pertence a uma clínica só. Para mover alguém, remova o acesso e convide na outra clínica.';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'O vínculo pertence a uma pessoa só.';
  end if;
  return new;
end;
$$;

-- Nome comeca com "f": dispara ANTES de impedir_auto_aprovacao e de
-- proteger_papel_admin (gatilhos de mesmo momento correm em ordem alfabetica),
-- entao a imutabilidade e conferida primeiro.
create trigger fixar_vinculo_de_membro
  before update on public.clinic_member
  for each row execute function public.fixar_vinculo_de_membro();

-- ---------------------------------------------------------------------------
-- 2. Autoridade e conferida na clinica de ORIGEM
-- ---------------------------------------------------------------------------
-- Com o item 1 as duas clinicas passam a ser sempre a mesma no UPDATE, mas a
-- pergunta certa fica explicita: em UPDATE e DELETE quem manda e a clinica da
-- linha que ja existia; em INSERT, a da linha nova.

create or replace function public.proteger_papel_admin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clinic_id uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  v_clinic_id := coalesce(old.clinic_id, new.clinic_id);
  -- Bootstrap: a primeira linha da clinica nasce admin no cadastro da dona
  -- (gatilho handle_new_user) e nao ha ninguem para autorizar.
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
$$;

-- ---------------------------------------------------------------------------
-- 3. A contagem de administradores olha a clinica que PODE ter perdido um
-- ---------------------------------------------------------------------------

create or replace function public.exigir_admin_ativo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_clinic_id uuid;
  v_restantes integer;
begin
  -- So roda em UPDATE e DELETE, entao old sempre existe: a clinica a proteger
  -- e a da linha ANTERIOR, nunca a de destino.
  v_clinic_id := old.clinic_id;
  if not (old.role = 'admin' and old.status = 'ativo') then
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
