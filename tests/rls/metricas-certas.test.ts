import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nascerDeMensagem } from "./lead-de-verdade";
import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Metricas certas (migration 20261123100000): o isolamento das funcoes
// novas e do que mudou. passagens_da_ia_do_periodo e security invoker: a
// clinica A nao le as passagens da B (a RLS de ai_decision_log zera), o
// profissional recebe null e anon nao executa. contato_e_lead roda com a
// RLS de contact_consent de quem chama. A decisao de conversa apagada
// (conversation_id nulo) continua so da clinica dela e fora do profissional.
// Escrito em 23/11/2026 com a migration NAO aplicada e NAO rodado: so passa
// depois dela (npm run test:rls -- metricas-certas).

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Metricas!Certas2026";

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
const usuarios: string[] = [];

const JANELA = {
  p_de: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  // Uma hora no futuro: as linhas da fixture nascem depois deste modulo.
  p_ate: new Date(Date.now() + 3_600_000).toISOString(),
};

type Passagens = {
  total: number;
  por_motivo: { camada: string; motivo: string; passagens: number }[];
};

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
  professionalId?: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  usuarios.push(data.user!.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
    .throwOnError();
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

const email = (papel: string) => `certas-${papel}-${sufixo}@teste.dev`;

/** Um lead que nasceu de mensagem, uma conversa e uma passagem da IA. */
async function montarClinica(clinicId: string, telefone: string) {
  const { data: contato } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone })
    .select("id")
    .single()
    .throwOnError();
  await nascerDeMensagem(admin, [clinicId], [contato!.id as string]);
  // Um paciente da Agenda (sem a autorizacao da ingestao): nao e lead.
  await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `${telefone.slice(0, -1)}9`,
      kind: "paciente",
    })
    .throwOnError();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contato!.id,
      whatsapp_account_id: (await criarNumeroDeTeste(admin, clinicId)).id,
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("ai_decision_log")
    .insert([
      {
        clinic_id: clinicId,
        conversation_id: conversa!.id,
        escalation_reason: "pedido_humano",
        desfecho: "escalou",
      },
      // Decisao de uma conversa ja apagada.
      {
        clinic_id: clinicId,
        conversation_id: null,
        escalation_reason: "falha_tecnica",
        desfecho: "falhou",
        motivo_da_falha: "prazo",
      },
    ])
    .throwOnError();
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Certas A ${sufixo}`,
        slug: `certas-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Certas B ${sufixo}`,
        slug: `certas-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `certas-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `certas-b-${sufixo}`)!
    .id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Certa" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;

  await criarUsuario(email("admin-a"), clinicaA, "admin");
  await criarUsuario(email("recepcao-a"), clinicaA, "recepcao");
  await criarUsuario(email("leitura-a"), clinicaA, "leitura");
  await criarUsuario(email("prof-a"), clinicaA, "profissional", profissionalA);
  await criarUsuario(email("gestor-b"), clinicaB, "gestor");

  await montarClinica(
    clinicaA,
    `+558497${sufixo.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}1`,
  );
  await montarClinica(
    clinicaB,
    `+558497${sufixo.replace(/\D/g, "").padEnd(6, "2").slice(0, 6)}2`,
  );
}, 60_000);

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("passagens_da_ia_do_periodo", () => {
  it("admin, recepção e leitura da A veem as passagens da A, inclusive a da conversa apagada", async () => {
    for (const papel of ["admin-a", "recepcao-a", "leitura-a"]) {
      const cliente = await logado(email(papel));
      const { data, error } = await cliente.rpc("passagens_da_ia_do_periodo", {
        p_clinic_id: clinicaA,
        ...JANELA,
      });
      expect(error).toBeNull();
      expect((data as Passagens).total).toBe(2);
    }
  });

  it("a clínica A não lê as passagens da B (a RLS zera); o gestor da B vê as dela", async () => {
    const clienteA = await logado(email("admin-a"));
    const deA = await clienteA.rpc("passagens_da_ia_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(deA.error).toBeNull();
    expect(deA.data).toEqual({ total: 0, por_motivo: [] });

    const clienteB = await logado(email("gestor-b"));
    const deB = await clienteB.rpc("passagens_da_ia_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(deB.error).toBeNull();
    expect((deB.data as Passagens).total).toBe(2);
  });

  it("o profissional recebe null (recorte da clínica), nunca um número parcial", async () => {
    const cliente = await logado(email("prof-a"));
    const { data, error } = await cliente.rpc("passagens_da_ia_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("anon não executa", async () => {
    const { error } = await anonClient().rpc("passagens_da_ia_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(error).not.toBeNull();
  });
});

describe("a decisão sem conversa", () => {
  it("o profissional não lê a decisão de conversa apagada; a B não lê a da A", async () => {
    const prof = await logado(email("prof-a"));
    const doProf = await prof
      .from("ai_decision_log")
      .select("id")
      .eq("clinic_id", clinicaA)
      .is("conversation_id", null);
    expect(doProf.error).toBeNull();
    expect(doProf.data).toEqual([]);

    const gestorB = await logado(email("gestor-b"));
    const daB = await gestorB
      .from("ai_decision_log")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(daB.error).toBeNull();
    expect(daB.data).toEqual([]);

    const adminA = await logado(email("admin-a"));
    const doAdmin = await adminA
      .from("ai_decision_log")
      .select("id")
      .eq("clinic_id", clinicaA)
      .is("conversation_id", null);
    expect(doAdmin.error).toBeNull();
    expect(doAdmin.data).toHaveLength(1);
  });

  it("a sessão não grava decisão (nem sem conversa)", async () => {
    const adminA = await logado(email("admin-a"));
    const { error } = await adminA.from("ai_decision_log").insert({
      clinic_id: clinicaA,
      conversation_id: null,
      escalation_reason: "sintoma",
    });
    expect(error).not.toBeNull();
  });
});

describe("o lead de verdade pela sessão", () => {
  it("cada clínica conta só o seu lead que nasceu de mensagem; a A pedindo a B recebe zero", async () => {
    const clienteA = await logado(email("recepcao-a"));
    const daA = await clienteA.rpc("funil_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(daA.error).toBeNull();
    expect((daA.data as { atual: { leads: number } }).atual.leads).toBe(1);

    const daBpelaA = await clienteA.rpc("funil_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(daBpelaA.error).toBeNull();
    expect((daBpelaA.data as { atual: { leads: number } }).atual.leads).toBe(0);

    const clienteB = await logado(email("gestor-b"));
    const daB = await clienteB.rpc("campanhas_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(daB.error).toBeNull();
    expect((daB.data as { atual: { leads: number } }).atual.leads).toBe(1);
  });
});
