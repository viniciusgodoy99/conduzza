// Os textos fixos da lista de espera pela IA (AG5, 27/10/2026; D-40 do dono,
// PENDENTE: construidos com a proposta do desenho, 4.3). Nos momentos que
// decidem, o SISTEMA escreve a resposta (o modelo so chama a ferramenta):
//  - T-E1, a pergunta de confirmacao, depois de pedir_lista_de_espera;
//  - T-E2, a resposta, depois de entrar_na_lista_de_espera.
// (O T-E4, o lembrete da oferta que a reoferta manda, e do sistema e mora em
// lib/domain/lembrete-da-oferta.ts, da frente das telas.)
//
// Cada frase sai pelo filtro de saida INTEIRO, com os fatos do turno, como
// qualquer resposta da IA (lib/agente/laco.ts): bloqueio vira a frase de
// escalonamento. Sem "vaga", sem "garantido", sem prazo, sem posicao na fila
// e sem travessao: o filtro le "vaga" como horario livre, e a IA nunca
// promete que um horario vai abrir. Trocar um texto e trocar a constante (o
// teste das frases roda cada uma preenchida no filtro). PURO.
//
// Revisao da AG5 (achado 5): a oferta da reoferta sai pelo numero que a
// clinica escolheu para a lista de espera (o numero fixo do tipo
// lista_espera, quando configurado), que pode nao ser o desta conversa: a
// mensagem chega "pelo WhatsApp", e nem sempre "por aqui" (por este numero).

import { renderizarModelo } from "@/lib/domain/modelo-mensagem";

/** T-E1: a pergunta de confirmacao (proposta do desenho, D-40). */
export const PERGUNTA_DA_LISTA_DE_ESPERA =
  "Confirma a sua entrada na lista de espera para {{procedimento}}, {{profissional}}, {{pagamento}}, {{preferencia}}? Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp para ficar com ele.";

/** T-E2: a resposta, com a entrada feita (proposta do desenho, D-40). */
export const RESPOSTA_DA_LISTA_DE_ESPERA =
  "Pronto, você entrou na lista de espera para {{procedimento}}, {{profissional}}, {{pagamento}}, {{preferencia}}. Se abrir um horário assim, você recebe uma mensagem pelo WhatsApp.";

/** O profissional da frase ("com Dra. Ana Lima" ou qualquer um). */
export const COM_QUALQUER_PROFISSIONAL = "com qualquer profissional";
/** O pagamento particular. */
export const NO_PARTICULAR = "no particular";

/** Os periodos na frase (waitlist.preferred_shifts). */
export const PERIODO_NA_FRASE = {
  manha: "de manhã",
  tarde: "à tarde",
  noite: "à noite",
} as const;

/** Os dias na frase, de 0 (domingo) a 6 (sabado), no plural. */
export const DIA_NA_FRASE = [
  "aos domingos",
  "às segundas",
  "às terças",
  "às quartas",
  "às quintas",
  "às sextas",
  "aos sábados",
] as const;

/** Os textos da preferencia sem escolha (tudo serve). */
export const PREFERENCIA_EM_QUALQUER = {
  tudo: "em qualquer dia e horário",
  dia: "em qualquer dia",
  horario: "em qualquer horário",
  semana: "de segunda a sexta",
} as const;

type Periodo = keyof typeof PERIODO_NA_FRASE;

/** O pedido da lista de espera como as frases dizem (nomes do Cadastro). */
export type PedidoDaEsperaEmTexto = {
  procedimento: string;
  /** null: qualquer profissional. */
  profissional: string | null;
  /** null: particular; senao o convenio como o Cadastro escreve. */
  convenio: string | null;
  turnos: readonly Periodo[];
  /** 0 (domingo) a 6 (sabado). */
  dias: readonly number[];
};

/** "a", "a e b", "a, b e c". */
function emLista(itens: readonly string[], ligacao = "e"): string {
  if (itens.length <= 1) {
    return itens[0] ?? "";
  }
  return `${itens.slice(0, -1).join(", ")} ${ligacao} ${itens[itens.length - 1]}`;
}

/**
 * A preferencia em texto: "de manhã", "de manhã ou à tarde"; "às segundas
 * e às quartas", "aos sábados", "de segunda a sexta"; juntos, "de manhã,
 * às segundas e às quartas"; nada escolhido, "em qualquer dia e horário".
 * Os tres periodos ou os sete dias sao "qualquer" (o banco tambem normaliza).
 */
export function preferenciaEmTexto(
  turnos: readonly Periodo[],
  dias: readonly number[],
): string {
  const periodos = (["manha", "tarde", "noite"] as const).filter((p) =>
    turnos.includes(p),
  );
  const ordenados = [...new Set(dias)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  const deTurno =
    periodos.length === 0 || periodos.length === 3
      ? null
      : emLista(
          periodos.map((p) => PERIODO_NA_FRASE[p]),
          "ou",
        );
  const deDia =
    ordenados.length === 0 || ordenados.length === 7
      ? null
      : ordenados.join(",") === "1,2,3,4,5"
        ? PREFERENCIA_EM_QUALQUER.semana
        : emLista(ordenados.map((d) => DIA_NA_FRASE[d] ?? ""));
  if (deTurno === null && deDia === null) {
    return PREFERENCIA_EM_QUALQUER.tudo;
  }
  if (deDia === null) {
    return `${deTurno}, ${PREFERENCIA_EM_QUALQUER.dia}`;
  }
  if (deTurno === null) {
    return `${deDia}, ${PREFERENCIA_EM_QUALQUER.horario}`;
  }
  return `${deTurno}, ${deDia}`;
}

function valores(pedido: PedidoDaEsperaEmTexto): Record<string, string> {
  return {
    procedimento: pedido.procedimento,
    profissional:
      pedido.profissional === null
        ? COM_QUALQUER_PROFISSIONAL
        : `com ${pedido.profissional}`,
    pagamento:
      pedido.convenio === null
        ? NO_PARTICULAR
        : `pelo convênio ${pedido.convenio}`,
    preferencia: preferenciaEmTexto(pedido.turnos, pedido.dias),
  };
}

/** T-E1 preenchida. */
export function perguntaDaListaDeEspera(pedido: PedidoDaEsperaEmTexto): string {
  return renderizarModelo(PERGUNTA_DA_LISTA_DE_ESPERA, valores(pedido));
}

/** T-E2 preenchida. */
export function respostaDaListaDeEspera(pedido: PedidoDaEsperaEmTexto): string {
  return renderizarModelo(RESPOSTA_DA_LISTA_DE_ESPERA, valores(pedido));
}

/**
 * A descricao do pedido para a trilha, a nota da equipe e o bloco do modelo
 * ("Limpeza de pele, com Dra. Ana Lima, no particular, de manhã, às
 * segundas"). Nunca dado do paciente.
 */
export function pedidoDaEsperaEmTexto(pedido: PedidoDaEsperaEmTexto): string {
  const v = valores(pedido);
  return `${v.procedimento}, ${v.profissional}, ${v.pagamento}, ${v.preferencia}`;
}
