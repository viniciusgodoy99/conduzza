// Cabecalho do Inicio (decisao do dono C26, docs/06): data no fuso da
// clinica como eyebrow, saudacao pelo horario LOCAL da clinica e uma frase
// montada so com numeros ja buscados (as contagens de Proximas acoes). Modulo
// PURO: nenhum dado inventado, nenhuma consulta nova, e testavel sem render.

/** Bom dia ate 11h59, boa tarde ate 17h59, boa noite no resto (madrugada
 *  inclusa, que e como a recepcao fala as 2h da manha). */
export function saudacaoDoMomento(minutosLocais: number): string {
  if (minutosLocais >= 5 * 60 && minutosLocais < 12 * 60) {
    return "Bom dia";
  }
  if (minutosLocais >= 12 * 60 && minutosLocais < 18 * 60) {
    return "Boa tarde";
  }
  return "Boa noite";
}

/**
 * Primeiro nome de quem esta logado, ou null quando nao ha nome de verdade:
 * a sessao cai no e-mail (ou em "Usuário") quando o cadastro nao gravou
 * nome, e "Bom dia, maria@clinica.com" seria pior que so "Início".
 */
export function primeiroNome(
  nomeDaSessao: string,
  emailDaSessao: string,
): string | null {
  const nome = nomeDaSessao.trim();
  if (
    nome.length === 0 ||
    nome === emailDaSessao.trim() ||
    nome.includes("@") ||
    nome === "Usuário"
  ) {
    return null;
  }
  return nome.split(/\s+/)[0] ?? null;
}

export type TrechoDoResumo =
  { tipo: "texto"; valor: string } | { tipo: "numero"; valor: string };

function contagem(
  quantidade: number,
  singular: string,
  plural: string,
  nenhum: string,
): TrechoDoResumo[] {
  if (quantidade <= 0) {
    return [{ tipo: "texto", valor: nenhum }];
  }
  return [
    { tipo: "numero", valor: quantidade.toLocaleString("pt-BR") },
    { tipo: "texto", valor: ` ${quantidade === 1 ? singular : plural}` },
  ];
}

/**
 * A frase do cabecalho, em trechos para o numero ir em fonte mono (cz-num).
 * Ex.: "3 confirmações pendentes para amanhã e 1 conversa aguardando você."
 */
export function resumoDoDia({
  confirmacoesAmanha,
  aguardandoVoce,
}: {
  confirmacoesAmanha: number;
  aguardandoVoce: number;
}): TrechoDoResumo[] {
  const trechos: TrechoDoResumo[] = [
    ...contagem(
      confirmacoesAmanha,
      "confirmação pendente para amanhã",
      "confirmações pendentes para amanhã",
      "Nenhuma confirmação pendente para amanhã",
    ),
    { tipo: "texto", valor: " e " },
    ...contagem(
      aguardandoVoce,
      "conversa aguardando você",
      "conversas aguardando você",
      "nenhuma conversa aguardando você",
    ),
    { tipo: "texto", valor: "." },
  ];
  return trechos;
}

/** O resumo como texto corrido (leitor de tela, teste). */
export function textoDoResumo(trechos: TrechoDoResumo[]): string {
  return trechos.map((trecho) => trecho.valor).join("");
}
