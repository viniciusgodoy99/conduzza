import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Terceira leva do Painel geral (CS; migration 20261026120000_painel_cs_3.sql),
// pela API com JWT real de cada papel. Decisao do dono de 26/10/2026 ("Sim,
// numa migration pequena"): o banco recusa nome de clinica vazio e fuso
// horario inexistente ao gravar a clinica. A brecha era a API direta: a
// policy "admin da clinica edita a clinica" deixa o administrador gravar
// clinic.name e clinic.timezone pelo PostgREST, sem o Zod da tela, e um fuso
// inexistente derrubava o Painel geral para todas as clinicas. O que esta
// em jogo:
// - a administradora, pela sessao: o nome vazio ou so de brancos (os que o
//   .trim() do JavaScript tira: espaco, tab, quebra de linha, espaco nao
//   separavel, U+3000, o BOM...) recebe 23514 nome_da_clinica_vazio, e o
//   fuso fora da regra barata (inexistente, em minusculas, POSIX, Factory,
//   Posix/America/Fortaleza) recebe 23514 fuso_invalido; a clinica fica
//   como estava;
// - o que passa pela sessao: o nome bom, fusos de fora do Brasil
//   (Asia/Tokyo, Pacific/Pago_Pago, Etc/GMT+3) e UTC;
// - INSERT de clinica pela sessao: o gatilho vem antes da RLS (o nome vazio
//   recebe 23514); com os dados bons, a RLS recusa (42501), como sempre:
//   nada e criado;
// - gestor, recepcao, leitura e a administradora de outra clinica: a RLS
//   filtra antes do gatilho (0 linhas, sem erro, nem com o nome vazio): o
//   gatilho nao vira canal de nada;
// - a service role passa da RLS e nao passa do gatilho (contraprova);
// - o Painel geral com o sinal novo continua so da equipe Conduzza (42501
//   para a administradora e para anon).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUSTO: a regra do fuso nao le lista (microssegundos por fuso); os casos
// com muitas gravacoes tem prazo de 30 s, pela folga do Auth e da rede.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// painel-cs3-rls-*, apagadas no afterAll (prazo de 60 s; vinculos em
// cascata; o beforeAll apaga a sobra de uma execucao que morreu ha mais de
// uma hora), e os usuarios desta execucao. Nada aqui usa a id da Salud Care,
// da teste123 nem da Conduzza Teste. ESCRITO, AINDA NAO RODADO (roda depois
// de aplicar a migration: npm run test:rls -- painel-cs-3).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'painel-cs3-rls-%';
//   delete from public.clinic where slug like 'painel-cs3-rls-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-cs3-rls-%@teste.dev';
//   delete from auth.users u where u.email like 'painel-cs3-rls-%@teste.dev';

const PERMISSAO_NEGADA = "42501";
const DADO_FORA_DA_REGRA = "23514";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelCs3!Rls${sufixo}`;

const email = (papel: string) => `painel-cs3-rls-${papel}-${sufixo}@teste.dev`;
const slug = (nome: string) => `painel-cs3-rls-${nome}-${sufixo}`;

/** Os brancos que o .trim() do JavaScript tira, montados pelo codigo. */
const ESPACO_NAO_SEPARAVEL = String.fromCharCode(0xa0);
const TAB_E_QUEBRA = String.fromCharCode(0x09, 0x0a);
const ESPACO_IDEOGRAFICO_E_BOM = String.fromCharCode(0x3000, 0xfeff);
const NOMES_VAZIOS = [
  "",
  "   ",
  ESPACO_NAO_SEPARAVEL,
  TAB_E_QUEBRA,
  ESPACO_IDEOGRAFICO_E_BOM,
];
const FUSOS_INEXISTENTES = [
  "Fuso/Inexistente",
  "america/fortaleza",
  "UTC+3",
  "Factory",
  // Na producao o Postgres acha este sem caixa: so a exclusao recusa.
  "Posix/America/Fortaleza",
];

const NOME_DA_A = `Painel CS3 RLS A ${sufixo}`;
const FUSO_DA_A = "America/Fortaleza";

let clinicaA = "";
let clinicaB = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string; hint?: string } | null;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: nome === "A" ? NOME_DA_A : `Painel CS3 RLS ${nome} ${sufixo}`,
      slug: slug(nome.toLowerCase()),
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarUsuario(
  papel: string,
  clinicId: string,
  role: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papel),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Painel CS3 ${papel}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${papel}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(papel, data.user.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
}

// Uma sessao por papel, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, SupabaseClient>();

async function logado(papel: string): Promise<SupabaseClient> {
  const pronta = sessoes.get(papel);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papel),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papel}: ${error.message}`);
  }
  sessoes.set(papel, cliente);
  return cliente;
}

/** O nome e o fuso da A, lidos pela service role. */
async function nomeEFusoDaA(): Promise<{ name: string; timezone: string }> {
  const { data } = await admin
    .from("clinic")
    .select("name, timezone")
    .eq("id", clinicaA)
    .single()
    .throwOnError();
  return data as { name: string; timezone: string };
}

async function restaurarA(): Promise<void> {
  await admin
    .from("clinic")
    .update({ name: NOME_DA_A, timezone: FUSO_DA_A })
    .eq("id", clinicaA)
    .throwOnError();
}

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "painel-cs3-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("admin-b", clinicaB, "admin");
}, 120_000);

afterAll(async () => {
  // As clinicas desta execucao pelo slug (vinculos em cascata); depois os
  // usuarios, com o erro conferido: limpeza que falha calada deixaria
  // usuario sintetico na producao.
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `painel-cs3-rls-%-${sufixo}`);
  expect(erroDasClinicas, "apagar as clinicas do teste").toBeNull();
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("o nome e o fuso da clínica, conferidos pelo banco", () => {
  it("a administradora não grava nome vazio nem fuso inexistente pela API: 23514, e a clínica fica como estava", async () => {
    const sessao = await logado("admin-a");
    try {
      for (const [i, nome] of NOMES_VAZIOS.entries()) {
        const { error } = await sessao
          .from("clinic")
          .update({ name: nome })
          .eq("id", clinicaA);
        expect((error as Erro)?.code, `o nome ${i}`).toBe(DADO_FORA_DA_REGRA);
        expect((error as Erro)?.message, `o nome ${i}`).toBe(
          "nome_da_clinica_vazio",
        );
      }
      for (const fuso of FUSOS_INEXISTENTES) {
        const { error } = await sessao
          .from("clinic")
          .update({ timezone: fuso })
          .eq("id", clinicaA);
        expect((error as Erro)?.code, fuso).toBe(DADO_FORA_DA_REGRA);
        expect((error as Erro)?.message, fuso).toBe("fuso_invalido");
      }
      expect(await nomeEFusoDaA()).toEqual({
        name: NOME_DA_A,
        timezone: FUSO_DA_A,
      });
    } finally {
      // Sem o gatilho (a migration ainda nao aplicada), a A mudaria: volta
      // ja (um fuso inexistente derruba o Painel geral com as de teste).
      await restaurarA();
    }
  }, 30_000);

  it("o que passa pela sessão da administradora: o nome bom e fusos de fora do Brasil", async () => {
    const sessao = await logado("admin-a");
    try {
      const { data: renomeada, error: erroDoNome } = await sessao
        .from("clinic")
        .update({ name: `Painel CS3 RLS A renomeada ${sufixo}` })
        .eq("id", clinicaA)
        .select("name");
      expect(erroDoNome).toBeNull();
      expect(renomeada).toEqual([
        { name: `Painel CS3 RLS A renomeada ${sufixo}` },
      ]);
      for (const fuso of [
        "Asia/Tokyo",
        "Pacific/Pago_Pago",
        "Etc/GMT+3",
        "UTC",
      ]) {
        const { data, error } = await sessao
          .from("clinic")
          .update({ timezone: fuso })
          .eq("id", clinicaA)
          .select("timezone");
        expect(error, fuso).toBeNull();
        expect(data, fuso).toEqual([{ timezone: fuso }]);
      }
    } finally {
      await restaurarA();
    }
    expect(await nomeEFusoDaA()).toEqual({
      name: NOME_DA_A,
      timezone: FUSO_DA_A,
    });
  }, 30_000);

  it("INSERT de clínica pela sessão: o nome vazio e o fuso inexistente recebem 23514 (o gatilho vem antes da RLS); com os dados bons, a RLS recusa (42501); nada é criado", async () => {
    const sessao = await logado("admin-a");
    const { error: nomeVazio } = await sessao
      .from("clinic")
      .insert({ name: "   ", slug: slug("sessao-1") });
    expect((nomeVazio as Erro)?.code).toBe(DADO_FORA_DA_REGRA);
    expect((nomeVazio as Erro)?.message).toBe("nome_da_clinica_vazio");
    const { error: fusoInexistente } = await sessao.from("clinic").insert({
      name: `Painel CS3 RLS sessão ${sufixo}`,
      slug: slug("sessao-2"),
      timezone: "Fuso/Inexistente",
    });
    expect((fusoInexistente as Erro)?.code).toBe(DADO_FORA_DA_REGRA);
    expect((fusoInexistente as Erro)?.message).toBe("fuso_invalido");
    const { error: dadosBons } = await sessao.from("clinic").insert({
      name: `Painel CS3 RLS sessão ${sufixo}`,
      slug: slug("sessao-3"),
      timezone: FUSO_DA_A,
    });
    expect((dadosBons as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { data } = await admin
      .from("clinic")
      .select("id")
      .like("slug", `painel-cs3-rls-sessao-%-${sufixo}`)
      .throwOnError();
    expect(data).toEqual([]);
  }, 30_000);

  it("gestor, recepção, leitura e a administradora de outra clínica não mudam a A: a RLS filtra antes do gatilho (0 linhas, sem erro, nem com o nome vazio)", async () => {
    for (const papel of ["gestor-a", "recepcao-a", "leitura-a", "admin-b"]) {
      const sessao = await logado(papel);
      for (const nome of ["", `Painel CS3 RLS A por ${papel} ${sufixo}`]) {
        const { data, error } = await sessao
          .from("clinic")
          .update({ name: nome })
          .eq("id", clinicaA)
          .select("id");
        expect(error, `${papel}: ${JSON.stringify(nome)}`).toBeNull();
        expect(data ?? [], `${papel}: ${JSON.stringify(nome)}`).toEqual([]);
      }
    }
    expect(await nomeEFusoDaA()).toEqual({
      name: NOME_DA_A,
      timezone: FUSO_DA_A,
    });
  }, 30_000);

  it("a service role passa da RLS e não passa do gatilho (contraprova)", async () => {
    const { error: nomeVazio } = await admin
      .from("clinic")
      .update({ name: ESPACO_NAO_SEPARAVEL })
      .eq("id", clinicaA);
    expect((nomeVazio as Erro)?.code).toBe(DADO_FORA_DA_REGRA);
    expect((nomeVazio as Erro)?.message).toBe("nome_da_clinica_vazio");
    try {
      const { error: fusoBom } = await admin
        .from("clinic")
        .update({ timezone: "Etc/GMT-14" })
        .eq("id", clinicaA);
      expect(fusoBom).toBeNull();
      expect((await nomeEFusoDaA()).timezone).toBe("Etc/GMT-14");
    } finally {
      await restaurarA();
    }
  }, 30_000);
});

describe("o Painel geral com o sinal novo continua só da equipe Conduzza", () => {
  it("42501 para a administradora da clínica e para anon", async () => {
    const { data, error } = await (
      await logado("admin-a")
    ).rpc("painel_cs_das_clinicas", { p_incluir_teste: true });
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(data).toBeNull();
    const { data: dadosAnon, error: erroAnon } = await anonClient().rpc(
      "painel_cs_das_clinicas",
      { p_incluir_teste: true },
    );
    expect((erroAnon as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(dadosAnon).toBeNull();
    // Contraprova: a service role le, com a A sem uso e criada agora
    // (ainda_sem_acesso, Atencao).
    const { data: lista, error: erroDaLista } = await admin.rpc(
      "painel_cs_das_clinicas",
      { p_incluir_teste: true },
    );
    expect(erroDaLista).toBeNull();
    const a = (
      lista as {
        clinicas: {
          id: string;
          em_uso: boolean;
          sinais: { chave: string }[];
        }[];
      }
    ).clinicas.find((c) => c.id === clinicaA);
    expect(a).toBeDefined();
    // A A e nova: nunca sem_uso. Sem uso, ainda_sem_acesso; em uso (a
    // administradora entrou nesta suite), nenhum dos dois.
    const chaves = (a?.sinais ?? []).map((s) => s.chave);
    expect(chaves).not.toContain("sem_uso");
    expect(chaves.includes("ainda_sem_acesso")).toBe(!a?.em_uso);
  });
});
