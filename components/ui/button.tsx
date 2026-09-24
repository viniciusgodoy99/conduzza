import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Button do Conduzza Design System (docs/06 secao 4.5, D18). Os nomes das
// variantes continuam os do app: default = primary do DS, outline = secondary
// do DS, secondary = soft do DS, destructive = danger do DS (suave), solid e o
// botao de tinta. Alvo de toque de 40px (C7): o padrao e o icon ja tem 40px;
// sm e icon-sm mantem o tamanho visual do DS e ganham a area pelo hit-40.
// Foco: contorno de 2px em --focus com offset de 2px (C5).
const SIZE_SM =
  "h-[30px] gap-1.5 px-2.5 text-[13px] hit-40 [&_svg:not([class*='size-'])]:size-3.5";
const SIZE_ICON_SM =
  "size-7 rounded-md hit-40 active:not-aria-[haspopup]:scale-[.94] [&_svg:not([class*='size-'])]:size-[15px]";

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-[7px] rounded-lg border border-transparent bg-clip-padding text-sm font-semibold tracking-[-0.005em] whitespace-nowrap outline-none select-none cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid active:not-aria-[haspopup]:scale-[.975] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        outline:
          "border-border-strong bg-card text-text-strong shadow-xs hover:bg-surface-3 aria-expanded:bg-surface-3",
        secondary:
          "bg-primary-soft text-primary-text hover:bg-primary-soft-hover",
        ghost:
          "text-foreground hover:bg-surface-3 hover:text-text-strong aria-expanded:bg-surface-3",
        destructive: "bg-alert-bg text-alert-text hover:bg-alert-bg-hover",
        solid:
          "bg-inverse text-inverse-foreground shadow-xs hover:bg-inverse-hover",
        link: "text-primary-text underline-offset-2 hover:underline",
      },
      size: {
        default: "h-10 px-3.5",
        // xs e deprecado: igual ao sm.
        xs: SIZE_SM,
        sm: SIZE_SM,
        lg: "h-11 gap-2 px-5 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-10 rounded-md active:not-aria-[haspopup]:scale-[.94] [&_svg:not([class*='size-'])]:size-[17px]",
        // icon-xs e deprecado: igual ao icon-sm.
        "icon-xs": SIZE_ICON_SM,
        "icon-sm": SIZE_ICON_SM,
        "icon-lg":
          "size-11 rounded-md active:not-aria-[haspopup]:scale-[.94] [&_svg:not([class*='size-'])]:size-[19px]",
      },
    },
    compoundVariants: [
      // O link nao tem casca: vem depois do tamanho para anular altura e
      // padding.
      { variant: "link", className: "h-auto border-0 px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
