import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// O preparo aprovado pelo RT (AG7, parte de banco: migration
// 20261103100000_preparo_aprovado_pelo_rt.sql), pela API com JWT real de
// cada papel. O que esta em jogo (o contrato, secao 7.1, RLS):
// - responsavel_tecnico e preparo_do_procedimento: a clinica A le as suas e
//   nao as da B; o pendente nada; anon nao le (42501);
// - ninguem grava pela API (insert, update e delete de cada papel, do
//   administrador, do RT e da service role: 42501): so as RPCs;
// - salvar e descartar: administrador e gestor sim; recepcao, profissional e
//   Somente leitura nao; o RT de qualquer papel sim; o pendente nao;
// - aprovar e devolver: so o RT vigente (nem o administrador que nao e RT,
//   nem o RT da B, nem o RT encerrado, nem o RT sem acesso ativo);
// - suspender: administrador, gestor e o RT;
// - definir e encerrar o RT: so o administrador pleno (nem o gestor, nem o
//   Implementador, nem o administrador da B);
// - a clinica A contra a B em toda RPC;
// - as funcoes do servidor e as internas recusadas para a sessao e para
//   anon; user_e_responsavel_tecnico certo para cada um;
// - a coluna nova ai_decision_log.preparo_versao_id lida pela sessao;
// - o super admin, SO com RLS_COM_SUPER_ADMIN=1 (como em
//   cadastro-para-o-agente.test.ts: cria um usuario sintetico com
//   product_admin NO BANCO DE PRODUCAO; sai no afterAll): le as duas
//   clinicas, escreve, descarta, suspende e define o RT, e NAO aprova.
// Toda negacao tem o caso positivo ao lado (anti falso positivo), e a
// service role confere que nada mudou.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// preparo-rls-*, apagadas no afterAll (os procedimentos, as versoes e o RT
// vao em cascata; o beforeAll apaga a sobra de uma execucao que morreu ha
// mais de uma hora), e os usuarios desta execucao (depois das clinicas).
// Nenhuma mensagem sai e nenhum modelo e chamado: so as tabelas e as RPCs do
// preparo. O texto de teste e sintetico.
// ESCRITO NA AG7, AINDA NAO RODADO: grava no banco. Roda depois de aplicar a
// migration, com npm run test:rls -- preparo-aprovado-pelo-rt.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro).
//   delete from public.clinic where slug like 'preparo-rls-%' and e_de_teste;
//   select u.id, u.email from auth.users u
//    where u.email like 'preparo-rls-%@teste.dev' or u.email like 'preparo-rls-super-%@example.com';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'preparo-rls-super-%@example.com';
// e os usuarios pela API de administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const FRASE_ESCREVER =
  "Somente administradores, gestores ou o responsável técnico escrevem a orientação de preparo.";
const FRASE_APROVAR =
  "Só o responsável técnico da clínica aprova a orientação de preparo.";
const FRASE_DESCARTAR =
  "Somente administradores, gestores ou o responsável técnico descartam o texto novo da orientação de preparo.";
const FRASE_SUSPENDER =
  "Somente administradores, gestores ou o responsável técnico suspendem o envio da orientação de preparo.";
const FRASE_RT = "Só o administrador da clínica define o responsável técnico.";

const COM_SUPER_ADMIN = process.env.RLS_COM_SUPER_ADMIN === "1";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PreparoRls!${sufixo}`;
const EMAIL_DO_SUPER = `preparo-rls-super-${sufixo}@example.com`;

const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();
const email = (apelido: string) => `preparo-rls-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;
const idDe = (apelido: string) => ids.get(apelido)!;

/** As sessoes de cada papel (o RT da A e profissional; o seguinte, Somente leitura). */
const SESSOES = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "profissional-a",
  "leitura-a",
  "pendente-a",
  "impl-a",
  "rt-a",
  "rt2-a",
  "admin-b",
  "rt-b",
] as const;

type Erro = { code?: string; message?: string } | null;
type Salvo = { versao_id: string; versao: number; texto_sha256: string };

let clinicaA = "";
let clinicaB = "";
/** Os procedimentos: pA (a colonoscopia), pA2..pA6 (um por bloco), pB (o da B). */
const procedimentos = new Map<string, string>();
const procedimento = (apelido: string) => procedimentos.get(apelido)!;

async function inserir(tabela: string, linha: Record<string, unknown>): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function criarClinica(nome: string): Promise<string> {
  return inserir("clinic", {
    name: `Preparo RLS ${nome} ${sufixo}`,
    slug: `preparo-rls-${nome.toLowerCase()}-${sufixo}`,
    e_de_teste: true,
    timezone: "America/Fortaleza",
  });
}

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

/** O texto de teste de cada bloco (sintetico, com remedio, dose e jejum: D-80). */
const texto = (n: number) =>
  `Jejum de ${n} horas. Tome 2 comprimidos de bisacodil às 18h do dia anterior.`;

/** A maior versao do procedimento (0 sem versao), lida pelo servidor. */
async function maiorVersao(procedimentoId: string): Promise<number> {
  const { data } = await admin
    .from("preparo_do_procedimento")
    .select("versao")
    .eq("procedure_id", procedimentoId)
    .order("versao", { ascending: false })
    .limit(1)
    .throwOnError();
  return (data as { versao: number }[])[0]?.versao ?? 0;
}

async function situacao(versaoId: string): Promise<string> {
  const { data } = await admin
    .from("preparo_do_procedimento")
    .select("situacao")
    .eq("id", versaoId)
    .single()
    .throwOnError();
  return (data as { situacao: string }).situacao;
}

async function salvar(
  cliente: SupabaseClient,
  procedimentoId: string,
  textoNovo: string,
): Promise<{ data: Salvo | null; error: Erro }> {
  const { data, error } = await cliente.rpc("salvar_preparo_do_procedimento", {
    p_procedure_id: procedimentoId,
    p_texto: textoNovo,
    p_versao_lida: await maiorVersao(procedimentoId),
  });
  return { data: data as Salvo | null, error: error as Erro };
}

async function salvarOk(apelido: string, procedimentoId: string, textoNovo: string): Promise<Salvo> {
  const { data, error } = await salvar(como(apelido), procedimentoId, textoNovo);
  expect(error, `${apelido} salva`).toBeNull();
  return data!;
}

async function aprovar(cliente: SupabaseClient, salvo: Salvo): Promise<Erro> {
  const { error } = await cliente.rpc("aprovar_preparo_do_procedimento", {
    p_versao_id: salvo.versao_id,
    p_texto_sha256: salvo.texto_sha256,
  });
  return error as Erro;
}

async function definirRt(cliente: SupabaseClient, clinicId: string, pessoa: string): Promise<Erro> {
  const { error } = await cliente.rpc("definir_responsavel_tecnico", {
    p_clinic_id: clinicId,
    p_user_id: pessoa,
    p_nome: "Dra. Ana Souza",
    p_conselho: "CRM",
    p_numero: "12345",
    p_uf: "CE",
  });
  return error as Erro;
}

async function contar(cliente: SupabaseClient, tabela: string, clinicId: string): Promise<number> {
  const { data, error } = await cliente.from(tabela).select("id").eq("clinic_id", clinicId);
  expect(error, `${tabela} pela sessao`).toBeNull();
  return (data as unknown[]).length;
}

beforeAll(async () => {
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "preparo-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  for (const [apelido, clinica, nome] of [
    ["pA", clinicaA, "Colonoscopia"],
    ["pA2", clinicaA, "Ultrassom de abdome"],
    ["pA3", clinicaA, "Endoscopia"],
    ["pA4", clinicaA, "Tomografia"],
    ["pA5", clinicaA, "Ressonância"],
    ["pA6", clinicaA, "Raio X"],
    ["pB", clinicaB, "Colonoscopia"],
  ] as const) {
    procedimentos.set(apelido, await inserir("procedure", { clinic_id: clinica, name: nome, active: true }));
  }

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("profissional-a", clinicaA, "profissional");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("pendente-a", clinicaA, "recepcao", "pendente");
  await criarPessoa("impl-a", clinicaA, "admin");
  await criarPessoa("rt-a", clinicaA, "profissional");
  await criarPessoa("rt2-a", clinicaA, "leitura");
  await criarPessoa("admin-b", clinicaB, "admin");
  await criarPessoa("rt-b", clinicaB, "recepcao");
  // A marca de Implementador (pela service role: sem sessao o gatilho pula a
  // permissao).
  await admin
    .from("membro_implementador")
    .insert({ clinic_id: clinicaA, user_id: idDe("impl-a") })
    .throwOnError();

  // O RT de cada clinica, pelo administrador pleno de cada uma; um texto
  // aprovado em cada (a colonoscopia).
  expect(await definirRt(como("admin-a"), clinicaA, idDe("rt-a"))).toBeNull();
  expect(await definirRt(como("admin-b"), clinicaB, idDe("rt-b"))).toBeNull();
  expect(await aprovar(como("rt-a"), await salvarOk("admin-a", procedimento("pA"), texto(8)))).toBeNull();
  expect(await aprovar(como("rt-b"), await salvarOk("admin-b", procedimento("pB"), texto(9)))).toBeNull();
}, 180_000);

afterAll(async () => {
  for (const clinica of [clinicaA, clinicaB]) {
    if (clinica) {
      const { error } = await admin.from("clinic").delete().eq("id", clinica);
      expect(error, "apagar a clinica do teste").toBeNull();
    }
  }
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
}, 120_000);

describe("as duas tabelas: quem le", () => {
  it("a A le as suas e nao as da B; a B so as dela; o pendente nada", async () => {
    for (const tabela of ["responsavel_tecnico", "preparo_do_procedimento"]) {
      const daA = await contar(admin, tabela, clinicaA);
      const daB = await contar(admin, tabela, clinicaB);
      // Anti falso positivo: as duas clinicas tem linhas.
      expect(daA, `${tabela} da A`).toBeGreaterThan(0);
      expect(daB, `${tabela} da B`).toBeGreaterThan(0);
      for (const apelido of [
        "admin-a",
        "gestor-a",
        "recepcao-a",
        "profissional-a",
        "leitura-a",
        "impl-a",
        "rt-a",
        "rt2-a",
      ]) {
        expect(await contar(como(apelido), tabela, clinicaA), `${apelido} le ${tabela} da A`).toBe(daA);
        expect(await contar(como(apelido), tabela, clinicaB), `${apelido} le ${tabela} da B`).toBe(0);
      }
      for (const apelido of ["admin-b", "rt-b"]) {
        expect(await contar(como(apelido), tabela, clinicaB), `${apelido} le ${tabela} da B`).toBe(daB);
        expect(await contar(como(apelido), tabela, clinicaA), `${apelido} le ${tabela} da A`).toBe(0);
      }
      expect(await contar(como("pendente-a"), tabela, clinicaA), `o pendente le ${tabela}`).toBe(0);
    }
  });

  it("anon nao le (42501)", async () => {
    for (const tabela of ["responsavel_tecnico", "preparo_do_procedimento"]) {
      const { error } = await anonClient().from(tabela).select("id").limit(1);
      expect(error?.code, tabela).toBe(PERMISSAO_NEGADA);
    }
  });

  it("a tela le as colunas da versao e do RT", async () => {
    const { data, error } = await como("recepcao-a")
      .from("preparo_do_procedimento")
      .select("versao, situacao, texto, texto_sha256, nome_do_procedimento, rt_id, aprovado_em")
      .eq("procedure_id", procedimento("pA"))
      .eq("situacao", "aprovado")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ versao: 1, situacao: "aprovado", texto: texto(8), nome_do_procedimento: "Colonoscopia" });
    const { data: rt, error: erroRt } = await como("leitura-a")
      .from("responsavel_tecnico")
      .select("user_id, nome, conselho, numero, uf, ate")
      .eq("clinic_id", clinicaA)
      .is("ate", null)
      .single();
    expect(erroRt).toBeNull();
    expect(rt).toEqual({ user_id: idDe("rt-a"), nome: "Dra. Ana Souza", conselho: "CRM", numero: "12345", uf: "CE", ate: null });
  });
});

describe("as duas tabelas: ninguem grava pela API", () => {
  it("insert, update e delete de cada papel e da service role: 42501; nada muda", async () => {
    const { data: aprovada } = await admin
      .from("preparo_do_procedimento")
      .select("id")
      .eq("procedure_id", procedimento("pA"))
      .eq("situacao", "aprovado")
      .single()
      .throwOnError();
    const versao = (aprovada as { id: string }).id;
    for (const cliente of [admin, anonClient(), ...SESSOES.map(como)]) {
      const r1 = await cliente.from("preparo_do_procedimento").insert({
        clinic_id: clinicaA,
        procedure_id: procedimento("pA6"),
        versao: 99,
        texto: "Texto pela API.",
        texto_sha256: "0".repeat(64),
        nome_do_procedimento: "Raio X",
        origem: "cadastro",
        situacao: "aguardando_rt",
        escrito_por: idDe("admin-a"),
      });
      expect(r1.error?.code).toBe(PERMISSAO_NEGADA);
      const r2 = await cliente.from("preparo_do_procedimento").update({ situacao: "suspenso" }).eq("id", versao);
      expect(r2.error?.code).toBe(PERMISSAO_NEGADA);
      const r3 = await cliente.from("preparo_do_procedimento").delete().eq("id", versao);
      expect(r3.error?.code).toBe(PERMISSAO_NEGADA);
      const r4 = await cliente.from("responsavel_tecnico").insert({
        clinic_id: clinicaA,
        user_id: idDe("admin-a"),
        nome: "Dra. Pela API",
        conselho: "CRM",
        numero: "1",
        uf: "CE",
      });
      expect(r4.error?.code).toBe(PERMISSAO_NEGADA);
      const r5 = await cliente.from("responsavel_tecnico").update({ nome: "Outro" }).eq("clinic_id", clinicaA);
      expect(r5.error?.code).toBe(PERMISSAO_NEGADA);
      const r6 = await cliente.from("responsavel_tecnico").delete().eq("clinic_id", clinicaA);
      expect(r6.error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await situacao(versao)).toBe("aprovado");
    expect(await contar(admin, "responsavel_tecnico", clinicaA)).toBe(1);
  });
});

describe("salvar e descartar: administrador, gestor e o RT de qualquer papel", () => {
  it("administrador, gestor e o RT (profissional) salvam; recepcao, profissional, leitura, pendente e a B nao", async () => {
    for (const apelido of ["recepcao-a", "profissional-a", "leitura-a", "pendente-a", "rt2-a", "admin-b", "rt-b"]) {
      const { error } = await salvar(como(apelido), procedimento("pA2"), texto(2));
      expect(error?.code, `${apelido} salva`).toBe(PERMISSAO_NEGADA);
      expect(error?.message).toBe(FRASE_ESCREVER);
    }
    for (const cliente of [anonClient(), admin]) {
      const { error } = await salvar(cliente, procedimento("pA2"), texto(2));
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await maiorVersao(procedimento("pA2"))).toBe(0);
    // O positivo: cada um grava a versao seguinte.
    expect((await salvarOk("admin-a", procedimento("pA2"), texto(2))).versao).toBe(1);
    expect((await salvarOk("gestor-a", procedimento("pA2"), texto(3))).versao).toBe(2);
    expect((await salvarOk("rt-a", procedimento("pA2"), texto(4))).versao).toBe(3);
  });

  it("descartar: administrador, gestor e o RT; os outros 42501", async () => {
    for (const [apelido, n] of [
      ["admin-a", 5],
      ["gestor-a", 6],
      ["rt-a", 7],
    ] as const) {
      const salvo = await salvarOk("admin-a", procedimento("pA3"), texto(n));
      for (const outro of ["recepcao-a", "profissional-a", "leitura-a", "pendente-a", "admin-b", "rt-b"]) {
        const { error } = await como(outro).rpc("descartar_preparo_do_procedimento", { p_versao_id: salvo.versao_id });
        expect(error?.code, `${outro} descarta`).toBe(PERMISSAO_NEGADA);
        expect(error?.message).toBe(FRASE_DESCARTAR);
      }
      expect(await situacao(salvo.versao_id)).toBe("aguardando_rt");
      const { error } = await como(apelido).rpc("descartar_preparo_do_procedimento", { p_versao_id: salvo.versao_id });
      expect(error, `${apelido} descarta`).toBeNull();
      expect(await situacao(salvo.versao_id)).toBe("descartado");
    }
  });
});

describe("aprovar e devolver: so o RT vigente", () => {
  it("o administrador, o gestor, o Implementador, a leitura e o RT da B nao aprovam; o RT aprova", async () => {
    const salvo = await salvarOk("admin-a", procedimento("pA4"), texto(10));
    for (const apelido of ["admin-a", "gestor-a", "impl-a", "recepcao-a", "leitura-a", "rt2-a", "rt-b", "admin-b"]) {
      const error = await aprovar(como(apelido), salvo);
      expect(error?.code, `${apelido} aprova`).toBe(PERMISSAO_NEGADA);
      expect(error?.message).toBe(FRASE_APROVAR);
    }
    expect((await aprovar(anonClient(), salvo))?.code).toBe(PERMISSAO_NEGADA);
    expect((await aprovar(admin, salvo))?.code).toBe(PERMISSAO_NEGADA);
    expect(await situacao(salvo.versao_id)).toBe("aguardando_rt");
    expect(await aprovar(como("rt-a"), salvo)).toBeNull();
    expect(await situacao(salvo.versao_id)).toBe("aprovado");
  });

  it("devolver: so o RT; o administrador recebe a frase de aprovar", async () => {
    const salvo = await salvarOk("admin-a", procedimento("pA5"), texto(11));
    for (const apelido of ["admin-a", "gestor-a", "rt-b"]) {
      const { error } = await como(apelido).rpc("devolver_preparo_do_procedimento", {
        p_versao_id: salvo.versao_id,
        p_comentario: "Falta a dieta.",
      });
      expect(error?.code, `${apelido} devolve`).toBe(PERMISSAO_NEGADA);
      expect(error?.message).toBe(FRASE_APROVAR);
    }
    const { error } = await como("rt-a").rpc("devolver_preparo_do_procedimento", {
      p_versao_id: salvo.versao_id,
      p_comentario: "Falta a dieta.",
    });
    expect(error).toBeNull();
    expect(await situacao(salvo.versao_id)).toBe("devolvido");
  });

  it("o RT sem acesso ativo e o RT encerrado nao aprovam; de volta, aprova", async () => {
    const salvo = await salvarOk("admin-a", procedimento("pA5"), texto(12));
    // Sem acesso ativo (pela service role).
    await admin
      .from("clinic_member")
      .update({ status: "inativo" })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("rt-a"))
      .throwOnError();
    const { data: semAcesso } = await como("rt-a").rpc("user_e_responsavel_tecnico", { p_clinic_id: clinicaA });
    expect(semAcesso).toBe(false);
    expect((await aprovar(como("rt-a"), salvo))?.code).toBe(PERMISSAO_NEGADA);
    await admin
      .from("clinic_member")
      .update({ status: "ativo" })
      .eq("clinic_id", clinicaA)
      .eq("user_id", idDe("rt-a"))
      .throwOnError();
    // Encerrado pelo administrador.
    const { error: erroEncerrar } = await como("admin-a").rpc("encerrar_responsavel_tecnico", { p_clinic_id: clinicaA });
    expect(erroEncerrar).toBeNull();
    expect((await aprovar(como("rt-a"), salvo))?.code).toBe(PERMISSAO_NEGADA);
    expect(await situacao(salvo.versao_id)).toBe("aguardando_rt");
    // De volta: o mesmo RT, definido de novo, aprova.
    expect(await definirRt(como("admin-a"), clinicaA, idDe("rt-a"))).toBeNull();
    expect(await aprovar(como("rt-a"), salvo)).toBeNull();
  });
});

describe("suspender: administrador, gestor e o RT", () => {
  it("recepcao, leitura e a B nao; o gestor e o RT suspendem", async () => {
    for (const apelido of ["admin-a", "gestor-a", "rt-a"]) {
      const salvo = await salvarOk("admin-a", procedimento("pA6"), texto(20 + (await maiorVersao(procedimento("pA6")))));
      expect(await aprovar(como("rt-a"), salvo)).toBeNull();
      for (const outro of ["recepcao-a", "profissional-a", "leitura-a", "pendente-a", "admin-b", "rt-b"]) {
        const { error } = await como(outro).rpc("suspender_preparo_do_procedimento", {
          p_procedure_id: procedimento("pA6"),
          p_comentario: "Revisar.",
        });
        expect(error?.code, `${outro} suspende`).toBe(PERMISSAO_NEGADA);
        expect(error?.message).toBe(FRASE_SUSPENDER);
      }
      expect(await situacao(salvo.versao_id)).toBe("aprovado");
      const { data, error } = await como(apelido).rpc("suspender_preparo_do_procedimento", {
        p_procedure_id: procedimento("pA6"),
      });
      expect(error, `${apelido} suspende`).toBeNull();
      expect(data).toEqual({ versao_id: salvo.versao_id });
      expect(await situacao(salvo.versao_id)).toBe("suspenso");
    }
  });
});

describe("definir e encerrar o RT: so o administrador pleno", () => {
  it("o gestor, o Implementador, o RT, a recepcao e o administrador da B nao definem nem encerram", async () => {
    for (const apelido of ["gestor-a", "impl-a", "rt-a", "recepcao-a", "leitura-a", "pendente-a", "admin-b", "rt-b"]) {
      const error = await definirRt(como(apelido), clinicaA, idDe("rt2-a"));
      expect(error?.code, `${apelido} define`).toBe(PERMISSAO_NEGADA);
      expect(error?.message).toBe(FRASE_RT);
      const { error: erroEncerrar } = await como(apelido).rpc("encerrar_responsavel_tecnico", { p_clinic_id: clinicaA });
      expect(erroEncerrar?.code, `${apelido} encerra`).toBe(PERMISSAO_NEGADA);
      expect(erroEncerrar?.message).toBe(FRASE_RT);
    }
    for (const cliente of [anonClient(), admin]) {
      expect((await definirRt(cliente, clinicaA, idDe("rt2-a")))?.code).toBe(PERMISSAO_NEGADA);
    }
    // A pessoa sem vinculo ativo (o pendente, alguem da B) nao vira RT.
    for (const apelido of ["pendente-a", "rt-b"]) {
      const error = await definirRt(como("admin-a"), clinicaA, idDe(apelido));
      expect(error?.code).toBe("P0001");
      expect(error?.message).toBe("responsavel_nao_e_membro_ativo");
    }
    const { data } = await admin
      .from("responsavel_tecnico")
      .select("user_id")
      .eq("clinic_id", clinicaA)
      .is("ate", null)
      .single()
      .throwOnError();
    expect((data as { user_id: string }).user_id).toBe(idDe("rt-a"));
  });

  it("user_e_responsavel_tecnico certo para cada um", async () => {
    for (const apelido of SESSOES) {
      const { data, error } = await como(apelido).rpc("user_e_responsavel_tecnico", { p_clinic_id: clinicaA });
      expect(error, apelido).toBeNull();
      expect(data, apelido).toBe(apelido === "rt-a");
    }
    const { data: daB } = await como("rt-b").rpc("user_e_responsavel_tecnico", { p_clinic_id: clinicaB });
    expect(daB).toBe(true);
    const { error } = await anonClient().rpc("user_e_responsavel_tecnico", { p_clinic_id: clinicaA });
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("a clinica A contra a B, em toda RPC", () => {
  it("o administrador e o RT da A nao mexem na B", async () => {
    const { data: daB } = await admin
      .from("preparo_do_procedimento")
      .select("id, texto_sha256")
      .eq("procedure_id", procedimento("pB"))
      .eq("situacao", "aprovado")
      .single()
      .throwOnError();
    const versaoB = daB as { id: string; texto_sha256: string };
    for (const apelido of ["admin-a", "rt-a"]) {
      const cliente = como(apelido);
      expect((await salvar(cliente, procedimento("pB"), texto(30))).error?.code).toBe(PERMISSAO_NEGADA);
      expect(
        (await aprovar(cliente, { versao_id: versaoB.id, versao: 1, texto_sha256: versaoB.texto_sha256 }))?.code,
      ).toBe(PERMISSAO_NEGADA);
      for (const [rpc, args] of [
        ["devolver_preparo_do_procedimento", { p_versao_id: versaoB.id, p_comentario: "Nao." }],
        ["descartar_preparo_do_procedimento", { p_versao_id: versaoB.id }],
        ["suspender_preparo_do_procedimento", { p_procedure_id: procedimento("pB") }],
        ["encerrar_responsavel_tecnico", { p_clinic_id: clinicaB }],
      ] as const) {
        const { error } = await cliente.rpc(rpc, args);
        expect(error?.code, `${apelido} ${rpc} na B`).toBe(PERMISSAO_NEGADA);
      }
      expect((await definirRt(cliente, clinicaB, idDe("admin-a")))?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await situacao(versaoB.id)).toBe("aprovado");
  });
});

describe("as funcoes do servidor e as internas", () => {
  it("toda sessao e anon recebem 42501; o servidor recebe resposta", async () => {
    const { data: aprovada } = await admin
      .from("preparo_do_procedimento")
      .select("id")
      .eq("procedure_id", procedimento("pA"))
      .eq("situacao", "aprovado")
      .single()
      .throwOnError();
    const versao = (aprovada as { id: string }).id;
    const doServidor: [string, Record<string, unknown>][] = [
      ["ler_preparo_para_envio", { p_clinic_id: clinicaA, p_versao_id: versao }],
      ["preparos_em_vigor_da_clinica", { p_clinic_id: clinicaA }],
      ["textos_de_preparo_da_clinica", { p_clinic_id: clinicaA }],
      ["preparo_em_vigor_do_procedimento", { p_clinic_id: clinicaA, p_procedure_id: procedimento("pA") }],
    ];
    const internas: [string, Record<string, unknown>][] = [
      ["preparo_texto_valido", { p_texto: "Jejum." }],
      ["responsavel_tecnico_vigente", { p_clinic_id: clinicaA }],
      ["preparo_em_vigor", { p_clinic_id: clinicaA, p_versao_id: versao }],
      ["mensagem_do_preparo", { p_versao_id: versao }],
    ];
    for (const [rpc, args] of [...doServidor, ...internas]) {
      for (const cliente of [anonClient(), como("admin-a"), como("rt-a")]) {
        const { error } = await cliente.rpc(rpc, args);
        expect(error?.code, rpc).toBe(PERMISSAO_NEGADA);
      }
    }
    for (const [rpc, args] of doServidor) {
      const { error } = await admin.rpc(rpc, args);
      expect(error, `o servidor chama ${rpc}`).toBeNull();
    }
    for (const [rpc, args] of internas) {
      const { error } = await admin.rpc(rpc, args);
      expect(error?.code, `o servidor chama ${rpc}`).toBe(PERMISSAO_NEGADA);
    }
  });
});

describe("ai_decision_log.preparo_versao_id", () => {
  it("a sessao le a coluna nova (o grant); blocked_draft continua fora", async () => {
    const { error } = await como("admin-a")
      .from("ai_decision_log")
      .select("id, desfecho, preparo_versao_id")
      .eq("clinic_id", clinicaA)
      .limit(1);
    expect(error).toBeNull();
    const { error: erroRascunho } = await como("admin-a")
      .from("ai_decision_log")
      .select("blocked_draft")
      .eq("clinic_id", clinicaA)
      .limit(1);
    expect(erroRascunho?.code).toBe(PERMISSAO_NEGADA);
  });
});

// ---------------------------------------------------------------------------
// O super admin (opt-in: RLS_COM_SUPER_ADMIN=1, cabecalho)
// ---------------------------------------------------------------------------

describe.skipIf(!COM_SUPER_ADMIN)("o super admin (opt-in)", () => {
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
      throw new Error(`criar super admin: ${error?.message ?? "sem usuário"}`);
    }
    superAdmin = data.user.id;
    // O usuario sai no afterAll geral, depois das clinicas.
    ids.set("super", superAdmin);
    await admin.from("product_admin").insert({ user_id: superAdmin }).throwOnError();
    const cliente = anonClient();
    const { error: erroLogin } = await cliente.auth.signInWithPassword({
      email: EMAIL_DO_SUPER,
      password: senhaDoSuper,
    });
    if (erroLogin) {
      throw new Error(`login do super admin: ${erroLogin.message}`);
    }
    sessaoDoSuper = cliente;
  });

  afterAll(async () => {
    if (superAdmin) {
      const { error } = await admin.from("product_admin").delete().eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  it("le as duas clinicas, escreve, descarta e suspende; nao aprova", async () => {
    const sessao = sessaoDoSuper!;
    expect(await contar(sessao, "preparo_do_procedimento", clinicaA)).toBe(
      await contar(admin, "preparo_do_procedimento", clinicaA),
    );
    expect(await contar(sessao, "responsavel_tecnico", clinicaB)).toBe(await contar(admin, "responsavel_tecnico", clinicaB));
    const salvo = (await salvar(sessao, procedimento("pA2"), texto(40))).data!;
    expect(salvo.versao).toBeGreaterThan(0);
    const error = await aprovar(sessao, salvo);
    expect(error?.code).toBe(PERMISSAO_NEGADA);
    expect(error?.message).toBe(FRASE_APROVAR);
    const { error: erroDescartar } = await sessao.rpc("descartar_preparo_do_procedimento", { p_versao_id: salvo.versao_id });
    expect(erroDescartar).toBeNull();
    const { error: erroSuspender } = await sessao.rpc("suspender_preparo_do_procedimento", {
      p_procedure_id: procedimento("pA"),
      p_comentario: "Suspenso pela equipe Conduzza.",
    });
    expect(erroSuspender).toBeNull();
  });

  it("define o RT da B (encerra o anterior) e encerra", async () => {
    const sessao = sessaoDoSuper!;
    expect(await definirRt(sessao, clinicaB, idDe("admin-b"))).toBeNull();
    const { data } = await admin
      .from("responsavel_tecnico")
      .select("user_id")
      .eq("clinic_id", clinicaB)
      .is("ate", null)
      .single()
      .throwOnError();
    expect((data as { user_id: string }).user_id).toBe(idDe("admin-b"));
    const { error } = await sessao.rpc("encerrar_responsavel_tecnico", { p_clinic_id: clinicaB });
    expect(error).toBeNull();
  });
});
