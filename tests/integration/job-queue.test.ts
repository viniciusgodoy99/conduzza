import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MIDIA_BUCKET,
  garantirBucketDeMidia,
  processarLote,
} from "@/lib/jobs/worker";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { adminClient, anonClient } from "../rls/stack";

// Worker da job_queue contra o banco REAL (Etapa B da auditoria de escala).
// Cada cenario usa a propria clinica descartavel, porque um envio impoe o
// espacamento anti-ban de massa (10 a 30s) ao PROXIMO envio do mesmo numero:
// clinicas separadas mantem os testes rapidos.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Job ${nome} ${sufixo}`, slug: `job-${nome}-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();
  return clinicId;
}

async function criarContato(
  clinicId: string,
  telefone: string,
  opts: { consentimento: "ativo" | "revogado" | "nenhum" },
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Contato Job" })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  if (opts.consentimento !== "nenhum") {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
        ...(opts.consentimento === "revogado"
          ? { revoked_at: new Date().toISOString() }
          : {}),
      })
      .throwOnError();
  }
  return contactId;
}

beforeAll(async () => {
  await garantirBucketDeMidia(admin);
});

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("disparo ativo (confirmação de atendimento)", () => {
  it("envia para contato com consentimento e registra a mensagem como sistema", async () => {
    resetFakeProvider();
    const clinicId = await criarClinica("envio");
    const contactId = await criarContato(clinicId, "+5584960000001", {
      consentimento: "ativo",
    });

    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: {
          contact_id: contactId,
          body: "Sua consulta é amanhã às 14h. Confirma presença?",
        },
      })
      .select("id")
      .single()
      .throwOnError();

    const processados = await processarLote(admin, "teste-worker");
    expect(processados).toBeGreaterThanOrEqual(1);

    const { data: jobDepois } = await admin
      .from("job_queue")
      .select("status, last_error")
      .eq("id", job!.id)
      .single();
    expect(jobDepois?.status).toBe("concluido");

    // A mensagem saiu de verdade (provedor fake registrou) e ficou gravada
    // como autor sistema, com custo zero.
    expect(fakeSentMessages().some((m) => m.to === "+5584960000001")).toBe(
      true,
    );
    const { data: mensagens } = await admin
      .from("message")
      .select("author, author_user_id, direction, delivery_status, cost_cents")
      .eq("clinic_id", clinicId);
    expect(mensagens).toHaveLength(1);
    expect(mensagens?.[0]).toMatchObject({
      author: "sistema",
      author_user_id: null,
      direction: "saida",
      delivery_status: "enviada",
      cost_cents: 0,
    });

    // A conversa aberta foi criada para receber o disparo.
    const { data: conversas } = await admin
      .from("conversation")
      .select("status")
      .eq("clinic_id", clinicId);
    expect(conversas).toHaveLength(1);
  });

  it("contato que revogou NÃO recebe: falha definitiva, sem retry, com trilha", async () => {
    resetFakeProvider();
    const clinicId = await criarClinica("revogado");
    const contactId = await criarContato(clinicId, "+5584960000002", {
      consentimento: "revogado",
    });

    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "Não deveria chegar" },
      })
      .select("id")
      .single()
      .throwOnError();

    await processarLote(admin, "teste-worker");

    const { data: jobDepois } = await admin
      .from("job_queue")
      .select("status, last_error")
      .eq("id", job!.id)
      .single();
    // Definitivo: sem consentimento nao muda com repeticao.
    expect(jobDepois?.status).toBe("falhou");
    expect(jobDepois?.last_error).toBe("sem_consentimento");

    expect(fakeSentMessages()).toHaveLength(0);
    const { data: mensagens } = await admin
      .from("message")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(mensagens).toHaveLength(0);

    const { data: trilha } = await admin
      .from("audit_log")
      .select("action")
      .eq("clinic_id", clinicId);
    expect(
      trilha?.some((l) => l.action === "envio_bloqueado_sem_autorizacao"),
    ).toBe(true);
  });

  it("clínica desconectada volta para retry com backoff, não perde o job", async () => {
    const clinicId = await criarClinica("offline");
    await admin
      .from("whatsapp_account")
      .update({ connection_status: "desconectado" })
      .eq("clinic_id", clinicId);
    const contactId = await criarContato(clinicId, "+5584960000003", {
      consentimento: "ativo",
    });

    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "Tenta de novo depois" },
      })
      .select("id")
      .single()
      .throwOnError();

    await processarLote(admin, "teste-worker");

    const { data: jobDepois } = await admin
      .from("job_queue")
      .select("status, last_error, attempts, run_at")
      .eq("id", job!.id)
      .single();
    expect(jobDepois?.status).toBe("pendente");
    expect(jobDepois?.last_error).toBe("desconectado");
    expect(jobDepois?.attempts).toBe(1);
    expect(new Date(jobDepois!.run_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("payload inválido morre na hora, sem martelar", async () => {
    const clinicId = await criarClinica("invalido");
    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { qualquer: "coisa" },
      })
      .select("id")
      .single()
      .throwOnError();

    await processarLote(admin, "teste-worker");

    const { data: jobDepois } = await admin
      .from("job_queue")
      .select("status, last_error")
      .eq("id", job!.id)
      .single();
    expect(jobDepois?.status).toBe("falhou");
    expect(jobDepois?.last_error).toBe("payload_invalido");
  });
});

describe("download de mídia", () => {
  it("baixa pelo provedor, guarda no Storage e transcreve áudio", async () => {
    const clinicId = await criarClinica("midia");
    const contactId = await criarContato(clinicId, "+5584960000004", {
      consentimento: "ativo",
    });
    const { data: conversa } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        status: "aguardando_humano",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: mensagem } = await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversa!.id,
        wa_message_id: `job-midia-${sufixo}`,
        direction: "entrada",
        author: "paciente",
        content_type: "audio",
        media_url: "https://mmg.whatsapp.net/x/abc.enc",
      })
      .select("id")
      .single()
      .throwOnError();

    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "baixar_midia",
        payload: {
          message_id: mensagem!.id,
          wa_message_id: `job-midia-${sufixo}`,
        },
      })
      .throwOnError();

    await processarLote(admin, "teste-worker");

    const { data: depois } = await admin
      .from("message")
      .select("media_url, transcript")
      .eq("id", mensagem!.id)
      .single();
    const caminho = `${clinicId}/${mensagem!.id}`;
    expect(depois?.media_url).toBe(`storage://${MIDIA_BUCKET}/${caminho}`);
    expect(depois?.transcript).toContain("Transcrição de teste");

    // O arquivo existe MESMO no Storage, com o conteudo do provedor.
    const { data: arquivo, error } = await admin.storage
      .from(MIDIA_BUCKET)
      .download(caminho);
    expect(error).toBeNull();
    const texto = Buffer.from(await arquivo!.arrayBuffer()).toString();
    expect(texto).toContain("fake-midia:");
  });

  // Achado da revisão adversarial de 03/09/2026, severidade grave.
  //
  // O download é enfileirado quando a mensagem chega e roda depois, em outro
  // processo. Se o paciente revogar a foto nesse meio tempo, o worker baixava
  // os bytes assim mesmo, gravava no acervo e devolvia media_url e transcript
  // para a linha que o apagamento acabara de anular. O resultado era o oposto
  // exato do pedido, e permanente: nada mais volta a olhar aquela linha.
  it("mídia de mensagem apagada não é baixada nem regravada", async () => {
    const clinicId = await criarClinica("midia-apagada");
    const contactId = await criarContato(clinicId, "+5584960000014", {
      consentimento: "ativo",
    });
    const { data: conversa } = await admin
      .from("conversation")
      .insert({ clinic_id: clinicId, contact_id: contactId })
      .select("id")
      .single()
      .throwOnError();
    const { data: mensagem } = await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversa!.id,
        wa_message_id: `job-apagada-${sufixo}`,
        direction: "entrada",
        author: "paciente",
        content_type: "audio",
        media_url: "https://mmg.whatsapp.net/x/abc.enc",
      })
      .select("id")
      .single()
      .throwOnError();

    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "baixar_midia",
        payload: {
          message_id: mensagem!.id,
          wa_message_id: `job-apagada-${sufixo}`,
        },
      })
      .throwOnError();

    // O paciente revoga ANTES de o worker chegar no job.
    await admin
      .rpc("registrar_apagamento_do_whatsapp", {
        p_clinic_id: clinicId,
        p_wa_message_id: `job-apagada-${sufixo}`,
      })
      .throwOnError();

    await processarLote(admin, "teste-worker");

    const { data: depois } = await admin
      .from("message")
      .select("media_url, transcript, deleted_at")
      .eq("id", mensagem!.id)
      .single();
    expect(depois?.deleted_at).not.toBeNull();
    // O conteúdo continua apagado: nada foi reposto.
    expect(depois?.media_url).toBeNull();
    expect(depois?.transcript).toBeNull();

    // E nenhum arquivo foi parar no acervo.
    const { error } = await admin.storage
      .from(MIDIA_BUCKET)
      .download(`${clinicId}/${mensagem!.id}`);
    expect(error).toBeTruthy();
  });
});

describe("mecânica da fila", () => {
  it("dois workers concorrentes não pegam o mesmo job (SKIP LOCKED)", async () => {
    const clinicId = await criarClinica("corrida");
    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { qualquer: "um" },
      })
      .throwOnError();

    const [a, b] = await Promise.all([
      admin.rpc("claim_jobs", { p_worker: "worker-a", p_limit: 10 }),
      admin.rpc("claim_jobs", { p_worker: "worker-b", p_limit: 10 }),
    ]);
    const deA = ((a.data ?? []) as { clinic_id: string }[]).filter(
      (j) => j.clinic_id === clinicId,
    );
    const deB = ((b.data ?? []) as { clinic_id: string }[]).filter(
      (j) => j.clinic_id === clinicId,
    );
    expect(deA.length + deB.length).toBe(1);
  });

  it("a reserva de slot é atômica e encadeia os espaçamentos", async () => {
    const clinicId = await criarClinica("slot");
    // A funcao devolve a ESPERA em ms (relogio do banco, imune a desvio do
    // relogio local). Tres reservas concorrentes: esperas escalonadas pelo
    // espaco pedido. E ISTO que impede dois processos de dispararem juntos.
    const [{ data: e1 }, { data: e2 }, { data: e3 }] = await Promise.all([
      admin.rpc("reservar_slot_envio", {
        p_clinic_id: clinicId,
        p_espaco_ms: 5000,
      }),
      admin.rpc("reservar_slot_envio", {
        p_clinic_id: clinicId,
        p_espaco_ms: 5000,
      }),
      admin.rpc("reservar_slot_envio", {
        p_clinic_id: clinicId,
        p_espaco_ms: 5000,
      }),
    ]);
    const esperas = [e1, e2, e3].map((v) => Number(v)).sort((x, y) => x - y);
    expect(esperas[0]).toBeLessThan(1000);
    expect(esperas[1]).toBeGreaterThanOrEqual(4000);
    expect(esperas[2]).toBeGreaterThanOrEqual(9000);
  });

  it("retry NÃO reenvia envio que pode já ter saído (idempotência por job)", async () => {
    resetFakeProvider();
    const clinicId = await criarClinica("idem");
    const contactId = await criarContato(clinicId, "+5584960000005", {
      consentimento: "ativo",
    });

    // Simula a pior janela: o job rodou, o provider ENVIOU, a mensagem ficou
    // registrada, mas o worker morreu antes de concluir e o lease venceu.
    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contactId, body: "Confirmação única" },
        status: "executando",
        locked_by: "worker-morto",
        locked_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        attempts: 1,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: conversa } = await admin.rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    });
    await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversa,
        job_id: job!.id,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Confirmação única",
        billable: false,
        cost_cents: 0,
        delivery_status: "enviada",
        wa_message_id: "fake:ja-saiu",
      })
      .throwOnError();

    // Outro worker recolhe o lease vencido e reexecuta o job.
    await processarLote(admin, "worker-novo");

    // NADA foi reenviado e o job concluiu (o envio ja existia).
    expect(fakeSentMessages()).toHaveLength(0);
    const { data: jobDepois } = await admin
      .from("job_queue")
      .select("status")
      .eq("id", job!.id)
      .single();
    expect(jobDepois?.status).toBe("concluido");
    const { data: mensagens } = await admin
      .from("message")
      .select("id")
      .eq("clinic_id", clinicId);
    expect(mensagens).toHaveLength(1);
  });

  it("worker sem a posse do claim PULA o job (lease vencido no meio do lote)", async () => {
    const clinicId = await criarClinica("posse");
    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { qualquer: "um" },
        status: "executando",
        locked_by: "worker-b",
        locked_at: new Date().toISOString(),
        attempts: 1,
      })
      .select("id")
      .single()
      .throwOnError();

    // worker-a tenta confirmar posse de um job que e do worker-b: recusado.
    const { data: possui } = await admin.rpc("confirmar_posse_job", {
      p_id: job!.id,
      p_worker: "worker-a",
    });
    expect(possui).not.toBe(true);

    // E concluir/falhar sem a posse nao mudam nada.
    await admin.rpc("concluir_job", { p_id: job!.id, p_worker: "worker-a" });
    const { data: depois } = await admin
      .from("job_queue")
      .select("status, locked_by")
      .eq("id", job!.id)
      .single();
    expect(depois?.status).toBe("executando");
    expect(depois?.locked_by).toBe("worker-b");
  });

  it("cliente anônimo não executa claim nem lê a fila", async () => {
    const anon = anonClient();
    const { error: erroClaim } = await anon.rpc("claim_jobs", {
      p_worker: "intruso",
      p_limit: 1,
    });
    expect(erroClaim).not.toBeNull();

    const { data: linhas } = await anon.from("job_queue").select("id");
    expect(linhas ?? []).toHaveLength(0);
  });
});
