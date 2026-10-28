import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Action da Tela 6 na AG6a (app/(app)/agente/actions.ts), contra um
// banco falso com a forma do cliente do Supabase: salvarPassagemAction grava
// para quem vai a conversa que a IA passa (escalation_rules.passagem_para; a
// fila ou o responsavel do lead; D-15, e D-55 pela recomendacao, pendente do
// dono) no rascunho garantido, PRESERVANDO as outras chaves do jsonb (o
// aviso do SAMU da AG6c, chaves de versoes futuras) lidas do proprio
// rascunho, pelo mesmo caminho de permissao das outras partes
// (administrador, gestor ou super admin; a recepcao recebe a dica), com o
// Zod estrito na entrada e a trilha sem o valor.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const FORA_DA_FASE = "11111111-2222-4333-8444-555555555555";
const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const RASCUNHO = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";

type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update";
  colunas?: string;
  dados?: unknown;
  filtros: [string, unknown][];
};

class Banco {
  operacoes: Operacao[] = [];
  rpcs: { nome: string; args: unknown }[] = [];
  regrasGravadas: unknown = { aviso_de_urgencia: true, chave_futura: 7 };
  erroNaLeitura: { code: string } | null = null;
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
    if (op.tabela === "ai_agent_config" && op.tipo === "select") {
      return this.erroNaLeitura
        ? { data: null, error: this.erroNaLeitura }
        : { data: { escalation_rules: this.regrasGravadas }, error: null };
    }
    if (op.tabela === "ai_agent_config" && op.tipo === "update") {
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
        select: (colunas?: string) => {
          if (op.tipo === "select" && colunas) {
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
        data:
          nome === "garantir_rascunho_do_agente"
            ? RASCUNHO
            : nome === "ia_clinicas_da_fase_controlada"
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
const { acoesDoAgente } = await import("@/components/agente/acoes");

beforeEach(() => {
  banco = new Banco();
  entrar("gestor");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

describe("para quem vai a conversa (salvarPassagemAction)", () => {
  it("sem sessão, fora da fase ou sem papel, nada toca o banco", async () => {
    const entrada = { passagemPara: "responsavel_do_lead" };
    sessao = null;
    expect(await acoes.salvarPassagemAction(entrada)).toEqual({
      ok: false,
      error: "Sessão expirada. Entre de novo.",
    });
    entrar("admin", { clinicId: FORA_DA_FASE });
    expect(await acoes.salvarPassagemAction(entrada)).toEqual({
      ok: false,
      error: "O assistente de IA ainda não está disponível nesta clínica.",
    });
    for (const papel of ["recepcao", "profissional", "leitura"] as const) {
      entrar(papel);
      expect(await acoes.salvarPassagemAction(entrada), papel).toEqual({
        ok: false,
        error: "Somente administradores e gestores alteram o agente de IA",
      });
    }
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("administrador, gestor e super admin gravam a regra sem perder as outras chaves", async () => {
    for (const [papel, superAdmin] of [
      ["admin", false],
      ["gestor", false],
      ["recepcao", true],
    ] as const) {
      banco = new Banco();
      entrar(papel, { superAdmin });
      expect(
        await acoes.salvarPassagemAction({
          passagemPara: "responsavel_do_lead",
        }),
        papel,
      ).toEqual({ ok: true });
      // Le o jsonb do PROPRIO rascunho, preso a clinica.
      const leitura = banco.operacoes.find(
        (op) => op.tabela === "ai_agent_config" && op.tipo === "select",
      );
      expect(leitura?.colunas).toBe("escalation_rules");
      expect(leitura?.filtros).toEqual([
        ["id", RASCUNHO],
        ["clinic_id", CLINICA],
      ]);
      const [escrita, ...outras] = banco.escritas();
      expect(outras).toEqual([]);
      expect(escrita).toEqual({
        tabela: "ai_agent_config",
        tipo: "update",
        dados: {
          escalation_rules: {
            aviso_de_urgencia: true,
            chave_futura: 7,
            passagem_para: "responsavel_do_lead",
          },
        },
        filtros: [
          ["id", RASCUNHO],
          ["clinic_id", CLINICA],
          ["status", "rascunho"],
        ],
      });
    }
  });

  it("voltar para a fila grava a fila; jsonb fora do formato vira só a regra", async () => {
    banco.regrasGravadas = null;
    expect(await acoes.salvarPassagemAction({ passagemPara: "fila" })).toEqual({
      ok: true,
    });
    expect(banco.escritas()[0]?.dados).toEqual({
      escalation_rules: { passagem_para: "fila" },
    });
  });

  it("a trilha diz o que foi editado, sem o valor", async () => {
    await acoes.salvarPassagemAction({ passagemPara: "responsavel_do_lead" });
    expect(banco.trilha()).toHaveLength(1);
    const linha = banco.trilha()[0]?.dados as Record<string, unknown>;
    expect(linha).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "editou_passagem_do_agente",
      entity: "ai_agent_config",
      entity_id: RASCUNHO,
    });
    expect(JSON.stringify(linha)).not.toContain("responsavel_do_lead");
  });

  it("entrada fora do formato: a mensagem do Zod da configuração, sem tocar o banco", async () => {
    expect(
      await acoes.salvarPassagemAction({ passagemPara: "a_recepcao" }),
    ).toEqual({ ok: false, error: "Escolha para quem vai a conversa." });
    for (const entrada of [
      {},
      null,
      "fila",
      { passagemPara: "fila", avisoDeUrgencia: true },
      { passagemPara: "fila", escalation_rules: {} },
    ]) {
      expect(
        (await acoes.salvarPassagemAction(entrada)).ok,
        JSON.stringify(entrada),
      ).toBe(false);
    }
    expect(banco.escritas()).toEqual([]);
  });

  it("leitura que falha ou rascunho publicado no meio: o erro de sempre, sem gravar", async () => {
    banco.erroNaLeitura = { code: "42501" };
    expect(await acoes.salvarPassagemAction({ passagemPara: "fila" })).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram o agente de IA",
    });
    expect(banco.escritas()).toEqual([]);
    banco = new Banco();
    banco.erroNaLeitura = { code: "08006" };
    expect(await acoes.salvarPassagemAction({ passagemPara: "fila" })).toEqual({
      ok: false,
      error: "Não foi possível salvar. Tente de novo.",
    });
    banco = new Banco();
    banco.rascunhoAtualizado = false;
    expect(await acoes.salvarPassagemAction({ passagemPara: "fila" })).toEqual({
      ok: false,
      error:
        "O agente de IA foi alterado ao mesmo tempo por outra pessoa. Recarregue a página e tente de novo.",
    });
  });

  it("o painel chama a ação pelo contrato das ações da tela", async () => {
    expect(await acoesDoAgente.salvarPassagem("responsavel_do_lead")).toEqual({
      ok: true,
    });
    expect(banco.escritas()[0]?.dados).toMatchObject({
      escalation_rules: { passagem_para: "responsavel_do_lead" },
    });
    entrar("recepcao");
    expect(await acoesDoAgente.salvarPassagem("fila")).toEqual({
      ok: false,
      erro: "Somente administradores e gestores alteram o agente de IA",
    });
  });
});
