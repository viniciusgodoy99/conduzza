import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { enviarEventosCapi } from "@/lib/integrations/meta/capi";
import {
  hashTelefoneParaMeta,
  montarEventoCapi,
} from "@/lib/integrations/meta/payload";

// Aceite do R3: a montagem do evento da Conversions API e pura e obedece as
// regras de privacidade (telefone so hasheado e so no modo permitido) e o
// formato business_messaging confirmado na doc da Meta (ctwa_clid exige o
// whatsapp_business_account_id junto).

const BASE = {
  eventName: "Purchase",
  eventId: "11111111-2222-4333-8444-555555555555",
  eventTimeUnix: 1_775_000_000,
  ctwaClid: "clid-abc",
  wabaId: "9876543210",
  phoneE164: "+5585999990000",
  valueCents: 25000,
  currency: "BRL",
  modo: "telefone_hasheado" as const,
};

describe("hashTelefoneParaMeta", () => {
  it("hasheia o E.164 sem o sinal de mais, só dígitos", () => {
    const esperado = createHash("sha256")
      .update("5585999990000")
      .digest("hex");
    expect(hashTelefoneParaMeta("+5585999990000")).toBe(esperado);
    // Formatacao nao muda o hash: mesmo numero, mesmo resultado.
    expect(hashTelefoneParaMeta("+55 (85) 99999-0000")).toBe(esperado);
  });
});

describe("montarEventoCapi", () => {
  it("com ctwa_clid e WABA monta business_messaging com o par obrigatório", () => {
    const r = montarEventoCapi(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento.action_source).toBe("business_messaging");
    expect(r.evento.messaging_channel).toBe("whatsapp");
    expect(r.evento.user_data.whatsapp_business_account_id).toBe("9876543210");
    expect(r.evento.user_data.ctwa_clid).toBe("clid-abc");
    expect(r.evento.user_data.ph).toEqual([
      hashTelefoneParaMeta("+5585999990000"),
    ]);
    expect(r.evento.custom_data).toEqual({ value: 250, currency: "BRL" });
  });

  it("no modo ctwa_apenas o telefone NUNCA entra, nem havendo telefone", () => {
    const r = montarEventoCapi({ ...BASE, modo: "ctwa_apenas" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento.user_data.ph).toBeUndefined();
    expect(JSON.stringify(r.evento)).not.toContain("5585999990000");
  });

  it("sem valor não há custom_data (valor zero é valor, nulo não)", () => {
    const semValor = montarEventoCapi({ ...BASE, valueCents: null });
    expect(semValor.ok && semValor.evento.custom_data).toBeUndefined();
    const comZero = montarEventoCapi({ ...BASE, valueCents: 0 });
    expect(comZero.ok && comZero.evento.custom_data).toEqual({
      value: 0,
      currency: "BRL",
    });
  });

  it("sem o par ctwa+waba, modo telefone cai no evento genérico com ph", () => {
    const r = montarEventoCapi({ ...BASE, ctwaClid: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento.action_source).toBe("system_generated");
    expect(r.evento.messaging_channel).toBeUndefined();
    expect(r.evento.user_data).toEqual({
      ph: [hashTelefoneParaMeta("+5585999990000")],
    });
  });

  it("modo ctwa_apenas sem o par descarta com o código do que falta", () => {
    const semClid = montarEventoCapi({
      ...BASE,
      modo: "ctwa_apenas",
      ctwaClid: null,
    });
    expect(semClid).toEqual({ ok: false, descarte: "sem_ctwa_clid" });
    const semWaba = montarEventoCapi({
      ...BASE,
      modo: "ctwa_apenas",
      wabaId: null,
    });
    expect(semWaba).toEqual({ ok: false, descarte: "sem_waba_id" });
  });

  it("modo telefone sem telefone e sem par não tem o que enviar", () => {
    const r = montarEventoCapi({
      ...BASE,
      ctwaClid: null,
      phoneE164: null,
    });
    expect(r).toEqual({ ok: false, descarte: "sem_identificador" });
  });
});

describe("enviarEventosCapi (fetch falso)", () => {
  const evento = (() => {
    const r = montarEventoCapi(BASE);
    if (!r.ok) throw new Error("montagem falhou");
    return r.evento;
  })();

  it("manda para o pixel certo, com token e test_event_code no corpo", async () => {
    let urlChamada = "";
    let corpo: Record<string, unknown> = {};
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      urlChamada = String(url);
      corpo = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ events_received: 1 }), {
        status: 200,
      });
    }) as typeof fetch;

    const r = await enviarEventosCapi(
      {
        pixelId: "111222333",
        accessToken: "tok-teste",
        testEventCode: "TEST123",
        fetchFn,
      },
      [evento],
    );
    expect(r).toEqual({ ok: true, eventsReceived: 1 });
    expect(urlChamada).toContain("/111222333/events");
    expect(corpo.access_token).toBe("tok-teste");
    expect(corpo.test_event_code).toBe("TEST123");
    expect(Array.isArray(corpo.data) && corpo.data).toHaveLength(1);
  });

  it("4xx não repete e devolve código sem retry", async () => {
    let chamadas = 0;
    const fetchFn = (async () => {
      chamadas += 1;
      return new Response(
        JSON.stringify({ error: { code: 190, type: "OAuthException" } }),
        { status: 401 },
      );
    }) as typeof fetch;

    const r = await enviarEventosCapi(
      { pixelId: "1", accessToken: "x", testEventCode: null, fetchFn },
      [evento],
    );
    expect(r).toEqual({ ok: false, errorCode: "token_invalido", retryable: false });
    expect(chamadas).toBe(1);
  });

  it("5xx tenta de novo e, esgotado, devolve retryable", async () => {
    let chamadas = 0;
    const fetchFn = (async () => {
      chamadas += 1;
      return new Response("{}", { status: 503 });
    }) as typeof fetch;

    const r = await enviarEventosCapi(
      { pixelId: "1", accessToken: "x", testEventCode: null, fetchFn },
      [evento],
    );
    expect(r).toEqual({ ok: false, errorCode: "http_503", retryable: true });
    expect(chamadas).toBe(3); // 1 tentativa + 2 retries
  });
});
