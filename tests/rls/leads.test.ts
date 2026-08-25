import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Fase 4, tarefas 4.1 e 4.2: RLS de pacotes, campanhas e etiquetas.
// Matriz: membro ativo LE package_balance e campaign_link da propria clinica;
// venda de pacote e de quem escreve (leitura NAO escreve dado de paciente);
// campanha so e gerida por admin e gestor; etiquetar_contatos e security
// invoker, entao a RLS de contact decide. Padrao da suite: select barrado por
// RLS retorna VAZIO, nao erro; toda negacao tem verificacao anti
// falso-positivo via service role.

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Leads!Rls2026";

let clinicaA = "";
let clinicaB = "";
let contatoA = "";
let contatoB = "";
let pacoteA = "";
let saldoA = "";
let campanhaA = "";

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

// Procedimento + pacote + contato + saldo, por clinica.
async function semearClinica(
  clinicId: string,
  telefone: string,
  tags: string[],
): Promise<{ contatoId: string; pacoteId: string; saldoId: string }> {
  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Limpeza de pele" })
    .select("id")
    .single()
    .throwOnError();
  const { data: pacote } = await admin
    .from("package")
    .insert({
      clinic_id: clinicId,
      procedure_id: proc!.id,
      sessions: 10,
      price_cents: 90000,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Leads",
      tags,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: saldo } = await admin
    .from("package_balance")
    .insert({
      clinic_id: clinicId,
      contact_id: contato!.id,
      package_id: pacote!.id,
      sessions_total: 10,
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    contatoId: contato!.id as string,
    pacoteId: pacote!.id as string,
    saldoId: saldo!.id as string,
  };
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Leads A ${sufixo}`, slug: `leads-a-${sufixo}` },
      { name: `Leads B ${sufixo}`, slug: `leads-b-${sufixo}` },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug.startsWith("leads-a"))!.id as string;
  clinicaB = clinicas!.find((c) => c.slug.startsWith("leads-b"))!.id as string;

  await criarUsuario(`leads-gestor-${sufixo}@teste.dev`, clinicaA, "gestor");
  await criarUsuario(
    `leads-recepcao-${sufixo}@teste.dev`,
    clinicaA,
    "recepcao",
  );
  await criarUsuario(`leads-leitura-${sufixo}@teste.dev`, clinicaA, "leitura");
  await criarUsuario(
    `leads-profissional-${sufixo}@teste.dev`,
    clinicaA,
    "profissional",
  );
  await criarUsuario(`leads-gestor-b-${sufixo}@teste.dev`, clinicaB, "gestor");

  const seedA = await semearClinica(clinicaA, "+5584970000001", []);
  contatoA = seedA.contatoId;
  pacoteA = seedA.pacoteId;
  saldoA = seedA.saldoId;
  const seedB = await semearClinica(clinicaB, "+5584970000002", ["importado"]);
  contatoB = seedB.contatoId;

  const { data: campanhas } = await admin
    .from("campaign_link")
    .insert([
      {
        clinic_id: clinicaA,
        name: "Campanha A",
        token: "B4TQX7",
        channel: "trafego_pago",
        campaign: "Campanha A",
      },
      {
        clinic_id: clinicaB,
        name: "Campanha B",
        token: "C7K3F9",
        channel: "redes_sociais",
        campaign: "Campanha B",
      },
    ])
    .select("id, clinic_id")
    .throwOnError();
  campanhaA = campanhas!.find((c) => c.clinic_id === clinicaA)!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicaA);
  await admin.from("clinic").delete().eq("id", clinicaB);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const usuario of data?.users ?? []) {
    if (
      (usuario.email ?? "").startsWith("leads-") &&
      usuario.email?.includes(sufixo)
    ) {
      await admin.auth.admin.deleteUser(usuario.id);
    }
  }
});

describe("package_balance", () => {
  it("gestor lê o saldo da própria clínica e NADA da outra", async () => {
    const gestor = await logado(`leads-gestor-${sufixo}@teste.dev`);
    const { data: daPropria } = await gestor
      .from("package_balance")
      .select("id, sessions_total, sessions_used")
      .eq("clinic_id", clinicaA);
    expect(daPropria).toHaveLength(1);

    const { data: daOutra } = await gestor
      .from("package_balance")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(daOutra).toHaveLength(0);

    // Anti falso-positivo: o saldo da B existe.
    const { data: existe } = await admin
      .from("package_balance")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(existe).toHaveLength(1);
  });

  it("recepção registra venda de pacote", async () => {
    const recepcao = await logado(`leads-recepcao-${sufixo}@teste.dev`);
    const { error } = await recepcao.from("package_balance").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacoteA,
      sessions_total: 5,
    });
    expect(error).toBeNull();
  });

  it("leitura NÃO registra venda: insert barrado com 42501", async () => {
    const { count: antes } = await admin
      .from("package_balance")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);

    const leitura = await logado(`leads-leitura-${sufixo}@teste.dev`);
    const { error } = await leitura.from("package_balance").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacoteA,
      sessions_total: 3,
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    const { count: depois } = await admin
      .from("package_balance")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);
    expect(depois).toBe(antes);
  });

  it("profissional NÃO registra venda: matriz diz que ele só vê (regressão da revisão)", async () => {
    const profissional = await logado(`leads-profissional-${sufixo}@teste.dev`);
    const { error } = await profissional.from("package_balance").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacoteA,
      sessions_total: 3,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("gestor da B não lê nem escreve saldo na A", async () => {
    const outra = await logado(`leads-gestor-b-${sufixo}@teste.dev`);
    const { data: nada } = await outra
      .from("package_balance")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(nada).toHaveLength(0);

    const { error: erroInsert } = await outra.from("package_balance").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      package_id: pacoteA,
      sessions_total: 1,
    });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    // Update barrado por RLS afeta zero linhas e o dado fica intacto.
    const { data: alteradas } = await outra
      .from("package_balance")
      .update({ sessions_used: 9 })
      .eq("id", saldoA)
      .select("id");
    expect(alteradas ?? []).toHaveLength(0);
    const { data: intacto } = await admin
      .from("package_balance")
      .select("sessions_used")
      .eq("id", saldoA)
      .single();
    expect(intacto?.sessions_used).toBe(0);
  });
});

describe("campaign_link", () => {
  it("membro ativo lê campanhas, até o papel leitura", async () => {
    const leitura = await logado(`leads-leitura-${sufixo}@teste.dev`);
    const { data } = await leitura
      .from("campaign_link")
      .select("id, name, token, channel")
      .eq("clinic_id", clinicaA);
    expect(data).toHaveLength(1);
  });

  it("recepção NÃO cria campanha: insert barrado com 42501", async () => {
    const recepcao = await logado(`leads-recepcao-${sufixo}@teste.dev`);
    const { error } = await recepcao.from("campaign_link").insert({
      clinic_id: clinicaA,
      name: "Nao deveria entrar",
      channel: "offline",
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("gestor cria e edita campanha", async () => {
    const gestor = await logado(`leads-gestor-${sufixo}@teste.dev`);
    const { error: erroInsert } = await gestor.from("campaign_link").insert({
      clinic_id: clinicaA,
      name: "Campanha do Gestor",
      token: "D8M4G2",
      channel: "indicacao",
    });
    expect(erroInsert).toBeNull();

    const { data: alteradas, error: erroUpdate } = await gestor
      .from("campaign_link")
      .update({ active: false })
      .eq("id", campanhaA)
      .select("id");
    expect(erroUpdate).toBeNull();
    expect(alteradas).toHaveLength(1);
  });

  it("clínica B isolada: não lê nem escreve campanha da A", async () => {
    const outra = await logado(`leads-gestor-b-${sufixo}@teste.dev`);
    const { data: nada } = await outra
      .from("campaign_link")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(nada).toHaveLength(0);

    // Anti falso-positivo: as campanhas da A existem.
    const { data: existe } = await admin
      .from("campaign_link")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect((existe ?? []).length).toBeGreaterThanOrEqual(1);

    const { error: erroInsert } = await outra.from("campaign_link").insert({
      clinic_id: clinicaA,
      name: "Invasao",
      channel: "direto",
    });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    const { data: alteradas } = await outra
      .from("campaign_link")
      .update({ name: "Sequestrada" })
      .eq("id", campanhaA)
      .select("id");
    expect(alteradas ?? []).toHaveLength(0);
  });
});

describe("etiquetar_contatos (security invoker: a RLS de contact manda)", () => {
  it("membro da A etiqueta na própria clínica, mas contato da B fica intocado", async () => {
    const gestor = await logado(`leads-gestor-${sufixo}@teste.dev`);

    // Positivo (anti falso-positivo da negacao logo abaixo): a RPC funciona.
    const { data: naPropria, error: erroProprio } = await gestor.rpc(
      "etiquetar_contatos",
      {
        p_clinic_id: clinicaA,
        p_contact_ids: [contatoA],
        p_adicionar: ["vip"],
        p_remover: [],
      },
    );
    expect(erroProprio).toBeNull();
    expect(naPropria).toBe(1);
    const { data: contatoDaA } = await admin
      .from("contact")
      .select("tags")
      .eq("id", contatoA)
      .single();
    expect(contatoDaA?.tags).toContain("vip");

    // Ataque: mesmo JWT, contato da B. Zero alterados.
    const { data: naOutra, error: erroOutra } = await gestor.rpc(
      "etiquetar_contatos",
      {
        p_clinic_id: clinicaB,
        p_contact_ids: [contatoB],
        p_adicionar: ["vip"],
        p_remover: ["importado"],
      },
    );
    expect(erroOutra).toBeNull();
    expect(naOutra).toBe(0);

    // A tag da B nao mudou (verificacao via service role).
    const { data: contatoDaB } = await admin
      .from("contact")
      .select("tags")
      .eq("id", contatoB)
      .single();
    expect(contatoDaB?.tags).toEqual(["importado"]);
  });
});

// Regressao do achado ALTO da revisao de 25/08/2026 (migration
// 20260825220000): as policies de escrita de contact e contact_consent usavam
// user_can_write, que inclui o papel profissional. A tela recusava, o PostgREST
// aceitava, e um profissional com o proprio token devolvia a autorizacao a quem
// tinha pedido descadastro e editava a ficha de qualquer paciente da clinica.
describe("escrita de dado de paciente por papel", () => {
  // O paciente PEDIU descadastro: e esse o estado que o vetor desfazia.
  beforeAll(async () => {
    await admin
      .from("contact_consent")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA,
        channel: "whatsapp",
        source: "recepcao",
        revoked_at: new Date().toISOString(),
        evidence: "Pediu descadastro pelo WhatsApp",
      })
      .throwOnError();
  });

  async function vigente(): Promise<boolean> {
    const { data } = await admin
      .rpc("consentimento_vigente", {
        p_clinic_id: clinicaA,
        p_contact_id: contatoA,
        p_channel: "whatsapp",
      })
      .throwOnError();
    return data as boolean;
  }

  it("profissional NÃO registra consentimento: 42501 e o descadastro fica de pé", async () => {
    expect(await vigente()).toBe(false);

    const profissional = await logado(`leads-profissional-${sufixo}@teste.dev`);
    const { error } = await profissional.from("contact_consent").insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      channel: "whatsapp",
      source: "recepcao",
      evidence: "Disse que pode mandar",
    });
    expect(error?.code).toBe(RLS_VIOLATION);

    // O que importa nao e o erro, e o estado: o paciente continua descadastrado.
    expect(await vigente()).toBe(false);
  });

  it("profissional NÃO edita a ficha: nome, CPF e observações ficam como estavam", async () => {
    const { data: antes } = await admin
      .from("contact")
      .select("name, cpf, notes")
      .eq("id", contatoA)
      .single()
      .throwOnError();

    const profissional = await logado(`leads-profissional-${sufixo}@teste.dev`);
    const { data: alteradas, error } = await profissional
      .from("contact")
      .update({
        name: "Nome Trocado",
        cpf: "00000000191",
        notes: "Observação de quem não pode editar",
      })
      .eq("id", contatoA)
      .select("id");
    // Update barrado pela clausula USING afeta zero linhas e nao levanta erro.
    if (error) {
      expect(error.code).toBe(RLS_VIOLATION);
    } else {
      expect(alteradas ?? []).toHaveLength(0);
    }

    const { data: depois } = await admin
      .from("contact")
      .select("name, cpf, notes")
      .eq("id", contatoA)
      .single()
      .throwOnError();
    expect(depois).toEqual(antes);
  });

  it("profissional AINDA cria paciente: o INSERT é ato de agenda, não de cadastro", async () => {
    const profissional = await logado(`leads-profissional-${sufixo}@teste.dev`);
    const { data: criado, error } = await profissional
      .from("contact")
      .insert({
        clinic_id: clinicaA,
        phone_e164: "+5584970000003",
        name: "Paciente do Profissional",
        kind: "paciente",
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const { data: gravado } = await admin
      .from("contact")
      .select("name")
      .eq("id", criado!.id)
      .single()
      .throwOnError();
    expect(gravado?.name).toBe("Paciente do Profissional");
  });

  it("recepção AINDA registra consentimento e edita a ficha", async () => {
    const recepcao = await logado(`leads-recepcao-${sufixo}@teste.dev`);
    const { error: erroConsent } = await recepcao
      .from("contact_consent")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA,
        channel: "whatsapp",
        source: "recepcao",
        evidence: "Autorizou de novo na recepção, por escrito",
      });
    expect(erroConsent).toBeNull();
    expect(await vigente()).toBe(true);

    const { data: alteradas, error: erroUpdate } = await recepcao
      .from("contact")
      .update({ notes: "Prefere horário pela manhã" })
      .eq("id", contatoA)
      .select("id");
    expect(erroUpdate).toBeNull();
    expect(alteradas).toHaveLength(1);

    const { data: gravado } = await admin
      .from("contact")
      .select("notes")
      .eq("id", contatoA)
      .single()
      .throwOnError();
    expect(gravado?.notes).toBe("Prefere horário pela manhã");
  });
});
