import { describe, expect, it } from "vitest";

import {
  cartoesDePacientes,
  somarMeses,
  type MetricasDePacientes,
} from "@/lib/domain/pacientes-ui";

// Os 4 cartoes do topo da lista de Pacientes (Fase 3, decisoes do dono em
// 02/10/2026). Os numeros vem da RPC metricas_de_pacientes; aqui se testa a
// decisao da tela, com as MESMAS fronteiras da funcao no dia civil da
// clinica (regra 3.6): variacao escondida com base zero, "Contando desde"
// com menos de 12 meses de historico, retorno e "sem consulta" em "Ainda não
// medido" enquanto o zero seria estrutural.

const FORTALEZA = "America/Fortaleza";
// 02/10/2026, meio-dia em Fortaleza (UTC-3).
const agora = new Date("2026-10-02T15:00:00Z");

function metricas(parcial: Partial<MetricasDePacientes>): MetricasDePacientes {
  return {
    ativos: 0,
    ativos_30d_atras: 0,
    novos_no_mes: 0,
    retorno_base: 0,
    retorno_voltaram: 0,
    sem_contato_6m: 0,
    primeiro_comparecimento: null,
    ...parcial,
  };
}

describe("somarMeses (espelho de date + interval no Postgres)", () => {
  it("soma e subtrai meses atravessando o ano", () => {
    expect(somarMeses("2026-01-15", -1)).toBe("2025-12-15");
    expect(somarMeses("2026-11-15", 3)).toBe("2027-02-15");
    expect(somarMeses("2026-10-03", -12)).toBe("2025-10-03");
  });

  it("dia que nao existe no mes de chegada cai no ultimo dia dele", () => {
    expect(somarMeses("2026-08-31", -6)).toBe("2026-02-28");
    expect(somarMeses("2024-03-31", -1)).toBe("2024-02-29");
    expect(somarMeses("2028-02-29", -12)).toBe("2027-02-28");
    expect(somarMeses("2026-12-31", 2)).toBe("2027-02-28");
  });
});

describe("cartoesDePacientes, clinica sem comparecimento", () => {
  it("zeros e nada medido, sem data nenhuma para prometer", () => {
    expect(cartoesDePacientes(metricas({}), agora, FORTALEZA)).toEqual({
      ativos: { valor: 0, anterior: null, contandoDesde: null },
      novosNoMes: 0,
      retorno: { medido: false, primeiraMedidaEm: null },
      semConsulta6m: { medido: false, contaDesde: null },
    });
  });
});

describe("cartoesDePacientes, pacientes ativos", () => {
  it("variacao absoluta contra 30 dias atras", () => {
    const { ativos } = cartoesDePacientes(
      metricas({
        ativos: 1248,
        ativos_30d_atras: 1214,
        primeiro_comparecimento: "2024-01-10T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(ativos).toEqual({
      valor: 1248,
      anterior: 1214,
      contandoDesde: null,
    });
  });

  it("base zero esconde a variacao (anterior null)", () => {
    const { ativos } = cartoesDePacientes(
      metricas({
        ativos: 1,
        ativos_30d_atras: 0,
        primeiro_comparecimento: "2026-09-10T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(ativos.anterior).toBeNull();
    expect(ativos.contandoDesde).toBe("10/09/2026");
  });

  it("'Contando desde' vale enquanto o historico cabe na janela de 12 meses do banco", () => {
    // Janela de hoje (02/10/2026): [03/10/2025, 03/10/2026) no fuso da
    // clinica. 03/10/2025 00:00 em Fortaleza e 03:00 UTC.
    const dentro = cartoesDePacientes(
      metricas({ primeiro_comparecimento: "2025-10-03T03:00:00Z" }),
      agora,
      FORTALEZA,
    );
    expect(dentro.ativos.contandoDesde).toBe("03/10/2025");

    // Um segundo antes ainda e 02/10/2025 em Fortaleza (no UTC ja seria 03).
    const fora = cartoesDePacientes(
      metricas({ primeiro_comparecimento: "2025-10-03T02:59:59Z" }),
      agora,
      FORTALEZA,
    );
    expect(fora.ativos.contandoDesde).toBeNull();
  });
});

describe("cartoesDePacientes, retorno em 90 dias", () => {
  it("com base: percentual cru das consultas que voltaram", () => {
    const { retorno } = cartoesDePacientes(
      metricas({
        retorno_base: 8,
        retorno_voltaram: 3,
        primeiro_comparecimento: "2025-01-10T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(retorno).toEqual({ medido: true, percentual: 37.5, base: 8 });
  });

  it("base zero nunca e 0%: 'Ainda não medido' com o dia da primeira medida", () => {
    // Atendido em 10/09/2026: a janela madura fecha no inicio de hoje menos
    // 90 dias, entao ele entra na base em 10/09 + 91 = 10/12/2026.
    const { retorno } = cartoesDePacientes(
      metricas({
        retorno_base: 0,
        primeiro_comparecimento: "2026-09-10T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(retorno).toEqual({ medido: false, primeiraMedidaEm: "10/12/2026" });
  });

  it("historico antigo sem base na janela: nao medido, sem data para prometer", () => {
    const { retorno } = cartoesDePacientes(
      metricas({
        retorno_base: 0,
        primeiro_comparecimento: "2023-05-10T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(retorno).toEqual({ medido: false, primeiraMedidaEm: null });
  });
});

describe("cartoesDePacientes, sem consulta ha 6 meses", () => {
  it("historico de mais de 6 meses: mede (inclusive zero)", () => {
    // Hoje menos 6 meses = 02/04/2026; atendido em 01/04 ja conta.
    const { semConsulta6m } = cartoesDePacientes(
      metricas({
        sem_contato_6m: 0,
        primeiro_comparecimento: "2026-04-01T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(semConsulta6m).toEqual({ medido: true, valor: 0 });
  });

  it("historico menor que 6 meses: zero estrutural vira 'Ainda não medido'", () => {
    const { semConsulta6m } = cartoesDePacientes(
      metricas({
        sem_contato_6m: 0,
        primeiro_comparecimento: "2026-04-02T13:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    // Em 03/10/2026, hoje menos 6 meses (03/04) passa do dia 02/04.
    expect(semConsulta6m).toEqual({ medido: false, contaDesde: "03/10/2026" });
  });

  it("fim de mes: a contagem comeca no primeiro dia em que o banco ja contaria", () => {
    // Atendido em 31/08/2026. Em 28/02/2027 o banco olha 28/08/2026 (ainda
    // antes do atendimento); em 01/03/2027 olha 01/09/2026 e passa a contar.
    const { semConsulta6m } = cartoesDePacientes(
      metricas({ primeiro_comparecimento: "2026-08-31T13:00:00Z" }),
      agora,
      FORTALEZA,
    );
    expect(semConsulta6m).toEqual({ medido: false, contaDesde: "01/03/2027" });
  });

  it("o dia do primeiro atendimento e o do fuso da clinica", () => {
    // 02/04/2026 01:00 UTC ainda e 01/04 em Fortaleza: ja mede.
    const { semConsulta6m } = cartoesDePacientes(
      metricas({
        sem_contato_6m: 4,
        primeiro_comparecimento: "2026-04-02T01:00:00Z",
      }),
      agora,
      FORTALEZA,
    );
    expect(semConsulta6m).toEqual({ medido: true, valor: 4 });
  });
});
