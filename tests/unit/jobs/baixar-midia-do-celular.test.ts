import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/integrations/whatsapp/provider", () => ({
  getWhatsAppProvider: () => ({ isOfficialChannel: false }),
}));
vi.mock("@/lib/integrations/whatsapp/send", () => ({
  carregarInstancia: vi.fn(),
  falhaPermiteRetry: () => false,
  sendWhatsAppMedia: vi.fn(),
  sendWhatsAppMenu: vi.fn(),
  sendWhatsAppText: vi.fn(),
}));

import { carregarInstancia } from "@/lib/integrations/whatsapp/send";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";

import { bancoFalso, eUpdate } from "./banco-falso";

// baixar_midia de uma mensagem enviada direto pelo WhatsApp da clinica
// (pelo_celular, 05/10/2026). O arquivo baixa e vai para o acervo como
// qualquer outro, mas o AUDIO nao vai para a transcricao: minimizacao (a
// clinica sabe o que falou) e o mesmo tratamento do audio enviado pelo
// Atendimento, que nunca e transcrito. O audio do paciente continua.

const CLINICA = "11111111-1111-4111-8111-111111111111";
const NUMERO = "22222222-2222-4222-8222-222222222222";
const MENSAGEM = "33333333-3333-4333-8333-333333333333";
const JOB = "66666666-6666-4666-8666-666666666666";
const WORKER = "worker-de-teste";

const downloadMedia = vi.fn();

function job(): Job {
  return {
    id: JOB,
    clinic_id: CLINICA,
    kind: "baixar_midia",
    payload: {
      message_id: MENSAGEM,
      wa_message_id: "3EB0CELULAR",
      whatsapp_account_id: NUMERO,
    },
    attempts: 1,
    max_attempts: 8,
    whatsapp_account_id: NUMERO,
  };
}

function banco(linha: Record<string, unknown>) {
  return bancoFalso({
    tabelas: {
      message: (chamada) =>
        eUpdate(chamada)
          ? { data: [{ id: MENSAGEM }], error: null }
          : {
              data: {
                id: MENSAGEM,
                transcript: null,
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
}

beforeEach(() => {
  downloadMedia.mockReset();
  downloadMedia.mockResolvedValue({
    ok: true,
    base64: Buffer.from("audio").toString("base64"),
    mimetype: "audio/ogg; codecs=opus",
    // Um provedor que transcreva mesmo sem ser pedido.
    transcript: "texto do audio",
  });
  vi.mocked(carregarInstancia).mockResolvedValue({
    provider: { downloadMedia } as never,
    ref: { instanceId: "instancia" } as never,
  });
});

describe("baixar_midia de mensagem enviada pelo celular", () => {
  it("áudio da clínica baixa, mas não pede transcrição nem grava texto", async () => {
    const db = banco({ content_type: "audio", pelo_celular: true });
    const desfecho = await executarJobComPosse(db.admin, WORKER, job());

    expect(desfecho).toBe("concluido");
    expect(downloadMedia).toHaveBeenCalledTimes(1);
    expect(downloadMedia.mock.calls[0]?.[2]).toEqual({ transcribe: false });
    const [update] = db.updatesEm("message") as Record<string, unknown>[];
    expect(update?.media_url).toBe(
      `storage://midia-conversas/${CLINICA}/${MENSAGEM}`,
    );
    expect(update).not.toHaveProperty("transcript");
  });

  it("a coluna pelo_celular é lida junto com a mensagem", async () => {
    const db = banco({ content_type: "audio", pelo_celular: true });
    await executarJobComPosse(db.admin, WORKER, job());
    const leitura = db.tabelas.find(
      (c) => c.tabela === "message" && !eUpdate(c),
    );
    const select = leitura?.metodos.find((m) => m.metodo === "select");
    expect(String(select?.args[0])).toContain("pelo_celular");
  });

  it("áudio do paciente continua transcrito", async () => {
    const db = banco({ content_type: "audio", pelo_celular: false });
    await executarJobComPosse(db.admin, WORKER, job());

    expect(downloadMedia.mock.calls[0]?.[2]).toEqual({ transcribe: true });
    const [update] = db.updatesEm("message") as Record<string, unknown>[];
    expect(update?.transcript).toBe("texto do audio");
  });

  it("leitura da mensagem que falha volta para a fila, não morre como não encontrada", async () => {
    // Ex.: o codigo publicado antes da migration (coluna pelo_celular ainda
    // nao existe, 42703). Antes o erro era ignorado e o job morria de vez.
    const db = bancoFalso({
      tabelas: {
        message: () => ({
          data: null,
          error: { code: "42703", message: "" },
        }),
      },
      rpcs: {
        confirmar_posse_job: () => ({ data: true, error: null }),
        falhar_job: () => ({ data: null, error: null }),
      },
    });
    const desfecho = await executarJobComPosse(db.admin, WORKER, job());

    expect(desfecho).toBe("falhou");
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(db.chamadasDe("falhar_job")).toEqual([
      expect.objectContaining({
        p_erro: "leitura_falhou",
        p_definitivo: false,
      }),
    ]);
    // Nao e a ultima tentativa: nada de marcar o arquivo como indisponivel.
    expect(db.updatesEm("message")).toEqual([]);
  });

  it("foto da clínica baixa normalmente, sem transcrição", async () => {
    downloadMedia.mockResolvedValue({
      ok: true,
      base64: Buffer.from("foto").toString("base64"),
      mimetype: "image/jpeg",
      transcript: null,
    });
    const db = banco({ content_type: "imagem", pelo_celular: true });
    const desfecho = await executarJobComPosse(db.admin, WORKER, job());

    expect(desfecho).toBe("concluido");
    expect(downloadMedia.mock.calls[0]?.[2]).toEqual({ transcribe: false });
    const [update] = db.updatesEm("message") as Record<string, unknown>[];
    expect(update?.media_mimetype).toBe("image/jpeg");
  });
});
