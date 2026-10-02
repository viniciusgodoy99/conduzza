import "server-only";

import {
  cabecalhoRange,
  type IntervaloPedido,
} from "@/lib/domain/intervalo-de-bytes";

// Busca no Storage um pedaco de um arquivo de midia, pela URL assinada que a
// rota acabou de gerar com a SESSAO do usuario (a RLS ja decidiu). Usada pela
// rota de midia para entregar o audio pela propria origem do sistema, em vez
// de mandar o navegador a um link de 5 minutos que expirava no meio do audio
// (02/10/2026).
//
// Timeout so ate a resposta chegar: depois disso o corpo e repassado em
// streaming e quem encerra e o navegador (o sinal da requisicao aborta a
// busca se ele desistir). Uma nova tentativa, com espera curta, so em erro de
// rede ou 5xx, sempre antes de o corpo comecar: nada e repetido no meio de um
// envio.

const TIMEOUT_DA_RESPOSTA_MS = 15_000;
const ESPERA_ANTES_DA_NOVA_TENTATIVA_MS = 400;

export type PedacoDeMidia =
  | { ok: true; resposta: Response }
  | { ok: false; status: number };

async function umaTentativa(
  url: string,
  intervalo: IntervaloPedido | null,
  sinalDoNavegador: AbortSignal,
): Promise<Response> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_DA_RESPOSTA_MS);
  const aoDesistir = () => controle.abort();
  sinalDoNavegador.addEventListener("abort", aoDesistir, { once: true });
  try {
    return await fetch(url, {
      headers: intervalo ? { Range: cabecalhoRange(intervalo) } : {},
      cache: "no-store",
      signal: controle.signal,
    });
  } finally {
    // A resposta chegou (ou falhou): o corpo segue sem relogio.
    clearTimeout(relogio);
  }
}

export async function buscarPedacoDeMidia(
  urlAssinada: string,
  intervalo: IntervaloPedido | null,
  sinalDoNavegador: AbortSignal,
): Promise<PedacoDeMidia> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    // O navegador ja desistiu (arrastou para outro ponto, fechou a conversa):
    // nao busca nem tenta de novo.
    if (sinalDoNavegador.aborted) {
      return { ok: false, status: 499 };
    }
    try {
      const resposta = await umaTentativa(
        urlAssinada,
        intervalo,
        sinalDoNavegador,
      );
      if (resposta.status >= 500 && tentativa === 1) {
        await resposta.body?.cancel();
        await new Promise((r) =>
          setTimeout(r, ESPERA_ANTES_DA_NOVA_TENTATIVA_MS),
        );
        continue;
      }
      if (resposta.ok || resposta.status === 416) {
        return { ok: true, resposta };
      }
      await resposta.body?.cancel();
      return { ok: false, status: resposta.status };
    } catch {
      if (sinalDoNavegador.aborted || tentativa === 2) {
        return { ok: false, status: 504 };
      }
      await new Promise((r) =>
        setTimeout(r, ESPERA_ANTES_DA_NOVA_TENTATIVA_MS),
      );
    }
  }
  return { ok: false, status: 502 };
}
