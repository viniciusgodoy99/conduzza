import {
  AlarmClock,
  Armchair,
  BadgePlus,
  Calendar,
  CalendarPlus,
  CheckCheck,
  CircleCheck,
  CircleX,
  Clock,
  Gauge,
  Hand,
  MessageCircleCheck,
  MessageSquareText,
  MoonStar,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Timer,
  TriangleAlert,
  UserCheck,
  UserRoundX,
  Watch,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { BuildingSlash } from "@/components/shared/icons/building-slash";

// Fonte unica dos status do produto.
// Regra das 3 camadas: todo estado e comunicado por forma do icone, rotulo em
// texto e cor, simultaneamente. Nunca o mesmo icone em cores diferentes.
// Semantica de cor do handoff Conduzza: violeta e RESERVADO para IA; azul e
// informativo; verde confirmado/sucesso; ambar aguardando/atencao; vermelho
// falta/erro; neutro para concluido.

export type StatusTone =
  "ai" | "info" | "success" | "warning" | "alert" | "neutral";

export type StatusIcon =
  | LucideIcon
  | ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number | string }>;

export type StatusDefinition = {
  label: string;
  tone: StatusTone;
  /** null quando a camada de forma e um avatar (conversa em atendimento) */
  icon: StatusIcon | null;
};

// Os 10 status de agendamento, strings identicas aos checks de docs/04.
export type AppointmentStatus =
  | "agendado"
  | "aguardando_confirmacao"
  | "confirmado_paciente"
  | "confirmado_recepcao"
  | "na_recepcao"
  | "em_atendimento"
  | "compareceu"
  | "cancelado_paciente"
  | "cancelado_clinica"
  | "faltou";

export const APPOINTMENT_STATUS: Record<AppointmentStatus, StatusDefinition> = {
  // Brief 3.5: Agendado e NEUTRO ("agendado, sem status") e Compareceu e
  // SUCESSO. Excecao consciente: na_recepcao e em_atendimento ficam em
  // warning/info em vez da "Primaria" do brief, porque a primaria e variavel
  // por clinica (white-label) e o handoff (que vence em aparencia) usa
  // ambar/azul nesses dois.
  agendado: { label: "Agendado", tone: "neutral", icon: Calendar },
  aguardando_confirmacao: {
    label: "Aguardando",
    tone: "warning",
    icon: Clock,
  },
  confirmado_paciente: {
    label: "Confirmado por WhatsApp",
    tone: "success",
    icon: MessageCircleCheck,
  },
  confirmado_recepcao: {
    label: "Confirmado pela recepção",
    tone: "success",
    icon: UserCheck,
  },
  na_recepcao: { label: "Na recepção", tone: "warning", icon: Armchair },
  em_atendimento: {
    label: "Em atendimento",
    tone: "info",
    icon: Stethoscope,
  },
  compareceu: { label: "Compareceu", tone: "success", icon: CheckCheck },
  cancelado_paciente: {
    label: "Cancelado pelo paciente",
    tone: "alert",
    icon: CircleX,
  },
  cancelado_clinica: {
    label: "Cancelado pela clínica",
    tone: "alert",
    icon: BuildingSlash,
  },
  faltou: { label: "Faltou", tone: "alert", icon: TriangleAlert },
};

// Os 4 status de conversa, strings identicas aos checks de docs/04.
export type ConversationStatus =
  "ia_atendendo" | "aguardando_humano" | "em_atendimento" | "resolvida";

export const CONVERSATION_STATUS: Record<ConversationStatus, StatusDefinition> =
  {
    ia_atendendo: { label: "IA atendendo", tone: "ai", icon: Sparkles },
    aguardando_humano: {
      label: "Aguardando você",
      tone: "warning",
      icon: Hand,
    },
    // A camada de forma deste status e o avatar do atendente, com o nome como
    // rotulo. O StatusChip aceita avatar no lugar do icone.
    em_atendimento: { label: "Em atendimento", tone: "info", icon: null },
    resolvida: { label: "Resolvida", tone: "success", icon: CircleCheck },
  };

// As 6 etapas do funil de leads, strings identicas ao check de contact.
// Compareceu usa o MESMO icone e o MESMO tom do status de agendamento de
// proposito: mesma semantica, mesma forma (a proibicao e mesmo icone em
// cores DIFERENTES).
export type FunnelStage =
  | "novo"
  | "em_contato"
  | "aguardando_resposta"
  | "agendou"
  | "compareceu"
  | "perdido";

export const FUNNEL_STAGE: Record<FunnelStage, StatusDefinition> = {
  novo: { label: "Novo", tone: "neutral", icon: BadgePlus },
  em_contato: { label: "Em contato", tone: "info", icon: MessageSquareText },
  aguardando_resposta: {
    label: "Aguardando resposta",
    tone: "warning",
    icon: Timer,
  },
  agendou: { label: "Agendou", tone: "success", icon: CalendarPlus },
  compareceu: { label: "Compareceu", tone: "success", icon: CheckCheck },
  perdido: { label: "Perdido", tone: "alert", icon: UserRoundX },
};

// Badge de tempo desde o ultimo contato (cartao de lead, brief Tela 4):
// verde ate 4h, ambar de 4h a 24h, vermelho acima de 24h. O rotulo exibido
// no chip e o relativo ("ha 2 h"); a definicao da tom e icone.
export type ContactRecency = "em_dia" | "esfriando" | "frio";

export const CONTACT_RECENCY: Record<ContactRecency, StatusDefinition> = {
  em_dia: { label: "Contato recente", tone: "success", icon: Gauge },
  esfriando: { label: "Esfriando", tone: "warning", icon: Watch },
  frio: { label: "Sem contato", tone: "alert", icon: AlarmClock },
};

// Etiquetas DERIVADAS do paciente (ficha e lista da Tela 9). Nada disto e
// persistido: risco vem de no_show_count >= 2 e inativo da ausencia de
// consulta recente (lib/domain/etiquetas.ts).
export type PatientTag = "risco_de_falta" | "inativo";

export const PATIENT_TAG: Record<PatientTag, StatusDefinition> = {
  risco_de_falta: {
    label: "Risco de falta",
    tone: "alert",
    icon: ShieldAlert,
  },
  inativo: { label: "Inativo", tone: "neutral", icon: MoonStar },
};

// marker: cor plena (pontos, bordas de evento). text/bg: par do chip, com
// contraste AA garantido pelo teste de design.
export const STATUS_TONE_VARS: Record<
  StatusTone,
  { marker: string; text: string; bg: string }
> = {
  ai: { marker: "var(--ai)", text: "var(--ai-text)", bg: "var(--ai-bg)" },
  info: {
    marker: "var(--info)",
    text: "var(--info-text)",
    bg: "var(--info-bg)",
  },
  success: {
    marker: "var(--success)",
    text: "var(--success-text)",
    bg: "var(--success-bg)",
  },
  warning: {
    marker: "var(--warning)",
    text: "var(--warning-text)",
    bg: "var(--warning-bg)",
  },
  alert: {
    marker: "var(--alert)",
    text: "var(--alert-text)",
    bg: "var(--alert-bg)",
  },
  neutral: {
    marker: "var(--neutral)",
    text: "var(--neutral-text)",
    bg: "var(--neutral-bg)",
  },
};
