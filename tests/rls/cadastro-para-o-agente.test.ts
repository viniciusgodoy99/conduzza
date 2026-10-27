import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "./stack";

// Cadastro para o agente (AG1, migration 20261027100000_cadastro_para_o_agente
// .sql), pela API com JWT real de cada papel. Pedido do dono de 26/10/2026: o
// agente de IA faz todo o atendimento e o agendamento, e para isso o
// Cadastro ganha o endereco estruturado e o horario da unidade, "O que o
// paciente precisa" de cada procedimento (procedure_requirement), a idade e
// a grade do profissional e a prontidao (prontidao_do_cadastro_da_ia). O que
// esta em jogo:
// - procedure_requirement: o membro ATIVO da clinica le (administrador,
//   gestor, recepcao, leitura e profissional); o pendente e a outra clinica
//   nao; administrador e gestor escrevem; recepcao, leitura, profissional,
//   pendente e a outra clinica recebem 42501 no INSERT e mexem em 0 linhas
//   no UPDATE e no DELETE; anon nem tem o grant;
// - a mesma clinica: o procedimento e o convenio de outra clinica recebem
//   23503 (o gatilho vem antes da RLS: nem o administrador da A aponta para
//   a B);
// - os CHECKs pela API: tipo fora da lista, idade minima acima de 120,
//   "Outro" sem texto (23514) e dois ativos do mesmo tipo e convenio (23505);
// - as colunas novas de unit, professional e procedure pelas policies de
//   sempre: a UF, o CEP, o link, o horario e as idades fora da regra
//   recebem 23514; a leitura grava 0 linhas;
// - a prontidao: administrador e gestor da A veem; recepcao, leitura e o
//   administrador da B (na A) recebem 42501; anon, 42501 sem EXECUTE.
// Toda negacao tem o caso positivo ao lado (anti falso positivo), e a
// service role confere que nada mudou.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// cadastro-agente-rls-*, apagadas no afterAll (prazo de 60 s; os cadastros e
// os vinculos vao em cascata; o beforeAll apaga a sobra de uma execucao que
// morreu ha mais de uma hora), e os usuarios desta execucao. Nada aqui usa a
// id da Salud Care, da teste123 nem da Conduzza Teste. ESCRITO, AINDA NAO
// RODADO (roda depois de aplicar a migration: npm run test:rls --
// cadastro-para-o-agente).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'cadastro-agente-rls-%';
//   delete from public.clinic where slug like 'cadastro-agente-rls-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'cadastro-agente-rls-%@teste.dev';
//   delete from auth.users u where u.email like 'cadastro-agente-rls-%@teste.dev';

const PERMISSAO_NEGADA = "42501";
const DADO_FORA_DA_REGRA = "23514";
const CHAVE_REPETIDA = "23505";
const DE_OUTRA_CLINICA = "23503";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `CadastroAgente!Rls${sufixo}`;

const email = (papel: string) =>
  `cadastro-agente-rls-${papel}-${sufixo}@teste.dev`;
const slug = (nome: string) => `cadastro-agente-rls-${nome}-${sufixo}`;

let clinicaA = "";
let clinicaB = "";
let procedimentoA = "";
let procedimentoB = "";
let convenioA = "";
let convenioB = "";
let unidadeA = "";
let profissionalA = "";
let requisitoA = "";
const ids = new Map<string, string>();

type Erro = { code?: string; message?: string } | null;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Cadastro Agente RLS ${nome} ${sufixo}`,
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
  status = "ativo",
  professionalId: string | null = null,
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(papel),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Cadastro Agente ${papel}` },
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
      status,
      professional_id: professionalId,
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

async function inserirId(
  tabela: string,
  linha: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from(tabela)
    .insert(linha)
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** Os requisitos da A, lidos pela service role (a contraprova). */
async function requisitosDaA(): Promise<Record<string, unknown>[]> {
  const { data } = await admin
    .from("procedure_requirement")
    .select("id, tipo, texto_ao_paciente, ativo")
    .eq("clinic_id", clinicaA)
    .order("created_at")
    .throwOnError();
  return (data ?? []) as Record<string, unknown>[];
}

beforeAll(async () => {
  // A sobra de uma execucao que morreu (mais de uma hora).
  await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", "cadastro-agente-rls-%")
    .lt("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  profissionalA = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Profissional da A",
  });
  procedimentoA = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Consulta da A",
  });
  procedimentoB = await inserirId("procedure", {
    clinic_id: clinicaB,
    name: "Consulta da B",
  });
  convenioA = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Convênio da A",
  });
  convenioB = await inserirId("insurance", {
    clinic_id: clinicaB,
    name: "Convênio da B",
  });
  unidadeA = await inserirId("unit", {
    clinic_id: clinicaA,
    name: "Sede da A",
  });
  requisitoA = await inserirId("procedure_requirement", {
    clinic_id: clinicaA,
    procedure_id: procedimentoA,
    tipo: "documento_com_foto",
  });
  await inserirId("procedure_requirement", {
    clinic_id: clinicaB,
    procedure_id: procedimentoB,
    tipo: "pedido_medico",
  });

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario(
    "profissional-a",
    clinicaA,
    "profissional",
    "ativo",
    profissionalA,
  );
  await criarUsuario("pendente-a", clinicaA, "recepcao", "pendente");
  await criarUsuario("admin-b", clinicaB, "admin");
}, 120_000);

afterAll(async () => {
  // As clinicas desta execucao pelo slug (cadastros e vinculos em cascata);
  // depois os usuarios, com o erro conferido: limpeza que falha calada
  // deixaria usuario sintetico na producao.
  const { error: erroDasClinicas } = await admin
    .from("clinic")
    .delete()
    .eq("e_de_teste", true)
    .like("slug", `cadastro-agente-rls-%-${sufixo}`);
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

describe("procedure_requirement: quem le", () => {
  it.each(["admin-a", "gestor-a", "recepcao-a", "leitura-a", "profissional-a"])(
    "%s le o requisito da A",
    async (papel) => {
      const sessao = await logado(papel);
      const { data, error } = await sessao
        .from("procedure_requirement")
        .select("id, tipo")
        .eq("clinic_id", clinicaA);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: requisitoA, tipo: "documento_com_foto" }]);
    },
    30_000,
  );

  it("o pendente e a outra clinica nao leem (a B le o dela: contraprova)", async () => {
    for (const papel of ["pendente-a", "admin-b"]) {
      const sessao = await logado(papel);
      const { data, error } = await sessao
        .from("procedure_requirement")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(error, papel).toBeNull();
      expect(data, papel).toEqual([]);
    }
    const daB = await (
      await logado("admin-b")
    )
      .from("procedure_requirement")
      .select("tipo")
      .eq("clinic_id", clinicaB);
    expect(daB.data).toEqual([{ tipo: "pedido_medico" }]);
  }, 30_000);

  it("anon nem tem o grant", async () => {
    const { error } = await anonClient()
      .from("procedure_requirement")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("procedure_requirement: quem escreve", () => {
  it("administrador e gestor criam, editam e apagam na A", async () => {
    for (const [papel, tipo] of [
      ["admin-a", "acompanhante"],
      ["gestor-a", "exames_anteriores"],
    ] as const) {
      const sessao = await logado(papel);
      const { data, error } = await sessao
        .from("procedure_requirement")
        .insert({ clinic_id: clinicaA, procedure_id: procedimentoA, tipo })
        .select("id")
        .single();
      expect(error, papel).toBeNull();
      const id = (data as { id: string }).id;
      const editado = await sessao
        .from("procedure_requirement")
        .update({ texto_ao_paciente: `Texto de ${papel}.` })
        .eq("id", id)
        .select("id");
      expect(editado.data, papel).toHaveLength(1);
      const apagado = await sessao
        .from("procedure_requirement")
        .delete()
        .eq("id", id)
        .select("id");
      expect(apagado.data, papel).toHaveLength(1);
    }
    expect(await requisitosDaA()).toHaveLength(1);
  }, 30_000);

  it.each([
    "recepcao-a",
    "leitura-a",
    "profissional-a",
    "pendente-a",
    "admin-b",
  ])(
    "%s nao cria (42501), nao edita nem apaga (0 linhas)",
    async (papel) => {
      const sessao = await logado(papel);
      const criado = await sessao.from("procedure_requirement").insert({
        clinic_id: clinicaA,
        procedure_id: procedimentoA,
        tipo: "carteirinha",
      });
      expect((criado.error as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
      const editado = await sessao
        .from("procedure_requirement")
        .update({ texto_ao_paciente: "Mudou." })
        .eq("id", requisitoA)
        .select("id");
      expect(editado.data ?? [], papel).toEqual([]);
      const apagado = await sessao
        .from("procedure_requirement")
        .delete()
        .eq("id", requisitoA)
        .select("id");
      expect(apagado.data ?? [], papel).toEqual([]);
      expect(await requisitosDaA()).toEqual([
        {
          id: requisitoA,
          tipo: "documento_com_foto",
          texto_ao_paciente: null,
          ativo: true,
        },
      ]);
    },
    30_000,
  );

  it("o procedimento e o convenio de outra clinica: 23503, ate para o administrador", async () => {
    const sessao = await logado("admin-a");
    const comProcedimentoDaB = await sessao
      .from("procedure_requirement")
      .insert({
        clinic_id: clinicaA,
        procedure_id: procedimentoB,
        tipo: "carteirinha",
      });
    expect((comProcedimentoDaB.error as Erro)?.code).toBe(DE_OUTRA_CLINICA);
    expect((comProcedimentoDaB.error as Erro)?.message).toBe(
      "O procedimento informado não pertence a esta clínica.",
    );
    const comConvenioDaB = await sessao.from("procedure_requirement").insert({
      clinic_id: clinicaA,
      procedure_id: procedimentoA,
      insurance_id: convenioB,
      tipo: "carteirinha",
    });
    expect((comConvenioDaB.error as Erro)?.code).toBe(DE_OUTRA_CLINICA);
    // Contraprova: o convenio da A passa.
    const comConvenioDaA = await sessao
      .from("procedure_requirement")
      .insert({
        clinic_id: clinicaA,
        procedure_id: procedimentoA,
        insurance_id: convenioA,
        tipo: "carteirinha",
      })
      .select("id")
      .single();
    expect(comConvenioDaA.error).toBeNull();
    await admin
      .from("procedure_requirement")
      .delete()
      .eq("id", (comConvenioDaA.data as { id: string }).id)
      .throwOnError();
  }, 30_000);

  it("os CHECKs e o unico pela API", async () => {
    const sessao = await logado("admin-a");
    for (const [rotulo, linha] of [
      ["tipo fora da lista", { tipo: "invalido" }],
      [
        "idade minima acima de 120",
        { tipo: "idade_minima", valor_inteiro: 121 },
      ],
      ["minutos sem o numero", { tipo: "chegar_antes_minutos" }],
      ["numero onde nao cabe", { tipo: "carteirinha", valor_inteiro: 5 }],
      ["Outro sem texto", { tipo: "outro" }],
      [
        "texto com espaco na ponta",
        { tipo: "carteirinha", texto_ao_paciente: " Traga." },
      ],
    ] as const) {
      const { error } = await sessao
        .from("procedure_requirement")
        .insert({ clinic_id: clinicaA, procedure_id: procedimentoA, ...linha });
      expect((error as Erro)?.code, rotulo).toBe(DADO_FORA_DA_REGRA);
    }
    const repetido = await sessao.from("procedure_requirement").insert({
      clinic_id: clinicaA,
      procedure_id: procedimentoA,
      tipo: "documento_com_foto",
    });
    expect((repetido.error as Erro)?.code).toBe(CHAVE_REPETIDA);
    // Contraprova: o mesmo tipo inativo passa.
    const inativo = await sessao
      .from("procedure_requirement")
      .insert({
        clinic_id: clinicaA,
        procedure_id: procedimentoA,
        tipo: "documento_com_foto",
        ativo: false,
      })
      .select("id")
      .single();
    expect(inativo.error).toBeNull();
    await admin
      .from("procedure_requirement")
      .delete()
      .eq("id", (inativo.data as { id: string }).id)
      .throwOnError();
    expect(await requisitosDaA()).toHaveLength(1);
  }, 30_000);
});

describe("as colunas novas de unit, professional e procedure", () => {
  it("a administradora grava o endereco e o horario; fora da regra, 23514", async () => {
    const sessao = await logado("admin-a");
    const bom = await sessao
      .from("unit")
      .update({
        logradouro: "Rua das Flores",
        numero: "123",
        bairro: "Centro",
        cidade: "Fortaleza",
        uf: "CE",
        cep: "60000000",
        link_do_mapa: "https://maps.app.goo.gl/abc",
        horario_de_funcionamento: { "1": [{ inicio: "08:00", fim: "12:00" }] },
      })
      .eq("id", unidadeA)
      .select("id");
    expect(bom.error).toBeNull();
    expect(bom.data).toHaveLength(1);
    for (const [rotulo, campos] of [
      ["uf", { uf: "XX" }],
      ["cep com mascara", { cep: "60000-000" }],
      ["link http", { link_do_mapa: "http://maps.google.com" }],
      [
        "horario que vira o dia",
        {
          horario_de_funcionamento: {
            "1": [{ inicio: "22:00", fim: "02:00" }],
          },
        },
      ],
      ["horario vazio", { horario_de_funcionamento: {} }],
      ["logradouro com espaco na ponta", { logradouro: " Rua" }],
    ] as const) {
      const { error } = await sessao
        .from("unit")
        .update(campos)
        .eq("id", unidadeA);
      expect((error as Erro)?.code, rotulo).toBe(DADO_FORA_DA_REGRA);
    }
  }, 30_000);

  it("a leitura nao grava (0 linhas) e a idade invertida do profissional e 23514", async () => {
    const leitura = await logado("leitura-a");
    const naUnidade = await leitura
      .from("unit")
      .update({ referencia: "Mudou." })
      .eq("id", unidadeA)
      .select("id");
    expect(naUnidade.data ?? []).toEqual([]);
    const noProcedimento = await leitura
      .from("procedure")
      .update({ ia_pode_informar: false })
      .eq("id", procedimentoA)
      .select("id");
    expect(noProcedimento.data ?? []).toEqual([]);
    const sessao = await logado("gestor-a");
    const invertida = await sessao
      .from("professional")
      .update({ idade_minima: 30, idade_maxima: 20 })
      .eq("id", profissionalA);
    expect((invertida.error as Erro)?.code).toBe(DADO_FORA_DA_REGRA);
    const certa = await sessao
      .from("professional")
      .update({ idade_minima: 18, idade_maxima: 65, grade_minutos: 30 })
      .eq("id", profissionalA)
      .select("idade_minima, idade_maxima, grade_minutos");
    expect(certa.data).toEqual([
      { idade_minima: 18, idade_maxima: 65, grade_minutos: 30 },
    ]);
    const { data } = await admin
      .from("procedure")
      .select("ia_pode_informar")
      .eq("id", procedimentoA)
      .single()
      .throwOnError();
    expect(data).toEqual({ ia_pode_informar: true });
  }, 30_000);
});

describe("prontidao_do_cadastro_da_ia", () => {
  it("administrador e gestor da A veem a da A (so contagens e nomes)", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const { data, error } = await (
        await logado(papel)
      ).rpc("prontidao_do_cadastro_da_ia", { p_clinic_id: clinicaA });
      expect(error, papel).toBeNull();
      expect(Object.keys(data as object).sort(), papel).toEqual(
        [
          "convenios_sem_cobertura",
          "nenhuma_unidade_ativa",
          "procedimentos_sem_preco",
          "procedimentos_sem_requisitos",
          "procedimentos_sem_vinculo",
          "profissionais_sem_jornada",
          "unidades_ativas",
          "unidades_sem_endereco",
          "unidades_sem_horario",
        ].sort(),
      );
      expect((data as { unidades_ativas: number }).unidades_ativas).toBe(1);
      expect(
        (data as { profissionais_sem_jornada: unknown })
          .profissionais_sem_jornada,
      ).toEqual({ total: 1, nomes: ["Profissional da A"] });
    }
  }, 30_000);

  it("recepcao, leitura, profissional, pendente e o administrador da B (na A): 42501", async () => {
    for (const papel of [
      "recepcao-a",
      "leitura-a",
      "profissional-a",
      "pendente-a",
      "admin-b",
    ]) {
      const { data, error } = await (
        await logado(papel)
      ).rpc("prontidao_do_cadastro_da_ia", { p_clinic_id: clinicaA });
      expect((error as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
      expect(data, papel).toBeNull();
    }
    // Contraprova: o administrador da B ve a da B.
    const daB = await (
      await logado("admin-b")
    ).rpc("prontidao_do_cadastro_da_ia", {
      p_clinic_id: clinicaB,
    });
    expect(daB.error).toBeNull();
  }, 30_000);

  it("anon nem executa", async () => {
    const { error } = await anonClient().rpc("prontidao_do_cadastro_da_ia", {
      p_clinic_id: clinicaA,
    });
    expect((error as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });
});
