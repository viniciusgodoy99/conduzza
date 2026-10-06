import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Agente de IA: travas de liberacao e schema (E0, migration 20261006100000)
// e a liberacao pela tela (aba Agente de IA de Configuracoes, migration
// 20261006120000), pela API com JWT real de cada papel. O que esta em jogo:
//   - ia_liberacao, ia_numero_liberado e ia_contato_liberado: o
//     ADMINISTRADOR e o GESTOR ativos da propria clinica leem as linhas dela
//     quando a clinica esta na lista fechada ou e e_de_teste (a A e a B sao
//     de teste); recepcao e leitura da propria clinica, pendente, admin de
//     outra clinica e admin de clinica fora da lista (a F, que tem linha e,
//     SO DENTRO dos testes que precisam, deixa de ser de teste) leem zero
//     linhas. ia_interruptor e ia_uso: so o super admin le. Nenhuma sessao
//     escreve direto (42501), e anon nem chega (42501). llm_preco: todo
//     autenticado le, ninguem escreve. ia_interruptor_ligado: todo
//     autenticado le so o booleano, anon nao;
//   - definir_liberacao_da_ia, definir_numero_da_ia e
//     definir_contato_liberado_da_ia: o ADMINISTRADOR ativo da propria
//     clinica (da lista ou de teste) escreve, com a trilha no nome dele, e
//     um numero por vez (ligar um desliga o outro na mesma chamada; com
//     erro, nada muda); gestor, recepcao, leitura, pendente, admin de outra
//     clinica, admin de clinica fora da lista e anon: 42501 (na F, o 42501
//     vem do guarda: o sistema desliga a mesma linha sem erro).
//     definir_interruptor_da_ia:
//     42501 para todo papel da clinica, inclusive o administrador (so o
//     super admin, que nao tem sessao aqui). ia_pode_atender,
//     ia_pode_simular e ia_clinicas_da_fase_controlada nem sao executaveis
//     pela sessao;
//   - ia_clinica_liberada: verdadeiro so para membro ativo da clinica
//     liberada; falso para pendente e para outra clinica;
//   - conversation.status = 'ia_atendendo' pela SESSAO: 42501 quando a IA
//     nao esta liberada para aquele telefone naquele numero (UPDATE e
//     INSERT), para todo papel, inclusive o admin da clinica liberada (com o
//     telefone fora da lista) e o da clinica sem liberacao. A trava e a
//     LIBERACAO, nao o papel: com o telefone liberado, a recepcao devolve para
//     a IA (contraprova). Com a conversa ja na IA, a sessao tambem nao troca
//     o contact_id para um telefone fora da lista (42501). O gatilho barra
//     so sessao: a service role (o servidor, as fixtures e o seed) passa,
//     porque o servidor e guardado por ia_pode_atender ao enfileirar, antes
//     do modelo e antes do envio (E3);
//   - clinic.e_de_teste: so a equipe do Conduzza muda (42501 para o admin);
//   - ai_agent_config e knowledge_item: membro ativo le; admin e gestor
//     escrevem; a versao publicada nao muda nem sai; a sessao nao publica nem
//     forja autor.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, apagadas no
// afterAll. A F nasce de teste e ganha a linha DESLIGADA (nunca liga; nao
// tem numero nem contato). Ela so deixa de ser de teste DENTRO dos testes
// que precisam de uma clinica fora da lista (foraDeTeste), e volta a ser de
// teste no finally, antes do proximo teste: o motor de producao ignora
// clinica e_de_teste, entao uma execucao que falha no meio nao deixa uma
// clinica sintetica "de verdade" para tras.
// O interruptor global NUNCA e tocado: as tentativas contra ele usam filtro
// que nao casa com linha nenhuma (id = false) ou p_ligado nulo (um guarda
// com defeito pararia no 22004, antes de gravar). Nada aqui usa a id da
// salud-care, da teste123 nem da Conduzza Teste.
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll (processo
// derrubado, sem finally): no SQL editor, conferir e depois apagar.
//   select id, name, e_de_teste from public.clinic
//    where slug like 'ia-liberacao-%';
//   update public.clinic set e_de_teste = true
//    where slug like 'ia-liberacao-%' and not e_de_teste;
//   delete from public.clinic where slug like 'ia-liberacao-%' and e_de_teste;
// e os usuarios sinteticos (auth.users com email like
// 'ia-liberacao-%@teste.dev'), pelo painel do Supabase ou pela API de
// administracao, como o afterAll faz.

const PERMISSAO_NEGADA = "42501";
const REGRA_DO_BANCO = "P0001";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "IaLiberacao!Rls2026";
const digitos = sufixo.replace(/\D/g, "").padEnd(6, "5").slice(0, 6);

const TELEFONE_DA_EQUIPE = `+5584975${digitos}`;
const TELEFONE_DO_PACIENTE = `+5584976${digitos}`;
const TELEFONE_SEM_CONVERSA = `+5584977${digitos}`;
const TELEFONE_DA_B = `+5584978${digitos}`;
const TELEFONE_DA_F = `+5584979${digitos}`;
// O telefone que o administrador da A cadastra pela tela, sem o nono digito
// (o banco grava a chave canonica, com o 9).
const TELEFONE_DO_ADMIN_SEM_NONO = `+558497${digitos}`;
const TELEFONE_DO_ADMIN = `+5584997${digitos}`;

let clinicaA = "";
let clinicaB = "";
let clinicaF = "";
let numeroA = "";
let segundoNumeroA = "";
let numeroB = "";
let conversaDaEquipe = "";
let conversaDoPaciente = "";
let contatoDaEquipe = "";
let contatoDoPaciente = "";
let contatoSemConversa = "";
let conversaDaB = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

const email = (apelido: string) =>
  `ia-liberacao-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;

const MEMBROS_ATIVOS_DA_A = [
  "admin-a",
  "gestor-a",
  "recepcao-a",
  "leitura-a",
] as const;
/** Os papeis que chegam a Configuracoes: leem as tabelas da liberacao. */
const GESTAO_DA_A = ["admin-a", "gestor-a"] as const;
const TODAS_AS_SESSOES = [
  ...MEMBROS_ATIVOS_DA_A,
  "pendente-a",
  "admin-b",
  "admin-f",
] as const;
const SEM_ESCRITA_NO_AGENTE = [
  "recepcao-a",
  "leitura-a",
  "pendente-a",
  "admin-b",
] as const;

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
      name: `IA liberacao ${nome} ${sufixo}`,
      slug: `ia-liberacao-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function contatoCom(clinicId: string, telefone: string): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Contato" })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

async function conversaCom(
  clinicId: string,
  contactId: string,
  whatsappAccountId: string,
): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      whatsapp_account_id: whatsappAccountId,
      status: "aguardando_humano",
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/**
 * A F fora da lista e SEM e_de_teste so durante o corpo (o caso de clinica
 * fora da lista com linha); volta a ser de teste no finally, falhe o corpo
 * ou nao. Pela service role (so a equipe do Conduzza muda e_de_teste).
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

/** ativo de cada numero liberado da A, por id (lido pelo sistema). */
async function numerosDaA(): Promise<Record<string, boolean>> {
  const { data } = await admin
    .from("ia_numero_liberado")
    .select("whatsapp_account_id, ativo")
    .eq("clinic_id", clinicaA)
    .throwOnError();
  return Object.fromEntries(
    (data as { whatsapp_account_id: string; ativo: boolean }[]).map((linha) => [
      linha.whatsapp_account_id,
      linha.ativo,
    ]),
  );
}

/** Retrato da liberacao da A (lido pelo sistema), para provar que nada mudou. */
async function liberacaoDaA() {
  const [liberacao, numeros, contatos] = await Promise.all([
    admin
      .from("ia_liberacao")
      .select("clinic_id, modo, liberada, pausada_pela_clinica, motivo")
      .eq("clinic_id", clinicaA)
      .throwOnError(),
    admin
      .from("ia_numero_liberado")
      .select("whatsapp_account_id, ativo")
      .eq("clinic_id", clinicaA)
      .throwOnError(),
    admin
      .from("ia_contato_liberado")
      .select("phone_key, rotulo, ativo")
      .eq("clinic_id", clinicaA)
      .throwOnError(),
  ]);
  return {
    liberacao: liberacao.data,
    numeros: numeros.data,
    contatos: contatos.data,
  };
}

async function statusDa(conversationId: string): Promise<string> {
  const { data } = await admin
    .from("conversation")
    .select("status")
    .eq("id", conversationId)
    .single()
    .throwOnError();
  return (data as { status: string }).status;
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");
  clinicaF = await criarClinica("F");
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" }))
    .id;
  // So entra em ia_numero_liberado no teste do administrador (um por vez).
  segundoNumeroA = (
    await criarNumeroDeTeste(admin, clinicaA, { nome: "Segundo" })
  ).id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" }))
    .id;

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("pendente-a", clinicaA, "gestor", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");
  await criarPessoa("admin-f", clinicaF, "admin");

  contatoDaEquipe = await contatoCom(clinicaA, TELEFONE_DA_EQUIPE);
  contatoDoPaciente = await contatoCom(clinicaA, TELEFONE_DO_PACIENTE);
  contatoSemConversa = await contatoCom(clinicaA, TELEFONE_SEM_CONVERSA);
  const daB = await contatoCom(clinicaB, TELEFONE_DA_B);
  conversaDaEquipe = await conversaCom(clinicaA, contatoDaEquipe, numeroA);
  conversaDoPaciente = await conversaCom(clinicaA, contatoDoPaciente, numeroA);
  conversaDaB = await conversaCom(clinicaB, daB, numeroB);

  // A liberada pelo sistema (service role): modo contatos, o numero da A e
  // so o telefone da equipe. A B fica sem liberacao.
  for (const [rpc, args] of [
    [
      "definir_liberacao_da_ia",
      {
        p_clinic_id: clinicaA,
        p_liberada: true,
        p_modo: "contatos",
        p_motivo: "teste de RLS",
      },
    ],
    [
      "definir_numero_da_ia",
      { p_clinic_id: clinicaA, p_whatsapp_account_id: numeroA, p_ativo: true },
    ],
    [
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DA_EQUIPE,
        p_rotulo: "Equipe de teste",
        p_ativo: true,
      },
    ],
  ] as const) {
    const { data, error } = await admin.rpc(rpc, args);
    expect(error).toBeNull();
    expect(data).toBe(true);
  }

  // A F ganha a linha DESLIGADA e um telefone desligado enquanto e de
  // teste, e CONTINUA de teste: so os testes que precisam a tiram da lista
  // (foraDeTeste), e T3a deixa a linha ficar. E o caso que prova o filtro
  // "lista ou e_de_teste" da leitura e do guarda: a linha existe, o admin
  // dela nao le nem mexe enquanto a F nao e de teste.
  for (const [rpc, args] of [
    [
      "definir_liberacao_da_ia",
      { p_clinic_id: clinicaF, p_liberada: false, p_motivo: "teste de RLS" },
    ],
    [
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaF,
        p_telefone_e164: TELEFONE_DA_F,
        p_rotulo: "Equipe da F",
        p_ativo: false,
      },
    ],
  ] as const) {
    const { data, error } = await admin.rpc(rpc, args);
    expect(error).toBeNull();
    expect(data).toBe(false);
  }
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

describe("tabelas da liberacao: administrador e gestor da propria clinica leem, nenhuma sessao escreve", () => {
  const TRAVAS_DA_CLINICA = [
    "ia_liberacao",
    "ia_numero_liberado",
    "ia_contato_liberado",
  ] as const;
  const SO_DO_SUPER_ADMIN = ["ia_interruptor", "ia_uso"] as const;
  const TABELAS = [...TRAVAS_DA_CLINICA, ...SO_DO_SUPER_ADMIN] as const;

  it("administrador e gestor da A leem a liberacao, o numero e os telefones da A; ninguem le o interruptor nem o gasto", async () => {
    await admin
      .from("ia_uso")
      .insert({
        clinic_id: clinicaA,
        origem: "simulador",
        papel: "agente",
        modelo: "claude-opus-5",
        custo_microdolar: 1,
      })
      .throwOnError();
    for (const apelido of GESTAO_DA_A) {
      const cliente = como(apelido);
      const { data: liberacao, error } = await cliente
        .from("ia_liberacao")
        .select("clinic_id, modo, liberada");
      expect(error).toBeNull();
      expect(liberacao).toEqual([
        { clinic_id: clinicaA, modo: "contatos", liberada: true },
      ]);
      const { data: numeros } = await cliente
        .from("ia_numero_liberado")
        .select("whatsapp_account_id, ativo");
      expect(numeros).toEqual([{ whatsapp_account_id: numeroA, ativo: true }]);
      const { data: telefones } = await cliente
        .from("ia_contato_liberado")
        .select("phone_key, rotulo, ativo");
      expect(telefones).toEqual([
        {
          phone_key: TELEFONE_DA_EQUIPE,
          rotulo: "Equipe de teste",
          ativo: true,
        },
      ]);
      for (const tabela of SO_DO_SUPER_ADMIN) {
        const { data, error: erro } = await cliente.from(tabela).select("*");
        expect(erro).toBeNull();
        expect(data).toEqual([]);
      }
    }
    // contraprova: o sistema le a liberacao e o gasto da A
    const retrato = await liberacaoDaA();
    expect(retrato.liberacao).toEqual([
      {
        clinic_id: clinicaA,
        modo: "contatos",
        liberada: true,
        pausada_pela_clinica: false,
        motivo: "teste de RLS",
      },
    ]);
    expect(retrato.numeros).toEqual([
      { whatsapp_account_id: numeroA, ativo: true },
    ]);
    expect(retrato.contatos).toEqual([
      { phone_key: TELEFONE_DA_EQUIPE, rotulo: "Equipe de teste", ativo: true },
    ]);
    const { data: uso } = await admin
      .from("ia_uso")
      .select("custo_microdolar")
      .eq("clinic_id", clinicaA)
      .throwOnError();
    expect(uso).toEqual([{ custo_microdolar: 1 }]);
  });

  it("recepcao e leitura da A (a propria clinica), pendente da A e admin da B nao leem nada", async () => {
    for (const apelido of [
      "recepcao-a",
      "leitura-a",
      "pendente-a",
      "admin-b",
    ] as const) {
      for (const tabela of TABELAS) {
        const { data, error } = await como(apelido).from(tabela).select("*");
        expect(error).toBeNull();
        expect(data, `${apelido} em ${tabela}`).toEqual([]);
      }
    }
    // contraprova: a A tem a linha, o numero e o telefone (o administrador le)
    const { data: doAdmin } = await como("admin-a")
      .from("ia_contato_liberado")
      .select("phone_key");
    expect(doAdmin).toEqual([{ phone_key: TELEFONE_DA_EQUIPE }]);
  });

  it("admin da F: le a propria enquanto ela e de teste; fora da lista (com linha), nada", async () => {
    // contraprova primeiro: de teste, o admin da F le a linha e o telefone
    const { data: deTeste } = await como("admin-f")
      .from("ia_liberacao")
      .select("clinic_id, liberada");
    expect(deTeste).toEqual([{ clinic_id: clinicaF, liberada: false }]);
    await foraDeTeste(async () => {
      for (const tabela of TABELAS) {
        const { data, error } = await como("admin-f").from(tabela).select("*");
        expect(error).toBeNull();
        expect(data, tabela).toEqual([]);
      }
      // a linha e o telefone continuam la (o sistema le)
      const { data: daF } = await admin
        .from("ia_liberacao")
        .select("clinic_id, liberada")
        .eq("clinic_id", clinicaF)
        .throwOnError();
      expect(daF).toEqual([{ clinic_id: clinicaF, liberada: false }]);
      const { data: telefoneDaF } = await admin
        .from("ia_contato_liberado")
        .select("phone_key")
        .eq("clinic_id", clinicaF)
        .throwOnError();
      expect(telefoneDaF).toEqual([{ phone_key: TELEFONE_DA_F }]);
    });
  });

  it("ia_membro_ve_a_liberacao: so administrador ou gestor ativo, so da propria clinica da lista ou de teste", async () => {
    const confere = async (
      casos: readonly (readonly [string, string, boolean])[],
    ) => {
      for (const [apelido, clinica, esperado] of casos) {
        const { data, error } = await como(apelido).rpc(
          "ia_membro_ve_a_liberacao",
          { p_clinic_id: clinica },
        );
        expect(error).toBeNull();
        expect(data, `${apelido} na ${clinica}`).toBe(esperado);
      }
    };
    await confere([
      ["admin-a", clinicaA, true],
      ["gestor-a", clinicaA, true],
      ["recepcao-a", clinicaA, false],
      ["leitura-a", clinicaA, false],
      ["admin-a", clinicaB, false],
      ["pendente-a", clinicaA, false],
      ["admin-b", clinicaA, false],
      ["admin-f", clinicaF, true],
    ]);
    await foraDeTeste(() => confere([["admin-f", clinicaF, false]]));
  });

  it("ia_interruptor_ligado: todo autenticado le so o booleano; anon nao", async () => {
    const { data: linha } = await admin
      .from("ia_interruptor")
      .select("ligado")
      .single()
      .throwOnError();
    for (const apelido of TODAS_AS_SESSOES) {
      const { data, error } = await como(apelido).rpc("ia_interruptor_ligado");
      expect(error).toBeNull();
      expect(data).toBe((linha as { ligado: boolean }).ligado);
    }
    const { error } = await anonClient().rpc("ia_interruptor_ligado");
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });

  it("nenhum papel insere, muda ou apaga (42501); nada muda", async () => {
    const antes = await liberacaoDaA();
    for (const apelido of TODAS_AS_SESSOES) {
      const cliente = como(apelido);
      const tentativas = [
        // interruptor: filtro que nunca casa (id e sempre true)
        cliente
          .from("ia_interruptor")
          .update({ motivo: "forjado" })
          .eq("id", false),
        cliente.from("ia_interruptor").delete().eq("id", false),
        cliente.from("ia_interruptor").insert({ id: false, ligado: false }),
        cliente
          .from("ia_liberacao")
          .insert({ clinic_id: clinicaB, liberada: true, modo: "contatos" }),
        cliente
          .from("ia_liberacao")
          .update({ liberada: false })
          .eq("clinic_id", clinicaA),
        cliente.from("ia_liberacao").delete().eq("clinic_id", clinicaA),
        cliente.from("ia_numero_liberado").insert({
          whatsapp_account_id: numeroB,
          clinic_id: clinicaB,
          ativo: true,
        }),
        cliente
          .from("ia_numero_liberado")
          .update({ ativo: false })
          .eq("clinic_id", clinicaA),
        cliente.from("ia_numero_liberado").delete().eq("clinic_id", clinicaA),
        cliente.from("ia_contato_liberado").insert({
          clinic_id: clinicaA,
          phone_key: TELEFONE_DO_PACIENTE,
          ativo: true,
        }),
        cliente
          .from("ia_contato_liberado")
          .update({ ativo: false })
          .eq("clinic_id", clinicaA),
        cliente.from("ia_contato_liberado").delete().eq("clinic_id", clinicaA),
        cliente.from("ia_uso").insert({
          clinic_id: clinicaA,
          origem: "whatsapp",
          papel: "agente",
          modelo: "claude-opus-5",
          custo_microdolar: 0,
        }),
        cliente
          .from("ia_uso")
          .update({ custo_microdolar: 0 })
          .eq("clinic_id", clinicaA),
        cliente.from("ia_uso").delete().eq("clinic_id", clinicaA),
        cliente.from("llm_preco").insert({
          modelo: "modelo-forjado",
          entrada_microdolar_por_milhao: 0,
          saida_microdolar_por_milhao: 0,
          cache_leitura_microdolar_por_milhao: 0,
          cache_escrita_microdolar_por_milhao: 0,
          vigente_desde: "2026-10-06",
          fonte: "forjado",
        }),
        cliente
          .from("llm_preco")
          .update({ entrada_microdolar_por_milhao: 0 })
          .eq("modelo", "claude-haiku-4-5"),
        cliente.from("llm_preco").delete().eq("modelo", "claude-haiku-4-5"),
      ];
      for (const tentativa of tentativas) {
        const { error } = await tentativa;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    expect(await liberacaoDaA()).toEqual(antes);
    const { data: preco } = await admin
      .from("llm_preco")
      .select("entrada_microdolar_por_milhao")
      .eq("modelo", "claude-haiku-4-5")
      .single()
      .throwOnError();
    expect(preco).toEqual({ entrada_microdolar_por_milhao: 1_000_000 });
  });

  it("todo papel le os precos dos modelos", async () => {
    for (const apelido of TODAS_AS_SESSOES) {
      const { data, error } = await como(apelido)
        .from("llm_preco")
        .select("modelo")
        .order("modelo");
      expect(error).toBeNull();
      expect((data ?? []).map((linha) => linha.modelo)).toEqual(
        expect.arrayContaining([
          "claude-haiku-4-5",
          "claude-opus-5",
          "claude-sonnet-5",
        ]),
      );
    }
  });

  it("anon nao chega em nenhuma tabela nova", async () => {
    const anon = anonClient();
    for (const tabela of [...TABELAS, "llm_preco"]) {
      const { error } = await anon.from(tabela).select("*");
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });
});

describe("RPCs de liberacao: o administrador da propria clinica da lista (ou de teste)", () => {
  it("gestor, recepcao, leitura e pendente da A, admin da B na A, admin da F na F e anon: 42501; nada muda", async () => {
    // a F fora da lista so durante este teste (volta a ser de teste no finally)
    await foraDeTeste(async () => {
      const antes = await liberacaoDaA();
      const naA = (cliente: SupabaseClient) => [
        cliente.rpc("definir_liberacao_da_ia", {
          p_clinic_id: clinicaA,
          p_liberada: false,
          p_motivo: "forjado",
        }),
        cliente.rpc("definir_numero_da_ia", {
          p_clinic_id: clinicaA,
          p_whatsapp_account_id: numeroA,
          p_ativo: false,
        }),
        cliente.rpc("definir_contato_liberado_da_ia", {
          p_clinic_id: clinicaA,
          p_telefone_e164: TELEFONE_DO_PACIENTE,
          p_rotulo: "forjado",
          p_ativo: true,
        }),
      ];
      const chamadas = [
        ...(
          [
            "gestor-a",
            "recepcao-a",
            "leitura-a",
            "pendente-a",
            "admin-b",
          ] as const
        ).flatMap((apelido) => naA(como(apelido))),
        ...naA(anonClient()),
        // o admin da A noutra clinica (a B, de teste): o guarda olha o papel
        // na clinica informada
        como("admin-a").rpc("definir_liberacao_da_ia", {
          p_clinic_id: clinicaB,
          p_liberada: true,
          p_modo: "contatos",
        }),
        // a F tem a linha e nao esta na lista nem e de teste: o admin dela nem
        // desliga (T3a deixaria desligar; o 42501 e do guarda)
        como("admin-f").rpc("definir_liberacao_da_ia", {
          p_clinic_id: clinicaF,
          p_liberada: false,
          p_motivo: "forjado",
        }),
        como("admin-f").rpc("definir_contato_liberado_da_ia", {
          p_clinic_id: clinicaF,
          p_telefone_e164: TELEFONE_DA_F,
          p_rotulo: "forjado",
          p_ativo: true,
        }),
      ];
      for (const chamada of chamadas) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
      expect(await liberacaoDaA()).toEqual(antes);
      const { data: daB } = await admin
        .from("ia_liberacao")
        .select("clinic_id")
        .eq("clinic_id", clinicaB)
        .throwOnError();
      expect(daB).toEqual([]);
      const { data: daF } = await admin
        .from("ia_contato_liberado")
        .select("ativo, rotulo")
        .eq("clinic_id", clinicaF)
        .throwOnError();
      expect(daF).toEqual([{ ativo: false, rotulo: "Equipe da F" }]);
      // contraprova: o sistema desliga a mesma linha da F sem erro (T3a deixa
      // desligar), entao o 42501 do admin da F veio do guarda
      const { data, error } = await admin.rpc("definir_liberacao_da_ia", {
        p_clinic_id: clinicaF,
        p_liberada: false,
        p_motivo: "contraprova",
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });

  it("ninguem da clinica mexe no interruptor geral, nem o administrador (42501)", async () => {
    for (const cliente of [
      ...TODAS_AS_SESSOES.map((apelido) => como(apelido)),
      anonClient(),
    ]) {
      // p_ligado nulo: o interruptor global nunca e tocado pelo teste
      const { error } = await cliente.rpc("definir_interruptor_da_ia", {
        p_ligado: null,
        p_motivo: "forjado",
      });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });

  it("o administrador da A escreve nas tres RPCs da A, com a trilha no nome dele", async () => {
    const adminA = como("admin-a");
    const ok = async (
      nome: string,
      args: Record<string, unknown>,
      esperado: boolean,
    ) => {
      const { data, error } = await adminA.rpc(nome, args);
      expect(error, nome).toBeNull();
      expect(data).toBe(esperado);
    };
    const antes = await liberacaoDaA();

    // modo: simulador e de volta para contatos
    await ok(
      "definir_liberacao_da_ia",
      { p_clinic_id: clinicaA, p_liberada: true, p_modo: "simulador" },
      true,
    );
    const { data: noSimulador } = await admin
      .from("ia_liberacao")
      .select("modo, alterado_por")
      .eq("clinic_id", clinicaA)
      .single()
      .throwOnError();
    expect(noSimulador).toEqual({
      modo: "simulador",
      alterado_por: ids.get("admin-a"),
    });
    await ok(
      "definir_liberacao_da_ia",
      {
        p_clinic_id: clinicaA,
        p_liberada: true,
        p_modo: "contatos",
        p_motivo: "teste de RLS",
      },
      true,
    );

    // numero, um por vez: ligar o segundo desliga o da A na mesma chamada;
    // religar o da A desliga o segundo; desligar nao mexe nos outros
    await ok(
      "definir_numero_da_ia",
      {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: segundoNumeroA,
        p_ativo: true,
      },
      true,
    );
    expect(await numerosDaA()).toEqual({
      [numeroA]: false,
      [segundoNumeroA]: true,
    });
    await ok(
      "definir_numero_da_ia",
      { p_clinic_id: clinicaA, p_whatsapp_account_id: numeroA, p_ativo: true },
      true,
    );
    expect(await numerosDaA()).toEqual({
      [numeroA]: true,
      [segundoNumeroA]: false,
    });
    await ok(
      "definir_numero_da_ia",
      {
        p_clinic_id: clinicaA,
        p_whatsapp_account_id: segundoNumeroA,
        p_ativo: false,
      },
      false,
    );
    expect(await numerosDaA()).toEqual({
      [numeroA]: true,
      [segundoNumeroA]: false,
    });
    // o numero da B pela A: o gatilho recusa (numero de outra clinica) e
    // nada muda, nem o desligar do numero da A que vinha antes na chamada
    const { error: numeroDaB } = await adminA.rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaA,
      p_whatsapp_account_id: numeroB,
      p_ativo: true,
    });
    expect(numeroDaB?.code).toBe("23503");
    expect(await numerosDaA()).toEqual({
      [numeroA]: true,
      [segundoNumeroA]: false,
    });

    // telefone novo sem o nono digito: gravado pela chave canonica; e
    // desligado em seguida (fica na lista, nao conversa)
    await ok(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_ADMIN_SEM_NONO,
        p_rotulo: "Admin pela tela",
        p_ativo: true,
      },
      true,
    );
    await ok(
      "definir_contato_liberado_da_ia",
      {
        p_clinic_id: clinicaA,
        p_telefone_e164: TELEFONE_DO_ADMIN,
        p_rotulo: "",
        p_ativo: false,
      },
      false,
    );

    const depois = await liberacaoDaA();
    expect(depois.liberacao).toEqual(antes.liberacao);
    expect(depois.numeros).toEqual(
      expect.arrayContaining([
        ...(antes.numeros ?? []),
        { whatsapp_account_id: segundoNumeroA, ativo: false },
      ]),
    );
    expect(depois.numeros).toHaveLength((antes.numeros ?? []).length + 1);
    expect(depois.contatos).toEqual(
      expect.arrayContaining([
        ...(antes.contatos ?? []),
        {
          phone_key: TELEFONE_DO_ADMIN,
          rotulo: "Admin pela tela",
          ativo: false,
        },
      ]),
    );
    expect(depois.contatos).toHaveLength((antes.contatos ?? []).length + 1);

    const { data: trilha } = await admin
      .from("audit_log")
      .select("entity, action, entity_id")
      .eq("clinic_id", clinicaA)
      .eq("user_id", ids.get("admin-a")!)
      .in("entity", [
        "ia_liberacao",
        "ia_numero_liberado",
        "ia_contato_liberado",
      ])
      .throwOnError();
    const linhas = trilha as {
      entity: string;
      action: string;
      entity_id: string | null;
    }[];
    expect(linhas.filter((l) => l.entity === "ia_liberacao")).toHaveLength(2);
    // numeros: ligar o segundo (ele e o da A, desligado junto), religar o da
    // A (ele e o segundo, desligado junto) e desligar o segundo; o 23503 nao
    // deixou trilha
    const doNumero = linhas.filter((l) => l.entity === "ia_numero_liberado");
    expect(doNumero.filter((l) => l.entity_id === numeroA)).toHaveLength(2);
    expect(doNumero.filter((l) => l.entity_id === segundoNumeroA)).toHaveLength(
      3,
    );
    expect(doNumero).toHaveLength(5);
    expect(
      linhas.filter((l) => l.entity === "ia_contato_liberado"),
    ).toHaveLength(2);
    expect(linhas.every((l) => l.action === "editou")).toBe(true);
  });

  it("o administrador da B (de teste) escreve e le so a propria; nao chega na A", async () => {
    const adminB = como("admin-b");
    const { data, error } = await adminB.rpc("definir_liberacao_da_ia", {
      p_clinic_id: clinicaB,
      p_liberada: false,
      p_motivo: "teste de RLS",
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
    const { data: visiveis } = await adminB
      .from("ia_liberacao")
      .select("clinic_id, liberada");
    expect(visiveis).toEqual([{ clinic_id: clinicaB, liberada: false }]);
    const { error: naA } = await adminB.rpc("definir_numero_da_ia", {
      p_clinic_id: clinicaA,
      p_whatsapp_account_id: numeroA,
      p_ativo: false,
    });
    expect(naA?.code).toBe(PERMISSAO_NEGADA);
  });

  it("as funcoes de decisao nao sao da sessao (42501)", async () => {
    for (const cliente of [
      como("admin-a"),
      como("recepcao-a"),
      como("admin-b"),
      anonClient(),
    ]) {
      const chamadas = [
        cliente.rpc("ia_pode_atender", {
          p_clinic_id: clinicaA,
          p_whatsapp_account_id: numeroA,
          p_phone_key: TELEFONE_DA_EQUIPE,
        }),
        cliente.rpc("ia_pode_simular", { p_clinic_id: clinicaA }),
        cliente.rpc("ia_clinicas_da_fase_controlada"),
        cliente.rpc("ia_desligar", { p_clinic_ids: [clinicaA] }),
      ];
      for (const chamada of chamadas) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    // contraprova: o sistema pergunta e a resposta e sim
    const { data, error } = await admin.rpc("ia_pode_atender", {
      p_clinic_id: clinicaA,
      p_whatsapp_account_id: numeroA,
      p_phone_key: TELEFONE_DA_EQUIPE,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("ia_clinica_liberada: so membro ativo da clinica liberada ouve sim", async () => {
    for (const apelido of MEMBROS_ATIVOS_DA_A) {
      const { data, error } = await como(apelido).rpc("ia_clinica_liberada", {
        p_clinic_id: clinicaA,
      });
      expect(error).toBeNull();
      expect(data).toBe(true);
    }
    for (const [apelido, clinica] of [
      ["pendente-a", clinicaA],
      ["admin-b", clinicaA],
      ["admin-b", clinicaB],
      ["admin-a", clinicaB],
    ] as const) {
      const { data, error } = await como(apelido).rpc("ia_clinica_liberada", {
        p_clinic_id: clinica,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    }
    const { error } = await anonClient().rpc("ia_clinica_liberada", {
      p_clinic_id: clinicaA,
    });
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });
});

describe("conversation: a sessao so entra em 'ia_atendendo' com a IA liberada", () => {
  it("clinica liberada, telefone nao liberado: UPDATE e INSERT da sessao dao 42501", async () => {
    for (const apelido of ["admin-a", "gestor-a", "recepcao-a"] as const) {
      const cliente = como(apelido);
      const { error: naUpdate } = await cliente
        .from("conversation")
        .update({ status: "ia_atendendo" })
        .eq("id", conversaDoPaciente);
      expect(naUpdate?.code).toBe(PERMISSAO_NEGADA);
      const { error: noInsert } = await cliente.from("conversation").insert({
        clinic_id: clinicaA,
        contact_id: contatoSemConversa,
        whatsapp_account_id: numeroA,
        status: "ia_atendendo",
      });
      expect(noInsert?.code).toBe(PERMISSAO_NEGADA);
    }
    expect(await statusDa(conversaDoPaciente)).toBe("aguardando_humano");
    const { data: criadas } = await admin
      .from("conversation")
      .select("id")
      .eq("contact_id", contatoSemConversa)
      .throwOnError();
    expect(criadas).toEqual([]);
  });

  it("clinica sem liberacao: o admin dela tambem recebe 42501", async () => {
    const { error } = await como("admin-b")
      .from("conversation")
      .update({ status: "ia_atendendo" })
      .eq("id", conversaDaB);
    expect(error?.code).toBe(PERMISSAO_NEGADA);
    expect(await statusDa(conversaDaB)).toBe("aguardando_humano");
    // contraprova: o mesmo admin muda o status para outro valor
    const { error: outro } = await como("admin-b")
      .from("conversation")
      .update({
        status: "em_atendimento",
        assignee_user_id: ids.get("admin-b"),
      })
      .eq("id", conversaDaB);
    expect(outro).toBeNull();
    expect(await statusDa(conversaDaB)).toBe("em_atendimento");
  });

  it("contraprova: telefone liberado no numero liberado, a recepcao devolve para a IA", async () => {
    const { error } = await como("recepcao-a")
      .from("conversation")
      .update({ status: "ia_atendendo", assignee_user_id: null })
      .eq("id", conversaDaEquipe);
    expect(error).toBeNull();
    expect(await statusDa(conversaDaEquipe)).toBe("ia_atendendo");
  });

  it("conversa ja na IA: a sessao nao troca o contato para um telefone fora da lista (42501)", async () => {
    expect(await statusDa(conversaDaEquipe)).toBe("ia_atendendo");
    for (const apelido of ["admin-a", "gestor-a", "recepcao-a"] as const) {
      const cliente = como(apelido);
      const { error: soContato } = await cliente
        .from("conversation")
        .update({ contact_id: contatoDoPaciente })
        .eq("id", conversaDaEquipe);
      expect(soContato?.code).toBe(PERMISSAO_NEGADA);
      const { error: comStatus } = await cliente
        .from("conversation")
        .update({ status: "ia_atendendo", contact_id: contatoSemConversa })
        .eq("id", conversaDaEquipe);
      expect(comStatus?.code).toBe(PERMISSAO_NEGADA);
    }
    const { data } = await admin
      .from("conversation")
      .select("contact_id, status")
      .eq("id", conversaDaEquipe)
      .single()
      .throwOnError();
    expect(data).toEqual({
      contact_id: contatoDaEquipe,
      status: "ia_atendendo",
    });
    // contraprova: o mesmo contato no pedido passa (a trava e a troca)
    const { error } = await como("recepcao-a")
      .from("conversation")
      .update({ contact_id: contatoDaEquipe })
      .eq("id", conversaDaEquipe);
    expect(error).toBeNull();
  });

  it("contraprova: a service role passa sem liberacao (o gatilho barra so sessao)", async () => {
    // Clinica liberada com o telefone fora da lista (UPDATE e INSERT) e
    // clinica sem liberacao nenhuma: a sessao recebeu 42501 nos mesmos casos.
    const { error: naA } = await admin
      .from("conversation")
      .update({ status: "ia_atendendo" })
      .eq("id", conversaDoPaciente);
    expect(naA).toBeNull();
    expect(await statusDa(conversaDoPaciente)).toBe("ia_atendendo");
    const { data: criada, error: noInsert } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinicaA,
        contact_id: contatoSemConversa,
        whatsapp_account_id: numeroA,
        status: "ia_atendendo",
      })
      .select("id")
      .single();
    expect(noInsert).toBeNull();
    const { error: naB } = await admin
      .from("conversation")
      .update({ status: "ia_atendendo" })
      .eq("id", conversaDaB);
    expect(naB).toBeNull();
    expect(await statusDa(conversaDaB)).toBe("ia_atendendo");

    // devolve para a equipe: nada fica em 'ia_atendendo' sem liberacao
    await admin
      .from("conversation")
      .update({ status: "aguardando_humano", assignee_user_id: null })
      .in("id", [
        conversaDoPaciente,
        conversaDaB,
        (criada as { id: string }).id,
      ])
      .throwOnError();
  });
});

describe("clinic.e_de_teste: so a equipe do Conduzza muda", () => {
  it("o admin da clinica recebe 42501; o nome continua editavel", async () => {
    for (const [apelido, clinica] of [
      ["admin-a", clinicaA],
      ["admin-b", clinicaB],
    ] as const) {
      const cliente = como(apelido);
      const { error } = await cliente
        .from("clinic")
        .update({ e_de_teste: false })
        .eq("id", clinica);
      expect(error?.code).toBe(PERMISSAO_NEGADA);
      const { error: comNome } = await cliente
        .from("clinic")
        .update({ name: `Renomeada ${sufixo}`, e_de_teste: false })
        .eq("id", clinica);
      expect(comNome?.code).toBe(PERMISSAO_NEGADA);
      // contraprova: o nome sozinho passa
      const { error: soNome } = await cliente
        .from("clinic")
        .update({ name: `IA liberacao renomeada ${apelido} ${sufixo}` })
        .eq("id", clinica);
      expect(soNome).toBeNull();
    }
    const { data } = await admin
      .from("clinic")
      .select("e_de_teste")
      .in("id", [clinicaA, clinicaB])
      .throwOnError();
    expect(data).toEqual([{ e_de_teste: true }, { e_de_teste: true }]);
  });
});

describe("ai_agent_config: versoes do agente", () => {
  let versaoDoAdmin = "";

  it("admin e gestor criam rascunho; membro ativo le; a B e o pendente nao", async () => {
    const { data: doAdmin, error } = await como("admin-a")
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaA, version: 1, greeting: "Olá!" })
      .select("id, status, published_at, published_by")
      .single();
    expect(error).toBeNull();
    expect(doAdmin).toMatchObject({
      status: "rascunho",
      published_at: null,
      published_by: null,
    });
    versaoDoAdmin = (doAdmin as { id: string }).id;
    const { error: doGestor } = await como("gestor-a")
      .from("ai_agent_config")
      .insert({ clinic_id: clinicaA, version: 2, tone: "formal" });
    expect(doGestor).toBeNull();

    for (const apelido of MEMBROS_ATIVOS_DA_A) {
      const { data, error: erro } = await como(apelido)
        .from("ai_agent_config")
        .select("version")
        .order("version");
      expect(erro).toBeNull();
      expect(data).toEqual([{ version: 1 }, { version: 2 }]);
    }
    for (const apelido of ["pendente-a", "admin-b"] as const) {
      const { data } = await como(apelido)
        .from("ai_agent_config")
        .select("version")
        .eq("clinic_id", clinicaA);
      expect(data).toEqual([]);
    }
  });

  it("recepcao, leitura, pendente e a B nao criam, nao editam e nao apagam", async () => {
    for (const apelido of SEM_ESCRITA_NO_AGENTE) {
      const cliente = como(apelido);
      const { error } = await cliente
        .from("ai_agent_config")
        .insert({ clinic_id: clinicaA, version: 9 });
      expect(error?.code).toBe(PERMISSAO_NEGADA);
      const { data: editadas } = await cliente
        .from("ai_agent_config")
        .update({ greeting: "Forjado" })
        .eq("clinic_id", clinicaA)
        .select("id");
      expect(editadas ?? []).toEqual([]);
      const { data: apagadas } = await cliente
        .from("ai_agent_config")
        .delete()
        .eq("clinic_id", clinicaA)
        .select("id");
      expect(apagadas ?? []).toEqual([]);
    }
    const { data } = await admin
      .from("ai_agent_config")
      .select("version, greeting")
      .eq("clinic_id", clinicaA)
      .order("version")
      .throwOnError();
    expect(data).toEqual([
      { version: 1, greeting: "Olá!" },
      { version: 2, greeting: null },
    ]);
  });

  it("a sessao nao publica nem carimba (42501)", async () => {
    const adminA = como("admin-a");
    const tentativas = [
      adminA
        .from("ai_agent_config")
        .update({ status: "publicada" })
        .eq("id", versaoDoAdmin),
      adminA.from("ai_agent_config").insert({
        clinic_id: clinicaA,
        version: 3,
        status: "publicada",
      }),
      adminA
        .from("ai_agent_config")
        .update({ published_by: ids.get("admin-a") })
        .eq("id", versaoDoAdmin),
    ];
    for (const tentativa of tentativas) {
      const { error } = await tentativa;
      expect(error?.code).toBe(PERMISSAO_NEGADA);
    }
  });

  it("publicada pelo sistema: carimbada, imutavel e fora do alcance da sessao", async () => {
    const { data: publicada, error } = await admin
      .from("ai_agent_config")
      .update({ status: "publicada" })
      .eq("id", versaoDoAdmin)
      .select("status, published_at")
      .single();
    expect(error).toBeNull();
    expect(
      (publicada as { published_at: string | null }).published_at,
    ).not.toBe(null);

    const adminA = como("admin-a");
    const { data: editadas } = await adminA
      .from("ai_agent_config")
      .update({ greeting: "Mudou" })
      .eq("id", versaoDoAdmin)
      .select("id");
    expect(editadas).toEqual([]);
    const { data: apagadas } = await adminA
      .from("ai_agent_config")
      .delete()
      .eq("id", versaoDoAdmin)
      .select("id");
    expect(apagadas).toEqual([]);

    // nem o sistema muda a publicada
    const { error: peloSistema } = await admin
      .from("ai_agent_config")
      .update({ greeting: "Mudou" })
      .eq("id", versaoDoAdmin);
    expect(peloSistema?.code).toBe(REGRA_DO_BANCO);

    // contraprova: o rascunho (versao 2) continua editavel pela gestao
    const { data: rascunho, error: erroRascunho } = await como("gestor-a")
      .from("ai_agent_config")
      .update({ greeting: "Bom dia!" })
      .eq("clinic_id", clinicaA)
      .eq("version", 2)
      .select("greeting");
    expect(erroRascunho).toBeNull();
    expect(rascunho).toEqual([{ greeting: "Bom dia!" }]);
  });
});

describe("knowledge_item: base de conhecimento", () => {
  it("gestor escreve com autoria do banco; membro le; os demais nao escrevem; a B nao le", async () => {
    const { data: criado, error } = await como("gestor-a")
      .from("knowledge_item")
      .insert({
        clinic_id: clinicaA,
        question: "Tem estacionamento?",
        answer: "Sim, gratuito.",
      })
      .select("id, created_by, source")
      .single();
    expect(error).toBeNull();
    expect(criado).toMatchObject({
      created_by: ids.get("gestor-a"),
      source: "manual",
    });
    const itemId = (criado as { id: string }).id;

    const { error: forjado } = await como("admin-a")
      .from("knowledge_item")
      .insert({
        clinic_id: clinicaA,
        question: "Pergunta",
        answer: "Resposta",
        created_by: ids.get("recepcao-a"),
      });
    expect(forjado?.code).toBe(PERMISSAO_NEGADA);

    for (const apelido of MEMBROS_ATIVOS_DA_A) {
      const { data } = await como(apelido)
        .from("knowledge_item")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(data).toEqual([{ id: itemId }]);
    }
    for (const apelido of SEM_ESCRITA_NO_AGENTE) {
      const cliente = como(apelido);
      const { error: aoCriar } = await cliente.from("knowledge_item").insert({
        clinic_id: clinicaA,
        question: "Forjada",
        answer: "Forjada",
      });
      expect(aoCriar?.code).toBe(PERMISSAO_NEGADA);
      const { data: editados } = await cliente
        .from("knowledge_item")
        .update({ answer: "Forjada" })
        .eq("id", itemId)
        .select("id");
      expect(editados ?? []).toEqual([]);
    }
    for (const apelido of ["pendente-a", "admin-b"] as const) {
      const { data } = await como(apelido)
        .from("knowledge_item")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(data).toEqual([]);
    }
    const { data: final } = await admin
      .from("knowledge_item")
      .select("answer")
      .eq("id", itemId)
      .single()
      .throwOnError();
    expect(final).toEqual({ answer: "Sim, gratuito." });
  });
});
