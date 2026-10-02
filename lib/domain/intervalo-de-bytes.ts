// Intervalo de bytes que a rota de midia pede ao Storage quando o navegador
// toca um audio (02/10/2026). Modulo PURO, sem rede.
//
// O navegador pede o audio em pedacos (cabecalho Range). A rota entrega cada
// pedaco ela mesma, e nunca mais de TETO_DO_PEDACO bytes por resposta: o
// HTTP deixa o servidor devolver menos do que foi pedido (o 206 diz o que
// veio em Content-Range), e o navegador pede o resto em seguida. Assim
// nenhuma resposta da funcao passa do limite de corpo da Vercel, mesmo para
// um audio grande, e nenhum pedaco depende de um link que expira.

/** 1 MiB por resposta: um audio de voz de 1 minuto (64 kbps) cabe em um. */
export const TETO_DO_PEDACO = 1024 * 1024;

export type IntervaloPedido = {
  /** Primeiro byte (inclusivo). */
  inicio: number;
  /** Ultimo byte (inclusivo); null = "ate o fim", que o teto ja limitou. */
  fim: number | null;
};

/**
 * Le o cabecalho Range ("bytes=0-", "bytes=32768-65535") e devolve o
 * intervalo a pedir ao Storage, cortado no teto. Sem Range, ou num formato
 * que a rota nao atende (varios intervalos, sufixo "bytes=-500", lixo),
 * devolve null: a rota repassa o pedido sem intervalo, e o Storage responde
 * o arquivo inteiro (audio de voz e pequeno).
 */
export function intervaloPedido(
  range: string | null,
  teto: number = TETO_DO_PEDACO,
): IntervaloPedido | null {
  if (!range) {
    return null;
  }
  const casou = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!casou) {
    return null;
  }
  const inicio = Number(casou[1]);
  const fimPedido = casou[2] === "" ? null : Number(casou[2]);
  if (!Number.isSafeInteger(inicio)) {
    return null;
  }
  if (fimPedido !== null && (!Number.isSafeInteger(fimPedido) || fimPedido < inicio)) {
    return null;
  }
  const fimDoTeto = inicio + teto - 1;
  return {
    inicio,
    fim: fimPedido === null ? fimDoTeto : Math.min(fimPedido, fimDoTeto),
  };
}

/** O cabecalho Range que a rota manda ao Storage. */
export function cabecalhoRange(intervalo: IntervaloPedido): string {
  return `bytes=${intervalo.inicio}-${intervalo.fim ?? ""}`;
}
