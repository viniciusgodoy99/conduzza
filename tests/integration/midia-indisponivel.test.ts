import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { FakeProvider } from "@/lib/integrations/whatsapp/fake";
import {
  MIDIA_BUCKET,
  garantirBucketDeMidia,
  processarLote,
} from "@/lib/jobs/worker";
import { adminClient } from "../rls/stack";

// Revisao de liberacao de 24/09/2026 (achados 11, 24, 29 e 130), contra o
// banco REAL. Depende da migration 20260924102000_midia_indisponivel.sql e da
// coluna message.media_mimetype (migration do grupo de entrada do WhatsApp).
//
// Antes: o job baixar_midia morria como 'falhou' na fila e a mensagem
// continuava com a URL do provedor, e a bolha dizia "Baixando o arquivo" para
// sempre. Agora a desistencia fica escrita na mensagem.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

async function criarMensagemComJob(
  nome: string,
  opts: { maxAttempts: number },
): Promise<{ clinicId: string; messageId: string; jobId: string }> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Midia ${nome} ${sufixo}`,
      slug: `midia-${nome}-${sufixo}`,
      // O motor de producao ignora a clinica: so o processarLote daqui
      // executa os jobs, e o spy do provedor falso vale.
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  clinicasCriadas.push(clinicId);
  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849700${String(clinicasCriadas.length).padStart(5, "0")}`,
      name: "Contato Midia",
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({ clinic_id: clinicId, contact_id: contato!.id })
    .select("id")
    .single()
    .throwOnError();
  const waMessageId = `midia-${nome}-${sufixo}`;
  const { data: mensagem } = await admin
    .from("message")
    .insert({
      clinic_id: clinicId,
      conversation_id: conversa!.id,
      wa_message_id: waMessageId,
      direction: "entrada",
      author: "paciente",
      content_type: "documento",
      media_url: "https://mmg.whatsapp.net/x/doc.enc",
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: job } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind: "baixar_midia",
      max_attempts: opts.maxAttempts,
      payload: { message_id: mensagem!.id, wa_message_id: waMessageId },
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    clinicId,
    messageId: mensagem!.id as string,
    jobId: job!.id as string,
  };
}

async function lerMensagem(id: string) {
  const { data } = await admin
    .from("message")
    .select("media_url, media_mimetype")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as { media_url: string | null; media_mimetype: string | null };
}

async function lerJob(id: string) {
  const { data } = await admin
    .from("job_queue")
    .select("status, last_error")
    .eq("id", id)
    .single()
    .throwOnError();
  return data as { status: string; last_error: string | null };
}

beforeAll(async () => {
  await garantirBucketDeMidia(admin);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("mídia que não vem mais ganha estado final", () => {
  it("arquivo grande demais desiste na primeira e marca grande_demais", async () => {
    const { messageId, jobId } = await criarMensagemComJob("grande", {
      maxAttempts: 8,
    });
    vi.spyOn(FakeProvider.prototype, "downloadMedia").mockResolvedValue({
      ok: false,
      errorCode: "uazapi_download_413",
      message: "",
    });

    await processarLote(admin, "teste-midia");

    // Definitivo: nao espera as 8 tentativas.
    expect(await lerJob(jobId)).toEqual({
      status: "falhou",
      last_error: "download:uazapi_download_413",
    });
    expect((await lerMensagem(messageId)).media_url).toBe(
      "indisponivel://grande_demais",
    );
  });

  it("falha passageira só marca na ÚLTIMA tentativa", async () => {
    const { messageId, jobId } = await criarMensagemComJob("ultima", {
      maxAttempts: 1,
    });
    vi.spyOn(FakeProvider.prototype, "downloadMedia").mockResolvedValue({
      ok: false,
      errorCode: "uazapi_download_500",
      message: "",
    });

    await processarLote(admin, "teste-midia");

    expect((await lerJob(jobId)).status).toBe("falhou");
    expect((await lerMensagem(messageId)).media_url).toBe(
      "indisponivel://download_falhou",
    );
  });

  it("falha passageira com tentativas sobrando NÃO marca", async () => {
    const { messageId, jobId } = await criarMensagemComJob("sobrando", {
      maxAttempts: 8,
    });
    vi.spyOn(FakeProvider.prototype, "downloadMedia").mockResolvedValue({
      ok: false,
      errorCode: "uazapi_download_500",
      message: "",
    });

    await processarLote(admin, "teste-midia");

    expect((await lerJob(jobId)).status).toBe("pendente");
    expect((await lerMensagem(messageId)).media_url).toBe(
      "https://mmg.whatsapp.net/x/doc.enc",
    );
  });

  it("sucesso grava storage:// e o tipo real em media_mimetype", async () => {
    const { clinicId, messageId } = await criarMensagemComJob("sucesso", {
      maxAttempts: 8,
    });

    await processarLote(admin, "teste-midia");

    const depois = await lerMensagem(messageId);
    expect(depois.media_url).toBe(
      `storage://${MIDIA_BUCKET}/${clinicId}/${messageId}`,
    );
    // O fake devolve audio/mpeg: o tipo do provedor fica na mensagem.
    expect(depois.media_mimetype).toBe("audio/mpeg");
  });

  // Varios numeros por clinica (Fase 2, docs/07): o arquivo so baixa pela
  // instancia do numero que RECEBEU a mensagem. Removido o numero, a instancia
  // dele se foi e nenhum outro numero consegue baixar: desiste de vez, sem
  // tentar por outro numero.
  it("número removido desiste de vez sem baixar por outro número", async () => {
    const { clinicId, messageId, jobId } = await criarMensagemComJob(
      "removido",
      { maxAttempts: 8 },
    );
    const { data: numero } = await admin
      .from("whatsapp_account")
      .select("id")
      .eq("clinic_id", clinicId)
      .is("removido_em", null)
      .single()
      .throwOnError();
    await admin
      .rpc("remover_numero", {
        p_clinic_id: clinicId,
        p_account_id: numero!.id,
      })
      .throwOnError();
    const baixar = vi.spyOn(FakeProvider.prototype, "downloadMedia");

    await processarLote(admin, "teste-midia");

    expect(baixar).not.toHaveBeenCalled();
    expect(await lerJob(jobId)).toEqual({
      status: "falhou",
      last_error: "numero_removido",
    });
    expect((await lerMensagem(messageId)).media_url).toBe(
      "indisponivel://desistiu",
    );
  });
});
