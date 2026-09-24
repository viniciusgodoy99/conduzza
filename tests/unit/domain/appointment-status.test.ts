import { describe, expect, it } from "vitest";

import {
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  STATUS_TERMINAIS,
  eCancelamento,
  faltaLiberada,
  podeRemarcar,
  podeTransicionar,
  statusAposRemarcar,
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

  // Decisao do dono (24/09/2026): clinica sem check-in fecha o dia marcando
  // quem veio, sem passar por Na recepcao e Em atendimento.
  it("compareceu direto de agendado, aguardando, confirmados e na recepção", () => {
    const origens: AppointmentStatus[] = [
      "agendado",
      "aguardando_confirmacao",
      "confirmado_paciente",
      "confirmado_recepcao",
      "na_recepcao",
      "em_atendimento",
    ];
    for (const de of origens) {
      expect(podeTransicionar(de, "compareceu")).toBe(true);
    }
    // Situacao final nao vira compareceu.
    for (const terminal of STATUS_TERMINAIS) {
      expect(podeTransicionar(terminal, "compareceu")).toBe(false);
    }
  });

  it("na recepção e em atendimento continuam como etapas opcionais", () => {
    expect(podeTransicionar("confirmado_paciente", "na_recepcao")).toBe(true);
    expect(podeTransicionar("confirmado_recepcao", "na_recepcao")).toBe(true);
    expect(podeTransicionar("na_recepcao", "em_atendimento")).toBe(true);
  });

  it("os dois cancelamentos são reconhecidos para o diálogo de confirmação", () => {
    expect(eCancelamento("cancelado_paciente")).toBe(true);
    expect(eCancelamento("cancelado_clinica")).toBe(true);
    expect(eCancelamento("faltou")).toBe(false);
    expect(eCancelamento("compareceu")).toBe(false);
  });
});

describe("falta só a partir do horário da consulta", () => {
  const inicio = "2026-09-24T13:00:00.000Z";

  it("antes do horário não libera", () => {
    expect(faltaLiberada(inicio, new Date("2026-09-24T12:59:59.000Z"))).toBe(
      false,
    );
    expect(faltaLiberada(inicio, new Date("2026-09-24T09:00:00.000Z"))).toBe(
      false,
    );
  });

  it("no horário exato e depois libera", () => {
    expect(faltaLiberada(inicio, new Date("2026-09-24T13:00:00.000Z"))).toBe(
      true,
    );
    expect(faltaLiberada(inicio, new Date("2026-09-25T08:00:00.000Z"))).toBe(
      true,
    );
  });

  it("compara instantes, não o relógio local (offset explícito)", () => {
    // 10:00 em Fortaleza e 13:00 UTC: o mesmo instante.
    expect(
      faltaLiberada(
        "2026-09-24T10:00:00-03:00",
        new Date("2026-09-24T13:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("a dica aponta o caminho certo sem travessão", () => {
    expect(DICA_FALTA_ANTES_DO_HORARIO).toContain("Cancelado pelo paciente");
    expect(DICA_FALTA_ANTES_DO_HORARIO).not.toMatch(/[–—]/);
  });
});

describe("remarcação", () => {
  it("situação final não se remarca", () => {
    for (const terminal of STATUS_TERMINAIS) {
      expect(podeRemarcar(terminal)).toBe(false);
    }
    expect(DICA_REMARCAR_ENCERRADA).not.toMatch(/[–—]/);
  });

  it("as demais situações se remarcam", () => {
    const vivas: AppointmentStatus[] = [
      "agendado",
      "aguardando_confirmacao",
      "confirmado_paciente",
      "confirmado_recepcao",
      "na_recepcao",
      "em_atendimento",
    ];
    for (const status of vivas) {
      expect(podeRemarcar(status)).toBe(true);
    }
  });

  it("confirmação e espera de confirmação voltam para agendado", () => {
    expect(statusAposRemarcar("confirmado_paciente")).toBe("agendado");
    expect(statusAposRemarcar("confirmado_recepcao")).toBe("agendado");
    expect(statusAposRemarcar("aguardando_confirmacao")).toBe("agendado");
    expect(statusAposRemarcar("agendado")).toBe("agendado");
  });

  it("paciente já na clínica mantém a situação", () => {
    expect(statusAposRemarcar("na_recepcao")).toBe("na_recepcao");
    expect(statusAposRemarcar("em_atendimento")).toBe("em_atendimento");
  });
});
