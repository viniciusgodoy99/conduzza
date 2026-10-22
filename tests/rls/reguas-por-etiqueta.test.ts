import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchFollowups } from "@/lib/queries/automacoes";
import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Reguas de follow-up por etiqueta (onda 4, migration 20261024100000), pela
// API com JWT real de cada papel. O que esta em jogo (contrato da onda 4,
// secao 6):
//   - cadence.etiquetas, etiquetas_modo e prioridade: admin e gestor gravam
//     (a policy "gestao escreve reguas" de hoje); recepcao, leitura,
//     profissional e pendente recebem 42501 no insert e zero linhas no
//     update; a B nao cria nem muda regua da A;
//   - os indices: segunda regua GERAL na etapa 23505; o mesmo filtro (as
//     mesmas etiquetas em outra grafia ou ordem) 23505; filtros diferentes
//     passam; uma etiqueta so com o modo "todas" 23514; regua por etiqueta
//     em Aguardando resposta recusada pelo gatilho da onda 3 (P0001,
//     etapa_sem_followup);
//   - regua_de_followup_do_contato e chaves_de_etiqueta_do_contato (SECURITY
//     INVOKER): o gestor da A ve; a B recebe nulo e a lista vazia;
//   - alcance_das_reguas_de_followup (SECURITY INVOKER): as contagens para o
//     gestor da A (tambem pela leitura da tela, fetchFollowups); a B recebe
//     as listas vazias;
//   - ordenar_reguas_de_followup: so a gestao (recepcao, leitura e a B
//     42501); a lista que nao e exatamente a das reguas com etiqueta da
//     etapa, 22023;
//   - followups_devidos: so a service role (a sessao, 42501).
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Os mesmos
// cenarios do ensaio da migration (~/.claude/plans/onda4-automacoes/
// ensaio-20261024100000.sql, secoes 5 e 8).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste, contatos
// sinteticos com telefone ficticio, apagadas no afterAll. Nada aqui usa a id
// da salud-care, da teste123 nem da Conduzza Teste. Este arquivo nao chama
// planejar_reguas, mas as reguas ligadas daqui (precisam estar ligadas para
// o "recebem" do alcance) entram no planejar_reguas do cron, que roda a
// cada minuto sem filtrar clinica de teste: ele pode criar runs e jobs
// delas. Nenhuma mensagem sai: o motor de producao nao reivindica job de
// clinica e_de_teste (claim_jobs_por_clinica), e tudo sai no afterAll
// (correcao de 22/10/2026: o comentario dizia que nenhum job era criado).
// ESCRITO NA ONDA 4 E AINDA NAO RODADO (roda depois de aplicar a migration,
// com ok: npm run test:rls -- reguas-por-etiqueta).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'reguas-etiqueta-rls-%';
//   delete from public.clinic where slug like 'reguas-etiqueta-rls-%';
//   delete from auth.users where email like 'reguas-etiqueta-%@teste.dev';

const PERMISSAO_NEGADA = "42501";
const UNICO = "23505";
const CHECK = "23514";
const ARGUMENTO_INVALIDO = "22023";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `ReguasEtiqueta!Rls${sufixo}`;
const MINUTO_MS = 60_000;

let clinicaA = "";
let clinicaB = "";
let numeroA = "";
let geral = "";
let psiquiatria = "";
let odontologia = "";
let leadDaEtiqueta = "";
let leadDaConversa = "";
let leadSemEtiqueta = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

type Erro = { code?: string; message?: string; hint?: string } | null;

const email = (apelido: string) =>
  `reguas-etiqueta-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;
const telefone = (final: string) =>
  `+5584973${sufixo.replace(/\D/g, "3").padEnd(4, "3").slice(0, 4)}${final}`;

async function criarPessoa(
  apelido: string,
  clinicId: string,
  role: string,
  opcoes: { status?: "ativo" | "pendente"; professionalId?: string } = {},
): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(apelido),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: `Réguas ${apelido}` },
  });
  if (error || !data.user) {
    throw new Error(`criar ${apelido}: ${error?.message ?? "sem usuário"}`);
  }
  ids.set(apelido, data.user.id);
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

/** Regua de follow-up pelo servico, com um passo de mensagem. */
async function novaRegua(campos: {
  nome: string;
  etapa: string;
  etiquetas?: string[];
  modo?: "qualquer" | "todas";
  prioridade?: number;
  ativa?: boolean;
}): Promise<string> {
  const { data } = await admin
    .from("cadence")
    .insert({
      clinic_id: clinicaA,
      kind: "followup",
      name: campos.nome,
      trigger_stage: campos.etapa,
      active: campos.ativa ?? true,
      send_window_start: "00:00",
      send_window_end: "23:59",
      send_weekdays: [0, 1, 2, 3, 4, 5, 6],
      etiquetas: campos.etiquetas ?? [],
      etiquetas_modo: campos.modo ?? "qualquer",
      prioridade: campos.prioridade ?? 0,
    })
    .select("id")
    .single()
    .throwOnError();
  const cadenceId = (data as { id: string }).id;
  await admin
    .from("cadence_step")
    .insert({
      clinic_id: clinicaA,
      cadence_id: cadenceId,
      offset_minutes: 60,
      fixed_body: "Mensagem sintética do teste",
    })
    .throwOnError();
  return cadenceId;
}

/** Lead sintetico na etapa, entrou ha 10 minutos, com as etiquetas dadas. */
async function novoLead(
  final: string,
  etapa: string,
  etiquetas: string[] = [],
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: telefone(final),
      name: "Contato sintético das réguas",
      kind: "lead",
      funnel_stage: etapa,
      tags: etiquetas,
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = (data as { id: string }).id;
  await admin
    .from("contact")
    .update({
      created_at: new Date(Date.now() - 30 * 24 * 60 * MINUTO_MS).toISOString(),
      funnel_stage_changed_at: new Date(
        Date.now() - 10 * MINUTO_MS,
      ).toISOString(),
    })
    .eq("id", contactId)
    .throwOnError();
  return contactId;
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Réguas por etiqueta RLS A ${sufixo}`,
        slug: `reguas-etiqueta-rls-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Réguas por etiqueta RLS B ${sufixo}`,
        slug: `reguas-etiqueta-rls-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  const linhas = (clinicas ?? []) as { id: string; slug: string }[];
  clinicaA = linhas.find(
    (c) => c.slug === `reguas-etiqueta-rls-a-${sufixo}`,
  )!.id;
  clinicaB = linhas.find(
    (c) => c.slug === `reguas-etiqueta-rls-b-${sufixo}`,
  )!.id;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Réguas" })
    .select("id")
    .single()
    .throwOnError();

  await criarPessoa("admin-a", clinicaA, "admin");
  await criarPessoa("gestor-a", clinicaA, "gestor");
  await criarPessoa("recepcao-a", clinicaA, "recepcao");
  await criarPessoa("leitura-a", clinicaA, "leitura");
  await criarPessoa("prof-a", clinicaA, "profissional", {
    professionalId: (prof as { id: string }).id,
  });
  await criarPessoa("pendente-a", clinicaA, "recepcao", { status: "pendente" });
  await criarPessoa("admin-b", clinicaB, "admin");

  // Uma etapa livre da A e a etiqueta do catalogo de conversa (D1: o filtro
  // casa pelo NOME, sem maiuscula e acento).
  await admin
    .from("funnel_stage_def")
    .insert([
      { clinic_id: clinicaA, chave: "e1", nome: "Etapa E1", posicao: 61 },
      { clinic_id: clinicaA, chave: "e2", nome: "Etapa E2", posicao: 62 },
    ])
    .throwOnError();
  await admin
    .from("conversation_tag_def")
    .insert({ clinic_id: clinicaA, chave: "psiq", nome: "Psiquiatria" })
    .throwOnError();
  numeroA = (await criarNumeroDeTeste(admin, clinicaA)).id;

  // E1: a geral, Psiquiatria (de cima) e Odontologia.
  geral = await novaRegua({ nome: "Geral de E1", etapa: "e1" });
  psiquiatria = await novaRegua({
    nome: "Psiquiatria de E1",
    etapa: "e1",
    etiquetas: ["Psiquiatria"],
    prioridade: 1,
  });
  odontologia = await novaRegua({
    nome: "Odontologia de E1",
    etapa: "e1",
    etiquetas: ["Odontologia"],
    prioridade: 2,
  });

  leadDaEtiqueta = await novoLead("01", "e1", ["psiquiatria"]);
  leadDaConversa = await novoLead("02", "e1");
  await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: leadDaConversa,
      whatsapp_account_id: numeroA,
      tags: ["psiq"],
    })
    .throwOnError();
  leadSemEtiqueta = await novoLead("03", "e1");
  // So o lead da etiqueta autorizou mensagens.
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicaA,
      contact_id: leadDaEtiqueta,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();
});

afterAll(async () => {
  const { error } = await admin
    .from("clinic")
    .delete()
    .in("id", [clinicaA, clinicaB]);
  expect(error, "apagar as clinicas do teste").toBeNull();
  const falhas: string[] = [];
  for (const usuario of ids.values()) {
    const { error: erro } = await admin.auth.admin.deleteUser(usuario);
    if (erro) {
      falhas.push(`${usuario}: ${erro.message}`);
    }
  }
  expect(falhas, "usuarios sinteticos que nao sairam").toEqual([]);
});

describe("cadence.etiquetas: quem grava", () => {
  it("o gestor cria regua por etiqueta; recepcao, leitura, profissional e pendente recebem 42501", async () => {
    const regua = {
      clinic_id: clinicaA,
      kind: "followup",
      trigger_stage: "e2",
      active: false,
      etiquetas: ["Dermatologia"],
    };
    const { data, error } = await como("gestor-a")
      .from("cadence")
      .insert({ ...regua, name: "Dermatologia de E2" })
      .select("id, etiquetas, etiquetas_modo, prioridade")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      etiquetas: ["Dermatologia"],
      etiquetas_modo: "qualquer",
      prioridade: 0,
    });
    for (const apelido of ["recepcao-a", "leitura-a", "prof-a", "pendente-a"]) {
      const { error: erro } = await como(apelido)
        .from("cadence")
        .insert({
          ...regua,
          name: `Tentativa ${apelido}`,
          etiquetas: ["Nova"],
        });
      expect((erro as Erro)?.code, apelido).toBe(PERMISSAO_NEGADA);
    }
  });

  it("recepcao e a B nao mudam o filtro (zero linhas); a B nao cria regua na A", async () => {
    for (const apelido of ["recepcao-a", "admin-b"]) {
      const { data, error } = await como(apelido)
        .from("cadence")
        .update({ etiquetas: ["Mexida"], prioridade: 9 })
        .eq("id", psiquiatria)
        .select("id");
      expect(error, apelido).toBeNull();
      expect(data ?? [], apelido).toEqual([]);
    }
    const { error: naA } = await como("admin-b")
      .from("cadence")
      .insert({
        clinic_id: clinicaA,
        kind: "followup",
        name: "Da B na A",
        trigger_stage: "e2",
        active: false,
        etiquetas: ["Da B"],
      });
    expect((naA as Erro)?.code).toBe(PERMISSAO_NEGADA);
    // Contraprova: nada mudou, e o gestor muda o filtro da regua dele.
    const { data: antes } = await admin
      .from("cadence")
      .select("etiquetas, prioridade")
      .eq("id", psiquiatria)
      .single()
      .throwOnError();
    expect(antes).toEqual({ etiquetas: ["Psiquiatria"], prioridade: 1 });
    const { data: mudada, error } = await como("gestor-a")
      .from("cadence")
      .update({ etiquetas: ["Psiquiatria", "Infantil"] })
      .eq("id", psiquiatria)
      .select("id");
    expect(error).toBeNull();
    expect(mudada).toHaveLength(1);
    await admin
      .from("cadence")
      .update({ etiquetas: ["Psiquiatria"] })
      .eq("id", psiquiatria)
      .throwOnError();
  });

  it("membro ativo le as reguas e os filtros; pendente e a B nao", async () => {
    for (const apelido of ["recepcao-a", "leitura-a", "prof-a"]) {
      const { data } = await como(apelido)
        .from("cadence")
        .select("id, etiquetas")
        .eq("id", psiquiatria);
      expect(data, apelido).toEqual([
        { id: psiquiatria, etiquetas: ["Psiquiatria"] },
      ]);
    }
    for (const apelido of ["pendente-a", "admin-b"]) {
      const { data } = await como(apelido)
        .from("cadence")
        .select("id")
        .eq("clinic_id", clinicaA);
      expect(data ?? [], apelido).toEqual([]);
    }
  });
});

describe("os indices, os checks e o gatilho da onda 3", () => {
  const base = () => ({
    clinic_id: clinicaA,
    kind: "followup",
    trigger_stage: "e1",
    active: false,
  });

  it("segunda regua geral na etapa: 23505", async () => {
    const { error } = await como("gestor-a")
      .from("cadence")
      .insert({ ...base(), name: "Outra geral de E1" });
    expect((error as Erro)?.code).toBe(UNICO);
    expect((error as Erro)?.message).toContain(
      "cadence_followup_geral_unico_por_etapa",
    );
  });

  it("o mesmo filtro em outra grafia ou ordem: 23505; filtros diferentes passam", async () => {
    const { error: grafia } = await como("gestor-a")
      .from("cadence")
      .insert({
        ...base(),
        name: "Psiquiatria de novo",
        etiquetas: ["PSIQUIATRIA"],
      });
    expect((grafia as Erro)?.code).toBe(UNICO);
    expect((grafia as Erro)?.message).toContain(
      "cadence_followup_mesmo_filtro",
    );

    const { error: primeira } = await como("gestor-a")
      .from("cadence")
      .insert({
        ...base(),
        name: "As duas, todas",
        etiquetas: ["Psiquiatria", "Odontologia"],
        etiquetas_modo: "todas",
      });
    expect(primeira).toBeNull();
    const { error: ordem } = await como("gestor-a")
      .from("cadence")
      .insert({
        ...base(),
        name: "As duas, todas, na outra ordem",
        etiquetas: ["odontologia", "Psiquiatria"],
        etiquetas_modo: "todas",
      });
    expect((ordem as Erro)?.code).toBe(UNICO);
    // Outro modo com as mesmas duas etiquetas e outro filtro: passa.
    const { error: outroModo } = await como("gestor-a")
      .from("cadence")
      .insert({
        ...base(),
        name: "As duas, qualquer uma",
        etiquetas: ["Psiquiatria", "Odontologia"],
        etiquetas_modo: "qualquer",
      });
    expect(outroModo).toBeNull();
    await admin
      .from("cadence")
      .delete()
      .eq("clinic_id", clinicaA)
      .in("name", ["As duas, todas", "As duas, qualquer uma"])
      .throwOnError();
  });

  it("uma etiqueta so com o modo todas: 23514 (seria o mesmo filtro com outro nome)", async () => {
    const { error } = await como("gestor-a")
      .from("cadence")
      .insert({
        ...base(),
        name: "Psiquiatria, todas",
        etiquetas: ["Psiquiatria"],
        etiquetas_modo: "todas",
      });
    expect((error as Erro)?.code).toBe(CHECK);
    expect((error as Erro)?.message).toContain(
      "cadence_modo_so_com_varias_etiquetas",
    );
  });

  it("regua por etiqueta em Aguardando resposta: o gatilho da onda 3 recusa", async () => {
    const { error } = await como("gestor-a")
      .from("cadence")
      .insert({
        ...base(),
        trigger_stage: "aguardando_resposta",
        name: "Aguardando com etiqueta",
        etiquetas: ["Psiquiatria"],
      });
    expect((error as Erro)?.code).toBe("P0001");
    expect((error as Erro)?.hint).toBe("etapa_sem_followup");
  });
});

describe("a regua que vale e as etiquetas do contato, pela sessao", () => {
  it("o gestor da A ve a regua que vale para cada lead (D1, D2); a B recebe nulo", async () => {
    const casos: [string, string][] = [
      [leadDaEtiqueta, psiquiatria], // etiqueta no lead
      [leadDaConversa, psiquiatria], // etiqueta na conversa, pelo nome
      [leadSemEtiqueta, geral], // sem etiqueta: a geral
    ];
    for (const [contato, esperada] of casos) {
      const { data, error } = await como("gestor-a").rpc(
        "regua_de_followup_do_contato",
        { p_contact_id: contato },
      );
      expect(error).toBeNull();
      expect(data).toBe(esperada);
      const { data: daB, error: erroDaB } = await como("admin-b").rpc(
        "regua_de_followup_do_contato",
        { p_contact_id: contato },
      );
      expect(erroDaB).toBeNull();
      expect(daB).toBeNull();
    }
    const { error: anon } = await anonClient().rpc(
      "regua_de_followup_do_contato",
      { p_contact_id: leadDaEtiqueta },
    );
    expect((anon as Erro)?.code).toBe(PERMISSAO_NEGADA);
  });

  it("chaves_de_etiqueta_do_contato: o gestor ve as chaves; a B recebe a lista vazia", async () => {
    const { data } = await como("gestor-a").rpc(
      "chaves_de_etiqueta_do_contato",
      {
        p_contact_id: leadDaConversa,
      },
    );
    expect(data).toEqual(["psiquiatria"]);
    const { data: daB, error } = await como("admin-b").rpc(
      "chaves_de_etiqueta_do_contato",
      { p_contact_id: leadDaConversa },
    );
    expect(error).toBeNull();
    expect(daB).toEqual([]);
  });

  it("followups_devidos e so da service role", async () => {
    for (const apelido of ["gestor-a", "admin-a"]) {
      const { error } = await como(apelido).rpc("followups_devidos", {
        p_clinic_id: clinicaA,
      });
      expect((error as Erro)?.code, apelido).toBe(PERMISSAO_NEGADA);
    }
    // Contraprova: o servico le (so leitura; nada e planejado aqui).
    const { error } = await admin.rpc("followups_devidos", {
      p_clinic_id: clinicaA,
    });
    expect(error).toBeNull();
  });
});

describe("alcance e ordem (as leituras e a escrita da tela)", () => {
  type Alcance = {
    reguas: {
      id: string;
      casam: number;
      recebem: number;
      sem_autorizacao: number;
      entradas_30d: number;
    }[];
    etapas: { chave: string; sem_regua: number }[];
  };

  it("o gestor recebe as contagens; a B recebe as listas vazias", async () => {
    const { data, error } = await como("gestor-a").rpc(
      "alcance_das_reguas_de_followup",
      { p_clinic_id: clinicaA },
    );
    expect(error).toBeNull();
    const alcance = data as Alcance;
    const porId = new Map(alcance.reguas.map((linha) => [linha.id, linha]));
    // E1 tem os tres leads: todos casam com a geral; dois com Psiquiatria
    // (o da etiqueta e o da conversa), que vale para eles; ninguem com
    // Odontologia. So o da etiqueta autorizou mensagens.
    expect(porId.get(geral)).toMatchObject({
      casam: 3,
      recebem: 1,
      sem_autorizacao: 2,
      entradas_30d: 3,
    });
    expect(porId.get(psiquiatria)).toMatchObject({
      casam: 2,
      recebem: 2,
      sem_autorizacao: 1,
      entradas_30d: 2,
    });
    expect(porId.get(odontologia)).toMatchObject({ casam: 0, recebem: 0 });
    expect(alcance.etapas).toContainEqual({ chave: "e1", sem_regua: 0 });

    // A leitura da tela (fetchFollowups) pela sessao do gestor traz as
    // contagens de cada regua.
    const dados = await fetchFollowups(como("gestor-a"), clinicaA);
    const daTela = dados.reguas.find((regua) => regua.id === psiquiatria);
    expect(daTela?.alcance).toEqual({
      casam: 2,
      recebem: 2,
      sem_autorizacao: 1,
      entradas_30d: 2,
    });
    expect(daTela?.etiquetas).toEqual(["Psiquiatria"]);

    const { data: daB, error: erroDaB } = await como("admin-b").rpc(
      "alcance_das_reguas_de_followup",
      { p_clinic_id: clinicaA },
    );
    expect(erroDaB).toBeNull();
    expect(daB).toEqual({ reguas: [], etapas: [] });
  });

  it("ordenar: recepcao, leitura e a B recebem 42501; lista errada 22023; o gestor ordena", async () => {
    const pedido = {
      p_clinic_id: clinicaA,
      p_trigger_stage: "e1",
      p_ids: [odontologia, psiquiatria],
    };
    for (const apelido of ["recepcao-a", "leitura-a", "admin-b"]) {
      const { error } = await como(apelido).rpc(
        "ordenar_reguas_de_followup",
        pedido,
      );
      expect((error as Erro)?.code, apelido).toBe(PERMISSAO_NEGADA);
    }
    for (const errada of [
      [psiquiatria],
      [odontologia, psiquiatria, psiquiatria],
      [odontologia, psiquiatria, geral],
    ]) {
      const { error } = await como("gestor-a").rpc(
        "ordenar_reguas_de_followup",
        {
          ...pedido,
          p_ids: errada,
        },
      );
      expect((error as Erro)?.code, JSON.stringify(errada)).toBe(
        ARGUMENTO_INVALIDO,
      );
    }
    // Ninguem mexeu: Psiquiatria continua na frente.
    const { data: antes } = await admin
      .from("cadence")
      .select("id, prioridade")
      .in("id", [psiquiatria, odontologia])
      .order("prioridade")
      .throwOnError();
    expect((antes ?? []).map((linha) => linha.id)).toEqual([
      psiquiatria,
      odontologia,
    ]);

    const { error } = await como("gestor-a").rpc(
      "ordenar_reguas_de_followup",
      pedido,
    );
    expect(error).toBeNull();
    const { data: depois } = await admin
      .from("cadence")
      .select("id, prioridade")
      .in("id", [psiquiatria, odontologia])
      .throwOnError();
    expect(new Map((depois ?? []).map((l) => [l.id, l.prioridade]))).toEqual(
      new Map([
        [odontologia, 1],
        [psiquiatria, 2],
      ]),
    );
    // Volta a ordem (os outros casos contam com Psiquiatria na frente).
    await admin.rpc("ordenar_reguas_de_followup", {
      ...pedido,
      p_ids: [psiquiatria, odontologia],
    });
  });
});
