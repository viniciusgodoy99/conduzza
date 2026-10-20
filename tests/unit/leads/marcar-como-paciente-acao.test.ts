import { beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria } from "../ia-whatsapp/banco-em-memoria";

// "Marcar como paciente" (decisao do dono em 20/10/2026): a Server Action de
// verdade (app/(app)/leads/actions.ts), com a sessao e o cliente do Supabase
// trocados por um banco em memoria que imita o PostgREST nos filtros. Prova:
// o papel (so quem edita leads), o Zod (ids e o teto do lote), que so LEAD
// muda (paciente fica como esta, e a etapa nunca muda), o recorte da clinica
// ativa e a trilha sem dado de paciente. A policy de verdade (a sessao de
// outra clinica e os papeis sem escrita) esta em tests/rls/leads.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const OUTRA_CLINICA = "c2222222-2222-4222-8222-222222222222";
const USUARIO = "a0000000-0000-4000-8000-000000000001";
const LEAD_1 = "10000000-0000-4000-8000-000000000001";
const LEAD_2 = "10000000-0000-4000-8000-000000000002";
const PACIENTE = "10000000-0000-4000-8000-000000000003";
const LEAD_DE_FORA = "10000000-0000-4000-8000-000000000004";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  sessao: null as unknown,
  revalidados: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => estado.sessao,
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => {
    estado.revalidados.push(caminho);
  },
}));

const { marcarComoPacienteAction } = await import("@/app/(app)/leads/actions");

let banco: BancoEmMemoria;

function sessao(papel: string) {
  return {
    userId: USUARIO,
    userName: "Ana Recepção",
    active: {
      clinicId: CLINICA,
      role: papel,
      status: "ativo",
      timezone: "America/Fortaleza",
    },
  };
}

function contato(
  id: string,
  kind: "lead" | "paciente",
  funnelStage: string,
  clinicId = CLINICA,
) {
  return {
    id,
    clinic_id: clinicId,
    name: `Contato ${id.slice(-1)}`,
    phone_e164: `+558599990000${id.slice(-1)}`,
    kind,
    funnel_stage: funnelStage,
  };
}

function kindDe(id: string): unknown {
  return banco.linhas("contact").find((linha) => linha.id === id)?.kind;
}

function etapaDe(id: string): unknown {
  return banco.linhas("contact").find((linha) => linha.id === id)?.funnel_stage;
}

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.sessao = sessao("recepcao");
  estado.revalidados = [];
  banco
    .linhas("contact")
    .push(
      contato(LEAD_1, "lead", "novo"),
      contato(LEAD_2, "lead", "em_contato"),
      contato(PACIENTE, "paciente", "compareceu"),
      contato(LEAD_DE_FORA, "lead", "novo", OUTRA_CLINICA),
    );
});

describe("marcarComoPacienteAction: papel", () => {
  it.each(["admin", "gestor", "recepcao"])("%s marca", async (papel) => {
    estado.sessao = sessao(papel);
    const resultado = await marcarComoPacienteAction({
      contact_ids: [LEAD_1],
    });
    expect(resultado).toEqual({ ok: true, marcados: 1 });
    expect(kindDe(LEAD_1)).toBe("paciente");
  });

  it.each([
    ["profissional", "Seu perfil não pode editar leads e pacientes"],
    ["leitura", "Seu perfil não pode editar leads e pacientes"],
  ])(
    "%s é recusado com a dica do projeto, sem tocar no banco",
    async (papel, dica) => {
      estado.sessao = sessao(papel);
      const resultado = await marcarComoPacienteAction({
        contact_ids: [LEAD_1],
      });
      expect(resultado).toEqual({ ok: false, error: dica });
      expect(banco.operacoes).toHaveLength(0);
      expect(kindDe(LEAD_1)).toBe("lead");
    },
  );

  it("sessão expirada não grava nada", async () => {
    estado.sessao = null;
    const resultado = await marcarComoPacienteAction({
      contact_ids: [LEAD_1],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    expect(banco.operacoes).toHaveLength(0);
  });
});

describe("marcarComoPacienteAction: Zod", () => {
  it.each([
    ["sem ids", { contact_ids: [] }],
    ["id que não é uuid", { contact_ids: ["nao-e-uuid"] }],
    ["formato errado", { ids: [LEAD_1] }],
    ["nada", undefined],
  ])("%s é recusado sem tocar no banco", async (_caso, entrada) => {
    const resultado = await marcarComoPacienteAction(entrada);
    expect(resultado).toEqual({
      ok: false,
      error: "Contatos inválidos. Atualize a página e tente de novo.",
    });
    expect(banco.operacoes).toHaveLength(0);
  });

  it("acima de 100 ids diz o teto do lote (a tela divide em lotes de 100)", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const resultado = await marcarComoPacienteAction({ contact_ids: ids });
    expect(resultado).toEqual({
      ok: false,
      error: "Selecione até 100 leads por vez.",
    });
    expect(banco.operacoes).toHaveLength(0);
  });
});

describe("marcarComoPacienteAction: só lead muda, a etapa nunca", () => {
  it("leads viram paciente; quem já é paciente fica como está e não conta", async () => {
    const resultado = await marcarComoPacienteAction({
      contact_ids: [LEAD_1, LEAD_2, PACIENTE],
    });
    expect(resultado).toEqual({ ok: true, marcados: 2 });
    expect(kindDe(LEAD_1)).toBe("paciente");
    expect(kindDe(LEAD_2)).toBe("paciente");
    expect(kindDe(PACIENTE)).toBe("paciente");
    // A etapa de todos continua onde estava (mover geraria conversao falsa).
    expect(etapaDe(LEAD_1)).toBe("novo");
    expect(etapaDe(LEAD_2)).toBe("em_contato");
    expect(etapaDe(PACIENTE)).toBe("compareceu");
    // O update grava SO o kind.
    const update = banco.operacoes.find(
      (op) => op.tabela === "contact" && op.operacao === "update",
    );
    expect(update?.valores).toEqual({ kind: "paciente" });
  });

  it("todos já pacientes: ok com zero, sem trilha e sem revalidar", async () => {
    const resultado = await marcarComoPacienteAction({
      contact_ids: [PACIENTE],
    });
    expect(resultado).toEqual({ ok: true, marcados: 0 });
    expect(banco.linhas("audit_log")).toHaveLength(0);
    expect(estado.revalidados).toEqual([]);
  });

  it("falha do banco vira frase de recepção, sem trilha", async () => {
    banco.erros.set("contact:update", { code: "57014" });
    const resultado = await marcarComoPacienteAction({
      contact_ids: [LEAD_1],
    });
    expect(resultado).toEqual({
      ok: false,
      error: "Não foi possível marcar como paciente.",
    });
    expect(banco.linhas("audit_log")).toHaveLength(0);
  });
});

describe("marcarComoPacienteAction: clínica ativa", () => {
  it("contato de outra clínica não muda, mesmo com o id na lista", async () => {
    const resultado = await marcarComoPacienteAction({
      contact_ids: [LEAD_1, LEAD_DE_FORA],
    });
    expect(resultado).toEqual({ ok: true, marcados: 1 });
    expect(kindDe(LEAD_1)).toBe("paciente");
    expect(kindDe(LEAD_DE_FORA)).toBe("lead");
  });

  it("só o id de fora: nada muda", async () => {
    const resultado = await marcarComoPacienteAction({
      contact_ids: [LEAD_DE_FORA],
    });
    expect(resultado).toEqual({ ok: true, marcados: 0 });
    expect(kindDe(LEAD_DE_FORA)).toBe("lead");
  });
});

describe("marcarComoPacienteAction: trilha", () => {
  it("um contato: o id em entity_id e a quantidade em detalhes", async () => {
    await marcarComoPacienteAction({ contact_ids: [LEAD_1] });
    expect(banco.linhas("audit_log")).toEqual([
      expect.objectContaining({
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "marcou_como_paciente",
        entity: "contact",
        entity_id: LEAD_1,
        detalhes: { quantidade: 1 },
      }),
    ]);
    expect(estado.revalidados).toEqual(["/leads", "/pacientes"]);
  });

  it("em massa: sem id, só quantos mudaram, e nada de dado de paciente", async () => {
    await marcarComoPacienteAction({
      contact_ids: [LEAD_1, LEAD_2, PACIENTE],
    });
    const [linha] = banco.linhas("audit_log");
    expect(linha).toMatchObject({
      action: "marcou_como_paciente",
      entity: "contact",
      entity_id: null,
      detalhes: { quantidade: 2 },
    });
    const texto = JSON.stringify(linha);
    expect(texto).not.toContain("+55859999");
    expect(texto).not.toContain("Contato");
  });
});
