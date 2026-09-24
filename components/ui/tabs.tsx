"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className,
      )}
      {...props}
    />
  );
}

// Abas do Conduzza Design System (docs/06 secao 4.5, D11), sempre com
// role=tab do Radix:
// - line (padrao): sublinhado, para 5 ou mais vistas; a lista rola na
//   horizontal em vez de quebrar linha;
// - segmented: trilho afundado, para 2 a 4 vistas; a aba ativa ganha cartao
//   branco e negrito (o negrito e a pista que nao e cor);
// - cartoes: sem estilo de gatilho, o chamador desenha o cartao (Automacoes).
type TabsVariant = "line" | "segmented" | "cartoes";

const TabsVariantContext = React.createContext<TabsVariant>("line");

const tabsListVariants = cva(
  "group/tabs-list items-center text-text-secondary group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        line: "inline-flex h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border bg-transparent p-0",
        segmented:
          "inline-flex h-10 w-fit gap-0.5 rounded-lg bg-surface-4 p-[3px]",
        cartoes: "grid h-auto w-full gap-3 bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
);

const tabsTriggerVariants = cva(
  "relative outline-none cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px]",
  {
    variants: {
      variant: {
        line: "inline-flex min-h-10 flex-none items-center justify-center gap-[7px] px-3 pt-2.5 pb-[11px] text-[13.5px] font-medium whitespace-nowrap text-text-secondary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary-edge after:opacity-0 hover:text-text-strong focus-visible:-outline-offset-2 data-active:font-bold data-active:text-text-strong data-active:after:opacity-100",
        segmented:
          "inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap text-text-secondary hit-40 hover:text-text-strong focus-visible:outline-offset-1 data-active:bg-card data-active:font-bold data-active:text-text-strong data-active:shadow-xs",
        cartoes: "block w-full rounded-card text-left",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
);

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const variante = variant ?? "line";
  return (
    <TabsVariantContext.Provider value={variante}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variante}
        className={cn(tabsListVariants({ variant: variante }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variante = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant: variante }), className)}
      {...props}
    />
  );
}

// Contagem dentro do gatilho. O espaco antes do numero fica a cargo do
// chamador quando um e2e buscar o texto com o numero junto.
function TabsCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        "ml-1.5 rounded-full bg-surface-4 px-1.5 py-px cz-num text-[11px] font-medium text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsCount,
  tabsListVariants,
  tabsTriggerVariants,
};
