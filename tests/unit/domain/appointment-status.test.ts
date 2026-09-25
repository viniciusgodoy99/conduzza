import { describe, expect, it } from "vitest";

import {
  type ConsultaDoAviso,
  DICA_COMPARECEU_ANTES_DO_DIA,
  DICA_FALTA_ANTES_DO_HORARIO,
  DICA_REMARCAR_ENCERRADA,
  MENSAGEM_PROFISSIONAL_INATIVO,
  STATUS_TERMINAIS,
  type SaldoParaComparecimento,
  avisoDeRemarcacaoVale,
  comparecimentoLiberado,
  eCancelamento,
  faltaLiberada,
  podeRemarcar,
  podeTransicionar,
  saldoDescontadoAoComparecer,
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

// Achado L11 da revisao da leva 2: Compareceu e situacao final e desconta
// sessao de pacote. Consulta de amanha nao pode ser marcada por engano.
describe("compareceu só a partir do dia da consulta", () => {
  const FUSO = "America/Fortaleza";
  // 10:00 de 25/09 em Fortaleza.
  const inicio = "2026-09-25T13:00:00.000Z";

  it("em dia anterior ao da consulta não libera", () => {
    // 24/09 às 18:00 em Fortaleza.
    expect(
      comparecimentoLiberado(FUSO, inicio, new Date("2026-09-24T21:00:00Z")),
    ).toBe(false);
  });

  it("no dia da consulta libera, mesmo antes do horário (chegou adiantado)", () => {
    // 25/09 às 07:00 em Fortaleza.
    expect(
      comparecimentoLiberado(FUSO, inicio, new Date("2026-09-25T10:00:00Z")),
    ).toBe(true);
  });

  it("depois do dia da consulta libera (fechar o dia atrasado)", () => {
    expect(
      comparecimentoLiberado(FUSO, inicio, new Date("2026-09-27T12:00:00Z")),
    ).toBe(true);
  });

  it("o dia é o civil da clínica, não o do UTC", () => {
    // 24/09 às 22:30 em Fortaleza ja e 25/09 em UTC: ainda e vespera.
    expect(
      comparecimentoLiberado(FUSO, inicio, new Date("2026-09-25T01:30:00Z")),
    ).toBe(false);
    // Consulta as 23:00 de 25/09 em Fortaleza (26/09 em UTC), marcada as
    // 21:00 de 25/09: mesmo dia na clinica.
    expect(
      comparecimentoLiberado(
        FUSO,
        "2026-09-26T02:00:00.000Z",
        new Date("2026-09-26T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("a dica é a combinada, sem travessão", () => {
    expect(DICA_COMPARECEU_ANTES_DO_DIA).toBe(
      "Compareceu só pode ser marcado no dia da consulta.",
    );
    expect(DICA_COMPARECEU_ANTES_DO_DIA).not.toMatch(/[–—]/);
  });
});

describe("saldo de pacote que o Compareceu desconta", () => {
  const PROCEDIMENTO = "proc-limpeza";
  const HOJE = "2026-09-25";

  function saldo(
    parcial: Partial<SaldoParaComparecimento> & { id: string },
  ): SaldoParaComparecimento {
    return {
      procedure_id: PROCEDIMENTO,
      procedure_name: "Limpeza de pele",
      sessions_total: 10,
      sessions_used: 3,
      expires_at: null,
      created_at: "2026-01-01T12:00:00Z",
      ...parcial,
    };
  }

  it("sem pacote do procedimento, nada é descontado", () => {
    expect(saldoDescontadoAoComparecer([], PROCEDIMENTO, HOJE)).toBeNull();
    expect(
      saldoDescontadoAoComparecer(
        [saldo({ id: "a", procedure_id: "outro" })],
        PROCEDIMENTO,
        HOJE,
      ),
    ).toBeNull();
  });

  it("pacote esgotado ou vencido não é descontado", () => {
    expect(
      saldoDescontadoAoComparecer(
        [
          saldo({ id: "esgotado", sessions_used: 10 }),
          saldo({ id: "vencido", expires_at: "2026-09-24" }),
        ],
        PROCEDIMENTO,
        HOJE,
      ),
    ).toBeNull();
  });

  it("vence hoje ainda vale", () => {
    expect(
      saldoDescontadoAoComparecer(
        [saldo({ id: "hoje", expires_at: HOJE })],
        PROCEDIMENTO,
        HOJE,
      )?.id,
    ).toBe("hoje");
  });

  it("o que vence primeiro é descontado antes, sem validade por último", () => {
    expect(
      saldoDescontadoAoComparecer(
        [
          saldo({ id: "sem-validade", created_at: "2025-01-01T12:00:00Z" }),
          saldo({ id: "dezembro", expires_at: "2026-12-01" }),
          saldo({ id: "outubro", expires_at: "2026-10-01" }),
        ],
        PROCEDIMENTO,
        HOJE,
      )?.id,
    ).toBe("outubro");
  });

  it("no empate de validade, o mais antigo primeiro (espelha o gatilho)", () => {
    expect(
      saldoDescontadoAoComparecer(
        [
          saldo({ id: "novo", created_at: "2026-05-01T12:00:00Z" }),
          saldo({ id: "antigo", created_at: "2026-02-01T12:00:00Z" }),
        ],
        PROCEDIMENTO,
        HOJE,
      )?.id,
    ).toBe("antigo");
  });
});

describe("remarcar com profissional inativo", () => {
  it("a mensagem pede outro profissional, sem travessão", () => {
    expect(MENSAGEM_PROFISSIONAL_INATIVO).toContain("inativo");
    expect(MENSAGEM_PROFISSIONAL_INATIVO).not.toMatch(/[–—]/);
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
