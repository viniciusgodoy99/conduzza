import type {
  InstanceRef,
  InstanceStatus,
  MediaDownloadResult,
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
  messageDownload: "/message/download",
} as const;

const REQUEST_TIMEOUT_MS = 10_000;
// Download de midia e maior e mais lento que os demais; roda em job, nao no
// caminho de request de usuario, entao pode esperar mais.
const DOWNLOAD_TIMEOUT_MS = 60_000;
// Teto do corpo aceito no download: o base64 inteiro passa pela memoria do
// worker. O WhatsApp limita audio/video a ~16MB; 40MB de corpo cobre o
// base64 disso com folga, e um documento maior falha com codigo claro em vez
// de derrubar o processo.
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
const MAX_RETRIES = 2;

// ANTI-BAN: o espacamento entre envios NAO vive mais aqui. Ele e um slot
// reservado no banco (reservar_slot_envio em whatsapp_account.next_send_at),
// compartilhado entre o servidor web e o worker de disparo, que sao processos
// separados: estado em memoria de um nao protege o outro. Quem orquestra o
// envio (lib/integrations/whatsapp/send.ts e o worker) reserva o slot ANTES
// de chamar este cliente. Este arquivo so fala HTTP com o uazapi.

type UazapiOptions = {
  fetchFn?: typeof fetch;
};

export class UazapiProvider implements WhatsAppProvider {
  readonly name = "uazapi" as const;
  readonly isOfficialChannel = false;
  private readonly fetchFn: typeof fetch;

  constructor(options: UazapiOptions = {}) {
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
      /**
       * Envio de mensagem NAO pode ser repetido: se a primeira tentativa
       * chegou ao WhatsApp e a resposta se perdeu, repetir manda a mesma
       * mensagem duas vezes para o paciente. Falha de envio e melhor que
       * mensagem duplicada, porque a interface deixa reenviar de proposito.
       */
      semRetry?: boolean;
      timeoutMs?: number;
      /** teto do corpo da resposta; acima disso a chamada falha com 413 local */
      maxBodyBytes?: number;
    } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const {
      method = "POST",
      payload,
      tokenKind = "instance",
      semRetry = false,
      timeoutMs = REQUEST_TIMEOUT_MS,
      maxBodyBytes,
    } = options;
    const tentativas = semRetry ? 0 : MAX_RETRIES;
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
    for (let attempt = 0; attempt <= tentativas; attempt++) {
      if (attempt > 0) {
        const backoff = 500 * 2 ** (attempt - 1) + Math.random() * 250;
        await sleep(backoff);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchFn(`${this.baseUrl(ref)}${path}`, {
          method,
          headers,
          body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
          signal: controller.signal,
        });
        if (maxBodyBytes !== undefined) {
          const tamanho = Number(response.headers.get("content-length") ?? 0);
          if (tamanho > maxBodyBytes) {
            return { status: 413, body: { error: "corpo_grande_demais" } };
          }
        }
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        // 4xx nao ganha nova tentativa: e erro nosso ou de recurso, repetir
        // nao ajuda. 429 (teto de instancias) tambem nao.
        // 500 que carrega provider_code NAO e falha de infraestrutura: e o
        // WhatsApp recusando a mensagem (ex.: 463, restricao por qualidade).
        // Repetir agrava a restricao do numero, entao devolve na hora.
        if (response.status >= 500 && body["provider_code"] === undefined) {
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

  async sendText(
    ref: InstanceRef,
    to: string,
    body: string,
  ): Promise<SendResult> {
    try {
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendText,
        { payload: { number: to, text: body }, semRetry: true },
      );
      return toSendResult(status, response);
    } catch {
      // Sem repeticao no envio: a mensagem pode ter chegado ao WhatsApp e
      // so a resposta ter se perdido. Devolve falha para a interface
      // oferecer reenvio consciente, em vez de duplicar sozinho.
      return {
        ok: false as const,
        errorCode: "envio_incerto",
        message:
          "Não foi possível confirmar o envio. Confira a conversa antes de reenviar.",
      };
    }
  }

  async sendMenu(
    ref: InstanceRef,
    to: string,
    body: string,
    options: MenuOption[],
  ): Promise<SendResult> {
    // Codificacao da especificacao: "texto|id" para botao de resposta.
    const choices = options.map((option) => `${option.text}|${option.id}`);
    const { status, body: response } = await this.request(ref, PATHS.sendMenu, {
      payload: { number: to, type: "button", text: body, choices },
      semRetry: true,
    });
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
      semRetry: true,
    });
    return toSendResult(fallback.status, fallback.body);
  }

  async downloadMedia(
    ref: InstanceRef,
    waMessageId: string,
    options: { transcribe?: boolean } = {},
  ): Promise<MediaDownloadResult> {
    // Contrato confirmado na especificacao (POST /message/download):
    // pedido {id, return_base64, return_link, transcribe, openai_apikey};
    // resposta {mimetype, base64Data?, transcription?, fileURL?}.
    // return_base64 e return_link=false de proposito: midia de paciente vai
    // para o NOSSO Storage, nunca fica numa URL publica do provedor.
    const payload: Record<string, unknown> = {
      id: waMessageId,
      return_base64: true,
      return_link: false,
      generate_mp3: true,
      transcribe: options.transcribe === true,
    };
    // Transcricao envia AUDIO DE PACIENTE para a OpenAI via servidor uazapi.
    // Isso so acontece com decisao explicita do operador: a chave e a env
    // DEDICADA UAZAPI_OPENAI_KEY (nunca reaproveitamos OPENAI_API_KEY em
    // silencio). Sem a chave, o servidor uazapi usa a dele se tiver; senao a
    // resposta vem sem transcricao e o audio fica sem texto, que e o
    // comportamento seguro por padrao.
    if (options.transcribe && process.env.UAZAPI_OPENAI_KEY) {
      payload.openai_apikey = process.env.UAZAPI_OPENAI_KEY;
    }
    const { status, body } = await this.request(ref, PATHS.messageDownload, {
      payload,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxBodyBytes: MAX_DOWNLOAD_BYTES,
    });
    const base64 = pickString(body, ["base64Data"]);
    const mimetype = pickString(body, ["mimetype"]);
    if (status >= 200 && status < 300 && base64 && mimetype) {
      return {
        ok: true,
        base64,
        mimetype,
        transcript: pickString(body, ["transcription"]),
      };
    }
    return {
      ok: false,
      errorCode: `uazapi_download_${status}`,
      message:
        pickString(body, ["message_ptbr", "error", "message"]) ??
        "Não foi possível baixar o arquivo.",
    };
  }

  /**
   * Cria a instancia daquela clinica (token administrativo) e devolve o token
   * proprio dela. Cada clinica tem a sua: e isso que torna a conexao escalavel.
   * O nome vem de nomeDaInstancia e e apenas o rotulo do painel: toda chamada
   * seguinte autentica pelo TOKEN da instancia, nunca pelo nome.
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
      pickString(body, ["messageid", "id"]) ?? `uazapi:${crypto.randomUUID()}`;
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

/**
 * Rotulo da instancia no painel do uazapi: `conduzza_` mais o slug da clinica.
 *
 * O servidor uazapi e COMPARTILHADO com outros produtos, entao o prefixo diz
 * de quem e a instancia numa olhada, e o slug (unico por clinica no banco)
 * diz de QUAL clinica. O nome e so rotulo: toda operacao seguinte autentica
 * pelo token da instancia, entao dois nomes iguais nao quebrariam nada, mas
 * o slug unico evita confusao no painel. Clinica sem slug utilizavel cai no
 * inicio do id, que sempre existe.
 */
export function nomeDaInstancia(slug: string, clinicId: string): string {
  const base = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  return `conduzza_${base.length > 0 ? base : clinicId.slice(0, 8)}`;
}
