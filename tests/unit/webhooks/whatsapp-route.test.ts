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
//     mensagem enviada pelo celular, recibo, apagamento e status de conexao;
//   - a mensagem enviada pelo celular da clinica passa pela porta da trava e
//     vira linha pela RPC registrar_mensagem_do_celular (a de verdade, de
//     ingest.ts, com o rpc do banco dublado), e o log nunca leva texto;
//   - o eco que a RPC ignora por ser de numero da plataforma ou colisao de id
//     ainda roda o termo-chave com o contato devolvido; sem contato, nao;
//   - a saudacao para paciente novo (eco recente de contato desconhecido)
//     tenta de novo ate 2 vezes, com a espera dublada (lib/utils/esperar);
//   - a mensagem do paciente leva o horario de envio ate a correcao da
//     resposta automatica (p_enviada_em).

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
const conferir = vi.fn();
const mover = vi.fn();
// A espera da nova tentativa (saudacao para paciente novo), sem esperar.
const esperar = vi.fn<(ms: number) => Promise<void>>();

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
// A ingestao do paciente e dublada; a gravacao da mensagem do celular e a
// DE VERDADE, para provar os parametros que chegam a RPC.
vi.mock("@/lib/integrations/whatsapp/ingest", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/integrations/whatsapp/ingest")
  >()),
  ingerirMensagemRecebida: ingerir,
}));
vi.mock("@/lib/integrations/whatsapp/interceptar-resposta", () => ({
  interceptarRespostaDePaciente: interceptar,
}));
vi.mock("@/lib/integrations/whatsapp/trava-celular", () => ({
  conferirConexaoDoWebhook: conferir,
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: mover,
}));
vi.mock("@/lib/utils/esperar", () => ({ esperar }));

const { POST, maxDuration, runtime } =
  await import("@/app/api/webhooks/whatsapp/route");
// A trava de verdade continua valendo onde o teste nao a troca (o evento de
// conexao do numero do simulador confirma sem consultar provedor nenhum).
const travaDeVerdade = await vi.importActual<
  typeof import("@/lib/integrations/whatsapp/trava-celular")
>("@/lib/integrations/whatsapp/trava-celular");
// A ingestao de verdade, para os casos que provam a ordem com o
// interceptador: a correcao da resposta automatica roda antes dele.
const ingestDeVerdade = await vi.importActual<
  typeof import("@/lib/integrations/whatsapp/ingest")
>("@/lib/integrations/whatsapp/ingest");

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

/** Mensagem que a clinica mandou pelo celular pareado, no formato uazapi. */
function doCelular(campos: Record<string, unknown> = {}) {
  return {
    EventType: "messages",
    message: {
      messageid: "wa-cel-1",
      chatid: "5584970000001@s.whatsapp.net",
      // De saida, o sender_pn e o numero da PROPRIA clinica.
      sender_pn: "5584911112222@s.whatsapp.net",
      fromMe: true,
      type: "text",
      messageType: "ExtendedTextMessage",
      text: "Pode vir às 15h, Dona Rita",
      ...campos,
    },
  };
}

function registroDoCelular(
  numero: string,
  extra: Record<string, unknown> = {},
): Resultado {
  return {
    data: {
      inserted: true,
      contact_id: "contato-da-rpc",
      conversation_id: "conversa-cel-1",
      message_id: "mensagem-cel-1",
      whatsapp_account_id: numero,
      automatica: false,
      ...extra,
    },
    error: null,
  };
}

/** O banco responde a RPC da gravacao com `registro`; as outras, vazio. */
function rpcDoCelular(
  registro: Resultado,
  outras: Record<string, Resultado> = {},
): void {
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "registrar_mensagem_do_celular") {
      return registro;
    }
    return outras[nome] ?? { data: null, error: null };
  });
}

function chamadasDaRpc(nome: string): unknown[] {
  return rpc.mock.calls.filter(([n]) => n === nome).map(([, args]) => args);
}

/** Tudo o que foi para stdout e stderr (o log estruturado) neste teste. */
function capturarLog(): string[] {
  const saida: string[] = [];
  const capturar = (pedaco: string | Uint8Array): boolean => {
    saida.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
  return saida;
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
  conferir.mockReset();
  conferir.mockImplementation(travaDeVerdade.conferirConexaoDoWebhook);
  mover.mockReset();
  mover.mockResolvedValue(null);
  esperar.mockReset();
  esperar.mockResolvedValue(undefined);
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

  it("mensagem do celular é gravada pela RPC do número que chamou, sem update direto na conversa", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_A));
    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), doCelular()),
    );
    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toEqual([
      expect.objectContaining({
        p_clinic_id: CLINICA,
        p_whatsapp_account_id: NUMERO_A,
      }),
    ]);
    // A espera desce DENTRO da RPC, na mesma transacao da gravacao.
    expect(consultasDe("conversation", "update")).toHaveLength(0);
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

describe("POST /api/webhooks/whatsapp: mensagem enviada pelo celular da clínica", () => {
  it("chama a RPC com o número da URL e o conteúdo do evento, e vincula a citação", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_B));
    const enviadaEm = Date.UTC(2026, 9, 5, 12, 0, 0);

    const resposta = await POST(
      pedido(
        urlNova(NUMERO_B, "segredo-b"),
        doCelular({ quoted: "WA-DO-PACIENTE", messageTimestamp: enviadaEm }),
      ),
    );

    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_whatsapp_account_id: NUMERO_B,
        p_phone_e164: "+5584970000001",
        p_wa_message_id: "wa-cel-1",
        p_content_type: "texto",
        p_body: "Pode vir às 15h, Dona Rita",
        p_media_url: null,
        p_media_filename: null,
        p_media_mimetype: null,
        p_quoted_wa_message_id: "WA-DO-PACIENTE",
        p_enviada_em: new Date(enviadaEm).toISOString(),
      },
    ]);
    expect(chamadasDaRpc("vincular_citacao_recebida")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_message_id: "mensagem-cel-1",
        p_quoted_wa_id: "WA-DO-PACIENTE",
      },
    ]);
    // O contato e a conversa sao da RPC: a rota nao procura nada por fora.
    expect(consultasDe("contact", "select")).toHaveLength(0);
    expect(consultasDe("conversation", "update")).toHaveLength(0);
    expect(await resposta.json()).toMatchObject({
      inserted: true,
      message_id: "mensagem-cel-1",
    });
  });

  it("URL legada: grava pelo número que o segredo achou", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_A));
    await POST(pedido(urlLegada("segredo-a"), doCelular()));
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toEqual([
      expect.objectContaining({ p_whatsapp_account_id: NUMERO_A }),
    ]);
  });

  it("reentrega (inserted=false) não vincula a citação de novo", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_A, { inserted: false }));
    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), doCelular({ quoted: "WA-Q" })),
    );
    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("vincular_citacao_recebida")).toHaveLength(0);
  });

  it("erro da RPC: 500 para o provedor reenviar, e o log leva só ids e código", async () => {
    const saida = capturarLog();
    rpcDoCelular({ data: null, error: { code: "23503" } });

    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), doCelular()),
    );

    expect(resposta.status).toBe(500);
    const tudo = saida.join("");
    expect(tudo).toContain("webhook_mensagem_do_celular_falhou");
    expect(tudo).toContain('"error_code":"23503"');
    expect(tudo).toContain('"wa_message_id":"wa-cel-1"');
    expect(tudo).toContain(`"whatsapp_account_id":"${NUMERO_A}"`);
    expect(tudo).not.toContain("Dona Rita");
    expect(tudo).not.toContain("15h");
    expect(tudo).not.toContain("84970000001");
  });

  it.each([
    "contato_desconhecido",
    "numero_proprio",
    "numero_da_plataforma",
    "numero_removido",
    "colisao_wa_message_id",
  ])(
    "ignorada (%s): 200, sem mídia, sem citação e sem termo",
    async (motivo) => {
      const saida = capturarLog();
      rpcDoCelular({
        data: {
          inserted: false,
          ignorada: motivo,
          contact_id: null,
          conversation_id: null,
          message_id: null,
          whatsapp_account_id: NUMERO_A,
          automatica: null,
        },
        error: null,
      });

      const resposta = await POST(
        pedido(
          urlNova(NUMERO_A, "segredo-a"),
          doCelular({
            messageType: "ImageMessage",
            mediaType: "image",
            quoted: "WA-Q",
            messageTimestamp: Date.now(),
            content: { URL: "https://mmg.whatsapp.net/x.enc" },
          }),
        ),
      );

      expect(resposta.status).toBe(200);
      expect((await resposta.json()).ignorada).toBe(motivo);
      expect(consultasDe("job_queue", "insert")).toHaveLength(0);
      expect(chamadasDaRpc("vincular_citacao_recebida")).toHaveLength(0);
      expect(chamadasDaRpc("marcar_eco_para_termo")).toHaveLength(0);
      expect(mover).not.toHaveBeenCalled();
      const tudo = saida.join("");
      expect(tudo).toContain("webhook_mensagem_ignorada");
      expect(tudo).toContain(`"status":"${motivo}"`);
      expect(tudo).not.toContain("Dona Rita");
    },
  );

  it("mídia inserida enfileira baixar_midia com o número na coluna e no payload", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_B));
    await POST(
      pedido(
        urlNova(NUMERO_B, "segredo-b"),
        doCelular({
          type: "media",
          messageType: "AudioMessage",
          mediaType: "ptt",
          text: undefined,
          content: { mimetype: "audio/ogg; codecs=opus" },
        }),
      ),
    );
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toEqual([
      expect.objectContaining({
        p_content_type: "audio",
        p_body: null,
        p_media_mimetype: "audio/ogg",
      }),
    ]);
    const jobs = consultasDe("job_queue", "insert");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.valores).toEqual({
      clinic_id: CLINICA,
      kind: "baixar_midia",
      whatsapp_account_id: NUMERO_B,
      payload: {
        message_id: "mensagem-cel-1",
        wa_message_id: "wa-cel-1",
        whatsapp_account_id: NUMERO_B,
      },
    });
  });

  it.each([
    ["fixar", { messageType: "PinInChatMessage", text: undefined }],
    ["voto em enquete", { messageType: "PollUpdateMessage", text: undefined }],
    ["ligação", { messageType: "call", text: undefined }],
    ["texto vazio sem arquivo", { messageType: "Conversation", text: "" }],
  ])(
    "ação no celular que não é mensagem (%s): 200 ignorado, sem gravar nem mexer na espera",
    async (_nome, campos) => {
      const resposta = await POST(
        pedido(urlNova(NUMERO_A, "segredo-a"), doCelular(campos)),
      );
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ ignored: true });
      expect(rpc).not.toHaveBeenCalled();
      expect(consultasDe("conversation", "update")).toHaveLength(0);
    },
  );

  it("mídia reentregue (inserted=false) ou texto sem arquivo não enfileiram", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_A, { inserted: false }));
    await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageType: "ImageMessage", mediaType: "image" }),
      ),
    );
    rpcDoCelular(registroDoCelular(NUMERO_A));
    await POST(pedido(urlNova(NUMERO_A, "segredo-a"), doCelular()));
    expect(consultasDe("job_queue", "insert")).toHaveLength(0);
  });

  describe("porta da trava (o mesmo celular em duas instâncias)", () => {
    beforeEach(() => {
      contas = contas.map((c) =>
        c.id === NUMERO_A
          ? { ...c, provider: "uazapi", connection_status: "aguardando_qr" }
          : c,
      );
    });

    it("pareamento sem decisão: 503 e nada é gravado", async () => {
      conferir.mockResolvedValue({ resultado: "sem_confirmacao" });
      const resposta = await POST(
        pedido(urlNova(NUMERO_A, "segredo-a"), doCelular()),
      );
      expect(resposta.status).toBe(503);
      expect(conferir).toHaveBeenCalledTimes(1);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("celular de outra clínica: 200 sem gravar", async () => {
      conferir.mockResolvedValue({ resultado: "recusada" });
      const resposta = await POST(
        pedido(urlNova(NUMERO_A, "segredo-a"), doCelular()),
      );
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toEqual({ ignorada: "celular_recusado" });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("pareamento confirmado: grava conectado e a mensagem entra", async () => {
      conferir.mockResolvedValue({
        resultado: "confirmada",
        displayPhone: "+5584911112222",
      });
      rpcDoCelular(registroDoCelular(NUMERO_A));
      const resposta = await POST(
        pedido(urlNova(NUMERO_A, "segredo-a"), doCelular()),
      );
      expect(resposta.status).toBe(200);
      expect(consultasDe("whatsapp_account", "update")).toHaveLength(1);
      expect(chamadasDaRpc("registrar_mensagem_do_celular")).toHaveLength(1);
    });
  });

  it("termo-chave usa o contato devolvido pela RPC", async () => {
    rpcDoCelular(registroDoCelular(NUMERO_A), {
      marcar_eco_para_termo: { data: true, error: null },
    });
    const resposta = await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 2_000 }),
      ),
    );
    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("marcar_eco_para_termo")).toEqual([
      { p_clinic_id: CLINICA, p_wa_message_id: "wa-cel-1" },
    ]);
    expect(mover).toHaveBeenCalledTimes(1);
    expect(mover.mock.calls[0]![1]).toEqual({
      clinicId: CLINICA,
      contactId: "contato-da-rpc",
      corpo: "Pode vir às 15h, Dona Rita",
      quemEscreveu: "clinica",
      userId: null,
    });
  });

  it("marcador de envio automático vai para o log com o que a RPC decidiu, nunca com texto", async () => {
    const saida = capturarLog();
    rpcDoCelular(registroDoCelular(NUMERO_A, { automatica: true }));
    await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({
          text: "Olá! Estamos fora do horário, Dona Rita.",
          content: { contextInfo: { isAutomated: true } },
        }),
      ),
    );
    const linha = saida.find((l) =>
      l.includes("whatsapp_eco_do_celular_com_marcador"),
    );
    expect(linha).toBeDefined();
    expect(JSON.parse(linha!)).toMatchObject({
      clinic_id: CLINICA,
      whatsapp_account_id: NUMERO_A,
      wa_message_id: "wa-cel-1",
      message_id: "mensagem-cel-1",
      path: "content.contextInfo.isAutomated=true",
      count: 1,
      kind: "automatica",
    });
    const tudo = saida.join("");
    expect(tudo).not.toContain("fora do horário");
    expect(tudo).not.toContain("Dona Rita");
  });
});

// A mensagem do PACIENTE pela ingestao de verdade (rpc do banco dublado): a
// resposta automatica do app Business que gravou antes dela como fala de
// pessoa e corrigida ANTES do interceptador, senao ele calaria a confirmacao
// do toque. A correcao e melhor esforco: nunca derruba o 200.
describe("POST /api/webhooks/whatsapp: mensagem do paciente com a ingestão de verdade", () => {
  /** O banco responde a ingestao e a correcao; as outras RPCs, vazio. */
  function rpcDaIngestao(
    correcao: Resultado | Error,
    ingestao: Resultado = ingestInserida(NUMERO_A),
  ): void {
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "ingest_inbound_message") {
        return ingestao;
      }
      if (nome === "reclassificar_resposta_automatica") {
        if (correcao instanceof Error) {
          throw correcao;
        }
        return correcao;
      }
      return { data: null, error: null };
    });
  }

  function ordemDaCorrecao(): number | undefined {
    const indice = rpc.mock.calls.findIndex(
      ([nome]) => nome === "reclassificar_resposta_automatica",
    );
    return indice < 0 ? undefined : rpc.mock.invocationCallOrder[indice];
  }

  beforeEach(() => {
    ingerir.mockImplementation(ingestDeVerdade.ingerirMensagemRecebida);
    interceptar.mockResolvedValue(null);
  });

  it("a resposta automática que gravou antes é corrigida ANTES do interceptador", async () => {
    rpcDaIngestao({ data: 1, error: null });

    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), RECEBIDA),
    );

    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("reclassificar_resposta_automatica")).toEqual([
      { p_clinic_id: CLINICA, p_message_id: "mensagem-1", p_enviada_em: null },
    ]);
    expect(interceptar).toHaveBeenCalledTimes(1);
    expect(ordemDaCorrecao()).toBeLessThan(
      interceptar.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["erro", { data: null, error: { code: "PGRST202" } }],
    ["exceção", new Error("Bom dia")],
  ] as [string, Resultado | Error][])(
    "%s da correção não derruba: 200, o interceptador roda e o log leva só ids",
    async (_nome, correcao) => {
      const saida = capturarLog();
      rpcDaIngestao(correcao);

      const resposta = await POST(
        pedido(urlNova(NUMERO_A, "segredo-a"), RECEBIDA),
      );

      expect(resposta.status).toBe(200);
      expect(interceptar).toHaveBeenCalledTimes(1);
      const tudo = saida.join("");
      expect(tudo).toContain("reclassificar_automatica_falhou");
      expect(tudo).toContain('"message_id":"mensagem-1"');
      expect(tudo).not.toContain("Bom dia");
      expect(tudo).not.toContain("84970000001");
    },
  );

  it("a correção leva o horário de envio do payload do paciente", async () => {
    rpcDaIngestao({ data: 0, error: null });
    const enviadaEm = Date.UTC(2026, 9, 5, 12, 0, 0);

    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), {
        EventType: "messages",
        message: {
          messageid: "wa-pac-1",
          chatid: "5584970000001@s.whatsapp.net",
          sender_pn: "5584970000001@s.whatsapp.net",
          fromMe: false,
          type: "text",
          messageType: "Conversation",
          text: "Bom dia",
          // whatsmeow cru: segundos.
          messageTimestamp: enviadaEm / 1000,
        },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("reclassificar_resposta_automatica")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_message_id: "mensagem-1",
        p_enviada_em: new Date(enviadaEm).toISOString(),
      },
    ]);
  });

  it("reentrega (inserted=false) não corrige nem intercepta", async () => {
    rpcDaIngestao(
      { data: 1, error: null },
      ingestInserida(NUMERO_A, { inserted: false }),
    );

    const resposta = await POST(
      pedido(urlNova(NUMERO_A, "segredo-a"), RECEBIDA),
    );

    expect(resposta.status).toBe(200);
    expect(chamadasDaRpc("reclassificar_resposta_automatica")).toHaveLength(0);
    expect(interceptar).not.toHaveBeenCalled();
  });
});

/** A RPC devolve um registro por chamada, na ordem; o ultimo se repete. */
function rpcDoCelularEmSequencia(
  registros: Resultado[],
  outras: Record<string, Resultado> = {},
): void {
  const fila = [...registros];
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "registrar_mensagem_do_celular") {
      return fila.length > 1 ? fila.shift()! : fila[0]!;
    }
    return outras[nome] ?? { data: null, error: null };
  });
}

function ignoradaDoCelular(
  motivo: string,
  contato: string | null = null,
): Resultado {
  return {
    data: {
      inserted: false,
      ignorada: motivo,
      contact_id: contato,
      conversation_id: null,
      message_id: null,
      whatsapp_account_id: NUMERO_A,
      automatica: null,
    },
    error: null,
  };
}

// O eco que nao vira linha porque o wa_message_id e de outra clinica (destino
// e numero de outra clinica da plataforma, ou colisao do id) continua sendo a
// equipe respondendo pelo celular: a RPC ja derrubou a espera e devolve o
// contato, e o termo-chave roda como rodava antes da mensagem virar linha.
describe("POST /api/webhooks/whatsapp: eco ignorado com contato segue para o termo-chave", () => {
  it.each(["numero_da_plataforma", "colisao_wa_message_id"])(
    "%s com contato: marca o eco e move como clínica, sem mídia nem citação; 200 com a ignorada",
    async (motivo) => {
      const saida = capturarLog();
      rpcDoCelular(ignoradaDoCelular(motivo, "contato-desta-clinica"), {
        marcar_eco_para_termo: { data: true, error: null },
      });

      const resposta = await POST(
        pedido(
          urlNova(NUMERO_A, "segredo-a"),
          doCelular({
            messageType: "ImageMessage",
            mediaType: "image",
            quoted: "WA-Q",
            messageTimestamp: Date.now() - 2_000,
            content: {
              URL: "https://mmg.whatsapp.net/x.enc",
              contextInfo: { isAutomated: true },
            },
          }),
        ),
      );

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({
        ignorada: motivo,
        contact_id: "contato-desta-clinica",
      });
      expect(chamadasDaRpc("marcar_eco_para_termo")).toEqual([
        { p_clinic_id: CLINICA, p_wa_message_id: "wa-cel-1" },
      ]);
      expect(mover).toHaveBeenCalledTimes(1);
      expect(mover.mock.calls[0]![1]).toEqual({
        clinicId: CLINICA,
        contactId: "contato-desta-clinica",
        corpo: "Pode vir às 15h, Dona Rita",
        quemEscreveu: "clinica",
        userId: null,
      });
      // Sem linha: nada de midia, citacao, marcador nem nova tentativa.
      expect(consultasDe("job_queue", "insert")).toHaveLength(0);
      expect(chamadasDaRpc("vincular_citacao_recebida")).toHaveLength(0);
      expect(chamadasDaRpc("registrar_mensagem_do_celular")).toHaveLength(1);
      expect(esperar).not.toHaveBeenCalled();
      const tudo = saida.join("");
      expect(tudo).toContain("webhook_mensagem_ignorada");
      expect(tudo).toContain(`"status":"${motivo}"`);
      expect(tudo).not.toContain("whatsapp_eco_do_celular_com_marcador");
      expect(tudo).not.toContain("Dona Rita");
      expect(tudo).not.toContain("15h");
    },
  );

  it.each(["numero_da_plataforma", "colisao_wa_message_id"])(
    "%s sem contato (o destino não está no sistema): não marca nem move",
    async (motivo) => {
      rpcDoCelular(ignoradaDoCelular(motivo), {
        marcar_eco_para_termo: { data: true, error: null },
      });
      const resposta = await POST(
        pedido(
          urlNova(NUMERO_A, "segredo-a"),
          doCelular({ messageTimestamp: Date.now() - 2_000 }),
        ),
      );
      expect(resposta.status).toBe(200);
      expect(chamadasDaRpc("marcar_eco_para_termo")).toHaveLength(0);
      expect(mover).not.toHaveBeenCalled();
    },
  );

  it.each(["numero_proprio", "numero_removido", "contato_desconhecido"])(
    "%s nunca move, mesmo se viesse com contato (fora do contrato)",
    async (motivo) => {
      rpcDoCelular(ignoradaDoCelular(motivo, "contato-inesperado"), {
        marcar_eco_para_termo: { data: true, error: null },
      });
      const resposta = await POST(
        pedido(
          urlNova(NUMERO_A, "segredo-a"),
          doCelular({ messageTimestamp: Date.now() - 2_000 }),
        ),
      );
      expect(resposta.status).toBe(200);
      expect(chamadasDaRpc("marcar_eco_para_termo")).toHaveLength(0);
      expect(mover).not.toHaveBeenCalled();
    },
  );

  it("a regra do termo vale igual: eco velho com contato não move nem vai ao banco", async () => {
    rpcDoCelular(ignoradaDoCelular("numero_da_plataforma", "contato-1"), {
      marcar_eco_para_termo: { data: true, error: null },
    });
    await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 10 * 60 * 1000 }),
      ),
    );
    expect(chamadasDaRpc("marcar_eco_para_termo")).toHaveLength(0);
    expect(mover).not.toHaveBeenCalled();
  });
});

// SAUDACAO PARA PACIENTE NOVO: o app Business responde sozinho justamente ao
// contato novo, e o eco pode chegar antes de a ingestao criar o contato. O
// eco recente de contato desconhecido espera 1,5 s e tenta de novo, ate 2
// vezes. Sem horario, eco velho ou outra ignorada: nenhuma nova tentativa.
describe("POST /api/webhooks/whatsapp: saudação para paciente novo (eco antes do contato)", () => {
  const DESCONHECIDO = ignoradaDoCelular("contato_desconhecido");

  /** Ordem de chamada das RPCs de gravacao e das esperas, misturadas. */
  function linhaDoTempo(): string[] {
    const eventos: [number, string][] = [
      ...rpc.mock.calls.flatMap(([nome], i) =>
        nome === "registrar_mensagem_do_celular"
          ? [
              [rpc.mock.invocationCallOrder[i]!, "registrar"] as [
                number,
                string,
              ],
            ]
          : [],
      ),
      ...esperar.mock.calls.map(
        ([ms], i) =>
          [esperar.mock.invocationCallOrder[i]!, `esperar ${ms}`] as [
            number,
            string,
          ],
      ),
    ];
    return eventos.sort(([a], [b]) => a - b).map(([, nome]) => nome);
  }

  it("eco recente de contato desconhecido: espera 1,5 s e tenta mais 2 vezes; depois, 200 como antes", async () => {
    const saida = capturarLog();
    rpcDoCelularEmSequencia([DESCONHECIDO]);

    const resposta = await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 2_000 }),
      ),
    );

    expect(resposta.status).toBe(200);
    expect((await resposta.json()).ignorada).toBe("contato_desconhecido");
    expect(linhaDoTempo()).toEqual([
      "registrar",
      "esperar 1500",
      "registrar",
      "esperar 1500",
      "registrar",
    ]);
    // As tres chamadas sao a mesma gravacao (idempotente por wa_message_id).
    const chamadas = chamadasDaRpc("registrar_mensagem_do_celular");
    expect(chamadas[1]).toEqual(chamadas[0]);
    expect(chamadas[2]).toEqual(chamadas[0]);
    expect(chamadasDaRpc("marcar_eco_para_termo")).toHaveLength(0);
    expect(mover).not.toHaveBeenCalled();
    const linha = saida.find((l) =>
      l.includes("webhook_eco_esperou_contato_novo"),
    );
    expect(JSON.parse(linha!)).toMatchObject({
      clinic_id: CLINICA,
      whatsapp_account_id: NUMERO_A,
      wa_message_id: "wa-cel-1",
      attempt: 2,
      status: "contato_desconhecido",
    });
    const tudo = saida.join("");
    expect(tudo).toContain('"status":"contato_desconhecido"');
    expect(tudo).not.toContain("Dona Rita");
    expect(tudo).not.toContain("15h");
    expect(tudo).not.toContain("84970000001");
  });

  it("para quando a segunda chamada grava: segue com mídia e termo, com o contato que nasceu", async () => {
    const saida = capturarLog();
    rpcDoCelularEmSequencia(
      [
        DESCONHECIDO,
        registroDoCelular(NUMERO_A, {
          contact_id: "contato-novo",
          automatica: true,
        }),
      ],
      { marcar_eco_para_termo: { data: true, error: null } },
    );

    const resposta = await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({
          messageType: "ImageMessage",
          mediaType: "image",
          messageTimestamp: Date.now() - 2_000,
          content: { URL: "https://mmg.whatsapp.net/x.enc" },
        }),
      ),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({
      inserted: true,
      contact_id: "contato-novo",
    });
    expect(linhaDoTempo()).toEqual(["registrar", "esperar 1500", "registrar"]);
    expect(consultasDe("job_queue", "insert")).toHaveLength(1);
    expect(mover).toHaveBeenCalledTimes(1);
    expect(mover.mock.calls[0]![1]).toMatchObject({
      contactId: "contato-novo",
      quemEscreveu: "clinica",
    });
    const linha = saida.find((l) =>
      l.includes("webhook_eco_esperou_contato_novo"),
    );
    expect(JSON.parse(linha!)).toMatchObject({
      attempt: 1,
      status: "contato_achado",
    });
    expect(saida.join("")).not.toContain("Dona Rita");
  });

  it("erro na nova tentativa: 500 (o provedor reenvia) e o log leva só ids e código", async () => {
    const saida = capturarLog();
    rpcDoCelularEmSequencia([
      DESCONHECIDO,
      { data: null, error: { code: "57014" } },
    ]);

    const resposta = await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 2_000 }),
      ),
    );

    expect(resposta.status).toBe(500);
    expect(linhaDoTempo()).toEqual(["registrar", "esperar 1500", "registrar"]);
    const tudo = saida.join("");
    expect(tudo).toContain("webhook_mensagem_do_celular_falhou");
    expect(tudo).toContain('"error_code":"57014"');
    expect(tudo).not.toContain("webhook_eco_esperou_contato_novo");
    expect(tudo).not.toContain("Dona Rita");
  });

  it.each([
    ["sem horário no payload", () => undefined],
    ["eco velho (mais de 60 s)", () => Date.now() - 61_000],
    ["horário do futuro distante", () => Date.now() + 5 * 60 * 1000],
  ])("%s: nenhuma nova tentativa, 200 na hora", async (_nome, horario) => {
    rpcDoCelularEmSequencia([DESCONHECIDO, registroDoCelular(NUMERO_A)]);

    const resposta = await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: horario() }),
      ),
    );

    expect(resposta.status).toBe(200);
    expect((await resposta.json()).ignorada).toBe("contato_desconhecido");
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toHaveLength(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it.each([
    "numero_proprio",
    "numero_da_plataforma",
    "numero_removido",
    "colisao_wa_message_id",
  ])("outra ignorada (%s): nenhuma nova tentativa", async (motivo) => {
    rpcDoCelularEmSequencia([
      ignoradaDoCelular(motivo),
      registroDoCelular(NUMERO_A),
    ]);
    await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 2_000 }),
      ),
    );
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toHaveLength(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it("gravada de primeira ou erro de primeira: nenhuma espera", async () => {
    rpcDoCelularEmSequencia([registroDoCelular(NUMERO_A)]);
    await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 2_000 }),
      ),
    );
    rpcDoCelularEmSequencia([{ data: null, error: { code: "XX000" } }]);
    const resposta = await POST(
      pedido(
        urlNova(NUMERO_A, "segredo-a"),
        doCelular({ messageTimestamp: Date.now() - 2_000 }),
      ),
    );
    expect(resposta.status).toBe(500);
    expect(chamadasDaRpc("registrar_mensagem_do_celular")).toHaveLength(2);
    expect(esperar).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/whatsapp: configuração da rota", () => {
  it("roda em Node com teto de 60 s declarado, como o motor (T[1])", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });
});
