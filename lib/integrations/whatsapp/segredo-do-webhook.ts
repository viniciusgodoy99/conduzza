import { createHash, timingSafeEqual } from "node:crypto";

// Quem chama o webhook de entrada do WhatsApp, lido da URL, e a conferencia
// do segredo. Puro de proposito (sem banco): a rota le as linhas e decide com
// estas funcoes, e os testes de unidade provam a decisao sem servidor.
//
// Duas formas de URL convivem (docs/07, Compatibilidade):
//   - NOVA: ?clinic=<clinica>&account=<numero>&secret=<segredo>. O numero
//     vem dito; o segredo e o DELE.
//   - LEGADA: ?clinic=<clinica>&secret=<segredo>, que as instancias em
//     producao usam hoje e continua valendo. O numero e achado pelo segredo,
//     entre os numeros ativos da clinica.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdentificacaoDoWebhook =
  | {
      tipo: "numero";
      accountId: string;
      /** Quando a URL traz a clinica, ela tem de ser a do numero. */
      clinicId: string | null;
      segredo: string;
    }
  | { tipo: "legado"; clinicId: string; segredo: string };

/**
 * Le clinica, numero e segredo da URL. null = recusar com 401 (nada de dizer
 * qual parte faltou).
 *
 * Parametro PRESENTE e malformado recusa, mesmo vazio: `?account=` nao cai no
 * caminho legado por acidente.
 */
export function lerIdentificacaoDoWebhook(
  params: URLSearchParams,
): IdentificacaoDoWebhook | null {
  const segredo = params.get("secret") ?? "";
  if (segredo.length === 0) {
    return null;
  }
  const clinica = params.get("clinic");
  const numero = params.get("account");

  if (numero !== null) {
    if (!UUID_PATTERN.test(numero)) {
      return null;
    }
    if (clinica !== null && !UUID_PATTERN.test(clinica)) {
      return null;
    }
    return {
      tipo: "numero",
      accountId: numero.toLowerCase(),
      clinicId: clinica === null ? null : clinica.toLowerCase(),
      segredo,
    };
  }

  if (clinica === null || !UUID_PATTERN.test(clinica)) {
    return null;
  }
  return { tipo: "legado", clinicId: clinica.toLowerCase(), segredo };
}

function resumo(valor: string): Buffer {
  return createHash("sha256").update(valor, "utf8").digest();
}

/**
 * Compara dois segredos em tempo constante.
 *
 * timingSafeEqual exige buffers do MESMO tamanho, e recusar antes pelo
 * tamanho contaria a quem tenta quantos caracteres o segredo tem. Por isso os
 * dois lados passam pelo SHA-256 (32 bytes sempre) e a comparacao roda
 * inteira em qualquer caso.
 */
export function segredosIguais(esperado: string, recebido: string): boolean {
  return timingSafeEqual(resumo(esperado), resumo(recebido));
}

/**
 * Caminho legado: acha, entre os segredos dos numeros ATIVOS da clinica, o
 * que bate com o da URL.
 *
 * Compara com TODOS, sem parar no primeiro que bate: o tempo da resposta nao
 * diz em que posicao da lista o segredo estava. Numero removido nao entra na
 * lista (quem chama filtra), e a remocao gira o segredo de todo modo.
 */
export function acharNumeroPeloSegredo<T extends { webhook_secret: string }>(
  candidatos: readonly T[],
  segredo: string,
): T | null {
  let achado: T | null = null;
  for (const candidato of candidatos) {
    const bate = segredosIguais(candidato.webhook_secret, segredo);
    if (bate && achado === null) {
      achado = candidato;
    }
  }
  return achado;
}
