-- ---------------------------------------------------------------------------
-- O desempenho do agente em Resultados (resto da AG0)
-- ---------------------------------------------------------------------------
-- atendimento_do_periodo ganha um bloco "agente" em cada janela (atual e
-- anterior), para a aba Agente de IA e o resumo da Visao geral trocarem o
-- "Ainda não medido" por numero real. Nada de tabela, coluna ou indice novo.
-- O corpo de antes (20261006140000, passo 11) fica igual, byte a byte; so
-- entram os blocos marcados [desempenho do agente].
--
-- O BLOCO, na janela [de, ate) e na clinica pedida:
--   atendidas: conversas com resposta da IA que saiu (author ia, saida, sem
--     nota interna, com recibo 'enviada', 'entregue' ou 'lida').
--   resolvidas_sem_humano: dessas, as que, na janela, nao tem saida da equipe
--     (author usuario, sem nota interna), nao tem escalation_reason e nao tem
--     resposta da IA sem recibo ('enviando' ou 'falhou').
--   transferidas: conversas com ai_decision_log.escalation_reason na janela.
--   insatisfacao: dessas, as com escalation_reason 'insatisfacao'.
--   primeira_resposta_mediana_segundos: sobre o CTE elegiveis (a primeira
--     entrada da conversa na janela), a mediana ate a primeira resposta da
--     IA que saiu, sem teto, como a da equipe; null sem nenhuma.
--   agendamentos: consultas com created_by 'ia' criadas na janela, menos as
--     recusadas pela equipe (approval_status nulo nao e recusa). A consulta
--     nova da remarcacao pela IA conta.
--
-- DECISOES A CONFIRMAR COM O DONO (docs/05, entrada "Resto da AG0"): a passagem
-- para a equipe tira a conversa de resolvida; a consulta recusada nao conta; a
-- resposta da IA sem recibo nao conta (o envio que falhou nao chegou ao
-- paciente, e o motor passa essa conversa para a equipe sem escalation_reason).
--
-- O QUE NAO MUDA: SECURITY INVOKER (a RLS vale; de ai_decision_log, so colunas
-- com grant, nunca blocked_draft), null para o papel profissional, a
-- assinatura, STABLE, o search_path, o dono e os grants.
--
-- O CODIGO funciona com e sem esta migration: sem o bloco, lerAtendimento
-- devolve agente null e a tela fica no "Ainda não medido". A ordem de
-- publicacao e livre.
--
-- LOCKS (lock_timeout de 3 s): so catalogo e ACCESS SHARE em message,
-- conversation, ai_decision_log, appointment e mensagem_agendada, ate o commit
-- (medido no Postgres local). Nao segura leitura nem escrita de ninguem.
--
-- ROLLBACK (manual, numa transacao, no SQL editor):
-- supabase/operacao/rollback/20261104120000-corpos-anteriores.sql. O codigo
-- continua funcionando (agente null). Ensaio:
-- ~/.claude/plans/agente-completo/ag0/ensaio-20261104120000.sql.

set local lock_timeout = '3s';

create or replace function public.atendimento_do_periodo(
  p_clinic_id uuid,
  p_de timestamp with time zone,
  p_ate timestamp with time zone,
  p_de_anterior timestamp with time zone default null::timestamp with time zone
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
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
                       and m.created_at > e.entrada_em
                       -- [mensagem agendada] inicio
                       and not exists (
                         select 1 from public.mensagem_agendada ma
                          where ma.message_id = m.id
                       )
                       -- [mensagem agendada] fim
                   ) as resposta_em
              from elegiveis e
          )
          -- [desempenho do agente] inicio
          -- A primeira resposta da IA, sobre as mesmas conversas de medidas.
          , medidas_da_ia as (
            select e.entrada_em,
                   (select min(m.created_at) from message m
                     where m.conversation_id = e.conversation_id
                       and m.direction = 'saida' and m.author = 'ia'
                       and not m.is_internal_note
                       and m.delivery_status in ('enviada', 'entregue', 'lida')
                       and m.created_at > e.entrada_em
                   ) as resposta_em
              from elegiveis e
          ), saidas_da_janela as (
            -- Resposta da IA so conta com recibo de que saiu (os mesmos de
            -- RECIBOS_DE_ENVIADA, lib/agente/whatsapp.ts). A que falhou ou
            -- ficou em 'enviando' passou para a equipe SEM escalation_reason
            -- (passarSemFraseEFechar): a conversa nao foi resolvida pela IA.
            select m.conversation_id,
                   count(*) filter (where m.author = 'ia'
                     and m.delivery_status in ('enviada', 'entregue', 'lida')) as da_ia_que_sairam,
                   count(*) filter (where m.author = 'ia'
                     and m.delivery_status in ('enviando', 'falhou')) as da_ia_sem_recibo,
                   count(*) filter (where m.author = 'usuario') as da_equipe
              from message m
             where m.clinic_id = p_clinic_id
               and m.created_at >= j.de and m.created_at < j.ate
               and m.direction = 'saida' and not m.is_internal_note
               and m.author in ('ia', 'usuario')
             group by 1
          ), transferidas as (
            select d.conversation_id,
                   bool_or(d.escalation_reason = 'insatisfacao') as por_insatisfacao
              from ai_decision_log d
             where d.clinic_id = p_clinic_id
               and d.created_at >= j.de and d.created_at < j.ate
               and d.escalation_reason is not null
             group by 1
          )
          -- [desempenho do agente] fim
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
            -- [desempenho do agente] inicio
            , 'agente', jsonb_build_object(
              'atendidas', (
                select count(*) from saidas_da_janela s where s.da_ia_que_sairam > 0
              ),
              'resolvidas_sem_humano', (
                select count(*) from saidas_da_janela s
                 where s.da_ia_que_sairam > 0
                   and s.da_ia_sem_recibo = 0
                   and s.da_equipe = 0
                   and not exists (
                     select 1 from transferidas t
                      where t.conversation_id = s.conversation_id
                   )
              ),
              'transferidas', (select count(*) from transferidas),
              'insatisfacao', (select count(*) from transferidas t where t.por_insatisfacao),
              'primeira_resposta_mediana_segundos', (
                select round(percentile_cont(0.5) within group
                  (order by extract(epoch from resposta_em - entrada_em))::numeric)
                  from medidas_da_ia
              ),
              'agendamentos', (
                select count(*) from appointment a
                 where a.clinic_id = p_clinic_id
                   and a.created_by = 'ia'
                   and a.created_at >= j.de and a.created_at < j.ate
                   -- approval_status nulo e o fluxo sem aprovacao: nao e recusa.
                   and a.approval_status is distinct from 'recusado'
              )
            )
            -- [desempenho do agente] fim
          ) as corpo
        ) bloco
    )
  end
$function$;
