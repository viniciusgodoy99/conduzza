"use client";

import { useQueries } from "@tanstack/react-query";
import { OctagonAlert } from "lucide-react";
import { useMemo } from "react";

import { AppointmentBlock } from "@/components/agenda/appointment-block";
import {
  ALTURA_HORA_PX,
  FaixaDeBloqueio,
  HoldOverlay,
  useAgora,
} from "@/components/agenda/day-grid";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { faixaDeHorasVisivel } from "@/lib/domain/scheduling";
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
// Grade mais densa: 48px por hora (metade da visao Dia), snap de clique em
// 30 min. A semana diz de quem e ("Semana de <nome>", com seletor quando ha
// mais de um profissional visivel) e a faixa de horas vem das jornadas dele,
// esticada pelas consultas da semana (achado 89): antes era 07:00 as 19:00
// fixo, e o que caia fora sumia.

const ALTURA_HORA_SEMANA_PX = ALTURA_HORA_PX / 2; // 48px

const ABREV_DIA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const CANCELADOS = new Set(["cancelado_paciente", "cancelado_clinica"]);

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
  profissionaisVisiveis,
  onProfissional,
  unidadeId,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  diaBase: string;
  profissional: Profissional;
  /** Quem passa nos filtros: com mais de um, o seletor aparece */
  profissionaisVisiveis: Profissional[];
  onProfissional: (professionalId: string) => void;
  /** Unidade do filtro: so as faixas dela entram na faixa de horas */
  unidadeId: string | null;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { clinicId, timezone, catalogo } = contexto;
  const supabase = useMemo(() => createClient(), []);
  const agora = useAgora();

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
  const hoje = agora === null ? null : diaCivil(timezone, new Date(agora));

  // Faixa de horas: todas as faixas de jornada do profissional na semana (na
  // unidade filtrada), esticada pelas consultas vivas dele nos 7 dias.
  const consultasDaSemana = queries.flatMap((q, indice) =>
    (q.data?.consultas ?? []).filter(
      (c) =>
        c.professional_id === profissional.id &&
        !CANCELADOS.has(c.status) &&
        diaCivil(timezone, new Date(c.starts_at)) === dias[indice],
    ),
  );
  const { horaInicio, horaFim } = faixaDeHorasVisivel({
    timezone,
    jornadas: catalogo.jornadas
      .filter(
        (j) =>
          j.professional_id === profissional.id &&
          (unidadeId === null || j.unit_id === null || j.unit_id === unidadeId),
      )
      .map((j) => ({ startsAt: j.starts_at, endsAt: j.ends_at })),
    consultas: consultasDaSemana.map((c) => ({
      startsAt: new Date(c.starts_at),
      endsAt: new Date(c.ends_at),
    })),
  });
  const totalHoras = horaFim - horaInicio;
  const alturaTotal = totalHoras * ALTURA_HORA_SEMANA_PX;

  const cabecalho = (
    <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
      <h2 className="text-base font-bold tracking-[-0.01em] text-text-strong">
        Semana de {profissional.name}
      </h2>
      {profissionaisVisiveis.length > 1 ? (
        <Select value={profissional.id} onValueChange={onProfissional}>
          <SelectTrigger
            className="h-10 w-auto max-w-[240px] min-w-[160px] text-[13px]"
            aria-label="Trocar o profissional da semana"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {profissionaisVisiveis.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );

  if (carregando) {
    return (
      <div className="min-w-fit" aria-label="Carregando a semana">
        {cabecalho}
        <div className="flex">
          <div className="w-[48px] shrink-0 border-r border-border bg-card">
            <div className="h-[42px] border-b border-border-strong bg-surface-subtle" />
          </div>
          {dias.map((diaISO) => (
            <div
              key={diaISO}
              className="min-w-[120px] flex-1 border-r border-border last:border-r-0"
            >
              <div className="flex h-[42px] items-center justify-center border-b border-border-strong bg-surface-subtle">
                <Skeleton className="h-3 w-14" />
              </div>
              <div className="grid gap-2 p-1.5">
                {Array.from({ length: 4 }, (_, linha) => (
                  <Skeleton key={linha} className="h-12 rounded-md" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-fit">
      {cabecalho}
      <div className="flex">
        {/* Calha de horas fixa a esquerda, rotulo no topo da hora */}
        <div
          className="sticky left-0 z-20 w-[48px] shrink-0 border-r border-border bg-card"
          aria-hidden
        >
          <div className="sticky top-0 z-10 h-[42px] border-b border-border-strong bg-surface-subtle" />
          <div className="relative" style={{ height: alturaTotal }}>
            {Array.from({ length: totalHoras }, (_, i) => (
              <span
                key={i}
                className="absolute right-1.5 cz-num text-[11px] font-medium text-text-tertiary"
                style={{ top: i * ALTURA_HORA_SEMANA_PX + 2 }}
              >
                {String(horaInicio + i).padStart(2, "0")}:00
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
            onTentarDeNovo={() => void queries[indice]?.refetch()}
            horaInicio={horaInicio}
            totalHoras={totalHoras}
            alturaTotal={alturaTotal}
            agora={agora}
            onVaoClicado={onVaoClicado}
          />
        ))}
      </div>
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
  onTentarDeNovo,
  horaInicio,
  totalHoras,
  alturaTotal,
  agora,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  diaISO: string;
  ehHoje: boolean;
  profissional: Profissional;
  dados: AgendaDia | undefined;
  erro: boolean;
  onTentarDeNovo: () => void;
  horaInicio: number;
  totalHoras: number;
  alturaTotal: number;
  agora: number | null;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { timezone } = contexto;
  const clicavel = contexto.podeEditar && profissional.active;
  const inicioVisivel = useMemo(
    () =>
      instanteLocal(
        timezone,
        diaISO,
        `${String(horaInicio).padStart(2, "0")}:00`,
      ),
    [timezone, diaISO, horaInicio],
  );

  const consultas = useMemo(
    () =>
      (dados?.consultas ?? []).filter(
        (c) =>
          c.professional_id === profissional.id && !CANCELADOS.has(c.status),
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
  // Reservas da IA ainda vivas, com o relogio do cliente (useAgora).
  const holds = useMemo(
    () =>
      agora === null
        ? []
        : (dados?.holds ?? []).filter(
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
      {/* Cabecalho do dia; hoje com fundo lime suave e " · hoje" em texto */}
      <div
        className={
          ehHoje
            ? "sticky top-0 z-10 flex h-[42px] items-center justify-center border-b border-border-strong bg-primary-soft px-2 text-xs font-semibold text-primary-text shadow-[inset_0_-2px_0_var(--primary-edge)]"
            : "sticky top-0 z-10 flex h-[42px] items-center justify-center border-b border-border-strong bg-surface-subtle px-2 text-xs font-semibold text-text-secondary"
        }
      >
        <span className="truncate">
          <span className="cz-num">{rotuloDoDia(timezone, diaISO)}</span>
          {ehHoje ? " · hoje" : ""}
        </span>
      </div>

      {erro ? (
        <div
          role="alert"
          className="m-1.5 grid gap-2 rounded-md bg-alert-bg p-2 text-[11px] text-alert-text"
        >
          <span className="flex items-start gap-1">
            <OctagonAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            Não deu para carregar este dia.
          </span>
          <Button variant="outline" size="sm" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <div
          className="relative"
          style={{ height: alturaTotal }}
          onClick={clicavel ? clicarNoVao : undefined}
          role={clicavel ? "button" : undefined}
          aria-label={
            clicavel
              ? `Marcar horário com ${profissional.name}, ${rotuloDoDia(timezone, diaISO)}`
              : undefined
          }
        >
          {/* Linhas da grade: hora forte, meia hora fina */}
          {Array.from({ length: totalHoras * 2 }, (_, i) => (
            <div
              key={i}
              aria-hidden
              className={
                i % 2 === 0
                  ? "pointer-events-none absolute inset-x-0 border-t border-border-strong"
                  : "pointer-events-none absolute inset-x-0 border-t border-border"
              }
              style={{ top: (i * ALTURA_HORA_SEMANA_PX) / 2 }}
            />
          ))}

          {/* Bloqueios: hachura 45 graus + motivo num chip solido (C19) */}
          {bloqueios.map((bloqueio) => (
            <FaixaDeBloqueio
              key={bloqueio.id}
              motivo={bloqueio.reason}
              top={minutoParaY(
                (new Date(bloqueio.starts_at).getTime() -
                  inicioVisivel.getTime()) /
                  60_000,
                ALTURA_HORA_SEMANA_PX,
              )}
              height={minutoParaY(
                (new Date(bloqueio.ends_at).getTime() -
                  new Date(bloqueio.starts_at).getTime()) /
                  60_000,
                ALTURA_HORA_SEMANA_PX,
              )}
            />
          ))}

          {/* Reservas da IA: tracejado no tom da IA, com os minutos restantes */}
          {agora !== null
            ? holds.map((hold) => (
                <HoldOverlay
                  key={hold.id}
                  hold={hold}
                  inicioVisivel={inicioVisivel}
                  alturaHoraPx={ALTURA_HORA_SEMANA_PX}
                  agora={agora}
                />
              ))
            : null}

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
