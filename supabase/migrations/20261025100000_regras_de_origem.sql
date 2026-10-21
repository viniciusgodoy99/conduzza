-- ---------------------------------------------------------------------------
-- Regras de origem dos leads: o link da bio (onda 5, item 17)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 20/10/2026, depois da 2a reuniao com o Victor ("Link da
-- bio, ele ta vindo aqui sem atribuicao porque e tipo, ele vem tipo uma
-- mensagem padrao"). Contrato entre as frentes em
-- ~/.claude/plans/onda5-atribuicao-implementador/contrato.md, parte A.1;
-- levantamento (so leitura) no levantamento.md da mesma pasta.
--
-- campaign_link ganha tela (Configuracoes, aba "Origem dos leads", decisao
-- P17-1 do dono de 21/10/2026). Hoje so o Zod da action segura o conteudo:
-- administrador e gestor gravam direto pelo PostgREST, sem passar por ele.
-- Esta migration poe no banco o que o Zod confere e as travas que o dono
-- escolheu:
--
-- 1. CHECKs (nomes que a action traduz por campo, recusa 23514). Os
--    tamanhos sao em pontos de codigo (char_length e o regex do Postgres),
--    e o Zod conta do mesmo jeito (contarCaracteres, em
--    lib/domain/regras-de-origem.ts), nunca pelo .length do JavaScript, que
--    conta unidades UTF-16 (um emoji fora do BMP valeria 2 la e 1 aqui):
--    - campaign_link_nome: char_length(btrim(name)) entre 2 e 120;
--    - campaign_link_textos: origin, medium e campaign nulos ou de 1 a 120
--      caracteres (btrim), sem caractere de controle (C0, DEL, C1);
--    - campaign_link_mensagem: default_message ("mensagem pronta do link",
--      P17-2) nula ou de 15 a 1000 caracteres (btrim), com pelo menos 3
--      palavras e sem caractere de controle alem da quebra de linha. O
--      minimo de 15 caracteres e 3 palavras e a trava P17-4 (a) do dono:
--      na producao as primeiras mensagens repetidas sao saudacoes curtas, e
--      uma regra com "Ola" ou "Bom dia" gravaria a origem errada para
--      sempre em dezenas de leads (a origem nunca muda:
--      impedir_reatribuicao_de_origem). O banco nao normaliza como a
--      ingestao (o Postgres nao tem \p{Cf}): conta os caracteres do texto
--      aparado e as palavras pelos trechos entre espacos (os mesmos
--      espacos do \s do JavaScript, U+FEFF de fora porque a ingestao o
--      apaga). Assim o banco nunca e mais exigente que o Zod, que confere
--      o texto normalizado (sem acento, sem invisivel, espacos juntos),
--      recomposto em NFC (a silaba do hangul, que a normalizacao decompoe
--      em jamos, volta a valer 1, como aqui) e contado em pontos de codigo;
--    - campaign_link_palavras_de_1_dimensao: keywords vazio, ou vetor de
--      uma dimensao, comecando em 1, de 1 a 20 itens, sem item nulo;
--    - campaign_link_palavras_no_formato: cada item com 4 a 40 caracteres
--      (o minimo de 4 conta o item aparado; P17-4 (a)), sem quebra de
--      linha (nem U+2028 e U+2029) e sem caractere de controle. Mesma
--      tecnica de 20261005110000_frases_do_rastreio.sql: o check junta os
--      itens com quebra de linha (proibida neles) e confere o texto junto;
--      CASE e nao AND, para nao depender da ordem de avaliacao;
--    - campaign_link_codigo: token nulo ou 6 simbolos do alfabeto do codigo
--      (TOKEN_ALPHABET de lib/domain/attribution.ts, sem 0, 1, I, L e O), em
--      maiusculas (a action grava em maiusculas);
--    - campaign_link_reconhece_algo: codigo, mensagem pronta ou pelo menos
--      uma palavra-chave (regra que nao reconhece nada nao serve).
--    A policy de INSERT e conferida antes dos CHECKs: quem nao gerencia as
--    origens continua recebendo 42501 (o ensaio prova).
-- 2. ATE 50 ORIGENS ATIVAS POR CLINICA (P17-8 (a); a ingestao le todas a
--    cada contato novo). Gatilho AFTER (depois da RLS e dos CHECKs: quem nao
--    gerencia recebe 42501, nunca a recusa do limite, e nao segura a trava
--    da clinica alheia) no INSERT e no UPDATE de active ou clinic_id, so
--    quando a linha passa a contar (nova ativa, ativada, ou ativa que mudou
--    de clinica). Uma clinica por vez (pg_advisory_xact_lock): duas
--    ativacoes ao mesmo tempo nao passam juntas do limite. Recusa em P0001
--    com a chave limite_de_origens_ativas (nunca 40001). Vale para a
--    service role tambem.
-- 3. GRANTS: anon sai de campaign_link (a RLS ja o segurava; o grant
--    estava aberto a toa); authenticated fica so com SELECT, INSERT, UPDATE
--    e DELETE (saem TRUNCATE, REFERENCES, TRIGGER e MAINTAIN). As policies
--    nao mudam: membro ativo le; administrador e gestor gerenciam.
--
-- Fora daqui (decisoes do dono de 21/10/2026): previa (P17-5 b, so o
-- "Testar uma mensagem" da tela), aplicar aos que ja chegaram (P17-6 c:
-- os leads da Salud Care so depois, por operacao, com o ok do dono) e a
-- origem a mao (P17-7 b). A normalizacao (invisiveis) e codigo, sem banco.
--
-- Producao em 21/10/2026 (q.js, so leitura): 0 linhas em campaign_link, em
-- qualquer clinica; o ALTER valida na hora.
--
-- LOCKS: lock_timeout de 3 s. O ALTER TABLE segura ACCESS EXCLUSIVE em
-- campaign_link ate o commit (a ingestao le a tabela a cada contato novo e
-- espera esses milissegundos). Nenhum ALTER em message, conversation,
-- contact, clinic_member, job_queue nem clinic. Nenhuma linha muda.
-- Nada aqui grava conteudo de mensagem de paciente: as regras sao texto da
-- clinica.
--
-- ROLLBACK (manual): supabase/operacao/rollback/
-- 20261025100000-corpos-anteriores.sql, numa transacao (sai o gatilho, a
-- funcao e os sete CHECKs; os grants e o comentario voltam como eram).

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) CHECKs (contrato A.1 e P17-4)
-- ---------------------------------------------------------------------------

alter table public.campaign_link
  add constraint campaign_link_nome check (
    char_length(btrim(name)) between 2 and 120
  ),
  add constraint campaign_link_textos check (
    (origin is null
      or (char_length(btrim(origin)) between 1 and 120
          and origin !~ '[\x01-\x1f\x7f-\x9f]'))
    and (medium is null
      or (char_length(btrim(medium)) between 1 and 120
          and medium !~ '[\x01-\x1f\x7f-\x9f]'))
    and (campaign is null
      or (char_length(btrim(campaign)) between 1 and 120
          and campaign !~ '[\x01-\x1f\x7f-\x9f]'))
  ),
  add constraint campaign_link_mensagem check (
    default_message is null
    or (
      -- De 15 (P17-4) a 1000 caracteres, sem os espacos das pontas.
      char_length(btrim(default_message)) between 15 and 1000
      -- Sem caractere de controle alem da quebra de linha (C0, DEL, C1).
      and default_message !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f]'
      -- Pelo menos 3 palavras (P17-4): tres trechos sem espaco separados
      -- por espaco. Os espacos sao os do \s do JavaScript (U+FEFF de fora:
      -- a normalizacao da ingestao o apaga, e ele junta as palavras).
      and default_message ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
    )
  ),
  add constraint campaign_link_palavras_de_1_dimensao check (
    -- CASE e nao AND: a ordem de avaliacao do AND nao e garantida, e
    -- array_position da erro (0A000) em vetor de mais de uma dimensao. O
    -- vetor vazio tem dimensao nula e e aceito no primeiro ramo.
    case
      when cardinality(keywords) = 0 then true
      when array_ndims(keywords) is distinct from 1 then false
      else cardinality(keywords) <= 20
        and array_lower(keywords, 1) = 1
        and array_position(keywords, null) is null
    end
  ),
  add constraint campaign_link_palavras_no_formato check (
    case
      when cardinality(keywords) = 0 then true
      else
        -- Nenhum item tem quebra de linha: o texto junto tem exatamente
        -- (itens - 1) quebras, as do separador. (Item nulo some do texto
        -- junto e tambem desmonta a conta.)
        char_length(array_to_string(keywords, E'\n'))
          - char_length(replace(array_to_string(keywords, E'\n'), E'\n', ''))
          = cardinality(keywords) - 1
        -- Nenhum item com menos de 4 caracteres alem dos espacos das pontas
        -- (P17-4): vazio, so espacos, ou um miolo de 1 a 3 caracteres que
        -- comeca e termina sem espaco.
        and array_to_string(keywords, E'\n')
          !~ '(^|\n) *([^ \n]|[^ \n][^ \n]|[^ \n][^\n][^ \n])? *(\n|$)'
        -- Nenhum item com mais de 40 caracteres.
        and array_to_string(keywords, E'\n') !~ '[^\n]{41}'
        -- Sem caractere de controle (C0 menos a quebra do separador, DEL,
        -- C1) e sem U+2028 e U+2029.
        and array_to_string(keywords, E'\n') !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]'
    end
  ),
  add constraint campaign_link_codigo check (
    token is null or token ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'
  ),
  add constraint campaign_link_reconhece_algo check (
    token is not null or default_message is not null or cardinality(keywords) > 0
  );

-- ---------------------------------------------------------------------------
-- 2) Ate 50 origens ativas por clinica (P17-8)
-- ---------------------------------------------------------------------------
-- AFTER: a linha ja passou pela RLS e pelos CHECKs. SECURITY DEFINER: a
-- contagem e da tabela inteira da clinica, nunca do que a sessao enxerga.
-- Sob a trava da clinica, cada comando seguinte (READ COMMITTED) ja ve o que
-- a outra transacao gravou: quem conta por ultimo ve todas.

create function public.limitar_origens_ativas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativas integer;
begin
  -- So a linha que passa a contar: a ativa que continua ativa na mesma
  -- clinica nao muda a conta.
  if tg_op = 'UPDATE' and old.active and old.clinic_id = new.clinic_id then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('campaign_link_ativas:' || new.clinic_id::text, 0)
  );

  select count(*) into v_ativas
    from public.campaign_link l
   where l.clinic_id = new.clinic_id
     and l.active;

  if v_ativas > 50 then
    raise exception using
      errcode = 'P0001',
      message = 'limite_de_origens_ativas',
      detail = 'A clínica pode ter até 50 origens ativas.';
  end if;
  return null;
end;
$$;

revoke all on function public.limitar_origens_ativas() from public, anon, authenticated;

comment on function public.limitar_origens_ativas() is
  'Gatilho de campaign_link (P17-8 do dono, 21/10/2026): no maximo 50 origens ativas por clinica. AFTER INSERT e UPDATE de active ou clinic_id, so quando a linha passa a contar; uma clinica por vez (pg_advisory_xact_lock). Recusa em P0001 com a chave limite_de_origens_ativas. Vale para a service role.';

create trigger limitar_origens_ativas
  after insert or update of active, clinic_id on public.campaign_link
  for each row
  when (new.active)
  execute function public.limitar_origens_ativas();

-- ---------------------------------------------------------------------------
-- 3) Grants
-- ---------------------------------------------------------------------------
-- revoke all + grant (e nao revoke de cada privilegio): sai tambem o
-- MAINTAIN do Postgres 17 sem depender da versao.

revoke all on table public.campaign_link from anon;
revoke all on table public.campaign_link from authenticated;
grant select, insert, update, delete on table public.campaign_link to authenticated;

comment on table public.campaign_link is
  'Regras de origem dos leads (configuracao de atribuicao): uma linha = uma origem da clinica (link da bio, perfil no Google, QR code, parceiro). Reconhece o lead novo pela mensagem pronta do link (default_message, texto inteiro igual depois de normalizar), pelo codigo no link (token " [#XXXXXX]", vale tambem para quem ja era contato) ou por palavra-chave na primeira mensagem (keywords); precedencia e normalizacao em lib/domain/attribution.ts, ingestao em lib/integrations/whatsapp/ingest.ts. A origem gravada no contato nunca muda. Tela: Configuracoes, aba Origem dos leads (onda 5). Membro ativo le; administrador e gestor gerenciam (RLS). CHECKs: nome 2 a 120; origem, detalhe e campanha ate 120; mensagem pronta de 15 a 1000 caracteres com pelo menos 3 palavras; ate 20 palavras-chave de 4 a 40 caracteres; codigo de 6 simbolos do alfabeto, em maiusculas; pelo menos um jeito de reconhecer. Ate 50 ativas por clinica (gatilho limitar_origens_ativas). Nao liga a campanha nem a investimento da Meta (D1 de 04/10/2026).';
