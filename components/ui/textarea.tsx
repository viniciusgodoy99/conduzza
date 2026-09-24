import * as React from "react";

import { cn } from "@/lib/utils/index";

// Mesma casca do Input (docs/06 secao 4.5), com altura livre.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-y rounded-lg border border-input bg-card px-3 py-2.5 text-base leading-[1.5] text-foreground [color-scheme:light] shadow-xs outline-none cz-transition placeholder:text-text-tertiary focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-ring/55 disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:[color-scheme:dark]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
