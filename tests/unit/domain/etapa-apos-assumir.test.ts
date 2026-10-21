import { describe, expect, it } from "vitest";

import { etapaAposAssumir, type EtapaParaAssumir } from "@/lib/domain/jornada";

// A regra que move o lead quando a equipe pega a conversa (Assumir, e pela
// mesma regra Iniciar conversa, Transferir e Reabrir). Defensiva por
// construcao: o clique de atendimento nunca desfaz progresso real do funil.
//
// Desde a onda 3 (21/10/2026, migration 20261023100000) Em contato e
// Aguardando resposta sao etapas de SISTEMA (papeis 'em_contato' e
// 'aguardando'), e Aguardando resposta vem logo antes de Em contato. O
// codigo vai ao ar antes da migration, entao a regra vale para as duas
// formas do banco:
//   - banco NOVO: tudo por papel, Novo e Aguardando resposta vao para Em
//     contato;
//   - banco VELHO: as duas etapas sem papel; o destino e a CHAVE em_contato
//     (o comportamento de antes) e Aguardando resposta nao e origem.

type Etapa = EtapaParaAssumir;

/** A jornada semeada da onda 3: as seis etapas de sistema. */
const NOVA: Etapa[] = [
  { chave: "novo", papel: "entrada", posicao: 10 },
  { chave: "aguardando_resposta", papel: "aguardando", posicao: 20 },
  { chave: "em_contato", papel: "em_contato", posicao: 30 },
  { chave: "agendou", papel: "agendou", posicao: 40 },
  { chave: "compareceu", papel: "compareceu", posicao: 50 },
  { chave: "perdido", papel: "perdido", posicao: 60 },
];

/** A jornada de antes da migration: Em contato e Aguardando livres. */
const VELHA: Etapa[] = [
  { chave: "novo", papel: "entrada", posicao: 10 },
  { chave: "em_contato", papel: null, posicao: 20 },
  { chave: "aguardando_resposta", papel: null, posicao: 30 },
  { chave: "agendou", papel: "agendou", posicao: 40 },
  { chave: "compareceu", papel: "compareceu", posicao: 50 },
  { chave: "perdido", papel: "perdido", posicao: 60 },
];

function etapa(jornada: Etapa[], chave: string): Etapa {
  const achada = jornada.find((candidata) => candidata.chave === chave);
  if (!achada) {
    throw new Error(`etapa ${chave} fora da jornada do teste`);
  }
  return achada;
}

function destino(
  jornada: Etapa[],
  atual: string | null,
  kind: "lead" | "paciente" = "lead",
): string | null {
  return etapaAposAssumir({
    kind,
    etapaAtual: atual === null ? null : etapa(jornada, atual),
    jornada,
  });
}

describe("etapaAposAssumir com a jornada nova (por papel)", () => {
  it("lead em Novo vai para Em contato", () => {
    expect(destino(NOVA, "novo")).toBe("em_contato");
  });

  it("lead em Aguardando resposta vai para Em contato", () => {
    expect(destino(NOVA, "aguardando_resposta")).toBe("em_contato");
  });

  it("paciente fica parado, venha de Novo ou de Aguardando resposta", () => {
    expect(destino(NOVA, "novo", "paciente")).toBeNull();
    expect(destino(NOVA, "aguardando_resposta", "paciente")).toBeNull();
  });

  it("quem já está em Em contato, avançou ou se perdeu não se move", () => {
    for (const chave of ["em_contato", "agendou", "compareceu", "perdido"]) {
      expect(destino(NOVA, chave), chave).toBeNull();
    }
  });

  it("etapa livre não é origem, nem antes nem depois de Em contato", () => {
    const comLivres: Etapa[] = [
      ...NOVA,
      { chave: "pediu_valor", papel: null, posicao: 15 },
      { chave: "follow_1", papel: null, posicao: 35 },
    ];
    expect(destino(comLivres, "pediu_valor")).toBeNull();
    expect(destino(comLivres, "follow_1")).toBeNull();
  });

  it("Em contato renomeada e com outra chave: acha pelo PAPEL", () => {
    const renomeada: Etapa[] = NOVA.map((linha) =>
      linha.papel === "em_contato"
        ? { ...linha, chave: "contato_inicial" }
        : linha,
    );
    expect(destino(renomeada, "novo")).toBe("contato_inicial");
    expect(destino(renomeada, "aguardando_resposta")).toBe("contato_inicial");
  });

  it("o papel vence a chave: chave em_contato livre não é destino se o papel existe em outra", () => {
    const duas: Etapa[] = [
      { chave: "novo", papel: "entrada", posicao: 10 },
      { chave: "contato_inicial", papel: "em_contato", posicao: 20 },
      { chave: "em_contato", papel: null, posicao: 30 },
    ];
    expect(destino(duas, "novo")).toBe("contato_inicial");
  });

  it("entrada renomeada continua sendo entrada: move pelo PAPEL, não pelo nome", () => {
    const renomeada: Etapa[] = NOVA.map((linha) =>
      linha.papel === "entrada" ? { ...linha, chave: "chegou_agora" } : linha,
    );
    expect(destino(renomeada, "chegou_agora")).toBe("em_contato");
  });

  it("nunca para trás: Em contato antes da etapa atual não move", () => {
    // A ordem entre as etapas de sistema e fixa no banco, mas a regra nao
    // aposta nisso: destino com posicao menor ou igual nao anda.
    const invertida: Etapa[] = [
      { chave: "em_contato", papel: "em_contato", posicao: 10 },
      { chave: "novo", papel: "entrada", posicao: 20 },
      { chave: "aguardando_resposta", papel: "aguardando", posicao: 30 },
    ];
    expect(destino(invertida, "novo")).toBeNull();
    expect(destino(invertida, "aguardando_resposta")).toBeNull();
    const empatada: Etapa[] = [
      { chave: "aguardando_resposta", papel: "aguardando", posicao: 20 },
      { chave: "em_contato", papel: "em_contato", posicao: 20 },
    ];
    expect(destino(empatada, "aguardando_resposta")).toBeNull();
  });

  it("etapa atual desconhecida (dado torto): não move", () => {
    expect(destino(NOVA, null)).toBeNull();
  });
});

describe("etapaAposAssumir com a jornada de antes da migration (fallback pela chave)", () => {
  it("lead em Novo vai para em_contato, como sempre foi", () => {
    expect(destino(VELHA, "novo")).toBe("em_contato");
  });

  it("Aguardando resposta ainda sem papel não é origem: nada muda antes da migration", () => {
    expect(destino(VELHA, "aguardando_resposta")).toBeNull();
  });

  it("paciente e quem já avançou continuam parados", () => {
    expect(destino(VELHA, "novo", "paciente")).toBeNull();
    expect(destino(VELHA, "agendou")).toBeNull();
    expect(destino(VELHA, "perdido")).toBeNull();
  });

  it("clínica que excluiu em_contato: nada acontece", () => {
    const semEmContato = VELHA.filter((linha) => linha.chave !== "em_contato");
    expect(destino(semEmContato, "novo")).toBeNull();
  });

  it("Novo reordenado para depois de em_contato: não anda para trás", () => {
    const reordenada: Etapa[] = [
      { chave: "em_contato", papel: null, posicao: 10 },
      { chave: "novo", papel: "entrada", posicao: 20 },
    ];
    expect(destino(reordenada, "novo")).toBeNull();
  });
});

describe("sem a etapa de destino", () => {
  it("jornada sem papel em_contato e sem a chave: nada acontece", () => {
    const sem: Etapa[] = NOVA.filter((linha) => linha.papel !== "em_contato");
    expect(destino(sem, "novo")).toBeNull();
    expect(destino(sem, "aguardando_resposta")).toBeNull();
  });
});
