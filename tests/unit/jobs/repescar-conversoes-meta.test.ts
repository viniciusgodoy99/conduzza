import { describe, expect, it } from "vitest";

import { repescarConversoesDaMeta } from "@/lib/jobs/repescar-conversoes-meta";

import { bancoFalso, eUpdate, type ChamadaDeTabela } from "./banco-falso";

// Repescagem das conversoes para a Meta (ligar o envio e trocar o token).
// Revisao de 17/11/2026: o que 'falhou' por token errado ou instabilidade
// ficava perdido para sempre, mesmo dentro dos 7 dias que a Meta aceita.

const CLINICA = "clinica-1";

const argsDe = (chamada: ChamadaDeTabela, metodo: string) =>
  chamada.metodos.filter((m) => m.metodo === metodo).map((m) => m.args);

describe("repescarConversoesDaMeta", () => {
  it("falha recente volta para a fila (menos o payload recusado) e cada registro ganha o job antes de virar enfileirado", async () => {
    const falso = bancoFalso({
      tabelas: {
        conversion_event: (chamada) =>
          eUpdate(chamada)
            ? { data: null, error: null }
            : { data: [{ id: "evento-1" }, { id: "evento-2" }], error: null },
      },
    });

    expect(await repescarConversoesDaMeta(falso.admin, CLINICA)).toEqual({
      ok: true,
    });

    const [voltar] = falso.tabelas.filter(
      (c) =>
        c.tabela === "conversion_event" &&
        argsDe(c, "eq").some(([col, valor]) => col === "status" && valor === "falhou"),
    );
    expect(argsDe(voltar!, "update")).toEqual([[{ status: "registrado", erro: null }]]);
    expect(argsDe(voltar!, "eq")).toContainEqual(["clinic_id", CLINICA]);
    expect(argsDe(voltar!, "or")).toEqual([
      ["erro.is.null,erro.neq.payload_recusado"],
    ]);

    // Ordem: o job nasce antes de o evento virar 'enfileirado'.
    const ordem = falso.tabelas
      .map((c) =>
        c.tabela === "job_queue"
          ? "job"
          : argsDe(c, "update").some(
                ([patch]) => (patch as { status?: string }).status === "enfileirado",
              )
            ? "enfileirado"
            : null,
      )
      .filter(Boolean);
    expect(ordem).toEqual(["job", "enfileirado", "job", "enfileirado"]);
    const jobs = falso.tabelas.filter((c) => c.tabela === "job_queue");
    expect(argsDe(jobs[0]!, "insert")).toEqual([
      [
        {
          clinic_id: CLINICA,
          kind: "enviar_conversao_meta",
          payload: { conversion_event_id: "evento-1" },
        },
      ],
    ]);
  });

  it("job que não entra na fila: conta a falha e o evento continua registrado", async () => {
    const falso = bancoFalso({
      tabelas: {
        conversion_event: (chamada) =>
          eUpdate(chamada)
            ? { data: null, error: null }
            : { data: [{ id: "evento-1" }], error: null },
        job_queue: () => ({ data: null, error: { code: "XX000" } }),
      },
    });
    expect(await repescarConversoesDaMeta(falso.admin, CLINICA)).toEqual({
      ok: false,
      falhas: 1,
    });
    expect(falso.updatesEm("conversion_event")).not.toContainEqual({
      status: "enfileirado",
    });
  });

  it("leitura que falha: devolve erro sem número de falhas e não cria job", async () => {
    const falso = bancoFalso({
      tabelas: {
        conversion_event: () => ({ data: null, error: { code: "XX000" } }),
      },
    });
    expect(await repescarConversoesDaMeta(falso.admin, CLINICA)).toEqual({
      ok: false,
      falhas: null,
    });
    expect(falso.tabelas.some((c) => c.tabela === "job_queue")).toBe(false);
  });
});
