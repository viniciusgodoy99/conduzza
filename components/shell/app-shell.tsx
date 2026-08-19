"use client";

import { ArrowLeftRight, Bell, LogOut, Menu, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { signOutAction } from "@/app/(auth)/actions";
import { createT, type Labels, type Translate } from "@/lib/branding/labels";

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
import {
  NAV_GROUPS,
  NAV_ITEMS,
  type NavGroup,
  type NavItem,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

// Shell da area logada no layout do handoff Conduzza: sidebar vertical de
// 236px, fundo escuro fixo nos dois temas (e onde o logo branco funciona),
// itens de 42px com raio 10px, item ativo com fundo lime translucido, texto
// #D8F07E e barra interna de 3px. Abaixo de 1024px a sidebar vira gaveta.

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
  t,
}: {
  items: NavItem[];
  pathname: string;
  counts: Counts;
  t: Translate;
}) {
  const groups: NavGroup[] = ["operacao", "inteligencia"];
  return (
    <nav className="grid gap-1 px-3" aria-label="Navegação principal">
      {groups.map((group) => (
        <div key={group} className="grid gap-1">
          <p className="px-3 pt-5 pb-1 text-[10px] font-semibold tracking-[0.12em] [color:var(--sidebar-muted)] uppercase">
            {NAV_GROUPS[group]}
          </p>
          {items
            .filter((item) => item.group === group)
            .map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-[42px] items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors",
                    active
                      ? "[color:var(--sidebar-active-text)] [background:var(--sidebar-active-bg)]"
                      : "[color:var(--sidebar-foreground)] hover:[color:var(--sidebar-accent-foreground)] hover:[background:var(--sidebar-accent)]",
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full [background:var(--sidebar-active-bar)]"
                    />
                  ) : null}
                  <Icon
                    strokeWidth={active ? 2 : 1.5}
                    className="size-4 shrink-0"
                  />
                  <span>
                    {item.labelKey
                      ? t(item.labelKey, { plural: true, capitalize: true })
                      : item.label}
                  </span>
                  <NavBadge count={item.badge ? counts[item.badge] : null} />
                </Link>
              );
            })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ productName }: { productName: string }) {
  return (
    <div className="flex h-[52px] items-center border-b [border-color:var(--sidebar-border)] px-4">
      <Image
        src="/brand/conduzza-logo-branca.webp"
        alt={productName}
        width={118}
        height={18}
        priority
        className="h-auto w-[118px]"
      />
    </div>
  );
}

function SidebarBody({
  viewer,
  items,
  pathname,
  counts,
  t,
}: {
  viewer: Viewer;
  items: NavItem[];
  pathname: string;
  counts: Counts;
  t: Translate;
}) {
  return (
    <>
      <Brand productName={viewer.productName} />
      <div className="flex-1 overflow-y-auto pb-4">
        <NavList items={items} pathname={pathname} counts={counts} t={t} />
      </div>
      <div className="border-t [border-color:var(--sidebar-border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold [color:var(--sidebar-accent-foreground)]">
            {initialsOf(viewer.name)}
          </span>
          <div className="grid min-w-0">
            <span className="truncate text-sm font-medium [color:var(--sidebar-accent-foreground)]">
              {viewer.name}
            </span>
            <span className="truncate text-xs [color:var(--sidebar-muted)]">
              {viewer.roleLabel}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export function AppShell({
  viewer,
  counts = {},
  canSwitchClinic = false,
  labels = null,
  children,
}: {
  viewer: Viewer;
  counts?: Counts;
  canSwitchClinic?: boolean;
  labels?: Partial<Labels> | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = itemsForRole(viewer.role);
  const t = createT(labels);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh bg-background text-foreground">
        {/* Sidebar de 236px, escura nos dois temas; gaveta abaixo de 1024px */}
        <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col [background:var(--sidebar)] lg:flex">
          <SidebarBody
            viewer={viewer}
            items={items}
            pathname={pathname}
            counts={counts}
            t={t}
          />
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
              <SheetContent
                side="left"
                className="flex w-64 flex-col gap-0 border-0 p-0 [background:var(--sidebar)]"
              >
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <div
                  className="flex min-h-0 flex-1 flex-col"
                  onClick={() => setDrawerOpen(false)}
                >
                  <SidebarBody
                    viewer={viewer}
                    items={items}
                    pathname={pathname}
                    counts={counts}
                    t={t}
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
                  {canSwitchClinic ? (
                    <DropdownMenuItem asChild>
                      <Link href="/selecionar-clinica">
                        <ArrowLeftRight strokeWidth={1.5} className="size-4" />
                        Trocar de clínica
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => signOutAction()}
                    >
                      <LogOut strokeWidth={1.5} className="size-4" />
                      Sair
                    </button>
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
