-- ---------------------------------------------------------------------------
-- Painel geral, terceira leva do acompanhamento de cliente (CS)
-- ---------------------------------------------------------------------------
-- Decisoes do dono em 26/10/2026, depois da segunda leva no ar (commit
-- c4129bd, migration 20261026110000 aplicada), respostas literais:
-- 1. "Atencao nos 30 primeiros dias (Recomendado)": uma clinica com menos de
--    30 dias de criada e sem uso aparece como Atencao, com o sinal novo
--    "Ainda sem acesso"; depois de 30 dias vira Em risco ("Sem uso ha 30
--    dias"), como hoje. Era um ponto aberto da segunda leva: a clinica nova
--    em que ninguem entrou ainda aparecia Em risco logo de saida.
-- 2. "Sim, numa migration pequena (Recomendado)": o banco recusa nome de
--    clinica vazio (ou so espacos) e fuso horario inexistente ao gravar a
--    clinica. O administrador de uma clinica grava clinic.name e
--    clinic.timezone pela API (PostgREST; policy "admin da clinica edita a
--    clinica", sem CHECK): um fuso inexistente derrubava
--    painel_cs_das_clinicas para TODAS as clinicas ("time zone not
--    recognized"), e um nome so de espacos passava. A tela ja valida pelo
--    Zod (components/configuracoes/dados-da-clinica.ts: o nome com .trim()
--    e o fuso numa lista fechada do Brasil); a brecha era so a API direta.
-- 3. (Da tela, nao daqui: o rotulo "Teto de IA atingido" usa a quantidade
--    que o sinal perto_do_teto_da_ia ja manda.)
--
-- O QUE MUDA:
-- 1. painel_cs_das_clinicas: create or replace a partir do corpo APLICADO
--    (fndef.js, so leitura; md5(prosrc) e828969f6d56c23a061e2ae951d1a58f, o
--    da migration 20261026110000), mudando SO o sinal de sem uso e a saude:
--      - sinal NOVO ainda_sem_acesso (atencao; quantidade null; desde = a
--        criacao da clinica, clinic.created_at), na MESMA posicao de sem_uso
--        (a segunda), quando em_uso e falso e a clinica foi criada ha MENOS
--        de 30 dias (created_at > gerado_em menos 30 dias, com o mesmo
--        relogio dos 30 dias do uso: o now() da leitura);
--      - sem_uso (em_risco; desde = o ultimo acesso, como antes) so quando
--        em_uso e falso e a clinica foi criada ha 30 dias ou mais (30 dias
--        exatos ja e sem_uso). Os dois nunca vem juntos: sem uso, sai
--        exatamente um deles;
--      - saude: em_risco com sem_uso, conta_suspensa ou
--        whatsapp_desconectado; atencao com qualquer outro sinal (agora
--        tambem ainda_sem_acesso); saudavel sem sinal nenhum. Os totais por
--        saude seguem a mesma regra.
--    NADA MAIS MUDA: toda outra chave e valor, a ordem, a assinatura,
--    STABLE, SECURITY DEFINER, search_path vazio, a guarda (so a equipe
--    Conduzza, is_product_admin(), a service role e o SQL editor; 42501 para
--    os outros) e os grants (EXECUTE so para authenticated e service_role).
--    Os totais em_uso e sem_uso NAO mudam: a clinica nova sem acesso
--    continua contando em "Sem uso" nos cartoes (so a saude dela muda). O
--    comentario da funcao diz a regra nova.
-- 2. validar_dados_da_clinica() e o gatilho validar_dados_da_clinica (BEFORE
--    INSERT OR UPDATE OF name, timezone ON clinic, FOR EACH ROW). Recusa com
--    23514 (check_violation; o PostgREST devolve 400):
--      - nome_da_clinica_vazio: o nome nulo ou so com brancos. Os brancos
--        sao EXATAMENTE os que o .trim() do JavaScript tira (o Zod da tela
--        usa .trim()), numa lista explicita, que nao depende de \s nem de
--        [[:space:]] (que mudam com a colacao): tab (U+0009), quebra de
--        linha (U+000A), tab vertical (U+000B), avanco de pagina (U+000C),
--        retorno (U+000D), espaco (U+0020), espaco nao separavel (U+00A0),
--        U+1680, U+2000 a U+200A, separador de linha (U+2028) e de paragrafo
--        (U+2029), U+202F, U+205F, U+3000 e o BOM (U+FEFF). Conferido ponto
--        de codigo a ponto de codigo (de U+0001 a U+10FFFF) contra o .trim()
--        do Node, no Postgres 17 da producao (so leitura) e no 18 local: os
--        mesmos 25. O que o .trim() nao tira (U+200B, U+0085, U+001C a
--        U+001F, U+180E) conta como caractere, como na tela. O banco nao
--        tira as pontas (a tela ja tira) nem exige 2 letras (regra so da
--        tela);
--      - fuso_invalido, com o motivo no DETAIL (nunca o valor), pela REGRA
--        BARATA do fuso (decisao do coordenador de 26/10/2026, no lugar de
--        pg_timezone_names, que custava de 0,78 a 1,22 s por leitura na
--        producao e aceitava posix/ e Factory):
--        (1) o formato: nome IANA de regiao com barra (Area/Lugar, com mais
--            niveis se houver) ou UTC, pela expressao
--            ^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$; e digito ou + so
--            nos 29 Etc/GMT da tabela de fusos (Etc/GMT0, Etc/GMT+0 e -0,
--            Etc/GMT+1 a +12, Etc/GMT-1 a -14). ACHADO da construcao
--            (fechado aqui, alem da regra do coordenador): o Postgres le um
--            nome com digito que nao e arquivo de fuso como especificacao
--            POSIX, cujo nome padrao aceita a barra; Etc/GMT+15, Abc/Def+3,
--            America/Sao_Paulo-3 e Foo/Bar3Baz passavam na expressao e no
--            Postgres (conferido na producao, so leitura, e no local), e o
--            JavaScript da tela os recusa. Fora de Etc/GMT, nenhum fuso IANA
--            tem digito ou +;
--        (2) fora dos diretorios posix/ e right/ do tzdata do sistema, sem
--            caixa: o Postgres da producao acha Posix/America/Fortaleza,
--            POSIX/America/Fortaleza e Right/America/Fortaleza (busca sem
--            caixa; right/ nem aparece em pg_timezone_names), que passam na
--            expressao, e o JavaScript da tela os recusa (conferido na
--            producao, so leitura, e no Node);
--        (3) o Postgres reconhece: pg_catalog.timezone(fuso, now()), o mesmo
--            "at time zone" do painel, nao levanta invalid_parameter_value
--            (o gatilho traduz para 23514 fuso_invalido).
--        Recusa abreviacao (BRT), especificacao POSIX (UTC+3, EST5EDT e as
--        disfarcadas de nome, como Etc/GMT+15 e America/Sao_Paulo-3),
--        posix/..., right/..., Factory, os nomes de uma palavra so (EST, GMT,
--        Japan...), o que comeca em minuscula, o vazio, o nulo e lixo; aceita
--        America/Fortaleza, America/Noronha, Etc/GMT+3, Asia/Tokyo,
--        America/Argentina/Buenos_Aires, Pacific/Kiritimati, UTC e todo fuso
--        IANA de regiao, nao so os do Brasil. Conferido: dos 598 nomes de
--        pg_timezone_names da producao sem posix/ e right/ (os mesmos do
--        Postgres local), 554 passam na expressao, e o JavaScript (Node 24,
--        ICU 77.1, Intl.DateTimeFormat) aceita os 554; os 44 que ela recusa
--        sao os de uma palavra so (CET, EST, GMT, Japan, Factory...). Os 2
--        fusos da producao e os 46 que a tela e as suites usam passam.
--        Variantes de caixa de um nome real (America/fortaleza) passam: o
--        Postgres e o JavaScript as reconhecem sem caixa.
--    No INSERT confere os dois; no UPDATE, so o que mudou (is distinct from
--    old): uma linha antiga fora da regra nao impede atualizar outra coluna
--    (nem o outro dos dois). Funcao plpgsql, SECURITY INVOKER (so chama
--    pg_catalog.timezone, que todo papel chama), search_path vazio, nomes
--    qualificados; EXECUTE so para postgres e service_role (molde
--    proteger_e_de_teste; o gatilho dispara para todo papel). Pelo nome, e o
--    ULTIMO dos gatilhos BEFORE de clinic (proteger_e_de_teste,
--    proteger_limite_de_numeros, set_updated_at e ele): confere a linha como
--    ela vai ser gravada. Ele roda antes da RLS: um INSERT da sessao com nome
--    vazio recebe 23514; com o nome bom, a RLS recusa (42501), como hoje. O
--    cadastro (handle_new_user) passa por ele: o nome vem do cadastro (o
--    trim() de la so tira o espaco comum; um nome so de tab ou de espaco nao
--    separavel agora e recusado e o cadastro inteiro falha, sem usuario nem
--    clinica) e o fuso e o padrao da coluna (America/Fortaleza).
--    PONTO DE PARTIDA: antes do gatilho, com clinic travada (a mesma trava
--    do CREATE TRIGGER, pega antes), a migration confere que TODA linha
--    passa nas duas regras (a mesma regra do fuso) e que o fuso padrao da
--    coluna passa; se nao, falha inteira (P0001 clinica_com_dado_invalido,
--    com o id e o motivo de cada clinica no DETAIL: nome vazio, fuso fora do
--    formato, fuso de diretorio do sistema ou fuso que o Postgres nao
--    reconhece; ou P0001 fuso_padrao_invalido) e nada se aplica. Na
--    producao, em 26/10/2026 (q.js, so leitura): 57 clinicas, fusos
--    America/Fortaleza (49) e America/Noronha (8), os dois na regra; o menor
--    nome com 8 caracteres; nenhum nome vazio. Provado no Postgres local
--    tambem com outra sessao gravando um nome vazio no meio: o LOCK TABLE
--    espera o commit dela, e a conferencia ve a linha.
--
-- CUSTO (a regra barata; medido em 26/10/2026): nenhuma leitura de lista. Na
-- producao (so leitura, explain analyze): pg_catalog.timezone carrega o
-- arquivo do fuso na primeira vez de cada conexao (de 4,8 a 7,7 ms) e
-- depois fica em memoria (10 mil chamadas em 2,2 a 2,5 ms); a expressao, a
-- regra dos digitos e a exclusao, 10 mil nomes em 16 a 27 ms (uns 3
-- microssegundos cada). No gatilho (Postgres local, rodadas de 2.000 UPDATE em
-- clinicas novas): trocar o fuso custa 0,034 ms por UPDATE com o gatilho e
-- 0,031 ms sem ele (a regra inteira, uns 4 microssegundos); a recusa, 0,09
-- ms pela expressao e 0,12 ms pelo Postgres (com o bloco que a pega); o
-- INSERT de uma clinica com todos os gatilhos de clinica nova, 0,45 ms.
-- Mudar o nome confere so o nome; outra coluna nao dispara o gatilho.
--
-- Producao em 26/10/2026 (q.js, so leitura): das 6 clinicas reais, as 3 sem
-- uso tem de 41 a 62 dias de criadas (continuam sem_uso, Em risco); as 51
-- de teste tem todas menos de 30 dias e nenhuma esta em uso (passam de
-- sem_uso para ainda_sem_acesso; so aparecem com "clinicas de teste"). Na
-- lista padrao, nada muda hoje.
--
-- ORDEM DE PUBLICACAO (AO CONTRARIO das levas anteriores): o CODIGO
-- PRIMEIRO. O leitor publicado em c4129bd (lib/queries/painel-geral.ts,
-- sinalDoBanco) recusa chave de sinal que nao conhece ("painel geral
-- ilegivel"): com esta migration aplicada antes do codigo novo, a lista e o
-- detalhe do Painel geral (e o "Ligar" de numero pelo painel e a
-- exportacao) falham para a equipe Conduzza assim que uma clinica da lista
-- tiver ainda_sem_acesso (hoje, as 51 de teste, com "clinicas de teste"; na
-- lista padrao, a proxima clinica real nova). O codigo novo (commit 0e56ae5
-- em diante) le os dois corpos, o de hoje e este (conferido no Postgres
-- local: as duas saidas passam por lerPainelDoBanco; o leitor de c4129bd
-- recusa a de depois com as clinicas de teste). O gatilho nao depende do
-- codigo.
--
-- LOCKS (lock_timeout de 3 s: com clinic ocupada, a migration falha inteira
-- e roda de novo): o create or replace do painel, a funcao do gatilho, o
-- REVOKE e os COMMENT sao so catalogo. A conferencia pega SHARE ROW
-- EXCLUSIVE em clinic (LOCK TABLE, a mesma trava que o CREATE TRIGGER pega)
-- ANTES de olhar as linhas, ate o commit: segura INSERT, UPDATE e DELETE em
-- clinic (o cadastro, a aba Clinica das Configuracoes, as suites), NAO a
-- leitura; dali ate o commit sao milissegundos (a regra em cada linha de
-- clinic, sem leitura de lista, e o CREATE TRIGGER). Nenhum ALTER TABLE;
-- nada levanta 40001 ou 40P01.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO o banco, DEPOIS (se for o caso) o
-- codigo, AO CONTRARIO das levas anteriores (o codigo novo le os dois
-- corpos; o de c4129bd nao conhece ainda_sem_acesso). Numa transacao, no SQL
-- editor, o arquivo
-- supabase/operacao/rollback/20261026120000-corpos-anteriores.sql: saem o
-- gatilho e a funcao dele (clinic volta a aceitar nome vazio e fuso
-- inexistente pela API) e painel_cs_das_clinicas volta ao corpo e ao
-- comentario de 26/10/2026 (md5(prosrc) e828969f6d56c23a061e2ae951d1a58f e
-- comentario 637eaef6f1be69b17d49cead4f86a792, conferidos no fim do
-- arquivo). Nenhum dado se perde.

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) A lista e os cartoes do topo, com a terceira leva
-- ---------------------------------------------------------------------------
-- FORMATO EXATO do jsonb devolvido (toda chave sempre presente; null so onde
-- esta escrito; timestamptz em texto ISO 8601 com o deslocamento; contagens,
-- centavos e microdolares sao inteiros, nunca negativos). "MUDA" marca o
-- que esta migration muda; o resto e o de 20261026100000 e 20261026110000,
-- sem mudanca.
-- {
--   "gerado_em": timestamptz,           now() da leitura; todas as janelas contam daqui
--   "totais": {
--     "clinicas": int,                  linhas de "clinicas" (sem as e_de_teste; com p_incluir_teste, todas)
--     "em_uso": int,                    linhas com "em_uso" verdadeiro
--     "sem_uso": int,                   clinicas menos em_uso
--     "suspensas": int,                 linhas com "suspensao" (independe do uso)
--     "agente_liberado": int,           linhas com agente.estado teste ou producao
--     "gasto_mes_centavos_usd": int,    mes corrente de todas, em centavos de dolar (arredonda a soma)
--     "gasto_mes_microdolares": int,    o mesmo gasto, exato, em microdolares (US$ 1 = 1.000.000)
--     "chamadas_mes": int,              soma de gasto.mes_chamadas das linhas
--     "saude": {                        as tres somam "clinicas"; MUDA: pela regra nova da saude (abaixo)
--       "saudavel": int,
--       "atencao": int,
--       "em_risco": int
--     }
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
--       "gasto": {                      ia_uso com as reservas; 24 horas = janela movel do teto; mes = mes corrente no fuso da clinica
--         "ultimas_24h_centavos_usd": int,                  centavos de dolar arredondados
--         "mes_centavos_usd": int,
--         "ultimas_24h_sem_simulador_centavos_usd": int,
--         "mes_sem_simulador_centavos_usd": int,
--         "ultimas_24h_microdolares": int,                  os mesmos quatro, exatos, em microdolares
--         "mes_microdolares": int,
--         "ultimas_24h_sem_simulador_microdolares": int,
--         "mes_sem_simulador_microdolares": int,
--         "ultimas_24h_chamadas": int,                      linhas reais de ia_uso (sem as reservas), com o simulador
--         "mes_chamadas": int,
--         "ultimas_24h_sem_simulador_chamadas": int,
--         "mes_sem_simulador_chamadas": int
--       },
--       "teto_diario_centavos_usd": int | null,  null sem a linha de liberacao
--       "saude": text,                  saudavel, atencao ou em_risco. MUDA: em_risco com sem_uso, conta_suspensa ou
--                                       whatsapp_desconectado; atencao com qualquer outro sinal (ainda_sem_acesso inclusive);
--                                       saudavel sem sinal
--       "sinais": [                     so os que valem, nesta ordem: conta_suspensa, sem_uso OU ainda_sem_acesso (MUDA:
--                                       a mesma posicao; sem uso, sai exatamente um dos dois: ainda_sem_acesso com a clinica
--                                       criada ha menos de 30 dias, created_at > gerado_em menos 30 dias; sem_uso com 30 dias
--                                       ou mais), whatsapp_desconectado, sem_numero_de_whatsapp, pedido_de_entrada_esperando,
--                                       falhas_de_envio, perto_do_teto_da_ia
--         {
--           "chave": text,              uma das oito acima (MUDA: ainda_sem_acesso e nova)
--           "nivel": text,              em_risco (conta_suspensa, sem_uso, whatsapp_desconectado) ou atencao (as outras;
--                                       MUDA: ainda_sem_acesso e atencao)
--           "quantidade": int | null,   whatsapp_desconectado: numeros (todos sem conexao); pedido_de_entrada_esperando: pedidos
--                                       ha mais de 2 dias; falhas_de_envio: mensagens com falha nos 7 dias; perto_do_teto_da_ia:
--                                       o percentual do teto ja gasto nas 24 horas (inteiro, para baixo; 100 ou mais = atingido);
--                                       null nas outras
--           "desde": timestamptz | null conta_suspensa: suspensa_em; sem_uso: ultimo_acesso.em (null: nunca entrou);
--                                       MUDA: ainda_sem_acesso: criada_em (a criacao da clinica, clinic.created_at);
--                                       whatsapp_desconectado: a desconexao mais recente (whatsapp_account.disconnected_at; null
--                                       sem registro); pedido_de_entrada_esperando: o pedido mais antigo; falhas_de_envio: a
--                                       falha mais antiga dos 7 dias; null nas outras
--         }
--       ],
--       "implantacao": {
--         "feitos": int,                0 a 6
--         "total": int,                 sempre 6
--         "passos": [                   sempre os 6, nesta ordem: whatsapp_conectado, equipe_com_duas_pessoas,
--                                       procedimentos_cadastrados, profissionais_cadastrados, regua_de_confirmacao_ligada,
--                                       anuncios_conectados
--           {
--             "chave": text,
--             "feito": boolean,
--             "quantidade": int         numeros conectados; vinculos ativos; procedimentos ativos; profissionais ativos;
--                                       reguas de confirmacao ligadas; anuncios: quantos dos dois (Meta e Google) estao ligados
--           }
--         ],
--         "anuncios": { "meta": boolean, "google": boolean }
--       },
--       "tendencia": {
--         "leads": tendencia,           contact.first_contact_at
--         "conversas": tendencia        conversation.created_at
--       },
--       "ultima_nota_em": timestamptz | null   a nota interna mais recente; null sem nota
--     }
--   ]
-- }
-- tendencia = {
--   "atual": int,                       ultimos 30 dias (o mesmo de leads_30_dias e conversas_30_dias)
--   "anterior": int,                    os 30 dias antes desses
--   "variacao_percentual": int | null,  round((atual - anterior) * 100 / anterior); null com anterior 0
--   "direcao": text                     sem_base (anterior 0), estavel (variacao de -9 a 9), subindo (10 ou mais) ou caindo (-10 ou menos)
-- }

create or replace function public.painel_cs_das_clinicas(p_incluir_teste boolean default false)
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
           -- Terceira leva: a criacao da clinica, para o sinal de sem uso
           -- (nos 30 primeiros dias, ainda_sem_acesso; depois, sem_uso),
           -- com o mesmo relogio do uso (now(), o gerado_em).
           k.created_at as criada_em,
           k.created_at > now() - interval '30 days' as criada_ha_menos_de_30_dias,
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
             when (not o.em_uso and not o.criada_ha_menos_de_30_dias) or o.suspensa
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
            -- Sem uso (terceira leva): nos 30 primeiros dias da clinica,
            -- ainda_sem_acesso (atencao, desde a criacao); com 30 dias ou
            -- mais, sem_uso (em_risco, desde o ultimo acesso). Os dois na
            -- mesma posicao, nunca juntos.
            (2, case
                  when not o.em_uso and o.criada_ha_menos_de_30_dias then jsonb_build_object(
                    'chave', 'ainda_sem_acesso', 'nivel', 'atencao',
                    'quantidade', null::bigint, 'desde', o.criada_em)
                  when not o.em_uso then jsonb_build_object(
                    'chave', 'sem_uso', 'nivel', 'em_risco',
                    'quantidade', null::bigint, 'desde', o.acesso_em)
                end),
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
$$;

revoke all on function public.painel_cs_das_clinicas(boolean) from public, anon;
grant execute on function public.painel_cs_das_clinicas(boolean)
  to authenticated, service_role;

comment on function public.painel_cs_das_clinicas(boolean) is
  'Painel geral como acompanhamento de cliente (CS, 26/10/2026; segunda leva na migration 20261026110000_painel_cs_2.sql e terceira na 20261026120000_painel_cs_3.sql), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS de paciente; nome e e-mail so da equipe da clinica. Clinicas e_de_teste so com p_incluir_teste. Ultimo acesso = a ultima atividade (o maior entre auth.users.last_sign_in_at e a ultima renovacao das sessoes em auth.sessions) dos vinculos ATIVOS, a equipe Conduzza inclusive e marcada; em uso = ultimo acesso nos ultimos 30 dias. Sem uso (terceira leva, decisao do dono de 26/10/2026): o sinal ainda_sem_acesso (atencao, desde a criacao da clinica) nos 30 primeiros dias da clinica e sem_uso (em_risco, desde o ultimo acesso) depois, na mesma posicao; saude em_risco com sem_uso, conta_suspensa ou whatsapp_desconectado, atencao com qualquer outro sinal, saudavel sem sinal; os totais em_uso e sem_uso nao mudam. Formato exato no comentario das migrations 20261026100000_painel_cs.sql, 20261026110000_painel_cs_2.sql e 20261026120000_painel_cs_3.sql: {"gerado_em", "totais": {"clinicas", "em_uso", "sem_uso", "suspensas", "agente_liberado", "gasto_mes_centavos_usd", "gasto_mes_microdolares", "chamadas_mes", "saude": {"saudavel", "atencao", "em_risco"}}, "clinicas": [{"id", "nome", "criada_em", "fuso", "em_uso", "ultimo_acesso", "membros_ativos", "membros_pendentes", "membros_equipe_conduzza", "pessoas", "numeros_total", "numeros_conectados", "numeros", "contatos", "leads_30_dias", "conversas_30_dias", "ultima_mensagem_em", "suspensao", "agente", "gasto": {os quatro em centavos, os quatro em microdolares e as quatro contagens de chamadas}, "teto_diario_centavos_usd", "saude", "sinais": [{"chave", "nivel", "quantidade", "desde"}], "implantacao": {"feitos", "total", "passos": [{"chave", "feito", "quantidade"}], "anuncios": {"meta", "google"}}, "tendencia": {"leads", "conversas"}, "ultima_nota_em"}] (ultimo acesso mais recente primeiro, sem acesso no fim)}.';

-- ---------------------------------------------------------------------------
-- 2) O nome e o fuso da clinica, conferidos ao gravar
-- ---------------------------------------------------------------------------
-- A REGRA DO FUSO (a mesma no gatilho e no ponto de partida; decisao do
-- coordenador de 26/10/2026, no lugar de pg_timezone_names, que custava
-- cerca de 1 s por leitura na producao e aceitava posix/ e Factory):
--   (1) o formato: um nome IANA de regiao com barra (Area/Lugar, com mais
--       niveis se houver) ou UTC, pela expressao
--       ^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$; e digito ou + so nos
--       29 Etc/GMT da tabela de fusos (Etc/GMT0, Etc/GMT+0 e -0, Etc/GMT+1
--       a +12 e Etc/GMT-1 a -14), pela expressao
--       ^Etc/GMT(0|[+-]0|[+]([1-9]|1[0-2])|-([1-9]|1[0-4]))$: o Postgres le
--       um nome com digito que nao e arquivo como especificacao POSIX (o
--       nome padrao do POSIX aceita a barra), e Etc/GMT+15, Abc/Def+3,
--       America/Sao_Paulo-3 e Foo/Bar3Baz passariam na expressao e no
--       Postgres (na producao e no local) e o JavaScript os recusa;
--   (2) fora dos diretorios posix/ e right/ do tzdata do sistema, sem caixa:
--       o Postgres da producao os acha sem caixa (Posix/America/Fortaleza,
--       POSIX/..., Right/...), e o JavaScript da tela os recusa;
--   (3) o Postgres reconhece: pg_catalog.timezone(fuso, now()), o mesmo "at
--       time zone" do painel, nao levanta invalid_parameter_value.
-- Nenhuma leitura de lista: microssegundos (a primeira vez numa conexao, o
-- Postgres carrega o arquivo do fuso, de 5 a 8 ms na producao).
--
-- O ponto de partida: o fuso padrao da coluna passa na regra (senao o
-- gatilho recusaria todo cadastro); depois a trava (SHARE ROW EXCLUSIVE, a
-- mesma que o CREATE TRIGGER pega): dali ate o commit ninguem grava em
-- clinic, e a conferencia de toda linha de hoje (as duas regras) vale ate
-- o gatilho existir. Linha fora da regra: a migration falha inteira, com o
-- id e o motivo de cada uma no DETAIL.
do $ponto_de_partida$
declare
  v_c record;
  v_motivo text;
  v_fora text[] := '{}';
begin
  begin
    perform pg_catalog.timezone('America/Fortaleza', pg_catalog.now());
  exception when invalid_parameter_value then
    raise exception using errcode = 'P0001', message = 'fuso_padrao_invalido',
      detail = 'O Postgres nao reconhece o fuso padrao de clinic.timezone (America/Fortaleza): o gatilho recusaria todo cadastro.';
  end;

  lock table public.clinic in share row exclusive mode;

  for v_c in select c.id, c.name, c.timezone from public.clinic c order by c.id loop
    v_motivo := case
      when v_c.name is null
           or v_c.name !~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' then 'nome vazio'
      when v_c.timezone is null
           or v_c.timezone !~ '^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
           or (v_c.timezone ~ '[0-9+]'
               and v_c.timezone !~ '^Etc/GMT(0|[+-]0|[+]([1-9]|1[0-2])|-([1-9]|1[0-4]))$') then 'fuso fora do formato'
      when v_c.timezone ~* '^(posix|right)/' then 'fuso de diretorio do sistema'
    end;
    if v_motivo is null then
      begin
        perform pg_catalog.timezone(v_c.timezone, pg_catalog.now());
      exception when invalid_parameter_value then
        v_motivo := 'fuso que o Postgres nao reconhece';
      end;
    end if;
    if v_motivo is not null then
      v_fora := v_fora || (v_c.id::text || ' (' || v_motivo || ')');
    end if;
  end loop;
  if cardinality(v_fora) > 0 then
    raise exception using errcode = 'P0001', message = 'clinica_com_dado_invalido',
      detail = format('%s clinica(s) fora da regra: %s', cardinality(v_fora), array_to_string(v_fora, ', ')),
      hint = 'Corrija o nome e o fuso dessas clinicas e aplique a migration de novo.';
  end if;
end;
$ponto_de_partida$;

create function public.validar_dados_da_clinica()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_conferir_nome boolean;
  v_conferir_fuso boolean;
begin
  -- No INSERT, os dois; no UPDATE, so o que mudou: uma linha antiga fora da
  -- regra nao impede atualizar outra coluna (nem o outro dos dois).
  if tg_op = 'INSERT' then
    v_conferir_nome := true;
    v_conferir_fuso := true;
  else
    v_conferir_nome := new.name is distinct from old.name;
    v_conferir_fuso := new.timezone is distinct from old.timezone;
  end if;

  -- O nome precisa de um caractere que nao seja branco. Os brancos sao
  -- exatamente os que o .trim() do JavaScript tira (o Zod da tela usa
  -- .trim()), numa lista explicita: tab, quebra de linha, tab vertical,
  -- avanco de pagina, retorno, espaco, U+00A0 (o espaco nao separavel),
  -- U+1680, U+2000 a U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 e
  -- U+FEFF. Nao depende de \s nem de [[:space:]], que mudam com a colacao.
  if v_conferir_nome
     and (new.name is null
          or new.name !~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
  then
    raise exception using errcode = '23514', message = 'nome_da_clinica_vazio',
      hint = 'O nome da clínica não pode ficar vazio.';
  end if;

  -- O fuso, pela regra do comeco desta parte: o formato (digito ou + so nos
  -- Etc/GMT da tabela), fora de posix/ e right/, e o Postgres reconhece (o
  -- "at time zone" do painel). O DETAIL diz o motivo, nunca o valor.
  if v_conferir_fuso then
    if new.timezone is null
       or new.timezone !~ '^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
       or (new.timezone ~ '[0-9+]'
           and new.timezone !~ '^Etc/GMT(0|[+-]0|[+]([1-9]|1[0-2])|-([1-9]|1[0-4]))$')
    then
      raise exception using errcode = '23514', message = 'fuso_invalido',
        detail = 'O fuso não é um nome IANA de região (Área/Lugar) nem UTC.',
        hint = 'Use um fuso horário IANA, como America/Fortaleza.';
    end if;
    if new.timezone ~* '^(posix|right)/' then
      raise exception using errcode = '23514', message = 'fuso_invalido',
        detail = 'O fuso é de um diretório do sistema (posix/ ou right/), que a tela não reconhece.',
        hint = 'Use um fuso horário IANA, como America/Fortaleza.';
    end if;
    begin
      perform pg_catalog.timezone(new.timezone, pg_catalog.now());
    exception when invalid_parameter_value then
      raise exception using errcode = '23514', message = 'fuso_invalido',
        detail = 'O Postgres não reconhece o fuso.',
        hint = 'Use um fuso horário IANA, como America/Fortaleza.';
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.validar_dados_da_clinica()
  from public, anon, authenticated;

comment on function public.validar_dados_da_clinica() is
  'Gatilho BEFORE INSERT OR UPDATE OF name, timezone em clinic (Painel geral, terceira leva, 26/10/2026; decisao do dono: o banco recusa nome vazio e fuso inexistente). 23514 nome_da_clinica_vazio: o nome nulo ou so com os brancos que o .trim() do JavaScript tira (lista explicita). 23514 fuso_invalido, com o motivo no DETAIL: fora do formato ^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$ (nome IANA de regiao com barra, ou UTC; digito ou + so nos Etc/GMT da tabela, porque o Postgres le o resto como especificacao POSIX), de um diretorio do sistema (posix/ ou right/, sem caixa) ou que o Postgres nao reconhece (pg_catalog.timezone, o at time zone do painel). No INSERT confere os dois; no UPDATE, so o que mudou. Custo: microssegundos (nenhuma leitura de lista).';

create trigger validar_dados_da_clinica
  before insert or update of name, timezone on public.clinic
  for each row execute function public.validar_dados_da_clinica();
