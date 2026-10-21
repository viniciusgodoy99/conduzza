import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Onda 1 (migration 20261021100000_painel_geral.sql): conta suspensa, agente
// por clinica e painel geral, pela API com JWT real de cada papel. O que esta
// em jogo:
// - com a conta da clinica A SUSPENSA (pela service role, como o painel faz
//   pela RPC), todo membro ativo da A (administrador, gestor, recepcao,
//   leitura e profissional) le ZERO contato, conversa, mensagem, numero e a
//   propria clinica, e nao escreve (mensagem padrao 42501, clinica e conversa
//   zero linhas); fica so o proprio vinculo. A B nao muda. Depois de
//   reativar, tudo volta;
// - minhas_clinicas_suspensas: o vinculo ativo da A ve a A (id, nome e quando
//   foi suspensa); o pendente da A e a B, nada; anon nao executa;
// - clinica_suspensa: nenhuma sessao de clinica le (so o super admin) nem
//   escreve; anon nem chega (42501). clinica_esta_suspensa: so a service
//   role executa (a trava do envio); a sessao, de qualquer clinica, e anon
//   levam 42501 (ninguem descobre pela sessao se a conta de outra clinica
//   esta suspensa);
// - ia_clinica_habilitada: o membro ATIVO le so clinic_id e estado da propria
//   clinica (o motivo e quem mudou: 42501, ate para o super admin pela
//   sessao); outra clinica e pendente leem zero; ninguem escreve pela sessao;
// - suspender_clinica, reativar_clinica, definir_agente_da_clinica,
//   definir_teto_da_ia e painel_geral_das_clinicas: 42501 para TODO papel da
//   clinica (o administrador inclusive) e para anon; a service role passa da
//   guarda (contraprova: chega na regra de negocio ou no resultado).
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// O SUPER ADMIN pela sessao (o painel e as acoes como a equipe Conduzza as
// usa) so roda com RLS_COM_SUPER_ADMIN=1: o teste cria um usuario sintetico
// com product_admin NO BANCO DE PRODUCAO, com senha aleatoria da execucao,
// e-mail em example.com (dominio reservado, nenhuma caixa recebe) e apaga os
// dois no fim: o product_admin no afterAll do bloco, e o usuario no afterAll
// geral, DEPOIS de apagar as clinicas (a trilha que ele gravou ao suspender e
// reativar a A segura o usuario: audit_log.user_id referencia auth.users
// sem ON DELETE, e a trilha some com a clinica, em cascata). Sem a variavel,
// esse bloco e pulado; o ensaio da migration
// (~/.claude/plans/onda1-painel/ensaio-20261021100000.sql) prova o mesmo no
// SQL, com o super admin de ensaio dentro da transacao desfeita.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (o motor de producao
// as ignora), apagadas no afterAll; a suspensao da A e desfeita no afterAll
// do bloco dela (e no afterAll geral, se o teste cair no meio). Nada aqui usa
// a id da salud-care, da teste123 nem da Conduzza Teste, e nada liga o
// agente (a linha de ia_clinica_habilitada da A fica em 'desligado'). ESCRITO,
// AINDA NAO RODADO (roda depois de aplicar a migration:
// npm run test:rls -- painel-geral).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// conferir e depois apagar, NESTA ORDEM (as clinicas primeiro: a trilha
// delas, que segura os usuarios, vai junto).
//   select id, name from public.clinic where slug like 'painel-geral-rls-%';
//   delete from public.clinic where slug like 'painel-geral-rls-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'painel-geral-%@teste.dev'
//       or u.email like 'painel-geral-super-%@example.com';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'painel-geral-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'painel-geral-%@teste.dev'
//       or u.email like 'painel-geral-super-%@example.com';

const PERMISSAO_NEGADA = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `PainelGeral!Rls${sufixo}`;
const COM_SUPER_ADMIN = process.env.RLS_COM_SUPER_ADMIN === "1";

const email = (papel: string) => `painel-geral-${papel}-${sufixo}@teste.dev`;
/** O super admin sintetico do bloco opt-in (apagado no afterAll geral). */
const EMAIL_DO_SUPER = `painel-geral-super-${sufixo}@example.com`;

/** Os usuarios desta execucao (os papeis e o super admin sintetico). */
function eDestaExecucao(enderecoDeEmail: string | undefined): boolean {
  return (
    (enderecoDeEmail?.endsWith(`-${sufixo}@teste.dev`) ?? false) ||
    enderecoDeEmail === EMAIL_DO_SUPER
  );
}

const PAPEIS_ATIVOS_DA_A = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "leitura-a",
  "prof-a",
] as const;
const TODOS_OS_PAPEIS = [...PAPEIS_ATIVOS_DA_A, "pendente-a", "admin-b"];

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";

type Erro = { code?: string; message?: string } | null;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Painel Geral RLS ${nome} ${sufixo}`,
      slug: `painel-geral-rls-${nome.toLowerCase()}-${sufixo}`,
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
  opcoes: { status?: string; professionalId?: string } = {},
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Painel ${papelNoEmail}` },
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
      status: opcoes.status ?? "ativo",
      ...(opcoes.professionalId
        ? { professional_id: opcoes.professionalId }
        : {}),
    })
    .throwOnError();
  return data.user.id;
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

/** Quantas linhas desta clinica a sessao ve na tabela. */
async function linhasVisiveis(
  cliente: SupabaseClient,
  tabela: string,
  clinicId: string,
  coluna = "clinic_id",
): Promise<number> {
  const { data, error } = await cliente
    .from(tabela)
    .select(coluna)
    .eq(coluna, clinicId);
  expect(error, `${tabela} pela sessao`).toBeNull();
  return (data ?? []).length;
}

async function suspenderA(motivo: string): Promise<void> {
  const { error } = await admin.rpc("suspender_clinica", {
    p_clinic_id: clinicaA,
    p_motivo: motivo,
  });
  expect(error).toBeNull();
}

/** Reativa a A se ela estiver suspensa (limpeza que nao falha). */
async function reativarASeSuspensa(): Promise<void> {
  const { data } = await admin
    .from("clinica_suspensa")
    .select("clinic_id")
    .eq("clinic_id", clinicaA);
  if ((data ?? []).length > 0) {
    await admin.rpc("reativar_clinica", {
      p_clinic_id: clinicaA,
      p_motivo: "Limpeza do teste de RLS",
    });
  }
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Painel Geral" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = (prof as { id: string }).id;

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("prof-a", clinicaA, "profissional", {
    professionalId: profissionalA,
  });
  await criarUsuario("pendente-a", clinicaA, "recepcao", {
    status: "pendente",
  });
  await criarUsuario("admin-b", clinicaB, "admin");

  // Um numero, um contato e uma conversa em cada clinica (a conversa da A
  // sem responsavel: o profissional nao a ve nem antes, so o contato).
  const numeroA = await criarNumeroDeTeste(admin, clinicaA, {
    nome: "Recepção",
  });
  const numeroB = await criarNumeroDeTeste(admin, clinicaB, {
    nome: "Recepção",
  });
  const digitos = sufixo.replace(/\D/g, "").padEnd(4, "7").slice(0, 4);
  for (const [clinicId, numero, final] of [
    [clinicaA, numeroA.id, "1"],
    [clinicaB, numeroB.id, "2"],
  ] as const) {
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: `+55849781${digitos}${final}`,
        name: "Contato sintético do painel",
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: conversa } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicId,
        contact_id: (contato as { id: string }).id,
        whatsapp_account_id: numero,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("message")
      .insert({
        clinic_id: clinicId,
        conversation_id: (conversa as { id: string }).id,
        direction: "entrada",
        author: "paciente",
        content_type: "texto",
        body: "Mensagem sintética do teste",
      })
      .throwOnError();
  }

  // O estado do agente da A em 'desligado' (a RPC recusa clinica e_de_teste;
  // a service role grava direto). Desligado nao poe a A na lista da IA.
  await admin
    .from("ia_clinica_habilitada")
    .insert({
      clinic_id: clinicaA,
      estado: "desligado",
      motivo: "Teste de RLS",
    })
    .throwOnError();
});

afterAll(async () => {
  await reativarASeSuspensa();
  // As clinicas PRIMEIRO: a trilha delas (audit_log, em cascata) e o que
  // segura os usuarios que suspenderam e reativaram (audit_log.user_id sem
  // ON DELETE). Depois, os usuarios desta execucao, o super admin sintetico
  // inclusive, com o erro conferido: limpeza que falha calada deixaria
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
      if (eDestaExecucao(usuario.email)) {
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

describe("sem suspensão (a contraprova)", () => {
  it("o membro ativo lê e escreve a própria clínica; ninguém está suspenso", async () => {
    for (const papel of ["admin-a", "gestor-a", "recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      expect(await linhasVisiveis(cliente, "contact", clinicaA)).toBe(1);
      expect(await linhasVisiveis(cliente, "conversation", clinicaA)).toBe(1);
      expect(await linhasVisiveis(cliente, "message", clinicaA)).toBe(1);
      expect(await linhasVisiveis(cliente, "clinic", clinicaA, "id")).toBe(1);
      expect(await linhasVisiveis(cliente, "whatsapp_account", clinicaA)).toBe(
        1,
      );
    }
    const prof = await logado("prof-a");
    expect(await linhasVisiveis(prof, "contact", clinicaA)).toBe(1);

    const adminA = await logado("admin-a");
    const { data: editada, error } = await adminA
      .from("clinic")
      .update({ name: `Painel Geral RLS A ${sufixo}` })
      .eq("id", clinicaA)
      .select("id");
    expect(error).toBeNull();
    expect(editada).toHaveLength(1);

    const { data: minhas, error: erroMinhas } = await adminA.rpc(
      "minhas_clinicas_suspensas",
    );
    expect(erroMinhas).toBeNull();
    expect(minhas).toEqual([]);

    // A conta pela service role (a trava do envio); a sessao nao executa.
    const { data: suspensa, error: erroDoServidor } = await admin.rpc(
      "clinica_esta_suspensa",
      { p_clinic_id: clinicaA },
    );
    expect(erroDoServidor).toBeNull();
    expect(suspensa).toBe(false);
  });
});

describe("com a conta da A suspensa", () => {
  beforeAll(async () => {
    await suspenderA("Teste de RLS da onda 1");
  });

  afterAll(async () => {
    await reativarASeSuspensa();
  });

  it("todo membro ativo da A lê zero da clínica (só o próprio vínculo)", async () => {
    for (const papel of PAPEIS_ATIVOS_DA_A) {
      const cliente = await logado(papel);
      expect(await linhasVisiveis(cliente, "contact", clinicaA), papel).toBe(0);
      expect(
        await linhasVisiveis(cliente, "conversation", clinicaA),
        papel,
      ).toBe(0);
      expect(await linhasVisiveis(cliente, "message", clinicaA), papel).toBe(0);
      expect(
        await linhasVisiveis(cliente, "whatsapp_account", clinicaA),
        papel,
      ).toBe(0);
      expect(
        await linhasVisiveis(cliente, "clinic", clinicaA, "id"),
        papel,
      ).toBe(0);
      expect(
        await linhasVisiveis(cliente, "clinic_member", clinicaA),
        papel,
      ).toBe(1);
      expect(
        await linhasVisiveis(cliente, "clinica_suspensa", clinicaA),
        papel,
      ).toBe(0);
    }
  });

  it("o membro da A não escreve na clínica suspensa", async () => {
    const adminA = await logado("admin-a");
    const { error: erroPadrao } = await adminA.from("resposta_rapida").insert({
      clinic_id: clinicaA,
      atalho: `painel_${sufixo.replace(/[^a-z0-9]/g, "")}`.slice(0, 30),
      titulo: "Teste",
      corpo: "Texto de teste da equipe",
    });
    expect((erroPadrao as Erro)?.code).toBe(PERMISSAO_NEGADA);

    const { data: clinica, error: erroClinica } = await adminA
      .from("clinic")
      .update({ name: `Painel Geral RLS A ${sufixo} editada` })
      .eq("id", clinicaA)
      .select("id");
    expect(erroClinica).toBeNull();
    expect(clinica).toEqual([]);

    const recepcao = await logado("recepcao-a");
    const { data: conversas, error: erroConversa } = await recepcao
      .from("conversation")
      .update({ awaiting_reply: false })
      .eq("clinic_id", clinicaA)
      .select("id");
    expect(erroConversa).toBeNull();
    expect(conversas).toEqual([]);

    // Contraprova: nada mudou de fato.
    const { data: nome } = await admin
      .from("clinic")
      .select("name")
      .eq("id", clinicaA)
      .single();
    expect((nome as { name: string }).name).toBe(
      `Painel Geral RLS A ${sufixo}`,
    );
  });

  it("a B continua igual", async () => {
    const adminB = await logado("admin-b");
    expect(await linhasVisiveis(adminB, "contact", clinicaB)).toBe(1);
    expect(await linhasVisiveis(adminB, "conversation", clinicaB)).toBe(1);
    expect(await linhasVisiveis(adminB, "clinica_suspensa", clinicaA)).toBe(0);
  });

  it("minhas_clinicas_suspensas: só o vínculo ativo da A vê a A", async () => {
    const { data, error } = await (
      await logado("admin-a")
    ).rpc("minhas_clinicas_suspensas");
    expect(error).toBeNull();
    const linhas = data as {
      clinic_id: string;
      nome: string;
      suspensa_em: string;
    }[];
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.clinic_id).toBe(clinicaA);
    expect(linhas[0]!.nome).toBe(`Painel Geral RLS A ${sufixo}`);
    expect(Number.isNaN(Date.parse(linhas[0]!.suspensa_em))).toBe(false);

    for (const papel of ["gestor-a", "prof-a"]) {
      const { data: dele } = await (
        await logado(papel)
      ).rpc("minhas_clinicas_suspensas");
      expect(dele, papel).toHaveLength(1);
    }
    for (const papel of ["pendente-a", "admin-b"]) {
      const { data: dele, error: erroDele } = await (
        await logado(papel)
      ).rpc("minhas_clinicas_suspensas");
      expect(erroDele, papel).toBeNull();
      expect(dele, papel).toEqual([]);
    }
    const { error: erroAnon } = await anonClient().rpc(
      "minhas_clinicas_suspensas",
    );
    expect((erroAnon as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("clinica_esta_suspensa: só a service role executa; sessão e anon não", async () => {
    // Nenhuma sessao descobre se a conta de uma clinica esta suspensa: nem a
    // de outra clinica, nem a pendente, nem a da propria.
    for (const papel of ["admin-b", "pendente-a", "admin-a"]) {
      const { data, error } = await (
        await logado(papel)
      ).rpc("clinica_esta_suspensa", { p_clinic_id: clinicaA });
      expect((error as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
      expect(data, papel).toBeNull();
    }
    const { error } = await anonClient().rpc("clinica_esta_suspensa", {
      p_clinic_id: clinicaA,
    });
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);

    // Contraprova: a service role (o envio) le o booleano das duas.
    const { data: daA, error: erroDaA } = await admin.rpc(
      "clinica_esta_suspensa",
      { p_clinic_id: clinicaA },
    );
    expect(erroDaA).toBeNull();
    expect(daA).toBe(true);
    const { data: daB } = await admin.rpc("clinica_esta_suspensa", {
      p_clinic_id: clinicaB,
    });
    expect(daB).toBe(false);
  });

  it("clinica_suspensa: nenhuma sessão escreve; anon nem lê", async () => {
    const adminA = await logado("admin-a");
    const { error: erroInsert } = await adminA
      .from("clinica_suspensa")
      .insert({ clinic_id: clinicaB, motivo: "Tentativa da sessão" });
    expect((erroInsert as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroDelete } = await adminA
      .from("clinica_suspensa")
      .delete()
      .eq("clinic_id", clinicaA);
    expect((erroDelete as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroAnon } = await anonClient()
      .from("clinica_suspensa")
      .select("clinic_id");
    expect((erroAnon as Erro)?.code).toBe(PERMISSAO_NEGADA);

    // Contraprova: a suspensao continua la (a service role ve).
    const { data } = await admin
      .from("clinica_suspensa")
      .select("clinic_id")
      .eq("clinic_id", clinicaA);
    expect(data).toHaveLength(1);
  });
});

describe("depois de reativar", () => {
  it("o membro da A volta a ler a clínica", async () => {
    await reativarASeSuspensa();
    for (const papel of ["admin-a", "recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      expect(await linhasVisiveis(cliente, "contact", clinicaA), papel).toBe(1);
      expect(
        await linhasVisiveis(cliente, "clinic", clinicaA, "id"),
        papel,
      ).toBe(1);
    }
    const { data } = await (
      await logado("admin-a")
    ).rpc("minhas_clinicas_suspensas");
    expect(data).toEqual([]);
  });
});

describe("ia_clinica_habilitada pela sessão", () => {
  it("o membro ativo lê o estado da própria clínica; outra clínica e pendente, nada", async () => {
    for (const papel of PAPEIS_ATIVOS_DA_A) {
      const { data, error } = await (
        await logado(papel)
      )
        .from("ia_clinica_habilitada")
        .select("clinic_id, estado")
        .eq("clinic_id", clinicaA);
      expect(error, papel).toBeNull();
      expect(data, papel).toEqual([
        { clinic_id: clinicaA, estado: "desligado" },
      ]);
    }
    for (const papel of ["pendente-a", "admin-b"]) {
      expect(
        await linhasVisiveis(
          await logado(papel),
          "ia_clinica_habilitada",
          clinicaA,
        ),
        papel,
      ).toBe(0);
    }
  });

  it("o motivo e quem mudou não saem pela sessão; ninguém escreve; anon nem lê", async () => {
    const adminA = await logado("admin-a");
    const { error: erroMotivo } = await adminA
      .from("ia_clinica_habilitada")
      .select("motivo")
      .eq("clinic_id", clinicaA);
    expect((erroMotivo as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroQuem } = await adminA
      .from("ia_clinica_habilitada")
      .select("alterado_por")
      .eq("clinic_id", clinicaA);
    expect((erroQuem as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroUpdate } = await adminA
      .from("ia_clinica_habilitada")
      .update({ estado: "teste" })
      .eq("clinic_id", clinicaA);
    expect((erroUpdate as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroInsert } = await adminA
      .from("ia_clinica_habilitada")
      .insert({ clinic_id: clinicaB, estado: "teste" });
    expect((erroInsert as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const { error: erroAnon } = await anonClient()
      .from("ia_clinica_habilitada")
      .select("clinic_id");
    expect((erroAnon as Erro)?.code).toBe(PERMISSAO_NEGADA);

    // Contraprova: continua desligado.
    const { data } = await admin
      .from("ia_clinica_habilitada")
      .select("estado")
      .eq("clinic_id", clinicaA)
      .single();
    expect((data as { estado: string }).estado).toBe("desligado");
  });
});

describe("as RPCs do painel são só da equipe Conduzza", () => {
  const chamadas: { nome: string; args: () => Record<string, unknown> }[] = [
    {
      nome: "suspender_clinica",
      args: () => ({ p_clinic_id: clinicaB, p_motivo: "Tentativa da sessão" }),
    },
    {
      nome: "reativar_clinica",
      args: () => ({ p_clinic_id: clinicaB, p_motivo: "Tentativa da sessão" }),
    },
    {
      nome: "definir_agente_da_clinica",
      args: () => ({
        p_clinic_id: clinicaB,
        p_estado: "desligado",
        p_motivo: "Tentativa",
      }),
    },
    {
      nome: "definir_teto_da_ia",
      args: () => ({
        p_clinic_id: clinicaB,
        p_teto_diario_centavos_usd: 500,
        p_teto_respostas_por_conversa_hora: 20,
      }),
    },
    { nome: "painel_geral_das_clinicas", args: () => ({}) },
  ];

  it("42501 para todo papel da clínica (o administrador inclusive) e para anon", async () => {
    for (const chamada of chamadas) {
      for (const papel of TODOS_OS_PAPEIS) {
        const { error } = await (
          await logado(papel)
        ).rpc(chamada.nome, chamada.args());
        expect((error as Erro)?.code, `${chamada.nome} por ${papel}`).toBe(
          PERMISSAO_NEGADA,
        );
      }
      const { error: erroAnon } = await anonClient().rpc(
        chamada.nome,
        chamada.args(),
      );
      expect((erroAnon as Erro)?.code, `${chamada.nome} por anon`).toBe(
        PERMISSAO_NEGADA,
      );
    }
    // Nada mudou na B.
    const { data: suspensas } = await admin
      .from("clinica_suspensa")
      .select("clinic_id")
      .eq("clinic_id", clinicaB);
    expect(suspensas).toEqual([]);
  });

  it("a service role passa da guarda (contraprova: chega na regra ou no resultado)", async () => {
    // A B nao esta suspensa: reativar chega na regra.
    const { error: reativar } = await admin.rpc("reativar_clinica", {
      p_clinic_id: clinicaB,
      p_motivo: "Contraprova",
    });
    expect((reativar as Erro)?.code).toBe("P0001");
    expect((reativar as Erro)?.message).toBe("clinica_nao_suspensa");
    // A B e de teste: o agente recusa pela regra.
    const { error: agente } = await admin.rpc("definir_agente_da_clinica", {
      p_clinic_id: clinicaB,
      p_estado: "desligado",
      p_motivo: "Contraprova",
    });
    expect((agente as Erro)?.code).toBe("P0001");
    expect((agente as Erro)?.message).toBe("clinica_de_teste");
    // A B nao tem liberacao: o teto recusa pela regra.
    const { error: teto } = await admin.rpc("definir_teto_da_ia", {
      p_clinic_id: clinicaB,
      p_teto_diario_centavos_usd: 500,
      p_teto_respostas_por_conversa_hora: 20,
    });
    expect((teto as Erro)?.code).toBe("P0001");
    expect((teto as Erro)?.message).toBe("sem_liberacao");
    // O painel responde (com as e_de_teste so com a flag).
    const { data: painel, error } = await admin.rpc(
      "painel_geral_das_clinicas",
      {
        p_incluir_teste: true,
      },
    );
    expect(error).toBeNull();
    const ids = (painel as { clinicas: { id: string }[] }).clinicas.map(
      (c) => c.id,
    );
    expect(ids).toEqual(expect.arrayContaining([clinicaA, clinicaB]));
    const { data: semTeste } = await admin.rpc("painel_geral_das_clinicas");
    const idsSemTeste = (
      semTeste as { clinicas: { id: string }[] }
    ).clinicas.map((c) => c.id);
    expect(idsSemTeste).not.toContain(clinicaA);
    expect(idsSemTeste).not.toContain(clinicaB);
  });
});

// O super admin pela sessao: so com RLS_COM_SUPER_ADMIN=1 (cabecalho).
describe.skipIf(!COM_SUPER_ADMIN)("o super admin pela sessão (opt-in)", () => {
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
    await admin
      .from("product_admin")
      .insert({ user_id: superAdmin })
      .throwOnError();
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
    await reativarASeSuspensa();
    if (superAdmin) {
      // So o product_admin sai aqui. O usuario sai no afterAll geral, depois
      // das clinicas: a trilha de suspender e reativar a A (audit_log com o
      // user_id dele, sem ON DELETE) o seguraria agora.
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  it("suspende, vê a suspensão e o painel, e reativa", async () => {
    const sessao = sessaoDoSuper!;
    const { error: erroSuspender } = await sessao.rpc("suspender_clinica", {
      p_clinic_id: clinicaA,
      p_motivo: "Teste do super admin",
    });
    expect(erroSuspender).toBeNull();
    const { data: suspensao } = await sessao
      .from("clinica_suspensa")
      .select("clinic_id, motivo, suspensa_por")
      .eq("clinic_id", clinicaA);
    expect(suspensao).toEqual([
      {
        clinic_id: clinicaA,
        motivo: "Teste do super admin",
        suspensa_por: superAdmin,
      },
    ]);

    const { data: painel, error: erroPainel } = await sessao.rpc(
      "painel_geral_das_clinicas",
      { p_incluir_teste: true },
    );
    expect(erroPainel).toBeNull();
    const linha = (
      painel as {
        clinicas: { id: string; suspensao: { motivo: string } | null }[];
      }
    ).clinicas.find((c) => c.id === clinicaA);
    expect(linha?.suspensao?.motivo).toBe("Teste do super admin");

    // O motivo do agente nao sai pela sessao nem para o super admin (a
    // permissao por coluna vale para todo autenticado).
    const { error: erroMotivo } = await sessao
      .from("ia_clinica_habilitada")
      .select("motivo")
      .eq("clinic_id", clinicaA);
    expect((erroMotivo as Erro)?.code).toBe(PERMISSAO_NEGADA);

    const { data: reativada, error: erroReativar } = await sessao.rpc(
      "reativar_clinica",
      { p_clinic_id: clinicaA, p_motivo: "Teste do super admin" },
    );
    expect(erroReativar).toBeNull();
    expect(reativada).toEqual({ jobs_vencidos: 0 });
  });
});
