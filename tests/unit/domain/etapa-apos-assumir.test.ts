import { describe, expect, it } from "vitest";

import { etapaAposAssumir } from "@/lib/domain/jornada";

// A regra que move o lead ao assumir a conversa: defensiva por construcao,
// porque em_contato e etapa livre (a clinica pode renomear ou excluir) e o
// clique em Assumir nunca pode desfazer progresso real do funil.

const JORNADA = [
  { chave: "novo", papel: "entrada" as const },
  { chave: "em_contato", papel: null },
  { chave: "agendou", papel: "agendou" as const },
  { chave: "perdido", papel: "perdido" as const },
];

describe("etapaAposAssumir", () => {
  it("lead na etapa de entrada vai para em_contato", () => {
    expect(
      etapaAposAssumir({
        kind: "lead",
        etapaAtual: JORNADA[0]!,
        jornada: JORNADA,
      }),
    ).toBe("em_contato");
  });

  it("paciente não se move", () => {
    expect(
      etapaAposAssumir({
        kind: "paciente",
        etapaAtual: JORNADA[0]!,
        jornada: JORNADA,
      }),
    ).toBeNull();
  });

  it("lead que já avançou (ou se perdeu) não volta", () => {
    expect(
      etapaAposAssumir({
        kind: "lead",
        etapaAtual: JORNADA[2]!,
        jornada: JORNADA,
      }),
    ).toBeNull();
    expect(
      etapaAposAssumir({
        kind: "lead",
        etapaAtual: JORNADA[3]!,
        jornada: JORNADA,
      }),
    ).toBeNull();
  });

  it("clínica que excluiu a etapa em_contato: nada acontece", () => {
    const semEmContato = JORNADA.filter((e) => e.chave !== "em_contato");
    expect(
      etapaAposAssumir({
        kind: "lead",
        etapaAtual: semEmContato[0]!,
        jornada: semEmContato,
      }),
    ).toBeNull();
  });

  it("etapa atual desconhecida (dado torto): não move", () => {
    expect(
      etapaAposAssumir({ kind: "lead", etapaAtual: null, jornada: JORNADA }),
    ).toBeNull();
  });

  it("entrada renomeada continua sendo entrada: move pelo PAPEL, não pelo nome", () => {
    const renomeada = [
      { chave: "chegou_agora", papel: "entrada" as const },
      ...JORNADA.slice(1),
    ];
    expect(
      etapaAposAssumir({
        kind: "lead",
        etapaAtual: renomeada[0]!,
        jornada: renomeada,
      }),
    ).toBe("em_contato");
  });
});
