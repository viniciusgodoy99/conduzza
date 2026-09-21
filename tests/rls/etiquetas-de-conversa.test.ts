import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Etiquetas de conversa (migration 20260921100000). O que esta em jogo: o
// catalogo e vocabulario da clinica (vazamento entre clinicas seria
// estrategia de atendimento alheia), e a decisao do dono de 21/09/2026 e
// que ADMIN E GESTOR criam e RECEPCAO APLICA: isso nao e uma regra de tela,
// tem que ser do banco. A invariante central e "toda chave em
// conversation.tags existe no catalogo da clinica", e ela e o que permite o
// chip ser desenhado e a proxima edicao passar.

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Etiquetas!Rls2026";

let clinicaA = "";
let clinicaB = "";
let contatoA = "";
let conversaA = "";
let conversaDeOutro = "";
let profissionalUserId = "";
const usuarios: string[] = [];

async function criarPessoa(
  apelido: string,
  papel: string,
  clinicId: string,
): Promise<{ id: string; client: SupabaseClient }> {
  // O apelido entra no e-mail, nao o papel: "gestor" existe na clinica A e na
  // B, e o e-mail e unico no GoTrue.
  const email = `etiq-${apelido}-${sufixo}@teste.dev`;
  const { data, error: erroCriar } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
  });
  if (erroCriar || !data.user) {
    throw new Error(`criar ${email}: ${erroCriar?.message ?? "sem usuário"}`);
  }
  const id = data.user.id;
  usuarios.push(id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: id, role: papel, status: "ativo" })
    .throwOnError();
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return { id, client };
}

let gestorA: SupabaseClient;
let recepcaoA: SupabaseClient;
let leituraA: SupabaseClient;
let profissionalA: SupabaseClient;
let gestorB: SupabaseClient;

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Etiq A ${sufixo}`, slug: `etiq-a-${sufixo}`, e_de_teste: true },
      { name: `Etiq B ${sufixo}`, slug: `etiq-b-${sufixo}`, e_de_teste: true },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `etiq-a-${sufixo}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `etiq-b-${sufixo}`)!.id as string;

  gestorA = (await criarPessoa("gestor-a", "gestor", clinicaA)).client;
  recepcaoA = (await criarPessoa("recepcao-a", "recepcao", clinicaA)).client;
  leituraA = (await criarPessoa("leitura-a", "leitura", clinicaA)).client;
  const prof = await criarPessoa("prof-a", "profissional", clinicaA);
  profissionalA = prof.client;
  profissionalUserId = prof.id;
  gestorB = (await criarPessoa("gestor-b", "gestor", clinicaB)).client;

  // DOIS contatos: o indice conversation_aberta_por_contato so permite uma
  // conversa nao resolvida por contato, e o teste precisa de duas abertas
  // (uma do profissional, outra de outro atendente).
  const { data: contatos } = await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicaA,
        phone_e164: `+55849${sufixo.slice(0, 6)}1`,
        name: "Paciente Etiqueta",
      },
      {
        clinic_id: clinicaA,
        phone_e164: `+55849${sufixo.slice(0, 6)}3`,
        name: "Paciente do Colega",
      },
    ])
    .select("id, phone_e164")
    .throwOnError();
  contatoA = contatos!.find((c) =>
    (c.phone_e164 as string).endsWith("1"),
  )!.id as string;
  const contatoDoColega = contatos!.find((c) =>
    (c.phone_e164 as string).endsWith("3"),
  )!.id as string;

  // Uma linha por insert: em insert de multiplas linhas o PostgREST alinha as
  // colunas e a chave omitida vira NULL, nao o default da coluna.
  const { data: minha } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      status: "em_atendimento",
      assignee_user_id: profissionalUserId,
    })
    .select("id")
    .single()
    .throwOnError();
  conversaA = minha!.id as string;

  const { data: doColega } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoDoColega,
      status: "em_atendimento",
      assignee_user_id: usuarios[0],
    })
    .select("id")
    .single()
    .throwOnError();
  conversaDeOutro = doColega!.id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("o catálogo nasce com a clínica", () => {
  it("clínica nova já tem as 4 etiquetas padrão", async () => {
    const { data } = await admin
      .from("conversation_tag_def")
      .select("chave, tom")
      .eq("clinic_id", clinicaA)
      .order("chave");
    expect(data?.map((t) => t.chave)).toEqual([
      "aguardando_convenio",
      "aguardando_paciente",
      "orcamento_enviado",
      "urgente",
    ]);
    expect(data?.find((t) => t.chave === "urgente")?.tom).toBe("alert");
  });
});

describe("isolamento entre clínicas", () => {
  it("membro lê o próprio catálogo; o da outra volta vazio (e ele existe)", async () => {
    const daPropria = await gestorA
      .from("conversation_tag_def")
      .select("chave")
      .eq("clinic_id", clinicaA);
    expect(daPropria.data).toHaveLength(4);

    const daOutra = await gestorA
      .from("conversation_tag_def")
      .select("chave")
      .eq("clinic_id", clinicaB);
    expect(daOutra.data).toHaveLength(0);
    // Anti falso-positivo: o catálogo da B existe.
    const { data: existe } = await admin
      .from("conversation_tag_def")
      .select("chave")
      .eq("clinic_id", clinicaB);
    expect(existe).toHaveLength(4);
  });

  it("gestor de A não cria etiqueta em B", async () => {
    const { error } = await gestorA.from("conversation_tag_def").insert({
      clinic_id: clinicaB,
      chave: "invasora",
      nome: "Invasora",
      tom: "info",
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("etiqueta da clínica A não vale na clínica B, mesmo com a chave igual", async () => {
    const { data: conversaB } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicaB,
        phone_e164: `+55849${sufixo.slice(0, 6)}2`,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: conv } = await admin
      .from("conversation")
      .insert({ clinic_id: clinicaB, contact_id: conversaB!.id })
      .select("id")
      .single()
      .throwOnError();
    // 'urgente' existe nas DUAS (semeada), então usa uma só de A.
    await admin
      .from("conversation_tag_def")
      .insert({
        clinic_id: clinicaA,
        chave: "so_da_a",
        nome: "Só da A",
        tom: "info",
      })
      .throwOnError();
    const { error } = await admin
      .from("conversation")
      .update({ tags: ["so_da_a"] })
      .eq("id", conv!.id);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("quem gerencia o catálogo", () => {
  it("recepção não cria, não edita e não exclui", async () => {
    const criar = await recepcaoA.from("conversation_tag_def").insert({
      clinic_id: clinicaA,
      chave: "da_recepcao",
      nome: "Da recepção",
      tom: "info",
    });
    expect(criar.error?.code).toBe(RLS_VIOLATION);

    // Update e delete barrados por RLS afetam zero linhas, sem erro.
    const editar = await recepcaoA
      .from("conversation_tag_def")
      .update({ nome: "Renomeada pela recepção" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "urgente")
      .select("id");
    expect(editar.data ?? []).toHaveLength(0);

    const excluir = await recepcaoA
      .from("conversation_tag_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "urgente")
      .select("id");
    expect(excluir.data ?? []).toHaveLength(0);

    // Contraprova: continua lá, com o nome original.
    const { data } = await admin
      .from("conversation_tag_def")
      .select("nome")
      .eq("clinic_id", clinicaA)
      .eq("chave", "urgente")
      .single();
    expect(data?.nome).toBe("Urgente");
  });

  it("gestor cria e renomeia, e o nome muda de verdade", async () => {
    const criar = await gestorA.from("conversation_tag_def").insert({
      clinic_id: clinicaA,
      chave: "aguardando_exame",
      nome: "Aguardando exame",
      tom: "warning",
    });
    expect(criar.error).toBeNull();

    await gestorA
      .from("conversation_tag_def")
      .update({ nome: "Esperando exame" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "aguardando_exame")
      .throwOnError();
    const { data } = await admin
      .from("conversation_tag_def")
      .select("nome")
      .eq("clinic_id", clinicaA)
      .eq("chave", "aguardando_exame")
      .single();
    expect(data?.nome).toBe("Esperando exame");
  });

  it("a chave não muda, nem pelo service role (é gatilho, não policy)", async () => {
    const { error } = await admin
      .from("conversation_tag_def")
      .update({ chave: "outra_chave" })
      .eq("clinic_id", clinicaA)
      .eq("chave", "urgente");
    expect(error?.message).toContain("chave de uma etiqueta não muda");
  });

  it("dois nomes iguais na mesma clínica colidem", async () => {
    const { error } = await gestorA.from("conversation_tag_def").insert({
      clinic_id: clinicaA,
      chave: "urgente_2",
      nome: "  urgente  ",
      tom: "info",
    });
    expect(error?.code).toBe("23505");
  });
});

describe("quem aplica na conversa", () => {
  it("recepção APLICA e remove pela RPC (a decisão do dono)", async () => {
    const aplicar = await recepcaoA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: ["urgente", "orcamento_enviado"],
      p_remover: [],
    });
    expect(aplicar.error).toBeNull();
    expect(aplicar.data).toEqual(["orcamento_enviado", "urgente"]);

    const remover = await recepcaoA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: [],
      p_remover: ["urgente"],
    });
    expect(remover.data).toEqual(["orcamento_enviado"]);
  });

  it("a RPC é idempotente: repetir não duplica, remover o que não há não falha", async () => {
    const repetido = await recepcaoA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: ["orcamento_enviado", "orcamento_enviado"],
      p_remover: ["nunca_aplicada"],
    });
    expect(repetido.data).toEqual(["orcamento_enviado"]);
  });

  it("leitura não aplica: a RPC devolve null", async () => {
    const { data, error } = await leituraA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: ["urgente"],
      p_remover: [],
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("profissional aplica na conversa dele e recebe null na conversa de outro", async () => {
    const propria = await profissionalA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: ["urgente"],
      p_remover: [],
    });
    expect(propria.data).toContain("urgente");

    const alheia = await profissionalA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaDeOutro,
      p_adicionar: ["urgente"],
      p_remover: [],
    });
    expect(alheia.data).toBeNull();
  });

  it("gestor de B não etiqueta conversa de A", async () => {
    const { data } = await gestorB.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: ["urgente"],
      p_remover: [],
    });
    expect(data).toBeNull();
  });
});

describe("a invariante: toda chave existe no catálogo", () => {
  it("conversa recusa etiqueta fora do catálogo, no INSERT e no UPDATE", async () => {
    const noUpdate = await admin
      .from("conversation")
      .update({ tags: ["fantasma"] })
      .eq("id", conversaA);
    expect(noUpdate.error?.code).toBe(CHECK_VIOLATION);

    const noInsert = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoA,
        status: "resolvida",
        tags: ["fantasma"],
      })
      .select("id");
    expect(noInsert.error?.code).toBe(CHECK_VIOLATION);
  });

  it("o teto de 8 etiquetas por conversa vale", async () => {
    const chaves = Array.from({ length: 9 }, (_, i) => `enchendo_${i}`);
    await admin
      .from("conversation_tag_def")
      .insert(
        chaves.map((chave, i) => ({
          clinic_id: clinicaA,
          chave,
          nome: `Enchendo ${i}`,
          tom: "neutral",
        })),
      )
      .throwOnError();
    const { error } = await admin
      .from("conversation")
      .update({ tags: chaves })
      .eq("id", conversaA);
    expect(error?.message).toMatch(/conversation_ate_8_etiquetas|check/i);
  });

  it("excluir etiqueta EM USO limpa as conversas, e a conversa continua editável", async () => {
    await admin
      .from("conversation")
      .update({ tags: ["urgente", "orcamento_enviado"] })
      .eq("id", conversaA)
      .throwOnError();

    await gestorA
      .from("conversation_tag_def")
      .delete()
      .eq("clinic_id", clinicaA)
      .eq("chave", "orcamento_enviado")
      .throwOnError();

    const { data: depois } = await admin
      .from("conversation")
      .select("tags")
      .eq("id", conversaA)
      .single();
    expect(depois?.tags).toEqual(["urgente"]);

    // O ponto do teste: sem a limpeza, a chave pendurada faria QUALQUER
    // edição futura de etiqueta nesta conversa falhar no validador.
    const { data: aindaEditavel } = await recepcaoA.rpc("etiquetar_conversa", {
      p_clinic_id: clinicaA,
      p_conversation_id: conversaA,
      p_adicionar: ["aguardando_paciente"],
      p_remover: [],
    });
    expect(aindaEditavel).toEqual(["aguardando_paciente", "urgente"]);
  });
});
