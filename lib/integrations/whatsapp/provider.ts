// Camada adaptadora de canal WhatsApp (decisao de 19/08/2026: uazapi agora,
// oficial depois). Todo o resto do sistema fala com esta interface; trocar de
// provedor e configuracao, nunca reescrita.

export type ProviderName = "fake" | "uazapi" | "cloud_api";

export type InstanceRef = {
  clinicId: string;
  /**
   * O numero da clinica (whatsapp_account.id) a que esta instancia pertence.
   *
   * Com mais de um numero por clinica, a clinica deixou de identificar a
   * instancia: e o numero que diz por qual WhatsApp a mensagem sai. O HTTP do
   * uazapi autentica pelo token e nao usa este campo; ele serve ao provedor
   * falso (instancia e registro de envio por numero) e ao rastro de quem
   * chama. Opcional so enquanto o contrato da Fase 3 nao chega: toda
   * referencia montada pelo orquestrador de envio ja carrega o numero.
   */
  accountId?: string | null;
  /** URL do servidor uazapi; null usa UAZAPI_SERVER_URL do ambiente */
  serverUrl?: string | null;
  instanceToken?: string | null;
  instanceId?: string | null;
};

export type SendResult =
  | { ok: true; waMessageId: string }
  | { ok: false; errorCode: string; message: string };

export type MenuOption = { id: string; text: string };

/**
 * O que acompanha qualquer envio, independente do tipo.
 *
 * Existe como parametro proprio, e nao dentro de cada payload, porque o
 * `replyid` do uazapi vale igual para texto, midia e menu: um conceito so,
 * declarado uma vez. Espalha-lo pelos tres tipos garantiria que um deles
 * ficasse para tras na proxima mudanca.
 */
export type EnvioExtra = {
  /** id NO WHATSAPP da mensagem citada; vira `replyid` no provedor */
  replyToWaMessageId?: string | null;
};

export type DeleteResult =
  { ok: true } | { ok: false; errorCode: string; message: string };

/** Tipos que o uazapi aceita no campo `type` de /send/media. */
export type TipoDeMidia = "image" | "audio" | "ptt" | "video" | "document";

export type MidiaParaEnviar = {
  tipo: TipoDeMidia;
  /** conteudo em base64, SEM o prefixo `data:` */
  base64: string;
  mimetype: string;
  /** legenda; vai no campo `text` do provedor */
  legenda?: string | null;
  /** nome exibido do arquivo, so faz sentido em documento */
  nomeDoArquivo?: string | null;
};

export type MediaDownloadResult =
  | {
      ok: true;
      /** conteudo do arquivo; vai para o NOSSO Storage, nunca fica em URL do provedor */
      base64: string;
      mimetype: string;
      /** transcricao quando for audio e o provedor transcrever */
      transcript: string | null;
    }
  | { ok: false; errorCode: string; message: string };

export type ConnectionStatus =
  "desconectado" | "aguardando_qr" | "conectando" | "conectado";

export type InstanceStatus = {
  status: ConnectionStatus;
  qrCode?: string | null;
  displayPhone?: string | null;
  instanceId?: string | null;
  instanceToken?: string | null;
};

/**
 * Como consultar a situacao da instancia. Sem opcoes vale o padrao do
 * provedor (no uazapi, 10 s por tentativa e ate duas novas tentativas em
 * tempo esgotado ou 5xx), que tolera um servidor lento.
 */
export type OpcoesDeConsulta = {
  /** prazo de cada tentativa, em milissegundos */
  timeoutMs?: number;
  /** uma tentativa so: tempo esgotado ou 5xx lanca na hora */
  semRetry?: boolean;
};

export interface WhatsAppProvider {
  readonly name: ProviderName;
  /**
   * Canal oficial da Meta: liga janela de 24h, cobranca por mensagem e
   * templates aprovados. uazapi e fake NAO tem nada disso.
   */
  readonly isOfficialChannel: boolean;
  sendText(
    ref: InstanceRef,
    to: string,
    body: string,
    extra?: EnvioExtra,
  ): Promise<SendResult>;
  /**
   * Envia um arquivo (foto, audio, documento ou video).
   *
   * O conteudo vai como BASE64, nao como URL. Isso foi confirmado contra a
   * instancia real: o campo `file` responde "failed to decode base64 file"
   * quando recebe outra coisa. A diferenca importa para dado de saude: uma
   * API que exigisse URL obrigaria a expor a foto do paciente publicamente,
   * ainda que por instantes.
   */
  sendMedia(
    ref: InstanceRef,
    to: string,
    midia: MidiaParaEnviar,
    extra?: EnvioExtra,
  ): Promise<SendResult>;
  sendMenu(
    ref: InstanceRef,
    to: string,
    body: string,
    options: MenuOption[],
    extra?: EnvioExtra,
  ): Promise<SendResult>;
  /**
   * Revoga uma mensagem no WhatsApp do paciente ("apagar para todos").
   *
   * O WhatsApp so aceita a revogacao dentro do prazo dele (60 horas para quem
   * enviou) e apenas para mensagem propria. O prazo e conferido ANTES, no
   * banco (pode_apagar_mensagem): chegar aqui com prazo vencido significaria
   * dizer a clinica que apagou algo que continua na tela do paciente.
   */
  deleteMessage(ref: InstanceRef, waMessageId: string): Promise<DeleteResult>;
  connectInstance(ref: InstanceRef): Promise<InstanceStatus>;
  /**
   * Situacao da instancia. `opcoes` so encurta a consulta onde esperar nao
   * muda o desfecho: a porta da ingestao com o numero "desconectado", em que a
   * mensagem entra com ou sem resposta (achado T[1] da revisao da trava).
   */
  getStatus(
    ref: InstanceRef,
    opcoes?: OpcoesDeConsulta,
  ): Promise<InstanceStatus>;
  configureWebhook(ref: InstanceRef, url: string): Promise<void>;
  disconnect(ref: InstanceRef): Promise<void>;
  /**
   * Baixa a midia de uma mensagem recebida. No uazapi a URL do webhook vem
   * criptografada (.enc) e expira: o arquivo real so existe via download, que
   * roda como JOB (nunca no caminho do webhook).
   */
  downloadMedia(
    ref: InstanceRef,
    waMessageId: string,
    options?: { transcribe?: boolean },
  ): Promise<MediaDownloadResult>;
}

export const MENSAGEM_CANAL_NAO_CONFIGURADO =
  "Canal de WhatsApp não configurado no servidor. Fale com o suporte.";

/**
 * Producao sem provedor de verdade configurado.
 *
 * Existe para FALHAR FECHADO. Antes, um deploy que perdesse WHATSAPP_PROVIDER
 * caia no fake em silencio: a clinica "conectava" na hora com um numero
 * ficticio, todo envio virava 'enviada' sem sair nada, e o provedor 'fake'
 * ficava gravado na conta dela.
 */
export class CanalNaoConfiguradoError extends Error {
  constructor() {
    super(MENSAGEM_CANAL_NAO_CONFIGURADO);
    this.name = "CanalNaoConfiguradoError";
  }
}

function emProducao(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function provedorReal(valor: string | null | undefined): boolean {
  return valor === "uazapi" || valor === "cloud_api";
}

/**
 * O provedor que o AMBIENTE manda usar para uma conta nova.
 *
 * Fora de producao, sem configuracao, e o fake (desenvolvimento e testes).
 * Em producao so vale provedor real: ausente ou 'fake' devolve nulo, e quem
 * chama recusa a conexao em vez de criar a conta com o fake.
 */
export function provedorDoAmbiente(): ProviderName | null {
  const valor = process.env.WHATSAPP_PROVIDER?.trim() || null;
  if (emProducao()) {
    return provedorReal(valor) ? (valor as ProviderName) : null;
  }
  return (valor as ProviderName | null) ?? "fake";
}

/**
 * A CONEXAO de um numero em producao so acontece com provedor real.
 *
 * Vale para a conta que ja ficou gravada com 'fake' por um deploy mal
 * configurado: conectar ali "conectaria" o simulador. Fica fora do
 * getWhatsAppProvider de proposito: as clinicas descartaveis da suite e2e
 * vivem no mesmo banco com provider 'fake', e o motor de producao executa os
 * jobs delas; recusar la quebraria a suite sem proteger clinica real nenhuma
 * (conta nova em producao ja nao nasce mais 'fake').
 */
export function conexaoRecusadaNoAmbiente(provedorDaConta: string): boolean {
  return emProducao() && !provedorReal(provedorDaConta);
}

import { FakeProvider } from "./fake";
import { UazapiProvider } from "./uazapi";

export function getWhatsAppProvider(
  name?: ProviderName | string | null,
): WhatsAppProvider {
  // Sem provedor na conta, vale o do ambiente, e em producao ele nunca e o
  // fake por omissao: sem configuracao, falha fechado em vez de simular.
  const resolved = name ?? provedorDoAmbiente();
  if (resolved === null) {
    throw new CanalNaoConfiguradoError();
  }
  switch (resolved as ProviderName) {
    case "uazapi":
      return new UazapiProvider();
    case "cloud_api":
      throw new Error(
        "Canal oficial (cloud_api) ainda não implementado. Ver plano de migração.",
      );
    default:
      return new FakeProvider();
  }
}
