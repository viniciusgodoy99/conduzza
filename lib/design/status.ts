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
  agendado: { label: "Agendado", tone: "info", icon: Calendar },
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
  compareceu: { label: "Compareceu", tone: "neutral", icon: CheckCheck },
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
