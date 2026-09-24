import * as React from "react";

import { cn } from "@/lib/utils";

// Campo do Conduzza Design System (docs/06 secao 4.5): 40px, borda --input
// (3:1, C4). No foco a borda vira --focus (o indicador) e o halo lime do DS
// fica como enfeite. Tipos date, time, datetime-local e number: o chamador
// acrescenta cz-num.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground [color-scheme:light] shadow-xs outline-none cz-transition file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-tertiary focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-ring/55 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:[color-scheme:dark]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
