import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Convenio pelo medico (migration 20261002140000), pela API com JWT real de
// cada papel. O que esta em jogo nas duas tabelas novas:
//   - professional_insurance (o medico atende o convenio) e
//     procedure_insurance (o convenio cobre o procedimento): membro ATIVO le,
//     admin e gestor escrevem; recepcao, leitura e profissional so leem;
//     pendente nao le nada; anon sem acesso; a linha nao se edita (sem
//     UPDATE para authenticated: entra ou sai);
//   - a B nunca le nem escreve na A, e o admin da A nao grava com o
//     clinic_id da B (WITH CHECK);
//   - membro das DUAS clinicas passa na RLS dos dois lados, e o gatilho
//     exigir_convenio_da_mesma_clinica recusa a mistura (23503);
//   - as RPCs sincronizar_convenios_do_profissional e
//     sincronizar_vinculos_do_procedimento (SECURITY INVOKER): recepcao e
//     leitura recebem 42501; pendente e a B recebem "nao encontrado"
//     (P0002); convenio da A na chamada da B da 23503.
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Mesmos
// cenarios do ensaio (scratchpad convenio/banco/asserts.sql, blocos R, M e P).
// A cascata e as regras de sincronia estao em
// tests/integration/convenio-pelo-medico-rpc.test.ts.

const RLS_VIOLATION = "42501";
const FK_VIOLATION = "23503";
const NAO_ENCONTRADO = "P0002";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "ConvenioMedico!Rls2026";

let clinicaA = "";
let clinicaB = "";
let joao = "";
let caio = "";
let profB = "";
let unimed = "";
let bradesco = "";
let convenioB = "";
let endocrino = "";
let botox = "";
let procB = "";
let parDaA = "";
let coberturaDaA = "";
let parDaB = "";
let coberturaDaB = "";
const clientes = new Map<string, SupabaseClient>();
const usuarios: string[] = [];

const email = (apelido: string) => `conv-medico-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

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

/** Cria a pessoa, os vinculos de membro e loga uma vez (JWT real). */
async function criarPessoa(
  apelido: string,
  vinculos: {
    clinicId: string;
    role: string;
    status?: "ativo" | "pendente";
    professionalId?: string;
  }[],
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: apelido },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.push(data.user.id);
  for (const vinculo of vinculos) {
    await admin
      .from("clinic_member")
      .insert({
        clinic_id: vinculo.clinicId,
        user_id: data.user.id,
        role: vinculo.role,
        status: vinculo.status ?? "ativo",
        ...(vinculo.professionalId
          ? { professional_id: vinculo.professionalId }
          : {}),
      })
      .throwOnError();
  }
  const cliente = anonClient();
  const { error: erroLogin } = await cliente.auth.signInWithPassword({
    email: email(apelido),
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${apelido}: ${erroLogin.message}`);
  }
  clientes.set(apelido, cliente);
}

/** Quantas linhas existem de verdade (service role, sem RLS). */
async function existe(tabela: string, id: string): Promise<boolean> {
  const { data } = await admin
    .from(tabela)
    .select("id")
    .eq("id", id)
    .throwOnError();
  return (data ?? []).length === 1;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Convênio A ${sufixo}`,
        slug: `conv-medico-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Convênio B ${sufixo}`,
        slug: `conv-medico-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("conv-medico-a"))!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("conv-medico-b"))!
    .id as string;

  joao = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dr. João",
  });
  caio = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dr. Caio",
  });
  profB = await inserirId("professional", {
    clinic_id: clinicaB,
    name: "Dr. B",
  });
  unimed = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Unimed",
  });
  bradesco = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Bradesco Saúde",
  });
  convenioB = await inserirId("insurance", {
    clinic_id: clinicaB,
    name: "Convênio B",
  });
  endocrino = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Endocrinologia",
    default_duration_min: 40,
  });
  botox = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Botox",
    default_duration_min: 30,
  });
  procB = await inserirId("procedure", {
    clinic_id: clinicaB,
    name: "Proc B",
    default_duration_min: 30,
  });

  parDaA = await inserirId("professional_insurance", {
    clinic_id: clinicaA,
    professional_id: joao,
    insurance_id: unimed,
  });
  coberturaDaA = await inserirId("procedure_insurance", {
    clinic_id: clinicaA,
    procedure_id: endocrino,
    insurance_id: unimed,
  });
  parDaB = await inserirId("professional_insurance", {
    clinic_id: clinicaB,
    professional_id: profB,
    insurance_id: convenioB,
  });
  coberturaDaB = await inserirId("procedure_insurance", {
    clinic_id: clinicaB,
    procedure_id: procB,
    insurance_id: convenioB,
  });

  await criarPessoa("admin-a", [{ clinicId: clinicaA, role: "admin" }]);
  await criarPessoa("gestor-a", [{ clinicId: clinicaA, role: "gestor" }]);
  await criarPessoa("recepcao-a", [{ clinicId: clinicaA, role: "recepcao" }]);
  await criarPessoa("leitura-a", [{ clinicId: clinicaA, role: "leitura" }]);
  await criarPessoa("profissional-a", [
    { clinicId: clinicaA, role: "profissional", professionalId: joao },
  ]);
  await criarPessoa("pendente-a", [
    { clinicId: clinicaA, role: "recepcao", status: "pendente" },
  ]);
  await criarPessoa("admin-b", [{ clinicId: clinicaB, role: "admin" }]);
  await criarPessoa("duplo", [
    { clinicId: clinicaA, role: "admin" },
    { clinicId: clinicaB, role: "admin" },
  ]);
});

afterAll(async () => {
  // As clinicas levam profissionais, procedimentos, convenios e os pares
  // (on delete cascade); depois os usuarios.
  for (const clinicId of [clinicaA, clinicaB]) {
    if (clinicId) {
      await admin.from("clinic").delete().eq("id", clinicId);
    }
  }
  for (const usuario of usuarios) {
    await admin.auth.admin.deleteUser(usuario);
  }
});

describe("leitura: membro ativo lê só a própria clínica", () => {
  it.each(["admin-a", "gestor-a", "recepcao-a", "leitura-a", "profissional-a"])(
    "%s lê os pares da A e nenhum da B",
    async (apelido) => {
      const { data: pares, error } = await como(apelido)
        .from("professional_insurance")
        .select("id")
        .in("clinic_id", [clinicaA, clinicaB]);
      expect(error).toBeNull();
      expect((pares ?? []).map((p) => p.id)).toEqual([parDaA]);

      const { data: coberturas, error: erroCobertura } = await como(apelido)
        .from("procedure_insurance")
        .select("id")
        .in("clinic_id", [clinicaA, clinicaB]);
      expect(erroCobertura).toBeNull();
      expect((coberturas ?? []).map((c) => c.id)).toEqual([coberturaDaA]);
    },
  );

  it("a B lê só a B (o dado da A existe)", async () => {
    const { data: pares } = await como("admin-b")
      .from("professional_insurance")
      .select("id")
      .in("clinic_id", [clinicaA, clinicaB]);
    expect((pares ?? []).map((p) => p.id)).toEqual([parDaB]);
    const { data: coberturas } = await como("admin-b")
      .from("procedure_insurance")
      .select("id")
      .in("clinic_id", [clinicaA, clinicaB]);
    expect((coberturas ?? []).map((c) => c.id)).toEqual([coberturaDaB]);
    expect(await existe("professional_insurance", parDaA)).toBe(true);
  });

  it("pendente não lê nada (o admin da mesma clínica lê)", async () => {
    const { data: pares } = await como("pendente-a")
      .from("professional_insurance")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(pares ?? []).toEqual([]);
    const { data: coberturas } = await como("pendente-a")
      .from("procedure_insurance")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(coberturas ?? []).toEqual([]);

    const { data: doAdmin } = await como("admin-a")
      .from("professional_insurance")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect((doAdmin ?? []).length).toBe(1);
  });

  it("anon não acessa as tabelas nem as RPCs (sem privilégio, e não só sem policy)", async () => {
    // Sem o revoke da migration, a tabela devolveria [] (falta de policy) e a
    // RPC rodaria e daria P0002 (o anon nao enxerga o cadastro): os dois
    // passariam numa conferencia frouxa. Por isso se exige o 42501 do
    // Postgres pela falta de GRANT, com a mensagem, que distingue do
    // insufficient_privilege que a propria RPC levanta (mesmo codigo).
    for (const tabela of ["professional_insurance", "procedure_insurance"]) {
      const anonimo = await anonClient()
        .from(tabela)
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(anonimo.error?.code).toBe(RLS_VIOLATION);
      expect(anonimo.error?.message).toMatch(/permission denied for table/);
      expect(anonimo.data ?? null).toBeNull();
    }
    const { error: erroMedico } = await anonClient().rpc(
      "sincronizar_convenios_do_profissional",
      { p_professional_id: joao, p_convenios: [] },
    );
    expect(erroMedico?.code).toBe(RLS_VIOLATION);
    expect(erroMedico?.message).toMatch(/permission denied for function/);
    const { error: erroProcedimento } = await anonClient().rpc(
      "sincronizar_vinculos_do_procedimento",
      { p_procedure_id: endocrino, p_linhas: [], p_planos: [] },
    );
    expect(erroProcedimento?.code).toBe(RLS_VIOLATION);
    expect(erroProcedimento?.message).toMatch(/permission denied for function/);
  });
});

describe("escrita: só admin e gestor, e só na própria clínica", () => {
  it.each(["recepcao-a", "leitura-a", "profissional-a", "pendente-a"])(
    "%s não insere nem apaga",
    async (apelido) => {
      const { error: erroPar } = await como(apelido)
        .from("professional_insurance")
        .insert({
          clinic_id: clinicaA,
          professional_id: caio,
          insurance_id: unimed,
        });
      expect(erroPar?.code).toBe(RLS_VIOLATION);
      const { error: erroCobertura } = await como(apelido)
        .from("procedure_insurance")
        .insert({
          clinic_id: clinicaA,
          procedure_id: botox,
          insurance_id: unimed,
        });
      expect(erroCobertura?.code).toBe(RLS_VIOLATION);

      const { data: apagouPar } = await como(apelido)
        .from("professional_insurance")
        .delete()
        .eq("id", parDaA)
        .select("id");
      expect(apagouPar ?? []).toEqual([]);
      const { data: apagouCobertura } = await como(apelido)
        .from("procedure_insurance")
        .delete()
        .eq("id", coberturaDaA)
        .select("id");
      expect(apagouCobertura ?? []).toEqual([]);
      expect(await existe("professional_insurance", parDaA)).toBe(true);
      expect(await existe("procedure_insurance", coberturaDaA)).toBe(true);
    },
  );

  it("gestor e admin da A inserem e apagam (positivo)", async () => {
    const { data: par, error } = await como("gestor-a")
      .from("professional_insurance")
      .insert({
        clinic_id: clinicaA,
        professional_id: caio,
        insurance_id: unimed,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: apagou } = await como("gestor-a")
      .from("professional_insurance")
      .delete()
      .eq("id", (par as { id: string }).id)
      .select("id");
    expect(apagou ?? []).toHaveLength(1);

    const { data: cobertura, error: erroCobertura } = await como("admin-a")
      .from("procedure_insurance")
      .insert({
        clinic_id: clinicaA,
        procedure_id: botox,
        insurance_id: bradesco,
      })
      .select("id")
      .single();
    expect(erroCobertura).toBeNull();
    const { data: apagouCobertura } = await como("admin-a")
      .from("procedure_insurance")
      .delete()
      .eq("id", (cobertura as { id: string }).id)
      .select("id");
    expect(apagouCobertura ?? []).toHaveLength(1);
  });

  it("a linha não se edita, nem pelo admin (entra ou sai)", async () => {
    const { error } = await como("admin-a")
      .from("professional_insurance")
      .update({ insurance_id: bradesco })
      .eq("id", parDaA);
    expect(error?.code).toBe(RLS_VIOLATION);
    const { error: erroCobertura } = await como("admin-a")
      .from("procedure_insurance")
      .update({ insurance_id: bradesco })
      .eq("id", coberturaDaA);
    expect(erroCobertura?.code).toBe(RLS_VIOLATION);

    const { data } = await admin
      .from("professional_insurance")
      .select("insurance_id")
      .eq("id", parDaA)
      .single()
      .throwOnError();
    expect(data).toEqual({ insurance_id: unimed });
  });

  it("a B não escreve nem apaga na A; o admin da A não grava com o clinic_id da B", async () => {
    const { error } = await como("admin-b")
      .from("professional_insurance")
      .insert({
        clinic_id: clinicaA,
        professional_id: caio,
        insurance_id: unimed,
      });
    expect(error?.code).toBe(RLS_VIOLATION);
    const { data: apagou } = await como("admin-b")
      .from("procedure_insurance")
      .delete()
      .eq("id", coberturaDaA)
      .select("id");
    expect(apagou ?? []).toEqual([]);
    expect(await existe("procedure_insurance", coberturaDaA)).toBe(true);

    const { error: erroDaA } = await como("admin-a")
      .from("professional_insurance")
      .insert({
        clinic_id: clinicaB,
        professional_id: profB,
        insurance_id: convenioB,
      });
    expect(erroDaA?.code).toBe(RLS_VIOLATION);
  });
});

describe("mistura de clínicas: o gatilho recusa com 23503", () => {
  it("membro das duas clínicas não junta cadastro da A com o da B", async () => {
    const cliente = como("duplo");
    const convenioDaB = await cliente.from("professional_insurance").insert({
      clinic_id: clinicaA,
      professional_id: joao,
      insurance_id: convenioB,
    });
    expect(convenioDaB.error?.code).toBe(FK_VIOLATION);
    expect(convenioDaB.error?.message).toBe(
      "O convênio informado não pertence a esta clínica.",
    );

    const profissionalDaB = await cliente
      .from("professional_insurance")
      .insert({
        clinic_id: clinicaA,
        professional_id: profB,
        insurance_id: unimed,
      });
    expect(profissionalDaB.error?.code).toBe(FK_VIOLATION);
    expect(profissionalDaB.error?.message).toBe(
      "O profissional informado não pertence a esta clínica.",
    );

    const procedimentoDaB = await cliente.from("procedure_insurance").insert({
      clinic_id: clinicaA,
      procedure_id: procB,
      insurance_id: unimed,
    });
    expect(procedimentoDaB.error?.code).toBe(FK_VIOLATION);
    expect(procedimentoDaB.error?.message).toBe(
      "O procedimento informado não pertence a esta clínica.",
    );

    const coberturaComConvenioDaB = await cliente
      .from("procedure_insurance")
      .insert({
        clinic_id: clinicaA,
        procedure_id: endocrino,
        insurance_id: convenioB,
      });
    expect(coberturaComConvenioDaB.error?.code).toBe(FK_VIOLATION);

    // Positivo: tudo da A passa para o mesmo membro.
    const { data: certo, error } = await cliente
      .from("professional_insurance")
      .insert({
        clinic_id: clinicaA,
        professional_id: caio,
        insurance_id: bradesco,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    await admin
      .from("professional_insurance")
      .delete()
      .eq("id", (certo as { id: string }).id)
      .throwOnError();
  });

  it("vale também para a service role (o gatilho não depende da RLS)", async () => {
    const { error } = await admin.from("professional_insurance").insert({
      clinic_id: clinicaA,
      professional_id: joao,
      insurance_id: convenioB,
    });
    expect(error?.code).toBe(FK_VIOLATION);
  });
});

describe("RPCs: papel e isolamento", () => {
  it.each(["recepcao-a", "leitura-a", "profissional-a"])(
    "%s recebe 42501 nas duas RPCs",
    async (apelido) => {
      const { error: erroMedico } = await como(apelido).rpc(
        "sincronizar_convenios_do_profissional",
        { p_professional_id: joao, p_convenios: [unimed] },
      );
      expect(erroMedico?.code).toBe(RLS_VIOLATION);
      expect(erroMedico?.message).toBe(
        "Somente administradores e gestores alteram os cadastros.",
      );
      const { error: erroProcedimento } = await como(apelido).rpc(
        "sincronizar_vinculos_do_procedimento",
        { p_procedure_id: endocrino, p_linhas: [], p_planos: [] },
      );
      expect(erroProcedimento?.code).toBe(RLS_VIOLATION);
    },
  );

  it.each(["pendente-a", "admin-b"])(
    "%s nem enxerga o cadastro da A (P0002)",
    async (apelido) => {
      const { error: erroMedico } = await como(apelido).rpc(
        "sincronizar_convenios_do_profissional",
        { p_professional_id: joao, p_convenios: [] },
      );
      expect(erroMedico?.code).toBe(NAO_ENCONTRADO);
      const { error: erroProcedimento } = await como(apelido).rpc(
        "sincronizar_vinculos_do_procedimento",
        { p_procedure_id: endocrino, p_linhas: [], p_planos: [] },
      );
      expect(erroProcedimento?.code).toBe(NAO_ENCONTRADO);
    },
  );

  it("convênio da A na chamada da B dá 23503; o da própria B passa", async () => {
    const { error } = await como("admin-b").rpc(
      "sincronizar_convenios_do_profissional",
      { p_professional_id: profB, p_convenios: [unimed] },
    );
    expect(error?.code).toBe(FK_VIOLATION);
    const { error: erroCobertura } = await como("admin-b").rpc(
      "sincronizar_vinculos_do_procedimento",
      { p_procedure_id: procB, p_linhas: [], p_planos: [unimed] },
    );
    expect(erroCobertura?.code).toBe(FK_VIOLATION);

    const { data, error: erroCerto } = await como("admin-b").rpc(
      "sincronizar_convenios_do_profissional",
      {
        p_professional_id: profB,
        p_convenios: [convenioB],
        p_convenios_na_abertura: [convenioB],
      },
    );
    expect(erroCerto).toBeNull();
    expect(data).toMatchObject({ aplicado: true, entram: [], saem: [] });
  });

  it("nada da A mudou depois das recusas", async () => {
    const { data } = await admin
      .from("professional_insurance")
      .select("id")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect((data ?? []).map((p) => p.id)).toEqual([parDaA]);
    const { data: coberturas } = await admin
      .from("procedure_insurance")
      .select("id")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect((coberturas ?? []).map((c) => c.id)).toEqual([coberturaDaA]);
  });
});
