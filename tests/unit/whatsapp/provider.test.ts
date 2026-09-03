import { beforeEach, describe, expect, it } from "vitest";

import {
  FakeProvider,
  fakeDeletedMessages,
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  nomeDaInstancia,
  UazapiProvider,
} from "@/lib/integrations/whatsapp/uazapi";
import type { InstanceRef } from "@/lib/integrations/whatsapp/provider";
import { textoNumerado } from "@/lib/integrations/whatsapp/menu-texto";
import { falhaPermiteRetry } from "@/lib/integrations/whatsapp/send";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";

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
    const opcoes = [
      { id: "sim", text: "Confirmar" },
      { id: "remarcar", text: "Remarcar" },
    ];
    const result = await testProvider(fn).sendMenu(
      REF,
      "+5584",
      "Confirma?",
      opcoes,
    );
    expect(result).toEqual({ ok: true, waMessageId: "wamid-fallback" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("/send/text");
    // O texto enviado tem que ser IGUAL ao que sendWhatsAppMenu grava em
    // message.body: e isso que faz a conversa no Inbox explicar a resposta "1".
    expect(String((calls[1]?.body as { text: string }).text)).toBe(
      textoNumerado("Confirma?", opcoes),
    );
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

  // Defeito real: sendMenu nao tinha try/catch. Falha de rede virava exceção,
  // o orquestrador a classificava como 'provider_indisponivel' (que PERMITE
  // retry) e o paciente podia receber o toque de confirmação duas vezes.
  it("falha de rede no sendMenu vira envio_incerto, que NÃO permite retry", async () => {
    const chamadas: string[] = [];
    const fn = (async (url: RequestInfo | URL) => {
      chamadas.push(String(url));
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const resultado = await testProvider(fn).sendMenu(
      REF,
      "+5584",
      "Podemos confirmar?",
      MENU_CONFIRMACAO,
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errorCode).toBe("envio_incerto");
      // A prova que importa: este código não entra na fila de reenvio.
      expect(falhaPermiteRetry(resultado.errorCode)).toBe(false);
    }
    // Envio nunca repete sozinho: uma tentativa, e só.
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toContain("/send/menu");
  });

  it("falha de rede no fallback numerado também vira envio_incerto", async () => {
    let chamada = 0;
    const fn = (async () => {
      chamada++;
      if (chamada === 1) {
        // Servidor recusa o botão: o cliente degrada para texto numerado.
        return new Response(JSON.stringify({ error: "no buttons" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const resultado = await testProvider(fn).sendMenu(
      REF,
      "+5584",
      "Podemos confirmar?",
      MENU_CONFIRMACAO,
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errorCode).toBe("envio_incerto");
      expect(falhaPermiteRetry(resultado.errorCode)).toBe(false);
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

// O servidor uazapi e compartilhado com outros produtos do grupo: o rotulo da
// instancia precisa dizer, numa olhada no painel, que e da Conduzza e de qual
// clinica.
describe("nome da instância no painel do uazapi", () => {
  it("usa o prefixo do produto e o slug da clínica", () => {
    expect(nomeDaInstancia("clinica-conduzza-teste", "6180eafd-0000")).toBe(
      "conduzza_clinica_conduzza_teste",
    );
  });

  it("normaliza acento, maiúscula e pontuação do slug", () => {
    expect(nomeDaInstancia("Clínica São Paulo!", "abcd1234-0000")).toBe(
      "conduzza_clinica_sao_paulo",
    );
  });

  it("slug vazio ou sem letras cai no início do id da clínica", () => {
    expect(nomeDaInstancia("", "6180eafd-1111")).toBe("conduzza_6180eafd");
    expect(nomeDaInstancia("---", "6180eafd-1111")).toBe("conduzza_6180eafd");
  });

  it("corta slug muito longo sem deixar separador solto na ponta", () => {
    const nome = nomeDaInstancia("a".repeat(60), "abcd1234-0000");
    expect(nome.length).toBeLessThanOrEqual("conduzza_".length + 40);
    expect(nome.endsWith("_")).toBe(false);
  });
});

// Responder citando e apagar, na camada do provedor.
//
// O contrato veio da especificacao oficial e foi confirmado contra a instancia
// real (scripts/dev/prova-de-citar-e-apagar.mts), mas prova manual nao pega
// regressao: estes testes travam o formato do corpo, que e onde um refactor
// silencioso quebraria o envio sem ninguem perceber.
describe("responder citando (replyid)", () => {
  it("o replyid vai no corpo de texto, midia e menu", async () => {
    const stub = fetchStub([
      { status: 200, body: { messageid: "M1" } },
      { status: 200, body: { messageid: "M2" } },
      { status: 200, body: { messageid: "M3" } },
    ]);
    const provider = testProvider(stub.fn);
    const extra = { replyToWaMessageId: "CITADA-123" };

    await provider.sendText(REF, "5511999999999", "oi", extra);
    await provider.sendMedia(
      REF,
      "5511999999999",
      { tipo: "image", base64: "AAAA", mimetype: "image/png" },
      extra,
    );
    await provider.sendMenu(
      REF,
      "5511999999999",
      "confirma?",
      [{ id: "sim", text: "Confirmar" }],
      extra,
    );

    for (const call of stub.calls) {
      expect((call.body as Record<string, unknown>).replyid).toBe("CITADA-123");
    }
  });

  it("SEM citacao o campo nao aparece, em vez de ir vazio", async () => {
    // `replyid: ""` faria o provedor tentar citar a mensagem de id vazio e
    // recusar o envio inteiro. Ausente e diferente de vazio.
    const stub = fetchStub([{ status: 200, body: { messageid: "M1" } }]);
    await testProvider(stub.fn).sendText(REF, "5511999999999", "oi");
    expect(stub.calls[0]!.body).not.toHaveProperty("replyid");
  });

  it("o provedor falso registra a citacao para os testes conferirem", async () => {
    resetFakeProvider();
    await new FakeProvider().sendText(REF, "5511999999999", "oi", {
      replyToWaMessageId: "CITADA-999",
    });
    expect(fakeSentMessages()[0]?.replyToWaMessageId).toBe("CITADA-999");
  });
});

describe("apagar mensagem no provedor", () => {
  it("manda o id no corpo e aceita 200", async () => {
    const stub = fetchStub([{ status: 200, body: { id: "M1" } }]);
    const resultado = await testProvider(stub.fn).deleteMessage(REF, "M1");
    expect(resultado.ok).toBe(true);
    expect(stub.calls[0]!.url).toContain("/message/delete");
    expect(stub.calls[0]!.body).toEqual({ id: "M1" });
  });

  it("recusa do WhatsApp vira falha com motivo, nunca sucesso silencioso", async () => {
    // Devolver ok aqui faria a clinica acreditar que a mensagem sumiu do
    // celular do paciente quando ela continua la.
    const stub = fetchStub([
      { status: 400, body: { message_ptbr: "fora do prazo" } },
    ]);
    const resultado = await testProvider(stub.fn).deleteMessage(REF, "M1");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.message).toBe("fora do prazo");
    }
  });

  it("o provedor falso registra o que foi revogado", async () => {
    resetFakeProvider();
    await new FakeProvider().deleteMessage(REF, "M-APAGADA");
    expect(fakeDeletedMessages()).toEqual(["M-APAGADA"]);
  });
});
