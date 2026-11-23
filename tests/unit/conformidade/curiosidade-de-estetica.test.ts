import { describe, expect, it } from "vitest";

import {
  ehCuriosidadeGeralDeEstetica,
  gatilhosDosTextos,
} from "@/lib/domain/conformidade/gatilhos-de-entrada";

// 23/11/2026: o detector da duvida geral de estetica (sensacao, duracao,
// seguranca, recuperacao e tempo de resultado). So o detector: a frente
// seguinte decide a rota, e o portao nao mudou para estas perguntas.

const CURIOSIDADE_GERAL: readonly (string | readonly string[])[] = [
  "botox dói?",
  "fica roxo depois?",
  "quanto tempo dura o preenchimento?",
  "é seguro?",
  "quanto tempo pra ver o resultado?",
  "precisa de repouso depois da depilação a laser?",
  "o botox dói muito?",
  "limpeza de pele dói?",
  "em quanto tempo aparece o resultado do botox?",
  ["oi", "botox dói?"],
];

const NAO_E_CURIOSIDADE_GERAL: readonly string[] = [
  // a situacao da pessoa
  "botox dói? to grávida",
  "posso fazer botox se tenho alergia?",
  "estou amamentando, botox é seguro?",
  "tomo roacutan, é seguro fazer limpeza de pele?",
  "é seguro pra quem tem pressão alta?",
  "botox é seguro na gravidez?",
  "quanto tempo dura o preenchimento? tenho 16 anos",
  // o sintoma de agora e a urgencia
  "fiz botox ontem e ta doendo",
  "meu rosto ficou roxo depois do preenchimento",
  "quanto tempo dura? to com febre",
  "botox dói? to com falta de ar",
  // a indicacao e os outros gatilhos
  "qual é melhor pra mim, botox ou preenchimento?",
  "botox dói? minha filha quer fazer",
  "é seguro? quero falar com a doutora",
  // sem o assunto
  "quanto custa o botox?",
];

describe("ehCuriosidadeGeralDeEstetica (23/11/2026)", () => {
  it.each(CURIOSIDADE_GERAL.map((t) => [String(t), t] as const))(
    "e curiosidade geral: %s",
    (_rotulo, turno) => {
      const textos = typeof turno === "string" ? [turno] : [...turno];
      expect(ehCuriosidadeGeralDeEstetica(textos)).toBe(true);
    },
  );

  it.each(NAO_E_CURIOSIDADE_GERAL)("nao e: %s", (texto) => {
    expect(ehCuriosidadeGeralDeEstetica([texto])).toBe(false);
  });

  it("o portao nao mudou: hoje escala a sensacao e a seguranca", () => {
    expect(gatilhosDosTextos(["botox dói?"])).toContain("sintoma");
    expect(gatilhosDosTextos(["fica roxo depois?"])).toContain("sintoma");
    expect(gatilhosDosTextos(["é seguro?"])).toContain("assunto_clinico");
    expect(gatilhosDosTextos(["quanto tempo pra ver o resultado?"])).toContain(
      "assunto_clinico",
    );
  });
});
