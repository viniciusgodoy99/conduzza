-- Rollback manual da migration 20261026110000_painel_cs_2.sql (a segunda
-- leva do Painel geral como acompanhamento de cliente, 26/10/2026).
--
-- O QUE A MIGRATION FEZ: a tabela nota_interna_da_clinica (com indice,
-- policy e grants), quatro funcoes novas (notas_da_clinica_no_painel,
-- escrever_nota_da_clinica, excluir_nota_da_clinica e
-- historico_da_clinica_no_painel), o create or replace de
-- painel_cs_das_clinicas com as chaves da segunda leva (e o comentario
-- novo) e duas policies RESTRITIVAS em audit_log ("ninguem grava as acoes
-- da conta pela sessao" e "so a equipe Conduzza le a trilha das notas
-- internas"; as permissivas de antes nao mudaram).
--
-- O QUE ESTE ARQUIVO FAZ: tira as quatro funcoes; devolve
-- painel_cs_das_clinicas ao corpo de PRODUCAO de 26/10/2026 (lido com
-- fndef.js, so leitura; md5(prosrc) 093d9103c89c0f78e7ff77be10b663ad, o da
-- migration 20261026100000) e ao comentario de entao (md5
-- 9df63480e2f2de0f7712ca756274b591), ANTES de a tabela sair (o corpo de
-- antes nao le a tabela de notas); tira a tabela; tira as duas policies de
-- audit_log (a trilha volta a ser a de antes: um membro ativo volta a
-- conseguir gravar as acoes da conta pela sessao, o que so importava para o
-- historico, que sai junto); confere os dois md5 e que nada da migration
-- ficou.
--
-- ORDEM:
--   1. Voltar o CODIGO (o novo le as chaves novas e chama as funcoes novas:
--      lib/queries/painel-geral.ts, app/(app)/painel-geral/actions.ts e as
--      telas do Painel geral). O codigo de antes le so as chaves de
--      20261026100000, que o corpo devolvido aqui tem.
--   2. Rodar ESTE arquivo inteiro, numa transacao, no SQL editor, em horario
--      calmo.
--
-- O QUE SE PERDE: AS NOTAS INTERNAS escritas enquanto a tabela existiu. Para
-- guardar antes: no SQL editor, rodar
--   select n.clinic_id, n.criada_em, n.autor_user_id, n.texto
--     from public.nota_interna_da_clinica n
--    order by n.clinic_id, n.criada_em;
-- e baixar o resultado (CSV). Nunca copiar para outra tabela do schema
-- public (ela nasceria sem RLS e com os grants padrao). A trilha das notas
-- (escreveu_nota_interna, excluiu_nota_interna) fica em audit_log, sem o
-- texto; sem a policy "so a equipe Conduzza le a trilha das notas
-- internas", o administrador e o gestor da clinica voltam a ver essas
-- linhas (quando e quem escreveu, nunca o texto).
--
-- TRAVAS: DROP FUNCTION e create or replace so mexem no catalogo; o DROP
-- TABLE pega ACCESS EXCLUSIVE na tabela de notas e tambem em clinic ate o
-- commit (tirar os gatilhos da FK), o que segura toda leitura de clinic
-- durante a transacao, que e curta; o DROP POLICY pega ACCESS EXCLUSIVE em
-- audit_log ate o commit (fica no fim, logo antes da conferencia).
-- lock_timeout de 1 s (menor que o da migration, de proposito): com clinic
-- ou audit_log ocupada, o rollback falha inteiro sem enfileirar as leituras
-- por muito tempo, e roda-se de novo.
--
-- Conferir no fim (o proprio arquivo confere e desfaz tudo se nao bater):
-- nenhuma das quatro funcoes, nem a tabela, nem as duas policies de
-- audit_log existe; painel_cs_das_clinicas com o md5(prosrc)
-- 093d9103c89c0f78e7ff77be10b663ad e o comentario com o md5
-- 9df63480e2f2de0f7712ca756274b591.

begin;
set local lock_timeout = '1s';

drop function if exists public.historico_da_clinica_no_painel(uuid, integer);
drop function if exists public.excluir_nota_da_clinica(uuid);
drop function if exists public.escrever_nota_da_clinica(uuid, text);
drop function if exists public.notas_da_clinica_no_painel(uuid, integer);

-- O corpo de producao de 26/10/2026 (fndef.js), sem mudanca.
CREATE OR REPLACE FUNCTION public.painel_cs_das_clinicas(p_incluir_teste boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_painel jsonb;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor (a
  -- guarda de painel_geral_das_clinicas).
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza vê o painel geral.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza vê o painel geral.';
  end if;

  -- SO CONTAGENS: de paciente, nada alem de quantos. numeros, contatos,
  -- conversas, telefones e gasto sao os CTEs de painel_geral_das_clinicas
  -- (corpo de producao de 26/10/2026), sem mudanca: o gasto vem de ia_uso
  -- (custo_microdolar; US$ 1 = 1.000.000) com as reservas, como o teto
  -- conta, em centavos de dolar arredondados (10.000 microdolares = 1
  -- centavo); o total arredonda a soma das clinicas.
  with clinicas as (
    select c.id,
           c.name,
           c.created_at,
           coalesce(nullif(c.timezone, ''), 'America/Fortaleza') as fuso,
           date_trunc('month', now() at time zone coalesce(nullif(c.timezone, ''), 'America/Fortaleza'))
             at time zone coalesce(nullif(c.timezone, ''), 'America/Fortaleza') as inicio_do_mes
      from public.clinic c
     where coalesce(p_incluir_teste, false) or not c.e_de_teste
  ),
  -- Cada vinculo com a pessoa (dado da equipe), a ultima atividade dela, se
  -- ela e da equipe Conduzza (so a marca: ela conta como qualquer vinculo) e
  -- se tem a marca de Implementador nesta clinica. A ultima atividade e o
  -- maior entre o ultimo login e a ultima renovacao das sessoes da pessoa
  -- (updated_at; refreshed_at e sem fuso, gravado em UTC pelo Auth), lidas
  -- pelo indice de user_id.
  vinculos as (
    select m.clinic_id,
           m.user_id,
           m.role,
           m.status,
           nullif(btrim(p.name), '') as nome,
           nullif(btrim(u.email), '') as email,
           greatest(u.last_sign_in_at, s.ultima_renovacao) as ultimo_acesso_em,
           a.user_id is not null as equipe_conduzza,
           i.user_id is not null as implementador
      from public.clinic_member m
      left join public.profile p on p.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
      left join lateral (
        select max(greatest(x.updated_at, x.refreshed_at at time zone 'UTC')) as ultima_renovacao
          from auth.sessions x
         where x.user_id = m.user_id
      ) s on true
      left join public.product_admin a on a.user_id = m.user_id
      left join public.membro_implementador i
        on i.clinic_id = m.clinic_id
       and i.user_id = m.user_id
     where m.clinic_id in (select k.id from clinicas k)
  ),
  membros as (
    select v.clinic_id,
           count(*) filter (where v.status = 'ativo') as ativos,
           count(*) filter (where v.status = 'pendente') as pendentes,
           count(*) filter (where v.status = 'ativo' and v.equipe_conduzza) as conduzza,
           jsonb_agg(jsonb_build_object('nome', v.nome, 'email', v.email)
                     order by lower(coalesce(v.nome, v.email, '')), v.user_id) as pessoas
      from vinculos v
     group by v.clinic_id
  ),
  -- O ultimo acesso da clinica: a ultima atividade mais recente dos
  -- vinculos ATIVOS (a equipe Conduzza conta, marcada); empate, o menor
  -- user_id.
  acessos as (
    select distinct on (v.clinic_id)
           v.clinic_id,
           v.ultimo_acesso_em as em,
           jsonb_build_object(
             'em', v.ultimo_acesso_em,
             'user_id', v.user_id,
             'nome', v.nome,
             'email', v.email,
             'papel', v.role,
             'implementador', v.implementador,
             'equipe_conduzza', v.equipe_conduzza) as quem
      from vinculos v
     where v.status = 'ativo'
       and v.ultimo_acesso_em is not null
     order by v.clinic_id, v.ultimo_acesso_em desc, v.user_id
  ),
  numeros as (
    select w.clinic_id,
           count(*) as total,
           count(*) filter (where w.connection_status = 'conectado') as conectados,
           jsonb_agg(jsonb_build_object(
               'id', w.id,
               'nome', w.nome,
               'final', case
                 when char_length(regexp_replace(coalesce(w.display_phone, ''), '[^0-9]', '', 'g')) >= 4
                 then right(regexp_replace(w.display_phone, '[^0-9]', '', 'g'), 4)
               end,
               'conexao', w.connection_status,
               'ia_ligada', coalesce(n.ativo, false))
             order by w.principal desc, w.created_at, w.id) as lista
      from public.whatsapp_account w
      left join public.ia_numero_liberado n
        on n.whatsapp_account_id = w.id
       and n.clinic_id = w.clinic_id
     where w.removido_em is null
       and w.clinic_id in (select k.id from clinicas k)
     group by w.clinic_id
  ),
  contatos as (
    select t.clinic_id,
           count(*) as total,
           count(*) filter (where t.first_contact_at >= now() - interval '30 days') as novos_30
      from public.contact t
     where t.clinic_id in (select k.id from clinicas k)
     group by t.clinic_id
  ),
  conversas as (
    select v.clinic_id,
           count(*) filter (where v.created_at >= now() - interval '30 days') as criadas_30,
           max(v.last_inbound_at) as ultima_recebida
      from public.conversation v
     where v.clinic_id in (select k.id from clinicas k)
     group by v.clinic_id
  ),
  telefones as (
    select t.clinic_id, count(*) as ligados
      from public.ia_contato_liberado t
     where t.ativo
     group by t.clinic_id
  ),
  gasto as (
    select u.clinic_id,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= now() - interval '24 hours'), 0) as d24,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= k.inicio_do_mes), 0) as mes,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= now() - interval '24 hours'
                       and u.origem <> 'simulador'), 0) as d24_sem_simulador,
           coalesce(sum(u.custo_microdolar)
             filter (where u.created_at >= k.inicio_do_mes
                       and u.origem <> 'simulador'), 0) as mes_sem_simulador
      from public.ia_uso u
      join clinicas k on k.id = u.clinic_id
     where u.created_at >= least(now() - interval '24 hours', k.inicio_do_mes)
     group by u.clinic_id
  )
  select jsonb_build_object(
           'gerado_em', now(),
           'totais', jsonb_build_object(
             'clinicas', count(*),
             'em_uso', count(*) filter (where a.em >= now() - interval '30 days'),
             'sem_uso', count(*) filter (where a.em is null or a.em < now() - interval '30 days'),
             'suspensas', count(*) filter (where s.clinic_id is not null),
             'agente_liberado', count(*) filter (where h.estado in ('teste', 'producao')),
             'gasto_mes_centavos_usd', round(coalesce(sum(g.mes), 0) / 10000.0)::bigint),
           'clinicas', coalesce(jsonb_agg(jsonb_build_object(
               'id', k.id,
               'nome', k.name,
               'criada_em', k.created_at,
               'fuso', k.fuso,
               'em_uso', coalesce(a.em >= now() - interval '30 days', false),
               'ultimo_acesso', a.quem,
               'membros_ativos', coalesce(m.ativos, 0),
               'membros_pendentes', coalesce(m.pendentes, 0),
               'membros_equipe_conduzza', coalesce(m.conduzza, 0),
               'pessoas', coalesce(m.pessoas, '[]'::jsonb),
               'numeros_total', coalesce(n.total, 0),
               'numeros_conectados', coalesce(n.conectados, 0),
               'numeros', coalesce(n.lista, '[]'::jsonb),
               'contatos', coalesce(ct.total, 0),
               'leads_30_dias', coalesce(ct.novos_30, 0),
               'conversas_30_dias', coalesce(cv.criadas_30, 0),
               'ultima_mensagem_em', cv.ultima_recebida,
               'suspensao', case when s.clinic_id is not null then
                 jsonb_build_object('suspensa_em', s.suspensa_em, 'motivo', s.motivo)
               end,
               'agente', jsonb_build_object(
                 'estado', coalesce(h.estado, 'desligado'),
                 'modo', l.modo,
                 'liberada', coalesce(l.liberada, false),
                 'pausada_pela_clinica', coalesce(l.pausada_pela_clinica, false),
                 'telefones_ligados', coalesce(t.ligados, 0)),
               'gasto', jsonb_build_object(
                 'ultimas_24h_centavos_usd', round(coalesce(g.d24, 0) / 10000.0)::bigint,
                 'mes_centavos_usd', round(coalesce(g.mes, 0) / 10000.0)::bigint,
                 'ultimas_24h_sem_simulador_centavos_usd',
                   round(coalesce(g.d24_sem_simulador, 0) / 10000.0)::bigint,
                 'mes_sem_simulador_centavos_usd',
                   round(coalesce(g.mes_sem_simulador, 0) / 10000.0)::bigint),
               'teto_diario_centavos_usd', l.teto_diario_centavos_usd)
             order by a.em desc nulls last, lower(k.name), k.id), '[]'::jsonb))
    into v_painel
    from clinicas k
    left join membros m on m.clinic_id = k.id
    left join acessos a on a.clinic_id = k.id
    left join numeros n on n.clinic_id = k.id
    left join contatos ct on ct.clinic_id = k.id
    left join conversas cv on cv.clinic_id = k.id
    left join telefones t on t.clinic_id = k.id
    left join gasto g on g.clinic_id = k.id
    left join public.clinica_suspensa s on s.clinic_id = k.id
    left join public.ia_clinica_habilitada h on h.clinic_id = k.id
    left join public.ia_liberacao l on l.clinic_id = k.id;

  return v_painel;
end;
$function$;

revoke all on function public.painel_cs_das_clinicas(boolean) from public, anon;
grant execute on function public.painel_cs_das_clinicas(boolean)
  to authenticated, service_role;

comment on function public.painel_cs_das_clinicas(boolean) is
  'Painel geral como acompanhamento de cliente (CS, 26/10/2026), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS de paciente; nome e e-mail so da equipe da clinica. Clinicas e_de_teste so com p_incluir_teste. Ultimo acesso = a ultima atividade (decisao do dono de 26/10/2026: o maior entre auth.users.last_sign_in_at e a ultima renovacao das sessoes da pessoa em auth.sessions, updated_at e refreshed_at lido em UTC) dos vinculos ATIVOS, a equipe Conduzza (product_admin) inclusive e marcada; em uso = ultimo acesso nos ultimos 30 dias. Formato exato no comentario da migration 20261026100000_painel_cs.sql: {"gerado_em", "totais": {"clinicas", "em_uso", "sem_uso", "suspensas", "agente_liberado", "gasto_mes_centavos_usd"}, "clinicas": [{"id", "nome", "criada_em", "fuso", "em_uso", "ultimo_acesso": null ou {"em", "user_id", "nome", "email", "papel", "implementador", "equipe_conduzza"}, "membros_ativos", "membros_pendentes", "membros_equipe_conduzza", "pessoas": [{"nome", "email"}], "numeros_total", "numeros_conectados", "numeros": [{"id", "nome", "final", "conexao", "ia_ligada"}], "contatos", "leads_30_dias", "conversas_30_dias", "ultima_mensagem_em", "suspensao": null ou {"suspensa_em", "motivo"}, "agente": {"estado", "modo", "liberada", "pausada_pela_clinica", "telefones_ligados"}, "gasto": {"ultimas_24h_centavos_usd", "mes_centavos_usd", "ultimas_24h_sem_simulador_centavos_usd", "mes_sem_simulador_centavos_usd"}, "teto_diario_centavos_usd"}] (ultimo acesso mais recente primeiro, sem acesso no fim)}.';

drop table if exists public.nota_interna_da_clinica;

drop policy if exists "ninguem grava as acoes da conta pela sessao" on public.audit_log;
drop policy if exists "so a equipe Conduzza le a trilha das notas internas" on public.audit_log;

do $conferencia$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.painel_cs_das_clinicas(boolean)'))
     is distinct from '093d9103c89c0f78e7ff77be10b663ad'
     or md5(obj_description(to_regprocedure('public.painel_cs_das_clinicas(boolean)'), 'pg_proc'))
     is distinct from '9df63480e2f2de0f7712ca756274b591'
  then
    raise exception 'ROLLBACK: painel_cs_das_clinicas nao voltou ao corpo e ao comentario de 26/10/2026';
  end if;
  if to_regclass('public.nota_interna_da_clinica') is not null
     or to_regprocedure('public.notas_da_clinica_no_painel(uuid,integer)') is not null
     or to_regprocedure('public.escrever_nota_da_clinica(uuid,text)') is not null
     or to_regprocedure('public.excluir_nota_da_clinica(uuid)') is not null
     or to_regprocedure('public.historico_da_clinica_no_painel(uuid,integer)') is not null
     or exists (select 1 from pg_policy p
                 where p.polrelid = 'public.audit_log'::regclass
                   and p.polname in ('ninguem grava as acoes da conta pela sessao',
                                     'so a equipe Conduzza le a trilha das notas internas'))
  then
    raise exception 'ROLLBACK: sobrou objeto da migration 20261026110000';
  end if;
end;
$conferencia$;

commit;
