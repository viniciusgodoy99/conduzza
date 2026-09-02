import { describe, expect, it } from "vitest";

import {
  TOLERANCIA_DE_BATIDA_MS,
  batidaVencida,
  filaAtrasada,
  motorParado,
} from "@/lib/domain/motor";

// A regra que decide se a clínica vê "as mensagens automáticas estão paradas".
//
// Ela existe porque, quando o motor morre, a Tela 2 fica idêntica à de uma
// clínica saudável: régua "ligada", consultas "pendentes", "Cobrar agora"
// respondendo sucesso. Errar para o lado de não avisar é o pior dos dois erros.

const agora = new Date("2026-08-31T12:00:00Z");
const atras = (ms: number) => new Date(agora.getTime() - ms).toISOString();
const batida = (ms: number) => ({ batida_em: atras(ms) });

describe("batidaVencida", () => {
  it("batida recente: o executor está de pé", () => {
    expect(batidaVencida(batida(0), agora)).toBe(false);
    expect(batidaVencida(batida(30_000), agora)).toBe(false);
    // A fila bate a cada 20 segundos e o planner a cada 60: nem uma nem outra
    // perdida significa problema.
    expect(batidaVencida(batida(90_000), agora)).toBe(false);
  });

  it("batida velha: avisa", () => {
    expect(batidaVencida(batida(TOLERANCIA_DE_BATIDA_MS + 1_000), agora)).toBe(
      true,
    );
    expect(batidaVencida(batida(60 * 60_000), agora)).toBe(true);
  });

  it("no limite exato ainda não avisa, um instante depois avisa", () => {
    expect(batidaVencida(batida(TOLERANCIA_DE_BATIDA_MS), agora)).toBe(false);
    expect(batidaVencida(batida(TOLERANCIA_DE_BATIDA_MS + 1), agora)).toBe(true);
  });

  it("batida nenhuma conta como vencida", () => {
    // Ou o executor nunca subiu, ou está fora do ar desde antes de existir o
    // carimbo. Nos dois casos nada automático acontece.
    expect(batidaVencida(null, agora)).toBe(true);
    expect(batidaVencida({ batida_em: null }, agora)).toBe(true);
  });

  it("carimbo corrompido conta como vencido, nunca como saudável", () => {
    // Falhar para o lado do aviso: um carimbo ilegível não é prova de vida.
    expect(batidaVencida({ batida_em: "nao-e-data" }, agora)).toBe(true);
    expect(batidaVencida({ batida_em: "" }, agora)).toBe(true);
  });

  it("batida no futuro (relógio torto) não é tratada como vencida", () => {
    expect(
      batidaVencida(
        { batida_em: new Date(agora.getTime() + 60_000).toISOString() },
        agora,
      ),
    ).toBe(false);
  });
});

describe("motorParado", () => {
  it("os dois papéis vivos: o motor está de pé", () => {
    expect(
      motorParado({ fila: batida(10_000), planner: batida(30_000) }, agora),
    ).toBe(false);
  });

  it("a fila morta com o planner vivo AINDA é motor parado", () => {
    // Este é o caso que a leitura antiga ("a batida mais recente de qualquer
    // executor") escondia: o planner roda dentro do banco e continuaria
    // batendo com a rota fora do ar, então a clínica veria tudo verde com
    // nenhuma mensagem saindo.
    expect(
      motorParado(
        { fila: batida(10 * 60_000), planner: batida(10_000) },
        agora,
      ),
    ).toBe(true);
  });

  it("o planner morto com a fila viva também é motor parado", () => {
    // Sem planner, nenhuma régua é planejada: a fila fica vazia para sempre e
    // isso é indistinguível de "não há nada a fazer".
    expect(
      motorParado(
        { fila: batida(10_000), planner: batida(10 * 60_000) },
        agora,
      ),
    ).toBe(true);
  });

  it("papel faltando conta como parado", () => {
    expect(motorParado({ fila: null, planner: batida(10_000) }, agora)).toBe(
      true,
    );
    expect(motorParado({ fila: batida(10_000), planner: null }, agora)).toBe(
      true,
    );
    expect(motorParado(null, agora)).toBe(true);
  });
});

describe("filaAtrasada", () => {
  it("distingue motor vivo de motor trabalhando", () => {
    // A batida prova a corrente (o agendador disparou, a rota respondeu). Isto
    // prova o trabalho: com o provedor de WhatsApp fora do ar, a corrente
    // continua viva e a fila acumula.
    expect(filaAtrasada(0)).toBe(false);
    expect(filaAtrasada(null)).toBe(false);
    expect(filaAtrasada(undefined)).toBe(false);
    expect(filaAtrasada(1)).toBe(true);
  });
});
