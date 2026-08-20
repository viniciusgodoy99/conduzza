import { describe, expect, it } from "vitest";

import { parseInboundEvent } from "@/lib/integrations/whatsapp/inbound";

// Os payloads uazapi deste arquivo seguem capturas reais do formato v2.1.1.

describe("formato canônico (simulador de desenvolvimento)", () => {
  it("mensagem recebida", () => {
    expect(
      parseInboundEvent({
        kind: "message_received",
        phone: "+5584999990000",
        name: "Maria",
        waMessageId: "sim:1",
        contentType: "texto",
        body: "Oi, quero agendar",
      }),
    ).toEqual({
      kind: "message_received",
      phone: "+5584999990000",
      name: "Maria",
      waMessageId: "sim:1",
      contentType: "texto",
      body: "Oi, quero agendar",
      mediaUrl: null,
      instanceToken: null,
    });
  });
});

describe("formato uazapi: mensagens", () => {
  const base = {
    BaseUrl: "https://exemplo.uazapi.com",
    EventType: "messages",
    instanceName: "clinica-teste",
    owner: "558185464605",
    token: "token-da-instancia",
  };

  it("usa sender_pn como telefone, nunca o @lid", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        id: "558185464605:AC98212CD4909DE6799E78D93A824A3F",
        messageid: "AC98212CD4909DE6799E78D93A824A3F",
        chatid: "5584991234567@s.whatsapp.net",
        // sender vem como @lid: identificador interno, nao telefone
        sender: "138401042923712@lid",
        sender_pn: "5584991234567@s.whatsapp.net",
        senderName: "João",
        fromMe: false,
        isGroup: false,
        type: "text",
        messageType: "ExtendedTextMessage",
        text: "Bom dia",
      },
    });
    expect(evento).toEqual({
      kind: "message_received",
      phone: "+5584991234567",
      name: "João",
      waMessageId: "AC98212CD4909DE6799E78D93A824A3F",
      contentType: "texto",
      body: "Bom dia",
      mediaUrl: null,
      instanceToken: "token-da-instancia",
    });
  });

  it("prefere messageid (id do WhatsApp) ao id interno", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        id: "558185464605:INTERNO",
        messageid: "WAMID-REAL",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
      },
    });
    expect(evento).toMatchObject({ waMessageId: "WAMID-REAL" });
  });

  it("ignora eco da própria mensagem (fromMe e wasSentByApi)", () => {
    expect(
      parseInboundEvent({
        ...base,
        message: {
          messageid: "eco",
          fromMe: true,
          sender_pn: "5584991234567@s.whatsapp.net",
        },
      }),
    ).toBeNull();
    expect(
      parseInboundEvent({
        ...base,
        message: {
          messageid: "eco2",
          wasSentByApi: true,
          sender_pn: "5584991234567@s.whatsapp.net",
        },
      }),
    ).toBeNull();
  });

  it("ignora mensagem de grupo", () => {
    expect(
      parseInboundEvent({
        ...base,
        message: {
          messageid: "grupo-1",
          isGroup: true,
          sender_pn: "5584991234567@s.whatsapp.net",
          text: "oi",
        },
      }),
    ).toBeNull();
  });

  it("áudio traz o tipo certo e a URL criptografada", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "audio-1",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        type: "media",
        messageType: "AudioMessage",
        mediaType: "ptt",
        content: { URL: "https://mmg.whatsapp.net/v/t62.7118-24/abc.enc" },
      },
    });
    expect(evento).toMatchObject({
      contentType: "audio",
      mediaUrl: "https://mmg.whatsapp.net/v/t62.7118-24/abc.enc",
    });
  });
});

describe("formato uazapi: recibos de entrega (maiúsculas)", () => {
  it("Delivered vira entregue com a lista de ids", () => {
    expect(
      parseInboundEvent({
        EventType: "messages_update",
        token: "tok",
        type: "ReadReceipt",
        state: "Delivered",
        event: {
          Chat: "5514996448268@s.whatsapp.net",
          MessageIDs: ["3B50879ADE161979CEB8", "OUTRO"],
          Type: "Delivered",
        },
      }),
    ).toEqual({
      kind: "message_status",
      waMessageIds: ["3B50879ADE161979CEB8", "OUTRO"],
      status: "entregue",
      errorCode: null,
      instanceToken: "tok",
    });
  });

  it("Read vira lida", () => {
    expect(
      parseInboundEvent({
        EventType: "messages_update",
        event: { MessageIDs: ["X"], Type: "Read" },
      }),
    ).toMatchObject({ status: "lida" });
  });

  it("mensagem apagada não altera entrega", () => {
    expect(
      parseInboundEvent({
        EventType: "messages_update",
        event: { MessageIDs: ["X"], Type: "Deleted" },
      }),
    ).toBeNull();
  });
});

describe("formato uazapi: conexão", () => {
  it.each([
    ["connected", "conectado"],
    ["connecting", "conectando"],
    ["disconnected", "desconectado"],
  ])("status %s vira %s", (bruto, esperado) => {
    expect(
      parseInboundEvent({
        EventType: "connection",
        token: "tok",
        instance: { name: "x", status: bruto },
      }),
    ).toEqual({
      kind: "connection_update",
      status: esperado,
      instanceToken: "tok",
    });
  });

  it("desconexão por logout de outro aparelho", () => {
    expect(
      parseInboundEvent({
        EventType: "connection",
        type: "LoggedOut",
        instance: {
          status: "disconnected",
          lastDisconnectReason: "401: logged out from another device",
        },
      }),
    ).toMatchObject({ kind: "connection_update", status: "desconectado" });
  });
});

describe("payloads que devem ser ignorados", () => {
  it.each([
    ["nulo", null],
    ["texto solto", "lixo"],
    ["objeto qualquer", { qualquer: "coisa" }],
    ["mensagem sem id", { EventType: "messages", message: { fromMe: false } }],
    [
      "mensagem sem telefone reconhecível",
      { EventType: "messages", message: { messageid: "x", sender: "abc@lid" } },
    ],
    ["evento não tratado", { EventType: "presence", data: {} }],
  ])("%s vira null, nunca exceção", (_nome, payload) => {
    expect(parseInboundEvent(payload)).toBeNull();
  });
});
