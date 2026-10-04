import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  acaoDoProblemaDoLogin,
  classificarErroDoLogin,
  conferirToken,
  CONTAS_POR_PAGINA,
  ESPERA_DO_LIMITE_PADRAO_MS,
  lerNegocioDoCliente,
  listarContasAcessiveis,
  MAX_PAGINAS_DE_CONTAS,
  montarUrlDoLogin,
  PROBLEMAS_DO_LOGIN,
  revogarAcesso,
  trocarCodigoPorToken,
  type ConfigComToken,
  type ConfigDaConferencia,
  type ConfigDaTroca,
  type ConfigDaUrlDoLogin,
  type FalhaDoLogin,
} from "@/lib/integrations/meta/login";
import { GRAPH_VERSION } from "@/lib/integrations/meta/versao";

// Conectar com a Meta (F3), com fetch dublado: nada de rede, nenhuma chamada
// real. Todo valor secreto de teste carrega "SEGREDO" para os testes de
// vazamento acharem qualquer copia dele num resultado de erro.

const APP_ID = "1234567890123";
const SEGREDO_DO_APP = "SEGREDOabcdef0123456789abcdef0123";
const CONFIG_ID = "987654321012345";
const REDIRECT = "https://app.conduzza.com.br/api/integracoes/meta/retorno";
const STATE = "nonceDeTeste_1234567890-abcdefXYZ";
const CODE = "AQDcodigoDeTeste-SEGREDO-DO-CODE_1234567890";
const TOKEN = "EAABtokenDoUsuarioDoSistema1234567890SEGREDO";
const AGORA = Date.parse("2026-10-04T15:00:00.000Z");
const MENSAGEM_DA_META = "Mensagem crua da Meta com SEGREDO-DA-MENSAGEM";

type Chamada = { url: URL; init: RequestInit };
type Manipulador = (chamada: Chamada, n: number) => Response | Promise<Response>;

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

function erroMeta(
  code: number,
  opcoes: {
    subcode?: number;
    status?: number;
    mensagem?: string;
    headers?: Record<string, string>;
    extra?: Record<string, unknown>;
  } = {},
): Response {
  return json(
    {
      error: {
        message: opcoes.mensagem ?? MENSAGEM_DA_META,
        type: "OAuthException",
        code,
        ...(opcoes.subcode !== undefined ? { error_subcode: opcoes.subcode } : {}),
        fbtrace_id: "AbCdEf",
        ...opcoes.extra,
      },
    },
    opcoes.status ?? 400,
    opcoes.headers ?? {},
  );
}

/** Meta de mentira: um manipulador por chamada, e toda chamada gravada. */
function metaFalsa(manipulador: Manipulador) {
  const chamadas: Chamada[] = [];
  const fetchFn = (async (entrada: unknown, init?: RequestInit) => {
    const chamada = { url: new URL(String(entrada)), init: init ?? {} };
    chamadas.push(chamada);
    return manipulador(chamada, chamadas.length);
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

function cabecalhos(chamada: Chamada): Record<string, string> {
  return chamada.init.headers as Record<string, string>;
}

const execucao = {
  prazoEm: AGORA + 30_000,
  agora: () => AGORA,
  dormir: async () => {},
  aleatorio: () => 0.5,
};

function configDaUrl(extra: Partial<ConfigDaUrlDoLogin> = {}): ConfigDaUrlDoLogin {
  return {
    appId: APP_ID,
    configId: CONFIG_ID,
    redirectUri: REDIRECT,
    state: STATE,
    ...extra,
  };
}

function configDaTroca(
  fetchFn: typeof fetch,
  extra: Partial<ConfigDaTroca> = {},
): ConfigDaTroca {
  return {
    appId: APP_ID,
    appSecret: SEGREDO_DO_APP,
    redirectUri: REDIRECT,
    prazoEm: execucao.prazoEm,
    agora: execucao.agora,
    fetchFn,
    ...extra,
  };
}

function configDaConferencia(
  fetchFn: typeof fetch,
  extra: Partial<ConfigDaConferencia> = {},
): ConfigDaConferencia {
  return {
    appId: APP_ID,
    appSecret: SEGREDO_DO_APP,
    ...execucao,
    fetchFn,
    ...extra,
  };
}

function configComToken(
  fetchFn: typeof fetch,
  extra: Partial<ConfigComToken> = {},
): ConfigComToken {
  return { accessToken: TOKEN, ...execucao, fetchFn, ...extra };
}

/** Nada secreto nem a mensagem da Meta no resultado de erro. */
function semVazamento(resultado: unknown) {
  const texto = JSON.stringify(resultado);
  expect(texto).not.toContain("SEGREDO");
  expect(texto).not.toContain(TOKEN);
  expect(texto).not.toContain(CODE);
  expect(texto).not.toContain(SEGREDO_DO_APP);
  expect(texto).not.toContain("graph.facebook.com");
}

function falhaDe(resultado: { ok: boolean }): FalhaDoLogin {
  expect(resultado.ok).toBe(false);
  return resultado as FalhaDoLogin;
}

const DEBUG_OK = {
  data: {
    app_id: APP_ID,
    type: "SYSTEM_USER",
    application: "Conduzza",
    expires_at: 0,
    data_access_expires_at: 0,
    is_valid: true,
    issued_at: 1_790_000_000,
    scopes: ["ads_read", "public_profile"],
    user_id: "122100000000000001",
  },
};

function contaBruta(digitos: string, extra: Record<string, unknown> = {}) {
  return {
    id: `act_${digitos}`,
    name: `Clínica ${digitos}`,
    account_id: digitos,
    currency: "BRL",
    timezone_name: "America/Fortaleza",
    account_status: 1,
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe("montarUrlDoLogin", () => {
  it("monta o diálogo do Login for Business com config_id, code e o state do chamador", () => {
    const r = montarUrlDoLogin(configDaUrl());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const url = new URL(r.url);
    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe(`/${GRAPH_VERSION}/dialog/oauth`);
    expect([...url.searchParams.keys()]).toEqual([
      "client_id",
      "redirect_uri",
      "state",
      "config_id",
      "response_type",
      "override_default_response_type",
    ]);
    expect(url.searchParams.get("client_id")).toBe(APP_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("config_id")).toBe(CONFIG_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(r.url).not.toContain(SEGREDO_DO_APP);
  });

  it("leva o endereço de retorno exatamente como veio, com query e sem barra final acrescentada", () => {
    const exato = "https://app.conduzza.com.br/retorno?origem=meta";
    const r = montarUrlDoLogin(configDaUrl({ redirectUri: exato }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new URL(r.url).searchParams.get("redirect_uri")).toBe(exato);
  });

  it("aceita http só em localhost, para desenvolvimento", () => {
    expect(
      montarUrlDoLogin(configDaUrl({ redirectUri: "http://localhost:3000/retorno" })).ok,
    ).toBe(true);
    expect(
      montarUrlDoLogin(configDaUrl({ redirectUri: "http://127.0.0.1:3000/retorno" })).ok,
    ).toBe(true);
  });

  it.each<[string, Partial<ConfigDaUrlDoLogin>]>([
    ["app sem número", { appId: "abc123" }],
    ["app vazio", { appId: "" }],
    ["config_id vazio", { configId: "" }],
    ["config_id com letra", { configId: "12345x" }],
    ["http fora de localhost", { redirectUri: "http://app.conduzza.com.br/retorno" }],
    ["retorno relativo", { redirectUri: "/api/integracoes/meta/retorno" }],
    ["retorno com fragmento", { redirectUri: `${REDIRECT}#topo` }],
    ["retorno com usuário e senha", { redirectUri: "https://a:b@app.conduzza.com.br/r" }],
    ["retorno com espaço na ponta", { redirectUri: ` ${REDIRECT}` }],
    ["outro esquema", { redirectUri: "javascript:alert(1)" }],
    ["state curto", { state: "curto" }],
    ["state com espaço", { state: "nonce com espaco 1234567890" }],
    ["state vazio", { state: "" }],
  ])("%s vira configuracao_invalida", (_nome, extra) => {
    const r = falhaDe(montarUrlDoLogin(configDaUrl(extra)));
    expect(r.problema).toBe("configuracao_invalida");
    expect(r.acao).toBe("configurar_app");
  });
});

// ---------------------------------------------------------------------------

describe("trocarCodigoPorToken", () => {
  it("POST com corpo de formulário: segredo e code fora da URL, sem cabeçalho de token", async () => {
    const meta = metaFalsa(() =>
      json({ access_token: TOKEN, token_type: "bearer" }),
    );
    const r = await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE);
    expect(r).toEqual({ ok: true, token: { accessToken: TOKEN, expiraEmMs: null } });

    expect(meta.chamadas).toHaveLength(1);
    const [chamada] = meta.chamadas;
    expect(chamada!.init.method).toBe("POST");
    expect(chamada!.url.origin).toBe("https://graph.facebook.com");
    expect(chamada!.url.pathname).toBe(`/${GRAPH_VERSION}/oauth/access_token`);
    expect(chamada!.url.search).toBe("");
    expect(cabecalhos(chamada!)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(cabecalhos(chamada!).Authorization).toBeUndefined();
    const corpo = new URLSearchParams(String(chamada!.init.body));
    expect(Object.fromEntries(corpo)).toEqual({
      client_id: APP_ID,
      client_secret: SEGREDO_DO_APP,
      redirect_uri: REDIRECT,
      code: CODE,
    });
  });

  it("expires_in vira instante em ms no relógio injetado", async () => {
    const meta = metaFalsa(() =>
      json({ access_token: TOKEN, token_type: "bearer", expires_in: 5_184_000 }),
    );
    const r = await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE);
    expect(r.ok && r.token.expiraEmMs).toBe(AGORA + 5_184_000_000);
  });

  it("uma tentativa só: 500 não repete e pede um novo login", async () => {
    const meta = metaFalsa(() => json({ error: { code: 2 } }, 500));
    const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE));
    expect(meta.chamadas).toHaveLength(1);
    expect(r.problema).toBe("meta_indisponivel");
    expect(r.acao).toBe("conectar_de_novo");
  });

  it("uma tentativa só: falha de rede não repete", async () => {
    const meta = metaFalsa(() => {
      throw new TypeError(`fetch failed ${TOKEN}`);
    });
    const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE));
    expect(meta.chamadas).toHaveLength(1);
    expect(r.problema).toBe("meta_indisponivel");
    expect(r.acao).toBe("conectar_de_novo");
    semVazamento(r);
  });

  it("timeout do nosso relógio aborta e não repete", async () => {
    let chamadas = 0;
    const fetchFn = ((_entrada: unknown, init?: RequestInit) => {
      chamadas += 1;
      return new Promise<Response>((_resolver, rejeitar) => {
        init?.signal?.addEventListener("abort", () =>
          rejeitar(new DOMException("abortado", "AbortError")),
        );
      });
    }) as typeof fetch;
    const r = falhaDe(
      await trocarCodigoPorToken(configDaTroca(fetchFn, { timeoutMs: 20 }), CODE),
    );
    expect(chamadas).toBe(1);
    expect(r.problema).toBe("meta_indisponivel");
    expect(r.http).toBeNull();
  });

  it.each<[string, Response, string, string]>([
    [
      "code já usado",
      erroMeta(100, { subcode: 36009, mensagem: "This authorization code has been used." }),
      "codigo_recusado",
      "conectar_de_novo",
    ],
    [
      "code vencido",
      erroMeta(100, { subcode: 36007, mensagem: "This authorization code has expired." }),
      "codigo_recusado",
      "conectar_de_novo",
    ],
    [
      "endereço de retorno diferente",
      erroMeta(100, {
        subcode: 36008,
        mensagem:
          "Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request",
      }),
      "redirect_divergente",
      "configurar_app",
    ],
    ["código 191", erroMeta(191), "redirect_divergente", "configurar_app"],
    [
      "segredo errado (código 1)",
      erroMeta(1, { mensagem: "Error validating client secret." }),
      "app_recusado",
      "configurar_app",
    ],
    [
      "app inexistente (101)",
      erroMeta(101, { mensagem: "Error validating application. Invalid application ID." }),
      "app_recusado",
      "configurar_app",
    ],
  ])("%s", async (_nome, resposta, problema, acao) => {
    const meta = metaFalsa(() => resposta);
    const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE));
    expect(meta.chamadas).toHaveLength(1);
    expect(r.problema).toBe(problema);
    expect(r.acao).toBe(acao);
    semVazamento(r);
  });

  it.each(["", "com espaco", "x".repeat(4097)])(
    "code fora do formato (%#) volta sem chamar a Meta",
    async (code) => {
      const meta = metaFalsa(() => json({ access_token: TOKEN }));
      const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn), code));
      expect(r.problema).toBe("codigo_recusado");
      expect(meta.chamadas).toHaveLength(0);
    },
  );

  it.each<[string, Partial<ConfigDaTroca>]>([
    ["segredo curto", { appSecret: "curto" }],
    ["app sem número", { appId: "app" }],
    ["retorno http", { redirectUri: "http://app.conduzza.com.br/retorno" }],
  ])("%s vira configuracao_invalida sem chamar a Meta", async (_nome, extra) => {
    const meta = metaFalsa(() => json({ access_token: TOKEN }));
    const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn, extra), CODE));
    expect(r.problema).toBe("configuracao_invalida");
    expect(meta.chamadas).toHaveLength(0);
  });

  it.each<[string, unknown]>([
    ["sem access_token", { token_type: "bearer" }],
    ["token curto", { access_token: "abc" }],
    ["token com espaço", { access_token: `${TOKEN} x` }],
    ["corpo em lista", [TOKEN]],
  ])("resposta torta (%s) vira resposta_invalida e pede novo login", async (_nome, corpo) => {
    const meta = metaFalsa(() => json(corpo));
    const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE));
    expect(r.problema).toBe("resposta_invalida");
    expect(r.acao).toBe("conectar_de_novo");
    semVazamento(r);
  });

  it("corpo que não é JSON vira resposta_invalida", async () => {
    const meta = metaFalsa(() => new Response("<html>", { status: 200 }));
    const r = falhaDe(await trocarCodigoPorToken(configDaTroca(meta.fetchFn), CODE));
    expect(r.problema).toBe("resposta_invalida");
  });

  it("sem tempo até o prazo, nem chama", async () => {
    const meta = metaFalsa(() => json({ access_token: TOKEN }));
    const r = falhaDe(
      await trocarCodigoPorToken(
        configDaTroca(meta.fetchFn, { prazoEm: AGORA + 1_000 }),
        CODE,
      ),
    );
    expect(r.problema).toBe("prazo_esgotado");
    expect(meta.chamadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("conferirToken", () => {
  it("debug_token com o token do app no cabeçalho; devolve tipo, escopos e validade", async () => {
    const meta = metaFalsa(() => json(DEBUG_OK));
    const r = await conferirToken(configDaConferencia(meta.fetchFn), TOKEN);
    expect(r).toEqual({
      ok: true,
      conferido: {
        tipo: "SYSTEM_USER",
        escopos: ["ads_read", "public_profile"],
        expiraEmMs: null,
        acessoAosDadosExpiraEmMs: null,
      },
    });
    const [chamada] = meta.chamadas;
    expect(chamada!.init.method).toBe("GET");
    expect(chamada!.url.pathname).toBe(`/${GRAPH_VERSION}/debug_token`);
    expect(chamada!.url.searchParams.get("input_token")).toBe(TOKEN);
    expect(chamada!.url.searchParams.has("access_token")).toBe(false);
    expect(chamada!.url.toString()).not.toContain(SEGREDO_DO_APP);
    expect(cabecalhos(chamada!).Authorization).toBe(
      `Bearer ${APP_ID}|${SEGREDO_DO_APP}`,
    );
  });

  it("expires_at e data_access_expires_at viram ms", async () => {
    const meta = metaFalsa(() =>
      json({
        data: {
          ...DEBUG_OK.data,
          type: "USER",
          expires_at: 1_795_000_000,
          data_access_expires_at: 1_797_000_000,
        },
      }),
    );
    const r = await conferirToken(configDaConferencia(meta.fetchFn), TOKEN);
    expect(r.ok && r.conferido).toEqual({
      tipo: "USER",
      escopos: ["ads_read", "public_profile"],
      expiraEmMs: 1_795_000_000_000,
      acessoAosDadosExpiraEmMs: 1_797_000_000_000,
    });
  });

  it("app_id em número igual ao nosso passa", async () => {
    const meta = metaFalsa(() =>
      json({ data: { ...DEBUG_OK.data, app_id: Number(APP_ID) } }),
    );
    const r = await conferirToken(configDaConferencia(meta.fetchFn), TOKEN);
    expect(r.ok).toBe(true);
  });

  it("token de outro app: o erro 100 real da Meta vira token_de_outro_app, sem repetir", async () => {
    // Formato que a Meta manda quando o debug_token e autenticado pelo token
    // do nosso app e o input_token e de outro app (FirebaseUI-iOS#566).
    const meta = metaFalsa(() =>
      erroMeta(100, {
        status: 400,
        mensagem: "(#100) The App_id in the input_token did not match the Viewing App",
      }),
    );
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("token_de_outro_app");
    expect(r.acao).toBe("conectar_de_novo");
    expect(r.codigoDaMeta).toBe(100);
    expect(r.http).toBe(400);
    expect(meta.chamadas).toHaveLength(1);
    semVazamento(r);
    expect(JSON.stringify(r)).not.toContain("Viewing App");
    expect(JSON.stringify(r)).not.toContain("input_token");
  });

  it("token de outro app com data.app_id alheio (segunda defesa) também é recusado", async () => {
    const meta = metaFalsa(() =>
      json({ data: { ...DEBUG_OK.data, app_id: "999999999999" } }),
    );
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("token_de_outro_app");
    expect(r.acao).toBe("conectar_de_novo");
  });

  it("is_valid falso vira token_invalido com o código de dentro do data", async () => {
    const meta = metaFalsa(() =>
      json({
        data: {
          app_id: APP_ID,
          is_valid: false,
          scopes: [],
          error: { code: 190, subcode: 460, message: MENSAGEM_DA_META },
        },
      }),
    );
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("token_invalido");
    expect(r.codigoDaMeta).toBe(190);
    expect(r.subcodigoDaMeta).toBe(460);
    semVazamento(r);
  });

  it("sem ads_read concedida vira sem_ads_read", async () => {
    const meta = metaFalsa(() =>
      json({ data: { ...DEBUG_OK.data, scopes: ["public_profile"] } }),
    );
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("sem_ads_read");
    expect(r.acao).toBe("conectar_de_novo");
  });

  it.each<[string, unknown]>([
    ["sem data", { ok: true }],
    ["válido sem app_id", { data: { ...DEBUG_OK.data, app_id: undefined } }],
    ["app_id torto", { data: { ...DEBUG_OK.data, app_id: "12ab" } }],
    ["app_id grande demais em número", { data: { ...DEBUG_OK.data, app_id: 2 ** 60 } }],
    ["scopes fora de lista", { data: { ...DEBUG_OK.data, scopes: "ads_read" } }],
    ["scopes com não texto", { data: { ...DEBUG_OK.data, scopes: ["ads_read", 7] } }],
  ])("resposta torta (%s) vira resposta_invalida", async (_nome, corpo) => {
    const meta = metaFalsa(() => json(corpo));
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("resposta_invalida");
  });

  it("190 no topo é o token do APP errado, não o do usuário", async () => {
    const meta = metaFalsa(() => erroMeta(190, { status: 400 }));
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("app_recusado");
    expect(r.acao).toBe("configurar_app");
    expect(meta.chamadas).toHaveLength(1);
  });

  it("repete falha passageira com backoff e jitter, até dar certo", async () => {
    const esperas: number[] = [];
    const meta = metaFalsa((_c, n) =>
      n < 3 ? json({ error: { code: 2, is_transient: true } }, 500) : json(DEBUG_OK),
    );
    const r = await conferirToken(
      configDaConferencia(meta.fetchFn, {
        dormir: async (ms) => {
          esperas.push(ms);
        },
      }),
      TOKEN,
    );
    expect(r.ok).toBe(true);
    expect(meta.chamadas).toHaveLength(3);
    // Teto 500 e 1000 ms; metade fixa, metade sorteada (0,5).
    expect(esperas).toEqual([375, 750]);
  });

  it("desiste depois de 2 novas tentativas", async () => {
    const meta = metaFalsa(() => new Response("indisponivel", { status: 503 }));
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(meta.chamadas).toHaveLength(3);
    expect(r.problema).toBe("meta_indisponivel");
    expect(r.acao).toBe("repetir");
    expect(r.http).toBe(503);
  });

  it("não começa a espera do retry que estouraria o prazo", async () => {
    const meta = metaFalsa(() => json({ error: { code: 2 } }, 500));
    const r = falhaDe(
      await conferirToken(
        configDaConferencia(meta.fetchFn, { prazoEm: AGORA + 2_300 }),
        TOKEN,
      ),
    );
    expect(meta.chamadas).toHaveLength(1);
    expect(r.problema).toBe("prazo_esgotado");
    expect(r.http).toBe(500);
    expect(r.codigoDaMeta).toBe(2);
  });

  it("limite da Meta não repete e diz quanto esperar", async () => {
    const meta = metaFalsa(() =>
      erroMeta(4, {
        headers: {
          "x-business-use-case-usage": JSON.stringify({
            "123": [{ type: "ads_management", estimated_time_to_regain_access: 7 }],
          }),
        },
      }),
    );
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(meta.chamadas).toHaveLength(1);
    expect(r.problema).toBe("limite_da_meta");
    expect(r.acao).toBe("aguardar");
    expect(r.tentarEmMs).toBe(7 * 60_000);
  });

  it("limite sem cabeçalho espera 15 minutos", async () => {
    const meta = metaFalsa(() => json({}, 429));
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), TOKEN));
    expect(r.problema).toBe("limite_da_meta");
    expect(r.tentarEmMs).toBe(ESPERA_DO_LIMITE_PADRAO_MS);
  });

  it("token fora do formato nem chama a Meta", async () => {
    const meta = metaFalsa(() => json(DEBUG_OK));
    const r = falhaDe(await conferirToken(configDaConferencia(meta.fetchFn), "curto"));
    expect(r.problema).toBe("token_invalido");
    expect(meta.chamadas).toHaveLength(0);
  });

  it("app fora do formato vira configuracao_invalida", async () => {
    const meta = metaFalsa(() => json(DEBUG_OK));
    const r = falhaDe(
      await conferirToken(configDaConferencia(meta.fetchFn, { appSecret: "x|y" }), TOKEN),
    );
    expect(r.problema).toBe("configuracao_invalida");
    expect(meta.chamadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("lerNegocioDoCliente", () => {
  it("GET /me?fields=client_business_id com o token só no cabeçalho", async () => {
    const meta = metaFalsa(() =>
      json({ client_business_id: "556677889900", id: "122100000000000001" }),
    );
    const r = await lerNegocioDoCliente(configComToken(meta.fetchFn));
    expect(r).toEqual({ ok: true, clientBusinessId: "556677889900" });
    const [chamada] = meta.chamadas;
    expect(chamada!.url.pathname).toBe(`/${GRAPH_VERSION}/me`);
    expect(chamada!.url.searchParams.get("fields")).toBe("client_business_id");
    expect(chamada!.url.toString()).not.toContain(TOKEN);
    expect(chamada!.url.searchParams.has("appsecret_proof")).toBe(false);
    expect(cabecalhos(chamada!).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("sem o campo devolve null", async () => {
    const meta = metaFalsa(() => json({ id: "122100000000000001" }));
    expect(await lerNegocioDoCliente(configComToken(meta.fetchFn))).toEqual({
      ok: true,
      clientBusinessId: null,
    });
  });

  it("campo inexistente no nó (token de usuário comum) devolve null", async () => {
    const meta = metaFalsa(() =>
      erroMeta(100, {
        mensagem:
          "(#100) Tried accessing nonexisting field (client_business_id) on node type (User)",
      }),
    );
    expect(await lerNegocioDoCliente(configComToken(meta.fetchFn))).toEqual({
      ok: true,
      clientBusinessId: null,
    });
  });

  it("token recusado vira token_invalido", async () => {
    const meta = metaFalsa(() => erroMeta(190, { subcode: 463, status: 401 }));
    const r = falhaDe(await lerNegocioDoCliente(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("token_invalido");
    expect(r.codigoDaMeta).toBe(190);
    expect(r.subcodigoDaMeta).toBe(463);
    semVazamento(r);
  });

  it("id torto vira resposta_invalida", async () => {
    const meta = metaFalsa(() => json({ client_business_id: "abc" }));
    const r = falhaDe(await lerNegocioDoCliente(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("resposta_invalida");
  });

  it("com o segredo do app, manda appsecret_proof com carimbo de tempo", async () => {
    const meta = metaFalsa(() => json({ client_business_id: "556677889900" }));
    await lerNegocioDoCliente(
      configComToken(meta.fetchFn, { appSecret: SEGREDO_DO_APP }),
    );
    const url = meta.chamadas[0]!.url;
    const segundos = Math.floor(AGORA / 1_000);
    expect(url.searchParams.get("appsecret_time")).toBe(String(segundos));
    expect(url.searchParams.get("appsecret_proof")).toBe(
      createHmac("sha256", SEGREDO_DO_APP)
        .update(`${TOKEN}|${segundos}`)
        .digest("hex"),
    );
    expect(url.toString()).not.toContain(SEGREDO_DO_APP);
    expect(url.toString()).not.toContain(TOKEN);
  });

  it.each<[string, string]>([
    ["API calls from the server require an appsecret_proof argument", "exige_prova_do_app"],
    ["Invalid appsecret_proof provided in the API argument", "app_recusado"],
  ])("100 com %j vira %s", async (mensagem, problema) => {
    const meta = metaFalsa(() => erroMeta(100, { mensagem }));
    const r = falhaDe(await lerNegocioDoCliente(configComToken(meta.fetchFn)));
    expect(r.problema).toBe(problema);
    expect(r.acao).toBe("configurar_app");
  });

  it("segredo do app fora do formato vira configuracao_invalida", async () => {
    const meta = metaFalsa(() => json({}));
    const r = falhaDe(
      await lerNegocioDoCliente(configComToken(meta.fetchFn, { appSecret: "curto" })),
    );
    expect(r.problema).toBe("configuracao_invalida");
    expect(meta.chamadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("listarContasAcessiveis", () => {
  it("pede os 6 campos, 100 por página, e pagina pelo cursor sem seguir o paging.next", async () => {
    const meta = metaFalsa((chamada) => {
      const after = chamada.url.searchParams.get("after");
      if (after === null) {
        return json({
          data: [contaBruta("1111111111"), contaBruta("2222222222")],
          paging: {
            cursors: { before: "B1", after: "CURSOR1" },
            next: `https://evil.example.com/roubar?access_token=${TOKEN}`,
          },
        });
      }
      expect(after).toBe("CURSOR1");
      return json({
        data: [contaBruta("2222222222", { name: "Nome novo" }), contaBruta("3333333333")],
        paging: { cursors: { before: "B2", after: "CURSOR2" } },
      });
    });
    const r = await listarContasAcessiveis(configComToken(meta.fetchFn));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(meta.chamadas).toHaveLength(2);
    for (const chamada of meta.chamadas) {
      expect(chamada.url.origin).toBe("https://graph.facebook.com");
      expect(chamada.url.pathname).toBe(`/${GRAPH_VERSION}/me/adaccounts`);
      expect(chamada.url.searchParams.get("fields")?.split(",")).toEqual([
        "id",
        "name",
        "account_id",
        "currency",
        "timezone_name",
        "account_status",
      ]);
      expect(chamada.url.searchParams.get("limit")).toBe(String(CONTAS_POR_PAGINA));
      expect(chamada.url.toString()).not.toContain(TOKEN);
      expect(cabecalhos(chamada).Authorization).toBe(`Bearer ${TOKEN}`);
    }

    expect(r.incompleta).toBe(false);
    // Repetida entre páginas: vale a última lida, na posição da primeira.
    expect(r.contas.map((c) => [c.id, c.nome])).toEqual([
      ["act_1111111111", "Clínica 1111111111"],
      ["act_2222222222", "Nome novo"],
      ["act_3333333333", "Clínica 3333333333"],
    ]);
    expect(r.contas[0]).toEqual({
      id: "act_1111111111",
      accountId: "1111111111",
      nome: "Clínica 1111111111",
      moeda: "BRL",
      fuso: "America/Fortaleza",
      status: 1,
      ativa: true,
    });
  });

  it("lista vazia é ok", async () => {
    const meta = metaFalsa(() => json({ data: [] }));
    expect(await listarContasAcessiveis(configComToken(meta.fetchFn))).toEqual({
      ok: true,
      contas: [],
      incompleta: false,
    });
  });

  it("campos opcionais tortos ou ausentes viram null; status em texto vira número", async () => {
    const meta = metaFalsa(() =>
      json({
        data: [
          {
            id: "act_4444444444",
            name: "   ",
            currency: "brl",
            timezone_name: "Lua/Mar_da_Tranquilidade",
            account_status: "2",
          },
          { id: "act_5555555555", account_status: "abc" },
        ],
      }),
    );
    const r = await listarContasAcessiveis(configComToken(meta.fetchFn));
    expect(r.ok && r.contas).toEqual([
      {
        id: "act_4444444444",
        accountId: "4444444444",
        nome: null,
        moeda: null,
        fuso: null,
        status: 2,
        ativa: false,
      },
      {
        id: "act_5555555555",
        accountId: "5555555555",
        nome: null,
        moeda: null,
        fuso: null,
        status: null,
        ativa: false,
      },
    ]);
  });

  it.each<[string, unknown]>([
    ["id sem act_", { data: [{ id: "4444444444" }] }],
    ["id torto", { data: [{ id: "act_12ab" }] }],
    ["account_id divergente", { data: [contaBruta("4444444444", { account_id: "1" })] }],
    ["linha que não é objeto", { data: ["act_4444444444"] }],
    ["data fora de lista", { data: { id: "act_4444444444" } }],
    ["next sem cursor", { data: [], paging: { next: "https://graph.facebook.com/x" } }],
  ])("%s vira resposta_invalida", async (_nome, corpo) => {
    const meta = metaFalsa(() => json(corpo));
    const r = falhaDe(await listarContasAcessiveis(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("resposta_invalida");
    expect(meta.chamadas).toHaveLength(1);
  });

  it(`para em ${MAX_PAGINAS_DE_CONTAS} páginas e marca a lista incompleta`, async () => {
    const meta = metaFalsa((_c, n) =>
      json({
        data: [contaBruta(String(1_000_000_000 + n))],
        paging: { cursors: { after: `C${n}` }, next: "https://graph.facebook.com/x" },
      }),
    );
    const r = await listarContasAcessiveis(configComToken(meta.fetchFn));
    expect(meta.chamadas).toHaveLength(MAX_PAGINAS_DE_CONTAS);
    expect(r.ok && r.incompleta).toBe(true);
    expect(r.ok && r.contas).toHaveLength(MAX_PAGINAS_DE_CONTAS);
  });

  it("cursor inválido recomeça do zero uma vez", async () => {
    const meta = metaFalsa((chamada, n) => {
      if (n === 2) return erroMeta(2642);
      const after = chamada.url.searchParams.get("after");
      return after === null
        ? json({
            data: [contaBruta("1111111111")],
            paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
          })
        : json({ data: [contaBruta("2222222222")] });
    });
    const r = await listarContasAcessiveis(configComToken(meta.fetchFn));
    expect(meta.chamadas.map((c) => c.url.searchParams.get("after"))).toEqual([
      null,
      "C1",
      null,
      "C1",
    ]);
    expect(r.ok && r.contas.map((c) => c.id)).toEqual([
      "act_1111111111",
      "act_2222222222",
    ]);
  });

  it("cursor inválido duas vezes vira resposta_invalida", async () => {
    const meta = metaFalsa((chamada) =>
      chamada.url.searchParams.get("after") === null
        ? json({
            data: [contaBruta("1111111111")],
            paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
          })
        : erroMeta(2642),
    );
    const r = falhaDe(await listarContasAcessiveis(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("resposta_invalida");
    expect(r.codigoDaMeta).toBe(2642);
    expect(meta.chamadas).toHaveLength(4);
  });

  it("sem permissão (200) pede para conectar de novo", async () => {
    const meta = metaFalsa(() => erroMeta(200, { status: 403 }));
    const r = falhaDe(await listarContasAcessiveis(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("sem_permissao");
    expect(r.acao).toBe("conectar_de_novo");
    semVazamento(r);
  });

  it("passageiro numa página repete só aquela página", async () => {
    const meta = metaFalsa((chamada, n) => {
      if (n === 2) return json({ error: { code: 1 } }, 500);
      return chamada.url.searchParams.get("after") === null
        ? json({
            data: [contaBruta("1111111111")],
            paging: { cursors: { after: "C1" }, next: "https://graph.facebook.com/x" },
          })
        : json({ data: [contaBruta("2222222222")] });
    });
    const r = await listarContasAcessiveis(configComToken(meta.fetchFn));
    expect(meta.chamadas.map((c) => c.url.searchParams.get("after"))).toEqual([
      null,
      "C1",
      "C1",
    ]);
    expect(r.ok && r.contas).toHaveLength(2);
  });

  it("token fora do formato nem chama", async () => {
    const meta = metaFalsa(() => json({ data: [] }));
    const r = falhaDe(
      await listarContasAcessiveis(configComToken(meta.fetchFn, { accessToken: "x y" })),
    );
    expect(r.problema).toBe("token_invalido");
    expect(meta.chamadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("revogarAcesso", () => {
  it("DELETE /me/permissions com o token no cabeçalho", async () => {
    const meta = metaFalsa(() => json({ success: true }));
    const r = await revogarAcesso(configComToken(meta.fetchFn));
    expect(r).toEqual({ ok: true, situacao: "revogado" });
    const [chamada] = meta.chamadas;
    expect(chamada!.init.method).toBe("DELETE");
    expect(chamada!.url.pathname).toBe(`/${GRAPH_VERSION}/me/permissions`);
    expect(chamada!.url.toString()).not.toContain(TOKEN);
    expect(cabecalhos(chamada!).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("resposta true (formato antigo) também é revogado", async () => {
    const meta = metaFalsa(() => json(true));
    expect(await revogarAcesso(configComToken(meta.fetchFn))).toEqual({
      ok: true,
      situacao: "revogado",
    });
  });

  it("token já inválido (190) não tem o que revogar", async () => {
    const meta = metaFalsa(() => erroMeta(190, { subcode: 460 }));
    expect(await revogarAcesso(configComToken(meta.fetchFn))).toEqual({
      ok: true,
      situacao: "ja_invalido",
    });
  });

  it("token fora do formato também é ja_invalido, sem chamada", async () => {
    const meta = metaFalsa(() => json({ success: true }));
    expect(
      await revogarAcesso(configComToken(meta.fetchFn, { accessToken: "" })),
    ).toEqual({ ok: true, situacao: "ja_invalido" });
    expect(meta.chamadas).toHaveLength(0);
  });

  it("passageiro repete e depois revoga", async () => {
    const meta = metaFalsa((_c, n) =>
      n === 1 ? new Response("", { status: 502 }) : json({ success: true }),
    );
    expect(await revogarAcesso(configComToken(meta.fetchFn))).toEqual({
      ok: true,
      situacao: "revogado",
    });
    expect(meta.chamadas).toHaveLength(2);
  });

  it("passageiro o tempo todo desiste em 3 chamadas", async () => {
    const meta = metaFalsa(() => json({ error: { code: 2 } }, 500));
    const r = falhaDe(await revogarAcesso(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("meta_indisponivel");
    expect(meta.chamadas).toHaveLength(3);
  });

  it("success falso vira resposta_invalida", async () => {
    const meta = metaFalsa(() => json({ success: false }));
    const r = falhaDe(await revogarAcesso(configComToken(meta.fetchFn)));
    expect(r.problema).toBe("resposta_invalida");
  });
});

// ---------------------------------------------------------------------------

describe("classificação e ação", () => {
  const vazio = new Headers();

  it.each<[string, number, unknown, "troca" | "app" | "token", string]>([
    ["troca 100", 400, { error: { code: 100 } }, "troca", "codigo_recusado"],
    ["troca 401 sem corpo", 401, undefined, "troca", "codigo_recusado"],
    ["app 190", 400, { error: { code: 190 } }, "app", "app_recusado"],
    ["app 401 sem corpo", 401, undefined, "app", "app_recusado"],
    [
      "app 100 de token de outro app",
      400,
      { error: { code: 100, message: "(#100) The App_id in the input_token did not match the Viewing App" } },
      "app",
      "token_de_outro_app",
    ],
    ["app 100 genérico", 400, { error: { code: 100 } }, "app", "parametro_recusado"],
    [
      "token 100 com o mesmo texto (só vale no debug_token)",
      400,
      { error: { code: 100, message: "(#100) The App_id in the input_token did not match the Viewing App" } },
      "token",
      "parametro_recusado",
    ],
    ["token 190", 400, { error: { code: 190 } }, "token", "token_invalido"],
    ["token 102", 400, { error: { code: 102 } }, "token", "token_invalido"],
    ["token 401 sem corpo", 401, undefined, "token", "token_invalido"],
    ["token 10", 400, { error: { code: 10 } }, "token", "sem_permissao"],
    ["token 294", 400, { error: { code: 294 } }, "token", "sem_permissao"],
    ["token 403 sem corpo", 403, undefined, "token", "sem_permissao"],
    ["token 2635", 400, { error: { code: 2635 } }, "token", "versao_descontinuada"],
    ["token 17", 400, { error: { code: 17 } }, "token", "limite_da_meta"],
    ["token 80004", 400, { error: { code: 80004 } }, "token", "limite_da_meta"],
    ["429 sem corpo", 429, undefined, "token", "limite_da_meta"],
    ["token 2", 500, { error: { code: 2 } }, "token", "meta_indisponivel"],
    ["is_transient", 400, { error: { code: 9999, is_transient: true } }, "token", "meta_indisponivel"],
    ["502 sem corpo", 502, undefined, "token", "meta_indisponivel"],
    ["token 100 genérico", 400, { error: { code: 100 } }, "token", "parametro_recusado"],
    ["418", 418, { error: {} }, "token", "outro"],
  ])("%s vira %s", (_nome, http, corpo, papel, problema) => {
    const r = classificarErroDoLogin(http, corpo, vazio, papel);
    expect(r.problema).toBe(problema);
    expect(r.http).toBe(http);
  });

  it("o resultado só tem problema, ação e números: nada da mensagem", () => {
    const r = classificarErroDoLogin(
      400,
      {
        error: {
          message: MENSAGEM_DA_META,
          error_user_msg: MENSAGEM_DA_META,
          code: 100,
          error_subcode: 33,
          fbtrace_id: "AbCdEf",
        },
      },
      vazio,
      "token",
    );
    expect(Object.keys(r).sort()).toEqual(
      [
        "acao",
        "codigoDaMeta",
        "http",
        "ok",
        "problema",
        "subcodigoDaMeta",
        "tentarEmMs",
      ].sort(),
    );
    expect(r.codigoDaMeta).toBe(100);
    expect(r.subcodigoDaMeta).toBe(33);
    semVazamento(r);
    expect(JSON.stringify(r)).not.toContain("AbCdEf");
  });

  it("toda ação é uma das cinco", () => {
    const acoes = new Set([
      "conectar_de_novo",
      "configurar_app",
      "repetir",
      "aguardar",
      "desistir",
    ]);
    for (const problema of PROBLEMAS_DO_LOGIN) {
      expect(acoes.has(acaoDoProblemaDoLogin(problema))).toBe(true);
    }
    expect(acaoDoProblemaDoLogin("limite_da_meta")).toBe("aguardar");
    expect(acaoDoProblemaDoLogin("meta_indisponivel")).toBe("repetir");
    expect(acaoDoProblemaDoLogin("token_invalido")).toBe("conectar_de_novo");
    expect(acaoDoProblemaDoLogin("app_recusado")).toBe("configurar_app");
  });
});
