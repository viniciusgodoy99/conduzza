import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Remarcacao pelo banco (migration 20260924105000, achados 78, 79 e 84):
// - remarcar consulta confirmada devolve para 'agendado' (a confirmacao
//   valia para o horario antigo) e limpa canal e autor da confirmacao;
// - a remarcacao entra na trilha da consulta (kind 'remarcacao', com o antes,
//   o depois, quem e quando), gravada SO pelo gatilho: a sessao nao forja;
// - os toques pendentes do horario antigo sao pulados;
// - consulta com situacao final nao se move;
// - a linha do historico nao atravessa clinica.
// Migration 20260924130000 (achados R4 e R19):
// - Na recepcao e Em atendimento movidas para OUTRO DIA voltam para
//   'agendado'; no mesmo dia ficam como estao;
// - a sessao so grava linha de status como equipe (changed_by 'usuario'),
//   sem evento, e com a hora do banco (changed_at forjado e sobrescrito).

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Remarca!Rls2026";
const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";

let clinicaA = "";
let clinicaB = "";
let profA = "";
let profB = "";
let vinculoA = "";
let vinculoB = "";
let contato = "";
let recepcaoId = "";

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

async function novaConsulta(
  inicio: Date,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicaA,
      contact_id: contato,
      professional_id: profA,
      service_link_id: vinculoA,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

function emDias(dias: number, hora = 13): Date {
  const d = new Date(Date.now() + dias * 86_400_000);
  d.setUTCHours(hora, 0, 0, 0);
  return d;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Remarca A ${sufixo}`, slug: `rem-a-${sufixo}` },
      { name: `Remarca B ${sufixo}`, slug: `rem-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("rem-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("rem-b"))!.id as string;

  const { data: profs } = await admin
    .from("professional")
    .insert([
      { clinic_id: clinicaA, name: "Dr. Remarca A" },
      { clinic_id: clinicaA, name: "Dra. Remarca B" },
    ])
    .select("id, name")
    .throwOnError();
  profA = profs!.find((p) => p.name.endsWith("A"))!.id as string;
  profB = profs!.find((p) => p.name.endsWith("B"))!.id as string;

  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicaA, name: "Consulta Remarca" })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculos } = await admin
    .from("service_link")
    .insert([
      {
        clinic_id: clinicaA,
        professional_id: profA,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      },
      {
        clinic_id: clinicaA,
        professional_id: profB,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      },
    ])
    .select("id, professional_id")
    .throwOnError();
  vinculoA = vinculos!.find((v) => v.professional_id === profA)!.id as string;
  vinculoB = vinculos!.find((v) => v.professional_id === profB)!.id as string;

  const { data: ct } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: `+55849${sufixo.replace(/\D/g, "7").slice(0, 7).padStart(7, "7")}`,
      name: "Paciente Remarca",
    })
    .select("id")
    .single()
    .throwOnError();
  contato = ct!.id as string;

  const usuarios: [string, string, string][] = [
    [`rem-recep-${sufixo}@teste.dev`, clinicaA, "recepcao"],
    [`rem-outra-${sufixo}@teste.dev`, clinicaB, "admin"],
  ];
  for (const [email, clinicId, role] of usuarios) {
    const { data } = await admin.auth.admin.createUser({
      email,
      password: SENHA,
      email_confirm: true,
      user_metadata: { name: email.split("@")[0] },
    });
    if (role === "recepcao") {
      recepcaoId = data.user!.id;
    }
    await admin.from("clinic_member").insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
    });
  }
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("rem-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("remarcar pela sessão da recepção", () => {
  it("consulta confirmada volta para agendado e a trilha registra o antes e o depois", async () => {
    const inicio = emDias(5);
    const consulta = await novaConsulta(inicio, {
      status: "confirmado_recepcao",
      confirmation_channel: "telefone",
      confirmed_by_user_id: recepcaoId,
    });

    // Toque pendente do horario antigo
    const { data: passo } = await admin
      .from("cadence_step")
      .select("id, cadence!inner(clinic_id, kind)")
      .eq("cadence.clinic_id", clinicaA)
      .eq("cadence.kind", "confirmacao")
      .limit(1)
      .single()
      .throwOnError();
    const { data: run } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicaA,
        cadence_step_id: passo!.id,
        contact_id: contato,
        appointment_id: consulta,
        scheduled_for: new Date(inicio.getTime() - 86_400_000).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();

    const novoInicio = emDias(6);
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const { data, error } = await recepcao
      .from("appointment")
      .update({
        starts_at: novoInicio.toISOString(),
        ends_at: new Date(novoInicio.getTime() + 30 * 60_000).toISOString(),
        professional_id: profB,
        service_link_id: vinculoB,
      })
      .eq("id", consulta)
      .select("status, confirmation_channel, confirmed_by_user_id");
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe("agendado");
    expect(data?.[0]?.confirmation_channel).toBeNull();
    expect(data?.[0]?.confirmed_by_user_id).toBeNull();

    const { data: trilha } = await recepcao
      .from("appointment_status_history")
      .select(
        "kind, status, changed_by, changed_by_user_id, previous_starts_at, new_starts_at, previous_professional_id, new_professional_id",
      )
      .eq("appointment_id", consulta)
      .eq("kind", "remarcacao");
    expect(trilha).toHaveLength(1);
    const linha = trilha![0]!;
    expect(linha.status).toBe("agendado");
    expect(linha.changed_by).toBe("usuario");
    expect(linha.changed_by_user_id).toBe(recepcaoId);
    expect(new Date(linha.previous_starts_at as string).getTime()).toBe(
      inicio.getTime(),
    );
    expect(new Date(linha.new_starts_at as string).getTime()).toBe(
      novoInicio.getTime(),
    );
    expect(linha.previous_professional_id).toBe(profA);
    expect(linha.new_professional_id).toBe(profB);

    const { data: runDepois } = await admin
      .from("cadence_run")
      .select("skipped_reason, sent_at")
      .eq("id", run!.id)
      .single()
      .throwOnError();
    expect(runDepois!.sent_at).toBeNull();
    expect(runDepois!.skipped_reason).toBe("consulta_remarcada");
  });

  it("mudar só a situação não gera linha de remarcação", async () => {
    const consulta = await novaConsulta(emDias(7));
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    await recepcao
      .from("appointment")
      .update({ status: "aguardando_confirmacao" })
      .eq("id", consulta)
      .throwOnError();
    const { data: trilha } = await admin
      .from("appointment_status_history")
      .select("id")
      .eq("appointment_id", consulta)
      .eq("kind", "remarcacao");
    expect(trilha).toHaveLength(0);
  });

  it("consulta com Faltou não se move", async () => {
    const passada = new Date(Date.now() - 4 * 3600_000);
    const consulta = await novaConsulta(passada, { status: "faltou" });
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const novoInicio = emDias(8);
    const { error } = await recepcao
      .from("appointment")
      .update({
        starts_at: novoInicio.toISOString(),
        ends_at: new Date(novoInicio.getTime() + 30 * 60_000).toISOString(),
      })
      .eq("id", consulta)
      .select("id");
    expect(error?.code).toBe(CHECK_VIOLATION);

    const { data: intacta } = await admin
      .from("appointment")
      .select("starts_at, status")
      .eq("id", consulta)
      .single()
      .throwOnError();
    expect(new Date(intacta!.starts_at as string).getTime()).toBe(
      passada.getTime(),
    );
    expect(intacta!.status).toBe("faltou");
  });

  it("paciente que já chegou, movido para outro dia, volta para agendado", async () => {
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const casos: [number, "na_recepcao" | "em_atendimento"][] = [
      [11, "na_recepcao"],
      [12, "em_atendimento"],
    ];
    for (const [dias, status] of casos) {
      const consulta = await novaConsulta(emDias(dias), {
        status,
        confirmation_channel: "telefone",
        confirmed_by_user_id: recepcaoId,
      });
      // Tres dias depois, no mesmo horario: outro dia civil em Fortaleza.
      const novoInicio = emDias(dias + 3);
      const { data, error } = await recepcao
        .from("appointment")
        .update({
          starts_at: novoInicio.toISOString(),
          ends_at: new Date(novoInicio.getTime() + 30 * 60_000).toISOString(),
        })
        .eq("id", consulta)
        .select("status, confirmation_channel, confirmed_by_user_id");
      expect(error).toBeNull();
      expect(data?.[0]?.status).toBe("agendado");
      expect(data?.[0]?.confirmation_channel).toBeNull();
      expect(data?.[0]?.confirmed_by_user_id).toBeNull();
    }
  });

  it("paciente que já chegou, movido no mesmo dia, mantém a situação", async () => {
    // 13:00 UTC e 15:00 UTC: 10:00 e 12:00 em Fortaleza, o mesmo dia civil
    // no fuso padrao da clinica de teste.
    const inicio = emDias(16, 13);
    const consulta = await novaConsulta(inicio, { status: "na_recepcao" });
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const novoInicio = emDias(16, 15);
    const { data, error } = await recepcao
      .from("appointment")
      .update({
        starts_at: novoInicio.toISOString(),
        ends_at: new Date(novoInicio.getTime() + 30 * 60_000).toISOString(),
      })
      .eq("id", consulta)
      .select("status");
    expect(error).toBeNull();
    expect(data?.[0]?.status).toBe("na_recepcao");
  });
});

describe("a trilha não se forja", () => {
  it("a sessão não grava linha de remarcação", async () => {
    const consulta = await novaConsulta(emDias(9));
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const { error } = await recepcao.from("appointment_status_history").insert({
      clinic_id: clinicaA,
      appointment_id: consulta,
      status: "agendado",
      changed_by: "usuario",
      changed_by_user_id: recepcaoId,
      kind: "remarcacao",
      previous_starts_at: emDias(1).toISOString(),
      new_starts_at: emDias(9).toISOString(),
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("a sessão grava linha de status só na clínica da consulta", async () => {
    const consulta = await novaConsulta(emDias(10));
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const { error: outraClinica } = await recepcao
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaB,
        appointment_id: consulta,
        status: "agendado",
        changed_by: "usuario",
        changed_by_user_id: recepcaoId,
      });
    expect(outraClinica?.code).toBe(RLS_VIOLATION);

    const { error: mesmaClinica } = await recepcao
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaA,
        appointment_id: consulta,
        status: "agendado",
        changed_by: "usuario",
        changed_by_user_id: recepcaoId,
      });
    expect(mesmaClinica).toBeNull();
  });

  it("a sessão não grava linha em nome do paciente, do sistema nem o pedido de remarcação", async () => {
    const consulta = await novaConsulta(emDias(17));
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const tentativas: Record<string, unknown>[] = [
      { status: "cancelado_paciente", changed_by: "paciente" },
      { status: "agendado", changed_by: "sistema" },
      { status: "agendado", changed_by: "ia" },
      {
        status: "agendado",
        changed_by: "usuario",
        event: "remarcacao_pedida",
      },
      {
        status: "agendado",
        changed_by: "paciente",
        event: "remarcacao_pedida",
      },
    ];
    for (const tentativa of tentativas) {
      const { error } = await recepcao
        .from("appointment_status_history")
        .insert({
          clinic_id: clinicaA,
          appointment_id: consulta,
          changed_by_user_id: recepcaoId,
          ...tentativa,
        });
      expect(error?.code).toBe(RLS_VIOLATION);
    }
    // Nada entrou: a unica linha e a inicial do gatilho do INSERT (created_by
    // padrao 'usuario', sem evento).
    const { data: gravadas } = await admin
      .from("appointment_status_history")
      .select("changed_by, event")
      .eq("appointment_id", consulta)
      .throwOnError();
    expect(gravadas).toHaveLength(1);
    expect(gravadas![0]!.changed_by).toBe("usuario");
    expect(gravadas![0]!.event).toBeNull();
  });

  it("a hora da linha gravada pela sessão é a do banco", async () => {
    const consulta = await novaConsulta(emDias(18));
    const recepcao = await logado(`rem-recep-${sufixo}@teste.dev`);
    const forjada = new Date(Date.now() - 20 * 86_400_000);
    const { data, error } = await recepcao
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaA,
        appointment_id: consulta,
        status: "agendado",
        changed_by: "usuario",
        changed_by_user_id: recepcaoId,
        changed_at: forjada.toISOString(),
      })
      .select("changed_at")
      .single();
    expect(error).toBeNull();
    const gravada = new Date(data!.changed_at as string).getTime();
    // Folga para relogio da maquina de teste diferente do banco.
    expect(Math.abs(gravada - Date.now())).toBeLessThan(10 * 60_000);
    expect(gravada).toBeGreaterThan(forjada.getTime() + 19 * 86_400_000);
  });

  it("sem sessão (sistema) a hora informada continua valendo", async () => {
    const consulta = await novaConsulta(emDias(19));
    const passada = new Date(Date.now() - 3 * 86_400_000);
    passada.setUTCMilliseconds(0);
    const { data } = await admin
      .from("appointment_status_history")
      .insert({
        clinic_id: clinicaA,
        appointment_id: consulta,
        status: "agendado",
        changed_by: "sistema",
        changed_at: passada.toISOString(),
      })
      .select("changed_at")
      .single()
      .throwOnError();
    expect(new Date(data!.changed_at as string).getTime()).toBe(
      passada.getTime(),
    );
  });

  it("membro de outra clínica não lê a trilha de remarcação (que existe)", async () => {
    const { data: existe } = await admin
      .from("appointment_status_history")
      .select("id")
      .eq("clinic_id", clinicaA)
      .eq("kind", "remarcacao");
    expect((existe ?? []).length).toBeGreaterThan(0);

    const outra = await logado(`rem-outra-${sufixo}@teste.dev`);
    const { data } = await outra
      .from("appointment_status_history")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(data ?? []).toHaveLength(0);
  });
});
