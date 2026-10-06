import { OpenAI as SdkReal } from "openai/client";
import { APIConnectionError } from "openai/error";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSemRedeDeLlm,
  hostProibido,
  MENSAGEM_DA_TRAVA_DE_REDE,
  travaDeRedeInstalada,
} from "@/tests/setup/sem-rede-de-llm";

// A trava de rede dos testes (tests/setup/sem-rede-de-llm.ts, setupFiles
// das tres configs do vitest). O alias de "openai" so pega o nome exato do
// pacote; aqui o SDK vem de "openai/client", que o alias NAO cobre, e mesmo
// assim a chamada nao sai: o fetch global recusa o host antes da rede.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a trava esta ligada em todo arquivo de teste", () => {
  it("o fetch global e o embrulhado", () => {
    expect(travaDeRedeInstalada(globalThis.fetch)).toBe(true);
  });

  it("fetch direto para a OpenAI ou a Anthropic rejeita", async () => {
    // Sem a trava, este teste mandaria um POST de verdade: para antes.
    expect(travaDeRedeInstalada(globalThis.fetch)).toBe(true);
    for (const url of [
      "https://api.openai.com/v1/responses",
      "https://api.anthropic.com/v1/messages",
    ]) {
      await expect(globalThis.fetch(url, { method: "POST" })).rejects.toThrow(
        MENSAGEM_DA_TRAVA_DE_REDE,
      );
    }
  });

  it("um fetch falso injetado continua valendo, e a trava volta depois", async () => {
    const falso = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", falso);
    const resposta = await globalThis.fetch("https://api.openai.com/v1/x");
    expect(await resposta.text()).toBe("ok");
    vi.unstubAllGlobals();
    expect(travaDeRedeInstalada(globalThis.fetch)).toBe(true);
  });
});

describe("SDK real por 'openai/client' sem fetch falso", () => {
  it("a chamada lanca (erro de conexao com a trava como causa)", async () => {
    // Sem a trava, este teste chamaria a OpenAI de verdade: para antes.
    expect(travaDeRedeInstalada(globalThis.fetch)).toBe(true);
    const cliente = new SdkReal({
      apiKey: "sk-falsa-de-teste",
      organization: null,
      project: null,
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      logLevel: "off",
    });
    let erro: unknown;
    try {
      await cliente.responses.create({
        model: "gpt-6-luna",
        input: "sintetico",
        store: false,
      });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(APIConnectionError);
    expect((erro as { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect(((erro as { cause: Error }).cause as Error).message).toBe(
      MENSAGEM_DA_TRAVA_DE_REDE,
    );
  });
});

describe("hosts proibidos", () => {
  it.each([
    "https://api.openai.com/v1/responses",
    "https://openai.com",
    "https://API.OPENAI.COM/v1/responses",
    "https://api.openai.com./v1/responses",
    "https://files.oaiusercontent.openai.com/x",
    "https://api.anthropic.com/v1/messages",
    "http://anthropic.com:8080/",
  ])("%s e proibido (texto, URL e Request)", (url) => {
    expect(hostProibido(url)).toBe(true);
    expect(hostProibido(new URL(url))).toBe(true);
    expect(hostProibido(new Request(url))).toBe(true);
  });

  it.each([
    "http://127.0.0.1:54321/rest/v1/clinic",
    "https://imizkroxevcawomvgrbn.supabase.co/rest/v1/clinic",
    "https://climb.uazapi.com/send/text",
    "https://openai.com.exemplo.net/",
    "nao e url",
  ])("%s passa para o fetch de baixo", async (url) => {
    expect(hostProibido(url)).toBe(false);
    const base = vi.fn<typeof fetch>(async () => new Response("ok"));
    const resposta = await fetchSemRedeDeLlm(base)(url, { method: "GET" });
    expect(await resposta.text()).toBe("ok");
    expect(base).toHaveBeenCalledWith(url, { method: "GET" });
  });

  it("host proibido nunca chega ao fetch de baixo", async () => {
    const base = vi.fn<typeof fetch>(async () => new Response("ok"));
    await expect(
      fetchSemRedeDeLlm(base)("https://api.openai.com/v1/responses"),
    ).rejects.toThrow(MENSAGEM_DA_TRAVA_DE_REDE);
    expect(base).not.toHaveBeenCalled();
  });
});
