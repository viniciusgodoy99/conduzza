import { describe, expect, it } from "vitest";

import {
  acharNumeroPeloSegredo,
  lerIdentificacaoDoWebhook,
  segredosIguais,
} from "@/lib/integrations/whatsapp/segredo-do-webhook";

// Varios numeros por clinica, Fase 2 (docs/07, Compatibilidade): a URL nova
// diz o numero (?account=); a legada (so ?clinic=) acha o numero pelo segredo.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("lerIdentificacaoDoWebhook", () => {
  it("URL nova: numero, clinica e segredo", () => {
    expect(
      lerIdentificacaoDoWebhook(
        params(`clinic=${CLINICA}&account=${NUMERO}&secret=abc`),
      ),
    ).toEqual({
      tipo: "numero",
      accountId: NUMERO,
      clinicId: CLINICA,
      segredo: "abc",
    });
  });

  it("URL nova sem clinica ainda identifica pelo numero", () => {
    expect(
      lerIdentificacaoDoWebhook(params(`account=${NUMERO}&secret=abc`)),
    ).toEqual({
      tipo: "numero",
      accountId: NUMERO,
      clinicId: null,
      segredo: "abc",
    });
  });

  it("URL legada (so clinica) continua valendo", () => {
    expect(
      lerIdentificacaoDoWebhook(params(`clinic=${CLINICA}&secret=abc`)),
    ).toEqual({ tipo: "legado", clinicId: CLINICA, segredo: "abc" });
  });

  it("ids em maiuscula viram minuscula (o banco devolve minuscula)", () => {
    const ident = lerIdentificacaoDoWebhook(
      params(
        `clinic=${CLINICA.toUpperCase()}&account=${NUMERO.toUpperCase()}&secret=abc`,
      ),
    );
    expect(ident).toMatchObject({ accountId: NUMERO, clinicId: CLINICA });
  });

  it.each([
    ["sem segredo", `clinic=${CLINICA}&account=${NUMERO}`],
    ["segredo vazio", `clinic=${CLINICA}&secret=`],
    ["sem clinica nem numero", "secret=abc"],
    ["clinica malformada", "clinic=nao-e-uuid&secret=abc"],
    ["numero malformado", `clinic=${CLINICA}&account=x&secret=abc`],
    // ?account= presente e vazio NAO cai no caminho legado por acidente.
    ["numero vazio", `clinic=${CLINICA}&account=&secret=abc`],
    [
      "numero certo com clinica malformada",
      `clinic=x&account=${NUMERO}&secret=abc`,
    ],
  ])("recusa: %s", (_caso, query) => {
    expect(lerIdentificacaoDoWebhook(params(query))).toBeNull();
  });
});

describe("segredosIguais", () => {
  it("igual e igual, diferente e diferente", () => {
    expect(segredosIguais("segredo-certo", "segredo-certo")).toBe(true);
    expect(segredosIguais("segredo-certo", "segredo-errad")).toBe(false);
  });

  it("tamanhos diferentes nao lancam (timingSafeEqual exige o mesmo tamanho)", () => {
    expect(() => segredosIguais("curto", "bem-mais-comprido")).not.toThrow();
    expect(segredosIguais("curto", "bem-mais-comprido")).toBe(false);
    expect(segredosIguais("algo", "")).toBe(false);
  });
});

describe("acharNumeroPeloSegredo (URL legada)", () => {
  const candidatos = [
    { account_id: "a", webhook_secret: "segredo-do-a" },
    { account_id: "b", webhook_secret: "segredo-do-b" },
  ];

  it("acha o numero cujo segredo bate", () => {
    expect(acharNumeroPeloSegredo(candidatos, "segredo-do-b")?.account_id).toBe(
      "b",
    );
    expect(acharNumeroPeloSegredo(candidatos, "segredo-do-a")?.account_id).toBe(
      "a",
    );
  });

  it("nenhum bate: null", () => {
    expect(acharNumeroPeloSegredo(candidatos, "outro")).toBeNull();
    expect(acharNumeroPeloSegredo([], "segredo-do-a")).toBeNull();
  });
});
