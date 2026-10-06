-- Corpos lidos da producao em 06/10/2026, antes da migration 20261006140000.
-- Passo 3 do ROLLBACK manual da migration (cabecalho dela). Nao aplicar fora
-- de um rollback.

-- remover_numero: corpo do banco ANTES da 20261006140000
CREATE OR REPLACE FUNCTION public.remover_numero(p_clinic_id uuid, p_account_id uuid, p_removido_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conta whatsapp_account%rowtype;
  v_jobs integer;
  v_conversas uuid[];
begin
  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp_account:' || p_clinic_id::text, 0)
  );

  select * into v_conta
    from whatsapp_account
   where id = p_account_id
     and clinic_id = p_clinic_id
   for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Número não encontrado nesta clínica.';
  end if;
  if v_conta.removido_em is not null then
    return jsonb_build_object(
      'ok', true,
      'ja_removido', true,
      'jobs_redistribuidos', 0,
      'conversas_encerradas', 0
    );
  end if;
  if v_conta.principal and exists (
    select 1 from whatsapp_account
     where clinic_id = p_clinic_id
       and removido_em is null
       and id <> p_account_id
  ) then
    raise exception using errcode = '55000',
      message = 'Escolha outro número como principal antes de remover este.';
  end if;

  update whatsapp_account
     set removido_em = now(),
         removido_por = p_removido_por,
         principal = false,
         connection_status = 'desconectado',
         disconnected_at = case
           when connection_status <> 'desconectado' then now()
           else disconnected_at
         end
   where id = p_account_id;

  update whatsapp_account_secret
     set instance_token = null,
         qr_code = null,
         qr_code_expires_at = null,
         webhook_secret = default
   where account_id = p_account_id;

  -- Decisao do dono (29/09/2026): o tipo que saia "sempre por este numero"
  -- volta para o ultimo numero usado pelo paciente. Antes da redistribuicao,
  -- para os jobs pendentes ja cairem na escolha nova.
  update whatsapp_envio_automatico
     set modo = 'ultimo_usado',
         conta_fixa_id = null
   where clinic_id = p_clinic_id
     and conta_fixa_id = p_account_id;

  v_jobs := redistribuir_jobs_do_numero(p_account_id);

  -- Ecos pendentes deste numero respondiam a conversas que estao sendo
  -- encerradas agora; sair por outro numero seria mensagem de um numero que
  -- o paciente nao usou (D4). Cancelados, sem envio.
  update job_queue
     set status = 'cancelado',
         last_error = 'numero_removido'
   where whatsapp_account_id = p_account_id
     and status = 'pendente'
     and payload ->> 'resposta_ao_paciente' = 'true'
     and not exists (select 1 from message m where m.job_id = job_queue.id);

  with encerradas as (
    update conversation
       set status = 'resolvida',
           awaiting_reply = false
     where clinic_id = p_clinic_id
       and whatsapp_account_id = p_account_id
       and status <> 'resolvida'
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_conversas
    from encerradas;

  insert into message (
    clinic_id, conversation_id, direction, author, author_user_id,
    content_type, body, billable, cost_cents
  )
  select p_clinic_id, c.id, 'saida', 'sistema', p_removido_por,
         'evento',
         format(
           'Conversa encerrada porque o número "%s" foi removido da clínica.',
           v_conta.nome
         ),
         false, 0
    from unnest(v_conversas) as c(id);

  return jsonb_build_object(
    'ok', true,
    'ja_removido', false,
    'jobs_redistribuidos', v_jobs,
    'conversas_encerradas', cardinality(v_conversas)
  );
end;
$function$;

-- motor_manutencao: corpo do banco ANTES da 20261006140000
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
  );
end;
$function$;

-- atendimento_do_periodo: corpo do banco ANTES da 20261006140000
CREATE OR REPLACE FUNCTION public.atendimento_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
        from janelas j
        cross join lateral (
          with candidatas as (
            select conversation_id, min(created_at) as entrada_em
              from message
             where clinic_id = p_clinic_id and direction = 'entrada'
               and created_at >= j.de and created_at < j.ate
             group by 1
          ), elegiveis as (
            -- Garante que e a primeira entrada DA CONVERSA, nao so da janela.
            select c.* from candidatas c
             where not exists (
                     select 1 from message ant
                      where ant.conversation_id = c.conversation_id
                        and ant.direction = 'entrada'
                        and ant.created_at < c.entrada_em
                   )
          ), medidas as (
            select e.entrada_em,
                   (select min(m.created_at) from message m
                     where m.conversation_id = e.conversation_id
                       and m.direction = 'saida' and m.author = 'usuario'
                       and not m.is_internal_note
                       and m.created_at > e.entrada_em) as resposta_em
              from elegiveis e
          )
          select jsonb_build_object(
            'conversas_iniciadas', (
              select count(*) from conversation cv
               where cv.clinic_id = p_clinic_id
                 and cv.created_at >= j.de and cv.created_at < j.ate
            ),
            'primeira_resposta', (
              select jsonb_build_object(
                'conversas', count(*),
                'respondidas', count(resposta_em),
                'mediana_segundos', round(percentile_cont(0.5) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric),
                'p90_segundos', round(percentile_cont(0.9) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric)
              ) from medidas
            ),
            'mensagens', (
              select jsonb_build_object(
                'por_autor', coalesce((
                  select jsonb_object_agg(t.author, t.n)
                    from (
                      select author, count(*) as n from message
                       where clinic_id = p_clinic_id
                         and created_at >= j.de and created_at < j.ate
                         and not is_internal_note
                       group by 1
                    ) t
                ), '{}'::jsonb),
                'entrada', count(*) filter (where direction = 'entrada'),
                'saida', count(*) filter (where direction = 'saida' and not is_internal_note),
                'notas_internas', count(*) filter (where is_internal_note)
              )
                from message
               where clinic_id = p_clinic_id
                 and created_at >= j.de and created_at < j.ate
            )
          ) as corpo
        ) bloco
    )
  end
$function$;

-- validar_atividade: corpo do banco ANTES da 20261006140000
CREATE OR REPLACE FUNCTION public.validar_atividade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_fuso text;
begin
  if tg_op = 'INSERT' then
    -- Autoria. Com sessao, a atividade e sempre em nome de quem esta usando
    -- e de origem manual (a policy de INSERT confere de novo). Sem sessao
    -- (motor, service role) valem os checks da tabela.
    if v_uid is not null then
      if new.origem is distinct from 'manual' then
        raise exception 'Atividade criada por uma pessoa tem origem manual.'
          using errcode = '42501';
      end if;
      if new.created_by is null then
        new.created_by := v_uid;
      elsif new.created_by <> v_uid then
        raise exception 'A atividade é criada em nome de quem está usando o sistema.'
          using errcode = '42501';
      end if;
      new.created_at := now();
    end if;
    if new.origem = 'automacao' and new.automacao_id is null then
      raise exception 'Atividade criada por automação precisa da automação de origem.'
        using errcode = '23514';
    end if;
    if new.status is distinct from 'pendente' then
      raise exception 'Uma atividade nasce pendente.'
        using errcode = '23514';
    end if;
    new.completed_at := null;
    new.completed_by := null;
    new.canceled_at := null;
    new.canceled_by := null;
  else
    -- Travas
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma atividade não muda de clínica.'
        using errcode = '23514';
    end if;
    if new.contact_id is distinct from old.contact_id then
      raise exception 'Uma atividade não muda de contato. Crie outra para o contato certo.'
        using errcode = '23514';
    end if;
    if new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.origem is distinct from old.origem then
      raise exception 'Quem criou a atividade, quando e como não mudam.'
        using errcode = '23514';
    end if;
    -- automacao_id so pode virar nulo (a FK da Leva B pode limpar ao apagar
    -- a regra); trocar de regra, nunca.
    if new.automacao_id is distinct from old.automacao_id
       and new.automacao_id is not null then
      raise exception 'A automação de origem de uma atividade não muda.'
        using errcode = '23514';
    end if;

    -- Carimbos: so o gatilho escreve. Mudou o status, carimba com a sessao
    -- (nula para o service role) e limpa o outro par; reabrir limpa tudo.
    -- Status igual, os carimbos ficam como estavam.
    if new.status is distinct from old.status then
      if new.status = 'concluida' then
        new.completed_at := now();
        new.completed_by := v_uid;
        new.canceled_at := null;
        new.canceled_by := null;
      elsif new.status = 'cancelada' then
        new.canceled_at := now();
        new.canceled_by := v_uid;
        new.completed_at := null;
        new.completed_by := null;
      else
        new.completed_at := null;
        new.completed_by := null;
        new.canceled_at := null;
        new.canceled_by := null;
      end if;
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
      new.canceled_at := old.canceled_at;
      new.canceled_by := old.canceled_by;
    end if;
  end if;

  -- Responsavel: membro ATIVO desta clinica. So quando e definido ou
  -- trocado: alguem que saiu da equipe depois nao trava concluir, adiar ou
  -- reatribuir a atividade.
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if not exists (
      select 1 from public.clinic_member m
       where m.clinic_id = new.clinic_id
         and m.user_id = new.assignee_user_id
         and m.status = 'ativo'
    ) then
      raise exception 'O responsável precisa ser alguém ativo da equipe desta clínica.'
        using errcode = '23514';
    end if;
  end if;

  -- Conversa: da mesma clinica e do mesmo contato.
  if new.conversation_id is not null
     and (tg_op = 'INSERT' or new.conversation_id is distinct from old.conversation_id) then
    if not exists (
      select 1 from public.conversation c
       where c.id = new.conversation_id
         and c.clinic_id = new.clinic_id
         and c.contact_id = new.contact_id
    ) then
      raise exception 'A conversa informada não é deste contato.'
        using errcode = '23514';
    end if;
  end if;

  -- Prazo com hora: o dia sai da hora, no fuso da clinica (regra 3.6).
  -- Recalcula quando o prazo mexe; a troca do fuso da clinica recalcula
  -- todas as que tem hora pelo gatilho recalcular_dia_das_atividades (em
  -- clinic), que passa por aqui com o fuso novo ja gravado.
  if new.due_at is not null
     and (tg_op = 'INSERT'
          or new.due_at is distinct from old.due_at
          or new.due_on is distinct from old.due_on) then
    select c.timezone into v_fuso from public.clinic c where c.id = new.clinic_id;
    new.due_on := (new.due_at at time zone coalesce(v_fuso, 'America/Fortaleza'))::date;
  end if;

  return new;
end;
$function$;

-- claim_jobs: corpo do banco ANTES da 20261006140000
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
    where (status = 'pendente' and run_at <= now())
       or (status = 'executando'
           and locked_at < now() - interval '5 minutes'
           and attempts < max_attempts)
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$function$;
