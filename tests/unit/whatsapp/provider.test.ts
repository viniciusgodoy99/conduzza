import { beforeEach, describe, expect, it } from "vitest";

import {
  FakeProvider,
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { UazapiProvider } from "@/lib/integrations/whatsapp/uazapi";
import type { InstanceRef } from "@/lib/integrations/whatsapp/provider";

const REF: InstanceRef = {
  clinicId: "clinica-teste",
  serverUrl: "https://uazapi.exemplo",
  instanceToken: "token-instancia",
};

function fetchStub(responses: Array<{ status: number; body?: unknown }>): {
  fn: typeof fetch;
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

function testProvider(stub: typeof fetch): UazapiProvider {
  // O espacamento anti-ban nao vive mais no provedor: e um slot reservado no
  // banco (reservar_slot_envio), provado nos testes de integracao do worker.
  return new UazapiProvider({ fetchFn: stub });
}

describe("FakeProvider", () => {
  beforeEach(() => {
    resetFakeProvider();
  });

  it("registra envios e devolve id proprio", async () => {
    const fake = new FakeProvider();
    const result = await fake.sendText(REF, "+5584999990000", "Olá!");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.waMessageId).toMatch(/^fake:/);
    }
    expect(fakeSentMessages()).toHaveLength(1);
    expect(fakeSentMessages()[0]?.body).toBe("Olá!");
  });

  it("conecta na hora, sem QR", async () => {
    const fake = new FakeProvider();
    const status = await fake.connectInstance(REF);
    expect(status.status).toBe("conectado");
    expect(status.qrCode).toBeNull();
  });
});

describe("UazapiProvider", () => {
  it("faz retry em erro 5xx nas operações que podem repetir (status da instância)", async () => {
    const { fn, calls } = fetchStub([
      { status: 500 },
      { status: 200, body: { instance: { status: "connected" } } },
    ]);
    const status = await testProvider(fn).getStatus(REF);
    expect(calls).toHaveLength(2);
    expect(status.status).toBe("conectado");
  });

  it("nao faz retry em 4xx e devolve erro tipado", async () => {
    const { fn, calls } = fetchStub([
      { status: 401, body: { error: "invalid token" } },
    ]);
    const result = await testProvider(fn).sendText(REF, "+5584", "oi");
    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      errorCode: "uazapi_401",
      message: "invalid token",
    });
  });

  it("sendMenu degrada para texto numerado quando o servidor recusa", async () => {
    const { fn, calls } = fetchStub([
      { status: 400, body: { error: "buttons not supported" } },
      { status: 200, body: { id: "wamid-fallback" } },
    ]);
    const result = await testProvider(fn).sendMenu(REF, "+5584", "Confirma?", [
      { id: "sim", text: "Confirmar" },
      { id: "remarcar", text: "Remarcar" },
    ]);
    expect(result).toEqual({ ok: true, waMessageId: "wamid-fallback" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("/send/text");
    expect(String((calls[1]?.body as { text: string }).text)).toContain(
      "1. Confirmar",
    );
    expect(String((calls[1]?.body as { text: string }).text)).toContain(
      "Responda com o número",
    );
  });

  it("fila anti-ban: envios da mesma instância saem em ordem", async () => {
    const { fn, calls } = fetchStub([
      { status: 200, body: { id: "m1" } },
      { status: 200, body: { id: "m2" } },
    ]);
    const provider = testProvider(fn);
    const [first, second] = await Promise.all([
      provider.sendText(REF, "+5584", "primeira"),
      provider.sendText(REF, "+5584", "segunda"),
    ]);
    expect(first).toEqual({ ok: true, waMessageId: "m1" });
    expect(second).toEqual({ ok: true, waMessageId: "m2" });
    expect(calls.map((call) => (call.body as { text: string }).text)).toEqual([
      "primeira",
      "segunda",
    ]);
  });
});

// Testes de blindagem: cada um destes cobre um defeito real encontrado na
// auditoria de 20/08/2026. Se alguem remover a protecao, o teste quebra.

describe("blindagem contra defeitos conhecidos", () => {
  it("configureWebhook SEMPRE envia excludeMessages, senao vira laço infinito", async () => {
    const { fn, calls } = fetchStub([{ status: 200, body: {} }]);
    await testProvider(fn).configureWebhook(REF, "https://exemplo/webhook");
    const corpo = calls[0]?.body as {
      excludeMessages?: string[];
      events?: string[];
      url?: string;
    };
    expect(corpo.excludeMessages).toEqual(["wasSentByApi"]);
    expect(corpo.events).toContain("messages");
    expect(corpo.url).toBe("https://exemplo/webhook");
  });

  it("envio de texto NAO repete em erro de servidor: mensagem duplicada é pior que falha", async () => {
    const { fn, calls } = fetchStub([
      { status: 500 },
      { status: 200, body: { messageid: "nao-deveria-chegar-aqui" } },
    ]);
    const resultado = await testProvider(fn).sendText(REF, "+5584", "oi");
    expect(calls).toHaveLength(1);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errorCode).toBe("envio_incerto");
    }
  });

  it("erro 463 do WhatsApp não é repetido e vira mensagem compreensível", async () => {
    const { fn, calls } = fetchStub([
      {
        status: 500,
        body: {
          provider_code: 463,
          error_key: "WHATSAPP_REACHOUT_TIMELOCK",
          message_ptbr: "O servidor do WhatsApp recusou esta mensagem.",
        },
      },
    ]);
    const resultado = await testProvider(fn).sendText(REF, "+5584", "oi");
    expect(calls).toHaveLength(1);
    expect(resultado).toEqual({
      ok: false,
      errorCode: "whatsapp_463",
      message:
        "O WhatsApp restringiu temporariamente este número para iniciar conversas.",
    });
  });

  it("prioriza messageid (id do WhatsApp) sobre id interno", async () => {
    const { fn } = fetchStub([
      {
        status: 200,
        body: { id: "558185464605:INTERNO", messageid: "WAMID-REAL" },
      },
    ]);
    const resultado = await testProvider(fn).sendText(REF, "+5584", "oi");
    expect(resultado).toEqual({ ok: true, waMessageId: "WAMID-REAL" });
  });

  it("consulta de status usa GET, conforme a especificação", async () => {
    const { fn, calls } = fetchStub([
      { status: 200, body: { instance: { status: "connected" } } },
    ]);
    const status = await testProvider(fn).getStatus(REF);
    expect(status.status).toBe("conectado");
    expect(calls[0]?.url).toContain("/instance/status");
    expect(calls[0]?.body).toBeNull();
  });

  it("createInstance usa o token administrativo e devolve o token da instância", async () => {
    process.env.UAZAPI_ADMIN_TOKEN = "admin-de-teste";
    const { fn, calls } = fetchStub([
      { status: 200, body: { token: "token-da-clinica", name: "conduzza-x" } },
    ]);
    const criada = await testProvider(fn).createInstance(REF, "conduzza-x");
    expect(criada.instanceToken).toBe("token-da-clinica");
    expect(calls[0]?.url).toContain("/instance/create");
  });

  it("teto de instâncias (429) vira mensagem clara, não erro técnico", async () => {
    process.env.UAZAPI_ADMIN_TOKEN = "admin-de-teste";
    const { fn } = fetchStub([{ status: 429, body: {} }]);
    await expect(
      testProvider(fn).createInstance(REF, "conduzza-y"),
    ).rejects.toThrow(/limite de instâncias/);
  });
});
