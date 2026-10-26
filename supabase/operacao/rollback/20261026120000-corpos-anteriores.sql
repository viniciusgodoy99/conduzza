-- Rollback manual da migration 20261026120000_painel_cs_3.sql (a terceira
-- leva do Painel geral como acompanhamento de cliente, 26/10/2026).
--
-- O QUE A MIGRATION FEZ: o create or replace de painel_cs_das_clinicas com o
-- sinal ainda_sem_acesso (a clinica sem uso nos 30 primeiros dias: atencao,
-- e nao sem_uso, em risco) e a saude pela regra nova (e o comentario novo);
-- a funcao validar_dados_da_clinica() e o gatilho validar_dados_da_clinica
-- em clinic (BEFORE INSERT OR UPDATE OF name, timezone: 23514
-- nome_da_clinica_vazio e fuso_invalido).
--
-- O QUE ESTE ARQUIVO FAZ: devolve painel_cs_das_clinicas ao corpo de
-- PRODUCAO de 26/10/2026 (lido com fndef.js, so leitura; md5(prosrc)
-- e828969f6d56c23a061e2ae951d1a58f, o da migration 20261026110000) e ao
-- comentario de entao (md5 637eaef6f1be69b17d49cead4f86a792); tira o
-- gatilho e a funcao dele; confere os dois md5 e que nada da migration
-- ficou.
--
-- ORDEM (AO CONTRARIO das levas anteriores):
--   1. Rodar ESTE arquivo inteiro PRIMEIRO, numa transacao, no SQL editor,
--      em horario calmo. O codigo novo (o que conhece ainda_sem_acesso) le
--      tambem o corpo devolvido aqui.
--   2. So DEPOIS, se for o caso, voltar o CODIGO. O leitor de c4129bd
--      (lib/queries/painel-geral.ts) recusa a chave ainda_sem_acesso: voltar
--      o codigo antes deste arquivo derruba a lista e o detalhe do Painel
--      geral para a equipe Conduzza.
--
-- O QUE SE PERDE: nenhum dado. Sem o gatilho, clinic volta a aceitar nome
-- vazio e fuso inexistente pela API (PostgREST; a tela continua validando
-- pelo Zod), e um fuso inexistente volta a derrubar painel_cs_das_clinicas
-- para todas as clinicas.
--
-- TRAVAS: o create or replace e o COMMENT so mexem no catalogo; o DROP
-- TRIGGER pega ACCESS EXCLUSIVE em clinic ate o commit, o que segura toda
-- leitura e escrita de clinic durante a transacao (fica no fim, logo antes
-- da conferencia: milissegundos). lock_timeout de 1 s (menor que o da
-- migration, de proposito): com clinic ocupada, o rollback falha inteiro
-- sem enfileirar as leituras por muito tempo, e roda-se de novo.
--
-- Conferir no fim (o proprio arquivo confere e desfaz tudo se nao bater):
-- painel_cs_das_clinicas com o md5(prosrc) e828969f6d56c23a061e2ae951d1a58f
-- e o comentario com o md5 637eaef6f1be69b17d49cead4f86a792; nem o gatilho
-- validar_dados_da_clinica nem a funcao dele existem.

begin;
set local lock_timeout = '1s';

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

  -- SO CONTAGENS: de paciente, nada alem de quantos. Os CTEs de
  -- 20261026100000 continuam os mesmos (com colunas a mais para a segunda
  -- leva); os novos so contam. O gasto vem de ia_uso (custo_microdolar; US$
  -- 1 = 1.000.000) com as reservas, como o teto conta: em centavos de dolar
  -- arredondados (10.000 microdolares = 1 centavo; o total arredonda a soma
  -- das clinicas) e, desde a segunda leva, tambem exato, em microdolares,
  -- com as chamadas (as linhas reais, sem as reservas).
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
  -- ela e da equipe Conduzza (so a marca: ela conta como qualquer vinculo),
  -- se tem a marca de Implementador nesta clinica e desde quando o vinculo
  -- existe (o pedido de entrada so nasce por insert). A ultima atividade e
  -- o maior entre o ultimo login e a ultima renovacao das sessoes da pessoa
  -- (updated_at; refreshed_at e sem fuso, gravado em UTC pelo Auth), lidas
  -- pelo indice de user_id.
  vinculos as (
    select m.clinic_id,
           m.user_id,
           m.role,
           m.status,
           m.created_at as vinculo_em,
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
  -- As contagens da equipe e, para o sinal, os pedidos de entrada
  -- esperando ha MAIS de 2 dias.
  membros as (
    select v.clinic_id,
           count(*) filter (where v.status = 'ativo') as ativos,
           count(*) filter (where v.status = 'pendente') as pendentes,
           count(*) filter (where v.status = 'ativo' and v.equipe_conduzza) as conduzza,
           count(*) filter (where v.status = 'pendente'
                              and v.vinculo_em < now() - interval '2 days') as pendentes_antigos,
           min(v.vinculo_em) filter (where v.status = 'pendente'
                                       and v.vinculo_em < now() - interval '2 days') as pendente_desde,
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
           max(w.disconnected_at) as ultima_desconexao,
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
           count(*) filter (where t.first_contact_at >= now() - interval '30 days') as novos_30,
           count(*) filter (where t.first_contact_at >= now() - interval '60 days'
                              and t.first_contact_at < now() - interval '30 days') as novos_30_anteriores
      from public.contact t
     where t.clinic_id in (select k.id from clinicas k)
     group by t.clinic_id
  ),
  conversas as (
    select v.clinic_id,
           count(*) filter (where v.created_at >= now() - interval '30 days') as criadas_30,
           count(*) filter (where v.created_at >= now() - interval '60 days'
                              and v.created_at < now() - interval '30 days') as criadas_30_anteriores,
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
                       and u.origem <> 'simulador'), 0) as mes_sem_simulador,
           count(*) filter (where not u.reserva
                              and u.created_at >= now() - interval '24 hours') as chamadas_d24,
           count(*) filter (where not u.reserva
                              and u.created_at >= k.inicio_do_mes) as chamadas_mes,
           count(*) filter (where not u.reserva
                              and u.created_at >= now() - interval '24 hours'
                              and u.origem <> 'simulador') as chamadas_d24_sem_simulador,
           count(*) filter (where not u.reserva
                              and u.created_at >= k.inicio_do_mes
                              and u.origem <> 'simulador') as chamadas_mes_sem_simulador
      from public.ia_uso u
      join clinicas k on k.id = u.clinic_id
     where u.created_at >= least(now() - interval '24 hours', k.inicio_do_mes)
     group by u.clinic_id
  ),
  -- As mensagens de saida que falharam nos ultimos 7 dias (so a contagem e
  -- a data da mais antiga), clinica a clinica (LATERAL), pelo indice de
  -- (clinic_id, created_at): cada clinica le so as mensagens dos 7 dias
  -- dela, com qualquer versao do Postgres (o 18 do ensaio ainda pularia
  -- pelo indice; o 17 da producao, nao).
  falhas as (
    select k.id as clinic_id,
           f.total,
           f.desde
      from clinicas k
      cross join lateral (
        select count(*) as total,
               min(x.created_at) as desde
          from public.message x
         where x.clinic_id = k.id
           and x.created_at >= now() - interval '7 days'
           and x.direction = 'saida'
           and x.delivery_status = 'falhou'
      ) f
     where f.total > 0
  ),
  procedimentos as (
    select p.clinic_id, count(*) as ativos
      from public.procedure p
     where p.active
       and p.clinic_id in (select k.id from clinicas k)
     group by p.clinic_id
  ),
  profissionais as (
    select p.clinic_id, count(*) as ativos
      from public.professional p
     where p.active
       and p.clinic_id in (select k.id from clinicas k)
     group by p.clinic_id
  ),
  reguas as (
    select r.clinic_id, count(*) as ligadas
      from public.cadence r
     where r.active
       and r.kind = 'confirmacao'
       and r.clinic_id in (select k.id from clinicas k)
     group by r.clinic_id
  ),
  -- A Meta ligada: a conta de anuncios com o token de leitura salvo (so o
  -- "existe" do token, nunca o valor).
  meta as (
    select a.clinic_id
      from public.meta_ads_account a
      join public.meta_ads_account_secret s on s.clinic_id = a.clinic_id
     where a.ad_account_id is not null
       and s.insights_access_token is not null
  ),
  google as (
    select r.clinic_id
      from public.rastreio_do_site r
     where r.ativo
  ),
  notas as (
    select n.clinic_id, max(n.criada_em) as ultima
      from public.nota_interna_da_clinica n
     where n.clinic_id in (select k.id from clinicas k)
     group by n.clinic_id
  ),
  -- Uma linha por clinica com as chaves de 20261026100000 (as mesmas
  -- expressoes) e os fatos da segunda leva.
  linhas as (
    select k.id,
           k.name,
           a.em as acesso_em,
           jsonb_build_object(
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
                 round(coalesce(g.mes_sem_simulador, 0) / 10000.0)::bigint,
               'ultimas_24h_microdolares', coalesce(g.d24, 0)::bigint,
               'mes_microdolares', coalesce(g.mes, 0)::bigint,
               'ultimas_24h_sem_simulador_microdolares', coalesce(g.d24_sem_simulador, 0)::bigint,
               'mes_sem_simulador_microdolares', coalesce(g.mes_sem_simulador, 0)::bigint,
               'ultimas_24h_chamadas', coalesce(g.chamadas_d24, 0),
               'mes_chamadas', coalesce(g.chamadas_mes, 0),
               'ultimas_24h_sem_simulador_chamadas', coalesce(g.chamadas_d24_sem_simulador, 0),
               'mes_sem_simulador_chamadas', coalesce(g.chamadas_mes_sem_simulador, 0)),
             'teto_diario_centavos_usd', l.teto_diario_centavos_usd) as base,
           h.estado,
           coalesce(g.mes, 0) as mes_microdolares,
           coalesce(g.chamadas_mes, 0) as chamadas_mes,
           -- Os fatos dos sinais, da saude e da implantacao.
           coalesce(a.em >= now() - interval '30 days', false) as em_uso,
           s.clinic_id is not null as suspensa,
           s.suspensa_em,
           coalesce(n.total, 0) as numeros_total,
           coalesce(n.conectados, 0) as numeros_conectados,
           n.ultima_desconexao,
           coalesce(m.ativos, 0) as membros_ativos,
           coalesce(m.pendentes_antigos, 0) as pendentes_antigos,
           m.pendente_desde,
           coalesce(f.total, 0) as falhas,
           f.desde as falhas_desde,
           round(coalesce(g.d24, 0) / 10000.0)::bigint as d24_centavos,
           l.teto_diario_centavos_usd as teto,
           coalesce(pc.ativos, 0) as procedimentos,
           coalesce(pf.ativos, 0) as profissionais,
           coalesce(rg.ligadas, 0) as reguas,
           me.clinic_id is not null as meta,
           go.clinic_id is not null as google,
           coalesce(ct.novos_30, 0) as leads_atual,
           coalesce(ct.novos_30_anteriores, 0) as leads_anterior,
           coalesce(cv.criadas_30, 0) as conversas_atual,
           coalesce(cv.criadas_30_anteriores, 0) as conversas_anterior,
           nt.ultima as ultima_nota
      from clinicas k
      left join membros m on m.clinic_id = k.id
      left join acessos a on a.clinic_id = k.id
      left join numeros n on n.clinic_id = k.id
      left join contatos ct on ct.clinic_id = k.id
      left join conversas cv on cv.clinic_id = k.id
      left join telefones t on t.clinic_id = k.id
      left join gasto g on g.clinic_id = k.id
      left join falhas f on f.clinic_id = k.id
      left join procedimentos pc on pc.clinic_id = k.id
      left join profissionais pf on pf.clinic_id = k.id
      left join reguas rg on rg.clinic_id = k.id
      left join meta me on me.clinic_id = k.id
      left join google go on go.clinic_id = k.id
      left join notas nt on nt.clinic_id = k.id
      left join public.clinica_suspensa s on s.clinic_id = k.id
      left join public.ia_clinica_habilitada h on h.clinic_id = k.id
      left join public.ia_liberacao l on l.clinic_id = k.id
  ),
  -- Os sinais que valem, a saude, a implantacao e a tendencia de cada
  -- linha.
  avaliadas as (
    select o.*,
           si.sinais,
           case
             when not o.em_uso or o.suspensa
                  or (o.numeros_total > 0 and o.numeros_conectados = 0) then 'em_risco'
             when jsonb_array_length(si.sinais) > 0 then 'atencao'
             else 'saudavel'
           end as saude,
           im.implantacao,
           jsonb_build_object(
             'leads', jsonb_build_object(
               'atual', o.leads_atual,
               'anterior', o.leads_anterior,
               'variacao_percentual', tl.pct,
               'direcao', case
                 when tl.pct is null then 'sem_base'
                 when tl.pct >= 10 then 'subindo'
                 when tl.pct <= -10 then 'caindo'
                 else 'estavel'
               end),
             'conversas', jsonb_build_object(
               'atual', o.conversas_atual,
               'anterior', o.conversas_anterior,
               'variacao_percentual', tc.pct,
               'direcao', case
                 when tc.pct is null then 'sem_base'
                 when tc.pct >= 10 then 'subindo'
                 when tc.pct <= -10 then 'caindo'
                 else 'estavel'
               end)) as tendencia
      from linhas o
      cross join lateral (
        select coalesce(jsonb_agg(v.sinal order by v.ordem), '[]'::jsonb) as sinais
          from (values
            (1, case when o.suspensa then jsonb_build_object(
                  'chave', 'conta_suspensa', 'nivel', 'em_risco',
                  'quantidade', null::bigint, 'desde', o.suspensa_em) end),
            (2, case when not o.em_uso then jsonb_build_object(
                  'chave', 'sem_uso', 'nivel', 'em_risco',
                  'quantidade', null::bigint, 'desde', o.acesso_em) end),
            (3, case when o.numeros_total > 0 and o.numeros_conectados = 0 then jsonb_build_object(
                  'chave', 'whatsapp_desconectado', 'nivel', 'em_risco',
                  'quantidade', o.numeros_total, 'desde', o.ultima_desconexao) end),
            (4, case when o.numeros_total = 0 then jsonb_build_object(
                  'chave', 'sem_numero_de_whatsapp', 'nivel', 'atencao',
                  'quantidade', null::bigint, 'desde', null::timestamptz) end),
            (5, case when o.pendentes_antigos > 0 then jsonb_build_object(
                  'chave', 'pedido_de_entrada_esperando', 'nivel', 'atencao',
                  'quantidade', o.pendentes_antigos, 'desde', o.pendente_desde) end),
            (6, case when o.falhas > 0 then jsonb_build_object(
                  'chave', 'falhas_de_envio', 'nivel', 'atencao',
                  'quantidade', o.falhas, 'desde', o.falhas_desde) end),
            -- A regra da tela (estadoDoGasto): centavos arredondados, 80%
            -- do teto ou mais, em conta inteira.
            (7, case when o.teto is not null and o.d24_centavos * 10 >= o.teto::bigint * 8 then jsonb_build_object(
                  'chave', 'perto_do_teto_da_ia', 'nivel', 'atencao',
                  'quantidade', (o.d24_centavos * 100) / o.teto,
                  'desde', null::timestamptz) end)
          ) as v(ordem, sinal)
         where v.sinal is not null
      ) si
      cross join lateral (
        select jsonb_build_object(
                 'feitos', (p.whatsapp::int + p.equipe::int + p.procedimentos::int
                            + p.profissionais::int + p.regua::int + p.anuncios::int),
                 'total', 6,
                 'passos', jsonb_build_array(
                   jsonb_build_object('chave', 'whatsapp_conectado', 'feito', p.whatsapp,
                                      'quantidade', o.numeros_conectados),
                   jsonb_build_object('chave', 'equipe_com_duas_pessoas', 'feito', p.equipe,
                                      'quantidade', o.membros_ativos),
                   jsonb_build_object('chave', 'procedimentos_cadastrados', 'feito', p.procedimentos,
                                      'quantidade', o.procedimentos),
                   jsonb_build_object('chave', 'profissionais_cadastrados', 'feito', p.profissionais,
                                      'quantidade', o.profissionais),
                   jsonb_build_object('chave', 'regua_de_confirmacao_ligada', 'feito', p.regua,
                                      'quantidade', o.reguas),
                   jsonb_build_object('chave', 'anuncios_conectados', 'feito', p.anuncios,
                                      'quantidade', o.meta::int + o.google::int)),
                 'anuncios', jsonb_build_object('meta', o.meta, 'google', o.google)) as implantacao
          from (select o.numeros_conectados >= 1 as whatsapp,
                       o.membros_ativos >= 2 as equipe,
                       o.procedimentos >= 1 as procedimentos,
                       o.profissionais >= 1 as profissionais,
                       o.reguas >= 1 as regua,
                       o.meta or o.google as anuncios) p
      ) im
      cross join lateral (
        select case when o.leads_anterior > 0 then
                 round((o.leads_atual - o.leads_anterior) * 100.0 / o.leads_anterior)::bigint
               end as pct
      ) tl
      cross join lateral (
        select case when o.conversas_anterior > 0 then
                 round((o.conversas_atual - o.conversas_anterior) * 100.0 / o.conversas_anterior)::bigint
               end as pct
      ) tc
  )
  select jsonb_build_object(
           'gerado_em', now(),
           'totais', jsonb_build_object(
             'clinicas', count(*),
             'em_uso', count(*) filter (where o.acesso_em >= now() - interval '30 days'),
             'sem_uso', count(*) filter (where o.acesso_em is null or o.acesso_em < now() - interval '30 days'),
             'suspensas', count(*) filter (where o.suspensa),
             'agente_liberado', count(*) filter (where o.estado in ('teste', 'producao')),
             'gasto_mes_centavos_usd', round(coalesce(sum(o.mes_microdolares), 0) / 10000.0)::bigint,
             'gasto_mes_microdolares', coalesce(sum(o.mes_microdolares), 0)::bigint,
             'chamadas_mes', coalesce(sum(o.chamadas_mes), 0)::bigint,
             'saude', jsonb_build_object(
               'saudavel', count(*) filter (where o.saude = 'saudavel'),
               'atencao', count(*) filter (where o.saude = 'atencao'),
               'em_risco', count(*) filter (where o.saude = 'em_risco'))),
           'clinicas', coalesce(jsonb_agg(
               o.base || jsonb_build_object(
                 'saude', o.saude,
                 'sinais', o.sinais,
                 'implantacao', o.implantacao,
                 'tendencia', o.tendencia,
                 'ultima_nota_em', o.ultima_nota)
             order by o.acesso_em desc nulls last, lower(o.name), o.id), '[]'::jsonb))
    into v_painel
    from avaliadas o;

  return v_painel;
end;
$function$;

revoke all on function public.painel_cs_das_clinicas(boolean) from public, anon;
grant execute on function public.painel_cs_das_clinicas(boolean)
  to authenticated, service_role;

comment on function public.painel_cs_das_clinicas(boolean) is
  'Painel geral como acompanhamento de cliente (CS, 26/10/2026; segunda leva na migration 20261026110000_painel_cs_2.sql), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS de paciente; nome e e-mail so da equipe da clinica. Clinicas e_de_teste so com p_incluir_teste. Ultimo acesso = a ultima atividade (o maior entre auth.users.last_sign_in_at e a ultima renovacao das sessoes em auth.sessions) dos vinculos ATIVOS, a equipe Conduzza inclusive e marcada; em uso = ultimo acesso nos ultimos 30 dias. Formato exato no comentario das migrations 20261026100000_painel_cs.sql e 20261026110000_painel_cs_2.sql: {"gerado_em", "totais": {"clinicas", "em_uso", "sem_uso", "suspensas", "agente_liberado", "gasto_mes_centavos_usd", "gasto_mes_microdolares", "chamadas_mes", "saude": {"saudavel", "atencao", "em_risco"}}, "clinicas": [{"id", "nome", "criada_em", "fuso", "em_uso", "ultimo_acesso", "membros_ativos", "membros_pendentes", "membros_equipe_conduzza", "pessoas", "numeros_total", "numeros_conectados", "numeros", "contatos", "leads_30_dias", "conversas_30_dias", "ultima_mensagem_em", "suspensao", "agente", "gasto": {os quatro em centavos, os quatro em microdolares e as quatro contagens de chamadas}, "teto_diario_centavos_usd", "saude", "sinais": [{"chave", "nivel", "quantidade", "desde"}], "implantacao": {"feitos", "total", "passos": [{"chave", "feito", "quantidade"}], "anuncios": {"meta", "google"}}, "tendencia": {"leads", "conversas"}, "ultima_nota_em"}] (ultimo acesso mais recente primeiro, sem acesso no fim)}.';

drop trigger if exists validar_dados_da_clinica on public.clinic;
drop function if exists public.validar_dados_da_clinica();

do $conferencia$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = to_regprocedure('public.painel_cs_das_clinicas(boolean)'))
     is distinct from 'e828969f6d56c23a061e2ae951d1a58f'
     or md5(obj_description(to_regprocedure('public.painel_cs_das_clinicas(boolean)'), 'pg_proc'))
     is distinct from '637eaef6f1be69b17d49cead4f86a792'
  then
    raise exception 'ROLLBACK: painel_cs_das_clinicas nao voltou ao corpo e ao comentario de 26/10/2026';
  end if;
  if to_regprocedure('public.validar_dados_da_clinica()') is not null
     or exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.clinic'::regclass
                   and t.tgname = 'validar_dados_da_clinica')
  then
    raise exception 'ROLLBACK: sobrou objeto da migration 20261026120000';
  end if;
end;
$conferencia$;

commit;
