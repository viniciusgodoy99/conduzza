"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { BarraSuperior } from "@/components/shell/barra-superior";
import { GavetaDoRail, Rail, type PropsDoRail } from "@/components/shell/rail";
import type { ContadoresDoMenu, ViewerDoShell } from "@/components/shell/tipos";
import { useContadoresDoMenu } from "@/components/shell/use-contadores-do-menu";
import { useRail } from "@/components/shell/use-rail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createT, type Labels } from "@/lib/branding/labels";
import { visibleModules, type Role } from "@/lib/domain/permissions";
import {
  NAV_ITEMS,
  itemDaRota,
  type NavItem,
  type PreferenciaDoRail,
} from "@/lib/navigation";

// Shell da area logada no Conduzza Design System (docs/06 secao 5.1). A raiz
// ocupa a tela inteira sem rolar (h-dvh overflow-hidden) e so o <main> rola:
// assim as telas cheias (Atendimento e Agenda) usam h-full e a faixa de
// WhatsApp ou de motor nunca empurra o compositor para fora da tela.
//
// Partes: rail.tsx (menu lateral e gaveta), barra-superior.tsx, use-rail.ts
// (recolher e expandir, guardado em cookie) e use-contadores-do-menu.ts
// (contadores ao vivo). O atributo data-rail na raiz guarda a preferencia e
// alimenta a variante rail-aberto do globals.css.

function itemsForRole(role: Role): NavItem[] {
  const visible = new Set(visibleModules(role));
  return NAV_ITEMS.filter(
    (item) => item.moduleKey === null || visible.has(item.moduleKey),
  );
}

export function AppShell({
  viewer,
  clinicId,
  timezone,
  counts,
  canSwitchClinic = false,
  labels = null,
  banner = null,
  preferenciaDoRail = "auto",
  children,
}: {
  viewer: ViewerDoShell;
  /** Clinica ativa: os contadores do menu vigiam so ela. */
  clinicId: string;
  /** Fuso da clinica: o "amanha" das confirmacoes e o dela. */
  timezone: string;
  /** Contagens do servidor para o primeiro paint. */
  counts: ContadoresDoMenu;
  canSwitchClinic?: boolean;
  labels?: Partial<Labels> | null;
  banner?: React.ReactNode;
  /** Preferencia gravada no cookie cz_rail (lida no layout). */
  preferenciaDoRail?: PreferenciaDoRail;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const items = itemsForRole(viewer.role);
  const t = createT(labels);
  const rota = itemDaRota(pathname);
  const titulo = rota
    ? rota.labelKey
      ? t(rota.labelKey, { plural: true, capitalize: true })
      : rota.label
    : null;

  const { preferencia, aberto, alternarRail } = useRail(preferenciaDoRail);
  const contadores = useContadoresDoMenu({
    clinicId,
    timezone,
    iniciais: counts,
    vigiarConversas: items.some((item) => item.badge === "conversas"),
    vigiarConfirmacoes: items.some((item) => item.badge === "confirmacoes"),
  });

  // So o <main> rola: a cada tela nova ele volta ao topo (a janela nao rola
  // mais, entao a restauracao do navegador nao faz isso sozinha).
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const propsDoRail: PropsDoRail = {
    viewer,
    itens: items,
    itemAtivo: rota?.href ?? null,
    contadores,
    t,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-rail={preferencia}
        className="flex h-dvh overflow-hidden bg-background text-foreground print:block print:h-auto print:overflow-visible"
      >
        {/* Menu lateral escuro nos dois temas; gaveta abaixo de 1024px */}
        <aside
          id="menu-lateral"
          className="hidden h-full w-sidebar-collapsed shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-(--dur-base) ease-standard motion-reduce:transition-none lg:flex print:hidden rail-aberto:w-sidebar"
        >
          <Rail {...propsDoRail} recolhido={!aberto} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Faixas de WhatsApp desconectado e motor parado, no topo */}
          <div className="shrink-0 print:hidden">{banner}</div>
          <BarraSuperior
            viewer={viewer}
            titulo={titulo}
            canSwitchClinic={canSwitchClinic}
            gaveta={<GavetaDoRail {...propsDoRail} />}
            railAberto={aberto}
            aoAlternarRail={alternarRail}
          />
          <main
            ref={mainRef}
            className="relative cz-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain print:overflow-visible"
          >
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
