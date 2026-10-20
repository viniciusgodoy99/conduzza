-- ---------------------------------------------------------------------------
-- Trilha com detalhes da acao (20/10/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026: "conseguir exportar os leads e nao so
-- importar" (Tela 4; so administrador e gestor; o arquivo sai com TODOS os
-- leads que batem com os filtros da tela). A exportacao grava UMA linha em
-- audit_log (action 'exportou', entity 'leads', entity_id nulo) e a trilha
-- precisa dizer QUANTOS leads sairam e com QUAIS filtros. Ate aqui
-- audit_log so tinha acao, entidade e id: esta migration acrescenta
-- `detalhes`.
--
-- 1. audit_log.detalhes jsonb, NULA e sem default: ADD COLUMN so de
--    catalogo (nenhuma linha reescrita). Toda linha que ja existe e toda
--    gravacao de hoje continuam iguais (nula).
-- 2. CHECK audit_log_detalhes_pequeno: objeto JSON de ate 2 KB. A coluna e
--    para metadados da acao (contagens, chaves de filtro, datas, id de
--    membro da equipe), e o teto impede que vire deposito de conteudo. A
--    conferencia das linhas que ja existem e uma leitura so (em 20/10/2026,
--    817 linhas e 368 kB, todas com a coluna nula).
--
-- O QUE NUNCA ENTRA EM detalhes: dado de paciente. Nada de nome, telefone,
-- texto de mensagem nem id de contato (o id do contato lido, quando ha,
-- continua em entity_id, como sempre). Quem grava e o codigo, com a
-- quantidade e o resumo dos filtros montados so a partir dos filtros
-- validados (lib/domain/exportacao-de-leads.ts,
-- detalhesDaTrilhaDaExportacao), nunca a partir de um lead.
--
-- Nenhuma policy muda: a de insert ("membro ativo registra a propria acao
-- na trilha") continua exigindo user_id = auth.uid() e clinica ativa, e so
-- administrador e gestor leem a trilha. Sem grant por coluna em audit_log
-- (authenticated grava todas as colunas da tabela, pela policy).
--
-- Codigo antes da migration: a exportacao tenta gravar com `detalhes`, o
-- PostgREST recusa a coluna desconhecida (PGRST204) ANTES de gravar, e a
-- linha sai sem os detalhes (lib/queries/exportacao-de-leads.ts,
-- registrarExportacaoDeLeads). Nunca ficam duas linhas.
--
-- LOCKS: ACCESS EXCLUSIVE em audit_log ate o fim da transacao, que e curta
-- (catalogo e a leitura das linhas para o CHECK). audit_log recebe insert a
-- cada abertura de tela com dado de paciente, entao lock_timeout curto: se a
-- tabela estiver ocupada, a migration falha inteira e roda de novo depois.
--
-- Rollback (manual): o codigo nao precisa voltar (ele grava sem detalhes
-- quando a coluna nao existe); `alter table public.audit_log drop column
-- detalhes;` leva junto o CHECK e os detalhes gravados.

set local lock_timeout = '5s';

alter table public.audit_log
  add column detalhes jsonb;

alter table public.audit_log
  add constraint audit_log_detalhes_pequeno
  check (
    detalhes is null
    or (
      jsonb_typeof(detalhes) = 'object'
      and octet_length(detalhes::text) <= 2048
    )
  );

comment on column public.audit_log.detalhes is
  'Metadados da acao (ex.: exportacao de leads: {"quantidade": 128, "filtros": {"etapa": "novo", "de": "2026-10-01"}}). Objeto de ate 2 KB. NUNCA dado de paciente: nada de nome, telefone, texto de mensagem ou id de contato aqui.';
