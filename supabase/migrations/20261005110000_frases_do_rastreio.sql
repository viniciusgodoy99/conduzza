-- ---------------------------------------------------------------------------
-- Frases do rastreio do site (F1 do Google, ajuste de 04/10/2026)
-- ---------------------------------------------------------------------------
-- Pedido do dono em 04/10/2026: quando o botao do WhatsApp do site NAO tem
-- mensagem pronta, o script (public/rastreio/v1.js) escrevia "Olá!" antes do
-- codigo. Agora a clinica cadastra de 1 a 5 frases (cada uma pode ter varias
-- sentencas); o padrao de fabrica e uma so, "Olá! Vim pelo site e gostaria
-- de agendar uma consulta."; com mais de uma, o script sorteia uma por
-- clique. Trocar as frases nao exige colar a linha de novo no site: o script
-- busca as frases pela chave (rota publica GET, que chama frases_do_rastreio
-- com a service role) so quando ha sinal do Google, e usa o padrao de
-- fabrica se a busca falhar ou nao voltar a tempo. Botao com mensagem
-- pronta: nada muda (o codigo vai no fim do texto dele).
--
-- A frase NAO gera codigo nem casa clique: o clique do site casa so pelo
-- codigo " [#XXXXXX]", e o check proibe '[', ']' e '#' para nenhuma frase
-- virar candidata a codigo. Mas a frase PODE contar para a origem: quando
-- o clique nao serve (nao achado ou vencido; com o rastreio desligado, o
-- aviso perdido, o limite ou o despejo o clique tambem nao e achado), a
-- ingestao segue a regra de antes do script e a frase vale como o texto de
-- um botao com mensagem pronta: na primeira mensagem do contato novo, entra
-- na mensagem padrao (comparada tambem sem o sufixo) e na palavra-chave
-- (sobre o texto inteiro). Com o "Olá!"
-- antigo quase nada batia; o padrao novo traz "site", "agendar" e
-- "consulta", e uma palavra-chave dessas num campaign_link grava para
-- sempre a origem daquele link num clique do Google perdido. Em 04/10/2026
-- ha 0 campaign_link (e 0 com palavra-chave ou mensagem padrao). O banco
-- nao resolve isso: manter, ou a ingestao ignorar a frase, e decisao do
-- dono (docs/05, pendencia do texto injetado).
--
-- 1. rastreio_do_site.frases text[] NOT NULL com a frase de fabrica como
--    default. As linhas que ja existem recebem o default (ADD COLUMN com
--    default constante: sem reescrever a tabela). Dois checks:
--    - rastreio_do_site_frases_de_1_a_5: de 1 a 5 itens, vetor de uma
--      dimensao comecando em 1, sem item nulo;
--    - rastreio_do_site_frases_no_formato: cada item com pelo menos um
--      caractere alem de espaco (char_length(btrim) >= 1) e ate 300
--      caracteres contando tudo (entao char_length(btrim) <= 300 tambem; o
--      site nunca recebe item maior que 300), sem quebra de linha (nem
--      U+2028 e U+2029), sem caractere de controle (C0, DEL e C1) e sem '[',
--      ']' ou '#' (o codigo e " [#XXXXXX]" e a ingestao procura "#XXXXXX" no
--      texto inteiro: uma frase com "#AGENDA" viraria candidato a codigo).
--    Check nao aceita subconsulta e funcao auxiliar exigiria EXECUTE para a
--    sessao (o check roda com o papel de quem grava): por isso o check junta
--    os itens com quebra de linha (proibida nos itens) e confere o texto
--    junto. Contar as quebras (itens - 1) prova que nenhum item tem quebra;
--    com isso cada trecho entre quebras e exatamente um item.
-- 2. Grant de UPDATE por coluna em frases para authenticated, junto do que
--    ja havia em ativo (a policy "gestao liga e desliga o rastreio do site",
--    de administrador e gestor ativos com user_can_write, vale para a linha
--    inteira e nao muda). INSERT continua so (clinic_id, ativo): sem linha,
--    a acao cria desligada e depois grava as frases por UPDATE.
-- 3. frases_do_rastreio(p_chave) (SECURITY DEFINER, search_path vazio, so
--    service_role): as frases se a chave existe e o rastreio esta ligado;
--    null para chave fora do formato, inexistente ou rastreio desligado (a
--    rota responde sem corpo e o script cai no padrao). Nada da clinica sai
--    daqui alem das frases.
--
-- Nada aqui grava dado de paciente em log. As frases sao texto da clinica.
--
-- ROLLBACK (manual): drop function public.frases_do_rastreio(text);
-- revoke update (frases) on public.rastreio_do_site from authenticated;
-- alter table public.rastreio_do_site drop column frases (os checks vao
-- junto). O script do site volta a usar o padrao de fabrica sozinho (a rota
-- passa a responder sem corpo).

-- ---------------------------------------------------------------------------
-- 1) rastreio_do_site.frases
-- ---------------------------------------------------------------------------

alter table public.rastreio_do_site
  add column frases text[] not null
    default array['Olá! Vim pelo site e gostaria de agendar uma consulta.']::text[],
  add constraint rastreio_do_site_frases_de_1_a_5 check (
    -- CASE e nao AND: a ordem de avaliacao do AND nao e garantida, e
    -- array_position da erro (0A000) em vetor de mais de uma dimensao. O
    -- vetor vazio tem dimensao nula e cai no primeiro ramo.
    case
      when array_ndims(frases) is distinct from 1 then false
      else cardinality(frases) between 1 and 5
        and array_lower(frases, 1) = 1
        and array_position(frases, null) is null
    end
  ),
  add constraint rastreio_do_site_frases_no_formato check (
    -- Nenhum item tem quebra de linha: o texto junto tem exatamente
    -- (itens - 1) quebras, as do separador. (Item nulo some do texto junto
    -- e tambem desmonta a conta.)
    char_length(array_to_string(frases, E'\n'))
      - char_length(replace(array_to_string(frases, E'\n'), E'\n', ''))
      = cardinality(frases) - 1
    -- Nenhum item vazio ou so de espacos (char_length(btrim) >= 1).
    and array_to_string(frases, E'\n') !~ '(^|\n) *(\n|$)'
    -- Nenhum item com mais de 300 caracteres (301 seguidos sem quebra; o
    -- regex do Postgres nao repete mais de 255 de uma vez).
    and array_to_string(frases, E'\n') !~ '[^\n]{150}[^\n]{151}'
    -- Sem caractere de controle (C0 menos a quebra do separador, DEL, C1),
    -- sem U+2028 e U+2029, sem colchete e sem cerquilha.
    and array_to_string(frases, E'\n') !~ '[\x01-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029\[\]#]'
  );

comment on column public.rastreio_do_site.frases is
  'Frases que o script do site poe antes do codigo quando o botao do WhatsApp nao tem mensagem pronta: de 1 a 5, cada uma de 1 a 300 caracteres, sem quebra de linha, caractere de controle, colchete ou cerquilha. Com mais de uma, o script sorteia uma por clique. Padrao de fabrica: "Olá! Vim pelo site e gostaria de agendar uma consulta.". Administrador e gestor editam; o site le por frases_do_rastreio (rota publica, service role). Nao gera codigo nem casa clique (o clique casa so pelo codigo " [#XXXXXX]"); quando o clique nao serve (nao achado ou vencido), a frase vale como o texto de um botao com mensagem pronta e entra na mensagem padrao (comparada tambem sem o codigo) e na palavra-chave (sobre o texto inteiro), como antes do script.';

comment on table public.rastreio_do_site is
  'Rastreio do site da clinica (F1 do Google): chave publica e rotacionavel que a linha de script do site manda junto com o clique, e as frases que o script poe antes do codigo quando o botao nao tem mensagem pronta. Administrador e gestor leem, criam (clinic_id e ativo), ligam ou desligam (ativo) e editam as frases (frases). A chave nasce no banco e so troca por trocar_chave_do_rastreio; ultimo_clique_em e gravado por registrar_clique_do_site.';

-- ---------------------------------------------------------------------------
-- 2) A gestao edita as frases (mesma policy de UPDATE de ativo)
-- ---------------------------------------------------------------------------

grant update (frases) on table public.rastreio_do_site to authenticated;

-- ---------------------------------------------------------------------------
-- 3) frases_do_rastreio (rota publica, so service_role)
-- ---------------------------------------------------------------------------
-- Leitura so: sem trava, sem escrita. Chave nula ou fora do formato nem
-- chega no indice unico de chave.

create or replace function public.frases_do_rastreio(p_chave text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select r.frases
    from public.rastreio_do_site r
   where p_chave ~ '^[0-9a-f]{20}$'
     and r.chave = p_chave
     and r.ativo;
$$;

revoke all on function public.frases_do_rastreio(text)
  from public, anon, authenticated;
grant execute on function public.frases_do_rastreio(text)
  to service_role;

comment on function public.frases_do_rastreio(text) is
  'Frases do rastreio do site pela chave publica (rota publica GET, service role): o text[] de rastreio_do_site.frases se a chave existe e o rastreio esta ligado; null para chave fora do formato, inexistente ou rastreio desligado. Nada da clinica alem das frases. So service_role.';
