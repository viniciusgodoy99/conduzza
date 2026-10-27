import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { carregarCatalogoDoAgente } from "@/lib/agente/contexto";
import { consultarUnidades } from "@/lib/agente/ferramentas/consultar-unidades";
import { buscarProcedimento } from "@/lib/agente/ferramentas/buscar-procedimento";

import { AgendaEmMemoria, type Linha } from "./agenda-em-memoria";
import { CLINICA, CONV, PROC, PROF } from "./agenda-fixtures";
import {
  ENDERECO_DA_ALDEOTA,
  linhasDoCadastro,
  PROC_AG2,
  UNID,
} from "./cadastro-fixtures";

// O carregador do catalogo com o Cadastro da AG2 (lib/agente/contexto.ts),
// pela service role, sobre um banco em memoria: toda leitura com o clinic_id
// explicito e colunas explicitas; a unidade sem CEP, telefone, link e
// endereco livre; o procedimento sem preparo; a jornada so com a unidade; o
// preco do vinculo que a IA nao marca so dos procedimentos que deixam
// informar, lido depois e so quando ha. Erro de leitura derruba o catalogo
// inteiro (falha fechada). Nada de rede nem de OpenAI.

const OUTRA = "bbbbbbbb-0000-4000-8000-000000000000";

let saida: string[];

beforeEach(() => {
  saida = [];
  vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
    saida.push(String(linha));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function daClinica<T extends object>(linhas: readonly T[], clinica = CLINICA) {
  return linhas.map((linha, i): Linha => ({
    id: `${String(i).padStart(4, "0")}-${clinica.slice(0, 4)}`,
    ...linha,
    clinic_id: clinica,
  }));
}

/** O Cadastro das fixtures no banco em memoria, e o de outra clinica. */
function bancoDoCadastro(): AgendaEmMemoria {
  const linhas = linhasDoCadastro();
  const banco = new AgendaEmMemoria();
  banco.inserir("procedure", ...daClinica(linhas.procedimentos));
  // Os vinculos como estao no banco: os do agente com "IA pode agendar" e os
  // da equipe sem (o banco nao tem a separacao das fixtures).
  banco.inserir(
    "service_link",
    ...daClinica(linhas.vinculos),
    ...daClinica(linhas.vinculosDaEquipe ?? []).map((v) => ({
      ...v,
      bookable_by_ai: false,
    })),
  );
  banco.inserir("professional", ...daClinica(linhas.profissionais));
  banco.inserir("insurance", ...daClinica(linhas.convenios));
  banco.inserir("clinic", { id: CLINICA, name: "Clínica Bem Estar" });
  banco.inserir(
    "unit",
    ...daClinica(linhas.unidades ?? []).map((u) => ({
      ...u,
      // O que o banco tem e a IA nunca le.
      cep: "60150160",
      phone: "(85) 3333-4444",
      link_do_mapa: "https://maps.example.com/x",
      address: "Texto livre (85) 3333-4444",
    })),
  );
  banco.inserir("professional_schedule", ...daClinica(linhas.jornadas ?? []));
  banco.inserir("procedure_requirement", ...daClinica(linhas.requisitos ?? []));
  banco.inserir(
    "professional_insurance",
    ...daClinica(linhas.conveniosDosProfissionais ?? []),
  );
  // A outra clinica: nada dela pode aparecer.
  banco.inserir(
    "unit",
    ...daClinica(
      [
        {
          name: "Unidade da Outra",
          active: true,
          logradouro: "Rua da Outra",
          numero: "1",
        },
      ],
      OUTRA,
    ),
  );
  banco.inserir(
    "procedure_requirement",
    ...daClinica(
      [
        {
          procedure_id: PROC.consulta,
          insurance_id: null,
          tipo: "acompanhante",
          valor_inteiro: null,
          texto_ao_paciente: null,
          ativo: true,
        },
      ],
      OUTRA,
    ),
  );
  return banco;
}

describe("carregarCatalogoDoAgente com o Cadastro da AG2", () => {
  it("toda leitura leva o clinic_id explícito e colunas explícitas", async () => {
    const banco = bancoDoCadastro();
    await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    expect(banco.leituras.length).toBeGreaterThan(0);
    for (const leitura of banco.leituras) {
      expect(leitura.filtros, leitura.tabela).toContain(
        leitura.tabela === "clinic"
          ? `eq:id=${CLINICA}`
          : `eq:clinic_id=${CLINICA}`,
      );
      expect(leitura.colunas, leitura.tabela).not.toContain("*");
      expect(leitura.colunas, leitura.tabela).not.toBe("");
    }
    expect(banco.escritas).toEqual([]);
    const tabelas = new Set(banco.leituras.map((l) => l.tabela));
    for (const tabela of [
      "unit",
      "professional_schedule",
      "procedure_requirement",
      "professional_insurance",
    ]) {
      expect(tabelas, tabela).toContain(tabela);
    }
    // Nada de paciente.
    for (const tabela of [
      "contact",
      "conversation",
      "message",
      "appointment",
    ]) {
      expect(tabelas, tabela).not.toContain(tabela);
    }
  });

  it("a unidade sem CEP, telefone, link e endereço livre; o procedimento sem preparo; a jornada só com a unidade", async () => {
    const banco = bancoDoCadastro();
    const catalogo = await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    const colunas = (tabela: string) =>
      banco.leituras
        .filter((l) => l.tabela === tabela)
        .map((l) => l.colunas.split(",").map((c) => c.trim()));
    for (const lista of colunas("unit")) {
      for (const proibida of ["cep", "phone", "link_do_mapa", "address"]) {
        expect(lista).not.toContain(proibida);
      }
    }
    for (const lista of colunas("procedure")) {
      expect(lista).not.toContain("prep_instructions");
      expect(lista).not.toContain("description");
      expect(lista).toContain("ia_pode_informar");
      expect(lista).toContain("requires_evaluation");
    }
    expect(colunas("professional_schedule")).toEqual([
      ["professional_id", "unit_id"],
    ]);
    expect(colunas("professional_insurance")).toEqual([
      ["professional_id", "insurance_id"],
    ]);
    const texto = JSON.stringify(catalogo);
    expect(texto).not.toMatch(/60150160|3333-4444|maps\.example|Texto livre/);
    expect(texto).not.toContain("Unidade da Outra");
    expect(catalogo.unidades?.map((u) => [u.codigo, u.nome, u.id])).toEqual([
      ["u1", "Aldeota", UNID.aldeota],
      ["u2", "Centro", UNID.centro],
    ]);
    expect(
      JSON.parse(consultarUnidades(catalogo, { unidade: "u1" }).saida),
    ).toMatchObject({
      unidades: [{ endereco: ENDERECO_DA_ALDEOTA }],
    });
    // Os requisitos da outra clinica nao entram.
    expect(
      (catalogo.requisitos ?? []).filter(
        (r) => r.procedimentoId === PROC.consulta && r.tipo === "acompanhante",
      ),
    ).toEqual([]);
  });

  it("todos os procedimentos ativos, com e sem 'IA pode agendar'; o índice continua o mesmo", async () => {
    const banco = bancoDoCadastro();
    const catalogo = await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    const doProcedimento = banco.leituras.filter(
      (l) => l.tabela === "procedure",
    );
    for (const leitura of doProcedimento) {
      expect(leitura.filtros).toContain("eq:active=true");
      expect(leitura.filtros).not.toContain("eq:bookable_by_ai=true");
    }
    expect(catalogo.procedimentos.map((p) => [p.codigo, p.nome])).toEqual([
      ["p1", "Consulta"],
      ["p2", "Exame"],
      ["p3", "Limpeza de pele"],
    ]);
    expect(
      (catalogo.procedimentosSoComAEquipe ?? []).map((p) => [p.codigo, p.nome]),
    ).toEqual([
      ["p4", "Botox"],
      ["p5", "Implante"],
    ]);
  });

  it("o preço do vínculo que a IA não marca: lido depois, só do procedimento que deixa informar", async () => {
    const banco = bancoDoCadastro();
    const catalogo = await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    const comPreco = banco.leituras.filter(
      (l) =>
        l.tabela === "service_link" &&
        l.filtros.some((f) => f.startsWith("in:procedure_id")),
    );
    expect(comPreco).toHaveLength(1);
    expect(comPreco[0]?.colunas).toContain("price_cents");
    expect(comPreco[0]?.filtros).toContain("eq:active=true");
    // A leitura dos ids sem preco (D14) continua igual.
    const soIds = banco.leituras.filter(
      (l) =>
        l.tabela === "service_link" &&
        l.filtros.includes("eq:bookable_by_ai=false"),
    );
    expect(soIds.map((l) => l.colunas)).toEqual([
      "procedure_id, professional_id, insurance_id",
    ]);
    // So o Botox: o Implante nao deixa informar, e os do indice nao vem.
    expect(
      (catalogo.vinculosDaEquipe ?? []).map((v) => v.procedimentoId),
    ).toEqual([PROC_AG2.botox, PROC_AG2.botox]);
    expect(
      buscarProcedimento(catalogo, { procedimento: "p5", convenio: null })
        .resultado,
    ).toBe("so_com_a_equipe");
    expect(
      buscarProcedimento(catalogo, { procedimento: "p4", convenio: null })
        .precos,
    ).toEqual([120_000]);
  });

  it("sem procedimento que deixe informar fora do índice, a leitura do preço da equipe nem acontece", async () => {
    const banco = bancoDoCadastro();
    for (const linha of banco.linhas("procedure")) {
      if (linha.id !== undefined && !linha.bookable_by_ai) {
        linha.ia_pode_informar = false;
      }
    }
    await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    expect(
      banco.leituras.some(
        (l) =>
          l.tabela === "service_link" &&
          l.filtros.some((f) => f.startsWith("in:procedure_id")),
      ),
    ).toBe(false);
  });

  it.each([
    "unit",
    "professional_schedule",
    "procedure_requirement",
    "professional_insurance",
  ])(
    "erro na leitura de %s derruba o catálogo inteiro (falha fechada)",
    async (tabela) => {
      const banco = bancoDoCadastro();
      banco.comErro.add(tabela);
      await expect(
        carregarCatalogoDoAgente(banco.cliente(), CLINICA),
      ).rejects.toThrow("leitura do agente falhou");
    },
  );

  it("erro na leitura do preço da equipe também derruba o catálogo", async () => {
    const banco = bancoDoCadastro();
    const cliente = banco.cliente();
    const original = cliente.from.bind(cliente);
    let leiturasDeVinculo = 0;
    const quebrado = {
      ...cliente,
      from: (tabela: string) => {
        if (tabela === "service_link") {
          leiturasDeVinculo += 1;
          // A terceira leitura de vinculo e a do preco da equipe.
          if (leiturasDeVinculo === 3) {
            banco.comErro.add("service_link");
          }
        }
        return original(tabela);
      },
    } as typeof cliente;
    await expect(carregarCatalogoDoAgente(quebrado, CLINICA)).rejects.toThrow(
      "leitura do agente falhou",
    );
  });

  it("o texto do Cadastro que as regras barram vai para o log só pela contagem", async () => {
    const banco = bancoDoCadastro();
    await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    const aviso = saida.find((l) =>
      l.includes('"evento":"agente_texto_do_cadastro_descartado"'),
    );
    expect(aviso).toBeDefined();
    const campos = JSON.parse(aviso ?? "{}") as Record<string, unknown>;
    expect(campos).toMatchObject({ clinic_id: CLINICA, count: 1 });
    expect(Object.keys(campos).sort()).toEqual(
      ["clinic_id", "count", "evento", "nivel", "ts"].sort(),
    );
    expect(saida.join("")).not.toContain("jejum");
  });

  it("o convênio do profissional e a jornada vêm só da clínica, com profissional e convênio ativos", async () => {
    const banco = bancoDoCadastro();
    banco.inserir(
      "professional_insurance",
      ...daClinica(
        [{ professional_id: PROF.ana, insurance_id: CONV.amil }],
        OUTRA,
      ),
    );
    const catalogo = await carregarCatalogoDoAgente(banco.cliente(), CLINICA);
    expect(
      (catalogo.conveniosDosProfissionais ?? []).some(
        (c) => c.profissionalId === PROF.ana && c.convenioId === CONV.amil,
      ),
    ).toBe(false);
  });
});
