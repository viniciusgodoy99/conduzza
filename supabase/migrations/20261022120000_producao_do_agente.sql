-- ---------------------------------------------------------------------------
-- Producao do agente de IA: estados, modo, requisitos e pausa (onda 2,
-- item 11)
-- ---------------------------------------------------------------------------
-- Plano aprovado pelo dono em 20/10/2026; contrato entre as frentes em
-- ~/.claude/plans/onda2-agente/contrato.md, secao 3. Decisoes do dono de 20
-- e 21/10/2026: P11c (a producao e ligada so pela equipe Conduzza no painel,
-- com o checklist; a clinica pausa e retoma sozinha; revogar um requisito
-- devolve as clinicas a teste), P11d (o termo da clinica e a correcao da
-- transcricao de audio entram no checklist), P11e (a rodada do CFM fica
-- registrada com a versao do filtro e do modelo na evidencia). Vem DEPOIS da
-- 20261022110000 (M2): parte dos corpos que ela deixa em
-- ia_atende_no_whatsapp e situacao_da_ia_na_clinica. ESTA MIGRATION SO CRIA
-- A ESTRUTURA: nenhuma clinica entra em producao ao aplicar (o CHECK passa
-- a aceitar o estado; ligar e operacao, pelo painel, com o checklist verde).
--
-- 1. ESTADOS E MODO. ia_clinica_habilitada.estado aceita 'producao';
--    ia_clinicas_da_fase_controlada() passa a ler teste OU producao (mesmo
--    nome e assinatura; as funcoes que a usam continuam iguais).
--    ia_liberacao.modo aceita 'numero_inteiro' (todos os contatos). O
--    gatilho ia_liberacao_so_na_lista recusa (42501, para qualquer papel,
--    service role inclusive) a linha LIBERADA em numero_inteiro de clinica
--    que nao esta em producao (clinica e_de_teste passa: as suites provam o
--    modo no WhatsApp falso). definir_liberacao_da_ia aceita numero_inteiro
--    e ligar exige a equipe Conduzza (como contatos hoje); com a clinica em
--    producao, so ligar numero_inteiro passa (P0001 clinica_em_producao:
--    o modo so muda pelo Painel geral e a clinica para pelo Pausar;
--    revisao da onda 2).
--    definir_agente_da_clinica: producao so com motivo (3 a 300) e todos os
--    requisitos cumpridos (senao P0001 requisitos_pendentes, com as chaves
--    no hint; agente_em_teste e o "so a partir de teste"); grava o estado e,
--    depois dele, liga numero_inteiro pelo caminho de hoje. De producao para
--    teste: modo contatos e ia_desligar (as conversas de quem nao e telefone
--    da equipe voltam para a equipe, sem mensagem ao paciente). desligado
--    como hoje. definir_pausa_da_ia (P11c): a clinica pausa e retoma
--    (ia_liberacao.pausada_pela_clinica, que ja existe e ja e conferida em
--    todas as decisoes); pausar devolve as conversas (ia_desligar); trilhas
--    pausou_a_ia e retomou_a_ia.
--
-- 2. DECISOES (marca [onda 2: producao]): no modo numero_inteiro a lista de
--    telefones e a trava K nao valem; o publico vale nos dois modos (nulo
--    recusa no numero_inteiro, M2). ia_pode_atender, ia_pode_falar_com,
--    ia_atende_no_whatsapp, ia_devolver_disponivel e devolver_para_ia (a
--    recusa contato_de_paciente so no modo contatos); reservar_gasto_da_ia
--    (whatsapp e simulador nos dois modos), ia_pode_simular (o simulador da
--    clinica em producao), ia_estado_do_motor (vigiado com os dois modos);
--    situacao_da_ia_na_clinica ganha a chave modo e, no numero_inteiro, nao
--    lista mais como invalido o telefone que so tem o sinal de paciente (a
--    trava K nao vale nesse modo; revisao da onda 2); painel_geral_das_clinicas
--    ganha totais.agente_em_producao. A ingestao nao muda (o preparo esta
--    na M2).
--
-- 3. A TRAVA DA PRODUCAO. Tabela ia_requisito_da_producao (o que a equipe
--    Conduzza registra: rodada_cfm, contrato_openai,
--    aviso_assistente_virtual, termo_da_clinica, por clinica, e
--    transcricao_com_nossa_chave; clinic_id nulo vale para todas), so o
--    super admin le, escrita so pelas RPCs. registrar_requisito_da_producao
--    (registrar de novo substitui a evidencia viva: a anterior fica
--    revogada com o motivo da substituicao, sem devolver ninguem a teste) e
--    revogar_requisito_da_producao (falha fechada: toda clinica em producao
--    que deixa de cumprir os requisitos volta para teste); so super admin e
--    servidor (42501), com trilha. requisitos_da_producao(clinica):
--    [{chave, ok, detalhe}], os conferidos pelo banco (agente_em_teste,
--    versao_publicada, publico_escolhido, horario_suportado,
--    numero_conectado, conta_ativa, conversao_na_aprovacao) e os da equipe;
--    detalhe e um objeto com origem ('banco' ou 'equipe') e o que a tela
--    mostra (a evidencia viva, ou revogado e o motivo). Registrar, revogar
--    e ligar a producao passam pela mesma trava consultiva
--    (ia_requisito_da_producao), antes da linha de liberacao: uma revogacao
--    em voo nunca deixa uma clinica entrar em producao sem o requisito.
--
-- Funcoes trocadas (corpos lidos da producao por fndef.js em 21/10/2026 e,
-- em ia_atende_no_whatsapp e situacao_da_ia_na_clinica, os da M2; guardados
-- em supabase/operacao/rollback/20261022120000-corpos-anteriores.sql com o
-- md5 do prosrc; o ensaio confere que o banco ainda esta assim):
-- ia_clinicas_da_fase_controlada, ia_liberacao_so_na_lista,
-- definir_liberacao_da_ia, definir_agente_da_clinica, ia_pode_atender,
-- ia_pode_falar_com, ia_atende_no_whatsapp, reservar_gasto_da_ia,
-- ia_pode_simular, ia_estado_do_motor, devolver_para_ia,
-- ia_devolver_disponivel, situacao_da_ia_na_clinica e
-- painel_geral_das_clinicas (CREATE OR REPLACE: security, search_path e
-- grants como eram). Funcoes novas: requisitos_da_producao,
-- registrar_requisito_da_producao, revogar_requisito_da_producao e
-- definir_pausa_da_ia (authenticated e service_role; o guarda de cada uma
-- decide). Erros de regra: P0001 (requisitos_pendentes, sem_liberacao,
-- clinica_suspensa, requisito_ja_revogado), 22023 (estado_invalido,
-- motivo_invalido, chave_invalida, evidencia_invalida,
-- requisito_por_clinica), 22004, P0002 e 42501. Nunca 40001/40P01. Nada
-- aqui grava texto de paciente.
--
-- LOCKS: lock_timeout de 3 s. ACCESS EXCLUSIVE curto em
-- ia_clinica_habilitada (2 linhas) e ia_liberacao (2 linhas), nessa ordem,
-- ate o commit (a decisao da IA de telefone da equipe e o motor da IA
-- esperam milissegundos); a FK nova segura SHARE ROW EXCLUSIVE em clinic
-- ate o commit. Nenhum ALTER em message, conversation, contact,
-- clinic_member, job_queue nem clinic. Horario calmo.
--
-- ORDEM: o codigo que ENTENDE producao e numero_inteiro (o painel e a aba
-- tratam valor desconhecido como erro de leitura) vai antes ou junto;
-- ensaio (~/.claude/plans/onda2-agente/ensaio-20261022120000.sql), esta
-- migration, conferir os md5 novos, os testes de RLS e de integracao, e o
-- resto do codigo do painel e da Tela 6. Ligar a producao numa clinica e
-- operacao, pelo painel, com o checklist verde, nunca antes desse codigo.
--
-- ROLLBACK (manual): toda clinica de producao para teste pelo painel ANTES
-- (o CHECK antigo recusaria a linha); o codigo; depois, numa transacao, no
-- SQL editor, supabase/operacao/rollback/20261022120000-corpos-anteriores.sql
-- (os corpos de antes, as funcoes novas e a tabela saem, os CHECKs voltam).

set local lock_timeout = '3s';

-- ===========================================================================
-- 1. Os estados e o modo (CHECKs), na ordem das travas
-- ===========================================================================

alter table public.ia_clinica_habilitada
  drop constraint ia_clinica_habilitada_estado_valido;
alter table public.ia_clinica_habilitada
  add constraint ia_clinica_habilitada_estado_valido
    check (estado in ('desligado', 'teste', 'producao'));

comment on table public.ia_clinica_habilitada is
  'O agente de IA por clinica: desligado, teste (so os telefones da equipe, modo contatos) ou producao (todos os contatos, modo numero_inteiro, com o publico da versao publicada; onda 2). Sem linha = desligado. ia_clinicas_da_fase_controlada() le daqui as clinicas em teste ou producao, sem as suspensas. Escrita so por definir_agente_da_clinica (super admin; producao so com os requisitos_da_producao cumpridos), com trilha mudou_agente_da_clinica. A sessao le so clinic_id e estado (membro ativo da propria clinica e super admin).';

alter table public.ia_liberacao
  drop constraint ia_liberacao_modo_valido;
alter table public.ia_liberacao
  add constraint ia_liberacao_modo_valido
    check (modo in ('simulador', 'contatos', 'numero_inteiro'));

comment on table public.ia_liberacao is
  'Liberacao da IA por clinica (T3b e T7). So clinicas de ia_clinicas_da_fase_controlada() ou e_de_teste (gatilho ia_liberacao_so_na_lista, 42501 ate para a service role). modo simulador (so a Tela 6), contatos (WhatsApp so com ia_contato_liberado) ou numero_inteiro (todos os contatos; so clinica em producao, onda 2). Escrita por definir_liberacao_da_ia; pausada_pela_clinica so reduz, por definir_pausa_da_ia (a clinica pausa e retoma).';

-- ===========================================================================
-- 2. A trava da producao: os requisitos que a equipe Conduzza registra
-- ===========================================================================

create table public.ia_requisito_da_producao (
  id uuid primary key default gen_random_uuid(),
  chave text not null
    constraint ia_requisito_da_producao_chave_valida
      check (chave in ('rodada_cfm', 'contrato_openai', 'aviso_assistente_virtual',
                       'termo_da_clinica', 'transcricao_com_nossa_chave')),
  -- Nulo = vale para todas as clinicas.
  clinic_id uuid references public.clinic (id) on delete cascade,
  evidencia text not null
    constraint ia_requisito_da_producao_evidencia_tamanho
      check (char_length(btrim(evidencia)) between 3 and 500),
  registrado_em timestamptz not null default now(),
  registrado_por uuid,
  revogado_em timestamptz,
  revogado_por uuid,
  motivo_da_revogacao text
    constraint ia_requisito_da_producao_motivo_tamanho
      check (motivo_da_revogacao is null
             or char_length(btrim(motivo_da_revogacao)) between 3 and 300),
  constraint ia_requisito_da_producao_termo_por_clinica
    check (chave <> 'termo_da_clinica' or clinic_id is not null),
  constraint ia_requisito_da_producao_revogacao_coerente
    check ((revogado_em is null) = (motivo_da_revogacao is null))
);

-- Um requisito vivo por chave e clinica (o geral, de clinic_id nulo,
-- inclusive).
create unique index ia_requisito_da_producao_vivo
  on public.ia_requisito_da_producao (chave, clinic_id) nulls not distinct
  where revogado_em is null;

alter table public.ia_requisito_da_producao enable row level security;

-- So o super admin le; ninguem escreve pela sessao (so as RPCs).
revoke all on table public.ia_requisito_da_producao from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.ia_requisito_da_producao from authenticated;

create policy "super admin le os requisitos da producao"
  on public.ia_requisito_da_producao
  for select to authenticated
  using (public.is_product_admin());

comment on table public.ia_requisito_da_producao is
  'Os requisitos da producao do agente que a equipe Conduzza registra (onda 2, item 11): rodada_cfm (D34, com a versao do filtro e do modelo na evidencia), contrato_openai, aviso_assistente_virtual, termo_da_clinica (por clinica) e transcricao_com_nossa_chave. clinic_id nulo vale para todas. evidencia: o que prova e onde esta guardado (texto da equipe Conduzza, nunca dado de paciente). Revogado nao vale; um vivo por chave e clinica. So o super admin le; escrita so por registrar_requisito_da_producao e revogar_requisito_da_producao, com trilha.';

create function public.requisitos_da_producao(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_versao integer;
  v_publico text;
  v_modo_horario text;
  v_conectados integer;
  v_suspensa boolean;
  v_gatilhos integer;
  v_lista jsonb;
  v_chave text;
  v_vivo record;
  v_revogado record;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza vê os requisitos da produção.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza vê os requisitos da produção.';
  end if;
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  select h.estado into v_estado
    from public.ia_clinica_habilitada h
   where h.clinic_id = p_clinic_id;
  -- A ultima versao publicada (a que vale no WhatsApp).
  select a.version, a.publico_atendido, a.operating_mode
    into v_versao, v_publico, v_modo_horario
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada'
   order by a.version desc
   limit 1;
  -- Numero ligado ao assistente, conectado e nao removido.
  select count(*) into v_conectados
    from public.ia_numero_liberado n
    join public.whatsapp_account w on w.id = n.whatsapp_account_id
   where n.clinic_id = p_clinic_id
     and n.ativo
     and w.clinic_id = p_clinic_id
     and w.removido_em is null
     and w.connection_status = 'conectado';
  v_suspensa := exists (
    select 1 from public.clinica_suspensa s where s.clinic_id = p_clinic_id
  );
  -- Os tres gatilhos da conversao na aprovacao (20261022100000).
  select count(*) into v_gatilhos
    from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.appointment'::regclass
     and not t.tgisinternal
     and t.tgenabled <> 'D'
     and t.tgname in ('avancar_funil_na_aprovacao', 'converter_lead_na_aprovacao',
                      'consulta_pendente_espera_aprovacao');

  -- Os conferidos pelo banco, nesta ordem.
  v_lista := jsonb_build_array(
    jsonb_build_object('chave', 'agente_em_teste',
      'ok', coalesce(v_estado in ('teste', 'producao'), false),
      'detalhe', jsonb_build_object('origem', 'banco', 'estado', coalesce(v_estado, 'desligado'))),
    jsonb_build_object('chave', 'versao_publicada',
      'ok', v_versao is not null,
      'detalhe', jsonb_build_object('origem', 'banco', 'versao', v_versao)),
    jsonb_build_object('chave', 'publico_escolhido',
      'ok', v_publico is not null,
      'detalhe', jsonb_build_object('origem', 'banco', 'publico', v_publico)),
    jsonb_build_object('chave', 'horario_suportado',
      'ok', coalesce(v_modo_horario in ('24h', 'fora_expediente'), false),
      'detalhe', jsonb_build_object('origem', 'banco', 'modo', v_modo_horario)),
    jsonb_build_object('chave', 'numero_conectado',
      'ok', v_conectados > 0,
      'detalhe', jsonb_build_object('origem', 'banco', 'conectados', v_conectados)),
    jsonb_build_object('chave', 'conta_ativa',
      'ok', not v_suspensa,
      'detalhe', jsonb_build_object('origem', 'banco')),
    jsonb_build_object('chave', 'conversao_na_aprovacao',
      'ok', v_gatilhos = 3,
      'detalhe', jsonb_build_object('origem', 'banco'))
  );

  -- Os registrados pela equipe Conduzza: o vivo da clinica (ou o geral);
  -- sem vivo, o ultimo revogado (a tela mostra "Revogado").
  foreach v_chave in array array['rodada_cfm', 'contrato_openai', 'aviso_assistente_virtual',
                                 'termo_da_clinica', 'transcricao_com_nossa_chave'] loop
    select r.id, r.evidencia, r.registrado_em, r.clinic_id
      into v_vivo
      from public.ia_requisito_da_producao r
     where r.chave = v_chave
       and r.revogado_em is null
       and (r.clinic_id = p_clinic_id
            or (r.clinic_id is null and v_chave <> 'termo_da_clinica'))
     order by (r.clinic_id is null), r.registrado_em desc
     limit 1;
    if found then
      v_lista := v_lista || jsonb_build_array(jsonb_build_object(
        'chave', v_chave,
        'ok', true,
        'detalhe', jsonb_build_object(
          'origem', 'equipe',
          'id', v_vivo.id,
          'evidencia', v_vivo.evidencia,
          'registrado_em', v_vivo.registrado_em,
          'geral', v_vivo.clinic_id is null)));
      continue;
    end if;
    select r.id, r.revogado_em, r.motivo_da_revogacao
      into v_revogado
      from public.ia_requisito_da_producao r
     where r.chave = v_chave
       and r.revogado_em is not null
       and (r.clinic_id = p_clinic_id
            or (r.clinic_id is null and v_chave <> 'termo_da_clinica'))
     order by r.revogado_em desc, r.id
     limit 1;
    if found then
      v_lista := v_lista || jsonb_build_array(jsonb_build_object(
        'chave', v_chave,
        'ok', false,
        'detalhe', jsonb_build_object(
          'origem', 'equipe',
          'revogado', true,
          'id', v_revogado.id,
          'revogado_em', v_revogado.revogado_em,
          'motivo_da_revogacao', v_revogado.motivo_da_revogacao)));
    else
      v_lista := v_lista || jsonb_build_array(jsonb_build_object(
        'chave', v_chave,
        'ok', false,
        'detalhe', jsonb_build_object('origem', 'equipe')));
    end if;
  end loop;

  return v_lista;
end;
$$;

revoke all on function public.requisitos_da_producao(uuid) from public, anon;
grant execute on function public.requisitos_da_producao(uuid) to authenticated, service_role;

comment on function public.requisitos_da_producao(uuid) is
  'O checklist da producao do agente numa clinica (onda 2, item 11): [{chave, ok, detalhe}], primeiro os conferidos pelo banco (agente_em_teste, versao_publicada, publico_escolhido, horario_suportado, numero_conectado, conta_ativa, conversao_na_aprovacao), depois os registrados pela equipe Conduzza (rodada_cfm, contrato_openai, aviso_assistente_virtual, termo_da_clinica, transcricao_com_nossa_chave). detalhe: objeto com origem (banco ou equipe) e o que a tela mostra (estado, versao, publico, modo, conectados; ou id, evidencia, registrado_em e geral do vivo; ou revogado, id, revogado_em e motivo_da_revogacao). So super admin, service role e SQL editor (42501); 22004 em nulo; P0002 sem a clinica.';

create function public.registrar_requisito_da_producao(
  p_chave text,
  p_evidencia text,
  p_clinic_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidencia text := nullif(btrim(p_evidencia), '');
  v_anterior uuid;
  v_id uuid;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza registra os requisitos da produção.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza registra os requisitos da produção.';
  end if;
  if p_chave is null or v_evidencia is null then
    raise exception using errcode = '22004',
      message = 'Informe o requisito e a evidência.';
  end if;
  if p_chave not in ('rodada_cfm', 'contrato_openai', 'aviso_assistente_virtual',
                     'termo_da_clinica', 'transcricao_com_nossa_chave') then
    raise exception using errcode = '22023', message = 'chave_invalida';
  end if;
  if char_length(v_evidencia) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'evidencia_invalida',
      hint = 'A evidência tem de 3 a 500 caracteres.';
  end if;
  if p_chave = 'termo_da_clinica' and p_clinic_id is null then
    raise exception using errcode = '22023', message = 'requisito_por_clinica',
      hint = 'O termo da clínica é registrado por clínica.';
  end if;
  if p_clinic_id is not null
     and not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  -- A mesma trava de revogar e de ligar a producao.
  perform pg_advisory_xact_lock(hashtextextended('ia_requisito_da_producao', 0));

  -- Registrar de novo substitui a evidencia viva: a anterior fica revogada
  -- com o motivo da substituicao (o requisito continua cumprido; ninguem
  -- volta a teste).
  update public.ia_requisito_da_producao r
     set revogado_em = now(),
         revogado_por = auth.uid(),
         motivo_da_revogacao = 'Substituído por um registro novo.'
   where r.chave = p_chave
     and r.clinic_id is not distinct from p_clinic_id
     and r.revogado_em is null
  returning r.id into v_anterior;

  insert into public.ia_requisito_da_producao (chave, clinic_id, evidencia, registrado_por)
  values (p_chave, p_clinic_id, v_evidencia, auth.uid())
  returning id into v_id;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'registrou_requisito_da_producao',
          'ia_requisito_da_producao', v_id,
          jsonb_build_object('chave', p_chave, 'geral', p_clinic_id is null,
                             'substituiu', v_anterior));

  return v_id;
end;
$$;

revoke all on function public.registrar_requisito_da_producao(text, text, uuid) from public, anon;
grant execute on function public.registrar_requisito_da_producao(text, text, uuid) to authenticated, service_role;

comment on function public.registrar_requisito_da_producao(text, text, uuid) is
  'Registra um requisito da producao (onda 2, item 11): rodada_cfm, contrato_openai, aviso_assistente_virtual, termo_da_clinica (so por clinica) ou transcricao_com_nossa_chave, com a evidencia (3 a 500); p_clinic_id nulo vale para todas. Registrar de novo substitui a evidencia viva (a anterior fica revogada, sem devolver ninguem a teste). So super admin, service role e SQL editor (42501); 22004, 22023 (chave_invalida, evidencia_invalida, requisito_por_clinica) e P0002. Trilha registrou_requisito_da_producao {chave, geral, substituiu}. Devolve o id.';

create function public.revogar_requisito_da_producao(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_requisito record;
  v_clinica uuid;
  v_motivo_do_teste text;
  v_devolvidas integer := 0;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza revoga os requisitos da produção.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza revoga os requisitos da produção.';
  end if;
  if p_id is null then
    raise exception using errcode = '22004', message = 'Informe o requisito.';
  end if;
  if v_motivo is null or char_length(v_motivo) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem de 3 a 300 caracteres.';
  end if;

  -- A mesma trava de registrar e de ligar a producao.
  perform pg_advisory_xact_lock(hashtextextended('ia_requisito_da_producao', 0));

  select r.chave, r.clinic_id, r.revogado_em
    into v_requisito
    from public.ia_requisito_da_producao r
   where r.id = p_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Requisito não encontrado.';
  end if;
  if v_requisito.revogado_em is not null then
    raise exception using errcode = 'P0001', message = 'requisito_ja_revogado';
  end if;

  update public.ia_requisito_da_producao r
     set revogado_em = now(),
         revogado_por = auth.uid(),
         motivo_da_revogacao = v_motivo
   where r.id = p_id;

  -- Falha fechada (P11c): toda clinica em producao alcancada pelo requisito
  -- (todas, se ele vale para todas) que deixou de cumprir os requisitos
  -- volta para teste. A conta suspensa (fora da lista) volta para teste com
  -- a liberacao desligada: ao reativar, liga pelo painel.
  v_motivo_do_teste := 'Requisito da produção revogado: ' || v_requisito.chave;
  for v_clinica in
    select h.clinic_id
      from public.ia_clinica_habilitada h
     where h.estado = 'producao'
       and (v_requisito.clinic_id is null or h.clinic_id = v_requisito.clinic_id)
     order by h.clinic_id
  loop
    if exists (
      select 1
        from jsonb_array_elements(public.requisitos_da_producao(v_clinica)) as r(item)
       where not coalesce((r.item ->> 'ok')::boolean, false)
    ) then
      if public.clinica_esta_suspensa(v_clinica) then
        perform 1 from public.ia_liberacao l where l.clinic_id = v_clinica for update;
        update public.ia_clinica_habilitada h
           set estado = 'teste',
               alterado_em = now(),
               alterado_por = auth.uid(),
               motivo = v_motivo_do_teste
         where h.clinic_id = v_clinica;
        update public.ia_liberacao l
           set modo = 'contatos',
               liberada = false,
               motivo = v_motivo_do_teste,
               alterado_por = auth.uid()
         where l.clinic_id = v_clinica;
        insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
        values (v_clinica, auth.uid(), 'mudou_agente_da_clinica', 'ia_clinica_habilitada',
                v_clinica, jsonb_build_object('estado', 'teste', 'motivo', v_motivo_do_teste));
      else
        perform public.definir_agente_da_clinica(v_clinica, 'teste', v_motivo_do_teste);
      end if;
      v_devolvidas := v_devolvidas + 1;
    end if;
  end loop;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_requisito.clinic_id, auth.uid(), 'revogou_requisito_da_producao',
          'ia_requisito_da_producao', p_id,
          jsonb_build_object('chave', v_requisito.chave, 'motivo', v_motivo,
                             'clinicas_de_volta_ao_teste', v_devolvidas));

  return jsonb_build_object('clinicas_de_volta_ao_teste', v_devolvidas);
end;
$$;

revoke all on function public.revogar_requisito_da_producao(uuid, text) from public, anon;
grant execute on function public.revogar_requisito_da_producao(uuid, text) to authenticated, service_role;

comment on function public.revogar_requisito_da_producao(uuid, text) is
  'Revoga um requisito da producao (onda 2, item 11), com motivo (3 a 300). Falha fechada (P11c): toda clinica em producao alcancada (todas, se o requisito vale para todas) que deixa de cumprir os requisitos volta para teste (modo contatos e as conversas de quem nao e telefone da equipe para a equipe; a conta suspensa, com a liberacao desligada). So super admin, service role e SQL editor (42501); 22004, 22023 motivo_invalido, P0002 e P0001 requisito_ja_revogado. Trilha revogou_requisito_da_producao {chave, motivo, clinicas_de_volta_ao_teste}. Devolve {clinicas_de_volta_ao_teste}.';

-- ===========================================================================
-- 3. A lista, o gatilho, a liberacao e o agente por clinica
-- ===========================================================================

create or replace function public.ia_clinicas_da_fase_controlada()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  -- [agente por clinica] inicio
  -- Onda 1 (21/10/2026): a lista deixa de ser fixa. As clinicas com o
  -- agente em teste, sem as de conta suspensa, em ordem de id (a lista
  -- fixa de antes, teste123 e Conduzza Teste, ja estava nessa ordem).
  select coalesce(array_agg(h.clinic_id order by h.clinic_id), '{}'::uuid[])
    from public.ia_clinica_habilitada h
   -- [onda 2: producao] inicio
   -- Onda 2 (M3): em teste ou em producao.
   where h.estado in ('teste', 'producao')
   -- [onda 2: producao] fim
     and not exists (
       select 1 from public.clinica_suspensa s where s.clinic_id = h.clinic_id
     )
  -- [agente por clinica] fim
$function$;

comment on function public.ia_clinicas_da_fase_controlada() is
  'As clinicas com o agente de IA em teste ou em producao (ia_clinica_habilitada.estado = ''teste'' ou ''producao'', onda 2), sem as suspensas (clinica_suspensa), em ordem de id. STABLE desde a onda 1 (antes, o array fixo de teste123 e Conduzza Teste). Nenhuma outra clinica ganha linha liberada em ia_liberacao (gatilho ia_liberacao_so_na_lista), salvo clinica e_de_teste. So service_role (e as funcoes do banco).';

create or replace function public.ia_liberacao_so_na_lista()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE'
     and not new.liberada
     and new.clinic_id = old.clinic_id
  then
    return new;
  end if;
  if not exists (
    select 1
      from public.clinic c
     where c.id = new.clinic_id
       and (c.id = any (public.ia_clinicas_da_fase_controlada()) or c.e_de_teste)
  ) then
    raise exception using errcode = '42501',
      message = 'Esta clínica não está na fase controlada da IA.';
  end if;
  -- [onda 2: producao] inicio
  -- Onda 2 (M3): a liberacao em numero_inteiro (todos os contatos) so
  -- vale para clinica em producao (ia_clinica_habilitada), para qualquer
  -- papel, a service role inclusive. Clinica e_de_teste passa (as suites
  -- provam o modo no WhatsApp falso). Desligar continua passando (acima).
  if new.liberada and new.modo = 'numero_inteiro' and not exists (
    select 1
      from public.clinic c
     where c.id = new.clinic_id
       and (c.e_de_teste
            or exists (
              select 1 from public.ia_clinica_habilitada h
               where h.clinic_id = c.id
                 and h.estado = 'producao'
            ))
  ) then
    raise exception using errcode = '42501',
      message = 'Esta clínica não está em produção.';
  end if;
  -- [onda 2: producao] fim
  return new;
end;
$function$;

create or replace function public.definir_liberacao_da_ia(p_clinic_id uuid, p_liberada boolean, p_modo text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  -- [whatsapp so pela equipe] inicio
  v_modo_atual text;
  -- [whatsapp so pela equipe] fim
begin
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or p_liberada is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e se a IA fica liberada.';
  end if;
  -- [onda 2: producao] inicio
  -- Onda 2 (M3): numero_inteiro (todos os contatos), que o gatilho
  -- ia_liberacao_so_na_lista so deixa em clinica em producao.
  if p_modo is not null and p_modo not in ('simulador', 'contatos', 'numero_inteiro') then
    raise exception using errcode = '22023',
      message = 'Modo inválido: use simulador, contatos ou numero_inteiro.';
  end if;
  -- [onda 2: producao] fim
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

  -- [whatsapp so pela equipe] inicio
  -- Nesta fase, so a equipe Conduzza liga o atendimento pelo WhatsApp (E3,
  -- decisao do dono de 13/10/2026). Desligar e "So simulador" continuam com
  -- ia_exigir_quem_libera.
  select l.modo into v_modo_atual
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;
  -- [onda 2: producao] numero_inteiro tambem so pela equipe Conduzza
  if p_liberada and coalesce(p_modo, v_modo_atual, 'simulador') in ('contatos', 'numero_inteiro') then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim
  -- [onda 2: producao] inicio
  -- Com a clinica em producao, o modo e a liberacao so mudam pelo Painel
  -- geral (revisao da onda 2): definir_agente_da_clinica grava o estado
  -- ANTES de chamar esta funcao (de producao para teste ela ja chega aqui
  -- com o estado teste), e aqui so passa ligar numero_inteiro, o proprio
  -- caminho do painel. A clinica para pelo Pausar (definir_pausa_da_ia).
  -- Sem isto, "So simulador" ou "Desligado" pela aba gravavam o modo
  -- com o estado ainda producao (estado e modo divergentes no painel).
  if exists (
       select 1 from public.ia_clinica_habilitada h
        where h.clinic_id = p_clinic_id
          and h.estado = 'producao'
     )
     and not (p_liberada and coalesce(p_modo, v_modo_atual, '') = 'numero_inteiro')
  then
    raise exception using errcode = 'P0001', message = 'clinica_em_producao',
      hint = 'Com o assistente atendendo os contatos, o modo só muda pelo Painel geral.';
  end if;
  -- [onda 2: producao] fim

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
$function$;

comment on function public.definir_liberacao_da_ia(uuid, boolean, text, text) is
  'Libera ou desliga a IA numa clinica (T3b) e escolhe o modo (simulador, contatos ou numero_inteiro, onda 2; nulo mantem o atual, ou simulador na criacao). So clinicas da lista fechada ou e_de_teste (T3a, 42501); numero_inteiro so em clinica em producao (o mesmo gatilho). Ligar contatos ou numero_inteiro so pela equipe Conduzza. Com a clinica em producao, so ligar numero_inteiro passa (o caminho do Painel geral); o resto, P0001 clinica_em_producao (a clinica para pelo Pausar). Devolve para a equipe as conversas que perderam a liberacao (ia_desligar). Quem chama: super admin, SQL editor, service role ou o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

create or replace function public.definir_agente_da_clinica(p_clinic_id uuid, p_estado text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_de_teste boolean;
  -- [onda 2: producao] inicio
  v_pendentes text;
  -- [onda 2: producao] fim
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or p_estado is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e o estado do agente.';
  end if;
  -- [onda 2: producao] inicio
  if p_estado not in ('desligado', 'teste', 'producao') then
    raise exception using errcode = '22023', message = 'estado_invalido',
      hint = 'Use desligado, teste ou producao.';
  end if;
  -- [onda 2: producao] fim
  if char_length(v_motivo) > 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem no máximo 300 caracteres.';
  end if;
  -- [onda 2: producao] inicio
  -- Producao: motivo obrigatorio, de 3 a 300 caracteres.
  if p_estado = 'producao' and coalesce(char_length(v_motivo), 0) < 3 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'Para ligar a produção, o motivo tem de 3 a 300 caracteres.';
  end if;
  -- [onda 2: producao] fim
  select c.e_de_teste into v_de_teste from public.clinic c where c.id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;
  if v_de_teste then
    -- As suites automatizadas ligam a IA das clinicas e_de_teste pelo
    -- caminho delas (definir_liberacao_da_ia); elas nunca entram na lista.
    raise exception using errcode = 'P0001', message = 'clinica_de_teste';
  end if;
  -- [onda 2: producao] teste e producao recusam a conta suspensa
  if p_estado in ('teste', 'producao') and public.clinica_esta_suspensa(p_clinic_id) then
    raise exception using errcode = 'P0001', message = 'clinica_suspensa';
  end if;

  -- [onda 2: producao] inicio
  -- Producao: a trava consultiva dos requisitos ANTES da linha de
  -- liberacao (a mesma ordem de registrar e revogar requisito): uma
  -- revogacao em voo termina antes, e a conferencia abaixo ja a ve.
  if p_estado = 'producao' then
    perform pg_advisory_xact_lock(hashtextextended('ia_requisito_da_producao', 0));
  end if;
  -- [onda 2: producao] fim
  -- A mesma ordem de travas das definir_*_da_ia: a linha de liberacao
  -- primeiro, depois a do estado.
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;
  -- [onda 2: producao] inicio
  -- Producao so a partir de teste e com todos os requisitos cumpridos
  -- (requisitos_da_producao; agente_em_teste e o "so a partir de
  -- teste"). Senao P0001 requisitos_pendentes, com as chaves no hint.
  if p_estado = 'producao' then
    select string_agg(r.item ->> 'chave', ',' order by r.ordem)
      into v_pendentes
      from jsonb_array_elements(public.requisitos_da_producao(p_clinic_id))
             with ordinality as r(item, ordem)
     where not coalesce((r.item ->> 'ok')::boolean, false);
    if v_pendentes is not null then
      raise exception using errcode = 'P0001', message = 'requisitos_pendentes',
        hint = v_pendentes;
    end if;
  end if;
  -- [onda 2: producao] fim

  insert into public.ia_clinica_habilitada as h
    (clinic_id, estado, alterado_em, alterado_por, motivo)
  values (p_clinic_id, p_estado, now(), auth.uid(), v_motivo)
  on conflict (clinic_id) do update
     set estado = excluded.estado,
         alterado_em = excluded.alterado_em,
         alterado_por = excluded.alterado_por,
         motivo = excluded.motivo;

  if p_estado = 'teste' then
    -- A clinica acabou de entrar na lista: fica liberada em modo contatos
    -- (so os telefones da equipe) pelo caminho que ja existe.
    perform public.definir_liberacao_da_ia(p_clinic_id, true, 'contatos', v_motivo);
  -- [onda 2: producao] inicio
  elsif p_estado = 'producao' then
    -- O estado ja gravado (o gatilho ia_liberacao_so_na_lista ve a
    -- producao): liberada em numero_inteiro (todos os contatos, com o
    -- publico da versao publicada) pelo caminho que ja existe. De
    -- producao para teste e o ramo de cima: modo contatos e
    -- ia_desligar (as conversas de quem nao e telefone da equipe voltam
    -- para a equipe, sem mensagem ao paciente).
    perform public.definir_liberacao_da_ia(p_clinic_id, true, 'numero_inteiro', v_motivo);
  -- [onda 2: producao] fim
  else
    -- Fora da lista a IA ja nao atende; a linha de liberacao fica desligada
    -- (o gatilho ia_liberacao_so_na_lista deixa desligar sempre) e as
    -- conversas do agente voltam para a equipe.
    update public.ia_liberacao l
       set liberada = false,
           motivo = v_motivo,
           alterado_por = auth.uid()
     where l.clinic_id = p_clinic_id
       and l.liberada;
    perform public.ia_desligar(array[p_clinic_id]);
  end if;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(), 'mudou_agente_da_clinica', 'ia_clinica_habilitada',
          p_clinic_id, jsonb_build_object('estado', p_estado, 'motivo', v_motivo));
end;
$function$;

comment on function public.definir_agente_da_clinica(uuid, text, text) is
  'O agente de IA da clinica: desligado, teste ou producao (onda 2). So super admin, service role e SQL editor (42501). Clinica e_de_teste: P0001 clinica_de_teste; teste ou producao em conta suspensa: P0001 clinica_suspensa. Teste: a clinica entra na lista e fica liberada em modo contatos (definir_liberacao_da_ia; vindo da producao, as conversas de quem nao e telefone da equipe voltam para a equipe). Producao: so com motivo (3 a 300; 22023 motivo_invalido) e todos os requisitos_da_producao cumpridos (P0001 requisitos_pendentes, com as chaves no hint; agente_em_teste e o so a partir de teste), liberada em numero_inteiro. Desligado: sai da lista, a liberacao fica desligada e as conversas do agente voltam para a equipe. Trilha mudou_agente_da_clinica {estado, motivo}.';

create function public.definir_pausa_da_ia(
  p_clinic_id uuid,
  p_pausada boolean,
  p_motivo text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_antes record;
begin
  -- Administrador ativo da propria clinica habilitada (ou e_de_teste, nas
  -- suites), super admin ou o servidor; o resto, 42501.
  perform public.ia_exigir_quem_libera(p_clinic_id);
  if p_clinic_id is null or p_pausada is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e se o assistente fica pausado.';
  end if;
  if char_length(v_motivo) > 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem no máximo 300 caracteres.';
  end if;

  -- A ordem de travas das definir_*: a linha da clinica.
  select l.pausada_pela_clinica, l.liberada
    into v_antes
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'sem_liberacao';
  end if;
  if v_antes.liberada and public.clinica_esta_suspensa(p_clinic_id) then
    -- A clinica suspensa sai da lista e o gatilho ia_liberacao_so_na_lista
    -- recusaria a linha liberada (42501): a chave da tela no lugar.
    raise exception using errcode = 'P0001', message = 'clinica_suspensa';
  end if;
  if v_antes.pausada_pela_clinica = p_pausada then
    -- Ja estava assim: nada muda, sem trilha.
    return p_pausada;
  end if;

  update public.ia_liberacao l
     set pausada_pela_clinica = p_pausada,
         alterado_por = auth.uid()
   where l.clinic_id = p_clinic_id;

  if p_pausada then
    -- As conversas do assistente voltam para a equipe (evento desligada).
    perform public.ia_desligar(array[p_clinic_id]);
  end if;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (p_clinic_id, auth.uid(),
          case when p_pausada then 'pausou_a_ia' else 'retomou_a_ia' end,
          'ia_liberacao', p_clinic_id,
          case when v_motivo is null then null
               else jsonb_build_object('motivo', v_motivo) end);

  return p_pausada;
end;
$$;

revoke all on function public.definir_pausa_da_ia(uuid, boolean, text) from public, anon;
grant execute on function public.definir_pausa_da_ia(uuid, boolean, text) to authenticated, service_role;

comment on function public.definir_pausa_da_ia(uuid, boolean, text) is
  'A clinica pausa ou retoma o assistente (onda 2, P11c; T7, ia_liberacao.pausada_pela_clinica, conferida em todas as decisoes). Quem chama: administrador ativo da propria clinica habilitada (ou e_de_teste), super admin ou o servidor (ia_exigir_quem_libera; o resto 42501). 22004 em nulo; 22023 motivo_invalido (ate 300); P0001 sem_liberacao e clinica_suspensa. Pausar devolve as conversas do assistente para a equipe (ia_desligar). Trilhas pausou_a_ia e retomou_a_ia {motivo}; sem mudanca, sem trilha. Devolve p_pausada.';

-- ===========================================================================
-- 4. As decisoes: os dois modos do WhatsApp
-- ===========================================================================

create or replace function public.ia_pode_atender(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    -- [onda 2: producao] os dois modos do WhatsApp
    public.ia_liberacao_vigente(p_clinic_id, array['contatos', 'numero_inteiro'])
    -- [clinica suspensa] inicio
    -- Conta suspensa (onda 1, 21/10/2026): conversa nova nao nasce na IA
    -- (a clinica da lista ja sai dela; a e_de_teste, so aqui).
    and not exists (
      select 1 from public.clinica_suspensa s where s.clinic_id = p_clinic_id
    )
    -- [clinica suspensa] fim
    and exists (
      select 1
        from public.ia_numero_liberado n
        join public.whatsapp_account w on w.id = n.whatsapp_account_id
       where n.whatsapp_account_id = p_whatsapp_account_id
         and n.clinic_id = p_clinic_id
         and n.ativo
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
         -- clinica e_de_teste fora da lista: so o WhatsApp falso
         and (p_clinic_id = any (public.ia_clinicas_da_fase_controlada())
              or w.provider = 'fake')
    )
    -- [onda 2: producao] inicio
    -- A lista de telefones so e exigida no modo contatos.
    and (
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = p_clinic_id
           and l.modo = 'numero_inteiro'
      )
      or
    -- [onda 2: producao] fim
    exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_phone_key))
         and k.ativo
    )
    -- [onda 2: producao] inicio
    )
    -- [onda 2: producao] fim
    ,
    false
  )
$function$;

comment on function public.ia_pode_atender(uuid, uuid, text) is
  'A IA pode atender este telefone (phone_key, ou o E.164, que vira a chave) neste numero desta clinica? Combina T3a, T3b, T4, T5, T6, T7, modo contatos (com a lista de telefones) ou numero_inteiro (onda 2, sem a lista) e o teto das ultimas 24 horas. Falso em clinica de conta suspensa. Clinica e_de_teste fora da lista: so em numero de provedor fake. Nulo em qualquer argumento: falso. So service_role (e as funcoes do banco).';

create or replace function public.ia_pode_falar_com(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    exists (
      select 1
        from public.clinic c
        join public.ia_liberacao l on l.clinic_id = c.id
        left join public.ia_interruptor i on i.id
       where c.id = p_clinic_id
         and (
               (c.id = any (public.ia_clinicas_da_fase_controlada())
                and coalesce(i.ligado, false))
               or (c.e_de_teste
                   and not (c.id = any (public.ia_clinicas_da_fase_controlada())))
             )
         and l.liberada
         and not l.pausada_pela_clinica
         -- [onda 2: producao] os dois modos do WhatsApp
         and l.modo in ('contatos', 'numero_inteiro')
    )
    and exists (
      select 1
        from public.ia_numero_liberado n
        join public.whatsapp_account w on w.id = n.whatsapp_account_id
       where n.whatsapp_account_id = p_whatsapp_account_id
         and n.clinic_id = p_clinic_id
         and n.ativo
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
         -- clinica e_de_teste fora da lista: so o WhatsApp falso
         and (p_clinic_id = any (public.ia_clinicas_da_fase_controlada())
              or w.provider = 'fake')
    )
    -- [onda 2: producao] inicio
    -- A lista de telefones e a trava K so no modo contatos.
    and (
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = p_clinic_id
           and l.modo = 'numero_inteiro'
      )
      or
    -- [onda 2: producao] fim
    exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    -- [onda 2: producao] inicio
    )
    -- [onda 2: producao] fim
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    and not public.telefone_e_numero_da_plataforma(p_telefone),
    false
  )
$function$;

create or replace function public.ia_atende_no_whatsapp(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_telefone)
    -- [onda 2: producao] inicio
    -- A lista de telefones e a trava K so no modo contatos.
    and (
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = p_clinic_id
           and l.modo = 'numero_inteiro'
      )
      or
    -- [onda 2: producao] fim
    exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
    -- [onda 2: producao] inicio
    )
    -- [onda 2: producao] fim
    and exists (
      select 1
        from public.ai_agent_config c
       where c.clinic_id = p_clinic_id
         and c.status = 'publicada'
    )
    -- [onda 2: publico da ia] inicio
    -- Onda 2, item 4: o publico da versao publicada (so leads, so
    -- pacientes ou os dois). So na ENTRADA (conversa nova, Devolver,
    -- retomada no horario): o lead que vira paciente no meio da conversa
    -- continua (ia_pode_falar_com nao olha o publico).
    and public.ia_publico_aceita(p_clinic_id, p_telefone)
    -- [onda 2: publico da ia] fim
    and not public.telefone_e_numero_da_plataforma(p_telefone),
    false
  )
$function$;

comment on function public.ia_atende_no_whatsapp(uuid, uuid, text) is
  'Conversa NOVA deste telefone neste numero entra na IA? ia_pode_atender (liberacao, teto, numero e, no modo contatos, a lista) mais, no modo contatos, a trava K (o forcado passa), a versao publicada, o publico da versao publicada (ia_publico_aceita; nulo recusa no numero_inteiro) e nunca numero da plataforma. So na entrada: conversa nova, Devolver e retomada no horario. So service_role (e as funcoes do banco).';

create or replace function public.reservar_gasto_da_ia(p_clinic_id uuid, p_origem text, p_custo_microdolar bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- [onda 2: producao] inicio
    -- Onda 2 (M3): o modo numero_inteiro tambem (o WhatsApp e o
    -- simulador da clinica em producao).
    when 'simulador' then array['simulador', 'contatos', 'numero_inteiro']
    when 'whatsapp' then array['contatos', 'numero_inteiro']
    -- [onda 2: producao] fim
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
$function$;

comment on function public.reservar_gasto_da_ia(uuid, text, bigint) is
  'Reserva o custo maximo estimado de um turno (microdolar) antes de chamar o modelo. Sob trava consultiva por clinica, confere as travas de ia_liberacao_vigente (origem simulador: modos simulador, contatos e numero_inteiro; whatsapp: contatos e numero_inteiro, onda 2) e o gasto das ultimas 24 horas MAIS o pedido contra o teto (estrito, como a trava); se cabe, grava uma linha de reserva em ia_uso e devolve o id dela, senao NULL (nada gravado). Argumento nulo: 22004; custo negativo ou origem invalida: 22023. SO service role.';

create or replace function public.ia_pode_simular(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- [onda 2: producao] o simulador da clinica em producao tambem
  select public.ia_liberacao_vigente(p_clinic_id, array['simulador', 'contatos', 'numero_inteiro'])
$function$;

comment on function public.ia_pode_simular(uuid) is
  'O simulador da Tela 6 pode chamar o modelo para esta clinica? As travas de ia_pode_atender sem numero e contato, com modo simulador, contatos ou numero_inteiro (onda 2). So service_role.';

create or replace function public.ia_estado_do_motor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_agendado boolean := false;
  v_vigiado boolean;
  v_devidos integer;
begin
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1)'
      into v_agendado
      using 'motor-ia';
  end if;

  v_vigiado := exists (
    select 1
      from public.ia_liberacao l
     where l.clinic_id = any (public.ia_clinicas_da_fase_controlada())
       and l.liberada
       and not l.pausada_pela_clinica
       -- [onda 2: producao] os dois modos do WhatsApp
       and l.modo in ('contatos', 'numero_inteiro')
  ) and coalesce((select i.ligado from public.ia_interruptor i where i.id), false);

  select count(*) into v_devidos
    from public.ia_jobs_devidos(null, false, interval '60 seconds');

  return jsonb_build_object(
    'batida_em', (select h.batida_em from public.worker_heartbeat h where h.worker_id = 'motor-ia'),
    'ultimo_erro', (select h.ultimo_erro from public.worker_heartbeat h where h.worker_id = 'motor-ia'),
    'agendado', coalesce(v_agendado, false),
    'vigiado', v_vigiado,
    'devidos', v_devidos,
    'alerta', v_vigiado and (v_devidos > 0 or not coalesce(v_agendado, false))
  );
end;
$function$;

create or replace function public.devolver_para_ia(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_clinica uuid;
  v_status text;
  v_responsavel uuid;
  v_aguardando boolean;
  v_contato uuid;
  v_numero uuid;
  v_chave text;
  v_nome text;
begin
  -- 1) So sessao
  if v_uid is null then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  -- 2) Conversa de clinica onde a pessoa e membro ativo (sem travar)
  select c.clinic_id into v_clinica
    from public.conversation c
   where c.id = p_conversation_id;
  if v_clinica is null or not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = v_clinica
       and m.user_id = v_uid
       and m.status = 'ativo'
  ) then
    raise exception using errcode = 'P0002', message = 'conversa_nao_encontrada';
  end if;

  -- 3) Escrita e fase
  if not public.user_can_write(v_clinica) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;
  if not exists (
    select 1 from public.clinic k
     where k.id = v_clinica
       and (k.id = any (public.ia_clinicas_da_fase_controlada()) or k.e_de_teste)
  ) then
    raise exception using errcode = '42501', message = 'fora_da_fase';
  end if;

  -- 4) Ordem de travas: liberacao e interruptor antes da conversa
  perform 1 from public.ia_liberacao l where l.clinic_id = v_clinica for share;
  perform 1 from public.ia_interruptor i where i.id for share;

  -- 5) A conversa esta com a pessoa e sem pergunta pendente
  select c.status, c.assignee_user_id, c.awaiting_reply, c.contact_id, c.whatsapp_account_id
    into v_status, v_responsavel, v_aguardando, v_contato, v_numero
    from public.conversation c
   where c.id = p_conversation_id
     for update;
  if v_status is distinct from 'em_atendimento'
     or v_responsavel is distinct from v_uid
     or v_aguardando is distinct from false
  then
    raise exception using errcode = 'CZ409', message = 'conversa_mudou';
  end if;

  -- 6) Telefone liberado e, com sinal de paciente, so o forcado (D-B).
  -- contato_de_paciente: o telefone esta ativo na lista, nao foi forcado e
  -- o contato tem sinal de paciente; qualquer outra recusa e nao_liberada.
  select k.phone_key into v_chave
    from public.contact k
   where k.id = v_contato
     and k.clinic_id = v_clinica;
  if not public.ia_atende_no_whatsapp(v_clinica, v_numero, v_chave) then
    if exists (
         select 1 from public.ia_contato_liberado t
          where t.clinic_id = v_clinica
            and t.phone_key = public.chave_telefone(btrim(v_chave))
            and t.ativo
            and not t.forcado
       )
       and public.contato_tem_sinal_de_paciente(v_clinica, v_chave)
       -- [onda 2: producao] inicio
       -- No modo numero_inteiro a lista e a trava K nao valem: a recusa
       -- e nao_liberada.
       and not exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = v_clinica
           and l.modo = 'numero_inteiro'
      )
       -- [onda 2: producao] fim
    then
      raise exception using errcode = '42501', message = 'contato_de_paciente';
    end if;
    raise exception using errcode = '42501', message = 'nao_liberada';
  end if;

  -- 7) Na mesma transacao: status, fila, janela, evento e trilha
  perform set_config('conduzza.devolver_para_ia', p_conversation_id::text, true);
  update public.conversation
     set status = 'ia_atendendo',
         assignee_user_id = null
   where id = p_conversation_id;
  perform set_config('conduzza.devolver_para_ia', '', true);

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'devolvida_para_ia'
   where j.id in (
     select q.id
       from public.job_queue q
      where q.kind = 'responder_com_ia'
        and q.status = 'pendente'
        and q.payload ->> 'conversation_id' = p_conversation_id::text
        for update skip locked
   );

  insert into public.ia_janela_da_conversa (
    conversation_id, clinic_id, contact_id, phone_key, desde, aberta_por, updated_at
  ) values (
    p_conversation_id, v_clinica, v_contato, v_chave, now(), 'devolver', now()
  )
  on conflict (conversation_id) do update
    set clinic_id = excluded.clinic_id,
        contact_id = excluded.contact_id,
        phone_key = excluded.phone_key,
        desde = excluded.desde,
        aberta_por = excluded.aberta_por,
        updated_at = excluded.updated_at;

  -- Nome: a mesma regra de userName (lib/auth/active-clinic.ts).
  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), u.email)
    into v_nome
    from auth.users u
   where u.id = v_uid;
  v_nome := coalesce(v_nome, 'Usuário');

  insert into public.message (
    clinic_id, conversation_id, direction, author, content_type, body,
    billable, cost_cents
  ) values (
    v_clinica, p_conversation_id, 'saida', 'sistema', 'evento',
    v_nome || ' devolveu a conversa para a IA', false, 0
  );

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (v_clinica, v_uid, 'devolveu_para_ia', 'conversation', p_conversation_id);

  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.ia_devolver_disponivel(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_clinica uuid;
  v_status text;
  v_responsavel uuid;
  v_aguardando boolean;
  v_numero uuid;
  v_chave text;
  v_gestao boolean;
  v_motivo text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select c.clinic_id, c.status, c.assignee_user_id, c.awaiting_reply,
         c.whatsapp_account_id, k.phone_key
    into v_clinica, v_status, v_responsavel, v_aguardando, v_numero, v_chave
    from public.conversation c
    left join public.contact k on k.id = c.contact_id and k.clinic_id = c.clinic_id
   where c.id = p_conversation_id;
  if v_clinica is null or not exists (
    select 1 from public.clinic_member m
     where m.clinic_id = v_clinica
       and m.user_id = v_uid
       and m.status = 'ativo'
  ) then
    raise exception using errcode = 'P0002', message = 'conversa_nao_encontrada';
  end if;

  if not exists (
    select 1 from public.clinic k
     where k.id = v_clinica
       and (k.id = any (public.ia_clinicas_da_fase_controlada()) or k.e_de_teste)
  ) then
    return jsonb_build_object('pode', false, 'motivo', 'fora_da_fase');
  end if;

  if not public.user_can_write(v_clinica) then
    return jsonb_build_object('pode', false, 'motivo', 'sem_permissao');
  end if;
  if v_status is distinct from 'em_atendimento' or v_responsavel is distinct from v_uid then
    return jsonb_build_object('pode', false, 'motivo', 'nao_e_sua');
  end if;
  -- [devolver: liberacao antes da pergunta] inicio
  -- A pergunta pendente saiu daqui: e conferida DEPOIS da liberacao (abaixo).
  -- [devolver: liberacao antes da pergunta] fim

  if not (
    -- [onda 2: producao] os dois modos do WhatsApp
    public.ia_liberacao_vigente(v_clinica, array['contatos', 'numero_inteiro'])
    and exists (
      select 1 from public.ai_agent_config a
       where a.clinic_id = v_clinica and a.status = 'publicada'
    )
  ) then
    v_motivo := 'assistente_desligado';
  elsif not exists (
          select 1
            from public.ia_numero_liberado n
            join public.whatsapp_account w on w.id = n.whatsapp_account_id
           where n.whatsapp_account_id = v_numero
             and n.clinic_id = v_clinica
             and n.ativo
             and w.clinic_id = v_clinica
             and w.removido_em is null
             and (v_clinica = any (public.ia_clinicas_da_fase_controlada())
                  or w.provider = 'fake')
        )
        -- [onda 2: producao] inicio
        -- A lista de telefones so e exigida no modo contatos.
        or (not
      exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = v_clinica
           and l.modo = 'numero_inteiro'
      )
            and
        -- [onda 2: producao] fim
        not exists (
          select 1 from public.ia_contato_liberado k
           where k.clinic_id = v_clinica
             and k.phone_key = public.chave_telefone(btrim(v_chave))
             and k.ativo
        )
        -- [onda 2: producao] inicio
        )
        -- [onda 2: producao] fim
        or public.telefone_e_numero_da_plataforma(v_chave)
        -- [onda 2: producao] inicio
        -- O publico da versao publicada, como na entrada (devolver_para_ia,
        -- por ia_atende_no_whatsapp): sem ele o botao aparecia e o
        -- Devolver recusava.
        or not public.ia_publico_aceita(v_clinica, v_chave)
        -- [onda 2: producao] fim
  then
    v_motivo := 'nao_liberada';
  elsif public.contato_tem_sinal_de_paciente(v_clinica, v_chave)
        -- [onda 2: producao] inicio
        -- A trava K so no modo contatos.
        and not exists (
        select 1 from public.ia_liberacao l
         where l.clinic_id = v_clinica
           and l.modo = 'numero_inteiro'
      )
        -- [onda 2: producao] fim
        and not exists (
          select 1 from public.ia_contato_liberado k
           where k.clinic_id = v_clinica
             and k.phone_key = public.chave_telefone(btrim(v_chave))
             and k.ativo
             and k.forcado
        )
  then
    -- Telefone forcado pela equipe Conduzza (D-B) passa.
    v_motivo := 'contato_de_paciente';
  end if;

  if v_motivo is null then
    -- [devolver: liberacao antes da pergunta] inicio
    -- A pergunta pendente so com a liberacao conferida: em conversa de
    -- paciente (fora da lista, ou com sinal de paciente sem o forcar) o
    -- botao nunca diz "Responda o paciente antes de devolver para a IA.",
    -- que prometia um devolver que nunca vem. Para quem nao e gestao, o
    -- motivo da liberacao continua nao_disponivel (abaixo): nada da lista
    -- vaza, e a pergunta pendente continua valendo para todos os papeis.
    if v_aguardando then
      return jsonb_build_object('pode', false, 'motivo', 'pergunta_pendente');
    end if;
    -- [devolver: liberacao antes da pergunta] fim
    return jsonb_build_object('pode', true, 'motivo', null);
  end if;

  v_gestao := public.is_product_admin()
    or public.user_has_role(v_clinica, array['admin', 'gestor']);
  if not v_gestao then
    v_motivo := 'nao_disponivel';
  end if;
  return jsonb_build_object('pode', false, 'motivo', v_motivo);
end;
$function$;

create or replace function public.situacao_da_ia_na_clinica(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_teto boolean;
  v_versao integer;
  v_invalidos jsonb;
  v_sem_autorizacao jsonb;
  v_abertas jsonb;
  v_motor jsonb;
  -- [conversa aberta por numero] inicio
  v_conversas jsonb;
  -- [conversa aberta por numero] fim
  -- [onda 2: publico da ia] inicio
  v_fora_do_publico jsonb;
  -- [onda 2: publico da ia] fim
  -- [onda 2: producao] inicio
  v_modo text;
  -- [onda 2: producao] fim
begin
  if not (
    (auth.uid() is null and coalesce(auth.role(), 'service_role') = 'service_role')
    or public.is_product_admin()
    or public.ia_membro_ve_a_liberacao(p_clinic_id)
  ) then
    raise exception using errcode = '42501', message = 'sem_permissao';
  end if;

  select coalesce((
    select (
      select coalesce(sum(u.custo_microdolar), 0)
        from public.ia_uso u
       where u.clinic_id = l.clinic_id
         and u.created_at >= now() - interval '24 hours'
    ) >= l.teto_diario_centavos_usd::bigint * 10000
      from public.ia_liberacao l
     where l.clinic_id = p_clinic_id
  ), false) into v_teto;

  select max(a.version) into v_versao
    from public.ai_agent_config a
   where a.clinic_id = p_clinic_id
     and a.status = 'publicada';

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_invalidos
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and (public.telefone_e_numero_da_plataforma(k.phone_key)
          or (not k.forcado
              -- [onda 2: producao] inicio
              -- Revisao da onda 2: no numero_inteiro a lista e a trava K
              -- nao valem (ia_atende_no_whatsapp e ia_pode_falar_com):
              -- o telefone que so tem o sinal de paciente aciona o
              -- assistente (com o publico) e a aba nao diz que nao.
              and not exists (
                select 1 from public.ia_liberacao l
                 where l.clinic_id = p_clinic_id
                   and l.modo = 'numero_inteiro'
              )
              -- [onda 2: producao] fim
              and public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key)));

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_sem_autorizacao
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and exists (
       select 1
         from public.contact ct
        where ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and (
            select cc.revoked_at is not null
              from public.contact_consent cc
             where cc.clinic_id = p_clinic_id
               and cc.contact_id = ct.id
               and cc.channel = 'whatsapp'
             order by cc.granted_at desc, cc.created_at desc
             limit 1
          ) is true
     );

  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb) into v_abertas
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and exists (
       select 1
         from public.conversation c
         join public.contact ct on ct.id = c.contact_id
        where c.clinic_id = p_clinic_id
          and ct.clinic_id = p_clinic_id
          and ct.phone_key = k.phone_key
          and c.status in ('aguardando_humano', 'em_atendimento')
          and c.whatsapp_account_id in (
            select n.whatsapp_account_id
              from public.ia_numero_liberado n
              join public.whatsapp_account w on w.id = n.whatsapp_account_id
             where n.clinic_id = p_clinic_id
               and n.ativo
               and w.removido_em is null
          )
     );

  -- [conversa aberta por numero] inicio
  -- Por telefone ATIVO da lista e por numero LIGADO (nao removido) da
  -- clinica: a conversa aberta com a equipe (aguardando ou em atendimento)
  -- do contato desse telefone naquele numero. A ingestao so poe na IA a
  -- conversa NOVA; enquanto esta estiver aberta, a mensagem do telefone
  -- nesse numero fica com a equipe. A aba diz o numero e leva a conversa
  -- (o id), para alguem assumir e resolver. No maximo uma por par: o
  -- contato e unico pela chave na clinica, e conversation_aberta_por_numero
  -- so deixa uma conversa nao resolvida por contato e numero (o distinct on
  -- e so a segunda camada, com a mais recente).
  select coalesce(jsonb_agg(jsonb_build_object(
           'telefone_id', a.telefone_id,
           'whatsapp_account_id', a.whatsapp_account_id,
           'conversation_id', a.conversation_id
         ) order by a.telefone_criado, a.telefone_id, a.numero_criado, a.whatsapp_account_id), '[]'::jsonb)
    into v_conversas
    from (
      select distinct on (k.id, n.whatsapp_account_id)
             k.id as telefone_id,
             k.created_at as telefone_criado,
             n.whatsapp_account_id,
             n.created_at as numero_criado,
             c.id as conversation_id
        from public.ia_contato_liberado k
        join public.contact ct
          on ct.clinic_id = p_clinic_id
         and ct.phone_key = k.phone_key
        join public.conversation c
          on c.clinic_id = p_clinic_id
         and c.contact_id = ct.id
         and c.status in ('aguardando_humano', 'em_atendimento')
        join public.ia_numero_liberado n
          on n.clinic_id = p_clinic_id
         and n.whatsapp_account_id = c.whatsapp_account_id
         and n.ativo
        join public.whatsapp_account w
          on w.id = n.whatsapp_account_id
         and w.clinic_id = p_clinic_id
         and w.removido_em is null
       where k.clinic_id = p_clinic_id
         and k.ativo
       order by k.id, n.whatsapp_account_id, c.created_at desc, c.id
    ) a;
  -- [conversa aberta por numero] fim

  -- [onda 2: publico da ia] inicio
  -- Onda 2, item 4: os telefones ATIVOS da lista cujo contato nao cabe no
  -- publico da versao publicada. O filtro vale no teste tambem (P4b): a
  -- aba diz por que eles nao acionam o assistente.
  select coalesce(jsonb_agg(k.id order by k.created_at), '[]'::jsonb)
    into v_fora_do_publico
    from public.ia_contato_liberado k
   where k.clinic_id = p_clinic_id
     and k.ativo
     and not public.ia_publico_aceita(p_clinic_id, k.phone_key);
  -- [onda 2: publico da ia] fim

  -- [onda 2: producao] inicio
  -- Onda 2 (M3): o modo da liberacao (simulador, contatos ou
  -- numero_inteiro; nulo sem a linha).
  select l.modo into v_modo
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;
  -- [onda 2: producao] fim

  v_motor := public.ia_estado_do_motor();

  return jsonb_build_object(
    'teto_atingido', v_teto,
    'versao_publicada', v_versao,
    'telefones_invalidos', v_invalidos,
    'telefones_sem_autorizacao', v_sem_autorizacao,
    'telefones_com_conversa_aberta', v_abertas,
    -- [conversa aberta por numero] inicio
    'conversas_abertas', v_conversas,
    -- [conversa aberta por numero] fim
    -- [onda 2: publico da ia] inicio
    'telefones_fora_do_publico', v_fora_do_publico,
    -- [onda 2: publico da ia] fim
    -- [onda 2: producao] inicio
    'modo', v_modo,
    -- [onda 2: producao] fim
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$;

create or replace function public.painel_geral_das_clinicas(p_incluir_teste boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_painel jsonb;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza vê o painel geral.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza vê o painel geral.';
  end if;

  -- SO CONTAGENS: de paciente, nada alem de quantos. O gasto vem de ia_uso
  -- (custo_microdolar; US$ 1 = 1.000.000) com as reservas, como o teto
  -- conta, em centavos de dolar arredondados (10.000 microdolares = 1
  -- centavo): as ultimas 24 horas (a janela movel do teto) e o mes corrente
  -- no fuso da clinica; "sem simulador" tira a origem simulador. Os totais
  -- arredondam a soma das clinicas, nao somam os arredondados.
  with clinicas as (
    select c.id,
           c.name,
           c.created_at,
           c.timezone,
           date_trunc('month', now() at time zone coalesce(nullif(c.timezone, ''), 'America/Fortaleza'))
             at time zone coalesce(nullif(c.timezone, ''), 'America/Fortaleza') as inicio_do_mes
      from public.clinic c
     where coalesce(p_incluir_teste, false) or not c.e_de_teste
  ),
  membros as (
    select m.clinic_id,
           count(*) filter (where m.status = 'ativo') as ativos,
           count(*) filter (where m.status = 'pendente') as pendentes,
           coalesce(
             jsonb_agg(jsonb_build_object('nome', p.name, 'email', u.email)
                       order by lower(coalesce(p.name, u.email, '')), m.user_id)
               filter (where m.status = 'ativo' and m.role = 'admin'),
             '[]'::jsonb) as administradores
      from public.clinic_member m
      left join public.profile p on p.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
     where m.clinic_id in (select k.id from clinicas k)
     group by m.clinic_id
  ),
  numeros as (
    select w.clinic_id,
           count(*) as total,
           count(*) filter (where w.connection_status = 'conectado') as conectados,
           jsonb_agg(jsonb_build_object(
               'id', w.id,
               'nome', w.nome,
               'final', case
                 when char_length(regexp_replace(coalesce(w.display_phone, ''), '[^0-9]', '', 'g')) >= 4
                 then right(regexp_replace(w.display_phone, '[^0-9]', '', 'g'), 4)
               end,
               'conexao', w.connection_status,
               'ia_ligada', coalesce(n.ativo, false))
             order by w.principal desc, w.created_at, w.id) as lista
      from public.whatsapp_account w
      left join public.ia_numero_liberado n
        on n.whatsapp_account_id = w.id
       and n.clinic_id = w.clinic_id
     where w.removido_em is null
       and w.clinic_id in (select k.id from clinicas k)
     group by w.clinic_id
  ),
  contatos as (
    select t.clinic_id,
           count(*) as total,
           count(*) filter (where t.first_contact_at >= now() - interval '30 days') as novos_30
      from public.contact t
     where t.clinic_id in (select k.id from clinicas k)
     group by t.clinic_id
  ),
  conversas as (
    select v.clinic_id,
           count(*) filter (where v.created_at >= now() - interval '30 days') as criadas_30,
           max(v.last_inbound_at) as ultima_recebida
      from public.conversation v
     where v.clinic_id in (select k.id from clinicas k)
     group by v.clinic_id
  ),
  telefones as (
    select t.clinic_id, count(*) as ligados
      from public.ia_contato_liberado t
     where t.ativo
     group by t.clinic_id
  ),
  gasto as (
    select u.clinic_id,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= now() - interval '24 hours'), 0) as d24,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= k.inicio_do_mes), 0) as mes,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= now() - interval '24 hours'
                       and u.origem <> 'simulador'), 0) as d24_sem_simulador,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= k.inicio_do_mes
                       and u.origem <> 'simulador'), 0) as mes_sem_simulador
      from public.ia_uso u
      join clinicas k on k.id = u.clinic_id
     where u.created_at >= least(now() - interval '24 hours', k.inicio_do_mes)
     group by u.clinic_id
  )
  select jsonb_build_object(
           'totais', jsonb_build_object(
             'clinicas', count(*),
             'ativas', count(*) filter (where s.clinic_id is null),
             'suspensas', count(*) filter (where s.clinic_id is not null),
             'agente_em_teste', count(*) filter (where h.estado = 'teste'),
             -- [onda 2: producao] inicio
             'agente_em_producao', count(*) filter (where h.estado = 'producao'),
             -- [onda 2: producao] fim
             'gasto_24h_centavos_usd', round(coalesce(sum(g.d24), 0) / 10000.0)::bigint,
             'gasto_mes_centavos_usd', round(coalesce(sum(g.mes), 0) / 10000.0)::bigint),
           'clinicas', coalesce(jsonb_agg(jsonb_build_object(
               'id', k.id,
               'nome', k.name,
               'criada_em', k.created_at,
               'fuso', k.timezone,
               'membros_ativos', coalesce(m.ativos, 0),
               'membros_pendentes', coalesce(m.pendentes, 0),
               'administradores', coalesce(m.administradores, '[]'::jsonb),
               'numeros_total', coalesce(n.total, 0),
               'numeros_conectados', coalesce(n.conectados, 0),
               'numeros', coalesce(n.lista, '[]'::jsonb),
               'contatos', coalesce(ct.total, 0),
               'leads_30_dias', coalesce(ct.novos_30, 0),
               'conversas_30_dias', coalesce(cv.criadas_30, 0),
               'ultima_mensagem_em', cv.ultima_recebida,
               'suspensao', case when s.clinic_id is not null then
                 jsonb_build_object('suspensa_em', s.suspensa_em, 'motivo', s.motivo)
               end,
               'agente', jsonb_build_object(
                 'estado', coalesce(h.estado, 'desligado'),
                 'modo', l.modo,
                 'liberada', coalesce(l.liberada, false),
                 'pausada_pela_clinica', coalesce(l.pausada_pela_clinica, false),
                 'telefones_ligados', coalesce(t.ligados, 0)),
               'gasto', jsonb_build_object(
                 'ultimas_24h_centavos_usd', round(coalesce(g.d24, 0) / 10000.0)::bigint,
                 'mes_centavos_usd', round(coalesce(g.mes, 0) / 10000.0)::bigint,
                 'ultimas_24h_sem_simulador_centavos_usd',
                   round(coalesce(g.d24_sem_simulador, 0) / 10000.0)::bigint,
                 'mes_sem_simulador_centavos_usd',
                   round(coalesce(g.mes_sem_simulador, 0) / 10000.0)::bigint),
               'teto_diario_centavos_usd', l.teto_diario_centavos_usd)
             order by lower(k.name), k.id), '[]'::jsonb))
    into v_painel
    from clinicas k
    left join membros m on m.clinic_id = k.id
    left join numeros n on n.clinic_id = k.id
    left join contatos ct on ct.clinic_id = k.id
    left join conversas cv on cv.clinic_id = k.id
    left join telefones t on t.clinic_id = k.id
    left join gasto g on g.clinic_id = k.id
    left join public.clinica_suspensa s on s.clinic_id = k.id
    left join public.ia_clinica_habilitada h on h.clinic_id = k.id
    left join public.ia_liberacao l on l.clinic_id = k.id;

  return v_painel;
end;
$function$;

comment on function public.painel_geral_das_clinicas(boolean) is
  'Painel geral do sistema (onda 1), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS, nenhum dado de paciente. Clinicas e_de_teste so com p_incluir_teste. Formato (lido por lerPainelDoBanco em lib/queries/painel-geral.ts): {"totais": {"clinicas", "ativas", "suspensas", "agente_em_teste", "agente_em_producao" (onda 2), "gasto_24h_centavos_usd", "gasto_mes_centavos_usd"}, "clinicas": [{"id", "nome", "criada_em", "fuso", "membros_ativos", "membros_pendentes", "administradores": [{"nome", "email"}] (ativos com papel admin; dado da equipe), "numeros_total", "numeros_conectados" (sem os removidos), "numeros": [{"id", "nome", "final" (4 ultimos digitos ou null), "conexao" (connection_status), "ia_ligada"}], "contatos", "leads_30_dias" (first_contact_at), "conversas_30_dias" (created_at), "ultima_mensagem_em" (max last_inbound_at ou null), "suspensao": null ou {"suspensa_em", "motivo"}, "agente": {"estado" (desligado sem linha), "modo" (null sem liberacao), "liberada", "pausada_pela_clinica", "telefones_ligados"}, "gasto": {"ultimas_24h_centavos_usd", "mes_centavos_usd", "ultimas_24h_sem_simulador_centavos_usd", "mes_sem_simulador_centavos_usd"}, "teto_diario_centavos_usd" (null sem liberacao)}] (por nome)}. Gasto de ia_uso com as reservas (como o teto), em centavos de dolar arredondados; mes corrente no fuso da clinica; os totais arredondam a soma.';
