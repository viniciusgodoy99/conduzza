import { describe, expect, it } from "vitest";

import {
  CHAVE_DAS_ESPERAS_DO_CANAL,
  decidirEsperaDoCanal,
  esperasDoCanalJaFeitas,
  FOLGA_DA_ULTIMA_VOLTA_MS,
  MOTIVOS_DA_ESPERA_DO_CANAL,
  prazoDaEsperaDoEnvioAtivo,
  prazoDaEsperaNaRegua,
  proximaEsperaPorReconexao,
} from "@/lib/domain/espera-do-canal";
import { proximaEsperaPorReconexao as daListaDeEspera } from "@/lib/domain/lista-espera";

// Espera do canal (WhatsApp da clinica fora do ar): a desistencia e por PRAZO
// FIXO, nunca pelo teto de 20 devolucoes da fila, e a espera cresce de 5 ate
// 30 minutos. Defeito corrigido: com o celular caido a confirmacao morria em
// cerca de 95 minutos (vigesima devolucao) e nao saia quando a clinica
// reconectava.

const MIN = 60_000;
const HORA = 60 * MIN;
const agora = new Date("2026-09-25T15:00:00.000Z").getTime();

describe("a regra de passos é a mesma da lista de espera", () => {
  it("a lista de espera continua usando exatamente a mesma função", () => {
    expect(daListaDeEspera).toBe(proximaEsperaPorReconexao);
  });

  it("os motivos que o banco reconhece como espera do canal", () => {
    expect([...MOTIVOS_DA_ESPERA_DO_CANAL]).toEqual([
      "desconectado",
      "sem_numero",
    ]);
    expect(CHAVE_DAS_ESPERAS_DO_CANAL).toBe("esperas_do_canal");
  });
});

describe("esperasDoCanalJaFeitas", () => {
  it("lê a contagem que reagendar_job grava no payload", () => {
    expect(esperasDoCanalJaFeitas({})).toBe(0);
    expect(esperasDoCanalJaFeitas({ esperas_do_canal: 0 })).toBe(0);
    expect(esperasDoCanalJaFeitas({ esperas_do_canal: 7 })).toBe(7);
  });

  it("valor fora do contrato conta como a primeira espera", () => {
    for (const valor of [-1, 1.5, "3", null, Number.NaN, {}]) {
      expect(esperasDoCanalJaFeitas({ esperas_do_canal: valor })).toBe(0);
    }
  });
});

describe("prazoDaEsperaNaRegua", () => {
  // Sexta, 25/09/2026, 9h em Fortaleza (UTC-3): dentro da janela das 8h as 18h.
  const scheduledFor = "2026-09-25T12:00:00.000Z";
  const FUSO = "America/Fortaleza";
  const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
  const DAS_8_AS_18 = {
    inicio: "08:00",
    fim: "18:00",
    diasDaSemana: TODOS_OS_DIAS,
  };
  const DIAS_UTEIS_DAS_8_AS_18 = {
    ...DAS_8_AS_18,
    diasDaSemana: [1, 2, 3, 4, 5],
  };
  const regua = { janela: DAS_8_AS_18, timezone: FUSO, manual: false };

  it("confirmação: até a hora da consulta", () => {
    expect(
      prazoDaEsperaNaRegua({
        kind: "confirmacao",
        inicioDaConsulta: "2026-09-26T13:00:00.000Z",
        scheduledFor,
        ...regua,
      }),
    ).toBe(new Date("2026-09-26T13:00:00.000Z").getTime());
  });

  it("demais réguas vencidas dentro da janela: 12 horas depois do vencimento, âncora fixa", () => {
    for (const kind of ["pos_falta", "followup"]) {
      expect(
        prazoDaEsperaNaRegua({
          kind,
          // Consulta de pos falta nao vale como prazo: so a confirmacao usa.
          inicioDaConsulta: "2026-09-30T13:00:00.000Z",
          scheduledFor,
          ...regua,
        }),
      ).toBe(new Date(scheduledFor).getTime() + 12 * HORA);
    }
  });

  it("vencido depois do fechamento: 12 horas depois da abertura seguinte", () => {
    // Sexta 19h local vence fora da janela; a primeira chance e sabado 8h.
    expect(
      prazoDaEsperaNaRegua({
        kind: "followup",
        inicioDaConsulta: null,
        scheduledFor: "2026-09-25T22:00:00.000Z",
        ...regua,
      }),
    ).toBe(new Date("2026-09-26T11:00:00.000Z").getTime() + 12 * HORA);
  });

  it("vencido antes da abertura: 12 horas depois da abertura do mesmo dia", () => {
    // Sexta 3h local; a janela abre as 8h.
    expect(
      prazoDaEsperaNaRegua({
        kind: "pos_falta",
        inicioDaConsulta: null,
        scheduledFor: "2026-09-25T06:00:00.000Z",
        ...regua,
      }),
    ).toBe(new Date("2026-09-25T11:00:00.000Z").getTime() + 12 * HORA);
  });

  it("vencido no sábado com janela de segunda a sexta: conta da segunda às 8h", () => {
    expect(
      prazoDaEsperaNaRegua({
        kind: "followup",
        inicioDaConsulta: null,
        // Sabado, 26/09, 10h local.
        scheduledFor: "2026-09-26T13:00:00.000Z",
        ...regua,
        janela: DIAS_UTEIS_DAS_8_AS_18,
      }),
    ).toBe(new Date("2026-09-28T11:00:00.000Z").getTime() + 12 * HORA);
  });

  it("toque manual: a janela não vale, conta do próprio vencimento", () => {
    const vencimento = "2026-09-25T22:00:00.000Z";
    expect(
      prazoDaEsperaNaRegua({
        kind: "followup",
        inicioDaConsulta: null,
        scheduledFor: vencimento,
        ...regua,
        manual: true,
      }),
    ).toBe(new Date(vencimento).getTime() + 12 * HORA);
  });

  it("janela sem abertura (inválida): conta do próprio vencimento", () => {
    const vencimento = "2026-09-25T22:00:00.000Z";
    expect(
      prazoDaEsperaNaRegua({
        kind: "followup",
        inicioDaConsulta: null,
        scheduledFor: vencimento,
        ...regua,
        janela: { inicio: null, fim: null, diasDaSemana: null },
      }),
    ).toBe(new Date(vencimento).getTime() + 12 * HORA);
  });

  it("confirmação sem consulta legível cai nas 12 horas do vencimento", () => {
    expect(
      prazoDaEsperaNaRegua({
        kind: "confirmacao",
        inicioDaConsulta: null,
        scheduledFor,
        ...regua,
      }),
    ).toBe(new Date(scheduledFor).getTime() + 12 * HORA);
    expect(
      prazoDaEsperaNaRegua({
        kind: "confirmacao",
        inicioDaConsulta: "não é data",
        scheduledFor,
        ...regua,
      }),
    ).toBe(new Date(scheduledFor).getTime() + 12 * HORA);
  });

  it("vencimento ilegível não dá prazo nenhum", () => {
    expect(
      prazoDaEsperaNaRegua({
        kind: "followup",
        inicioDaConsulta: null,
        scheduledFor: "lixo",
        ...regua,
      }),
    ).toBe(Number.NEGATIVE_INFINITY);
  });

  it("follow-up das 19h com o celular caído: espera na abertura e desiste só 12 horas depois dela", () => {
    // Antes (ancora no vencimento cru), o prazo passava as 7h de sabado e o
    // toque morria as 8h, na primeira tentativa, sem esperar nada.
    const prazo = prazoDaEsperaNaRegua({
      kind: "followup",
      inicioDaConsulta: null,
      scheduledFor: "2026-09-25T22:00:00.000Z",
      ...regua,
    });
    const abertura = new Date("2026-09-26T11:00:00.000Z").getTime();
    expect(
      decidirEsperaDoCanal({
        motivo: "desconectado",
        payload: {},
        agora: abertura,
        prazo,
      }),
    ).toEqual({
      reagendar: new Date(abertura + 5 * MIN).toISOString(),
      motivo: "desconectado",
    });
    // Sabado 20h01 local: passou da abertura + 12h.
    expect(
      decidirEsperaDoCanal({
        motivo: "desconectado",
        payload: {},
        agora: abertura + 12 * HORA + MIN,
        prazo,
      }),
    ).toBeNull();
  });
});

describe("prazoDaEsperaDoEnvioAtivo", () => {
  it("com consulta no payload: até a hora dela, mesmo com o job antigo", () => {
    expect(
      prazoDaEsperaDoEnvioAtivo({
        inicioDaConsulta: "2026-09-27T13:00:00.000Z",
        criadoEm: "2026-09-20T13:00:00.000Z",
        agora,
      }),
    ).toBe(new Date("2026-09-27T13:00:00.000Z").getTime());
  });

  it("sem consulta: 12 horas depois de o job nascer, nunca do relógio", () => {
    const criadoEm = "2026-09-25T05:00:00.000Z";
    const prazo = prazoDaEsperaDoEnvioAtivo({
      inicioDaConsulta: null,
      criadoEm,
      agora,
    });
    expect(prazo).toBe(new Date(criadoEm).getTime() + 12 * HORA);
    // O mesmo prazo em qualquer volta: a ancora nao anda com a espera.
    expect(
      prazoDaEsperaDoEnvioAtivo({
        inicioDaConsulta: null,
        criadoEm,
        agora: agora + 5 * HORA,
      }),
    ).toBe(prazo);
  });

  it("job montado sem created_at: agora mais 12 horas", () => {
    expect(
      prazoDaEsperaDoEnvioAtivo({
        inicioDaConsulta: null,
        criadoEm: undefined,
        agora,
      }),
    ).toBe(agora + 12 * HORA);
  });
});

describe("decidirEsperaDoCanal", () => {
  const longe = agora + 3 * 24 * HORA;

  it("cresce de 5 em 5 minutos pelas esperas já feitas e para em 30", () => {
    const esperas = [0, 1, 2, 3, 4, 5, 6, 25, 399].map((feitas) => {
      const decisao = decidirEsperaDoCanal({
        motivo: "desconectado",
        payload: { esperas_do_canal: feitas },
        agora,
        prazo: longe,
      });
      return (new Date(decisao!.reagendar).getTime() - agora) / MIN;
    });
    expect(esperas).toEqual([5, 10, 15, 20, 25, 30, 30, 30, 30]);
  });

  it("devolve o motivo que vai para ultimo_motivo_devolucao", () => {
    for (const motivo of MOTIVOS_DA_ESPERA_DO_CANAL) {
      expect(
        decidirEsperaDoCanal({ motivo, payload: {}, agora, prazo: longe }),
      ).toEqual({
        reagendar: new Date(agora + 5 * MIN).toISOString(),
        motivo,
      });
    }
  });

  it("perto do prazo, a última volta cai 1 minuto antes dele", () => {
    const prazo = agora + 3 * MIN;
    expect(
      decidirEsperaDoCanal({
        motivo: "desconectado",
        payload: {},
        agora,
        prazo,
      }),
    ).toEqual({
      reagendar: new Date(prazo - FOLGA_DA_ULTIMA_VOLTA_MS).toISOString(),
      motivo: "desconectado",
    });
  });

  it("sem tempo útil antes do prazo, desiste", () => {
    for (const prazo of [agora + 90_000, agora, agora - HORA]) {
      expect(
        decidirEsperaDoCanal({
          motivo: "sem_numero",
          payload: {},
          agora,
          prazo,
        }),
      ).toBeNull();
    }
  });

  it("uma queda de 20 horas não esgota a confirmação antes da consulta", () => {
    // Consulta amanha 10h, celular caido desde agora: o toque espera ate o
    // fim, muito alem das 20 voltas que o teto antigo permitia.
    const prazo = agora + 20 * HORA;
    let instante = agora;
    let feitas = 0;
    let ultimo = agora;
    for (;;) {
      const decisao = decidirEsperaDoCanal({
        motivo: "desconectado",
        payload: { esperas_do_canal: feitas },
        agora: instante,
        prazo,
      });
      if (!decisao) {
        break;
      }
      const quando = new Date(decisao.reagendar).getTime();
      expect(quando).toBeGreaterThan(instante);
      expect(quando).toBeLessThan(prazo);
      ultimo = quando;
      instante = quando;
      feitas += 1;
    }
    expect(feitas).toBeGreaterThan(20);
    // Bem abaixo do teto de seguranca de 400 do banco.
    expect(feitas).toBeLessThan(400);
    expect(ultimo).toBe(prazo - FOLGA_DA_ULTIMA_VOLTA_MS);
  });
});
