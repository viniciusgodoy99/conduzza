"use client";

import {
  ArrowLeftRight,
  Bell,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/app/(auth)/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import type { ViewerDoShell } from "@/components/shell/tipos";
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

// Barra superior do Conduzza Design System (docs/06 secao 5.1): 60px,
// branca, um fio embaixo. Na esquerda, o gatilho do menu (gaveta abaixo de
// 1024px, recolher e expandir a partir dai), o nome da clinica como rotulo
// pequeno e o titulo do modulo. O titulo e <p> e nao heading: cada tela ja
// tem o seu h1 no cabecalho da pagina, e os testes procuram por ele.
//
// Na direita (conflito C21): busca desabilitada com dica honesta, tema,
// notificacoes sem contador inventado e o menu da conta. Sem botao de ajuda.

export function BarraSuperior({
  viewer,
  titulo,
  canSwitchClinic,
  gaveta,
  railAberto,
  aoAlternarRail,
}: {
  viewer: ViewerDoShell;
  /** Titulo do modulo da rota atual; null fora do menu. */
  titulo: string | null;
  canSwitchClinic: boolean;
  /** Gaveta do menu com o gatilho "Abrir menu" (abaixo de 1024px). */
  gaveta: React.ReactNode;
  railAberto: boolean;
  aoAlternarRail: () => void;
}) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6 print:hidden">
      {gaveta}
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-10 text-text-secondary lg:inline-flex"
        aria-label={railAberto ? "Recolher menu" : "Expandir menu"}
        aria-controls="menu-lateral"
        aria-expanded={railAberto}
        onClick={aoAlternarRail}
      >
        {railAberto ? (
          <PanelLeftClose aria-hidden className="size-[18px]" />
        ) : (
          <PanelLeftOpen aria-hidden className="size-[18px]" />
        )}
      </Button>

      <div className="grid min-w-0 gap-px">
        <p className="truncate cz-eyebrow text-text-secondary">
          {viewer.clinicName}
        </p>
        {titulo ? (
          <p className="truncate text-[17px] leading-[1.25] font-bold tracking-[-0.015em] text-text-strong md:text-[19px]">
            {titulo}
          </p>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DisabledWithHint
          hint="Busca geral ainda não existe. Use a busca de cada tela."
          className="hidden md:inline-flex"
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            disabled
            aria-label="Busca global"
          >
            <Search aria-hidden className="size-[18px]" />
          </Button>
        </DisabledWithHint>

        <ThemeToggle />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Notificações"
            >
              <Bell aria-hidden className="size-[18px]" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <p className="text-[13px] text-text-secondary">
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
              <ContactAvatar name={viewer.name} phone="" size={30} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="grid gap-0.5">
              <span className="truncate">{viewer.name}</span>
              <span className="truncate text-xs font-normal text-text-secondary">
                {viewer.roleLabel} · {viewer.clinicName}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canSwitchClinic ? (
              <DropdownMenuItem asChild>
                <Link href="/selecionar-clinica">
                  <ArrowLeftRight aria-hidden />
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
                <LogOut aria-hidden />
                Sair
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
