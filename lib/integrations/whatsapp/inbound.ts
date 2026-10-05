import { z } from "zod";

import { ORIGEM_DO_RASTREIO } from "@/lib/integrations/whatsapp/rastreio";

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

/**
 * O anuncio de onde a mensagem veio, quando o canal entrega o referral.
 *
 * A forma exata que a uazapi usaria e DESCONHECIDA (o teste R0 do docs/07 foi
 * dispensado pelo dono em 08/09/2026: a estrutura nasce pronta e a producao e
 * o proprio teste). Por isso a extracao e defensiva: varre o objeto atras dos
 * nomes de campo que as familias conhecidas usam, em vez de apostar num
 * caminho fixo que talvez nunca exista.
 *
 * Campanha e conjunto NAO vem na mensagem em canal nenhum (uazapi, protocolo
 * do WhatsApp ou referral oficial): saem da Meta pelo id do anuncio
 * (meta_anuncio, por source_ad_id). Ver scratchpad/origem/critica.md.
 */
export type AnuncioDeOrigem = {
  ctwaClid: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  sourceUrl: string | null;
  /**
   * Onde o anuncio apareceu, quando o canal informa: sourceApp do referral
   * e, na falta dele, entryPointConversionApp do contextInfo ao lado. Valor
   * desconhecido (whatsapp, messenger, qualquer outro) vira null. NUNCA
   * deduzida pela URL: fb.me serve aos dois. Vai para source_medium.
   */
  plataforma: PlataformaDoAnuncio | null;
  /**
   * sourceType do referral: 'ad' e anuncio pago, 'post' e publicacao
   * (organica). null quando o canal nao diz. Post nao vira Trafego pago.
   */
  tipo: TipoDoAnuncio | null;
  /**
   * So os NOMES das chaves (nunca valores) do objeto do anuncio e do objeto
   * que o contem (o contextInfo, no whatsmeow). Diagnostico de quais campos o
   * canal entrega de fato; e o unico pedaco disto que vai para log.
   */
  chavesVistas: ChavesDoAnuncio;
};

export type PlataformaDoAnuncio = "Facebook" | "Instagram";
export type TipoDoAnuncio = "ad" | "post";
export type ChavesDoAnuncio = { anuncio: string[]; contexto: string[] };

/** Tipo de conteudo que a conversa grava (message.content_type), sem evento. */
export type TipoDeConteudo = "texto" | "audio" | "imagem" | "documento";

export type InboundEvent =
  | {
      kind: "message_received";
      phone: string;
      name: string | null;
      waMessageId: string;
      contentType: TipoDeConteudo;
      body: string | null;
      mediaUrl: string | null;
      /**
       * Nome do arquivo declarado pelo WhatsApp (so documento), saneado: ate
       * 200 caracteres, sem barra nem caractere de controle. A legenda
       * continua no body. Vai para message.media_filename.
       */
      mediaFilename: string | null;
      /** Tipo declarado (ex.: application/pdf), sem parametros. message.media_mimetype. */
      mediaMimetype: string | null;
      /**
       * Id NO WHATSAPP da mensagem que o paciente citou ao responder.
       * O campo chegava desde sempre e era descartado em silencio, entao o
       * "respondendo a" que o paciente fez sumia da conversa da clinica.
       */
      quotedWaMessageId: string | null;
      /**
       * Quando o paciente enviou (ISO), se o payload trouxe o horario
       * (messageTimestamp), lido como no eco do celular. A ingestao o repassa
       * a reclassificar_resposta_automatica, que o grava na linha
       * (message.enviada_no_aparelho_em): com o horario de envio dos dois
       * lados, o banco separa a resposta automatica do app WhatsApp Business
       * da fala de pessoa mesmo quando as mensagens chegam fora de ordem ou
       * em rajada (reconexao). A posicao no fio continua sendo a hora de
       * chegada. null quando nao veio.
       *
       * Opcional no tipo so para quem monta o evento a mao (testes e
       * ferramentas de desenvolvimento); o parser sempre preenche.
       */
      enviadaEm?: string | null;
      /** referral de anuncio CTWA, quando o canal o repassa; null no comum */
      anuncio: AnuncioDeOrigem | null;
      /** token da instancia que recebeu; confere contra o guardado */
      instanceToken: string | null;
    }
  | {
      /**
       * A clinica enviou pelo PROPRIO CELULAR pareado (celular, WhatsApp Web,
       * outro aparelho vinculado), fora do sistema. Nao e mensagem recebida
       * (nao entra como fala do paciente) e nao e eco do nosso envio (esse
       * vem com wasSentByApi ou com a nossa marca de rastreio e e
       * descartado): e alguem atendendo por fora, ou a resposta automatica
       * do app WhatsApp Business. Vira linha de SAIDA na conversa daquele
       * numero, marcada pelo_celular (RPC registrar_mensagem_do_celular),
       * para a conversa mostrar o que o paciente leu e sair da espera.
       */
      kind: "clinic_device_reply";
      /** Telefone do PACIENTE (o destino), nunca o da clinica. */
      phone: string;
      waMessageId: string;
      contentType: TipoDeConteudo;
      /**
       * O texto que a clinica escreveu no celular (ou a legenda), aparado;
       * null sem texto. E gravado na conversa (message.body) e alimenta o
       * termo-chave da jornada escrito pela clinica (pedido do dono em
       * 02/10/2026). NUNCA vai para log (regra 3.1).
       */
      body: string | null;
      /** Referencia do arquivo no provedor; o download e por job. */
      mediaUrl: string | null;
      /** Nome do arquivo (so documento), saneado como na entrada. */
      mediaFilename: string | null;
      /** Tipo declarado, sem parametros, como na entrada. */
      mediaMimetype: string | null;
      /** Id NO WHATSAPP da mensagem que a clinica citou ao responder. */
      quotedWaMessageId: string | null;
      /**
       * Quando a mensagem saiu do celular (ISO), se o payload trouxe o
       * horario. Serve para reconhecer a resposta AUTOMATICA do app WhatsApp
       * Business (saudacao, ausencia), que sai segundos depois da mensagem do
       * paciente, para decidir se a espera desce (as duas regras vivem na
       * RPC, que grava o horario em message.enviada_no_aparelho_em), para a
       * janela do termo-chave (ecoContaParaTermo) e para a nova tentativa da
       * saudacao para paciente novo (ecoEsperaPeloContatoNovo). A posicao no
       * fio NAO sai daqui: a linha nasce com a hora de chegada, como a da
       * ingestao. null quando nao veio: vale a hora da chegada.
       */
      enviadaEm: string | null;
      /**
       * CAMINHOS de chave (nunca valor de texto) que parecem marcar envio
       * automatico, para depuracao. Vazio no comum. Ver
       * marcadoresDeEnvioAutomatico.
       */
      marcadoresDeEnvioAutomatico: string[];
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
    mediaFilename: z.string().nullish(),
    mediaMimetype: z.string().nullish(),
    quotedWaMessageId: z.string().nullish(),
    // Horario de envio (texto de data, com fuso), como no clinic_device_reply.
    enviadaEm: z.string().nullish(),
    anuncio: z
      .object({
        ctwaClid: z.string().nullish(),
        adId: z.string().nullish(),
        adsetId: z.string().nullish(),
        campaignId: z.string().nullish(),
        sourceUrl: z.string().nullish(),
        // Texto livre de proposito: valor desconhecido vira null na
        // normalizacao. Um enum aqui derrubaria o evento inteiro (o webhook
        // ignoraria a mensagem do paciente por causa de um campo de anuncio).
        plataforma: z.string().nullish(),
        tipo: z.string().nullish(),
        chavesVistas: z.unknown().optional(),
      })
      .nullish(),
  }),
  // Mensagem enviada pelo celular da clinica, no formato canonico (simulador
  // e e2e): o mesmo conteudo da recebida, mais o horario de envio (ISO).
  z.object({
    kind: z.literal("clinic_device_reply"),
    phone: z.string().min(8),
    waMessageId: z.string().min(1),
    contentType: z
      .enum(["texto", "audio", "imagem", "documento"])
      .default("texto"),
    body: z.string().nullish(),
    mediaUrl: z.string().nullish(),
    mediaFilename: z.string().nullish(),
    mediaMimetype: z.string().nullish(),
    quotedWaMessageId: z.string().nullish(),
    enviadaEm: z.string().nullish(),
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

const SUFIXO_DE_TELEFONE = "@s.whatsapp.net";

/**
 * Telefone de um JID que E de telefone: "@s.whatsapp.net" ou sem sufixo.
 * Qualquer outro sufixo (@lid, @g.us, @broadcast, @newsletter) nao e
 * telefone: o numero do @lid e um identificador interno e, lido como
 * telefone, gravaria a mensagem num contato que nao existe.
 */
function telefoneDeJidDeTelefone(jid: unknown): string | null {
  if (typeof jid !== "string" || jid === "") {
    return null;
  }
  const arroba = jid.indexOf("@");
  if (arroba >= 0 && jid.slice(arroba) !== SUFIXO_DE_TELEFONE) {
    return null;
  }
  return phoneFromJid(jid);
}

/**
 * Para quem a clinica mandou a mensagem que saiu do celular (o PACIENTE). O
 * sender_pn de uma mensagem de saida e o numero da propria clinica, entao o
 * destino vem da conversa: o chatid. Quando o chatid e @lid, o telefone so
 * pode vir do retrato da conversa que acompanha o evento (`chat`, irmao de
 * `message`): wa_chatid, se for de telefone, ou phone. Sem nenhum deles,
 * null: melhor nao gravar do que gravar no contato errado.
 */
function destinoDaSaida(
  mensagem: Record<string, unknown>,
  chat: Record<string, unknown> | null,
): string | null {
  const chatid = typeof mensagem.chatid === "string" ? mensagem.chatid : "";
  if (!chatid.endsWith("@lid")) {
    return telefoneDeJidDeTelefone(chatid);
  }
  if (!chat) {
    return null;
  }
  const doChat = telefoneDeJidDeTelefone(chat.wa_chatid);
  if (doChat) {
    return doChat;
  }
  // chat.phone e o numero solto; com "@" seria outro JID, que nao vale aqui.
  return typeof chat.phone === "string" && !chat.phone.includes("@")
    ? phoneFromJid(chat.phone)
    : null;
}

function mapContentType(...candidatos: (string | undefined)[]): TipoDeConteudo {
  const valor = candidatos.filter(Boolean).join(" ").toLowerCase();
  if (valor.includes("audio") || valor.includes("ptt")) return "audio";
  // Figurinha (mediaType "sticker", messageType "StickerMessage") e uma
  // imagem webp. Antes caia em 'texto' com midia, e a bolha tentava toca-la
  // como video: a recepcao nao via o que o paciente mandou.
  if (valor.includes("image") || valor.includes("sticker")) return "imagem";
  if (valor.includes("document")) return "documento";
  return "texto";
}

// Barras (separador de pasta), barra invertida, caracteres de controle (Cc) e
// de formatacao Unicode (Cf, que inclui os bidirecionais U+200E, U+200F,
// U+202A a U+202E e U+2066 a U+2069). Sem tirar o Cf, 'laudo<RLO>fdp.exe'
// aparece na tela como 'laudoexe.pdf'. A tela e o download saneiam de novo na
// leitura (nomeSeguroDeArquivo); aqui e para o dado ja nascer limpo.
const CARACTERES_PROIBIDOS_NO_NOME = /[\p{Cc}\p{Cf}/\\]/gu;
const LIMITE_DO_NOME_DE_ARQUIVO = 200;

/**
 * Nome de arquivo vindo do WhatsApp, pronto para guardar e oferecer no
 * download: sem barra (nao vira caminho), sem caractere de controle (nao
 * quebra cabecalho), sem caractere de formatacao invisivel (nao inverte o
 * texto para fingir outra extensao), ate 200 caracteres. Vazio ou nao texto
 * vira null.
 */
export function sanearNomeDeArquivo(bruto: unknown): string | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const limpo = bruto.replace(CARACTERES_PROIBIDOS_NO_NOME, "").trim();
  if (limpo === "") {
    return null;
  }
  // Array.from corta por caractere, nunca no meio de um emoji.
  const cortado = Array.from(limpo)
    .slice(0, LIMITE_DO_NOME_DE_ARQUIVO)
    .join("")
    .trim();
  return cortado === "" ? null : cortado;
}

/**
 * Tipo de arquivo declarado pelo WhatsApp: so "tipo/subtipo", minusculo e sem
 * parametros ("audio/ogg; codecs=opus" vira "audio/ogg"). Fora disso, null.
 */
export function normalizarMimetype(bruto: unknown): string | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const tipo = (bruto.split(";")[0] ?? "").trim().toLowerCase();
  if (
    tipo.length > 100 ||
    !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(tipo)
  ) {
    return null;
  }
  return tipo;
}

/**
 * Horario de envio que o payload traz (messageTimestamp), em ISO. O uazapi
 * manda milissegundos; o whatsmeow cru, segundos. Numero abaixo de 1e12 e
 * tratado como segundos. Ausente ou absurdo vira null.
 */
function instanteDoPayload(bruto: unknown): string | null {
  const numero =
    typeof bruto === "number"
      ? bruto
      : typeof bruto === "string" && /^\d+$/.test(bruto)
        ? Number(bruto)
        : NaN;
  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }
  const ms = numero < 1e12 ? numero * 1000 : numero;
  const data = new Date(ms);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/**
 * Horario de envio do formato canonico (texto de data, com fuso). Vira ISO
 * em UTC; texto que nao e data vira null, como o horario ausente.
 */
function instanteCanonico(bruto: string | null | undefined): string | null {
  if (!bruto) {
    return null;
  }
  const ms = Date.parse(bruto);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// Nomes de chave que PODEM marcar envio automatico do app WhatsApp Business.
// Ninguem confirmou ainda se o uazapi traz algum (a captura com a ausencia
// ligada esta pendente); por isso isto so alimenta log de depuracao.
const CHAVE_DE_ENVIO_AUTOMATICO =
  /automat|auto_?reply|auto_?resp|greeting|away|saudac|ausenc|is_?bot|from_?bot|biz_?bot/i;

/**
 * Varre a mensagem crua atras de chaves que parecam marcar envio automatico.
 * Devolve SO o caminho da chave (e o valor quando e booleano), nunca texto:
 * isto vai para log, e log nao carrega dado de paciente.
 */
export function marcadoresDeEnvioAutomatico(
  mensagem: Record<string, unknown>,
): string[] {
  const achados: string[] = [];
  const visitar = (
    no: Record<string, unknown>,
    caminho: string,
    profundidade: number,
  ): void => {
    if (profundidade > 4 || achados.length >= 10) {
      return;
    }
    for (const [chave, valor] of Object.entries(no)) {
      const aqui = caminho ? `${caminho}.${chave}` : chave;
      if (CHAVE_DE_ENVIO_AUTOMATICO.test(chave) && aqui.length <= 80) {
        achados.push(typeof valor === "boolean" ? `${aqui}=${valor}` : aqui);
        if (achados.length >= 10) {
          return;
        }
      }
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        visitar(valor as Record<string, unknown>, aqui, profundidade + 1);
      }
    }
  };
  visitar(mensagem, "", 0);
  return achados;
}

/**
 * A resposta automatica do app WhatsApp Business (saudacao, ausencia) sai do
 * celular pareado poucos segundos depois da mensagem do paciente. Uma pessoa
 * nao le e responde em menos de 8 segundos. Por isso a mensagem do celular
 * que sai DENTRO desta janela depois da ultima mensagem do paciente e tratada
 * como automatica: grava como 'sistema' e NAO derruba o "Aguardando voce".
 *
 * A regra vive no banco, em dois lados:
 *  - registrar_mensagem_do_celular: com o horario de envio do eco e o da
 *    ultima mensagem do paciente (message.enviada_no_aparelho_em), decide
 *    pelos HORARIOS DE ENVIO (o paciente enviou de 8 s antes a 2 s depois do
 *    eco); sem um deles, pela chegada (last_inbound_at de 8 s antes a 10 s
 *    depois do envio do eco, ou de now() sem ele);
 *  - reclassificar_resposta_automatica (a ingestao chama, com o enviadaEm do
 *    paciente), quando o eco grava antes da mensagem do paciente: eco de
 *    pessoa que chegou de 8 s antes a 2 s depois dela e, com os dois
 *    horarios de envio, saiu de 2 s antes a 8 s depois do paciente.
 * Esta constante e o espelho dos 8 s aqui, para documentacao e teste: mudar
 * uma exige mudar a outra.
 */
export const JANELA_DE_RESPOSTA_AUTOMATICA_MS = 8_000;

/**
 * Ate quanto tempo depois de sair do celular o eco ainda conta para o
 * termo-chave da jornada. O eco de verdade chega em segundos; o que passa
 * disso e eco atrasado, reentregue ou a sincronia de historico do aparelho
 * reconectando, e mover lead por mensagem velha poderia desfazer o que uma
 * pessoa ja arrumou a mao.
 */
export const JANELA_DO_ECO_PARA_TERMO_MS = 2 * 60 * 1000;

/**
 * O eco do celular pode andar o lead por termo-chave? Primeiro filtro, pelo
 * horario de envio do payload: so conta o eco que saiu do celular dentro da
 * janela (ate 1 minuto no futuro, pela folga de relogio, a mesma da RPC que
 * grava a mensagem). Sem horario no payload nao da para provar que e novo,
 * entao nao move.
 *
 * A janela sozinha NAO separa o eco novo da reentrega: a reentrega dentro da
 * janela moveria de novo o lead que alguem voltou a mao. A garantia de
 * "nunca reentrega" continua sendo a marca por wa_message_id no banco
 * (marcar_eco_para_termo, chamada pela rota do webhook depois deste filtro),
 * como antes de a mensagem do celular virar linha na conversa: o termo-chave
 * ficou como estava (decisao de 05/10/2026), sem depender do "inserted" da
 * gravacao.
 */
export function ecoContaParaTermo(
  enviadaEm: string | null,
  agoraMs: number,
): boolean {
  const enviadaMs = enviadaEm ? Date.parse(enviadaEm) : NaN;
  return (
    Number.isFinite(enviadaMs) &&
    enviadaMs >= agoraMs - JANELA_DO_ECO_PARA_TERMO_MS &&
    enviadaMs <= agoraMs + 60 * 1000
  );
}

/**
 * Ate quanto tempo depois de sair do celular o eco de contato desconhecido
 * ainda espera a ingestao criar o contato (a saudacao do app WhatsApp
 * Business para paciente novo, ver a rota do webhook). A saudacao sai 1 ou
 * 2 s depois da primeira mensagem do paciente e o eco chega em segundos;
 * passou disso, o contato nao vai nascer na proxima espera.
 */
export const JANELA_DO_ECO_PARA_ESPERAR_CONTATO_MS = 60 * 1000;

/**
 * O eco do celular que voltou contato_desconhecido vale uma nova tentativa?
 * So com horario de envio no payload e dentro da janela (ate 1 minuto no
 * futuro, pela folga de relogio, a mesma da RPC). Sem horario nao da para
 * saber se e a saudacao que acabou de sair; e o eco velho (reentrega,
 * sincronia de historico) ou a mensagem para quem nao e paciente nao podem
 * segurar o webhook a toa.
 */
export function ecoEsperaPeloContatoNovo(
  enviadaEm: string | null,
  agoraMs: number,
): boolean {
  const enviadaMs = enviadaEm ? Date.parse(enviadaEm) : NaN;
  return (
    Number.isFinite(enviadaMs) &&
    enviadaMs >= agoraMs - JANELA_DO_ECO_PARA_ESPERAR_CONTATO_MS &&
    enviadaMs <= agoraMs + 60 * 1000
  );
}

function mapConnectionStatus(
  raw: string | undefined,
): "desconectado" | "aguardando_qr" | "conectando" | "conectado" {
  const valor = (raw ?? "").toLowerCase();
  if (valor === "connected") return "conectado";
  if (valor === "connecting") return "conectando";
  return "desconectado";
}

// Nomes de campo que carregam o id do clique, nas familias conhecidas:
// Cloud API oficial usa referral.ctwa_clid; Baileys/whatsmeow usam
// contextInfo.externalAdReply e variantes camelCase.
const CHAVE_CTWA = /^ctwa_?clid$/i;
// Objetos que embrulham os dados do anuncio. So DENTRO deles um source_id
// significa "id do anuncio"; fora, source_id pode significar qualquer coisa.
const CHAVE_REFERRAL = /^(referral|external_?ad_?reply)$/i;
// Plataforma e tipo (whatsmeow: sourceApp e sourceType no externalAdReply,
// entryPointConversionApp no contextInfo; Cloud API: source_type).
const CHAVE_APP_DO_ANUNCIO = /^source_?app$/i;
const CHAVE_TIPO_DO_ANUNCIO = /^source_?type$/i;
const CHAVE_APP_DE_ENTRADA = /^entry_?point_?conversion_?app$/i;
// O anuncio de uma mensagem citada nao e o desta mensagem: a varredura nunca
// desce nela. No whatsmeow o ContextInfo serializa quotedMessage (campo 3)
// ANTES de externalAdReply (campo 28), e a varredura desce em profundidade:
// sem este corte, o referral da citada seria o "primeiro" e decidiria tipo e
// plataforma (origem imutavel). Pega quotedMessage, quotedAd, quotedQuestion,
// quotedResponse e o `quoted` do uazapi (que e so o id, um texto).
const CHAVE_DE_CITACAO = /^quoted/i;

// Chave que entra no diagnostico: so identificador simples. Nome de campo de
// protocolo e sempre assim; qualquer outra coisa (que poderia, em tese,
// carregar texto) fica de fora em vez de ir para o log.
const CHAVE_SEGURA_PARA_LOG = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LIMITE_DE_CHAVES_POR_OBJETO = 40;

function stringOuNull(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/**
 * Plataforma do anuncio a partir do valor cru do canal. So "facebook" e
 * "instagram" (sem diferenca de maiuscula) sao reconhecidos; whatsapp,
 * messenger, vazio ou qualquer outro valor viram null. Origem e imutavel:
 * gravar uma plataforma errada seria para sempre.
 */
export function normalizarPlataforma(
  bruto: unknown,
): PlataformaDoAnuncio | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const valor = bruto.trim().toLowerCase();
  if (valor === "facebook") return "Facebook";
  if (valor === "instagram") return "Instagram";
  return null;
}

/** Tipo do anuncio: "ad" ou "post" (sem diferenca de maiuscula); senao null. */
export function normalizarTipoDoAnuncio(bruto: unknown): TipoDoAnuncio | null {
  if (typeof bruto !== "string") {
    return null;
  }
  const valor = bruto.trim().toLowerCase();
  if (valor === "ad") return "ad";
  if (valor === "post") return "post";
  return null;
}

/** Nomes de chave seguros para log, sem repeticao, em ordem alfabetica. */
function nomesDeChaveSeguros(nomes: readonly unknown[]): string[] {
  const vistos = new Set<string>();
  for (const nome of nomes) {
    if (typeof nome === "string" && CHAVE_SEGURA_PARA_LOG.test(nome)) {
      vistos.add(nome);
    }
  }
  return [...vistos].sort().slice(0, LIMITE_DE_CHAVES_POR_OBJETO);
}

/**
 * Chaves vistas vindas do formato canonico (simulador): so listas de nomes,
 * saneadas igual as do uazapi. Qualquer outra forma vira listas vazias.
 */
function chavesVistasCanonicas(bruto: unknown): ChavesDoAnuncio {
  const objeto =
    bruto && typeof bruto === "object" && !Array.isArray(bruto)
      ? (bruto as Record<string, unknown>)
      : {};
  const lista = (valor: unknown): string[] =>
    Array.isArray(valor) ? nomesDeChaveSeguros(valor) : [];
  return { anuncio: lista(objeto.anuncio), contexto: lista(objeto.contexto) };
}

/** Primeiro texto nao vazio entre as chaves que casam com o padrao. */
function textoPorPadrao(
  obj: Record<string, unknown>,
  padrao: RegExp,
): string | null {
  for (const [chave, valor] of Object.entries(obj)) {
    if (padrao.test(chave)) {
      const texto = stringOuNull(valor);
      if (texto) return texto;
    }
  }
  return null;
}

/** Le os campos de anuncio de um objeto referral/externalAdReply. */
function lerReferral(
  obj: Record<string, unknown>,
): Omit<AnuncioDeOrigem, "chavesVistas"> {
  const pega = (...nomes: string[]): string | null => {
    for (const nome of nomes) {
      const v = stringOuNull(obj[nome]);
      if (v) return v;
    }
    return null;
  };
  return {
    ctwaClid: pega("ctwa_clid", "ctwaClid", "ctwaclid", "CtwaClid"),
    adId: pega("source_id", "sourceId", "sourceID", "ad_id", "adId"),
    adsetId: pega("adset_id", "adsetId"),
    campaignId: pega("campaign_id", "campaignId"),
    sourceUrl: pega("source_url", "sourceUrl", "sourceURL"),
    plataforma: normalizarPlataforma(textoPorPadrao(obj, CHAVE_APP_DO_ANUNCIO)),
    tipo: normalizarTipoDoAnuncio(textoPorPadrao(obj, CHAVE_TIPO_DO_ANUNCIO)),
  };
}

/**
 * Varre a mensagem crua atras de qualquer vestigio de anuncio CTWA.
 *
 * Profundidade limitada e sem descer em arrays: o objeto do whatsmeow e fundo,
 * mas o referral mora perto da raiz ou dentro de content/contextInfo. Melhor
 * esforco por definicao: achar nada devolve null e a ingestao segue igual.
 *
 * O "contexto" e o objeto que contem o referral (no whatsmeow, o
 * contextInfo): dele sai a segunda opcao da plataforma
 * (entryPointConversionApp) e os nomes de chave do diagnostico. Plataforma ou
 * tipo sozinhos nao fazem um anuncio: sem clique, anuncio, conjunto ou
 * campanha, devolve null. A mensagem citada fica de fora da varredura: se so
 * ela tem anuncio, esta mensagem nao tem.
 */
export function extrairAnuncio(
  mensagem: Record<string, unknown>,
): AnuncioDeOrigem | null {
  const achado: AnuncioDeOrigem = {
    ctwaClid: null,
    adId: null,
    adsetId: null,
    campaignId: null,
    sourceUrl: null,
    plataforma: null,
    tipo: null,
    chavesVistas: { anuncio: [], contexto: [] },
  };
  // Onde o anuncio foi achado: o objeto do primeiro referral e quem o contem;
  // sem referral, o objeto que tinha o ctwaClid solto. (Num objeto, e nao em
  // variaveis soltas, porque quem preenche e o visitante.)
  const onde: {
    referral: Record<string, unknown> | null;
    contexto: Record<string, unknown> | null;
    doClidSolto: Record<string, unknown> | null;
  } = { referral: null, contexto: null, doClidSolto: null };

  const visitar = (no: Record<string, unknown>, profundidade: number): void => {
    if (profundidade > 5) {
      return;
    }
    for (const [chave, valor] of Object.entries(no)) {
      if (CHAVE_DE_CITACAO.test(chave)) {
        continue;
      }
      if (CHAVE_CTWA.test(chave)) {
        const clid = stringOuNull(valor);
        if (clid && achado.ctwaClid === null) {
          achado.ctwaClid = clid;
          onde.doClidSolto ??= no;
        }
        continue;
      }
      if (
        CHAVE_REFERRAL.test(chave) &&
        valor &&
        typeof valor === "object" &&
        !Array.isArray(valor)
      ) {
        const objeto = valor as Record<string, unknown>;
        const lido = lerReferral(objeto);
        achado.ctwaClid ??= lido.ctwaClid;
        achado.adId ??= lido.adId;
        achado.adsetId ??= lido.adsetId;
        achado.campaignId ??= lido.campaignId;
        achado.sourceUrl ??= lido.sourceUrl;
        // Plataforma e tipo decidem a origem (imutavel): vem SO do primeiro
        // referral e do contexto dele, nunca misturados com um segundo
        // referral. A mensagem citada nem chega aqui (CHAVE_DE_CITACAO): a
        // ordem das chaves nao decide de qual mensagem e o anuncio.
        if (onde.referral === null) {
          onde.referral = objeto;
          onde.contexto = no;
          achado.plataforma =
            lido.plataforma ??
            normalizarPlataforma(textoPorPadrao(no, CHAVE_APP_DE_ENTRADA));
          achado.tipo = lido.tipo;
        }
        continue;
      }
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        visitar(valor as Record<string, unknown>, profundidade + 1);
      }
    }
  };
  visitar(mensagem, 0);

  const temAlgo =
    achado.ctwaClid !== null ||
    achado.adId !== null ||
    achado.campaignId !== null ||
    achado.adsetId !== null;
  if (!temAlgo) {
    return null;
  }

  const { referral } = onde;
  const ondeAchou = onde.contexto ?? onde.doClidSolto;
  if (referral === null && ondeAchou !== null) {
    // ctwaClid solto, sem referral: o objeto que o tinha ainda pode dizer a
    // plataforma pelo entryPointConversionApp.
    achado.plataforma = normalizarPlataforma(
      textoPorPadrao(ondeAchou, CHAVE_APP_DE_ENTRADA),
    );
  }
  achado.chavesVistas = {
    anuncio: referral ? nomesDeChaveSeguros(Object.keys(referral)) : [],
    contexto: ondeAchou ? nomesDeChaveSeguros(Object.keys(ondeAchou)) : [],
  };
  return achado;
}

type ConteudoDaMensagem = {
  contentType: TipoDeConteudo;
  mediaUrl: string | null;
  mediaFilename: string | null;
  mediaMimetype: string | null;
  quotedWaMessageId: string | null;
};

/**
 * Tipo, arquivo e citacao de uma mensagem do uazapi. O MESMO para a recebida
 * e para a que saiu do celular da clinica: as duas viram linha de message, e
 * a bolha, o download e a citacao leem as mesmas colunas.
 */
function conteudoDaMensagem(
  mensagem: Record<string, unknown>,
): ConteudoDaMensagem {
  const conteudo = (mensagem.content ?? {}) as Record<string, unknown>;
  const contentType = mapContentType(
    mensagem.mediaType as string | undefined,
    mensagem.messageType as string | undefined,
    mensagem.type as string | undefined,
  );
  return {
    contentType,
    // A URL vem criptografada (.enc): baixar exige POST /message/download.
    // Guardamos a referencia; o download e feito pelo job baixar_midia.
    mediaUrl: (conteudo.URL as string | undefined) ?? null,
    // Nome do arquivo so de DOCUMENTO: em texto com previa de link, `title`
    // e o titulo da pagina, nao nome de arquivo. fileName primeiro; title e
    // o que alguns clientes mandam no lugar dele.
    mediaFilename:
      contentType === "documento"
        ? (sanearNomeDeArquivo(conteudo.fileName) ??
          sanearNomeDeArquivo(conteudo.title))
        : null,
    mediaMimetype: normalizarMimetype(conteudo.mimetype),
    // Na especificacao, `quoted` e simplesmente o id da mensagem citada.
    // Vem string vazia quando nao ha citacao, e "" nao pode virar busca.
    quotedWaMessageId: (mensagem.quoted as string | undefined) || null,
  };
}

/**
 * ACOES feitas no celular da clinica que chegam como evento "messages" com
 * fromMe, mas nao sao mensagem nova, em minusculas como em tipoBruto:
 *  - pininchatmessage: fixar ou desafixar uma mensagem (/message/pin);
 *  - keepinchatmessage: manter uma mensagem na conversa temporaria;
 *  - pollupdatemessage: voto em enquete;
 *  - eventresponsemessage: resposta a convite de evento (escolha em `vote`);
 *  - call: registro de ligacao (messageType "call").
 * PinInChatMessage, EventResponseMessage e "call" estao na especificacao do
 * uazapi; KeepInChatMessage e PollUpdateMessage sao os nomes do whatsmeow,
 * que o uazapi repassa como messageType, sem exemplo na especificacao. O
 * "call" so vale como palavra inteira (inicio do tipo).
 */
const TIPO_DE_ACAO_NO_CELULAR =
  /pininchat|keepinchat|pollupdate|eventresponse|\bcall/;

/**
 * Mensagem de saida sem texto e sem arquivo que E resposta ao paciente:
 * localizacao (LocationMessage, LiveLocationMessage) e cartao de contato
 * (ContactMessage, ContactsArrayMessage), em minusculas como em tipoBruto.
 */
const TIPO_SEM_TEXTO_QUE_E_RESPOSTA = /location|contact/;

export function parseInboundEvent(payload: unknown): InboundEvent | null {
  const canonical = canonicalSchema.safeParse(payload);
  if (canonical.success) {
    const evento = canonical.data;
    if (evento.kind === "clinic_device_reply") {
      return {
        kind: "clinic_device_reply",
        phone: evento.phone,
        waMessageId: evento.waMessageId,
        contentType: evento.contentType,
        body: evento.body?.trim() || null,
        mediaUrl: evento.mediaUrl ?? null,
        mediaFilename: sanearNomeDeArquivo(evento.mediaFilename),
        mediaMimetype: normalizarMimetype(evento.mediaMimetype),
        quotedWaMessageId: evento.quotedWaMessageId || null,
        enviadaEm: instanteCanonico(evento.enviadaEm),
        marcadoresDeEnvioAutomatico: [],
        instanceToken: null,
      };
    }
    if (evento.kind === "message_received") {
      return {
        kind: "message_received",
        phone: evento.phone,
        name: evento.name ?? null,
        waMessageId: evento.waMessageId,
        contentType: evento.contentType,
        body: evento.body ?? null,
        mediaUrl: evento.mediaUrl ?? null,
        mediaFilename: sanearNomeDeArquivo(evento.mediaFilename),
        mediaMimetype: normalizarMimetype(evento.mediaMimetype),
        quotedWaMessageId: evento.quotedWaMessageId ?? null,
        enviadaEm: instanteCanonico(evento.enviadaEm),
        anuncio: evento.anuncio
          ? {
              ctwaClid: evento.anuncio.ctwaClid ?? null,
              adId: evento.anuncio.adId ?? null,
              adsetId: evento.anuncio.adsetId ?? null,
              campaignId: evento.anuncio.campaignId ?? null,
              sourceUrl: evento.anuncio.sourceUrl ?? null,
              plataforma: normalizarPlataforma(evento.anuncio.plataforma),
              tipo: normalizarTipoDoAnuncio(evento.anuncio.tipo),
              chavesVistas: chavesVistasCanonicas(evento.anuncio.chavesVistas),
            }
          : null,
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
    // Retrato da conversa que pode acompanhar o evento (irmao de `message`).
    const chat =
      dados.chat && typeof dados.chat === "object" && !Array.isArray(dados.chat)
        ? (dados.chat as Record<string, unknown>)
        : null;
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
    // REACAO (o joinha colocado EM CIMA de uma mensagem) nao e resposta: ela
    // nao diz a que pergunta se refere e o WhatsApp a entrega como mensagem
    // comum, com o emoji no texto. Do lado do paciente, sem este descarte, o
    // joinha em QUALQUER mensagem da clinica (inclusive uma resposta de preco)
    // confirmava sozinho a consulta pendente, porque interpretarResposta
    // aceita joinha sozinho como "confirmar". Do lado da clinica, a reacao
    // feita no celular nao responde o paciente e nao pode tirar a conversa de
    // "Aguardando voce".
    const tipoBruto = [
      mensagem.messageType as string | undefined,
      mensagem.type as string | undefined,
      mensagem.mediaType as string | undefined,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const ehReacao =
      tipoBruto.includes("reaction") || Boolean(mensagem.reaction);

    // Mensagem SAINDO do numero da clinica sem ter passado pela API: alguem
    // respondeu pelo celular pareado (ou outro aparelho vinculado). Antes isto
    // era descartado igual ao eco, e a conversa continuava marcada como
    // esperando resposta: outra atendente abria o Inbox, via a pergunta "sem
    // resposta" e respondia de novo. Depois passou a derrubar a espera, mas o
    // conteudo continuava jogado fora, e a clinica nao via na conversa o que
    // o paciente tinha lido. Agora o conteudo vai junto e a rota grava a
    // mensagem na conversa daquele numero.
    //
    // Para mensagem de saida, o telefone do PACIENTE vem da conversa (o
    // sender_pn e o numero da propria clinica): destinoDaSaida.
    if (mensagem.fromMe === true) {
      // Eco de envio NOSSO que escapou do wasSentByApi: todo envio do
      // sistema leva a nossa marca de rastreio (track_source), e o provedor a
      // devolve no evento. Sem este corte a mesma mensagem apareceria duas
      // vezes na conversa (a do sistema e a "do celular").
      if (mensagem.track_source === ORIGEM_DO_RASTREIO) {
        return null;
      }
      // Mensagem de PROTOCOLO (edicao ou apagamento de uma mensagem ja
      // enviada) nao e mensagem nova: a clinica so corrigiu ou retirou o que
      // tinha dito. Reacao tambem nao. Nenhuma das duas vira linha nem tira a
      // conversa da espera. Pela especificacao, `edited` e TEXTO (o
      // historico de edicoes, "" quando nao houve): a comparacao antiga com
      // true nunca batia, e a edicao feita no celular passaria como mensagem
      // nova. O true continua aceito por defesa.
      const editada =
        mensagem.edited === true ||
        (typeof mensagem.edited === "string" && mensagem.edited.trim() !== "");
      const ehProtocolo =
        /protocol|edit|revoke|delete/.test(tipoBruto) ||
        mensagem.isEdit === true ||
        editada;
      // ACAO no celular (fixar, manter, votar, responder evento, ligar):
      // tambem nao responde o paciente. Antes virava linha "Pelo WhatsApp"
      // vazia e tirava a conversa de "Aguardando voce".
      const ehAcao = TIPO_DE_ACAO_NO_CELULAR.test(tipoBruto);
      if (ehReacao || ehProtocolo || ehAcao) {
        return null;
      }
      const conteudo = conteudoDaMensagem(mensagem);
      // Sem escolha de botao: a clinica nao "toca" botao no proprio envio.
      const body = (mensagem.text as string | undefined)?.trim() || null;
      // Defesa para a acao de tipo que ainda nao conhecemos: "texto" sem
      // texto e sem referencia de arquivo nao tem o que mostrar, e gravado
      // viraria bolha vazia que derruba a espera. Imagem, audio e documento
      // sem URL continuam: o worker baixa pelo wa_message_id, nao pela URL.
      // Localizacao e cartao de contato tambem continuam: sao resposta de
      // verdade ao paciente (antes desta frente ja tiravam a conversa da
      // espera), e a bolha fica como a do paciente que manda localizacao.
      if (
        conteudo.contentType === "texto" &&
        !body &&
        !conteudo.mediaUrl &&
        !TIPO_SEM_TEXTO_QUE_E_RESPOSTA.test(tipoBruto)
      ) {
        return null;
      }
      const destino = destinoDaSaida(mensagem, chat);
      if (!destino) {
        return null;
      }
      return {
        kind: "clinic_device_reply",
        phone: destino,
        waMessageId,
        ...conteudo,
        body,
        enviadaEm: instanteDoPayload(mensagem.messageTimestamp),
        marcadoresDeEnvioAutomatico: marcadoresDeEnvioAutomatico(mensagem),
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
    if (ehReacao) {
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

    const {
      contentType,
      mediaUrl,
      mediaFilename,
      mediaMimetype,
      quotedWaMessageId,
    } = conteudoDaMensagem(mensagem);

    return {
      kind: "message_received",
      phone,
      name: (mensagem.senderName as string | undefined) ?? null,
      waMessageId,
      contentType,
      body:
        (mensagem.text as string | undefined)?.trim() || escolhaDeBotao || null,
      mediaUrl,
      mediaFilename,
      mediaMimetype,
      quotedWaMessageId,
      enviadaEm: instanteDoPayload(mensagem.messageTimestamp),
      anuncio: extrairAnuncio(mensagem),
      instanceToken,
    };
  }

  return null;
}
