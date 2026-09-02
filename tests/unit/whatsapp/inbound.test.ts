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
      quotedWaMessageId: null,
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
      quotedWaMessageId: null,
      instanceToken: "token-da-instancia",
    });
  });

  it("lê a citação que o paciente fez ao responder", () => {
    // O campo chegava desde sempre e era jogado fora, entao o "respondendo a"
    // do paciente sumia da conversa da clinica.
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "NOVA",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "pode ser as 15h",
        quoted: "ANTERIOR-DA-CLINICA",
      },
    });
    expect(evento).toMatchObject({
      waMessageId: "NOVA",
      quotedWaMessageId: "ANTERIOR-DA-CLINICA",
    });
  });

  it("citação vazia não vira busca por id vazio", () => {
    // O provedor manda `quoted: ""` quando nao ha citacao. Passar "" adiante
    // faria o banco procurar uma mensagem de id vazio em toda a clinica.
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "NOVA",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        quoted: "",
      },
    });
    expect(evento).toMatchObject({ quotedWaMessageId: null });
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

  // Este teste TROCOU DE LADO de proposito. Antes ele travava o descarte do
  // evento de apagamento, decidido quando o Atendimento ainda nao sabia apagar
  // mensagem. Agora o paciente pode apagar do celular dele, e continuar
  // descartando faria a clinica ler um texto que sumiu da tela de quem
  // escreveu, e responder a uma mensagem que, para ele, nao existe mais.
  it("mensagem apagada pelo paciente vira apagamento, não recibo de entrega", () => {
    expect(
      parseInboundEvent({
        EventType: "messages_update",
        event: { MessageIDs: ["X", "Y"], Type: "Deleted" },
      }),
    ).toEqual({
      kind: "message_deleted",
      waMessageIds: ["X", "Y"],
      instanceToken: null,
    });
  });

  it("estado desconhecido continua sendo ignorado", () => {
    expect(
      parseInboundEvent({
        EventType: "messages_update",
        event: { MessageIDs: ["X"], Type: "Starred" },
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

// O canal REAL: os testes de integração usam o provedor fake, que emite o
// formato canônico. Estes casos cobrem o que só existe no uazapi.
describe("canal real", () => {
  const base = {
    EventType: "messages",
    token: "tok-1",
    message: {
      messageid: "wa-1",
      chatid: "5584970000001@s.whatsapp.net",
      sender_pn: "5584970000001@s.whatsapp.net",
      senderName: "Paula",
    },
  };

  it("reação de joinha NÃO vira mensagem", () => {
    // Sem isto, o paciente que reage com joinha a QUALQUER mensagem da
    // clínica confirmava sozinho a consulta pendente: interpretarResposta
    // aceita joinha sozinho como "confirmar", e a clínica passava a contar
    // com quem nunca disse que vem.
    expect(
      parseInboundEvent({
        ...base,
        message: { ...base.message, messageType: "reaction", text: "👍" },
      }),
    ).toBeNull();
    expect(
      parseInboundEvent({
        ...base,
        message: { ...base.message, text: "👍", reaction: { text: "👍" } },
      }),
    ).toBeNull();
  });

  it("resposta de botão chega mesmo sem texto", () => {
    // O toque em "Confirmar" pode vir com text vazio e a escolha em outro
    // campo. Sem ler esses campos, o body ficava nulo, o interceptador
    // ignorava e a consulta ficava aguardando para sempre, com o paciente
    // convencido de que já tinha respondido.
    const evento = parseInboundEvent({
      ...base,
      message: { ...base.message, text: "", buttonOrListid: "confirmar" },
    });
    expect(evento?.kind).toBe("message_received");
    expect(evento && "body" in evento ? evento.body : null).toBe("confirmar");

    const cru = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        content: { selectedDisplayText: "Cancelar" },
      },
    });
    expect(cru && "body" in cru ? cru.body : null).toBe("Cancelar");
  });

  it("texto de verdade continua tendo precedência sobre a escolha de botão", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        text: "quero remarcar",
        buttonOrListid: "confirmar",
      },
    });
    expect(evento && "body" in evento ? evento.body : null).toBe(
      "quero remarcar",
    );
  });

  it("resposta pelo celular da clínica vira evento próprio, não é descartada", () => {
    // Antes isto era jogado fora igual ao eco da API, e a conversa continuava
    // marcada como esperando resposta: outra atendente respondia de novo e o
    // paciente recebia duas respostas para a mesma pergunta.
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        fromMe: true,
        sender_pn: "5584911112222@s.whatsapp.net",
        text: "Oi! O retorno fica em R$ 150.",
      },
    });
    expect(evento?.kind).toBe("clinic_device_reply");
    // O telefone é o do PACIENTE (chatid), não o da clínica.
    expect(evento && "phone" in evento ? evento.phone : null).toBe(
      "+5584970000001",
    );
  });

  it("eco da nossa própria API continua descartado", () => {
    expect(
      parseInboundEvent({
        ...base,
        message: { ...base.message, fromMe: true, wasSentByApi: true },
      }),
    ).toBeNull();
  });
});
