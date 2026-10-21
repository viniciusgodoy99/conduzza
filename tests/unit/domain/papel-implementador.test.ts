import { describe, expect, it } from "vitest";

import {
  AVISO_DO_IMPLEMENTADOR,
  barrarMexidaEmAdmin,
  PAPEL_PROPRIO_NAO_CONFERIDO,
  papelSoDoAdminPleno,
  recusaDaEquipe,
  recusaDePapelDeAdmin,
  recusaSemConferirAMarca,
  rotuloDaOpcao,
  unicoAdminPlenoId,
} from "@/components/configuracoes/papel-na-equipe";
import {
  DESCRICAO_DO_PAPEL,
  ehAdminPleno,
  MODULE_KEYS,
  OPCOES_DE_PAPEL,
  PAPEIS_NA_TELA,
  papelDoBanco,
  papelNaTela,
  PERMISSION_MATRIX,
  ROLE_LABELS,
  ROLES,
  ROTULO_DO_PAPEL,
  type Role,
} from "@/lib/domain/permissions";

// Papel Implementador (onda 5, item 18; caminho (b-i) do dono): no banco, um
// vinculo 'admin' com a marca de membro_implementador. Role nao ganha valor
// novo, a matriz nao muda (ele usa a linha do administrador), e a marca so
// muda o rotulo e liga as travas de equipe que o dono escolheu (P18-2 a
// P18-4). Nenhum texto com travessao.

describe("papel na tela", () => {
  it("Role continua com os 5 papéis do banco; a tela ganha o Implementador", () => {
    expect([...ROLES]).toEqual([
      "admin",
      "gestor",
      "recepcao",
      "profissional",
      "leitura",
    ]);
    expect([...PAPEIS_NA_TELA]).toEqual([
      "admin",
      "implementador",
      "gestor",
      "recepcao",
      "profissional",
      "leitura",
    ]);
  });

  it("a marca só vale com o vínculo admin", () => {
    expect(papelNaTela("admin", true)).toBe("implementador");
    expect(papelNaTela("admin", false)).toBe("admin");
    for (const role of [
      "gestor",
      "recepcao",
      "profissional",
      "leitura",
    ] as Role[]) {
      expect(papelNaTela(role, true)).toBe(role);
    }
  });

  it("administrador pleno é o admin sem a marca", () => {
    expect(ehAdminPleno("admin", false)).toBe(true);
    expect(ehAdminPleno("admin", true)).toBe(false);
    expect(ehAdminPleno("gestor", false)).toBe(false);
  });

  it("o Implementador é admin no banco", () => {
    expect(papelDoBanco("implementador")).toBe("admin");
    expect(papelDoBanco("gestor")).toBe("gestor");
  });

  it("a matriz não muda: o Implementador usa a linha do administrador", () => {
    for (const modulo of MODULE_KEYS) {
      expect(Object.keys(PERMISSION_MATRIX[modulo]).sort()).toEqual(
        [...ROLES].sort(),
      );
      expect(PERMISSION_MATRIX[modulo][papelDoBanco("implementador")]).toBe(
        PERMISSION_MATRIX[modulo].admin,
      );
    }
  });
});

describe("rótulos, descrições e opções", () => {
  it("Implementador logo depois de Administrador, com os rótulos de sempre", () => {
    expect(OPCOES_DE_PAPEL.map((opcao) => opcao.label)).toEqual([
      "Administrador",
      "Implementador",
      "Gestor",
      "Recepção",
      "Profissional",
      "Somente leitura",
    ]);
    for (const role of ROLES) {
      expect(ROTULO_DO_PAPEL[role]).toBe(ROLE_LABELS[role]);
    }
  });

  it("a descrição diz o que ele faz e o que não faz", () => {
    expect(DESCRICAO_DO_PAPEL.implementador).toBe(
      "Assistente técnico que configura a clínica. Vê e faz tudo o que o administrador faz, menos mexer em administradores e exportar os leads.",
    );
  });

  it("nenhum travessão", () => {
    const textos = [
      ...Object.values(ROTULO_DO_PAPEL),
      ...Object.values(DESCRICAO_DO_PAPEL),
      AVISO_DO_IMPLEMENTADOR,
      PAPEL_PROPRIO_NAO_CONFERIDO,
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("travas da equipe (P18-2 a P18-4)", () => {
  it("só o administrador pleno dá o papel de administrador ou de Implementador", () => {
    expect(papelSoDoAdminPleno("admin")).toBe(true);
    expect(papelSoDoAdminPleno("implementador")).toBe(true);
    expect(papelSoDoAdminPleno("gestor")).toBe(false);
    expect(recusaDePapelDeAdmin(true, "implementador", "trocar")).toBeNull();
    expect(recusaDePapelDeAdmin(false, "gestor", "trocar")).toBeNull();
    expect(recusaDePapelDeAdmin(false, "implementador", "convidar")).toBe(
      "Somente um administrador da clínica convida um implementador.",
    );
    expect(recusaDePapelDeAdmin(false, "implementador", "liberar")).toBe(
      "Somente um administrador da clínica faz de alguém implementador.",
    );
    expect(recusaDePapelDeAdmin(false, "admin", "convidar")).toBe(
      "Somente um administrador convida outro administrador.",
    );
    expect(recusaDePapelDeAdmin(false, "admin", "trocar")).toBe(
      "Somente um administrador cria outro administrador.",
    );
  });

  it("sem a própria marca conferida, o vínculo admin não dá administrador nem Implementador", () => {
    // A leitura da marca falhou: a sessao trata o vinculo admin como pleno,
    // e um Implementador passaria. So recusa os papeis que so o pleno da.
    expect(recusaSemConferirAMarca(true, "admin", "implementador")).toBe(
      "Não foi possível conferir o seu papel. Tente de novo.",
    );
    expect(recusaSemConferirAMarca(true, "admin", "admin")).toBe(
      PAPEL_PROPRIO_NAO_CONFERIDO,
    );
    expect(recusaSemConferirAMarca(true, "admin", "recepcao")).toBeNull();
    expect(recusaSemConferirAMarca(true, "gestor", "admin")).toBeNull();
    expect(recusaSemConferirAMarca(false, "admin", "implementador")).toBeNull();
  });

  it("quem não é pleno não mexe em administrador nem em Implementador", () => {
    expect(barrarMexidaEmAdmin(true, "admin")).toBeNull();
    expect(barrarMexidaEmAdmin(true, "implementador")).toBeNull();
    expect(barrarMexidaEmAdmin(false, "admin")).toBe(
      "Somente um administrador altera o acesso de outro administrador.",
    );
    expect(barrarMexidaEmAdmin(false, "implementador")).toBe(
      "Somente um administrador altera o acesso de um implementador.",
    );
    expect(barrarMexidaEmAdmin(false, "recepcao")).toBeNull();
  });

  it("a opção travada mostra o porquê", () => {
    expect(rotuloDaOpcao("implementador", true, "trocar")).toBe(
      "Implementador (só um administrador escolhe)",
    );
    expect(rotuloDaOpcao("implementador", true, "convidar")).toBe(
      "Implementador (só um administrador escolhe)",
    );
    expect(rotuloDaOpcao("admin", true, "liberar")).toBe(
      "Administrador (só um administrador libera)",
    );
    expect(rotuloDaOpcao("admin", true, "convidar")).toBe(
      "Administrador (só um administrador convida)",
    );
    expect(rotuloDaOpcao("admin", true, "trocar")).toBe(
      "Administrador (só um administrador promove)",
    );
    expect(rotuloDaOpcao("gestor", false, "trocar")).toBe("Gestor");
  });

  it("o único administrador pleno: o Implementador não conta (P18-3)", () => {
    const membro = (
      userId: string,
      papel: Role,
      implementador = false,
      ativo = true,
    ) => ({ userId, papel, implementador, ativo });
    expect(
      unicoAdminPlenoId([
        membro("dona", "admin"),
        membro("tecnico", "admin", true),
        membro("recepcao", "recepcao"),
      ]),
    ).toBe("dona");
    expect(
      unicoAdminPlenoId([membro("dona", "admin"), membro("socia", "admin")]),
    ).toBeNull();
    expect(
      unicoAdminPlenoId([
        membro("dona", "admin"),
        membro("antiga", "admin", false, false),
      ]),
    ).toBe("dona");
  });
});

describe("recusas do banco na equipe", () => {
  it("as chaves das RPCs do Implementador viram texto de recepção", () => {
    expect(recusaDaEquipe({ code: "P0001", message: "papel_mudou" })).toBe(
      "O papel mudou em outro lugar. Recarregue a página.",
    );
    expect(
      recusaDaEquipe({ code: "P0001", message: "ja_e_implementador" }),
    ).toBe("Esta pessoa já é implementador.");
    expect(
      recusaDaEquipe({ code: "22023", message: "situacao_invalida" }),
    ).toBe("A situação desta pessoa mudou. Recarregue a página.");
  });

  it("as frases dos gatilhos passam; a policy vira permissão; o resto e nulo", () => {
    for (const frase of [
      "Somente um administrador da clínica marca o implementador.",
      "Somente um administrador altera o acesso de outro administrador.",
      "A clínica precisa de pelo menos um administrador ativo.",
      "Você não altera o próprio papel.",
      "Só um administrador da clínica pode ser implementador.",
    ]) {
      expect(recusaDaEquipe({ code: "P0001", message: frase })).toBe(frase);
    }
    expect(
      recusaDaEquipe({
        code: "42501",
        message:
          'new row violates row-level security policy for table "clinic_member"',
      }),
    ).toBe("Seu perfil não altera o acesso da equipe.");
    expect(recusaDaEquipe({ code: "XX000", message: "falha" })).toBeNull();
    expect(recusaDaEquipe(null)).toBeNull();
  });
});
