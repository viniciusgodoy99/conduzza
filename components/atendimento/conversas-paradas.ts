// Regras puras do "Resolver as conversas paradas" do Atendimento (onda 2,
// decisao P11b do dono, opcao a): os dias que a pessoa escolhe na hora
// (7, 15, 30 ou 60; nenhum marcado de antemao: o N nao e inventado), o
// instante do corte, os textos e o evento que cada conversa ganha no fio.
// Modulo puro, sem "use client": a tela, a Server Action e os testes usam o
// mesmo. Nenhum dado de paciente: so contagens.

/**
 * O maximo de conversas resolvidas numa vez (a Server Action resolve as
 * mais antigas primeiro). Revisao da onda 2: o dialogo diz isso ANTES de
 * confirmar, e o botao mostra a quantidade desta vez.
 */
export const LOTE_DAS_PARADAS = 500;

/** As opcoes de "parada ha mais de N dias" (decisao do dono). */
export const DIAS_PARADA = [7, 15, 30, 60] as const;

export type DiasParada = (typeof DIAS_PARADA)[number];

/** O que as acoes devolvem: a contagem, ou o que foi resolvido e o resto. */
export type ResultadoDasParadas =
  { ok: true; total: number; restam?: number } | { ok: false; error: string };

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O instante antes do qual a conversa esta parada: agora menos N dias
 * (duracao absoluta, a mesma em qualquer fuso), em ISO para o filtro.
 */
export function instanteDoCorte(dias: DiasParada, agoraMs: number): string {
  return new Date(agoraMs - dias * UM_DIA_MS).toISOString();
}

/** O evento no fio da conversa resolvida em lote (sem dado de paciente). */
export function eventoDaConversaParada(dias: DiasParada): string {
  return `Conversa resolvida: estava parada há mais de ${dias} dias.`;
}

/** "Mais de 30 dias" (a opcao do dialogo). */
export function rotuloDosDias(dias: DiasParada): string {
  return `Mais de ${dias} dias`;
}

/**
 * O que o dialogo diz depois de contar, para os dias escolhidos. Acima do
 * lote, diz antes de confirmar que vao as mais antigas e que o resto pede
 * repetir a acao (revisao da onda 2).
 */
export function textoDaContagem(total: number, dias: DiasParada): string {
  if (total === 0) {
    return `Nenhuma conversa parada há mais de ${dias} dias.`;
  }
  if (total > LOTE_DAS_PARADAS) {
    const resto = total - LOTE_DAS_PARADAS;
    return `${total.toLocaleString("pt-BR")} conversas paradas há mais de ${dias} dias. Desta vez vão ser resolvidas as ${LOTE_DAS_PARADAS.toLocaleString("pt-BR")} mais antigas; ${
      resto === 1
        ? "para a outra, resolva de novo depois."
        : `para as outras ${resto.toLocaleString("pt-BR")}, resolva de novo depois.`
    }`;
  }
  return total === 1
    ? `1 conversa parada há mais de ${dias} dias vai ser resolvida.`
    : `${total.toLocaleString("pt-BR")} conversas paradas há mais de ${dias} dias vão ser resolvidas.`;
}

/**
 * O botao de confirmar, com a quantidade DESTA vez (no maximo o lote),
 * com o separador de milhar.
 */
export function textoDoConfirmar(total: number): string {
  const destaVez = Math.min(total, LOTE_DAS_PARADAS);
  return destaVez === 1
    ? "Resolver 1 conversa"
    : `Resolver ${destaVez.toLocaleString("pt-BR")} conversas`;
}

/** O aviso do fim: quantas resolveu e, se sobrou, quantas restam. */
export function textoDoFim(
  resolvidas: number,
  restam: number | undefined,
): string {
  const feitas =
    resolvidas === 1
      ? "1 conversa resolvida."
      : `${resolvidas.toLocaleString("pt-BR")} conversas resolvidas.`;
  if (!restam) {
    return feitas;
  }
  return restam === 1
    ? `${feitas} Ainda há 1 conversa parada: resolva de novo para terminar.`
    : `${feitas} Ainda há ${restam.toLocaleString("pt-BR")} conversas paradas: resolva de novo para terminar.`;
}

export const TEXTOS_DAS_PARADAS = {
  botao: "Resolver conversas paradas",
  titulo: "Resolver as conversas paradas?",
  descricao:
    "As conversas abertas com a equipe que estão sem nenhuma mensagem há mais tempo do que o escolhido passam para Resolvida. Se o paciente escrever de novo, ele volta a aparecer no Atendimento.",
  rotuloDoGrupo: "Paradas há quanto tempo",
  porQue:
    "Com o assistente atendendo os contatos, a conversa que já está aberta com a equipe continua com a equipe. Resolvendo as antigas, a próxima mensagem desses pacientes já pode ser atendida pelo assistente.",
  escolhaAntes: "Escolha há quanto tempo a conversa está parada.",
  contando: "Contando as conversas...",
  semPermissao:
    "Só o administrador e o gestor resolvem as conversas paradas de uma vez.",
  sessaoExpirada: "Sessão expirada. Entre de novo.",
  foraDoAgente:
    "Esta ação está disponível só nas clínicas com o assistente de IA.",
  dadosInvalidos: "Dados inválidos. Recarregue a página e tente de novo.",
  naoContou: "Não foi possível contar as conversas. Tente de novo.",
  naoResolveu: "Não foi possível resolver as conversas. Tente de novo.",
  semResposta: "O servidor não respondeu. Confira a conexão e tente de novo.",
  nenhumaParaResolver: "Não há conversa parada para resolver com esta escolha.",
  resolvendo: "Resolvendo...",
} as const;
