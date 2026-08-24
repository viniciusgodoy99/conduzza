import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient } from "../rls/stack";

// Fase 2, tarefa 2.3. ACEITE OBRIGATORIO do backlog: "teste de concorrencia:
// duas insercoes simultaneas no mesmo slot, uma passa e a outra falha com
// erro de constraint. Sem esse teste a tarefa nao esta pronta."
//
// O codigo do Postgres para exclusion constraint e 23P01. O supabase-js NAO
// rejeita a promise: Promise.allSettled devolve as duas fulfilled e o erro
// vem em result.value.error. O service role ignora RLS mas NAO ignora a
// exclusion, que e exatamente o ponto: a trava vale para todo mundo.

const EXCLUSION_VIOLATION = "23P01";

const admin = adminClient();
const sufixo = Date.now().toString(36);

let clinicId = "";
let profissionalA = "";
let profissionalB = "";
let vinculoA = "";
let vinculoB = "";
let contato = "";
let recurso = "";

function slot(horaInicio: string, horaFim: string) {
  return {
    starts_at: `2026-10-05T${horaInicio}:00-03:00`,
    ends_at: `2026-10-05T${horaFim}:00-03:00`,
  };
}

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({ name: `Agenda Conc ${sufixo}`, slug: `agc-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;

  const { data: profs } = await admin
    .from("professional")
    .insert([
      { clinic_id: clinicId, name: "Dr. Concorrente A" },
      { clinic_id: clinicId, name: "Dra. Concorrente B" },
    ])
    .select("id, name")
    .throwOnError();
  profissionalA = profs!.find((p) => p.name.endsWith("A"))!.id as string;
  profissionalB = profs!.find((p) => p.name.endsWith("B"))!.id as string;

  const { data: rec } = await admin
    .from("resource")
    .insert({ clinic_id: clinicId, name: "Laser 1", kind: "equipamento" })
    .select("id")
    .single()
    .throwOnError();
  recurso = rec!.id as string;

  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Consulta", default_duration_min: 30 })
    .select("id")
    .single()
    .throwOnError();

  const { data: vinculos } = await admin
    .from("service_link")
    .insert([
      {
        clinic_id: clinicId,
        professional_id: profissionalA,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 20000,
        covered_by_insurance: false,
        duration_min: 30,
      },
      {
        clinic_id: clinicId,
        professional_id: profissionalB,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 20000,
        covered_by_insurance: false,
        duration_min: 30,
      },
    ])
    .select("id, professional_id")
    .throwOnError();
  vinculoA = vinculos!.find((v) => v.professional_id === profissionalA)!
    .id as string;
  vinculoB = vinculos!.find((v) => v.professional_id === profissionalB)!
    .id as string;

  const { data: ct } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+55849${sufixo.slice(-7).padStart(7, "1")}`,
      name: "Paciente Concorrência",
    })
    .select("id")
    .single()
    .throwOnError();
  contato = ct!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
});

function consultaBase(horaInicio: string, horaFim: string) {
  return {
    clinic_id: clinicId,
    contact_id: contato,
    professional_id: profissionalA,
    service_link_id: vinculoA,
    ...slot(horaInicio, horaFim),
  };
}

describe("aceite 2.3: a trava de conflito de horário", () => {
  it("duas marcações SIMULTÂNEAS no mesmo slot: uma passa, a outra falha com 23P01", async () => {
    const [a, b] = await Promise.allSettled([
      admin.from("appointment").insert(consultaBase("09:00", "09:30")),
      admin.from("appointment").insert(consultaBase("09:00", "09:30")),
    ]);
    const resultados = [a, b].map((r) =>
      r.status === "fulfilled" ? r.value : null,
    );
    expect(resultados.every((r) => r !== null)).toBe(true);
    const erros = resultados.map((r) => r!.error);
    const sucessos = erros.filter((e) => e === null);
    const falhas = erros.filter((e) => e !== null);
    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]!.code).toBe(EXCLUSION_VIOLATION);

    // Anti falso-positivo: existe EXATAMENTE uma consulta no slot.
    const { count } = await admin
      .from("appointment")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("professional_id", profissionalA)
      .eq("starts_at", new Date("2026-10-05T12:00:00.000Z").toISOString());
    expect(count).toBe(1);
  });

  it("sobreposição parcial também colide", async () => {
    const { error } = await admin
      .from("appointment")
      .insert(consultaBase("09:15", "09:45"));
    expect(error?.code).toBe(EXCLUSION_VIOLATION);
  });

  it("slots adjacentes NÃO colidem (range semiaberto)", async () => {
    const { error } = await admin
      .from("appointment")
      .insert(consultaBase("09:30", "10:00"));
    expect(error).toBeNull();
  });

  it("cancelar LIBERA o horário para nova marcação", async () => {
    const { data: original } = await admin
      .from("appointment")
      .insert(consultaBase("11:00", "11:30"))
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("appointment")
      .update({ status: "cancelado_paciente" })
      .eq("id", original!.id)
      .throwOnError();
    const { error } = await admin
      .from("appointment")
      .insert(consultaBase("11:00", "11:30"));
    expect(error).toBeNull();
  });

  it("encaixe (is_overbooking) passa por cima do horário ocupado", async () => {
    const { error } = await admin
      .from("appointment")
      .insert({ ...consultaBase("09:00", "09:30"), is_overbooking: true });
    expect(error).toBeNull();
  });

  it("recurso compartilhado colide entre profissionais DIFERENTES", async () => {
    const { error: primeiro } = await admin.from("appointment").insert({
      clinic_id: clinicId,
      contact_id: contato,
      professional_id: profissionalA,
      service_link_id: vinculoA,
      resource_id: recurso,
      ...slot("14:00", "14:30"),
    });
    expect(primeiro).toBeNull();
    const { error: segundo } = await admin.from("appointment").insert({
      clinic_id: clinicId,
      contact_id: contato,
      professional_id: profissionalB,
      service_link_id: vinculoB,
      resource_id: recurso,
      ...slot("14:00", "14:30"),
    });
    expect(segundo?.code).toBe(EXCLUSION_VIOLATION);
  });
});

describe("gatilhos da agenda", () => {
  it("criar agendamento converte lead em paciente (e não rebaixa paciente)", async () => {
    const { data: lead } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: `+55848${sufixo.slice(-7).padStart(7, "2")}`,
        name: "Lead Que Agendou",
        kind: "lead",
      })
      .select("id, kind")
      .single()
      .throwOnError();
    expect(lead!.kind).toBe("lead");

    await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: lead!.id,
        professional_id: profissionalB,
        service_link_id: vinculoB,
        ...slot("15:00", "15:30"),
      })
      .throwOnError();

    const { data: depois } = await admin
      .from("contact")
      .select("kind")
      .eq("id", lead!.id)
      .single();
    expect(depois?.kind).toBe("paciente");
  });

  it("o INSERT grava a primeira linha do histórico com o autor", async () => {
    const { data: consulta } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contato,
        professional_id: profissionalB,
        service_link_id: vinculoB,
        created_by: "ia",
        is_overbooking: true,
        approval_status: "pendente",
        ...slot("16:00", "16:30"),
      })
      .select("id")
      .single()
      .throwOnError();

    const { data: historia } = await admin
      .from("appointment_status_history")
      .select("status, changed_by")
      .eq("appointment_id", consulta!.id);
    expect(historia).toHaveLength(1);
    expect(historia?.[0]).toMatchObject({
      status: "agendado",
      changed_by: "ia",
    });
  });
});

describe("holds", () => {
  it("limpar_holds_vencidos apaga só os vencidos", async () => {
    await admin
      .from("slot_hold")
      .insert([
        {
          clinic_id: clinicId,
          professional_id: profissionalA,
          contact_id: contato,
          ...slot("17:00", "17:30"),
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          clinic_id: clinicId,
          professional_id: profissionalA,
          contact_id: contato,
          ...slot("17:30", "18:00"),
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      ])
      .throwOnError();

    const { error } = await admin.rpc("limpar_holds_vencidos");
    expect(error).toBeNull();

    const { data: restantes } = await admin
      .from("slot_hold")
      .select("id, expires_at")
      .eq("clinic_id", clinicId);
    expect(restantes).toHaveLength(1);
    expect(
      new Date(restantes![0]!.expires_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });
});
