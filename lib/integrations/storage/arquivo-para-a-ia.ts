import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { correrComPrazo } from "@/lib/domain/conformidade/prazo";

// O arquivo do paciente no Storage, lido para o turno da IA (AG6b, desenho
// 4.3): midia-conversas/{clinica}/{mensagem}, pela SERVICE ROLE (o turno
// roda no servidor; a mensagem ja foi conferida pelo executor, que so pede a
// midia do paciente desta conversa e clinica).
//
// Contrato: NUNCA baixar acima do limite. Antes de baixar, o tamanho pelos
// metadados do objeto (storage.info: data.size, em bytes, no
// @supabase/storage-js 2.112); acima do limite, ou sem tamanho, nada baixa.
// Depois, a URL assinada de 60 s e o download contando os bytes: a leitura
// para assim que passa do tamanho declarado (que ja e no maximo o limite), e
// o corpo que nao bate com o declarado e falha fechada.
//
// PRAZO: um so relogio para tudo (correrComPrazo), o MENOR entre
// PRAZO_DO_ARQUIVO_NO_STORAGE_MS e o de quem chama. info e createSignedUrl
// nao aceitam sinal no storage-js: o corte duro e que segura o prazo deles,
// e nada mais sai depois do corte. O download recebe o sinal (aborta no
// prazo). O `sinal` opcional de quem chama (o corte da porta, o turno
// cancelado) encerra a leitura na hora, do mesmo jeito. UMA nova tentativa,
// com espera curta, so em erro de rede ou 5xx e so se a espera e uma
// tentativa minima couberem no prazo que sobra.
//
// O caminho so vale no formato exato storage://midia-conversas/{clinica}/
// {mensagem}, com a clinica e a mensagem do turno: qualquer outro e
// recusado (falha fechada). Nunca loga nome, conteudo nem caminho (quem
// chama loga so os ids de sempre).

export const BALDE_DA_MIDIA = "midia-conversas";

/**
 * O prazo da leitura do arquivo (PROPOSTA, a calibrar na prova paga). E o
 * teto: um prazo maior de quem chama nao vale aqui.
 */
export const PRAZO_DO_ARQUIVO_NO_STORAGE_MS = 8_000;

const ESPERA_ANTES_DA_NOVA_TENTATIVA_MS = 300;
/** Nenhuma tentativa comeca com menos que isto. */
const PRAZO_MINIMO_DA_TENTATIVA_MS = 250;
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

/** Espera `ms`, ou menos se o sinal abortar. Nunca rejeita. */
function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (sinal.aborted) {
      resolve();
      return;
    }
    // pronto so roda depois que o relogio existe (no tempo ou no sinal).
    const pronto = () => {
      clearTimeout(relogio);
      sinal.removeEventListener("abort", pronto);
      resolve();
    };
    const relogio = setTimeout(pronto, ms);
    sinal.addEventListener("abort", pronto, { once: true });
  });
}

/** Quem chama desistiu (o corte da porta, o turno cancelado). */
const ABORTADO: ArquivoDoStorage = { tipo: "falhou", codigo: "abortado" };

/**
 * O sinal da leitura: aborta no corte duro OU quando quem chama desiste.
 * `desistencia` resolve so no segundo caso, para a leitura terminar na hora
 * mesmo com info ou createSignedUrl travados (eles nao aceitam sinal).
 */
function sinalDaLeitura(
  corte: AbortSignal,
  deQuemChama: AbortSignal | undefined,
): {
  sinal: AbortSignal;
  desistencia: Promise<ArquivoDoStorage>;
  soltar: () => void;
} {
  const controle = new AbortController();
  let avisar: () => void = () => undefined;
  const desistencia = new Promise<ArquivoDoStorage>((resolve) => {
    avisar = () => resolve(ABORTADO);
  });
  const noCorte = () => controle.abort();
  const naDesistencia = () => {
    controle.abort();
    avisar();
  };
  corte.addEventListener("abort", noCorte, { once: true });
  deQuemChama?.addEventListener("abort", naDesistencia, { once: true });
  if (corte.aborted) {
    noCorte();
  }
  if (deQuemChama?.aborted) {
    naDesistencia();
  }
  return {
    sinal: controle.signal,
    desistencia,
    soltar: () => {
      corte.removeEventListener("abort", noCorte);
      deQuemChama?.removeEventListener("abort", naDesistencia);
    },
  };
}

type Tentativa =
  | { tipo: "ok"; bytes: Uint8Array }
  | { tipo: "grande_demais" }
  | { tipo: "repetivel"; codigo: string }
  | { tipo: "definitiva"; codigo: string };

/**
 * O status HTTP de um erro do storage-js (StorageApiError: statusCode, o do
 * corpo, em texto; status, o da resposta). 0 sem status (rede).
 */
function statusDoErro(erro: unknown): number {
  if (typeof erro !== "object" || erro === null) {
    return 0;
  }
  for (const chave of ["statusCode", "status"]) {
    const valor = Number((erro as Record<string, unknown>)[chave]);
    if (Number.isInteger(valor) && valor >= 100 && valor <= 599) {
      return valor;
    }
  }
  return 0;
}

/** A falha de info ou de createSignedUrl: 400 e 404 sao "nao existe". */
function falhaDoStorage(erro: unknown, codigo: string): Tentativa {
  const status = statusDoErro(erro);
  if (status === 404 || status === 400) {
    return { tipo: "definitiva", codigo: "nao_encontrado" };
  }
  return status >= 500 || status === 0
    ? { tipo: "repetivel", codigo }
    : { tipo: "definitiva", codigo };
}

/** Le o corpo contando os bytes; para assim que passa de `limite`. */
async function lerCorpo(
  resposta: Response,
  limite: number,
  controle: AbortController,
): Promise<Uint8Array | "passou"> {
  const leitor = resposta.body?.getReader();
  if (leitor === undefined) {
    const inteiro = new Uint8Array(await resposta.arrayBuffer());
    return inteiro.length > limite ? "passou" : inteiro;
  }
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > limite) {
      controle.abort();
      await leitor.cancel().catch(() => undefined);
      return "passou";
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

/** UMA tentativa (info, URL assinada e download), parando no sinal. */
async function umaTentativa(
  admin: SupabaseClient,
  caminho: string,
  maximoDeBytes: number,
  sinal: AbortSignal,
): Promise<Tentativa> {
  const noPrazo: Tentativa = { tipo: "repetivel", codigo: "prazo" };
  // O download tem o proprio controle: para no limite e tambem no prazo.
  const controle = new AbortController();
  const abortarODownload = () => controle.abort();
  sinal.addEventListener("abort", abortarODownload, { once: true });
  try {
    if (sinal.aborted) {
      return noPrazo;
    }
    const balde = admin.storage.from(BALDE_DA_MIDIA);
    // 1. O tamanho pelos metadados, antes de baixar.
    const info = await balde.info(caminho);
    if (sinal.aborted) {
      return noPrazo;
    }
    if (info.error || !info.data) {
      return falhaDoStorage(info.error, "info_falhou");
    }
    const tamanho: unknown = info.data.size;
    if (
      typeof tamanho !== "number" ||
      !Number.isSafeInteger(tamanho) ||
      tamanho < 0
    ) {
      return { tipo: "definitiva", codigo: "sem_tamanho" };
    }
    if (tamanho > maximoDeBytes) {
      return { tipo: "grande_demais" };
    }
    // 2. A URL assinada curta.
    const assinada = await balde.createSignedUrl(
      caminho,
      VALIDADE_DA_URL_SEGUNDOS,
    );
    if (sinal.aborted) {
      return noPrazo;
    }
    if (assinada.error || !assinada.data?.signedUrl) {
      return falhaDoStorage(assinada.error, "assinatura_falhou");
    }
    // 3. O download, com o sinal, contado ate o tamanho declarado.
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
    const corpo = await lerCorpo(resposta, tamanho, controle);
    if (sinal.aborted) {
      return noPrazo;
    }
    // Maior que o declarado (cortado) ou menor: o objeto nao e o que os
    // metadados dizem. Falha fechada.
    if (corpo === "passou" || corpo.length !== tamanho) {
      return { tipo: "definitiva", codigo: "tamanho_divergente" };
    }
    return { tipo: "ok", bytes: corpo };
  } catch {
    // Rede ou prazo. Nunca olha a mensagem do erro.
    return sinal.aborted ? noPrazo : { tipo: "repetivel", codigo: "rede" };
  } finally {
    sinal.removeEventListener("abort", abortarODownload);
  }
}

/** A tentativa e no maximo UMA nova, dentro do prazo que termina em `fim`. */
async function lerComNovaTentativa(
  admin: SupabaseClient,
  caminho: string,
  maximoDeBytes: number,
  sinal: AbortSignal,
  fim: number,
): Promise<ArquivoDoStorage> {
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    const lida = await umaTentativa(admin, caminho, maximoDeBytes, sinal);
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
    // Repetivel: a espera e uma tentativa minima tem de caber no que sobra.
    if (
      tentativa === 2 ||
      sinal.aborted ||
      fim - Date.now() <
        ESPERA_ANTES_DA_NOVA_TENTATIVA_MS + PRAZO_MINIMO_DA_TENTATIVA_MS
    ) {
      return { tipo: "falhou", codigo: lida.codigo };
    }
    await esperar(ESPERA_ANTES_DA_NOVA_TENTATIVA_MS, sinal);
  }
  return { tipo: "falhou", codigo: "desconhecida" };
}

/**
 * O arquivo da mensagem do turno, sem passar do limite nem do prazo (o
 * menor entre PRAZO_DO_ARQUIVO_NO_STORAGE_MS e `prazoMs`). Nunca lanca.
 * "nao_encontrado": o caminho nao e o da mensagem, ou o objeto nao existe.
 * `sinal` (opcional): quem chama desistiu, a leitura para na hora
 * ("falhou", codigo "abortado"); o prazo vale com ou sem ele.
 */
export async function lerArquivoParaAIa(
  admin: SupabaseClient,
  entrada: {
    clinicId: string;
    messageId: string;
    mediaUrl: string | null;
    maximoDeBytes: number;
    prazoMs?: number;
    sinal?: AbortSignal;
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
  const prazo = Math.floor(
    Math.min(
      PRAZO_DO_ARQUIVO_NO_STORAGE_MS,
      entrada.prazoMs ?? PRAZO_DO_ARQUIVO_NO_STORAGE_MS,
    ),
  );
  if (!(prazo >= PRAZO_MINIMO_DA_TENTATIVA_MS)) {
    return { tipo: "falhou", codigo: "prazo" };
  }
  if (entrada.sinal?.aborted) {
    return ABORTADO;
  }
  const fim = Date.now() + prazo;
  let soltarOSinal: () => void = () => undefined;
  const corrida = await correrComPrazo((corte) => {
    const ligacao = sinalDaLeitura(corte, entrada.sinal);
    soltarOSinal = ligacao.soltar;
    return Promise.race([
      lerComNovaTentativa(
        admin,
        caminho,
        entrada.maximoDeBytes,
        ligacao.sinal,
        fim,
      ),
      ligacao.desistencia,
    ]);
  }, prazo);
  soltarOSinal();
  if (corrida.tipo === "prazo") {
    return { tipo: "falhou", codigo: "prazo" };
  }
  if (corrida.tipo === "erro") {
    return { tipo: "falhou", codigo: "desconhecida" };
  }
  return corrida.valor;
}
