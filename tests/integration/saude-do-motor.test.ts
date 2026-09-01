import { afterAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Saúde do motor de automação.
//
// Sem pg_cron neste projeto, UM processo Node executa tudo que é automático.
// Quando ele para, a tela ficava idêntica à de uma clínica saudável: régua
// "ligada", consultas "pendentes" e "Cobrar agora" respondendo sucesso. A
// clínica só descobria pelo paciente que faltou. Estes testes cobrem as duas
// peças que tiram esse silêncio.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];
const workersCriados: string[] = [];

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
  for (const workerId of workersCriados) {
    await admin.from("worker_heartbeat").delete().eq("worker_id", workerId);
  }
});

describe("prova de vida do worker", () => {
  it("bater ponto cria e depois atualiza a linha do worker", async () => {
    const workerId = `teste-${sufixo}`;
    workersCriados.push(workerId);

    await admin
      .rpc("bater_ponto_do_worker", { p_worker_id: workerId, p_ultimo_lote: 0 })
      .throwOnError();
    const { data: primeira } = await admin
      .from("worker_heartbeat")
      .select("batida_em, ultimo_lote")
      .eq("worker_id", workerId)
      .single();
    expect(primeira?.ultimo_lote).toBe(0);

    await new Promise((r) => setTimeout(r, 1100));
    await admin
      .rpc("bater_ponto_do_worker", { p_worker_id: workerId, p_ultimo_lote: 7 })
      .throwOnError();
    const { data: segunda } = await admin
      .from("worker_heartbeat")
      .select("batida_em, ultimo_lote")
      .eq("worker_id", workerId)
      .single();

    // Uma linha por worker (a chave é o worker_id), com a batida avançando.
    expect(segunda?.ultimo_lote).toBe(7);
    expect(new Date(segunda!.batida_em as string).getTime()).toBeGreaterThan(
      new Date(primeira!.batida_em as string).getTime(),
    );
  });
});

describe("runs órfãs", () => {
  it("toque cujo job morreu de vez é fechado, não fica pendurado para sempre", async () => {
    const { data: clinica } = await admin
      .from("clinic")
      .insert({ name: `Órfã ${sufixo}`, slug: `orfa-${sufixo}` })
      .select("id")
      .single()
      .throwOnError();
    const clinicId = clinica!.id as string;
    clinicasCriadas.push(clinicId);

    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: "+5584969000001" })
      .select("id")
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("offset_minutes", -1440)
      .single()
      .throwOnError();

    const { data: run } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contato!.id,
        appointment_id: null,
        scheduled_for: new Date().toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();

    // Job que esgotou tentativas (ou foi enterrado por lease vencido).
    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: run!.id },
        status: "falhou",
      })
      .throwOnError();

    // Antes: a run ficava sem sent_at e sem skipped_reason para sempre,
    // indistinguível de um toque que ainda vai sair, e nunca mais era tentada
    // (o planner usa on conflict do nothing).
    await admin.rpc("fechar_runs_orfas").throwOnError();

    const { data: depois } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("id", run!.id)
      .single();
    expect(depois?.skipped_reason).toBe("falha_envio");
  });

  it("não encosta em run que já foi enviada", async () => {
    const { data: clinica } = await admin
      .from("clinic")
      .insert({ name: `Órfã ok ${sufixo}`, slug: `orfa-ok-${sufixo}` })
      .select("id")
      .single()
      .throwOnError();
    const clinicId = clinica!.id as string;
    clinicasCriadas.push(clinicId);

    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: clinicId, phone_e164: "+5584969000002" })
      .select("id")
      .single()
      .throwOnError();
    const { data: passo } = await admin
      .from("cadence_step")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("offset_minutes", -1440)
      .single()
      .throwOnError();

    const enviadaEm = new Date().toISOString();
    const { data: run } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contato!.id,
        appointment_id: null,
        scheduled_for: enviadaEm,
        sent_at: enviadaEm,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: run!.id },
        status: "falhou",
      })
      .throwOnError();

    await admin.rpc("fechar_runs_orfas").throwOnError();

    // A mensagem chegou ao paciente; marcar como falha seria mentir na trilha.
    const { data: depois } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason")
      .eq("id", run!.id)
      .single();
    expect(depois?.sent_at).not.toBeNull();
    expect(depois?.skipped_reason).toBeNull();
  });
});
