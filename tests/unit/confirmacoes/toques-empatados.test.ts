import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { fetchConfirmacoesDia } from "@/lib/queries/confirmacoes";

// Tela 2: o chip do toque de cada consulta vem da run mais recente da regua
// (toquesDasConsultas). A regua vinculada nasce com os mesmos offsets da
// geral, entao, quando a regua vigente da consulta muda, convivem no MESMO
// scheduled_for a run antiga pulada ('condicao_parada') e a da regua nova,
// enviada ou na fila. O empate e desfeito pela consulta: enviada, depois na
// fila, depois pulada.
//
// O banco falso aplica as ordens pedidas como o Postgres (crescente com nulo
// por ultimo, decrescente com nulo primeiro, salvo nullsFirst explicito) e
// mantem a ordem de insercao no empate, que e o que torna o empate
// imprevisivel no banco real: aqui a pulada e inserida primeiro de proposito.

type Linha = Record<string, unknown>;
type Ordem = { coluna: string; crescente: boolean; nuloPrimeiro: boolean };

class ConsultaFalsa {
  private readonly ordens: Ordem[] = [];

  constructor(private readonly linhas: Linha[]) {}

  select() {
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  in() {
    return this;
  }
  gte() {
    return this;
  }
  lt() {
    return this;
  }
  order(
    coluna: string,
    opcoes: { ascending?: boolean; nullsFirst?: boolean } = {},
  ) {
    const crescente = opcoes.ascending ?? true;
    this.ordens.push({
      coluna,
      crescente,
      nuloPrimeiro: opcoes.nullsFirst ?? !crescente,
    });
    return this;
  }

  private ordenadas(): Linha[] {
    return [...this.linhas].sort((a, b) => {
      for (const { coluna, crescente, nuloPrimeiro } of this.ordens) {
        const va = a[coluna] as string | null | undefined;
        const vb = b[coluna] as string | null | undefined;
        const aNulo = va === null || va === undefined;
        const bNulo = vb === null || vb === undefined;
        if (aNulo && bNulo) {
          continue;
        }
        if (aNulo || bNulo) {
          return aNulo === nuloPrimeiro ? -1 : 1;
        }
        const comparacao = String(va).localeCompare(String(vb));
        if (comparacao !== 0) {
          return crescente ? comparacao : -comparacao;
        }
      }
      return 0;
    });
  }

  then<T>(
    aoResolver: (resultado: { data: Linha[]; error: null }) => T,
    aoFalhar?: (erro: unknown) => T,
  ): Promise<T> {
    return Promise.resolve({ data: this.ordenadas(), error: null }).then(
      aoResolver,
      aoFalhar,
    );
  }
}

function bancoFalso(tabelas: Record<string, Linha[]>): SupabaseClient {
  return {
    from: (tabela: string) => new ConsultaFalsa(tabelas[tabela] ?? []),
  } as unknown as SupabaseClient;
}

const DE_CONFIRMACAO = { cadence: { kind: "confirmacao" } };
const AS_14H = "2026-10-02T17:00:00+00:00";
const AS_9H = "2026-10-02T12:00:00+00:00";

function consulta(id: string): Linha {
  return {
    id,
    contact_id: `contato-${id}`,
    professional_id: "prof",
    starts_at: "2026-10-02T19:00:00+00:00",
    ends_at: "2026-10-02T19:40:00+00:00",
    status: "agendado",
  };
}

function run(appointmentId: string, campos: Linha): Linha {
  return {
    appointment_id: appointmentId,
    scheduled_for: AS_14H,
    sent_at: null,
    skipped_reason: null,
    cadence_step: DE_CONFIRMACAO,
    ...campos,
  };
}

async function toques(cadenceRuns: Linha[], ids: string[]) {
  const linhas = await fetchConfirmacoesDia(
    bancoFalso({
      appointment: ids.map(consulta),
      contact_consent: [],
      conversation: [],
      cadence_run: cadenceRuns,
    }),
    "clinica",
    "2026-10-02",
    "America/Fortaleza",
  );
  return Object.fromEntries(linhas.map((linha) => [linha.id, linha.toque]));
}

describe("toque da consulta com runs no mesmo horário", () => {
  it("pulada pela régua antiga e enviada pela nova: mostra enviada", async () => {
    const resultado = await toques(
      [
        run("a1", { skipped_reason: "condicao_parada" }),
        run("a1", { sent_at: "2026-10-02T17:00:05+00:00" }),
      ],
      ["a1"],
    );
    expect(resultado.a1).toEqual({
      situacao: "enviado",
      em: "2026-10-02T17:00:05+00:00",
    });
  });

  it("pulada pela régua antiga e na fila pela nova: mostra na fila", async () => {
    const resultado = await toques(
      [run("a2", { skipped_reason: "condicao_parada" }), run("a2", {})],
      ["a2"],
    );
    expect(resultado.a2).toEqual({ situacao: "na_fila", para: AS_14H });
  });

  it("enviada e na fila no mesmo horário: mostra enviada", async () => {
    const resultado = await toques(
      [run("a3", {}), run("a3", { sent_at: "2026-10-02T17:00:05+00:00" })],
      ["a3"],
    );
    expect(resultado.a3?.situacao).toBe("enviado");
  });

  it("fora do empate, o toque mais recente continua mandando", async () => {
    const resultado = await toques(
      [
        run("a4", { scheduled_for: AS_9H, sent_at: AS_9H }),
        run("a4", { skipped_reason: "sem_autorizacao" }),
      ],
      ["a4"],
    );
    expect(resultado.a4).toEqual({
      situacao: "pulado",
      motivo: "sem_autorizacao",
    });
  });
});
