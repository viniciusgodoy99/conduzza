import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Tela 6 (Agente de IA): configuracao, publicacao e versoes (migration
// 20261006150000), pela API com JWT real de cada papel. O que esta em jogo:
//   - a clinica A nao le a configuracao nem a base da B (e vice-versa);
//   - administrador e gestor ATIVOS da clinica da fase (aqui, de teste)
//     garantem o rascunho pela RPC e gravam o rascunho e a base pela sessao;
//     recepcao, profissional, leitura, pendente e o admin de outra clinica
//     nao gravam (42501 ou zero linhas) e nao chamam garantir nem restaurar;
//   - NINGUEM cria nem apaga versao pela sessao (42501, administrador e
//     gestor inclusive): o rascunho so nasce por garantir_rascunho_do_agente,
//     que copia as instrucoes do super admin. Criado por fora, nasceria com
//     instrucoes nulas e as zeraria ao publicar;
//   - ninguem grava a versao publicada (zero linhas ou 42501 pela sessao,
//     P0001 ate para o sistema);
//   - a sessao nao le nem grava instrucoes (grant por coluna: 42501 em
//     select, insert e update), nem conhecimento, version e status; le o
//     resto com colunas explicitas (select * da 42501);
//   - instrucoes_do_agente e definir_instrucoes_do_agente: 42501 para todo
//     papel da clinica (so o super admin, que nao tem sessao aqui, e o
//     servidor);
//   - publicar_agente: 42501 para toda sessao e para anon (so service role);
//   - reservar_gasto_da_ia e acertar_gasto_da_ia: 42501 para toda sessao e
//     para anon (so service role);
//   - clinica fora da fase controlada e sem e_de_teste: 42501 na escrita
//     direta, na RPC e ate pela service role;
//   - um rascunho por clinica (23505) pelo sistema.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, apagadas no
// afterAll. A F nasce de teste e so deixa de ser DENTRO do teste que precisa
// de clinica fora da fase (foraDeTeste), voltando no finally. Nada aqui usa
// a id da salud-care, da teste123 nem da Conduzza Teste, e nada liga a IA.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   update public.clinic set e_de_teste = true
//    where slug like 'agente-config-%' and not e_de_teste;
//   delete from public.clinic where slug like 'agente-config-%' and e_de_teste;
// e os usuarios sinteticos (auth.users com email like
// 'agente-config-%@teste.dev'), pelo painel do Supabase ou pela API de
// administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const REGRA_DO_BANCO = "P0001";
const DUPLICADO = "23505";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "AgenteConfig!Rls2026";

let clinicaA = "";
let clinicaB = "";
let clinicaF = "";
let rascunhoA = "";
let rascunhoB = "";
let itemA = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) =>
  `agente-config-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const MEMBROS_ATIVOS_DA_A = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
] as const;
const QUEM_CONFIGURA_A_A = ["admin-a", "gestor-a"] as const;
const SEM_ESCRITA_NA_A = [
  "recepcao-a",
  "profissional-a",
  "leitura-a",
  "pendente-a",
  "admin-b",
] as const;
const TODAS_AS_SESSOES = [
  ...MEMBROS_ATIVOS_DA_A,
  "pendente-a",
  "admin-b",
  "admin-f",
] as const;

// Colunas que a sessao le (todas menos instrucoes): nunca select *.
const COLUNAS_DA_TELA =
  "id, clinic_id, version, status, agent_name, tone, use_emoji, greeting, closing, skills, operating_mode, fallback_minutes, operating_hours, escalation_rules, conhecimento, published_at, published_by, created_at, updated_at";

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  status: "ativo" | "pendente" = "ativo",
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
  ids.set(apelido, data.user.id);
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: data.user.id, role, status })
    .throwOnError();
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

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Agente config ${nome} ${sufixo}`,
      slug: `agente-config-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/**
 * A F fora da fase (sem e_de_teste e fora da lista fechada) so durante o
 * corpo; volta a ser de teste no finally, falhe o corpo ou nao. Pela service
 * role (so a equipe do Conduzza muda e_de_teste).
 */
async function foraDeTeste(corpo: () => Promise<void>): Promise<void> {
  await admin
    .from("clinic")
    .update({ e_de_teste: false })
    .eq("id", clinicaF)
    .throwOnError();
  try {
    await corpo();
  } finally {
    await admin
      .from("clinic")
      .update({ e_de_teste: true })
      .eq("id", clinicaF)
      .throwOnError();
  }
}

/**
 * O carimbo que a Server Action manda a publicar_agente: o maior updated_at
 * entre o rascunho e todos os itens da base da clinica (lido pelo sistema).
 */
async function conferidoEm(clinicId: string): Promise<string> {
  const [rascunho, base] = await Promise.all([
    admin
      .from("ai_agent_config")
      .select("updated_at")
      .eq("clinic_id", clinicId)
      .eq("status", "rascunho")
      .throwOnError(),
    admin
      .from("knowledge_item")
      .select("updated_at")
      .eq("clinic_id", clinicId)
      .throwOnError(),
  ]);
  const carimbos = [...(rascunho.data ?? []), ...(base.data ?? [])].map(
    (linha) => Date.parse((linha as { updated_at: string }).updated_at),
  );
  return new Date(Math.max(...carimbos)).toISOString();
}

/** Retrato da configuracao e da base da A (lido pelo sistema). */
async function retratoDaA() {
  const [config, base] = await Promise.all([
    admin
      .from("ai_agent_config")
      .select(
        "id, version, status, agent_name, greeting, instrucoes, conhecimento",
      )
      .eq("clinic_id", clinicaA)
      .order("version")
      .throwOnError(),
    admin
      .from("knowledge_item")
      .select("id, question, answer, active")
      .eq("clinic_id", clinicaA)
      .order("id")
      .throwOnError(),
  ]);
  return { config: config.data, base: base.data };
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  clinicaF = await criarClinica("F");

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("pendente-a", clinicaA, "gestor", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");
  await criarPessoa("admin-f", clinicaF, "admin");
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB, clinicaF]);
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

describe("rascunho e base: quem configura grava, os demais nao", () => {
  it("administrador garante o rascunho pela RPC; gestor grava rascunho e base pela sessao", async () => {
    const { data: garantido, error } = await como("admin-a").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaA },
    );
    expect(error).toBeNull();
    rascunhoA = garantido as string;
    // de novo, pelo gestor: o mesmo rascunho
    const { data: deNovo } = await como("gestor-a").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaA },
    );
    expect(deNovo).toBe(rascunhoA);

    const { data: editado, error: erroEdicao } = await como("gestor-a")
      .from("ai_agent_config")
      .update({ greeting: "Olá!", tone: "formal" })
      .eq("id", rascunhoA)
      .select("version, status, greeting, tone");
    expect(erroEdicao).toBeNull();
    expect(editado).toEqual([
      { version: 1, status: "rascunho", greeting: "Olá!", tone: "formal" },
    ]);

    const { data: item, error: erroItem } = await como("gestor-a")
      .from("knowledge_item")
      .insert({
        clinic_id: clinicaA,
        question: "Tem estacionamento?",
        answer: "Sim, gratuito.",
      })
      .select("id, created_by")
      .single();
    expect(erroItem).toBeNull();
    expect(item).toMatchObject({ created_by: ids.get("gestor-a") });
    itemA = (item as { id: string }).id;

    const { data: daB } = await como("admin-b").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaB },
    );
    rascunhoB = daB as string;
    expect(rascunhoB).not.toBe(rascunhoA);
  });

  it("membro ativo da A le a configuracao e a base da A com colunas explicitas; ninguem de fora le", async () => {
    for (const apelido of MEMBROS_ATIVOS_DA_A) {
      const { data, error } = await como(apelido)
        .from("ai_agent_config")
        .select(COLUNAS_DA_TELA)
        .eq("clinic_id", clinicaA);
      expect(error).toBeNull();
      expect((data ?? []).map((linha) => linha.id)).toEqual([rascunhoA]);
      const { data: base } = await como(apelido)
        .from("knowledge_item")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(base).toEqual([{ id: itemA }]);
    }
    for (const apelido of ["pendente-a", "admin-b", "admin-f"] as const) {
      const { data: config } = await como(apelido)
        .from("ai_agent_config")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(config).toEqual([]);
      const { data: base } = await como(apelido)
        .from("knowledge_item")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(base).toEqual([]);
    }
    // A nao le a B (contraprova: o admin da B le a dela)
    const { data: bPelaA } = await como("admin-a")
      .from("ai_agent_config")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(bPelaA).toEqual([]);
    const { data: bPelaB } = await como("admin-b")
      .from("ai_agent_config")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(bPelaB).toEqual([{ id: rascunhoB }]);
  });

  it("recepcao, profissional, leitura, pendente e a B nao gravam rascunho nem base e nao chamam garantir nem restaurar", async () => {
    const antes = await retratoDaA();
    for (const apelido of SEM_ESCRITA_NA_A) {
      const cliente = como(apelido);
      const { error: aoCriar } = await cliente
        .from("ai_agent_config")
        .insert({ clinic_id: clinicaA, version: 9 });
      expect(aoCriar?.code).toBe(PERMISSAO_NEGADA);
      const { data: editadas } = await cliente
        .from("ai_agent_config")
        .update({ greeting: "Forjado" })
        .eq("id", rascunhoA)
        .select("id");
      expect(editadas ?? []).toEqual([]);
      const { error: aoApagar } = await cliente
        .from("ai_agent_config")
        .delete()
        .eq("id", rascunhoA);
      expect(aoApagar?.code).toBe(PERMISSAO_NEGADA);

      const { error: itemCriado } = await cliente
        .from("knowledge_item")
        .insert({
          clinic_id: clinicaA,
          question: "Forjada",
          answer: "Forjada",
        });
      expect(itemCriado?.code).toBe(PERMISSAO_NEGADA);
      const { data: itensEditados } = await cliente
        .from("knowledge_item")
        .update({ answer: "Forjada" })
        .eq("id", itemA)
        .select("id");
      expect(itensEditados ?? []).toEqual([]);
      const { data: itensApagados } = await cliente
        .from("knowledge_item")
        .delete()
        .eq("id", itemA)
        .select("id");
      expect(itensApagados ?? []).toEqual([]);

      for (const [rpc, args] of [
        ["garantir_rascunho_do_agente", { p_clinic_id: clinicaA }],
        ["restaurar_versao_do_agente", { p_clinic_id: clinicaA, p_versao: 1 }],
      ] as const) {
        const { error } = await cliente.rpc(rpc, args);
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    expect(await retratoDaA()).toEqual(antes);
  });

  it("nem administrador nem gestor criam ou apagam versao pela sessao (42501); o rascunho e as instrucoes ficam", async () => {
    const { error: instrucoesDoSistema } = await admin.rpc(
      "definir_instrucoes_do_agente",
      { p_clinic_id: clinicaA, p_instrucoes: "Fale do estacionamento." },
    );
    expect(instrucoesDoSistema).toBeNull();
    const antes = await retratoDaA();
    for (const apelido of QUEM_CONFIGURA_A_A) {
      const cliente = como(apelido);
      for (const tentativa of [
        cliente.from("ai_agent_config").insert({ clinic_id: clinicaA }),
        cliente
          .from("ai_agent_config")
          .insert({ clinic_id: clinicaA, version: 99, greeting: "Olá!" }),
        cliente.from("ai_agent_config").delete().eq("id", rascunhoA),
        cliente.from("ai_agent_config").delete().eq("clinic_id", clinicaA),
      ]) {
        const { error } = await tentativa;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    expect(await retratoDaA()).toEqual(antes);
    // contraprova: garantir devolve o mesmo rascunho, com as instrucoes
    const { data: garantido } = await como("gestor-a").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaA },
    );
    expect(garantido).toBe(rascunhoA);
    const { data: instrucoes } = await admin.rpc("instrucoes_do_agente", {
      p_clinic_id: clinicaA,
    });
    expect(instrucoes).toBe("Fale do estacionamento.");
  });

  it("um rascunho por clinica: o segundo da 23505 pelo sistema", async () => {
    const { error: peloSistema } = await admin
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaA, version: 8 });
    expect(peloSistema?.code).toBe(DUPLICADO);
    // contraprova: a B tem o rascunho dela ao mesmo tempo (criado acima)
    const { data } = await admin
      .from("ai_agent_config")
      .select("clinic_id")
      .eq("status", "rascunho")
      .in("clinic_id", [clinicaA, clinicaB])
      .order("clinic_id")
      .throwOnError();
    expect((data ?? []).length).toBe(2);
  });
});

describe("instrucoes: so a equipe do Conduzza", () => {
  it("a sessao nao le nem grava instrucoes, conhecimento, version e status; le o resto", async () => {
    for (const apelido of QUEM_CONFIGURA_A_A) {
      const cliente = como(apelido);
      const tentativas = [
        cliente.from("ai_agent_config").select("instrucoes"),
        cliente.from("ai_agent_config").select("*"),
        cliente
          .from("ai_agent_config")
          .update({ instrucoes: "Forjada" })
          .eq("id", rascunhoA),
        cliente
          .from("ai_agent_config")
          .update({ conhecimento: [] })
          .eq("id", rascunhoA),
        cliente
          .from("ai_agent_config")
          .update({ version: 40 })
          .eq("id", rascunhoA),
        cliente
          .from("ai_agent_config")
          .update({ status: "publicada" })
          .eq("id", rascunhoA),
        // A sessao nao tem INSERT nenhum na tabela (nem por coluna).
        cliente
          .from("ai_agent_config")
          .insert({ clinic_id: clinicaA, instrucoes: "Forjada" }),
      ];
      for (const tentativa of tentativas) {
        const { error } = await tentativa;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
      // contraprova: as colunas da tela passam
      const { data, error } = await cliente
        .from("ai_agent_config")
        .select("id, conhecimento, version")
        .eq("id", rascunhoA);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: rascunhoA, conhecimento: [], version: 1 }]);
    }
  });

  it("instrucoes_do_agente e definir_instrucoes_do_agente: 42501 para todo papel da clinica e para anon", async () => {
    const { error: peloSistema } = await admin.rpc(
      "definir_instrucoes_do_agente",
      { p_clinic_id: clinicaA, p_instrucoes: "Fale do estacionamento." },
    );
    expect(peloSistema).toBeNull();
    for (const cliente of [
      ...TODAS_AS_SESSOES.map((apelido) => como(apelido)),
      anonClient(),
    ]) {
      const { data: lidas, error: aoLer } = await cliente.rpc(
        "instrucoes_do_agente",
        { p_clinic_id: clinicaA },
      );
      expect(aoLer?.code).toBe(PERMISSAO_NEGADA);
      expect(lidas).toBeNull();
      const { error: aoGravar } = await cliente.rpc(
        "definir_instrucoes_do_agente",
        { p_clinic_id: clinicaA, p_instrucoes: "Forjada" },
      );
      expect(aoGravar?.code).toBe(PERMISSAO_NEGADA);
    }
    // contraprova: o sistema le o texto que gravou, intacto
    const { data } = await admin.rpc("instrucoes_do_agente", {
      p_clinic_id: clinicaA,
    });
    expect(data).toBe("Fale do estacionamento.");
  });
});

describe("publicar: so o servidor", () => {
  it("publicar_agente da 42501 para toda sessao e para anon", async () => {
    for (const cliente of [
      ...TODAS_AS_SESSOES.map((apelido) => como(apelido)),
      anonClient(),
    ]) {
      const { error } = await cliente.rpc("publicar_agente", {
        p_clinic_id: clinicaA,
        p_autor: ids.get("admin-a"),
        p_conferido_em: new Date().toISOString(),
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("ai_agent_config")
      .select("status")
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(data).toEqual({ status: "rascunho" });
  });

  it("ninguem grava a publicada: zero linhas ou 42501 pela sessao, P0001 pelo sistema", async () => {
    const { data: publicada, error } = await admin.rpc("publicar_agente", {
      p_clinic_id: clinicaA,
      p_autor: ids.get("admin-a"),
      p_conferido_em: await conferidoEm(clinicaA),
    });
    expect(error).toBeNull();
    expect(publicada).toEqual({ versao: 1 });

    for (const apelido of [...QUEM_CONFIGURA_A_A, ...SEM_ESCRITA_NA_A]) {
      const cliente = como(apelido);
      const { data: editadas } = await cliente
        .from("ai_agent_config")
        .update({ greeting: "Mudou" })
        .eq("id", rascunhoA)
        .select("id");
      expect(editadas ?? []).toEqual([]);
      const { error: aoApagar } = await cliente
        .from("ai_agent_config")
        .delete()
        .eq("id", rascunhoA);
      expect(aoApagar?.code).toBe(PERMISSAO_NEGADA);
    }
    const { error: peloSistema } = await admin
      .from("ai_agent_config")
      .update({ greeting: "Mudou" })
      .eq("id", rascunhoA);
    expect(peloSistema?.code).toBe(REGRA_DO_BANCO);

    const { data: final } = await admin
      .from("ai_agent_config")
      .select("status, greeting, published_by")
      .eq("id", rascunhoA)
      .single()
      .throwOnError();
    expect(final).toEqual({
      status: "publicada",
      greeting: "Olá!",
      published_by: ids.get("admin-a"),
    });

    // contraprova: o proximo rascunho nasce editavel pela gestao
    const { data: proximo } = await como("admin-a").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaA },
    );
    const { data: editado, error: erroEdicao } = await como("gestor-a")
      .from("ai_agent_config")
      .update({ greeting: "Bom dia!" })
      .eq("id", proximo as string)
      .select("version, greeting");
    expect(erroEdicao).toBeNull();
    expect(editado).toEqual([{ version: 2, greeting: "Bom dia!" }]);
  });
});

describe("gasto reservado: so o servidor", () => {
  it("reservar_gasto_da_ia e acertar_gasto_da_ia: 42501 para toda sessao e para anon", async () => {
    for (const cliente of [
      ...TODAS_AS_SESSOES.map((apelido) => como(apelido)),
      anonClient(),
    ]) {
      const { data: reserva, error: aoReservar } = await cliente.rpc(
        "reservar_gasto_da_ia",
        {
          p_clinic_id: clinicaA,
          p_origem: "simulador",
          p_custo_microdolar: 1,
        },
      );
      expect(aoReservar?.code).toBe(PERMISSAO_NEGADA);
      expect(reserva).toBeNull();
      const { error: aoAcertar } = await cliente.rpc("acertar_gasto_da_ia", {
        p_reserva: crypto.randomUUID(),
        p_linhas: [],
      });
      expect(aoAcertar?.code).toBe(PERMISSAO_NEGADA);
    }
    // contraprova: pelo servidor a funcao existe e roda (sem liberacao na
    // A, NULL; uma reserva inexistente da P0002, nao 42501)
    const { data, error } = await admin.rpc("reservar_gasto_da_ia", {
      p_clinic_id: clinicaA,
      p_origem: "simulador",
      p_custo_microdolar: 1,
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
    const { error: inexistente } = await admin.rpc("acertar_gasto_da_ia", {
      p_reserva: crypto.randomUUID(),
      p_linhas: [],
    });
    expect(inexistente?.code).toBe("P0002");
    const { data: uso } = await admin
      .from("ia_uso")
      .select("id")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(uso).toEqual([]);
  });
});

describe("clinica fora da fase controlada", () => {
  it("fora da fase: 42501 na escrita direta, na RPC e ate pela service role", async () => {
    await foraDeTeste(async () => {
      const adminF = como("admin-f");
      const tentativas = [
        adminF.from("ai_agent_config").insert({ clinic_id: clinicaF }),
        adminF.from("knowledge_item").insert({
          clinic_id: clinicaF,
          question: "Pergunta",
          answer: "Resposta",
        }),
        adminF.rpc("garantir_rascunho_do_agente", { p_clinic_id: clinicaF }),
        admin.from("ai_agent_config").insert({ clinic_id: clinicaF }),
        admin.from("knowledge_item").insert({
          clinic_id: clinicaF,
          question: "Pergunta",
          answer: "Resposta",
        }),
        admin.rpc("garantir_rascunho_do_agente", { p_clinic_id: clinicaF }),
      ];
      for (const tentativa of tentativas) {
        const { error } = await tentativa;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    });
    const { data: nada } = await admin
      .from("ai_agent_config")
      .select("id")
      .eq("clinic_id", clinicaF)
      .throwOnError();
    expect(nada).toEqual([]);

    // contraprova: de teste de novo, o mesmo admin garante o rascunho
    const { data, error } = await como("admin-f").rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinicaF },
    );
    expect(error).toBeNull();
    expect(typeof data).toBe("string");
  });
});
