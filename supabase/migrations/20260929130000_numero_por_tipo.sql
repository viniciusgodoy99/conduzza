-- ---------------------------------------------------------------------------
-- Numero das mensagens automaticas POR TIPO de mensagem
-- ---------------------------------------------------------------------------
-- Decisao do dono (29/09/2026), sobre o desenho dos varios numeros
-- (docs/07_multiplos_numeros_whatsapp.md): a escolha do numero deixa de ser
-- uma por clinica e passa a ser uma por TIPO de mensagem automatica. Exemplo
-- dele: confirmacao sempre por um numero especifico; follow-up sempre pelo
-- numero com que o paciente falou.
--
-- Os cinco tipos (whatsapp_envio_automatico.tipo):
--
--   confirmacao        regua de confirmacao, inclusive o "Cobrar agora"
--                      (toque manual da mesma regua)
--   pos_falta          "Recuperacao depois da falta"
--   followup           follow-up de leads
--   lista_espera       oferta da vaga para a lista de espera
--   aviso_remarcacao   aviso de remarcacao
--
-- Cada tipo: "ultimo_usado" (o numero da conversa em que o paciente escreveu
-- por ultimo; sem conversa, o principal) ou "fixo" (sempre pelo numero X).
-- SEM LINHA PARA O TIPO = ULTIMO USADO.
--
-- O que NAO muda:
--   - O eco da resposta ao toque ("Presenca confirmada", payload
--     resposta_ao_paciente) sai pelo numero que recebeu (D4), sem politica:
--     o job ja nasce com esse numero e nao tem tipo.
--   - Numero desconectado espera a reconexao e nunca troca sozinho: a
--     escolha continua sem olhar connection_status.
--   - RLS e papeis de escrita: as tres policies de hoje (SELECT do membro
--     ativo; INSERT e UPDATE de administrador e gestor; ninguem apaga por
--     sessao) so olham clinic_id e continuam valendo linha a linha.
--
-- O que muda:
--
--   1. Tabela: coluna tipo (check nos cinco), PK (clinic_id, tipo). A linha
--      que existe hoje por clinica e COPIADA para os cinco tipos: nada muda
--      para quem ja escolheu. Linha fixa num numero que ja foi removido
--      (o resolvedor ja a ignorava) vira ultimo_usado antes da copia, porque
--      o gatilho exigir_cadastro_da_mesma_clinica recusa inserir escolha
--      fixa em numero removido. Producao em 29/09: zero linhas.
--   2. tipo_de_envio_do_job(kind, payload): o tipo de um job de envio.
--      executar_passo_de_regua: o cadence.kind da run (payload.cadence_run_id),
--      o que cobre o "Cobrar agora" (run da regua de confirmacao).
--      enviar_mensagem_ativa: o marcador payload.tipo_de_envio
--      ('aviso_remarcacao' ou 'lista_espera'); o eco (resposta_ao_paciente)
--      fica sem tipo. Jobs enfileirados antes do marcador (transicao): offer_id
--      e oferta da lista de espera; appointment_id com starts_at e o aviso de
--      remarcacao (o formato que so ele usa).
--   3. resolver_conta_de_envio(clinica, contato, tipo DEFAULT NULL): o fixo
--      DAQUELE tipo, senao o ultimo usado, senao o principal. SEM TIPO: so o
--      ultimo usado e o principal (nenhuma escolha fixa vale). Todo chamador
--      de envio passa o tipo; sem tipo ficam o eco (D4) e
--      garantir_conversa_aberta chamada sem numero (os executores sempre
--      passam o numero do job).
--   4. conta_de_envio e contas_de_envio ganham p_tipo DEFAULT NULL, e tipo
--      desconhecido e recusado (22023). As chamadas de hoje, sem p_tipo,
--      continuam casando com a assinatura nova (codigo publicado entre esta
--      migration e o deploy): elas passam a devolver o ultimo usado.
--   5. job_ganha_numero, numero_do_job e redistribuir_jobs_do_numero passam o
--      tipo do job. redistribuir_jobs_do_numero ganha p_tipos text[] DEFAULT
--      NULL: nulo move todos os tipos (remocao do numero); com valor, so os
--      jobs dos tipos cuja escolha mudou (tela de Automacoes).
--   6. remover_numero: a escolha fixa que apontava para o numero removido
--      volta para ultimo_usado, em todos os tipos, na mesma transacao, antes
--      de redistribuir os jobs pendentes dele.
--   7. planejar_reguas: cada secao carimba o job pelo proprio tipo
--      (confirmacao, pos_falta, followup). O corpo e o da
--      20260929110000_regua_vinculada.sql (regua vigente por consulta), que
--      esta migration pressupoe aplicada antes dela: so as tres chamadas a
--      resolver_conta_de_envio e o comentario do numero mudam. Se a 110000
--      mudar o planner de novo, este corpo precisa acompanhar.
--   8. criar_oferta_de_espera: o job da oferta leva tipo_de_envio
--      'lista_espera' no payload. Assinatura, SECURITY DEFINER, search_path
--      e grants iguais.
--
-- Janela entre esta migration e o deploy do codigo novo: a tela antiga de
-- Automacoes grava com onConflict clinic_id, que deixa de existir, e recebe
-- o erro generico ("Nao foi possivel salvar..."); a leitura antiga da
-- politica (maybeSingle) acusa erro em clinica com linhas. Nada envia por
-- numero errado: a fila e o banco ja decidem por tipo.

-- ORDEM OBRIGATORIA: o planejar_reguas desta migration e o da
-- 20260929110000_regua_vinculada com o tipo nas tres chamadas, e chama
-- regua_da_consulta. Aplicada sozinha, ela passaria e o planner falharia em
-- silencio a cada minuto (o erro so vai para worker_heartbeat). A trava
-- abaixo impede isso.
do $$
begin
  if to_regprocedure('public.regua_da_consulta(uuid,text)') is null then
    raise exception 'Aplique 20260929110000_regua_vinculada antes de 20260929130000_numero_por_tipo (planejar_reguas depende de regua_da_consulta).';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1) Tabela: tipo e PK (clinic_id, tipo)
-- ---------------------------------------------------------------------------

alter table public.whatsapp_envio_automatico
  add column tipo text;

alter table public.whatsapp_envio_automatico
  drop constraint whatsapp_envio_automatico_pkey;

-- Fixa num numero removido: o resolvedor ja ignorava, e a copia abaixo seria
-- recusada pelo gatilho de mesma clinica. Vira o que ja valia na pratica.
update public.whatsapp_envio_automatico e
   set modo = 'ultimo_usado',
       conta_fixa_id = null
 where e.modo = 'fixo'
   and exists (
     select 1 from public.whatsapp_account a
      where a.id = e.conta_fixa_id
        and a.removido_em is not null
   );

insert into public.whatsapp_envio_automatico (
  clinic_id, tipo, modo, conta_fixa_id, created_at, updated_at
)
select e.clinic_id, t.tipo, e.modo, e.conta_fixa_id, e.created_at, e.updated_at
  from public.whatsapp_envio_automatico e
 cross join unnest(
   array['pos_falta', 'followup', 'lista_espera', 'aviso_remarcacao']
 ) as t(tipo)
 where e.tipo is null;

update public.whatsapp_envio_automatico
   set tipo = 'confirmacao'
 where tipo is null;

alter table public.whatsapp_envio_automatico
  alter column tipo set not null;

alter table public.whatsapp_envio_automatico
  add constraint whatsapp_envio_automatico_tipo_check
  check (tipo in (
    'confirmacao', 'pos_falta', 'followup', 'lista_espera', 'aviso_remarcacao'
  ));

alter table public.whatsapp_envio_automatico
  add constraint whatsapp_envio_automatico_pkey
  primary key (clinic_id, tipo);

comment on table public.whatsapp_envio_automatico is
  'Politica de numero das mensagens automaticas, uma linha por tipo (decisao do dono de 29/09/2026). Sem linha para o tipo, vale ultimo_usado (o ultimo numero para o qual o paciente escreveu; senao o principal).';
comment on column public.whatsapp_envio_automatico.tipo is
  'confirmacao (inclui o Cobrar agora), pos_falta, followup, lista_espera (oferta da vaga) ou aviso_remarcacao. O eco da resposta ao toque nao tem tipo: sai pelo numero que recebeu (D4).';

-- ---------------------------------------------------------------------------
-- 2) O tipo de um job de envio
-- ---------------------------------------------------------------------------
-- Texto que nao e uuid vira nulo em vez de derrubar o insert do job (o mesmo
-- cuidado de contato_do_job). Tipo nulo = sem escolha fixa: ultimo usado.

create function public.tipo_de_envio_do_job(p_kind text, p_payload jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_kind = 'executar_passo_de_regua' then (
      select case
               when c.kind in (
                 'confirmacao', 'pos_falta', 'followup', 'lista_espera'
               ) then c.kind
             end
        from cadence_run r
        join cadence_step s on s.id = r.cadence_step_id
        join cadence c on c.id = s.cadence_id
       where r.id = case
         when p_payload->>'cadence_run_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (p_payload->>'cadence_run_id')::uuid
       end
    )
    when p_kind = 'enviar_mensagem_ativa' then
      case
        -- D4: o eco responde pelo numero que recebeu, fora da politica.
        when coalesce(p_payload->>'resposta_ao_paciente', 'false') = 'true'
          then null
        when p_payload->>'tipo_de_envio' in ('aviso_remarcacao', 'lista_espera')
          then p_payload->>'tipo_de_envio'
        -- Transicao: jobs enfileirados antes do marcador.
        when p_payload ? 'offer_id' then 'lista_espera'
        when p_payload ? 'appointment_id' and p_payload ? 'starts_at'
          then 'aviso_remarcacao'
      end
  end
$$;

comment on function public.tipo_de_envio_do_job(text, jsonb) is
  'Tipo de mensagem automatica de um job de envio: o cadence.kind da run (executar_passo_de_regua) ou payload.tipo_de_envio (enviar_mensagem_ativa). Nulo no eco da resposta ao toque (D4) e no que nao tem tipo.';

revoke all on function public.tipo_de_envio_do_job(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.tipo_de_envio_do_job(text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3) resolver_conta_de_envio com o tipo
-- ---------------------------------------------------------------------------
-- Drop e create na mesma transacao: com as duas versoes vivas, a chamada de
-- dois argumentos ficaria ambigua. As chamadas de hoje (plpgsql, resolvidas
-- na execucao) casam com o parametro novo pelo padrao nulo.

drop function public.resolver_conta_de_envio(uuid, uuid);

create function public.resolver_conta_de_envio(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_tipo text default null
)
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    -- 1. O fixo DESTE tipo, com o numero ativo. Sem tipo, nenhum fixo vale.
    (select a.id
       from whatsapp_envio_automatico e
       join whatsapp_account a on a.id = e.conta_fixa_id
      where e.clinic_id = p_clinic_id
        and e.tipo = p_tipo
        and e.modo = 'fixo'
        and a.clinic_id = p_clinic_id
        and a.removido_em is null),
    -- 2. O ultimo usado pelo paciente (D9), com o numero ativo.
    (select c.whatsapp_account_id
       from conversation c
       join whatsapp_account a on a.id = c.whatsapp_account_id
      where c.clinic_id = p_clinic_id
        and c.contact_id = p_contact_id
        and a.clinic_id = p_clinic_id
        and a.removido_em is null
      order by c.last_inbound_at desc nulls last,
               c.last_message_at desc nulls last
      limit 1),
    -- 3. O principal ativo.
    (select a.id
       from whatsapp_account a
      where a.clinic_id = p_clinic_id
        and a.principal
        and a.removido_em is null)
  )
$$;

comment on function public.resolver_conta_de_envio(uuid, uuid, text) is
  'Numero de envio de uma mensagem automatica: o fixo do tipo (numero ativo), senao a conversa em que o paciente escreveu por ultimo (numero ativo), senao o principal. Sem tipo: so os dois ultimos. Desconectado nao e criterio.';

revoke all on function public.resolver_conta_de_envio(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolver_conta_de_envio(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) As portas da aplicacao: conta_de_envio e contas_de_envio
-- ---------------------------------------------------------------------------

drop function public.conta_de_envio(uuid, uuid);

create function public.conta_de_envio(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_tipo text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not exists (
    select 1 from public.user_active_clinic_ids() as m(clinic_id)
     where m.clinic_id = p_clinic_id
  ) then
    raise exception using errcode = '42501',
      message = 'Você não tem acesso a esta clínica.';
  end if;
  -- Tipo escrito errado cairia calado no ultimo usado: melhor recusar.
  if p_tipo is not null and p_tipo not in (
    'confirmacao', 'pos_falta', 'followup', 'lista_espera', 'aviso_remarcacao'
  ) then
    raise exception using errcode = '22023',
      message = 'Tipo de mensagem automática desconhecido.';
  end if;
  return public.resolver_conta_de_envio(p_clinic_id, p_contact_id, p_tipo);
end;
$$;

revoke all on function public.conta_de_envio(uuid, uuid, text)
  from public, anon;
grant execute on function public.conta_de_envio(uuid, uuid, text)
  to authenticated, service_role;

drop function public.contas_de_envio(uuid, uuid[]);

create function public.contas_de_envio(
  p_clinic_id uuid,
  p_contact_ids uuid[],
  p_tipo text default null
)
returns table (
  contact_id uuid,
  whatsapp_account_id uuid,
  nome text,
  connection_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is not null and not exists (
    select 1 from public.user_active_clinic_ids() as m(clinic_id)
     where m.clinic_id = p_clinic_id
  ) then
    raise exception using errcode = '42501',
      message = 'Você não tem acesso a esta clínica.';
  end if;
  if p_tipo is not null and p_tipo not in (
    'confirmacao', 'pos_falta', 'followup', 'lista_espera', 'aviso_remarcacao'
  ) then
    raise exception using errcode = '22023',
      message = 'Tipo de mensagem automática desconhecido.';
  end if;

  -- MATERIALIZED: a escolha roda uma vez por contato, e nao uma vez por par
  -- (contato, numero) dentro do join.
  return query
    with escolha as materialized (
      select x.id,
             public.resolver_conta_de_envio(p_clinic_id, x.id, p_tipo) as conta
        from (
          select distinct y.id
            from unnest(coalesce(p_contact_ids, '{}'::uuid[])) as y(id)
           where y.id is not null
        ) x
    )
    select e.id, a.id, a.nome, a.connection_status
      from escolha e
      left join whatsapp_account a on a.id = e.conta;
end;
$$;

revoke all on function public.contas_de_envio(uuid, uuid[], text)
  from public, anon;
grant execute on function public.contas_de_envio(uuid, uuid[], text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) A fila: o gatilho, a execucao e o recarimbo usam o tipo do job
-- ---------------------------------------------------------------------------

create or replace function public.job_ganha_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     and new.whatsapp_account_id is null
     and new.kind in ('enviar_mensagem_ativa', 'executar_passo_de_regua')
  then
    new.whatsapp_account_id := public.resolver_conta_de_envio(
      new.clinic_id,
      public.contato_do_job(new.clinic_id, new.payload),
      public.tipo_de_envio_do_job(new.kind, new.payload)
    );
  end if;

  if new.whatsapp_account_id is not null and not exists (
    select 1 from whatsapp_account
     where id = new.whatsapp_account_id and clinic_id = new.clinic_id
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'O número informado não pertence a esta clínica.';
  end if;

  return new;
end;
$$;

create or replace function public.numero_do_job(p_job_id uuid, p_worker text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_job job_queue%rowtype;
  v_removido_em timestamptz;
  v_nova uuid;
begin
  select * into v_job
    from job_queue
   where id = p_job_id
     and status = 'executando'
     and locked_by = p_worker
   for update;
  if not found then
    return jsonb_build_object('estado', 'sem_posse');
  end if;

  if v_job.kind not in (
    'enviar_mensagem_ativa', 'executar_passo_de_regua', 'baixar_midia'
  ) then
    return jsonb_build_object('estado', 'nao_se_aplica');
  end if;

  if v_job.whatsapp_account_id is not null then
    select removido_em into v_removido_em
      from whatsapp_account
     where id = v_job.whatsapp_account_id;
    if v_removido_em is null then
      return jsonb_build_object(
        'estado', 'ok',
        'whatsapp_account_id', v_job.whatsapp_account_id
      );
    end if;
    if v_job.kind = 'baixar_midia'
       or coalesce(v_job.payload ->> 'resposta_ao_paciente', 'false') = 'true'
       or exists (select 1 from message where job_id = v_job.id)
    then
      return jsonb_build_object('estado', 'numero_removido');
    end if;
  end if;

  if v_job.kind = 'baixar_midia' then
    -- Midia baixa pelo numero que RECEBEU a mensagem.
    select m.whatsapp_account_id, a.removido_em
      into v_nova, v_removido_em
      from message m
      left join whatsapp_account a on a.id = m.whatsapp_account_id
     where m.clinic_id = v_job.clinic_id
       and m.id = case
         when v_job.payload->>'message_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (v_job.payload->>'message_id')::uuid
       end;
    if v_removido_em is not null then
      return jsonb_build_object('estado', 'numero_removido');
    end if;
  else
    -- Pela escolha DO TIPO do job (29/09/2026).
    v_nova := resolver_conta_de_envio(
      v_job.clinic_id,
      contato_do_job(v_job.clinic_id, v_job.payload),
      tipo_de_envio_do_job(v_job.kind, v_job.payload)
    );
  end if;

  if v_nova is distinct from v_job.whatsapp_account_id then
    update job_queue
       set whatsapp_account_id = v_nova
     where id = v_job.id;
  end if;

  if v_nova is null then
    return jsonb_build_object('estado', 'sem_numero');
  end if;
  return jsonb_build_object('estado', 'ok', 'whatsapp_account_id', v_nova);
end;
$$;

-- Assinatura nova (p_tipos no fim, padrao nulo): drop e create. A chamada de
-- hoje, so com p_account_id, continua casando.
drop function public.redistribuir_jobs_do_numero(uuid);

create function public.redistribuir_jobs_do_numero(
  p_account_id uuid,
  p_tipos text[] default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_total integer;
begin
  with alvo as (
    select j.id,
           resolver_conta_de_envio(
             j.clinic_id,
             contato_do_job(j.clinic_id, j.payload),
             tipo_de_envio_do_job(j.kind, j.payload)
           ) as nova
      from job_queue j
     where j.whatsapp_account_id = p_account_id
       and j.status = 'pendente'
       and j.kind in ('enviar_mensagem_ativa', 'executar_passo_de_regua')
       and not exists (select 1 from message m where m.job_id = j.id)
       -- O eco da resposta ao toque ("Presenca confirmada") e resposta a uma
       -- mensagem que chegou por ESTE numero (decisao D4): nunca troca de
       -- numero. Na troca de politica ele fica; na remocao, remover_numero o
       -- cancela junto com a conversa.
       and coalesce(j.payload ->> 'resposta_ao_paciente', 'false') <> 'true'
       -- Troca de politica: so os tipos cuja escolha mudou. Nulo (remocao
       -- do numero): todos.
       and (
         p_tipos is null
         or tipo_de_envio_do_job(j.kind, j.payload) = any (p_tipos)
       )
  )
  update job_queue j
     set whatsapp_account_id = a.nova
    from alvo a
   where j.id = a.id
     and j.status = 'pendente'
     and j.whatsapp_account_id = p_account_id
     and a.nova is distinct from p_account_id;
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

revoke all on function public.redistribuir_jobs_do_numero(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.redistribuir_jobs_do_numero(uuid, text[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 6) remover_numero: a escolha fixa no numero removido volta ao ultimo usado
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 29/09/2026) com um passo novo,
-- logo depois de marcar a remocao e antes de redistribuir os jobs.
-- Assinatura, SECURITY DEFINER, search_path e grants iguais.

create or replace function public.remover_numero(
  p_clinic_id uuid,
  p_account_id uuid,
  p_removido_por uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 7) planejar_reguas: cada secao pelo proprio tipo
-- ---------------------------------------------------------------------------
-- Corpo da 20260929110000_regua_vinculada.sql. Mudam so o comentario do
-- NUMERO e as tres chamadas a resolver_conta_de_envio, que passam o tipo da
-- secao ('confirmacao', 'pos_falta', 'followup'). Assinatura, SECURITY
-- DEFINER, search_path e grants iguais.

create or replace function public.planejar_reguas()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_confirmacao integer := 0;
  v_pos_falta integer := 0;
  v_followup integer := 0;
begin
  -- NUMERO (varios numeros, 25/09/2026; por tipo, 29/09/2026): todo job
  -- nasce com o numero de envio carimbado por resolver_conta_de_envio com o
  -- TIPO da secao (confirmacao, pos_falta, followup): o fixo daquele tipo,
  -- senao o ultimo usado pelo paciente, senao o principal.
  --
  -- REGUA VIGENTE (regua vinculada, 29/09/2026): a regua de cada consulta,
  -- na confirmacao e no pos falta, e a de regua_da_consulta (procedimento >
  -- profissional > especialidade > geral, reforcada vence no nivel,
  -- desempate por created_at e id). Uma so por consulta.
  --
  -- TOQUE REPETIDO QUANDO A VIGENTE MUDA: a vinculada nasce com os MESMOS
  -- offsets da geral (criarReguaDeExcecaoAction copia os passos), e a chave
  -- de cadence_run leva o cadence_step_id. Ligar, desligar ou trocar a
  -- regua vigente logo depois de um toque faria o passo de mesmo offset da
  -- regua nova, ja vencido e ainda dentro da folga de 30 minutos, nascer de
  -- novo e sair em seguida. Por isso um passo JA VENCIDO (scheduled_for <=
  -- now(), a recuperacao da folga) so e materializado quando a consulta nao
  -- recebeu nenhum toque do mesmo tipo nos ultimos 30 minutos, de qualquer
  -- regua (inclusive o "Cobrar agora"). Passo futuro continua nascendo
  -- adiantado, como sempre. A exclusao de uma vinculada leva as runs dela
  -- no cascade e apagaria essa prova: a excluirReguaAction recusa excluir
  -- vinculada que enviou nos ultimos 30 minutos. O toque que perguntava pelo
  -- horario ANTIGO de uma consulta remarcada depois dele nao trava (a
  -- remarcacao volta a pedir confirmacao, decisao do dono de 24/09).
  -- Limitacao conhecida: apagar UMA mensagem (passo) que saiu nos ultimos
  -- 30 minutos e, em seguida, mudar a regua vigente da consulta (ou recriar
  -- o mesmo momento) pode repetir aquele toque uma vez; recriar o mesmo
  -- momento ja repetia antes da regua vinculada.
  --
  -- Confirmacao: eixo em appointment.starts_at.
  --
  -- CUSTO: regua_da_consulta e uma funcao SQL com FROM e ORDER BY (nunca e
  -- inlinada), cara demais para rodar por consulta futura a cada minuto.
  -- `candidatas` (materialized, para o planejador nao avaliar a funcao antes
  -- do filtro) so deixa passar a consulta que tem, em ALGUMA regua ativa de
  -- confirmacao da clinica, um passo dentro do horizonte. E condicao
  -- necessaria de toda linha de `devidas`, entao o resultado nao muda. O
  -- HORIZONTE aparece duas vezes (aqui e em `devidas`): mudar os dois juntos.
  with candidatas as materialized (
    select a.id, a.clinic_id, a.contact_id, a.starts_at
    from appointment a
    where a.send_confirmation
      and a.status in ('agendado', 'aguardando_confirmacao')
      -- Paciente pediu para remarcar: perguntar se ele confirma a consulta
      -- que ele quer trocar confunde e atrapalha a recepcao que esta
      -- remarcando. Quando o pedido for resolvido (coluna limpa), os toques
      -- que ainda couberem voltam a ser planejados.
      and a.remarcacao_pedida_em is null
      and a.starts_at > now()
      and exists (
        select 1
          from cadence c2
          join cadence_step s2 on s2.cadence_id = c2.id
         where c2.clinic_id = a.clinic_id
           and c2.kind = 'confirmacao'
           and c2.active
           and a.starts_at + make_interval(mins => s2.offset_minutes)
               between now() - interval '30 minutes'
                   and now() + interval '60 minutes'
      )
  ),
  devidas as (
    select
      a.clinic_id,
      s.id as step_id,
      a.contact_id,
      a.id as appointment_id,
      a.starts_at + make_interval(mins => s.offset_minutes) as scheduled_for
    from candidatas a
    cross join lateral (
      select public.regua_da_consulta(a.id, 'confirmacao') as id
    ) c
    join cadence_step s on s.cadence_id = c.id
    where a.starts_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
      and not (
        a.starts_at + make_interval(mins => s.offset_minutes) <= now()
        and exists (
          select 1
            from cadence_run r
            join cadence_step s3 on s3.id = r.cadence_step_id
            join cadence c3 on c3.id = s3.cadence_id
           where r.appointment_id = a.id
             and c3.kind = 'confirmacao'
             and r.sent_at > now() - interval '30 minutes'
             -- O toque que perguntava pelo horario ANTIGO nao trava a
             -- confirmacao do horario novo: toda remarcacao volta a pedir
             -- confirmacao (decisao do dono de 24/09).
             and not exists (
               select 1 from appointment_status_history h
                where h.appointment_id = a.id
                  and h.kind = 'remarcacao'
                  and h.previous_starts_at is distinct from h.new_starts_at
                  and h.changed_at > r.sent_at
             )
        )
      )
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0,
           resolver_conta_de_envio(clinic_id, contact_id, 'confirmacao')
    from novas
    returning 1
  )
  select count(*)::integer into v_confirmacao from jobs;

  -- Pos falta: eixo no instante em que a falta foi marcada.
  with faltas as (
    select
      a.clinic_id,
      a.contact_id,
      a.id as appointment_id,
      (
        select max(h.changed_at)
        from appointment_status_history h
        where h.appointment_id = a.id and h.status = 'faltou'
      ) as marcada_em
    from appointment a
    where a.status = 'faltou'
      and a.starts_at > now() - interval '30 days'
  ),
  devidas as (
    select
      f.clinic_id,
      s.id as step_id,
      f.contact_id,
      f.appointment_id,
      f.marcada_em + make_interval(mins => s.offset_minutes) as scheduled_for
    from faltas f
    cross join lateral (
      select public.regua_da_consulta(f.appointment_id, 'pos_falta') as id
    ) c
    join cadence_step s on s.cadence_id = c.id
    where f.marcada_em is not null
      and f.marcada_em + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
      -- A mesma trava da confirmacao: passo ja vencido so nasce se a
      -- consulta nao recebeu toque de pos falta nos ultimos 30 minutos.
      and not (
        f.marcada_em + make_interval(mins => s.offset_minutes) <= now()
        and exists (
          select 1
            from cadence_run r
            join cadence_step s3 on s3.id = r.cadence_step_id
            join cadence c3 on c3.id = s3.cadence_id
           where r.appointment_id = f.appointment_id
             and c3.kind = 'pos_falta'
             and r.sent_at > now() - interval '30 minutes'
        )
      )
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, appointment_id, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           0,
           resolver_conta_de_envio(clinic_id, contact_id, 'pos_falta')
    from novas
    returning 1
  )
  select count(*)::integer into v_pos_falta from jobs;

  -- Follow-up: eixo na entrada da etapa (funnel_stage_changed_at).
  -- O contato so esta no recorte enquanto CONTINUA na etapa da regua e sem
  -- resposta desde que entrou: sair ou responder e a parada da spec 7.2. O
  -- join com funnel_stage_def descarta regua orfa de etapa excluida (defesa
  -- em profundidade; o gatilho da jornada ja impede a exclusao).
  --
  -- IMPORTACAO NAO INSCREVE (decisao do dono de 24/09/2026): o contato criado
  -- pela planilha tem o relogio da etapa carimbado no insert, igual a qualquer
  -- outro, mas esse relogio nao e um ato de ninguem. Enquanto ele nao mudar
  -- de etapa (funnel_stage_changed_at continua igual ao created_at, que o
  -- insert grava com o MESMO now()), o follow-up nao o alcanca. A primeira
  -- mudanca de etapa, ato explicito de alguem (inclusive em massa), move o
  -- relogio e inscreve.
  --
  -- O job de follow-up nasce com prioridade 1: nunca passa na frente de
  -- confirmacao, pos falta, resposta ao paciente ou oferta de espera.
  with devidas as (
    select
      ct.clinic_id,
      s.id as step_id,
      ct.id as contact_id,
      ct.funnel_stage_changed_at
        + make_interval(mins => s.offset_minutes) as scheduled_for
    from contact ct
    join cadence c
      on c.clinic_id = ct.clinic_id
     and c.kind = 'followup'
     and c.active
     and c.trigger_stage = ct.funnel_stage
    join funnel_stage_def d
      on d.clinic_id = ct.clinic_id and d.chave = ct.funnel_stage
    join cadence_step s on s.cadence_id = c.id
    where s.offset_minutes >= 0
      and not (
        ct.criado_por_importacao
        and ct.funnel_stage_changed_at <= ct.created_at
      )
      and (ct.last_contact_at is null
           or ct.last_contact_at <= ct.funnel_stage_changed_at)
      and ct.funnel_stage_changed_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
  ),
  novas as (
    insert into cadence_run (
      clinic_id, cadence_step_id, contact_id, appointment_id, scheduled_for
    )
    select clinic_id, step_id, contact_id, null, scheduled_for
    from devidas
    on conflict (cadence_step_id, contact_id, appointment_id, scheduled_for) do nothing
    returning id, clinic_id, contact_id, scheduled_for
  ),
  jobs as (
    insert into job_queue (
      clinic_id, kind, payload, run_at, prioridade, whatsapp_account_id
    )
    select clinic_id, 'executar_passo_de_regua',
           jsonb_build_object('cadence_run_id', id),
           greatest(scheduled_for, now()),
           1,
           resolver_conta_de_envio(clinic_id, contact_id, 'followup')
    from novas
    returning 1
  )
  select count(*)::integer into v_followup from jobs;

  return jsonb_build_object(
    'confirmacao', v_confirmacao,
    'pos_falta', v_pos_falta,
    'followup', v_followup
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8) criar_oferta_de_espera: o job da oferta diz o seu tipo
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 29/09/2026); so o payload do job
-- ganha tipo_de_envio. Assinatura, SECURITY DEFINER, search_path (vazio) e
-- grants iguais.

create or replace function public.criar_oferta_de_espera(
  p_clinic_id uuid,
  p_source_appointment_id uuid,
  p_professional_id uuid,
  p_slot_starts_at timestamp with time zone,
  p_slot_ends_at timestamp with time zone,
  p_expires_at timestamp with time zone,
  p_destinatarios jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_offer_id uuid;
begin
  begin
    insert into public.waitlist_offer (
      clinic_id, source_appointment_id, professional_id,
      slot_starts_at, slot_ends_at, expires_at,
      offered_to, matched_waitlist_ids
    )
    select
      p_clinic_id, p_source_appointment_id, p_professional_id,
      p_slot_starts_at, p_slot_ends_at, p_expires_at,
      -- Os dois arrays sao PAREADOS por posicao: a ordinalidade do jsonb
      -- manda nos dois, senao o indice do aceite apontaria para a entrada
      -- de outra pessoa.
      coalesce(array_agg((d->>'contact_id')::uuid order by ord), '{}'::uuid[]),
      coalesce(array_agg((d->>'waitlist_id')::uuid order by ord), '{}'::uuid[])
    from jsonb_array_elements(p_destinatarios) with ordinality as t(d, ord)
    returning id into v_offer_id;
  exception when unique_violation then
    -- Onda concorrente ja criou a oferta deste horario: nada a fazer.
    return null;
  end;

  -- As mensagens saem pelo executor de envio ativo EXISTENTE, que reconfere
  -- consentimento e grava custo. O offer_id amarra cada envio a oferta: o
  -- executor so envia enquanto ela esta aberta, com folga de prazo e com a
  -- vaga livre (desconexao com retry, canal ocupado, cancelamento e vaga
  -- preenchida deixam de entregar oferta morta).
  --
  -- NUMERO: o destinatario traz whatsapp_account_id (o de contas_de_envio
  -- com o tipo 'lista_espera'). Sem ele, o gatilho job_ganha_numero resolve
  -- pela escolha do tipo, que tipo_de_envio ('lista_espera', 29/09/2026)
  -- diz qual e; o recarimbo da remocao e da troca de escolha tambem.
  insert into public.job_queue (clinic_id, kind, payload, whatsapp_account_id)
  select p_clinic_id,
         'enviar_mensagem_ativa',
         jsonb_build_object(
           'contact_id', d->>'contact_id',
           'body', d->>'body',
           'offer_id', v_offer_id,
           'tipo_de_envio', 'lista_espera'
         ),
         case
           when d->>'whatsapp_account_id'
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (d->>'whatsapp_account_id')::uuid
         end
    from jsonb_array_elements(p_destinatarios) d;

  return v_offer_id;
end;
$$;
