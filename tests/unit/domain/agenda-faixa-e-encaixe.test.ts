import { describe, expect, it } from "vitest";

import { instanteLocal } from "@/lib/domain/horarios";
import {
  conferirEncaixe,
  faixaDeHorasVisivel,
  type JanelaSemanal,
} from "@/lib/domain/scheduling";

// Achados 82 e 89 da revisao de liberacao: a faixa de horas da grade vem das
// jornadas e se estica para caber toda consulta (encaixe fora do expediente
// inclusive), e o encaixe proposital passa por cima de jornada, consulta e
// bloqueio comum, mas nunca de bloqueio que impede encaixe nem de recurso.
// America/Fortaleza = UTC-3 fixo.

const TZ = "America/Fortaleza";
const DIA = "2026-09-01"; // terca-feira
const TERCA = 2;

const em = (hora: string) => instanteLocal(TZ, DIA, hora);

describe("faixaDeHorasVisivel", () => {
  it("sem jornada e sem consulta, vale a faixa padrão", () => {
    expect(
      faixaDeHorasVisivel({ timezone: TZ, jornadas: [], consultas: [] }),
    ).toEqual({ horaInicio: 7, horaFim: 19 });
  });

  it("jornada de 08:00 às 12:00 ganha 1 hora de folga de cada lado", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: [{ startsAt: "08:00", endsAt: "12:00" }],
        consultas: [],
      }),
    ).toEqual({ horaInicio: 7, horaFim: 13 });
  });

  it("jornada até 21:00 não corta o fim da tarde (Semana, achado 89)", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: [
          { startsAt: "09:00", endsAt: "12:00" },
          { startsAt: "14:00:00", endsAt: "21:00:00" },
        ],
        consultas: [],
      }),
    ).toEqual({ horaInicio: 8, horaFim: 22 });
  });

  it("encaixe fora do expediente estica a faixa para aparecer", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: [{ startsAt: "08:00", endsAt: "12:00" }],
        consultas: [{ startsAt: em("18:30"), endsAt: em("19:10") }],
      }),
    ).toEqual({ horaInicio: 7, horaFim: 20 });
  });

  it("jornada que vira o dia vai até 24:00", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: [{ startsAt: "22:00", endsAt: "02:00" }],
        consultas: [],
      }),
    ).toEqual({ horaInicio: 21, horaFim: 24 });
  });

  it("consulta cedo sem jornada no dia puxa o início para trás", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: [],
        consultas: [{ startsAt: em("05:45"), endsAt: em("06:15") }],
      }),
    ).toEqual({ horaInicio: 5, horaFim: 19 });
  });
});

describe("conferirEncaixe", () => {
  const jornada: JanelaSemanal[] = [
    { weekday: TERCA, startsAt: "08:00", endsAt: "12:00" },
  ];
  const agora = em("00:00");

  it("dentro da jornada e sem nada no caminho, nada a avisar", () => {
    expect(
      conferirEncaixe({
        timezone: TZ,
        jornada,
        inicio: em("09:00"),
        fim: em("09:30"),
        bloqueios: [],
        consultas: [],
        agora,
      }),
    ).toEqual({
      bloqueadoSemEncaixe: false,
      recursoOcupado: false,
      foraDaJornada: false,
      sobreConsulta: false,
      sobreBloqueio: false,
      noPassado: false,
    });
  });

  it("em cima de consulta e fora da jornada só avisa", () => {
    const resultado = conferirEncaixe({
      timezone: TZ,
      jornada,
      inicio: em("11:45"),
      fim: em("12:15"),
      bloqueios: [],
      consultas: [{ startsAt: em("11:30"), endsAt: em("12:00") }],
      agora,
    });
    expect(resultado.sobreConsulta).toBe(true);
    expect(resultado.foraDaJornada).toBe(true);
    expect(resultado.bloqueadoSemEncaixe).toBe(false);
  });

  it("bloqueio que impede encaixe barra; bloqueio comum só avisa", () => {
    const bloqueios = [
      { startsAt: em("09:00"), endsAt: em("10:00"), impedeEncaixe: true },
      { startsAt: em("10:00"), endsAt: em("11:00"), impedeEncaixe: false },
    ];
    const noImpeditivo = conferirEncaixe({
      timezone: TZ,
      jornada,
      inicio: em("09:30"),
      fim: em("10:00"),
      bloqueios,
      consultas: [],
      agora,
    });
    expect(noImpeditivo.bloqueadoSemEncaixe).toBe(true);
    expect(noImpeditivo.sobreBloqueio).toBe(false);

    const noComum = conferirEncaixe({
      timezone: TZ,
      jornada,
      inicio: em("10:00"),
      fim: em("10:30"),
      bloqueios,
      consultas: [],
      agora,
    });
    expect(noComum.bloqueadoSemEncaixe).toBe(false);
    expect(noComum.sobreBloqueio).toBe(true);
  });

  it("recurso ocupado barra o encaixe", () => {
    expect(
      conferirEncaixe({
        timezone: TZ,
        jornada,
        inicio: em("09:00"),
        fim: em("09:30"),
        bloqueios: [],
        consultas: [],
        recursoOcupado: [{ startsAt: em("09:15"), endsAt: em("09:45") }],
        agora,
      }).recursoOcupado,
    ).toBe(true);
  });

  it("intervalo que só encosta não conta como sobreposição", () => {
    const resultado = conferirEncaixe({
      timezone: TZ,
      jornada,
      inicio: em("09:30"),
      fim: em("10:00"),
      bloqueios: [
        { startsAt: em("10:00"), endsAt: em("11:00"), impedeEncaixe: true },
      ],
      consultas: [{ startsAt: em("09:00"), endsAt: em("09:30") }],
      agora,
    });
    expect(resultado.bloqueadoSemEncaixe).toBe(false);
    expect(resultado.sobreConsulta).toBe(false);
  });

  it("sem jornada nenhuma é sempre fora da jornada; horário vencido avisa", () => {
    const resultado = conferirEncaixe({
      timezone: TZ,
      jornada: [],
      inicio: em("09:00"),
      fim: em("09:30"),
      bloqueios: [],
      consultas: [],
      agora: em("10:00"),
    });
    expect(resultado.foraDaJornada).toBe(true);
    expect(resultado.noPassado).toBe(true);
  });
});
