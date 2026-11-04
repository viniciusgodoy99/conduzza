import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  METRICAS_DO_AGENTE,
  linhasDoCsv,
  montarExportavelDaAba,
  type MetricaDoAgente,
} from "@/lib/domain/exportacao-de-resultados";
import {
  fetchAtendimentoDoPeriodo,
  type DesempenhoDoAgente,
} from "@/lib/queries/relatorios";

import { AGENTE, ATENDIMENTO } from "./dados-de-exemplo";

// O desempenho do agente em Resultados (resto da AG0): o bloco "agente" de
// atendimento_do_periodo (migration 20261104120000), lido com e sem a migration
// aplicada, nos cartoes e na exportacao. A regra que mais importa: sem atividade
// da IA nao existe numero, e "Ainda não medido" nunca vira zero.

vi.mock("@/components/shared/permission-hint", () => ({
  DisabledWithHint: ({
    hint,
    children,
  }: {
    hint: string;
    children: ReactNode;
  }) => <span data-dica={hint}>{children}</span>,
}));

const { AbaAgenteIa } = await import("@/components/relatorios/aba-agente-ia");
const { AgenteIaResumo, CartaoDoAgente, DICA_DO_AGENTE } =
  await import("@/components/relatorios/agente-ia-resumo");

const SEM_ATIVIDADE: DesempenhoDoAgente = {
  atendidas: 0,
  resolvidasSemHumano: 0,
  transferidas: 0,
  insatisfacao: 0,
  primeiraRespostaMedianaSegundos: null,
  agendamentos: 0,
};

/** Texto sem tags, com espacos (inclusive o NBSP do Intl) normalizados. */
function texto(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cartao(
  rotulo: MetricaDoAgente,
  agente: DesempenhoDoAgente | null,
  anterior: DesempenhoDoAgente | null = null,
): string {
  return renderToStaticMarkup(
    <CartaoDoAgente rotulo={rotulo} agente={agente} anterior={anterior} />,
  );
}

function clienteQueDevolve(data: unknown): SupabaseClient {
  return {
    rpc: async () => ({ data, error: null }),
  } as unknown as SupabaseClient;
}

const CORPO_DE_HOJE = {
  conversas_iniciadas: 3,
  primeira_resposta: {
    conversas: 2,
    respondidas: 1,
    mediana_segundos: 600,
    p90_segundos: 600,
  },
  mensagens: {
    por_autor: { paciente: 2 },
    entrada: 2,
    saida: 1,
    notas_internas: 0,
  },
};

const BLOCO_DA_RPC = {
  atendidas: 21,
  resolvidas_sem_humano: 12,
  transferidas: 6,
  insatisfacao: 2,
  primeira_resposta_mediana_segundos: 540,
  agendamentos: 7,
};

function ler(data: unknown) {
  return fetchAtendimentoDoPeriodo(
    clienteQueDevolve(data),
    "clinica",
    "America/Fortaleza",
    "2026-10-01",
    "2026-10-30",
  );
}

describe("a leitura do bloco agente, com e sem a migration", () => {
  it("com o bloco: os numeros em camelCase, nas duas janelas", async () => {
    const lido = await ler({
      atual: { ...CORPO_DE_HOJE, agente: BLOCO_DA_RPC },
      anterior: {
        ...CORPO_DE_HOJE,
        agente: { ...BLOCO_DA_RPC, atendidas: 9 },
      },
    });
    expect(lido.atual.agente).toEqual(AGENTE);
    expect(lido.anterior?.agente?.atendidas).toBe(9);
    // O resto do corpo continua lido igual.
    expect(lido.atual.conversasIniciadas).toBe(3);
  });

  it("sem o bloco (migration nao aplicada): agente null, nunca zeros", async () => {
    const lido = await ler({ atual: CORPO_DE_HOJE, anterior: CORPO_DE_HOJE });
    expect(lido.atual.agente).toBeNull();
    expect(lido.anterior?.agente).toBeNull();
    expect(lido.atual.conversasIniciadas).toBe(3);
  });

  it("o bloco null tambem vira null; a mediana null continua null", async () => {
    const nulo = await ler({ atual: { ...CORPO_DE_HOJE, agente: null } });
    expect(nulo.atual.agente).toBeNull();
    const semMediana = await ler({
      atual: {
        ...CORPO_DE_HOJE,
        agente: { ...BLOCO_DA_RPC, primeira_resposta_mediana_segundos: null },
      },
    });
    expect(semMediana.atual.agente?.primeiraRespostaMedianaSegundos).toBeNull();
  });
});

describe("os cartoes do agente", () => {
  it.each([
    ["sem o bloco", null],
    ["bloco zerado, sem atividade", SEM_ATIVIDADE],
  ])("%s: todos em Ainda não medido, com a dica, nunca zero", (_nome, agente) => {
    for (const rotulo of METRICAS_DO_AGENTE) {
      const html = cartao(rotulo, agente);
      expect(html).toContain('data-estado="nao-medido"');
      expect(texto(html)).toBe(`${rotulo} Ainda não medido`);
      expect(html).toContain(`data-dica="${DICA_DO_AGENTE}"`);
    }
  });

  it("com atividade: o numero real de cada metrica", () => {
    expect(texto(cartao("Resolvidas sem humano", AGENTE))).toBe(
      "Resolvidas sem humano 12 de 21 conversas atendidas pela IA",
    );
    expect(texto(cartao("Transferidas para a equipe", AGENTE))).toBe(
      "Transferidas para a equipe 6",
    );
    expect(texto(cartao("Escalonadas por insatisfação", AGENTE))).toBe(
      "Escalonadas por insatisfação 2",
    );
    expect(texto(cartao("Primeira resposta da IA", AGENTE))).toBe(
      "Primeira resposta da IA 9 min mediana do período",
    );
    expect(texto(cartao("Agendamentos feitos pela IA", AGENTE))).toBe(
      "Agendamentos feitos pela IA 7",
    );
  });

  it("uma conversa so: o rodape no singular", () => {
    expect(
      texto(cartao("Resolvidas sem humano", { ...AGENTE, atendidas: 1 })),
    ).toContain("de 1 conversa atendida pela IA");
  });

  it("qualquer uma das tres atividades acende os numeros", () => {
    for (const atividade of [
      { atendidas: 1 },
      { transferidas: 1 },
      { agendamentos: 1 },
    ]) {
      const html = cartao("Transferidas para a equipe", {
        ...SEM_ATIVIDADE,
        ...atividade,
      });
      expect(html).toContain('data-estado="valor"');
    }
  });

  it("insatisfacao sozinha nao e atividade (nunca vem sem transferida)", () => {
    expect(
      cartao("Escalonadas por insatisfação", {
        ...SEM_ATIVIDADE,
        insatisfacao: 1,
      }),
    ).toContain('data-estado="nao-medido"');
  });

  it("Satisfação fica em Ainda não medido, com uma dica que nao contradiz a atividade", () => {
    const html = cartao("Satisfação", AGENTE);
    expect(html).toContain('data-estado="nao-medido"');
    expect(texto(html)).toBe("Satisfação Ainda não medido");
    expect(html).not.toContain(DICA_DO_AGENTE);
    expect(html).toContain("ainda não foi definida");
  });

  it("com atividade e sem atendida: Resolvidas sem dados, nunca 0 de 0", () => {
    const html = cartao("Resolvidas sem humano", {
      ...SEM_ATIVIDADE,
      transferidas: 3,
    });
    expect(html).toContain('data-estado="vazio"');
    expect(texto(html)).toBe(
      "Resolvidas sem humano Sem dados nenhuma conversa atendida pela IA",
    );
  });

  it("com atividade e sem conversa nova respondida: Primeira resposta sem dados", () => {
    const html = cartao("Primeira resposta da IA", {
      ...AGENTE,
      primeiraRespostaMedianaSegundos: null,
    });
    expect(html).toContain('data-estado="vazio"');
    expect(texto(html)).toContain("nenhuma conversa nova respondida pela IA");
  });

  it("compara com o periodo anterior pela polaridade de cada metrica", () => {
    const anterior = {
      ...AGENTE,
      resolvidasSemHumano: 10,
      transferidas: 3,
      insatisfacao: 4,
      agendamentos: 14,
    };
    const resolvidas = cartao("Resolvidas sem humano", AGENTE, anterior);
    expect(texto(resolvidas)).toContain("subiu 20,0% vs. período anterior");
    expect(resolvidas).toMatch(/data-sentido="subiu"[^>]*text-success-text/);
    // Mais conversas passadas para a equipe e pior; menos insatisfacao e melhor.
    const transferidas = cartao("Transferidas para a equipe", AGENTE, anterior);
    expect(transferidas).toMatch(/data-sentido="subiu"[^>]*text-alert-text/);
    const insatisfacao = cartao(
      "Escalonadas por insatisfação",
      AGENTE,
      anterior,
    );
    expect(insatisfacao).toMatch(/data-sentido="caiu"[^>]*text-success-text/);
    const agendamentos = cartao("Agendamentos feitos pela IA", AGENTE, anterior);
    expect(agendamentos).toMatch(/data-sentido="caiu"[^>]*text-alert-text/);
    // Duracao nao compara, como a primeira resposta da equipe.
    expect(cartao("Primeira resposta da IA", AGENTE, anterior)).not.toContain(
      "data-parte",
    );
  });

  it.each([
    ["sem o bloco", null],
    ["sem atividade", SEM_ATIVIDADE],
  ])(
    "periodo anterior %s nao e base: sem comparacao, nem sem base",
    (_nome, anterior) => {
      const html = cartao("Transferidas para a equipe", AGENTE, anterior);
      expect(html).not.toContain("data-parte");
      expect(texto(html)).toBe("Transferidas para a equipe 6");
    },
  );

  it("a aba: o paragrafo so aparece sem atividade", () => {
    const paragrafo = "Estes números chegam com o agente de IA";
    const aba = (agente: DesempenhoDoAgente | null) =>
      texto(
        renderToStaticMarkup(
          <AbaAgenteIa
            atendimento={{ atual: { ...ATENDIMENTO, agente }, anterior: null }}
            canalOficial={false}
            podeVerValores
          />,
        ),
      );
    expect(aba(null)).toContain(paragrafo);
    expect(aba(SEM_ATIVIDADE)).toContain(paragrafo);
    const comNumeros = aba(AGENTE);
    expect(comNumeros).not.toContain(paragrafo);
    expect(comNumeros).toContain("12 de 21 conversas atendidas pela IA");
    // So a Satisfacao continua sem numero.
    expect(comNumeros.match(/Ainda não medido/g)).toHaveLength(1);
  });

  it("a Visao geral: os tres cartoes do resumo, com e sem atividade", () => {
    const resumo = (agente: DesempenhoDoAgente | null) =>
      texto(
        renderToStaticMarkup(
          <AgenteIaResumo
            atendimento={{ ...ATENDIMENTO, agente }}
            aoVerDetalhes={() => undefined}
          />,
        ),
      );
    expect(resumo(null).match(/Ainda não medido/g)).toHaveLength(3);
    expect(resumo(SEM_ATIVIDADE).match(/Ainda não medido/g)).toHaveLength(3);
    const comNumeros = resumo(AGENTE);
    expect(comNumeros).not.toContain("Ainda não medido");
    expect(comNumeros).toContain("12 de 21 conversas atendidas pela IA");
    expect(comNumeros).toContain("Transferidas para a equipe 6");
    expect(comNumeros).toContain("Primeira resposta da IA 9 min");
    // O atendimento humano continua ao lado.
    expect(comNumeros).toContain("Primeira resposta da equipe 9 min");
  });

  it("nenhum travessao no texto dos cartoes", () => {
    for (const rotulo of METRICAS_DO_AGENTE) {
      for (const agente of [null, SEM_ATIVIDADE, AGENTE]) {
        expect(cartao(rotulo, agente)).not.toMatch(/[–—]/);
      }
    }
  });
});

describe("a exportacao do agente", () => {
  const exportar = (
    aba: "geral" | "ia",
    agente: DesempenhoDoAgente | null,
  ) =>
    montarExportavelDaAba({
      aba,
      podeVerValores: false,
      canalOficial: false,
      atendimento: { atual: { ...ATENDIMENTO, agente }, anterior: null },
      dimensaoOrigem: "canal",
      dimensaoAgenda: "profissional",
    });

  const secaoDoAgente = (aba: "geral" | "ia", agente: DesempenhoDoAgente | null) =>
    exportar(aba, agente).secoes.find((secao) =>
      secao.titulo.includes(aba === "ia" ? "Desempenho do agente" : "Agente de IA"),
    )!.linhas;

  const NUMEROS: string[][] = [
    ["Resolvidas sem humano", "12 de 21"],
    ["Transferidas para a equipe", "6"],
    ["Escalonadas por insatisfação", "2"],
    ["Primeira resposta da IA", "9 min"],
    ["Agendamentos feitos pela IA", "7"],
    ["Satisfação", "Ainda não medido"],
  ];

  it.each(["geral", "ia"] as const)(
    "%s, com atividade: os numeros da tela e a Satisfação sem numero",
    (aba) => {
      const linhas = secaoDoAgente(aba, AGENTE);
      for (const linha of NUMEROS) {
        expect(linhas).toContainEqual(linha);
      }
    },
  );

  it.each(["geral", "ia"] as const)(
    "%s, sem atividade ou sem o bloco: Ainda não medido, nunca zero",
    (aba) => {
      for (const agente of [null, SEM_ATIVIDADE]) {
        const linhas = secaoDoAgente(aba, agente);
        for (const rotulo of METRICAS_DO_AGENTE) {
          expect(linhas).toContainEqual([rotulo, "Ainda não medido"]);
        }
        const doAgente = linhas.filter(([rotulo]) =>
          (METRICAS_DO_AGENTE as readonly string[]).includes(rotulo ?? ""),
        );
        expect(doAgente.map(([, valor]) => valor)).not.toContain("0");
      }
    },
  );

  it("com atividade e sem o que medir: sem dados, nunca 0 de 0", () => {
    const linhas = secaoDoAgente("ia", { ...SEM_ATIVIDADE, transferidas: 3 });
    expect(linhas).toContainEqual(["Resolvidas sem humano", "sem dados"]);
    expect(linhas).toContainEqual(["Primeira resposta da IA", "sem dados"]);
    expect(linhas).toContainEqual(["Transferidas para a equipe", "3"]);
    // Zero medido: a IA atuou no periodo e ninguem reclamou.
    expect(linhas).toContainEqual(["Escalonadas por insatisfação", "0"]);
  });

  it("o CSV leva as mesmas linhas", () => {
    const csv = linhasDoCsv(exportar("ia", AGENTE));
    expect(csv).toContainEqual(["Resolvidas sem humano", "12 de 21"]);
  });
});
