import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Migration 20260925110000_codigo_da_clinica_e_clinica, contra o banco real:
// - o gestor le e gira o codigo da PROPRIA clinica (decisao do dono de
//   24/09/2026), nunca o de outra; recepcao continua sem ler;
// - a entrada por codigo liga e desliga pela RPC definir_entrada_por_codigo,
//   que confere admin ou gestor e nao abre o UPDATE de clinic: nome e fuso
//   continuam so do administrador;
// - conta_por_email (convite de conta que ja existe) so roda com service
//   role: sessao de usuario nao descobre quem tem conta;
// - o vinculo usuario -> profissional da agenda (Configuracoes > Equipe) so
//   aceita profissional da mesma clinica (gatilho da leva 1) e so quem
//   gerencia a equipe grava.
//
// Sufixo FIXO, pelo mesmo motivo de equipe.test.ts: exigir_admin_ativo pode
// recusar o cascade de apagar a clinica, e sufixo aleatorio deixaria uma
// clinica presa por execucao. O estado e restaurado no comeco e no fim.

const SUFIXO = "fixo";
const SENHA = "Rls-codigo-fixo!1";
const SLUG_A = `rls-codigo-${SUFIXO}`;
const SLUG_B = `rls-codigo-vizinha-${SUFIXO}`;
const NOME_A = "Clínica Código RLS";
const FUSO_A = "America/Fortaleza";

const admin = adminClient();

type Chave = "adminA" | "gestorA" | "recepcaoA" | "profissionalA" | "gestorB";
type Pessoa = { user: User; client: SupabaseClient };

const EQUIPE: {
  chave: Chave;
  nome: string;
  clinica: "A" | "B";
  papel: string;
}[] = [
  { chave: "adminA", nome: "Ada Administradora", clinica: "A", papel: "admin" },
  { chave: "gestorA", nome: "Gil Gestor", clinica: "A", papel: "gestor" },
  {
    chave: "recepcaoA",
    nome: "Rosa Recepção",
    clinica: "A",
    papel: "recepcao",
  },
  {
    chave: "profissionalA",
    nome: "Dra. Paula Profissional",
    clinica: "A",
    papel: "profissional",
  },
  {
    chave: "gestorB",
    nome: "Beto Gestor Vizinho",
    clinica: "B",
    papel: "gestor",
  },
];

const pessoas = {} as Record<Chave, Pessoa>;
let clinicaA: string;
let clinicaB: string;
let profissionalDaClinicaA: string;
let profissionalDaClinicaB: string;

function endereco(chave: Chave): string {
  return `rls-codigo-${chave.toLowerCase()}-${SUFIXO}@teste.dev`;
}

function idDe(chave: Chave): string {
  return pessoas[chave].user.id;
}

// listUsers nao filtra por e-mail, entao pagina ate achar (mesmo molde de
// equipe.test.ts).
async function localizarUsuario(email: string): Promise<User | null> {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    const achado = usuarios.find((u) => u.email?.toLowerCase() === email);
    if (achado) {
      return achado;
    }
    if (usuarios.length < 200) {
      return null;
    }
  }
  return null;
}

async function garantirUsuario(chave: Chave, nome: string): Promise<User> {
  const email = endereco(chave);
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: nome },
  });
  if (data?.user) {
    return data.user;
  }
  const existente = await localizarUsuario(email);
  if (!existente) {
    throw new Error(`Não foi possível criar nem localizar ${email}`);
  }
  await admin.auth.admin.updateUserById(existente.id, {
    password: SENHA,
    user_metadata: { name: nome },
  });
  return existente;
}

async function entrar(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`Falha no login de ${email}: ${error.message}`);
  }
  return client;
}

async function garantirClinica(slug: string, nome: string): Promise<string> {
  const { data: existente } = await admin
    .from("clinic")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existente) {
    return existente.id as string;
  }
  const { data, error } = await admin
    .from("clinic")
    .insert({ name: nome, slug, e_de_teste: true })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao criar a clínica ${slug}: ${error?.message}`);
  }
  await admin.from("clinic_branding").insert({ clinic_id: data.id });
  return data.id as string;
}

async function garantirProfissional(
  clinicId: string,
  nome: string,
): Promise<string> {
  const { data: existente } = await admin
    .from("professional")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("name", nome)
    .maybeSingle();
  if (existente) {
    return existente.id as string;
  }
  const { data } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: nome })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

// Estado inicial: vinculos ativos com o papel da lista, sem profissional
// ligado; clinica A com o nome e o fuso originais e a entrada desligada.
// Service role nao dispara os gatilhos de papel (auth.uid() nulo).
async function restaurar(): Promise<void> {
  for (const { chave, clinica, papel } of EQUIPE) {
    await admin.from("clinic_member").upsert({
      clinic_id: clinica === "A" ? clinicaA : clinicaB,
      user_id: idDe(chave),
      role: papel,
      status: "ativo",
      professional_id: null,
    });
  }
  await admin
    .from("clinic")
    .update({ name: NOME_A, timezone: FUSO_A, allow_code_signup: false })
    .eq("id", clinicaA);
  await admin
    .from("clinic")
    .update({ allow_code_signup: false })
    .eq("id", clinicaB);
}

beforeAll(async () => {
  clinicaA = await garantirClinica(SLUG_A, NOME_A);
  clinicaB = await garantirClinica(SLUG_B, "Clínica Vizinha Código RLS");
  profissionalDaClinicaA = await garantirProfissional(
    clinicaA,
    "Dra. Paula da Agenda",
  );
  profissionalDaClinicaB = await garantirProfissional(
    clinicaB,
    "Dr. Bruno da Vizinha",
  );

  for (const { chave, nome } of EQUIPE) {
    pessoas[chave] = {
      user: await garantirUsuario(chave, nome),
      client: anonClient(),
    };
  }
  await restaurar();
  for (const { chave } of EQUIPE) {
    pessoas[chave].client = await entrar(endereco(chave));
  }
});

afterAll(async () => {
  if (!clinicaA) {
    return;
  }
  await restaurar();
  // Best effort, como em equipe.test.ts: se o cascade for recusado, a
  // clinica fica para a proxima execucao.
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  const { data: sobrou } = await admin
    .from("clinic")
    .select("id")
    .in("id", [clinicaA, clinicaB]);
  if ((sobrou ?? []).length === 0) {
    for (const { chave } of EQUIPE) {
      await admin.auth.admin.deleteUser(idDe(chave));
    }
  }
});

async function codigoDe(clinicId: string): Promise<string | null> {
  const { data } = await admin
    .from("clinic_access_code")
    .select("code")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return (data?.code as string | undefined) ?? null;
}

async function entradaPorCodigo(clinicId: string): Promise<boolean | null> {
  const { data } = await admin
    .from("clinic")
    .select("allow_code_signup")
    .eq("id", clinicId)
    .maybeSingle();
  return (data?.allow_code_signup as boolean | undefined) ?? null;
}

describe("código da clínica: o gestor gerencia o da própria clínica", () => {
  it("anti falso-positivo: as duas clínicas têm código", async () => {
    expect(await codigoDe(clinicaA)).not.toBeNull();
    expect(await codigoDe(clinicaB)).not.toBeNull();
  });

  it("gestor lê o código da própria clínica", async () => {
    const { data, error } = await pessoas.gestorA.client
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.code).toBe(await codigoDe(clinicaA));
  });

  it("gestor gira o código da própria clínica", async () => {
    const antes = await codigoDe(clinicaA);
    const novo = `RLSGESTOR${Date.now().toString(36).toUpperCase()}`.slice(
      0,
      16,
    );
    const { data, error } = await pessoas.gestorA.client
      .from("clinic_access_code")
      .update({ code: novo })
      .eq("clinic_id", clinicaA)
      .select("clinic_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const depois = await codigoDe(clinicaA);
    expect(depois).toBe(novo);
    expect(depois).not.toBe(antes);
  });

  it("gestor não lê nem gira o código de outra clínica", async () => {
    const antes = await codigoDe(clinicaB);
    const leitura = await pessoas.gestorA.client
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", clinicaB);
    expect(leitura.data ?? []).toHaveLength(0);

    const escrita = await pessoas.gestorA.client
      .from("clinic_access_code")
      .update({ code: "INVASOR0001" })
      .eq("clinic_id", clinicaB)
      .select("clinic_id");
    expect(escrita.data ?? []).toHaveLength(0);
    expect(await codigoDe(clinicaB)).toBe(antes);
  });

  it("recepção não lê o código (0 linhas)", async () => {
    const { data } = await pessoas.recepcaoA.client
      .from("clinic_access_code")
      .select("code")
      .eq("clinic_id", clinicaA);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("entrada por código pela RPC definir_entrada_por_codigo", () => {
  it("gestor liga e desliga a entrada da própria clínica", async () => {
    const ligar = await pessoas.gestorA.client.rpc(
      "definir_entrada_por_codigo",
      { p_clinic_id: clinicaA, p_ativo: true },
    );
    expect(ligar.error).toBeNull();
    expect(ligar.data).toBe(true);
    expect(await entradaPorCodigo(clinicaA)).toBe(true);

    const desligar = await pessoas.gestorA.client.rpc(
      "definir_entrada_por_codigo",
      { p_clinic_id: clinicaA, p_ativo: false },
    );
    expect(desligar.error).toBeNull();
    expect(desligar.data).toBe(false);
    expect(await entradaPorCodigo(clinicaA)).toBe(false);
  });

  it("gestor de outra clínica é recusado e nada muda aqui", async () => {
    const { error } = await pessoas.gestorB.client.rpc(
      "definir_entrada_por_codigo",
      { p_clinic_id: clinicaA, p_ativo: true },
    );
    expect(error?.code).toBe("42501");
    expect(await entradaPorCodigo(clinicaA)).toBe(false);
  });

  it("recepção é recusada", async () => {
    const { error } = await pessoas.recepcaoA.client.rpc(
      "definir_entrada_por_codigo",
      { p_clinic_id: clinicaA, p_ativo: true },
    );
    expect(error?.code).toBe("42501");
    expect(await entradaPorCodigo(clinicaA)).toBe(false);
  });

  it("sem sessão não executa", async () => {
    const { error } = await anonClient().rpc("definir_entrada_por_codigo", {
      p_clinic_id: clinicaA,
      p_ativo: true,
    });
    expect(error).not.toBeNull();
    expect(await entradaPorCodigo(clinicaA)).toBe(false);
  });
});

describe("nome e fuso da clínica continuam só do administrador", () => {
  it("gestor não altera nome nem fuso (0 linhas)", async () => {
    const { data } = await pessoas.gestorA.client
      .from("clinic")
      .update({ name: "Nome do Gestor", timezone: "America/Manaus" })
      .eq("id", clinicaA)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    const { data: clinica } = await admin
      .from("clinic")
      .select("name, timezone")
      .eq("id", clinicaA)
      .single();
    expect(clinica).toMatchObject({ name: NOME_A, timezone: FUSO_A });
  });

  it("administrador altera nome e fuso da própria clínica", async () => {
    const { data, error } = await pessoas.adminA.client
      .from("clinic")
      .update({ name: "Clínica Código Renomeada", timezone: "America/Cuiaba" })
      .eq("id", clinicaA)
      .select("name, timezone");
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      name: "Clínica Código Renomeada",
      timezone: "America/Cuiaba",
    });
    await admin
      .from("clinic")
      .update({ name: NOME_A, timezone: FUSO_A })
      .eq("id", clinicaA);
  });

  it("administrador daqui não altera a clínica vizinha", async () => {
    const { data } = await pessoas.adminA.client
      .from("clinic")
      .update({ name: "Invadida" })
      .eq("id", clinicaB)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("conta_por_email só roda no servidor", () => {
  it("sessão de usuário não executa (nem gestor)", async () => {
    const { data, error } = await pessoas.gestorA.client.rpc(
      "conta_por_email",
      { p_email: endereco("recepcaoA") },
    );
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("sem sessão não executa", async () => {
    const { error } = await anonClient().rpc("conta_por_email", {
      p_email: endereco("recepcaoA"),
    });
    expect(error).not.toBeNull();
  });

  it("o service role acha a conta confirmada, sem ligar para maiúscula e espaço", async () => {
    const { data, error } = await admin.rpc("conta_por_email", {
      p_email: `  ${endereco("recepcaoA").toUpperCase()} `,
    });
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: idDe("recepcaoA"), confirmada: true }]);
  });

  it("e-mail sem conta volta vazio", async () => {
    const { data, error } = await admin.rpc("conta_por_email", {
      p_email: `ninguem-${SUFIXO}-${Date.now()}@teste.dev`,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("vínculo do usuário Profissional com o profissional da agenda", () => {
  async function vinculoDoProfissional(): Promise<string | null> {
    const { data } = await admin
      .from("clinic_member")
      .select("professional_id")
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("profissionalA"))
      .single();
    return (data?.professional_id as string | null) ?? null;
  }

  it("gestor liga o usuário ao profissional da própria clínica", async () => {
    const { data, error } = await pessoas.gestorA.client
      .from("clinic_member")
      .update({ professional_id: profissionalDaClinicaA })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("profissionalA"))
      .select("professional_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await vinculoDoProfissional()).toBe(profissionalDaClinicaA);

    await admin
      .from("clinic_member")
      .update({ professional_id: null })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("profissionalA"));
  });

  it("profissional de outra clínica é recusado pelo banco", async () => {
    const { error } = await pessoas.gestorA.client
      .from("clinic_member")
      .update({ professional_id: profissionalDaClinicaB })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("profissionalA"))
      .select("professional_id");
    expect(error?.message).toContain(
      "O profissional informado não pertence a esta clínica.",
    );
    expect(await vinculoDoProfissional()).toBeNull();
  });

  it("recepção não liga ninguém (0 linhas)", async () => {
    const { data } = await pessoas.recepcaoA.client
      .from("clinic_member")
      .update({ professional_id: profissionalDaClinicaA })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("profissionalA"))
      .select("professional_id");
    expect(data ?? []).toHaveLength(0);
    expect(await vinculoDoProfissional()).toBeNull();
  });

  it("o próprio profissional não se liga a um cadastro (0 linhas)", async () => {
    const { data } = await pessoas.profissionalA.client
      .from("clinic_member")
      .update({ professional_id: profissionalDaClinicaA })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("profissionalA"))
      .select("professional_id");
    expect(data ?? []).toHaveLength(0);
    expect(await vinculoDoProfissional()).toBeNull();
  });
});
