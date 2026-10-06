-- ---------------------------------------------------------------------------
-- Agente de IA: precos da OpenAI em llm_preco (Fase 3, 06/10/2026)
-- ---------------------------------------------------------------------------
-- Decisao do dono em 05/10/2026: o provedor do agente, do verificador do CFM
-- e do classificador de entrada passa a ser a OpenAI (no lugar da
-- Anthropic, para ser mais barato). O codigo so aceita modelos de uma lista
-- fechada (lib/integrations/llm): gpt-6-luna (verificador, classificador e
-- agente padrao) e gpt-6.1-sol (alternativa do agente). Esta migration so
-- poe o preco dos dois na tabela, como message_pricing: preco nunca no
-- codigo. Nao liga nada.
--
-- Fonte: tabela oficial de precos da OpenAI
-- (developers.openai.com/api/docs/pricing), consultada em 05/10/2026, faixa
-- Standard e contexto curto (entrada de ate 272 mil tokens). US$ por milhao
-- de tokens; a coluna guarda microdolar (US$ 1 = 1.000.000):
--   gpt-6-luna:  entrada 0,10; cache lido 0,01; cache gravado 0,125; saida 0,50
--   gpt-6.1-sol: entrada 2,00; cache lido 0,10; cache gravado 2,50;  saida 10,00
-- O codigo chama com service_tier "default" (Standard). Acima de 272 mil
-- tokens de entrada a OpenAI cobra 2x na entrada e no cache, e 1,5x na
-- saida; o processamento regional cobra mais 10%. Nenhum dos dois esta em
-- uso.
-- Na OpenAI os tokens de raciocinio sao cobrados como saida e a leitura de
-- cache dura no minimo 30 minutos (a coluna de escrita, que nasceu com o
-- cache de 5 minutos da Anthropic, vale aqui para a escrita de 30 minutos).
--
-- As tres linhas da Anthropic (claude-opus-5, claude-sonnet-5,
-- claude-haiku-4-5) FICAM: sao inofensivas (a lista fechada do codigo nao
-- aceita nenhum modelo claude, entao ninguem le esses precos), ia_uso esta
-- vazia, e os testes de integracao e de RLS do E0 conferem essas linhas.
-- Tirar exigiria DELETE e mexer naqueles testes, sem ganho de seguranca.
--
-- Idempotente: on conflict (modelo) atualiza os numeros e a fonte. So
-- INSERT em llm_preco (tabela fria, global, sem clinic_id) e o comentario da
-- tabela. Nenhum lock em tabela quente.
--
-- ROLLBACK (manual): delete from public.llm_preco where modelo in
-- ('gpt-6-luna', 'gpt-6.1-sol'); e devolver o comentario anterior da tabela
-- (texto na migration 20261006100000). Antes, confira que ia_uso nao tem
-- linha desses modelos (o livro de gasto guarda o custo ja calculado, mas a
-- conferencia evita apagar o preco de um uso em andamento).

insert into public.llm_preco (
  modelo,
  entrada_microdolar_por_milhao,
  saida_microdolar_por_milhao,
  cache_leitura_microdolar_por_milhao,
  cache_escrita_microdolar_por_milhao,
  vigente_desde,
  fonte
) values
  ('gpt-6-luna', 100000, 500000, 10000, 125000, date '2026-10-05',
   'Tabela de precos da OpenAI, developers.openai.com/api/docs/pricing (consultada em 05/10/2026), faixa Standard ate 272 mil tokens de entrada: US$ 0,10 entrada, US$ 0,01 cache lido, US$ 0,125 cache gravado e US$ 0,50 saida por milhao de tokens'),
  ('gpt-6.1-sol', 2000000, 10000000, 100000, 2500000, date '2026-10-05',
   'Tabela de precos da OpenAI, developers.openai.com/api/docs/pricing (consultada em 05/10/2026), faixa Standard ate 272 mil tokens de entrada: US$ 2,00 entrada, US$ 0,10 cache lido, US$ 2,50 cache gravado e US$ 10,00 saida por milhao de tokens')
on conflict (modelo) do update set
  entrada_microdolar_por_milhao = excluded.entrada_microdolar_por_milhao,
  saida_microdolar_por_milhao = excluded.saida_microdolar_por_milhao,
  cache_leitura_microdolar_por_milhao = excluded.cache_leitura_microdolar_por_milhao,
  cache_escrita_microdolar_por_milhao = excluded.cache_escrita_microdolar_por_milhao,
  vigente_desde = excluded.vigente_desde,
  fonte = excluded.fonte;

comment on table public.llm_preco is
  'Preco por modelo de linguagem, em microdolar por milhao de tokens (entrada comum, saida com o raciocinio, leitura e escrita de cache). Global, sem clinic_id, como message_pricing: o preco vive em tabela, nunca no codigo. fonte diz de onde veio o numero. Provedor em uso: OpenAI (gpt-6-luna e gpt-6.1-sol, faixa Standard); as linhas claude-* ficaram da Anthropic e nenhum codigo as le.';
