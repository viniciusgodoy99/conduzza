import { describe, expect, it } from "vitest";

import {
  indicadoresDaLista,
  type PacienteContavel,
} from "@/lib/domain/pacientes-ui";

// Indicadores do topo da lista de Pacientes (decisao C28 do dono): so o que a
// lista ja sabe contar, com a mesma regra dos filtros e das etiquetas. O "novo
// no mes" compara o DIA CIVIL da clinica (regra 3.6), nunca o dia UTC.

const DIA_MS = 24 * 60 * 60 * 1000;
const FORTALEZA = "America/Fortaleza";
// 15/09/2026, meio-dia em Fortaleza (UTC-3).
const agora = new Date("2026-09-15T15:00:00Z");

function haDias(dias: number): string {
  return new Date(agora.getTime() - dias * DIA_MS).toISOString();
}

function paciente(parcial: Partial<PacienteContavel>): PacienteContavel {
  return {
    total_faltou: 0,
    ultima_consulta: haDias(10),
    proxima_consulta: null,
    saldo_sessoes: 0,
    insurance_id: null,
    profissionais_ids: [],
    primeira_consulta: haDias(200),
    ...parcial,
  };
}

describe("indicadoresDaLista", () => {
  it("lista vazia zera tudo", () => {
    expect(indicadoresDaLista([], agora, FORTALEZA)).toEqual({
      total: 0,
      novosNoMes: 0,
      comPacoteAtivo: 0,
      inativos: 0,
    });
  });

  it("total conta todo mundo da lista", () => {
    const lista = [paciente({}), paciente({}), paciente({})];
    expect(indicadoresDaLista(lista, agora, FORTALEZA).total).toBe(3);
  });

  it("novo no mes: primeira consulta no mes corrente, passada ou futura", () => {
    const lista = [
      paciente({ primeira_consulta: "2026-09-02T13:00:00Z" }),
      paciente({ primeira_consulta: "2026-09-28T13:00:00Z" }),
      paciente({ primeira_consulta: "2026-08-20T13:00:00Z" }),
      paciente({ primeira_consulta: null }),
    ];
    expect(indicadoresDaLista(lista, agora, FORTALEZA).novosNoMes).toBe(2);
  });

  it("o mes e o do fuso da clinica: 01/09 as 01h UTC ainda e agosto em Fortaleza", () => {
    const lista = [
      // 31/08 as 22h em Fortaleza.
      paciente({ primeira_consulta: "2026-09-01T01:00:00Z" }),
      // 01/09 as 00h em Fortaleza.
      paciente({ primeira_consulta: "2026-09-01T03:00:00Z" }),
    ];
    expect(indicadoresDaLista(lista, agora, FORTALEZA).novosNoMes).toBe(1);
  });

  it("com pacote ativo e o mesmo criterio do filtro Com pacote", () => {
    const lista = [
      paciente({ saldo_sessoes: 3 }),
      paciente({ saldo_sessoes: 0 }),
      paciente({ saldo_sessoes: 1 }),
    ];
    expect(indicadoresDaLista(lista, agora, FORTALEZA).comPacoteAtivo).toBe(2);
  });

  it("inativos e o mesmo criterio da etiqueta Inativo", () => {
    const lista = [
      // Ultima ha 120 dias e nada marcado: inativo.
      paciente({ ultima_consulta: haDias(120) }),
      // Ultima ha 120 dias, mas com consulta futura: nao e inativo.
      paciente({
        ultima_consulta: haDias(120),
        proxima_consulta: new Date(agora.getTime() + DIA_MS).toISOString(),
      }),
      // Exatos 90 dias nao contam.
      paciente({ ultima_consulta: haDias(90) }),
      // Sem consulta nenhuma nunca foi ativo.
      paciente({ ultima_consulta: null }),
    ];
    expect(indicadoresDaLista(lista, agora, FORTALEZA).inativos).toBe(1);
  });
});
