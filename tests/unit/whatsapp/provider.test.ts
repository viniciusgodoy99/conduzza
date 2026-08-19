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
  // Atraso anti-ban minimo nos testes; em producao e 1,5s a 4s.
  return new UazapiProvider({ sendDelayRangeMs: [1, 2], fetchFn: stub });
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
  it("faz retry em erro 5xx e devolve o id da resposta", async () => {
    const { fn, calls } = fetchStub([
      { status: 500 },
      { status: 200, body: { id: "wamid-123" } },
    ]);
    const result = await testProvider(fn).sendText(REF, "+5584", "oi");
    expect(calls).toHaveLength(2);
    expect(result).toEqual({ ok: true, waMessageId: "wamid-123" });
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
