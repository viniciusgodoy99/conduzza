// Camada adaptadora de canal WhatsApp (decisao de 19/08/2026: uazapi agora,
// oficial depois). Todo o resto do sistema fala com esta interface; trocar de
// provedor e configuracao, nunca reescrita.

export type ProviderName = "fake" | "uazapi" | "cloud_api";

export type InstanceRef = {
  clinicId: string;
  /** URL do servidor uazapi; null usa UAZAPI_SERVER_URL do ambiente */
  serverUrl?: string | null;
  instanceToken?: string | null;
  instanceId?: string | null;
};

export type SendResult =
  | { ok: true; waMessageId: string }
  | { ok: false; errorCode: string; message: string };

export type MenuOption = { id: string; text: string };

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

export interface WhatsAppProvider {
  readonly name: ProviderName;
  /**
   * Canal oficial da Meta: liga janela de 24h, cobranca por mensagem e
   * templates aprovados. uazapi e fake NAO tem nada disso.
   */
  readonly isOfficialChannel: boolean;
  sendText(ref: InstanceRef, to: string, body: string): Promise<SendResult>;
  sendMenu(
    ref: InstanceRef,
    to: string,
    body: string,
    options: MenuOption[],
  ): Promise<SendResult>;
  connectInstance(ref: InstanceRef): Promise<InstanceStatus>;
  getStatus(ref: InstanceRef): Promise<InstanceStatus>;
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

import { FakeProvider } from "./fake";
import { UazapiProvider } from "./uazapi";

export function getWhatsAppProvider(
  name?: ProviderName | string | null,
): WhatsAppProvider {
  const resolved = (name ??
    process.env.WHATSAPP_PROVIDER ??
    "fake") as ProviderName;
  switch (resolved) {
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
