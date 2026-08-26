import {
  diaCivil,
  horaParaMinutos,
  instanteLocal,
  minutosLocais,
  somarDias,
  weekdayLocal,
} from "./horarios";

// Regras PURAS do motor de reguas (tarefa 4.6). Sem I/O: quem le banco e
// enfileira job vive em lib/jobs. Todo calculo de horario passa pelo fuso da
// clinica (CLAUDE.md 3.6): a janela de envio que a clinica preencheu e
// "08:00 as 18:00 DELA", nunca do servidor.

/**
 * Janela de envio da regua, como a clinica configurou.
 * `inicio` e `fim` sao "HH:MM" (ou "HH:MM:SS", que e o formato do tipo time
 * do Postgres) no fuso da clinica; `diasDaSemana` usa 0=domingo, a mesma
 * convencao de professional_schedule.weekday.
 *
 * Os tres campos nascem nulos de proposito: o check active_exige_janela
 * impede a regua de ser ativada antes de a clinica preencher.
 */
export type JanelaDeEnvio = {
  inicio: string | null;
  fim: string | null;
  diasDaSemana: number[] | null;
};

type JanelaValida = {
  inicio: string;
  inicioMin: number;
  fimMin: number;
  dias: Set<number>;
};

// Janela incompleta nao rende decisao: a regua nem deveria estar ativa. Fim
// menor ou igual ao inicio tambem e recusado, espelhando o check
// janela_coerente do banco (a janela nao atravessa a meia-noite).
function validar(janela: JanelaDeEnvio): JanelaValida | null {
  if (!janela.inicio || !janela.fim) {
    return null;
  }
  if (!janela.diasDaSemana || janela.diasDaSemana.length === 0) {
    return null;
  }
  const inicioMin = horaParaMinutos(janela.inicio);
  const fimMin = horaParaMinutos(janela.fim);
  if (
    !Number.isFinite(inicioMin) ||
    !Number.isFinite(fimMin) ||
    fimMin <= inicioMin
  ) {
    return null;
  }
  return {
    inicio: janela.inicio,
    inicioMin,
    fimMin,
    dias: new Set(janela.diasDaSemana),
  };
}

/**
 * O instante cai dentro da janela, no fuso da clinica?
 *
 * Intervalo meio aberto: o comeco entra, o fim nao. Uma janela que termina as
 * 18:00 nao autoriza mensagem as 18:00 em ponto.
 */
export function dentroDaJanela(
  janela: JanelaDeEnvio,
  instante: Date,
  timezone: string,
): boolean {
  const valida = validar(janela);
  if (!valida) {
    return false;
  }
  if (!valida.dias.has(weekdayLocal(timezone, instante))) {
    return false;
  }
  const minutos = minutosLocais(timezone, instante);
  return minutos >= valida.inicioMin && minutos < valida.fimMin;
}

// Oito dias cobrem qualquer configuracao de dias da semana com folga: se em
// oito dias nenhum dia da janela apareceu, a janela nao tem dia valido.
const DIAS_DE_BUSCA = 8;

/**
 * O proximo momento em que a regua pode enviar, a partir de `instante`.
 *
 * Devolve o proprio `instante` quando ele ja esta dentro da janela, o inicio
 * da proxima janela valida quando esta fora, e null quando a janela e
 * invalida (incompleta ou incoerente).
 */
export function proximaAbertura(
  janela: JanelaDeEnvio,
  instante: Date,
  timezone: string,
): Date | null {
  const valida = validar(janela);
  if (!valida) {
    return null;
  }
  if (dentroDaJanela(janela, instante, timezone)) {
    return instante;
  }
  const hoje = diaCivil(timezone, instante);
  for (let offset = 0; offset <= DIAS_DE_BUSCA; offset++) {
    const dia = somarDias(hoje, offset);
    const abertura = instanteLocal(timezone, dia, valida.inicio);
    if (abertura.getTime() < instante.getTime()) {
      continue;
    }
    if (valida.dias.has(weekdayLocal(timezone, abertura))) {
      return abertura;
    }
  }
  return null;
}

// A run e agendada para starts_at + offset. Se a consulta foi remarcada, a
// conta nao fecha mais e a run velha morre sem enviar: o planner ja criou
// outra na chave nova. Um minuto de tolerancia absorve arredondamento de
// timestamp entre o banco e o worker.
const TOLERANCIA_MS = 60_000;

/**
 * O passo agendado ainda corresponde ao horario atual da consulta?
 * Falso significa consulta remarcada (ou movida) depois do planejamento.
 */
export function passoCondizComAgenda(entrada: {
  startsAt: Date;
  offsetMinutes: number;
  scheduledFor: Date;
}): boolean {
  const esperado =
    entrada.startsAt.getTime() + entrada.offsetMinutes * 60_000;
  return Math.abs(esperado - entrada.scheduledFor.getTime()) <= TOLERANCIA_MS;
}

/**
 * Qual passo usar num toque MANUAL ("Cobrar agora", Tela 2): o de antecedencia
 * mais proxima do tempo que ainda falta para a consulta. E o que faz o texto
 * combinar com a realidade, porque o passo de 24h diz "amanha" e o de 3h diz
 * "hoje": mandar o texto errado confunde mais do que nao mandar.
 *
 * So entra passo ANTES do evento (offset negativo). Empate fica com a maior
 * antecedencia, para a escolha ser estavel independente da ordem da lista.
 */
export function passoMaisProximoDoEvento<T extends { offsetMinutes: number }>(
  passos: readonly T[],
  minutosAteOEvento: number,
): T | null {
  const anteriores = passos
    .filter((passo) => passo.offsetMinutes < 0)
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  let escolhido: T | null = null;
  let menorDistancia = Number.POSITIVE_INFINITY;
  for (const passo of anteriores) {
    const distancia = Math.abs(-passo.offsetMinutes - minutosAteOEvento);
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      escolhido = passo;
    }
  }
  return escolhido;
}
