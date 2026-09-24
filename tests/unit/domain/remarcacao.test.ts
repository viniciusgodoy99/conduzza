import { describe, expect, it } from "vitest";

import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  MENSAGEM_SEM_VINCULO,
  cabeNaJornada,
  colideComBloqueio,
  vinculoEquivalente,
} from "@/lib/domain/remarcacao";
import { AVISO_REMARCACAO } from "@/lib/domain/textos-padrao";

// Achados 79 e 85 da revisao de liberacao: remarcar respeita jornada,
// bloqueio e vinculo do profissional de destino, e o aviso ao paciente usa o
// texto do dono.

const FUSO = "America/Fortaleza";

// 28/09/2026 e segunda-feira (weekday 1); 02/10/2026 e sexta (weekday 5).
const JORNADA = [
  { weekday: 1, startsAt: "08:00", endsAt: "12:00" },
  { weekday: 1, startsAt: "12:00", endsAt: "18:00" },
  { weekday: 5, startsAt: "22:00", endsAt: "02:00" },
];

function intervalo(inicio: string, fim: string) {
  return { inicio: new Date(inicio), fim: new Date(fim) };
}

describe("cabeNaJornada", () => {
  it("horário dentro da faixa cabe", () => {
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-09-28T10:00:00-03:00", "2026-09-28T10:30:00-03:00"),
      }),
    ).toBe(true);
  });

  it("faixas encostadas valem como uma só", () => {
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-09-28T11:30:00-03:00", "2026-09-28T12:30:00-03:00"),
      }),
    ).toBe(true);
  });

  it("consulta que passa do fim da jornada não cabe", () => {
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-09-28T17:45:00-03:00", "2026-09-28T18:15:00-03:00"),
      }),
    ).toBe(false);
  });

  it("dia sem jornada não cabe", () => {
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-09-29T10:00:00-03:00", "2026-09-29T10:30:00-03:00"),
      }),
    ).toBe(false);
  });

  it("jornada que vira o dia vale na madrugada seguinte", () => {
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-10-03T01:00:00-03:00", "2026-10-03T01:30:00-03:00"),
      }),
    ).toBe(true);
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-10-03T02:00:00-03:00", "2026-10-03T02:30:00-03:00"),
      }),
    ).toBe(false);
  });

  it("profissional sem jornada cadastrada não recebe consulta", () => {
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: [],
        ...intervalo("2026-09-28T10:00:00-03:00", "2026-09-28T10:30:00-03:00"),
      }),
    ).toBe(false);
  });

  it("usa o fuso da clínica, não o do servidor", () => {
    // 10:30 UTC e 07:30 em Fortaleza: fora da jornada, embora "10:30" lido
    // em UTC caisse dentro. E 20:00 UTC e 17:00 local: dentro, embora
    // "20:00" em UTC caisse fora.
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-09-28T10:30:00Z", "2026-09-28T11:00:00Z"),
      }),
    ).toBe(false);
    expect(
      cabeNaJornada({
        timezone: FUSO,
        jornada: JORNADA,
        ...intervalo("2026-09-28T20:00:00Z", "2026-09-28T20:30:00Z"),
      }),
    ).toBe(true);
  });
});

describe("colideComBloqueio", () => {
  const bloqueio = [
    {
      starts_at: "2026-09-28T13:00:00-03:00",
      ends_at: "2026-09-28T14:00:00-03:00",
    },
  ];

  it("sobreposição conta", () => {
    const { inicio, fim } = intervalo(
      "2026-09-28T13:30:00-03:00",
      "2026-09-28T14:00:00-03:00",
    );
    expect(colideComBloqueio(bloqueio, inicio, fim)).toBe(true);
  });

  it("encostar na borda não conta", () => {
    const antes = intervalo(
      "2026-09-28T12:30:00-03:00",
      "2026-09-28T13:00:00-03:00",
    );
    const depois = intervalo(
      "2026-09-28T14:00:00-03:00",
      "2026-09-28T14:30:00-03:00",
    );
    expect(colideComBloqueio(bloqueio, antes.inicio, antes.fim)).toBe(false);
    expect(colideComBloqueio(bloqueio, depois.inicio, depois.fim)).toBe(false);
  });
});

describe("vinculoEquivalente", () => {
  const vinculos = [
    {
      id: "a-part",
      professional_id: "ana",
      procedure_id: "consulta",
      insurance_id: null,
      duration_min: 30,
      active: true,
    },
    {
      id: "b-unimed",
      professional_id: "bruno",
      procedure_id: "consulta",
      insurance_id: "unimed",
      duration_min: 20,
      active: true,
    },
    {
      id: "b-part-inativo",
      professional_id: "bruno",
      procedure_id: "consulta",
      insurance_id: null,
      duration_min: 40,
      active: false,
    },
    {
      id: "b-outro-proc",
      professional_id: "bruno",
      procedure_id: "laser",
      insurance_id: null,
      duration_min: 60,
      active: true,
    },
  ];

  it("acha o vínculo do mesmo procedimento e convênio", () => {
    expect(
      vinculoEquivalente(vinculos, {
        professionalId: "bruno",
        procedureId: "consulta",
        insuranceId: "unimed",
      })?.id,
    ).toBe("b-unimed");
  });

  it("particular casa com particular, e vínculo inativo não vale", () => {
    expect(
      vinculoEquivalente(vinculos, {
        professionalId: "bruno",
        procedureId: "consulta",
        insuranceId: null,
      }),
    ).toBeNull();
    expect(
      vinculoEquivalente(vinculos, {
        professionalId: "ana",
        procedureId: "consulta",
        insuranceId: null,
      })?.id,
    ).toBe("a-part");
  });

  it("outro procedimento não serve", () => {
    expect(
      vinculoEquivalente(vinculos, {
        professionalId: "ana",
        procedureId: "laser",
        insuranceId: null,
      }),
    ).toBeNull();
  });

  it("a recusa diz o motivo sem travessão", () => {
    expect(MENSAGEM_SEM_VINCULO).not.toMatch(/[–—]/);
  });
});

describe("aviso de remarcação ao paciente", () => {
  it("é o texto do dono, com data e hora preenchidas", () => {
    expect(
      renderizarModelo(AVISO_REMARCACAO, {
        nome: "Ana",
        clinica: "Clínica Sol",
        data: "12/10/2026",
        hora: "15:00",
      }),
    ).toBe(
      "Olá, Ana! Sua consulta na Clínica Sol foi remarcada para 12/10/2026 às 15:00. Qualquer dúvida, é só responder aqui.",
    );
  });

  it("não sobra chave sem preencher", () => {
    const texto = renderizarModelo(AVISO_REMARCACAO, {
      nome: "Ana",
      clinica: "Clínica Sol",
      data: "12/10/2026",
      hora: "15:00",
    });
    expect(texto).not.toContain("{{");
    expect(texto).not.toMatch(/[–—]/);
  });
});
