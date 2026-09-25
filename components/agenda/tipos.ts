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
  /**
   * "Marcar nova consulta" a partir de uma falta (achado 78): o mesmo
   * procedimento pelo mesmo convenio (null e particular) e a data sugerida.
   */
  procedimentoId?: string;
  convenioId?: string | null;
  dia?: string;
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
  /**
   * Quem cadastra jornada e vinculo (admin e gestor). Os avisos de "sem
   * jornada" e "sem vinculo" levam a Cadastros; sem permissao, o atalho fica
   * visivel, desabilitado e com esta dica (achado 38). OBRIGATORIO: toda tela
   * que abre o modal (Agenda e Confirmacoes) passa a permissao certa do papel
   * (achados L13 e L21); o typecheck recusa quem esquecer.
   */
  podeEditarCadastros: boolean;
  dicaCadastros: string;
  /**
   * Quem registra autorizacao para receber mensagens (modulo de leads e
   * pacientes, canEdit(role, "leads_pacientes")). Nao e a permissao da
   * agenda: o profissional agenda, mas nao registra autorizacao.
   */
  podeRegistrarAutorizacao: boolean;
  dicaAutorizacao: string;
  /** Abre o modal de agendamento pre-preenchido (menu do bloco). */
  abrirAgendamento?: (pre: PrePreenchido) => void;
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
