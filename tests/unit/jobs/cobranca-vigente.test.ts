import { describe, expect, it } from "vitest";

import {
  planejarCobrancaManual,
  reguaDoToqueManual,
} from "@/lib/jobs/cobranca-manual";
import { bancoFalso, type ChamadaDeTabela, type Resposta } from "./banco-falso";

// "Cobrar agora" da Tela 2 com regua vinculada (decisao do dono em
// 29/09/2026): o texto do toque manual sai da regua VIGENTE de cada consulta
// (regua_da_consulta, a mesma escolha do planner e do executor), e nao mais
// sempre da geral. Sem regua vigente (tudo desligado), a geral, como antes.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const GERAL = "9e000000-0000-4000-8000-000000000001";
const DA_HELENA = "9e000000-0000-4000-8000-000000000002";
const NUMERO = "9e000000-0000-4000-8000-000000000003";
const C_HELENA = "c0000000-0000-4000-8000-000000000001";
const C_JOAO = "c0000000-0000-4000-8000-000000000002";
const P_HELENA = "b0000000-0000-4000-8000-000000000001";
const P_JOAO = "b0000000-0000-4000-8000-000000000002";

// 09:00 em Fortaleza; a consulta e amanha cedo, entao o passo do dia e o
// de 24 horas antes (-1440) nas duas reguas.
const AGORA = new Date("2026-09-29T12:00:00Z");
const AMANHA = new Date(AGORA.getTime() + 20 * 60 * 60_000).toISOString();

const PASSOS = [
  { id: "passo-geral-4320", cadence_id: GERAL, offset_minutes: -4320 },
  { id: "passo-geral-1440", cadence_id: GERAL, offset_minutes: -1440 },
  { id: "passo-geral-180", cadence_id: GERAL, offset_minutes: -180 },
  { id: "passo-helena-1440", cadence_id: DA_HELENA, offset_minutes: -1440 },
  { id: "passo-helena-180", cadence_id: DA_HELENA, offset_minutes: -180 },
];

function argumentosDe(chamada: ChamadaDeTabela, metodo: string): unknown[][] {
  return chamada.metodos.filter((m) => m.metodo === metodo).map((m) => m.args);
}

function cenario(opcoes: {
  vigentes: Record<string, Resposta>;
  geral?: string | null;
}) {
  return bancoFalso({
    tabelas: {
      whatsapp_account: () => ({
        data: [{ connection_status: "conectado" }],
        error: null,
      }),
      appointment: () => ({
        data: [
          { id: C_HELENA, contact_id: P_HELENA, starts_at: AMANHA },
          { id: C_JOAO, contact_id: P_JOAO, starts_at: AMANHA },
        ],
        error: null,
      }),
      cadence: () => ({
        data: opcoes.geral === null ? null : { id: opcoes.geral ?? GERAL },
        error: null,
      }),
      cadence_step: (chamada) => {
        const [, ids] = (argumentosDe(chamada, "in")[0] ?? []) as [
          string,
          string[],
        ];
        return {
          data: PASSOS.filter((passo) =>
            (ids ?? []).includes(passo.cadence_id),
          ),
          error: null,
        };
      },
      contact_consent: () => ({
        data: [P_HELENA, P_JOAO].map((contactId) => ({
          contact_id: contactId,
          channel: "whatsapp",
          granted_at: "2026-01-01T00:00:00Z",
          revoked_at: null,
        })),
        error: null,
      }),
      cadence_run: (chamada) => {
        const upsert = argumentosDe(chamada, "upsert")[0];
        if (upsert) {
          const linhas = upsert[0] as Record<string, unknown>[];
          return {
            data: linhas.map((linha, indice) => ({
              id: `run-${indice}`,
              ...linha,
            })),
            error: null,
          };
        }
        return { data: [], error: null };
      },
    },
    rpcs: {
      regua_da_consulta: (args) =>
        opcoes.vigentes[args.p_appointment_id as string] ?? {
          data: null,
          error: null,
        },
      contas_de_envio: () => ({
        data: [P_HELENA, P_JOAO].map((contactId) => ({
          contact_id: contactId,
          whatsapp_account_id: NUMERO,
          nome: "Principal",
          connection_status: "conectado",
        })),
        error: null,
      }),
    },
  });
}

function cobrar(b: ReturnType<typeof bancoFalso>) {
  return planejarCobrancaManual(b.admin, b.admin, {
    clinicId: CLINICA,
    timezone: "America/Fortaleza",
    appointmentIds: [C_HELENA, C_JOAO],
    agora: AGORA,
  });
}

/** O passo gravado em cada run, por consulta. */
function passosGravados(b: ReturnType<typeof bancoFalso>) {
  const upsert = b.tabelas
    .filter((c) => c.tabela === "cadence_run")
    .flatMap((c) => argumentosDe(c, "upsert"))[0];
  const linhas = (upsert?.[0] ?? []) as {
    appointment_id: string;
    cadence_step_id: string;
  }[];
  return Object.fromEntries(
    linhas.map((linha) => [linha.appointment_id, linha.cadence_step_id]),
  );
}

describe("reguaDoToqueManual", () => {
  it("a vigente vence; sem vigente, a geral; sem as duas, nada", () => {
    expect(reguaDoToqueManual(DA_HELENA, GERAL)).toBe(DA_HELENA);
    expect(reguaDoToqueManual(null, GERAL)).toBe(GERAL);
    expect(reguaDoToqueManual(undefined, GERAL)).toBe(GERAL);
    expect(reguaDoToqueManual("", GERAL)).toBe(GERAL);
    expect(reguaDoToqueManual(null, null)).toBeNull();
  });
});

describe("Cobrar agora com régua vinculada", () => {
  it("cada consulta cobra com o passo da régua vigente dela", async () => {
    const b = cenario({
      vigentes: {
        [C_HELENA]: { data: DA_HELENA, error: null },
        [C_JOAO]: { data: GERAL, error: null },
      },
    });

    const resultado = await cobrar(b);

    expect(resultado).toMatchObject({ ok: true, enfileirados: 2 });
    expect(b.chamadasDe("regua_da_consulta")).toEqual([
      { p_appointment_id: C_HELENA, p_kind: "confirmacao" },
      { p_appointment_id: C_JOAO, p_kind: "confirmacao" },
    ]);
    expect(passosGravados(b)).toEqual({
      [C_HELENA]: "passo-helena-1440",
      [C_JOAO]: "passo-geral-1440",
    });
  });

  // Numero por tipo (decisao do dono de 29/09/2026): o Cobrar agora e toque
  // da regua de confirmacao, entao o numero de cada paciente sai da escolha
  // do tipo 'confirmacao'.
  it("o número de cada paciente sai da escolha do tipo confirmação", async () => {
    const b = cenario({ vigentes: {} });

    await cobrar(b);

    expect(b.chamadasDe("contas_de_envio")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_contact_ids: [P_HELENA, P_JOAO],
        p_tipo: "confirmacao",
      },
    ]);
  });

  it("sem régua vigente (tudo desligado), cobra com a geral, como antes", async () => {
    const b = cenario({ vigentes: {} });

    const resultado = await cobrar(b);

    expect(resultado).toMatchObject({ ok: true, enfileirados: 2 });
    expect(passosGravados(b)).toEqual({
      [C_HELENA]: "passo-geral-1440",
      [C_JOAO]: "passo-geral-1440",
    });
  });

  it("erro ao ler a régua vigente recusa tudo, sem enfileirar", async () => {
    const b = cenario({
      vigentes: {
        [C_JOAO]: { data: null, error: { code: "PGRST202", message: "x" } },
      },
    });

    const resultado = await cobrar(b);

    expect(resultado).toMatchObject({
      ok: false,
      error: "Não foi possível enfileirar as cobranças.",
      enfileirados: 0,
    });
    expect(passosGravados(b)).toEqual({});
    expect(b.tabelas.some((c) => c.tabela === "job_queue")).toBe(false);
  });

  it("sem vigente e sem geral, diz que a régua não está configurada", async () => {
    const b = cenario({ vigentes: {}, geral: null });

    expect(await cobrar(b)).toMatchObject({
      ok: false,
      error: "A régua de confirmação não está configurada.",
    });
  });
});
