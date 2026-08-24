import type { Catalogo, Profissional } from "@/lib/queries/catalogo";
import type { AgendaDia, ConsultaDaAgenda } from "@/lib/queries/agenda";

// Contratos de props compartilhados pelas pecas da Agenda (Tela 3).

export type FiltrosAgenda = {
  unidadeId: string | null;
  especialidade: string | null;
  convenioId: string | null; // "particular" e o valor especial para null
  procedimentoId: string | null;
  profissionalId: string | null;
};

export const FILTROS_VAZIOS: FiltrosAgenda = {
  unidadeId: null,
  especialidade: null,
  convenioId: null,
  procedimentoId: null,
  profissionalId: null,
};

export type VisaoAgenda = "dia" | "semana";

/** O que o modal precisa para nascer pre-preenchido (clique no vao). */
export type PrePreenchido = {
  professionalId?: string;
  inicio?: Date;
  contactId?: string;
};

export type AberturaDeModal = {
  aberto: boolean;
  prePreenchido: PrePreenchido;
};

export type ContextoAgenda = {
  clinicId: string;
  timezone: string;
  catalogo: Catalogo;
  podeEditar: boolean;
  dica: string;
  viewerId: string;
};

export type SelecaoDeConsulta = {
  consulta: ConsultaDaAgenda;
  /** ancora do menu (bloco clicado) */
  x: number;
  y: number;
};

export type DadosDoDia = AgendaDia;

/** Profissional visivel apos os filtros, com a coluna que ele ocupa. */
export type ColunaDeProfissional = {
  profissional: Profissional;
  /** "8 de 12 horários" do cabecalho */
  contadorLivres: string;
};
