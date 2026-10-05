// Corrida contra o relogio para as chamadas por modelo do filtro e do portao
// de entrada. PURO (so setTimeout e AbortController).
//
// O SDK ja tem o proprio timeout, mas ele nao basta: um cliente que nunca
// responde, que lanca de forma sincrona ou que devolve lixo nao pode deixar
// o filtro nem o portao pendurados, nem virar "pode seguir". Aqui o corte e
// duro e o resultado e sempre um destes tres: o valor, um erro ou o prazo.

import type { MotivoDaFalha } from "@/lib/domain/conformidade/veredicto";

export type Corrida<T> =
  { tipo: "resultado"; valor: T } | { tipo: "erro" } | { tipo: "prazo" };

/**
 * Roda `executar` com um sinal que aborta no prazo. Nunca rejeita: excecao
 * (sincrona ou nao) vira { tipo: "erro" }, sem olhar a mensagem do erro
 * (ela pode ecoar o texto do paciente).
 */
export async function correrComPrazo<T>(
  executar: (sinal: AbortSignal) => Promise<T>,
  prazoMs: number,
): Promise<Corrida<T>> {
  const controle = new AbortController();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<Corrida<T>>((resolve) => {
    relogio = setTimeout(() => {
      controle.abort();
      resolve({ tipo: "prazo" });
    }, prazoMs);
  });
  const chamada = (async (): Promise<Corrida<T>> => {
    try {
      const valor = await executar(controle.signal);
      return { tipo: "resultado", valor };
    } catch {
      return { tipo: "erro" };
    }
  })();
  try {
    return await Promise.race([chamada, prazo]);
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Corte duro do classificador de entrada. Acima do timeout do SDK no
 * classificador (6 s), com folga para a resposta chegar.
 */
export const PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS = 8_000;

/** Falha produzida pelo proprio corte (prazo, erro, classificador ausente). */
export type FalhaDoCorte = {
  tipo: "falha";
  motivo: Extract<
    MotivoDaFalha,
    "timeout" | "prazo" | "desconhecida" | "sem_cliente"
  >;
  modelo: null;
  uso: null;
  httpStatus: null;
};

function falhaDoCorte(motivo: FalhaDoCorte["motivo"]): FalhaDoCorte {
  return { tipo: "falha", motivo, modelo: null, uso: null, httpStatus: null };
}

/**
 * Chama o classificador de entrada com prazo duro. Devolve o que ele
 * devolveu ou uma falha; nunca rejeita e nunca fica pendurado. O resultado
 * vai para decidirPeloClassificador, que escala tudo que nao for
 * exatamente "nenhum" com confianca alta ou media.
 */
export async function classificarComPrazo<R>(
  classificador: (entrada: {
    mensagens: readonly string[];
    sinal?: AbortSignal;
  }) => Promise<R>,
  mensagens: readonly string[],
  prazoMs: number = PRAZO_DO_CLASSIFICADOR_NO_PORTAO_MS,
): Promise<R | FalhaDoCorte> {
  if (typeof classificador !== "function") {
    return falhaDoCorte("sem_cliente");
  }
  if (!(prazoMs > 0)) {
    return falhaDoCorte("prazo");
  }
  const corrida = await correrComPrazo(
    (sinal) => classificador({ mensagens, sinal }),
    prazoMs,
  );
  if (corrida.tipo === "prazo") {
    return falhaDoCorte("timeout");
  }
  if (corrida.tipo === "erro") {
    return falhaDoCorte("desconhecida");
  }
  return corrida.valor;
}
