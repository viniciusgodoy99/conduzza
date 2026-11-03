import { describe, expect, it } from "vitest";

import { MAXIMO_DE_TEXTOS_DE_PREPARO } from "@/lib/domain/conformidade/filtro";
import {
  semOPreparo,
  SUBSTITUTO_DO_TEXTO_DO_PREPARO,
  trechoDePreparoNaResposta,
  trechosDoPreparo,
} from "@/lib/domain/preparo";
import { TEXTO_DO_PREPARO_DE_TESTE } from "@/tests/fixtures/ia/conformidade/casos";

// Revisao da AG7 (MOTOR-2 e BANCO-3): o teto dos textos de preparo da
// clinica subiu de 200 para 1.000. No teto, com cada texto no limite da
// versao (3.500 caracteres), a troca no historico (as 20 mensagens do turno)
// montava a regex de cada texto para cada mensagem: um minuto. Agora cada
// texto e preparado uma vez por lista (a do catalogo do turno) e so monta a
// regex quando as palavras mais longas dele estao na mensagem.
//
// Teste de tempo FOLGADO (a bateria roda no prebuild, com a maquina
// carregada): o menor de tres medidas abaixo do limite. Sem carga, a troca
// fica abaixo de 100 ms e o trecho do filtro perto de 500 ms.

const LIMITE_DA_TROCA_MS = 1_000;
const LIMITE_DO_TRECHO_MS = 3_000;

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
  it("a troca nas 20 mensagens do historico cabe no turno, e o texto vira o marcador", () => {
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
  });

  it("o trecho do filtro cabe no turno", () => {
    const rascunho =
      "Tenho horário amanhã às 10h com a Dra. Ana. Pode ser? ".repeat(12);
    const tempo = menorDeTres(() => {
      trechoDePreparoNaResposta(rascunho.slice(0, 690), noTeto());
    });
    expect(tempo).toBeLessThan(LIMITE_DO_TRECHO_MS);
  });
});
