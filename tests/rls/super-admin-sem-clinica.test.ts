import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// O super admin numa conta so para o painel (decisao do dono de 03/11/2026,
// "Conta propria so para o painel"; migration
// 20261103110000_super_admin_sem_clinica.sql), pela API com JWT real. O que
// esta em jogo:
// - equipe_conduzza: anon nao le (42501); a sessao de clinica (o
//   administrador e a propria pessoa marcada) le zero linhas com a linha
//   existindo (a service role ve: contraprova); ninguem escreve pela sessao
//   (42501);
// - a marca NAO da poder de super admin: is_product_admin() falso, as
//   funcoes do painel recusam (42501), a pessoa marcada nao le clinica de
//   que nao e membro (e le a propria: contraprova);
// - a trava nao atrapalha a conta normal: o administrador convida e o
//   vinculo entra; a pessoa marcada, conta normal, tambem entra;
// - com RLS_COM_SUPER_ADMIN=1 (opt-in): um super admin sintetico SEM
//   vinculo nao le dado de paciente de clinica nenhuma (contato, conversa e
//   mensagem: zero linhas, com o administrador lendo os dele), le
//   equipe_conduzza e ve a marca no painel, nao escreve equipe_conduzza
//   pela sessao, e o administrador da clinica que o convida recebe CZSA1
//   (nada gravado).
// Toda negacao tem o caso positivo ao lado (anti falso positivo). As travas
// por dentro (a corrida, a conta antiga tolerada, cada situacao) estao no
// ensaio da migration (~/.claude/plans/super-admin/ensaio-20261103110000.sql)
// e no teste de integracao do mesmo nome.
//
// O SUPER ADMIN pela sessao so roda com RLS_COM_SUPER_ADMIN=1: o teste cria
// um usuario sintetico com product_admin NO BANCO DE PRODUCAO, com senha
// aleatoria da execucao e e-mail em example.com (dominio reservado, nenhuma
// caixa recebe), e apaga o product_admin no afterAll do bloco e o usuario no
// afterAll geral. Sem a variavel, esse bloco e pulado. NAO rode o opt-in sem
// o ok do dono.
//
// CUIDADO, o banco e o da producao: duas clinicas e_de_teste (o motor e o
// painel as ignoram), apagadas no afterAll (o beforeAll apaga a sobra de uma
// execucao que morreu ha mais de uma hora), e os usuarios desta execucao (a
// marca em equipe_conduzza sai em cascata com eles). Nada aqui usa a id da
// Salud Care, da teste123 nem da Conduzza Teste. ESCRITO, AINDA NAO RODADO
// (roda depois de aplicar a migration: npm run test:rls --
// super-admin-sem-clinica).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar, NESTA ORDEM (as clinicas primeiro).
//   select id, name from public.clinic where slug like 'super-admin-rls-%';
//   delete from public.clinic where slug like 'super-admin-rls-%';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'super-admin-rls-super-%@example.com';
//   select u.id, u.email from auth.users u
//    where u.email like 'super-admin-rls-%@teste.dev'
//       or u.email like 'super-admin-rls-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'super-admin-rls-%@teste.dev'
//       or u.email like 'super-admin-rls-super-%@example.com';

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `SuperAdmin!Rls${sufixo}`;
const COM_SUPER_ADMIN = process.env.RLS_COM_SUPER_ADMIN === "1";

const email = (papel: string) => `super-admin-rls-${papel}-${sufixo}@teste.dev`;
/** O super admin sintetico do bloco opt-in (apagado no afterAll geral). */
const EMAIL_DO_SUPER = `super-admin-rls-super-${sufixo}@example.com`;

/** Marcador do paciente sintetico: o super admin nao pode le-lo. */
const MARCADOR = `PACIENTE SINTETICO SUPER ADMIN ${sufixo}`;
const DIGITOS = sufixo.replace(/\D/g, "").padEnd(4, "3").slice(0, 4);
const TELEFONE_DO_PACIENTE = `+55849783${DIGITOS}3`;

function eDestaExecucao(enderecoDeEmail: string | undefined): boolean {
  return (
    (enderecoDeEmail?.startsWith("super-admin-rls-") ?? false) &&
    ((enderecoDeEmail?.endsWith(`-${sufixo}@teste.dev`) ?? false) ||
      enderecoDeEmail === EMAIL_DO_SUPER)
  );
}

let clinicaA = "";
let clinicaB = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string; hint?: string } | null;

function idDe(papel: string): string {
  const id = ids.get(papel);
  if (!id) {
    throw new Error(`sem usuário ${papel}`);
  }
  return id;
}

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Super admin RLS ${nome} ${sufixo}`,
      slug: `super-admin-rls-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarConta(papelNoEmail: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Super admin RLS ${papelNoEmail}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${papelNoEmail}: ${error?.message ?? "sem conta"}`);
  }
  ids.set(papelNoEmail, data.user.id);
  return data.user.id;
}

async function vincular(
  clinicId: string,
  userId: string,
  role: string,
): Promise<void> {
  await admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: userId, role, status: "ativo" })
    .throwOnError();
}

// Uma sessao por conta, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, SupabaseClient>();

async function entrar(
  enderecoDeEmail: string,
  senha: string,
): Promise<SupabaseClient> {
  const pronta = sessoes.get(enderecoDeEmail);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: enderecoDeEmail,
    password: senha,
  });
  if (error) {
    throw new Error(`login ${enderecoDeEmail}: ${error.message}`);
  }
  sessoes.set(enderecoDeEmail, cliente);
  return cliente;
}

const logado = (papel: string) => entrar(email(papel), SENHA);

/** Quantas linhas de cada tabela de paciente da A a sessao le. */
async function pacienteDaA(cliente: SupabaseClient): Promise<string> {
  const contar = async (tabela: string) => {
    const { count, error } = await cliente
      .from(tabela)
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicaA);
    return error ? `erro ${error.code}` : String(count ?? 0);
  };
  return [
    await contar("contact"),
    await contar("conversation"),
    await contar("message"),
  ].join(":");
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "super-admin-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  await vincular(clinicaA, await criarConta("admin-a"), "admin");
  await vincular(clinicaA, await criarConta("equipe"), "admin");
  await vincular(clinicaB, await criarConta("admin-b"), "admin");
  await criarConta("livre");

  // A pessoa marcada: conta normal, administradora da A, na equipe Conduzza
  // (so a service role escreve).
  await admin
    .from("equipe_conduzza")
    .insert({ user_id: idDe("equipe") })
    .throwOnError();

  // O paciente sintetico da A.
  const numeroA = await criarNumeroDeTeste(admin, clinicaA, {
    nome: "Recepção",
  });
  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: TELEFONE_DO_PACIENTE,
      name: MARCADOR,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: (contato as { id: string }).id,
      whatsapp_account_id: numeroA.id,
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("message")
    .insert({
      clinic_id: clinicaA,
      conversation_id: (conversa as { id: string }).id,
      direction: "entrada",
      author: "paciente",
      content_type: "texto",
      body: `${MARCADOR}: mensagem sintética`,
    })
    .throwOnError();
}, 120_000);

afterAll(async () => {
  // As clinicas PRIMEIRO (vinculos, contato, conversa e mensagem vao em
  // cascata). Depois, os usuarios desta execucao, o super admin sintetico
  // inclusive (a marca em equipe_conduzza sai em cascata), com o erro
  // conferido: limpeza que falha calada deixaria usuario na producao.
  const clinicas = [clinicaA, clinicaB].filter((id) => id !== "");
  if (clinicas.length > 0) {
    const { error } = await admin.from("clinic").delete().in("id", clinicas);
    expect(error, "apagar as clinicas do teste").toBeNull();
  }
  const usuarios: string[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const lista = data?.users ?? [];
    for (const usuario of lista) {
      if (eDestaExecucao(usuario.email)) {
        usuarios.push(usuario.id);
      }
    }
    if (lista.length < 200) {
      break;
    }
  }
  const falhas: string[] = [];
  for (const id of usuarios) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("equipe_conduzza: quem lê e quem escreve", () => {
  it("a service role lê a marca (contraprova)", async () => {
    const { data, error } = await admin
      .from("equipe_conduzza")
      .select("user_id")
      .eq("user_id", idDe("equipe"));
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: idDe("equipe") }]);
  });

  it("anon não lê (42501)", async () => {
    const { data, error } = await anonClient()
      .from("equipe_conduzza")
      .select("user_id");
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(data).toBeNull();
  });

  it("a sessão de clínica lê zero linhas: o administrador e a própria pessoa marcada", async () => {
    for (const papel of ["admin-a", "equipe", "admin-b"]) {
      const { data, error } = await (
        await logado(papel)
      )
        .from("equipe_conduzza")
        .select("user_id");
      expect(error, papel).toBeNull();
      expect(data, papel).toEqual([]);
    }
  });

  it("ninguém escreve pela sessão (42501)", async () => {
    const adminA = await logado("admin-a");
    const tentativas = [
      await adminA.from("equipe_conduzza").insert({ user_id: idDe("admin-a") }),
      await adminA
        .from("equipe_conduzza")
        .update({ marcado_por: idDe("admin-a") })
        .eq("user_id", idDe("equipe")),
      await adminA
        .from("equipe_conduzza")
        .delete()
        .eq("user_id", idDe("equipe")),
      await anonClient()
        .from("equipe_conduzza")
        .insert({ user_id: idDe("livre") }),
    ];
    for (const [indice, { error }] of tentativas.entries()) {
      expect((error as Erro)?.code, `tentativa ${indice}`).toBe(
        PERMISSAO_NEGADA,
      );
    }
    // Nada mudou.
    const { data } = await admin.from("equipe_conduzza").select("user_id");
    const marcadas = ((data ?? []) as { user_id: string }[]).map(
      (l) => l.user_id,
    );
    expect(marcadas).toContain(idDe("equipe"));
    expect(marcadas).not.toContain(idDe("admin-a"));
    expect(marcadas).not.toContain(idDe("livre"));
  });
});

describe("a marca não dá poder de super admin", () => {
  it("is_product_admin() falso e as funções do painel recusam (42501)", async () => {
    const equipe = await logado("equipe");
    const { data: ehSuper, error } = await equipe.rpc("is_product_admin");
    expect(error).toBeNull();
    expect(ehSuper).toBe(false);
    for (const [nome, args] of [
      ["painel_cs_das_clinicas", {}],
      ["equipe_da_clinica_no_painel", { p_clinic_id: clinicaB }],
      ["notas_da_clinica_no_painel", { p_clinic_id: clinicaB }],
      ["historico_da_clinica_no_painel", { p_clinic_id: clinicaB }],
    ] as const) {
      const { data, error: erro } = await equipe.rpc(nome, args);
      expect((erro as Erro)?.code, nome).toBe(PERMISSAO_NEGADA);
      expect(data, nome).toBeNull();
    }
  });

  it("a pessoa marcada lê só a clínica de que é membro", async () => {
    const equipe = await logado("equipe");
    const { data: b } = await equipe
      .from("clinic")
      .select("id")
      .eq("id", clinicaB);
    expect(b).toEqual([]);
    const { data: a } = await equipe
      .from("clinic")
      .select("id")
      .eq("id", clinicaA);
    expect(a).toEqual([{ id: clinicaA }]);
  });
});

describe("a trava não atrapalha a conta normal", () => {
  it("o administrador convida a conta normal e a pessoa marcada, e os vínculos entram", async () => {
    const adminB = await logado("admin-b");
    for (const papel of ["livre", "equipe"]) {
      const { error } = await adminB.from("clinic_member").insert({
        clinic_id: clinicaB,
        user_id: idDe(papel),
        role: "recepcao",
        status: "ativo",
      });
      expect(error, papel).toBeNull();
    }
    const { data } = await admin
      .from("clinic_member")
      .select("user_id")
      .eq("clinic_id", clinicaB);
    expect(
      ((data ?? []) as { user_id: string }[]).map((l) => l.user_id),
    ).toEqual(expect.arrayContaining([idDe("livre"), idDe("equipe")]));
  });
});

// O super admin pela sessao: so com RLS_COM_SUPER_ADMIN=1 (cabecalho).
describe.skipIf(!COM_SUPER_ADMIN)("o super admin sem vínculo (opt-in)", () => {
  const senhaDoSuper = `${crypto.randomUUID()}!Aa1`;
  let superAdmin = "";
  let sessaoDoSuper: SupabaseClient | null = null;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL_DO_SUPER,
      password: senhaDoSuper,
      email_confirm: true,
      user_metadata: { name: "Super admin sintético" },
    });
    if (error || !data.user) {
      throw new Error(`criar super admin: ${error?.message ?? "sem conta"}`);
    }
    superAdmin = data.user.id;
    await admin
      .from("product_admin")
      .insert({ user_id: superAdmin })
      .throwOnError();
    sessaoDoSuper = await entrar(EMAIL_DO_SUPER, senhaDoSuper);
  }, 60_000);

  afterAll(async () => {
    if (superAdmin) {
      // So o product_admin sai aqui; o usuario sai no afterAll geral.
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  function sessao(): SupabaseClient {
    if (!sessaoDoSuper) {
      throw new Error("sem a sessão do super admin");
    }
    return sessaoDoSuper;
  }

  it("não lê dado de paciente de clínica nenhuma (o administrador lê o dele)", async () => {
    expect(await pacienteDaA(await logado("admin-a"))).toBe("1:1:1");
    expect(await pacienteDaA(sessao())).toBe("0:0:0");
    // Nem com o filtro de outra clinica, nem sem filtro nenhum.
    for (const tabela of ["contact", "conversation", "message"]) {
      const { count, error } = await sessao()
        .from(tabela)
        .select("id", { count: "exact", head: true })
        .in("clinic_id", [clinicaA, clinicaB]);
      expect(error, tabela).toBeNull();
      expect(count, tabela).toBe(0);
    }
    const { data: contatos } = await sessao()
      .from("contact")
      .select("name")
      .eq("name", MARCADOR);
    expect(contatos).toEqual([]);
  });

  it("lê equipe_conduzza e vê a marca no painel", async () => {
    const { data, error } = await sessao()
      .from("equipe_conduzza")
      .select("user_id")
      .eq("user_id", idDe("equipe"));
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: idDe("equipe") }]);

    const { data: equipe, error: erroEquipe } = await sessao().rpc(
      "equipe_da_clinica_no_painel",
      { p_clinic_id: clinicaA },
    );
    expect(erroEquipe).toBeNull();
    const pessoas = (
      equipe as { equipe: { user_id: string; equipe_conduzza: boolean }[] }
    ).equipe;
    expect(pessoas.find((p) => p.user_id === idDe("equipe"))).toMatchObject({
      equipe_conduzza: true,
    });
    expect(pessoas.find((p) => p.user_id === idDe("admin-a"))).toMatchObject({
      equipe_conduzza: false,
    });
  });

  it("não escreve equipe_conduzza pela sessão (42501)", async () => {
    const { error } = await sessao()
      .from("equipe_conduzza")
      .insert({ user_id: idDe("livre") });
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("o administrador que convida o super admin recebe CZSA1, e nada entra", async () => {
    const adminA = await logado("admin-a");
    const { error } = await adminA.from("clinic_member").insert({
      clinic_id: clinicaA,
      user_id: superAdmin,
      role: "recepcao",
      status: "ativo",
    });
    expect((error as Erro)?.code).toBe("CZSA1");
    expect((error as Erro)?.message).toBe(
      "Esta conta é da equipe Conduzza e não entra em clínica.",
    );
    const { data } = await admin
      .from("clinic_member")
      .select("clinic_id")
      .eq("user_id", superAdmin);
    expect(data).toEqual([]);
  });
});
