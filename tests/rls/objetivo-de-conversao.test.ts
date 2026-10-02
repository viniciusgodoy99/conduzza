import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Objetivo de conversao (A3, Resultados; migration 20261002110000): uma
// linha por clinica. Membro ativo le; admin e gestor gravam, sempre em nome
// proprio (definido_por = auth.uid()); recepcao, leitura e profissional nao
// gravam; pendente nao le; a clinica B nunca le nem grava o da A. O
// percentual vai de 0,1 a 100.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "ObjetivoF3!Rls2026";

let clinicaA = "";
let clinicaB = "";
const ids = new Map<string, string>();

const email = (papel: string) => `obj-conv-${papel}-${sufixo}@teste.dev`;

async function criarUsuario(
  papel: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
  professionalId?: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email: email(papel),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: papel },
  });
  ids.set(papel, data.user!.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status,
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
    .throwOnError();
}

async function logado(papel: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papel),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papel}: ${error.message}`);
  }
  return cliente;
}

const id = (papel: string) => ids.get(papel)!;

/** O objetivo da clinica como o banco guardou (service role, sem RLS). */
async function objetivoNoBanco(clinicId: string) {
  const { data } = await admin
    .from("objetivo_de_conversao")
    .select("percentual, definido_por")
    .eq("clinic_id", clinicId)
    .maybeSingle()
    .throwOnError();
  return data as { percentual: number; definido_por: string | null } | null;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Objetivo A ${sufixo}`,
        slug: `obj-conv-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Objetivo B ${sufixo}`,
        slug: `obj-conv-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `obj-conv-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `obj-conv-b-${sufixo}`)!
    .id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Objetivo" })
    .select("id")
    .single()
    .throwOnError();

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario(
    "prof-a",
    clinicaA,
    "profissional",
    "ativo",
    prof!.id as string,
  );
  await criarUsuario("pendente-a", clinicaA, "recepcao", "pendente");
  await criarUsuario("gestor-b", clinicaB, "gestor");
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const usuario of ids.values()) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

describe("objetivo_de_conversao: quem grava", () => {
  it("admin grava em nome próprio; em nome de outra pessoa é recusado", async () => {
    const cliente = await logado("admin-a");
    const emNomeDeOutro = await cliente.from("objetivo_de_conversao").insert({
      clinic_id: clinicaA,
      percentual: 25,
      definido_por: id("gestor-a"),
    });
    expect(emNomeDeOutro.error?.code).toBe(RLS_VIOLATION);
    expect(await objetivoNoBanco(clinicaA)).toBeNull();

    const ok = await cliente.from("objetivo_de_conversao").insert({
      clinic_id: clinicaA,
      percentual: 25.5,
      definido_por: id("admin-a"),
    });
    expect(ok.error).toBeNull();
    expect(await objetivoNoBanco(clinicaA)).toEqual({
      percentual: 25.5,
      definido_por: id("admin-a"),
    });
  });

  it("percentual 0 e 101 são recusados pelo banco", async () => {
    const cliente = await logado("gestor-a");
    for (const percentual of [0, 101]) {
      const { error } = await cliente
        .from("objetivo_de_conversao")
        .upsert(
          { clinic_id: clinicaA, percentual, definido_por: id("gestor-a") },
          { onConflict: "clinic_id" },
        );
      expect(error?.code).toBe(CHECK_VIOLATION);
    }
    expect((await objetivoNoBanco(clinicaA))?.percentual).toBe(25.5);
  });

  it("gestor altera em nome próprio (upsert); manter a autoria de outra pessoa é recusado", async () => {
    const cliente = await logado("gestor-a");
    const mantendoOutro = await cliente
      .from("objetivo_de_conversao")
      .update({ percentual: 31 })
      .eq("clinic_id", clinicaA);
    expect(mantendoOutro.error?.code).toBe(RLS_VIOLATION);

    const ok = await cliente
      .from("objetivo_de_conversao")
      .upsert(
        { clinic_id: clinicaA, percentual: 30, definido_por: id("gestor-a") },
        { onConflict: "clinic_id" },
      );
    expect(ok.error).toBeNull();
    expect(await objetivoNoBanco(clinicaA)).toEqual({
      percentual: 30,
      definido_por: id("gestor-a"),
    });
  });

  it("recepção, leitura e profissional leem e não gravam", async () => {
    for (const papel of ["recepcao-a", "leitura-a", "prof-a"]) {
      const cliente = await logado(papel);
      const { data: lido, error } = await cliente
        .from("objetivo_de_conversao")
        .select("percentual")
        .eq("clinic_id", clinicaA);
      expect(error).toBeNull();
      expect(lido).toEqual([{ percentual: 30 }]);

      const upsert = await cliente
        .from("objetivo_de_conversao")
        .upsert(
          { clinic_id: clinicaA, percentual: 90, definido_por: id(papel) },
          { onConflict: "clinic_id" },
        );
      expect(upsert.error?.code).toBe(RLS_VIOLATION);

      const { data: alterados } = await cliente
        .from("objetivo_de_conversao")
        .update({ percentual: 90, definido_por: id(papel) })
        .eq("clinic_id", clinicaA)
        .select("clinic_id");
      expect(alterados ?? []).toEqual([]);

      const { data: removidos } = await cliente
        .from("objetivo_de_conversao")
        .delete()
        .eq("clinic_id", clinicaA)
        .select("clinic_id");
      expect(removidos ?? []).toEqual([]);
    }
    expect(await objetivoNoBanco(clinicaA)).toEqual({
      percentual: 30,
      definido_por: id("gestor-a"),
    });
  });

  it("pendente não lê", async () => {
    const cliente = await logado("pendente-a");
    const { data } = await cliente
      .from("objetivo_de_conversao")
      .select("percentual")
      .eq("clinic_id", clinicaA);
    expect(data ?? []).toEqual([]);
  });

  it("anon não lê", async () => {
    const { data, error } = await anonClient()
      .from("objetivo_de_conversao")
      .select("percentual")
      .eq("clinic_id", clinicaA);
    // Sem grant para anon: erro de permissão (ou nada, nunca a linha).
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("objetivo_de_conversao: isolamento entre clínicas", () => {
  it("gestor da B não lê nem grava o da A; grava o da B (contraprova)", async () => {
    const cliente = await logado("gestor-b");
    const { data: lido } = await cliente
      .from("objetivo_de_conversao")
      .select("percentual")
      .eq("clinic_id", clinicaA);
    expect(lido ?? []).toEqual([]);

    const upsert = await cliente
      .from("objetivo_de_conversao")
      .upsert(
        { clinic_id: clinicaA, percentual: 99, definido_por: id("gestor-b") },
        { onConflict: "clinic_id" },
      );
    expect(upsert.error?.code).toBe(RLS_VIOLATION);
    const { data: alterados } = await cliente
      .from("objetivo_de_conversao")
      .update({ percentual: 99, definido_por: id("gestor-b") })
      .eq("clinic_id", clinicaA)
      .select("clinic_id");
    expect(alterados ?? []).toEqual([]);
    expect((await objetivoNoBanco(clinicaA))?.percentual).toBe(30);

    const proprio = await cliente.from("objetivo_de_conversao").insert({
      clinic_id: clinicaB,
      percentual: 40,
      definido_por: id("gestor-b"),
    });
    expect(proprio.error).toBeNull();

    const clienteA = await logado("admin-a");
    const { data: deB } = await clienteA
      .from("objetivo_de_conversao")
      .select("percentual")
      .eq("clinic_id", clinicaB);
    expect(deB ?? []).toEqual([]);
  });

  it("gestor da A remove o objetivo da A", async () => {
    const cliente = await logado("gestor-a");
    const { data: removidos, error } = await cliente
      .from("objetivo_de_conversao")
      .delete()
      .eq("clinic_id", clinicaA)
      .select("clinic_id");
    expect(error).toBeNull();
    expect(removidos).toEqual([{ clinic_id: clinicaA }]);
    expect(await objetivoNoBanco(clinicaA)).toBeNull();
  });
});
