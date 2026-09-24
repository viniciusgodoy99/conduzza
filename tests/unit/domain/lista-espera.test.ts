import { describe, expect, it } from "vitest";

import {
  casaComSlot,
  diaDaSemanaNoFuso,
  escolherVinculo,
  interpretarRespostaDeOferta,
  liberacaoPorContato,
  montarOnda,
  ordenarFila,
  proximaEsperaPorReconexao,
  proximaTentativaDaVaga,
  temFolgaParaResponder,
  turnoDoInstante,
  FOLGA_DA_ULTIMA_VOLTA_MS,
  FOLGA_DO_FECHAMENTO_MS,
  REPOUSO_POS_OFERTA_MS,
  type EntradaDaFila,
  type SlotVago,
  type VinculoDaVaga,
} from "@/lib/domain/lista-espera";

// Aceite da logica pura da 4.9: o casamento vaga x preferencias e no FUSO DA
// CLINICA (regra 3.6), sem preferencia casa tudo, a onda respeita prioridade
// e antiguidade, e o vocabulario da oferta aceita o que a mensagem instrui.
// Revisao de liberacao (24/09): a pessoa precisa ter COMO ser agendada
// (vinculo do convenio ou particular, duracao que cabe, recurso livre), a
// ordem entre grupos e a de chegada, e a vaga presa espera em vez de sumir.

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
  weekday: 2,
  turno: "manha",
  duracaoMin: 30,
  procedimentoDaVaga: "proc-1",
};
const VINCULOS_PADRAO: VinculoDaVaga[] = [vinculo({})];

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
  const slot = SLOT;
  const atende = VINCULOS_PADRAO;

  it("sem preferência nenhuma casa com qualquer vaga (herda o procedimento da vaga)", () => {
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

  it("procedimento que não cabe na vaga fica de fora (Consulta de 60 min numa vaga de 30)", () => {
    const vinculos = [
      vinculo({ procedureId: "proc-1", durationMin: 30 }),
      vinculo({ procedureId: "proc-longo", durationMin: 60 }),
    ];
    expect(
      casaComSlot(entrada({ procedureId: "proc-longo" }), slot, vinculos),
    ).toBe(false);
    expect(
      casaComSlot(
        entrada({ procedureId: "proc-longo" }),
        { ...slot, duracaoMin: 60 },
        vinculos,
      ),
    ).toBe(true);
  });

  it("sem vínculo no convênio do contato nem particular, não há como agendar", () => {
    const soUnimed = [vinculo({ insuranceId: "unimed" })];
    expect(casaComSlot(entrada({}), slot, soUnimed)).toBe(false);
    expect(
      casaComSlot(entrada({ insuranceId: "unimed" }), slot, soUnimed),
    ).toBe(true);
    // Convênio sem vínculo próprio cai no particular.
    expect(
      casaComSlot(entrada({ insuranceId: "bradesco" }), slot, VINCULOS_PADRAO),
    ).toBe(true);
  });

  it("recurso do procedimento ocupado no horário tira a pessoa da onda", () => {
    const comSala = [vinculo({ resourceId: "sala-laser" })];
    expect(
      casaComSlot(entrada({}), slot, comSala, new Set(["sala-laser"])),
    ).toBe(false);
    expect(casaComSlot(entrada({}), slot, comSala, new Set())).toBe(true);
  });

  it("entrada sem procedimento numa vaga sem procedimento conhecido não casa", () => {
    expect(
      casaComSlot(
        entrada({}),
        { ...slot, procedimentoDaVaga: null },
        VINCULOS_PADRAO,
      ),
    ).toBe(false);
  });
});

describe("escolherVinculo", () => {
  const particular = vinculo({ id: "v-particular", insuranceId: null });
  const unimed = vinculo({ id: "v-unimed", insuranceId: "unimed" });
  const outroProcedimento = vinculo({
    id: "v-outro",
    procedureId: "proc-2",
    insuranceId: "unimed",
  });

  it("convênio do contato primeiro, particular depois, nunca o convênio de outra pessoa", () => {
    const vinculos = [outroProcedimento, particular, unimed];
    expect(escolherVinculo(vinculos, "proc-1", "unimed")?.id).toBe("v-unimed");
    expect(escolherVinculo(vinculos, "proc-1", null)?.id).toBe("v-particular");
    expect(escolherVinculo(vinculos, "proc-1", "bradesco")?.id).toBe(
      "v-particular",
    );
    expect(escolherVinculo([unimed], "proc-1", null)).toBeNull();
    expect(escolherVinculo(vinculos, null, "unimed")).toBeNull();
  });

  it("a ordem de chegada dos vínculos não muda a escolha", () => {
    expect(escolherVinculo([unimed, particular], "proc-1", "unimed")?.id).toBe(
      "v-unimed",
    );
    expect(escolherVinculo([particular, unimed], "proc-1", "unimed")?.id).toBe(
      "v-unimed",
    );
  });
});

describe("ordenarFila (ordem entre grupos)", () => {
  it("reordenar um grupo não põe o grupo inteiro na frente de quem espera há mais tempo em outro", () => {
    // Grupo Dra. Ana: renumerado para 10 e 20 pelo reordenar (chegaram em
    // setembro). Grupo "qualquer": padrão 1000000, espera desde agosto.
    const anaA = entrada({
      id: "ana-a",
      professionalId: "ana",
      priority: 20,
      createdAt: "2026-09-10T00:00:00Z",
    });
    const anaB = entrada({
      id: "ana-b",
      professionalId: "ana",
      priority: 10,
      createdAt: "2026-09-12T00:00:00Z",
    });
    const antiga = entrada({
      id: "antiga",
      priority: 1000000,
      createdAt: "2026-08-01T00:00:00Z",
    });
    const ordem = ordenarFila([anaA, anaB, antiga]).map((e) => e.id);
    // Quem espera desde agosto continua na frente; dentro do grupo da Dra.
    // Ana vale a ordem da recepção (ana-b subiu para o primeiro lugar).
    expect(ordem).toEqual(["antiga", "ana-b", "ana-a"]);
  });

  it("dentro do grupo a posição escolhida herda a vaga de chegada do grupo", () => {
    const primeiro = entrada({
      id: "g-1",
      procedureId: "proc-1",
      priority: 30,
      createdAt: "2026-08-01T00:00:00Z",
    });
    const segundo = entrada({
      id: "g-2",
      procedureId: "proc-1",
      priority: 10,
      createdAt: "2026-09-20T00:00:00Z",
    });
    const outroGrupo = entrada({
      id: "outro",
      procedureId: "proc-2",
      createdAt: "2026-09-01T00:00:00Z",
    });
    // g-2 sobe para o topo do grupo e herda a chegada de agosto; g-1 fica
    // com a de 20/09, depois do "outro" (01/09).
    expect(
      ordenarFila([primeiro, segundo, outroGrupo]).map((e) => e.id),
    ).toEqual(["g-2", "outro", "g-1"]);
  });
});

describe("montarOnda", () => {
  const slot = SLOT;

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
      vinculos: VINCULOS_PADRAO,
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
      vinculos: VINCULOS_PADRAO,
      excluirContatos: new Set(["c-b"]),
      tamanho: 5,
    });
    expect(onda.map((e) => e.contactId)).toEqual(["c-a"]);
  });

  it("quem espera há semanas em outro grupo vem antes do grupo reordenado", () => {
    const reordenada = entrada({
      contactId: "c-reordenada",
      professionalId: "prof-1",
      procedureId: "proc-1",
      priority: 10,
      createdAt: "2026-09-15T00:00:00Z",
    });
    const antiga = entrada({
      contactId: "c-antiga",
      priority: 1000000,
      createdAt: "2026-08-20T00:00:00Z",
    });
    const onda = montarOnda({
      entradas: [reordenada, antiga],
      slot,
      vinculos: VINCULOS_PADRAO,
      excluirContatos: new Set(),
      tamanho: 1,
    });
    expect(onda.map((e) => e.contactId)).toEqual(["c-antiga"]);
  });
});

describe("segunda vaga ao mesmo tempo (vaga presa em outra oferta)", () => {
  const agora = new Date("2026-09-24T12:00:00Z").getTime();
  const criadaHa10Min = new Date(agora - 10 * 60_000).toISOString();
  const venceEm20Min = new Date(agora + 20 * 60_000).toISOString();

  it("liberação: o maior entre o repouso de 2h e o vencimento da oferta aberta", () => {
    const liberacao = liberacaoPorContato([
      {
        offeredTo: ["c-1", "c-2"],
        status: "aberta",
        createdAt: criadaHa10Min,
        expiresAt: venceEm20Min,
      },
      {
        // Janela longa: vence depois do repouso.
        offeredTo: ["c-3"],
        status: "aberta",
        createdAt: criadaHa10Min,
        expiresAt: new Date(agora + 4 * 60 * 60_000).toISOString(),
      },
    ]);
    const repouso = new Date(criadaHa10Min).getTime() + REPOUSO_POS_OFERTA_MS;
    expect(liberacao.get("c-1")).toBe(repouso);
    expect(liberacao.get("c-3")).toBe(
      agora + 4 * 60 * 60_000 + FOLGA_DO_FECHAMENTO_MS,
    );
  });

  it("onda vazia só por bloqueio temporário: volta quando o primeiro se libera", () => {
    const presa = entrada({ contactId: "c-presa" });
    const liberacao = new Map([["c-presa", agora + 2 * 60 * 60_000]]);
    const quando = proximaTentativaDaVaga({
      entradas: [presa],
      slot: SLOT,
      vinculos: VINCULOS_PADRAO,
      excluirPermanentes: new Set(),
      liberacao,
      agora,
      limite: agora + 3 * 60 * 60_000,
    });
    expect(quando).toBe(agora + 2 * 60 * 60_000);
  });

  it("ninguém preso (fila sem interessado) ou liberação depois do limite: nada a esperar", () => {
    const semInteresse = entrada({
      contactId: "c-tarde",
      preferredShifts: ["tarde"],
    });
    const presa = entrada({ contactId: "c-presa" });
    expect(
      proximaTentativaDaVaga({
        entradas: [semInteresse],
        slot: SLOT,
        vinculos: VINCULOS_PADRAO,
        excluirPermanentes: new Set(),
        liberacao: new Map([["c-tarde", agora + 60 * 60_000]]),
        agora,
        limite: agora + 3 * 60 * 60_000,
      }),
    ).toBeNull();
    expect(
      proximaTentativaDaVaga({
        entradas: [presa],
        slot: SLOT,
        vinculos: VINCULOS_PADRAO,
        excluirPermanentes: new Set(),
        liberacao: new Map([["c-presa", agora + 2 * 60 * 60_000]]),
        agora,
        limite: agora + 60 * 60_000,
      }),
    ).toBeNull();
  });

  it("exclusão permanente (já recebeu esta vaga) não conta como presa", () => {
    const presa = entrada({ contactId: "c-presa" });
    expect(
      proximaTentativaDaVaga({
        entradas: [presa],
        slot: SLOT,
        vinculos: VINCULOS_PADRAO,
        excluirPermanentes: new Set(["c-presa"]),
        liberacao: new Map([["c-presa", agora + 60 * 60_000]]),
        agora,
        limite: agora + 3 * 60 * 60_000,
      }),
    ).toBeNull();
  });

  it("oferta vencida que o cron ainda não fechou: nunca reagenda para o passado", () => {
    const presa = entrada({ contactId: "c-presa" });
    const quando = proximaTentativaDaVaga({
      entradas: [presa],
      slot: SLOT,
      vinculos: VINCULOS_PADRAO,
      excluirPermanentes: new Set(),
      liberacao: new Map([["c-presa", agora - 5 * 60_000]]),
      agora,
      limite: agora + 3 * 60 * 60_000,
    });
    expect(quando).toBe(agora + 60_000);
  });
});

describe("temFolgaParaResponder", () => {
  const criadaEm = "2026-09-24T12:00:00Z";
  const venceEm = "2026-09-24T12:30:00Z";

  it("envia com pelo menos metade da janela pela frente", () => {
    expect(
      temFolgaParaResponder({
        criadaEm,
        venceEm,
        agora: new Date("2026-09-24T12:14:00Z").getTime(),
      }),
    ).toBe(true);
    expect(
      temFolgaParaResponder({
        criadaEm,
        venceEm,
        agora: new Date("2026-09-24T12:15:00Z").getTime(),
      }),
    ).toBe(true);
  });

  it("não envia oferta que chegaria no fim do prazo (retry da desconexão)", () => {
    expect(
      temFolgaParaResponder({
        criadaEm,
        venceEm,
        agora: new Date("2026-09-24T12:16:00Z").getTime(),
      }),
    ).toBe(false);
    expect(
      temFolgaParaResponder({
        criadaEm,
        venceEm,
        agora: new Date("2026-09-24T12:40:00Z").getTime(),
      }),
    ).toBe(false);
  });
});

describe("proximaEsperaPorReconexao (WhatsApp fora do ar)", () => {
  // Revisao da leva 1, achado R2: a espera pela reconexao tem teto de TEMPO
  // (o limite da vaga), nao de voltas. Uma queda de sexta a noite nao pode
  // matar a oferta da vaga de segunda.
  const MIN = 60_000;
  const agora = new Date("2026-09-25T20:30:00Z").getTime();
  const longe = agora + 60 * 60 * MIN;

  it("cresce de 5 em 5 minutos e para em 30", () => {
    const esperas = [0, 1, 2, 3, 4, 5, 6, 40].map(
      (passo) =>
        (proximaEsperaPorReconexao({ passo, agora, limite: longe })! - agora) /
        MIN,
    );
    expect(esperas).toEqual([5, 10, 15, 20, 25, 30, 30, 30]);
  });

  it("uma queda de fim de semana nunca esgota as voltas antes do limite", () => {
    // Sexta 17h30 ate segunda 8h30 (limite = 9h menos 30 min de janela).
    const inicio = new Date("2026-09-25T20:30:00Z").getTime();
    const limite = new Date("2026-09-28T11:30:00Z").getTime();
    let instante = inicio;
    let passo = 0;
    let ultimo = inicio;
    for (;;) {
      const quando = proximaEsperaPorReconexao({ passo, agora: instante, limite });
      if (quando === null) {
        break;
      }
      expect(quando).toBeGreaterThan(instante);
      expect(quando).toBeLessThan(limite);
      ultimo = quando;
      instante = quando;
      passo += 1;
    }
    // Muito mais que 20 voltas, e a ultima cai 1 minuto antes do limite.
    expect(passo).toBeGreaterThan(20);
    expect(ultimo).toBe(limite - FOLGA_DA_ULTIMA_VOLTA_MS);
  });

  it("perto do limite, a última volta cai 1 minuto antes dele", () => {
    const limite = agora + 12 * MIN;
    expect(proximaEsperaPorReconexao({ passo: 5, agora, limite })).toBe(
      limite - FOLGA_DA_ULTIMA_VOLTA_MS,
    );
  });

  it("sem tempo útil (menos de 1 minuto de espera antes do limite), desiste", () => {
    expect(
      proximaEsperaPorReconexao({ passo: 0, agora, limite: agora + 90_000 }),
    ).toBeNull();
    expect(
      proximaEsperaPorReconexao({ passo: 0, agora, limite: agora }),
    ).toBeNull();
    expect(
      proximaEsperaPorReconexao({ passo: 0, agora, limite: agora - MIN }),
    ).toBeNull();
  });

  it("passo inválido no payload conta como a primeira volta", () => {
    for (const passo of [-3, 1.5, Number.NaN]) {
      expect(proximaEsperaPorReconexao({ passo, agora, limite: longe })).toBe(
        agora + 5 * MIN,
      );
    }
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
