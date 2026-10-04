import { describe, expect, it } from "vitest";

import {
  acaoDoProblema,
  classificarErroAds,
  classificarErroOAuth,
  criarContexto,
  ehTransitorio,
  ESPERA_DO_LIMITE_PADRAO_MS,
  esperaDoBackoff,
  esperaDoRetryDelay,
  lerRequestId,
  pedir,
  PROBLEMAS_GOOGLE,
  type ProblemaGoogle,
} from "@/lib/integrations/google/erros";

// Classificacao dos erros do Google e politica de tentativa (F2.2), com
// fetch falso: nada de rede.

const MENSAGEM_DO_GOOGLE = "User doesn't have permission SEGREDO-DA-MENSAGEM";

function erroAds(
  http: number,
  status: string,
  errorCode: Record<string, string> | null,
  extra: { requestId?: string; quotaRetryDelay?: string; reason?: string } = {},
): unknown {
  const details: Record<string, unknown>[] = [];
  if (errorCode) {
    details.push({
      "@type":
        "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
      errors: [
        {
          errorCode,
          message: MENSAGEM_DO_GOOGLE,
          ...(extra.quotaRetryDelay
            ? {
                details: {
                  quotaErrorDetails: {
                    rateScope: "DEVELOPER",
                    rateName: "Requests per developer per day",
                    retryDelay: extra.quotaRetryDelay,
                  },
                },
              }
            : {}),
        },
      ],
      requestId: extra.requestId ?? "reqAbc123",
    });
  }
  if (extra.reason) {
    details.push({
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: extra.reason,
      domain: "googleapis.com",
    });
  }
  return {
    error: { code: http, message: MENSAGEM_DO_GOOGLE, status, details },
  };
}

const SEM_CABECALHO = new Headers();

describe("classificarErroAds", () => {
  const casos: Array<{
    nome: string;
    http: number;
    status: string;
    codigo: Record<string, string> | null;
    reason?: string;
    problema: ProblemaGoogle;
  }> = [
    {
      nome: "USER_PERMISSION_DENIED",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: { authorizationError: "USER_PERMISSION_DENIED" },
      problema: "sem_permissao",
    },
    {
      nome: "AUTHORIZATION_ERROR generico",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: { authorizationError: "ACTION_NOT_PERMITTED" },
      problema: "sem_permissao",
    },
    {
      nome: "CUSTOMER_NOT_ENABLED",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: { authorizationError: "CUSTOMER_NOT_ENABLED" },
      problema: "conta_inativa",
    },
    {
      nome: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: {
        authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
      },
      problema: "projeto_sem_acesso",
    },
    {
      nome: "DEVELOPER_TOKEN residual",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" },
      problema: "projeto_sem_acesso",
    },
    {
      nome: "AUTHENTICATION_ERROR generico",
      http: 401,
      status: "UNAUTHENTICATED",
      codigo: { authenticationError: "AUTHENTICATION_ERROR" },
      problema: "credencial_invalida",
    },
    {
      nome: "OAUTH_TOKEN_REVOKED",
      http: 401,
      status: "UNAUTHENTICATED",
      codigo: { authenticationError: "OAUTH_TOKEN_REVOKED" },
      problema: "token_revogado",
    },
    {
      nome: "OAUTH_TOKEN_EXPIRED",
      http: 401,
      status: "UNAUTHENTICATED",
      codigo: { authenticationError: "OAUTH_TOKEN_EXPIRED" },
      problema: "acesso_expirado",
    },
    {
      nome: "TWO_STEP_VERIFICATION_NOT_ENROLLED",
      http: 401,
      status: "UNAUTHENTICATED",
      codigo: { authenticationError: "TWO_STEP_VERIFICATION_NOT_ENROLLED" },
      problema: "exige_verificacao",
    },
    {
      nome: "CUSTOMER_NOT_FOUND",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: { authenticationError: "CUSTOMER_NOT_FOUND" },
      problema: "conta_nao_encontrada",
    },
    {
      nome: "TRANSIENT_ERROR",
      http: 500,
      status: "INTERNAL",
      codigo: { internalError: "TRANSIENT_ERROR" },
      problema: "google_indisponivel",
    },
    {
      nome: "INTERNAL_ERROR",
      http: 500,
      status: "INTERNAL",
      codigo: { internalError: "INTERNAL_ERROR" },
      problema: "google_indisponivel",
    },
    {
      nome: "DEADLINE_EXCEEDED",
      http: 504,
      status: "DEADLINE_EXCEEDED",
      codigo: { internalError: "DEADLINE_EXCEEDED" },
      problema: "consulta_pesada",
    },
    {
      nome: "RESOURCE_EXHAUSTED",
      http: 429,
      status: "RESOURCE_EXHAUSTED",
      codigo: { quotaError: "RESOURCE_EXHAUSTED" },
      problema: "limite_do_google",
    },
    {
      nome: "RESOURCE_TEMPORARILY_EXHAUSTED",
      http: 429,
      status: "RESOURCE_EXHAUSTED",
      codigo: { quotaError: "RESOURCE_TEMPORARILY_EXHAUSTED" },
      problema: "limite_do_google",
    },
    {
      nome: "QueryError",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: { queryError: "UNRECOGNIZED_FIELD" },
      problema: "parametro_recusado",
    },
    {
      nome: "metricas de MCC",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: { queryError: "REQUESTED_METRICS_FOR_MANAGER" },
      problema: "conta_de_administrador",
    },
    {
      nome: "convite repetido",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: {
        customerClientLinkError: "CLIENT_ALREADY_INVITED_BY_THIS_MANAGER",
      },
      problema: "convite_ja_existe",
    },
    {
      nome: "ja na hierarquia",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: {
        customerClientLinkError: "CLIENT_ALREADY_MANAGED_IN_HIERARCHY",
      },
      problema: "conta_ja_vinculada",
    },
    {
      nome: "ja gerenciada (managerLinkError)",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: { managerLinkError: "ALREADY_MANAGED_BY_THIS_MANAGER" },
      problema: "conta_ja_vinculada",
    },
    {
      nome: "outro erro de vinculo",
      http: 400,
      status: "INVALID_ARGUMENT",
      codigo: { customerClientLinkError: "CLIENT_HAS_TOO_MANY_MANAGERS" },
      problema: "vinculo_impossivel",
    },
    {
      nome: "escopo faltando (ErrorInfo)",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: null,
      reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      problema: "escopo_faltando",
    },
    {
      nome: "API desligada no projeto",
      http: 403,
      status: "PERMISSION_DENIED",
      codigo: null,
      reason: "SERVICE_DISABLED",
      problema: "projeto_sem_acesso",
    },
    {
      nome: "so status UNAVAILABLE",
      http: 503,
      status: "UNAVAILABLE",
      codigo: null,
      problema: "google_indisponivel",
    },
    {
      nome: "so status UNAUTHENTICATED",
      http: 401,
      status: "UNAUTHENTICATED",
      codigo: null,
      problema: "credencial_invalida",
    },
  ];

  for (const caso of casos) {
    it(`${caso.nome} vira ${caso.problema}`, () => {
      const falha = classificarErroAds(
        caso.http,
        erroAds(
          caso.http,
          caso.status,
          caso.codigo,
          caso.reason ? { reason: caso.reason } : {},
        ),
        SEM_CABECALHO,
      );
      expect(falha.problema).toBe(caso.problema);
      expect(falha.http).toBe(caso.http);
      expect(falha.acao).toBe(acaoDoProblema(caso.problema));
      expect(JSON.stringify(falha)).not.toContain("SEGREDO");
    });
  }

  it("leva o nome do enum do Google e o requestId, nunca a mensagem", () => {
    const falha = classificarErroAds(
      403,
      erroAds(
        403,
        "PERMISSION_DENIED",
        { authorizationError: "USER_PERMISSION_DENIED" },
        { requestId: "R-123_abc" },
      ),
      SEM_CABECALHO,
    );
    expect(falha).toEqual({
      ok: false,
      problema: "sem_permissao",
      acao: "pausar",
      transitorio: false,
      tentarEmMs: null,
      codigoDoGoogle: "USER_PERMISSION_DENIED",
      http: 403,
      requestId: "R-123_abc",
    });
  });

  it("prefere o request-id do cabecalho", () => {
    const falha = classificarErroAds(
      403,
      erroAds(403, "PERMISSION_DENIED", {
        authorizationError: "USER_PERMISSION_DENIED",
      }),
      new Headers({ "request-id": "doCabecalho1" }),
    );
    expect(falha.requestId).toBe("doCabecalho1");
  });

  it("aceita o google.rpc.Status cru e o array do searchStream", () => {
    const cru = {
      code: 3,
      message: MENSAGEM_DO_GOOGLE,
      details: [
        {
          errors: [{ errorCode: { requestError: "REQUIRED_FIELD_MISSING" } }],
          requestId: "cru1",
        },
      ],
    };
    expect(classificarErroAds(400, cru, SEM_CABECALHO)).toMatchObject({
      problema: "parametro_recusado",
      codigoDoGoogle: "REQUIRED_FIELD_MISSING",
      requestId: "cru1",
    });
    const stream = [
      erroAds(403, "PERMISSION_DENIED", {
        authorizationError: "USER_PERMISSION_DENIED",
      }),
    ];
    expect(classificarErroAds(403, stream, SEM_CABECALHO).problema).toBe(
      "sem_permissao",
    );
  });

  it("sem corpo, decide pelo HTTP", () => {
    expect(classificarErroAds(500, null, SEM_CABECALHO).problema).toBe(
      "google_indisponivel",
    );
    expect(classificarErroAds(502, null, SEM_CABECALHO).problema).toBe(
      "google_indisponivel",
    );
    expect(classificarErroAds(429, null, SEM_CABECALHO).problema).toBe(
      "limite_do_google",
    );
    expect(classificarErroAds(401, null, SEM_CABECALHO).problema).toBe(
      "credencial_invalida",
    );
    expect(classificarErroAds(403, null, SEM_CABECALHO).problema).toBe(
      "sem_permissao",
    );
    expect(classificarErroAds(400, null, SEM_CABECALHO).problema).toBe(
      "parametro_recusado",
    );
    expect(classificarErroAds(418, null, SEM_CABECALHO).problema).toBe("outro");
  });

  it("limite: usa o retryDelay do Google; sem ele, 15 minutos", () => {
    const comDica = classificarErroAds(
      429,
      erroAds(
        429,
        "RESOURCE_EXHAUSTED",
        { quotaError: "RESOURCE_TEMPORARILY_EXHAUSTED" },
        { quotaRetryDelay: "30s" },
      ),
      SEM_CABECALHO,
    );
    expect(comDica.tentarEmMs).toBe(30_000);
    expect(comDica.acao).toBe("reagendar");
    expect(comDica.transitorio).toBe(true);
    const semDica = classificarErroAds(429, null, SEM_CABECALHO);
    expect(semDica.tentarEmMs).toBe(ESPERA_DO_LIMITE_PADRAO_MS);
    const retryAfter = classificarErroAds(
      429,
      null,
      new Headers({ "retry-after": "7" }),
    );
    expect(retryAfter.tentarEmMs).toBe(7_000);
  });

  it("codigo do Google fora do formato de enum nao entra no resultado", () => {
    const falha = classificarErroAds(
      403,
      erroAds(403, "PERMISSION_DENIED", {
        authorizationError: "texto com espaco e dado",
      }),
      SEM_CABECALHO,
    );
    expect(falha.codigoDoGoogle).toBe("PERMISSION_DENIED");
    expect(falha.problema).toBe("sem_permissao");
  });
});

describe("classificarErroOAuth", () => {
  it("mapeia os codigos do endpoint de token", () => {
    const corpo = (error: string) => ({
      error,
      error_description: "Token has been expired or revoked. SEGREDO",
    });
    expect(
      classificarErroOAuth(400, corpo("invalid_grant"), SEM_CABECALHO),
    ).toMatchObject({
      problema: "token_revogado",
      acao: "pausar",
      codigoDoGoogle: "invalid_grant",
    });
    expect(
      classificarErroOAuth(401, corpo("invalid_client"), SEM_CABECALHO)
        .problema,
    ).toBe("credencial_do_sistema");
    expect(
      classificarErroOAuth(400, corpo("invalid_scope"), SEM_CABECALHO).problema,
    ).toBe("escopo_faltando");
    expect(
      classificarErroOAuth(503, corpo("temporarily_unavailable"), SEM_CABECALHO)
        .problema,
    ).toBe("google_indisponivel");
    expect(
      classificarErroOAuth(400, corpo("invalid_request"), SEM_CABECALHO)
        .problema,
    ).toBe("parametro_recusado");
    expect(
      JSON.stringify(
        classificarErroOAuth(400, corpo("invalid_grant"), SEM_CABECALHO),
      ),
    ).not.toContain("SEGREDO");
  });

  it("sem codigo, decide pelo HTTP", () => {
    expect(classificarErroOAuth(500, null, SEM_CABECALHO).problema).toBe(
      "google_indisponivel",
    );
    expect(classificarErroOAuth(429, null, SEM_CABECALHO).problema).toBe(
      "limite_do_google",
    );
    expect(classificarErroOAuth(401, null, SEM_CABECALHO).problema).toBe(
      "credencial_do_sistema",
    );
  });
});

describe("utilitarios", () => {
  it("esperaDoRetryDelay", () => {
    expect(esperaDoRetryDelay("30s")).toBe(30_000);
    expect(esperaDoRetryDelay("1.5s")).toBe(1_500);
    expect(esperaDoRetryDelay("0.2s")).toBe(1_000); // piso de 1 s
    expect(esperaDoRetryDelay({ seconds: "45", nanos: 0 })).toBe(45_000);
    expect(esperaDoRetryDelay("999999999s")).toBe(24 * 60 * 60_000); // teto de 24 h
    expect(esperaDoRetryDelay("-3s")).toBeNull();
    expect(esperaDoRetryDelay("3m")).toBeNull();
    expect(esperaDoRetryDelay(30)).toBeNull();
    expect(esperaDoRetryDelay("0s")).toBeNull();
  });

  it("esperaDoBackoff: metade fixa, metade sorteada, com teto", () => {
    expect(esperaDoBackoff(0, () => 0)).toBe(500);
    expect(esperaDoBackoff(0, () => 1)).toBe(1_000);
    expect(esperaDoBackoff(1, () => 0.5)).toBe(1_500);
    expect(esperaDoBackoff(10, () => 1)).toBe(8_000);
  });

  it("lerRequestId recusa formato estranho", () => {
    expect(
      lerRequestId(new Headers({ "request-id": "abc DEF" }), null),
    ).toBeNull();
    expect(lerRequestId(new Headers(), null)).toBeNull();
  });

  it("so google_indisponivel e limite_do_google sao transitorios", () => {
    const transitorios = PROBLEMAS_GOOGLE.filter((p) => ehTransitorio(p));
    expect(transitorios).toEqual(["google_indisponivel", "limite_do_google"]);
  });
});

// ---------------------------------------------------------------------------
// pedir: timeout, prazo e retry
// ---------------------------------------------------------------------------

const URL_DO_ADS =
  "https://googleads.googleapis.com/v25/customers:listAccessibleCustomers";

function relogio(inicio = 1_000_000) {
  let agora = inicio;
  const esperas: number[] = [];
  return {
    agora: () => agora,
    dormir: async (ms: number) => {
      esperas.push(ms);
      agora += ms;
    },
    esperas,
  };
}

function json(
  corpo: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sequencia(respostas: Array<Response | Error>) {
  let i = 0;
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    return r!.clone();
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

const REQ = { url: URL_DO_ADS, method: "GET" as const, headers: {} };

describe("pedir", () => {
  it("repete falha transitoria com backoff e jitter, e devolve o sucesso", async () => {
    const r = relogio();
    const { fetchFn, chamadas } = sequencia([
      json(erroAds(500, "INTERNAL", { internalError: "TRANSIENT_ERROR" }), 500),
      new TypeError("fetch failed"),
      json({ resourceNames: [] }, 200, { "request-id": "okReq1" }),
    ]);
    const ctx = criarContexto({
      fetchFn,
      agora: r.agora,
      dormir: r.dormir,
      aleatorio: () => 0,
    });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    expect(resultado).toEqual({
      ok: true,
      http: 200,
      corpo: { resourceNames: [] },
      requestId: "okReq1",
    });
    expect(chamadas).toHaveLength(3);
    expect(r.esperas).toEqual([500, 1_000]);
  });

  it("erro definitivo nao repete", async () => {
    const r = relogio();
    const { fetchFn, chamadas } = sequencia([
      json(
        erroAds(403, "PERMISSION_DENIED", {
          authorizationError: "USER_PERMISSION_DENIED",
        }),
        403,
      ),
    ]);
    const ctx = criarContexto({ fetchFn, agora: r.agora, dormir: r.dormir });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    expect(resultado.ok).toBe(false);
    expect(chamadas).toHaveLength(1);
    expect(r.esperas).toEqual([]);
  });

  it("para depois de maxRetries", async () => {
    const r = relogio();
    const { fetchFn, chamadas } = sequencia([json(null, 503)]);
    const ctx = criarContexto({
      fetchFn,
      agora: r.agora,
      dormir: r.dormir,
      aleatorio: () => 0,
    });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    expect(resultado).toMatchObject({
      ok: false,
      problema: "google_indisponivel",
      http: 503,
    });
    expect(chamadas).toHaveLength(3);
  });

  it("limite com espera curta informada repete depois dela", async () => {
    const r = relogio();
    const { fetchFn, chamadas } = sequencia([
      json(
        erroAds(
          429,
          "RESOURCE_EXHAUSTED",
          { quotaError: "RESOURCE_TEMPORARILY_EXHAUSTED" },
          { quotaRetryDelay: "3s" },
        ),
        429,
      ),
      json({ ok: 1 }),
    ]);
    const ctx = criarContexto({ fetchFn, agora: r.agora, dormir: r.dormir });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    expect(resultado.ok).toBe(true);
    expect(chamadas).toHaveLength(2);
    expect(r.esperas).toEqual([3_000]);
  });

  it("limite com espera longa (ou sem dica) volta para quem chama reagendar", async () => {
    const r = relogio();
    const { fetchFn, chamadas } = sequencia([
      json(
        erroAds(
          429,
          "RESOURCE_EXHAUSTED",
          { quotaError: "RESOURCE_EXHAUSTED" },
          { quotaRetryDelay: "3600s" },
        ),
        429,
      ),
    ]);
    const ctx = criarContexto({ fetchFn, agora: r.agora, dormir: r.dormir });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    expect(resultado).toMatchObject({
      ok: false,
      problema: "limite_do_google",
      acao: "reagendar",
      tentarEmMs: 3_600_000,
    });
    expect(chamadas).toHaveLength(1);
  });

  it("nenhuma espera estoura o prazo total", async () => {
    const r = relogio(0);
    const { fetchFn, chamadas } = sequencia([json(null, 503)]);
    const ctx = criarContexto({
      fetchFn,
      agora: r.agora,
      dormir: r.dormir,
      aleatorio: () => 0,
      prazoEm: 3_000,
    });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    // 1a falha, espera 500 (cabe); 2a falha, espera 1000 nao cabe (500+1000+2000 > 3000).
    expect(resultado).toMatchObject({
      ok: false,
      problema: "prazo_esgotado",
      http: 503,
    });
    expect(chamadas).toHaveLength(2);
  });

  it("sem tempo para uma requisicao, nem comeca", async () => {
    const r = relogio(0);
    const { fetchFn, chamadas } = sequencia([json({})]);
    const ctx = criarContexto({
      fetchFn,
      agora: r.agora,
      dormir: r.dormir,
      prazoEm: 1_000,
    });
    expect(await pedir(ctx, REQ, classificarErroAds)).toMatchObject({
      problema: "prazo_esgotado",
    });
    expect(chamadas).toHaveLength(0);
  });

  it("timeout por chamada aborta e conta como transitorio", async () => {
    const sinais: AbortSignal[] = [];
    const fetchFn = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const sinal = init?.signal;
        if (sinal) {
          sinais.push(sinal);
          sinal.addEventListener("abort", () => reject(new Error("abortado")));
        }
      })) as typeof fetch;
    const ctx = criarContexto({
      fetchFn,
      timeoutMs: 20,
      maxRetries: 1,
      dormir: async () => {},
    });
    const resultado = await pedir(ctx, REQ, classificarErroAds);
    expect(resultado).toMatchObject({
      ok: false,
      problema: "google_indisponivel",
      http: null,
    });
    expect(sinais).toHaveLength(2);
    expect(sinais.every((s) => s.aborted)).toBe(true);
  });

  it("recusa host fora da lista sem chamar o fetch", async () => {
    const { fetchFn, chamadas } = sequencia([json({})]);
    const ctx = criarContexto({ fetchFn });
    for (const url of [
      "https://evil.example.com/v25/customers",
      "http://googleads.googleapis.com/v25/x",
      "https://googleads.googleapis.com.evil.com/v25/x",
      "https://user:senha@googleads.googleapis.com/v25/x",
    ]) {
      expect(
        await pedir(ctx, { ...REQ, url }, classificarErroAds),
      ).toMatchObject({ problema: "entrada_invalida" });
    }
    expect(chamadas).toHaveLength(0);
  });

  it("nunca segue redirecionamento e nao guarda cache", async () => {
    const { fetchFn, chamadas } = sequencia([json({})]);
    await pedir(criarContexto({ fetchFn }), REQ, classificarErroAds);
    expect(chamadas[0]?.init.redirect).toBe("error");
    expect(chamadas[0]?.init.cache).toBe("no-store");
  });

  it("2xx com corpo que nao e JSON e resposta invalida", async () => {
    const { fetchFn } = sequencia([
      new Response("<html>oi</html>", { status: 200 }),
    ]);
    expect(
      await pedir(criarContexto({ fetchFn }), REQ, classificarErroAds),
    ).toMatchObject({
      problema: "resposta_invalida",
      http: 200,
    });
  });
});
