import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  AzureOpenAI,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  chaveDeCacheDaClinica,
  classificarErroDoLlm,
  clienteOpenAiDoAmbiente,
  CODIGOS_DE_COTA,
  criarClienteOpenAi,
  eErroDeCota,
  fetchQueNaoRepeteCota,
  haCabecalhosExtras,
  idDaRequisicao,
  identificadorDeSeguranca,
  MODELO_PADRAO_DO_AGENTE,
  modeloDoAgente,
  parametrosFixosDoAgente,
  segredoDoIdentificador,
} from "@/lib/integrations/llm/openai";

// A guarda: nos testes, "openai" e o stub de tests/stubs/openai-proibido.ts.
// Se este arquivo um dia conseguir criar um cliente de verdade, a guarda
// caiu.

describe("guarda: nenhum teste chama a OpenAI", () => {
  it("o construtor do SDK lanca nos testes", () => {
    expect(() => new OpenAI({ apiKey: "sk-teste" })).toThrow(
      /Nenhum teste chama a API/,
    );
    expect(() => new AzureOpenAI({ apiKey: "sk-teste" })).toThrow(
      /Nenhum teste chama a API/,
    );
  });

  it("a fabrica do cliente lanca nos testes, mesmo com chave", () => {
    expect(() => criarClienteOpenAi({ apiKey: "sk-teste" })).toThrow(
      /Nenhum teste chama a API/,
    );
    expect(() =>
      clienteOpenAiDoAmbiente({ OPENAI_API_KEY: "sk-teste" }),
    ).toThrow(/Nenhum teste chama a API/);
  });

  it("sem chave nao ha cliente (nem tenta)", () => {
    expect(clienteOpenAiDoAmbiente({})).toBeNull();
    expect(clienteOpenAiDoAmbiente({ OPENAI_API_KEY: "   " })).toBeNull();
    expect(() => criarClienteOpenAi({ apiKey: "  " })).toThrow(
      "Chave da OpenAI ausente.",
    );
  });

  it("a chave da transcricao e a antiga da Anthropic nunca viram cliente", () => {
    expect(
      clienteOpenAiDoAmbiente({ UAZAPI_OPENAI_KEY: "sk-uazapi" }),
    ).toBeNull();
    expect(
      clienteOpenAiDoAmbiente({ ANTHROPIC_API_KEY: "sk-ant-antiga" }),
    ).toBeNull();
  });

  it("subcaminho do SDK continua real (helpers/zod funciona)", async () => {
    const { zodTextFormat } = await import("openai/helpers/zod");
    const formato = zodTextFormat(z.object({ ok: z.boolean() }), "teste");
    expect(formato).toMatchObject({ type: "json_schema", strict: true });
  });
});

describe("OPENAI_CUSTOM_HEADERS: com ela no ambiente, nao ha cliente", () => {
  // Valor que, se o SDK lesse, trocaria a chave e o projeto da chamada.
  const INTRUSOS =
    "Authorization: Bearer sk-intrusa\nOpenAI-Project: proj_intruso";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function capturarLog() {
    const escritas: string[] = [];
    for (const saida of [process.stdout, process.stderr]) {
      vi.spyOn(saida, "write").mockImplementation((linha) => {
        escritas.push(String(linha));
        return true;
      });
    }
    return escritas;
  }

  it("presente e nao vazia conta; vazia ou so espacos nao (o SDK apara)", () => {
    expect(haCabecalhosExtras({})).toBe(false);
    expect(haCabecalhosExtras({ OPENAI_CUSTOM_HEADERS: "" })).toBe(false);
    expect(haCabecalhosExtras({ OPENAI_CUSTOM_HEADERS: " \n " })).toBe(false);
    expect(haCabecalhosExtras({ OPENAI_CUSTOM_HEADERS: INTRUSOS })).toBe(true);
    expect(haCabecalhosExtras({ OPENAI_CUSTOM_HEADERS: "X-Qualquer: 1" })).toBe(
      true,
    );
  });

  it("a fabrica devolve null (nem tenta montar) e loga so o codigo", () => {
    const escritas = capturarLog();
    // O stub do SDK lancaria se a fabrica tentasse montar o cliente: null
    // aqui prova que ela recusou antes.
    expect(
      clienteOpenAiDoAmbiente({
        OPENAI_API_KEY: "sk-teste",
        OPENAI_CUSTOM_HEADERS: INTRUSOS,
      }),
    ).toBeNull();
    const linhas = escritas.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      nivel: "error",
      evento: "ia_cliente_recusado",
      provider: "openai",
      error_code: "cabecalhos_extras_no_ambiente",
    });
    expect(escritas.join("")).not.toContain("intrus");
  });

  it("vale tambem quando so o process.env tem a variavel (e o que o SDK le)", () => {
    capturarLog();
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", INTRUSOS);
    expect(clienteOpenAiDoAmbiente({ OPENAI_API_KEY: "sk-teste" })).toBeNull();
  });

  it("criarClienteOpenAi lanca antes do construtor, sem ecoar o valor", () => {
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", INTRUSOS);
    let erro: unknown;
    try {
      criarClienteOpenAi({ apiKey: "sk-teste" });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(Error);
    const mensagem = (erro as Error).message;
    expect(mensagem).toMatch(/OPENAI_CUSTOM_HEADERS/);
    // Nao e a mensagem do stub: o construtor nem foi chamado.
    expect(mensagem).not.toMatch(/Nenhum teste chama a API/);
    expect(mensagem).not.toContain("intrus");
  });

  it("so espacos nao bloqueia (segue ate o construtor, que e o stub)", () => {
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", "   ");
    expect(() => criarClienteOpenAi({ apiKey: "sk-teste" })).toThrow(
      /Nenhum teste chama a API/,
    );
  });

  it("sem chave continua null, sem log", () => {
    const escritas = capturarLog();
    expect(
      clienteOpenAiDoAmbiente({ OPENAI_CUSTOM_HEADERS: INTRUSOS }),
    ).toBeNull();
    expect(escritas).toHaveLength(0);
  });
});

describe("classificacao de erro pelas classes tipadas", () => {
  const cabecalhos = new Headers({ "x-request-id": "req_123" });
  const segredo = "paciente disse que toma dipirona";
  const zodErro = z.object({ a: z.string() }).safeParse({}).error;

  it.each([
    [new APIUserAbortError(), "abortado", null, false],
    [new APIConnectionTimeoutError(), "timeout", null, false],
    [new APIConnectionError({ message: segredo }), "conexao", null, false],
    [
      new BadRequestError(
        400,
        { type: "invalid_request_error", message: segredo },
        segredo,
        cabecalhos,
      ),
      "requisicao_invalida",
      400,
      true,
    ],
    [
      new AuthenticationError(401, { message: segredo }, segredo, cabecalhos),
      "autenticacao",
      401,
      true,
    ],
    [
      new PermissionDeniedError(403, undefined, segredo, cabecalhos),
      "permissao",
      403,
      true,
    ],
    [
      new NotFoundError(404, undefined, segredo, cabecalhos),
      "nao_encontrado",
      404,
      true,
    ],
    [
      new RateLimitError(
        429,
        { type: "rate_limit_error", code: "rate_limit_exceeded" },
        segredo,
        cabecalhos,
      ),
      "limite",
      429,
      false,
    ],
    [
      new RateLimitError(
        429,
        { type: "insufficient_quota", code: "credit_balance_exhausted" },
        segredo,
        cabecalhos,
      ),
      "cota",
      429,
      true,
    ],
    [
      new InternalServerError(
        503,
        { type: "service_unavailable_error", code: "server_is_overloaded" },
        segredo,
        cabecalhos,
      ),
      "sobrecarga",
      503,
      false,
    ],
    [
      new InternalServerError(500, undefined, segredo, cabecalhos),
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
    [new OpenAIError(segredo), "saida_invalida", null, false],
    [new SyntaxError(segredo), "saida_invalida", null, false],
    [zodErro, "saida_invalida", null, false],
    [new Error(segredo), "desconhecida", null, false],
    ["texto solto", "desconhecida", null, false],
  ] as const)("%s vira %s", (erro, motivo, status, grave) => {
    const classificado = classificarErroDoLlm(erro);
    expect(classificado.motivo).toBe(motivo);
    expect(classificado.httpStatus).toBe(status);
    expect(classificado.grave).toBe(grave);
    expect(JSON.stringify(classificado)).not.toContain("dipirona");
  });

  it.each([...CODIGOS_DE_COTA])(
    "429 de cota (%s): motivo cota, grave, com codigo e id da requisicao",
    (codigo) => {
      const erro = new RateLimitError(
        429,
        { type: "insufficient_quota", code: codigo },
        "x",
        cabecalhos,
      );
      expect(eErroDeCota(erro)).toBe(true);
      expect(classificarErroDoLlm(erro)).toEqual({
        motivo: "cota",
        httpStatus: 429,
        codigo,
        grave: true,
        requestId: "req_123",
      });
    },
  );

  it("429 de ritmo continua limite (repetivel, nao grave)", () => {
    for (const corpo of [
      { type: "rate_limit_error", code: "rate_limit_exceeded" },
      { code: "slow_down" },
      undefined,
    ]) {
      expect(
        classificarErroDoLlm(new RateLimitError(429, corpo, "x", cabecalhos)),
      ).toMatchObject({ motivo: "limite", grave: false });
    }
  });

  it("insufficient_quota sem codigo conhecido tambem e cota", () => {
    const erro = new RateLimitError(
      429,
      { type: "insufficient_quota", code: null },
      "x",
      cabecalhos,
    );
    expect(eErroDeCota(erro)).toBe(true);
    expect(classificarErroDoLlm(erro)).toMatchObject({
      motivo: "cota",
      grave: true,
      codigo: "insufficient_quota",
    });
  });

  it("id da requisicao: so do erro HTTP e so no formato de id", () => {
    expect(
      classificarErroDoLlm(
        new InternalServerError(500, undefined, "x", cabecalhos),
      ).requestId,
    ).toBe("req_123");
    // Erro sem resposta da API nao tem id.
    expect(
      classificarErroDoLlm(new APIConnectionTimeoutError()).requestId,
    ).toBeNull();
    expect(classificarErroDoLlm(new Error("req_123")).requestId).toBeNull();
    // Cabecalho fora do formato (espaco, dois pontos, texto) nao vai.
    const torto = new InternalServerError(
      500,
      undefined,
      "x",
      new Headers({ "x-request-id": "paciente: toma dipirona" }),
    );
    expect(classificarErroDoLlm(torto).requestId).toBeNull();
  });

  it.each([
    ["req_0123456789abcdef", "req_0123456789abcdef"],
    ["req-abc_DEF", "req-abc_DEF"],
    ["", null],
    ["req 123", null],
    ["req_1;drop", null],
    ["x".repeat(129), null],
    [123, null],
    [null, null],
    [undefined, null],
  ] as const)("idDaRequisicao(%j) e %j", (valor, esperado) => {
    expect(idDaRequisicao(valor)).toBe(esperado);
  });

  it("codigo da API so passa se for um conhecido", () => {
    const desconhecido = new RateLimitError(
      429,
      { type: "dipirona", code: "dipirona" },
      "x",
      cabecalhos,
    );
    expect(classificarErroDoLlm(desconhecido).codigo).toBeNull();
    expect(eErroDeCota(desconhecido)).toBe(false);
    expect(eErroDeCota(new Error("credit_balance_exhausted"))).toBe(false);
  });
});

describe("fetch do cliente: 429 de cota nao e repetido", () => {
  const URL = "https://api.openai.com/v1/responses";

  function baseQueResponde(status: number, corpo: string) {
    return vi.fn<typeof fetch>(
      async () =>
        new Response(corpo, {
          status,
          headers: { "content-type": "application/json", "x-request-id": "r" },
        }),
    );
  }

  it("resposta que nao e 429 passa intacta (o mesmo objeto)", async () => {
    const original = new Response("{}", { status: 200 });
    const base = vi.fn(async () => original);
    const resposta = await fetchQueNaoRepeteCota(base)(URL, { method: "POST" });
    expect(resposta).toBe(original);
    expect(base).toHaveBeenCalledWith(URL, { method: "POST" });
  });

  it.each([...CODIGOS_DE_COTA])(
    "%s volta com x-should-retry: false e o mesmo corpo",
    async (codigo) => {
      const corpo = JSON.stringify({
        error: { type: "insufficient_quota", code: codigo, message: "m" },
      });
      const resposta = await fetchQueNaoRepeteCota(baseQueResponde(429, corpo))(
        URL,
      );
      expect(resposta.status).toBe(429);
      expect(resposta.headers.get("x-should-retry")).toBe("false");
      expect(resposta.headers.get("x-request-id")).toBe("r");
      expect(await resposta.text()).toBe(corpo);
    },
  );

  it.each([
    [
      "limite de ritmo",
      JSON.stringify({
        error: { type: "rate_limit_error", code: "rate_limit_exceeded" },
      }),
    ],
    ["slow_down", JSON.stringify({ error: { code: "slow_down" } })],
    ["corpo que nao e JSON", "<html>muitas requisicoes</html>"],
    ["JSON sem error", JSON.stringify({ code: "credit_balance_exhausted" })],
  ])("429 de %s continua repetivel", async (_caso, corpo) => {
    const resposta = await fetchQueNaoRepeteCota(baseQueResponde(429, corpo))(
      URL,
    );
    expect(resposta.status).toBe(429);
    expect(resposta.headers.get("x-should-retry")).toBeNull();
    expect(await resposta.text()).toBe(corpo);
  });
});

describe("identificador de seguranca (HMAC, nunca telefone)", () => {
  const segredo = "s".repeat(40);
  const base = {
    clinicId: "acd9c539-585e-4f2a-a195-712c70099564",
    contactId: "3f2b8c1e-9d4a-4b7e-8c2f-1a6d5e9b0c7d",
    segredo,
  };

  it("64 caracteres hex, estavel e sem as ids", () => {
    const id = identificadorDeSeguranca(base);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(identificadorDeSeguranca(base)).toBe(id);
    expect(
      identificadorDeSeguranca({
        ...base,
        clinicId: base.clinicId.toUpperCase(),
      }),
    ).toBe(id);
    expect(id).not.toContain(base.clinicId.slice(0, 8));
    expect(id).not.toContain(base.contactId.slice(0, 8));
  });

  it("muda com o contato, com a clinica e com o segredo", () => {
    const id = identificadorDeSeguranca(base);
    expect(
      identificadorDeSeguranca({
        ...base,
        contactId: "00000000-0000-4000-8000-000000000000",
      }),
    ).not.toBe(id);
    expect(
      identificadorDeSeguranca({
        ...base,
        clinicId: "f0c115dd-e98c-4767-a1bb-93d517844852",
      }),
    ).not.toBe(id);
    expect(
      identificadorDeSeguranca({ ...base, segredo: "t".repeat(40) }),
    ).not.toBe(id);
  });

  it("sem segredo ou com segredo curto: null", () => {
    for (const ruim of [undefined, null, "", "   ", "curto-demais"]) {
      expect(identificadorDeSeguranca({ ...base, segredo: ruim })).toBeNull();
    }
  });

  it("segredo vem so de IA_SEGREDO_DO_IDENTIFICADOR", () => {
    expect(segredoDoIdentificador({})).toBeNull();
    expect(segredoDoIdentificador({ IA_SEGREDO_DO_IDENTIFICADOR: " " })).toBe(
      null,
    );
    expect(
      segredoDoIdentificador({ IA_SEGREDO_DO_IDENTIFICADOR: ` ${segredo} ` }),
    ).toBe(segredo);
    expect(segredoDoIdentificador({ OPENAI_API_KEY: segredo })).toBeNull();
  });

  it("chave de cache por clinica: so papel e id da clinica", () => {
    expect(
      chaveDeCacheDaClinica("agente", "ACD9C539-585E-4F2A-A195-712C70099564"),
    ).toBe("conduzza:agente:acd9c539-585e-4f2a-a195-712c70099564");
  });
});

describe("modelo do agente (E2, lista fechada)", () => {
  it("vazio usa o gpt-6-luna", () => {
    expect(MODELO_PADRAO_DO_AGENTE).toBe("gpt-6-luna");
    expect(modeloDoAgente({})).toBe("gpt-6-luna");
    expect(modeloDoAgente({ IA_MODELO_AGENTE: "  " })).toBe("gpt-6-luna");
  });

  it("aceita a alternativa gpt-6.1-sol", () => {
    expect(modeloDoAgente({ IA_MODELO_AGENTE: " gpt-6.1-sol " })).toBe(
      "gpt-6.1-sol",
    );
  });

  it("fora da lista devolve null (nunca um modelo nao avaliado)", () => {
    for (const valor of [
      "claude-opus-5",
      "claude-sonnet-5",
      "gpt-6-astra",
      "gpt-5-mini",
      "GPT-6-LUNA",
      "toString",
      "constructor",
    ]) {
      expect(modeloDoAgente({ IA_MODELO_AGENTE: valor }), valor).toBeNull();
    }
  });

  it.each(["gpt-6-luna", "gpt-6.1-sol"] as const)(
    "%s: store false, raciocinio low cifrado, sem temperature",
    (modelo) => {
      const parametros = parametrosFixosDoAgente(modelo);
      expect(parametros).toEqual({
        model: modelo,
        reasoning: { effort: "low" },
        include: ["reasoning.encrypted_content"],
        store: false,
        service_tier: "default",
      });
      expect(parametros).not.toHaveProperty("temperature");
      expect(parametros).not.toHaveProperty("previous_response_id");
    },
  );
});
