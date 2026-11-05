import { describe, expect, it } from "vitest";

import { orientacaoDoExif, prepararMidia } from "@/lib/domain/midia-para-o-modelo";

// O JPEG limpo por LISTA DO QUE FICA (revisao da 6eae43d, achado ALTO):
// antes da primeira varredura, o quadro, as tabelas, o APP0 JFIF e o APP14
// Adobe; entre as varreduras, so as tabelas e o SOS; os dados comprimidos
// como estao; tudo acaba no primeiro EOI (a segunda imagem MPF e o video da
// foto com movimento nunca saem). Fixtures SINTETICAS montadas aqui, nenhum
// arquivo de paciente.

const texto = (t: string) => Uint8Array.from(Buffer.from(t, "latin1"));
const bytes = (...b: number[]) => Uint8Array.from(b);
const juntar = (...partes: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(partes.map((p) => Buffer.from(p))));
const u32be = (n: number) =>
  bytes((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

function segmento(marcador: number, corpo: Uint8Array): Uint8Array {
  const n = corpo.length + 2;
  return juntar(bytes(0xff, marcador, (n >> 8) & 0xff, n & 0xff), corpo);
}

const SOI = bytes(0xff, 0xd8);
const EOI = bytes(0xff, 0xd9);
const APP0_JFIF = segmento(0xe0, juntar(texto("JFIF\0"), bytes(1, 1, 0, 0, 1, 0, 1, 0, 0)));
const APP14_ADOBE = segmento(0xee, juntar(texto("Adobe"), bytes(0, 100, 0, 0, 0, 0, 1)));
const DQT = segmento(0xdb, juntar(bytes(0), new Uint8Array(64).fill(1)));
/** SOF2 (progressivo), 16 por 16, tres componentes. */
const SOF2 = segmento(0xc2, bytes(8, 0, 16, 0, 16, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0));
/** SOF0 (basico), 16 por 16, um componente. */
const SOF0 = segmento(0xc0, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0));
const DHT = segmento(0xc4, juntar(bytes(0x00, 0, 1), new Uint8Array(14), bytes(0)));
/** A varredura DC dos tres componentes e a AC de um. */
const SOS_DC = segmento(0xda, bytes(3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 0, 0x00));
const SOS_AC = segmento(0xda, bytes(1, 1, 0x00, 1, 63, 0x00));
const SOS_UM = segmento(0xda, bytes(1, 1, 0x00, 0, 63, 0x00));
/** Dados comprimidos com FF00 (preenchimento) e RST no meio. */
const DADOS_1 = bytes(0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a);
const DADOS_2 = bytes(0xab, 0xff, 0x00, 0xcd, 0xff, 0xd1, 0xef);

/** Um APP1 Exif com a orientacao, um ponteiro de GPS e o segredo no corpo. */
function app1Exif(orientacao: number, segredo: string): Uint8Array {
  const tiff = juntar(
    texto("II"),
    bytes(0x2a, 0x00, 0x08, 0x00, 0x00, 0x00),
    bytes(0x02, 0x00),
    bytes(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientacao, 0x00, 0x00, 0x00),
    bytes(0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x26, 0x00, 0x00, 0x00),
    bytes(0x00, 0x00, 0x00, 0x00),
    texto(segredo),
  );
  return segmento(0xe1, juntar(texto("Exif\0\0"), tiff));
}

/** O JPEG progressivo da foto: APP0, APP1 com GPS, APP14, duas varreduras. */
function jpegProgressivo(entreAsVarreduras: Uint8Array[] = []): Uint8Array {
  return juntar(
    SOI,
    APP0_JFIF,
    app1Exif(6, "GPS-LAT-3.7319-LON-38.5267-IPHONE"),
    APP14_ADOBE,
    DQT,
    SOF2,
    DHT,
    SOS_DC,
    DADOS_1,
    ...entreAsVarreduras,
    DHT,
    SOS_AC,
    DADOS_2,
    EOI,
  );
}

/** A segunda imagem (MPF), com o proprio APP1 Exif e o GPS. */
const SEGUNDA_IMAGEM = juntar(
  SOI,
  app1Exif(1, "GPS-SEGUNDA-IMAGEM-3.7319S-38.5267W"),
  DQT,
  SOF0,
  DHT,
  SOS_UM,
  bytes(0x11, 0x22),
  EOI,
);

/** O video da foto com movimento (MP4 falso), com o local no atomo ©xyz. */
const VIDEO_DA_FOTO = juntar(
  u32be(24),
  texto("ftypmp42"),
  new Uint8Array(12),
  u32be(48),
  texto("moov"),
  texto("udta"),
  texto("\xa9xyz+03.7319-038.5267/"),
);

function preparar(arquivo: Uint8Array, midia: "imagem" | "documento" = "imagem") {
  return prepararMidia({ midia, bytes: arquivo, mimetype: "image/jpeg" });
}

function contem(saida: Uint8Array, trecho: string | Uint8Array): boolean {
  const procurado = typeof trecho === "string" ? Buffer.from(trecho, "latin1") : Buffer.from(trecho);
  return Buffer.from(saida).includes(procurado);
}

/**
 * Os marcadores do JPEG limpo, na ordem, conferindo a estrutura: cada
 * segmento com o tamanho certo, os dados de cada varredura ate o proximo
 * marcador (FF00 e RST sao dados) e o arquivo acabando no EOI.
 */
function marcadoresDoJpeg(b: Uint8Array): number[] {
  expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
  const marcadores = [0xd8];
  let p = 2;
  for (;;) {
    expect(b[p], `FF do marcador em ${p}`).toBe(0xff);
    const marcador = b[p + 1] ?? 0;
    marcadores.push(marcador);
    if (marcador === 0xd9) {
      p += 2;
      break;
    }
    p += 2 + (((b[p + 2] ?? 0) << 8) | (b[p + 3] ?? 0));
    if (marcador === 0xda) {
      for (;;) {
        expect(p).toBeLessThan(b.length - 1);
        const seguinte = b[p + 1] ?? 0;
        if (b[p] === 0xff && seguinte !== 0x00 && !(seguinte >= 0xd0 && seguinte <= 0xd7)) {
          break;
        }
        p += 1;
      }
    }
  }
  expect(p).toBe(b.length);
  return marcadores;
}

describe("o JPEG: so a primeira imagem, ate o primeiro EOI", () => {
  it("a segunda imagem (MPF) e o video da foto com movimento, depois do EOI, nunca saem", () => {
    const preparado = preparar(juntar(jpegProgressivo(), SEGUNDA_IMAGEM, VIDEO_DA_FOTO), "documento");
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    for (const segredo of [
      "GPS-",
      "SEGUNDA",
      "IPHONE",
      "ftyp",
      "moov",
      "\xa9xyz",
      "+03.7319",
      "038.5267",
    ]) {
      expect(contem(preparado.bytes, segredo), segredo).toBe(false);
    }
    // Valido, na ordem: o APP1 minimo (so a orientacao) logo depois do APP0.
    expect(marcadoresDoJpeg(preparado.bytes)).toEqual([
      0xd8, 0xe0, 0xe1, 0xee, 0xdb, 0xc2, 0xc4, 0xda, 0xc4, 0xda, 0xd9,
    ]);
    const app1 = Buffer.from(preparado.bytes).indexOf(Buffer.from([0xff, 0xe1]));
    expect(orientacaoDoExif(preparado.bytes.subarray(app1 + 4))).toBe(6);
    // Um SOI e um EOI so: nada da segunda imagem.
    expect(contem(preparado.bytes, bytes(0xff, 0xd8, 0xff, 0xe1))).toBe(false);
    expect(preparado.bytes.subarray(-2)).toEqual(EOI);
  });

  it("o APP1, o APP2 e o COM entre as varreduras saem; os dados comprimidos ficam iguais", () => {
    const preparado = preparar(
      jpegProgressivo([
        app1Exif(8, "GPS-ENTRE-AS-VARREDURAS"),
        segmento(0xfe, texto("comentario com o nome Fulano")),
        segmento(0xe2, texto("ICC_PROFILE\0perfil do aparelho")),
      ]),
    );
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    for (const segredo of ["GPS-ENTRE", "Fulano", "aparelho", "ICC_PROFILE"]) {
      expect(contem(preparado.bytes, segredo), segredo).toBe(false);
    }
    expect(marcadoresDoJpeg(preparado.bytes)).toEqual([
      0xd8, 0xe0, 0xe1, 0xee, 0xdb, 0xc2, 0xc4, 0xda, 0xc4, 0xda, 0xd9,
    ]);
    // FF00 e RST sao dados: as duas varreduras chegam iguais.
    expect(contem(preparado.bytes, DADOS_1)).toBe(true);
    expect(contem(preparado.bytes, DADOS_2)).toBe(true);
    // A orientacao vem so do APP1 antes da varredura (6, nunca o 8 de depois).
    const app1 = Buffer.from(preparado.bytes).indexOf(Buffer.from([0xff, 0xe1]));
    expect(orientacaoDoExif(preparado.bytes.subarray(app1 + 4))).toBe(6);
  });

  it("os FF de enchimento antes de um marcador nao atrapalham (e nao saem)", () => {
    const preparado = preparar(
      juntar(
        SOI,
        DQT,
        SOF0,
        DHT,
        SOS_UM,
        bytes(0x11, 0xff, 0x00, 0x22),
        bytes(0xff, 0xff, 0xff),
        segmento(0xfe, texto("Fulano")),
        bytes(0xff, 0xff),
        EOI,
      ),
    );
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    expect(contem(preparado.bytes, "Fulano")).toBe(false);
    expect(marcadoresDoJpeg(preparado.bytes)).toEqual([0xd8, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    expect(contem(preparado.bytes, bytes(0x11, 0xff, 0x00, 0x22, 0xff, 0xd9))).toBe(true);
  });

  it("limpar de novo o que ja saiu limpo da os mesmos bytes", () => {
    const primeira = preparar(juntar(jpegProgressivo(), SEGUNDA_IMAGEM));
    expect(primeira.tipo).toBe("imagem");
    if (primeira.tipo !== "imagem") {
      return;
    }
    const segunda = preparar(primeira.bytes);
    expect(segunda).toEqual(primeira);
  });
});

describe("o JPEG: o APP0 e o APP14 so os que a cor precisa", () => {
  it("o APP0 JFIF fica sem a miniatura; o JFXX e o APP14 de outro fabricante saem", () => {
    const preparado = preparar(
      juntar(
        SOI,
        segmento(0xe0, juntar(texto("JFIF\0"), bytes(1, 2, 1, 0, 72, 0, 72, 2, 1), texto("FOTO!!"))),
        segmento(0xe0, juntar(texto("JFXX\0"), bytes(0x10), texto("MINIATURA-JPEG"))),
        segmento(0xee, texto("OutroFabricante aparelho")),
        DQT,
        SOF0,
        DHT,
        SOS_UM,
        bytes(0x01, 0x02),
        EOI,
      ),
    );
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    for (const segredo of ["FOTO!!", "JFXX", "MINIATURA", "OutroFabricante", "aparelho"]) {
      expect(contem(preparado.bytes, segredo), segredo).toBe(false);
    }
    expect(marcadoresDoJpeg(preparado.bytes)).toEqual([0xd8, 0xe0, 0xdb, 0xc0, 0xc4, 0xda, 0xd9]);
    // O APP0 de 16 bytes: a densidade de antes, a miniatura 0 por 0.
    expect(Array.from(preparado.bytes.subarray(2, 20))).toEqual([
      0xff, 0xe0, 0x00, 0x10, ...texto("JFIF\0"), 1, 2, 1, 0, 72, 0, 72, 0, 0,
    ]);
  });

  it("o APP14 Adobe fica com os 12 bytes de sempre (o resto sai)", () => {
    const preparado = preparar(
      juntar(
        SOI,
        segmento(0xee, juntar(texto("Adobe"), bytes(0, 100, 0, 0, 0, 0, 2), texto("SOBRA-Fulano"))),
        DQT,
        SOF0,
        DHT,
        SOS_UM,
        bytes(0x01),
        EOI,
      ),
    );
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo !== "imagem") {
      return;
    }
    expect(contem(preparado.bytes, "Fulano")).toBe(false);
    expect(Array.from(preparado.bytes.subarray(2, 18))).toEqual([
      0xff, 0xee, 0x00, 0x0e, ...texto("Adobe"), 0, 100, 0, 0, 0, 0, 2,
    ]);
  });
});

describe("o JPEG: o inesperado nao sai", () => {
  const casos: [string, Uint8Array][] = [
    ["SOF3 (sem perda)", juntar(SOI, DQT, segmento(0xc3, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0)), DHT, SOS_UM, bytes(1), EOI)],
    ["SOF9 (aritmetico) e DAC", juntar(SOI, DQT, segmento(0xcc, bytes(0, 0x10)), segmento(0xc9, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0)), SOS_UM, bytes(1), EOI)],
    ["dois SOF", juntar(SOI, DQT, SOF0, SOF0, DHT, SOS_UM, bytes(1), EOI)],
    ["SOI no meio das varreduras", juntar(SOI, DQT, SOF0, DHT, SOS_UM, bytes(1), SOI, EOI)],
    ["SOF entre as varreduras", juntar(SOI, DQT, SOF0, DHT, SOS_UM, bytes(1), SOF0, SOS_UM, bytes(2), EOI)],
    ["JPEG-LS (SOF55)", juntar(SOI, segmento(0xf7, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0)), SOS_UM, bytes(1), EOI)],
    ["marcador reservado", juntar(SOI, DQT, segmento(0x02, bytes(0)), SOF0, DHT, SOS_UM, bytes(1), EOI)],
  ];
  for (const [nome, arquivo] of casos) {
    it(`${nome}: formato`, () => {
      expect(preparar(arquivo)).toEqual({ tipo: "fora", motivo: "formato" });
    });
  }

  it("sem EOI (a imagem cortada no meio dos dados): corrompido", () => {
    expect(preparar(jpegProgressivo().slice(0, -2))).toEqual({ tipo: "fora", motivo: "corrompido" });
    expect(preparar(jpegProgressivo().slice(0, -3))).toEqual({ tipo: "fora", motivo: "corrompido" });
  });

  it("SOS antes do SOF, ou EOI antes de qualquer varredura: corrompido", () => {
    expect(preparar(juntar(SOI, DQT, SOS_UM, bytes(1), SOF0, EOI))).toEqual({
      tipo: "fora",
      motivo: "corrompido",
    });
    expect(preparar(juntar(SOI, DQT, SOF0, EOI))).toEqual({ tipo: "fora", motivo: "corrompido" });
  });
});

describe("o JPEG grande: uma passada so", () => {
  it("4 MB de dados com FF00 e RST sai em menos de 1,5 s, com os dados iguais", () => {
    const dados = new Uint8Array(4 * 1024 * 1024);
    for (let i = 0; i < dados.length; i += 1) {
      dados[i] = (i * 2654435761) >>> 24;
    }
    // Todo FF dos dados vira FF00, e um RST a cada 4 KB.
    const comPreenchimento: number[] = [];
    for (let i = 0; i < dados.length; i += 1) {
      const b = dados[i] ?? 0;
      comPreenchimento.push(b);
      if (b === 0xff) {
        comPreenchimento.push(0x00);
      }
      if (i % 4096 === 4095) {
        comPreenchimento.push(0xff, 0xd0 + ((i >> 12) & 7));
      }
    }
    const varredura = Uint8Array.from(comPreenchimento.slice(0, 4_900_000));
    if (varredura[varredura.length - 1] === 0xff) {
      varredura[varredura.length - 1] = 0x00;
    }
    const arquivo = juntar(SOI, DQT, SOF0, DHT, SOS_UM, varredura, EOI, VIDEO_DA_FOTO);
    const inicio = performance.now();
    const preparado = preparar(arquivo);
    expect(performance.now() - inicio).toBeLessThan(1500);
    expect(preparado.tipo).toBe("imagem");
    if (preparado.tipo === "imagem") {
      expect(contem(preparado.bytes, "\xa9xyz")).toBe(false);
      expect(preparado.bytes.length).toBe(arquivo.length - VIDEO_DA_FOTO.length);
    }
  });
});
