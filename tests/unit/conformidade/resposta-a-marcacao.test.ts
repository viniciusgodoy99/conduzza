import { describe, expect, it } from "vitest";

import {
  confirmouAMarcacao,
  confirmouARemarcacao,
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
    // Revisao (05/11/2026): o sim dito de outro jeito.
    "Fechado",
    "beleza",
    "Tá bom",
    "tá bom!",
    "perfeito",
    "ok, obrigada",
    "Confirmo a consulta",
    "Pode marcar a consulta",
    "Oi, sim",
    "Bom dia, pode marcar",
    "Sim, pode confirmar, tá bom? Obrigada",
    "Sim, pode marcar, ok?",
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
    // Revisao (05/11/2026): remarcar nao e marcar, e "agenda" e o substantivo.
    "Remarcar",
    "Agenda",
    "Pode remarcar",
    "Quero remarcar",
    "Remarca",
    // A negacao e a duvida com a cortesia ou o "ta bom?" em volta.
    "Não, obrigada",
    "Oi, não",
    "Tá bom?",
    "Ok?",
    "Não, tá bom?",
    "Fechado?",
    "Sim, mas não hoje",
    "Tá bom, mas espera",
    "Oi",
    "Bom dia",
    "beleza, mas e o preço?",
    "Pode marcar a limpeza de pele não",
  ])("%s não marca", (texto) => {
    expect(confirmouAMarcacao([texto])).toBe(false);
  });

  // Revisao final da AG7 (achado 3): normalizar apaga o emoji, entao "Sim 👎"
  // lia "sim". Na marcacao e na remarcacao.
  it.each([
    "Sim \u{1F44E}",
    "Sim \u{274C}",
    "Pode \u{1F6AB}",
    "\u{1F44D}\u{1F44E}",
    "\u{1F44E}",
    "\u{1F44E}\u{1F3FD}",
    "Sim \u{1F621}",
    "Sim \u{1F914}",
    "Sim \u{2716}\u{FE0F}",
    "Sim \u{26D4}",
    "Sim :(",
    "Obrigada \u{1F44E}",
  ])("%s não marca nem remarca", (texto) => {
    expect(confirmouAMarcacao([texto])).toBe(false);
    expect(confirmouAMarcacao(["Sim", texto])).toBe(false);
    expect(confirmouARemarcacao([texto])).toBe(false);
  });

  it.each(["Sim \u{1F60A}", "Pode marcar \u{1F64F}", "Sim \u{2764}\u{FE0F}", "\u{2705}", "Sim \u{1F44D}\u{1F3FD}"])(
    "%s continua sendo sim",
    (texto) => {
      expect(confirmouAMarcacao([texto])).toBe(true);
      expect(confirmouARemarcacao([texto])).toBe(true);
    },
  );

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

  it("a rajada com o cumprimento: 'Oi' e 'Sim' marca; a negação ou a dúvida na rajada recusa", () => {
    expect(confirmouAMarcacao(["Oi", "Sim"])).toBe(true);
    expect(confirmouAMarcacao(["Sim", "Oi"])).toBe(true);
    expect(confirmouAMarcacao(["Oi"])).toBe(false);
    expect(confirmouAMarcacao(["Oi", "Obrigada!"])).toBe(false);
    expect(confirmouAMarcacao(["Oi", "Não"])).toBe(false);
    expect(confirmouAMarcacao(["Sim", "Melhor não"])).toBe(false);
    expect(confirmouAMarcacao(["Beleza", "Espera"])).toBe(false);
    expect(confirmouAMarcacao(["Sim", "Quanto custa?"])).toBe(false);
  });

  it("o procedimento só vale quando é o da reserva", () => {
    const limpeza = "Limpeza de pele";
    for (const texto of [
      "Pode marcar a limpeza",
      "Pode marcar a limpeza de pele",
      "Sim, pode agendar a limpeza",
      "Confirmo a limpeza de pele",
    ]) {
      expect(confirmouAMarcacao([texto], limpeza)).toBe(true);
      // A reserva e de outro procedimento (ou nao se sabe): nao e sim.
      expect(confirmouAMarcacao([texto], "Consulta dermatológica")).toBe(false);
      expect(confirmouAMarcacao([texto])).toBe(false);
    }
    expect(confirmouAMarcacao(["Não pode marcar a limpeza"], limpeza)).toBe(false);
    expect(confirmouAMarcacao(["Pode marcar a limpeza?"], limpeza)).toBe(false);
  });

  it("na remarcação, os verbos de remarcar continuam valendo, sem nenhum de cancelar", () => {
    for (const texto of ["Remarcar", "Pode remarcar", "Agenda", "Sim", "Tá bom"]) {
      expect(confirmouARemarcacao([texto])).toBe(true);
    }
    for (const texto of ["Não, melhor não", "Pode cancelar", "Sim?"]) {
      expect(confirmouARemarcacao([texto])).toBe(false);
    }
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
