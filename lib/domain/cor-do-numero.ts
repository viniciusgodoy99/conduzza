// Cor de cada numero de WhatsApp da clinica (pedido do dono em 06/10/2026):
// paleta FIXA com nome, a mesma do CHECK whatsapp_account_cor_da_paleta
// (migration 20261006130000). PURO, zero I/O.
//
// A cor identifica o numero, nao e status: vai em marcador e na faixa do topo
// da conversa, sempre com o nome do numero escrito ao lado (regra 5 do
// CLAUDE.md). Os tons vivem em app/globals.css (--numero-<cor> e
// --numero-<cor>-bg), com contraste travado em
// tests/unit/design/contrast.test.ts.

export const CORES_DO_NUMERO = [
  "azul",
  "rosa",
  "verde",
  "roxo",
  "turquesa",
  "laranja",
] as const;

export type CorDoNumero = (typeof CORES_DO_NUMERO)[number];

/** O padrao do banco: o primeiro numero de toda clinica nasce azul. */
export const COR_PADRAO: CorDoNumero = "azul";

export const NOME_DA_COR: Record<CorDoNumero, string> = {
  azul: "Azul",
  rosa: "Rosa",
  verde: "Verde",
  roxo: "Roxo",
  turquesa: "Turquesa",
  laranja: "Laranja",
};

export function ehCorDoNumero(valor: unknown): valor is CorDoNumero {
  return (
    typeof valor === "string" &&
    (CORES_DO_NUMERO as readonly string[]).includes(valor)
  );
}

/**
 * A cor gravada, ou a padrao. Valor fora da paleta (linha de Realtime
 * parcial, banco antigo) nunca quebra a tela: vira azul.
 */
export function corDoNumero(valor: string | null | undefined): CorDoNumero {
  return ehCorDoNumero(valor) ? valor : COR_PADRAO;
}

/**
 * A cor sugerida para um numero novo: a primeira da paleta que nenhum numero
 * ATIVO usa. Com as seis em uso (a clinica nao tem limite de numeros), volta
 * a girar a paleta pela quantidade, para dois numeros seguidos nao nascerem
 * com a mesma cor.
 */
export function primeiraCorLivre(
  usadas: readonly (string | null | undefined)[],
): CorDoNumero {
  const emUso = new Set(usadas);
  const livre = CORES_DO_NUMERO.find((cor) => !emUso.has(cor));
  return (
    livre ??
    CORES_DO_NUMERO[usadas.length % CORES_DO_NUMERO.length] ??
    COR_PADRAO
  );
}

/** Os tokens da cor: marcador (cor plena) e fundo da faixa. */
export const COR_DO_NUMERO_VARS: Record<
  CorDoNumero,
  { marcador: string; fundo: string }
> = {
  azul: { marcador: "var(--numero-azul)", fundo: "var(--numero-azul-bg)" },
  rosa: { marcador: "var(--numero-rosa)", fundo: "var(--numero-rosa-bg)" },
  verde: { marcador: "var(--numero-verde)", fundo: "var(--numero-verde-bg)" },
  roxo: { marcador: "var(--numero-roxo)", fundo: "var(--numero-roxo-bg)" },
  turquesa: {
    marcador: "var(--numero-turquesa)",
    fundo: "var(--numero-turquesa-bg)",
  },
  laranja: {
    marcador: "var(--numero-laranja)",
    fundo: "var(--numero-laranja-bg)",
  },
};
