-- Corpos de ANTES da migration 20261022120000 (producao do agente, onda 2,
-- M3): os lidos da producao em 21/10/2026 (fndef.js, so leitura) e, em
-- ia_atende_no_whatsapp e situacao_da_ia_na_clinica, os que a migration
-- 20261022110000 (M2) deixa. md5(prosrc) (o ensaio confere que o banco
-- ainda esta assim antes de trocar):
--   ia_clinicas_da_fase_controlada()                    3534e2ff90f9e282b369543b2b90d7bc
--   ia_liberacao_so_na_lista()                          2698186729f5d64c6772abf4930e2d6f
--   definir_liberacao_da_ia(uuid, boolean, text, text)  033c45a1ccac5637c902d22683f750ca
--   definir_agente_da_clinica(uuid, text, text)         8cc2435dcf875d0a27f04f7b8105d14f
--   ia_pode_atender(uuid, uuid, text)                   5ba584a35f9463d772a3032c49716e9d
--   ia_pode_falar_com(uuid, uuid, text)                 3e7ea5b1209d1ce8c96e73b4314030a1
--   ia_atende_no_whatsapp(uuid, uuid, text)             588a5d0f677416d94df2a3000fc44e04
--   reservar_gasto_da_ia(uuid, text, bigint)            7ab7dffc83709a64691849fa356ed20e
--   ia_pode_simular(uuid)                               03c79fa8042995c9d89ab4ac4982f3b6
--   ia_estado_do_motor()                                e0a206ce2a2c70cf2ad0d6c919891f67
--   devolver_para_ia(uuid)                              fae16581741b0a6d568057be60e302dc
--   ia_devolver_disponivel(uuid)                        faa9933cb6dfd6375e33d2ba22d7f6bc
--   situacao_da_ia_na_clinica(uuid)                     ae3e2b3b181241e3b3c0e8d8fc4bce09
--   painel_geral_das_clinicas(boolean)                  82b1262b73850e28de6e4036a2c92052
--
-- ROLLBACK manual da migration (cabecalho dela). E a primeira das tres da
-- onda 2 a desfazer (depois, se for o caso, a M2 e a M1). ORDEM:
--   0. ANTES, pelo painel: toda clinica em producao volta para teste
--      (definir_agente_da_clinica '<id>', 'teste', 'rollback da onda 2'),
--      e nenhuma liberacao fica em numero_inteiro (o CHECK antigo recusaria
--      a linha; este arquivo para com P0001 se achar alguma).
--   1. Voltar o CODIGO que entende producao, numero_inteiro, a pausa e os
--      requisitos (painel, Tela 6).
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor: os corpos
--      de antes voltam PRIMEIRO, com os comentarios de antes; as funcoes
--      novas e a tabela ia_requisito_da_producao saem; os CHECKs de estado
--      e de modo voltam aos de antes (com os comentarios das tabelas).
-- O que fica: a trilha (registrou_requisito_da_producao,
-- revogou_requisito_da_producao, pausou_a_ia, retomou_a_ia,
-- mudou_agente_da_clinica); a pausa gravada pela clinica
-- (pausada_pela_clinica continua valendo nas decisoes, como antes).
-- TRAVAS: ACCESS EXCLUSIVE curto em ia_clinica_habilitada e ia_liberacao
-- (os CHECKs) e o DROP da tabela solta a FK para clinic (SHARE ROW
-- EXCLUSIVE em clinic ate o commit); lock_timeout de 3 s, horario calmo.
-- Conferir no fim: os md5 acima, nenhuma das quatro funcoes novas, nenhuma
-- ia_requisito_da_producao, os CHECKs de antes.

begin;
set local lock_timeout = '3s';

-- 0. Nada em producao nem em numero_inteiro (o CHECK antigo recusaria).
do $$
begin
  if exists (select 1 from public.ia_clinica_habilitada h where h.estado = 'producao')
     or exists (select 1 from public.ia_liberacao l where l.modo = 'numero_inteiro')
  then
    raise exception using errcode = 'P0001',
      message = 'Ainda ha clinica em producao ou liberacao em numero_inteiro: volte para teste pelo painel antes do rollback.';
  end if;
end;
$$;

-- 1. Os corpos de antes e os comentarios de antes.
CREATE OR REPLACE FUNCTION public.ia_clinicas_da_fase_controlada()
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
   where h.estado = 'teste'
     and not exists (
       select 1 from public.clinica_suspensa s where s.clinic_id = h.clinic_id
     )
  -- [agente por clinica] fim
$function$;
comment on function public.ia_clinicas_da_fase_controlada() is
  'As clinicas com o agente de IA em teste (ia_clinica_habilitada.estado = ''teste''), sem as suspensas (clinica_suspensa), em ordem de id. STABLE desde a onda 1 (antes, o array fixo de teste123 e Conduzza Teste). Nenhuma outra clinica ganha linha liberada em ia_liberacao (gatilho ia_liberacao_so_na_lista), salvo clinica e_de_teste. So service_role (e as funcoes do banco).';

CREATE OR REPLACE FUNCTION public.ia_liberacao_so_na_lista()
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
  return new;
end;
$function$;
comment on function public.ia_liberacao_so_na_lista() is null;

CREATE OR REPLACE FUNCTION public.definir_liberacao_da_ia(p_clinic_id uuid, p_liberada boolean, p_modo text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
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

  -- [whatsapp so pela equipe] inicio
  -- Nesta fase, so a equipe Conduzza liga o atendimento pelo WhatsApp (E3,
  -- decisao do dono de 13/10/2026). Desligar e "So simulador" continuam com
  -- ia_exigir_quem_libera.
  select l.modo into v_modo_atual
    from public.ia_liberacao l
   where l.clinic_id = p_clinic_id;
  if p_liberada and coalesce(p_modo, v_modo_atual, 'simulador') = 'contatos' then
    perform public.ia_exigir_equipe_conduzza();
  end if;
  -- [whatsapp so pela equipe] fim

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
  'Libera ou desliga a IA numa clinica (T3b) e escolhe o modo (simulador ou contatos; nulo mantem o atual, ou simulador na criacao). So clinicas da lista fechada ou e_de_teste (T3a, 42501). Devolve para a equipe as conversas que perderam a liberacao (ia_desligar). Quem chama: super admin, SQL editor, service role ou o administrador ativo da propria clinica da lista (ou e_de_teste), pelo guarda ia_exigir_quem_libera (42501 para os demais). Grava audit_log.';

CREATE OR REPLACE FUNCTION public.definir_agente_da_clinica(p_clinic_id uuid, p_estado text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_motivo text := nullif(btrim(p_motivo), '');
  v_de_teste boolean;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or p_estado is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica e o estado do agente.';
  end if;
  if p_estado not in ('desligado', 'teste') then
    raise exception using errcode = '22023', message = 'estado_invalido',
      hint = 'Use desligado ou teste. Produção chega na onda 2.';
  end if;
  if char_length(v_motivo) > 300 then
    raise exception using errcode = '22023', message = 'motivo_invalido',
      hint = 'O motivo tem no máximo 300 caracteres.';
  end if;
  select c.e_de_teste into v_de_teste from public.clinic c where c.id = p_clinic_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;
  if v_de_teste then
    -- As suites automatizadas ligam a IA das clinicas e_de_teste pelo
    -- caminho delas (definir_liberacao_da_ia); elas nunca entram na lista.
    raise exception using errcode = 'P0001', message = 'clinica_de_teste';
  end if;
  if p_estado = 'teste' and public.clinica_esta_suspensa(p_clinic_id) then
    raise exception using errcode = 'P0001', message = 'clinica_suspensa';
  end if;

  -- A mesma ordem de travas das definir_*_da_ia: a linha de liberacao
  -- primeiro, depois a do estado.
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;

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
  'O agente de IA da clinica: desligado ou teste (onda 1; producao na onda 2: 22023 estado_invalido). So super admin, service role e SQL editor (42501). Clinica e_de_teste: P0001 clinica_de_teste; teste em conta suspensa: P0001 clinica_suspensa. Teste: a clinica entra na lista e fica liberada em modo contatos (definir_liberacao_da_ia). Desligado: sai da lista, a liberacao fica desligada e as conversas do agente voltam para a equipe. Trilha mudou_agente_da_clinica {estado, motivo}.';

CREATE OR REPLACE FUNCTION public.ia_pode_atender(p_clinic_id uuid, p_whatsapp_account_id uuid, p_phone_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_liberacao_vigente(p_clinic_id, array['contatos'])
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
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_phone_key))
         and k.ativo
    ),
    false
  )
$function$;
comment on function public.ia_pode_atender(uuid, uuid, text) is
  'A IA pode atender este telefone (phone_key, ou o E.164, que vira a chave) neste numero desta clinica? Combina T3a, T3b, T4, T5, T6, T7, modo contatos e o teto das ultimas 24 horas. Falso em clinica de conta suspensa. Clinica e_de_teste fora da lista: so em numero de provedor fake. Nulo em qualquer argumento: falso. So service_role (e as funcoes do banco).';

CREATE OR REPLACE FUNCTION public.ia_pode_falar_com(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
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
         and l.modo = 'contatos'
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
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
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
comment on function public.ia_pode_falar_com(uuid, uuid, text) is null;

CREATE OR REPLACE FUNCTION public.ia_atende_no_whatsapp(p_clinic_id uuid, p_whatsapp_account_id uuid, p_telefone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.ia_pode_atender(p_clinic_id, p_whatsapp_account_id, p_telefone)
    and exists (
      select 1
        from public.ia_contato_liberado k
       where k.clinic_id = p_clinic_id
         and k.phone_key = public.chave_telefone(btrim(p_telefone))
         and k.ativo
         and (k.forcado
              or not public.contato_tem_sinal_de_paciente(p_clinic_id, k.phone_key))
    )
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
  'Conversa NOVA deste telefone neste numero entra na IA? ia_pode_atender (liberacao, teto, numero, lista) mais a trava K (o forcado passa), a versao publicada, o publico da versao publicada (ia_publico_aceita, onda 2) e nunca numero da plataforma. So na entrada: conversa nova, Devolver e retomada no horario. So service_role (e as funcoes do banco).';

CREATE OR REPLACE FUNCTION public.reservar_gasto_da_ia(p_clinic_id uuid, p_origem text, p_custo_microdolar bigint)
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
$function$;
comment on function public.reservar_gasto_da_ia(uuid, text, bigint) is
  'Reserva o custo maximo estimado de um turno (microdolar) antes de chamar o modelo. Sob trava consultiva por clinica, confere as travas de ia_liberacao_vigente (origem simulador: modos simulador e contatos; whatsapp: contatos) e o gasto das ultimas 24 horas MAIS o pedido contra o teto (estrito, como a trava); se cabe, grava uma linha de reserva em ia_uso e devolve o id dela, senao NULL (nada gravado). Argumento nulo: 22004; custo negativo ou origem invalida: 22023. SO service role.';

CREATE OR REPLACE FUNCTION public.ia_pode_simular(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.ia_liberacao_vigente(p_clinic_id, array['simulador', 'contatos'])
$function$;
comment on function public.ia_pode_simular(uuid) is
  'O simulador da Tela 6 pode chamar o modelo para esta clinica? As travas de ia_pode_atender sem numero e contato, com modo simulador ou contatos. So service_role.';

CREATE OR REPLACE FUNCTION public.ia_estado_do_motor()
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
       and l.modo = 'contatos'
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
comment on function public.ia_estado_do_motor() is null;

CREATE OR REPLACE FUNCTION public.devolver_para_ia(p_conversation_id uuid)
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
comment on function public.devolver_para_ia(uuid) is null;

CREATE OR REPLACE FUNCTION public.ia_devolver_disponivel(p_conversation_id uuid)
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
    public.ia_liberacao_vigente(v_clinica, array['contatos'])
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
        or not exists (
          select 1 from public.ia_contato_liberado k
           where k.clinic_id = v_clinica
             and k.phone_key = public.chave_telefone(btrim(v_chave))
             and k.ativo
        )
        or public.telefone_e_numero_da_plataforma(v_chave)
  then
    v_motivo := 'nao_liberada';
  elsif public.contato_tem_sinal_de_paciente(v_clinica, v_chave)
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
comment on function public.ia_devolver_disponivel(uuid) is null;

CREATE OR REPLACE FUNCTION public.situacao_da_ia_na_clinica(p_clinic_id uuid)
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
    'motor_parado', not coalesce((v_motor ->> 'agendado')::boolean, false)
                    or coalesce((v_motor ->> 'alerta')::boolean, false)
  );
end;
$function$;
comment on function public.situacao_da_ia_na_clinica(uuid) is null;

CREATE OR REPLACE FUNCTION public.painel_geral_das_clinicas(p_incluir_teste boolean DEFAULT false)
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
  'Painel geral do sistema (onda 1), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS, nenhum dado de paciente. Clinicas e_de_teste so com p_incluir_teste. Formato (lido por lerPainelDoBanco em lib/queries/painel-geral.ts): {"totais": {"clinicas", "ativas", "suspensas", "agente_em_teste", "gasto_24h_centavos_usd", "gasto_mes_centavos_usd"}, "clinicas": [{"id", "nome", "criada_em", "fuso", "membros_ativos", "membros_pendentes", "administradores": [{"nome", "email"}] (ativos com papel admin; dado da equipe), "numeros_total", "numeros_conectados" (sem os removidos), "numeros": [{"id", "nome", "final" (4 ultimos digitos ou null), "conexao" (connection_status), "ia_ligada"}], "contatos", "leads_30_dias" (first_contact_at), "conversas_30_dias" (created_at), "ultima_mensagem_em" (max last_inbound_at ou null), "suspensao": null ou {"suspensa_em", "motivo"}, "agente": {"estado" (desligado sem linha), "modo" (null sem liberacao), "liberada", "pausada_pela_clinica", "telefones_ligados"}, "gasto": {"ultimas_24h_centavos_usd", "mes_centavos_usd", "ultimas_24h_sem_simulador_centavos_usd", "mes_sem_simulador_centavos_usd"}, "teto_diario_centavos_usd" (null sem liberacao)}] (por nome)}. Gasto de ia_uso com as reservas (como o teto), em centavos de dolar arredondados; mes corrente no fuso da clinica; os totais arredondam a soma.';

-- 2. As funcoes novas.
drop function if exists public.definir_pausa_da_ia(uuid, boolean, text);
drop function if exists public.revogar_requisito_da_producao(uuid, text);
drop function if exists public.registrar_requisito_da_producao(text, text, uuid);
drop function if exists public.requisitos_da_producao(uuid);

-- 3. A tabela nova (com a FK, o indice e a policy).
drop table if exists public.ia_requisito_da_producao;

-- 4. Os CHECKs e os comentarios de antes.
alter table public.ia_clinica_habilitada
  drop constraint ia_clinica_habilitada_estado_valido;
alter table public.ia_clinica_habilitada
  add constraint ia_clinica_habilitada_estado_valido
    check (estado in ('desligado', 'teste'));
alter table public.ia_liberacao
  drop constraint ia_liberacao_modo_valido;
alter table public.ia_liberacao
  add constraint ia_liberacao_modo_valido
    check (modo in ('simulador', 'contatos'));
comment on table public.ia_clinica_habilitada is
  'O agente de IA por clinica (onda 1): desligado ou teste (so os telefones da equipe, modo contatos). Producao entra no CHECK na onda 2. Sem linha = desligado. ia_clinicas_da_fase_controlada() le daqui as clinicas em teste, sem as suspensas. Escrita so por definir_agente_da_clinica (super admin), com trilha mudou_agente_da_clinica. A sessao le so clinic_id e estado (membro ativo da propria clinica e super admin).';
comment on table public.ia_liberacao is
  'Liberacao da IA por clinica (T3b e T7). So clinicas de ia_clinicas_da_fase_controlada() ou e_de_teste (gatilho ia_liberacao_so_na_lista, 42501 ate para a service role). modo simulador (so a Tela 6) ou contatos (WhatsApp so com ia_contato_liberado). Escrita por definir_liberacao_da_ia; pausada_pela_clinica so reduz (RPC da clinica no E5).';

commit;

-- Conferencia (so leitura), depois do commit:
-- select p.oid::regprocedure, md5(p.prosrc)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('ia_clinicas_da_fase_controlada', 'ia_liberacao_so_na_lista',
--                      'definir_liberacao_da_ia', 'definir_agente_da_clinica',
--                      'ia_pode_atender', 'ia_pode_falar_com', 'ia_atende_no_whatsapp',
--                      'reservar_gasto_da_ia', 'ia_pode_simular', 'ia_estado_do_motor',
--                      'devolver_para_ia', 'ia_devolver_disponivel',
--                      'situacao_da_ia_na_clinica', 'painel_geral_das_clinicas',
--                      'definir_pausa_da_ia', 'registrar_requisito_da_producao',
--                      'revogar_requisito_da_producao', 'requisitos_da_producao');
-- select to_regclass('public.ia_requisito_da_producao');
