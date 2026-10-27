import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Action da Tela 6 na AG4 (app/(app)/agente/actions.ts), contra um
// banco falso com a forma do cliente do Supabase: salvarPrazosAction grava
// as duas colunas dos prazos da IA (cancelar_antecedencia_horas e
// remarcar_antecedencia_horas; decisao D-24 pela recomendacao, pendente do
// dono) no rascunho garantido, pelo mesmo caminho de permissao das outras
// partes (administrador, gestor ou super admin; a recepcao recebe a dica),
// com o Zod estrito na entrada (inteiro de 0 a 720, ou vazio) e a trilha sem
// o valor. A trava das habilidades pelos prazos mora em
// acoes-agenda-do-agente.test.ts.

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
  filtros: [string, unknown][];
};

class Banco {
  operacoes: Operacao[] = [];
  rpcs: { nome: string; args: unknown }[] = [];
  rascunhoAtualizado = true;
  erroNoUpdate: { code: string } | null = null;

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
      if (this.erroNoUpdate) {
        return { data: null, error: this.erroNoUpdate };
      }
      return {
        data: this.rascunhoAtualizado ? [{ id: RASCUNHO }] : [],
        error: null,
      };
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
        select: () => consulta,
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
        data:
          nome === "garantir_rascunho_do_agente"
            ? RASCUNHO
            : // A lista das clinicas com o agente habilitado, lida pela
              // guarda com a service role: so a CLINICA.
              nome === "ia_clinicas_da_fase_controlada"
              ? [CLINICA]
              : null,
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

const ENTRADA = { cancelarHoras: 24, remarcarHoras: 48 };

beforeEach(() => {
  banco = new Banco();
  entrar("gestor");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

describe("prazos para cancelar e remarcar (salvarPrazosAction)", () => {
  it("sem sessão, fora da fase ou sem papel, nada toca o banco", async () => {
    sessao = null;
    expect(await acoes.salvarPrazosAction(ENTRADA)).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    entrar("admin", { clinicId: FORA_DA_FASE });
    expect(await acoes.salvarPrazosAction(ENTRADA)).toEqual({
      ok: false,
      error: "O assistente de IA ainda não está disponível nesta clínica.",
    });
    for (const papel of ["recepcao", "profissional", "leitura"] as const) {
      entrar(papel);
      expect(await acoes.salvarPrazosAction(ENTRADA), papel).toEqual({
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
      expect(await acoes.salvarPrazosAction(ENTRADA), papel).toEqual({
        ok: true,
      });
      expect(banco.rpcs).toEqual([
        { nome: "garantir_rascunho_do_agente", args: { p_clinic_id: CLINICA } },
      ]);
      const [escrita, ...outras] = banco.escritas();
      expect(outras).toEqual([]);
      expect(escrita).toMatchObject({
        tabela: "ai_agent_config",
        tipo: "update",
        dados: {
          cancelar_antecedencia_horas: 24,
          remarcar_antecedencia_horas: 48,
        },
      });
      // So o rascunho da clinica da sessao (a policy confere de novo).
      expect(escrita?.filtros).toEqual([
        ["id", RASCUNHO],
        ["clinic_id", CLINICA],
        ["status", "rascunho"],
      ]);
    }
  });

  it("vazio grava nulo (ninguém inventa valor), e as pontas da faixa passam", async () => {
    for (const entrada of [
      { cancelarHoras: null, remarcarHoras: null },
      { cancelarHoras: 0, remarcarHoras: 720 },
    ]) {
      banco = new Banco();
      expect(
        await acoes.salvarPrazosAction(entrada),
        JSON.stringify(entrada),
      ).toEqual({ ok: true });
      expect(banco.escritas()[0]?.dados).toEqual({
        cancelar_antecedencia_horas: entrada.cancelarHoras,
        remarcar_antecedencia_horas: entrada.remarcarHoras,
      });
    }
  });

  it("a trilha diz só a ação e o rascunho, sem valor nenhum", async () => {
    await acoes.salvarPrazosAction(ENTRADA);
    expect(banco.trilha().map((op) => op.dados)).toEqual([
      {
        clinic_id: CLINICA,
        user_id: USUARIO,
        action: "editou_prazos_do_agente",
        entity: "ai_agent_config",
        entity_id: RASCUNHO,
      },
    ]);
  });

  it("fora da faixa: a mensagem do campo, antes de escrever", async () => {
    for (const entrada of [
      { cancelarHoras: 721, remarcarHoras: 48 },
      { cancelarHoras: 24, remarcarHoras: -1 },
    ]) {
      expect(
        await acoes.salvarPrazosAction(entrada),
        JSON.stringify(entrada),
      ).toEqual({
        ok: false,
        error: "Use um número inteiro de 0 a 720 horas.",
      });
    }
    // Quebrado so chega de um cliente forjado (a tela recusa com a mensagem
    // do campo): o servidor recusa com o texto geral, como nos limites.
    expect(
      await acoes.salvarPrazosAction({ cancelarHoras: 1.5, remarcarHoras: 48 }),
    ).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("entrada fora do formato (o Zod estrito): recusa antes de escrever", async () => {
    for (const entrada of [
      {},
      { cancelarHoras: 24 },
      { ...ENTRADA, agendaHoras: 2 },
      null,
      "24",
    ]) {
      expect(
        (await acoes.salvarPrazosAction(entrada)).ok,
        JSON.stringify(entrada),
      ).toBe(false);
    }
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("rascunho publicado no meio (zero linhas): pede para recarregar", async () => {
    banco.rascunhoAtualizado = false;
    expect(await acoes.salvarPrazosAction(ENTRADA)).toEqual({
      ok: false,
      error:
        "O agente de IA foi alterado ao mesmo tempo por outra pessoa. Recarregue a página e tente de novo.",
    });
  });

  it("o banco recusa (sem o grant da coluna, antes da migration ou a publicada): o erro de sempre, e o log sem valor", async () => {
    const escrito: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
      escrito.push(String(linha));
      return true;
    });
    banco.erroNoUpdate = { code: "42501" };
    expect(await acoes.salvarPrazosAction(ENTRADA)).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram o agente de IA",
    });
    banco = new Banco();
    banco.erroNoUpdate = { code: "42703" };
    expect(await acoes.salvarPrazosAction(ENTRADA)).toEqual({
      ok: false,
      error: "Não foi possível salvar. Tente de novo.",
    });
    banco = new Banco();
    banco.erroNoUpdate = { code: "P0001" };
    expect(await acoes.salvarPrazosAction(ENTRADA)).toEqual({
      ok: false,
      error: "Esta versão já foi publicada e não muda. Recarregue a página.",
    });
    const log = escrito.join("");
    expect(log).toContain('"kind":"prazos"');
    expect(log).not.toMatch(/cancelarHoras|antecedencia_horas|"24"|48/);
  });
});
