import { describe, expect, it } from "vitest";

import {
  emailNormalizado,
  enderecoDoApp,
  recusaDaContaNova,
  recusaDaLimpeza,
  valorDe,
  valoresDe,
} from "@/scripts/operacao/super-admin-separado";

// As guardas puras do script da operacao (scripts/operacao/
// super-admin-separado.ts; roteiro em supabase/operacao/
// super-admin-separado.md). Nada de rede: o script so roda o passo quando
// chamado como script, e aqui so as funcoes que decidem.
// - os argumentos (repetiveis, sem pegar a proxima opcao como valor);
// - o e-mail e o endereco do app (https, sem caminho; http so no localhost);
// - a conta do painel nao tem linha em clinica nenhuma (nem pendente, nem
//   com o acesso tirado);
// - a limpeza so com a conta nova funcionando (super admin, sem vinculo, ja
//   entrou), com a migration aplicada, e cada antiga sendo outra conta, ja
//   super admin ou ja marcada.

type Situacao = NonNullable<Parameters<typeof recusaDaContaNova>[0]>;

function situacao(campos: {
  email: string;
  superAdmin?: boolean;
  marcada?: boolean | null;
  vinculos?: number;
  ultimoLogin?: string | null;
  userId?: string;
}): Situacao {
  return {
    conta: {
      userId: campos.userId ?? `id-${campos.email}`,
      email: campos.email,
      confirmada: true,
      ultimoLogin:
        campos.ultimoLogin === undefined
          ? "2026-11-03T12:00:00Z"
          : campos.ultimoLogin,
    },
    superAdmin: campos.superAdmin ?? false,
    marcada: campos.marcada === undefined ? false : campos.marcada,
    vinculos: Array.from({ length: campos.vinculos ?? 0 }, (_, i) => ({
      clinicId: `clinica-${i}`,
      papel: "admin",
      situacao: "ativo",
    })),
  };
}

describe("argumentos", () => {
  it("lê opção repetível e não toma a próxima opção como valor", () => {
    const args = [
      "limpar",
      "--antiga",
      "a@x.test",
      "--antiga",
      "b@x.test",
      "--nova",
      "--confirmar",
    ];
    expect(valoresDe(args, "--antiga")).toEqual(["a@x.test", "b@x.test"]);
    expect(valorDe(args, "--nova")).toBeNull();
    expect(valorDe(args, "--email")).toBeNull();
  });

  it("e-mail em minúsculas; o que não é e-mail vira nulo", () => {
    expect(emailNormalizado("  Painel@Equipe.TEST ")).toBe(
      "painel@equipe.test",
    );
    expect(emailNormalizado("painel")).toBeNull();
    expect(emailNormalizado(null)).toBeNull();
  });

  it("o endereço do app: https sem caminho (http só no localhost)", () => {
    expect(enderecoDoApp("https://app.exemplo.test")).toBe(
      "https://app.exemplo.test",
    );
    expect(enderecoDoApp("https://app.exemplo.test/")).toBe(
      "https://app.exemplo.test",
    );
    expect(enderecoDoApp("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(enderecoDoApp("http://app.exemplo.test")).toBeNull();
    expect(enderecoDoApp("https://app.exemplo.test/inicio")).toBeNull();
    expect(enderecoDoApp("https://app.exemplo.test/?x=1")).toBeNull();
    expect(enderecoDoApp("nada")).toBeNull();
    expect(enderecoDoApp(null)).toBeNull();
  });
});

describe("a conta do painel (passo criar)", () => {
  it("conta nova ou conta sem vínculo: pode", () => {
    expect(recusaDaContaNova(null)).toBeNull();
    expect(recusaDaContaNova(situacao({ email: "p@x.test" }))).toBeNull();
  });

  it("conta com qualquer vínculo com clínica: não pode", () => {
    expect(
      recusaDaContaNova(situacao({ email: "p@x.test", vinculos: 1 })),
    ).toMatch(/não entra em clínica/);
  });
});

describe("a limpeza das contas antigas (passo limpar)", () => {
  const nova = situacao({ email: "painel@x.test", superAdmin: true });
  const antiga = situacao({
    email: "dono@x.test",
    superAdmin: true,
    vinculos: 2,
  });

  it("com a conta nova funcionando e a antiga super admin: pode", () => {
    expect(recusaDaLimpeza(nova, [antiga], ["dono@x.test"])).toBeNull();
  });

  it("a antiga já limpa (só marcada) também passa: o passo é repetível", () => {
    const limpa = situacao({
      email: "dono@x.test",
      marcada: true,
      vinculos: 2,
    });
    expect(recusaDaLimpeza(nova, [limpa], ["dono@x.test"])).toBeNull();
  });

  it("sem a conta nova, ou sem a migration: não", () => {
    expect(recusaDaLimpeza(null, [antiga], ["dono@x.test"])).toMatch(
      /criar antes/,
    );
    expect(
      recusaDaLimpeza({ ...nova, marcada: null }, [antiga], ["dono@x.test"]),
    ).toMatch(/migration 20261103110000/);
  });

  it("a conta nova precisa ser super admin, sem vínculo e já ter entrado", () => {
    expect(
      recusaDaLimpeza(
        { ...nova, superAdmin: false },
        [antiga],
        ["dono@x.test"],
      ),
    ).toMatch(/não é super admin/);
    expect(
      recusaDaLimpeza(
        situacao({ email: "painel@x.test", superAdmin: true, vinculos: 1 }),
        [antiga],
        ["dono@x.test"],
      ),
    ).toMatch(/não é a conta do painel/);
    expect(
      recusaDaLimpeza(
        situacao({
          email: "painel@x.test",
          superAdmin: true,
          ultimoLogin: null,
        }),
        [antiga],
        ["dono@x.test"],
      ),
    ).toMatch(/ainda não entrou/);
  });

  it("cada antiga existe, é outra conta e é super admin ou já marcada", () => {
    expect(recusaDaLimpeza(nova, [null], ["sumiu@x.test"])).toMatch(
      /Nenhuma conta com o e-mail sumiu@x.test/,
    );
    expect(recusaDaLimpeza(nova, [nova], ["painel@x.test"])).toMatch(
      /não pode ser também uma conta antiga/,
    );
    expect(
      recusaDaLimpeza(
        nova,
        [situacao({ email: "cliente@x.test", vinculos: 1 })],
        ["cliente@x.test"],
      ),
    ).toMatch(/não é uma conta antiga/);
  });

  it("nenhum travessão nos textos", () => {
    const textos = [
      recusaDaContaNova(situacao({ email: "p@x.test", vinculos: 1 })),
      recusaDaLimpeza(null, [], []),
      recusaDaLimpeza({ ...nova, marcada: null }, [], []),
      recusaDaLimpeza({ ...nova, superAdmin: false }, [], []),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });
});
