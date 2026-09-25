"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListOrdered,
  UserRoundMinus,
} from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  moverPrioridadeAction,
  removerDaEsperaAction,
} from "@/app/(app)/espera/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { EntradaDaEspera } from "@/lib/queries/espera";
import { cn } from "@/lib/utils";

// A fila da Tela 10, agrupada por profissional e procedimento (brief).
// Reordenar: arrasto (dnd-kit, mesmo sensor do Kanban) E botoes subir/descer
// para teclado; a persistencia e a RPC com renumeracao, e a tela invalida o
// cache depois (otimismo simples: a ordem so muda quando o banco confirma).
//
// Arrasto conferido contra a RPC mover_na_lista_de_espera: ela renumera SO o
// grupo (mesmo profissional e procedimento, na ordem priority, created_at),
// a mesma ordem e o mesmo recorte da tela; soltar sobre a linha N leva para
// a posicao N, e os botoes pedem N-1 e N+1. A alca e so para o mouse (sem
// sensor de teclado): quem usa teclado ou leitor de tela tem Subir e Descer,
// por isso ela fica fora da arvore de acessibilidade, e os anuncios do
// dnd-kit saem em portugues com o nome do paciente, nunca o id.

// Grade unica do cartao (docs/06 secao 5.8): alca, posicao, paciente,
// WhatsApp, preferencia, entrada e acoes. Cada linha e subgrid da grade do
// cartao, entao a coluna "auto" das acoes tem a MESMA largura no cabecalho e
// em todas as linhas. As trilhas de 0px nas pontas fazem o recuo lateral pelo
// proprio espacamento da grade. As colunas dependem da largura do CARTAO
// (container query), nao da janela: a fila divide a linha com a lateral a
// partir de 1280px e ocupa a tela inteira abaixo disso.
const GRADE =
  "grid grid-cols-[0px_40px_44px_minmax(0,1fr)_auto_0px] gap-x-3 @min-[880px]/fila:grid-cols-[0px_40px_44px_minmax(0,1.4fr)_144px_minmax(0,1fr)_104px_auto_0px]";
const LINHA = "col-span-full grid grid-cols-subgrid";
const SO_LARGA = "hidden @min-[880px]/fila:block";

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
  const texto = partes.length > 0 ? partes.join(" · ") : "qualquer horário";
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function nomeDe(entrada: EntradaDaEspera | undefined): string {
  const nome = entrada?.contact?.name?.trim();
  return nome ? nome : "Paciente";
}

/**
 * Anuncios do arrasto para o leitor de tela, no lugar dos padroes do
 * dnd-kit (em ingles e com o id da linha).
 */
function anunciosDoGrupo(grupo: Grupo): Announcements {
  const entradaDe = (id: UniqueIdentifier) =>
    grupo.entradas.find((entrada) => entrada.id === String(id));
  const posicaoDe = (id: UniqueIdentifier) =>
    grupo.entradas.findIndex((entrada) => entrada.id === String(id)) + 1;
  return {
    onDragStart: ({ active }) =>
      `${nomeDe(entradaDe(active.id))} foi pego para mudar de posição.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nomeDe(entradaDe(active.id))} está sobre a posição ${posicaoDe(over.id)}.`
        : `${nomeDe(entradaDe(active.id))} está fora da fila.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nomeDe(entradaDe(active.id))} foi solto na posição ${posicaoDe(over.id)}.`
        : `${nomeDe(entradaDe(active.id))} foi solto fora da fila e ficou onde estava.`,
    onDragCancel: ({ active }) =>
      `Arrasto cancelado. ${nomeDe(entradaDe(active.id))} ficou onde estava.`,
  };
}

const INSTRUCOES_DO_ARRASTO = {
  draggable:
    "Arraste com o mouse para mudar a ordem, ou use os botões Subir e Descer.",
};

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

  const total = entradas.length;

  return (
    <Card className="@container/fila">
      <CardHeader>
        <CardTitle>
          <h2>Fila de espera</h2>
        </CardTitle>
        {grupos.length > 0 && podeEditar ? (
          <CardDescription>
            Arraste pela alça ou use as setas para mudar a ordem.
          </CardDescription>
        ) : null}
        {grupos.length > 0 ? (
          <CardAction className="text-[12.5px] text-text-secondary">
            <span className="cz-num">{total}</span>{" "}
            {total === 1 ? "pessoa" : "pessoas"}
          </CardAction>
        ) : null}
      </CardHeader>

      {grupos.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="Ninguém na lista de espera"
          description="A fila aparece quando o primeiro paciente entrar na espera. Dá para adicionar por aqui, pela ficha do paciente ou pela conversa."
        />
      ) : (
        <div
          className={cn(
            GRADE,
            "[&>section:last-child>ol>li:last-child]:border-b-0",
          )}
        >
          {/* Cabecalho das colunas so na grade larga. aria-hidden: cada
              linha ja diz o que e cada dado (rotulos sr-only). */}
          <div
            aria-hidden
            className={cn(
              LINHA,
              "hidden h-9 items-center border-b border-border-strong bg-surface-subtle cz-eyebrow text-text-secondary @min-[880px]/fila:grid",
            )}
          >
            <span className="col-start-2" />
            <span>Ordem</span>
            <span>Paciente</span>
            <span>WhatsApp</span>
            <span>Preferência</span>
            <span className="text-right">Entrou em</span>
            <span />
          </div>
          {grupos.map((grupo) => (
            <section key={grupo.chave} className={LINHA}>
              <h3 className="col-span-full flex items-center gap-2 border-b border-border bg-surface-subtle px-3 py-2 text-[13px] font-bold">
                <span className="min-w-0 truncate">{grupo.titulo}</span>
                <span className="shrink-0 text-xs font-medium text-text-secondary">
                  <span className="cz-num">{grupo.entradas.length}</span>
                  {grupo.entradas.length === 1 ? " pessoa" : " pessoas"}
                </span>
              </h3>
              <DndContext
                id={`fila-${grupo.chave}`}
                sensors={sensores}
                onDragEnd={aoSoltar(grupo)}
                accessibility={{
                  announcements: anunciosDoGrupo(grupo),
                  screenReaderInstructions: INSTRUCOES_DO_ARRASTO,
                }}
              >
                <ol className={LINHA}>
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
      )}
    </Card>
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
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: entrada.id, disabled: !podeEditar || pendente });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: entrada.id });
  // A LINHA inteira e o que se arrasta (o retangulo que colide com as outras
  // linhas); a alca so inicia o gesto.
  const refDaLinha = (no: HTMLLIElement | null) => {
    setDragRef(no);
    setDropRef(no);
  };

  const nome = nomeDe(entrada);
  const telefone = entrada.contact?.phone_e164
    ? formatarTelefone(entrada.contact.phone_e164)
    : null;
  const pref = preferencia(entrada);
  const entrouEm = format(
    new TZDate(new Date(entrada.created_at).getTime(), timezone),
    "dd/MM/yyyy",
    { locale: ptBR },
  );

  const acoes = (desabilitadas: boolean) => (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Subir ${nome} na fila`}
        disabled={desabilitadas || posicao === 1 || pendente}
        onClick={aoSubir}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Descer ${nome} na fila`}
        disabled={desabilitadas || posicao === total || pendente}
        onClick={aoDescer}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        aria-label={`Remover ${nome} da lista`}
        className="w-10 px-0 text-alert-text hover:bg-alert-bg hover:text-alert-text @min-[560px]/fila:w-auto @min-[560px]/fila:px-3.5"
        disabled={desabilitadas || pendente}
        onClick={aoRemover}
      >
        <UserRoundMinus />
        <span className="hidden @min-[560px]/fila:inline">Remover</span>
      </Button>
    </span>
  );

  return (
    <li
      ref={refDaLinha}
      className={cn(
        LINHA,
        "relative min-h-14 items-center border-b border-border bg-card py-2 transition-colors duration-(--dur-fast) hover:bg-surface-subtle",
        isOver && !isDragging ? "ring-2 ring-primary-edge ring-inset" : "",
        isDragging ? "z-10 shadow-pop hover:bg-card" : "",
      )}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            }
          : undefined
      }
    >
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        aria-hidden
        className={cn(
          "col-start-2 grid size-10 touch-none place-items-center rounded-md text-text-secondary",
          podeEditar && !pendente
            ? "cursor-grab hover:bg-surface-3 hover:text-text-strong active:cursor-grabbing"
            : "cursor-not-allowed opacity-45",
        )}
      >
        <GripVertical className="size-4" />
      </span>
      <span className="cz-num text-[13px] font-semibold text-text-secondary">
        {posicao}º
      </span>
      <div className="flex min-w-0 items-center gap-2.5">
        <ContactAvatar
          name={entrada.contact?.name ?? null}
          phone={entrada.contact?.phone_e164 ?? ""}
          size={24}
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-[13.5px] font-semibold text-text-strong">
            {nome}
          </span>
          {/* Grade estreita: telefone, preferencia e entrada numa linha so. */}
          <span className="truncate text-xs text-text-secondary @min-[880px]/fila:hidden">
            {telefone ? (
              <>
                <span className="cz-num">{telefone}</span> ·{" "}
              </>
            ) : null}
            {pref} · entrou em <span className="cz-num">{entrouEm}</span>
          </span>
        </div>
      </div>
      <span
        className={cn(SO_LARGA, "truncate text-[13px] text-text-secondary")}
      >
        {telefone ? <span className="cz-num">{telefone}</span> : "Sem telefone"}
      </span>
      <span
        className={cn(SO_LARGA, "truncate text-[13px] text-foreground")}
        title={pref}
      >
        <span className="sr-only">Preferência: </span>
        {pref}
      </span>
      <span
        className={cn(SO_LARGA, "text-right text-[13px] text-text-secondary")}
      >
        <span className="sr-only">Entrou em </span>
        <span className="cz-num">{entrouEm}</span>
      </span>
      <span className="flex justify-end">
        {podeEditar ? (
          acoes(false)
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            {acoes(true)}
          </DisabledWithHint>
        )}
      </span>
    </li>
  );
}
