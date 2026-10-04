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
      /** referral de anuncio CTWA, quando o canal o repassa; null no comum */
      anuncio: AnuncioDeOrigem | null;
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
      /**
       * O texto que a clinica escreveu no celular (ou a legenda), aparado;
       * null sem texto. Serve SO para o termo-chave da jornada escrito pela
       * clinica (pedido do dono em 02/10/2026): nao e gravado em lugar
       * nenhum e NUNCA vai para log (regra 3.1).
       */
      body: string | null;
      /**
       * Quando a mensagem saiu do celular (ISO), se o payload trouxe o
       * horario. Serve para reconhecer a resposta AUTOMATICA do app WhatsApp
       * Business (saudacao, ausencia), que sai segundos depois da mensagem do
       * paciente. null quando nao veio: quem usa cai na hora da chegada.
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
 * nao le e responde em menos de 8 segundos. Por isso eco do celular que sai
 * DENTRO desta janela depois da ultima mensagem do paciente e tratado como
 * automatico e NAO derruba o "Aguardando voce".
 */
export const JANELA_DE_RESPOSTA_AUTOMATICA_MS = 8_000;

/**
 * Instante limite para o eco do celular contar como resposta de pessoa: a
 * conversa so sai da espera se a ultima mensagem do paciente chegou ANTES
 * dele. Usa o horario de envio do payload quando e plausivel (ultimos 7 dias,
 * no maximo 1 minuto no futuro), porque um eco atrasado ou reentregue nao pode
 * apagar a espera de uma mensagem que o paciente mandou DEPOIS dele. Sem
 * horario plausivel, usa a hora da chegada.
 */
export function limiteParaRespostaDePessoa(
  enviadaEm: string | null,
  agoraMs: number,
): string {
  const enviadaMs = enviadaEm ? Date.parse(enviadaEm) : NaN;
  const plausivel =
    Number.isFinite(enviadaMs) &&
    enviadaMs >= agoraMs - 7 * 24 * 60 * 60 * 1000 &&
    enviadaMs <= agoraMs + 60 * 1000;
  const base = plausivel ? enviadaMs : agoraMs;
  return new Date(base - JANELA_DE_RESPOSTA_AUTOMATICA_MS).toISOString();
}

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
 * janela (ate 1 minuto no futuro, pela folga de relogio, como em
 * limiteParaRespostaDePessoa). Sem horario no payload nao da para provar que
 * e novo, entao nao move.
 *
 * A janela sozinha NAO separa o eco novo da reentrega: o eco nao vira
 * mensagem na conversa, entao nao ha "linha inserida" como na ingestao, e a
 * reentrega dentro da janela moveria de novo o lead que alguem voltou a mao.
 * A garantia de "nunca reentrega" e a marca por wa_message_id no banco
 * (marcar_eco_para_termo, chamada pela rota do webhook depois deste filtro).
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
        mediaFilename: sanearNomeDeArquivo(evento.mediaFilename),
        mediaMimetype: normalizarMimetype(evento.mediaMimetype),
        quotedWaMessageId: evento.quotedWaMessageId ?? null,
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
    // respondeu pelo celular pareado. Antes isto era descartado igual ao eco,
    // e a conversa continuava marcada como esperando resposta: outra atendente
    // abria o Inbox, via a pergunta "sem resposta" e respondia de novo. O
    // paciente recebia duas respostas para a mesma pergunta.
    //
    // Para mensagem de saida, o telefone do PACIENTE esta no chatid (o
    // sender_pn e o numero da propria clinica).
    if (mensagem.fromMe === true) {
      // Mensagem de PROTOCOLO (edicao ou apagamento de uma mensagem ja
      // enviada) nao e resposta nova: a clinica so corrigiu ou retirou o que
      // tinha dito. Reacao tambem nao. Nenhuma das duas tira a conversa da
      // espera.
      const ehProtocolo =
        /protocol|edit|revoke|delete/.test(tipoBruto) ||
        mensagem.isEdit === true ||
        mensagem.edited === true;
      if (ehReacao || ehProtocolo) {
        return null;
      }
      const destino = phoneFromJid(mensagem.chatid as string | undefined);
      if (!destino) {
        return null;
      }
      return {
        kind: "clinic_device_reply",
        phone: destino,
        waMessageId,
        body: (mensagem.text as string | undefined)?.trim() || null,
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

    const contentType = mapContentType(
      mensagem.mediaType as string | undefined,
      mensagem.messageType as string | undefined,
      mensagem.type as string | undefined,
    );

    return {
      kind: "message_received",
      phone,
      name: (mensagem.senderName as string | undefined) ?? null,
      waMessageId,
      contentType,
      body:
        (mensagem.text as string | undefined)?.trim() || escolhaDeBotao || null,
      // A URL vem criptografada (.enc): baixar exige POST /message/download.
      // Guardamos a referencia; o download entra quando houver midia de fato.
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
      anuncio: extrairAnuncio(mensagem),
      instanceToken,
    };
  }

  return null;
}
