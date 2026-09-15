"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDown, ArrowUp, GripVertical, UserRoundMinus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  moverPrioridadeAction,
  removerDaEsperaAction,
} from "@/app/(app)/espera/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import type { EntradaDaEspera } from "@/lib/queries/espera";
import { cn } from "@/lib/utils";

// A fila da Tela 10, agrupada por profissional e procedimento (brief).
// Reordenar: arrasto (dnd-kit, mesmo sensor do Kanban) E botoes subir/descer
// para teclado; a persistencia e a RPC com renumeracao, e a tela invalida o
// cache depois (otimismo simples: a ordem so muda quando o banco confirma).

const TURNO_ROTULO: Record<string, string> = {
  manha: "manhã",
  tarde: "tarde",
  noite: "noite",
};
const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function preferencia(entrada: EntradaDaEspera): string {
  const turnos = entrada.preferred_shifts.map(
    (turno) => TURNO_ROTULO[turno] ?? turno,
  );
  const dias = entrada.preferred_weekdays.map((dia) => DIA_CURTO[dia] ?? "");
  const partes = [
    turnos.length > 0 ? turnos.join(" ou ") : null,
    dias.length > 0 ? dias.join(", ") : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : "qualquer horário";
}

type Grupo = {
  chave: string;
  titulo: string;
  entradas: EntradaDaEspera[];
};

function agrupar(entradas: EntradaDaEspera[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const entrada of entradas) {
    const chave = `${entrada.professional_id ?? "qq"}:${entrada.procedure_id ?? "qq"}`;
    const titulo = [
      entrada.professional?.name ?? "Qualquer profissional",
      entrada.procedure?.name ?? "qualquer procedimento",
    ].join(" · ");
    const grupo = grupos.get(chave) ?? { chave, titulo, entradas: [] };
    grupo.entradas.push(entrada);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()];
}

export function FilaDeEspera({
  entradas,
  timezone,
  podeEditar,
  dicaSemPermissao,
  aoMudar,
}: {
  entradas: EntradaDaEspera[];
  timezone: string;
  podeEditar: boolean;
  dicaSemPermissao: string;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const grupos = agrupar(entradas);

  const mover = (id: string, novaPosicao: number) => {
    iniciarTransicao(async () => {
      const resultado = await moverPrioridadeAction({
        id,
        nova_posicao: novaPosicao,
      });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível reordenar.");
        return;
      }
      await aoMudar();
    });
  };

  const remover = (entrada: EntradaDaEspera) => {
    iniciarTransicao(async () => {
      const resultado = await removerDaEsperaAction({ id: entrada.id });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível remover.");
        return;
      }
      toast.success("Saiu da lista de espera.");
      await aoMudar();
    });
  };

  const aoSoltar = (grupo: Grupo) => (evento: DragEndEvent) => {
    const arrastadaId = String(evento.active.id);
    const sobreId = evento.over ? String(evento.over.id) : null;
    if (!sobreId || sobreId === arrastadaId) {
      return;
    }
    const destino = grupo.entradas.findIndex(
      (entrada) => entrada.id === sobreId,
    );
    if (destino < 0) {
      return;
    }
    mover(arrastadaId, destino + 1);
  };

  if (grupos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-text-secondary">
        A fila aparece quando o primeiro paciente entrar na espera. Dá para
        adicionar por aqui, pela ficha do paciente ou pela conversa.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {grupos.map((grupo) => (
        <section key={grupo.chave} className="grid gap-2">
          <h3 className="text-sm font-semibold">{grupo.titulo}</h3>
          <DndContext sensors={sensores} onDragEnd={aoSoltar(grupo)}>
            <ol className="grid gap-1.5">
              {grupo.entradas.map((entrada, indice) => (
                <ItemDaFila
                  key={entrada.id}
                  entrada={entrada}
                  timezone={timezone}
                  posicao={indice + 1}
                  total={grupo.entradas.length}
                  podeEditar={podeEditar}
                  pendente={pendente}
                  dicaSemPermissao={dicaSemPermissao}
                  aoSubir={() => mover(entrada.id, indice)}
                  aoDescer={() => mover(entrada.id, indice + 2)}
                  aoRemover={() => remover(entrada)}
                />
              ))}
            </ol>
          </DndContext>
        </section>
      ))}
    </div>
  );
}

function ItemDaFila({
  entrada,
  timezone,
  posicao,
  total,
  podeEditar,
  pendente,
  dicaSemPermissao,
  aoSubir,
  aoDescer,
  aoRemover,
}: {
  entrada: EntradaDaEspera;
  timezone: string;
  posicao: number;
  total: number;
  podeEditar: boolean;
  /** Acao em andamento: desabilita SEM trocar para o ramo de sem permissao. */
  pendente: boolean;
  dicaSemPermissao: string;
  aoSubir: () => void;
  aoDescer: () => void;
  aoRemover: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: entrada.id, disabled: !podeEditar || pendente });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: entrada.id });

  return (
    <li
      ref={setDropRef}
      className={cn(
        "rounded-lg border bg-card transition-colors",
        isOver ? "border-primary" : "",
        isDragging ? "opacity-60" : "",
      )}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2 p-3">
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className={cn(
            "grid size-10 shrink-0 cursor-grab place-items-center rounded-md text-text-tertiary",
            !podeEditar ? "cursor-default opacity-40" : "hover:bg-surface-3",
          )}
          aria-label={`Arrastar ${entrada.contact?.name ?? "paciente"} para reordenar`}
        >
          <GripVertical strokeWidth={1.5} className="size-4" aria-hidden />
        </span>
        <span className="w-6 text-center text-sm font-semibold tabular-nums text-text-secondary">
          {posicao}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium">
            {entrada.contact?.name ?? "Paciente"}
          </span>
          <span className="truncate text-xs text-text-secondary">
            {entrada.contact?.phone_e164} · {preferencia(entrada)} · entrou em{" "}
            {format(
              new TZDate(new Date(entrada.created_at).getTime(), timezone),
              "dd/MM/yyyy",
              { locale: ptBR },
            )}
          </span>
        </div>
        {podeEditar ? (
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Subir na fila"
              disabled={posicao === 1 || pendente}
              onClick={aoSubir}
            >
              <ArrowUp strokeWidth={1.5} className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Descer na fila"
              disabled={posicao === total || pendente}
              onClick={aoDescer}
            >
              <ArrowDown strokeWidth={1.5} className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 [color:var(--alert-text)]"
              disabled={pendente}
              onClick={aoRemover}
            >
              <UserRoundMinus strokeWidth={1.5} className="size-4" />
              Remover
            </Button>
          </span>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-10" disabled>
                <ArrowUp strokeWidth={1.5} className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-10" disabled>
                <ArrowDown strokeWidth={1.5} className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 [color:var(--alert-text)]"
                disabled
              >
                <UserRoundMinus strokeWidth={1.5} className="size-4" />
                Remover
              </Button>
            </span>
          </DisabledWithHint>
        )}
      </div>
    </li>
  );
}
