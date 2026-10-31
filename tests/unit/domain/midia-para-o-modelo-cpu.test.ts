import { deflateSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import {
  LIMITES_DA_MIDIA,
  MOTIVOS_DE_FORA,
  paginasDoPdf,
  prepararMidia,
  semEtiquetasId3,
  type MidiaDaMensagem,
  type MidiaPreparada,
} from "@/lib/domain/midia-para-o-modelo";

// A CPU do preparo (segunda revisao da d1a15f6): o preparo e SINCRONO e o
// corte do motor nao interrompe CPU, entao todo arquivo ate o tamanho
// maximo tem de terminar depressa, e o que passa do orcamento de trabalho
// vira "bomba". Aqui: as entradas da revisao (as expressoes do XMP que
// voltavam atras, as listas /Kids e os /Count indiretos sem orcamento, as
// fotos /DCTDecode aninhadas, o MP3 andado byte a byte) e um "fuzz"
// DETERMINISTICO (semente fixa) com geradores de PDF, JPEG, MP3, PNG e WebP
// maliciosos e mutacoes de arquivos validos. Cada caso termina em menos de
// 1,5 s (folga para maquina lenta; o pior medido num Apple M3, com a maquina
// ocupada, ficou em 0,17 s). Fixtures SINTETICAS, nenhum arquivo de paciente.

const MB = 1024 * 1024;
const PRAZO_MS = 1500;

const texto = (t: string) => Uint8Array.from(Buffer.from(t, "latin1"));
const bytes = (...b: number[]) => Uint8Array.from(b);
const juntar = (...partes: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(partes.map((p) => Buffer.from(p))));
const comprimir = (b: Uint8Array) => Uint8Array.from(deflateSync(Buffer.from(b)));
/** O padrao repetido `vezes` vezes (o Buffer.fill repete sem laco em JS). */
const repetido = (padrao: Uint8Array, vezes: number) =>
  Uint8Array.from(Buffer.alloc(padrao.length * vezes).fill(Buffer.from(padrao)));

/** Gerador pseudoaleatorio com semente (mulberry32): o mesmo fuzz em toda rodada. */
function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIMETYPE: Record<"pdf" | "jpeg" | "mp3" | "png" | "webp", [MidiaDaMensagem, string]> = {
  pdf: ["documento", "application/pdf"],
  jpeg: ["imagem", "image/jpeg"],
  mp3: ["audio", "audio/mpeg"],
  png: ["imagem", "image/png"],
  webp: ["imagem", "image/webp"],
};

/** O pior tempo de todos os casos deste arquivo (impresso no fim). */
const pior = { ms: 0, caso: "" };

function cronometrar(
  caso: string,
  formato: keyof typeof MIMETYPE,
  arquivo: Uint8Array,
): { resultado: MidiaPreparada; ms: number } {
  const [midia, mimetype] = MIMETYPE[formato];
  const inicio = performance.now();
  const resultado = prepararMidia({ midia, bytes: arquivo, mimetype });
  const ms = performance.now() - inicio;
  if (ms > pior.ms) {
    pior.ms = ms;
    pior.caso = caso;
  }
  return { resultado, ms };
}

/** O resultado e um dos formatos do contrato (nunca excecao, nunca motivo fora da lista). */
function resultadoValido(resultado: MidiaPreparada): boolean {
  switch (resultado.tipo) {
    case "fora":
      return (MOTIVOS_DE_FORA as readonly string[]).includes(resultado.motivo);
    case "figurinha":
      return true;
    default:
      return resultado.bytes instanceof Uint8Array;
  }
}

afterAll(() => {
  console.log(`[midia-para-o-modelo-cpu] pior tempo: ${pior.ms.toFixed(1)} ms (${pior.caso})`);
});

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

/** O PDF com os objetos (texto ou bytes) numerados a partir de 1, a xref e o trailer. */
function pdf(objetos: (string | Uint8Array)[]): Uint8Array {
  const partes: Uint8Array[] = [texto("%PDF-1.7\n")];
  let posicao = partes[0]?.length ?? 0;
  const deslocamentos: number[] = [];
  objetos.forEach((objeto, i) => {
    deslocamentos.push(posicao);
    const b = juntar(
      texto(`${i + 1} 0 obj\n`),
      typeof objeto === "string" ? texto(objeto) : objeto,
      texto("\nendobj\n"),
    );
    partes.push(b);
    posicao += b.length;
  });
  const xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${deslocamentos
    .map((d) => `${String(d).padStart(10, "0")} 00000 n \n`)
    .join("")}`;
  partes.push(
    texto(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${posicao}\n%%EOF\n`),
  );
  return juntar(...partes);
}

function fluxo(dicionario: string, dados: Uint8Array | string): Uint8Array {
  const d = typeof dados === "string" ? texto(dados) : dados;
  return juntar(texto(`<< ${dicionario} /Length ${d.length} >>\nstream\n`), d, texto("\nendstream"));
}

const CATALOGO = "<< /Type /Catalog /Pages 2 0 R >>";
const RAIZ = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
const PAGINA = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>";

/** O PDF de uma pagina com o XMP (o catalogo aponta para ele). */
function pdfComXmp(xmp: string, comprimido = false): Uint8Array {
  const dados = texto(xmp);
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>",
    RAIZ,
    PAGINA,
    fluxo(
      `/Type /Metadata /Subtype /XML${comprimido ? " /Filter /FlateDecode" : ""}`,
      comprimido ? comprimir(dados) : dados,
    ),
  ]);
}

/** O PDF de uma pagina com um texto solto, sem compressao, num fluxo qualquer. */
function pdfComTextoSolto(solto: string): Uint8Array {
  return pdf([CATALOGO, RAIZ, PAGINA, fluxo("", solto)]);
}

/** O PDF de uma pagina com um fluxo de objetos que traz o corpo como objeto 9. */
function pdfComObjStm(corpo: string): Uint8Array {
  const cabecalho = "9 0 ";
  return pdf([
    CATALOGO,
    RAIZ,
    PAGINA,
    fluxo(
      `/Type /ObjStm /N 1 /First ${cabecalho.length} /Filter /FlateDecode`,
      comprimir(texto(cabecalho + corpo)),
    ),
  ]);
}

/** N objetos de um fluxo de objetos apontando para o MESMO dicionario (o texto lido N vezes). */
function pdfObjStmMesmoDicionario(n: number, dicionario: string): Uint8Array {
  const cabecalho = `${Array.from({ length: n }, (_, i) => `${100 + i} 0`).join(" ")} `;
  return pdf([
    CATALOGO,
    RAIZ,
    PAGINA,
    fluxo(
      `/Type /ObjStm /N ${n} /First ${cabecalho.length} /Filter /FlateDecode`,
      comprimir(texto(cabecalho + dicionario)),
    ),
  ]);
}

/** A lista /Kids indireta de `referencias` filhos, apontada por `nos` nos /Pages (revisao). */
function pdfKids(nos: number, referencias: number): Uint8Array {
  const objetos = ["<</Type/Catalog/Pages 3 0 R>>", `[${"1 0 R ".repeat(referencias)}]`];
  for (let i = 0; i < nos; i += 1) {
    objetos.push("<</Type/Pages/Kids 2 0 R/Count 1>>");
  }
  return pdf(objetos);
}

/** O mesmo no /Pages e o mesmo /Count indireto em `versoes` versoes (revisao). */
function pdfVersoes(versoes: number): Uint8Array {
  const partes = ["%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n"];
  for (let i = 0; i < versoes; i += 1) {
    partes.push("5 0 obj 1 endobj\n");
  }
  for (let i = 0; i < versoes; i += 1) {
    partes.push("2 0 obj <</Type/Pages/Count 5 0 R>> endobj\n");
  }
  partes.push("trailer <</Root 1 0 R>>\n%%EOF\n");
  return texto(partes.join(""));
}

/** K versoes aninhadas do mesmo no /Pages: a lista /Kids de cada uma vai ate o fim (todas leem as mesmas referencias). */
function pdfVersoesAninhadas(versoes: number, referencias: number): Uint8Array {
  const abre = "2 0 obj << /Type /Pages /Count 1 /Kids [ ".repeat(versoes);
  const fecha = " ] >>".repeat(versoes);
  return texto(
    `%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n${abre}${"1 0 R ".repeat(referencias)}${fecha}\nendobj\ntrailer <</Root 1 0 R>>\n%%EOF\n`,
  );
}

const SOF0 = bytes(0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00);
const SOS = bytes(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
const DQT = juntar(bytes(0xff, 0xdb, 0x00, 0x43, 0x00), new Uint8Array(64).fill(1));

/** As fotos /DCTDecode aninhadas (o cabecalho de cada uma no DQT da anterior), todas na mesma varredura (revisao). */
function pdfFotosAninhadas(niveis: number, bytesDaVarredura: number): Uint8Array {
  let carga: Uint8Array = new Uint8Array(64).fill(1);
  let prefixo: Uint8Array = new Uint8Array(0);
  for (let n = niveis; n >= 1; n -= 1) {
    const dqt = bytes(0xff, 0xdb, ((carga.length + 2) >> 8) & 0xff, (carga.length + 2) & 0xff);
    prefixo = juntar(bytes(0xff, 0xd8), SOF0, dqt, carga);
    if (n > 1) {
      carga = juntar(
        texto(`\n${n + 10} 0 obj <</Type/XObject/Subtype/Image/Filter/DCTDecode>>stream\n`),
        prefixo,
      );
    }
  }
  const dados = new Uint8Array(bytesDaVarredura);
  for (let i = 0; i < dados.length; i += 2) {
    dados[i] = 0xff;
  }
  const foto = juntar(prefixo, SOS, dados, bytes(0xff, 0xd9));
  return juntar(
    texto(
      "%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R>> endobj\n",
    ),
    texto(`11 0 obj <</Type/XObject/Subtype/Image/Filter/DCTDecode/Length ${foto.length}>>stream\n`),
    foto,
    texto("\nendstream endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n"),
  );
}

/** O JPEG com a varredura so de FF00 (cada 0xFF dos dados e uma volta). */
function jpegFf00(tamanho: number): Uint8Array {
  const dados = new Uint8Array(tamanho - 200);
  for (let i = 0; i < dados.length; i += 2) {
    dados[i] = 0xff;
  }
  return juntar(bytes(0xff, 0xd8), DQT, SOF0, SOS, dados, bytes(0xff, 0xd9));
}

/** Um quadro MPEG-1 Layer III, 128 kbps, 44,1 kHz (417 bytes). */
const QUADRO_417 = (() => {
  const q = new Uint8Array(417);
  q.set([0xff, 0xfb, 0x90, 0x00]);
  return q;
})();

/** O menor quadro (MPEG-2.5 Layer III, 8 kbps, 12 kHz: 48 bytes), repetido. */
function mp3QuadrosMinimos(tamanho: number): Uint8Array {
  const quadro = new Uint8Array(48);
  quadro.set([0xff, 0xe2, 0x14, 0x00]);
  return repetido(quadro, Math.floor(tamanho / 48));
}

/** O PNG com o IHDR, `quantos` pedacos vazios do tipo e o IEND (ou o que cabe no tamanho). */
function pngPedacos(tamanho: number, tipo: string, quantos = Math.floor((tamanho - 100) / 12)): Uint8Array {
  const ihdr = juntar(bytes(0, 0, 0, 13), texto("IHDR"), new Uint8Array(17));
  const pedaco = juntar(bytes(0, 0, 0, 0), texto(tipo), bytes(0, 0, 0, 0));
  return juntar(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ihdr,
    repetido(pedaco, quantos),
    juntar(bytes(0, 0, 0, 0), texto("IEND"), bytes(0, 0, 0, 0)),
  );
}

/** O WebP com um VP8L e `quantos` pedacos vazios do tipo (ou o que cabe no tamanho). */
function webpPedacos(tamanho: number, tipo: string, quantos = Math.floor((tamanho - 100) / 8)): Uint8Array {
  const corpo = repetido(juntar(texto(tipo), bytes(0, 0, 0, 0)), quantos);
  const riff = juntar(
    texto("RIFF"),
    bytes(0, 0, 0, 0),
    texto("WEBP"),
    juntar(texto("VP8L"), bytes(5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0)),
    corpo,
  );
  const t = riff.length - 8;
  riff.set([t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >>> 24) & 0xff], 4);
  return riff;
}

/** O texto com o padrao repetido ate o tamanho. */
function repetir(padrao: string, tamanho: number): string {
  return padrao.repeat(Math.max(1, Math.floor(tamanho / padrao.length)));
}

// ---------------------------------------------------------------------------
// ALTO 1: as expressoes do XMP nao voltam atras
// ---------------------------------------------------------------------------

describe("ALTO 1: o XMP e varrido sem voltar atras, com teto", () => {
  const casos: [string, () => Uint8Array][] = [
    ["revisao: '<xmp:a' + 128 mil 'a', sem compressao", () => pdfComXmp(`<xmp:a${"a".repeat(128_000)}`)],
    [
      "revisao: xmp:Label=\"1.1111\" + 128 mil espacos + x\", sem compressao",
      () => pdfComXmp(`<x:xmpmeta><rdf:Description xmp:Label="1.1111${" ".repeat(128_000)}x"/></x:xmpmeta>`),
    ],
    ["revisao: o mesmo com FlateDecode (628 bytes)", () => pdfComXmp(`<xmp:a${"a".repeat(128_000)}`, true)],
    ["'<xmp:a' + 2 MB de 'a' (no teto do XMP), comprimido", () => pdfComXmp(`<xmp:a${"a".repeat(2 * MB - 100)}`, true)],
    ["xmp:Label com 2 MB de espacos, comprimido", () => pdfComXmp(`xmp:Label="1.1111${" ".repeat(2 * MB - 100)}x"`, true)],
    ["xmp:Label com tabs, espacos duros e quebras", () => pdfComXmp(`<xmp:Label>1.1111${"\t \n ".repeat(400_000)}x</xmp:Label>`, true)],
    ["o grau entre brancos (3.7319 + brancos + Â + brancos)", () => pdfComXmp(`<xmp:Label>3.7319${" ".repeat(600_000)}Â${" ".repeat(600_000)}x</xmp:Label>`, true)],
    ["graus e minutos com brancos (3 + brancos + ° + brancos)", () => pdfComXmp(`<xmp:Label>3${" ".repeat(600_000)}°${" ".repeat(600_000)}x</xmp:Label>`, true)],
    ["340 mil '<xmp:a' seguidos, sem '>'", () => pdfComXmp("<xmp:a".repeat(340_000), true)],
    ["'<photoshop:A' sem '>' e um '>' so no fim", () => pdfComXmp(`${"<photoshop:A ".repeat(150_000)}>`, true)],
    ["95 mil atributos xmp:a=\"1.1111 1.111\"", () => pdfComXmp('xmp:a="1.1111 1.111" '.repeat(95_000), true)],
    ["atributos sem a aspa de fechar", () => pdfComXmp(`${"xmp:a='".repeat(1)}${"xmp:b=x ".repeat(240_000)}`, true)],
    ["valores so de digitos, pontos e espacos", () => pdfComXmp(`<xmp:a>${"1.1111 1.111Â ".repeat(130_000)}</xmp:a>`, true)],
    ["o formato do XMP quase: ' 1,1.1,1.1' repetido", () => pdfComXmp(" 1,1.1,1.1".repeat(200_000), true)],
    ["'<photoshop:City>' + 4 mil '<' sem '>', 256 vezes", () => pdfComXmp(`<photoshop:City>${"<".repeat(4000)}</photoshop:City>`.repeat(256), true)],
    ["400 mil ' City' (o nome sem contexto)", () => pdfComXmp(" City".repeat(400_000), true)],
    ["340 mil 'a:City' (o prefixo andado para tras)", () => pdfComXmp("a:City".repeat(340_000), true)],
  ];
  for (const [nome, gerar] of casos) {
    it(`${nome}: termina em menos de 1,5 s`, () => {
      const arquivo = gerar();
      const { resultado, ms } = cronometrar(`XMP: ${nome}`, "pdf", arquivo);
      expect(resultadoValido(resultado), JSON.stringify(resultado)).toBe(true);
      expect(ms).toBeLessThan(PRAZO_MS);
    });
  }

  it("as entradas da revisao nao tem localizacao: o PDF sai", () => {
    expect(cronometrar("x", "pdf", pdfComXmp(`<xmp:a${"a".repeat(128_000)}`)).resultado).toMatchObject({ tipo: "pdf" });
    expect(
      cronometrar("x", "pdf", pdfComXmp(`xmp:Label="1.1111${" ".repeat(128_000)}x"`, true)).resultado,
    ).toMatchObject({ tipo: "pdf" });
  });

  it("a coordenada continua achada no fim de um XMP enorme", () => {
    const xmp = `<xmp:Label>${" ".repeat(MB)}</xmp:Label><xmp:Nickname>3.7319 S</xmp:Nickname>`;
    expect(cronometrar("x", "pdf", pdfComXmp(xmp, true)).resultado).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("o XMP acima do teto (2 MB descomprimidos): bomba, sem ler o resto", () => {
    expect(LIMITES_DA_MIDIA.pdfXmp).toBe(2 * MB);
    const grande = pdfComXmp(" ".repeat(LIMITES_DA_MIDIA.pdfXmp + 1), true);
    expect(cronometrar("XMP acima do teto", "pdf", grande).resultado).toEqual({ tipo: "fora", motivo: "bomba" });
    const semCompressao = pdfComXmp(" ".repeat(LIMITES_DA_MIDIA.pdfXmp + 1));
    expect(cronometrar("XMP acima do teto", "pdf", semCompressao).resultado).toEqual({
      tipo: "fora",
      motivo: "bomba",
    });
    // No teto, sai.
    expect(cronometrar("x", "pdf", pdfComXmp(" ".repeat(LIMITES_DA_MIDIA.pdfXmp), true)).resultado).toMatchObject({
      tipo: "pdf",
    });
  });
});

// ---------------------------------------------------------------------------
// ALTO 2: as listas /Kids e os /Count indiretos, uma vez por numero
// ---------------------------------------------------------------------------

describe("ALTO 2: a lista e o /Count indiretos lidos uma vez por numero de objeto", () => {
  it("revisao: 1.000 nos com uma lista de 700 mil referencias (4 MB): paginas_demais em menos de 1,5 s", () => {
    const arquivo = pdfKids(1000, 700_000);
    expect(arquivo.length).toBeLessThan(LIMITES_DA_MIDIA.pdf.maximoDeBytes);
    const { resultado, ms } = cronometrar("Kids: 1.000 nos x 700 mil", "pdf", arquivo);
    expect(resultado).toEqual({ tipo: "fora", motivo: "paginas_demais" });
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  it("revisao: 9.900 versoes do mesmo no e do mesmo /Count indireto: em menos de 1,5 s", () => {
    const { resultado, ms } = cronometrar("Kids: 9.900 versoes", "pdf", pdfVersoes(9900));
    expect(resultado).toMatchObject({ tipo: "pdf", paginas: 1 });
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  for (const [versoes, referencias] of [
    [3, 800_000],
    [10, 700_000],
    [1000, 7000],
  ] as const) {
    it(`${versoes} versoes aninhadas do no, cada lista direta com as mesmas ${referencias} referencias: termina em menos de 1,5 s`, () => {
      const { resultado, ms } = cronometrar(`Kids: ${versoes} versoes aninhadas`, "pdf", pdfVersoesAninhadas(versoes, referencias));
      expect(resultadoValido(resultado), JSON.stringify(resultado)).toBe(true);
      expect(ms).toBeLessThan(PRAZO_MS);
    });
  }

  it("a lista lida uma vez ainda conta para cada no que aponta para ela", () => {
    // Dois nos com a mesma lista indireta de 2 paginas: 4 folhas.
    const arquivo = pdf([
      "<< /Type /Catalog /Pages 3 0 R >>",
      "[5 0 R 6 0 R]",
      "<< /Type /Pages /Kids 2 0 R /Count 1 >>",
      "<< /Type /Pages /Kids 2 0 R /Count 1 >>",
      "<< /Parent 3 0 R >>",
      "<< /Parent 3 0 R >>",
    ]);
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 4 });
  });

  it("o /Count indireto com varias versoes vale pela maior", () => {
    const arquivo = texto(
      "%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n5 0 obj 1 endobj\n5 0 obj 7 endobj\n5 0 obj 2 endobj\n2 0 obj <</Type/Pages/Count 5 0 R>> endobj\n2 0 obj <</Type/Pages/Count 5 0 R>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n",
    );
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 7 });
  });

  it("a referencia com o numero longo e o nome no meio da lista contam como antes", () => {
    const arquivo = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [12345678904 0 R 5 0 R/X 6 0 R 2 0 R] /Count 1 >>",
      "<< /Parent 2 0 R >>",
    ]);
    // 2345678904 (os ultimos 10 digitos), 5 e 6 sao folhas; 2 e o proprio no.
    expect(paginasDoPdf(arquivo)).toEqual({ paginas: 3 });
  });
});

// ---------------------------------------------------------------------------
// ALTO 3: as fotos aninhadas e o fluxo dentro de outro
// ---------------------------------------------------------------------------

describe("ALTO 3: o fluxo que comeca dentro de outro e PDF malformado", () => {
  for (const niveis of [100, 500]) {
    it(`revisao: ${niveis} fotos /DCTDecode aninhadas na mesma varredura: formato em menos de 1,5 s`, () => {
      const { resultado, ms } = cronometrar(
        `fotos aninhadas: ${niveis}`,
        "pdf",
        pdfFotosAninhadas(niveis, Math.floor((4.8 * MB) / 2) * 2),
      );
      expect(resultado).toEqual({ tipo: "fora", motivo: "formato" });
      expect(ms).toBeLessThan(PRAZO_MS);
    });
  }

  it("uma foto de verdade de 4,8 MB (um FF00 a cada 256 bytes, como nos dados comprimidos): sai, em menos de 1,5 s", () => {
    const sorteio = aleatorio(48);
    const dados = new Uint8Array(4.8 * MB);
    for (let i = 0; i < dados.length; i += 1) {
      dados[i] = Math.floor(sorteio() * 255);
      if (dados[i] === 0xff) {
        dados[i] = 0xfe;
      }
    }
    for (let i = 0; i + 1 < dados.length; i += 256) {
      dados[i] = 0xff;
      dados[i + 1] = 0x00;
    }
    const foto = juntar(bytes(0xff, 0xd8), DQT, SOF0, SOS, dados, bytes(0xff, 0xd9));
    const arquivo = pdf([CATALOGO, RAIZ, PAGINA, fluxo("/Type /XObject /Subtype /Image /Filter /DCTDecode", foto)]);
    const { resultado, ms } = cronometrar("uma foto de 4,8 MB", "pdf", arquivo);
    expect(resultado).toMatchObject({ tipo: "pdf", paginas: 1 });
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  it("a foto so de FF00 (4,8 MB, um 0xFF a cada 2 bytes): termina em menos de 1,5 s", () => {
    const { resultado, ms } = cronometrar("foto so de FF00", "pdf", pdfFotosAninhadas(1, Math.floor((4.8 * MB) / 2) * 2));
    expect(resultadoValido(resultado), JSON.stringify(resultado)).toBe(true);
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  it("um fluxo comum dentro dos dados de outro, ou dentro do dicionario: formato", () => {
    const dentroDosDados = pdf([
      CATALOGO,
      RAIZ,
      PAGINA,
      fluxo("", "xx 9 0 obj << /Length 2 >> stream\nab\nyy"),
    ]);
    expect(cronometrar("x", "pdf", dentroDosDados).resultado).toEqual({ tipo: "fora", motivo: "formato" });
    const dentroDoDicionario = pdf([
      CATALOGO,
      RAIZ,
      PAGINA,
      fluxo("/Nota (9 0 obj << /Length 2 >> stream\nab)", "dados"),
    ]);
    expect(cronometrar("x", "pdf", dentroDoDicionario).resultado).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("o objeto sem fluxo dentro dos dados de outro continua lido (o controle)", () => {
    const arquivo = pdf([CATALOGO, RAIZ, PAGINA, fluxo("", "xx 9 0 obj << /A 1 >> endobj yy")]);
    expect(cronometrar("x", "pdf", arquivo).resultado).toMatchObject({ tipo: "pdf", paginas: 1 });
  });
});

// ---------------------------------------------------------------------------
// BAIXO 7: o MP3 para de andar quando o lixo passa do aceito
// ---------------------------------------------------------------------------

describe("BAIXO 7: o MP3 com lixo demais para de andar", () => {
  it("revisao: dois quadros e 5 MB de 0xFF: fora de sincronia em menos de 1,5 s", () => {
    const arquivo = juntar(QUADRO_417, QUADRO_417, new Uint8Array(5 * MB - 417 * 3).fill(0xff));
    const { resultado, ms } = cronometrar("MP3: 5 MB de 0xFF", "mp3", arquivo);
    expect(resultado).toEqual({ tipo: "fora", motivo: "fora_de_sincronia" });
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  it("revisao: dois quadros e FF FB em pares: fora de sincronia em menos de 1,5 s", () => {
    const lixo = new Uint8Array(5 * MB - 417 * 3);
    for (let i = 0; i < lixo.length; i += 2) {
      lixo[i] = 0xff;
      lixo[i + 1] = 0xfb;
    }
    const { resultado, ms } = cronometrar("MP3: FF FB em pares", "mp3", juntar(QUADRO_417, QUADRO_417, lixo));
    expect(resultado).toEqual({ tipo: "fora", motivo: "fora_de_sincronia" });
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  it("o MP3 com lixo demais tambem nao tem quadros para tirar as etiquetas (nada sai)", () => {
    const arquivo = juntar(QUADRO_417, QUADRO_417, new Uint8Array(100_000).fill(0xff));
    expect(semEtiquetasId3(arquivo)).toEqual(new Uint8Array(0));
  });
});

// ---------------------------------------------------------------------------
// O teto de pedacos do PNG e do WebP
// ---------------------------------------------------------------------------

describe("o PNG e o WebP com pedacos demais (arquivo feito para alocar): formato, depressa", () => {
  it("o PNG ate 65.536 pedacos sai; com um a mais, formato", () => {
    // IHDR + 65.534 + IEND = 65.536 pedacos.
    expect(cronometrar("PNG no teto", "png", pngPedacos(0, "tEXt", 65_534)).resultado).toMatchObject({ tipo: "imagem" });
    expect(cronometrar("PNG acima do teto", "png", pngPedacos(0, "tEXt", 65_535)).resultado).toEqual({ tipo: "fora", motivo: "formato" });
  });

  it("o WebP ate 65.536 pedacos sai; com um a mais, formato", () => {
    // VP8L + 65.535 = 65.536 pedacos.
    expect(cronometrar("WebP no teto", "webp", webpPedacos(0, "EXIF", 65_535)).resultado).toMatchObject({ tipo: "imagem" });
    expect(cronometrar("WebP acima do teto", "webp", webpPedacos(0, "EXIF", 65_536)).resultado).toEqual({ tipo: "fora", motivo: "formato" });
  });

  for (const [formato, gerar] of [
    ["png", () => pngPedacos(5 * MB, "IDAT")],
    ["png", () => pngPedacos(5 * MB, "pHYs")],
    ["webp", () => webpPedacos(5 * MB, "ALPH")],
    ["webp", () => webpPedacos(5 * MB, "EXIF")],
  ] as const) {
    it(`5 MB de pedacos vazios (${formato}): formato em menos de 1,5 s`, () => {
      const { resultado, ms } = cronometrar(`${formato}: 5 MB de pedacos`, formato, gerar());
      expect(resultado).toEqual({ tipo: "fora", motivo: "formato" });
      expect(ms).toBeLessThan(PRAZO_MS);
    });
  }
});

// ---------------------------------------------------------------------------
// O orcamento unico por arquivo
// ---------------------------------------------------------------------------

describe("o orcamento de trabalho: um por arquivo, cobrado em todo laco", () => {
  it("revisao: 19.990 objetos apontando para o mesmo dicionario de 3 KB: bomba em menos de 1,5 s", () => {
    for (const dicionario of [`<</A [${"1 ".repeat(1500)}] >>`, `<</Type[${"/A".repeat(1500)}]>>`]) {
      const { resultado, ms } = cronometrar("ObjStm: 19.990 no mesmo dicionario", "pdf", pdfObjStmMesmoDicionario(19_990, dicionario));
      expect(resultado).toEqual({ tipo: "fora", motivo: "bomba" });
      expect(ms).toBeLessThan(PRAZO_MS);
    }
  });

  it("5 MB de chaves minimas num dicionario: bomba em menos de 1,5 s", () => {
    const arquivo = pdf([CATALOGO, RAIZ, PAGINA, `<< ${repetir("/A 1 ", 4.9 * MB)}>>`]);
    const { resultado, ms } = cronometrar("5 MB de chaves", "pdf", arquivo);
    expect(resultado).toEqual({ tipo: "fora", motivo: "bomba" });
    expect(ms).toBeLessThan(PRAZO_MS);
  });

  it("o orcamento e de cada arquivo: o segundo preparo nao herda o gasto do primeiro", () => {
    const pesado = pdf([CATALOGO, RAIZ, PAGINA, `<< /V [${repetir("0 ", 3.5 * MB)}] >>`]);
    const leve = pdf([CATALOGO, RAIZ, PAGINA]);
    expect(cronometrar("x", "pdf", pesado).resultado).toMatchObject({ tipo: "pdf" });
    expect(cronometrar("x", "pdf", pesado).resultado).toMatchObject({ tipo: "pdf" });
    expect(cronometrar("x", "pdf", leve).resultado).toMatchObject({ tipo: "pdf" });
  });
});

// ---------------------------------------------------------------------------
// O fuzz deterministico
// ---------------------------------------------------------------------------

type CasoDoFuzz = { nome: string; formato: keyof typeof MIMETYPE; gerar: () => Uint8Array };

/** Pedacos de texto que fazem as leituras do PDF trabalharem (numeros, brancos, nomes, delimitadores). */
const PEDACOS_DO_PDF = [
  "1", "0", "12345678901", " ", "  ", "\n", "\r\n", "\0", "\t", "obj", "endobj", "stream\n", "endstream",
  "R", "<<", ">>", "[", "]", "(", ")", "\\", "<", ">", "/", "%", "/Type", "/Pages", "/Kids", "/Count",
  "/Filter", "/FlateDecode", "/DCTDecode", "/ObjStm", "/N", "/First", "/Metadata", "/City", "/GPS",
  "/EmbeddedFil", "#", "xmp:", "photoshop:", "City", "State", "Location", ":", "=", "\"", "'", "3.7319",
  "Â°", "°", ",", ";", "S", "a",
];

/** Os geradores maliciosos: cada familia com tamanho e padrao sorteados. */
function casosDoFuzz(semente: number, quantos: number): CasoDoFuzz[] {
  const sorteio = aleatorio(semente);
  const inteiro = (de: number, ate: number) => de + Math.floor(sorteio() * (ate - de + 1));
  const escolher = <T,>(lista: readonly T[]): T => lista[Math.floor(sorteio() * lista.length)] as T;
  const padrao = (pecas: number) =>
    Array.from({ length: pecas }, () => escolher(PEDACOS_DO_PDF)).join("");
  const familias: ((n: number) => CasoDoFuzz)[] = [
    (n) => {
      const p = padrao(inteiro(1, 6));
      const tamanho = inteiro(1, 2 * MB - 4096);
      const comprimido = sorteio() < 0.7;
      return { nome: `fuzz ${n}: XMP com ${JSON.stringify(p)} ate ${tamanho} B`, formato: "pdf", gerar: () => pdfComXmp(repetir(p, tamanho), comprimido) };
    },
    (n) => {
      const p = padrao(inteiro(1, 6));
      return { nome: `fuzz ${n}: texto solto com ${JSON.stringify(p)}`, formato: "pdf", gerar: () => pdfComTextoSolto(repetir(p, 4.8 * MB)) };
    },
    (n) => {
      const p = padrao(inteiro(1, 5));
      return { nome: `fuzz ${n}: fluxo de objetos com ${JSON.stringify(p)}`, formato: "pdf", gerar: () => pdfComObjStm(`(${repetir(p, inteiro(1, 7) * MB)})`) };
    },
    (n) => {
      const p = padrao(inteiro(1, 5));
      return { nome: `fuzz ${n}: dicionario com ${JSON.stringify(p)}`, formato: "pdf", gerar: () => pdf([CATALOGO, RAIZ, PAGINA, `<< /V ${repetir(p, 4.8 * MB)} >>`]) };
    },
    (n) => {
      const nos = inteiro(1, 3000);
      const referencias = inteiro(1, 700_000);
      return { nome: `fuzz ${n}: ${nos} nos x lista de ${referencias}`, formato: "pdf", gerar: () => pdfKids(nos, referencias) };
    },
    (n) => {
      const versoes = inteiro(1, 9900);
      return { nome: `fuzz ${n}: ${versoes} versoes`, formato: "pdf", gerar: () => pdfVersoes(versoes) };
    },
    (n) => {
      const versoes = inteiro(1, 1000);
      const referencias = inteiro(1, Math.floor((4.8 * MB - versoes * 50) / 6));
      return { nome: `fuzz ${n}: ${versoes} versoes aninhadas x ${referencias}`, formato: "pdf", gerar: () => pdfVersoesAninhadas(versoes, referencias) };
    },
    (n) => {
      const quantos = inteiro(2, 19_990);
      const tamanho = inteiro(10, 3000);
      return { nome: `fuzz ${n}: ${quantos} objetos no mesmo dicionario de ${tamanho} B`, formato: "pdf", gerar: () => pdfObjStmMesmoDicionario(quantos, `<</Type[${"/A".repeat(Math.floor(tamanho / 2))}]/Kids[${"1 0 R ".repeat(10)}]>>`) };
    },
    (n) => {
      const niveis = inteiro(1, 600);
      return { nome: `fuzz ${n}: ${niveis} fotos aninhadas`, formato: "pdf", gerar: () => pdfFotosAninhadas(niveis, Math.floor((4 * MB) / 2) * 2) };
    },
    (n) => {
      const tamanho = inteiro(1, 5) * MB - 4096;
      return { nome: `fuzz ${n}: foto FF00 de ${tamanho} B no PDF`, formato: "pdf", gerar: () => pdf([CATALOGO, RAIZ, PAGINA, fluxo("/Type /XObject /Subtype /Image /Filter /DCTDecode", jpegFf00(tamanho))]) };
    },
    (n) => {
      const tamanho = inteiro(1, 5) * MB;
      return { nome: `fuzz ${n}: JPEG FF00 de ${tamanho} B`, formato: "jpeg", gerar: () => jpegFf00(tamanho) };
    },
    (n) => {
      const porVarredura = inteiro(1, 2000) * 2;
      return {
        nome: `fuzz ${n}: JPEG com varreduras de ${porVarredura} B`,
        formato: "jpeg",
        gerar: () => {
          const bloco = new Uint8Array(porVarredura);
          for (let i = 0; i < bloco.length; i += 2) {
            bloco[i] = 0xff;
          }
          const partes: Uint8Array[] = [bytes(0xff, 0xd8), DQT, SOF0];
          const quantas = Math.min(4000, Math.floor((5 * MB - 1000) / (SOS.length + bloco.length)));
          for (let i = 0; i < quantas; i += 1) {
            partes.push(SOS, bloco);
          }
          return juntar(...partes, bytes(0xff, 0xd9));
        },
      };
    },
    (n) => {
      const lixo = escolher([0xff, 0xfb, 0x00, 0x49]);
      const tamanho = inteiro(1, 5) * MB - 2000;
      return { nome: `fuzz ${n}: MP3 com ${tamanho} B de 0x${lixo.toString(16)}`, formato: "mp3", gerar: () => juntar(QUADRO_417, QUADRO_417, new Uint8Array(tamanho).fill(lixo)) };
    },
    (n) => {
      const tamanho = inteiro(1, 5) * MB;
      return { nome: `fuzz ${n}: MP3 de quadros minimos (${tamanho} B)`, formato: "mp3", gerar: () => mp3QuadrosMinimos(tamanho) };
    },
    (n) => {
      const tamanho = inteiro(1, 5) * MB - 1000;
      return {
        nome: `fuzz ${n}: MP3 com ID3 vazias no meio (${tamanho} B)`,
        formato: "mp3",
        gerar: () =>
          juntar(QUADRO_417, QUADRO_417, repetido(juntar(texto("ID3"), bytes(3, 0, 0, 0, 0, 0, 0)), Math.floor(tamanho / 10))),
      };
    },
    (n) => {
      const tipo = escolher(["IDAT", "tEXt", "pHYs", "zzzz"]);
      return { nome: `fuzz ${n}: PNG de pedacos ${tipo}`, formato: "png", gerar: () => pngPedacos(5 * MB, tipo) };
    },
    (n) => {
      const tipo = escolher(["ALPH", "EXIF", "XMP ", "ANMF"]);
      return { nome: `fuzz ${n}: WebP de pedacos ${tipo}`, formato: "webp", gerar: () => webpPedacos(5 * MB, tipo) };
    },
  ];
  return Array.from({ length: quantos }, (_, n) => escolher(familias)(n));
}

/** Arquivos validos e pequenos, para as mutacoes. */
function validos(): [keyof typeof MIMETYPE, Uint8Array][] {
  const jpeg = juntar(bytes(0xff, 0xd8), DQT, SOF0, SOS, bytes(0x12, 0xff, 0x00, 0x34), bytes(0xff, 0xd9));
  return [
    ["pdf", pdfComXmp('<x:xmpmeta><rdf:Description xmp:Label="sala 2" photoshop:City=""/></x:xmpmeta>', true)],
    ["pdf", pdf([CATALOGO, RAIZ, PAGINA, fluxo("/Type /XObject /Subtype /Image /Filter /DCTDecode", jpeg)])],
    ["pdf", pdfComObjStm("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    ["jpeg", jpeg],
    ["mp3", juntar(...Array.from({ length: 60 }, () => QUADRO_417))],
    ["png", pngPedacos(4096, "IDAT")],
    ["webp", webpPedacos(4096, "ALPH")],
  ];
}

/** Mutacoes: bytes trocados, trechos repetidos, cortes e enxertos (com a semente). */
function mutacoes(semente: number, quantas: number): CasoDoFuzz[] {
  const sorteio = aleatorio(semente);
  const inteiro = (de: number, ate: number) => de + Math.floor(sorteio() * (ate - de + 1));
  const base = validos();
  return Array.from({ length: quantas }, (_, n) => {
    const [formato, original] = base[inteiro(0, base.length - 1)] ?? ["pdf", new Uint8Array(1)];
    const tipo = inteiro(0, 3);
    const a = inteiro(0, original.length - 1);
    const b = Math.min(original.length, a + inteiro(1, 64));
    const vezes = inteiro(1, Math.floor((5 * MB) / Math.max(1, b - a)) - 1);
    const trocas = Array.from({ length: inteiro(1, 16) }, () => [inteiro(0, original.length - 1), inteiro(0, 255)] as const);
    return {
      nome: `mutacao ${n} (${formato}, tipo ${tipo})`,
      formato,
      gerar: () => {
        if (tipo === 0) {
          const copia = original.slice();
          for (const [posicao, valor] of trocas) {
            copia[posicao] = valor;
          }
          return copia;
        }
        if (tipo === 1) {
          // O trecho [a, b) repetido ate perto de 5 MB.
          return juntar(original.subarray(0, b), repetido(original.subarray(a, b), vezes), original.subarray(b));
        }
        if (tipo === 2) {
          return original.subarray(0, a + 1);
        }
        return juntar(original.subarray(0, a), texto(PEDACOS_DO_PDF.join("").repeat(inteiro(1, 40_000))), original.subarray(a));
      },
    };
  });
}

describe("o fuzz deterministico (semente fixa): cada caso em menos de 1,5 s, sem excecao", () => {
  const casos = [...casosDoFuzz(20261030, 48), ...mutacoes(1030, 36)];
  for (const caso of casos) {
    it(caso.nome, () => {
      const arquivo = caso.gerar();
      if (arquivo.length > LIMITES_DA_MIDIA.pdf.maximoDeBytes) {
        // Acima do tamanho maximo nem e lido (e o mesmo para os outros formatos).
        expect(cronometrar(caso.nome, caso.formato, arquivo).resultado).toEqual({ tipo: "fora", motivo: "grande_demais" });
        return;
      }
      const { resultado, ms } = cronometrar(caso.nome, caso.formato, arquivo);
      expect(resultadoValido(resultado), JSON.stringify(resultado)).toBe(true);
      expect(ms).toBeLessThan(PRAZO_MS);
    });
  }
});
