"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// Switch do Conduzza Design System (docs/06 secao 4.5, C6). Desligado: trilho
// afundado com borda --input e polegar ink-600 (5,76:1 sobre o trilho).
// Ligado: trilho lime com borda --primary-edge e polegar de tinta (12,4:1).
// Area de toque de 40px pelo pseudo-elemento nos dois tamanhos.
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-(--dur-base) outline-none after:absolute after:-inset-x-1 after:-inset-y-[9px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid aria-invalid:border-destructive data-[size=default]:h-[22px] data-[size=default]:w-10 data-[size=sm]:h-[18px] data-[size=sm]:w-8 data-[size=sm]:after:-inset-y-[11px] data-checked:border-primary-edge data-checked:bg-primary data-unchecked:border-input data-unchecked:bg-surface-4 data-disabled:cursor-not-allowed data-disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block translate-x-[2px] rounded-full transition-transform duration-(--dur-base) ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-checked:bg-primary-foreground group-data-[size=default]/switch:data-checked:translate-x-[20px] group-data-[size=sm]/switch:data-checked:translate-x-[16px] data-unchecked:bg-text-secondary"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
