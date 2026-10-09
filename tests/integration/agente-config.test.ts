import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, anonClient } from "../rls/stack";

// Tela 6 (Agente de IA): o ciclo rascunho, publicacao e restauracao
// (migration 20261006150000) contra o banco REAL, com o cliente de servico
// (o que a Server Action usa para publicar) e a sessao do administrador onde
// o autor importa:
// - garantir_rascunho_do_agente: cria o rascunho com os padroes e version
//   calculada no banco; chamado de novo, devolve o mesmo; trilha sem texto;
// - limites por CHECK (nome 40, saudacao e encerramento 300, instrucoes
//   2.000, pergunta 200, resposta 600) e o 22023 de definir instrucoes;
// - publicar_agente: congela em conhecimento os itens ATIVOS na ordem de
//   criacao (a inativa fica fora), carimba data e autor (o autor passado
//   pela Server Action, conferido: recepcao da 42501), devolve {versao};
//   recusa com CZ409 (sem publicar nada) quando o rascunho ou a base
//   mudaram depois do carimbo que a action conferiu (p_conferido_em);
//   editar a base depois nao muda a publicada; sem rascunho, P0002;
// - o rascunho seguinte copia a publicada (com as instrucoes, sem a base);
//   a versao escolhida por fora (pelo sistema) e renumerada ao publicar;
// - restaurar_versao_do_agente: o rascunho volta aos campos da versao e as
//   perguntas ativas voltam a ser as da base congelada dela (mesmas ids); o
//   que esta fora dela fica DESATIVADO, nunca apagado;
// - teto de 60 perguntas ativas ao publicar (22023);
// - gasto reservado: duas reservas simultaneas que juntas passam do teto,
//   so uma passa; acertar troca a reserva pelas linhas reais.
// Quem pode ou nao chamar cada RPC esta em tests/rls/agente-config.test.ts.
//
// CUIDADO, o banco e o da producao. Clinica e_de_teste (o motor de producao
// ignora; a fase controlada aceita clinica de teste), apagada no afterAll
// junto com a trilha, a liberacao e o gasto dela; depois saem os usuarios
// sinteticos. A liberacao da clinica de teste (modo simulador, sem numero
// nem contato) so existe para o teto do gasto reservado: nada chama o
// modelo. Nada usa a id da teste123, da Conduzza Teste nem da salud-care.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const SENHA = "AgenteConfig!Int2026";

let clinica = "";
let sessaoDoAdmin: SupabaseClient;
const ids = new Map<string, string>();

type Versao = {
  id: string;
  version: number;
  status: string;
  agent_name: string;
  tone: string;
  use_emoji: boolean;
  greeting: string | null;
  closing: string | null;
  skills: Record<string, boolean>;
  instrucoes: string | null;
  conhecimento: { id: string; pergunta: string; resposta: string }[];
  published_at: string | null;
  published_by: string | null;
};

const COLUNAS =
  "id, version, status, agent_name, tone, use_emoji, greeting, closing, skills, instrucoes, conhecimento, published_at, published_by";

async function rpc(
  nome: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; codigo: string | null }> {
  const { data, error } = await admin.rpc(nome, args);
  return { data, codigo: error ? (error.code ?? "sem_codigo") : null };
}

async function rpcOk(nome: string, args: Record<string, unknown>) {
  const { data, codigo } = await rpc(nome, args);
  expect(codigo).toBeNull();
  return data;
}

async function versao(numero: number): Promise<Versao> {
  const { data } = await admin
    .from("ai_agent_config")
    .select(COLUNAS)
    .eq("clinic_id", clinica)
    .eq("version", numero)
    .single()
    .throwOnError();
  return data as unknown as Versao;
}

async function rascunho(): Promise<Versao> {
  const { data } = await admin
    .from("ai_agent_config")
    .select(COLUNAS)
    .eq("clinic_id", clinica)
    .eq("status", "rascunho")
    .single()
    .throwOnError();
  return data as unknown as Versao;
}

/** Cria um item pelo sistema, um por vez (created_at em ordem). */
async function item(
  pergunta: string,
  resposta: string,
  ativo = true,
): Promise<string> {
  const { data } = await admin
    .from("knowledge_item")
    .insert({
      clinic_id: clinica,
      question: pergunta,
      answer: resposta,
      active: ativo,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/**
 * O carimbo que a Server Action manda a publicar_agente: o maior updated_at
 * entre o rascunho e todos os itens da base (ativos e inativos), cortado em
 * milissegundos pelo Date, como a action faz.
 */
async function conferidoEm(): Promise<string> {
  const [config, base] = await Promise.all([
    admin
      .from("ai_agent_config")
      .select("updated_at")
      .eq("clinic_id", clinica)
      .eq("status", "rascunho")
      .throwOnError(),
    admin
      .from("knowledge_item")
      .select("updated_at")
      .eq("clinic_id", clinica)
      .throwOnError(),
  ]);
  const carimbos = [...(config.data ?? []), ...(base.data ?? [])].map((linha) =>
    Date.parse((linha as { updated_at: string }).updated_at),
  );
  return new Date(Math.max(...carimbos)).toISOString();
}

async function publicar(autor: string | undefined) {
  return rpc("publicar_agente", {
    p_clinic_id: clinica,
    p_autor: autor ?? null,
    p_conferido_em: await conferidoEm(),
  });
}

const esperar = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function baseViva() {
  const { data } = await admin
    .from("knowledge_item")
    .select("id, question, answer, active")
    .eq("clinic_id", clinica)
    .order("id")
    .throwOnError();
  return data as {
    id: string;
    question: string;
    answer: string;
    active: boolean;
  }[];
}

async function trilha(acao: string) {
  const { data } = await admin
    .from("audit_log")
    .select("user_id, entity, entity_id")
    .eq("clinic_id", clinica)
    .eq("action", acao)
    .order("id")
    .throwOnError();
  return data as {
    user_id: string | null;
    entity: string;
    entity_id: string | null;
  }[];
}

async function criarPessoa(apelido: string, role: string): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `agente-config-int-${apelido}-${sufixo}@teste.dev`,
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
    .insert({
      clinic_id: clinica,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
}

beforeAll(async () => {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `Agente config ${sufixo}`,
      slug: `agente-config-int-${sufixo}`,
      e_de_teste: true,
      timezone: "America/Fortaleza",
    })
    .select("id")
    .single()
    .throwOnError();
  clinica = (data as { id: string }).id;
  await criarPessoa("admin", "admin");
  await criarPessoa("recepcao", "recepcao");
  sessaoDoAdmin = anonClient();
  const { error } = await sessaoDoAdmin.auth.signInWithPassword({
    email: `agente-config-int-admin-${sufixo}@teste.dev`,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login admin: ${error.message}`);
  }
});

afterAll(async () => {
  // A clinica leva a configuracao, a base, os vinculos e a trilha (cascade);
  // so depois os usuarios saem (audit_log.user_id nao tem acao na FK).
  if (clinica) {
    await admin.from("clinic").delete().eq("id", clinica);
  }
  for (const id of ids.values()) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("ciclo do agente: rascunho, publicacao e restauracao", () => {
  let itemEstacionamento = "";
  let itemCartao = "";
  let itemInativo = "";
  let itemNovo = "";

  it("garantir: cria o rascunho com os padroes e a versao do banco; de novo, o mesmo; trilha sem texto", async () => {
    const { data: criado, error } = await sessaoDoAdmin.rpc(
      "garantir_rascunho_do_agente",
      { p_clinic_id: clinica },
    );
    expect(error).toBeNull();
    const deNovo = await rpcOk("garantir_rascunho_do_agente", {
      p_clinic_id: clinica,
    });
    expect(deNovo).toBe(criado);

    expect(await rascunho()).toMatchObject({
      id: criado,
      version: 1,
      status: "rascunho",
      agent_name: "Assistente",
      tone: "cordial",
      use_emoji: false,
      instrucoes: null,
      conhecimento: [],
      published_at: null,
      published_by: null,
    });
    expect(await trilha("criou_rascunho_do_agente")).toEqual([
      {
        user_id: ids.get("admin"),
        entity: "ai_agent_config",
        entity_id: criado,
      },
    ]);
  });

  it("limites por CHECK e o 22023 das instrucoes; no limite passa", async () => {
    const { id } = await rascunho();
    for (const [coluna, valor] of [
      ["agent_name", "a".repeat(41)],
      ["greeting", "a".repeat(301)],
      ["closing", "a".repeat(301)],
      ["instrucoes", "a".repeat(2001)],
    ] as const) {
      const { error } = await admin
        .from("ai_agent_config")
        .update({ [coluna]: valor })
        .eq("id", id);
      expect(error?.code, coluna).toBe("23514");
    }
    for (const [pergunta, resposta] of [
      ["p".repeat(201), "Resposta"],
      ["Pergunta", "r".repeat(601)],
    ] as const) {
      const { error } = await admin.from("knowledge_item").insert({
        clinic_id: clinica,
        question: pergunta,
        answer: resposta,
      });
      expect(error?.code).toBe("23514");
    }
    const { codigo } = await rpc("definir_instrucoes_do_agente", {
      p_clinic_id: clinica,
      p_instrucoes: "x".repeat(2001),
    });
    expect(codigo).toBe("22023");

    await admin
      .from("ai_agent_config")
      .update({
        agent_name: "a".repeat(40),
        greeting: "Olá!",
        closing: "c".repeat(300),
        tone: "formal",
        use_emoji: true,
        skills: { informar_preco_e_convenio: true },
      })
      .eq("id", id)
      .throwOnError();
    await rpcOk("definir_instrucoes_do_agente", {
      p_clinic_id: clinica,
      p_instrucoes: "x".repeat(2000),
    });
    // vazio vira nulo; com espacos, o texto sem eles
    await rpcOk("definir_instrucoes_do_agente", {
      p_clinic_id: clinica,
      p_instrucoes: "   ",
    });
    expect((await rascunho()).instrucoes).toBeNull();
    await rpcOk("definir_instrucoes_do_agente", {
      p_clinic_id: clinica,
      p_instrucoes: "  Fale do estacionamento.  ",
    });
    expect(await rpcOk("instrucoes_do_agente", { p_clinic_id: clinica })).toBe(
      "Fale do estacionamento.",
    );
    expect(await trilha("editou_instrucoes_do_agente")).toHaveLength(3);
  });

  it("publicar: congela os ativos na ordem, carimba data e autor, devolve a versao", async () => {
    itemEstacionamento = await item("Tem estacionamento?", "Sim, gratuito.");
    itemInativo = await item("Inativa", "Fora da base.", false);
    itemCartao = await item("Aceita cartão?", "Sim.");

    const { codigo: semPapel } = await publicar(ids.get("recepcao"));
    expect(semPapel).toBe("42501");
    const { codigo: semAutor } = await publicar(undefined);
    expect(semAutor).toBe("22004");
    const { codigo: semCarimbo } = await rpc("publicar_agente", {
      p_clinic_id: clinica,
      p_autor: ids.get("admin"),
      p_conferido_em: null,
    });
    expect(semCarimbo).toBe("22004");
    expect((await rascunho()).status).toBe("rascunho");

    // A action conferiu; depois, uma escrita direta pela API (outra aba ou
    // script) mexe na base e no rascunho: CZ409, nada publicado.
    const conferido = await conferidoEm();
    await esperar(5);
    await sessaoDoAdmin
      .from("knowledge_item")
      .update({ answer: "Sim, gratuito." })
      .eq("id", itemEstacionamento)
      .throwOnError();
    const { codigo: mudouABase } = await rpc("publicar_agente", {
      p_clinic_id: clinica,
      p_autor: ids.get("admin"),
      p_conferido_em: conferido,
    });
    expect(mudouABase).toBe("CZ409");
    const conferidoDeNovo = await conferidoEm();
    await esperar(5);
    await sessaoDoAdmin
      .from("ai_agent_config")
      .update({ greeting: "Olá!" })
      .eq("status", "rascunho")
      .eq("clinic_id", clinica)
      .throwOnError();
    const { codigo: mudouORascunho } = await rpc("publicar_agente", {
      p_clinic_id: clinica,
      p_autor: ids.get("admin"),
      p_conferido_em: conferidoDeNovo,
    });
    expect(mudouORascunho).toBe("CZ409");
    expect((await rascunho()).status).toBe("rascunho");
    expect(await trilha("publicou_agente")).toEqual([]);

    // conferido de novo (o carimbo de agora), publica
    const antes = Date.now();
    const { data: publicou, codigo } = await publicar(ids.get("admin"));
    expect(codigo).toBeNull();
    expect(publicou).toEqual({ versao: 1 });

    const publicada = await versao(1);
    expect(publicada).toMatchObject({
      status: "publicada",
      published_by: ids.get("admin"),
      instrucoes: "Fale do estacionamento.",
      greeting: "Olá!",
      tone: "formal",
      conhecimento: [
        {
          id: itemEstacionamento,
          pergunta: "Tem estacionamento?",
          resposta: "Sim, gratuito.",
        },
        { id: itemCartao, pergunta: "Aceita cartão?", resposta: "Sim." },
      ],
    });
    expect(
      new Date(publicada.published_at ?? 0).getTime(),
    ).toBeGreaterThanOrEqual(antes - 60_000);
    expect(JSON.stringify(publicada.conhecimento)).not.toContain(itemInativo);
    expect(await trilha("publicou_agente")).toEqual([
      {
        user_id: ids.get("admin"),
        entity: "ai_agent_config",
        entity_id: publicada.id,
      },
    ]);

    // sem rascunho, nada a publicar
    const { codigo: semRascunho } = await rpc("publicar_agente", {
      p_clinic_id: clinica,
      p_autor: ids.get("admin"),
      p_conferido_em: new Date().toISOString(),
    });
    expect(semRascunho).toBe("P0002");

    // a base viva muda; a congelada nao
    await admin
      .from("knowledge_item")
      .update({ answer: "Só débito." })
      .eq("id", itemCartao)
      .throwOnError();
    expect((await versao(1)).conhecimento).toEqual(publicada.conhecimento);
  });

  it("o rascunho seguinte copia a publicada, sem a base; a versao escolhida por fora e renumerada", async () => {
    await rpcOk("garantir_rascunho_do_agente", { p_clinic_id: clinica });
    expect(await rascunho()).toMatchObject({
      version: 2,
      tone: "formal",
      use_emoji: true,
      greeting: "Olá!",
      skills: { informar_preco_e_convenio: true },
      instrucoes: "Fale do estacionamento.",
      conhecimento: [],
      published_by: null,
    });

    // o sistema troca o rascunho por um com versao 50
    await admin
      .from("ai_agent_config")
      .delete()
      .eq("clinic_id", clinica)
      .eq("status", "rascunho")
      .throwOnError();
    await admin
      .from("ai_agent_config")
      .insert({ clinic_id: clinica, version: 50, tone: "proximo" })
      .throwOnError();
    await admin
      .from("knowledge_item")
      .delete()
      .eq("id", itemEstacionamento)
      .throwOnError();
    itemNovo = await item("Tem wi-fi?", "Sim.");

    const { data: publicou, codigo } = await publicar(ids.get("admin"));
    expect(codigo).toBeNull();
    expect(publicou).toEqual({ versao: 2 });
    expect(await versao(2)).toMatchObject({
      status: "publicada",
      tone: "proximo",
      instrucoes: null,
      conhecimento: [
        { id: itemCartao, pergunta: "Aceita cartão?", resposta: "Só débito." },
        { id: itemNovo, pergunta: "Tem wi-fi?", resposta: "Sim." },
      ],
    });
  });

  it("restaurar: o rascunho volta aos campos da versao; as ativas voltam a ser as da base congelada e o resto fica desativado", async () => {
    const { codigo: inexistente } = await rpc("restaurar_versao_do_agente", {
      p_clinic_id: clinica,
      p_versao: 99,
    });
    expect(inexistente).toBe("P0002");
    const { codigo: semVersao } = await rpc("restaurar_versao_do_agente", {
      p_clinic_id: clinica,
      p_versao: null,
    });
    expect(semVersao).toBe("22004");

    const { data: restaurado, error } = await sessaoDoAdmin.rpc(
      "restaurar_versao_do_agente",
      { p_clinic_id: clinica, p_versao: 1 },
    );
    expect(error).toBeNull();
    const v1 = await versao(1);
    expect(await rascunho()).toMatchObject({
      id: restaurado,
      version: 3,
      status: "rascunho",
      agent_name: v1.agent_name,
      tone: "formal",
      use_emoji: true,
      greeting: "Olá!",
      closing: v1.closing,
      skills: { informar_preco_e_convenio: true },
      instrucoes: "Fale do estacionamento.",
      conhecimento: [],
    });

    // ativas: as mesmas ids e textos da v1 (a excluida voltou, a editada
    // voltou ao texto dela); o item novo e o inativo FICAM, desativados
    // (nada se perde ao restaurar)
    const porId = (a: { id: string }, b: { id: string }) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    const esperado = [
      ...v1.conhecimento.map((linha) => ({
        id: linha.id,
        question: linha.pergunta,
        answer: linha.resposta,
        active: true,
      })),
      { id: itemNovo, question: "Tem wi-fi?", answer: "Sim.", active: false },
      {
        id: itemInativo,
        question: "Inativa",
        answer: "Fora da base.",
        active: false,
      },
    ].sort(porId);
    expect((await baseViva()).sort(porId)).toEqual(esperado);
    expect(v1.conhecimento.map((linha) => linha.id)).toEqual([
      itemEstacionamento,
      itemCartao,
    ]);

    const restauracoes = await trilha("restaurou_versao_do_agente");
    expect(restauracoes).toEqual([
      {
        user_id: ids.get("admin"),
        entity: "ai_agent_config",
        entity_id: restaurado,
      },
    ]);
  });

  it("publicar recusa mais de 60 perguntas ativas (22023); com 60 publica; as desativadas nao contam", async () => {
    const atuais = (await baseViva()).filter((linha) => linha.active).length;
    const extras = Array.from({ length: 61 - atuais }, (_, i) => ({
      clinic_id: clinica,
      question: `Pergunta ${i + 1}`,
      answer: "Resposta.",
    }));
    await admin.from("knowledge_item").insert(extras).throwOnError();
    const { codigo } = await publicar(ids.get("admin"));
    expect(codigo).toBe("22023");

    await admin
      .from("knowledge_item")
      .update({ active: false })
      .eq("clinic_id", clinica)
      .eq("question", "Pergunta 1")
      .throwOnError();
    const { data: publicou, codigo: semErro } = await publicar(
      ids.get("admin"),
    );
    expect(semErro).toBeNull();
    expect(publicou).toEqual({ versao: 3 });
    expect((await versao(3)).conhecimento).toHaveLength(60);
  });
});

describe("gasto reservado: o teto vale para chamadas simultaneas", () => {
  // Teto padrao da liberacao: 500 centavos = 5.000.000 microdolar.
  const TRES_DOLARES = 3_000_000;

  async function reservar(custo: number): Promise<string | null> {
    const { data, codigo } = await rpc("reservar_gasto_da_ia", {
      p_clinic_id: clinica,
      p_origem: "simulador",
      p_custo_microdolar: custo,
    });
    expect(codigo).toBeNull();
    return (data as string | null) ?? null;
  }

  async function gasto() {
    const { data } = await admin
      .from("ia_uso")
      .select("id, papel, modelo, origem, custo_microdolar, reserva")
      .eq("clinic_id", clinica)
      .throwOnError();
    return data as {
      id: string;
      papel: string;
      modelo: string;
      origem: string;
      custo_microdolar: number;
      reserva: boolean;
    }[];
  }

  it("sem liberacao, nada se reserva (NULL)", async () => {
    expect(await reservar(1)).toBeNull();
    expect(await gasto()).toEqual([]);
  });

  it("quatro reservas ao mesmo tempo que juntas passam do teto: so uma passa", async () => {
    expect(
      await rpcOk("definir_liberacao_da_ia", {
        p_clinic_id: clinica,
        p_liberada: true,
        p_modo: "simulador",
        p_motivo: "teste de integracao",
      }),
    ).toBe(true);

    const reservas = await Promise.all(
      Array.from({ length: 4 }, () => reservar(TRES_DOLARES)),
    );
    const passaram = reservas.filter((id): id is string => id !== null);
    expect(passaram).toHaveLength(1);
    expect(await gasto()).toEqual([
      {
        id: passaram[0],
        papel: "agente",
        modelo: "reserva",
        origem: "simulador",
        custo_microdolar: TRES_DOLARES,
        reserva: true,
      },
    ]);
    // a reserva conta no teto, mas a trava continua verdadeira no turno
    expect(await rpcOk("ia_pode_simular", { p_clinic_id: clinica })).toBe(true);
  });

  it("acertar troca a reserva pelas linhas reais; de novo da P0002; o espaco volta para a proxima", async () => {
    const [reserva] = (await gasto()).map((linha) => linha.id);
    // o formato de LinhaDoUso (lib/agente/uso.ts)
    const linhas = [
      {
        clinic_id: clinica,
        conversation_id: null,
        job_id: null,
        origem: "simulador",
        papel: "classificador",
        modelo: "gpt-6-luna",
        tokens_entrada: 120,
        tokens_saida: 5,
        tokens_cache_lidos: 0,
        tokens_cache_gravados: 0,
        custo_microdolar: 100,
      },
      {
        clinic_id: clinica,
        conversation_id: null,
        job_id: null,
        origem: "simulador",
        papel: "agente",
        modelo: "gpt-6-luna",
        tokens_entrada: 2000,
        tokens_saida: 80,
        tokens_cache_lidos: 1000,
        tokens_cache_gravados: 0,
        custo_microdolar: 400,
      },
    ];
    await rpcOk("acertar_gasto_da_ia", {
      p_reserva: reserva,
      p_linhas: linhas,
    });
    const depois = await gasto();
    expect(depois.map((linha) => linha.reserva)).toEqual([false, false]);
    expect(
      depois.reduce((soma, linha) => soma + Number(linha.custo_microdolar), 0),
    ).toBe(500);
    const { codigo } = await rpc("acertar_gasto_da_ia", {
      p_reserva: reserva,
      p_linhas: [],
    });
    expect(codigo).toBe("P0002");

    // linha de outra clinica: 22023, e a reserva nova fica
    const nova = await reservar(TRES_DOLARES);
    expect(nova).not.toBeNull();
    const { codigo: outraClinica } = await rpc("acertar_gasto_da_ia", {
      p_reserva: nova,
      p_linhas: [{ ...linhas[0], clinic_id: crypto.randomUUID() }],
    });
    expect(outraClinica).toBe("22023");
    expect((await gasto()).filter((linha) => linha.reserva)).toHaveLength(1);

    // lista vazia so desfaz a reserva
    await rpcOk("acertar_gasto_da_ia", { p_reserva: nova, p_linhas: [] });
    expect(await gasto()).toHaveLength(2);
  });
});
