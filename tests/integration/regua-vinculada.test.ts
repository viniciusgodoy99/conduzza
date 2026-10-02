import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { planejarCobrancaManual } from "@/lib/jobs/cobranca-manual";
import { executarJobComPosse, type Job } from "@/lib/jobs/worker";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Regua vinculada a medico, especialidade ou procedimento (decisao do dono de
// 29/09/2026, migration 20260929110000) contra o banco REAL:
//
// - o planner escolhe, para cada consulta, a regua de regua_da_consulta:
//   procedimento > profissional > especialidade > geral; a reforcada vence no
//   nivel so com o limiar de faltas; desligada cai para a proxima; empate de
//   especialidade (o medico tem as duas) e deterministico;
// - o pos falta tambem (antes era "limit 1" sem ordem);
// - troca de medico no meio da sequencia: a run da regua antiga e pulada pelo
//   executor como 'condicao_parada', sem mensagem, e o planner materializa a
//   da regua vigente.
// - toque repetido quando a vigente muda: passo JA VENCIDO nao nasce se a
//   consulta recebeu toque do mesmo tipo nos ultimos 30 minutos (ligar a
//   vinculada logo depois do toque da geral, desligar a vinculada logo depois
//   do toque dela); passo futuro continua nascendo adiantado;
// - "Cobrar agora" usa os passos da regua vigente da consulta.
//
// Clinicas e_de_teste (o motor de producao ignora os jobs delas) e numero
// 'fake': nenhum teste encosta no WhatsApp real. Os jobs so rodam pelo claim
// manual deste arquivo.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const MINUTO = 60_000;
const JANELA_ABERTA = {
  send_window_start: "00:00",
  send_window_end: "23:59",
  send_weekdays: [0, 1, 2, 3, 4, 5, 6],
};

let sequencia = 0;
function telefone(): string {
  sequencia += 1;
  return `+55849786${String(sequencia).padStart(5, "0")}`;
}

/** Base comum dos horarios: o minuto cheio de agora. */
const BASE = Math.floor(Date.now() / MINUTO) * MINUTO;

type Kind = "confirmacao" | "pos_falta";
type Vinculo =
  | { procedure_id: string }
  | { professional_id: string }
  | { specialty: string }
  | Record<string, never>;

async function clinicaDeTeste(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Régua vinculada ${nome} ${sufixo}`,
      slug: `regua-vinc-${nome}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  await criarNumeroDeTeste(admin, clinicId);
  return clinicId;
}

async function profissional(
  clinicId: string,
  nome: string,
  specialties: string[],
): Promise<string> {
  const { data } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: nome, specialties })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function procedimento(clinicId: string, nome: string): Promise<string> {
  const { data } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: nome, default_duration_min: 10 })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function vinculo(
  clinicId: string,
  professionalId: string,
  procedureId: string,
): Promise<string> {
  const { data } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: professionalId,
      procedure_id: procedureId,
      duration_min: 10,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function contato(
  clinicId: string,
  campos: Record<string, unknown> = {},
): Promise<{ id: string; telefone: string }> {
  const numero = telefone();
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: numero,
      name: "Paciente Régua Vinculada",
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
  return { id: contactId, telefone: numero };
}

type Agenda = { professionalId: string; serviceLinkId: string };

/** Consulta de 10 minutos que comeca `minutos` depois de BASE. */
async function consulta(
  clinicId: string,
  contactId: string,
  agenda: Agenda,
  minutos: number,
  campos: Record<string, unknown> = {},
): Promise<string> {
  const inicio = BASE + minutos * MINUTO;
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      professional_id: agenda.professionalId,
      service_link_id: agenda.serviceLinkId,
      starts_at: new Date(inicio).toISOString(),
      ends_at: new Date(inicio + 10 * MINUTO).toISOString(),
      ...campos,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/** Liga a regua geral (a do seed) do tipo, com a janela aberta. */
async function ligarGeral(clinicId: string, kind: Kind): Promise<string> {
  const { data } = await admin
    .from("cadence")
    .update({ active: true, ...JANELA_ABERTA })
    .eq("clinic_id", clinicId)
    .eq("kind", kind)
    .is("procedure_id", null)
    .is("professional_id", null)
    .is("specialty", null)
    .eq("for_no_show_history", false)
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

/**
 * Regua vinculada, LIGADA, com um passo so: 3h antes na confirmacao (cai no
 * horizonte do planner para consulta entre +3h e +4h), na hora no pos falta.
 */
async function reguaVinculada(
  clinicId: string,
  kind: Kind,
  nome: string,
  vinculoDaRegua: Vinculo,
  opcoes: { reforcada?: number } = {},
): Promise<string> {
  const { data } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicId,
      kind,
      name: nome,
      active: true,
      ...JANELA_ABERTA,
      ...vinculoDaRegua,
      ...(opcoes.reforcada !== undefined
        ? { for_no_show_history: true, no_show_threshold: opcoes.reforcada }
        : {}),
    })
    .select("id")
    .single()
    .throwOnError();
  const cadenceId = data!.id as string;
  await admin
    .from("cadence_step")
    .insert({
      clinic_id: clinicId,
      cadence_id: cadenceId,
      offset_minutes: kind === "confirmacao" ? -180 : 0,
      fixed_body: `Oi, {{nome}}! Toque da régua ${nome} (teste).`,
    })
    .throwOnError();
  return cadenceId;
}

async function ligar(cadenceId: string, active: boolean): Promise<void> {
  await admin
    .from("cadence")
    .update({ active })
    .eq("id", cadenceId)
    .throwOnError();
}

async function planejar(): Promise<void> {
  const { error } = await admin.rpc("planejar_reguas");
  expect(error).toBeNull();
}

async function vigente(appointmentId: string, kind: Kind) {
  const { data, error } = await admin.rpc("regua_da_consulta", {
    p_appointment_id: appointmentId,
    p_kind: kind,
  });
  expect(error).toBeNull();
  return (data as string | null) ?? null;
}

type RunDaConsulta = {
  id: string;
  sent_at: string | null;
  skipped_reason: string | null;
  cadence_id: string;
};

async function runsDaConsulta(appointmentId: string): Promise<RunDaConsulta[]> {
  const { data } = await admin
    .from("cadence_run")
    .select("id, sent_at, skipped_reason, cadence_step ( cadence_id )")
    .eq("appointment_id", appointmentId)
    .throwOnError();
  return (
    (data ?? []) as unknown as {
      id: string;
      sent_at: string | null;
      skipped_reason: string | null;
      cadence_step: { cadence_id: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    sent_at: r.sent_at,
    skipped_reason: r.skipped_reason,
    cadence_id: r.cadence_step?.cadence_id ?? "",
  }));
}

/** O claim que o motor faria, so para o job desta run. */
async function reivindicarJobDaRun(
  runId: string,
  workerId: string,
): Promise<Job> {
  const { data: atual } = await admin
    .from("job_queue")
    .select("id, attempts")
    .eq("kind", "executar_passo_de_regua")
    .eq("payload->>cadence_run_id", runId)
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
    .eq("id", atual!.id as string)
    .eq("status", "pendente")
    .select(
      "id, clinic_id, kind, payload, attempts, max_attempts, whatsapp_account_id, created_at",
    )
    .single()
    .throwOnError();
  return data as unknown as Job;
}

async function statusDoJob(jobId: string): Promise<string> {
  const { data } = await admin
    .from("job_queue")
    .select("status")
    .eq("id", jobId)
    .single()
    .throwOnError();
  return data!.status as string;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("planner: a régua mais específica vence", () => {
  let clinicId = "";
  let geral = "";
  let porEspecialidade = "";
  let porEstetica = "";
  let porProfissional = "";
  let porProfissionalReforcada = "";
  let porProcedimento = "";
  let x = "";
  let y = "";
  let draA: Agenda & { comP1: string } = {
    professionalId: "",
    serviceLinkId: "",
    comP1: "",
  };
  let drB: Agenda = { professionalId: "", serviceLinkId: "" };
  let drC: Agenda = { professionalId: "", serviceLinkId: "" };
  let draD: Agenda = { professionalId: "", serviceLinkId: "" };

  beforeAll(async () => {
    clinicId = await clinicaDeTeste("niveis");
    const p1 = await procedimento(clinicId, "Peeling");
    const p2 = await procedimento(clinicId, "Consulta");
    const a = await profissional(clinicId, "Dra. A", ["Dermatologia"]);
    const b = await profissional(clinicId, "Dr. B", ["Cardiologia"]);
    // Grafia diferente da regua: casa pela chave da especialidade.
    const c = await profissional(clinicId, "Dr. C", ["  DERMATOLOGIA "]);
    const d = await profissional(clinicId, "Dra. D", [
      "Dermatologia",
      "Estética",
    ]);
    draA = {
      professionalId: a,
      serviceLinkId: await vinculo(clinicId, a, p2),
      comP1: await vinculo(clinicId, a, p1),
    };
    drB = { professionalId: b, serviceLinkId: await vinculo(clinicId, b, p2) };
    drC = { professionalId: c, serviceLinkId: await vinculo(clinicId, c, p2) };
    draD = { professionalId: d, serviceLinkId: await vinculo(clinicId, d, p2) };

    geral = await ligarGeral(clinicId, "confirmacao");
    porEspecialidade = await reguaVinculada(
      clinicId,
      "confirmacao",
      "Dermatologia",
      { specialty: "Dermatologia" },
    );
    porProfissional = await reguaVinculada(clinicId, "confirmacao", "Dra. A", {
      professional_id: a,
    });
    porProcedimento = await reguaVinculada(clinicId, "confirmacao", "Peeling", {
      procedure_id: p1,
    });
    porProfissionalReforcada = await reguaVinculada(
      clinicId,
      "confirmacao",
      "Dra. A reforçada",
      { professional_id: a },
      { reforcada: 2 },
    );
    // Criada DEPOIS da de Dermatologia: no empate da Dra. D, perde.
    porEstetica = await reguaVinculada(clinicId, "confirmacao", "Estética", {
      specialty: "Estética",
    });

    x = (await contato(clinicId)).id;
    y = (await contato(clinicId, { no_show_count: 2 })).id;
  });

  it("cada consulta ganha UMA run, da régua do nível mais alto que casa", async () => {
    // Consultas entre +3h e +4h: so o passo de 3h antes cai no horizonte.
    const comProcedimento = await consulta(
      clinicId,
      x,
      { professionalId: draA.professionalId, serviceLinkId: draA.comP1 },
      185,
    );
    const comProfissional = await consulta(clinicId, x, draA, 200);
    const comEspecialidade = await consulta(clinicId, x, drC, 185);
    const semVinculo = await consulta(clinicId, x, drB, 225);
    const reforcada = await consulta(clinicId, y, draA, 215);
    const empate = await consulta(clinicId, x, draD, 185);

    await planejar();

    const esperado: [string, string][] = [
      [comProcedimento, porProcedimento],
      [comProfissional, porProfissional],
      [comEspecialidade, porEspecialidade],
      [semVinculo, geral],
      [reforcada, porProfissionalReforcada],
      [empate, porEspecialidade],
    ];
    for (const [appointmentId, cadenceId] of esperado) {
      const runs = await runsDaConsulta(appointmentId);
      expect(runs, `runs da consulta ${appointmentId}`).toHaveLength(1);
      expect(runs[0]!.cadence_id).toBe(cadenceId);
      expect(await vigente(appointmentId, "confirmacao")).toBe(cadenceId);
    }

    // Planejar de novo nao duplica nem troca de regua.
    await planejar();
    for (const [appointmentId] of esperado) {
      expect(await runsDaConsulta(appointmentId)).toHaveLength(1);
    }
  });

  it("empate de especialidade é determinístico: a régua mais antiga, sempre", async () => {
    const empate = await consulta(clinicId, x, draD, 300);
    const primeira = await vigente(empate, "confirmacao");
    expect(primeira).toBe(porEspecialidade);
    expect(await vigente(empate, "confirmacao")).toBe(primeira);
    expect(primeira).not.toBe(porEstetica);
  });

  it("desligada cai para a próxima; tudo desligado não tem régua", async () => {
    const comProcedimento = await consulta(
      clinicId,
      x,
      { professionalId: draA.professionalId, serviceLinkId: draA.comP1 },
      320,
    );
    try {
      expect(await vigente(comProcedimento, "confirmacao")).toBe(
        porProcedimento,
      );
      await ligar(porProcedimento, false);
      expect(await vigente(comProcedimento, "confirmacao")).toBe(
        porProfissional,
      );
      await ligar(porProfissional, false);
      expect(await vigente(comProcedimento, "confirmacao")).toBe(
        porEspecialidade,
      );
      await ligar(porEspecialidade, false);
      expect(await vigente(comProcedimento, "confirmacao")).toBe(geral);
      await ligar(geral, false);
      expect(await vigente(comProcedimento, "confirmacao")).toBeNull();
    } finally {
      for (const id of [
        porProcedimento,
        porProfissional,
        porEspecialidade,
        geral,
      ]) {
        await ligar(id, true);
      }
    }
  });

  it("reforçada vence no nível só com o limiar, e não pula o nível de cima", async () => {
    const semFaltas = await consulta(clinicId, x, draA, 340);
    const comFaltas = await consulta(clinicId, y, draA, 360);
    expect(await vigente(semFaltas, "confirmacao")).toBe(porProfissional);
    expect(await vigente(comFaltas, "confirmacao")).toBe(
      porProfissionalReforcada,
    );

    // Geral reforcada com limiar 1: vale para Y so onde nada mais especifico
    // casa (Dr. B), nunca por cima da regua da Dra. A.
    const geralReforcada = await reguaVinculada(
      clinicId,
      "confirmacao",
      "Geral reforçada",
      {},
      { reforcada: 1 },
    );
    try {
      const comFaltasNoDrB = await consulta(clinicId, y, drB, 380);
      expect(await vigente(comFaltasNoDrB, "confirmacao")).toBe(geralReforcada);
      expect(await vigente(comFaltas, "confirmacao")).toBe(
        porProfissionalReforcada,
      );
    } finally {
      await admin.from("cadence").delete().eq("id", geralReforcada);
    }
  });
});

describe("pós falta vinculado", () => {
  it("a régua do médico vence a geral, e o planner só materializa a dela", async () => {
    const clinicId = await clinicaDeTeste("pos-falta");
    const procedimentoId = await procedimento(clinicId, "Consulta");
    const a = await profissional(clinicId, "Dra. A", ["Dermatologia"]);
    const agenda = {
      professionalId: a,
      serviceLinkId: await vinculo(clinicId, a, procedimentoId),
    };
    const geral = await ligarGeral(clinicId, "pos_falta");
    const daDraA = await reguaVinculada(clinicId, "pos_falta", "Falta Dra. A", {
      professional_id: a,
    });
    const z = await contato(clinicId);

    // Consulta que ja passou, marcada como falta como a Agenda faz: status
    // e trilha (a trilha e gravada pela Server Action, nao por gatilho).
    const falta = await consulta(clinicId, z.id, agenda, -180, {
      status: "confirmado_recepcao",
      confirmation_channel: "telefone",
    });
    await admin
      .from("appointment")
      .update({ status: "faltou" })
      .eq("id", falta)
      .throwOnError();
    await admin
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicId,
        appointment_id: falta,
        status: "faltou",
        changed_by: "usuario",
      })
      .throwOnError();

    expect(await vigente(falta, "pos_falta")).toBe(daDraA);
    await planejar();
    const runs = await runsDaConsulta(falta);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.cadence_id).toBe(daDraA);

    // Desligada, a consulta cai na geral.
    await ligar(daDraA, false);
    expect(await vigente(falta, "pos_falta")).toBe(geral);
  });
});

describe("executor: a run de uma régua que deixou de valer não sai", () => {
  async function cenarioDaTroca(nome: string) {
    const clinicId = await clinicaDeTeste(nome);
    const procedimentoId = await procedimento(clinicId, "Consulta");
    const a = await profissional(clinicId, "Dra. A", ["Dermatologia"]);
    const b = await profissional(clinicId, "Dr. B", ["Cardiologia"]);
    const draA = {
      professionalId: a,
      serviceLinkId: await vinculo(clinicId, a, procedimentoId),
    };
    const drB = {
      professionalId: b,
      serviceLinkId: await vinculo(clinicId, b, procedimentoId),
    };
    const geral = await ligarGeral(clinicId, "confirmacao");
    const daDraA = await reguaVinculada(clinicId, "confirmacao", "Dra. A", {
      professional_id: a,
    });
    const paciente = await contato(clinicId);
    const appointmentId = await consulta(clinicId, paciente.id, draA, 190);
    await planejar();
    const runs = await runsDaConsulta(appointmentId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.cadence_id).toBe(daDraA);
    return {
      clinicId,
      geral,
      daDraA,
      drB,
      paciente,
      appointmentId,
      run: runs[0]!,
    };
  }

  it("controle: a consulta continua com a Dra. A e o toque da régua dela sai", async () => {
    const { paciente, appointmentId, run } = await cenarioDaTroca("controle");
    resetFakeProvider();
    const worker = `teste-regua-vinc-controle-${sufixo}`;
    const job = await reivindicarJobDaRun(run.id, worker);
    expect(await executarJobComPosse(admin, worker, job)).toBe("concluido");

    const enviada = (await runsDaConsulta(appointmentId)).find(
      (r) => r.id === run.id,
    );
    expect(enviada?.sent_at).not.toBeNull();
    expect(enviada?.skipped_reason).toBeNull();
    const enviadas = fakeSentMessages().filter(
      (m) => m.to === paciente.telefone,
    );
    expect(enviadas).toHaveLength(1);
    // O texto e o do passo da regua da Dra. A, nao o da geral.
    expect(enviadas[0]?.body).toContain("Toque da régua Dra. A");
  });

  it("troca de médico no meio da sequência: a run da régua antiga é pulada, sem mensagem, e a geral assume", async () => {
    const { geral, drB, paciente, appointmentId, run } =
      await cenarioDaTroca("troca");

    // A recepcao troca o medico da consulta (mesmo horario).
    await admin
      .from("appointment")
      .update({
        professional_id: drB.professionalId,
        service_link_id: drB.serviceLinkId,
      })
      .eq("id", appointmentId)
      .throwOnError();
    expect(await vigente(appointmentId, "confirmacao")).toBe(geral);

    resetFakeProvider();
    const worker = `teste-regua-vinc-troca-${sufixo}`;
    const job = await reivindicarJobDaRun(run.id, worker);
    expect(await executarJobComPosse(admin, worker, job)).toBe("concluido");
    expect(await statusDoJob(job.id)).toBe("concluido");
    expect(
      fakeSentMessages().filter((m) => m.to === paciente.telefone),
    ).toHaveLength(0);

    const antiga = (await runsDaConsulta(appointmentId)).find(
      (r) => r.id === run.id,
    );
    expect(antiga?.sent_at).toBeNull();
    expect(antiga?.skipped_reason).toBe("condicao_parada");

    // O planner materializa o toque da regua vigente (a geral), com outra
    // chave natural (outro passo).
    await planejar();
    const depois = await runsDaConsulta(appointmentId);
    const nova = depois.find((r) => r.id !== run.id);
    expect(nova?.cadence_id).toBe(geral);
    expect(nova?.skipped_reason).toBeNull();
    expect(nova?.sent_at).toBeNull();
  });
});

/** Os offsets das runs de uma consulta que vieram de uma regua. */
async function offsetsDasRuns(
  appointmentId: string,
  cadenceId: string,
): Promise<number[]> {
  const { data } = await admin
    .from("cadence_run")
    .select("id, cadence_step ( cadence_id, offset_minutes )")
    .eq("appointment_id", appointmentId)
    .throwOnError();
  return (
    (data ?? []) as unknown as {
      cadence_step: { cadence_id: string; offset_minutes: number } | null;
    }[]
  )
    .filter((r) => r.cadence_step?.cadence_id === cadenceId)
    .map((r) => r.cadence_step!.offset_minutes)
    .sort((a, b) => a - b);
}

async function marcarEnviada(runId: string, minutosAtras: number) {
  await admin
    .from("cadence_run")
    .update({
      sent_at: new Date(Date.now() - minutosAtras * MINUTO).toISOString(),
    })
    .eq("id", runId)
    .throwOnError();
}

describe("toque repetido quando a régua vigente muda", () => {
  it("a geral enviou o passo há 10 minutos; ligar a vinculada do médico não repete o passo, e o passo futuro dela nasce", async () => {
    const clinicId = await clinicaDeTeste("repetido-conf");
    const procedimentoId = await procedimento(clinicId, "Consulta");
    const e = await profissional(clinicId, "Dr. E", ["Neurologia"]);
    const agenda = {
      professionalId: e,
      serviceLinkId: await vinculo(clinicId, e, procedimentoId),
    };
    const geral = await ligarGeral(clinicId, "confirmacao");
    const paciente = await contato(clinicId);

    // Consulta em 24 horas menos 10 minutos: o passo de 24 horas antes da
    // geral (seed: -4320, -1440, -180) venceu ha 10 minutos e, sem toque
    // nenhum ainda, e recuperado pela folga de 30 minutos.
    const appointmentId = await consulta(clinicId, paciente.id, agenda, 1430);
    await planejar();
    const antes = await runsDaConsulta(appointmentId);
    expect(antes).toHaveLength(1);
    expect(antes[0]!.cadence_id).toBe(geral);
    expect(await offsetsDasRuns(appointmentId, geral)).toEqual([-1440]);

    // O toque da geral SAIU ha 10 minutos.
    await marcarEnviada(antes[0]!.id, 10);

    // A clinica cria a vinculada do Dr. E (nasce desligada, copia do -1440
    // da geral) com mais um passo, daqui a 20 minutos, e liga.
    const { data: nova } = await admin
      .from("cadence")
      .insert({
        clinic_id: clinicId,
        kind: "confirmacao",
        name: "Confirmação: Dr. E",
        professional_id: e,
        active: false,
        ...JANELA_ABERTA,
      })
      .select("id")
      .single()
      .throwOnError();
    const daDrE = nova!.id as string;
    await admin
      .from("cadence_step")
      .insert([
        {
          clinic_id: clinicId,
          cadence_id: daDrE,
          offset_minutes: -1440,
          fixed_body: "Oi, {{nome}}! Cópia da geral (teste).",
        },
        {
          clinic_id: clinicId,
          cadence_id: daDrE,
          offset_minutes: -1410,
          fixed_body: "Oi, {{nome}}! Passo futuro (teste).",
        },
      ])
      .throwOnError();
    await ligar(daDrE, true);
    expect(await vigente(appointmentId, "confirmacao")).toBe(daDrE);

    await planejar();
    // O -1440 da vinculada NAO nasce (o paciente acabou de receber a mesma
    // pergunta); o -1410, futuro, nasce adiantado como sempre.
    expect(await offsetsDasRuns(appointmentId, daDrE)).toEqual([-1410]);
    expect(await offsetsDasRuns(appointmentId, geral)).toEqual([-1440]);
  });

  it("pós falta: o +0 da vinculada saiu e ela foi desligada; a geral não repete o +0", async () => {
    const clinicId = await clinicaDeTeste("repetido-pf");
    const procedimentoId = await procedimento(clinicId, "Consulta");
    const a = await profissional(clinicId, "Dra. A", ["Dermatologia"]);
    const agenda = {
      professionalId: a,
      serviceLinkId: await vinculo(clinicId, a, procedimentoId),
    };
    const geral = await ligarGeral(clinicId, "pos_falta");
    const daDraA = await reguaVinculada(clinicId, "pos_falta", "Falta Dra. A", {
      professional_id: a,
    });
    const z = await contato(clinicId);
    const falta = await consulta(clinicId, z.id, agenda, -180, {
      status: "confirmado_recepcao",
      confirmation_channel: "telefone",
    });
    await admin
      .from("appointment")
      .update({ status: "faltou" })
      .eq("id", falta)
      .throwOnError();
    await admin
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicId,
        appointment_id: falta,
        status: "faltou",
        changed_by: "usuario",
      })
      .throwOnError();

    await planejar();
    const runs = await runsDaConsulta(falta);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.cadence_id).toBe(daDraA);

    // O +0 da vinculada saiu agora; a clinica desliga a vinculada em seguida.
    await marcarEnviada(runs[0]!.id, 0);
    await ligar(daDraA, false);
    expect(await vigente(falta, "pos_falta")).toBe(geral);

    await planejar();
    expect(await offsetsDasRuns(falta, geral)).toEqual([]);
    expect(await runsDaConsulta(falta)).toHaveLength(1);
  });
});

describe("Cobrar agora usa a régua vigente da consulta", () => {
  it("a consulta da Dra. A cobra com o texto da régua dela; a do Dr. B, com o da geral", async () => {
    const clinicId = await clinicaDeTeste("cobrar");
    const procedimentoId = await procedimento(clinicId, "Consulta");
    const a = await profissional(clinicId, "Dra. A", ["Dermatologia"]);
    const b = await profissional(clinicId, "Dr. B", ["Cardiologia"]);
    const draA = {
      professionalId: a,
      serviceLinkId: await vinculo(clinicId, a, procedimentoId),
    };
    const drB = {
      professionalId: b,
      serviceLinkId: await vinculo(clinicId, b, procedimentoId),
    };
    const geral = await ligarGeral(clinicId, "confirmacao");
    const daDraA = await reguaVinculada(clinicId, "confirmacao", "Dra. A", {
      professional_id: a,
    });
    const pacienteA = await contato(clinicId);
    const pacienteB = await contato(clinicId);
    // Amanha: o planner nao alcanca (horizonte de 60 minutos).
    const comA = await consulta(clinicId, pacienteA.id, draA, 20 * 60);
    const comB = await consulta(clinicId, pacienteB.id, drB, 20 * 60);

    const resultado = await planejarCobrancaManual(admin, admin, {
      clinicId,
      timezone: "America/Fortaleza",
      appointmentIds: [comA, comB],
    });
    expect(resultado.ok).toBe(true);
    expect(resultado.enfileirados).toBe(2);

    const [runA] = await runsDaConsulta(comA);
    const [runB] = await runsDaConsulta(comB);
    expect(runA!.cadence_id).toBe(daDraA);
    expect(runB!.cadence_id).toBe(geral);

    // O toque manual sai com o texto do passo da regua da Dra. A.
    resetFakeProvider();
    const worker = `teste-regua-vinc-cobrar-${sufixo}`;
    const job = await reivindicarJobDaRun(runA!.id, worker);
    expect(await executarJobComPosse(admin, worker, job)).toBe("concluido");
    const enviadas = fakeSentMessages().filter(
      (m) => m.to === pacienteA.telefone,
    );
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]?.body).toContain("Toque da régua Dra. A");
  });

  it("sem régua vigente (tudo desligado), cobra com a geral, como antes", async () => {
    const clinicId = await clinicaDeTeste("cobrar-desligada");
    const procedimentoId = await procedimento(clinicId, "Consulta");
    const a = await profissional(clinicId, "Dra. A", ["Dermatologia"]);
    const draA = {
      professionalId: a,
      serviceLinkId: await vinculo(clinicId, a, procedimentoId),
    };
    // A geral do seed nasce desligada; a vinculada tambem fica desligada.
    const geral = await ligarGeral(clinicId, "confirmacao");
    await ligar(geral, false);
    const daDraA = await reguaVinculada(clinicId, "confirmacao", "Dra. A", {
      professional_id: a,
    });
    await ligar(daDraA, false);
    const paciente = await contato(clinicId);
    const appointmentId = await consulta(clinicId, paciente.id, draA, 20 * 60);
    expect(await vigente(appointmentId, "confirmacao")).toBeNull();

    const resultado = await planejarCobrancaManual(admin, admin, {
      clinicId,
      timezone: "America/Fortaleza",
      appointmentIds: [appointmentId],
    });
    expect(resultado.enfileirados).toBe(1);
    const [run] = await runsDaConsulta(appointmentId);
    expect(run!.cadence_id).toBe(geral);
  });
});
