"use client";

import { Lock } from "lucide-react";
import { useId } from "react";

import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DICA_DE_OBRIGATORIA } from "@/lib/domain/agente/config";
import { cn } from "@/lib/utils";

// Chave travada da Tela 6 (docs/06, C24): o Switch fica LIGADO, com
// aria-disabled e opacidade cheia (excecao documentada aos 45% do
// desabilitado), o cadeado ao lado e a dica "Obrigatória, não pode ser
// desligada". Nao usa o disabled do Radix (que apagaria a chave e a tiraria
// do foco): a chave continua focavel para a dica abrir no teclado, e o
// clique nao muda nada (controlada, sempre ligada). A dica tambem fica no
// texto escondido ligado por aria-describedby, para o leitor de tela.

export function ChaveTravada({
  rotulo,
  descricao,
  className,
}: {
  rotulo: string;
  descricao?: string;
  className?: string;
}) {
  const idRotulo = useId();
  const idDica = useId();
  return (
    <div
      className={cn(
        "flex min-h-10 items-center justify-between gap-3",
        className,
      )}
    >
      <span className="grid min-w-0 gap-0.5">
        <span id={idRotulo} className="text-[13.5px] font-semibold">
          {rotulo}
        </span>
        {descricao ? (
          <span className="text-xs text-text-secondary">{descricao}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Lock aria-hidden className="size-3.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            {/* data-checked: o gatilho da dica troca o data-state da chave
                pelo dele ("closed"), e sem isto a chave perderia o lime de
                ligada (a variante data-checked aceita os dois). */}
            <Switch
              checked
              data-checked=""
              aria-disabled="true"
              aria-labelledby={idRotulo}
              aria-describedby={idDica}
              onCheckedChange={() => undefined}
              className="cursor-not-allowed"
            />
          </TooltipTrigger>
          <TooltipContent>{DICA_DE_OBRIGATORIA}</TooltipContent>
        </Tooltip>
        <span id={idDica} className="sr-only">
          {DICA_DE_OBRIGATORIA}
        </span>
      </span>
    </div>
  );
}
