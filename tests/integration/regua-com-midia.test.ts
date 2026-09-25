import { afterAll, describe, expect, it } from "vitest";

import { CORPO_DO_MENU_APOS_MIDIA } from "@/lib/domain/textos-padrao";
import { executarPassoDeRegua } from "@/lib/jobs/regua";
import type { Job } from "@/lib/jobs/worker";
import { adminClient } from "../rls/stack";

// Anexo no passo da regua (19/09/2026), contra o banco REAL. O que so a
// integracao prova: o executor copia o anexo de midia-de-regua para
// midia-conversas EM NOME da message nova (a policy de leitura do Inbox
// exige exatamente esse caminho), o passo so-audio sem texto envia, o passo
// sem conteudo morre definitivo, e a confirmacao com anexo vira DUAS
// mensagens (a midia e os botoes).
//
// Clinicas e_de_teste: o motor de producao as ignora; cada cenario executa o
// proprio job. Canal fake.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
// Varios numeros por clinica (docs/07, Fase 2): o executor pergunta ao banco
// por qual numero o toque sai (numero_do_job), e o banco so responde a quem
// tem a posse do job. O teste faz o claim que o motor faria, so deste job.
const WORKER = `teste-regua-midia-${sufixo}`;

async function reivindicar(job: Job): Promise<Job> {
  await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: WORKER,
      locked_at: new Date().toISOString(),
      attempts: job.attempts + 1,
    })
    .eq("id", job.id)
    .eq("status", "pendente")
    .throwOnError();
  return { ...job, attempts: job.attempts + 1 };
}

const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

// Um PNG de 1x1 pixel: bytes reais bastam para provar a copia byte a byte.
const PNG_MINUSCULO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function montarClinica(nome: string): Promise<string> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Midia ${nome} ${sufixo}`,
      slug: `midia-${nome}-${sufixo}`,
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
  return clinicId;
}

async function contatoComConsent(
  clinicId: string,
  telefone: string,
  etapa?: string,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Mídia",
      ...(etapa ? { funnel_stage: etapa } : {}),
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();
  return contactId;
}

/** Regua de follow-up com um passo, com ou sem texto, com ou sem anexo. */
async function passoDeFollowup(
  clinicId: string,
  opts: { texto: string | null; anexo: "image" | "audio" | null },
): Promise<string> {
  const { data: regua } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicId,
      kind: "followup",
      name: `Follow-up mídia ${sufixo}`,
      trigger_stage: "em_contato",
      active: true,
      ...JANELA_ABERTA,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: passo } = await admin
    .from("cadence_step")
    .insert({
      clinic_id: clinicId,
      cadence_id: regua!.id as string,
      offset_minutes: 60,
      fixed_body: opts.texto,
    })
    .select("id")
    .single()
    .throwOnError();
  const stepId = passo!.id as string;
  if (opts.anexo) {
    await anexarNoPasso(clinicId, stepId, opts.anexo);
  }
  return stepId;
}

async function anexarNoPasso(
  clinicId: string,
  stepId: string,
  tipo: "image" | "audio",
): Promise<void> {
  const caminho = `${clinicId}/${stepId}`;
  const mimetype = tipo === "image" ? "image/png" : "audio/mpeg";
  const upload = await admin.storage
    .from("midia-de-regua")
    .upload(caminho, PNG_MINUSCULO, { contentType: mimetype, upsert: true });
  expect(upload.error).toBeNull();
  await admin
    .from("cadence_step")
    .update({
      media_path: caminho,
      media_type: tipo,
      media_mimetype: mimetype,
      media_filename: null,
    })
    .eq("id", stepId)
    .throwOnError();
}

/** Poe o contato na etapa da regua com a ancora vencida e planeja. */
async function armarFollowup(
  clinicId: string,
  contactId: string,
): Promise<{ runId: string; job: Job }> {
  await admin
    .from("contact")
    .update({
      funnel_stage: "em_contato",
      lost_reason: null,
    })
    .eq("id", contactId)
    .throwOnError();
  await admin
    .from("contact")
    .update({
      // 60 atras + offset 60 = vencimento AGORA: dentro da janela de
      // materializacao do planner (mesma receita de followup.test.ts).
      funnel_stage_changed_at: new Date(Date.now() - 60 * MINUTO).toISOString(),
    })
    .eq("id", contactId)
    .throwOnError();
  const { error } = await admin.rpc("planejar_reguas");
  expect(error).toBeNull();
  const { data: jobs } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, payload, attempts, max_attempts")
    .eq("clinic_id", clinicId)
    .eq("kind", "executar_passo_de_regua");
  expect(jobs).toHaveLength(1);
  const job = await reivindicar(jobs![0] as unknown as Job);
  return { runId: job.payload.cadence_run_id as string, job };
}

type MensagemDeSaida = {
  id: string;
  content_type: string;
  body: string | null;
  media_url: string | null;
};

async function mensagensDeSaida(clinicId: string): Promise<MensagemDeSaida[]> {
  const { data } = await admin
    .from("message")
    .select("id, content_type, body, media_url")
    .eq("clinic_id", clinicId)
    .eq("direction", "saida")
    .order("created_at");
  return (data ?? []) as MensagemDeSaida[];
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    // Os objetos de midia-de-regua caem com a limpeza manual (o cascade do
    // banco nao alcanca o Storage); os de midia-conversas idem.
    const { data: objetos } = await admin.storage
      .from("midia-de-regua")
      .list(clinicId);
    if (objetos && objetos.length > 0) {
      await admin.storage
        .from("midia-de-regua")
        .remove(objetos.map((o) => `${clinicId}/${o.name}`));
    }
    const { data: copias } = await admin.storage
      .from("midia-conversas")
      .list(clinicId);
    if (copias && copias.length > 0) {
      await admin.storage
        .from("midia-conversas")
        .remove(copias.map((o) => `${clinicId}/${o.name}`));
    }
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("anexo no passo da régua, contra o banco real", () => {
  it("foto com legenda: a message nasce com a CÓPIA em midia-conversas", async () => {
    const clinicId = await montarClinica("foto");
    const contactId = await contatoComConsent(clinicId, "+5584976200001");
    await passoDeFollowup(clinicId, {
      texto: "Oi, {{nome}}! Olha isto.",
      anexo: "image",
    });
    const { runId, job } = await armarFollowup(clinicId, contactId);

    const resultado = await executarPassoDeRegua(admin, job, WORKER);
    expect(resultado).toEqual({ ok: true });

    const mensagens = await mensagensDeSaida(clinicId);
    expect(mensagens).toHaveLength(1);
    const mensagem = mensagens[0]!;
    expect(mensagem.content_type).toBe("imagem");
    expect(mensagem.body).toContain("Olha isto");
    expect(mensagem.media_url).toBe(
      `storage://midia-conversas/${clinicId}/${mensagem.id}`,
    );

    // A copia existe e e byte a byte o anexo do passo.
    const download = await admin.storage
      .from("midia-conversas")
      .download(`${clinicId}/${mensagem.id}`);
    expect(download.error).toBeNull();
    const bytes = Buffer.from(await download.data!.arrayBuffer());
    expect(bytes.equals(PNG_MINUSCULO)).toBe(true);

    const { data: run } = await admin
      .from("cadence_run")
      .select("sent_at, message_id")
      .eq("id", runId)
      .single();
    expect(run!.sent_at).not.toBeNull();
    expect(run!.message_id).toBe(mensagem.id);
  });

  it("só o áudio, sem texto: envia mesmo assim", async () => {
    const clinicId = await montarClinica("audio");
    const contactId = await contatoComConsent(clinicId, "+5584976200002");
    await passoDeFollowup(clinicId, { texto: null, anexo: "audio" });
    const { job } = await armarFollowup(clinicId, contactId);

    const resultado = await executarPassoDeRegua(admin, job, WORKER);
    expect(resultado).toEqual({ ok: true });

    const mensagens = await mensagensDeSaida(clinicId);
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]!.content_type).toBe("audio");
    expect(mensagens[0]!.media_url).not.toBeNull();
  });

  it("sem texto e sem anexo: morre definitivo como passo_sem_conteudo", async () => {
    const clinicId = await montarClinica("vazio");
    const contactId = await contatoComConsent(clinicId, "+5584976200003");
    await passoDeFollowup(clinicId, { texto: null, anexo: null });
    const { job } = await armarFollowup(clinicId, contactId);

    const resultado = await executarPassoDeRegua(admin, job, WORKER);
    expect(resultado).toEqual({
      ok: false,
      erro: "passo_sem_conteudo",
      definitivo: true,
    });
    expect(await mensagensDeSaida(clinicId)).toHaveLength(0);
  });

  it("confirmação com anexo: a mídia e os botões, DUAS mensagens", async () => {
    const clinicId = await montarClinica("confirma");
    const contactId = await contatoComConsent(clinicId, "+5584976200004");

    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. Mídia" })
      .select("id")
      .single()
      .throwOnError();
    const { data: proc } = await admin
      .from("procedure")
      .insert({ clinic_id: clinicId, name: "Avaliação", default_duration_min: 30 })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: prof!.id,
        procedure_id: proc!.id,
        insurance_id: null,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();

    // Liga a regua de confirmacao semeada e anexa a foto no passo de -3h.
    await admin
      .from("cadence")
      .update({ active: true, ...JANELA_ABERTA })
      .eq("clinic_id", clinicId)
      .eq("kind", "confirmacao")
      .throwOnError();
    const inicio = new Date(Date.now() + 3 * HORA + 10 * MINUTO);
    await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      })
      .throwOnError();

    const { error: erroPlanner } = await admin.rpc("planejar_reguas");
    expect(erroPlanner).toBeNull();
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, clinic_id, kind, payload, attempts, max_attempts")
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua");
    expect(jobs).toHaveLength(1);
    const job = await reivindicar(jobs![0] as unknown as Job);

    const { data: runComPasso } = await admin
      .from("cadence_run")
      .select("cadence_step_id")
      .eq("id", job.payload.cadence_run_id as string)
      .single();
    await anexarNoPasso(
      clinicId,
      runComPasso!.cadence_step_id as string,
      "image",
    );

    const resultado = await executarPassoDeRegua(admin, job, WORKER);
    expect(resultado).toEqual({ ok: true });

    const mensagens = await mensagensDeSaida(clinicId);
    expect(mensagens).toHaveLength(2);
    const midia = mensagens.find((m) => m.content_type === "imagem");
    const menu = mensagens.find((m) => m.content_type === "texto");
    expect(midia?.media_url).toBe(
      `storage://midia-conversas/${clinicId}/${midia?.id}`,
    );
    expect(menu?.body).toContain(CORPO_DO_MENU_APOS_MIDIA);

    // A run aponta para a mensagem INTERATIVA (os botoes).
    const { data: run } = await admin
      .from("cadence_run")
      .select("message_id")
      .eq("id", job.payload.cadence_run_id as string)
      .single();
    expect(run!.message_id).toBe(menu!.id);
  });

  // Revisao de 24/09/2026: o WhatsApp nao mostra legenda em audio. O texto
  // (com data e hora) ia como legenda e nunca chegava ao paciente.
  it("áudio com texto no follow-up: o áudio sem legenda e o texto numa mensagem própria", async () => {
    const clinicId = await montarClinica("audiotexto");
    const contactId = await contatoComConsent(clinicId, "+5584976200005");
    await passoDeFollowup(clinicId, {
      texto: "Oi, {{nome}}! Ouça o recado da clínica.",
      anexo: "audio",
    });
    const { runId, job } = await armarFollowup(clinicId, contactId);

    const resultado = await executarPassoDeRegua(admin, job, WORKER);
    expect(resultado).toEqual({ ok: true });

    const mensagens = await mensagensDeSaida(clinicId);
    expect(mensagens).toHaveLength(2);
    const audio = mensagens.find((m) => m.content_type === "audio");
    const texto = mensagens.find((m) => m.content_type === "texto");
    expect(audio?.body ?? "").toBe("");
    expect(texto?.body).toBe("Oi, Paciente Mídia! Ouça o recado da clínica.");

    const { data: run } = await admin
      .from("cadence_run")
      .select("sent_at")
      .eq("id", runId)
      .single();
    expect(run!.sent_at).not.toBeNull();
  });

  it("áudio com texto na confirmação: o texto do passo é o corpo dos botões", async () => {
    const clinicId = await montarClinica("audioconfirma");
    const contactId = await contatoComConsent(clinicId, "+5584976200006");
    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. Áudio" })
      .select("id")
      .single()
      .throwOnError();
    const { data: proc } = await admin
      .from("procedure")
      .insert({ clinic_id: clinicId, name: "Avaliação", default_duration_min: 30 })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: prof!.id,
        procedure_id: proc!.id,
        insurance_id: null,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("cadence")
      .update({ active: true, ...JANELA_ABERTA })
      .eq("clinic_id", clinicId)
      .eq("kind", "confirmacao")
      .throwOnError();
    const inicio = new Date(Date.now() + 3 * HORA + 10 * MINUTO);
    await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      })
      .throwOnError();

    const { error: erroPlanner } = await admin.rpc("planejar_reguas");
    expect(erroPlanner).toBeNull();
    const { data: jobs } = await admin
      .from("job_queue")
      .select("id, clinic_id, kind, payload, attempts, max_attempts")
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua");
    expect(jobs).toHaveLength(1);
    const job = await reivindicar(jobs![0] as unknown as Job);
    const { data: runComPasso } = await admin
      .from("cadence_run")
      .select("cadence_step_id")
      .eq("id", job.payload.cadence_run_id as string)
      .single();
    // O passo de 3h semeado tem texto com {{hora}}.
    await anexarNoPasso(
      clinicId,
      runComPasso!.cadence_step_id as string,
      "audio",
    );

    const resultado = await executarPassoDeRegua(admin, job, WORKER);
    expect(resultado).toEqual({ ok: true });

    const mensagens = await mensagensDeSaida(clinicId);
    expect(mensagens).toHaveLength(2);
    const audio = mensagens.find((m) => m.content_type === "audio");
    const menu = mensagens.find((m) => m.content_type === "texto");
    expect(audio?.body ?? "").toBe("");
    expect(menu?.body).toContain("sua consulta é hoje às");
    expect(menu?.body).not.toContain(CORPO_DO_MENU_APOS_MIDIA);
  });
});
