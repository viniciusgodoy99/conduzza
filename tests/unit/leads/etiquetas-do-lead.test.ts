import { describe, expect, it } from "vitest";

import type { EtiquetaDeConversa } from "@/lib/domain/etiquetas-de-conversa";
import {
  chaveDaEtiqueta,
  etiquetasDoLead,
  grafiaDaEtiqueta,
  opcoesDeEtiqueta,
  outrasGrafias,
  SEM_TONS,
  tonsDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";

// Etiquetas do lead (relato do dono em 20/10/2026: "nao ta adicionando nem
// aparecendo as que ja existem"). A logica pura por tras do "Etiquetar
// lead" e dos chips: a mesma etiqueta ignorando maiuscula e acento conta
// uma vez, a cadastrada em Configuracoes vence com a grafia e o tom dela, a
// grafia que a clinica ja usa e reaproveitada, e sem cadastrada o tom e
// neutro.

// O catalogo da Salud Care na producao, mais uma com acento.
const CATALOGO: EtiquetaDeConversa[] = [
  { id: "e1", chave: "avaliacao", nome: "Avaliação", tom: "warning" },
  { id: "e2", chave: "cliente", nome: "Cliente", tom: "info" },
  { id: "e3", chave: "salud_care", nome: "SALUD CARE", tom: "success" },
  { id: "e4", chave: "urgente", nome: "Urgente", tom: "alert" },
];

describe("chave de comparação", () => {
  it("ignora maiúscula, acento e espaço sobrando", () => {
    expect(chaveDaEtiqueta("  Avaliação   Inicial ")).toBe("avaliacao inicial");
    expect(chaveDaEtiqueta("AVALIACAO INICIAL")).toBe("avaliacao inicial");
    expect(chaveDaEtiqueta("LEAD")).toBe(chaveDaEtiqueta("lead"));
    expect(chaveDaEtiqueta("Indicação")).toBe("indicacao");
  });
});

describe("as etiquetas da clínica no Etiquetar lead", () => {
  it("junta as cadastradas e as em uso, sem repetir, em ordem de nome", () => {
    const opcoes = opcoesDeEtiqueta(CATALOGO, [
      { tags: ["LEAD"] },
      { tags: ["LEAD", "cliente"] },
      { tags: ["lead", "Retorno"] },
      { tags: [] },
    ]);
    expect(opcoes).toEqual([
      { nome: "Avaliação", tom: "warning", cadastrada: true },
      { nome: "Cliente", tom: "info", cadastrada: true },
      { nome: "LEAD", tom: "neutral", cadastrada: false },
      { nome: "Retorno", tom: "neutral", cadastrada: false },
      { nome: "SALUD CARE", tom: "success", cadastrada: true },
      { nome: "Urgente", tom: "alert", cadastrada: true },
    ]);
  });

  it("a cadastrada vence e mantém a grafia dela, mesmo com outra mais usada nos leads", () => {
    const opcoes = opcoesDeEtiqueta(CATALOGO, [
      { tags: ["URGENTE"] },
      { tags: ["URGENTE"] },
      { tags: ["avaliacao"] },
    ]);
    const nomes = opcoes.map((opcao) => opcao.nome);
    expect(nomes).toContain("Urgente");
    expect(nomes).toContain("Avaliação");
    expect(nomes).not.toContain("URGENTE");
    expect(nomes).not.toContain("avaliacao");
    expect(opcoes).toHaveLength(CATALOGO.length);
  });

  it("entre as só em uso, fica a grafia mais usada", () => {
    const opcoes = opcoesDeEtiqueta(
      [],
      [{ tags: ["lead"] }, { tags: ["LEAD"] }, { tags: ["LEAD"] }],
    );
    expect(opcoes).toEqual([
      { nome: "LEAD", tom: "neutral", cadastrada: false },
    ]);
  });

  it("sem cadastradas (leitura com erro) ficam só as em uso; sem nada, vazio", () => {
    expect(opcoesDeEtiqueta([], [{ tags: ["Retorno"] }])).toEqual([
      { nome: "Retorno", tom: "neutral", cadastrada: false },
    ]);
    expect(opcoesDeEtiqueta([], [{ tags: [] }])).toEqual([]);
  });
});

describe("a grafia que entra pelo campo de texto", () => {
  const opcoes = opcoesDeEtiqueta(CATALOGO, [{ tags: ["LEAD"] }]);

  it("reaproveita a grafia que a clínica já usa", () => {
    expect(grafiaDaEtiqueta("lead", opcoes)).toBe("LEAD");
    expect(grafiaDaEtiqueta(" Lead ", opcoes)).toBe("LEAD");
    expect(grafiaDaEtiqueta("avaliacao", opcoes)).toBe("Avaliação");
    expect(grafiaDaEtiqueta("salud care", opcoes)).toBe("SALUD CARE");
  });

  it("etiqueta nova entra aparada, com um espaço só entre as palavras", () => {
    expect(grafiaDaEtiqueta("  Retorno   de botox ", opcoes)).toBe(
      "Retorno de botox",
    );
    expect(grafiaDaEtiqueta("   ", opcoes)).toBe("");
  });
});

describe("outras grafias da mesma etiqueta nos selecionados", () => {
  it("saem quando a grafia certa entra", () => {
    expect(
      outrasGrafias("LEAD", [
        { tags: ["lead", "Cliente"] },
        { tags: ["Lead"] },
        { tags: ["LEAD"] },
      ]),
    ).toEqual(["lead", "Lead"]);
  });

  it("nada a tirar quando os selecionados não têm outra grafia", () => {
    expect(outrasGrafias("LEAD", [{ tags: ["LEAD", "Cliente"] }])).toEqual([]);
    expect(outrasGrafias("Cliente", [{ tags: [] }])).toEqual([]);
  });
});

describe("os chips do lead", () => {
  const tons = tonsDasEtiquetas(CATALOGO);

  it("o tom é o da cadastrada com o mesmo nome, ignorando maiúscula e acento", () => {
    expect(etiquetasDoLead(["urgente", "AVALIACAO"], tons)).toEqual([
      { nome: "AVALIACAO", tom: "warning" },
      { nome: "urgente", tom: "alert" },
    ]);
  });

  it("sem cadastrada, neutro; a grafia é a do lead", () => {
    expect(etiquetasDoLead(["LEAD", "Cliente"], tons)).toEqual([
      { nome: "Cliente", tom: "info" },
      { nome: "LEAD", tom: "neutral" },
    ]);
    expect(etiquetasDoLead(["Cliente"], SEM_TONS)).toEqual([
      { nome: "Cliente", tom: "neutral" },
    ]);
  });
});
