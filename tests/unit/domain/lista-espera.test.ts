import { describe, expect, it } from "vitest";

import {
  casaComSlot,
  diaDaSemanaNoFuso,
  interpretarRespostaDeOferta,
  montarOnda,
  turnoDoInstante,
  type EntradaDaFila,
} from "@/lib/domain/lista-espera";

// Aceite da logica pura da 4.9: o casamento vaga x preferencias e no FUSO DA
// CLINICA (regra 3.6), sem preferencia casa tudo, a onda respeita prioridade
// e antiguidade, e o vocabulario da oferta aceita o que a mensagem instrui.

const FORTALEZA = "America/Fortaleza";

function entrada(parcial: Partial<EntradaDaFila>): EntradaDaFila {
  return {
    id: crypto.randomUUID(),
    contactId: crypto.randomUUID(),
    procedureId: null,
    professionalId: null,
    preferredShifts: [],
    preferredWeekdays: [],
    priority: 0,
    createdAt: "2026-09-01T12:00:00Z",
    ...parcial,
  };
}

describe("turno e dia no fuso da clínica", () => {
  it("21h UTC é tarde em Fortaleza (18h local)", () => {
    // 2026-09-15T21:00Z = 18:00 em Fortaleza (UTC-3): noite comeca as 18.
    expect(turnoDoInstante(new Date("2026-09-15T21:00:00Z"), FORTALEZA)).toBe(
      "noite",
    );
    expect(turnoDoInstante(new Date("2026-09-15T20:59:00Z"), FORTALEZA)).toBe(
      "tarde",
    );
    expect(turnoDoInstante(new Date("2026-09-15T13:00:00Z"), FORTALEZA)).toBe(
      "manha",
    );
  });

  it("virada de dia: 02h UTC de terça ainda é segunda em Fortaleza", () => {
    // 2026-09-15 e terca; 02:00Z = 23:00 de segunda (dia 14) no fuso.
    expect(diaDaSemanaNoFuso(new Date("2026-09-15T02:00:00Z"), FORTALEZA)).toBe(
      1,
    );
  });
});

describe("casaComSlot", () => {
  const slot = {
    professionalId: "prof-1",
    weekday: 2,
    turno: "manha" as const,
  };
  const atende = new Set(["proc-1"]);

  it("sem preferência nenhuma casa com qualquer vaga", () => {
    expect(casaComSlot(entrada({}), slot, atende)).toBe(true);
  });

  it("profissional pedido precisa bater; procedimento precisa ser atendido", () => {
    expect(
      casaComSlot(entrada({ professionalId: "prof-2" }), slot, atende),
    ).toBe(false);
    expect(casaComSlot(entrada({ procedureId: "proc-2" }), slot, atende)).toBe(
      false,
    );
    expect(
      casaComSlot(
        entrada({ professionalId: "prof-1", procedureId: "proc-1" }),
        slot,
        atende,
      ),
    ).toBe(true);
  });

  it("turno e dia declarados precisam conter a vaga", () => {
    expect(
      casaComSlot(entrada({ preferredShifts: ["tarde"] }), slot, atende),
    ).toBe(false);
    expect(
      casaComSlot(entrada({ preferredWeekdays: [0, 6] }), slot, atende),
    ).toBe(false);
    expect(
      casaComSlot(
        entrada({ preferredShifts: ["manha"], preferredWeekdays: [2] }),
        slot,
        atende,
      ),
    ).toBe(true);
  });
});

describe("montarOnda", () => {
  const slot = {
    professionalId: "prof-1",
    weekday: 2,
    turno: "manha" as const,
  };

  it("prioridade menor primeiro, depois quem espera há mais tempo, cortada no tamanho", () => {
    const cedo = entrada({
      contactId: "c-antigo",
      createdAt: "2026-08-01T00:00:00Z",
    });
    const tarde = entrada({
      contactId: "c-novo",
      createdAt: "2026-09-01T00:00:00Z",
    });
    const vip = entrada({
      contactId: "c-vip",
      priority: -10,
      createdAt: "2026-09-10T00:00:00Z",
    });
    const onda = montarOnda({
      entradas: [tarde, cedo, vip],
      slot,
      procedimentosDoProfissional: new Set(),
      excluirContatos: new Set(),
      tamanho: 2,
    });
    expect(onda.map((e) => e.contactId)).toEqual(["c-vip", "c-antigo"]);
  });

  it("exclui quem está na lista de exclusão e não repete contato", () => {
    const a1 = entrada({ contactId: "c-a" });
    const a2 = entrada({ contactId: "c-a", professionalId: "prof-1" });
    const b = entrada({ contactId: "c-b" });
    const onda = montarOnda({
      entradas: [a1, a2, b],
      slot,
      procedimentosDoProfissional: new Set(),
      excluirContatos: new Set(["c-b"]),
      tamanho: 5,
    });
    expect(onda.map((e) => e.contactId)).toEqual(["c-a"]);
  });
});

describe("interpretarRespostaDeOferta", () => {
  it("aceita o que a mensagem instrui e o vocabulário de confirmação", () => {
    expect(interpretarRespostaDeOferta("SIM")).toBe("aceitar");
    expect(interpretarRespostaDeOferta("quero")).toBe("aceitar");
    expect(interpretarRespostaDeOferta("1")).toBe("aceitar");
  });

  it("recusa com o vocabulário instruído e o de cancelamento", () => {
    expect(interpretarRespostaDeOferta("NÃO QUERO")).toBe("recusar");
    expect(interpretarRespostaDeOferta("nao")).toBe("recusar");
    expect(interpretarRespostaDeOferta("3")).toBe("recusar");
  });

  it("remarcar e conversa comum não significam nada numa oferta", () => {
    expect(interpretarRespostaDeOferta("2")).toBe("nao_reconhecida");
    expect(interpretarRespostaDeOferta("remarcar")).toBe("nao_reconhecida");
    expect(interpretarRespostaDeOferta("bom dia, tudo bem?")).toBe(
      "nao_reconhecida",
    );
    expect(interpretarRespostaDeOferta(null)).toBe("nao_reconhecida");
  });
});
