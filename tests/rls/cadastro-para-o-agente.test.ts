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
//   administrador da B (na A) recebem 42501; anon, 42501 sem EXECUTE;
// - salvar_requisitos_do_procedimento, o Salvar de "O que o paciente
//   precisa" numa transacao so (revisao de 27/10/2026): administrador e
//   gestor da A trocam o tipo de dois ativos no Retorno da A e salvam, com a
//   trilha de cada um (a mesma troca em dois UPDATE diretos bate no indice:
//   contraprova); recepcao, leitura, profissional, pendente e o
//   administrador da B (no Retorno da A) recebem 42501 e nada muda; anon,
//   42501 sem EXECUTE; o administrador da B salva o da B (contraprova); o
//   convenio da B no ultimo item da 23503 e NADA fica, nem o que veio antes
//   na lista; o id que sumiu e o ativo igual ao que outra pessoa criou com o
//   modal aberto dao CZ409; o que ela criou fica quando quem salva apaga o
//   que estava na abertura;
// - a clinica suspensa (S, suspensa pela service role com suspender_clinica):
//   o administrador dela nao le nem grava procedure_requirement, e a RPC e a
//   prontidao dao 42501 (a service role le e ve: contraprova);
// - o super admin, SO com RLS_COM_SUPER_ADMIN=1 (como em
//   painel-geral.test.ts: cria um usuario sintetico com product_admin NO
//   BANCO DE PRODUCAO, senha aleatoria, e-mail em example.com; o
//   product_admin sai no afterAll do bloco e o usuario no afterAll geral,
//   depois das clinicas): sem vinculo, ve a prontidao da A e a da S
//   suspensa; na tabela e na RPC, 42501 (a policy de escrita pede o
//   vinculo). Sem a variavel, o bloco e pulado; o ensaio da migration prova
//   o mesmo no SQL.
// Toda negacao tem o caso positivo ao lado (anti falso positivo), e a
// service role confere que nada mudou.
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste com o slug
// cadastro-agente-rls-*, apagadas no afterAll (prazo de 60 s; os cadastros,
// os vinculos, a suspensao da S e a trilha vao em cascata; o beforeAll apaga
// a sobra de uma execucao que morreu ha mais de uma hora), e os usuarios
// desta execucao (depois das clinicas: a trilha da RPC segura o usuario ate
// a clinica sair). Nada aqui usa a id da Salud Care, da teste123 nem da
// Conduzza Teste. ESCRITO, AINDA NAO RODADO (roda depois de aplicar a
// migration: npm run test:rls -- cadastro-para-o-agente).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
// NESTA ORDEM (as clinicas primeiro: a trilha delas segura os usuarios).
//   select id, name from public.clinic where slug like 'cadastro-agente-rls-%';
//   delete from public.clinic where slug like 'cadastro-agente-rls-%';
//   select u.id, u.email from auth.users u
//    where u.email like 'cadastro-agente-rls-%@teste.dev'
//       or u.email like 'cadastro-agente-super-%@example.com';
//   delete from public.product_admin p using auth.users u
//    where u.id = p.user_id and u.email like 'cadastro-agente-super-%@example.com';
//   delete from auth.users u
//    where u.email like 'cadastro-agente-rls-%@teste.dev'
//       or u.email like 'cadastro-agente-super-%@example.com';

const PERMISSAO_NEGADA = "42501";
const DADO_FORA_DA_REGRA = "23514";
const CHAVE_REPETIDA = "23505";
const DE_OUTRA_CLINICA = "23503";
const CADASTRO_MUDOU = "CZ409";
const RPC_DO_SALVAR = "salvar_requisitos_do_procedimento";
const COM_SUPER_ADMIN = process.env.RLS_COM_SUPER_ADMIN === "1";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `CadastroAgente!Rls${sufixo}`;

const email = (papel: string) =>
  `cadastro-agente-rls-${papel}-${sufixo}@teste.dev`;
const EMAIL_DO_SUPER = `cadastro-agente-super-${sufixo}@example.com`;
const slug = (nome: string) => `cadastro-agente-rls-${nome}-${sufixo}`;

let clinicaA = "";
let clinicaB = "";
let clinicaS = "";
let procedimentoA = "";
let procedimentoA2 = "";
let procedimentoB = "";
let procedimentoS = "";
let convenioA = "";
let convenioB = "";
let unidadeA = "";
let profissionalA = "";
let requisitoA = "";
let requisitoB = "";
let requisitoS = "";
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
  // O Retorno da A e so da RPC do Salvar (o ultimo bloco): os outros blocos
  // contam os requisitos da A inteira.
  procedimentoA2 = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Retorno da A",
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
  requisitoB = await inserirId("procedure_requirement", {
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

  // A S: um procedimento com requisito e o administrador, e entao a conta
  // suspensa pela service role (a RPC da equipe Conduzza; os dados ficam).
  clinicaS = await criarClinica("S");
  procedimentoS = await inserirId("procedure", {
    clinic_id: clinicaS,
    name: "Consulta da S",
  });
  requisitoS = await inserirId("procedure_requirement", {
    clinic_id: clinicaS,
    procedure_id: procedimentoS,
    tipo: "pedido_medico",
  });
  await criarUsuario("admin-s", clinicaS, "admin");
  const { error: erroDaSuspensao } = await admin.rpc("suspender_clinica", {
    p_clinic_id: clinicaS,
    p_motivo: "Teste de RLS do cadastro para o agente",
  });
  if (erroDaSuspensao) {
    throw new Error(`suspender a S: ${erroDaSuspensao.message}`);
  }
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

// ---------------------------------------------------------------------------
// O Salvar de "O que o paciente precisa" (RPC, uma transacao so)
// ---------------------------------------------------------------------------

type RequisitoLido = {
  id: string;
  tipo: string;
  insurance_id: string | null;
  texto_ao_paciente: string | null;
  ativo: boolean;
};

/** Os requisitos do Retorno da A, pela service role (a contraprova). */
async function requisitosDoRetorno(): Promise<RequisitoLido[]> {
  const { data } = await admin
    .from("procedure_requirement")
    .select("id, tipo, insurance_id, texto_ao_paciente, ativo")
    .eq("procedure_id", procedimentoA2)
    .order("created_at")
    .order("id")
    .throwOnError();
  return (data ?? []) as RequisitoLido[];
}

/** A trilha do Salvar no Retorno da A, pela service role. */
async function trilhaDoRetorno(): Promise<(string | null)[]> {
  const { data } = await admin
    .from("audit_log")
    .select("user_id")
    .eq("clinic_id", clinicaA)
    .eq("action", "editou_requisitos_do_procedimento")
    .eq("entity", "procedure")
    .eq("entity_id", procedimentoA2)
    .throwOnError();
  return ((data ?? []) as { user_id: string | null }[]).map((l) => l.user_id);
}

/** O item como a action manda (as seis chaves; sem id, o novo). */
function item(r: Partial<RequisitoLido> & { tipo: string }) {
  return {
    ...(r.id ? { id: r.id } : {}),
    tipo: r.tipo,
    insurance_id: r.insurance_id ?? null,
    valor_inteiro: null,
    texto_ao_paciente: r.texto_ao_paciente ?? null,
    ativo: r.ativo ?? true,
  };
}

const trocado = (tipo: string) =>
  tipo === "carteirinha" ? "documento_com_foto" : "carteirinha";

describe("salvar_requisitos_do_procedimento (o Salvar numa transacao so)", () => {
  beforeAll(async () => {
    // Na abertura do modal: dois ativos, para todos.
    await inserirId("procedure_requirement", {
      clinic_id: clinicaA,
      procedure_id: procedimentoA2,
      tipo: "carteirinha",
    });
    await inserirId("procedure_requirement", {
      clinic_id: clinicaA,
      procedure_id: procedimentoA2,
      tipo: "documento_com_foto",
    });
  });

  afterAll(async () => {
    await admin
      .from("procedure_requirement")
      .delete()
      .eq("procedure_id", procedimentoA2)
      .throwOnError();
  });

  it("a mesma troca em dois UPDATE diretos bate no indice (contraprova)", async () => {
    const antes = await requisitosDoRetorno();
    const primeiro = antes[0] as RequisitoLido;
    const { error } = await (
      await logado("admin-a")
    )
      .from("procedure_requirement")
      .update({ tipo: trocado(primeiro.tipo) })
      .eq("id", primeiro.id);
    expect((error as Erro)?.code).toBe(CHAVE_REPETIDA);
    expect(await requisitosDoRetorno()).toEqual(antes);
  });

  it("administrador e gestor da A trocam o tipo de dois ativos e salvam, com a trilha", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const antes = await requisitosDoRetorno();
      expect(antes, papel).toHaveLength(2);
      const { data, error } = await (
        await logado(papel)
      ).rpc(RPC_DO_SALVAR, {
        p_procedure_id: procedimentoA2,
        p_itens: antes.map((r) => item({ id: r.id, tipo: trocado(r.tipo) })),
        p_ids_na_abertura: antes.map((r) => r.id),
      });
      expect(error, papel).toBeNull();
      expect(data, papel).toMatchObject({
        apagados: 0,
        alterados: 2,
        criados: 0,
      });
      const depois = await requisitosDoRetorno();
      expect(
        depois.map((r) => [r.id, r.tipo, r.ativo]),
        papel,
      ).toEqual(antes.map((r) => [r.id, trocado(r.tipo), true]));
    }
    expect((await trilhaDoRetorno()).sort()).toEqual(
      [ids.get("admin-a"), ids.get("gestor-a")].sort(),
    );
  }, 30_000);

  it("recepcao, leitura, profissional, pendente e o administrador da B: 42501, nada muda", async () => {
    const antes = await requisitosDoRetorno();
    const trilhaAntes = await trilhaDoRetorno();
    for (const papel of [
      "recepcao-a",
      "leitura-a",
      "profissional-a",
      "pendente-a",
      "admin-b",
    ]) {
      const { data, error } = await (
        await logado(papel)
      ).rpc(RPC_DO_SALVAR, {
        p_procedure_id: procedimentoA2,
        p_itens: [item({ tipo: "acompanhante" })],
        p_ids_na_abertura: antes.map((r) => r.id),
      });
      expect((error as Erro)?.code, papel).toBe(PERMISSAO_NEGADA);
      expect(data, papel).toBeNull();
    }
    const deAnon = await anonClient().rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoA2,
      p_itens: [item({ tipo: "acompanhante" })],
      p_ids_na_abertura: [],
    });
    expect((deAnon.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(await requisitosDoRetorno()).toEqual(antes);
    expect(await trilhaDoRetorno()).toEqual(trilhaAntes);
    // Contraprova: o administrador da B salva o da B (sem mudanca: zero).
    const daB = await (
      await logado("admin-b")
    ).rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoB,
      p_itens: [item({ id: requisitoB, tipo: "pedido_medico" })],
      p_ids_na_abertura: [requisitoB],
    });
    expect(daB.error).toBeNull();
    expect(daB.data).toMatchObject({ apagados: 0, alterados: 0, criados: 0 });
  }, 30_000);

  it("o convenio da B no ultimo item: 23503, e nada fica (nem o que veio antes na lista)", async () => {
    const antes = await requisitosDoRetorno();
    const trilhaAntes = await trilhaDoRetorno();
    const { error } = await (
      await logado("admin-a")
    ).rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoA2,
      p_itens: [
        ...antes.map((r) =>
          item({ ...r, texto_ao_paciente: "Mudou antes da falha." }),
        ),
        item({ tipo: "autorizacao_previa", insurance_id: convenioA }),
        item({ tipo: "pedido_medico", insurance_id: convenioB }),
      ],
      p_ids_na_abertura: antes.map((r) => r.id),
    });
    expect((error as Erro)?.code).toBe(DE_OUTRA_CLINICA);
    expect(await requisitosDoRetorno()).toEqual(antes);
    expect(await trilhaDoRetorno()).toEqual(trilhaAntes);
  }, 30_000);

  it("o que mudou desde que o modal abriu: CZ409; o que outra pessoa criou fica", async () => {
    const sessao = await logado("admin-a");
    const antes = await requisitosDoRetorno();
    const abertura = antes.map((r) => r.id);
    // O id que sumiu do banco no meio da edicao.
    const sumiu = await sessao.rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoA2,
      p_itens: [item({ id: crypto.randomUUID(), tipo: "pedido_medico" })],
      p_ids_na_abertura: [],
    });
    expect((sumiu.error as Erro)?.code).toBe(CADASTRO_MUDOU);
    // Outra pessoa cria um ativo com o modal aberto; quem salva manda um
    // igual, novo: CZ409, nada gravado.
    const deOutraPessoa = await inserirId("procedure_requirement", {
      clinic_id: clinicaA,
      procedure_id: procedimentoA2,
      tipo: "exames_anteriores",
    });
    const bateu = await sessao.rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoA2,
      p_itens: [
        ...antes.map((r) => item(r)),
        item({ tipo: "exames_anteriores" }),
      ],
      p_ids_na_abertura: abertura,
    });
    expect((bateu.error as Erro)?.code).toBe(CADASTRO_MUDOU);
    // Quem salva tira o segundo da lista: so ele sai (estava na abertura);
    // o da outra pessoa fica.
    const { data, error } = await sessao.rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoA2,
      p_itens: [item(antes[0] as RequisitoLido)],
      p_ids_na_abertura: abertura,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ apagados: 1, alterados: 0, criados: 0 });
    expect((await requisitosDoRetorno()).map((r) => r.id).sort()).toEqual(
      [(antes[0] as RequisitoLido).id, deOutraPessoa].sort(),
    );
  }, 30_000);
});

// ---------------------------------------------------------------------------
// A clinica suspensa (S)
// ---------------------------------------------------------------------------

describe("a clinica suspensa (S)", () => {
  it("o administrador da S nao le nem grava procedure_requirement (a service role le: contraprova)", async () => {
    const sessao = await logado("admin-s");
    const lido = await sessao
      .from("procedure_requirement")
      .select("id")
      .eq("clinic_id", clinicaS);
    expect(lido.error).toBeNull();
    expect(lido.data).toEqual([]);
    const criado = await sessao.from("procedure_requirement").insert({
      clinic_id: clinicaS,
      procedure_id: procedimentoS,
      tipo: "carteirinha",
    });
    expect((criado.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const editado = await sessao
      .from("procedure_requirement")
      .update({ texto_ao_paciente: "Mudou." })
      .eq("id", requisitoS)
      .select("id");
    expect(editado.data ?? []).toEqual([]);
    const { data } = await admin
      .from("procedure_requirement")
      .select("id, texto_ao_paciente")
      .eq("clinic_id", clinicaS)
      .throwOnError();
    expect(data).toEqual([{ id: requisitoS, texto_ao_paciente: null }]);
  }, 30_000);

  it("a RPC do Salvar e a prontidao: 42501 para o administrador da S (a service role ve: contraprova)", async () => {
    const sessao = await logado("admin-s");
    const salvar = await sessao.rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoS,
      p_itens: [item({ id: requisitoS, tipo: "pedido_medico" })],
      p_ids_na_abertura: [requisitoS],
    });
    expect((salvar.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const prontidao = await sessao.rpc("prontidao_do_cadastro_da_ia", {
      p_clinic_id: clinicaS,
    });
    expect((prontidao.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(prontidao.data).toBeNull();
    const pelaServiceRole = await admin.rpc("prontidao_do_cadastro_da_ia", {
      p_clinic_id: clinicaS,
    });
    expect(pelaServiceRole.error).toBeNull();
    expect(
      (pelaServiceRole.data as { procedimentos_sem_requisitos: unknown })
        .procedimentos_sem_requisitos,
    ).toEqual({ total: 0, nomes: [] });
  }, 30_000);
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
    if (superAdmin) {
      const { error } = await admin
        .from("product_admin")
        .delete()
        .eq("user_id", superAdmin);
      expect(error, "tirar o product_admin sintetico").toBeNull();
    }
  });

  it("sem vinculo, ve a prontidao da A e a da S suspensa", async () => {
    const sessao = sessaoDoSuper!;
    const daA = await sessao.rpc("prontidao_do_cadastro_da_ia", {
      p_clinic_id: clinicaA,
    });
    expect(daA.error).toBeNull();
    expect(
      (daA.data as { profissionais_sem_jornada: unknown })
        .profissionais_sem_jornada,
    ).toEqual({ total: 1, nomes: ["Profissional da A"] });
    const daS = await sessao.rpc("prontidao_do_cadastro_da_ia", {
      p_clinic_id: clinicaS,
    });
    expect(daS.error).toBeNull();
    expect((daS.data as { unidades_ativas: number }).unidades_ativas).toBe(0);
  }, 30_000);

  it("sem vinculo, nao grava requisito na tabela nem pela RPC: 42501", async () => {
    const sessao = sessaoDoSuper!;
    const criado = await sessao.from("procedure_requirement").insert({
      clinic_id: clinicaA,
      procedure_id: procedimentoA,
      tipo: "carteirinha",
    });
    expect((criado.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    const salvar = await sessao.rpc(RPC_DO_SALVAR, {
      p_procedure_id: procedimentoA,
      p_itens: [item({ id: requisitoA, tipo: "documento_com_foto" })],
      p_ids_na_abertura: [requisitoA],
    });
    expect((salvar.error as Erro)?.code).toBe(PERMISSAO_NEGADA);
    expect(await requisitosDaA()).toEqual([
      {
        id: requisitoA,
        tipo: "documento_com_foto",
        texto_ao_paciente: null,
        ativo: true,
      },
    ]);
  }, 30_000);
});
