import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import {
  formatarPercentual,
  percentualDe,
} from "@/lib/domain/formato-compacto";
import type { PapelDeEtapa } from "@/lib/domain/jornada";

// Textos e escolhas puras dos blocos do Inicio (Fase 3). Ficam fora dos
// componentes para o teste de unidade conferir singular e plural, o fuso do
// "Ultimo disparo" e o rotulo de cada dia sem renderizar nada.

/** A comparacao da variacao A1 dos cartoes do dia. */
export const COMPARADO_COM_O_DIA = "mesmo dia da semana passada";

/** "3 unidades" so quando o dia tem consulta em 2 ou mais unidades. */
export function rodapeDasUnidades(unidades: number): string | undefined {
  return unidades >= 2
    ? `${unidades.toLocaleString("pt-BR")} unidades`
    : undefined;
}

/** "87,2% do total"; sem consulta no dia nao ha taxa (nada no rodape). */
export function rodapeDasConfirmadas(
  confirmadas: number,
  total: number,
): string | undefined {
  const percentual = percentualDe(confirmadas, total);
  return percentual === null
    ? undefined
    : `${formatarPercentual(percentual)}% do total`;
}

/** "Último disparo 09:02" no fuso da clinica (regra 3.6). */
export function rodapeDoAguardando(
  ultimoDisparo: string | null,
  timezone: string,
): string {
  if (ultimoDisparo === null) {
    return "Nenhum disparo hoje";
  }
  const instante = new TZDate(Date.parse(ultimoDisparo), timezone);
  return `Último disparo ${format(instante, "HH:mm")}`;
}

// Curtos como no prototipo ("Sáb" com acento: o "EEEEEE" do ptBR do
// date-fns escreve "sab", e o "EEE" escreve o nome inteiro).
const DIA_DA_SEMANA_CURTO = [
  "Dom",
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
] as const;

export type RotuloDoDia = {
  /** "Hoje" ou o dia da semana curto ("Qui"). */
  nome: string;
  /** "26/09". */
  data: string;
  /** Para o leitor de tela: "quinta-feira, 26 de setembro". */
  falado: string;
  ehHoje: boolean;
};

/**
 * Rotulo de um dia civil (aaaa-mm-dd) do bloco "Consultas por dia". O dia ja
 * e civil da clinica: e lido ao meio-dia em UTC so para nomear a data, sem
 * fuso nenhum envolvido.
 */
export function rotuloDoDia(dia: string, hoje: string): RotuloDoDia {
  const [ano, mes, numero] = dia.split("-").map(Number);
  const data = new TZDate(
    Date.UTC(ano ?? 1970, (mes ?? 1) - 1, numero ?? 1, 12),
    "UTC",
  );
  const ehHoje = dia === hoje;
  const diaEMes = format(data, "d 'de' MMMM", { locale: ptBR });
  return {
    nome: ehHoje ? "Hoje" : (DIA_DA_SEMANA_CURTO[data.getDay()] ?? ""),
    data: format(data, "dd/MM"),
    falado: ehHoje
      ? `hoje, ${diaEMes}`
      : `${format(data, "EEEE", { locale: ptBR })}, ${diaEMes}`,
    ehHoje,
  };
}

/** "1 consulta", "12 consultas". */
export function contarConsultas(total: number): string {
  return `${total.toLocaleString("pt-BR")} ${total === 1 ? "consulta" : "consultas"}`;
}

/** "1 lead", "38 leads". */
export function contarLeads(total: number): string {
  return `${total.toLocaleString("pt-BR")} ${total === 1 ? "lead" : "leads"}`;
}

/**
 * Tom da barra de uma etapa do funil. A barra mede, nao julga (C12): so
 * destaque ou neutro. "Perdido" fica neutro porque nao e avanco na jornada.
 */
export function tomDaEtapa(papel: PapelDeEtapa | null): "destaque" | "neutro" {
  return papel === "perdido" ? "neutro" : "destaque";
}

/** Maior valor da lista (0 para lista vazia): o maximo das barras. */
export function maiorValor(valores: readonly number[]): number {
  return valores.reduce((maior, valor) => Math.max(maior, valor), 0);
}
