-- ---------------------------------------------------------------------------
-- Metricas da Fase 3 (Inicio, Confirmacoes, Pacientes, Lista de espera e
-- Resultados)
-- ---------------------------------------------------------------------------
-- Plano "Metricas do design" (Frente 3, 3c) e a secao "Execucao da Fase 3
-- (02/10/2026)" com as decisoes do dono. Migration UNICA de dados da fase:
-- os cartoes novos leem daqui, sempre pela sessao de quem olha (SECURITY
-- INVOKER, a RLS recorta clinica e papel) e com os limites de tempo no fuso
-- da clinica (regra 3.6). Pressupoe a 20261002100000 aplicada e nao a edita.
--
-- O que faz, na ordem do arquivo:
--
--   1. cadence_run.motivo_da_falha: codigo curto (^[a-z0-9_]{1,64}$) do
--      porque de um toque fechado como 'falha_envio'. So existe com esse
--      motivo (CHECK). Quem grava: pularRun (lib/jobs/regua.ts) com o codigo
--      do resultado do envio, e fechar_runs_orfas com o codigo de
--      job_queue.last_error do job que desistiu. Alimenta o rodape "motivo
--      mais comum" do cartao "Nao enviadas" de Confirmacoes. Nunca texto do
--      provedor nem dado de paciente: so o trecho antes do primeiro ':' em
--      minusculas, e o que nao cabe no formato vira 'desconhecido'.
--      Linha antiga fica nula (producao tem 0 runs 'falha_envio' em 02/10) e
--      a tela le nulo como "Falha no envio".
--      Indice (clinic_id, sent_at desc) para o "Ultimo disparo" do Inicio.
--   2. fechar_runs_orfas(): o corpo de PRODUCAO (pg_get_functiondef em
--      02/10) passa a gravar motivo_da_falha. Para a escolha do codigo ser
--      deterministica, a CTE pega o job mais recente de cada run (distinct
--      on por updated_at); o resto nao muda.
--   3. consulta_foi_confirmada(status, canal): o predicado unico de
--      "Confirmada" (espelhado em TS como foiConfirmada). Confirmada e a
--      consulta em confirmado_paciente ou confirmado_recepcao, ou a que tem
--      confirmation_channel e ja passou para na_recepcao, em_atendimento,
--      compareceu ou faltou. O canal e limpo quando a remarcacao volta a
--      consulta para agendado (preparar_remarcacao), entao a remarcada de
--      volta nao conta; a cancelada depois de confirmar tambem nao.
--   4. resumo_do_dia(...): os 4 cartoes do dia do Inicio, D-7 para a
--      variacao (A1), ultimo disparo da regua de confirmacao e as 7 barras
--      de D-6 a D. Os limites UTC vem prontos do TS (diaCivil/limitesDoDia).
--      null para o profissional (ele fica na VisaoDoProfissional).
--   5. funil_da_jornada(clinica): o retrato atual do funil por etapa da
--      jornada da clinica (funnel_stage_def em ordem de posicao, zero para
--      etapa vazia). E o mesmo numero do Kanban de Leads (sem filtro de
--      kind). resultados_da_clinica so devolve um mapa chave -> total, sem
--      nome, posicao nem as etapas vazias, por isso a funcao nova. null para
--      o profissional.
--   6. metricas_de_pacientes(clinica): ativos (12 meses e o mesmo calculo 30
--      dias atras), novos no mes, retorno em 90 dias (janela madura, outro
--      dia civil, falta nao conta), sem consulta ha 6 meses e o primeiro
--      comparecimento (a tela decide "Ainda nao medido" e "Contando desde").
--      Para o profissional, a RLS recorta "na sua agenda".
--      Indice parcial de comparecimento em appointment.
--   7. metricas_da_espera(clinica): desempenho da lista no mes civil, safra
--      pela primeira onda de cada vaga, mais receita_cents (preco da vaga
--      preenchida pela regra do faturamento) que sai null para quem nao e
--      admin nem gestor.
--   8. objetivo_de_conversao: o objetivo da taxa de conversao (A3), uma
--      linha por clinica. Membro ativo le; admin e gestor gravam, sempre em
--      nome proprio.
--   9. faturamento_do_periodo(...): preco das consultas com comparecimento
--      no periodo (preco do vinculo; sem ele, o preco base do procedimento;
--      "Coberto" sem valor NAO cai no preco base e e contado a parte; sem
--      preco nenhum tambem a parte). null para quem nao e admin nem gestor.
--  10. serie_diaria_do_periodo(...): leads e agendamentos criados por dia
--      civil da clinica, sem pular dia, com os mesmos criterios de
--      funil_do_periodo (leads por first_contact_at, agendamentos por
--      created_at). null para o profissional.
--  11. agenda_do_periodo: recuperadas.receita_cents passa a sair null para
--      quem nao e admin nem gestor (valor em reais so para a gestao, decisao
--      de 02/10). Corpo de PRODUCAO (pg_get_functiondef em 02/10) com so essa
--      linha trocada; assinatura, regra de preco das recuperadas e o resto
--      identicos (Inicio e Resultados usam).
--
-- Valor em reais e service_role: as funcoes que escondem reais testam
-- "auth.uid() is null or user_has_role(clinica, admin/gestor)". service_role
-- (testes, scripts) nao tem sub no JWT e passa; anon nao tem grant;
-- authenticated sempre tem sub, entao a sessao so ve reais com o papel.
--
-- Todas as funcoes novas sao SECURITY INVOKER (a RLS faz o recorte; nenhuma
-- precisa enxergar alem da sessao), com search_path fixo, sem execute para
-- public e anon, e com execute para authenticated e service_role.
-- fechar_runs_orfas continua SECURITY DEFINER e so para service_role, como
-- em producao.
--
-- Rollback (nesta ordem; as telas da Fase 3 deixam de ter dado):
--   create or replace function public.agenda_do_periodo(...) com o corpo da
--     20260918100000 (a linha da receita volta a
--     'receita_cents', coalesce(sum(sl.price_cents), 0),);
--   drop function if exists public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz);
--   drop function if exists public.faturamento_do_periodo(uuid, timestamptz, timestamptz, timestamptz);
--   drop table if exists public.objetivo_de_conversao;
--   drop function if exists public.metricas_da_espera(uuid);
--   drop function if exists public.metricas_de_pacientes(uuid);
--   drop index if exists public.appointment_comparecimento_idx;
--   drop function if exists public.funil_da_jornada(uuid);
--   drop function if exists public.resumo_do_dia(uuid, timestamptz[], timestamptz, timestamptz, timestamptz);
--   drop function if exists public.consulta_foi_confirmada(text, text);
--   create or replace function public.fechar_runs_orfas() com o corpo da
--     20260831100000 (sem motivo_da_falha) ANTES de apagar a coluna;
--   drop index if exists public.cadence_run_clinic_sent_at_idx;
--   alter table public.cadence_run drop column if exists motivo_da_falha;
--   (e o codigo de lib/jobs/regua.ts que grava motivo_da_falha volta junto:
--   sem a coluna, o update do pulo falha e vira retry do job.)

-- ---------------------------------------------------------------------------
-- 1) cadence_run.motivo_da_falha
-- ---------------------------------------------------------------------------

alter table public.cadence_run
  add column if not exists motivo_da_falha text;

alter table public.cadence_run
  drop constraint if exists cadence_run_motivo_da_falha_formato;
alter table public.cadence_run
  add constraint cadence_run_motivo_da_falha_formato
  check (motivo_da_falha is null or motivo_da_falha ~ '^[a-z0-9_]{1,64}$');

alter table public.cadence_run
  drop constraint if exists cadence_run_motivo_da_falha_so_em_falha_envio;
-- "is not distinct from": com "=", skipped_reason nulo daria null e o CHECK
-- passaria (motivo gravado numa run ainda aberta).
alter table public.cadence_run
  add constraint cadence_run_motivo_da_falha_so_em_falha_envio
  check (motivo_da_falha is null
         or skipped_reason is not distinct from 'falha_envio');

comment on column public.cadence_run.motivo_da_falha is
  'Codigo curto (^[a-z0-9_]{1,64}$) da falha de envio, so com skipped_reason = falha_envio. Gravado por pularRun (codigo do resultado do envio) e por fechar_runs_orfas (job_queue.last_error ate o primeiro dois pontos); fora do formato vira desconhecido. Nunca texto do provedor nem dado de paciente.';

-- "Ultimo disparo HH:mm" do Inicio: max(sent_at) da clinica no dia.
create index if not exists cadence_run_clinic_sent_at_idx
  on public.cadence_run (clinic_id, sent_at desc)
  where sent_at is not null;

-- ---------------------------------------------------------------------------
-- 2) fechar_runs_orfas grava o motivo
-- ---------------------------------------------------------------------------

create or replace function public.fechar_runs_orfas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fechadas integer;
begin
  -- Um job por run: o mais recente que desistiu (updated_at e a hora da
  -- desistencia). O codigo dele vira motivo_da_falha pela mesma regra do
  -- TS (motivoDaFalhaDeEnvio em lib/jobs/regua.ts).
  with orfas as (
    select distinct on ((j.payload->>'cadence_run_id')::uuid)
           (j.payload->>'cadence_run_id')::uuid as run_id,
           j.last_error
    from job_queue j
    where j.kind = 'executar_passo_de_regua'
      and j.status = 'falhou'
      and j.payload ? 'cadence_run_id'
    order by (j.payload->>'cadence_run_id')::uuid, j.updated_at desc, j.id desc
  )
  update cadence_run r
     set skipped_reason = 'falha_envio',
         motivo_da_falha = coalesce(
           substring(
             lower(btrim(split_part(coalesce(o.last_error, ''), ':', 1)))
             from '^[a-z0-9_]{1,64}$'
           ),
           'desconhecido'
         )
    from orfas o
   where r.id = o.run_id
     and r.sent_at is null
     and r.skipped_reason is null;
  get diagnostics v_fechadas = row_count;
  return v_fechadas;
end;
$$;

-- create or replace preserva os grants; a superficie fica explicita aqui.
revoke all on function public.fechar_runs_orfas() from public, anon, authenticated;
grant execute on function public.fechar_runs_orfas() to service_role;

comment on function public.fechar_runs_orfas() is
  'Fecha como falha_envio a run cujo job de regua desistiu (status falhou), gravando em motivo_da_falha o codigo do job mais recente (last_error ate o primeiro dois pontos, minusculas; fora de ^[a-z0-9_]{1,64}$ vira desconhecido). Devolve quantas fechou.';

-- ---------------------------------------------------------------------------
-- 3) consulta_foi_confirmada: o predicado unico de "Confirmada"
-- ---------------------------------------------------------------------------

create or replace function public.consulta_foi_confirmada(
  p_status text,
  p_canal text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_status in ('confirmado_paciente', 'confirmado_recepcao')
    or (p_canal is not null
        and p_status in ('na_recepcao', 'em_atendimento', 'compareceu', 'faltou')),
    false
  )
$$;

revoke all on function public.consulta_foi_confirmada(text, text) from public, anon;
grant execute on function public.consulta_foi_confirmada(text, text)
  to authenticated, service_role;

comment on function public.consulta_foi_confirmada(text, text) is
  'Predicado unico de Confirmada (espelho em TS: foiConfirmada): status confirmado_paciente ou confirmado_recepcao, ou com confirmation_channel e ja em na_recepcao, em_atendimento, compareceu ou faltou. Remarcada de volta para agendado (canal limpo) e cancelada nao contam.';

-- ---------------------------------------------------------------------------
-- 4) resumo_do_dia: cartoes do dia e barras de 7 dias do Inicio
-- ---------------------------------------------------------------------------

create or replace function public.resumo_do_dia(
  p_clinic_id uuid,
  p_inicios timestamptz[],
  p_fim timestamptz,
  p_semana_passada_de timestamptz,
  p_semana_passada_ate timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    -- Agregado da clinica para o profissional seria numero enganoso (a RLS
    -- de appointment recorta a agenda dele): null, como funil_do_periodo.
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      -- p_inicios: o inicio (UTC) de cada dia civil de D-6 a D, em ordem; o
      -- fim de cada dia e o inicio do seguinte, e o de D e p_fim.
      with dias as (
        select i as ordem,
               p_inicios[i] as de,
               coalesce(p_inicios[i + 1], p_fim) as ate
          from generate_subscripts(p_inicios, 1) as i
      ),
      hoje as (
        select de, ate from dias order by ordem desc limit 1
      )
      select jsonb_build_object(
        'hoje', (
          select jsonb_build_object(
            'total', count(a.id),
            'confirmadas', count(a.id) filter (
              where public.consulta_foi_confirmada(a.status, a.confirmation_channel)),
            'aguardando', count(a.id) filter (
              where a.status in ('agendado', 'aguardando_confirmacao')),
            'canceladas', count(a.id) filter (
              where a.status in ('cancelado_paciente', 'cancelado_clinica')),
            'unidades', count(distinct a.unit_id) filter (
              where a.status not in ('cancelado_paciente', 'cancelado_clinica'))
          )
            from hoje h
            left join appointment a
              on a.clinic_id = p_clinic_id
             and a.starts_at >= h.de and a.starts_at < h.ate
        ),
        'semana_passada', (
          select jsonb_build_object(
            'total', count(*),
            'confirmadas', count(*) filter (
              where public.consulta_foi_confirmada(a.status, a.confirmation_channel))
          )
            from appointment a
           where a.clinic_id = p_clinic_id
             and a.starts_at >= p_semana_passada_de
             and a.starts_at < p_semana_passada_ate
        ),
        -- Inclui o "Cobrar agora", que tambem vira run da regua de
        -- confirmacao (lib/jobs/cobranca-manual.ts).
        'ultimo_disparo', (
          select max(r.sent_at)
            from cadence_run r
            join cadence_step s on s.id = r.cadence_step_id
            join cadence c on c.id = s.cadence_id
           cross join hoje h
           where r.clinic_id = p_clinic_id
             and c.kind = 'confirmacao'
             and r.sent_at >= h.de and r.sent_at < h.ate
        ),
        -- Mesma definicao de "Consultas hoje" (todas as situacoes), para a
        -- barra de hoje bater com o cartao.
        'por_dia', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'ordem', d.ordem,
                   'total', (
                     select count(*) from appointment a
                      where a.clinic_id = p_clinic_id
                        and a.starts_at >= d.de and a.starts_at < d.ate
                   )
                 ) order by d.ordem)
            from dias d
        ), '[]'::jsonb)
      )
    )
  end
$$;

revoke all on function public.resumo_do_dia(uuid, timestamptz[], timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.resumo_do_dia(uuid, timestamptz[], timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.resumo_do_dia(uuid, timestamptz[], timestamptz, timestamptz, timestamptz) is
  'Inicio: consultas do dia (total, confirmadas pelo predicado unico, aguardando, canceladas, unidades distintas das nao canceladas), o mesmo dia da semana passada (total, confirmadas), ultimo sent_at da regua de confirmacao no dia e o total por dia de D-6 a D. Limites UTC vindos do TS no fuso da clinica. null para o profissional. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 5) funil_da_jornada: retrato atual por etapa da jornada
-- ---------------------------------------------------------------------------

create or replace function public.funil_da_jornada(p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'chave', d.chave,
               'nome', d.nome,
               'papel', d.papel,
               'posicao', d.posicao,
               'total', coalesce(n.total, 0)
             ) order by d.posicao, d.chave)
        from funnel_stage_def d
        left join (
          select c.funnel_stage, count(*) as total
            from contact c
           where c.clinic_id = p_clinic_id
           group by c.funnel_stage
        ) n on n.funnel_stage = d.chave
       where d.clinic_id = p_clinic_id
    ), '[]'::jsonb)
  end
$$;

revoke all on function public.funil_da_jornada(uuid) from public, anon;
grant execute on function public.funil_da_jornada(uuid) to authenticated, service_role;

comment on function public.funil_da_jornada(uuid) is
  'Funil de leads do Inicio: as etapas da jornada da clinica em ordem de posicao, cada uma com o total ATUAL de contatos (sem filtro de kind, como o Kanban de Leads; zero para etapa vazia). null para o profissional. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 6) metricas_de_pacientes
-- ---------------------------------------------------------------------------

-- Comparecimentos por clinica e data: ativos, retorno, primeiro
-- comparecimento e o faturamento do periodo.
create index if not exists appointment_comparecimento_idx
  on public.appointment (clinic_id, starts_at)
  include (contact_id)
  where status = 'compareceu';

create or replace function public.metricas_de_pacientes(p_clinic_id uuid)
returns table (
  ativos bigint,
  ativos_30d_atras bigint,
  novos_no_mes bigint,
  retorno_base bigint,
  retorno_voltaram bigint,
  sem_contato_6m bigint,
  primeiro_comparecimento timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Limites no fuso da clinica. Armadilha conferida: date_trunc em
  -- timestamptz trunca no fuso da SESSAO (UTC); por isso o mes parte do dia
  -- civil local convertido para timestamp sem fuso. As janelas fecham no fim
  -- de hoje (o Compareceu e liberado desde o inicio do dia da consulta).
  with m as (
    select
      c.timezone as tz,
      (h.hoje + 1)::timestamp at time zone c.timezone as fim_hoje,
      ((h.hoje + 1) - interval '12 months') at time zone c.timezone as ini_12m,
      ((h.hoje + 1) - interval '30 days') at time zone c.timezone as fim_30d,
      ((h.hoje + 1) - interval '30 days' - interval '12 months') at time zone c.timezone as ini_12m_30d,
      date_trunc('month', h.hoje::timestamp) at time zone c.timezone as ini_mes,
      (date_trunc('month', h.hoje::timestamp) + interval '1 month') at time zone c.timezone as ini_mes_seg,
      (h.hoje - interval '90 days') at time zone c.timezone as fim_maduro,
      (h.hoje - interval '6 months') at time zone c.timezone as seis_meses
    from public.clinic c
    cross join lateral (select (now() at time zone c.timezone)::date as hoje) h
    where c.id = p_clinic_id
  ),
  -- Comparecimentos dos ultimos 13 meses: as duas janelas de ativos e a
  -- base do retorno.
  comp as (
    select a.id, a.contact_id, a.starts_at
      from public.appointment a
     cross join m
     where a.clinic_id = p_clinic_id
       and a.status = 'compareceu'
       and a.starts_at >= m.ini_12m_30d
       and a.starts_at < m.fim_hoje
  ),
  ativos as (
    select
      count(distinct comp.contact_id) filter (where comp.starts_at >= m.ini_12m) as agora,
      count(distinct comp.contact_id) filter (where comp.starts_at < m.fim_30d) as ha_30d
    from comp cross join m
  ),
  -- Regra de hoje (pacientes-ui): a primeira consulta nao cancelada do
  -- contato cai no mes civil (passada ou futura).
  novos as (
    select count(distinct a.contact_id) as no_mes
      from public.appointment a
     cross join m
     where a.clinic_id = p_clinic_id
       and a.starts_at >= m.ini_mes and a.starts_at < m.ini_mes_seg
       and a.status not in ('cancelado_paciente', 'cancelado_clinica')
       and not exists (
         select 1 from public.appointment b
          where b.contact_id = a.contact_id
            and b.clinic_id = p_clinic_id
            and b.starts_at < m.ini_mes
            and b.status not in ('cancelado_paciente', 'cancelado_clinica')
       )
  ),
  -- Janela madura [12 meses, 90 dias atras): a unidade e o comparecimento.
  -- Voltou = outra consulta viva ou atendida em OUTRO dia civil (no fuso
  -- da clinica) ate 90 dias depois. Falta e cancelada nao contam.
  retorno as (
    select count(*) as base,
           count(*) filter (where exists (
             select 1 from public.appointment b
              where b.contact_id = comp.contact_id
                and b.clinic_id = p_clinic_id
                and b.id <> comp.id
                and (b.starts_at at time zone m.tz)::date
                      > (comp.starts_at at time zone m.tz)::date
                and b.starts_at <= comp.starts_at + interval '90 days'
                and b.status not in ('cancelado_paciente', 'cancelado_clinica', 'faltou')
           )) as voltaram
      from comp cross join m
     where comp.starts_at >= m.ini_12m
       and comp.starts_at < m.fim_maduro
  ),
  -- Ultimo comparecimento ha mais de 6 meses e nada marcado daqui para a
  -- frente (cancelada nao conta como marcada). Quem nunca compareceu nao
  -- entra.
  sem_contato as (
    select count(*) as seis_meses
      from (
        select a.contact_id
          from public.appointment a
         where a.clinic_id = p_clinic_id
         group by a.contact_id
        having max(a.starts_at) filter (where a.status = 'compareceu')
                 < (select m.seis_meses from m)
           and count(*) filter (
                 where a.starts_at > now()
                   and a.status not in ('cancelado_paciente', 'cancelado_clinica')) = 0
      ) x
  )
  select ativos.agora,
         ativos.ha_30d,
         novos.no_mes,
         retorno.base,
         retorno.voltaram,
         sem_contato.seis_meses,
         (select min(a.starts_at)
            from public.appointment a
           where a.clinic_id = p_clinic_id
             and a.status = 'compareceu')
    from ativos, novos, retorno, sem_contato
$$;

revoke all on function public.metricas_de_pacientes(uuid) from public, anon;
grant execute on function public.metricas_de_pacientes(uuid) to authenticated, service_role;

comment on function public.metricas_de_pacientes(uuid) is
  'Pacientes (uma linha): ativos = contatos com comparecimento nos ultimos 12 meses (e o mesmo calculo 30 dias atras); novos no mes civil; retorno em 90 dias sobre os comparecimentos da janela madura [12 meses, 90 dias atras) com outra consulta viva ou atendida em outro dia civil (falta nao conta); sem consulta ha 6 meses e nada marcado; primeiro comparecimento. Fuso da clinica. Para o profissional a RLS recorta a agenda dele. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 7) metricas_da_espera
-- ---------------------------------------------------------------------------

create or replace function public.metricas_da_espera(p_clinic_id uuid)
returns table (
  vagas_oferecidas bigint,
  vagas_preenchidas bigint,
  vagas_em_andamento bigint,
  vagas_canceladas bigint,
  vagas_esgotadas bigint,
  primeira_onda_base bigint,
  primeira_onda_aceita bigint,
  tempo_medio_min integer,
  receita_cents bigint,
  vagas_com_valor bigint,
  vagas_cobertas bigint,
  vagas_sem_preco bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Mes civil da clinica (now() at time zone tz ja e timestamp sem fuso: o
  -- date_trunc trunca no dia local).
  with m as (
    select date_trunc('month', (now() at time zone c.timezone)) at time zone c.timezone as ini_mes,
           (date_trunc('month', (now() at time zone c.timezone)) + interval '1 month')
             at time zone c.timezone as ini_mes_seg
      from public.clinic c
     where c.id = p_clinic_id
  ),
  -- Vaga = source_appointment_id (a consulta que abriu o horario); onda =
  -- uma linha de waitlist_offer. So uma onda por vaga vira preenchida.
  vagas as (
    select o.source_appointment_id,
           min(o.created_at) as primeira_onda,
           bool_or(o.status = 'preenchida') as preenchida,
           bool_or(o.status = 'aberta') as em_andamento,
           max(o.responded_at) filter (where o.status = 'preenchida') as preenchida_em,
           (array_agg(o.appointment_id) filter (where o.status = 'preenchida'))[1] as consulta_nova,
           (array_agg(o.status order by o.created_at, o.id))[1] as status_1a_onda,
           (array_agg(o.status order by o.created_at desc, o.id desc))[1] as status_ultima_onda
      from public.waitlist_offer o
     where o.clinic_id = p_clinic_id
     group by o.source_appointment_id
  ),
  -- Safra: a vaga entra no mes da PRIMEIRA onda.
  safra as (
    select v.*
      from vagas v
     cross join m
     where v.primeira_onda >= m.ini_mes
       and v.primeira_onda < m.ini_mes_seg
  ),
  -- Mesma regra de preco do faturamento: preco do vinculo; sem ele, o preco
  -- base do procedimento; "Coberto" sem valor nao cai no preco base.
  precos as (
    select case
             when sl.price_cents is not null then sl.price_cents
             when sl.covered_by_insurance then null
             else pr.base_price_cents
           end as valor,
           (sl.price_cents is null and sl.covered_by_insurance) as coberta
      from safra s
      join public.appointment a on a.id = s.consulta_nova
      join public.service_link sl on sl.id = a.service_link_id
      join public.procedure pr on pr.id = sl.procedure_id
     where s.preenchida
  )
  select count(*),
         count(*) filter (where s.preenchida),
         count(*) filter (where s.em_andamento),
         count(*) filter (where not s.preenchida and not s.em_andamento
                            and s.status_ultima_onda = 'cancelada'),
         count(*) filter (where not s.preenchida and not s.em_andamento
                            and s.status_ultima_onda = 'expirada'),
         -- Primeira onda resolvida pelo paciente (aceita ou vencida); a
         -- cancelada pela recepcao nao entra.
         count(*) filter (where s.status_1a_onda in ('preenchida', 'expirada')),
         count(*) filter (where s.status_1a_onda = 'preenchida'),
         round(avg(extract(epoch from (s.preenchida_em - s.primeira_onda)) / 60)
               filter (where s.preenchida and s.preenchida_em >= s.primeira_onda))::integer,
         -- Valor em reais so para admin e gestor (service_role passa).
         case
           when auth.uid() is null
                or public.user_has_role(p_clinic_id, array['admin', 'gestor'])
             then (select coalesce(sum(p.valor), 0) from precos p)::bigint
         end,
         -- O que ficou fora da soma, como no faturamento: com tudo sem
         -- valor a tela diz "Sem preço para somar", nunca R$ 0,00. Vem junto
         -- com a receita (null fora da gestao).
         case
           when auth.uid() is null
                or public.user_has_role(p_clinic_id, array['admin', 'gestor'])
             then (select count(p.valor) from precos p)::bigint
         end,
         case
           when auth.uid() is null
                or public.user_has_role(p_clinic_id, array['admin', 'gestor'])
             then (select count(*) filter (where p.coberta) from precos p)::bigint
         end,
         case
           when auth.uid() is null
                or public.user_has_role(p_clinic_id, array['admin', 'gestor'])
             then (select count(*) filter (where p.valor is null and not p.coberta) from precos p)::bigint
         end
    from safra s
$$;

revoke all on function public.metricas_da_espera(uuid) from public, anon;
grant execute on function public.metricas_da_espera(uuid) to authenticated, service_role;

comment on function public.metricas_da_espera(uuid) is
  'Lista de espera no mes civil da clinica, safra pela primeira onda de cada vaga: oferecidas, preenchidas, em andamento, canceladas, esgotadas, base e aceite da primeira onda, tempo medio (min) da primeira onda ao aceite e receita_cents das preenchidas (preco do vinculo, senao o base do procedimento, Coberto sem valor fora), com vagas_com_valor, vagas_cobertas e vagas_sem_preco (o que ficou fora da soma); receita e essas tres contagens sao null para quem nao e admin nem gestor. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 8) objetivo_de_conversao
-- ---------------------------------------------------------------------------

create table if not exists public.objetivo_de_conversao (
  clinic_id uuid primary key references public.clinic (id) on delete cascade,
  percentual numeric(4, 1) not null
    check (percentual > 0 and percentual <= 100),
  -- set null: a pessoa pode sair da base; o objetivo da clinica fica.
  definido_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.objetivo_de_conversao is
  'Objetivo da taxa de conversao da clinica (A3, Resultados): uma linha por clinica, percentual de 0,1 a 100. Membro ativo le; admin e gestor gravam em nome proprio (definido_por = auth.uid()).';

drop trigger if exists set_updated_at on public.objetivo_de_conversao;
create trigger set_updated_at
  before update on public.objetivo_de_conversao
  for each row execute function public.set_updated_at();

alter table public.objetivo_de_conversao enable row level security;

drop policy if exists "membro ativo le o objetivo de conversao"
  on public.objetivo_de_conversao;
create policy "membro ativo le o objetivo de conversao"
  on public.objetivo_de_conversao
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

-- user_has_role exige status ativo: pendente nao grava.
drop policy if exists "gestao define o objetivo de conversao"
  on public.objetivo_de_conversao;
create policy "gestao define o objetivo de conversao"
  on public.objetivo_de_conversao
  for insert to authenticated
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and definido_por = auth.uid()
  );

-- O upsert por clinic_id precisa desta e da de insert.
drop policy if exists "gestao altera o objetivo de conversao"
  on public.objetivo_de_conversao;
create policy "gestao altera o objetivo de conversao"
  on public.objetivo_de_conversao
  for update to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']))
  with check (
    public.user_has_role(clinic_id, array['admin', 'gestor'])
    and definido_por = auth.uid()
  );

drop policy if exists "gestao remove o objetivo de conversao"
  on public.objetivo_de_conversao;
create policy "gestao remove o objetivo de conversao"
  on public.objetivo_de_conversao
  for delete to authenticated
  using (public.user_has_role(clinic_id, array['admin', 'gestor']));

revoke all on table public.objetivo_de_conversao from anon;
revoke truncate, references, trigger on table public.objetivo_de_conversao
  from authenticated;

-- ---------------------------------------------------------------------------
-- 9) faturamento_do_periodo
-- ---------------------------------------------------------------------------

create or replace function public.faturamento_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_de_anterior timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    -- Valor em reais so para admin e gestor da clinica pedida. service_role
    -- (auth.uid() nulo) passa; anon nao tem grant.
    when auth.uid() is not null
         and not public.user_has_role(p_clinic_id, array['admin', 'gestor'])
      then null::jsonb
    else (
      with janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
        from janelas j
        cross join lateral (
          -- Consultas com comparecimento no periodo (por starts_at). Preco:
          -- o do vinculo; sem ele, o base do procedimento; "Coberto" (pelo
          -- convenio, sem preco no vinculo) NAO cai no base e conta a parte.
          -- Preco 0 e gratuito de verdade: entra como valor.
          with atendidas as (
            select case
                     when sl.price_cents is not null then sl.price_cents
                     when sl.covered_by_insurance then null
                     else pr.base_price_cents
                   end as valor,
                   (sl.covered_by_insurance and sl.price_cents is null) as coberta
              from appointment a
              join service_link sl on sl.id = a.service_link_id
              join procedure pr on pr.id = sl.procedure_id
             where a.clinic_id = p_clinic_id
               and a.status = 'compareceu'
               and a.starts_at >= j.de and a.starts_at < j.ate
          )
          select jsonb_build_object(
            'comparecimentos', count(*),
            'valor_cents', coalesce(sum(valor), 0),
            'com_valor', count(valor),
            'cobertas', count(*) filter (where coberta),
            'sem_preco', count(*) filter (where valor is null and not coberta)
          ) as corpo
            from atendidas
        ) bloco
    )
  end
$$;

revoke all on function public.faturamento_do_periodo(uuid, timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.faturamento_do_periodo(uuid, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.faturamento_do_periodo(uuid, timestamptz, timestamptz, timestamptz) is
  'Faturamento estimado: soma do preco das consultas com comparecimento em [p_de, p_ate) (e no periodo anterior quando p_de_anterior vem). Preco do vinculo, senao o base do procedimento; Coberto sem valor e sem preco nenhum contam a parte; preco 0 entra. null para quem nao e admin nem gestor da clinica. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 10) serie_diaria_do_periodo
-- ---------------------------------------------------------------------------

create or replace function public.serie_diaria_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when public.user_has_role(p_clinic_id, array['profissional']) then null::jsonb
    else (
      with fuso as (
        select coalesce(
                 (select c.timezone from clinic c where c.id = p_clinic_id),
                 'America/Fortaleza'
               ) as tz
      ),
      -- Todo dia civil tocado por [p_de, p_ate), sem pular dia vazio. O
      -- generate_series vai em timestamp sem fuso para o ::date nao passar
      -- pelo fuso da sessao.
      dias as (
        select s.dia_local::date as dia
          from fuso f
         cross join generate_series(
                (p_de at time zone f.tz)::date::timestamp,
                ((p_ate at time zone f.tz) - interval '1 microsecond')::date::timestamp,
                interval '1 day'
              ) as s (dia_local)
      ),
      -- Mesmos criterios de funil_do_periodo: leads por first_contact_at,
      -- agendamentos por created_at, janela semiaberta.
      l as (
        select (c.first_contact_at at time zone f.tz)::date as dia, count(*) as n
          from contact c
         cross join fuso f
         where c.clinic_id = p_clinic_id
           and c.first_contact_at >= p_de and c.first_contact_at < p_ate
         group by 1
      ),
      g as (
        select (a.created_at at time zone f.tz)::date as dia, count(*) as n
          from appointment a
         cross join fuso f
         where a.clinic_id = p_clinic_id
           and a.created_at >= p_de and a.created_at < p_ate
         group by 1
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'dia', d.dia,
               'leads', coalesce(l.n, 0),
               'agendadas', coalesce(g.n, 0)
             ) order by d.dia), '[]'::jsonb)
        from dias d
        left join l on l.dia = d.dia
        left join g on g.dia = d.dia
    )
  end
$$;

revoke all on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.serie_diaria_do_periodo(uuid, timestamptz, timestamptz) is
  'Resultados, Leads x consultas agendadas: por dia civil da clinica em [p_de, p_ate), leads (first_contact_at) e agendamentos criados (created_at), zero para dia vazio, em ordem. Soma bate com funil_do_periodo. null para o profissional. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 11) agenda_do_periodo: receita das recuperadas so para a gestao
-- ---------------------------------------------------------------------------
-- Corpo de producao (pg_get_functiondef em 02/10/2026); a unica mudanca e
-- recuperadas.receita_cents. O profissional continua recebendo o proprio
-- recorte, agora sem a receita.

CREATE OR REPLACE FUNCTION public.agenda_do_periodo(p_clinic_id uuid, p_de timestamp with time zone, p_ate timestamp with time zone, p_de_anterior timestamp with time zone DEFAULT NULL::timestamp with time zone, p_professional_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when public.user_has_role(p_clinic_id, array['profissional'])
         and (p_professional_id is null
              or p_professional_id is distinct from public.user_professional_id(p_clinic_id))
      then null::jsonb
    else (
      with janelas as (
        select 'atual'::text as rotulo, p_de as de, p_ate as ate
        union all
        select 'anterior', p_de_anterior, p_de where p_de_anterior is not null
      )
      select jsonb_object_agg(j.rotulo, bloco.corpo)
             || jsonb_build_object('pivo', (
                  select case when s.min_sent is null then null
                    else jsonb_build_object(
                      'primeira_regua_em', s.min_sent,
                      'antes', (
                        select jsonb_build_object(
                          'com_desfecho', count(*) filter (where a.status in ('compareceu', 'faltou')),
                          'faltas', count(*) filter (where a.status = 'faltou')
                        ) from appointment a
                         where a.clinic_id = p_clinic_id and a.starts_at < s.min_sent
                           and (p_professional_id is null or a.professional_id = p_professional_id)
                      ),
                      'depois', (
                        select jsonb_build_object(
                          'com_desfecho', count(*) filter (where a.status in ('compareceu', 'faltou')),
                          'faltas', count(*) filter (where a.status = 'faltou')
                        ) from appointment a
                         where a.clinic_id = p_clinic_id and a.starts_at >= s.min_sent
                           and (p_professional_id is null or a.professional_id = p_professional_id)
                      )
                    )
                  end
                  from (
                    select min(sent_at) as min_sent from cadence_run
                     where clinic_id = p_clinic_id and sent_at is not null
                  ) s
                ))
        from janelas j
        cross join lateral (
          with consultas as (
            select a.id, a.status, a.professional_id, a.service_link_id,
                   a.contact_id, a.starts_at
              from appointment a
             where a.clinic_id = p_clinic_id
               and a.starts_at >= j.de and a.starts_at < j.ate
               and (p_professional_id is null or a.professional_id = p_professional_id)
          )
          select jsonb_build_object(
            'total', (select count(*) from consultas),
            'criados', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id
                 and a.created_at >= j.de and a.created_at < j.ate
                 and (p_professional_id is null or a.professional_id = p_professional_id)
            ),
            'por_status', (
              select coalesce(jsonb_object_agg(t.status, t.n), '{}'::jsonb)
                from (select status, count(*) as n from consultas group by 1) t
            ),
            'confirmadas_alguma_vez', (
              select count(*) from consultas a
               where a.status in ('confirmado_paciente', 'confirmado_recepcao')
                  or exists (
                       select 1 from appointment_status_history h
                        where h.appointment_id = a.id
                          and h.status in ('confirmado_paciente', 'confirmado_recepcao')
                     )
            ),
            'por_profissional', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'professional_id', t.pid, 'nome', t.nome, 'total', t.n,
                       'compareceu', t.comp, 'faltou', t.falt, 'cancelados', t.canc
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select a.professional_id as pid, p.name as nome, count(*) as n,
                         count(*) filter (where a.status = 'compareceu') as comp,
                         count(*) filter (where a.status = 'faltou') as falt,
                         count(*) filter (where a.status in ('cancelado_paciente', 'cancelado_clinica')) as canc
                    from consultas a
                    join professional p on p.id = a.professional_id
                   group by 1, 2
                ) t
            ),
            'por_procedimento', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'procedure_id', t.prid, 'nome', t.nome, 'total', t.n,
                       'compareceu', t.comp, 'faltou', t.falt
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select pr.id as prid, pr.name as nome, count(*) as n,
                         count(*) filter (where a.status = 'compareceu') as comp,
                         count(*) filter (where a.status = 'faltou') as falt
                    from consultas a
                    join service_link sl on sl.id = a.service_link_id
                    join procedure pr on pr.id = sl.procedure_id
                   group by 1, 2
                ) t
            ),
            'recuperadas', (
              select jsonb_build_object(
                'total', count(*),
                -- Fase 3 (02/10): valor em reais so para admin e gestor;
                -- service_role (auth.uid() nulo) passa.
                'receita_cents', case
                  when auth.uid() is null
                       or public.user_has_role(p_clinic_id, array['admin', 'gestor'])
                    then coalesce(sum(sl.price_cents), 0)
                end,
                'sem_preco', count(*) filter (where sl.price_cents is null)
              )
                from waitlist_offer o
                left join appointment a2 on a2.id = o.appointment_id
                left join service_link sl on sl.id = a2.service_link_id
               where o.clinic_id = p_clinic_id and o.status = 'preenchida'
                 and o.slot_starts_at >= j.de and o.slot_starts_at < j.ate
                 and (p_professional_id is null or o.professional_id = p_professional_id)
            ),
            'remarcadas_apos_falta', (
              select jsonb_build_object(
                'faltas', count(*),
                'remarcadas', count(*) filter (where exists (
                  select 1 from appointment n
                   where n.clinic_id = p_clinic_id
                     and n.contact_id = f.contact_id
                     and n.id <> f.id
                     and n.created_at > f.starts_at
                     and n.created_at < f.starts_at + interval '30 days'
                     and n.status not in ('cancelado_paciente', 'cancelado_clinica')
                ))
              ) from consultas f where f.status = 'faltou'
            )
          ) as corpo
        ) bloco
    )
  end
$function$;

-- create or replace preserva os grants; reafirmados como em producao.
revoke all on function public.agenda_do_periodo(uuid, timestamptz, timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.agenda_do_periodo(uuid, timestamptz, timestamptz, timestamptz, uuid)
  to authenticated, service_role;

comment on function public.agenda_do_periodo(uuid, timestamptz, timestamptz, timestamptz, uuid) is
  'Agenda por periodo (Resultados e Inicio): totais, status, confirmadas alguma vez, por profissional e procedimento, recuperadas pela lista de espera e remarcadas apos falta, mais o pivo da primeira regua. recuperadas.receita_cents e null para quem nao e admin nem gestor (Fase 3). null para o profissional sem o proprio recorte. SECURITY INVOKER.';
