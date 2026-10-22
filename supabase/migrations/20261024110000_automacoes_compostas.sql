-- ---------------------------------------------------------------------------
-- Automacoes compostas: varias acoes, condicoes de etiqueta e E ou OU (onda
-- 4, migration B de duas)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026 (reuniao com o Victor, itens 14 e 15 do
-- plano): uma automacao de fluxo com varias acoes ("24 h em Follow 1: cria a
-- atividade E move para Follow 2") e condicoes de etiqueta, juntadas por E ou
-- OU. Contrato entre as frentes em ~/.claude/plans/onda4-automacoes/
-- (contrato.md, secao 3, sem a 3.12). Decisoes do dono de 20 e 21/10/2026
-- (as recomendacoes do contrato): D1 a etiqueta conta no lead ou em qualquer
-- conversa dele, pelo nome (as funcoes da migration A, 20261024100000); D5
-- condicoes "o lead tem a etiqueta X" e "nao tem"; D6 uma escolha por
-- automacao, todas (E) ou qualquer uma (OU); D7 as 4 acoes de hoje, ate 5 por
-- automacao, no maximo um mover, que roda sempre por ultimo; D9 condicao que
-- nao bate quando o gatilho acontece pula aquela entrada e o historico diz por
-- que. Travas sem pergunta: ate 5 condicoes e 5 acoes; "uma vez por
-- entrada", "nao retroativa", "o movimento humano vence", ciclo e teto de 10
-- movimentos em 24 h como estao; regra com condicao conta como aresta no
-- detector de ciclo (conservador); clinica suspensa nao roda automacao de
-- fluxo (coerencia com a onda 1).
--
-- EXPANDIR E DEPOIS CONTRAIR: esta migration NAO apaga as colunas de acao de
-- automacao_fluxo (o codigo publicado continua funcionando ate o novo sair);
-- a limpeza e a migration C (contrato 3.12), numa janela posterior.
--
-- 1. automacao_fluxo (tabela fria): combinar (todas ou qualquer, padrao
--    todas), acao deixa de ser NOT NULL (as colunas de acao viram legado; os
--    checks por acao ja aceitam nulo) e unique (id, clinic_id) para as FKs
--    compostas das filhas garantirem a mesma clinica.
-- 2. automacao_condicao (o "Se"): posicao 1 a 5, tipo tem_etiqueta ou
--    nao_tem_etiqueta, etiqueta = o NOME (o filtro casa pela chave; sem FK,
--    porque a etiqueta do lead e texto livre).
-- 3. automacao_acao (o "Faz"): posicao 1 a 5, as 4 acoes de hoje com as
--    MESMAS colunas e checks por acao de automacao_fluxo (os mesmos nomes de
--    constraint, que a tela traduz), FKs compostas NO ACTION para
--    funnel_stage_def e conversation_tag_def (como hoje), um mover no maximo
--    (indice unico parcial) e o gatilho validar_acao_de_automacao (destino
--    diferente da etapa da regra, Agendou e Compareceu nunca, Perdido se e
--    somente se o motivo nao_respondeu; os hints automacao_* de hoje).
-- 4. automacao_execucao_acao (o retrato por acao de cada execucao): status
--    executada, pulada ou falhou, motivo curto, destino, etiqueta (chave e
--    nome na hora), atividade (FK, set null), conversa e mensagem SEM FK
--    (regra das tabelas quentes: a tela trata alvo apagado como "nao existe
--    mais"). Vai junto com a execucao (cascade).
--    As tres: RLS ligada, membro ativo le, INSERT, UPDATE e DELETE revogados
--    de authenticated (so as funcoes do banco escrevem).
-- 5. MIGRACAO DAS AUTOMACOES QUE EXISTEM: a acao de cada regra vira a acao da
--    posicao 1 (em 21/10/2026, uma: a da Salud Care, criar atividade). A
--    linha de automacao_fluxo NAO e tocada (vigente_desde, updated_at,
--    autoria e as colunas legadas ficam iguais); combinar todas sem condicao
--    = sempre verdadeiro. Execucao pendente na hora: a identidade e o UNIQUE
--    de automacao_execucao nao mudam, e o executor novo a termina com o
--    mesmo resultado (paridade provada no ensaio).
--    Enquanto o codigo velho estiver no ar, o gatilho espelhar_acao_legada
--    (AFTER INSERT OR UPDATE das colunas de acao, com acao nao nula e sem a
--    GUC conduzza.salvando_automacao) regrava a acao da posicao 1 e apaga as
--    outras: a escrita do codigo velho continua valendo inteira.
-- 6. salvar_automacao_de_fluxo(clinica, id, regra): a escrita do codigo novo
--    (o pai, as condicoes e as acoes de uma vez). SECURITY DEFINER; quem nao e
--    administrador ou gestor da clinica recebe 42501 sem hint (contra
--    oraculo, como a guarda de hoje); a forma e os limites, 22023; editar so
--    com id E clinica batendo (P0002, sem dizer se o id existe em outra
--    clinica); motivo_perda nasce do papel do destino lido no banco; o mesmo
--    advisory lock por clinica do gatilho de hoje; grava as colunas legadas
--    nulas com a GUC ligada; confere o ciclo no fim com as acoes novas.
--    EXECUCAO PELA METADE (revisao de 21/10/2026): a prova de "acao ja
--    feita" do executor e o retrato (execucao, posicao), e salvar regrava as
--    acoes sem recomecar a vigencia. Uma execucao feita pela metade (uma
--    acao adiada pela trava da conversa) e retomada depois de a regra mudar
--    rodaria a acao nova que caiu numa posicao sem retrato e pularia a que
--    caiu numa posicao com retrato (acao repetida e acao perdida). Por isso,
--    ao trocar as acoes de uma regra (a RPC e o espelho do codigo velho),
--    fechar_execucoes_pela_metade fecha as execucoes pendentes dela que ja
--    tem retrato: o que falta fica pulado, regra_alterada, e a execucao
--    fecha executada (se alguma acao fez) ou pulada (regra_alterada). Ela
--    trava ANTES todas as pendentes da regra: a passagem do motor que
--    estiver com alguma termina primeiro (ele as trava com skip locked), e a
--    seguinte nao pega as travadas aqui ate o commit.
-- 7. CICLO: automacao_fecha_ciclo(clinica, regra, etapa, destinos) e o with
--    recursive de hoje com as arestas lidas de automacao_acao (regras
--    LIGADAS, gatilho que nao e de mensagem, acao mover; condicao nao tira
--    aresta). validar_automacao_de_fluxo: a escrita legada usa o destino da
--    linha; ligar, desligar ou mudar gatilho e etapa de uma regra do codigo
--    novo (acao legada nula) usa os destinos das filhas; a RPC confere no fim.
-- 8. executar_automacoes_de_fluxo (mesma assinatura, mesmo jsonb): guardas
--    como hoje, mais clinica_suspensa (nada roda na suspensao e nada fica
--    para rodar atrasado na volta); condicoes conferidas UMA vez, antes da
--    primeira acao (pulada condicoes_nao_atendidas); as acoes na ordem da
--    posicao, mover por ultimo, cada uma no proprio bloco de excecao, com o
--    codigo de hoje; IDEMPOTENTE POR ACAO (acao com retrato nesta execucao
--    nao roda de novo; acao que nao pegou a trava deixa a execucao pendente e
--    o mover espera a proxima passagem); o pai fecha pelo retrato das acoes,
--    e com uma acao so as colunas de retrato do pai saem como hoje.
-- 9. planejar_automacoes_de_fluxo: a clinica suspensa e pulada (a execucao
--    devida nasce ja pulada, clinica_suspensa: o UNIQUE da entrada impede que
--    rode atrasada na volta). Condicao nao entra no planejamento (D9).
--    proteger_jornada: tambem recusa excluir etapa que e destino em
--    automacao_acao. proteger_etiqueta_de_conversa: tambem recusa excluir
--    etiqueta usada por automacao_acao e, com D1, excluir ou renomear (mudando
--    a chave do nome) etiqueta do catalogo cujo nome esta num filtro
--    (automacao_condicao ou cadence.etiquetas), com a mensagem que diz onde
--    trocar (P0001, hint etiqueta_usada_em_filtro). Nas duas, quando a
--    CLINICA inteira esta sendo apagada, as acoes que apontam para a etapa ou
--    para a etiqueta saem antes (revisao de 21/10/2026): elas saem com a
--    regra um nivel de cascade abaixo da clinica, e a checagem NO ACTION das
--    FKs delas viria antes e recusaria a exclusao da clinica (nenhum afterAll
--    de teste apagaria a clinica de uma regra com mover ou etiquetar).
--    registrar_entrada_para_automacao, registrar_mensagem_para_automacao,
--    previa_da_automacao_de_fluxo e motor_manutencao NAO mudam.
--
-- Cinco funcoes de producao mudam, a partir do corpo de PRODUCAO lido em
-- 21/10/2026 (fndef.js, so leitura; as ondas 2 e 3 nao trocam nenhuma) e
-- guardado em supabase/operacao/rollback/20261024110000-corpos-anteriores.sql
-- com o md5 do prosrc (o ensaio confere que o banco ainda esta assim):
--   executar_automacoes_de_fluxo   1d97f21aeedf2532f8a65c06995b9392
--   planejar_automacoes_de_fluxo   ef59c12a7692313c8f9f6affc5a75263
--   validar_automacao_de_fluxo     0991a62876ce9ba0b6b9406cfbc96466
--   proteger_jornada               12d4da109649c84e69d0bb7b23b7b115
--   proteger_etiqueta_de_conversa  08beca71728c576aca9600bbcad07ba4
-- O que muda fica entre "-- [automacoes compostas] inicio" e "... fim"; o
-- resto e o corpo de producao linha a linha (o ensaio confere fora dos
-- marcadores). Security, search_path e grants ficam como eram.
--
-- Erros de regra: 42501 (quem nao gerencia a clinica), 22023 (forma e
-- limites da regra na RPC), P0002 (regra que nao e desta clinica), 23514 com
-- os hints automacao_* de hoje (destino, Perdido, ciclo) e
-- automacao_destino_igual_origem, 23503 nas FKs compostas, P0001 com hint
-- etiqueta_usada_em_filtro. Nunca 40001/40P01 (o PostgREST repete sem
-- limite). Nada aqui grava nome, telefone, etiqueta ou conteudo de mensagem
-- de paciente em log, evento, erro ou audit_log (as trilhas de sistema sao as
-- de hoje: so ids).
--
-- LOCKS: lock_timeout de 3 s. As tres tabelas sao novas. A FK de
-- automacao_acao para funnel_stage_def e conversation_tag_def pega SHARE ROW
-- EXCLUSIVE nas duas (escrita na jornada e no catalogo de etiquetas, rara,
-- espera; leitura nao). automacao_fluxo e alterada por ULTIMO (ACCESS
-- EXCLUSIVE ate o commit): os gatilhos que registram (entrada na etapa em
-- contact e mensagem recebida em message) leem automacao_fluxo, entao a
-- ingestao e a mudanca de etapa esperam fracoes de segundo; as FKs para
-- automacao_execucao e contact_activity vem depois dela. Nenhum ALTER em
-- message, conversation, contact, clinic_member, job_queue nem clinic, e
-- nenhuma FK nova aponta para message ou conversation. Aplicar em horario
-- calmo.
--
-- ORDEM DE PUBLICACAO (decidida pelo coordenador em 22/10/2026, no lugar
-- da secao 8 do contrato): depois da migration A; as duas, cada uma com
-- ensaio e o ok do dono, ANTES de todo o codigo da onda 4, que sobe de uma
-- vez depois delas (o codigo depende das duas e falha fechado sem elas). O
-- codigo velho continua funcionando pelo espelho ate o novo subir. A
-- migration C (limpeza) so depois de o codigo novo estar estavel e de
-- conferir que nenhuma regra recebeu escrita legada.
--
-- ROLLBACK (manual): supabase/operacao/rollback/20261024110000-corpos-
-- anteriores.sql (antes do rollback da migration A).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) As tabelas filhas (sem as FKs para automacao_fluxo, automacao_execucao e
-- contact_activity, que vem no fim, depois de automacao_fluxo)
-- ---------------------------------------------------------------------------

create table public.automacao_condicao (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  automacao_id uuid not null,
  posicao smallint not null
    constraint automacao_condicao_posicao_na_faixa
      check (posicao between 1 and 5),
  tipo text not null
    constraint automacao_condicao_tipo_valido
      check (tipo in ('tem_etiqueta', 'nao_tem_etiqueta')),
  -- O NOME da etiqueta (do lead ou do catalogo); o filtro casa pela chave.
  etiqueta text not null
    constraint automacao_condicao_etiqueta_valida
      check (public.etiquetas_validas(array[etiqueta])),
  created_at timestamptz not null default now(),
  constraint automacao_condicao_posicao_unica unique (automacao_id, posicao)
);

comment on table public.automacao_condicao is
  'O "Se" das automacoes de fluxo (onda 4): "o lead tem a etiqueta" e "nao tem", ate 5 por regra, juntadas por automacao_fluxo.combinar. A etiqueta e o nome (do lead ou do catalogo da conversa); o filtro casa pela chave (chave_de_etiqueta). So salvar_automacao_de_fluxo escreve; membro ativo le.';

-- proteger_etiqueta_de_conversa procura pela chave do nome.
create index automacao_condicao_por_etiqueta
  on public.automacao_condicao (clinic_id, public.chave_de_etiqueta(etiqueta));

create table public.automacao_acao (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  automacao_id uuid not null,
  posicao smallint not null
    constraint automacao_acao_posicao_na_faixa
      check (posicao between 1 and 5),
  acao text not null,
  -- mover_etapa
  etapa_destino text,
  motivo_perda text,
  -- etiquetar (chave do catalogo conversation_tag_def)
  etiqueta text,
  -- criar_atividade
  atividade_titulo text,
  atividade_prazo_dias integer,
  -- nota_interna (texto fixo da clinica; o paciente nunca ve)
  nota_texto text,
  created_at timestamptz not null default now(),
  constraint automacao_acao_posicao_unica unique (automacao_id, posicao),
  -- FKs compostas NO ACTION, como as de automacao_fluxo: a exclusao de UMA
  -- etapa ou etiqueta usada e recusada antes, com mensagem, por
  -- proteger_jornada e proteger_etiqueta_de_conversa. Na exclusao da clinica
  -- inteira, as duas apagam antes as acoes que apontam para a etapa ou a
  -- etiqueta: as acoes saem com a regra, um nivel de cascade abaixo da
  -- clinica, e a checagem destas FKs viria antes (revisao de 21/10/2026).
  -- NO ACTION e nao ON DELETE CASCADE de proposito (retomada de
  -- 22/10/2026): com a protecao desligada (uma migration futura que a
  -- desligue, como a da onda 3 fez com proteger_jornada), excluir a etapa ou
  -- a etiqueta falha, em vez de apagar em silencio a acao de uma regra.
  constraint automacao_acao_etapa_destino_fkey
    foreign key (clinic_id, etapa_destino)
    references public.funnel_stage_def (clinic_id, chave),
  constraint automacao_acao_etiqueta_fkey
    foreign key (clinic_id, etiqueta)
    references public.conversation_tag_def (clinic_id, chave),
  -- Os MESMOS checks por acao de automacao_fluxo, com os mesmos nomes.
  constraint acao_de_automacao_valida
    check (acao in ('mover_etapa', 'etiquetar', 'criar_atividade', 'nota_interna')),
  constraint acao_mover_tem_destino
    check ((acao = 'mover_etapa') = (etapa_destino is not null)),
  constraint motivo_de_perda_da_automacao
    check (motivo_perda is null
           or (acao = 'mover_etapa' and motivo_perda = 'nao_respondeu')),
  constraint acao_etiquetar_tem_etiqueta
    check ((acao = 'etiquetar') = (etiqueta is not null)),
  constraint acao_atividade_tem_titulo_e_prazo
    check (((acao = 'criar_atividade') = (atividade_titulo is not null))
           and ((acao = 'criar_atividade') = (atividade_prazo_dias is not null))),
  constraint titulo_de_atividade_da_automacao
    check (atividade_titulo is null
           or char_length(btrim(atividade_titulo)) between 2 and 120),
  constraint prazo_de_atividade_da_automacao
    check (atividade_prazo_dias is null or atividade_prazo_dias between 0 and 365),
  constraint acao_nota_tem_texto
    check ((acao = 'nota_interna') = (nota_texto is not null)),
  constraint nota_da_automacao_com_tamanho
    check (nota_texto is null
           or (char_length(nota_texto) <= 2000 and btrim(nota_texto) <> ''))
);

comment on table public.automacao_acao is
  'O "Faz" das automacoes de fluxo (onda 4): ate 5 acoes por regra, na ordem da posicao, no maximo um mover, que roda sempre por ultimo. As mesmas colunas e checks por acao de automacao_fluxo (que viram legado). So salvar_automacao_de_fluxo e o espelho do codigo velho (espelhar_acao_legada) escrevem; membro ativo le.';

-- No maximo um mover por regra.
create unique index automacao_acao_um_mover
  on public.automacao_acao (automacao_id)
  where acao = 'mover_etapa';
-- proteger_jornada e proteger_etiqueta_de_conversa procuram por eles (e as
-- FKs compostas tambem).
create index automacao_acao_por_destino
  on public.automacao_acao (clinic_id, etapa_destino)
  where etapa_destino is not null;
create index automacao_acao_por_etiqueta
  on public.automacao_acao (clinic_id, etiqueta)
  where etiqueta is not null;

create table public.automacao_execucao_acao (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  execucao_id uuid not null,
  posicao smallint not null
    constraint automacao_execucao_acao_posicao_na_faixa
      check (posicao between 1 and 5),
  -- A acao que a regra tinha quando o motor executou.
  acao text not null
    constraint automacao_execucao_acao_acao_valida
      check (acao in ('mover_etapa', 'etiquetar', 'criar_atividade', 'nota_interna')),
  status text not null
    constraint automacao_execucao_acao_status_valido
      check (status in ('executada', 'pulada', 'falhou')),
  motivo text
    constraint automacao_execucao_acao_motivo_curto
      check (motivo is null or motivo ~ '^[a-z0-9_]{1,64}$'),
  -- So o mover executado.
  para_etapa text,
  -- So o etiquetar: a chave e o nome que ela tinha na hora.
  etiqueta text,
  etiqueta_nome text,
  atividade_id uuid,
  -- SEM FK (regra das tabelas quentes): a tela trata o alvo apagado como
  -- "nao existe mais".
  conversation_id uuid,
  message_id uuid,
  executada_em timestamptz not null default now(),
  constraint automacao_execucao_acao_posicao_unica unique (execucao_id, posicao),
  constraint automacao_execucao_acao_motivo_fora_de_executada
    check ((status = 'executada') = (motivo is null)),
  constraint automacao_execucao_acao_destino_do_mover
    check (para_etapa is null or (status = 'executada' and acao = 'mover_etapa')),
  constraint automacao_execucao_acao_etiqueta_coerente
    check ((etiqueta is null) = (etiqueta_nome is null)
           and (etiqueta is null or acao = 'etiquetar')
           and (acao <> 'etiquetar' or status <> 'executada' or etiqueta is not null))
);

comment on table public.automacao_execucao_acao is
  'O retrato por acao de cada execucao de automacao de fluxo (onda 4): o que cada acao fez (executada), por que nao fez (pulada, motivo curto) ou o erro (falhou, erro_<sqlstate>). Tambem e a prova da idempotencia por acao: acao com retrato nesta execucao nao roda de novo. Vai junto com a execucao. So o motor escreve; membro ativo le. Sem conteudo de mensagem.';
comment on column public.automacao_execucao_acao.motivo is
  'Codigo curto, so fora de executada. pulada: os da execucao (etapa_mudou, limite_de_cascata, limite_diario, destino_invalido, tem_consulta_futura, sem_conversa, ja_tinha_etiqueta, limite_de_etiquetas) ou o motivo da guarda que pegou a execucao pela metade. falhou: erro_<sqlstate>.';

-- A FK atividade_id (set null) procura por ele.
create index automacao_execucao_acao_da_atividade
  on public.automacao_execucao_acao (atividade_id)
  where atividade_id is not null;

-- RLS das tres: membro ativo le (pendente nao); escrever, so as funcoes do
-- banco (security definer, dono das tabelas) e a service role. Sem policy de
-- escrita e sem o privilegio: INSERT, UPDATE e DELETE pela API dao 42501.
alter table public.automacao_condicao enable row level security;
alter table public.automacao_acao enable row level security;
alter table public.automacao_execucao_acao enable row level security;

create policy "membro ativo le as condicoes de automacao" on public.automacao_condicao
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));
create policy "membro ativo le as acoes de automacao" on public.automacao_acao
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));
create policy "membro ativo le o retrato das acoes" on public.automacao_execucao_acao
  for select to authenticated
  using (clinic_id in (select public.user_active_clinic_ids()));

revoke all on table public.automacao_condicao from anon;
revoke all on table public.automacao_acao from anon;
revoke all on table public.automacao_execucao_acao from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.automacao_condicao from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.automacao_acao from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.automacao_execucao_acao from authenticated;

-- ---------------------------------------------------------------------------
-- 2) Validacao da acao, ciclo e o espelho do codigo velho
-- ---------------------------------------------------------------------------

-- O que os checks nao alcancam (le a regra e a jornada): destino diferente da
-- etapa da regra, Agendou e Compareceu nunca (fatos da Agenda; virariam
-- conversao falsa para a Meta), Perdido se e somente se o motivo
-- nao_respondeu. Mesmos hints de validar_automacao_de_fluxo. Sem guarda de
-- sessao: so funcoes definer e a service role escrevem aqui (a RPC ja
-- conferiu o papel).
create function public.validar_acao_de_automacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa text;
  v_papel text;
begin
  if new.acao is distinct from 'mover_etapa' then
    return new;
  end if;
  -- Regra de outra clinica ou inexistente: a FK composta recusa no fim do
  -- comando.
  select a.etapa into v_etapa
    from public.automacao_fluxo a
   where a.id = new.automacao_id
     and a.clinic_id = new.clinic_id;
  if new.etapa_destino = v_etapa then
    raise exception 'O destino tem de ser outra etapa, diferente da etapa da automação.'
      using errcode = '23514', hint = 'automacao_destino_igual_origem';
  end if;
  -- Etapa inexistente: a FK composta recusa no fim do comando.
  select d.papel into v_papel
    from public.funnel_stage_def d
   where d.clinic_id = new.clinic_id
     and d.chave = new.etapa_destino;
  if v_papel in ('agendou', 'compareceu') then
    raise exception 'Agendou e Compareceu são marcados pela Agenda e não podem ser destino de uma automação.'
      using errcode = '23514', hint = 'automacao_destino_da_agenda';
  end if;
  if v_papel = 'perdido' and new.motivo_perda is null then
    raise exception 'Para mover para a etapa de perda, a automação usa o motivo "Não respondeu".'
      using errcode = '23514', hint = 'automacao_perdido_sem_motivo';
  end if;
  if v_papel is distinct from 'perdido' and new.motivo_perda is not null then
    raise exception 'O motivo da perda só vale quando o destino é a etapa de perda.'
      using errcode = '23514', hint = 'automacao_motivo_sem_perdido';
  end if;
  return new;
end;
$$;

revoke all on function public.validar_acao_de_automacao()
  from public, anon, authenticated;

create trigger validar_acao_de_automacao
  before insert or update on public.automacao_acao
  for each row execute function public.validar_acao_de_automacao();

-- O detector de ciclo de hoje, com as arestas em automacao_acao: regras
-- LIGADAS de mover cujo gatilho nao e de mensagem (essas so andam se o lead
-- escrever). Se dos destinos se chega de volta a etapa, o lead ficaria
-- girando sozinho. Regra com condicao conta como aresta (a condicao pode
-- bater). p_id e a regra que se salva (fica de fora: os destinos dela vem
-- em p_destinos); nulo para a regra nova.
create function public.automacao_fecha_ciclo(
  p_clinic_id uuid,
  p_id uuid,
  p_etapa text,
  p_destinos text[]
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive alcance (etapa) as (
    select d.etapa
      from unnest(coalesce(p_destinos, '{}'::text[])) as d(etapa)
     where d.etapa is not null
    union
    select aa.etapa_destino
      from public.automacao_acao aa
      join public.automacao_fluxo a
        on a.id = aa.automacao_id
       and a.clinic_id = aa.clinic_id
      join alcance
        on a.etapa = alcance.etapa
     where a.clinic_id = p_clinic_id
       and a.id is distinct from p_id
       and a.ativa
       and a.gatilho <> 'mensagem_recebida'
       and aa.acao = 'mover_etapa'
  )
  select exists (select 1 from alcance where alcance.etapa = p_etapa)
$$;

comment on function public.automacao_fecha_ciclo(uuid, uuid, text, text[]) is
  'Os destinos p_destinos da regra p_id, na etapa p_etapa, fecham um ciclo com as outras regras LIGADAS de mover (gatilho que nao e de mensagem; arestas em automacao_acao; condicao nao tira aresta)? Usada por validar_automacao_de_fluxo e salvar_automacao_de_fluxo (onda 4).';

revoke all on function public.automacao_fecha_ciclo(uuid, uuid, text, text[])
  from public, anon, authenticated;

-- Execucao pela metade (revisao de 21/10/2026). A prova de "acao ja feita"
-- do executor e o retrato (execucao, posicao), e salvar regrava as acoes
-- sem recomecar a vigencia. Quem troca as acoes de uma regra (a RPC
-- salvar_automacao_de_fluxo e o espelho do codigo velho) chama esta funcao
-- ANTES de trocar: as execucoes pendentes da regra que ja tem retrato (uma
-- acao feita e outra adiada pela trava da conversa) fecham com as acoes de
-- agora, as que a regra tinha quando a execucao comecou. O que falta fica
-- pulado (regra_alterada); a execucao fecha executada se alguma acao fez,
-- senao pulada (regra_alterada). Sem isto, a passagem seguinte retomaria com
-- as acoes novas: a que caisse numa posicao sem retrato rodaria (acao
-- repetida) e a que caisse numa posicao com retrato ficaria de fora (acao
-- perdida).
-- Trava ANTES todas as pendentes da regra (for update, na ordem do id): se
-- a passagem do motor esta com alguma (ela as trava com for update skip
-- locked ate o fim), espera ela terminar e ve o que ela fez; se nao, a
-- passagem seguinte pula as travadas aqui ate o commit e depois as pega com
-- as acoes novas (as sem retrato comecam do zero). O motor nunca espera por
-- nada que esta funcao trava. Devolve quantas fechou (so a contagem).
create function public.fechar_execucoes_pela_metade(p_automacao_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pela_metade uuid[];
  v_n integer;
begin
  perform 1
    from public.automacao_execucao x
   where x.automacao_id = p_automacao_id
     and x.status = 'pendente'
   order by x.id
     for update;

  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
    into v_pela_metade
    from public.automacao_execucao x
   where x.automacao_id = p_automacao_id
     and x.status = 'pendente'
     and exists (
       select 1 from public.automacao_execucao_acao ea where ea.execucao_id = x.id
     );
  if cardinality(v_pela_metade) = 0 then
    return 0;
  end if;

  insert into public.automacao_execucao_acao (
    clinic_id, execucao_id, posicao, acao, status, motivo
  )
  select x.clinic_id, x.id, aa.posicao, aa.acao, 'pulada', 'regra_alterada'
    from public.automacao_execucao x
    join public.automacao_acao aa on aa.automacao_id = x.automacao_id
   where x.id = any (v_pela_metade)
     and not exists (
       select 1 from public.automacao_execucao_acao ea
        where ea.execucao_id = x.id
          and ea.posicao = aa.posicao
     );

  update public.automacao_execucao x
     set status = case when f.feitas > 0 then 'executada' else 'pulada' end,
         motivo = case when f.feitas > 0 then null else 'regra_alterada' end,
         para_etapa = case when f.feitas > 0 then f.para end,
         executada_em = now()
    from (
      select ea.execucao_id,
             count(*) filter (where ea.status = 'executada') as feitas,
             max(ea.para_etapa) as para
        from public.automacao_execucao_acao ea
       where ea.execucao_id = any (v_pela_metade)
       group by ea.execucao_id
    ) f
   where x.id = f.execucao_id
     and x.status = 'pendente';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.fechar_execucoes_pela_metade(uuid)
  from public, anon, authenticated;

comment on function public.fechar_execucoes_pela_metade(uuid) is
  'Fecha as execucoes pendentes da regra que ja tem retrato por acao (feitas pela metade), antes de as acoes dela mudarem: o que falta fica pulado (regra_alterada) e a execucao fecha executada (alguma acao fez) ou pulada (regra_alterada). Trava antes todas as pendentes da regra. Chamada por salvar_automacao_de_fluxo e espelhar_acao_legada (onda 4, revisao de 21/10/2026). Devolve quantas fechou.';

-- O espelho do codigo velho (expandir e contrair): a escrita legada (as
-- colunas de acao de automacao_fluxo) regrava a acao da posicao 1 e apaga as
-- outras, entao a regra continua fazendo exatamente o que o codigo velho
-- mandou. A RPC nova liga a GUC conduzza.salvando_automacao e grava as
-- colunas legadas nulas (o WHEN do gatilho ja nao dispara). Sai na migration
-- C.
create function public.espelhar_acao_legada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('conduzza.salvando_automacao', true), '') = 'on' then
    return null;
  end if;
  -- As acoes vao mudar: a execucao feita pela metade fecha antes, com as de
  -- agora (fechar_execucoes_pela_metade; revisao de 21/10/2026).
  if tg_op = 'UPDATE' then
    perform public.fechar_execucoes_pela_metade(new.id);
  end if;
  delete from public.automacao_acao a
   where a.automacao_id = new.id
     and a.posicao <> 1;
  insert into public.automacao_acao as a (
    clinic_id, automacao_id, posicao, acao, etapa_destino, motivo_perda,
    etiqueta, atividade_titulo, atividade_prazo_dias, nota_texto
  ) values (
    new.clinic_id, new.id, 1, new.acao, new.etapa_destino, new.motivo_perda,
    new.etiqueta, new.atividade_titulo, new.atividade_prazo_dias, new.nota_texto
  )
  on conflict (automacao_id, posicao) do update
     set acao = excluded.acao,
         etapa_destino = excluded.etapa_destino,
         motivo_perda = excluded.motivo_perda,
         etiqueta = excluded.etiqueta,
         atividade_titulo = excluded.atividade_titulo,
         atividade_prazo_dias = excluded.atividade_prazo_dias,
         nota_texto = excluded.nota_texto;
  return null;
end;
$$;

revoke all on function public.espelhar_acao_legada()
  from public, anon, authenticated;

comment on function public.espelhar_acao_legada() is
  'Gatilho de automacao_fluxo (onda 4, expandir e contrair): a escrita das colunas legadas de acao (o codigo velho) vira a acao da posicao 1 em automacao_acao e apaga as outras. Nao dispara com a GUC conduzza.salvando_automacao ligada (salvar_automacao_de_fluxo). Sai na migration C.';

-- ---------------------------------------------------------------------------
-- 3) A escrita do codigo novo
-- ---------------------------------------------------------------------------

create function public.salvar_automacao_de_fluxo(
  p_clinic_id uuid,
  p_id uuid,
  p_regra jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text;
  v_ativa boolean;
  v_gatilho text;
  v_etapa text;
  v_espera integer;
  v_combinar text;
  v_condicoes jsonb;
  v_acoes jsonb;
  v_item jsonb;
  v_posicao bigint;
  v_acao text;
  v_destino text;
  v_destinos text[] := array[]::text[];
  v_papel text;
  v_movers integer := 0;
begin
  -- 1. Quem salva: administrador ou gestor DESTA clinica; sem sessao, so a
  -- service role (e o SQL editor). 42501 sem hint e antes de qualquer
  -- leitura: quem nao gerencia a clinica nao aprende nada sobre ela.
  if auth.uid() is not null then
    if p_clinic_id is null
       or not public.user_has_role(p_clinic_id, array['admin', 'gestor']) then
      raise exception using errcode = '42501',
        message = 'Sem permissão para gerenciar as automações desta clínica.';
    end if;
  elsif coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'Sem permissão para gerenciar as automações desta clínica.';
  end if;
  if p_clinic_id is null then
    raise exception using errcode = '22004', message = 'Informe a clínica.';
  end if;

  -- 2. A forma e os limites (o Zod da action ja confere; aqui e a garantia).
  -- Numero inteiro: so digitos (60.5 ou 1e3 nao passam).
  if jsonb_typeof(p_regra) is distinct from 'object'
     or jsonb_typeof(p_regra -> 'nome') is distinct from 'string'
     or jsonb_typeof(p_regra -> 'gatilho') is distinct from 'string'
     or jsonb_typeof(p_regra -> 'etapa') is distinct from 'string'
     or coalesce(jsonb_typeof(p_regra -> 'ativa'), 'null') not in ('boolean', 'null')
     or coalesce(jsonb_typeof(p_regra -> 'combinar'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(p_regra -> 'condicoes'), 'null') not in ('array', 'null')
     or jsonb_typeof(p_regra -> 'acoes') is distinct from 'array'
     or not (coalesce(jsonb_typeof(p_regra -> 'espera_minutos'), 'null') = 'null'
             or (jsonb_typeof(p_regra -> 'espera_minutos') = 'number'
                 and (p_regra ->> 'espera_minutos') ~ '^[0-9]{1,9}$')) then
    raise exception using errcode = '22023',
      message = 'Regra de automação inválida.', hint = 'automacao_regra_invalida';
  end if;
  v_acoes := p_regra -> 'acoes';
  v_condicoes := case when jsonb_typeof(p_regra -> 'condicoes') = 'array'
                      then p_regra -> 'condicoes' else '[]'::jsonb end;
  if jsonb_array_length(v_acoes) not between 1 and 5 then
    raise exception using errcode = '22023',
      message = 'Uma automação tem de 1 a 5 ações.', hint = 'automacao_acoes';
  end if;
  if jsonb_array_length(v_condicoes) > 5 then
    raise exception using errcode = '22023',
      message = 'Uma automação tem até 5 condições.', hint = 'automacao_condicoes';
  end if;
  for v_item in select x.value from jsonb_array_elements(v_condicoes) as x(value) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'tipo') is distinct from 'string'
       or jsonb_typeof(v_item -> 'etiqueta') is distinct from 'string' then
      raise exception using errcode = '22023',
        message = 'Regra de automação inválida.', hint = 'automacao_regra_invalida';
    end if;
  end loop;
  for v_item in select x.value from jsonb_array_elements(v_acoes) as x(value) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item -> 'acao') is distinct from 'string'
       or coalesce(jsonb_typeof(v_item -> 'etapa_destino'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_item -> 'etiqueta'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_item -> 'atividade_titulo'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_item -> 'nota_texto'), 'null') not in ('string', 'null')
       or not (coalesce(jsonb_typeof(v_item -> 'atividade_prazo_dias'), 'null') = 'null'
               or (jsonb_typeof(v_item -> 'atividade_prazo_dias') = 'number'
                   and (v_item ->> 'atividade_prazo_dias') ~ '^[0-9]{1,9}$')) then
      raise exception using errcode = '22023',
        message = 'Regra de automação inválida.', hint = 'automacao_regra_invalida';
    end if;
    if v_item ->> 'acao' = 'mover_etapa' then
      v_movers := v_movers + 1;
    end if;
  end loop;
  if v_movers > 1 then
    raise exception using errcode = '22023',
      message = 'Uma automação move o lead uma vez só.', hint = 'automacao_um_mover';
  end if;

  v_nome := p_regra ->> 'nome';
  v_ativa := coalesce((p_regra ->> 'ativa')::boolean, false);
  v_gatilho := p_regra ->> 'gatilho';
  v_etapa := p_regra ->> 'etapa';
  v_espera := (p_regra ->> 'espera_minutos')::integer;
  v_combinar := coalesce(p_regra ->> 'combinar', 'todas');

  -- 3. Uma clinica por vez (a mesma chave de validar_automacao_de_fluxo): duas
  -- regras salvas ao mesmo tempo nao fecham um ciclo sem ver uma a outra.
  perform pg_advisory_xact_lock(
    hashtextextended('automacao_fluxo:' || p_clinic_id::text, 0)
  );

  -- 4. O pai, com as colunas legadas nulas e a GUC ligada (o espelho do
  -- codigo velho nao dispara; validar_automacao_de_fluxo deixa o ciclo para
  -- o fim desta funcao e carimba autoria e vigencia como hoje).
  perform set_config('conduzza.salvando_automacao', 'on', true);
  if p_id is null then
    insert into public.automacao_fluxo (
      clinic_id, nome, ativa, gatilho, etapa, espera_minutos, combinar,
      acao, etapa_destino, motivo_perda, etiqueta, atividade_titulo,
      atividade_prazo_dias, nota_texto
    ) values (
      p_clinic_id, v_nome, v_ativa, v_gatilho, v_etapa, v_espera, v_combinar,
      null, null, null, null, null, null, null
    )
    returning id into v_id;
  else
    -- So com id E clinica batendo: a regra de outra clinica e a que nao
    -- existe dao o mesmo P0002.
    update public.automacao_fluxo a
       set nome = v_nome,
           ativa = v_ativa,
           gatilho = v_gatilho,
           etapa = v_etapa,
           espera_minutos = v_espera,
           combinar = v_combinar,
           acao = null,
           etapa_destino = null,
           motivo_perda = null,
           etiqueta = null,
           atividade_titulo = null,
           atividade_prazo_dias = null,
           nota_texto = null
     where a.id = p_id
       and a.clinic_id = p_clinic_id
    returning a.id into v_id;
    if v_id is null then
      raise exception using errcode = 'P0002', message = 'Automação não encontrada.';
    end if;
    -- As acoes vao mudar: a execucao feita pela metade fecha antes, com as
    -- de agora (fechar_execucoes_pela_metade; revisao de 21/10/2026).
    perform public.fechar_execucoes_pela_metade(v_id);
    delete from public.automacao_condicao c where c.automacao_id = v_id;
    delete from public.automacao_acao c where c.automacao_id = v_id;
  end if;

  -- 5. As condicoes (a etiqueta limpa: um espaco so, sem pontas) e as acoes,
  -- na ordem da lista. motivo_perda nasce do papel do destino na jornada,
  -- nunca do cliente; os campos que nao sao da acao ficam nulos.
  insert into public.automacao_condicao (clinic_id, automacao_id, posicao, tipo, etiqueta)
  select p_clinic_id, v_id, x.ordinality::smallint, x.value ->> 'tipo',
         btrim(regexp_replace(x.value ->> 'etiqueta', '\s+', ' ', 'g'))
    from jsonb_array_elements(v_condicoes) with ordinality as x(value, ordinality);

  for v_item, v_posicao in
    select x.value, x.ordinality
      from jsonb_array_elements(v_acoes) with ordinality as x(value, ordinality)
  loop
    v_acao := v_item ->> 'acao';
    v_destino := case when v_acao = 'mover_etapa' then v_item ->> 'etapa_destino' end;
    v_papel := null;
    if v_destino is not null then
      select d.papel into v_papel
        from public.funnel_stage_def d
       where d.clinic_id = p_clinic_id
         and d.chave = v_destino;
      v_destinos := v_destinos || v_destino;
    end if;
    insert into public.automacao_acao (
      clinic_id, automacao_id, posicao, acao, etapa_destino, motivo_perda,
      etiqueta, atividade_titulo, atividade_prazo_dias, nota_texto
    ) values (
      p_clinic_id, v_id, v_posicao::smallint, v_acao, v_destino,
      case when v_papel = 'perdido' then 'nao_respondeu' end,
      case when v_acao = 'etiquetar' then v_item ->> 'etiqueta' end,
      case when v_acao = 'criar_atividade' then v_item ->> 'atividade_titulo' end,
      case when v_acao = 'criar_atividade'
           then (v_item ->> 'atividade_prazo_dias')::integer end,
      case when v_acao = 'nota_interna' then v_item ->> 'nota_texto' end
    );
  end loop;
  perform set_config('conduzza.salvando_automacao', '', true);

  -- 6. O ciclo, com as acoes novas (as outras regras ja estao nas filhas).
  if v_ativa
     and v_gatilho <> 'mensagem_recebida'
     and cardinality(v_destinos) > 0
     and public.automacao_fecha_ciclo(p_clinic_id, v_id, v_etapa, v_destinos) then
    raise exception 'Esta automação fecha um ciclo com outra automação ligada: o lead ficaria indo e voltando entre as etapas. Mude o destino ou desligue a outra automação.'
      using errcode = '23514', hint = 'automacao_ciclo';
  end if;

  return v_id;
end;
$$;

revoke all on function public.salvar_automacao_de_fluxo(uuid, uuid, jsonb) from public, anon;
grant execute on function public.salvar_automacao_de_fluxo(uuid, uuid, jsonb)
  to authenticated, service_role;

comment on function public.salvar_automacao_de_fluxo(uuid, uuid, jsonb) is
  'Grava uma automacao de fluxo do codigo novo (onda 4): {nome, ativa, gatilho, etapa, espera_minutos, combinar, condicoes: [{tipo, etiqueta}], acoes: [{acao, etapa_destino, etiqueta, atividade_titulo, atividade_prazo_dias, nota_texto}]}, de 1 a 5 acoes, ate 5 condicoes, um mover no maximo (22023). p_id nulo cria; com p_id, so a regra desta clinica (P0002). So administrador e gestor (42501) e a service role. motivo_perda vem do papel do destino. Ao editar, fecha antes as execucoes feitas pela metade (fechar_execucoes_pela_metade). Confere o ciclo (23514 automacao_ciclo). Devolve o id. A trilha fica na Server Action.';

-- ---------------------------------------------------------------------------
-- 4) Corpos de producao com os trechos marcados
-- ---------------------------------------------------------------------------

create or replace function public.validar_automacao_de_fluxo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_ciclo boolean;
begin
  if v_uid is not null
     and not public.user_has_role(new.clinic_id, array['admin', 'gestor']) then
    raise exception 'Sem permissão para gerenciar as automações desta clínica.'
      using errcode = '42501';
  end if;

  -- Duas regras salvas ao mesmo tempo nao podem, cada uma sem ver a outra,
  -- fechar um ciclo: uma clinica por vez. Cada comando seguinte desta funcao
  -- (READ COMMITTED) ja enxerga o que a outra transacao gravou.
  perform pg_advisory_xact_lock(
    hashtextextended('automacao_fluxo:' || new.clinic_id::text, 0)
  );

  if tg_op = 'UPDATE' then
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma automação não muda de clínica.'
        using errcode = '23514';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if v_uid is not null then
      new.updated_by := v_uid;
    end if;
    -- Sem sessao (service role, testes), quem mexe em vigente_desde de
    -- proposito e atendido. Com sessao, so o banco escreve.
    if v_uid is null and new.vigente_desde is distinct from old.vigente_desde then
      null;
    elsif (new.ativa and not old.ativa)
       or new.gatilho is distinct from old.gatilho
       or new.etapa is distinct from old.etapa
       or new.espera_minutos is distinct from old.espera_minutos then
      new.vigente_desde := now();
    else
      new.vigente_desde := old.vigente_desde;
    end if;
  else
    if v_uid is not null then
      new.created_by := v_uid;
      new.updated_by := v_uid;
      new.created_at := now();
      new.vigente_desde := now();
    else
      new.vigente_desde := coalesce(new.vigente_desde, now());
    end if;
  end if;

  if new.acao = 'mover_etapa' then
    -- Etapa inexistente: a FK composta recusa no fim do comando.
    select papel into v_papel
      from funnel_stage_def
     where clinic_id = new.clinic_id and chave = new.etapa_destino;
    if v_papel in ('agendou', 'compareceu') then
      raise exception 'Agendou e Compareceu são marcados pela Agenda e não podem ser destino de uma automação.'
        using errcode = '23514', hint = 'automacao_destino_da_agenda';
    end if;
    if v_papel = 'perdido' and new.motivo_perda is null then
      raise exception 'Para mover para a etapa de perda, a automação usa o motivo "Não respondeu".'
        using errcode = '23514', hint = 'automacao_perdido_sem_motivo';
    end if;
    if v_papel is distinct from 'perdido' and new.motivo_perda is not null then
      raise exception 'O motivo da perda só vale quando o destino é a etapa de perda.'
        using errcode = '23514', hint = 'automacao_motivo_sem_perdido';
    end if;

    -- Detector de ciclo. Arestas: regras LIGADAS de mover cujo gatilho nao e
    -- de mensagem (essas so andam se o lead escrever, entao o vai e volta
    -- depende dele). Se do destino desta regra se chega de volta a origem,
    -- o lead ficaria girando sozinho. Regra desligada nao entra (ligar e
    -- salvar de novo, e ai confere).
    if new.ativa and new.gatilho <> 'mensagem_recebida' then
      -- [automacoes compostas] inicio
      -- Onda 4: as arestas das outras regras moram em automacao_acao (as de antes
      -- foram migradas e o espelho mantem a escrita legada la). Esta escrita e
      -- legada: o destino e o da linha.
      v_ciclo := public.automacao_fecha_ciclo(
        new.clinic_id, new.id, new.etapa, array[new.etapa_destino]);
      -- [automacoes compostas] fim
      if v_ciclo then
        raise exception 'Esta automação fecha um ciclo com outra automação ligada: o lead ficaria indo e voltando entre as etapas. Mude o destino ou desligue a outra automação.'
          using errcode = '23514', hint = 'automacao_ciclo';
      end if;
    end if;
  end if;
  -- [automacoes compostas] inicio
  -- Regra do codigo novo (acao legada nula; as acoes moram em automacao_acao):
  -- ligar, ou mudar gatilho ou etapa direto na tabela, confere o ciclo com os
  -- destinos das filhas. A RPC salvar_automacao_de_fluxo liga a GUC e confere
  -- no fim, com as acoes novas (aqui as filhas ainda sao as de antes).
  if new.acao is null
     and new.ativa
     and new.gatilho <> 'mensagem_recebida'
     and coalesce(current_setting('conduzza.salvando_automacao', true), '') <> 'on'
     and public.automacao_fecha_ciclo(
           new.clinic_id, new.id, new.etapa,
           array(select x.etapa_destino
                   from public.automacao_acao x
                  where x.automacao_id = new.id
                    and x.acao = 'mover_etapa')) then
    raise exception 'Esta automação fecha um ciclo com outra automação ligada: o lead ficaria indo e voltando entre as etapas. Mude o destino ou desligue a outra automação.'
      using errcode = '23514', hint = 'automacao_ciclo';
  end if;
  -- [automacoes compostas] fim

  return new;
end;
$function$;

create or replace function public.executar_automacoes_de_fluxo(p_limite integer DEFAULT 100, p_clinic_id uuid DEFAULT NULL::uuid, p_incluir_teste boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[];
  e record;
  r record;
  v_contato record;
  v_papel text;
  v_conversa uuid;
  v_tags text[];
  v_responsavel uuid;
  v_fuso text;
  v_atividade uuid;
  v_mensagem uuid;
  v_etiqueta_nome text;
  v_n integer;
  v_status text;
  v_motivo text;
  v_para text;
  v_executadas integer := 0;
  v_puladas integer := 0;
  v_falhas integer := 0;
  v_adiadas integer := 0;
  -- [automacoes compostas] inicio
  v_acao record;
  v_agora record;
  v_chaves text[];
  v_condicoes boolean;
  v_adiada boolean;
  v_alguma_adiada boolean;
  v_a_status text;
  v_a_motivo text;
  v_a_etiqueta text;
  v_feitas integer;
  v_falharam integer;
  v_registradas integer;
  v_acao_retrato text;
  v_etiqueta_retrato text;
  -- [automacoes compostas] fim
begin
  select coalesce(array_agg(s.id), array[]::uuid[])
    into v_ids
    from (
      select x.id
        from automacao_execucao x
        join clinic cl on cl.id = x.clinic_id
       where x.status = 'pendente'
         and x.devida_em <= now()
         and (p_clinic_id is null or x.clinic_id = p_clinic_id)
         and (p_incluir_teste or not cl.e_de_teste)
       order by x.devida_em, x.id
       limit greatest(1, least(coalesce(p_limite, 100), 500))
         for update of x skip locked
    ) s;

  for e in
    select x.id, x.clinic_id, x.automacao_id, x.contact_id,
           x.entrada_na_etapa, x.profundidade, x.created_at
      from automacao_execucao x
      join automacao_fluxo a on a.id = x.automacao_id
     where x.id = any (v_ids)
     order by x.contact_id, x.entrada_na_etapa,
              -- [automacoes compostas] inicio
              -- Mover por ultimo: a regra que tem acao de mover (em automacao_acao).
              exists (
                select 1 from automacao_acao m
                 where m.automacao_id = x.automacao_id
                   and m.acao = 'mover_etapa'
              ), x.devida_em, x.id
              -- [automacoes compostas] fim
  loop
    begin
      v_status := 'pulada';
      v_motivo := null;
      v_para := null;
      v_conversa := null;
      v_atividade := null;
      v_etiqueta_nome := null;
      v_papel := null;

      select * into r from automacao_fluxo where id = e.automacao_id;

      -- [automacoes compostas] inicio
      -- Conta suspensa (onda 1): nada roda na suspensao, e a execucao fecha como
      -- pulada (nada fica para rodar atrasado na volta).
      if public.clinica_esta_suspensa(e.clinic_id) then
        v_motivo := 'clinica_suspensa';
      elsif not r.ativa then
      -- [automacoes compostas] fim
        v_motivo := 'regra_desligada';
      elsif e.created_at < r.vigente_desde then
        -- Registrada antes de a regra ser religada ou editada.
        v_motivo := 'regra_alterada';
      else
        -- O contato travado ate o fim da passagem. Se outra transacao o
        -- segura (um movimento humano, a ingestao), fica para a proxima.
        select c.id, c.kind, c.funnel_stage, c.funnel_stage_changed_at,
               c.last_contact_at, c.created_at, c.criado_por_importacao
          into v_contato
          from contact c
         where c.id = e.contact_id
           for no key update skip locked;
        if not found then
          v_adiadas := v_adiadas + 1;
          continue;
        end if;

        if v_contato.funnel_stage is distinct from r.etapa
           or v_contato.funnel_stage_changed_at is distinct from e.entrada_na_etapa then
          -- Saiu da etapa (ou saiu e voltou: outra entrada). O movimento
          -- humano e o termo-chave vencem.
          v_motivo := 'etapa_mudou';
        elsif v_contato.kind is distinct from 'lead' then
          v_motivo := 'nao_e_lead';
        elsif v_contato.criado_por_importacao
              and v_contato.funnel_stage_changed_at <= v_contato.created_at then
          v_motivo := 'importado';
        elsif r.gatilho = 'sem_resposta_na_etapa'
              and greatest(v_contato.funnel_stage_changed_at, v_contato.last_contact_at)
                  + make_interval(mins => r.espera_minutos) > now() then
          v_motivo := 'lead_respondeu';
        -- [automacoes compostas] inicio
        -- Onda 4 (24/10/2026): as acoes moram em automacao_acao (ate 5, um mover no
        -- maximo) e o "Se" em automacao_condicao. Daqui ate o marcador de fim: as
        -- condicoes, as acoes e o fechamento da execucao.
        elsif not exists (
          select 1 from automacao_execucao_acao ea where ea.execucao_id = e.id
        ) then
          -- Condicoes (D9): conferidas UMA vez, antes da primeira acao, com as
          -- etiquetas do lead e das conversas dele (D1). A passagem que retoma uma
          -- execucao feita pela metade nao confere de novo (uma acao feita pode ter
          -- mudado as etiquetas). Sem condicao, passa.
          v_chaves := public.chaves_de_etiqueta_do_contato(e.contact_id);
          select case when r.combinar = 'qualquer' then bool_or(c.ok)
                      else bool_and(c.ok) end
            into v_condicoes
            from (
              select (k.tipo = 'tem_etiqueta')
                     = public.etiquetas_casam(v_chaves, array[k.etiqueta], 'qualquer') as ok
                from automacao_condicao k
               where k.automacao_id = r.id
            ) c;
          if not coalesce(v_condicoes, true) then
            v_motivo := 'condicoes_nao_atendidas';
          end if;
        end if;
      end if;

      -- As acoes na ordem da posicao, o mover por ultimo (ele tira o lead da
      -- etapa). Cada uma no proprio bloco de excecao: a falha vira o retrato
      -- 'falhou' dela e nao desfaz as outras. IDEMPOTENTE POR ACAO: a que ja tem
      -- retrato nesta execucao nao roda de novo. A que nao pegou a trava
      -- (conversa ocupada, deadlock) deixa a execucao pendente, e o mover espera
      -- a proxima passagem.
      v_alguma_adiada := false;
      if v_motivo is null then
        for v_acao in
          select aa.*
            from automacao_acao aa
           where aa.automacao_id = r.id
           order by (aa.acao = 'mover_etapa'), aa.posicao
        loop
          continue when exists (
            select 1 from automacao_execucao_acao ea
             where ea.execucao_id = e.id
               and ea.posicao = v_acao.posicao
          );
          continue when v_acao.acao = 'mover_etapa' and v_alguma_adiada;

          v_a_status := 'pulada';
          v_a_motivo := null;
          v_a_etiqueta := null;
          v_adiada := false;
          v_papel := null;
          v_para := null;
          v_conversa := null;
          v_atividade := null;
          v_mensagem := null;
          v_etiqueta_nome := null;
          begin
            -- O contato segue na mesma entrada da etapa da regra (travado desde
            -- a guarda; so o mover desta execucao o tira de la, e ele roda por
            -- ultimo).
            select c.funnel_stage, c.funnel_stage_changed_at
              into v_agora
              from contact c
             where c.id = e.contact_id;
            if v_agora.funnel_stage is distinct from r.etapa
               or v_agora.funnel_stage_changed_at is distinct from e.entrada_na_etapa then
              v_a_motivo := 'etapa_mudou';
            elsif v_acao.acao = 'mover_etapa' then
              if e.profundidade >= 3 then
                v_a_motivo := 'limite_de_cascata';
              elsif (
                select count(*)
                  from automacao_execucao m
                 where m.contact_id = e.contact_id
                   and m.status = 'executada'
                   and m.para_etapa is not null
                   and m.executada_em > now() - interval '24 hours'
              ) >= 10 then
                v_a_motivo := 'limite_diario';
              else
                select d.papel into v_papel
                  from funnel_stage_def d
                 where d.clinic_id = e.clinic_id and d.chave = v_acao.etapa_destino;
                if not found or v_papel in ('agendou', 'compareceu')
                   or v_acao.etapa_destino = r.etapa then
                  v_a_motivo := 'destino_invalido';
                elsif v_papel = 'perdido' and exists (
                  select 1
                    from appointment ap
                   where ap.clinic_id = e.clinic_id
                     and ap.contact_id = e.contact_id
                     and ap.status in ('agendado', 'aguardando_confirmacao',
                                       'confirmado_paciente', 'confirmado_recepcao')
                     and ap.starts_at > now()
                ) then
                  v_a_motivo := 'tem_consulta_futura';
                else
                  -- O gatilho de entrada na etapa nova le este GUC: a proxima
                  -- regra nasce um salto mais funda.
                  perform set_config('conduzza.automacao_profundidade',
                                     (e.profundidade + 1)::text, true);
                  -- CAS: so move se continua na mesma entrada da mesma etapa.
                  -- Sair de Perdido limpa o motivo no mesmo update (como a
                  -- action do Kanban); entrar grava o motivo da acao.
                  update contact
                     set funnel_stage = v_acao.etapa_destino,
                         lost_reason = case when v_papel = 'perdido' then v_acao.motivo_perda end,
                         lost_reason_note = null
                   where id = e.contact_id
                     and clinic_id = e.clinic_id
                     and funnel_stage = r.etapa
                     and funnel_stage_changed_at = e.entrada_na_etapa;
                  get diagnostics v_n = row_count;
                  perform set_config('conduzza.automacao_profundidade', '0', true);
                  if v_n = 0 then
                    v_a_motivo := 'etapa_mudou';
                  else
                    v_a_status := 'executada';
                    v_para := v_acao.etapa_destino;
                    insert into audit_log (clinic_id, user_id, action, entity, entity_id)
                    values (e.clinic_id, null, 'automacao_moveu_etapa', 'contact', e.contact_id);
                  end if;
                end if;
              end if;
            else
              -- As outras tres caem na conversa mais recente do lead (decisao do
              -- dono: uma conversa por numero, vale a ultima ativa).
              select v.id into v_conversa
                from conversation v
               where v.clinic_id = e.clinic_id
                 and v.contact_id = e.contact_id
               order by coalesce(v.last_message_at, v.created_at) desc,
                        v.created_at desc, v.id
               limit 1;

              if v_acao.acao = 'etiquetar' then
                -- A chave e o nome na hora vao para o retrato (a etiqueta existe:
                -- FK composta e proteger_etiqueta_de_conversa).
                select d.nome into v_etiqueta_nome
                  from conversation_tag_def d
                 where d.clinic_id = e.clinic_id and d.chave = v_acao.etiqueta;
                if v_etiqueta_nome is not null then
                  v_a_etiqueta := v_acao.etiqueta;
                end if;
                if v_conversa is null then
                  v_a_motivo := 'sem_conversa';
                else
                  -- Sem esperar quem atende (travar conversa depois de contato, na
                  -- ordem contraria de uma action, seria receita de deadlock): fica
                  -- para a proxima passagem.
                  select v.tags into v_tags
                    from conversation v
                   where v.id = v_conversa
                     for no key update skip locked;
                  if not found then
                    v_adiada := true;
                  elsif v_acao.etiqueta = any (v_tags) then
                    v_a_motivo := 'ja_tinha_etiqueta';
                  elsif cardinality(v_tags) >= 8 then
                    v_a_motivo := 'limite_de_etiquetas';
                  else
                    update conversation
                       set tags = array_append(tags, v_acao.etiqueta)
                     where id = v_conversa;
                    v_a_status := 'executada';
                    insert into audit_log (clinic_id, user_id, action, entity, entity_id)
                    values (e.clinic_id, null, 'automacao_etiquetou', 'conversation', v_conversa);
                  end if;
                end if;
              elsif v_acao.acao = 'criar_atividade' then
                -- Responsavel: quem atende a conversa mais recente, se ainda e
                -- membro ATIVO (validar_atividade recusaria); senao ninguem.
                v_responsavel := null;
                if v_conversa is not null then
                  select v.assignee_user_id into v_responsavel
                    from conversation v
                   where v.id = v_conversa;
                  if v_responsavel is not null and not exists (
                    select 1 from clinic_member m
                     where m.clinic_id = e.clinic_id
                       and m.user_id = v_responsavel
                       and m.status = 'ativo'
                  ) then
                    v_responsavel := null;
                  end if;
                end if;
                -- Prazo: hoje NO FUSO DA CLINICA mais N dias (regra 3.6).
                select cl.timezone into v_fuso from clinic cl where cl.id = e.clinic_id;
                insert into contact_activity (
                  clinic_id, contact_id, conversation_id, titulo, due_on,
                  assignee_user_id, origem, automacao_id
                ) values (
                  e.clinic_id, e.contact_id, v_conversa, v_acao.atividade_titulo,
                  (now() at time zone coalesce(v_fuso, 'America/Fortaleza'))::date
                    + v_acao.atividade_prazo_dias,
                  v_responsavel, 'automacao', r.id
                )
                returning id into v_atividade;
                v_a_status := 'executada';
                insert into audit_log (clinic_id, user_id, action, entity, entity_id)
                values (e.clinic_id, null, 'automacao_criou_atividade', 'contact_activity', v_atividade);
              elsif v_acao.acao = 'nota_interna' then
                if v_conversa is null then
                  v_a_motivo := 'sem_conversa';
                else
                  -- O numero vem da conversa (mensagem_herda_numero). Nota nao
                  -- mexe na previa nem no "esperando resposta".
                  insert into message (
                    clinic_id, conversation_id, direction, author, content_type,
                    body, is_internal_note, billable
                  ) values (
                    e.clinic_id, v_conversa, 'saida', 'sistema', 'texto',
                    v_acao.nota_texto, true, false
                  )
                  returning id into v_mensagem;
                  v_a_status := 'executada';
                  insert into audit_log (clinic_id, user_id, action, entity, entity_id)
                  values (e.clinic_id, null, 'automacao_anotou', 'message', v_mensagem);
                end if;
              end if;
            end if;
          exception
            when deadlock_detected or serialization_failure or lock_not_available then
              -- Transitorio: a acao foi desfeita e fica para a proxima passagem.
              v_adiada := true;
            when others then
              -- Sem dado de paciente: so o codigo do erro.
              v_a_status := 'falhou';
              v_a_motivo := left('erro_' || lower(sqlstate), 64);
              v_a_etiqueta := null;
              v_para := null;
              v_conversa := null;
              v_atividade := null;
              v_mensagem := null;
          end;
          if v_adiada then
            v_alguma_adiada := true;
            continue;
          end if;
          insert into automacao_execucao_acao (
            clinic_id, execucao_id, posicao, acao, status, motivo, para_etapa,
            etiqueta, etiqueta_nome, atividade_id, conversation_id, message_id
          ) values (
            e.clinic_id, e.id, v_acao.posicao, v_acao.acao, v_a_status,
            case when v_a_status = 'executada' then null else v_a_motivo end,
            v_para, v_a_etiqueta,
            case when v_a_etiqueta is not null then v_etiqueta_nome end,
            v_atividade, v_conversa, v_mensagem
          );
        end loop;
      elsif exists (
        select 1 from automacao_execucao_acao ea where ea.execucao_id = e.id
      ) then
        -- A guarda pegou uma execucao feita pela metade numa passagem anterior:
        -- as acoes que faltam ficam puladas com o motivo dela.
        insert into automacao_execucao_acao (
          clinic_id, execucao_id, posicao, acao, status, motivo
        )
        select e.clinic_id, e.id, aa.posicao, aa.acao, 'pulada', v_motivo
          from automacao_acao aa
         where aa.automacao_id = r.id
           and not exists (
             select 1 from automacao_execucao_acao ea
              where ea.execucao_id = e.id
                and ea.posicao = aa.posicao
           );
      end if;

      if v_alguma_adiada then
        -- Fica pendente: a proxima passagem faz so o que falta.
        v_adiadas := v_adiadas + 1;
        continue;
      end if;

      -- O pai fecha pelo retrato das acoes: executada se alguma fez (com o
      -- destino do mover); pulada com o motivo da guarda; falhou se nenhuma fez
      -- e alguma falhou; senao pulada, com o motivo da acao (uma so, como antes)
      -- ou acoes_puladas (varias).
      select count(*) filter (where ea.status = 'executada'),
             count(*) filter (where ea.status = 'falhou'),
             count(*)
        into v_feitas, v_falharam, v_registradas
        from automacao_execucao_acao ea
       where ea.execucao_id = e.id;
      v_para := null;
      v_conversa := null;
      v_atividade := null;
      v_acao_retrato := null;
      v_etiqueta_retrato := null;
      v_etiqueta_nome := null;
      if v_feitas > 0 then
        v_status := 'executada';
        v_motivo := null;
        select ea.para_etapa into v_para
          from automacao_execucao_acao ea
         where ea.execucao_id = e.id
           and ea.para_etapa is not null;
      elsif v_motivo is not null then
        v_status := 'pulada';
      elsif v_falharam > 0 then
        v_status := 'falhou';
        select ea.motivo into v_motivo
          from automacao_execucao_acao ea
         where ea.execucao_id = e.id
           and ea.status = 'falhou'
         order by ea.posicao
         limit 1;
      else
        v_status := 'pulada';
        if v_registradas = 1 then
          select ea.motivo into v_motivo
            from automacao_execucao_acao ea
           where ea.execucao_id = e.id;
        else
          v_motivo := 'acoes_puladas';
        end if;
      end if;
      -- Uma acao so (como as automacoes de antes, migradas): o retrato do pai
      -- sai como antes (acao, etiqueta e nome so na executada; a conversa e a
      -- atividade onde a acao caiu), entao o historico delas fica igual.
      if v_registradas = 1 then
        select ea.conversation_id,
               ea.atividade_id,
               case when ea.status = 'executada' then ea.acao end,
               case when ea.status = 'executada' and ea.acao = 'etiquetar'
                    then ea.etiqueta end,
               case when ea.status = 'executada' and ea.acao = 'etiquetar'
                    then ea.etiqueta_nome end
          into v_conversa, v_atividade, v_acao_retrato, v_etiqueta_retrato, v_etiqueta_nome
          from automacao_execucao_acao ea
         where ea.execucao_id = e.id;
      end if;

      update automacao_execucao
         set status = v_status,
             motivo = case when v_status = 'executada' then null else v_motivo end,
             para_etapa = v_para,
             conversation_id = v_conversa,
             atividade_id = v_atividade,
             acao = v_acao_retrato,
             etiqueta = v_etiqueta_retrato,
             etiqueta_nome = v_etiqueta_nome,
             executada_em = now()
       where id = e.id;
      if v_status = 'executada' then
        v_executadas := v_executadas + 1;
      elsif v_status = 'falhou' then
        v_falhas := v_falhas + 1;
      else
        v_puladas := v_puladas + 1;
      end if;
      -- [automacoes compostas] fim
    exception
      when deadlock_detected or serialization_failure or lock_not_available then
        -- Transitorio: o bloco foi desfeito e a linha segue pendente para a
        -- proxima passagem.
        v_adiadas := v_adiadas + 1;
      when others then
        -- Sem dado de paciente: so o codigo do erro.
        update automacao_execucao
           set status = 'falhou',
               motivo = left('erro_' || lower(sqlstate), 64),
               executada_em = now()
         where id = e.id;
        v_falhas := v_falhas + 1;
    end;
  end loop;

  return jsonb_build_object(
    'executadas', v_executadas,
    'puladas', v_puladas,
    'falhas', v_falhas,
    'adiadas', v_adiadas
  );
end;
$function$;

create or replace function public.planejar_automacoes_de_fluxo(p_limite integer DEFAULT 500, p_clinic_id uuid DEFAULT NULL::uuid, p_incluir_teste boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
begin
  with candidatas as (
    select a.id as automacao_id,
           a.clinic_id,
           a.etapa,
           a.vigente_desde,
           ct.id as contact_id,
           ct.funnel_stage_changed_at as entrada,
           case a.gatilho
             when 'tempo_na_etapa' then ct.funnel_stage_changed_at
             -- greatest ignora nulo: sem mensagem do lead, vale a entrada.
             else greatest(ct.funnel_stage_changed_at, ct.last_contact_at)
           end + make_interval(mins => a.espera_minutos) as devida
           -- [automacoes compostas] inicio
           -- Conta suspensa (onda 1): a execucao devida nasce pulada (abaixo).
           , public.clinica_esta_suspensa(a.clinic_id) as suspensa
           -- [automacoes compostas] fim
      from automacao_fluxo a
      join clinic cl on cl.id = a.clinic_id
      join contact ct
        on ct.clinic_id = a.clinic_id
       and ct.funnel_stage = a.etapa
     where a.ativa
       and a.gatilho in ('tempo_na_etapa', 'sem_resposta_na_etapa')
       and (p_clinic_id is null or a.clinic_id = p_clinic_id)
       and (p_incluir_teste or not cl.e_de_teste)
       and ct.kind = 'lead'
       and not (ct.criado_por_importacao
                and ct.funnel_stage_changed_at <= ct.created_at)
  ),
  devidas as (
    select c.*
      from candidatas c
     where c.devida <= now()
       -- NAO RETROATIVO: so o que venceu depois de ligar (ou editar).
       and c.devida >= c.vigente_desde
       and not exists (
         select 1 from automacao_execucao x
          where x.automacao_id = c.automacao_id
            and x.contact_id = c.contact_id
            and x.entrada_na_etapa = c.entrada
       )
     order by c.devida
     limit greatest(1, least(coalesce(p_limite, 500), 5000))
  ),
  novas as (
    insert into automacao_execucao (
      clinic_id, automacao_id, contact_id, de_etapa, entrada_na_etapa,
      devida_em, profundidade
      -- [automacoes compostas] inicio
      , status, motivo, executada_em
      -- [automacoes compostas] fim
    )
    select clinic_id, automacao_id, contact_id, etapa, entrada, devida, 0
           -- [automacoes compostas] inicio
           -- Na clinica suspensa a execucao ja nasce pulada, com o motivo: nao roda na
           -- suspensao e, como a entrada fica usada (UNIQUE), nao roda atrasada na
           -- volta. O historico diz por que.
           , case when suspensa then 'pulada' else 'pendente' end
           , case when suspensa then 'clinica_suspensa' end
           , case when suspensa then now() end
           -- [automacoes compostas] fim
      from devidas
    on conflict (automacao_id, contact_id, entrada_na_etapa) do nothing
    returning 1
  )
  select count(*)::integer into v_total from novas;
  return v_total;
end;
$function$;

create or replace function public.proteger_jornada()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'UPDATE' then
    if new.chave is distinct from old.chave then
      raise exception 'A chave de uma etapa não muda. Renomeie o nome da etapa.';
    end if;
    if new.papel is distinct from old.papel then
      raise exception 'O papel de sistema de uma etapa não muda.';
    end if;
    return new;
  end if;
  -- DELETE. Se a CLINICA inteira esta sendo apagada, o cascade manda: as
  -- protecoes abaixo valem para apagar UMA etapa, nao para desmontar a
  -- clinica (sem isto, nenhuma clinica conseguiria ser excluida, e todo
  -- afterAll de teste quebraria).
  if not exists (select 1 from public.clinic where id = old.clinic_id) then
    -- [automacoes compostas] inicio
    -- Onda 4 (revisao de 21/10/2026): as acoes de automacao (automacao_acao)
    -- saem com a regra, um nivel de cascade abaixo da clinica, e a checagem NO
    -- ACTION da FK delas para esta etapa viria antes e recusaria a exclusao da
    -- clinica. As que apontam para esta etapa saem aqui, primeiro.
    delete from public.automacao_acao
     where clinic_id = old.clinic_id
       and etapa_destino = old.chave;
    -- [automacoes compostas] fim
    return old;
  end if;
  if old.papel is not null then
    raise exception 'Etapa de sistema não pode ser excluída. Renomeie ou reordene.';
  end if;
  if exists (
    select 1 from public.contact
     where clinic_id = old.clinic_id and funnel_stage = old.chave
  ) then
    raise exception 'Mova os contatos desta etapa antes de excluí-la.';
  end if;
  if exists (
    select 1 from public.cadence
     where clinic_id = old.clinic_id
       and kind = 'followup'
       and trigger_stage = old.chave
  ) then
    raise exception 'Exclua a régua de follow-up desta etapa antes de excluí-la.';
  end if;
  -- [automacoes de fluxo] inicio
  -- Etapa usada por automacao de fluxo, como origem ou destino.
  if exists (
    select 1 from public.automacao_fluxo
     where clinic_id = old.clinic_id
       and (etapa = old.chave or etapa_destino = old.chave)
  ) then
    raise exception 'Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa.'
      using hint = 'etapa_usada_por_automacao';
  end if;
  -- [automacoes de fluxo] fim
  -- [automacoes compostas] inicio
  -- Onda 4: etapa que e destino de uma acao (as acoes moram em
  -- automacao_acao; a origem continua em automacao_fluxo.etapa, acima).
  if exists (
    select 1 from public.automacao_acao
     where clinic_id = old.clinic_id
       and etapa_destino = old.chave
  ) then
    raise exception 'Esta etapa é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etapa.'
      using hint = 'etapa_usada_por_automacao';
  end if;
  -- [automacoes compostas] fim
  return old;
end;
$function$;

create or replace function public.proteger_etiqueta_de_conversa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' then
    if new.chave is distinct from old.chave then
      raise exception 'A chave de uma etiqueta não muda. Renomeie o nome da etiqueta.';
    end if;
    if new.clinic_id is distinct from old.clinic_id then
      raise exception 'Uma etiqueta não muda de clínica.';
    end if;
    -- [automacoes compostas] inicio
    -- Onda 4 (D1: a etiqueta da conversa conta pelo NOME nos filtros):
    -- renomear mudando a chave do nome uma etiqueta que esta num filtro
    -- (condicao de automacao ou regua de follow-up) faria o filtro deixar de
    -- casar em silencio. Mudar so maiuscula, acento ou espaco passa.
    if public.chave_de_etiqueta(new.nome) is distinct from public.chave_de_etiqueta(old.nome)
       and (
         exists (
           select 1 from public.automacao_condicao k
            where k.clinic_id = old.clinic_id
              and public.chave_de_etiqueta(k.etiqueta) = public.chave_de_etiqueta(old.nome)
         ) or exists (
           select 1 from public.cadence k
            where k.clinic_id = old.clinic_id
              and k.kind = 'followup'
              and public.chave_de_etiqueta(old.nome) = any (public.chaves_de_etiquetas(k.etiquetas))
         )
       ) then
      raise exception using errcode = 'P0001',
        message = 'Esta etiqueta está no filtro de uma automação de fluxo ou de uma régua de follow-up. Troque a etiqueta em Automações antes de excluir ou renomear.',
        hint = 'etiqueta_usada_em_filtro';
    end if;
    -- [automacoes compostas] fim
    return new;
  end if;

  -- DELETE. Se a CLINICA inteira esta sendo apagada, o cascade manda: sem
  -- este escape nenhuma clinica seria excluivel e todo afterAll de teste
  -- quebraria (mesma licao da jornada).
  if not exists (select 1 from public.clinic where id = old.clinic_id) then
    -- [automacoes compostas] inicio
    -- Onda 4 (revisao de 21/10/2026): as acoes de automacao (automacao_acao)
    -- saem com a regra, um nivel de cascade abaixo da clinica, e a checagem NO
    -- ACTION da FK delas para esta etiqueta viria antes e recusaria a exclusao
    -- da clinica. As que usam esta etiqueta saem aqui, primeiro.
    delete from public.automacao_acao
     where clinic_id = old.clinic_id
       and etiqueta = old.chave;
    -- [automacoes compostas] fim
    return old;
  end if;

  -- [automacoes de fluxo] inicio
  -- Etiqueta usada por automacao de fluxo nao se exclui (a automacao
  -- passaria a etiquetar com uma chave que nao existe mais).
  if exists (
    select 1 from public.automacao_fluxo
     where clinic_id = old.clinic_id
       and etiqueta = old.chave
  ) then
    raise exception 'Esta etiqueta é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etiqueta.'
      using hint = 'etiqueta_usada_por_automacao';
  end if;

  -- [automacoes de fluxo] fim
  -- [automacoes compostas] inicio
  -- Onda 4: a etiqueta de uma acao (as acoes moram em automacao_acao) e,
  -- com D1, a que esta num filtro pelo nome (a exclusao a tiraria das
  -- conversas e o filtro deixaria de casar em silencio).
  if exists (
    select 1 from public.automacao_acao
     where clinic_id = old.clinic_id
       and etiqueta = old.chave
  ) then
    raise exception 'Esta etiqueta é usada por uma automação de fluxo. Exclua ou edite a automação antes de excluir a etiqueta.'
      using hint = 'etiqueta_usada_por_automacao';
  end if;
  if exists (
       select 1 from public.automacao_condicao k
        where k.clinic_id = old.clinic_id
          and public.chave_de_etiqueta(k.etiqueta) = public.chave_de_etiqueta(old.nome)
     ) or exists (
       select 1 from public.cadence k
        where k.clinic_id = old.clinic_id
          and k.kind = 'followup'
          and public.chave_de_etiqueta(old.nome) = any (public.chaves_de_etiquetas(k.etiquetas))
     ) then
    raise exception using errcode = 'P0001',
      message = 'Esta etiqueta está no filtro de uma automação de fluxo ou de uma régua de follow-up. Troque a etiqueta em Automações antes de excluir ou renomear.',
      hint = 'etiqueta_usada_em_filtro';
  end if;
  -- [automacoes compostas] fim
  -- Excluir a etiqueta a REMOVE das conversas. E isto que mantem a
  -- invariante "toda chave em conversation.tags existe no catalogo", que e o
  -- que permite o chip ser desenhado sem chave crua e o proximo UPDATE de
  -- tags passar pelo validador. security definer porque a limpeza e
  -- CONSEQUENCIA de uma exclusao que a RLS ja autorizou: deixar chave
  -- pendurada porque a policy do chamador nao alcancou alguma linha
  -- quebraria a invariante em silencio.
  update public.conversation
     set tags = array_remove(tags, old.chave)
   where clinic_id = old.clinic_id
     and old.chave = any (tags);
  return old;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5) automacao_fluxo por ULTIMO (ACCESS EXCLUSIVE ate o commit), a migracao
-- das acoes e as FKs que dependem dela
-- ---------------------------------------------------------------------------

alter table public.automacao_fluxo
  add column combinar text not null default 'todas'
    constraint automacao_fluxo_combinar_valido
      check (combinar in ('todas', 'qualquer')),
  alter column acao drop not null,
  add constraint automacao_fluxo_id_clinica_unico unique (id, clinic_id);

comment on column public.automacao_fluxo.combinar is
  'Como as condicoes (automacao_condicao) se juntam: todas (E) ou qualquer (OU). Sem condicao, a regra roda sempre (onda 4, D6).';
comment on column public.automacao_fluxo.acao is
  'LEGADO desde a onda 4 (as acoes moram em automacao_acao). O codigo velho ainda grava aqui e o espelho regrava a acao da posicao 1; a RPC nova grava nulo. Sai na migration C.';

create trigger espelhar_acao_legada
  after insert or update of acao, etapa_destino, motivo_perda, etiqueta,
    atividade_titulo, atividade_prazo_dias, nota_texto
  on public.automacao_fluxo
  for each row
  when (new.acao is not null)
  execute function public.espelhar_acao_legada();

-- As automacoes que existem: a acao vira a posicao 1. A linha da regra nao
-- e tocada.
insert into public.automacao_acao (
  clinic_id, automacao_id, posicao, acao, etapa_destino, motivo_perda,
  etiqueta, atividade_titulo, atividade_prazo_dias, nota_texto
)
select a.clinic_id, a.id, 1, a.acao, a.etapa_destino, a.motivo_perda,
       a.etiqueta, a.atividade_titulo, a.atividade_prazo_dias, a.nota_texto
  from public.automacao_fluxo a
 where a.acao is not null
on conflict (automacao_id, posicao) do nothing;

alter table public.automacao_condicao
  add constraint automacao_condicao_automacao_fkey
    foreign key (automacao_id, clinic_id)
    references public.automacao_fluxo (id, clinic_id)
    on delete cascade;
alter table public.automacao_acao
  add constraint automacao_acao_automacao_fkey
    foreign key (automacao_id, clinic_id)
    references public.automacao_fluxo (id, clinic_id)
    on delete cascade;
alter table public.automacao_execucao_acao
  add constraint automacao_execucao_acao_execucao_id_fkey
    foreign key (execucao_id)
    references public.automacao_execucao (id)
    on delete cascade,
  add constraint automacao_execucao_acao_atividade_id_fkey
    foreign key (atividade_id)
    references public.contact_activity (id)
    on delete set null;

comment on column public.automacao_execucao.motivo is
  'Codigo curto. pulada: regra_desligada, regra_alterada, etapa_mudou, nao_e_lead, importado, lead_respondeu, limite_de_cascata, limite_diario, destino_invalido, tem_consulta_futura, sem_conversa, ja_tinha_etiqueta, limite_de_etiquetas; desde a onda 4 tambem condicoes_nao_atendidas, acoes_puladas (varias acoes e nenhuma feita) e clinica_suspensa. falhou: erro_<sqlstate>. O retrato por acao fica em automacao_execucao_acao.';

-- ---------------------------------------------------------------------------
-- 6) Conferencia: recusa a migration inteira (P0001) se as automacoes que
-- existem nao ficaram como o executor espera
-- ---------------------------------------------------------------------------

do $conferencia$
declare
  v_n integer;
begin
  -- Toda regra com acao legada tem exatamente a acao da posicao 1, igual.
  select count(*) into v_n
    from public.automacao_fluxo a
   where a.acao is not null
     and (select count(*) from public.automacao_acao x where x.automacao_id = a.id) <> 1;
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('automacoes_sem_acao: %s regra(s) sem exatamente uma acao', v_n);
  end if;
  select count(*) into v_n
    from public.automacao_fluxo a
    join public.automacao_acao x
      on x.automacao_id = a.id
     and x.posicao = 1
   where a.acao is not null
     and (x.clinic_id, x.acao, x.etapa_destino, x.motivo_perda, x.etiqueta,
          x.atividade_titulo, x.atividade_prazo_dias, x.nota_texto)
         is distinct from
         (a.clinic_id, a.acao, a.etapa_destino, a.motivo_perda, a.etiqueta,
          a.atividade_titulo, a.atividade_prazo_dias, a.nota_texto);
  if v_n > 0 then
    raise exception using errcode = 'P0001',
      message = format('automacoes_com_acao_diferente: %s regra(s)', v_n);
  end if;
  -- Ninguem tem condicao nem retrato por acao ainda, e toda regra junta por
  -- todas.
  if exists (select 1 from public.automacao_condicao)
     or exists (select 1 from public.automacao_execucao_acao)
     or exists (select 1 from public.automacao_fluxo a where a.combinar <> 'todas') then
    raise exception using errcode = 'P0001', message = 'automacoes_com_estado_novo';
  end if;
end;
$conferencia$;
