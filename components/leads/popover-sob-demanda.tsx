"use client";

import {
  cloneElement,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Popover que so monta o do Radix no primeiro toque. A lista de Leads tem
// ate 1000 linhas e cada uma ganhou dois popovers (a etapa e as etiquetas,
// pedido do dono em 20/10/2026): montar os 2000 de saida dobrava o tempo de
// desenhar a lista. Antes do primeiro toque, o gatilho e o MESMO botao, com
// o aria-haspopup e o aria-expanded que o Radix poe nele; o toque monta o
// popover ja aberto e o foco entra nele, como sempre. Depois, fica montado.

type Gatilho = ReactElement<ComponentProps<"button">>;

/**
 * O gatilho antes do primeiro uso: o mesmo botao, anunciado como quem abre
 * um popover, que abre no clique (o Enter e o Espaco do botao viram clique).
 */
export function gatilhoAntesDeAbrir(
  gatilho: Gatilho,
  aoAbrir: () => void,
): Gatilho {
  return cloneElement(gatilho, {
    "aria-haspopup": "dialog",
    "aria-expanded": false,
    onClick: (evento: MouseEvent<HTMLButtonElement>) => {
      gatilho.props.onClick?.(evento);
      aoAbrir();
    },
  });
}

export function PopoverSobDemanda({
  aberto,
  aoMudar,
  gatilho,
  children,
  ...conteudo
}: Omit<ComponentProps<typeof PopoverContent>, "children"> & {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  /** Um botao: vira o PopoverTrigger quando o popover monta */
  gatilho: Gatilho;
  children: ReactNode;
}) {
  const [montado, setMontado] = useState(false);
  if (!montado && !aberto) {
    return gatilhoAntesDeAbrir(gatilho, () => {
      setMontado(true);
      aoMudar(true);
    });
  }
  return (
    <Popover open={aberto} onOpenChange={aoMudar}>
      <PopoverTrigger asChild>{gatilho}</PopoverTrigger>
      <PopoverContent {...conteudo}>{children}</PopoverContent>
    </Popover>
  );
}
