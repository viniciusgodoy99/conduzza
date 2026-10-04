import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  criarCacheDeToken,
  invalidarTokenDaContaDeServico,
  lerChaveDaContaDeServico,
  MARGEM_DE_RENOVACAO_MS,
  montarJwtDaContaDeServico,
  obterTokenDaContaDeServico,
  type ChaveDaContaDeServico,
} from "@/lib/integrations/google/conta-de-servico";
import {
  GOOGLE_ADS_SCOPE,
  GOOGLE_TOKEN_URL,
} from "@/lib/integrations/google/versao";

// Conta de servico (modo administrador, F2.2): JWT RS256 com chave gerada
// AQUI no teste, troca por access token com fetch falso e cache em memoria.

const { privateKey: PEM_PRIVADO, publicKey: PEM_PUBLICO } = generateKeyPairSync(
  "rsa",
  {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  },
);

const EMAIL = "conduzza-ads@projeto-teste.iam.gserviceaccount.com";
const ID_DA_CHAVE = "0123456789abcdef0123456789abcdef01234567";
const ACCESS_TOKEN = "ya29.tokenDeAcessoDaContaDeServico-SEGREDO";

function jsonDaChave(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "service_account",
    project_id: "projeto-teste",
    private_key_id: ID_DA_CHAVE,
    private_key: PEM_PRIVADO,
    client_email: EMAIL,
    token_uri: "https://evil.example.com/token",
    ...extra,
  });
}

function chaveDeTeste(): ChaveDaContaDeServico {
  const lida = lerChaveDaContaDeServico(jsonDaChave());
  if (!lida.ok) throw new Error("chave de teste nao leu");
  return lida.chave;
}

function decodificar(parte: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(parte, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function googleFalso(respostas: Response[]) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)]!;
    i += 1;
    return r.clone();
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

const AGORA = Date.parse("2026-10-04T12:00:00.000Z");

describe("lerChaveDaContaDeServico", () => {
  it("le a chave e guarda num KeyObject que nao vaza em JSON", () => {
    const lida = lerChaveDaContaDeServico(jsonDaChave());
    expect(lida.ok).toBe(true);
    if (!lida.ok) return;
    expect(lida.chave.email).toBe(EMAIL);
    expect(lida.chave.idDaChave).toBe(ID_DA_CHAVE);
    expect(JSON.stringify(lida.chave)).not.toContain("PRIVATE KEY");
  });

  it("aceita a quebra de linha colada como \\n literal", () => {
    const literal = PEM_PRIVADO.replace(/\n/g, "\\n");
    expect(
      lerChaveDaContaDeServico(jsonDaChave({ private_key: literal })).ok,
    ).toBe(true);
  });

  it("recusa JSON torto, tipo errado, e-mail estranho e chave que nao e RSA", () => {
    const { privateKey: chaveEc } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    for (const json of [
      "{nao e json",
      jsonDaChave({ type: "authorized_user" }),
      jsonDaChave({ client_email: "alguem@gmail.com" }),
      jsonDaChave({
        private_key:
          "-----BEGIN PRIVATE KEY-----\nlixo\n-----END PRIVATE KEY-----\n",
      }),
      jsonDaChave({ private_key: chaveEc }),
      jsonDaChave({ private_key_id: "com espaco" }),
    ]) {
      const lida = lerChaveDaContaDeServico(json);
      expect(lida).toMatchObject({
        ok: false,
        problema: "credencial_do_sistema",
        acao: "desistir",
      });
      expect(JSON.stringify(lida)).not.toContain("PRIVATE");
    }
  });
});

describe("montarJwtDaContaDeServico", () => {
  it("JWT bem formado: cabecalho RS256 com kid, claims do Google e assinatura valida", () => {
    const jwt = montarJwtDaContaDeServico(chaveDeTeste(), { agoraMs: AGORA });
    const partes = jwt.split(".");
    expect(partes).toHaveLength(3);
    const [cabecalho, claims, assinatura] = partes as [string, string, string];
    expect(decodificar(cabecalho)).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: ID_DA_CHAVE,
    });
    const iat = Math.floor(AGORA / 1000);
    expect(decodificar(claims)).toEqual({
      iss: EMAIL,
      scope: GOOGLE_ADS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    });
    // base64url sem preenchimento.
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const valida = verify(
      "sha256",
      Buffer.from(`${cabecalho}.${claims}`),
      PEM_PUBLICO,
      Buffer.from(assinatura, "base64url"),
    );
    expect(valida).toBe(true);
  });

  it("assinatura nao confere com o conteudo trocado", () => {
    const jwt = montarJwtDaContaDeServico(chaveDeTeste(), { agoraMs: AGORA });
    const [cabecalho, , assinatura] = jwt.split(".") as [
      string,
      string,
      string,
    ];
    const outro = Buffer.from(JSON.stringify({ iss: "outro" })).toString(
      "base64url",
    );
    expect(
      verify(
        "sha256",
        Buffer.from(`${cabecalho}.${outro}`),
        PEM_PUBLICO,
        Buffer.from(assinatura, "base64url"),
      ),
    ).toBe(false);
  });
});

describe("obterTokenDaContaDeServico", () => {
  it("troca o JWT no endpoint fixo (ignora o token_uri do arquivo) e guarda no cache", async () => {
    let agora = AGORA;
    const cache = criarCacheDeToken();
    const { fetchFn, chamadas } = googleFalso([
      json({
        access_token: ACCESS_TOKEN,
        expires_in: 3599,
        token_type: "Bearer",
      }),
    ]);
    const chave = chaveDeTeste();
    const primeiro = await obterTokenDaContaDeServico(chave, {
      fetchFn,
      cache,
      agora: () => agora,
    });
    expect(primeiro).toEqual({
      ok: true,
      accessToken: ACCESS_TOKEN,
      expiraEm: AGORA + 3_599_000,
      doCache: false,
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(chamadas[0]!.init.method).toBe("POST");
    const corpo = new URLSearchParams(String(chamadas[0]!.init.body));
    expect(corpo.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    expect(corpo.get("assertion")?.split(".")).toHaveLength(3);

    agora += 30 * 60_000;
    const segundo = await obterTokenDaContaDeServico(chave, {
      fetchFn,
      cache,
      agora: () => agora,
    });
    expect(segundo).toMatchObject({
      ok: true,
      accessToken: ACCESS_TOKEN,
      doCache: true,
    });
    expect(chamadas).toHaveLength(1);
  });

  it("renova perto do vencimento", async () => {
    let agora = AGORA;
    const cache = criarCacheDeToken();
    const { fetchFn, chamadas } = googleFalso([
      json({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
      json({ access_token: `${ACCESS_TOKEN}-novo`, expires_in: 3600 }),
    ]);
    const chave = chaveDeTeste();
    await obterTokenDaContaDeServico(chave, {
      fetchFn,
      cache,
      agora: () => agora,
    });
    agora += 3_600_000 - MARGEM_DE_RENOVACAO_MS + 1;
    const renovado = await obterTokenDaContaDeServico(chave, {
      fetchFn,
      cache,
      agora: () => agora,
    });
    expect(renovado).toMatchObject({
      ok: true,
      accessToken: `${ACCESS_TOKEN}-novo`,
      doCache: false,
    });
    expect(chamadas).toHaveLength(2);
  });

  it("pedidos simultaneos dividem uma troca so", async () => {
    const cache = criarCacheDeToken();
    const { fetchFn, chamadas } = googleFalso([
      json({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
    ]);
    const chave = chaveDeTeste();
    const [a, b] = await Promise.all([
      obterTokenDaContaDeServico(chave, { fetchFn, cache }),
      obterTokenDaContaDeServico(chave, { fetchFn, cache }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
  });

  it("invalidar esquece o token guardado", async () => {
    const cache = criarCacheDeToken();
    const { fetchFn, chamadas } = googleFalso([
      json({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
    ]);
    const chave = chaveDeTeste();
    await obterTokenDaContaDeServico(chave, { fetchFn, cache });
    invalidarTokenDaContaDeServico(chave, { cache });
    await obterTokenDaContaDeServico(chave, { fetchFn, cache });
    expect(chamadas).toHaveLength(2);
  });

  it("invalid_grant aqui e problema do sistema, sem retry e sem a descricao", async () => {
    const cache = criarCacheDeToken();
    const { fetchFn, chamadas } = googleFalso([
      json(
        {
          error: "invalid_grant",
          error_description: "Invalid JWT Signature. SEGREDO",
        },
        400,
      ),
    ]);
    const resultado = await obterTokenDaContaDeServico(chaveDeTeste(), {
      fetchFn,
      cache,
    });
    expect(resultado).toEqual({
      ok: false,
      problema: "credencial_do_sistema",
      acao: "desistir",
      transitorio: false,
      tentarEmMs: null,
      codigoDoGoogle: "invalid_grant",
      http: 400,
      requestId: null,
    });
    expect(chamadas).toHaveLength(1);
    expect(cache.entradas.size).toBe(0);
  });

  it("falha transitoria repete e nao vira problema do sistema", async () => {
    const cache = criarCacheDeToken();
    const { fetchFn, chamadas } = googleFalso([
      json({ error: "server_error" }, 500),
      json({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
    ]);
    const resultado = await obterTokenDaContaDeServico(chaveDeTeste(), {
      fetchFn,
      cache,
      dormir: async () => {},
    });
    expect(resultado.ok).toBe(true);
    expect(chamadas).toHaveLength(2);
  });

  it("resposta sem access_token valido e resposta invalida", async () => {
    const cache = criarCacheDeToken();
    const { fetchFn } = googleFalso([
      json({ access_token: "curto", expires_in: 3600 }),
    ]);
    expect(
      await obterTokenDaContaDeServico(chaveDeTeste(), { fetchFn, cache }),
    ).toMatchObject({
      ok: false,
      problema: "resposta_invalida",
    });
  });
});
