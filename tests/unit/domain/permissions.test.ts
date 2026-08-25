import { describe, expect, it } from "vitest";

import {
  ACCESS_LABELS,
  MODULE_KEYS,
  MODULE_LABELS,
  PERMISSION_MATRIX,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_OPTIONS,
  ROLES,
  can,
  canEdit,
  canView,
  permissionHint,
  visibleModules,
  type Access,
  type ModuleKey,
  type Role,
} from "@/lib/domain/permissions";

// Os 45 pares papel x modulo da tabela da secao 5 do brief, um a um.
// Se a matriz no codigo divergir do brief, este teste aponta a celula exata.
//
// UMA celula diverge do brief de proposito: configuracoes/gestor era "ver" e
// virou "tudo" por decisao do dono em 25/08/2026, quando o gestor passou a
// gerenciar a equipe, os papeis e a conexao do WhatsApp. As policies de
// clinic_member no banco acompanham (20260825160000_equipe_e_papeis.sql).
// Qualquer OUTRA divergencia que este arquivo apontar e regressao.
const BRIEF_MATRIX: [ModuleKey, Record<Role, Access>][] = [
  [
    "atendimento",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "tudo",
      profissional: "proprio",
      leitura: "ver",
    },
  ],
  [
    "agenda",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "tudo",
      profissional: "proprio",
      leitura: "ver",
    },
  ],
  [
    "leads_pacientes",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "tudo",
      profissional: "ver",
      leitura: "ver",
    },
  ],
  [
    "confirmacoes_espera",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "tudo",
      profissional: "ver",
      leitura: "ver",
    },
  ],
  [
    "relatorios",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "ver",
      profissional: "proprio",
      leitura: "ver",
    },
  ],
  [
    "agente",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "ver",
      profissional: "nada",
      leitura: "nada",
    },
  ],
  [
    "automacoes",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "ver",
      profissional: "nada",
      leitura: "nada",
    },
  ],
  [
    "cadastros",
    {
      admin: "tudo",
      gestor: "tudo",
      recepcao: "ver",
      profissional: "ver",
      leitura: "ver",
    },
  ],
  [
    "configuracoes",
    {
      admin: "tudo",
      // Divergencia consciente do brief (decisao de 25/08/2026).
      gestor: "tudo",
      recepcao: "nada",
      profissional: "nada",
      leitura: "nada",
    },
  ],
];

describe("matriz de permissão (brief seção 5)", () => {
  it("cobre os 9 módulos e os 5 papéis", () => {
    expect(MODULE_KEYS).toHaveLength(9);
    expect(ROLES).toHaveLength(5);
    expect(BRIEF_MATRIX).toHaveLength(9);
  });

  describe.each(BRIEF_MATRIX)("módulo %s", (module, expected) => {
    it.each(ROLES.map((role) => [role] as const))(
      "papel %s tem o acesso do brief",
      (role) => {
        expect(can(role, module)).toBe(expected[role]);
      },
    );
  });
});

describe("visibleModules", () => {
  it("admin e gestor veem os 9 módulos", () => {
    expect(visibleModules("admin")).toHaveLength(9);
    expect(visibleModules("gestor")).toHaveLength(9);
  });

  it("recepção não vê Configurações", () => {
    const visible = visibleModules("recepcao");
    expect(visible).not.toContain("configuracoes");
    expect(visible).toHaveLength(8);
  });

  it("profissional e leitura não veem Agente, Automações nem Configurações", () => {
    for (const role of ["profissional", "leitura"] as const) {
      const visible = visibleModules(role);
      expect(visible).not.toContain("agente");
      expect(visible).not.toContain("automacoes");
      expect(visible).not.toContain("configuracoes");
      expect(visible).toHaveLength(6);
    }
  });
});

describe("canView, canEdit e permissionHint", () => {
  it("acesso proprio conta como edição (do que é do próprio usuário)", () => {
    expect(canEdit("profissional", "atendimento")).toBe(true);
    expect(canView("profissional", "atendimento")).toBe(true);
  });

  it("acesso ver não conta como edição e tem dica", () => {
    expect(canEdit("recepcao", "cadastros")).toBe(false);
    expect(permissionHint("recepcao", "cadastros")).toBe(
      "Somente administradores e gestores alteram os cadastros",
    );
  });

  it("gestor edita as configurações (decisão de 25/08/2026)", () => {
    expect(canEdit("gestor", "configuracoes")).toBe(true);
    expect(permissionHint("gestor", "configuracoes")).toBeNull();
  });

  it("quem não pode alterar as configurações recebe a dica dos dois papéis", () => {
    expect(permissionHint("recepcao", "configuracoes")).toBe(
      "Somente administradores e gestores alteram as configurações",
    );
  });

  it("quem pode editar não recebe dica", () => {
    expect(permissionHint("admin", "configuracoes")).toBeNull();
  });

  it("nenhuma dica contém travessão", () => {
    for (const moduleKey of MODULE_KEYS) {
      for (const role of ROLES) {
        const hint = permissionHint(role, moduleKey);
        if (hint) {
          expect(hint).not.toContain("—");
        }
      }
    }
  });

  it("a matriz exportada é idêntica à tabela do brief", () => {
    expect(PERMISSION_MATRIX).toEqual(Object.fromEntries(BRIEF_MATRIX));
  });
});

describe("vocabulário da matriz", () => {
  it("MODULE_LABELS nomeia os 9 módulos, sem rótulo vazio", () => {
    expect(Object.keys(MODULE_LABELS)).toHaveLength(9);
    for (const moduleKey of MODULE_KEYS) {
      expect(MODULE_LABELS[moduleKey].trim().length).toBeGreaterThan(0);
    }
  });

  it("ROLE_DESCRIPTIONS descreve os 5 papéis", () => {
    expect(Object.keys(ROLE_DESCRIPTIONS)).toHaveLength(5);
    for (const role of ROLES) {
      expect(ROLE_DESCRIPTIONS[role].trim().length).toBeGreaterThan(0);
    }
  });

  it("ACCESS_LABELS cobre os 4 níveis de acesso", () => {
    const niveis: Access[] = ["tudo", "ver", "proprio", "nada"];
    expect(Object.keys(ACCESS_LABELS)).toHaveLength(4);
    for (const nivel of niveis) {
      expect(ACCESS_LABELS[nivel].trim().length).toBeGreaterThan(0);
    }
  });

  it("ROLE_OPTIONS tem as 5 opções na ordem de ROLES", () => {
    expect(ROLE_OPTIONS).toHaveLength(5);
    expect(ROLE_OPTIONS.map((option) => option.value)).toEqual([...ROLES]);
    for (const option of ROLE_OPTIONS) {
      expect(option.label).toBe(ROLE_LABELS[option.value]);
    }
  });

  it("nenhum texto de interface contém travessão", () => {
    const textos = [
      ...Object.values(MODULE_LABELS),
      ...Object.values(ROLE_DESCRIPTIONS),
      ...Object.values(ACCESS_LABELS),
      ...Object.values(ROLE_LABELS),
      ...ROLE_OPTIONS.map((option) => option.label),
    ];
    for (const texto of textos) {
      expect(texto).not.toContain("—");
    }
  });
});
