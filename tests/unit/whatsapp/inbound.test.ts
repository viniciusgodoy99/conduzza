import { describe, expect, it } from "vitest";

import {
  extrairAnuncio,
  JANELA_DE_RESPOSTA_AUTOMATICA_MS,
  limiteParaRespostaDePessoa,
  normalizarMimetype,
  normalizarPlataforma,
  normalizarTipoDoAnuncio,
  parseInboundEvent,
  sanearNomeDeArquivo,
} from "@/lib/integrations/whatsapp/inbound";

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
      mediaFilename: null,
      mediaMimetype: null,
      quotedWaMessageId: null,
      anuncio: null,
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
      mediaFilename: null,
      mediaMimetype: null,
      quotedWaMessageId: null,
      anuncio: null,
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

  it("reação e edição feitas no celular da clínica não contam como resposta", () => {
    // Reagir com joinha ou corrigir uma mensagem já enviada não responde o
    // paciente: a conversa não pode sair de "Aguardando você" por isso.
    expect(
      parseInboundEvent({
        ...base,
        message: { ...base.message, fromMe: true, messageType: "reaction" },
      }),
    ).toBeNull();
    expect(
      parseInboundEvent({
        ...base,
        message: { ...base.message, fromMe: true, reaction: { text: "👍" } },
      }),
    ).toBeNull();
    expect(
      parseInboundEvent({
        ...base,
        message: {
          ...base.message,
          fromMe: true,
          messageType: "ProtocolMessage",
        },
      }),
    ).toBeNull();
    expect(
      parseInboundEvent({
        ...base,
        message: {
          ...base.message,
          fromMe: true,
          messageType: "EditedMessage",
        },
      }),
    ).toBeNull();
  });

  it("resposta do celular traz o horário de envio (ms ou segundos)", () => {
    const emMs = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        fromMe: true,
        messageTimestamp: 1_790_000_000_000,
      },
    });
    const emSegundos = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        fromMe: true,
        messageTimestamp: 1_790_000_000,
      },
    });
    const semHorario = parseInboundEvent({
      ...base,
      message: { ...base.message, fromMe: true },
    });
    const esperado = new Date(1_790_000_000_000).toISOString();
    expect(emMs).toMatchObject({
      kind: "clinic_device_reply",
      enviadaEm: esperado,
    });
    expect(emSegundos).toMatchObject({ enviadaEm: esperado });
    expect(semHorario).toMatchObject({ enviadaEm: null });
  });

  it("marcador de envio automático vira só caminho de chave, nunca texto", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        fromMe: true,
        text: "Olá! Estamos fora do horário.",
        content: { contextInfo: { isAutomated: true }, awayMessage: "texto" },
      },
    });
    const marcadores =
      evento && evento.kind === "clinic_device_reply"
        ? evento.marcadoresDeEnvioAutomatico
        : [];
    expect(marcadores).toEqual([
      "content.contextInfo.isAutomated=true",
      "content.awayMessage",
    ]);
    expect(marcadores.join(" ")).not.toContain("fora do horário");
    expect(marcadores.join(" ")).not.toContain("texto");
  });

  it("figurinha vira imagem, não texto com mídia", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        type: "media",
        messageType: "StickerMessage",
        mediaType: "sticker",
        content: {
          URL: "https://mmg.whatsapp.net/x.enc",
          mimetype: "image/webp",
        },
      },
    });
    expect(evento).toMatchObject({
      contentType: "imagem",
      mediaMimetype: "image/webp",
    });
  });

  it("documento traz nome e tipo do arquivo; legenda segue no body", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        type: "media",
        messageType: "DocumentMessage",
        mediaType: "document",
        text: "segue o pedido",
        content: {
          URL: "https://mmg.whatsapp.net/doc.enc",
          fileName: "pedido de exame.docx",
          title: "outro nome",
          mimetype:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      },
    });
    expect(evento).toMatchObject({
      contentType: "documento",
      body: "segue o pedido",
      mediaFilename: "pedido de exame.docx",
      mediaMimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("sem fileName, o título do documento vale como nome", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        messageType: "DocumentMessage",
        content: { title: "laudo.pdf", mimetype: "application/pdf" },
      },
    });
    expect(evento).toMatchObject({ mediaFilename: "laudo.pdf" });
  });

  it("título de prévia de link em texto comum não vira nome de arquivo", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        ...base.message,
        messageType: "ExtendedTextMessage",
        text: "olha esse site",
        content: { title: "Página qualquer" },
      },
    });
    expect(evento).toMatchObject({ contentType: "texto", mediaFilename: null });
  });
});

describe("saneamento do nome e do tipo do arquivo", () => {
  it("tira barras e caracteres de controle e corta em 200", () => {
    expect(sanearNomeDeArquivo("../../etc/passwd")).toBe("....etcpasswd");
    expect(sanearNomeDeArquivo("a\\b\u0000c\nd.pdf")).toBe("abcd.pdf");
    expect(sanearNomeDeArquivo("x".repeat(300))).toHaveLength(200);
    expect(sanearNomeDeArquivo("   ")).toBeNull();
    expect(sanearNomeDeArquivo(42)).toBeNull();
  });

  it("tira caractere de formatação invisível, inclusive o bidirecional", () => {
    // U+202E (RLO): 'laudo<RLO>fdp.exe' apareceria na tela como 'laudoexe.pdf'.
    expect(sanearNomeDeArquivo("laudo‮fdp.exe")).toBe("laudofdp.exe");
    expect(
      sanearNomeDeArquivo(
        "⁦exame⁩‎‏‪‫‬‭⁧⁨​﻿.pdf",
      ),
    ).toBe("exame.pdf");
    expect(sanearNomeDeArquivo("‮⁦‏")).toBeNull();
  });

  it("corta por caractere, sem partir emoji ao meio", () => {
    const nome = sanearNomeDeArquivo(`${"a".repeat(199)}😀😀`);
    expect(nome).toBe(`${"a".repeat(199)}😀`);
  });

  it("tipo fica só tipo/subtipo, minúsculo, sem parâmetros", () => {
    expect(normalizarMimetype("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizarMimetype("Application/PDF")).toBe("application/pdf");
    expect(normalizarMimetype("nada")).toBeNull();
    expect(normalizarMimetype("image/svg+xml")).toBe("image/svg+xml");
    expect(normalizarMimetype(null)).toBeNull();
  });
});

describe("resposta automática do app WhatsApp Business", () => {
  const agora = Date.parse("2026-09-24T12:00:00.000Z");

  it("a janela é de 8 segundos", () => {
    expect(JANELA_DE_RESPOSTA_AUTOMATICA_MS).toBe(8_000);
  });

  it("sem horário no payload, o limite é a chegada menos a janela", () => {
    expect(limiteParaRespostaDePessoa(null, agora)).toBe(
      "2026-09-24T11:59:52.000Z",
    );
  });

  it("com horário plausível, o limite parte do envio", () => {
    // Eco atrasado: saiu às 11:00 e chegou ao meio-dia. Uma mensagem que o
    // paciente mandou às 11:30 continua esperando resposta.
    expect(limiteParaRespostaDePessoa("2026-09-24T11:00:00.000Z", agora)).toBe(
      "2026-09-24T10:59:52.000Z",
    );
  });

  it("horário absurdo (futuro ou muito antigo) cai na hora da chegada", () => {
    expect(limiteParaRespostaDePessoa("2026-09-25T12:00:00.000Z", agora)).toBe(
      "2026-09-24T11:59:52.000Z",
    );
    expect(limiteParaRespostaDePessoa("2020-01-01T00:00:00.000Z", agora)).toBe(
      "2026-09-24T11:59:52.000Z",
    );
  });
});

// Captura do anuncio CTWA (estrutura do R1; o teste R0 foi dispensado pelo
// dono em 08/09/2026, entao a extracao precisa ser defensiva: cobre as formas
// das familias conhecidas sem saber qual delas a uazapi usa, se usar alguma).
describe("extração do anúncio CTWA", () => {
  const base = {
    EventType: "messages",
    token: "token-da-instancia",
  };

  it("forma da Cloud API: referral com ctwa_clid e source_id", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "AD-1",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "vi o anuncio de voces",
        referral: {
          source_url: "https://fb.me/abc",
          source_id: "120210000000000001",
          source_type: "ad",
          ctwa_clid: "CLID-OFICIAL-123",
        },
      },
    });
    expect(evento).toMatchObject({
      anuncio: {
        ctwaClid: "CLID-OFICIAL-123",
        adId: "120210000000000001",
        sourceUrl: "https://fb.me/abc",
      },
    });
  });

  it("forma Baileys/whatsmeow: contextInfo.externalAdReply aninhado", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "AD-2",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "quero saber o preco",
        content: {
          contextInfo: {
            externalAdReply: {
              title: "Clinica X",
              sourceId: "120210000000000002",
              sourceUrl: "https://fb.me/xyz",
              ctwaClid: "CLID-BAILEYS-456",
            },
          },
        },
      },
    });
    expect(evento).toMatchObject({
      anuncio: {
        ctwaClid: "CLID-BAILEYS-456",
        adId: "120210000000000002",
      },
    });
  });

  it("ctwaClid solto no topo da mensagem também é capturado", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "AD-3",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        ctwaClid: "CLID-TOPO-789",
      },
    });
    expect(evento).toMatchObject({
      anuncio: { ctwaClid: "CLID-TOPO-789", adId: null },
    });
  });

  it("mensagem comum não inventa anúncio", () => {
    // O oposto importa tanto quanto: source_id FORA de um objeto de referral
    // não pode virar id de anúncio, senão qualquer campo homônimo do provedor
    // contaminaria a atribuição.
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "SEM-AD",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "bom dia",
        content: { source_id: "isto-nao-e-anuncio" },
      },
    });
    expect(evento).toMatchObject({ anuncio: null });
  });

  it("referral vazio ou com campos vazios vira null, não objeto oco", () => {
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "AD-VAZIO",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        referral: { source_url: "", ctwa_clid: "" },
      },
    });
    expect(evento).toMatchObject({ anuncio: null });
  });
});

// Origem real do anuncio (D3, 04/10/2026): plataforma, tipo e os nomes de
// chave do diagnostico. A origem gravada e imutavel, entao o que o parser
// devolve aqui precisa estar certo: valor desconhecido vira null, a
// plataforma nunca e deduzida pela URL e post e reconhecido como post.
describe("anúncio: plataforma, tipo e chaves vistas", () => {
  const base = {
    EventType: "messages",
    token: "token-da-instancia",
  };

  /** Mensagem uazapi no formato whatsmeow, com contextInfo montavel. */
  function mensagemDeAnuncio(
    externalAdReply: Record<string, unknown>,
    extrasDoContexto: Record<string, unknown> = {},
  ) {
    return {
      ...base,
      message: {
        messageid: "AD-PLAT",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "Olá! Quero saber mais",
        content: {
          text: "Olá! Quero saber mais",
          contextInfo: {
            externalAdReply,
            ...extrasDoContexto,
          },
        },
      },
    };
  }

  function anuncioDe(payload: unknown) {
    const evento = parseInboundEvent(payload);
    if (evento?.kind !== "message_received") {
      throw new Error("esperava mensagem recebida");
    }
    return evento.anuncio;
  }

  it("normaliza a plataforma: só Facebook e Instagram, sem diferença de maiúscula", () => {
    expect(normalizarPlataforma("instagram")).toBe("Instagram");
    expect(normalizarPlataforma("INSTAGRAM")).toBe("Instagram");
    expect(normalizarPlataforma(" Facebook ")).toBe("Facebook");
    expect(normalizarPlataforma("facebook")).toBe("Facebook");
    expect(normalizarPlataforma("whatsapp")).toBeNull();
    expect(normalizarPlataforma("messenger")).toBeNull();
    expect(normalizarPlataforma("fb")).toBeNull();
    expect(normalizarPlataforma("")).toBeNull();
    expect(normalizarPlataforma(null)).toBeNull();
    expect(normalizarPlataforma(1)).toBeNull();
  });

  it("normaliza o tipo: ad e post; o resto vira null", () => {
    expect(normalizarTipoDoAnuncio("ad")).toBe("ad");
    expect(normalizarTipoDoAnuncio("AD")).toBe("ad");
    expect(normalizarTipoDoAnuncio(" post ")).toBe("post");
    expect(normalizarTipoDoAnuncio("reel")).toBeNull();
    expect(normalizarTipoDoAnuncio("CTWA")).toBeNull();
    expect(normalizarTipoDoAnuncio(undefined)).toBeNull();
  });

  it("plataforma pelo sourceApp do externalAdReply", () => {
    const anuncio = anuncioDe(
      mensagemDeAnuncio({
        sourceID: "120240624148610289",
        ctwaClid: "Af-CLIQUE-1",
        sourceType: "ad",
        sourceApp: "instagram",
      }),
    );
    expect(anuncio).toMatchObject({
      adId: "120240624148610289",
      ctwaClid: "Af-CLIQUE-1",
      plataforma: "Instagram",
      tipo: "ad",
    });
  });

  it("plataforma pelo entryPointConversionApp do contextInfo quando falta o sourceApp", () => {
    const anuncio = anuncioDe(
      mensagemDeAnuncio(
        { sourceID: "120240624148610289", ctwaClid: "Af-CLIQUE-2" },
        { entryPointConversionApp: "facebook", conversionSource: "FB_Ads" },
      ),
    );
    expect(anuncio?.plataforma).toBe("Facebook");
  });

  it("sourceApp desconhecido cai para o entryPointConversionApp", () => {
    const anuncio = anuncioDe(
      mensagemDeAnuncio(
        { sourceID: "120240624148610289", sourceApp: "messenger" },
        { entryPointConversionApp: "INSTAGRAM" },
      ),
    );
    expect(anuncio?.plataforma).toBe("Instagram");
  });

  it("sourceApp reconhecido vence o entryPointConversionApp", () => {
    const anuncio = anuncioDe(
      mensagemDeAnuncio(
        { sourceID: "120240624148610289", sourceApp: "facebook" },
        { entryPointConversionApp: "instagram" },
      ),
    );
    expect(anuncio?.plataforma).toBe("Facebook");
  });

  it("valor desconhecido nos dois campos vira null", () => {
    const anuncio = anuncioDe(
      mensagemDeAnuncio(
        { sourceID: "120240624148610289", sourceApp: "whatsapp" },
        { entryPointConversionApp: "whatsapp" },
      ),
    );
    expect(anuncio).not.toBeNull();
    expect(anuncio?.plataforma).toBeNull();
  });

  it("a plataforma nunca é deduzida pela URL", () => {
    // fb.me serve ao Facebook e ao Instagram; instagram.com no link tambem
    // nao prova onde o anuncio apareceu.
    const anuncioFb = anuncioDe(
      mensagemDeAnuncio({
        sourceID: "120240624148610289",
        sourceURL: "https://fb.me/abcXYZ",
      }),
    );
    const anuncioIg = anuncioDe(
      mensagemDeAnuncio({
        sourceID: "120240624148610289",
        sourceURL: "https://www.instagram.com/p/abc/",
      }),
    );
    expect(anuncioFb?.plataforma).toBeNull();
    expect(anuncioFb?.sourceUrl).toBe("https://fb.me/abcXYZ");
    expect(anuncioIg?.plataforma).toBeNull();
  });

  it("sourceType post é reconhecido (inclusive na forma da Cloud API)", () => {
    const whatsmeow = anuncioDe(
      mensagemDeAnuncio({ sourceID: "1789000000000001", sourceType: "post" }),
    );
    expect(whatsmeow?.tipo).toBe("post");

    const oficial = parseInboundEvent({
      ...base,
      message: {
        messageid: "AD-POST-OFICIAL",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        referral: { source_id: "1789000000000002", source_type: "POST" },
      },
    });
    expect(oficial).toMatchObject({ anuncio: { tipo: "post" } });
  });

  it("sem sourceType o tipo fica null; valor estranho também", () => {
    expect(
      anuncioDe(mensagemDeAnuncio({ sourceID: "120240624148610289" }))?.tipo,
    ).toBeNull();
    expect(
      anuncioDe(
        mensagemDeAnuncio({
          sourceID: "120240624148610289",
          sourceType: "story",
        }),
      )?.tipo,
    ).toBeNull();
  });

  /**
   * Mensagem com citacao NA ORDEM REAL do whatsmeow: o ContextInfo serializa
   * quotedMessage (campo 3) antes de externalAdReply (campo 28), e o
   * JSON.parse preserva essa ordem. Montada a mao, sem mensagemDeAnuncio
   * (que poe o externalAdReply primeiro e esconderia o problema).
   */
  function mensagemQueCitaUmPost(
    externalAdReplyProprio: Record<string, unknown> | null,
  ) {
    const citada = {
      extendedTextMessage: {
        text: "mensagem antiga",
        contextInfo: {
          externalAdReply: {
            sourceID: "1789000000000009",
            sourceType: "post",
            sourceApp: "facebook",
            ctwaClid: "Af-DA-CITADA",
          },
          entryPointConversionApp: "facebook",
        },
      },
    };
    return {
      ...base,
      message: {
        messageid: "AD-CITA",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        quoted: "ID-DA-CITADA",
        content: {
          text: "oi",
          contextInfo: {
            stanzaID: "ID-DA-CITADA",
            quotedMessage: citada,
            ...(externalAdReplyProprio
              ? { externalAdReply: externalAdReplyProprio }
              : {}),
          },
        },
      },
    };
  }

  it("plataforma e tipo vêm só do anúncio desta mensagem, nunca de uma mensagem citada (ordem real do whatsmeow)", () => {
    const payload = mensagemQueCitaUmPost({
      sourceID: "120240624148610289",
      ctwaClid: "Af-CLIQUE-3",
    });
    // Garante que o teste prova o que diz: a citada vem antes do anuncio.
    const chaves = Object.keys(payload.message.content.contextInfo);
    expect(chaves.indexOf("quotedMessage")).toBeLessThan(
      chaves.indexOf("externalAdReply"),
    );

    const anuncio = anuncioDe(payload);
    expect(anuncio).toMatchObject({
      adId: "120240624148610289",
      ctwaClid: "Af-CLIQUE-3",
      tipo: null,
      plataforma: null,
    });
    // Nem o nome de chave da citada entra no diagnostico como anuncio.
    expect(anuncio?.chavesVistas.anuncio).toEqual(["ctwaClid", "sourceID"]);
  });

  it("anúncio só na mensagem citada não é anúncio desta mensagem", () => {
    const evento = parseInboundEvent(mensagemQueCitaUmPost(null));
    expect(evento).toMatchObject({
      kind: "message_received",
      quotedWaMessageId: "ID-DA-CITADA",
      anuncio: null,
    });
  });

  it("a citação é ignorada em qualquer forma de chave (quotedMessage, quoted_message, quotedAd)", () => {
    const anuncio = extrairAnuncio({
      content: {
        contextInfo: {
          quoted_message: {
            contextInfo: {
              externalAdReply: { sourceID: "1789000000000010", sourceType: "post" },
            },
          },
          quotedAd: { ctwaClid: "Af-QUOTED-AD" },
          externalAdReply: {
            sourceID: "120240624148610289",
            sourceType: "ad",
            sourceApp: "instagram",
          },
        },
      },
    });
    expect(anuncio).toMatchObject({
      adId: "120240624148610289",
      ctwaClid: null,
      tipo: "ad",
      plataforma: "Instagram",
    });
  });

  it("a mensagem embrulhada (efêmera, visualização única) continua sendo lida", () => {
    // So a citacao e cortada; os involucros legitimos da propria mensagem
    // continuam sendo percorridos.
    const anuncio = extrairAnuncio({
      content: {
        ephemeralMessage: {
          message: {
            extendedTextMessage: {
              contextInfo: {
                externalAdReply: {
                  sourceID: "120240624148610289",
                  ctwaClid: "Af-EFEMERA",
                  sourceType: "ad",
                },
              },
            },
          },
        },
      },
    });
    expect(anuncio).toMatchObject({
      adId: "120240624148610289",
      ctwaClid: "Af-EFEMERA",
      tipo: "ad",
    });
  });

  it("plataforma ou tipo sozinhos não fazem um anúncio", () => {
    // Conversa organica aberta pelo botao do perfil do Instagram traz
    // entryPointConversionApp sem anuncio nenhum.
    const evento = parseInboundEvent({
      ...base,
      message: {
        messageid: "ORGANICO",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        content: {
          contextInfo: {
            entryPointConversionApp: "instagram",
            entryPointConversionSource: "global_search_new_chat",
            externalAdReply: { sourceApp: "instagram", sourceType: "ad" },
          },
        },
      },
    });
    expect(evento).toMatchObject({ anuncio: null });
  });

  it("ctwaClid solto ainda lê a plataforma do objeto onde estava", () => {
    const anuncio = anuncioDe({
      ...base,
      message: {
        messageid: "AD-SOLTO",
        sender_pn: "5584991234567@s.whatsapp.net",
        fromMe: false,
        text: "oi",
        content: {
          contextInfo: {
            ctwaClid: "Af-SOLTO",
            entryPointConversionApp: "instagram",
          },
        },
      },
    });
    expect(anuncio).toMatchObject({
      ctwaClid: "Af-SOLTO",
      adId: null,
      plataforma: "Instagram",
      tipo: null,
      chavesVistas: {
        anuncio: [],
        contexto: ["ctwaClid", "entryPointConversionApp"],
      },
    });
  });

  it("chaves vistas: só os nomes, em ordem, sem nenhum valor do anúncio", () => {
    const anuncio = anuncioDe(
      mensagemDeAnuncio(
        {
          title: "Agende já sua avaliação",
          body: "Texto do anúncio da clínica",
          sourceURL: "https://fb.me/abcXYZ",
          sourceID: "120240624148610289",
          ctwaClid: "Af-CLIQUE-SECRETO",
          sourceType: "ad",
          sourceApp: "instagram",
          // Chave com cara de texto livre nao entra no diagnostico.
          "chave com espaço": "x",
          "a.b": "y",
        },
        { entryPointConversionApp: "instagram", conversionSource: "FB_Ads" },
      ),
    );
    expect(anuncio?.chavesVistas).toEqual({
      anuncio: [
        "body",
        "ctwaClid",
        "sourceApp",
        "sourceID",
        "sourceType",
        "sourceURL",
        "title",
      ],
      contexto: [
        "conversionSource",
        "entryPointConversionApp",
        "externalAdReply",
      ],
    });
    const serializado = JSON.stringify(anuncio?.chavesVistas);
    for (const valor of [
      "Agende",
      "Texto do anúncio",
      "fb.me",
      "120240624148610289",
      "Af-CLIQUE-SECRETO",
      "FB_Ads",
      "instagram",
    ]) {
      expect(serializado).not.toContain(valor);
    }
  });

  it("chaves vistas têm teto por objeto", () => {
    const muitas: Record<string, unknown> = { sourceID: "120240624148610289" };
    for (let i = 0; i < 60; i++) {
      muitas[`campo${String(i).padStart(2, "0")}`] = "v";
    }
    const anuncio = extrairAnuncio({
      content: { contextInfo: { externalAdReply: muitas } },
    });
    expect(anuncio?.chavesVistas.anuncio).toHaveLength(40);
  });

  it("formato canônico aceita os campos novos e normaliza", () => {
    const evento = parseInboundEvent({
      kind: "message_received",
      phone: "+5584999990000",
      waMessageId: "sim:ad:1",
      body: "vi o anúncio",
      anuncio: {
        ctwaClid: "CLID-SIM",
        adId: "120240624148610289",
        plataforma: "instagram",
        tipo: "AD",
        chavesVistas: {
          anuncio: ["sourceID", "ctwaClid"],
          contexto: ["externalAdReply"],
        },
      },
    });
    expect(evento).toMatchObject({
      kind: "message_received",
      anuncio: {
        ctwaClid: "CLID-SIM",
        adId: "120240624148610289",
        adsetId: null,
        campaignId: null,
        sourceUrl: null,
        plataforma: "Instagram",
        tipo: "ad",
        chavesVistas: {
          anuncio: ["ctwaClid", "sourceID"],
          contexto: ["externalAdReply"],
        },
      },
    });
  });

  it("formato canônico com valor desconhecido não derruba a mensagem", () => {
    // Um enum no schema faria a mensagem do paciente ser ignorada por causa
    // de um campo de anuncio. Desconhecido vira null e a mensagem segue.
    const evento = parseInboundEvent({
      kind: "message_received",
      phone: "+5584999990000",
      waMessageId: "sim:ad:2",
      body: "oi",
      anuncio: {
        ctwaClid: "CLID-SIM-2",
        plataforma: "tiktok",
        tipo: "reel",
        chavesVistas: "isto não é lista",
      },
    });
    expect(evento).toMatchObject({
      kind: "message_received",
      body: "oi",
      anuncio: {
        ctwaClid: "CLID-SIM-2",
        plataforma: null,
        tipo: null,
        chavesVistas: { anuncio: [], contexto: [] },
      },
    });
  });
});
