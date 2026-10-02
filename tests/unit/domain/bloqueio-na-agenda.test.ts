import { describe, expect, it } from "vitest";

import {
  bloqueiosQueCruzam,
  dataFimAoMudarInicio,
  descreverPeriodoDoBloqueio,
  faixaNaGrade,
  horarioDoVao,
  periodoDoBloqueio,
  type PeriodoDoFormulario,
} from "@/components/agenda/bloqueio-comum";
import { instanteLocal } from "@/lib/domain/horarios";

// "Bloquear horario" na Agenda (decisao do dono de 29/09/2026): o periodo
// digitado e lido no fuso da clinica (regra 3.6), "Dia inteiro" cobre o
// ultimo dia todo, o periodo gravado vira texto de recepcionista e a faixa
// hachurada e recortada na parte visivel da grade.
// America/Fortaleza = UTC-3 fixo; Europe/Lisbon (UTC+1 no fim de setembro)
// prova que o calculo usa o fuso da clinica de verdade.

const TZ = "America/Fortaleza";

function periodo(parcial: Partial<PeriodoDoFormulario>): PeriodoDoFormulario {
  return {
    diaInteiro: false,
    dataInicio: "2026-09-30",
    horaInicio: "14:00",
    dataFim: "2026-09-30",
    horaFim: "18:00",
    ...parcial,
  };
}

describe("periodoDoBloqueio", () => {
  it("lê data e hora no fuso da clínica, nunca no do navegador", () => {
    const resultado = periodoDoBloqueio(periodo({}), TZ);
    expect(resultado).toEqual({
      ok: true,
      inicio: new Date("2026-09-30T17:00:00.000Z"),
      fim: new Date("2026-09-30T21:00:00.000Z"),
    });
  });

  it("respeita o fuso de uma clínica que não é de Fortaleza", () => {
    const resultado = periodoDoBloqueio(periodo({}), "Europe/Lisbon");
    // 30/09 em Lisboa ainda e horario de verao (UTC+1).
    expect(resultado).toEqual({
      ok: true,
      inicio: new Date("2026-09-30T13:00:00.000Z"),
      fim: new Date("2026-09-30T17:00:00.000Z"),
    });
  });

  it("dia inteiro vai de 00:00 do primeiro dia a 00:00 do dia seguinte ao último", () => {
    const resultado = periodoDoBloqueio(
      periodo({
        diaInteiro: true,
        dataInicio: "2026-09-30",
        dataFim: "2026-10-02",
        horaInicio: "",
        horaFim: "",
      }),
      TZ,
    );
    expect(resultado).toEqual({
      ok: true,
      inicio: instanteLocal(TZ, "2026-09-30", "00:00"),
      fim: instanteLocal(TZ, "2026-10-03", "00:00"),
    });
  });

  it("dia inteiro de um dia só cobre as 24 horas dele", () => {
    const resultado = periodoDoBloqueio(
      periodo({ diaInteiro: true, horaInicio: "", horaFim: "" }),
      TZ,
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.fim.getTime() - resultado.inicio.getTime()).toBe(
        24 * 60 * 60_000,
      );
    }
  });

  it("recusa o último dia antes do primeiro", () => {
    expect(
      periodoDoBloqueio(
        periodo({
          diaInteiro: true,
          dataInicio: "2026-10-02",
          dataFim: "2026-09-30",
        }),
        TZ,
      ),
    ).toEqual({
      ok: false,
      erro: "O último dia precisa ser o mesmo ou depois do primeiro.",
    });
  });

  it("recusa fim igual ou antes do início", () => {
    const erro = {
      ok: false,
      erro: "O fim do bloqueio precisa ser depois do início.",
    };
    expect(periodoDoBloqueio(periodo({ horaFim: "14:00" }), TZ)).toEqual(erro);
    expect(periodoDoBloqueio(periodo({ horaFim: "13:30" }), TZ)).toEqual(erro);
  });

  it("aceita fim no dia seguinte (atravessa a meia-noite)", () => {
    const resultado = periodoDoBloqueio(
      periodo({ horaInicio: "22:00", dataFim: "2026-10-01", horaFim: "02:00" }),
      TZ,
    );
    expect(resultado).toEqual({
      ok: true,
      inicio: new Date("2026-10-01T01:00:00.000Z"),
      fim: new Date("2026-10-01T05:00:00.000Z"),
    });
  });

  it("pede o período quando falta data ou hora", () => {
    const erro = { ok: false, erro: "Informe o início e o fim do bloqueio." };
    expect(periodoDoBloqueio(periodo({ horaInicio: "" }), TZ)).toEqual(erro);
    expect(periodoDoBloqueio(periodo({ horaFim: "" }), TZ)).toEqual(erro);
    expect(periodoDoBloqueio(periodo({ dataFim: "" }), TZ)).toEqual(erro);
    expect(
      periodoDoBloqueio(periodo({ diaInteiro: true, dataInicio: "" }), TZ),
    ).toEqual({
      ok: false,
      erro: "Informe o primeiro e o último dia do bloqueio.",
    });
  });

  it("aceita a hora com segundos que alguns navegadores devolvem", () => {
    expect(periodoDoBloqueio(periodo({ horaInicio: "14:00:00" }), TZ).ok).toBe(
      true,
    );
  });
});

describe("dataFimAoMudarInicio", () => {
  it("acompanha o início enquanto estava igual a ele", () => {
    expect(dataFimAoMudarInicio("2026-09-30", "2026-09-30", "2026-10-05")).toBe(
      "2026-10-05",
    );
  });

  it("mantém um fim escolhido que continua depois do início", () => {
    expect(dataFimAoMudarInicio("2026-09-30", "2026-10-10", "2026-10-05")).toBe(
      "2026-10-10",
    );
  });

  it("nunca deixa o fim antes do início", () => {
    expect(dataFimAoMudarInicio("2026-09-30", "2026-10-02", "2026-10-05")).toBe(
      "2026-10-05",
    );
  });

  it("preenche o fim vazio", () => {
    expect(dataFimAoMudarInicio("", "", "2026-10-05")).toBe("2026-10-05");
  });
});

describe("descreverPeriodoDoBloqueio", () => {
  const em = (dia: string, hora: string) =>
    instanteLocal(TZ, dia, hora).toISOString();

  it("mesmo dia: das HH:mm às HH:mm", () => {
    expect(
      descreverPeriodoDoBloqueio(
        em("2026-09-30", "14:00"),
        em("2026-09-30", "18:30"),
        TZ,
      ),
    ).toBe("30/09, das 14:00 às 18:30");
  });

  it("um dia inteiro", () => {
    expect(
      descreverPeriodoDoBloqueio(
        em("2026-09-30", "00:00"),
        em("2026-10-01", "00:00"),
        TZ,
      ),
    ).toBe("30/09, dia inteiro");
  });

  it("vários dias inteiros", () => {
    expect(
      descreverPeriodoDoBloqueio(
        em("2026-09-30", "00:00"),
        em("2026-10-06", "00:00"),
        TZ,
      ),
    ).toBe("30/09 a 05/10, dias inteiros");
  });

  it("até a meia-noite: até o fim do dia", () => {
    expect(
      descreverPeriodoDoBloqueio(
        em("2026-09-30", "14:00"),
        em("2026-10-01", "00:00"),
        TZ,
      ),
    ).toBe("30/09, das 14:00 até o fim do dia");
  });

  it("atravessando dias, com as horas", () => {
    expect(
      descreverPeriodoDoBloqueio(
        em("2026-09-30", "14:00"),
        em("2026-10-01", "18:00"),
        TZ,
      ),
    ).toBe("30/09 às 14:00 até 01/10 às 18:00");
  });

  it("escreve no fuso da clínica, não no UTC", () => {
    // 02:00 UTC do dia 01/10 ainda e 30/09 as 23:00 em Fortaleza.
    expect(
      descreverPeriodoDoBloqueio(
        "2026-10-01T01:00:00.000Z",
        "2026-10-01T02:00:00.000Z",
        TZ,
      ),
    ).toBe("30/09, das 22:00 às 23:00");
  });

  it("não usa travessão", () => {
    const texto = descreverPeriodoDoBloqueio(
      em("2026-09-30", "14:00"),
      em("2026-10-01", "18:00"),
      TZ,
    );
    expect(texto).not.toMatch(/[–—]/);
  });
});

describe("faixaNaGrade", () => {
  // Grade das 07:00 as 19:00 (12 horas de 96px).
  const inicioVisivel = instanteLocal(TZ, "2026-09-30", "07:00");
  const base = {
    inicioVisivel,
    alturaHoraPx: 96,
    alturaTotal: 12 * 96,
  };

  it("posiciona pelo minuto, na altura da hora", () => {
    expect(
      faixaNaGrade({
        ...base,
        inicio: instanteLocal(TZ, "2026-09-30", "12:00"),
        fim: instanteLocal(TZ, "2026-09-30", "13:30"),
      }),
    ).toEqual({ top: 5 * 96, height: 1.5 * 96 });
  });

  it("recorta o bloqueio de vários dias na parte visível", () => {
    expect(
      faixaNaGrade({
        ...base,
        inicio: instanteLocal(TZ, "2026-09-28", "00:00"),
        fim: instanteLocal(TZ, "2026-10-05", "00:00"),
      }),
    ).toEqual({ top: 0, height: 12 * 96 });
  });

  it("recorta só o começo quando o bloqueio vem da madrugada", () => {
    expect(
      faixaNaGrade({
        ...base,
        inicio: instanteLocal(TZ, "2026-09-30", "05:00"),
        fim: instanteLocal(TZ, "2026-09-30", "08:00"),
      }),
    ).toEqual({ top: 0, height: 96 });
  });

  it("fora da parte visível não desenha nada", () => {
    expect(
      faixaNaGrade({
        ...base,
        inicio: instanteLocal(TZ, "2026-09-30", "20:00"),
        fim: instanteLocal(TZ, "2026-09-30", "22:00"),
      }),
    ).toBeNull();
    expect(
      faixaNaGrade({
        ...base,
        inicio: instanteLocal(TZ, "2026-09-30", "05:00"),
        fim: instanteLocal(TZ, "2026-09-30", "07:00"),
      }),
    ).toBeNull();
  });
});

describe("horarioDoVao", () => {
  // "Bloquear este horário" no modal que nasce do clique no vão: o diálogo
  // abre no dia e na hora clicados, lidos no fuso da clínica.
  it("devolve o dia e a hora do clique no fuso da clínica", () => {
    expect(horarioDoVao(new Date("2026-09-30T17:00:00.000Z"), TZ)).toEqual({
      dia: "2026-09-30",
      hora: "14:00",
    });
  });

  it("nunca usa o fuso do navegador: o mesmo instante muda de hora", () => {
    expect(
      horarioDoVao(new Date("2026-09-30T17:00:00.000Z"), "Europe/Lisbon"),
    ).toEqual({ dia: "2026-09-30", hora: "18:00" });
  });

  it("perto da meia-noite o dia é o da clínica, não o UTC", () => {
    // 01:30 UTC do dia 01/10 ainda é 22:30 do dia 30/09 em Fortaleza.
    expect(horarioDoVao(new Date("2026-10-01T01:30:00.000Z"), TZ)).toEqual({
      dia: "2026-09-30",
      hora: "22:30",
    });
  });

  it("faz o caminho de volta do instanteLocal", () => {
    expect(horarioDoVao(instanteLocal(TZ, "2026-10-02", "07:15"), TZ)).toEqual({
      dia: "2026-10-02",
      hora: "07:15",
    });
  });
});

describe("bloqueiosQueCruzam", () => {
  // Revisao de 02/10/2026 (agenda-bloqueio 2): o bloqueio criado "mesmo
  // assim" por cima de uma consulta fica coberto pelo bloco dela. O menu da
  // consulta mostra os bloqueios que cruzam o horario, para o bloqueio
  // continuar visivel e removivel.
  const dia = "2026-09-30";
  const consulta = {
    starts_at: instanteLocal(TZ, dia, "15:00").toISOString(),
    ends_at: instanteLocal(TZ, dia, "15:30").toISOString(),
  };
  const bloqueio = (id: string, de: string, ate: string) => ({
    id,
    starts_at: instanteLocal(TZ, dia, de).toISOString(),
    ends_at: instanteLocal(TZ, dia, ate).toISOString(),
  });

  it("devolve o bloqueio dentro, por cima e que começa no meio da consulta", () => {
    const dentro = bloqueio("dentro", "15:00", "15:30");
    const porCima = bloqueio("por-cima", "14:00", "18:00");
    const noMeio = bloqueio("no-meio", "15:15", "16:00");
    expect(bloqueiosQueCruzam([dentro, porCima, noMeio], consulta)).toEqual([
      dentro,
      porCima,
      noMeio,
    ]);
  });

  it("só encostar não conta (sobreposição aberta)", () => {
    expect(
      bloqueiosQueCruzam(
        [
          bloqueio("antes", "14:00", "15:00"),
          bloqueio("depois", "15:30", "16:00"),
        ],
        consulta,
      ),
    ).toEqual([]);
  });

  it("devolve os próprios objetos, com motivo e encaixe, para o menu", () => {
    const completo = {
      ...bloqueio("completo", "15:00", "15:30"),
      reason: "Reunião",
      blocks_overbooking: true,
    };
    expect(bloqueiosQueCruzam([completo], consulta)[0]).toBe(completo);
  });
});
