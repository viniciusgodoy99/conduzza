import {
  Calendar,
  CalendarCheck,
  ChartNoAxesColumn,
  ClipboardList,
  Hourglass,
  House,
  MessagesSquare,
  Settings,
  Sparkles,
  UserRoundPlus,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { LabelKey } from "@/lib/branding/labels";
import type { ModuleKey } from "@/lib/domain/permissions";

// Navegacao declarativa do rail, grupos do handoff Conduzza: Operacao e
// Inteligencia. Cada item aponta o modulo da matriz de permissao que o governa;
// moduleKey null significa visivel para todos (caso do Inicio, que nao esta
// na matriz da secao 5).
// TODO(0.7): rotulos que usam os 4 termos parametrizaveis passam por t().

export type NavGroup = "operacao" | "inteligencia";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  moduleKey: ModuleKey | null;
  /** Rotulo parametrizavel do white-label: quando presente, passa por t() */
  labelKey?: LabelKey;
  /** Chave do badge de contagem; a fonte de dados chega nas Fases 1 e 4 */
  badge?: "conversas" | "confirmacoes";
};

export const NAV_GROUPS: Record<NavGroup, string> = {
  operacao: "Operação",
  inteligencia: "Inteligência",
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/inicio",
    label: "Início",
    icon: House,
    group: "operacao",
    moduleKey: null,
  },
  {
    href: "/atendimento",
    label: "Atendimento",
    icon: MessagesSquare,
    group: "operacao",
    moduleKey: "atendimento",
    badge: "conversas",
  },
  {
    href: "/leads",
    label: "Leads",
    icon: UserRoundPlus,
    group: "operacao",
    moduleKey: "leads_pacientes",
  },
  {
    href: "/agenda",
    label: "Agenda",
    icon: Calendar,
    group: "operacao",
    moduleKey: "agenda",
  },
  {
    href: "/pacientes",
    label: "Pacientes",
    icon: Users,
    group: "operacao",
    moduleKey: "leads_pacientes",
    labelKey: "paciente",
  },
  {
    href: "/confirmacoes",
    label: "Confirmações",
    icon: CalendarCheck,
    group: "operacao",
    moduleKey: "confirmacoes_espera",
    badge: "confirmacoes",
  },
  {
    href: "/espera",
    label: "Lista de espera",
    icon: Hourglass,
    group: "operacao",
    moduleKey: "confirmacoes_espera",
  },
  {
    href: "/relatorios",
    label: "Resultados",
    icon: ChartNoAxesColumn,
    group: "inteligencia",
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
    icon: ClipboardList,
    group: "inteligencia",
    moduleKey: "cadastros",
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    group: "inteligencia",
    moduleKey: "configuracoes",
  },
];
