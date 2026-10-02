import type { SupabaseClient } from "@supabase/supabase-js";

import { diaCivil, limitesDoDia, somarDias } from "@/lib/domain/horarios";
import type { PapelDeEtapa } from "@/lib/domain/jornada";

// Agregados do Inicio (Tela 5, Fase 3), calculados no banco pelas RPCs da
// migration 20261002110000_metricas_da_fase_3:
// - resumo_do_dia: os cartoes do DIA (consultas, confirmadas, aguardando,
//   unidades), o mesmo dia da semana passada para a variacao (A1), o ultimo
//   disparo da regua de confirmacao e as 7 barras de D-6 a D;
// - funil_da_jornada: o retrato atual de contact.funnel_stage pelas etapas
//   da jornada da clinica, o mesmo numero do Kanban de Leads.
//
// Regras herdadas de lib/queries/relatorios.ts:
// - Agregado e SQL, nunca contagem no cliente (o PostgREST corta em 1000
//   linhas e o corte e silencioso).
// - Erro de leitura LANCA, nunca vira zero falso. Isso inclui o null das
//   RPCs (trava do papel profissional no banco) e qualquer resposta fora do
//   formato: numero que nao veio nao e "0".
// - Fuso (regra 3.6): os limites chegam PRONTOS em UTC, calculados aqui com
//   limitesDoDia no fuso da clinica. Somar dias e feito no dia CIVIL
//   (somarDias), nunca subtraindo 24h de um instante, entao a janela fica
//   certa ate em fuso com horario de verao.

/** Quantos dias o bloco "Consultas por dia" mostra (D-6 a D). */
export const DIAS_DO_RESUMO = 7;

export type ResumoDoDia = {
  /** O dia civil de hoje no fuso da clinica (aaaa-mm-dd). */
  dia: string;
  hoje: {
    /** Todas as situacoes, inclusive canceladas (igual a "Agendadas"). */
    total: number;
    /** Predicado unico consulta_foi_confirmada (foiConfirmada no TS). */
    confirmadas: number;
    /** agendado ou aguardando_confirmacao. */
    aguardando: number;
    canceladas: number;
    /** unit_id distintos das consultas nao canceladas. */
    unidades: number;
  };
  /** O mesmo dia da semana passada (D-7), para a variacao A1. */
  semanaPassada: { total: number; confirmadas: number };
  /** max(sent_at) da regua de confirmacao hoje, em ISO; null sem disparo. */
  ultimoDisparo: string | null;
  /** D-6 a D, em ordem, sem pular dia; o ultimo e hoje. */
  porDia: { dia: string; total: number }[];
};

export type EtapaDoFunil = {
  chave: string;
  nome: string;
  papel: PapelDeEtapa | null;
  posicao: number;
  /** Contatos que estao nesta etapa AGORA (zero para etapa vazia). */
  total: number;
};

/**
 * Resultado de uma leitura que nao derruba a tela: o bloco que falhou mostra
 * o proprio estado de erro e o resto do Inicio continua de pe.
 */
export type Leitura<T> = { ok: true; dados: T } | { ok: false };

// ---------------------------------------------------------------------------
// Janelas do resumo (puro)
// ---------------------------------------------------------------------------

export type ArgumentosDoResumo = {
  p_inicios: string[];
  p_fim: string;
  p_semana_passada_de: string;
  p_semana_passada_ate: string;
};

/**
 * Os dias civis de D-6 a D e os limites UTC que a RPC resumo_do_dia espera:
 * o inicio de cada um dos 7 dias em ordem crescente, o fim de hoje e o dia
 * inteiro de D-7 (mesmo dia da semana passada).
 */
export function janelasDoResumo(
  timezone: string,
  hoje: string,
): { dias: string[]; argumentos: ArgumentosDoResumo } {
  const dias = Array.from({ length: DIAS_DO_RESUMO }, (_, indice) =>
    somarDias(hoje, indice - (DIAS_DO_RESUMO - 1)),
  );
  const semanaPassada = limitesDoDia(timezone, somarDias(hoje, -7));
  return {
    dias,
    argumentos: {
      p_inicios: dias.map((dia) =>
        limitesDoDia(timezone, dia).inicio.toISOString(),
      ),
      p_fim: limitesDoDia(timezone, hoje).fim.toISOString(),
      p_semana_passada_de: semanaPassada.inicio.toISOString(),
      p_semana_passada_ate: semanaPassada.fim.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Leitura das respostas (puro): formato errado lanca, nunca vira zero
// ---------------------------------------------------------------------------

function exigirPresente(data: unknown, rpc: string): unknown {
  // null e a trava de papel do banco (profissional pedindo agregado da
  // clinica). Nunca renderizar zero no lugar.
  if (data === null || data === undefined) {
    throw new Error(`Recorte indisponível para este perfil (${rpc}).`);
  }
  return data;
}

function formatoInesperado(rpc: string): Error {
  return new Error(`Resposta fora do formato esperado (${rpc}).`);
}

function objeto(valor: unknown, rpc: string): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw formatoInesperado(rpc);
  }
  return valor as Record<string, unknown>;
}

function contagem(valor: unknown, rpc: string): number {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0) {
    throw formatoInesperado(rpc);
  }
  return valor;
}

function texto(valor: unknown, rpc: string): string {
  if (typeof valor !== "string") {
    throw formatoInesperado(rpc);
  }
  return valor;
}

/** Traduz o JSON de resumo_do_dia; dias = os 7 dias civis de D-6 a D. */
export function lerResumoDoDia(
  data: unknown,
  dias: readonly string[],
): ResumoDoDia {
  const rpc = "resumo_do_dia";
  const corpo = objeto(exigirPresente(data, rpc), rpc);
  const hoje = objeto(corpo.hoje, rpc);
  const semanaPassada = objeto(corpo.semana_passada, rpc);

  const ultimo = corpo.ultimo_disparo;
  let ultimoDisparo: string | null = null;
  if (ultimo !== null && ultimo !== undefined) {
    ultimoDisparo = texto(ultimo, rpc);
    if (Number.isNaN(Date.parse(ultimoDisparo))) {
      throw formatoInesperado(rpc);
    }
  }

  if (!Array.isArray(corpo.por_dia)) {
    throw formatoInesperado(rpc);
  }
  const totalPorOrdem = new Map<number, number>();
  for (const item of corpo.por_dia) {
    const linha = objeto(item, rpc);
    totalPorOrdem.set(contagem(linha.ordem, rpc), contagem(linha.total, rpc));
  }
  // ordem 1 = dias[0] (D-6) ... ordem 7 = hoje. Dia faltando e resposta
  // quebrada, nao dia com zero (a RPC devolve os 7 sempre).
  const porDia = dias.map((dia, indice) => {
    const total = totalPorOrdem.get(indice + 1);
    if (total === undefined) {
      throw formatoInesperado(rpc);
    }
    return { dia, total };
  });

  const diaDeHoje = dias[dias.length - 1];
  if (diaDeHoje === undefined) {
    throw formatoInesperado(rpc);
  }

  return {
    dia: diaDeHoje,
    hoje: {
      total: contagem(hoje.total, rpc),
      confirmadas: contagem(hoje.confirmadas, rpc),
      aguardando: contagem(hoje.aguardando, rpc),
      canceladas: contagem(hoje.canceladas, rpc),
      unidades: contagem(hoje.unidades, rpc),
    },
    semanaPassada: {
      total: contagem(semanaPassada.total, rpc),
      confirmadas: contagem(semanaPassada.confirmadas, rpc),
    },
    ultimoDisparo,
    porDia,
  };
}

const PAPEIS: readonly PapelDeEtapa[] = [
  "entrada",
  "agendou",
  "compareceu",
  "perdido",
];

/** Traduz o JSON de funil_da_jornada, mantendo a ordem do banco. */
export function lerFunilDaJornada(data: unknown): EtapaDoFunil[] {
  const rpc = "funil_da_jornada";
  const corpo = exigirPresente(data, rpc);
  if (!Array.isArray(corpo)) {
    throw formatoInesperado(rpc);
  }
  return corpo.map((item) => {
    const linha = objeto(item, rpc);
    const papel = linha.papel;
    if (
      papel !== null &&
      papel !== undefined &&
      !PAPEIS.includes(papel as PapelDeEtapa)
    ) {
      throw formatoInesperado(rpc);
    }
    if (typeof linha.posicao !== "number") {
      throw formatoInesperado(rpc);
    }
    return {
      chave: texto(linha.chave, rpc),
      nome: texto(linha.nome, rpc),
      papel: (papel ?? null) as PapelDeEtapa | null,
      posicao: linha.posicao,
      total: contagem(linha.total, rpc),
    };
  });
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Os numeros do dia da clinica. agora = o instante da requisicao; o dia de
 * hoje e os limites sao tirados dele no fuso da clinica.
 */
export async function fetchResumoDoDia(
  supabase: SupabaseClient,
  clinicId: string,
  timezone: string,
  agora: Date,
): Promise<ResumoDoDia> {
  const hoje = diaCivil(timezone, agora);
  const { dias, argumentos } = janelasDoResumo(timezone, hoje);
  const { data, error } = await supabase.rpc("resumo_do_dia", {
    p_clinic_id: clinicId,
    ...argumentos,
  });
  if (error) {
    throw new Error(error.message);
  }
  return lerResumoDoDia(data, dias);
}

/** As etapas da jornada da clinica com o total atual de cada uma. */
export async function fetchFunilDaJornada(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<EtapaDoFunil[]> {
  const { data, error } = await supabase.rpc("funil_da_jornada", {
    p_clinic_id: clinicId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return lerFunilDaJornada(data);
}
