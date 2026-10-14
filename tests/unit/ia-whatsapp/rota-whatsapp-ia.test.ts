import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BancoEmMemoria } from "./banco-em-memoria";

// A rota do webhook do WhatsApp no E3 (ramo message_received): enfileira o
// turno da IA so quando a mensagem foi inserida agora, numa conversa que a
// ingestao deixou com a IA, individual e sem eco do interceptador; grupo,
// status e canal tiram a conversa da IA e nunca enfileiram; a excecao do
// interceptador tira com falha tecnica; falha nessas RPCs nunca vira 500; e
// a resposta ao provedor e SO { ok: true }.

const CLINICA = "acd9c539-585e-4f2a-a195-712c70099564";
const NUMERO = "a0000000-0000-4000-8000-000000000001";
const CONVERSA = "c0000000-0000-4000-8000-000000000001";
const MENSAGEM = "m0000000-0000-4000-8000-000000000001";
const SEGREDO = "segredo-do-numero";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  ingestao: null as unknown,
  desfecho: "sem_intencao" as unknown,
  interceptadorLanca: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    (estado.banco as { cliente: () => unknown }).cliente(),
}));
vi.mock("@/lib/integrations/whatsapp/ingest", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/whatsapp/ingest")>()),
  ingerirMensagemRecebida: async () => ({
    data: estado.ingestao,
    error: null,
  }),
}));
vi.mock("@/lib/integrations/whatsapp/interceptar-resposta", () => ({
  interceptarRespostaDePaciente: async () => {
    if (estado.interceptadorLanca) {
      throw new Error("quebrou");
    }
    return estado.desfecho;
  },
}));
vi.mock("@/lib/integrations/whatsapp/trava-celular", () => ({
  conferirConexaoDoWebhook: async () => ({ resultado: "confirmada" }),
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: async () => null,
}));

const { POST } = await import("@/app/api/webhooks/whatsapp/route");

let banco: BancoEmMemoria;
let logs: string[];

function ingestao(extra: Record<string, unknown> = {}) {
  return {
    inserted: true,
    contact_id: "contato-1",
    contact_created: false,
    conversation_id: CONVERSA,
    message_id: MENSAGEM,
    whatsapp_account_id: NUMERO,
    ia_atendendo: true,
    ...extra,
  };
}

function pedido(evento: Record<string, unknown>) {
  return new NextRequest(
    `https://exemplo.test/api/webhooks/whatsapp?clinic=${CLINICA}&account=${NUMERO}&secret=${SEGREDO}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(evento),
    },
  );
}

const RECEBIDA = {
  kind: "message_received",
  phone: "+5584999990001",
  name: "Equipe",
  waMessageId: "wa-1",
  contentType: "texto",
  body: "Quanto custa a consulta?",
};

beforeEach(() => {
  banco = new BancoEmMemoria();
  estado.banco = banco;
  estado.ingestao = ingestao();
  estado.desfecho = "sem_intencao";
  estado.interceptadorLanca = false;
  banco.linhas("whatsapp_account").push({
    id: NUMERO,
    clinic_id: CLINICA,
    removido_em: null,
    provider: "fake",
    connection_status: "conectado",
  });
  banco.linhas("whatsapp_account_secret").push({
    account_id: NUMERO,
    clinic_id: CLINICA,
    webhook_secret: SEGREDO,
    instance_token: null,
  });
  banco.rpc("enfileirar_resposta_da_ia", () => ({
    data: { codigo: "enfileirado", job_id: "j-1" },
    error: null,
  }));
  banco.rpc("tirar_conversa_da_ia_pelo_servidor", () => ({
    data: true,
    error: null,
  }));
  logs = [];
  const capturar = (linha: string | Uint8Array): boolean => {
    logs.push(String(linha));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.restoreAllMocks();
  expect(logs.join("")).not.toContain("Quanto custa");
  expect(logs.join("")).not.toContain("+5584999990001");
});

describe("message_received no E3", () => {
  it("conversa da IA, individual, inserida, sem eco: enfileira com os ids e responde só { ok: true }", async () => {
    const resposta = await POST(pedido(RECEBIDA));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_message_id: MENSAGEM,
      },
    ]);
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([]);
  });

  it.each([
    ["conversa com a equipe", { ia_atendendo: false }],
    ["banco antes da M2 (sem a chave)", { ia_atendendo: undefined }],
    ["reentrega", { inserted: false }],
  ])("%s: não enfileira", async (_nome, extra) => {
    estado.ingestao = ingestao(extra);
    const resposta = await POST(pedido(RECEBIDA));
    expect(await resposta.json()).toEqual({ ok: true });
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
  });

  it("o interceptador tratou com eco: sem turno da IA", async () => {
    estado.desfecho = "tratou_com_eco";
    await POST(pedido(RECEBIDA));
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([]);
  });

  it.each([
    "nao_texto",
    "alvo_nenhum",
    "fatos_ilegiveis",
    "reconheceu_sem_efeito",
  ])("desfecho %s: enfileira", async (desfecho) => {
    estado.desfecho = desfecho;
    await POST(pedido(RECEBIDA));
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toHaveLength(1);
  });

  it("grupo, status ou canal numa conversa da IA: tira (nao_individual) e nunca enfileira", async () => {
    const resposta = await POST(pedido({ ...RECEBIDA, individual: false }));
    expect(await resposta.json()).toEqual({ ok: true });
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_motivo: "nao_individual",
      },
    ]);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
  });

  it("não individual fora da IA: nada", async () => {
    estado.ingestao = ingestao({ ia_atendendo: false });
    await POST(pedido({ ...RECEBIDA, individual: false }));
    expect(banco.chamadas.map((c) => c.nome)).not.toContain(
      "tirar_conversa_da_ia_pelo_servidor",
    );
  });

  it("exceção no interceptador: tira com falha técnica, sem enfileirar, e o 200 continua", async () => {
    estado.interceptadorLanca = true;
    const resposta = await POST(pedido(RECEBIDA));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
    expect(banco.chamadasDe("tirar_conversa_da_ia_pelo_servidor")).toEqual([
      {
        p_clinic_id: CLINICA,
        p_conversation_id: CONVERSA,
        p_motivo: "falha_tecnica",
      },
    ]);
    expect(banco.chamadasDe("enfileirar_resposta_da_ia")).toEqual([]);
  });

  it("falha ao enfileirar ou ao tirar: log com ids e o 200 continua", async () => {
    banco.rpc("enfileirar_resposta_da_ia", () => ({
      data: null,
      error: { code: "57014" },
    }));
    const resposta = await POST(pedido(RECEBIDA));
    expect(resposta.status).toBe(200);
    expect(logs.join("")).toContain("webhook_ia_nao_enfileirada");
    banco.rpc("tirar_conversa_da_ia_pelo_servidor", () => {
      throw new Error("rede");
    });
    const outra = await POST(pedido({ ...RECEBIDA, individual: false }));
    expect(outra.status).toBe(200);
  });

  it("o banco recusa enfileirar (nao_liberada): só o código no log, 200", async () => {
    banco.rpc("enfileirar_resposta_da_ia", () => ({
      data: { codigo: "nao_liberada", job_id: null },
      error: null,
    }));
    const resposta = await POST(pedido(RECEBIDA));
    expect(resposta.status).toBe(200);
    expect(logs.join("")).toContain('"status":"nao_liberada"');
  });

  it("mensagem ignorada (número próprio): só { ok: true }", async () => {
    estado.ingestao = {
      inserted: false,
      ignorada: "numero_proprio",
      contact_id: null,
      contact_created: false,
      conversation_id: null,
      message_id: null,
      whatsapp_account_id: NUMERO,
    };
    const resposta = await POST(pedido(RECEBIDA));
    expect(await resposta.json()).toEqual({ ok: true });
    expect(banco.chamadas).toEqual([]);
  });
});
