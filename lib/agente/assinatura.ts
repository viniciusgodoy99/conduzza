// Assinatura do historico do simulador (revisao de 06/10/2026, achados 6, 8,
// 12 e 18). O simulador nao guarda estado: o navegador manda a conversa
// inteira a cada rodada. Sem assinatura, uma fala "do assistente" forjada
// (ou uma fala antiga do paciente trocada) ia ao modelo como se fosse dele e
// pulava o portao de entrada e o classificador, que so olham as falas do
// paciente ainda nao respondidas.
//
// Cada resposta do assistente volta com uma assinatura do servidor:
//   v1.<n>.<HMAC-SHA256(chave, clinica|quem testa|n|sha256(JSON das n falas
//   que terminam nela, inclusive))>
// onde n = min(FALAS_ASSINADAS, falas ate ela). No pedido seguinte, a
// assinatura da ULTIMA fala do assistente e conferida sobre as n falas que
// terminam nela, do jeito que chegaram. Qualquer fala trocada, inventada ou
// fora de ordem dentro desse trecho recusa a rodada; o que vier ANTES do
// trecho e descartado (nunca chega ao modelo). As falas do paciente depois
// da ultima resposta sao as pendentes: passam pelo portao e pelo
// classificador como sempre.
//
// Por que n falas e nao a conversa inteira: a tela manda so as ultimas
// FALAS_ENVIADAS_PELO_SIMULADOR (20). Com o trecho fixo de 19, a conversa
// pode passar de 20 falas sem quebrar, e tudo que vai ao modelo (as 20 mais
// recentes: o trecho assinado e a pendente) continua conferido.
//
// A chave e derivada de IA_SEGREDO_DO_IDENTIFICADOR (a mesma exigencia do
// safety_identifier: 32 caracteres ou mais), nunca o segredo cru. Nada daqui
// vai para log.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Falas cobertas por uma assinatura (a resposta inclusive). */
export const FALAS_ASSINADAS = 19;

/** Segredo do HMAC: abaixo disto, o ambiente esta mal configurado. */
const TAMANHO_MINIMO_DO_SEGREDO = 32;

const VERSAO = "v1";
const FORMATO = /^v1\.(\d{1,3})\.([0-9a-f]{64})$/;

export type FalaAssinavel = {
  autor: "paciente" | "assistente";
  texto: string;
  /** So nas falas do assistente, como o servidor devolveu. */
  assinatura?: string | null;
};

/**
 * A chave das assinaturas do simulador, derivada do segredo do ambiente.
 * null sem segredo (ou curto demais): o simulador nao roda.
 */
export function chaveDaAssinatura(
  segredo: string | null | undefined,
): Buffer | null {
  const limpo = segredo?.trim() ?? "";
  if (limpo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    return null;
  }
  return createHmac("sha256", limpo)
    .update("conduzza:simulador-do-agente:assinatura:v1", "utf8")
    .digest();
}

function resumoDasFalas(falas: readonly FalaAssinavel[]): string {
  // Lista de pares, para a ordem das chaves nao mudar o resumo.
  return createHash("sha256")
    .update(
      JSON.stringify(falas.map((fala) => [fala.autor, fala.texto])),
      "utf8",
    )
    .digest("hex");
}

function hmac(
  chave: Buffer,
  clinicId: string,
  userId: string,
  falas: readonly FalaAssinavel[],
): string {
  return createHmac("sha256", chave)
    .update(
      [
        VERSAO,
        clinicId.toLowerCase(),
        userId.toLowerCase(),
        String(falas.length),
        resumoDasFalas(falas),
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}

/**
 * A assinatura da ultima fala de `falas` (a resposta que o servidor acabou
 * de dar), cobrindo as ultimas FALAS_ASSINADAS falas ate ela.
 */
export function assinarResposta(entrada: {
  chave: Buffer;
  clinicId: string;
  userId: string;
  falas: readonly FalaAssinavel[];
}): string {
  const trecho = entrada.falas.slice(-FALAS_ASSINADAS);
  return `${VERSAO}.${trecho.length}.${hmac(
    entrada.chave,
    entrada.clinicId,
    entrada.userId,
    trecho,
  )}`;
}

export type HistoricoConferido =
  | {
      ok: true;
      /**
       * O que pode ir ao turno: o trecho assinado e as pendentes, sem nada
       * do que veio antes do trecho.
       */
      falas: FalaAssinavel[];
    }
  | { ok: false };

/**
 * Confere a assinatura da ultima fala do assistente sobre o trecho que ela
 * cobre. Sem fala do assistente, tudo e pendente (o portao confere).
 */
export function conferirHistorico(entrada: {
  chave: Buffer;
  clinicId: string;
  userId: string;
  falas: readonly FalaAssinavel[];
}): HistoricoConferido {
  const { falas } = entrada;
  let ultima = -1;
  for (let i = falas.length - 1; i >= 0; i -= 1) {
    if (falas[i]?.autor === "assistente") {
      ultima = i;
      break;
    }
  }
  if (ultima === -1) {
    return { ok: true, falas: [...falas] };
  }
  const lida = FORMATO.exec(falas[ultima]?.assinatura ?? "");
  const tamanho = lida ? Number(lida[1]) : 0;
  const recebida = lida?.[2];
  if (
    recebida === undefined ||
    !Number.isInteger(tamanho) ||
    tamanho < 1 ||
    tamanho > FALAS_ASSINADAS ||
    tamanho > ultima + 1
  ) {
    return { ok: false };
  }
  const inicio = ultima + 1 - tamanho;
  const esperada = hmac(
    entrada.chave,
    entrada.clinicId,
    entrada.userId,
    falas.slice(inicio, ultima + 1),
  );
  const a = Buffer.from(esperada, "hex");
  const b = Buffer.from(recebida, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false };
  }
  return { ok: true, falas: falas.slice(inicio) };
}
