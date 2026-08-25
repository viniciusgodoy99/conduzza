// Etiquetas DERIVADAS da lista de Pacientes (Tela 9), puras e sem I/O.
// Os agregados vem da RPC pacientes_resumo; a regra de negocio fica aqui.

// 2 faltas ou mais = risco de falta (spec 10.3).
export const LIMIAR_RISCO_DE_FALTA = 2;

export const DIAS_INATIVIDADE_PADRAO = 90;

export function temRiscoDeFalta(noShowCount: number): boolean {
  return noShowCount >= LIMIAR_RISCO_DE_FALTA;
}

/**
 * Inativo = sem consulta futura E a ultima consulta foi ha MAIS de
 * diasLimite dias (fronteira exata nao conta). Paciente sem consulta
 * nenhuma NAO e inativo: nunca foi ativo, e lead sem historico, e a
 * etiqueta perderia o sentido de "sumiu depois de vir".
 */
export function estaInativo(entrada: {
  temConsultaFutura: boolean;
  ultimaConsultaEm: Date | null;
  agora: Date;
  diasLimite?: number;
}): boolean {
  if (entrada.temConsultaFutura) {
    return false;
  }
  if (entrada.ultimaConsultaEm === null) {
    return false;
  }
  const diasLimite = entrada.diasLimite ?? DIAS_INATIVIDADE_PADRAO;
  const limiteMs = diasLimite * 24 * 60 * 60 * 1000;
  return (
    entrada.agora.getTime() - entrada.ultimaConsultaEm.getTime() > limiteMs
  );
}
