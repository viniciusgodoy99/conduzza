import { describe, expect, it } from "vitest";

import {
  buscarProcedimento,
  entradaDaBuscaSchema,
  FERRAMENTA_BUSCAR_PROCEDIMENTO,
  identificarConvenio,
  limiteDaSaidaDaBusca,
  MAXIMO_DE_OPCOES,
  montarCatalogoDoAgente,
  nomesDoCatalogo,
  PALAVRAS_DE_LIGACAO,
  PALAVRAS_QUE_NAO_DISTINGUEM,
  type CatalogoDoAgente,
  type ConvenioDoAgente,
  type LinhasDoCatalogo,
  type ProcedimentoDoIndice,
  type ResultadoDaBusca,
} from "@/lib/agente/ferramentas/buscar-procedimento";
import {
  entradaDoEscalonamentoSchema,
  FERRAMENTA_ESCALAR_HUMANO,
  MOTIVOS_DO_AGENTE,
  motivoDoEscalonamento,
} from "@/lib/agente/ferramentas/escalar-humano";
import { MOTIVOS_DE_ESCALONAMENTO } from "@/lib/domain/agente/config";
import { normalizarBase } from "@/lib/domain/conformidade/normalizar";

// As ferramentas do agente (E2): buscar_procedimento le o catalogo carregado
// (indice so com "IA pode agendar" nas duas chaves; preco 0, coberto e sem
// valor sao coisas diferentes; todo valor devolvido vai para precosDoTurno)
// e escalar_humano nunca falha. Puro, sem banco nem rede.
//
// Regra do convenio (06/10/2026, uma regra so): valor e cobertura so saem
// quando o que foi dito identifica EXATAMENTE UM convenio do Cadastro inteiro
// (seletor exato, ou candidato completo unico e ninguem mais com todas as
// palavras ditas); qualquer duvida vira opcoes sem valor, cada uma com o
// rotulo (chamar_com) que a identifica.

const PROC = {
  consulta: "11111111-1111-4111-8111-111111111111",
  limpeza: "22222222-2222-4222-8222-222222222222",
  avaliacao: "33333333-3333-4333-8333-333333333333",
  semIa: "44444444-4444-4444-8444-444444444444",
  inativo: "55555555-5555-4555-8555-555555555555",
  semVinculo: "66666666-6666-4666-8666-666666666666",
};
const PROF = {
  helena: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  joao: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  saiu: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const CONV = {
  unimed: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  amil: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  inativo: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};

function vinculo(
  campos: Partial<LinhasDoCatalogo["vinculos"][number]> & {
    procedure_id: string;
  },
): LinhasDoCatalogo["vinculos"][number] {
  return {
    professional_id: PROF.helena,
    insurance_id: null,
    price_cents: null,
    covered_by_insurance: false,
    bookable_by_ai: true,
    active: true,
    ...campos,
  };
}

const LINHAS: LinhasDoCatalogo = {
  procedimentos: [
    {
      id: PROC.limpeza,
      name: "Limpeza de pele",
      active: true,
      bookable_by_ai: true,
    },
    { id: PROC.consulta, name: "Consulta", active: true, bookable_by_ai: true },
    {
      id: PROC.avaliacao,
      name: "Avaliação",
      active: true,
      bookable_by_ai: true,
    },
    { id: PROC.semIa, name: "Botox", active: true, bookable_by_ai: false },
    { id: PROC.inativo, name: "Peeling", active: false, bookable_by_ai: true },
    {
      id: PROC.semVinculo,
      name: "Drenagem",
      active: true,
      bookable_by_ai: true,
    },
  ],
  vinculos: [
    vinculo({ procedure_id: PROC.consulta, price_cents: 31_700 }),
    vinculo({
      procedure_id: PROC.consulta,
      professional_id: PROF.joao,
      price_cents: 25_000,
    }),
    vinculo({
      procedure_id: PROC.consulta,
      insurance_id: CONV.unimed,
      covered_by_insurance: true,
    }),
    vinculo({
      procedure_id: PROC.consulta,
      professional_id: PROF.joao,
      insurance_id: CONV.amil,
      price_cents: 8_000,
    }),
    vinculo({ procedure_id: PROC.avaliacao, price_cents: 0 }),
    vinculo({ procedure_id: PROC.limpeza, price_cents: null }),
    vinculo({
      procedure_id: PROC.limpeza,
      professional_id: PROF.saiu,
      price_cents: 9_900,
    }),
    vinculo({ procedure_id: PROC.semIa, price_cents: 120_000 }),
    vinculo({ procedure_id: PROC.inativo, price_cents: 50_000 }),
    vinculo({
      procedure_id: PROC.semVinculo,
      price_cents: 10_000,
      bookable_by_ai: false,
    }),
    vinculo({
      procedure_id: PROC.limpeza,
      insurance_id: CONV.inativo,
      covered_by_insurance: true,
    }),
  ],
  profissionais: [
    { id: PROF.helena, name: "Dra. Helena", active: true },
    { id: PROF.joao, name: "Dr. João", active: true },
    { id: PROF.saiu, name: "Dra. Antiga", active: false },
  ],
  convenios: [
    { id: CONV.unimed, name: "Unimed", plan_name: "Nacional", active: true },
    { id: CONV.amil, name: "Amil", plan_name: null, active: true },
    { id: CONV.inativo, name: "Bradesco", plan_name: null, active: false },
  ],
};

const CATALOGO = montarCatalogoDoAgente(LINHAS);

function codigo(nome: string, catalogo: CatalogoDoAgente = CATALOGO): string {
  const achado = catalogo.procedimentos.find((p) => p.nome === nome);
  if (!achado) {
    throw new Error(`procedimento ${nome} fora do indice`);
  }
  return achado.codigo;
}

function saida(resultado: { saida: string }): Record<string, unknown> {
  return JSON.parse(resultado.saida) as Record<string, unknown>;
}

/**
 * Um catalogo de teste: Consulta (com particular de R$ 200 da Dra. Helena)
 * e Exame (so entra no indice com vinculo), os convenios ativos e os
 * vinculos dados.
 */
function catalogoDe(
  convenios: readonly (readonly [string, string, string | null])[],
  vinculos: readonly LinhasDoCatalogo["vinculos"][number][] = [],
): CatalogoDoAgente {
  return montarCatalogoDoAgente({
    procedimentos: [
      {
        id: PROC.consulta,
        name: "Consulta",
        active: true,
        bookable_by_ai: true,
      },
      { id: PROC.avaliacao, name: "Exame", active: true, bookable_by_ai: true },
    ],
    profissionais: [
      { id: PROF.helena, name: "Dra. Helena", active: true },
      { id: PROF.joao, name: "Dr. João", active: true },
    ],
    convenios: convenios.map(([id, name, plan_name]) => ({
      id,
      name,
      plan_name,
      active: true,
    })),
    vinculos: [
      vinculo({ procedure_id: PROC.consulta, price_cents: 20_000 }),
      ...vinculos,
    ],
  });
}

/** Vinculo da Consulta (ou do Exame) num convenio. */
function noConvenio(
  convenio: string,
  campos: Partial<LinhasDoCatalogo["vinculos"][number]> = {},
): LinhasDoCatalogo["vinculos"][number] {
  return vinculo({
    procedure_id: PROC.consulta,
    insurance_id: convenio,
    ...campos,
  });
}

function consultar(
  catalogo: CatalogoDoAgente,
  dito: string | null,
  procedimento = "Consulta",
): ResultadoDaBusca {
  return buscarProcedimento(catalogo, {
    procedimento: codigo(procedimento, catalogo),
    convenio: dito,
  });
}

/** Nenhum valor nem cobertura de convenio: so as opcoes. */
function semValor(r: ResultadoDaBusca, dito: string): void {
  expect(r.precos, dito).toEqual([]);
  expect(r.saida, dito).not.toContain("R$");
  expect(r.saida, dito).not.toContain('"valor"');
  expect(r.saida, dito).not.toContain('"atendimentos"');
  expect(r.resultado, dito).not.toBe("convenio");
}

const PREFIXO = "Consultou o convênio do paciente para Consulta";

/** A trilha do convenio_nao_informado (sem afirmar que o paciente nao disse). */
const NAO_IDENTIFICA =
  "a consulta não trouxe um nome de convênio que dê para identificar";
const SEM_NOME = `${PREFIXO}: ${NAO_IDENTIFICA}`;

type Opcao = { convenio: string; chamar_com: string; situacao?: string };

/** As opcoes e os planos que a saida traz para o paciente escolher. */
function listadas(s: Record<string, unknown>): Opcao[] {
  return [
    ...((s.opcoes ?? []) as Opcao[]),
    ...((s.planos_da_operadora ?? []) as Opcao[]),
  ];
}

/** Cada opcao, mandada de volta, identifica so ela. */
function voltaNaPropria(catalogo: CatalogoDoAgente, r: ResultadoDaBusca): void {
  for (const opcao of listadas(saida(r))) {
    const volta = consultar(catalogo, opcao.chamar_com);
    expect(["convenio", "convenio_sem_informacao"], opcao.chamar_com).toContain(
      volta.resultado,
    );
    expect(saida(volta).convenio, opcao.chamar_com).toBe(opcao.convenio);
  }
}

describe("montarCatalogoDoAgente", () => {
  it("indexa só procedimento ativo, com IA nas duas chaves e vínculo válido, por nome", () => {
    expect(CATALOGO.procedimentos.map((p) => [p.codigo, p.nome])).toEqual([
      ["p1", "Avaliação"],
      ["p2", "Consulta"],
      ["p3", "Limpeza de pele"],
    ]);
  });

  it("descarta vínculo de profissional ou convênio inativo", () => {
    expect(
      CATALOGO.vinculos.some((v) => v.profissional === "Dra. Antiga"),
    ).toBe(false);
    expect(CATALOGO.vinculos.some((v) => v.convenioId === CONV.inativo)).toBe(
      false,
    );
    expect(CATALOGO.convenios.map((c) => c.nome)).toEqual(["Amil", "Unimed"]);
  });

  it("nomes do catálogo para o filtro: procedimentos e convênios com o plano", () => {
    expect(nomesDoCatalogo(CATALOGO)).toEqual(
      expect.arrayContaining([
        "Consulta",
        "Limpeza de pele",
        "Unimed",
        "Nacional",
        "Unimed Nacional",
        "Amil",
      ]),
    );
  });
});

describe("buscarProcedimento", () => {
  it("particular: valor por profissional, em reais com espaço comum, e os centavos para o filtro", () => {
    const r = buscarProcedimento(CATALOGO, {
      procedimento: codigo("Consulta"),
      convenio: null,
    });
    expect(r.resultado).toBe("particular");
    expect(saida(r)).toEqual({
      resultado: "particular",
      procedimento: "Consulta",
      atende_particular: true,
      particular: [
        { profissional: "Dr. João", situacao: "valor", valor: "R$ 250,00" },
        { profissional: "Dra. Helena", situacao: "valor", valor: "R$ 317,00" },
      ],
      convenios_aceitos: ["Amil", "Unimed (Nacional)"],
    });
    expect(r.precos.sort()).toEqual([25_000, 31_700]);
    expect(r.saida).not.toMatch(/\u00a0/);
    expect(r.passo).toBe("Consultou o preço de Consulta");
  });

  it("preço 0 é valor de verdade (R$ 0,00) e entra nos preços do turno", () => {
    const r = buscarProcedimento(CATALOGO, {
      procedimento: codigo("Avaliação"),
      convenio: null,
    });
    expect(saida(r).particular).toEqual([
      { profissional: "Dra. Helena", situacao: "valor", valor: "R$ 0,00" },
    ]);
    expect(r.precos).toEqual([0]);
  });

  it("preço nulo é 'sem valor cadastrado', nunca moeda", () => {
    const r = buscarProcedimento(CATALOGO, {
      procedimento: codigo("Limpeza de pele"),
      convenio: null,
    });
    expect(saida(r).particular).toEqual([
      { profissional: "Dra. Helena", situacao: "sem_valor_cadastrado" },
    ]);
    expect(r.precos).toEqual([]);
  });

  it("convênio coberto e convênio com valor são coisas diferentes", () => {
    const coberto = consultar(CATALOGO, "unimed");
    expect(saida(coberto)).toEqual({
      resultado: "convenio",
      procedimento: "Consulta",
      convenio: "Unimed (Nacional)",
      atendimentos: [{ profissional: "Dra. Helena", situacao: "coberto" }],
    });
    expect(coberto.precos).toEqual([]);
    expect(coberto.passo).toBe(
      "Consultou o preço de Consulta pelo convênio Unimed (Nacional)",
    );

    const comValor = consultar(CATALOGO, "AMIL");
    expect(saida(comValor)).toEqual({
      resultado: "convenio",
      procedimento: "Consulta",
      convenio: "Amil",
      atendimentos: [
        { profissional: "Dr. João", situacao: "valor", valor: "R$ 80,00" },
      ],
    });
    expect(comValor.precos).toEqual([8_000]);
  });

  it("convênio sem vínculo do agente no procedimento é 'sem informação', nunca 'não cobre'", () => {
    const r = consultar(CATALOGO, "Unimed", "Avaliação");
    expect(r.resultado).toBe("convenio_sem_informacao");
    expect(saida(r)).toEqual({
      resultado: "convenio_sem_informacao",
      procedimento: "Avaliação",
      convenio: "Unimed (Nacional)",
    });
    expect(r.precos).toEqual([]);
    expect(r.passo).toBe(
      "Consultou o convênio Unimed (Nacional) para Avaliação: sem informação sobre este procedimento",
    );
    expect(r.saida).not.toMatch(/nao_cobre|aceitos/);
    expect(r.passo).not.toContain("não cobre");
  });

  it("convênio que não existe: nenhum parecido, sem ecoar o que o paciente escreveu", () => {
    const dito = "plano do joão 85 99999-8888";
    const r = consultar(CATALOGO, dito);
    expect(r.resultado).toBe("convenio_nao_encontrado");
    expect(saida(r)).toEqual({
      resultado: "convenio_nao_encontrado",
      procedimento: "Consulta",
    });
    expect(r.saida).not.toContain("99999");
    expect(r.passo).not.toContain("99999");
    expect(r.passo).toBe(`${PREFIXO}: nenhum convênio parecido no Cadastro`);
    expect(r.precos).toEqual([]);
  });

  it("'particular' ou 'sem convênio' é o valor particular (achado 23)", () => {
    for (const dito of [
      "particular",
      "Particular",
      "sem convênio",
      "não tenho",
    ]) {
      const r = consultar(CATALOGO, dito);
      expect(r.resultado, dito).toBe("particular");
      expect(r.precos.sort(), dito).toEqual([25_000, 31_700]);
    }
  });

  it("o teto da saída da busca cobre qualquer resposta do catálogo", () => {
    const limite = limiteDaSaidaDaBusca(CATALOGO);
    for (const p of CATALOGO.procedimentos) {
      for (const convenio of [
        null,
        "Unimed",
        "Amil",
        "Unimed Flex",
        "x y",
        "tenho plano",
        "Nacional",
      ]) {
        const r = buscarProcedimento(CATALOGO, {
          procedimento: p.codigo,
          convenio,
        });
        expect(Buffer.byteLength(r.saida, "utf8")).toBeLessThanOrEqual(limite);
      }
    }
  });

  it("o chamar_com mais longo do Cadastro (nome e plano de 120) cabe na entrada", () => {
    const nome = "N".repeat(120);
    const plano = "P".repeat(120);
    // O nome exibido, com o parentese, separa os que so diferem por "Saude".
    const curto = `${"N".repeat(114)} Saúde`;
    const catalogo = catalogoDe([
      ["l1", nome, plano],
      ["l2", nome, "Outro"],
      ["l3", curto, plano],
      ["l4", "N".repeat(114), plano],
    ]);
    const casos: [string, ResultadoDaBusca["resultado"]][] = [
      // So a operadora, com dois planos: falta o plano.
      [nome, "plano_nao_informado"],
      // Duas operadoras ("N... Saude" e "N...") que so diferem por "Saude".
      [curto, "convenio_nao_confirmado"],
    ];
    for (const [dito, resultado] of casos) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe(resultado);
      const opcoes = listadas(saida(r));
      expect(opcoes).toHaveLength(2);
      for (const { chamar_com } of opcoes) {
        expect(
          entradaDaBuscaSchema.safeParse({
            procedimento: "p1",
            convenio: chamar_com,
          }).success,
        ).toBe(true);
      }
      voltaNaPropria(catalogo, r);
    }
  });

  it("procedimento fora do índice (sem IA, inativo, código inventado) não é encontrado", () => {
    for (const procedimento of ["p9", "p0", PROC.semIa, "botox"]) {
      const r = buscarProcedimento(CATALOGO, { procedimento, convenio: null });
      expect(r.resultado, procedimento).toBe("procedimento_nao_encontrado");
      expect(r.precos).toEqual([]);
    }
  });

  it("entrada fora do formato vira 'entrada_invalida' e nunca lança", () => {
    for (const entrada of [
      null,
      "p1",
      {},
      { procedimento: "p1" },
      { procedimento: "p1", convenio: null, extra: 1 },
      { procedimento: 1, convenio: null },
      { procedimento: "p1", convenio: "x".repeat(257) },
    ]) {
      expect(buscarProcedimento(CATALOGO, entrada).resultado).toBe(
        "entrada_invalida",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// identificarConvenio: a regra unica
// ---------------------------------------------------------------------------

describe("identificarConvenio", () => {
  const conv = (
    id: string,
    nome: string,
    plano: string | null,
  ): ConvenioDoAgente => ({ id, nome, plano });
  const resumo = (convenios: ConvenioDoAgente[], dito: string) => {
    const r = identificarConvenio(convenios, dito);
    if (r.tipo === "casou") {
      return [r.tipo, [r.convenio.id]];
    }
    return "convenios" in r ? [r.tipo, r.convenios.map((c) => c.id)] : r.tipo;
  };

  it("seletor exato: o texto cru do rótulo de exatamente uma entrada casa, sem contar acento, caixa e espaços repetidos", () => {
    const cadastro = [
      conv("n", "Unimed", "Nacional"),
      conv("u", "Unimed", null),
      conv("f", "Unimed Fortaleza", "Flex"),
      conv("b", "Bradesco Saúde", "Top"),
    ];
    const casos: [string, string][] = [
      ["Unimed (Nacional)", "n"],
      ["unimed (nacional)", "n"],
      ["  UNIMED   (NACIONAL) ", "n"],
      ["Unimed sem plano", "u"],
      ["unimed  SEM  plano", "u"],
      ["Unimed Fortaleza (Flex)", "f"],
      ["Bradesco Saude (Top)", "b"],
    ];
    for (const [dito, id] of casos) {
      expect(resumo(cadastro, dito), dito).toEqual(["casou", [id]]);
    }
    // A pontuacao conta: fora do rotulo, vale o resto da regra (aqui, so
    // parecidos).
    for (const dito of [
      "Unimed sem plano específico",
      "Unimed, sem plano",
      "Unimed? Sem plano",
      "Unimed - sem plano",
    ]) {
      expect(resumo(cadastro, dito), dito).toEqual([
        "convenio_nao_confirmado",
        ["u", "n", "f"],
      ]);
    }
  });

  it("candidato completo: operadora e plano, nas duas ordens, sem acento, sem caixa e sem as palavras de ligação", () => {
    const cadastro = [
      conv("n", "Unimed", "Nacional"),
      conv("e", "Unimed", "Enfermaria"),
      conv("b", "Bradesco Saúde", "Top"),
    ];
    for (const dito of [
      "UNIMED nacional",
      "Unimed plano Nacional",
      "Unimed, é o Nacional",
      "é a Unimed, plano Nacional",
      "Nacional da Unimed",
      "pelo meu plano Unimed Nacional",
    ]) {
      expect(resumo(cadastro, dito), dito).toEqual(["casou", ["n"]]);
    }
    for (const dito of [
      "Unimed do plano Enfermaria",
      "plano Enfermaria da Unimed",
      "Enfermaria pela Unimed",
      "meu plano é o Enfermaria, da Unimed",
    ]) {
      expect(resumo(cadastro, dito), dito).toEqual(["casou", ["e"]]);
    }
    for (const dito of [
      "Bradesco Top",
      "bradesco saude top",
      "Top da Bradesco Saúde",
    ]) {
      expect(resumo(cadastro, dito), dito).toEqual(["casou", ["b"]]);
    }
  });

  it("só a operadora: com um convênio dela casa, com mais de um falta o plano", () => {
    const cadastro = [
      conv("e", "Unimed", "Enfermaria"),
      conv("a", "Unimed", "Apartamento"),
      conv("m", "Amil", null),
      conv("b", "Bradesco Saúde", "Top"),
    ];
    for (const dito of [
      "Amil",
      "Amil sim",
      "Amil, sim",
      "tenho a Amil",
      "uso a Amil",
      "meu convênio é Amil",
      "sou cliente Amil",
      "minha carteirinha é da Amil",
      "aqui é Amil",
    ]) {
      expect(resumo(cadastro, dito), dito).toEqual(["casou", ["m"]]);
    }
    expect(resumo(cadastro, "Bradesco")).toEqual(["casou", ["b"]]);
    for (const dito of [
      "Unimed",
      "Tenho UNIMED",
      "sim, Unimed",
      "pela Unimed",
      "é pelo convênio Unimed",
      "meu plano de saúde é Unimed",
    ]) {
      // Na ordem do nome do convenio.
      expect(resumo(cadastro, dito), dito).toEqual([
        "plano_nao_informado",
        ["a", "e"],
      ]);
    }
  });

  it("completude única: outra entrada com todas as palavras ditas tira a certeza", () => {
    // Outra operadora: opcoes.
    expect(
      resumo(
        [conv("u", "Unimed", null), conv("f", "Unimed Fortaleza", "Flex")],
        "Unimed",
      ),
    ).toEqual(["convenio_nao_confirmado", ["u", "f"]]);
    expect(
      resumo(
        [
          conv("t", "Top Saúde", null),
          conv("b", "Bradesco Saúde", "Top Nacional"),
        ],
        "Top",
      ),
    ).toEqual(["convenio_nao_confirmado", ["b", "t"]]);
    expect(
      resumo(
        [conv("p", "Premium Saúde", null), conv("o", "Omint", "Premium")],
        "Premium",
      ),
    ).toEqual(["convenio_nao_confirmado", ["o", "p"]]);
    // A mesma operadora: falta o plano.
    const bradesco = [
      conv("t", "Bradesco Saúde", "Top"),
      conv("tn", "Bradesco Saúde", "Top Nacional"),
    ];
    // Na ordem do nome ("Top Nacional)" vem antes de "Top)").
    expect(resumo(bradesco, "Bradesco Top")).toEqual([
      "plano_nao_informado",
      ["tn", "t"],
    ]);
    const flex = [
      conv("f", "Unimed", "Flex"),
      conv("fp", "Unimed", "Flex Pro"),
    ];
    expect(resumo(flex, "Unimed Flex Pro")).toEqual(["casou", ["fp"]]);
    expect(resumo(flex, "Unimed Flex")).toEqual([
      "plano_nao_informado",
      ["fp", "f"],
    ]);
    const comSemPlano = [
      conv("u", "Unimed", null),
      conv("un", "Unimed", "Nacional"),
    ];
    expect(resumo(comSemPlano, "Unimed")).toEqual([
      "plano_nao_informado",
      ["u", "un"],
    ]);
    expect(resumo(comSemPlano, "Unimed sem plano")).toEqual(["casou", ["u"]]);
    // Duas leituras da mesma fala (o plano de uma, a operadora de outra).
    const duas = [
      conv("n", "Unimed", "Nacional"),
      conv("o", "Unimed Nacional", null),
    ];
    for (const dito of ["Unimed Nacional", "Nacional Unimed"]) {
      expect(resumo(duas, dito), dito).toEqual([
        "convenio_nao_confirmado",
        ["n", "o"],
      ]);
    }
    expect(resumo(duas, "Unimed Nacional sem plano")).toEqual(["casou", ["o"]]);
    expect(resumo(duas, "Unimed (Nacional)")).toEqual(["casou", ["n"]]);
  });

  it("sem candidato completo: o que cabe inteiro numa entrada vira opção; nada cabe, os parecidos; nenhum, não encontrado", () => {
    const cadastro = [
      conv("n", "Unimed", "Nacional"),
      conv("h", "Hapvida", "Flex"),
      conv("p", "Porto Seguro Saúde", null),
    ];
    const casos: [string, string[]][] = [
      ["Nacional", ["n"]],
      ["Porto", ["p"]],
      ["Seguro", ["p"]],
      ["Unimed Nacional Plus", ["n"]],
      ["não tenho Unimed", ["n"]],
      ["o nosso é Unimed", ["n"]],
      ["Unimed Flex", ["h", "n"]],
      ["Enfermaria da Hapvida", ["h"]],
      ["Unimed ou Hapvida", ["h", "n"]],
    ];
    for (const [dito, ids] of casos) {
      expect(resumo(cadastro, dito), dito).toEqual([
        "convenio_nao_confirmado",
        ids,
      ]);
    }
    // Palavra inteira: pedaco de nome nao e parecido.
    for (const dito of ["amilton", "plano familia", "Unime", "Blue"]) {
      expect(resumo(cadastro, dito), dito).toBe("convenio_nao_encontrado");
    }
    // Mais parecidos do que cabe: corta, por palavras em comum e nome.
    const muitos = Array.from({ length: 11 }, (_, i) =>
      conv(`x${i}`, `Operadora ${String(i).padStart(2, "0")}`, "Ouro"),
    );
    const r = identificarConvenio(
      [...muitos, conv("y", "Ouro Verde", "Ouro")],
      "Ouro Prata Verde",
    );
    expect(r.tipo).toBe("convenio_nao_confirmado");
    if (r.tipo === "convenio_nao_confirmado") {
      expect(r.convenios).toHaveLength(MAXIMO_DE_OPCOES);
      expect(r.convenios[0]?.id).toBe("y");
      expect(r.maisOpcoes).toBe(true);
    }
  });

  it("só palavras de ligação: o nome do convênio não veio", () => {
    const cadastro = [conv("b", "Bradesco Saúde", "Top")];
    for (const dito of [
      "tenho plano",
      "convênio",
      "saúde",
      "é pelo plano",
      "tem plano de saúde",
    ]) {
      expect(resumo(cadastro, dito), dito).toBe("convenio_nao_informado");
    }
  });

  it("entrada frágil (nome sem palavra distintiva) só é candidata pelo texto cru", () => {
    const comTem = [
      conv("t", "Tem Saúde", null),
      conv("b", "Bradesco Saúde", "Top"),
      conv("m", "Medial Saúde", null),
      conv("u", "Unimed", null),
    ];
    // "tem saude" e o mesmo texto que "Tem Saude", sem caixa.
    for (const dito of ["Tem Saúde", "tem saúde", "TEM SAUDE"]) {
      expect(resumo(comTem, dito), dito).toEqual(["casou", ["t"]]);
    }
    for (const dito of [
      "tem plano de saúde",
      "tem plano",
      "saúde",
      // O texto cru nao e o nome: o modelo manda o nome que o paciente disse.
      "tenho Tem Saúde",
    ]) {
      expect(resumo(comTem, dito), dito).toBe("convenio_nao_informado");
    }
    expect(resumo(comTem, "tem Unimed")).toEqual(["casou", ["u"]]);
    expect(resumo(comTem, "Unimed saúde")).toEqual(["casou", ["u"]]);
    expect(resumo(comTem, "Bradesco")).toEqual(["casou", ["b"]]);
    expect(resumo(comTem, "Medial")).toEqual(["casou", ["m"]]);

    const meuPlano = [
      conv("mp", "Meu Plano", "Ouro"),
      conv("os", "Ouro Saúde", null),
      conv("u", "Unimed", null),
    ];
    expect(resumo(meuPlano, "meu plano")).toBe("convenio_nao_informado");
    for (const dito of ["plano Ouro", "Ouro", "meu plano Ouro"]) {
      expect(resumo(meuPlano, dito), dito).toEqual([
        "convenio_nao_confirmado",
        ["mp", "os"],
      ]);
    }
    expect(resumo(meuPlano, "Meu Plano (Ouro)")).toEqual(["casou", ["mp"]]);
    expect(resumo(meuPlano, "Ouro Saúde sem plano")).toEqual(["casou", ["os"]]);
    expect(resumo(meuPlano, "meu plano Unimed")).toEqual(["casou", ["u"]]);
    expect(resumo(meuPlano, "meu plano é Hapvida")).toBe(
      "convenio_nao_encontrado",
    );

    const comSaude = [
      conv("s", "Saúde", null),
      conv("b", "Bradesco Saúde", "Top"),
    ];
    // "Bradesco Saude" tambem tem a palavra "saude": duvida.
    expect(resumo(comSaude, "Saúde")).toEqual([
      "convenio_nao_confirmado",
      ["b", "s"],
    ]);
    expect(resumo(comSaude, "Saúde sem plano")).toEqual(["casou", ["s"]]);
    expect(resumo(comSaude, "Bradesco")).toEqual(["casou", ["b"]]);
    expect(resumo(comSaude, "Bradesco Saúde Top")).toEqual(["casou", ["b"]]);

    const santa = [conv("ss", "Santa Saúde", null)];
    expect(resumo(santa, "Santa Saúde")).toEqual(["casou", ["ss"]]);
    // Qualquer palavra fora das de ligacao em comum e parecida.
    for (const dito of ["Santa", "tenho Santa Saúde", "Santa Casa"]) {
      expect(resumo(santa, dito), dito).toEqual([
        "convenio_nao_confirmado",
        ["ss"],
      ]);
    }
    expect(resumo(santa, "São Cristóvão")).toBe("convenio_nao_encontrado");
  });

  it("plano só com palavra de ligação nunca casa por artigo: 'tenho a Unimed' não é o plano A", () => {
    const cadastro = [conv("x", "Unimed", "A"), conv("y", "Unimed", "B")];
    for (const dito of ["tenho a Unimed", "a Unimed", "Unimed A"]) {
      expect(resumo(cadastro, dito), dito).toEqual([
        "plano_nao_informado",
        ["x", "y"],
      ]);
    }
    expect(resumo(cadastro, "Unimed B")).toEqual(["casou", ["y"]]);
    // So o rotulo, com o parentese, separa o plano A.
    expect(resumo(cadastro, "Unimed (A)")).toEqual(["casou", ["x"]]);
  });

  it("convênio duplicado no Cadastro (o mesmo rótulo) nunca dá valor: os dois ficam como opção", () => {
    const catalogo = catalogoDe(
      [
        ["d1", "Unimed", "Nacional"],
        ["d2", "UNIMED", "nacional"],
      ],
      [noConvenio("d1", { price_cents: 10_000 })],
    );
    for (const dito of ["Unimed Nacional", "Unimed", "Unimed (Nacional)"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("plano_nao_informado");
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: falta saber qual plano de Unimed`,
      );
      for (const opcao of listadas(saida(r))) {
        const volta = consultar(catalogo, opcao.chamar_com);
        semValor(volta, opcao.chamar_com);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Regressao da regra de 06/10/2026 (itens 1 a 12)
// ---------------------------------------------------------------------------

describe("valor só com exatamente um convênio do Cadastro (regressão)", () => {
  it("1. 'Unimed' com 'Unimed Fortaleza (Flex)' no agente e 'Unimed Nacional (Top)' só no Cadastro: opções, sem valor", () => {
    const catalogo = catalogoDe(
      [
        ["uf", "Unimed Fortaleza", "Flex"],
        ["un", "Unimed Nacional", "Top"],
      ],
      [noConvenio("uf", { price_cents: 15_000 })],
    );
    for (const dito of ["Unimed", "tenho Unimed"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r), dito).toEqual({
        resultado: "convenio_nao_confirmado",
        procedimento: "Consulta",
        opcoes: [
          {
            convenio: "Unimed Fortaleza (Flex)",
            chamar_com: "Unimed Fortaleza (Flex)",
          },
          {
            convenio: "Unimed Nacional (Top)",
            chamar_com: "Unimed Nacional (Top)",
          },
        ],
        mais_opcoes: false,
      });
      semValor(r, dito);
      expect(r.saida, dito).not.toContain("150");
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Unimed Fortaleza (Flex), Unimed Nacional (Top)`,
      );
      voltaNaPropria(catalogo, r);
    }
    // Com a opcao confirmada (ou o nome e o plano ditos), o valor.
    for (const dito of ["Unimed Fortaleza (Flex)", "Unimed Fortaleza Flex"]) {
      const confirmado = consultar(catalogo, dito);
      expect(confirmado.resultado, dito).toBe("convenio");
      expect(confirmado.precos, dito).toEqual([15_000]);
      expect(confirmado.passo, dito).toBe(
        "Consultou o preço de Consulta pelo convênio Unimed Fortaleza (Flex)",
      );
    }
  });

  it("2. 'Unimed Flex' com 'Unimed Fortaleza (Flex)' e 'Unimed Nacional (Flex)': opções das duas, sem valor", () => {
    const catalogo = catalogoDe(
      [
        ["uf", "Unimed Fortaleza", "Flex"],
        ["un", "Unimed Nacional", "Flex"],
      ],
      [
        noConvenio("uf", { price_cents: 15_000 }),
        noConvenio("un", { covered_by_insurance: true }),
      ],
    );
    const r = consultar(catalogo, "Unimed Flex");
    expect(r.resultado).toBe("convenio_nao_confirmado");
    expect(
      (saida(r).opcoes as { convenio: string }[]).map((o) => o.convenio),
    ).toEqual(["Unimed Fortaleza (Flex)", "Unimed Nacional (Flex)"]);
    semValor(r, "Unimed Flex");
    expect(r.saida).not.toContain("coberto");
    expect(r.passo).toBe(
      `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Unimed Fortaleza (Flex), Unimed Nacional (Flex)`,
    );
    voltaNaPropria(catalogo, r);
  });

  it("3. nome parecido de outra operadora nunca dá valor e a trilha nunca fala em 'plano de' outra", () => {
    const catalogo = catalogoDe(
      [
        ["sf", "São Francisco Saúde", null],
        ["gc", "Golden Cross", null],
        ["sc", "Santa Casa Saúde", null],
      ],
      [
        noConvenio("sf", { price_cents: 9_000 }),
        noConvenio("gc", { covered_by_insurance: true }),
        noConvenio("sc", { price_cents: 7_000 }),
      ],
    );
    const parecidos = (nome: string) =>
      `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: ${nome}`;
    const esperado: Record<string, [string, string]> = {
      "São Cristóvão": [
        "convenio_nao_encontrado",
        `${PREFIXO}: nenhum convênio parecido no Cadastro`,
      ],
      "Blue Cross": ["convenio_nao_confirmado", parecidos("Golden Cross")],
      "Santa Helena Saúde": [
        "convenio_nao_encontrado",
        `${PREFIXO}: nenhum convênio parecido no Cadastro`,
      ],
      // Toda palavra dita cabe na entrada: e opcao, nunca valor.
      "Santa Saúde": ["convenio_nao_confirmado", parecidos("Santa Casa Saúde")],
      São: ["convenio_nao_confirmado", parecidos("São Francisco Saúde")],
    };
    for (const [dito, [resultado, passo]] of Object.entries(esperado)) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe(resultado);
      semValor(r, dito);
      expect(r.saida, dito).not.toContain("coberto");
      expect(r.passo, dito).toBe(passo);
      expect(r.passo, dito).not.toMatch(/plano de/);
      voltaNaPropria(catalogo, r);
    }
  });

  it("4. só o plano ('Apartamento', 'Flex') com mais de uma operadora: opções, sem valor", () => {
    const catalogo = catalogoDe(
      [
        ["am", "Amil", "Apartamento"],
        ["ua", "Unimed", "Apartamento"],
        ["hf", "Hapvida", "Flex"],
        ["uf", "Unimed", "Flex"],
      ],
      [
        noConvenio("am", { price_cents: 10_000 }),
        noConvenio("hf", { covered_by_insurance: true }),
        noConvenio("uf", { price_cents: 5_000 }),
      ],
    );
    const casos: Record<string, string[]> = {
      Apartamento: ["Amil (Apartamento)", "Unimed (Apartamento)"],
      Flex: ["Hapvida (Flex)", "Unimed (Flex)"],
    };
    for (const [dito, nomes] of Object.entries(casos)) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual(
        nomes.map((nome) => ({ convenio: nome, chamar_com: nome })),
      );
      semValor(r, dito);
      expect(r.saida, dito).not.toContain("coberto");
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: ${nomes.join(", ")}`,
      );
      voltaNaPropria(catalogo, r);
    }
  });

  it("5. 'Unimed Flex Pro' com Unimed (Flex) e Unimed (Flex Pro): só o Flex Pro; 'Unimed Flex' pergunta o plano", () => {
    const comVinculo = catalogoDe(
      [
        ["f", "Unimed", "Flex"],
        ["fp", "Unimed", "Flex Pro"],
      ],
      [
        noConvenio("f", { price_cents: 10_000 }),
        noConvenio("fp", { price_cents: 20_000 }),
      ],
    );
    const r = consultar(comVinculo, "Unimed Flex Pro");
    expect(r.resultado).toBe("convenio");
    expect(saida(r).convenio).toBe("Unimed (Flex Pro)");
    expect(r.precos).toEqual([20_000]);
    expect(r.saida).not.toContain("R$ 100,00");
    expect(r.passo).toBe(
      "Consultou o preço de Consulta pelo convênio Unimed (Flex Pro)",
    );

    const semVinculoDoPro = catalogoDe(
      [
        ["f", "Unimed", "Flex"],
        ["fp", "Unimed", "Flex Pro"],
      ],
      [noConvenio("f", { price_cents: 10_000 })],
    );
    const s = consultar(semVinculoDoPro, "Unimed Flex Pro");
    expect(s.resultado).toBe("convenio_sem_informacao");
    expect(s.precos).toEqual([]);
    expect(s.saida).not.toContain("R$");
    expect(s.passo).toBe(
      "Consultou o convênio Unimed (Flex Pro) para Consulta: sem informação sobre este procedimento",
    );
    // "Unimed Flex" cabe inteiro no Flex Pro tambem: falta o plano.
    const flex = consultar(comVinculo, "Unimed Flex");
    expect(flex.resultado).toBe("plano_nao_informado");
    expect(saida(flex).planos_da_operadora).toEqual([
      {
        convenio: "Unimed (Flex Pro)",
        chamar_com: "Unimed (Flex Pro)",
        situacao: "com_valor",
      },
      {
        convenio: "Unimed (Flex)",
        chamar_com: "Unimed (Flex)",
        situacao: "com_valor",
      },
    ]);
    semValor(flex, "Unimed Flex");
    expect(flex.passo).toBe(`${PREFIXO}: falta saber qual plano de Unimed`);
    expect(consultar(comVinculo, "Unimed (Flex)").precos).toEqual([10_000]);
  });

  it("6. 'Bradesco' e 'Top' com 'Bradesco Saúde (Top)' só no Cadastro: sem informação e opções, nunca 'não está no Cadastro'", () => {
    const catalogo = catalogoDe([["bt", "Bradesco Saúde", "Top"]]);
    const bradesco = consultar(catalogo, "Bradesco");
    expect(bradesco.resultado).toBe("convenio_sem_informacao");
    expect(saida(bradesco)).toEqual({
      resultado: "convenio_sem_informacao",
      procedimento: "Consulta",
      convenio: "Bradesco Saúde (Top)",
    });
    expect(bradesco.precos).toEqual([]);
    expect(bradesco.passo).toBe(
      "Consultou o convênio Bradesco Saúde (Top) para Consulta: sem informação sobre este procedimento",
    );

    const top = consultar(catalogo, "Top");
    expect(top.resultado).toBe("convenio_nao_confirmado");
    expect(saida(top).opcoes).toEqual([
      { convenio: "Bradesco Saúde (Top)", chamar_com: "Bradesco Saúde (Top)" },
    ]);
    semValor(top, "Top");
    for (const r of [bradesco, top]) {
      expect(r.passo).not.toContain("não está no Cadastro");
      expect(r.saida).not.toContain("nao_encontrado");
    }
  });

  it("7. 'tenho plano' e 'tenho convênio': o convênio não foi informado", () => {
    for (const dito of ["tenho plano", "tenho convênio", "plano de saúde"]) {
      const r = consultar(CATALOGO, dito);
      expect(r.resultado, dito).toBe("convenio_nao_informado");
      expect(saida(r), dito).toEqual({
        resultado: "convenio_nao_informado",
        procedimento: "Consulta",
      });
      semValor(r, dito);
      expect(r.passo, dito).toBe(SEM_NOME);
    }
  });

  it("8. vínculo sem 'IA pode agendar' não vira 'não cobre': sem informação", () => {
    const catalogo = catalogoDe(
      [
        ["ap", "Unimed", "Apartamento"],
        ["en", "Unimed", "Enfermaria"],
      ],
      [
        noConvenio("ap", {
          covered_by_insurance: true,
          bookable_by_ai: false,
        }),
        noConvenio("ap", {
          procedure_id: PROC.avaliacao,
          covered_by_insurance: true,
        }),
        noConvenio("en", { covered_by_insurance: true }),
      ],
    );
    const apartamento = consultar(catalogo, "Unimed Apartamento");
    expect(apartamento.resultado).toBe("convenio_sem_informacao");
    expect(apartamento.precos).toEqual([]);
    expect(apartamento.passo).toBe(
      "Consultou o convênio Unimed (Apartamento) para Consulta: sem informação sobre este procedimento",
    );

    const unimed = consultar(catalogo, "Unimed");
    expect(unimed.resultado).toBe("plano_nao_informado");
    expect(saida(unimed)).toEqual({
      resultado: "plano_nao_informado",
      procedimento: "Consulta",
      planos_da_operadora: [
        {
          convenio: "Unimed (Apartamento)",
          chamar_com: "Unimed (Apartamento)",
          situacao: "sem_informacao",
        },
        {
          convenio: "Unimed (Enfermaria)",
          chamar_com: "Unimed (Enfermaria)",
          situacao: "coberto",
        },
      ],
    });
    expect(unimed.precos).toEqual([]);
    expect(unimed.passo).toBe(`${PREFIXO}: falta saber qual plano de Unimed`);
    for (const r of [apartamento, unimed]) {
      expect(r.saida).not.toContain("nao_cobre");
      expect(r.passo).not.toContain("não cobre");
    }
    voltaNaPropria(catalogo, unimed);
    // No Exame, o vinculo com IA responde.
    const exame = consultar(catalogo, "Unimed Apartamento", "Exame");
    expect(exame.resultado).toBe("convenio");
    expect(saida(exame).atendimentos).toEqual([
      { profissional: "Dra. Helena", situacao: "coberto" },
    ]);
  });

  it("9. 'Unimed' sem plano no agente e 'Unimed (Nacional)' no Cadastro: pergunta o plano; 'Unimed sem plano' casa a sem plano", () => {
    const catalogo = catalogoDe(
      [
        ["u", "Unimed", null],
        ["un", "Unimed", "Nacional"],
      ],
      [noConvenio("u", { covered_by_insurance: true })],
    );
    const r = consultar(catalogo, "Unimed");
    expect(r.resultado).toBe("plano_nao_informado");
    expect(saida(r).planos_da_operadora).toEqual([
      {
        convenio: "Unimed",
        chamar_com: "Unimed sem plano",
        situacao: "coberto",
      },
      {
        convenio: "Unimed (Nacional)",
        chamar_com: "Unimed (Nacional)",
        situacao: "sem_informacao",
      },
    ]);
    semValor(r, "Unimed");
    expect(r.passo).toBe(`${PREFIXO}: falta saber qual plano de Unimed`);
    for (const dito of ["Unimed sem plano", "UNIMED  sem plano"]) {
      const s = consultar(catalogo, dito);
      expect(s.resultado, dito).toBe("convenio");
      expect(saida(s), dito).toEqual({
        resultado: "convenio",
        procedimento: "Consulta",
        convenio: "Unimed",
        atendimentos: [{ profissional: "Dra. Helena", situacao: "coberto" }],
      });
      expect(s.precos, dito).toEqual([]);
      expect(s.passo, dito).toBe(
        "Consultou o preço de Consulta pelo convênio Unimed",
      );
    }
    // Fora do rotulo (a pontuacao conta): opcoes, sem valor nem cobertura.
    for (const dito of [
      "Unimed sem plano específico",
      "Unimed, sem plano",
      "Unimed? Sem plano",
      "Unimed - sem plano",
    ]) {
      const fora = consultar(catalogo, dito);
      expect(fora.resultado, dito).toBe("convenio_nao_confirmado");
      semValor(fora, dito);
      expect(fora.saida, dito).not.toContain("coberto");
      expect(fora.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Unimed, Unimed (Nacional)`,
      );
      voltaNaPropria(catalogo, fora);
    }
    expect(consultar(catalogo, "Unimed Nacional").resultado).toBe(
      "convenio_sem_informacao",
    );
  });

  it("10. os casos da rodada anterior: casam com ligação; plano a mais e negação viram os parecidos", () => {
    const cadastro: [string, string, string | null][] = [
      ["n", "Unimed", "Nacional"],
      ["e", "Unimed", "Enfermaria"],
      ["h", "Hapvida", "Flex"],
      ["b", "Bradesco Saúde", "Top"],
      ["m", "Amil", null],
    ];
    const catalogo = catalogoDe(cadastro, [
      noConvenio("n", { covered_by_insurance: true }),
      noConvenio("e", { price_cents: 12_000 }),
      noConvenio("h", { covered_by_insurance: true }),
      noConvenio("b", { price_cents: 30_000 }),
      noConvenio("m", { price_cents: 8_000 }),
    ]);
    for (const dito of ["Unimed plano Nacional", "Unimed, é o Nacional"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(saida(r).convenio, dito).toBe("Unimed (Nacional)");
      expect(r.precos, dito).toEqual([]);
      expect(r.passo, dito).toBe(
        "Consultou o preço de Consulta pelo convênio Unimed (Nacional)",
      );
    }
    for (const dito of [
      "Unimed do plano Enfermaria",
      "plano Enfermaria da Unimed",
      "Enfermaria pela Unimed",
    ]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(saida(r).convenio, dito).toBe("Unimed (Enfermaria)");
      expect(r.precos, dito).toEqual([12_000]);
      expect(r.passo, dito).toBe(
        "Consultou o preço de Consulta pelo convênio Unimed (Enfermaria)",
      );
    }
    const casos: [string, string[]][] = [
      ["Unimed Nacional Plus", ["Unimed (Nacional)", "Unimed (Enfermaria)"]],
      ["não tenho Unimed", ["Unimed (Enfermaria)", "Unimed (Nacional)"]],
      [
        "Unimed Flex",
        ["Hapvida (Flex)", "Unimed (Enfermaria)", "Unimed (Nacional)"],
      ],
    ];
    for (const [dito, nomes] of casos) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r), dito).toEqual({
        resultado: "convenio_nao_confirmado",
        procedimento: "Consulta",
        opcoes: nomes.map((nome) => ({ convenio: nome, chamar_com: nome })),
        mais_opcoes: false,
      });
      semValor(r, dito);
      expect(r.saida, dito).not.toContain("coberto");
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: ${nomes.join(", ")}`,
      );
      expect(r.passo, dito).not.toMatch(/plano de|Plus|não está no Cadastro/);
      voltaNaPropria(catalogo, r);
    }
    // Sem nenhuma Unimed no Cadastro, o Flex da Hapvida e so uma opcao.
    const soHapvida = catalogoDe(
      [["h", "Hapvida", "Flex"]],
      [noConvenio("h", { price_cents: 4_000 })],
    );
    const flex = consultar(soHapvida, "Unimed Flex");
    expect(flex.resultado).toBe("convenio_nao_confirmado");
    expect(saida(flex).opcoes).toEqual([
      { convenio: "Hapvida (Flex)", chamar_com: "Hapvida (Flex)" },
    ]);
    semValor(flex, "Unimed Flex");

    const amilton = consultar(catalogo, "amilton");
    expect(amilton.resultado).toBe("convenio_nao_encontrado");
    semValor(amilton, "amilton");

    const bradesco = consultar(catalogo, "Bradesco Top");
    expect(bradesco.resultado).toBe("convenio");
    expect(saida(bradesco).convenio).toBe("Bradesco Saúde (Top)");
    expect(bradesco.precos).toEqual([30_000]);
  });

  it("11. 'Notre Dame Smart 200' e 'Intermédica Smart 200': opção sem valor, e o chamar_com dela dá o valor", () => {
    const catalogo = catalogoDe(
      [["nd", "Notre Dame Intermédica", "Smart 200"]],
      [noConvenio("nd", { price_cents: 25_000 })],
    );
    for (const dito of ["Notre Dame Smart 200", "Intermédica Smart 200"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        {
          convenio: "Notre Dame Intermédica (Smart 200)",
          chamar_com: "Notre Dame Intermédica (Smart 200)",
        },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Notre Dame Intermédica (Smart 200)`,
      );
    }
    for (const dito of [
      "Notre Dame Intermédica (Smart 200)",
      "Notre Dame Intermédica Smart 200",
    ]) {
      const confirmado = consultar(catalogo, dito);
      expect(confirmado.resultado, dito).toBe("convenio");
      expect(saida(confirmado).atendimentos, dito).toEqual([
        { profissional: "Dra. Helena", situacao: "valor", valor: "R$ 250,00" },
      ]);
      expect(confirmado.precos, dito).toEqual([25_000]);
    }
  });

  // -------------------------------------------------------------------------
  // Rodada do cetico (problemas 1 a 6)
  // -------------------------------------------------------------------------

  it("cético 1. a fala que também é o plano inteiro de outro convênio vira opções ('Premium', 'Top')", () => {
    const catalogo = catalogoDe(
      [
        ["ps", "Premium Saúde", null],
        ["om", "Omint", "Premium"],
        ["ts", "Top Saúde", null],
        ["bt", "Bradesco Saúde", "Top"],
      ],
      [
        noConvenio("ps", { price_cents: 18_000 }),
        noConvenio("om", { price_cents: 9_000 }),
        noConvenio("ts", { price_cents: 5_000 }),
        noConvenio("bt", { price_cents: 12_000 }),
      ],
    );
    const premium = [
      { convenio: "Omint (Premium)", chamar_com: "Omint (Premium)" },
      { convenio: "Premium Saúde", chamar_com: "Premium Saúde sem plano" },
    ];
    const top = [
      { convenio: "Bradesco Saúde (Top)", chamar_com: "Bradesco Saúde (Top)" },
      { convenio: "Top Saúde", chamar_com: "Top Saúde sem plano" },
    ];
    const casos: [string, Opcao[]][] = [
      ["meu plano é o Premium", premium],
      ["Premium", premium],
      ["plano Premium", premium],
      ["Premium Saúde", premium],
      ["Premium Plus", premium],
      ["Top", top],
      ["Top Saúde", top],
    ];
    for (const [dito, esperadas] of casos) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual(esperadas);
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: ${esperadas.map((o) => o.convenio).join(", ")}`,
      );
      voltaNaPropria(catalogo, r);
    }
    const valores: [string, string, number][] = [
      ["Premium Saúde sem plano", "Premium Saúde", 18_000],
      ["Omint (Premium)", "Omint (Premium)", 9_000],
      ["Omint Premium", "Omint (Premium)", 9_000],
      ["Top Saúde sem plano", "Top Saúde", 5_000],
      ["Bradesco", "Bradesco Saúde (Top)", 12_000],
    ];
    for (const [dito, convenio, centavos] of valores) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(r.precos, dito).toEqual([centavos]);
      expect(r.passo, dito).toBe(
        `Consultou o preço de Consulta pelo convênio ${convenio}`,
      );
    }
  });

  it("cético 2. nome que vira palavra que não distingue, ou operadora colada em outra, nunca dá valor nem 'plano de' outra", () => {
    const santa = catalogoDe(
      [["ss", "Santa Saúde", null]],
      [noConvenio("ss", { price_cents: 10_000 })],
    );
    for (const dito of [
      "Santa Helena Saúde",
      "Santa Casa Saúde",
      "Santa Casa",
      "Santa",
      "tenho Santa Saúde",
    ]) {
      const r = consultar(santa, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: "Santa Saúde", chamar_com: "Santa Saúde" },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Santa Saúde`,
      );
    }
    expect(consultar(santa, "Santa Saúde").precos).toEqual([10_000]);
    expect(consultar(santa, "São Cristóvão").resultado).toBe(
      "convenio_nao_encontrado",
    );

    const plena = catalogoDe(
      [["pl", "Plena Saúde", null]],
      [noConvenio("pl", { price_cents: 7_000 })],
    );
    for (const dito of ["Unimed Plena", "não Plena"]) {
      const r = consultar(plena, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: "Plena Saúde", chamar_com: "Plena Saúde" },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Plena Saúde`,
      );
      voltaNaPropria(plena, r);
    }
    // Com a Unimed no Cadastro, as duas sao parecidas: opcoes.
    const comUnimed = catalogoDe(
      [
        ["pl", "Plena Saúde", null],
        ["un", "Unimed", "Nacional"],
      ],
      [noConvenio("pl", { price_cents: 7_000 })],
    );
    const ambas = consultar(comUnimed, "Unimed Plena");
    expect(ambas.resultado).toBe("convenio_nao_confirmado");
    semValor(ambas, "Unimed Plena");
    expect(ambas.passo).toBe(
      `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: Plena Saúde, Unimed (Nacional)`,
    );
    expect(ambas.passo).not.toMatch(/plano de/);
    voltaNaPropria(comUnimed, ambas);
  });

  it("cético 3. 'Tem Saúde' no Cadastro não muda a comparação das outras entradas", () => {
    const convenios: [string, string, string | null][] = [
      ["bt", "Bradesco Saúde", "Top"],
      ["md", "Medial Saúde", null],
      ["u", "Unimed", null],
    ];
    const vinculos = [
      noConvenio("bt", { price_cents: 12_000 }),
      noConvenio("md", { price_cents: 8_000 }),
      noConvenio("u", { price_cents: 5_000 }),
      noConvenio("tm", { price_cents: 3_000 }),
    ];
    for (const catalogo of [
      catalogoDe(convenios, vinculos),
      catalogoDe([...convenios, ["tm", "Tem Saúde", null]], vinculos),
    ]) {
      const casos: [string, number][] = [
        ["Bradesco", 12_000],
        ["Medial", 8_000],
        ["tem Unimed", 5_000],
        ["Unimed saúde", 5_000],
      ];
      for (const [dito, centavos] of casos) {
        const r = consultar(catalogo, dito);
        expect(r.resultado, dito).toBe("convenio");
        expect(r.precos, dito).toEqual([centavos]);
      }
      for (const dito of ["tenho plano de saúde", "tem plano de saúde"]) {
        const semNome = consultar(catalogo, dito);
        expect(semNome.resultado, dito).toBe("convenio_nao_informado");
        expect(semNome.passo, dito).toBe(SEM_NOME);
      }
    }
    const comTem = catalogoDe(
      [...convenios, ["tm", "Tem Saúde", null]],
      vinculos,
    );
    expect(consultar(comTem, "Tem Saúde").precos).toEqual([3_000]);
  });

  it("cético 4. entradas que só diferem por palavra de ligação: o chamar_com volta na própria entrada", () => {
    const sul = catalogoDe(
      [
        ["s1", "SulAmérica", null],
        ["s2", "SulAmérica Saúde", null],
      ],
      [noConvenio("s1", { price_cents: 6_000 })],
    );
    for (const dito of ["SulAmérica", "tenho SulAmérica", "SulAmérica Saúde"]) {
      const r = consultar(sul, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: "SulAmérica", chamar_com: "SulAmérica sem plano" },
        {
          convenio: "SulAmérica Saúde",
          chamar_com: "SulAmérica Saúde sem plano",
        },
      ]);
      semValor(r, dito);
      voltaNaPropria(sul, r);
    }
    expect(consultar(sul, "SulAmérica sem plano").precos).toEqual([6_000]);

    const bradesco = catalogoDe(
      [
        ["b1", "Bradesco", "Top"],
        ["b2", "Bradesco Saúde", "Top"],
      ],
      [noConvenio("b1", { price_cents: 10_000 })],
    );
    for (const dito of [
      "Bradesco",
      "Bradesco Top",
      "Bradesco Saúde Top",
      "Top",
    ]) {
      const r = consultar(bradesco, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: "Bradesco (Top)", chamar_com: "Bradesco (Top)" },
        {
          convenio: "Bradesco Saúde (Top)",
          chamar_com: "Bradesco Saúde (Top)",
        },
      ]);
      semValor(r, dito);
      voltaNaPropria(bradesco, r);
    }
    expect(consultar(bradesco, "Bradesco (Top)").precos).toEqual([10_000]);
  });

  it("cético 5. palavras de quem tem o plano (cliente, carteirinha, titular...) são de ligação", () => {
    const catalogo = catalogoDe(
      [
        ["n", "Unimed", "Nacional"],
        ["e", "Unimed", "Enfermaria"],
        ["m", "Amil", null],
        ["b", "Bradesco Saúde", "Top"],
      ],
      [noConvenio("m", { price_cents: 8_000 })],
    );
    for (const dito of [
      "sou cliente Amil",
      "minha carteirinha é da Amil",
      "carteirinha Amil",
      "carteirinha da Amil",
      "titular Amil",
      "dependente Amil",
      "sou associada Amil",
      "beneficiária Amil",
      "via Amil",
      "aqui é Amil",
      "cartão da Amil",
    ]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(r.precos, dito).toEqual([8_000]);
      expect(r.passo, dito).toBe(
        "Consultou o preço de Consulta pelo convênio Amil",
      );
    }
    // "nosso" pode ser plano (o "Nosso Plano" da Hapvida): sobra, sem valor.
    const nosso = consultar(catalogo, "o nosso é Amil");
    expect(nosso.resultado).toBe("convenio_nao_confirmado");
    expect(saida(nosso).opcoes).toEqual([
      { convenio: "Amil", chamar_com: "Amil" },
    ]);
    semValor(nosso, "o nosso é Amil");
    const hapvida = catalogoDe(
      [
        ["hn", "Hapvida", "Nosso Plano"],
        ["hf", "Hapvida", "Flex"],
      ],
      [noConvenio("hn", { price_cents: 4_000 })],
    );
    expect(consultar(hapvida, "Hapvida Nosso Plano").precos).toEqual([4_000]);
  });

  it("cético 6. a mesma operadora escrita junta ou separada é parecida, nunca 'nenhum parecido'", () => {
    const catalogo = catalogoDe(
      [
        ["sa", "Sul América", "Especial 100"],
        ["nd", "Notre Dame Intermédica", "Smart 200"],
        ["hv", "Hapvida", null],
      ],
      [
        noConvenio("sa", { price_cents: 6_500 }),
        noConvenio("hv", { price_cents: 5_000 }),
      ],
    );
    const casos: [string, Opcao][] = [
      [
        "SulAmérica",
        {
          convenio: "Sul América (Especial 100)",
          chamar_com: "Sul América (Especial 100)",
        },
      ],
      [
        "NotreDame",
        {
          convenio: "Notre Dame Intermédica (Smart 200)",
          chamar_com: "Notre Dame Intermédica (Smart 200)",
        },
      ],
      ["Hap Vida", { convenio: "Hapvida", chamar_com: "Hapvida" }],
    ];
    for (const [dito, opcao] of casos) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([opcao]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro: ${opcao.convenio}`,
      );
      voltaNaPropria(catalogo, r);
    }
    expect(consultar(catalogo, "Sul América (Especial 100)").precos).toEqual([
      6_500,
    ]);
  });
});

// ---------------------------------------------------------------------------
// A regra unica (06/10/2026): os casos do cetico final e as propriedades
// ---------------------------------------------------------------------------

describe("regra única do convênio", () => {
  const PARECIDOS = `${PREFIXO}: não deu para confirmar qual convênio; parecidos no Cadastro:`;

  it("(1) a operadora que o paciente não disse nunca aparece como dita: só parecida", () => {
    const casos: [string, number, string[]][] = [
      [
        "Plena Saúde",
        7_000,
        ["Unimed plano Plena", "plano Plena da Unimed", "Plena pela Unimed"],
      ],
      [
        "Top Saúde",
        5_000,
        ["Bradesco plano Top", "plano Top do Bradesco", "Top pelo Bradesco"],
      ],
      [
        "Premium Saúde",
        18_000,
        ["Omint plano Premium", "plano Premium da Omint", "Premium pela Omint"],
      ],
    ];
    for (const [nome, centavos, ditos] of casos) {
      const catalogo = catalogoDe(
        [["x", nome, null]],
        [noConvenio("x", { price_cents: centavos })],
      );
      for (const dito of ditos) {
        const r = consultar(catalogo, dito);
        expect(r.resultado, dito).toBe("convenio_nao_confirmado");
        expect(saida(r).opcoes, dito).toEqual([
          { convenio: nome, chamar_com: nome },
        ]);
        semValor(r, dito);
        expect(r.passo, dito).toBe(`${PARECIDOS} ${nome}`);
        expect(r.passo, dito).not.toMatch(/plano de/);
        voltaNaPropria(catalogo, r);
      }
      expect(consultar(catalogo, nome).precos).toEqual([centavos]);
    }
  });

  it("(2) 'Tem Saúde' e 'Meu Plano (Ouro)': só o nome casa; 'tem plano de saúde' e 'meu plano' não dizem convênio", () => {
    const tem = catalogoDe(
      [
        ["bt", "Bradesco Saúde", "Top"],
        ["md", "Medial Saúde", null],
        ["u", "Unimed", null],
        ["tm", "Tem Saúde", null],
      ],
      [
        noConvenio("bt", { price_cents: 12_000 }),
        noConvenio("tm", { price_cents: 3_000 }),
      ],
    );
    for (const dito of ["tem plano de saúde", "tenho plano de saúde"]) {
      const r = consultar(tem, dito);
      expect(r.resultado, dito).toBe("convenio_nao_informado");
      semValor(r, dito);
      expect(r.passo, dito).toBe(SEM_NOME);
    }
    // "tem saude" e o texto de "Tem Saude" sem caixa: casa (limite da regra).
    for (const dito of ["Tem Saúde", "tem saúde"]) {
      const r = consultar(tem, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(r.precos, dito).toEqual([3_000]);
      expect(r.passo, dito).toBe(
        "Consultou o preço de Consulta pelo convênio Tem Saúde",
      );
    }

    const ouro = catalogoDe(
      [
        ["mp", "Meu Plano", "Ouro"],
        ["os", "Ouro Saúde", null],
        ["u", "Unimed", null],
      ],
      [
        noConvenio("mp", { price_cents: 5_000 }),
        noConvenio("os", { price_cents: 4_000 }),
        noConvenio("u", { price_cents: 6_000 }),
      ],
    );
    const meuPlano = consultar(ouro, "meu plano");
    expect(meuPlano.resultado).toBe("convenio_nao_informado");
    semValor(meuPlano, "meu plano");
    for (const dito of ["plano Ouro", "meu plano é Ouro", "Ouro"]) {
      const r = consultar(ouro, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: "Meu Plano (Ouro)", chamar_com: "Meu Plano (Ouro)" },
        { convenio: "Ouro Saúde", chamar_com: "Ouro Saúde sem plano" },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} Meu Plano (Ouro), Ouro Saúde`);
      voltaNaPropria(ouro, r);
    }
    const rotulo = consultar(ouro, "Meu Plano (Ouro)");
    expect(rotulo.resultado).toBe("convenio");
    expect(rotulo.precos).toEqual([5_000]);
    expect(consultar(ouro, "meu plano Unimed").precos).toEqual([6_000]);
  });

  it("(3) o plano de outra entrada, mesmo parcial, gera dúvida: 'Top' com 'Top Saúde' e 'Bradesco Saúde (Top Nacional)'", () => {
    const catalogo = catalogoDe(
      [
        ["ts", "Top Saúde", null],
        ["bt", "Bradesco Saúde", "Top Nacional"],
      ],
      [
        noConvenio("ts", { price_cents: 5_000 }),
        noConvenio("bt", { price_cents: 12_000 }),
      ],
    );
    for (const dito of ["Top", "plano Top", "meu plano é o Top"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        {
          convenio: "Bradesco Saúde (Top Nacional)",
          chamar_com: "Bradesco Saúde (Top Nacional)",
        },
        { convenio: "Top Saúde", chamar_com: "Top Saúde sem plano" },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PARECIDOS} Bradesco Saúde (Top Nacional), Top Saúde`,
      );
      voltaNaPropria(catalogo, r);
    }
  });

  it("'Unimed' com 'Unimed' e 'Unimed Fortaleza (Flex)': opções; 'Bradesco Top' com (Top) e (Top Nacional): falta o plano", () => {
    const unimed = catalogoDe(
      [
        ["u", "Unimed", null],
        ["uf", "Unimed Fortaleza", "Flex"],
      ],
      [
        noConvenio("u", { price_cents: 5_000 }),
        noConvenio("uf", { price_cents: 6_000 }),
      ],
    );
    const r = consultar(unimed, "Unimed");
    expect(r.resultado).toBe("convenio_nao_confirmado");
    expect(saida(r).opcoes).toEqual([
      { convenio: "Unimed", chamar_com: "Unimed sem plano" },
      {
        convenio: "Unimed Fortaleza (Flex)",
        chamar_com: "Unimed Fortaleza (Flex)",
      },
    ]);
    semValor(r, "Unimed");
    expect(r.passo).toBe(`${PARECIDOS} Unimed, Unimed Fortaleza (Flex)`);
    voltaNaPropria(unimed, r);

    const bradesco = catalogoDe(
      [
        ["t", "Bradesco Saúde", "Top"],
        ["tn", "Bradesco Saúde", "Top Nacional"],
      ],
      [
        noConvenio("t", { price_cents: 12_000 }),
        noConvenio("tn", { covered_by_insurance: true }),
      ],
    );
    const top = consultar(bradesco, "Bradesco Top");
    expect(top.resultado).toBe("plano_nao_informado");
    expect(
      listadas(saida(top))
        .map((o) => o.convenio)
        .sort(),
    ).toEqual(["Bradesco Saúde (Top Nacional)", "Bradesco Saúde (Top)"]);
    semValor(top, "Bradesco Top");
    expect(top.passo).toBe(
      `${PREFIXO}: falta saber qual plano de Bradesco Saúde`,
    );
    voltaNaPropria(bradesco, top);
    expect(consultar(bradesco, "Bradesco Top Nacional").resultado).toBe(
      "convenio",
    );
  });

  // -------------------------------------------------------------------------
  // Rodada do cetico final (problemas 1 a 4)
  // -------------------------------------------------------------------------

  it("cético final 1. o nome escrito junto com uma palavra de ligação é parecido, nunca 'nenhum parecido'", () => {
    const catalogo = catalogoDe(
      [
        ["bs", "Bradesco Saúde", null],
        ["tm", "Tem Saúde", null],
        ["ts", "Top Saúde", null],
        ["pl", "Plena Saúde", null],
        ["sc", "Saúde Caixa", null],
        ["sa", "SulAmérica Saúde", null],
        ["am", "Amil", null],
      ],
      [
        noConvenio("bs", { price_cents: 12_000 }),
        noConvenio("tm", { price_cents: 3_000 }),
        noConvenio("ts", { price_cents: 3_100 }),
        noConvenio("pl", { price_cents: 3_200 }),
        noConvenio("sc", { price_cents: 3_300 }),
        noConvenio("sa", { price_cents: 3_400 }),
      ],
    );
    const casos: [string, string][] = [
      ["BradescoSaúde", "Bradesco Saúde"],
      ["Bradescosaude", "Bradesco Saúde"],
      ["TemSaúde", "Tem Saúde"],
      ["TopSaúde", "Top Saúde"],
      ["PlenaSaúde", "Plena Saúde"],
      ["SaúdeCaixa", "Saúde Caixa"],
      ["SulAméricaSaúde", "SulAmérica Saúde"],
    ];
    for (const [dito, nome] of casos) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: nome, chamar_com: nome },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} ${nome}`);
      voltaNaPropria(catalogo, r);
    }
    // O contrario: o Cadastro junto e o paciente separado.
    const junto = catalogoDe(
      [["bj", "BradescoSaúde", null]],
      [noConvenio("bj", { price_cents: 12_000 })],
    );
    const separado = consultar(junto, "Bradesco Saúde");
    expect(separado.resultado).toBe("convenio_nao_confirmado");
    semValor(separado, "Bradesco Saúde");
    expect(separado.passo).toBe(`${PARECIDOS} BradescoSaúde`);
    voltaNaPropria(junto, separado);
    // A juncao precisa de uma palavra que distinga (menos no fragil): "Seguro"
    // e "Saude" juntas nao sao "Porto Seguro Saude".
    const porto = catalogoDe(
      [["ps", "Porto Seguro Saúde", null]],
      [noConvenio("ps", { price_cents: 9_000 })],
    );
    const seguro = consultar(porto, "SeguroSaúde");
    expect(seguro.resultado).toBe("convenio_nao_encontrado");
    expect(seguro.passo).toBe(
      `${PREFIXO}: nenhum convênio parecido no Cadastro`,
    );
    const portoJunto = consultar(porto, "PortoSeguro");
    expect(portoJunto.resultado).toBe("convenio_nao_confirmado");
    expect(portoJunto.passo).toBe(`${PARECIDOS} Porto Seguro Saúde`);
    // Operadora e plano juntos, com qualquer numero de palavras.
    const comPlano = catalogoDe(
      [
        ["um", "Unimed", "Mix"],
        ["nd", "Notre Dame Intermédica", "Smart 200"],
      ],
      [
        noConvenio("um", { price_cents: 4_000 }),
        noConvenio("nd", { price_cents: 25_000 }),
      ],
    );
    const juntos: [string, string][] = [
      ["UnimedMix", "Unimed (Mix)"],
      ["NotreDameIntermédicaSmart200", "Notre Dame Intermédica (Smart 200)"],
    ];
    for (const [dito, nome] of juntos) {
      const r = consultar(comPlano, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} ${nome}`);
      voltaNaPropria(comPlano, r);
    }
  });

  it("cético final 2. a pontuação do rótulo conta: 'Unimed (Pleno+)' não é 'Unimed (Pleno)'", () => {
    const catalogo = catalogoDe(
      [
        ["p", "Unimed", "Pleno"],
        ["pp", "Unimed", "Pleno+"],
        ["m", "Hapvida", "Mix"],
        ["mp", "Hapvida", "Mix+"],
      ],
      [
        noConvenio("p", { price_cents: 1_000 }),
        noConvenio("pp", { price_cents: 2_000 }),
        noConvenio("m", { price_cents: 3_000 }),
        noConvenio("mp", { price_cents: 4_000 }),
      ],
    );
    const valores: [string, string, number][] = [
      ["Unimed (Pleno)", "Unimed (Pleno)", 1_000],
      ["Unimed (Pleno+)", "Unimed (Pleno+)", 2_000],
      ["Hapvida (Mix)", "Hapvida (Mix)", 3_000],
      ["hapvida  (MIX+)", "Hapvida (Mix+)", 4_000],
    ];
    for (const [dito, convenio, centavos] of valores) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(r.precos, dito).toEqual([centavos]);
      expect(r.passo, dito).toBe(
        `Consultou o preço de Consulta pelo convênio ${convenio}`,
      );
    }
    // As palavras sao as mesmas: so o rotulo separa, e o plano e perguntado.
    const semPlano: [string, string][] = [
      ["Unimed Pleno", "Unimed"],
      ["Hapvida Mix", "Hapvida"],
    ];
    for (const [dito, operadora] of semPlano) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("plano_nao_informado");
      semValor(r, dito);
      expect(r.passo, dito).toBe(
        `${PREFIXO}: falta saber qual plano de ${operadora}`,
      );
      voltaNaPropria(catalogo, r);
    }
  });

  it("cético final 3. convênio sem letra nem número entra na regra: o plano dele gera dúvida e o rótulo dele dá o valor dele", () => {
    const catalogo = catalogoDe(
      [
        ["ts", "Top Saúde", null],
        ["pp", "++", "Top"],
        ["mm", "--", null],
        ["sc", "Sem", "Convênio"],
      ],
      [
        noConvenio("ts", { price_cents: 3_000 }),
        noConvenio("pp", { price_cents: 9_000 }),
        noConvenio("mm", { price_cents: 7_000 }),
        noConvenio("sc", { price_cents: 6_000 }),
      ],
    );
    for (const dito of ["Top", "Top Saúde"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: "++ (Top)", chamar_com: "++ (Top)" },
        { convenio: "Top Saúde", chamar_com: "Top Saúde sem plano" },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} ++ (Top), Top Saúde`);
      voltaNaPropria(catalogo, r);
    }
    // O rotulo vale antes das palavras do particular.
    const valores: [string, string, number][] = [
      ["++ (Top)", "++ (Top)", 9_000],
      ["-- sem plano", "--", 7_000],
      ["Sem (Convênio)", "Sem (Convênio)", 6_000],
      ["Top Saúde sem plano", "Top Saúde", 3_000],
    ];
    for (const [dito, convenio, centavos] of valores) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio");
      expect(r.precos, dito).toEqual([centavos]);
      expect(r.passo, dito).toBe(
        `Consultou o preço de Consulta pelo convênio ${convenio}`,
      );
    }
    for (const dito of ["sem plano", "sem convênio"]) {
      expect(consultar(catalogo, dito).resultado, dito).toBe("particular");
    }
    // Nomes sem palavra sao operadoras diferentes quando o texto difere: a
    // trilha nunca diz "plano de ++" para o "-- (Top)".
    const sinais = catalogoDe(
      [
        ["p1", "++", "Top"],
        ["p2", "--", "Top"],
        ["p3", "++", "Top Nacional"],
      ],
      [
        noConvenio("p1", { price_cents: 1_000 }),
        noConvenio("p2", { price_cents: 2_000 }),
      ],
    );
    const top = consultar(sinais, "Top");
    expect(top.resultado).toBe("convenio_nao_confirmado");
    semValor(top, "Top");
    expect(top.passo).toBe(
      `${PARECIDOS} -- (Top), ++ (Top Nacional), ++ (Top)`,
    );
    voltaNaPropria(sinais, top);
    // Sem palavra nenhuma, so o rotulo identifica.
    for (const dito of ["--", "??", "++"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_informado");
      semValor(r, dito);
    }
  });

  it("cético final 4. o frágil sem plano casa pelo texto cru, e a trilha do não informado nunca diz que o paciente não falou o nome", () => {
    // Limite da regra (docs/03): "meu plano" e o texto de "Meu Plano".
    const meuPlano = catalogoDe(
      [
        ["mp", "Meu Plano", null],
        ["u", "Unimed", null],
      ],
      [noConvenio("mp", { price_cents: 5_000 })],
    );
    const r = consultar(meuPlano, "meu plano");
    expect(r.resultado).toBe("convenio");
    expect(r.precos).toEqual([5_000]);
    expect(r.passo).toBe(
      "Consultou o preço de Consulta pelo convênio Meu Plano",
    );
    // Com mais palavras, nao e o nome: nao casa.
    for (const dito of ["tenho meu plano", "quanto fica pelo meu plano"]) {
      semValor(consultar(meuPlano, dito), dito);
    }

    const tem = catalogoDe(
      [["tm", "Tem Saúde", null]],
      [noConvenio("tm", { price_cents: 3_000 })],
    );
    const semTem = catalogoDe(
      [["u", "Unimed", null]],
      [noConvenio("u", { price_cents: 3_000 })],
    );
    const casos: [CatalogoDoAgente, string][] = [
      [tem, "tenho Tem Saúde"],
      [tem, "uso Tem Saúde"],
      [semTem, "Tem Saúde"],
    ];
    for (const [catalogo, dito] of casos) {
      const s = consultar(catalogo, dito);
      expect(s.resultado, dito).toBe("convenio_nao_informado");
      semValor(s, dito);
      expect(s.passo, dito).toBe(SEM_NOME);
      expect(s.passo, dito).not.toMatch(/sem o nome|não disse|não informou/);
    }
    expect(consultar(tem, "Tem Saúde").precos).toEqual([3_000]);
  });

  // -------------------------------------------------------------------------
  // Ajustes de 07/10 (trilha honesta e casos forcados)
  // -------------------------------------------------------------------------

  it("ajuste 1. o nome colado numa palavra de ligação que o Cadastro não tem é parecido, nunca 'nenhum parecido' e nunca valor", () => {
    const catalogo = catalogoDe(
      [
        ["am", "Amil", null],
        ["br", "Bradesco", null],
        ["hv", "Hapvida", null],
        ["un", "Unimed", null],
        ["sa", "SulAmérica", null],
      ],
      [
        noConvenio("am", { price_cents: 8_000 }),
        noConvenio("br", { price_cents: 12_000 }),
        noConvenio("hv", { price_cents: 7_000 }),
        noConvenio("un", { price_cents: 5_000 }),
        noConvenio("sa", { price_cents: 9_000 }),
      ],
    );
    const casos: [string, string][] = [
      ["AmilSaúde", "Amil"],
      ["AmilSaude", "Amil"],
      ["BradescoSaúde", "Bradesco"],
      ["HapvidaSaúde", "Hapvida"],
      ["UnimedSaúde", "Unimed"],
      ["PlanoAmil", "Amil"],
      ["ConvênioAmil", "Amil"],
      ["tenho PlanoUnimed", "Unimed"],
      ["SulAméricaSaúde", "SulAmérica"],
      // O resto tambem entra na juncao: "Sul" + "America" e "SulAmerica".
      ["Sul AméricaSaúde", "SulAmérica"],
    ];
    for (const [dito, nome] of casos) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(saida(r).opcoes, dito).toEqual([
        { convenio: nome, chamar_com: nome },
      ]);
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} ${nome}`);
      voltaNaPropria(catalogo, r);
    }
    // So a palavra de ligacao de 4 letras ou mais e separada, e o resto
    // precisa de 3 letras.
    for (const dito of ["DaAmil", "planosaude"]) {
      const r = consultar(catalogo, dito);
      expect(r.resultado, dito).toBe("convenio_nao_encontrado");
      expect(r.passo, dito).toBe(
        `${PREFIXO}: nenhum convênio parecido no Cadastro`,
      );
    }
    // Limite (docs/03): os dois lados cortados em lugares diferentes.
    const notre = catalogoDe(
      [["nd", "NotreDame Intermédica", null]],
      [noConvenio("nd", { price_cents: 12_000 })],
    );
    expect(consultar(notre, "Notre DameIntermédica").resultado).toBe(
      "convenio_nao_encontrado",
    );
    for (const dito of [
      "NotreDameIntermédicaSaúde",
      "PlanoNotreDame Intermédica",
    ]) {
      const r = consultar(notre, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} NotreDame Intermédica`);
    }
  });

  it("ajuste 2. fala só com palavras de ligação: só o rótulo ou o frágil sem plano de mesmo nome; o nome sem palavra nunca é candidato", () => {
    const casos: [
      [string, string, string | null][],
      [string, number][],
      string[],
      [string, string, number],
    ][] = [
      [
        [
          ["x", "--", "Plano"],
          ["u", "Unimed", null],
          ["am", "Amil", null],
        ],
        [
          ["x", 7_000],
          ["u", 5_000],
          ["am", 8_000],
        ],
        ["plano", "Plano", "-- Plano", "tenho plano"],
        ["-- (Plano)", "-- (Plano)", 7_000],
      ],
      [
        [
          ["x", "++", "Convênio"],
          ["u", "Unimed", null],
        ],
        [["x", 9_000]],
        ["convênio", "Convênio"],
        ["++ (Convênio)", "++ (Convênio)", 9_000],
      ],
      [
        [
          ["x", "++", "A"],
          ["u", "Unimed", "E"],
        ],
        [
          ["x", 9_000],
          ["u", 5_000],
        ],
        ["A", "a"],
        ["++ (A)", "++ (A)", 9_000],
      ],
      [
        [
          ["x", "Meu Plano", "A"],
          ["u", "Unimed", "A"],
        ],
        [
          ["x", 6_000],
          ["u", 5_000],
        ],
        ["meu plano a", "Meu Plano A", "meu plano"],
        ["Meu Plano (A)", "Meu Plano (A)", 6_000],
      ],
      [
        [
          ["x", "Saúde", "A"],
          ["u", "Unimed", null],
        ],
        [["x", 6_000]],
        ["saúde a", "saúde"],
        ["Saúde (A)", "Saúde (A)", 6_000],
      ],
      [
        [
          ["t", "Tem Saúde", "Ouro"],
          ["u", "Unimed", null],
        ],
        [["t", 6_000]],
        ["tem saúde", "Tem Saúde"],
        // Com L(dito) nao vazio, o fragil com plano casa pelo texto cru.
        ["Tem Saúde Ouro", "Tem Saúde (Ouro)", 6_000],
      ],
    ];
    for (const [convenios, precos, vazias, [rotulo, nome, centavos]] of casos) {
      const catalogo = catalogoDe(
        convenios,
        precos.map(([id, preco]) => noConvenio(id, { price_cents: preco })),
      );
      for (const dito of vazias) {
        const r = consultar(catalogo, dito);
        expect(r.resultado, dito).toBe("convenio_nao_informado");
        semValor(r, dito);
        expect(r.passo, dito).toBe(SEM_NOME);
      }
      const r = consultar(catalogo, rotulo);
      expect(r.resultado, rotulo).toBe("convenio");
      expect(r.precos, rotulo).toEqual([centavos]);
      expect(r.passo, rotulo).toBe(
        `Consultou o preço de Consulta pelo convênio ${nome}`,
      );
    }

    // O fragil SEM plano de mesmo nome escapa da fala vazia.
    const saude = catalogoDe(
      [
        ["s", "Saúde", null],
        ["u", "Unimed", null],
      ],
      [noConvenio("s", { price_cents: 6_000 })],
    );
    expect(consultar(saude, "saúde").precos).toEqual([6_000]);

    // O nome sem palavra nunca e candidato, nem pelo plano sozinho: a
    // trilha nunca diz "plano de ++".
    const sinais = catalogoDe(
      [
        ["a", "++", "Top"],
        ["b", "++", "Top Nacional"],
        ["u", "Unimed", null],
      ],
      [
        noConvenio("a", { price_cents: 9_000 }),
        noConvenio("b", { price_cents: 9_500 }),
        noConvenio("u", { price_cents: 5_000 }),
      ],
    );
    for (const dito of ["Top", "top"]) {
      const r = consultar(sinais, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      semValor(r, dito);
      expect(r.passo, dito).toBe(`${PARECIDOS} ++ (Top Nacional), ++ (Top)`);
      expect(r.passo, dito).not.toMatch(/plano de/);
      voltaNaPropria(sinais, r);
    }
    expect(consultar(sinais, "++ (Top)").precos).toEqual([9_000]);
    expect(consultar(sinais, "++ (Top Nacional)").precos).toEqual([9_500]);

    const comTop = catalogoDe(
      [
        ["ts", "Top Saúde", null],
        ["pp", "++", "Top"],
      ],
      [
        noConvenio("ts", { price_cents: 3_000 }),
        noConvenio("pp", { price_cents: 9_000 }),
      ],
    );
    const top = consultar(comTop, "Top");
    expect(top.resultado).toBe("convenio_nao_confirmado");
    semValor(top, "Top");
    expect(top.passo).toBe(`${PARECIDOS} ++ (Top), Top Saúde`);
    expect(consultar(comTop, "++ (Top)").precos).toEqual([9_000]);
  });

  // -------------------------------------------------------------------------
  // Oraculo e fuzz (P1 a P5)
  // -------------------------------------------------------------------------

  /** Gerador com semente (mulberry32): o mesmo sorteio a cada execucao. */
  function sorteio(semente: number): () => number {
    let estado = semente >>> 0;
    return () => {
      estado = (estado + 0x6d2b79f5) >>> 0;
      let t = estado;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  /** Guarda o que ja foi normalizado: o oraculo roda milhares de vezes. */
  function lembrando<T>(calcular: (texto: string) => T): (texto: string) => T {
    const feitos = new Map<string, T>();
    return (texto) => {
      const feito = feitos.get(texto);
      if (feito !== undefined) {
        return feito;
      }
      const novo = calcular(texto);
      feitos.set(texto, novo);
      return novo;
    };
  }
  const palavrasDe = lembrando((texto) =>
    normalizarBase(texto)
      .split(/[^a-z0-9]+/)
      .filter((p) => p !== ""),
  );
  /** O texto cru: sem acento, minusculo e com os espacos juntados. */
  const cruDe = lembrando((texto) => normalizarBase(texto));
  /**
   * A palavra dita e, nos parecidos, o resto dela sem uma palavra de ligacao
   * de 4 letras ou mais colada no comeco ou no fim (o resto com 3 letras).
   */
  const formasDe = lembrando((palavra) => [
    palavra,
    ...[...PALAVRAS_DE_LIGACAO]
      .filter((g) => g.length >= 4)
      .flatMap((g) => [
        palavra.startsWith(g) ? palavra.slice(g.length) : "",
        palavra.endsWith(g) ? palavra.slice(0, palavra.length - g.length) : "",
      ])
      .filter((resto) => resto.replace(/[^a-z]/g, "").length >= 3),
  ]);
  const nomeCompleto = (c: ConvenioDoAgente) =>
    c.plano === null ? c.nome : `${c.nome} (${c.plano})`;
  const rotulo = (c: ConvenioDoAgente) =>
    c.plano === null ? `${c.nome} sem plano` : `${c.nome} (${c.plano})`;

  /** O seletor exato: as entradas cujo rotulo e o texto cru do que veio. */
  const peloRotulo = (convenios: readonly ConvenioDoAgente[], dito: string) =>
    convenios.filter((c) => cruDe(rotulo(c)) === cruDe(dito));

  type Veredito =
    | { tipo: "casou"; id: string }
    | { tipo: "plano_nao_informado"; ids: string[] }
    | { tipo: "convenio_nao_confirmado"; ids: string[] }
    | { tipo: "convenio_nao_encontrado" }
    | { tipo: "convenio_nao_informado" };

  /**
   * Oraculo escrito direto da regra, por texto, sem nada da implementacao
   * alem das duas listas de palavras:
   *  - L(x): palavras sem as de ligacao; N = L(nome), P = L(plano); a
   *    entrada e fragil quando N nao tem palavra distintiva (o nome sem
   *    letra nem numero tambem); todas as entradas contam;
   *  - seletor: o texto cru (sem acento, caixa e espacos repetidos; a
   *    pontuacao conta) e o rotulo "Nome (Plano)" ou "Nome sem plano" de
   *    exatamente uma entrada;
   *  - L(dito) vazio: so a fragil SEM plano cujas palavras do nome sao
   *    palavras(dito) e candidata; nenhuma, nao informado (a fragil com
   *    plano so pelo rotulo);
   *  - L(dito) nao vazio: candidato quando L(dito) e igual a N, N+P ou P+N;
   *    a fragil so com palavras(dito) igual a palavras(nome)+palavras(plano).
   *    O convenio cujo nome nao tem palavra ("++") nunca e candidato;
   *  - C: as entradas cujas palavras cruas tem todas as de L(dito) (ou as de
   *    palavras(dito), quando L(dito) e vazio). Um candidato e C so ele:
   *    casou; com candidato, C do mesmo nome (texto cru) e plano nao
   *    informado, senao opcoes; sem candidato, C nao vazio, opcoes;
   *  - os parecidos: as palavras que distinguem a entrada sao as
   *    distintivas de N e P (na fragil, todas as de N e P). Contam so as 40
   *    primeiras palavras ditas, a de mais de 40 caracteres nao conta, e
   *    cada uma vale por ela e, quando comeca ou termina com uma palavra de
   *    ligacao de 4 letras ou mais, pelo resto com 3 letras ou mais (as
   *    formas). Parecida quando uma forma esta entre as que a distinguem,
   *    quando uma forma e a juncao de duas ou mais palavras cruas seguidas
   *    do nome e do plano (com as de ligacao; com uma distintiva, menos na
   *    fragil), ou quando uma que a distingue e a juncao de duas ou mais
   *    palavras ditas seguidas, cada uma numa das formas dela. Juncao com
   *    mais de 40 caracteres nao conta.
   */
  function oraculo(
    convenios: readonly ConvenioDoAgente[],
    dito: string,
  ): Veredito {
    const L = (ps: readonly string[]) =>
      ps.filter((p) => !PALAVRAS_DE_LIGACAO.has(p));
    const letras = (p: string) => p.replace(/[^a-z]/g, "").length;
    const distintiva = (p: string) =>
      !PALAVRAS_DE_LIGACAO.has(p) &&
      !PALAVRAS_QUE_NAO_DISTINGUEM.has(p) &&
      letras(p) >= 3;
    /** Todas as juncoes de duas ou mais palavras seguidas, com 3 letras. */
    const juntas = (ps: readonly string[], comDistintiva: boolean) =>
      ps.flatMap((_, i) =>
        ps
          .map((__, j) => ps.slice(i, j + 1))
          .filter(
            (pedaco) =>
              pedaco.length >= 2 &&
              (!comDistintiva || pedaco.some(distintiva)) &&
              letras(pedaco.join("")) >= 3 &&
              pedaco.join("").length <= 40,
          )
          .map((pedaco) => pedaco.join("")),
      );
    /** Todas as juncoes de duas ou mais posicoes seguidas, em toda forma. */
    const juntasDasFormas = (posicoes: readonly (readonly string[])[]) =>
      posicoes.flatMap((_, i) =>
        posicoes
          .map((__, j) => posicoes.slice(i, j + 1))
          .filter((pedaco) => pedaco.length >= 2)
          .flatMap((pedaco) =>
            pedaco.reduce<string[]>(
              (feitas, opcoesDaPosicao) =>
                feitas.flatMap((feita) =>
                  opcoesDaPosicao.map((forma) => feita + forma),
                ),
              [""],
            ),
          )
          .filter((junta) => letras(junta) >= 3 && junta.length <= 40),
      );
    const t = (ps: readonly string[]) => ps.join(" ");
    const es = convenios.map((c) => {
      const nome = palavrasDe(c.nome);
      const plano = c.plano === null ? [] : palavrasDe(c.plano);
      const fragil = !L(nome).some(distintiva);
      return {
        c,
        nome,
        plano,
        N: L(nome),
        P: L(plano),
        fragil,
        juntas: juntas([...nome, ...plano], !fragil),
        distingue: fragil
          ? L([...nome, ...plano])
          : [...nome, ...plano].filter(distintiva),
      };
    });
    const [rotulado, ...outrosRotulados] = peloRotulo(convenios, dito);
    if (rotulado !== undefined && outrosRotulados.length === 0) {
      return { tipo: "casou", id: rotulado.id };
    }
    const cru = palavrasDe(dito);
    const l = L(cru);
    const candidatos =
      l.length === 0
        ? es.filter(
            (e) =>
              e.fragil &&
              e.c.plano === null &&
              e.nome.length > 0 &&
              t(cru) === t(e.nome),
          )
        : es.filter(
            (e) =>
              e.nome.length > 0 &&
              (e.fragil
                ? t(cru) === t([...e.nome, ...e.plano])
                : [t(e.N), t([...e.N, ...e.P]), t([...e.P, ...e.N])].includes(
                    t(l),
                  )),
          );
    if (l.length === 0 && candidatos.length === 0) {
      return { tipo: "convenio_nao_informado" };
    }
    const termos = l.length > 0 ? l : cru;
    const C = es.filter((e) =>
      termos.every((p) => e.nome.includes(p) || e.plano.includes(p)),
    );
    const ids = (lista: typeof es) => lista.map((e) => e.c.id);
    const [unico] = C;
    if (candidatos.length > 0) {
      if (
        unico !== undefined &&
        candidatos.length === 1 &&
        C.length === 1 &&
        candidatos[0] === unico
      ) {
        return { tipo: "casou", id: unico.c.id };
      }
      return C.every((e) => cruDe(e.c.nome) === cruDe(unico?.c.nome ?? ""))
        ? { tipo: "plano_nao_informado", ids: ids(C) }
        : { tipo: "convenio_nao_confirmado", ids: ids(C) };
    }
    if (C.length > 0) {
      return { tipo: "convenio_nao_confirmado", ids: ids(C) };
    }
    const posicoes = cru
      .slice(0, 40)
      .map((p) => (p.length > 40 ? [] : formasDe(p)));
    const formasDitas = posicoes.flat();
    const juntasDoDito = juntasDasFormas(posicoes);
    const parecidos = es.filter(
      (e) =>
        L(formasDitas).some((p) => e.distingue.includes(p)) ||
        formasDitas.some((p) => e.juntas.includes(p)) ||
        e.distingue.some((p) => letras(p) >= 3 && juntasDoDito.includes(p)),
    );
    return parecidos.length > 0
      ? { tipo: "convenio_nao_confirmado", ids: ids(parecidos) }
      : { tipo: "convenio_nao_encontrado" };
  }

  const MARCA_DO_PACIENTE = "zqpaciente";

  type Contagem = { convenios: number; opcoes: number; casos: Set<string> };

  /** Por catalogo: o teto e as voltas de chamar_com ja conferidas. */
  const conferidos = new WeakMap<
    CatalogoDoAgente,
    { limite: number; voltas: Set<string> }
  >();

  /**
   * Confere P1 a P5 numa consulta: o resultado bate com o oraculo, valor so
   * em particular e convenio, a trilha so com nomes do Cadastro e sem
   * afirmar operadora nao identificada, todo chamar_com e um rotulo que volta
   * na propria entrada (menos o rotulo duplicado no Cadastro) e o teto.
   */
  function conferir(
    catalogo: CatalogoDoAgente,
    procedimento: ProcedimentoDoIndice,
    dito: string,
    contagem: Contagem,
  ): void {
    const cadastro = catalogo.conveniosDoCadastro;
    const jaVisto = conferidos.get(catalogo) ?? {
      limite: limiteDaSaidaDaBusca(catalogo),
      voltas: new Set<string>(),
    };
    conferidos.set(catalogo, jaVisto);
    const r = buscarProcedimento(catalogo, {
      procedimento: procedimento.codigo,
      convenio: dito,
    });
    const s = saida(r);
    const doPaciente = `Consultou o convênio do paciente para ${procedimento.nome}`;
    contagem.casos.add(r.resultado);
    // P5. O teto.
    expect(Buffer.byteLength(r.saida, "utf8"), dito).toBeLessThanOrEqual(
      jaVisto.limite,
    );
    // P1. Valor so em particular e convenio.
    if (r.resultado !== "particular" && r.resultado !== "convenio") {
      expect(r.precos, dito).toEqual([]);
      expect(r.saida, dito).not.toContain("R$");
      expect(r.saida, dito).not.toContain('"atendimentos"');
    }
    expect(r.passo, dito).not.toContain(MARCA_DO_PACIENTE);
    expect(r.saida, dito).not.toContain(MARCA_DO_PACIENTE);
    expect(r.passo, dito).not.toContain("—");
    if (r.resultado === "particular") {
      // O rotulo de um convenio nunca vira o particular.
      expect(peloRotulo(cadastro, dito).length, dito).not.toBe(1);
      return;
    }
    // P2. O resultado e o do oraculo; convenio so quando ele casou.
    const v = oraculo(cadastro, dito);
    const porId = new Map(cadastro.map((c) => [c.id, c]));
    if (v.tipo === "casou") {
      const casado = porId.get(v.id);
      expect(casado, dito).toBeDefined();
      expect(["convenio", "convenio_sem_informacao"], dito).toContain(
        r.resultado,
      );
      expect(s.convenio, dito).toBe(casado && nomeCompleto(casado));
      if (r.resultado === "convenio") {
        contagem.convenios += 1;
        expect(r.passo, dito).toBe(
          `Consultou o preço de ${procedimento.nome} pelo convênio ${String(s.convenio)}`,
        );
      } else {
        expect(r.passo, dito).toBe(
          `Consultou o convênio ${String(s.convenio)} para ${procedimento.nome}: sem informação sobre este procedimento`,
        );
      }
      return;
    }
    expect(r.resultado, dito).toBe(v.tipo);
    const identificacao = identificarConvenio(cadastro, dito);
    expect(identificacao.tipo, dito).toBe(v.tipo);
    // P3. A trilha so cita o Cadastro, e so afirma a operadora identificada.
    if (v.tipo === "convenio_nao_encontrado") {
      expect(r.passo, dito).toBe(
        `${doPaciente}: nenhum convênio parecido no Cadastro`,
      );
      return;
    }
    if (v.tipo === "convenio_nao_informado") {
      expect(r.passo, dito).toBe(`${doPaciente}: ${NAO_IDENTIFICA}`);
      return;
    }
    const opcoes = listadas(s);
    const devolvidos =
      "convenios" in identificacao
        ? identificacao.convenios.map((c) => c.id)
        : [];
    expect(
      opcoes.map((o) => o.convenio),
      dito,
    ).toEqual(
      devolvidos.map((id) => {
        const c = porId.get(id);
        return c ? nomeCompleto(c) : id;
      }),
    );
    if (v.tipo === "plano_nao_informado") {
      expect([...devolvidos].sort(), dito).toEqual([...v.ids].sort());
      const nomes = new Set(
        devolvidos.map((id) => palavrasDe(porId.get(id)?.nome ?? "").join(" ")),
      );
      expect(nomes.size, dito).toBe(1);
      expect(
        r.passo.startsWith(`${doPaciente}: falta saber qual plano de `),
        dito,
      ).toBe(true);
      const operadora = r.passo.slice(
        `${doPaciente}: falta saber qual plano de `.length,
      );
      expect(nomes.has(palavrasDe(operadora).join(" ")), dito).toBe(true);
    } else {
      const maisOpcoes = v.ids.length > MAXIMO_DE_OPCOES;
      expect(devolvidos.length, dito).toBe(
        Math.min(v.ids.length, MAXIMO_DE_OPCOES),
      );
      expect(v.ids, dito).toEqual(expect.arrayContaining(devolvidos));
      expect(s.mais_opcoes, dito).toBe(maisOpcoes);
      expect(r.passo, dito).toBe(
        `${doPaciente}: não deu para confirmar qual convênio; parecidos no Cadastro: ${[...new Set(opcoes.map((o) => o.convenio))].join(", ")}${maisOpcoes ? " e outros" : ""}`,
      );
    }
    // P4. Todo chamar_com e um rotulo e volta na propria entrada.
    devolvidos.forEach((id, i) => {
      const c = porId.get(id);
      const opcao = opcoes[i];
      if (c === undefined || opcao === undefined) {
        throw new Error(`opcao ${id} sem entrada`);
      }
      contagem.opcoes += 1;
      expect(
        c.plano === null ? [c.nome, `${c.nome} sem plano`] : [rotulo(c)],
        dito,
      ).toContain(opcao.chamar_com);
      const chave = `${procedimento.codigo}|${id}|${opcao.chamar_com}`;
      if (jaVisto.voltas.has(chave)) {
        return;
      }
      jaVisto.voltas.add(chave);
      const volta = buscarProcedimento(catalogo, {
        procedimento: procedimento.codigo,
        convenio: opcao.chamar_com,
      });
      const duplicado = peloRotulo(cadastro, rotulo(c)).length > 1;
      if (duplicado) {
        expect(volta.precos, opcao.chamar_com).toEqual([]);
        expect(["convenio", "convenio_sem_informacao"]).not.toContain(
          volta.resultado,
        );
      } else {
        expect(
          ["convenio", "convenio_sem_informacao"],
          `${dito} > ${opcao.chamar_com}`,
        ).toContain(volta.resultado);
        expect(saida(volta).convenio, opcao.chamar_com).toBe(opcao.convenio);
      }
    });
  }

  const CATALOGOS_DO_FUZZ: CatalogoDoAgente[] = [
    CATALOGO,
    catalogoDe(
      [
        ["uf", "Unimed Fortaleza", "Flex"],
        ["un", "Unimed Nacional", "Top"],
        ["u", "Unimed", null],
        ["un2", "Unimed", "Nacional"],
        ["ue", "Unimed", "Enfermaria"],
        ["ufl", "Unimed", "Flex"],
        ["ufp", "Unimed", "Flex Pro"],
        ["hf", "Hapvida", "Flex"],
        ["am", "Amil", "Apartamento"],
        ["ml", "Amil", null],
        ["bt", "Bradesco Saúde", "Top"],
        ["btn", "Bradesco Saúde", "Top Nacional"],
        ["nd", "Notre Dame Intermédica", "Smart 200"],
        ["sf", "São Francisco Saúde", null],
        ["gc", "Golden Cross", null],
        ["sc", "Santa Casa Saúde", null],
        ["ps", "Porto Seguro Saúde", null],
      ],
      [
        noConvenio("uf", { price_cents: 15_000 }),
        noConvenio("u", { covered_by_insurance: true }),
        noConvenio("un2", { price_cents: 11_000 }),
        noConvenio("ue", {
          price_cents: 12_000,
          professional_id: PROF.joao,
        }),
        noConvenio("ue", { covered_by_insurance: true }),
        noConvenio("ufl", { price_cents: 10_000 }),
        noConvenio("ufp", { price_cents: 20_000 }),
        noConvenio("hf", { covered_by_insurance: true }),
        noConvenio("am", { price_cents: 9_500 }),
        noConvenio("bt", { price_cents: 12_000 }),
        noConvenio("nd", { price_cents: 25_000 }),
        noConvenio("sf", { procedure_id: PROC.avaliacao, price_cents: 1 }),
        noConvenio("gc", { covered_by_insurance: true }),
        noConvenio("ps", { procedure_id: PROC.avaliacao, price_cents: 0 }),
      ],
    ),
    catalogoDe(
      [
        ["s", "Saúde", null],
        ["x", "Unimed", "Alfa"],
        ["y", "Unimed", "Beta"],
        ["mp", "Meu Plano", "Ouro"],
        ["os", "Ouro Saúde", null],
        ["tm", "Tem Saúde", null],
        ["md", "Medial Saúde", null],
      ],
      [
        noConvenio("s", { price_cents: 3_000 }),
        noConvenio("x", { covered_by_insurance: true }),
        noConvenio("y", { price_cents: 4_000 }),
        noConvenio("mp", { price_cents: 5_000 }),
        noConvenio("os", { price_cents: 4_500 }),
        noConvenio("tm", { price_cents: 3_500 }),
        noConvenio("md", { price_cents: 8_000 }),
      ],
    ),
    catalogoDe(
      [
        ["ps", "Premium Saúde", null],
        ["om", "Omint", "Premium"],
        ["ts", "Top Saúde", null],
        ["bt", "Bradesco Saúde", "Top"],
        ["b2", "Bradesco", "Top"],
        ["ss", "Santa Saúde", null],
        ["pl", "Plena Saúde", null],
        ["tm", "Tem Saúde", null],
        ["s1", "SulAmérica", null],
        ["s2", "SulAmérica Saúde", null],
        ["sa", "Sul América", "Especial 100"],
        ["hv", "Hapvida", "Nosso Plano"],
        ["un", "Unimed", "Plena"],
        ["ua", "Unimed", "A"],
        // Cadastro duplicado de verdade: so opcao, nunca valor.
        ["d1", "Unimed", "Nacional"],
        ["d2", "UNIMED", "nacional"],
      ],
      [
        noConvenio("ps", { price_cents: 18_000 }),
        noConvenio("om", { price_cents: 9_000 }),
        noConvenio("ts", { price_cents: 5_000 }),
        noConvenio("bt", { price_cents: 12_000 }),
        noConvenio("b2", { covered_by_insurance: true }),
        noConvenio("ss", { price_cents: 10_000 }),
        noConvenio("pl", { price_cents: 7_000 }),
        noConvenio("tm", { price_cents: 3_000 }),
        noConvenio("s1", { price_cents: 6_000 }),
        noConvenio("sa", { price_cents: 6_500 }),
        noConvenio("hv", { covered_by_insurance: true }),
        noConvenio("un", { price_cents: 4_500 }),
        noConvenio("ua", { price_cents: 4_000 }),
        noConvenio("d1", { price_cents: 2_000 }),
      ],
    ),
    // Nome junto com palavra de ligacao, plano que so difere por pontuacao,
    // nome sem letra nem numero e rotulo com palavras do particular.
    catalogoDe(
      [
        ["bs", "Bradesco Saúde", null],
        ["bj", "BradescoSaúde", "Top"],
        ["sc", "Saúde Caixa", null],
        ["tm", "Tem Saúde", null],
        ["mp", "Meu Plano", null],
        ["ts", "Top Saúde", null],
        ["u", "Unimed", null],
        ["up", "Unimed", "Pleno"],
        ["upp", "Unimed", "Pleno+"],
        ["hm", "Hapvida", "Mix"],
        ["hmp", "Hapvida", "Mix+"],
        ["pp", "++", "Top"],
        ["mm", "--", null],
        ["sv", "Sem", "Convênio"],
      ],
      [
        noConvenio("bs", { price_cents: 12_000 }),
        noConvenio("bj", { price_cents: 12_500 }),
        noConvenio("sc", { covered_by_insurance: true }),
        noConvenio("tm", { price_cents: 3_000 }),
        noConvenio("mp", { price_cents: 5_000 }),
        noConvenio("ts", { price_cents: 3_100 }),
        noConvenio("up", { price_cents: 1_000 }),
        noConvenio("upp", { price_cents: 2_000 }),
        noConvenio("hm", { price_cents: 3_000 }),
        noConvenio("hmp", { covered_by_insurance: true }),
        noConvenio("pp", { price_cents: 9_000 }),
        noConvenio("mm", { price_cents: 7_000 }),
        noConvenio("sv", { price_cents: 6_000 }),
      ],
    ),
  ];

  const SOLTAS = [
    "não",
    "é",
    "o",
    "a",
    "de",
    "da",
    "pelo",
    "tenho",
    "tem",
    "meu",
    "plano",
    "convênio",
    "saúde",
    "sem",
    "sem plano",
    "sem plano específico",
    "pro",
    "plus",
    "top",
    "blue",
    "ouro",
    "plena",
    "amilton",
    "sao",
    "santa",
    "particular",
    "cliente",
    "carteirinha",
    "titular",
    "nosso",
    "ou",
    "unimed",
    "(",
    ")",
    "+",
    "?",
    "uso",
    MARCA_DO_PACIENTE,
  ];

  function ditosDo(
    cadastro: readonly ConvenioDoAgente[],
    aleatorio: () => number,
    quantos: number,
  ): string[] {
    const escolher = <T>(lista: readonly T[]): T => {
      const item = lista[Math.floor(aleatorio() * lista.length)];
      if (item === undefined) {
        throw new Error("lista vazia");
      }
      return item;
    };
    const vocabulario = [
      ...SOLTAS,
      ...cadastro.flatMap((c) => [
        c.nome,
        c.plano ?? c.nome,
        ...c.nome.split(" "),
        ...(c.plano ?? "").split(" ").filter((p) => p !== ""),
      ]),
    ];
    return [
      ...cadastro.flatMap((c) => [
        c.nome,
        nomeCompleto(c),
        rotulo(c),
        `${c.nome} ${c.plano ?? ""}`,
        `${c.plano ?? ""} ${c.nome}`,
        `tenho ${c.nome}`,
        `${c.nome} zz`,
        c.plano ?? `${c.nome} saúde`,
        ...c.nome.split(" "),
        // Junto ("BradescoSaude", "SeguroSaude") e com pontuacao fora do
        // rotulo.
        c.nome.replace(/\s+/g, ""),
        c.nome.split(" ").slice(1).join(""),
        `${c.nome}${c.plano ?? "Saúde"}`.replace(/\s+/g, ""),
        `${c.nome}, ${c.plano ?? "sem plano"}`,
        // Colado numa palavra de ligacao que o Cadastro nao tem.
        `${c.nome}saude`,
        `Plano${c.nome}`,
        `Convênio${c.nome.replace(/\s+/g, "")}`,
        `tenho ${c.plano ?? c.nome}Saúde`,
      ]),
      ...Array.from({ length: quantos }, () => {
        const tamanho = 1 + Math.floor(aleatorio() * 5);
        return Array.from({ length: tamanho }, () => {
          const palavra = escolher(vocabulario);
          return aleatorio() < 0.2 ? palavra.toUpperCase() : palavra;
        }).join(escolher([" ", ", ", " - ", "  "]));
      }),
    ].filter((dito) => dito.trim() !== "");
  }

  it("P1 a P5 nos catálogos fixos: o oráculo da regra, valor só com um convênio, trilha, chamar_com e teto", () => {
    const aleatorio = sorteio(20261006);
    const contagem: Contagem = { convenios: 0, opcoes: 0, casos: new Set() };
    for (const catalogo of CATALOGOS_DO_FUZZ) {
      const ditos = ditosDo(catalogo.conveniosDoCadastro, aleatorio, 500);
      for (const p of catalogo.procedimentos) {
        for (const dito of ditos) {
          conferir(catalogo, p, dito, contagem);
        }
      }
    }
    // O sorteio passa por todos os caminhos.
    expect(contagem.convenios).toBeGreaterThan(50);
    expect(contagem.opcoes).toBeGreaterThan(500);
    expect([...contagem.casos].sort()).toEqual([
      "convenio",
      "convenio_nao_confirmado",
      "convenio_nao_encontrado",
      "convenio_nao_informado",
      "convenio_sem_informacao",
      "particular",
      "plano_nao_informado",
    ]);
  }, 60_000);

  it("P1 a P5 em Cadastros sorteados com nomes reais", () => {
    const aleatorio = sorteio(4_06_10_2026);
    const OPERADORAS: [string, string[]][] = [
      [
        "Unimed",
        [
          "Nacional",
          "Enfermaria",
          "Apartamento",
          "Flex",
          "Flex Pro",
          "A",
          "Plena",
        ],
      ],
      ["Unimed Fortaleza", ["Flex", "Top"]],
      ["Unimed Nacional", ["Top", "Flex"]],
      ["Unimed Seguros Saúde", ["Nacional"]],
      ["Bradesco Saúde", ["Top", "Top Nacional", "Nacional Flex", "Efetivo"]],
      ["Bradesco", ["Top"]],
      ["Amil", ["400", "One S1500", "Fácil", "Apartamento", "Blue"]],
      ["Amil Dental", []],
      ["Hapvida", ["Nosso Plano", "Flex", "Mix"]],
      ["Hap Vida", []],
      ["Notre Dame Intermédica", ["Smart 200", "Smart 300", "Premium 900"]],
      ["SulAmérica", ["Clássico", "Especial 100", "Executivo"]],
      ["SulAmérica Saúde", ["Especial 100"]],
      ["Sul América", ["Especial 100"]],
      ["Porto Seguro Saúde", ["Bronze", "Prata"]],
      ["Cassi", ["Família", "Associados"]],
      ["São Francisco Saúde", ["Clássico"]],
      ["Santa Casa Saúde", []],
      ["Santa Saúde", []],
      ["Tem Saúde", ["Ouro"]],
      ["Meu Plano", ["Ouro", "Prata"]],
      ["Ouro Saúde", []],
      ["Omint", ["Premium"]],
      ["Premium Saúde", []],
      ["Top Saúde", []],
      ["Plena Saúde", []],
      ["Medial Saúde", []],
      ["Saúde Caixa", []],
      ["Bradesco Saúde", []],
      ["Hapvida", ["Mix", "Mix+"]],
      ["Unimed", ["Pleno", "Pleno+"]],
    ];
    const contagem: Contagem = { convenios: 0, opcoes: 0, casos: new Set() };
    for (let rodada = 0; rodada < 40; rodada += 1) {
      const convenios: [string, string, string | null][] = [];
      const vinculos: LinhasDoCatalogo["vinculos"][number][] = [];
      for (const [nome, planos] of OPERADORAS) {
        if (aleatorio() < 0.35) {
          for (const plano of [null, ...planos]) {
            const entra =
              plano === null
                ? planos.length === 0 || aleatorio() < 0.3
                : aleatorio() < 0.5;
            if (entra) {
              const id = `c${convenios.length}`;
              convenios.push([id, nome, plano]);
              if (aleatorio() < 0.6) {
                vinculos.push(
                  noConvenio(id, {
                    price_cents:
                      aleatorio() < 0.3 ? null : 1_000 + convenios.length,
                    covered_by_insurance: aleatorio() < 0.3,
                  }),
                );
              }
            }
          }
        }
      }
      const catalogo = catalogoDe(convenios, vinculos);
      const [consulta] = catalogo.procedimentos;
      if (consulta === undefined) {
        throw new Error("catalogo sem procedimento");
      }
      for (const dito of ditosDo(catalogo.conveniosDoCadastro, aleatorio, 60)) {
        conferir(catalogo, consulta, dito, contagem);
      }
    }
    expect(contagem.convenios).toBeGreaterThan(100);
    expect(contagem.opcoes).toBeGreaterThan(500);
  }, 60_000);

  it("P4. todo rótulo do Cadastro volta na própria entrada; o nome sozinho, só quando ele basta", () => {
    for (const catalogo of CATALOGOS_DO_FUZZ) {
      const cadastro = catalogo.conveniosDoCadastro;
      for (const c of cadastro) {
        const duplicado = peloRotulo(cadastro, rotulo(c)).length > 1;
        const r = identificarConvenio(cadastro, rotulo(c));
        const [consulta] = catalogo.procedimentos;
        const volta =
          consulta &&
          buscarProcedimento(catalogo, {
            procedimento: consulta.codigo,
            convenio: rotulo(c),
          });
        if (duplicado) {
          expect(r.tipo, rotulo(c)).not.toBe("casou");
          expect(volta?.precos, rotulo(c)).toEqual([]);
        } else {
          expect(r, rotulo(c)).toEqual({ tipo: "casou", convenio: c });
          // O rotulo vale antes das palavras do particular ("++ sem plano").
          expect(["convenio", "convenio_sem_informacao"], rotulo(c)).toContain(
            volta?.resultado,
          );
          expect(volta && saida(volta).convenio, rotulo(c)).toBe(
            nomeCompleto(c),
          );
        }
      }
    }
  });

  it("ajuste 1. fuzz de colagem: XSaúde, Xsaude, PlanoX e ConvênioX com 18 nomes reais nunca dão 'nenhum parecido'", () => {
    const NOMES = [
      "Unimed",
      "Amil",
      "Bradesco",
      "SulAmérica",
      "Hapvida",
      "Cassi",
      "Geap",
      "Omint",
      "Golden Cross",
      "Care Plus",
      "Medsênior",
      "Camed",
      "Postal",
      "Allianz",
      "Mediservice",
      "Porto Seguro",
      "Notre Dame Intermédica",
      "Unimed Fortaleza",
    ];
    const coladas = (nome: string) =>
      [nome, nome.replace(/\s+/g, "")].flatMap((x) => [
        `${x}Saúde`,
        `${x}saude`,
        `Plano${x}`,
        `Convênio${x}`,
      ]);
    const todos = catalogoDe(
      NOMES.map((nome, i) => [`n${i}`, nome, null]),
      NOMES.map((_, i) => noConvenio(`n${i}`, { price_cents: 1_000 + i })),
    );
    const sozinhos = NOMES.map((nome) =>
      catalogoDe(
        [["n", nome, null]],
        [noConvenio("n", { price_cents: 1_000 })],
      ),
    );
    const [consulta] = todos.procedimentos;
    if (consulta === undefined) {
      throw new Error("catalogo sem procedimento");
    }
    const contagem: Contagem = { convenios: 0, opcoes: 0, casos: new Set() };
    NOMES.forEach((nome, i) => {
      for (const catalogo of [todos, sozinhos[i]]) {
        if (catalogo === undefined) {
          throw new Error("catalogo faltando");
        }
        for (const dito of coladas(nome)) {
          const r = consultar(catalogo, dito);
          expect(r.resultado, dito).toBe("convenio_nao_confirmado");
          expect(
            listadas(saida(r)).map((o) => o.convenio),
            dito,
          ).toContain(nome);
          semValor(r, dito);
          conferir(catalogo, consulta, dito, contagem);
        }
      }
    });
    expect([...contagem.casos]).toEqual(["convenio_nao_confirmado"]);
  });

  it("ajuste 3. teto do trabalho: um Cadastro absurdo responde no prazo, e nos parecidos só contam as 40 primeiras palavras, até 40 caracteres", () => {
    const varias = (palavra: string, vezes: number) =>
      Array.from({ length: vezes }, () => palavra).join(" ");
    const absurdos: [(i: number) => [string, string, string], string[]][] = [
      [
        (i) => [
          `a${i}`,
          varias("x", 60).slice(0, 119),
          varias("x", 60).slice(0, 119),
        ],
        ["x".repeat(255), varias("x", 128).slice(0, 255)],
      ],
      [
        (i) => [
          `b${i}`,
          `${"x".repeat(118)}y${i % 10}`,
          `${"x".repeat(118)}z${i % 10}`,
        ],
        [varias("x", 128).slice(0, 255), varias("xxxy", 51).slice(0, 255)],
      ],
      [
        (i) => [
          `c${i}`,
          varias("xy", 40).slice(0, 119),
          varias("xy", 40).slice(0, 119),
        ],
        [`${"xy".repeat(127)}q`, varias("x y", 64).slice(0, 255)],
      ],
      [
        (i) => [
          `d${i}`,
          `abc ${varias("abc", 20)}`.slice(0, 119),
          varias("saude", 20).slice(0, 119),
        ],
        [
          varias("planoabcsaude", 18).slice(0, 255),
          varias("planosabcpelos", 17).slice(0, 255),
        ],
      ],
    ];
    for (const [convenio, ditos] of absurdos) {
      const linhas = Array.from({ length: 300 }, (_, i) => convenio(i));
      const catalogo = catalogoDe(
        linhas,
        linhas.map(([id]) => noConvenio(id, { price_cents: 1_000 })),
      );
      for (const dito of ditos) {
        const inicio = performance.now();
        const r = consultar(catalogo, dito);
        expect(performance.now() - inicio, dito).toBeLessThan(500);
        semValor(r, dito);
      }
    }

    // A 41a palavra dita nao conta nos parecidos.
    const amil = catalogoDe(
      [["am", "Amil", null]],
      [noConvenio("am", { price_cents: 8_000 })],
    );
    const ate40 = consultar(amil, `${varias("zz", 39)} Amil`);
    expect(ate40.resultado).toBe("convenio_nao_confirmado");
    expect(ate40.passo).toBe(`${PARECIDOS} Amil`);
    expect(consultar(amil, `${varias("zz", 40)} Amil`).resultado).toBe(
      "convenio_nao_encontrado",
    );
    // A juncao de 40 caracteres conta; a de 41, nao.
    const quarenta = `Alfa${"a".repeat(16)} Beta${"b".repeat(16)}`;
    const quarentaEUm = `Gama${"g".repeat(16)} Delta${"d".repeat(16)}`;
    const longos = catalogoDe(
      [
        ["q", quarenta, null],
        ["r", quarentaEUm, null],
      ],
      [noConvenio("q", { price_cents: 1_000 })],
    );
    const junto40 = consultar(longos, quarenta.replace(" ", ""));
    expect(junto40.resultado).toBe("convenio_nao_confirmado");
    expect(junto40.passo).toBe(`${PARECIDOS} ${quarenta}`);
    expect(consultar(longos, quarentaEUm.replace(" ", "")).resultado).toBe(
      "convenio_nao_encontrado",
    );
  });

  it("ajuste 3. a junção é conferida posição a posição: fala com formas que ramificam responde no prazo e ainda acha a junção pelas formas", () => {
    // Cada "pelas" + 3 letras tem tres formas ("pelasaaa", "saaa", "aaa"):
    // montar as juncoes da fala davam centenas de milhares e uns 200 ms por
    // consulta, com um convenio so no Cadastro. O custo e da fala.
    const letra = (i: number) => String.fromCharCode(97 + (i % 26));
    const ramificadas = [
      Array.from({ length: 28 }, (_, i) => `pelas${letra(i).repeat(3)}`).join(
        " ",
      ),
      Array.from(
        { length: 28 },
        (_, i) => `pelas${letra(i)}${letra(i + 7)}${letra(i + 13)}`,
      ).join(" "),
      Array.from({ length: 28 }, (_, i) => `pelos${letra(i).repeat(3)}`).join(
        " ",
      ),
      Array.from({ length: 25 }, (_, i) => `pelas${letra(i).repeat(3)}`).join(
        ", ",
      ),
    ];
    const um = catalogoDe(
      [["u", "Unimed", null]],
      [noConvenio("u", { price_cents: 5_000 })],
    );
    const reais = catalogoDe(
      [
        "Unimed",
        "Amil",
        "Bradesco Saúde",
        "SulAmérica",
        "Hapvida",
        "Tem Saúde",
        "Golden Cross",
        "Cassi",
        "Geap",
        "Omint",
      ].map((nome, i) => [`r${i}`, nome, null]),
      [noConvenio("r0", { price_cents: 5_000 })],
    );
    const inicio = performance.now();
    for (let vez = 0; vez < 2; vez += 1) {
      for (const catalogo of [um, reais]) {
        for (const dito of ramificadas) {
          const r = consultar(catalogo, dito);
          expect(r.resultado, dito).toBe("convenio_nao_encontrado");
          semValor(r, dito);
        }
      }
    }
    // 16 consultas: antes passavam de 2 segundos.
    expect(performance.now() - inicio).toBeLessThan(500);

    // A juncao ainda passa pelas formas de cada palavra dita: "hap" (de
    // "PelasHap") + "vida" (de "VidaSaude") e "Hapvida", depois de 20
    // palavras que ramificam.
    const hapvida = catalogoDe(
      [
        ["hv", "Hapvida", null],
        ["u", "Unimed", null],
      ],
      [noConvenio("hv", { price_cents: 7_000 })],
    );
    const prefixo = (ramificadas[0] ?? "").split(" ").slice(0, 20).join(" ");
    for (const dito of [
      "PelasHap VidaSaúde",
      `${prefixo} PelasHap VidaSaúde`,
      `${prefixo} Hap Vida`,
    ]) {
      const r = consultar(hapvida, dito);
      expect(r.resultado, dito).toBe("convenio_nao_confirmado");
      expect(r.passo, dito).toBe(`${PARECIDOS} Hapvida`);
      semValor(r, dito);
    }
    // Junta so palavras ditas seguidas: com outra no meio, nao.
    expect(consultar(hapvida, "PelasHap zz VidaSaúde").resultado).toBe(
      "convenio_nao_encontrado",
    );
  });

  it("limite. o frágil só com palavras de ligação ('Tem Saúde') é parecido escrito junto, e não separado com mais alguma coisa, como a frase comum", () => {
    const NENHUM = `${PREFIXO}: nenhum convênio parecido no Cadastro`;
    for (const plano of [null, "Executivo"]) {
      const tem = catalogoDe(
        [
          ["t", "Tem Saúde", plano],
          ["u", "Unimed", null],
          ["am", "Amil", null],
          ["b", "Bradesco Saúde", null],
        ],
        [
          noConvenio("t", { price_cents: 3_000 }),
          noConvenio("u", { price_cents: 5_000 }),
        ],
      );
      const nome = plano === null ? "Tem Saúde" : `Tem Saúde (${plano})`;
      // Junto, a juncao das palavras dele e dita: parecido.
      for (const dito of ["TemSaúdeSaúde", "PlanoTemSaúde", "TemSaúde"]) {
        const r = consultar(tem, dito);
        expect(r.resultado, dito).toBe("convenio_nao_confirmado");
        expect(r.passo, dito).toBe(`${PARECIDOS} ${nome}`);
        semValor(r, dito);
      }
      // Limite (docs/03): separado e com mais alguma coisa, nada o distingue,
      // como na frase comum "Hapvida tem saude".
      for (const dito of [
        "Tem SaúdeSaúde",
        "Tem Saudesaude",
        "PlanoTem Saúde",
        "ConvênioTem Saúde",
        "Tem SaúdeCliente",
        "Tem Saúde Ouro",
        "Tem Saúde 2",
        "Hapvida tem saúde",
      ]) {
        const r = consultar(tem, dito);
        expect(r.resultado, dito).toBe("convenio_nao_encontrado");
        expect(r.passo, dito).toBe(NENHUM);
        semValor(r, dito);
      }
    }
    const meu = catalogoDe(
      [
        ["mp", "Meu Plano", null],
        ["u", "Unimed", null],
      ],
      [noConvenio("mp", { price_cents: 6_000 })],
    );
    const junto = consultar(meu, "MeuPlanoSaúde");
    expect(junto.resultado).toBe("convenio_nao_confirmado");
    expect(junto.passo).toBe(`${PARECIDOS} Meu Plano`);
    for (const dito of [
      "Meu PlanoSaúde",
      "PlanoMeu Plano",
      "Meu Plano Top",
      "meu plano é Hapvida",
    ]) {
      const r = consultar(meu, dito);
      expect(r.resultado, dito).toBe("convenio_nao_encontrado");
      expect(r.passo, dito).toBe(NENHUM);
      semValor(r, dito);
    }
  });
});

describe("definições para a Responses API", () => {
  it("buscar_procedimento: strict, sem propriedade a mais e com as chaves do zod", () => {
    const parametros = FERRAMENTA_BUSCAR_PROCEDIMENTO.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(FERRAMENTA_BUSCAR_PROCEDIMENTO.strict).toBe(true);
    expect(parametros.additionalProperties).toBe(false);
    expect(Object.keys(parametros.properties).sort()).toEqual(
      Object.keys(entradaDaBuscaSchema.shape).sort(),
    );
    expect([...parametros.required].sort()).toEqual(
      Object.keys(entradaDaBuscaSchema.shape).sort(),
    );
  });

  it("escalar_humano: strict, motivos do agente dentro de escalation_reason", () => {
    const parametros = FERRAMENTA_ESCALAR_HUMANO.parameters as {
      properties: { motivo: { enum: string[] } };
      required: string[];
      additionalProperties: boolean;
    };
    expect(FERRAMENTA_ESCALAR_HUMANO.strict).toBe(true);
    expect(parametros.additionalProperties).toBe(false);
    expect(parametros.required).toEqual(
      Object.keys(entradaDoEscalonamentoSchema.shape),
    );
    expect(parametros.properties.motivo.enum).toEqual([...MOTIVOS_DO_AGENTE]);
    for (const motivo of MOTIVOS_DO_AGENTE) {
      expect(MOTIVOS_DE_ESCALONAMENTO).toContain(motivo);
    }
    // Os do sistema nunca vem do modelo.
    for (const doSistema of [
      "conformidade",
      "teto_atingido",
      "midia_nao_suportada",
    ]) {
      expect(MOTIVOS_DO_AGENTE as readonly string[]).not.toContain(doSistema);
    }
  });
});

describe("motivoDoEscalonamento", () => {
  it("aceita o motivo do agente e transforma o resto em agente_pediu", () => {
    expect(motivoDoEscalonamento({ motivo: "sintoma" })).toBe("sintoma");
    expect(motivoDoEscalonamento({ motivo: "conformidade" })).toBe(
      "agente_pediu",
    );
    expect(motivoDoEscalonamento(null)).toBe("agente_pediu");
    expect(motivoDoEscalonamento({ motivo: "sintoma", extra: true })).toBe(
      "agente_pediu",
    );
  });
});
