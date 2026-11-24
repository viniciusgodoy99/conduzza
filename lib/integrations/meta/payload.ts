import { createHash } from "node:crypto";

import { eventoNoWhatsapp } from "@/lib/domain/meta-conversao";

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
// O telefone so entra no modo 'telefone_hasheado' (escolha da clinica; decisao
// D6 do dono em 16/11/2026: sem corte por autorizacao) e SEMPRE como SHA-256;
// o numero cru nunca sai deste processo.

export type ModoUserData = "ctwa_apenas" | "telefone_hasheado";

/**
 * SHA-256 hex do telefone no formato que a Meta casa: E.164 sem o "+", so
 * digitos, minusculas (hex ja e minusculo).
 */
export function hashTelefoneParaMeta(phoneE164: string): string {
  const digitos = phoneE164.replace(/\D/g, "");
  return createHash("sha256").update(digitos).digest("hex");
}

/**
 * O clique da Meta que levou ao site, no formato que a Meta casa (fbc):
 * fb.1.<hora do clique em ms>.<fbclid>.
 */
export function fbcDoClique(fbclid: string, cliqueEmMs: number): string {
  return `fb.1.${cliqueEmMs}.${fbclid}`;
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
    fbc?: string;
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
  /**
   * fbcDoClique do clique do site casado com o contato (anuncio da Meta que
   * levou ao site). E identificador de clique, nao dado pessoal: entra nos
   * dois modos.
   */
  fbc?: string | null;
  valueCents: number | null;
  currency: string;
  modo: ModoUserData;
};

export type EventoMontado =
  | { ok: true; evento: EventoCapi }
  /** Codigo curto de maquina; o job grava em conversion_event.erro. */
  | {
      ok: false;
      descarte:
        | "sem_ctwa_clid"
        | "sem_waba_id"
        | "sem_identificador"
        | "evento_fora_do_whatsapp";
    };

/**
 * Decide o formato e monta o evento.
 *
 * - Com ctwa_clid E waba: business_messaging (o formato do anuncio CTWA),
 *   com ph junto no modo telefone (dado a mais so melhora o casamento).
 * - Sem o par: evento generico com o que houver, o fbc (clique da Meta que
 *   passou pelo site, nos dois modos) e o ph (so no modo telefone). So com
 *   ph e o evento "sem identificador do anuncio": quem decide se ele vale e
 *   o interruptor send_unmatched, NO JOB, nao aqui.
 * - Sem o par, sem fbc e sem ph: nao ha o que enviar; descarte com codigo.
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
  // Purchase exige valor e moeda na Meta: sem o preco, vai 0 (como o Q5),
  // em vez de o evento ser recusado (revisao de 24/11/2026).
  const customData = (eventName: string) =>
    entrada.valueCents !== null || eventName === "Purchase"
      ? {
          custom_data: {
            value: (entrada.valueCents ?? 0) / 100,
            currency: entrada.currency,
          },
        }
      : {};

  if (entrada.ctwaClid && entrada.wabaId) {
    // No WhatsApp a Meta aceita so a lista dela (Lead vira LeadSubmitted,
    // Schedule vira QualifiedLead); o resto nao sai por aqui.
    const nomeNoWhatsapp = eventoNoWhatsapp(entrada.eventName);
    if (!nomeNoWhatsapp) {
      return { ok: false, descarte: "evento_fora_do_whatsapp" };
    }
    return {
      ok: true,
      evento: {
        ...base,
        event_name: nomeNoWhatsapp,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: entrada.wabaId,
          ctwa_clid: entrada.ctwaClid,
          ...(ph ? { ph } : {}),
        },
        ...customData(nomeNoWhatsapp),
      },
    };
  }

  const fbc = entrada.fbc ?? undefined;
  if (!ph && !fbc) {
    if (entrada.modo === "ctwa_apenas") {
      return {
        ok: false,
        descarte: entrada.ctwaClid ? "sem_waba_id" : "sem_ctwa_clid",
      };
    }
    return { ok: false, descarte: "sem_identificador" };
  }
  return {
    ok: true,
    evento: {
      ...base,
      action_source: "system_generated",
      user_data: { ...(ph ? { ph } : {}), ...(fbc ? { fbc } : {}) },
      ...customData(entrada.eventName),
    },
  };
}

// ---------------------------------------------------------------------------
// Evento do clique no link rastreado (etapa 3e do plano de 16/11/2026)
// ---------------------------------------------------------------------------
//
// Quem toca no link da origem, com a chave "Avisar a Meta no clique" ligada,
// gera um Contact pelo navegador (o Pixel, na pagina intermediaria) e o MESMO
// Contact pelo servidor, com o mesmo event_id (o id do clique): a Meta conta
// uma vez so. Aqui o evento e de SITE (action_source "website"), casado pelo
// que o visitante trouxe no pedido: IP, navegador e, se veio de anuncio, o
// fbc. Nada disso e gravado no nosso banco (decisao do dono de 16/11/2026: o
// IP e o navegador so viajam ate a Meta na hora do clique).

/** O nome do evento do clique, igual no navegador e no servidor. */
export const EVENTO_DO_CLIQUE_DO_LINK = "Contact";

export type EventoDoCliqueCapi = {
  event_name: typeof EVENTO_DO_CLIQUE_DO_LINK;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: {
    client_user_agent: string;
    client_ip_address?: string;
    fbc?: string;
  };
};

export type EntradaDoEventoDoClique = {
  /** O id do clique: o mesmo eventID do Pixel no navegador. */
  eventId: string;
  /** A hora do clique, em milissegundos. */
  cliqueEmMs: number;
  /** O endereco do link, sem a query (as UTMs nao vao). */
  eventSourceUrl: string;
  userAgent: string;
  ip: string | null;
  fbclid: string | null;
};

export function montarEventoDoCliqueDoLink(
  entrada: EntradaDoEventoDoClique,
): EventoDoCliqueCapi {
  return {
    event_name: EVENTO_DO_CLIQUE_DO_LINK,
    event_time: Math.floor(entrada.cliqueEmMs / 1000),
    event_id: entrada.eventId,
    action_source: "website",
    event_source_url: entrada.eventSourceUrl,
    user_data: {
      client_user_agent: entrada.userAgent,
      ...(entrada.ip ? { client_ip_address: entrada.ip } : {}),
      ...(entrada.fbclid
        ? { fbc: fbcDoClique(entrada.fbclid, entrada.cliqueEmMs) }
        : {}),
    },
  };
}
