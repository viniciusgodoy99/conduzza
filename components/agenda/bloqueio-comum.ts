import { minutoParaY } from "@/lib/domain/agenda-layout";
import {
  diaCivil,
  instanteLocal,
  limitesDoDia,
  minutosLocais,
  minutosParaHora,
  somarDias,
} from "@/lib/domain/horarios";
import type { IntervaloOcupado } from "@/lib/domain/scheduling";

// Regras puras do bloqueio de horario na Agenda: o periodo digitado vira
// instante no FUSO DA CLINICA (regra 3.6, nunca o do navegador), o periodo
// gravado vira texto de recepcionista e a faixa hachurada e recortada na
// parte visivel da grade. Sem React e sem I/O; testadas em
// tests/unit/domain/bloqueio-na-agenda.test.ts e
// tests/unit/agenda/faixa-de-horas-com-bloqueio.test.ts.

/** Dica da acao "Bloquear horario" para quem nao pode (a RLS e a mesma). */
export const DICA_BLOQUEAR_SEM_PERMISSAO =
  "Somente administradores e gestores bloqueiam horários";

/** Dica do "Remover bloqueio" para quem nao pode. */
export const DICA_REMOVER_SEM_PERMISSAO =
  "Somente administradores e gestores removem bloqueios";

/** O periodo como a tela guarda: datas aaaa-mm-dd e horas HH:MM, locais. */
export type PeriodoDoFormulario = {
  /** Dia inteiro: de 00:00 do primeiro dia ate 00:00 do dia seguinte ao ultimo. */
  diaInteiro: boolean;
  dataInicio: string;
  horaInicio: string;
  dataFim: string;
  horaFim: string;
};

export type PeriodoCalculado =
  { ok: true; inicio: Date; fim: Date } | { ok: false; erro: string };

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Converte o periodo do formulario em instantes, lendo data e hora no fuso
 * da clinica. No dia inteiro o fim e EXCLUSIVO: 00:00 do dia seguinte ao
 * ultimo dia, para o bloqueio cobrir o ultimo dia todo.
 */
export function periodoDoBloqueio(
  periodo: PeriodoDoFormulario,
  timezone: string,
): PeriodoCalculado {
  if (!DIA_RE.test(periodo.dataInicio) || !DIA_RE.test(periodo.dataFim)) {
    return {
      ok: false,
      erro: periodo.diaInteiro
        ? "Informe o primeiro e o último dia do bloqueio."
        : "Informe o início e o fim do bloqueio.",
    };
  }
  if (periodo.diaInteiro) {
    if (periodo.dataFim < periodo.dataInicio) {
      return {
        ok: false,
        erro: "O último dia precisa ser o mesmo ou depois do primeiro.",
      };
    }
    return {
      ok: true,
      inicio: instanteLocal(timezone, periodo.dataInicio, "00:00"),
      fim: instanteLocal(timezone, somarDias(periodo.dataFim, 1), "00:00"),
    };
  }
  if (!HORA_RE.test(periodo.horaInicio) || !HORA_RE.test(periodo.horaFim)) {
    return { ok: false, erro: "Informe o início e o fim do bloqueio." };
  }
  const inicio = instanteLocal(
    timezone,
    periodo.dataInicio,
    periodo.horaInicio,
  );
  const fim = instanteLocal(timezone, periodo.dataFim, periodo.horaFim);
  if (fim.getTime() <= inicio.getTime()) {
    return {
      ok: false,
      erro: "O fim do bloqueio precisa ser depois do início.",
    };
  }
  return { ok: true, inicio, fim };
}

/**
 * A data de fim acompanha a de inicio enquanto a pessoa nao escolheu outra
 * (estava igual a antiga) e nunca fica antes dela.
 */
export function dataFimAoMudarInicio(
  dataInicioAnterior: string,
  dataFimAtual: string,
  novaDataInicio: string,
): string {
  if (
    !dataFimAtual ||
    dataFimAtual === dataInicioAnterior ||
    dataFimAtual < novaDataInicio
  ) {
    return novaDataInicio;
  }
  return dataFimAtual;
}

/**
 * O dia e a hora de um clique no vao da grade, no FUSO DA CLINICA (regra
 * 3.6), para o "Bloquear este horario" do modal de consulta nova abrir o
 * dialogo ja no horario clicado. Na Semana o dia do clique pode nao ser o
 * dia da barra, por isso o dia sai do proprio instante.
 */
export function horarioDoVao(
  inicio: Date,
  timezone: string,
): { dia: string; hora: string } {
  return {
    dia: diaCivil(timezone, inicio),
    hora: minutosParaHora(minutosLocais(timezone, inicio)),
  };
}

/** "aaaa-mm-dd" para "dd/mm". */
function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/**
 * O periodo de um bloqueio gravado, em texto, no fuso da clinica:
 * "30/09, das 14:00 às 18:00", "30/09, dia inteiro", "30/09 a 05/10, dias
 * inteiros", "30/09, das 14:00 até o fim do dia" ou, atravessando dias,
 * "30/09 às 14:00 até 01/10 às 18:00".
 */
export function descreverPeriodoDoBloqueio(
  inicioISO: string,
  fimISO: string,
  timezone: string,
): string {
  const inicio = new Date(inicioISO);
  const fim = new Date(fimISO);
  const diaInicio = diaCivil(timezone, inicio);
  const diaFim = diaCivil(timezone, fim);
  const minInicio = minutosLocais(timezone, inicio);
  const minFim = minutosLocais(timezone, fim);
  const horaInicio = minutosParaHora(minInicio);
  const horaFim = minutosParaHora(minFim);

  if (minFim === 0 && diaFim > diaInicio) {
    const ultimoDia = somarDias(diaFim, -1);
    if (minInicio === 0) {
      return ultimoDia === diaInicio
        ? `${diaCurto(diaInicio)}, dia inteiro`
        : `${diaCurto(diaInicio)} a ${diaCurto(ultimoDia)}, dias inteiros`;
    }
    if (ultimoDia === diaInicio) {
      return `${diaCurto(diaInicio)}, das ${horaInicio} até o fim do dia`;
    }
  }
  if (diaInicio === diaFim) {
    return `${diaCurto(diaInicio)}, das ${horaInicio} às ${horaFim}`;
  }
  return `${diaCurto(diaInicio)} às ${horaInicio} até ${diaCurto(diaFim)} às ${horaFim}`;
}

/**
 * Posicao da faixa do bloqueio na coluna, recortada na parte visivel da
 * grade. Sem o recorte, um bloqueio de varios dias (ferias) desenhava uma
 * faixa de milhares de pixels que subia por baixo do cabecalho e esticava a
 * rolagem da grade. Fora da parte visivel, null.
 */
export function faixaNaGrade(params: {
  inicio: Date;
  fim: Date;
  inicioVisivel: Date;
  alturaHoraPx: number;
  alturaTotal: number;
}): { top: number; height: number } | null {
  const y = (instante: Date) =>
    minutoParaY(
      (instante.getTime() - params.inicioVisivel.getTime()) / 60_000,
      params.alturaHoraPx,
    );
  const top = Math.max(0, y(params.inicio));
  const base = Math.min(params.alturaTotal, y(params.fim));
  if (base <= top) {
    return null;
  }
  return { top, height: base - top };
}

/**
 * Os bloqueios recortados no dia civil da clinica (de 00:00 a 00:00 do dia
 * seguinte, no fuso dela), para a faixa de horas da grade
 * (faixaDeHorasVisivel). Sem o recorte, ferias que comecaram ontem as 22:00
 * seriam lidas como 22:00 de hoje. O que nao toca o dia sai da lista.
 */
export function bloqueiosRecortadosNoDia(
  bloqueios: readonly { starts_at: string; ends_at: string }[],
  timezone: string,
  dia: string,
): IntervaloOcupado[] {
  const { inicio, fim } = limitesDoDia(timezone, dia);
  const recortados: IntervaloOcupado[] = [];
  for (const bloqueio of bloqueios) {
    const comeco = Math.max(Date.parse(bloqueio.starts_at), inicio.getTime());
    const termino = Math.min(Date.parse(bloqueio.ends_at), fim.getTime());
    if (termino > comeco) {
      recortados.push({
        startsAt: new Date(comeco),
        endsAt: new Date(termino),
      });
    }
  }
  return recortados;
}

/**
 * Os bloqueios que cruzam o horario da consulta (sobreposicao aberta: so
 * encostar nao conta). O bloqueio criado "mesmo assim" por cima de uma
 * consulta fica coberto pelo bloco dela na grade; o menu da consulta mostra
 * estes para o bloqueio continuar visivel e removivel.
 */
export function bloqueiosQueCruzam<
  B extends { starts_at: string; ends_at: string },
>(
  bloqueios: readonly B[],
  consulta: { starts_at: string; ends_at: string },
): B[] {
  const inicio = Date.parse(consulta.starts_at);
  const fim = Date.parse(consulta.ends_at);
  return bloqueios.filter(
    (b) => Date.parse(b.starts_at) < fim && Date.parse(b.ends_at) > inicio,
  );
}
