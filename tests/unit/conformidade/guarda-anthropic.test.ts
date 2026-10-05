import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import {
  classificarErroDoLlm,
  clienteAnthropicDoAmbiente,
  criarClienteAnthropic,
} from "@/lib/integrations/llm/anthropic";

// A guarda: nos testes, "@anthropic-ai/sdk" e o stub de
// tests/stubs/anthropic-proibido.ts. Se este arquivo um dia conseguir criar
// um cliente de verdade, a guarda caiu.

describe("guarda: nenhum teste chama a Anthropic", () => {
  it("o construtor do SDK lanca nos testes", () => {
    expect(() => new Anthropic({ apiKey: "sk-ant-teste" })).toThrow(
      /Nenhum teste chama a API/,
    );
  });

  it("a fabrica do cliente lanca nos testes, mesmo com chave", () => {
    expect(() => criarClienteAnthropic({ apiKey: "sk-ant-teste" })).toThrow(
      /Nenhum teste chama a API/,
    );
    expect(() =>
      clienteAnthropicDoAmbiente({ ANTHROPIC_API_KEY: "sk-ant-teste" }),
    ).toThrow(/Nenhum teste chama a API/);
  });

  it("sem chave nao ha cliente (nem tenta)", () => {
    expect(clienteAnthropicDoAmbiente({})).toBeNull();
    expect(clienteAnthropicDoAmbiente({ ANTHROPIC_API_KEY: "   " })).toBeNull();
  });

  it("subcaminho do SDK continua real (helpers/zod funciona)", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    expect(typeof zodOutputFormat).toBe("function");
  });
});

describe("classificacao de erro pelas classes tipadas", () => {
  const cabecalhos = new Headers();
  const segredo = "paciente disse que toma dipirona";

  it.each([
    [new APIUserAbortError(), "abortado", null, false],
    [new APIConnectionTimeoutError(), "timeout", null, false],
    [new APIConnectionError({ message: segredo }), "conexao", null, false],
    [
      new BadRequestError(
        400,
        undefined,
        segredo,
        cabecalhos,
        "invalid_request_error",
      ),
      "requisicao_invalida",
      400,
      true,
    ],
    [
      new AuthenticationError(
        401,
        undefined,
        segredo,
        cabecalhos,
        "authentication_error",
      ),
      "autenticacao",
      401,
      true,
    ],
    [
      new PermissionDeniedError(
        403,
        undefined,
        segredo,
        cabecalhos,
        "permission_error",
      ),
      "permissao",
      403,
      true,
    ],
    [
      new NotFoundError(404, undefined, segredo, cabecalhos, "not_found_error"),
      "nao_encontrado",
      404,
      true,
    ],
    [
      new RateLimitError(
        429,
        undefined,
        segredo,
        cabecalhos,
        "rate_limit_error",
      ),
      "limite",
      429,
      false,
    ],
    [
      new InternalServerError(
        529,
        undefined,
        segredo,
        cabecalhos,
        "overloaded_error",
      ),
      "sobrecarga",
      529,
      false,
    ],
    [
      new InternalServerError(500, undefined, segredo, cabecalhos, "api_error"),
      "servidor",
      500,
      false,
    ],
    [
      new APIError(418, undefined, segredo, cabecalhos),
      "outro_http",
      418,
      false,
    ],
    [new AnthropicError(segredo), "saida_invalida", null, false],
    [new Error(segredo), "desconhecida", null, false],
    ["texto solto", "desconhecida", null, false],
  ] as const)("%s vira %s", (erro, motivo, status, grave) => {
    const classificado = classificarErroDoLlm(erro);
    expect(classificado.motivo).toBe(motivo);
    expect(classificado.httpStatus).toBe(status);
    expect(classificado.grave).toBe(grave);
    expect(JSON.stringify(classificado)).not.toContain("dipirona");
  });

  it("codigo da API so passa se for um tipo conhecido", () => {
    expect(
      classificarErroDoLlm(
        new RateLimitError(429, undefined, "x", cabecalhos, "rate_limit_error"),
      ).codigo,
    ).toBe("rate_limit_error");
    expect(
      classificarErroDoLlm(
        new RateLimitError(
          429,
          undefined,
          "x",
          cabecalhos,
          "dipirona" as never,
        ),
      ).codigo,
    ).toBeNull();
  });
});
