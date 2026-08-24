import { describe, expect, it } from "vitest";

import {
  availableSlots,
  firstAvailableSlots,
  type EntradaDisponibilidade,
} from "@/lib/domain/scheduling";
import { instanteLocal } from "@/lib/domain/horarios";

// Aceite da tarefa 2.4: virada de dia, intervalo de almoco, bloqueio parcial,
// hold expirado, recurso ocupado. America/Fortaleza = UTC-3 fixo (sem horario
// de verao), entao 08:00 local = 11:00Z.

const TZ = "America/Fortaleza";
const DIA = "2026-09-01"; // uma terca-feira
const WEEKDAY_TERCA = 2;

function base(
  extras: Partial<EntradaDisponibilidade> = {},
): EntradaDisponibilidade {
  return {
    timezone: TZ,
    rangeStart: instanteLocal(TZ, DIA, "00:00"),
    rangeEnd: instanteLocal(TZ, DIA, "23:59"),
    durationMin: 30,
    schedule: [{ weekday: WEEKDAY_TERCA, startsAt: "08:00", endsAt: "12:00" }],
    blocks: [],
    appointments: [],
    holds: [],
    now: instanteLocal(TZ, DIA, "00:00"),
    ...extras,
  };
}

function horas(slots: { startsAt: Date }[]): string[] {
  return slots.map((s) =>
    s.startsAt.toLocaleTimeString("pt-BR", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
}

describe("jornada e fuso", () => {
  it("08:00 local de Fortaleza é 11:00Z e a grade sai alinhada", () => {
    const slots = availableSlots(base());
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-09-01T11:00:00.000Z");
    // 08:00 as 12:00, 30 min de duracao, grade de 15: ultimo inicio 11:30.
    expect(horas(slots)[0]).toBe("08:00");
    expect(horas(slots).at(-1)).toBe("11:30");
    expect(slots).toHaveLength(15);
  });

  it("dia sem jornada não oferece nada", () => {
    const slots = availableSlots(
      base({ schedule: [{ weekday: 5, startsAt: "08:00", endsAt: "12:00" }] }),
    );
    expect(slots).toHaveLength(0);
  });

  it("funciona em outro fuso (Manaus, UTC-4)", () => {
    const slots = availableSlots({
      ...base(),
      timezone: "America/Manaus",
      rangeStart: instanteLocal("America/Manaus", DIA, "00:00"),
      rangeEnd: instanteLocal("America/Manaus", DIA, "23:59"),
      now: instanteLocal("America/Manaus", DIA, "00:00"),
    });
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });
});

describe("almoço = duas faixas no mesmo dia", () => {
  it("a lacuna entre as faixas não gera slot", () => {
    const slots = availableSlots(
      base({
        schedule: [
          { weekday: WEEKDAY_TERCA, startsAt: "08:00", endsAt: "12:00" },
          { weekday: WEEKDAY_TERCA, startsAt: "14:00", endsAt: "18:00" },
        ],
      }),
    );
    const inicios = horas(slots);
    expect(inicios).toContain("11:30");
    expect(inicios).not.toContain("12:00");
    expect(inicios).not.toContain("13:30");
    expect(inicios).toContain("14:00");
  });
});

describe("virada de dia", () => {
  it("plantão 22:00 às 02:00 atravessa a meia-noite", () => {
    const slots = availableSlots(
      base({
        schedule: [
          { weekday: WEEKDAY_TERCA, startsAt: "22:00", endsAt: "02:00" },
        ],
        rangeStart: instanteLocal(TZ, DIA, "20:00"),
        rangeEnd: instanteLocal(TZ, "2026-09-02", "06:00"),
        now: instanteLocal(TZ, DIA, "20:00"),
      }),
    );
    const inicios = horas(slots);
    expect(inicios[0]).toBe("22:00");
    // O ultimo atendimento de 30 min comeca a 01:30 do dia seguinte.
    expect(inicios.at(-1)).toBe("01:30");
    expect(slots.at(-1)?.startsAt.toISOString()).toBe(
      "2026-09-02T04:30:00.000Z",
    );
  });

  it("a jornada da véspera invade o começo do range", () => {
    // Range comeca a meia-noite de quarta; a jornada de TERCA 22:00-02:00
    // ainda oferece 00:00-02:00 de quarta.
    const slots = availableSlots(
      base({
        schedule: [
          { weekday: WEEKDAY_TERCA, startsAt: "22:00", endsAt: "02:00" },
        ],
        rangeStart: instanteLocal(TZ, "2026-09-02", "00:00"),
        rangeEnd: instanteLocal(TZ, "2026-09-02", "12:00"),
        now: instanteLocal(TZ, "2026-09-02", "00:00"),
      }),
    );
    expect(horas(slots)[0]).toBe("00:00");
    expect(horas(slots).at(-1)).toBe("01:30");
  });
});

describe("ocupações", () => {
  it("bloqueio parcial recorta a janela", () => {
    const slots = availableSlots(
      base({
        blocks: [
          {
            startsAt: instanteLocal(TZ, DIA, "09:00"),
            endsAt: instanteLocal(TZ, DIA, "10:00"),
          },
        ],
      }),
    );
    const inicios = horas(slots);
    expect(inicios).toContain("08:30");
    expect(inicios).not.toContain("09:00");
    expect(inicios).not.toContain("09:45");
    expect(inicios).toContain("10:00");
    // 08:30 nao cabe? cabe: 08:30+30=09:00, encosta no bloqueio (range
    // semiaberto). 08:45 NAO cabe (invade).
    expect(inicios).not.toContain("08:45");
  });

  it("consulta existente e encaixe ocupam de verdade", () => {
    const slots = availableSlots(
      base({
        appointments: [
          {
            startsAt: instanteLocal(TZ, DIA, "08:00"),
            endsAt: instanteLocal(TZ, DIA, "08:40"),
          },
        ],
      }),
    );
    expect(horas(slots)[0]).toBe("08:45");
  });

  it("hold ativo bloqueia; a lista sem o hold expirado libera", () => {
    const hold = {
      startsAt: instanteLocal(TZ, DIA, "08:00"),
      endsAt: instanteLocal(TZ, DIA, "08:30"),
    };
    const comHold = availableSlots(base({ holds: [hold] }));
    expect(horas(comHold)[0]).toBe("08:30");
    // O chamador filtra expires_at > agora: hold expirado simplesmente nao
    // entra na lista, e o horario volta.
    const semHold = availableSlots(base({ holds: [] }));
    expect(horas(semHold)[0]).toBe("08:00");
  });

  it("recurso ocupado bloqueia mesmo com o profissional livre", () => {
    const slots = availableSlots(
      base({
        resourceBusy: [
          {
            startsAt: instanteLocal(TZ, DIA, "08:00"),
            endsAt: instanteLocal(TZ, DIA, "09:00"),
          },
        ],
      }),
    );
    expect(horas(slots)[0]).toBe("09:00");
  });
});

describe("duração do vínculo e grade", () => {
  it("a duração do vínculo limita os últimos horários do dia", () => {
    const de60 = availableSlots(base({ durationMin: 60 }));
    expect(horas(de60).at(-1)).toBe("11:00");
    const de40 = availableSlots(base({ durationMin: 40 }));
    expect(horas(de40).at(-1)).toBe("11:15");
  });

  it("jornada começando fora da grade alinha para o próximo múltiplo", () => {
    const slots = availableSlots(
      base({
        schedule: [
          { weekday: WEEKDAY_TERCA, startsAt: "08:10", endsAt: "10:00" },
        ],
      }),
    );
    expect(horas(slots)[0]).toBe("08:15");
  });

  it("nada no passado: agora no meio da janela corta os anteriores", () => {
    const slots = availableSlots(
      base({ now: instanteLocal(TZ, DIA, "10:07") }),
    );
    expect(horas(slots)[0]).toBe("10:15");
  });
});

describe("os 3 primeiros (botões do modal)", () => {
  it("devolve exatamente os primeiros N", () => {
    const tres = firstAvailableSlots(base(), 3);
    expect(horas(tres)).toEqual(["08:00", "08:15", "08:30"]);
  });
});
