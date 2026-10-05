import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JANELA_DO_ECO_PARA_TERMO_MS,
  ecoContaParaTermo,
  parseInboundEvent,
} from "@/lib/integrations/whatsapp/inbound";

// Termo-chave escrito pela CLINICA no celular conectado (pedido do dono em
// 02/10/2026, item 0 do plano "Automacoes de fluxo e CRM"). Desde 05/10/2026
// o eco (fromMe) vira linha na conversa (registrar_mensagem_do_celular), mas
// o termo-chave ficou como estava: a separacao entre eco novo e reentrega
// continua sendo o horario de envio do payload (ecoContaParaTermo) mais a
// marca por wa_message_id, sem depender do "inserted" da gravacao. O que se
// prova aqui:
//   - o parser leva o texto do eco (para a conversa e o termo; nunca para
//     log);
//   - a janela: eco recente conta; atrasado, reentregue tarde ou sem
//     horario nao conta (e nem chega a ir ao banco);
//   - "nunca reentrega": a rota marca o eco por wa_message_id no banco
//     (marcar_eco_para_termo) ANTES de mover e so move quando a marca nasceu
//     agora; reentrega (false) ou falha ao marcar nao movem;
//   - o contato e o que a RPC da gravacao devolveu; sem contato (a RPC
//     ignorou a mensagem) nada marca nem move. O eco de numero da
//     plataforma ou de colisao de id, que nao vira linha, ainda move com o
//     contato que a RPC devolveu (casos em whatsapp-route.test.ts);
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
  it("o parser leva o texto aparado do eco (vai para a conversa); sem texto, o body é null", () => {
    const comTexto = parseInboundEvent(eco());
    expect(comTexto).toMatchObject({
      kind: "clinic_device_reply",
      body: "Olá! Seja bem-vinda à Clínica Salud Care",
    });
    // Arquivo sem legenda: o eco segue, com body nulo.
    const semTexto = parseInboundEvent(
      eco({ text: "   ", messageType: "AudioMessage" }),
    );
    expect(semTexto).toMatchObject({
      kind: "clinic_device_reply",
      contentType: "audio",
      body: null,
    });
    // Texto em branco sem arquivo não tem o que mostrar: nem vira evento.
    expect(parseInboundEvent(eco({ text: "   " }))).toBeNull();
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
  return { data: null, error: null };
}

const mover = vi.fn();
// A marca do eco no banco: true = eco novo.
const marcar = vi.fn<(args: unknown) => Promise<Resultado>>();
// A gravacao da mensagem do celular: devolve o contato que a RPC achou.
const registrar = vi.fn<(args: unknown) => Promise<Resultado>>();
const rpc = vi.fn((nome: string, args: unknown): Promise<Resultado> =>
  nome === "marcar_eco_para_termo"
    ? marcar(args)
    : nome === "registrar_mensagem_do_celular"
      ? registrar(args)
      : Promise.resolve({ data: null, error: null }),
);

function registroCom(
  contato: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    data: {
      inserted: true,
      contact_id: contato,
      conversation_id: "conversa-1",
      message_id: "mensagem-1",
      whatsapp_account_id: NUMERO,
      automatica: false,
      ...extra,
    },
    error: null,
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => cadeia(() => responder(tabela)),
    rpc,
  }),
}));
vi.mock("@/lib/integrations/whatsapp/termo-chave", () => ({
  tentarMoverPorTermo: mover,
}));
// A gravacao da mensagem do celular e a de verdade (com o rpc dublado).
vi.mock("@/lib/integrations/whatsapp/ingest", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/integrations/whatsapp/ingest")
  >()),
  ingerirMensagemRecebida: vi.fn(),
}));
vi.mock("@/lib/integrations/whatsapp/interceptar-resposta", () => ({
  interceptarRespostaDePaciente: vi.fn(),
}));
// A espera da nova tentativa da saudacao para paciente novo, sem esperar.
const esperar = vi.fn<(ms: number) => Promise<void>>();
vi.mock("@/lib/utils/esperar", () => ({ esperar }));

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
  registrar.mockReset();
  registrar.mockResolvedValue(registroCom(CONTATO));
  rpc.mockClear();
  esperar.mockReset();
  esperar.mockResolvedValue(undefined);
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

  it("o contato do termo é o que a RPC da gravação devolveu", async () => {
    registrar.mockResolvedValue(registroCom("contato-achado-pela-rpc"));

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    // A gravacao vem antes da marca: sem contato da RPC nao ha termo.
    expect(registrar.mock.invocationCallOrder[0]!).toBeLessThan(
      marcar.mock.invocationCallOrder[0]!,
    );
    expect(mover.mock.calls[0]![1]).toMatchObject({
      contactId: "contato-achado-pela-rpc",
    });
  });

  it("reentrega da gravação (inserted=false) ainda passa pela marca, que decide", async () => {
    registrar.mockResolvedValue(registroCom(CONTATO, { inserted: false }));
    marcar.mockResolvedValue({ data: false, error: null });

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(mover).not.toHaveBeenCalled();
  });

  it("contato desconhecido (a RPC ignorou, mesmo depois das novas tentativas): não marca nem move", async () => {
    registrar.mockResolvedValue({
      data: {
        inserted: false,
        ignorada: "contato_desconhecido",
        contact_id: null,
        conversation_id: null,
        message_id: null,
        whatsapp_account_id: NUMERO,
        automatica: null,
      },
      error: null,
    });

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(200);
    // Eco recente: a saudacao para paciente novo tenta mais 2 vezes.
    expect(registrar).toHaveBeenCalledTimes(3);
    expect(esperar).toHaveBeenCalledTimes(2);
    expect(marcar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
  });

  it("falha da gravação: 500, sem termo, e o log não leva o texto", async () => {
    registrar.mockResolvedValue({ data: null, error: { code: "XX000" } });

    const resposta = await POST(pedido(eco()));

    expect(resposta.status).toBe(500);
    expect(marcar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
    const tudo = saida.join("");
    expect(tudo).toContain("webhook_mensagem_do_celular_falhou");
    expect(tudo).not.toContain("bem-vinda");
    expect(tudo).not.toContain("Salud");
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
