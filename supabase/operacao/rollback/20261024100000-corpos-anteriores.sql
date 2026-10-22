-- Corpo lido da producao em 21/10/2026, antes da migration 20261024100000
-- (reguas de follow-up por etiqueta, onda 4, migration A). md5(prosrc) na
-- leitura (as ondas 2 e 3 nao o trocam; o ensaio confere que o banco ainda
-- esta assim antes de trocar):
--   planejar_reguas()  a6b44fa9224ec006028db85d12c0b3ed
-- Ele nao tinha comentario (continua sem).
--
-- ROLLBACK manual da migration (cabecalho dela). ORDEM:
--   0. ANTES, se a migration B (20261024110000) foi aplicada, o rollback dela
--      (supabase/operacao/rollback/20261024110000-corpos-anteriores.sql):
--      proteger_etiqueta_de_conversa da B le cadence.etiquetas e usa as
--      funcoes de etiqueta que saem aqui. Este arquivo PARA se a B ainda
--      estiver la.
--   1. DESLIGAR as reguas com etiqueta e ESPERAR 30 minutos depois do ultimo
--      toque delas (revisao de 21/10/2026). A trava de toque repetido mora
--      no planejar_reguas NOVO: com a regua com etiqueta desligada, os leads
--      dela passam para a regua geral da etapa sem receber de novo o passo
--      que a de etiqueta acabou de mandar. O planejar_reguas de ANTES nao tem
--      essa trava, e o passo (b) apaga, no cascade, as runs enviadas que ela
--      le: com um toque de regua com etiqueta nos ultimos 30 minutos, o passo
--      vencido de mesmo offset da regua geral nasceria de novo para o mesmo
--      lead (a mesma mensagem duas vezes). No SQL editor, sem sessao:
--        update public.cadence set active = false
--         where kind = 'followup' and cardinality(etiquetas) > 0 and active;
--      O passo (b) confere e RECUSA o rollback inteiro (P0001, so contagens)
--      enquanto houver regua com etiqueta ligada ou toque de uma delas nos
--      ultimos 30 minutos: e so rodar de novo depois.
--   2. O codigo novo do follow-up (as telas por etiqueta, o executor que
--      confere a regua que vale, a leitura do alcance e a ordem) sai do ar
--      ANTES de rodar este arquivo: ele le as colunas e chama as funcoes que
--      saem aqui.
--   3. Rodar ESTE arquivo inteiro no SQL editor (uma transacao):
--      a. planejar_reguas volta ao corpo de antes (CREATE OR REPLACE: mesma
--         assinatura, security, search_path e grants);
--      b. a conferencia do passo 1 (nenhuma regua com etiqueta ligada e
--         nenhum toque delas nos ultimos 30 minutos), e as reguas COM
--         etiqueta saem (com elas, no cascade, os passos e as execucoes
--         delas; o job pendente de uma delas cai no executor como execucao
--         que nao existe mais e nada sai). A regua geral de cada etapa fica,
--         com os passos e a historia. NOTICE com quantas saem (so a
--         contagem);
--      c. os dois indices novos saem e o de antes volta (uma regua de
--         follow-up por etapa): so depois de (b), senao a segunda regua da
--         etapa o recusaria;
--      d. as funcoes novas saem, depois as colunas, os checks e as funcoes
--         de etiqueta.
-- TRAVAS: lock_timeout de 3 s. O ALTER e os indices seguram cadence (ACCESS
-- EXCLUSIVE, fria) ate o commit: o planejar_reguas do cron e o executor das
-- reguas esperam fracoes de segundo. Nenhuma FK, nenhuma outra tabela.
-- Horario calmo.
-- Conferir no fim: o md5 acima, o indice cadence_followup_unico_por_etapa
-- de volta, nenhuma coluna etiquetas, etiquetas_modo ou prioridade em
-- cadence, nenhuma das funcoes novas.

begin;
set local lock_timeout = '3s';

-- 0. A migration B tem de ter saido antes.
do $antes$
begin
  if to_regclass('public.automacao_acao') is not null
     or to_regclass('public.automacao_condicao') is not null
     or to_regprocedure('public.salvar_automacao_de_fluxo(uuid, uuid, jsonb)') is not null then
    raise exception 'Rode antes o rollback da migration B (supabase/operacao/rollback/20261024110000-corpos-anteriores.sql): as tabelas e funcoes dela ainda existem.';
  end if;
end;
$antes$;

-- a. O corpo de antes.
-- planejar_reguas: corpo do banco ANTES da migration (producao, 21/10/2026)
CREATE OR REPLACE FUNCTION public.planejar_reguas()
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

-- b. As reguas com etiqueta (a contagem vai num NOTICE; nada de nome).
do $reguas$
declare
  v_ligadas integer;
  v_recentes integer;
  v_n integer;
begin
  -- O passo 1 do cabecalho: regua com etiqueta ligada, ou que mandou toque
  -- nos ultimos 30 minutos, recusa o rollback inteiro (P0001, so
  -- contagens). Sem a trava do planejar_reguas novo e sem as runs enviadas
  -- (o cascade abaixo as apaga), o passo vencido de mesmo offset da regua
  -- geral nasceria de novo para quem acabou de receber o da regua com
  -- etiqueta.
  select count(*) into v_ligadas
    from public.cadence c
   where c.kind = 'followup'
     and cardinality(c.etiquetas) > 0
     and c.active;
  select count(*) into v_recentes
    from public.cadence_run r
    join public.cadence_step s on s.id = r.cadence_step_id
    join public.cadence c on c.id = s.cadence_id
   where c.kind = 'followup'
     and cardinality(c.etiquetas) > 0
     and r.sent_at > now() - interval '30 minutes';
  if v_ligadas > 0 or v_recentes > 0 then
    raise exception using errcode = 'P0001',
      message = format('rollback 20261024100000: %s regua(s) com etiqueta ligada(s) e %s toque(s) delas nos ultimos 30 minutos. Desligue as reguas com etiqueta (passo 1 do cabecalho) e rode de novo 30 minutos depois do ultimo toque.', v_ligadas, v_recentes);
  end if;

  delete from public.cadence c
   where c.kind = 'followup'
     and cardinality(c.etiquetas) > 0;
  get diagnostics v_n = row_count;
  raise notice 'rollback 20261024100000: % regua(s) de follow-up com etiqueta excluida(s)', v_n;
end;
$reguas$;

-- c. Os indices.
drop index if exists public.cadence_followup_mesmo_filtro;
drop index if exists public.cadence_followup_geral_unico_por_etapa;
create unique index cadence_followup_unico_por_etapa
  on public.cadence (clinic_id, trigger_stage)
  where kind = 'followup';

-- d. As funcoes novas, as colunas e as funcoes de etiqueta.
drop function if exists public.ordenar_reguas_de_followup(uuid, text, uuid[]);
drop function if exists public.alcance_das_reguas_de_followup(uuid);
drop function if exists public.followups_devidos(uuid);
drop function if exists public.regua_de_followup_do_contato(uuid);

alter table public.cadence
  drop constraint if exists cadence_etiquetas_so_no_followup,
  drop constraint if exists cadence_etiquetas_validas,
  drop constraint if exists cadence_etiquetas_modo,
  drop constraint if exists cadence_modo_so_com_varias_etiquetas,
  drop constraint if exists cadence_prioridade_na_faixa,
  drop column if exists etiquetas,
  drop column if exists etiquetas_modo,
  drop column if exists prioridade;

drop function if exists public.chaves_de_etiqueta_do_contato(uuid);
drop function if exists public.etiquetas_casam(text[], text[], text);
drop function if exists public.etiquetas_validas(text[]);
drop function if exists public.chaves_de_etiquetas(text[]);
drop function if exists public.chave_de_etiqueta(text);

-- Conferencia (recusa o rollback inteiro se nao ficou como antes).
do $conferencia$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.planejar_reguas()'))
       is distinct from 'a6b44fa9224ec006028db85d12c0b3ed'
     or to_regclass('public.cadence_followup_unico_por_etapa') is null
     or exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'cadence'
                   and c.column_name in ('etiquetas', 'etiquetas_modo', 'prioridade'))
     or to_regprocedure('public.chave_de_etiqueta(text)') is not null
     or to_regprocedure('public.followups_devidos(uuid)') is not null then
    raise exception 'rollback 20261024100000: o banco nao ficou como antes da migration';
  end if;
end;
$conferencia$;

commit;
