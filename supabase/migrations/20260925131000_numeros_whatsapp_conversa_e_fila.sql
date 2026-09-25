-- ---------------------------------------------------------------------------
-- Mais de um numero de WhatsApp por clinica, Fase 1B (expansao): conversa,
-- mensagem e fila ganham o numero
-- ---------------------------------------------------------------------------
-- Desenho aprovado: docs/07_multiplos_numeros_whatsapp.md (25/09/2026).
-- Depende da 20260925130000_numeros_whatsapp_conta.sql (Fase 1A).
--
-- O que muda para o codigo de hoje: NADA. Tudo aqui e coluna nova nulavel,
-- gatilho que preenche sozinho e parametro novo com padrao nulo:
--
--   - conversation.whatsapp_account_id: o gatilho conversa_ganha_numero da o
--     principal a quem vem sem numero. Conversa em clinica SEM conta (muitos
--     testes fazem isso, achado 3) fica com nulo, e o numero que a clinica
--     ganhar depois adota essas conversas (adotar_conversas_orfas). NOT NULL
--     so no contrato (Fase 3).
--   - message.whatsapp_account_id: desnormalizado, SEMPRE o da conversa
--     (mensagem_herda_numero sobrescreve o que vier), e imutavel.
--   - job_queue.whatsapp_account_id: job de envio nasce carimbado pela mesma
--     regra de conta_de_envio (job_ganha_numero). O executor de hoje nao le a
--     coluna; a Fase 2 passa a usar numero_do_job.
--   - RPCs com parametro de numero novo no FIM, padrao nulo (drop e create na
--     mesma transacao, grants refeitos so para service_role, como antes):
--     reservar_slot_envio_v2, ingest_inbound_message, garantir_conversa_aberta
--     e registrar_apagamento_do_whatsapp. Nulo = principal (entrada e slot) ou
--     conta_de_envio (garantir). As chamadas nomeadas de hoje continuam
--     casando com a assinatura nova.
--   - ingest_inbound_message ganha o filtro de numero proprio (achado 1):
--     mensagem cujo remetente e um numero ATIVO da propria clinica e
--     ignorada ('ignorada': 'numero_proprio'), sem criar contato nem conversa.
--     O resultado continua com as mesmas chaves (inserted false, ids nulos),
--     que o webhook de hoje ja trata como "nada a fazer".
--   - planejar_reguas e criar_oferta_de_espera: so o corpo muda (carimbam o
--     numero). Assinatura, SECURITY DEFINER, search_path e grants iguais.
--
-- Backfill: conversa com o principal da clinica, mensagem com o numero da
-- conversa, job de envio pendente ou executando com o principal. O
-- set_updated_at fica desligado durante o backfill para updated_at
-- continuar dizendo quando a linha mudou de verdade. Volume em 25/09: cerca
-- de 170 conversas, 5,4 mil mensagens, zero jobs pendentes (o ensaio inteiro,
-- 1A e 1B, roda em cerca de 1,5 s). As linhas atualizadas
-- geram eventos de Realtime (conversation e message estao na publicacao):
-- melhor aplicar fora do horario de pico.
--
-- RPCs novas que a Fase 2 vai usar (todas so service_role, menos
-- conta_de_envio e contas_de_envio, que conferem a clinica da sessao):
-- conta_de_envio, contas_de_envio, numero_do_job, redistribuir_jobs_do_numero,
-- definir_numero_principal e remover_numero.

-- ---------------------------------------------------------------------------
-- 1) Colunas (nulaveis; FK NO ACTION)
-- ---------------------------------------------------------------------------
-- NO ACTION, e nao RESTRICT: apagar a clinica apaga numero, conversa,
-- mensagem e job no mesmo comando, e a conferencia da FK acontece no fim
-- dele, quando os filhos ja se foram. Numero nao se apaga fora disso
-- (a remocao e logica).

alter table public.conversation
  add column whatsapp_account_id uuid
    references public.whatsapp_account (id);

alter table public.message
  add column whatsapp_account_id uuid
    references public.whatsapp_account (id);

alter table public.job_queue
  add column whatsapp_account_id uuid
    references public.whatsapp_account (id);

comment on column public.conversation.whatsapp_account_id is
  'Numero da clinica desta conversa (uma conversa por numero). Nulo so em clinica sem numero ativo; NOT NULL no contrato da Fase 3.';
comment on column public.message.whatsapp_account_id is
  'Copia do numero da conversa, gravada pelo gatilho mensagem_herda_numero. Imutavel.';
comment on column public.job_queue.whatsapp_account_id is
  'Numero pelo qual o job envia. Carimbado no enfileiramento (job_ganha_numero) e conferido na execucao (numero_do_job).';

-- ---------------------------------------------------------------------------
-- 2) Backfill
-- ---------------------------------------------------------------------------

alter table public.conversation disable trigger set_updated_at;
alter table public.message disable trigger set_updated_at;
alter table public.job_queue disable trigger set_updated_at;

update public.conversation c
   set whatsapp_account_id = a.id
  from public.whatsapp_account a
 where a.clinic_id = c.clinic_id
   and a.principal
   and a.removido_em is null
   and c.whatsapp_account_id is null;

update public.message m
   set whatsapp_account_id = c.whatsapp_account_id
  from public.conversation c
 where c.id = m.conversation_id
   and c.whatsapp_account_id is not null
   and m.whatsapp_account_id is null;

update public.job_queue j
   set whatsapp_account_id = a.id
  from public.whatsapp_account a
 where a.clinic_id = j.clinic_id
   and a.principal
   and a.removido_em is null
   and j.whatsapp_account_id is null
   and j.status in ('pendente', 'executando')
   and j.kind in (
     'enviar_mensagem_ativa', 'executar_passo_de_regua', 'baixar_midia'
   );

alter table public.conversation enable trigger set_updated_at;
alter table public.message enable trigger set_updated_at;
alter table public.job_queue enable trigger set_updated_at;

-- ---------------------------------------------------------------------------
-- 3) Indices
-- ---------------------------------------------------------------------------

-- Remover numero (conversas abertas dele) e a conferencia da FK.
create index conversation_whatsapp_account_idx
  on public.conversation (whatsapp_account_id);

-- Recibo, apagamento e eco por numero (a unicidade por numero e da Fase 5).
create index message_numero_wa_message_idx
  on public.message (whatsapp_account_id, wa_message_id)
  where wa_message_id is not null;

-- A fila por raia da Fase 3.
create index job_queue_numero_prioridade_idx
  on public.job_queue (whatsapp_account_id, prioridade, run_at)
  where status = 'pendente' and whatsapp_account_id is not null;

-- ---------------------------------------------------------------------------
-- 4) Por qual numero sai o envio: resolver_conta_de_envio e conta_de_envio
-- ---------------------------------------------------------------------------
-- Ordem (decisao 2 do dono e D9):
--   1. modo fixo, se o numero fixo esta ativo;
--   2. o numero da conversa do contato em que ele escreveu por ultimo
--      (last_inbound_at, depois last_message_at), se esse numero esta ativo;
--   3. o principal ativo.
-- Desconectado NAO e criterio: o envio espera a reconexao e nunca troca de
-- numero sozinho. So o numero REMOVIDO sai da escolha.
--
-- resolver_conta_de_envio e a regra sem guarda de sessao, para gatilho,
-- planner e executor (service_role). conta_de_envio e a porta da aplicacao:
-- com sessao de usuario, so a clinica dele.

create function public.resolver_conta_de_envio(
  p_clinic_id uuid,
  p_contact_id uuid
)
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select a.id
       from whatsapp_envio_automatico e
       join whatsapp_account a on a.id = e.conta_fixa_id
      where e.clinic_id = p_clinic_id
        and e.modo = 'fixo'
        and a.clinic_id = p_clinic_id
        and a.removido_em is null),
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
    (select a.id
       from whatsapp_account a
      where a.clinic_id = p_clinic_id
        and a.principal
        and a.removido_em is null)
  )
$$;

revoke all on function public.resolver_conta_de_envio(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolver_conta_de_envio(uuid, uuid)
  to service_role;

create function public.conta_de_envio(p_clinic_id uuid, p_contact_id uuid)
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
  return public.resolver_conta_de_envio(p_clinic_id, p_contact_id);
end;
$$;

revoke all on function public.conta_de_envio(uuid, uuid)
  from public, anon;
grant execute on function public.conta_de_envio(uuid, uuid)
  to authenticated, service_role;

-- Versao em lote (lista de espera, Cobrar agora, aviso de remarcacao): o
-- numero de cada contato com nome e status, para a Fase 2 separar quem esta
-- num numero desconectado (D7) sem uma consulta por contato.
create function public.contas_de_envio(
  p_clinic_id uuid,
  p_contact_ids uuid[]
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

  -- MATERIALIZED: a escolha roda uma vez por contato, e nao uma vez por par
  -- (contato, numero) dentro do join.
  return query
    with escolha as materialized (
      select x.id,
             public.resolver_conta_de_envio(p_clinic_id, x.id) as conta
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

revoke all on function public.contas_de_envio(uuid, uuid[])
  from public, anon;
grant execute on function public.contas_de_envio(uuid, uuid[])
  to authenticated, service_role;

-- O contato de um job de envio: payload.contact_id (envio ativo) ou o da
-- execucao de regua (payload.cadence_run_id). Texto que nao e uuid vira nulo
-- em vez de derrubar o insert do job.
create function public.contato_do_job(p_clinic_id uuid, p_payload jsonb)
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    case
      when p_payload->>'contact_id'
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (p_payload->>'contact_id')::uuid
    end,
    (select r.contact_id
       from cadence_run r
      where r.clinic_id = p_clinic_id
        and r.id = case
          when p_payload->>'cadence_run_id'
               ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (p_payload->>'cadence_run_id')::uuid
        end)
  )
$$;

revoke all on function public.contato_do_job(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.contato_do_job(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Gatilhos: conversa, mensagem, job e adocao de orfas
-- ---------------------------------------------------------------------------

-- Conversa: sem numero, ganha o principal. Numero de outra clinica, recusa.
-- Numero definido nao muda (so de nulo para valor, que e a adocao). Conversa
-- NOVA nao nasce em numero removido.
create function public.conversa_ganha_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removido_em timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.whatsapp_account_id is null then
      select id into new.whatsapp_account_id
        from whatsapp_account
       where clinic_id = new.clinic_id
         and principal
         and removido_em is null;
    end if;
  elsif old.whatsapp_account_id is not null
        and new.whatsapp_account_id is distinct from old.whatsapp_account_id
  then
    raise exception using errcode = 'check_violation',
      message = 'O número de uma conversa não muda depois de definido.';
  end if;

  if new.whatsapp_account_id is not null then
    select removido_em into v_removido_em
      from whatsapp_account
     where id = new.whatsapp_account_id
       and clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;
    if v_removido_em is not null
       and (tg_op = 'INSERT' or old.whatsapp_account_id is null)
    then
      raise exception using errcode = 'check_violation',
        message = 'Este número foi removido da clínica.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.conversa_ganha_numero()
  from public, anon, authenticated;

create trigger conversa_ganha_numero
  before insert or update of clinic_id, whatsapp_account_id
  on public.conversation
  for each row execute function public.conversa_ganha_numero();

-- Conversa que acabou de ganhar numero (adocao): as mensagens dela vao junto.
create function public.conversa_propaga_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update message
     set whatsapp_account_id = new.whatsapp_account_id
   where conversation_id = new.id
     and whatsapp_account_id is null;
  return null;
end;
$$;

revoke all on function public.conversa_propaga_numero()
  from public, anon, authenticated;

create trigger conversa_propaga_numero
  after update of whatsapp_account_id on public.conversation
  for each row
  when (old.whatsapp_account_id is null
        and new.whatsapp_account_id is not null)
  execute function public.conversa_propaga_numero();

-- Mensagem: SEMPRE o numero da conversa, venha o que vier no insert (forja
-- e sobrescrita). Depois de definido, nao muda; de nulo para valor so pela
-- adocao, e de novo com o numero da conversa.
create function public.mensagem_herda_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.whatsapp_account_id is not null then
    if new.whatsapp_account_id is distinct from old.whatsapp_account_id then
      raise exception using errcode = 'check_violation',
        message = 'O número de uma mensagem não muda.';
    end if;
    return new;
  end if;

  select c.whatsapp_account_id into new.whatsapp_account_id
    from conversation c
   where c.id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.mensagem_herda_numero()
  from public, anon, authenticated;

create trigger mensagem_herda_numero
  before insert or update of whatsapp_account_id on public.message
  for each row execute function public.mensagem_herda_numero();

-- Job: envio sem numero ganha o da conta_de_envio; numero de outra clinica,
-- recusa. Os outros kinds (baixar_midia, conversao, oferta) ficam como vierem.
create function public.job_ganha_numero()
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
      public.contato_do_job(new.clinic_id, new.payload)
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

revoke all on function public.job_ganha_numero()
  from public, anon, authenticated;

create trigger job_ganha_numero
  before insert or update of clinic_id, whatsapp_account_id
  on public.job_queue
  for each row execute function public.job_ganha_numero();

-- Numero que vira principal ativo (o primeiro da clinica, a restauracao ou a
-- troca de principal) adota as conversas da clinica que estao sem numero; as
-- mensagens vao junto pelo conversa_propaga_numero.
create function public.adotar_conversas_orfas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update conversation
     set whatsapp_account_id = new.id
   where clinic_id = new.clinic_id
     and whatsapp_account_id is null;
  return null;
end;
$$;

revoke all on function public.adotar_conversas_orfas()
  from public, anon, authenticated;

create trigger adotar_conversas_orfas
  after insert on public.whatsapp_account
  for each row
  when (new.principal and new.removido_em is null)
  execute function public.adotar_conversas_orfas();

create trigger adotar_conversas_orfas_na_troca
  after update of principal, removido_em on public.whatsapp_account
  for each row
  when (new.principal and new.removido_em is null
        and not (old.principal and old.removido_em is null))
  execute function public.adotar_conversas_orfas();

-- ---------------------------------------------------------------------------
-- 6) Fila: numero_do_job e redistribuir_jobs_do_numero
-- ---------------------------------------------------------------------------

-- Na execucao (Fase 2), guardada pela posse do job. Devolve:
--   {estado: 'ok', whatsapp_account_id}  numero ativo (carimbado agora se
--                                        vinha nulo ou de numero removido);
--   {estado: 'numero_removido'}          o numero foi removido e o job ja
--                                        gravou mensagem (ou e midia, que so
--                                        baixa pela instancia que recebeu):
--                                        falha definitiva, sem trocar;
--   {estado: 'sem_numero'}               a clinica nao tem numero ativo;
--   {estado: 'nao_se_aplica'}            kind que nao usa numero;
--   {estado: 'sem_posse'}                o job nao e deste executor.
create function public.numero_do_job(p_job_id uuid, p_worker text)
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
    v_nova := resolver_conta_de_envio(
      v_job.clinic_id,
      contato_do_job(v_job.clinic_id, v_job.payload)
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

revoke all on function public.numero_do_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.numero_do_job(uuid, text) to service_role;

-- Recarimba os jobs de envio PENDENTES do numero que ainda nao gravaram
-- mensagem, pela regra de conta_de_envio. Na remocao, o numero removido ja
-- saiu da escolha, entao eles vao para o proximo numero valido (ou ficam sem
-- numero, se nao ha outro). Chamado para um numero ativo (troca de
-- politica), move so o que a regra nova manda mover. Devolve quantos
-- mudaram.
create function public.redistribuir_jobs_do_numero(p_account_id uuid)
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
             contato_do_job(j.clinic_id, j.payload)
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

revoke all on function public.redistribuir_jobs_do_numero(uuid)
  from public, anon, authenticated;
grant execute on function public.redistribuir_jobs_do_numero(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7) Principal e remocao (as Server Actions da Fase 2 chamam por service
--    role, depois de conferir o papel: D8)
-- ---------------------------------------------------------------------------

create function public.definir_numero_principal(
  p_clinic_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removido_em timestamptz;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp_account:' || p_clinic_id::text, 0)
  );

  select removido_em into v_removido_em
    from whatsapp_account
   where id = p_account_id
     and clinic_id = p_clinic_id
   for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Número não encontrado nesta clínica.';
  end if;
  if v_removido_em is not null then
    raise exception using errcode = 'check_violation',
      message = 'Este número foi removido da clínica e não pode ser o principal.';
  end if;

  -- Primeiro tira o principal atual: o indice unico parcial confere linha a
  -- linha.
  update whatsapp_account
     set principal = false
   where clinic_id = p_clinic_id
     and principal
     and id <> p_account_id;
  update whatsapp_account
     set principal = true
   where id = p_account_id
     and not principal;

  return p_account_id;
end;
$$;

revoke all on function public.definir_numero_principal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.definir_numero_principal(uuid, uuid)
  to service_role;

-- Remocao logica (D3 e D8). Na mesma transacao: marca removido, tira de
-- principal, desconecta, apaga o token da instancia e gira o webhook_secret
-- (a URL antiga passa a receber 401), redistribui os jobs pendentes e
-- encerra as conversas abertas do numero com um evento de sistema. O
-- historico fica.
--
-- O principal so e removido quando e o UNICO numero ativo: com outros
-- numeros, a clinica escolhe o novo principal antes (definir_numero_principal).
-- Assim nenhuma clinica com numero ativo fica sem principal, e a entrada e o
-- envio sem conversa anterior nunca trocam de numero sem alguem decidir.
--
-- Chamar de novo para um numero ja removido nao faz nada ('ja_removido').
create function public.remover_numero(
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

revoke all on function public.remover_numero(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remover_numero(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8) Slot anti-ban por numero
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 25/09/2026) com a trava na LINHA
-- DO NUMERO: nulo = principal ativo, que e o que o codigo de hoje reserva.
-- Numero de outra clinica, inexistente ou removido: 'sem_conta' (falha
-- fechada, como antes). SECURITY INVOKER e so service_role, como antes.

drop function public.reservar_slot_envio_v2(uuid, integer, integer, boolean, integer);

create function public.reservar_slot_envio_v2(
  p_clinic_id uuid,
  p_espaco_ms integer,
  p_espera_maxima_ms integer,
  p_massa boolean default false,
  p_espaco_curto_ms integer default null,
  p_whatsapp_account_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_conta uuid;
  v_livre_em timestamptz;
  v_espera_ms double precision;
  v_curto_ms integer;
begin
  if p_whatsapp_account_id is null then
    select id into v_conta
      from whatsapp_account
     where clinic_id = p_clinic_id
       and principal
       and removido_em is null;
  else
    v_conta := p_whatsapp_account_id;
  end if;

  -- O lock de linha serializa concorrentes; a transacao dura microssegundos.
  select case
           when p_massa then greatest(
             coalesce(next_bulk_send_at, now()),
             coalesce(next_send_at, now()),
             now()
           )
           else greatest(coalesce(next_send_at, now()), now())
         end
    into v_livre_em
  from whatsapp_account
  where id = v_conta
    and clinic_id = p_clinic_id
    and removido_em is null
  for update;

  if not found then
    -- Falha FECHADA de verdade: sem conta, nao ha envio sem espacamento.
    return jsonb_build_object('estado', 'sem_conta');
  end if;

  v_espera_ms := greatest(0, extract(epoch from (v_livre_em - now())) * 1000);

  if v_espera_ms > p_espera_maxima_ms then
    -- ADIADO: nao escreve NADA. Nenhum slot e queimado. O chamador reagenda
    -- o job para livre_em e ninguem espera segurando uma requisicao.
    return jsonb_build_object(
      'estado', 'adiado',
      'livre_em', v_livre_em
    );
  end if;

  if p_massa then
    v_curto_ms := least(coalesce(p_espaco_curto_ms, p_espaco_ms), p_espaco_ms);
    update whatsapp_account
    set next_bulk_send_at = v_livre_em + make_interval(secs => p_espaco_ms / 1000.0),
        next_send_at = v_livre_em + make_interval(secs => v_curto_ms / 1000.0)
    where id = v_conta;
  else
    update whatsapp_account
    set next_send_at = v_livre_em + make_interval(secs => p_espaco_ms / 1000.0)
    where id = v_conta;
  end if;

  return jsonb_build_object(
    'estado', 'reservado',
    'espera_ms', v_espera_ms
  );
end;
$$;

revoke all on function public.reservar_slot_envio_v2(uuid, integer, integer, boolean, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.reservar_slot_envio_v2(uuid, integer, integer, boolean, integer, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9) Entrada: ingest_inbound_message com numero e filtro de numero proprio
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 25/09/2026) com:
--   - p_whatsapp_account_id no fim (nulo = principal ativo; de outra
--     clinica, erro; removido, ignorada sem gravar nada);
--   - filtro de numero proprio antes de tocar em contato;
--   - conversa com ON CONFLICT DO NOTHING SEM alvo (o indice unico de hoje,
--     por contato, e o da Fase 3, por numero, arbitram os dois) e busca que
--     aceita conversa sem numero e a adota;
--   - 'whatsapp_account_id' a mais no resultado (chave nova, as antigas
--     continuam).

drop function public.ingest_inbound_message(
  uuid, text, text, text, text, text, text, text, text, text
);

create function public.ingest_inbound_message(
  p_clinic_id uuid,
  p_phone_e164 text,
  p_name text,
  p_wa_message_id text,
  p_content_type text default 'texto',
  p_body text default null,
  p_media_url text default null,
  p_transcript text default null,
  p_media_filename text default null,
  p_media_mimetype text default null,
  p_whatsapp_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_contact_created boolean := false;
  v_conversation_id uuid;
  v_conta_da_conversa uuid;
  v_message_id uuid;
  v_filename text;
  v_mimetype text;
  v_conta uuid;
  v_removido_em timestamptz;
begin
  -- NUMERO que recebeu. Nulo e o webhook de hoje, que nao conhece numero:
  -- vale o principal ativo (e nulo se a clinica nao tem numero, como antes).
  if p_whatsapp_account_id is null then
    select id into v_conta
      from whatsapp_account
     where clinic_id = p_clinic_id
       and principal
       and removido_em is null;
  else
    select id, removido_em into v_conta, v_removido_em
      from whatsapp_account
     where id = p_whatsapp_account_id
       and clinic_id = p_clinic_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica.';
    end if;
    if v_removido_em is not null then
      -- Corrida com a remocao (a URL do numero removido ja recebe 401):
      -- nada e gravado.
      return jsonb_build_object(
        'inserted', false,
        'ignorada', 'numero_removido',
        'contact_id', null,
        'contact_created', false,
        'conversation_id', null,
        'message_id', null,
        'whatsapp_account_id', v_conta
      );
    end if;
  end if;

  -- FILTRO DE NUMERO PROPRIO (achado 1 do desenho): o numero A da clinica
  -- escrevendo para o numero B nao e paciente. Sem o filtro, o B criava um
  -- contato com o telefone da propria clinica, e a mensagem ainda se perdia
  -- no unique global de wa_message_id (o envio do A ja gravou o mesmo id).
  -- display_phone guarda digitos (ou, em conta antiga, o nome do perfil: sem
  -- 10 a 15 digitos, nao entra na comparacao). A comparacao e pela chave
  -- canonica, que ignora o nono digito.
  if exists (
    select 1
      from whatsapp_account a
     where a.clinic_id = p_clinic_id
       and a.removido_em is null
       and a.display_phone is not null
       and length(regexp_replace(a.display_phone, '\D', '', 'g'))
           between 10 and 15
       and public.chave_telefone(
             '+' || regexp_replace(a.display_phone, '\D', '', 'g')
           ) = public.chave_telefone(p_phone_e164)
  ) then
    return jsonb_build_object(
      'inserted', false,
      'ignorada', 'numero_proprio',
      'contact_id', null,
      'contact_created', false,
      'conversation_id', null,
      'message_id', null,
      'whatsapp_account_id', v_conta
    );
  end if;

  -- CONTATO, achado pela CHAVE canonica e nao pelo texto exato: o WhatsApp
  -- entrega +558499990000 e a recepcao cadastrou +5584999990000; e a mesma
  -- pessoa.
  --
  -- ON CONFLICT DO NOTHING SEM alvo de proposito: contact tem DOIS indices
  -- unicos (phone_e164 e phone_key). Com alvo em um so, duas entregas
  -- simultaneas do primeiro contato podiam estourar 23505 no outro indice
  -- (o nao arbitro e conferido na hora e erra em vez de esperar). Sem alvo,
  -- todos os unicos arbitram e a corrida vira "ja existe".
  insert into contact (clinic_id, phone_e164, name, last_contact_at)
  values (p_clinic_id, p_phone_e164, nullif(trim(p_name), ''), now())
  on conflict do nothing
  returning id into v_contact_id;

  if v_contact_id is not null then
    v_contact_created := true;
  else
    -- Ja existia (inclusive gravado pela recepcao na OUTRA forma). O telefone
    -- passa a ser o que o WhatsApp entregou: e a forma que com certeza recebe
    -- mensagem, e o toque seguinte vai para ela.
    update contact
      set last_contact_at = now(),
          name = coalesce(contact.name, nullif(trim(p_name), '')),
          phone_e164 = p_phone_e164
      where clinic_id = p_clinic_id
        and phone_key = public.chave_telefone(p_phone_e164)
      returning id into v_contact_id;
  end if;

  -- Consentimento automatico source='conversa' SO na primeira relacao do
  -- contato com o canal: qualquer linha anterior (ativa OU revogada) impede o
  -- insert. Revogou, so reconsentimento explicito com evidencia reabre.
  if not exists (
    select 1 from contact_consent
    where clinic_id = p_clinic_id
      and contact_id = v_contact_id
      and channel = 'whatsapp'
  ) then
    insert into contact_consent (clinic_id, contact_id, channel, source, evidence)
    values (p_clinic_id, v_contact_id, 'whatsapp', 'conversa',
            'Primeira mensagem recebida do contato');
  end if;

  -- Uma conversa aberta por contato E NUMERO (decisao 1 do dono). SEM alvo
  -- de proposito: hoje arbitra conversation_aberta_por_contato; na Fase 3,
  -- o indice por numero. Corrida vira "ja existe".
  insert into conversation (
    clinic_id, contact_id, status, last_message_at, whatsapp_account_id
  )
  values (
    p_clinic_id, v_contact_id, 'aguardando_humano', now(), v_conta
  )
  on conflict do nothing;

  -- A conversa aberta DESTE numero, ou uma aberta sem numero (clinica que
  -- ganhou numero depois, ou legado), que este numero adota.
  select id, whatsapp_account_id
    into v_conversation_id, v_conta_da_conversa
  from conversation
  where clinic_id = p_clinic_id and contact_id = v_contact_id
    and status <> 'resolvida'
    and (whatsapp_account_id = v_conta or whatsapp_account_id is null)
  order by (whatsapp_account_id is null)
  limit 1;

  if v_conta is not null
     and v_conversation_id is not null
     and v_conta_da_conversa is null
  then
    update conversation
       set whatsapp_account_id = v_conta
     where id = v_conversation_id
       and whatsapp_account_id is null;
  end if;

  -- Nome do arquivo: defesa em profundidade (o parser ja saneia). Sem barra
  -- nem caractere de controle, ate 200 caracteres; vazio vira nulo.
  v_filename := nullif(
    btrim(left(regexp_replace(coalesce(p_media_filename, ''),
                              '[[:cntrl:]/\\]', '', 'g'), 200)),
    ''
  );
  -- Tipo: so o formato tipo/subtipo, minusculo e sem parametros ("audio/ogg;
  -- codecs=opus" vira "audio/ogg"); qualquer outra coisa e nulo.
  v_mimetype := lower(btrim(split_part(coalesce(p_media_mimetype, ''), ';', 1)));
  if v_mimetype !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
     or length(v_mimetype) > 100 then
    v_mimetype := null;
  end if;

  -- O numero da mensagem vem da conversa (gatilho mensagem_herda_numero).
  insert into message (
    clinic_id, conversation_id, wa_message_id, direction, author,
    content_type, body, media_url, transcript, billable, cost_cents,
    media_filename, media_mimetype
  ) values (
    p_clinic_id, v_conversation_id, p_wa_message_id, 'entrada', 'paciente',
    coalesce(p_content_type, 'texto'), p_body, p_media_url, p_transcript,
    false, 0,
    v_filename, v_mimetype
  )
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    update conversation
      set last_message_at = now(),
          -- A chave de ordenacao do Inbox. Escrita SO aqui, no recebimento:
          -- responder nao pode mover a conversa de lugar.
          last_inbound_at = now(),
          unread_count = unread_count + 1,
          awaiting_reply = true,
          -- Enquanto nao houver agente de IA, nenhuma conversa fica num
          -- estado que ninguem atende: o paciente escreveu, a conversa volta
          -- para a fila da recepcao (contador do menu e "Aguardando voce").
          status = case
            when status = 'ia_atendendo' then 'aguardando_humano'
            else status
          end
      where id = v_conversation_id;
  end if;

  return jsonb_build_object(
    'inserted', v_message_id is not null,
    'contact_id', v_contact_id,
    'contact_created', v_contact_created,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'whatsapp_account_id', v_conta
  );
end;
$$;

revoke all on function public.ingest_inbound_message(
  uuid, text, text, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(
  uuid, text, text, text, text, text, text, text, text, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 10) garantir_conversa_aberta com numero
-- ---------------------------------------------------------------------------
-- Nulo = o numero da conta_de_envio (o executor de hoje nao conhece numero,
-- e a conversa em que o toque cai e a do numero por onde ele sai). Com
-- valor: ativo e desta clinica.

drop function public.garantir_conversa_aberta(uuid, uuid);

create function public.garantir_conversa_aberta(
  p_clinic_id uuid,
  p_contact_id uuid,
  p_whatsapp_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_conta uuid;
  v_conta_da_conversa uuid;
begin
  if p_whatsapp_account_id is null then
    v_conta := resolver_conta_de_envio(p_clinic_id, p_contact_id);
  else
    select id into v_conta
      from whatsapp_account
     where id = p_whatsapp_account_id
       and clinic_id = p_clinic_id
       and removido_em is null;
    if not found then
      raise exception using errcode = 'foreign_key_violation',
        message = 'O número informado não pertence a esta clínica ou foi removido.';
    end if;
  end if;

  insert into conversation (
    clinic_id, contact_id, status, last_message_at, whatsapp_account_id
  )
  values (p_clinic_id, p_contact_id, 'aguardando_humano', now(), v_conta)
  on conflict do nothing;

  select id, whatsapp_account_id
    into v_conversation_id, v_conta_da_conversa
  from conversation
  where clinic_id = p_clinic_id and contact_id = p_contact_id
    and status <> 'resolvida'
    and (whatsapp_account_id = v_conta or whatsapp_account_id is null)
  order by (whatsapp_account_id is null)
  limit 1;

  if v_conta is not null
     and v_conversation_id is not null
     and v_conta_da_conversa is null
  then
    update conversation
       set whatsapp_account_id = v_conta
     where id = v_conversation_id
       and whatsapp_account_id is null;
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.garantir_conversa_aberta(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.garantir_conversa_aberta(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 11) registrar_apagamento_do_whatsapp com numero
-- ---------------------------------------------------------------------------
-- Com valor, so apaga a mensagem daquele numero (o mesmo wa_message_id pode
-- existir no numero que enviou e no que recebeu, Fase 5). Nulo e o webhook
-- de hoje: igual a antes.

drop function public.registrar_apagamento_do_whatsapp(uuid, text);

create function public.registrar_apagamento_do_whatsapp(
  p_clinic_id uuid,
  p_wa_message_id text,
  p_whatsapp_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_origem text;
begin
  select id, media_url, direction into m
    from public.message
   where clinic_id = p_clinic_id
     and wa_message_id = p_wa_message_id
     and (p_whatsapp_account_id is null
          or whatsapp_account_id = p_whatsapp_account_id)
     and deleted_at is null
   limit 1;

  if not found then
    -- Também é o caso normal quando fomos nós que apagamos: a linha já tem
    -- deleted_at, e o eco não sobrescreve a autoria do primeiro.
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrada');
  end if;

  -- QUEM apagou, deduzido do que o WhatsApp permite: ninguém revoga para todos
  -- a mensagem de outra pessoa. Linha de saída só pode ter sido apagada pela
  -- clínica (pelo celular pareado, ou por nós com o eco chegando primeiro);
  -- linha de entrada, só pelo paciente.
  v_origem := case when m.direction = 'saida' then 'clinica' else 'paciente' end;

  perform public.arquivar_e_limpar_mensagem(m.id, 'todos', v_origem, null);

  return jsonb_build_object(
    'ok', true, 'message_id', m.id, 'media_url', m.media_url, 'origem', v_origem
  );
end;
$$;

revoke all on function public.registrar_apagamento_do_whatsapp(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_apagamento_do_whatsapp(uuid, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 12) planejar_reguas: cada job nasce com o numero
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 25/09/2026); so muda o insert de
-- job_queue (e o returning de cadence_run, para o contato chegar a ele).

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
  -- NUMERO (Fase 1B dos varios numeros, 25/09/2026): todo job nasce com o
  -- numero de envio carimbado por resolver_conta_de_envio, a mesma escolha
  -- de conta_de_envio (fixo, ultimo usado pelo paciente, principal). O
  -- executor de hoje nao le a coluna; a Fase 2 passa a enviar por ela.
  --
  -- Confirmacao: eixo em appointment.starts_at.
  with devidas as (
    select
      a.clinic_id,
      s.id as step_id,
      a.contact_id,
      a.id as appointment_id,
      a.starts_at + make_interval(mins => s.offset_minutes) as scheduled_for
    from appointment a
    join contact ct on ct.id = a.contact_id
    join lateral (
      select c.*
      from cadence c
      where c.clinic_id = a.clinic_id
        and c.kind = 'confirmacao'
        and c.active
        and (
          c.procedure_id is null
          or c.procedure_id = (
            select sl.procedure_id from service_link sl
            where sl.id = a.service_link_id
          )
        )
        and (not c.for_no_show_history or ct.no_show_count >= c.no_show_threshold)
      order by (c.procedure_id is not null) desc, c.for_no_show_history desc
      limit 1
    ) c on true
    join cadence_step s on s.cadence_id = c.id
    where a.send_confirmation
      and a.status in ('agendado', 'aguardando_confirmacao')
      -- Paciente pediu para remarcar: perguntar se ele confirma a consulta
      -- que ele quer trocar confunde e atrapalha a recepcao que esta
      -- remarcando. Quando o pedido for resolvido (coluna limpa), os toques
      -- que ainda couberem voltam a ser planejados.
      and a.remarcacao_pedida_em is null
      and a.starts_at > now()
      and a.starts_at + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
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
           resolver_conta_de_envio(clinic_id, contact_id)
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
    join lateral (
      select c.* from cadence c
      where c.clinic_id = f.clinic_id and c.kind = 'pos_falta' and c.active
      limit 1
    ) c on true
    join cadence_step s on s.cadence_id = c.id
    where f.marcada_em is not null
      and f.marcada_em + make_interval(mins => s.offset_minutes)
          between now() - interval '30 minutes' and now() + interval '60 minutes'
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
           resolver_conta_de_envio(clinic_id, contact_id)
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
           resolver_conta_de_envio(clinic_id, contact_id)
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
-- 13) criar_oferta_de_espera: o job da oferta leva o numero do destinatario
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 25/09/2026); so muda o insert de
-- job_queue. search_path vazio como antes: tudo qualificado.

create or replace function public.criar_oferta_de_espera(p_clinic_id uuid, p_source_appointment_id uuid, p_professional_id uuid, p_slot_starts_at timestamp with time zone, p_slot_ends_at timestamp with time zone, p_expires_at timestamp with time zone, p_destinatarios jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- NUMERO (Fase 1B dos varios numeros): o destinatario pode trazer
  -- whatsapp_account_id (a Fase 2 manda o de contas_de_envio). Sem ele, o
  -- gatilho job_ganha_numero resolve pela mesma regra de conta_de_envio.
  insert into public.job_queue (clinic_id, kind, payload, whatsapp_account_id)
  select p_clinic_id,
         'enviar_mensagem_ativa',
         jsonb_build_object(
           'contact_id', d->>'contact_id',
           'body', d->>'body',
           'offer_id', v_offer_id
         ),
         case
           when d->>'whatsapp_account_id'
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (d->>'whatsapp_account_id')::uuid
         end
    from jsonb_array_elements(p_destinatarios) d;

  return v_offer_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 14) Motivo novo de pulo na regua: numero removido
-- ---------------------------------------------------------------------------

alter table public.cadence_run
  drop constraint cadence_run_skipped_reason_check;
alter table public.cadence_run
  add constraint cadence_run_skipped_reason_check
    check (skipped_reason = any (array[
      'sem_consentimento', 'fora_janela', 'condicao_parada', 'falha_envio',
      'desconectado', 'teto_gasto', 'canal_ocupado', 'consulta_remarcada',
      'remarcacao_pedida', 'toque_atrasado', 'numero_removido'
    ]));
