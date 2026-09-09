import type { EventoCapi } from "@/lib/integrations/meta/payload";

// Adaptador HTTP da Conversions API da Meta, no molde do request do uazapi
// (lib/integrations/whatsapp/uazapi.ts): timeout explicito com
// AbortController, retry LOCAL so para falha transitoria (5xx e rede), 4xx
// nunca repete, resultado tipado, fetch injetavel para teste.
//
// AO CONTRARIO do envio de mensagem, aqui retry entre execucoes do job
// tambem e seguro: a Meta deduplica por event_id + event_name, entao uma
// resposta perdida reenviada nao vira conversao dobrada.
//
// REGRA ABSOLUTA: nunca logar o corpo (carrega hash de telefone). So codigos.

const GRAPH_VERSION = "v25.0"; // piso suportado em 09/2026 e v24; v25 e a recomendada
const CAPI_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

export type CapiConfig = {
  pixelId: string;
  accessToken: string;
  /** Codigo do Gerenciador de Eventos para validar sem sujar dado real. */
  testEventCode: string | null;
  fetchFn?: typeof fetch;
};

export type CapiResult =
  | { ok: true; eventsReceived: number }
  | { ok: false; errorCode: string; retryable: boolean };

function codigoDoErro(status: number, corpo: unknown): string {
  const erro = (corpo as { error?: { code?: number; type?: string } } | null)
    ?.error;
  if (status === 401 || erro?.code === 190) {
    return "token_invalido";
  }
  if (status === 400 && erro?.code === 100) {
    return "payload_recusado";
  }
  if (status === 404) {
    return "pixel_invalido";
  }
  return `http_${status}`;
}

export async function enviarEventosCapi(
  config: CapiConfig,
  eventos: EventoCapi[],
): Promise<CapiResult> {
  const fetchFn = config.fetchFn ?? fetch;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.pixelId}/events`;
  const corpo = JSON.stringify({
    data: eventos,
    access_token: config.accessToken,
    ...(config.testEventCode
      ? { test_event_code: config.testEventCode }
      : {}),
  });

  let ultimoErro: CapiResult = {
    ok: false,
    errorCode: "sem_tentativa",
    retryable: true,
  };
  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
    if (tentativa > 0) {
      const espera = 500 * 2 ** (tentativa - 1) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CAPI_TIMEOUT_MS);
    try {
      const resposta = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: corpo,
        signal: controller.signal,
      });
      const json = (await resposta.json().catch(() => null)) as {
        events_received?: number;
      } | null;
      if (resposta.ok) {
        return { ok: true, eventsReceived: json?.events_received ?? 0 };
      }
      if (resposta.status >= 400 && resposta.status < 500) {
        // Erro nosso (token, pixel, payload): repetir nao conserta.
        return {
          ok: false,
          errorCode: codigoDoErro(resposta.status, json),
          retryable: false,
        };
      }
      ultimoErro = {
        ok: false,
        errorCode: codigoDoErro(resposta.status, json),
        retryable: true,
      };
    } catch {
      // Timeout ou falha de rede: transitorio, tenta de novo.
      ultimoErro = { ok: false, errorCode: "rede", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }
  return ultimoErro;
}
