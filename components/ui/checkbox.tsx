"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils/index";
import { CheckIcon, MinusIcon } from "lucide-react";

// Checkbox do Conduzza Design System (docs/06 secao 4.5): 17px visuais com
// area de toque de 41px pelo pseudo-elemento. Borda desmarcada em --input
// (3:1, C4) e borda marcada em --primary-edge (C6), porque o lime-400 sozinho
// da 1,48:1 no branco. Indeterminado mostra um traco.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group/checkbox relative flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border border-input bg-card outline-none cz-transition after:absolute after:-inset-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive data-[state=indeterminate]:border-primary-edge data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-checked:border-primary-edge data-checked:bg-primary data-checked:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3"
      >
        <CheckIcon className="group-data-[state=indeterminate]/checkbox:hidden" />
        <MinusIcon className="hidden group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
