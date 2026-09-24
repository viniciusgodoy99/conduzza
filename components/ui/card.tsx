import * as React from "react";

import { cn } from "@/lib/utils";

// Card do Conduzza Design System (docs/06 secao 4.5): raio 16, uma borda fina
// e uma sombra baixa (nunca duas pistas). O cabecalho tem borda inferior e o
// corpo tem padding proprio; o Card nao distribui espaco entre os filhos.
type CardTone = "default" | "sunken" | "accent";

function Card({
  className,
  size = "default",
  tone = "default",
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  tone?: CardTone;
  interactive?: boolean;
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-tone={tone}
      className={cn(
        "group/card flex flex-col overflow-hidden rounded-card border border-border bg-card text-sm text-card-foreground shadow-sm",
        tone === "sunken" && "border-transparent bg-surface-4 shadow-none",
        tone === "accent" && "border-primary-edge/25 bg-primary-soft",
        interactive &&
          "cursor-pointer transition-[box-shadow,translate] duration-(--dur-base) ease-standard hover:-translate-y-px hover:shadow-md motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    />
  );
}

// Grade e nao flex: titulo e descricao ficam empilhados e o CardAction vai
// para a direita (a Card do DS so tem titulo e acoes numa linha).
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid min-h-[52px] auto-rows-min content-center items-center gap-x-3 gap-y-[3px] border-b border-border px-4 py-3.5 group-data-[size=sm]/card:px-3 group-data-[size=sm]/card:py-3 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base leading-[1.3] font-bold tracking-[-0.01em] text-text-strong group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[12.5px] text-text-secondary", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 flex items-center gap-1.5 self-center justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("p-4 group-data-[size=sm]/card:p-3", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-border bg-surface-subtle px-4 py-3.5 group-data-[size=sm]/card:px-3 group-data-[size=sm]/card:py-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
