import { describe, expect, it, vi } from "vitest";

import { availableSlots } from "@/lib/domain/scheduling";

// A Agenda manual oferecia horarios de 15 em 15 minutos mesmo com a grade
// do medico em 30 (relato de 10/11/2026): o modal nao passava a grade do
// Cadastro ao motor de horarios. Agora passa, como a IA (buscar_horario).

vi.mock("@/app/(app)/agenda/actions", () => ({}));
vi.mock("@/app/(app)/leads/actions", () => ({}));

const { gradeDoProfissional } =
  await import("@/components/agenda/agendamento-modal");

const FUSO = "America/Fortaleza";
// Quarta, 11/11/2026, jornada das 08:00 as 10:00 em Fortaleza (UTC-3).
const DIA = {
  inicio: new Date("2026-11-11T03:00:00Z"),
  fim: new Date("2026-11-12T03:00:00Z"),
};

function inicios(grade: number | null): string[] {
  return availableSlots({
    ...gradeDoProfissional({ grade_minutos: grade }),
    timezone: FUSO,
    rangeStart: DIA.inicio,
    rangeEnd: DIA.fim,
    durationMin: 30,
    schedule: [{ weekday: 3, startsAt: "08:00", endsAt: "10:00" }],
    blocks: [],
    appointments: [],
    holds: [],
    now: new Date("2026-11-10T12:00:00Z"),
  }).map((s) =>
    s.startsAt.toLocaleTimeString("pt-BR", {
      timeZone: FUSO,
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
}

describe("gradeDoProfissional (Agenda manual)", () => {
  it("com a grade de 30 minutos, os horários saem de 30 em 30", () => {
    expect(inicios(30)).toEqual(["08:00", "08:30", "09:00", "09:30"]);
  });

  it("sem grade, continua de 15 em 15", () => {
    expect(inicios(null)).toEqual([
      "08:00",
      "08:15",
      "08:30",
      "08:45",
      "09:00",
      "09:15",
      "09:30",
    ]);
  });
});
