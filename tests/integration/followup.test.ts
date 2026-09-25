import { afterAll, describe, expect, it } from "vitest";

import { executarPassoDeRegua } from "@/lib/jobs/regua";
import type { Job } from "@/lib/jobs/worker";
import { adminClient } from "../rls/stack";

// Fase 3 da 4.8: o motor de follow-up por etapa da jornada, contra o banco
// REAL. O que so a integracao prova: a ancora funnel_stage_changed_at
// carimbada pelo gatilho em todo caminho (inclusive o avancar_funil da
// agenda), o terceiro CTE do planner (idempotente), e as paradas estruturais
// do executor (sair da etapa, responder, reentrada).
//
// Clinicas com e_de_teste=true: o motor de producao as ignora, entao os jobs
// pendentes daqui nao competem com a fila real; cada cenario executa o
// proprio job direto (executarPassoDeRegua) e o afterAll apaga tudo em
// cascata. O canal e o provider fake.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};
const MINUTO = 60_000;

type Cenario = { clinicId: string; cadenceId: string; stepId: string };

async function montarCenario(nome: string): Promise<Cenario> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Followup ${nome} ${sufixo}`,
      slug: `fup-${nome}-${sufixo}`,
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

  // Regua de follow-up da etapa em_contato (existe em toda jornada semeada),
  // um passo 60 minutos depois da entrada na etapa.
  const { data: regua } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicId,
      kind: "followup",
      name: `Follow-up teste ${nome}`,
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
      fixed_body: "Oi, {{nome}}! Aqui é da {{clinica}}. Podemos ajudar?",
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    clinicId,
    cadenceId: regua!.id as string,
    stepId: passo!.id as string,
  };
}

/** Contato com consentimento, na etapa da regua, com a ancora RETROCEDIDA
 *  para o vencimento do passo cair na janela do planner (agora). */
async function contatoNaEtapa(
  cenario: Cenario,
  telefone: string,
  minutosAtras = 60,
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: cenario.clinicId,
      phone_e164: telefone,
      name: "Lead Followup",
      funnel_stage: "em_contato",
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();
  // Viagem no tempo: a coluna aceita escrita direta de proposito (o gatilho
  // so carimba quando funnel_stage muda).
  await admin
    .from("contact")
    .update({
      funnel_stage_changed_at: new Date(
        Date.now() - minutosAtras * MINUTO,
      ).toISOString(),
    })
    .eq("id", contactId)
    .throwOnError();
  return contactId;
}

async function planejar(): Promise<void> {
  const { error } = await admin.rpc("planejar_reguas");
  expect(error).toBeNull();
}

type Run = {
  id: string;
  sent_at: string | null;
  skipped_reason: string | null;
};

async function runsDoContato(
  clinicId: string,
  contactId: string,
): Promise<Run[]> {
  const { data } = await admin
    .from("cadence_run")
    .select("id, sent_at, skipped_reason")
    .eq("clinic_id", clinicId)
    .eq("contact_id", contactId)
    .order("scheduled_for");
  return (data ?? []) as Run[];
}

// Varios numeros por clinica (docs/07, Fase 2): o executor pergunta ao banco
// por qual numero o toque sai (numero_do_job), e o banco so responde a quem
// tem a posse do job.
const WORKER = `teste-followup-${sufixo}`;

/**
 * Executa o job REAL da run (o que o motor faria), direto e idempotente. O
 * claim e o do motor, so deste job; se o job ja esta com este executor (uma
 * segunda execucao do mesmo cenario), a posse continua valendo.
 */
async function executarJobDaRun(clinicId: string, runId: string) {
  const { data: jobs } = await admin
    .from("job_queue")
    .select("id, clinic_id, kind, payload, attempts, max_attempts")
    .eq("clinic_id", clinicId)
    .eq("kind", "executar_passo_de_regua")
    .contains("payload", { cadence_run_id: runId });
  expect(jobs).toHaveLength(1);
  const job = jobs![0] as unknown as Job;
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
  return executarPassoDeRegua(admin, job, WORKER);
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("follow-up por etapa, contra o banco real", () => {
  it("planejar duas vezes cria UMA run; o executor envia com autoria sistema", async () => {
    const cenario = await montarCenario("envia");
    const contato = await contatoNaEtapa(cenario, "+5584975100001");

    await planejar();
    await planejar();
    const runs = await runsDoContato(cenario.clinicId, contato);
    expect(runs).toHaveLength(1);

    const resultado = await executarJobDaRun(cenario.clinicId, runs[0]!.id);
    expect(resultado).toEqual({ ok: true });
    const [run] = await runsDoContato(cenario.clinicId, contato);
    expect(run!.sent_at).not.toBeNull();

    const { data: mensagem } = await admin
      .from("message")
      .select("author, body")
      .eq("clinic_id", cenario.clinicId)
      .eq("direction", "saida")
      .limit(1)
      .single();
    expect(mensagem!.author).toBe("sistema");
    expect(mensagem!.body).toContain("Lead Followup");
  });

  it("agendar consulta move a etapa (gatilho da agenda) e a régua para sozinha", async () => {
    const cenario = await montarCenario("agenda");
    const contato = await contatoNaEtapa(cenario, "+5584975100002");
    await planejar();

    // O caminho REAL: criar appointment dispara avancar_funil_ao_agendar, que
    // move para a etapa de papel agendou e carimba a ancora nova.
    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: cenario.clinicId, name: "Dra. Fup" })
      .select("id")
      .single()
      .throwOnError();
    const { data: proc } = await admin
      .from("procedure")
      .insert({
        clinic_id: cenario.clinicId,
        name: "Sessão Fup",
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: cenario.clinicId,
        professional_id: prof!.id,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const inicio = new Date(Date.now() + 7 * 24 * 60 * MINUTO);
    await admin
      .from("appointment")
      .insert({
        clinic_id: cenario.clinicId,
        contact_id: contato,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      })
      .throwOnError();

    const { data: depois } = await admin
      .from("contact")
      .select("funnel_stage")
      .eq("id", contato)
      .single();
    expect(depois!.funnel_stage).toBe("agendou");

    const runs = await runsDoContato(cenario.clinicId, contato);
    await executarJobDaRun(cenario.clinicId, runs[0]!.id);
    const [run] = await runsDoContato(cenario.clinicId, contato);
    expect(run!.sent_at).toBeNull();
    expect(run!.skipped_reason).toBe("condicao_parada");
  });

  it("resposta do lead depois da entrada na etapa para a régua", async () => {
    const cenario = await montarCenario("responde");
    const contato = await contatoNaEtapa(cenario, "+5584975100003");
    await planejar();

    // last_contact_at e escrito so pela ingestao de mensagem recebida; a
    // viagem no tempo simula a resposta chegando depois da entrada na etapa.
    await admin
      .from("contact")
      .update({ last_contact_at: new Date().toISOString() })
      .eq("id", contato)
      .throwOnError();

    const runs = await runsDoContato(cenario.clinicId, contato);
    await executarJobDaRun(cenario.clinicId, runs[0]!.id);
    const [run] = await runsDoContato(cenario.clinicId, contato);
    expect(run!.skipped_reason).toBe("condicao_parada");
  });

  it("reentrada na etapa torna a run velha obsoleta sem matar a régua", async () => {
    const cenario = await montarCenario("reentra");
    const contato = await contatoNaEtapa(cenario, "+5584975100004");
    await planejar();

    // Sai da etapa e volta: a ancora e recarimbada pelo gatilho, a run velha
    // aponta para a entrada ANTIGA e fica obsoleta (como remarcacao).
    await admin
      .from("contact")
      .update({ funnel_stage: "novo" })
      .eq("id", contato)
      .throwOnError();
    await admin
      .from("contact")
      .update({ funnel_stage: "em_contato" })
      .eq("id", contato)
      .throwOnError();

    const runs = await runsDoContato(cenario.clinicId, contato);
    expect(runs).toHaveLength(1);
    await executarJobDaRun(cenario.clinicId, runs[0]!.id);
    const [run] = await runsDoContato(cenario.clinicId, contato);
    expect(run!.skipped_reason).toBe("condicao_parada");

    // A regua continua viva: retroceder a ancora NOVA materializa run nova.
    await admin
      .from("contact")
      .update({
        funnel_stage_changed_at: new Date(Date.now() - 60 * MINUTO).toISOString(),
      })
      .eq("id", contato)
      .throwOnError();
    await planejar();
    const depois = await runsDoContato(cenario.clinicId, contato);
    expect(depois).toHaveLength(2);
  });

  it("etapa com régua de follow-up não pode ser excluída da jornada", async () => {
    const cenario = await montarCenario("trava");
    const { error } = await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", cenario.clinicId)
      .eq("chave", "em_contato");
    expect(error?.message).toContain("régua de follow-up");
  });

  it("o motivo canal_ocupado agora grava (check corrigido)", async () => {
    const cenario = await montarCenario("canal");
    const contato = await contatoNaEtapa(cenario, "+5584975100005");
    await planejar();
    const runs = await runsDoContato(cenario.clinicId, contato);
    const { error } = await admin
      .from("cadence_run")
      .update({ skipped_reason: "canal_ocupado" })
      .eq("id", runs[0]!.id);
    expect(error).toBeNull();
  });
});
