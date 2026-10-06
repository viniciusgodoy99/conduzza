-- ---------------------------------------------------------------------------
-- Agente de IA: liberacao pela tela (Fase 3, 06/10/2026)
-- ---------------------------------------------------------------------------
-- Decisao do dono em 05/10/2026: a liberacao da IA (ligar na clinica,
-- escolher o numero e cadastrar os telefones da equipe) passa a ser feita
-- numa aba de Configuracoes ("Agente de IA") que so existe na teste123 e na
-- Conduzza Teste. Quem altera: o ADMINISTRADOR ativo dessas duas clinicas e o
-- super admin. Gestor e os demais papeis so leem. O interruptor geral
-- continua so do super admin. Contrato em
-- scratchpad/fase3/contrato-openai-e-aba.md, Frente B.
--
-- O que muda (so funcoes e policies; nenhuma linha nova, nada liga):
--   1) Guarda novo ia_exigir_quem_libera(p_clinic_id) nas tres RPCs por
--      clinica (definir_liberacao_da_ia, definir_numero_da_ia,
--      definir_contato_liberado_da_ia). Passam, como antes, o super admin, a
--      service role e o SQL editor; e passa a passar o administrador ATIVO
--      da propria clinica quando ela esta em ia_clinicas_da_fase_controlada()
--      ou e e_de_teste (as suites de teste). Gestor, recepcao, profissional,
--      leitura, pendente, administrador de OUTRA clinica, administrador de
--      clinica fora da lista e anon: 42501. O corpo das tres RPCs e o da
--      migration 20261006100000 linha a linha, com o guarda trocado e, em
--      definir_numero_da_ia, UM NUMERO POR VEZ: ligar um numero desliga os
--      outros da clinica na mesma chamada (mesma transacao, debaixo do FOR
--      UPDATE da linha da clinica), com uma linha de trilha por numero
--      desligado. Desligar nao mexe nos outros.
--      definir_interruptor_da_ia NAO muda: continua com
--      ia_exigir_equipe_conduzza (so super admin, SQL editor ou service
--      role). T3a (gatilho ia_liberacao_so_na_lista) tambem nao muda: fora da
--      lista e sem e_de_teste, nem a service role liga.
--   2) Leitura para a tela: policies de SELECT em ia_liberacao,
--      ia_numero_liberado e ia_contato_liberado para o ADMINISTRADOR ou o
--      GESTOR ativo da propria clinica quando ela esta na lista ou e
--      e_de_teste (funcao ia_membro_ve_a_liberacao; sao os papeis que chegam
--      a Configuracoes). Recepcao, profissional e leitura nao leem pela API.
--      O super admin continua lendo tudo pelas policies do E0. ia_interruptor
--      e ia_uso continuam so do super admin; nenhuma policy de escrita nasce
--      (a escrita e so pelas RPCs). ia_contato_liberado guarda telefone da
--      EQUIPE, nao de paciente.
--   3) ia_interruptor_ligado(): so o booleano do interruptor geral, para a
--      tela mostrar o estado a quem nao e super admin.
--
-- O administrador liga a liberacao da clinica dele, mas a IA so age com o
-- interruptor geral (super admin) e as travas de ambiente T1 e T2 (Vercel,
-- lib/ia/liberacao.ts) tambem ligados. ia_pode_atender e ia_desligar nao
-- mudam.
--
-- Erros: 42501 (guarda), os demais como no E0. Nunca 40001/40P01. Nenhuma
-- mensagem leva telefone.
--
-- Locks: CREATE OR REPLACE FUNCTION e CREATE POLICY nas tres tabelas frias da
-- liberacao (0 linhas em 05/10/2026). Nenhum ALTER, nenhuma tabela quente.
--
-- ROLLBACK (manual, nesta ordem): drop policy "gestao le a liberacao da ia"
-- on ia_liberacao, "gestao le os numeros liberados para a ia" on
-- ia_numero_liberado e "gestao le os telefones liberados para a ia" on
-- ia_contato_liberado; drop function ia_membro_ve_a_liberacao(uuid) e
-- ia_interruptor_ligado(); recriar definir_liberacao_da_ia,
-- definir_numero_da_ia e definir_contato_liberado_da_ia com o corpo e o
-- comentario de 20261006100000 (perform public.ia_exigir_equipe_conduzza()
-- no lugar de perform public.ia_exigir_quem_libera(p_clinic_id); em
-- definir_numero_da_ia, sem o bloco que desliga os outros numeros); drop
-- function ia_exigir_quem_libera(uuid). Antes do rollback, a tela (aba
-- Agente de IA) precisa sair do ar: sem as policies ela le zero linhas e
-- mostraria a clinica como desligada.

-- ---------------------------------------------------------------------------
-- 1) Guarda das RPCs por clinica
-- ---------------------------------------------------------------------------
-- Interna (sem execute para ninguem): roda dentro das RPCs security definer.
-- Sem sessao (auth.uid() nulo): so service role ou conexao direta (SQL
-- editor); anon recebe 42501. Com sessao: super admin, ou administrador
-- ativo da clinica informada quando ela esta na lista fechada ou e
-- e_de_teste. user_has_role confere o vinculo ativo (pendente e inativo nao
-- passam) e o papel 'admin' (gestor nao passa: decisao do dono).

create function public.ia_exigir_quem_libera(p_clinic_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente o administrador da clínica ou a equipe do Conduzza libera a IA.';
    end if;
    return;
  end if;
  if public.is_product_admin() then
    return;
  end if;
  if p_clinic_id is not null
     and public.user_has_role(p_clinic_id, array['admin'])
     and exists (
       select 1
         from public.clinic c
        where c.id = p_clinic_id
          and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
     )
  then
    return;
  end if;
  raise exception using errcode = '42501',
    message = 'Somente o administrador da clínica ou a equipe do Conduzza libera a IA.';
end;
$$;

revoke all on function public.ia_exigir_quem_libera(uuid)
  from public, anon, authenticated, service_role;

comment on function public.ia_exigir_quem_libera(uuid) is
  'Interna. Guarda das RPCs de liberacao por clinica: passa o super admin, a service role, o SQL editor e o administrador ATIVO da propria clinica quando ela esta em ia_clinicas_da_fase_controlada() ou e e_de_teste. 42501 para os demais (gestor, outros papeis, pendente, outra clinica, clinica fora da lista) e para anon. O interruptor geral usa ia_exigir_equipe_conduzza.';

-- ---------------------------------------------------------------------------
-- 2) As tres RPCs por clinica, com o guarda novo
-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20261006100000; muda a primeira linha (o guarda) e, em
-- definir_numero_da_ia, o bloco "um numero por vez". CREATE OR REPLACE
-- mantem dono e grants; o revoke e o grant abaixo repetem os do E0 para o
-- arquivo ser lido sozinho.

create or replace function public.definir_liberacao_da_ia(
  p_clinic_id uuid,
  p_liberada boolean,
  p_modo text default null,
  p_motivo text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or p_liberada is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e se a IA fica liberada.';
  end if;
  if p_modo is not null and p_modo not in ('simulador', 'contatos') then
    raise exception using errcode = '22023',
      message = 'Modo inválido: use simulador ou contatos.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception using errcode = '22023',
      message = 'O motivo tem no máximo 500 caracteres.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002',
      message = 'Clínica não encontrada.';
  end if;

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- UPDATE antes do INSERT (nunca upsert): o ON CONFLICT dispara o gatilho
  -- de INSERT (T3a) mesmo com a linha existente, e desligar tem de passar.
  update public.ia_liberacao l
     set liberada = p_liberada,
         modo = coalesce(p_modo, l.modo),
         motivo = v_motivo,
         alterado_por = auth.uid()
   where l.clinic_id = p_clinic_id;
  if not found then
    insert into public.ia_liberacao (clinic_id, modo, liberada, motivo, alterado_por)
    values (p_clinic_id, coalesce(p_modo, 'simulador'), p_liberada, v_motivo, auth.uid());
  end if;

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_liberacao', p_clinic_id);

  return p_liberada;
end;
$$;

revoke all on function public.definir_liberacao_da_ia(uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.definir_liberacao_da_ia(uuid, boolean, text, text)
  to authenticated, service_role;

comment on function public.definir_liberacao_da_ia(uuid, boolean, text, text) is
  'Libera ou desliga a IA numa clinica (T3b) e escolhe o modo (simulador ou contatos; nulo mantem o atual, ou simulador na criacao). So clinicas da lista fechada ou e_de_teste (T3a, 42501). Devolve para a equipe as conversas que perderam a liberacao (ia_desligar). Quem chama: super admin, SQL editor, service role ou o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

create or replace function public.definir_numero_da_ia(
  p_clinic_id uuid,
  p_whatsapp_account_id uuid,
  p_ativo boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or p_whatsapp_account_id is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o número e se ele fica liberado.';
  end if;

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  -- Um numero por vez nesta fase: ligar este desliga os outros da clinica,
  -- na mesma transacao e debaixo da mesma trava (duas chamadas ao mesmo
  -- tempo, cada uma ligando um numero, terminam com um so: a segunda espera
  -- o commit da primeira e desliga o dela). Se a gravacao deste numero falhar
  -- adiante (23503 de outra clinica, 23514 removido), tudo volta junto e os
  -- outros continuam como estavam. Uma linha de trilha por numero desligado.
  if p_ativo then
    with desligados as (
      update public.ia_numero_liberado n
         set ativo = false,
             alterado_por = auth.uid()
       where n.clinic_id = p_clinic_id
         and n.whatsapp_account_id <> p_whatsapp_account_id
         and n.ativo
      returning n.whatsapp_account_id
    )
    insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
    select p_clinic_id, auth.uid(), 'editou', 'ia_numero_liberado', d.whatsapp_account_id
      from desligados d;
  end if;

  update public.ia_numero_liberado n
     set clinic_id = p_clinic_id,
         ativo = p_ativo,
         alterado_por = auth.uid()
   where n.whatsapp_account_id = p_whatsapp_account_id;
  if not found then
    insert into public.ia_numero_liberado (whatsapp_account_id, clinic_id, ativo, alterado_por)
    values (p_whatsapp_account_id, p_clinic_id, p_ativo, auth.uid());
  end if;

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_numero_liberado', p_whatsapp_account_id);

  return p_ativo;
end;
$$;

revoke all on function public.definir_numero_da_ia(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.definir_numero_da_ia(uuid, uuid, boolean)
  to authenticated, service_role;

comment on function public.definir_numero_da_ia(uuid, uuid, boolean) is
  'Libera ou desliga um numero de WhatsApp para a IA (T4). Um numero por vez: ligar desliga os outros numeros da clinica na mesma transacao (uma linha de trilha por numero desligado); desligar nao mexe nos outros. Exige a clinica liberada antes (23503), numero da mesma clinica (23503) e nao removido ao ligar (23514); com erro, nada muda. Desligar devolve as conversas do numero para a equipe. Quem chama: super admin, SQL editor, service role ou o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

create or replace function public.definir_contato_liberado_da_ia(
  p_clinic_id uuid,
  p_telefone_e164 text,
  p_rotulo text,
  p_ativo boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telefone text := btrim(p_telefone_e164);
  v_chave text;
  v_rotulo text := nullif(btrim(p_rotulo), '');
  v_id uuid;
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or v_telefone is null or p_ativo is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o telefone e se ele fica liberado.';
  end if;
  if v_telefone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023',
      message = 'Telefone inválido: use o formato internacional, por exemplo +5585999990000.';
  end if;
  if char_length(v_rotulo) > 80 then
    raise exception using errcode = '22023',
      message = 'O rótulo tem no máximo 80 caracteres.';
  end if;
  v_chave := public.chave_telefone(v_telefone);

  -- Trava a linha da clinica ate o commit (corrida com a sessao, secao 9 do E0).
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

  update public.ia_contato_liberado k
     set ativo = p_ativo,
         rotulo = coalesce(v_rotulo, k.rotulo),
         alterado_por = auth.uid()
   where k.clinic_id = p_clinic_id
     and k.phone_key = v_chave
  returning k.id into v_id;
  if not found then
    insert into public.ia_contato_liberado (clinic_id, phone_key, rotulo, ativo, alterado_por)
    values (p_clinic_id, v_chave, v_rotulo, p_ativo, auth.uid())
    returning id into v_id;
  end if;

  perform public.ia_desligar(array[p_clinic_id]);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou', 'ia_contato_liberado', v_id);

  return p_ativo;
end;
$$;

revoke all on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean)
  to authenticated, service_role;

comment on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean) is
  'Libera ou desliga um telefone (da equipe) para a IA conversar (T5). Normaliza com chave_telefone (com e sem o nono digito sao a mesma linha). Exige a clinica liberada antes (23503); telefone fora do E.164 ou rotulo acima de 80 caracteres dao 22023. Desligar devolve as conversas desse telefone para a equipe. Quem chama: super admin, SQL editor, service role ou o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

-- ---------------------------------------------------------------------------
-- 3) Leitura pela tela: administrador ou gestor ativo da propria clinica
-- ---------------------------------------------------------------------------
-- So os papeis que chegam a Configuracoes (administrador, que altera, e
-- gestor, que ve a aba so leitura). Recepcao, profissional e leitura nao
-- leem as tabelas da liberacao pela API, nem a da propria clinica.
-- Security definer porque a policy roda com o papel da sessao, que nao
-- executa ia_clinicas_da_fase_controlada() nem precisa ler clinic_member
-- inteiro. Devolve so verdadeiro ou falso para a clinica informada: falso
-- para quem nao e administrador ou gestor ativo dela (pendente e inativo
-- inclusive), para clinica fora da lista que nao e e_de_teste e para anon
-- (que nem executa).

create function public.ia_membro_ve_a_liberacao(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clinic c
      join public.clinic_member m on m.clinic_id = c.id
     where c.id = p_clinic_id
       and m.user_id = auth.uid()
       and m.status = 'ativo'
       and m.role in ('admin', 'gestor')
       and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
  )
$$;

revoke all on function public.ia_membro_ve_a_liberacao(uuid)
  from public, anon, authenticated;
grant execute on function public.ia_membro_ve_a_liberacao(uuid)
  to authenticated, service_role;

comment on function public.ia_membro_ve_a_liberacao(uuid) is
  'Para as policies de leitura da liberacao da IA (aba Agente de IA de Configuracoes): verdadeiro so para o administrador ou o gestor ATIVO da clinica informada quando ela esta em ia_clinicas_da_fase_controlada() ou e e_de_teste. Recepcao, profissional, leitura, pendente e inativo: falso.';

create policy "gestao le a liberacao da ia"
  on public.ia_liberacao
  for select to authenticated
  using (public.ia_membro_ve_a_liberacao(clinic_id));

create policy "gestao le os numeros liberados para a ia"
  on public.ia_numero_liberado
  for select to authenticated
  using (public.ia_membro_ve_a_liberacao(clinic_id));

create policy "gestao le os telefones liberados para a ia"
  on public.ia_contato_liberado
  for select to authenticated
  using (public.ia_membro_ve_a_liberacao(clinic_id));

-- ---------------------------------------------------------------------------
-- 4) Estado do interruptor geral para a tela
-- ---------------------------------------------------------------------------
-- So o booleano (nem motivo, nem quem mudou). Sem a linha: falso (falha
-- fechada, como ia_liberacao_vigente). A escrita continua so por
-- definir_interruptor_da_ia.

create function public.ia_interruptor_ligado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select i.ligado from public.ia_interruptor i where i.id), false)
$$;

revoke all on function public.ia_interruptor_ligado()
  from public, anon, authenticated;
grant execute on function public.ia_interruptor_ligado()
  to authenticated, service_role;

comment on function public.ia_interruptor_ligado() is
  'Para a tela: o interruptor geral da IA (T6) esta ligado? So o booleano; sem a linha, falso. Qualquer autenticado le; so definir_interruptor_da_ia muda.';
