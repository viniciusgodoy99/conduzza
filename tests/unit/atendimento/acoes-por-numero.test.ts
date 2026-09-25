import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceRef } from "@/lib/integrations/whatsapp/provider";

// As acoes do atendimento POR NUMERO (docs/07_multiplos_numeros_whatsapp.md,
// Fase 2; achado N[3] da revisao): apagar no WhatsApp pela instancia do
// numero que ENVIOU, reabrir procurando a conversa aberta do MESMO numero e
// citar so mensagem do mesmo numero. Aqui a acao de verdade roda
// (app/(app)/atendimento/actions.ts), com a sessao, o client do Supabase e o
// banco trocados por um banco em memoria que imita o PostgREST no que importa
// para decidir: filtros eq/neq/is/in, limit e o maybeSingle que ERRA com mais
// de uma linha.
//
// O banco em memoria deixa montar o que o banco real nao deixa (mensagem com
// numero diferente do da conversa): e assim que se prova DE ONDE a acao tira
// o numero. O caminho contra o banco real esta em
// tests/integration/numeros-fase-2.test.ts.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const NUMERO_A = "a2222222-2222-4222-8222-222222222222";
const NUMERO_B = "b3333333-3333-4333-8333-333333333333";
const CONTATO = "d4444444-4444-4444-8444-444444444444";
const CONVERSA = "e5555555-5555-4555-8555-555555555555";
const MENSAGEM = "f6666666-6666-4666-8666-666666666666";
const USUARIO = "97777777-7777-4777-8777-777777777777";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };
type Resultado = { data: unknown; error: Erro | null };
type Filtro = [operador: string, coluna: string, valor: unknown];

type Registro = {
  tabela: string;
  operacao: "select" | "insert" | "update";
  filtros: Filtro[];
  limite: number | null;
};

class Banco {
  tabelas = new Map<string, Linha[]>();
  /** erro forcado por "tabela:operacao" */
  falhas = new Map<string, Erro>();
  registros: Registro[] = [];
  readonly rpc = vi.fn<
    (nome: string, args: Record<string, unknown>) => Promise<Resultado>
  >(async () => ({ data: null, error: null }));

  linhas(tabela: string): Linha[] {
    let linhas = this.tabelas.get(tabela);
    if (!linhas) {
      linhas = [];
      this.tabelas.set(tabela, linhas);
    }
    return linhas;
  }

  limpar(): void {
    this.tabelas.clear();
    this.falhas.clear();
    this.registros = [];
    this.rpc.mockReset();
    this.rpc.mockImplementation(async () => ({ data: null, error: null }));
  }

  cliente() {
    return {
      from: (tabela: string) => new Consulta(this, tabela),
      rpc: (nome: string, args: Record<string, unknown>) =>
        this.rpc(nome, args),
      storage: {
        from: () => ({ remove: async () => ({ data: null, error: null }) }),
      },
    };
  }

  consultas(tabela: string, operacao: Registro["operacao"]): Registro[] {
    return this.registros.filter(
      (registro) =>
        registro.tabela === tabela && registro.operacao === operacao,
    );
  }
}

class Consulta implements PromiseLike<Resultado> {
  private operacao: Registro["operacao"] = "select";
  private valores: Linha = {};
  private readonly filtros: Filtro[] = [];
  private limite: number | null = null;
  private modo: "lista" | "talvez" | "um" = "lista";
  private devolverLinhas = false;

  constructor(
    private readonly banco: Banco,
    private readonly tabela: string,
  ) {}

  select(): this {
    if (this.operacao !== "select") {
      this.devolverLinhas = true;
    }
    return this;
  }
  insert(valores: Linha): this {
    this.operacao = "insert";
    this.valores = valores;
    return this;
  }
  update(valores: Linha): this {
    this.operacao = "update";
    this.valores = valores;
    return this;
  }
  eq(coluna: string, valor: unknown): this {
    this.filtros.push(["eq", coluna, valor]);
    return this;
  }
  neq(coluna: string, valor: unknown): this {
    this.filtros.push(["neq", coluna, valor]);
    return this;
  }
  is(coluna: string, valor: null): this {
    this.filtros.push(["is", coluna, valor]);
    return this;
  }
  in(coluna: string, valores: unknown[]): this {
    this.filtros.push(["in", coluna, valores]);
    return this;
  }
  gt(coluna: string, valor: unknown): this {
    this.filtros.push(["gt", coluna, valor]);
    return this;
  }
  order(): this {
    return this;
  }
  limit(quantas: number): this {
    this.limite = quantas;
    return this;
  }
  maybeSingle(): this {
    this.modo = "talvez";
    return this;
  }
  single(): this {
    this.modo = "um";
    return this;
  }

  then<A = Resultado, B = never>(
    ok?: ((valor: Resultado) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private casa(linha: Linha): boolean {
    return this.filtros.every(([operador, coluna, valor]) => {
      const atual = linha[coluna] ?? null;
      switch (operador) {
        case "eq":
          return atual === valor;
        case "neq":
          return atual !== valor;
        case "is":
          return atual === valor;
        case "in":
          return (valor as unknown[]).includes(atual);
        case "gt":
          return Number(atual) > Number(valor);
        default:
          return false;
      }
    });
  }

  private formatar(linhas: Linha[]): Resultado {
    const copias = linhas.map((linha) => ({ ...linha }));
    if (this.modo === "lista") {
      return { data: copias, error: null };
    }
    // Como o PostgREST: maybeSingle com mais de uma linha e ERRO.
    if (copias.length > 1) {
      return {
        data: null,
        error: { code: "PGRST116", message: "mais de uma linha" },
      };
    }
    if (copias.length === 0 && this.modo === "um") {
      return { data: null, error: { code: "PGRST116", message: "nenhuma" } };
    }
    return { data: copias[0] ?? null, error: null };
  }

  private executar(): Resultado {
    this.banco.registros.push({
      tabela: this.tabela,
      operacao: this.operacao,
      filtros: [...this.filtros],
      limite: this.limite,
    });
    const falha = this.banco.falhas.get(`${this.tabela}:${this.operacao}`);
    if (falha) {
      return { data: null, error: falha };
    }
    const linhas = this.banco.linhas(this.tabela);
    if (this.operacao === "insert") {
      linhas.push({ id: crypto.randomUUID(), ...this.valores });
      return { data: null, error: null };
    }
    let casadas = linhas.filter((linha) => this.casa(linha));
    if (this.limite !== null) {
      casadas = casadas.slice(0, this.limite);
    }
    if (this.operacao === "update") {
      for (const linha of casadas) {
        Object.assign(linha, this.valores);
      }
      return this.devolverLinhas
        ? this.formatar(casadas)
        : { data: null, error: null };
    }
    return this.formatar(casadas);
  }
}

const banco = new Banco();
const sessao = {
  userId: USUARIO,
  userName: "Ana Recepção",
  active: {
    clinicId: CLINICA,
    clinicName: "Clínica",
    slug: "clinica",
    timezone: "America/Fortaleza",
    role: "admin" as string,
    status: "ativo",
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => banco.cliente(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => banco.cliente(),
}));
vi.mock("@/lib/auth/active-clinic", () => ({
  getSessionContext: async () => sessao,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// O envio de texto e trocado por um espiao: a citacao e resolvida ANTES dele,
// e e o que se prova aqui. carregarInstancia continua a de verdade.
vi.mock("@/lib/integrations/whatsapp/send", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/integrations/whatsapp/send")>();
  return {
    ...original,
    sendWhatsAppText: vi.fn(async () => ({ ok: true, messageId: "nova" })),
  };
});

const { apagarMensagemAction, reabrirConversaAction, sendMessageAction } =
  await import("@/app/(app)/atendimento/actions");
const { sendWhatsAppText } = await import("@/lib/integrations/whatsapp/send");
const { FakeProvider } = await import("@/lib/integrations/whatsapp/fake");

/** A clinica com dois numeros: A e o principal, B o segundo. */
function doisNumeros(opcoesDoB: Linha = {}): void {
  banco.linhas("whatsapp_account").push(
    {
      id: NUMERO_A,
      clinic_id: CLINICA,
      provider: "fake",
      server_url: null,
      instance_id: "fake-a2222222",
      principal: true,
      removido_em: null,
    },
    {
      id: NUMERO_B,
      clinic_id: CLINICA,
      provider: "fake",
      server_url: null,
      instance_id: "fake-b3333333",
      principal: false,
      removido_em: null,
      ...opcoesDoB,
    },
  );
  banco
    .linhas("whatsapp_account_secret")
    .push(
      { clinic_id: CLINICA, account_id: NUMERO_A, instance_token: "tok-a" },
      { clinic_id: CLINICA, account_id: NUMERO_B, instance_token: "tok-b" },
    );
}

/** Veredito de pode_apagar_mensagem autorizando revogar para todos. */
function autorizarApagar(): void {
  banco.rpc.mockImplementation(async (nome) => {
    if (nome === "pode_apagar_mensagem") {
      return {
        data: {
          ok: true,
          acao: "apagar",
          clinic_id: CLINICA,
          wa_message_id: "wa-enviada-1",
          media_url: null,
          nota_interna: false,
        },
        error: null,
      };
    }
    if (nome === "apagar_mensagem") {
      return { data: { ok: true }, error: null };
    }
    return { data: null, error: null };
  });
}

function rpcsChamadas(): string[] {
  return banco.rpc.mock.calls.map(([nome]) => nome);
}

beforeEach(() => {
  banco.limpar();
  sessao.active.role = "admin";
  vi.mocked(sendWhatsAppText).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apagar no WhatsApp: pela instância do número que enviou", () => {
  it("o número vem da MENSAGEM, não da conversa nem do principal", async () => {
    doisNumeros();
    // Conversa no A (o principal); a mensagem saiu pelo B. No banco real a
    // mensagem herda o numero da conversa; aqui eles divergem de proposito,
    // para que trocar a fonte do numero quebre este teste.
    banco.linhas("conversation").push({
      id: CONVERSA,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      whatsapp_account_id: NUMERO_A,
    });
    banco.linhas("message").push({
      id: MENSAGEM,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      whatsapp_account_id: NUMERO_B,
    });
    autorizarApagar();
    const revogar = vi.spyOn(FakeProvider.prototype, "deleteMessage");

    const resultado = await apagarMensagemAction(MENSAGEM, "todos");

    expect(resultado).toEqual({ ok: true });
    expect(revogar).toHaveBeenCalledTimes(1);
    const [ref, waId] = revogar.mock.calls[0]! as [InstanceRef, string];
    expect(waId).toBe("wa-enviada-1");
    expect(ref).toMatchObject({
      clinicId: CLINICA,
      accountId: NUMERO_B,
      instanceId: "fake-b3333333",
      instanceToken: "tok-b",
    });
    // Revogou lá fora ANTES de gravar aqui.
    expect(rpcsChamadas()).toEqual(["pode_apagar_mensagem", "apagar_mensagem"]);
    // A leitura do numero e pela clinica do veredito e pelo id da mensagem.
    const [leitura] = banco.consultas("message", "select");
    expect(leitura!.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "clinic_id", CLINICA],
        ["eq", "id", MENSAGEM],
      ]),
    );
  });

  it("número removido: não revoga, não grava e diz que ainda dá para apagar só aqui", async () => {
    doisNumeros({ removido_em: "2026-09-25T12:00:00Z" });
    banco.linhas("message").push({
      id: MENSAGEM,
      clinic_id: CLINICA,
      whatsapp_account_id: NUMERO_B,
    });
    autorizarApagar();
    const revogar = vi.spyOn(FakeProvider.prototype, "deleteMessage");

    const resultado = await apagarMensagemAction(MENSAGEM, "todos");

    expect(resultado).toEqual({
      ok: false,
      error:
        "Esta mensagem saiu por um número que foi removido da clínica. Você ainda pode apagar só aqui.",
    });
    expect(revogar).not.toHaveBeenCalled();
    expect(rpcsChamadas()).toEqual(["pode_apagar_mensagem"]);
  });

  it("mensagem sem número: não revoga e diz o motivo", async () => {
    doisNumeros();
    banco.linhas("message").push({
      id: MENSAGEM,
      clinic_id: CLINICA,
      whatsapp_account_id: null,
    });
    autorizarApagar();
    const revogar = vi.spyOn(FakeProvider.prototype, "deleteMessage");

    const resultado = await apagarMensagemAction(MENSAGEM, "todos");

    expect(resultado).toEqual({
      ok: false,
      error:
        "Não encontramos o número de WhatsApp por onde esta mensagem saiu. Você ainda pode apagar só aqui.",
    });
    expect(revogar).not.toHaveBeenCalled();
    expect(rpcsChamadas()).toEqual(["pode_apagar_mensagem"]);
  });

  it("apagar só aqui não procura número nem fala com o WhatsApp", async () => {
    doisNumeros({ removido_em: "2026-09-25T12:00:00Z" });
    autorizarApagar();
    const revogar = vi.spyOn(FakeProvider.prototype, "deleteMessage");

    const resultado = await apagarMensagemAction(MENSAGEM, "local");

    expect(resultado).toEqual({ ok: true });
    expect(revogar).not.toHaveBeenCalled();
    expect(banco.consultas("whatsapp_account", "select")).toHaveLength(0);
    expect(rpcsChamadas()).toEqual(["pode_apagar_mensagem", "apagar_mensagem"]);
  });
});

describe("reabrir: a conversa aberta que barrou é a do MESMO número", () => {
  const RESOLVIDA = "e0000000-0000-4000-8000-00000000000e";
  const ABERTA_NO_A = "e1000000-0000-4000-8000-00000000000e";
  const ABERTA_NO_B = "e2000000-0000-4000-8000-00000000000e";
  const ABERTA_SEM_NUMERO = "e3000000-0000-4000-8000-00000000000e";

  function conversa(id: string, campos: Linha): Linha {
    return {
      id,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      assignee_user_id: null,
      last_message_at: "2026-09-25T10:00:00Z",
      ...campos,
    };
  }

  beforeEach(() => {
    // O indice de conversa aberta recusa a reabertura (23505).
    banco.falhas.set("conversation:update", {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "conversation_aberta_por_contato"',
    });
  });

  it("com uma aberta em cada número, leva à do número da conversa reaberta", async () => {
    banco.linhas("conversation").push(
      conversa(RESOLVIDA, {
        status: "resolvida",
        whatsapp_account_id: NUMERO_B,
      }),
      conversa(ABERTA_NO_A, {
        status: "em_atendimento",
        whatsapp_account_id: NUMERO_A,
      }),
      conversa(ABERTA_NO_B, {
        status: "aguardando_humano",
        whatsapp_account_id: NUMERO_B,
      }),
    );

    const resultado = await reabrirConversaAction(RESOLVIDA);

    expect(resultado).toEqual({
      ok: false,
      error: "Este paciente já tem uma conversa aberta.",
      conversaAbertaId: ABERTA_NO_B,
    });
    const busca = banco.consultas("conversation", "select").at(-1)!;
    expect(busca.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "clinic_id", CLINICA],
        ["eq", "contact_id", CONTATO],
        ["neq", "status", "resolvida"],
        ["eq", "whatsapp_account_id", NUMERO_B],
      ]),
    );
    expect(busca.limite).toBe(1);
  });

  it("conversa sem número procura entre as sem número", async () => {
    banco.linhas("conversation").push(
      conversa(RESOLVIDA, {
        status: "resolvida",
        whatsapp_account_id: null,
      }),
      conversa(ABERTA_NO_A, {
        status: "em_atendimento",
        whatsapp_account_id: NUMERO_A,
      }),
      conversa(ABERTA_SEM_NUMERO, {
        status: "ia_atendendo",
        whatsapp_account_id: null,
      }),
    );

    const resultado = await reabrirConversaAction(RESOLVIDA);

    expect(resultado.conversaAbertaId).toBe(ABERTA_SEM_NUMERO);
    const busca = banco.consultas("conversation", "select").at(-1)!;
    expect(busca.filtros).toContainEqual(["is", "whatsapp_account_id", null]);
  });

  it("sem conflito, reabre e registra o evento com o nome de quem reabriu", async () => {
    banco.falhas.clear();
    banco.linhas("conversation").push(
      conversa(RESOLVIDA, {
        status: "resolvida",
        whatsapp_account_id: NUMERO_B,
      }),
    );

    const resultado = await reabrirConversaAction(RESOLVIDA);

    expect(resultado).toEqual({ ok: true });
    expect(banco.linhas("conversation")[0]).toMatchObject({
      status: "em_atendimento",
      assignee_user_id: USUARIO,
    });
    expect(banco.linhas("message")).toEqual([
      expect.objectContaining({
        conversation_id: RESOLVIDA,
        author: "sistema",
        body: "Ana Recepção reabriu a conversa",
      }),
    ]);
  });
});

describe("citar: só mensagem desta conversa e do mesmo número", () => {
  const CITADA = "f7777777-7777-4777-8777-777777777777";

  function conversaEmAtendimento(): void {
    banco.linhas("conversation").push({
      id: CONVERSA,
      clinic_id: CLINICA,
      contact_id: CONTATO,
      status: "em_atendimento",
      assignee_user_id: USUARIO,
      whatsapp_account_id: NUMERO_A,
    });
  }

  function citada(campos: Linha): void {
    banco.linhas("message").push({
      id: CITADA,
      clinic_id: CLINICA,
      conversation_id: CONVERSA,
      wa_message_id: "wa-citada",
      whatsapp_account_id: NUMERO_A,
      is_internal_note: false,
      deleted_at: null,
      ...campos,
    });
  }

  it("mensagem do mesmo número sai com a citação", async () => {
    conversaEmAtendimento();
    citada({});

    const resultado = await sendMessageAction(CONVERSA, "Pode sim.", CITADA);

    expect(resultado).toEqual({ ok: true, messageId: "nova" });
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendWhatsAppText).mock.calls[0]![1]).toMatchObject({
      clinicId: CLINICA,
      conversationId: CONVERSA,
      replyTo: { messageId: CITADA, waMessageId: "wa-citada" },
    });
  });

  it("mensagem de outro número da clínica não é citada e nada sai", async () => {
    conversaEmAtendimento();
    citada({ whatsapp_account_id: NUMERO_B });

    const resultado = await sendMessageAction(CONVERSA, "Pode sim.", CITADA);

    expect(resultado).toEqual({
      ok: false,
      error: "A mensagem citada é de outro número da clínica.",
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("mensagem de outra conversa não é citada", async () => {
    conversaEmAtendimento();
    citada({ conversation_id: "e9999999-9999-4999-8999-999999999999" });

    const resultado = await sendMessageAction(CONVERSA, "Pode sim.", CITADA);

    expect(resultado).toEqual({
      ok: false,
      error: "A mensagem citada não é desta conversa.",
    });
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });
});
