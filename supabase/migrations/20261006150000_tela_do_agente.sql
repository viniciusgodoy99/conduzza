-- ---------------------------------------------------------------------------
-- Tela 6 (Agente de IA): configuracao, publicacao e versoes (06/10/2026)
-- ---------------------------------------------------------------------------
-- Plano aprovado pelo dono em 06/10/2026 (scratchpad/agente/plano.md) e
-- especificacao da leva (scratchpad/agente/especificacao.md, secao 2).
-- Decisoes do dono que mexem no banco:
--   - "Instrucoes do assistente": texto livre de ate 2.000 caracteres por
--     clinica que SO a equipe do Conduzza (super admin) escreve e le. A
--     sessao nao tem grant nenhum na coluna; leitura e escrita so pelas RPCs
--     instrucoes_do_agente e definir_instrucoes_do_agente. O motor (service
--     role) le a coluna direto. As travas do CFM continuam no filtro de saida
--     (E1), nunca aqui;
--   - so nas clinicas da fase controlada (teste123 e Conduzza Teste): fora
--     delas, nem a service role grava configuracao nem base (clinica
--     e_de_teste passa, para as suites, como no E0);
--   - administrador e gestor (com escrita) configuram e publicam; o super
--     admin edita tudo; recepcao, profissional e leitura nao gravam.
--
-- O que faz, na ordem do arquivo:
--   1. ai_agent_config ganha instrucoes (<= 2000) e conhecimento (a base
--      congelada na publicacao: [{id, pergunta, resposta}] dos itens ATIVOS,
--      na ordem de criacao), limites espelhando LIMITES_DO_AGENTE
--      (lib/domain/agente/config.ts: nome 40, saudacao e encerramento 300) e
--      o indice unico parcial "um rascunho por clinica".
--      knowledge_item (a base viva, que e o rascunho da base) ganha os
--      limites de pergunta (200) e resposta (600).
--   2. Trava da fase controlada (gatilho agente_so_na_fase_controlada nas
--      DUAS tabelas, antes de qualquer outro gatilho delas): INSERT ou UPDATE
--      de clinica fora de ia_clinicas_da_fase_controlada() e sem e_de_teste
--      da 42501 para QUALQUER papel (service role e super admin inclusive).
--      Unica excecao: a FK on delete set null do autor (published_by ou
--      created_by), quando a pessoa sai de auth.users e so o carimbo vira
--      nulo.
--   3. proteger_versao_publicada_do_agente: published_by passa a ser
--      coalesce(auth.uid(), GUC conduzza.agente_publicado_por), a GUC local
--      que SO publicar_agente liga (o PostgREST nao expoe set_config), no
--      padrao de conduzza.agendada_pelo_sistema. A publicada continua
--      imutavel (P0001), menos a mesma FK on delete set null do autor (antes,
--      apagar uma pessoa que publicou dava P0001 e travava a exclusao).
--   4. Grants e policies. SELECT da sessao em ai_agent_config passa a ser
--      por coluna (todas menos instrucoes): a tela le com colunas explicitas,
--      nunca select *. A sessao deixa de mudar version (o banco calcula) e
--      deixa de criar e de apagar versao (sem INSERT nem DELETE, sem as
--      policies de criar e de apagar): o rascunho so nasce por
--      garantir_rascunho_do_agente (que copia as instrucoes da publicada) e
--      so deixa de ser rascunho ao publicar. Assim quem nao e super admin
--      nao zera as instrucoes recriando o rascunho por fora. A policy de
--      editar o rascunho ganha o super admin ("edita tudo"), alem de
--      administrador e gestor com escrita; membro ativo continua lendo.
--   5. RPCs (security definer, search_path vazio, nomes qualificados):
--      garantir_rascunho_do_agente (admin ou gestor com escrita, super admin
--      ou servidor), instrucoes_do_agente e definir_instrucoes_do_agente (so
--      super admin ou servidor), publicar_agente (SO service role: a Server
--      Action roda o filtro de conformidade em TS antes, passa o autor da
--      sessao e o carimbo do que conferiu; a RPC recusa com CZ409 se o
--      rascunho ou a base mudaram depois), restaurar_versao_do_agente (admin
--      ou gestor com escrita, super admin ou servidor; o que esta fora da
--      versao restaurada fica DESATIVADO, nunca apagado). Todas travam a
--      clinica com uma trava consultiva (ai_agent_config:<clinica>) e gravam
--      audit_log sem texto.
--   6. Gasto reservado antes da chamada ao modelo: ia_uso ganha reserva, e
--      reservar_gasto_da_ia e acertar_gasto_da_ia (SO service role) fazem o
--      teto valer para chamadas simultaneas da mesma clinica.
--
-- Versao: o rascunho nasce com max(version) + 1 da clinica; ao publicar,
-- vira a maior publicada + 1 (versoes publicadas em sequencia, na ordem de
-- publicacao, mesmo que um rascunho antigo tenha sido inserido pelo sistema
-- com outro numero). A ultima publicada e a de maior version.
--
-- Erros: 42501 (papel ou clinica fora da fase), 22004 (argumento nulo),
-- 22023 (tamanho; lista de gasto invalida), P0001 (publicada imutavel),
-- P0002 (sem rascunho para publicar; versao ou reserva nao encontrada),
-- 23514 (CHECK) e CZ409 (corrida: outro rascunho nasceu no mesmo instante,
-- ou o agente mudou entre a conferencia do filtro e a publicacao). Nunca
-- 40001 nem 40P01 (o PostgREST repete esses sem limite). Nenhuma mensagem
-- de erro, audit_log ou comentario leva texto da configuracao, da base ou
-- de paciente.
--
-- LOCKS: so tabelas frias, com 0 linhas em 06/10/2026 e que nenhum codigo de
-- producao le ou grava ainda (as duas da configuracao e ia_uso, que so o
-- simulador desta leva grava), pegas logo abaixo em ACCESS EXCLUSIVE, nesta
-- ordem. Nenhuma FK nova, nenhum ALTER em tabela quente. O lock_timeout
-- curto faz a migration cair (55P03, nada gravado) em vez de enfileirar
-- escritas: tentar de novo.
--
-- ROLLBACK manual, nesta ordem:
--   0. ANTES, publicar o codigo sem a Tela 6 nova e sem o simulador (as
--      actions chamam as RPCs daqui e leem conhecimento).
--   1. drop function public.restaurar_versao_do_agente(uuid, integer),
--      public.publicar_agente(uuid, uuid, timestamptz),
--      public.definir_instrucoes_do_agente(uuid, text),
--      public.instrucoes_do_agente(uuid),
--      public.garantir_rascunho_do_agente(uuid),
--      public.agente_garantir_rascunho(uuid),
--      public.agente_exigir_equipe_conduzza(),
--      public.agente_exigir_quem_configura(uuid),
--      public.reservar_gasto_da_ia(uuid, text, bigint),
--      public.acertar_gasto_da_ia(uuid, jsonb);
--   2. drop trigger agente_so_na_fase_controlada on public.ai_agent_config
--      e on public.knowledge_item; drop function
--      public.agente_so_na_fase_controlada(),
--      public.agente_exigir_fase_controlada(uuid);
--   3. rodar supabase/operacao/rollback/20261006150000-corpos-anteriores.sql
--      (o corpo ANTERIOR de proteger_versao_publicada_do_agente, as policies
--      e os grants anteriores, lidos da producao). Ele apaga a coluna
--      instrucoes ANTES de devolver o SELECT de tabela: as instrucoes nunca
--      ficam legiveis para a sessao no meio do caminho;
--   4. drop index public.ai_agent_config_um_rascunho; alter table
--      public.ai_agent_config drop constraint ai_agent_config_nome_tamanho,
--      drop constraint ai_agent_config_saudacao_tamanho, drop constraint
--      ai_agent_config_encerramento_tamanho, drop column conhecimento; alter
--      table public.knowledge_item drop constraint
--      knowledge_item_pergunta_tamanho, drop constraint
--      knowledge_item_resposta_tamanho; alter table public.ia_uso drop column
--      reserva (reserva que sobrar continua somando no teto como uma linha
--      de modelo 'reserva' ate sair da janela de 24 horas: conservador);
--   5. notify pgrst, 'reload schema'.
--   As linhas de ai_agent_config e knowledge_item ficam (as publicadas
--   perdem a base congelada e as instrucoes junto com as colunas).
-- ---------------------------------------------------------------------------

set local lock_timeout = '3s';

-- Ordem fixa (cabecalho, LOCKS).
lock table public.ai_agent_config in access exclusive mode;
lock table public.knowledge_item in access exclusive mode;
lock table public.ia_uso in access exclusive mode;

-- ---------------------------------------------------------------------------
-- 1) Colunas, limites e um rascunho por clinica
-- ---------------------------------------------------------------------------

alter table public.ai_agent_config
  add column instrucoes text
    constraint ai_agent_config_instrucoes_tamanho
      check (instrucoes is null or char_length(instrucoes) <= 2000),
  add column conhecimento jsonb not null default '[]'::jsonb
    constraint ai_agent_config_conhecimento_lista
      check (jsonb_typeof(conhecimento) = 'array'),
  add constraint ai_agent_config_nome_tamanho
    check (char_length(agent_name) <= 40),
  add constraint ai_agent_config_saudacao_tamanho
    check (greeting is null or char_length(greeting) <= 300),
  add constraint ai_agent_config_encerramento_tamanho
    check (closing is null or char_length(closing) <= 300);

-- Duas criacoes ao mesmo tempo: a segunda da 23505 aqui (a RPC traduz
-- para CZ409).
create unique index ai_agent_config_um_rascunho
  on public.ai_agent_config (clinic_id)
  where status = 'rascunho';

alter table public.knowledge_item
  add constraint knowledge_item_pergunta_tamanho
    check (char_length(question) <= 200),
  add constraint knowledge_item_resposta_tamanho
    check (char_length(answer) <= 600);

comment on column public.ai_agent_config.instrucoes is
  'Instrucoes do assistente: texto livre de ate 2.000 caracteres que SO a equipe do Conduzza (super admin) escreve e le, pelas RPCs instrucoes_do_agente e definir_instrucoes_do_agente. A sessao nao tem grant nenhum nesta coluna; o motor (service role) le direto. Vai ao modelo entre marcadores, como dado; as travas do CFM ficam no filtro de saida.';
comment on column public.ai_agent_config.conhecimento is
  'Base de conhecimento congelada na publicacao: [{id, pergunta, resposta}] dos itens ATIVOS de knowledge_item, na ordem de criacao (publicar_agente). No rascunho fica [] (a base do rascunho e a viva, knowledge_item). A sessao le; so publicar_agente grava.';

-- ---------------------------------------------------------------------------
-- 2) Trava da fase controlada (as duas tabelas)
-- ---------------------------------------------------------------------------
-- Interna (sem execute para ninguem): roda dentro do gatilho e das RPCs
-- security definer. Mesma regra de ia_liberacao_so_na_lista (T3a): clinica
-- da lista fechada ou e_de_teste; clinica inexistente tambem nao passa.

create function public.agente_exigir_fase_controlada(p_clinic_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.clinic c
     where c.id = p_clinic_id
       and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
  ) then
    raise exception using errcode = '42501',
      message = 'O agente de IA ainda não está disponível nesta clínica.';
  end if;
end;
$$;

revoke all on function public.agente_exigir_fase_controlada(uuid)
  from public, anon, authenticated, service_role;

comment on function public.agente_exigir_fase_controlada(uuid) is
  'Interna. 42501 quando a clinica nao esta em ia_clinicas_da_fase_controlada() nem e e_de_teste (ou nao existe). Usada pelo gatilho agente_so_na_fase_controlada e pelas RPCs do agente.';

-- security definer: a sessao nao executa ia_clinicas_da_fase_controlada()
-- e o gatilho dispara na escrita direta dela (PostgREST). tg_argv[0] e a
-- coluna de autor com FK on delete set null (published_by em
-- ai_agent_config, created_by em knowledge_item): quando a pessoa sai de
-- auth.users, o Postgres faz um UPDATE que so anula o carimbo, e isso passa
-- mesmo fora da fase (senao a exclusao da pessoa travava). A sessao nao tem
-- grant nessas colunas, entao nao chega nessa excecao.
create function public.agente_so_na_fase_controlada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo jsonb;
  v_velho jsonb;
begin
  if tg_op = 'UPDATE' then
    v_novo := to_jsonb(new);
    v_velho := to_jsonb(old);
    if v_novo ->> tg_argv[0] is null
       and v_velho ->> tg_argv[0] is not null
       and (v_novo - tg_argv[0]) = (v_velho - tg_argv[0])
    then
      return new;
    end if;
  end if;
  perform public.agente_exigir_fase_controlada(new.clinic_id);
  return new;
end;
$$;

revoke all on function public.agente_so_na_fase_controlada()
  from public, anon, authenticated, service_role;

comment on function public.agente_so_na_fase_controlada() is
  'Gatilho BEFORE INSERT OR UPDATE de ai_agent_config e knowledge_item: 42501 para clinica fora de ia_clinicas_da_fase_controlada() e sem e_de_teste, para QUALQUER papel. Unica excecao: o UPDATE da FK on delete set null que so anula a coluna de autor (tg_argv[0]).';

-- O nome comeca com "a" de proposito: gatilhos BEFORE do mesmo evento rodam
-- em ordem alfabetica, e este vem antes de proteger_versao_publicada_do_agente
-- e de set_updated_at.
create trigger agente_so_na_fase_controlada
  before insert or update on public.ai_agent_config
  for each row execute function public.agente_so_na_fase_controlada('published_by');

create trigger agente_so_na_fase_controlada
  before insert or update on public.knowledge_item
  for each row execute function public.agente_so_na_fase_controlada('created_by');

-- ---------------------------------------------------------------------------
-- 3) Publicada imutavel, com o autor da publicacao pelo servidor
-- ---------------------------------------------------------------------------
-- Mesmo corpo do E0 (20261006100000), com duas mudancas: published_by =
-- coalesce(auth.uid(), GUC conduzza.agente_publicado_por), porque
-- publicar_agente roda pela service role (auth.uid() nulo) e recebe o autor
-- da sessao; e a excecao da FK on delete set null do autor na publicada.
-- CREATE OR REPLACE mantem dono, grants e o gatilho.

create or replace function public.proteger_versao_publicada_do_agente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'publicada' then
    -- Unica mudanca aceita: a pessoa que publicou saiu de auth.users e a FK
    -- (on delete set null) anula o carimbo. Todo o resto e P0001.
    if new.published_by is null
       and old.published_by is not null
       and (to_jsonb(new) - 'published_by') = (to_jsonb(old) - 'published_by')
    then
      return new;
    end if;
    raise exception using errcode = 'P0001',
      message = 'Versão publicada não muda: crie uma nova versão.';
  end if;
  if new.status = 'publicada' then
    new.published_at := now();
    new.published_by := coalesce(
      auth.uid(),
      nullif(current_setting('conduzza.agente_publicado_por', true), '')::uuid
    );
  else
    new.published_at := null;
    new.published_by := null;
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_versao_publicada_do_agente()
  from public, anon, authenticated;

comment on function public.proteger_versao_publicada_do_agente() is
  'Gatilho de ai_agent_config: a publicada nao muda (P0001 para qualquer papel), salvo a FK on delete set null de published_by. Ao publicar carimba published_at = now() e published_by = coalesce(auth.uid(), GUC conduzza.agente_publicado_por), que so publicar_agente liga; no rascunho zera os dois.';

-- ---------------------------------------------------------------------------
-- 4) Grants e policies
-- ---------------------------------------------------------------------------
-- REVOKE de tabela tira tambem os grants por coluna do mesmo privilegio:
-- primeiro o revoke, depois o grant por coluna (todas menos instrucoes).
-- UPDATE ja era por coluna (E0) e nao inclui instrucoes, conhecimento,
-- status nem os carimbos. version sai do UPDATE da sessao: quem numera e o
-- banco (garantir e publicar). INSERT (por coluna, do E0) e DELETE (de
-- tabela) saem inteiros: um rascunho criado por fora nascia com instrucoes
-- nulas, e apagar o rascunho jogava fora as do super admin. O rascunho so
-- nasce por garantir_rascunho_do_agente e so deixa de ser rascunho ao
-- publicar; as RPCs sao security definer e nao dependem destes grants.

revoke select on table public.ai_agent_config from authenticated;
grant select (
  id, clinic_id, version, status, agent_name, tone, use_emoji, greeting,
  closing, skills, operating_mode, fallback_minutes, operating_hours,
  escalation_rules, conhecimento, published_at, published_by, created_at,
  updated_at
) on table public.ai_agent_config to authenticated;
revoke update (version) on table public.ai_agent_config from authenticated;
revoke insert, delete on table public.ai_agent_config from authenticated;

drop policy "membro ativo le a configuracao do agente" on public.ai_agent_config;
drop policy "gestao cria versao do agente" on public.ai_agent_config;
drop policy "gestao edita rascunho do agente" on public.ai_agent_config;
drop policy "gestao apaga rascunho do agente" on public.ai_agent_config;

create policy "membro ativo le a configuracao do agente"
  on public.ai_agent_config
  for select to authenticated
  using (
    clinic_id in (select public.user_active_clinic_ids())
    or public.is_product_admin()
  );

create policy "gestao edita rascunho do agente"
  on public.ai_agent_config
  for update to authenticated
  using (
    status = 'rascunho'
    and (
      (public.user_has_role(clinic_id, array['admin', 'gestor'])
       and public.user_can_write(clinic_id))
      or public.is_product_admin()
    )
  )
  with check (
    (public.user_has_role(clinic_id, array['admin', 'gestor'])
     and public.user_can_write(clinic_id))
    or public.is_product_admin()
  );

drop policy "membro ativo le a base de conhecimento" on public.knowledge_item;
drop policy "gestao cria item de conhecimento" on public.knowledge_item;
drop policy "gestao edita item de conhecimento" on public.knowledge_item;
drop policy "gestao apaga item de conhecimento" on public.knowledge_item;

create policy "membro ativo le a base de conhecimento"
  on public.knowledge_item
  for select to authenticated
  using (
    clinic_id in (select public.user_active_clinic_ids())
    or public.is_product_admin()
  );

create policy "gestao cria item de conhecimento"
  on public.knowledge_item
  for insert to authenticated
  with check (
    (public.user_has_role(clinic_id, array['admin', 'gestor'])
     and public.user_can_write(clinic_id))
    or public.is_product_admin()
  );

create policy "gestao edita item de conhecimento"
  on public.knowledge_item
  for update to authenticated
  using (
    (public.user_has_role(clinic_id, array['admin', 'gestor'])
     and public.user_can_write(clinic_id))
    or public.is_product_admin()
  )
  with check (
    (public.user_has_role(clinic_id, array['admin', 'gestor'])
     and public.user_can_write(clinic_id))
    or public.is_product_admin()
  );

create policy "gestao apaga item de conhecimento"
  on public.knowledge_item
  for delete to authenticated
  using (
    (public.user_has_role(clinic_id, array['admin', 'gestor'])
     and public.user_can_write(clinic_id))
    or public.is_product_admin()
  );

comment on table public.ai_agent_config is
  'Configuracao do agente de IA por versao (3.1 e Tela 6). status rascunho (um por clinica, indice ai_agent_config_um_rascunho) ou publicada (imutavel, P0001). So clinicas da fase controlada ou e_de_teste (gatilho agente_so_na_fase_controlada, 42501 ate para a service role). Membro ativo e super admin leem, por coluna: instrucoes so pelas RPCs do super admin. A sessao nao cria nem apaga versao: o rascunho nasce so por garantir_rascunho_do_agente. Administrador e gestor com escrita, e o super admin, editam o rascunho; publicar e so publicar_agente (service role, depois do filtro de conformidade), que congela a base em conhecimento e carimba o autor.';
comment on table public.knowledge_item is
  'Base de conhecimento viva do agente (perguntas e respostas da clinica; e o rascunho da base, congelado em ai_agent_config.conhecimento ao publicar). Pergunta ate 200 e resposta ate 600 caracteres. source manual, correcao_humana ou documento. So clinicas da fase controlada ou e_de_teste (gatilho agente_so_na_fase_controlada). Membro ativo e super admin leem; administrador e gestor com escrita, e o super admin, escrevem. created_by e o default auth.uid() (a sessao nao grava a coluna).';

-- ---------------------------------------------------------------------------
-- 5) RPCs
-- ---------------------------------------------------------------------------

-- Guarda de quem configura (interna, sem execute para ninguem). Sem sessao
-- (auth.uid() nulo): so service role ou conexao direta (SQL editor); anon
-- recebe 42501. Com sessao: super admin, ou administrador ou gestor ATIVO
-- da clinica com escrita (a mesma regra das policies).
create function public.agente_exigir_quem_configura(p_clinic_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente o administrador ou o gestor da clínica configura o agente de IA.';
    end if;
    return;
  end if;
  if public.is_product_admin() then
    return;
  end if;
  if p_clinic_id is not null
     and public.user_has_role(p_clinic_id, array['admin', 'gestor'])
     and public.user_can_write(p_clinic_id)
  then
    return;
  end if;
  raise exception using errcode = '42501',
    message = 'Somente o administrador ou o gestor da clínica configura o agente de IA.';
end;
$$;

revoke all on function public.agente_exigir_quem_configura(uuid)
  from public, anon, authenticated, service_role;

comment on function public.agente_exigir_quem_configura(uuid) is
  'Interna. Passa o super admin, a service role, o SQL editor e o administrador ou gestor ATIVO da clinica com escrita. 42501 para os demais (recepcao, profissional, leitura, pendente, outra clinica) e para anon.';

-- Guarda das instrucoes (interna): so a equipe do Conduzza. Sem sessao, so
-- service role ou SQL editor.
create function public.agente_exigir_equipe_conduzza()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe Conduzza mexe nas instruções do assistente.';
    end if;
    return;
  end if;
  if not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe Conduzza mexe nas instruções do assistente.';
  end if;
end;
$$;

revoke all on function public.agente_exigir_equipe_conduzza()
  from public, anon, authenticated, service_role;

comment on function public.agente_exigir_equipe_conduzza() is
  'Interna. 42501 para sessao que nao e super admin e para anon; passa o super admin, a service role e o SQL editor. Guarda das instrucoes do assistente.';

-- Nucleo de garantir (interno, sem guarda de papel: quem chama ja conferiu).
-- Trava a clinica (consultiva, ate o fim da transacao) e devolve o rascunho;
-- sem rascunho, cria um copiando a ultima publicada (com as instrucoes; a
-- base do rascunho e a viva) ou com os padroes da tabela, com version =
-- max + 1 da clinica. A trava serializa garantir, publicar, restaurar e
-- definir instrucoes da mesma clinica (a sessao nao cria versao); um INSERT
-- direto do sistema nao a pega, e o indice de um rascunho por clinica barra
-- a corrida (CZ409).
create function public.agente_garantir_rascunho(p_clinic_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_versao integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ai_agent_config:' || p_clinic_id::text, 0)
  );

  select a.id into v_id
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'rascunho';
  if found then
    return v_id;
  end if;

  select coalesce(max(a.version), 0) + 1 into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id;

  begin
    insert into public.ai_agent_config (
      clinic_id, version, agent_name, tone, use_emoji, greeting, closing,
      skills, operating_mode, fallback_minutes, operating_hours,
      escalation_rules, instrucoes
    )
    select p_clinic_id, v_versao, a.agent_name, a.tone, a.use_emoji,
           a.greeting, a.closing, a.skills, a.operating_mode,
           a.fallback_minutes, a.operating_hours, a.escalation_rules,
           a.instrucoes
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
       and a.status = 'publicada'
     order by a.version desc
     limit 1
    returning id into v_id;

    if v_id is null then
      insert into public.ai_agent_config (clinic_id, version)
      values (p_clinic_id, v_versao)
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'CZ409',
      message = 'O agente de IA foi alterado ao mesmo tempo por outra pessoa. Tente de novo.';
  end;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'criou_rascunho_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$$;

revoke all on function public.agente_garantir_rascunho(uuid)
  from public, anon, authenticated, service_role;

comment on function public.agente_garantir_rascunho(uuid) is
  'Interna (sem guarda de papel). Trava a clinica (consultiva ai_agent_config:<clinica>) e devolve o rascunho; sem rascunho, cria um copiando a ultima publicada (inclusive instrucoes) ou os padroes, com version = max + 1, e grava audit_log criou_rascunho_do_agente. Corrida com um INSERT direto do sistema: CZ409.';

create function public.garantir_rascunho_do_agente(p_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_clinic_id is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica.';
  end if;
  perform public.agente_exigir_quem_configura(p_clinic_id);
  perform public.agente_exigir_fase_controlada(p_clinic_id);
  return public.agente_garantir_rascunho(p_clinic_id);
end;
$$;

revoke all on function public.garantir_rascunho_do_agente(uuid)
  from public, anon, authenticated;
grant execute on function public.garantir_rascunho_do_agente(uuid)
  to authenticated, service_role;

comment on function public.garantir_rascunho_do_agente(uuid) is
  'Devolve o id do rascunho do agente da clinica; sem rascunho, cria um a partir da ultima publicada (ou dos padroes) com version calculada no banco. Administrador ou gestor ativo com escrita, super admin ou servidor (42501 para os demais); clinica da fase controlada ou e_de_teste (42501). Grava audit_log quando cria.';

create function public.instrucoes_do_agente(p_clinic_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.agente_exigir_equipe_conduzza();
  if p_clinic_id is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica.';
  end if;
  return (
    select a.instrucoes
      from public.ai_agent_config a
     where a.clinic_id = p_clinic_id
     order by (a.status = 'rascunho') desc, a.version desc
     limit 1
  );
end;
$$;

revoke all on function public.instrucoes_do_agente(uuid)
  from public, anon, authenticated;
grant execute on function public.instrucoes_do_agente(uuid)
  to authenticated, service_role;

comment on function public.instrucoes_do_agente(uuid) is
  'Instrucoes do assistente do rascunho da clinica (ou da ultima publicada, sem rascunho; nulo sem nenhuma versao). So super admin ou servidor (42501 para os demais).';

create function public.definir_instrucoes_do_agente(
  p_clinic_id uuid,
  p_instrucoes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instrucoes text := nullif(btrim(p_instrucoes), '');
  v_id uuid;
begin
  perform public.agente_exigir_equipe_conduzza();
  if p_clinic_id is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica.';
  end if;
  if char_length(v_instrucoes) > 2000 then
    raise exception using errcode = '22023',
      message = 'As instruções do assistente têm no máximo 2.000 caracteres.';
  end if;
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  v_id := public.agente_garantir_rascunho(p_clinic_id);
  update public.ai_agent_config
     set instrucoes = v_instrucoes
   where id = v_id;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'editou_instrucoes_do_agente', 'ai_agent_config', v_id);
end;
$$;

revoke all on function public.definir_instrucoes_do_agente(uuid, text)
  from public, anon, authenticated;
grant execute on function public.definir_instrucoes_do_agente(uuid, text)
  to authenticated, service_role;

comment on function public.definir_instrucoes_do_agente(uuid, text) is
  'Grava as instrucoes do assistente no rascunho da clinica (garante o rascunho; vazio vira nulo; acima de 2.000 caracteres da 22023). So super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501). Grava audit_log sem o texto. O filtro de conformidade roda na Server Action antes.';

-- So service role: a Server Action confere sessao, papel e clinica, roda o
-- filtro de conformidade (lib/domain/conformidade) em todo texto e chama
-- esta RPC com o cliente admin, o autor da sessao e p_conferido_em. O autor
-- e conferido de novo aqui (administrador ou gestor ativo da clinica, ou
-- super admin).
-- p_conferido_em e o carimbo do que o filtro conferiu: o MAIOR updated_at
-- entre o rascunho e TODOS os itens de knowledge_item da clinica (ativos e
-- inativos), exatamente como a action os leu (o texto do PostgREST ou um
-- Date do JS; a comparacao e em milissegundos, porque o Date corta os
-- microssegundos). Nunca now(): o carimbo e o que prova que o conteudo
-- congelado e o conferido. Aqui, com a trava da clinica e o rascunho em
-- FOR UPDATE, o carimbo e recalculado no MESMO comando que monta a base
-- congelada (um so retrato): se ficou maior, alguem escreveu depois da
-- conferencia (pela tela ou direto pela API) e a publicacao e recusada com
-- CZ409, sem congelar nada. Apagar item sem mexer em outro pode baixar o
-- maior updated_at e passa: tirar conteudo nao cria problema no filtro.
-- Resta uma janela de microssegundos: uma escrita cuja transacao comecou
-- antes da leitura da action e terminou depois leva updated_at = now() do
-- comeco dela (set_updated_at) e pode ficar abaixo do carimbo.
create function public.publicar_agente(
  p_clinic_id uuid,
  p_autor uuid,
  p_conferido_em timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_rascunho_em timestamptz;
  v_base_em timestamptz;
  v_versao integer;
  v_ativos integer;
  v_conhecimento jsonb;
  v_antes text;
begin
  if p_clinic_id is null or p_autor is null or p_conferido_em is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, quem publica e o que foi conferido.';
  end if;
  if not exists (
       select 1
         from public.clinic_member m
        where m.clinic_id = p_clinic_id
          and m.user_id = p_autor
          and m.status = 'ativo'
          and m.role in ('admin', 'gestor')
     )
     and not exists (
       select 1 from public.product_admin pa where pa.user_id = p_autor
     )
  then
    raise exception using errcode = '42501',
      message = 'Somente o administrador ou o gestor da clínica publica o agente de IA.';
  end if;
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  perform pg_advisory_xact_lock(
    hashtextextended('ai_agent_config:' || p_clinic_id::text, 0)
  );

  select a.id, a.updated_at into v_id, v_rascunho_em
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'rascunho'
   for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Não há alterações para publicar.';
  end if;

  -- Um comando so: o carimbo da base e a base congelada saem do mesmo
  -- retrato (cabecalho da funcao).
  select max(k.updated_at),
         count(*) filter (where k.active),
         coalesce(
           jsonb_agg(
             jsonb_build_object('id', k.id, 'pergunta', k.question, 'resposta', k.answer)
             order by k.created_at, k.id
           ) filter (where k.active),
           '[]'::jsonb
         )
    into v_base_em, v_ativos, v_conhecimento
    from public.knowledge_item k
   where k.clinic_id = p_clinic_id;

  if date_trunc('milliseconds', greatest(v_rascunho_em, v_base_em))
     > date_trunc('milliseconds', p_conferido_em)
  then
    raise exception using errcode = 'CZ409',
      message = 'O agente mudou enquanto você publicava. Confira e publique de novo.';
  end if;

  if v_ativos > 60 then
    raise exception using errcode = '22023',
      message = 'A base tem mais de 60 perguntas ativas. Desative ou exclua algumas antes de publicar.';
  end if;

  select coalesce(max(a.version), 0) + 1 into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada';

  -- O gatilho carimba published_at e published_by (da GUC: aqui auth.uid()
  -- e nulo). A GUC vale so ate o fim deste UPDATE.
  v_antes := current_setting('conduzza.agente_publicado_por', true);
  perform set_config('conduzza.agente_publicado_por', p_autor::text, true);
  update public.ai_agent_config
     set status = 'publicada',
         version = v_versao,
         conhecimento = v_conhecimento
   where id = v_id;
  perform set_config('conduzza.agente_publicado_por', coalesce(v_antes, ''), true);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, p_autor, 'publicou_agente', 'ai_agent_config', v_id);

  return jsonb_build_object('versao', v_versao);
end;
$$;

revoke all on function public.publicar_agente(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.publicar_agente(uuid, uuid, timestamptz)
  to service_role;

comment on function public.publicar_agente(uuid, uuid, timestamptz) is
  'Publica o rascunho do agente: congela em conhecimento os itens ATIVOS de knowledge_item (ate 60; acima, 22023), vira publicada com version = maior publicada + 1 e o gatilho carimba published_at e published_by = p_autor. p_autor tem de ser administrador ou gestor ativo da clinica, ou super admin (42501). p_conferido_em: o maior updated_at entre o rascunho e todos os itens de knowledge_item da clinica, como a Server Action os leu ao rodar o filtro; se o recalculado sob a trava for maior (em milissegundos), CZ409 e nada e publicado. Sem rascunho: P0002. Argumento nulo: 22004. Clinica da fase controlada ou e_de_teste (42501). Devolve {versao}. SO service role: a Server Action roda o filtro de conformidade antes. Grava audit_log publicou_agente no nome do autor.';

create function public.restaurar_versao_do_agente(p_clinic_id uuid, p_versao integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origem public.ai_agent_config%rowtype;
  v_id uuid;
begin
  if p_clinic_id is null or p_versao is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e a versão.';
  end if;
  perform public.agente_exigir_quem_configura(p_clinic_id);
  perform public.agente_exigir_fase_controlada(p_clinic_id);

  select * into v_origem
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.version = p_versao
     and a.status = 'publicada';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Versão não encontrada.';
  end if;

  v_id := public.agente_garantir_rascunho(p_clinic_id);

  update public.ai_agent_config
     set agent_name = v_origem.agent_name,
         tone = v_origem.tone,
         use_emoji = v_origem.use_emoji,
         greeting = v_origem.greeting,
         closing = v_origem.closing,
         skills = v_origem.skills,
         operating_mode = v_origem.operating_mode,
         fallback_minutes = v_origem.fallback_minutes,
         operating_hours = v_origem.operating_hours,
         escalation_rules = v_origem.escalation_rules,
         instrucoes = v_origem.instrucoes
   where id = v_id;

  -- A base viva passa a valer como a congelada daquela versao, sem apagar
  -- nada: o item ativo que nao esta nela fica DESATIVADO (guardado, como a
  -- tela promete; os ja desativados ficam como estao), volta com a mesma id
  -- o que foi excluido, e o que esta nela fica com o texto dela e ativo.
  update public.knowledge_item k
     set active = false
   where k.clinic_id = p_clinic_id
     and k.active
     and not exists (
       select 1
         from jsonb_array_elements(v_origem.conhecimento) e
        where (e ->> 'id')::uuid = k.id
     );

  insert into public.knowledge_item as k (id, clinic_id, question, answer, active)
  select (e ->> 'id')::uuid, p_clinic_id, e ->> 'pergunta', e ->> 'resposta', true
    from jsonb_array_elements(v_origem.conhecimento) e
  on conflict (id) do update
     set question = excluded.question,
         answer = excluded.answer,
         active = true
   where k.clinic_id = excluded.clinic_id
     and (k.question, k.answer, k.active)
         is distinct from (excluded.question, excluded.answer, true);

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'restaurou_versao_do_agente', 'ai_agent_config', v_id);

  return v_id;
end;
$$;

revoke all on function public.restaurar_versao_do_agente(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.restaurar_versao_do_agente(uuid, integer)
  to authenticated, service_role;

comment on function public.restaurar_versao_do_agente(uuid, integer) is
  'O rascunho (garantido) passa a ter os campos da versao publicada p_versao, inclusive as instrucoes, e a base viva (knowledge_item) passa a valer como a base congelada dela: mesmas ids, ativas e com o texto dela (a excluida volta); o item fora dela fica desativado, nunca apagado. Administrador ou gestor ativo com escrita, super admin ou servidor (42501); clinica da fase controlada ou e_de_teste (42501); versao inexistente ou nao publicada: P0002. Devolve o id do rascunho. Grava audit_log.';

-- ---------------------------------------------------------------------------
-- 6) Gasto reservado antes da chamada ao modelo (ia_uso)
-- ---------------------------------------------------------------------------
-- O teto diario (ia_liberacao_vigente) so via ia_uso dos turnos que ja
-- terminaram: N simulacoes ao mesmo tempo passavam todas e o teto estourava
-- em N turnos. Agora, antes de cada turno, o servidor reserva o custo
-- MAXIMO estimado (reservar_gasto_da_ia): sob uma trava consultiva por
-- clinica (ia_uso:<clinica>), a soma das ultimas 24 horas MAIS o pedido e
-- conferida contra o teto e, se cabe, entra uma linha de reserva em ia_uso,
-- que ja soma no teto para as proximas. No fim do turno (ou no erro),
-- acertar_gasto_da_ia troca a reserva pelas linhas reais, numa transacao
-- so. Reserva nao acertada (o processo morreu) continua somando ate sair da
-- janela de 24 horas: conservador. Uma trava de transacao numa RPC so dura
-- a RPC, por isso a reserva fica gravada, e nao a trava.

alter table public.ia_uso
  add column reserva boolean not null default false;

comment on column public.ia_uso.reserva is
  'Linha de reserva (reservar_gasto_da_ia): o custo MAXIMO estimado de um turno, gravado antes da chamada ao modelo para o teto valer com chamadas simultaneas (papel agente, modelo reserva, tokens 0). acertar_gasto_da_ia a troca pelas linhas reais; sem acerto, continua somando no teto (conservador).';

-- So service role. origem 'simulador' confere as travas de ia_pode_simular
-- (modos simulador e contatos); 'whatsapp', as do modo contatos (o numero e
-- o contato ficam com ia_pode_atender, antes). NULL quando a clinica nao
-- pode gastar agora: o pedido passaria do teto, ou a liberacao caiu entre a
-- conferencia do servidor e a reserva (o motivo exato vem de
-- ia_pode_simular, que o servidor chama antes). Mesma comparacao estrita de
-- ia_liberacao_vigente (gasto < teto): com a reserva feita, a trava continua
-- verdadeira durante o turno que a reservou.
create function public.reservar_gasto_da_ia(
  p_clinic_id uuid,
  p_origem text,
  p_custo_microdolar bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modos text[];
  v_teto bigint;
  v_gasto bigint;
  v_id uuid;
begin
  if p_clinic_id is null or p_origem is null or p_custo_microdolar is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, a origem e o custo.';
  end if;
  if p_custo_microdolar < 0 then
    raise exception using errcode = '22023',
      message = 'O custo reservado não pode ser negativo.';
  end if;
  v_modos := case p_origem
    when 'simulador' then array['simulador', 'contatos']
    when 'whatsapp' then array['contatos']
  end;
  if v_modos is null then
    raise exception using errcode = '22023',
      message = 'Origem de gasto inválida: use simulador ou whatsapp.';
  end if;

  -- Cada comando abaixo le o que ja foi gravado antes da trava (READ
  -- COMMITTED: retrato novo por comando; a funcao nao e stable de
  -- proposito).
  perform pg_advisory_xact_lock(
    hashtextextended('ia_uso:' || p_clinic_id::text, 0)
  );

  if not public.ia_liberacao_vigente(p_clinic_id, v_modos) then
    return null;
  end if;

  select l.teto_diario_centavos_usd::bigint * 10000 into v_teto
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;

  select coalesce(sum(u.custo_microdolar), 0) into v_gasto
    from public.ia_uso u
   where u.clinic_id = p_clinic_id
     and u.created_at >= now() - interval '24 hours';

  if v_gasto + p_custo_microdolar >= v_teto then
    return null;
  end if;

  insert into public.ia_uso (clinic_id, origem, papel, modelo, custo_microdolar, reserva)
  values (p_clinic_id, p_origem, 'agente', 'reserva', p_custo_microdolar, true)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.reservar_gasto_da_ia(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.reservar_gasto_da_ia(uuid, text, bigint)
  to service_role;

comment on function public.reservar_gasto_da_ia(uuid, text, bigint) is
  'Reserva o custo maximo estimado de um turno (microdolar) antes de chamar o modelo. Sob trava consultiva por clinica, confere as travas de ia_liberacao_vigente (origem simulador: modos simulador e contatos; whatsapp: contatos) e o gasto das ultimas 24 horas MAIS o pedido contra o teto (estrito, como a trava); se cabe, grava uma linha de reserva em ia_uso e devolve o id dela, senao NULL (nada gravado). Argumento nulo: 22004; custo negativo ou origem invalida: 22023. SO service role.';

-- So service role. p_linhas: a lista de linhas que lib/agente/uso.ts monta
-- (LinhaDoUso: clinic_id, conversation_id, job_id, origem, papel, modelo,
-- tokens_entrada, tokens_saida, tokens_cache_lidos, tokens_cache_gravados,
-- custo_microdolar), uma por chamada ao modelo; lista vazia so desfaz a
-- reserva. clinic_id e origem saem da reserva (se vierem na linha, tem de
-- ser os mesmos). Apaga a reserva e grava as linhas na mesma transacao:
-- quem soma o gasto ve uma ou outra, nunca as duas nem nenhuma. Qualquer
-- erro desfaz tudo e a reserva fica (conservador). Sem trava: a troca e
-- atomica, e o gasto real acima da reserva so fecha a proxima.
create function public.acertar_gasto_da_ia(p_reserva uuid, p_linhas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinica uuid;
  v_origem text;
begin
  if p_reserva is null or p_linhas is null then
    raise exception using errcode = '22004',
      message = 'Informe a reserva e as linhas do gasto.';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 50 then
    raise exception using errcode = '22023',
      message = 'As linhas do gasto vêm numa lista de até 50.';
  end if;

  delete from public.ia_uso u
   where u.id = p_reserva
     and u.reserva
  returning u.clinic_id, u.origem into v_clinica, v_origem;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Reserva de gasto não encontrada.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_linhas) as l(clinic_id uuid, origem text)
     where l.clinic_id <> v_clinica
        or l.origem <> v_origem
  ) then
    raise exception using errcode = '22023',
      message = 'Linha de gasto de outra clínica ou de outra origem.';
  end if;

  insert into public.ia_uso (
    clinic_id, conversation_id, job_id, origem, papel, modelo,
    tokens_entrada, tokens_saida, tokens_cache_lidos, tokens_cache_gravados,
    custo_microdolar
  )
  select v_clinica, l.conversation_id, l.job_id, v_origem, l.papel, l.modelo,
         coalesce(l.tokens_entrada, 0), coalesce(l.tokens_saida, 0),
         coalesce(l.tokens_cache_lidos, 0), coalesce(l.tokens_cache_gravados, 0),
         l.custo_microdolar
    from jsonb_to_recordset(p_linhas) as l(
      conversation_id uuid,
      job_id uuid,
      papel text,
      modelo text,
      tokens_entrada integer,
      tokens_saida integer,
      tokens_cache_lidos integer,
      tokens_cache_gravados integer,
      custo_microdolar bigint
    );
end;
$$;

revoke all on function public.acertar_gasto_da_ia(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.acertar_gasto_da_ia(uuid, jsonb)
  to service_role;

comment on function public.acertar_gasto_da_ia(uuid, jsonb) is
  'Troca a reserva p_reserva (reservar_gasto_da_ia) pelas linhas reais do turno, na mesma transacao. p_linhas: lista (ate 50) no formato de LinhaDoUso de lib/agente/uso.ts; clinic_id e origem vem da reserva (diferentes na linha: 22023); lista vazia so desfaz a reserva. Reserva inexistente ou ja acertada: P0002. Argumento nulo: 22004. Qualquer erro deixa a reserva (conservador). Nada de texto. SO service role.';
