import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Agente de IA, E0: travas de liberacao e schema (migration 20261006100000),
// pela API com JWT real de cada papel. O que esta em jogo:
//   - ia_interruptor, ia_liberacao, ia_numero_liberado, ia_contato_liberado
//     e ia_uso: nenhuma sessao da clinica le (so o super admin) nem escreve
//     (42501), e anon nem chega (42501). llm_preco: todo autenticado le,
//     ninguem escreve;
//   - definir_*_da_ia: 42501 para qualquer sessao que nao e super admin
//     (inclusive o admin da propria clinica) e para anon; ia_pode_atender,
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
// afterAll. O interruptor global NUNCA e tocado: as tentativas contra ele
// usam filtro que nao casa com linha nenhuma (id = false) ou p_ligado nulo
// (um guarda com defeito pararia no 22004, antes de gravar). Nada aqui usa a
// id da salud-care.

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

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
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
const TODAS_AS_SESSOES = [
  ...MEMBROS_ATIVOS_DA_A,
  "pendente-a",
  "admin-b",
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
  numeroA = (await criarNumeroDeTeste(admin, clinicaA, { nome: "Recepção" }))
    .id;
  numeroB = (await criarNumeroDeTeste(admin, clinicaB, { nome: "Recepção" }))
    .id;

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("pendente-a", clinicaA, "gestor", "pendente");
  await criarPessoa("admin-b", clinicaB, "admin");

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
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
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

describe("tabelas da liberacao: so o super admin le, nenhuma sessao escreve", () => {
  const TABELAS = [
    "ia_interruptor",
    "ia_liberacao",
    "ia_numero_liberado",
    "ia_contato_liberado",
    "ia_uso",
  ] as const;

  it("nenhum papel da clinica le as travas nem o gasto (nem da propria clinica)", async () => {
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
    for (const apelido of TODAS_AS_SESSOES) {
      for (const tabela of TABELAS) {
        const { data, error } = await como(apelido).from(tabela).select("*");
        expect(error).toBeNull();
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

describe("RPCs de liberacao: so o super admin", () => {
  it("definir_*_da_ia dao 42501 para todo papel da clinica e para anon; nada muda", async () => {
    const antes = await liberacaoDaA();
    const sessoes = [
      ...TODAS_AS_SESSOES.map((apelido) => como(apelido)),
      anonClient(),
    ];
    for (const cliente of sessoes) {
      const chamadas = [
        cliente.rpc("definir_liberacao_da_ia", {
          p_clinic_id: clinicaA,
          p_liberada: false,
          p_motivo: "forjado",
        }),
        cliente.rpc("definir_liberacao_da_ia", {
          p_clinic_id: clinicaB,
          p_liberada: true,
          p_modo: "contatos",
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
        // p_ligado nulo: o interruptor global nunca e tocado pelo teste
        cliente.rpc("definir_interruptor_da_ia", {
          p_ligado: null,
          p_motivo: "forjado",
        }),
      ];
      for (const chamada of chamadas) {
        const { error } = await chamada;
        expect(error?.code).toBe(PERMISSAO_NEGADA);
      }
    }
    expect(await liberacaoDaA()).toEqual(antes);
    const { data: daB } = await admin
      .from("ia_liberacao")
      .select("clinic_id")
      .eq("clinic_id", clinicaB)
      .throwOnError();
    expect(daB).toEqual([]);
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
