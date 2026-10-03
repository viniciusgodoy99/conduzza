import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions das atividades contra um cliente do Supabase dublado: o que
// a action manda ao banco (clinica da sessao, prazo no fuso da clinica, nunca
// status, origem nem autoria), o que ela recusa antes (papel que so le, Zod,
// prazo no passado), concluir idempotente, a traducao dos erros e a trilha
// (mutacao com a entidade contact_activity e o id, sem o texto; leitura com a
// entidade atividades). O banco em si (RLS, gatilho e carimbos) esta nos
// testes de RLS e de integracao da Leva A.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const CONTATO = "3d3d3d3d-0000-4000-8000-000000000001";
const ATIVIDADE = "6a6a6a6a-0000-4000-8000-000000000001";
const RESPONSAVEL = "7b7b7b7b-0000-4000-8000-000000000001";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };
type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update";
  valores?: Linha;
  filtros: [string, string, unknown][];
};
type Resposta = { data: unknown; error: Erro | null };

const estado = {
  ops: [] as Operacao[],
  responder: (op: Operacao): Resposta => {
    void op;
    return { data: null, error: null };
  },
};

function construtor(tabela: string) {
  const op: Operacao = { tabela, tipo: "select", filtros: [] };
  const resolver = async (): Promise<Resposta> => {
    estado.ops.push(op);
    return estado.responder(op);
  };
  const api = {
    select: () => api,
    insert: (valores: Linha) => {
      op.tipo = "insert";
      op.valores = valores;
      return api;
    },
    update: (valores: Linha) => {
      op.tipo = "update";
      op.valores = valores;
      return api;
    },
    eq: (coluna: string, valor: unknown) => {
      op.filtros.push(["eq", coluna, valor]);
      return api;
    },
    in: (coluna: string, valor: unknown) => {
      op.filtros.push(["in", coluna, valor]);
      return api;
    },
    gte: () => api,
    order: () => api,
    limit: () => api,
    single: resolver,
    maybeSingle: resolver,
    then: (
      aoResolver: (valor: Resposta) => unknown,
      aoRejeitar?: (erro: unknown) => unknown,
    ) => resolver().then(aoResolver, aoRejeitar),
  };
  return api;
}

const cliente = { from: (tabela: string) => construtor(tabela) };

const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA,
    timezone: "America/Fortaleza",
    role: "recepcao" as string,
    status: "ativo",
  },
};

const leituras: Linha[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: async (_cliente: unknown, params: Linha) => {
    leituras.push(params);
  },
}));

const {
  adiarAtividadeAction,
  cancelarAtividadeAction,
  concluirAtividadeAction,
  criarAtividadeAction,
  listarAtividadesAction,
} = await import("@/app/(app)/atividades/actions");

const VALIDA = {
  contact_id: CONTATO,
  titulo: "  Retornar em dezembro  ",
  detalhes: "  ",
  dia: "2026-12-01",
  hora: "14:30",
  assignee_user_id: RESPONSAVEL,
};

function operacoes(tabela: string, tipo: Operacao["tipo"]) {
  return estado.ops.filter((op) => op.tabela === tabela && op.tipo === tipo);
}

beforeEach(() => {
  estado.ops = [];
  estado.responder = (op) =>
    op.tipo === "insert" && op.tabela === "contact_activity"
      ? { data: { id: ATIVIDADE }, error: null }
      : { data: null, error: null };
  leituras.length = 0;
  sessao.active.role = "recepcao";
  // 02/10/2026, 15:00 em Fortaleza.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T18:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("criarAtividadeAction", () => {
  it("recepção cria na clínica da sessão, com o prazo no fuso, sem autoria nem status", async () => {
    const resultado = await criarAtividadeAction(VALIDA);
    expect(resultado).toEqual({ ok: true, id: ATIVIDADE });
    const [insert] = operacoes("contact_activity", "insert");
    expect(insert!.valores).toEqual({
      clinic_id: CLINICA,
      contact_id: CONTATO,
      conversation_id: null,
      titulo: "Retornar em dezembro",
      detalhes: null,
      due_on: "2026-12-01",
      due_at: "2026-12-01T17:30:00.000Z",
      assignee_user_id: RESPONSAVEL,
    });
    // Trilha da mutacao: entidade e id, nunca o texto.
    const [trilha] = operacoes("audit_log", "insert");
    expect(trilha!.valores).toEqual({
      clinic_id: CLINICA,
      user_id: "usuario-da-sessao",
      action: "criou_atividade",
      entity: "contact_activity",
      entity_id: ATIVIDADE,
    });
    expect(JSON.stringify(trilha!.valores)).not.toContain("dezembro");
  });

  it("papel leitura e profissional não escrevem: nada vai ao banco", async () => {
    for (const papel of ["leitura", "profissional"]) {
      sessao.active.role = papel;
      const resultado = await criarAtividadeAction(VALIDA);
      expect(resultado.ok).toBe(false);
    }
    expect(estado.ops).toEqual([]);
  });

  it("prazo no passado ou hora de hoje que já foi: recusa antes do banco", async () => {
    const ontem = await criarAtividadeAction({ ...VALIDA, dia: "2026-10-01" });
    expect(ontem).toEqual({
      ok: false,
      error: "Escolha hoje ou um dia depois.",
    });
    const horaPassada = await criarAtividadeAction({
      ...VALIDA,
      dia: "2026-10-02",
      hora: "09:00",
    });
    expect(horaPassada.ok).toBe(false);
    expect(estado.ops).toEqual([]);
  });

  it("Zod: título curto e contato inválido nem chegam ao banco", async () => {
    expect((await criarAtividadeAction({ ...VALIDA, titulo: "a" })).ok).toBe(
      false,
    );
    expect(
      (await criarAtividadeAction({ ...VALIDA, contact_id: "x" })).ok,
    ).toBe(false);
    expect(estado.ops).toEqual([]);
  });

  it("responsável fora da equipe (23514) vira frase de recepção", async () => {
    estado.responder = () => ({
      data: null,
      error: {
        code: "23514",
        message:
          "O responsável precisa ser alguém ativo da equipe desta clínica.",
      },
    });
    const resultado = await criarAtividadeAction(VALIDA);
    expect(resultado).toEqual({
      ok: false,
      error: "O responsável precisa ser alguém ativo da equipe desta clínica.",
    });
    expect(operacoes("audit_log", "insert")).toEqual([]);
  });
});

describe("concluirAtividadeAction", () => {
  it("manda só o status e só pega pendente", async () => {
    estado.responder = (op) =>
      op.tipo === "update"
        ? { data: [{ id: ATIVIDADE }], error: null }
        : { data: null, error: null };
    const resultado = await concluirAtividadeAction(ATIVIDADE);
    expect(resultado).toEqual({ ok: true, id: ATIVIDADE });
    const [update] = operacoes("contact_activity", "update");
    expect(update!.valores).toEqual({ status: "concluida" });
    expect(update!.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
    expect(update!.filtros).toContainEqual(["eq", "status", "pendente"]);
    expect(operacoes("audit_log", "insert")[0]!.valores).toMatchObject({
      action: "concluiu_atividade",
      entity: "contact_activity",
      entity_id: ATIVIDADE,
    });
  });

  it("idempotente: já concluída por outra pessoa devolve ok sem nova trilha", async () => {
    estado.responder = (op) =>
      op.tipo === "update"
        ? { data: [], error: null }
        : op.tipo === "select"
          ? { data: { status: "concluida" }, error: null }
          : { data: null, error: null };
    const resultado = await concluirAtividadeAction(ATIVIDADE);
    expect(resultado).toEqual({ ok: true, id: ATIVIDADE, jaEstava: true });
    expect(operacoes("audit_log", "insert")).toEqual([]);
  });
});

describe("cancelarAtividadeAction", () => {
  it("concluída não se cancela: pede para reabrir", async () => {
    estado.responder = (op) =>
      op.tipo === "update"
        ? { data: [], error: null }
        : op.tipo === "select"
          ? { data: { status: "concluida" }, error: null }
          : { data: null, error: null };
    const resultado = await cancelarAtividadeAction(ATIVIDADE);
    expect(resultado).toEqual({
      ok: false,
      error: "Esta atividade já foi concluída. Reabra antes de cancelar.",
    });
  });
});

describe("adiarAtividadeAction", () => {
  it("conta de hoje na clínica e mantém a hora local", async () => {
    estado.responder = (op) =>
      op.tipo === "select"
        ? {
            data: { due_at: "2026-09-20T12:15:00.000Z", status: "pendente" },
            error: null,
          }
        : op.tipo === "update"
          ? { data: [{ id: ATIVIDADE }], error: null }
          : { data: null, error: null };
    const resultado = await adiarAtividadeAction({ id: ATIVIDADE, dias: 7 });
    expect(resultado).toEqual({ ok: true, id: ATIVIDADE });
    const [update] = operacoes("contact_activity", "update");
    expect(update!.valores).toEqual({
      due_on: "2026-10-09",
      due_at: "2026-10-09T12:15:00.000Z",
    });
    expect(operacoes("audit_log", "insert")[0]!.valores).toMatchObject({
      action: "editou_atividade",
    });
  });

  it("só 1, 7 ou 30 dias", async () => {
    const resultado = await adiarAtividadeAction({ id: ATIVIDADE, dias: 3 });
    expect(resultado.ok).toBe(false);
    expect(estado.ops).toEqual([]);
  });
});

describe("listarAtividadesAction", () => {
  it("grava a trilha de leitura (atividades) antes de devolver a lista", async () => {
    sessao.active.role = "leitura";
    estado.responder = () => ({ data: [], error: null });
    const resultado = await listarAtividadesAction();
    expect(resultado).toEqual({
      ok: true,
      lista: { atividades: [], cortada: false },
    });
    expect(leituras).toEqual([
      {
        clinicId: CLINICA,
        userId: "usuario-da-sessao",
        entity: "atividades",
      },
    ]);
  });

  it("erro de leitura não vira lista vazia", async () => {
    estado.responder = () => ({
      data: null,
      error: { code: "XX000", message: "falhou" },
    });
    const resultado = await listarAtividadesAction();
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível carregar as atividades.",
    });
  });
});
