import {
  diasCivisNoRange,
  instanteLocal,
  minutosLocais,
  somarDias,
  weekdayLocal,
} from "@/lib/domain/horarios";

// Motor de disponibilidade (tarefa 2.4). PURO e sem I/O, no padrao de
// lib/domain/messaging.ts: recebe arrays, devolve slots. Quem consulta o
// banco (tela da agenda, modal, ferramentas da IA na Fase 3) alimenta as
// entradas, ja filtrando: holds com expires_at > agora, consultas NAO
// canceladas (encaixe INCLUSO: encaixe ocupa o profissional de fato) e a
// ocupacao do recurso quando o procedimento exige um.
//
// Fuso: a jornada semanal e "hora local da clinica" (coluna time); o motor
// materializa cada janela no fuso da clinica e trabalha em UTC dali em
// diante. Janela com ends_at <= starts_at VIRA O DIA (plantao 22:00-02:00).

export type JanelaSemanal = {
  weekday: number; // 0=domingo .. 6=sabado (convencao do Postgres)
  startsAt: string; // "HH:MM" | "HH:MM:SS"
  endsAt: string;
};

export type IntervaloOcupado = { startsAt: Date; endsAt: Date };

export type EntradaDisponibilidade = {
  /** fuso IANA da clinica (clinic.timezone) */
  timezone: string;
  /** busca em [rangeStart, rangeEnd) */
  rangeStart: Date;
  rangeEnd: Date;
  /** duracao do VINCULO (service_link.duration_min), nao do procedimento */
  durationMin: number;
  schedule: JanelaSemanal[];
  blocks: IntervaloOcupado[];
  appointments: IntervaloOcupado[];
  holds: IntervaloOcupado[];
  /** ocupacao do recurso exigido, quando houver (de QUALQUER profissional) */
  resourceBusy?: IntervaloOcupado[];
  /** grade de inicio dos slots; default 15 min, alinhada ao relogio local */
  gridMin?: number;
  /** nada no passado; o chamador passa o agora (testavel) */
  now: Date;
};

export type SlotLivre = { startsAt: Date; endsAt: Date };

type Intervalo = { inicio: number; fim: number }; // epoch ms

function paraIntervalos(ocupados: IntervaloOcupado[]): Intervalo[] {
  return ocupados
    .map((o) => ({ inicio: o.startsAt.getTime(), fim: o.endsAt.getTime() }))
    .filter((o) => o.fim > o.inicio)
    .sort((a, b) => a.inicio - b.inicio);
}

/** Une intervalos sobrepostos ou encostados num conjunto ordenado disjunto. */
function mesclar(intervalos: Intervalo[]): Intervalo[] {
  const resultado: Intervalo[] = [];
  for (const atual of intervalos) {
    const ultimo = resultado[resultado.length - 1];
    if (ultimo && atual.inicio <= ultimo.fim) {
      ultimo.fim = Math.max(ultimo.fim, atual.fim);
    } else {
      resultado.push({ ...atual });
    }
  }
  return resultado;
}

/** Subtrai os ocupados de uma janela, devolvendo os livres. */
function subtrair(janela: Intervalo, ocupados: Intervalo[]): Intervalo[] {
  const livres: Intervalo[] = [];
  let cursor = janela.inicio;
  for (const ocupado of ocupados) {
    if (ocupado.fim <= cursor) {
      continue;
    }
    if (ocupado.inicio >= janela.fim) {
      break;
    }
    if (ocupado.inicio > cursor) {
      livres.push({
        inicio: cursor,
        fim: Math.min(ocupado.inicio, janela.fim),
      });
    }
    cursor = Math.max(cursor, ocupado.fim);
    if (cursor >= janela.fim) {
      break;
    }
  }
  if (cursor < janela.fim) {
    livres.push({ inicio: cursor, fim: janela.fim });
  }
  return livres;
}

/**
 * Materializa as janelas de jornada em intervalos UTC dentro do range.
 * Cada dia civil do range (mais a vespera, por causa de janela que vira o
 * dia) contribui com as faixas do seu weekday.
 */
function materializarJornada(input: EntradaDisponibilidade): Intervalo[] {
  const janelas: Intervalo[] = [];
  const rangeInicio = input.rangeStart.getTime();
  const rangeFim = input.rangeEnd.getTime();

  for (const dia of diasCivisNoRange(
    input.timezone,
    input.rangeStart,
    input.rangeEnd,
  )) {
    const weekday = weekdayLocal(
      input.timezone,
      instanteLocal(input.timezone, dia, "12:00"),
    );
    for (const faixa of input.schedule) {
      if (faixa.weekday !== weekday) {
        continue;
      }
      const inicio = instanteLocal(input.timezone, dia, faixa.startsAt);
      const viraODia = faixa.endsAt.slice(0, 5) <= faixa.startsAt.slice(0, 5);
      const fim = instanteLocal(
        input.timezone,
        viraODia ? somarDias(dia, 1) : dia,
        faixa.endsAt,
      );
      const recortadoInicio = Math.max(inicio.getTime(), rangeInicio);
      const recortadoFim = Math.min(fim.getTime(), rangeFim);
      if (recortadoFim > recortadoInicio) {
        janelas.push({ inicio: recortadoInicio, fim: recortadoFim });
      }
    }
  }
  return mesclar(janelas.sort((a, b) => a.inicio - b.inicio));
}

/**
 * Horarios livres para um atendimento de durationMin, na grade local
 * (default 15 min): slots comecam em :00/:15/:30/:45 DO FUSO DA CLINICA,
 * nunca no passado, e cabem inteiros no espaco livre.
 */
export function availableSlots(input: EntradaDisponibilidade): SlotLivre[] {
  const gridMin = input.gridMin ?? 15;
  const gridMs = gridMin * 60_000;
  const duracaoMs = input.durationMin * 60_000;
  const agora = input.now.getTime();

  const ocupados = mesclar(
    paraIntervalos([
      ...input.blocks,
      ...input.appointments,
      ...input.holds,
      ...(input.resourceBusy ?? []),
    ]),
  );

  const slots: SlotLivre[] = [];
  for (const janela of materializarJornada(input)) {
    for (const livre of subtrair(janela, ocupados)) {
      // Alinha o primeiro inicio possivel a grade LOCAL: minutos locais
      // arredondados para cima ao multiplo da grade.
      let inicio = livre.inicio;
      const desalinho =
        minutosLocais(input.timezone, new Date(inicio)) % gridMin;
      if (desalinho !== 0) {
        inicio += (gridMin - desalinho) * 60_000;
      }
      // Nada no passado: proximo ponto de grade a partir de agora.
      if (inicio < agora) {
        const atraso = agora - inicio;
        inicio += Math.ceil(atraso / gridMs) * gridMs;
      }
      for (; inicio + duracaoMs <= livre.fim; inicio += gridMs) {
        slots.push({
          startsAt: new Date(inicio),
          endsAt: new Date(inicio + duracaoMs),
        });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Os N primeiros horarios livres (os "3 botoes grandes" do modal). */
export function firstAvailableSlots(
  input: EntradaDisponibilidade,
  quantos = 3,
): SlotLivre[] {
  return availableSlots(input).slice(0, quantos);
}
