import { describe, expect, it } from "vitest";

import { TOLERANCIA_DE_BATIDA_MS, motorParado } from "@/lib/domain/motor";

// A regra que decide se a clínica vê "as mensagens automáticas estão paradas".
//
// Ela existe porque, sem pg_cron neste projeto, um único processo executa tudo
// que é automático, e quando ele morre a Tela 2 fica idêntica à de uma clínica
// saudável: régua "ligada", consultas "pendentes", "Cobrar agora" respondendo
// sucesso. Errar para o lado de não avisar é o pior dos dois erros.

describe("motorParado", () => {
  const agora = new Date("2026-08-31T12:00:00Z");
  const atras = (ms: number) => new Date(agora.getTime() - ms).toISOString();

  it("batida recente: o motor está de pé", () => {
    expect(motorParado(atras(0), agora)).toBe(false);
    expect(motorParado(atras(30_000), agora)).toBe(false);
    // O worker bate a cada 30 segundos; duas batidas perdidas ainda não
    // significam problema.
    expect(motorParado(atras(90_000), agora)).toBe(false);
  });

  it("batida velha: avisa", () => {
    expect(motorParado(atras(TOLERANCIA_DE_BATIDA_MS + 1_000), agora)).toBe(
      true,
    );
    expect(motorParado(atras(60 * 60_000), agora)).toBe(true);
  });

  it("no limite exato ainda não avisa, um instante depois avisa", () => {
    expect(motorParado(atras(TOLERANCIA_DE_BATIDA_MS), agora)).toBe(false);
    expect(motorParado(atras(TOLERANCIA_DE_BATIDA_MS + 1), agora)).toBe(true);
  });

  it("batida nenhuma conta como parado", () => {
    // Ou o worker nunca subiu, ou está fora do ar desde antes de existir o
    // carimbo. Nos dois casos nada automático acontece.
    expect(motorParado(null, agora)).toBe(true);
    expect(motorParado(undefined, agora)).toBe(true);
  });

  it("carimbo corrompido conta como parado, nunca como saudável", () => {
    // Falhar para o lado do aviso: um carimbo ilegível não é prova de vida.
    expect(motorParado("nao-e-data", agora)).toBe(true);
    expect(motorParado("", agora)).toBe(true);
  });

  it("batida no futuro (relógio torto do servidor) não é tratada como parada", () => {
    expect(
      motorParado(new Date(agora.getTime() + 60_000).toISOString(), agora),
    ).toBe(false);
  });
});
