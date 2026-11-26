"use client";

import { CircleHelp } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// O "?" ao lado de um titulo ou campo (pedido do dono de 26/11/2026: a tela
// mostra, nao explica). A explicacao que evita erro fica na dica, e tambem
// no texto escondido ligado por aria-describedby (como a ChaveTravada): o
// leitor de tela ouve sem passar o mouse. O provedor proprio deixa o icone
// funcionar em qualquer cartao, sem depender de quem monta a tela.
export function Ajuda({
  rotulo,
  texto,
  id: idDoTexto,
}: {
  rotulo: string;
  texto: string;
  /** O id do texto escondido, para outro controle tambem apontar para ele. */
  id?: string;
}) {
  const gerado = useId();
  const id = idDoTexto ?? gerado;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Ajuda: ${rotulo}`}
            aria-describedby={id}
            className="text-text-secondary"
          >
            <CircleHelp aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{texto}</TooltipContent>
      </Tooltip>
      <span id={id} className="sr-only">
        {texto}
      </span>
    </TooltipProvider>
  );
}
