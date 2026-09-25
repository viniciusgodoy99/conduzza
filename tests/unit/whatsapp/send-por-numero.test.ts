import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  carregarInstancia,
  falhaPermiteRetry,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";

// Fase 2 de varios numeros por clinica (docs/07): o envio passa a trabalhar
// por NUMERO. A mensagem sai pelo numero da conversa, o status que decide e o
// DAQUELE numero, o slot e o token sao dele, e o numero que quem chama espera
// e so assercao: divergiu, nada sai e nada se repete.
//
// O banco aqui e um duble minimo do client do Supabase: responde o que cada
// tabela e RPC devolveria e registra as consultas, para provar QUAL numero
// foi usado em cada passo. O caminho real (RLS, gatilhos, slot) e coberto nos
// testes de integracao.

const CLINICA = "c1111111-1111-4111-8111-111111111111";
const NUMERO_A = "a2222222-2222-4222-8222-222222222222";
const NUMERO_B = "b3333333-3333-4333-8333-333333333333";

type Numero = {
  id: string;
  provider: string;
  server_url: string | null;
  instance_id: string | null;
  nome: string;
  connection_status: string;
  removido_em: string | null;
};

type Cenario = {
  consentimento?: boolean;
  /** null: a conversa nao existe */
  conversa?: {
    whatsapp_account_id: string | null;
    numero: Numero | null;
  } | null;
  /** quantos numeros ativos a clinica tem */
  ativos?: number;
  slot?: Record<string, unknown>;
  /** Respostas de consentimento_vigente, na ordem (a leitura e a reconferencia). */
  consentimentos?: Array<{ data: unknown; error: unknown }>;
};

type Consulta = {
  tabela: string;
  operacao: "select" | "insert" | "update";
  colunas?: string;
  filtros: Array<[string, unknown]>;
};

function numero(parcial: Partial<Numero> = {}): Numero {
  return {
    id: NUMERO_A,
    provider: "fake",
    server_url: null,
    instance_id: "fake-a2222222",
    nome: "Recepção",
    connection_status: "conectado",
    removido_em: null,
    ...parcial,
  };
}

function bancoFalso(cenario: Cenario = {}) {
  const consultas: Consulta[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const conversa =
    cenario.conversa === undefined
      ? { whatsapp_account_id: NUMERO_A, numero: numero() }
      : cenario.conversa;

  function responder(c: Consulta): Record<string, unknown> {
    if (c.tabela === "conversation" && c.operacao === "select") {
      return { data: conversa, error: null };
    }
    if (c.tabela === "whatsapp_account" && c.operacao === "select") {
      if (c.colunas === "id") {
        return { data: null, count: cenario.ativos ?? 1, error: null };
      }
      const id = c.filtros.find(([coluna]) => coluna === "id")?.[1];
      return {
        data:
          id === NUMERO_A
            ? { provider: "fake", server_url: null, instance_id: "fake-a" }
            : null,
        error: null,
      };
    }
    if (c.tabela === "whatsapp_account_secret") {
      const conta = c.filtros.find(([coluna]) => coluna === "account_id")?.[1];
      return {
        data: { instance_token: `token-de-${String(conta)}` },
        error: null,
      };
    }
    if (c.tabela === "contact") {
      return { data: { phone_e164: "+5584999990000" }, error: null };
    }
    if (c.tabela === "message" && c.operacao === "insert") {
      return { data: { id: "mensagem-1" }, error: null };
    }
    return { data: null, error: null };
  }

  function from(tabela: string) {
    const consulta: Consulta = { tabela, operacao: "select", filtros: [] };
    consultas.push(consulta);
    const construtor = {
      select(colunas: string) {
        // Depois de insert/update, select so escolhe o retorno.
        if (consulta.operacao === "select") {
          consulta.colunas = colunas;
        }
        return construtor;
      },
      insert() {
        consulta.operacao = "insert";
        return construtor;
      },
      update() {
        consulta.operacao = "update";
        return construtor;
      },
      eq(coluna: string, valor: unknown) {
        consulta.filtros.push([coluna, valor]);
        return construtor;
      },
      is(coluna: string, valor: unknown) {
        consulta.filtros.push([coluna, valor]);
        return construtor;
      },
      maybeSingle: async () => responder(consulta),
      single: async () => responder(consulta),
      then(
        resolver: (valor: Record<string, unknown>) => unknown,
        rejeitar?: (erro: unknown) => unknown,
      ) {
        return Promise.resolve(responder(consulta)).then(resolver, rejeitar);
      },
    };
    return construtor;
  }

  async function rpc(nome: string, args: Record<string, unknown>) {
    rpcs.push({ nome, args });
    if (nome === "consentimento_vigente") {
      const proxima = cenario.consentimentos?.shift();
      return proxima ?? { data: cenario.consentimento ?? true, error: null };
    }
    if (nome === "reservar_slot_envio_v2") {
      return {
        data: cenario.slot ?? { estado: "reservado", espera_ms: 0 },
        error: null,
      };
    }
    return { data: null, error: null };
  }

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    consultas,
    rpcs,
  };
}

function enviar(
  banco: ReturnType<typeof bancoFalso>,
  extra: { whatsappAccountId?: string | null } = {},
) {
  return sendWhatsAppText(banco.client, {
    clinicId: CLINICA,
    conversationId: "conversa-1",
    contactId: "contato-1",
    body: "Olá",
    authorUserId: null,
    ...extra,
  });
}

function slotReservado(banco: ReturnType<typeof bancoFalso>): boolean {
  return banco.rpcs.some((r) => r.nome === "reservar_slot_envio_v2");
}

function mensagemGravada(banco: ReturnType<typeof bancoFalso>): boolean {
  return banco.consultas.some(
    (c) => c.tabela === "message" && c.operacao === "insert",
  );
}

beforeEach(() => {
  resetFakeProvider();
});

describe("o envio sai pelo número da conversa", () => {
  it("slot, token e provedor são DAQUELE número", async () => {
    const banco = bancoFalso();
    const resultado = await enviar(banco);

    expect(resultado.ok).toBe(true);
    const slot = banco.rpcs.find((r) => r.nome === "reservar_slot_envio_v2");
    expect(slot?.args.p_whatsapp_account_id).toBe(NUMERO_A);

    const segredo = banco.consultas.find(
      (c) => c.tabela === "whatsapp_account_secret",
    );
    expect(segredo?.filtros).toContainEqual(["account_id", NUMERO_A]);

    expect(fakeSentMessages()).toHaveLength(1);
    expect(fakeSentMessages()[0]?.accountId).toBe(NUMERO_A);
  });

  it("o número vem na MESMA leitura da conversa, nunca por clínica", async () => {
    const banco = bancoFalso();
    await enviar(banco);

    const leituraDaConversa = banco.consultas.find(
      (c) => c.tabela === "conversation" && c.operacao === "select",
    );
    expect(leituraDaConversa?.colunas).toContain("whatsapp_account!");
    // Nenhuma leitura de conta ou segredo so por clinic_id: com dois
    // numeros, ela escolheria um qualquer.
    for (const c of banco.consultas) {
      if (
        (c.tabela === "whatsapp_account" && c.colunas !== "id") ||
        c.tabela === "whatsapp_account_secret"
      ) {
        const colunas = c.filtros.map(([coluna]) => coluna);
        expect(colunas.some((x) => x === "id" || x === "account_id")).toBe(
          true,
        );
      }
    }
  });
});

describe("asserção do número esperado", () => {
  it("número divergente não envia, não grava e não entra em retry", async () => {
    const banco = bancoFalso();
    const resultado = await enviar(banco, { whatsappAccountId: NUMERO_B });

    expect(resultado).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "conta_divergente",
    });
    expect(falhaPermiteRetry("conta_divergente")).toBe(false);
    expect(slotReservado(banco)).toBe(false);
    expect(mensagemGravada(banco)).toBe(false);
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("conversa sem número também diverge de um número esperado", async () => {
    const banco = bancoFalso({
      conversa: { whatsapp_account_id: null, numero: null },
    });
    const resultado = await enviar(banco, { whatsappAccountId: NUMERO_A });
    expect(resultado).toMatchObject({ ok: false, code: "conta_divergente" });
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("número igual ao da conversa passa normalmente", async () => {
    const banco = bancoFalso();
    const resultado = await enviar(banco, { whatsappAccountId: NUMERO_A });
    expect(resultado.ok).toBe(true);
    expect(fakeSentMessages()[0]?.accountId).toBe(NUMERO_A);
  });

  it("sem número esperado, não há o que conferir", async () => {
    const banco = bancoFalso();
    const resultado = await enviar(banco, { whatsappAccountId: null });
    expect(resultado.ok).toBe(true);
  });
});

describe("status e remoção do número", () => {
  it("número removido: desconectado com código numero_removido, sem slot", async () => {
    const banco = bancoFalso({
      conversa: {
        whatsapp_account_id: NUMERO_A,
        // Mesmo que a linha dissesse conectado, removido nao envia.
        numero: numero({ removido_em: "2026-09-25T12:00:00Z" }),
      },
    });
    const resultado = await enviar(banco);

    expect(resultado).toMatchObject({
      ok: false,
      reason: "desconectado",
      code: "numero_removido",
    });
    expect(falhaPermiteRetry("numero_removido")).toBe(false);
    expect(slotReservado(banco)).toBe(false);
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("a decisão é pelo status DAQUELE número", async () => {
    const banco = bancoFalso({
      conversa: {
        whatsapp_account_id: NUMERO_A,
        numero: numero({ connection_status: "desconectado" }),
      },
    });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "desconectado",
      code: "desconectado",
      message: "O WhatsApp da clínica não está conectado.",
    });
    expect(slotReservado(banco)).toBe(false);
  });

  it("com mais de um número ativo, a mensagem cita o nome do número", async () => {
    const banco = bancoFalso({
      ativos: 2,
      conversa: {
        whatsapp_account_id: NUMERO_A,
        numero: numero({ connection_status: "desconectado" }),
      },
    });
    const resultado = await enviar(banco);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.message).toContain('"Recepção"');
    }
  });

  it("canal ocupado cita o nome quando há outros números", async () => {
    const banco = bancoFalso({
      ativos: 3,
      slot: { estado: "adiado", livre_em: "2026-09-25T12:00:30Z" },
    });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "slot_adiado",
      livreEm: "2026-09-25T12:00:30Z",
    });
    if (!resultado.ok) {
      expect(resultado.message).toContain('"Recepção"');
    }
  });

  it("conversa sem número (clínica sem número) é desconectado, como antes", async () => {
    const banco = bancoFalso({
      conversa: { whatsapp_account_id: null, numero: null },
    });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "desconectado",
      code: "desconectado",
    });
  });

  it("consentimento continua vindo primeiro, mesmo com número removido", async () => {
    const banco = bancoFalso({
      consentimento: false,
      conversa: {
        whatsapp_account_id: NUMERO_A,
        numero: numero({ removido_em: "2026-09-25T12:00:00Z" }),
      },
    });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "sem_consentimento",
    });
  });

  it("consentimento sem resposta não é revogação: retry, sem trilha e sem gravar nada", async () => {
    const banco = bancoFalso({
      consentimentos: [{ data: null, error: { code: "57014" } }],
    });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "leitura_falhou",
    });
    expect(falhaPermiteRetry("leitura_falhou")).toBe(true);
    expect(banco.consultas.some((c) => c.tabela === "audit_log")).toBe(false);
    expect(mensagemGravada(banco)).toBe(false);
    expect(slotReservado(banco)).toBe(false);
  });

  it("reconferência sem resposta depois da espera: falha retentável, sem trilha", async () => {
    const banco = bancoFalso({
      slot: { estado: "reservado", espera_ms: 1 },
      consentimentos: [
        { data: true, error: null },
        { data: null, error: { code: "08006" } },
      ],
    });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "leitura_falhou",
    });
    expect(banco.consultas.some((c) => c.tabela === "audit_log")).toBe(false);
    expect(fakeSentMessages()).toHaveLength(0);
  });

  it("conversa inexistente falha sem retry", async () => {
    const banco = bancoFalso({ conversa: null });
    const resultado = await enviar(banco);
    expect(resultado).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "conversa_inexistente",
    });
    expect(falhaPermiteRetry("conversa_inexistente")).toBe(false);
  });
});

describe("carregarInstancia por número", () => {
  it("lê conta e token pelo id do número, dentro da clínica", async () => {
    const banco = bancoFalso();
    const { ref } = await carregarInstancia(banco.client, CLINICA, NUMERO_A);

    expect(ref).toMatchObject({
      clinicId: CLINICA,
      accountId: NUMERO_A,
      instanceToken: `token-de-${NUMERO_A}`,
      instanceId: "fake-a",
    });
    const conta = banco.consultas.find((c) => c.tabela === "whatsapp_account");
    expect(conta?.filtros).toContainEqual(["id", NUMERO_A]);
    expect(conta?.filtros).toContainEqual(["clinic_id", CLINICA]);
    const segredo = banco.consultas.find(
      (c) => c.tabela === "whatsapp_account_secret",
    );
    expect(segredo?.filtros).toContainEqual(["account_id", NUMERO_A]);
    expect(segredo?.filtros).toContainEqual(["clinic_id", CLINICA]);
  });
});
