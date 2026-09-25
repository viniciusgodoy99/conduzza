import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Saldo de pacote na ficha (achado 71, migration 20260925102000):
// ajustar_saldo_de_pacote e cancelar_venda_de_pacote sao SECURITY INVOKER,
// entao quem manda e a RLS de package_balance e do historico
// package_balance_adjustment. Ajuste: admin, gestor e recepcao. Cancelamento:
// admin e gestor, e so de venda que nenhuma consulta descontou. O historico
// guarda o motivo, so a gestao le e ninguem reescreve. A clinica B nunca ve
// nem mexe no saldo da A.
// Padrao da suite: toda negacao tem o caso positivo ao lado (anti falso
// positivo), para o teste nao passar por um motivo errado.

const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const RLS_VIOLATION = "42501";
const NAO_ENCONTRADO = "P0002";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "SaldoPacote!Rls2026";

let clinicaA = "";
let clinicaB = "";
let adminAId = "";
let recepcaoAId = "";
let contatoA = "";
let pacoteA = "";
let saldoAjuste = "";
let saldoCancelavel = "";
let saldoDebitado = "";
let saldoB = "";
let primeiraConsulta = "";

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
): Promise<string> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
    })
    .throwOnError();
  return data.user!.id;
}

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

async function inserirId(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function venderSaldo(
  clinicId: string,
  contactId: string,
  packageId: string,
) {
  return inserirId("package_balance", {
    clinic_id: clinicId,
    contact_id: contactId,
    package_id: packageId,
    sessions_total: 10,
  });
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Saldo A ${sufixo}`, slug: `saldo-a-${sufixo}` },
      { name: `Saldo B ${sufixo}`, slug: `saldo-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("saldo-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("saldo-b"))!.id as string;

  adminAId = await criarUsuario(
    `saldo-admin-${sufixo}@teste.dev`,
    clinicaA,
    "admin",
  );
  recepcaoAId = await criarUsuario(
    `saldo-recepcao-${sufixo}@teste.dev`,
    clinicaA,
    "recepcao",
  );
  await criarUsuario(`saldo-leitura-${sufixo}@teste.dev`, clinicaA, "leitura");
  await criarUsuario(`saldo-outra-${sufixo}@teste.dev`, clinicaB, "admin");

  const procA = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Sessão A",
    default_duration_min: 30,
  });
  const procB = await inserirId("procedure", {
    clinic_id: clinicaB,
    name: "Sessão B",
    default_duration_min: 30,
  });
  const profA = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dra. Saldo",
  });
  const vinculoA = await inserirId("service_link", {
    clinic_id: clinicaA,
    professional_id: profA,
    procedure_id: procA,
    duration_min: 30,
  });
  contatoA = await inserirId("contact", {
    clinic_id: clinicaA,
    phone_e164: `+5585983${sufixo.replace(/\D/g, "0").slice(0, 6)}1`,
    name: "Paciente Saldo A",
  });
  const contatoB = await inserirId("contact", {
    clinic_id: clinicaB,
    phone_e164: `+5585983${sufixo.replace(/\D/g, "0").slice(0, 6)}2`,
    name: "Paciente Saldo B",
  });
  pacoteA = await inserirId("package", {
    clinic_id: clinicaA,
    procedure_id: procA,
    sessions: 10,
    price_cents: 100000,
  });
  const pacoteB = await inserirId("package", {
    clinic_id: clinicaB,
    procedure_id: procB,
    sessions: 10,
    price_cents: 100000,
  });

  saldoAjuste = await venderSaldo(clinicaA, contatoA, pacoteA);
  saldoCancelavel = await venderSaldo(clinicaA, contatoA, pacoteA);
  saldoDebitado = await venderSaldo(clinicaA, contatoA, pacoteA);
  saldoB = await venderSaldo(clinicaB, contatoB, pacoteB);

  // Consulta que descontou do saldoDebitado: a venda dele nao se cancela.
  primeiraConsulta = "2026-10-06T13:00:00.000Z";
  await inserirId("appointment", {
    clinic_id: clinicaA,
    contact_id: contatoA,
    professional_id: profA,
    service_link_id: vinculoA,
    starts_at: primeiraConsulta,
    ends_at: "2026-10-06T13:30:00.000Z",
    package_balance_id: saldoDebitado,
  });
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("saldo-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("ajuste de saldo de pacote", () => {
  it("recepção ajusta com motivo, e o histórico guarda o antes e o depois", async () => {
    const recepcao = await logado(`saldo-recepcao-${sufixo}@teste.dev`);
    const { error } = await recepcao.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoAjuste,
      p_sessions_used: 4,
      p_expires_at: "2026-12-31",
      p_reason: "Sessões feitas antes do sistema",
    });
    expect(error).toBeNull();

    const { data: saldo } = await admin
      .from("package_balance")
      .select("sessions_used, expires_at")
      .eq("id", saldoAjuste)
      .single()
      .throwOnError();
    expect(saldo).toEqual({ sessions_used: 4, expires_at: "2026-12-31" });

    const { data: historico } = await admin
      .from("package_balance_adjustment")
      .select(
        "kind, user_id, sessions_used_before, sessions_used_after, reason",
      )
      .eq("package_balance_id", saldoAjuste)
      .throwOnError();
    expect(historico).toEqual([
      {
        kind: "ajuste",
        user_id: recepcaoAId,
        sessions_used_before: 0,
        sessions_used_after: 4,
        reason: "Sessões feitas antes do sistema",
      },
    ]);
  });

  it("sem motivo, sem mudança ou acima do total, o banco recusa", async () => {
    const recepcao = await logado(`saldo-recepcao-${sufixo}@teste.dev`);
    const semMotivo = await recepcao.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoAjuste,
      p_sessions_used: 5,
      p_expires_at: "2026-12-31",
      p_reason: " ",
    });
    expect(semMotivo.error?.code).toBe(CHECK_VIOLATION);
    const acima = await recepcao.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoAjuste,
      p_sessions_used: 11,
      p_expires_at: "2026-12-31",
      p_reason: "Passou do total",
    });
    expect(acima.error?.code).toBe(CHECK_VIOLATION);
    const igual = await recepcao.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoAjuste,
      p_sessions_used: 4,
      p_expires_at: "2026-12-31",
      p_reason: "Nada mudou",
    });
    expect(igual.error?.code).toBe(CHECK_VIOLATION);
  });

  it("papel leitura não ajusta", async () => {
    const leitura = await logado(`saldo-leitura-${sufixo}@teste.dev`);
    const { error } = await leitura.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoAjuste,
      p_sessions_used: 6,
      p_expires_at: null,
      p_reason: "Leitura tentando",
    });
    expect(error?.code).toBe(NAO_ENCONTRADO);
    const { data } = await admin
      .from("package_balance")
      .select("sessions_used")
      .eq("id", saldoAjuste)
      .single()
      .throwOnError();
    expect(data?.sessions_used).toBe(4);
  });

  it("admin da B não ajusta nem lê o histórico da A", async () => {
    const outra = await logado(`saldo-outra-${sufixo}@teste.dev`);
    const { error } = await outra.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoAjuste,
      p_sessions_used: 1,
      p_expires_at: null,
      p_reason: "Tentativa de fora",
    });
    expect(error?.code).toBe(NAO_ENCONTRADO);
    const { data: daA } = await outra
      .from("package_balance_adjustment")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(daA).toEqual([]);

    // Anti falso positivo: a B ajusta o proprio saldo, e o admin da A le a
    // trilha da propria clinica.
    const proprio = await outra.rpc("ajustar_saldo_de_pacote", {
      p_balance_id: saldoB,
      p_sessions_used: 2,
      p_expires_at: null,
      p_reason: "Ajuste da própria clínica",
    });
    expect(proprio.error).toBeNull();
    const adminA = await logado(`saldo-admin-${sufixo}@teste.dev`);
    const { data: trilhaA } = await adminA
      .from("package_balance_adjustment")
      .select("id, clinic_id");
    expect((trilhaA ?? []).length).toBeGreaterThan(0);
    expect((trilhaA ?? []).every((linha) => linha.clinic_id === clinicaA)).toBe(
      true,
    );
  });

  it("a recepção não lê a trilha nem forja registro em nome de outra pessoa", async () => {
    const recepcao = await logado(`saldo-recepcao-${sufixo}@teste.dev`);
    const { data: leu } = await recepcao
      .from("package_balance_adjustment")
      .select("id");
    expect(leu).toEqual([]);

    const forjado = await recepcao.from("package_balance_adjustment").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacoteA,
      user_id: adminAId,
      kind: "ajuste",
      sessions_total: 10,
      sessions_used_before: 0,
      reason: "Em nome do admin",
    });
    expect(forjado.error?.code).toBe(RLS_VIOLATION);
  });
});

describe("cancelamento de venda de pacote", () => {
  it("recepção não cancela; admin cancela e o registro sobrevive ao saldo", async () => {
    const recepcao = await logado(`saldo-recepcao-${sufixo}@teste.dev`);
    const negado = await recepcao.rpc("cancelar_venda_de_pacote", {
      p_balance_id: saldoCancelavel,
      p_reason: "Recepção tentando",
    });
    expect(negado.error?.code).toBe(RLS_VIOLATION);

    const adminA = await logado(`saldo-admin-${sufixo}@teste.dev`);
    const ok = await adminA.rpc("cancelar_venda_de_pacote", {
      p_balance_id: saldoCancelavel,
      p_reason: "Vendido no paciente errado",
    });
    expect(ok.error).toBeNull();

    const { data: saldo } = await admin
      .from("package_balance")
      .select("id")
      .eq("id", saldoCancelavel);
    expect(saldo).toEqual([]);
    const { data: registro } = await admin
      .from("package_balance_adjustment")
      .select("kind, package_balance_id, user_id, reason")
      .eq("contact_id", contatoA)
      .eq("kind", "cancelamento")
      .throwOnError();
    expect(registro).toEqual([
      {
        kind: "cancelamento",
        package_balance_id: null,
        user_id: adminAId,
        reason: "Vendido no paciente errado",
      },
    ]);
  });

  it("venda que já descontou sessão de consulta não se cancela", async () => {
    const adminA = await logado(`saldo-admin-${sufixo}@teste.dev`);
    const { error } = await adminA.rpc("cancelar_venda_de_pacote", {
      p_balance_id: saldoDebitado,
      p_reason: "Tentando apagar o debito",
    });
    expect(error?.code).toBe(FK_VIOLATION);
    const { data } = await admin
      .from("package_balance")
      .select("id")
      .eq("id", saldoDebitado);
    expect(data).toHaveLength(1);
  });

  it("admin da B não cancela a venda da A", async () => {
    const outra = await logado(`saldo-outra-${sufixo}@teste.dev`);
    const { error } = await outra.rpc("cancelar_venda_de_pacote", {
      p_balance_id: saldoAjuste,
      p_reason: "Tentativa de fora",
    });
    expect(error?.code).toBe(NAO_ENCONTRADO);
    const { data } = await admin
      .from("package_balance")
      .select("id")
      .eq("id", saldoAjuste);
    expect(data).toHaveLength(1);
  });
});

describe("pacientes_resumo com primeira_consulta", () => {
  it("devolve a consulta não cancelada mais antiga, e a B não vê o paciente da A", async () => {
    const adminA = await logado(`saldo-admin-${sufixo}@teste.dev`);
    const { data, error } = await adminA.rpc("pacientes_resumo", {
      p_clinic_id: clinicaA,
    });
    expect(error).toBeNull();
    const linha = (
      data as { contact_id: string; primeira_consulta: string }[]
    ).find((paciente) => paciente.contact_id === contatoA);
    expect(new Date(linha!.primeira_consulta).toISOString()).toBe(
      primeiraConsulta,
    );

    const outra = await logado(`saldo-outra-${sufixo}@teste.dev`);
    const { data: vazado } = await outra.rpc("pacientes_resumo", {
      p_clinic_id: clinicaA,
    });
    expect(vazado).toEqual([]);
  });
});
