-- ---------------------------------------------------------------------------
-- Painel geral, segunda leva do acompanhamento de cliente (CS)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 26/10/2026, depois de ver o painel de CS no ar (commit
-- 681d8e7, migration 20261026100000 aplicada): "Esse gasto de IA ta certo?
-- Era bom fazer por clinica. Alem disso revise para entender se falta mais
-- algo que era necessario estar ai que seria de boas praticas". O gasto
-- estava certo e arredondado: o mes teve 7 chamadas da IA (Conduzza Teste,
-- 20/10) que custaram US$ 0,001 (1000 microdolares), e o cartao, em
-- centavos, mostrava US$ 0,00. O dono escolheu fazer agora, alem do gasto
-- por clinica: sinais de alerta e saude; implantacao e tendencia; notas
-- internas e historico da conta; exportar a lista e ordenar por coluna. NAO
-- escolheu valor entregue nem contato do administrador.
--
-- O QUE MUDA (desenho do coordenador de 26/10/2026, seguido; o que e regra
-- nova esta marcado AJUSTAVEL, com o lugar onde se ajusta):
-- 1. painel_cs_das_clinicas: create or replace com TODAS as chaves de hoje,
--    com os mesmos valores (o ensaio compara as duas versoes, clinica a
--    clinica, sem e com as de teste), e as novas: o gasto em microdolares e
--    as chamadas; os sinais de alerta e a saude; a implantacao; a
--    tendencia; a data da ultima nota. Nos totais: o gasto do mes em
--    microdolares, as chamadas do mes e a contagem por saude. O codigo
--    publicado hoje le so as chaves que conhece (lib/queries/painel-geral.ts
--    ignora as outras) e continua igual entre a migration e o deploy.
-- 2. nota_interna_da_clinica: tabela nova, as notas da equipe Conduzza por
--    clinica. RLS ligada; so o super admin le (policy de SELECT com
--    is_product_admin(); nenhuma policy para os outros papeis); ninguem
--    escreve direto (sem INSERT, UPDATE e DELETE para authenticated): so
--    pelas funcoes 4 e 5.
-- 3. notas_da_clinica_no_painel(p_clinic_id, p_limite): a secao "Notas da
--    equipe Conduzza" do detalhe.
-- 4. escrever_nota_da_clinica(p_clinic_id, p_texto) e
-- 5. excluir_nota_da_clinica(p_nota_id): escrever e excluir a PROPRIA nota,
--    com trilha em audit_log (sem o texto).
-- 6. historico_da_clinica_no_painel(p_clinic_id, p_limite): o historico da
--    conta no detalhe, lido do audit_log.
-- 7. audit_log, A TRILHA DA CONTA (revisao de 26/10/2026): duas policies
--    RESTRITIVAS (somam-se as que ja existem com AND; nenhuma muda).
--    (a) "ninguem grava as acoes da conta pela sessao": as oito acoes do
--    historico (abaixo, em HISTORICO) so entram pelas funcoes SECURITY
--    DEFINER de sempre (donas postgres, que passam da RLS), pela service
--    role e pelo SQL editor. A policy de insert que ja existe ("membro ativo
--    registra a propria acao na trilha") deixava qualquer membro ativo da
--    clinica (o papel leitura inclusive) gravar uma delas com o motivo e o
--    created_at que quisesse: o evento forjado aparecia no historico da
--    equipe Conduzza, e um detalhe fora do formato derrubava o cartao.
--    (b) "so a equipe Conduzza le a trilha das notas internas": a policy de
--    leitura que ja existe ("admin e gestor leem a trilha") mostrava ao
--    administrador e ao gestor da clinica as linhas escreveu_nota_interna e
--    excluiu_nota_interna (quando, quantas e quem escreveu), e a tela diz
--    que a equipe da clinica nao ve as notas. As outras acoes da trilha
--    continuam como estao para eles.
--    E o PONTO DE PARTIDA: com audit_log travada pelas duas policies, a
--    migration confere que nenhuma linha das oito acoes, numa clinica real,
--    foi gravada por quem nao e da equipe Conduzza (abaixo, em LOCKS).
-- A EXPORTACAO da lista nao precisa de nada novo no banco: a trilha (action
-- 'exportou', entity 'painel_geral', entity_id nulo, clinic_id NULO, com a
-- quantidade de linhas e o resumo dos filtros em detalhes, nunca dado de
-- paciente nem o texto da busca) passa pela policy de insert de audit_log
-- que ja existe ("membro ativo registra a propria acao na trilha": user_id =
-- auth.uid() e, com clinic_id nulo, is_product_admin()), pela SESSAO do
-- super admin, como a exportacao de leads. A ORDENACAO por coluna e da
-- tela: toda coluna ordenavel (ultimo acesso, saude, IA no mes, leads,
-- conversas, implantacao) ja vem em cada linha.
--
-- As cinco funcoes: SECURITY DEFINER, search_path vazio, a guarda de
-- painel_geral_das_clinicas (so a equipe Conduzza, is_product_admin(), a
-- service role e o SQL editor; 42501 para os outros, anon inclusive, antes
-- de ler qualquer coisa). As tres de leitura sao STABLE. EXECUTE so para
-- authenticated e service_role.
--
-- REGRAS ("AJUSTAVEL" e regra nova, que o dono pode trocar; "decisao do
-- banco" e o que nem o desenho nem o dono diziam):
--   - GASTO (A): os microdolares sao a soma exata de ia_uso.custo_microdolar
--     (US$ 1 = 1.000.000), nas mesmas janelas e com as mesmas linhas dos
--     centavos de hoje (com as reservas, como o teto conta; com e sem o
--     simulador). CHAMADAS: as linhas REAIS de ia_uso (reserva falso), cada
--     uma uma chamada ao modelo (agente, verificador ou classificador); a
--     reserva e o custo maximo guardado antes da chamada e sai no acerto, nao
--     e chamada (decisao do banco). Na producao em 26/10/2026: 7 chamadas
--     reais no mes (3 do agente, 3 do classificador e 1 do verificador), 1000
--     microdolares, nenhuma reserva.
--   - SINAIS DE ALERTA (B), nesta ordem, cada um so quando vale:
--       conta_suspensa          a conta esta suspensa (clinica_suspensa)
--       sem_uso                 em_uso falso: ninguem com vinculo ativo teve
--                               atividade nos ultimos 30 dias (a regra de
--                               uso de 20261026100000, sem mudanca)
--       whatsapp_desconectado   tem numero (sem os removidos) e nenhum com
--                               connection_status 'conectado'
--       sem_numero_de_whatsapp  nenhum numero (sem os removidos)
--       pedido_de_entrada_esperando  vinculo pendente criado ha MAIS de 2
--                               dias (clinic_member.created_at < gerado_em
--                               menos 2 dias; o pedido so nasce por insert,
--                               no cadastro com o codigo; a equipe Conduzza
--                               pendente conta, como nas contagens).
--                               AJUSTAVEL: o intervalo de 2 dias (desenho).
--       falhas_de_envio         mensagens de saida com delivery_status
--                               'falhou' criadas nos ultimos 7 dias
--                               (message.created_at >= gerado_em menos 7
--                               dias). AJUSTAVEL: a janela (desenho).
--       perto_do_teto_da_ia     o gasto das ultimas 24 horas em centavos
--                               ARREDONDADOS (com o simulador e as reservas,
--                               como o cartao do detalhe) e 80% ou mais do
--                               teto diario: a regra que ja existe na tela
--                               (estadoDoGasto, PERTO_DO_TETO = 0.8), em
--                               conta inteira (gasto * 10 >= teto * 8); o
--                               teto atingido tambem acende (100% ou mais).
--                               Sem a linha de liberacao (sem teto), nunca.
--     Cada sinal: {chave, nivel, quantidade, desde} (o formato abaixo diz o
--     que quantidade e desde sao em cada um).
--   - SAUDE (C): em_risco com sem_uso, whatsapp_desconectado ou
--     conta_suspensa; atencao com qualquer outro sinal; saudavel sem sinal
--     nenhum. Nos totais, a contagem de cada uma (as tres somam clinicas).
--   - IMPLANTACAO (D), 6 passos, nesta ordem, cada um feito ou nao:
--       whatsapp_conectado          1 ou mais numeros conectados
--       equipe_com_duas_pessoas     2 ou mais vinculos ATIVOS (a equipe
--                                   Conduzza conta, como em membros_ativos:
--                                   a regra do dono para as contagens).
--                                   AJUSTAVEL: tirar a equipe Conduzza e
--                                   trocar membros_ativos por membros_ativos
--                                   menos membros_equipe_conduzza.
--       procedimentos_cadastrados   1 ou mais procedure com active (o
--                                   "service ativo" do desenho: o catalogo
--                                   de servicos da clinica e procedure)
--       profissionais_cadastrados   1 ou mais professional com active
--       regua_de_confirmacao_ligada 1 ou mais cadence kind 'confirmacao'
--                                   com active
--       anuncios_conectados         a Meta ligada OU o rastreio do Google
--                                   ligado. Meta ligada (decisao do banco,
--                                   AJUSTAVEL): meta_ads_account com a conta
--                                   de anuncios (ad_account_id) e o token de
--                                   leitura salvo (meta_ads_account_secret.
--                                   insights_access_token nao nulo; so o
--                                   "existe" e lido, nunca o token): a
--                                   leitura do investimento, a unica parte
--                                   da Meta que uma clinica liga hoje. O
--                                   envio de conversoes (envio_ativado) nao
--                                   entra: o embargo D6 (gatilho
--                                   conferir_token_antes_de_ligar_envio)
--                                   impede liga-lo enquanto a decisao de
--                                   privacidade nao sai; quando sair, pode
--                                   entrar aqui. Rastreio do Google ligado:
--                                   rastreio_do_site.ativo.
--   - TENDENCIA (E): leads (contact.first_contact_at) e conversas
--     (conversation.created_at) dos ultimos 30 dias (>= gerado_em menos 30
--     dias, as mesmas de leads_30_dias e conversas_30_dias) contra os 30
--     anteriores (>= gerado_em menos 60 dias e < gerado_em menos 30 dias).
--     variacao_percentual = round((atual - anterior) * 100 / anterior),
--     inteiro, nulo com o anterior zero. direcao: sem_base com o anterior
--     zero; estavel com a variacao (a arredondada, a que a tela mostra)
--     entre -9 e 9; subindo com 10 ou mais; caindo com -10 ou menos.
--     AJUSTAVEL: a faixa de 10% do estavel (decisao do banco; o desenho nao
--     dizia).
--   - ULTIMA NOTA (F): a criada_em mais recente das notas da clinica.
--   - NOTAS (F): texto de 1 a 2000 caracteres DEPOIS de tirar os espacos e
--     quebras de linha das pontas (o que fica gravado), com pelo menos um
--     caractere que nao e espaco; o autor e auth.uid() (nulo pela service
--     role ou pelo SQL editor); so quem escreveu exclui a nota (a service
--     role e o SQL editor, sem sessao, excluem qualquer uma: decisao do
--     banco). A tela avisa "Nao escreva dado de paciente aqui". A trilha
--     (escreveu_nota_interna, excluiu_nota_interna) leva so o id da nota
--     (e, na exclusao, quando foi escrita), nunca o texto.
--   - HISTORICO (G): as linhas de audit_log DA clinica (clinic_id = a
--     clinica) com estas acoes, AJUSTAVEL: suspendeu_clinica,
--     reativou_clinica, mudou_agente_da_clinica (liberar, retirar, a
--     producao e a volta ao teste pela revogacao de um requisito: o estado
--     diz qual), mudou_teto_da_ia, registrou_requisito_da_producao,
--     revogou_requisito_da_producao, escreveu_nota_interna e
--     excluiu_nota_interna. Os requisitos registrados para TODAS as
--     clinicas (clinic_id nulo) nao entram no historico de cada uma
--     (decisao do banco). Dos detalhes, so as chaves conhecidas de cada
--     acao (abaixo), nunca o objeto inteiro. Do mais novo para o mais
--     antigo; p_limite (padrao 100, de 1 a 500) eventos e tem_mais. Desde a
--     revisao de 26/10/2026, so as funcoes gravam essas acoes (item 7), e
--     cada valor dos detalhes sai so no formato dele: numero so como
--     inteiro de 0 ao maior bigint, a data da nota so como data de 0001 a
--     9999; fora disso (texto, fracao, negativo, grande demais, "ontem",
--     "infinity"), nulo. Uma linha estranha (do SQL editor) nunca derruba o
--     historico. O autor nao e filtrado (decisao do banco): o evento de
--     quem saiu da equipe Conduzza continua, com equipe_conduzza falso; a
--     escrita fechada e o ponto de partida conferido bastam.
--
-- SEM DADO DE PACIENTE: de paciente, so contagens (leads, conversas e
-- mensagens com falha). Nome e e-mail sao da EQUIPE (da clinica ou
-- Conduzza). O texto das notas e o motivo dos eventos sao da equipe
-- Conduzza. Das mensagens, so a contagem das que falharam e a data da mais
-- antiga (nem texto, nem contato, nem conversa). Nada vai para log ou
-- mensagem de erro; as de leitura nao gravam nada.
--
-- Producao em 26/10/2026 (q.js, so leitura, so contagens): 57 clinicas, 51
-- e_de_teste; nas reais, nenhuma conta da Meta nem rastreio do Google
-- (as 13 contas da Meta sao de clinicas de teste), 0 mensagens com falha
-- de 2.810 de saida nos ultimos 7 dias, nenhum pendente; audit_log sem
-- nenhuma linha das acoes do historico (as das suites somem com as
-- clinicas de teste). Indices que as leituras novas usam, todos ja na
-- producao: message_clinic_created_idx (clinic_id, created_at),
-- contact_clinic_first_contact_idx, conversation_clinic_created_idx,
-- ia_uso_clinica_dia_idx, audit_log_clinic_id_created_at_idx
-- (clinic_id, created_at desc), procedure_clinic_id_idx,
-- professional_clinic_id_idx e cadence_clinic_id_idx (where active).
-- As falhas de envio sao lidas clinica a clinica (LATERAL), pelo indice de
-- (clinic_id, created_at), em qualquer versao do Postgres (EXPLAIN no
-- Postgres local com 300 mil mensagens: uma leitura de indice por clinica,
-- menos de 1 ms cada).
-- LIMITE CONHECIDO: o historico filtra as oito acoes dentro da trilha da
-- clinica (pelo indice de (clinic_id, created_at) ou numa leitura
-- sequencial, o que o planejador achar melhor); a trilha de uma clinica
-- tem muita leitura de dado de paciente (as linhas "leu"). No Postgres
-- local, 100 mil linhas de trilha numa clinica (1 em 500 das oito acoes):
-- de 7 a 50 ms nas rodadas de 26/10/2026 (o plano muda com a estatistica,
-- igual antes e depois da revisao). Se ficar lento, um indice parcial nas
-- oito acoes (CREATE INDEX CONCURRENTLY, fora de transacao) resolve sem
-- mudar a funcao.
--
-- ORDEM DE PUBLICACAO: esta migration ANTES do codigo novo (ele le as
-- chaves novas e chama as funcoes novas, sem caminho sem elas). O codigo de
-- hoje continua igual com ela aplicada (le so as chaves que conhece e nao
-- chama as funcoes novas).
--
-- LOCKS: a tabela nova (CREATE TABLE com a FK para clinic: SHARE ROW
-- EXCLUSIVE em clinic ate o fim da transacao, que e curta, sem ALTER
-- nenhum em clinic), o indice dela, a policy, os grants e as funcoes (so
-- catalogo). No FIM, as duas policies de audit_log (item 7): CREATE POLICY
-- pega ACCESS EXCLUSIVE em audit_log ate o commit, que vem logo depois (a
-- conferencia do ponto de partida, milissegundos): nesse meio tempo
-- ninguem le nem grava a trilha (na producao, em 26/10/2026, cerca de 50
-- linhas por dia). Nenhum ALTER TABLE em lugar nenhum (zero ALTER em
-- message, conversation, contact, clinic_member, job_queue, clinic e
-- audit_log). lock_timeout de 3 s: com clinic ou audit_log ocupada, a
-- migration falha inteira e roda de novo.
-- PONTO DE PARTIDA: depois das duas policies, com audit_log travada (nada
-- entra entre a conferencia e o commit), a migration confere que nenhuma
-- linha das oito acoes do historico, numa clinica real (sem as e_de_teste,
-- que as suites gravam com super admins sinteticos e apagam), tem user_id
-- de quem nao e da equipe Conduzza hoje (user_id nulo e a service role ou
-- o SQL editor). Na producao, em 26/10/2026, nenhuma linha das oito acoes
-- (q.js). Achou: a migration falha inteira (P0001
-- trilha_da_conta_com_linha_de_fora) e e preciso olhar essas linhas antes
-- de aplicar de novo; o historico nunca mostra uma linha forjada antes do
-- item 7.
--
-- ROLLBACK (manual), ORDEM: PRIMEIRO voltar o codigo, DEPOIS, numa
-- transacao, no SQL editor, o arquivo
-- supabase/operacao/rollback/20261026110000-corpos-anteriores.sql: saem as
-- quatro funcoes novas, a tabela de notas (AS NOTAS ESCRITAS SE PERDEM; o
-- arquivo diz como guardar antes) e as duas policies de audit_log (a trilha
-- volta a ser a de antes), e painel_cs_das_clinicas volta ao corpo e ao
-- comentario de 26/10/2026 (md5(prosrc) 093d9103c89c0f78e7ff77be10b663ad,
-- conferido no fim do arquivo).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) As notas internas da equipe Conduzza
-- ---------------------------------------------------------------------------

create table public.nota_interna_da_clinica (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinic (id) on delete cascade,
  autor_user_id uuid,
  texto text not null
    constraint nota_interna_da_clinica_texto_valido
      check (char_length(texto) <= 2000 and texto ~ '\S'),
  criada_em timestamptz not null default now()
);

-- A lista do detalhe (as mais novas primeiro) e a ultima nota da lista do
-- painel; tambem serve a cascata da clinica.
create index nota_interna_da_clinica_clinica_idx
  on public.nota_interna_da_clinica (clinic_id, criada_em desc);

alter table public.nota_interna_da_clinica enable row level security;

revoke all on table public.nota_interna_da_clinica from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.nota_interna_da_clinica from authenticated;

create policy "super admin le as notas internas"
  on public.nota_interna_da_clinica
  for select to authenticated
  using (public.is_product_admin());

comment on table public.nota_interna_da_clinica is
  'Notas internas da equipe Conduzza por clinica (Painel geral, 26/10/2026). So o super admin le (policy de SELECT com is_product_admin(); nenhuma policy para os papeis da clinica); escrita so por escrever_nota_da_clinica e excluir_nota_da_clinica, com trilha (sem o texto). Nunca dado de paciente: a tela avisa.';
comment on column public.nota_interna_da_clinica.autor_user_id is
  'auth.uid() de quem escreveu (nulo pela service role ou pelo SQL editor). So ele exclui a nota pela sessao.';
comment on column public.nota_interna_da_clinica.texto is
  'Texto da equipe Conduzza, de 1 a 2000 caracteres, sem espacos nas pontas (a funcao tira). Nunca dado de paciente.';

-- ---------------------------------------------------------------------------
-- 2) A lista e os cartoes do topo, com a segunda leva
-- ---------------------------------------------------------------------------
-- FORMATO EXATO do jsonb devolvido (toda chave sempre presente; null so onde
-- esta escrito; timestamptz em texto ISO 8601 com o deslocamento; contagens,
-- centavos e microdolares sao inteiros, nunca negativos). "NOVO" marca o
-- que esta migration acrescenta; o resto e o de 20261026100000, sem mudanca.
-- {
--   "gerado_em": timestamptz,           now() da leitura; todas as janelas contam daqui
--   "totais": {
--     "clinicas": int,                  linhas de "clinicas" (sem as e_de_teste; com p_incluir_teste, todas)
--     "em_uso": int,                    linhas com "em_uso" verdadeiro
--     "sem_uso": int,                   clinicas menos em_uso
--     "suspensas": int,                 linhas com "suspensao" (independe do uso)
--     "agente_liberado": int,           linhas com agente.estado teste ou producao
--     "gasto_mes_centavos_usd": int,    mes corrente de todas, em centavos de dolar (arredonda a soma)
--     "gasto_mes_microdolares": int,    NOVO: o mesmo gasto, exato, em microdolares (US$ 1 = 1.000.000)
--     "chamadas_mes": int,              NOVO: soma de gasto.mes_chamadas das linhas
--     "saude": {                        NOVO: as tres somam "clinicas"
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
--         "ultimas_24h_microdolares": int,                  NOVO: os mesmos quatro, exatos, em microdolares
--         "mes_microdolares": int,                          NOVO
--         "ultimas_24h_sem_simulador_microdolares": int,    NOVO
--         "mes_sem_simulador_microdolares": int,            NOVO
--         "ultimas_24h_chamadas": int,                      NOVO: linhas reais de ia_uso (sem as reservas), com o simulador
--         "mes_chamadas": int,                              NOVO
--         "ultimas_24h_sem_simulador_chamadas": int,        NOVO
--         "mes_sem_simulador_chamadas": int                 NOVO
--       },
--       "teto_diario_centavos_usd": int | null,  null sem a linha de liberacao
--       "saude": text,                  NOVO: saudavel, atencao ou em_risco
--       "sinais": [                     NOVO: so os que valem, nesta ordem: conta_suspensa, sem_uso, whatsapp_desconectado,
--                                       sem_numero_de_whatsapp, pedido_de_entrada_esperando, falhas_de_envio, perto_do_teto_da_ia
--         {
--           "chave": text,              uma das sete acima
--           "nivel": text,              em_risco (conta_suspensa, sem_uso, whatsapp_desconectado) ou atencao (as outras)
--           "quantidade": int | null,   whatsapp_desconectado: numeros (todos sem conexao); pedido_de_entrada_esperando: pedidos
--                                       ha mais de 2 dias; falhas_de_envio: mensagens com falha nos 7 dias; perto_do_teto_da_ia:
--                                       o percentual do teto ja gasto nas 24 horas (inteiro, para baixo; 100 ou mais = atingido);
--                                       null nas outras
--           "desde": timestamptz | null conta_suspensa: suspensa_em; sem_uso: ultimo_acesso.em (null: nunca entrou);
--                                       whatsapp_desconectado: a desconexao mais recente (whatsapp_account.disconnected_at; null
--                                       sem registro); pedido_de_entrada_esperando: o pedido mais antigo; falhas_de_envio: a
--                                       falha mais antiga dos 7 dias; null nas outras
--         }
--       ],
--       "implantacao": {                NOVO
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
--       "tendencia": {                  NOVO
--         "leads": tendencia,           contact.first_contact_at
--         "conversas": tendencia        conversation.created_at
--       },
--       "ultima_nota_em": timestamptz | null   NOVO: a nota interna mais recente; null sem nota
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
$$;

revoke all on function public.painel_cs_das_clinicas(boolean) from public, anon;
grant execute on function public.painel_cs_das_clinicas(boolean)
  to authenticated, service_role;

comment on function public.painel_cs_das_clinicas(boolean) is
  'Painel geral como acompanhamento de cliente (CS, 26/10/2026; segunda leva na migration 20261026110000_painel_cs_2.sql), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros). SO CONTAGENS de paciente; nome e e-mail so da equipe da clinica. Clinicas e_de_teste so com p_incluir_teste. Ultimo acesso = a ultima atividade (o maior entre auth.users.last_sign_in_at e a ultima renovacao das sessoes em auth.sessions) dos vinculos ATIVOS, a equipe Conduzza inclusive e marcada; em uso = ultimo acesso nos ultimos 30 dias. Formato exato no comentario das migrations 20261026100000_painel_cs.sql e 20261026110000_painel_cs_2.sql: {"gerado_em", "totais": {"clinicas", "em_uso", "sem_uso", "suspensas", "agente_liberado", "gasto_mes_centavos_usd", "gasto_mes_microdolares", "chamadas_mes", "saude": {"saudavel", "atencao", "em_risco"}}, "clinicas": [{"id", "nome", "criada_em", "fuso", "em_uso", "ultimo_acesso", "membros_ativos", "membros_pendentes", "membros_equipe_conduzza", "pessoas", "numeros_total", "numeros_conectados", "numeros", "contatos", "leads_30_dias", "conversas_30_dias", "ultima_mensagem_em", "suspensao", "agente", "gasto": {os quatro em centavos, os quatro em microdolares e as quatro contagens de chamadas}, "teto_diario_centavos_usd", "saude", "sinais": [{"chave", "nivel", "quantidade", "desde"}], "implantacao": {"feitos", "total", "passos": [{"chave", "feito", "quantidade"}], "anuncios": {"meta", "google"}}, "tendencia": {"leads", "conversas"}, "ultima_nota_em"}] (ultimo acesso mais recente primeiro, sem acesso no fim)}.';

-- ---------------------------------------------------------------------------
-- 3) As notas da clinica, no detalhe
-- ---------------------------------------------------------------------------
-- FORMATO EXATO do jsonb devolvido: null (jsonb nulo) quando a clinica nao
-- existe; senao (toda chave sempre presente; null so onde esta escrito):
-- {
--   "clinic_id": uuid,
--   "gerado_em": timestamptz,           now() da leitura
--   "tem_mais": boolean,                ha notas alem das p_limite devolvidas
--   "notas": [                          as p_limite mais novas: criada_em mais recente primeiro, depois id (desc)
--     {
--       "id": uuid,
--       "texto": text,                  1 a 2000 caracteres, como foi gravado (sem espacos nas pontas)
--       "criada_em": timestamptz,
--       "autor": null | {               null: escrita pela service role ou pelo SQL editor
--         "user_id": uuid,
--         "nome": text | null,          profile.name
--         "email": text | null,         auth.users.email
--         "equipe_conduzza": boolean    o autor ainda e da equipe Conduzza (product_admin)
--       },
--       "minha": boolean                o autor e quem le (auth.uid()): so ela exclui pela sessao
--     }
--   ]
-- }
-- p_limite: padrao 100 (nulo tambem), de 1 a 500 (fora: 22023
-- limite_invalido). p_clinic_id nulo: 22004. Clinica e_de_teste tambem
-- responde.

create function public.notas_da_clinica_no_painel(p_clinic_id uuid, p_limite integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 100);
  v_notas jsonb;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor (a
  -- guarda de painel_geral_das_clinicas), antes de ler qualquer coisa.
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
  if v_limite not between 1 and 500 then
    raise exception using errcode = '22023', message = 'limite_invalido',
      hint = 'O limite vai de 1 a 500.';
  end if;

  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    return null;
  end if;

  -- Texto e autor sao da equipe Conduzza; nada de paciente.
  with lidas as (
    select n.id,
           n.texto,
           n.criada_em,
           n.autor_user_id,
           row_number() over (order by n.criada_em desc, n.id desc) as ordem
      from public.nota_interna_da_clinica n
     where n.clinic_id = p_clinic_id
  )
  select jsonb_build_object(
           'clinic_id', p_clinic_id,
           'gerado_em', now(),
           'tem_mais', coalesce(bool_or(o.ordem > v_limite), false),
           'notas', coalesce(
             jsonb_agg(jsonb_build_object(
                 'id', o.id,
                 'texto', o.texto,
                 'criada_em', o.criada_em,
                 'autor', case when o.autor_user_id is not null then
                   jsonb_build_object(
                     'user_id', o.autor_user_id,
                     'nome', nullif(btrim(p.name), ''),
                     'email', nullif(btrim(u.email), ''),
                     'equipe_conduzza', a.user_id is not null)
                 end,
                 'minha', o.autor_user_id is not distinct from auth.uid()
                          and o.autor_user_id is not null)
               order by o.criada_em desc, o.id desc)
               filter (where o.ordem <= v_limite),
             '[]'::jsonb))
    into v_notas
    from lidas o
    left join public.profile p on p.user_id = o.autor_user_id
    left join auth.users u on u.id = o.autor_user_id
    left join public.product_admin a on a.user_id = o.autor_user_id
   where o.ordem <= v_limite + 1;

  return v_notas;
end;
$$;

revoke all on function public.notas_da_clinica_no_painel(uuid, integer) from public, anon;
grant execute on function public.notas_da_clinica_no_painel(uuid, integer)
  to authenticated, service_role;

comment on function public.notas_da_clinica_no_painel(uuid, integer) is
  'As notas internas da equipe Conduzza de uma clinica, no detalhe do Painel geral (26/10/2026), so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros; 22004 sem a clinica; 22023 limite_invalido fora de 1 a 500). Null quando a clinica nao existe. Formato exato no comentario da migration 20261026110000_painel_cs_2.sql: {"clinic_id", "gerado_em", "tem_mais", "notas": [{"id", "texto", "criada_em", "autor": null ou {"user_id", "nome", "email", "equipe_conduzza"}, "minha"}]} (as p_limite mais novas primeiro).';

-- ---------------------------------------------------------------------------
-- 4) Escrever uma nota
-- ---------------------------------------------------------------------------
-- Devolve o id da nota. Codigos: 42501 (quem nao e da equipe Conduzza,
-- antes de tudo); 22004 (clinica ou texto nulos); 22023 texto_invalido
-- (vazio ou so espacos, ou mais de 2000 caracteres depois de tirar os
-- espacos e quebras de linha das pontas); P0002 (a clinica nao existe).
-- Clinica suspensa ou e_de_teste: escreve (a nota e interna da equipe
-- Conduzza). Trilha: escreveu_nota_interna, entity nota_interna_da_clinica,
-- entity_id = a nota, sem detalhes (nunca o texto).

create function public.escrever_nota_da_clinica(p_clinic_id uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text;
  v_id uuid;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza escreve as notas da clínica.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza escreve as notas da clínica.';
  end if;

  if p_clinic_id is null or p_texto is null then
    raise exception using errcode = '22004', message = 'Informe a clínica e o texto da nota.';
  end if;
  -- Sem os espacos, tabulacoes e quebras de linha das pontas (btrim, em
  -- tempo linear); o tamanho antes do padrao, como o CHECK da tabela.
  v_texto := btrim(p_texto, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13));
  if char_length(v_texto) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'texto_invalido',
      hint = 'A nota tem de 1 a 2000 caracteres.';
  end if;
  if v_texto !~ '\S' then
    raise exception using errcode = '22023', message = 'texto_invalido',
      hint = 'A nota tem de 1 a 2000 caracteres.';
  end if;
  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    raise exception using errcode = 'P0002', message = 'Clínica não encontrada.';
  end if;

  insert into public.nota_interna_da_clinica (clinic_id, autor_user_id, texto)
  values (p_clinic_id, auth.uid(), v_texto)
  returning id into v_id;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id)
  values (p_clinic_id, auth.uid(), 'escreveu_nota_interna', 'nota_interna_da_clinica', v_id);

  return v_id;
end;
$$;

revoke all on function public.escrever_nota_da_clinica(uuid, text) from public, anon;
grant execute on function public.escrever_nota_da_clinica(uuid, text)
  to authenticated, service_role;

comment on function public.escrever_nota_da_clinica(uuid, text) is
  'Escreve uma nota interna da equipe Conduzza na clinica (Painel geral, 26/10/2026) e devolve o id. So super admin, service role e SQL editor (42501). O texto fica sem os espacos e quebras de linha das pontas e tem de 1 a 2000 caracteres (22023 texto_invalido); 22004 com clinica ou texto nulos; P0002 com a clinica que nao existe. Autor = auth.uid() (nulo sem sessao). Trilha escreveu_nota_interna, sem o texto. Nunca dado de paciente: a tela avisa.';

-- ---------------------------------------------------------------------------
-- 5) Excluir a propria nota
-- ---------------------------------------------------------------------------
-- Codigos: 42501 (quem nao e da equipe Conduzza, antes de tudo; e a nota
-- de outra pessoa: message nota_de_outra_pessoa); 22004 (nota nula); P0002
-- (a nota nao existe, ou ja foi excluida). Pela sessao, so quem escreveu
-- exclui; a service role e o SQL editor (sem sessao) excluem qualquer uma.
-- A linha da nota e travada (FOR UPDATE) antes de conferir o autor. Trilha:
-- excluiu_nota_interna, entity_id = a nota, detalhes so com escrita_em
-- (quando foi escrita), nunca o texto.

create function public.excluir_nota_da_clinica(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinica uuid;
  v_autor uuid;
  v_criada_em timestamptz;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor.
  if auth.uid() is null then
    if coalesce(auth.role(), 'service_role') <> 'service_role' then
      raise exception using errcode = '42501',
        message = 'Somente a equipe do Conduzza exclui as notas da clínica.';
    end if;
  elsif not public.is_product_admin() then
    raise exception using errcode = '42501',
      message = 'Somente a equipe do Conduzza exclui as notas da clínica.';
  end if;

  if p_nota_id is null then
    raise exception using errcode = '22004', message = 'Informe a nota.';
  end if;

  select n.clinic_id, n.autor_user_id, n.criada_em
    into v_clinica, v_autor, v_criada_em
    from public.nota_interna_da_clinica n
   where n.id = p_nota_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Nota não encontrada.';
  end if;

  if auth.uid() is not null and v_autor is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'nota_de_outra_pessoa',
      hint = 'Só quem escreveu a nota pode excluir.';
  end if;

  delete from public.nota_interna_da_clinica n where n.id = p_nota_id;

  insert into public.audit_log (clinic_id, user_id, action, entity, entity_id, detalhes)
  values (v_clinica, auth.uid(), 'excluiu_nota_interna', 'nota_interna_da_clinica', p_nota_id,
          jsonb_build_object('escrita_em', v_criada_em));
end;
$$;

revoke all on function public.excluir_nota_da_clinica(uuid) from public, anon;
grant execute on function public.excluir_nota_da_clinica(uuid)
  to authenticated, service_role;

comment on function public.excluir_nota_da_clinica(uuid) is
  'Exclui uma nota interna da equipe Conduzza (Painel geral, 26/10/2026). Pela sessao, so quem escreveu (42501 nota_de_outra_pessoa); a service role e o SQL editor excluem qualquer uma. 42501 para quem nao e da equipe Conduzza; 22004 com a nota nula; P0002 com a nota que nao existe. Trilha excluiu_nota_interna (so quando foi escrita), sem o texto.';

-- ---------------------------------------------------------------------------
-- 6) O historico da conta, no detalhe
-- ---------------------------------------------------------------------------
-- FORMATO EXATO do jsonb devolvido: null (jsonb nulo) quando a clinica nao
-- existe; senao (toda chave sempre presente; null so onde esta escrito):
-- {
--   "clinic_id": uuid,
--   "gerado_em": timestamptz,           now() da leitura
--   "tem_mais": boolean,                ha eventos alem dos p_limite devolvidos
--   "eventos": [                        os p_limite mais novos: created_at mais recente primeiro, depois audit_log.id (desc)
--     {
--       "id": int,                      audit_log.id
--       "em": timestamptz,              audit_log.created_at
--       "acao": text,                   suspendeu_clinica, reativou_clinica, mudou_agente_da_clinica, mudou_teto_da_ia,
--                                       registrou_requisito_da_producao, revogou_requisito_da_producao,
--                                       escreveu_nota_interna ou excluiu_nota_interna
--       "quem": null | {                null: a service role ou o SQL editor
--         "user_id": uuid,
--         "nome": text | null,          profile.name
--         "email": text | null,         auth.users.email
--         "equipe_conduzza": boolean    a pessoa e da equipe Conduzza (product_admin) hoje
--       },
--       "detalhes": {                   so estas chaves, sempre presentes; null quando a acao nao tem
--         "estado": text | null,                       mudou_agente_da_clinica: desligado, teste ou producao
--         "motivo": text | null,                       suspendeu, reativou, mudou_agente e revogou_requisito (texto da equipe Conduzza)
--         "chave": text | null,                        registrou e revogou_requisito: o requisito
--         "substituiu": boolean | null,                registrou_requisito: substituiu um registro vivo
--         "teto_diario_centavos_usd": int | null,      mudou_teto_da_ia: o teto novo
--         "teto_respostas_por_conversa_hora": int | null,
--         "teto_diario_antes_centavos_usd": int | null,          mudou_teto_da_ia: o de antes
--         "teto_respostas_antes_por_conversa_hora": int | null,
--         "jobs_vencidos": int | null,                 reativou_clinica
--         "clinicas_de_volta_ao_teste": int | null,    revogou_requisito
--         "nota_escrita_em": timestamptz | null        excluiu_nota_interna: quando a nota foi escrita
--       }
--     }
--   ]
-- }
-- So as linhas DA clinica (audit_log.clinic_id = p_clinic_id): os
-- requisitos registrados para todas as clinicas nao entram. Nenhuma outra
-- chave de detalhes sai (o objeto inteiro nunca). Cada int dos detalhes e
-- um inteiro de 0 a 9223372036854775807 e nota_escrita_em uma data de 0001
-- a 9999; o valor gravado fora disso sai null (revisao de 26/10/2026: a
-- linha estranha nunca derruba a leitura). p_limite: padrao 100 (nulo
-- tambem), de 1 a 500 (fora: 22023 limite_invalido). p_clinic_id nulo:
-- 22004. Clinica e_de_teste tambem responde.

create function public.historico_da_clinica_no_painel(p_clinic_id uuid, p_limite integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 100);
  v_historico jsonb;
begin
  -- So a equipe Conduzza (super admin), a service role e o SQL editor (a
  -- guarda de painel_geral_das_clinicas), antes de ler qualquer coisa.
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
  if v_limite not between 1 and 500 then
    raise exception using errcode = '22023', message = 'limite_invalido',
      hint = 'O limite vai de 1 a 500.';
  end if;

  if not exists (select 1 from public.clinic c where c.id = p_clinic_id) then
    return null;
  end if;

  -- So as acoes da conta e, dos detalhes, so as chaves conhecidas de cada
  -- uma: nenhum dado de paciente. Cada valor sai so no formato dele (os
  -- numeros em n.inteiros, a data da nota em d.escrita_em); fora disso,
  -- nulo: uma linha estranha nunca derruba o historico.
  with eventos as (
    select a.id,
           a.created_at,
           a.action,
           a.user_id,
           a.detalhes
      from public.audit_log a
     where a.clinic_id = p_clinic_id
       and a.action in ('suspendeu_clinica', 'reativou_clinica', 'mudou_agente_da_clinica',
                        'mudou_teto_da_ia', 'registrou_requisito_da_producao',
                        'revogou_requisito_da_producao', 'escreveu_nota_interna',
                        'excluiu_nota_interna')
     order by a.created_at desc, a.id desc
     limit v_limite + 1
  ),
  numerados as (
    select e.*,
           row_number() over (order by e.created_at desc, e.id desc) as ordem
      from eventos e
  )
  select jsonb_build_object(
           'clinic_id', p_clinic_id,
           'gerado_em', now(),
           'tem_mais', coalesce(bool_or(o.ordem > v_limite), false),
           'eventos', coalesce(
             jsonb_agg(jsonb_build_object(
                 'id', o.id,
                 'em', o.created_at,
                 'acao', o.action,
                 'quem', case when o.user_id is not null then
                   jsonb_build_object(
                     'user_id', o.user_id,
                     'nome', nullif(btrim(p.name), ''),
                     'email', nullif(btrim(u.email), ''),
                     'equipe_conduzza', pa.user_id is not null)
                 end,
                 'detalhes', jsonb_build_object(
                   'estado', case when jsonb_typeof(o.detalhes -> 'estado') = 'string'
                                  then o.detalhes ->> 'estado' end,
                   'motivo', case when jsonb_typeof(o.detalhes -> 'motivo') = 'string'
                                  then o.detalhes ->> 'motivo' end,
                   'chave', case when jsonb_typeof(o.detalhes -> 'chave') = 'string'
                                 then o.detalhes ->> 'chave' end,
                   'substituiu', case when o.action = 'registrou_requisito_da_producao'
                                      then coalesce(jsonb_typeof(o.detalhes -> 'substituiu'), 'null') <> 'null' end,
                   'teto_diario_centavos_usd', n.inteiros -> 'teto_diario_centavos_usd',
                   'teto_respostas_por_conversa_hora', n.inteiros -> 'teto_respostas_por_conversa_hora',
                   'teto_diario_antes_centavos_usd', n.inteiros -> 'teto_diario_antes_centavos_usd',
                   'teto_respostas_antes_por_conversa_hora', n.inteiros -> 'teto_respostas_antes_por_conversa_hora',
                   'jobs_vencidos', n.inteiros -> 'jobs_vencidos',
                   'clinicas_de_volta_ao_teste', n.inteiros -> 'clinicas_de_volta_ao_teste',
                   'nota_escrita_em', d.escrita_em))
               order by o.created_at desc, o.id desc)
               filter (where o.ordem <= v_limite),
             '[]'::jsonb))
    into v_historico
    from numerados o
    -- Os numeros dos detalhes: so o inteiro de 0 ao maior bigint. O CASE de
    -- dentro so converte o que ja e numero; texto, fracao, negativo e
    -- grande demais saem nulos.
    cross join lateral (
      select jsonb_object_agg(c.chave,
               case when jsonb_typeof(c.valor) = 'number' then
                 case when c.valor::numeric between 0 and 9223372036854775807
                           and c.valor::numeric = trunc(c.valor::numeric)
                      then to_jsonb(c.valor::numeric::bigint)
                 end
               end) as inteiros
        from (values
          ('teto_diario_centavos_usd', o.detalhes -> 'teto_diario_centavos_usd'),
          ('teto_respostas_por_conversa_hora', o.detalhes -> 'teto_respostas_por_conversa_hora'),
          ('teto_diario_antes_centavos_usd', o.detalhes #> '{antes,teto_diario_centavos_usd}'),
          ('teto_respostas_antes_por_conversa_hora', o.detalhes #> '{antes,teto_respostas_por_conversa_hora}'),
          ('jobs_vencidos', o.detalhes -> 'jobs_vencidos'),
          ('clinicas_de_volta_ao_teste', o.detalhes -> 'clinicas_de_volta_ao_teste')
        ) as c(chave, valor)
    ) n
    -- A data da nota excluida: so o texto que e uma data de 0001 a 9999
    -- (nem "ontem", nem "infinity"); o CASE de dentro so converte o valido.
    cross join lateral (
      select case when o.action = 'excluiu_nota_interna'
                       and jsonb_typeof(o.detalhes -> 'escrita_em') = 'string'
                       and pg_input_is_valid(o.detalhes ->> 'escrita_em', 'timestamptz') then
               case when (o.detalhes ->> 'escrita_em')::timestamptz
                           between '0001-01-01 00:00:00+00' and '9999-12-31 23:59:59.999999+00'
                    then (o.detalhes ->> 'escrita_em')::timestamptz
               end
             end as escrita_em
    ) d
    left join public.profile p on p.user_id = o.user_id
    left join auth.users u on u.id = o.user_id
    left join public.product_admin pa on pa.user_id = o.user_id;

  return v_historico;
end;
$$;

revoke all on function public.historico_da_clinica_no_painel(uuid, integer) from public, anon;
grant execute on function public.historico_da_clinica_no_painel(uuid, integer)
  to authenticated, service_role;

comment on function public.historico_da_clinica_no_painel(uuid, integer) is
  'O historico da conta de uma clinica no detalhe do Painel geral (26/10/2026), lido do audit_log, so para a equipe Conduzza: super admin, service role e SQL editor (42501 para os outros; 22004 sem a clinica; 22023 limite_invalido fora de 1 a 500). Null quando a clinica nao existe. So as linhas da clinica com suspendeu_clinica, reativou_clinica, mudou_agente_da_clinica, mudou_teto_da_ia, registrou_requisito_da_producao, revogou_requisito_da_producao, escreveu_nota_interna e excluiu_nota_interna (so as funcoes gravam essas acoes: a policy restritiva "ninguem grava as acoes da conta pela sessao"); dos detalhes, so as chaves conhecidas, cada uma no formato dela (inteiro de 0 ao maior bigint, data de 0001 a 9999; fora disso, null). Formato exato no comentario da migration 20261026110000_painel_cs_2.sql: {"clinic_id", "gerado_em", "tem_mais", "eventos": [{"id", "em", "acao", "quem": null ou {"user_id", "nome", "email", "equipe_conduzza"}, "detalhes": {"estado", "motivo", "chave", "substituiu", "teto_diario_centavos_usd", "teto_respostas_por_conversa_hora", "teto_diario_antes_centavos_usd", "teto_respostas_antes_por_conversa_hora", "jobs_vencidos", "clinicas_de_volta_ao_teste", "nota_escrita_em"}}]} (os p_limite mais novos primeiro).';

-- ---------------------------------------------------------------------------
-- 7) A trilha da conta (revisao de 26/10/2026)
-- ---------------------------------------------------------------------------
-- Duas policies RESTRITIVAS em audit_log: cada uma soma-se as permissivas
-- que ja existem com AND, sem mudar nenhuma, e vale tambem para qualquer
-- permissiva que entrar depois. Ficam no FIM: o CREATE POLICY pega ACCESS
-- EXCLUSIVE em audit_log ate o commit, que vem logo depois.
--
-- (a) As oito acoes do historico so pelas funcoes. A permissiva "membro
-- ativo registra a propria acao na trilha" deixa todo membro ativo gravar
-- qualquer acao com o proprio user_id (e o motivo e o created_at que
-- quiser). Quem grava estas oito: suspender_clinica, reativar_clinica,
-- definir_agente_da_clinica (pelo painel ou na volta ao teste de
-- revogar_requisito_da_producao), definir_teto_da_ia,
-- registrar_requisito_da_producao, revogar_requisito_da_producao,
-- escrever_nota_da_clinica e excluir_nota_da_clinica: todas SECURITY
-- DEFINER, donas postgres (bypassrls), que nao passam por policy nenhuma; a
-- service role e o SQL editor tambem nao. Nenhuma tela grava estas acoes
-- pela sessao. A trilha da exportacao ('exportou') e as outras acoes
-- seguem como estao.
create policy "ninguem grava as acoes da conta pela sessao"
  on public.audit_log
  as restrictive
  for insert
  with check (action not in ('suspendeu_clinica', 'reativou_clinica', 'mudou_agente_da_clinica',
                             'mudou_teto_da_ia', 'registrou_requisito_da_producao',
                             'revogou_requisito_da_producao', 'escreveu_nota_interna',
                             'excluiu_nota_interna'));

-- (b) A trilha das notas internas so para a equipe Conduzza. A permissiva
-- "admin e gestor leem a trilha" mostra ao administrador e ao gestor as
-- linhas da clinica; esta esconde deles as duas das notas (o texto nunca vai
-- para a trilha, mas quando, quantas e quem escreveu tambem sao da equipe
-- Conduzza). O super admin le tudo, como antes; o historico (SECURITY
-- DEFINER) nao passa por aqui.
create policy "so a equipe Conduzza le a trilha das notas internas"
  on public.audit_log
  as restrictive
  for select
  using (action not in ('escreveu_nota_interna', 'excluiu_nota_interna')
         or public.is_product_admin());

-- O ponto de partida, com audit_log travada pelas duas policies acima (nada
-- entra entre esta conferencia e o commit): nenhuma linha das oito acoes,
-- numa clinica real, com user_id de quem nao e da equipe Conduzza hoje. As
-- clinicas e_de_teste ficam de fora (as suites gravam nelas com super
-- admins sinteticos, que saem antes das clinicas). Na producao, em
-- 26/10/2026, nenhuma linha das oito acoes (q.js). Achou: a migration falha
-- inteira; olhar essas linhas antes de aplicar de novo.
do $partida$
begin
  if exists (
    select 1
      from public.audit_log a
      join public.clinic c on c.id = a.clinic_id
     where not c.e_de_teste
       and a.action in ('suspendeu_clinica', 'reativou_clinica', 'mudou_agente_da_clinica',
                        'mudou_teto_da_ia', 'registrou_requisito_da_producao',
                        'revogou_requisito_da_producao', 'escreveu_nota_interna',
                        'excluiu_nota_interna')
       and a.user_id is not null
       and not exists (select 1 from public.product_admin pa where pa.user_id = a.user_id)
  ) then
    raise exception using errcode = 'P0001', message = 'trilha_da_conta_com_linha_de_fora',
      hint = 'Há linha de audit_log com uma ação do histórico da conta, numa clínica real, gravada por quem não é da equipe Conduzza. Confira essas linhas antes de aplicar de novo.';
  end if;
end;
$partida$;
