import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Fase 2, tarefa 2.1: RLS do catalogo clinico.
// Matriz do brief (secao 5): TODO membro ativo LE o catalogo (recepcao precisa
// de preco e duracao); escrita e SO de administrador e gestor.
// Padrao da suite: select barrado por RLS retorna VAZIO, nao erro; toda
// negacao tem verificacao anti falso-positivo via service role.

const RLS_VIOLATION = "42501";
const UNIQUE_VIOLATION = "23505";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Catalogo!Rls2026";

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
let procedimentoA = "";
let convenioA = "";

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
): Promise<void> {
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
  });
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

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Catalogo A ${sufixo}`, slug: `cat-a-${sufixo}` },
      { name: `Catalogo B ${sufixo}`, slug: `cat-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("cat-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("cat-b"))!.id as string;

  await criarUsuario(`cat-gestor-${sufixo}@teste.dev`, clinicaA, "gestor");
  await criarUsuario(`cat-recepcao-${sufixo}@teste.dev`, clinicaA, "recepcao");
  await criarUsuario(`cat-outra-${sufixo}@teste.dev`, clinicaB, "admin");

  const { data: prof } = await admin
    .from("professional")
    .insert({
      clinic_id: clinicaA,
      name: "Dr. João Pereira",
      council_type: "CRM",
      council_number: "12345",
      specialties: ["Endocrinologia", "Nutrologia"],
    })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;

  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicaA,
      name: "Consulta endócrino",
      default_duration_min: 40,
      base_price_cents: 40000,
    })
    .select("id")
    .single()
    .throwOnError();
  procedimentoA = proc!.id as string;

  const { data: conv } = await admin
    .from("insurance")
    .insert({ clinic_id: clinicaA, name: "Unimed" })
    .select("id")
    .single()
    .throwOnError();
  convenioA = conv!.id as string;

  await admin
    .from("service_link")
    .insert([
      {
        clinic_id: clinicaA,
        professional_id: profissionalA,
        procedure_id: procedimentoA,
        insurance_id: null,
        price_cents: 40000,
        covered_by_insurance: false,
        duration_min: 40,
      },
      {
        clinic_id: clinicaA,
        professional_id: profissionalA,
        procedure_id: procedimentoA,
        insurance_id: convenioA,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 40,
      },
    ])
    .throwOnError();
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith(`cat-`) &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("leitura do catálogo", () => {
  it("recepção lê profissionais, procedimentos, convênios e vínculos (preço e duração)", async () => {
    const recepcao = await logado(`cat-recepcao-${sufixo}@teste.dev`);
    const [profs, procs, convs, vinculos] = await Promise.all([
      recepcao.from("professional").select("id").eq("clinic_id", clinicaA),
      recepcao.from("procedure").select("id").eq("clinic_id", clinicaA),
      recepcao.from("insurance").select("id").eq("clinic_id", clinicaA),
      recepcao
        .from("service_link")
        .select("price_cents, covered_by_insurance, duration_min")
        .eq("clinic_id", clinicaA),
    ]);
    expect(profs.data).toHaveLength(1);
    expect(procs.data).toHaveLength(1);
    expect(convs.data).toHaveLength(1);
    expect(vinculos.data).toHaveLength(2);
  });

  it("membro de OUTRA clínica não vê nada (e o dado existe: anti falso-positivo)", async () => {
    const outra = await logado(`cat-outra-${sufixo}@teste.dev`);
    const { data: nada } = await outra
      .from("service_link")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(nada).toHaveLength(0);

    const { data: existe } = await admin
      .from("service_link")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(existe).toHaveLength(2);
  });
});

describe("escrita do catálogo", () => {
  it("recepção NÃO escreve: insert de procedimento barrado", async () => {
    const recepcao = await logado(`cat-recepcao-${sufixo}@teste.dev`);
    const { error } = await recepcao.from("procedure").insert({
      clinic_id: clinicaA,
      name: "Não deveria entrar",
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("recepção NÃO edita preço de vínculo", async () => {
    const recepcao = await logado(`cat-recepcao-${sufixo}@teste.dev`);
    const { data } = await recepcao
      .from("service_link")
      .update({ price_cents: 1 })
      .eq("clinic_id", clinicaA)
      .select("id");
    // update barrado por RLS afeta zero linhas
    expect(data ?? []).toHaveLength(0);
    const { data: intacto } = await admin
      .from("service_link")
      .select("price_cents")
      .eq("clinic_id", clinicaA)
      .eq("insurance_id", convenioA)
      .single();
    expect(intacto?.price_cents).toBeNull();
  });

  it("gestor escreve: cria convênio e vínculo", async () => {
    const gestor = await logado(`cat-gestor-${sufixo}@teste.dev`);
    const { data: novoConv, error: e1 } = await gestor
      .from("insurance")
      .insert({ clinic_id: clinicaA, name: "Bradesco" })
      .select("id")
      .single();
    expect(e1).toBeNull();
    const { error: e2 } = await gestor.from("service_link").insert({
      clinic_id: clinicaA,
      professional_id: profissionalA,
      procedure_id: procedimentoA,
      insurance_id: novoConv!.id,
      covered_by_insurance: true,
      duration_min: 40,
    });
    expect(e2).toBeNull();
  });
});

describe("aceite 2.1: unicidade do vínculo e os três estados de preço", () => {
  it("dois vínculos 'particular' iguais COLIDEM (nulls not distinct)", async () => {
    const { error } = await admin.from("service_link").insert({
      clinic_id: clinicaA,
      professional_id: profissionalA,
      procedure_id: procedimentoA,
      insurance_id: null,
      price_cents: 50000,
      duration_min: 60,
    });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  it("'coberto pelo convênio' sem convênio é estado impossível (check)", async () => {
    const { error } = await admin.from("service_link").insert({
      clinic_id: clinicaA,
      professional_id: profissionalA,
      procedure_id: procedimentoA,
      insurance_id: null,
      covered_by_insurance: true,
      duration_min: 30,
    });
    expect(error).not.toBeNull();
  });

  it("os três estados coexistem e são distinguíveis no dado", async () => {
    // Ja temos: particular com preco (40000) e coberto (null + covered).
    // Falta o terceiro: preco zero de verdade.
    const { data: procGratis } = await admin
      .from("procedure")
      .insert({ clinic_id: clinicaA, name: "Avaliação gratuita" })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("service_link")
      .insert({
        clinic_id: clinicaA,
        professional_id: profissionalA,
        procedure_id: procGratis!.id,
        insurance_id: null,
        price_cents: 0,
        duration_min: 20,
      })
      .throwOnError();

    const { data: estados } = await admin
      .from("service_link")
      .select("price_cents, covered_by_insurance")
      .eq("clinic_id", clinicaA)
      .eq("professional_id", profissionalA);
    const temValor = estados!.some(
      (v) => v.price_cents === 40000 && !v.covered_by_insurance,
    );
    const temCoberto = estados!.some(
      (v) => v.price_cents === null && v.covered_by_insurance,
    );
    const temZero = estados!.some(
      (v) => v.price_cents === 0 && !v.covered_by_insurance,
    );
    expect(temValor).toBe(true);
    expect(temCoberto).toBe(true);
    expect(temZero).toBe(true);
  });
});
