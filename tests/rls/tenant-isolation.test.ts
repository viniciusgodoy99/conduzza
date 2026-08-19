import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./local-stack";

// Aceite da tarefa 0.4: teste automatizado provando que um usuario da clinica
// A recebe ZERO linhas ao consultar dado da clinica B, com JWTs reais emitidos
// pelo GoTrue local. Select barrado por RLS retorna vazio, nao erro: as
// assercoes sao sempre sobre data.length. A verificacao anti falso-positivo
// (service role enxerga o dado) garante que o dado existia e so a RLS o
// escondeu.

const RLS_VIOLATION = "42501";
const suffix = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rls-teste-${suffix}!`;

const admin = adminClient();

type Person = { user: User; client: SupabaseClient };

let userA: Person;
let userB: Person;
let userRecepcaoA: Person;
let clinicA: { id: string };
let clinicB: { id: string };

async function createPerson(email: string): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário ${email}: ${error?.message}`);
  }
  return data.user;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    throw new Error(`Falha no login de ${email}: ${error.message}`);
  }
  return client;
}

beforeAll(async () => {
  const [a, b, r] = await Promise.all([
    createPerson(`rls-a-${suffix}@teste.dev`),
    createPerson(`rls-b-${suffix}@teste.dev`),
    createPerson(`rls-recepcao-${suffix}@teste.dev`),
  ]);

  const { data: clinics, error: clinicError } = await admin
    .from("clinic")
    .insert([
      { name: `Clínica A ${suffix}`, slug: `rls-a-${suffix}` },
      { name: `Clínica B ${suffix}`, slug: `rls-b-${suffix}` },
    ])
    .select("id, slug");
  if (clinicError || clinics?.length !== 2) {
    throw new Error(`Falha ao criar clínicas: ${clinicError?.message}`);
  }
  const a0 = clinics.find((c) => c.slug === `rls-a-${suffix}`);
  const b0 = clinics.find((c) => c.slug === `rls-b-${suffix}`);
  if (!a0 || !b0) throw new Error("Clínicas de teste não encontradas");
  clinicA = a0;
  clinicB = b0;

  const { error: memberError } = await admin.from("clinic_member").insert([
    { clinic_id: clinicA.id, user_id: a.id, role: "admin" },
    { clinic_id: clinicB.id, user_id: b.id, role: "admin" },
    { clinic_id: clinicA.id, user_id: r.id, role: "recepcao" },
  ]);
  if (memberError) {
    throw new Error(`Falha ao criar membros: ${memberError.message}`);
  }

  const { error: brandingError } = await admin
    .from("clinic_branding")
    .insert([{ clinic_id: clinicA.id }, { clinic_id: clinicB.id }]);
  if (brandingError) {
    throw new Error(`Falha ao criar branding: ${brandingError.message}`);
  }

  const { data: units, error: unitError } = await admin
    .from("unit")
    .insert([
      { clinic_id: clinicA.id, name: "Unidade A1" },
      { clinic_id: clinicA.id, name: "Unidade A2" },
      { clinic_id: clinicB.id, name: "Unidade B1" },
      { clinic_id: clinicB.id, name: "Unidade B2" },
    ])
    .select("id, name");
  if (unitError || units?.length !== 4) {
    throw new Error(`Falha ao criar unidades: ${unitError?.message}`);
  }

  const { error: auditError } = await admin.from("audit_log").insert([
    { clinic_id: clinicA.id, user_id: a.id, action: "leu", entity: "teste" },
    { clinic_id: clinicB.id, user_id: b.id, action: "leu", entity: "teste" },
  ]);
  if (auditError) {
    throw new Error(`Falha ao criar auditoria: ${auditError.message}`);
  }

  userA = { user: a, client: await signIn(`rls-a-${suffix}@teste.dev`) };
  userB = { user: b, client: await signIn(`rls-b-${suffix}@teste.dev`) };
  userRecepcaoA = {
    user: r,
    client: await signIn(`rls-recepcao-${suffix}@teste.dev`),
  };
});

afterAll(async () => {
  // on delete cascade limpa branding, membros, unidades e auditoria.
  await admin.from("clinic").delete().in("id", [clinicA.id, clinicB.id]);
  await Promise.all(
    [userA, userB, userRecepcaoA]
      .filter(Boolean)
      .map((person) => admin.auth.admin.deleteUser(person.user.id)),
  );
});

describe("anti falso-positivo", () => {
  it("service role enxerga as 2 unidades da clínica B", async () => {
    const { data, error } = await admin
      .from("unit")
      .select("id")
      .eq("clinic_id", clinicB.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});

describe.each([
  ["A", () => userA, () => clinicA, () => clinicB],
  ["B", () => userB, () => clinicB, () => clinicA],
])("usuário da clínica %s", (_side, person, own, other) => {
  it("lista apenas a própria clínica", async () => {
    const { data, error } = await person().client.from("clinic").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(own().id);
  });

  it("recebe zero linhas ao consultar a clínica da outra", async () => {
    const { data, error } = await person()
      .client.from("clinic")
      .select("id")
      .eq("id", other().id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it.each(["clinic_member", "unit", "audit_log", "clinic_branding"])(
    "recebe zero linhas de %s da outra clínica",
    async (table) => {
      const { data, error } = await person()
        .client.from(table)
        .select("clinic_id")
        .eq("clinic_id", other().id);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  it("lê as próprias unidades", async () => {
    const { data, error } = await person()
      .client.from("unit")
      .select("id")
      .eq("clinic_id", own().id);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("não consegue inserir unidade na outra clínica", async () => {
    const { data, error } = await person()
      .client.from("unit")
      .insert({ clinic_id: other().id, name: "Invasão" })
      .select();
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("não consegue editar unidade da outra clínica (0 linhas afetadas)", async () => {
    const { data, error } = await person()
      .client.from("unit")
      .update({ name: "Renomeada por invasor" })
      .eq("clinic_id", other().id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("como admin, insere unidade na própria clínica", async () => {
    const { data, error } = await person()
      .client.from("unit")
      .insert({ clinic_id: own().id, name: `Unidade nova ${_side}` })
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("camada de papel nas policies", () => {
  it("recepção não insere unidade nem na própria clínica", async () => {
    const { data, error } = await userRecepcaoA.client
      .from("unit")
      .insert({ clinic_id: clinicA.id, name: "Unidade da recepção" })
      .select();
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("recepção não lê a trilha de auditoria", async () => {
    const { data, error } = await userRecepcaoA.client
      .from("audit_log")
      .select("id")
      .eq("clinic_id", clinicA.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a trilha de auditoria é imutável para usuários (0 linhas afetadas)", async () => {
    const { data, error } = await userA.client
      .from("audit_log")
      .update({ action: "adulterada" })
      .eq("clinic_id", clinicA.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
