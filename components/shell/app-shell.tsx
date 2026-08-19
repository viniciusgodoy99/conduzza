"use client";

import { Bell, LogOut, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { NavBadge } from "@/components/shell/nav-badge";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { visibleModules, type Role } from "@/lib/domain/permissions";
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

// Shell da area logada (brief secoes 4 e 6): rail de 240px com dois grupos,
// colapso automatico para 64px abaixo de 1600px, gaveta abaixo de 1024px,
// barra superior de 56px. Item ativo: barra de 3px na primaria + Superficie 2.

type Viewer = {
  name: string;
  role: Role;
  roleLabel: string;
  clinicName: string;
  productName: string;
};

type Counts = Partial<Record<"conversas" | "confirmacoes", number>>;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function itemsForRole(role: Role): NavItem[] {
  const visible = new Set(visibleModules(role));
  return NAV_ITEMS.filter(
    (item) => item.moduleKey === null || visible.has(item.moduleKey),
  );
}

function NavList({
  items,
  pathname,
  counts,
  collapsible,
}: {
  items: NavItem[];
  pathname: string;
  counts: Counts;
  /** true no rail (rotulos somem no colapso); false na gaveta */
  collapsible: boolean;
}) {
  const groups: ("operacao" | "ajustes")[] = ["operacao", "ajustes"];
  return (
    <nav className="grid gap-1 px-2" aria-label="Navegação principal">
      {groups.map((group) => (
        <div key={group} className="grid gap-1">
          <p
            className={cn(
              "px-3 pt-4 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-text-tertiary uppercase",
              collapsible && "hidden wide:block",
            )}
          >
            {NAV_GROUPS[group]}
          </p>
          {collapsible ? (
            <div
              aria-hidden
              className="mx-auto mt-4 mb-1 h-px w-6 bg-border first:mt-0 wide:hidden"
            />
          ) : null}
          {items
            .filter((item) => item.group === group)
            .map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-surface-2 text-foreground"
                      : "text-text-secondary hover:bg-surface-2/60 hover:text-foreground",
                    collapsible && "justify-center wide:justify-start",
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-primary"
                    />
                  ) : null}
                  <Icon
                    strokeWidth={active ? 2 : 1.5}
                    className="size-4 shrink-0"
                  />
                  <span className={cn(collapsible && "hidden wide:inline")}>
                    {item.label}
                  </span>
                  <span className={cn(collapsible && "hidden wide:contents")}>
                    <NavBadge count={item.badge ? counts[item.badge] : null} />
                  </span>
                </Link>
              );
              if (!collapsible) {
                return link;
              }
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" className="wide:hidden">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ productName }: { productName: string }) {
  return (
    <div className="flex h-14 items-center px-4">
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground wide:hidden"
      >
        {productName[0] ?? "C"}
      </span>
      <span className="hidden truncate text-[15px] font-semibold wide:block">
        {productName}
      </span>
    </div>
  );
}

export function AppShell({
  viewer,
  counts = {},
  children,
}: {
  viewer: Viewer;
  counts?: Counts;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = itemsForRole(viewer.role);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh bg-background text-foreground">
        {/* Rail: 240px em telas largas, 64px de 1024 a 1599, gaveta abaixo de 1024 */}
        <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col border-r border-border bg-surface-1 wide:w-60 lg:flex">
          <Brand productName={viewer.productName} />
          <div className="flex-1 overflow-y-auto pb-4">
            <NavList
              items={items}
              pathname={pathname}
              counts={counts}
              collapsible
            />
          </div>
          <div className="border-t border-border px-2 py-3 wide:px-4">
            <div className="flex items-center justify-center gap-3 wide:justify-start">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {initialsOf(viewer.name)}
              </span>
              <div className="hidden min-w-0 wide:grid">
                <span className="truncate text-sm font-medium">
                  {viewer.name}
                </span>
                <span className="truncate text-xs text-text-tertiary">
                  {viewer.roleLabel}
                </span>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barra superior de 56px */}
          <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-surface-1 px-4">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 lg:hidden"
                  aria-label="Abrir menu"
                >
                  <Menu strokeWidth={1.5} className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <Brand productName={viewer.productName} />
                <div
                  className="overflow-y-auto pb-4"
                  onClick={() => setDrawerOpen(false)}
                >
                  <NavList
                    items={items}
                    pathname={pathname}
                    counts={counts}
                    collapsible={false}
                  />
                </div>
              </SheetContent>
            </Sheet>

            <p className="truncate text-sm text-text-secondary">
              {viewer.clinicName}
            </p>

            <div className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10"
                      disabled
                      aria-label="Busca global"
                    >
                      <Search strokeWidth={1.5} className="size-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Busca disponível em breve</TooltipContent>
              </Tooltip>

              <ThemeToggle />

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    aria-label="Notificações"
                  >
                    <Bell strokeWidth={1.5} className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64">
                  <p className="text-sm text-text-secondary">
                    Nenhuma notificação por enquanto.
                  </p>
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="size-10 rounded-full p-0"
                    aria-label="Menu do usuário"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {initialsOf(viewer.name)}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="grid">
                    <span className="truncate">{viewer.name}</span>
                    <span className="text-xs font-normal text-text-tertiary">
                      {viewer.roleLabel} · {viewer.clinicName}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>
                    <LogOut strokeWidth={1.5} className="size-4" />
                    Sair (disponível com o login)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
