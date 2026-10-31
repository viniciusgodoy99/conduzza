// O arquivo do paciente pronto para o modelo (AG6b, desenho 4.4): o tipo
// pelos primeiros bytes, os limites, a limpeza e a medida da duracao e das
// paginas. PURO (sem rede, sem banco, sem biblioteca nova: so node:zlib,
// para o fluxo de objetos do PDF, e node:crypto, para a versao da
// figurinha). Roda so no servidor.
//
// A limpeza e por LISTA DO QUE FICA (revisao da 6eae43d): so sai o que a
// lista diz; o inesperado deixa o arquivo de fora (falha fechada) e nunca
// passa como esta.
//
// A CPU (segunda revisao da d1a15f6): o preparo e SINCRONO e roda dentro do
// motor (a rota tem maxDuration de 60 s e roda jobs de varias clinicas
// juntos); o corte duro do motor nao interrompe CPU. Por isso cada arquivo
// tem UM orcamento de trabalho (LIMITES_DA_MIDIA.trabalhoPorArquivo),
// passado a toda funcao de leitura (PDF, JPEG, PNG, WebP, MP3, XMP e as
// fotos de dentro do PDF) e cobrado em cada laco (bytes, objetos,
// referencias, casamentos de expressao): acabou, o arquivo nao sai
// ("bomba"). Nenhuma expressao tem quantificadores que se sobrepoem (nada e
// varrido de novo a cada tentativa), e a entrada nunca e alterada (a
// limpeza no lugar trabalha numa copia).
//
// Regras (D-59, D-92, D-98, D-101):
//  - o tipo vem dos PRIMEIROS BYTES e do media_mimetype da mensagem; os dois
//    tem de dizer o mesmo, senao o arquivo nao sai (nao suportado). HEIC,
//    GIF, video, DOCX, XLSX, ZIP e HTML nunca saem;
//  - AUDIO: so o MP3 (a uazapi gera MP3, generate_mp3). Saem SO os quadros
//    MPEG: cada cabecalho conferido (sincronia, versao, camada, taxa,
//    frequencia, preenchimento), a versao, a camada e a frequencia iguais
//    as do primeiro quadro, e o quadro achado depois de lixo confirmado pelo
//    seguinte. ID3v2 (no comeco, no meio ou no fim), ID3v1, APE, Lyrics3 e
//    qualquer byte fora de quadro nunca saem. A duracao e a soma dos
//    quadros (vale para CBR e VBR). Sem quadros ou lixo demais: nao
//    suportado (a leitura para assim que o lixo passa do aceito). De 1 a
//    120 s e ate 5 MB;
//  - IMAGEM, ate 5 MB; o local e o aparelho nunca saem:
//    . JPEG: antes da primeira varredura ficam SOF0 a SOF2, DHT, DQT, DRI, o
//      APP0 JFIF (sem a miniatura) e o APP14 Adobe (de que a decodificacao
//      de cor depende); entre as varreduras, DHT, DQT, DRI, DNL e SOS; os
//      dados comprimidos como estao (FF00 e RST sao dados). Tudo acaba no
//      primeiro EOI: a segunda imagem (MPF), o video da foto com movimento e
//      qualquer coisa depois dele nunca saem. APP1 a APP15 e COM nunca saem;
//      um APP1 minimo leva so a Orientacao (tag 0x0112) quando a original
//      tinha valor diferente de 1. Outro marcador: nao suportado;
//    . PNG: ficam IHDR, PLTE, IDAT, IEND e os auxiliares de exibicao tRNS,
//      gAMA, cHRM, sRGB, sBIT, bKGD e pHYs. O resto nunca sai (texto, EXIF,
//      data, perfil ICC, C2PA, pedacos privados) e nada depois do IEND. PNG
//      animado (APNG), pedaco critico desconhecido ou mais de 65.536
//      pedacos: nao suportado;
//    . WebP: ficam VP8X (so a marca de alfa), ALPH e um VP8 ou VP8L; ICCP,
//      EXIF e XMP nunca saem, nem nada depois do RIFF; o tamanho do RIFF e
//      corrigido. Outro pedaco, ou mais de 65.536: nao suportado;
//  - FIGURINHA (D-98): WebP de exatamente 512 por 512 ou WebP animado. Nao
//    vai a modelo nenhum (a leitura e local);
//  - PDF, ate 5 MB e 3 paginas, sem criptografia (/Encrypt). As paginas sao
//    a MAIOR entre o /Count dos nos /Type /Pages, os objetos /Type /Page e
//    os filhos das listas /Kids que nao sao no, cada objeto pelo numero (o
//    reescrito numa atualizacao incremental conta uma vez; a lista ou o
//    /Count indireto e lido uma vez por numero), no texto e dentro dos
//    fluxos de objetos (/Type /ObjStm, descomprimidos com node:zlib). Sem
//    /Count: nao suportado. Tetos contra o arquivo feito para travar o motor
//    (fluxos, objetos, o descomprimido no total, o XMP de cada fluxo de
//    metadados, a sobra do fluxo de objetos e o orcamento de trabalho):
//    "bomba". Um fluxo que comeca dentro de outro (no dicionario ou nos
//    dados): nao suportado. A foto embutida (fluxo so com /DCTDecode) e
//    limpa no lugar, numa copia e sem mudar o tamanho (o /Length e a xref
//    continuam certos): APP1 a APP15 e COM viram um COM zerado do mesmo
//    tamanho (ficam o APP0 JFIF, sem a miniatura, e o APP14 Adobe) e o que
//    vem depois do primeiro EOI vira zero. /DCTDecode numa cadeia de
//    filtros, ou /JPXDecode: nao suportado. Os metadados do PDF ficam
//    (D-101: tirar exigiria biblioteca nova), MENOS a localizacao e o
//    anexo, que deixam o PDF de fora (nao suportado):
//    . a localizacao: exif:GPS, GPSLatitude, GPSLongitude, a coordenada no
//      formato do XMP ("3,43.914S"), uma coordenada numa propriedade
//      photoshop: ou xmp:, ou o lugar escrito por extenso com valor (City,
//      State, Country, CountryCode, CountryName, ProvinceState,
//      Sublocation, Location, LocationName, LocationId e WorldRegion, com
//      qualquer prefixo: photoshop:, Iptc4xmpCore:, Iptc4xmpExt:, ns2:...;
//      o valor vazio e a chave sem valor nao contam), no XMP de cada fluxo
//      de metadados (/Type /Metadata, /Subtype /XML ou o que um /Metadata
//      aponta: do catalogo, da pagina, da foto; descomprimido com o teto) e,
//      as propriedades de GPS, o lugar e as chaves /City e /GPS... do
//      dicionario /Info (com valor), em qualquer lugar do arquivo sem
//      compressao e dentro dos fluxos de objetos. Metadado que nao da para
//      ler (outro filtro): nao suportado;
//    . o anexo: /EmbeddedFile, /EmbeddedFiles ou /FileAttachment (tambem
//      escritos com #xx), no arquivo e nos fluxos de objetos, ou a chave /EF
//      de um /Filespec.
//    RISCO RESIDUAL (aceito): a imagem embutida no proprio conteudo da
//    pagina (BI ... ID ... EI, com /DCT) nao e limpa nem recusada. O
//    conteudo vem comprimido e nao e descomprimido aqui (custo); se essa
//    imagem tiver Exif, ele vai junto.
//
// Nada daqui vai para log alem do motivo (lista fechada).

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/** Um megabyte (MiB). */
const MB = 1024 * 1024;

/**
 * Os limites do arquivo (D-59 e D-92): o contrato com o motor e com a tela.
 * Ate 3 midias por turno (audio, imagem e documento somados).
 */
export const LIMITES_DA_MIDIA = {
  audio: {
    minimoDeSegundos: 1,
    maximoDeSegundos: 120,
    maximoDeBytes: 5 * MB,
  },
  imagem: { maximoDeBytes: 5 * MB },
  pdf: { maximoDeBytes: 5 * MB, maximoDePaginas: 3 },
  /** Audio, imagem e documento somados, num turno. */
  porTurno: 3,
  /**
   * Teto descomprimido do PDF, somados os fluxos de objetos e os de
   * metadados (bomba de compressao). Nos PDFs reais conferidos, o maior
   * fluxo de objetos tinha 295 bytes e o maior XMP 357 KB.
   */
  pdfDescomprimidoNoTotal: 8 * MB,
  /** Teto de fluxos de objetos lidos num PDF. */
  pdfFluxosDeObjetos: 200,
  /** Teto de fluxos num PDF, e de marcas "endstream" (o de 3 paginas tem dezenas). */
  pdfFluxos: 2_000,
  /** Teto de objetos num PDF: os cabecalhos "N G obj" e os de dentro dos fluxos de objetos. */
  pdfObjetos: 20_000,
  /**
   * Teto do XMP de UM fluxo de metadados (descomprimido): passou, "bomba".
   * O maior dos PDFs reais conferidos (880) tinha 357 KB.
   */
  pdfXmp: 2 * MB,
  /** O que pode sobrar num fluxo de objetos depois do ultimo objeto declarado. */
  pdfSobraNoFluxoDeObjetos: 64 * 1024,
  /**
   * O orcamento de trabalho de UM arquivo, de qualquer tipo, em unidades de
   * CUSTO (mais ou menos um caractere andado por um laco em JS). Cada laco
   * da leitura cobra dele; acabou: "bomba". Calibrado medindo o pior caso
   * de cada laco contra um laco de referencia (uma unidade por caractere):
   * nenhum passou de 2 vezes a referencia por unidade, e o pior arquivo de
   * ate 5 MB fica abaixo de 300 ms num Apple M3 mesmo com a maquina ocupada.
   * O arquivo real mais caro dos 5.327 conferidos gastou 2,3 milhoes.
   */
  trabalhoPorArquivo: 64_000_000,
} as const;

/** O maior arquivo que o motor aceita baixar do Storage, de qualquer tipo. */
export const MAIOR_ARQUIVO_PARA_A_IA = Math.max(
  LIMITES_DA_MIDIA.audio.maximoDeBytes,
  LIMITES_DA_MIDIA.imagem.maximoDeBytes,
  LIMITES_DA_MIDIA.pdf.maximoDeBytes,
);

/** O que o arquivo e, pelos primeiros bytes. */
export type FormatoDoArquivo = "mp3" | "jpeg" | "png" | "webp" | "pdf";

/** Por que o arquivo nao sai (lista fechada: pode ir para log). */
export const MOTIVOS_DE_FORA = [
  "grande_demais",
  "vazio",
  "formato",
  "tipo_divergente",
  "curto_demais",
  "longo_demais",
  "sem_quadros",
  "fora_de_sincronia",
  "corrompido",
  "cifrado",
  "sem_paginas",
  "paginas_demais",
  "bomba",
] as const;
export type MotivoDeFora = (typeof MOTIVOS_DE_FORA)[number];

/** A midia da mensagem (message.content_type). */
export type MidiaDaMensagem = "audio" | "imagem" | "documento";

export type MidiaPreparada =
  | { tipo: "audio"; bytes: Uint8Array; segundos: number }
  | {
      tipo: "imagem";
      formato: "jpeg" | "png" | "webp";
      bytes: Uint8Array;
    }
  | { tipo: "figurinha" }
  | { tipo: "pdf"; bytes: Uint8Array; paginas: number }
  | { tipo: "fora"; motivo: MotivoDeFora };

function fora(motivo: MotivoDeFora): MidiaPreparada {
  return { tipo: "fora", motivo };
}

// ---------------------------------------------------------------------------
// O orcamento de trabalho
// ---------------------------------------------------------------------------

/** O arquivo fica de fora: lancado de dentro da leitura, convertido em prepararMidia. */
class MidiaDeFora extends Error {
  constructor(readonly motivo: MotivoDeFora) {
    super(motivo);
  }
}

/** O trabalho que ainda cabe no preparo de UM arquivo (em unidades de CUSTO). */
type Trabalho = { restante: number };

function novoTrabalho(): Trabalho {
  return { restante: LIMITES_DA_MIDIA.trabalhoPorArquivo };
}

/**
 * O preco de cada coisa no orcamento, em unidades. Uma unidade e mais ou
 * menos um caractere andado por um laco em JS; o codigo nativo (indexOf,
 * copia, zlib, expressao sem volta atras) anda mais por unidade, e a volta
 * que aloca (um objeto, um casamento, um quadro) custa mais. Os pesos vem
 * da medida do pior caso de cada laco (o laco de referencia e o fimDaString:
 * uma unidade por caractere).
 */
const CUSTO = {
  /** Um caractere (ou byte) andado por um laco em JS. */
  caractere: 1,
  /** Um byte andado por codigo nativo: indexOf, copia, latin1. */
  nativo: 1 / 16,
  /** Um caractere varrido por uma expressao sem volta atras. */
  expressao: 1 / 2,
  /** Um byte entregue pelo zlib. */
  zlib: 1 / 4,
  /**
   * Um caractere de um valor lido como lista de nomes: cada nome ("/A", dois
   * caracteres) vira um texto novo, cobrado antes de criar.
   */
  nome: 24,
  /** Uma volta de laco que nao aloca nem chama nada (um passo de uma procura). */
  passo: 4,
  /** Uma volta de laco que chama codigo nativo (um indexOf, uma copia). */
  chamada: 16,
  /** Uma volta de laco que aloca (um quadro, um segmento, um pedaco, uma chave). */
  volta: 48,
  /** Um objeto do PDF (o casamento do cabecalho, o dicionario, o objeto). */
  objeto: 256,
} as const;

/** Cobra o trabalho; acabou: "bomba". */
function gastar(trabalho: Trabalho, unidades: number): void {
  trabalho.restante -= unidades;
  if (trabalho.restante < 0) {
    throw new MidiaDeFora("bomba");
  }
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

function comecaCom(bytes: Uint8Array, assinatura: readonly number[], de = 0) {
  if (de < 0 || bytes.length < de + assinatura.length) {
    return false;
  }
  return assinatura.every((b, i) => bytes[de + i] === b);
}

function ascii(texto: string): number[] {
  return Array.from(texto, (c) => c.charCodeAt(0));
}

function u24le(bytes: Uint8Array, p: number): number {
  return (bytes[p] ?? 0) | ((bytes[p + 1] ?? 0) << 8) | ((bytes[p + 2] ?? 0) << 16);
}

function u32le(bytes: Uint8Array, p: number): number {
  return (
    ((bytes[p] ?? 0) |
      ((bytes[p + 1] ?? 0) << 8) |
      ((bytes[p + 2] ?? 0) << 16) |
      ((bytes[p + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Um inteiro "syncsafe" de 4 bytes (7 bits por byte), ou null. */
function syncsafe(bytes: Uint8Array, p: number): number | null {
  const b0 = bytes[p] ?? 0x80;
  const b1 = bytes[p + 1] ?? 0x80;
  const b2 = bytes[p + 2] ?? 0x80;
  const b3 = bytes[p + 3] ?? 0x80;
  if ((b0 | b1 | b2 | b3) >= 0x80) {
    return null;
  }
  return (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
}

/** Junta as partes num arquivo novo (cada parte e a copia sao cobradas). */
function juntar(partes: readonly Uint8Array[], trabalho: Trabalho): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0);
  gastar(trabalho, partes.length * CUSTO.chamada + total * CUSTO.nativo);
  const saida = new Uint8Array(total);
  let p = 0;
  for (const parte of partes) {
    saida.set(parte, p);
    p += parte.length;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// O tipo pelos primeiros bytes e pelo mimetype
// ---------------------------------------------------------------------------

/** Um cabecalho de quadro MPEG valido (sincronia e campos possiveis). */
function cabecalhoMpegValido(bytes: Uint8Array, p: number): boolean {
  return quadroMpeg(bytes, p) !== null;
}

/**
 * O formato pelos primeiros bytes. HEIC, GIF, video (ftyp), ZIP (DOCX e
 * XLSX inclusive), HTML e o resto: null (nao suportado).
 */
export function formatoPelosPrimeirosBytes(
  bytes: Uint8Array,
): FormatoDoArquivo | null {
  if (comecaCom(bytes, ascii("%PDF-"))) {
    return "pdf";
  }
  if (comecaCom(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (comecaCom(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (comecaCom(bytes, ascii("RIFF")) && comecaCom(bytes, ascii("WEBP"), 8)) {
    return "webp";
  }
  if (comecaCom(bytes, ascii("ID3")) || cabecalhoMpegValido(bytes, 0)) {
    return "mp3";
  }
  return null;
}

/** O formato que o mimetype da mensagem diz (null: nenhum aceito). */
export function formatoPeloMimetype(
  mimetype: string | null | undefined,
): FormatoDoArquivo | null {
  const tipo = (mimetype ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  switch (tipo) {
    case "audio/mpeg":
    case "audio/mp3":
    case "audio/mpeg3":
      return "mp3";
    case "image/jpeg":
    case "image/jpg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return null;
  }
}

/** Os formatos que cada midia aceita (o documento pode ser foto). */
const FORMATOS_DA_MIDIA: Readonly<
  Record<MidiaDaMensagem, readonly FormatoDoArquivo[]>
> = {
  audio: ["mp3"],
  imagem: ["jpeg", "png", "webp"],
  documento: ["pdf", "jpeg", "png", "webp"],
};

/**
 * A midia que a mensagem diz e o mimetype aceitam este formato? Usado pelo
 * plano do turno ANTES de baixar o arquivo (so o mimetype; os bytes a porta
 * confere ao ler).
 */
export function mimetypeAceito(
  midia: MidiaDaMensagem,
  mimetype: string | null | undefined,
): boolean {
  const formato = formatoPeloMimetype(mimetype);
  return formato !== null && FORMATOS_DA_MIDIA[midia].includes(formato);
}

/**
 * Prepara o arquivo para o modelo, ou diz por que ele nao sai. Nunca lanca:
 * o que passa do orcamento de trabalho vira "bomba", e qualquer outra
 * excecao na leitura vira "corrompido". A entrada nunca e alterada.
 */
export function prepararMidia(entrada: {
  midia: MidiaDaMensagem;
  bytes: Uint8Array;
  mimetype: string | null | undefined;
}): MidiaPreparada {
  try {
    return prepararSemRede(entrada, novoTrabalho());
  } catch (erro) {
    return fora(erro instanceof MidiaDeFora ? erro.motivo : "corrompido");
  }
}

function prepararSemRede(
  entrada: {
    midia: MidiaDaMensagem;
    bytes: Uint8Array;
    mimetype: string | null | undefined;
  },
  trabalho: Trabalho,
): MidiaPreparada {
  const { bytes, midia } = entrada;
  if (bytes.length === 0) {
    return fora("vazio");
  }
  if (bytes.length > MAIOR_ARQUIVO_PARA_A_IA) {
    return fora("grande_demais");
  }
  const pelosBytes = formatoPelosPrimeirosBytes(bytes);
  const peloMimetype = formatoPeloMimetype(entrada.mimetype);
  if (pelosBytes === null || peloMimetype === null) {
    return fora("formato");
  }
  if (pelosBytes !== peloMimetype) {
    return fora("tipo_divergente");
  }
  if (!FORMATOS_DA_MIDIA[midia].includes(pelosBytes)) {
    return fora("formato");
  }
  switch (pelosBytes) {
    case "mp3":
      return prepararAudio(bytes, trabalho);
    case "jpeg":
      return prepararJpeg(bytes, trabalho);
    case "png":
      return prepararPng(bytes, trabalho);
    case "webp":
      return prepararWebp(bytes, trabalho);
    case "pdf":
      return prepararPdf(bytes, trabalho);
  }
}

// ---------------------------------------------------------------------------
// Audio: MP3, so os quadros
// ---------------------------------------------------------------------------

/** As assinaturas das etiquetas (montadas uma vez: o laco dos quadros as usa a cada byte). */
const ETIQUETA = {
  id3: ascii("ID3"),
  id3NoFim: ascii("3DI"),
  ape: ascii("APETAGEX"),
  id3v1: ascii("TAG"),
  id3v1Estendida: ascii("TAG+"),
  lyricsComeco: ascii("LYRICSBEGIN"),
  lyrics2: ascii("LYRICS200"),
  lyricsFim: ascii("LYRICSEND"),
} as const;

/** O tamanho de uma etiqueta ID3v2 que comeca em p, com o cabecalho e o rodape. */
function tamanhoDoId3v2(bytes: Uint8Array, p: number): number | null {
  if (bytes[p] !== 0x49 || !comecaCom(bytes, ETIQUETA.id3, p) || bytes.length < p + 10) {
    return null;
  }
  // Versao e revisao nunca sao 0xFF.
  if ((bytes[p + 3] ?? 0xff) === 0xff || (bytes[p + 4] ?? 0xff) === 0xff) {
    return null;
  }
  const corpo = syncsafe(bytes, p + 6);
  if (corpo === null) {
    return null;
  }
  const flags = bytes[p + 5] ?? 0;
  // Rodape (flag 0x10): mais 10 bytes.
  return 10 + corpo + ((flags & 0x10) !== 0 ? 10 : 0);
}

/** A etiqueta APE que comeca em p (pelo cabecalho): o tamanho, ou null. */
function tamanhoDoApeNoComeco(bytes: Uint8Array, p: number, fim: number): number | null {
  if (p + 32 > fim || !comecaCom(bytes, ETIQUETA.ape, p)) {
    return null;
  }
  const marcas = u32le(bytes, p + 20);
  if ((marcas & 0x20000000) === 0) {
    return null; // e rodape, nao cabecalho
  }
  // O tamanho do cabecalho conta os itens e o rodape, nao o cabecalho.
  const total = u32le(bytes, p + 12) + 32;
  return total >= 64 && p + total <= fim ? total : null;
}

/** A etiqueta APE que termina em fim (pelo rodape): o tamanho, ou null. */
function tamanhoDoApeNoFim(bytes: Uint8Array, inicio: number, fim: number): number | null {
  const rodape = fim - 32;
  if (rodape < inicio || !comecaCom(bytes, ETIQUETA.ape, rodape)) {
    return null;
  }
  const marcas = u32le(bytes, rodape + 20);
  if ((marcas & 0x20000000) !== 0) {
    return null; // e cabecalho, nao rodape
  }
  const total = u32le(bytes, rodape + 12) + ((marcas & 0x80000000) !== 0 ? 32 : 0);
  return total >= 32 && fim - total >= inicio ? total : null;
}

/** A etiqueta Lyrics3 (v1 ou v2) que termina em fim: o tamanho, ou null. */
function tamanhoDoLyrics3NoFim(
  bytes: Uint8Array,
  inicio: number,
  fim: number,
  trabalho: Trabalho,
): number | null {
  const comeco = ETIQUETA.lyricsComeco;
  if (fim - 15 >= inicio && comecaCom(bytes, ETIQUETA.lyrics2, fim - 9)) {
    // v2: o tamanho em 6 digitos antes de "LYRICS200" (com o "LYRICSBEGIN").
    const digitos = String.fromCharCode(...bytes.subarray(fim - 15, fim - 9));
    if (!/^\d{6}$/.test(digitos)) {
      return null;
    }
    const total = Number(digitos) + 15;
    return fim - total >= inicio && comecaCom(bytes, comeco, fim - total) ? total : null;
  }
  if (fim - 20 >= inicio && comecaCom(bytes, ETIQUETA.lyricsFim, fim - 9)) {
    // v1: "LYRICSBEGIN" ate 5.100 bytes antes de "LYRICSEND".
    const ate = Math.max(inicio, fim - 9 - 5100 - comeco.length);
    for (let p = fim - 9 - comeco.length; p >= ate; p -= 1) {
      gastar(trabalho, CUSTO.passo);
      if (comecaCom(bytes, comeco, p)) {
        return fim - p;
      }
    }
  }
  return null;
}

/** A etiqueta ID3v2 anexada no fim (rodape "3DI"): o tamanho, ou null. */
function tamanhoDoId3v2NoFim(bytes: Uint8Array, inicio: number, fim: number): number | null {
  const rodape = fim - 10;
  if (rodape < inicio || !comecaCom(bytes, ETIQUETA.id3NoFim, rodape)) {
    return null;
  }
  const corpo = syncsafe(bytes, rodape + 6);
  if (corpo === null) {
    return null;
  }
  const total = 10 + corpo + 10;
  return fim - total >= inicio && comecaCom(bytes, ETIQUETA.id3, fim - total) ? total : null;
}

/**
 * Onde estao os quadros: o arquivo sem as etiquetas do comeco (ID3v2, APE
 * com cabecalho) e do fim (ID3v1 e o "TAG+", APE, Lyrics3, ID3v2 com
 * rodape), em qualquer ordem.
 */
function regiaoDoAudio(bytes: Uint8Array, trabalho: Trabalho): { inicio: number; fim: number } {
  let inicio = 0;
  for (let i = 0; i < 8; i += 1) {
    gastar(trabalho, CUSTO.volta);
    const id3 = tamanhoDoId3v2(bytes, inicio);
    if (id3 !== null) {
      inicio = Math.min(bytes.length, inicio + id3);
      continue;
    }
    const ape = tamanhoDoApeNoComeco(bytes, inicio, bytes.length);
    if (ape !== null) {
      inicio += ape;
      continue;
    }
    break;
  }
  let fim = bytes.length;
  for (let i = 0; i < 8; i += 1) {
    gastar(trabalho, CUSTO.volta);
    if (fim - 128 >= inicio && comecaCom(bytes, ETIQUETA.id3v1, fim - 128)) {
      fim -= 128;
      continue;
    }
    if (fim - 227 >= inicio && comecaCom(bytes, ETIQUETA.id3v1Estendida, fim - 227)) {
      fim -= 227;
      continue;
    }
    const etiqueta =
      tamanhoDoApeNoFim(bytes, inicio, fim) ??
      tamanhoDoLyrics3NoFim(bytes, inicio, fim, trabalho) ??
      tamanhoDoId3v2NoFim(bytes, inicio, fim);
    if (etiqueta === null) {
      break;
    }
    fim -= etiqueta;
  }
  return { inicio, fim: Math.max(inicio, fim) };
}

const TAXAS_KBPS: Readonly<Record<string, readonly number[]>> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/** As mesmas taxas por versao (0: MPEG-1; 1: MPEG-2 e 2.5) e camada (1 a 3), sem montar texto a cada quadro. */
const TAXAS_POR_VERSAO_E_CAMADA: readonly (readonly (readonly number[])[])[] = [1, 2].map(
  (versao) => [1, 2, 3].map((camada) => TAXAS_KBPS[`${versao}-${camada}`] ?? []),
);

const FREQUENCIAS: Readonly<Record<string, readonly number[]>> = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  mpeg25: [11025, 12000, 8000],
};

type QuadroMpeg = {
  tamanho: number;
  amostras: number;
  frequencia: number;
  versao: number;
  camada: number;
};

/** O quadro MPEG que comeca em p (cabecalho de 4 bytes), ou null. */
function quadroMpeg(bytes: Uint8Array, p: number): QuadroMpeg | null {
  if (p < 0 || p + 4 > bytes.length) {
    return null;
  }
  const b0 = bytes[p] ?? 0;
  const b1 = bytes[p + 1] ?? 0;
  const b2 = bytes[p + 2] ?? 0;
  const b3 = bytes[p + 3] ?? 0;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
    return null;
  }
  const versao = (b1 >> 3) & 0x03; // 00 MPEG2.5, 01 reservado, 10 MPEG2, 11 MPEG1
  const camada = (b1 >> 1) & 0x03; // 01 III, 10 II, 11 I
  if (versao === 0x01 || camada === 0x00) {
    return null;
  }
  const indiceDaTaxa = (b2 >> 4) & 0x0f;
  const indiceDaFrequencia = (b2 >> 2) & 0x03;
  const preenchimento = (b2 >> 1) & 0x01;
  if (indiceDaTaxa === 0 || indiceDaTaxa === 0x0f || indiceDaFrequencia === 3) {
    return null;
  }
  // Enfase 10 e reservada.
  if ((b3 & 0x03) === 0x02) {
    return null;
  }
  const mpeg1 = versao === 0x03;
  const numeroDaCamada = camada === 0x03 ? 1 : camada === 0x02 ? 2 : 3;
  const taxa =
    (TAXAS_POR_VERSAO_E_CAMADA[mpeg1 ? 0 : 1]?.[numeroDaCamada - 1]?.[indiceDaTaxa] ?? 0) *
    1000;
  const frequencia =
    FREQUENCIAS[mpeg1 ? "mpeg1" : versao === 0x02 ? "mpeg2" : "mpeg25"]?.[
      indiceDaFrequencia
    ] ?? 0;
  if (taxa === 0 || frequencia === 0) {
    return null;
  }
  let tamanho: number;
  let amostras: number;
  if (numeroDaCamada === 1) {
    tamanho = (Math.floor((12 * taxa) / frequencia) + preenchimento) * 4;
    amostras = 384;
  } else if (numeroDaCamada === 2) {
    tamanho = Math.floor((144 * taxa) / frequencia) + preenchimento;
    amostras = 1152;
  } else {
    const coeficiente = mpeg1 ? 144 : 72;
    tamanho = Math.floor((coeficiente * taxa) / frequencia) + preenchimento;
    amostras = mpeg1 ? 1152 : 576;
  }
  return tamanho >= 4 ? { tamanho, amostras, frequencia, versao, camada } : null;
}

/** Dois quadros do mesmo fluxo: a versao, a camada e a frequencia iguais. */
function mesmoFluxo(a: QuadroMpeg, b: QuadroMpeg): boolean {
  return a.versao === b.versao && a.camada === b.camada && a.frequencia === b.frequencia;
}

/**
 * O quadro em p CONFIRMADO: cabe ate o fim e o seguinte tambem e quadro do
 * mesmo fluxo (ou o fim e ali, ou ali comeca uma ID3v2 inteira). E assim
 * que um cabecalho falso no meio de uma etiqueta ou de lixo nao vira quadro.
 */
function quadroConfirmado(
  bytes: Uint8Array,
  p: number,
  fim: number,
  fluxo: QuadroMpeg | null,
): QuadroMpeg | null {
  const quadro = quadroMpeg(bytes, p);
  if (quadro === null || p + quadro.tamanho > fim) {
    return null;
  }
  if (fluxo !== null && !mesmoFluxo(quadro, fluxo)) {
    return null;
  }
  const seguinte = p + quadro.tamanho;
  if (seguinte === fim) {
    return quadro;
  }
  if (seguinte + 4 > fim) {
    return null;
  }
  const proximo = quadroMpeg(bytes, seguinte);
  if (proximo !== null && mesmoFluxo(proximo, quadro)) {
    return quadro;
  }
  const id3 = tamanhoDoId3v2(bytes, seguinte);
  return id3 !== null && seguinte + id3 <= fim ? quadro : null;
}

/**
 * Quanto lixo (bytes fora de quadro, fora das etiquetas reconhecidas) o MP3
 * pode ter antes de ser "fora de sincronia demais": 1% da regiao dos
 * quadros, com um piso de 2 KB (o ultimo quadro cortado e alguns bytes
 * soltos sao normais). O lixo nunca sai; o teto e so a qualidade.
 */
const LIXO_ACEITO = { fracao: 0.01, piso: 2048 } as const;

/** O lixo que a regiao dos quadros aceita, em bytes. */
function lixoAceito(regiao: number): number {
  return Math.max(LIXO_ACEITO.piso, regiao * LIXO_ACEITO.fracao);
}

type AnaliseDoMp3 = {
  /** Os quadros, na ordem (a lista do que fica). */
  quadros: Uint8Array[];
  segundos: number;
  /** O lixo achado (passou do aceito: a analise parou ali). */
  lixo: number;
  /** O tamanho da regiao dos quadros (sem as etiquetas). */
  regiao: number;
};

/**
 * Os quadros do MP3. null: nenhum quadro confirmado perto do comeco da
 * regiao (depois das etiquetas). A leitura para assim que o lixo passa do
 * aceito: o arquivo nao sai, e andar o resto byte a byte seria so CPU.
 */
function analisarMp3(bytes: Uint8Array, trabalho: Trabalho): AnaliseDoMp3 | null {
  const { inicio, fim } = regiaoDoAudio(bytes, trabalho);
  let p = -1;
  let fluxo: QuadroMpeg | null = null;
  const limite = Math.min(fim - 4, inicio + LIXO_ACEITO.piso);
  for (let q = inicio; q <= limite; q += 1) {
    gastar(trabalho, 2 * CUSTO.volta);
    const quadro = quadroConfirmado(bytes, q, fim, null);
    if (quadro !== null) {
      p = q;
      fluxo = quadro;
      break;
    }
  }
  if (fluxo === null) {
    return null;
  }
  const regiao = fim - inicio;
  const teto = lixoAceito(regiao);
  const vista = bytes.subarray(0, fim);
  const quadros: Uint8Array[] = [];
  let segundos = 0;
  let lixo = p - inicio;
  while (p + 4 <= fim) {
    gastar(trabalho, 2 * CUSTO.volta);
    // Todo quadro confirmado pelo seguinte, ate o que vem logo depois de
    // outro (lixo que comeca com FF FB nao passa por quadro).
    const quadro = quadroConfirmado(bytes, p, fim, fluxo);
    if (quadro !== null) {
      quadros.push(bytes.subarray(p, p + quadro.tamanho));
      segundos += quadro.amostras / quadro.frequencia;
      p += quadro.tamanho;
      continue;
    }
    // Uma etiqueta ID3v2 no meio: pulada inteira (nunca sai).
    const id3 = tamanhoDoId3v2(bytes, p);
    if (id3 !== null && p + id3 <= fim) {
      p += id3;
      continue;
    }
    // Fora de quadro: o lixo vai ate o proximo 0xFF (nunca sai).
    const proximo = vista.indexOf(0xff, p + 1);
    const ate = proximo < 0 ? fim : proximo;
    gastar(trabalho, (ate - p) * CUSTO.nativo);
    lixo += ate - p;
    p = ate;
    if (lixo > teto) {
      return { quadros, segundos, lixo, regiao };
    }
  }
  lixo += Math.max(0, fim - p);
  return { quadros, segundos, lixo, regiao };
}

function lixoDemais(analise: AnaliseDoMp3): boolean {
  return analise.lixo > lixoAceito(analise.regiao);
}

/** A analise do MP3 com um orcamento so dela; o que passa dele: null. */
function analisarMp3Sozinho(bytes: Uint8Array): AnaliseDoMp3 | null {
  try {
    return analisarMp3(bytes, novoTrabalho());
  } catch (erro) {
    if (erro instanceof MidiaDeFora) {
      return null;
    }
    throw erro;
  }
}

/**
 * Os bytes do MP3 so com os quadros MPEG (lista do que fica): sem ID3v2,
 * ID3v1, APE, Lyrics3 e nada entre os quadros. Sem quadro, com lixo demais
 * (o arquivo nao sairia) ou trabalho demais: vazio. (O nome ficou da
 * primeira versao, que so tirava o ID3.)
 */
export function semEtiquetasId3(bytes: Uint8Array): Uint8Array {
  const analise = analisarMp3Sozinho(bytes);
  if (analise === null || lixoDemais(analise)) {
    return new Uint8Array(0);
  }
  try {
    return juntar(analise.quadros, novoTrabalho());
  } catch (erro) {
    if (erro instanceof MidiaDeFora) {
      return new Uint8Array(0);
    }
    throw erro;
  }
}

/**
 * A duracao do MP3, somando os quadros. null quando nao ha quadro nenhum, o
 * lixo passa do aceito ou o trabalho passa do orcamento.
 */
export function duracaoDoMp3(bytes: Uint8Array): {
  segundos: number;
  quadros: number;
} | null {
  const analise = analisarMp3Sozinho(bytes);
  if (analise === null || analise.quadros.length === 0 || lixoDemais(analise)) {
    return null;
  }
  return { segundos: analise.segundos, quadros: analise.quadros.length };
}

function prepararAudio(bytes: Uint8Array, trabalho: Trabalho): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.audio.maximoDeBytes) {
    return fora("grande_demais");
  }
  const analise = analisarMp3(bytes, trabalho);
  if (analise === null || analise.quadros.length === 0) {
    return fora("sem_quadros");
  }
  if (lixoDemais(analise)) {
    return fora("fora_de_sincronia");
  }
  if (analise.segundos < LIMITES_DA_MIDIA.audio.minimoDeSegundos) {
    return fora("curto_demais");
  }
  if (analise.segundos > LIMITES_DA_MIDIA.audio.maximoDeSegundos) {
    return fora("longo_demais");
  }
  return {
    tipo: "audio",
    bytes: juntar(analise.quadros, trabalho),
    segundos: analise.segundos,
  };
}

// ---------------------------------------------------------------------------
// Imagem: JPEG
// ---------------------------------------------------------------------------

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DNL = 0xdc;
const DRI = 0xdd;
const DHT = 0xc4;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP14 = 0xee;
const COM = 0xfe;

/** Os quadros aceitos (Huffman): sequencial basico, estendido e progressivo. */
const SOF_ACEITOS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);

/** Teto de segmentos num JPEG (o de verdade tem dezenas). */
const SEGMENTOS_DO_JPEG = 4096;

function ehApp(marcador: number): boolean {
  return marcador >= 0xe0 && marcador <= 0xef;
}

/**
 * Lista do que pode existir: antes da primeira varredura, SOF0 a SOF2, DHT,
 * DQT, DRI, APPn, COM e SOS; entre as varreduras, DHT, DQT, DRI, DNL, APPn,
 * COM e SOS (o EOI e tratado antes). APPn e COM existem para sair.
 */
function marcadorPermitido(marcador: number, entreVarreduras: boolean): boolean {
  if (
    marcador === DHT ||
    marcador === DQT ||
    marcador === DRI ||
    marcador === SOS ||
    marcador === COM ||
    ehApp(marcador)
  ) {
    return true;
  }
  return entreVarreduras ? marcador === DNL : SOF_ACEITOS.has(marcador);
}

type PedacoDoJpeg =
  | {
      tipo: "segmento";
      marcador: number;
      /** O FF do marcador (sem o enchimento antes). */
      inicio: number;
      fim: number;
      antesDaVarredura: boolean;
    }
  | { tipo: "dados"; inicio: number; fim: number };

/**
 * Anda pelo JPEG de `de` (o SOI) ate o PRIMEIRO EOI, sem copiar nada: os
 * segmentos e os dados comprimidos de cada varredura (FF00 e preenchimento,
 * FFD0 a FFD7 sao RST e fazem parte dos dados, FF repetidos antes de um
 * marcador sao enchimento). Marcador fora da lista: "formato". Estrutura
 * quebrada ou sem EOI ate `ate`: "corrompido". Cada segmento e cada 0xFF
 * dos dados cobram do orcamento.
 */
function andarPeloJpeg(
  bytes: Uint8Array,
  de: number,
  ate: number,
  trabalho: Trabalho,
): { pedacos: PedacoDoJpeg[]; fimDoEoi: number } | { motivo: MotivoDeFora } {
  if (ate - de < 4 || bytes[de] !== 0xff || bytes[de + 1] !== SOI) {
    return { motivo: "corrompido" };
  }
  const vista = bytes.subarray(0, ate);
  const pedacos: PedacoDoJpeg[] = [];
  let p = de + 2;
  let quadros = 0;
  let varreduras = 0;
  for (;;) {
    gastar(trabalho, CUSTO.volta);
    if (p >= ate || vista[p] !== 0xff) {
      return { motivo: "corrompido" };
    }
    let q = p + 1;
    while (q < ate && vista[q] === 0xff) {
      q += 1;
    }
    gastar(trabalho, (q - p) * CUSTO.caractere);
    if (q >= ate) {
      return { motivo: "corrompido" };
    }
    const marcador = vista[q] ?? 0;
    if (marcador === EOI) {
      if (varreduras === 0) {
        // EOI sem SOS: imagem sem dados.
        return { motivo: "corrompido" };
      }
      pedacos.push({
        tipo: "segmento",
        marcador,
        inicio: q - 1,
        fim: q + 1,
        antesDaVarredura: false,
      });
      return { pedacos, fimDoEoi: q + 1 };
    }
    if (!marcadorPermitido(marcador, varreduras > 0)) {
      return { motivo: "formato" };
    }
    if (q + 3 > ate) {
      return { motivo: "corrompido" };
    }
    const tamanho = ((vista[q + 1] ?? 0) << 8) | (vista[q + 2] ?? 0);
    const fim = q + 1 + tamanho;
    if (tamanho < 2 || fim > ate) {
      return { motivo: "corrompido" };
    }
    if (pedacos.length >= SEGMENTOS_DO_JPEG) {
      return { motivo: "formato" };
    }
    if (SOF_ACEITOS.has(marcador)) {
      quadros += 1;
      if (quadros > 1) {
        return { motivo: "formato" };
      }
    }
    if (marcador === SOS && quadros === 0) {
      return { motivo: "corrompido" };
    }
    pedacos.push({
      tipo: "segmento",
      marcador,
      inicio: q - 1,
      fim,
      antesDaVarredura: varreduras === 0,
    });
    p = fim;
    if (marcador !== SOS) {
      continue;
    }
    varreduras += 1;
    // Os dados comprimidos da varredura, ate o proximo marcador.
    let r = p;
    for (;;) {
      const ff = vista.indexOf(0xff, r);
      if (ff < 0) {
        return { motivo: "corrompido" };
      }
      let s = ff + 1;
      while (s < ate && vista[s] === 0xff) {
        s += 1;
      }
      gastar(trabalho, CUSTO.chamada + (ff - r) * CUSTO.nativo + (s - ff) * CUSTO.caractere);
      if (s >= ate) {
        return { motivo: "corrompido" };
      }
      const seguinte = vista[s] ?? 0;
      if (seguinte === 0x00 || (seguinte >= 0xd0 && seguinte <= 0xd7)) {
        r = s + 1;
        continue;
      }
      pedacos.push({ tipo: "dados", inicio: p, fim: ff });
      p = ff;
      break;
    }
  }
}

/** O APP0 JFIF (o corpo de 14 bytes ou mais), sem a miniatura, ou null. */
function app0JfifSemMiniatura(corpo: Uint8Array): Uint8Array | null {
  if (corpo.length < 14 || !comecaCom(corpo, [...ascii("JFIF"), 0])) {
    return null;
  }
  // Identificador, versao, unidade e densidades; a miniatura 0 por 0.
  return Uint8Array.from([0xff, APP0, 0x00, 0x10, ...corpo.subarray(0, 12), 0, 0]);
}

/** O APP14 Adobe (o corpo de 12 bytes: versao, marcas e transformacao), ou null. */
function app14Adobe(corpo: Uint8Array): Uint8Array | null {
  if (corpo.length < 12 || !comecaCom(corpo, ascii("Adobe"))) {
    return null;
  }
  return Uint8Array.from([0xff, APP14, 0x00, 0x0e, ...corpo.subarray(0, 12)]);
}

/** A orientacao do EXIF (tag 0x0112) num APP1, ou null. */
export function orientacaoDoExif(app1: Uint8Array): number | null {
  // "Exif\0\0" e o cabecalho TIFF.
  if (!comecaCom(app1, [...ascii("Exif"), 0, 0])) {
    return null;
  }
  const tiff = 6;
  if (app1.length < tiff + 8) {
    return null;
  }
  const ordem = String.fromCharCode(app1[tiff] ?? 0, app1[tiff + 1] ?? 0);
  if (ordem !== "II" && ordem !== "MM") {
    return null;
  }
  const pequeno = ordem === "II";
  const u16 = (p: number) =>
    pequeno
      ? (app1[p] ?? 0) | ((app1[p + 1] ?? 0) << 8)
      : ((app1[p] ?? 0) << 8) | (app1[p + 1] ?? 0);
  const u32 = (p: number) =>
    pequeno
      ? ((app1[p] ?? 0) |
          ((app1[p + 1] ?? 0) << 8) |
          ((app1[p + 2] ?? 0) << 16) |
          ((app1[p + 3] ?? 0) << 24)) >>>
        0
      : (((app1[p] ?? 0) << 24) |
          ((app1[p + 1] ?? 0) << 16) |
          ((app1[p + 2] ?? 0) << 8) |
          (app1[p + 3] ?? 0)) >>>
        0;
  if (u16(tiff + 2) !== 42) {
    return null;
  }
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > app1.length) {
    return null;
  }
  const entradas = u16(ifd0);
  for (let i = 0; i < entradas && i < ENTRADAS_DO_IFD; i += 1) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > app1.length) {
      return null;
    }
    if (u16(e) === 0x0112) {
      // SHORT (3), contagem 1: o valor nos 2 primeiros bytes do campo.
      const tipo = u16(e + 2);
      if (tipo !== 3) {
        return null;
      }
      const valor = u16(e + 8);
      return valor >= 1 && valor <= 8 ? valor : null;
    }
  }
  return null;
}

/** Quantas entradas do IFD0 se olham procurando a orientacao. */
const ENTRADAS_DO_IFD = 512;

/** O APP1 minimo, so com a Orientacao (TIFF big-endian, um IFD, uma tag). */
export function app1SoComAOrientacao(orientacao: number): Uint8Array {
  const corpo = [
    ...ascii("Exif"),
    0,
    0,
    // TIFF: "MM", 42, primeiro IFD em 8.
    ...ascii("MM"),
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    // IFD0 com uma entrada.
    0x00,
    0x01,
    // 0x0112, SHORT, contagem 1, valor.
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    (orientacao >> 8) & 0xff,
    orientacao & 0xff,
    0x00,
    0x00,
    // Sem proximo IFD.
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const tamanho = corpo.length + 2;
  return Uint8Array.from([0xff, 0xe1, (tamanho >> 8) & 0xff, tamanho & 0xff, ...corpo]);
}

function prepararJpeg(bytes: Uint8Array, trabalho: Trabalho): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const andado = andarPeloJpeg(bytes, 0, bytes.length, trabalho);
  if ("motivo" in andado) {
    return fora(andado.motivo);
  }
  const partes: Uint8Array[] = [Uint8Array.from([0xff, SOI])];
  let orientacao: number | null = null;
  let posicaoDoApp1 = 1; // depois do SOI (e do APP0, se ele vier logo depois)
  let comJfif = false;
  let comAdobe = false;
  for (const pedaco of andado.pedacos) {
    if (pedaco.tipo === "dados") {
      partes.push(bytes.subarray(pedaco.inicio, pedaco.fim));
      continue;
    }
    const { marcador, inicio, fim, antesDaVarredura } = pedaco;
    const corpo = bytes.subarray(inicio + 4, fim);
    if (marcador === APP0 && antesDaVarredura && !comJfif) {
      const jfif = app0JfifSemMiniatura(corpo);
      if (jfif !== null) {
        comJfif = true;
        partes.push(jfif);
        if (partes.length === 2) {
          posicaoDoApp1 = 2;
        }
      }
      continue;
    }
    if (marcador === APP14 && antesDaVarredura && !comAdobe) {
      const adobe = app14Adobe(corpo);
      if (adobe !== null) {
        comAdobe = true;
        partes.push(adobe);
      }
      continue;
    }
    if (ehApp(marcador) || marcador === COM) {
      // Nunca sai; do APP1 antes da varredura so se le a orientacao.
      if (marcador === APP1 && antesDaVarredura && orientacao === null) {
        gastar(trabalho, CUSTO.volta + Math.min(corpo.length, 8 + ENTRADAS_DO_IFD * 12) * CUSTO.passo / 12);
        orientacao = orientacaoDoExif(corpo);
      }
      continue;
    }
    // SOF, DHT, DQT, DRI, DNL, SOS e o EOI: ficam.
    partes.push(bytes.subarray(inicio, fim));
  }
  if (orientacao !== null && orientacao !== 1) {
    partes.splice(posicaoDoApp1, 0, app1SoComAOrientacao(orientacao));
  }
  return { tipo: "imagem", formato: "jpeg", bytes: juntar(partes, trabalho) };
}

// ---------------------------------------------------------------------------
// Imagem: PNG
// ---------------------------------------------------------------------------

/** Os pedacos do PNG que ficam (lista do que fica): a imagem e a exibicao. */
const PEDACOS_DO_PNG_QUE_FICAM: ReadonlySet<string> = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "sBIT",
  "bKGD",
  "pHYs",
]);

/** Os pedacos do PNG animado (APNG): o arquivo nao sai. */
const PEDACOS_DO_PNG_ANIMADO: ReadonlySet<string> = new Set(["acTL", "fcTL", "fdAT"]);

/**
 * Teto de pedacos num PNG ou num WebP (o de verdade tem dezenas: o maior dos
 * 4.311 PNGs reais conferidos tinha 95; o WebP animado, um por quadro).
 * Mais que isso e arquivo feito para alocar: nao suportado.
 */
const PEDACOS_DA_IMAGEM = 65_536;

function prepararPng(bytes: Uint8Array, trabalho: Trabalho): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const partes: Uint8Array[] = [bytes.subarray(0, 8)];
  let p = 8;
  let fimDoPng = false;
  let pedacos = 0;
  while (p < bytes.length) {
    gastar(trabalho, CUSTO.volta);
    pedacos += 1;
    if (pedacos > PEDACOS_DA_IMAGEM) {
      return fora("formato");
    }
    if (p + 12 > bytes.length) {
      return fora("corrompido");
    }
    const tamanho =
      (((bytes[p] ?? 0) << 24) |
        ((bytes[p + 1] ?? 0) << 16) |
        ((bytes[p + 2] ?? 0) << 8) |
        (bytes[p + 3] ?? 0)) >>>
      0;
    const l0 = bytes[p + 4] ?? 0;
    const l1 = bytes[p + 5] ?? 0;
    const l2 = bytes[p + 6] ?? 0;
    const l3 = bytes[p + 7] ?? 0;
    const fim = p + 12 + tamanho;
    if (
      fim > bytes.length ||
      !letraAscii(l0) ||
      !letraAscii(l1) ||
      !letraAscii(l2) ||
      !letraAscii(l3)
    ) {
      return fora("corrompido");
    }
    const tipo = String.fromCharCode(l0, l1, l2, l3);
    if (p === 8 && tipo !== "IHDR") {
      return fora("corrompido");
    }
    if (PEDACOS_DO_PNG_ANIMADO.has(tipo)) {
      return fora("formato");
    }
    if (PEDACOS_DO_PNG_QUE_FICAM.has(tipo)) {
      partes.push(bytes.subarray(p, fim));
    } else if (((bytes[p + 4] ?? 0) & 0x20) === 0) {
      // Pedaco critico (primeira letra maiuscula) que nao conhecemos: o
      // decodificador nao pode ignorar, entao o arquivo nao sai.
      return fora("formato");
    }
    p = fim;
    if (tipo === "IEND") {
      // Nada depois do IEND sai.
      fimDoPng = true;
      break;
    }
  }
  if (!fimDoPng) {
    return fora("corrompido");
  }
  return { tipo: "imagem", formato: "png", bytes: juntar(partes, trabalho) };
}

// ---------------------------------------------------------------------------
// Imagem: WebP (e a figurinha)
// ---------------------------------------------------------------------------

/** As marcas do VP8X: alfa (0x10) e animacao (0x02). As outras saem. */
const MARCA_ALFA = 0x10;
const MARCA_ANIMACAO = 0x02;

/** Os pedacos do WebP que ficam; os que saem; o resto deixa o arquivo de fora. */
const PEDACOS_DO_WEBP_QUE_FICAM: ReadonlySet<string> = new Set(["VP8X", "ALPH", "VP8 ", "VP8L"]);
const PEDACOS_DO_WEBP_QUE_SAEM: ReadonlySet<string> = new Set(["ICCP", "EXIF", "XMP "]);

type PedacoDoWebp = { tipo: string; inicio: number; fim: number; dados: number };

/**
 * Os pedacos de dentro do RIFF (o que vem depois do RIFF fica de fora).
 * Cada pedaco cobra a volta dele e as passadas de depois (a procura do
 * VP8X, do VP8, do VP8L e da animacao). Pedacos demais: "formato".
 */
function pedacosDoWebp(bytes: Uint8Array, trabalho: Trabalho): PedacoDoWebp[] | null | "demais" {
  const fimDoRiff = 8 + u32le(bytes, 4);
  if (fimDoRiff < 12 || fimDoRiff > bytes.length) {
    return null;
  }
  const pedacos: PedacoDoWebp[] = [];
  let p = 12;
  while (p < fimDoRiff) {
    gastar(trabalho, CUSTO.volta + 4 * CUSTO.passo);
    if (pedacos.length >= PEDACOS_DA_IMAGEM) {
      return "demais";
    }
    if (p + 8 > fimDoRiff) {
      return null;
    }
    const tipo = String.fromCharCode(bytes[p] ?? 0, bytes[p + 1] ?? 0, bytes[p + 2] ?? 0, bytes[p + 3] ?? 0);
    const tamanho = u32le(bytes, p + 4);
    const fimDosDados = p + 8 + tamanho;
    if (fimDosDados > fimDoRiff) {
      return null;
    }
    // O pedaco de tamanho impar tem um byte de preenchimento.
    const fim = Math.min(fimDosDados + (tamanho % 2), fimDoRiff);
    pedacos.push({ tipo, inicio: p, fim, dados: p + 8 });
    p = fim;
  }
  return pedacos;
}

/** A largura e a altura do WebP (VP8X, VP8 ou VP8L), ou null. */
function dimensoesDoWebp(
  bytes: Uint8Array,
  pedacos: readonly PedacoDoWebp[],
): { largura: number; altura: number } | null {
  const vp8x = pedacos.find((c) => c.tipo === "VP8X");
  if (vp8x !== undefined) {
    return {
      largura: u24le(bytes, vp8x.dados + 4) + 1,
      altura: u24le(bytes, vp8x.dados + 7) + 1,
    };
  }
  const vp8 = pedacos.find((c) => c.tipo === "VP8 ");
  if (vp8 !== undefined) {
    const d = vp8.dados;
    // Marca do quadro (3 bytes) e o codigo de inicio 9D 01 2A.
    if (
      bytes[d + 3] !== 0x9d ||
      bytes[d + 4] !== 0x01 ||
      bytes[d + 5] !== 0x2a
    ) {
      return null;
    }
    return {
      largura: ((bytes[d + 6] ?? 0) | ((bytes[d + 7] ?? 0) << 8)) & 0x3fff,
      altura: ((bytes[d + 8] ?? 0) | ((bytes[d + 9] ?? 0) << 8)) & 0x3fff,
    };
  }
  const vp8l = pedacos.find((c) => c.tipo === "VP8L");
  if (vp8l !== undefined) {
    const d = vp8l.dados;
    if (bytes[d] !== 0x2f) {
      return null;
    }
    const bits = u32le(bytes, d + 1);
    return { largura: (bits & 0x3fff) + 1, altura: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** O tamanho da figurinha do WhatsApp (D-98). */
export const LADO_DA_FIGURINHA = 512;

function prepararWebp(bytes: Uint8Array, trabalho: Trabalho): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const pedacos = pedacosDoWebp(bytes, trabalho);
  if (pedacos === "demais") {
    return fora("formato");
  }
  if (pedacos === null || pedacos.length === 0) {
    return fora("corrompido");
  }
  const vp8x = pedacos.find((c) => c.tipo === "VP8X");
  const marcas = vp8x === undefined ? 0 : (bytes[vp8x.dados] ?? 0);
  const animada =
    (marcas & MARCA_ANIMACAO) !== 0 ||
    pedacos.some((c) => c.tipo === "ANIM" || c.tipo === "ANMF");
  const dimensoes = dimensoesDoWebp(bytes, pedacos);
  if (dimensoes === null) {
    return fora("corrompido");
  }
  if (
    animada ||
    (dimensoes.largura === LADO_DA_FIGURINHA &&
      dimensoes.altura === LADO_DA_FIGURINHA)
  ) {
    return { tipo: "figurinha" };
  }
  // So vistas da entrada: as marcas do VP8X e o tamanho do RIFF sao
  // corrigidos na saida (uma copia), nunca na entrada.
  const partes: Uint8Array[] = [bytes.subarray(0, 12)];
  let imagens = 0;
  for (const [indice, pedaco] of pedacos.entries()) {
    gastar(trabalho, CUSTO.volta);
    if (PEDACOS_DO_WEBP_QUE_SAEM.has(pedaco.tipo)) {
      continue;
    }
    if (!PEDACOS_DO_WEBP_QUE_FICAM.has(pedaco.tipo)) {
      return fora("formato");
    }
    if (pedaco.tipo === "VP8X" && indice !== 0) {
      return fora("corrompido");
    }
    if (pedaco.tipo === "VP8 " || pedaco.tipo === "VP8L") {
      imagens += 1;
    }
    partes.push(bytes.subarray(pedaco.inicio, pedaco.fim));
  }
  if (imagens !== 1) {
    return fora("corrompido");
  }
  const saida = juntar(partes, trabalho);
  if (vp8x !== undefined) {
    // O VP8X e o primeiro pedaco (12 do RIFF e 8 do cabecalho dele): so a
    // marca de alfa fica (ICC, EXIF e XMP sairam; animacao e figurinha).
    saida[20] = (saida[20] ?? 0) & MARCA_ALFA;
  }
  // O tamanho do RIFF: tudo depois dos 8 primeiros bytes.
  const riff = saida.length - 8;
  saida[4] = riff & 0xff;
  saida[5] = (riff >>> 8) & 0xff;
  saida[6] = (riff >>> 16) & 0xff;
  saida[7] = (riff >>> 24) & 0xff;
  return { tipo: "imagem", formato: "webp", bytes: saida };
}

// ---------------------------------------------------------------------------
// PDF: a leitura (uma passada, com tetos), as paginas e a foto embutida
// ---------------------------------------------------------------------------

/** Branco do PDF: NUL, tab, LF, FF, CR e espaco. */
function brancoDoPdf(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
}

/** Delimitador do PDF: ( ) < > [ ] { } / %. */
function delimitadorDoPdf(c: number): boolean {
  return (
    c === 0x28 ||
    c === 0x29 ||
    c === 0x3c ||
    c === 0x3e ||
    c === 0x5b ||
    c === 0x5d ||
    c === 0x7b ||
    c === 0x7d ||
    c === 0x2f ||
    c === 0x25
  );
}

/** Caractere regular do PDF (parte de uma palavra); o fim do texto (NaN) nao e. */
function regularDoPdf(c: number): boolean {
  return !Number.isNaN(c) && !brancoDoPdf(c) && !delimitadorDoPdf(c);
}

const BRANCO = "[\\0\\t\\n\\f\\r ]";
const SEM_PALAVRA_DEPOIS = "(?![^\\0\\t\\n\\f\\r ()<>\\[\\]{}/%])";

function digito(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/** Os brancos que cabem entre as partes do cabecalho de um objeto. */
const BRANCOS_DO_CABECALHO = 32;

/**
 * O proximo cabecalho de objeto ("12 0 obj") a partir de `de`: a mesma
 * leitura da expressao (\d{1,10}) branco{1,32} (\d{1,5}) branco{1,32} obj,
 * sem palavra depois, da esquerda para a direita, feita a mao numa passada
 * (a expressao voltava atras em cada digito de um texto de numeros e
 * brancos: 5 MB disso levavam mais de 300 ms). O numero sao os ultimos 10
 * digitos da sequencia, e o casamento comeca neles; o segundo numero que
 * nao fecha um cabecalho pode abrir o seguinte.
 */
function proximoCabecalho(
  t: string,
  de: number,
  trabalho: Trabalho,
): { indice: number; numero: number; fim: number } | null {
  const n = t.length;
  let i = de;
  for (;;) {
    // O primeiro numero (a, b) e o branco depois dele (b, c).
    let a = i;
    while (a < n && !digito(t.charCodeAt(a))) {
      a += 1;
    }
    if (a >= n) {
      gastar(trabalho, (n - i) * CUSTO.caractere);
      return null;
    }
    let b = a;
    while (b < n && digito(t.charCodeAt(b))) {
      b += 1;
    }
    let c = b;
    while (c < n && brancoDoPdf(t.charCodeAt(c))) {
      c += 1;
    }
    gastar(trabalho, CUSTO.passo + (c - i) * CUSTO.caractere);
    for (;;) {
      if (c === b || c - b > BRANCOS_DO_CABECALHO) {
        break;
      }
      // O segundo numero (c, d) e o branco depois dele (d, e).
      let d = c;
      while (d < n && digito(t.charCodeAt(d))) {
        d += 1;
      }
      if (d === c) {
        break;
      }
      let e = d;
      while (e < n && brancoDoPdf(t.charCodeAt(e))) {
        e += 1;
      }
      gastar(trabalho, CUSTO.passo + (e - c) * CUSTO.caractere);
      if (
        d - c <= 5 &&
        e > d &&
        e - d <= BRANCOS_DO_CABECALHO &&
        t.startsWith("obj", e) &&
        !regularDoPdf(t.charCodeAt(e + 3))
      ) {
        const indice = Math.max(a, b - 10);
        return { indice, numero: Number(t.slice(indice, b)), fim: e + 3 };
      }
      // Nao fechou: o segundo numero e o primeiro da tentativa seguinte
      // (ja lido, nao se le de novo).
      a = c;
      b = d;
      c = e;
    }
    i = c;
  }
}

/** Um valor que e so uma referencia. */
const SO_REFERENCIA = new RegExp(`^(\\d{1,10})${BRANCO}+(\\d{1,5})${BRANCO}+R$`);
/** Um nome ("/FlateDecode"). */
const NOME_DO_PDF = /\/[^\0\t\n\f\r ()<>[\]{}\/%]*/g;
const INTEIRO = /^[+-]?\d{1,10}$/;
const ENCRYPT = /\/Encrypt(?![A-Za-z0-9])/;

/** O nome sem os escapes "#xx" (o "/Ty#70e" e o "/Type"). */
function nomeDecodificado(nome: string): string {
  return nome.includes("#")
    ? nome.replace(/#([0-9A-Fa-f]{2})/g, (_, hexa: string) =>
        String.fromCharCode(parseInt(hexa, 16)),
      )
    : nome;
}

/** Pula brancos e comentarios a partir de i. */
function pularBrancos(t: string, i: number, trabalho: Trabalho): number {
  let j = i;
  while (j < t.length) {
    const c = t.charCodeAt(j);
    if (brancoDoPdf(c)) {
      j += 1;
      continue;
    }
    if (c === 0x25) {
      // %: comentario ate o fim da linha.
      while (j < t.length && t.charCodeAt(j) !== 0x0a && t.charCodeAt(j) !== 0x0d) {
        j += 1;
      }
      continue;
    }
    break;
  }
  gastar(trabalho, CUSTO.passo + (j - i) * CUSTO.caractere);
  return j;
}

/** O fim da palavra (numero, nome sem a barra, true, R) que comeca em i. */
function fimDaPalavra(t: string, i: number): number {
  let j = i;
  while (j < t.length) {
    const c = t.charCodeAt(j);
    if (brancoDoPdf(c) || delimitadorDoPdf(c)) {
      break;
    }
    j += 1;
  }
  return j;
}

/** O fim da string "( ... )" que comeca em i (aninhada, com a barra invertida), ou -1. */
function fimDaString(t: string, i: number): number {
  let profundidade = 0;
  for (let j = i; j < t.length; j += 1) {
    const c = t.charCodeAt(j);
    if (c === 0x5c) {
      j += 1;
    } else if (c === 0x28) {
      profundidade += 1;
    } else if (c === 0x29) {
      profundidade -= 1;
      if (profundidade === 0) {
        return j + 1;
      }
    }
  }
  return -1;
}

/** O fim do dicionario ou da lista que comeca em i ("<<" ou "["), ou -1. */
function fimDoComposto(t: string, i: number): number {
  let profundidade = 0;
  let j = i;
  while (j < t.length) {
    const c = t.charCodeAt(j);
    if (c === 0x3c) {
      if (t.charCodeAt(j + 1) === 0x3c) {
        profundidade += 1;
        j += 2;
        continue;
      }
      // String hexadecimal: ate o ">".
      const fim = t.indexOf(">", j + 1);
      if (fim < 0) {
        return -1;
      }
      j = fim + 1;
      continue;
    }
    if (c === 0x3e && t.charCodeAt(j + 1) === 0x3e) {
      profundidade -= 1;
      j += 2;
      if (profundidade <= 0) {
        return j;
      }
      continue;
    }
    if (c === 0x5b || c === 0x5d) {
      profundidade += c === 0x5b ? 1 : -1;
      j += 1;
      if (profundidade <= 0) {
        return j;
      }
      continue;
    }
    if (c === 0x28) {
      const fim = fimDaString(t, j);
      if (fim < 0) {
        return -1;
      }
      j = fim;
      continue;
    }
    if (c === 0x25) {
      while (j < t.length && t.charCodeAt(j) !== 0x0a && t.charCodeAt(j) !== 0x0d) {
        j += 1;
      }
      continue;
    }
    j += 1;
  }
  return -1;
}

/** O fim do valor que comeca em i (ja sem brancos), ou -1 (malformado). Cobra o que andou. */
function fimDoValor(t: string, i: number, trabalho: Trabalho): number {
  let fim: number;
  const c = t.charCodeAt(i);
  if (i >= t.length) {
    fim = -1;
  } else if (c === 0x28) {
    fim = fimDaString(t, i);
  } else if (c === 0x3c && t.charCodeAt(i + 1) !== 0x3c) {
    const k = t.indexOf(">", i + 1);
    fim = k < 0 ? -1 : k + 1;
  } else if (c === 0x3c || c === 0x5b) {
    fim = fimDoComposto(t, i);
  } else if (c === 0x2f) {
    fim = fimDaPalavra(t, i + 1);
  } else {
    const k = fimDaPalavra(t, i);
    fim = k === i ? -1 : k;
  }
  gastar(trabalho, CUSTO.passo + ((fim < 0 ? t.length : fim) - i) * CUSTO.caractere);
  return fim;
}

/** [i, fim) tem ao menos um caractere e so digitos? */
function soDigitos(t: string, i: number, fim: number): boolean {
  if (fim <= i) {
    return false;
  }
  for (let j = i; j < fim; j += 1) {
    const c = t.charCodeAt(j);
    if (c < 0x30 || c > 0x39) {
      return false;
    }
  }
  return true;
}

/**
 * Se o valor [i, fim) e um numero seguido de "G R", o fim da referencia;
 * senao, fim. Os numeros podem ser longos (ha gerador que escreve
 * "/Pg 18446744073386459286 0 R").
 */
function fimComReferencia(t: string, i: number, fim: number, trabalho: Trabalho): number {
  gastar(trabalho, (fim - i) * CUSTO.caractere);
  if (!soDigitos(t, i, fim)) {
    return fim;
  }
  const g = pularBrancos(t, fim, trabalho);
  const fimDoG = fimDaPalavra(t, g);
  gastar(trabalho, (fimDoG - g) * 2 * CUSTO.caractere);
  if (!soDigitos(t, g, fimDoG)) {
    return fim;
  }
  const r = pularBrancos(t, fimDoG, trabalho);
  const depois = t.charCodeAt(r + 1);
  if (
    t.charCodeAt(r) !== 0x52 ||
    (r + 1 < t.length && !brancoDoPdf(depois) && !delimitadorDoPdf(depois))
  ) {
    return fim;
  }
  return r + 1;
}

/** As chaves que a leitura guarda (as outras so sao puladas). */
const CHAVES_LIDAS: ReadonlySet<string> = new Set([
  "Type",
  "Subtype",
  "Count",
  "Kids",
  "Filter",
  "DecodeParms",
  "N",
  "First",
  "Encrypt",
  "Metadata",
  "EF",
]);

/** As chaves lidas do dicionario e o valor bruto de cada uma (repetida: todas). */
type DicionarioDoPdf = Map<string, string[]>;

/**
 * Le o dicionario que comeca em i ("<<"). Onde devia vir uma chave e vem
 * outra coisa, ela e pulada, como os leitores fazem. null: malformado (o
 * valor ou o dicionario nao fecham). Cada chave cobra do orcamento.
 */
function lerDicionario(
  t: string,
  i: number,
  trabalho: Trabalho,
): { dicionario: DicionarioDoPdf; fim: number } | null {
  const dicionario: DicionarioDoPdf = new Map();
  let j = i + 2;
  for (;;) {
    j = pularBrancos(t, j, trabalho);
    if (j >= t.length) {
      return null;
    }
    const c = t.charCodeAt(j);
    if (c === 0x3e && t.charCodeAt(j + 1) === 0x3e) {
      return { dicionario, fim: j + 2 };
    }
    if (c !== 0x2f) {
      const fimDoSolto = fimDoValor(t, j, trabalho);
      if (fimDoSolto < 0) {
        return null;
      }
      j = fimDoSolto;
      continue;
    }
    gastar(trabalho, CUSTO.volta);
    const fimDaChave = fimDaPalavra(t, j + 1);
    gastar(trabalho, (fimDaChave - j) * CUSTO.caractere);
    // A chave mais longa lida, com todos os escapes, cabe em 40.
    const chave =
      fimDaChave - j - 1 <= 40 ? nomeDecodificado(t.slice(j + 1, fimDaChave)) : "";
    const inicioDoValor = pularBrancos(t, fimDaChave, trabalho);
    const fimDoValorLido = fimDoValor(t, inicioDoValor, trabalho);
    if (fimDoValorLido < 0) {
      return null;
    }
    const fim = fimComReferencia(t, inicioDoValor, fimDoValorLido, trabalho);
    if (CHAVES_LIDAS.has(chave)) {
      const valor = t.slice(inicioDoValor, fim);
      const valores = dicionario.get(chave);
      if (valores === undefined) {
        dicionario.set(chave, [valor]);
      } else {
        valores.push(valor);
      }
    }
    j = fim;
  }
}

/**
 * Os nomes de um valor (um nome, ou uma lista so de nomes), sem a barra;
 * null: outra coisa. Cobra o valor inteiro (cada nome vira um texto novo).
 */
function nomesDoValor(valor: string, trabalho: Trabalho): string[] | null {
  gastar(trabalho, CUSTO.volta + valor.length * CUSTO.nome);
  if (valor.startsWith("/")) {
    return [nomeDecodificado(valor.slice(1))];
  }
  if (valor.startsWith("[") && valor.endsWith("]")) {
    const dentro = valor.slice(1, -1);
    if (dentro.replace(NOME_DO_PDF, "").replace(/[\0\t\n\f\r ]+/g, "") !== "") {
      return null;
    }
    return (dentro.match(NOME_DO_PDF) ?? []).map((nome) => nomeDecodificado(nome.slice(1)));
  }
  return null;
}

/** Os nomes da chave (o /Type, o /Subtype), sem a barra. */
function nomesDaChave(d: DicionarioDoPdf, chave: string, trabalho: Trabalho): string[] {
  return (d.get(chave) ?? []).flatMap((valor) => nomesDoValor(valor, trabalho) ?? []);
}

function tiposDoDicionario(d: DicionarioDoPdf, trabalho: Trabalho): string[] {
  return nomesDaChave(d, "Type", trabalho);
}

/** Os filtros abreviados (a forma curta vale para os leitores tambem). */
const ABREVIACOES_DE_FILTRO: Readonly<Record<string, string>> = {
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  Fl: "FlateDecode",
  RL: "RunLengthDecode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode",
};

/** Os filtros do fluxo, na ordem. /Filter que nao da para ler sem resolver: "formato". */
function filtrosDoFluxo(d: DicionarioDoPdf, trabalho: Trabalho): string[] {
  const valores = d.get("Filter");
  if (valores === undefined) {
    return [];
  }
  const nomes = valores.length === 1 ? nomesDoValor(valores[0] ?? "", trabalho) : null;
  if (nomes === null) {
    throw new MidiaDeFora("formato");
  }
  return nomes.map((nome) => ABREVIACOES_DE_FILTRO[nome] ?? nome);
}

/** O fluxo tem preditor (ou parametros que so resolvendo a referencia)? */
function comPreditor(d: DicionarioDoPdf, trabalho: Trabalho): boolean {
  return (d.get("DecodeParms") ?? []).some((valor) => {
    gastar(trabalho, CUSTO.volta + valor.length * CUSTO.expressao);
    if (SO_REFERENCIA.test(valor)) {
      return true;
    }
    const preditor = /\/Predictor[\0\t\n\f\r ]*(\d{1,4})/.exec(valor);
    return preditor !== null && Number(preditor[1]) > 1;
  });
}

/** O inteiro direto da chave (escrita uma vez so), ou null. */
function inteiroDaChave(d: DicionarioDoPdf, chave: string): number | null {
  const valores = d.get(chave) ?? [];
  const valor = valores.length === 1 ? (valores[0] ?? "") : "";
  return INTEIRO.test(valor) ? Number(valor) : null;
}

type ObjetoDoPdf = {
  numero: number;
  dicionario: DicionarioDoPdf | null;
  /** O valor bruto quando o objeto nao e dicionario (a lista /Kids ou o /Count indiretos). */
  valor: string | null;
  /** Os bytes do fluxo: do primeiro dado ate a marca "endstream". */
  fluxo: { inicio: number; fim: number } | null;
};

/** O texto latin1 (um caractere por byte), sem copiar os bytes antes. Cobra a conversao. */
function latin1(bytes: Uint8Array, trabalho: Trabalho): string {
  gastar(trabalho, bytes.length * CUSTO.nativo);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

/** O primeiro valor da lista ordenada que e >= de, ou -1. */
function primeiroDesde(lista: readonly number[], de: number): number {
  let a = 0;
  let b = lista.length;
  while (a < b) {
    const meio = (a + b) >>> 1;
    if ((lista[meio] ?? 0) < de) {
      a = meio + 1;
    } else {
      b = meio;
    }
  }
  return lista[a] ?? -1;
}

/**
 * Onde comecam os dados, se em s ha a palavra "stream" (e o fim de linha:
 * CRLF, LF ou so CR, com espacos antes tolerados). "nao": nao e fluxo;
 * "malformado": "stream" sem o fim de linha.
 */
function comecoDosDados(t: string, s: number, trabalho: Trabalho): number | "nao" | "malformado" {
  if (!t.startsWith("stream", s)) {
    return "nao";
  }
  let k = s + 6;
  const seguinte = t.charCodeAt(k);
  if (k < t.length && !brancoDoPdf(seguinte) && !delimitadorDoPdf(seguinte)) {
    return "nao";
  }
  while (t.charCodeAt(k) === 0x20 || t.charCodeAt(k) === 0x09) {
    k += 1;
  }
  gastar(trabalho, k - s);
  if (t.charCodeAt(k) === 0x0d) {
    return t.charCodeAt(k + 1) === 0x0a ? k + 2 : k + 1;
  }
  if (t.charCodeAt(k) === 0x0a) {
    return k + 1;
  }
  return "malformado";
}

/**
 * Descomprime (FlateDecode) com o teto. Passou do teto: "bomba"; nao
 * descomprime: "corrompido". O que sai cobra do orcamento.
 */
function descomprimir(dados: Uint8Array, teto: number, trabalho: Trabalho): Uint8Array {
  let saida: Uint8Array;
  try {
    saida = inflateSync(dados, { maxOutputLength: teto });
  } catch (erro) {
    if (
      erro instanceof RangeError ||
      (erro as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new MidiaDeFora("bomba");
    }
    throw new MidiaDeFora("corrompido");
  }
  gastar(trabalho, dados.length * CUSTO.nativo + saida.length * CUSTO.zlib);
  return saida;
}

/**
 * Os objetos de um fluxo de objetos ja descomprimido: o cabecalho (N pares
 * "numero deslocamento" antes de /First) e cada objeto no deslocamento. O
 * enchimento depois do ultimo objeto declarado e "bomba".
 */
function lerFluxoDeObjetos(
  texto: string,
  d: DicionarioDoPdf,
  trabalho: Trabalho,
  saida: ObjetoDoPdf[],
  jaLidos: number,
): void {
  const n = inteiroDaChave(d, "N") ?? -1;
  const primeiro = inteiroDaChave(d, "First") ?? -1;
  if (n < 0 || primeiro < 0 || primeiro > texto.length) {
    throw new MidiaDeFora("corrompido");
  }
  if (jaLidos + saida.length + n > LIMITES_DA_MIDIA.pdfObjetos) {
    throw new MidiaDeFora("bomba");
  }
  const cabecalho = texto.slice(0, primeiro);
  gastar(trabalho, primeiro * CUSTO.expressao);
  const numeros = /\d{1,10}/g;
  let fimDoUltimo = primeiro;
  for (let k = 0; k < n; k += 1) {
    gastar(trabalho, CUSTO.objeto);
    const numero = numeros.exec(cabecalho);
    const deslocamento = numero === null ? null : numeros.exec(cabecalho);
    if (numero === null || deslocamento === null) {
      throw new MidiaDeFora("corrompido");
    }
    const inicio = primeiro + Number(deslocamento[0]);
    if (inicio >= texto.length) {
      throw new MidiaDeFora("corrompido");
    }
    const v = pularBrancos(texto, inicio, trabalho);
    let fim: number;
    if (texto.startsWith("<<", v)) {
      const lido = lerDicionario(texto, v, trabalho);
      if (lido === null) {
        throw new MidiaDeFora("corrompido");
      }
      saida.push({ numero: Number(numero[0]), dicionario: lido.dicionario, valor: null, fluxo: null });
      fim = lido.fim;
    } else {
      const fimDoValorLido = fimDoValor(texto, v, trabalho);
      if (fimDoValorLido < 0) {
        throw new MidiaDeFora("corrompido");
      }
      fim = fimComReferencia(texto, v, fimDoValorLido, trabalho);
      saida.push({ numero: Number(numero[0]), dicionario: null, valor: texto.slice(v, fim), fluxo: null });
    }
    fimDoUltimo = Math.max(fimDoUltimo, fim);
  }
  if (texto.length - fimDoUltimo > LIMITES_DA_MIDIA.pdfSobraNoFluxoDeObjetos) {
    throw new MidiaDeFora("bomba");
  }
}

/**
 * As paginas: a MAIOR entre o /Count dos nos /Type /Pages, os objetos /Type
 * /Page (cada numero uma vez) e os filhos das listas /Kids que nao sao no
 * (cada no pelo numero, a maior das suas versoes). A lista e o /Count
 * indiretos sao lidos uma vez por numero de objeto (mil nos apontando a
 * mesma lista de 700 mil referencias leem a lista uma vez), e cada
 * resolucao cobra do orcamento. Sem /Count: "sem_paginas".
 */
function contarPaginas(objetos: readonly ObjetoDoPdf[], trabalho: Trabalho): number {
  const soValores = new Map<number, string[]>();
  const nos = new Map<number, DicionarioDoPdf[]>();
  const paginas = new Set<number>();
  for (const objeto of objetos) {
    gastar(trabalho, CUSTO.volta);
    if (objeto.dicionario === null) {
      if (objeto.valor !== null) {
        const valores = soValores.get(objeto.numero);
        if (valores === undefined) {
          soValores.set(objeto.numero, [objeto.valor]);
        } else {
          valores.push(objeto.valor);
        }
      }
      continue;
    }
    const tipos = tiposDoDicionario(objeto.dicionario, trabalho);
    if (tipos.includes("Pages")) {
      const versoes = nos.get(objeto.numero);
      if (versoes === undefined) {
        nos.set(objeto.numero, [objeto.dicionario]);
      } else {
        versoes.push(objeto.dicionario);
      }
    }
    if (tipos.includes("Page")) {
      paginas.add(objeto.numero);
    }
  }
  const resolvidos: Resolvidos = { filhos: new Map(), inteiros: new Map() };
  let contagem: number | null = null;
  let folhas = 0;
  for (const versoes of nos.values()) {
    let filhos = 0;
    for (const d of versoes) {
      gastar(trabalho, CUSTO.volta);
      for (const valor of d.get("Count") ?? []) {
        const n = maiorInteiroDoValor(valor, soValores, resolvidos, trabalho);
        if (n !== null && n >= 1) {
          contagem = Math.max(contagem ?? 0, n);
        }
      }
      for (const valor of d.get("Kids") ?? []) {
        filhos = Math.max(filhos, filhosQueNaoSaoNo(valor, soValores, nos, resolvidos, trabalho));
      }
    }
    folhas += filhos;
  }
  if (contagem === null) {
    throw new MidiaDeFora("sem_paginas");
  }
  return Math.max(contagem, paginas.size, folhas);
}

/** O que ja foi resolvido por numero de objeto (cada um e lido uma vez so). */
type Resolvidos = {
  /** A maior contagem de filhos entre as listas (versoes) do objeto. */
  filhos: Map<number, number>;
  /** O maior inteiro entre as versoes do objeto (null: nenhum). */
  inteiros: Map<number, number | null>;
};

/** O maior inteiro do valor: direto, ou pela referencia a um objeto que e so um inteiro. */
function maiorInteiroDoValor(
  valor: string,
  soValores: ReadonlyMap<number, string[]>,
  resolvidos: Resolvidos,
  trabalho: Trabalho,
): number | null {
  gastar(trabalho, CUSTO.volta);
  if (INTEIRO.test(valor)) {
    return Number(valor);
  }
  const referencia = SO_REFERENCIA.exec(valor);
  if (referencia === null) {
    return null;
  }
  const numero = Number(referencia[1]);
  if (resolvidos.inteiros.has(numero)) {
    return resolvidos.inteiros.get(numero) ?? null;
  }
  let maior: number | null = null;
  for (const versao of soValores.get(numero) ?? []) {
    gastar(trabalho, CUSTO.passo);
    if (INTEIRO.test(versao)) {
      maior = Math.max(maior ?? Number(versao), Number(versao));
    }
  }
  resolvidos.inteiros.set(numero, maior);
  return maior;
}

/** Quantas referencias da lista /Kids (direta ou indireta) nao sao no /Type /Pages. */
function filhosQueNaoSaoNo(
  valor: string,
  soValores: ReadonlyMap<number, string[]>,
  nos: ReadonlyMap<number, unknown>,
  resolvidos: Resolvidos,
  trabalho: Trabalho,
): number {
  gastar(trabalho, CUSTO.volta);
  if (valor.startsWith("[")) {
    return referenciasQueNaoSaoNo(valor, nos, trabalho);
  }
  const referencia = SO_REFERENCIA.exec(valor);
  if (referencia === null) {
    throw new MidiaDeFora("corrompido");
  }
  const numero = Number(referencia[1]);
  const conhecido = resolvidos.filhos.get(numero);
  if (conhecido !== undefined) {
    return conhecido;
  }
  let maior = -1;
  for (const versao of soValores.get(numero) ?? []) {
    gastar(trabalho, CUSTO.passo);
    if (versao.startsWith("[")) {
      maior = Math.max(maior, referenciasQueNaoSaoNo(versao, nos, trabalho));
    }
  }
  if (maior < 0) {
    throw new MidiaDeFora("corrompido");
  }
  resolvidos.filhos.set(numero, maior);
  return maior;
}

/**
 * Quantas referencias "N G R" da lista nao apontam para um no /Pages. A
 * mesma leitura da expressao (\d{1,10}) branco+ (\d{1,5}) branco+ R sem
 * palavra depois, da esquerda para a direita e sem sobrepor, feita a mao
 * numa passada so (a expressao criava um casamento por referencia): o
 * primeiro numero sao os ultimos 10 digitos de uma sequencia de digitos
 * seguida de branco, e o segundo, de 1 a 5 digitos entre brancos.
 */
function referenciasQueNaoSaoNo(
  lista: string,
  nos: ReadonlyMap<number, unknown>,
  trabalho: Trabalho,
): number {
  // Medido: cada caractere desta maquina de estados custa umas 3,5 vezes o
  // do laco de referencia.
  gastar(trabalho, CUSTO.volta + lista.length * 4 * CUSTO.caractere);
  let filhos = 0;
  // 0: nada; 1: um numero; 2: numero e branco; 3: numero, branco e numero;
  // 4: numero, branco, numero e branco (falta o R).
  let estado = 0;
  let primeiro = 0;
  let segundo = 0;
  let digitosDoSegundo = 0;
  let i = 0;
  const fim = lista.length;
  while (i < fim) {
    const c = lista.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) {
      let valor = 0;
      let digitos = 0;
      while (i < fim) {
        const d = lista.charCodeAt(i);
        if (d < 0x30 || d > 0x39) {
          break;
        }
        valor = valor * 10 + (d - 0x30);
        if (valor >= 1e10) {
          valor %= 1e10; // so os ultimos 10 digitos
        }
        digitos += 1;
        i += 1;
      }
      if (estado === 2 || estado === 4) {
        // No 4 a tentativa com o primeiro falhou: o segundo vira o primeiro.
        if (estado === 4) {
          primeiro = segundo;
        }
        estado = 3;
        segundo = valor;
        digitosDoSegundo = digitos;
      } else {
        estado = 1;
        primeiro = valor;
      }
      continue;
    }
    if (brancoDoPdf(c)) {
      while (i < fim && brancoDoPdf(lista.charCodeAt(i))) {
        i += 1;
      }
      if (estado === 1) {
        estado = 2;
      } else if (estado === 3) {
        if (digitosDoSegundo <= 5) {
          estado = 4;
        } else {
          // O segundo longo demais: ele pode ser o primeiro de outra.
          primeiro = segundo;
          estado = 2;
        }
      }
      continue;
    }
    if (c === 0x52 && estado === 4 && !regularDoPdf(lista.charCodeAt(i + 1))) {
      if (!nos.has(primeiro)) {
        filhos += 1;
      }
    }
    estado = 0;
    i += 1;
  }
  return filhos;
}

type PdfLido = {
  /** Os objetos do arquivo (so estes tem fluxo). */
  objetos: ObjetoDoPdf[];
  /** Os do arquivo e os de dentro dos fluxos de objetos. */
  todos: ObjetoDoPdf[];
  /** O texto descomprimido de cada fluxo de objetos (para os anexos e a localizacao). */
  textosDeDentro: string[];
  /** O que ainda cabe no teto do descomprimido (para os metadados). */
  descomprimidoRestante: number;
  paginas: number;
};

/**
 * A leitura do PDF numa passada, com tetos e o orcamento: os objetos (pelos
 * cabecalhos "N G obj" em qualquer lugar do arquivo, ate dentro dos dados
 * de outro fluxo, onde um leitor tambem os acharia pela xref), os fluxos (o
 * fim de cada um e a primeira marca "endstream" depois do comeco), os
 * objetos dos fluxos de objetos e a contagem das paginas. Um FLUXO que
 * comeca dentro de outro (no dicionario ou nos dados) e PDF malformado: os
 * dois acabariam no mesmo "endstream", e as fotos aninhadas seriam lidas de
 * novo a cada nivel ("formato"). Lanca MidiaDeFora.
 */
function lerPdf(bytes: Uint8Array, trabalho: Trabalho): PdfLido {
  const t = latin1(bytes, trabalho);
  // /Encrypt mora no trailer ou no dicionario do fluxo de referencias:
  // procurado no arquivo inteiro (o lado seguro).
  gastar(trabalho, t.length * CUSTO.nativo);
  if (ENCRYPT.test(t)) {
    throw new MidiaDeFora("cifrado");
  }
  const marcas: number[] = [];
  for (let k = t.indexOf("endstream"); k >= 0; k = t.indexOf("endstream", k + 9)) {
    marcas.push(k);
    if (marcas.length > LIMITES_DA_MIDIA.pdfFluxos) {
      throw new MidiaDeFora("bomba");
    }
  }
  gastar(trabalho, t.length * CUSTO.nativo + marcas.length * CUSTO.passo);
  const objetos: ObjetoDoPdf[] = [];
  let fluxos = 0;
  // Ate onde vai o fluxo mais longo ja visto: o que esta antes disso esta
  // dentro de um fluxo (malformado ali e so ignorado; outro fluxo, fora).
  let fimDosFluxos = 0;
  for (
    let achado = proximoCabecalho(t, 0, trabalho);
    achado !== null;
    achado = proximoCabecalho(t, achado.fim, trabalho)
  ) {
    gastar(trabalho, CUSTO.objeto);
    if (objetos.length >= LIMITES_DA_MIDIA.pdfObjetos) {
      throw new MidiaDeFora("bomba");
    }
    const numero = achado.numero;
    const dentroDeFluxo = achado.indice < fimDosFluxos;
    const v = pularBrancos(t, achado.fim, trabalho);
    if (!t.startsWith("<<", v)) {
      const fimDoValorLido = fimDoValor(t, v, trabalho);
      objetos.push({
        numero,
        dicionario: null,
        valor:
          fimDoValorLido < 0
            ? null
            : t.slice(v, fimComReferencia(t, v, fimDoValorLido, trabalho)),
        fluxo: null,
      });
      continue;
    }
    // Malformado (o dicionario, o "stream" sem fim de linha ou sem
    // "endstream" depois): fora, a nao ser dentro de um fluxo.
    const lido = lerDicionario(t, v, trabalho);
    const dados =
      lido === null
        ? "malformado"
        : comecoDosDados(t, pularBrancos(t, lido.fim, trabalho), trabalho);
    const fim = typeof dados === "number" ? primeiroDesde(marcas, dados) : -1;
    if (lido === null || dados === "malformado" || (dados !== "nao" && fim < 0)) {
      if (dentroDeFluxo) {
        continue;
      }
      throw new MidiaDeFora("corrompido");
    }
    let fluxo: ObjetoDoPdf["fluxo"] = null;
    if (dados !== "nao") {
      if (dentroDeFluxo) {
        throw new MidiaDeFora("formato");
      }
      fluxos += 1;
      if (fluxos > LIMITES_DA_MIDIA.pdfFluxos) {
        throw new MidiaDeFora("bomba");
      }
      fluxo = { inicio: dados, fim };
      fimDosFluxos = Math.max(fimDosFluxos, fim);
    }
    objetos.push({ numero, dicionario: lido.dicionario, valor: null, fluxo });
  }
  // Os fluxos de objetos (/Type /ObjStm, ou /N e /First como os leitores
  // aceitam): so FlateDecode sem preditor, com o teto do descomprimido.
  const deDentro: ObjetoDoPdf[] = [];
  const textosDeDentro: string[] = [];
  let restante: number = LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal;
  let fluxosDeObjetos = 0;
  for (const objeto of objetos) {
    gastar(trabalho, CUSTO.passo);
    const d = objeto.dicionario;
    if (objeto.fluxo === null || d === null) {
      continue;
    }
    if (!tiposDoDicionario(d, trabalho).includes("ObjStm") && !(d.has("N") && d.has("First"))) {
      continue;
    }
    fluxosDeObjetos += 1;
    if (fluxosDeObjetos > LIMITES_DA_MIDIA.pdfFluxosDeObjetos) {
      throw new MidiaDeFora("bomba");
    }
    const filtros = filtrosDoFluxo(d, trabalho);
    if (
      filtros.length > 1 ||
      filtros.some((f) => f !== "FlateDecode") ||
      comPreditor(d, trabalho)
    ) {
      throw new MidiaDeFora("formato");
    }
    let dados: Uint8Array = bytes.subarray(objeto.fluxo.inicio, objeto.fluxo.fim);
    if (filtros.length === 1) {
      if (restante <= 0) {
        throw new MidiaDeFora("bomba");
      }
      dados = descomprimir(dados, restante, trabalho);
    }
    restante -= dados.length;
    if (restante < 0) {
      throw new MidiaDeFora("bomba");
    }
    const texto = latin1(dados, trabalho);
    textosDeDentro.push(texto);
    lerFluxoDeObjetos(texto, d, trabalho, deDentro, objetos.length);
  }
  const todos = objetos.concat(deDentro);
  // O /Encrypt escrito com escape ("/Encr#79pt") tambem e criptografia.
  gastar(trabalho, todos.length * CUSTO.passo);
  if (todos.some((objeto) => objeto.dicionario?.has("Encrypt") === true)) {
    throw new MidiaDeFora("cifrado");
  }
  return {
    objetos,
    todos,
    textosDeDentro,
    descomprimidoRestante: restante,
    paginas: contarPaginas(todos, trabalho),
  };
}

/**
 * As paginas do PDF (a maior contagem, ver contarPaginas), ou por que nao
 * deu para contar ("sem_paginas", "bomba", "corrompido", "formato",
 * "cifrado").
 */
export function paginasDoPdf(
  bytes: Uint8Array,
): { paginas: number } | { erro: MotivoDeFora } {
  try {
    return { paginas: lerPdf(bytes, novoTrabalho()).paginas };
  } catch (erro) {
    if (erro instanceof MidiaDeFora) {
      return { erro: erro.motivo };
    }
    throw erro;
  }
}

/**
 * Limpa NO LUGAR a foto (JPEG) que esta em [de, ate) da copia do PDF, sem
 * mudar o tamanho: APP1 a APP15 e COM viram um COM zerado do mesmo tamanho
 * (o APP0 JFIF fica sem a miniatura e o APP14 Adobe fica), e o que vem
 * depois do primeiro EOI vira zero (menos o fim de linha antes de
 * "endstream"). null: limpo; senao, o motivo.
 */
function limparFotoNoLugar(
  saida: Uint8Array,
  de: number,
  ate: number,
  trabalho: Trabalho,
): MotivoDeFora | null {
  const andado = andarPeloJpeg(saida, de, ate, trabalho);
  if ("motivo" in andado) {
    return andado.motivo;
  }
  let comJfif = false;
  let comAdobe = false;
  for (const pedaco of andado.pedacos) {
    gastar(trabalho, CUSTO.passo);
    if (pedaco.tipo !== "segmento") {
      continue;
    }
    const { marcador, inicio, fim, antesDaVarredura } = pedaco;
    if (!ehApp(marcador) && marcador !== COM) {
      continue;
    }
    const corpo = inicio + 4;
    gastar(trabalho, (fim - corpo) * CUSTO.nativo);
    if (
      marcador === APP0 &&
      antesDaVarredura &&
      !comJfif &&
      fim - corpo >= 14 &&
      comecaCom(saida, [...ascii("JFIF"), 0], corpo)
    ) {
      comJfif = true;
      // A miniatura: 0 por 0 e os bytes dela zerados.
      saida[corpo + 12] = 0;
      saida[corpo + 13] = 0;
      saida.fill(0, corpo + 14, fim);
      continue;
    }
    if (
      marcador === APP14 &&
      antesDaVarredura &&
      !comAdobe &&
      fim - corpo >= 12 &&
      comecaCom(saida, ascii("Adobe"), corpo)
    ) {
      comAdobe = true;
      saida.fill(0, corpo + 12, fim);
      continue;
    }
    saida[inicio + 1] = COM;
    saida.fill(0, corpo, fim);
  }
  let fimDosDados = ate;
  while (
    fimDosDados > andado.fimDoEoi &&
    (saida[fimDosDados - 1] === 0x0a || saida[fimDosDados - 1] === 0x0d)
  ) {
    fimDosDados -= 1;
  }
  gastar(trabalho, (ate - fimDosDados) * CUSTO.caractere + (fimDosDados - andado.fimDoEoi) * CUSTO.nativo);
  saida.fill(0, andado.fimDoEoi, fimDosDados);
  return null;
}

/**
 * O PDF com as fotos limpas (so os fluxos com /DCTDecode sozinho), numa
 * COPIA dos bytes (a entrada nunca muda: o slice de um Buffer e uma vista).
 * Sem foto, os mesmos bytes. /JPXDecode ou /DCTDecode numa cadeia:
 * "formato". As fotos estao em regioes que nao se sobrepoem (lerPdf recusa
 * o fluxo dentro de outro); conferido de novo aqui, o lado seguro.
 */
function semMetadadosDasFotos(
  bytes: Uint8Array,
  objetos: readonly ObjetoDoPdf[],
  trabalho: Trabalho,
): Uint8Array {
  let saida: Uint8Array | null = null;
  let fimDaUltimaFoto = 0;
  for (const objeto of objetos) {
    gastar(trabalho, CUSTO.passo);
    if (objeto.fluxo === null || objeto.dicionario === null) {
      continue;
    }
    const filtros = filtrosDoFluxo(objeto.dicionario, trabalho);
    if (filtros.includes("JPXDecode")) {
      throw new MidiaDeFora("formato");
    }
    if (!filtros.includes("DCTDecode")) {
      continue;
    }
    if (filtros.length !== 1 || objeto.fluxo.inicio < fimDaUltimaFoto) {
      throw new MidiaDeFora("formato");
    }
    fimDaUltimaFoto = objeto.fluxo.fim;
    if (saida === null) {
      gastar(trabalho, bytes.length * CUSTO.nativo);
      saida = new Uint8Array(bytes);
    }
    const motivo = limparFotoNoLugar(saida, objeto.fluxo.inicio, objeto.fluxo.fim, trabalho);
    if (motivo !== null) {
      throw new MidiaDeFora(motivo);
    }
  }
  return saida ?? bytes;
}

/** O nome do PDF com qualquer letra escrita com escape ("/Embedded#46iles"). */
function nomeComEscapes(nome: string): string {
  const digito = (d: string) => (/[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d);
  return Array.from(nome, (letra) => {
    const hexa = letra.charCodeAt(0).toString(16).padStart(2, "0");
    return `(?:${letra}|#${digito(hexa[0] ?? "0")}${digito(hexa[1] ?? "0")})`;
  }).join("");
}

/** O anexo: o arquivo embutido, a lista deles e a anotacao de anexo (tambem com #xx). */
const ANEXO = new RegExp(
  `\\/(?:${nomeComEscapes("EmbeddedFile")}(?:s|#73)?|${nomeComEscapes("FileAttachment")})${SEM_PALAVRA_DEPOIS}`,
);

/** A expressao (sem volta atras) passada no texto inteiro: o casamento, cobrado. */
function casaNoTexto(expressao: RegExp, texto: string, trabalho: Trabalho): boolean {
  gastar(trabalho, CUSTO.volta + texto.length * CUSTO.expressao);
  return expressao.test(texto);
}

/**
 * O anexo no PDF: o nome no arquivo e dentro dos fluxos de objetos, ou a
 * chave /EF (o arquivo embutido de um /Filespec).
 */
function comAnexo(texto: string, lido: PdfLido, trabalho: Trabalho): boolean {
  if (casaNoTexto(ANEXO, texto, trabalho)) {
    return true;
  }
  if (lido.textosDeDentro.some((dentro) => casaNoTexto(ANEXO, dentro, trabalho))) {
    return true;
  }
  gastar(trabalho, lido.todos.length * CUSTO.passo);
  return lido.todos.some((objeto) => objeto.dicionario?.has("EF") === true);
}

// ---------------------------------------------------------------------------
// PDF: a localizacao (no XMP, no /Info e solta no arquivo)
// ---------------------------------------------------------------------------

/** As propriedades de GPS em qualquer XMP (do EXIF, do IPTC, do drone). */
const GPS_NO_XMP = /exif:GPS|GPS(?:Latitude|Longitude|Longtitude)/i;
/** A coordenada no formato do XMP (GPSCoordinate): "3,43.914S", "38,31,36W". */
const COORDENADA_DO_XMP =
  /(?:^|[^\d.,])\d{1,3},\d{1,2}(?:\.\d+)?(?:,\d{1,2}(?:\.\d+)?)?[NSEW](?![A-Za-z])/;
/**
 * O valor com coordenada: o par em graus decimais ("-3.731900, -38.526700"),
 * os graus decimais com o hemisferio ("3.7319 S") ou graus, minutos e
 * segundos (3°43'54"S). O "°" do UTF-8 lido em latin1 vem depois de um "Â".
 * Sem quantificadores que se sobrepoem: o separador do par e "brancos, uma
 * virgula ou um ponto e virgula, brancos" OU "brancos sem o espaco, um
 * espaco, brancos" (a mesma lingua de \s*[,; ]\s*), e os brancos dos dois
 * lados do grau so existem com o grau no meio. Assim nenhuma tentativa
 * volta atras mais do que o comprimento do valor.
 */
const COORDENADAS_NO_VALOR: readonly RegExp[] = [
  /[-+]?\d{1,3}\.\d{4,}(?:\s*[,;]|[^\S ]* )\s*[-+]?\d{1,3}\.\d{4,}/,
  /\d{1,3}\.\d{3,}\s*(?:(?:Â°?|°)\s*)?[NSEWLO](?![A-Za-z])/,
  /\d{1,3}\s*Â?°\s*\d{1,2}\D{1,8}\d{1,2}(?:\.\d+)?\D{0,8}[NSEWLO](?![A-Za-z])/,
];

/** O valor tem coordenada? (Cada expressao anda o valor no maximo umas vezes.) */
function coordenadaNoValor(valor: string, trabalho: Trabalho): boolean {
  gastar(trabalho, CUSTO.volta + valor.length * COORDENADAS_NO_VALOR.length * 4 * CUSTO.expressao);
  return COORDENADAS_NO_VALOR.some((expressao) => expressao.test(valor));
}

/** Branco do \s das expressoes e do trim() que cabe em latin1. */
function brancoDoXml(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0;
}

/** Letra ASCII ([A-Za-z]). */
function letraAscii(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** Caractere de nome das propriedades ([\w.-]). */
function caractereDeNome(c: number): boolean {
  return letraAscii(c) || (c >= 0x30 && c <= 0x39) || c === 0x5f || c === 0x2e || c === 0x2d;
}

/** Caractere de prefixo de nome XML: tudo menos brancos, < > / = aspas e dois-pontos. */
function caractereDePrefixo(c: number): boolean {
  return (
    !Number.isNaN(c) &&
    !brancoDoXml(c) &&
    c !== 0x3c &&
    c !== 0x3e &&
    c !== 0x2f &&
    c !== 0x3d &&
    c !== 0x22 &&
    c !== 0x27 &&
    c !== 0x3a
  );
}

/**
 * Um indexOf que lembra o ultimo achado: com as procuras sempre para a
 * frente, cada trecho do texto e varrido uma vez so (a varredura inteira e
 * linear). Cobra o que anda.
 */
function procurador(texto: string, alvo: string, trabalho: Trabalho): (de: number) => number {
  let desde = 0;
  let achado = -2; // -2: nunca procurado; -1: nao ha mais depois de "desde"
  return (de) => {
    if (achado !== -2 && de >= desde && (achado === -1 || achado >= de)) {
      return achado;
    }
    const novo = texto.indexOf(alvo, de);
    gastar(trabalho, CUSTO.chamada + Math.max(0, (novo < 0 ? texto.length : novo) - de) * CUSTO.nativo);
    desde = de;
    achado = novo;
    return novo;
  };
}

/** Os prefixos das propriedades em que a coordenada conta. */
const PREFIXOS_DA_COORDENADA = ["photoshop:", "xmp:"] as const;

/**
 * Algum valor de propriedade photoshop: ou xmp: tem coordenada? O atributo
 * (prefixo:Nome="valor", com brancos em volta do "=") e o elemento
 * (<prefixo:Nome ...>valor<), lidos da esquerda para a direita, um depois
 * do outro, como a expressao de antes fazia, mas a mao: cada delimitador e
 * procurado uma vez so (procurador), e nada volta atras.
 */
function coordenadaNasPropriedades(texto: string, trabalho: Trabalho): boolean {
  const prefixos = PREFIXOS_DA_COORDENADA.map((alvo) => ({
    tamanho: alvo.length,
    achar: procurador(texto, alvo, trabalho),
  }));
  const proximoMaior = procurador(texto, ">", trabalho);
  const proximoMenor = procurador(texto, "<", trabalho);
  const proximaAspa = procurador(texto, '"', trabalho);
  const proximoApostrofo = procurador(texto, "'", trabalho);
  let cursor = 0;
  for (;;) {
    gastar(trabalho, CUSTO.volta);
    let q = -1;
    let tamanho = 0;
    for (const prefixo of prefixos) {
      const achado = prefixo.achar(cursor);
      if (achado >= 0 && (q < 0 || achado < q)) {
        q = achado;
        tamanho = prefixo.tamanho;
      }
    }
    if (q < 0) {
      return false;
    }
    const nome = q + tamanho;
    let valor: string | null = null;
    let depois = q + 1;
    if (letraAscii(texto.charCodeAt(nome))) {
      if (q - 1 >= cursor && texto.charCodeAt(q - 1) === 0x3c) {
        // Elemento: o ">" do fim da tag e o valor ate o proximo "<".
        const maior = proximoMaior(nome + 1);
        const menor = maior < 0 ? -1 : proximoMenor(maior + 1);
        if (menor >= 0) {
          valor = texto.slice(maior + 1, menor);
          depois = menor + 1;
        }
      }
      if (valor === null) {
        // Atributo: o nome, brancos, "=", brancos e o valor entre aspas.
        let j = nome + 1;
        while (caractereDeNome(texto.charCodeAt(j))) {
          j += 1;
        }
        while (brancoDoXml(texto.charCodeAt(j))) {
          j += 1;
        }
        if (texto.charCodeAt(j) === 0x3d) {
          j += 1;
          while (brancoDoXml(texto.charCodeAt(j))) {
            j += 1;
          }
          const aspa = texto.charCodeAt(j);
          const fecha =
            aspa === 0x22 ? proximaAspa(j + 1) : aspa === 0x27 ? proximoApostrofo(j + 1) : -1;
          if (fecha >= 0) {
            valor = texto.slice(j + 1, fecha);
            depois = fecha + 1;
          }
        }
        gastar(trabalho, (j - nome) * CUSTO.caractere);
      }
    }
    if (valor !== null && coordenadaNoValor(valor, trabalho)) {
      return true;
    }
    cursor = depois;
  }
}

/**
 * Os nomes (locais) do lugar escrito por extenso, com qualquer prefixo (o
 * XMP de outro programa pode usar ns2: para o mesmo namespace do
 * photoshop:): cidade, estado, pais, codigo e nome do pais, estado ou
 * provincia, sublocal, local, nome e identificador do local e regiao. O
 * exif:GPSAreaInformation ja conta pelo exif:GPS, com qualquer valor.
 */
const NOMES_DE_LUGAR = [
  "City",
  "State",
  "Country",
  "CountryCode",
  "CountryName",
  "ProvinceState",
  "Sublocation",
  "Location",
  "LocationName",
  "LocationId",
  "WorldRegion",
] as const;
/** Os nomes numa expressao so (o mais longo antes: CountryCode antes de Country). */
const NOME_DE_LUGAR = new RegExp(
  [...NOMES_DE_LUGAR].sort((a, b) => b.length - a.length).join("|"),
  "g",
);
/** Quantas ocorrencias se olham (mais que isso: na duvida, e lugar). */
const OCORRENCIAS_DE_LUGAR = 256;
/** Ate onde se procura o fim do valor (mais longe: na duvida, e lugar). */
const JANELA_DO_LUGAR = 4096;

/** O trecho tem texto fora das tags? (O "<" sem ">" depois fica como texto.) */
function temTextoForaDasTags(trecho: string): boolean {
  let i = 0;
  while (i < trecho.length) {
    const c = trecho.charCodeAt(i);
    if (c === 0x3c) {
      const fim = trecho.indexOf(">", i + 1);
      if (fim < 0) {
        return true;
      }
      i = fim + 1;
      continue;
    }
    if (!brancoDoXml(c)) {
      return true;
    }
    i += 1;
  }
  return false;
}

/**
 * Ha lugar escrito por extenso com valor? O atributo (prefixo:Nome="valor",
 * ou Nome="valor") e o elemento (<prefixo:Nome ...>valor</prefixo:Nome>, ou
 * sem o prefixo), achados pelo nome local e conferidos a mao em volta (o
 * prefixo para tras, ate o "<" ou o branco). O valor vazio (ou so brancos)
 * e a chave sem valor (<photoshop:City/>) nao contam; o fechamento que nao
 * aparece na janela, sim (na duvida, e lugar).
 */
function lugarNoTexto(texto: string, trabalho: Trabalho): boolean {
  const nomes = new RegExp(NOME_DE_LUGAR);
  let ocorrencias = 0;
  let varrido = 0;
  for (let achado = nomes.exec(texto); achado !== null; achado = nomes.exec(texto)) {
    gastar(trabalho, CUSTO.volta + (nomes.lastIndex - varrido) * CUSTO.expressao);
    varrido = nomes.lastIndex;
    const local = achado.index;
    const fimDoNome = nomes.lastIndex;
    let inicio = local;
    if (texto.charCodeAt(local - 1) === 0x3a) {
      let i = local - 2;
      while (i >= 0 && caractereDePrefixo(texto.charCodeAt(i))) {
        i -= 1;
      }
      gastar(trabalho, (local - 2 - i) * CUSTO.caractere);
      if (i === local - 2) {
        continue; // ":City" sem prefixo nao e nome
      }
      inicio = i + 1;
    }
    const antes = inicio > 0 ? texto.charCodeAt(inicio - 1) : -1;
    const seguinte = texto.charCodeAt(fimDoNome);
    let elemento = false;
    let inicioDoValor = -1;
    let aspa = "";
    if (antes === 0x3c) {
      if (!brancoDoXml(seguinte) && seguinte !== 0x2f && seguinte !== 0x3e) {
        continue;
      }
      elemento = true;
    } else if (antes === -1 || brancoDoXml(antes) || antes === 0x22 || antes === 0x27) {
      let j = fimDoNome;
      while (brancoDoXml(texto.charCodeAt(j))) {
        j += 1;
      }
      if (texto.charCodeAt(j) !== 0x3d) {
        continue;
      }
      j += 1;
      while (brancoDoXml(texto.charCodeAt(j))) {
        j += 1;
      }
      gastar(trabalho, (j - fimDoNome) * CUSTO.caractere);
      const c = texto.charCodeAt(j);
      if (c !== 0x22 && c !== 0x27) {
        continue;
      }
      aspa = c === 0x22 ? '"' : "'";
      inicioDoValor = j + 1;
    } else {
      continue;
    }
    ocorrencias += 1;
    if (ocorrencias > OCORRENCIAS_DE_LUGAR) {
      return true;
    }
    gastar(trabalho, CUSTO.volta + JANELA_DO_LUGAR * 2 * CUSTO.caractere);
    if (!elemento) {
      const janela = texto.slice(inicioDoValor, inicioDoValor + JANELA_DO_LUGAR);
      const fim = janela.indexOf(aspa);
      if (fim < 0 || janela.slice(0, fim).trim() !== "") {
        return true;
      }
      continue;
    }
    const janela = texto.slice(inicio - 1, inicio - 1 + JANELA_DO_LUGAR);
    const fimDaTag = janela.indexOf(">");
    if (fimDaTag < 0) {
      return true;
    }
    if (janela.charCodeAt(fimDaTag - 1) === 0x2f) {
      continue; // <photoshop:City/>: a chave sem valor
    }
    const fechamento = janela.indexOf(`</${texto.slice(inicio, fimDoNome)}`, fimDaTag);
    if (fechamento < 0) {
      return true;
    }
    // O texto de dentro, sem as tags (o LocationName vem num rdf:Alt).
    if (temTextoForaDasTags(janela.slice(fimDaTag + 1, fechamento))) {
      return true;
    }
  }
  gastar(trabalho, (texto.length - varrido) * CUSTO.expressao);
  return false;
}

/** As chaves de lugar do dicionario /Info: /City e as /GPS... (tambem com #xx). */
const LUGAR_NO_INFO = new RegExp(
  `\\/(?:${nomeComEscapes("City")}|${nomeComEscapes("GPS")}[^\\0\\t\\n\\f\\r ()<>\\[\\]{}/%]*)${SEM_PALAVRA_DEPOIS}`,
  "g",
);

/** O texto (de uma string do PDF) tem conteudo? A marca do UTF-16/UTF-8, os zeros e os brancos nao contam. */
function textoComConteudo(texto: string): boolean {
  let sem = texto;
  if (sem.startsWith("\xfe\xff") || sem.startsWith("\xff\xfe")) {
    sem = sem.slice(2);
  } else if (sem.startsWith("\xef\xbb\xbf")) {
    sem = sem.slice(3);
  }
  return sem.replace(/\0/g, "").trim() !== "";
}

/** O valor de um digito hexadecimal, ou -1. */
function valorHexadecimal(c: number): number {
  if (c >= 0x30 && c <= 0x39) {
    return c - 0x30;
  }
  if (c >= 0x41 && c <= 0x46) {
    return c - 0x37;
  }
  if (c >= 0x61 && c <= 0x66) {
    return c - 0x57;
  }
  return -1;
}

/**
 * A string hexadecimal do PDF (sem os < >) tem conteudo? Lida par a par, sem
 * montar texto: a marca do UTF-16 (FEFF ou FFFE) ou do UTF-8 (EFBBBF) no
 * comeco, o zero e os brancos nao contam; o que nao e hexadecimal: na
 * duvida, sim.
 */
function hexadecimalComConteudo(hexa: string): boolean {
  const marcas = [
    [0xfe, 0xff],
    [0xff, 0xfe],
    [0xef, 0xbb, 0xbf],
  ];
  const comeco: number[] = [];
  let alto = -1;
  for (let i = 0; i < hexa.length; i += 1) {
    const c = hexa.charCodeAt(i);
    if (brancoDoPdf(c)) {
      continue;
    }
    const valor = valorHexadecimal(c);
    if (valor < 0) {
      return true;
    }
    if (alto < 0) {
      alto = valor;
      continue;
    }
    const byte = alto * 16 + valor;
    alto = -1;
    if (comeco.length < 3) {
      comeco.push(byte);
      continue;
    }
    if (byte !== 0x00 && !brancoDoXml(byte)) {
      return true;
    }
  }
  if (alto >= 0) {
    comeco.push(alto * 16);
  }
  // Os primeiros bytes: sem a marca, o resto tem de ser zero ou branco.
  const marca = marcas.find((m) => m.every((b, i) => comeco[i] === b));
  return comeco.slice(marca?.length ?? 0).some((byte) => byte !== 0x00 && !brancoDoXml(byte));
}

/**
 * O valor do PDF que comeca em i (logo depois da chave) tem conteudo? A
 * string vazia ("()", "<>", so brancos ou so a marca do UTF-16), o null e a
 * chave sem valor (">>", "]", o fim) nao contam; o resto conta (um nome, um
 * numero, uma referencia, uma lista: na duvida, e lugar).
 */
function valorComConteudo(t: string, i: number, trabalho: Trabalho): boolean {
  const v = pularBrancos(t, i, trabalho);
  if (v >= t.length) {
    return false;
  }
  const c = t.charCodeAt(v);
  if ((c === 0x3e && t.charCodeAt(v + 1) === 0x3e) || c === 0x5d || c === 0x7d || c === 0x29) {
    return false;
  }
  if (c === 0x28) {
    const fim = fimDaString(t, v);
    gastar(trabalho, ((fim < 0 ? t.length : fim) - v) * 2 * CUSTO.caractere);
    return fim < 0 || textoComConteudo(t.slice(v + 1, fim - 1));
  }
  if (c === 0x3c && t.charCodeAt(v + 1) !== 0x3c) {
    const fim = t.indexOf(">", v + 1);
    gastar(trabalho, ((fim < 0 ? t.length : fim) - v) * 2 * CUSTO.caractere);
    return fim < 0 || hexadecimalComConteudo(t.slice(v + 1, fim));
  }
  if (t.startsWith("null", v) && !regularDoPdf(t.charCodeAt(v + 4))) {
    return false;
  }
  return true;
}

/** Uma chave /City ou /GPS... com valor (o dicionario /Info, solto ou num fluxo de objetos)? */
function lugarNoInfo(texto: string, trabalho: Trabalho): boolean {
  const chaves = new RegExp(LUGAR_NO_INFO);
  let varrido = 0;
  for (let achado = chaves.exec(texto); achado !== null; achado = chaves.exec(texto)) {
    gastar(trabalho, CUSTO.volta + (chaves.lastIndex - varrido) * CUSTO.expressao);
    varrido = chaves.lastIndex;
    if (valorComConteudo(texto, chaves.lastIndex, trabalho)) {
      return true;
    }
  }
  gastar(trabalho, (texto.length - varrido) * CUSTO.expressao);
  return false;
}

/** O XMP tem a localizacao? (Em UTF-16, os zeros saem e sobra o ASCII.) */
function localizacaoNoXmp(xmp: string, trabalho: Trabalho): boolean {
  gastar(trabalho, xmp.length * CUSTO.nativo);
  const texto = xmp.includes("\0") ? xmp.replace(/\0/g, "") : xmp;
  return (
    casaNoTexto(GPS_NO_XMP, texto, trabalho) ||
    casaNoTexto(COORDENADA_DO_XMP, texto, trabalho) ||
    lugarNoTexto(texto, trabalho) ||
    coordenadaNasPropriedades(texto, trabalho)
  );
}

/**
 * A localizacao no PDF (ja sem a das fotos, que a limpeza zerou): as
 * propriedades de GPS, o lugar por extenso e as chaves /City e /GPS... do
 * /Info em qualquer lugar do arquivo sem compressao e dentro dos fluxos de
 * objetos, e o XMP de cada fluxo de metadados (/Type /Metadata, /Subtype
 * /XML ou o que um /Metadata aponta: do catalogo, da pagina, da foto),
 * descomprimido com os tetos (o do XMP e o do total). O fluxo de metadados
 * que nao da para ler: "formato".
 */
function comLocalizacao(
  texto: string,
  saida: Uint8Array,
  lido: PdfLido,
  trabalho: Trabalho,
): boolean {
  for (const solto of [texto, ...lido.textosDeDentro]) {
    if (
      casaNoTexto(GPS_NO_XMP, solto, trabalho) ||
      lugarNoTexto(solto, trabalho) ||
      lugarNoInfo(solto, trabalho)
    ) {
      return true;
    }
  }
  const apontados = new Set<number>();
  for (const objeto of lido.todos) {
    gastar(trabalho, CUSTO.passo);
    for (const valor of objeto.dicionario?.get("Metadata") ?? []) {
      gastar(trabalho, CUSTO.volta);
      const referencia = SO_REFERENCIA.exec(valor);
      if (referencia !== null) {
        apontados.add(Number(referencia[1]));
      }
    }
  }
  let restante = lido.descomprimidoRestante;
  for (const objeto of lido.objetos) {
    gastar(trabalho, CUSTO.passo);
    const d = objeto.dicionario;
    if (objeto.fluxo === null || d === null) {
      continue;
    }
    if (
      !tiposDoDicionario(d, trabalho).includes("Metadata") &&
      !nomesDaChave(d, "Subtype", trabalho).includes("XML") &&
      !apontados.has(objeto.numero)
    ) {
      continue;
    }
    const filtros = filtrosDoFluxo(d, trabalho);
    if (
      filtros.length > 1 ||
      filtros.some((f) => f !== "FlateDecode") ||
      comPreditor(d, trabalho)
    ) {
      throw new MidiaDeFora("formato");
    }
    let dados: Uint8Array = saida.subarray(objeto.fluxo.inicio, objeto.fluxo.fim);
    if (filtros.length === 1) {
      if (restante <= 0) {
        throw new MidiaDeFora("bomba");
      }
      dados = descomprimir(dados, Math.min(restante, LIMITES_DA_MIDIA.pdfXmp), trabalho);
    }
    if (dados.length > LIMITES_DA_MIDIA.pdfXmp) {
      throw new MidiaDeFora("bomba");
    }
    restante -= dados.length;
    if (restante < 0) {
      throw new MidiaDeFora("bomba");
    }
    if (localizacaoNoXmp(latin1(dados, trabalho), trabalho)) {
      return true;
    }
  }
  return false;
}

function prepararPdf(bytes: Uint8Array, trabalho: Trabalho): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.pdf.maximoDeBytes) {
    return fora("grande_demais");
  }
  const lido = lerPdf(bytes, trabalho);
  if (lido.paginas > LIMITES_DA_MIDIA.pdf.maximoDePaginas) {
    return fora("paginas_demais");
  }
  const saida = semMetadadosDasFotos(bytes, lido.objetos, trabalho);
  // Depois da limpeza das fotos: o Exif e o XMP de dentro delas ja sao zero.
  const texto = latin1(saida, trabalho);
  if (comAnexo(texto, lido, trabalho) || comLocalizacao(texto, saida, lido, trabalho)) {
    return fora("formato");
  }
  return { tipo: "pdf", bytes: saida, paginas: lido.paginas };
}

// ---------------------------------------------------------------------------
// Versoes
// ---------------------------------------------------------------------------

/**
 * A regra da figurinha (D-98), para a versao da leitura local
 * (ia_leitura_da_midia.versao, "figurinha-" e 12 hex).
 */
export const FONTES_DA_FIGURINHA = {
  regra: `webp ${LADO_DA_FIGURINHA}x${LADO_DA_FIGURINHA} ou animado (VP8X 0x02, ANIM, ANMF)`,
  limites: LIMITES_DA_MIDIA.imagem,
} as const;

export const VERSAO_DA_FIGURINHA = `figurinha-${createHash("sha256")
  .update(JSON.stringify(FONTES_DA_FIGURINHA), "utf8")
  .digest("hex")
  .slice(0, 12)}`;

/** O preparo inteiro (limites, listas do que fica, paginas), para as versoes. */
export const FONTES_DO_PREPARO = {
  limites: LIMITES_DA_MIDIA,
  trabalho: { porArquivo: LIMITES_DA_MIDIA.trabalhoPorArquivo, custo: CUSTO },
  formatos: FORMATOS_DA_MIDIA,
  jpeg: {
    quadros: [...SOF_ACEITOS],
    ficam: "SOF, DHT, DQT, DRI, APP0 JFIF sem miniatura e APP14 Adobe antes da varredura; DHT, DQT, DRI, DNL e SOS entre as varreduras; ate o primeiro EOI",
    orientacao: "APP1 minimo com a orientacao diferente de 1",
    segmentos: SEGMENTOS_DO_JPEG,
  },
  png: {
    ficam: [...PEDACOS_DO_PNG_QUE_FICAM],
    animado: [...PEDACOS_DO_PNG_ANIMADO],
    pedacos: PEDACOS_DA_IMAGEM,
  },
  webp: {
    ficam: [...PEDACOS_DO_WEBP_QUE_FICAM],
    saem: [...PEDACOS_DO_WEBP_QUE_SAEM],
    pedacos: PEDACOS_DA_IMAGEM,
  },
  mp3: { ficam: "so os quadros MPEG do mesmo fluxo", lixo: LIXO_ACEITO },
  pdf: {
    paginas: "a maior entre /Count, /Type /Page e /Kids, no texto e nos fluxos de objetos",
    fora: "/Encrypt; /JPXDecode; cadeia com /DCTDecode; metadado com outro filtro; fluxo dentro de outro",
    foto: "/DCTDecode limpa no lugar numa copia (APP1 a APP15 e COM zerados, nada depois do EOI)",
    localizacao: {
      gps: GPS_NO_XMP.source,
      coordenadaDoXmp: COORDENADA_DO_XMP.source,
      photoshopOuXmp: COORDENADAS_NO_VALOR.map((expressao) => expressao.source),
      lugarComValor: [...NOMES_DE_LUGAR],
      lugarComQualquerPrefixo: true,
      info: LUGAR_NO_INFO.source,
      soltaNoArquivoENosFluxosDeObjetos: true,
    },
    anexo: { nomes: ANEXO.source, chave: "/EF" },
    residual: "imagem embutida no conteudo (BI ... EI) nao e limpa",
  },
} as const;
