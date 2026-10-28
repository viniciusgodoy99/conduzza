// O que a Tela 2 diz depois do "Manter o horário" (revisao da leva 1, R12).
// PURO: a tela so repassa o resultado da action e mostra o que sai daqui.
//
// AG4 (desenho, secao 5): quando a remarcacao pedida pela IA ainda espera a
// equipe na Agenda, a acao nao muda nada e devolve o codigo
// remarcacao_da_ia_pendente com o texto "Há uma remarcação pedida pela IA
// esperando aprovação na Agenda.". E orientacao, nao falha do sistema: sai
// como atencao (warning), nunca como erro nem como sucesso.

export type ResultadoDoManterHorario = {
  ok: boolean;
  error?: string;
  code?: "remarcacao_da_ia_pendente";
};

export type RetornoDoManterHorario = {
  tipo: "success" | "warning" | "error";
  texto: string;
};

export const TEXTOS_DO_MANTER_HORARIO = {
  sucesso: "Horário mantido. O pedido de remarcação saiu da lista.",
  erro: "Não foi possível manter o horário.",
} as const;

export function retornoDoManterHorario(
  resultado: ResultadoDoManterHorario,
): RetornoDoManterHorario {
  if (resultado.ok) {
    return { tipo: "success", texto: TEXTOS_DO_MANTER_HORARIO.sucesso };
  }
  if (resultado.code === "remarcacao_da_ia_pendente" && resultado.error) {
    return { tipo: "warning", texto: resultado.error };
  }
  return {
    tipo: "error",
    texto: resultado.error ?? TEXTOS_DO_MANTER_HORARIO.erro,
  };
}
