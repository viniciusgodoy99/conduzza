import { describe, expect, it } from "vitest";

import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import { FRASE_DE_ESCALONAMENTO } from "@/lib/domain/conformidade/frase-fixa";

// A frase fixa e a resposta unica para qualquer bloqueio ou escalonamento.
// Mudar o texto e decisao do dono (plano, decisao 5): este teste trava o
// texto aprovado, e o outro garante que a propria frase nao cai no filtro.

describe("frase fixa de escalonamento", () => {
  it("e exatamente o texto aprovado", () => {
    expect(FRASE_DE_ESCALONAMENTO).toBe(
      "Recebi sua mensagem. Vou passar sua conversa para alguém da nossa equipe, que vai te responder por aqui assim que possível.",
    );
  });

  it("passa pelo filtro deterministico", () => {
    const resultado = avaliarRegras(FRASE_DE_ESCALONAMENTO, {
      precosDoTurno: [],
      nomesDoCatalogo: [],
      mensagensDoPaciente: [],
    });
    expect(resultado.achados).toEqual([]);
  });

  it("nao tem travessao nem marca de IA", () => {
    expect(FRASE_DE_ESCALONAMENTO).not.toMatch(/[\u2013\u2014]/);
    expect(FRASE_DE_ESCALONAMENTO.toLowerCase()).not.toMatch(
      /\bia\b|robo|assistente/,
    );
  });
});
