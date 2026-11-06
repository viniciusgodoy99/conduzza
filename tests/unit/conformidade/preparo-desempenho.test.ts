import { describe, expect, it } from "vitest";

import { MAXIMO_DE_TEXTOS_DE_PREPARO } from "@/lib/domain/conformidade/filtro";
import {
  PALAVRAS_DA_JANELA_DO_TRECHO,
  semOPreparo,
  SUBSTITUTO_DO_TEXTO_DO_PREPARO,
  TAMANHO_MINIMO_DO_TRECHO,
  trechoDePreparoNaResposta,
  trechosDoPreparo,
} from "@/lib/domain/preparo";
import {
  CASOS_DE_SAIDA,
  CONTROLES_DE_SAIDA,
  FRASES_DE_RECEPCAO,
  TEXTO_DO_PREPARO_DE_TESTE,
} from "@/tests/fixtures/ia/conformidade/casos";

// Revisao da AG7 (MOTOR-2 e BANCO-3): o teto dos textos de preparo da
// clinica subiu de 200 para 1.000. No teto, com cada texto no limite da
// versao (3.500 caracteres), a troca no historico (as 20 mensagens do turno)
// montava a regex de cada texto para cada mensagem: um minuto. Agora cada
// texto e preparado uma vez por lista (a do catalogo do turno) e so monta a
// regex quando as palavras mais longas dele estao na mensagem.
//
// Revisao curta da AG7 (CURTA-2): o trecho do filtro levava perto de 1 s por
// medida sem carga (a lista nova de cada turno montava cada frase e cada
// oracao como texto), e as tres medidas passavam dos 5 s do vitest no
// prebuild, com os 44 arquivos da bateria disputando a maquina. Agora cada
// texto vira a lista das palavras e as frases viram intervalos dela; a busca
// compara palavra com palavra. O resultado e o mesmo (a comparacao com a
// forma antiga, abaixo), e cada teste tem um prazo proprio, folgado, para a
// medida (e nao o relogio do vitest) dizer se cabe no turno.
//
// Teste de tempo FOLGADO (a bateria roda no prebuild, com a maquina
// carregada): o menor de tres medidas abaixo do limite. Sem carga, a troca
// e o trecho do filtro ficam abaixo de 300 ms.

const LIMITE_DA_TROCA_MS = 1_000;
const LIMITE_DO_TRECHO_MS = 3_000;
/** O prazo de cada teste (as tres medidas e a montagem das listas). */
const PRAZO_DO_TESTE_MS = 60_000;

function noTeto(): string[] {
  return Array.from({ length: MAXIMO_DE_TEXTOS_DE_PREPARO }, (_, i) =>
    `${i} ${TEXTO_DO_PREPARO_DE_TESTE.repeat(6)}`.slice(0, 3_500),
  );
}

function menorDeTres(medir: () => void): number {
  let menor = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i += 1) {
    const inicio = performance.now();
    medir();
    menor = Math.min(menor, performance.now() - inicio);
  }
  return menor;
}

describe("o preparo no teto de 1.000 textos de 3.500 caracteres", () => {
  it(
    "a troca nas 20 mensagens do historico cabe no turno, e o texto vira o marcador",
    () => {
      const toque = `Oi! Amanhã você tem Colonoscopia.\n${TEXTO_DO_PREPARO_DE_TESTE}\nPodemos confirmar?`;
      const tempo = menorDeTres(() => {
        // Uma lista nova por medida: nada fica pronto de uma medida para a
        // outra.
        const textos = [...noTeto(), TEXTO_DO_PREPARO_DE_TESTE];
        for (let i = 0; i < 20; i += 1) {
          trechosDoPreparo(toque, textos);
        }
      });
      expect(tempo).toBeLessThan(LIMITE_DA_TROCA_MS);
      expect(semOPreparo(toque, [...noTeto(), TEXTO_DO_PREPARO_DE_TESTE])).toBe(
        `Oi! Amanhã você tem Colonoscopia.\n${SUBSTITUTO_DO_TEXTO_DO_PREPARO}\nPodemos confirmar?`,
      );
    },
    PRAZO_DO_TESTE_MS,
  );

  it(
    "o trecho do filtro cabe no turno",
    () => {
      const rascunho =
        "Tenho horário amanhã às 10h com a Dra. Ana. Pode ser? ".repeat(12);
      // As listas montadas antes da medida (uma por medida: nada fica
      // pronto de uma medida para a outra); a medida e so a do filtro.
      const listas = [noTeto(), noTeto(), noTeto()];
      let vez = 0;
      const tempo = menorDeTres(() => {
        trechoDePreparoNaResposta(rascunho.slice(0, 690), listas[vez] ?? []);
        vez += 1;
      });
      expect(tempo).toBeLessThan(LIMITE_DO_TRECHO_MS);
      // E no teto o trecho continua sendo achado: a frase copiada do ultimo
      // texto da lista.
      expect(
        trechoDePreparoNaResposta(
          "Claro! Jejum de 8 horas antes do exame, inclusive de água.",
          [...noTeto(), TEXTO_DO_PREPARO_DE_TESTE],
        ),
      ).toBe(true);
    },
    PRAZO_DO_TESTE_MS,
  );
});

// ---------------------------------------------------------------------------
// A forma de antes (revisao da AG7, 21ee588), como referencia: a forma nova
// tem de dizer o mesmo em todo caso.
// ---------------------------------------------------------------------------

function soLetrasENumerosDeAntes(texto: string): string {
  return texto.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function semAcentoEMinusculoDeAntes(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

const FIM_DE_FRASE_DE_ANTES = /[.!?;:\u2026]+(?=\s|$)|[\r\n\u2028\u2029]+/u;
const FIM_DE_FRASE_OU_ORACAO_DE_ANTES =
  /[.!?;:,\u2026]+(?=\s|$)|[\r\n\u2028\u2029]+/u;

function trechoDeAntes(rascunho: string, textos: readonly string[]): boolean {
  const normalizada = soLetrasENumerosDeAntes(
    semAcentoEMinusculoDeAntes(rascunho),
  );
  if (normalizada === "") {
    return false;
  }
  const resposta = ` ${normalizada} `;
  const palavrasDaResposta = new Set(normalizada.split(" "));
  for (const texto of textos) {
    const minusculo = semAcentoEMinusculoDeAntes(texto);
    const inteiro = soLetrasENumerosDeAntes(minusculo);
    const trechos = [
      ...minusculo.split(FIM_DE_FRASE_DE_ANTES).map(soLetrasENumerosDeAntes),
      ...minusculo
        .split(FIM_DE_FRASE_OU_ORACAO_DE_ANTES)
        .map(soLetrasENumerosDeAntes),
      inteiro,
    ].filter((trecho) => Array.from(trecho).length >= TAMANHO_MINIMO_DO_TRECHO);
    const palavras = inteiro === "" ? [] : inteiro.split(" ");
    for (const trecho of trechos) {
      if (resposta.includes(` ${trecho} `)) {
        return true;
      }
    }
    for (
      let i = 0;
      i + PALAVRAS_DA_JANELA_DO_TRECHO <= palavras.length;
      i += 1
    ) {
      if (!palavrasDaResposta.has(palavras[i] ?? "")) {
        continue;
      }
      const janela = palavras
        .slice(i, i + PALAVRAS_DA_JANELA_DO_TRECHO)
        .join(" ");
      if (
        Array.from(janela).length >= TAMANHO_MINIMO_DO_TRECHO &&
        resposta.includes(` ${janela} `)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Sorteio com semente (mulberry32): o mesmo conjunto em toda rodada. */
function sorteador(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Textos da clinica com o que mexe no corte: a virgula e o ponto colados no
// numero ("0,9", "18:00"), a pontuacao repetida e sem branco depois, a
// reticencia, a quebra de linha do Windows e a de paragrafo, a letra fora do
// plano basico (U+1D400) e a acentuada decomposta.
const TEXTOS_DA_COMPARACAO = [
  TEXTO_DO_PREPARO_DE_TESTE,
  "Às 18:00 da véspera, tome 0,9 mL do frasco.,; Depois, só água\u2026 Na manhã do exame:jejum total!? Traga o pedido médico, o documento com foto e a carteirinha do convênio.",
  "Venha com roupa leve.\r\nNão use cremes 2 dias antes.\u2028Chegue 30 minutos antes, por favor: a recepção confere o pedido.\u2029Fim.",
  "Exame \u{1d400}B C, com o preparo da Cli\u0301nica. Na ve\u0301spera, faça só refeições leves, e evite café, chá preto e refrigerante escuro.",
  "Jejum de 8 horas. Jejum de 8 horas, inclusive de água. Jejum.",
];

function rascunhosSorteados(): string[] {
  const sortear = sorteador(20261103);
  const pecas = TEXTOS_DA_COMPARACAO.flatMap((texto) =>
    texto.split(/(?<=[\s.,;:!?\u2026])/u),
  );
  const pontuacao = [
    " ",
    ". ",
    ", ",
    ": ",
    "; ",
    "\n",
    "...",
    "! ",
    "? ",
    ",",
    ".",
  ];
  const rascunhos: string[] = [];
  for (let i = 0; i < 1_500; i += 1) {
    const texto =
      TEXTOS_DA_COMPARACAO[
        Math.floor(sortear() * TEXTOS_DA_COMPARACAO.length)
      ] ?? "";
    if (i % 3 === 0) {
      // Um pedaco seguido de um texto da clinica, cortado em qualquer
      // caractere (no meio da palavra tambem), com o comeco ou o fim trocado.
      const inicio = Math.floor(sortear() * texto.length);
      const fim = inicio + Math.floor(sortear() * 160);
      const pedaco = texto.slice(inicio, fim);
      rascunhos.push(
        sortear() < 0.5
          ? `Claro! ${pedaco} Qualquer dúvida, chame.`
          : pedaco.toUpperCase(),
      );
      continue;
    }
    // Pecas misturadas com pontuacao sorteada entre elas.
    const quantas = 1 + Math.floor(sortear() * 14);
    let rascunho = "";
    for (let j = 0; j < quantas; j += 1) {
      rascunho += pecas[Math.floor(sortear() * pecas.length)] ?? "";
      if (sortear() < 0.3) {
        rascunho += pontuacao[Math.floor(sortear() * pontuacao.length)] ?? "";
      }
    }
    rascunhos.push(rascunho);
  }
  return rascunhos;
}

describe("revisao curta da AG7 (CURTA-2): o trecho por palavras diz o mesmo que a forma de antes", () => {
  const daBateria = [
    ...CASOS_DE_SAIDA.map((caso) => caso.rascunho),
    ...CONTROLES_DE_SAIDA.map((caso) => caso.rascunho),
    ...FRASES_DE_RECEPCAO,
  ];
  const sorteados = rascunhosSorteados();

  it(
    "nos rascunhos da bateria e nos sorteados, com cada texto e com todos juntos",
    () => {
      const listas = [
        ...TEXTOS_DA_COMPARACAO.map((texto) => [texto]),
        [...TEXTOS_DA_COMPARACAO],
      ];
      let comparados = 0;
      let achados = 0;
      for (const rascunho of [...daBateria, ...sorteados]) {
        for (const textos of listas) {
          const antes = trechoDeAntes(rascunho, textos);
          expect(
            trechoDePreparoNaResposta(rascunho, textos),
            `${JSON.stringify(rascunho)} com ${textos.length} texto(s)`,
          ).toBe(antes);
          comparados += 1;
          achados += antes ? 1 : 0;
        }
      }
      // O conjunto acha trecho de verdade (e nao so o "nao achou").
      expect(comparados).toBeGreaterThan(10_000);
      expect(achados).toBeGreaterThan(500);
    },
    PRAZO_DO_TESTE_MS,
  );

  it(
    "os pedacos dos textos sorteados como texto da clinica",
    () => {
      const sortear = sorteador(3112026);
      let achados = 0;
      for (let i = 0; i < 300; i += 1) {
        const texto =
          TEXTOS_DA_COMPARACAO[
            Math.floor(sortear() * TEXTOS_DA_COMPARACAO.length)
          ] ?? "";
        const inicio = Math.floor(sortear() * texto.length);
        const daClinica = texto.slice(
          inicio,
          inicio + 40 + Math.floor(sortear() * 200),
        );
        if (daClinica === "") {
          continue;
        }
        for (const rascunho of sorteados.slice(i * 5, i * 5 + 5)) {
          const antes = trechoDeAntes(rascunho, [daClinica]);
          expect(trechoDePreparoNaResposta(rascunho, [daClinica])).toBe(antes);
          achados += antes ? 1 : 0;
        }
        // O proprio pedaco, como resposta, e sempre trecho quando tem tamanho.
        expect(trechoDePreparoNaResposta(daClinica, [daClinica])).toBe(
          trechoDeAntes(daClinica, [daClinica]),
        );
      }
      expect(achados).toBeGreaterThan(0);
    },
    PRAZO_DO_TESTE_MS,
  );
});
