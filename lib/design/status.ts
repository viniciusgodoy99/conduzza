import {
  AlarmClock,
  Armchair,
  BadgePlus,
  Bot,
  Calendar,
  CalendarPlus,
  CalendarSync,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleSlash,
  CircleX,
  Clock,
  ConciergeBell,
  Eye,
  Gauge,
  Hand,
  KeyRound,
  LoaderCircle,
  MessageCircleCheck,
  MessageSquareText,
  MoonStar,
  QrCode,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  Sparkles,
  Stethoscope,
  Timer,
  TriangleAlert,
  UserCheck,
  UserRound,
  UserRoundX,
  Watch,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { BuildingSlash } from "@/components/shared/icons/building-slash";
import { ACCESS_LABELS, type Access } from "@/lib/domain/permissions";

// Fonte unica dos status do produto.
// Regra das 3 camadas: todo estado e comunicado por forma do icone, rotulo em
// texto e cor, simultaneamente. Nunca o mesmo icone em cores diferentes.
// Semantica de cor do design system Conduzza: lime suave (tom ai) e
// reservado para IA; azul e informativo; verde confirmado/sucesso; ambar
// aguardando/atencao; vermelho falta/erro; neutro para concluido.

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
  /** Classe extra do icone, aplicada pelo StatusChip (ex.: o giro do "Conectando") */
  iconClassName?: string;
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
  // por clinica (white-label) e o design system Conduzza (que vence em
  // aparencia) usa ambar/azul nesses dois.
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
// ATENCAO (09/09/2026): as etapas do funil viraram CONFIGURAVEIS por clinica
// (funnel_stage_def, lib/domain/jornada.ts). Este dicionario descreve a
// JORNADA PADRAO SEMEADA, e sobrevive para: o teste que trava a semente, e a
// tela do mapa de conversao ate a fase 3 da jornada. Tela de leads e inbox ja
// leem a jornada do banco: nao acrescente consumidor novo aqui.
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

// Marcas da CONSULTA que nao sao status (a situacao continua a mesma). O
// pedido de remarcacao vem do paciente pelo WhatsApp (appointment.
// remarcacao_pedida_em) e pede acao da recepcao: ambar, com icone exclusivo
// (nenhum outro estado usa CalendarSync).
export type AppointmentFlag = "remarcacao_pedida";

export const APPOINTMENT_FLAG: Record<AppointmentFlag, StatusDefinition> = {
  remarcacao_pedida: {
    label: "Pediu para remarcar",
    tone: "warning",
    icon: CalendarSync,
  },
};

// Mapas de estado das telas de cadastro, automacao e configuracao
// (docs/06 secao 4.6, conflito C8 do anexo). Antes cada tela desenhava o
// proprio "Ativo" ou "Ligada" com um ponto colorido; o design system Conduzza
// usa o "dot", mas aqui status e sempre as 3 camadas pelo StatusChip. Cada
// mapa tem um icone e uma cor por chave, e os icones repetidos entre mapas
// carregam sempre o mesmo tom: CircleCheck e sempre success, CirclePause e
// CircleDashed sempre neutral. Quando a tela tem um rotulo proprio ("Regua
// ligada", "Recuperacao ligada", o nome do evento da Meta), ele entra pelo
// label do StatusChip; a forma e a cor continuam vindo daqui.

// Registro de cadastro (profissional, unidade, recurso, convenio, pacote).
export type RecordStatus = "ativo" | "inativo";

export const RECORD_STATUS: Record<RecordStatus, StatusDefinition> = {
  ativo: { label: "Ativo", tone: "success", icon: CircleCheck },
  inativo: { label: "Inativo", tone: "neutral", icon: CirclePause },
};

// Regua de mensagens automaticas (Confirmacoes e Automacoes). O rotulo da
// tela varia com a regua e entra pelo label do StatusChip.
export type ReguaStatus = "ligada" | "desligada";

export const REGUA_STATUS: Record<ReguaStatus, StatusDefinition> = {
  ligada: { label: "Ligada", tone: "success", icon: CircleCheck },
  desligada: { label: "Desligada", tone: "neutral", icon: CirclePause },
};

// Conexao do numero da clinica. Rotulos iguais aos do painel de conexao
// (components/whatsapp/connect-client.tsx): o e2e confere "Situacao atual:
// Desconectado".
export type WhatsAppConnectionStatus =
  "conectado" | "conectando" | "aguardando_qr" | "desconectado";

export const WHATSAPP_CONNECTION_STATUS: Record<
  WhatsAppConnectionStatus,
  StatusDefinition
> = {
  conectado: { label: "Conectado", tone: "success", icon: CircleCheck },
  conectando: {
    label: "Conectando",
    tone: "info",
    icon: LoaderCircle,
    iconClassName: "motion-safe:animate-spin",
  },
  aguardando_qr: {
    label: "Aguardando leitura do QR code",
    tone: "warning",
    icon: QrCode,
  },
  desconectado: { label: "Desconectado", tone: "alert", icon: WifiOff },
};

// Nivel de acesso da matriz de papeis (Configuracoes, aba equipe). O texto e
// o de ACCESS_LABELS, sem mudar.
export const ACCESS_LEVEL_STATUS: Record<Access, StatusDefinition> = {
  tudo: { label: ACCESS_LABELS.tudo, tone: "success", icon: CircleCheck },
  ver: { label: ACCESS_LABELS.ver, tone: "neutral", icon: Eye },
  proprio: { label: ACCESS_LABELS.proprio, tone: "warning", icon: UserRound },
  nada: { label: ACCESS_LABELS.nada, tone: "neutral", icon: CircleSlash },
};

// Se a IA pode agendar o procedimento sozinha (Cadastros, procedimentos).
export type IaAgendaStatus = "sim" | "nao";

export const IA_AGENDA_STATUS: Record<IaAgendaStatus, StatusDefinition> = {
  sim: { label: "IA agenda", tone: "success", icon: Bot },
  nao: { label: "Só recepção", tone: "neutral", icon: ConciergeBell },
};

// Conversao da etapa da jornada para a Meta (Configuracoes, jornada). Com o
// nome do evento, a tela passa o proprio rotulo pelo label do StatusChip.
export type ConversaoStatus = "ativa" | "pausada" | "sem";

export const CONVERSAO_STATUS: Record<ConversaoStatus, StatusDefinition> = {
  ativa: { label: "Conversão ativa", tone: "success", icon: Send },
  pausada: { label: "Conversão pausada", tone: "neutral", icon: CirclePause },
  sem: {
    label: "Sem evento de conversão",
    tone: "neutral",
    icon: CircleDashed,
  },
};

// Token de acesso da Meta (Configuracoes, anuncios).
export type TokenMetaStatus = "salvo" | "ausente";

export const TOKEN_META_STATUS: Record<TokenMetaStatus, StatusDefinition> = {
  salvo: { label: "Token salvo", tone: "success", icon: KeyRound },
  ausente: { label: "Sem token", tone: "neutral", icon: CircleDashed },
};

// Autorizacao do paciente para receber mensagens (ficha, painel do
// Atendimento). Revogado e definitivo ate o paciente autorizar de novo
// (CLAUDE.md 3.4), por isso alert.
export type ConsentStatus = "autorizado" | "revogado" | "sem_autorizacao";

export const CONSENT_STATUS: Record<ConsentStatus, StatusDefinition> = {
  autorizado: {
    label: "Autorizado a receber mensagens",
    tone: "success",
    icon: ShieldCheck,
  },
  revogado: {
    label: "Pediu para não receber mensagens",
    tone: "alert",
    icon: ShieldX,
  },
  sem_autorizacao: {
    label: "Sem autorização registrada",
    tone: "neutral",
    icon: ShieldOff,
  },
};

// Tabela de icones reservados (docs/06 secao 4.6, conflito C18). Um icone,
// um sentido, uma cor, em qualquer tela, dentro ou fora destes mapas:
// - TriangleAlert: SO o status Faltou (alert).
// - CircleAlert: atencao (warning).
// - OctagonAlert: erro ou falha (alert). Tambem "codigo nao encontrado".
// - Info: informacao (info).
// - CircleCheck: sucesso, ativo, feito (sempre success).
// - Clock: SO o status Aguardando (warning); "enviando" usa SendHorizonal.
// - CircleX: SO Cancelado pelo paciente.
// - ShieldAlert: SO Risco de falta; bloqueio de conformidade usa ShieldBan.
// - Calendar: SO o status Agendado; o menu da Agenda usa CalendarDays.
// - Hourglass: pendencia (warning) e o item Lista de espera do menu (sem cor
//   semantica).
// - WifiOff: WhatsApp desconectado (alert).
// Trocas decorrentes, cada uma no lote da sua tela: toque "pulado" MailWarning
// e "na fila" Mail; aviso de recurso do modal de agendamento e dialogo da
// regua CircleAlert; erro de Confirmacoes OctagonAlert; Recuperadas com tom
// fixo success; reoferta "recusou" ThumbsDown neutral e "Cancelar reoferta"
// com X; tempo medio da espera TimerReset; "Nao sairam" da regua
// SkipForward; Faltas dos Pacientes CalendarMinus2 e "Vale ate"
// CalendarRange; Proximas acoes do Inicio CalendarClock neutral, Hand
// warning e AlarmClock alert; passo pendente do checklist Hourglass warning;
// faixa do motor e error.tsx OctagonAlert; falha do formulario de codigo
// CircleAlert.

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
