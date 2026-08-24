import { describe, expect, it } from "vitest";

import {
  STATUS_TERMINAIS,
  podeTransicionar,
  transicoesPermitidas,
} from "@/lib/domain/appointment-status";
import type { AppointmentStatus } from "@/lib/design/status";

// Tarefa 2.7: o ciclo de status e um mapa fechado. Falta so por acao
// explicita e nunca de estado em que o paciente ja foi atendido ou cancelou.

describe("ciclo de status da consulta", () => {
  it("faltou só sai de estados em que o paciente era esperado", () => {
    const podeFaltar: AppointmentStatus[] = [
      "agendado",
      "aguardando_confirmacao",
      "confirmado_paciente",
      "confirmado_recepcao",
      "na_recepcao",
    ];
    for (const de of podeFaltar) {
      expect(podeTransicionar(de, "faltou")).toBe(true);
    }
    expect(podeTransicionar("em_atendimento", "faltou")).toBe(false);
    expect(podeTransicionar("compareceu", "faltou")).toBe(false);
    expect(podeTransicionar("cancelado_paciente", "faltou")).toBe(false);
  });

  it("estados terminais não têm saída", () => {
    for (const terminal of STATUS_TERMINAIS) {
      expect(transicoesPermitidas(terminal)).toHaveLength(0);
    }
  });

  it("em atendimento só termina em compareceu", () => {
    expect(transicoesPermitidas("em_atendimento")).toEqual(["compareceu"]);
  });

  it("confirmação do paciente só nasce de aguardando confirmação", () => {
    const origens = (
      [
        "agendado",
        "aguardando_confirmacao",
        "confirmado_recepcao",
        "na_recepcao",
      ] as AppointmentStatus[]
    ).filter((de) => podeTransicionar(de, "confirmado_paciente"));
    expect(origens).toEqual(["aguardando_confirmacao"]);
  });

  it("cancelado não volta", () => {
    expect(podeTransicionar("cancelado_paciente", "agendado")).toBe(false);
    expect(podeTransicionar("cancelado_clinica", "agendado")).toBe(false);
  });
});
