import { OpenAI as SdkReal } from "openai/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clienteOpenAiDoAmbiente,
  criarClienteOpenAi,
  fetchComCabecalhosFixos,
} from "@/lib/integrations/llm/openai";

// OPENAI_CUSTOM_HEADERS e os cabecalhos de autenticacao, com o SDK DE
// VERDADE e um fetch FALSO (nada sai da maquina; a trava de
// tests/setup/sem-rede-de-llm.ts barraria de qualquer jeito). Provas:
//  1) o risco existe: o SDK 7.28 poe os cabecalhos da variavel por cima da
//     chave e do projeto;
//  2) com a variavel no ambiente, a nossa fabrica nao monta cliente (falha
//     fechada) e o construtor nem e chamado;
//  3) o fetch do nosso cliente reescreve Authorization com a NOSSA chave e
//     apaga OpenAI-Organization e OpenAI-Project, venha o cabecalho de onde
//     vier (opcao por chamada ou a propria variavel).
//
// Aqui o "openai" que lib/integrations/llm/openai.ts importa e o SDK real
// (subcaminho "openai/client") com um construtor que anota as opcoes; as
// classes de erro continuam as do stub.

const { construidos } = vi.hoisted(() => ({
  construidos: [] as Array<Record<string, unknown>>,
}));

vi.mock("openai", async (importOriginal) => {
  const stub = await importOriginal<Record<string, unknown>>();
  const { OpenAI: Real } = await import("openai/client");
  class ClienteRealAnotado extends Real {
    constructor(opcoes: ConstructorParameters<typeof Real>[0]) {
      construidos.push({ ...opcoes });
      super(opcoes);
    }
  }
  return { ...stub, default: ClienteRealAnotado, OpenAI: ClienteRealAnotado };
});

const NOSSA_CHAVE = "sk-nossa-de-teste";
const INTRUSOS = [
  "Authorization: Bearer sk-intrusa",
  "OpenAI-Organization: org-intrusa",
  "OpenAI-Project: proj_intruso",
].join("\n");

const RESPOSTA_MINIMA = {
  id: "resp_teste",
  object: "response",
  status: "completed",
  model: "gpt-6-luna",
  output: [],
};

/** fetch falso: anota URL e cabecalhos e responde 200 sem rede. */
function fetchFalso() {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(RESPOSTA_MINIMA), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_teste",
        },
      }),
  );
}

function cabecalhosDaChamada(falso: ReturnType<typeof fetchFalso>, i = 0) {
  const [, opcoes] = falso.mock.calls[i] ?? [];
  return new Headers(opcoes?.headers);
}

const PARAMETROS = {
  model: "gpt-6-luna",
  input: "sintetico",
  store: false,
} as const;

afterEach(() => {
  construidos.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("o risco: o SDK obedece OPENAI_CUSTOM_HEADERS", () => {
  it("sem a nossa trava, a chamada sai com a chave e o projeto de fora", async () => {
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", INTRUSOS);
    const falso = fetchFalso();
    const cliente = new SdkReal({
      apiKey: NOSSA_CHAVE,
      organization: null,
      project: null,
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      logLevel: "off",
      fetch: falso,
    });
    await cliente.responses.create(PARAMETROS);
    const enviados = cabecalhosDaChamada(falso);
    expect(enviados.get("authorization")).toBe("Bearer sk-intrusa");
    expect(enviados.get("openai-organization")).toBe("org-intrusa");
    expect(enviados.get("openai-project")).toBe("proj_intruso");
  });
});

describe("falha fechada com OPENAI_CUSTOM_HEADERS no ambiente", () => {
  it("criarClienteOpenAi lanca e o SDK nem e construido", () => {
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", INTRUSOS);
    const falso = fetchFalso();
    vi.stubGlobal("fetch", falso);
    expect(() => criarClienteOpenAi({ apiKey: NOSSA_CHAVE })).toThrow(
      /OPENAI_CUSTOM_HEADERS/,
    );
    expect(construidos).toHaveLength(0);
    expect(falso).not.toHaveBeenCalled();
  });

  it("a fabrica do ambiente devolve null e o SDK nem e construido", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", INTRUSOS);
    expect(clienteOpenAiDoAmbiente({ OPENAI_API_KEY: NOSSA_CHAVE })).toBeNull();
    expect(construidos).toHaveLength(0);
  });
});

describe("o fetch do cliente fixa a chave e tira organizacao e projeto", () => {
  it("cliente da fabrica: cabecalho por chamada nao troca a chave nem o projeto", async () => {
    const falso = fetchFalso();
    vi.stubGlobal("fetch", falso);
    const cliente = criarClienteOpenAi({ apiKey: NOSSA_CHAVE });
    expect(construidos).toHaveLength(1);

    const resposta = await cliente.responses.create(PARAMETROS, {
      headers: {
        Authorization: "Bearer sk-intrusa",
        "OpenAI-Organization": "org-intrusa",
        "OpenAI-Project": "proj_intruso",
      },
    });

    expect(falso).toHaveBeenCalledTimes(1);
    expect(String(falso.mock.calls[0]?.[0])).toBe(
      "https://api.openai.com/v1/responses",
    );
    const enviados = cabecalhosDaChamada(falso);
    expect(enviados.get("authorization")).toBe(`Bearer ${NOSSA_CHAVE}`);
    expect(enviados.has("openai-organization")).toBe(false);
    expect(enviados.has("openai-project")).toBe(false);
    // O id da requisicao chega para o log (nunca o corpo).
    expect(resposta._request_id).toBe("req_teste");
  });

  it("cliente da fabrica sem nada de fora: so a nossa chave, sem organizacao nem projeto", async () => {
    const falso = fetchFalso();
    vi.stubGlobal("fetch", falso);
    await criarClienteOpenAi({ apiKey: NOSSA_CHAVE }).responses.create(
      PARAMETROS,
    );
    const enviados = cabecalhosDaChamada(falso);
    expect(enviados.get("authorization")).toBe(`Bearer ${NOSSA_CHAVE}`);
    expect(enviados.has("openai-organization")).toBe(false);
    expect(enviados.has("openai-project")).toBe(false);
  });

  it("segunda trava: mesmo com a variavel lida pelo SDK, sai a nossa chave", async () => {
    // Simula a primeira trava furada: o SDK real le OPENAI_CUSTOM_HEADERS,
    // mas o fetch embrulhado reescreve antes de enviar.
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", INTRUSOS);
    const falso = fetchFalso();
    const cliente = new SdkReal({
      apiKey: NOSSA_CHAVE,
      organization: null,
      project: null,
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      logLevel: "off",
      fetch: fetchComCabecalhosFixos(falso, NOSSA_CHAVE),
    });
    await cliente.responses.create(PARAMETROS);
    const enviados = cabecalhosDaChamada(falso);
    expect(enviados.get("authorization")).toBe(`Bearer ${NOSSA_CHAVE}`);
    expect(enviados.has("openai-organization")).toBe(false);
    expect(enviados.has("openai-project")).toBe(false);
  });

  it("o embrulho preserva o resto (metodo, corpo, outros cabecalhos)", async () => {
    const falso = fetchFalso();
    const embrulhado = fetchComCabecalhosFixos(falso, NOSSA_CHAVE);
    await embrulhado("https://api.openai.com/v1/responses", {
      method: "POST",
      body: "{}",
      headers: [
        ["content-type", "application/json"],
        ["openai-project", "proj_intruso"],
      ],
    });
    const [url, opcoes] = falso.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(opcoes).toMatchObject({ method: "POST", body: "{}" });
    const enviados = new Headers(opcoes?.headers);
    expect(enviados.get("content-type")).toBe("application/json");
    expect(enviados.get("authorization")).toBe(`Bearer ${NOSSA_CHAVE}`);
    expect(enviados.has("openai-project")).toBe(false);
  });

  it("Request sem opcoes: os cabecalhos dele tambem passam pela troca", async () => {
    const falso = fetchFalso();
    const embrulhado = fetchComCabecalhosFixos(falso, NOSSA_CHAVE);
    await embrulhado(
      new Request("https://api.openai.com/v1/responses", {
        headers: {
          Authorization: "Bearer sk-intrusa",
          "OpenAI-Organization": "org-intrusa",
          Accept: "application/json",
        },
      }),
    );
    const enviados = cabecalhosDaChamada(falso);
    expect(enviados.get("authorization")).toBe(`Bearer ${NOSSA_CHAVE}`);
    expect(enviados.has("openai-organization")).toBe(false);
    expect(enviados.get("accept")).toBe("application/json");
  });
});
