import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JANELA_DO_ECO_PARA_TERMO_MS,
  ecoContaParaTermo,
  parseInboundEvent,
} from "@/lib/integrations/whatsapp/inbound";

// Termo-chave escrito pela CLINICA no celular conectado (pedido do dono em
// 02/10/2026, item 0 do plano "Automacoes de fluxo e CRM"). O eco (fromMe)
// nao vira mensagem na conversa, entao nao existe a "linha inserida" que na
// ingestao separa mensagem nova de reentrega: a separacao e pelo horario de
// envio do payload (ecoContaParaTermo). O que se prova aqui:
//   - o parser leva o texto do eco (so para o termo; nunca para log);
//   - a janela: eco recente conta; atrasado, reentregue tarde ou sem
//     horario nao conta (e nem chega a ir ao banco);
//   - "nunca reentrega": a rota marca o eco por wa_message_id no banco
//     (marcar_eco_para_termo) ANTES de mover e so move quando a marca nasceu
//     agora; reentrega (false) ou falha ao marcar nao movem;
//   - a rota chama o movimento com quem escreveu = clinica, sem autor (nao
//     ha pessoa do sistema por tras do celular), e o 200 nunca depende dele.
// A marca em si (unica por clinica e wa_message_id, poda, so service role)
// esta em tests/integration/termo-chave.test.ts e tests/rls/crm-leva-a.test.ts.
// O movimento em si (etapas, guarda, trilha) esta em
// tests/unit/whatsapp/termo-chave.test.ts.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTATO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const AGORA = Date.UTC(2026, 9, 2, 15, 0, 0);

function eco(campos: Record<string, unknown> = {}) {
  return {
    EventType: "messages",
    message: {
      messageid: "wa-eco-1",
      chatid: "5584970000001@s.whatsapp.net",
      sender_pn: "5584970000001@s.whatsapp.net",
      fromMe: true,
      type: "text",
      messageType: "ExtendedTextMessage",
      text: "  Olá! Seja bem-vinda à Clínica Salud Care  ",
      messageTimestamp: AGORA - 3_000,
      ...campos,
    },
  };
}

describe("eco do celular: texto e janela", () => {
  it("o parser leva o texto aparado do eco; sem texto vira null", () => {
    const comTexto = parseInboundEvent(eco());
    expect(comTexto).toMatchObject({
      kind: "clinic_device_reply",
      body: "Olá! Seja bem-vinda à Clínica Salud Care",
    });
    const semTexto = parseInboundEvent(eco({ text: "   " }));
    expect(semTexto).toMatchObject({
      kind: "clinic_device_reply",
      body: null,
    });
  });

  it("eco recente conta; o da beira da janela também", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(ecoContaParaTermo(iso(AGORA - 3_000), AGORA)).toBe(true);
    expect(
      ecoContaParaTermo(iso(AGORA - JANELA_DO_ECO_PARA_TERMO_MS), AGORA),
    ).toBe(true);
    // Folga de relogio: ate 1 minuto no futuro.
    expect(ecoContaParaTermo(iso(AGORA + 30_000), AGORA)).toBe(true);
  });

  it("eco atrasado, reentregue tarde, do futuro distante ou sem horário não conta", () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(
      ecoContaParaTermo(iso(AGORA - JANELA_DO_ECO_PARA_TERMO_MS - 1), AGORA),
    ).toBe(false);
    expect(ecoContaParaTermo(iso(AGORA - 60 * 60 * 1000), AGORA)).toBe(false);
    expect(ecoContaParaTermo(iso(AGORA + 5 * 60 * 1000), AGORA)).toBe(false);
    expect(ecoContaParaTermo(null, AGORA)).toBe(false);
    expect(ecoContaParaTermo("nao e data", AGORA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A rota, com o banco trocado por respostas fixas e o movimento por um
// espiao.

type Resultado = { data: unknown; error: { code?: string } | null };

function cadeia(resultado: () => Resultado) {
  const alvo: Record<string, unknown> = {};
  for (const metodo of [
    "select",
    "update",
    "insert",
    "eq",
    "neq",
    "is",
    "in",
    "or",
  ]) {
    alvo[metodo] = () => alvo;
  }
  alvo.maybeSingle = () => Promise.resolve(resultado());
  alvo.then = (ok: (valor: Resultado) => unknown) =>
    Promise.resolve(resultado()).then(ok);
  return alvo;
}

function responder(tabela: string): Resultado {
  if (tabela === "whatsapp_account_secret") {
    return {
      data: {
        account_id: NUMERO,
        clinic_id: CLINICA,
        webhook_secret: "segredo",
        instance_token: null,
      },
      error: null,
    };
  }
  if (tabela === "whatsapp_account") {
    return {
      data: {
        id: NUMERO,
        clinic_id: CLINICA,
        removido_em: null,
        provider: "uazapi",
        connection_status: "conectado",
      },
      error: null,
    };
  }
  if (tabela === "contact") {
    return { data: { id: CONTATO }, error: null };
  }
  return { data: null, error: null };
}

const mover = vi.fn();
// A marca do eco no banco: true = eco novo. Outras RPCs da rota ficam como
// antes (sem resposta).
const marcar = vi.fn<(args: unknown) => Promise<Resultado>>();
const rpc = vi.fn((nome: string, args: unknown) =>
  nome === "marcar_eco_para_termo" ? marcar(args) : undefined,
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => cadeia(() => responder(tabela)),
    rpc,
  }),
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: mover,
}));
vi.mock("@/lib/integrations/whatsapp/ingest", () => ({
  ingerirMensagemRecebida: vi.fn(),
}));
vi.mock("@/lib/integrations/whatsapp/interceptar-resposta", () => ({
  interceptarRespostaDePaciente: vi.fn(),
}));

const { POST } = await import("@/app/api/webhooks/whatsapp/route");

function pedido(corpo: unknown): NextRequest {
  return new NextRequest(
    `https://exemplo.test/api/webhooks/whatsapp?clinic=${CLINICA}&account=${NUMERO}&secret=segredo`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    },
  );
}

let saida: string[] = [];

beforeEach(() => {
  mover.mockReset();
  mover.mockResolvedValue(null);
  marcar.mockReset();
  marcar.mockResolvedValue({ data: true, error: null });
  rpc.mockClear();
  saida = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  const capturar = (pedaco: string | Uint8Array): boolean => {
    saida.push(String(pedaco));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capturar);
  vi.spyOn(process.stderr, "write").mockImplementation(capturar);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/whatsapp: termo da clínica no eco do celular", () => {
  it("eco recente com texto marca o eco e move como clínica, sem autor", async () => {
    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(marcar).toHaveBeenCalledWith({
      p_clinic_id: CLINICA,
      p_wa_message_id: "wa-eco-1",
    });
    // A marca vem ANTES do movimento.
    expect(marcar.mock.invocationCallOrder[0]!).toBeLessThan(
      mover.mock.invocationCallOrder[0]!,
    );
    expect(mover).toHaveBeenCalledTimes(1);
    expect(mover.mock.calls[0]![1]).toEqual({
      clinicId: CLINICA,
      contactId: CONTATO,
      corpo: "Olá! Seja bem-vinda à Clínica Salud Care",
      quemEscreveu: "clinica",
      userId: null,
    });
  });

  it("reentrega do mesmo eco dentro da janela não move (a marca já existia)", async () => {
    // O cenario do achado: o eco moveu, alguem voltou o lead a mao e o
    // provedor reentregou o MESMO evento 70 s depois. A janela deixa passar;
    // a marca no banco nao.
    marcar.mockResolvedValue({ data: false, error: null });
    vi.setSystemTime(AGORA + 70_000);

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(mover).not.toHaveBeenCalled();
  });

  it("falha ao marcar não move, não derruba o 200 e o log leva só ids", async () => {
    marcar.mockResolvedValue({ data: null, error: { code: "57014" } });

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    expect(mover).not.toHaveBeenCalled();
    const tudo = saida.join("");
    expect(tudo).toContain("termo_chave_marcar_eco_falhou");
    expect(tudo).toContain('"error_code":"57014"');
    expect(tudo).not.toContain("bem-vinda");
    expect(tudo).not.toContain("Salud");
  });

  it("eco velho (reentrega tardia ou sincronia de histórico) não move nem vai ao banco", async () => {
    const resposta = await POST(
      pedido(eco({ messageTimestamp: AGORA - 10 * 60 * 1000 })),
    );
    expect(resposta.status).toBe(200);
    expect(marcar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
  });

  it("eco sem horário não move: não dá para provar que é novo", async () => {
    const resposta = await POST(pedido(eco({ messageTimestamp: undefined })));
    expect(resposta.status).toBe(200);
    expect(marcar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
  });

  it("eco sem texto (figurinha, áudio) não move nem marca", async () => {
    const resposta = await POST(
      pedido(eco({ text: undefined, messageType: "AudioMessage" })),
    );
    expect(resposta.status).toBe(200);
    expect(marcar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
  });

  it("falha do movimento não derruba o 200 e o log não leva o texto", async () => {
    mover.mockRejectedValue(new Error("Seja bem-vinda quebrou"));

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    const tudo = saida.join("");
    expect(tudo).toContain("termo_chave_falhou");
    expect(tudo).toContain('"kind":"clinica"');
    expect(tudo).not.toContain("bem-vinda");
    expect(tudo).not.toContain("Salud");
  });
});
