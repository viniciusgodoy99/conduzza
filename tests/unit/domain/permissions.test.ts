import { describe, expect, it } from "vitest";

import {
  MODULE_KEYS,
  PERMISSION_MATRIX,
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
      gestor: "ver",
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
    expect(canEdit("gestor", "configuracoes")).toBe(false);
    expect(permissionHint("gestor", "configuracoes")).toBe(
      "Somente administradores alteram as configurações",
    );
  });

  it("quem pode editar não recebe dica", () => {
    expect(permissionHint("admin", "configuracoes")).toBeNull();
  });

  it("nenhuma dica contém travessão", () => {
    for (const moduleKey of MODULE_KEYS) {
      const hint = permissionHint("leitura", moduleKey);
      if (hint) {
        expect(hint).not.toContain("—");
      }
    }
  });

  it("a matriz exportada é idêntica à tabela do brief", () => {
    expect(PERMISSION_MATRIX).toEqual(Object.fromEntries(BRIEF_MATRIX));
  });
});
