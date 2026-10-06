import { describe, expect, it } from "vitest";

import { somarDias, somarMeses } from "@/lib/domain/horarios";

// somarMeses prende o dia ao ultimo dia do mes de chegada, como o Postgres
// faz em date + interval 'N months' (o teto de 1 ano do gatilho da mensagem
// agendada). A tela e o banco precisam dar o MESMO dia.

describe("somarMeses (dia civil, sem fuso)", () => {
  it("31/01 + 1 mês prende no fim de fevereiro", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("31/03 + 6 meses = 30/09", () => {
    expect(somarMeses("2026-03-31", 6)).toBe("2026-09-30");
  });

  it("29/02/2028 + 12 meses = 28/02/2029", () => {
    expect(somarMeses("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("dia que existe no mês de chegada fica igual", () => {
    expect(somarMeses("2026-10-06", 12)).toBe("2027-10-06");
    expect(somarMeses("2026-10-06", 3)).toBe("2027-01-06");
    expect(somarMeses("2026-10-06", 0)).toBe("2026-10-06");
  });

  it("atravessa o ano e aceita meses negativos", () => {
    expect(somarMeses("2026-11-15", 3)).toBe("2027-02-15");
    expect(somarMeses("2026-12-31", 2)).toBe("2027-02-28");
    expect(somarMeses("2026-03-31", -1)).toBe("2026-02-28");
    expect(somarMeses("2027-01-15", -1)).toBe("2026-12-15");
  });

  it("não mexe no somarDias que já existia", () => {
    expect(somarDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});
