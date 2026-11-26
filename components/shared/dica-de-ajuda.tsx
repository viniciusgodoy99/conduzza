"use client";

import { CircleHelp } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A explicacao que evita erro, fora da tela (visual de 26/11/2026: a tela
 * mostra e nao explica). Um botao com alvo de 40px (hit-40) abre a dica no
 * hover e no foco. O nome acessivel e o `rotulo` ou, sem ele, o proprio
 * texto. Sem children, o icone de ajuda; com children (ex.: o chip
 * "Sistema"), o proprio elemento abre a dica. O provider proprio deixa usar
 * fora do shell e no HTML estatico dos testes.
 */
export function DicaDeAjuda({
  texto,
  rotulo,
  children,
}: {
  texto: string;
  rotulo?: string;
  children?: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={rotulo ?? texto}
            className="hit-40 inline-flex shrink-0 items-center rounded-sm text-text-secondary cz-transition hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            {children ?? <CircleHelp aria-hidden className="size-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{texto}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
