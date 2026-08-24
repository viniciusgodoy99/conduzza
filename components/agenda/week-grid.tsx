"use client";

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { AppointmentBlock } from "@/components/agenda/appointment-block";
import { ALTURA_HORA_PX } from "@/components/agenda/day-grid";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Skeleton } from "@/components/ui/skeleton";
import {
  minutoParaY,
  posicionarBlocos,
  yParaMinutos,
} from "@/lib/domain/agenda-layout";
import {
  diaCivil,
  instanteLocal,
  somarDias,
  weekdayLocal,
} from "@/lib/domain/horarios";
import {
  agendaKeys,
  fetchAgendaDia,
  type AgendaDia,
} from "@/lib/queries/agenda";
import type { Profissional } from "@/lib/queries/catalogo";
import { createClient } from "@/lib/supabase/client";

// Visao Semana de UM profissional (brief 4.2): 7 colunas de dia, segunda a
// domingo da semana de diaBase. Uma query POR DIA com a MESMA chave da visao
// Dia (agendaKeys.dia), para o cache e o tempo real serem compartilhados.
// Grade mais densa: 48px por hora (metade da visao Dia), faixa fixa de
// 07:00 as 19:00, snap de clique em 30 min.

const ALTURA_HORA_SEMANA_PX = ALTURA_HORA_PX / 2; // 48px
const HORA_INICIO = 7;
const HORA_FIM = 19;
const TOTAL_HORAS = HORA_FIM - HORA_INICIO;
const ALTURA_TOTAL = TOTAL_HORAS * ALTURA_HORA_SEMANA_PX;

const ABREV_DIA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function rotuloDoDia(timezone: string, diaISO: string): string {
  const weekday = weekdayLocal(
    timezone,
    instanteLocal(timezone, diaISO, "12:00"),
  );
  const [, mes, dia] = diaISO.split("-");
  return `${ABREV_DIA[weekday]} ${dia}/${mes}`;
}

export function WeekGrid({
  contexto,
  diaBase,
  profissional,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  diaBase: string;
  profissional: Profissional;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { clinicId, timezone } = contexto;
  const supabase = useMemo(() => createClient(), []);

  // Segunda-feira da semana de diaBase (weekday 1 no fuso da clinica).
  const dias = useMemo(() => {
    const weekday = weekdayLocal(
      timezone,
      instanteLocal(timezone, diaBase, "12:00"),
    );
    const segunda = somarDias(diaBase, -((weekday + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
  }, [timezone, diaBase]);

  const queries = useQueries({
    queries: dias.map((diaISO) => ({
      queryKey: agendaKeys.dia(clinicId, diaISO),
      queryFn: () => fetchAgendaDia(supabase, clinicId, diaISO, timezone),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    })),
  });

  const carregando = queries.some((q) => q.isPending);
  const hoje = diaCivil(timezone, new Date());

  if (carregando) {
    return (
      <div className="grid gap-2 p-4">
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          {dias.map((diaISO) => (
            <Skeleton key={diaISO} className="h-[480px] min-w-[120px] flex-1" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-fit">
      {/* Eixo de horas fixo a esquerda */}
      <div
        className="sticky left-0 z-20 w-[48px] shrink-0 border-r border-border bg-surface-1"
        aria-hidden
      >
        <div className="h-[42px] border-b border-border" />
        <div className="relative" style={{ height: ALTURA_TOTAL }}>
          {Array.from({ length: TOTAL_HORAS + 1 }, (_, i) => (
            <span
              key={i}
              className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-text-tertiary tabular-nums"
              style={{ top: i * ALTURA_HORA_SEMANA_PX }}
            >
              {String(HORA_INICIO + i).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>

      {dias.map((diaISO, indice) => (
        <ColunaDoDia
          key={diaISO}
          contexto={contexto}
          diaISO={diaISO}
          ehHoje={diaISO === hoje}
          profissional={profissional}
          dados={queries[indice]?.data}
          erro={queries[indice]?.isError ?? false}
          onVaoClicado={onVaoClicado}
        />
      ))}
    </div>
  );
}

function ColunaDoDia({
  contexto,
  diaISO,
  ehHoje,
  profissional,
  dados,
  erro,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  diaISO: string;
  ehHoje: boolean;
  profissional: Profissional;
  dados: AgendaDia | undefined;
  erro: boolean;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { timezone } = contexto;
  const inicioVisivel = useMemo(
    () =>
      instanteLocal(
        timezone,
        diaISO,
        `${String(HORA_INICIO).padStart(2, "0")}:00`,
      ),
    [timezone, diaISO],
  );

  const consultas = useMemo(
    () =>
      (dados?.consultas ?? []).filter(
        (c) =>
          c.professional_id === profissional.id &&
          c.status !== "cancelado_paciente" &&
          c.status !== "cancelado_clinica",
      ),
    [dados?.consultas, profissional.id],
  );
  const bloqueios = useMemo(
    () =>
      (dados?.bloqueios ?? []).filter(
        (b) => b.professional_id === profissional.id,
      ),
    [dados?.bloqueios, profissional.id],
  );
  // Holds da IA: so os do profissional deste dia que ainda nao expiraram.
  // Sem contador vivo aqui (densidade menor), os minutos sao calculados uma
  // vez na renderizacao.
  const agora = Date.now();
  const holds = useMemo(
    () =>
      (dados?.holds ?? []).filter(
        (h) =>
          h.professional_id === profissional.id &&
          new Date(h.expires_at).getTime() > agora,
      ),
    [dados?.holds, profissional.id, agora],
  );

  const blocos = useMemo(
    () =>
      posicionarBlocos(
        consultas.map((c) => ({
          ...c,
          startsAt: new Date(c.starts_at),
          endsAt: new Date(c.ends_at),
        })),
        inicioVisivel,
        ALTURA_HORA_SEMANA_PX,
      ),
    [consultas, inicioVisivel],
  );

  const clicarNoVao = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return; // clique num bloco, nao no vao
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const minutos = yParaMinutos(
      event.clientY - rect.top,
      ALTURA_HORA_SEMANA_PX,
      30,
    );
    onVaoClicado(
      profissional.id,
      new Date(inicioVisivel.getTime() + minutos * 60_000),
    );
  };

  return (
    <div className="min-w-[120px] flex-1 border-r border-border last:border-r-0">
      {/* Cabecalho do dia, com destaque no dia de hoje */}
      <div
        className={
          ehHoje
            ? "sticky top-0 z-10 flex h-[42px] items-center justify-center border-b-2 bg-surface-1 px-2"
            : "sticky top-0 z-10 flex h-[42px] items-center justify-center border-b border-border bg-surface-1 px-2"
        }
        style={ehHoje ? { borderBottomColor: "var(--brand)" } : undefined}
      >
        <span
          className={
            ehHoje
              ? "truncate text-[12px] font-semibold"
              : "truncate text-[12px] font-medium text-text-secondary"
          }
          style={ehHoje ? { color: "var(--brand)" } : undefined}
        >
          {rotuloDoDia(timezone, diaISO)}
          {ehHoje ? " · hoje" : ""}
        </span>
      </div>

      {erro ? (
        <div role="alert" className="p-2">
          <p className="text-[11px] text-text-secondary">
            Não deu para carregar este dia. Recarregue a página.
          </p>
        </div>
      ) : (
        <div
          className="relative"
          style={{ height: ALTURA_TOTAL }}
          onClick={contexto.podeEditar ? clicarNoVao : undefined}
          role={contexto.podeEditar ? "button" : undefined}
          aria-label={
            contexto.podeEditar
              ? `Marcar horário com ${profissional.name}, ${rotuloDoDia(timezone, diaISO)}`
              : undefined
          }
        >
          {/* Linhas da grade: 30 min fina, hora reforcada */}
          {Array.from({ length: TOTAL_HORAS * 2 }, (_, i) => (
            <div
              key={i}
              aria-hidden
              className={
                i % 2 === 0
                  ? "pointer-events-none absolute inset-x-0 border-t border-border"
                  : "pointer-events-none absolute inset-x-0 border-t border-border/40"
              }
              style={{ top: (i * ALTURA_HORA_SEMANA_PX) / 2 }}
            />
          ))}

          {/* Bloqueios: hachura 45 graus + rotulo (nunca so cor) */}
          {bloqueios.map((bloqueio) => {
            const top = minutoParaY(
              (new Date(bloqueio.starts_at).getTime() -
                inicioVisivel.getTime()) /
                60_000,
              ALTURA_HORA_SEMANA_PX,
            );
            const height = minutoParaY(
              (new Date(bloqueio.ends_at).getTime() -
                new Date(bloqueio.starts_at).getTime()) /
                60_000,
              ALTURA_HORA_SEMANA_PX,
            );
            return (
              <div
                key={bloqueio.id}
                className="pointer-events-none absolute inset-x-0.5 z-[1] flex items-start overflow-hidden rounded-[6px] border border-border px-1.5 py-0.5"
                style={{
                  top,
                  height,
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent, transparent 6px, var(--border) 6px, var(--border) 7px)",
                }}
              >
                <span className="truncate text-[10px] font-medium text-text-secondary">
                  {bloqueio.reason}
                </span>
              </div>
            );
          })}

          {/* Holds da IA: bloco semitransparente com os minutos restantes */}
          {holds.map((hold) => {
            const top = minutoParaY(
              (new Date(hold.starts_at).getTime() - inicioVisivel.getTime()) /
                60_000,
              ALTURA_HORA_SEMANA_PX,
            );
            const height = minutoParaY(
              (new Date(hold.ends_at).getTime() -
                new Date(hold.starts_at).getTime()) /
                60_000,
              ALTURA_HORA_SEMANA_PX,
            );
            const restanteMin = Math.max(
              0,
              Math.ceil((new Date(hold.expires_at).getTime() - agora) / 60_000),
            );
            return (
              <div
                key={hold.id}
                className="pointer-events-none absolute inset-x-0.5 z-[2] overflow-hidden rounded-[6px] border border-dashed px-1.5 py-0.5 opacity-70"
                style={{
                  top,
                  height,
                  borderColor: "var(--ai)",
                  backgroundColor:
                    "color-mix(in srgb, var(--ai) 12%, transparent)",
                }}
              >
                <span
                  className="truncate text-[10px] font-medium"
                  style={{ color: "var(--ai)" }}
                >
                  Reservado pela IA, {restanteMin} min
                </span>
              </div>
            );
          })}

          {/* Consultas */}
          {blocos.map((bloco) => (
            <AppointmentBlock
              key={bloco.item.id}
              contexto={contexto}
              consulta={bloco.item}
              top={bloco.top}
              height={bloco.height}
              lane={bloco.lane}
              lanes={bloco.lanes}
            />
          ))}
        </div>
      )}
    </div>
  );
}
