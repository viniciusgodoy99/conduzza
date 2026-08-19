import type {
  InstanceRef,
  InstanceStatus,
  MenuOption,
  SendResult,
  WhatsAppProvider,
} from "./provider";

// Cliente uazapi (API nao oficial; decisao registrada no CLAUDE.md 3.3).
//
// ATENCAO: os caminhos abaixo seguem a superficie publica conhecida do uazapi
// e DEVEM ser validados contra docs.uazapi.com quando a conta real chegar.
// Ficam centralizados aqui de proposito: corrigir formato e mexer num arquivo.
const PATHS = {
  sendText: "/send/text",
  sendMenu: "/send/menu",
  instanceConnect: "/instance/connect",
  instanceStatus: "/instance/status",
  instanceDisconnect: "/instance/disconnect",
  webhook: "/webhook",
} as const;

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

// Anti-ban: atraso aleatorio entre envios POR INSTANCIA. Suficiente para a
// resposta humana 1:1 da Fase 1. Disparo em massa (reguas, Fase 4) DEVE
// passar pela job_queue com rate limit por instancia, NUNCA por aqui: esta
// fila vive em memoria e nao sobrevive a multiplas instancias serverless.
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
    return url.replace(/\/$/, "");
  }

  private async request(
    ref: InstanceRef,
    path: string,
    payload: Record<string, unknown>,
    tokenKind: "instance" | "admin" = "instance",
  ): Promise<{ status: number; body: Record<string, unknown> }> {
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
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        // 4xx nao ganha retry: e erro nosso ou de recurso, repetir nao ajuda.
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
        { number: to, text: body },
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
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendMenu,
        {
          number: to,
          type: "button",
          text: body,
          choices: options.map((option) => option.text),
        },
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
        number: to,
        text: numbered,
      });
      return toSendResult(fallback.status, fallback.body);
    });
  }

  async connectInstance(ref: InstanceRef): Promise<InstanceStatus> {
    const { body } = await this.request(
      ref,
      PATHS.instanceConnect,
      { instance: ref.instanceId ?? undefined },
      ref.instanceToken ? "instance" : "admin",
    );
    return parseInstanceStatus(body);
  }

  async getStatus(ref: InstanceRef): Promise<InstanceStatus> {
    const { body } = await this.request(ref, PATHS.instanceStatus, {});
    return parseInstanceStatus(body);
  }

  async configureWebhook(ref: InstanceRef, url: string): Promise<void> {
    await this.request(ref, PATHS.webhook, {
      url,
      events: ["messages", "messages_update", "connection"],
    });
  }

  async disconnect(ref: InstanceRef): Promise<void> {
    await this.request(ref, PATHS.instanceDisconnect, {});
  }
}

function toSendResult(
  status: number,
  body: Record<string, unknown>,
): SendResult {
  if (status >= 200 && status < 300) {
    const id =
      pickString(body, ["id", "messageid", "messageId", "key.id"]) ??
      `uazapi:${crypto.randomUUID()}`;
    return { ok: true, waMessageId: id };
  }
  return {
    ok: false,
    errorCode: `uazapi_${status}`,
    message: pickString(body, ["error", "message"]) ?? "Falha no envio",
  };
}

function parseInstanceStatus(body: Record<string, unknown>): InstanceStatus {
  const raw = (
    pickString(body, ["status", "state", "instance.status"]) ?? ""
  ).toLowerCase();
  // Ordem importa: "disconnected" contem "connected" como substring.
  const status = raw.includes("disconnect")
    ? "desconectado"
    : raw.includes("connected") || raw.includes("open")
      ? "conectado"
      : raw.includes("qr")
        ? "aguardando_qr"
        : raw.includes("connecting") || raw.includes("loading")
          ? "conectando"
          : "desconectado";
  return {
    status,
    qrCode: pickString(body, ["qrcode", "qrCode", "instance.qrcode"]),
    displayPhone: pickString(body, ["phone", "number", "instance.phone"]),
    instanceId: pickString(body, ["instance", "instanceId", "instance.id"]),
    instanceToken: pickString(body, ["token", "instance.token"]),
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
