import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  codigosDoCliqueDoSite,
  extrairTokens,
  removerCodigosDoClique,
} from "@/lib/domain/attribution";
import {
  CAMINHO_DAS_FRASES,
  caminhoDasFrases,
  caracteresDaFrase,
  FRASE_PADRAO,
  fraseDoRastreioSchema,
  fraseNoFormato,
  frasesDaResposta,
  frasesDoRastreioSchema,
  frasesNoFormato,
  LIMITE_DE_FRASES,
  linkComCodigo,
  sortearFrase,
  TAMANHO_MAXIMO_DA_FRASE,
  TEXTO_SEM_MENSAGEM_PRONTA,
} from "@/lib/domain/rastreio-do-site";

// Frases do botao sem mensagem pronta (ajuste de 04/10/2026 na F1 do Google).
// As regras sao as dos checks de rastreio_do_site.frases (migration
// 20261005110000): o que a acao aceita o banco aceita, e o que a rota e o
// script aceitam e exatamente o que o banco aceita.

const CHAVE = "0123456789abcdef0123";
const CODIGO = "K7Q2MX";
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261005110000_frases_do_rastreio.sql",
  ),
  "utf-8",
);

const FRASE_A = "Oi! Vi o anúncio no site. Quero marcar uma avaliação.";
const FRASE_B = "Bom dia, gostaria de saber os horários (pode ser sábado?).";
const FRASE_C = "Olá! Quero agendar: limpeza & clareamento, 50% à vista?";

/** Bytes fixos para o sorteio, um por chamada (como o script pede). */
function bytes(...valores: number[]): (destino: Uint8Array) => void {
  const fila = [...valores];
  return (destino) => {
    for (let i = 0; i < destino.length; i++) {
      destino[i] = fila.shift() ?? 0;
    }
  };
}

describe("frase de fabrica", () => {
  it("e o default da coluna no banco, byte a byte", () => {
    const padrao = /default array\['([^']*)'\]::text\[\]/.exec(MIGRATION);
    expect(padrao?.[1]).toBe(FRASE_PADRAO);
    expect(FRASE_PADRAO).toBe(
      "Olá! Vim pelo site e gostaria de agendar uma consulta.",
    );
    expect(TEXTO_SEM_MENSAGEM_PRONTA).toBe(FRASE_PADRAO);
  });

  it("passa nas proprias regras e nao tem travessao", () => {
    expect(fraseNoFormato(FRASE_PADRAO)).toBe(true);
    expect(fraseDoRastreioSchema.parse(FRASE_PADRAO)).toBe(FRASE_PADRAO);
    expect(FRASE_PADRAO).not.toMatch(/[–—]/);
  });

  it("limites iguais aos checks do banco", () => {
    expect(LIMITE_DE_FRASES).toBe(5);
    expect(TAMANHO_MAXIMO_DA_FRASE).toBe(300);
    expect(MIGRATION).toContain("cardinality(frases) between 1 and 5");
    // 301 seguidos sem quebra reprovam (150 + 151).
    expect(MIGRATION).toContain("[^\\n]{150}[^\\n]{151}");
  });
});

describe("caracteresDaFrase", () => {
  it("conta code points, como o char_length do banco", () => {
    expect(caracteresDaFrase("Olá")).toBe(3);
    expect(caracteresDaFrase("😀")).toBe(1);
    expect(caracteresDaFrase("Oi 😀👍")).toBe(5);
    expect("😀".length).toBe(2);
  });
});

describe("fraseNoFormato (igual ao check do banco)", () => {
  it("aceita varias sentencas e pontuacao comum", () => {
    for (const frase of [
      FRASE_A,
      FRASE_B,
      FRASE_C,
      "Oi.",
      "a".repeat(300),
      "😀".repeat(300),
      "Quero agendar; e-mail: contato@clinica.com.br, +55 84 99999-0000!",
      // O banco nao apara as pontas e so conta espaco ASCII como vazio.
      "  Oi  ",
      "\u00a0",
    ]) {
      expect(fraseNoFormato(frase), frase).toBe(true);
    }
  });

  it("recusa vazio, so espacos, mais de 300, quebra, controle, colchete e cerquilha", () => {
    for (const frase of [
      "",
      " ",
      "     ",
      "a".repeat(301),
      "😀".repeat(301),
      "linha\nnova",
      "retorno\rcarro",
      "com\ttab",
      "nulo\u0000",
      "controle\u0001",
      "esc\u001b",
      "del\u007f",
      "c1\u0085",
      "c1\u009f",
      "separador\u2028de linha",
      "separador\u2029de paragrafo",
      "Quero [agendar]",
      "Quero agendar]",
      "Agende #AGENDA",
      "#",
    ]) {
      expect(fraseNoFormato(frase), JSON.stringify(frase)).toBe(false);
    }
    for (const naoTexto of [null, undefined, 1, {}, ["Oi"]]) {
      expect(fraseNoFormato(naoTexto)).toBe(false);
    }
  });
});

describe("frasesNoFormato e frasesDaResposta", () => {
  it("de 1 a 5 frases, todas na regra, copiadas", () => {
    const lista = [FRASE_A, FRASE_B];
    const lidas = frasesNoFormato(lista);
    expect(lidas).toEqual(lista);
    expect(lidas).not.toBe(lista);
    expect(frasesNoFormato([FRASE_A, FRASE_A])).toEqual([FRASE_A, FRASE_A]);
    expect(frasesNoFormato(["1", "2", "3", "4", "5"])).toHaveLength(5);
  });

  it("tudo ou nada: um item estranho derruba a lista", () => {
    for (const lista of [
      [],
      ["1", "2", "3", "4", "5", "6"],
      [FRASE_A, ""],
      [FRASE_A, "#AGENDA"],
      [FRASE_A, null],
      [FRASE_A, 1],
      "Oi",
      null,
      undefined,
      { 0: "Oi", length: 1 },
    ]) {
      expect(frasesNoFormato(lista), JSON.stringify(lista)).toBeNull();
    }
  });

  it("corpo da rota: so o objeto com frases; campo a mais e ignorado", () => {
    expect(frasesDaResposta({ frases: [FRASE_A] })).toEqual([FRASE_A]);
    expect(frasesDaResposta({ frases: [FRASE_A], versao: 2 })).toEqual([
      FRASE_A,
    ]);
    for (const corpo of [
      null,
      undefined,
      "texto",
      [FRASE_A],
      { frases: [] },
      { frases: "Oi" },
      { outra: [FRASE_A] },
    ]) {
      expect(frasesDaResposta(corpo), JSON.stringify(corpo)).toBeNull();
    }
  });
});

describe("frasesDoRastreioSchema (entrada da tela)", () => {
  it("apara cada frase e aceita de 1 a 5", () => {
    expect(frasesDoRastreioSchema.parse(["  Oi!  ", `\t${FRASE_A}\n`])).toEqual(
      ["Oi!", FRASE_A],
    );
    expect(
      frasesDoRastreioSchema.parse([FRASE_A, FRASE_B, FRASE_C, "4", "5"]),
    ).toHaveLength(5);
  });

  it("mensagens de recepcionista, sem travessao", () => {
    const mensagem = (entrada: unknown): string | undefined =>
      frasesDoRastreioSchema.safeParse(entrada).error?.issues[0]?.message;
    expect(mensagem([])).toBe("Cadastre pelo menos uma frase.");
    expect(mensagem(["1", "2", "3", "4", "5", "6"])).toBe(
      "Cadastre no máximo 5 frases.",
    );
    expect(mensagem(["   "])).toBe("Escreva a frase.");
    expect(mensagem([" \n "])).toBe("Escreva a frase.");
    expect(mensagem(["a".repeat(301)])).toBe("Use até 300 caracteres.");
    for (const proibida of [
      "Agende #AGENDA",
      "Quero [agendar]",
      "linha\nnova",
      "com\ttab",
      "separador\u2028meio",
    ]) {
      expect(mensagem([proibida]), JSON.stringify(proibida)).toBe(
        "A frase não pode ter quebra de linha, colchetes nem o sinal #.",
      );
    }
    for (const texto of [
      mensagem([]),
      mensagem(["1", "2", "3", "4", "5", "6"]),
      mensagem([""]),
      mensagem(["a".repeat(301)]),
      mensagem(["#"]),
    ]) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });

  it("300 caracteres passam e 301 nao (contados depois de aparar)", () => {
    expect(
      frasesDoRastreioSchema.safeParse([` ${"a".repeat(300)} `]).success,
    ).toBe(true);
    expect(frasesDoRastreioSchema.safeParse(["a".repeat(301)]).success).toBe(
      false,
    );
  });

  it("emoji conta 2 aqui e 1 no banco: o Zod e mais estrito, nunca mais frouxo", () => {
    expect(frasesDoRastreioSchema.safeParse(["😀".repeat(150)]).success).toBe(
      true,
    );
    expect(frasesDoRastreioSchema.safeParse(["😀".repeat(151)]).success).toBe(
      false,
    );
    expect(fraseNoFormato("😀".repeat(151))).toBe(true);
  });

  it("o que o Zod aceita o banco aceita (sorteio de textos com os caracteres-problema)", () => {
    const pedacos = [
      "a",
      "Olá",
      " ",
      "\u00a0",
      "\n",
      "\t",
      "\u0085",
      "\u2028",
      "#",
      "[",
      "]",
      "😀",
      ".",
      "!",
      "%",
      "&",
    ];
    const sorteio = new Uint8Array(4096);
    randomFillSync(sorteio);
    let posicao = 0;
    const proximo = (): number => sorteio[posicao++ % sorteio.length] ?? 0;
    let aceitas = 0;
    for (let i = 0; i < 400; i++) {
      let texto = "";
      const tamanho = proximo() % 12;
      for (let j = 0; j < tamanho; j++) {
        texto += pedacos[proximo() % pedacos.length];
      }
      const resultado = frasesDoRastreioSchema.safeParse([texto]);
      if (resultado.success) {
        aceitas++;
        expect(frasesNoFormato(resultado.data), JSON.stringify(texto)).toEqual(
          resultado.data,
        );
      }
    }
    expect(aceitas).toBeGreaterThan(0);
  });
});

describe("sortearFrase", () => {
  it("uma frase: nem sorteia", () => {
    let chamou = false;
    expect(
      sortearFrase([FRASE_A], () => {
        chamou = true;
      }),
    ).toBe(FRASE_A);
    expect(chamou).toBe(false);
  });

  it("um byte por tentativa, resto da divisao pelo numero de frases", () => {
    expect(sortearFrase([FRASE_A, FRASE_B], bytes(0))).toBe(FRASE_A);
    expect(sortearFrase([FRASE_A, FRASE_B], bytes(1))).toBe(FRASE_B);
    expect(sortearFrase([FRASE_A, FRASE_B], bytes(255))).toBe(FRASE_B);
    expect(sortearFrase([FRASE_A, FRASE_B, FRASE_C], bytes(5))).toBe(FRASE_C);
  });

  it("sem vicio: com 3 ou 5 frases, o byte 255 e descartado", () => {
    // 256 % 3 = 1 e 256 % 5 = 1: o limite e 255.
    expect(sortearFrase([FRASE_A, FRASE_B, FRASE_C], bytes(255, 1))).toBe(
      FRASE_B,
    );
    expect(sortearFrase(["1", "2", "3", "4", "5"], bytes(255, 254))).toBe("5");
    // Com 4, nada e descartado.
    expect(sortearFrase(["1", "2", "3", "4"], bytes(255))).toBe("4");
  });

  it("gerador que nunca acerta: desiste e fica com a primeira", () => {
    let chamadas = 0;
    const sempre255 = (destino: Uint8Array) => {
      chamadas++;
      destino.fill(255);
    };
    expect(sortearFrase([FRASE_A, FRASE_B, FRASE_C], sempre255)).toBe(FRASE_A);
    expect(chamadas).toBe(32);
  });

  it("lista fora da regra: frase de fabrica", () => {
    expect(sortearFrase([], bytes(0))).toBe(FRASE_PADRAO);
    expect(sortearFrase(["#AGENDA"], bytes(0))).toBe(FRASE_PADRAO);
    expect(sortearFrase([FRASE_A, ""], bytes(0))).toBe(FRASE_PADRAO);
  });

  it("com o gerador forte, as tres saem e mais ou menos por igual", () => {
    const contagem = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const frase = sortearFrase([FRASE_A, FRASE_B, FRASE_C], randomFillSync);
      contagem.set(frase, (contagem.get(frase) ?? 0) + 1);
    }
    expect(contagem.size).toBe(3);
    for (const vezes of contagem.values()) {
      expect(vezes).toBeGreaterThan(800);
      expect(vezes).toBeLessThan(1200);
    }
  });
});

describe("caminhoDasFrases", () => {
  it("a rota publica GET pela chave", () => {
    expect(CAMINHO_DAS_FRASES).toBe("/api/publico/rastreio/");
    expect(caminhoDasFrases(CHAVE)).toBe(`/api/publico/rastreio/${CHAVE}`);
    expect(caminhoDasFrases(CHAVE.toUpperCase())).toBeNull();
    expect(caminhoDasFrases("../clique")).toBeNull();
  });
});

describe("linkComCodigo com a frase", () => {
  const textoDe = (href: string | null): string =>
    new URL(href ?? "").searchParams.get("text") ?? "";

  it("link sem texto: a frase antes do codigo", () => {
    expect(
      textoDe(linkComCodigo("https://wa.me/5584999990000", CODIGO, FRASE_A)),
    ).toBe(`${FRASE_A} [#${CODIGO}]`);
    expect(
      textoDe(
        linkComCodigo("https://wa.me/5584999990000?text=%20", CODIGO, FRASE_B),
      ),
    ).toBe(`${FRASE_B} [#${CODIGO}]`);
  });

  it("& = + % e acento na frase vao codificados, sem quebrar o link", () => {
    const href = linkComCodigo(
      "https://api.whatsapp.com/send?phone=5584999990000&type=phone_number",
      CODIGO,
      `${FRASE_C} a=b+c`,
    );
    const url = new URL(href ?? "");
    expect(url.searchParams.get("text")).toBe(`${FRASE_C} a=b+c [#${CODIGO}]`);
    expect(url.searchParams.get("phone")).toBe("5584999990000");
    expect(url.searchParams.get("type")).toBe("phone_number");
  });

  it("link com texto pronto: a frase nao entra", () => {
    expect(
      textoDe(
        linkComCodigo(
          "https://wa.me/5584999990000?text=Quero%20agendar",
          CODIGO,
          FRASE_A,
        ),
      ),
    ).toBe(`Quero agendar [#${CODIGO}]`);
  });

  it("sem frase, ou frase fora da regra: frase de fabrica", () => {
    const padrao = `${FRASE_PADRAO} [#${CODIGO}]`;
    expect(textoDe(linkComCodigo("https://wa.me/5584999990000", CODIGO))).toBe(
      padrao,
    );
    for (const ruim of ["", "   ", "Agende #AB2CDE", "a\nb", "a".repeat(301)]) {
      expect(
        textoDe(linkComCodigo("https://wa.me/5584999990000", CODIGO, ruim)),
        JSON.stringify(ruim),
      ).toBe(padrao);
    }
  });
});

describe("a frase na ingestao (regra de hoje, mantida)", () => {
  // A frase nunca gera codigo: o clique casa so pelo " [#XXXXXX]". Sem o
  // clique (nao achado ou vencido), o corpo sem o sufixo e a propria frase,
  // e ela vale como o texto de um botao com mensagem pronta (mensagem
  // padrao e palavra-chave), como antes do script. Mudar isso e decisao do
  // dono, na frente da ingestao.
  it("o unico codigo do texto e o do clique, e sem ele sobra a frase", () => {
    for (const frase of [FRASE_PADRAO, FRASE_A, FRASE_B, FRASE_C]) {
      const href = linkComCodigo("https://wa.me/5584999990000", CODIGO, frase);
      const texto = new URL(href ?? "").searchParams.get("text") ?? "";
      expect(extrairTokens(texto)).toEqual([CODIGO]);
      expect(codigosDoCliqueDoSite(texto, [])).toEqual([CODIGO]);
      expect(removerCodigosDoClique(texto, [CODIGO])).toBe(frase);
    }
  });
});
