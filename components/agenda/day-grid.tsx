"use client";

import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { remarcarAgendamentoAction } from "@/app/(app)/agenda/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ConsultaDaAgenda } from "@/lib/queries/agenda";

import { AppointmentBlock } from "@/components/agenda/appointment-block";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  minutoParaY,
  posicionarBlocos,
  yParaMinutos,
} from "@/lib/domain/agenda-layout";
import {
  horaParaMinutos,
  instanteLocal,
  minutosLocais,
  weekdayLocal,
} from "@/lib/domain/horarios";
import { availableSlots } from "@/lib/domain/scheduling";
import type { AgendaDia } from "@/lib/queries/agenda";
import type { Profissional } from "@/lib/queries/catalogo";

// Visao Dia: uma coluna por profissional (minimo 180px, rolagem horizontal),
// eixo de horas fixo a esquerda, faixa de 15 minutos com linha reforcada na
// hora, linha do horario atual, blocos posicionados por minuto (matematica
// em lib/domain/agenda-layout, testada). Aparencia do handoff (~96px/hora).

export const ALTURA_HORA_PX = 96;

export function DayGrid({
  contexto,
  dia,
  dados,
  carregando,
  profissionais,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  dia: string;
  dados: AgendaDia;
  carregando: boolean;
  profissionais: Profissional[];
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { timezone, catalogo } = contexto;

  const weekday = weekdayLocal(timezone, instanteLocal(timezone, dia, "12:00"));

  // Faixa visivel de horas: das jornadas do dia (com folga de 1h), senao
  // 07:00 as 19:00.
  const { horaInicio, horaFim } = useMemo(() => {
    const doDia = catalogo.jornadas.filter(
      (j) =>
        j.weekday === weekday &&
        profissionais.some((p) => p.id === j.professional_id),
    );
    if (doDia.length === 0) {
      return { horaInicio: 7, horaFim: 19 };
    }
    let inicioMin = Infinity;
    let fimMin = -Infinity;
    for (const jornada of doDia) {
      const iniciou = horaParaMinutos(jornada.starts_at);
      let terminou = horaParaMinutos(jornada.ends_at);
      if (terminou <= iniciou) {
        terminou = 24 * 60; // vira o dia: mostra ate o fim do dia visivel
      }
      inicioMin = Math.min(inicioMin, iniciou);
      fimMin = Math.max(fimMin, terminou);
    }
    return {
      horaInicio: Math.max(0, Math.floor(inicioMin / 60) - 1),
      horaFim: Math.min(24, Math.ceil(fimMin / 60) + 1),
    };
  }, [catalogo.jornadas, profissionais, weekday]);

  const inicioVisivel = instanteLocal(
    timezone,
    dia,
    `${String(horaInicio).padStart(2, "0")}:00`,
  );
  const totalHoras = horaFim - horaInicio;
  const alturaTotal = totalHoras * ALTURA_HORA_PX;

  // Arrastar e soltar para remarcar: 8px de ativacao preservam o clique do
  // menu; o drop abre o dialogo de confirmacao com "avisar o paciente?".
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [remarcacao, setRemarcacao] = useState<{
    consulta: ConsultaDaAgenda;
    novoInicio: Date;
    novoProfissionalId: string;
  } | null>(null);

  const aoSoltar = (event: DragEndEvent) => {
    const consulta = event.active.data.current?.consulta as
      ConsultaDaAgenda | undefined;
    if (!consulta) {
      return;
    }
    const novoProfissionalId =
      (event.over?.id as string | undefined) ?? consulta.professional_id;
    const inicioOriginal = new Date(consulta.starts_at);
    const minutosOriginais =
      (inicioOriginal.getTime() - inicioVisivel.getTime()) / 60_000;
    const novosMinutos = Math.max(
      0,
      Math.round(
        (minutosOriginais + event.delta.y / (ALTURA_HORA_PX / 60)) / 15,
      ) * 15,
    );
    const novoInicio = new Date(
      inicioVisivel.getTime() + novosMinutos * 60_000,
    );
    if (
      novoInicio.getTime() === inicioOriginal.getTime() &&
      novoProfissionalId === consulta.professional_id
    ) {
      return; // soltou no mesmo lugar
    }
    setRemarcacao({ consulta, novoInicio, novoProfissionalId });
  };

  if (carregando) {
    return (
      <div className="grid gap-2 p-4">
        <Skeleton className="h-14 w-full" />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[480px] min-w-[180px] flex-1" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensores} onDragEnd={aoSoltar}>
      <div className="flex min-w-fit">
        {/* Eixo de horas fixo a esquerda (62px, handoff) */}
        <div
          className="sticky left-0 z-20 w-[62px] shrink-0 border-r border-border bg-surface-1"
          aria-hidden
        >
          <div className="h-[62px] border-b border-border" />
          <div className="relative" style={{ height: alturaTotal }}>
            {Array.from({ length: totalHoras + 1 }, (_, i) => (
              <span
                key={i}
                className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-text-tertiary tabular-nums"
                style={{ top: i * ALTURA_HORA_PX }}
              >
                {String(horaInicio + i).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>

        {profissionais.map((profissional) => (
          <ColunaDoProfissional
            key={profissional.id}
            contexto={contexto}
            profissional={profissional}
            dia={dia}
            weekday={weekday}
            dados={dados}
            inicioVisivel={inicioVisivel}
            alturaTotal={alturaTotal}
            totalHoras={totalHoras}
            onVaoClicado={onVaoClicado}
          />
        ))}
      </div>

      <RemarcarDialog
        contexto={contexto}
        remarcacao={remarcacao}
        onFechar={() => setRemarcacao(null)}
      />
    </DndContext>
  );
}

function RemarcarDialog({
  contexto,
  remarcacao,
  onFechar,
}: {
  contexto: ContextoAgenda;
  remarcacao: {
    consulta: ConsultaDaAgenda;
    novoInicio: Date;
    novoProfissionalId: string;
  } | null;
  onFechar: () => void;
}) {
  const [avisar, setAvisar] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!remarcacao) {
    return null;
  }
  const { consulta, novoInicio, novoProfissionalId } = remarcacao;
  const duracaoMs =
    new Date(consulta.ends_at).getTime() -
    new Date(consulta.starts_at).getTime();
  const horaNova = novoInicio.toLocaleTimeString("pt-BR", {
    timeZone: contexto.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const profissionalNovo = contexto.catalogo.profissionais.find(
    (p) => p.id === novoProfissionalId,
  );

  const confirmar = async () => {
    setSalvando(true);
    setErro(null);
    const resultado = await remarcarAgendamentoAction({
      id: consulta.id,
      starts_at_esperado: consulta.starts_at,
      novo_starts_at: novoInicio.toISOString(),
      novo_ends_at: new Date(novoInicio.getTime() + duracaoMs).toISOString(),
      novo_professional_id: novoProfissionalId,
      avisar_paciente: avisar,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível remarcar.");
      return;
    }
    toast.success("Consulta remarcada");
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remarcar consulta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-secondary">
          Mover a consulta de {consulta.contact?.name ?? "paciente"} para{" "}
          <strong>{horaNova}</strong>
          {profissionalNovo && novoProfissionalId !== consulta.professional_id
            ? ` com ${profissionalNovo.name}`
            : ""}
          ?
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="avisar-paciente">Avisar o paciente</Label>
          <Switch
            id="avisar-paciente"
            checked={avisar}
            onCheckedChange={setAvisar}
          />
        </div>
        {erro ? (
          <p role="alert" className="text-sm [color:var(--alert-text)]">
            {erro}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando ? "Remarcando..." : "Remarcar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColunaDoProfissional({
  contexto,
  profissional,
  dia,
  weekday,
  dados,
  inicioVisivel,
  alturaTotal,
  totalHoras,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  profissional: Profissional;
  dia: string;
  weekday: number;
  dados: AgendaDia;
  inicioVisivel: Date;
  alturaTotal: number;
  totalHoras: number;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { timezone, catalogo } = contexto;

  const consultas = useMemo(
    () =>
      dados.consultas.filter(
        (c) =>
          c.professional_id === profissional.id &&
          c.status !== "cancelado_paciente" &&
          c.status !== "cancelado_clinica",
      ),
    [dados.consultas, profissional.id],
  );
  const bloqueios = useMemo(
    () => dados.bloqueios.filter((b) => b.professional_id === profissional.id),
    [dados.bloqueios, profissional.id],
  );
  const holds = useMemo(
    () =>
      dados.holds.filter(
        (h) =>
          h.professional_id === profissional.id &&
          new Date(h.expires_at).getTime() > Date.now(),
      ),
    [dados.holds, profissional.id],
  );

  // Contador do cabecalho: "8 de 12 horarios" (livres de totais), na grade
  // de 30 min, com a jornada do dia.
  const contador = useMemo(() => {
    const jornada = catalogo.jornadas
      .filter(
        (j) => j.professional_id === profissional.id && j.weekday === weekday,
      )
      .map((j) => ({
        weekday: j.weekday,
        startsAt: j.starts_at,
        endsAt: j.ends_at,
      }));
    if (jornada.length === 0) {
      return null;
    }
    const base = {
      timezone,
      rangeStart: instanteLocal(timezone, dia, "00:00"),
      rangeEnd: instanteLocal(timezone, dia, "23:59"),
      durationMin: 30,
      gridMin: 30,
      schedule: jornada,
      blocks: [],
      appointments: [],
      holds: [],
      now: new Date(0), // total teorico ignora o relogio
    };
    const total = availableSlots(base).length;
    const livres = availableSlots({
      ...base,
      now: new Date(),
      blocks: bloqueios.map((b) => ({
        startsAt: new Date(b.starts_at),
        endsAt: new Date(b.ends_at),
      })),
      appointments: consultas.map((c) => ({
        startsAt: new Date(c.starts_at),
        endsAt: new Date(c.ends_at),
      })),
      holds: holds.map((h) => ({
        startsAt: new Date(h.starts_at),
        endsAt: new Date(h.ends_at),
      })),
    }).length;
    return `${livres} de ${total} horários`;
  }, [
    catalogo.jornadas,
    profissional.id,
    weekday,
    timezone,
    dia,
    bloqueios,
    consultas,
    holds,
  ]);

  const blocos = useMemo(
    () =>
      posicionarBlocos(
        consultas.map((c) => ({
          ...c,
          startsAt: new Date(c.starts_at),
          endsAt: new Date(c.ends_at),
        })),
        inicioVisivel,
        ALTURA_HORA_PX,
      ),
    [consultas, inicioVisivel],
  );

  const { setNodeRef: dropRef } = useDroppable({ id: profissional.id });

  const clicarNoVao = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return; // clique num bloco, nao no vao
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const minutos = yParaMinutos(event.clientY - rect.top, ALTURA_HORA_PX);
    onVaoClicado(
      profissional.id,
      new Date(inicioVisivel.getTime() + minutos * 60_000),
    );
  };

  return (
    <div className="min-w-[180px] flex-1 border-r border-border last:border-r-0">
      {/* Cabecalho fixo: foto 32px, nome, especialidade, contador */}
      <div className="sticky top-0 z-10 flex h-[62px] items-center gap-2 border-b border-border bg-surface-1 px-2.5">
        <ContactAvatar
          name={profissional.name}
          phone={profissional.id}
          size={32}
        />
        <div className="grid min-w-0">
          <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
            {profissional.calendar_color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: profissional.calendar_color }}
              />
            ) : null}
            {profissional.name}
          </span>
          <span className="truncate text-[11px] text-text-tertiary">
            {profissional.specialties[0] ?? ""}
            {contador ? ` · ${contador}` : ""}
          </span>
        </div>
      </div>

      <div
        ref={dropRef}
        className="relative"
        style={{ height: alturaTotal }}
        onClick={contexto.podeEditar ? clicarNoVao : undefined}
        role={contexto.podeEditar ? "button" : undefined}
        aria-label={
          contexto.podeEditar
            ? `Marcar horário com ${profissional.name}`
            : undefined
        }
      >
        {/* Linhas da grade: 15 min fina, hora reforcada */}
        {Array.from({ length: totalHoras * 4 }, (_, i) => (
          <div
            key={i}
            aria-hidden
            className={
              i % 4 === 0
                ? "pointer-events-none absolute inset-x-0 border-t border-border"
                : "pointer-events-none absolute inset-x-0 border-t border-border/40"
            }
            style={{ top: (i * ALTURA_HORA_PX) / 4 }}
          />
        ))}

        {/* Bloqueios: hachura 45 graus + rotulo (nunca so cor) */}
        {bloqueios.map((bloqueio) => {
          const top = minutoParaY(
            (new Date(bloqueio.starts_at).getTime() - inicioVisivel.getTime()) /
              60_000,
            ALTURA_HORA_PX,
          );
          const height = minutoParaY(
            (new Date(bloqueio.ends_at).getTime() -
              new Date(bloqueio.starts_at).getTime()) /
              60_000,
            ALTURA_HORA_PX,
          );
          return (
            <div
              key={bloqueio.id}
              className="pointer-events-none absolute inset-x-0.5 z-[1] flex items-start overflow-hidden rounded-[6px] border border-border px-2 py-1"
              style={{
                top,
                height,
                backgroundImage:
                  "repeating-linear-gradient(45deg, transparent, transparent 6px, var(--border) 6px, var(--border) 7px)",
              }}
            >
              <span className="truncate text-[11px] font-medium text-text-secondary">
                {bloqueio.reason}
              </span>
            </div>
          );
        })}

        {/* Holds: semitransparente com contador regressivo */}
        {holds.map((hold) => (
          <HoldOverlay
            key={hold.id}
            hold={hold}
            inicioVisivel={inicioVisivel}
          />
        ))}

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

        <NowLine timezone={timezone} dia={dia} inicioVisivel={inicioVisivel} />
      </div>
    </div>
  );
}

function HoldOverlay({
  hold,
  inicioVisivel,
}: {
  hold: { id: string; starts_at: string; ends_at: string; expires_at: string };
  inicioVisivel: Date;
}) {
  const [restanteMin, setRestanteMin] = useState(() =>
    Math.max(
      0,
      Math.ceil((new Date(hold.expires_at).getTime() - Date.now()) / 60_000),
    ),
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setRestanteMin(
        Math.max(
          0,
          Math.ceil(
            (new Date(hold.expires_at).getTime() - Date.now()) / 60_000,
          ),
        ),
      );
    }, 15_000);
    return () => clearInterval(timer);
  }, [hold.expires_at]);

  if (restanteMin <= 0) {
    return null; // expirou: some sozinho
  }
  const top = minutoParaY(
    (new Date(hold.starts_at).getTime() - inicioVisivel.getTime()) / 60_000,
    ALTURA_HORA_PX,
  );
  const height = minutoParaY(
    (new Date(hold.ends_at).getTime() - new Date(hold.starts_at).getTime()) /
      60_000,
    ALTURA_HORA_PX,
  );
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-[2] rounded-[6px] border border-dashed px-2 py-1 opacity-70"
      style={{
        top,
        height,
        borderColor: "var(--ai)",
        backgroundColor: "color-mix(in srgb, var(--ai) 12%, transparent)",
      }}
    >
      <span className="text-[11px] font-medium" style={{ color: "var(--ai)" }}>
        Reservado pela IA, {restanteMin} min
      </span>
    </div>
  );
}

function NowLine({
  timezone,
  dia,
  inicioVisivel,
}: {
  timezone: string;
  dia: string;
  inicioVisivel: Date;
}) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // So no dia de hoje (no fuso da clinica)
  const hojeLocal = instanteLocal(timezone, dia, "00:00");
  const amanhaLocal = new Date(hojeLocal.getTime() + 24 * 3600_000);
  if (agora < hojeLocal || agora >= amanhaLocal) {
    return null;
  }
  void minutosLocais; // (a posicao usa o instante direto)
  const top = minutoParaY(
    (agora.getTime() - inicioVisivel.getTime()) / 60_000,
    ALTURA_HORA_PX,
  );
  if (top < 0) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-[5] border-t"
      style={{ top, borderColor: "var(--alert)" }}
    />
  );
}
