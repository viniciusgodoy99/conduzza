import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  app1SoComAOrientacao,
  duracaoDoMp3,
  formatoPelosPrimeirosBytes,
  formatoPeloMimetype,
  LIMITES_DA_MIDIA,
  mimetypeAceito,
  orientacaoDoExif,
  paginasDoPdf,
  prepararMidia,
  semEtiquetasId3,
  VERSAO_DA_FIGURINHA,
} from "@/lib/domain/midia-para-o-modelo";

// O arquivo do paciente pronto para o modelo (AG6b, desenho 4.4), com
// fixtures binarias SINTETICAS montadas aqui (nenhum arquivo de paciente):
// quadros MPEG com a carga zerada, ID3, JPEG com APP1 de GPS, PNG com tEXt,
// WebP com EXIF, WebP 512 por 512 e animado, PDF com e sem fluxo de
// objetos, cifrado e a bomba de compressao.

const texto = (t: string) => Uint8Array.from(Buffer.from(t, "latin1"));
const juntar = (...partes: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(partes.map((p) => Buffer.from(p))));
const u32be = (n: number) =>
  Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const u32le = (n: number) =>
  Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const u24le = (n: number) =>
  Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff]);

// ---------------------------------------------------------------------------
// MP3
// ---------------------------------------------------------------------------

/** Um quadro MPEG-1 Layer III, 128 kbps, 44,1 kHz, sem preenchimento. */
const TAMANHO_DO_QUADRO = Math.floor((144 * 128_000) / 44_100); // 417
const SEGUNDOS_DO_QUADRO = 1152 / 44_100;

function quadro(): Uint8Array {
  const q = new Uint8Array(TAMANHO_DO_QUADRO);
  q.set([0xff, 0xfb, 0x90, 0x44]);
  return q;
}

function mp3(segundos: number): Uint8Array {
  const quadros = Math.ceil(segundos / SEGUNDOS_DO_QUADRO);
  return juntar(...Array.from({ length: quadros }, quadro));
}

function id3v2(conteudo: string): Uint8Array {
  const corpo = texto(conteudo);
  const n = corpo.length;
  return juntar(
    texto("ID3"),
    Uint8Array.from([3, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]),
    corpo,
  );
}

function id3v1(): Uint8Array {
  const t = new Uint8Array(128);
  t.set(texto("TAGNome da Pessoa"));
  return t;
}

describe("o tipo pelos primeiros bytes e pelo mimetype", () => {
  it("reconhece MP3, JPEG, PNG, WebP e PDF; recusa HEIC, GIF, video, ZIP e HTML", () => {
    expect(formatoPelosPrimeirosBytes(mp3(2))).toBe("mp3");
    expect(formatoPelosPrimeirosBytes(juntar(id3v2("x"), mp3(2)))).toBe("mp3");
    expect(formatoPelosPrimeirosBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(
      formatoPelosPrimeirosBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("png");
    expect(formatoPelosPrimeirosBytes(juntar(texto("RIFF"), u32le(4), texto("WEBP")))).toBe("webp");
    expect(formatoPelosPrimeirosBytes(texto("%PDF-1.7\n"))).toBe("pdf");
    expect(formatoPelosPrimeirosBytes(juntar(u32be(24), texto("ftypheic")))).toBeNull();
    expect(formatoPelosPrimeirosBytes(texto("GIF89a"))).toBeNull();
    expect(formatoPelosPrimeirosBytes(juntar(u32be(24), texto("ftypmp42")))).toBeNull();
    expect(formatoPelosPrimeirosBytes(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(formatoPelosPrimeirosBytes(texto("<!doctype html><html>"))).toBeNull();
  });

  it("o mimetype aceito por midia (o documento pode ser foto)", () => {
    expect(formatoPeloMimetype("audio/mpeg")).toBe("mp3");
    expect(formatoPeloMimetype("image/jpeg; charset=binary")).toBe("jpeg");
    expect(formatoPeloMimetype("audio/ogg; codecs=opus")).toBeNull();
    expect(formatoPeloMimetype("image/heic")).toBeNull();
    expect(mimetypeAceito("audio", "audio/mpeg")).toBe(true);
    expect(mimetypeAceito("audio", "image/jpeg")).toBe(false);
    expect(mimetypeAceito("imagem", "application/pdf")).toBe(false);
    expect(mimetypeAceito("documento", "application/pdf")).toBe(true);
    expect(mimetypeAceito("documento", "image/png")).toBe(true);
    expect(
      mimetypeAceito(
        "documento",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
    expect(mimetypeAceito("imagem", null)).toBe(false);
  });

  it("o tipo que nao bate com os primeiros bytes nao sai", () => {
    expect(
      prepararMidia({ midia: "imagem", bytes: mp3(3), mimetype: "image/jpeg" }),
    ).toEqual({ tipo: "fora", motivo: "tipo_divergente" });
    expect(
      prepararMidia({ midia: "documento", bytes: texto("<html>"), mimetype: "application/pdf" }),
    ).toEqual({ tipo: "fora", motivo: "formato" });
    expect(
      prepararMidia({ midia: "audio", bytes: new Uint8Array(0), mimetype: "audio/mpeg" }),
    ).toEqual({ tipo: "fora", motivo: "vazio" });
  });
});

describe("o audio: MP3 sem ID3, a duracao pelos quadros, os limites", () => {
  it("mede a duracao andando pelos quadros", () => {
    const medida = duracaoDoMp3(mp3(15));
    expect(medida).not.toBeNull();
    expect(medida!.segundos).toBeGreaterThanOrEqual(15);
    expect(medida!.segundos).toBeLessThan(15 + SEGUNDOS_DO_QUADRO);
  });

  it("tira o ID3v2 do comeco e o ID3v1 do fim (o nome nunca sai)", () => {
    const comEtiquetas = juntar(id3v2("TIT2 Nome da Pessoa"), mp3(3), id3v1());
    const limpo = semEtiquetasId3(comEtiquetas);
    expect(Buffer.from(limpo).includes(Buffer.from("Nome da Pessoa"))).toBe(false);
    expect(limpo[0]).toBe(0xff);
    const preparado = prepararMidia({
      midia: "audio",
      bytes: comEtiquetas,
      mimetype: "audio/mpeg",
    });
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo === "audio") {
      expect(Buffer.from(preparado.bytes).includes(Buffer.from("Nome da Pessoa"))).toBe(false);
      expect(Buffer.from(preparado.bytes).includes(Buffer.from("ID3"))).toBe(false);
      expect(preparado.segundos).toBeGreaterThanOrEqual(3);
    }
  });

  it("de 1 a 120 s: menos de 1 s e mais de 120 s nao saem", () => {
    expect(
      prepararMidia({ midia: "audio", bytes: mp3(0.5), mimetype: "audio/mpeg" }),
    ).toEqual({ tipo: "fora", motivo: "curto_demais" });
    expect(
      prepararMidia({ midia: "audio", bytes: mp3(121), mimetype: "audio/mpeg" }),
    ).toEqual({ tipo: "fora", motivo: "longo_demais" });
    expect(
      prepararMidia({ midia: "audio", bytes: mp3(119), mimetype: "audio/mpeg" }).tipo,
    ).toBe("audio");
  });

  it("acima de 5 MB nao sai, sem ler o resto", () => {
    const grande = new Uint8Array(LIMITES_DA_MIDIA.audio.maximoDeBytes + 1);
    grande.set([0xff, 0xfb, 0x90, 0x44]);
    expect(
      prepararMidia({ midia: "audio", bytes: grande, mimetype: "audio/mpeg" }),
    ).toEqual({ tipo: "fora", motivo: "grande_demais" });
  });

  it("fora de sincronia demais ou sem quadros nao sai", () => {
    const lixo = juntar(mp3(1.2), new Uint8Array(40_000).fill(0x11));
    expect(
      prepararMidia({ midia: "audio", bytes: lixo, mimetype: "audio/mpeg" }),
    ).toEqual({ tipo: "fora", motivo: "fora_de_sincronia" });
    const soId3 = juntar(id3v2("TIT2 algo"), new Uint8Array(100));
    expect(
      prepararMidia({ midia: "audio", bytes: soId3, mimetype: "audio/mpeg" }),
    ).toEqual({ tipo: "fora", motivo: "sem_quadros" });
  });
});

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function segmento(marcador: number, corpo: Uint8Array): Uint8Array {
  const n = corpo.length + 2;
  return juntar(Uint8Array.from([0xff, marcador, (n >> 8) & 0xff, n & 0xff]), corpo);
}

/** Um APP1 Exif com a orientacao e um ponteiro de GPS (LATITUDE no corpo). */
function app1ComGps(orientacao: number): Uint8Array {
  const tiff = juntar(
    texto("II"),
    Uint8Array.from([0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    // IFD0 com duas entradas: Orientacao e o ponteiro do GPS.
    Uint8Array.from([0x02, 0x00]),
    Uint8Array.from([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientacao, 0x00, 0x00, 0x00]),
    Uint8Array.from([0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x26, 0x00, 0x00, 0x00]),
    Uint8Array.from([0x00, 0x00, 0x00, 0x00]),
    texto("LATITUDE-3.7319-LONGITUDE-38.5267-IPHONE"),
  );
  return segmento(0xe1, juntar(texto("Exif"), Uint8Array.from([0, 0]), tiff));
}

function jpeg(orientacao: number): Uint8Array {
  return juntar(
    Uint8Array.from([0xff, 0xd8]),
    segmento(0xe0, juntar(texto("JFIF"), Uint8Array.from([0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))),
    app1ComGps(orientacao),
    segmento(0xed, texto("Photoshop 3.0 IPTC Autor Fulano")),
    segmento(0xee, texto("Adobe")),
    segmento(0xfe, texto("comentario com o nome do aparelho")),
    segmento(0xdb, new Uint8Array(65)),
    segmento(0xc0, Uint8Array.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    segmento(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    Uint8Array.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    Uint8Array.from([0xff, 0xd9]),
  );
}

describe("a imagem: JPEG sem metadados, so a orientacao", () => {
  it("le a orientacao do EXIF e monta o APP1 minimo", () => {
    const app1 = app1ComGps(6);
    expect(orientacaoDoExif(app1.slice(4))).toBe(6);
    const minimo = app1SoComAOrientacao(6);
    expect(orientacaoDoExif(minimo.slice(4))).toBe(6);
    expect(minimo[1]).toBe(0xe1);
  });

  it("tira APP1 (GPS), APP13 e COM; fica APP0, APP14 e o APP1 so com a orientacao", () => {
    const preparado = prepararMidia({
      midia: "imagem",
      bytes: jpeg(6),
      mimetype: "image/jpeg",
    });
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    const saida = Buffer.from(preparado.bytes);
    expect(saida.includes(Buffer.from("LATITUDE"))).toBe(false);
    expect(saida.includes(Buffer.from("IPHONE"))).toBe(false);
    expect(saida.includes(Buffer.from("Fulano"))).toBe(false);
    expect(saida.includes(Buffer.from("aparelho"))).toBe(false);
    expect(saida.includes(Buffer.from("JFIF"))).toBe(true);
    expect(saida.includes(Buffer.from("Adobe"))).toBe(true);
    // O APP1 novo logo depois do APP0, so com a orientacao 6.
    const app1 = saida.indexOf(Buffer.from([0xff, 0xe1]));
    expect(app1).toBeGreaterThan(2);
    expect(orientacaoDoExif(Uint8Array.from(saida.subarray(app1 + 4)))).toBe(6);
    // O dado da imagem (depois do SOS) e copiado como esta.
    expect(saida.subarray(-8)).toEqual(
      Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9]),
    );
  });

  it("orientacao 1: nenhum APP1 volta", () => {
    const preparado = prepararMidia({
      midia: "imagem",
      bytes: jpeg(1),
      mimetype: "image/jpeg",
    });
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo === "imagem") {
      expect(Buffer.from(preparado.bytes).includes(Buffer.from([0xff, 0xe1]))).toBe(false);
    }
  });

  it("JPEG cortado nao sai", () => {
    expect(
      prepararMidia({ midia: "imagem", bytes: jpeg(1).slice(0, 30), mimetype: "image/jpeg" }),
    ).toEqual({ tipo: "fora", motivo: "corrompido" });
  });
});

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function pedacoPng(tipo: string, dados: Uint8Array): Uint8Array {
  return juntar(u32be(dados.length), texto(tipo), dados, new Uint8Array(4));
}

describe("a imagem: PNG sem texto, EXIF e data", () => {
  it("tira tEXt, zTXt, iTXt, eXIf e tIME; fica o resto", () => {
    const png = juntar(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pedacoPng("IHDR", new Uint8Array(13)),
      pedacoPng("tEXt", texto("Author\0Fulano de Tal")),
      pedacoPng("zTXt", texto("Comment\0\0xx")),
      pedacoPng("iTXt", texto("GPS\0\0\0\0\0lugar")),
      pedacoPng("eXIf", texto("MM\0*exif")),
      pedacoPng("tIME", new Uint8Array(7)),
      pedacoPng("IDAT", new Uint8Array(20)),
      pedacoPng("IEND", new Uint8Array(0)),
    );
    const preparado = prepararMidia({ midia: "imagem", bytes: png, mimetype: "image/png" });
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    const saida = Buffer.from(preparado.bytes);
    for (const tirado of ["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "Fulano", "lugar"]) {
      expect(saida.includes(Buffer.from(tirado)), tirado).toBe(false);
    }
    for (const fica of ["IHDR", "IDAT", "IEND"]) {
      expect(saida.includes(Buffer.from(fica)), fica).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// WebP e a figurinha
// ---------------------------------------------------------------------------

function pedacoWebp(tipo: string, dados: Uint8Array): Uint8Array {
  const preenchido = dados.length % 2 === 1 ? juntar(dados, new Uint8Array(1)) : dados;
  return juntar(texto(tipo), u32le(dados.length), preenchido);
}

/** O VP8 (com perda) com a largura e a altura. */
function vp8(largura: number, altura: number): Uint8Array {
  return pedacoWebp(
    "VP8 ",
    Uint8Array.from([
      0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a,
      largura & 0xff, (largura >> 8) & 0x3f,
      altura & 0xff, (altura >> 8) & 0x3f,
      0, 0, 0, 0,
    ]),
  );
}

function vp8x(marcas: number, largura: number, altura: number): Uint8Array {
  return pedacoWebp(
    "VP8X",
    juntar(Uint8Array.from([marcas, 0, 0, 0]), u24le(largura - 1), u24le(altura - 1)),
  );
}

function webp(...pedacos: Uint8Array[]): Uint8Array {
  const corpo = juntar(texto("WEBP"), ...pedacos);
  return juntar(texto("RIFF"), u32le(corpo.length), corpo);
}

describe("a imagem: WebP sem EXIF e XMP; a figurinha", () => {
  it("tira EXIF e XMP, limpa as marcas do VP8X e corrige o tamanho do RIFF", () => {
    const original = webp(
      vp8x(0x08 | 0x04 | 0x10, 300, 200),
      vp8(300, 200),
      pedacoWebp("EXIF", texto("GPS LATITUDE APARELHO")),
      pedacoWebp("XMP ", texto("<x:xmpmeta>Fulano</x:xmpmeta>")),
    );
    const preparado = prepararMidia({ midia: "imagem", bytes: original, mimetype: "image/webp" });
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    const saida = Buffer.from(preparado.bytes);
    expect(saida.includes(Buffer.from("LATITUDE"))).toBe(false);
    expect(saida.includes(Buffer.from("Fulano"))).toBe(false);
    expect(saida.readUInt32LE(4)).toBe(saida.length - 8);
    // VP8X: EXIF (0x08) e XMP (0x04) apagados; o alfa (0x10) fica.
    const marcas = saida[20] ?? 0;
    expect(marcas & 0x0c).toBe(0);
    expect(marcas & 0x10).toBe(0x10);
  });

  it("512 por 512 e figurinha (D-98), sem ir a modelo nenhum", () => {
    expect(
      prepararMidia({ midia: "imagem", bytes: webp(vp8(512, 512)), mimetype: "image/webp" }),
    ).toEqual({ tipo: "figurinha" });
    expect(
      prepararMidia({
        midia: "imagem",
        bytes: webp(vp8x(0, 512, 512), vp8(512, 512)),
        mimetype: "image/webp",
      }),
    ).toEqual({ tipo: "figurinha" });
  });

  it("WebP animado e figurinha, de qualquer tamanho", () => {
    expect(
      prepararMidia({
        midia: "imagem",
        bytes: webp(vp8x(0x02, 320, 240), pedacoWebp("ANIM", new Uint8Array(6))),
        mimetype: "image/webp",
      }),
    ).toEqual({ tipo: "figurinha" });
  });

  it("WebP de outro tamanho e foto (vai ao leitor)", () => {
    expect(
      prepararMidia({ midia: "imagem", bytes: webp(vp8(640, 480)), mimetype: "image/webp" }).tipo,
    ).toBe("imagem");
  });

  it("a versao da figurinha tem o formato do banco", () => {
    expect(VERSAO_DA_FIGURINHA).toMatch(/^figurinha-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function pdfSimples(paginas: number, extra = ""): Uint8Array {
  const kids = Array.from({ length: paginas }, (_, i) => `${i + 3} 0 R`).join(" ");
  const objetos = Array.from(
    { length: paginas },
    (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`,
  ).join("");
  return texto(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${paginas} >>\nendobj\n${objetos}trailer\n<< /Root 1 0 R ${extra}>>\n%%EOF\n`,
  );
}

function pdfComFluxoDeObjetos(paginas: number): Uint8Array {
  const dentro = `2 0 3 60\n<< /Type /Pages /Kids [3 0 R] /Count ${paginas} >> << /Type /Page /Parent 2 0 R >>`;
  const comprimido = deflateSync(Buffer.from(dentro, "latin1"));
  return juntar(
    texto("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    texto(`4 0 obj\n<< /Type /ObjStm /N 2 /First 9 /Filter /FlateDecode /Length ${comprimido.length} >>\nstream\n`),
    Uint8Array.from(comprimido),
    texto("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
  );
}

describe("o PDF: sem criptografia, as paginas pela raiz, ate 3", () => {
  it("conta as paginas pelo /Count da raiz (sem /Parent)", () => {
    expect(paginasDoPdf(pdfSimples(1))).toEqual({ paginas: 1 });
    expect(paginasDoPdf(pdfSimples(3))).toEqual({ paginas: 3 });
    const preparado = prepararMidia({
      midia: "documento",
      bytes: pdfSimples(2),
      mimetype: "application/pdf",
    });
    expect(preparado).toMatchObject({ tipo: "pdf", paginas: 2 });
  });

  it("acha a raiz dentro do fluxo de objetos comprimido", () => {
    expect(paginasDoPdf(pdfComFluxoDeObjetos(2))).toEqual({ paginas: 2 });
    expect(
      prepararMidia({
        midia: "documento",
        bytes: pdfComFluxoDeObjetos(4),
        mimetype: "application/pdf",
      }),
    ).toEqual({ tipo: "fora", motivo: "paginas_demais" });
  });

  it("4 paginas ou mais nao sai", () => {
    expect(
      prepararMidia({ midia: "documento", bytes: pdfSimples(4), mimetype: "application/pdf" }),
    ).toEqual({ tipo: "fora", motivo: "paginas_demais" });
  });

  it("PDF cifrado nao sai", () => {
    expect(
      prepararMidia({
        midia: "documento",
        bytes: pdfSimples(1, "/Encrypt 9 0 R "),
        mimetype: "application/pdf",
      }),
    ).toEqual({ tipo: "fora", motivo: "cifrado" });
  });

  it("sem a contagem achada nao sai", () => {
    expect(
      prepararMidia({
        midia: "documento",
        bytes: texto("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"),
        mimetype: "application/pdf",
      }),
    ).toEqual({ tipo: "fora", motivo: "sem_paginas" });
  });

  it("a bomba de compressao para no teto e nao sai", () => {
    const bomba = deflateSync(
      Buffer.alloc(LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal + 1024, 0x20),
    );
    const pdf = juntar(
      texto("%PDF-1.5\n"),
      texto(`4 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${bomba.length} >>\nstream\n`),
      Uint8Array.from(bomba),
      texto("\nendstream\nendobj\n%%EOF\n"),
    );
    expect(pdf.length).toBeLessThan(LIMITES_DA_MIDIA.pdf.maximoDeBytes);
    expect(
      prepararMidia({ midia: "documento", bytes: pdf, mimetype: "application/pdf" }),
    ).toEqual({ tipo: "fora", motivo: "bomba" });
  });

  it("acima de 5 MB nao sai", () => {
    const grande = juntar(pdfSimples(1), new Uint8Array(LIMITES_DA_MIDIA.pdf.maximoDeBytes));
    expect(
      prepararMidia({ midia: "documento", bytes: grande, mimetype: "application/pdf" }),
    ).toEqual({ tipo: "fora", motivo: "grande_demais" });
  });

  it("o documento que e foto vai como imagem", () => {
    expect(
      prepararMidia({ midia: "documento", bytes: jpeg(1), mimetype: "image/jpeg" }).tipo,
    ).toBe("imagem");
  });
});
