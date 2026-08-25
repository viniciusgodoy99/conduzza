// Atribuicao de origem PURA (zero I/O). Quem consulta campaign_link e grava
// em contact e o orquestrador em lib/integrations/whatsapp/ingest.ts; aqui
// vive so a decisao, testavel direto.
//
// Precedencia de atribuirOrigem:
// 1. TOKEN (link_token): o token extraido do corpo casa com rule.token,
//    uppercase dos dois lados. Ganha de tudo.
// 2. MENSAGEM PADRAO (mensagem_padrao): o corpo normalizado e IGUAL ao
//    default_message normalizado. So igualdade total: texto editado pelo
//    paciente nao casa. Empate: primeira regra na ordem dada.
// 3. PALAVRA-CHAVE (palavra_chave): keyword normalizada contida no corpo
//    normalizado. Vence a keyword casada mais longa entre todas as regras;
//    empate: primeira regra na ordem dada.
// Nada casou, corpo nulo/vazio ou sem regras: null. Nunca chutar "direto";
// quem decide o fallback e o chamador.

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

export type SourceMethod = "link_token" | "mensagem_padrao" | "palavra_chave";

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

const TOKEN_REGEX = new RegExp(
  `#([${TOKEN_ALPHABET}]{${TOKEN_LENGTH}})`,
  "i",
);

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

export function atribuirOrigem(
  corpo: string | null,
  regras: readonly CampaignRule[],
): Attribution | null {
  if (!corpo || regras.length === 0) {
    return null;
  }

  // 1. Token do link: prova mais forte, ganha de tudo.
  const token = extrairToken(corpo);
  if (token) {
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

  // 2. Mensagem padrao: so igualdade total do texto normalizado.
  for (const regra of regras) {
    if (
      regra.defaultMessage &&
      normalizarTexto(regra.defaultMessage) === corpoNormalizado
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
