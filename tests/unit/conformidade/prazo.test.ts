import { describe, expect, it } from "vitest";

import {
  classificarComPrazo,
  correrComPrazo,
} from "@/lib/domain/conformidade/prazo";

// O corte duro que o filtro e o portao de entrada usam nas chamadas por
// modelo: sempre um valor, um erro ou o prazo; nunca rejeita, nunca fica
// pendurado.

describe("correrComPrazo", () => {
  it("devolve o valor", async () => {
    await expect(correrComPrazo(async () => 42, 50)).resolves.toEqual({
      tipo: "resultado",
      valor: 42,
    });
  });

  it("excecao sincrona ou assincrona vira erro", async () => {
    await expect(
      correrComPrazo(() => {
        throw new Error("boom");
      }, 50),
    ).resolves.toEqual({ tipo: "erro" });
    await expect(
      correrComPrazo(async () => Promise.reject(new Error("boom")), 50),
    ).resolves.toEqual({ tipo: "erro" });
  });

  it("estoura o prazo e aborta o sinal", async () => {
    let sinal: AbortSignal | undefined;
    const corrida = await correrComPrazo((s) => {
      sinal = s;
      return new Promise(() => undefined);
    }, 10);
    expect(corrida).toEqual({ tipo: "prazo" });
    expect(sinal?.aborted).toBe(true);
  });
});

describe("classificarComPrazo", () => {
  it("devolve o que o classificador devolveu", async () => {
    const resultado = { tipo: "classificacao", x: 1 };
    await expect(
      classificarComPrazo(async () => resultado, ["oi"], 50),
    ).resolves.toBe(resultado);
  });

  it("falha fechada para classificador ausente, prazo vazio, erro e demora", async () => {
    await expect(
      classificarComPrazo(undefined as never, ["oi"]),
    ).resolves.toMatchObject({ tipo: "falha", motivo: "sem_cliente" });
    await expect(
      classificarComPrazo(async () => 1, ["oi"], 0),
    ).resolves.toMatchObject({ tipo: "falha", motivo: "prazo" });
    await expect(
      classificarComPrazo(
        () => {
          throw new Error("boom");
        },
        ["oi"],
        50,
      ),
    ).resolves.toMatchObject({ tipo: "falha", motivo: "desconhecida" });
    await expect(
      classificarComPrazo(() => new Promise(() => undefined), ["oi"], 10),
    ).resolves.toMatchObject({ tipo: "falha", motivo: "timeout" });
  });
});
