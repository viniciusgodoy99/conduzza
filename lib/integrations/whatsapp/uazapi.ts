import { textoNumerado } from "./menu-texto";
import type {
  DeleteResult,
  EnvioExtra,
  InstanceRef,
  InstanceStatus,
  MediaDownloadResult,
  MenuOption,
  SendResult,
  WhatsAppProvider,
  MidiaParaEnviar,
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
  instanceDelete: "/instance", // DELETE, token da instancia
  webhook: "/webhook",
  sendText: "/send/text",
  sendMenu: "/send/menu",
  sendMedia: "/send/media",
  messageDownload: "/message/download",
  messageDelete: "/message/delete",
} as const;

const REQUEST_TIMEOUT_MS = 10_000;
// Subir arquivo demora mais que mandar texto: o corpo carrega o base64 inteiro
// e o servidor ainda converte (uma PNG enviada como image volta como JPEG).
const UPLOAD_TIMEOUT_MS = 45_000;
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

/** Operacoes de instancia que olham o status HTTP e podem lancar este erro. */
export type OperacaoDeInstancia = "criar" | "conectar" | "status" | "webhook";

/**
 * O que a recusa significa, pelos codigos da especificacao:
 * - instancia_invalida: 401 (token invalido ou expirado) ou 404 (instancia
 *   nao existe). No servidor COMPARTILHADO isso acontece quando alguem apaga
 *   ou recria a instancia no painel. O remedio e descartar o token e criar
 *   outra.
 * - fluxo_em_andamento: 409, ja existe um pareamento aberto.
 * - limite_de_conexoes: 429, o servidor esta no teto.
 * - recusado: qualquer outro fora de 2xx.
 */
export type MotivoDaRecusa =
  | "instancia_invalida"
  | "fluxo_em_andamento"
  | "limite_de_conexoes"
  | "recusado";

/**
 * Resposta fora de 2xx numa operacao de instancia.
 *
 * Antes, connectInstance e getStatus liam o corpo de erro como se fosse
 * status, e qualquer recusa virava "desconectado" mudo: sem QR, sem mensagem,
 * e clicar de novo dava o mesmo. A mensagem do erro so carrega operacao e
 * codigo, nunca o corpo da resposta.
 */
export class UazapiHttpError extends Error {
  readonly status: number;
  readonly operacao: OperacaoDeInstancia;
  readonly motivo: MotivoDaRecusa;

  constructor(status: number, operacao: OperacaoDeInstancia) {
    super(
      status === 429 && operacao === "criar"
        ? "O servidor do WhatsApp atingiu o limite de instâncias conectadas."
        : `uazapi ${operacao} ${status}`,
    );
    this.name = "UazapiHttpError";
    this.status = status;
    this.operacao = operacao;
    this.motivo =
      status === 401 || status === 404
        ? "instancia_invalida"
        : status === 409
          ? "fluxo_em_andamento"
          : status === 429
            ? "limite_de_conexoes"
            : "recusado";
  }
}

function exigir2xx(status: number, operacao: OperacaoDeInstancia): void {
  if (status < 200 || status >= 300) {
    throw new UazapiHttpError(status, operacao);
  }
}

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
      method?: "GET" | "POST" | "DELETE";
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
          // So o POST leva corpo: GET e DELETE da especificacao nao tem.
          body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
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
    extra: EnvioExtra = {},
  ): Promise<SendResult> {
    try {
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendText,
        {
          payload: { number: to, text: body, ...comCitacao(extra) },
          semRetry: true,
        },
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

  async sendMedia(
    ref: InstanceRef,
    to: string,
    midia: MidiaParaEnviar,
    extra: EnvioExtra = {},
  ): Promise<SendResult> {
    try {
      // Contrato conferido contra a instancia real (03/09/2026), porque a
      // documentacao e uma aplicacao de pagina unica que nao da para ler
      // automaticamente:
      //   file     base64 puro, sem o prefixo data:
      //   text     e a LEGENDA (nao existe campo "caption" na entrada)
      //   docName  e o nome exibido do arquivo, so em document
      // A resposta traz messageid e id, que e o par que toSendResult ja le.
      const payload: Record<string, unknown> = {
        number: to,
        type: midia.tipo,
        file: midia.base64,
        mimetype: midia.mimetype,
        ...comCitacao(extra),
      };
      if (midia.legenda) {
        payload.text = midia.legenda;
      }
      if (midia.nomeDoArquivo) {
        payload.docName = midia.nomeDoArquivo;
      }
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendMedia,
        { payload, semRetry: true, timeoutMs: UPLOAD_TIMEOUT_MS },
      );
      return toSendResult(status, response);
    } catch {
      // Mesma razao do sendText: a midia pode ter chegado e so a resposta ter
      // se perdido. Repetir sozinho duplicaria o arquivo na conversa.
      return {
        ok: false as const,
        errorCode: "envio_incerto",
        message:
          "Não foi possível confirmar o envio do arquivo. Confira a conversa antes de reenviar.",
      };
    }
  }

  async sendMenu(
    ref: InstanceRef,
    to: string,
    body: string,
    options: MenuOption[],
    extra: EnvioExtra = {},
  ): Promise<SendResult> {
    try {
      // Codificacao da especificacao: "texto|id" para botao de resposta.
      const choices = options.map((option) => `${option.text}|${option.id}`);
      const { status, body: response } = await this.request(
        ref,
        PATHS.sendMenu,
        {
          payload: {
            number: to,
            type: "button",
            text: body,
            choices,
            ...comCitacao(extra),
          },
          semRetry: true,
        },
      );
      if (status >= 200 && status < 300) {
        return toSendResult(status, response);
      }
      // Botao interativo e incerto em API nao oficial: degrada para texto
      // numerado, que funciona em qualquer aparelho.
      const fallback = await this.request(ref, PATHS.sendText, {
        payload: {
          number: to,
          text: textoNumerado(body, options),
          ...comCitacao(extra),
        },
        semRetry: true,
      });
      return toSendResult(fallback.status, fallback.body);
    } catch {
      // MESMA regra do sendText, e ela faltava aqui. Sem este catch, falha de
      // rede virava excecao, o orquestrador a classificava como
      // 'provider_indisponivel' (que ESTA em FALHAS_SEM_ENVIO) e o retry
      // reenviava um toque que pode ter chegado: o paciente receberia a
      // confirmacao duas vezes. 'envio_incerto' e definitivo.
      return {
        ok: false as const,
        errorCode: "envio_incerto",
        message:
          "Não foi possível confirmar o envio. Confira a conversa antes de reenviar.",
      };
    }
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

  async deleteMessage(
    ref: InstanceRef,
    waMessageId: string,
  ): Promise<DeleteResult> {
    // Contrato da especificacao (POST /message/delete): pedido {id}, resposta
    // 200 {timestamp, id}. O provedor tambem emite um messages_update com
    // Type 'Deleted', que o nosso webhook ignora quando ja apagamos aqui (a
    // linha ja tem deleted_at e a funcao do banco nao acha nada para apagar).
    //
    // COM retry, ao contrario do envio: repetir um apagamento nao pode causar
    // dano nenhum (a mensagem ja esta revogada), enquanto desistir na primeira
    // falha de rede deixa no celular do paciente algo que a clinica ja
    // considera apagado.
    try {
      const { status, body } = await this.request(ref, PATHS.messageDelete, {
        payload: { id: waMessageId },
      });
      if (status >= 200 && status < 300) {
        return { ok: true };
      }
      return {
        ok: false,
        errorCode: `uazapi_delete_${status}`,
        message:
          pickString(body, ["message_ptbr", "error", "message"]) ??
          "O WhatsApp não aceitou apagar esta mensagem.",
      };
    } catch {
      return {
        ok: false,
        errorCode: "provider_indisponivel",
        message:
          "Não conseguimos falar com o servidor do WhatsApp. A mensagem não foi apagada.",
      };
    }
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
    // 429 (teto de instancias) e 401 (token administrativo recusado) chegam
    // tipados, para a tela dizer o que houve em vez de "tente de novo".
    exigir2xx(status, "criar");
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
    const { status, body } = await this.request(ref, PATHS.instanceConnect, {
      payload: {},
    });
    exigir2xx(status, "conectar");
    return parseInstanceStatus(body);
  }

  async getStatus(ref: InstanceRef): Promise<InstanceStatus> {
    // GET, conforme a especificacao.
    const { status, body } = await this.request(ref, PATHS.instanceStatus, {
      method: "GET",
    });
    exigir2xx(status, "status");
    return parseInstanceStatus(body);
  }

  async configureWebhook(ref: InstanceRef, url: string): Promise<void> {
    // Recusa aqui lanca: antes um 401 passava calado, o numero conectava e
    // nenhuma resposta de paciente chegava.
    const { status } = await this.request(ref, PATHS.webhook, {
      payload: {
        enabled: true,
        url,
        events: ["messages", "messages_update", "connection"],
        // OBRIGATORIO: sem isto, toda mensagem que enviamos volta como
        // recebida e vira laco infinito. A especificacao alerta duas vezes.
        excludeMessages: ["wasSentByApi"],
      },
    });
    exigir2xx(status, "webhook");
  }

  async disconnect(ref: InstanceRef): Promise<void> {
    await this.request(ref, PATHS.instanceDisconnect, { payload: {} });
  }

  /**
   * Apaga a instancia do servidor uazapi (DELETE /instance, com o token dela).
   *
   * Existe para a remocao de um numero: o servidor e COMPARTILHADO com outros
   * produtos e tem teto de instancias, entao numero removido nao pode deixar
   * instancia orfa ocupando vaga. Desconectar nao basta: a instancia
   * desconectada continua existindo e contando.
   *
   * Nunca lanca. Quem remove o numero segue com a remocao no banco mesmo
   * quando o servidor nao responde (o numero deixa de existir para a clinica
   * de qualquer jeito) e so registra o que sobrou para limpar.
   *
   * COM retry, como o apagar mensagem: a especificacao diz que repetir durante
   * a exclusao assincrona e seguro, e desistir na primeira falha de rede
   * deixaria a instancia orfa.
   */
  async excluirInstancia(ref: InstanceRef): Promise<ExclusaoDeInstancia> {
    // Numero que nunca conectou nao tem instancia no servidor.
    if (!ref.instanceToken) {
      return { ok: true, situacao: "sem_instancia" };
    }
    try {
      const { status } = await this.request(ref, PATHS.instanceDelete, {
        method: "DELETE",
      });
      // 202: exclusao agendada; o servidor ja parou de aceitar operacoes nela.
      if (status === 202) {
        return { ok: true, situacao: "agendada" };
      }
      if (status >= 200 && status < 300) {
        return { ok: true, situacao: "excluida" };
      }
      // 404: alguem ja apagou no painel. O objetivo (nao sobrar instancia)
      // esta cumprido.
      if (status === 404) {
        return { ok: true, situacao: "ja_nao_existia" };
      }
      if (status === 401) {
        // Token recusado: o servidor nao reconhece mais este token, e so ele
        // autoriza o DELETE. Pode ter sido apagada ou recriada no painel.
        return {
          ok: false,
          errorCode: "instancia_invalida",
          message:
            "O servidor do WhatsApp não reconhece mais esta instância. Ela pode precisar de limpeza pelo suporte.",
        };
      }
      return {
        ok: false,
        errorCode: `uazapi_${status}`,
        message: "O servidor do WhatsApp não apagou a instância deste número.",
      };
    } catch {
      return {
        ok: false,
        errorCode: "provider_indisponivel",
        message:
          "Não conseguimos falar com o servidor do WhatsApp. A instância deste número não foi apagada.",
      };
    }
  }
}

/**
 * Resultado de excluirInstancia. Sucesso tambem cobre "nao havia o que
 * apagar": o que importa para quem remove o numero e nao sobrar instancia.
 */
export type ExclusaoDeInstancia =
  | {
      ok: true;
      situacao: "excluida" | "agendada" | "ja_nao_existia" | "sem_instancia";
    }
  | { ok: false; errorCode: string; message: string };

/**
 * O trecho `replyid` do corpo, quando ha citacao.
 *
 * Devolve objeto VAZIO quando nao ha, em vez de `replyid: null`: o provedor
 * trata campo presente com valor vazio como pedido de citar a mensagem "",
 * e o envio inteiro falha por id invalido.
 */
function comCitacao(extra: EnvioExtra): Record<string, string> {
  return extra.replyToWaMessageId ? { replyid: extra.replyToWaMessageId } : {};
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
    // O NUMERO vem primeiro (owner/jid.user); o nome de perfil e ultimo
    // recurso. A ordem antiga preferia profileName e display_phone acabava
    // guardando o NOME, que o teste de envio da Tela 7 usaria como destino
    // (achado grave da revisao de 14/09/2026): nome sem digito nao chega, e
    // nome COM digitos viraria numero de terceiro.
    displayPhone: semSufixoDeJid(
      pickString(body, [
        "instance.owner",
        "owner",
        "status.jid.user",
        "instance.profileName",
      ]),
    ),
    instanceId: pickString(body, ["instance.name", "instance.id"]),
    instanceToken: pickString(body, ["instance.token", "token"]),
  };
}

/** "5584...@s.whatsapp.net" vira "5584..."; sem arroba, passa direto. */
function semSufixoDeJid(valor: string | null): string | null {
  if (!valor) {
    return null;
  }
  const arroba = valor.indexOf("@");
  return arroba > 0 ? valor.slice(0, arroba) : valor;
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
 * Rotulo da instancia no painel do uazapi: `conduzza_` mais o slug da clinica,
 * e o inicio do id do NUMERO quando ele vem.
 *
 * O servidor uazapi e COMPARTILHADO com outros produtos, entao o prefixo diz
 * de quem e a instancia numa olhada, e o slug (unico por clinica no banco)
 * diz de QUAL clinica. Clinica sem slug utilizavel cai no inicio do id, que
 * sempre existe.
 *
 * O sufixo do numero (`conduzza_<slug>_<8 do accountId>`) existe porque o
 * nome e guardado em whatsapp_account.instance_id, unico entre os numeros
 * ativos: dois numeros da mesma clinica com o mesmo nome colidiriam no banco,
 * mesmo o uazapi aceitando (toda operacao autentica pelo token). Sem
 * accountId, o nome e o de antes: o principal que ja existe nao e renomeado.
 */
export function nomeDaInstancia(
  slug: string,
  clinicId: string,
  accountId?: string | null,
): string {
  const base = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  const nome = `conduzza_${base.length > 0 ? base : clinicId.slice(0, 8)}`;
  const sufixo = (accountId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return sufixo.length > 0 ? `${nome}_${sufixo}` : nome;
}
