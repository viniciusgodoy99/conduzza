"use client";

import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOutAction } from "@/app/(auth)/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ItemDoMenu, MarcaDoRail } from "@/components/shell/rail";
import { useRail } from "@/components/shell/use-rail";
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
  Sheet,
  SheetClose,
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
import { MARCA_PADRAO } from "@/lib/branding/marca-padrao";
import {
  ABRIR_A_CLINICA,
  ITENS_DA_AREA_DA_EQUIPE,
  type NavItem,
  type PreferenciaDoRail,
} from "@/lib/navigation";

// A area do super admin (decisao do dono de 03/11/2026, "Conta propria so
// para o painel"): o Painel geral fora da clinica, com um menu proprio no
// padrao do shell da clinica (docs/06 secao 5.1): o menu lateral ink de
// 248px que recolhe para 64px abaixo de 1600px e vira gaveta abaixo de
// 1024px, a barra superior de 60px e so o <main> rolando. Sem clinica ativa:
// nada de contador, faixa de WhatsApp ou de motor, busca ou notificacoes.
//
// No menu: o Painel geral; "Abrir a clinica" so para a conta que ainda e
// membro ativo de alguma clinica (as contas antigas, ate a limpeza); e, no
// rodape, o e-mail da conta e Sair (este fica visivel tambem com o menu
// recolhido). A barra superior repete a conta, o "Abrir a clinica" e o Sair
// no menu do avatar, com a troca de tema.
//
// Quem chega aqui ja passou pela guarda do layout (app/(admin)/layout.tsx).
// Esconder ou mostrar item nao protege nada: cada acao confere o super admin
// no servidor e as funcoes do banco recusam (42501) quem nao e.

export const TEXTOS_DA_AREA_DA_EQUIPE = {
  equipeConduzza: "Equipe Conduzza",
  abrirAClinica: ABRIR_A_CLINICA.label,
  sair: "Sair",
  menuDoUsuario: "Menu do usuário",
  navegacao: "Navegação principal",
  abrirMenu: "Abrir menu",
  fecharMenu: "Fechar menu",
  recolherMenu: "Recolher menu",
  expandirMenu: "Expandir menu",
  menu: "Menu",
  clinica: "Clínica",
} as const;

type Conta = {
  /** E-mail da conta (o que a pessoa usa para entrar). */
  email: string;
  /** Nome para o avatar (o nome do perfil ou, sem ele, o e-mail). */
  nome: string;
  /** A conta ainda e membro ativo de alguma clinica (as contas antigas). */
  abrirClinica: boolean;
};

/** O item ativo pela rota (o de maior prefixo), ou null fora do menu. */
function itemAtivoDaRota(pathname: string): NavItem | null {
  return (
    ITENS_DA_AREA_DA_EQUIPE.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? null
  );
}

function RodapeDaEquipe({
  email,
  nome,
  recolhido,
}: {
  email: string;
  nome: string;
  recolhido: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-sidebar-border p-2 rail-aberto:p-3">
      <div className="flex flex-col items-center gap-1 rail-aberto:flex-row rail-aberto:gap-[9px]">
        <ContactAvatar name={nome} phone="" size={30} />
        {/* Recolhido, o e-mail fica so para o leitor de tela. */}
        <div className="sr-only rail-aberto:not-sr-only rail-aberto:grid rail-aberto:min-w-0 rail-aberto:flex-1">
          <span
            className="truncate text-[12.5px] font-semibold text-sidebar-strong"
            title={email}
          >
            {email}
          </span>
          <span className="truncate text-[11px] text-sidebar-muted">
            {TEXTOS_DA_AREA_DA_EQUIPE.equipeConduzza}
          </span>
        </div>
        <form action={signOutAction}>
          <Tooltip open={recolhido ? undefined : false}>
            <TooltipTrigger asChild>
              <button
                type="submit"
                aria-label={TEXTOS_DA_AREA_DA_EQUIPE.sair}
                className="grid size-10 place-items-center rounded-md text-sidebar-muted cz-transition hover:bg-sidebar-accent hover:text-sidebar-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
              >
                <LogOut aria-hidden className="size-[17px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {TEXTOS_DA_AREA_DA_EQUIPE.sair}
            </TooltipContent>
          </Tooltip>
        </form>
      </div>
    </div>
  );
}

/**
 * O conteudo do menu (marca, navegacao e rodape). Serve ao menu fixo e a
 * gaveta: a largura e os rotulos seguem o data-rail do ancestral.
 */
function MenuDaEquipe({
  conta,
  itemAtivo,
  recolhido,
  aoNavegar,
  acaoDaMarca,
}: {
  conta: Conta;
  itemAtivo: string | null;
  recolhido: boolean;
  aoNavegar?: () => void;
  acaoDaMarca?: React.ReactNode;
}) {
  return (
    <>
      <MarcaDoRail
        nomeDoProduto={MARCA_PADRAO.nomeDoProduto}
        acao={acaoDaMarca}
      />
      <nav
        aria-label={TEXTOS_DA_AREA_DA_EQUIPE.navegacao}
        className="grid cz-scroll min-h-0 flex-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-1 rail-aberto:px-3"
      >
        <div
          role="group"
          aria-label={TEXTOS_DA_AREA_DA_EQUIPE.equipeConduzza}
          className="grid gap-0.5"
        >
          <p
            aria-hidden
            className="hidden px-2 pt-4 pb-1.5 cz-eyebrow text-sidebar-muted rail-aberto:block"
          >
            {TEXTOS_DA_AREA_DA_EQUIPE.equipeConduzza}
          </p>
          {ITENS_DA_AREA_DA_EQUIPE.map((item) => (
            <ItemDoMenu
              key={item.href}
              item={item}
              rotulo={item.label}
              ativo={item.href === itemAtivo}
              contagem={null}
              recolhido={recolhido}
              aoNavegar={aoNavegar}
            />
          ))}
        </div>
        {conta.abrirClinica ? (
          <div
            role="group"
            aria-label={TEXTOS_DA_AREA_DA_EQUIPE.clinica}
            className="grid gap-0.5"
          >
            <p
              aria-hidden
              className="hidden px-2 pt-4 pb-1.5 cz-eyebrow text-sidebar-muted rail-aberto:block"
            >
              {TEXTOS_DA_AREA_DA_EQUIPE.clinica}
            </p>
            <span
              aria-hidden
              className="mx-auto my-2.5 h-px w-6 bg-sidebar-border rail-aberto:hidden"
            />
            <ItemDoMenu
              item={ABRIR_A_CLINICA}
              rotulo={ABRIR_A_CLINICA.label}
              ativo={false}
              contagem={null}
              recolhido={recolhido}
              aoNavegar={aoNavegar}
            />
          </div>
        ) : null}
      </nav>
      <RodapeDaEquipe
        email={conta.email}
        nome={conta.nome}
        recolhido={recolhido}
      />
    </>
  );
}

/** Gaveta abaixo de 1024px: o mesmo menu, sempre aberto. */
function GavetaDaEquipe({
  conta,
  itemAtivo,
}: {
  conta: Conta;
  itemAtivo: string | null;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 lg:hidden"
          aria-label={TEXTOS_DA_AREA_DA_EQUIPE.abrirMenu}
        >
          <Menu aria-hidden className="size-[18px]" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        data-rail="expanded"
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex w-sidebar max-w-[85vw] flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0 data-[side=left]:w-sidebar data-[side=left]:max-w-[85vw] data-[side=left]:sm:max-w-[85vw]"
      >
        <SheetTitle className="sr-only">
          {TEXTOS_DA_AREA_DA_EQUIPE.menu}
        </SheetTitle>
        <MenuDaEquipe
          conta={conta}
          itemAtivo={itemAtivo}
          recolhido={false}
          aoNavegar={() => setAberta(false)}
          acaoDaMarca={
            <SheetClose asChild>
              <button
                type="button"
                aria-label={TEXTOS_DA_AREA_DA_EQUIPE.fecharMenu}
                className="grid size-10 place-items-center rounded-md text-sidebar-foreground cz-transition hover:bg-sidebar-accent hover:text-sidebar-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
              >
                <X aria-hidden className="size-[18px]" />
              </button>
            </SheetClose>
          }
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * A barra superior da area (60px): o gatilho do menu, "Equipe Conduzza" como
 * rotulo pequeno e o titulo da rota (um <p>: cada tela tem o seu h1), o tema
 * e o menu da conta.
 */
function BarraDaEquipe({
  conta,
  titulo,
  gaveta,
  railAberto,
  aoAlternarRail,
}: {
  conta: Conta;
  titulo: string | null;
  gaveta: React.ReactNode;
  railAberto: boolean;
  aoAlternarRail: () => void;
}) {
  const AbrirAClinica = ABRIR_A_CLINICA.icon;
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6 print:hidden">
      {gaveta}
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-10 text-text-secondary lg:inline-flex"
        aria-label={
          railAberto
            ? TEXTOS_DA_AREA_DA_EQUIPE.recolherMenu
            : TEXTOS_DA_AREA_DA_EQUIPE.expandirMenu
        }
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
          {TEXTOS_DA_AREA_DA_EQUIPE.equipeConduzza}
        </p>
        {titulo ? (
          <p className="truncate text-[17px] leading-[1.25] font-bold tracking-[-0.015em] text-text-strong md:text-[19px]">
            {titulo}
          </p>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="size-10 rounded-full p-0"
              aria-label={TEXTOS_DA_AREA_DA_EQUIPE.menuDoUsuario}
            >
              <ContactAvatar name={conta.nome} phone="" size={30} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="grid gap-0.5">
              <span className="truncate">{conta.email}</span>
              <span className="truncate text-xs font-normal text-text-secondary">
                {TEXTOS_DA_AREA_DA_EQUIPE.equipeConduzza}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {conta.abrirClinica ? (
              <DropdownMenuItem asChild>
                <Link href={ABRIR_A_CLINICA.href}>
                  <AbrirAClinica aria-hidden />
                  {TEXTOS_DA_AREA_DA_EQUIPE.abrirAClinica}
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
                {TEXTOS_DA_AREA_DA_EQUIPE.sair}
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function ShellDaEquipe({
  email,
  nome,
  abrirClinica,
  preferenciaDoRail = "auto",
  children,
}: Conta & {
  /** Preferencia gravada no cookie cz_rail (lida no layout). */
  preferenciaDoRail?: PreferenciaDoRail;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const { preferencia, aberto, alternarRail } = useRail(preferenciaDoRail);
  const rota = itemAtivoDaRota(pathname);
  const conta: Conta = { email, nome, abrirClinica };

  // So o <main> rola: a cada tela nova ele volta ao topo.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

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
          <MenuDaEquipe
            conta={conta}
            itemAtivo={rota?.href ?? null}
            recolhido={!aberto}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <BarraDaEquipe
            conta={conta}
            titulo={rota?.label ?? null}
            gaveta={
              <GavetaDaEquipe conta={conta} itemAtivo={rota?.href ?? null} />
            }
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
