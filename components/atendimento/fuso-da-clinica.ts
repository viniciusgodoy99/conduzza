import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { diaCivil, somarDias } from "@/lib/domain/horarios";

// Horas e dias do Atendimento no FUSO DA CLINICA (CLAUDE.md 3.6, achado 21).
// Os componentes do Atendimento sao de cliente, e date-fns sem fuso formata
// no fuso do navegador: uma atendente remota, ou o dono do produto em outro
// estado, via a hora das mensagens e o separador de dia deslocados.

export const FUSO_PADRAO = "America/Fortaleza";

function naClinica(instante: string, timezone: string): TZDate {
  return new TZDate(new Date(instante).getTime(), timezone);
}

/** "14:05", no relogio da clinica. */
export function horaNaClinica(instante: string, timezone: string): string {
  return format(naClinica(instante, timezone), "HH:mm");
}

/** "22/09", no calendario da clinica. */
export function dataCurtaNaClinica(instante: string, timezone: string): string {
  return format(naClinica(instante, timezone), "dd/MM");
}

/** "22/09/2026", no calendario da clinica. */
export function dataNaClinica(instante: string, timezone: string): string {
  return format(naClinica(instante, timezone), "dd/MM/yyyy");
}

/** O dia civil ("2026-09-22") em que o instante caiu na clinica. */
export function diaNaClinica(instante: string, timezone: string): string {
  return diaCivil(timezone, new Date(instante));
}

/**
 * Rotulo do separador de dia do fio: "Hoje", "Ontem" ou "Terça, 22 de
 * setembro" (com o ano quando nao for o ano corrente da clinica).
 */
export function rotuloDoDia(
  instante: string,
  timezone: string,
  agora: Date = new Date(),
): string {
  const dia = diaNaClinica(instante, timezone);
  const hoje = diaCivil(timezone, agora);
  if (dia === hoje) {
    return "Hoje";
  }
  if (dia === somarDias(hoje, -1)) {
    return "Ontem";
  }
  const local = naClinica(instante, timezone);
  const mesmoAno = dia.slice(0, 4) === hoje.slice(0, 4);
  const texto = format(
    local,
    mesmoAno ? "EEEE, d 'de' MMMM" : "EEEE, d 'de' MMMM 'de' yyyy",
    { locale: ptBR },
  ).replace("-feira", "");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
