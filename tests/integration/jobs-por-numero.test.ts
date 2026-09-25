import { afterAll, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { planejarCobrancaManual } from "@/lib/jobs/cobranca-manual";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import {
  criarNumeroDeTeste,
  type NumeroDeTeste,
  type OpcoesDoNumeroDeTeste,
} from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Varios numeros de WhatsApp por clinica, FASE 2, do lado da FILA: o job de
// envio sai pelo numero dele (numero_do_job), o Cobrar agora carimba o numero
// do paciente, e numero REMOVIDO nunca vira envio por outro numero quando o
// job ja gravou mensagem, nem no eco da resposta ao toque (decisao D4).
// Desenho em docs/07_multiplos_numeros_whatsapp.md.
//
// Desde o contrato da Fase 3 (migration 20260925140000) a clinica pode ter
// dois numeros: o "outro numero" daqui e tanto a falta dele (a clinica que
// perdeu o unico numero) quanto o segundo numero da mesma clinica. Os casos
// de dois numeros do webhook e da regua vivem em numeros-fase-2.test.ts.
//
// Clinicas e_de_teste (o motor de producao as ignora) e jobs com run_at no
// futuro: so o claim manual deste teste os executa. Provedor 'fake' sempre.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const AMANHA = () => new Date(Date.now() + 24 * HORA).toISOString();
const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849784${String(sequencia).padStart(5, "0")}`;
}

type Clinica = { clinicId: string; numero: NumeroDeTeste };

async function clinicaComNumero(
  nome: string,
  opcoes: OpcoesDoNumeroDeTeste = {},
): Promise<Clinica> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Jobs por numero ${nome} ${sufixo}`,
      slug: `jobs-num-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  const numero = await criarNumeroDeTeste(admin, clinicId, opcoes);
  return { clinicId, numero };
}

async function contatoComConsentimento(
  clinicId: string,
  campos: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone(),
      name: "Paciente",
      ...campos,
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

/** O claim que o motor faria, so para este job. */
async function reivindicar(jobId: string, workerId: string): Promise<Job> {
  const { data: atual } = await admin
    .from("job_queue")
    .select("attempts")
    .eq("id", jobId)
    .single()
    .throwOnError();
  const { data } = await admin
    .from("job_queue")
    .update({
      status: "executando",
      locked_by: workerId,
      locked_at: new Date().toISOString(),
      attempts: (atual!.attempts as number) + 1,
    })
    .eq("id", jobId)
    .eq("status", "pendente")
    .select(
      "id, clinic_id, kind, payload, attempts, max_attempts, whatsapp_account_id, created_at",
    )
    .single()
    .throwOnError();
  return data as unknown as Job;
}

async function envioAtivo(
  clinicId: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; whatsapp_account_id: string | null }> {
  const { data } = await admin
    .from("job_queue")
    .insert({
      clinic_id: clinicId,
      kind: "enviar_mensagem_ativa",
      payload,
      run_at: AMANHA(),
    })
    .select("id, whatsapp_account_id")
    .single()
    .throwOnError();
  return data as { id: string; whatsapp_account_id: string | null };
}

async function removerNumero(clinicId: string, accountId: string) {
  await admin
    .rpc("remover_numero", {
      p_clinic_id: clinicId,
      p_account_id: accountId,
      p_removido_por: null,
    })
    .throwOnError();
}

async function estadoDoJob(jobId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("status, last_error, whatsapp_account_id")
    .eq("id", jobId)
    .single()
    .throwOnError();
  return data as {
    status: string;
    last_error: string | null;
    whatsapp_account_id: string | null;
  };
}

async function mensagensDoJob(clinicId: string, jobId: string) {
  const { data } = await admin
    .from("message")
    .select("id, whatsapp_account_id")
    .eq("clinic_id", clinicId)
    .eq("job_id", jobId)
    .throwOnError();
  return (data ?? []) as { id: string; whatsapp_account_id: string | null }[];
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("envio ativo pelo número do job", () => {
  it("sai pelo número carimbado e a mensagem fica com ele", async () => {
    const { clinicId, numero } = await clinicaComNumero("envio");
    const contactId = await contatoComConsentimento(clinicId);
    const criado = await envioAtivo(clinicId, {
      contact_id: contactId,
      body: "Mensagem automática (teste)",
    });
    // O gatilho da fila carimba pela regra de conta_de_envio.
    expect(criado.whatsapp_account_id).toBe(numero.id);

    resetFakeProvider();
    const worker = `teste-jobs-num-envio-${sufixo}`;
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(criado.id, worker),
    );
    expect(desfecho).toBe("concluido");

    const mensagens = await mensagensDoJob(clinicId, criado.id);
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]!.whatsapp_account_id).toBe(numero.id);
    const enviadas = fakeSentMessages().filter((m) => m.clinicId === clinicId);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.accountId).toBe(numero.id);
  });

  it("número removido antes de gravar: recarimba e não envia sem número", async () => {
    const { clinicId, numero } = await clinicaComNumero("envio-removido");
    const contactId = await contatoComConsentimento(clinicId);
    const criado = await envioAtivo(clinicId, {
      contact_id: contactId,
      body: "Mensagem automática (teste)",
    });
    const worker = `teste-jobs-num-removido-${sufixo}`;
    const job = await reivindicar(criado.id, worker);
    await removerNumero(clinicId, numero.id);

    resetFakeProvider();
    const desfecho = await executarJobComPosse(admin, worker, job);
    expect(desfecho).toBe("reagendado");

    // Sem numero ativo na clinica: numero_do_job tira o removido do job e o
    // envio ESPERA a clinica ter numero (espera do canal, sem queimar
    // tentativa), como a clinica sem conta de antes. Desde o contrato da Fase
    // 3 nao existe conversa sem numero, entao o executor desvia ANTES de
    // pedir a conversa (estado 'sem_numero' de numero_do_job), e nenhuma
    // conversa nasce.
    const estado = await estadoDoJob(criado.id);
    expect(estado.status).toBe("pendente");
    expect(estado.whatsapp_account_id).toBeNull();
    expect(estado.last_error).toBeNull();
    const { data: devolvido } = await admin
      .from("job_queue")
      .select("attempts, ultimo_motivo_devolucao")
      .eq("id", criado.id)
      .single()
      .throwOnError();
    expect(devolvido).toEqual({
      attempts: 0,
      ultimo_motivo_devolucao: "sem_numero",
    });
    expect(await mensagensDoJob(clinicId, criado.id)).toEqual([]);
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
    const { data: conversas } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .throwOnError();
    expect(conversas).toEqual([]);
  });

  it("número removido antes de gravar, com outro número na clínica: recarimba e sai pelo outro", async () => {
    const { clinicId, numero: a } = await clinicaComNumero("envio-removido-2");
    const b = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Segundo",
      connection_status: "conectado",
    });
    const contactId = await contatoComConsentimento(clinicId);
    const criado = await envioAtivo(clinicId, {
      contact_id: contactId,
      body: "Mensagem automática (teste)",
    });
    // Sem conversa anterior: o gatilho carimba o principal (A).
    expect(criado.whatsapp_account_id).toBe(a.id);
    const worker = `teste-jobs-num-removido-2-${sufixo}`;
    const job = await reivindicar(criado.id, worker);
    // A clinica troca o principal e remove o A com o job ja reivindicado:
    // remover_numero so redistribui os pendentes.
    await admin
      .rpc("definir_numero_principal", {
        p_clinic_id: clinicId,
        p_account_id: b.id,
      })
      .throwOnError();
    await removerNumero(clinicId, a.id);

    resetFakeProvider();
    const desfecho = await executarJobComPosse(admin, worker, job);
    expect(desfecho).toBe("concluido");

    // numero_do_job recarimbou (o job nao tinha mensagem) e o envio saiu
    // pelo B, com a mensagem na conversa do B.
    expect((await estadoDoJob(criado.id)).whatsapp_account_id).toBe(b.id);
    const mensagens = await mensagensDoJob(clinicId, criado.id);
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]!.whatsapp_account_id).toBe(b.id);
    const enviadas = fakeSentMessages().filter((m) => m.clinicId === clinicId);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.accountId).toBe(b.id);
  });

  it("eco da resposta ao toque cujo número saiu depois do claim morre sem enviar (D4)", async () => {
    const { clinicId, numero } = await clinicaComNumero("eco-removido");
    const contactId = await contatoComConsentimento(clinicId);
    const { data: criado } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: {
          contact_id: contactId,
          body: "Presença confirmada (teste)",
          resposta_ao_paciente: true,
        },
        run_at: AMANHA(),
        whatsapp_account_id: numero.id,
      })
      .select("id")
      .single()
      .throwOnError();
    const worker = `teste-jobs-num-eco-${sufixo}`;
    // Reivindicado ANTES da remocao: remover_numero so cancela os ecos
    // pendentes, e este ja esta executando.
    const job = await reivindicar(criado!.id as string, worker);
    expect(job.whatsapp_account_id).toBe(numero.id);
    await removerNumero(clinicId, numero.id);

    resetFakeProvider();
    const desfecho = await executarJobComPosse(admin, worker, job);
    expect(desfecho).toBe("falhou");

    const estado = await estadoDoJob(criado!.id as string);
    expect(estado.status).toBe("falhou");
    expect(estado.last_error).toBe("numero_removido");
    expect(await mensagensDoJob(clinicId, criado!.id as string)).toEqual([]);
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
  });

  it("sem a posse do job, nada sai", async () => {
    const { clinicId } = await clinicaComNumero("sem-posse");
    const contactId = await contatoComConsentimento(clinicId);
    const criado = await envioAtivo(clinicId, {
      contact_id: contactId,
      body: "Mensagem automática (teste)",
    });
    const job = await reivindicar(criado.id, `dono-${sufixo}`);

    resetFakeProvider();
    // Outro executor: confirmar_posse_job ja barra, e numero_do_job tambem.
    const desfecho = await executarJobComPosse(admin, `intruso-${sufixo}`, job);
    expect(desfecho).toBe("sem_posse");
    expect(await mensagensDoJob(clinicId, criado.id)).toEqual([]);
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
  });
});

describe("régua pelo número do job", () => {
  /** Follow-up ativo na etapa em_contato, um passo 60 min depois da entrada. */
  async function execucaoDeFollowup(clinicId: string) {
    const { data: regua } = await admin
      .from("cadence")
      .insert({
        clinic_id: clinicId,
        kind: "followup",
        name: `Follow-up por numero ${sufixo}`,
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
        cadence_id: regua!.id,
        offset_minutes: 60,
        fixed_body: "Oi, {{nome}}! Podemos ajudar?",
      })
      .select("id")
      .single()
      .throwOnError();
    const contactId = await contatoComConsentimento(clinicId, {
      funnel_stage: "em_contato",
    });
    const ancora = new Date(Date.now() - HORA);
    await admin
      .from("contact")
      .update({ funnel_stage_changed_at: ancora.toISOString() })
      .eq("id", contactId)
      .throwOnError();
    const { data: execucao } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contactId,
        scheduled_for: new Date(ancora.getTime() + HORA).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: job } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "executar_passo_de_regua",
        payload: { cadence_run_id: execucao!.id },
        run_at: AMANHA(),
      })
      .select("id, whatsapp_account_id")
      .single()
      .throwOnError();
    return {
      contactId,
      runId: execucao!.id as string,
      jobId: job!.id as string,
      jobAccountId: job!.whatsapp_account_id as string | null,
    };
  }

  async function run(runId: string) {
    const { data } = await admin
      .from("cadence_run")
      .select("sent_at, skipped_reason")
      .eq("id", runId)
      .single()
      .throwOnError();
    return data as { sent_at: string | null; skipped_reason: string | null };
  }

  it("o toque sai pelo número do job, na conversa desse número", async () => {
    const { clinicId, numero } = await clinicaComNumero("regua-ok");
    const { runId, jobId, jobAccountId } = await execucaoDeFollowup(clinicId);
    expect(jobAccountId).toBe(numero.id);

    resetFakeProvider();
    const worker = `teste-jobs-num-regua-${sufixo}`;
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(jobId, worker),
    );
    expect(desfecho).toBe("concluido");
    expect((await run(runId)).sent_at).not.toBeNull();
    const mensagens = await mensagensDoJob(clinicId, jobId);
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]!.whatsapp_account_id).toBe(numero.id);
    expect(
      fakeSentMessages().find((m) => m.clinicId === clinicId)?.accountId,
    ).toBe(numero.id);
  });

  it("número removido depois de o toque gravar mensagem: pula com numero_removido, sem trocar de número", async () => {
    const { clinicId, numero } = await clinicaComNumero("regua-removido");
    const { contactId, runId, jobId } = await execucaoDeFollowup(clinicId);

    // Uma passagem anterior ja gravou a primeira mensagem do par (o anexo)
    // por este numero, amarrada ao job.
    const { data: conversa } = await admin
      .rpc("garantir_conversa_aberta", {
        p_clinic_id: clinicId,
        p_contact_id: contactId,
        p_whatsapp_account_id: numero.id,
      })
      .throwOnError();
    await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversa as unknown as string,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Primeira mensagem do toque (teste)",
        delivery_status: "enviada",
        job_id: jobId,
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();
    await removerNumero(clinicId, numero.id);

    resetFakeProvider();
    const worker = `teste-jobs-num-regua-rem-${sufixo}`;
    const desfecho = await executarJobComPosse(
      admin,
      worker,
      await reivindicar(jobId, worker),
    );
    expect(desfecho).toBe("falhou");
    expect(await run(runId)).toEqual({
      sent_at: null,
      skipped_reason: "numero_removido",
    });
    const estado = await estadoDoJob(jobId);
    expect(estado.status).toBe("falhou");
    expect(estado.last_error).toBe("numero_removido");
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
  });

  it("clínica que perdeu o único número: o toque espera como no desconectado, sem queimar tentativa e sem abrir conversa", async () => {
    const { clinicId, numero } = await clinicaComNumero("regua-sem-numero");
    const { contactId, runId, jobId, jobAccountId } =
      await execucaoDeFollowup(clinicId);
    expect(jobAccountId).toBe(numero.id);
    const worker = `teste-jobs-num-regua-sem-${sufixo}`;
    const job = await reivindicar(jobId, worker);
    // A clinica remove o unico numero com o toque ja reivindicado (o
    // principal pode sair quando e o unico): numero_do_job tira o numero do
    // job e responde 'sem_numero'.
    await removerNumero(clinicId, numero.id);

    resetFakeProvider();
    const antes = Date.now();
    const desfecho = await executarJobComPosse(admin, worker, job);
    // Nao e falha do toque: volta para a fila depois da espera de
    // reconexao (5 minutos), como o numero desconectado. Antes do desvio
    // pelo 'sem_numero', garantir_conversa_aberta recusava (23502) e o toque
    // gastava as tentativas com 'conversa_indisponivel'.
    expect(desfecho).toBe("reagendado");

    const { data: linha } = await admin
      .from("job_queue")
      .select(
        "status, attempts, run_at, last_error, whatsapp_account_id, ultimo_motivo_devolucao",
      )
      .eq("id", jobId)
      .single()
      .throwOnError();
    const estado = linha as {
      status: string;
      attempts: number;
      run_at: string;
      last_error: string | null;
      whatsapp_account_id: string | null;
      ultimo_motivo_devolucao: string | null;
    };
    expect(estado.status).toBe("pendente");
    // reivindicar somou 1; reagendar_job devolve a tentativa.
    expect(estado.attempts).toBe(0);
    expect(estado.last_error).toBeNull();
    expect(estado.whatsapp_account_id).toBeNull();
    expect(estado.ultimo_motivo_devolucao).toBe("sem_numero");
    expect(new Date(estado.run_at).getTime()).toBeGreaterThanOrEqual(
      antes + 4 * MINUTO,
    );

    // A run continua aberta (nem enviada, nem pulada), nada saiu e nenhuma
    // conversa nasceu.
    expect(await run(runId)).toEqual({ sent_at: null, skipped_reason: null });
    expect(await mensagensDoJob(clinicId, jobId)).toEqual([]);
    expect(fakeSentMessages().filter((m) => m.clinicId === clinicId)).toEqual(
      [],
    );
    const { data: conversas } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactId)
      .throwOnError();
    expect(conversas).toEqual([]);
  });
});

describe("Cobrar agora pelo número do paciente", () => {
  async function consultaAmanha(clinicId: string, contactId: string) {
    const { data: profissional } = await admin
      .from("professional")
      .insert({ clinic_id: clinicId, name: "Dra. Número" })
      .select("id")
      .single()
      .throwOnError();
    const { data: procedimento } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicId,
        name: "Consulta",
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: profissional!.id,
        procedure_id: procedimento!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const inicio = new Date(Date.now() + 20 * HORA);
    const { data: consulta } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        professional_id: profissional!.id,
        service_link_id: vinculo!.id,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();
    return consulta!.id as string;
  }

  it("o job nasce com o número do paciente e o retorno conta os desconectados", async () => {
    const { clinicId, numero } = await clinicaComNumero("cobrar");
    const contactId = await contatoComConsentimento(clinicId);
    const appointmentId = await consultaAmanha(clinicId, contactId);

    const resultado = await planejarCobrancaManual(admin, admin, {
      clinicId,
      timezone: "America/Fortaleza",
      appointmentIds: [appointmentId],
    });
    expect(resultado).toMatchObject({
      ok: true,
      enfileirados: 1,
      pulados_sem_autorizacao: 0,
      pulados_desconectado: 0,
      numeros_desconectados: [],
      cobrados: [appointmentId],
    });

    const { data: jobs } = await admin
      .from("job_queue")
      .select("whatsapp_account_id, payload")
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua")
      .throwOnError();
    expect(jobs).toHaveLength(1);
    expect(jobs![0]!.whatsapp_account_id).toBe(numero.id);
  });

  it("com o único número desconectado, recusa com a frase de sempre e não enfileira", async () => {
    const { clinicId } = await clinicaComNumero("cobrar-fora", {
      connection_status: "desconectado",
    });
    const contactId = await contatoComConsentimento(clinicId);
    const appointmentId = await consultaAmanha(clinicId, contactId);

    const resultado = await planejarCobrancaManual(admin, admin, {
      clinicId,
      timezone: "America/Fortaleza",
      appointmentIds: [appointmentId],
    });
    expect(resultado.ok).toBe(false);
    // Com um numero so, a tela nao ganha um nome que ninguem escolheu.
    expect(resultado.error).toBe(
      "O WhatsApp está desconectado, então a mensagem não sairia. Reconecte em Configurações e cobre de novo.",
    );
    expect(resultado.numeros_desconectados).toEqual([]);

    const { count } = await admin
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("kind", "executar_passo_de_regua");
    expect(count).toBe(0);
  });
});
