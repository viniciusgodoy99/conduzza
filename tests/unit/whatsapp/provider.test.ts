import { beforeEach, describe, expect, it } from "vitest";

import {
  FakeProvider,
  fakeDeletedMessages,
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  filtrosDoWebhookConferem,
  nomeDaInstancia,
  UazapiHttpError,
  UazapiProvider,
  type WebhookDaInstancia,
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

  // Varios numeros por clinica (docs/07, Fase 2): instance_id guarda o nome e
  // e unico entre os numeros ativos, entao o numero novo ganha sufixo proprio.
  it("com o número, acrescenta os 8 primeiros caracteres do id dele", () => {
    expect(
      nomeDaInstancia(
        "clinica-conduzza-teste",
        "6180eafd-0000",
        "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      ),
    ).toBe("conduzza_clinica_conduzza_teste_a1b2c3d4");
  });

  it("dois números da mesma clínica nunca recebem o mesmo nome", () => {
    const primeiro = nomeDaInstancia(
      "clinica-x",
      "6180eafd-0000",
      "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const segundo = nomeDaInstancia(
      "clinica-x",
      "6180eafd-0000",
      "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(primeiro).not.toBe(segundo);
  });

  it("sem o número, o nome é o de antes (o principal atual não é renomeado)", () => {
    expect(nomeDaInstancia("clinica-conduzza-teste", "6180eafd-0000")).toBe(
      "conduzza_clinica_conduzza_teste",
    );
    expect(
      nomeDaInstancia("clinica-conduzza-teste", "6180eafd-0000", null),
    ).toBe("conduzza_clinica_conduzza_teste");
    expect(nomeDaInstancia("clinica-conduzza-teste", "6180eafd-0000", "")).toBe(
      "conduzza_clinica_conduzza_teste",
    );
  });

  it("slug vazio com número: início do id da clínica e sufixo do número", () => {
    expect(
      nomeDaInstancia(
        "",
        "6180eafd-1111",
        "A1B2C3D4-0000-4000-8000-000000000000",
      ),
    ).toBe("conduzza_6180eafd_a1b2c3d4");
  });
});

describe("provedor falso por número", () => {
  beforeEach(() => {
    resetFakeProvider();
  });

  it("gera uma instância por número, não por clínica", async () => {
    const fake = new FakeProvider();
    const a = await fake.connectInstance({
      clinicId: "6180eafd-0000",
      accountId: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const b = await fake.connectInstance({
      clinicId: "6180eafd-0000",
      accountId: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(a.instanceId).toBe("fake-11111111");
    expect(b.instanceId).toBe("fake-22222222");
  });

  it("sem o número, mantém o nome antigo pela clínica", async () => {
    const status = await new FakeProvider().connectInstance({
      clinicId: "6180eafd-0000",
    });
    expect(status.instanceId).toBe("fake-6180eafd");
  });

  it("registra por qual número cada envio saiu", async () => {
    const fake = new FakeProvider();
    await fake.sendText({ ...REF, accountId: "conta-a" }, "+5584", "texto");
    await fake.sendMenu({ ...REF, accountId: "conta-b" }, "+5584", "menu", [
      { id: "sim", text: "Confirmar" },
    ]);
    await fake.sendMedia(REF, "+5584", {
      tipo: "image",
      base64: "AAAA",
      mimetype: "image/png",
    });
    expect(fakeSentMessages().map((m) => m.accountId)).toEqual([
      "conta-a",
      "conta-b",
      null,
    ]);
  });
});

describe("excluir instância no uazapi", () => {
  function stubComMetodo(respostas: Array<{ status: number; body?: unknown }>) {
    const chamadas: Array<{
      url: string;
      method: string | undefined;
      token: string | undefined;
      body: unknown;
    }> = [];
    const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        method: init?.method,
        token: (init?.headers as Record<string, string> | undefined)?.token,
        body: init?.body ?? null,
      });
      const proxima = respostas.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(proxima.body ?? {}), {
        status: proxima.status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    return { fn, chamadas };
  }

  it("usa DELETE /instance com o token da instância e sem corpo", async () => {
    const { fn, chamadas } = stubComMetodo([
      { status: 200, body: { response: "Instance Deleted" } },
    ]);
    const resultado = await testProvider(fn).excluirInstancia(REF);
    expect(resultado).toEqual({ ok: true, situacao: "excluida" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://uazapi.exemplo/instance");
    expect(chamadas[0]?.method).toBe("DELETE");
    expect(chamadas[0]?.token).toBe("token-instancia");
    expect(chamadas[0]?.body).toBeNull();
  });

  it("202 é exclusão agendada e 404 é instância que já não existia", async () => {
    const agendada = stubComMetodo([{ status: 202, body: {} }]);
    expect(await testProvider(agendada.fn).excluirInstancia(REF)).toEqual({
      ok: true,
      situacao: "agendada",
    });
    const sumida = stubComMetodo([{ status: 404, body: {} }]);
    expect(await testProvider(sumida.fn).excluirInstancia(REF)).toEqual({
      ok: true,
      situacao: "ja_nao_existia",
    });
  });

  it("número que nunca conectou não chama o servidor", async () => {
    const { fn, chamadas } = stubComMetodo([]);
    const resultado = await testProvider(fn).excluirInstancia({
      ...REF,
      instanceToken: null,
    });
    expect(resultado).toEqual({ ok: true, situacao: "sem_instancia" });
    expect(chamadas).toHaveLength(0);
  });

  it("token recusado e servidor fora do ar viram falha, nunca exceção", async () => {
    const recusado = stubComMetodo([{ status: 401, body: {} }]);
    const r1 = await testProvider(recusado.fn).excluirInstancia(REF);
    expect(r1).toMatchObject({ ok: false, errorCode: "instancia_invalida" });

    const fora = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const r2 = await testProvider(fora).excluirInstancia(REF);
    expect(r2).toMatchObject({ ok: false, errorCode: "provider_indisponivel" });
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

// Marca de rastreio: o eco de uma mensagem nossa volta do uazapi com o
// track_source e o track_id que mandamos, e e por eles que o webhook o
// descarta mesmo quando o filtro wasSentByApi falha. Se um dos quatro envios
// perder a marca, o eco dele vira "mensagem enviada pelo celular" e a
// conversa mostra a mesma mensagem duas vezes.
describe("marca de rastreio (track_source e track_id)", () => {
  const LINHA = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

  function corpo(call: { body: unknown } | undefined): Record<string, unknown> {
    return call?.body as Record<string, unknown>;
  }

  it("texto, mídia e menu levam a origem conduzza e o id da linha", async () => {
    const stub = fetchStub([
      { status: 200, body: { messageid: "M1" } },
      { status: 200, body: { messageid: "M2" } },
      { status: 200, body: { messageid: "M3" } },
    ]);
    const provider = testProvider(stub.fn);
    const extra = { rastreioId: LINHA };

    await provider.sendText(REF, "5511999999999", "oi", extra);
    await provider.sendMedia(
      REF,
      "5511999999999",
      { tipo: "image", base64: "AAAA", mimetype: "image/png", legenda: "foto" },
      extra,
    );
    await provider.sendMenu(
      REF,
      "5511999999999",
      "confirma?",
      [{ id: "sim", text: "Confirmar" }],
      extra,
    );

    expect(stub.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/send/text",
      "/send/media",
      "/send/menu",
    ]);
    for (const call of stub.calls) {
      expect(corpo(call).track_source).toBe("conduzza");
      expect(corpo(call).track_id).toBe(LINHA);
    }
    // A marca nao toma o lugar de nada: a legenda e o texto continuam.
    expect(corpo(stub.calls[1]).text).toBe("foto");
    expect(corpo(stub.calls[2]).text).toBe("confirma?");
  });

  it("o texto numerado de reserva do menu leva a mesma marca", async () => {
    const stub = fetchStub([
      { status: 400, body: { error: "buttons not supported" } },
      { status: 200, body: { messageid: "M-RESERVA" } },
    ]);
    const resultado = await testProvider(stub.fn).sendMenu(
      REF,
      "5511999999999",
      "Confirma?",
      MENU_CONFIRMACAO,
      { rastreioId: LINHA },
    );

    expect(resultado).toEqual({ ok: true, waMessageId: "M-RESERVA" });
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.url).toContain("/send/text");
    expect(corpo(stub.calls[1]).track_source).toBe("conduzza");
    expect(corpo(stub.calls[1]).track_id).toBe(LINHA);
  });

  it("a marca convive com a citação no mesmo corpo", async () => {
    const stub = fetchStub([{ status: 200, body: { messageid: "M1" } }]);
    await testProvider(stub.fn).sendText(REF, "5511999999999", "oi", {
      replyToWaMessageId: "CITADA-1",
      rastreioId: LINHA,
    });
    expect(corpo(stub.calls[0])).toMatchObject({
      replyid: "CITADA-1",
      track_source: "conduzza",
      track_id: LINHA,
    });
  });

  it("sem id, nenhum dos dois campos vai (nunca track_id vazio)", async () => {
    const semId = [undefined, null, "", "   "];
    const stub = fetchStub(
      semId.flatMap(() => [
        { status: 200, body: { messageid: "T" } },
        { status: 200, body: { messageid: "D" } },
        { status: 400, body: {} },
        { status: 200, body: { messageid: "R" } },
      ]),
    );
    const provider = testProvider(stub.fn);

    for (const rastreioId of semId) {
      const extra = { rastreioId };
      await provider.sendText(REF, "5511999999999", "oi", extra);
      await provider.sendMedia(
        REF,
        "5511999999999",
        { tipo: "document", base64: "AAAA", mimetype: "application/pdf" },
        extra,
      );
      // menu recusado + reserva numerada: os dois corpos sem marca
      await provider.sendMenu(
        REF,
        "5511999999999",
        "confirma?",
        [{ id: "sim", text: "Confirmar" }],
        extra,
      );
    }

    expect(stub.calls).toHaveLength(semId.length * 4);
    for (const call of stub.calls) {
      expect(call.body).not.toHaveProperty("track_source");
      expect(call.body).not.toHaveProperty("track_id");
    }
  });

  it("sem extra nenhum, o corpo é o de antes", async () => {
    const stub = fetchStub([{ status: 200, body: { messageid: "M1" } }]);
    await testProvider(stub.fn).sendText(REF, "5511999999999", "oi");
    expect(stub.calls[0]?.body).toEqual({
      number: "5511999999999",
      text: "oi",
    });
  });

  it("o provedor falso registra a marca nos três envios", async () => {
    resetFakeProvider();
    const fake = new FakeProvider();
    await fake.sendText(REF, "5584", "texto", { rastreioId: "linha-t" });
    await fake.sendMedia(
      REF,
      "5584",
      { tipo: "image", base64: "AAAA", mimetype: "image/png" },
      { rastreioId: "linha-m" },
    );
    await fake.sendMenu(REF, "5584", "menu", [{ id: "sim", text: "Ok" }], {
      rastreioId: "linha-b",
    });
    await fake.sendText(REF, "5584", "sem marca");
    expect(fakeSentMessages().map((m) => m.rastreioId)).toEqual([
      "linha-t",
      "linha-m",
      "linha-b",
      null,
    ]);
  });
});

// Conferencia dos webhooks em producao (scripts/ops/conferir-webhooks.ts): so
// leitura, e a url devolvida carrega o segredo.
describe("ler o webhook da instância (GET /webhook)", () => {
  function stubDeLeitura(respostas: Array<{ status: number; body?: unknown }>) {
    const chamadas: Array<{
      url: string;
      method: string | undefined;
      token: string | undefined;
      body: unknown;
    }> = [];
    const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      chamadas.push({
        url: String(url),
        method: init?.method,
        token: (init?.headers as Record<string, string> | undefined)?.token,
        body: init?.body ?? null,
      });
      const proxima = respostas.shift() ?? { status: 200, body: [] };
      return new Response(JSON.stringify(proxima.body ?? []), {
        status: proxima.status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    return { fn, chamadas };
  }

  it("usa GET com o token da instância, sem corpo, e lê a lista", async () => {
    const { fn, chamadas } = stubDeLeitura([
      {
        status: 200,
        body: [
          {
            id: "w1",
            enabled: true,
            url: "https://app.exemplo/api/webhooks/whatsapp?clinic=c&account=a&secret=s",
            events: ["messages", "messages_update", "connection"],
            excludeMessages: ["wasSentByApi"],
            addUrlEvents: false,
            addUrlTypesMessages: false,
          },
        ],
      },
    ]);
    const webhooks = await testProvider(fn).lerWebhooks(REF);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://uazapi.exemplo/webhook");
    expect(chamadas[0]?.method).toBe("GET");
    expect(chamadas[0]?.token).toBe("token-instancia");
    expect(chamadas[0]?.body).toBeNull();
    expect(webhooks).toEqual([
      {
        id: "w1",
        enabled: true,
        url: "https://app.exemplo/api/webhooks/whatsapp?clinic=c&account=a&secret=s",
        events: ["messages", "messages_update", "connection"],
        excludeMessages: ["wasSentByApi"],
        addUrlEvents: false,
        addUrlTypesMessages: false,
      },
    ]);
  });

  it("lista vazia e campos ausentes não quebram a leitura", async () => {
    const vazio = stubDeLeitura([{ status: 200, body: [] }]);
    expect(await testProvider(vazio.fn).lerWebhooks(REF)).toEqual([]);

    const incompleto = stubDeLeitura([{ status: 200, body: [{ url: 7 }] }]);
    expect(await testProvider(incompleto.fn).lerWebhooks(REF)).toEqual([
      {
        id: null,
        enabled: null,
        url: null,
        events: [],
        excludeMessages: [],
        addUrlEvents: null,
        addUrlTypesMessages: null,
      },
    ]);
  });

  it("recusa do servidor vira erro tipado, sem o corpo da resposta", async () => {
    const { fn } = stubDeLeitura([
      { status: 401, body: { error: "segredo-que-nao-pode-vazar" } },
    ]);
    const erro = await testProvider(fn)
      .lerWebhooks(REF)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(UazapiHttpError);
    expect((erro as UazapiHttpError).motivo).toBe("instancia_invalida");
    expect((erro as Error).message).not.toContain("segredo-que-nao-pode-vazar");
  });
});

describe("filtros do webhook deixam passar o celular", () => {
  function webhook(
    parcial: Partial<WebhookDaInstancia> = {},
  ): WebhookDaInstancia {
    return {
      id: "w1",
      enabled: true,
      url: null,
      events: ["messages", "messages_update", "connection"],
      excludeMessages: ["wasSentByApi"],
      addUrlEvents: false,
      addUrlTypesMessages: false,
      ...parcial,
    };
  }

  it("a configuração que configureWebhook grava confere", async () => {
    const { fn, calls } = fetchStub([{ status: 200, body: {} }]);
    await testProvider(fn).configureWebhook(REF, "https://exemplo/webhook");
    const gravado = calls[0]?.body as {
      events: string[];
      excludeMessages: string[];
    };
    expect(
      filtrosDoWebhookConferem(
        webhook({
          events: gravado.events,
          excludeMessages: gravado.excludeMessages,
        }),
      ),
    ).toBe(true);
  });

  it("sem messages, sem wasSentByApi, ou cortando o celular, não confere", () => {
    expect(filtrosDoWebhookConferem(webhook({ events: ["connection"] }))).toBe(
      false,
    );
    expect(filtrosDoWebhookConferem(webhook({ excludeMessages: [] }))).toBe(
      false,
    );
    expect(
      filtrosDoWebhookConferem(
        webhook({ excludeMessages: ["wasSentByApi", "fromMeYes"] }),
      ),
    ).toBe(false);
    expect(
      filtrosDoWebhookConferem(
        webhook({ excludeMessages: ["wasSentByApi", "wasNotSentByApi"] }),
      ),
    ).toBe(false);
  });

  it("filtro de grupo a mais não atrapalha", () => {
    expect(
      filtrosDoWebhookConferem(
        webhook({ excludeMessages: ["wasSentByApi", "isGroupYes"] }),
      ),
    ).toBe(true);
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
