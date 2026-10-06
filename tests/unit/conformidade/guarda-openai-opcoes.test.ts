import { OpenAI as ClienteRealDoSdk } from "openai/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  criarClienteOpenAi,
  fetchQueNaoRepeteCota,
  PRAZO_PADRAO_DO_CLIENTE_MS,
  TENTATIVAS_EXTRAS,
} from "@/lib/integrations/llm/openai";

// Duas provas sobre o cliente, sem rede:
//  1) o que criarClienteOpenAi passa ao construtor do SDK (o "openai" deste
//     arquivo e um construtor que so anota as opcoes; nada sai daqui);
//  2) o SDK de verdade obedece o x-should-retry que o nosso fetch marca no
//     429 de cota. Unico lugar dos testes que monta o cliente real do SDK
//     (subcaminho "openai/client"), e so com um fetch FALSO: o fetch global
//     e trocado por um que lanca, entao nenhuma requisicao sai da maquina.

const { opcoesRecebidas } = vi.hoisted(() => ({
  opcoesRecebidas: [] as Array<Record<string, unknown>>,
}));

vi.mock("openai", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  class ClienteQueSoAnota {
    constructor(opcoes: Record<string, unknown>) {
      opcoesRecebidas.push(opcoes);
    }
  }
  return { ...original, default: ClienteQueSoAnota, OpenAI: ClienteQueSoAnota };
});

afterEach(() => {
  opcoesRecebidas.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("opcoes do cliente", () => {
  it("chave explicita, URL fixa, log mudo, prazo e uma tentativa extra", () => {
    // Nada do ambiente entra: nem URL, nem organizacao, nem projeto, nem log.
    vi.stubEnv("OPENAI_BASE_URL", "https://desvio.exemplo.com/v1");
    vi.stubEnv("OPENAI_ORG_ID", "org-de-outro");
    vi.stubEnv("OPENAI_PROJECT_ID", "proj-de-outro");
    vi.stubEnv("OPENAI_LOG", "debug");

    criarClienteOpenAi({ apiKey: "  sk-teste  " });

    expect(opcoesRecebidas).toHaveLength(1);
    const opcoes = opcoesRecebidas[0] ?? {};
    expect(opcoes).toMatchObject({
      apiKey: "sk-teste",
      organization: null,
      project: null,
      adminAPIKey: null,
      webhookSecret: null,
      baseURL: "https://api.openai.com/v1",
      timeout: PRAZO_PADRAO_DO_CLIENTE_MS,
      maxRetries: TENTATIVAS_EXTRAS,
      logLevel: "off",
    });
    expect(TENTATIVAS_EXTRAS).toBe(1);
    expect(opcoes).not.toHaveProperty("dataResidency");
    expect(opcoes).not.toHaveProperty("provider");
    expect(typeof opcoes.fetch).toBe("function");
    const logger = opcoes.logger as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    for (const nivel of ["error", "warn", "info", "debug"]) {
      expect(logger[nivel]?.("texto do paciente")).toBeUndefined();
    }
  });

  it("prazo do cliente pode ser menor por parametro", () => {
    criarClienteOpenAi({ apiKey: "sk-teste", timeoutMs: 5_000 });
    expect(opcoesRecebidas[0]).toMatchObject({ timeout: 5_000 });
  });
});

describe("o SDK de verdade obedece o x-should-retry do nosso fetch", () => {
  function clienteComFetchFalso(corpo: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede proibida nos testes");
      }),
    );
    const base = vi.fn<typeof fetch>(
      async () =>
        new Response(corpo, {
          status: 429,
          headers: {
            "content-type": "application/json",
            // Pede espera de 1 ms para a nova tentativa ser rapida no teste.
            "retry-after-ms": "1",
          },
        }),
    );
    const cliente = new ClienteRealDoSdk({
      apiKey: "sk-falsa-de-teste",
      organization: null,
      project: null,
      baseURL: "https://api.openai.com/v1",
      maxRetries: TENTATIVAS_EXTRAS,
      logLevel: "off",
      fetch: fetchQueNaoRepeteCota(base),
    });
    return { cliente, base };
  }

  it("429 de cota: uma chamada so, sem nova tentativa", async () => {
    const { cliente, base } = clienteComFetchFalso(
      JSON.stringify({
        error: {
          type: "insufficient_quota",
          code: "project_spend_limit_exceeded",
          message: "limite",
        },
      }),
    );
    await expect(
      cliente.responses.create({
        model: "gpt-6-luna",
        input: "sintetico",
        store: false,
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: "project_spend_limit_exceeded",
    });
    expect(base).toHaveBeenCalledTimes(1);
    expect(String(base.mock.calls[0]?.[0])).toBe(
      "https://api.openai.com/v1/responses",
    );
  });

  it("429 de ritmo: o SDK repete uma vez (maxRetries 1)", async () => {
    const { cliente, base } = clienteComFetchFalso(
      JSON.stringify({
        error: { type: "rate_limit_error", code: "rate_limit_exceeded" },
      }),
    );
    await expect(
      cliente.responses.create({
        model: "gpt-6-luna",
        input: "sintetico",
        store: false,
      }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limit_exceeded" });
    expect(base).toHaveBeenCalledTimes(2);
  });
});
