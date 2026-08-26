import { describe, expect, it } from "vitest";

import { interpretarResposta } from "@/lib/domain/resposta-paciente";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";

describe("interpretarResposta", () => {
  it("le o botao pelo id e pelo rotulo, que e o que o uazapi devolve", () => {
    for (const opcao of MENU_CONFIRMACAO) {
      expect(interpretarResposta(opcao.id)).toBe(opcao.id);
      expect(interpretarResposta(opcao.text)).toBe(opcao.id);
    }
  });

  it("le o numero do fallback de texto numerado", () => {
    expect(interpretarResposta("1")).toBe("confirmar");
    expect(interpretarResposta("2")).toBe("remarcar");
    expect(interpretarResposta("3")).toBe("cancelar");
  });

  it("confirma nas formas comuns de dizer sim", () => {
    for (const texto of [
      "sim",
      "Sim",
      "SIM",
      "sim!",
      "confirmo",
      "Confirmo.",
      "confirmado",
      "ok",
      "OK!",
      "pode ser",
      "  confirmar  ",
    ]) {
      expect(interpretarResposta(texto)).toBe("confirmar");
    }
  });

  it("aceita emoji de joinha e de certo, sozinhos", () => {
    expect(interpretarResposta("👍")).toBe("confirmar");
    expect(interpretarResposta("👍🏽")).toBe("confirmar");
    expect(interpretarResposta("✅")).toBe("confirmar");
    expect(interpretarResposta("✔️")).toBe("confirmar");
    expect(interpretarResposta("👌")).toBe("confirmar");
    expect(interpretarResposta("sim 👍")).toBe("confirmar");
  });

  it("quando ha texto junto do emoji, quem manda e o texto", () => {
    expect(interpretarResposta("não vou 👍")).toBe("cancelar");
  });

  it("entende remarcar", () => {
    for (const texto of [
      "remarcar",
      "Remarcar",
      "reagendar",
      "Reagendar!",
      "mudar",
      "quero remarcar",
    ]) {
      expect(interpretarResposta(texto)).toBe("remarcar");
    }
  });

  it("entende cancelar, com e sem acento", () => {
    for (const texto of [
      "cancelar",
      "CANCELAR",
      "cancela",
      "desmarcar",
      "não vou",
      "nao vou",
      "Não vou.",
    ]) {
      expect(interpretarResposta(texto)).toBe("cancelar");
    }
  });

  // "11" e "10" nao sao confirmacao: quem digita isso quase sempre esta
  // falando de HORA ("11", "10 horas"), nao escolhendo a opcao 1. Confirmar
  // por engano faz a clinica contar com um paciente que nao vem; nao entender
  // so leva a conversa para a recepcao, que e o fail-safe.
  it("numero parecido com a opcao NAO confirma", () => {
    expect(interpretarResposta("11")).toBe("nao_reconhecida");
    expect(interpretarResposta("10")).toBe("nao_reconhecida");
    expect(interpretarResposta("1h")).toBe("nao_reconhecida");
    expect(interpretarResposta("13")).toBe("nao_reconhecida");
    expect(interpretarResposta("21")).toBe("nao_reconhecida");
  });

  it("frase que contem a palavra mas nega o sentido nao e interpretada", () => {
    expect(interpretarResposta("não vou poder confirmar hoje")).toBe(
      "nao_reconhecida",
    );
    expect(interpretarResposta("cancelar meu plano de saúde?")).toBe(
      "nao_reconhecida",
    );
  });

  it("vazio, nulo e so espaco nao viram intencao", () => {
    expect(interpretarResposta(null)).toBe("nao_reconhecida");
    expect(interpretarResposta("")).toBe("nao_reconhecida");
    expect(interpretarResposta("   ")).toBe("nao_reconhecida");
    expect(interpretarResposta("...")).toBe("nao_reconhecida");
  });

  it("pergunta livre do paciente vai para a recepcao", () => {
    expect(interpretarResposta("posso levar meu filho?")).toBe(
      "nao_reconhecida",
    );
    expect(interpretarResposta("qual o valor da consulta")).toBe(
      "nao_reconhecida",
    );
  });
});
