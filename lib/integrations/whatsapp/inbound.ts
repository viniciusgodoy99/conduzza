import { z } from "zod";

// Normalizador de eventos recebidos no webhook. E o UNICO lugar que conhece o
// formato do uazapi; o provedor falso e o simulador emitem direto o formato
// canonico. Payload desconhecido vira null (o webhook responde 200 ignorando,
// para nao provocar tempestade de reenvio).

export type InboundEvent =
  | {
      kind: "message_received";
      phone: string;
      name: string | null;
      waMessageId: string;
      contentType: "texto" | "audio" | "imagem" | "documento";
      body: string | null;
      mediaUrl: string | null;
    }
  | {
      kind: "message_status";
      waMessageId: string;
      status: "entregue" | "lida" | "falhou";
      errorCode: string | null;
    }
  | {
      kind: "connection_update";
      status: "desconectado" | "aguardando_qr" | "conectando" | "conectado";
    };

// Formato canonico (fake e simulador)
const canonicalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message_received"),
    phone: z.string().min(8),
    name: z.string().nullish(),
    waMessageId: z.string().min(1),
    contentType: z
      .enum(["texto", "audio", "imagem", "documento"])
      .default("texto"),
    body: z.string().nullish(),
    mediaUrl: z.string().nullish(),
  }),
  z.object({
    kind: z.literal("message_status"),
    waMessageId: z.string().min(1),
    status: z.enum(["entregue", "lida", "falhou"]),
    errorCode: z.string().nullish(),
  }),
  z.object({
    kind: z.literal("connection_update"),
    status: z.enum([
      "desconectado",
      "aguardando_qr",
      "conectando",
      "conectado",
    ]),
  }),
]);

// Formato uazapi (best effort, tolerante a campos extras; VALIDAR contra a
// conta real quando ela chegar)
const uazapiMessageSchema = z
  .object({
    event: z.string().optional(),
    EventType: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        messageid: z.string().optional(),
        sender: z.string().optional(),
        chatid: z.string().optional(),
        fromMe: z.boolean().optional(),
        senderName: z.string().optional(),
        pushName: z.string().optional(),
        text: z.string().optional(),
        content: z.string().optional(),
        type: z.string().optional(),
        messageType: z.string().optional(),
        mediaUrl: z.string().optional(),
        fileURL: z.string().optional(),
      })
      .loose()
      .optional(),
    status: z.string().optional(),
    instance: z.unknown().optional(),
  })
  .loose();

function phoneFromJid(jid: string | undefined): string | null {
  if (!jid) {
    return null;
  }
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  if (!digits || digits.length < 8) {
    return null;
  }
  return `+${digits}`;
}

function mapContentType(
  type: string | undefined,
): "texto" | "audio" | "imagem" | "documento" {
  const value = (type ?? "").toLowerCase();
  if (value.includes("audio") || value.includes("ptt")) return "audio";
  if (value.includes("image")) return "imagem";
  if (value.includes("document")) return "documento";
  return "texto";
}

export function parseInboundEvent(payload: unknown): InboundEvent | null {
  const canonical = canonicalSchema.safeParse(payload);
  if (canonical.success) {
    const event = canonical.data;
    if (event.kind === "message_received") {
      return {
        kind: "message_received",
        phone: event.phone,
        name: event.name ?? null,
        waMessageId: event.waMessageId,
        contentType: event.contentType,
        body: event.body ?? null,
        mediaUrl: event.mediaUrl ?? null,
      };
    }
    if (event.kind === "message_status") {
      return {
        kind: "message_status",
        waMessageId: event.waMessageId,
        status: event.status,
        errorCode: event.errorCode ?? null,
      };
    }
    return event;
  }

  const uazapi = uazapiMessageSchema.safeParse(payload);
  if (!uazapi.success) {
    return null;
  }
  const data = uazapi.data;
  const eventName = (data.event ?? data.EventType ?? "").toLowerCase();

  if (eventName.includes("connection")) {
    const raw = (data.status ?? "").toLowerCase();
    // Ordem importa: "disconnected" contem "connected" como substring.
    return {
      kind: "connection_update",
      status: raw.includes("disconnect")
        ? "desconectado"
        : raw.includes("qr")
          ? "aguardando_qr"
          : raw.includes("connecting")
            ? "conectando"
            : raw.includes("connected") || raw.includes("open")
              ? "conectado"
              : "desconectado",
    };
  }

  const message = data.message;
  if (eventName.includes("message") && message) {
    // Mensagem enviada por nos (fromMe) que volta como eco: status, nao entrada.
    const waMessageId = message.id ?? message.messageid;
    if (!waMessageId) {
      return null;
    }
    if (message.fromMe) {
      return {
        kind: "message_status",
        waMessageId,
        status: "entregue",
        errorCode: null,
      };
    }
    const phone = phoneFromJid(message.sender) ?? phoneFromJid(message.chatid);
    if (!phone) {
      return null;
    }
    const contentType = mapContentType(message.messageType ?? message.type);
    return {
      kind: "message_received",
      phone,
      name: message.senderName ?? message.pushName ?? null,
      waMessageId,
      contentType,
      body: message.text ?? message.content ?? null,
      mediaUrl: message.mediaUrl ?? message.fileURL ?? null,
    };
  }

  return null;
}
