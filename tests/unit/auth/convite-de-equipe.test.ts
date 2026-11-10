import { beforeEach, describe, expect, it, vi } from "vitest";

// Convite para a equipe (achados L17 e L20 da revisao da leva 2). O cadastro
// e publico: qualquer pessoa vira administradora criando uma clinica. Por
// isso o formulario de convite nao pode responder de um jeito para o e-mail
// que ja tem conta e de outro para o e-mail novo, e a trilha (que
// administrador e gestor leem) tambem nao pode.

type Linha = Record<string, unknown>;

const inseridos: { tabela: string; linha: Linha }[] = [];
let erroDoVinculo: { code: string; message: string } | null = null;
let ehDaEquipeConduzza = false;
// A conta normal marcada em equipe_conduzza (lida pelo service role).
let marcadaNaEquipeConduzza = false;
const lidasDaEquipe: string[] = [];

function construtor(tabela: string) {
  return {
    insert: async (linha: Linha) => {
      inseridos.push({ tabela, linha });
      if (tabela === "clinic_member" && erroDoVinculo) {
        return { error: erroDoVinculo };
      }
      return { error: null };
    },
  };
}

const rpc = vi.fn();
const inviteUserByEmail = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: construtor }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    auth: { admin: { inviteUserByEmail } },
    from: (tabela: string) => ({
      select: () => ({
        eq: (_coluna: string, userId: string) => ({
          maybeSingle: async () => {
            lidasDaEquipe.push(`${tabela}:${userId}`);
            return {
              data:
                tabela === "equipe_conduzza" && marcadaNaEquipeConduzza
                  ? { user_id: userId }
                  : null,
              error: null,
            };
          },
        }),
      }),
    }),
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
      role: "admin",
      status: "ativo",
    },
    isProductAdmin: ehDaEquipeConduzza,
    vinculoIndisponivel: false,
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

function convite(email: string, role = "recepcao"): FormData {
  const dados = new FormData();
  dados.set("email", email);
  dados.set("role", role);
  return dados;
}

function contaJaExiste(userId: string) {
  rpc.mockResolvedValue({
    data: [{ user_id: userId, confirmada: true }],
    error: null,
  });
}

function contaNova(userId: string) {
  rpc.mockResolvedValue({ data: [], error: null });
  inviteUserByEmail.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
}

function trilha() {
  return inseridos
    .filter((item) => item.tabela === "audit_log")
    .map((item) => item.linha);
}

beforeEach(() => {
  inseridos.length = 0;
  erroDoVinculo = null;
  ehDaEquipeConduzza = false;
  marcadaNaEquipeConduzza = false;
  lidasDaEquipe.length = 0;
  rpc.mockReset();
  inviteUserByEmail.mockReset();
});

describe("inviteMemberAction: conta que já existe", () => {
  it("cria o vínculo ativo sem convite do GoTrue e responde como convite comum", async () => {
    contaJaExiste("pessoa-existente");

    const resultado = await inviteMemberAction({}, convite("ana@outra.test"));

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      success: "Convite registrado para ana@outra.test",
    });
    expect(
      inseridos.find((item) => item.tabela === "clinic_member")?.linha,
    ).toEqual({
      clinic_id: "clinica-a",
      user_id: "pessoa-existente",
      role: "recepcao",
      status: "ativo",
    });
  });

  it("não revela na resposta que a conta existia nem o nome da pessoa", async () => {
    contaJaExiste("pessoa-existente");

    const resultado = await inviteMemberAction({}, convite("ana@outra.test"));

    expect(resultado.success).not.toMatch(/conta|senha|liberado/i);
  });

  it("grava o convite na trilha com a sessão de quem convidou", async () => {
    contaJaExiste("pessoa-existente");

    await inviteMemberAction({}, convite("ana@outra.test"));

    expect(trilha()).toEqual([
      {
        clinic_id: "clinica-a",
        user_id: "quem-convida",
        action: "convidou_membro",
        entity: "clinic_member",
        entity_id: "pessoa-existente",
      },
    ]);
  });
});

describe("inviteMemberAction: conta nova e conta existente são indistinguíveis", () => {
  it("mesma resposta de sucesso", async () => {
    contaJaExiste("pessoa-existente");
    const existente = await inviteMemberAction({}, convite("ana@outra.test"));

    contaNova("pessoa-nova");
    const nova = await inviteMemberAction({}, convite("ana@outra.test"));

    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(existente).toEqual(nova);
  });

  it("mesma linha na trilha, só muda quem foi convidado", async () => {
    contaJaExiste("pessoa-existente");
    await inviteMemberAction({}, convite("ana@outra.test"));
    contaNova("pessoa-nova");
    await inviteMemberAction({}, convite("bia@nova.test"));

    const [daExistente, daNova] = trilha();
    expect(daExistente).toBeDefined();
    expect(daNova).toBeDefined();
    expect({ ...daExistente, entity_id: null }).toEqual({
      ...daNova,
      entity_id: null,
    });
  });

  it("mesma mensagem quando o vínculo é recusado", async () => {
    erroDoVinculo = { code: "XX000", message: "falha qualquer" };

    contaJaExiste("pessoa-existente");
    const existente = await inviteMemberAction({}, convite("ana@outra.test"));
    contaNova("pessoa-nova");
    const nova = await inviteMemberAction({}, convite("ana@outra.test"));

    expect(existente.error).toBeDefined();
    expect(existente).toEqual(nova);
    expect(trilha()).toEqual([]);
  });
});

describe("inviteMemberAction: a conta de super admin não entra em clínica (06/11/2026)", () => {
  const RECUSA_DO_SUPER_ADMIN = {
    code: "CZSA1",
    message: "Esta conta é da equipe Conduzza e não entra em clínica.",
  };

  it("a equipe Conduzza lê o motivo", async () => {
    ehDaEquipeConduzza = true;
    erroDoVinculo = RECUSA_DO_SUPER_ADMIN;
    contaJaExiste("super-admin");
    expect(await inviteMemberAction({}, convite("time@conduzza.test"))).toEqual(
      {
        error:
          "Esta conta é de super admin da equipe Conduzza e não entra em clínica. Para trabalhar na clínica, convide a conta normal da pessoa.",
      },
    );
    expect(trilha()).toEqual([]);
  });

  it("a conta normal marcada como equipe Conduzza também lê o motivo (10/11/2026)", async () => {
    marcadaNaEquipeConduzza = true;
    erroDoVinculo = RECUSA_DO_SUPER_ADMIN;
    contaJaExiste("super-admin");
    expect(await inviteMemberAction({}, convite("time@conduzza.test"))).toEqual(
      {
        error:
          "Esta conta é de super admin da equipe Conduzza e não entra em clínica. Para trabalhar na clínica, convide a conta normal da pessoa.",
      },
    );
    expect(lidasDaEquipe).toEqual(["equipe_conduzza:quem-convida"]);
  });

  it("a marca da equipe só é lida quando o banco recusa com CZSA1", async () => {
    marcadaNaEquipeConduzza = true;
    contaJaExiste("pessoa");
    expect(
      (await inviteMemberAction({}, convite("ana@outra.test"))).error,
    ).toBe(undefined);
    erroDoVinculo = { code: "XX000", message: "falha qualquer" };
    expect(await inviteMemberAction({}, convite("ana@outra.test"))).toEqual({
      error: "Não foi possível concluir o convite. Tente de novo.",
    });
    expect(lidasDaEquipe).toEqual([]);
  });

  it("o administrador da clínica lê a recusa de sempre (nada revela que o e-mail é da equipe Conduzza)", async () => {
    erroDoVinculo = RECUSA_DO_SUPER_ADMIN;
    contaJaExiste("super-admin");
    const doSuperAdmin = await inviteMemberAction(
      {},
      convite("time@conduzza.test"),
    );
    erroDoVinculo = { code: "XX000", message: "falha qualquer" };
    const outraFalha = await inviteMemberAction({}, convite("ana@outra.test"));
    expect(doSuperAdmin).toEqual(outraFalha);
    expect(doSuperAdmin.error).toBe(
      "Não foi possível concluir o convite. Tente de novo.",
    );
  });
});
