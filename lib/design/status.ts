import {
  Armchair,
  Calendar,
  CheckCheck,
  CircleCheck,
  CircleX,
  Clock,
  Hand,
  MessageCircleCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { BuildingSlash } from "@/components/shared/icons/building-slash";

// Fonte unica dos status do produto (brief de telas, secao 3.5).
// Regra das 3 camadas: todo estado e comunicado por forma do icone, rotulo em
// texto e cor, simultaneamente. Nunca o mesmo icone em cores diferentes.

export type StatusTone =
  "primary" | "success" | "warning" | "alert" | "neutral" | "highlight";

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
  na_recepcao: { label: "Na recepção", tone: "primary", icon: Armchair },
  em_atendimento: {
    label: "Em atendimento",
    tone: "primary",
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
    ia_atendendo: { label: "IA", tone: "primary", icon: Sparkles },
    aguardando_humano: {
      label: "Aguardando você",
      tone: "warning",
      icon: Hand,
    },
    // A camada de forma deste status e o avatar do atendente, com o nome como
    // rotulo. O StatusChip aceita avatar no lugar do icone.
    em_atendimento: { label: "Em atendimento", tone: "neutral", icon: null },
    resolvida: { label: "Resolvida", tone: "success", icon: CircleCheck },
  };

// base: cor semantica plena, usada na tinta de fundo do chip.
// strong: variante para texto e icone sobre fundo tingido (no escuro, a propria base).
export const STATUS_TONE_VARS: Record<
  StatusTone,
  { base: string; strong: string }
> = {
  primary: { base: "var(--primary)", strong: "var(--primary-strong)" },
  success: { base: "var(--success)", strong: "var(--success-strong)" },
  warning: { base: "var(--warning)", strong: "var(--warning-strong)" },
  alert: { base: "var(--alert)", strong: "var(--alert-strong)" },
  neutral: { base: "var(--neutral)", strong: "var(--neutral-strong)" },
  highlight: { base: "var(--highlight)", strong: "var(--highlight-strong)" },
};
