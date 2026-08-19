"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Padrao do brief para acao sem permissao: o controle fica VISIVEL e
// desabilitado, com dica explicando por que. Nunca escondido. O span com
// tabIndex e obrigatorio: elemento desabilitado nao dispara evento de
// ponteiro e a dica nunca abriria sem ele.
export function DisabledWithHint({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex w-fit">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
