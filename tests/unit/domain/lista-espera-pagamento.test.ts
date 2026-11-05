import { describe, expect, it } from "vitest";

import {
  casaComSlot,
  escolherVinculo,
  montarOnda,
  proximaTentativaDaVaga,
  regraDaEntrada,
  vinculoDaEntrada,
  REGRA_DA_ENTRADA_DA_IA,
  type EntradaDaFila,
  type SlotVago,
  type VinculoDaVaga,
} from "@/lib/domain/lista-espera";

// AG5, D-37 (a confirmar com o dono): o espelho em TypeScript da regra do
// aceite (aceitar_oferta_de_espera, migration 20261029100000). O pagamento
// DECLARADO na entrada e estrito (particular: so o vinculo particular;
// convenio: so o vinculo daquele convenio); a entrada da IA so vale para o
// vinculo que a IA marca (daIa); sem declaracao e sem origem "ia" (todas as
// entradas de antes), a regra de antes: o convenio do contato, senao o
// particular, com qualquer vinculo ativo. O ensaio do banco prova o mesmo
// no aceite (passo 9) e a paridade das entradas de hoje.

function entrada(parcial: Partial<EntradaDaFila>): EntradaDaFila {
  return {
    id: crypto.randomUUID(),
    contactId: crypto.randomUUID(),
    procedureId: "proc-1",
    professionalId: null,
    preferredShifts: [],
    preferredWeekdays: [],
    priority: 1_000_000,
    createdAt: "2026-10-27T12:00:00Z",
    insuranceId: null,
    ...parcial,
  };
}

function vinculo(parcial: Partial<VinculoDaVaga>): VinculoDaVaga {
  return {
    id: crypto.randomUUID(),
    procedureId: "proc-1",
    insuranceId: null,
    durationMin: 30,
    resourceId: null,
    ...parcial,
  };
}

const SLOT: SlotVago = {
  professionalId: "prof-1",
  weekday: 1,
  turno: "manha",
  duracaoMin: 30,
  procedimentoDaVaga: "proc-1",
};

const particularDaIa = vinculo({ id: "particular-ia", daIa: true });
const particularDaEquipe = vinculo({ id: "particular-equipe", daIa: false });
const unimedDaIa = vinculo({ id: "unimed-ia", insuranceId: "unimed", daIa: true });
const unimedDaEquipe = vinculo({ id: "unimed-equipe", insuranceId: "unimed", daIa: false });

describe("a regra vale (D-37 recomendada)", () => {
  it("a constante do espelho está ligada, como c_regra_da_entrada_da_ia", () => {
    expect(REGRA_DA_ENTRADA_DA_IA).toBe(true);
  });
});

describe("regraDaEntrada", () => {
  it("entrada da equipe sem pagamento declarado: a regra de antes, pelo convênio do contato", () => {
    expect(regraDaEntrada(entrada({ insuranceId: "unimed" }))).toEqual({
      regra: { pagamento: "do_contato", soDaIa: false },
      convenio: "unimed",
    });
    expect(regraDaEntrada(entrada({ origem: "equipe" }))).toEqual({
      regra: { pagamento: "do_contato", soDaIa: false },
      convenio: null,
    });
  });

  it("entrada da IA particular: só o particular, só vínculo da IA, mesmo com convênio no cadastro", () => {
    expect(
      regraDaEntrada(
        entrada({ origem: "ia", particularDeclarado: true, insuranceId: "unimed" }),
      ),
    ).toEqual({ regra: { pagamento: "declarado", soDaIa: true }, convenio: null });
  });

  it("entrada da IA pelo convênio: só o convênio declarado", () => {
    expect(
      regraDaEntrada(
        entrada({
          origem: "ia",
          particularDeclarado: false,
          insuranceIdDeclarado: "unimed",
        }),
      ),
    ).toEqual({ regra: { pagamento: "declarado", soDaIa: true }, convenio: "unimed" });
  });

  it("convênio declarado sem dizer qual (o banco não grava assim): nenhum vínculo", () => {
    expect(
      regraDaEntrada(entrada({ origem: "ia", particularDeclarado: false })).convenio,
    ).toBeUndefined();
  });
});

describe("escolherVinculo com a regra", () => {
  const todos = [particularDaEquipe, unimedDaEquipe, particularDaIa, unimedDaIa];

  it("sem regra, igual a antes (o convênio do contato, senão o particular)", () => {
    const vinculos = [particularDaEquipe, unimedDaEquipe];
    expect(escolherVinculo(vinculos, "proc-1", "unimed")?.id).toBe("unimed-equipe");
    expect(escolherVinculo(vinculos, "proc-1", null)?.id).toBe("particular-equipe");
    expect(escolherVinculo(vinculos, "proc-1", "bradesco")?.id).toBe("particular-equipe");
  });

  it("declarado particular: só o particular, nunca o convênio", () => {
    expect(
      escolherVinculo([unimedDaEquipe], "proc-1", null, {
        pagamento: "declarado",
        soDaIa: false,
      }),
    ).toBeNull();
    expect(
      escolherVinculo(todos, "proc-1", null, { pagamento: "declarado", soDaIa: false })
        ?.id,
    ).toBe("particular-equipe");
  });

  it("declarado convênio: só aquele convênio, sem cair no particular", () => {
    expect(
      escolherVinculo([particularDaEquipe], "proc-1", "unimed", {
        pagamento: "declarado",
        soDaIa: false,
      }),
    ).toBeNull();
    expect(
      escolherVinculo(todos, "proc-1", "unimed", { pagamento: "declarado", soDaIa: true })
        ?.id,
    ).toBe("unimed-ia");
  });

  it("só da IA: o vínculo sem daIa não serve", () => {
    expect(
      escolherVinculo([particularDaEquipe, unimedDaEquipe], "proc-1", null, {
        pagamento: "declarado",
        soDaIa: true,
      }),
    ).toBeNull();
    expect(
      escolherVinculo([particularDaEquipe, particularDaIa], "proc-1", null, {
        pagamento: "declarado",
        soDaIa: true,
      })?.id,
    ).toBe("particular-ia");
  });

  it("declarado sem convênio conhecido (undefined): nenhum", () => {
    expect(
      escolherVinculo(todos, "proc-1", undefined, { pagamento: "declarado", soDaIa: true }),
    ).toBeNull();
  });
});

describe("vinculoDaEntrada (o mesmo do aceite)", () => {
  it("equipe sem declaração, contato com Unimed: o vínculo da Unimed, mesmo sem IA pode agendar", () => {
    expect(
      vinculoDaEntrada(entrada({ insuranceId: "unimed" }), SLOT, [
        particularDaEquipe,
        unimedDaEquipe,
      ])?.id,
    ).toBe("unimed-equipe");
  });

  it("IA particular, contato com Unimed no cadastro: o particular da IA (estrito)", () => {
    expect(
      vinculoDaEntrada(
        entrada({ origem: "ia", particularDeclarado: true, insuranceId: "unimed" }),
        SLOT,
        [particularDaIa, unimedDaIa],
      )?.id,
    ).toBe("particular-ia");
  });

  it("IA particular só com o particular que a IA não marca: nenhum", () => {
    expect(
      vinculoDaEntrada(entrada({ origem: "ia", particularDeclarado: true }), SLOT, [
        particularDaEquipe,
      ]),
    ).toBeNull();
  });

  it("IA pela Unimed sem vínculo da Unimed: nenhum (não vira particular)", () => {
    expect(
      vinculoDaEntrada(
        entrada({ origem: "ia", particularDeclarado: false, insuranceIdDeclarado: "unimed" }),
        SLOT,
        [particularDaIa],
      ),
    ).toBeNull();
  });

  it("equipe com pagamento declarado pelo servidor: estrito, sem exigir o vínculo da IA", () => {
    expect(
      vinculoDaEntrada(
        entrada({ particularDeclarado: true, insuranceId: "unimed" }),
        SLOT,
        [particularDaEquipe, unimedDaEquipe],
      )?.id,
    ).toBe("particular-equipe");
  });

  it("entrada da IA qualquer procedimento herda o procedimento da vaga, com a regra dela", () => {
    expect(
      vinculoDaEntrada(
        entrada({ origem: "ia", particularDeclarado: true, procedureId: null }),
        SLOT,
        [particularDaEquipe, particularDaIa],
      )?.id,
    ).toBe("particular-ia");
  });
});

describe("a onda com entradas da IA", () => {
  it("a da IA sem vínculo da IA fica fora; a da equipe, no mesmo vínculo, entra", () => {
    const daEquipe = entrada({ createdAt: "2026-10-27T12:00:00Z" });
    const daIa = entrada({
      origem: "ia",
      particularDeclarado: true,
      createdAt: "2026-10-27T11:00:00Z",
    });
    expect(casaComSlot(daIa, SLOT, [particularDaEquipe])).toBe(false);
    expect(casaComSlot(daEquipe, SLOT, [particularDaEquipe])).toBe(true);
    const onda = montarOnda({
      entradas: [daIa, daEquipe],
      slot: SLOT,
      vinculos: [particularDaEquipe],
      excluirContatos: new Set(),
      tamanho: 5,
    });
    expect(onda.map((e) => e.id)).toEqual([daEquipe.id]);
  });

  it("com o vínculo da IA, a da IA entra pela ordem de chegada", () => {
    const daEquipe = entrada({ createdAt: "2026-10-27T12:00:00Z" });
    const daIa = entrada({
      origem: "ia",
      particularDeclarado: true,
      createdAt: "2026-10-27T11:00:00Z",
    });
    const onda = montarOnda({
      entradas: [daEquipe, daIa],
      slot: SLOT,
      vinculos: [particularDaIa],
      excluirContatos: new Set(),
      tamanho: 5,
    });
    expect(onda.map((e) => e.id)).toEqual([daIa.id, daEquipe.id]);
  });

  it("convênio da IA casa só o vínculo do convênio dela, e a duração conta", () => {
    const daIa = entrada({
      origem: "ia",
      particularDeclarado: false,
      insuranceIdDeclarado: "unimed",
    });
    expect(casaComSlot(daIa, SLOT, [unimedDaIa])).toBe(true);
    expect(
      casaComSlot(daIa, SLOT, [vinculo({ insuranceId: "unimed", daIa: true, durationMin: 60 })]),
    ).toBe(false);
    expect(casaComSlot(daIa, SLOT, [particularDaIa, unimedDaEquipe])).toBe(false);
  });

  it("a vaga presa so espera pela entrada que casaria (a da IA sem vínculo não segura a vaga)", () => {
    const daIa = entrada({ origem: "ia", particularDeclarado: true });
    const liberacao = new Map([[daIa.contactId, Date.parse("2026-10-27T13:00:00Z")]]);
    expect(
      proximaTentativaDaVaga({
        entradas: [daIa],
        slot: SLOT,
        vinculos: [particularDaEquipe],
        excluirPermanentes: new Set(),
        liberacao,
        agora: Date.parse("2026-10-27T12:00:00Z"),
        limite: Date.parse("2026-10-28T12:00:00Z"),
      }),
    ).toBeNull();
    expect(
      proximaTentativaDaVaga({
        entradas: [daIa],
        slot: SLOT,
        vinculos: [particularDaIa],
        excluirPermanentes: new Set(),
        liberacao,
        agora: Date.parse("2026-10-27T12:00:00Z"),
        limite: Date.parse("2026-10-28T12:00:00Z"),
      }),
    ).toBe(Date.parse("2026-10-27T13:00:00Z"));
  });
});
