"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Padrao do brief para acao sem permissao: o controle fica VISIVEL e
// desabilitado, com dica explicando por que. Nunca escondido. O span com
// tabIndex e obrigatorio: elemento desabilitado nao dispara evento de
// ponteiro e a dica nunca abriria sem ele. A dica leva a frase inteira (o
// porque), nao a regra de 5 palavras do tooltip do DS (docs/06, C23).
export function DisabledWithHint({
  hint,
  children,
  className,
}: {
  hint: string;
  children: React.ReactNode;
  /** Substitui o w-fit (ex.: w-full para botao de bloco) */
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("inline-flex w-fit cursor-not-allowed", className)}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
