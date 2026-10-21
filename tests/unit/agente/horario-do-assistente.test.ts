import { describe, expect, it } from "vitest";

import {
  agenteAtendeAgora,
  fimDoExpedienteAgora,
  horarioDoAssistente,
  horarioDoBanco,
  horarioPadrao,
  type HorarioDeOperacao,
} from "@/lib/domain/agente/config";
import {
  CASOS_DO_HORARIO,
  casosDoHorarioEmSql,
  COLUNAS_DO_HORARIO_EM_SQL,
} from "@/tests/fixtures/ia/horario-do-assistente";

// Onda 2, item 7 (contrato 4.3 e risco 2): a tabela verdade UNICA do horario
// do assistente roda aqui contra o TypeScript (horarioDoBanco +
// agenteAtendeAgora, o que o executor decide) e, no ensaio da migration
// 20261022110000, contra ia_horario_do_assistente, pela copia em SQL
// (casosDoHorarioEmSql). Mudou a regra de um lado, a tabela quebra.

describe("tabela verdade do horário do assistente (TS)", () => {
  it("ids únicos, instantes em UTC e cobertura do contrato", () => {
    const ids = CASOS_DO_HORARIO.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CASOS_DO_HORARIO) {
      expect(c.agora, c.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Number.isNaN(Date.parse(c.agora)), c.id).toBe(false);
    }
    // Modos, dia aberto e fechado, faixa invalida, borda do inicio e do
    // fim, fuso invalido e horario de verao estrangeiro.
    const modos = new Set(CASOS_DO_HORARIO.map((c) => c.operating_mode));
    for (const modo of ["24h", "fora_expediente", "fallback"]) {
      expect(modos.has(modo), modo).toBe(true);
    }
    const esperados = new Set(CASOS_DO_HORARIO.map((c) => c.esperado));
    expect([...esperados].sort()).toEqual(
      ["atende", "modo_nao_suportado", "no_expediente"].sort(),
    );
    const fusos = new Set(CASOS_DO_HORARIO.map((c) => c.timezone));
    for (const fuso of ["Invalid/Zone", null, "", "America/New_York"]) {
      expect(fusos.has(fuso), String(fuso)).toBe(true);
    }
  });

  it.each(CASOS_DO_HORARIO.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(
      horarioDoAssistente(
        {
          operating_mode: c.operating_mode,
          fallback_minutes: c.fallback_minutes,
          operating_hours: c.operating_hours,
        },
        Date.parse(c.agora),
        c.timezone,
      ),
      c.descricao,
    ).toBe(c.esperado);
  });

  it("é a composição de horarioDoBanco e agenteAtendeAgora (o caminho do executor)", () => {
    for (const c of CASOS_DO_HORARIO) {
      const horario = horarioDoBanco({
        operating_mode: c.operating_mode,
        fallback_minutes: c.fallback_minutes,
        operating_hours: c.operating_hours,
      });
      const pelaConta =
        horario.modo === "fallback"
          ? "modo_nao_suportado"
          : agenteAtendeAgora(
                horario,
                Date.parse(c.agora),
                // O executor usa o fuso da clinica ou o padrao.
                c.timezone || "America/Fortaleza",
              ).atende
            ? "atende"
            : "no_expediente";
      expect(pelaConta, c.id).toBe(c.esperado);
    }
  });
});

describe("cópia da tabela para o ensaio do banco", () => {
  it("uma linha de VALUES por caso, na ordem, com o id, o fuso e o esperado", () => {
    const linhas = casosDoHorarioEmSql().split(",\n");
    expect(linhas).toHaveLength(CASOS_DO_HORARIO.length);
    CASOS_DO_HORARIO.forEach((c, i) => {
      const linha = linhas[i] ?? "";
      expect(
        linha.startsWith(`('${c.id}', '${c.operating_mode}', `),
        c.id,
      ).toBe(true);
      expect(
        linha.endsWith(`'${c.agora}'::timestamptz, '${c.esperado}')`),
        c.id,
      ).toBe(true);
      expect(linha, c.id).toContain(
        c.timezone === null ? ", null, " : `, '${c.timezone}', `,
      );
    });
    expect(COLUNAS_DO_HORARIO_EM_SQL.split(", ")).toHaveLength(7);
  });

  it("a grade vai como jsonb (nula como coluna nula), o fallback nulo como inteiro nulo", () => {
    const sql = casosDoHorarioEmSql();
    expect(sql).toContain("('H01', '24h', null::jsonb, 5, ");
    expect(sql).toContain(`'"segunda a sexta"'::jsonb`);
    expect(sql).toContain("'[]'::jsonb");
    expect(sql).toContain(", null::integer, ");
    // A grade de cada caso volta igual do jsonb da copia.
    for (const c of CASOS_DO_HORARIO) {
      if (c.operating_hours !== null) {
        expect(sql, c.id).toContain(
          `'${JSON.stringify(c.operating_hours)}'::jsonb`,
        );
      }
    }
  });
});

describe("fimDoExpedienteAgora (quando o assistente volta)", () => {
  const foraDoExpediente: HorarioDeOperacao = {
    ...horarioPadrao(),
    modo: "fora_expediente",
  };
  const FORTALEZA = "America/Fortaleza";

  it("no expediente, o fim de hoje no fuso da clínica", () => {
    expect(
      fimDoExpedienteAgora(
        foraDoExpediente,
        Date.parse("2026-10-21T13:00:00Z"),
        FORTALEZA,
      ),
    ).toBe("18:00");
    const sabadoCurto: HorarioDeOperacao = {
      ...foraDoExpediente,
      expediente: {
        ...foraDoExpediente.expediente,
        sab: { aberto: true, inicio: "09:00", fim: "13:00" },
      },
    };
    expect(
      fimDoExpedienteAgora(
        sabadoCurto,
        Date.parse("2026-10-24T13:00:00Z"),
        FORTALEZA,
      ),
    ).toBe("13:00");
  });

  it("fora do expediente, em 24 horas, no fallback ou com instante inválido: nulo", () => {
    expect(
      fimDoExpedienteAgora(
        foraDoExpediente,
        Date.parse("2026-10-21T22:00:00Z"),
        FORTALEZA,
      ),
    ).toBeNull();
    expect(
      fimDoExpedienteAgora(
        { ...foraDoExpediente, modo: "24h" },
        Date.parse("2026-10-21T13:00:00Z"),
        FORTALEZA,
      ),
    ).toBeNull();
    expect(
      fimDoExpedienteAgora(
        { ...foraDoExpediente, modo: "fallback" },
        Date.parse("2026-10-21T13:00:00Z"),
        FORTALEZA,
      ),
    ).toBeNull();
    expect(
      fimDoExpedienteAgora(foraDoExpediente, Number.NaN, FORTALEZA),
    ).toBeNull();
  });

  it("fuso inválido cai no padrão da clínica", () => {
    expect(
      fimDoExpedienteAgora(
        foraDoExpediente,
        Date.parse("2026-10-21T19:30:00Z"),
        "Invalid/Zone",
      ),
    ).toBe("18:00");
  });
});
