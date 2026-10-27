// As frases fixas da agenda da IA (AG4, 27/10/2026; decisao D-31): nos
// momentos que decidem, o SISTEMA escreve a resposta (o modelo so chama a
// ferramenta), com o dia e a hora no formato da agenda e no fuso da clinica.
// Os textos moram em lib/domain/textos-padrao.ts (T1, T3 e T4 sao proposta;
// T2 e o do botao do toque, RESPOSTA_CANCELADA). Cada frase sai pelo filtro
// de saida INTEIRO, com os fatos do turno, como qualquer resposta da IA
// (lib/agente/laco.ts): bloqueio vira a frase de escalonamento. PURO.

import { renderizarModelo } from "@/lib/domain/modelo-mensagem";
import {
  PERGUNTA_DA_REMARCACAO_PELA_IA,
  PERGUNTA_DO_CANCELAMENTO_PELA_IA,
  RESPOSTA_CANCELADA,
  RESPOSTA_DA_REMARCACAO_PELA_IA,
} from "@/lib/domain/textos-padrao";

/** Um dia e uma hora como a agenda escreve ("quinta, 29/10" e "14:00"). */
export type DiaEHora = { dia: string; hora: string };

/** "29/10" de "quinta, 29/10" (e "29/10/2027" de "sexta, 29/10/2027"). */
export function dataSemSemana(dia: string): string {
  const depois = dia.split(",").slice(1).join(",").trim();
  return depois === "" ? dia : depois;
}

/** T1: "Confirma o cancelamento da sua consulta de quinta, 29/10 às 14:00?" */
export function perguntaDoCancelamento(consulta: DiaEHora): string {
  return renderizarModelo(PERGUNTA_DO_CANCELAMENTO_PELA_IA, {
    dia: consulta.dia,
    hora: consulta.hora,
  });
}

/**
 * T2: o texto do botao (RESPOSTA_CANCELADA), com a data DD/MM, como o
 * interceptador do toque preenche.
 */
export function respostaDoCancelamento(consulta: DiaEHora): string {
  return renderizarModelo(RESPOSTA_CANCELADA, {
    data: dataSemSemana(consulta.dia),
    hora: consulta.hora,
  });
}

/**
 * T3: a reserva do horario novo e a pergunta da remarcacao. `unidade` so
 * quando a clinica tem mais de uma unidade e o horario novo tem uma.
 */
export function perguntaDaRemarcacao(entrada: {
  antiga: DiaEHora;
  nova: DiaEHora;
  unidade: string | null;
}): string {
  return renderizarModelo(PERGUNTA_DA_REMARCACAO_PELA_IA, {
    dia: entrada.antiga.dia,
    hora: entrada.antiga.hora,
    dia_novo: entrada.nova.dia,
    hora_nova: entrada.nova.hora,
    // O aposto fecha com virgula: "as 10:00, na unidade Aldeota, por 10".
    unidade: entrada.unidade === null ? "" : `, na unidade ${entrada.unidade},`,
  });
}

/** T4: a remarcacao pedida, pendente da equipe; a antiga continua marcada. */
export function respostaDaRemarcacao(entrada: {
  antiga: DiaEHora;
  nova: DiaEHora;
}): string {
  return renderizarModelo(RESPOSTA_DA_REMARCACAO_PELA_IA, {
    dia: entrada.antiga.dia,
    hora: entrada.antiga.hora,
    dia_novo: entrada.nova.dia,
    hora_nova: entrada.nova.hora,
  });
}
