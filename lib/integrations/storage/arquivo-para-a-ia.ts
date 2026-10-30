import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// O arquivo do paciente no Storage, lido para o turno da IA (AG6b, desenho
// 4.3): midia-conversas/{clinica}/{mensagem}, pela SERVICE ROLE (o turno
// roda no servidor; a mensagem ja foi conferida pelo executor, que so pede a
// midia do paciente desta conversa e clinica).
//
// Contrato: NUNCA baixar acima do limite. Antes de baixar, o tamanho pelos
// metadados do objeto (storage.info); acima do limite, nada baixa. Depois, a
// URL assinada de 60 s e o download com prazo, contando os bytes: se o
// objeto crescer no meio (ou os metadados mentirem), a leitura para no
// limite. Prazo duro (PRAZO_DO_ARQUIVO_NO_STORAGE_MS) e UMA nova tentativa
// com espera curta, so em erro de rede ou 5xx.
//
// O caminho so vale no formato exato storage://midia-conversas/{clinica}/
// {mensagem}, com a clinica e a mensagem do turno: qualquer outro e
// recusado (falha fechada). Nunca loga nome, conteudo nem caminho (quem
// chama loga so os ids de sempre).

export const BALDE_DA_MIDIA = "midia-conversas";

/** O prazo da leitura do arquivo (PROPOSTA, a calibrar na prova paga). */
export const PRAZO_DO_ARQUIVO_NO_STORAGE_MS = 8_000;

const ESPERA_ANTES_DA_NOVA_TENTATIVA_MS = 300;
const VALIDADE_DA_URL_SEGUNDOS = 60;

export type ArquivoDoStorage =
  | { tipo: "ok"; bytes: Uint8Array }
  | { tipo: "grande_demais" }
  | { tipo: "nao_encontrado" }
  | { tipo: "falhou"; codigo: string };

/** O caminho do objeto, so no formato exato da mensagem do turno. */
export function caminhoDoArquivoDaMensagem(
  mediaUrl: string | null | undefined,
  clinicId: string,
  messageId: string,
): string | null {
  const esperado = `storage://${BALDE_DA_MIDIA}/${clinicId}/${messageId}`;
  return mediaUrl === esperado ? `${clinicId}/${messageId}` : null;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Tentativa =
  | { tipo: "ok"; bytes: Uint8Array }
  | { tipo: "grande_demais" }
  | { tipo: "repetivel"; codigo: string }
  | { tipo: "definitiva"; codigo: string };

/** Le o corpo contando os bytes; para no limite. */
async function lerCorpo(
  resposta: Response,
  maximoDeBytes: number,
  controle: AbortController,
): Promise<Uint8Array | "grande_demais"> {
  const leitor = resposta.body?.getReader();
  if (leitor === undefined) {
    const inteiro = new Uint8Array(await resposta.arrayBuffer());
    return inteiro.length > maximoDeBytes ? "grande_demais" : inteiro;
  }
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > maximoDeBytes) {
      controle.abort();
      await leitor.cancel().catch(() => undefined);
      return "grande_demais";
    }
    partes.push(value);
  }
  const saida = new Uint8Array(total);
  let p = 0;
  for (const parte of partes) {
    saida.set(parte, p);
    p += parte.length;
  }
  return saida;
}

async function umaTentativa(
  admin: SupabaseClient,
  caminho: string,
  maximoDeBytes: number,
  prazoMs: number,
): Promise<Tentativa> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), prazoMs);
  try {
    const balde = admin.storage.from(BALDE_DA_MIDIA);
    // 1. O tamanho pelos metadados, antes de baixar.
    const info = await balde.info(caminho);
    if (info.error || !info.data) {
      const status = Number(
        (info.error as { statusCode?: unknown; status?: unknown } | null)
          ?.statusCode ??
          (info.error as { status?: unknown } | null)?.status ??
          0,
      );
      if (status === 404 || status === 400) {
        return { tipo: "definitiva", codigo: "nao_encontrado" };
      }
      return status >= 500 || status === 0
        ? { tipo: "repetivel", codigo: "info_falhou" }
        : { tipo: "definitiva", codigo: "info_falhou" };
    }
    const tamanho = info.data.size;
    if (typeof tamanho !== "number" || !Number.isFinite(tamanho)) {
      return { tipo: "definitiva", codigo: "sem_tamanho" };
    }
    if (tamanho > maximoDeBytes) {
      return { tipo: "grande_demais" };
    }
    // 2. A URL assinada curta e o download contado.
    const assinada = await balde.createSignedUrl(
      caminho,
      VALIDADE_DA_URL_SEGUNDOS,
    );
    if (assinada.error || !assinada.data?.signedUrl) {
      return { tipo: "repetivel", codigo: "assinatura_falhou" };
    }
    const resposta = await fetch(assinada.data.signedUrl, {
      cache: "no-store",
      signal: controle.signal,
    });
    if (resposta.status >= 500) {
      await resposta.body?.cancel().catch(() => undefined);
      return { tipo: "repetivel", codigo: `http_${resposta.status}` };
    }
    if (!resposta.ok) {
      await resposta.body?.cancel().catch(() => undefined);
      return {
        tipo: "definitiva",
        codigo:
          resposta.status === 404 ? "nao_encontrado" : `http_${resposta.status}`,
      };
    }
    const corpo = await lerCorpo(resposta, maximoDeBytes, controle);
    return corpo === "grande_demais"
      ? { tipo: "grande_demais" }
      : { tipo: "ok", bytes: corpo };
  } catch {
    // Rede ou prazo. Nunca olha a mensagem do erro.
    return {
      tipo: "repetivel",
      codigo: controle.signal.aborted ? "prazo" : "rede",
    };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * O arquivo da mensagem do turno, sem passar do limite. Nunca lanca.
 * "nao_encontrado": o caminho nao e o da mensagem, ou o objeto nao existe.
 */
export async function lerArquivoParaAIa(
  admin: SupabaseClient,
  entrada: {
    clinicId: string;
    messageId: string;
    mediaUrl: string | null;
    maximoDeBytes: number;
    prazoMs?: number;
  },
): Promise<ArquivoDoStorage> {
  const caminho = caminhoDoArquivoDaMensagem(
    entrada.mediaUrl,
    entrada.clinicId,
    entrada.messageId,
  );
  if (caminho === null) {
    return { tipo: "nao_encontrado" };
  }
  const inicio = Date.now();
  const prazoTotal = entrada.prazoMs ?? PRAZO_DO_ARQUIVO_NO_STORAGE_MS;
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    const restante = prazoTotal - (Date.now() - inicio);
    if (restante < 250) {
      return { tipo: "falhou", codigo: "prazo" };
    }
    const lida = await umaTentativa(
      admin,
      caminho,
      entrada.maximoDeBytes,
      restante,
    );
    if (lida.tipo === "ok") {
      return { tipo: "ok", bytes: lida.bytes };
    }
    if (lida.tipo === "grande_demais") {
      return { tipo: "grande_demais" };
    }
    if (lida.tipo === "definitiva") {
      return lida.codigo === "nao_encontrado"
        ? { tipo: "nao_encontrado" }
        : { tipo: "falhou", codigo: lida.codigo };
    }
    if (tentativa === 2) {
      return { tipo: "falhou", codigo: lida.codigo };
    }
    await esperar(ESPERA_ANTES_DA_NOVA_TENTATIVA_MS);
  }
  return { tipo: "falhou", codigo: "desconhecida" };
}
