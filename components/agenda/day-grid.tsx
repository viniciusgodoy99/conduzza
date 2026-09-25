"use client";

import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Sparkles } from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { remarcarAgendamentoAction } from "@/app/(app)/agenda/actions";
import { Aviso } from "@/components/shared/aviso";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RECORD_STATUS } from "@/lib/design/status";
import { MENSAGEM_PROFISSIONAL_INATIVO } from "@/lib/domain/appointment-status";
import { MENSAGEM_SEM_VINCULO } from "@/lib/domain/remarcacao";
import { agendaKeys, type ConsultaDaAgenda } from "@/lib/queries/agenda";

import { AppointmentBlock } from "@/components/agenda/appointment-block";
import {
  atendeAConsulta,
  ChaveAvisarPaciente,
  NotaDaConfirmacao,
} from "@/components/agenda/remarcacao-comum";
import type { ContextoAgenda } from "@/components/agenda/tipos";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  minutoParaY,
  posicionarBlocos,
  yParaMinutos,
} from "@/lib/domain/agenda-layout";
import { diaCivil, instanteLocal, weekdayLocal } from "@/lib/domain/horarios";
import { availableSlots, faixaDeHorasVisivel } from "@/lib/domain/scheduling";
import type { AgendaDia } from "@/lib/queries/agenda";
import type { Jornada, Profissional } from "@/lib/queries/catalogo";

// Visao Dia: uma coluna por profissional (minimo 180px, rolagem horizontal),
// eixo de horas fixo a esquerda, faixa de 15 minutos com linha reforcada na
// hora, linha do horario atual, blocos posicionados por minuto (matematica
// em lib/domain/agenda-layout, testada). Desenho do design system (docs/06
// secao 5.6): calha de 62px com a hora no topo da linha, cabecalho da coluna
// fixo, hachura so no bloqueio (C19) e a linha de agora sempre em alerta,
// nunca lime. Todo elemento novo dentro da coluna e pointer-events-none: o
// clique no vao depende de event.target === event.currentTarget.

export const ALTURA_HORA_PX = 96;

const CANCELADOS = new Set(["cancelado_paciente", "cancelado_clinica"]);

// Relogio da tela, em minutos cheios. No servidor e na hidratacao vale null
// (nada que dependa do relogio e desenhado), e so no cliente ganha o
// instante: sem isso a linha de agora, o contador de horarios e os minutos
// da reserva saiam com a hora do servidor e a do navegador diferentes, e a
// hidratacao reclamava.
function assinarRelogio(aoMudar: () => void): () => void {
  const timer = setInterval(aoMudar, 15_000);
  return () => clearInterval(timer);
}
const minutoAtual = () => Math.floor(Date.now() / 60_000) * 60_000;
const semRelogioNoServidor = () => null;

export function useAgora(): number | null {
  return useSyncExternalStore(
    assinarRelogio,
    minutoAtual,
    semRelogioNoServidor,
  );
}

/** Faixas de jornada do profissional no dia da semana, na unidade filtrada. */
export function jornadasDoDia(
  jornadas: readonly Jornada[],
  professionalId: string,
  weekday: number,
  unidadeId: string | null,
): Jornada[] {
  return jornadas.filter(
    (j) =>
      j.professional_id === professionalId &&
      j.weekday === weekday &&
      (unidadeId === null || j.unit_id === null || j.unit_id === unidadeId),
  );
}

export function DayGrid({
  contexto,
  dia,
  dados,
  carregando,
  profissionais,
  unidadeId,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  dia: string;
  dados: AgendaDia;
  carregando: boolean;
  profissionais: Profissional[];
  /** Unidade do filtro: so as faixas dela contam (achados 40 e 90) */
  unidadeId: string | null;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { timezone, catalogo } = contexto;
  const agora = useAgora();

  const weekday = weekdayLocal(timezone, instanteLocal(timezone, dia, "12:00"));

  // Faixa visivel de horas: das jornadas do dia (com folga de 1h), esticada
  // para caber toda consulta viva, inclusive encaixe fora do expediente;
  // sem jornada, 07:00 as 19:00.
  const { horaInicio, horaFim } = useMemo(
    () =>
      faixaDeHorasVisivel({
        timezone,
        jornadas: profissionais
          .flatMap((p) =>
            jornadasDoDia(catalogo.jornadas, p.id, weekday, unidadeId),
          )
          .map((j) => ({ startsAt: j.starts_at, endsAt: j.ends_at })),
        consultas: dados.consultas
          .filter(
            (c) =>
              !CANCELADOS.has(c.status) &&
              profissionais.some((p) => p.id === c.professional_id) &&
              diaCivil(timezone, new Date(c.starts_at)) === dia,
          )
          .map((c) => ({
            startsAt: new Date(c.starts_at),
            endsAt: new Date(c.ends_at),
          })),
      }),
    [
      catalogo.jornadas,
      profissionais,
      weekday,
      unidadeId,
      dados,
      timezone,
      dia,
    ],
  );

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
      <div className="flex min-w-fit" aria-label="Carregando a agenda do dia">
        <div className="w-[62px] shrink-0 border-r border-border bg-card">
          <div className="h-[62px] border-b border-border-strong bg-surface-subtle" />
          <div className="grid gap-[84px] px-2.5 pt-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="ml-auto h-3 w-9" />
            ))}
          </div>
        </div>
        {(profissionais.length > 0 ? profissionais : [null, null, null])
          .slice(0, 6)
          .map((profissional, i) => (
            <div
              key={profissional?.id ?? i}
              className="min-w-[180px] flex-1 border-r border-border last:border-r-0"
            >
              <div className="flex h-[62px] items-center gap-2.5 border-b border-border-strong bg-surface-subtle px-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
              <div className="grid gap-2 p-2">
                {Array.from({ length: 4 }, (_, linha) => (
                  <Skeleton key={linha} className="h-20 rounded-md" />
                ))}
              </div>
            </div>
          ))}
      </div>
    );
  }

  // O id fixo do DndContext vira o aria-describedby de cada bloco. Sem ele o
  // dnd-kit numera por um contador global do modulo, que no servidor ja esta
  // adiantado pelas requisicoes anteriores (DndDescribedBy-17 contra
  // DndDescribedBy-0 no navegador) e a hidratacao reclamava. So existe uma
  // grade do Dia por tela, entao o texto fixo nao colide.
  return (
    <DndContext
      id="arrasto-da-agenda-dia"
      sensors={sensores}
      onDragEnd={aoSoltar}
    >
      <div className="flex min-w-fit">
        {/* Calha de horas fixa a esquerda (62px), rotulo no topo da hora */}
        <div
          className="sticky left-0 z-20 w-[62px] shrink-0 border-r border-border bg-card"
          aria-hidden
        >
          <div className="sticky top-0 z-10 h-[62px] border-b border-border-strong bg-surface-subtle" />
          <div className="relative" style={{ height: alturaTotal }}>
            {Array.from({ length: totalHoras }, (_, i) => (
              <span
                key={i}
                className="absolute right-2.5 cz-num text-[11px] font-medium text-text-tertiary"
                style={{ top: i * ALTURA_HORA_PX + 4 }}
              >
                {String(horaInicio + i).padStart(2, "0")}:00
              </span>
            ))}
            <MarcadorDeAgora
              timezone={timezone}
              dia={dia}
              inicioVisivel={inicioVisivel}
              alturaTotal={alturaTotal}
              agora={agora}
            />
          </div>
        </div>

        {profissionais.map((profissional) => (
          <ColunaDoProfissional
            key={profissional.id}
            contexto={contexto}
            profissional={profissional}
            dia={dia}
            weekday={weekday}
            unidadeId={unidadeId}
            dados={dados}
            inicioVisivel={inicioVisivel}
            alturaTotal={alturaTotal}
            totalHoras={totalHoras}
            agora={agora}
            onVaoClicado={onVaoClicado}
          />
        ))}
      </div>

      {/* A chave remonta o dialogo a cada soltura: erro e chave de aviso da
          remarcacao anterior nao vazam para a proxima. */}
      <RemarcarDialog
        key={
          remarcacao
            ? `${remarcacao.consulta.id}-${remarcacao.novoInicio.getTime()}-${remarcacao.novoProfissionalId}`
            : "fechado"
        }
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
  const queryClient = useQueryClient();
  const [avisar, setAvisar] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idChaveAviso = useId();

  if (!remarcacao) {
    return null;
  }
  const { consulta, novoInicio, novoProfissionalId } = remarcacao;
  const diaNovo = novoInicio.toLocaleDateString("pt-BR", {
    timeZone: contexto.timezone,
    day: "2-digit",
    month: "2-digit",
  });
  const horaNova = novoInicio.toLocaleTimeString("pt-BR", {
    timeZone: contexto.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const profissionalNovo = contexto.catalogo.profissionais.find(
    (p) => p.id === novoProfissionalId,
  );
  // Soltou na coluna de quem nao atende o procedimento pelo convenio da
  // consulta, ou de profissional inativo (inclusive a propria coluna, achado
  // L12): diz na hora, em vez de deixar o servidor recusar (achado 85).
  const semVinculo = !atendeAConsulta(contexto, consulta, novoProfissionalId);
  const mesmoDia =
    diaCivil(contexto.timezone, new Date(consulta.starts_at)) ===
    diaCivil(contexto.timezone, novoInicio);

  const confirmar = async () => {
    setSalvando(true);
    setErro(null);
    const resultado = await remarcarAgendamentoAction({
      id: consulta.id,
      starts_at_esperado: consulta.starts_at,
      novo_starts_at: novoInicio.toISOString(),
      novo_professional_id: novoProfissionalId,
      avisar_paciente: avisar,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível remarcar.");
      return;
    }
    toast.success("Consulta remarcada.");
    if (resultado.aviso) {
      // O aviso NAO saiu: a recepcao precisa saber para ligar.
      toast.warning(resultado.aviso, { duration: 10_000 });
    }
    void queryClient.invalidateQueries({
      queryKey: ["agenda", contexto.clinicId],
    });
    void queryClient.invalidateQueries({
      queryKey: agendaKeys.historico(consulta.id),
    });
    onFechar();
  };

  return (
    <Dialog open onOpenChange={(aberto) => (!aberto ? onFechar() : null)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Remarcar consulta</DialogTitle>
          <DialogDescription>
            Mover a consulta de {consulta.contact?.name ?? "paciente"} para{" "}
            <strong className="cz-num font-semibold text-text-strong">
              {diaNovo} às {horaNova}
            </strong>
            {profissionalNovo && novoProfissionalId !== consulta.professional_id
              ? ` com ${profissionalNovo.name}`
              : ""}
            ?
          </DialogDescription>
        </DialogHeader>
        {semVinculo ? (
          <Aviso tom="alert" role="alert">
            {profissionalNovo && !profissionalNovo.active
              ? novoProfissionalId === consulta.professional_id
                ? `O cadastro de ${profissionalNovo.name} está inativo. Arraste a consulta para a coluna de outro profissional ou use Remarcar no menu dela.`
                : MENSAGEM_PROFISSIONAL_INATIVO
              : MENSAGEM_SEM_VINCULO}
          </Aviso>
        ) : (
          <>
            <ChaveAvisarPaciente
              id={idChaveAviso}
              marcada={avisar}
              aoMudar={setAvisar}
            />
            <NotaDaConfirmacao consulta={consulta} mesmoDia={mesmoDia} />
          </>
        )}
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="outline" className="h-10" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            className="h-10"
            onClick={confirmar}
            disabled={salvando || semVinculo}
          >
            {salvando ? "Remarcando..." : "Remarcar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColunaDoProfissional({
  contexto,
  profissional,
  dia,
  weekday,
  unidadeId,
  dados,
  inicioVisivel,
  alturaTotal,
  totalHoras,
  agora,
  onVaoClicado,
}: {
  contexto: ContextoAgenda;
  profissional: Profissional;
  dia: string;
  weekday: number;
  unidadeId: string | null;
  dados: AgendaDia;
  inicioVisivel: Date;
  alturaTotal: number;
  totalHoras: number;
  agora: number | null;
  onVaoClicado: (professionalId: string, inicio: Date) => void;
}) {
  const { timezone, catalogo } = contexto;
  // Inativo so aparece no dia em que ainda tem consulta (achado 37): a coluna
  // mostra a consulta, mas nao abre horario novo.
  const inativo = !profissional.active;
  const clicavel = contexto.podeEditar && !inativo;

  const consultas = useMemo(
    () =>
      dados.consultas.filter(
        (c) =>
          c.professional_id === profissional.id && !CANCELADOS.has(c.status),
      ),
    [dados.consultas, profissional.id],
  );
  const bloqueios = useMemo(
    () => dados.bloqueios.filter((b) => b.professional_id === profissional.id),
    [dados.bloqueios, profissional.id],
  );
  // Reservas vivas: so com o relogio do cliente (null na hidratacao).
  const holds = useMemo(
    () =>
      agora === null
        ? []
        : dados.holds.filter(
            (h) =>
              h.professional_id === profissional.id &&
              new Date(h.expires_at).getTime() > agora,
          ),
    [dados.holds, profissional.id, agora],
  );

  const jornadaDoDia = useMemo(
    () => jornadasDoDia(catalogo.jornadas, profissional.id, weekday, unidadeId),
    [catalogo.jornadas, profissional.id, weekday, unidadeId],
  );

  // Contador do cabecalho: "8 de 12 horarios" (livres de totais), na grade
  // de 30 min, com a jornada do dia (na unidade filtrada). So com o relogio
  // do cliente: o servidor nao sabe que horas sao no navegador.
  const contador = useMemo(() => {
    const jornada = jornadaDoDia.map((j) => ({
      weekday: j.weekday,
      startsAt: j.starts_at,
      endsAt: j.ends_at,
    }));
    if (jornada.length === 0 || agora === null) {
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
      now: new Date(agora),
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
    return { livres, total };
  }, [jornadaDoDia, agora, timezone, dia, bloqueios, consultas, holds]);

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
      {/* Cabecalho fixo: foto 32px, nome, especialidade e contador */}
      <div className="sticky top-0 z-10 flex h-[62px] items-center gap-2.5 border-b border-border-strong bg-surface-subtle px-3">
        <span className="relative shrink-0">
          <ContactAvatar
            name={profissional.name}
            phone={profissional.id}
            size={32}
          />
          {profissional.calendar_color ? (
            // Cor da agenda: dado da clinica, o unico estilo inline aceito.
            <span
              aria-hidden
              className="absolute -right-px -bottom-px size-2.5 rounded-full border-2 border-card"
              style={{ backgroundColor: profissional.calendar_color }}
            />
          ) : null}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-bold text-text-strong">
              {profissional.name}
            </span>
            {inativo ? (
              <StatusChip
                size="sm"
                definition={RECORD_STATUS.inativo}
                className="shrink-0"
              />
            ) : null}
          </span>
          <span className="truncate text-[11px] text-text-secondary">
            {profissional.specialties[0] ?? ""}
            {profissional.specialties[0] &&
            (contador || jornadaDoDia.length === 0)
              ? " · "
              : ""}
            {jornadaDoDia.length === 0 ? (
              "Sem jornada neste dia"
            ) : contador ? (
              <>
                <span className="cz-num">{contador.livres}</span> de{" "}
                <span className="cz-num">{contador.total}</span> horários
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div
        ref={dropRef}
        className="relative"
        style={{ height: alturaTotal }}
        onClick={clicavel ? clicarNoVao : undefined}
        role={clicavel ? "button" : undefined}
        aria-label={
          clicavel ? `Marcar horário com ${profissional.name}` : undefined
        }
      >
        {/* Linhas da grade: hora forte, meia hora fina, 15 e 45 tracejadas */}
        {Array.from({ length: totalHoras * 4 }, (_, i) => (
          <div
            key={i}
            aria-hidden
            className={
              i % 4 === 0
                ? "pointer-events-none absolute inset-x-0 border-t border-border-strong"
                : i % 4 === 2
                  ? "pointer-events-none absolute inset-x-0 border-t border-border"
                  : "pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            }
            style={{ top: (i * ALTURA_HORA_PX) / 4 }}
          />
        ))}

        {/* Bloqueios: hachura 45 graus + motivo num chip solido (C19) */}
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
            <FaixaDeBloqueio
              key={bloqueio.id}
              motivo={bloqueio.reason}
              top={top}
              height={height}
            />
          );
        })}

        {/* Reservas da IA: tracejado no tom da IA, com os minutos restantes */}
        {agora !== null
          ? holds.map((hold) => (
              <HoldOverlay
                key={hold.id}
                hold={hold}
                inicioVisivel={inicioVisivel}
                alturaHoraPx={ALTURA_HORA_PX}
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

        <NowLine
          top={posicaoDeAgora(timezone, dia, inicioVisivel, alturaTotal, agora)}
        />
      </div>
    </div>
  );
}

/**
 * Bloqueio: hachura a 45 graus sobre o afundado (a camada de forma, C19) e o
 * motivo num chip solido com o Ban. Nunca so cor. Sem clique: o vao por baixo
 * continua respondendo (pointer-events-none).
 */
export function FaixaDeBloqueio({
  motivo,
  top,
  height,
}: {
  motivo: string;
  top: number;
  height: number;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-[1] flex items-start overflow-hidden rounded-md border border-border-strong bg-surface-4 p-1"
      style={{
        top,
        height,
        backgroundImage:
          "repeating-linear-gradient(45deg, var(--border-heavy) 0 1px, transparent 1px 8px)",
      }}
    >
      <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-card px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
        <Ban className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{motivo}</span>
      </span>
    </div>
  );
}

/**
 * Reserva temporaria da IA (slot_hold): tracejado no tom da IA com os minutos
 * que faltam. Expirada, some sozinha. O relogio vem de fora (useAgora), para
 * a hidratacao nao divergir.
 */
export function HoldOverlay({
  hold,
  inicioVisivel,
  alturaHoraPx,
  agora,
}: {
  hold: { id: string; starts_at: string; ends_at: string; expires_at: string };
  inicioVisivel: Date;
  alturaHoraPx: number;
  agora: number;
}) {
  const restanteMin = Math.max(
    0,
    Math.ceil((new Date(hold.expires_at).getTime() - agora) / 60_000),
  );
  if (restanteMin <= 0) {
    return null; // expirou: some sozinho
  }
  const top = minutoParaY(
    (new Date(hold.starts_at).getTime() - inicioVisivel.getTime()) / 60_000,
    alturaHoraPx,
  );
  const height = minutoParaY(
    (new Date(hold.ends_at).getTime() - new Date(hold.starts_at).getTime()) /
      60_000,
    alturaHoraPx,
  );
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 z-[2] flex items-start overflow-hidden rounded-md border border-dashed border-(--ai) bg-ai-bg px-2 py-1"
      style={{ top, height }}
    >
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold text-ai-text">
        <Sparkles className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{`Reservado pela IA, ${restanteMin} min`}</span>
      </span>
    </div>
  );
}

/** Altura da linha de agora na grade, ou null fora de hoje e da faixa. */
function posicaoDeAgora(
  timezone: string,
  dia: string,
  inicioVisivel: Date,
  alturaTotal: number,
  agora: number | null,
): number | null {
  if (agora === null || diaCivil(timezone, new Date(agora)) !== dia) {
    return null;
  }
  const top = minutoParaY(
    (agora - inicioVisivel.getTime()) / 60_000,
    ALTURA_HORA_PX,
  );
  return top < 0 || top > alturaTotal ? null : top;
}

/** Linha de agora: sempre no tom de alerta, nunca lime, com ponto de 8px. */
function NowLine({ top }: { top: number | null }) {
  if (top === null) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-(--alert)"
      style={{ top: top - 1 }}
    >
      <span className="absolute -top-[5px] -left-1 size-2 rounded-full bg-(--alert)" />
    </div>
  );
}

/** Hora de agora na calha, no fuso da clinica, na altura da linha. */
function MarcadorDeAgora({
  timezone,
  dia,
  inicioVisivel,
  alturaTotal,
  agora,
}: {
  timezone: string;
  dia: string;
  inicioVisivel: Date;
  alturaTotal: number;
  agora: number | null;
}) {
  const top = posicaoDeAgora(timezone, dia, inicioVisivel, alturaTotal, agora);
  if (top === null || agora === null) {
    return null;
  }
  const hora = new Date(agora).toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1 z-[6] -translate-y-1/2 rounded-full border border-(--alert) bg-alert-bg px-1.5 cz-num text-[11px] leading-4 font-semibold text-alert-text"
      style={{ top }}
    >
      {hora}
    </span>
  );
}
