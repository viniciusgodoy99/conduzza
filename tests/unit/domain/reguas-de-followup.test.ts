import { describe, expect, it } from "vitest";

import {
  chaveDaEtiqueta,
  chavesDeEtiquetas,
  etiquetasCasam,
  recusaDasEtiquetas,
} from "@/lib/domain/etiquetas-do-lead";
import {
  agruparReguasPorEtapa,
  avisoAoDesligar,
  avisoDeEtapaSemGeral,
  avisoDeGeralDesligada,
  avisoDeSemRegua,
  compararPrecedencia,
  ehReguaGeral,
  mesmoFiltro,
  modoDoFiltro,
  nomeSugeridoDaRegua,
  novaOrdemDasReguas,
  novaReguaDeFollowupSchema,
  opcoesDaEtapa,
  ordemDasReguasSchema,
  paraQuemDaReguaSchema,
  RECUSAS_DA_REGUA,
  REGRA_DA_ORDEM,
  REGRA_DA_PRECEDENCIA,
  reguaQueVale,
  reguasEmOrdem,
  textoDasEtiquetas,
  textoDeParaQuem,
  type ReguaDaPrecedencia,
} from "@/lib/domain/reguas-de-followup";

// Reguas de follow-up por etiqueta (onda 4, item 16; decisoes D1 a D4 do
// dono). reguaQueVale e o ESPELHO de regua_de_followup_do_contato, a funcao
// do banco que o planejador e o executor usam: so regua ligada conta (D4),
// com etiqueta vem antes da geral, entre as com etiqueta vale a de cima
// (prioridade, depois a mais antiga, D2), a etiqueta conta pelo nome sem
// maiuscula e acento (D1). O banco de verdade esta nos testes de integracao.

function regua(
  id: string,
  campos: Partial<ReguaDaPrecedencia> = {},
): ReguaDaPrecedencia {
  return {
    id,
    active: true,
    etiquetas: [],
    etiquetas_modo: "qualquer",
    prioridade: 0,
    created_at: "2026-10-24T12:00:00.000000+00:00",
    ...campos,
  };
}

const GERAL = regua("g");
const PSIQUIATRIA = regua("p", { etiquetas: ["Psiquiatria"], prioridade: 1 });
const ODONTO = regua("o", { etiquetas: ["Odontologia"], prioridade: 2 });
const chaves = (...nomes: string[]) => nomes.map(chaveDaEtiqueta);

describe("reguaQueVale (espelho da precedência do banco)", () => {
  it("com etiqueta acima da geral; sem etiqueta, a geral", () => {
    const daEtapa = [GERAL, ODONTO, PSIQUIATRIA];
    expect(reguaQueVale(daEtapa, chaves("Psiquiatria"))?.id).toBe("p");
    expect(reguaQueVale(daEtapa, chaves("Odontologia"))?.id).toBe("o");
    expect(reguaQueVale(daEtapa, [])?.id).toBe("g");
    expect(reguaQueVale(daEtapa, chaves("Outra"))?.id).toBe("g");
  });

  it("com as duas etiquetas, vale a de cima na ordem da clínica (D2)", () => {
    const daEtapa = [GERAL, ODONTO, PSIQUIATRIA];
    expect(
      reguaQueVale(daEtapa, chaves("Odontologia", "Psiquiatria"))?.id,
    ).toBe("p");
    // A clinica sobe a Odontologia: passa a valer ela.
    const reordenadas = [
      GERAL,
      { ...ODONTO, prioridade: 0 },
      { ...PSIQUIATRIA, prioridade: 1 },
    ];
    expect(
      reguaQueVale(reordenadas, chaves("Odontologia", "Psiquiatria"))?.id,
    ).toBe("o");
  });

  it("empate de prioridade: a mais antiga, depois o id", () => {
    const antiga = regua("z", {
      etiquetas: ["A"],
      created_at: "2026-10-24T12:00:00.000000+00:00",
    });
    const nova = regua("a", {
      etiquetas: ["A", "B"],
      created_at: "2026-10-24T12:00:00.5+00:00",
    });
    expect(reguaQueVale([nova, antiga], chaves("A", "B"))?.id).toBe("z");
    const mesmaHora = regua("b", { etiquetas: ["B"] });
    const mesmaHora2 = regua("a", {
      etiquetas: ["B"],
      etiquetas_modo: "todas",
    });
    expect(reguaQueVale([mesmaHora, mesmaHora2], chaves("B"))?.id).toBe("a");
  });

  it("desligada não conta: os leads dela caem na geral (D4)", () => {
    const desligada = { ...PSIQUIATRIA, active: false };
    expect(reguaQueVale([GERAL, desligada], chaves("Psiquiatria"))?.id).toBe(
      "g",
    );
    expect(
      reguaQueVale(
        [{ ...GERAL, active: false }, desligada],
        chaves("Psiquiatria"),
      ),
    ).toBeNull();
  });

  it("todas e qualquer uma", () => {
    const todas = regua("t", {
      etiquetas: ["Psiquiatria", "Adulto"],
      etiquetas_modo: "todas",
    });
    const qualquer = regua("q", {
      etiquetas: ["Psiquiatria", "Adulto"],
      etiquetas_modo: "qualquer",
      prioridade: 1,
    });
    expect(reguaQueVale([todas], chaves("Psiquiatria"))).toBeNull();
    expect(reguaQueVale([todas], chaves("Psiquiatria", "Adulto"))?.id).toBe(
      "t",
    );
    expect(reguaQueVale([todas, qualquer], chaves("Adulto"))?.id).toBe("q");
  });

  it("nenhuma: etapa só com régua por etiqueta e lead sem a etiqueta", () => {
    expect(reguaQueVale([PSIQUIATRIA, ODONTO], [])).toBeNull();
    expect(reguaQueVale([], chaves("Psiquiatria"))).toBeNull();
  });

  it("a etiqueta conta pelo nome sem maiúscula e acento (D1)", () => {
    const avaliacao = regua("a", { etiquetas: ["Avaliação"] });
    expect(reguaQueVale([avaliacao], chaves(" AVALIACAO "))?.id).toBe("a");
  });

  it("a ordem da tela é a da precedência: com etiqueta primeiro, a geral no fim", () => {
    expect(
      reguasEmOrdem([GERAL, ODONTO, PSIQUIATRIA]).map((item) => item.id),
    ).toEqual(["p", "o", "g"]);
    expect(compararPrecedencia(GERAL, PSIQUIATRIA)).toBeGreaterThan(0);
    expect(ehReguaGeral(GERAL)).toBe(true);
    expect(ehReguaGeral(PSIQUIATRIA)).toBe(false);
  });
});

describe("o filtro por etiqueta (espelhos das funções do banco)", () => {
  it("chaves distintas e ordenadas, sem a vazia", () => {
    expect(
      chavesDeEtiquetas(["Psiquiatria", " psiquiatria ", "Ação", ""]),
    ).toEqual(["acao", "psiquiatria"]);
  });

  it("lista vazia casa sempre; qualquer = interseção; todas = contém", () => {
    expect(etiquetasCasam([], [], "todas")).toBe(true);
    expect(etiquetasCasam(chaves("a"), ["A", "B"], "qualquer")).toBe(true);
    expect(etiquetasCasam(chaves("a"), ["A", "B"], "todas")).toBe(false);
    expect(etiquetasCasam(chaves("a", "b", "c"), ["A", "B"], "todas")).toBe(
      true,
    );
  });

  it("mesmo filtro: as mesmas chaves e o mesmo modo (o índice do banco)", () => {
    expect(
      mesmoFiltro(
        { etiquetas: ["Psiquiatria", "Adulto"], etiquetas_modo: "todas" },
        { etiquetas: ["adulto", "PSIQUIATRIA"], etiquetas_modo: "todas" },
      ),
    ).toBe(true);
    // Com duas ou mais, o modo muda o filtro.
    expect(
      mesmoFiltro(
        { etiquetas: ["Psiquiatria", "Adulto"], etiquetas_modo: "todas" },
        { etiquetas: ["Psiquiatria", "Adulto"], etiquetas_modo: "qualquer" },
      ),
    ).toBe(false);
  });

  it("com uma etiqueta só (ou nenhuma), todas e qualquer são o mesmo filtro (revisão de 21/10/2026)", () => {
    // A régua [A] em todas e a [a] em qualquer filtram as mesmas pessoas: a
    // segunda na etapa tem de ser recusada (o check do banco guarda sempre
    // qualquer com menos de duas etiquetas).
    expect(
      mesmoFiltro(
        { etiquetas: ["Psiquiatria"], etiquetas_modo: "todas" },
        { etiquetas: ["psiquiatria"], etiquetas_modo: "qualquer" },
      ),
    ).toBe(true);
    expect(
      mesmoFiltro(
        { etiquetas: [], etiquetas_modo: "todas" },
        { etiquetas: [], etiquetas_modo: "qualquer" },
      ),
    ).toBe(true);
    expect(modoDoFiltro(["Psiquiatria"], "todas")).toBe("qualquer");
    expect(modoDoFiltro([], "todas")).toBe("qualquer");
    expect(modoDoFiltro(["Psiquiatria", "Adulto"], "todas")).toBe("todas");
    expect(modoDoFiltro(["Psiquiatria", "Adulto"], "qualquer")).toBe(
      "qualquer",
    );
  });

  it("a validação de etiquetas_validas: até 10, de 1 a 40, sem repetir pela chave", () => {
    expect(recusaDasEtiquetas(["A", "B"], 10)).toBeNull();
    expect(
      recusaDasEtiquetas(
        Array.from({ length: 11 }, (_, i) => `E${i}`),
        10,
      ),
    ).toBe("Escolha até 10 etiquetas.");
    expect(recusaDasEtiquetas(["x".repeat(41)], 10)).toBe(
      "Cada etiqueta vai de 1 a 40 caracteres.",
    );
    expect(recusaDasEtiquetas([" com ponta "], 10)).toBe(
      "Cada etiqueta vai de 1 a 40 caracteres.",
    );
    expect(recusaDasEtiquetas(["Psiquiatria", "psiquiatría"], 10)).toBe(
      "A etiqueta psiquiatría aparece duas vezes.",
    );
  });
});

describe("frases da tela", () => {
  it("as etiquetas do filtro, com qualquer uma ou todas", () => {
    expect(textoDasEtiquetas(["Psiquiatria"], "qualquer")).toBe("Psiquiatria");
    expect(textoDasEtiquetas(["A", "B"], "qualquer")).toBe("A ou B");
    expect(textoDasEtiquetas(["A", "B", "C"], "todas")).toBe("A, B e C");
    expect(textoDasEtiquetas([], "todas")).toBe("");
  });

  it("para quem e o nome sugerido", () => {
    expect(textoDeParaQuem(PSIQUIATRIA)).toBe("Leads com Psiquiatria.");
    expect(textoDeParaQuem(GERAL)).toBe(
      "Régua geral da etapa: vale para quem não tem as etiquetas das outras réguas.",
    );
    expect(nomeSugeridoDaRegua("Em contato", [], "qualquer")).toBe(
      "Follow-up de Em contato",
    );
    expect(
      nomeSugeridoDaRegua(
        "Em contato",
        ["Psiquiatria", "Odontologia"],
        "qualquer",
      ),
    ).toBe("Follow-up de Em contato: Psiquiatria ou Odontologia");
    const longo = nomeSugeridoDaRegua(
      "Etapa com um nome bem comprido",
      ["x".repeat(30), "y".repeat(30)],
      "todas",
    );
    expect(longo.length).toBeLessThanOrEqual(80);
    expect(longo.endsWith("...")).toBe(true);
  });

  it("os avisos fixos da etapa e o de desligar", () => {
    expect(REGRA_DA_PRECEDENCIA).toBe(
      "Se o lead tiver as etiquetas de mais de uma régua, vale a de cima. Quem não tiver nenhuma recebe a régua geral da etapa.",
    );
    expect(avisoDeSemRegua(3, "Em contato")).toBe(
      "3 leads de Em contato não recebem nenhuma régua.",
    );
    expect(avisoDeSemRegua(1, "Em contato")).toBe(
      "1 lead de Em contato não recebe nenhuma régua.",
    );
    expect(avisoAoDesligar(PSIQUIATRIA)).toBe(
      "Os leads com Psiquiatria passam a receber a régua geral da etapa, se ela estiver ligada.",
    );
  });

  it("o que cada lead da etapa recebe, para a confirmação em Leads", () => {
    expect(opcoesDaEtapa([PSIQUIATRIA, ODONTO, GERAL])).toBe(
      "Psiquiatria, Odontologia ou a geral",
    );
    expect(opcoesDaEtapa([PSIQUIATRIA, ODONTO])).toBe(
      "Psiquiatria ou Odontologia",
    );
    expect(opcoesDaEtapa([PSIQUIATRIA])).toBe("Psiquiatria");
  });

  it("nenhum travessão", () => {
    for (const texto of [
      REGRA_DA_PRECEDENCIA,
      REGRA_DA_ORDEM,
      avisoDeEtapaSemGeral("Em contato"),
      avisoDeGeralDesligada("Em contato"),
      avisoDeSemRegua(2, "Em contato"),
      avisoAoDesligar(PSIQUIATRIA),
      textoDeParaQuem(GERAL),
      ...Object.values(RECUSAS_DA_REGUA),
    ]) {
      expect(texto).not.toMatch(/[–—]/);
    }
  });
});

describe("a tela agrupada por etapa", () => {
  const comEtapa = (
    base: ReguaDaPrecedencia,
    trigger_stage: string,
    etapa_nome: string,
  ) => ({ ...base, trigger_stage, etapa_nome });

  it("na ordem da jornada, com etiqueta na ordem e a geral à parte", () => {
    const grupos = agruparReguasPorEtapa(
      [
        comEtapa(GERAL, "em_contato", "Em contato"),
        comEtapa(ODONTO, "em_contato", "Em contato"),
        comEtapa(regua("n"), "novo", "Novo"),
        comEtapa(PSIQUIATRIA, "em_contato", "Em contato"),
        comEtapa(regua("x"), "apagada", "Etapa velha"),
      ],
      [
        { chave: "novo", nome: "Novo" },
        { chave: "em_contato", nome: "Em contato" },
        { chave: "agendou", nome: "Agendou" },
      ],
    );
    expect(
      grupos.map((grupo) => ({
        chave: grupo.chave,
        nome: grupo.nome,
        comEtiqueta: grupo.comEtiqueta.map((item) => item.id),
        geral: grupo.geral?.id ?? null,
      })),
    ).toEqual([
      { chave: "novo", nome: "Novo", comEtiqueta: [], geral: "n" },
      {
        chave: "em_contato",
        nome: "Em contato",
        comEtiqueta: ["p", "o"],
        geral: "g",
      },
      // Fora da jornada (cache velho): no fim, pelo nome guardado.
      { chave: "apagada", nome: "Etapa velha", comEtiqueta: [], geral: "x" },
    ]);
  });

  it("subir e descer: a lista nova que vai para a RPC", () => {
    const lista = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(novaOrdemDasReguas(lista, "b", -1)).toEqual(["b", "a", "c"]);
    expect(novaOrdemDasReguas(lista, "b", 1)).toEqual(["a", "c", "b"]);
    expect(novaOrdemDasReguas(lista, "a", -1)).toBeNull();
    expect(novaOrdemDasReguas(lista, "c", 1)).toBeNull();
    expect(novaOrdemDasReguas(lista, "z", 1)).toBeNull();
  });
});

describe("entradas das Server Actions", () => {
  it("régua nova: só a etapa é obrigatória (a geral, com o nome sugerido)", () => {
    expect(
      novaReguaDeFollowupSchema.parse({ trigger_stage: "em_contato" }),
    ).toEqual({
      trigger_stage: "em_contato",
      etiquetas: [],
      etiquetas_modo: "qualquer",
      nome: "",
    });
  });

  it("régua nova com etiquetas: limpas, até 10, sem repetir", () => {
    // Uma etiqueta só: o modo sai qualquer (modoDoFiltro), mesmo pedido todas.
    expect(
      novaReguaDeFollowupSchema.parse({
        trigger_stage: "em_contato",
        etiquetas: ["  Psiquiatria   adulta "],
        etiquetas_modo: "todas",
        nome: "  Psiquiatria  ",
      }),
    ).toEqual({
      trigger_stage: "em_contato",
      etiquetas: ["Psiquiatria adulta"],
      etiquetas_modo: "qualquer",
      nome: "Psiquiatria",
    });
    // Duas: o modo pedido fica.
    expect(
      novaReguaDeFollowupSchema.parse({
        trigger_stage: "em_contato",
        etiquetas: ["Psiquiatria", "Adulto"],
        etiquetas_modo: "todas",
      }).etiquetas_modo,
    ).toBe("todas");
    const repetida = novaReguaDeFollowupSchema.safeParse({
      trigger_stage: "em_contato",
      etiquetas: ["Psiquiatria", "PSIQUIATRIA"],
    });
    expect(repetida.success).toBe(false);
    expect(repetida.error?.issues[0]?.message).toBe(
      "A etiqueta PSIQUIATRIA aparece duas vezes.",
    );
    expect(
      novaReguaDeFollowupSchema.safeParse({
        trigger_stage: "Em Contato",
      }).success,
    ).toBe(false);
    expect(
      novaReguaDeFollowupSchema.safeParse({
        trigger_stage: "em_contato",
        nome: "x",
      }).success,
    ).toBe(false);
  });

  it("para quem e ordem", () => {
    expect(
      paraQuemDaReguaSchema.safeParse({
        cadence_id: "a1111111-1111-4111-8111-111111111111",
        nome: "Régua",
        etiquetas: ["A"],
        etiquetas_modo: "qualquer",
      }).success,
    ).toBe(true);
    // Tirar a segunda etiqueta de um filtro "todas" grava qualquer.
    expect(
      paraQuemDaReguaSchema.parse({
        cadence_id: "a1111111-1111-4111-8111-111111111111",
        nome: "Régua",
        etiquetas: ["A"],
        etiquetas_modo: "todas",
      }).etiquetas_modo,
    ).toBe("qualquer");
    expect(
      paraQuemDaReguaSchema.safeParse({
        cadence_id: "x",
        nome: "Régua",
        etiquetas: [],
        etiquetas_modo: "qualquer",
      }).success,
    ).toBe(false);
    expect(
      ordemDasReguasSchema.safeParse({ trigger_stage: "em_contato", ids: [] })
        .success,
    ).toBe(false);
  });
});
