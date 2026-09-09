import { createHash } from "node:crypto";

// Montagem PURA do evento da Conversions API (zero I/O), testavel sem rede.
// Quem envia e capi.ts; quem decide SE envia e o job (conversao-meta.ts).
//
// Formato confirmado na doc da Meta (Conversions API for Business Messaging,
// lida em 09/09/2026): evento de anuncio clique-para-WhatsApp usa
// action_source "business_messaging" + messaging_channel "whatsapp", com
// user_data.ctwa_clid E user_data.whatsapp_business_account_id obrigatorios.
// Sem esse par, o evento cai no formato generico ("system_generated") casado
// por telefone hasheado, o mesmo caminho que o Tintim usa.
//
// LGPD: o telefone so entra no modo 'telefone_hasheado' (decisao D6 do dono)
// e SEMPRE como SHA-256; o numero cru nunca sai deste processo.

export type ModoUserData = "ctwa_apenas" | "telefone_hasheado";

/**
 * SHA-256 hex do telefone no formato que a Meta casa: E.164 sem o "+", so
 * digitos, minusculas (hex ja e minusculo).
 */
export function hashTelefoneParaMeta(phoneE164: string): string {
  const digitos = phoneE164.replace(/\D/g, "");
  return createHash("sha256").update(digitos).digest("hex");
}

export type EventoCapi = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "business_messaging" | "system_generated";
  messaging_channel?: "whatsapp";
  user_data: {
    whatsapp_business_account_id?: string;
    ctwa_clid?: string;
    ph?: string[];
  };
  custom_data?: { value: number; currency: string };
};

export type EntradaDoEvento = {
  eventName: string;
  eventId: string;
  /** created_at do registro, em segundos unix (a Meta aceita ate 7 dias). */
  eventTimeUnix: number;
  ctwaClid: string | null;
  /** WABA da clinica; sem ele nao existe evento business_messaging. */
  wabaId: string | null;
  phoneE164: string | null;
  valueCents: number | null;
  currency: string;
  modo: ModoUserData;
};

export type EventoMontado =
  | { ok: true; evento: EventoCapi }
  /** Codigo curto de maquina; o job grava em conversion_event.erro. */
  | { ok: false; descarte: "sem_ctwa_clid" | "sem_waba_id" | "sem_identificador" };

/**
 * Decide o formato e monta o evento.
 *
 * - Com ctwa_clid E waba: business_messaging (o formato do anuncio CTWA),
 *   com ph junto no modo telefone (dado a mais so melhora o casamento).
 * - Sem o par, no modo telefone: evento generico com ph. E o evento "sem
 *   identificador do anuncio": quem decide se ele vale e o interruptor
 *   send_unmatched, NO JOB, nao aqui.
 * - Sem o par, no modo ctwa_apenas: nao ha o que enviar; descarte com codigo.
 */
export function montarEventoCapi(entrada: EntradaDoEvento): EventoMontado {
  const ph =
    entrada.modo === "telefone_hasheado" && entrada.phoneE164
      ? [hashTelefoneParaMeta(entrada.phoneE164)]
      : undefined;

  const base = {
    event_name: entrada.eventName,
    event_time: entrada.eventTimeUnix,
    event_id: entrada.eventId,
  };
  const customData =
    entrada.valueCents !== null
      ? {
          custom_data: {
            value: entrada.valueCents / 100,
            currency: entrada.currency,
          },
        }
      : {};

  if (entrada.ctwaClid && entrada.wabaId) {
    return {
      ok: true,
      evento: {
        ...base,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: entrada.wabaId,
          ctwa_clid: entrada.ctwaClid,
          ...(ph ? { ph } : {}),
        },
        ...customData,
      },
    };
  }

  if (entrada.modo === "ctwa_apenas") {
    return {
      ok: false,
      descarte: entrada.ctwaClid ? "sem_waba_id" : "sem_ctwa_clid",
    };
  }

  if (!ph) {
    return { ok: false, descarte: "sem_identificador" };
  }
  return {
    ok: true,
    evento: {
      ...base,
      action_source: "system_generated",
      user_data: { ph },
      ...customData,
    },
  };
}
