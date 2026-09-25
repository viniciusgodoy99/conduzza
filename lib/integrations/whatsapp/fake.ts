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

// Provedor falso: o dublê de desenvolvimento e teste. Conecta na hora, sem
// QR, e registra os envios em memoria para os testes inspecionarem. Mensagem
// RECEBIDA e simulada por fora, via scripts/dev/simulate-inbound.ts, que
// chama o webhook igual ao uazapi chamaria.

export type FakeSentMessage = {
  /** presente so quando o envio carregava arquivo */
  midia?: {
    tipo: string;
    mimetype: string;
    nomeDoArquivo: string | null;
    bytes: number;
  };
  clinicId: string;
  /**
   * O numero da clinica (whatsapp_account.id) pelo qual o envio saiu; nulo
   * quando quem chamou nao informou. Com mais de um numero, e isso que os
   * testes conferem para provar que a mensagem saiu pelo numero certo.
   */
  accountId: string | null;
  to: string;
  body: string;
  menuOptions?: MenuOption[];
  waMessageId: string;
  /** id da mensagem citada; os testes conferem que o replyid foi adiante */
  replyToWaMessageId?: string | null;
};

/** Ids revogados por deleteMessage, na ordem, para os testes conferirem. */
const apagadas: string[] = [];

export function fakeDeletedMessages(): readonly string[] {
  return apagadas;
}

const sent: FakeSentMessage[] = [];

export function fakeSentMessages(): readonly FakeSentMessage[] {
  return sent;
}

export function resetFakeProvider(): void {
  sent.length = 0;
  apagadas.length = 0;
}

/**
 * Nome da instancia falsa: um por NUMERO.
 *
 * instance_id e unico entre os numeros ativos (provider, instance_id). O nome
 * antigo, `fake-` mais o inicio do id da clinica, faria o segundo numero da
 * mesma clinica colidir com o primeiro. Sem o numero na referencia, vale o
 * nome antigo, que e o que as contas falsas de hoje ja guardam.
 */
export function instanciaFalsa(ref: InstanceRef): string {
  return `fake-${(ref.accountId ?? ref.clinicId).slice(0, 8)}`;
}

export class FakeProvider implements WhatsAppProvider {
  readonly name = "fake" as const;
  readonly isOfficialChannel = false;

  async sendText(
    ref: InstanceRef,
    to: string,
    body: string,
    extra: EnvioExtra = {},
  ): Promise<SendResult> {
    const waMessageId = `fake:${crypto.randomUUID()}`;
    sent.push({
      clinicId: ref.clinicId,
      accountId: ref.accountId ?? null,
      to,
      body,
      waMessageId,
      replyToWaMessageId: extra.replyToWaMessageId ?? null,
    });
    return { ok: true, waMessageId };
  }

  async sendMedia(
    ref: InstanceRef,
    to: string,
    midia: MidiaParaEnviar,
    extra: EnvioExtra = {},
  ): Promise<SendResult> {
    const waMessageId = `fake:${crypto.randomUUID()}`;
    sent.push({
      clinicId: ref.clinicId,
      accountId: ref.accountId ?? null,
      to,
      body: midia.legenda ?? "",
      midia: {
        tipo: midia.tipo,
        mimetype: midia.mimetype,
        nomeDoArquivo: midia.nomeDoArquivo ?? null,
        bytes: Math.floor((midia.base64.length * 3) / 4),
      },
      waMessageId,
      replyToWaMessageId: extra.replyToWaMessageId ?? null,
    });
    return { ok: true, waMessageId };
  }

  async sendMenu(
    ref: InstanceRef,
    to: string,
    body: string,
    options: MenuOption[],
    extra: EnvioExtra = {},
  ): Promise<SendResult> {
    const waMessageId = `fake:${crypto.randomUUID()}`;
    sent.push({
      clinicId: ref.clinicId,
      accountId: ref.accountId ?? null,
      to,
      body,
      menuOptions: options,
      waMessageId,
      replyToWaMessageId: extra.replyToWaMessageId ?? null,
    });
    return { ok: true, waMessageId };
  }

  async deleteMessage(
    _ref: InstanceRef,
    waMessageId: string,
  ): Promise<DeleteResult> {
    apagadas.push(waMessageId);
    return { ok: true };
  }

  async connectInstance(ref: InstanceRef): Promise<InstanceStatus> {
    return {
      status: "conectado",
      displayPhone: "+55 84 98888-0001",
      instanceId: instanciaFalsa(ref),
      qrCode: null,
    };
  }

  // Responde na hora e sem rede: o prazo e as tentativas de OpcoesDeConsulta
  // (segundo parametro da interface) nao tem o que encurtar aqui.
  async getStatus(): Promise<InstanceStatus> {
    return { status: "conectado" };
  }

  async configureWebhook(): Promise<void> {
    // O fake nao chama de volta sozinho; o simulador cumpre esse papel.
  }

  async disconnect(): Promise<void> {
    // Sem estado remoto para derrubar.
  }

  async downloadMedia(
    _ref: InstanceRef,
    waMessageId: string,
    options: { transcribe?: boolean } = {},
  ): Promise<MediaDownloadResult> {
    // Conteudo deterministico para os testes: um "arquivo" pequeno cujo texto
    // carrega o id, e transcricao quando pedida.
    return {
      ok: true,
      base64: Buffer.from(`fake-midia:${waMessageId}`).toString("base64"),
      mimetype: "audio/mpeg",
      transcript: options.transcribe
        ? `Transcrição de teste da mensagem ${waMessageId}`
        : null,
    };
  }
}
