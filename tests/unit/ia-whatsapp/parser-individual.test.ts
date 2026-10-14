import { describe, expect, it } from "vitest";

import {
  conversaIndividual,
  parseInboundEvent,
} from "@/lib/integrations/whatsapp/inbound";

// E3: o parser marca se a mensagem recebida e de uma conversa INDIVIDUAL.
// Grupo, status, lista de transmissao e canal nunca viram turno da IA, mas
// continuam sendo ingeridos (o parser nao descarta nada por isso).

const BASE = {
  EventType: "messages",
  token: "token-da-instancia",
};

function recebida(campos: Record<string, unknown>) {
  return parseInboundEvent({
    ...BASE,
    message: {
      messageid: "WA-1",
      sender_pn: "5584991234567@s.whatsapp.net",
      fromMe: false,
      type: "text",
      messageType: "ExtendedTextMessage",
      text: "Bom dia",
      ...campos,
    },
  });
}

describe("individual", () => {
  it("chatid de telefone: individual", () => {
    const evento = recebida({ chatid: "5584991234567@s.whatsapp.net" });
    expect(evento?.kind).toBe("message_received");
    expect(evento && "individual" in evento && evento.individual).toBe(true);
  });

  it("@lid com sender_pn de telefone: individual; sem sender_pn de telefone: não", () => {
    expect(
      conversaIndividual({
        chatid: "138401042923712@lid",
        sender_pn: "5584991234567@s.whatsapp.net",
      }),
    ).toBe(true);
    expect(
      conversaIndividual({
        chatid: "138401042923712@lid",
        sender_pn: "138401042923712@lid",
      }),
    ).toBe(false);
    expect(conversaIndividual({ chatid: "138401042923712@lid" })).toBe(false);
  });

  it.each([
    ["grupo", "120363025555555555@g.us"],
    ["status", "status@broadcast"],
    ["lista de transmissão", "1234567890@broadcast"],
    ["canal", "120363199999999999@newsletter"],
  ])("%s: não individual, e a mensagem continua chegando", (_nome, chatid) => {
    const evento = recebida({ chatid });
    expect(evento?.kind).toBe("message_received");
    expect(evento && "individual" in evento && evento.individual).toBe(false);
  });

  it("sem chatid ou chatid estranho: não individual (falha fechada)", () => {
    expect(conversaIndividual({})).toBe(false);
    expect(conversaIndividual({ chatid: "" })).toBe(false);
    expect(conversaIndividual({ chatid: 5584991234567 })).toBe(false);
    expect(conversaIndividual({ chatid: "abc@s.whatsapp.net" })).toBe(false);
  });

  it("formato canônico: individual por padrão, falso só explícito", () => {
    const padrao = parseInboundEvent({
      kind: "message_received",
      phone: "+5584991234567",
      waMessageId: "wa-1",
      body: "Oi",
    });
    expect(padrao && "individual" in padrao && padrao.individual).toBe(true);
    const grupo = parseInboundEvent({
      kind: "message_received",
      phone: "+5584991234567",
      waMessageId: "wa-2",
      body: "Oi",
      individual: false,
    });
    expect(grupo && "individual" in grupo && grupo.individual).toBe(false);
  });
});
