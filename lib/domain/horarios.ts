import { TZDate } from "@date-fns/tz";

// Helpers PUROS de fuso horario da clinica. Regra 3.6 do CLAUDE.md: guardar
// em timestamptz (UTC), exibir e calcular no fuso da clinica, nunca
// new Date() sem fuso em logica de agenda. Todo calculo de "dia da agenda"
// passa por aqui.

/** "HH:MM" ou "HH:MM:SS" para minutos desde a meia-noite. "00:00" = 0. */
export function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(":");
  return Number(h) * 60 + Number(m);
}

export function minutosParaHora(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * O instante UTC que corresponde a `hora` local do dia civil `diaLocal`
 * (aaaa-mm-dd) no fuso dado. E o unico caminho de "hora de jornada" para
 * timestamp, e por isso a virada de dia e o fuso ficam num lugar so.
 */
export function instanteLocal(
  timezone: string,
  diaLocal: string,
  hora: string,
): Date {
  const [ano, mes, dia] = diaLocal.split("-").map(Number);
  const minutos = horaParaMinutos(hora);
  const data = new TZDate(
    ano!,
    (mes ?? 1) - 1,
    dia ?? 1,
    Math.floor(minutos / 60),
    minutos % 60,
    0,
    timezone,
  );
  return new Date(data.getTime());
}

/** O dia civil (aaaa-mm-dd) de um instante, no fuso dado. */
export function diaCivil(timezone: string, instante: Date): string {
  const local = new TZDate(instante.getTime(), timezone);
  const ano = local.getFullYear();
  const mes = String(local.getMonth() + 1).padStart(2, "0");
  const dia = String(local.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** O dia da semana (0=domingo..6=sabado) de um instante, no fuso dado. */
export function weekdayLocal(timezone: string, instante: Date): number {
  return new TZDate(instante.getTime(), timezone).getDay();
}

/** Minutos desde a meia-noite LOCAL de um instante, no fuso dado. */
export function minutosLocais(timezone: string, instante: Date): number {
  const local = new TZDate(instante.getTime(), timezone);
  return local.getHours() * 60 + local.getMinutes();
}

/** Soma dias a um dia civil (aaaa-mm-dd), sem envolver fuso. */
export function somarDias(diaLocal: string, dias: number): string {
  const [ano, mes, dia] = diaLocal.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, (mes ?? 1) - 1, (dia ?? 1) + dias));
  const a = data.getUTCFullYear();
  const m = String(data.getUTCMonth() + 1).padStart(2, "0");
  const d = String(data.getUTCDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

/**
 * Todos os dias civis (no fuso da clinica) tocados pelo intervalo
 * [rangeStart, rangeEnd), em ordem. Inclui o dia ANTERIOR ao primeiro,
 * porque uma jornada que vira o dia (22:00 as 02:00) comeca na vespera e
 * invade o range.
 */
export function diasCivisNoRange(
  timezone: string,
  rangeStart: Date,
  rangeEnd: Date,
): string[] {
  const primeiro = somarDias(diaCivil(timezone, rangeStart), -1);
  const ultimo = diaCivil(timezone, new Date(rangeEnd.getTime() - 1));
  const dias: string[] = [];
  let atual = primeiro;
  while (atual <= ultimo) {
    dias.push(atual);
    atual = somarDias(atual, 1);
  }
  return dias;
}

/** Inicio (00:00 local) e fim exclusivo (00:00 do dia seguinte) de um dia civil, em UTC. */
export function limitesDoDia(
  timezone: string,
  diaLocal: string,
): { inicio: Date; fim: Date } {
  return {
    inicio: instanteLocal(timezone, diaLocal, "00:00"),
    fim: instanteLocal(timezone, somarDias(diaLocal, 1), "00:00"),
  };
}
