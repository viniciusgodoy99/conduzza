import { describe, expect, it } from "vitest";

import {
  diaCivil,
  diasCivisNoRange,
  horaParaMinutos,
  instanteLocal,
  limitesDoDia,
  minutosLocais,
  minutosParaHora,
  somarDias,
  weekdayLocal,
} from "@/lib/domain/horarios";

const TZ = "America/Fortaleza"; // UTC-3 fixo

describe("conversões de hora", () => {
  it("HH:MM para minutos e volta", () => {
    expect(horaParaMinutos("08:30")).toBe(510);
    expect(horaParaMinutos("00:00")).toBe(0);
    expect(horaParaMinutos("23:45:00")).toBe(1425);
    expect(minutosParaHora(510)).toBe("08:30");
    expect(minutosParaHora(0)).toBe("00:00");
  });
});

describe("instante local", () => {
  it("08:00 de Fortaleza é 11:00Z", () => {
    expect(instanteLocal(TZ, "2026-09-01", "08:00").toISOString()).toBe(
      "2026-09-01T11:00:00.000Z",
    );
  });

  it("meia-noite local do dia seguinte fecha o dia", () => {
    const { inicio, fim } = limitesDoDia(TZ, "2026-09-01");
    expect(inicio.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-09-02T03:00:00.000Z");
  });
});

describe("dia civil e weekday no fuso", () => {
  it("01:00Z ainda é o dia anterior em Fortaleza", () => {
    const instante = new Date("2026-09-02T01:00:00.000Z"); // 22:00 do dia 1 local
    expect(diaCivil(TZ, instante)).toBe("2026-09-01");
    expect(weekdayLocal(TZ, instante)).toBe(2); // terca
    expect(minutosLocais(TZ, instante)).toBe(22 * 60);
  });

  it("somarDias atravessa mês e ano", () => {
    expect(somarDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("diasCivisNoRange inclui a véspera (jornada que vira o dia)", () => {
    const dias = diasCivisNoRange(
      TZ,
      instanteLocal(TZ, "2026-09-01", "00:00"),
      instanteLocal(TZ, "2026-09-02", "00:00"),
    );
    expect(dias).toEqual(["2026-08-31", "2026-09-01"]);
  });
});
