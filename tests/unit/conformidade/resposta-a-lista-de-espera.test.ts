import { describe, expect, it } from "vitest";

import {
  FONTES_DA_RESPOSTA_A_LISTA_DE_ESPERA,
  interpretarRespostaAListaDeEspera,
  interpretarRespostaAoCancelamento,
} from "@/lib/domain/resposta-paciente";

// AG5 (27/10/2026, D-30 e o desenho da AG5, 4.7): o "sim" da pergunta da
// lista de espera numa lista FECHADA PROPRIA, por frase inteira. O "cancela"
// da lista do cancelamento nunca vira sim para entrar na lista, e a pergunta
// ("Sim, mas demora?") nunca e sim nem nao.

describe("o sim da lista de espera", () => {
  it.each([
    "Sim",
    "sim!",
    "S",
    "isso",
    "Confirmo",
    "Pode",
    "pode sim",
    "Quero",
    "quero sim",
    "Sim, quero",
    "eu quero",
    "Pode colocar",
    "coloca",
    "Me coloca na lista",
    "Claro",
    "com certeza",
    "ok",
    "Certo",
    "Por favor",
    "Sim, por favor",
    "👍",
    "✅",
    "Sim 👍",
  ])("%s é sim", (texto) => {
    expect(interpretarRespostaAListaDeEspera([texto])).toBe("sim");
  });

  it.each([
    "Não",
    "não quero",
    "Não, obrigado",
    "Não, deixa",
    "deixa",
    "Esquece",
    "Melhor não",
    "mudei de ideia",
    "agora não",
  ])("%s é não", (texto) => {
    expect(interpretarRespostaAListaDeEspera([texto])).toBe("nao");
  });

  it.each([
    "Sim, mas demora?",
    "sim mas demora",
    "Sim?",
    "Pode?",
    "acho que sim",
    "talvez",
    "quanto tempo demora",
    "prefiro à tarde",
    "sim, mas só às sextas",
    "",
    "   ",
  ])("%j não é reconhecida", (texto) => {
    expect(interpretarRespostaAListaDeEspera([texto])).toBe("nao_reconhecida");
  });

  it("o vocabulário do cancelamento não é sim para a lista de espera", () => {
    for (const texto of [
      "cancela",
      "cancelar",
      "pode cancelar",
      "quero cancelar",
      "sim, pode cancelar",
      "Cancela por favor",
    ]) {
      expect(interpretarRespostaAoCancelamento([texto]), texto).toBe("sim");
      expect(interpretarRespostaAListaDeEspera([texto]), texto).toBe(
        "nao_reconhecida",
      );
    }
  });

  it("várias mensagens: sim só com todas sim; não só com todas não", () => {
    expect(interpretarRespostaAListaDeEspera(["Sim", "pode colocar"])).toBe("sim");
    expect(interpretarRespostaAListaDeEspera(["não", "deixa"])).toBe("nao");
    expect(interpretarRespostaAListaDeEspera(["Sim", "não"])).toBe(
      "nao_reconhecida",
    );
    expect(interpretarRespostaAListaDeEspera(["Sim", null])).toBe(
      "nao_reconhecida",
    );
    expect(interpretarRespostaAListaDeEspera([])).toBe("nao_reconhecida");
  });

  it("as listas entram na versão (fontes)", () => {
    expect(FONTES_DA_RESPOSTA_A_LISTA_DE_ESPERA.join("|")).toContain("pode colocar");
    expect(FONTES_DA_RESPOSTA_A_LISTA_DE_ESPERA.join("|")).not.toMatch(/cancel/);
  });
});
