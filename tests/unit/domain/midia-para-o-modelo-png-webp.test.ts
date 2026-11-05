import { describe, expect, it } from "vitest";

import { prepararMidia } from "@/lib/domain/midia-para-o-modelo";

// O PNG e o WebP limpos por LISTA DO QUE FICA (revisao da 6eae43d, BAIXO 2):
// o C2PA, os pedacos privados, o EXIF, o perfil ICC e o que vem depois do
// fim nunca saem; o pedaco que nao da para ignorar deixa o arquivo de fora.
// Fixtures SINTETICAS montadas aqui, nenhum arquivo de paciente.

const texto = (t: string) => Uint8Array.from(Buffer.from(t, "latin1"));
const bytes = (...b: number[]) => Uint8Array.from(b);
const juntar = (...partes: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(partes.map((p) => Buffer.from(p))));
const u32be = (n: number) =>
  bytes((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const u32le = (n: number) =>
  bytes(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
const u24le = (n: number) => bytes(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff);

function contem(saida: Uint8Array, trecho: string): boolean {
  return Buffer.from(saida).includes(Buffer.from(trecho, "latin1"));
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const ASSINATURA_PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function pedacoPng(tipo: string, dados: Uint8Array): Uint8Array {
  return juntar(u32be(dados.length), texto(tipo), dados, new Uint8Array(4));
}

/** Os tipos dos pedacos do PNG, na ordem (conferindo que fecha no IEND). */
function pedacosDoPng(b: Uint8Array): string[] {
  expect(Array.from(b.subarray(0, 8))).toEqual(Array.from(ASSINATURA_PNG));
  const tipos: string[] = [];
  let p = 8;
  while (p < b.length) {
    const tamanho = Buffer.from(b.subarray(p, p + 4)).readUInt32BE(0);
    tipos.push(Buffer.from(b.subarray(p + 4, p + 8)).toString("latin1"));
    p += 12 + tamanho;
  }
  expect(p).toBe(b.length);
  expect(tipos[tipos.length - 1]).toBe("IEND");
  return tipos;
}

function prepararPng(arquivo: Uint8Array) {
  return prepararMidia({ midia: "documento", bytes: arquivo, mimetype: "image/png" });
}

describe("o PNG: so a imagem e a exibicao", () => {
  it("C2PA (caBX), pedaco privado, EXIF, ICC, texto, data e o que vem depois do IEND nunca saem", () => {
    const png = juntar(
      ASSINATURA_PNG,
      pedacoPng("IHDR", new Uint8Array(13)),
      pedacoPng("iCCP", texto("Perfil do aparelho\0\0xx")),
      pedacoPng("sRGB", bytes(0)),
      pedacoPng("gAMA", u32be(45455)),
      pedacoPng("pHYs", new Uint8Array(9)),
      pedacoPng("caBX", texto("manifesto C2PA com o aparelho e o local")),
      pedacoPng("prVt", texto("pedaco privado com o nome Fulano")),
      pedacoPng("eXIf", texto("MM\0*GPS-LATITUDE")),
      pedacoPng("tEXt", texto("Author\0Fulano")),
      pedacoPng("tIME", new Uint8Array(7)),
      pedacoPng("IDAT", new Uint8Array(20)),
      pedacoPng("IEND", new Uint8Array(0)),
      texto("depois do IEND: GPS-LATITUDE e Fulano"),
    );
    const preparado = prepararPng(png);
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    for (const segredo of ["caBX", "prVt", "eXIf", "iCCP", "tEXt", "tIME", "aparelho", "Fulano", "GPS"]) {
      expect(contem(preparado.bytes, segredo), segredo).toBe(false);
    }
    expect(pedacosDoPng(preparado.bytes)).toEqual(["IHDR", "sRGB", "gAMA", "pHYs", "IDAT", "IEND"]);
  });

  it("PNG animado (APNG): formato", () => {
    const apng = juntar(
      ASSINATURA_PNG,
      pedacoPng("IHDR", new Uint8Array(13)),
      pedacoPng("acTL", new Uint8Array(8)),
      pedacoPng("IDAT", new Uint8Array(20)),
      pedacoPng("IEND", new Uint8Array(0)),
    );
    expect(prepararPng(apng)).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("pedaco critico desconhecido (o decodificador nao pode ignorar): formato", () => {
    const png = juntar(
      ASSINATURA_PNG,
      pedacoPng("IHDR", new Uint8Array(13)),
      pedacoPng("ZZZZ", texto("o que for")),
      pedacoPng("IDAT", new Uint8Array(20)),
      pedacoPng("IEND", new Uint8Array(0)),
    );
    expect(prepararPng(png)).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("o primeiro pedaco que nao e IHDR: corrompido", () => {
    const png = juntar(
      ASSINATURA_PNG,
      pedacoPng("tEXt", texto("Author\0Fulano")),
      pedacoPng("IHDR", new Uint8Array(13)),
      pedacoPng("IDAT", new Uint8Array(20)),
      pedacoPng("IEND", new Uint8Array(0)),
    );
    expect(prepararPng(png)).toEqual({ tipo: "fora", motivo: "corrompido" });
  });
});

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

function pedacoWebp(tipo: string, dados: Uint8Array): Uint8Array {
  const preenchido = dados.length % 2 === 1 ? juntar(dados, new Uint8Array(1)) : dados;
  return juntar(texto(tipo), u32le(dados.length), preenchido);
}

function vp8(largura: number, altura: number): Uint8Array {
  return pedacoWebp(
    "VP8 ",
    bytes(
      0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a,
      largura & 0xff, (largura >> 8) & 0x3f,
      altura & 0xff, (altura >> 8) & 0x3f,
      0, 0, 0, 0,
    ),
  );
}

function vp8x(marcas: number, largura: number, altura: number): Uint8Array {
  return pedacoWebp("VP8X", juntar(bytes(marcas, 0, 0, 0), u24le(largura - 1), u24le(altura - 1)));
}

function webp(...pedacos: Uint8Array[]): Uint8Array {
  const corpo = juntar(texto("WEBP"), ...pedacos);
  return juntar(texto("RIFF"), u32le(corpo.length), corpo);
}

/** Os tipos dos pedacos do WebP, na ordem (conferindo o tamanho do RIFF). */
function pedacosDoWebp(b: Uint8Array): string[] {
  const buffer = Buffer.from(b);
  expect(buffer.readUInt32LE(4)).toBe(b.length - 8);
  const tipos: string[] = [];
  let p = 12;
  while (p < b.length) {
    tipos.push(buffer.subarray(p, p + 4).toString("latin1"));
    const tamanho = buffer.readUInt32LE(p + 4);
    p += 8 + tamanho + (tamanho % 2);
  }
  expect(p).toBe(b.length);
  return tipos;
}

function prepararWebp(arquivo: Uint8Array) {
  return prepararMidia({ midia: "imagem", bytes: arquivo, mimetype: "image/webp" });
}

describe("o WebP: so VP8X, ALPH e a imagem", () => {
  it("ICCP, EXIF e XMP saem, com as marcas deles; o alfa fica", () => {
    const original = webp(
      vp8x(0x20 | 0x10 | 0x08 | 0x04, 300, 200),
      pedacoWebp("ICCP", texto("perfil do aparelho")),
      pedacoWebp("ALPH", bytes(0, 1, 2, 3)),
      vp8(300, 200),
      pedacoWebp("EXIF", texto("GPS LATITUDE APARELHO")),
      pedacoWebp("XMP ", texto("<x:xmpmeta>Fulano</x:xmpmeta>")),
    );
    const preparado = prepararWebp(original);
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    for (const segredo of ["aparelho", "LATITUDE", "Fulano", "ICCP", "EXIF", "XMP "]) {
      expect(contem(preparado.bytes, segredo), segredo).toBe(false);
    }
    expect(pedacosDoWebp(preparado.bytes)).toEqual(["VP8X", "ALPH", "VP8 "]);
    // So a marca de alfa (0x10) fica no VP8X.
    expect(preparado.bytes[20]).toBe(0x10);
  });

  it("nada depois do fim do RIFF sai", () => {
    const original = juntar(webp(vp8(300, 200)), texto("EXIF depois do RIFF: GPS e Fulano"));
    const preparado = prepararWebp(original);
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo === "imagem") {
      expect(contem(preparado.bytes, "Fulano")).toBe(false);
      expect(pedacosDoWebp(preparado.bytes)).toEqual(["VP8 "]);
    }
  });

  it("um pedaco desconhecido (C2PA, privado): formato", () => {
    expect(
      prepararWebp(webp(vp8x(0, 300, 200), vp8(300, 200), pedacoWebp("C2PA", texto("manifesto")))),
    ).toEqual({ tipo: "fora", motivo: "formato" });
    expect(prepararWebp(webp(vp8(300, 200), pedacoWebp("PRIV", texto("Fulano"))))).toEqual({
      tipo: "fora",
      motivo: "formato",
    });
  });

  it("duas imagens, ou o VP8X fora do comeco: corrompido", () => {
    expect(prepararWebp(webp(vp8(300, 200), vp8(300, 200)))).toEqual({
      tipo: "fora",
      motivo: "corrompido",
    });
    expect(prepararWebp(webp(vp8(300, 200), vp8x(0, 300, 200)))).toEqual({
      tipo: "fora",
      motivo: "corrompido",
    });
  });

  it("o RIFF maior que o arquivo: corrompido", () => {
    const cortado = webp(vp8(300, 200)).slice(0, 20);
    expect(prepararWebp(cortado)).toEqual({ tipo: "fora", motivo: "corrompido" });
  });

  it("a figurinha continua figurinha (D-98), mesmo com pedacos estranhos", () => {
    expect(
      prepararWebp(webp(vp8x(0x02, 320, 240), pedacoWebp("ANIM", new Uint8Array(6)), pedacoWebp("PRIV", bytes(1)))),
    ).toEqual({ tipo: "figurinha" });
  });
});

describe("BAIXO 4: o WebP num Buffer nao muda (as marcas do VP8X saem so na copia)", () => {
  it("a entrada fica igual; a saida sai sem as marcas de ICC, EXIF e XMP", () => {
    const original = webp(
      vp8x(0x20 | 0x10 | 0x08 | 0x04, 300, 200),
      vp8(300, 200),
      pedacoWebp("EXIF", texto("GPS LATITUDE")),
    );
    const entrada = Buffer.from(original);
    const copia = Buffer.from(entrada);
    const preparado = prepararMidia({ midia: "imagem", bytes: entrada, mimetype: "image/webp" });
    expect(preparado.tipo).toBe("imagem");
    expect(entrada.equals(copia)).toBe(true);
    if (preparado.tipo === "imagem") {
      expect(preparado.bytes[20]).toBe(0x10);
      expect(contem(preparado.bytes, "LATITUDE")).toBe(false);
    }
  });
});
