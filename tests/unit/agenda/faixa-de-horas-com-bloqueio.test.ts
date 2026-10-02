import { describe, expect, it } from "vitest";

import {
  bloqueiosRecortadosNoDia,
  faixaNaGrade,
} from "@/components/agenda/bloqueio-comum";
import { instanteLocal, somarDias } from "@/lib/domain/horarios";
import { faixaDeHorasVisivel } from "@/lib/domain/scheduling";

// Revisao de 02/10/2026 (agenda-bloqueio 0): com jornada das 08:00 as 18:00 a
// grade ia das 07:00 as 19:00, e o bloqueio das 19:00 as 21:00 nao era
// desenhado (faixaNaGrade devolvia null). Sem a aba Bloqueios em Cadastros,
// ninguem mais via nem removia esse bloqueio, que seguia recusando encaixe.
// Agora a faixa estica com o bloqueio que ficaria INTEIRO fora dela; o que
// cruza a faixa ja aparece recortado, e o dia inteiro ou ferias nao viram
// grade de 24 horas. America/Fortaleza = UTC-3 fixo.

const TZ = "America/Fortaleza";
const DIA = "2026-10-06"; // terca-feira
const JORNADA = [{ startsAt: "08:00", endsAt: "18:00" }];

const em = (hora: string, dia = DIA) => instanteLocal(TZ, dia, hora);
const iso = (hora: string, dia = DIA) => em(hora, dia).toISOString();

/** Bloqueio gravado (como vem do banco) ja recortado no dia exibido. */
function recortados(
  bloqueios: { starts_at: string; ends_at: string }[],
  dia = DIA,
) {
  return bloqueiosRecortadosNoDia(bloqueios, TZ, dia);
}

describe("faixaDeHorasVisivel com bloqueios", () => {
  it("jornada de 08:00 às 18:00 e bloqueio das 19:00 às 21:00: a faixa vai até 21", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados([
          { starts_at: iso("19:00"), ends_at: iso("21:00") },
        ]),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 21 });
  });

  it("dois bloqueios fora da faixa esticam igual em qualquer ordem", () => {
    const a = { starts_at: iso("19:00"), ends_at: iso("21:00") };
    const b = { starts_at: iso("20:00"), ends_at: iso("23:00") };
    for (const ordem of [
      [a, b],
      [b, a],
    ]) {
      expect(
        faixaDeHorasVisivel({
          timezone: TZ,
          jornadas: JORNADA,
          consultas: [],
          bloqueios: recortados(ordem),
        }),
      ).toEqual({ horaInicio: 7, horaFim: 23 });
    }
  });

  it("bloqueio de dia inteiro mantém a faixa da jornada (7 a 19)", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados([
          {
            starts_at: iso("00:00"),
            ends_at: iso("00:00", somarDias(DIA, 1)),
          },
        ]),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 19 });
  });

  it("férias de vários dias, recortadas no dia, também não viram grade de 24 horas", () => {
    const ferias = [
      {
        starts_at: iso("00:00", somarDias(DIA, -3)),
        ends_at: iso("00:00", somarDias(DIA, 4)),
      },
    ];
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados(ferias),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 19 });
  });

  it("bloqueio que cruza a faixa não estica: aparece recortado", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados([
          { starts_at: iso("17:00"), ends_at: iso("21:00") },
        ]),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 19 });
  });

  it("bloqueio da madrugada antes da faixa puxa o início para trás", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados([
          { starts_at: iso("05:30"), ends_at: iso("06:15") },
        ]),
      }),
    ).toEqual({ horaInicio: 5, horaFim: 19 });
  });

  it("bloqueio que encosta no fim da faixa conta como fora dela", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados([
          { starts_at: iso("19:00"), ends_at: iso("19:30") },
        ]),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 20 });
  });

  it("até a meia-noite vai até 24:00 (o recorte termina às 00:00 do dia seguinte)", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [],
        bloqueios: recortados([
          {
            starts_at: iso("20:00"),
            ends_at: iso("02:00", somarDias(DIA, 1)),
          },
        ]),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 24 });
  });

  it("conta a faixa já esticada pelas consultas: o bloqueio que cai nela não estica de novo", () => {
    expect(
      faixaDeHorasVisivel({
        timezone: TZ,
        jornadas: JORNADA,
        consultas: [{ startsAt: em("19:00"), endsAt: em("20:30") }],
        bloqueios: recortados([
          { starts_at: iso("20:00"), ends_at: iso("23:00") },
        ]),
      }),
    ).toEqual({ horaInicio: 7, horaFim: 21 });
  });

  it("sem bloqueios, a faixa é a de antes", () => {
    expect(
      faixaDeHorasVisivel({ timezone: TZ, jornadas: JORNADA, consultas: [] }),
    ).toEqual({ horaInicio: 7, horaFim: 19 });
  });

  it("depois de esticar, a faixa do bloqueio é desenhada (antes era null)", () => {
    const bloqueio = { starts_at: iso("19:00"), ends_at: iso("21:00") };
    const { horaInicio, horaFim } = faixaDeHorasVisivel({
      timezone: TZ,
      jornadas: JORNADA,
      consultas: [],
      bloqueios: recortados([bloqueio]),
    });
    const inicioVisivel = em(`${String(horaInicio).padStart(2, "0")}:00`);
    expect(
      faixaNaGrade({
        inicio: new Date(bloqueio.starts_at),
        fim: new Date(bloqueio.ends_at),
        inicioVisivel,
        alturaHoraPx: 96,
        alturaTotal: (horaFim - horaInicio) * 96,
      }),
    ).toEqual({ top: 12 * 96, height: 2 * 96 });
  });
});

describe("bloqueiosRecortadosNoDia", () => {
  it("recorta no dia civil da clínica (de 00:00 a 00:00 do dia seguinte)", () => {
    expect(
      recortados([
        {
          starts_at: iso("22:00", somarDias(DIA, -1)),
          ends_at: iso("06:00"),
        },
      ]),
    ).toEqual([{ startsAt: em("00:00"), endsAt: em("06:00") }]);
  });

  it("mantém o bloqueio que cabe no dia como está", () => {
    expect(
      recortados([{ starts_at: iso("14:00"), ends_at: iso("18:00") }]),
    ).toEqual([{ startsAt: em("14:00"), endsAt: em("18:00") }]);
  });

  it("tira da lista o que não toca o dia", () => {
    expect(
      recortados([
        {
          starts_at: iso("20:00", somarDias(DIA, -1)),
          ends_at: iso("00:00"),
        },
        {
          starts_at: iso("00:00", somarDias(DIA, 1)),
          ends_at: iso("08:00", somarDias(DIA, 1)),
        },
      ]),
    ).toEqual([]);
  });

  it("usa o fuso da clínica, nunca o do navegador", () => {
    // 02:00 UTC do dia 7 ainda é 23:00 do dia 6 em Fortaleza.
    expect(
      recortados([
        {
          starts_at: "2026-10-07T01:00:00.000Z",
          ends_at: "2026-10-07T05:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        startsAt: new Date("2026-10-07T01:00:00.000Z"),
        endsAt: new Date("2026-10-07T03:00:00.000Z"),
      },
    ]);
  });
});
