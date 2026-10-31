import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  LIMITES_DA_MIDIA,
  paginasDoPdf,
  prepararMidia,
} from "@/lib/domain/midia-para-o-modelo";

// O PDF (revisao da 6eae43d): a leitura numa passada com tetos (achado
// MEDIO: o PDF feito para travar o motor), as paginas contadas de verdade
// (BAIXO 3: o /Count que mente) e a foto embutida limpa no lugar (BAIXO 4:
// o Exif com o local dentro do /DCTDecode). Fixtures SINTETICAS montadas
// aqui, nenhum arquivo de paciente.

const texto = (t: string) => Uint8Array.from(Buffer.from(t, "latin1"));
const bytes = (...b: number[]) => Uint8Array.from(b);
const juntar = (...partes: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(partes.map((p) => Buffer.from(p))));

/** O PDF com os objetos dados (texto ou bytes) e o trailer. */
function pdf(objetos: (string | Uint8Array)[], trailer = "<< /Root 1 0 R >>"): Uint8Array {
  return juntar(
    texto("%PDF-1.7\n"),
    ...objetos.map((o) => (typeof o === "string" ? texto(o) : o)),
    texto(`trailer\n${trailer}\n%%EOF\n`),
  );
}

/** O catalogo, a raiz (com o /Count dado) e as paginas 3, 4, ... */
function arvore(paginas: number, contagem = paginas, tipoDaPagina = "/Type /Page "): string[] {
  const filhos = Array.from({ length: paginas }, (_, i) => `${i + 3} 0 R`).join(" ");
  return [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${filhos}] /Count ${contagem} >>\nendobj\n`,
    ...Array.from(
      { length: paginas },
      (_, i) => `${i + 3} 0 obj\n<< ${tipoDaPagina}/Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`,
    ),
  ];
}

/** Um fluxo de objetos (comprimido) com os objetos dados: [numero, texto]. */
function fluxoDeObjetos(numero: number, objetos: [number, string][]): Uint8Array {
  let deslocamento = 0;
  const pares: string[] = [];
  for (const [n, corpo] of objetos) {
    pares.push(`${n} ${deslocamento}`);
    deslocamento += corpo.length + 1;
  }
  const cabecalho = `${pares.join(" ")} `;
  const conteudo = cabecalho + objetos.map(([, corpo]) => corpo).join(" ");
  const comprimido = deflateSync(Buffer.from(conteudo, "latin1"));
  return juntar(
    texto(
      `${numero} 0 obj\n<< /Type /ObjStm /N ${objetos.length} /First ${cabecalho.length} /Filter /FlateDecode /Length ${comprimido.length} >>\nstream\n`,
    ),
    Uint8Array.from(comprimido),
    texto("\nendstream\nendobj\n"),
  );
}

function preparar(arquivo: Uint8Array) {
  return prepararMidia({ midia: "documento", bytes: arquivo, mimetype: "application/pdf" });
}

function contem(saida: Uint8Array, trecho: string): boolean {
  return Buffer.from(saida).includes(Buffer.from(trecho, "latin1"));
}

function cronometrar<T>(fazer: () => T): { resultado: T; ms: number } {
  const inicio = performance.now();
  const resultado = fazer();
  return { resultado, ms: performance.now() - inicio };
}

// ---------------------------------------------------------------------------
// O PDF feito para travar o motor
// ---------------------------------------------------------------------------

describe("o PDF feito para travar o motor: bomba, rapido", () => {
  it("5 MB de stream e endstream repetidos: bomba em menos de 1,5 s", () => {
    const repeticao = "stream\nendstream\n";
    const vezes = Math.floor((LIMITES_DA_MIDIA.pdf.maximoDeBytes - 4096) / repeticao.length);
    const arquivo = pdf([...arvore(1), repeticao.repeat(vezes)]);
    expect(arquivo.length).toBeLessThanOrEqual(LIMITES_DA_MIDIA.pdf.maximoDeBytes);
    const { resultado, ms } = cronometrar(() => preparar(arquivo));
    expect(resultado).toEqual({ tipo: "fora", motivo: "bomba" });
    expect(ms).toBeLessThan(1500);
  });

  it("5 MB de objetos pequenos (300 mil cabecalhos): bomba em menos de 1,5 s", () => {
    const objeto = "9 0 obj\n<< /A 1 >>\nendobj\n";
    const vezes = Math.floor((LIMITES_DA_MIDIA.pdf.maximoDeBytes - 4096) / objeto.length);
    const arquivo = pdf([...arvore(1), objeto.repeat(vezes)]);
    const { resultado, ms } = cronometrar(() => preparar(arquivo));
    expect(resultado).toEqual({ tipo: "fora", motivo: "bomba" });
    expect(ms).toBeLessThan(1500);
  });

  /** O PDF com um fluxo de objetos de um objeto so ("50 0") e o enchimento de <<>>. */
  function pdfComEnchimento(bytesDescomprimidos: number): Uint8Array {
    const conteudo = `50 0 ${"<<>>".repeat(Math.floor(bytesDescomprimidos / 4))}`;
    const comprimido = deflateSync(Buffer.from(conteudo, "latin1"), { level: 9 });
    return pdf([
      ...arvore(1),
      texto(
        `9 0 obj\n<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode /Length ${comprimido.length} >>\nstream\n`,
      ),
      Uint8Array.from(comprimido),
      "\nendstream\nendobj\n",
    ]);
  }

  it("20 KB com um fluxo de objetos que descomprime para uns 20 MB de <<>>: bomba (o teto de 8 MB) em menos de 1,5 s", () => {
    expect(LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal).toBe(8 * 1024 * 1024);
    const arquivo = pdfComEnchimento(20 * 1024 * 1024 - 4096);
    expect(arquivo.length).toBeLessThan(40_000);
    const { resultado, ms } = cronometrar(() => preparar(arquivo));
    expect(resultado).toEqual({ tipo: "fora", motivo: "bomba" });
    expect(ms).toBeLessThan(1500);
  });

  it("o enchimento logo abaixo do teto (sobra depois do ultimo objeto): bomba em menos de 1,5 s", () => {
    const arquivo = pdfComEnchimento(LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal - 4096);
    const { resultado, ms } = cronometrar(() => preparar(arquivo));
    expect(resultado).toEqual({ tipo: "fora", motivo: "bomba" });
    expect(ms).toBeLessThan(1500);
  });

  it("o mesmo enchimento dentro de um objeto so: lido numa passada, em menos de 1,5 s", () => {
    const enchimento = "<<>>".repeat(
      Math.floor((LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal - 4096) / 4),
    );
    const corpo = `<< /Type /Pages /Kids [3 0 R] /Count 1 /X [${enchimento}] >>`;
    const conteudo = `2 0 ${corpo}`;
    const comprimido = deflateSync(Buffer.from(conteudo, "latin1"), { level: 9 });
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n",
      texto(
        `9 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${comprimido.length} >>\nstream\n`,
      ),
      Uint8Array.from(comprimido),
      "\nendstream\nendobj\n",
    ]);
    const { resultado, ms } = cronometrar(() => preparar(arquivo));
    // A trava de tempo pode virar o arquivo pesado em "bomba" numa maquina
    // lenta ou ocupada (so depois de passar dela).
    if (!(resultado.tipo === "fora" && resultado.motivo === "bomba" && ms >= LIMITES_DA_MIDIA.tempoPorArquivoMs)) {
      expect(resultado).toMatchObject({ tipo: "pdf", paginas: 1 });
    }
    expect(ms).toBeLessThan(1500);
  });

  it("os mesmos 5 MB com um cabecalho falso a cada 4 KB: o primeiro dicionario que nao fecha, dentro do fluxo, ja deixa o PDF de fora", () => {
    // Um fluxo de verdade cujos dados tem cabecalhos de objeto com uma
    // lista que nunca fecha: cada um varreria o arquivo ate o fim. Desde a
    // terceira rodada, o objeto malformado dentro de um fluxo e "formato"
    // (o leitor tolerante pode achar ali um fluxo que esta leitura nao
    // ve), entao a varredura para no primeiro.
    const isca = `1 0 obj << /A [${"x".repeat(4000)} `;
    const dados = isca.repeat(Math.floor((LIMITES_DA_MIDIA.pdf.maximoDeBytes - 8192) / isca.length));
    const arquivo = pdf([
      ...arvore(1),
      `9 0 obj\n<< /Length ${dados.length} >>\nstream\n`,
      dados,
      "\nendstream\nendobj\n",
    ]);
    const { resultado, ms } = cronometrar(() => preparar(arquivo));
    expect(resultado).toEqual({ tipo: "fora", motivo: "formato" });
    expect(ms).toBeLessThan(1500);
  });

  it("um dicionario que nunca fecha, fora de fluxo: corrompido", () => {
    expect(preparar(pdf([...arvore(1), "9 0 obj\n<< /A [1 2 3\nendobj\n"]))).toEqual({
      tipo: "fora",
      motivo: "corrompido",
    });
  });

  it("a referencia com numero enorme (gerador com defeito) e a palavra solta no lugar da chave nao quebram a leitura", () => {
    const arquivo = pdf([
      ...arvore(1),
      "13 0 obj\n<< /Type /StructElem /S /Document /Pg 18446744073386459286 0 R /Lang\n(pt-BR) /K [ 15 0 R ]  >>\nendobj\n",
      "14 0 obj\n<< /Type /StructTreeRoot 7 /K 13 0 R >>\nendobj\n",
    ]);
    expect(preparar(arquivo)).toMatchObject({ tipo: "pdf", paginas: 1 });
  });

  it("stream sem endstream depois: corrompido", () => {
    expect(
      preparar(pdf([...arvore(1), "9 0 obj\n<< /Length 4 >>\nstream\nabcd\nendobj\n"])),
    ).toEqual({ tipo: "fora", motivo: "corrompido" });
  });
});

// ---------------------------------------------------------------------------
// As paginas de verdade
// ---------------------------------------------------------------------------

describe("as paginas: a maior entre /Count, /Type /Page e os filhos de /Kids", () => {
  it("/Count 1 com 30 paginas /Type /Page: 30, nao sai", () => {
    const arquivo = pdf(arvore(30, 1));
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 30 });
    expect(preparar(arquivo)).toEqual({ tipo: "fora", motivo: "paginas_demais" });
  });

  it("paginas sem /Type contam pelos filhos de /Kids", () => {
    expect(paginasDoPdf(pdf(arvore(10, 1, "")))).toEqual({ paginas: 10 });
  });

  it("a mesma pagina repetida em /Kids conta cada vez", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R 3 0 R 3 0 R 3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n",
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 4 });
    expect(preparar(arquivo)).toEqual({ tipo: "fora", motivo: "paginas_demais" });
  });

  it("a lista /Kids indireta tambem conta", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids 20 0 R /Count 1 >>\nendobj\n",
      "20 0 obj\n[3 0 R 4 0 R 5 0 R 6 0 R]\nendobj\n",
      ...[3, 4, 5, 6].map((n) => `${n} 0 obj\n<< /Parent 2 0 R >>\nendobj\n`),
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 4 });
  });

  it("dentro do fluxo de objetos tambem: /Count 1 com 5 paginas, nao sai", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      fluxoDeObjetos(9, [
        [2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 1 >>"],
        ...[3, 4, 5, 6, 7].map((n): [number, string] => [n, "<< /Type /Page /Parent 2 0 R >>"]),
      ]),
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 5 });
    expect(preparar(arquivo)).toEqual({ tipo: "fora", motivo: "paginas_demais" });
  });

  it("o no intermediario nao conta como pagina", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [10 0 R] /Count 3 >>\nendobj\n",
      "10 0 obj\n<< /Type /Pages /Parent 2 0 R /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n",
      ...[3, 4, 5].map((n) => `${n} 0 obj\n<< /Type /Page /Parent 10 0 R >>\nendobj\n`),
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 3 });
    expect(preparar(arquivo)).toMatchObject({ tipo: "pdf", paginas: 3 });
  });

  it("a atualizacao incremental (a raiz e as paginas reescritas) conta cada pagina uma vez", () => {
    const original = pdf(arvore(2));
    const atualizacao = texto(
      [
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [] >>\nendobj\n",
        "4 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [] >>\nendobj\n",
        "trailer\n<< /Root 1 0 R /Prev 9 >>\n%%EOF\n",
      ].join(""),
    );
    const arquivo = juntar(original, atualizacao);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 2 });
    expect(preparar(arquivo)).toMatchObject({ tipo: "pdf", paginas: 2 });
  });

  it("o nome com escape (#xx) conta igual", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Ty#70e /Pa#67es /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Co#75nt 1 >>\nendobj\n",
      ...[3, 4, 5, 6].map((n) => `${n} 0 obj\n<< /Type /Pag#65 /Parent 2 0 R >>\nendobj\n`),
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 4 });
  });

  it("a string com >> dentro nao confunde a leitura do dicionario", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /T (fecha >> aqui \\) e <<) /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 1 >>\nendobj\n",
      ...[3, 4, 5, 6].map((n) => `${n} 0 obj\n<< /Parent 2 0 R >>\nendobj\n`),
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 4 });
  });

  it("/Encrypt com escape no dicionario do fluxo de referencias: cifrado", () => {
    const arquivo = pdf([
      ...arvore(1),
      "9 0 obj\n<< /Type /XRef /Encr#79pt 8 0 R /Size 10 /Length 4 >>\nstream\nabcd\nendstream\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual({ tipo: "fora", motivo: "cifrado" });
  });
});

describe("o fluxo de objetos que nao da para ler: fora", () => {
  it("outro filtro, ou com preditor: formato", () => {
    const lzw = pdf([
      ...arvore(1),
      "9 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /LZWDecode /Length 4 >>\nstream\nabcd\nendstream\nendobj\n",
    ]);
    expect(preparar(lzw)).toEqual({ tipo: "fora", motivo: "formato" });
    const comPreditor = pdf([
      ...arvore(1),
      "9 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> /Length 4 >>\nstream\nabcd\nendstream\nendobj\n",
    ]);
    expect(preparar(comPreditor)).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("o FlateDecode que nao descomprime: corrompido", () => {
    const arquivo = pdf([
      ...arvore(1),
      "9 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 8 >>\nstream\nnao-zlib\nendstream\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual({ tipo: "fora", motivo: "corrompido" });
  });
});

// ---------------------------------------------------------------------------
// A foto embutida
// ---------------------------------------------------------------------------

function segmento(marcador: number, corpo: Uint8Array): Uint8Array {
  const n = corpo.length + 2;
  return juntar(bytes(0xff, marcador, (n >> 8) & 0xff, n & 0xff), corpo);
}

/** A foto (JPEG) com tudo o que nao pode ir: Exif com GPS, IPTC, COM e o video depois do EOI. */
function fotoComSegredos(): Uint8Array {
  return juntar(
    bytes(0xff, 0xd8),
    segmento(0xe0, juntar(texto("JFIF\0"), bytes(1, 1, 0, 0, 72, 0, 72, 2, 1), texto("MINI!!"))),
    segmento(0xe1, juntar(texto("Exif\0\0MM\0*"), texto("GPS-LAT-3.7319-LON-38.5267"))),
    segmento(0xed, texto("Photoshop 3.0 IPTC Autor Fulano")),
    segmento(0xee, juntar(texto("Adobe"), bytes(0, 100, 0, 0, 0, 0, 1))),
    segmento(0xfe, texto("comentario com o aparelho")),
    segmento(0xdb, juntar(bytes(0), new Uint8Array(64).fill(1))),
    segmento(0xc0, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0)),
    segmento(0xc4, juntar(bytes(0x00, 0, 1), new Uint8Array(14), bytes(0))),
    segmento(0xda, bytes(1, 1, 0x00, 0, 63, 0x00)),
    bytes(0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56),
    segmento(0xe1, texto("http://ns.adobe.com/xap/1.0/\0GPS-NO-XMP-ENTRE")),
    segmento(0xda, bytes(1, 1, 0x00, 0, 63, 0x00)),
    bytes(0x78, 0x9a),
    bytes(0xff, 0xd9),
    texto("\x00\x00\x00\x18ftypmp42\xa9xyz+03.7319-038.5267/"),
  );
}

function pdfComFoto(foto: Uint8Array, filtro = "/DCTDecode"): { arquivo: Uint8Array; inicio: number } {
  const antes = juntar(
    texto("%PDF-1.7\n"),
    ...arvore(1).map(texto),
    texto(
      `9 0 obj\n<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter ${filtro} /Length ${foto.length} >>\nstream\n`,
    ),
  );
  return {
    arquivo: juntar(antes, foto, texto("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")),
    inicio: antes.length,
  };
}

/** Os marcadores da foto limpa, ate o EOI (conferindo os tamanhos). */
function marcadoresDaFoto(b: Uint8Array): { marcadores: number[]; fimDoEoi: number } {
  const marcadores = [0xd8];
  let p = 2;
  for (;;) {
    expect(b[p]).toBe(0xff);
    const marcador = b[p + 1] ?? 0;
    marcadores.push(marcador);
    if (marcador === 0xd9) {
      return { marcadores, fimDoEoi: p + 2 };
    }
    p += 2 + (((b[p + 2] ?? 0) << 8) | (b[p + 3] ?? 0));
    if (marcador === 0xda) {
      while (!(b[p] === 0xff && b[p + 1] !== 0x00 && !((b[p + 1] ?? 0) >= 0xd0 && (b[p + 1] ?? 0) <= 0xd7))) {
        p += 1;
      }
    }
  }
}

describe("a foto embutida no PDF: limpa no lugar, sem mudar o tamanho", () => {
  it("o Exif, o IPTC, o COM, o XMP entre as varreduras e o video depois do EOI viram zero", () => {
    const foto = fotoComSegredos();
    const { arquivo, inicio } = pdfComFoto(foto);
    const copia = arquivo.slice();
    const preparado = preparar(arquivo);
    expect(preparado.tipo).toBe("pdf");
    if (preparado.tipo !== "pdf") {
      return;
    }
    // A entrada nao muda.
    expect(arquivo).toEqual(copia);
    const saida = preparado.bytes;
    // O mesmo tamanho: o /Length e a xref continuam certos.
    expect(saida.length).toBe(arquivo.length);
    for (const segredo of ["GPS-", "Fulano", "aparelho", "MINI!!", "ftyp", "\xa9xyz", "+03.7319", "IPTC"]) {
      expect(contem(saida, segredo), segredo).toBe(false);
    }
    // Fora da foto, nada muda.
    expect(saida.subarray(0, inicio)).toEqual(arquivo.subarray(0, inicio));
    expect(saida.subarray(inicio + foto.length)).toEqual(arquivo.subarray(inicio + foto.length));
    // A foto continua valida: o APP1, o APP13 e o COM viraram COM zerado;
    // o APP0 JFIF e o APP14 Adobe ficaram; nada depois do EOI.
    const limpa = saida.subarray(inicio, inicio + foto.length);
    const { marcadores, fimDoEoi } = marcadoresDaFoto(limpa);
    expect(marcadores).toEqual([
      0xd8, 0xe0, 0xfe, 0xfe, 0xee, 0xfe, 0xdb, 0xc0, 0xc4, 0xda, 0xfe, 0xda, 0xd9,
    ]);
    expect(contem(limpa, "JFIF\0")).toBe(true);
    expect(contem(limpa, "Adobe")).toBe(true);
    expect(limpa.subarray(fimDoEoi).every((b) => b === 0)).toBe(true);
    // Os dados comprimidos ficam iguais.
    expect(Buffer.from(limpa).includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]))).toBe(true);
  });

  it("o filtro abreviado (/DCT) e a lista com um filtro so tambem sao limpos", () => {
    for (const filtro of ["/DCT", "[/DCTDecode]", "[ /DCT#44ecode ]"]) {
      const preparado = preparar(pdfComFoto(fotoComSegredos(), filtro).arquivo);
      expect(preparado.tipo, filtro).toBe("pdf");
      if (preparado.tipo === "pdf") {
        expect(contem(preparado.bytes, "GPS-"), filtro).toBe(false);
      }
    }
  });

  it("/DCTDecode numa cadeia de filtros, ou /JPXDecode: formato", () => {
    expect(preparar(pdfComFoto(fotoComSegredos(), "[/FlateDecode /DCTDecode]").arquivo)).toEqual({
      tipo: "fora",
      motivo: "formato",
    });
    expect(preparar(pdfComFoto(fotoComSegredos(), "/JPXDecode").arquivo)).toEqual({
      tipo: "fora",
      motivo: "formato",
    });
    expect(preparar(pdfComFoto(fotoComSegredos(), "12 0 R").arquivo)).toEqual({
      tipo: "fora",
      motivo: "formato",
    });
  });

  it("a foto quebrada (sem EOI) ou com marcador fora da lista: fora", () => {
    const semEoi = fotoComSegredos().slice(0, 300);
    expect(preparar(pdfComFoto(semEoi).arquivo)).toEqual({ tipo: "fora", motivo: "corrompido" });
    const semPerda = juntar(
      bytes(0xff, 0xd8),
      segmento(0xc3, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0)),
      segmento(0xda, bytes(1, 1, 0x00, 0, 63, 0x00)),
      bytes(0x01, 0xff, 0xd9),
    );
    expect(preparar(pdfComFoto(semPerda).arquivo)).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("o PDF sem foto sai com os mesmos bytes", () => {
    const arquivo = pdf(arvore(2));
    const preparado = preparar(arquivo);
    expect(preparado).toMatchObject({ tipo: "pdf", paginas: 2 });
    if (preparado.tipo === "pdf") {
      expect(preparado.bytes).toEqual(arquivo);
    }
  });
});

// ---------------------------------------------------------------------------
// A localizacao no XMP e o anexo (recusas da segunda rodada)
// ---------------------------------------------------------------------------

const utf8 = (t: string) => Uint8Array.from(Buffer.from(t, "utf8"));
const comprimir = (b: Uint8Array) => Uint8Array.from(deflateSync(Buffer.from(b)));

/** O pacote XMP com as propriedades (elementos) e os atributos do rdf:Description. */
function pacoteXmp(propriedades: string, atributos = ""): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:xmpTPg="http://ns.adobe.com/xap/1.0/t/pg/" xmlns:stDim="http://ns.adobe.com/xap/1.0/sType/Dimensions#" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"${atributos}>`,
    propriedades,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
}

/** O XMP de um PDF comum: autor, datas, programa, identificador, tamanho e titulo. */
const XMP_SEM_LOCAL = [
  "<dc:creator><rdf:Seq><rdf:li>Fulano de Tal</rdf:li></rdf:Seq></dc:creator>",
  '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Pedido N° 3, 2° andar</rdf:li></rdf:Alt></dc:title>',
  "<xmp:CreateDate>2026-10-30T12:34:56-03:00</xmp:CreateDate>",
  "<xmp:ModifyDate>2026-10-30T12:35:10.123-03:00</xmp:ModifyDate>",
  "<xmp:CreatorTool>Microsoft® Word para Microsoft 365</xmp:CreatorTool>",
  "<xmp:Label>Sala 2° andar, versao 1.2</xmp:Label>",
  "<pdf:Producer>Microsoft® Word para Microsoft 365</pdf:Producer>",
  "<xmpMM:DocumentID>uuid:6F9F2C1E-1B2A-4C3D-9E8F-0A1B2C3D4E5F</xmpMM:DocumentID>",
  "<photoshop:DateCreated>2026-10-30</photoshop:DateCreated>",
  '<xmpTPg:MaxPageSize stDim:w="612.000000" stDim:h="792.000000" stDim:unit="Points"/>',
].join("\n");

/**
 * O PDF de uma pagina com o XMP no objeto 20, que o catalogo aponta
 * (/Metadata 20 0 R); o dicionario do fluxo e o dado (padrao: /Type
 * /Metadata /Subtype /XML).
 */
function pdfComXmp(
  xmp: Uint8Array,
  opcoes: { comprimido?: boolean; dicionario?: string; catalogoAponta?: boolean } = {},
): Uint8Array {
  const dados = opcoes.comprimido === true ? comprimir(xmp) : xmp;
  const filtro = opcoes.comprimido === true ? "/Filter /FlateDecode " : "";
  const metadata = opcoes.catalogoAponta === false ? "" : " /Metadata 20 0 R";
  return pdf([
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${metadata} >>\nendobj\n`,
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
    texto(
      `20 0 obj\n<< ${opcoes.dicionario ?? "/Type /Metadata /Subtype /XML "}${filtro}/Length ${dados.length} >>\nstream\n`,
    ),
    dados,
    "\nendstream\nendobj\n",
  ]);
}

const FORA_DO_FORMATO = { tipo: "fora", motivo: "formato" };

describe("a localizacao no XMP: o PDF nao sai", () => {
  it("exif:GPSLatitude e exif:GPSLongitude (atributos), sem compressao: formato", () => {
    const xmp = pacoteXmp(
      XMP_SEM_LOCAL,
      ' exif:GPSLatitude="3,43.914S" exif:GPSLongitude="38,31.602W"',
    );
    expect(preparar(pdfComXmp(utf8(xmp)))).toEqual(FORA_DO_FORMATO);
  });

  it("o XMP comprimido (FlateDecode) com exif:GPSAltitude: formato", () => {
    const xmp = pacoteXmp(`${XMP_SEM_LOCAL}\n<exif:GPSAltitude>12/1</exif:GPSAltitude>`);
    expect(preparar(pdfComXmp(utf8(xmp), { comprimido: true }))).toEqual(FORA_DO_FORMATO);
  });

  it("o /Metadata do catalogo sem /Type /Metadata nem /Subtype /XML (comprimido): formato", () => {
    const xmp = pacoteXmp(`${XMP_SEM_LOCAL}\n<exif:GPSLatitude>3,43.914S</exif:GPSLatitude>`);
    expect(preparar(pdfComXmp(utf8(xmp), { comprimido: true, dicionario: "" }))).toEqual(
      FORA_DO_FORMATO,
    );
  });

  it("o XMP da foto (o /Metadata da imagem) com GPSLongitude do IPTC: formato", () => {
    const xmp = comprimir(
      utf8(pacoteXmp('<Iptc4xmpExt:GPSLongitude>-38.526700</Iptc4xmpExt:GPSLongitude>')),
    );
    const arquivo = pdf([
      ...arvore(1),
      "4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Metadata 21 0 R /Length 1 >>\nstream\nX\nendstream\nendobj\n",
      texto(`21 0 obj\n<< /Filter /FlateDecode /Length ${xmp.length} >>\nstream\n`),
      xmp,
      "\nendstream\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("a coordenada numa propriedade photoshop: ou xmp: (comprimido): formato", () => {
    for (const [nome, xmp] of [
      ["par decimal no photoshop:", pacoteXmp(`${XMP_SEM_LOCAL}\n<photoshop:Instructions>tirada em -3.731900, -38.526700</photoshop:Instructions>`)],
      ["formato do XMP no xmp:", pacoteXmp(XMP_SEM_LOCAL, ' xmp:Nickname="3,43.914S"')],
      ["graus, minutos e segundos no xmp:", pacoteXmp(`${XMP_SEM_LOCAL}\n<xmp:Nickname>3°43'54.8"S 38°31'36.1"O</xmp:Nickname>`)],
      ["graus decimais com o hemisferio no photoshop:", pacoteXmp(XMP_SEM_LOCAL, ' photoshop:Headline="3.731900 S 38.526700 O"')],
    ] as const) {
      expect(preparar(pdfComXmp(utf8(xmp), { comprimido: true })), nome).toEqual(FORA_DO_FORMATO);
    }
  });

  it("o XMP em UTF-16 com exif:GPS, sem compressao: formato", () => {
    const xmp = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(pacoteXmp(`${XMP_SEM_LOCAL}\n<exif:GPSLatitude>3,43.914S</exif:GPSLatitude>`), "utf16le"),
    ]);
    expect(preparar(pdfComXmp(Uint8Array.from(xmp)))).toEqual(FORA_DO_FORMATO);
  });

  it("as propriedades de GPS soltas no arquivo, fora de um fluxo de metadados: formato", () => {
    const xmp = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n<exif:GPSLatitude>3,43.914S</exif:GPSLatitude>`));
    expect(
      preparar(pdfComXmp(xmp, { dicionario: "", catalogoAponta: false })),
    ).toEqual(FORA_DO_FORMATO);
  });

  it("o fluxo de metadados que nao da para ler (outro filtro): formato; a bomba nele: bomba", () => {
    expect(
      preparar(pdfComXmp(utf8("3C3F78"), { dicionario: "/Type /Metadata /Filter /ASCIIHexDecode " })),
    ).toEqual(FORA_DO_FORMATO);
    const bomba = Uint8Array.from(Buffer.alloc(LIMITES_DA_MIDIA.pdfDescomprimidoNoTotal + 1024, 0x20));
    expect(preparar(pdfComXmp(bomba, { comprimido: true }))).toEqual({ tipo: "fora", motivo: "bomba" });
  });
});

describe("o XMP sem localizacao: o PDF sai (controle)", () => {
  it("so autor, datas, programa, identificador e tamanho, sem compressao e comprimido: sai igual", () => {
    for (const comprimido of [false, true]) {
      const arquivo = pdfComXmp(utf8(pacoteXmp(XMP_SEM_LOCAL)), { comprimido });
      const preparado = preparar(arquivo);
      expect(preparado, `comprimido: ${comprimido}`).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(preparado.bytes).toEqual(arquivo);
      }
    }
  });

  it("o XMP com GPS dentro da foto (APP1): a foto e limpa e o PDF sai", () => {
    const xmpDaFoto = juntar(
      texto("http://ns.adobe.com/xap/1.0/\0"),
      utf8(pacoteXmp('<exif:GPSLatitude>3,43.914S</exif:GPSLatitude>')),
    );
    const foto = juntar(
      bytes(0xff, 0xd8),
      segmento(0xe1, xmpDaFoto),
      segmento(0xdb, juntar(bytes(0), new Uint8Array(64).fill(1))),
      segmento(0xc0, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0)),
      segmento(0xda, bytes(1, 1, 0x00, 0, 63, 0x00)),
      bytes(0x12, 0x34, 0xff, 0xd9),
    );
    const preparado = preparar(pdfComFoto(foto).arquivo);
    expect(preparado).toMatchObject({ tipo: "pdf", paginas: 1 });
    if (preparado.tipo === "pdf") {
      expect(contem(preparado.bytes, "GPS")).toBe(false);
    }
  });
});

describe("o anexo: o PDF nao sai", () => {
  const RAIZ_E_PAGINA = [
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];

  it("/EmbeddedFiles no catalogo e o fluxo /EmbeddedFile: formato", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 6 0 R >> >>\nendobj\n",
      ...RAIZ_E_PAGINA,
      "6 0 obj\n<< /Names [(foto.jpg) 7 0 R] >>\nendobj\n",
      "7 0 obj\n<< /Type /Filespec /F (foto.jpg) /EF << /F 8 0 R >> >>\nendobj\n",
      "8 0 obj\n<< /Type /EmbeddedFile /Length 4 >>\nstream\nJPEG\nendstream\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("a anotacao /FileAttachment dentro da pagina: formato", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 10 10] /FS 7 0 R >>] >>\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("os nomes escritos com #xx: formato", () => {
    for (const objeto of [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /Embedded#46iles 6 0 R >> >>\nendobj\n",
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /#45mbedded#46#69les 6 0 R >> >>\nendobj\n",
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction << /Subtype /File#41ttachment >> >>\nendobj\n",
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n8 0 obj\n<< /Type /Embedded#46il#65 /Length 1 >>\nstream\nx\nendstream\nendobj\n",
    ]) {
      expect(preparar(pdf([objeto, ...RAIZ_E_PAGINA])), objeto).toEqual(FORA_DO_FORMATO);
    }
  });

  it("dentro do fluxo de objetos (comprimido): formato", () => {
    const arquivo = pdf([
      fluxoDeObjetos(9, [
        [1, "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 6 0 R >> >>"],
        [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
        [3, "<< /Type /Page /Parent 2 0 R >>"],
      ]),
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("so a chave /EF de um /Filespec (o fluxo sem /Type): formato", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AF [7 0 R] >>\nendobj\n",
      ...RAIZ_E_PAGINA,
      "7 0 obj\n<< /Type /Filespec /F (dados.xml) /EF << /F 8 0 R >> >>\nendobj\n",
      "8 0 obj\n<< /Length 4 >>\nstream\n<a/>\nendstream\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("o nome parecido, mas outro (os nomes do PDF diferenciam maiusculas): sai", () => {
    // "#66" e o "f" minusculo: /Embeddedfiles nao e o nome do anexo.
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /#45mbedded#66#69les 6 0 R >> >>\nendobj\n",
      ...RAIZ_E_PAGINA,
    ]);
    expect(preparar(arquivo)).toMatchObject({ tipo: "pdf", paginas: 1 });
  });

  it("o controle: /Names so com /Dests e a anotacao de link: sai", () => {
    const arquivo = pdf([
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /Dests 6 0 R >> >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://exemplo.com.br/anexo) >> >>] >>\nendobj\n",
      "6 0 obj\n<< /Names [(inicio) [3 0 R /Fit]] >>\nendobj\n",
    ]);
    expect(preparar(arquivo)).toMatchObject({ tipo: "pdf", paginas: 1 });
  });
});

// ---------------------------------------------------------------------------
// O lugar escrito por extenso no XMP (terceira rodada: uma cidade tambem e
// localizacao)
// ---------------------------------------------------------------------------

/** O lugar dentro de Iptc4xmpExt:LocationCreated ou LocationShown. */
function estruturaDeLugar(qual: "LocationCreated" | "LocationShown", campos: string): string {
  return `<Iptc4xmpExt:${qual}><rdf:Bag><rdf:li rdf:parseType="Resource">${campos}</rdf:li></rdf:Bag></Iptc4xmpExt:${qual}>`;
}

describe("o lugar escrito por extenso no XMP: o PDF nao sai", () => {
  const casos: [string, string, string][] = [
    ["photoshop:City como atributo", "", ' photoshop:City="Fortaleza"'],
    ["photoshop:State como elemento", "<photoshop:State>Ceará</photoshop:State>", ""],
    ["photoshop:Country", "<photoshop:Country>Brasil</photoshop:Country>", ""],
    ["Iptc4xmpCore:Location", "<Iptc4xmpCore:Location>Rua das Flores, 100</Iptc4xmpCore:Location>", ""],
    ["Iptc4xmpCore:CountryCode", "", " Iptc4xmpCore:CountryCode='BRA'"],
    ["a cidade dentro do LocationCreated", estruturaDeLugar("LocationCreated", "<Iptc4xmpExt:City>Fortaleza</Iptc4xmpExt:City>"), ""],
    ["o sublocal e o estado dentro do LocationShown", estruturaDeLugar("LocationShown", "<Iptc4xmpExt:Sublocation>Meireles</Iptc4xmpExt:Sublocation><Iptc4xmpExt:ProvinceState>CE</Iptc4xmpExt:ProvinceState>"), ""],
    ["o pais como atributo dentro do LocationShown", '<Iptc4xmpExt:LocationShown><rdf:Bag><rdf:li Iptc4xmpExt:CountryName="Brasil"/></rdf:Bag></Iptc4xmpExt:LocationShown>', ""],
    ["o codigo do pais dentro do LocationCreated", estruturaDeLugar("LocationCreated", "<Iptc4xmpExt:CountryCode>BR</Iptc4xmpExt:CountryCode>"), ""],
    ["o nome do local num rdf:Alt", estruturaDeLugar("LocationShown", '<Iptc4xmpExt:LocationName><rdf:Alt><rdf:li xml:lang="x-default">Hospital Exemplo</rdf:li></rdf:Alt></Iptc4xmpExt:LocationName>'), ""],
    ["exif:GPSAreaInformation", "<exif:GPSAreaInformation>Praia de Iracema</exif:GPSAreaInformation>", ""],
  ];
  for (const [nome, elementos, atributos] of casos) {
    it(`${nome}: formato (sem compressao e comprimido)`, () => {
      const xmp = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${elementos}`, atributos));
      expect(preparar(pdfComXmp(xmp))).toEqual(FORA_DO_FORMATO);
      expect(preparar(pdfComXmp(xmp, { comprimido: true }))).toEqual(FORA_DO_FORMATO);
    });
  }

  it("o lugar solto no arquivo, fora de um fluxo de metadados: formato", () => {
    const xmp = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n<photoshop:City>Fortaleza</photoshop:City>`));
    expect(preparar(pdfComXmp(xmp, { dicionario: "", catalogoAponta: false }))).toEqual(
      FORA_DO_FORMATO,
    );
  });

  it("mais de 256 propriedades de lugar, mesmo vazias: na duvida, formato", () => {
    const xmp = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${"<photoshop:City/>\n".repeat(300)}`));
    expect(preparar(pdfComXmp(xmp, { comprimido: true }))).toEqual(FORA_DO_FORMATO);
  });
});

describe("o lugar vazio, ou a chave sem valor: o PDF sai (controle)", () => {
  const VAZIOS = [
    "<photoshop:Country></photoshop:Country>",
    "<photoshop:City/>",
    "<Iptc4xmpCore:Location>   </Iptc4xmpCore:Location>",
    "<Iptc4xmpExt:LocationCreated><rdf:Bag/></Iptc4xmpExt:LocationCreated>",
    estruturaDeLugar(
      "LocationShown",
      '<Iptc4xmpExt:City></Iptc4xmpExt:City><Iptc4xmpExt:Sublocation/><Iptc4xmpExt:LocationName><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></Iptc4xmpExt:LocationName>',
    ),
  ].join("\n");
  const ATRIBUTOS_VAZIOS = ` photoshop:State="" Iptc4xmpCore:CountryCode='  '`;

  it("sem compressao e comprimido: sai com os mesmos bytes", () => {
    for (const comprimido of [false, true]) {
      const arquivo = pdfComXmp(utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${VAZIOS}`, ATRIBUTOS_VAZIOS)), {
        comprimido,
      });
      const preparado = preparar(arquivo);
      expect(preparado, `comprimido: ${comprimido}`).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(preparado.bytes).toEqual(arquivo);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Segunda revisao da d1a15f6: a entrada nunca muda (BAIXO 4), a localizacao
// dentro dos fluxos de objetos (BAIXO 5) e o lugar com qualquer prefixo
// (BAIXO 6)
// ---------------------------------------------------------------------------

describe("BAIXO 4: a limpeza no lugar nunca altera os bytes de quem chama", () => {
  it("o PDF com foto num Buffer (como o readFileSync entrega): a entrada fica igual e a saida sai limpa", () => {
    const { arquivo } = pdfComFoto(fotoComSegredos());
    const entrada = Buffer.from(arquivo);
    const copia = Buffer.from(entrada);
    const preparado = prepararMidia({ midia: "documento", bytes: entrada, mimetype: "application/pdf" });
    expect(preparado.tipo).toBe("pdf");
    expect(entrada.equals(copia)).toBe(true);
    if (preparado.tipo === "pdf") {
      expect(contem(preparado.bytes, "GPS-")).toBe(false);
      expect(preparado.bytes.length).toBe(entrada.length);
    }
  });

  it("o Buffer pequeno (do pool compartilhado, com deslocamento): nem ele nem o vizinho no pool mudam", () => {
    const { arquivo } = pdfComFoto(fotoComSegredos());
    expect(arquivo.length).toBeLessThan(4096);
    const vizinho = Buffer.from("vizinho no pool");
    const entrada = Buffer.from(arquivo);
    const copiaDaEntrada = Buffer.from(entrada);
    const copiaDoVizinho = Buffer.from(vizinho);
    const preparado = prepararMidia({ midia: "documento", bytes: entrada, mimetype: "application/pdf" });
    expect(preparado.tipo).toBe("pdf");
    expect(entrada.equals(copiaDaEntrada)).toBe(true);
    expect(vizinho.equals(copiaDoVizinho)).toBe(true);
    if (preparado.tipo === "pdf") {
      expect(Buffer.from(preparado.bytes.buffer).includes(Buffer.from("GPS-"))).toBe(false);
    }
  });
});

/** Um PDF "de banco" no molde do iText: os objetos num fluxo de objetos, o /Info entre eles. */
function pdfComInfoNoFluxoDeObjetos(info: string): Uint8Array {
  return pdf(
    [
      fluxoDeObjetos(9, [
        [1, "<< /Type /Catalog /Pages 2 0 R >>"],
        [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
        [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"],
        [4, info],
      ]),
    ],
    "<< /Root 1 0 R /Info 4 0 R >>",
  );
}

describe("BAIXO 5: o GPS e o lugar dentro do fluxo de objetos tambem deixam o PDF de fora", () => {
  const casos: [string, string][] = [
    ["revisao: /GPSLatitude e /City no /Info", "<< /Producer (app de digitalizacao) /GPSLatitude (3.7319 S) /GPSLongitude (38.5267 W) /City (Fortaleza) >>"],
    ["so a /City", "<< /Producer (x) /City (Fortaleza) >>"],
    ["outra chave /GPS... (/GPSAltitude)", "<< /Producer (x) /GPSAltitude (12) >>"],
    ["a /City em hexadecimal (UTF-16)", "<< /City <FEFF0046006F007200740061006C657A0061> >>"],
    ["a /City escrita com #xx", "<< /Ci#74y (Fortaleza) >>"],
    ["o lugar do XMP numa string do fluxo de objetos", "<< /Nota (<ns2:City>Fortaleza</ns2:City>) >>"],
    ["o exif:GPS numa string do fluxo de objetos", "<< /Nota (exif:GPSLatitude=\"3,43.914S\") >>"],
  ];
  for (const [nome, info] of casos) {
    it(`${nome}: formato`, () => {
      expect(preparar(pdfComInfoNoFluxoDeObjetos(info))).toEqual(FORA_DO_FORMATO);
    });
  }

  it("o /Info no arquivo sem compressao tambem: formato", () => {
    const arquivo = pdf([...arvore(1), "9 0 obj\n<< /Producer (x) /City (Fortaleza) >>\nendobj\n"]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("a chave vazia, o null, o nome parecido e a palavra numa string nao contam: sai", () => {
    for (const info of [
      "<< /Producer (iText 7.2.5) /City () >>",
      "<< /City (   ) /GPSAltitude <> >>",
      "<< /City <FEFF> >>",
      "<< /City null >>",
      "<< /Cityscape (Praia) /Producer (City of God) /Title (Location) >>",
    ]) {
      const preparado = preparar(pdfComInfoNoFluxoDeObjetos(info));
      expect(preparado, info).toMatchObject({ tipo: "pdf", paginas: 1 });
    }
  });
});

describe("BAIXO 6: o lugar por extenso com qualquer prefixo", () => {
  it("revisao: ns2: no namespace do photoshop:, como atributo: formato", () => {
    const xmp = pacoteXmp(
      XMP_SEM_LOCAL,
      ' xmlns:ns2="http://ns.adobe.com/photoshop/1.0/" ns2:City="Fortaleza" ns2:State="CE"',
    );
    expect(preparar(pdfComXmp(utf8(xmp), { comprimido: true }))).toEqual(FORA_DO_FORMATO);
  });

  const NOMES = [
    "City",
    "State",
    "Country",
    "CountryCode",
    "CountryName",
    "ProvinceState",
    "Sublocation",
    "Location",
    "LocationName",
    "WorldRegion",
  ];
  for (const nome of NOMES) {
    it(`${nome} com outro prefixo (atributo e elemento) e sem prefixo (elemento): formato`, () => {
      for (const [elementos, atributos] of [
        ["", ` xmlns:pfx="http://exemplo/" pfx:${nome}='Fortaleza'`],
        [`<ns9:${nome}>Fortaleza</ns9:${nome}>`, ""],
        [`<${nome} xmlns="http://ns.adobe.com/photoshop/1.0/">Fortaleza</${nome}>`, ""],
      ] as const) {
        const xmp = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${elementos}`, atributos));
        expect(preparar(pdfComXmp(xmp)), `${nome}: ${elementos}${atributos}`).toEqual(FORA_DO_FORMATO);
        expect(preparar(pdfComXmp(xmp, { comprimido: true })), `${nome} comprimido`).toEqual(FORA_DO_FORMATO);
      }
    });
  }

  it("o valor vazio, a chave sem valor, o fechamento sozinho e o nome mais longo nao contam: sai", () => {
    const vazios = [
      "<ns2:City></ns2:City>",
      "<ns2:State/>",
      "<Country>  </Country>",
      "</ns2:Location>",
      "<ns2:CityCode>Fortaleza</ns2:CityCode>",
      "<ns2:MyCity>Fortaleza</ns2:MyCity>",
      "<dc:subject><rdf:Bag><rdf:li>City tour, State fair</rdf:li></rdf:Bag></dc:subject>",
    ].join("\n");
    const atributos = ' xmlns:ns2="http://ns.adobe.com/photoshop/1.0/" ns2:City="" ns2:State=\'  \' ns2:Citizen="x"';
    for (const comprimido of [false, true]) {
      const arquivo = pdfComXmp(utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${vazios}`, atributos)), { comprimido });
      const preparado = preparar(arquivo);
      expect(preparado, `comprimido: ${comprimido}`).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(preparado.bytes).toEqual(arquivo);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Terceira rodada (revisao RR2 da 88e9560): o lugar que escapava (o CDATA,
// os nomes fora da lista, a coordenada fora do photoshop: e do xmp:, as
// chaves do /Info) e o objeto que o leitor acha e esta leitura nao via
// ---------------------------------------------------------------------------

/** Os namespaces que o pacoteXmp nao declara (so para o XMP ficar como o de verdade). */
const OUTROS_NAMESPACES =
  ' xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/" xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/"';

describe("RR2: o lugar no CDATA, com os nomes novos e a coordenada em qualquer propriedade", () => {
  const casos: [string, string, string][] = [
    ["o CDATA no elemento", "<photoshop:City><![CDATA[Fortaleza]]></photoshop:City>", ""],
    [
      "o CDATA no rdf:Alt do nome do local",
      estruturaDeLugar(
        "LocationShown",
        '<Iptc4xmpExt:LocationName><rdf:Alt><rdf:li xml:lang="x-default"><![CDATA[Hospital Exemplo]]></rdf:li></rdf:Alt></Iptc4xmpExt:LocationName>',
      ),
      "",
    ],
    ["o CDATA sem o fim (na duvida, e lugar)", "<photoshop:City><![CDATA[   </photoshop:City>", ""],
    ["o endereco do contato do autor", '<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiAdrExtadr="Rua das Flores, 123"/>', ""],
    ["a cidade do contato do autor", '<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiAdrCity="Fortaleza"/>', ""],
    ["o estado do contato do autor", "<Iptc4xmpCore:CreatorContactInfo><Iptc4xmpCore:CiAdrRegion>CE</Iptc4xmpCore:CiAdrRegion></Iptc4xmpCore:CreatorContactInfo>", ""],
    ["o CEP do contato do autor", '<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiAdrPcode="60000-000"/>', ""],
    ["o pais do contato do autor", '<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiAdrCtry="Brasil"/>', ""],
    ["o lugar da filmagem (xmpDM:shotLocation)", "<xmpDM:shotLocation>Rua das Flores, 123, Fortaleza</xmpDM:shotLocation>", OUTROS_NAMESPACES],
    ["a abrangencia do Dublin Core (dc:coverage)", "<dc:coverage>Fortaleza, CE</dc:coverage>", ""],
    ["a coordenada com virgula decimal no xmp:Label", "", ' xmp:Label="-3,731900; -38,526700"'],
    [
      "a coordenada no dc:description (rdf:Alt)",
      '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">-3.731900, -38.526700</rdf:li></rdf:Alt></dc:description>',
      "",
    ],
    ["a coordenada com o hemisferio e a virgula num prefixo qualquer", "<pdfx:Local>3,7319 S 38,5267 O</pdfx:Local>", OUTROS_NAMESPACES],
    [
      "graus, minutos e segundos com a virgula decimal no titulo",
      `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">3°43'54,8"S</rdf:li></rdf:Alt></dc:title>`,
      "",
    ],
    ["a coordenada no CDATA", "<xmp:Nickname><![CDATA[-3.731900, -38.526700]]></xmp:Nickname>", ""],
  ];
  for (const [nome, elementos, atributos] of casos) {
    it(`${nome}: formato (sem compressao e comprimido)`, () => {
      const xmp = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${elementos}`, atributos));
      expect(preparar(pdfComXmp(xmp))).toEqual(FORA_DO_FORMATO);
      expect(preparar(pdfComXmp(xmp, { comprimido: true }))).toEqual(FORA_DO_FORMATO);
    });
  }

  it("o CDATA vazio ou so de brancos, os nomes novos vazios e os numeros que nao sao coordenada nao contam: sai", () => {
    const vazios = [
      "<photoshop:City><![CDATA[]]></photoshop:City>",
      "<photoshop:State><![CDATA[  \n ]]></photoshop:State>",
      '<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiAdrCity="" Iptc4xmpCore:CiAdrCtry=" "/>',
      "<xmpDM:shotLocation/>",
      "<dc:coverage></dc:coverage>",
      "<ns2:coverageNote>Fortaleza</ns2:coverageNote>",
      "<ns2:CiAdrCityX>Fortaleza</ns2:CiAdrCityX>",
      '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Pedido 1.234, 2 vias, R$ 1.234,56, versao 2.10</rdf:li></rdf:Alt></dc:description>',
    ].join("\n");
    for (const comprimido of [false, true]) {
      const arquivo = pdfComXmp(utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${vazios}`, OUTROS_NAMESPACES)), { comprimido });
      const preparado = preparar(arquivo);
      expect(preparado, `comprimido: ${comprimido}`).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(preparado.bytes).toEqual(arquivo);
      }
    }
  });
});

describe("RR2: o lugar no /Info e na assinatura", () => {
  const casos: [string, string][] = [
    ["/Location", "<< /Producer (x) /Location (Rua das Flores, 123, Fortaleza) >>"],
    ["/Country e /State", "<< /Producer (x) /Country (Brasil) /State (CE) >>"],
    ["/Latitude e /Longitude", "<< /Producer (x) /Latitude (-3.731900) /Longitude (-38.526700) >>"],
    ["/Location escrita com #xx", "<< /Producer (x) /Lo#63ation (Fortaleza) >>"],
    ["/State em hexadecimal (UTF-16)", "<< /State <FEFF00430045> >>"],
  ];
  for (const [nome, info] of casos) {
    it(`${nome}, no arquivo e no fluxo de objetos: formato`, () => {
      expect(preparar(pdf([...arvore(1), `9 0 obj\n${info}\nendobj\n`]))).toEqual(FORA_DO_FORMATO);
      expect(preparar(pdfComInfoNoFluxoDeObjetos(info))).toEqual(FORA_DO_FORMATO);
    });
  }

  it("o /Location da assinatura (/Type /Sig): formato", () => {
    const assinatura =
      "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (Fulano) /Location (Fortaleza, CE) /Reason (Assinado) /M (D:20261030100000-03'00') /Contents <00> /ByteRange [0 0 0 0] >>";
    expect(preparar(pdf([...arvore(1), `9 0 obj\n${assinatura}\nendobj\n`]))).toEqual(FORA_DO_FORMATO);
  });

  it("o valor vazio, o null e os nomes parecidos (ou o nome numa string) nao contam: sai", () => {
    for (const info of [
      "<< /Location () /State null /Country <FEFF> /Latitude ( ) >>",
      "<< /Statement (x) /Locations (y) /Longitudes (z) >>",
      "<< /Title (Location, State, Country) /Subject (Latitude e Longitude) >>",
    ]) {
      expect(preparar(pdfComInfoNoFluxoDeObjetos(info)), info).toMatchObject({ tipo: "pdf", paginas: 1 });
      expect(preparar(pdf([...arvore(1), `9 0 obj\n${info}\nendobj\n`])), info).toMatchObject({ tipo: "pdf", paginas: 1 });
    }
  });
});

describe("RR2: o objeto que o leitor acha (pela xref) e esta leitura nao via", () => {
  /** O PDF com a foto com segredos no objeto 9, com o cabecalho dado. */
  function pdfComFotoECabecalho(cabecalho: string): Uint8Array {
    const foto = fotoComSegredos();
    return pdf([
      ...arvore(1),
      juntar(
        texto(
          `${cabecalho}\n<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${foto.length} >>\nstream\n`,
        ),
        foto,
        texto("\nendstream\nendobj\n"),
      ),
    ]);
  }

  it("o controle: o cabecalho comum, e a foto sai limpa", () => {
    const preparado = preparar(pdfComFotoECabecalho("9 0 obj"));
    expect(preparado).toMatchObject({ tipo: "pdf", paginas: 1 });
    if (preparado.tipo === "pdf") {
      expect(contem(preparado.bytes, "GPS-")).toBe(false);
    }
  });

  it("revisao: o comentario entre as partes do cabecalho (a especificacao conta como branco): formato", () => {
    for (const cabecalho of ["9 0 %x\nobj", "9 %x\n0 obj", "9%x\r0%y\robj", "9 \n% um\n% dois\n0 obj"]) {
      expect(preparar(pdfComFotoECabecalho(cabecalho)), JSON.stringify(cabecalho)).toEqual(FORA_DO_FORMATO);
    }
  });

  it("o objeto sem fluxo com comentario no cabecalho (o catalogo escondido): formato", () => {
    const arquivo = pdf([
      "1 0 %x\nobj\n<< /Type /Catalog /Pages 2 0 R /Metadata 20 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n",
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("revisao: 33 brancos ou mais entre as partes, e a geracao com 6 digitos: a foto e lida e limpa", () => {
    for (const cabecalho of [`9${" ".repeat(33)}0 obj`, `9 0${"\n".repeat(40)}obj`, "9 000000 obj"]) {
      const preparado = preparar(pdfComFotoECabecalho(cabecalho));
      expect(preparado, JSON.stringify(cabecalho)).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(contem(preparado.bytes, "GPS-"), JSON.stringify(cabecalho)).toBe(false);
      }
    }
  });

  it("o fluxo que esta leitura nao reconhece (a marca 'endstream' que sobra): formato", () => {
    // "9 0obj" (sem o branco antes do obj): o leitor tolerante le o objeto;
    // esta leitura nao, e o "endstream" dele sobra.
    expect(preparar(pdfComFotoECabecalho("9 0obj"))).toEqual(FORA_DO_FORMATO);
    // A marca solta, fora de qualquer fluxo, tambem.
    expect(preparar(pdf([...arvore(1), "9 0 obj\n<< /A 1 >>\nendobj\nendstream\n"]))).toEqual(FORA_DO_FORMATO);
  });

  /** A foto num objeto dentro dos dados de outro fluxo, com "stream" escrito como dado. */
  function fotoDentroDeOutroFluxo(palavra: string): Uint8Array {
    const foto = fotoComSegredos();
    const dentro = juntar(
      texto(`20 0 obj << /Type /XObject /Subtype /Image /Filter /DCTDecode /Length ${foto.length} >> ${palavra}`),
      foto,
      texto("\nendstream\nendobj\n"),
    );
    return pdf([...arvore(1), juntar(texto(`9 0 obj\n<< /Length ${dentro.length} >>\nstream\n`), dentro, texto("endobj\n"))]);
  }

  it("revisao: 'stream%x' (sem o fim de linha) num objeto dentro de outro fluxo: formato", () => {
    for (const palavra of ["stream%x\n", "stream \0\n", "stream/x\n"]) {
      expect(preparar(fotoDentroDeOutroFluxo(palavra)), JSON.stringify(palavra)).toEqual(FORA_DO_FORMATO);
    }
  });

  it("o dicionario malformado num objeto dentro de outro fluxo: formato", () => {
    const arquivo = pdf([...arvore(1), fluxoComDados("xx 20 0 obj << /Filter /DCTDecode /A >> stream\nab\nyy")]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("os comentarios de sempre (a marca binaria, o %%EOF da atualizacao incremental, a porcentagem numa string, a linha solta) nao atrapalham: sai igual", () => {
    const arquivo = juntar(
      texto("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"),
      ...arvore(1).map(texto),
      texto("4 0 obj\n<< /Producer (100% digital) /Title (50%)\n>>\nendobj\n"),
      texto("% um comentario solto\n5 0 obj\n<< /A 1 >>\nendobj\n"),
      texto("trailer\n<< /Root 1 0 R >>\nstartxref\n12345\n%%EOF\n"),
      texto("6 0 obj\n<< /B 2 >>\nendobj\n7 0 obj << /C 3 >> endobj\ntrailer\n<< /Root 1 0 R /Prev 12345 >>\nstartxref\n23456\n%%EOF\n"),
    );
    const preparado = preparar(arquivo);
    expect(preparado).toMatchObject({ tipo: "pdf", paginas: 1 });
    if (preparado.tipo === "pdf") {
      expect(preparado.bytes).toEqual(arquivo);
    }
  });
});

/** Um fluxo sem filtro com os dados dados (o objeto 9). */
function fluxoComDados(dados: string): string {
  return `9 0 obj\n<< /Length ${dados.length} >>\nstream\n${dados}\nendstream\nendobj\n`;
}

// ---------------------------------------------------------------------------
// Checagem rev4: a coordenada escrita nos VALORES do /Info (nao so nas chaves)
// ---------------------------------------------------------------------------

/** O texto em hexadecimal (um byte por caractere latin1). */
const emHexadecimal = (t: string) => Buffer.from(t, "latin1").toString("hex");
/** O texto em UTF-16BE, em hexadecimal (o que vem depois da marca FEFF). */
const emUtf16 = (t: string) => Buffer.from(t, "utf16le").swap16().toString("hex");

describe("rev4: a coordenada nos valores do /Info", () => {
  /** O PDF com o /Info (objeto 9) no arquivo, apontado pelo trailer. */
  function pdfComInfo(info: string, trailer = "<< /Root 1 0 R /Info 9 0 R >>"): Uint8Array {
    return pdf([...arvore(1), `9 0 obj\n${info}\nendobj\n`], trailer);
  }

  const casos: [string, string][] = [
    ["revisao: o /Keywords com o par decimal", "<< /Keywords (-3.731900, -38.526700) >>"],
    ["revisao: o /Subject com os rotulos de latitude e longitude", "<< /Subject (Lat -3.7319 Lon -38.5267) >>"],
    ["revisao: o /Title com graus, minutos e segundos", "<< /Title (Foto em 3\xb043'54\"S 38\xb031'36\"W) >>"],
    ["a virgula decimal com o hemisferio", "<< /Subject (3,7319 S; 38,5267 O) >>"],
    ["o par em hexadecimal", `<< /Keywords <${emHexadecimal("-3.731900, -38.526700")}> >>`],
    ["o par em UTF-16 (a marca FEFF)", `<< /Title <FEFF${emUtf16("-3.731900, -38.526700")}> >>`],
    ["o sinal em octal (\\055) e a virgula com a barra", "<< /Keywords (\\0553.731900\\, \\05538.526700) >>"],
    ["os rotulos por extenso numa chave propria", "<< /Coordenadas (latitude: -3,7319 longitude: -38,5267) >>"],
    ["os numeros soltos numa lista de chave propria", "<< /Ponto [-3.731900 -38.526700] >>"],
  ];
  for (const [nome, info] of casos) {
    it(`${nome}: formato (no arquivo e no fluxo de objetos)`, () => {
      expect(preparar(pdfComInfo(info))).toEqual(FORA_DO_FORMATO);
      expect(preparar(pdfComInfoNoFluxoDeObjetos(info))).toEqual(FORA_DO_FORMATO);
    });
  }

  it("a chave /Info escrita com #xx, e o /Info direto no trailer: formato", () => {
    const info = "<< /Keywords (-3.731900, -38.526700) >>";
    expect(preparar(pdfComInfo(info, "<< /Root 1 0 R /In#66o 9 0 R >>"))).toEqual(FORA_DO_FORMATO);
    expect(preparar(pdf(arvore(1), `<< /Root 1 0 R /Info ${info} >>`))).toEqual(FORA_DO_FORMATO);
  });

  it("o /Info apontado que esta leitura nao acha (o leitor tolerante acha \"9 0obj\"): formato", () => {
    const arquivo = pdf(
      [...arvore(1), "9 0obj\n<< /Keywords (-3.731900, -38.526700) >>\nendobj\n"],
      "<< /Root 1 0 R /Info 9 0 R >>",
    );
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("os numeros que nao sao coordenada (titulo, versao, valores, datas, programa, dose): sai igual", () => {
    for (const info of [
      "<< /Title (Or\xe7amento 2026, item 3.5) /Subject (Vers\xe3o 1.2) >>",
      "<< /Title (Pedido 1.234, 2 vias, R$ 1.234,56) /Keywords (exame; hemograma; 12/10/2026) >>",
      "<< /Producer (iText\xae 7.2.5 \xa92000-2023 Apryse) /Creator (Microsoft\xae Word para Microsoft 365) >>",
      "<< /CreationDate (D:20261030123456-03'00') /ModDate (D:20261030123510-03'00') >>",
      `<< /Title <FEFF${emUtf16("Laudo 3.5 mg, dose 1.250 mg/dia")}> /Author (Dra. Fulana) >>`,
      "<< /Subject (Translation 1.2345 e plateau 3.4567) /Title (Sala 2\xb0 andar) >>",
    ]) {
      const arquivo = pdfComInfo(info);
      const preparado = preparar(arquivo);
      expect(preparado, info).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(preparado.bytes).toEqual(arquivo);
      }
      expect(preparar(pdfComInfoNoFluxoDeObjetos(info)), info).toMatchObject({ tipo: "pdf", paginas: 1 });
    }
  });
});

// ---------------------------------------------------------------------------
// Checagem rev4: o pacote XMP num fluxo que nao se diz metadado (sem /Type
// /Metadata, sem /Subtype /XML, sem /Metadata apontando)
// ---------------------------------------------------------------------------

describe("rev4: o pacote XMP num fluxo que nao se diz metadado", () => {
  /** O PDF com o fluxo 20 (o dicionario e os dados dados), que nada aponta como /Metadata. */
  function pdfComFluxo(dicionario: string, dados: Uint8Array): Uint8Array {
    return pdf([
      ...arvore(1),
      juntar(
        texto(`20 0 obj\n<< ${dicionario}/Length ${dados.length} >>\nstream\n`),
        dados,
        texto("\nendstream\nendobj\n"),
      ),
    ]);
  }
  const DESCRICAO_COM_COORDENADA =
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">-3.731900, -38.526700</rdf:li></rdf:Alt></dc:description>';
  const COM_COORDENADA = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n${DESCRICAO_COM_COORDENADA}`));
  const COM_GPS = utf8(pacoteXmp(`${XMP_SEM_LOCAL}\n<exif:GPSLatitude>3,43.914S</exif:GPSLatitude>`));
  const SEM_LUGAR = utf8(pacoteXmp(XMP_SEM_LOCAL));

  it("revisao: sem compressao e sem /Type nem /Subtype, com a coordenada: formato", () => {
    expect(preparar(pdfComFluxo("", COM_COORDENADA))).toEqual(FORA_DO_FORMATO);
  });

  it("revisao: comprimido (FlateDecode) e sem /Type, com exif:GPSLatitude: formato", () => {
    expect(preparar(pdfComFluxo("/Filter /FlateDecode ", comprimir(COM_GPS)))).toEqual(FORA_DO_FORMATO);
  });

  it("comprimido com a coordenada, com outro tipo (/XObject /Image) e em UTF-16: formato", () => {
    expect(preparar(pdfComFluxo("/Filter /FlateDecode ", comprimir(COM_COORDENADA)))).toEqual(FORA_DO_FORMATO);
    expect(
      preparar(pdfComFluxo("/Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /FlateDecode ", comprimir(COM_GPS))),
    ).toEqual(FORA_DO_FORMATO);
    const utf16 = Uint8Array.from(
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(pacoteXmp(`${XMP_SEM_LOCAL}\n${DESCRICAO_COM_COORDENADA}`), "utf16le"),
      ]),
    );
    expect(preparar(pdfComFluxo("", utf16))).toEqual(FORA_DO_FORMATO);
    expect(preparar(pdfComFluxo("/Filter /FlateDecode ", comprimir(utf16)))).toEqual(FORA_DO_FORMATO);
  });

  it("o pacote numa string de um objeto do fluxo de objetos: formato", () => {
    const xmp = pacoteXmp(`${XMP_SEM_LOCAL}\n${DESCRICAO_COM_COORDENADA}`).replace(/﻿/g, "");
    const arquivo = pdf([
      fluxoDeObjetos(9, [
        [1, "<< /Type /Catalog /Pages 2 0 R >>"],
        [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
        [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"],
        [5, `<< /Nota <${Buffer.from(xmp, "latin1").toString("hex")}> /Copia (${xmp}) >>`],
      ]),
    ]);
    expect(preparar(arquivo)).toEqual(FORA_DO_FORMATO);
  });

  it("a marca visivel num fluxo com filtro que nao da para ler (LZW, cadeia, FlateDecode que nao descomprime) ou com preditor: formato", () => {
    for (const filtro of ["/Filter /LZWDecode ", "/Filter [/FlateDecode /ASCIIHexDecode] ", "/Filter /FlateDecode "]) {
      expect(preparar(pdfComFluxo(filtro, SEM_LUGAR)), filtro).toEqual(FORA_DO_FORMATO);
    }
    expect(
      preparar(pdfComFluxo("/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> ", comprimir(SEM_LUGAR))),
    ).toEqual(FORA_DO_FORMATO);
  });

  it("o controle: o conteudo e a imagem comuns (FlateDecode), o XMP sem lugar sem tipo e o \"<?xml\" que nao e XMP: saem iguais", () => {
    const conteudo = comprimir(texto("q 1 0 0 1 72 720 cm BT /F1 12 Tf (Receita: dipirona 500 mg) Tj ET Q\n".repeat(200)));
    const imagem = comprimir(new Uint8Array(64 * 64 * 3).fill(0xff));
    const casos: [string, Uint8Array][] = [
      ["/Filter /FlateDecode ", conteudo],
      ["/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ", imagem],
      ["/Filter /FlateDecode ", comprimir(SEM_LUGAR)],
      ["", SEM_LUGAR],
      ["/Filter /FlateDecode ", comprimir(texto('<?xml version="1.0"?><svg width="10" height="2.5"/>'))],
    ];
    for (const [dicionario, dados] of casos) {
      const arquivo = pdfComFluxo(dicionario, dados);
      const preparado = preparar(arquivo);
      expect(preparado, dicionario).toMatchObject({ tipo: "pdf", paginas: 1 });
      if (preparado.tipo === "pdf") {
        expect(preparado.bytes).toEqual(arquivo);
      }
    }
  });
});
