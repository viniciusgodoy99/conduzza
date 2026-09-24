import {
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  FolderCog,
  Hourglass,
  House,
  MessagesSquare,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { LabelKey } from "@/lib/branding/labels";
import type { ModuleKey } from "@/lib/domain/permissions";

// Navegacao declarativa do menu lateral, nos 4 blocos do Conduzza Design
// System (docs/06 secao 5.1, conflito C20): um bloco sem titulo com o que a
// recepcao usa o dia inteiro, depois "Operação do dia", "Inteligência" e
// "Administração". Cada item aponta o modulo da matriz de permissao que o
// governa; moduleKey null significa visivel para todos (caso do Inicio, que
// nao esta na matriz da secao 5). Rotulo com labelKey passa pelo t() do
// white-label no menu.
//
// Icones: CalendarDays na Agenda porque Calendar e o icone do status
// Agendado, e Hourglass na Lista de espera sem cor semantica (tabela de
// icones reservados, secao 4.6).

export type NavGroup =
  "principal" | "operacao_do_dia" | "inteligencia" | "administracao";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  moduleKey: ModuleKey | null;
  /** Rotulo parametrizavel do white-label: quando presente, passa por t() */
  labelKey?: LabelKey;
  /** Chave do contador do menu (contagem real, ao vivo no cliente) */
  badge?: "conversas" | "confirmacoes";
};

/** Titulo de cada bloco; null = bloco sem titulo (o primeiro). */
export const NAV_GROUPS: Record<NavGroup, string | null> = {
  principal: null,
  operacao_do_dia: "Operação do dia",
  inteligencia: "Inteligência",
  administracao: "Administração",
};

/** Ordem dos blocos no menu. */
export const NAV_GROUP_ORDER: NavGroup[] = [
  "principal",
  "operacao_do_dia",
  "inteligencia",
  "administracao",
];

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/inicio",
    label: "Início",
    icon: House,
    group: "principal",
    moduleKey: null,
  },
  {
    href: "/atendimento",
    label: "Atendimento",
    icon: MessagesSquare,
    group: "principal",
    moduleKey: "atendimento",
    badge: "conversas",
  },
  {
    href: "/leads",
    label: "Leads",
    icon: UserPlus,
    group: "principal",
    moduleKey: "leads_pacientes",
  },
  {
    href: "/agenda",
    label: "Agenda",
    icon: CalendarDays,
    group: "principal",
    moduleKey: "agenda",
  },
  {
    href: "/pacientes",
    label: "Pacientes",
    icon: Users,
    group: "principal",
    moduleKey: "leads_pacientes",
    labelKey: "paciente",
  },
  {
    href: "/confirmacoes",
    label: "Confirmações",
    icon: CalendarCheck,
    group: "operacao_do_dia",
    moduleKey: "confirmacoes_espera",
    badge: "confirmacoes",
  },
  {
    href: "/espera",
    label: "Lista de espera",
    icon: Hourglass,
    group: "operacao_do_dia",
    moduleKey: "confirmacoes_espera",
  },
  {
    href: "/relatorios",
    label: "Resultados",
    icon: ChartColumn,
    group: "operacao_do_dia",
    moduleKey: "relatorios",
  },
  {
    href: "/agente",
    label: "Agente de IA",
    icon: Sparkles,
    group: "inteligencia",
    moduleKey: "agente",
  },
  {
    href: "/automacoes",
    label: "Automações",
    icon: Workflow,
    group: "inteligencia",
    moduleKey: "automacoes",
  },
  {
    href: "/cadastros",
    label: "Cadastros",
    icon: FolderCog,
    group: "administracao",
    moduleKey: "cadastros",
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    group: "administracao",
    moduleKey: "configuracoes",
  },
];

/**
 * Preferencia do menu lateral, guardada no cookie cz_rail (docs/06 secao
 * 5.1). "auto" segue a largura: recolhido em 64px de 1024 a 1599px e aberto
 * em 248px a partir de 1600px. "expanded" e "collapsed" sao a escolha da
 * pessoa pelo botao da barra superior. Vive aqui, e nao no hook, porque o
 * layout (servidor) le o cookie.
 */
export type PreferenciaDoRail = "auto" | "expanded" | "collapsed";

export const COOKIE_DO_RAIL = "cz_rail";

export function preferenciaDoRail(
  valor: string | undefined,
): PreferenciaDoRail {
  return valor === "expanded" || valor === "collapsed" ? valor : "auto";
}

/**
 * O item do menu que corresponde a rota: o de maior prefixo, para que
 * "/pacientes/123" marque Pacientes e nunca dois itens ao mesmo tempo.
 * null quando a rota nao pertence ao menu.
 */
export function itemDaRota(pathname: string): NavItem | null {
  let melhor: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    const casa = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (casa && (!melhor || item.href.length > melhor.href.length)) {
      melhor = item;
    }
  }
  return melhor;
}
