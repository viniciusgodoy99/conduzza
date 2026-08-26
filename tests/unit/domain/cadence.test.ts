import { describe, expect, it } from "vitest";

import {
  dentroDaJanela,
  passoCondizComAgenda,
  passoMaisProximoDoEvento,
  proximaAbertura,
  type JanelaDeEnvio,
} from "@/lib/domain/cadence";

const FORTALEZA = "America/Fortaleza"; // UTC-3 fixo, sem horario de verao
const SAO_PAULO = "America/Sao_Paulo"; // tambem UTC-3 hoje, mas outro calendario
const LISBOA = "Europe/Lisbon"; // UTC+1 no verao: prova que o fuso e usado

// Segunda a sexta, 08:00 as 18:00.
const COMERCIAL: JanelaDeEnvio = {
  inicio: "08:00",
  fim: "18:00",
  diasDaSemana: [1, 2, 3, 4, 5],
};

describe("dentroDaJanela", () => {
  it("janela incompleta nunca autoriza envio", () => {
    const instante = new Date("2026-09-01T13:00:00.000Z"); // 10:00 em Fortaleza
    expect(
      dentroDaJanela(
        { inicio: null, fim: "18:00", diasDaSemana: [1] },
        instante,
        FORTALEZA,
      ),
    ).toBe(false);
    expect(
      dentroDaJanela(
        { inicio: "08:00", fim: null, diasDaSemana: [1] },
        instante,
        FORTALEZA,
      ),
    ).toBe(false);
    expect(
      dentroDaJanela(
        { inicio: "08:00", fim: "18:00", diasDaSemana: null },
        instante,
        FORTALEZA,
      ),
    ).toBe(false);
    expect(
      dentroDaJanela(
        { inicio: "08:00", fim: "18:00", diasDaSemana: [] },
        instante,
        FORTALEZA,
      ),
    ).toBe(false);
  });

  it("aceita o formato time do Postgres (HH:MM:SS)", () => {
    const janela: JanelaDeEnvio = {
      inicio: "08:00:00",
      fim: "18:00:00",
      diasDaSemana: [2],
    };
    // 2026-09-01 e terca; 13:00Z = 10:00 em Fortaleza.
    expect(
      dentroDaJanela(janela, new Date("2026-09-01T13:00:00.000Z"), FORTALEZA),
    ).toBe(true);
  });

  it("comeco entra, fim nao: 18:00 em ponto ja esta fora", () => {
    // Terca, 11:00Z = 08:00 local; 21:00Z = 18:00 local.
    expect(
      dentroDaJanela(COMERCIAL, new Date("2026-09-01T11:00:00.000Z"), FORTALEZA),
    ).toBe(true);
    expect(
      dentroDaJanela(COMERCIAL, new Date("2026-09-01T21:00:00.000Z"), FORTALEZA),
    ).toBe(false);
    expect(
      dentroDaJanela(
        COMERCIAL,
        new Date("2026-09-01T20:59:00.000Z"),
        FORTALEZA,
      ),
    ).toBe(true);
  });

  it("virada de dia: o dia que vale e o LOCAL, nao o do UTC", () => {
    // 2026-09-07T01:00Z e segunda no UTC, mas ainda domingo 22:00 em
    // Fortaleza. Com a janela de segunda a sexta, isso e fora.
    const instante = new Date("2026-09-07T01:00:00.000Z");
    expect(dentroDaJanela(COMERCIAL, instante, FORTALEZA)).toBe(false);

    // O mesmo instante em Lisboa (UTC+1) ja e segunda, 02:00: dia certo, hora
    // errada. Continua fora, mas por outro motivo.
    expect(dentroDaJanela(COMERCIAL, instante, LISBOA)).toBe(false);
    // E as 09:00 de Lisboa desse mesmo dia esta dentro.
    expect(
      dentroDaJanela(COMERCIAL, new Date("2026-09-07T08:00:00.000Z"), LISBOA),
    ).toBe(true);
  });

  it("o mesmo instante pode estar dentro num fuso e fora noutro", () => {
    // 2026-09-01T23:30Z: terca 20:30 em Fortaleza (fora) e quarta 00:30 em
    // Lisboa (fora tambem, por hora). Ja 2026-09-01T10:30Z e 07:30 em
    // Fortaleza (fora, cedo demais) e 11:30 em Lisboa (dentro).
    const cedo = new Date("2026-09-01T10:30:00.000Z");
    expect(dentroDaJanela(COMERCIAL, cedo, FORTALEZA)).toBe(false);
    expect(dentroDaJanela(COMERCIAL, cedo, LISBOA)).toBe(true);
  });

  it("dia da semana fora da lista bloqueia mesmo em horario bom", () => {
    // 2026-09-05 e sabado; 15:00Z = 12:00 local.
    expect(
      dentroDaJanela(COMERCIAL, new Date("2026-09-05T15:00:00.000Z"), FORTALEZA),
    ).toBe(false);
    expect(
      dentroDaJanela(
        { ...COMERCIAL, diasDaSemana: [1, 2, 3, 4, 5, 6] },
        new Date("2026-09-05T15:00:00.000Z"),
        FORTALEZA,
      ),
    ).toBe(true);
  });
});

describe("proximaAbertura", () => {
  it("dentro da janela devolve o proprio instante", () => {
    const agora = new Date("2026-09-01T13:00:00.000Z"); // terca, 10:00 local
    expect(proximaAbertura(COMERCIAL, agora, FORTALEZA)).toEqual(agora);
  });

  it("cedo demais no mesmo dia espera a abertura de hoje", () => {
    const agora = new Date("2026-09-01T09:00:00.000Z"); // terca, 06:00 local
    const abertura = proximaAbertura(COMERCIAL, agora, FORTALEZA);
    expect(abertura?.toISOString()).toBe("2026-09-01T11:00:00.000Z");
  });

  it("depois do fechamento pula para a abertura do dia seguinte", () => {
    const agora = new Date("2026-09-01T23:00:00.000Z"); // terca, 20:00 local
    const abertura = proximaAbertura(COMERCIAL, agora, FORTALEZA);
    expect(abertura?.toISOString()).toBe("2026-09-02T11:00:00.000Z");
  });

  it("domingo fora da janela cai na segunda, nao no proprio domingo", () => {
    // 2026-09-06 e domingo. 12:00Z = 09:00 local, horario bom, dia errado.
    const domingo = new Date("2026-09-06T12:00:00.000Z");
    const abertura = proximaAbertura(COMERCIAL, domingo, FORTALEZA);
    expect(abertura?.toISOString()).toBe("2026-09-07T11:00:00.000Z");
    expect(
      abertura ? dentroDaJanela(COMERCIAL, abertura, FORTALEZA) : false,
    ).toBe(true);
  });

  it("sexta a noite atravessa o fim de semana inteiro", () => {
    // 2026-09-04 e sexta; 23:00Z = 20:00 local, ja fechado.
    const sextaTarde = new Date("2026-09-04T23:00:00.000Z");
    const abertura = proximaAbertura(COMERCIAL, sextaTarde, FORTALEZA);
    expect(abertura?.toISOString()).toBe("2026-09-07T11:00:00.000Z");
  });

  it("respeita o fuso da clinica, nao o do servidor", () => {
    const janela: JanelaDeEnvio = {
      inicio: "09:00",
      fim: "17:00",
      diasDaSemana: [1, 2, 3, 4, 5],
    };
    const agora = new Date("2026-09-01T02:00:00.000Z"); // terca de madrugada
    expect(proximaAbertura(janela, agora, FORTALEZA)?.toISOString()).toBe(
      "2026-09-01T12:00:00.000Z", // 09:00 de Fortaleza
    );
    expect(proximaAbertura(janela, agora, LISBOA)?.toISOString()).toBe(
      "2026-09-01T08:00:00.000Z", // 09:00 de Lisboa (UTC+1 no verao)
    );
  });

  it("cada fuso de clinica e resolvido pela base de fusos, nao por offset fixo", () => {
    // Fevereiro de 2026: Sao Paulo nao adota horario de verao, entao coincide
    // com Fortaleza. A expectativa fica escrita para o dia em que a regra
    // mudar: o teste quebra em vez de a mensagem sair na hora errada.
    const janela: JanelaDeEnvio = {
      inicio: "08:00",
      fim: "18:00",
      diasDaSemana: [1, 2, 3, 4, 5],
    };
    const agora = new Date("2026-02-02T03:00:00.000Z"); // segunda, 00:00 local
    expect(proximaAbertura(janela, agora, SAO_PAULO)?.toISOString()).toBe(
      "2026-02-02T11:00:00.000Z",
    );
    expect(proximaAbertura(janela, agora, FORTALEZA)?.toISOString()).toBe(
      "2026-02-02T11:00:00.000Z",
    );
  });

  it("janela invalida devolve null, nunca um horario inventado", () => {
    const agora = new Date("2026-09-01T13:00:00.000Z");
    expect(
      proximaAbertura(
        { inicio: null, fim: null, diasDaSemana: null },
        agora,
        FORTALEZA,
      ),
    ).toBeNull();
    // Fim antes do inicio: o banco recusa (janela_coerente) e aqui tambem.
    expect(
      proximaAbertura(
        { inicio: "18:00", fim: "08:00", diasDaSemana: [1] },
        agora,
        FORTALEZA,
      ),
    ).toBeNull();
    // Lista de dias sem nenhum dia valido nao acha abertura em 8 dias.
    expect(
      proximaAbertura(
        { inicio: "08:00", fim: "18:00", diasDaSemana: [9] },
        agora,
        FORTALEZA,
      ),
    ).toBeNull();
  });
});

describe("passoCondizComAgenda", () => {
  const startsAt = new Date("2026-09-10T14:00:00.000Z");

  it("aceita o toque planejado para starts_at mais o offset", () => {
    expect(
      passoCondizComAgenda({
        startsAt,
        offsetMinutes: -1440,
        scheduledFor: new Date("2026-09-09T14:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("tolera um minuto de diferenca (arredondamento de timestamp)", () => {
    expect(
      passoCondizComAgenda({
        startsAt,
        offsetMinutes: -180,
        scheduledFor: new Date("2026-09-10T11:00:30.000Z"),
      }),
    ).toBe(true);
  });

  it("consulta remarcada invalida a run velha", () => {
    // A run foi planejada para a consulta das 14:00; ela foi movida para as
    // 16:00. O toque velho nao pode sair: o planner ja criou outro.
    expect(
      passoCondizComAgenda({
        startsAt: new Date("2026-09-10T16:00:00.000Z"),
        offsetMinutes: -180,
        scheduledFor: new Date("2026-09-10T11:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("offset positivo (pos falta) tambem e conferido", () => {
    const marcadaEm = new Date("2026-09-10T18:30:00.000Z");
    expect(
      passoCondizComAgenda({
        startsAt: marcadaEm,
        offsetMinutes: 2880,
        scheduledFor: new Date("2026-09-12T18:30:00.000Z"),
      }),
    ).toBe(true);
  });
});

// A escolha do passo no toque MANUAL ("Cobrar agora", Tela 2). Um numero
// errado aqui manda a mensagem de "amanha" para quem tem consulta hoje.
describe("passoMaisProximoDoEvento", () => {
  const PASSOS = [
    { id: "72h", offsetMinutes: -4320 },
    { id: "24h", offsetMinutes: -1440 },
    { id: "3h", offsetMinutes: -180 },
  ];

  it("consulta daqui a 2 horas escolhe o passo de 3 horas antes", () => {
    expect(passoMaisProximoDoEvento(PASSOS, 120)?.id).toBe("3h");
  });

  it("consulta amanha escolhe o passo de 24 horas antes", () => {
    expect(passoMaisProximoDoEvento(PASSOS, 20 * 60)?.id).toBe("24h");
  });

  it("consulta daqui a tres dias escolhe o passo de 72 horas antes", () => {
    expect(passoMaisProximoDoEvento(PASSOS, 70 * 60)?.id).toBe("72h");
  });

  it("passo de pos falta (offset positivo) nunca e escolhido", () => {
    expect(
      passoMaisProximoDoEvento([{ id: "d2", offsetMinutes: 2880 }], 60),
    ).toBeNull();
  });

  it("sem passo nenhum devolve null", () => {
    expect(passoMaisProximoDoEvento([], 60)).toBeNull();
  });
});
