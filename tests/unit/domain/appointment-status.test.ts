import { describe, expect, it } from "vitest";

import {
  type ConsultaDoAviso,
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  STATUS_TERMINAIS,
  avisoDeRemarcacaoVale,
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

  it("confirmação volta para agendado em qualquer dia", () => {
    for (const mesmoDia of [true, false]) {
      expect(statusAposRemarcar("confirmado_paciente", { mesmoDia })).toBe(
        "agendado",
      );
      expect(statusAposRemarcar("confirmado_recepcao", { mesmoDia })).toBe(
        "agendado",
      );
    }
  });

  it("paciente já na clínica mantém a situação no mesmo dia", () => {
    expect(statusAposRemarcar("na_recepcao", { mesmoDia: true })).toBe(
      "na_recepcao",
    );
    expect(statusAposRemarcar("em_atendimento", { mesmoDia: true })).toBe(
      "em_atendimento",
    );
    // Sem o dia informado vale o mesmo dia (a nota do diálogo).
    expect(statusAposRemarcar("na_recepcao")).toBe("na_recepcao");
  });

  it("paciente já na clínica movido para outro dia volta para agendado", () => {
    expect(statusAposRemarcar("na_recepcao", { mesmoDia: false })).toBe(
      "agendado",
    );
    expect(statusAposRemarcar("em_atendimento", { mesmoDia: false })).toBe(
      "agendado",
    );
  });
});

describe("aviso de remarcação na hora do envio", () => {
  const agora = new Date("2026-09-24T12:00:00.000Z");
  const consulta: ConsultaDoAviso = {
    status: "agendado",
    // O banco devolve com +00:00; o payload leva toISOString (Z).
    starts_at: "2026-09-26T13:00:00+00:00",
    professional_id: "prof-a",
  };
  const esperado = {
    startsAt: "2026-09-26T13:00:00.000Z",
    professionalId: "prof-a",
  };

  it("sai quando a consulta continua no horário e com o profissional anunciados", () => {
    expect(avisoDeRemarcacaoVale(consulta, esperado, agora)).toBe(true);
    expect(
      avisoDeRemarcacaoVale(
        { ...consulta, status: "na_recepcao" },
        esperado,
        agora,
      ),
    ).toBe(true);
  });

  it("não sai se a consulta sumiu", () => {
    expect(avisoDeRemarcacaoVale(null, esperado, agora)).toBe(false);
  });

  it("não sai se a consulta foi cancelada, encerrada ou está em atendimento", () => {
    const mortas: AppointmentStatus[] = [
      "cancelado_paciente",
      "cancelado_clinica",
      "faltou",
      "compareceu",
      "em_atendimento",
    ];
    for (const status of mortas) {
      expect(
        avisoDeRemarcacaoVale({ ...consulta, status }, esperado, agora),
      ).toBe(false);
    }
  });

  it("não sai se a consulta foi remarcada de novo para outro horário", () => {
    expect(
      avisoDeRemarcacaoVale(
        { ...consulta, starts_at: "2026-09-26T14:00:00+00:00" },
        esperado,
        agora,
      ),
    ).toBe(false);
  });

  it("não sai se a consulta mudou de profissional", () => {
    expect(
      avisoDeRemarcacaoVale(
        { ...consulta, professional_id: "prof-b" },
        esperado,
        agora,
      ),
    ).toBe(false);
  });

  it("não sai se o horário anunciado já passou (retry longo)", () => {
    expect(
      avisoDeRemarcacaoVale(
        consulta,
        esperado,
        new Date("2026-09-26T13:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("payload com horário ilegível não sai", () => {
    expect(
      avisoDeRemarcacaoVale(
        consulta,
        { ...esperado, startsAt: "ontem" },
        agora,
      ),
    ).toBe(false);
  });

  it("aviso antigo sem o horário esperado confere só a situação e o vencimento", () => {
    const semEsperado = { startsAt: null, professionalId: null };
    expect(avisoDeRemarcacaoVale(consulta, semEsperado, agora)).toBe(true);
    expect(
      avisoDeRemarcacaoVale(
        { ...consulta, status: "cancelado_clinica" },
        semEsperado,
        agora,
      ),
    ).toBe(false);
  });
});
