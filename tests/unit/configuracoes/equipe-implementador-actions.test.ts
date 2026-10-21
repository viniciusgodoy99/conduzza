import { beforeEach, describe, expect, it, vi } from "vitest";

// As actions da equipe com o Implementador (onda 5, item 18; contrato B.2 e
// B.4), com a sessao e o cliente do Supabase trocados por dubles. O que se
// prova aqui:
//   - liberar o pedido e trocar o papel PARA Implementador chamam
//     entrar_como_implementador com a situacao e o papel lidos (a RPC grava
//     papel e marca juntos e recusa a aba desatualizada);
//   - tirar o Implementador chama deixar_de_ser_implementador com o papel
//     novo (admin: so a marca sai);
//   - o gestor e o proprio Implementador sao barrados ANTES do banco diante
//     de administrador e de Implementador, e nao dao esses dois papeis
//     (P18-2 e P18-4);
//   - a trilha: marcou_implementador, tirou_implementador, e mudou_papel
//     quando o papel do banco muda; nunca dado de paciente;
//   - as chaves da RPC viram texto de recepcao.
// As travas de verdade (gatilhos, policies e as RPCs) estao nos testes de
// RLS e integracao da frente do banco.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const EU = "e0000000-0000-4000-8000-000000000001";
const ALVO = "a0000000-0000-4000-8000-000000000002";

type Erro = { code?: string; message?: string } | null;
type Resultado = { data: unknown; error: Erro };
type Chamada = {
  tabela: string;
  op: "select" | "insert" | "update" | "delete";
  valores?: Record<string, unknown>;
  filtros: [string, unknown][];
};

const registro = vi.hoisted(() => ({
  papel: "admin" as string,
  implementador: false,
  alvo: null as { role: string; status: string } | null,
  marcas: [] as string[],
  erroDasMarcas: null as { code?: string; message?: string } | null,
  respostaDoRpc: { data: "promovido", error: null } as {
    data: unknown;
    error: { code?: string; message?: string } | null;
  },
  respostaDoUpdate: null as { data: unknown; error: unknown } | null,
  chamadas: [] as {
    tabela: string;
    op: string;
    valores?: Record<string, unknown>;
    filtros: [string, unknown][];
  }[],
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
}));

function resultadoPara(chamada: Chamada): Resultado {
  if (chamada.tabela === "membro_implementador") {
    return registro.erroDasMarcas
      ? { data: null, error: registro.erroDasMarcas }
      : {
          data: registro.marcas.map((user_id) => ({ user_id })),
          error: null,
        };
  }
  if (chamada.tabela === "clinic_member" && chamada.op === "select") {
    return { data: registro.alvo, error: null };
  }
  if (chamada.tabela === "clinic_member" && chamada.op === "update") {
    return (
      (registro.respostaDoUpdate as Resultado | null) ?? {
        data: [{ user_id: ALVO }],
        error: null,
      }
    );
  }
  return { data: null, error: null };
}

type Cadeia = {
  select: () => Cadeia;
  eq: (coluna: string, valor: unknown) => Cadeia;
  maybeSingle: () => Promise<Resultado>;
  then: <T>(ok: (r: Resultado) => T, falha?: (e: unknown) => T) => Promise<T>;
};

function tabela(nome: string) {
  const comecar = (op: Chamada["op"], valores?: Record<string, unknown>) => {
    const chamada: Chamada = { tabela: nome, op, valores, filtros: [] };
    const responder = () => {
      registro.chamadas.push(chamada);
      return Promise.resolve(resultadoPara(chamada));
    };
    const cadeia: Cadeia = {
      select: () => cadeia,
      eq: (coluna, valor) => {
        chamada.filtros.push([coluna, valor]);
        return cadeia;
      },
      maybeSingle: responder,
      then: (ok, falha) => responder().then(ok, falha),
    };
    return cadeia;
  };
  return {
    select: () => comecar("select"),
    insert: (valores: Record<string, unknown>) => comecar("insert", valores),
    update: (valores: Record<string, unknown>) => comecar("update", valores),
    delete: () => comecar("delete"),
  };
}

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (nome: string) => tabela(nome),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return registro.respostaDoRpc;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a equipe nao usa o cliente de servico aqui");
  },
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => ({
    userId: EU,
    active: {
      clinicId: CLINICA,
      role: registro.papel,
      implementador: registro.implementador,
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  }),
}));

const {
  aprovarMembroAction,
  desativarMembroAction,
  mudarPapelAction,
  reativarMembroAction,
} = await import("@/app/(app)/configuracoes/actions");

/** Quem chama: administrador pleno, Implementador ou gestor. */
function entrarComo(quem: "pleno" | "implementador" | "gestor") {
  registro.papel = quem === "gestor" ? "gestor" : "admin";
  registro.implementador = quem === "implementador";
}

const trilha = () =>
  registro.chamadas
    .filter((chamada) => chamada.tabela === "audit_log")
    .map((chamada) => chamada.valores?.action);
const updates = () =>
  registro.chamadas.filter(
    (chamada) => chamada.tabela === "clinic_member" && chamada.op === "update",
  );

beforeEach(() => {
  entrarComo("pleno");
  registro.alvo = { role: "recepcao", status: "ativo" };
  registro.marcas = [];
  registro.erroDasMarcas = null;
  registro.respostaDoRpc = { data: "promovido", error: null };
  registro.respostaDoUpdate = null;
  registro.chamadas = [];
  registro.rpcs = [];
});

describe("liberar o pedido de entrada como Implementador", () => {
  beforeEach(() => {
    registro.alvo = { role: "leitura", status: "pendente" };
    registro.respostaDoRpc = { data: "liberado", error: null };
  });

  it("o administrador pleno libera pela RPC, com a situação e o papel lidos", async () => {
    expect(await aprovarMembroAction(ALVO, "implementador")).toEqual({
      ok: true,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "entrar_como_implementador",
        args: {
          p_clinic_id: CLINICA,
          p_user_id: ALVO,
          p_situacao_lida: "pendente",
          p_papel_lido: "leitura",
        },
      },
    ]);
    expect(updates()).toEqual([]);
    expect(trilha()).toEqual(["liberou_acesso", "marcou_implementador"]);
  });

  it.each(["gestor", "implementador"] as const)(
    "%s não libera como Implementador nem como administrador, antes do banco",
    async (quem) => {
      entrarComo(quem);
      expect(await aprovarMembroAction(ALVO, "implementador")).toEqual({
        ok: false,
        error: "Somente um administrador da clínica faz de alguém implementador.",
      });
      expect(await aprovarMembroAction(ALVO, "admin")).toEqual({
        ok: false,
        error: "Somente um administrador cria outro administrador.",
      });
      expect(registro.chamadas).toEqual([]);
      expect(registro.rpcs).toEqual([]);
    },
  );

  it("o Implementador libera colega como recepção, como o administrador", async () => {
    entrarComo("implementador");
    expect(await aprovarMembroAction(ALVO, "recepcao")).toEqual({ ok: true });
    expect(updates()[0]?.valores).toEqual({ status: "ativo", role: "recepcao" });
  });

  it("pedido já tratado (lido ou recusado pela RPC)", async () => {
    registro.alvo = { role: "recepcao", status: "ativo" };
    expect(await aprovarMembroAction(ALVO, "implementador")).toEqual({
      ok: false,
      error: "Este pedido já foi tratado.",
    });
    expect(registro.rpcs).toEqual([]);

    registro.alvo = { role: "leitura", status: "pendente" };
    registro.respostaDoRpc = {
      data: null,
      error: { code: "P0001", message: "papel_mudou" },
    };
    expect(await aprovarMembroAction(ALVO, "implementador")).toEqual({
      ok: false,
      error: "Este pedido já foi tratado.",
    });
    expect(trilha()).toEqual([]);
  });
});

describe("trocar o papel para Implementador", () => {
  it("de recepção: a RPC promove e marca; a trilha diz as duas coisas", async () => {
    expect(
      await mudarPapelAction({ user_id: ALVO, papel: "implementador" }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([
      {
        nome: "entrar_como_implementador",
        args: {
          p_clinic_id: CLINICA,
          p_user_id: ALVO,
          p_situacao_lida: "ativo",
          p_papel_lido: "recepcao",
        },
      },
    ]);
    expect(updates()).toEqual([]);
    expect(trilha()).toEqual(["mudou_papel", "marcou_implementador"]);
  });

  it("de administrador pleno: só a marca entra", async () => {
    registro.alvo = { role: "admin", status: "ativo" };
    registro.respostaDoRpc = { data: "marcado", error: null };
    expect(
      await mudarPapelAction({ user_id: ALVO, papel: "implementador" }),
    ).toEqual({ ok: true });
    expect(registro.rpcs[0]?.args).toMatchObject({
      p_situacao_lida: "ativo",
      p_papel_lido: "admin",
    });
    expect(trilha()).toEqual(["marcou_implementador"]);
  });

  it("quem está sem acesso volta antes pelo Reativar", async () => {
    registro.alvo = { role: "recepcao", status: "inativo" };
    expect(
      await mudarPapelAction({ user_id: ALVO, papel: "implementador" }),
    ).toEqual({
      ok: false,
      error:
        "Esta pessoa está sem acesso. Use Reativar antes de fazer dela implementador.",
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("as chaves da RPC viram texto de recepção", async () => {
    registro.respostaDoRpc = {
      data: null,
      error: { code: "P0001", message: "ja_e_implementador" },
    };
    expect(
      await mudarPapelAction({ user_id: ALVO, papel: "implementador" }),
    ).toEqual({ ok: false, error: "Esta pessoa já é implementador." });
    expect(trilha()).toEqual([]);
  });
});

describe("tirar o Implementador", () => {
  beforeEach(() => {
    registro.alvo = { role: "admin", status: "ativo" };
    registro.marcas = [ALVO];
    registro.respostaDoRpc = { data: null, error: null };
  });

  it("para Administrador: só a marca sai", async () => {
    expect(await mudarPapelAction({ user_id: ALVO, papel: "admin" })).toEqual({
      ok: true,
    });
    expect(registro.rpcs).toEqual([
      {
        nome: "deixar_de_ser_implementador",
        args: { p_clinic_id: CLINICA, p_user_id: ALVO, p_papel_novo: "admin" },
      },
    ]);
    expect(trilha()).toEqual(["tirou_implementador"]);
  });

  it("para Gestor: o papel troca e a marca sai pelo gatilho", async () => {
    expect(await mudarPapelAction({ user_id: ALVO, papel: "gestor" })).toEqual(
      { ok: true },
    );
    expect(registro.rpcs[0]?.args).toMatchObject({ p_papel_novo: "gestor" });
    expect(updates()).toEqual([]);
    expect(trilha()).toEqual(["tirou_implementador", "mudou_papel"]);
  });

  it("o mesmo papel não faz nada", async () => {
    expect(
      await mudarPapelAction({ user_id: ALVO, papel: "implementador" }),
    ).toEqual({ ok: true });
    expect(registro.rpcs).toEqual([]);
  });

  it("sem conseguir ler a marca, o administrador pleno tenta de novo", async () => {
    registro.erroDasMarcas = { code: "XX000", message: "falha" };
    expect(await mudarPapelAction({ user_id: ALVO, papel: "admin" })).toEqual({
      ok: false,
      error: "Não foi possível conferir o papel desta pessoa. Tente de novo.",
    });
    expect(registro.rpcs).toEqual([]);
  });

  it("tabela da marca ainda ausente: ninguém é Implementador (a troca de sempre)", async () => {
    registro.erroDasMarcas = { code: "PGRST205", message: "not found" };
    registro.alvo = { role: "admin", status: "ativo" };
    expect(await mudarPapelAction({ user_id: ALVO, papel: "gestor" })).toEqual(
      { ok: true },
    );
    expect(registro.rpcs).toEqual([]);
    expect(updates()[0]?.valores).toEqual({ role: "gestor" });
  });
});

describe("o gestor e o Implementador diante de administrador (P18-2)", () => {
  it.each([
    ["gestor", "admin", false, "Somente um administrador altera o acesso de outro administrador."],
    ["gestor", "admin", true, "Somente um administrador altera o acesso de um implementador."],
    ["implementador", "admin", false, "Somente um administrador altera o acesso de outro administrador."],
    ["implementador", "admin", true, "Somente um administrador altera o acesso de um implementador."],
  ] as const)(
    "%s não troca o papel de %s (marca: %s)",
    async (quem, role, marcado, frase) => {
      entrarComo(quem);
      registro.alvo = { role, status: "ativo" };
      registro.marcas = marcado ? [ALVO] : [];
      expect(
        await mudarPapelAction({ user_id: ALVO, papel: "recepcao" }),
      ).toEqual({ ok: false, error: frase });
      expect(await desativarMembroAction({ user_id: ALVO })).toEqual({
        ok: false,
        error: frase,
      });
      registro.alvo = { role, status: "inativo" };
      expect(await reativarMembroAction({ user_id: ALVO })).toEqual({
        ok: false,
        error: frase,
      });
      expect(updates()).toEqual([]);
      expect(registro.rpcs).toEqual([]);
    },
  );

  it("a marca que não carregou não abre a porta: vale a frase de administrador", async () => {
    entrarComo("implementador");
    registro.alvo = { role: "admin", status: "ativo" };
    registro.erroDasMarcas = { code: "XX000", message: "falha" };
    expect(await desativarMembroAction({ user_id: ALVO })).toEqual({
      ok: false,
      error: "Somente um administrador altera o acesso de outro administrador.",
    });
  });

  it("o Implementador não promove ninguém a administrador nem a Implementador", async () => {
    entrarComo("implementador");
    expect(await mudarPapelAction({ user_id: ALVO, papel: "admin" })).toEqual({
      ok: false,
      error: "Somente um administrador cria outro administrador.",
    });
    expect(
      await mudarPapelAction({ user_id: ALVO, papel: "implementador" }),
    ).toEqual({
      ok: false,
      error: "Somente um administrador da clínica faz de alguém implementador.",
    });
    expect(updates()).toEqual([]);
    expect(registro.rpcs).toEqual([]);
  });

  it("com quem não é administrador, o Implementador gerencia como o administrador", async () => {
    entrarComo("implementador");
    expect(await mudarPapelAction({ user_id: ALVO, papel: "gestor" })).toEqual(
      { ok: true },
    );
    expect(updates()[0]?.valores).toEqual({ role: "gestor" });
    registro.chamadas = [];
    expect(await desativarMembroAction({ user_id: ALVO })).toEqual({
      ok: true,
    });
    expect(updates()[0]?.valores).toEqual({ status: "inativo" });
  });

  it("ninguém troca o próprio papel, antes do banco", async () => {
    expect(
      await mudarPapelAction({ user_id: EU, papel: "implementador" }),
    ).toEqual({ ok: false, error: "Você não altera o próprio papel." });
    expect(registro.chamadas).toEqual([]);
  });
});
