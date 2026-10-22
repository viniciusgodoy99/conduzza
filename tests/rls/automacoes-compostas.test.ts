import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchAutomacoesDeFluxo,
  fetchHistoricoDeAutomacoes,
} from "@/lib/queries/automacoes-de-fluxo";
import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Automacoes compostas (onda 4, migration 20261024110000), pela API com JWT
// real de cada papel. O que esta em jogo (contrato da onda 4, secao 6):
//   - automacao_condicao, automacao_acao e automacao_execucao_acao: membro
//     ATIVO da A le (administrador, gestor, recepcao, leitura e
//     profissional); a B e o pendente leem zero; INSERT, UPDATE e DELETE
//     pela API dao 42501 ate para o administrador (so as funcoes do banco
//     escrevem);
//   - salvar_automacao_de_fluxo: administrador e gestor salvam (autoria e
//     vigencia do banco, as colunas legadas nulas); recepcao, profissional,
//     leitura e pendente recebem 42501 sem dica; a B, passando a clinica da
//     A, recebe o MESMO 42501 com o id de uma regra que existe e com um que
//     nao existe (ninguem descobre pelo codigo de erro se o id existe); a B,
//     na clinica dela, com o id da A recebe o mesmo P0002 do id que nao
//     existe; anon nao executa; forma e limites dao 22023;
//   - a leitura da tela pela sessao (fetchAutomacoesDeFluxo e
//     fetchHistoricoDeAutomacoes, com os embeds das filhas e do retrato por
//     acao): o gestor ve; a B nao ve nada da A;
//   - o espelho do codigo velho: a escrita legada do gestor vira a acao da
//     posicao 1.
// Toda negacao tem o caso positivo ao lado (anti falso positivo). Os mesmos
// cenarios do ensaio da migration (~/.claude/plans/onda4-automacoes/
// ensaio-20261024110000.sql, secoes 4 a 6).
//
// CUIDADO, o banco e o da producao: clinicas e_de_teste (o motor de producao
// as ignora: planejar e executar so rodam com p_clinic_id e
// p_incluir_teste), contatos sinteticos com telefone ficticio, apagadas no
// afterAll. Nenhuma acao manda mensagem ao paciente. Nada aqui usa a id da
// salud-care, da teste123 nem da Conduzza Teste. ESCRITO NA ONDA 4 E AINDA
// NAO RODADO (roda depois de aplicar as migrations, com ok: npm run
// test:rls -- automacoes-compostas).
//
// LIMPEZA MANUAL, se uma execucao morrer antes do afterAll: no SQL editor,
//   select id, name from public.clinic where slug like 'compostas-rls-%';
//   delete from public.clinic where slug like 'compostas-rls-%';
//   delete from auth.users where email like 'compostas-%@teste.dev';

const PERMISSAO_NEGADA = "42501";
const ARGUMENTO_INVALIDO = "22023";
const NAO_ENCONTRADA = "P0002";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = `Compostas!Rls${sufixo}`;
const HORA_MS = 60 * 60_000;

let clinicaA = "";
let clinicaB = "";
let regraA = "";
let contatoA = "";
let execucaoA = "";
const ids = new Map<string, string>();
const clientes = new Map<string, SupabaseClient>();

type Erro = { code?: string; message?: string; hint?: string | null } | null;

const TABELAS = [
  "automacao_condicao",
  "automacao_acao",
  "automacao_execucao_acao",
] as const;
const PAPEIS_QUE_NAO_GERENCIAM = [
  "recepcao-a",
  "prof-a",
  "leitura-a",
  "pendente-a",
] as const;

const email = (apelido: string) => `compostas-${apelido}-${sufixo}@teste.dev`;
const como = (apelido: string) => clientes.get(apelido)!;
const telefone = (final: string) =>
  `+5584972${sufixo.replace(/\D/g, "2").padEnd(4, "2").slice(0, 4)}${final}`;

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
    user_metadata: { name: `Compostas ${apelido}` },
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

/** A regra no formato da RPC (regraParaGravar, lib/domain/automacoes-de-fluxo.ts). */
function regra(
  nome: string,
  acoes: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    nome,
    ativa: false,
    gatilho: "tempo_na_etapa",
    etapa: "k1",
    espera_minutos: 60,
    combinar: "todas",
    condicoes: [],
    acoes,
    ...extra,
  };
}

const NOTA = { acao: "nota_interna", nota_texto: "Conferir o convênio." };

async function salvar(
  cliente: SupabaseClient,
  clinicId: string,
  id: string | null,
  corpo: Record<string, unknown>,
): Promise<{ data: unknown; error: Erro }> {
  const { data, error } = await cliente.rpc("salvar_automacao_de_fluxo", {
    p_clinic_id: clinicId,
    p_id: id,
    p_regra: corpo,
  });
  return { data, error: error as Erro };
}

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      {
        name: `Compostas RLS A ${sufixo}`,
        slug: `compostas-rls-a-${sufixo}`,
        e_de_teste: true,
      },
      {
        name: `Compostas RLS B ${sufixo}`,
        slug: `compostas-rls-b-${sufixo}`,
        e_de_teste: true,
      },
    ])
    .select("id, slug")
    .throwOnError();
  const linhas = (clinicas ?? []) as { id: string; slug: string }[];
  clinicaA = linhas.find((c) => c.slug === `compostas-rls-a-${sufixo}`)!.id;
  clinicaB = linhas.find((c) => c.slug === `compostas-rls-b-${sufixo}`)!.id;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Compostas" })
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

  await admin
    .from("funnel_stage_def")
    .insert([
      { clinic_id: clinicaA, chave: "k1", nome: "K1", posicao: 61 },
      { clinic_id: clinicaA, chave: "k2", nome: "K2", posicao: 62 },
      { clinic_id: clinicaB, chave: "k1", nome: "K1 da B", posicao: 61 },
    ])
    .throwOnError();
  const numeroA = (await criarNumeroDeTeste(admin, clinicaA)).id;

  // A regra da A (pelo servico, como o codigo novo grava): uma condicao e
  // duas acoes; e uma execucao com o retrato de uma acao.
  const { data: salva, error: erroDaRegra } = await salvar(
    admin,
    clinicaA,
    null,
    regra(
      "Composta da A",
      [
        {
          acao: "criar_atividade",
          atividade_titulo: "Ligar",
          atividade_prazo_dias: 0,
        },
        { acao: "mover_etapa", etapa_destino: "k2" },
      ],
      { condicoes: [{ tipo: "tem_etiqueta", etiqueta: "Psiquiatria" }] },
    ),
  );
  expect(erroDaRegra).toBeNull();
  regraA = salva as string;

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicaA,
      phone_e164: telefone("01"),
      name: "Contato sintético das automações",
      kind: "lead",
      funnel_stage: "k1",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoA = (contato as { id: string }).id;
  await admin
    .from("conversation")
    .insert({
      clinic_id: clinicaA,
      contact_id: contatoA,
      whatsapp_account_id: numeroA,
    })
    .throwOnError();
  const { data: execucao } = await admin
    .from("automacao_execucao")
    .insert({
      clinic_id: clinicaA,
      automacao_id: regraA,
      contact_id: contatoA,
      de_etapa: "k1",
      entrada_na_etapa: new Date(Date.now() - 2 * HORA_MS).toISOString(),
      devida_em: new Date(Date.now() + 24 * HORA_MS).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  execucaoA = (execucao as { id: string }).id;
  await admin
    .from("automacao_execucao_acao")
    .insert({
      clinic_id: clinicaA,
      execucao_id: execucaoA,
      posicao: 1,
      acao: "criar_atividade",
      status: "pulada",
      motivo: "etapa_mudou",
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

describe("as tres tabelas novas", () => {
  it("membro ativo da A le; o pendente e a B leem zero", async () => {
    for (const tabela of TABELAS) {
      for (const apelido of [
        "admin-a",
        "gestor-a",
        "recepcao-a",
        "leitura-a",
        "prof-a",
      ]) {
        const { data, error } = await como(apelido)
          .from(tabela)
          .select("id")
          .eq("clinic_id", clinicaA);
        expect(error, `${tabela} ${apelido}`).toBeNull();
        expect((data ?? []).length, `${tabela} ${apelido}`).toBeGreaterThan(0);
      }
      for (const apelido of ["pendente-a", "admin-b"]) {
        const { data, error } = await como(apelido)
          .from(tabela)
          .select("id")
          .eq("clinic_id", clinicaA);
        expect(error, `${tabela} ${apelido}`).toBeNull();
        expect(data ?? [], `${tabela} ${apelido}`).toEqual([]);
      }
    }
  });

  it("INSERT, UPDATE e DELETE pela API dao 42501 ate para o administrador", async () => {
    const linhas: Record<(typeof TABELAS)[number], Record<string, unknown>> = {
      automacao_condicao: {
        clinic_id: clinicaA,
        automacao_id: regraA,
        posicao: 5,
        tipo: "tem_etiqueta",
        etiqueta: "Forjada",
      },
      automacao_acao: {
        clinic_id: clinicaA,
        automacao_id: regraA,
        posicao: 5,
        acao: "nota_interna",
        nota_texto: "Forjada",
      },
      automacao_execucao_acao: {
        clinic_id: clinicaA,
        execucao_id: execucaoA,
        posicao: 5,
        acao: "nota_interna",
        status: "pulada",
        motivo: "forjado",
      },
    };
    for (const tabela of TABELAS) {
      for (const apelido of ["admin-a", "gestor-a"]) {
        const { error: insercao } = await como(apelido)
          .from(tabela)
          .insert(linhas[tabela]);
        expect((insercao as Erro)?.code, `${tabela} insert ${apelido}`).toBe(
          PERMISSAO_NEGADA,
        );
        const { error: atualizacao } = await como(apelido)
          .from(tabela)
          .update({ posicao: 4 })
          .eq("clinic_id", clinicaA);
        expect((atualizacao as Erro)?.code, `${tabela} update ${apelido}`).toBe(
          PERMISSAO_NEGADA,
        );
        const { error: exclusao } = await como(apelido)
          .from(tabela)
          .delete()
          .eq("clinic_id", clinicaA);
        expect((exclusao as Erro)?.code, `${tabela} delete ${apelido}`).toBe(
          PERMISSAO_NEGADA,
        );
      }
    }
    // Contraprova: nada mudou.
    const { data: acoes } = await admin
      .from("automacao_acao")
      .select("posicao, acao")
      .eq("automacao_id", regraA)
      .order("posicao")
      .throwOnError();
    expect(acoes).toEqual([
      { posicao: 1, acao: "criar_atividade" },
      { posicao: 2, acao: "mover_etapa" },
    ]);
  });
});

describe("salvar_automacao_de_fluxo", () => {
  it("gestor e administrador salvam; autoria e vigencia do banco; colunas legadas nulas", async () => {
    const { data: nova, error } = await salvar(
      como("gestor-a"),
      clinicaA,
      null,
      regra("Do gestor", [NOTA, { acao: "etiquetar", etiqueta: "urgente" }]),
    );
    expect(error).toBeNull();
    const regraDoGestor = nova as string;
    const { error: edicao } = await salvar(
      como("admin-a"),
      clinicaA,
      regraDoGestor,
      regra("Do gestor, editada", [NOTA], { combinar: "qualquer" }),
    );
    expect(edicao).toBeNull();
    const { data: linha } = await admin
      .from("automacao_fluxo")
      .select(
        "nome, combinar, created_by, updated_by, acao, etiqueta, nota_texto",
      )
      .eq("id", regraDoGestor)
      .single()
      .throwOnError();
    expect(linha).toEqual({
      nome: "Do gestor, editada",
      combinar: "qualquer",
      created_by: ids.get("gestor-a"),
      updated_by: ids.get("admin-a"),
      acao: null,
      etiqueta: null,
      nota_texto: null,
    });
    const { data: acoes } = await admin
      .from("automacao_acao")
      .select("posicao, acao, nota_texto")
      .eq("automacao_id", regraDoGestor)
      .throwOnError();
    expect(acoes).toEqual([
      { posicao: 1, acao: "nota_interna", nota_texto: "Conferir o convênio." },
    ]);
  });

  it("recepcao, profissional, leitura e pendente: 42501 sem dica, na criacao e na edicao", async () => {
    for (const apelido of PAPEIS_QUE_NAO_GERENCIAM) {
      const criacao = await salvar(
        como(apelido),
        clinicaA,
        null,
        regra("Tentativa", [NOTA]),
      );
      expect(criacao.error?.code, apelido).toBe(PERMISSAO_NEGADA);
      expect(criacao.error?.hint ?? null, apelido).toBeNull();
      const edicao = await salvar(
        como(apelido),
        clinicaA,
        regraA,
        regra("Tentativa", [NOTA]),
      );
      expect(edicao.error?.code, apelido).toBe(PERMISSAO_NEGADA);
    }
  });

  it("a B, passando a clinica da A, recebe o mesmo 42501 para o id que existe e para o que nao existe", async () => {
    const existe = await salvar(
      como("admin-b"),
      clinicaA,
      regraA,
      regra("Da B", [NOTA]),
    );
    const naoExiste = await salvar(
      como("admin-b"),
      clinicaA,
      crypto.randomUUID(),
      regra("Da B", [NOTA]),
    );
    expect(existe.error?.code).toBe(PERMISSAO_NEGADA);
    expect(naoExiste.error?.code).toBe(PERMISSAO_NEGADA);
    expect(existe.error?.message).toBe(naoExiste.error?.message);
    expect(existe.error?.hint ?? null).toBeNull();
    expect(naoExiste.error?.hint ?? null).toBeNull();
  });

  it("a B, na clinica dela, com o id da A recebe o mesmo P0002 do id que nao existe; a regra da A fica igual", async () => {
    const daA = await salvar(
      como("admin-b"),
      clinicaB,
      regraA,
      regra("Da B", [NOTA]),
    );
    const nenhuma = await salvar(
      como("admin-b"),
      clinicaB,
      crypto.randomUUID(),
      regra("Da B", [NOTA]),
    );
    expect(daA.error?.code).toBe(NAO_ENCONTRADA);
    expect(nenhuma.error?.code).toBe(NAO_ENCONTRADA);
    expect(daA.error?.message).toBe(nenhuma.error?.message);
    const { data: linha } = await admin
      .from("automacao_fluxo")
      .select("nome, clinic_id")
      .eq("id", regraA)
      .single()
      .throwOnError();
    expect(linha).toEqual({ nome: "Composta da A", clinic_id: clinicaA });
    // Contraprova: a B salva a dela.
    const propria = await salvar(
      como("admin-b"),
      clinicaB,
      null,
      regra("Da B", [NOTA]),
    );
    expect(propria.error).toBeNull();
  });

  it("anon nao executa a RPC", async () => {
    const { error } = await salvar(
      anonClient(),
      clinicaA,
      null,
      regra("Anon", [NOTA]),
    );
    expect(error?.code).toBe(PERMISSAO_NEGADA);
  });

  it("forma e limites: 22023", async () => {
    const seis = Array.from({ length: 6 }, (_, i) => ({
      acao: "nota_interna",
      nota_texto: `Nota ${i + 1}`,
    }));
    const casos = [
      regra("Sem acao", []),
      regra("Seis acoes", seis),
      regra("Seis condicoes", [NOTA], {
        condicoes: Array.from({ length: 6 }, (_, i) => ({
          tipo: "tem_etiqueta",
          etiqueta: `Etiqueta ${i + 1}`,
        })),
      }),
      regra("Dois movers", [
        { acao: "mover_etapa", etapa_destino: "k2" },
        { acao: "mover_etapa", etapa_destino: "em_contato" },
      ]),
      regra("Espera quebrada", [NOTA], { espera_minutos: 60.5 }),
    ];
    for (const corpo of casos) {
      const { error } = await salvar(como("gestor-a"), clinicaA, null, corpo);
      expect(error?.code, String(corpo.nome)).toBe(ARGUMENTO_INVALIDO);
    }
  });
});

describe("a leitura da tela pela sessao", () => {
  it("o gestor ve a regra com as filhas e o historico com o retrato por acao; a B nao ve nada da A", async () => {
    const regras = await fetchAutomacoesDeFluxo(como("gestor-a"), clinicaA);
    const daA = regras.find((linha) => linha.id === regraA);
    expect(daA?.condicoes).toEqual([
      { posicao: 1, tipo: "tem_etiqueta", etiqueta: "Psiquiatria" },
    ]);
    expect(daA?.acoes.map((acao) => acao.acao)).toEqual([
      "criar_atividade",
      "mover_etapa",
    ]);
    const historico = await fetchHistoricoDeAutomacoes(
      como("gestor-a"),
      clinicaA,
      regraA,
    );
    expect(historico).toHaveLength(1);
    expect(historico[0]?.acoes).toMatchObject([
      {
        posicao: 1,
        acao: "criar_atividade",
        status: "pulada",
        motivo: "etapa_mudou",
      },
    ]);

    expect(await fetchAutomacoesDeFluxo(como("admin-b"), clinicaA)).toEqual([]);
    expect(
      await fetchHistoricoDeAutomacoes(como("admin-b"), clinicaA, null),
    ).toEqual([]);
  });

  it("o espelho do codigo velho: a escrita legada do gestor vira a acao da posicao 1", async () => {
    const { data, error } = await como("gestor-a")
      .from("automacao_fluxo")
      .insert({
        clinic_id: clinicaA,
        nome: "Legada",
        gatilho: "entrou_na_etapa",
        etapa: "k2",
        acao: "etiquetar",
        etiqueta: "urgente",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: acoes } = await admin
      .from("automacao_acao")
      .select("posicao, acao, etiqueta")
      .eq("automacao_id", (data as { id: string }).id)
      .throwOnError();
    expect(acoes).toEqual([
      { posicao: 1, acao: "etiquetar", etiqueta: "urgente" },
    ]);
  });
});
