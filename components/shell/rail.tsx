"use client";

import { LogOut, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { signOutAction } from "@/app/(auth)/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { NavBadge } from "@/components/shell/nav-badge";
import type { ContadoresDoMenu, ViewerDoShell } from "@/components/shell/tipos";
import { Button } from "@/components/ui/button";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Translate } from "@/lib/branding/labels";
import { MARCA_PADRAO } from "@/lib/branding/marca-padrao";
import {
  NAV_GROUPS,
  NAV_GROUP_ORDER,
  type NavGroup,
  type NavItem,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

// Menu lateral do Conduzza Design System (docs/06 secao 5.1): fundo ink-900
// nos dois temas, item ativo com fundo lime translucido, texto lime e barra
// de 2px. De 1024 a 1599px ele fica recolhido em 64px (so icones, com o
// rotulo como dica ao lado e ainda no nome acessivel do link); a partir de
// 1600px, aberto em 248px; abaixo de 1024px vira gaveta. Quem decide a
// largura e o CSS, pela variante rail-aberto (data-rail na raiz do shell).

type Contagem = keyof ContadoresDoMenu;

// O que cada contador conta, para o leitor de tela (singular e plural).
const DESCRICAO_DO_CONTADOR: Record<Contagem, [string, string]> = {
  conversas: ["conversa aguardando resposta", "conversas aguardando resposta"],
  confirmacoes: [
    "confirmação pendente para amanhã",
    "confirmações pendentes para amanhã",
  ],
};

export type PropsDoRail = {
  viewer: ViewerDoShell;
  itens: NavItem[];
  /** href do item da rota atual (maior prefixo), ou null */
  itemAtivo: string | null;
  contadores: ContadoresDoMenu;
  t: Translate;
};

function rotuloDoItem(item: NavItem, t: Translate): string {
  return item.labelKey
    ? t(item.labelKey, { plural: true, capitalize: true })
    : item.label;
}

function MarcaDoRail({
  nomeDoProduto,
  acao,
}: {
  nomeDoProduto: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex h-topbar shrink-0 items-center justify-center gap-2 rail-aberto:justify-start rail-aberto:px-[18px]">
      <Image
        src={MARCA_PADRAO.lockupFundoEscuro}
        alt={nomeDoProduto}
        width={146}
        height={24}
        priority
        className="hidden h-6 w-auto rail-aberto:block"
      />
      <Image
        src={MARCA_PADRAO.simboloFundoEscuro}
        alt={nomeDoProduto}
        width={28}
        height={28}
        priority
        className="size-7 rail-aberto:hidden"
      />
      {acao ? <div className="-mr-2.5 ml-auto">{acao}</div> : null}
    </div>
  );
}

function ItemDoMenu({
  item,
  rotulo,
  ativo,
  contagem,
  recolhido,
  aoNavegar,
}: {
  item: NavItem;
  rotulo: string;
  ativo: boolean;
  contagem: number | null;
  recolhido: boolean;
  aoNavegar?: () => void;
}) {
  const Icone = item.icon;
  const descricoes = item.badge ? DESCRICAO_DO_CONTADOR[item.badge] : null;
  const link = (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      onClick={aoNavegar}
      className={cn(
        "relative flex h-10 items-center justify-center gap-[11px] rounded-md text-[13.5px] font-medium cz-transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring rail-aberto:justify-start rail-aberto:px-2.5",
        ativo
          ? "bg-(--sidebar-active-bg) font-semibold text-(--sidebar-active-text)"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      {ativo ? (
        <span
          aria-hidden
          className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-(--sidebar-active-bar)"
        />
      ) : null}
      <Icone aria-hidden className="size-[17px] shrink-0" />
      {/* Recolhido, o rotulo fica so para o leitor de tela (nome do link). */}
      <span className="sr-only rail-aberto:not-sr-only rail-aberto:min-w-0 rail-aberto:flex-1">
        <span className="block truncate">{rotulo}</span>
      </span>
      {descricoes ? (
        <NavBadge
          count={contagem}
          ativo={ativo}
          descricao={contagem === 1 ? descricoes[0] : descricoes[1]}
        />
      ) : null}
    </Link>
  );

  if (!recolhido) {
    return link;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {rotulo}
      </TooltipContent>
    </Tooltip>
  );
}

function RodapeDoRail({ viewer }: { viewer: ViewerDoShell }) {
  return (
    <div className="shrink-0 border-t border-sidebar-border p-2 rail-aberto:p-3">
      <div className="flex items-center justify-center gap-[9px] rail-aberto:justify-start">
        <ContactAvatar name={viewer.name} phone="" size={30} />
        <div className="hidden min-w-0 flex-1 rail-aberto:grid">
          <span className="truncate text-[12.5px] font-semibold text-sidebar-strong">
            {viewer.name}
          </span>
          <span className="truncate text-[11px] text-sidebar-muted">
            {viewer.roleLabel}
          </span>
        </div>
        <form action={signOutAction} className="hidden rail-aberto:block">
          <button
            type="submit"
            aria-label="Sair"
            className="grid size-10 place-items-center rounded-md text-sidebar-muted cz-transition hover:bg-sidebar-accent hover:text-sidebar-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring"
          >
            <LogOut aria-hidden className="size-[17px]" />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Conteudo do menu (marca, navegacao e rodape). Serve ao menu fixo e a
 * gaveta: a largura e os rotulos seguem o data-rail do ancestral.
 */
export function Rail({
  viewer,
  itens,
  itemAtivo,
  contadores,
  t,
  recolhido,
  aoNavegar,
  acaoDaMarca,
}: PropsDoRail & {
  /** Menu em icones: o rotulo aparece como dica ao lado. */
  recolhido: boolean;
  /** Na gaveta, fecha ao escolher um item. */
  aoNavegar?: () => void;
  /** Acao ao lado da marca (o "Fechar menu" da gaveta). */
  acaoDaMarca?: React.ReactNode;
}) {
  // Bloco sem nenhum item visivel para o papel nao aparece (nem o titulo).
  const blocos = NAV_GROUP_ORDER.map((grupo: NavGroup) => ({
    grupo,
    titulo: NAV_GROUPS[grupo],
    itens: itens.filter((item) => item.group === grupo),
  })).filter((bloco) => bloco.itens.length > 0);

  return (
    <>
      <MarcaDoRail nomeDoProduto={viewer.productName} acao={acaoDaMarca} />
      <nav
        aria-label="Navegação principal"
        className="grid cz-scroll min-h-0 flex-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-1 rail-aberto:px-3"
      >
        {blocos.map((bloco, indice) => (
          <div
            key={bloco.grupo}
            role={bloco.titulo ? "group" : undefined}
            aria-label={bloco.titulo ?? undefined}
            className="grid gap-0.5"
          >
            {bloco.titulo ? (
              <p
                aria-hidden
                className="hidden px-2 pt-4 pb-1.5 cz-eyebrow text-sidebar-muted rail-aberto:block"
              >
                {bloco.titulo}
              </p>
            ) : null}
            {indice > 0 ? (
              <span
                aria-hidden
                className="mx-auto my-2.5 h-px w-6 bg-sidebar-border rail-aberto:hidden"
              />
            ) : null}
            {bloco.itens.map((item) => (
              <ItemDoMenu
                key={item.href}
                item={item}
                rotulo={rotuloDoItem(item, t)}
                ativo={item.href === itemAtivo}
                contagem={item.badge ? contadores[item.badge] : null}
                recolhido={recolhido}
                aoNavegar={aoNavegar}
              />
            ))}
          </div>
        ))}
      </nav>
      <RodapeDoRail viewer={viewer} />
    </>
  );
}

/**
 * Gaveta abaixo de 1024px: o mesmo menu, sempre aberto (data-rail
 * "expanded"), com o gatilho "Abrir menu" que fica na barra superior.
 */
export function GavetaDoRail(props: PropsDoRail) {
  const [aberta, setAberta] = useState(false);
  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 lg:hidden"
          aria-label="Abrir menu"
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
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <Rail
          {...props}
          recolhido={false}
          aoNavegar={() => setAberta(false)}
          acaoDaMarca={
            <SheetClose asChild>
              <button
                type="button"
                aria-label="Fechar menu"
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
