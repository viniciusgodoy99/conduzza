import { beforeEach, describe, expect, it, vi } from "vitest";

// Pacote com varios procedimentos (29/09/2026) nas Server Actions, contra um
// cliente do Supabase dublado: o que interessa aqui e O QUE a action manda
// para as RPCs (salvar_pacote, vender_pacote e a assinatura NOVA de
// ajustar_saldo_de_pacote), o que ela recusa antes de ir ao banco e como a
// resposta do banco vira mensagem. O comportamento do banco em si esta em
// tests/integration/pacote-com-varios-procedimentos.test.ts.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const BOTOX = "1b1b1b1b-0000-4000-8000-000000000001";
const FACELIFT = "1b1b1b1b-0000-4000-8000-000000000002";
const PACOTE = "2c2c2c2c-0000-4000-8000-000000000001";
const CONTATO = "3d3d3d3d-0000-4000-8000-000000000001";
const VENDA = "4e4e4e4e-0000-4000-8000-000000000001";
const ITEM = "5f5f5f5f-0000-4000-8000-000000000001";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };

const estado = {
  chamadas: [] as { fn: string; args: Linha }[],
  resposta: { data: null as unknown, error: null as Erro | null },
  auditoria: [] as Linha[],
  tabelas: {} as Record<string, Linha[]>,
};

function consulta(tabela: string) {
  const filtros: [string, unknown][] = [];
  const api = {
    select: () => api,
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return api;
    },
    maybeSingle: async () => ({
      data:
        (estado.tabelas[tabela] ?? []).find((linha) =>
          filtros.every(([coluna, valor]) => linha[coluna] === valor),
        ) ?? null,
      error: null,
    }),
    insert: async (linha: Linha) => {
      if (tabela === "audit_log") {
        estado.auditoria.push(linha);
      }
      return { data: null, error: null };
    },
  };
  return api;
}

const cliente = {
  rpc: async (fn: string, args: Linha) => {
    estado.chamadas.push({ fn, args });
    return estado.resposta;
  },
  from: (tabela: string) => consulta(tabela),
};

const sessao = {
  userId: "usuario-da-sessao",
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica A",
    slug: "clinica-a",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { salvarPacoteAction } = await import("@/app/(app)/cadastros/actions");
const { venderPacoteAction, ajustarSaldoDePacoteAction } =
  await import("@/app/(app)/pacientes/actions");

const PACOTE_VALIDO = {
  name: "Botox + Facelift",
  itens: [
    { procedure_id: BOTOX, sessions: 2 },
    { procedure_id: FACELIFT, sessions: 1 },
  ],
  price_cents: 560_000,
  validity_days: 90,
  active: true,
};

beforeEach(() => {
  estado.chamadas = [];
  estado.resposta = { data: null, error: null };
  estado.auditoria = [];
  estado.tabelas = {
    contact: [{ id: CONTATO, clinic_id: CLINICA }],
    package: [{ id: PACOTE, clinic_id: CLINICA }],
    package_balance: [{ id: VENDA, clinic_id: CLINICA, contact_id: CONTATO }],
  };
  sessao.active.role = "admin";
});

describe("salvarPacoteAction", () => {
  it("cria pela RPC salvar_pacote com os itens, na clínica ativa, e registra a trilha", async () => {
    estado.resposta = { data: PACOTE, error: null };
    const resultado = await salvarPacoteAction(PACOTE_VALIDO);
    expect(resultado).toEqual({ ok: true, id: PACOTE });
    expect(estado.chamadas).toEqual([
      {
        fn: "salvar_pacote",
        args: {
          p_clinic_id: CLINICA,
          p_name: "Botox + Facelift",
          p_itens: PACOTE_VALIDO.itens,
          p_price_cents: 560_000,
          p_validity_days: 90,
          p_active: true,
          p_package_id: null,
        },
      },
    ]);
    expect(estado.auditoria).toMatchObject([
      { action: "criou", entity: "package", entity_id: PACOTE },
    ]);
  });

  it("edição manda o id e registra como edição", async () => {
    estado.resposta = { data: PACOTE, error: null };
    await salvarPacoteAction({ ...PACOTE_VALIDO, id: PACOTE });
    expect(estado.chamadas[0]?.args.p_package_id).toBe(PACOTE);
    expect(estado.auditoria).toMatchObject([{ action: "editou" }]);
  });

  it("procedimento repetido ou lista vazia é recusado antes do banco", async () => {
    const repetido = await salvarPacoteAction({
      ...PACOTE_VALIDO,
      itens: [
        { procedure_id: BOTOX, sessions: 1 },
        { procedure_id: BOTOX, sessions: 2 },
      ],
    });
    expect(repetido).toEqual({
      ok: false,
      error: "O mesmo procedimento aparece duas vezes no pacote.",
    });
    const vazio = await salvarPacoteAction({ ...PACOTE_VALIDO, itens: [] });
    expect(vazio.ok).toBe(false);
    expect(estado.chamadas).toEqual([]);
  });

  it("o formato antigo (procedure_id e sessions soltos) não passa", async () => {
    const antigo = await salvarPacoteAction({
      procedure_id: BOTOX,
      sessions: 10,
      price_cents: 1,
      validity_days: null,
      active: true,
    });
    expect(antigo).toEqual({
      ok: false,
      error: "Confira os campos do pacote.",
    });
    expect(estado.chamadas).toEqual([]);
  });

  it("recepção não salva, e nada vai ao banco", async () => {
    sessao.active.role = "recepcao";
    const resultado = await salvarPacoteAction(PACOTE_VALIDO);
    expect(resultado).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram os cadastros.",
    });
    expect(estado.chamadas).toEqual([]);
  });

  it("a regra do banco (23514) vai para a tela como veio; a mensagem crua não", async () => {
    estado.resposta = {
      data: null,
      error: {
        code: "23514",
        message:
          "Este pacote já foi vendido. Os procedimentos e as sessões não mudam: para mudar, crie um pacote novo.",
      },
    };
    expect(await salvarPacoteAction({ ...PACOTE_VALIDO, id: PACOTE })).toEqual({
      ok: false,
      error:
        "Este pacote já foi vendido. Os procedimentos e as sessões não mudam: para mudar, crie um pacote novo.",
    });

    estado.resposta = {
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "package" violates check constraint "package_name_check"',
      },
    };
    expect(await salvarPacoteAction(PACOTE_VALIDO)).toEqual({
      ok: false,
      error: "Não foi possível salvar o pacote.",
    });

    estado.resposta = {
      data: null,
      error: {
        code: "23503",
        message: "O procedimento informado não pertence a esta clínica.",
      },
    };
    expect(await salvarPacoteAction(PACOTE_VALIDO)).toEqual({
      ok: false,
      error: "Um procedimento escolhido não é desta clínica.",
    });
    expect(estado.auditoria).toEqual([]);
  });
});

describe("venderPacoteAction", () => {
  it("vende pela RPC vender_pacote, com as sessões já usadas por procedimento", async () => {
    sessao.active.role = "recepcao";
    estado.resposta = { data: VENDA, error: null };
    const resultado = await venderPacoteAction({
      contact_id: CONTATO,
      package_id: PACOTE,
      usadas: [{ procedure_id: BOTOX, sessions_used: 1 }],
      inicio: "2026-09-01",
    });
    expect(resultado).toEqual({ ok: true });
    expect(estado.chamadas).toEqual([
      {
        fn: "vender_pacote",
        args: {
          p_contact_id: CONTATO,
          p_package_id: PACOTE,
          p_inicio: "2026-09-01",
          p_usadas: [{ procedure_id: BOTOX, sessions_used: 1 }],
        },
      },
    ]);
    expect(estado.auditoria).toMatchObject([
      { action: "vendeu_pacote", entity: "package_balance", entity_id: VENDA },
    ]);
  });

  it("venda de hoje manda início nulo e nenhuma sessão usada", async () => {
    estado.resposta = { data: VENDA, error: null };
    await venderPacoteAction({ contact_id: CONTATO, package_id: PACOTE });
    expect(estado.chamadas[0]?.args).toMatchObject({
      p_inicio: null,
      p_usadas: [],
    });
  });

  it("recusa antes do banco: procedimento repetido, início no futuro, pacote ou paciente de fora", async () => {
    const repetido = await venderPacoteAction({
      contact_id: CONTATO,
      package_id: PACOTE,
      usadas: [
        { procedure_id: BOTOX, sessions_used: 1 },
        { procedure_id: BOTOX, sessions_used: 0 },
      ],
    });
    expect(repetido.ok).toBe(false);
    const futuro = await venderPacoteAction({
      contact_id: CONTATO,
      package_id: PACOTE,
      inicio: "2999-01-01",
    });
    expect(futuro).toEqual({
      ok: false,
      error: "A data de início não pode ser depois de hoje.",
    });
    estado.tabelas.package = [];
    const semPacote = await venderPacoteAction({
      contact_id: CONTATO,
      package_id: PACOTE,
    });
    expect(semPacote).toEqual({ ok: false, error: "Pacote não encontrado." });
    estado.tabelas.contact = [];
    const semPaciente = await venderPacoteAction({
      contact_id: CONTATO,
      package_id: PACOTE,
    });
    expect(semPaciente).toEqual({
      ok: false,
      error: "Paciente não encontrado nesta clínica.",
    });
    expect(estado.chamadas).toEqual([]);
  });

  it("a regra do banco vira a mensagem da recepção", async () => {
    estado.resposta = {
      data: null,
      error: {
        code: "23514",
        message: "Um procedimento informado não faz parte deste pacote.",
      },
    };
    expect(
      await venderPacoteAction({ contact_id: CONTATO, package_id: PACOTE }),
    ).toEqual({
      ok: false,
      error: "Um procedimento informado não faz parte deste pacote.",
    });
    expect(estado.auditoria).toEqual([]);
  });
});

describe("ajustarSaldoDePacoteAction", () => {
  it("usa a assinatura nova, com os itens", async () => {
    sessao.active.role = "recepcao";
    const resultado = await ajustarSaldoDePacoteAction({
      balance_id: VENDA,
      itens: [{ item_id: ITEM, sessions_used: 1 }],
      expires_at: "2026-12-31",
      motivo: "Sessão feita antes do sistema",
    });
    expect(resultado).toEqual({ ok: true });
    expect(estado.chamadas).toEqual([
      {
        fn: "ajustar_saldo_de_pacote",
        args: {
          p_balance_id: VENDA,
          p_itens: [{ item_id: ITEM, sessions_used: 1 }],
          p_expires_at: "2026-12-31",
          p_reason: "Sessão feita antes do sistema",
        },
      },
    ]);
  });

  it("só a validade: lista de itens vazia", async () => {
    await ajustarSaldoDePacoteAction({
      balance_id: VENDA,
      expires_at: null,
      motivo: "Prorrogado pela gerência",
    });
    expect(estado.chamadas[0]?.args).toMatchObject({
      p_itens: [],
      p_expires_at: null,
    });
  });

  it("o mesmo item duas vezes é recusado antes do banco", async () => {
    const resultado = await ajustarSaldoDePacoteAction({
      balance_id: VENDA,
      itens: [
        { item_id: ITEM, sessions_used: 1 },
        { item_id: ITEM, sessions_used: 2 },
      ],
      expires_at: null,
      motivo: "Duplicado",
    });
    expect(resultado.ok).toBe(false);
    expect(estado.chamadas).toEqual([]);
  });
});
