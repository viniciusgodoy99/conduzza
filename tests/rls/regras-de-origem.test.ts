import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Onda 5, item 17 (migration 20261025100000_regras_de_origem.sql): as regras
// de origem dos leads (campaign_link) pela API, com JWT real de cada papel.
// O que esta em jogo:
// - administrador e gestor criam, editam, desativam e excluem; recepcao,
//   profissional, leitura e pendente recebem 42501 no INSERT (mesmo com a
//   linha invalida: a policy vem antes do CHECK) e 0 linhas no UPDATE e no
//   DELETE; o membro ativo le, o pendente nao;
// - a clinica A nao le nem escreve na B, e o contrario, com a contraprova
//   de que as linhas existem;
// - cada CHECK recusa com 23514 e o nome dele (a action traduz pelo nome):
//   palavra-chave de 1 e de 3 letras (P17-4: minimo de 4), 21
//   palavras-chave, codigo fora do alfabeto ou minusculo, regra sem jeito de
//   reconhecer, mensagem pronta curta ou de 2 palavras (P17-4: 15
//   caracteres e 3 palavras), nome de 1 letra, origem de 121;
// - as linhas que as outras suites gravam continuam passando;
// - ate 50 origens ATIVAS por clinica (P17-8): a 51a recusa com P0001 e a
//   chave limite_de_origens_ativas (nunca 40001), a desativada entra,
//   ativa-la recusa, a outra clinica nao sente, e quem nao gerencia recebe
//   42501 (nunca a recusa do limite);
// - anon sem grant (42501).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (o motor e a
// ingestao de producao nao as usam para nada), apagadas no afterAll com as
// regras (cascata) e os usuarios desta execucao. Nada aqui usa a id da
// salud-care, da teste123 nem da Conduzza Teste. ESCRITO, AINDA NAO RODADO
// (roda depois de aplicar a migration: npm run test:rls -- regras-de-origem).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar, NESTA ORDEM (as clinicas primeiro).
//   select id, name from public.clinic where slug like 'regras-origem-rls-%';
//   delete from public.clinic where slug like 'regras-origem-rls-%';
//   select u.id, u.email from auth.users u where u.email like 'regras-origem-%@teste.dev';
//   delete from auth.users u where u.email like 'regras-origem-%@teste.dev';

const PERMISSAO_NEGADA = "42501";
const CHECK_VIOLADO = "23514";
const LIMITE = 50;

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `RegrasOrigem!Rls${sufixo}`;

const email = (papel: string) => `regras-origem-${papel}-${sufixo}@teste.dev`;

let clinicaA = "";
let clinicaB = "";
let regraDaA = "";
let regraDaB = "";

type Erro = { code?: string; message?: string; details?: string } | null;

type CamposDaRegra = {
  name: string;
  channel?: string;
  token?: string | null;
  origin?: string | null;
  medium?: string | null;
  campaign?: string | null;
  default_message?: string | null;
  keywords?: string[];
  active?: boolean;
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Regras Origem RLS ${nome} ${sufixo}`,
      slug: `regras-origem-rls-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarUsuario(
  papelNoEmail: string,
  clinicId: string,
  role: string,
  status = "ativo",
  professionalId?: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Regras ${papelNoEmail}` },
  });
  if (error || !data.user) {
    throw new Error(
      `criar ${papelNoEmail}: ${error?.message ?? "sem usuário"}`,
    );
  }
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status,
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
    .throwOnError();
}

// Uma sessao por papel, reaproveitada (o Auth limita a taxa de login).
const sessoes = new Map<string, SupabaseClient>();

async function logado(papelNoEmail: string): Promise<SupabaseClient> {
  const pronta = sessoes.get(papelNoEmail);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papelNoEmail),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papelNoEmail}: ${error.message}`);
  }
  sessoes.set(papelNoEmail, cliente);
  return cliente;
}

function regra(clinicId: string, campos: CamposDaRegra) {
  return { clinic_id: clinicId, channel: "redes_sociais", ...campos };
}

async function criarPeloServidor(
  clinicId: string,
  campos: CamposDaRegra,
): Promise<string> {
  const { data } = await admin
    .from("campaign_link")
    .insert(regra(clinicId, campos))
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function regrasVisiveis(
  cliente: SupabaseClient,
  clinicId: string,
): Promise<number> {
  const { data, error } = await cliente
    .from("campaign_link")
    .select("id")
    .eq("clinic_id", clinicId);
  expect(error).toBeNull();
  return (data ?? []).length;
}

async function ativasDaClinica(clinicId: string): Promise<number> {
  const { count } = await admin
    .from("campaign_link")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .throwOnError();
  return count ?? 0;
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Regras de Origem" })
    .select("id")
    .single()
    .throwOnError();

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario(
    "prof-a",
    clinicaA,
    "profissional",
    "ativo",
    (prof as { id: string }).id,
  );
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("pendente-a", clinicaA, "leitura", "pendente");
  await criarUsuario("admin-b", clinicaB, "admin");
  await criarUsuario("gestor-b", clinicaB, "gestor");

  regraDaA = await criarPeloServidor(clinicaA, {
    name: "Link da bio do Instagram",
    origin: "Instagram",
    medium: "Bio",
    default_message: "Olá! Vim pelo link da bio e quero agendar",
    token: "K7Q2MX",
  });
  regraDaB = await criarPeloServidor(clinicaB, {
    name: "Perfil no Google",
    channel: "busca_organica",
    origin: "Google",
    keywords: ["perfil"],
  });
});

afterAll(async () => {
  // As clinicas primeiro (as regras vao em cascata), depois os usuarios
  // desta execucao, com o erro conferido: limpeza que falha calada deixaria
  // usuario sintetico na producao.
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .in("id", [clinicaA, clinicaB]);
  expect(erroDasClinicas, "apagar as clinicas do teste").toBeNull();
  const ids: string[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 200,
    });
    const usuarios = data?.users ?? [];
    for (const usuario of usuarios) {
      if (usuario.email?.endsWith(`-${sufixo}@teste.dev`)) {
        ids.push(usuario.id);
      }
    }
    if (usuarios.length < 200) {
      break;
    }
  }
  const falhas: string[] = [];
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      falhas.push(`${id}: ${error.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
});

describe("quem gerencia as origens", () => {
  it.each(["admin-a", "gestor-a"])(
    "%s cria, edita, desativa e exclui",
    async (papel) => {
      const cliente = await logado(papel);
      const { data: criada, error: erroCriar } = await cliente
        .from("campaign_link")
        .insert(
          regra(clinicaA, {
            name: `Origem de ${papel}`,
            keywords: ["parceria"],
          }),
        )
        .select("id")
        .single();
      expect(erroCriar).toBeNull();
      const id = (criada as { id: string }).id;

      const { data: editada } = await cliente
        .from("campaign_link")
        .update({ name: `Origem editada de ${papel}` })
        .eq("id", id)
        .select("id");
      expect(editada).toHaveLength(1);

      const { data: desativada } = await cliente
        .from("campaign_link")
        .update({ active: false })
        .eq("id", id)
        .select("id");
      expect(desativada).toHaveLength(1);

      const { data: excluida } = await cliente
        .from("campaign_link")
        .delete()
        .eq("id", id)
        .select("id");
      expect(excluida).toHaveLength(1);
    },
  );

  it.each(["recepcao-a", "prof-a", "leitura-a", "pendente-a"])(
    "%s recebe 42501 no INSERT e não edita nem exclui",
    async (papel) => {
      const cliente = await logado(papel);
      const { error: erroCriar } = await cliente
        .from("campaign_link")
        .insert(
          regra(clinicaA, { name: "Não deveria entrar", token: "Z2Z2Z2" }),
        );
      expect((erroCriar as Erro)?.code).toBe(PERMISSAO_NEGADA);

      const { data: editadas } = await cliente
        .from("campaign_link")
        .update({ name: "Sequestrada" })
        .eq("id", regraDaA)
        .select("id");
      expect(editadas ?? []).toHaveLength(0);

      const { data: excluidas } = await cliente
        .from("campaign_link")
        .delete()
        .eq("id", regraDaA)
        .select("id");
      expect(excluidas ?? []).toHaveLength(0);

      // Contraprova: a regra continua como estava.
      const { data: intacta } = await admin
        .from("campaign_link")
        .select("name")
        .eq("id", regraDaA)
        .single()
        .throwOnError();
      expect((intacta as { name: string }).name).toBe(
        "Link da bio do Instagram",
      );
    },
  );

  it("a policy vem antes do CHECK: quem não gerencia recebe 42501 mesmo com a linha inválida", async () => {
    for (const papel of ["recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      const { error } = await cliente
        .from("campaign_link")
        .insert(regra(clinicaA, { name: "Sem jeito de reconhecer" }));
      expect((error as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
    }
    // Contraprova: a mesma linha, pelo administrador, cai no CHECK.
    const adminA = await logado("admin-a");
    const { error } = await adminA
      .from("campaign_link")
      .insert(regra(clinicaA, { name: "Sem jeito de reconhecer" }));
    expect((error as Erro)?.code).toBe(CHECK_VIOLADO);
    expect((error as Erro)?.message).toContain("campaign_link_reconhece_algo");
  });

  it("o membro ativo lê as regras da clínica; o pendente não", async () => {
    for (const papel of [
      "admin-a",
      "gestor-a",
      "recepcao-a",
      "prof-a",
      "leitura-a",
    ]) {
      expect(
        await regrasVisiveis(await logado(papel), clinicaA),
        papel,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(await regrasVisiveis(await logado("pendente-a"), clinicaA)).toBe(0);
  });

  it("anon não lê nem escreve (sem grant)", async () => {
    const anon = anonClient();
    const { error: erroLer } = await anon
      .from("campaign_link")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect((erroLer as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroCriar } = await anon
      .from("campaign_link")
      .insert(regra(clinicaA, { name: "Anônima", token: "Z3Z3Z3" }));
    expect((erroCriar as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("isolamento entre clínicas", () => {
  it("a clínica B não lê nem escreve nas regras da A", async () => {
    // Contraprova: as regras da A existem.
    expect(await regrasVisiveis(admin, clinicaA)).toBeGreaterThanOrEqual(1);
    for (const papel of ["admin-b", "gestor-b"]) {
      const cliente = await logado(papel);
      expect(await regrasVisiveis(cliente, clinicaA), papel).toBe(0);
      const { error: erroCriar } = await cliente
        .from("campaign_link")
        .insert(regra(clinicaA, { name: "Invasão", token: "Z4Z4Z4" }));
      expect((erroCriar as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
      const { data: editadas } = await cliente
        .from("campaign_link")
        .update({ name: "Sequestrada" })
        .eq("id", regraDaA)
        .select("id");
      expect(editadas ?? [], papel).toHaveLength(0);
      const { data: excluidas } = await cliente
        .from("campaign_link")
        .delete()
        .eq("id", regraDaA)
        .select("id");
      expect(excluidas ?? [], papel).toHaveLength(0);
    }
  });

  it("a clínica A não lê nem escreve nas regras da B", async () => {
    expect(await regrasVisiveis(admin, clinicaB)).toBeGreaterThanOrEqual(1);
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      expect(await regrasVisiveis(cliente, clinicaB), papel).toBe(0);
      const { error: erroCriar } = await cliente
        .from("campaign_link")
        .insert(regra(clinicaB, { name: "Invasão", keywords: ["invasao"] }));
      expect((erroCriar as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
      const { data: editadas } = await cliente
        .from("campaign_link")
        .update({ name: "Sequestrada" })
        .eq("id", regraDaB)
        .select("id");
      expect(editadas ?? [], papel).toHaveLength(0);
      const { data: excluidas } = await cliente
        .from("campaign_link")
        .delete()
        .eq("id", regraDaB)
        .select("id");
      expect(excluidas ?? [], papel).toHaveLength(0);
    }
  });
});

describe("os CHECKs (pelo administrador, que passa pela RLS)", () => {
  const casos: { rotulo: string; campos: CamposDaRegra; check: string }[] = [
    {
      rotulo: "palavra-chave de 1 letra",
      campos: { name: "Palavra curta", keywords: ["a"] },
      check: "campaign_link_palavras_no_formato",
    },
    {
      rotulo: "palavra-chave de 3 letras (P17-4)",
      campos: { name: "Palavra curta", keywords: ["bio"] },
      check: "campaign_link_palavras_no_formato",
    },
    {
      rotulo: "21 palavras-chave",
      campos: {
        name: "Palavras demais",
        keywords: Array.from({ length: 21 }, (_, i) => `palavra${i}`),
      },
      check: "campaign_link_palavras_de_1_dimensao",
    },
    {
      rotulo: "código com 0 (fora do alfabeto)",
      campos: { name: "Código errado", token: "K7Q2M0" },
      check: "campaign_link_codigo",
    },
    {
      rotulo: "código minúsculo",
      campos: { name: "Código minúsculo", token: "k7q2mx" },
      check: "campaign_link_codigo",
    },
    {
      rotulo: "regra sem jeito de reconhecer",
      campos: { name: "Nada" },
      check: "campaign_link_reconhece_algo",
    },
    {
      rotulo: "mensagem pronta de saudação (P17-4)",
      campos: { name: "Saudação", default_message: "Olá, bom dia!" },
      check: "campaign_link_mensagem",
    },
    {
      rotulo: "mensagem pronta de 2 palavras (P17-4)",
      campos: {
        name: "Duas palavras",
        default_message: "Olaaaaaaa booooooooom",
      },
      check: "campaign_link_mensagem",
    },
    {
      rotulo: "nome de 1 letra",
      campos: { name: "A", token: "Z5Z5Z5" },
      check: "campaign_link_nome",
    },
    {
      rotulo: "origem de 121 caracteres",
      campos: {
        name: "Origem longa",
        token: "Z6Z6Z6",
        origin: "o".repeat(121),
      },
      check: "campaign_link_textos",
    },
  ];

  it.each(casos)(
    "$rotulo: 23514 com o nome do CHECK",
    async ({ campos, check }) => {
      const adminA = await logado("admin-a");
      const { error } = await adminA
        .from("campaign_link")
        .insert(regra(clinicaA, campos));
      expect((error as Erro)?.code).toBe(CHECK_VIOLADO);
      expect((error as Erro)?.message).toContain(check);
    },
  );

  it("as linhas que as outras suítes gravam continuam passando", async () => {
    const adminA = await logado("admin-a");
    const linhas: CamposDaRegra[] = [
      {
        name: "Campanha A",
        token: "B4TQX7",
        channel: "trafego_pago",
        campaign: "Campanha A",
      },
      {
        name: "Campanha Tardia",
        token: "H5N7P2",
        channel: "trafego_pago",
        keywords: ["botox"],
      },
      {
        name: "Palavra agendar",
        channel: "busca_organica",
        keywords: ["agendar"],
      },
      {
        name: "Palavra avaliação",
        origin: "Instagram orgânico",
        keywords: ["avaliação"],
      },
      {
        name: "Botão do site",
        channel: "busca_organica",
        origin: "Site",
        default_message: "Olá! Quero agendar uma avaliação",
      },
    ];
    for (const campos of linhas) {
      const { error } = await adminA
        .from("campaign_link")
        .insert(regra(clinicaA, campos));
      expect(error, campos.name).toBeNull();
    }
  });
});

describe("até 50 origens ativas por clínica (P17-8)", () => {
  const extras: string[] = [];

  afterAll(async () => {
    if (extras.length > 0) {
      await admin.from("campaign_link").delete().in("id", extras);
    }
  });

  it("a 51ª ativa recusa com P0001 e a chave; a desativada entra; ativá-la recusa; a B não sente", async () => {
    const faltam = LIMITE - (await ativasDaClinica(clinicaA));
    expect(faltam).toBeGreaterThan(0);
    const { data: lote } = await admin
      .from("campaign_link")
      .insert(
        Array.from({ length: faltam }, (_, i) =>
          regra(clinicaA, { name: `Limite ${i}`, keywords: [`limite${i}`] }),
        ),
      )
      .select("id")
      .throwOnError();
    extras.push(...((lote ?? []) as { id: string }[]).map((r) => r.id));
    expect(await ativasDaClinica(clinicaA)).toBe(LIMITE);

    const adminA = await logado("admin-a");
    const { error: erro51 } = await adminA
      .from("campaign_link")
      .insert(regra(clinicaA, { name: "A 51ª", keywords: ["cinquenta"] }));
    expect((erro51 as Erro)?.code).toBe("P0001");
    expect((erro51 as Erro)?.message).toBe("limite_de_origens_ativas");

    // Quem não gerencia recebe 42501, nunca a recusa do limite.
    const recepcao = await logado("recepcao-a");
    const { error: erroRecepcao } = await recepcao
      .from("campaign_link")
      .insert(regra(clinicaA, { name: "A 51ª", keywords: ["cinquenta"] }));
    expect((erroRecepcao as Erro)?.code).toBe(PERMISSAO_NEGADA);

    const { data: desativada, error: erroDesativada } = await adminA
      .from("campaign_link")
      .insert(
        regra(clinicaA, {
          name: "Desativada",
          keywords: ["desligada"],
          active: false,
        }),
      )
      .select("id")
      .single();
    expect(erroDesativada).toBeNull();
    const idDesativada = (desativada as { id: string }).id;
    extras.push(idDesativada);

    const { error: erroAtivar } = await adminA
      .from("campaign_link")
      .update({ active: true })
      .eq("id", idDesativada);
    expect((erroAtivar as Erro)?.code).toBe("P0001");
    expect((erroAtivar as Erro)?.message).toBe("limite_de_origens_ativas");

    // Desativar uma abre a vaga.
    const { data: umaVaga } = await adminA
      .from("campaign_link")
      .update({ active: false })
      .eq("id", extras[0])
      .select("id");
    expect(umaVaga).toHaveLength(1);
    const { error: erroNaVaga } = await adminA
      .from("campaign_link")
      .update({ active: true })
      .eq("id", idDesativada);
    expect(erroNaVaga).toBeNull();
    expect(await ativasDaClinica(clinicaA)).toBe(LIMITE);

    // A B não sente o limite da A.
    const adminB = await logado("admin-b");
    const { data: daB, error: erroB } = await adminB
      .from("campaign_link")
      .insert(regra(clinicaB, { name: "Da B", keywords: ["outra"] }))
      .select("id")
      .single();
    expect(erroB).toBeNull();
    extras.push((daB as { id: string }).id);
  });
});
