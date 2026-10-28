import type { Role } from "@/lib/domain/permissions";

// Tipos compartilhados pelas partes do shell (app-shell, rail e barra
// superior).

export type ViewerDoShell = {
  name: string;
  role: Role;
  roleLabel: string;
  clinicName: string;
  productName: string;
};

/** Contagens reais dos itens do menu com contador. */
export type ContadoresDoMenu = {
  conversas: number;
  confirmacoes: number;
  // [AG6 urgência] início
  /**
   * Conversas marcadas como urgentes agora: com alguma, o contador do
   * Atendimento fica em alerta. Nulo ou ausente: ainda nao contou, ou a
   * contagem falhou (o tom de sempre, nunca alerta inventado). O primeiro
   * numero vem do vigia do cliente (o layout nao conta).
   */
  urgentes?: number | null;
  // [AG6 urgência] fim
};
