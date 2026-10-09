import { beforeEach, describe, expect, it, vi } from "vitest";

import { CENARIOS_DO_SIMULADOR } from "@/components/agente/textos";
import { TEXTO_FIXO_DO_AGENTE } from "@/lib/agente/prompt";
import {
  configPadraoDoAgente,
  expedientePadrao,
  habilidadesEfetivas,
  TEXTO_DAS_INSTRUCOES_A_AJUSTAR,
  type ConfigDoAgente,
} from "@/lib/domain/agente/config";

// Server Actions da Tela 6 (app/(app)/agente/actions.ts) contra um banco
// falso com a forma do cliente do Supabase:
//   - guarda em toda acao: sessao, clinica da fase controlada e papel
//     (administrador ou gestor, ou super admin); recepcao recebe a dica;
//   - texto da clinica passa pelo filtro ANTES de qualquer escrita;
//   - toda escrita de configuracao garante o rascunho e grava no rascunho
//     pela sessao; a trilha nunca leva texto;
//   - publicar roda o filtro em tudo (instrucoes inclusive) e so entao chama
//     publicar_agente pela service role com o autor da sessao;
//   - o simulador delega ao lib/agente/simulador (aqui um falso).

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const FORA_DA_FASE = "11111111-2222-4333-8444-555555555555";
const USUARIO = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const RASCUNHO = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const ITEM = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const NOVO = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const VERSAO_2 = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const CONFERIDO_EM = "2026-10-06T19:00:00.123456+00:00";

// --- banco falso ------------------------------------------------------------

type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update" | "delete";
  dados?: unknown;
  colunas?: string;
  opcoes?: unknown;
  filtros: [string, string, unknown][];
};
type Resposta = { data?: unknown; error?: unknown; count?: number };

class Banco {
  operacoes: Operacao[] = [];
  rpcs: { nome: string; args: unknown }[] = [];
  /** RPCs e operacoes na ordem em que aconteceram. */
  sequencia: string[] = [];
  respostaDoRpc: Record<string, Resposta> = {};
  /** Respostas em fila por RPC (a primeira chamada leva a primeira). */
  filaDoRpc: Record<string, Resposta[]> = {};
  skills: unknown = {};
  ativas = 0;
  itemExiste = true;
  item: { question: string; answer: string } | null = {
    question: "Tem estacionamento?",
    answer: "Sim, ao lado.",
  };
  rascunhoAtualizado = true;

  responder(op: Operacao): Resposta {
    if (op.tabela === "audit_log") {
      return { error: null };
    }
    if (op.tabela === "ai_agent_config") {
      if (op.tipo === "select" && op.colunas === "id") {
        return { data: { id: VERSAO_2 }, error: null };
      }
      if (op.tipo === "update") {
        return {
          data: this.rascunhoAtualizado ? [{ id: RASCUNHO }] : [],
          error: null,
        };
      }
      return { data: { skills: this.skills }, error: null };
    }
    if (op.tabela === "knowledge_item") {
      if (op.tipo === "select" && op.colunas === "id") {
        return { count: this.ativas, error: null };
      }
      if (op.tipo === "select") {
        return { data: this.item, error: null };
      }
      if (op.tipo === "insert") {
        return { data: { id: NOVO }, error: null };
      }
      return { data: this.itemExiste ? [{ id: ITEM }] : [], error: null };
    }
    return { data: null, error: { code: "42P01" } };
  }

  escritas(): Operacao[] {
    return this.operacoes.filter(
      (op) => op.tipo !== "select" && op.tabela !== "audit_log",
    );
  }

  trilha(): Operacao[] {
    return this.operacoes.filter((op) => op.tabela === "audit_log");
  }

  cliente() {
    const from = (tabela: string) => {
      const op: Operacao = { tabela, tipo: "select", filtros: [] };
      const resolver = () => {
        this.operacoes.push(op);
        this.sequencia.push(`${op.tabela}:${op.tipo}`);
        return Promise.resolve(this.responder(op));
      };
      const consulta = {
        select: (colunas: string, opcoes?: unknown) => {
          if (op.tipo === "select") {
            op.colunas = colunas;
            op.opcoes = opcoes;
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
        delete: () => {
          op.tipo = "delete";
          return consulta;
        },
        eq: (coluna: string, valor: unknown) => {
          op.filtros.push(["eq", coluna, valor]);
          return consulta;
        },
        neq: (coluna: string, valor: unknown) => {
          op.filtros.push(["neq", coluna, valor]);
          return consulta;
        },
        single: resolver,
        maybeSingle: resolver,
        then: (
          ok: (valor: Resposta) => unknown,
          falha: (erro: unknown) => unknown,
        ) => resolver().then(ok, falha),
      };
      return consulta;
    };
    const rpc = async (nome: string, args: unknown) => {
      this.rpcs.push({ nome, args });
      this.sequencia.push(`rpc:${nome}`);
      const daFila = this.filaDoRpc[nome]?.shift();
      if (daFila) {
        return daFila;
      }
      return (
        this.respostaDoRpc[nome] ?? {
          data: nome === "garantir_rascunho_do_agente" ? RASCUNHO : null,
          error: null,
        }
      );
    };
    return { from, rpc };
  }
}

let banco = new Banco();
let admin = new Banco();

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

let contexto: {
  config: ConfigDoAgente;
  rascunhoId: string | null;
  publicada: ConfigDoAgente | null;
  conferidoEm: string | null;
};

const simularTurno = vi.fn();

vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => admin.cliente(),
}));
vi.mock("@/lib/agente/contexto", () => ({
  carregarConfigDoRascunho: async () => contexto,
  carregarCatalogoDoAgente: async () => ({
    procedimentos: [],
    vinculos: [],
    convenios: [],
    conveniosDoCadastro: [],
  }),
}));
vi.mock("@/lib/agente/simulador", () => ({
  simularTurno: (...args: unknown[]) => simularTurno(...args),
}));

const acoes = await import("@/app/(app)/agente/actions");

const PERSONA = {
  nome: "Ana",
  tom: "cordial",
  usarEmoji: false,
  saudacao: "Olá! Aqui é a Ana.",
  encerramento: null,
};

function config(extra: Partial<ConfigDoAgente> = {}): ConfigDoAgente {
  return { ...configPadraoDoAgente(), ...extra };
}

beforeEach(() => {
  banco = new Banco();
  admin = new Banco();
  admin.respostaDoRpc.publicar_agente = { data: { versao: 3 }, error: null };
  entrar("gestor");
  contexto = {
    config: config({ nome: "Ana" }),
    rascunhoId: RASCUNHO,
    publicada: null,
    conferidoEm: CONFERIDO_EM,
  };
  simularTurno.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// ---------------------------------------------------------------------------

describe("guarda de toda ação", () => {
  const chamadas: [string, () => Promise<{ ok: boolean }>][] = [
    ["persona", () => acoes.salvarPersonaAction(PERSONA)],
    ["habilidades", () => acoes.salvarHabilidadesAction({})],
    [
      "horario",
      () =>
        acoes.salvarHorarioAction({
          modo: "24h",
          minutosSemResposta: 5,
          expediente: expedientePadrao(),
        }),
    ],
    [
      "item",
      () =>
        acoes.salvarItemDaBaseAction({
          id: null,
          pergunta: "Tem estacionamento?",
          resposta: "Sim.",
          ativo: true,
        }),
    ],
    ["ativar", () => acoes.ativarItemDaBaseAction({ id: ITEM, ativo: false })],
    ["excluir", () => acoes.excluirItemDaBaseAction({ id: ITEM })],
    [
      "instrucoes",
      () => acoes.salvarInstrucoesAction({ instrucoes: "Seja breve." }),
    ],
    ["publicar", () => acoes.publicarAgenteAction()],
    ["restaurar", () => acoes.restaurarVersaoAction({ versao: 1 })],
    [
      "simular",
      () =>
        acoes.simularAction({
          mensagens: [{ autor: "paciente", texto: "Oi" }],
          cenario: null,
        }),
    ],
    ["previa", () => acoes.previaDoPromptAction()],
  ];

  it.each(chamadas)(
    "%s: sem sessão, fora da fase ou sem papel, nada toca o banco",
    async (_nome, chamar) => {
      sessao = null;
      expect(await chamar()).toEqual({
        ok: false,
        error: "Sessão expirada. Entre de novo.",
      });

      entrar("admin", { clinicId: FORA_DA_FASE });
      expect(await chamar()).toEqual({
        ok: false,
        error: "O assistente de IA ainda não está disponível nesta clínica.",
      });

      for (const papel of ["recepcao", "profissional", "leitura"] as const) {
        entrar(papel);
        expect(await chamar()).toEqual({
          ok: false,
          error: "Somente administradores e gestores alteram o agente de IA",
        });
      }
      expect(banco.operacoes).toEqual([]);
      expect(banco.rpcs).toEqual([]);
      expect(admin.rpcs).toEqual([]);
      expect(simularTurno).not.toHaveBeenCalled();
    },
  );

  it("super admin passa mesmo com outro papel na clínica", async () => {
    entrar("recepcao", { superAdmin: true });
    expect(await acoes.salvarPersonaAction(PERSONA)).toEqual({ ok: true });
  });
});

describe("persona, habilidades e horário", () => {
  it("salva a persona no rascunho garantido, com trilha sem texto", async () => {
    expect(await acoes.salvarPersonaAction(PERSONA)).toEqual({ ok: true });
    expect(banco.rpcs).toEqual([
      { nome: "garantir_rascunho_do_agente", args: { p_clinic_id: CLINICA } },
    ]);
    const [escrita] = banco.escritas();
    expect(escrita).toMatchObject({
      tabela: "ai_agent_config",
      tipo: "update",
      dados: {
        agent_name: "Ana",
        tone: "cordial",
        use_emoji: false,
        greeting: "Olá! Aqui é a Ana.",
        closing: null,
      },
    });
    expect(escrita?.filtros).toEqual([
      ["eq", "id", RASCUNHO],
      ["eq", "clinic_id", CLINICA],
      ["eq", "status", "rascunho"],
    ]);
    const [trilha] = banco.trilha();
    expect(trilha?.dados).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "editou_persona_do_agente",
      entity: "ai_agent_config",
      entity_id: RASCUNHO,
    });
  });

  it("recusa antes de escrever o que o filtro barraria, dizendo o campo", async () => {
    const r = await acoes.salvarPersonaAction({
      ...PERSONA,
      saudacao: "Olá! Ligue (85) 99999-8888.",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.startsWith("Saudação. ")).toBe(true);
      expect(r.error).toContain("telefone");
    }
    const titulo = await acoes.salvarPersonaAction({
      ...PERSONA,
      nome: "Doutora Ana",
    });
    expect(titulo.ok).toBe(false);
    expect(banco.operacoes).toEqual([]);
    expect(banco.rpcs).toEqual([]);
  });

  it("entrada inválida: a mensagem do formulário ou dados inválidos", async () => {
    expect(await acoes.salvarPersonaAction({ ...PERSONA, nome: "" })).toEqual({
      ok: false,
      error: "Dê um nome ao assistente.",
    });
    expect(await acoes.salvarPersonaAction("qualquer")).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
  });

  it("rascunho publicado no meio (zero linhas) e erros do banco viram texto de recepção", async () => {
    banco.rascunhoAtualizado = false;
    expect(await acoes.salvarPersonaAction(PERSONA)).toEqual({
      ok: false,
      error:
        "O agente de IA foi alterado ao mesmo tempo por outra pessoa. Recarregue a página e tente de novo.",
    });

    banco = new Banco();
    banco.respostaDoRpc.garantir_rascunho_do_agente = {
      data: null,
      error: { code: "42501" },
    };
    expect(await acoes.salvarPersonaAction(PERSONA)).toEqual({
      ok: false,
      error: "Somente administradores e gestores alteram o agente de IA",
    });
    banco.respostaDoRpc.garantir_rascunho_do_agente = {
      data: null,
      error: { code: "CZ409" },
    };
    expect((await acoes.salvarPersonaAction(PERSONA)).ok).toBe(false);
    expect(banco.escritas()).toEqual([]);
  });

  it("habilidades: junta com o que está gravado (chave do E4 não se perde) e trava as obrigatórias", async () => {
    banco.skills = { agendar: true, informar_preco_e_convenio: true };
    expect(
      await acoes.salvarHabilidadesAction({
        informar_preco_e_convenio: false,
        passar_para_equipe: false,
        inventada: true,
      }),
    ).toEqual({ ok: true });
    const [escrita] = banco.escritas();
    expect(escrita?.dados).toEqual({
      skills: {
        agendar: true,
        ...habilidadesEfetivas({ informar_preco_e_convenio: false }),
      },
    });
    expect(
      (escrita?.dados as { skills: Record<string, boolean> }).skills
        .passar_para_equipe,
    ).toBe(true);
    expect(
      await acoes.salvarHabilidadesAction({ informar_preco_e_convenio: "sim" }),
    ).toMatchObject({ ok: false });
  });

  it("horário: grava modo, minutos e expediente; fim antes do início é recusado", async () => {
    const expediente = expedientePadrao();
    expect(
      await acoes.salvarHorarioAction({
        modo: "fora_expediente",
        minutosSemResposta: 10,
        expediente,
      }),
    ).toEqual({ ok: true });
    expect(banco.escritas()[0]?.dados).toEqual({
      operating_mode: "fora_expediente",
      fallback_minutes: 10,
      operating_hours: expediente,
    });
    const r = await acoes.salvarHorarioAction({
      modo: "fora_expediente",
      minutosSemResposta: 10,
      expediente: {
        ...expediente,
        seg: { aberto: true, inicio: "18:00", fim: "08:00" },
      },
    });
    expect(r).toEqual({
      ok: false,
      error: "Segunda-feira: o fim do expediente precisa ser depois do início.",
    });
  });
});

describe("base de conhecimento", () => {
  it("cria a pergunta ativa pela sessão e devolve o id", async () => {
    const r = await acoes.salvarItemDaBaseAction({
      id: null,
      pergunta: "Tem estacionamento?",
      resposta: "Sim, na rua ao lado.",
      ativo: true,
    });
    expect(r).toEqual({ ok: true, id: NOVO });
    // Garante antes e de novo depois da escrita (achado 19).
    expect(banco.sequencia).toEqual([
      "knowledge_item:select",
      "rpc:garantir_rascunho_do_agente",
      "knowledge_item:insert",
      "rpc:garantir_rascunho_do_agente",
      "audit_log:insert",
    ]);
    expect(banco.escritas()[0]).toMatchObject({
      tabela: "knowledge_item",
      tipo: "insert",
      dados: {
        clinic_id: CLINICA,
        question: "Tem estacionamento?",
        answer: "Sim, na rua ao lado.",
        source: "manual",
        active: true,
      },
    });
    expect(banco.trilha()[0]?.dados).toMatchObject({
      action: "criou_item_da_base",
      entity: "knowledge_item",
      entity_id: NOVO,
    });
  });

  it("recusa resposta com preço, telefone ou link antes de escrever", async () => {
    for (const resposta of [
      "A consulta custa R$ 200,00.",
      "Ligue (85) 99999-8888.",
      "Veja em www.clinica.com.br",
    ]) {
      const r = await acoes.salvarItemDaBaseAction({
        id: null,
        pergunta: "Como faço?",
        resposta,
        ativo: true,
      });
      expect(r.ok, resposta).toBe(false);
      if (!r.ok) {
        expect(r.error.startsWith("Resposta. ")).toBe(true);
      }
    }
    expect(banco.operacoes).toEqual([]);
  });

  it("teto de 60 ativas: recusa ativa nova, aceita inativa; a edição não conta a si mesma", async () => {
    banco.ativas = 60;
    expect(
      await acoes.salvarItemDaBaseAction({
        id: null,
        pergunta: "Tem estacionamento?",
        resposta: "Sim.",
        ativo: true,
      }),
    ).toEqual({
      ok: false,
      error:
        "A base já tem 60 perguntas ativas. Desative ou exclua uma antes de ativar outra.",
    });
    expect(
      await acoes.salvarItemDaBaseAction({
        id: null,
        pergunta: "Tem estacionamento?",
        resposta: "Sim.",
        ativo: false,
      }),
    ).toEqual({ ok: true, id: NOVO });

    banco = new Banco();
    banco.ativas = 59;
    expect(
      await acoes.salvarItemDaBaseAction({
        id: ITEM,
        pergunta: "Tem estacionamento?",
        resposta: "Sim.",
        ativo: true,
      }),
    ).toEqual({ ok: true, id: ITEM });
    const contagem = banco.operacoes.find(
      (op) => op.tabela === "knowledge_item" && op.colunas === "id",
    );
    expect(contagem?.filtros).toContainEqual(["neq", "id", ITEM]);
    expect(banco.escritas()[0]?.filtros).toEqual([
      ["eq", "id", ITEM],
      ["eq", "clinic_id", CLINICA],
    ]);
  });

  it("editar ou excluir pergunta que sumiu avisa para recarregar", async () => {
    banco.itemExiste = false;
    const aviso = {
      ok: false,
      error: "Esta pergunta não existe mais. Recarregue a página.",
    };
    expect(
      await acoes.salvarItemDaBaseAction({
        id: ITEM,
        pergunta: "Tem estacionamento?",
        resposta: "Sim.",
        ativo: false,
      }),
    ).toEqual(aviso);
    expect(await acoes.excluirItemDaBaseAction({ id: ITEM })).toEqual(aviso);
  });

  it("ativar confere o texto de novo; desativar não precisa", async () => {
    banco.item = { question: "Qual o valor?", answer: "É R$ 150,00." };
    const r = await acoes.ativarItemDaBaseAction({ id: ITEM, ativo: true });
    expect(r.ok).toBe(false);
    expect(banco.escritas()).toEqual([]);

    expect(
      await acoes.ativarItemDaBaseAction({ id: ITEM, ativo: false }),
    ).toEqual({ ok: true });
    expect(banco.escritas()[0]).toMatchObject({
      tabela: "knowledge_item",
      tipo: "update",
      dados: { active: false },
    });
    expect(banco.trilha().at(-1)?.dados).toMatchObject({
      action: "desativou_item_da_base",
      entity_id: ITEM,
    });
  });

  it("ativar, desativar e excluir garantem o rascunho antes e de novo depois da escrita (achado 19)", async () => {
    expect(
      await acoes.ativarItemDaBaseAction({ id: ITEM, ativo: false }),
    ).toEqual({ ok: true });
    expect(banco.sequencia).toEqual([
      "rpc:garantir_rascunho_do_agente",
      "knowledge_item:update",
      "rpc:garantir_rascunho_do_agente",
      "audit_log:insert",
    ]);
    banco = new Banco();
    expect(await acoes.excluirItemDaBaseAction({ id: ITEM })).toEqual({
      ok: true,
    });
    expect(banco.sequencia).toEqual([
      "rpc:garantir_rascunho_do_agente",
      "knowledge_item:delete",
      "rpc:garantir_rascunho_do_agente",
      "audit_log:insert",
    ]);
    // O garantir de depois que falha nao desfaz a escrita feita: so log.
    const escrito: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
      escrito.push(String(linha));
      return true;
    });
    banco = new Banco();
    banco.filaDoRpc.garantir_rascunho_do_agente = [
      { data: RASCUNHO, error: null },
      { data: null, error: { code: "CZ409" } },
    ];
    expect(
      await acoes.salvarItemDaBaseAction({
        id: ITEM,
        pergunta: "Tem estacionamento?",
        resposta: "Sim.",
        ativo: false,
      }),
    ).toEqual({ ok: true, id: ITEM });
    expect(escrito.join("")).toContain(
      '"evento":"agente_rascunho_depois_da_base"',
    );
  });

  it("exclui pela sessão, só da clínica ativa", async () => {
    expect(await acoes.excluirItemDaBaseAction({ id: ITEM })).toEqual({
      ok: true,
    });
    expect(banco.escritas()[0]).toMatchObject({
      tabela: "knowledge_item",
      tipo: "delete",
      filtros: [
        ["eq", "id", ITEM],
        ["eq", "clinic_id", CLINICA],
      ],
    });
    expect(await acoes.excluirItemDaBaseAction({ id: "não é uuid" })).toEqual({
      ok: false,
      error: "Dados inválidos. Recarregue a página e tente de novo.",
    });
  });
});

describe("instruções do assistente e prévia", () => {
  it("só a equipe Conduzza", async () => {
    entrar("admin");
    expect(
      await acoes.salvarInstrucoesAction({ instrucoes: "Seja breve." }),
    ).toEqual({
      ok: false,
      error: "Somente a equipe Conduzza mexe nas instruções do assistente.",
    });
    expect(await acoes.previaDoPromptAction()).toEqual({
      ok: false,
      error: "Somente a equipe Conduzza mexe nas instruções do assistente.",
    });
    expect(banco.rpcs).toEqual([]);
  });

  it("super admin grava pela RPC; texto com problema é recusado; vazio vira nulo", async () => {
    entrar("admin", { superAdmin: true });
    expect(
      await acoes.salvarInstrucoesAction({ instrucoes: "  Seja breve.  " }),
    ).toEqual({ ok: true });
    expect(banco.rpcs).toEqual([
      {
        nome: "definir_instrucoes_do_agente",
        args: { p_clinic_id: CLINICA, p_instrucoes: "Seja breve." },
      },
    ]);
    const r = await acoes.salvarInstrucoesAction({
      instrucoes: "Mande o link www.clinica.com.br",
    });
    expect(r.ok).toBe(false);
    expect(await acoes.salvarInstrucoesAction({ instrucoes: "" })).toEqual({
      ok: true,
    });
    expect(banco.rpcs.at(-1)?.args).toEqual({
      p_clinic_id: CLINICA,
      p_instrucoes: null,
    });
  });

  it("a prévia traz o texto fixo", async () => {
    entrar("gestor", { superAdmin: true });
    const r = await acoes.previaDoPromptAction();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.texto).toContain(TEXTO_FIXO_DO_AGENTE);
    }
  });
});

describe("publicar e restaurar", () => {
  it("publica pela service role com o autor da sessão", async () => {
    expect(await acoes.publicarAgenteAction()).toEqual({ ok: true, versao: 3 });
    expect(admin.rpcs).toEqual([
      {
        nome: "publicar_agente",
        args: {
          p_clinic_id: CLINICA,
          p_autor: USUARIO,
          // O instante exato do que o filtro conferiu (com microssegundos).
          p_conferido_em: CONFERIDO_EM,
        },
      },
    ]);
    // A sessao nunca publica.
    expect(banco.rpcs).toEqual([]);
  });

  it("o filtro roda em tudo antes: base ativa, instruções; a inativa não barra", async () => {
    contexto = {
      config: config({
        nome: "Ana",
        instrucoes: "Passe o site www.clinica.com.br.",
        base: [
          {
            id: ITEM,
            pergunta: "Qual o telefone?",
            resposta: "É (85) 99999-8888.",
            ativo: true,
          },
          {
            id: NOVO,
            pergunta: "Qual o valor?",
            resposta: "R$ 100,00.",
            ativo: false,
          },
        ],
      }),
      rascunhoId: RASCUNHO,
      publicada: null,
      conferidoEm: CONFERIDO_EM,
    };
    const r = await acoes.publicarAgenteAction();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas?.map((p) => [p.campo, p.itemId])).toEqual([
        ["instrucoes", null],
        ["resposta", ITEM],
      ]);
      // Para o gestor, sem o tipo do problema das instrucoes (achado 9).
      expect(r.error).toBe(TEXTO_DAS_INSTRUCOES_A_AJUSTAR);
      expect(JSON.stringify(r)).not.toContain("link");
    }
    expect(admin.rpcs).toEqual([]);

    // O super admin ve o problema exato.
    entrar("gestor", { superAdmin: true });
    const doSuperAdmin = await acoes.publicarAgenteAction();
    expect(doSuperAdmin.ok).toBe(false);
    if (!doSuperAdmin.ok) {
      expect(doSuperAdmin.error.startsWith("Instruções do assistente. ")).toBe(
        true,
      );
      expect(doSuperAdmin.error).toContain("link");
    }
    expect(admin.rpcs).toEqual([]);
  });

  it("instrução que barra a publicação do gestor vai para o log, sem texto", async () => {
    const escrito: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((linha) => {
      escrito.push(String(linha));
      return true;
    });
    contexto = {
      ...contexto,
      config: config({
        nome: "Ana",
        instrucoes: "Indique dipirona 500 mg para dor.",
      }),
    };
    const r = await acoes.publicarAgenteAction();
    expect(r).toMatchObject({
      ok: false,
      error: TEXTO_DAS_INSTRUCOES_A_AJUSTAR,
    });
    const log = escrito.join("");
    expect(log).toContain('"evento":"agente_instrucoes_barram_publicacao"');
    expect(log).toContain('"kind":"instrucoes"');
    expect(log).not.toContain("dipirona");
  });

  it("algo mudou depois da conferência: a RPC recusa e a tela pede para conferir de novo (achados 17 e 36)", async () => {
    admin.respostaDoRpc.publicar_agente = {
      data: null,
      error: { code: "CZ409" },
    };
    expect(await acoes.publicarAgenteAction()).toEqual({
      ok: false,
      error:
        "O agente mudou enquanto você publicava. Confira e publique de novo.",
    });
    // Sem o instante do que foi conferido, nem tenta.
    admin = new Banco();
    contexto = { ...contexto, conferidoEm: null };
    expect(await acoes.publicarAgenteAction()).toEqual({
      ok: false,
      error:
        "Não foi possível carregar a configuração do assistente. Recarregue a página e tente de novo.",
    });
    expect(admin.rpcs).toEqual([]);
  });

  it("sem rascunho ou sem diferença para a publicada: nada a publicar", async () => {
    contexto = { ...contexto, rascunhoId: null };
    const nada = {
      ok: false,
      error: "Não há alterações para publicar.",
    };
    expect(await acoes.publicarAgenteAction()).toEqual(nada);

    const igual = config({ nome: "Ana" });
    contexto = {
      config: igual,
      rascunhoId: RASCUNHO,
      publicada: { ...igual, status: "publicada", versao: 2 },
      conferidoEm: CONFERIDO_EM,
    };
    expect(await acoes.publicarAgenteAction()).toEqual(nada);

    contexto = { ...contexto, publicada: null };
    admin.respostaDoRpc.publicar_agente = {
      data: null,
      error: { code: "P0002" },
    };
    expect(await acoes.publicarAgenteAction()).toEqual(nada);
  });

  it("restaurar chama a RPC pela sessão; versão inexistente vira aviso", async () => {
    expect(await acoes.restaurarVersaoAction({ versao: 2 })).toEqual({
      ok: true,
    });
    expect(banco.rpcs).toEqual([
      {
        nome: "restaurar_versao_do_agente",
        args: { p_clinic_id: CLINICA, p_versao: 2 },
      },
    ]);
    // A trilha leva qual versao voltou (achado 25), sem texto.
    const leitura = banco.operacoes.find(
      (op) => op.tabela === "ai_agent_config" && op.tipo === "select",
    );
    expect(leitura?.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "status", "publicada"],
      ["eq", "version", 2],
    ]);
    expect(banco.trilha().at(-1)?.dados).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "versao_restaurada_do_agente",
      entity: "ai_agent_config",
      entity_id: VERSAO_2,
    });
    banco.respostaDoRpc.restaurar_versao_do_agente = {
      data: null,
      error: { code: "P0002" },
    };
    expect(await acoes.restaurarVersaoAction({ versao: 9 })).toEqual({
      ok: false,
      error: "Versão não encontrada. Recarregue a página.",
    });
    for (const versao of [0, -1, 1.5, "2"]) {
      expect((await acoes.restaurarVersaoAction({ versao })).ok).toBe(false);
    }
  });
});

describe("simulador", () => {
  const ASSINATURA = `v1.2.${"a".repeat(64)}`;
  const OK = {
    ok: true,
    resposta: "Temos sim.",
    tipo: "resposta",
    trilha: [],
    rascunhoBloqueado: null,
    assinatura: ASSINATURA,
  };

  it("delega ao simulador com a clínica, quem testa e o fuso, e grava a trilha sem texto", async () => {
    simularTurno.mockResolvedValue(OK);
    const mensagens = [
      { autor: "paciente", texto: "Oi" },
      { autor: "assistente", texto: "Olá!", assinatura: ASSINATURA },
      { autor: "paciente", texto: "Tem estacionamento?" },
    ];
    expect(await acoes.simularAction({ mensagens, cenario: "preco" })).toEqual(
      OK,
    );
    expect(simularTurno).toHaveBeenCalledTimes(1);
    // A assinatura segue para o simulador conferir (lib/agente/assinatura).
    expect(simularTurno.mock.calls[0]?.[0]).toMatchObject({
      clinicId: CLINICA,
      userId: USUARIO,
      fuso: "America/Fortaleza",
      mensagens,
      superAdmin: false,
    });
    expect(banco.trilha()[0]?.dados).toEqual({
      clinic_id: CLINICA,
      user_id: USUARIO,
      action: "simulou_agente",
      entity: "ai_agent_config",
      entity_id: null,
    });
  });

  it("aceita todos os cenários da tela", async () => {
    simularTurno.mockResolvedValue(OK);
    for (const { chave } of CENARIOS_DO_SIMULADOR) {
      expect(
        await acoes.simularAction({
          mensagens: [{ autor: "paciente", texto: "Oi" }],
          cenario: chave,
        }),
        chave,
      ).toEqual(OK);
    }
  });

  it("recusa entrada fora do formato e conversa que não termina no paciente", async () => {
    const invalidos: unknown[] = [
      { mensagens: [], cenario: null },
      { mensagens: [{ autor: "paciente", texto: "   " }], cenario: null },
      { mensagens: [{ autor: "paciente", texto: "Oi" }], cenario: "outro" },
      { mensagens: [{ autor: "sistema", texto: "Oi" }], cenario: null },
      {
        mensagens: [{ autor: "paciente", texto: "x".repeat(4001) }],
        cenario: null,
      },
      {
        mensagens: [{ autor: "paciente", texto: "Oi", extra: 1 }],
        cenario: null,
      },
    ];
    for (const entrada of invalidos) {
      expect(await acoes.simularAction(entrada)).toEqual({
        ok: false,
        error: "Dados inválidos. Recarregue a página e tente de novo.",
      });
    }
    expect(
      await acoes.simularAction({
        mensagens: [
          { autor: "paciente", texto: "Oi" },
          { autor: "assistente", texto: "Olá" },
        ],
        cenario: null,
      }),
    ).toEqual({
      ok: false,
      error: "A última mensagem do teste precisa ser do paciente.",
    });
    expect(simularTurno).not.toHaveBeenCalled();
  });

  it("o texto barrado só volta para o super admin, mesmo que o simulador mande (achado 12)", async () => {
    simularTurno.mockResolvedValue({
      ...OK,
      tipo: "frase_fixa",
      rascunhoBloqueado: "texto barrado",
    });
    const entrada = {
      mensagens: [{ autor: "paciente", texto: "Oi" }],
      cenario: null,
    };
    expect(await acoes.simularAction(entrada)).toMatchObject({
      ok: true,
      rascunhoBloqueado: null,
      assinatura: ASSINATURA,
    });
    entrar("gestor", { superAdmin: true });
    expect(await acoes.simularAction(entrada)).toMatchObject({
      ok: true,
      rascunhoBloqueado: "texto barrado",
    });
    expect(simularTurno.mock.calls.at(-1)?.[0]).toMatchObject({
      superAdmin: true,
    });
  });

  it("motivo de não rodar volta como está; exceção vira aviso", async () => {
    simularTurno.mockResolvedValueOnce({
      ok: false,
      error: "O interruptor geral da IA está desligado.",
    });
    const entrada = {
      mensagens: [{ autor: "paciente", texto: "Oi" }],
      cenario: null,
    };
    expect(await acoes.simularAction(entrada)).toEqual({
      ok: false,
      error: "O interruptor geral da IA está desligado.",
    });
    expect(banco.trilha()).toEqual([]);
    simularTurno.mockRejectedValueOnce(new Error("rede"));
    expect(await acoes.simularAction(entrada)).toEqual({
      ok: false,
      error: "Não foi possível testar agora. Tente de novo.",
    });
  });
});
