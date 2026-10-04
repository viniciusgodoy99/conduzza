// Atribuicao de origem PURA (zero I/O). Quem consulta campaign_link e grava
// em contact e o orquestrador em lib/integrations/whatsapp/ingest.ts; aqui
// vive so a decisao, testavel direto.
//
// Precedencia de atribuirOrigem:
// 1. TOKEN (link_token): um token do corpo casa com rule.token, uppercase
//    dos dois lados. Vale qualquer token do corpo, na ordem em que aparecem
//    (o primeiro que casar): o codigo fixo vence o clique do site mesmo
//    quando os dois vem na mesma mensagem. Ganha de tudo.
// 2. MENSAGEM PADRAO (mensagem_padrao): o corpo normalizado e IGUAL ao
//    default_message normalizado. So igualdade total: texto editado pelo
//    paciente nao casa. Empate: primeira regra na ordem dada. Com codigos de
//    clique do site ja tentados e nao aproveitados (terceiro parametro), vale
//    tambem o corpo sem o sufixo " [#XXXXXX]" deles: o script do site cola o
//    sufixo no texto do botao, e o clique perdido (rastreio desligado, aviso
//    que falhou, limite, despejo, prazo vencido) nao pode tirar a mensagem
//    padrao que o mesmo texto teria sem o script.
// 3. PALAVRA-CHAVE (palavra_chave): keyword normalizada contida no corpo
//    normalizado. Vence a keyword casada mais longa entre todas as regras;
//    empate: primeira regra na ordem dada.
// Nada casou, corpo nulo/vazio ou sem regras: null. Nunca chutar "direto";
// quem decide o fallback e o chamador.
//
// CLIQUE DO SITE (clique_site, F1 do Google): codigo por clique que o script
// do site da clinica poe no texto do wa.me, no mesmo formato " [#XXXXXX]". Nao
// passa por atribuirOrigem (a origem vem do banco, casar_clique_do_site): aqui
// so a escolha dos codigos a tentar (codigosDoCliqueDoSite) e a limpeza do
// sufixo para a mensagem padrao (removerCodigosDoClique). Precedencia da
// ingestao: anuncio da Meta, codigo fixo, clique do site, mensagem padrao,
// palavra-chave.

export const SOURCE_CHANNELS = [
  "trafego_pago",
  "busca_organica",
  "redes_sociais",
  "doctoralia_diretorios",
  "indicacao",
  "retorno",
  "offline",
  "direto",
] as const;

export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

export type SourceMethod =
  "link_token" | "mensagem_padrao" | "palavra_chave" | "clique_site";

export type CampaignRule = {
  id: string;
  token: string | null;
  channel: SourceChannel;
  origin: string | null;
  medium: string | null;
  campaign: string | null;
  defaultMessage: string | null;
  keywords: readonly string[];
};

export type Attribution = {
  channel: SourceChannel;
  origin: string | null;
  medium: string | null;
  campaign: string | null;
  method: SourceMethod;
};

// Alfabeto sem 0/1/I/L/O para nao confundir na leitura do token.
export const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TOKEN_LENGTH = 6;

const TOKEN_REGEX = new RegExp(`#([${TOKEN_ALPHABET}]{${TOKEN_LENGTH}})`, "i");
const TOKENS_REGEX = new RegExp(
  `#([${TOKEN_ALPHABET}]{${TOKEN_LENGTH}})`,
  "gi",
);

/**
 * Maximo de codigos de clique do site tentados por mensagem. Cada tentativa
 * e uma chamada ao banco; mensagem normal tem um codigo so.
 */
export const MAX_CODIGOS_DE_CLIQUE = 3;

/** Minusculas, sem acentos (NFD), espacos colapsados e trim. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Primeiro token #XXXXXX do corpo, em uppercase; null sem match. */
export function extrairToken(corpo: string): string | null {
  const match = TOKEN_REGEX.exec(corpo);
  const grupo = match?.[1];
  return grupo ? grupo.toUpperCase() : null;
}

/**
 * Todos os tokens #XXXXXX do corpo, em uppercase, sem repetir, na ordem em
 * que aparecem. O primeiro e o mesmo de extrairToken.
 */
export function extrairTokens(corpo: string): string[] {
  const tokens: string[] = [];
  for (const match of corpo.matchAll(TOKENS_REGEX)) {
    const token = match[1]?.toUpperCase();
    if (token && !tokens.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Codigos da mensagem que podem ser de clique no site, na ordem em que a
 * ingestao tenta casar (casar_clique_do_site): do ultimo para o primeiro,
 * porque o script do site poe o codigo no fim do texto. No maximo
 * MAX_CODIGOS_DE_CLIQUE. Vazio quando:
 * - o corpo nao tem token;
 * - algum token casa com token de campaign_link (as regras ativas): o codigo
 *   fixo vence o clique, e atribuirOrigem atribui por ele.
 * Sem regras (nenhum campaign_link), todo token e candidato: o clique nao
 * depende de cadastro de campanha.
 */
export function codigosDoCliqueDoSite(
  corpo: string | null,
  regras: readonly CampaignRule[],
): string[] {
  if (!corpo) {
    return [];
  }
  const tokens = extrairTokens(corpo);
  const fixos = new Set(
    regras.flatMap((regra) => (regra.token ? [regra.token.toUpperCase()] : [])),
  );
  if (tokens.some((token) => fixos.has(token))) {
    return [];
  }
  return tokens.reverse().slice(0, MAX_CODIGOS_DE_CLIQUE);
}

const CODIGO_REGEX = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`, "i");

/**
 * O corpo sem o sufixo " [#XXXXXX]" (o formato exato que o script do site
 * escreve, com o espaco antes) de cada codigo dado, sem diferenciar maiuscula
 * e minuscula. Os codigos sao os que codigosDoCliqueDoSite devolveu, entao o
 * codigo fixo de campaign_link nunca entra aqui.
 *
 * So a forma com colchetes sai. "#XXXXXX" solto fica: pode ser hashtag do
 * paciente ou do proprio texto da clinica (#AGENDA), e tira-lo quebraria a
 * igualdade da mensagem padrao que hoje casa. Paciente que apaga os
 * colchetes editou o texto, e texto editado nao casa a mensagem padrao.
 * Codigo fora do formato e ignorado (nunca vira expressao regular).
 */
export function removerCodigosDoClique(
  corpo: string,
  codigos: readonly string[],
): string {
  let limpo = corpo;
  for (const codigo of codigos) {
    if (!CODIGO_REGEX.test(codigo)) {
      continue;
    }
    limpo = limpo.replace(new RegExp(`\\s*\\[#${codigo}\\]`, "gi"), "");
  }
  return limpo;
}

/** Token de 6 chars do alfabeto. RNG injetavel para teste deterministico. */
export function gerarToken(aleatorio: () => number = Math.random): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    const indice = Math.min(
      Math.floor(aleatorio() * TOKEN_ALPHABET.length),
      TOKEN_ALPHABET.length - 1,
    );
    token += TOKEN_ALPHABET.charAt(indice);
  }
  return token;
}

/** Link click-to-WhatsApp com o token embutido no texto pre-preenchido. */
export function montarLinkWhatsApp(
  phoneE164: string,
  mensagemBase: string,
  token: string,
): string {
  const numero = phoneE164.replace(/^\+/, "");
  const texto = `${mensagemBase} [#${token.toUpperCase()}]`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

function montarAtribuicao(
  regra: CampaignRule,
  method: SourceMethod,
): Attribution {
  return {
    channel: regra.channel,
    origin: regra.origin,
    medium: regra.medium,
    campaign: regra.campaign,
    method,
  };
}

/**
 * `codigosDoClique`: codigos de clique do site que a ingestao tentou casar e
 * que nao gravaram origem (nao achado, vencido ou so vinculado). Mexem SO na
 * mensagem padrao, que passa a comparar tambem o corpo sem o sufixo deles.
 * Token e palavra-chave olham o corpo como chegou, como sempre.
 */
export function atribuirOrigem(
  corpo: string | null,
  regras: readonly CampaignRule[],
  codigosDoClique: readonly string[] = [],
): Attribution | null {
  if (!corpo || regras.length === 0) {
    return null;
  }

  // 1. Token do link: prova mais forte, ganha de tudo. Qualquer token do
  // corpo, na ordem: o primeiro que casar com uma regra.
  for (const token of extrairTokens(corpo)) {
    for (const regra of regras) {
      if (regra.token && regra.token.toUpperCase() === token) {
        return montarAtribuicao(regra, "link_token");
      }
    }
  }

  const corpoNormalizado = normalizarTexto(corpo);
  if (corpoNormalizado === "") {
    return null;
  }

  // 2. Mensagem padrao: so igualdade total do texto normalizado. O corpo
  // como chegou casa como sempre; o corpo sem o sufixo dos codigos de clique
  // nao aproveitados tambem (nunca menos do que antes do script do site).
  const corpoSemCodigos =
    codigosDoClique.length > 0
      ? normalizarTexto(removerCodigosDoClique(corpo, codigosDoClique))
      : corpoNormalizado;
  for (const regra of regras) {
    if (!regra.defaultMessage) {
      continue;
    }
    const padrao = normalizarTexto(regra.defaultMessage);
    if (
      padrao !== "" &&
      (padrao === corpoNormalizado || padrao === corpoSemCodigos)
    ) {
      return montarAtribuicao(regra, "mensagem_padrao");
    }
  }

  // 3. Palavra-chave: mais longa vence; empate fica com a primeira regra.
  let vencedora: CampaignRule | null = null;
  let maiorComprimento = 0;
  for (const regra of regras) {
    for (const keyword of regra.keywords) {
      const keywordNormalizada = normalizarTexto(keyword);
      if (
        keywordNormalizada !== "" &&
        keywordNormalizada.length > maiorComprimento &&
        corpoNormalizado.includes(keywordNormalizada)
      ) {
        vencedora = regra;
        maiorComprimento = keywordNormalizada.length;
      }
    }
  }
  if (vencedora) {
    return montarAtribuicao(vencedora, "palavra_chave");
  }

  return null;
}
