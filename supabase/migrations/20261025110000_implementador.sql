-- ---------------------------------------------------------------------------
-- Papel Implementador: administrador com a marca (onda 5, item 18)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026, depois da 2a reuniao com o Victor ("uma
-- funcao de tecnico... O cara bota email, bota tipo aqui implementador...
-- Assistente tecnico"); resposta D do dono: ele ve e faz "Tudo", inclusive
-- dado de paciente, como o administrador. Contrato entre as frentes em
-- ~/.claude/plans/onda5-atribuicao-implementador/contrato.md, parte B.1.
-- Decisoes do dono de 21/10/2026:
--   - P18-1 (b-i): o Implementador e, no banco, um vinculo 'admin' com uma
--     linha na tabela nova membro_implementador. As 145 policies, as tres
--     funcoes de acesso (user_active_clinic_ids, user_has_role,
--     user_can_write) e as comparacoes com 'admin' do TypeScript ficam como
--     estao: ele ve e faz tudo como o administrador. Nenhum ALTER em
--     clinic_member (tabela nova em vez de coluna nova);
--   - P18-2 (a): o Implementador nao mexe em administrador (nem em outro
--     Implementador): fica como o gestor diante deles;
--   - P18-3 (a): ele nao conta como o administrador que a clinica precisa
--     ter: a clinica sempre tem um administrador pleno ativo;
--   - P18-4 (a): so o administrador pleno da clinica marca e desmarca;
--   - P18-5 (a), lista separada no Painel geral: NAO entra aqui (a onda 2,
--     ainda nao publicada, muda painel_geral_das_clinicas; a lista vem
--     depois da juncao das ondas);
--   - P18-6 (b) e P18-7 (a) sao do codigo (a exportacao de leads e os
--     e-mails nao passam pelo banco).
--
-- 1. membro_implementador (clinic_id, user_id) com FK composta para
--    clinic_member em cascata (tirar o vinculo tira a marca). RLS: le o
--    proprio usuario, o membro ativo da clinica e o super admin; marca
--    (INSERT) e desmarca (DELETE) so o administrador pleno; sem UPDATE.
--    Grants: anon fora; authenticated so SELECT, INSERT e DELETE.
-- 2. user_e_implementador(uuid) e user_e_admin_pleno(uuid) (STABLE,
--    SECURITY DEFINER, search_path vazio; EXECUTE para authenticated e
--    service_role) e admins_plenos_ativos(uuid) (so service_role: quem conta
--    sao os gatilhos). Nenhuma delas entra em policy de dado de paciente:
--    so na equipe e na marca, entao nada muda no custo por linha.
-- 3. Gatilhos da marca: BEFORE INSERT confere a permissao (42501, antes de
--    tudo: o gatilho BEFORE roda antes da RLS), recusa a propria pessoa e
--    exige o vinculo 'admin'; BEFORE DELETE recusa a propria pessoa; BEFORE
--    UPDATE recusa sempre (a marca nao muda: trocar a pessoa ou a clinica
--    pularia as conferencias do INSERT, e a sessao ja nao tem o grant, mas
--    a service role e o SQL editor tem; achado da revisao); AFTER
--    INSERT trava (FOR NO KEY UPDATE, em ordem de user_id) os vinculos de
--    administrador ativo da clinica e o da pessoa marcada, confere de novo
--    que ela e administradora e que sobra um administrador pleno ativo
--    (mesma frase de exigir_admin_ativo). A trava serializa marcar contra
--    marcar e contra quem rebaixa, desativa ou exclui administrador ao
--    mesmo tempo (o gatilho de limpeza e o exigir_admin_ativo de quem
--    esperou ja veem a marca). Valem para a service role (auth.uid() nulo
--    pula so a permissao e a regra da propria pessoa).
-- 4. limpar_marca_de_implementador: AFTER UPDATE OF role em clinic_member,
--    quando o papel deixa de ser 'admin', apaga a marca (papel e marca nunca
--    se desencontram).
-- 5. As tres travas da equipe, a partir do corpo de PRODUCAO lido em
--    21/10/2026 (fndef.js, so leitura), diff minimo entre "-- [implementador]
--    inicio" e "fim" (corpo anterior e md5 em supabase/operacao/rollback/
--    20261025110000-corpos-anteriores.sql; grants ficam como eram, e
--    security e search_path tambem, menos em exigir_admin_ativo):
--    - proteger_papel_admin e proteger_remocao_de_admin (P18-2): liberam so
--      o administrador pleno (user_e_admin_pleno, que e user_has_role com
--      'admin' e sem a marca);
--    - exigir_admin_ativo (P18-3): troca o count(*) por
--      admins_plenos_ativos (o vinculo marcado nao conta). Para chamar a
--      funcao sem EXECUTE para a sessao, e para a conta nao depender da RLS
--      de quem mexe na equipe (como o contrato quer), ela passa de SECURITY
--      INVOKER a SECURITY DEFINER com search_path vazio (a unica tabela que
--      ela le direto vira public.clinic). Isso fecha um buraco da producao
--      de hoje, achado no ensaio: a conferencia "a clinica ainda existe?"
--      rodava com a RLS de quem chama; o administrador que exclui o PROPRIO
--      vinculo pelo PostgREST deixa de ver a clinica, o gatilho saia ali
--      como se ela tivesse sido apagada, e o unico administrador conseguia
--      se excluir (a clinica ficava sem administrador; com a marca, ficaria
--      so com o implementador). Agora a exclusao do proprio vinculo segue a
--      regra de sempre: passa se sobra outro administrador pleno ativo.
--      Fora esse caso, sem marca, o resultado e o de antes para toda
--      clinica (quem mexe na equipe ja via todos os vinculos dela; a
--      service role e o SQL editor ja liam tudo).
-- 6. Duas RPCs SECURITY INVOKER (a RLS e os gatilhos de clinic_member
--    decidem com a identidade de quem chama), search_path vazio, EXECUTE so
--    para authenticated, que gravam papel e marca na mesma transacao:
--    - entrar_como_implementador(clinica, pessoa, situacao_lida, papel_lido)
--      devolve 'convidado' (sem vinculo lido: situacao e papel nulos; o
--      vinculo nasce admin ativo, o convite e nominal), 'liberado' (pedido
--      de entrada 'pendente': vira admin ativo), 'promovido' (vinculo
--      'ativo' com outro papel: vira admin) ou 'marcado' (ja era admin
--      ativo). O vinculo so muda se esta como a tela leu (situacao e papel):
--      senao P0001 papel_mudou (aba desatualizada);
--    - deixar_de_ser_implementador(clinica, pessoa, papel_novo): 'admin' so
--      apaga a marca (vira administrador pleno); outro papel troca o role (a
--      marca sai pelo gatilho de limpeza). P0001 papel_mudou se a pessoa
--      nao e mais implementadora.
--    As duas recusam 42501 antes de mexer em qualquer coisa quando quem
--    chama nao e administrador pleno da clinica (P18-4).
--
-- Erros: chaves em P0001 (papel_mudou, ja_e_implementador) e em 22023
-- (situacao_invalida, papel_invalido); 22004 para argumento nulo; 42501 para
-- quem nao e administrador pleno; as frases das travas da equipe como sao
-- hoje ("Somente um administrador...", "A clinica precisa de pelo menos um
-- administrador ativo.", "Voce nao altera o proprio papel."). Nunca
-- 40001/40P01 (o PostgREST repete sem limite).
--
-- Producao em 21/10/2026 (q.js, so leitura): 6 clinicas reais com 7
-- vinculos admin ativos e 1 recepcao, 1 admin numa clinica e_de_teste, 1
-- super admin (administrador da teste123 e da Salud Care), nenhum vinculo
-- pendente ou inativo; nenhuma marca (a tabela e nova). As tres funcoes de
-- acesso NAO mudam (o ensaio confere o md5 e as respostas de todo vinculo,
-- antes e depois).
--
-- LOCKS: lock_timeout de 3 s. A FK nova e o CREATE TRIGGER de limpeza
-- seguram SHARE ROW EXCLUSIVE em clinic_member ate o commit: a leitura
-- (toda RLS) segue; a escrita na equipe (rara) espera. Nenhum ALTER em
-- message, conversation, contact, clinic_member, job_queue nem clinic, e
-- nenhuma linha delas muda aqui. Nada aqui grava dado de paciente.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo (o de hoje le a marca
-- e chama as RPCs), DEPOIS, numa transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261025110000-corpos-anteriores.sql (os tres
-- corpos de antes voltam, as funcoes, os gatilhos e a tabela novos saem; o
-- Implementador vira administrador pleno).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) A marca
-- ---------------------------------------------------------------------------

create table public.membro_implementador (
  clinic_id uuid not null,
  user_id uuid not null,
  marcado_em timestamptz not null default now(),
  marcado_por uuid,
  constraint membro_implementador_pkey primary key (clinic_id, user_id),
  constraint membro_implementador_clinic_id_user_id_fkey
    foreign key (clinic_id, user_id)
    references public.clinic_member (clinic_id, user_id)
    on delete cascade
);

alter table public.membro_implementador enable row level security;

revoke all on table public.membro_implementador from anon;
revoke all on table public.membro_implementador from authenticated;
grant select, insert, delete on table public.membro_implementador to authenticated;

comment on table public.membro_implementador is
  'Marca de Implementador (onda 5, P18-1 do dono de 21/10/2026): o vinculo admin da clinica que e assistente tecnico. Ele ve e faz tudo como o administrador (as policies e as funcoes de acesso nao mudam), menos mexer em administrador ou em outro implementador (proteger_papel_admin, proteger_remocao_de_admin), e nao conta como o administrador que a clinica precisa ter (exigir_admin_ativo, exigir_admin_pleno_ativo). So o administrador pleno marca e desmarca. A marca so existe em vinculo admin: sai sozinha quando o papel muda (limpar_marca_de_implementador) ou o vinculo some (FK em cascata), e nunca muda de pessoa nem de clinica (fixar_marca_de_implementador: tirar e marcar de novo).';
comment on column public.membro_implementador.marcado_por is
  'auth.uid() de quem marcou (o gatilho grava; nulo pela service role ou pelo SQL editor).';

-- ---------------------------------------------------------------------------
-- 2) As funcoes da marca
-- ---------------------------------------------------------------------------

create function public.user_e_implementador(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membro_implementador i
     where i.clinic_id = p_clinic_id
       and i.user_id = auth.uid()
  )
$$;

revoke all on function public.user_e_implementador(uuid) from public, anon;
grant execute on function public.user_e_implementador(uuid) to authenticated, service_role;

comment on function public.user_e_implementador(uuid) is
  'A sessao tem a marca de Implementador nesta clinica (membro_implementador)? Nulo ou sem sessao: falso. Nao entra em policy de dado de paciente.';

create function public.user_e_admin_pleno(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_role(p_clinic_id, array['admin'])
     and not public.user_e_implementador(p_clinic_id)
$$;

revoke all on function public.user_e_admin_pleno(uuid) from public, anon;
grant execute on function public.user_e_admin_pleno(uuid) to authenticated, service_role;

comment on function public.user_e_admin_pleno(uuid) is
  'A sessao e administrador ATIVO desta clinica sem a marca de Implementador? (user_has_role com admin e not user_e_implementador.) Quem marca e desmarca o implementador e quem mexe em administrador. Nao entra em policy de dado de paciente.';

create function public.admins_plenos_ativos(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.clinic_member m
   where m.clinic_id = p_clinic_id
     and m.role = 'admin'
     and m.status = 'ativo'
     and not exists (
       select 1 from public.membro_implementador i
        where i.clinic_id = m.clinic_id
          and i.user_id = m.user_id
     )
$$;

-- Sem EXECUTE para a sessao: quem conta sao os gatilhos (como dono), sem
-- depender da RLS de quem chama; a sessao nao pergunta pela equipe de
-- outra clinica.
revoke all on function public.admins_plenos_ativos(uuid) from public, anon, authenticated;
grant execute on function public.admins_plenos_ativos(uuid) to service_role;

comment on function public.admins_plenos_ativos(uuid) is
  'Quantos vinculos admin ativos da clinica NAO tem a marca de Implementador (a clinica sempre precisa de um). Conta a tabela inteira (SECURITY DEFINER). So service_role e as funcoes do banco.';

-- ---------------------------------------------------------------------------
-- 3) Os gatilhos da marca
-- ---------------------------------------------------------------------------

create function public.conferir_marca_de_implementador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    -- A regra da policy de INSERT, antes de tudo (o gatilho BEFORE roda
    -- antes da RLS): quem nao e administrador pleno da clinica recebe 42501
    -- e nao descobre o papel de ninguem.
    if not public.user_e_admin_pleno(new.clinic_id) then
      raise exception 'Somente um administrador da clínica marca o implementador.'
        using errcode = '42501';
    end if;
    if new.user_id = v_uid then
      raise exception 'Você não altera o próprio papel.';
    end if;
    new.marcado_por := v_uid;
    new.marcado_em := now();
  end if;

  -- A marca so existe em vinculo de administrador (o gatilho depois do
  -- insert confere de novo, com o vinculo travado).
  if not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = new.clinic_id
       and m.user_id = new.user_id
       and m.role = 'admin'
  ) then
    raise exception 'Só um administrador da clínica pode ser implementador.';
  end if;
  return new;
end;
$$;

revoke all on function public.conferir_marca_de_implementador() from public, anon, authenticated;

comment on function public.conferir_marca_de_implementador() is
  'Gatilho BEFORE INSERT de membro_implementador (onda 5): com sessao, 42501 para quem nao e administrador pleno da clinica (antes da RLS), recusa a propria pessoa e grava marcado_por e marcado_em; sempre exige o vinculo admin.';

create trigger conferir_marca_de_implementador
  before insert on public.membro_implementador
  for each row execute function public.conferir_marca_de_implementador();

create function public.conferir_retirada_de_implementador()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and old.user_id = auth.uid() then
    raise exception 'Você não altera o próprio papel.';
  end if;
  return old;
end;
$$;

revoke all on function public.conferir_retirada_de_implementador() from public, anon, authenticated;

comment on function public.conferir_retirada_de_implementador() is
  'Gatilho BEFORE DELETE de membro_implementador (onda 5): ninguem tira a propria marca (sem sessao, passa).';

create trigger conferir_retirada_de_implementador
  before delete on public.membro_implementador
  for each row execute function public.conferir_retirada_de_implementador();

-- A marca nao muda (achado da revisao da onda 5). A sessao nao tem UPDATE
-- (grant e policy), mas a service role e o SQL editor tem: trocar a pessoa
-- ou a clinica da linha pularia conferir_marca_de_implementador (a marca so
-- em vinculo admin) e exigir_admin_pleno_ativo (sobra um administrador
-- pleno), e poria a marca num gestor ou no unico administrador pleno de
-- outra clinica. Recusa toda mudanca, para todo mundo: tirar e marcar de
-- novo passa pelas duas conferencias.
create function public.fixar_marca_de_implementador()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A marca de implementador não muda: tire e marque de novo.';
end;
$$;

revoke all on function public.fixar_marca_de_implementador() from public, anon, authenticated;

comment on function public.fixar_marca_de_implementador() is
  'Gatilho BEFORE UPDATE de membro_implementador (onda 5): a marca nunca muda, para ninguem (nem a service role, nem o SQL editor). Trocar a pessoa ou a clinica pularia as conferencias do INSERT (vinculo admin e administrador pleno que sobra): tirar e marcar de novo. Recusa em P0001.';

create trigger fixar_marca_de_implementador
  before update on public.membro_implementador
  for each row execute function public.fixar_marca_de_implementador();

create function public.exigir_admin_pleno_ativo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trava (FOR NO KEY UPDATE, em ordem de user_id, num comando so) os
  -- vinculos de administrador ativo da clinica e o da pessoa marcada, ate o
  -- fim da transacao. Duas marcas ao mesmo tempo esperam uma pela outra; quem
  -- rebaixa, desativa ou exclui um administrador espera, e o
  -- exigir_admin_ativo dele ja ve esta marca; ou esta conta espera a dele e
  -- ja ve o administrador fora. A leitura dos vinculos (toda RLS) nao espera.
  perform 1
     from public.clinic_member m
    where m.clinic_id = new.clinic_id
      and ((m.role = 'admin' and m.status = 'ativo') or m.user_id = new.user_id)
    order by m.user_id
      for no key update;

  -- Com o vinculo travado: o papel pode ter mudado enquanto esta transacao
  -- esperava (a limpeza da outra nao via esta marca).
  if not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = new.clinic_id
       and m.user_id = new.user_id
       and m.role = 'admin'
  ) then
    raise exception 'Só um administrador da clínica pode ser implementador.';
  end if;

  if public.admins_plenos_ativos(new.clinic_id) = 0 then
    raise exception 'A clínica precisa de pelo menos um administrador ativo.';
  end if;
  return null;
end;
$$;

revoke all on function public.exigir_admin_pleno_ativo() from public, anon, authenticated;

comment on function public.exigir_admin_pleno_ativo() is
  'Gatilho AFTER INSERT de membro_implementador (onda 5, P18-3): com os vinculos de administrador ativo da clinica e o da pessoa marcada travados, confere que ela continua admin e que sobra pelo menos um administrador pleno ativo. Vale para a service role.';

create trigger exigir_admin_pleno_ativo
  after insert on public.membro_implementador
  for each row execute function public.exigir_admin_pleno_ativo();

-- Policies (depois das funcoes que elas chamam).
create policy "membro ve as marcas de implementador"
  on public.membro_implementador
  for select to authenticated
  using (
    user_id = auth.uid()
    or clinic_id in (select public.user_active_clinic_ids())
    or public.is_product_admin()
  );

create policy "administrador pleno marca o implementador"
  on public.membro_implementador
  for insert to authenticated
  with check (public.user_e_admin_pleno(clinic_id));

create policy "administrador pleno desmarca o implementador"
  on public.membro_implementador
  for delete to authenticated
  using (public.user_e_admin_pleno(clinic_id));

-- ---------------------------------------------------------------------------
-- 4) Papel e marca nunca se desencontram
-- ---------------------------------------------------------------------------

create function public.limpar_marca_de_implementador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.membro_implementador i
   where i.clinic_id = old.clinic_id
     and i.user_id = old.user_id;
  return null;
end;
$$;

revoke all on function public.limpar_marca_de_implementador() from public, anon, authenticated;

comment on function public.limpar_marca_de_implementador() is
  'Gatilho de clinic_member (onda 5): quando o papel deixa de ser admin, a marca de Implementador sai. SECURITY DEFINER: apaga a marca sem depender da RLS de quem mudou o papel.';

create trigger limpar_marca_de_implementador
  after update of role on public.clinic_member
  for each row
  when (old.role = 'admin' and new.role <> 'admin')
  execute function public.limpar_marca_de_implementador();

-- ---------------------------------------------------------------------------
-- 5) As tres travas da equipe (corpos de producao, diff marcado)
-- ---------------------------------------------------------------------------

create or replace function public.proteger_papel_admin()
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
  -- [implementador] inicio
  -- Onda 5 (P18-2 do dono, 21/10/2026): so o administrador PLENO, sem a
  -- marca de implementador (era user_has_role(v_clinic_id,
  -- array['admin'])). O implementador (vinculo admin com a marca) fica
  -- como o gestor diante de administrador e de outro implementador.
  if public.user_e_admin_pleno(v_clinic_id) then
  -- [implementador] fim
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

comment on function public.proteger_papel_admin() is
  'Gatilho de clinic_member: so o administrador pleno (sem a marca de Implementador, P18-2 de 21/10/2026) cria administrador ou altera o vinculo de um administrador; service role e o primeiro vinculo da clinica passam. SECURITY INVOKER: ve o papel real de quem executa.';

create or replace function public.proteger_remocao_de_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    return old;
  end if;
  if old.role = 'admin'
     -- [implementador] inicio
     -- Onda 5 (P18-2 do dono, 21/10/2026): so o administrador PLENO (era
     -- user_has_role(old.clinic_id, array['admin'])).
     and not public.user_e_admin_pleno(old.clinic_id) then
     -- [implementador] fim
    raise exception 'Somente um administrador remove outro administrador.';
  end if;
  return old;
end;
$function$;

comment on function public.proteger_remocao_de_admin() is
  'Gatilho de clinic_member: so o administrador pleno (sem a marca de Implementador, P18-2 de 21/10/2026) exclui o vinculo de um administrador; service role passa.';

create or replace function public.exigir_admin_ativo()
 RETURNS trigger
 LANGUAGE plpgsql
 -- [implementador] SECURITY DEFINER e search_path vazio (era SECURITY
 -- INVOKER com search_path public): a conta e a conferencia da clinica
 -- nao dependem mais da RLS de quem mexe na equipe.
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_clinic_id uuid;
  v_restantes integer;
begin
  v_clinic_id := old.clinic_id;
  if not (old.role = 'admin' and old.status = 'ativo') then
    return null;
  end if;

  -- [implementador] inicio
  -- Onda 5: public.clinic (era clinic), lida como dono. Com a RLS de quem
  -- chama, o administrador que excluia o proprio vinculo deixava de ver
  -- a clinica, e o gatilho saia aqui como se ela tivesse sido apagada.
  if not exists (select 1 from public.clinic where id = v_clinic_id) then
  -- [implementador] fim
    return null;
  end if;

  -- [implementador] inicio
  -- Onda 5 (P18-3 do dono, 21/10/2026): o implementador nao conta como o
  -- administrador que a clinica precisa ter. Era: select count(*) into
  -- v_restantes from clinic_member where clinic_id = v_clinic_id and
  -- role = 'admin' and status = 'ativo'. Sem marca, a conta e a mesma.
  v_restantes := public.admins_plenos_ativos(v_clinic_id);
  -- [implementador] fim

  if v_restantes = 0 then
    raise exception 'A clínica precisa de pelo menos um administrador ativo.';
  end if;
  return null;
end;
$function$;

comment on function public.exigir_admin_ativo() is
  'Gatilho de clinic_member: a clinica nunca fica sem administrador pleno ativo (o vinculo com a marca de Implementador nao conta, P18-3 de 21/10/2026), inclusive quando alguem exclui o proprio vinculo. Vale ate para a service role. SECURITY DEFINER desde a onda 5: conta pela tabela inteira (admins_plenos_ativos), sem depender da RLS de quem mexe na equipe.';

-- ---------------------------------------------------------------------------
-- 6) As RPCs da tela (papel e marca na mesma transacao)
-- ---------------------------------------------------------------------------

create function public.entrar_como_implementador(
  p_clinic_id uuid,
  p_user_id uuid,
  p_situacao_lida text default null,
  p_papel_lido text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_resultado text;
begin
  if p_clinic_id is null or p_user_id is null then
    raise exception using errcode = '22004', message = 'argumento_nulo';
  end if;
  if not public.user_e_admin_pleno(p_clinic_id) then
    raise exception 'Somente um administrador da clínica marca o implementador.'
      using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não altera o próprio papel.';
  end if;

  if p_situacao_lida is null then
    if p_papel_lido is not null then
      raise exception using errcode = '22023', message = 'situacao_invalida';
    end if;
    -- Convite: o vinculo nasce administrador ativo (o convite e nominal).
    -- Vinculo que ja existe: 23505, como no convite de sempre.
    insert into public.clinic_member (clinic_id, user_id, role, status)
    values (p_clinic_id, p_user_id, 'admin', 'ativo');
    v_resultado := 'convidado';
  elsif p_situacao_lida not in ('pendente', 'ativo') then
    raise exception using errcode = '22023', message = 'situacao_invalida';
  elsif p_papel_lido is null
        or p_papel_lido not in ('admin', 'gestor', 'recepcao', 'profissional', 'leitura') then
    raise exception using errcode = '22023', message = 'papel_invalido';
  elsif p_situacao_lida = 'pendente' then
    -- Pedido de entrada pelo codigo: liberado como administrador.
    update public.clinic_member
       set status = 'ativo', role = 'admin'
     where clinic_id = p_clinic_id
       and user_id = p_user_id
       and status = 'pendente'
       and role = p_papel_lido;
    if not found then
      raise exception using errcode = 'P0001', message = 'papel_mudou';
    end if;
    v_resultado := 'liberado';
  elsif p_papel_lido <> 'admin' then
    update public.clinic_member
       set role = 'admin'
     where clinic_id = p_clinic_id
       and user_id = p_user_id
       and status = 'ativo'
       and role = p_papel_lido;
    if not found then
      raise exception using errcode = 'P0001', message = 'papel_mudou';
    end if;
    v_resultado := 'promovido';
  else
    if not exists (
      select 1 from public.clinic_member m
       where m.clinic_id = p_clinic_id
         and m.user_id = p_user_id
         and m.status = 'ativo'
         and m.role = 'admin'
    ) then
      raise exception using errcode = 'P0001', message = 'papel_mudou';
    end if;
    v_resultado := 'marcado';
  end if;

  if exists (
    select 1 from public.membro_implementador i
     where i.clinic_id = p_clinic_id
       and i.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ja_e_implementador';
  end if;

  insert into public.membro_implementador (clinic_id, user_id)
  values (p_clinic_id, p_user_id);
  return v_resultado;
end;
$$;

revoke all on function public.entrar_como_implementador(uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.entrar_como_implementador(uuid, uuid, text, text)
  to authenticated;

comment on function public.entrar_como_implementador(uuid, uuid, text, text) is
  'Faz da pessoa o Implementador da clinica, com o papel e a marca na mesma transacao (SECURITY INVOKER: a RLS e os gatilhos decidem). Sem vinculo lido (situacao e papel nulos): convite, o vinculo nasce admin ativo (convidado). Pendente: liberado como admin (liberado). Ativo com outro papel: vira admin (promovido). Ativo admin: so a marca (marcado). O vinculo so muda se esta como a tela leu: senao P0001 papel_mudou. P0001 ja_e_implementador; 22023 situacao_invalida e papel_invalido; 22004 argumento_nulo; 42501 para quem nao e administrador pleno. So authenticated.';

create function public.deixar_de_ser_implementador(
  p_clinic_id uuid,
  p_user_id uuid,
  p_papel_novo text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_clinic_id is null or p_user_id is null or p_papel_novo is null then
    raise exception using errcode = '22004', message = 'argumento_nulo';
  end if;
  if not public.user_e_admin_pleno(p_clinic_id) then
    raise exception 'Somente um administrador da clínica tira a marca de implementador.'
      using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não altera o próprio papel.';
  end if;
  if p_papel_novo not in ('admin', 'gestor', 'recepcao', 'profissional', 'leitura') then
    raise exception using errcode = '22023', message = 'papel_invalido';
  end if;

  if p_papel_novo = 'admin' then
    -- Vira administrador pleno: so a marca sai.
    delete from public.membro_implementador i
     where i.clinic_id = p_clinic_id
       and i.user_id = p_user_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'papel_mudou';
    end if;
  else
    -- Outro papel: a marca sai pelo gatilho limpar_marca_de_implementador.
    update public.clinic_member m
       set role = p_papel_novo
     where m.clinic_id = p_clinic_id
       and m.user_id = p_user_id
       and m.role = 'admin'
       and exists (
         select 1 from public.membro_implementador i
          where i.clinic_id = m.clinic_id
            and i.user_id = m.user_id
       );
    if not found then
      raise exception using errcode = 'P0001', message = 'papel_mudou';
    end if;
  end if;
end;
$$;

revoke all on function public.deixar_de_ser_implementador(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.deixar_de_ser_implementador(uuid, uuid, text)
  to authenticated;

comment on function public.deixar_de_ser_implementador(uuid, uuid, text) is
  'Tira a marca de Implementador (SECURITY INVOKER: a RLS e os gatilhos decidem). Papel novo admin: so a marca sai (vira administrador pleno). Outro papel: o role troca e a marca sai pelo gatilho limpar_marca_de_implementador. P0001 papel_mudou se a pessoa nao e mais implementadora; 22023 papel_invalido; 22004 argumento_nulo; 42501 para quem nao e administrador pleno. So authenticated.';
