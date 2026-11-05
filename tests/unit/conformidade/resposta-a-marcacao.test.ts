import { describe, expect, it } from "vitest";

import {
  confirmouAMarcacao,
  FONTES_DA_RESPOSTA_A_MARCACAO,
  interpretarRespostaAoCancelamento,
} from "@/lib/domain/resposta-paciente";

// Conversas longas (05/11/2026): o "sim" do "Confirma ...?" da marcacao, pela
// leitura e pela lista do cancelamento, sem os verbos de cancelar e com os de
// marcar. Errar para o lado do "nao entendi" e barato (a pergunta volta);
// marcar sem querer, nao.

describe("o sim da marcação", () => {
  it.each([
    "Sim",
    "sim!",
    "S",
    "isso",
    "Confirmo",
    "Confirmar",
    "Sim, confirmo",
    "Isso, confirmo",
    "Pode",
    "Pode marcar",
    "Sim, pode marcar",
    "Pode agendar",
    "Marca",
    "Quero",
    "Claro",
    "com certeza",
    "ok",
    "Certo",
    "Por favor",
    "\u{1F44D}",
    "Sim \u{1F44D}",
  ])("%s marca", (texto) => {
    expect(confirmouAMarcacao([texto])).toBe(true);
  });

  it.each([
    "Não",
    "Não, melhor não",
    "Não, espera",
    "melhor não",
    "Não quero",
    "Espera",
    "Sim, mas demora?",
    "sim mas demora",
    "Sim?",
    "Pode?",
    "acho que sim",
    "Pode marcar a limpeza",
    "Segunda às 8",
    "",
    "   ",
    // O verbo de cancelar nunca vira sim para marcar.
    "Pode cancelar",
    "cancela",
    "Quero cancelar",
    "pode desmarcar",
  ])("%s não marca", (texto) => {
    expect(confirmouAMarcacao([texto])).toBe(false);
  });

  it("a rajada: só marca com todas sim; sem mensagem ou sem texto, não", () => {
    expect(confirmouAMarcacao(["Sim", "Pode marcar"])).toBe(true);
    // O agradecimento junto do sim nao muda a resposta; sozinho, nao confirma.
    expect(confirmouAMarcacao(["Sim", "Obrigada!"])).toBe(true);
    expect(confirmouAMarcacao(["Obrigada!"])).toBe(false);
    expect(confirmouAMarcacao(["Não", "Obrigada!"])).toBe(false);
    expect(confirmouAMarcacao(["Sim", "Não, espera"])).toBe(false);
    expect(confirmouAMarcacao(["Não", "Sim"])).toBe(false);
    expect(confirmouAMarcacao([])).toBe(false);
    expect(confirmouAMarcacao([null])).toBe(false);
    expect(confirmouAMarcacao(["Sim", null])).toBe(false);
  });

  it("a lista do cancelamento não mudou: 'pode marcar' não cancela", () => {
    expect(interpretarRespostaAoCancelamento(["Pode marcar"])).toBe(
      "nao_reconhecida",
    );
    expect(interpretarRespostaAoCancelamento(["Marca"])).toBe(
      "nao_reconhecida",
    );
    expect(interpretarRespostaAoCancelamento(["Pode cancelar"])).toBe("sim");
  });

  it("a lista entra na versão, sem verbo de cancelar", () => {
    expect(FONTES_DA_RESPOSTA_A_MARCACAO.join("|")).toContain("pode marcar");
    expect(FONTES_DA_RESPOSTA_A_MARCACAO.join("|")).not.toMatch(
      /cancel|desmarc/,
    );
  });
});
