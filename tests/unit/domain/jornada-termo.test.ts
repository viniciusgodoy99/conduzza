import { describe, expect, it } from "vitest";

import { etapaPorTermoChave } from "@/lib/domain/jornada";

// Aceite da fase 4 da jornada configuravel: a decisao pura de mover contato
// por termo-chave. As regras de protecao (nunca sair de nem entrar em perda,
// so andar para frente) sao o que impede palavra solta de estragar o funil.

type Etapa = {
  chave: string;
  posicao: number;
  papel: "entrada" | "agendou" | "compareceu" | "perdido" | null;
  termos_chave: string[];
};

function etapa(
  chave: string,
  posicao: number,
  termos: string[] = [],
  papel: Etapa["papel"] = null,
): Etapa {
  return { chave, posicao, papel, termos_chave: termos };
}

const jornada: Etapa[] = [
  etapa("novo", 10, [], "entrada"),
  etapa("em_contato", 20, ["quero saber"]),
  etapa("orcamento", 30, ["valor", "quanto custa"]),
  etapa("agendou", 40, ["agendar"], "agendou"),
  etapa("compareceu", 50, [], "compareceu"),
  etapa("perdido", 60, ["nao quero"], "perdido"),
];

describe("etapaPorTermoChave", () => {
  it("corpo vazio ou nulo não move", () => {
    expect(etapaPorTermoChave(null, "novo", jornada)).toBeNull();
    expect(etapaPorTermoChave("   ", "novo", jornada)).toBeNull();
  });

  it("etapa atual fora da jornada (cache velho) não move", () => {
    expect(etapaPorTermoChave("valor", "etapa_fantasma", jornada)).toBeNull();
  });

  it("termo casa e move para a etapa dele", () => {
    const destino = etapaPorTermoChave(
      "oi, qual o valor da consulta?",
      "novo",
      jornada,
    );
    expect(destino?.chave).toBe("orcamento");
  });

  it("normaliza acento e maiúsculas dos dois lados", () => {
    const comAcento: Etapa[] = [
      etapa("novo", 10, [], "entrada"),
      etapa("avaliacao", 20, ["avaliação"]),
    ];
    expect(
      etapaPorTermoChave("Quero uma AVALIAÇÃO", "novo", comAcento)?.chave,
    ).toBe("avaliacao");
    expect(
      etapaPorTermoChave("quero uma avaliacao", "novo", comAcento)?.chave,
    ).toBe("avaliacao");
  });

  it("só anda para frente: termo de etapa anterior não volta o contato", () => {
    expect(
      etapaPorTermoChave("quero saber mais", "agendou", jornada),
    ).toBeNull();
  });

  it("termo da própria etapa não move (posição igual não é para frente)", () => {
    expect(etapaPorTermoChave("o valor", "orcamento", jornada)).toBeNull();
  });

  it("nunca move PARA a etapa de perda, mesmo com termo configurado nela", () => {
    expect(etapaPorTermoChave("nao quero", "novo", jornada)).toBeNull();
  });

  it("nunca move contato que ESTÁ na etapa de perda", () => {
    expect(etapaPorTermoChave("quero agendar", "perdido", jornada)).toBeNull();
  });

  it("o termo mais longo vence, como na atribuição de campanha", () => {
    // "quanto custa" (12) esta em orcamento; "agendar" (7) em agendou.
    const destino = etapaPorTermoChave(
      "quanto custa? ja quero agendar",
      "novo",
      jornada,
    );
    expect(destino?.chave).toBe("orcamento");
  });

  it("empate de comprimento fica com a etapa mais cedo na jornada", () => {
    const empatada: Etapa[] = [
      etapa("novo", 10, [], "entrada"),
      etapa("a", 20, ["pacote"]),
      etapa("b", 30, ["exames"]),
    ];
    expect(
      etapaPorTermoChave("quero pacote de exames", "novo", empatada)?.chave,
    ).toBe("a");
  });

  it("termo vazio ou só espaço na configuração nunca casa", () => {
    const suja: Etapa[] = [
      etapa("novo", 10, [], "entrada"),
      etapa("x", 20, ["", "  "]),
    ];
    expect(etapaPorTermoChave("qualquer texto", "novo", suja)).toBeNull();
  });
});
