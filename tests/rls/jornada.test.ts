import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "./stack";

// Jornada configuravel (migration 20260909100000): as etapas do funil por
// clinica. As regras aqui nao sao decoracao: a jornada define para onde o
// gatilho da agenda move o lead e qual evento vai para a Meta, entao uma
// clinica ler ou escrever a jornada da outra seria vazamento de estrategia
// comercial e sabotagem de funil. E as protecoes de estrutura (etapa de
// sistema indelevel, chave imutavel) valem por gatilho, nao por tela.

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Jornada!Rls2026";

let clinicaA = "";
let clinicaB = "";

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

const email = (papel: string) => `jornada-${papel}-${sufixo}@teste.dev`;

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Jornada A ${sufixo}`,
        slug: `jornada-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Jornada B ${sufixo}`,
        slug: `jornada-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `jornada-a-${sufixo}`)!
    .id as string;
  clinicaB = clinicas!.find((c) => c.slug === `jornada-b-${sufixo}`)!
    .id as string;

  await Promise.all([
    criarUsuario(email("gestor-a"), clinicaA, "gestor"),
    criarUsuario(email("recepcao-a"), clinicaA, "recepcao"),
    criarUsuario(email("admin-b"), clinicaB, "admin"),
  ]);
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

describe("a jornada nasce com a clínica", () => {
  it("clínica nova já tem as 6 etapas, com os 4 papéis de sistema", async () => {
    const { data } = await admin
      .from("funnel_stage_def")
      .select("chave, papel")
      .eq("clinic_id", clinicaA)
      .order("posicao");
    expect(data).toHaveLength(6);
    expect(data!.map((e) => e.chave)).toEqual([
      "novo",
      "em_contato",
      "aguardando_resposta",
      "agendou",
      "compareceu",
      "perdido",
    ]);
    expect(data!.map((e) => e.papel)).toEqual([
      "entrada",
      null,
      null,
      "agendou",
      "compareceu",
      "perdido",
    ]);
  });
});

describe("isolamento entre clínicas", () => {
  it("membro lê a própria jornada; a da outra clínica volta vazia", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { data: minha } = await cliente
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaA);
    expect(minha).toHaveLength(6);

    const { data: alheia, error } = await cliente
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaB);
    expect(error).toBeNull();
    expect(alheia).toHaveLength(0);
    // Contraprova anti falso-positivo.
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("chave")
      .eq("clinic_id", clinicaB);
    expect(prova).toHaveLength(6);
  });

  it("gestor de A não cria etapa em B", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente.from("funnel_stage_def").insert({
      clinic_id: clinicaB,
      chave: "invasao",
      nome: "Invasão",
      posicao: 99,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe("quem escreve", () => {
  it("recepção não cria nem edita etapa", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { error: erroInsert } = await cliente
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicaA,
        chave: "tentativa",
        nome: "Tentativa",
        posicao: 70,
      });
    expect(erroInsert?.code).toBe(RLS_VIOLATION);

    const { error: erroUpdate } = await cliente
      .from("funnel_stage_def")
      .update({ nome: "Renomeada" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo");
    // Update barrado afeta zero linhas sem erro; a contraprova é o nome intacto.
    expect(erroUpdate).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("nome")
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo")
      .single();
    expect(prova!.nome).toBe("Novo");
  });

  it("gestor cria etapa livre, renomeia etapa de sistema, e o nome muda de verdade", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error: erroInsert } = await cliente
      .from("funnel_stage_def")
      .insert({
        clinic_id: clinicaA,
        chave: "comprou_pacote",
        nome: "Comprou pacote",
        posicao: 55,
        tom: "success",
        icone: "package",
      });
    expect(erroInsert).toBeNull();

    const { error: erroRenome } = await cliente
      .from("funnel_stage_def")
      .update({ nome: "Chegou agora" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo");
    expect(erroRenome).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("nome")
      .eq("clinic_id", clinicaA)
      .eq("chave", "novo")
      .single();
    expect(prova!.nome).toBe("Chegou agora");
  });
});

// A conversao da Meta mora NA etapa (fase 3 absorveu a funnel_conversion_map;
// estas provas vieram do teste daquela tabela junto com as colunas).
describe("a conversão da etapa", () => {
  it("gestor configura o evento com valor fixo, e persiste", async () => {
    const cliente = await logado(email("gestor-a"));
    const { error } = await cliente
      .from("funnel_stage_def")
      .update({
        meta_event_name: "Purchase",
        is_sale: true,
        value_source: "fixo",
        value_cents: 25_000,
      })
      .eq("clinic_id", clinicaA)
      .eq("chave", "compareceu");
    expect(error).toBeNull();
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("meta_event_name, is_sale, value_cents")
      .eq("clinic_id", clinicaA)
      .eq("chave", "compareceu")
      .single();
    expect(prova).toEqual({
      meta_event_name: "Purchase",
      is_sale: true,
      value_cents: 25_000,
    });
  });

  it("recepção não configura conversão", async () => {
    const cliente = await logado(email("recepcao-a"));
    const { error } = await cliente
      .from("funnel_stage_def")
      .update({ meta_event_name: "Lead" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou");
    expect(error).toBeNull(); // zero linhas afetadas, sem erro
    const { data: prova } = await admin
      .from("funnel_stage_def")
      .select("meta_event_name")
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou")
      .single();
    expect(prova!.meta_event_name).toBeNull();
  });

  it("a etapa de perda não vira conversão (check do banco)", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ meta_event_name: "Purchase" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "perdido");
    expect(error?.code).toBe("23514");
  });

  it("valor fixo exige o valor em centavos (check do banco)", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ value_source: "fixo", value_cents: null })
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou");
    expect(error?.code).toBe("23514");
  });
});

describe("as travas de estrutura (por gatilho, valem até para o service role)", () => {
  it("a chave de uma etapa não muda", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ chave: "outra_chave" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "em_contato");
    expect(error?.message).toContain("chave de uma etapa não muda");
  });

  it("o papel de sistema não muda", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .update({ papel: null })
      .eq("clinic_id", clinicaA)
      .eq("chave", "agendou");
    expect(error?.message).toContain("papel de sistema");
  });

  it("etapa de sistema não pode ser excluída", async () => {
    const { error } = await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "perdido");
    expect(error?.message).toContain("Etapa de sistema");
  });

  it("etapa livre com contato dentro não pode ser excluída", async () => {
    await admin
      .from("contact")
      .insert({
        clinic_id: clinicaA,
        phone_e164: `+5511${Date.now() % 100000000}`,
        funnel_stage: "comprou_pacote",
      })
      .throwOnError();
    const { error } = await admin
      .from("funnel_stage_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "comprou_pacote");
    expect(error?.message).toContain("Mova os contatos");
  });

  it("contato não entra em etapa que não existe na jornada", async () => {
    const { error } = await admin.from("contact").insert({
      clinic_id: clinicaA,
      phone_e164: `+5511${(Date.now() + 7) % 100000000}`,
      funnel_stage: "etapa_fantasma",
    });
    expect(error?.code).toBe("23514");
  });
});
