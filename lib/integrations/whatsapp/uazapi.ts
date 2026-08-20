import type {
  InstanceRef,
  InstanceStatus,
  MenuOption,
  SendResult,
  WhatsAppProvider,
} from "./provider";

// Cliente uazapi (API nao oficial; decisao registrada no CLAUDE.md 3.3).
//
// Escrito contra a especificacao oficial em
// https://docs.uazapi.com/openapi-bundled.json (OpenAPI 3.1, versao 2.1.1).
// A documentacao renderizada e uma aplicacao de pagina unica; a especificacao
// legivel por maquina e o contrato autoritativo.
const PATHS = {
  instanceCreate: "/instance/create", // admintoken
  instanceConnect: "/instance/connect", // token da instancia
  instanceStatus: "/instance/status", // GET, token da instancia
  instanceDisconnect: "/instance/disconnect",
  webhook: "/webhook",
  sendText: "/send/text",
  sendMenu: "/send/menu",
} as const;

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

// Anti-ban: atraso aleatorio entre envios POR INSTANCIA. Suficiente para a
// resposta humana 1:1 desta fase. Disparo em massa (reguas, Fase 4) DEVE
// passar pela job_queue com limite por instancia, NUNCA por aqui: esta fila
// vive em memoria e nao sobrevive a multiplas instancias serverless. A
// especificacao sugere 10 a 30 segundos para disparo em massa.
const sendQueues = new Map<string, Promise<void>>();

type UazapiOptions = {
  /** Faixa do atraso anti-ban em ms; testes injetam valores minimos */
  sendDelayRangeMs?: [number, number];
  fetchFn?: typeof fetch;
};

export class UazapiProvider implements WhatsAppProvider {
  readonly name = "uazapi" as const;
  readonly isOfficialChannel = false;
  private readonly delayRange: [number, number];
  private readonly fetchFn: typeof fetch;

  constructor(options: UazapiOptions = {}) {
    this.delayRange = options.sendDelayRangeMs ?? [1_500, 4_000];
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private baseUrl(ref: InstanceRef): string {
    const url = ref.serverUrl ?? process.env.UAZAPI_SERVER_URL;
    if (!url) {
      throw new Error(
        "UAZAPI_SERVER_URL ausente: configure o servidor uazapi no ambiente.",
      );
    }
    const comProtocolo = /^https?:\/\//.test(url) ? url : `https://${url}`;
    return comProtocolo.replace(/\/$/, "");
  }

  private async request(
    ref: InstanceRef,
    path: string,
    options: {
      method?: "GET" | "POST";
      payload?: Record<string, unknown>;
      tokenKind?: "instance" | "admin";
    } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const { method = "POST", payload, tokenKind = "instance" } = options;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (tokenKind === "admin") {
      const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
      if (!adminToken) {
        throw new Error("UAZAPI_ADMIN_TOKEN ausente no ambiente.");
      }
      headers.admintoken = adminToken;
    } else {
      if (!ref.instanceToken) {
        throw new Error("Instância sem token: conecte o WhatsApp primeiro.");
      }
      headers.token = ref.instanceToken;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = 500 * 2 ** (attempt - 1) + Math.random() * 250;
        await sleep(backoff);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchFn(`${this.baseUrl(ref)}${path}`, {
          method,
          headers,
          body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        // 4xx nao ganha nova tentativa: e erro nosso ou de recurso, repetir
        // nao ajuda. 429 (teto de instancias) tambem nao.
        if (response.status >= 500) {
          lastError = new Error(`uazapi ${response.status}`);
          continue;
        }
        return { status: response.status, body };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Falha de rede ao falar com o uazapi");
  }

  /** Enfileira o envio da instancia com atraso aleatorio (anti-ban). */
  private enqueue<T>(clinicId: string, task: () => Promise<T>): Promise<T> {
    const previous = sendQueues.get(clinicId) ?? Promise.resolve();
    const [min, max] = this.delayRange;
    const run = previous
      .catch(() => undefined)
      .then(() => sleep(min + Math.random() * (max - min)))
      .then(task);
    sendQueues.set(
      clinicId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async sendText(
    ref: InstanceRef,
    to: string,
    body: string,
  ): Promise<SendResult> {
    return this.enqueue(ref.clinicId, async () => {
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendText,
        { payload: { number: to, text: body } },
      );
      return toSendResult(status, response);
    });
  }

  async sendMenu(
    ref: InstanceRef,
    to: string,
    body: string,
    options: MenuOption[],
  ): Promise<SendResult> {
    return this.enqueue(ref.clinicId, async () => {
      // Codificacao da especificacao: "texto|id" para botao de resposta.
      const choices = options.map((option) => `${option.text}|${option.id}`);
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendMenu,
        { payload: { number: to, type: "button", text: body, choices } },
      );
      if (status >= 200 && status < 300) {
        return toSendResult(status, response);
      }
      // Botao interativo e incerto em API nao oficial: degrada para texto
      // numerado, que funciona em qualquer aparelho.
      const numbered = `${body}\n\n${options
        .map((option, index) => `${index + 1}. ${option.text}`)
        .join("\n")}\n\nResponda com o número da opção.`;
      const fallback = await this.request(ref, PATHS.sendText, {
        payload: { number: to, text: numbered },
      });
      return toSendResult(fallback.status, fallback.body);
    });
  }

  /**
   * Cria a instancia daquela clinica (token administrativo) e devolve o token
   * proprio dela. Cada clinica tem a sua: e isso que torna a conexao escalavel.
   */
  async createInstance(
    ref: InstanceRef,
    name: string,
  ): Promise<{ instanceToken: string; instanceId: string | null }> {
    const { status, body } = await this.request(ref, PATHS.instanceCreate, {
      payload: { name },
      tokenKind: "admin",
    });
    if (status === 429) {
      throw new Error(
        "O servidor uazapi atingiu o limite de instâncias conectadas.",
      );
    }
    const token = pickString(body, ["token", "instance.token"]);
    if (!token) {
      throw new Error(
        pickString(body, ["error", "message"]) ??
          "O uazapi não devolveu o token da instância.",
      );
    }
    return {
      instanceToken: token,
      instanceId:
        pickString(body, ["name", "instance.id", "instance.name"]) ?? null,
    };
  }

  async connectInstance(ref: InstanceRef): Promise<InstanceStatus> {
    const { body } = await this.request(ref, PATHS.instanceConnect, {
      payload: {},
    });
    return parseInstanceStatus(body);
  }

  async getStatus(ref: InstanceRef): Promise<InstanceStatus> {
    // GET, conforme a especificacao.
    const { body } = await this.request(ref, PATHS.instanceStatus, {
      method: "GET",
    });
    return parseInstanceStatus(body);
  }

  async configureWebhook(ref: InstanceRef, url: string): Promise<void> {
    await this.request(ref, PATHS.webhook, {
      payload: {
        enabled: true,
        url,
        events: ["messages", "messages_update", "connection"],
        // OBRIGATORIO: sem isto, toda mensagem que enviamos volta como
        // recebida e vira laco infinito. A especificacao alerta duas vezes.
        excludeMessages: ["wasSentByApi"],
      },
    });
  }

  async disconnect(ref: InstanceRef): Promise<void> {
    await this.request(ref, PATHS.instanceDisconnect, { payload: {} });
  }
}

function toSendResult(
  status: number,
  body: Record<string, unknown>,
): SendResult {
  if (status >= 200 && status < 300) {
    // messageid e o id do WhatsApp, o que casa com os recibos de entrega.
    // id e interno (formato dono:messageid) e serve de reserva.
    const id =
      pickString(body, ["id", "messageid"]) ?? `uazapi:${crypto.randomUUID()}`;
    return { ok: true, waMessageId: id };
  }
  // Erro 463 do WhatsApp: restricao por volume ou qualidade da conta, o
  // vizinho do banimento. Diagnostico em GET /instance/wa_messages_limits.
  const provedor = body["provider_code"];
  if (provedor === 463) {
    return {
      ok: false,
      errorCode: "whatsapp_463",
      message:
        "O WhatsApp restringiu temporariamente este número para iniciar conversas.",
    };
  }
  return {
    ok: false,
    errorCode: `uazapi_${status}`,
    message:
      pickString(body, ["message_ptbr", "error", "message"]) ??
      "Falha no envio",
  };
}

function parseInstanceStatus(body: Record<string, unknown>): InstanceStatus {
  // Enum oficial: disconnected, connecting, connected, hibernated.
  const raw = (
    pickString(body, ["instance.status", "status", "state"]) ?? ""
  ).toLowerCase();
  const status =
    raw === "connected"
      ? "conectado"
      : raw === "connecting"
        ? "conectando"
        : raw === "hibernated"
          ? "desconectado"
          : "desconectado";

  const qrCode = pickString(body, ["instance.qrcode", "qrcode"]);
  const paircode = pickString(body, ["instance.paircode", "paircode"]);

  return {
    // Enquanto ha QR na resposta, o pareamento esta aberto esperando leitura.
    status: qrCode && status !== "conectado" ? "aguardando_qr" : status,
    qrCode: qrCode ?? paircode,
    displayPhone:
      pickString(body, ["instance.profileName", "status.jid.user", "owner"]) ??
      null,
    instanceId: pickString(body, ["instance.name", "instance.id"]),
    instanceToken: pickString(body, ["instance.token", "token"]),
  };
}

function pickString(
  body: Record<string, unknown>,
  paths: string[],
): string | null {
  for (const path of paths) {
    let value: unknown = body;
    for (const key of path.split(".")) {
      if (value && typeof value === "object" && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        value = undefined;
        break;
      }
    }
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
