import { beforeEach, describe, expect, it, vi } from "vitest";

// Convite de Implementador (onda 5, item 18; contrato B.2): o vinculo nasce
// pela RPC entrar_como_implementador sem vinculo lido (admin ativo e a marca
// na mesma transacao, com a sessao de quem convida), tanto para a conta
// nova quanto para a que ja existia. As regras dos achados L17/L20 seguem:
// a resposta e a trilha sao as mesmas nos dois caminhos. So o administrador
// pleno convida Implementador (P18-4) e administrador (P18-2): o gestor e o
// proprio Implementador sao barrados antes de qualquer e-mail sair.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  papel: "admin" as string,
  implementador: false,
  /** a leitura da propria marca falhou (a sessao segue com implementador false) */
  marcaIndisponivel: false,
  inseridos: [] as { tabela: string; linha: Record<string, unknown> }[],
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  erroDaRpc: null as { code: string; message: string } | null,
}));

const rpcDoServico = vi.fn();
const inviteUserByEmail = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => ({
      insert: async (linha: Linha) => {
        estado.inseridos.push({ tabela, linha });
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { role: "recepcao", status: "ativo" },
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nome, args });
      return {
        data: estado.erroDaRpc ? null : "convidado",
        error: estado.erroDaRpc,
      };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcDoServico,
    auth: { admin: { inviteUserByEmail } },
  }),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  ACTIVE_CLINIC_COOKIE: "clinica_ativa",
  getSessionContext: async () => ({
    userId: "quem-convida",
    userName: "Dona",
    userEmail: "dona@clinica.test",
    memberships: [],
    active: {
      clinicId: "clinica-a",
      clinicName: "Clínica A",
      role: estado.papel,
      implementador: estado.implementador,
      status: "ativo",
    },
    isProductAdmin: false,
    vinculoIndisponivel: false,
    marcaDeImplementadorIndisponivel: estado.marcaIndisponivel,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["origin", "https://app.exemplo.test"],
      ["host", "app.exemplo.test"],
    ]),
  cookies: async () => ({ set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));

const { inviteMemberAction } = await import("@/app/(auth)/actions");

function convite(email: string, role: string): FormData {
  const dados = new FormData();
  dados.set("email", email);
  dados.set("role", role);
  return dados;
}

function contaJaExiste(userId: string) {
  rpcDoServico.mockResolvedValue({
    data: [{ user_id: userId, confirmada: true }],
    error: null,
  });
}

function contaNova(userId: string) {
  rpcDoServico.mockResolvedValue({ data: [], error: null });
  inviteUserByEmail.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
}

function trilha() {
  return estado.inseridos
    .filter((item) => item.tabela === "audit_log")
    .map((item) => item.linha);
}

beforeEach(() => {
  estado.papel = "admin";
  estado.implementador = false;
  estado.marcaIndisponivel = false;
  estado.inseridos = [];
  estado.rpcs = [];
  estado.erroDaRpc = null;
  rpcDoServico.mockReset();
  inviteUserByEmail.mockReset();
});

describe("convite de Implementador pelo administrador pleno", () => {
  it("conta nova: o GoTrue convida e a RPC cria o vínculo admin com a marca", async () => {
    contaNova("pessoa-nova");
    const resultado = await inviteMemberAction(
      {},
      convite("tecnico@agencia.test", "implementador"),
    );
    expect(resultado).toEqual({
      success: "Convite registrado para tecnico@agencia.test",
    });
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(estado.rpcs).toEqual([
      {
        nome: "entrar_como_implementador",
        args: { p_clinic_id: "clinica-a", p_user_id: "pessoa-nova" },
      },
    ]);
    // Nada de insert direto em clinic_member: papel e marca vao juntos.
    expect(
      estado.inseridos.filter((item) => item.tabela === "clinic_member"),
    ).toEqual([]);
  });

  it("conta que já existe: a mesma RPC, sem e-mail de convite", async () => {
    contaJaExiste("pessoa-existente");
    await inviteMemberAction(
      {},
      convite("tecnico@agencia.test", "implementador"),
    );
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(estado.rpcs[0]?.args).toEqual({
      p_clinic_id: "clinica-a",
      p_user_id: "pessoa-existente",
    });
  });

  it("a trilha: o convite de sempre e a marca, iguais nos dois caminhos", async () => {
    contaJaExiste("pessoa-existente");
    await inviteMemberAction({}, convite("a@agencia.test", "implementador"));
    contaNova("pessoa-nova");
    await inviteMemberAction({}, convite("b@agencia.test", "implementador"));

    const linhas = trilha();
    expect(linhas.map((linha) => linha.action)).toEqual([
      "convidou_membro",
      "marcou_implementador",
      "convidou_membro",
      "marcou_implementador",
    ]);
    const semQuem = (linha: Linha | undefined) => ({
      ...linha,
      entity_id: null,
    });
    expect(semQuem(linhas[0])).toEqual(semQuem(linhas[2]));
    expect(semQuem(linhas[1])).toEqual(semQuem(linhas[3]));
  });

  it("a recusa da RPC sai com a mesma frase nos dois caminhos", async () => {
    estado.erroDaRpc = { code: "XX000", message: "falha qualquer" };
    contaJaExiste("pessoa-existente");
    const existente = await inviteMemberAction(
      {},
      convite("a@agencia.test", "implementador"),
    );
    contaNova("pessoa-nova");
    const nova = await inviteMemberAction(
      {},
      convite("a@agencia.test", "implementador"),
    );
    expect(existente.error).toBeDefined();
    expect(existente).toEqual(nova);
    expect(trilha()).toEqual([]);
  });

  it("os outros papéis seguem pelo insert de sempre", async () => {
    contaNova("pessoa-nova");
    await inviteMemberAction({}, convite("r@clinica.test", "recepcao"));
    expect(estado.rpcs).toEqual([]);
    expect(
      estado.inseridos.find((item) => item.tabela === "clinic_member")?.linha,
    ).toMatchObject({ role: "recepcao", status: "ativo" });
    expect(trilha().map((linha) => linha.action)).toEqual(["convidou_membro"]);
  });
});

describe("quem não é administrador pleno (P18-2 e P18-4)", () => {
  it.each([
    ["gestor", false],
    ["admin", true],
  ])(
    "%s (Implementador: %s) não convida Implementador nem administrador, antes de qualquer e-mail",
    async (papel, implementador) => {
      estado.papel = papel;
      estado.implementador = implementador;
      contaNova("pessoa-nova");
      expect(
        await inviteMemberAction(
          {},
          convite("t@agencia.test", "implementador"),
        ),
      ).toEqual({
        error: "Somente um administrador da clínica convida um implementador.",
      });
      expect(
        await inviteMemberAction({}, convite("t@agencia.test", "admin")),
      ).toEqual({
        error: "Somente um administrador convida outro administrador.",
      });
      expect(inviteUserByEmail).not.toHaveBeenCalled();
      expect(rpcDoServico).not.toHaveBeenCalled();
      expect(estado.rpcs).toEqual([]);
    },
  );

  it("o Implementador convida a recepção como o administrador", async () => {
    estado.implementador = true;
    contaNova("pessoa-nova");
    expect(
      await inviteMemberAction({}, convite("r@clinica.test", "recepcao")),
    ).toEqual({ success: "Convite registrado para r@clinica.test" });
  });
});

describe("a própria marca não carregou (revisão da onda 5)", () => {
  // A sessao de quem tem o vinculo admin fica com implementador false quando
  // a leitura da marca falha: um Implementador passaria como administrador
  // pleno, e o e-mail do GoTrue sairia antes de o banco recusar o vinculo
  // admin ou a RPC (a pessoa de fora recebe um convite sem acesso nenhum).
  // Na duvida, o papel que so o administrador pleno da nao sai.
  it.each(["implementador", "admin"])(
    "convite como %s: recusa antes de qualquer e-mail, nos dois caminhos",
    async (papel) => {
      estado.marcaIndisponivel = true;
      contaNova("pessoa-nova");
      const nova = await inviteMemberAction(
        {},
        convite("t@agencia.test", papel),
      );
      contaJaExiste("pessoa-existente");
      const existente = await inviteMemberAction(
        {},
        convite("t@agencia.test", papel),
      );
      expect(nova).toEqual({
        error: "Não foi possível conferir o seu papel. Tente de novo.",
      });
      // A mesma resposta com e sem cadastro (L17/L20): a busca da conta nem
      // roda.
      expect(existente).toEqual(nova);
      expect(rpcDoServico).not.toHaveBeenCalled();
      expect(inviteUserByEmail).not.toHaveBeenCalled();
      expect(estado.rpcs).toEqual([]);
      expect(estado.inseridos).toEqual([]);
    },
  );

  it("os outros papéis seguem: a marca não muda o que o administrador e o Implementador dão", async () => {
    estado.marcaIndisponivel = true;
    contaNova("pessoa-nova");
    expect(
      await inviteMemberAction({}, convite("r@clinica.test", "recepcao")),
    ).toEqual({ success: "Convite registrado para r@clinica.test" });
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("o gestor segue com a recusa de sempre (a marca só vale no vínculo admin)", async () => {
    estado.marcaIndisponivel = true;
    estado.papel = "gestor";
    contaNova("pessoa-nova");
    expect(
      await inviteMemberAction({}, convite("t@agencia.test", "admin")),
    ).toEqual({
      error: "Somente um administrador convida outro administrador.",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });
});
