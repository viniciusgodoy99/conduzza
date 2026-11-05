import { describe, expect, it } from "vitest";

import { versaoDoPortao } from "@/lib/domain/conformidade/filtro";
import { detectarGatilhosDeEntrada } from "@/lib/domain/conformidade/gatilhos-de-entrada";
import {
  compactarComInicios,
  neutralizador,
  normalizarBase,
  type Compacto,
  type Neutralizacao,
} from "@/lib/domain/conformidade/normalizar";
import { NEUTRALIZACOES_DE_ENTRADA } from "@/lib/domain/conformidade/padroes";
import * as casos from "@/tests/fixtures/ia/conformidade/casos";
import * as casosAg6 from "@/tests/fixtures/ia/conformidade/casos-ag6";
import * as casosAg6b from "@/tests/fixtures/ia/conformidade/casos-ag6b";

// Revisao de desempenho de 31/10/2026 (frente P1): o portao roda de forma
// SINCRONA em toda mensagem do paciente, e a mensagem do WhatsApp chega a
// 65.536 caracteres. A rota do motor roda jobs de varias clinicas juntos
// (maxDuration de 60 s): CPU presa num job atrasa os relogios dos outros.
// Dois trechos eram superlineares:
//  - a guarda de intencao clinica da troca de preco do exame (padroes.ts)
//    era uma lookaround de 2.000 caracteres no fim da fonte, e cada "exame"
//    casado varria a janela de novo: "tem exame " repetido levava 3,5 s;
//  - compactarComInicios (normalizar.ts) perguntava o fim do compacto que
//    crescia e achatava a string a cada letra: de 50 a 150 ms por chamada em
//    65.536 caracteres, quatro chamadas por mensagem (portao e urgencia).
// Os dois ficaram lineares com o MESMO resultado (a prova completa, antigo
// contra novo, esta no relatorio da frente; aqui fica a comparacao com as
// formas de antes, que continuam escritas abaixo como referencia).
//
// Teste de tempo FOLGADO (a bateria roda no prebuild, com a maquina
// carregada): o menor de tres medidas do portao inteiro abaixo de 1 s. Sem
// carga, fica entre 100 e 200 ms.

const TAMANHO = 65_536;
const LIMITE_DO_PORTAO_MS = 1_000;

function repetir(trecho: string, tamanho = TAMANHO): string {
  return trecho.repeat(Math.ceil(tamanho / trecho.length)).slice(0, tamanho);
}

function menorTempo(medir: () => unknown): number {
  let menor = Number.POSITIVE_INFINITY;
  for (let vez = 0; vez < 3; vez += 1) {
    const inicio = performance.now();
    medir();
    menor = Math.min(menor, performance.now() - inicio);
  }
  return menor;
}

function portao(textos: readonly string[]) {
  return detectarGatilhosDeEntrada({
    mensagens: textos.map((texto) => ({ tipo: "texto", texto })),
  });
}

/** Todas as strings das baterias (frases, rascunhos, legendas, nomes). */
function frasesDasBaterias(): string[] {
  const achadas = new Set<string>();
  const vistos = new Set<object>();
  const visitar = (valor: unknown): void => {
    if (typeof valor === "string") {
      achadas.add(valor);
      return;
    }
    if (typeof valor !== "object" || valor === null || vistos.has(valor)) {
      return;
    }
    vistos.add(valor);
    for (const filho of Object.values(valor)) {
      visitar(filho);
    }
  };
  visitar([casos, casosAg6, casosAg6b]);
  return [...achadas];
}

const FRASES = frasesDasBaterias();

describe("o portão em tempo linear (revisão de desempenho de 31/10)", () => {
  it.each([
    // A troca de preco do exame, com e sem a intencao clinica por perto.
    "tem exame ",
    "faz exame ",
    "exame quanto custa ",
    "pra que serve o exame? quanto custa? ",
    // O compacto e as visoes, sem exame.
    "sangue ",
    "A limpeza de pele custa R$ 120,00. ",
  ])(
    "%s repetido até 65.536 caracteres: o portão inteiro em menos de 1 s",
    (trecho) => {
      // Aquece as regex (a primeira chamada compila).
      portao([trecho]);
      const texto = repetir(trecho);
      expect(menorTempo(() => portao([texto]))).toBeLessThan(
        LIMITE_DO_PORTAO_MS,
      );
    },
    60_000,
  );

  it("a rajada de quatro mensagens que somam 65.536 caracteres, também", () => {
    for (const trecho of ["tem exame ", "quanto custa o exame? jejum "]) {
      portao([trecho]);
      const texto = repetir(trecho);
      const quarto = TAMANHO / 4;
      const partes = [0, 1, 2, 3].map((parte) =>
        texto.slice(parte * quarto, (parte + 1) * quarto),
      );
      expect(menorTempo(() => portao(partes))).toBeLessThan(
        LIMITE_DO_PORTAO_MS,
      );
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// A guarda da troca de preco do exame, lida em codigo
// ---------------------------------------------------------------------------

const TROCA_DO_EXAME = NEUTRALIZACOES_DE_ENTRADA.find(
  (troca) => troca.nome === "exame_na_pergunta_de_preco",
);

/** As trocas que vem antes da do exame (ela e a ultima). */
const TROCAS_DE_ANTES = neutralizador(
  NEUTRALIZACOES_DE_ENTRADA.filter((troca) => troca !== TROCA_DO_EXAME),
);

/**
 * A forma de antes: a mesma fonte com a guarda como lookaround no fim
 * (quadratica, so para comparar em texto curto).
 */
function trocaDeReferencia(troca: Neutralizacao): (texto: string) => string {
  const guarda = troca.semPorPerto;
  if (guarda === undefined) {
    throw new Error("a troca do exame perdeu a guarda");
  }
  const regex = new RegExp(
    `(?:${troca.fonte})(?<!${guarda.fonte}[\\s\\S]{0,${guarda.janela}})(?![\\s\\S]{0,${guarda.janela}}${guarda.fonte})`,
    "g",
  );
  return (texto) => texto.replace(regex, troca.troca);
}

describe("a guarda da troca de preço do exame, lida uma vez por texto", () => {
  const troca = TROCA_DO_EXAME;
  if (troca === undefined) {
    throw new Error("a troca exame_na_pergunta_de_preco sumiu");
  }
  const rapida = neutralizador([troca]);
  const referencia = trocaDeReferencia(troca);

  it("dá o mesmo que a lookaround no fim da fonte, em todas as frases das baterias", () => {
    const diferentes: string[] = [];
    for (const frase of FRASES) {
      const base = normalizarBase(frase);
      for (const texto of [base, TROCAS_DE_ANTES(base)]) {
        if (rapida(texto) !== referencia(texto)) {
          diferentes.push(frase);
        }
      }
    }
    expect(FRASES.length).toBeGreaterThan(5_000);
    expect(diferentes).toEqual([]);
  });

  it("a janela de 2.000 caracteres, dos dois lados, posição por posição", () => {
    const exame = "quanto custa o exame";
    for (const intencao of ["jejum", "pra que", "o que significa"]) {
      for (let distancia = 1_990; distancia <= 2_010; distancia += 1) {
        // A intencao comeca `distancia` caracteres depois do fim do exame.
        const depois = `${exame} ${"x".repeat(distancia - 2)} ${intencao}`;
        // A intencao termina `distancia` caracteres antes do fim do exame.
        const antes = `${intencao} ${"x".repeat(distancia - exame.length - 2)} ${exame}`;
        for (const texto of [depois, antes]) {
          const trocado = rapida(texto);
          expect(trocado).toBe(referencia(texto));
          expect(trocado.includes("procedimento")).toBe(distancia > 2_000);
        }
      }
    }
  });

  it("o casamento barrado não engole o seguinte: a busca recomeça no caractere seguinte", () => {
    const sintetica: Neutralizacao = {
      nome: "sintetica",
      fonte: "xa|ab",
      troca: "T",
      semPorPerto: { fonte: "bd", janela: 0 },
    };
    // "xa" termina onde "bd" comeca (barrado); "ab", um caractere depois,
    // passa. A lookaround faria o mesmo.
    expect(neutralizador([sintetica])("xabd")).toBe("xTd");
    expect(trocaDeReferencia(sintetica)("xabd")).toBe("xTd");
  });

  it("a troca com guarda não aceita $", () => {
    expect(() =>
      neutralizador([
        {
          nome: "com_dolar",
          fonte: "(a)",
          troca: "$1",
          semPorPerto: { fonte: "b", janela: 1 },
        },
      ]),
    ).toThrow();
  });

  it("o portão continua lendo a intenção clínica perto do exame", () => {
    expect(portao(["quanto custa o exame?"])).not.toContain("assunto_clinico");
    expect(portao(["pra que serve o exame? quanto custa?"])).toContain(
      "assunto_clinico",
    );
    expect(portao(["quanto custa o exame? precisa de jejum?"])).toContain(
      "assunto_clinico",
    );
  });
});

// ---------------------------------------------------------------------------
// O compacto
// ---------------------------------------------------------------------------

/** O compactarComInicios de antes (quadratico), como referencia. */
function compactarDeReferencia(texto: string): Compacto {
  let compacto = "";
  const inicios = new Set<number>();
  let comecoDePalavra = true;
  for (const caractere of texto) {
    if (!/[a-z]/.test(caractere)) {
      comecoDePalavra = true;
      continue;
    }
    if (compacto.endsWith(caractere)) {
      if (comecoDePalavra) {
        inicios.add(compacto.length - 1);
      }
    } else {
      if (comecoDePalavra) {
        inicios.add(compacto.length);
      }
      compacto += caractere;
    }
    comecoDePalavra = false;
  }
  return { compacto, inicios };
}

function iguais(texto: string): boolean {
  const novo = compactarComInicios(texto);
  const antigo = compactarDeReferencia(texto);
  return (
    novo.compacto === antigo.compacto &&
    [...novo.inicios].join() === [...antigo.inicios].join()
  );
}

describe("o compacto com os inícios das palavras, em tempo linear", () => {
  it("dá o mesmo que a forma de antes nas frases das baterias e na base delas", () => {
    const diferentes = FRASES.flatMap((frase) =>
      [frase, normalizarBase(frase)].filter((texto) => !iguais(texto)),
    );
    expect(diferentes).toEqual([]);
  });

  it("dá o mesmo com letra repetida no começo da palavra, emoji e metade de par substituto", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const metade = String.fromCharCode(0xd83d);
    for (const texto of [
      "",
      "a",
      "aa aa a",
      "ab ba aab",
      "trama dol",
      "di-pi-ro-na",
      `a${emoji}a`,
      `aa${emoji}${emoji}ab`,
      `a${metade}a`,
      `${metade}${emoji}x`,
      "ABC abc 123 a1a",
    ]) {
      expect(iguais(texto)).toBe(true);
    }
  });

  // Quatro vezes o maximo do WhatsApp, para a volta do tempo quadratico
  // aparecer com folga: a forma de antes levava de 2 a 7 s aqui; a de
  // agora, perto de 10 ms.
  it("262.144 caracteres em menos de 100 ms", () => {
    const texto = repetir("abcdefghij", 4 * TAMANHO);
    compactarComInicios("aquece");
    expect(menorTempo(() => compactarComInicios(texto))).toBeLessThan(100);
  });
});

describe("a versão do portão", () => {
  it("mudou com a guarda lida em código", () => {
    expect(versaoDoPortao()).toMatch(/^portao-[0-9a-f]{12}$/);
    expect(versaoDoPortao()).not.toBe("portao-4e98a801c92c");
  });
});
