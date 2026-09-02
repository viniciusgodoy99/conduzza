import { z } from "zod";

// Normalizador de eventos do webhook. E o UNICO lugar que conhece o formato
// do uazapi; o provedor falso e o simulador emitem direto o formato canonico.
// Payload desconhecido vira null (o webhook responde 200 ignorando, para nao
// provocar tempestade de reenvio).
//
// Formatos conforme a especificacao oficial e payloads reais capturados:
//  - "messages": envelope achatado com EventType no topo, mensagem em
//    `message`. Telefone real em `sender_pn` (o `sender` pode vir como @lid,
//    que NAO e telefone). Id do WhatsApp em `messageid`.
//  - "messages_update": forma completamente diferente, em maiusculas
//    (eventos crus do whatsmeow), com `event.MessageIDs` (lista).
//  - "connection": status em `instance.status`.

export type InboundEvent =
  | {
      kind: "message_received";
      phone: string;
      name: string | null;
      waMessageId: string;
      contentType: "texto" | "audio" | "imagem" | "documento";
      body: string | null;
      mediaUrl: string | null;
      /**
       * Id NO WHATSAPP da mensagem que o paciente citou ao responder.
       * O campo chegava desde sempre e era descartado em silencio, entao o
       * "respondendo a" que o paciente fez sumia da conversa da clinica.
       */
      quotedWaMessageId: string | null;
      /** token da instancia que recebeu; confere contra o guardado */
      instanceToken: string | null;
    }
  | {
      /**
       * A clinica respondeu pelo PROPRIO CELULAR pareado, fora do sistema.
       * Nao e mensagem recebida (nao entra na conversa como fala do paciente)
       * e nao e eco do nosso envio: e alguem de carne e osso atendendo por
       * fora. O sistema precisa saber para nao continuar dizendo que aquela
       * conversa espera resposta.
       */
      kind: "clinic_device_reply";
      phone: string;
      waMessageId: string;
      instanceToken: string | null;
    }
  | {
      /**
       * O PACIENTE apagou uma mensagem para todos. Chega como messages_update
       * com Type 'Deleted'. Antes era descartado junto com os demais estados
       * que nao mudam entrega, e a clinica continuava lendo um texto que ja
       * havia sumido do celular de quem escreveu.
       */
      kind: "message_deleted";
      waMessageIds: string[];
      instanceToken: string | null;
    }
  | {
      kind: "message_status";
      waMessageIds: string[];
      status: "entregue" | "lida" | "falhou";
      errorCode: string | null;
      instanceToken: string | null;
    }
  | {
      kind: "connection_update";
      status: "desconectado" | "aguardando_qr" | "conectando" | "conectado";
      instanceToken: string | null;
    };

// Formato canonico (provedor falso e simulador de desenvolvimento)
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
    quotedWaMessageId: z.string().nullish(),
  }),
  z.object({
    kind: z.literal("message_deleted"),
    waMessageId: z.string().min(1),
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

const uazapiSchema = z
  .object({
    EventType: z.string().optional(),
    // Em "messages" o event e o nome do evento (texto); em "messages_update"
    // e o objeto cru do whatsmeow. Aceita os dois.
    event: z.unknown().optional(),
    token: z.string().optional(),
    instanceName: z.string().optional(),
    owner: z.string().optional(),
    type: z.string().optional(),
    state: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        messageid: z.string().optional(),
        chatid: z.string().optional(),
        sender: z.string().optional(),
        sender_pn: z.string().optional(),
        senderName: z.string().optional(),
        fromMe: z.boolean().optional(),
        isGroup: z.boolean().optional(),
        type: z.string().optional(),
        messageType: z.string().optional(),
        mediaType: z.string().optional(),
        text: z.string().optional(),
        wasSentByApi: z.boolean().optional(),
        buttonOrListid: z.string().optional(),
        reaction: z.unknown().optional(),
        content: z.unknown().optional(),
        quoted: z.string().optional(),
      })
      .loose()
      .optional(),
    instance: z
      .object({
        status: z.string().optional(),
        qrcode: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

function phoneFromJid(jid: string | undefined): string | null {
  if (!jid) {
    return null;
  }
  const parte = jid.split("@")[0]?.split(":")[0];
  const digitos = parte?.replace(/\D/g, "");
  if (!digitos || digitos.length < 10) {
    return null;
  }
  return `+${digitos}`;
}

function mapContentType(
  ...candidatos: (string | undefined)[]
): "texto" | "audio" | "imagem" | "documento" {
  const valor = candidatos.filter(Boolean).join(" ").toLowerCase();
  if (valor.includes("audio") || valor.includes("ptt")) return "audio";
  if (valor.includes("image")) return "imagem";
  if (valor.includes("document")) return "documento";
  return "texto";
}

function mapConnectionStatus(
  raw: string | undefined,
): "desconectado" | "aguardando_qr" | "conectando" | "conectado" {
  const valor = (raw ?? "").toLowerCase();
  if (valor === "connected") return "conectado";
  if (valor === "connecting") return "conectando";
  return "desconectado";
}

export function parseInboundEvent(payload: unknown): InboundEvent | null {
  const canonical = canonicalSchema.safeParse(payload);
  if (canonical.success) {
    const evento = canonical.data;
    if (evento.kind === "message_received") {
      return {
        kind: "message_received",
        phone: evento.phone,
        name: evento.name ?? null,
        waMessageId: evento.waMessageId,
        contentType: evento.contentType,
        body: evento.body ?? null,
        mediaUrl: evento.mediaUrl ?? null,
        quotedWaMessageId: evento.quotedWaMessageId ?? null,
        instanceToken: null,
      };
    }
    if (evento.kind === "message_deleted") {
      return {
        kind: "message_deleted",
        waMessageIds: [evento.waMessageId],
        instanceToken: null,
      };
    }
    if (evento.kind === "message_status") {
      return {
        kind: "message_status",
        waMessageIds: [evento.waMessageId],
        status: evento.status,
        errorCode: evento.errorCode ?? null,
        instanceToken: null,
      };
    }
    return { ...evento, instanceToken: null };
  }

  const parsed = uazapiSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const dados = parsed.data as Record<string, unknown> & {
    EventType?: string;
    event?: string | Record<string, unknown>;
    token?: string;
    type?: string;
    state?: string;
    message?: Record<string, unknown>;
    instance?: Record<string, unknown>;
  };
  const instanceToken = dados.token ?? null;
  const tipoEvento = (
    dados.EventType ?? (typeof dados.event === "string" ? dados.event : "")
  ).toLowerCase();

  if (tipoEvento === "connection") {
    return {
      kind: "connection_update",
      status: mapConnectionStatus(dados.instance?.status as string | undefined),
      instanceToken,
    };
  }

  if (tipoEvento === "messages_update") {
    const bruto = (dados.event ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(bruto.MessageIDs)
      ? (bruto.MessageIDs as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    if (ids.length === 0) {
      return null;
    }
    const estado = String(bruto.Type ?? dados.state ?? dados.type ?? "");
    if (estado === "Deleted") {
      return { kind: "message_deleted", waMessageIds: ids, instanceToken };
    }
    const status =
      estado === "Read" ? "lida" : estado === "Delivered" ? "entregue" : null;
    if (!status) {
      // Os demais estados nao mudam entrega nem visibilidade: ignorar.
      return null;
    }
    return {
      kind: "message_status",
      waMessageIds: ids,
      status,
      errorCode: null,
      instanceToken,
    };
  }

  if (tipoEvento === "messages" && dados.message) {
    const mensagem = dados.message as Record<string, unknown>;
    const waMessageId =
      (mensagem.messageid as string | undefined) ??
      (mensagem.id as string | undefined);
    if (!waMessageId) {
      return null;
    }
    // Eco da NOSSA propria mensagem (enviada pela API): descarta, senao vira
    // laco. O excludeMessages do webhook ja deveria filtrar; a defesa aqui
    // vale se a configuracao se perder.
    if (mensagem.wasSentByApi === true) {
      return null;
    }
    // Conversa em grupo nao e atendimento de paciente: ignorar por ora.
    if (mensagem.isGroup === true) {
      return null;
    }
    // Mensagem SAINDO do numero da clinica sem ter passado pela API: alguem
    // respondeu pelo celular pareado. Antes isto era descartado igual ao eco,
    // e a conversa continuava marcada como esperando resposta: outra atendente
    // abria o Inbox, via a pergunta "sem resposta" e respondia de novo. O
    // paciente recebia duas respostas para a mesma pergunta.
    //
    // Para mensagem de saida, o telefone do PACIENTE esta no chatid (o
    // sender_pn e o numero da propria clinica).
    if (mensagem.fromMe === true) {
      const destino = phoneFromJid(mensagem.chatid as string | undefined);
      if (!destino) {
        return null;
      }
      return {
        kind: "clinic_device_reply",
        phone: destino,
        waMessageId,
        instanceToken,
      };
    }
    // sender pode ser @lid (identificador interno), que NAO e telefone.
    const phone =
      phoneFromJid(mensagem.sender_pn as string | undefined) ??
      phoneFromJid(mensagem.chatid as string | undefined) ??
      phoneFromJid(mensagem.sender as string | undefined);
    if (!phone) {
      return null;
    }
    // REACAO (o joinha que o paciente coloca EM CIMA de uma mensagem) nao e
    // resposta: ela nao diz a que pergunta se refere e o WhatsApp a entrega
    // como mensagem comum, com o emoji no texto. Sem este descarte, o paciente
    // que reagia com joinha a QUALQUER mensagem da clinica (inclusive uma
    // resposta de preco) confirmava sozinho a consulta pendente, porque
    // interpretarResposta aceita joinha sozinho como "confirmar". Confirmar
    // por engano faz a clinica contar com quem nao vem.
    const tipoBruto = [
      mensagem.messageType as string | undefined,
      mensagem.type as string | undefined,
      mensagem.mediaType as string | undefined,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (tipoBruto.includes("reaction") || mensagem.reaction) {
      return null;
    }

    const conteudo = (mensagem.content ?? {}) as Record<string, unknown>;
    // Resposta de BOTAO: o texto que o paciente tocou nao vem em `text` em
    // todo formato. O uazapi devolve o id escolhido em buttonOrListid, e o
    // whatsmeow cru traz selectedButtonId/selectedDisplayText dentro de
    // content. Sem ler esses campos, tocar em "Confirmar" chegaria com body
    // nulo, o interceptador ignoraria e a consulta ficaria aguardando para
    // sempre, com o paciente convencido de que ja respondeu.
    const escolhaDeBotao =
      (mensagem.buttonOrListid as string | undefined) ??
      (conteudo.selectedButtonId as string | undefined) ??
      (conteudo.selectedDisplayText as string | undefined) ??
      (conteudo.selectedRowId as string | undefined) ??
      null;

    return {
      kind: "message_received",
      phone,
      name: (mensagem.senderName as string | undefined) ?? null,
      waMessageId,
      contentType: mapContentType(
        mensagem.mediaType as string | undefined,
        mensagem.messageType as string | undefined,
        mensagem.type as string | undefined,
      ),
      body:
        (mensagem.text as string | undefined)?.trim() || escolhaDeBotao || null,
      // A URL vem criptografada (.enc): baixar exige POST /message/download.
      // Guardamos a referencia; o download entra quando houver midia de fato.
      mediaUrl: (conteudo.URL as string | undefined) ?? null,
      // Na especificacao, `quoted` e simplesmente o id da mensagem citada.
      // Vem string vazia quando nao ha citacao, e "" nao pode virar busca.
      quotedWaMessageId: (mensagem.quoted as string | undefined) || null,
      instanceToken,
    };
  }

  return null;
}
