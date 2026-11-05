-- Rollback manual da migration 20261104120000_desempenho_do_agente.sql (o
-- bloco "agente" de atendimento_do_periodo, resto da AG0).
--
-- O QUE A MIGRATION FEZ: so o create or replace de atendimento_do_periodo,
-- com o corpo de antes (20261006140000, passo 11) mais os blocos marcados
-- [desempenho do agente]. Nenhuma tabela, coluna ou indice.
--
-- O QUE ESTE ARQUIVO FAZ: devolve a funcao ao corpo de antes e confere o
-- md5(prosrc) dele. O dono, os grants, o search_path e a assinatura nao mudam
-- nem na migration nem aqui.
--
-- ORDEM: livre. O codigo funciona com e sem o bloco: sem ele, lerAtendimento
-- devolve agente null e a tela volta ao "Ainda não medido". Nada se perde: o
-- bloco e so leitura, e os numeros voltam se a migration for aplicada de novo.
--
-- TRAVAS: as mesmas da migration: catalogo e ACCESS SHARE nas tabelas lidas
-- pelo corpo, ate o commit (nao segura leitura nem escrita). lock_timeout de
-- 1 s: com as tabelas em ALTER, o rollback falha inteiro e roda-se de novo.

begin;
-- inicio do rollback
set local lock_timeout = '1s';

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

do $conferencia$
begin
  if (select md5(p.prosrc)
        from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.atendimento_do_periodo(uuid,timestamptz,timestamptz,timestamptz)'))
     is distinct from '262b03bb68ea66118bff26543176d086'
  then
    raise exception using errcode = 'P0001', message = 'rollback_corpo_diferente',
      hint = 'O corpo de atendimento_do_periodo nao voltou ao de antes da 20261104120000.';
  end if;
end;
$conferencia$;
-- fim do rollback
commit;
