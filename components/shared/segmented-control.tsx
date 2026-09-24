import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Seletor segmentado para 2 a 4 vistas que se excluem (docs/06 secao 4.6),
// no desenho do SegmentedControl do design system Conduzza: trilho afundado e
// a opcao ligada em pilula clara. Substitui as 3 copias feitas a mao (filtro
// da Agenda, Kanban/Lista de Leads, Resposta/Nota do compositor), que migram
// no lote de cada tela.
//
// Semantica: grupo de botoes com aria-pressed, e NAO tablist. Nao ha painel
// associado a cada opcao, e os e2e clicam getByRole("button", { name }).
// A opcao ligada nao depende so da cor: ganha negrito, sombra e um anel de
// 4,42:1 (ink-500), porque branco sobre o trilho da 1,2:1.
//
// A contagem vem sempre depois de um espaco literal ("Todas 4"): o nome
// acessivel precisa do espaco, e ha e2e que busca /Todas 4/.

export type OpcaoSegmentada<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  block = false,
  ariaLabel,
  className,
}: {
  options: readonly OpcaoSegmentada<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Ocupa a largura toda, com as opcoes repartindo o espaco */
  block?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const pequeno = size === "sm";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "gap-0.5 rounded-lg bg-surface-4 p-[3px]",
        block ? "flex w-full" : "inline-flex",
        pequeno ? "h-[34px]" : "h-10",
        className,
      )}
    >
      {options.map((opcao) => {
        const ligada = opcao.value === value;
        const Icone = opcao.icon;
        return (
          <button
            key={opcao.value}
            type="button"
            aria-pressed={ligada}
            onClick={() => onChange(opcao.value)}
            className={cn(
              "hit-40 inline-flex items-center justify-center gap-1.5 rounded-[7px] px-3 font-medium whitespace-nowrap text-text-secondary cz-transition hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid aria-pressed:bg-card aria-pressed:font-bold aria-pressed:text-text-strong aria-pressed:shadow-xs aria-pressed:ring-1 aria-pressed:ring-input aria-pressed:ring-inset",
              pequeno ? "h-7 text-xs" : "h-[34px] text-[13px]",
              block && "flex-1",
            )}
          >
            {Icone ? <Icone aria-hidden className="size-3.5 shrink-0" /> : null}
            {opcao.label}
            {opcao.count != null ? (
              <>
                {" "}
                <span className="cz-num text-[11px] text-text-secondary">
                  {opcao.count}
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
