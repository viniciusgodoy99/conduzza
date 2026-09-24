import { availableSlots, type JanelaSemanal } from "@/lib/domain/scheduling";

// Regras PURAS da remarcacao (achado 85 da revisao de liberacao). A Server
// Action le o banco e decide com estas funcoes; o dialogo usa as mesmas para
// nao oferecer o que o servidor vai recusar.

export const MENSAGEM_SEM_VINCULO =
  "Este profissional não atende este procedimento por este convênio.";

type VinculoCandidato = {
  id: string;
  professional_id: string;
  procedure_id: string;
  insurance_id: string | null;
  duration_min: number;
  active: boolean;
};

/**
 * O vinculo do profissional de destino para O MESMO procedimento e O MESMO
 * convenio (particular e insurance_id nulo). Sem ele a consulta ficaria com o
 * profissional novo e a duracao, o preco e o convenio do antigo.
 */
export function vinculoEquivalente<V extends VinculoCandidato>(
  vinculos: readonly V[],
  alvo: {
    professionalId: string;
    procedureId: string;
    insuranceId: string | null;
  },
): V | null {
  return (
    vinculos.find(
      (v) =>
        v.active &&
        v.professional_id === alvo.professionalId &&
        v.procedure_id === alvo.procedureId &&
        (v.insurance_id ?? null) === (alvo.insuranceId ?? null),
    ) ?? null
  );
}

/**
 * O intervalo [inicio, fim) cabe INTEIRO dentro da jornada do profissional,
 * no fuso da clinica? Reusa o motor de disponibilidade (mesma materializacao
 * de jornada, inclusive a que vira o dia) com grade de 1 minuto e sem
 * ocupacao: sobra um slot comecando exatamente em `inicio` se, e so se, o
 * intervalo inteiro esta dentro de uma faixa (faixas encostadas se unem).
 */
export function cabeNaJornada(params: {
  timezone: string;
  jornada: readonly JanelaSemanal[];
  inicio: Date;
  fim: Date;
}): boolean {
  const { timezone, jornada, inicio, fim } = params;
  const duracaoMin = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
  if (duracaoMin <= 0 || jornada.length === 0) {
    return false;
  }
  const slots = availableSlots({
    timezone,
    rangeStart: inicio,
    rangeEnd: fim,
    durationMin: duracaoMin,
    gridMin: 1,
    schedule: [...jornada],
    blocks: [],
    appointments: [],
    holds: [],
    // O relogio nao entra aqui: a regra e so a jornada.
    now: new Date(0),
  });
  return slots.some((slot) => slot.startsAt.getTime() === inicio.getTime());
}

/** Algum bloqueio encosta no intervalo [inicio, fim)? (sobreposicao aberta) */
export function colideComBloqueio(
  bloqueios: readonly { starts_at: string; ends_at: string }[],
  inicio: Date,
  fim: Date,
): boolean {
  return bloqueios.some(
    (b) =>
      new Date(b.starts_at).getTime() < fim.getTime() &&
      new Date(b.ends_at).getTime() > inicio.getTime(),
  );
}
