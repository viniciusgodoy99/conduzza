import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "../rls/stack";

// O super admin numa conta so para o painel (decisao do dono de 03/11/2026,
// "Conta propria so para o painel"; migration
// 20261103110000_super_admin_sem_clinica.sql), contra o banco REAL, pela
// service role. O que esta em jogo:
// - a marca no painel: a conta normal, membro ativo da A e marcada em
//   equipe_conduzza, aparece como equipe Conduzza na lista (o ultimo acesso,
//   quando e dela, e membros_equipe_conduzza), na equipe, nas notas e no
//   historico; as contagens e a lista de pessoas nao dobram; sem a marca,
//   ninguem e equipe Conduzza (contraprova). E o que segura o uso das contas
//   antigas, depois da limpeza, fora do uso do cliente;
// - a marca sai junto com a conta (FK com cascata);
// - a trava nao atrapalha a conta normal (o vinculo entra, nas tres
//   situacoes);
// - com INTEGRACAO_COM_SUPER_ADMIN=1 (opt-in): um super admin sintetico SEM
//   vinculo nao entra em clinica (CZSA1, ativo, pendente ou inativo, com a
//   mensagem exata, nada gravado); a conta com vinculo (ativo, ou so com o
//   acesso tirado) nao vira super admin (CZSA2, nada gravado).
// A conta antiga tolerada, a passagem de situacao, a corrida e o rollback
// estao no ensaio da migration
// (~/.claude/plans/super-admin/ensaio-20261103110000.sql e
// ~/.claude/plans/super-admin/banco/corrida/), porque precisam de linhas que
// ja existiam antes da trava ou de duas transacoes ao mesmo tempo. A RLS de
// equipe_conduzza esta em tests/rls/super-admin-sem-clinica.test.ts.
//
// Desde esta migration, o bloco opt-in de tests/integration/painel-cs.test.ts
// que vinculava um super admin sintetico a uma clinica saiu (o banco recusa):
// o uso da equipe Conduzza numa clinica, marcado, e provado aqui, pela
// equipe_conduzza.
//
// CUIDADO, o banco e o da producao: duas clinicas e_de_teste, apagadas no
// afterAll (vinculos, notas e trilha vao em cascata; o beforeAll apaga a
// sobra de uma execucao que morreu ha mais de uma hora), e os usuarios desta
// execucao (a marca em equipe_conduzza sai em cascata com eles). Nada aqui
// usa a id da Salud Care, da teste123 nem da Conduzza Teste. ESCRITO, AINDA
// NAO RODADO (roda depois de aplicar a migration: npm run test:integration
// -- super-admin-sem-clinica). O opt-in cria e apaga um super admin
// sintetico na producao: NAO rode sem o ok do dono.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'super-admin-int-%';
//   delete from public.clinic where slug like 'super-admin-int-%';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'super-admin-int-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'super-admin-int-%@teste.dev'
//       or u.email like 'super-admin-int-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'super-admin-int-%@teste.dev'
//       or u.email like 'super-admin-int-super-%@example.com';

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `SuperAdminInt!${sufixo}`;
const COM_SUPER_ADMIN = process.env.INTEGRACAO_COM_SUPER_ADMIN === "1";
const MENSAGEM_CZSA1 =
  "Esta conta é da equipe Conduzza e não entra em clínica.";
const MENSAGEM_CZSA2 =
  "Esta conta participa de uma clínica e não vira super admin.";

const email = (papel: string) => `super-admin-int-${papel}-${sufixo}@teste.dev`;
const EMAIL_DO_SUPER = `super-admin-int-super-${sufixo}@example.com`;

let clinicaA = "";
let clinicaB = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string } | null;

type LinhaDoPainel = {
  id: string;
  ultimo_acesso: { user_id: string; equipe_conduzza: boolean } | null;
  membros_ativos: number;
  membros_equipe_conduzza: number;
  pessoas: { nome: string | null; email: string | null }[];
};
type Pessoa = { user_id: string; equipe_conduzza: boolean };
type Equipe = { equipe: Pessoa[]; implementadores: Pessoa[] };
type Notas = {
  notas: { texto: string; autor: { equipe_conduzza: boolean } | null }[];
};
type Historico = {
  eventos: { acao: string; quem: { equipe_conduzza: boolean } | null }[];
};

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
      name: `Super admin int ${nome} ${sufixo}`,
      slug: `super-admin-int-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarConta(
  papelNoEmail: string,
  enderecoDeEmail = email(papelNoEmail),
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: enderecoDeEmail,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Super admin int ${papelNoEmail}` },
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
  status = "ativo",
) {
  return admin
    .from("clinic_member")
    .insert({ clinic_id: clinicId, user_id: userId, role, status });
}

async function entrar(enderecoDeEmail: string): Promise<void> {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: enderecoDeEmail,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login: ${error.message}`);
  }
  await cliente.auth.signOut();
}

async function linhaDaA(): Promise<LinhaDoPainel> {
  const { data, error } = await admin.rpc("painel_cs_das_clinicas", {
    p_incluir_teste: true,
  });
  expect(error).toBeNull();
  const achada = (data as { clinicas: LinhaDoPainel[] }).clinicas.filter(
    (c) => c.id === clinicaA,
  );
  expect(achada, "a A aparece uma vez so").toHaveLength(1);
  return achada[0] as LinhaDoPainel;
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(nome, args);
  expect(error, nome).toBeNull();
  return data as T;
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function marcar(userId: string): Promise<void> {
  await admin
    .from("equipe_conduzza")
    .insert({ user_id: userId })
    .throwOnError();
}

async function desmarcar(userId: string): Promise<void> {
  await admin
    .from("equipe_conduzza")
    .delete()
    .eq("user_id", userId)
    .throwOnError();
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "super-admin-int-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  for (const [clinica, papel] of [
    [clinicaA, "admin-a"],
    [clinicaA, "equipe"],
    [clinicaB, "admin-b"],
  ] as const) {
    const { error } = await vincular(clinica, await criarConta(papel), "admin");
    if (error) {
      throw new Error(`vincular ${papel}: ${error.message}`);
    }
  }

  // A nota interna e a linha do historico da A escritas pela pessoa que vai
  // ser marcada (a service role grava direto, como o dono no SQL editor), e
  // as do administrador.
  await admin
    .from("nota_interna_da_clinica")
    .insert([
      {
        clinic_id: clinicaA,
        autor_user_id: idDe("equipe"),
        texto: "Nota da equipe",
      },
      {
        clinic_id: clinicaA,
        autor_user_id: idDe("admin-a"),
        texto: "Nota de fora",
      },
    ])
    .throwOnError();
  await admin
    .from("audit_log")
    .insert([
      {
        clinic_id: clinicaA,
        user_id: idDe("equipe"),
        action: "mudou_teto_da_ia",
        entity: "ia_liberacao",
        entity_id: clinicaA,
        detalhes: { teto_diario_centavos_usd: 500 },
      },
      {
        clinic_id: clinicaA,
        user_id: idDe("admin-a"),
        action: "suspendeu_clinica",
        entity: "clinic",
        entity_id: clinicaA,
        detalhes: { motivo: "Teste de integração" },
      },
    ])
    .throwOnError();

  // A pessoa marcada entra por ULTIMO: o ultimo acesso da A e dela.
  await entrar(email("admin-a"));
  await pausa(1_100);
  await entrar(email("equipe"));
}, 120_000);

afterAll(async () => {
  const clinicas = [clinicaA, clinicaB].filter((id) => id !== "");
  if (clinicas.length > 0) {
    const { error } = await admin.from("clinic").delete().in("id", clinicas);
    expect(error, "apagar as clinicas do teste").toBeNull();
  }
  const falhas: string[] = [];
  for (const id of ids.values()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
}, 60_000);

describe("a marca da equipe Conduzza no painel (equipe_conduzza)", () => {
  it("sem a marca, ninguém da A é equipe Conduzza (contraprova)", async () => {
    const a = await linhaDaA();
    expect(a.ultimo_acesso?.user_id).toBe(idDe("equipe"));
    expect(a.ultimo_acesso?.equipe_conduzza).toBe(false);
    expect(a.membros_equipe_conduzza).toBe(0);
    expect(a.membros_ativos).toBe(2);
  });

  it("com a marca: o último acesso, a contagem, a equipe, as notas e o histórico, sem dobrar nada", async () => {
    await marcar(idDe("equipe"));
    try {
      const a = await linhaDaA();
      expect(a.ultimo_acesso).toMatchObject({
        user_id: idDe("equipe"),
        equipe_conduzza: true,
      });
      expect(a.membros_equipe_conduzza).toBe(1);
      expect(a.membros_ativos).toBe(2);
      expect(a.pessoas).toHaveLength(2);

      const equipe = await rpc<Equipe>("equipe_da_clinica_no_painel", {
        p_clinic_id: clinicaA,
      });
      const pessoas = [...equipe.equipe, ...equipe.implementadores];
      expect(pessoas).toHaveLength(2);
      expect(pessoas.find((p) => p.user_id === idDe("equipe"))).toMatchObject({
        equipe_conduzza: true,
      });
      expect(pessoas.find((p) => p.user_id === idDe("admin-a"))).toMatchObject({
        equipe_conduzza: false,
      });

      const notas = await rpc<Notas>("notas_da_clinica_no_painel", {
        p_clinic_id: clinicaA,
      });
      expect(notas.notas).toHaveLength(2);
      expect(
        Object.fromEntries(
          notas.notas.map((n) => [n.texto, n.autor?.equipe_conduzza]),
        ),
      ).toEqual({ "Nota da equipe": true, "Nota de fora": false });

      const historico = await rpc<Historico>("historico_da_clinica_no_painel", {
        p_clinic_id: clinicaA,
      });
      expect(historico.eventos).toHaveLength(2);
      expect(
        Object.fromEntries(
          historico.eventos.map((e) => [e.acao, e.quem?.equipe_conduzza]),
        ),
      ).toEqual({ mudou_teto_da_ia: true, suspendeu_clinica: false });
    } finally {
      await desmarcar(idDe("equipe"));
    }
    // Sem a marca de novo, volta ao de antes.
    expect((await linhaDaA()).membros_equipe_conduzza).toBe(0);
  });

  it("a marca sai junto com a conta (cascata)", async () => {
    const userId = await criarConta("descartavel");
    await marcar(userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    expect(error).toBeNull();
    ids.delete("descartavel");
    const { data } = await admin
      .from("equipe_conduzza")
      .select("user_id")
      .eq("user_id", userId);
    expect(data).toEqual([]);
  });
});

describe("a trava não atrapalha a conta normal", () => {
  it("o vínculo entra ativo, pendente e inativo, e a pessoa marcada entra em outra clínica", async () => {
    const livre = await criarConta("livre");
    const pendente = await criarConta("pendente");
    const inativo = await criarConta("inativo");
    expect((await vincular(clinicaB, livre, "recepcao")).error).toBeNull();
    expect(
      (await vincular(clinicaB, pendente, "leitura", "pendente")).error,
    ).toBeNull();
    expect(
      (await vincular(clinicaB, inativo, "recepcao", "inativo")).error,
    ).toBeNull();
    await marcar(idDe("equipe"));
    try {
      expect(
        (await vincular(clinicaB, idDe("equipe"), "recepcao")).error,
      ).toBeNull();
    } finally {
      await desmarcar(idDe("equipe"));
    }
  });
});

// O super admin sintetico: so com INTEGRACAO_COM_SUPER_ADMIN=1.
describe.skipIf(!COM_SUPER_ADMIN)("a trava com um super admin (opt-in)", () => {
  let superAdmin = "";

  beforeAll(async () => {
    superAdmin = await criarConta("super", EMAIL_DO_SUPER);
    await admin
      .from("product_admin")
      .insert({ user_id: superAdmin })
      .throwOnError();
  }, 60_000);

  afterAll(async () => {
    if (superAdmin) {
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  it("o super admin sem vínculo não entra em clínica (CZSA1), em situação nenhuma", async () => {
    for (const situacao of ["ativo", "pendente", "inativo"]) {
      const { error } = await vincular(
        clinicaB,
        superAdmin,
        "leitura",
        situacao,
      );
      expect((error as Erro)?.code, situacao).toBe("CZSA1");
      expect((error as Erro)?.message, situacao).toBe(MENSAGEM_CZSA1);
    }
    const { data } = await admin
      .from("clinic_member")
      .select("clinic_id")
      .eq("user_id", superAdmin);
    expect(data).toEqual([]);
  });

  it("a conta com vínculo não vira super admin (CZSA2): ativo, ou só com o acesso tirado", async () => {
    const soInativo = await criarConta("so-inativo");
    expect(
      (await vincular(clinicaB, soInativo, "recepcao", "inativo")).error,
    ).toBeNull();
    try {
      for (const userId of [idDe("admin-b"), soInativo]) {
        const { error } = await admin
          .from("product_admin")
          .insert({ user_id: userId });
        expect((error as Erro)?.code).toBe("CZSA2");
        expect((error as Erro)?.message).toBe(MENSAGEM_CZSA2);
      }
    } finally {
      // Se a trava falhar, nenhuma conta de teste fica super admin.
      await admin
        .from("product_admin")
        .delete()
        .in("user_id", [idDe("admin-b"), soInativo]);
    }
  });
});
