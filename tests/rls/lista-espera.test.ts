import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Tarefa 4.9, fase 1: RLS da lista de espera (migration 20260915100000).
// O que esta em jogo: a fila carrega nome e preferencia de paciente
// (isolamento entre clinicas e inegociavel); a matriz da a leitura "ver"
// sem escrever; e waitlist_offer nasce SO pelo motor (insert de sessao
// seria oferta forjada mandando mensagem em massa pela clinica).

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Espera!Rls2026";

let clinicaA = "";
let clinicaB = "";
let contatoA = "";
let profissionalA = "";
let consultaA = "";

const sessoes = {} as Record<
  "recepcaoA" | "leituraA" | "gestorB",
  SupabaseClient
>;

const email = (papel: string) => `espera-${papel}-${sufixo}@teste.dev`;

async function criarUsuario(
  chave: keyof typeof sessoes,
  clinicId: string,
  role: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email: email(chave),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: chave },
  });
  await admin.from("clinic_member").insert({
    clinic_id: clinicId,
    user_id: data.user!.id,
    role,
    status: "ativo",
  });
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(chave),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${chave}: ${error.message}`);
  }
  sessoes[chave] = cliente;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Espera A ${sufixo}`, slug: `esp-a-${sufixo}`, e_de_teste: true },
      { name: `Espera B ${sufixo}`, slug: `esp-b-${sufixo}`, e_de_teste: true },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `esp-a-${sufixo}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `esp-b-${sufixo}`)!.id as string;

  await Promise.all([
    criarUsuario("recepcaoA", clinicaA, "recepcao"),
    criarUsuario("leituraA", clinicaA, "leitura"),
    criarUsuario("gestorB", clinicaB, "gestor"),
  ]);

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+5584976${String(Date.now()).slice(-6)}`,
      name: "Paciente Espera",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoA = contato!.id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Espera" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicaA,
      name: "Consulta Espera",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicaA,
      professional_id: profissionalA,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 10000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const inicio = new Date(Date.now() + 3 * 24 * 60 * 60_000);
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      professional_id: profissionalA,
      service_link_id: vinculo!.id,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  consultaA = consulta!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    for (const usuario of usuarios) {
      if (usuario.email?.includes(`-${sufixo}@teste.dev`)) {
        await admin.auth.admin.deleteUser(usuario.id);
      }
    }
    if (usuarios.length < 200) {
      break;
    }
  }
});

describe("waitlist", () => {
  it("recepção adiciona à fila; entrada ativa repetida conflita", async () => {
    const { error } = await sessoes.recepcaoA.from("waitlist").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      professional_id: profissionalA,
      preferred_shifts: ["manha"],
      preferred_weekdays: [1, 3],
    });
    expect(error).toBeNull();

    const { error: duplicada } = await sessoes.recepcaoA
      .from("waitlist")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA,
        professional_id: profissionalA,
      });
    expect(duplicada?.code).toBe("23505");
  });

  it("leitura vê a fila e não escreve; a fila da A é invisível para a B", async () => {
    const { data: fila } = await sessoes.leituraA
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(fila).toHaveLength(1);

    const { error: erroEscrita } = await sessoes.leituraA
      .from("waitlist")
      .insert({ clinic_id: clinicaA, contact_id: contatoA });
    expect(erroEscrita?.code).toBe(RLS_VIOLATION);

    const { data: alheia, error } = await sessoes.gestorB
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(alheia).toHaveLength(0);
    // Contraprova anti falso-positivo.
    const { data: prova } = await admin
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(prova).toHaveLength(1);
  });

  it("delete não existe nem para quem escreve: sair da fila é active=false", async () => {
    const { data: antes } = await admin
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA);
    const { error } = await sessoes.recepcaoA
      .from("waitlist")
      .delete()
      .eq("clinic_id", clinicaA);
    // Sem policy de delete o PostgREST afeta zero linhas sem erro.
    expect(error).toBeNull();
    const { data: depois } = await admin
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(depois).toHaveLength(antes!.length);
  });
});

describe("waitlist_offer", () => {
  it("nenhuma sessão INSERE oferta (nasce só pelo motor); membro lê", async () => {
    const { error } = await sessoes.recepcaoA.from("waitlist_offer").insert({
      clinic_id: clinicaA,
      source_appointment_id: consultaA,
      professional_id: profissionalA,
      slot_starts_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      slot_ends_at: new Date(Date.now() + 90 * 60_000).toISOString(),
      offered_to: [contatoA],
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    // O motor (service role) cria; o membro le; a clinica B nao ve.
    await admin
      .from("waitlist_offer")
      .insert({
        clinic_id: clinicaA,
        source_appointment_id: consultaA,
        professional_id: profissionalA,
        slot_starts_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        slot_ends_at: new Date(Date.now() + 90 * 60_000).toISOString(),
        offered_to: [contatoA],
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      })
      .throwOnError();
    const { data: minhas } = await sessoes.leituraA
      .from("waitlist_offer")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(minhas).toHaveLength(1);
    const { data: alheias } = await sessoes.gestorB
      .from("waitlist_offer")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(alheias).toHaveLength(0);
  });

  it("quem escreve cancela a reoferta; leitura não", async () => {
    const { data: cancelada, error } = await sessoes.recepcaoA
      .from("waitlist_offer")
      .update({ status: "cancelada" })
      .eq("clinic_id", clinicaA)
      .eq("status", "aberta")
      .select("id");
    expect(error).toBeNull();
    expect(cancelada).toHaveLength(1);

    const { error: erroLeitura } = await sessoes.leituraA
      .from("waitlist_offer")
      .update({ status: "aberta" })
      .eq("clinic_id", clinicaA);
    expect(erroLeitura).toBeNull(); // zero linhas, sem erro
    const { data: prova } = await admin
      .from("waitlist_offer")
      .select("status")
      .eq("clinic_id", clinicaA)
      .single();
    expect(prova!.status).toBe("cancelada");
  });
});
