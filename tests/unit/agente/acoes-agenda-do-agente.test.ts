import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DICA_DA_AGENDA_INCOMPLETA,
  habilidadesEfetivas,
} from "@/lib/domain/agente/config";

// Server Actions da Tela 6 no E4 (app/(app)/agente/actions.ts), contra um
// banco falso com a forma do cliente do Supabase:
//   - salvarAgendaAction grava as duas colunas da agenda (antecedencia e
//     horizonte, D13) no rascunho garantido, pelo mesmo caminho de permissao
//     das outras partes, com a trilha sem texto; vazio grava nulo; fora da
//     faixa do CHECK e recusado antes de qualquer escrita;
//   - salvarHabilidadesAction le a agenda do PROPRIO rascunho e recusa ligar
//     "Agendar consulta" sem os dois valores, com a dica da tela (o cliente
//     nao e confiavel).
// Os outros casos das acoes da Tela 6 moram em acoes-agente.test.ts.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const FORA_DA_FASE = "11111111-2222-4333-8444-555555555555";
const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const RASCUNHO = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";

type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update";
  dados?: unknown;
  colunas?: string;
  filtros: [string, unknown][];
};

class Banco {
  operacoes: Operacao[] = [];
  rpcs: { nome: string; args: unknown }[] = [];
  /** A linha do rascunho como o select das habilidades le. */
  rascunho: Record<string, unknown> = {
    skills: {},
    agenda_antecedencia_horas: null,
    agenda_horizonte_dias: null,
  };
  rascunhoAtualizado = true;

  escritas(): Operacao[] {
    return this.operacoes.filter(
      (op) => op.tipo !== "select" && op.tabela !== "audit_log",
    );
  }

  trilha(): Operacao[] {
    return this.operacoes.filter((op) => op.tabela === "audit_log");
  }

  responder(op: Operacao): { data: unknown; error: unknown } {
    if (op.tabela === "audit_log") {
      return { data: null, error: null };
    }
    if (op.tabela === "ai_agent_config" && op.tipo === "update") {
      return {
        data: this.rascunhoAtualizado ? [{ id: RASCUNHO }] : [],
        error: null,
      };
    }
    if (op.tabela === "ai_agent_config") {
      return { data: this.rascunho, error: null };
    }
    return { data: null, error: { code: "42P01" } };
  }

  cliente() {
    const from = (tabela: string) => {
      const op: Operacao = { tabela, tipo: "select", filtros: [] };
      const resolver = () => {
        this.operacoes.push(op);
        return Promise.resolve(this.responder(op));
      };
      const consulta = {
        select: (colunas: string) => {
          if (op.tipo === "select") {
            op.colunas = colunas;
          }
          return consulta;
        },
        insert: (dados: unknown) => {
          op.tipo = "insert";
          op.dados = dados;
          return consulta;
        },
        update: (dados: unknown) => {
          op.tipo = "update";
          op.dados = dados;
          return consulta;
        },
        eq: (coluna: string, valor: unknown) => {
          op.filtros.push([coluna, valor]);
          return consulta;
        },
        maybeSingle: resolver,
        then: (
          ok: (valor: { data: unknown; error: unknown }) => unknown,
          falha: (erro: unknown) => unknown,
        ) => resolver().then(ok, falha),
      };
      return consulta;
    };
    const rpc = async (nome: string, args: unknown) => {
      this.rpcs.push({ nome, args });
      return {
        data: nome === "garantir_rascunho_do_agente" ? RASCUNHO : null,
        error: null,
      };
    };
    return { from, rpc };
  }
}

let banco = new Banco();

type Papel = "admin" | "gestor" | "recepcao" | "profissional" | "leitura";
let sessao: {
  userId: string;
  isProductAdmin: boolean;
  active: { clinicId: string; timezone: string; role: Papel } | null;
} | null = null;

function entrar(
  role: Papel,
  extra: { superAdmin?: boolean; clinicId?: string } = {},
) {
  sessao = {
    userId: USUARIO,
    isProductAdmin: extra.superAdmin ?? false,
    active: {
      clinicId: extra.clinicId ?? CLINICA,
      timezone: "America/Fortaleza",
      role,
    },
  };
}

vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => new Banco().cliente(),
}));
vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigDoRascunho: vi.fn(),
  carregarCatalogoDoAgente: vi.fn(),
}));
vi.mock("@/lib/agente/simulador", () => ({ simularTurno: vi.fn() }));

const acoes = await import("@/app/(app)/agente/actions");

beforeEach(() => {
  banco = new Banco();
  entrar("gestor");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// ---------------------------------------------------------------------------

describe("limites para marcar consulta (salvarAgendaAction)", () => {
  it("sem sessão, fora da fase ou sem papel, nada toca o banco", async () => {
    const entrada = { antecedenciaHoras: 2, horizonteDias: 30 };
    sessao = null;
    expect(await acoes.salvarAgendaAction(entrada)).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    entrar("admin", { clinicId: FORA_DA_FASE });
    expect(await acoes.salvarAgendaAction(entrada)).toEqual({
      ok: false,
      error: "O assistente de IA ainda não está disponível nesta clínica.",
    });
    for (const papel of ["recepcao", "profissional", "leitura"] as const) {
      entrar(papel);
      expect(await acoes.salvarAgendaAction(entrada)).toEqual({
        ok: false,
        error: "Somente administradores e gestores alteram o agente de IA",
      });
    }
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("administrador, gestor e super admin gravam as duas colunas no rascunho garantido", async () => {
    for (const [papel, superAdmin] of [
      ["admin", false],
      ["gestor", false],
      ["recepcao", true],
    ] as const) {
      banco = new Banco();
      entrar(papel, { superAdmin });
      expect(
        await acoes.salvarAgendaAction({
          antecedenciaHoras: 2,
          horizonteDias: 30,
        }),
        papel,
      ).toEqual({ ok: true });
      expect(banco.rpcs).toEqual([
        { nome: "garantir_rascunho_do_agente", args: { p_clinic_id: CLINICA } },
      ]);
      const [escrita] = banco.escritas();
      expect(escrita).toMatchObject({
        tabela: "ai_agent_config",
        tipo: "update",
        dados: { agenda_antecedencia_horas: 2, agenda_horizonte_dias: 30 },
      });
      expect(escrita?.filtros).toEqual([
        ["id", RASCUNHO],
        ["clinic_id", CLINICA],
        ["status", "rascunho"],
      ]);
    }
  });

  it("a trilha diz só a ação e o rascunho, sem valor nenhum", async () => {
    await acoes.salvarAgendaAction({ antecedenciaHoras: 0, horizonteDias: 1 });
    expect(banco.trilha().map((op) => op.dados)).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "editou_agenda_do_agente",
        entity: "ai_agent_config",
        entity_id: RASCUNHO,
      },
    ]);
  });

  it("vazio grava nulo (ninguém inventa valor)", async () => {
    expect(
      await acoes.salvarAgendaAction({
        antecedenciaHoras: null,
        horizonteDias: null,
      }),
    ).toEqual({ ok: true });
    expect(banco.escritas()[0]?.dados).toEqual({
      agenda_antecedencia_horas: null,
      agenda_horizonte_dias: null,
    });
  });

  it("fora da faixa do CHECK, quebrado ou fora do formato: recusa antes de escrever", async () => {
    expect(
      await acoes.salvarAgendaAction({
        antecedenciaHoras: 721,
        horizonteDias: 30,
      }),
    ).toEqual({ ok: false, error: "Use um número inteiro de 0 a 720 horas." });
    expect(
      await acoes.salvarAgendaAction({
        antecedenciaHoras: 2,
        horizonteDias: 0,
      }),
    ).toEqual({ ok: false, error: "Use um número inteiro de 1 a 365 dias." });
    for (const entrada of [
      { antecedenciaHoras: 1.5, horizonteDias: 30 },
      { antecedenciaHoras: "2", horizonteDias: 30 },
      { antecedenciaHoras: 2 },
      "qualquer",
    ]) {
      expect(
        (await acoes.salvarAgendaAction(entrada)).ok,
        JSON.stringify(entrada),
      ).toBe(false);
    }
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("rascunho publicado no meio (zero linhas): pede para recarregar", async () => {
    banco.rascunhoAtualizado = false;
    expect(
      await acoes.salvarAgendaAction({
        antecedenciaHoras: 2,
        horizonteDias: 30,
      }),
    ).toEqual({
      ok: false,
      error:
        "O agente de IA foi alterado ao mesmo tempo por outra pessoa. Recarregue a página e tente de novo.",
    });
  });
});

describe("Agendar consulta só liga com a agenda do rascunho (salvarHabilidadesAction)", () => {
  it("sem a antecedência ou o horizonte no rascunho, ligar é recusado com a dica da tela", async () => {
    for (const agenda of [
      { agenda_antecedencia_horas: null, agenda_horizonte_dias: null },
      { agenda_antecedencia_horas: 2, agenda_horizonte_dias: null },
      { agenda_antecedencia_horas: null, agenda_horizonte_dias: 30 },
    ]) {
      banco = new Banco();
      banco.rascunho = { skills: {}, ...agenda };
      expect(
        await acoes.salvarHabilidadesAction({
          ...habilidadesEfetivas({}),
          agendar: true,
        }),
        JSON.stringify(agenda),
      ).toEqual({ ok: false, error: DICA_DA_AGENDA_INCOMPLETA });
      expect(banco.escritas()).toEqual([]);
    }
  });

  it("a agenda é lida do próprio rascunho, junto com o skills", async () => {
    banco.rascunho = {
      skills: {},
      agenda_antecedencia_horas: 2,
      agenda_horizonte_dias: 30,
    };
    await acoes.salvarHabilidadesAction({ agendar: true });
    const leitura = banco.operacoes.find(
      (op) => op.tabela === "ai_agent_config" && op.tipo === "select",
    );
    expect(leitura?.colunas).toBe(
      "skills, agenda_antecedencia_horas, agenda_horizonte_dias",
    );
    expect(leitura?.filtros).toEqual([
      ["id", RASCUNHO],
      ["clinic_id", CLINICA],
    ]);
  });

  it("com os dois preenchidos, liga e grava junto do que já estava", async () => {
    banco.rascunho = {
      skills: { remarcar: true },
      agenda_antecedencia_horas: 2,
      agenda_horizonte_dias: 30,
    };
    expect(
      await acoes.salvarHabilidadesAction({
        ...habilidadesEfetivas({}),
        agendar: true,
        confirmar_presenca: true,
      }),
    ).toEqual({ ok: true });
    const skills = (
      banco.escritas()[0]?.dados as { skills: Record<string, boolean> }
    ).skills;
    expect(skills).toMatchObject({
      remarcar: true,
      agendar: true,
      confirmar_presenca: true,
      informar_preco_e_convenio: true,
    });
  });

  it("desligar (ou mexer em outra) sem a agenda continua valendo", async () => {
    expect(
      await acoes.salvarHabilidadesAction({
        ...habilidadesEfetivas({}),
        agendar: false,
        confirmar_presenca: true,
      }),
    ).toEqual({ ok: true });
    expect(
      (banco.escritas()[0]?.dados as { skills: Record<string, boolean> })
        .skills,
    ).toMatchObject({ agendar: false, confirmar_presenca: true });
  });

  it("formato errado é recusado antes de tocar o banco", async () => {
    expect((await acoes.salvarHabilidadesAction({ agendar: "sim" })).ok).toBe(
      false,
    );
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });
});
