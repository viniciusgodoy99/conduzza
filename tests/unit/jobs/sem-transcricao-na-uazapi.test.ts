import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/integrations/whatsapp/provider", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/whatsapp/provider")>()),
  getWhatsAppProvider: () => ({ isOfficialChannel: false }),
}));
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  carregarInstancia: vi.fn(),
  falhaPermiteRetry: () => false,
  sendWhatsAppMedia: vi.fn(),
  sendWhatsAppMenu: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

import { FakeProvider } from "@/lib/integrations/whatsapp/fake";
import type { InstanceRef } from "@/lib/integrations/whatsapp/provider";
import { carregarInstancia } from "@/lib/integrations/whatsapp/send";
import { UazapiProvider } from "@/lib/integrations/whatsapp/uazapi";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate } from "./banco-falso";

// AG6b (D-56, D-91 e D-94): a uazapi NUNCA transcreve. O download leva
// transcribe: false sempre, explicito (sem a chave na chamada, a uazapi
// usaria a chave salva na instancia), e nunca openai_apikey, nem com uma
// chave antiga ainda no ambiente; a transcricao que o provedor mandar e
// ignorada; o worker nunca grava message.transcript. A transcricao e do
// servidor do Conduzza, so no turno da IA (lib/integrations/llm/
// transcricao.ts).

const REF: InstanceRef = {
  clinicId: "clinica-teste",
  serverUrl: "https://uazapi.exemplo",
  instanceToken: "token-instancia",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("o download da uazapi", () => {
  it("leva transcribe: false e nunca openai_apikey (nem com a chave antiga no ambiente)", async () => {
    vi.stubEnv("UAZAPI_OPENAI_KEY", "sk-chave-antiga");
    const corpos: Record<string, unknown>[] = [];
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      corpos.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          mimetype: "audio/mpeg",
          base64Data: Buffer.from("mp3").toString("base64"),
          // Um provedor que transcreva sem ser pedido.
          transcription: "texto do audio do paciente",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const provedor = new UazapiProvider({ fetchFn });
    const baixado = await provedor.downloadMedia(REF, "3EB0AUDIO");
    expect(corpos).toHaveLength(1);
    expect(corpos[0]).toMatchObject({
      id: "3EB0AUDIO",
      return_base64: true,
      return_link: false,
      generate_mp3: true,
      transcribe: false,
    });
    expect(corpos[0]).not.toHaveProperty("openai_apikey");
    expect(JSON.stringify(corpos[0])).not.toContain("sk-chave-antiga");
    // A transcricao do provedor nunca volta.
    expect(baixado).toEqual({
      ok: true,
      base64: Buffer.from("mp3").toString("base64"),
      mimetype: "audio/mpeg",
    });
    expect(baixado).not.toHaveProperty("transcript");
  });

  it("o provedor falso tambem nunca transcreve", async () => {
    const baixado = await new FakeProvider().downloadMedia(REF, "3EB0X");
    expect(baixado).not.toHaveProperty("transcript");
    expect(baixado.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// O worker (baixar_midia)
// ---------------------------------------------------------------------------

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const MENSAGEM = "33333333-3333-4333-8333-333333333333";
const downloadMedia = vi.fn();

function job(): Job {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    clinic_id: CLINICA,
    kind: "baixar_midia",
    payload: {
      message_id: MENSAGEM,
      wa_message_id: "3EB0AUDIO",
      whatsapp_account_id: NUMERO,
    },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
  };
}

beforeEach(() => {
  downloadMedia.mockReset();
  downloadMedia.mockResolvedValue({
    ok: true,
    base64: Buffer.from("audio").toString("base64"),
    mimetype: "audio/mpeg",
    transcript: "um provedor antigo que ainda mande texto",
  });
  vi.mocked(carregarInstancia).mockResolvedValue({
    provider: { downloadMedia } as never,
    ref: { instanceId: "instancia" } as never,
  });
});

describe("o worker do download", () => {
  it.each([
    ["o audio do paciente", { content_type: "audio", pelo_celular: false }],
    ["o audio da clinica pelo celular", { content_type: "audio", pelo_celular: true }],
  ])("%s: baixa sem pedir transcricao e nunca grava transcript", async (_nome, linha) => {
    const db = bancoFalso({
      tabelas: {
        message: (chamada) =>
          eUpdate(chamada)
            ? { data: [{ id: MENSAGEM }], error: null }
            : {
                data: {
                  id: MENSAGEM,
                  deleted_at: null,
                  whatsapp_account_id: NUMERO,
                  ...linha,
                },
                error: null,
              },
        whatsapp_account: () => ({ data: { removido_em: null }, error: null }),
      },
      rpcs: {
        confirmar_posse_job: () => ({ data: true, error: null }),
        concluir_job: () => ({ data: null, error: null }),
      },
      storage: () => ({ data: { path: "ok" }, error: null }),
    });
    expect(await executarJobComPosse(db.admin, "worker", job())).toBe("concluido");
    // So a referencia e o id: nenhuma opcao de transcrever.
    expect(downloadMedia).toHaveBeenCalledTimes(1);
    expect(downloadMedia.mock.calls[0]).toHaveLength(2);
    const [update] = db.updatesEm("message") as Record<string, unknown>[];
    expect(update?.media_url).toBe(`storage://midia-conversas/${CLINICA}/${MENSAGEM}`);
    expect(update).not.toHaveProperty("transcript");
    // A leitura da mensagem nem pede mais a coluna transcript.
    const leitura = db.tabelas.find((c) => c.tabela === "message" && !eUpdate(c));
    const select = leitura?.metodos.find((m) => m.metodo === "select");
    expect(String(select?.args[0])).not.toContain("transcript");
  });
});
