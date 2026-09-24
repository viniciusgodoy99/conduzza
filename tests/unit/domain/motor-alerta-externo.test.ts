import { describe, expect, it } from "vitest";

import { TOLERANCIA_DE_BATIDA_MS, alertasDoMotor } from "@/lib/domain/motor";

// A regra do monitor externo (rota /api/webhooks/saude). Ela alerta o dono do
// produto, que conserta; por isso pega tambem o que a faixa da tela nao pega:
// a corrente viva com o trabalho parado.

const agora = new Date("2026-09-24T12:00:00Z");
const atras = (ms: number) => new Date(agora.getTime() - ms).toISOString();
const batida = (ms: number, ultimo_erro: string | null = null) => ({
  batida_em: atras(ms),
  ultimo_erro,
});

describe("alertasDoMotor", () => {
  it("tudo em dia: nenhum alerta", () => {
    expect(
      alertasDoMotor(
        { fila: batida(10_000), planner: batida(40_000), atrasados: 0 },
        agora,
      ),
    ).toEqual([]);
  });

  it("fila parada com o planner vivo alerta pela fila", () => {
    expect(
      alertasDoMotor(
        {
          fila: batida(TOLERANCIA_DE_BATIDA_MS + 1),
          planner: batida(10_000),
          atrasados: 0,
        },
        agora,
      ),
    ).toEqual(["fila_parada"]);
  });

  it("planner parado com a fila viva alerta pelo planner", () => {
    expect(
      alertasDoMotor(
        {
          fila: batida(10_000),
          planner: batida(TOLERANCIA_DE_BATIDA_MS + 1),
          atrasados: 0,
        },
        agora,
      ),
    ).toEqual(["planner_parado"]);
  });

  it("corrente viva e fila acumulando: alerta, mesmo sem a faixa na tela", () => {
    expect(
      alertasDoMotor(
        { fila: batida(10_000), planner: batida(10_000), atrasados: 3 },
        agora,
      ),
    ).toEqual(["fila_atrasada"]);
  });

  it("planner batendo mas errando: alerta", () => {
    expect(
      alertasDoMotor(
        {
          fila: batida(10_000),
          planner: batida(10_000, "planejar_reguas:42P01"),
          atrasados: 0,
        },
        agora,
      ),
    ).toEqual(["planner_com_erro"]);
  });

  it("erro antigo da fila nao alerta: so o do planner conta", () => {
    // bater_ponto_do_worker nao escreve ultimo_erro, entao o que houver na
    // linha da fila e resto de outra epoca.
    expect(
      alertasDoMotor(
        {
          fila: batida(10_000, "resto_antigo"),
          planner: batida(10_000),
          atrasados: 0,
        },
        agora,
      ),
    ).toEqual([]);
  });

  it("sem leitura nenhuma conta como tudo parado", () => {
    expect(alertasDoMotor(null, agora)).toEqual([
      "fila_parada",
      "planner_parado",
    ]);
    expect(alertasDoMotor({ fila: null, planner: null }, agora)).toEqual([
      "fila_parada",
      "planner_parado",
    ]);
  });

  it("acumula todos os motivos, na ordem fixa", () => {
    expect(
      alertasDoMotor(
        {
          fila: batida(60 * 60_000),
          planner: batida(60 * 60_000, "higiene:57014"),
          atrasados: 12,
        },
        agora,
      ),
    ).toEqual([
      "fila_parada",
      "planner_parado",
      "fila_atrasada",
      "planner_com_erro",
    ]);
  });
});
