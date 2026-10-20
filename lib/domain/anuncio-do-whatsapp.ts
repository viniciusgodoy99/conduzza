// Detalhes do anuncio de clique para WhatsApp (pedido do dono em 20/10/2026):
// o titulo, a descricao e o link que o cartao "Detalhes do anuncio" da uazapi
// mostra. Chegam na mensagem que o paciente manda depois de tocar no anuncio
// (referral ou externalAdReply) e sao guardados POR ANUNCIO em
// anuncio_do_whatsapp (migration 20261020100000), nunca no contato.
//
// Regras PURAS, sem I/O, isomorficas: o parser do webhook saneia com elas,
// as telas leem os tipos e o rotulo, e o link e conferido de novo antes de
// virar "Abrir anuncio" (a tela nao confia so no que esta gravado).
//
// O texto vem de quem mandou a mensagem: num canal nao oficial um remetente
// pode forjar o referral. Por isso o saneamento tira caractere de controle e
// de direcao de texto, corta sem partir caractere, e o link so vale em https
// e num endereco onde o anuncio vive (lista fechada, host exato). O texto
// nunca vai para log.

/** Teto do titulo, em caracteres (o CHECK da tabela usa o mesmo). */
export const LIMITE_DO_TITULO_DO_ANUNCIO = 300;
/** Teto da descricao, em caracteres (o CHECK da tabela usa o mesmo). */
export const LIMITE_DA_DESCRICAO_DO_ANUNCIO = 2000;
/** Teto do link, em caracteres (o CHECK da tabela usa o mesmo). */
export const LIMITE_DO_LINK_DO_ANUNCIO = 2000;

/** O id de anuncio que a tabela aceita (o mesmo de meta_anuncio). */
export const FORMATO_DO_ID_DO_ANUNCIO = /^[0-9]{1,32}$/;

export const TITULO_DO_BLOCO_DO_ANUNCIO = "Detalhes do anúncio";
// Frase neutra: a tela nao sabe se os detalhes nao vieram na mensagem, se a
// mensagem e de antes da publicacao ou se a gravacao falhou.
export const TEXTO_SEM_DETALHES_DO_ANUNCIO =
  "Os detalhes deste anúncio ainda não estão disponíveis.";
export const TEXTO_ERRO_DOS_DETALHES_DO_ANUNCIO =
  "Não foi possível carregar os detalhes do anúncio.";
export const TEXTO_CARREGANDO_DETALHES_DO_ANUNCIO =
  "Carregando os detalhes do anúncio";

// Controles C0, DEL e C1 (categoria Cc, U+0000 a U+001F e U+007F a U+009F),
// e os mesmos menos a quebra de linha (LF), que a descricao guarda.
const CONTROLES = /\p{Cc}/gu;
const CONTROLES_MENOS_QUEBRA = /[^\P{Cc}\n]/gu;
// Marcas de direcao de texto (Cf), que invertem o que a tela mostra. O resto
// da categoria Cf fica: o ZWJ monta emoji de varias partes (profissional de saude).
const DIRECAO_DE_TEXTO =
  /[\u{61c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;
// Metade de par substituto sem a outra metade: o Postgres recusa o texto
// inteiro (e a gravacao toda falharia por um caractere quebrado).
const SUBSTITUTO_SOLTO = /[\u{d800}-\u{dfff}]/gu;
// O que pode sobrar na ponta de um corte sem segmentador: juntor e seletor.
const JUNTOR_NA_PONTA = /[\u{200d}\u{fe0e}\u{fe0f}]+$/u;
// Quebras de linha que nao sao LF nem CR: NEL (U+0085, o "..." do
// Windows-1252 lido como Latin-1), LS e PS. Na descricao viram LF.
const OUTRAS_QUEBRAS = /[\u{85}\u{2028}\u{2029}]/gu;
// Espacos que sao controle: tabulacao, VT e FF. Na descricao viram espaco
// (tira-los colaria as palavras).
const ESPACOS_DE_CONTROLE = /[\t\v\f]/g;

type Segmentador = {
  segment: (texto: string) => Iterable<{ segment: string }>;
};

function segmentadorDeGrafemas(): Segmentador | null {
  const intl = Intl as unknown as {
    Segmenter?: new (
      locale: string,
      opcoes: { granularity: "grapheme" },
    ) => Segmentador;
  };
  return intl.Segmenter
    ? new intl.Segmenter("pt-BR", { granularity: "grapheme" })
    : null;
}

/**
 * Corta em `limite` caracteres (pontos de codigo, como o char_length do
 * banco) sem partir um caractere visivel: emoji de varias partes e letra com
 * acento combinado ficam inteiros ou saem inteiros. Depois tira o espaco que
 * sobrar na ponta. Vazio vira null.
 */
export function cortarSemPartir(texto: string, limite: number): string | null {
  if (Array.from(texto).length <= limite) {
    return texto === "" ? null : texto;
  }
  let cortado = "";
  const segmentador = segmentadorDeGrafemas();
  if (segmentador) {
    let usados = 0;
    for (const { segment } of segmentador.segment(texto)) {
      const tamanho = Array.from(segment).length;
      if (usados + tamanho > limite) {
        break;
      }
      cortado += segment;
      usados += tamanho;
    }
  } else {
    cortado = Array.from(texto)
      .slice(0, limite)
      .join("")
      .replace(JUNTOR_NA_PONTA, "");
  }
  const final = cortado.trimEnd();
  return final === "" ? null : final;
}

function textoSemRisco(bruto: string): string {
  return bruto.replace(SUBSTITUTO_SOLTO, "").replace(DIRECAO_DE_TEXTO, "");
}

/**
 * Titulo do anuncio, pronto para guardar: uma linha so (quebra, tabulacao e
 * qualquer controle viram espaco, espacos seguidos viram um), sem marca de
 * direcao de texto, aparado e com ate 300 caracteres. Vazio ou nao texto
 * vira null.
 */
export function sanearTituloDoAnuncio(bruto: unknown): string | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const umaLinha = textoSemRisco(bruto)
    .replace(CONTROLES, " ")
    .replace(/[\u{2028}\u{2029}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cortarSemPartir(umaLinha, LIMITE_DO_TITULO_DO_ANUNCIO);
}

/**
 * Descricao do anuncio, pronta para guardar: a quebra de linha fica (CRLF,
 * CR, NEL, LS e PS viram LF; tres ou mais quebras seguidas viram duas),
 * tabulacao, VT e FF viram espaco, os outros controles e as marcas de
 * direcao de texto saem; aparada e com ate 2.000 caracteres. Vazio ou nao
 * texto vira null.
 */
export function sanearDescricaoDoAnuncio(bruto: unknown): string | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const limpo = textoSemRisco(bruto)
    .replace(/\r\n?/g, "\n")
    .replace(OUTRAS_QUEBRAS, "\n")
    .replace(ESPACOS_DE_CONTROLE, " ")
    .replace(CONTROLES_MENOS_QUEBRA, "")
    .replace(/[ \u{a0}]+\n/gu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cortarSemPartir(limpo, LIMITE_DA_DESCRICAO_DO_ANUNCIO);
}

// Onde o anuncio vive: o sourceURL do clique para WhatsApp e o endereco do
// anuncio ou da publicacao (fb.me, fb.watch, facebook.com, instagram.com).
// Host EXATO, nunca "qualquer subdominio": l.facebook.com, lm.facebook.com e
// l.instagram.com sao redirecionadores (levam a qualquer site), e
// chat.whatsapp.com, wa.me, api.whatsapp.com, m.me, ig.me e messenger.com
// abrem grupo ou conversa, nao o anuncio. O texto do referral pode ser
// forjado por quem manda a mensagem, e o botao diz "Abrir anúncio".
const ENDERECOS_DO_ANUNCIO: ReadonlySet<string> = new Set([
  "fb.me",
  "fb.watch",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "business.facebook.com",
  "instagram.com",
  "www.instagram.com",
]);

function trechoDecodificado(trecho: string): string {
  try {
    return decodeURIComponent(trecho);
  } catch {
    return trecho;
  }
}

/**
 * Redirecionamento num endereco aceito: o /l.php do Facebook (em qualquer
 * host, com o caminho escrito como for) ou o parametro u= (o destino do
 * redirecionamento, tambem o do /flx/warn/).
 */
function eRedirecionamento(url: URL): boolean {
  return (
    url.pathname
      .split("/")
      .some((trecho) => trechoDecodificado(trecho).toLowerCase() === "l.php") ||
    url.searchParams.has("u")
  );
}

/**
 * Link do anuncio: so https, num endereco onde o anuncio vive (lista fechada,
 * host exato), sem redirecionamento, sem usuario nem senha, sem porta, sem
 * espaco nem controle, com ate 2.000 caracteres (ja normalizado pelo URL).
 * Qualquer outra coisa vira null. A MESMA funcao serve ao parser (o que e
 * gravado) e a tela (que confere de novo antes do "Abrir anuncio").
 */
export function sanearLinkDoAnuncio(bruto: unknown): string | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const texto = bruto.trim();
  if (
    texto === "" ||
    texto.length > LIMITE_DO_LINK_DO_ANUNCIO ||
    /[\s\p{Cc}]/u.test(texto)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !ENDERECOS_DO_ANUNCIO.has(url.hostname) ||
    eRedirecionamento(url)
  ) {
    return null;
  }
  const normalizado = url.href;
  return normalizado.length <= LIMITE_DO_LINK_DO_ANUNCIO ? normalizado : null;
}

/**
 * O id do anuncio aparado pela regra do JavaScript (String.prototype.trim:
 * espaco Unicode, tabulacao, quebras de linha, NBSP e BOM). A MESMA regra
 * vale no id que vai para o contato (source_ad_id), na gravacao dos detalhes
 * e em anuncios_do_periodo (o btrim com a mesma lista de caracteres, na
 * migration 20261020100000): o mesmo id cai no mesmo anuncio na ficha e em
 * Resultados. Vazio vira null.
 */
export function apararIdDoAnuncio(
  adId: string | null | undefined,
): string | null {
  const aparado = adId?.trim();
  return aparado ? aparado : null;
}

/** Id de anuncio no formato da tabela; qualquer outra coisa vira null. */
export function idDoAnuncioDoWhatsapp(
  adId: string | null | undefined,
): string | null {
  const limpo = apararIdDoAnuncio(adId);
  return limpo && FORMATO_DO_ID_DO_ANUNCIO.test(limpo) ? limpo : null;
}

/** Os detalhes guardados de um anuncio, so o que as telas mostram. */
export type DetalhesDoAnuncio = {
  ad_id: string;
  titulo: string | null;
  descricao: string | null;
  link: string | null;
};

/**
 * Como ficou a leitura de anuncio_do_whatsapp para o contato. "lida" com
 * detalhes nulos: nada foi guardado para o anuncio (os detalhes nao vieram
 * na mensagem, a mensagem e de antes da publicacao, a gravacao falhou, ou o
 * contato nem tem o codigo do anuncio).
 */
export type LeituraDosDetalhes =
  | { estado: "carregando" }
  | { estado: "erro" }
  | { estado: "lida"; detalhes: DetalhesDoAnuncio | null };

export const LEITURA_SEM_DETALHES: LeituraDosDetalhes = {
  estado: "lida",
  detalhes: null,
};

/** O que o bloco mostra: titulo, descricao e o link que passa na conferencia. */
export function detalhesParaMostrar(detalhes: DetalhesDoAnuncio | null): {
  titulo: string | null;
  descricao: string | null;
  link: string | null;
} | null {
  if (!detalhes) {
    return null;
  }
  const titulo = detalhes.titulo?.trim() ? detalhes.titulo : null;
  const descricao = detalhes.descricao?.trim() ? detalhes.descricao : null;
  const link = sanearLinkDoAnuncio(detalhes.link);
  if (!titulo && !descricao && !link) {
    return null;
  }
  return { titulo, descricao, link };
}

/** Linhas da descricao antes do "Ver mais". */
export const LINHAS_DA_DESCRICAO = 3;

/**
 * Caracteres por linha da descricao (13px, Manrope, quebra por palavra) na
 * largura do texto em cada tela, calibrados no Chromium com o CSS do app em
 * 846 descricoes de 40 a 320 caracteres (20/10/2026): o numero que menos
 * erra "passa de 3 linhas". Sao a estimativa antes de medir: o HTML do
 * servidor (a ficha) sai com ela, e um "Ver mais" que some ou aparece na
 * hidratacao faria a tela pular 40px.
 * - painel: o painel do Atendimento (320px; texto de 259px);
 * - gaveta: a gaveta de Leads (480px; texto de 412px);
 * - ficha: o cartao Origem da ficha (coluna de 380px a partir de 1024px;
 *   texto de 320px).
 */
export const CARACTERES_POR_LINHA_DA_DESCRICAO = {
  painel: 39,
  gaveta: 64,
  ficha: 49,
} as const;

export type TelaDosDetalhes = keyof typeof CARACTERES_POR_LINHA_DA_DESCRICAO;

/**
 * Descricao que provavelmente passa de 3 linhas na largura da tela, antes
 * de medir: cada paragrafo (a quebra de linha fica, whitespace-pre-line)
 * ocupa ao menos uma linha, e as linhas dele sao o tamanho dividido pelos
 * caracteres por linha da tela.
 */
export function descricaoPareceLonga(
  texto: string,
  caracteresPorLinha: number,
): boolean {
  let linhas = 0;
  for (const paragrafo of texto.split("\n")) {
    linhas += Math.max(
      1,
      Math.ceil(Array.from(paragrafo).length / caracteresPorLinha),
    );
    if (linhas > LINHAS_DA_DESCRICAO) {
      return true;
    }
  }
  return false;
}

/**
 * O id inteiro do anuncio entre parenteses: "(id 120240624148610289)". E o
 * que se procura no Gerenciador de Anuncios, e nunca repete entre duas
 * linhas (ids de uma mesma conta costumam terminar igual: os dois anuncios
 * reais da primeira clinica terminam em 10289).
 */
export function idEntreParenteses(adId: string): string {
  return `(id ${adId})`;
}

/**
 * Rotulo de um anuncio em Resultados: o titulo guardado; senao o nome do
 * anuncio na Meta; senao "Anúncio sem título (id 120240624148610289)".
 */
export function rotuloDoAnuncio(linha: {
  adId: string;
  titulo: string | null;
  nomeNaMeta: string | null;
}): string {
  return (
    linha.titulo?.trim() ||
    linha.nomeNaMeta?.trim() ||
    `Anúncio sem título ${idEntreParenteses(linha.adId)}`
  );
}
