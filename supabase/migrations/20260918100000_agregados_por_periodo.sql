-- Fase 5.1 + 5.2 (Painel e Relatórios): agregados POR PERÍODO calculados no
-- banco, comparação com o período anterior numa chamada só, e o registro da
-- linha de base de no-show (tarefa 6.3, a metade que vive no sistema).
--
-- Desenho (decidido em 18/09/2026):
--
-- 1. TRES RPCs, uma por familia de tabela varrida (contact, appointment,
--    message). Uma RPC unica seria um monstro de manutencao; uma por aba
--    repetiria os mesmos scans. Cada uma devolve o periodo pedido E o
--    anterior na mesma chamada: o delta e a razao de existir do painel, e
--    duas chamadas dobrariam os scans.
-- 2. SECURITY INVOKER como resultados_da_clinica: a RLS decide o que a
--    sessao enxerga (regra 3.1). Janela semiaberta [de, ate); o periodo
--    anterior e [p_de_anterior, p_de), contiguo por construcao. Os limites
--    chegam PRONTOS em UTC, calculados pelo app com limitesDoDia no fuso da
--    clinica: a RPC nao sabe de fuso de proposito (uma unica autoridade).
-- 3. PAPEL profissional: trava NO BANCO, nao so na tela. INVOKER + RLS
--    devolveria a um profissional "leads da clinica inteira, agendamentos so
--    dele": numero enganoso sem rotulo, que e o que a regra "nao se inventa
--    numero" proibe. funil e atendimento devolvem null para o papel;
--    agenda so aceita o proprio professional_id.
-- 4. O que NAO esta aqui, de proposito: custo em reais (message_pricing
--    vazia, pendencia P1: a chave nem existe no shape, ausencia != zero),
--    "% resolvido pela IA" (nada escreve author='ia' ainda) e funil de
--    coorte por etapa da jornada (nao existe historico de transicao;
--    o retrato de hoje continua na RPC resultados_da_clinica).

-- ---------------------------------------------------------------------------
-- Índices dos eixos de recorte (conferidos contra os existentes)
-- ---------------------------------------------------------------------------

-- Eixo de "agendamentos criados" e de "consultas do periodo": nao existia
-- nenhum indice por created_at, e starts_at so aparecia em parciais ou em
-- terceira posicao de composta.
create index appointment_clinic_created_idx
  on public.appointment (clinic_id, created_at);
create index appointment_clinic_starts_idx
  on public.appointment (clinic_id, starts_at);

-- Eixo de leads por chegada.
create index contact_clinic_first_contact_idx
  on public.contact (clinic_id, first_contact_at);

-- message_clinic_idx (so clinic_id) existia para o cascade de exclusao; a
-- composta cobre o mesmo prefixo e vira o eixo do volume de mensagens e da
-- primeira resposta. Trocar, nao duplicar.
drop index if exists public.message_clinic_idx;
create index message_clinic_created_idx
  on public.message (clinic_id, created_at);

-- ---------------------------------------------------------------------------
-- Linha de base de no-show (tarefa 6.3): tabela append-only
-- ---------------------------------------------------------------------------

-- Tabela propria, nao colunas em clinic: sao seis campos correlacionados, e
-- o append-only E a trilha de quem registrou o que (audit_log nao carrega
-- payload). Corrigir = inserir linha nova; a mais recente vale. O valor e
-- INFORMADO pela clinica (medicao pre-implantacao), nunca calculado pelo
-- sistema, e fica rotulado assim na tela.
create table public.no_show_baseline (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  rate_percent numeric(5, 2) not null
    check (rate_percent >= 0 and rate_percent <= 100),
  measured_from date not null,
  measured_to date not null,
  constraint baseline_periodo_valido check (measured_to >= measured_from),
  note text,
  registered_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index no_show_baseline_vigente_idx
  on public.no_show_baseline (clinic_id, created_at desc);

alter table public.no_show_baseline enable row level security;

create policy "membro ativo le a linha de base" on public.no_show_baseline
  for select using (clinic_id in (select public.user_active_clinic_ids()));

-- So admin registra, sempre em nome proprio. SEM policy de update nem de
-- delete: a historia nao se reescreve.
create policy "admin registra linha de base" on public.no_show_baseline
  for insert with check (
    public.user_has_role(clinic_id, array['admin'])
    and registered_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RPC 1: funil_do_periodo — varre contact (+EXISTS em appointment)
-- ---------------------------------------------------------------------------

-- leads: chegada por first_contact_at (not null). coorte: dos leads que
-- CHEGARAM na janela, quantos ja agendaram / ja compareceram alguma vez (a
-- mesma logica de coorte de resultados_da_clinica, recortada por chegada).
-- por_campanha agrupa pelo PAR (nome, id): nao coalescer, senao nome legivel
-- de campaign_link e id numerico da Meta se misturam na mesma chave. A linha
-- (null, null) vem incluida: esconder o nao-rastreado inflaria a conversao
-- dos rastreados.
create or replace function public.funil_do_periodo(
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
          with leads as (
            select c.id,
                   c.source_channel,
                   c.source_campaign,
                   c.source_campaign_id,
                   exists (
                     select 1 from appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                   ) as agendou,
                   exists (
                     select 1 from appointment a
                      where a.clinic_id = p_clinic_id and a.contact_id = c.id
                        and a.status = 'compareceu'
                   ) as compareceu
              from contact c
             where c.clinic_id = p_clinic_id
               and c.first_contact_at >= j.de and c.first_contact_at < j.ate
          )
          select jsonb_build_object(
            'leads', (select count(*) from leads),
            'agendamentos_criados', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id
                 and a.created_at >= j.de and a.created_at < j.ate
            ),
            'comparecimentos', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id and a.status = 'compareceu'
                 and a.starts_at >= j.de and a.starts_at < j.ate
            ),
            'faltas', (
              select count(*) from appointment a
               where a.clinic_id = p_clinic_id and a.status = 'faltou'
                 and a.starts_at >= j.de and a.starts_at < j.ate
            ),
            'coorte', (
              select jsonb_build_object(
                'leads', count(*),
                'agendaram', count(*) filter (where agendou),
                'compareceram', count(*) filter (where compareceu)
              ) from leads
            ),
            'por_canal', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'canal', t.canal, 'leads', t.n,
                       'agendaram', t.ag, 'compareceram', t.comp
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select source_channel as canal, count(*) as n,
                         count(*) filter (where agendou) as ag,
                         count(*) filter (where compareceu) as comp
                    from leads group by 1
                ) t
            ),
            'por_campanha', (
              select coalesce(jsonb_agg(jsonb_build_object(
                       'campanha', t.campanha, 'campanha_id', t.campanha_id,
                       'leads', t.n, 'agendaram', t.ag, 'compareceram', t.comp
                     ) order by t.n desc), '[]'::jsonb)
                from (
                  select source_campaign as campanha,
                         source_campaign_id as campanha_id,
                         count(*) as n,
                         count(*) filter (where agendou) as ag,
                         count(*) filter (where compareceu) as comp
                    from leads group by 1, 2
                ) t
            )
          ) as corpo
        ) bloco
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- RPC 2: agenda_do_periodo — varre appointment (+history, espera, regua)
-- ---------------------------------------------------------------------------

-- confirmadas_alguma_vez: status atual OU a trilha (appointment_status_history).
-- Sem a trilha, a consulta confirmada que depois virou compareceu perderia a
-- confirmacao e a taxa sairia FALSA. Devolvido como "X de Y": a exclusao de
-- canceladas do denominador, se a tela quiser, e decisao de apresentacao
-- visivel, nunca escondida no SQL.
--
-- recuperadas: por slot_starts_at, mesma definicao do card da Tela 2
-- (fetchRecuperadasDoDia): dois numeros com o mesmo nome DEVEM contar igual.
-- receita ignora price_cents nulo e conta 'sem_preco' a parte: null nunca
-- vira zero em silencio.
--
-- remarcadas_apos_falta: falta do periodo cujo contato criou consulta nova
-- em ate 30 dias (constante, generosa e alinhada a janela do painel) e que
-- nao esta cancelada hoje. FACTUAL: "remarcou apos a falta", nunca
-- "recuperada pela regua" (nada liga o appointment novo ao toque).
--
-- pivo: antes/depois do primeiro toque de regua da clinica (min sent_at),
-- taxa de falta so sobre consultas COM DESFECHO (pendente e futura
-- distorceriam). Null quando a regua nunca disparou.
create or replace function public.agenda_do_periodo(
  p_clinic_id uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_de_anterior timestamptz default null,
  p_professional_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
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
                'receita_cents', coalesce(sum(sl.price_cents), 0),
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
$$;

-- ---------------------------------------------------------------------------
-- RPC 3: atendimento_do_periodo — varre message/conversation
-- ---------------------------------------------------------------------------

-- primeira_resposta: conversas cuja PRIMEIRA mensagem de entrada da vida cai
-- na janela; resposta = primeira saida de author 'usuario' que nao e nota
-- interna, mesmo que caia depois de p_ate (o tempo de resposta e o que e).
-- MEDIANA e P90, nunca media: uma noite sem plantao destruiria a media.
-- Zero conversas -> null -> a tela diz "sem dados", nunca 0.
-- Mensagens apagadas CONTAM no volume (apagar nao desfaz o envio); notas
-- internas ficam fora de por_autor (nao sao mensagens enviadas).
create or replace function public.atendimento_do_periodo(
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
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------

-- INVOKER + RLS ja recorta, mas anon nao tem por que executar nada disto.
revoke execute on function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz) from public, anon;
revoke execute on function public.agenda_do_periodo(uuid, timestamptz, timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.atendimento_do_periodo(uuid, timestamptz, timestamptz, timestamptz) from public, anon;

grant execute on function public.funil_do_periodo(uuid, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.agenda_do_periodo(uuid, timestamptz, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.atendimento_do_periodo(uuid, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
