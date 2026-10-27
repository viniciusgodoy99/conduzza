import type { AppointmentStatus } from "@/lib/design/status";
import { eCancelamento } from "@/lib/domain/appointment-status";

// Os dados que o paciente informou a IA para marcar (AG3, D-7): as regras
// PURAS do "Ver dados informados" que o servidor (a acao da Agenda) e a tela
// usam juntos. Revisao final da AG3 (achados 12 e 13): o CPF e a
// carteirinha saem do servidor so mascarados (o inteiro, so pela acao de
// revelar, que rele pela RPC e grava a trilha), e a situacao da consulta
// diz o que o dialogo fala dos dados (pendente, aprovada, recusada,
// cancelada). Sem dado de paciente aqui: so as regras.

/** "12345678909" vira "123.456.789-09"; fora de 11 digitos, como veio. */
export function formatarCpf(cpf: string): string {
  const digitos = cpf.replace(/\D/g, "");
  return digitos.length === 11
    ? `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`
    : cpf;
}

/**
 * O CPF mascarado como o governo publica (so os digitos do meio):
 * "12345678909" vira "•••.456.789-••". Fora de 11 digitos, tudo oculto.
 */
export function mascararCpf(cpf: string): string {
  const digitos = cpf.replace(/\D/g, "");
  return digitos.length === 11
    ? `•••.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-••`
    : "•••.•••.•••-••";
}

/** Abaixo disto, a carteirinha fica oculta inteira (os ultimos dariam tudo). */
const MINIMO_PARA_MOSTRAR_O_FIM = 8;

/**
 * A carteirinha mascarada: os 4 ultimos caracteres (letra ou digito) e o
 * resto como pontos, sem os espacos e os separadores do original; curta
 * (menos de 8), oculta inteira.
 */
export function mascararCarteirinha(carteirinha: string): string {
  const caracteres = Array.from(carteirinha.replace(/[^\p{L}\p{N}]/gu, ""));
  if (caracteres.length < MINIMO_PARA_MOSTRAR_O_FIM) {
    return "••••••";
  }
  return `${"•".repeat(caracteres.length - 4)}${caracteres.slice(-4).join("")}`;
}

/** O que aconteceu com a consulta que a IA marcou. */
export type SituacaoDaConsulta = "pendente" | "aprovada" | "recusada" | "cancelada";

/**
 * A situacao da consulta para o dialogo: cancelada (por quem for), recusada
 * pela equipe, pendente da aprovacao ou aprovada.
 */
export function situacaoDaConsulta(consulta: {
  status: AppointmentStatus;
  approval_status: string | null | undefined;
}): SituacaoDaConsulta {
  if (eCancelamento(consulta.status)) {
    return "cancelada";
  }
  if (consulta.approval_status === "recusado") {
    return "recusada";
  }
  return consulta.approval_status === "pendente" ? "pendente" : "aprovada";
}
