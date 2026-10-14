-- Corpos lidos da producao em 13/10/2026, antes da migration 20261013100000
-- (M1 do E3). Passo 4 do ROLLBACK manual da migration (cabecalho dela). Nao
-- aplicar fora de um rollback, e so DEPOIS de desfazer a M2 (20261013120000)
-- e a M3 (20261013110000).
--
-- CREATE OR REPLACE mantem os grants de hoje. definir_contato_liberado_da_ia
-- mudou de assinatura na M1: aqui sai a nova e volta a antiga, com os grants
-- de antes (authenticated e service_role).

-- claim_jobs: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.claim_jobs(p_worker text, p_limit integer DEFAULT 5)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    -- [mensagem agendada] inicio
    and kind <> 'enviar_mensagem_agendada'
    -- [mensagem agendada] fim
    and locked_at < now() - interval '5 minutes'
    and attempts >= max_attempts;

  return query
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (
    select id from job_queue
    where (
      (status = 'pendente' and run_at <= now())
       or (status = 'executando'
           and locked_at < now() - interval '5 minutes'
           and attempts < max_attempts)
    )
      -- [mensagem agendada] inicio
      and kind <> 'enviar_mensagem_agendada'
      -- [mensagem agendada] fim
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$function$;

-- motor_manutencao: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.motor_manutencao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_erros text[] := array[]::text[];
  v_holds integer := 0;
  v_orfas integer := 0;
  v_ofertas integer := 0;
  v_reguas jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] inicio
  v_automacoes jsonb := '{}'::jsonb;
  -- [automacoes de fluxo] fim
  -- [gasto meta] inicio
  v_gasto integer := 0;
  -- [gasto meta] fim
  -- [clique do site] inicio
  v_cliques jsonb := '{}'::jsonb;
  -- [clique do site] fim
  -- [mensagem agendada] inicio
  v_agendadas jsonb := '{}'::jsonb;
  v_reconciliadas jsonb;
  v_erros_agendadas integer := 0;
  -- [mensagem agendada] fim
begin
  begin
    select limpar_holds_vencidos() into v_holds;
  exception when others then
    v_erros := v_erros || ('limpar_holds:' || sqlstate);
  end;

  begin
    select fechar_runs_orfas() into v_orfas;
  exception when others then
    v_erros := v_erros || ('fechar_runs_orfas:' || sqlstate);
  end;

  -- Janela de reoferta vencida vira 'expirada' e a proxima onda parte (4.9).
  begin
    select expirar_ofertas_de_espera() into v_ofertas;
  exception when others then
    v_erros := v_erros || ('expirar_ofertas:' || sqlstate);
  end;

  -- [automacoes de fluxo] inicio
  -- Automacoes de fluxo (02/10/2026): registra as regras de tempo vencidas
  -- e executa as pendentes (um salto por passagem). Antes das reguas, para o
  -- follow-up da etapa para onde a automacao moveu ja nascer nesta passagem.
  begin
    v_automacoes := jsonb_build_object('planejadas', planejar_automacoes_de_fluxo());
  exception when others then
    v_erros := v_erros || ('planejar_automacoes:' || sqlstate);
  end;

  begin
    v_automacoes := v_automacoes || executar_automacoes_de_fluxo();
  exception when others then
    v_erros := v_erros || ('executar_automacoes:' || sqlstate);
  end;

  -- [automacoes de fluxo] fim
  begin
    select planejar_reguas() into v_reguas;
  exception when others then
    v_erros := v_erros || ('planejar_reguas:' || sqlstate);
  end;

  -- [gasto meta] inicio
  -- Investimento da Meta (Fase 4, 03/10/2026): a partir das 06:00 no fuso de
  -- cada clinica, enfileira uma leitura do gasto por dia (ate 3 clinicas por
  -- passagem). Cada clinica erra sozinha dentro da funcao (raise warning);
  -- aqui so chega erro estrutural, que vira gasto_meta:<sqlstate> no
  -- planner_erro como as outras rotinas.
  begin
    v_gasto := enfileirar_gasto_meta_do_dia();
  exception when others then
    v_erros := v_erros || ('gasto_meta:' || sqlstate);
  end;

  -- [gasto meta] fim
  -- [clique do site] inicio
  -- Clique rastreado pelo site (F1 do Google, 05/10/2026): o clique nao
  -- casado sai 1 dia depois de vencer e o casado perde gclid, gbraid e
  -- wbraid 90 dias depois do clique. Erro vira cliques_do_site:<sqlstate>.
  begin
    v_cliques := podar_cliques_do_site();
  exception when others then
    v_erros := v_erros || ('cliques_do_site:' || sqlstate);
  end;

  -- [clique do site] fim
  -- Higiene: as linhas de hostname:pid da VPS, que reiniciava a cada 1 a 2
  -- minutos e nada podava.
  begin
    delete from worker_heartbeat
    where worker_id not in ('motor-fila', 'motor-planner')
      and batida_em < now() - interval '1 hour';
  exception when others then
    v_erros := v_erros || ('higiene:' || sqlstate);
  end;

  -- Reafirma a privacidade do balde de midia (de hora em hora basta, mas
  -- rodar sempre e barato e nao depende de mais um agendamento).
  begin
    update storage.buckets set public = false
    where id = 'midia-conversas' and public is distinct from false;
  exception when others then
    v_erros := v_erros || ('balde:' || sqlstate);
  end;

  -- [mensagem agendada] inicio
  -- Mensagem agendada (06/10/2026). Por ultimo: as linhas travadas pela
  -- planejadora so soltam no fim desta transacao. A planejadora cria o job
  -- da vencida; a reconciliacao fecha o que o executor nao fechou, aplica a
  -- retencao de 30 dias e conta as presas ('enviando' ha mais de 13 h), que
  -- viram agendadas_presas:<n> no planner_erro (runbook do motor). Cada
  -- agendada erra sozinha nas duas: as linhas com erro desta passagem (soma
  -- das duas) viram agendadas_erros:<n>; erro estrutural continua
  -- mensagem_agendada:<SQLSTATE> e agendada_reconciliar:<SQLSTATE>.
  begin
    v_agendadas := public.planejar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_agendadas ->> 'erros_por_linha')::integer, 0);
  exception when others then
    v_erros := v_erros || ('mensagem_agendada:' || sqlstate);
  end;

  begin
    v_reconciliadas := public.reconciliar_mensagens_agendadas();
    v_erros_agendadas := v_erros_agendadas
      + coalesce((v_reconciliadas ->> 'erros_por_linha')::integer, 0);
    v_agendadas := v_agendadas || (v_reconciliadas - 'erros_por_linha');
    if coalesce((v_agendadas ->> 'presas')::integer, 0) > 0 then
      v_erros := v_erros || ('agendadas_presas:' || (v_agendadas ->> 'presas'));
    end if;
  exception when others then
    v_erros := v_erros || ('agendada_reconciliar:' || sqlstate);
  end;

  v_agendadas := v_agendadas
    || jsonb_build_object('erros_por_linha', v_erros_agendadas);
  if v_erros_agendadas > 0 then
    v_erros := v_erros || ('agendadas_erros:' || v_erros_agendadas);
  end if;

  -- [mensagem agendada] fim
  insert into worker_heartbeat (worker_id, batida_em, ultimo_lote, ultimo_erro, ultimo_erro_em)
  values (
    'motor-planner',
    now(),
    v_holds + v_orfas + v_ofertas,
    case when array_length(v_erros, 1) is null then null
         else array_to_string(v_erros, ',') end,
    case when array_length(v_erros, 1) is null then null else now() end
  )
  on conflict (worker_id) do update
  set batida_em = now(),
      ultimo_lote = excluded.ultimo_lote,
      ultimo_erro = excluded.ultimo_erro,
      ultimo_erro_em = coalesce(excluded.ultimo_erro_em, worker_heartbeat.ultimo_erro_em);

  return jsonb_build_object(
    'holds', v_holds,
    'runs_orfas', v_orfas,
    'ofertas_expiradas', v_ofertas,
    'reguas', v_reguas,
    'erros', v_erros
    -- [automacoes de fluxo] inicio
    , 'automacoes', v_automacoes
    -- [automacoes de fluxo] fim
    -- [gasto meta] inicio
    , 'gasto_meta', v_gasto
    -- [gasto meta] fim
    -- [clique do site] inicio
    , 'cliques_do_site', v_cliques
    -- [clique do site] fim
    -- [mensagem agendada] inicio
    , 'mensagens_agendadas', v_agendadas
    -- [mensagem agendada] fim
  );
end;
$function$;

-- saude_do_motor: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.saude_do_motor()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'fila', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-fila'
    ),
    'planner', (
      select jsonb_build_object(
        'batida_em', batida_em,
        'ultimo_lote', ultimo_lote,
        'ultimo_erro', ultimo_erro
      )
      from worker_heartbeat where worker_id = 'motor-planner'
    ),
    'atrasados', (
      select count(*) from job_queue
      where status = 'pendente' and run_at < now() - interval '5 minutes'
    )
  );
$function$;

-- definir_liberacao_da_ia: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.definir_liberacao_da_ia(p_clinic_id uuid, p_liberada boolean, p_modo text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- definir_numero_da_ia: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.definir_numero_da_ia(p_clinic_id uuid, p_whatsapp_account_id uuid, p_ativo boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ia_desligar: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.ia_desligar(p_clinic_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_conversas integer := 0;
  v_jobs integer := 0;
begin
  if p_clinic_ids is null or cardinality(p_clinic_ids) = 0 then
    return jsonb_build_object('conversas', 0, 'jobs', 0);
  end if;

  update public.conversation c
     set status = 'aguardando_humano',
         awaiting_reply = c.awaiting_reply or coalesce((
           select m.author = 'paciente'
             from public.message m
            where m.conversation_id = c.id
              and not m.is_internal_note
              and m.content_type <> 'evento'
            order by m.created_at desc, m.id desc
            limit 1
         ), false)
   where c.clinic_id = any (p_clinic_ids)
     and c.status = 'ia_atendendo'
     and not public.ia_pode_atender(
       c.clinic_id,
       c.whatsapp_account_id,
       (select k.phone_key from public.contact k where k.id = c.contact_id)
     );
  get diagnostics v_conversas = row_count;

  update public.job_queue j
     set status = 'cancelado',
         last_error = 'ia_desligada'
   where j.kind = 'responder_com_ia'
     and j.status = 'pendente'
     and j.clinic_id = any (p_clinic_ids)
     and not exists (
       select 1
         from public.conversation c
        where c.id::text = j.payload ->> 'conversation_id'
          and c.status = 'ia_atendendo'
     );
  get diagnostics v_jobs = row_count;

  return jsonb_build_object('conversas', v_conversas, 'jobs', v_jobs);
end;
$function$;

-- proteger_status_ia_atendendo: corpo do banco ANTES da 20261013100000
CREATE OR REPLACE FUNCTION public.proteger_status_ia_atendendo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_chave text;
begin
  if new.status is distinct from 'ia_atendendo' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'ia_atendendo'
     and new.contact_id is not distinct from old.contact_id
  then
    return new;
  end if;
  -- Servidor (service role, SQL editor): guardado pelos outros pontos.
  if auth.uid() is null then
    return new;
  end if;

  perform 1 from public.ia_liberacao l where l.clinic_id = new.clinic_id for share;
  perform 1 from public.ia_interruptor i where i.id for share;

  select k.phone_key into v_chave
    from public.contact k
   where k.id = new.contact_id
     and k.clinic_id = new.clinic_id;

  if not public.ia_pode_atender(new.clinic_id, new.whatsapp_account_id, v_chave) then
    raise exception using errcode = '42501',
      message = 'A IA não está liberada para atender esta conversa.';
  end if;
  return new;
end;
$function$;

-- definir_contato_liberado_da_ia: a assinatura nova sai e a antiga volta
drop function if exists public.definir_contato_liberado_da_ia(uuid, text, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.definir_contato_liberado_da_ia(p_clinic_id uuid, p_telefone_e164 text, p_rotulo text, p_ativo boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean) from public, anon;
grant execute on function public.definir_contato_liberado_da_ia(uuid, text, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
