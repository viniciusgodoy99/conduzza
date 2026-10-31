import { describe, expect, it } from "vitest";

import {
  frasesDasVisoes,
  neutralizador,
  visoesDoTexto,
} from "@/lib/domain/conformidade/normalizar";
import { NEUTRALIZACOES_DE_ENTRADA } from "@/lib/domain/conformidade/padroes";
import { detectarUrgencia } from "@/lib/domain/conformidade/urgencia";

// Revisao R2 de d1a15f6 (B5): a urgencia relia o texto desde o comeco a cada
// sinal casado (o comeco da oracao, o fim da frase, a excecao da mensagem e o
// que a desfaz): "dor forte " repetido custava 4 segundos em 65.536
// caracteres, o tamanho maximo da mensagem do WhatsApp. Agora a leitura usa
// os indices da leitura (achados uma vez so) e janelas locais.
//
// Teste de tempo FOLGADO, o menor de tres medidas: a LEITURA da urgencia (o
// tempo total menos as visoes do portao, que a urgencia calcula com
// normalizar.ts e as trocas de padroes.ts) em menos de 500 ms. As visoes sao
// a maior parte do tempo e oscilam com a carga da maquina; sem carga, o total
// fica perto de 250 ms. O total tem um teto largo (2 segundos), so contra a
// volta do tempo quadratico.

const TAMANHO = 65_536;
const LIMITE_DA_LEITURA_MS = 500;
const LIMITE_DO_TOTAL_MS = 2_000;

const neutralizarEntrada = neutralizador(NEUTRALIZACOES_DE_ENTRADA);

function repetir(trecho: string): string {
  return trecho.repeat(Math.ceil(TAMANHO / trecho.length)).slice(0, TAMANHO);
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

describe("a urgência em tempo linear (B5)", () => {
  it.each([
    // Os do revisor: o sinal que casa milhares de vezes na mesma oracao.
    "dor forte ",
    "visao embacada ",
    // A historia, a excecao da mensagem, o que a desfaz e o " e " da oracao.
    "ja tive dor no peito e ",
    "fiz preenchimento e dor forte ",
    "nao responde ",
    "emergencia, preciso remarcar ",
  ])(
    "%s repetido até 65.536 caracteres: a leitura em menos de 500 ms",
    (trecho) => {
      // Aquece as regex (a primeira chamada compila).
      detectarUrgencia([trecho]);
      const texto = repetir(trecho);
      const quarto = TAMANHO / 4;
      const partes = [
        texto.slice(0, quarto),
        texto.slice(quarto, 2 * quarto),
        texto.slice(2 * quarto, 3 * quarto),
        texto.slice(3 * quarto),
      ];
      // Um texto so e a rajada (cada mensagem sozinha e a juncao).
      for (const textos of [[texto], partes]) {
        const visoes = menorTempo(() =>
          textos.map((t) =>
            frasesDasVisoes(visoesDoTexto(t, [], neutralizarEntrada)),
          ),
        );
        const total = menorTempo(() => detectarUrgencia(textos));
        expect(total - visoes).toBeLessThan(LIMITE_DA_LEITURA_MS);
        expect(total).toBeLessThan(LIMITE_DO_TOTAL_MS);
      }
    },
    60_000,
  );
});
