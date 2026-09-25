import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";

// Webhook de entrada do WhatsApp com VARIOS NUMEROS por clinica (docs/07,
// Fase 2). O que se prova aqui, sem banco:
//   - a URL nova (?account=) confere o segredo DAQUELE numero e a clinica;
//   - a URL legada (so ?clinic=) acha o numero pelo segredo entre os ATIVOS
//     e deixa rastro (webhook_url_legada);
//   - numero removido recebe 401 nos dois caminhos;
//   - o token da instancia conferido e o do numero resolvido;
//   - tudo o que o evento toca e filtrado pelo numero: ingestao, job de midia,
//     eco do celular, recibo, apagamento e status de conexao.

type Resultado = { data: unknown; error: { code?: string } | null };
type Filtro = [string, string, unknown];

class Consulta implements PromiseLike<Resultado> {
  operacao: "select" | "update" | "insert" = "select";
  valores: unknown = null;
  readonly filtros: Filtro[] = [];

  constructor(
    readonly tabela: string,
    private readonly responder: (consulta: Consulta) => Resultado,
  ) {}

  select(): this {
    return this;
  }
  update(valores: unknown): this {
    this.operacao = "update";
    this.valores = valores;
    return this;
  }
  insert(valores: unknown): this {
    this.operacao = "insert";
    this.valores = valores;
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.filtros.push(["eq", coluna, valor]);
    return this;
  }
  neq(coluna: string, valor: unknown): this {
    this.filtros.push(["neq", coluna, valor]);
    return this;
  }
  is(coluna: string, valor: unknown): this {
    this.filtros.push(["is", coluna, valor]);
    return this;
  }
  in(coluna: string, valor: unknown): this {
    this.filtros.push(["in", coluna, valor]);
    return this;
  }
  or(expressao: string): this {
    this.filtros.push(["or", "", expressao]);
    return this;
  }
  maybeSingle(): Promise<Resultado> {
    return Promise.resolve(this.responder(this));
  }
  then<A = Resultado, B = never>(
    ok?: ((valor: Resultado) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.responder(this)).then(ok, falha);
  }

  valorDe(operador: string, coluna: string): unknown {
    return this.filtros.find(
      ([op, col]) => op === operador && col === coluna,
    )?.[2];
  }
}

const CLINICA = "11111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "99999999-9999-4999-8999-999999999999";
const NUMERO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NUMERO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NUMERO_REMOVIDO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Conta = {
  id: string;
  clinic_id: string;
  removido_em: string | null;
  provider: string;
  connection_status: string;
};
type Segredo = {
  account_id: string;
  clinic_id: string;
  webhook_secret: string;
  instance_token: string | null;
};

let contas: Conta[] = [];
let segredos: Segredo[] = [];
let falharLeitura = false;
const consultas: Consulta[] = [];

function responder(consulta: Consulta): Resultado {
  if (falharLeitura && consulta.operacao === "select") {
    return { data: null, error: { code: "08006" } };
  }
  if (
    consulta.tabela === "whatsapp_account" &&
    consulta.operacao === "select"
  ) {
    const id = consulta.valorDe("eq", "id");
    if (id !== undefined) {
      return { data: contas.find((c) => c.id === id) ?? null, error: null };
    }
    const clinica = consulta.valorDe("eq", "clinic_id");
    const soAtivos = consulta.valorDe("is", "removido_em") === null;
    return {
      data: contas
        .filter((c) => c.clinic_id === clinica)
        .filter((c) => !soAtivos || c.removido_em === null)
        .map((c) => ({
          id: c.id,
          provider: c.provider,
          connection_status: c.connection_status,
        })),
      error: null,
    };
  }
  if (consulta.tabela === "whatsapp_account_secret") {
    const numero = consulta.valorDe("eq", "account_id");
    if (numero !== undefined) {
      return {
        data: segredos.find((s) => s.account_id === numero) ?? null,
        error: null,
      };
    }
    const clinica = consulta.valorDe("eq", "clinic_id");
    return {
      data: segredos.filter((s) => s.clinic_id === clinica),
      error: null,
    };
  }
  if (consulta.tabela === "contact") {
    return { data: { id: "contato-1" }, error: null };
  }
  if (
    consulta.tabela === "whatsapp_account" &&
    consulta.operacao === "update"
  ) {
    return { data: [{ id: consulta.valorDe("eq", "id") }], error: null };
  }
  return { data: null, error: null };
}

const rpc = vi.fn();
const ingerir = vi.fn();
const interceptar = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const consulta = new Consulta(tabela, responder);
      consultas.push(consulta);
      return consulta;
    },
    rpc,
    storage: {
      from: () => ({ remove: async () => ({ data: null, error: null }) }),
    },
  }),
}));
vi.mock("@/lib/integrations/whatsapp/ingest", () => ({
  ingerirMensagemRecebida: ingerir,
}));
vi.mock("@/lib/integrations/whatsapp/interceptar-resposta", () => ({
  interceptarRespostaDePaciente: interceptar,
}));

const { POST, maxDuration, runtime } =
  await import("@/app/api/webhooks/whatsapp/route");

function pedido(query: string, corpo: unknown): NextRequest {
  return new NextRequest(
    `https://exemplo.test/api/webhooks/whatsapp?${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    },
  );
}

const RECEBIDA = {
  kind: "message_received",
  phone: "+5584970000001",
  name: "Paciente",
  waMessageId: "wa-1",
  contentType: "texto",
  body: "Bom dia",
};

function ingestInserida(numero: string, extra: Record<string, unknown> = {}) {
  return {
    data: {
      inserted: true,
      contact_id: "contato-1",
      contact_created: false,
      conversation_id: "conversa-1",
      message_id: "mensagem-1",
      whatsapp_account_id: numero,
      ...extra,
    },
    error: null,
  };
}

function urlNova(numero: string, segredo: string, clinica = CLINICA): string {
  return `clinic=${clinica}&account=${numero}&secret=${segredo}`;
}

function urlLegada(segredo: string, clinica = CLINICA): string {
  return `clinic=${clinica}&secret=${segredo}`;
}

function consultasDe(tabela: string, operacao: Consulta["operacao"]) {
  return consultas.filter(
    (c) => c.tabela === tabela && c.operacao === operacao,
  );
}

beforeEach(() => {
  contas = [
    {
      id: NUMERO_A,
      clinic_id: CLINICA,
      removido_em: null,
      provider: "fake",
      connection_status: "conectado",
    },
    {
      id: NUMERO_B,
      clinic_id: CLINICA,
      removido_em: null,
      provider: "fake",
      connection_status: "conectado",
    },
    {
      id: NUMERO_REMOVIDO,
      clinic_id: CLINICA,
      removido_em: "2026-09-25T10:00:00.000Z",
      provider: "fake",
      connection_status: "desconectado",
    },
  ];
  segredos = [
    {
      account_id: NUMERO_A,
      clinic_id: CLINICA,
      webhook_secret: "segredo-a",
      instance_token: null,
    },
    {
      account_id: NUMERO_B,
      clinic_id: CLINICA,
      webhook_secret: "segredo-b",
      instance_token: null,
    },
    {
      account_id: NUMERO_REMOVIDO,
      clinic_id: CLINICA,
      webhook_secret: "segredo-removido",
      instance_token: null,
    },
  ];
  falharLeitura = false;
  consultas.length = 0;
  rpc.mockReset();
  ingerir.mockReset();
  interceptar.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/whatsapp: qual numero chama", () => {
  it("URL nova com o segredo do numero: ingere pelo numero", async () => {
    ingerir.mockResolvedValue(ingestInserida(NUMERO_B));
    const info = vi.spyOn(log, "info");

    const resposta = await POST(
      pedido(urlNova(NUMERO_B, "segredo-b"), RECEBIDA),
    );

    expect(resposta.status).toBe(200);
    expect(ingerir).toHaveBeenCalledTimes(1);
    expect(ingerir.mock.calls[0]![1]).toBe(CLINICA);
    expect(ingerir.mock.calls[0]![2]).toBe(NUMERO_B);
    expect(info).not.toHaveBeenCalledWith(
      "webhook_url_legada",
      expect.anything(),
    );
  });

  it("URL nova sem clinica: a clinica vem do numero", async () => {
    ingerir.mockResolvedValue(ingestInserida(NUMERO_A));
    const resposta = await POST(
      pedido(`account=${NUMERO_A}&secret=segredo-a`, RECEBIDA),
    );
    expect(resposta.status).toBe(200);
    expect(ingerir.mock.calls[0]![1]).toBe(CLINICA);
    expect(ingerir.mock.calls[0]![2]).toBe(NUMERO_A);
  });

  it("URL nova com o segredo de OUTRO numero da clinica: 401", async () => {
    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-b"), RECEBIDA),
    );
    expect(resposta.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("URL nova com clinica que nao e a do numero: 401", async () => {
    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a", OUTRA_CLINICA), RECEBIDA),
    );
    expect(resposta.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("URL nova de numero removido: 401 mesmo com o segredo certo", async () => {
    const resposta = await POST(
      pedido(urlNova(NUMERO_REMOVIDO, "segredo-removido"), RECEBIDA),
    );
    expect(resposta.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("URL legada acha o numero pelo segredo e deixa rastro", async () => {
    ingerir.mockResolvedValue(ingestInserida(NUMERO_B));
    const info = vi.spyOn(log, "info");

    const resposta = await POST(pedido(urlLegada("segredo-b"), RECEBIDA));

    expect(resposta.status).toBe(200);
    expect(ingerir.mock.calls[0]![2]).toBe(NUMERO_B);
    expect(info).toHaveBeenCalledWith("webhook_url_legada", {
      clinic_id: CLINICA,
      whatsapp_account_id: NUMERO_B,
    });
    // A lista da clinica e lida so entre os numeros ativos.
    const leituraDeContas = consultasDe("whatsapp_account", "select")[0]!;
    expect(leituraDeContas.valorDe("is", "removido_em")).toBeNull();
  });

  it("numero conectado: a porta da trava nao custa leitura a mais, nas duas URLs", async () => {
    ingerir.mockResolvedValue(ingestInserida(NUMERO_A));

    await POST(pedido(urlNova(NUMERO_A, "segredo-a"), RECEBIDA));
    await POST(pedido(urlLegada("segredo-a"), RECEBIDA));

    expect(ingerir).toHaveBeenCalledTimes(2);
    // So a leitura da resolucao, uma por pedido: provedor e situacao vem nela.
    expect(consultasDe("whatsapp_account", "select")).toHaveLength(2);
    expect(consultasDe("whatsapp_account", "update")).toHaveLength(0);
  });

  it("URL legada com o segredo de numero removido: 401", async () => {
    const resposta = await POST(
      pedido(urlLegada("segredo-removido"), RECEBIDA),
    );
    expect(resposta.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("URL legada com segredo que nao e de ninguem: 401", async () => {
    const resposta = await POST(pedido(urlLegada("chute"), RECEBIDA));
    expect(resposta.status).toBe(401);
  });

  it("falha de leitura do banco vira 500 (o provedor reenvia), nao 401", async () => {
    falharLeitura = true;
    const resposta = await POST(pedido(urlLegada("segredo-a"), RECEBIDA));
    expect(resposta.status).toBe(500);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("o token conferido e o da instancia DAQUELE numero", async () => {
    segredos = segredos.map((s) => ({
      ...s,
      instance_token: s.account_id === NUMERO_A ? "tok-a" : "tok-b",
    }));
    ingerir.mockResolvedValue(ingestInserida(NUMERO_A));
    const doUazapi = (token: string) => ({
      EventType: "messages",
      token,
      message: {
        messageid: "wa-uaz-1",
        chatid: "5584970000001@s.whatsapp.net",
        sender_pn: "5584970000001@s.whatsapp.net",
        senderName: "Paula",
        fromMe: false,
        type: "text",
        messageType: "ExtendedTextMessage",
        text: "Bom dia",
      },
    });

    const comTokenDoB = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), doUazapi("tok-b")),
    );
    expect(comTokenDoB.status).toBe(401);
    expect(ingerir).not.toHaveBeenCalled();

    const comTokenDoA = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), doUazapi("tok-a")),
    );
    expect(comTokenDoA.status).toBe(200);
    expect(ingerir.mock.calls[0]![2]).toBe(NUMERO_A);
  });
});

describe("POST /api/webhooks/whatsapp: tudo filtrado pelo numero", () => {
  it("mensagem ignorada (numero proprio) responde 200 sem midia nem interceptar", async () => {
    ingerir.mockResolvedValue({
      data: {
        inserted: false,
        ignorada: "numero_proprio",
        contact_id: null,
        contact_created: false,
        conversation_id: null,
        message_id: null,
        whatsapp_account_id: NUMERO_A,
      },
      error: null,
    });
    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), {
        ...RECEBIDA,
        contentType: "imagem",
      }),
    );
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).ignorada).toBe("numero_proprio");
    expect(consultasDe("job_queue", "insert")).toHaveLength(0);
    expect(interceptar).not.toHaveBeenCalled();
  });

  it("job de midia leva o numero na coluna e no payload", async () => {
    ingerir.mockResolvedValue(ingestInserida(NUMERO_B));
    await POST(
      pedido(urlNova(NUMERO_B, "segredo-b"), {
        ...RECEBIDA,
        contentType: "imagem",
      }),
    );
    const [job] = consultasDe("job_queue", "insert");
    expect(job!.valores).toMatchObject({
      clinic_id: CLINICA,
      kind: "baixar_midia",
      whatsapp_account_id: NUMERO_B,
      payload: {
        message_id: "mensagem-1",
        wa_message_id: "wa-1",
        whatsapp_account_id: NUMERO_B,
      },
    });
  });

  it("eco do celular so derruba a espera das conversas daquele numero", async () => {
    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), {
        EventType: "messages",
        message: {
          messageid: "wa-eco-1",
          chatid: "5584970000001@s.whatsapp.net",
          sender_pn: "5584970000001@s.whatsapp.net",
          fromMe: true,
          type: "text",
          messageType: "ExtendedTextMessage",
          text: "Respondido pelo celular",
        },
      }),
    );
    expect(resposta.status).toBe(200);
    const [update] = consultasDe("conversation", "update");
    expect(update!.valores).toEqual({ awaiting_reply: false });
    expect(update!.valorDe("eq", "whatsapp_account_id")).toBe(NUMERO_A);
    expect(update!.valorDe("eq", "clinic_id")).toBe(CLINICA);
  });

  it("recibo so marca as mensagens daquele numero", async () => {
    await POST(
      pedido(urlNova(NUMERO_B, "segredo-b"), {
        kind: "message_status",
        waMessageId: "wa-9",
        status: "lida",
      }),
    );
    const [update] = consultasDe("message", "update");
    expect(update!.valorDe("eq", "whatsapp_account_id")).toBe(NUMERO_B);
    expect(update!.valorDe("in", "wa_message_id")).toEqual(["wa-9"]);
  });

  it("apagamento chama a RPC com o numero", async () => {
    rpc.mockResolvedValue({ data: { ok: true, media_url: null }, error: null });
    const resposta = await POST(
      pedido(urlLegada("segredo-a"), {
        kind: "message_deleted",
        waMessageId: "wa-7",
      }),
    );
    expect(resposta.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("registrar_apagamento_do_whatsapp", {
      p_clinic_id: CLINICA,
      p_wa_message_id: "wa-7",
      p_whatsapp_account_id: NUMERO_A,
    });
  });

  it("status de conexao e gravado pelo id do numero, nunca pela clinica toda", async () => {
    const resposta = await POST(
      pedido(urlNova(NUMERO_B, "segredo-b"), {
        kind: "connection_update",
        status: "conectado",
      }),
    );
    expect(resposta.status).toBe(200);
    const [update] = consultasDe("whatsapp_account", "update");
    expect(update!.valorDe("eq", "id")).toBe(NUMERO_B);
    expect(update!.valorDe("is", "removido_em")).toBeNull();
    expect(update!.valorDe("neq", "connection_status")).toBe("conectado");
    expect(update!.valores).toMatchObject({ connection_status: "conectado" });
  });

  it("'conectando' no pareamento só substitui 'aguardando_qr', e o filtro vive no update (T[0])", async () => {
    contas = contas.map((c) =>
      c.id === NUMERO_B ? { ...c, connection_status: "aguardando_qr" } : c,
    );

    const resposta = await POST(
      pedido(urlNova(NUMERO_B, "segredo-b"), {
        kind: "connection_update",
        status: "conectando",
      }),
    );

    expect(resposta.status).toBe(200);
    const [update] = consultasDe("whatsapp_account", "update");
    // Um "connecting" atrasado, que chega depois do "connected", acha o
    // numero ja conectado e nao o rebaixa.
    expect(update!.valorDe("eq", "connection_status")).toBe("aguardando_qr");
    expect(update!.valorDe("neq", "connection_status")).toBe("conectando");
    expect(update!.valores).toMatchObject({ connection_status: "conectando" });
  });

  it("'conectando' com o número conectado: nada é gravado (T[0])", async () => {
    const resposta = await POST(
      pedido(urlNova(NUMERO_B, "segredo-b"), {
        kind: "connection_update",
        status: "conectando",
      }),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true, gravado: false });
    expect(consultasDe("whatsapp_account", "update")).toHaveLength(0);
  });
});

describe("POST /api/webhooks/whatsapp: configuração da rota", () => {
  it("roda em Node com teto de 60 s declarado, como o motor (T[1])", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });
});
