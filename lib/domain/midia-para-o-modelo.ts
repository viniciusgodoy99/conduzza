// O arquivo do paciente pronto para o modelo (AG6b, desenho 4.4): o tipo
// pelos primeiros bytes, os limites, a remocao dos metadados e a medida da
// duracao e das paginas. PURO (sem rede, sem banco, sem biblioteca nova:
// so node:zlib, para o fluxo de objetos do PDF, e node:crypto, para a
// versao da figurinha). Roda so no servidor.
//
// Regras (D-59, D-92, D-98, D-101):
//  - o tipo vem dos PRIMEIROS BYTES e do media_mimetype da mensagem; os dois
//    tem de dizer o mesmo, senao o arquivo nao sai (nao suportado). HEIC,
//    GIF, video, DOCX, XLSX, ZIP e HTML nunca saem;
//  - AUDIO: so o MP3 (a uazapi gera MP3, generate_mp3). Sai sem as etiquetas
//    ID3v2 e ID3v1 (nome, artista, comentario e capa nunca saem). A duracao
//    e medida andando pelos quadros MPEG (taxa, frequencia e preenchimento
//    de cada cabecalho: vale para CBR e VBR). Fora de sincronia demais ou
//    sem quadros: nao suportado. De 1 a 120 s e ate 5 MB;
//  - IMAGEM: JPEG sem APP1 a APP13, APP15 e COM (ficam APP0 e APP14, de que
//    a decodificacao de cor depende), com um APP1 minimo so com a Orientacao
//    (tag 0x0112) quando a original tinha valor diferente de 1; PNG sem
//    tEXt, zTXt, iTXt, eXIf e tIME; WebP sem EXIF e XMP, com o tamanho do
//    RIFF e as marcas do VP8X corrigidos. O local e o aparelho nunca saem.
//    Ate 5 MB;
//  - FIGURINHA (D-98): WebP de exatamente 512 por 512 ou WebP animado. Nao
//    vai a modelo nenhum (a leitura e local);
//  - PDF: sem criptografia (/Encrypt); as paginas pelo /Count da raiz da
//    arvore de paginas (o dicionario /Type /Pages sem /Parent), procurado no
//    texto e dentro dos fluxos de objetos (/Type /ObjStm, descomprimidos com
//    node:zlib, com teto de 20 MB descomprimidos no total e de fluxos, contra
//    bomba de compressao). Sem achar: nao suportado. Ate 5 MB e 3 paginas.
//    Os metadados do PDF ficam (D-101: tirar exigiria biblioteca nova).
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
  /** Teto descomprimido dos fluxos de objetos do PDF (bomba de compressao). */
  pdfDescomprimidoNoTotal: 20 * MB,
  /** Teto de fluxos de objetos lidos num PDF. */
  pdfFluxosDeObjetos: 200,
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
// O tipo pelos primeiros bytes e pelo mimetype
// ---------------------------------------------------------------------------

function comecaCom(bytes: Uint8Array, assinatura: readonly number[], de = 0) {
  if (bytes.length < de + assinatura.length) {
    return false;
  }
  return assinatura.every((b, i) => bytes[de + i] === b);
}

function ascii(texto: string): number[] {
  return Array.from(texto, (c) => c.charCodeAt(0));
}

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
// Audio: MP3 sem ID3, duracao pelos quadros
// ---------------------------------------------------------------------------

/** O tamanho de uma etiqueta ID3v2 (syncsafe), com o cabecalho e o rodape. */
function tamanhoDoId3v2(bytes: Uint8Array, p: number): number | null {
  if (!comecaCom(bytes, ascii("ID3"), p) || bytes.length < p + 10) {
    return null;
  }
  const flags = bytes[p + 5] ?? 0;
  const partes = [6, 7, 8, 9].map((i) => bytes[p + i] ?? 0);
  if (partes.some((b) => b >= 0x80)) {
    return null;
  }
  const corpo =
    ((partes[0] ?? 0) << 21) |
    ((partes[1] ?? 0) << 14) |
    ((partes[2] ?? 0) << 7) |
    (partes[3] ?? 0);
  // Rodape (flag 0x10): mais 10 bytes.
  return 10 + corpo + ((flags & 0x10) !== 0 ? 10 : 0);
}

/** Os bytes do MP3 sem as etiquetas ID3v2 (no comeco) e ID3v1 (no fim). */
export function semEtiquetasId3(bytes: Uint8Array): Uint8Array {
  let inicio = 0;
  for (let i = 0; i < 4; i += 1) {
    const tamanho = tamanhoDoId3v2(bytes, inicio);
    if (tamanho === null) {
      break;
    }
    inicio = Math.min(bytes.length, inicio + tamanho);
  }
  let fim = bytes.length;
  if (fim - inicio >= 128 && comecaCom(bytes, ascii("TAG"), fim - 128)) {
    fim -= 128;
  }
  return bytes.slice(inicio, fim);
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

type QuadroMpeg = { tamanho: number; amostras: number; frequencia: number };

/** O quadro MPEG que comeca em p (cabecalho de 4 bytes), ou null. */
function quadroMpeg(bytes: Uint8Array, p: number): QuadroMpeg | null {
  if (p + 4 > bytes.length) {
    return null;
  }
  const b0 = bytes[p] ?? 0;
  const b1 = bytes[p + 1] ?? 0;
  const b2 = bytes[p + 2] ?? 0;
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
  return tamanho >= 4 ? { tamanho, amostras, frequencia } : null;
}

/**
 * Quanto lixo (bytes fora de quadro) o MP3 pode ter antes de ser "fora de
 * sincronia demais": 10% do arquivo, com um piso de 4 KB (um cabecalho
 * VBR e alguns bytes soltos no fim sao normais).
 */
const LIXO_ACEITO = { fracao: 0.1, piso: 4096 } as const;

/**
 * A duracao do MP3 (sem ID3), andando pelos quadros. null quando nao ha
 * quadro nenhum ou o lixo passa do aceito.
 */
export function duracaoDoMp3(bytes: Uint8Array): {
  segundos: number;
  quadros: number;
} | null {
  let p = 0;
  let quadros = 0;
  let segundos = 0;
  let lixo = 0;
  while (p + 4 <= bytes.length) {
    const quadro = quadroMpeg(bytes, p);
    if (quadro === null || p + quadro.tamanho > bytes.length) {
      // Sem sincronia aqui (ou o ultimo quadro cortado): anda um byte.
      p += 1;
      lixo += 1;
      continue;
    }
    quadros += 1;
    segundos += quadro.amostras / quadro.frequencia;
    p += quadro.tamanho;
  }
  lixo += bytes.length - p;
  if (quadros === 0) {
    return null;
  }
  if (lixo > Math.max(LIXO_ACEITO.piso, bytes.length * LIXO_ACEITO.fracao)) {
    return null;
  }
  return { segundos, quadros };
}

function prepararAudio(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.audio.maximoDeBytes) {
    return fora("grande_demais");
  }
  const limpos = semEtiquetasId3(bytes);
  if (limpos.length === 0 || !cabecalhoMpegValidoNoComeco(limpos)) {
    return fora("sem_quadros");
  }
  const medida = duracaoDoMp3(limpos);
  if (medida === null) {
    return fora("fora_de_sincronia");
  }
  if (medida.segundos < LIMITES_DA_MIDIA.audio.minimoDeSegundos) {
    return fora("curto_demais");
  }
  if (medida.segundos > LIMITES_DA_MIDIA.audio.maximoDeSegundos) {
    return fora("longo_demais");
  }
  return { tipo: "audio", bytes: limpos, segundos: medida.segundos };
}

/** Depois do ID3, o primeiro quadro tem de estar logo no comeco (ou perto). */
function cabecalhoMpegValidoNoComeco(bytes: Uint8Array): boolean {
  const limite = Math.min(bytes.length - 4, LIXO_ACEITO.piso);
  for (let p = 0; p <= limite; p += 1) {
    if (cabecalhoMpegValido(bytes, p)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Imagem: JPEG
// ---------------------------------------------------------------------------

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

/** Os marcadores JPEG sem campo de tamanho (SOI, EOI, RSTn, TEM). */
function marcadorSemTamanho(marcador: number): boolean {
  return (
    marcador === 0xd8 ||
    marcador === 0xd9 ||
    marcador === 0x01 ||
    (marcador >= 0xd0 && marcador <= 0xd7)
  );
}

/** Os segmentos que saem: APP1 a APP13, APP15 e COM. */
function segmentoQueSai(marcador: number): boolean {
  return (
    (marcador >= 0xe1 && marcador <= 0xed) ||
    marcador === 0xef ||
    marcador === 0xfe
  );
}

function prepararJpeg(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const partes: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  let orientacao: number | null = null;
  let posicaoDoApp1 = 1; // depois do SOI (e do APP0, se houver)
  let p = 2;
  for (;;) {
    if (p >= bytes.length) {
      return fora("corrompido");
    }
    if (bytes[p] !== 0xff) {
      return fora("corrompido");
    }
    // Bytes de preenchimento 0xFF antes do marcador.
    let q = p;
    while (q < bytes.length && bytes[q] === 0xff) {
      q += 1;
    }
    if (q >= bytes.length) {
      return fora("corrompido");
    }
    const marcador = bytes[q] ?? 0;
    if (marcador === 0xd9) {
      // EOI sem SOS: imagem sem dados.
      return fora("corrompido");
    }
    if (marcadorSemTamanho(marcador)) {
      partes.push(bytes.slice(p, q + 1));
      p = q + 1;
      continue;
    }
    if (q + 3 > bytes.length) {
      return fora("corrompido");
    }
    const tamanho = ((bytes[q + 1] ?? 0) << 8) | (bytes[q + 2] ?? 0);
    const fim = q + 1 + tamanho;
    if (tamanho < 2 || fim > bytes.length) {
      return fora("corrompido");
    }
    if (marcador === 0xda) {
      // SOS: daqui ate o fim e o dado da imagem, copiado como esta.
      partes.push(bytes.slice(p));
      break;
    }
    if (marcador === 0xe1 && orientacao === null) {
      orientacao = orientacaoDoExif(bytes.slice(q + 3, fim));
    }
    if (!segmentoQueSai(marcador)) {
      partes.push(bytes.slice(p, fim));
      if (marcador === 0xe0 && partes.length === 2) {
        // O APP0 (JFIF) logo depois do SOI: o APP1 novo vem depois dele.
        posicaoDoApp1 = 2;
      }
    }
    p = fim;
  }
  if (orientacao !== null && orientacao !== 1) {
    partes.splice(posicaoDoApp1, 0, app1SoComAOrientacao(orientacao));
  }
  return { tipo: "imagem", formato: "jpeg", bytes: juntar(partes) };
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
// Imagem: PNG
// ---------------------------------------------------------------------------

/** Os pedacos do PNG que saem (texto, EXIF e a data). */
const PEDACOS_DO_PNG_QUE_SAEM: ReadonlySet<string> = new Set([
  "tEXt",
  "zTXt",
  "iTXt",
  "eXIf",
  "tIME",
]);

function prepararPng(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.imagem.maximoDeBytes) {
    return fora("grande_demais");
  }
  const partes: Uint8Array[] = [bytes.slice(0, 8)];
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
    const tipo = String.fromCharCode(...bytes.slice(p + 4, p + 8));
    const fim = p + 12 + tamanho;
    if (fim > bytes.length || !/^[A-Za-z]{4}$/.test(tipo)) {
      return fora("corrompido");
    }
    if (!PEDACOS_DO_PNG_QUE_SAEM.has(tipo)) {
      partes.push(bytes.slice(p, fim));
    }
    p = fim;
    if (tipo === "IEND") {
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

/** As marcas do VP8X: EXIF (0x08), XMP (0x04) e animacao (0x02). */
const MARCA_EXIF = 0x08;
const MARCA_XMP = 0x04;
const MARCA_ANIMACAO = 0x02;

type PedacoDoWebp = { tipo: string; inicio: number; fim: number; dados: number };

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

function pedacosDoWebp(bytes: Uint8Array): PedacoDoWebp[] | null {
  const pedacos: PedacoDoWebp[] = [];
  let p = 12;
  while (p < bytes.length) {
    if (p + 8 > bytes.length) {
      return null;
    }
    const tipo = String.fromCharCode(...bytes.slice(p, p + 4));
    const tamanho = u32le(bytes, p + 4);
    const fimDosDados = p + 8 + tamanho;
    // O pedaco de tamanho impar tem um byte de preenchimento.
    const fim = fimDosDados + (tamanho % 2);
    if (fimDosDados > bytes.length) {
      return null;
    }
    pedacos.push({ tipo, inicio: p, fim: Math.min(fim, bytes.length), dados: p + 8 });
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
  for (const pedaco of pedacos) {
    if (pedaco.tipo === "EXIF" || pedaco.tipo === "XMP ") {
      continue;
    }
    const copia = bytes.slice(pedaco.inicio, pedaco.fim);
    if (pedaco.tipo === "VP8X") {
      copia[8] = (copia[8] ?? 0) & ~(MARCA_EXIF | MARCA_XMP) & 0xff;
    }
    partes.push(copia);
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
// PDF: sem criptografia, as paginas pelo /Count da raiz
// ---------------------------------------------------------------------------

const MENOR = "<".charCodeAt(0);
const MAIOR = ">".charCodeAt(0);

/** Os dicionarios do nivel mais de fora ("<< ... >>"), na ordem. */
function dicionariosDeFora(texto: string): string[] {
  const achados: string[] = [];
  let profundidade = 0;
  let inicio = -1;
  for (let i = 0; i < texto.length - 1; i += 1) {
    const c = texto.charCodeAt(i);
    if (c === MENOR && texto.charCodeAt(i + 1) === MENOR) {
      if (profundidade === 0) {
        inicio = i;
      }
      profundidade += 1;
      i += 1;
    } else if (
      c === MAIOR &&
      texto.charCodeAt(i + 1) === MAIOR &&
      profundidade > 0
    ) {
      profundidade -= 1;
      i += 1;
      if (profundidade === 0 && inicio >= 0) {
        achados.push(texto.slice(inicio, i + 1));
        inicio = -1;
      }
    }
  }
  return achados;
}

const TIPO_PAGES = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const PARENT = /\/Parent(?![A-Za-z0-9])/;
const COUNT = /\/Count\s+(\d{1,6})(?![0-9])/;
const OBJSTM = /\/Type\s*\/ObjStm(?![A-Za-z0-9])/;
const ENCRYPT = /\/Encrypt(?![A-Za-z0-9])/;

type FluxoDoPdf = { dicionario: string; comeco: number; fim: number };

/**
 * Os fluxos do PDF (o dicionario e onde estao os bytes), na ordem. O
 * dicionario de cada fluxo e o ultimo "<< ... >>" antes de "stream".
 */
function fluxosDoPdf(texto: string): FluxoDoPdf[] {
  const fluxos: FluxoDoPdf[] = [];
  const marca = /stream\r?\n/g;
  let achado: RegExpExecArray | null;
  while ((achado = marca.exec(texto)) !== null) {
    // "endstream" tambem casa com "stream\n": o que vem antes e "end".
    if (texto.slice(Math.max(0, achado.index - 3), achado.index) === "end") {
      continue;
    }
    const comeco = achado.index + achado[0].length;
    const antes = texto.slice(Math.max(0, achado.index - 4096), achado.index);
    const dicionarios = dicionariosDeFora(antes);
    const fim = texto.indexOf("endstream", comeco);
    if (fim < 0) {
      break;
    }
    fluxos.push({
      dicionario: dicionarios[dicionarios.length - 1] ?? "",
      comeco,
      fim,
    });
    marca.lastIndex = fim + "endstream".length;
  }
  return fluxos;
}

/** O texto do PDF sem os bytes de dentro dos fluxos (so os dicionarios). */
function textoSemFluxos(texto: string, fluxos: readonly FluxoDoPdf[]): string {
  const partes: string[] = [];
  let p = 0;
  for (const fluxo of fluxos) {
    partes.push(texto.slice(p, fluxo.comeco));
    p = fluxo.fim;
  }
  partes.push(texto.slice(p));
  return partes.join(" ");
}

/**
 * As paginas do PDF pelo /Count da raiz da arvore (o dicionario /Type
 * /Pages sem /Parent), no texto e nos fluxos de objetos. Com mais de uma
 * raiz (atualizacao incremental), a maior contagem (o lado seguro).
 * "sem_paginas": nao achou. "bomba": o descomprimido passou do teto.
 */
export function paginasDoPdf(
  bytes: Uint8Array,
): { paginas: number } | { erro: "sem_paginas" | "bomba" } {
  const bruto = Buffer.from(bytes).toString("latin1");
  const todos = fluxosDoPdf(bruto);
  const textos: string[] = [textoSemFluxos(bruto, todos)];
  const fluxos = todos
    .filter((fluxo) => OBJSTM.test(fluxo.dicionario))
    .map((fluxo) => ({
      dicionario: fluxo.dicionario,
      dados: bytes.slice(fluxo.comeco, fluxo.fim),
    }));
  if (fluxos.length > LIMITES_DA_MIDIA.pdfFluxosDeObjetos) {
    return { erro: "bomba" };
  }
  let restante: number = LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal;
  for (const fluxo of fluxos) {
    let dados: Uint8Array = fluxo.dados;
    if (/\/Filter\s*\/FlateDecode(?![A-Za-z0-9])/.test(fluxo.dicionario)) {
      if (restante <= 0) {
        return { erro: "bomba" };
      }
      try {
        dados = inflateSync(dados, { maxOutputLength: restante });
      } catch (erro) {
        if (
          erro instanceof RangeError ||
          (erro as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
        ) {
          return { erro: "bomba" };
        }
        // Fluxo que nao descomprime: ignorado (a raiz pode estar no texto).
        continue;
      }
    } else if (/\/Filter(?![A-Za-z0-9])/.test(fluxo.dicionario)) {
      // Outro filtro (nao suportado): ignorado.
      continue;
    }
    restante -= dados.length;
    if (restante < 0) {
      return { erro: "bomba" };
    }
    textos.push(Buffer.from(dados).toString("latin1"));
  }
  let maior: number | null = null;
  for (const parte of textos) {
    for (const dicionario of dicionariosDeFora(parte)) {
      if (!TIPO_PAGES.test(dicionario) || PARENT.test(dicionario)) {
        continue;
      }
      const contagem = COUNT.exec(dicionario);
      if (contagem?.[1] !== undefined) {
        const n = Number(contagem[1]);
        maior = maior === null ? n : Math.max(maior, n);
      }
    }
  }
  return maior === null || maior < 1 ? { erro: "sem_paginas" } : { paginas: maior };
}

function prepararPdf(bytes: Uint8Array): MidiaPreparada {
  if (bytes.length > LIMITES_DA_MIDIA.pdf.maximoDeBytes) {
    return fora("grande_demais");
  }
  const bruto = Buffer.from(bytes).toString("latin1");
  // /Encrypt mora no trailer ou no dicionario do fluxo de referencias: os
  // dois ficam fora dos bytes dos fluxos.
  if (ENCRYPT.test(textoSemFluxos(bruto, fluxosDoPdf(bruto)))) {
    return fora("cifrado");
  }
  const contagem = paginasDoPdf(bytes);
  if ("erro" in contagem) {
    return fora(contagem.erro);
  }
  if (contagem.paginas > LIMITES_DA_MIDIA.pdf.maximoDePaginas) {
    return fora("paginas_demais");
  }
  return { tipo: "pdf", bytes, paginas: contagem.paginas };
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

/** O preparo inteiro (limites, metadados, paginas), para as versoes. */
export const FONTES_DO_PREPARO = {
  limites: LIMITES_DA_MIDIA,
  formatos: FORMATOS_DA_MIDIA,
  jpeg: "sem APP1 a APP13, APP15 e COM; APP1 minimo com a orientacao diferente de 1",
  png: [...PEDACOS_DO_PNG_QUE_SAEM],
  webp: "sem EXIF e XMP, RIFF e VP8X corrigidos",
  mp3: { semId3: "v2 e v1", lixo: LIXO_ACEITO },
  pdf: "sem /Encrypt; /Count da raiz /Type /Pages sem /Parent, no texto e nos /ObjStm",
} as const;
