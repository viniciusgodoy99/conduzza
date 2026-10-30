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
//    suportado. De 1 a 120 s e ate 5 MB;
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
//      animado (APNG) ou pedaco critico desconhecido: nao suportado;
//    . WebP: ficam VP8X (so a marca de alfa), ALPH e um VP8 ou VP8L; ICCP,
//      EXIF e XMP nunca saem, nem nada depois do RIFF; o tamanho do RIFF e
//      corrigido. Outro pedaco: nao suportado;
//  - FIGURINHA (D-98): WebP de exatamente 512 por 512 ou WebP animado. Nao
//    vai a modelo nenhum (a leitura e local);
//  - PDF, ate 5 MB e 3 paginas, sem criptografia (/Encrypt). As paginas sao
//    a MAIOR entre o /Count dos nos /Type /Pages, os objetos /Type /Page e
//    os filhos das listas /Kids que nao sao no, cada objeto pelo numero (o
//    reescrito numa atualizacao incremental conta uma vez), no texto e
//    dentro dos fluxos de objetos (/Type /ObjStm, descomprimidos com
//    node:zlib). Sem /Count: nao suportado. Tetos contra o arquivo feito
//    para travar o motor (fluxos, objetos, caracteres varridos, o
//    descomprimido no total e a sobra do fluxo de objetos): "bomba". A foto
//    embutida (fluxo so com /DCTDecode) e limpa no lugar, sem mudar o
//    tamanho (o /Length e a xref continuam certos): APP1 a APP15 e COM viram
//    um COM zerado do mesmo tamanho (ficam o APP0 JFIF, sem a miniatura, e o
//    APP14 Adobe) e o que vem depois do primeiro EOI vira zero. /DCTDecode
//    numa cadeia de filtros, ou /JPXDecode: nao suportado. Os metadados do
//    PDF ficam (D-101: tirar exigiria biblioteca nova), MENOS a localizacao
//    e o anexo, que deixam o PDF de fora (nao suportado):
//    . a localizacao: exif:GPS, GPSLatitude, GPSLongitude, a coordenada no
//      formato do XMP ("3,43.914S"), uma coordenada numa propriedade
//      photoshop: ou xmp:, ou o lugar escrito por extenso com valor (cidade,
//      estado, pais e local do photoshop: e do IPTC Core, e os campos de
//      Iptc4xmpExt:LocationShown e LocationCreated; o valor vazio e a chave
//      sem valor nao contam), no XMP de cada fluxo de metadados (/Type
//      /Metadata, /Subtype /XML ou o que um /Metadata aponta: do catalogo,
//      da pagina, da foto; descomprimido com o teto) e, as propriedades de
//      GPS e de lugar, em qualquer lugar do arquivo sem compressao. Metadado
//      que nao da para ler (outro filtro): nao suportado;
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
   * metadados (bomba de compressao). Nos PDFs reais conferidos, o maior foi
   * de 295 bytes.
   */
  pdfDescomprimidoNoTotal: 8 * MB,
  /** Teto de fluxos de objetos lidos num PDF. */
  pdfFluxosDeObjetos: 200,
  /** Teto de fluxos num PDF, e de marcas "endstream" (o de 3 paginas tem dezenas). */
  pdfFluxos: 2_000,
  /** Teto de objetos num PDF: os cabecalhos "N G obj" e os de dentro dos fluxos de objetos. */
  pdfObjetos: 20_000,
  /** Teto de caracteres varridos nos dicionarios do PDF, somados (a CPU sincrona do motor). */
  pdfCaracteresVarridos: 64 * MB,
  /** O que pode sobrar num fluxo de objetos depois do ultimo objeto declarado. */
  pdfSobraNoFluxoDeObjetos: 64 * 1024,
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
  const partes = [0, 1, 2, 3].map((i) => bytes[p + i] ?? 0x80);
  if (partes.some((b) => b >= 0x80)) {
    return null;
  }
  return (
    ((partes[0] ?? 0) << 21) |
    ((partes[1] ?? 0) << 14) |
    ((partes[2] ?? 0) << 7) |
    (partes[3] ?? 0)
  );
}

function juntar(partes: readonly Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, parte) => soma + parte.length, 0);
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
 * qualquer excecao na leitura vira "corrompido".
 */
export function prepararMidia(entrada: {
  midia: MidiaDaMensagem;
  bytes: Uint8Array;
  mimetype: string | null | undefined;
}): MidiaPreparada {
  try {
    return prepararSemRede(entrada);
  } catch {
    return fora("corrompido");
  }
}

function prepararSemRede(entrada: {
  midia: MidiaDaMensagem;
  bytes: Uint8Array;
  mimetype: string | null | undefined;
}): MidiaPreparada {
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
      return prepararAudio(bytes);
    case "jpeg":
      return prepararJpeg(bytes);
    case "png":
      return prepararPng(bytes);
    case "webp":
      return prepararWebp(bytes);
    case "pdf":
      return prepararPdf(bytes);
  }
}

// ---------------------------------------------------------------------------
// Audio: MP3, so os quadros
// ---------------------------------------------------------------------------

/** O tamanho de uma etiqueta ID3v2 que comeca em p, com o cabecalho e o rodape. */
function tamanhoDoId3v2(bytes: Uint8Array, p: number): number | null {
  if (!comecaCom(bytes, ascii("ID3"), p) || bytes.length < p + 10) {
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
  if (p + 32 > fim || !comecaCom(bytes, ascii("APETAGEX"), p)) {
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
  if (rodape < inicio || !comecaCom(bytes, ascii("APETAGEX"), rodape)) {
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
function tamanhoDoLyrics3NoFim(bytes: Uint8Array, inicio: number, fim: number): number | null {
  const comeco = ascii("LYRICSBEGIN");
  if (fim - 15 >= inicio && comecaCom(bytes, ascii("LYRICS200"), fim - 9)) {
    // v2: o tamanho em 6 digitos antes de "LYRICS200" (com o "LYRICSBEGIN").
    const digitos = String.fromCharCode(...bytes.subarray(fim - 15, fim - 9));
    if (!/^\d{6}$/.test(digitos)) {
      return null;
    }
    const total = Number(digitos) + 15;
    return fim - total >= inicio && comecaCom(bytes, comeco, fim - total) ? total : null;
  }
  if (fim - 20 >= inicio && comecaCom(bytes, ascii("LYRICSEND"), fim - 9)) {
    // v1: "LYRICSBEGIN" ate 5.100 bytes antes de "LYRICSEND".
    for (let p = fim - 9 - comeco.length; p >= Math.max(inicio, fim - 9 - 5100 - comeco.length); p -= 1) {
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
  if (rodape < inicio || !comecaCom(bytes, ascii("3DI"), rodape)) {
    return null;
  }
  const corpo = syncsafe(bytes, rodape + 6);
  if (corpo === null) {
    return null;
  }
  const total = 10 + corpo + 10;
  return fim - total >= inicio && comecaCom(bytes, ascii("ID3"), fim - total) ? total : null;
}

/**
 * Onde estao os quadros: o arquivo sem as etiquetas do comeco (ID3v2, APE
 * com cabecalho) e do fim (ID3v1 e o "TAG+", APE, Lyrics3, ID3v2 com
 * rodape), em qualquer ordem.
 */
function regiaoDoAudio(bytes: Uint8Array): { inicio: number; fim: number } {
  let inicio = 0;
  for (let i = 0; i < 8; i += 1) {
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
    if (fim - 128 >= inicio && comecaCom(bytes, ascii("TAG"), fim - 128)) {
      fim -= 128;
      continue;
    }
    if (fim - 227 >= inicio && comecaCom(bytes, ascii("TAG+"), fim - 227)) {
      fim -= 227;
      continue;
    }
    const etiqueta =
      tamanhoDoApeNoFim(bytes, inicio, fim) ??
      tamanhoDoLyrics3NoFim(bytes, inicio, fim) ??
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
    (TAXAS_KBPS[`${mpeg1 ? 1 : 2}-${numeroDaCamada}`]?.[indiceDaTaxa] ?? 0) *
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

type AnaliseDoMp3 = {
  /** Os quadros, na ordem (a lista do que fica). */
  quadros: Uint8Array[];
  segundos: number;
  lixo: number;
  /** O tamanho da regiao dos quadros (sem as etiquetas). */
  regiao: number;
};

/**
 * Os quadros do MP3. null: nenhum quadro confirmado perto do comeco da
 * regiao (depois das etiquetas).
 */
function analisarMp3(bytes: Uint8Array): AnaliseDoMp3 | null {
  const { inicio, fim } = regiaoDoAudio(bytes);
  let p = -1;
  let fluxo: QuadroMpeg | null = null;
  const limite = Math.min(fim - 4, inicio + LIXO_ACEITO.piso);
  for (let q = inicio; q <= limite; q += 1) {
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
  const vista = bytes.subarray(0, fim);
  const quadros: Uint8Array[] = [];
  let segundos = 0;
  let lixo = p - inicio;
  while (p + 4 <= fim) {
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
    lixo += ate - p;
    p = ate;
  }
  lixo += Math.max(0, fim - p);
  return { quadros, segundos, lixo, regiao: fim - inicio };
}

function lixoDemais(analise: AnaliseDoMp3): boolean {
  return analise.lixo > Math.max(LIXO_ACEITO.piso, analise.regiao * LIXO_ACEITO.fracao);
}

/**
 * Os bytes do MP3 so com os quadros MPEG (lista do que fica): sem ID3v2,
 * ID3v1, APE, Lyrics3 e nada entre os quadros. Sem quadro: vazio. (O nome
 * ficou da primeira versao, que so tirava o ID3.)
 */
export function semEtiquetasId3(bytes: Uint8Array): Uint8Array {
  const analise = analisarMp3(bytes);
  return analise === null ? new Uint8Array(0) : juntar(analise.quadros);
}

/**
 * A duracao do MP3, somando os quadros. null quando nao ha quadro nenhum ou
 * o lixo passa do aceito.
 */
export function duracaoDoMp3(bytes: Uint8Array): {
  segundos: number;
  quadros: number;
} | null {
  const analise = analisarMp3(bytes);
  if (analise === null || analise.quadros.length === 0 || lixoDemais(analise)) {
    return null;
  }
  return { segundos: analise.segundos, quadros: analise.quadros.length };
}

function prepararAudio(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.audio.maximoDeBytes) {
    return fora("grande_demais");
  }
  const analise = analisarMp3(bytes);
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
  return { tipo: "audio", bytes: juntar(analise.quadros), segundos: analise.segundos };
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
 * quebrada ou sem EOI ate `ate`: "corrompido".
 */
function andarPeloJpeg(
  bytes: Uint8Array,
  de: number,
  ate: number,
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
    if (p >= ate || vista[p] !== 0xff) {
      return { motivo: "corrompido" };
    }
    let q = p + 1;
    while (q < ate && vista[q] === 0xff) {
      q += 1;
    }
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
  for (let i = 0; i < entradas && i < 512; i += 1) {
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

function prepararJpeg(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const andado = andarPeloJpeg(bytes, 0, bytes.length);
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
  return { tipo: "imagem", formato: "jpeg", bytes: juntar(partes) };
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

function prepararPng(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const partes: Uint8Array[] = [bytes.subarray(0, 8)];
  let p = 8;
  let fimDoPng = false;
  while (p < bytes.length) {
    if (p + 12 > bytes.length) {
      return fora("corrompido");
    }
    const tamanho =
      (((bytes[p] ?? 0) << 24) |
        ((bytes[p + 1] ?? 0) << 16) |
        ((bytes[p + 2] ?? 0) << 8) |
        (bytes[p + 3] ?? 0)) >>>
      0;
    const tipo = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const fim = p + 12 + tamanho;
    if (fim > bytes.length || !/^[A-Za-z]{4}$/.test(tipo)) {
      return fora("corrompido");
    }
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
  return { tipo: "imagem", formato: "png", bytes: juntar(partes) };
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

/** Os pedacos de dentro do RIFF (o que vem depois do RIFF fica de fora). */
function pedacosDoWebp(bytes: Uint8Array): PedacoDoWebp[] | null {
  const fimDoRiff = 8 + u32le(bytes, 4);
  if (fimDoRiff < 12 || fimDoRiff > bytes.length) {
    return null;
  }
  const pedacos: PedacoDoWebp[] = [];
  let p = 12;
  while (p < fimDoRiff) {
    if (p + 8 > fimDoRiff) {
      return null;
    }
    const tipo = String.fromCharCode(...bytes.subarray(p, p + 4));
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

function prepararWebp(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const pedacos = pedacosDoWebp(bytes);
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
  const partes: Uint8Array[] = [bytes.slice(0, 12)];
  let imagens = 0;
  for (const [indice, pedaco] of pedacos.entries()) {
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
    const copia = bytes.slice(pedaco.inicio, pedaco.fim);
    if (pedaco.tipo === "VP8X") {
      // So a marca de alfa fica (ICC, EXIF e XMP sairam; animacao e figurinha).
      copia[8] = (copia[8] ?? 0) & MARCA_ALFA;
    }
    partes.push(copia);
  }
  if (imagens !== 1) {
    return fora("corrompido");
  }
  const saida = juntar(partes);
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

/** O PDF fica de fora: lancado de dentro da leitura, convertido em prepararPdf. */
class PdfDeFora extends Error {
  constructor(readonly motivo: MotivoDeFora) {
    super(motivo);
  }
}

/** O orcamento de caracteres varridos (o teto de CPU da leitura do PDF). */
type Orcamento = { restante: number };

function gastar(orcamento: Orcamento, caracteres: number): void {
  orcamento.restante -= caracteres;
  if (orcamento.restante < 0) {
    throw new PdfDeFora("bomba");
  }
}

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

const BRANCO = "[\\0\\t\\n\\f\\r ]";
const SEM_PALAVRA_DEPOIS = "(?![^\\0\\t\\n\\f\\r ()<>\\[\\]{}/%])";

/** O cabecalho de um objeto ("12 0 obj"); limites nos numeros e nos brancos. */
const CABECALHO_DE_OBJETO = new RegExp(
  `(\\d{1,10})${BRANCO}{1,32}(\\d{1,5})${BRANCO}{1,32}obj${SEM_PALAVRA_DEPOIS}`,
  "g",
);
/** Uma referencia ("12 0 R") no meio de uma lista. */
const REFERENCIA = new RegExp(`(\\d{1,10})${BRANCO}+(\\d{1,5})${BRANCO}+R${SEM_PALAVRA_DEPOIS}`, "g");
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
function pularBrancos(t: string, i: number, orcamento: Orcamento): number {
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
  gastar(orcamento, j - i);
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

/** O fim do valor que comeca em i (ja sem brancos), ou -1 (malformado). Gasta o orcamento. */
function fimDoValor(t: string, i: number, orcamento: Orcamento): number {
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
  gastar(orcamento, (fim < 0 ? t.length : fim) - i);
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
function fimComReferencia(t: string, i: number, fim: number, orcamento: Orcamento): number {
  if (!soDigitos(t, i, fim)) {
    return fim;
  }
  const g = pularBrancos(t, fim, orcamento);
  const fimDoG = fimDaPalavra(t, g);
  gastar(orcamento, fimDoG - g);
  if (!soDigitos(t, g, fimDoG)) {
    return fim;
  }
  const r = pularBrancos(t, fimDoG, orcamento);
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
 * valor ou o dicionario nao fecham).
 */
function lerDicionario(
  t: string,
  i: number,
  orcamento: Orcamento,
): { dicionario: DicionarioDoPdf; fim: number } | null {
  const dicionario: DicionarioDoPdf = new Map();
  let j = i + 2;
  for (;;) {
    j = pularBrancos(t, j, orcamento);
    if (j >= t.length) {
      return null;
    }
    const c = t.charCodeAt(j);
    if (c === 0x3e && t.charCodeAt(j + 1) === 0x3e) {
      return { dicionario, fim: j + 2 };
    }
    if (c !== 0x2f) {
      const fimDoSolto = fimDoValor(t, j, orcamento);
      if (fimDoSolto < 0) {
        return null;
      }
      j = fimDoSolto;
      continue;
    }
    const fimDaChave = fimDaPalavra(t, j + 1);
    gastar(orcamento, fimDaChave - j);
    // A chave mais longa lida, com todos os escapes, cabe em 40.
    const chave =
      fimDaChave - j - 1 <= 40 ? nomeDecodificado(t.slice(j + 1, fimDaChave)) : "";
    const inicioDoValor = pularBrancos(t, fimDaChave, orcamento);
    const fimDoValorLido = fimDoValor(t, inicioDoValor, orcamento);
    if (fimDoValorLido < 0) {
      return null;
    }
    const fim = fimComReferencia(t, inicioDoValor, fimDoValorLido, orcamento);
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

/** Os nomes de um valor (um nome, ou uma lista so de nomes), sem a barra; null: outra coisa. */
function nomesDoValor(valor: string): string[] | null {
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
function nomesDaChave(d: DicionarioDoPdf, chave: string): string[] {
  return (d.get(chave) ?? []).flatMap((valor) => nomesDoValor(valor) ?? []);
}

function tiposDoDicionario(d: DicionarioDoPdf): string[] {
  return nomesDaChave(d, "Type");
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
function filtrosDoFluxo(d: DicionarioDoPdf): string[] {
  const valores = d.get("Filter");
  if (valores === undefined) {
    return [];
  }
  const nomes = valores.length === 1 ? nomesDoValor(valores[0] ?? "") : null;
  if (nomes === null) {
    throw new PdfDeFora("formato");
  }
  return nomes.map((nome) => ABREVIACOES_DE_FILTRO[nome] ?? nome);
}

/** O fluxo tem preditor (ou parametros que so resolvendo a referencia)? */
function comPreditor(d: DicionarioDoPdf): boolean {
  return (d.get("DecodeParms") ?? []).some((valor) => {
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

/** Os inteiros do valor: direto, ou pela referencia a um objeto que e so um inteiro. */
function inteirosDoValor(valor: string, soValores: ReadonlyMap<number, string[]>): number[] {
  if (INTEIRO.test(valor)) {
    return [Number(valor)];
  }
  const referencia = SO_REFERENCIA.exec(valor);
  if (referencia === null) {
    return [];
  }
  return (soValores.get(Number(referencia[1])) ?? [])
    .filter((v) => INTEIRO.test(v))
    .map(Number);
}

type ObjetoDoPdf = {
  numero: number;
  dicionario: DicionarioDoPdf | null;
  /** O valor bruto quando o objeto nao e dicionario (a lista /Kids ou o /Count indiretos). */
  valor: string | null;
  /** Os bytes do fluxo: do primeiro dado ate a marca "endstream". */
  fluxo: { inicio: number; fim: number } | null;
};

/** O texto latin1 (um caractere por byte), sem copiar os bytes antes. */
function latin1(bytes: Uint8Array): string {
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
function comecoDosDados(t: string, s: number, orcamento: Orcamento): number | "nao" | "malformado" {
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
  gastar(orcamento, k - s);
  if (t.charCodeAt(k) === 0x0d) {
    return t.charCodeAt(k + 1) === 0x0a ? k + 2 : k + 1;
  }
  if (t.charCodeAt(k) === 0x0a) {
    return k + 1;
  }
  return "malformado";
}

/** Descomprime (FlateDecode) com o teto. Passou do teto: "bomba"; nao descomprime: "corrompido". */
function descomprimir(dados: Uint8Array, teto: number): Uint8Array {
  try {
    return inflateSync(dados, { maxOutputLength: teto });
  } catch (erro) {
    if (
      erro instanceof RangeError ||
      (erro as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new PdfDeFora("bomba");
    }
    throw new PdfDeFora("corrompido");
  }
}

/**
 * Os objetos de um fluxo de objetos ja descomprimido: o cabecalho (N pares
 * "numero deslocamento" antes de /First) e cada objeto no deslocamento. O
 * enchimento depois do ultimo objeto declarado e "bomba".
 */
function lerFluxoDeObjetos(
  texto: string,
  d: DicionarioDoPdf,
  orcamento: Orcamento,
  saida: ObjetoDoPdf[],
  jaLidos: number,
): void {
  const n = inteiroDaChave(d, "N") ?? -1;
  const primeiro = inteiroDaChave(d, "First") ?? -1;
  if (n < 0 || primeiro < 0 || primeiro > texto.length) {
    throw new PdfDeFora("corrompido");
  }
  if (jaLidos + saida.length + n > LIMITES_DA_MIDIA.pdfObjetos) {
    throw new PdfDeFora("bomba");
  }
  const cabecalho = texto.slice(0, primeiro);
  gastar(orcamento, primeiro);
  const numeros = /\d{1,10}/g;
  let fimDoUltimo = primeiro;
  for (let k = 0; k < n; k += 1) {
    const numero = numeros.exec(cabecalho);
    const deslocamento = numero === null ? null : numeros.exec(cabecalho);
    if (numero === null || deslocamento === null) {
      throw new PdfDeFora("corrompido");
    }
    const inicio = primeiro + Number(deslocamento[0]);
    if (inicio >= texto.length) {
      throw new PdfDeFora("corrompido");
    }
    const v = pularBrancos(texto, inicio, orcamento);
    let fim: number;
    if (texto.startsWith("<<", v)) {
      const lido = lerDicionario(texto, v, orcamento);
      if (lido === null) {
        throw new PdfDeFora("corrompido");
      }
      saida.push({ numero: Number(numero[0]), dicionario: lido.dicionario, valor: null, fluxo: null });
      fim = lido.fim;
    } else {
      const fimDoValorLido = fimDoValor(texto, v, orcamento);
      if (fimDoValorLido < 0) {
        throw new PdfDeFora("corrompido");
      }
      fim = fimComReferencia(texto, v, fimDoValorLido, orcamento);
      saida.push({ numero: Number(numero[0]), dicionario: null, valor: texto.slice(v, fim), fluxo: null });
    }
    fimDoUltimo = Math.max(fimDoUltimo, fim);
  }
  if (texto.length - fimDoUltimo > LIMITES_DA_MIDIA.pdfSobraNoFluxoDeObjetos) {
    throw new PdfDeFora("bomba");
  }
}

/**
 * As paginas: a MAIOR entre o /Count dos nos /Type /Pages, os objetos /Type
 * /Page (cada numero uma vez) e os filhos das listas /Kids que nao sao no
 * (cada no pelo numero, a maior das suas versoes). Sem /Count: "sem_paginas".
 */
function contarPaginas(objetos: readonly ObjetoDoPdf[]): number {
  const soValores = new Map<number, string[]>();
  const nos = new Map<number, DicionarioDoPdf[]>();
  const paginas = new Set<number>();
  for (const objeto of objetos) {
    if (objeto.dicionario === null) {
      if (objeto.valor !== null) {
        soValores.set(objeto.numero, [...(soValores.get(objeto.numero) ?? []), objeto.valor]);
      }
      continue;
    }
    const tipos = tiposDoDicionario(objeto.dicionario);
    if (tipos.includes("Pages")) {
      nos.set(objeto.numero, [...(nos.get(objeto.numero) ?? []), objeto.dicionario]);
    }
    if (tipos.includes("Page")) {
      paginas.add(objeto.numero);
    }
  }
  let contagem: number | null = null;
  let folhas = 0;
  for (const versoes of nos.values()) {
    let filhos = 0;
    for (const d of versoes) {
      for (const valor of d.get("Count") ?? []) {
        for (const n of inteirosDoValor(valor, soValores)) {
          if (n >= 1) {
            contagem = Math.max(contagem ?? 0, n);
          }
        }
      }
      for (const valor of d.get("Kids") ?? []) {
        filhos = Math.max(filhos, filhosQueNaoSaoNo(valor, soValores, nos));
      }
    }
    folhas += filhos;
  }
  if (contagem === null) {
    throw new PdfDeFora("sem_paginas");
  }
  return Math.max(contagem, paginas.size, folhas);
}

/** Quantas referencias da lista /Kids (direta ou indireta) nao sao no /Type /Pages. */
function filhosQueNaoSaoNo(
  valor: string,
  soValores: ReadonlyMap<number, string[]>,
  nos: ReadonlyMap<number, unknown>,
): number {
  let listas: string[];
  if (valor.startsWith("[")) {
    listas = [valor];
  } else {
    const referencia = SO_REFERENCIA.exec(valor);
    listas = (referencia === null ? [] : (soValores.get(Number(referencia[1])) ?? [])).filter(
      (v) => v.startsWith("["),
    );
    if (listas.length === 0) {
      throw new PdfDeFora("corrompido");
    }
  }
  let maior = 0;
  for (const lista of listas) {
    let filhos = 0;
    for (const referencia of lista.matchAll(REFERENCIA)) {
      if (!nos.has(Number(referencia[1]))) {
        filhos += 1;
      }
    }
    maior = Math.max(maior, filhos);
  }
  return maior;
}

type PdfLido = {
  /** Os objetos do arquivo (so estes tem fluxo). */
  objetos: ObjetoDoPdf[];
  /** Os do arquivo e os de dentro dos fluxos de objetos. */
  todos: ObjetoDoPdf[];
  /** O texto descomprimido de cada fluxo de objetos (para os anexos). */
  textosDeDentro: string[];
  /** O que ainda cabe no teto do descomprimido (para os metadados). */
  descomprimidoRestante: number;
  paginas: number;
};

/**
 * A leitura do PDF numa passada, com tetos: os objetos (pelos cabecalhos
 * "N G obj" em qualquer lugar do arquivo, ate dentro dos dados de outro
 * fluxo, onde um leitor tambem os acharia pela xref), os fluxos (o fim de
 * cada um e a primeira marca "endstream" depois do comeco), os objetos dos
 * fluxos de objetos e a contagem das paginas. Lanca PdfDeFora.
 */
function lerPdf(bytes: Uint8Array): PdfLido {
  const t = latin1(bytes);
  // /Encrypt mora no trailer ou no dicionario do fluxo de referencias:
  // procurado no arquivo inteiro (o lado seguro).
  if (ENCRYPT.test(t)) {
    throw new PdfDeFora("cifrado");
  }
  const orcamento: Orcamento = { restante: LIMITES_DA_MIDIA.pdfCaracteresVarridos };
  const marcas: number[] = [];
  for (let k = t.indexOf("endstream"); k >= 0; k = t.indexOf("endstream", k + 9)) {
    marcas.push(k);
    if (marcas.length > LIMITES_DA_MIDIA.pdfFluxos) {
      throw new PdfDeFora("bomba");
    }
  }
  const objetos: ObjetoDoPdf[] = [];
  let fluxos = 0;
  // Ate onde vai o fluxo mais longo ja visto: o que esta antes disso esta
  // dentro dos dados de um fluxo (malformado ali e so ignorado).
  let fimDosFluxos = 0;
  const cabecalho = new RegExp(CABECALHO_DE_OBJETO);
  for (let achado = cabecalho.exec(t); achado !== null; achado = cabecalho.exec(t)) {
    if (objetos.length >= LIMITES_DA_MIDIA.pdfObjetos) {
      throw new PdfDeFora("bomba");
    }
    const numero = Number(achado[1]);
    const dentroDeFluxo = achado.index < fimDosFluxos;
    const v = pularBrancos(t, cabecalho.lastIndex, orcamento);
    if (!t.startsWith("<<", v)) {
      const fimDoValorLido = fimDoValor(t, v, orcamento);
      objetos.push({
        numero,
        dicionario: null,
        valor:
          fimDoValorLido < 0
            ? null
            : t.slice(v, fimComReferencia(t, v, fimDoValorLido, orcamento)),
        fluxo: null,
      });
      continue;
    }
    // Malformado (o dicionario, o "stream" sem fim de linha ou sem
    // "endstream" depois): fora, a nao ser dentro dos dados de um fluxo.
    const lido = lerDicionario(t, v, orcamento);
    const dados =
      lido === null
        ? "malformado"
        : comecoDosDados(t, pularBrancos(t, lido.fim, orcamento), orcamento);
    const fim = typeof dados === "number" ? primeiroDesde(marcas, dados) : -1;
    if (lido === null || dados === "malformado" || (dados !== "nao" && fim < 0)) {
      if (dentroDeFluxo) {
        continue;
      }
      throw new PdfDeFora("corrompido");
    }
    let fluxo: ObjetoDoPdf["fluxo"] = null;
    if (dados !== "nao") {
      fluxos += 1;
      if (fluxos > LIMITES_DA_MIDIA.pdfFluxos) {
        throw new PdfDeFora("bomba");
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
    const d = objeto.dicionario;
    if (objeto.fluxo === null || d === null) {
      continue;
    }
    if (!tiposDoDicionario(d).includes("ObjStm") && !(d.has("N") && d.has("First"))) {
      continue;
    }
    fluxosDeObjetos += 1;
    if (fluxosDeObjetos > LIMITES_DA_MIDIA.pdfFluxosDeObjetos) {
      throw new PdfDeFora("bomba");
    }
    const filtros = filtrosDoFluxo(d);
    if (filtros.length > 1 || filtros.some((f) => f !== "FlateDecode") || comPreditor(d)) {
      throw new PdfDeFora("formato");
    }
    let dados: Uint8Array = bytes.subarray(objeto.fluxo.inicio, objeto.fluxo.fim);
    if (filtros.length === 1) {
      if (restante <= 0) {
        throw new PdfDeFora("bomba");
      }
      dados = descomprimir(dados, restante);
    }
    restante -= dados.length;
    if (restante < 0) {
      throw new PdfDeFora("bomba");
    }
    const texto = latin1(dados);
    textosDeDentro.push(texto);
    lerFluxoDeObjetos(texto, d, orcamento, deDentro, objetos.length);
  }
  const todos = objetos.concat(deDentro);
  // O /Encrypt escrito com escape ("/Encr#79pt") tambem e criptografia.
  if (todos.some((objeto) => objeto.dicionario?.has("Encrypt") === true)) {
    throw new PdfDeFora("cifrado");
  }
  return {
    objetos,
    todos,
    textosDeDentro,
    descomprimidoRestante: restante,
    paginas: contarPaginas(todos),
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
    return { paginas: lerPdf(bytes).paginas };
  } catch (erro) {
    if (erro instanceof PdfDeFora) {
      return { erro: erro.motivo };
    }
    throw erro;
  }
}

/**
 * Limpa NO LUGAR a foto (JPEG) que esta em [de, ate) dentro do PDF, sem
 * mudar o tamanho: APP1 a APP15 e COM viram um COM zerado do mesmo tamanho
 * (o APP0 JFIF fica sem a miniatura e o APP14 Adobe fica), e o que vem
 * depois do primeiro EOI vira zero (menos o fim de linha antes de
 * "endstream"). null: limpo; senao, o motivo.
 */
function limparFotoNoLugar(saida: Uint8Array, de: number, ate: number): MotivoDeFora | null {
  const andado = andarPeloJpeg(saida, de, ate);
  if ("motivo" in andado) {
    return andado.motivo;
  }
  let comJfif = false;
  let comAdobe = false;
  for (const pedaco of andado.pedacos) {
    if (pedaco.tipo !== "segmento") {
      continue;
    }
    const { marcador, inicio, fim, antesDaVarredura } = pedaco;
    if (!ehApp(marcador) && marcador !== COM) {
      continue;
    }
    const corpo = inicio + 4;
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
  saida.fill(0, andado.fimDoEoi, fimDosDados);
  return null;
}

/**
 * O PDF com as fotos limpas (so os fluxos com /DCTDecode sozinho). Sem foto,
 * os mesmos bytes. /JPXDecode ou /DCTDecode numa cadeia: "formato".
 */
function semMetadadosDasFotos(bytes: Uint8Array, objetos: readonly ObjetoDoPdf[]): Uint8Array {
  let saida: Uint8Array | null = null;
  for (const objeto of objetos) {
    if (objeto.fluxo === null || objeto.dicionario === null) {
      continue;
    }
    const filtros = filtrosDoFluxo(objeto.dicionario);
    if (filtros.includes("JPXDecode")) {
      throw new PdfDeFora("formato");
    }
    if (!filtros.includes("DCTDecode")) {
      continue;
    }
    if (filtros.length !== 1) {
      throw new PdfDeFora("formato");
    }
    saida ??= bytes.slice();
    const motivo = limparFotoNoLugar(saida, objeto.fluxo.inicio, objeto.fluxo.fim);
    if (motivo !== null) {
      throw new PdfDeFora(motivo);
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

/**
 * O anexo no PDF: o nome no arquivo e dentro dos fluxos de objetos, ou a
 * chave /EF (o arquivo embutido de um /Filespec).
 */
function comAnexo(texto: string, lido: PdfLido): boolean {
  return (
    ANEXO.test(texto) ||
    lido.textosDeDentro.some((dentro) => ANEXO.test(dentro)) ||
    lido.todos.some((objeto) => objeto.dicionario?.has("EF") === true)
  );
}

/** As propriedades de GPS em qualquer XMP (do EXIF, do IPTC, do drone). */
const GPS_NO_XMP = /exif:GPS|GPS(?:Latitude|Longitude|Longtitude)/i;
/** A coordenada no formato do XMP (GPSCoordinate): "3,43.914S", "38,31,36W". */
const COORDENADA_DO_XMP =
  /(?:^|[^\d.,])\d{1,3},\d{1,2}(?:\.\d+)?(?:,\d{1,2}(?:\.\d+)?)?[NSEW](?![A-Za-z])/;
/** Uma propriedade photoshop: ou xmp: e o valor (atributo ou elemento). */
const PROPRIEDADE_PHOTOSHOP_OU_XMP =
  /(?:photoshop|xmp):[A-Za-z][\w.-]*\s*=\s*(?:"([^"]*)"|'([^']*)')|<(?:photoshop|xmp):[A-Za-z][\w.-]*[^>]*>([^<]*)</g;
/**
 * O valor com coordenada: o par em graus decimais ("-3.731900, -38.526700"),
 * os graus decimais com o hemisferio ("3.7319 S") ou graus, minutos e
 * segundos (3°43'54"S). O "°" do UTF-8 lido em latin1 vem depois de um "Â".
 */
const COORDENADA_NO_VALOR = new RegExp(
  [
    "[-+]?\\d{1,3}\\.\\d{4,}\\s*[,; ]\\s*[-+]?\\d{1,3}\\.\\d{4,}",
    "\\d{1,3}\\.\\d{3,}\\s*\\u00c2?\\u00b0?\\s*[NSEWLO](?![A-Za-z])",
    "\\d{1,3}\\s*\\u00c2?\\u00b0\\s*\\d{1,2}\\D{1,8}\\d{1,2}(?:\\.\\d+)?\\D{0,8}[NSEWLO](?![A-Za-z])",
  ].join("|"),
);

/**
 * O lugar escrito por extenso (uma cidade tambem e localizacao): a cidade,
 * o estado, o pais e o local do photoshop: e do IPTC Core, e os campos de
 * Iptc4xmpExt:LocationShown e LocationCreated (sublocal, cidade, estado,
 * pais, regiao, nome e identificador do local). O exif:GPSAreaInformation ja
 * conta pelo exif:GPS, com qualquer valor.
 */
const PROPRIEDADES_DE_LUGAR = [
  "photoshop:City",
  "photoshop:State",
  "photoshop:Country",
  "Iptc4xmpCore:Location",
  "Iptc4xmpCore:CountryCode",
  "Iptc4xmpExt:Sublocation",
  "Iptc4xmpExt:City",
  "Iptc4xmpExt:ProvinceState",
  "Iptc4xmpExt:CountryName",
  "Iptc4xmpExt:CountryCode",
  "Iptc4xmpExt:WorldRegion",
  "Iptc4xmpExt:LocationName",
  "Iptc4xmpExt:LocationId",
] as const;
const NOMES_DE_LUGAR = PROPRIEDADES_DE_LUGAR.join("|");
/** A propriedade de lugar como atributo (nome="valor"): o grupo e a aspa. */
const LUGAR_EM_ATRIBUTO = new RegExp(`(?:^|[\\s"'])(?:${NOMES_DE_LUGAR})\\s*=\\s*(["'])`, "g");
/** A propriedade de lugar como elemento (<nome ...>): o grupo e o nome. */
const LUGAR_EM_ELEMENTO = new RegExp(`<(${NOMES_DE_LUGAR})(?=[\\s/>])`, "g");
/** Quantas ocorrencias se olham (mais que isso: na duvida, e lugar). */
const OCORRENCIAS_DE_LUGAR = 256;
/** Ate onde se procura o fim do valor (mais longe: na duvida, e lugar). */
const JANELA_DO_LUGAR = 4096;

/**
 * Ha lugar escrito por extenso com valor? O valor vazio (ou so brancos) e a
 * chave sem valor (<photoshop:City/>) nao contam.
 */
function lugarNoXmp(texto: string): boolean {
  let ocorrencias = 0;
  for (const achado of texto.matchAll(LUGAR_EM_ATRIBUTO)) {
    ocorrencias += 1;
    if (ocorrencias > OCORRENCIAS_DE_LUGAR) {
      return true;
    }
    const inicio = (achado.index ?? 0) + achado[0].length;
    const janela = texto.slice(inicio, inicio + JANELA_DO_LUGAR);
    const fim = janela.indexOf(achado[1] ?? '"');
    if (fim < 0 || janela.slice(0, fim).trim() !== "") {
      return true;
    }
  }
  for (const achado of texto.matchAll(LUGAR_EM_ELEMENTO)) {
    ocorrencias += 1;
    if (ocorrencias > OCORRENCIAS_DE_LUGAR) {
      return true;
    }
    const janela = texto.slice(achado.index ?? 0, (achado.index ?? 0) + JANELA_DO_LUGAR);
    const fimDaTag = janela.indexOf(">");
    if (fimDaTag < 0) {
      return true;
    }
    if (janela.charCodeAt(fimDaTag - 1) === 0x2f) {
      continue; // <photoshop:City/>: a chave sem valor
    }
    const fechamento = janela.indexOf(`</${achado[1] ?? ""}`, fimDaTag);
    if (fechamento < 0) {
      return true;
    }
    // O texto de dentro, sem as tags (o LocationName vem num rdf:Alt).
    if (janela.slice(fimDaTag + 1, fechamento).replace(/<[^>]*>/g, "").trim() !== "") {
      return true;
    }
  }
  return false;
}

/** O XMP tem a localizacao? (Em UTF-16, os zeros saem e sobra o ASCII.) */
function localizacaoNoXmp(xmp: string): boolean {
  const texto = xmp.includes("\0") ? xmp.replace(/\0/g, "") : xmp;
  if (GPS_NO_XMP.test(texto) || COORDENADA_DO_XMP.test(texto) || lugarNoXmp(texto)) {
    return true;
  }
  for (const achado of texto.matchAll(PROPRIEDADE_PHOTOSHOP_OU_XMP)) {
    if (COORDENADA_NO_VALOR.test(achado[1] ?? achado[2] ?? achado[3] ?? "")) {
      return true;
    }
  }
  return false;
}

/**
 * A localizacao no PDF (ja sem a das fotos, que a limpeza zerou): as
 * propriedades de GPS e o lugar por extenso em qualquer lugar do arquivo sem
 * compressao, e o XMP de cada fluxo de metadados (/Type /Metadata, /Subtype
 * /XML ou o que um /Metadata aponta: do catalogo, da pagina, da foto),
 * descomprimido com o teto. O fluxo de metadados que nao da para ler:
 * "formato".
 */
function comLocalizacao(texto: string, saida: Uint8Array, lido: PdfLido): boolean {
  if (GPS_NO_XMP.test(texto) || lugarNoXmp(texto)) {
    return true;
  }
  const apontados = new Set<number>();
  for (const objeto of lido.todos) {
    for (const valor of objeto.dicionario?.get("Metadata") ?? []) {
      const referencia = SO_REFERENCIA.exec(valor);
      if (referencia !== null) {
        apontados.add(Number(referencia[1]));
      }
    }
  }
  let restante = lido.descomprimidoRestante;
  for (const objeto of lido.objetos) {
    const d = objeto.dicionario;
    if (objeto.fluxo === null || d === null) {
      continue;
    }
    if (
      !tiposDoDicionario(d).includes("Metadata") &&
      !nomesDaChave(d, "Subtype").includes("XML") &&
      !apontados.has(objeto.numero)
    ) {
      continue;
    }
    const filtros = filtrosDoFluxo(d);
    if (filtros.length > 1 || filtros.some((f) => f !== "FlateDecode") || comPreditor(d)) {
      throw new PdfDeFora("formato");
    }
    let dados: Uint8Array = saida.subarray(objeto.fluxo.inicio, objeto.fluxo.fim);
    if (filtros.length === 1) {
      if (restante <= 0) {
        throw new PdfDeFora("bomba");
      }
      dados = descomprimir(dados, restante);
    }
    restante -= dados.length;
    if (restante < 0) {
      throw new PdfDeFora("bomba");
    }
    if (localizacaoNoXmp(latin1(dados))) {
      return true;
    }
  }
  return false;
}

function prepararPdf(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.pdf.maximoDeBytes) {
    return fora("grande_demais");
  }
  try {
    const lido = lerPdf(bytes);
    if (lido.paginas > LIMITES_DA_MIDIA.pdf.maximoDePaginas) {
      return fora("paginas_demais");
    }
    const saida = semMetadadosDasFotos(bytes, lido.objetos);
    // Depois da limpeza das fotos: o Exif e o XMP de dentro delas ja sao zero.
    const texto = latin1(saida);
    if (comAnexo(texto, lido) || comLocalizacao(texto, saida, lido)) {
      return fora("formato");
    }
    return { tipo: "pdf", bytes: saida, paginas: lido.paginas };
  } catch (erro) {
    if (erro instanceof PdfDeFora) {
      return fora(erro.motivo);
    }
    throw erro;
  }
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
  formatos: FORMATOS_DA_MIDIA,
  jpeg: {
    quadros: [...SOF_ACEITOS],
    ficam: "SOF, DHT, DQT, DRI, APP0 JFIF sem miniatura e APP14 Adobe antes da varredura; DHT, DQT, DRI, DNL e SOS entre as varreduras; ate o primeiro EOI",
    orientacao: "APP1 minimo com a orientacao diferente de 1",
    segmentos: SEGMENTOS_DO_JPEG,
  },
  png: { ficam: [...PEDACOS_DO_PNG_QUE_FICAM], animado: [...PEDACOS_DO_PNG_ANIMADO] },
  webp: { ficam: [...PEDACOS_DO_WEBP_QUE_FICAM], saem: [...PEDACOS_DO_WEBP_QUE_SAEM] },
  mp3: { ficam: "so os quadros MPEG do mesmo fluxo", lixo: LIXO_ACEITO },
  pdf: {
    paginas: "a maior entre /Count, /Type /Page e /Kids, no texto e nos fluxos de objetos",
    fora: "/Encrypt; /JPXDecode; cadeia com /DCTDecode; metadado com outro filtro",
    foto: "/DCTDecode limpa no lugar (APP1 a APP15 e COM zerados, nada depois do EOI)",
    localizacao: {
      gps: GPS_NO_XMP.source,
      coordenadaDoXmp: COORDENADA_DO_XMP.source,
      photoshopOuXmp: COORDENADA_NO_VALOR.source,
      lugarComValor: [...PROPRIEDADES_DE_LUGAR],
    },
    anexo: { nomes: ANEXO.source, chave: "/EF" },
    residual: "imagem embutida no conteudo (BI ... EI) nao e limpa",
  },
} as const;
