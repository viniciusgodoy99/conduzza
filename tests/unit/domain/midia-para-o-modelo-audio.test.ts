import { describe, expect, it } from "vitest";

import {
  duracaoDoMp3,
  prepararMidia,
  semEtiquetasId3,
} from "@/lib/domain/midia-para-o-modelo";

// O MP3 limpo por LISTA DO QUE FICA (revisao da 6eae43d, BAIXO 1): saem so
// os quadros MPEG, cada um confirmado pelo seguinte; ID3v2 (no comeco, no
// meio e no fim), ID3v1, APE, Lyrics3 e o lixo entre os quadros nunca
// saem. Fixtures SINTETICAS montadas aqui, nenhum audio de paciente.

const texto = (t: string) => Uint8Array.from(Buffer.from(t, "latin1"));
const bytes = (...b: number[]) => Uint8Array.from(b);
const juntar = (...partes: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(partes.map((p) => Buffer.from(p))));
const u32le = (n: number) =>
  bytes(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
const syncsafe = (n: number) =>
  bytes((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);

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

function id3v2(conteudo: string, rodape = false): Uint8Array {
  const corpo = texto(conteudo);
  const cabecalho = juntar(texto("ID3"), bytes(4, 0, rodape ? 0x10 : 0), syncsafe(corpo.length));
  return rodape
    ? juntar(cabecalho, corpo, texto("3DI"), bytes(4, 0, 0x10), syncsafe(corpo.length))
    : juntar(cabecalho, corpo);
}

function id3v1(): Uint8Array {
  const t = new Uint8Array(128);
  t.set(texto("TAGNome no ID3v1"));
  return t;
}

/** Uma etiqueta APEv2 com cabecalho e rodape. */
function apeV2(itens: Record<string, Uint8Array>): Uint8Array {
  const corpo = juntar(
    ...Object.entries(itens).map(([chave, valor]) =>
      juntar(u32le(valor.length), u32le(0), texto(chave), bytes(0), valor),
    ),
  );
  const tamanho = corpo.length + 32;
  const quantos = Object.keys(itens).length;
  const cabecalho = juntar(texto("APETAGEX"), u32le(2000), u32le(tamanho), u32le(quantos), u32le(0xa0000000), new Uint8Array(8));
  const rodape = juntar(texto("APETAGEX"), u32le(2000), u32le(tamanho), u32le(quantos), u32le(0x80000000), new Uint8Array(8));
  return juntar(cabecalho, corpo, rodape);
}

/** Uma etiqueta Lyrics3 v2. */
function lyrics3v2(letra: string): Uint8Array {
  const corpo = `LYRICSBEGININD0000210LYR${String(letra.length).padStart(5, "0")}${letra}`;
  return texto(`${corpo}${String(corpo.length).padStart(6, "0")}LYRICS200`);
}

function preparar(arquivo: Uint8Array) {
  return prepararMidia({ midia: "audio", bytes: arquivo, mimetype: "audio/mpeg" });
}

function contem(saida: Uint8Array, trecho: string): boolean {
  return Buffer.from(saida).includes(Buffer.from(trecho, "latin1"));
}

/** A saida e uma sequencia de quadros iguais ao da fixture (cabecalho e carga zerada). */
function somenteQuadros(saida: Uint8Array): boolean {
  if (saida.length === 0 || saida.length % TAMANHO_DO_QUADRO !== 0) {
    return false;
  }
  const modelo = quadro();
  for (let p = 0; p < saida.length; p += TAMANHO_DO_QUADRO) {
    if (!Buffer.from(saida.subarray(p, p + TAMANHO_DO_QUADRO)).equals(Buffer.from(modelo))) {
      return false;
    }
  }
  return true;
}

describe("o MP3: so os quadros saem", () => {
  it("a etiqueta APEv2 (Title=...) no fim nunca sai", () => {
    const audio = mp3(3);
    const arquivo = juntar(
      audio,
      apeV2({ Title: texto("Fulano da Silva"), Artist: texto("Clinica Exemplo") }),
    );
    const preparado = preparar(arquivo);
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo !== "audio") {
      return;
    }
    expect(contem(preparado.bytes, "Fulano")).toBe(false);
    expect(contem(preparado.bytes, "APETAGEX")).toBe(false);
    expect(preparado.bytes).toEqual(audio);
  });

  it("a APEv2 com um cabecalho de quadro falso dentro (a capa) tambem nao sai", () => {
    const capa = new Uint8Array(TAMANHO_DO_QUADRO + 200).fill(0x41);
    capa.set([0xff, 0xfb, 0x90, 0x44]);
    capa.set(texto("Fulano na capa"), 10);
    const audio = mp3(2);
    const preparado = preparar(juntar(audio, apeV2({ "Cover Art (Front)": capa })));
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo === "audio") {
      expect(contem(preparado.bytes, "Fulano")).toBe(false);
      expect(preparado.bytes).toEqual(audio);
    }
  });

  it("Lyrics3, o ID3v2 do fim (rodape 3DI) e o ID3v1 nunca saem", () => {
    const audio = mp3(2);
    const arquivo = juntar(
      id3v2("TIT2 Nome do comeco"),
      audio,
      lyrics3v2("Fulano canta"),
      id3v2("TIT2 Nome do fim", true),
      id3v1(),
    );
    const preparado = preparar(arquivo);
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo !== "audio") {
      return;
    }
    for (const segredo of ["Nome", "Fulano", "LYRICS", "3DI", "ID3", "TAG"]) {
      expect(contem(preparado.bytes, segredo), segredo).toBe(false);
    }
    expect(preparado.bytes).toEqual(audio);
  });

  it("a ID3v2 e o lixo entre os quadros nunca saem", () => {
    const primeiro = mp3(2);
    const segundo = mp3(2);
    const terceiro = mp3(2);
    const arquivo = juntar(
      primeiro,
      id3v2("TIT2 Fulano no meio"),
      segundo,
      texto("SEGREDO-ENTRE-OS-QUADROS"),
      terceiro,
    );
    const preparado = preparar(arquivo);
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo !== "audio") {
      return;
    }
    expect(contem(preparado.bytes, "SEGREDO")).toBe(false);
    expect(contem(preparado.bytes, "Fulano")).toBe(false);
    expect(contem(preparado.bytes, "ID3")).toBe(false);
    // So quadros: o ultimo antes do lixo nao e confirmado pelo seguinte e
    // fica de fora com ele; o de antes da ID3v2 fica.
    expect(somenteQuadros(preparado.bytes)).toBe(true);
    expect(preparado.bytes.length).toBe(
      primeiro.length + segundo.length - TAMANHO_DO_QUADRO + terceiro.length,
    );
  });

  it("um cabecalho falso logo depois de um quadro, sem o seguinte no lugar, nao vira quadro", () => {
    const falso = new Uint8Array(300).fill(0x42);
    falso.set([0xff, 0xfb, 0x90, 0x44]);
    falso.set(texto("Fulano no lixo"), 8);
    const arquivo = juntar(mp3(2), falso, mp3(2));
    const preparado = preparar(arquivo);
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo === "audio") {
      expect(contem(preparado.bytes, "Fulano")).toBe(false);
    }
  });

  it("um quadro de outra frequencia no meio e lixo (nunca sai)", () => {
    // MPEG-1 Layer III, 128 kbps, 48 kHz: 384 bytes.
    const outro = new Uint8Array(384);
    outro.set([0xff, 0xfb, 0x94, 0x44]);
    outro.set(texto("Fulano em 48 kHz"), 8);
    const preparado = preparar(juntar(mp3(2), outro, outro, mp3(2)));
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo === "audio") {
      expect(contem(preparado.bytes, "Fulano")).toBe(false);
    }
  });

  it("a saida e so de quadros e a duracao e a mesma", () => {
    const arquivo = juntar(id3v2("TIT2 x"), mp3(15), id3v1());
    const limpo = semEtiquetasId3(arquivo);
    expect(limpo.length % TAMANHO_DO_QUADRO).toBe(0);
    expect(duracaoDoMp3(limpo)?.segundos).toBeCloseTo(duracaoDoMp3(arquivo)?.segundos ?? -1, 6);
    expect(semEtiquetasId3(texto("sem quadro nenhum aqui"))).toEqual(new Uint8Array(0));
  });
});

describe("o MP3: o lixo aceito e menor (2 KB ou 1%)", () => {
  it("lixo acima do teto: fora de sincronia; abaixo: sai sem ele", () => {
    const metade = mp3(10);
    const lixo = (n: number) => new Uint8Array(n).fill(0x11);
    expect(preparar(juntar(metade, lixo(4000), metade))).toEqual({
      tipo: "fora",
      motivo: "fora_de_sincronia",
    });
    const preparado = preparar(juntar(metade, lixo(1000), metade));
    expect(preparado.tipo).toBe("audio");
    if (preparado.tipo === "audio") {
      expect(preparado.bytes.length % TAMANHO_DO_QUADRO).toBe(0);
    }
  });

  it("o primeiro quadro longe demais do comeco: sem quadros", () => {
    expect(preparar(juntar(id3v2("TIT2 x"), new Uint8Array(3000), mp3(2)))).toEqual({
      tipo: "fora",
      motivo: "sem_quadros",
    });
  });
});
