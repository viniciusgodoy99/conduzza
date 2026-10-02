// Abas de Cadastros (Tela 8). Modulo sem "use client" porque a pagina
// (servidor) e o cliente leem a mesma lista.
//
// Decisao do dono de 29/09/2026: Vinculos, Recursos e Bloqueios sairam da
// tela. Quem faz cada procedimento (e por qual convenio, preco e duracao)
// passou para dentro do modal do Procedimento; o bloqueio de horario virou
// acao da Agenda; recursos sairam da tela (a coluna e a trava do banco
// continuam). Link antigo nao quebra: cada aba que saiu tem um destino.

export const ABAS_DE_CADASTROS = [
  ["profissionais", "Profissionais"],
  ["procedimentos", "Procedimentos"],
  ["convenios", "Convênios"],
  ["pacotes", "Pacotes"],
  ["unidades", "Unidades"],
] as const;

export type AbaDeCadastros = (typeof ABAS_DE_CADASTROS)[number][0];

export const ABA_PADRAO_DE_CADASTROS: AbaDeCadastros = "profissionais";

// Para onde vai o link antigo de cada aba que saiu. Map, e nao objeto, para
// "?aba=constructor" nao casar com nada herdado do prototipo.
const DESTINO_DA_ABA_QUE_SAIU: ReadonlyMap<string, AbaDeCadastros> = new Map<
  string,
  AbaDeCadastros
>([
  ["vinculos", "procedimentos"],
  ["recursos", ABA_PADRAO_DE_CADASTROS],
  ["bloqueios", ABA_PADRAO_DE_CADASTROS],
]);

function ehAbaDeCadastros(aba: string): aba is AbaDeCadastros {
  return ABAS_DE_CADASTROS.some(([chave]) => chave === aba);
}

/** A aba pedida na URL, ou a padrao quando ela nao existe. */
export function abaDeCadastros(aba: string | undefined): AbaDeCadastros {
  return aba !== undefined && ehAbaDeCadastros(aba)
    ? aba
    : ABA_PADRAO_DE_CADASTROS;
}

/**
 * Endereco para onde redirecionar quando a URL pede uma aba que saiu de
 * Cadastros (?aba=vinculos vai para Procedimentos; recursos e bloqueios, para
 * a aba padrao). Null quando a URL ja serve como esta.
 */
export function redirecionamentoDeAbaQueSaiu(
  aba: string | string[] | undefined,
): string | null {
  if (typeof aba !== "string") {
    return null;
  }
  const destino = DESTINO_DA_ABA_QUE_SAIU.get(aba);
  if (destino === undefined) {
    return null;
  }
  return destino === ABA_PADRAO_DE_CADASTROS
    ? "/cadastros"
    : `/cadastros?aba=${destino}`;
}
