import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { afterAll, describe, expect, it } from "vitest";

import { minutosLocais, minutosParaHora } from "@/lib/domain/horarios";
import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { processarLote } from "@/lib/jobs/worker";
import { MENU_CONFIRMACAO } from "@/lib/domain/textos-padrao";
import { adminClient } from "../rls/stack";

// Aceite da tarefa 4.6 contra o banco REAL: a regua nao duplica envio,
// respeita a janela, pula quem nao autorizou e para na condicao de parada,
// com DOIS planners e DOIS workers simultaneos.
//
// Toda clinica daqui nasce com whatsapp_account provider 'fake': o canal desta
// maquina e real (uazapi) e nenhum teste pode encostar nele. Cada cenario usa
// a propria clinica descartavel, porque um envio impoe o espacamento anti-ban
// de massa (10 a 30s) ao PROXIMO envio do MESMO numero.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const DIAS_TODOS = [0, 1, 2, 3, 4, 5, 6];
const JANELA_AMPLA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: DIAS_TODOS,
};

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

type Cenario = {
  clinicId: string;
  professionalId: string;
  serviceLinkId: string;
  timezone: string;
};

type PassoDaRegua = { id: string; offset_minutes: number };

async function montarCenario(nome: string): Promise<Cenario> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Régua ${nome} ${sufixo}`,
      slug: `regua-${nome}-${sufixo}`,
    })
    .select("id, timezone")
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

  const { data: profissional } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Régua" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procedimento } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Limpeza de pele",
      default_duration_min: 30,
      prep_instructions: "Venha sem maquiagem, por favor.",
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
      price_cents: 15000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  return {
    clinicId,
    professionalId: profissional!.id as string,
    serviceLinkId: vinculo!.id as string,
    timezone: clinica!.timezone as string,
  };
}

async function criarContato(
  clinicId: string,
  telefone: string,
  opts: { consentimento: "ativo" | "nenhum" },
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Régua",
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = data!.id as string;
  if (opts.consentimento === "ativo") {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicId,
        contact_id: contactId,
        channel: "whatsapp",
        source: "recepcao",
      })
      .throwOnError();
  }
  return contactId;
}

async function criarConsulta(
  cenario: Cenario,
  contactId: string,
  startsAt: Date,
): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: contactId,
      professional_id: cenario.professionalId,
      service_link_id: cenario.serviceLinkId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 30 * MINUTO).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Liga a régua de confirmação da clínica de teste com a janela informada. */
async function ligarConfirmacao(
  clinicId: string,
  janela: {
    send_window_start: string;
    send_window_end: string;
    send_weekdays: number[];
  },
): Promise<PassoDaRegua[]> {
  const { data } = await admin
    .from("cadence")
    .update({ active: true, ...janela })
    .eq("clinic_id", clinicId)
    .eq("kind", "confirmacao")
    .select("id, cadence_step ( id, offset_minutes )")
    .single()
    .throwOnError();
  return (data as unknown as { cadence_step: PassoDaRegua[] }).cadence_step;
}

/** Janela estreita que NÃO contém o instante de agora, no fuso da clínica. */
function janelaLongeDeAgora(timezone: string) {
  const agora = minutosLocais(timezone, new Date());
  let inicio = agora + 120;
  let fim = inicio + 60;
  if (fim > 23 * 60 + 59) {
    // Perto da meia-noite a janela vai para trás, senão viraria o dia.
    fim = agora - 60;
    inicio = fim - 60;
  }
  return {
    send_window_start: minutosParaHora(inicio),
    send_window_end: minutosParaHora(fim),
    send_weekdays: DIAS_TODOS,
  };
}

async function planejar(): Promise<void> {
  const { error } = await admin.rpc("planejar_reguas");
  expect(error).toBeNull();
}

type LinhaDeRun = {
  id: string;
  cadence_step_id: string;
  scheduled_for: string;
  sent_at: string | null;
  skipped_reason: string | null;
  message_id: string | null;
};

async function runsDaClinica(clinicId: string): Promise<LinhaDeRun[]> {
  const { data } = await admin
    .from("cadence_run")
    .select(
      "id, cadence_step_id, scheduled_for, sent_at, skipped_reason, message_id",
    )
    .eq("clinic_id", clinicId)
    .order("scheduled_for", { ascending: true });
  return (data ?? []) as LinhaDeRun[];
}

type LinhaDeJob = {
  id: string;
  status: string;
  attempts: number;
  run_at: string;
  last_error: string | null;
};

async function jobsDeRegua(clinicId: string): Promise<LinhaDeJob[]> {
  const { data } = await admin
    .from("job_queue")
    .select("id, status, attempts, run_at, last_error")
    .eq("clinic_id", clinicId)
    .eq("kind", "executar_passo_de_regua");
  return (data ?? []) as LinhaDeJob[];
}

/** Deixa o toque pronto para ser executado agora e roda o worker. */
async function adiantarEProcessar(
  clinicId: string,
  workers: string[],
): Promise<void> {
  await admin
    .from("job_queue")
    .update({ run_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("kind", "executar_passo_de_regua")
    .eq("status", "pendente");
  await Promise.allSettled(
    workers.map((worker) => processarLote(admin, worker, { limite: 10 })),
  );
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("planner das réguas", () => {
  it("planejar_reguas duas vezes NÃO duplica execução nem job", async () => {
    const cenario = await montarCenario("plano");
    await ligarConfirmacao(cenario.clinicId, JANELA_AMPLA);
    const contactId = await criarContato(cenario.clinicId, "+5584961000001", {
      consentimento: "ativo",
    });
    // O passo de 3h vence daqui a 10 minutos: dentro do horizonte do planner.
    await criarConsulta(
      cenario,
      contactId,
      new Date(Date.now() + 3 * HORA + 10 * MINUTO),
    );

    await planejar();
    await planejar();

    expect(await runsDaClinica(cenario.clinicId)).toHaveLength(1);
    expect(await jobsDeRegua(cenario.clinicId)).toHaveLength(1);

    // Higiene: o toque desta clínica não pode sobrar para os outros cenários.
    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId);
  });

  it("dois planners e dois workers simultâneos: UMA mensagem só", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("corrida");
    await ligarConfirmacao(cenario.clinicId, JANELA_AMPLA);
    const telefone = "+5584961000002";
    const contactId = await criarContato(cenario.clinicId, telefone, {
      consentimento: "ativo",
    });
    await criarConsulta(
      cenario,
      contactId,
      new Date(Date.now() + 3 * HORA + 10 * MINUTO),
    );

    // Dois planners ao mesmo tempo: a unique da tripla é a trava.
    const planos = await Promise.allSettled([
      admin.rpc("planejar_reguas"),
      admin.rpc("planejar_reguas"),
    ]);
    expect(planos.every((p) => p.status === "fulfilled")).toBe(true);
    const runs = await runsDaClinica(cenario.clinicId);
    expect(runs).toHaveLength(1);
    expect(await jobsDeRegua(cenario.clinicId)).toHaveLength(1);

    // Dois workers ao mesmo tempo: SKIP LOCKED no claim e unique de job_id
    // no envio. O paciente recebe uma mensagem, não duas.
    await adiantarEProcessar(cenario.clinicId, ["worker-a", "worker-b"]);

    const enviadas = fakeSentMessages().filter((m) => m.to === telefone);
    expect(enviadas).toHaveLength(1);
    // Confirmação sai com opções de resposta, e o modelo foi preenchido.
    // Amarrado a FONTE UNICA, nao a um numero: era exatamente a divergencia
    // entre o menu enviado e o menu que interpretarResposta esperava que este
    // teste deixou passar (o paciente que respondia "2" para cancelar era lido
    // como "remarcar" e a consulta nunca era cancelada).
    expect((enviadas[0]?.menuOptions ?? []).map((o) => o.id)).toEqual(
      MENU_CONFIRMACAO.map((o) => o.id),
    );
    expect(enviadas[0]?.body).toContain("Paciente Régua");
    expect(enviadas[0]?.body).not.toContain("{{");

    const depois = await runsDaClinica(cenario.clinicId);
    expect(depois[0]?.sent_at).not.toBeNull();
    expect(depois[0]?.message_id).not.toBeNull();
    expect(depois[0]?.skipped_reason).toBeNull();

    const { data: mensagens } = await admin
      .from("message")
      .select("id, author, direction, cost_cents, delivery_status")
      .eq("clinic_id", cenario.clinicId);
    expect(mensagens).toHaveLength(1);
    expect(mensagens?.[0]).toMatchObject({
      author: "sistema",
      direction: "saida",
      delivery_status: "enviada",
      cost_cents: 0,
    });
  });
});

describe("os seis passos do toque", () => {
  it("sem autorização: não envia, marca a execução e grava a trilha", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("semauth");
    await ligarConfirmacao(cenario.clinicId, JANELA_AMPLA);
    const telefone = "+5584961000003";
    const contactId = await criarContato(cenario.clinicId, telefone, {
      consentimento: "nenhum",
    });
    await criarConsulta(
      cenario,
      contactId,
      new Date(Date.now() + 3 * HORA + 10 * MINUTO),
    );

    await planejar();
    await adiantarEProcessar(cenario.clinicId, ["worker-semauth"]);

    expect(fakeSentMessages().filter((m) => m.to === telefone)).toHaveLength(0);
    const runs = await runsDaClinica(cenario.clinicId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.skipped_reason).toBe("sem_consentimento");
    expect(runs[0]?.sent_at).toBeNull();

    const { data: trilha } = await admin
      .from("audit_log")
      .select("action")
      .eq("clinic_id", cenario.clinicId);
    expect(
      trilha?.some((l) => l.action === "envio_bloqueado_sem_autorizacao"),
    ).toBe(true);

    // Pular não é erro do job: a fila conclui e não martela.
    const jobs = await jobsDeRegua(cenario.clinicId);
    expect(jobs[0]?.status).toBe("concluido");
  });

  it("fora da janela: o job é REAGENDADO e a tentativa não é queimada", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("janela");
    await ligarConfirmacao(
      cenario.clinicId,
      janelaLongeDeAgora(cenario.timezone),
    );
    const telefone = "+5584961000004";
    const contactId = await criarContato(cenario.clinicId, telefone, {
      consentimento: "ativo",
    });
    // 72h à frente: o primeiro passo (-4320) vence agora e a próxima abertura
    // da janela ainda cai muito antes da consulta.
    await criarConsulta(cenario, contactId, new Date(Date.now() + 72 * HORA));

    await planejar();
    await adiantarEProcessar(cenario.clinicId, ["worker-janela"]);

    expect(fakeSentMessages().filter((m) => m.to === telefone)).toHaveLength(0);
    const runs = await runsDaClinica(cenario.clinicId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.skipped_reason).toBeNull();
    expect(runs[0]?.sent_at).toBeNull();

    const jobs = await jobsDeRegua(cenario.clinicId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("pendente");
    expect(jobs[0]?.attempts).toBe(0);
    expect(new Date(jobs[0]!.run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("consulta cancelada: para o toque devido E os passos seguintes", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("parada");
    const passos = await ligarConfirmacao(cenario.clinicId, JANELA_AMPLA);
    const telefone = "+5584961000005";
    const contactId = await criarContato(cenario.clinicId, telefone, {
      consentimento: "ativo",
    });
    const appointmentId = await criarConsulta(
      cenario,
      contactId,
      new Date(Date.now() + 3 * HORA + 10 * MINUTO),
    );

    await planejar();
    // Um toque futuro da MESMA consulta, para provar que ele também morre.
    const passoFuturo = passos.find((p) => p.offset_minutes === -1440);
    await admin
      .from("cadence_run")
      .insert({
        clinic_id: cenario.clinicId,
        cadence_step_id: passoFuturo!.id,
        contact_id: contactId,
        appointment_id: appointmentId,
        scheduled_for: new Date(Date.now() + 6 * HORA).toISOString(),
      })
      .throwOnError();

    await admin
      .from("appointment")
      .update({ status: "cancelado_paciente" })
      .eq("id", appointmentId)
      .throwOnError();

    await adiantarEProcessar(cenario.clinicId, ["worker-parada"]);

    expect(fakeSentMessages().filter((m) => m.to === telefone)).toHaveLength(0);
    const runs = await runsDaClinica(cenario.clinicId);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.skipped_reason === "condicao_parada")).toBe(
      true,
    );
    expect(runs.every((r) => r.sent_at === null)).toBe(true);
  });

  it("consulta remarcada: a execução velha morre e o planner materializa a nova", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("remarca");
    await ligarConfirmacao(cenario.clinicId, JANELA_AMPLA);
    const telefone = "+5584961000006";
    const contactId = await criarContato(cenario.clinicId, telefone, {
      consentimento: "ativo",
    });
    const appointmentId = await criarConsulta(
      cenario,
      contactId,
      new Date(Date.now() + 3 * HORA + 10 * MINUTO),
    );

    await planejar();
    const antes = await runsDaClinica(cenario.clinicId);
    expect(antes).toHaveLength(1);

    // Remarcação: o toque planejado aponta para o horário antigo.
    const novoInicio = new Date(Date.now() + 3 * HORA + 40 * MINUTO);
    await admin
      .from("appointment")
      .update({
        starts_at: novoInicio.toISOString(),
        ends_at: new Date(novoInicio.getTime() + 30 * MINUTO).toISOString(),
      })
      .eq("id", appointmentId)
      .throwOnError();

    await adiantarEProcessar(cenario.clinicId, ["worker-remarca"]);
    expect(fakeSentMessages().filter((m) => m.to === telefone)).toHaveLength(0);

    const velha = (await runsDaClinica(cenario.clinicId)).find(
      (r) => r.id === antes[0]!.id,
    );
    expect(velha?.skipped_reason).toBe("condicao_parada");

    // O planner materializa o toque do horário novo, com outra chave natural.
    await planejar();
    const depois = await runsDaClinica(cenario.clinicId);
    expect(depois).toHaveLength(2);
    const nova = depois.find((r) => r.id !== antes[0]!.id);
    expect(nova?.skipped_reason).toBeNull();
    expect(new Date(nova!.scheduled_for).getTime()).toBe(
      novoInicio.getTime() - 180 * MINUTO,
    );

    await admin
      .from("job_queue")
      .update({ status: "cancelado" })
      .eq("clinic_id", cenario.clinicId)
      .eq("status", "pendente");
  });

  it("o toque move a consulta para aguardando confirmação, com autoria do sistema", async () => {
    resetFakeProvider();
    const cenario = await montarCenario("status");
    await ligarConfirmacao(cenario.clinicId, JANELA_AMPLA);
    const telefone = "+5584961000007";
    const contactId = await criarContato(cenario.clinicId, telefone, {
      consentimento: "ativo",
    });
    const inicio = new Date(Date.now() + 3 * HORA + 10 * MINUTO);
    const appointmentId = await criarConsulta(cenario, contactId, inicio);

    await planejar();
    await adiantarEProcessar(cenario.clinicId, ["worker-status"]);

    const enviadas = fakeSentMessages().filter((m) => m.to === telefone);
    expect(enviadas).toHaveLength(1);
    // A hora sai no fuso da CLÍNICA, não no do servidor (regra 3.6).
    expect(enviadas[0]?.body).toContain(
      format(new TZDate(inicio.getTime(), cenario.timezone), "HH:mm"),
    );
    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", appointmentId)
      .single();
    expect(consulta?.status).toBe("aguardando_confirmacao");

    const { data: historico } = await admin
      .from("appointment_status_history")
      .select("status, changed_by, changed_by_user_id")
      .eq("appointment_id", appointmentId)
      .eq("status", "aguardando_confirmacao");
    expect(historico).toHaveLength(1);
    expect(historico?.[0]).toMatchObject({
      changed_by: "sistema",
      changed_by_user_id: null,
    });
  });
});
