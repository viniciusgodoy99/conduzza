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
};
