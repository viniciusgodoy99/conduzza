import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  catalogoKeys,
  fetchCatalogo,
  fetchMatrizDeConvenios,
} from "@/lib/queries/catalogo";

// Convenio pelo medico (02/10/2026): a matriz de convenios (quem atende e o
// que cobre) e os vinculos do catalogo chegam COMPLETOS. O PostgREST corta
// toda leitura em max_rows = 1000 SEM erro; uma linha faltando faria a trava
// otimista das RPCs recusar todo Salvar com CZ409 (a aba "parada" nunca
// deixaria de ser parada) e o proximo Salvar desativar o que nao veio. Por
// isso as tres leituras paginam por id com .range() e, se qualquer pagina
// falhar, LANCAM: a lista cortada nunca e entregue.
//
// Contra um cliente do Supabase dublado que aplica eq, ordena por id e
// corta no range pedido, e que no maximo devolve 1000 linhas por leitura
// (como o max_rows do PostgREST).

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const OUTRA = "0a0a0a0a-0000-4000-8000-00000000000b";
const MAX_ROWS = 1000;

type Linha = Record<string, unknown>;
type Erro = { message: string };

const estado = {
  tabelas: {} as Record<string, Linha[]>,
  /** Erro na leitura da tabela a partir da pagina (0 = primeira) */
  erroNaPagina: {} as Record<string, { pagina: number; erro: Erro }>,
  ranges: {} as Record<string, [number, number][]>,
  ordens: {} as Record<string, string[]>,
};

function consulta(tabela: string) {
  const filtros: [string, unknown][] = [];
  let intervalo: [number, number] | null = null;
  const resultado = () => {
    const linhas = (estado.tabelas[tabela] ?? [])
      .filter((linha) => filtros.every(([c, v]) => linha[c] === v))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (intervalo) {
      const [de, ate] = intervalo;
      const pagina = Math.floor(de / MAX_ROWS);
      const falha = estado.erroNaPagina[tabela];
      if (falha && pagina >= falha.pagina) {
        return { data: null, error: falha.erro };
      }
      return {
        data: linhas.slice(de, Math.min(ate + 1, de + MAX_ROWS)),
        error: null,
      };
    }
    const falha = estado.erroNaPagina[tabela];
    if (falha) {
      return { data: null, error: falha.erro };
    }
    return { data: linhas.slice(0, MAX_ROWS), error: null };
  };
  const api = {
    select: () => api,
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return api;
    },
    order: (coluna: string) => {
      (estado.ordens[tabela] ??= []).push(coluna);
      return api;
    },
    range: (de: number, ate: number) => {
      (estado.ranges[tabela] ??= []).push([de, ate]);
      intervalo = [de, ate];
      return api;
    },
    then: <T>(
      resolver: (valor: ReturnType<typeof resultado>) => T,
      rejeitar?: (motivo: unknown) => T,
    ) => Promise.resolve(resultado()).then(resolver, rejeitar),
  };
  return api;
}

const cliente = {
  from: (tabela: string) => consulta(tabela),
} as unknown as SupabaseClient;

function id(prefixo: string, n: number): string {
  return `${prefixo}-${String(n).padStart(6, "0")}`;
}

function pares(
  tabela: "professional_insurance" | "procedure_insurance",
  quantos: number,
  clinicId = CLINICA,
): Linha[] {
  const chave =
    tabela === "professional_insurance" ? "professional_id" : "procedure_id";
  return Array.from({ length: quantos }, (_, n) => ({
    id: id(`${tabela}-${clinicId.slice(-1)}`, n),
    clinic_id: clinicId,
    [chave]: id("cadastro", n),
    insurance_id: id("convenio", n % 7),
  }));
}

function vinculos(quantos: number, active = true, clinicId = CLINICA): Linha[] {
  return Array.from({ length: quantos }, (_, n) => ({
    id: id(`vinculo-${active ? "a" : "i"}-${clinicId.slice(-1)}`, n),
    clinic_id: clinicId,
    professional_id: id("prof", n % 13),
    procedure_id: id("proc", n),
    insurance_id: n % 3 === 0 ? null : id("convenio", n % 5),
    price_cents: 40000,
    covered_by_insurance: false,
    duration_min: 40,
    bookable_by_ai: true,
    active,
  }));
}

beforeEach(() => {
  estado.tabelas = {};
  estado.erroNaPagina = {};
  estado.ranges = {};
  estado.ordens = {};
});

describe("catalogoKeys.matriz", () => {
  it("mora sob o prefixo do catálogo: o aoMudar de Cadastros recarrega a matriz junto", () => {
    const prefixo = catalogoKeys.tudo(CLINICA);
    const chave = catalogoKeys.matriz(CLINICA);
    expect(chave).toEqual(["catalogo", CLINICA, "matriz-de-convenios"]);
    expect(chave.slice(0, prefixo.length)).toEqual([...prefixo]);
  });
});

describe("fetchMatrizDeConvenios", () => {
  it("mais de 1000 pares nas duas tabelas: lê todas as páginas, por id, e entrega tudo", async () => {
    estado.tabelas.professional_insurance = pares(
      "professional_insurance",
      1001,
    );
    estado.tabelas.procedure_insurance = pares("procedure_insurance", 2001);

    const matriz = await fetchMatrizDeConvenios(cliente, CLINICA);

    expect(matriz.atendimentos).toHaveLength(1001);
    expect(matriz.coberturas).toHaveLength(2001);
    expect(estado.ranges.professional_insurance).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(estado.ranges.procedure_insurance).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    // Paginar sem ordem por chave unica repete ou pula linha entre paginas:
    // toda pagina pede a ordem por id.
    expect(estado.ordens.professional_insurance).toEqual(["id", "id"]);
    expect(estado.ordens.procedure_insurance).toEqual(["id", "id", "id"]);
    // Sem repeticao: cada par uma vez.
    expect(
      new Set(matriz.atendimentos.map((p) => p.professional_id)).size,
    ).toBe(1001);
  });

  it("entrega só os campos do contrato (sem id nem clinic_id)", async () => {
    estado.tabelas.professional_insurance = pares("professional_insurance", 1);
    estado.tabelas.procedure_insurance = pares("procedure_insurance", 1);
    const matriz = await fetchMatrizDeConvenios(cliente, CLINICA);
    expect(matriz).toEqual({
      atendimentos: [
        { professional_id: id("cadastro", 0), insurance_id: id("convenio", 0) },
      ],
      coberturas: [
        { procedure_id: id("cadastro", 0), insurance_id: id("convenio", 0) },
      ],
    });
  });

  it("exatamente 1000: pede a página seguinte, que vem vazia, e para", async () => {
    estado.tabelas.professional_insurance = pares(
      "professional_insurance",
      1000,
    );
    estado.tabelas.procedure_insurance = [];
    const matriz = await fetchMatrizDeConvenios(cliente, CLINICA);
    expect(matriz.atendimentos).toHaveLength(1000);
    expect(matriz.coberturas).toEqual([]);
    expect(estado.ranges.professional_insurance).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(estado.ranges.procedure_insurance).toEqual([[0, 999]]);
  });

  it("só a clínica pedida (quem é membro de duas clínicas lê as duas pela RLS)", async () => {
    estado.tabelas.professional_insurance = [
      ...pares("professional_insurance", 3),
      ...pares("professional_insurance", 5, OUTRA),
    ];
    estado.tabelas.procedure_insurance = pares("procedure_insurance", 4, OUTRA);
    const matriz = await fetchMatrizDeConvenios(cliente, CLINICA);
    expect(matriz.atendimentos).toHaveLength(3);
    expect(matriz.coberturas).toEqual([]);
  });

  it("erro na SEGUNDA página lança: a matriz cortada nunca é entregue", async () => {
    estado.tabelas.professional_insurance = pares(
      "professional_insurance",
      1500,
    );
    estado.tabelas.procedure_insurance = pares("procedure_insurance", 2);
    estado.erroNaPagina.professional_insurance = {
      pagina: 1,
      erro: { message: "falhou no meio" },
    };
    await expect(fetchMatrizDeConvenios(cliente, CLINICA)).rejects.toThrow(
      "falhou no meio",
    );
  });

  it("erro na primeira página de qualquer das duas lança (nunca matriz vazia)", async () => {
    estado.tabelas.professional_insurance = pares("professional_insurance", 2);
    estado.erroNaPagina.procedure_insurance = {
      pagina: 0,
      erro: { message: 'relation "procedure_insurance" does not exist' },
    };
    await expect(fetchMatrizDeConvenios(cliente, CLINICA)).rejects.toThrow();
  });
});

describe("fetchCatalogo: vínculos", () => {
  it("só os ativos, todas as páginas, por id", async () => {
    estado.tabelas.service_link = [
      ...vinculos(1001, true),
      ...vinculos(40, false),
      ...vinculos(7, true, OUTRA),
    ];
    const catalogo = await fetchCatalogo(cliente, CLINICA);
    expect(catalogo.vinculos).toHaveLength(1001);
    expect(catalogo.vinculos.every((v) => v.active)).toBe(true);
    expect(estado.ranges.service_link).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(estado.ordens.service_link).toEqual(["id", "id"]);
  });

  it("erro numa página dos vínculos derruba o catálogo inteiro", async () => {
    estado.tabelas.service_link = vinculos(1200);
    estado.erroNaPagina.service_link = {
      pagina: 1,
      erro: { message: "vinculos falharam" },
    };
    await expect(fetchCatalogo(cliente, CLINICA)).rejects.toThrow(
      "vinculos falharam",
    );
  });

  it("as outras tabelas do catálogo continuam sem paginação (e o erro delas lança como antes)", async () => {
    estado.tabelas.service_link = vinculos(2);
    estado.tabelas.insurance = [
      {
        id: "c1",
        clinic_id: CLINICA,
        name: "Unimed",
        plan_name: null,
        requires_card: false,
        notes: null,
        active: true,
      },
    ];
    const catalogo = await fetchCatalogo(cliente, CLINICA);
    expect(catalogo.convenios).toHaveLength(1);
    expect(catalogo.vinculos).toHaveLength(2);
    expect(estado.ranges.insurance).toBeUndefined();

    estado.erroNaPagina.insurance = { pagina: 0, erro: { message: "x" } };
    await expect(fetchCatalogo(cliente, CLINICA)).rejects.toThrow("x");
  });
});
