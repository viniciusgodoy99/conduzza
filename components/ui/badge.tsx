import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Badge com a aparencia da Tag do Conduzza Design System (docs/06 secao 4.5).
// Hoje so a especialidade do profissional usa (variant="secondary"). Nao e
// status: status usa o StatusChip, sempre com icone, rotulo e cor.
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-sm border border-border-strong bg-card px-2.5 text-xs font-medium whitespace-nowrap text-foreground outline-none cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "[a]:hover:bg-surface-3",
        destructive: "border-transparent bg-alert-bg text-alert-text",
        outline: "[a]:hover:bg-surface-3",
        ghost: "border-transparent bg-transparent hover:bg-surface-3",
        link: "border-transparent bg-transparent text-primary-text underline-offset-2 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
