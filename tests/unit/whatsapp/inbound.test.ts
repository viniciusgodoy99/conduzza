import { describe, expect, it } from "vitest";

import { parseInboundEvent } from "@/lib/integrations/whatsapp/inbound";

describe("parseInboundEvent", () => {
  it("aceita o formato canônico do simulador", () => {
    const event = parseInboundEvent({
      kind: "message_received",
      phone: "+5584999990000",
      name: "Maria",
      waMessageId: "sim:1",
      contentType: "texto",
      body: "Oi, quero agendar",
    });
    expect(event).toEqual({
      kind: "message_received",
      phone: "+5584999990000",
      name: "Maria",
      waMessageId: "sim:1",
      contentType: "texto",
      body: "Oi, quero agendar",
      mediaUrl: null,
    });
  });

  it("mapeia mensagem no formato uazapi (jid vira telefone E164)", () => {
    const event = parseInboundEvent({
      event: "messages",
      message: {
        id: "3EB0538DA65",
        sender: "5584991234567@s.whatsapp.net",
        pushName: "João",
        type: "conversation",
        text: "Bom dia",
        fromMe: false,
      },
    });
    expect(event).toEqual({
      kind: "message_received",
      phone: "+5584991234567",
      name: "João",
      waMessageId: "3EB0538DA65",
      contentType: "texto",
      body: "Bom dia",
      mediaUrl: null,
    });
  });

  it("mensagem fromMe vira atualização de status, não entrada", () => {
    const event = parseInboundEvent({
      event: "messages",
      message: {
        id: "eco-1",
        fromMe: true,
        sender: "5584991234567@s.whatsapp.net",
      },
    });
    expect(event).toEqual({
      kind: "message_status",
      waMessageId: "eco-1",
      status: "entregue",
      errorCode: null,
    });
  });

  it("áudio é mapeado com o tipo certo", () => {
    const event = parseInboundEvent({
      event: "messages",
      message: {
        id: "audio-1",
        sender: "5584991234567@s.whatsapp.net",
        messageType: "audioMessage",
        fileURL: "https://exemplo/a.ogg",
        fromMe: false,
      },
    });
    expect(event).toMatchObject({
      kind: "message_received",
      contentType: "audio",
      mediaUrl: "https://exemplo/a.ogg",
    });
  });

  it("evento de conexão é normalizado", () => {
    expect(
      parseInboundEvent({ event: "connection", status: "connected" }),
    ).toEqual({ kind: "connection_update", status: "conectado" });
    expect(
      parseInboundEvent({ EventType: "connection", status: "disconnected" }),
    ).toEqual({ kind: "connection_update", status: "desconectado" });
  });

  it("payload desconhecido vira null, nunca exceção", () => {
    expect(parseInboundEvent(null)).toBeNull();
    expect(parseInboundEvent("lixo")).toBeNull();
    expect(parseInboundEvent({ qualquer: "coisa" })).toBeNull();
    expect(
      parseInboundEvent({ event: "messages", message: { fromMe: false } }),
    ).toBeNull();
  });
});
