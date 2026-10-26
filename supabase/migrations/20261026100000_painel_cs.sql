-- ---------------------------------------------------------------------------
-- Painel geral como acompanhamento de cliente (CS)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026, com o print do Painel geral: "nao ta fazendo
-- sentido esse painel geral, ele e para ser tipo uma visualizacao de CS ...
-- era pra ter quantidade de clinicas que tem, a quantidade de clinicas
-- ativas, as funcionalidades que estao disponiveis para ela, qual foi a
-- ultima vez que entraram, quantas pessoas tem cadastradas para aquela
-- clinica". Respostas dele no mesmo dia: "em uso" = alguem da equipe da
-- clinica entrou nos ultimos 30 dias; a funcionalidade que a equipe
-- Conduzza libera e o agente de IA ("Preciso poder liberar as
-- funcionalidades de agente de IA ou nao para a clinica"): liberar = Teste e
-- retirar = Desligado, pelo definir_agente_da_clinica de sempre, chamado
-- pela funcao 3 (abaixo), que confere antes o estado que a tela mostrava; a
-- Producao continua so no detalhe, com o checklist. Decisao do dono no
-- mesmo dia, depois da revisao: o ultimo acesso e o "em uso" medem a
-- ULTIMA ATIVIDADE, nao so o ultimo login ("Pela ultima atividade": quem
-- fica conectado por semanas nao faz login de novo, e a sessao se renova
-- enquanto a pessoa usa o sistema); e a equipe Conduzza com vinculo ativo
-- continua contando, marcada (regras abaixo).
--
-- SO ACRESCIMO: tres funcoes novas. Nenhuma tabela, coluna, policy, gatilho
-- ou corpo existente muda. painel_geral_das_clinicas e
-- definir_agente_da_clinica NAO mudam: o codigo publicado hoje continua
-- usando-as entre esta migration e o deploy; painel_geral_das_clinicas sai
-- numa limpeza depois (a funcao nova devolve tudo o que a lista e o detalhe
-- leem dela, menos "administradores", que vira a secao Equipe).
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo novo (ele chama as
-- tres funcoes e nao tem caminho sem elas; o codigo de hoje nao chama
-- nenhuma, entao aplicar antes nao muda nada para ninguem). Codigo
-- publicado antes da migration deixa o Painel geral em "Nao foi possivel
-- carregar o painel" (so a equipe Conduzza o ve) ate ela ser aplicada.
--
-- 1. painel_cs_das_clinicas(p_incluir_teste boolean default false): a lista
--    e os cartoes do topo. Parte do corpo de PRODUCAO de
--    painel_geral_das_clinicas lido em 26/10/2026 (fndef.js, so leitura;
--    md5(prosrc) 646ff584c89d9271f747658e729ce036): numeros, contatos,
--    conversas, telefones, gasto, suspensao e agente sao os mesmos CTEs,
--    com o mesmo resultado (o ensaio compara as duas, clinica a clinica);
--    entram o ultimo acesso (quando e quem), o uso, a equipe (ativas e
--    pendentes) e as pessoas para a busca; saem os administradores (vao
--    para o detalhe) e os totais que sairam da tela (ativas, agente em
--    teste, agente em producao, gasto em 24 horas).
-- 2. equipe_da_clinica_no_painel(p_clinic_id uuid): a secao "Equipe" do
--    detalhe, cada pessoa com papel, situacao e ultimo acesso, e os
--    Implementadores numa lista separada (fecha a P18-5 da onda 5: ate aqui
--    o Implementador aparecia entre os administradores).
-- 3. definir_agente_da_clinica_no_painel(p_clinic_id, p_estado_visto,
--    p_estado, p_motivo): o "Liberar agente" e o "Retirar agente" da lista e
--    o seletor do detalhe. definir_agente_da_clinica roda o ramo do estado
--    pedido qualquer que seja o de agora: uma tela velha (a lista aberta em
--    outra aba) rebaixava a Producao para Teste ou passava por cima da
--    escolha da propria clinica ("So simulador", desligado), porque Teste de
--    novo e liberada em contatos (revisao de 26/10/2026, reproduzido num
--    Postgres local). Esta confere, com as mesmas travas e na mesma ordem,
--    se o estado de agora e o que a tela mostrava; se mudou, nada muda
--    (P0001 agente_mudou). Senao, chama definir_agente_da_clinica na mesma
--    transacao (que confere de novo o super admin, a conta suspensa e os
--    requisitos da producao, e grava a trilha).
-- As tres: SECURITY DEFINER, search_path vazio, com a guarda de
-- painel_geral_das_clinicas (as duas de leitura) e a de
-- definir_agente_da_clinica (a terceira): so a equipe Conduzza
-- (is_product_admin()), a service role e o SQL editor; 42501 para os
-- outros, anon inclusive. As duas de leitura sao STABLE. EXECUTE so para
-- authenticated e service_role.
--
-- REGRAS (as do desenho de 26/10/2026, com as decisoes do dono do mesmo
-- dia; "decisao do banco" marca o que nem um nem outro dizia):
--   - ULTIMO ACESSO de uma pessoa: a ULTIMA ATIVIDADE dela (decisao do dono
--     de 26/10/2026, "Pela ultima atividade"; o desenho dizia so o login, e
--     renovar a sessao nao muda o login: quem entrava uma vez e ficava
--     conectado envelhecia aqui e, em 30 dias, deixava a clinica "sem uso"
--     mesmo usando todo dia). E o MAIOR entre:
--       . auth.users.last_sign_in_at, o ultimo login (com a senha ou por um
--         link de e-mail); e
--       . a ultima renovacao das sessoes da pessoa em auth.sessions: o maior
--         updated_at (timestamptz) e o maior refreshed_at, que e timestamp
--         SEM fuso, gravado em UTC pelo Auth (lido com "at time zone 'UTC'",
--         qualquer que seja o fuso da sessao do banco).
--     Sem login e sem sessao: nulo (nunca entrou). Toda sessao da pessoa
--     conta, vencida ou nao (a renovacao foi atividade de verdade). A
--     leitura de auth.sessions e por pessoa (LATERAL por vinculo), pelo
--     indice de user_id (sessions_user_id_idx, que a producao tem; conferido
--     com EXPLAIN no Postgres local com 200 mil sessoes). Da sessao, so
--     user_id, updated_at e refreshed_at: nada de IP nem de navegador.
--     LIMITES CONHECIDOS: (1) a sessao renova quando o token de acesso vence
--     (1 hora no projeto), pelo middleware na proxima pagina ou pelo
--     navegador enquanto o sistema esta aberto e visivel na tela: a ultima
--     atividade tem folga de ate cerca de 1 hora, e a aba aberta e visivel
--     conta como atividade; (2) sair do sistema ("Sair", que desliga todas
--     as sessoes da pessoa) apaga as sessoes, e o ultimo acesso dela volta
--     ao ultimo login; (3) nao e por clinica: quem e de duas clinicas conta
--     a mesma atividade nas duas.
--   - ULTIMO ACESSO da clinica: o mais recente entre os vinculos ATIVOS da
--     clinica (o desenho: "dos membros ATIVOS"), com quem foi (nome, e-mail,
--     papel, se e Implementador e se e da equipe Conduzza); empate, o menor
--     user_id. Pendente e inativo entram no sistema, mas nao veem a clinica:
--     nao contam.
--   - EQUIPE CONDUZZA (product_admin) com vinculo ATIVO numa clinica conta
--     como qualquer vinculo ativo, no ultimo acesso, no uso e nas contagens
--     (o desenho nao a tira; revisao de 26/10/2026: a versao anterior a
--     tirava sem o dono decidir, e a teste123 aparecia com "Ninguem entrou
--     ainda" e "Nenhuma ativa"). Ela vem MARCADA (ultimo_acesso.
--     equipe_conduzza, membros_equipe_conduzza e, no detalhe,
--     equipe_conduzza), para a tela dizer quando o ultimo acesso foi dela.
--     Na producao, em 26/10/2026: 2 das 6 clinicas reais tem o super admin
--     ativo; em uso 3 (2 sem ele), pela ultima atividade. Decisao do dono
--     de 26/10/2026: a equipe Conduzza continua contando, marcada (se um
--     dia sair do uso, os filtros "not v.equipe_conduzza" voltam em acessos
--     e em membros).
--   - EM USO: o ultimo acesso da clinica nos ultimos 30 dias (>= gerado_em
--     menos 30 dias; gerado_em e o now() da leitura). SEM USO: o resto
--     (nenhuma atividade nos ultimos 30 dias, ou nunca). em_uso + sem_uso =
--     clinicas. decisao do banco: as suspensas sao uma contagem a parte; a
--     conta suspensa tambem e em uso ou sem uso, pela mesma regra.
--   - AGENTE PELO PAINEL (funcao 3): o estado que a tela mostrava tem de ser
--     o de agora; o mesmo estado pedido de novo (Teste sobre Teste) e
--     recusado, porque rodaria de novo o ramo dele por cima da escolha da
--     clinica.
--   - AGENTE LIBERADO: ia_clinica_habilitada.estado em teste ou producao.
--   - GASTO DO MES: o de painel_geral_das_clinicas (ia_uso com as reservas,
--     mes corrente no fuso de cada clinica), somado de todas as clinicas da
--     lista e arredondado no fim.
--   - BUSCA: decisao do banco: "pessoas" traz todo vinculo da clinica
--     (ativo, pendente ou inativo, a equipe Conduzza inclusive), as mesmas
--     pessoas que o detalhe lista.
--
-- SEM DADO DE PACIENTE: de paciente, so contagens (contatos, leads e
-- conversas). Nome, e-mail e o ultimo acesso sao da EQUIPE da clinica (dado
-- de operacao, como os administradores de painel_geral_das_clinicas); das
-- sessoes, so os instantes (nada de IP nem de navegador). As duas de
-- leitura so leem: nada vai para audit_log, log ou mensagem de erro. A
-- terceira grava so pelo definir_agente_da_clinica de sempre (a trilha
-- mudou_agente_da_clinica, com o estado e o motivo); a recusa nao grava
-- nada e leva so o estado de agora no hint.
--
-- Producao em 26/10/2026 (q.js, so leitura, so contagens): 57 clinicas, 51
-- delas e_de_teste (das suites); nas 6 reais, 8 vinculos ativos de 7
-- pessoas, 2 deles do super admin; 2 vinculos de quem nunca entrou e 5 de
-- quem entrou nos ultimos 30 dias. Das 7 pessoas, 3 renovaram a sessao mais
-- de 1 dia depois do ultimo login (1 delas, mais de 7 dias). auth.sessions:
-- 11 sessoes de 10 pessoas (4 das 7 das clinicas reais), nenhuma com
-- not_after (nao expiram por tempo); dona supabase_auth_admin, RLS ligada
-- sem policy, SELECT para postgres (que tem bypassrls: a funcao, dona
-- postgres, le todas); updated_at timestamptz e refreshed_at timestamp sem
-- fuso; nas 4 renovadas, refreshed_at lido como UTC bate com updated_at
-- (menos de 1 minuto); indices sessions_user_id_idx (user_id) e
-- user_id_created_at_idx (user_id, created_at); nenhum gatilho. Fuso do
-- banco e dos papeis: UTC. Pela ultima atividade, em uso continua 3 das 6
-- (2 sem a equipe Conduzza), e o ultimo acesso fica mais novo em 3 delas.
--
-- LOCKS: so catalogo (CREATE FUNCTION, REVOKE, GRANT e COMMENT). Nenhuma
-- tabela e tocada; lock_timeout de 3 s por garantia.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo (o novo chama as tres
-- funcoes), DEPOIS, numa transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261026100000-corpos-anteriores.sql (as tres
-- saem; nada mais muda).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) A lista e os cartoes do topo
-- ---------------------------------------------------------------------------
-- FORMATO EXATO do jsonb devolvido (toda chave sempre presente; null so onde
-- esta escrito; timestamptz em texto ISO 8601 com o deslocamento; contagens
-- e centavos sao inteiros, nunca negativos):
-- {
--   "gerado_em": timestamptz,           now() da leitura; os 30 dias contam daqui
--   "totais": {
--     "clinicas": int,                  linhas de "clinicas" (sem as e_de_teste; com p_incluir_teste, todas)
--     "em_uso": int,                    linhas com "em_uso" verdadeiro
--     "sem_uso": int,                   clinicas menos em_uso
--     "suspensas": int,                 linhas com "suspensao" (independe do uso)
--     "agente_liberado": int,           linhas com agente.estado teste ou producao
--     "gasto_mes_centavos_usd": int     mes corrente de todas, em centavos de dolar (arredonda a soma)
--   },
--   "clinicas": [                       ordem: ultimo_acesso.em mais recente primeiro, sem ultimo_acesso no fim; depois nome (sem caixa) e id
--     {
--       "id": uuid,
--       "nome": text,
--       "criada_em": timestamptz,
--       "fuso": text,                   clinic.timezone; vazio vira 'America/Fortaleza'
--       "em_uso": boolean,              ultimo_acesso.em >= gerado_em menos 30 dias; sem ultimo_acesso, false
--       "ultimo_acesso": null | {       null: ninguem com vinculo ativo na clinica entrou ainda
--         "em": timestamptz,            a ultima atividade da pessoa: o maior entre o login e a renovacao das sessoes
--         "user_id": uuid,
--         "nome": text | null,          profile.name
--         "email": text | null,         auth.users.email
--         "papel": text,                admin, gestor, recepcao, profissional ou leitura
--         "implementador": boolean,     a pessoa tem a marca de Implementador nesta clinica
--         "equipe_conduzza": boolean    a pessoa e da equipe Conduzza (product_admin)
--       },
--       "membros_ativos": int,          vinculos ativos (o Implementador e a equipe Conduzza contam)
--       "membros_pendentes": int,       vinculos pendentes (a equipe Conduzza conta)
--       "membros_equipe_conduzza": int, vinculos ativos da equipe Conduzza (ja contados em membros_ativos)
--       "pessoas": [                    todo vinculo (qualquer situacao, a equipe Conduzza inclusive), para a busca; ordem: nome ou e-mail (sem caixa), user_id
--         { "nome": text | null, "email": text | null }
--       ],
--       "numeros_total": int,           whatsapp_account sem os removidos
--       "numeros_conectados": int,      connection_status 'conectado'
--       "numeros": [                    ordem: principal primeiro, depois criacao e id
--         { "id": uuid, "nome": text, "final": text | null (4 ultimos digitos), "conexao": text (connection_status), "ia_ligada": boolean }
--       ],
--       "contatos": int,
--       "leads_30_dias": int,           contact.first_contact_at nos ultimos 30 dias
--       "conversas_30_dias": int,       conversation.created_at nos ultimos 30 dias
--       "ultima_mensagem_em": timestamptz | null,   max(conversation.last_inbound_at)
--       "suspensao": null | { "suspensa_em": timestamptz, "motivo": text },
--       "agente": {
--         "estado": text,               desligado (tambem sem linha), teste ou producao
--         "modo": text | null,          ia_liberacao.modo (simulador, contatos ou numero_inteiro); null sem a linha
--         "liberada": boolean,
--         "pausada_pela_clinica": boolean,
--         "telefones_ligados": int
--       },
--       "gasto": {                      centavos de dolar arredondados (ia_uso com as reservas)
--         "ultimas_24h_centavos_usd": int,
--         "mes_centavos_usd": int,
--         "ultimas_24h_sem_simulador_centavos_usd": int,
--         "mes_sem_simulador_centavos_usd": int
--       },
--       "teto_diario_centavos_usd": int | null   null sem a linha de liberacao
--     }
--   ]
-- }

create function public.painel_cs_das_clinicas(p_incluir_teste boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.painel_cs_das_clinicas(boolean) from public, anon;
grant execute on function public.painel_cs_das_clinicas(boolean)
  to authenticated, service_role;

comment on function public.painel_cs_das_clinicas(boolean) is
  'Painel geral como acompanhamento de cliente (CS, 26/10/2026), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS de paciente; nome e e-mail so da equipe da clinica. Clinicas e_de_teste so com p_incluir_teste. Ultimo acesso = a ultima atividade (decisao do dono de 26/10/2026: o maior entre auth.users.last_sign_in_at e a ultima renovacao das sessoes da pessoa em auth.sessions, updated_at e refreshed_at lido em UTC) dos vinculos ATIVOS, a equipe Conduzza (product_admin) inclusive e marcada; em uso = ultimo acesso nos ultimos 30 dias. Formato exato no comentario da migration 20261026100000_painel_cs.sql: {"gerado_em", "totais": {"clinicas", "em_uso", "sem_uso", "suspensas", "agente_liberado", "gasto_mes_centavos_usd"}, "clinicas": [{"id", "nome", "criada_em", "fuso", "em_uso", "ultimo_acesso": null ou {"em", "user_id", "nome", "email", "papel", "implementador", "equipe_conduzza"}, "membros_ativos", "membros_pendentes", "membros_equipe_conduzza", "pessoas": [{"nome", "email"}], "numeros_total", "numeros_conectados", "numeros": [{"id", "nome", "final", "conexao", "ia_ligada"}], "contatos", "leads_30_dias", "conversas_30_dias", "ultima_mensagem_em", "suspensao": null ou {"suspensa_em", "motivo"}, "agente": {"estado", "modo", "liberada", "pausada_pela_clinica", "telefones_ligados"}, "gasto": {"ultimas_24h_centavos_usd", "mes_centavos_usd", "ultimas_24h_sem_simulador_centavos_usd", "mes_sem_simulador_centavos_usd"}, "teto_diario_centavos_usd"}] (ultimo acesso mais recente primeiro, sem acesso no fim)}.';

-- ---------------------------------------------------------------------------
-- 2) A equipe da clinica, no detalhe
-- ---------------------------------------------------------------------------
-- FORMATO EXATO do jsonb devolvido: null (jsonb nulo) quando a clinica nao
-- existe; senao (toda chave sempre presente; null so onde esta escrito):
-- {
--   "clinic_id": uuid,
--   "gerado_em": timestamptz,           now() da leitura
--   "equipe": [ pessoa ],               os vinculos SEM a marca de Implementador
--   "implementadores": [ pessoa ]       os vinculos COM a marca (membro_implementador)
-- }
-- pessoa = {
--   "user_id": uuid,
--   "nome": text | null,                profile.name
--   "email": text | null,               auth.users.email
--   "papel": text,                      admin, gestor, recepcao, profissional ou leitura (o Implementador e sempre admin)
--   "situacao": text,                   ativo, pendente ou inativo
--   "ultimo_acesso_em": timestamptz | null,   a ultima atividade da pessoa (o maior entre o login e a renovacao das sessoes), qualquer que seja a situacao
--   "na_equipe_desde": timestamptz,     clinic_member.created_at
--   "equipe_conduzza": boolean,         a pessoa e da equipe Conduzza (super admin): so a marca
--   "conta_no_uso": boolean,            situacao ativo: entra no ultimo acesso e nas ativas da clinica
--   "marcado_em": timestamptz | null    so nos implementadores (quando ganhou a marca); null em "equipe"
-- }
-- Ordem das duas listas: situacao (ativo, pendente, inativo), papel (admin,
-- gestor, recepcao, profissional, leitura), nome ou e-mail (sem caixa),
-- user_id. Clinica e_de_teste tambem responde (a tela so abre o detalhe de
-- quem esta na lista). p_clinic_id nulo: 22004.

create function public.equipe_da_clinica_no_painel(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_equipe jsonb;
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

  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica.';
  end if;

  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    return null;
  end if;

  -- Dado da equipe (nome, e-mail, papel, situacao e a ultima atividade),
  -- nenhum de paciente. A ultima atividade e a mesma da lista: o maior entre
  -- o ultimo login e a ultima renovacao das sessoes da pessoa (updated_at;
  -- refreshed_at e sem fuso, gravado em UTC pelo Auth), pelo indice de
  -- user_id.
  with pessoas as (
    select m.user_id,
           m.role,
           m.status,
           m.created_at,
           nullif(btrim(p.name), '') as nome,
           nullif(btrim(u.email), '') as email,
           greatest(u.last_sign_in_at, s.ultima_renovacao) as ultimo_acesso_em,
           a.user_id is not null as equipe_conduzza,
           i.user_id is not null as implementador,
           i.marcado_em
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
     where m.clinic_id = p_clinic_id
  ),
  linhas as (
    select x.implementador,
           array_position(array['ativo', 'pendente', 'inativo'], x.status) as ordem_situacao,
           array_position(array['admin', 'gestor', 'recepcao', 'profissional', 'leitura'], x.role) as ordem_papel,
           lower(coalesce(x.nome, x.email, '')) as ordem_nome,
           x.user_id,
           jsonb_build_object(
             'user_id', x.user_id,
             'nome', x.nome,
             'email', x.email,
             'papel', x.role,
             'situacao', x.status,
             'ultimo_acesso_em', x.ultimo_acesso_em,
             'na_equipe_desde', x.created_at,
             'equipe_conduzza', x.equipe_conduzza,
             'conta_no_uso', x.status = 'ativo',
             'marcado_em', x.marcado_em) as pessoa
      from pessoas x
  )
  select jsonb_build_object(
           'clinic_id', p_clinic_id,
           'gerado_em', now(),
           'equipe', coalesce(
             jsonb_agg(o.pessoa order by o.ordem_situacao, o.ordem_papel, o.ordem_nome, o.user_id)
               filter (where not o.implementador),
             '[]'::jsonb),
           'implementadores', coalesce(
             jsonb_agg(o.pessoa order by o.ordem_situacao, o.ordem_papel, o.ordem_nome, o.user_id)
               filter (where o.implementador),
             '[]'::jsonb))
    into v_equipe
    from linhas o;

  return v_equipe;
end;
$$;

revoke all on function public.equipe_da_clinica_no_painel(uuid) from public, anon;
grant execute on function public.equipe_da_clinica_no_painel(uuid)
  to authenticated, service_role;

comment on function public.equipe_da_clinica_no_painel(uuid) is
  'A equipe de uma clinica no detalhe do Painel geral (CS, 26/10/2026; fecha a P18-5), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros; 22004 sem a clinica). Dado da equipe, nenhum de paciente. Null quando a clinica nao existe. Formato exato no comentario da migration 20261026100000_painel_cs.sql: {"clinic_id", "gerado_em", "equipe": [pessoa] (sem a marca de Implementador), "implementadores": [pessoa] (com a marca)}, pessoa = {"user_id", "nome", "email", "papel", "situacao", "ultimo_acesso_em" (a ultima atividade, decisao do dono de 26/10/2026: o maior entre auth.users.last_sign_in_at e a ultima renovacao das sessoes da pessoa em auth.sessions, updated_at e refreshed_at lido em UTC, qualquer que seja a situacao), "na_equipe_desde", "equipe_conduzza" (so a marca), "conta_no_uso" (situacao ativo), "marcado_em" (so nos implementadores)}; ordem: situacao, papel, nome.';

-- ---------------------------------------------------------------------------
-- 3) O agente pelo painel, conferindo o estado que a tela mostrava
-- ---------------------------------------------------------------------------
-- O "Liberar agente" (vai para Teste) e o "Retirar agente" (vai para
-- Desligado) da linha da lista, e o seletor do detalhe (Teste, Producao,
-- volta para Teste, Desligado), mandam o estado que a tela mostrava
-- (p_estado_visto) junto com o pedido (p_estado). Com as travas de
-- definir_agente_da_clinica, na mesma ordem (a dos requisitos, so na
-- producao; a linha de liberacao; a do estado), o estado de agora e
-- conferido:
--   - mudou (outra aba, outra pessoa da equipe Conduzza, a revogacao de um
--     requisito): P0001 agente_mudou, com o estado de agora no hint; nada
--     muda e nada vai para a trilha;
--   - e o mesmo: definir_agente_da_clinica(p_clinic_id, p_estado, p_motivo),
--     na mesma transacao, com tudo o que ela confere e grava.
-- Antes das travas, uma trava consultiva por clinica (so desta funcao): duas
-- mudancas do painel na mesma clinica (dois cliques, duas abas) passam uma
-- de cada vez, e a segunda ve o estado que a primeira deixou. Ela vem antes
-- de qualquer outra, e so esta funcao a pega: nao entra em ciclo com as
-- travas de definir_agente_da_clinica, definir_liberacao_da_ia e
-- revogar_requisito_da_producao (que pegam requisitos, liberacao e estado
-- nessa ordem, a mesma daqui). Nada levanta 40001 ou 40P01 de proposito.
-- Codigos: 42501 (quem nao e da equipe Conduzza, antes de ler qualquer
-- coisa); 22004 (clinica, estado visto ou estado nulos); 22023
-- estado_invalido (estado visto ou pedido fora de desligado, teste e
-- producao) e mudanca_invalida (o pedido e o estado visto); P0002 (a
-- clinica nao existe); P0001 agente_mudou; e os de
-- definir_agente_da_clinica (clinica_de_teste, clinica_suspensa,
-- motivo_invalido, requisitos_pendentes).

create function public.definir_agente_da_clinica_no_painel(
  p_clinic_id uuid,
  p_estado_visto text,
  p_estado text,
  p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual text;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor (a
  -- guarda de definir_agente_da_clinica), antes de ler qualquer coisa: a
  -- recusa por estado mudado nao conta nada a quem nao pode ver.
  perform public.ia_exigir_equipe_conduzza();
  if p_clinic_id is null or p_estado_visto is null or p_estado is null then
    raise exception using errcode = '22004',
      message = 'Informe a clínica, o estado que a tela mostrava e o estado pedido.';
  end if;
  if p_estado_visto not in ('desligado', 'teste', 'producao')
     or p_estado not in ('desligado', 'teste', 'producao') then
    raise exception using errcode = '22023', message = 'estado_invalido',
      hint = 'Use desligado, teste ou producao.';
  end if;
  if p_estado = p_estado_visto then
    raise exception using errcode = '22023', message = 'mudanca_invalida',
      hint = 'O estado pedido é o que a tela já mostrava.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  -- Uma mudanca do painel por vez nesta clinica.
  perform pg_advisory_xact_lock(
    hashtextextended('definir_agente_da_clinica_no_painel:' || p_clinic_id::text, 0));
  -- As travas de definir_agente_da_clinica, na mesma ordem: a dos
  -- requisitos (so a producao), a linha de liberacao e a do estado.
  if p_estado = 'producao' then
    perform pg_advisory_xact_lock(hashtextextended('ia_requisito_da_producao', 0));
  end if;
  perform 1 from public.ia_liberacao l where l.clinic_id = p_clinic_id for update;
  select h.estado
    into v_atual
    from public.ia_clinica_habilitada h
   where h.clinic_id = p_clinic_id
     for update;

  -- Sem linha, a clinica esta desligada (como o painel mostra).
  if coalesce(v_atual, 'desligado') <> p_estado_visto then
    raise exception using errcode = 'P0001', message = 'agente_mudou',
      hint = coalesce(v_atual, 'desligado');
  end if;

  perform public.definir_agente_da_clinica(p_clinic_id, p_estado, p_motivo);
end;
$$;

revoke all on function public.definir_agente_da_clinica_no_painel(uuid, text, text, text) from public, anon;
grant execute on function public.definir_agente_da_clinica_no_painel(uuid, text, text, text)
  to authenticated, service_role;

comment on function public.definir_agente_da_clinica_no_painel(uuid, text, text, text) is
  'O agente da clinica pelo Painel geral (26/10/2026), conferindo o estado que a tela mostrava: com as travas de definir_agente_da_clinica na mesma ordem (e uma por clinica antes delas), se o estado de agora (sem linha, desligado) nao e p_estado_visto, nada muda (P0001 agente_mudou, o estado de agora no hint); senao, definir_agente_da_clinica(p_clinic_id, p_estado, p_motivo) na mesma transacao. So super admin, service role e SQL editor (42501). 22004 (nulos), 22023 estado_invalido e mudanca_invalida (o pedido e o estado visto), P0002 (clinica que nao existe) e os codigos de definir_agente_da_clinica. Detalhes no comentario da migration 20261026100000_painel_cs.sql.';
