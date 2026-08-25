// Matriz de permissao por papel e modulo (brief de telas, docs/02 secao 5).
// Modulo puro, sem I/O: alimenta o rail, os guards de layout, as Server
// Actions e as dicas de acao desabilitada.
//
// Regra visual do brief: acao sem permissao fica visivel e desabilitada, com
// dica explicando por que. Modulo inteiro sem permissao some do rail.
//
// RLS garante o isolamento entre clinicas no banco. Esta matriz e a segunda
// camada, de papel, aplicada na interface e nas Server Actions.
//
// Divergencia consciente do brief: a celula configuracoes/gestor era "ver" e
// virou "tudo" por decisao do dono em 25/08/2026 (gestor tambem gerencia a
// equipe, os papeis e a conexao do WhatsApp). As policies de clinic_member no
// banco acompanham a mudanca (migration 20260825160000_equipe_e_papeis.sql).

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

// Nome de cada papel na interface. Mora aqui, e nao em lib/auth, para nao
// arrastar "server-only" para componente de cliente; active-clinic.ts reexporta.
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  recepcao: "Recepção",
  profissional: "Profissional",
  leitura: "Somente leitura",
};

// Fonte unica das opcoes de papel: seletor de convite, seletor de papel da
// equipe, schema Zod das Server Actions e seed. Nao duplicar a lista.
export const ROLE_OPTIONS: readonly { value: Role; label: string }[] =
  ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }));

// Nome do modulo em linguagem de recepcionista. Nao e 1:1 com o rail: um
// modulo pode cobrir mais de um item de menu (leads_pacientes cobre Leads e
// Pacientes) e relatorios aparece como Resultados.
export const MODULE_LABELS: Record<ModuleKey, string> = {
  atendimento: "Atendimento",
  agenda: "Agenda",
  leads_pacientes: "Leads e pacientes",
  confirmacoes_espera: "Confirmações e lista de espera",
  relatorios: "Resultados",
  agente: "Agente de IA",
  automacoes: "Automações",
  cadastros: "Cadastros",
  configuracoes: "Configurações",
};

// Nivel de acesso sem jargao, para a tabela de papeis da tela de Configuracoes.
export const ACCESS_LABELS: Record<Access, string> = {
  tudo: "Vê e edita",
  ver: "Somente vê",
  proprio: "Só o que é dele",
  nada: "Sem acesso",
};

// Uma frase por papel, conferida celula a celula contra a matriz abaixo.
// Serve para quem escolhe o papel de um colega entender a consequencia.
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin:
    "Dono da clínica. Faz tudo, inclusive gerenciar a equipe e conectar o WhatsApp.",
  gestor:
    "Toca a operação inteira e também cuida da equipe e das configurações.",
  recepcao:
    "Atende, agenda e cuida de leads e pacientes. Vê o resto sem alterar.",
  profissional: "Atende e organiza a própria agenda, com os resultados dela.",
  leitura: "Acompanha os números e as telas de operação sem alterar nada.",
};

// Copia da tabela da secao 5 do brief, com a divergencia registrada no topo
// deste arquivo. Nao ajustar outra celula sem atualizar o brief.
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
    gestor: "tudo",
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
  configuracoes: "Somente administradores e gestores alteram as configurações",
};

// Dica exibida no tooltip da acao desabilitada (regra do brief: visivel e
// desabilitada, nunca escondida). Retorna null quando o papel pode editar.
export function permissionHint(role: Role, module: ModuleKey): string | null {
  if (canEdit(role, module)) {
    return null;
  }
  return EDIT_HINTS[module];
}
