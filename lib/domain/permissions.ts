// Matriz de permissao por papel e modulo (brief de telas, docs/02 secao 5).
// Modulo puro, sem I/O: alimenta o rail, os guards de layout, as Server
// Actions e as dicas de acao desabilitada.
//
// Regra visual do brief: acao sem permissao fica visivel e desabilitada, com
// dica explicando por que. Modulo inteiro sem permissao some do rail.
//
// RLS garante o isolamento entre clinicas no banco. Esta matriz e a segunda
// camada, de papel, aplicada na interface e nas Server Actions.

export type Role = "admin" | "gestor" | "recepcao" | "profissional" | "leitura";

export type ModuleKey =
  | "atendimento"
  | "agenda"
  | "leads_pacientes"
  | "confirmacoes_espera"
  | "relatorios"
  | "agente"
  | "automacoes"
  | "cadastros"
  | "configuracoes";

// tudo: ver e editar. ver: somente leitura. proprio: ver e editar apenas o
// que e do proprio usuario (aplicado nas fases com dados). nada: sem acesso,
// o modulo some do rail.
export type Access = "tudo" | "ver" | "proprio" | "nada";

export const ROLES: readonly Role[] = [
  "admin",
  "gestor",
  "recepcao",
  "profissional",
  "leitura",
] as const;

export const MODULE_KEYS: readonly ModuleKey[] = [
  "atendimento",
  "agenda",
  "leads_pacientes",
  "confirmacoes_espera",
  "relatorios",
  "agente",
  "automacoes",
  "cadastros",
  "configuracoes",
] as const;

// Copia fiel da tabela da secao 5 do brief. Nao ajustar sem atualizar o brief.
export const PERMISSION_MATRIX: Record<ModuleKey, Record<Role, Access>> = {
  atendimento: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "tudo",
    profissional: "proprio",
    leitura: "ver",
  },
  agenda: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "tudo",
    profissional: "proprio",
    leitura: "ver",
  },
  leads_pacientes: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "tudo",
    profissional: "ver",
    leitura: "ver",
  },
  confirmacoes_espera: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "tudo",
    profissional: "ver",
    leitura: "ver",
  },
  relatorios: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "ver",
    profissional: "proprio",
    leitura: "ver",
  },
  agente: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "ver",
    profissional: "nada",
    leitura: "nada",
  },
  automacoes: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "ver",
    profissional: "nada",
    leitura: "nada",
  },
  cadastros: {
    admin: "tudo",
    gestor: "tudo",
    recepcao: "ver",
    profissional: "ver",
    leitura: "ver",
  },
  configuracoes: {
    admin: "tudo",
    gestor: "ver",
    recepcao: "nada",
    profissional: "nada",
    leitura: "nada",
  },
};

export function can(role: Role, module: ModuleKey): Access {
  return PERMISSION_MATRIX[module][role];
}

export function canView(role: Role, module: ModuleKey): boolean {
  return can(role, module) !== "nada";
}

export function canEdit(role: Role, module: ModuleKey): boolean {
  const access = can(role, module);
  return access === "tudo" || access === "proprio";
}

// Modulos que aparecem no rail para o papel. Acesso "nada" some (regra do brief).
export function visibleModules(role: Role): ModuleKey[] {
  return MODULE_KEYS.filter((module) => canView(role, module));
}

const EDIT_HINTS: Record<ModuleKey, string> = {
  atendimento: "Seu perfil não pode editar o atendimento",
  agenda: "Seu perfil não pode alterar a agenda",
  leads_pacientes: "Seu perfil não pode editar leads e pacientes",
  confirmacoes_espera: "Seu perfil não pode alterar confirmações",
  relatorios: "Seu perfil não pode alterar relatórios",
  agente: "Somente administradores e gestores alteram o agente de IA",
  automacoes: "Somente administradores e gestores alteram as automações",
  cadastros: "Somente administradores e gestores alteram os cadastros",
  configuracoes: "Somente administradores alteram as configurações",
};

// Dica exibida no tooltip da acao desabilitada (regra do brief: visivel e
// desabilitada, nunca escondida). Retorna null quando o papel pode editar.
export function permissionHint(role: Role, module: ModuleKey): string | null {
  if (canEdit(role, module)) {
    return null;
  }
  return EDIT_HINTS[module];
}
