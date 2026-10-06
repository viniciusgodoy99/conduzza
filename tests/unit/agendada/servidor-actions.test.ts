import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DICAS_DA_AGENDADA,
  ERROS_DA_AGENDADA,
} from "@/lib/domain/mensagem-agendada";

// Server Actions da mensagem agendada (app/(app)/atendimento/
// agendadas-actions.ts) contra um cliente do Supabase dublado: o que a action
// manda ao banco (clinica da sessao, contato e numero da CONVERSA, hora no
// fuso da clinica, nunca autoria nem situacao inicial), o que ela recusa
// antes (Somente leitura, Zod, conversa que nao esta com quem agenda, hora
// passada), a traducao dos erros (a recusa fixa do gatilho passa; o resto
// nunca chega a tela), as corridas e a trilha (entidade mensagem_agendada e
// o id, nunca o texto). O banco em si (RLS, gatilho, carimbos) fica nos
// testes de RLS e de integracao.

const CLINICA = "0a0a0a0a-0000-4000-8000-00000000000a";
const CONTATO = "3d3d3d3d-0000-4000-8000-000000000001";
const NUMERO = "4e4e4e4e-0000-4000-8000-000000000001";
const CONVERSA = "5f5f5f5f-0000-4000-8000-000000000001";
const AGENDADA = "6a6a6a6a-0000-4000-8000-000000000001";
const ANTIGA = "6a6a6a6a-0000-4000-8000-000000000002";
const EU = "7b7b7b7b-0000-4000-8000-000000000001";
const COLEGA = "7b7b7b7b-0000-4000-8000-000000000002";

const TEXTO = "Olá Maria, lembrando do seu retorno na quinta.";

// 06/10/2026 12:00 em Fortaleza (UTC-3).
const AGORA = new Date("2026-10-06T15:00:00.000Z").getTime();

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string; details?: string };
type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update";
  colunas?: string;
  valores?: unknown;
  filtros: [string, string, unknown][];
};
type Resposta = { data: unknown; error: Erro | null };

const estado = {
  ops: [] as Operacao[],
  rpcs: [] as { nome: string; args: Linha }[],
  responder: (op: Operacao): Resposta => {
    void op;
    return { data: null, error: null };
  },
  responderRpc: (nome: string, args: Linha): Resposta => {
    void nome;
    void args;
    return { data: null, error: null };
  },
};

function construtor(tabela: string) {
  const op: Operacao = { tabela, tipo: "select", filtros: [] };
  const resolver = async (): Promise<Resposta> => {
    estado.ops.push(op);
    return estado.responder(op);
  };
  const filtro = (operador: string) => (coluna: string, valor?: unknown) => {
    op.filtros.push([operador, coluna, valor]);
    return api;
  };
  const api = {
    select: (colunas?: string) => {
      if (op.tipo === "select") {
        op.colunas = colunas;
      }
      return api;
    },
    insert: (valores: unknown) => {
      op.tipo = "insert";
      op.valores = valores;
      return api;
    },
    update: (valores: unknown) => {
      op.tipo = "update";
      op.valores = valores;
      return api;
    },
    eq: filtro("eq"),
    in: filtro("in"),
    is: filtro("is"),
    or: (expressao: string) => {
      op.filtros.push(["or", expressao, null]);
      return api;
    },
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

const cliente = {
  from: (tabela: string) => construtor(tabela),
  rpc: async (nome: string, args: Linha) => {
    estado.rpcs.push({ nome, args });
    return estado.responderRpc(nome, args);
  },
};

const sessao = {
  userId: EU,
  active: {
    clinicId: CLINICA,
    timezone: "America/Fortaleza",
    role: "recepcao" as string,
    status: "ativo",
  },
};

const dubles = vi.hoisted(() => ({
  leituras: [] as Record<string, unknown>[],
  enviar: vi.fn(),
  listar: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente,
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("@/lib/auth/read-audit", () => ({
  auditarLeituraDePaciente: async (
    _cliente: unknown,
    params: Record<string, unknown>,
  ) => {
    dubles.leituras.push(params);
  },
}));
vi.mock("@/app/(app)/atendimento/actions", () => ({
  enviarComoAtendente: dubles.enviar,
}));
vi.mock("@/lib/queries/mensagens-agendadas", () => ({
  fetchMensagensAgendadas: dubles.listar,
}));

const {
  agendarMensagemAction,
  cancelarAgendadasDaPessoaAction,
  dispensarAgendadaAction,
  editarAgendadaAction,
  enviarAgendadaAgoraAction,
  excluirAgendadaAction,
  listarAgendadasAction,
} = await import("@/app/(app)/atendimento/agendadas-actions");

const CONVERSA_COMIGO = {
  id: CONVERSA,
  contact_id: CONTATO,
  status: "em_atendimento",
  assignee_user_id: EU,
  whatsapp_account_id: NUMERO,
};

function pedido(campos: Linha = {}) {
  return {
    id: AGENDADA,
    conversationId: CONVERSA,
    texto: `  ${TEXTO}  `,
    data: "2026-10-08",
    hora: "09:30",
    ...campos,
  };
}

function operacoes(tabela: string, tipo: Operacao["tipo"]) {
  return estado.ops.filter((op) => op.tabela === tabela && op.tipo === tipo);
}

function trilha() {
  return operacoes("audit_log", "insert").map((op) => op.valores);
}

/** Responde por tabela e tipo; o resto devolve vazio. */
function responderCom(
  mapa: Partial<Record<string, (op: Operacao) => Resposta>>,
) {
  estado.responder = (op) =>
    mapa[`${op.tabela}:${op.tipo}`]?.(op) ?? { data: null, error: null };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  estado.ops = [];
  estado.rpcs = [];
  responderCom({
    "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
  });
  estado.responderRpc = () => ({ data: null, error: null });
  sessao.active.role = "recepcao";
  dubles.leituras.length = 0;
  dubles.enviar.mockReset();
  dubles.listar.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agendarMensagemAction", () => {
  it("grava com a clínica da sessão, contato e número da conversa, hora no fuso da clínica e texto aparado", async () => {
    const resultado = await agendarMensagemAction(pedido());
    expect(resultado).toEqual({
      ok: true,
      enviarEm: "2026-10-08T12:30:00.000Z",
    });
    const [insercao] = operacoes("mensagem_agendada", "insert");
    expect(insercao!.valores).toEqual({
      id: AGENDADA,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: NUMERO,
      conversation_id: CONVERSA,
      texto: TEXTO,
      enviar_em: "2026-10-08T12:30:00.000Z",
    });
    // A conversa e lida presa a clinica ativa.
    const [leitura] = operacoes("conversation", "select");
    expect(leitura!.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
    expect(leitura!.filtros).toContainEqual(["eq", "id", CONVERSA]);
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: EU,
        action: "agendou_mensagem",
        entity: "mensagem_agendada",
        entity_id: AGENDADA,
      },
    ]);
  });

  it("contato e número do cliente são ignorados: valem os da conversa", async () => {
    await agendarMensagemAction(
      pedido({
        contactId: "99999999-0000-4000-8000-000000000001",
        whatsappAccountId: "99999999-0000-4000-8000-000000000002",
      }),
    );
    const [insercao] = operacoes("mensagem_agendada", "insert");
    expect(insercao!.valores).toMatchObject({
      contact_id: CONTATO,
      whatsapp_account_id: NUMERO,
    });
  });

  it("Somente leitura não agenda, nem chega ao banco", async () => {
    sessao.active.role = "leitura";
    expect(await agendarMensagemAction(pedido())).toEqual({
      ok: false,
      error: DICAS_DA_AGENDADA.soAcompanha,
    });
    expect(estado.ops).toEqual([]);
  });

  it("entrada fora do formato é recusada antes do banco", async () => {
    for (const entrada of [
      pedido({ id: "nao-e-uuid" }),
      pedido({ conversationId: 42 }),
      pedido({ substitui: "x" }),
      null,
      "texto",
    ]) {
      expect(await agendarMensagemAction(entrada)).toEqual({
        ok: false,
        error: ERROS_DA_AGENDADA.naoAgendou,
      });
    }
    expect(estado.ops).toEqual([]);
  });

  it("texto vazio, texto longo, hora passada e depois do teto: a frase do domínio, sem ir ao banco", async () => {
    expect(await agendarMensagemAction(pedido({ texto: "   " }))).toEqual({
      ok: false,
      error: ERROS_DA_AGENDADA.semTexto,
    });
    expect(
      await agendarMensagemAction(pedido({ texto: "a".repeat(4097) })),
    ).toEqual({ ok: false, error: ERROS_DA_AGENDADA.textoLongo(4097) });
    expect(
      await agendarMensagemAction(
        pedido({ data: "2026-10-06", hora: "11:59" }),
      ),
    ).toEqual({ ok: false, error: ERROS_DA_AGENDADA.horaPassada });
    expect(
      await agendarMensagemAction(
        pedido({ data: "2027-10-07", hora: "09:00" }),
      ),
    ).toEqual({
      ok: false,
      error: ERROS_DA_AGENDADA.depoisDoTeto("06/10/2027"),
    });
    expect(estado.ops).toEqual([]);
  });

  it("o tamanho conta em unidades UTF-16, a régua do envio 1:1 (emoji conta 2) (F16)", async () => {
    expect(
      (await agendarMensagemAction(pedido({ texto: `${"a".repeat(4094)}😀` })))
        .ok,
    ).toBe(true);
    // 4096 pontos de codigo (o CHECK do banco aceitaria), 4097 para o 1:1:
    // recusado antes do banco.
    expect(
      await agendarMensagemAction(pedido({ texto: `${"a".repeat(4095)}😀` })),
    ).toEqual({ ok: false, error: ERROS_DA_AGENDADA.textoLongo(4097) });
    expect(operacoes("mensagem_agendada", "insert")).toHaveLength(1);
  });

  it("conversa que não está com quem agenda: pede para assumir, sem inserir", async () => {
    for (const conversa of [
      { ...CONVERSA_COMIGO, assignee_user_id: COLEGA },
      {
        ...CONVERSA_COMIGO,
        status: "aguardando_humano",
        assignee_user_id: null,
      },
      { ...CONVERSA_COMIGO, status: "resolvida" },
    ]) {
      responderCom({
        "conversation:select": () => ({ data: conversa, error: null }),
      });
      expect(await agendarMensagemAction(pedido())).toEqual({
        ok: false,
        error: "Assuma a conversa antes de agendar.",
      });
    }
    expect(operacoes("mensagem_agendada", "insert")).toEqual([]);
  });

  it("conversa que a sessão não vê: indisponível", async () => {
    responderCom({
      "conversation:select": () => ({ data: null, error: null }),
    });
    expect(await agendarMensagemAction(pedido())).toEqual({
      ok: false,
      error: "Esta conversa não está mais disponível para você.",
    });
  });

  it("mensagem igual na mesma hora: a frase da duplicata", async () => {
    responderCom({
      "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
      "mensagem_agendada:insert": () => ({
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "mensagem_agendada_sem_duplicata"',
        },
      }),
    });
    expect(await agendarMensagemAction(pedido())).toEqual({
      ok: false,
      error: ERROS_DA_AGENDADA.duplicada,
    });
    expect(trilha()).toEqual([]);
  });

  it("duplo envio do diálogo (mesmo id): relê e devolve ok, sem trilha nova", async () => {
    responderCom({
      "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
      "mensagem_agendada:insert": () => ({
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "mensagem_agendada_pkey"',
        },
      }),
      "mensagem_agendada:select": () => ({
        data: {
          criada_por: EU,
          contact_id: CONTATO,
          enviar_em: "2026-10-08T12:30:00+00:00",
        },
        error: null,
      }),
    });
    expect(await agendarMensagemAction(pedido())).toEqual({
      ok: true,
      enviarEm: "2026-10-08T12:30:00+00:00",
    });
    expect(trilha()).toEqual([]);
  });

  it("mesmo id de outra pessoa ou de outro contato: erro genérico, sem dizer o que existe", async () => {
    for (const linha of [
      { criada_por: COLEGA, contact_id: CONTATO, enviar_em: "x" },
      {
        criada_por: EU,
        contact_id: "99999999-0000-4000-8000-000000000001",
        enviar_em: "x",
      },
      null,
    ]) {
      responderCom({
        "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
        "mensagem_agendada:insert": () => ({
          data: null,
          error: { code: "23505", message: "mensagem_agendada_pkey" },
        }),
        "mensagem_agendada:select": () => ({ data: linha, error: null }),
      });
      expect(await agendarMensagemAction(pedido())).toEqual({
        ok: false,
        error: ERROS_DA_AGENDADA.naoAgendou,
      });
    }
  });

  it("a recusa fixa do gatilho passa; qualquer outra mensagem do banco nunca chega à tela", async () => {
    const casos: [Erro, string][] = [
      [
        {
          code: "23514",
          message: ERROS_DA_AGENDADA.semAutorizacao,
        },
        ERROS_DA_AGENDADA.semAutorizacao,
      ],
      [
        {
          code: "23514",
          message:
            "Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra.",
        },
        "Este contato já tem muitas mensagens agendadas. Exclua uma antes de agendar outra.",
      ],
      [
        { code: "42501", message: "Assuma a conversa antes de agendar." },
        "Assuma a conversa antes de agendar.",
      ],
      [
        {
          code: "42501",
          message:
            'new row violates row-level security policy for table "mensagem_agendada"',
        },
        DICAS_DA_AGENDADA.soAcompanha,
      ],
      [
        { code: "23514", message: `falhou para ${TEXTO}` },
        ERROS_DA_AGENDADA.naoAgendou,
      ],
      [{ code: "", message: "rede" }, ERROS_DA_AGENDADA.naoAgendou],
    ];
    for (const [erro, esperado] of casos) {
      responderCom({
        "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
        "mensagem_agendada:insert": () => ({ data: null, error: erro }),
      });
      expect(await agendarMensagemAction(pedido())).toEqual({
        ok: false,
        error: esperado,
      });
    }
    expect(trilha()).toEqual([]);
  });

  it("Agendar de novo: depois do sucesso, dispensa a antiga do mesmo contato", async () => {
    responderCom({
      "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
      "mensagem_agendada:update": () => ({
        data: [{ id: ANTIGA }],
        error: null,
      }),
    });
    expect(
      (await agendarMensagemAction(pedido({ substitui: ANTIGA }))).ok,
    ).toBe(true);
    const [dispensa] = operacoes("mensagem_agendada", "update");
    expect(Object.keys(dispensa!.valores as Linha)).toEqual(["dispensada_em"]);
    expect(dispensa!.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "id", ANTIGA],
      ["eq", "contact_id", CONTATO],
      ["in", "situacao", ["nao_enviada", "nao_confirmada"]],
      ["is", "dispensada_em", null],
    ]);
    expect(trilha()).toEqual([
      expect.objectContaining({
        action: "agendou_mensagem",
        entity_id: AGENDADA,
      }),
      expect.objectContaining({
        action: "dispensou_mensagem_agendada",
        entity_id: ANTIGA,
      }),
    ]);
  });

  it("Agendar de novo que não agendou não dispensa nada", async () => {
    responderCom({
      "conversation:select": () => ({ data: CONVERSA_COMIGO, error: null }),
      "mensagem_agendada:insert": () => ({
        data: null,
        error: { code: "23514", message: ERROS_DA_AGENDADA.semAutorizacao },
      }),
    });
    await agendarMensagemAction(pedido({ substitui: ANTIGA }));
    expect(operacoes("mensagem_agendada", "update")).toEqual([]);
  });

  it("a trilha nunca leva o texto", async () => {
    await agendarMensagemAction(pedido());
    expect(JSON.stringify(trilha())).not.toContain("Maria");
  });
});

describe("editarAgendadaAction", () => {
  const edicao = {
    id: AGENDADA,
    texto: ` ${TEXTO} `,
    data: "2026-10-09",
    hora: "10:00",
  };

  it("muda texto e hora só enquanto ainda é agendada, e registra a trilha", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({
        data: [{ id: AGENDADA }],
        error: null,
      }),
    });
    expect(await editarAgendadaAction(edicao)).toEqual({ ok: true });
    const [update] = operacoes("mensagem_agendada", "update");
    expect(update!.valores).toEqual({
      texto: TEXTO,
      enviar_em: "2026-10-09T13:00:00.000Z",
    });
    expect(update!.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "id", AGENDADA],
      ["eq", "situacao", "agendada"],
    ]);
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: EU,
        action: "editou_mensagem_agendada",
        entity: "mensagem_agendada",
        entity_id: AGENDADA,
      },
    ]);
  });

  it("zero linhas (a planejadora pegou antes): a frase da corrida, sem trilha", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({ data: [], error: null }),
    });
    expect(await editarAgendadaAction(edicao)).toEqual({
      ok: false,
      error: ERROS_DA_AGENDADA.edicaoPerdeuACorrida,
    });
    expect(trilha()).toEqual([]);
  });

  it("CZ409 do gatilho passa como veio", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({
        data: null,
        error: {
          code: "CZ409",
          message: ERROS_DA_AGENDADA.edicaoPerdeuACorrida,
        },
      }),
    });
    expect(await editarAgendadaAction(edicao)).toEqual({
      ok: false,
      error: ERROS_DA_AGENDADA.edicaoPerdeuACorrida,
    });
  });

  it("Somente leitura e hora passada param antes do banco", async () => {
    sessao.active.role = "leitura";
    expect(await editarAgendadaAction(edicao)).toEqual({
      ok: false,
      error: DICAS_DA_AGENDADA.soAcompanha,
    });
    sessao.active.role = "profissional";
    expect(
      await editarAgendadaAction({
        ...edicao,
        data: "2026-10-06",
        hora: "08:00",
      }),
    ).toEqual({ ok: false, error: ERROS_DA_AGENDADA.horaPassada });
    expect(estado.ops).toEqual([]);
  });
});

describe("excluirAgendadaAction", () => {
  it("cancela a agendada ou na fila e registra a trilha", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({
        data: [{ id: AGENDADA }],
        error: null,
      }),
    });
    expect(await excluirAgendadaAction({ id: AGENDADA })).toEqual({ ok: true });
    const [update] = operacoes("mensagem_agendada", "update");
    expect(update!.valores).toEqual({ situacao: "cancelada" });
    expect(update!.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "id", AGENDADA],
      ["in", "situacao", ["agendada", "enviando"]],
    ]);
    expect(trilha()).toEqual([
      expect.objectContaining({
        action: "excluiu_mensagem_agendada",
        entity: "mensagem_agendada",
        entity_id: AGENDADA,
      }),
    ]);
  });

  it("já começou a sair (CZ409 do gatilho): a frase da corrida", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({
        data: null,
        error: { code: "CZ409", message: "qualquer" },
      }),
    });
    expect(await excluirAgendadaAction({ id: AGENDADA })).toEqual({
      ok: false,
      error: ERROS_DA_AGENDADA.exclusaoPerdeuACorrida,
    });
  });

  it("zero linhas: já excluída é ok; já saiu é a corrida; sumida é indisponível", async () => {
    for (const [atual, esperado] of [
      [{ situacao: "cancelada", dispensada_em: null }, { ok: true }],
      [
        { situacao: "enviada", dispensada_em: null },
        { ok: false, error: ERROS_DA_AGENDADA.exclusaoPerdeuACorrida },
      ],
      [null, { ok: false, error: ERROS_DA_AGENDADA.naoDisponivel }],
    ] as const) {
      estado.ops = [];
      responderCom({
        "mensagem_agendada:update": () => ({ data: [], error: null }),
        "mensagem_agendada:select": () => ({ data: atual, error: null }),
      });
      expect(await excluirAgendadaAction({ id: AGENDADA })).toEqual(esperado);
      expect(trilha()).toEqual([]);
    }
  });

  it("Somente leitura não exclui", async () => {
    sessao.active.role = "leitura";
    expect(await excluirAgendadaAction({ id: AGENDADA })).toEqual({
      ok: false,
      error: DICAS_DA_AGENDADA.soAcompanha,
    });
    expect(estado.ops).toEqual([]);
  });
});

describe("dispensarAgendadaAction", () => {
  it("dispensa só a que não saiu e ainda não foi dispensada", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({
        data: [{ id: AGENDADA }],
        error: null,
      }),
    });
    expect(await dispensarAgendadaAction({ id: AGENDADA })).toEqual({
      ok: true,
    });
    const [update] = operacoes("mensagem_agendada", "update");
    expect(Object.keys(update!.valores as Linha)).toEqual(["dispensada_em"]);
    expect(update!.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "id", AGENDADA],
      ["in", "situacao", ["nao_enviada", "nao_confirmada"]],
      ["is", "dispensada_em", null],
    ]);
    expect(trilha()).toEqual([
      expect.objectContaining({ action: "dispensou_mensagem_agendada" }),
    ]);
  });

  it("dispensar de novo é ok, sem trilha nova", async () => {
    responderCom({
      "mensagem_agendada:update": () => ({ data: [], error: null }),
      "mensagem_agendada:select": () => ({
        data: {
          situacao: "nao_enviada",
          dispensada_em: "2026-10-06T14:00:00Z",
        },
        error: null,
      }),
    });
    expect(await dispensarAgendadaAction({ id: AGENDADA })).toEqual({
      ok: true,
    });
    expect(trilha()).toEqual([]);
  });
});

describe("enviarAgendadaAgoraAction", () => {
  const RETIRADA = {
    data: { estado: "ok", texto: TEXTO, conversation_id: CONVERSA },
    error: null,
  };

  it("retira a agendada e envia o texto pelo 1:1, em nome de quem clicou", async () => {
    estado.responderRpc = () => RETIRADA;
    dubles.enviar.mockResolvedValue({ ok: true, messageId: "mensagem-1" });
    expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
      ok: true,
      conversationId: CONVERSA,
      messageId: "mensagem-1",
    });
    expect(estado.rpcs).toEqual([
      { nome: "tirar_agendada_para_enviar_agora", args: { p_id: AGENDADA } },
    ]);
    expect(dubles.enviar).toHaveBeenCalledWith(CONVERSA, TEXTO);
    // A RPC grava 'retirou_agendada_para_enviar_agora'; a action grava o
    // desfecho, sem o texto (F23).
    expect(trilha()).toEqual([
      {
        clinic_id: CLINICA,
        user_id: EU,
        action: "enviou_agora_mensagem_agendada",
        entity: "mensagem_agendada",
        entity_id: AGENDADA,
      },
    ]);
  });

  it.each([
    ["ja_saindo", ERROS_DA_AGENDADA.jaNaFila],
    ["assuma_a_conversa", DICAS_DA_AGENDADA.enviarAgoraAssuma],
    ["nao_encontrada", ERROS_DA_AGENDADA.naoDisponivel],
    ["estranho", ERROS_DA_AGENDADA.naoDisponivel],
  ])("estado '%s': a frase certa, nada sai", async (estadoDaRpc, frase) => {
    estado.responderRpc = () => ({
      data: { estado: estadoDaRpc },
      error: null,
    });
    expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
      ok: false,
      error: frase,
    });
    expect(dubles.enviar).not.toHaveBeenCalled();
    expect(trilha()).toEqual([]);
  });

  describe("certo que nada saiu: o texto volta para o campo (F1)", () => {
    it.each([
      [
        "recusa antes do canal (posse da conversa)",
        { ok: false, error: "Assuma a conversa antes de responder." },
      ],
      [
        "falha da lista que garante que nada saiu (leitura_falhou)",
        {
          ok: false,
          error: "Não foi possível conferir a autorização. Tente de novo.",
          codigo: "leitura_falhou",
          naoSaiu: true,
        },
      ],
      [
        "número desconectado antes de gravar",
        {
          ok: false,
          error: "O WhatsApp da clínica não está conectado.",
          codigo: "desconectado",
          naoSaiu: true,
        },
      ],
      [
        "sem autorização",
        {
          ok: false,
          error: "Este contato não autorizou receber mensagens.",
          codigo: "sem_consentimento",
          naoSaiu: true,
        },
      ],
      [
        "canal ocupado (nada reservado)",
        {
          ok: false,
          error: "O número da clínica está enviando outras mensagens agora.",
          codigo: "canal_ocupado",
          naoSaiu: true,
        },
      ],
    ])("%s", async (_caso, envio) => {
      estado.responderRpc = () => RETIRADA;
      dubles.enviar.mockResolvedValue(envio);
      expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
        ok: false,
        error:
          "A mensagem não saiu e não está mais agendada. O texto voltou para o campo.",
        texto: TEXTO,
      });
      expect(trilha()).toEqual([
        {
          clinic_id: CLINICA,
          user_id: EU,
          action: "enviar_agora_nao_saiu",
          entity: "mensagem_agendada",
          entity_id: AGENDADA,
        },
      ]);
    });

    it("retirada sem texto ou sem conversa: nada saiu", async () => {
      estado.responderRpc = () => ({
        data: { estado: "ok", texto: TEXTO, conversation_id: null },
        error: null,
      });
      expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
        ok: false,
        error: ERROS_DA_AGENDADA.enviarAgoraFalhou,
        texto: TEXTO,
      });
      expect(dubles.enviar).not.toHaveBeenCalled();
      expect(trilha()).toEqual([
        expect.objectContaining({ action: "enviar_agora_nao_saiu" }),
      ]);
    });
  });

  describe("pode ter saído: incerto, SEM o texto (F1)", () => {
    it.each([
      [
        "envio_incerto (o provedor estourou o tempo depois do pedido)",
        () =>
          dubles.enviar.mockResolvedValue({
            ok: false,
            error:
              "Não foi possível confirmar o envio. Confira a conversa antes de reenviar.",
            codigo: "envio_incerto",
            naoSaiu: false,
          }),
      ],
      [
        "resposta do provedor fora da lista (uazapi_500)",
        () =>
          dubles.enviar.mockResolvedValue({
            ok: false,
            error: "x",
            codigo: "uazapi_500",
            naoSaiu: false,
          }),
      ],
      [
        "código do canal sem a garantia (naoSaiu ausente)",
        () =>
          dubles.enviar.mockResolvedValue({
            ok: false,
            error: "x",
            codigo: "ja_enviado",
          }),
      ],
      [
        "exceção (estado desconhecido)",
        () => dubles.enviar.mockRejectedValue(new Error("rede")),
      ],
    ])("%s", async (_caso, falha) => {
      estado.responderRpc = () => RETIRADA;
      falha();
      const resultado = await enviarAgendadaAgoraAction({ id: AGENDADA });
      expect(resultado).toEqual({
        ok: false,
        incerto: true,
        error:
          "Não deu para confirmar se a mensagem chegou ao paciente. Confira a conversa antes de mandar de novo.",
      });
      expect(resultado).not.toHaveProperty("texto");
      expect(trilha()).toEqual([
        {
          clinic_id: CLINICA,
          user_id: EU,
          action: "enviar_agora_incerto",
          entity: "mensagem_agendada",
          entity_id: AGENDADA,
        },
      ]);
    });
  });

  it("a trilha nunca leva o texto", async () => {
    estado.responderRpc = () => RETIRADA;
    for (const envio of [
      { ok: true, messageId: "m" },
      { ok: false, error: "x", codigo: "leitura_falhou", naoSaiu: true },
      { ok: false, error: "x", codigo: "envio_incerto", naoSaiu: false },
    ]) {
      dubles.enviar.mockResolvedValue(envio);
      await enviarAgendadaAgoraAction({ id: AGENDADA });
    }
    expect(JSON.stringify(trilha())).not.toContain("retorno");
    expect(trilha()).toHaveLength(3);
  });

  describe("tamanho antes de retirar, na régua do envio 1:1 (F16)", () => {
    it("texto acima de 4096 unidades UTF-16: recusa sem retirar", async () => {
      // 2049 emojis: 2049 pontos de codigo (o banco aceitou), 4098 para o 1:1.
      responderCom({
        "mensagem_agendada:select": () => ({
          data: { texto: "👍".repeat(2049) },
          error: null,
        }),
      });
      expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
        ok: false,
        error:
          "A mensagem tem 4098 caracteres e o limite é 4096. Encurte antes de enviar.",
      });
      expect(estado.rpcs).toEqual([]);
      expect(dubles.enviar).not.toHaveBeenCalled();
      expect(trilha()).toEqual([]);
      // A leitura e presa a clinica e a agendada, e so pede o texto.
      const [leitura] = operacoes("mensagem_agendada", "select");
      expect(leitura!.colunas).toBe("texto, whatsapp_account_id");
      expect(leitura!.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
      expect(leitura!.filtros).toContainEqual(["eq", "id", AGENDADA]);
    });

    it("no limite: retira e envia", async () => {
      responderCom({
        "mensagem_agendada:select": () => ({
          data: { texto: "👍".repeat(2048) },
          error: null,
        }),
      });
      estado.responderRpc = () => RETIRADA;
      dubles.enviar.mockResolvedValue({ ok: true, messageId: "m" });
      expect((await enviarAgendadaAgoraAction({ id: AGENDADA })).ok).toBe(true);
      expect(estado.rpcs).toHaveLength(1);
    });

    it("leitura com erro: nada muda, tente de novo", async () => {
      responderCom({
        "mensagem_agendada:select": () => ({
          data: null,
          error: { code: "", message: "rede" },
        }),
      });
      expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
        ok: false,
        error: "Não foi possível enviar agora. Tente de novo.",
      });
      expect(estado.rpcs).toEqual([]);
    });
  });

  describe("número da agendada desconectado: não retira (F7)", () => {
    function comNumero(numero: Linha | null) {
      responderCom({
        "mensagem_agendada:select": () => ({
          data: { texto: TEXTO, whatsapp_account_id: NUMERO },
          error: null,
        }),
        "whatsapp_account:select": () => ({ data: numero, error: null }),
      });
      estado.responderRpc = () => RETIRADA;
      dubles.enviar.mockResolvedValue({ ok: true, messageId: "m" });
    }

    it("desconectado: a dica do botão, sem chegar à RPC; ela continua agendada", async () => {
      comNumero({
        nome: "Recepção",
        connection_status: "desconectado",
        removido_em: null,
      });
      expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
        ok: false,
        error:
          "O número Recepção está desconectado. A mensagem continua agendada e espera a reconexão.",
      });
      expect(estado.rpcs).toEqual([]);
      expect(dubles.enviar).not.toHaveBeenCalled();
      expect(trilha()).toEqual([]);
      const [leitura] = operacoes("whatsapp_account", "select");
      expect(leitura!.filtros).toContainEqual(["eq", "clinic_id", CLINICA]);
      expect(leitura!.filtros).toContainEqual(["eq", "id", NUMERO]);
    });

    it("conectado, ou sem leitura do número: segue para a RPC", async () => {
      for (const numero of [
        {
          nome: "Recepção",
          connection_status: "conectado",
          removido_em: null,
        },
        null,
      ]) {
        estado.rpcs = [];
        comNumero(numero);
        expect((await enviarAgendadaAgoraAction({ id: AGENDADA })).ok).toBe(
          true,
        );
        expect(estado.rpcs).toHaveLength(1);
      }
    });
  });

  it("erro na RPC: nada sai", async () => {
    estado.responderRpc = () => ({
      data: null,
      error: { code: "", message: "rede" },
    });
    const resultado = await enviarAgendadaAgoraAction({ id: AGENDADA });
    expect(resultado.ok).toBe(false);
    expect(dubles.enviar).not.toHaveBeenCalled();
  });

  it("Somente leitura não chega à RPC", async () => {
    sessao.active.role = "leitura";
    expect(await enviarAgendadaAgoraAction({ id: AGENDADA })).toEqual({
      ok: false,
      error: DICAS_DA_AGENDADA.soAcompanha,
    });
    expect(estado.rpcs).toEqual([]);
  });
});

describe("cancelarAgendadasDaPessoaAction (Configurações > Equipe)", () => {
  it("só quem gerencia a equipe cancela", async () => {
    for (const papel of ["recepcao", "profissional", "leitura"]) {
      sessao.active.role = papel;
      const resultado = await cancelarAgendadasDaPessoaAction({
        userId: COLEGA,
      });
      expect(resultado.ok).toBe(false);
    }
    expect(estado.ops).toEqual([]);
  });

  it("cancela as agendadas que a pessoa assina, com uma linha de trilha por mensagem", async () => {
    sessao.active.role = "gestor";
    responderCom({
      "mensagem_agendada:update": () => ({
        data: [{ id: AGENDADA }, { id: ANTIGA }],
        error: null,
      }),
    });
    expect(await cancelarAgendadasDaPessoaAction({ userId: COLEGA })).toEqual({
      ok: true,
      canceladas: 2,
    });
    const [update] = operacoes("mensagem_agendada", "update");
    expect(update!.valores).toEqual({ situacao: "cancelada" });
    expect(update!.filtros).toEqual([
      ["eq", "clinic_id", CLINICA],
      ["eq", "situacao", "agendada"],
      [
        "or",
        `editada_por.eq.${COLEGA},and(editada_por.is.null,criada_por.eq.${COLEGA})`,
        null,
      ],
    ]);
    expect(trilha()).toEqual([
      [AGENDADA, ANTIGA].map((id) => ({
        clinic_id: CLINICA,
        user_id: EU,
        action: "excluiu_mensagem_agendada",
        entity: "mensagem_agendada",
        entity_id: id,
      })),
    ]);
  });

  it("id que não é uuid nunca chega ao filtro", async () => {
    sessao.active.role = "admin";
    const resultado = await cancelarAgendadasDaPessoaAction({
      userId: "x,criada_por.neq.null",
    });
    expect(resultado.ok).toBe(false);
    expect(estado.ops).toEqual([]);
  });
});

describe("listarAgendadasAction", () => {
  it("lê pela sessão e grava a trilha de leitura com o id do contato", async () => {
    sessao.active.role = "leitura";
    const lista = {
      itens: [],
      contexto: {
        ultimaEntradaPorNumero: {},
        conexaoPorNumero: {},
        membrosComEscrita: [],
      },
    };
    dubles.listar.mockResolvedValue(lista);
    expect(await listarAgendadasAction({ contactId: CONTATO })).toEqual({
      ok: true,
      ...lista,
    });
    expect(dubles.listar).toHaveBeenCalledWith(cliente, CLINICA, CONTATO);
    expect(dubles.leituras).toEqual([
      {
        clinicId: CLINICA,
        userId: EU,
        entity: "mensagem_agendada",
        entityId: CONTATO,
      },
    ]);
  });

  it("erro de leitura não vira lista vazia", async () => {
    dubles.listar.mockRejectedValue(new Error("falhou"));
    expect(await listarAgendadasAction({ contactId: CONTATO })).toEqual({
      ok: false,
      error: "Não foi possível carregar as mensagens agendadas.",
    });
  });

  it("contato inválido não lê nada", async () => {
    expect((await listarAgendadasAction({ contactId: "x" })).ok).toBe(false);
    expect(dubles.listar).not.toHaveBeenCalled();
  });
});
