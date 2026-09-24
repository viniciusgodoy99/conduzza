import { X } from "lucide-react";

import { STATUS_TONE_VARS } from "@/lib/design/status";
import type { TomDeEtiqueta } from "@/lib/domain/etiquetas-de-conversa";
import { cn } from "@/lib/utils";

// Chip de etiqueta de conversa, com a pele da Tag do design system Conduzza
// (docs/06 secao 4.6): fundo neutro, fio fino e um marcador pequeno na cor do
// tom. De proposito NAO parece status: etiqueta e vocabulario da clinica, nao
// estado do produto, entao nao reusa o StatusChip (pilula colorida com icone).
//
// A camada discriminante e o NOME, sempre renderizado: o marcador acompanha,
// nunca carrega sozinho o significado (regra 5).
//
// Tamanhos: "padrao" (24px, Configuracoes, painel do Atendimento, ficha) e
// "compacto" (18px, lista de conversas e kanban). A etiqueta compacta usa
// 10,5px, excecao documentada ao piso de 11px (13,5:1 de contraste).

export function ChipDeEtiqueta({
  nome,
  tom,
  tamanho = "padrao",
  aoRemover,
  removerDesabilitado = false,
  className,
}: {
  nome: string;
  tom: TomDeEtiqueta;
  tamanho?: "compacto" | "padrao";
  /** Mostra o X de remover, com nome acessivel "Remover etiqueta {nome}" */
  aoRemover?: () => void;
  /** Desabilita o X enquanto a remocao anterior ainda esta em andamento */
  removerDesabilitado?: boolean;
  className?: string;
}) {
  const compacto = tamanho === "compacto";
  return (
    <span
      data-tamanho={tamanho}
      className={cn(
        "inline-flex max-w-full items-center font-medium text-foreground",
        compacto
          ? "h-[18px] shrink-0 gap-1 overflow-hidden rounded-[4px] bg-surface-4 px-1.5 text-[10.5px]"
          : "h-6 gap-1.5 rounded-sm border border-border-strong bg-card px-2.5 text-xs",
        aoRemover && "pr-1",
        className,
      )}
      title={nome}
    >
      <span
        aria-hidden
        className={cn(
          "shrink-0",
          compacto ? "size-[5px] rounded-[1.5px]" : "size-[7px] rounded-[2px]",
        )}
        style={{ background: STATUS_TONE_VARS[tom].marker }}
      />
      {/* O truncate vive no TEXTO: num container inline-flex ele nao
          produziria reticencias, e dois nomes longos apareceriam cortados
          no mesmo ponto, indistinguiveis. */}
      <span className="truncate">{nome}</span>
      {aoRemover ? (
        <button
          type="button"
          onClick={aoRemover}
          disabled={removerDesabilitado}
          aria-label={`Remover etiqueta ${nome}`}
          className="hit-40 relative grid size-4 shrink-0 place-items-center rounded-[4px] text-text-secondary cz-transition hover:bg-surface-3 hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45"
        >
          <X aria-hidden className="size-[11px]" />
        </button>
      ) : null}
    </span>
  );
}
