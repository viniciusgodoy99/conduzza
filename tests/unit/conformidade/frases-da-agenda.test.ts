import { describe, expect, it, vi } from "vitest";

import {
  dataSemSemana,
  perguntaDaRemarcacao,
  perguntaDoCancelamento,
  respostaDaRemarcacao,
  respostaDoCancelamento,
  type DiaEHora,
} from "@/lib/agente/ferramentas/frases-da-agenda";
import {
  fatosVazios,
  type FatosDoTurno,
} from "@/lib/domain/conformidade/fatos-do-turno";
import { filtrarSaida } from "@/lib/domain/conformidade/filtro";
import { avaliarRegras } from "@/lib/domain/conformidade/filtro-deterministico";
import type { Verificador } from "@/lib/domain/conformidade/veredicto";
import {
  PERGUNTA_DA_REMARCACAO_PELA_IA,
  PERGUNTA_DO_CANCELAMENTO_PELA_IA,
  RESPOSTA_CANCELADA,
  RESPOSTA_DA_REMARCACAO_PELA_IA,
} from "@/lib/domain/textos-padrao";
import {
  CADASTRO_DA_AGENDA,
  CONTEXTO_PADRAO,
} from "@/tests/fixtures/ia/conformidade/casos";

// AG4 (27/10/2026, D-31): as frases fixas T1 a T4, preenchidas pelos
// construtores de verdade (lib/agente/ferramentas/frases-da-agenda.ts), com
// dias de semana, anos e unidades diferentes, passam no filtro de saida
// INTEIRO com os fatos do turno delas, byte a byte. A T4 sem a pendencia
// bloquearia (a regra remarcacao_sem_pendencia). Nenhum texto tem
// travessao. O verificador e um duble que aprova: nenhum teste chama a
// OpenAI.

const USO = {
  tokensEntrada: 900,
  tokensSaida: 30,
  tokensCacheLidos: 0,
  tokensCacheGravados: 0,
};

function verificadorQueSempreAprova() {
  return vi.fn<Verificador>(async () => ({
    tipo: "veredicto",
    veredicto: { aprovado: true, violacoes: [], confianca: "alta" },
    modelo: "gpt-6-luna",
    uso: USO,
  }));
}

type Caso = {
  nome: string;
  antiga: DiaEHora;
  nova: DiaEHora;
  /** A unidade do horario novo (so com mais de uma unidade). */
  unidade: string | null;
};

const CASOS: readonly Caso[] = [
  {
    nome: "quinta para terca, sem unidade",
    antiga: { dia: "quinta, 29/10", hora: "14:00" },
    nova: { dia: "terça, 03/11", hora: "10:00" },
    unidade: null,
  },
  {
    nome: "segunda para sabado, com a unidade",
    antiga: { dia: "segunda, 02/11", hora: "08:30" },
    nova: { dia: "sábado, 07/11", hora: "09:15" },
    unidade: "Aldeota",
  },
  {
    nome: "virada do ano, com o ano no dia",
    antiga: { dia: "quarta, 30/12", hora: "17:45" },
    nova: { dia: "segunda, 04/01/2027", hora: "07:00" },
    unidade: "Centro",
  },
  {
    nome: "o dia de hoje e o de amanha",
    antiga: { dia: "terça, 27/10", hora: "16:00" },
    nova: { dia: "quarta, 28/10", hora: "11:30" },
    unidade: null,
  },
];

function fatos(parcial: Partial<FatosDoTurno>): FatosDoTurno {
  return {
    ...fatosVazios(2026),
    ...CADASTRO_DA_AGENDA,
    hoje: { dia: 27, mes: 10, ano: 2026 },
    ...parcial,
  };
}

function consultaLida(c: DiaEHora) {
  return {
    dia: c.dia,
    hora: c.hora,
    unidade: null,
    profissional: "Dra. Ana Lima",
    marcadaNestaConversa: false,
  };
}

/** T1: o pedido de cancelamento (pedir_cancelamento) e a consulta lida. */
function fatosDaT1(c: Caso): FatosDoTurno {
  return fatos({
    saidasDasFerramentas: [
      JSON.stringify({
        resultado: "pergunta_do_cancelamento",
        consulta: { dia: c.antiga.dia, hora: c.antiga.hora },
      }),
    ],
    consultaLida: true,
    consultasLidas: [consultaLida(c.antiga)],
  });
}

/** T2: o cancelamento feito (cancelar_consulta). */
function fatosDaT2(c: Caso): FatosDoTurno {
  return fatos({
    saidasDasFerramentas: [
      JSON.stringify({
        resultado: "cancelada",
        dia: c.antiga.dia,
        hora: c.antiga.hora,
      }),
    ],
    acoes: ["cancelou"],
    horariosDasAcoes: [
      {
        dia: c.antiga.dia,
        hora: c.antiga.hora,
        unidade: null,
        profissional: "Dra. Ana Lima",
        acao: "cancelou",
      },
    ],
  });
}

/** T3: a reserva da remarcacao (reservar_horario no modo de remarcacao). */
function fatosDaT3(c: Caso): FatosDoTurno {
  return fatos({
    saidasDasFerramentas: [
      JSON.stringify({
        resultado: "reservado",
        minutos: 10,
        dia: c.nova.dia,
        hora: c.nova.hora,
        ...(c.unidade === null ? {} : { unidade: c.unidade }),
        consulta: { dia: c.antiga.dia, hora: c.antiga.hora },
      }),
    ],
    acoes: ["reservou"],
    horariosDasAcoes: [
      {
        dia: c.nova.dia,
        hora: c.nova.hora,
        unidade: c.unidade,
        profissional: "Dra. Ana Lima",
        acao: "reservou",
      },
    ],
    horariosLivres: [
      { dia: c.nova.dia, hora: c.nova.hora, unidade: c.unidade },
    ],
    consultaLida: true,
    consultasLidas: [consultaLida(c.antiga)],
  });
}

/** T4: a remarcacao pedida (agendar no modo de remarcacao). */
function fatosDaT4(c: Caso): FatosDoTurno {
  return fatos({
    saidasDasFerramentas: [
      JSON.stringify({
        resultado: "remarcado",
        pendente: true,
        dia: c.nova.dia,
        hora: c.nova.hora,
        ...(c.unidade === null ? {} : { unidade: c.unidade }),
        consulta: { dia: c.antiga.dia, hora: c.antiga.hora },
      }),
    ],
    acoes: ["remarcou"],
    horariosDasAcoes: [
      {
        dia: c.nova.dia,
        hora: c.nova.hora,
        unidade: c.unidade,
        profissional: "Dra. Ana Lima",
        acao: "remarcou",
        anterior: {
          dia: c.antiga.dia,
          hora: c.antiga.hora,
          unidade: null,
          profissional: "Dra. Ana Lima",
        },
      },
    ],
    consultaLida: true,
    consultasLidas: [consultaLida(c.antiga)],
  });
}

const FRASES: ReadonlyArray<
  readonly [string, (c: Caso) => string, (c: Caso) => FatosDoTurno]
> = [
  ["T1", (c) => perguntaDoCancelamento(c.antiga), fatosDaT1],
  ["T2", (c) => respostaDoCancelamento(c.antiga), fatosDaT2],
  [
    "T3",
    (c) =>
      perguntaDaRemarcacao({
        antiga: c.antiga,
        nova: c.nova,
        unidade: c.unidade,
      }),
    fatosDaT3,
  ],
  [
    "T4",
    (c) => respostaDaRemarcacao({ antiga: c.antiga, nova: c.nova }),
    fatosDaT4,
  ],
];

const TRAVESSAO = /[‒–—―]/;

describe("os modelos das frases fixas da agenda", () => {
  it.each([
    ["T1", PERGUNTA_DO_CANCELAMENTO_PELA_IA],
    ["T2", RESPOSTA_CANCELADA],
    ["T3", PERGUNTA_DA_REMARCACAO_PELA_IA],
    ["T4", RESPOSTA_DA_REMARCACAO_PELA_IA],
  ])("%s nao tem travessao", (_id, modelo) => {
    expect(modelo).not.toMatch(TRAVESSAO);
  });

  it("a data sem o dia da semana (a T2 escreve como o botao)", () => {
    expect(dataSemSemana("quinta, 29/10")).toBe("29/10");
    expect(dataSemSemana("segunda, 04/01/2027")).toBe("04/01/2027");
    expect(dataSemSemana("29/10")).toBe("29/10");
  });
});

describe.each(CASOS.map((c) => [c.nome, c] as const))(
  "as frases preenchidas: %s",
  (_nome, caso) => {
    it.each(
      FRASES.map(
        ([id, frase, fatosDaFrase]) => [id, frase, fatosDaFrase] as const,
      ),
    )(
      "%s passa nas regras e no filtro inteiro, byte a byte",
      async (_id, frase, fatosDaFrase) => {
        const texto = frase(caso);
        expect(texto).not.toMatch(TRAVESSAO);
        expect(texto).not.toContain("{{");
        expect(texto).not.toContain("}}");
        const contexto = { ...CONTEXTO_PADRAO, fatos: fatosDaFrase(caso) };
        expect(avaliarRegras(texto, contexto).achados).toEqual([]);
        const verificador = verificadorQueSempreAprova();
        const decisao = await filtrarSaida({
          rascunho: texto,
          contexto,
          verificador,
        });
        expect(decisao.aprovado).toBe(true);
        if (decisao.aprovado) {
          expect(decisao.texto).toBe(texto);
        }
        expect(verificador).toHaveBeenCalledTimes(1);
      },
    );
  },
);

describe("o que as frases dizem", () => {
  const [caso] = CASOS;

  it("T1 pergunta pela consulta lida (dia e hora)", () => {
    expect(perguntaDoCancelamento(caso!.antiga)).toBe(
      "Confirma o cancelamento da sua consulta de quinta, 29/10 às 14:00?",
    );
  });

  it("T2 e o texto do botao, com a data DD/MM", () => {
    expect(respostaDoCancelamento(caso!.antiga)).toBe(
      "Tudo bem, sua consulta de 29/10 às 14:00 foi cancelada. Quando quiser marcar de novo, é só chamar por aqui.",
    );
  });

  it("T3 diz a reserva, os 10 minutos e a unidade so quando ha", () => {
    expect(
      perguntaDaRemarcacao({
        antiga: caso!.antiga,
        nova: caso!.nova,
        unidade: null,
      }),
    ).toBe(
      "Reservei terça, 03/11 às 10:00 por 10 minutos. Confirma a remarcação da sua consulta de quinta, 29/10 às 14:00 para terça, 03/11 às 10:00?",
    );
    expect(
      perguntaDaRemarcacao({
        antiga: caso!.antiga,
        nova: caso!.nova,
        unidade: "Aldeota",
      }),
    ).toBe(
      "Reservei terça, 03/11 às 10:00, na unidade Aldeota, por 10 minutos. Confirma a remarcação da sua consulta de quinta, 29/10 às 14:00 para terça, 03/11 às 10:00?",
    );
  });

  it("T4 diz que depende da equipe e que a antiga continua", () => {
    expect(
      respostaDaRemarcacao({ antiga: caso!.antiga, nova: caso!.nova }),
    ).toBe(
      "Pronto, pedi a remarcação para terça, 03/11 às 10:00. Até a equipe aprovar, sua consulta de quinta, 29/10 às 14:00 continua marcada. A confirmação chega por aqui.",
    );
  });

  it("sem a pendencia, a remarcacao bloquearia (remarcacao_sem_pendencia)", () => {
    const contexto = { ...CONTEXTO_PADRAO, fatos: fatosDaT4(caso!) };
    const resultado = avaliarRegras(
      "Pronto, pedi a remarcação para terça, 03/11 às 10:00. A confirmação chega por aqui.",
      contexto,
    );
    expect(resultado.achados).toContainEqual({
      categoria: "acao_nao_executada",
      regra: "remarcacao_sem_pendencia",
    });
  });

  it("a T2 num turno sem o cancelamento bloquearia (a acao nao aconteceu)", () => {
    const contexto = { ...CONTEXTO_PADRAO, fatos: fatosDaT1(caso!) };
    const resultado = avaliarRegras(
      respostaDoCancelamento(caso!.antiga),
      contexto,
    );
    expect(resultado.categorias).toContain("acao_nao_executada");
  });
});
