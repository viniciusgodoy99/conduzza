-- ---------------------------------------------------------------------------
-- Mais de um numero de WhatsApp por clinica, Fase 3 (contrato)
-- ---------------------------------------------------------------------------
-- Desenho aprovado: docs/07_multiplos_numeros_whatsapp.md (25/09/2026).
-- Depende das Fases 1A (20260925130000) e 1B (20260925131000), aplicadas, e
-- do codigo da Fase 2 (por numero), publicado. Aplicar logo ANTES do deploy
-- das telas da Fase 4: depois daqui uma clinica pode ter dois numeros, e o
-- codigo anterior a Fase 2 (que le e grava por clinic_id) deixa de servir.
--
-- O que muda, nesta ordem:
--
--   1. Backfill final: conversa sem numero ganha o principal ativo da
--      clinica, mensagem ganha o numero da conversa e job de envio aberto
--      ganha o numero pela regra de conta_de_envio. Clinica sem numero ativo
--      e so contada (aviso no log da migration).
--   2. NOT NULL em conversation.whatsapp_account_id e
--      message.whatsapp_account_id. Se sobrar conversa sem numero (clinica
--      sem numero ativo), a migration PARA: numero nao se inventa.
--   3. Uma conversa aberta por contato E NUMERO (decisao 1 do dono): o
--      indice novo nasce ANTES de o antigo (por contato) sair, para nunca
--      haver instante sem unicidade.
--   4. Saem os temporarios da Fase 1A: whatsapp_account_uma_por_clinica,
--      whatsapp_account_secret_uma_por_clinica e o gatilho
--      preencher_conta_do_segredo. Segredo sem account_id passa a falhar alto
--      (23502), em vez de cair no principal em silencio.
--   5. claim_jobs_por_clinica por RAIA: o numero do job, ou a clinica para o
--      job sem numero. Mesma assinatura; p_max_clinicas passa a contar raias.
--   6. numero_do_job: o eco da resposta ao toque cujo numero foi removido
--      devolve 'numero_removido' e nao e recarimbado (D4 garantida pelo banco,
--      achado N[0] da revisao da Fase 2).
--   7. Sai a v1 reservar_slot_envio(uuid, integer), sem chamador desde a
--      reservar_slot_envio_v2 (achado 11).
--
-- Estado de producao conferido em 25/09/2026 (somente leitura): zero
-- conversas, mensagens e jobs abertos de envio sem numero; 5 clinicas, 2 sem
-- numero ativo e sem nenhuma conversa; nenhum numero removido. O backfill e
-- a conferencia existem para o que aparecer entre hoje e a aplicacao.

-- ---------------------------------------------------------------------------
-- 1) Backfill final e adocao
-- ---------------------------------------------------------------------------
-- set_updated_at desligado, como no backfill da 1B: updated_at continua
-- dizendo quando a linha mudou de verdade.

alter table public.conversation disable trigger set_updated_at;
alter table public.message disable trigger set_updated_at;
alter table public.job_queue disable trigger set_updated_at;

-- Conversa sem numero em clinica COM numero ativo: o principal (o mesmo que
-- conversa_ganha_numero daria no insert). Principal ativo existe em toda
-- clinica com numero ativo (antes_de_criar_numero e remover_numero garantem);
-- a ordem por created_at e so a rede de seguranca. As mensagens vao junto
-- pelo gatilho conversa_propaga_numero.
update public.conversation c
   set whatsapp_account_id = (
     select a.id
       from public.whatsapp_account a
      where a.clinic_id = c.clinic_id
        and a.removido_em is null
      order by a.principal desc, a.created_at, a.id
      limit 1
   )
 where c.whatsapp_account_id is null
   and exists (
     select 1 from public.whatsapp_account a
      where a.clinic_id = c.clinic_id
        and a.removido_em is null
   );

-- Mensagem que ficou para tras (conversa com numero, mensagem sem).
update public.message m
   set whatsapp_account_id = c.whatsapp_account_id
  from public.conversation c
 where c.id = m.conversation_id
   and c.whatsapp_account_id is not null
   and m.whatsapp_account_id is null;

-- Job de envio aberto sem numero: a regra de conta_de_envio (a mesma do
-- gatilho job_ganha_numero). Midia: o numero da mensagem que chegou. Quem
-- continuar sem numero (clinica sem numero ativo) corre na raia da clinica, e
-- numero_do_job resolve na execucao.
update public.job_queue j
   set whatsapp_account_id = public.resolver_conta_de_envio(
     j.clinic_id,
     public.contato_do_job(j.clinic_id, j.payload)
   )
 where j.whatsapp_account_id is null
   and j.status in ('pendente', 'executando')
   and j.kind in ('enviar_mensagem_ativa', 'executar_passo_de_regua');

update public.job_queue j
   set whatsapp_account_id = m.whatsapp_account_id
  from public.message m
 where j.whatsapp_account_id is null
   and j.status in ('pendente', 'executando')
   and j.kind = 'baixar_midia'
   and m.clinic_id = j.clinic_id
   and j.payload ->> 'message_id'
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and m.id = (j.payload ->> 'message_id')::uuid
   and m.whatsapp_account_id is not null;

alter table public.conversation enable trigger set_updated_at;
alter table public.message enable trigger set_updated_at;
alter table public.job_queue enable trigger set_updated_at;

-- ---------------------------------------------------------------------------
-- 2) Conferencia e NOT NULL
-- ---------------------------------------------------------------------------
-- Conversa que sobrou sem numero e de clinica SEM numero ativo (nunca teve,
-- ou so tem numero removido). Nao ha numero para dar a ela: a migration para
-- e alguem decide (cadastrar o numero da clinica ou tratar a conversa).

do $$
declare
  v_clinicas_sem_numero integer;
  v_conversas_sem_numero integer;
  v_clinicas_com_conversa_sem_numero integer;
  v_mensagens_sem_numero integer;
  v_jobs_sem_numero integer;
begin
  select count(*) into v_clinicas_sem_numero
    from public.clinic c
   where not exists (
     select 1 from public.whatsapp_account a
      where a.clinic_id = c.id and a.removido_em is null
   );
  select count(*), count(distinct clinic_id)
    into v_conversas_sem_numero, v_clinicas_com_conversa_sem_numero
    from public.conversation
   where whatsapp_account_id is null;
  select count(*) into v_mensagens_sem_numero
    from public.message
   where whatsapp_account_id is null;
  select count(*) into v_jobs_sem_numero
    from public.job_queue
   where whatsapp_account_id is null
     and status in ('pendente', 'executando')
     and kind in (
       'enviar_mensagem_ativa', 'executar_passo_de_regua', 'baixar_midia'
     );

  raise notice 'numeros_contrato: % clinica(s) sem numero ativo; % job(s) de envio aberto(s) sem numero (correm na raia da clinica)',
    v_clinicas_sem_numero, v_jobs_sem_numero;

  if v_conversas_sem_numero > 0 then
    raise exception using errcode = '23502',
      message = format(
        'Há %s conversa(s) sem número em %s clínica(s) sem número de WhatsApp ativo. Cadastre o número dessas clínicas (ou trate as conversas) antes de aplicar esta migration.',
        v_conversas_sem_numero, v_clinicas_com_conversa_sem_numero
      );
  end if;
  if v_mensagens_sem_numero > 0 then
    raise exception using errcode = '23502',
      message = format(
        'Há %s mensagem(ns) sem número. Confira antes de aplicar esta migration.',
        v_mensagens_sem_numero
      );
  end if;
end;
$$;

alter table public.conversation
  alter column whatsapp_account_id set not null;
alter table public.message
  alter column whatsapp_account_id set not null;

comment on column public.conversation.whatsapp_account_id is
  'Numero da clinica desta conversa (uma conversa por numero). Obrigatorio desde o contrato da Fase 3: conversa so nasce em clinica com numero ativo.';
comment on column public.message.whatsapp_account_id is
  'Copia do numero da conversa, gravada pelo gatilho mensagem_herda_numero. Imutavel e obrigatoria.';

-- ---------------------------------------------------------------------------
-- 3) Uma conversa aberta por contato e numero
-- ---------------------------------------------------------------------------
-- O novo primeiro: com os dois de pe, nada que valia deixa de valer. O
-- ingest_inbound_message e o garantir_conversa_aberta usam ON CONFLICT DO
-- NOTHING SEM alvo desde a 1B, entao passam a ser arbitrados pelo indice novo
-- sem mudar de corpo. O prefixo (clinic_id, contact_id) atende a busca da
-- conversa aberta do contato que o indice antigo atendia.

create unique index conversation_aberta_por_numero
  on public.conversation (clinic_id, contact_id, whatsapp_account_id)
  where status <> 'resolvida';

drop index public.conversation_aberta_por_contato;

-- ---------------------------------------------------------------------------
-- 4) Fim dos temporarios da Fase 1A
-- ---------------------------------------------------------------------------

alter table public.whatsapp_account
  drop constraint whatsapp_account_uma_por_clinica;
alter table public.whatsapp_account_secret
  drop constraint whatsapp_account_secret_uma_por_clinica;

drop trigger preencher_conta_do_segredo on public.whatsapp_account_secret;
drop function public.preencher_conta_do_segredo();

-- Os uniques temporarios eram os indices de clinic_id das duas tabelas (a FK
-- para clinic, o cascade de apagar a clinica e as leituras por clinica).
create index whatsapp_account_clinic_idx
  on public.whatsapp_account (clinic_id);
create index whatsapp_account_secret_clinic_idx
  on public.whatsapp_account_secret (clinic_id);

-- ---------------------------------------------------------------------------
-- 5) Claim por raia
-- ---------------------------------------------------------------------------
-- A raia e o numero do job, ou a clinica quando o job nao tem numero
-- (integracoes, oferta da lista de espera, clinica sem numero ativo). Um job
-- por raia por claim, com a trava na linha da raia: numeros da mesma clinica
-- andam em paralelo e dois claims concorrentes nunca pegam a mesma raia.
-- FOR UPDATE nao aceita UNION, entao cada raia trava no seu CTE e a uniao e
-- feita depois. O anti-ban por numero continua garantido pelo FOR UPDATE da
-- reservar_slot_envio_v2 na linha do numero; o claim so evita trabalho
-- perdido (o segundo job do mesmo numero seria adiado de qualquer jeito).
--
-- Numero removido continua na raia de proposito: o job dele que ja gravou
-- mensagem precisa ser reivindicado para numero_do_job o encerrar
-- ('numero_removido'); os pendentes sem mensagem a remocao ja redistribuiu.
--
-- O UPDATE final reconfere a elegibilidade do job. A trava e na linha da
-- raia, nao na do job: um claim concorrente que fotografou a fila antes do
-- commit de outro e pegou a trava da raia logo depois do commit acharia o
-- job ainda elegivel na foto. O reteste na linha nova (READ COMMITTED
-- reavalia a condicao depois de esperar) descarta o job que acabou de ser
-- reivindicado.
--
-- Mesma assinatura. p_max_clinicas agora conta RAIAS (o nome fica para nao
-- quebrar quem chama). O ramo que enterra os travados e o de antes.

create or replace function public.claim_jobs_por_clinica(
  p_worker text,
  p_max_clinicas integer,
  p_kinds text[],
  p_incluir_teste boolean default false
)
returns setof job_queue
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Ramo 1: enterra o que travou sem tentativas restantes.
  update job_queue
  set status = 'falhou',
      last_error = coalesce(last_error, 'lease_expirado'),
      locked_by = null,
      locked_at = null
  where status = 'executando'
    and locked_at < now() - interval '180 seconds'
    and attempts >= max_attempts
    and kind = any(p_kinds);

  -- Ramos 2 e 3: um job elegivel por raia. Dentro da raia, a menor
  -- prioridade primeiro e, empatado, o mais atrasado: confirmacao vencida
  -- sai antes de follow-up. Entre raias, a mesma regra.
  return query
  with raia_numero as (
    select e.id, e.prioridade, e.run_at
    from whatsapp_account a
    join clinic c on c.id = a.clinic_id
    cross join lateral (
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.whatsapp_account_id = a.id
        and q.kind = any(p_kinds)
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) e
    where (p_incluir_teste or not c.e_de_teste)
    order by e.prioridade, e.run_at
    limit p_max_clinicas
    for update of a skip locked
  ),
  raia_clinica as (
    select e.id, e.prioridade, e.run_at
    from clinic c
    cross join lateral (
      select q.id, q.prioridade, q.run_at
      from job_queue q
      where q.clinic_id = c.id
        and q.whatsapp_account_id is null
        and q.kind = any(p_kinds)
        and (
          (q.status = 'pendente' and q.run_at <= now())
          or (q.status = 'executando'
              and q.locked_at < now() - interval '180 seconds'
              and q.attempts < q.max_attempts)
        )
      order by q.prioridade, q.run_at
      limit 1
    ) e
    where (p_incluir_teste or not c.e_de_teste)
    order by e.prioridade, e.run_at
    limit p_max_clinicas
    for update of c skip locked
  ),
  escolhidos as (
    select t.id
    from (
      select * from raia_numero
      union all
      select * from raia_clinica
    ) t
    order by t.prioridade, t.run_at
    limit p_max_clinicas
  )
  update job_queue j
  set status = 'executando',
      locked_by = p_worker,
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (select escolhidos.id from escolhidos)
    and (
      (j.status = 'pendente' and j.run_at <= now())
      or (j.status = 'executando'
          and j.locked_at < now() - interval '180 seconds'
          and j.attempts < j.max_attempts)
    )
  returning j.*;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6) numero_do_job: o eco nunca troca de numero
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 25/09/2026, igual ao da 1B) com
-- um caso a mais no bloco do numero removido: o eco da resposta ao toque
-- (payload.resposta_ao_paciente = true) responde a uma mensagem que chegou
-- por AQUELE numero (D4). Removido o numero, o eco morre ('numero_removido')
-- em vez de ser recarimbado pela regra geral. Antes, so a copia do numero
-- lida no claim (worker.ts) segurava a D4: um eco regravado com outro numero
-- e devolvido a fila (lease vencido) sairia pelo numero errado.
--
-- Estados:
--   {estado: 'ok', whatsapp_account_id}  numero ativo (carimbado agora se
--                                        vinha nulo ou de numero removido);
--   {estado: 'numero_removido'}          o numero foi removido e o job ja
--                                        gravou mensagem, e midia (so baixa
--                                        pela instancia que recebeu) ou e o
--                                        eco (so sai pelo numero que
--                                        recebeu): falha definitiva, sem
--                                        trocar;
--   {estado: 'sem_numero'}               a clinica nao tem numero ativo;
--   {estado: 'nao_se_aplica'}            kind que nao usa numero;
--   {estado: 'sem_posse'}                o job nao e deste executor.

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

-- ---------------------------------------------------------------------------
-- 7) Sai a v1 do slot de envio
-- ---------------------------------------------------------------------------
-- Conferido em 25/09/2026: nenhuma funcao do banco (pg_proc) e nenhum codigo
-- de app, lib, scripts ou supabase/functions chama reservar_slot_envio(uuid,
-- integer). O unico chamador era um teste de integracao, que passa para a v2.

drop function public.reservar_slot_envio(uuid, integer);
