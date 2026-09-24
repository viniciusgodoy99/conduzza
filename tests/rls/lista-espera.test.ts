import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Tarefa 4.9, fase 1: RLS da lista de espera (migration 20260915100000).
// O que esta em jogo: a fila carrega nome e preferencia de paciente
// (isolamento entre clinicas e inegociavel); a matriz da "ver" a leitura E
// ao profissional, sem escrever (migration 20260924104000: as policies
// usavam user_can_write, que inclui profissional); e waitlist_offer nasce SO
// pelo motor (insert de sessao seria oferta forjada mandando mensagem em
// massa pela clinica). A sessao so leva oferta ABERTA para CANCELADA, e so
// mexe na coluna status.

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
  "recepcaoA" | "leituraA" | "profissionalA" | "gestorB",
  SupabaseClient
>;

const HORA = 60 * 60_000;

/** Oferta ABERTA criada pelo motor (service role), num horario proprio. */
async function ofertaAbertaDoMotor(horasAFrente: number): Promise<string> {
  const inicio = Date.now() + horasAFrente * HORA;
  const { data } = await admin
    .from("waitlist_offer")
    .insert({
      clinic_id: clinicaA,
      source_appointment_id: consultaA,
      professional_id: profissionalA,
      slot_starts_at: new Date(inicio).toISOString(),
      slot_ends_at: new Date(inicio + HORA / 2).toISOString(),
      offered_to: [contatoA],
      expires_at: new Date(Date.now() + HORA / 2).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

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
    criarUsuario("profissionalA", clinicaA, "profissional"),
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

  it("profissional vê a fila e não escreve nela (a matriz dá só ver)", async () => {
    const { data: fila } = await sessoes.profissionalA
      .from("waitlist")
      .select("id, preferred_shifts")
      .eq("clinic_id", clinicaA);
    expect(fila).toHaveLength(1);

    const { error: erroInsert } = await sessoes.profissionalA
      .from("waitlist")
      .insert({ clinic_id: clinicaA, contact_id: contatoA });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    // UPDATE sem policy que o deixe passar: zero linhas, sem erro.
    const { data: editadas, error: erroUpdate } = await sessoes.profissionalA
      .from("waitlist")
      .update({ preferred_shifts: ["noite"], active: false })
      .eq("clinic_id", clinicaA)
      .select("id");
    expect(erroUpdate).toBeNull();
    expect(editadas ?? []).toHaveLength(0);
    const { data: prova } = await admin
      .from("waitlist")
      .select("preferred_shifts, active")
      .eq("clinic_id", clinicaA)
      .single();
    expect(prova!.active).toBe(true);
    expect(prova!.preferred_shifts).toEqual(["manha"]);
  });

  it("leitura também não edita a fila", async () => {
    const { data: editadas, error } = await sessoes.leituraA
      .from("waitlist")
      .update({ active: false })
      .eq("clinic_id", clinicaA)
      .select("id");
    expect(error).toBeNull();
    expect(editadas ?? []).toHaveLength(0);
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

describe("mover_na_lista_de_espera (RPC de reordenar)", () => {
  it("recepção reordena; leitura enxerga zero linhas e recebe recusa educada", async () => {
    // Segunda entrada no mesmo grupo para haver o que reordenar.
    const { data: contato2 } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicaA,
        phone_e164: `+5584977${String(Date.now()).slice(-6)}`,
        name: "Paciente Espera 2",
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("waitlist")
      .insert({
        clinic_id: clinicaA,
        contact_id: contato2!.id,
        professional_id: profissionalA,
      })
      .throwOnError();
    const { data: fila } = await admin
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("active", true)
      .order("priority")
      .order("created_at");
    const ultima = fila![fila!.length - 1]!.id as string;

    const { error } = await sessoes.recepcaoA.rpc("mover_na_lista_de_espera", {
      p_clinic_id: clinicaA,
      p_id: ultima,
      p_nova_posicao: 1,
    });
    expect(error).toBeNull();
    const { data: depois } = await admin
      .from("waitlist")
      .select("id, priority")
      .eq("clinic_id", clinicaA)
      .eq("active", true)
      .order("priority");
    expect(depois![0]!.id).toBe(ultima);
    // Renumeracao canonica, sem empate.
    const prioridades = depois!.map((linha) => linha.priority);
    expect(new Set(prioridades).size).toBe(prioridades.length);

    const { error: erroLeitura } = await sessoes.leituraA.rpc(
      "mover_na_lista_de_espera",
      { p_clinic_id: clinicaA, p_id: ultima, p_nova_posicao: 2 },
    );
    expect(erroLeitura?.message).toContain("Entrada não encontrada");

    // A RPC e SECURITY INVOKER: o recorte da policy de UPDATE (sem
    // profissional) vale para ela tambem.
    const { error: erroProfissional } = await sessoes.profissionalA.rpc(
      "mover_na_lista_de_espera",
      { p_clinic_id: clinicaA, p_id: ultima, p_nova_posicao: 2 },
    );
    expect(erroProfissional?.message).toContain("Entrada não encontrada");
    const { data: intacta } = await admin
      .from("waitlist")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("active", true)
      .order("priority")
      .limit(1)
      .single();
    expect(intacta!.id).toBe(ultima);
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

  it("profissional e leitura não cancelam; a recepção cancela a reoferta aberta", async () => {
    for (const sessao of [sessoes.profissionalA, sessoes.leituraA]) {
      const { data: nada, error } = await sessao
        .from("waitlist_offer")
        .update({ status: "cancelada" })
        .eq("clinic_id", clinicaA)
        .eq("status", "aberta")
        .select("id");
      expect(error).toBeNull(); // zero linhas, sem erro
      expect(nada ?? []).toHaveLength(0);
    }
    const { data: aindaAberta } = await admin
      .from("waitlist_offer")
      .select("status")
      .eq("clinic_id", clinicaA)
      .single();
    expect(aindaAberta!.status).toBe("aberta");

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

  it("nem a recepção reabre, preenche ou mexe em outra coluna da oferta", async () => {
    // Reabrir: o USING exige oferta aberta, entao a cancelada nem aparece.
    const { data: reaberta, error: erroReabrir } = await sessoes.recepcaoA
      .from("waitlist_offer")
      .update({ status: "aberta" })
      .eq("clinic_id", clinicaA)
      .eq("status", "cancelada")
      .select("id");
    expect(erroReabrir).toBeNull();
    expect(reaberta ?? []).toHaveLength(0);

    const ofertaId = await ofertaAbertaDoMotor(10);

    // Aberta para preenchida: o WITH CHECK so aceita cancelada.
    const { error: erroPreencher } = await sessoes.recepcaoA
      .from("waitlist_offer")
      .update({ status: "preenchida" })
      .eq("id", ofertaId);
    expect(erroPreencher?.code).toBe(RLS_VIOLATION);

    // Outra coluna, sozinha ou junto do cancelamento: sem privilegio de
    // coluna (so status e gravavel pela sessao).
    const { error: erroPrazo } = await sessoes.recepcaoA
      .from("waitlist_offer")
      .update({ expires_at: new Date(Date.now() + 48 * HORA).toISOString() })
      .eq("id", ofertaId);
    expect(erroPrazo?.code).toBe(RLS_VIOLATION);
    const { error: erroJunto } = await sessoes.recepcaoA
      .from("waitlist_offer")
      .update({ status: "cancelada", offered_to: [] })
      .eq("id", ofertaId);
    expect(erroJunto?.code).toBe(RLS_VIOLATION);

    const { data: prova } = await admin
      .from("waitlist_offer")
      .select("status, offered_to")
      .eq("id", ofertaId)
      .single();
    expect(prova!.status).toBe("aberta");
    expect(prova!.offered_to).toEqual([contatoA]);

    // Higiene para os proximos cenarios.
    await admin
      .from("waitlist_offer")
      .update({ status: "cancelada" })
      .eq("id", ofertaId)
      .throwOnError();
  });
});

describe("cancelar_reoferta_de_espera (botão Cancelar reoferta)", () => {
  it("recepção cancela a oferta e as mensagens da onda que ainda estavam na fila", async () => {
    const ofertaId = await ofertaAbertaDoMotor(20);
    const { data: envio } = await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicaA,
        kind: "enviar_mensagem_ativa",
        // Um dia a frente: o motor nunca chega a pegar este envio de teste.
        run_at: new Date(Date.now() + 24 * HORA).toISOString(),
        payload: {
          contact_id: contatoA,
          body: "Oferta de teste",
          offer_id: ofertaId,
        },
      })
      .select("id")
      .single()
      .throwOnError();

    const { data: cancelou, error } = await sessoes.recepcaoA.rpc(
      "cancelar_reoferta_de_espera",
      { p_clinic_id: clinicaA, p_offer_id: ofertaId },
    );
    expect(error).toBeNull();
    expect(cancelou).toBe(true);

    const { data: oferta } = await admin
      .from("waitlist_offer")
      .select("status")
      .eq("id", ofertaId)
      .single();
    expect(oferta!.status).toBe("cancelada");
    const { data: job } = await admin
      .from("job_queue")
      .select("status, last_error")
      .eq("id", envio!.id as string)
      .single();
    expect(job!.status).toBe("cancelado");
    expect(job!.last_error).toBe("oferta_encerrada");

    // Segunda vez: ja encerrada, resposta honesta sem erro.
    const { data: deNovo, error: erroDeNovo } = await sessoes.recepcaoA.rpc(
      "cancelar_reoferta_de_espera",
      { p_clinic_id: clinicaA, p_offer_id: ofertaId },
    );
    expect(erroDeNovo).toBeNull();
    expect(deNovo).toBe(false);
  });

  it("profissional, leitura e a outra clínica recebem recusa de permissão", async () => {
    const ofertaId = await ofertaAbertaDoMotor(30);
    for (const sessao of [
      sessoes.profissionalA,
      sessoes.leituraA,
      sessoes.gestorB,
    ]) {
      const { error } = await sessao.rpc("cancelar_reoferta_de_espera", {
        p_clinic_id: clinicaA,
        p_offer_id: ofertaId,
      });
      expect(error?.code).toBe(RLS_VIOLATION);
    }
    // Gestor da B passando a PROPRIA clinica com a oferta da A: o update
    // recorta por clinic_id e nada acontece.
    const { data: alheia, error: erroAlheia } = await sessoes.gestorB.rpc(
      "cancelar_reoferta_de_espera",
      { p_clinic_id: clinicaB, p_offer_id: ofertaId },
    );
    expect(erroAlheia).toBeNull();
    expect(alheia).toBe(false);

    const { data: prova } = await admin
      .from("waitlist_offer")
      .select("status")
      .eq("id", ofertaId)
      .single();
    expect(prova!.status).toBe("aberta");
    await admin
      .from("waitlist_offer")
      .update({ status: "cancelada" })
      .eq("id", ofertaId)
      .throwOnError();
  });
});
