import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Fase 2, tarefa 2.3: RLS da agenda.
// A regra fina da matriz de papeis: 'profissional' ve e mexe SO na propria
// agenda (elo: clinic_member.professional_id). O recorte vive NA POLICY,
// porque o Realtime entrega eventos por assinante aplicando RLS.

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Agenda!Rls2026";

let clinicaA = "";
let clinicaB = "";
let profJoao = "";
let profAna = "";
let vinculoJoao = "";
let vinculoAna = "";
let contato = "";
let consultaJoao = "";
let consultaAna = "";

async function logado(email: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Agenda A ${sufixo}`, slug: `agr-a-${sufixo}` },
      { name: `Agenda B ${sufixo}`, slug: `agr-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("agr-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("agr-b"))!.id as string;

  const { data: profs } = await admin
    .from("professional")
    .insert([
      { clinic_id: clinicaA, name: "Dr. João RLS" },
      { clinic_id: clinicaA, name: "Dra. Ana RLS" },
    ])
    .select("id, name")
    .throwOnError();
  profJoao = profs!.find((p) => p.name.includes("João"))!.id as string;
  profAna = profs!.find((p) => p.name.includes("Ana"))!.id as string;

  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicaA, name: "Consulta RLS" })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculos } = await admin
    .from("service_link")
    .insert([
      {
        clinic_id: clinicaA,
        professional_id: profJoao,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      },
      {
        clinic_id: clinicaA,
        professional_id: profAna,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      },
    ])
    .select("id, professional_id")
    .throwOnError();
  vinculoJoao = vinculos!.find((v) => v.professional_id === profJoao)!
    .id as string;
  vinculoAna = vinculos!.find((v) => v.professional_id === profAna)!
    .id as string;

  const { data: ct } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+55847${sufixo.replace(/\D/g, "9").slice(0, 7).padStart(7, "9")}`,
      name: "Paciente RLS Agenda",
    })
    .select("id")
    .single()
    .throwOnError();
  contato = ct!.id as string;

  // Usuarios: Dr. Joao (papel profissional, vinculado ao professional Joao),
  // recepcao da clinica A, e admin da clinica B.
  const usuarios: [string, string, string, string | null][] = [
    [`agr-joao-${sufixo}@teste.dev`, clinicaA, "profissional", profJoao],
    [`agr-recep-${sufixo}@teste.dev`, clinicaA, "recepcao", null],
    [`agr-outra-${sufixo}@teste.dev`, clinicaB, "admin", null],
  ];
  for (const [email, clinicId, role, professionalId] of usuarios) {
    const { data } = await admin.auth.admin.createUser({
      email,
      password: SENHA,
      email_confirm: true,
      user_metadata: { name: email.split("@")[0] },
    });
    await admin.from("clinic_member").insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
      professional_id: professionalId,
    });
  }

  const { data: consultas } = await admin
    .from("appointment")
    .insert([
      {
        clinic_id: clinicaA,
        contact_id: contato,
        professional_id: profJoao,
        service_link_id: vinculoJoao,
        starts_at: "2026-10-06T12:00:00Z",
        ends_at: "2026-10-06T12:30:00Z",
      },
      {
        clinic_id: clinicaA,
        contact_id: contato,
        professional_id: profAna,
        service_link_id: vinculoAna,
        starts_at: "2026-10-06T12:00:00Z",
        ends_at: "2026-10-06T12:30:00Z",
      },
    ])
    .select("id, professional_id")
    .throwOnError();
  consultaJoao = consultas!.find((c) => c.professional_id === profJoao)!
    .id as string;
  consultaAna = consultas!.find((c) => c.professional_id === profAna)!
    .id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("agr-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("papel profissional: só a própria agenda", () => {
  it("Dr. João vê a própria consulta e NÃO vê a da Dra. Ana (que existe)", async () => {
    const joao = await logado(`agr-joao-${sufixo}@teste.dev`);
    const { data: minhas } = await joao
      .from("appointment")
      .select("id, professional_id")
      .eq("clinic_id", clinicaA);
    expect(minhas).toHaveLength(1);
    expect(minhas?.[0]?.professional_id).toBe(profJoao);

    // Anti falso-positivo: a consulta da Ana existe.
    const { data: todas } = await admin
      .from("appointment")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(todas!.length).toBeGreaterThanOrEqual(2);
  });

  it("Dr. João não cria consulta para a Dra. Ana", async () => {
    const joao = await logado(`agr-joao-${sufixo}@teste.dev`);
    const { error } = await joao.from("appointment").insert({
      clinic_id: clinicaA,
      contact_id: contato,
      professional_id: profAna,
      service_link_id: vinculoAna,
      starts_at: "2026-10-06T15:00:00Z",
      ends_at: "2026-10-06T15:30:00Z",
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("Dr. João não muda o status da consulta da Dra. Ana", async () => {
    const joao = await logado(`agr-joao-${sufixo}@teste.dev`);
    const { data } = await joao
      .from("appointment")
      .update({ status: "cancelado_clinica" })
      .eq("id", consultaAna)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    const { data: intacta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", consultaAna)
      .single();
    expect(intacta?.status).toBe("agendado");
  });

  it("o histórico segue o recorte: João só lê o da própria consulta", async () => {
    const joao = await logado(`agr-joao-${sufixo}@teste.dev`);
    const { data: historico } = await joao
      .from("appointment_status_history")
      .select("appointment_id")
      .eq("clinic_id", clinicaA);
    expect(historico?.every((h) => h.appointment_id === consultaJoao)).toBe(
      true,
    );
    expect(historico!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("recepção e isolamento entre clínicas", () => {
  it("recepção vê e escreve a agenda inteira da clínica", async () => {
    const recepcao = await logado(`agr-recep-${sufixo}@teste.dev`);
    const { data: todas } = await recepcao
      .from("appointment")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(todas!.length).toBeGreaterThanOrEqual(2);

    const { error } = await recepcao.from("appointment").insert({
      clinic_id: clinicaA,
      contact_id: contato,
      professional_id: profJoao,
      service_link_id: vinculoJoao,
      starts_at: "2026-10-06T16:00:00Z",
      ends_at: "2026-10-06T16:30:00Z",
    });
    expect(error).toBeNull();
  });

  it("membro de outra clínica não vê agenda nem holds (que existem)", async () => {
    await admin
      .from("slot_hold")
      .insert({
        clinic_id: clinicaA,
        professional_id: profJoao,
        contact_id: contato,
        starts_at: "2026-10-06T17:00:00Z",
        ends_at: "2026-10-06T17:30:00Z",
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      .throwOnError();

    const outra = await logado(`agr-outra-${sufixo}@teste.dev`);
    const [{ data: consultas }, { data: holds }] = await Promise.all([
      outra.from("appointment").select("id").eq("clinic_id", clinicaA),
      outra.from("slot_hold").select("id").eq("clinic_id", clinicaA),
    ]);
    expect(consultas).toHaveLength(0);
    expect(holds).toHaveLength(0);
  });
});
