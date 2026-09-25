import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Varios numeros de WhatsApp por clinica, Fases 1A e 1B (migrations
// 20260925130000 e 20260925131000; desenho em
// docs/07_multiplos_numeros_whatsapp.md). O que esta em jogo aqui e o que
// NAO pode depender da tela:
//
//   - o numero (e o nome dele, a unidade, o principal) so e lido por membro
//     ATIVO da propria clinica; pendente nao le;
//   - limite_de_numeros e do plano: o administrador da clinica nao muda, o
//     service role (dono do produto) muda, e o banco recusa o excedente;
//   - um principal por clinica; unidade so da propria clinica;
//   - a politica das mensagens automaticas: gestao grava, recepcao nao, e o
//     numero fixo tem de ser da propria clinica;
//   - whatsapp_account_secret continua invisivel para qualquer sessao.
//
// NESTA FASE o unique temporario whatsapp_account_uma_por_clinica (clinic_id)
// ainda impede o segundo numero. Por isso o limite e provado pela ORDEM: o
// gatilho antes_de_criar_numero roda antes da checagem do unique, entao com
// limite 1 o segundo numero recebe 23514 (limite), e sem limite o MESMO
// insert recebe 23505 (unique temporario). Os casos que exigem dois numeros
// ativos ficam em it.skip e ativam na Fase 3, quando o unique sai.

const RLS_VIOLATION = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `Numeros-${sufixo}!`;

const usuarios: string[] = [];
let clinicaA = "";
let clinicaB = "";
let clinicaC = "";
let numeroA = "";
let numeroB = "";
let unidadeA = "";
let unidadeB = "";

let adminA: SupabaseClient;
let gestorA: SupabaseClient;
let recepcaoA: SupabaseClient;
let pendenteA: SupabaseClient;
let adminB: SupabaseClient;
let gestorB: SupabaseClient;

async function criarPessoa(
  apelido: string,
  clinicId: string,
  papel: string,
  status: "ativo" | "pendente" = "ativo",
): Promise<SupabaseClient> {
  const email = `numeros-${apelido}-${sufixo}@teste.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`criar ${email}: ${error?.message ?? "sem usuário"}`);
  }
  usuarios.push(data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: data.user.id, role: papel, status })
    .throwOnError();
  const client = anonClient();
  const { error: erroLogin } = await client.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (erroLogin) {
    throw new Error(`login ${email}: ${erroLogin.message}`);
  }
  return client;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Num A ${sufixo}`, slug: `num-a-${sufixo}`, e_de_teste: true },
      { name: `Num B ${sufixo}`, slug: `num-b-${sufixo}`, e_de_teste: true },
      { name: `Num C ${sufixo}`, slug: `num-c-${sufixo}`, e_de_teste: true },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `num-a-${sufixo}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `num-b-${sufixo}`)!.id as string;
  clinicaC = clinicas!.find((c) => c.slug === `num-c-${sufixo}`)!.id as string;

  // Um numero em cada clinica, gravado como o codigo de HOJE grava (sem id,
  // sem nome, sem principal): o banco preenche o resto.
  const { data: numeros } = await admin
    .from("whatsapp_account")
    .insert([
      { clinic_id: clinicaA, provider: "fake", connection_status: "conectado" },
      { clinic_id: clinicaB, provider: "fake", connection_status: "conectado" },
    ])
    .select("id, clinic_id")
    .throwOnError();
  numeroA = numeros!.find((n) => n.clinic_id === clinicaA)!.id as string;
  numeroB = numeros!.find((n) => n.clinic_id === clinicaB)!.id as string;

  // Segredo so com clinic_id (caminho legado do loadAccount e das fixtures).
  await admin
    .from("whatsapp_account_secret")
    .insert([
      { clinic_id: clinicaA, instance_token: "segredo-a" },
      { clinic_id: clinicaB, instance_token: "segredo-b" },
    ])
    .throwOnError();

  const { data: unidades } = await admin
    .from("unit")
    .insert([
      { clinic_id: clinicaA, name: `Unidade A ${sufixo}` },
      { clinic_id: clinicaB, name: `Unidade B ${sufixo}` },
    ])
    .select("id, clinic_id")
    .throwOnError();
  unidadeA = unidades!.find((u) => u.clinic_id === clinicaA)!.id as string;
  unidadeB = unidades!.find((u) => u.clinic_id === clinicaB)!.id as string;

  adminA = await criarPessoa("admin-a", clinicaA, "admin");
  gestorA = await criarPessoa("gestor-a", clinicaA, "gestor");
  recepcaoA = await criarPessoa("recepcao-a", clinicaA, "recepcao");
  pendenteA = await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  adminB = await criarPessoa("admin-b", clinicaB, "admin");
  gestorB = await criarPessoa("gestor-b", clinicaB, "gestor");
});

afterAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .in("id", [clinicaA, clinicaB, clinicaC].filter(Boolean));
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("leitura dos números", () => {
  it("o número existente nasce como Número principal", async () => {
    const { data } = await admin
      .from("whatsapp_account")
      .select("nome, principal, removido_em")
      .eq("id", numeroA)
      .single()
      .throwOnError();
    expect(data).toEqual({
      nome: "Número principal",
      principal: true,
      removido_em: null,
    });
  });

  it("admin da A lê o próprio número, com nome e principal", async () => {
    const { data, error } = await adminA
      .from("whatsapp_account")
      .select("id, nome, principal")
      .eq("clinic_id", clinicaA);
    expect(error).toBeNull();
    expect(data).toEqual([
      { id: numeroA, nome: "Número principal", principal: true },
    ]);
  });

  it("admin da A recebe zero números da B", async () => {
    const { data, error } = await adminA
      .from("whatsapp_account")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("anti falso-positivo: admin da B lê o número da B", async () => {
    const { data } = await adminB
      .from("whatsapp_account")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(data).toEqual([{ id: numeroB }]);
  });

  it("pendente não lê o número da própria clínica", async () => {
    const { data, error } = await pendenteA
      .from("whatsapp_account")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("sessão nenhuma escreve em whatsapp_account (só o service role)", async () => {
    const { data } = await adminA
      .from("whatsapp_account")
      .update({ nome: "Tentativa" })
      .eq("id", numeroA)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    const { data: depois } = await admin
      .from("whatsapp_account")
      .select("nome")
      .eq("id", numeroA)
      .single();
    expect(depois?.nome).toBe("Número principal");
  });
});

describe("limite de números do plano", () => {
  it("admin da clínica não altera limite_de_numeros", async () => {
    const { error } = await adminA
      .from("clinic")
      .update({ limite_de_numeros: 5 })
      .eq("id", clinicaA);
    expect(error?.code).toBe(RLS_VIOLATION);
    const { data } = await admin
      .from("clinic")
      .select("limite_de_numeros")
      .eq("id", clinicaA)
      .single();
    expect(data?.limite_de_numeros).toBeNull();
  });

  it("a trava é só da coluna: admin continua editando o nome", async () => {
    const { error } = await adminA
      .from("clinic")
      .update({ name: `Num A editada ${sufixo}` })
      .eq("id", clinicaA);
    expect(error).toBeNull();
  });

  it("o service role altera o limite", async () => {
    await admin
      .from("clinic")
      .update({ limite_de_numeros: 1 })
      .eq("id", clinicaA)
      .throwOnError();
    const { data } = await admin
      .from("clinic")
      .select("limite_de_numeros")
      .eq("id", clinicaA)
      .single();
    expect(data?.limite_de_numeros).toBe(1);
  });

  it("limite zero é recusado (nulo é sem limite)", async () => {
    const { error } = await admin
      .from("clinic")
      .update({ limite_de_numeros: 0 })
      .eq("id", clinicaA);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("com limite 1, o segundo número é recusado pelo limite", async () => {
    // O gatilho do limite roda ANTES do unique temporario: o erro e o do
    // plano, com a mensagem que a tela vai mostrar.
    const { error } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicaA, provider: "fake", nome: "Segundo" });
    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(error?.message).toBe(
      "Esta clínica atingiu o limite de números do plano.",
    );
  });

  it("sem limite, o mesmo insert esbarra no unique temporário desta fase", async () => {
    await admin
      .from("clinic")
      .update({ limite_de_numeros: null })
      .eq("id", clinicaA)
      .throwOnError();
    const { error } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicaA, provider: "fake", nome: "Segundo" });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  // Ativa na Fase 3 (sem o unique temporario): com limite 2, o segundo entra
  // e o terceiro e recusado; restaurar um removido tambem conta.
  it.skip("limite 2: o segundo número entra e o terceiro é recusado", async () => {
    await admin
      .from("clinic")
      .update({ limite_de_numeros: 2 })
      .eq("id", clinicaA)
      .throwOnError();
    const segundo = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicaA, provider: "fake", nome: "Segundo" });
    expect(segundo.error).toBeNull();
    const terceiro = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicaA, provider: "fake", nome: "Terceiro" });
    expect(terceiro.error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("um principal por clínica", () => {
  it("o primeiro número da clínica nasce principal mesmo pedindo que não", async () => {
    const { data } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicaC, provider: "fake", principal: false })
      .select("principal")
      .single()
      .throwOnError();
    expect(data?.principal).toBe(true);
  });

  it("o principal não pode ser marcado como removido direto na tabela", async () => {
    const { error } = await admin
      .from("whatsapp_account")
      .update({ removido_em: new Date().toISOString() })
      .eq("id", numeroA);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("um segundo principal na mesma clínica é recusado", async () => {
    // Nesta fase quem recusa pode ser o unique temporario ou o indice
    // whatsapp_account_um_principal: os dois sao 23505. Na Fase 3 so o
    // indice parcial continua (teste abaixo).
    const { error } = await admin
      .from("whatsapp_account")
      .insert({
        clinic_id: clinicaA,
        provider: "fake",
        nome: "Outro principal",
        principal: true,
      });
    expect(error?.code).toBe(UNIQUE_VIOLATION);
  });

  // Ativa na Fase 3: dois numeros ativos, e marcar o segundo como principal
  // direto na tabela esbarra no indice parcial; a troca e pela RPC.
  it.skip("dois números ativos: só um principal, e a troca é pela RPC", async () => {
    const { data: segundo } = await admin
      .from("whatsapp_account")
      .insert({ clinic_id: clinicaA, provider: "fake", nome: "Segundo" })
      .select("id, principal")
      .single()
      .throwOnError();
    expect(segundo?.principal).toBe(false);
    const direto = await admin
      .from("whatsapp_account")
      .update({ principal: true })
      .eq("id", segundo!.id);
    expect(direto.error?.code).toBe(UNIQUE_VIOLATION);
    const { error } = await admin.rpc("definir_numero_principal", {
      p_clinic_id: clinicaA,
      p_account_id: segundo!.id,
    });
    expect(error).toBeNull();
  });
});

describe("unidade do número", () => {
  it("unidade de outra clínica é recusada", async () => {
    const { error } = await admin
      .from("whatsapp_account")
      .update({ unit_id: unidadeB })
      .eq("id", numeroA);
    expect(error?.code).toBe(FK_VIOLATION);
  });

  it("unidade da própria clínica é aceita", async () => {
    const { error } = await admin
      .from("whatsapp_account")
      .update({ unit_id: unidadeA })
      .eq("id", numeroA);
    expect(error).toBeNull();
  });
});

describe("número das mensagens automáticas", () => {
  it("recepção não grava a política", async () => {
    const { error } = await recepcaoA
      .from("whatsapp_envio_automatico")
      .insert({ clinic_id: clinicaA, modo: "ultimo_usado" });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("gestor grava a política da própria clínica", async () => {
    const { error } = await gestorA
      .from("whatsapp_envio_automatico")
      .insert({ clinic_id: clinicaA, modo: "ultimo_usado" });
    expect(error).toBeNull();
  });

  it("gestor não grava política de outra clínica", async () => {
    const { error } = await gestorA
      .from("whatsapp_envio_automatico")
      .insert({ clinic_id: clinicaB, modo: "ultimo_usado" });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("número fixo de outra clínica é recusado", async () => {
    const { error } = await gestorA
      .from("whatsapp_envio_automatico")
      .update({ modo: "fixo", conta_fixa_id: numeroB })
      .eq("clinic_id", clinicaA);
    expect(error?.code).toBe(FK_VIOLATION);
  });

  it("modo fixo sem número é recusado", async () => {
    const { error } = await gestorA
      .from("whatsapp_envio_automatico")
      .update({ modo: "fixo", conta_fixa_id: null })
      .eq("clinic_id", clinicaA);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("gestor fixa o número da própria clínica", async () => {
    const { data, error } = await gestorA
      .from("whatsapp_envio_automatico")
      .update({ modo: "fixo", conta_fixa_id: numeroA })
      .eq("clinic_id", clinicaA)
      .select("modo, conta_fixa_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ modo: "fixo", conta_fixa_id: numeroA }]);
  });

  it("recepção lê a política, mas não altera", async () => {
    const leitura = await recepcaoA
      .from("whatsapp_envio_automatico")
      .select("modo")
      .eq("clinic_id", clinicaA);
    expect(leitura.data).toEqual([{ modo: "fixo" }]);

    const { data } = await recepcaoA
      .from("whatsapp_envio_automatico")
      .update({ modo: "ultimo_usado", conta_fixa_id: null })
      .eq("clinic_id", clinicaA)
      .select("modo");
    expect(data ?? []).toHaveLength(0);
    const { data: depois } = await admin
      .from("whatsapp_envio_automatico")
      .select("modo")
      .eq("clinic_id", clinicaA)
      .single();
    expect(depois?.modo).toBe("fixo");
  });

  it("ninguém apaga a política por sessão", async () => {
    const { error } = await adminA
      .from("whatsapp_envio_automatico")
      .delete()
      .eq("clinic_id", clinicaA);
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("gestor da B e pendente da A não leem a política da A", async () => {
    const deB = await gestorB
      .from("whatsapp_envio_automatico")
      .select("clinic_id")
      .eq("clinic_id", clinicaA);
    expect(deB.error).toBeNull();
    expect(deB.data).toHaveLength(0);
    const pendente = await pendenteA
      .from("whatsapp_envio_automatico")
      .select("clinic_id");
    expect(pendente.error).toBeNull();
    expect(pendente.data).toHaveLength(0);
  });
});

describe("conta_de_envio por sessão", () => {
  it("membro da clínica recebe o número de envio", async () => {
    const { data, error } = await gestorA.rpc("conta_de_envio", {
      p_clinic_id: clinicaA,
      p_contact_id: null,
    });
    expect(error).toBeNull();
    expect(data).toBe(numeroA);
  });

  it("admin de outra clínica é recusado", async () => {
    const { error } = await adminB.rpc("conta_de_envio", {
      p_clinic_id: clinicaA,
      p_contact_id: null,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("pendente é recusado", async () => {
    const { error } = await pendenteA.rpc("contas_de_envio", {
      p_clinic_id: clinicaA,
      p_contact_ids: [],
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("RPCs de escrita do número são só do service role", async () => {
    const remover = await adminA.rpc("remover_numero", {
      p_clinic_id: clinicaA,
      p_account_id: numeroA,
    });
    expect(remover.error).not.toBeNull();
    const principal = await adminA.rpc("definir_numero_principal", {
      p_clinic_id: clinicaA,
      p_account_id: numeroA,
    });
    expect(principal.error).not.toBeNull();
    const { data } = await admin
      .from("whatsapp_account")
      .select("removido_em")
      .eq("id", numeroA)
      .single();
    expect(data?.removido_em).toBeNull();
  });
});

describe("segredo do número", () => {
  const SESSOES: [string, () => SupabaseClient][] = [
    ["admin", () => adminA],
    ["gestor", () => gestorA],
    ["recepção", () => recepcaoA],
    ["pendente", () => pendenteA],
  ];

  it.each(SESSOES)(
    "%s da A não lê whatsapp_account_secret",
    async (_papel, sessao) => {
      const { data, error } = await sessao()
        .from("whatsapp_account_secret")
        .select("account_id, clinic_id");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
  );

  it("anônimo não lê whatsapp_account_secret", async () => {
    const { data } = await anonClient()
      .from("whatsapp_account_secret")
      .select("account_id");
    expect(data ?? []).toHaveLength(0);
  });

  it("anti falso-positivo: o service role lê o segredo, já ligado ao número", async () => {
    const { data } = await admin
      .from("whatsapp_account_secret")
      .select("account_id")
      .eq("clinic_id", clinicaA);
    expect(data).toEqual([{ account_id: numeroA }]);
  });
});
