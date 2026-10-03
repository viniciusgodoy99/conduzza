import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { adminClient, anonClient } from "../rls/stack";

// Convenio pelo medico (pedido do dono em 02/10/2026; migration
// 20261002140000_convenio_pelo_medico.sql), PELA PORTA DE PRODUCAO: as
// Server Actions de Cadastros (salvarProfissionalAction com insurance_ids e
// sincronizarVinculosDoProcedimentoAction com extras) e a de criar consulta
// da Agenda (D8) rodam de verdade, com getSessionContext e createClient
// dublados (fora do Next nao ha cookie) e um usuario REAL logado por senha:
// JWT, RLS, papel e a trava das RPCs sao os de verdade. A RPC direta esta em
// tests/integration/convenio-pelo-medico-rpc.test.ts.
//
// O aceite da spec 3.5 (Dr. Joao: Endocrinologia particular R$ 400 / 40 min
// com Unimed e Bradesco; Nutrologia particular R$ 500 / 60 min, so
// particular) e cadastrado como a tela faz, nos dois cenarios:
//   1. Nutrologia sem cobertura (nenhum convenio cobre);
//   2. Nutrologia coberta pela Unimed, com a excecao do Joao (ele atende a
//      Unimed, a Unimed cobre, mas na Nutrologia ele so atende particular).
// E mais: aviso antes de gravar (D4), deixa de fazer (D3), reativacao com os
// valores gravados (D2), aba parada (D5), convenio desativado, papel e
// isolamento entre clinicas.
//
// Clinicas e_de_teste. Padrao da suite: toda negacao tem o caso positivo ao
// lado (anti falso positivo).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const SENHA = `ConvenioAcao!${sufixo}`;
const ABA_PARADA =
  "O cadastro mudou enquanto você editava. Feche, abra de novo e salve.";
const CONVENIO_DESATIVADO = "Um convênio desativado não pode ser marcado.";

type Papel = "admin" | "gestor" | "recepcao" | "leitura";

type Sessao = {
  userId: string;
  userName: string;
  userEmail: string;
  memberships: never[];
  active: {
    clinicId: string;
    clinicName: string;
    slug: string;
    timezone: string;
    role: Papel;
    status: "ativo";
  } | null;
  isProductAdmin: boolean;
  vinculoIndisponivel: boolean;
};

const sessaoDaAcao: Sessao = {
  userId: "",
  userName: "Convênio",
  userEmail: "",
  memberships: [],
  active: null,
  isProductAdmin: false,
  vinculoIndisponivel: false,
};
let clienteDaSessao: SupabaseClient | null = null;

let acoes: typeof import("@/app/(app)/cadastros/actions");
let agenda: typeof import("@/app/(app)/agenda/actions");
let catalogo: typeof import("@/lib/queries/catalogo");

let clinicaA = "";
let clinicaB = "";
const usuarios: Record<string, { id: string; cliente: SupabaseClient }> = {};

let unimed = "";
let bradesco = "";
let amil = "";
let sulamerica = "";
let convenioB = "";
let contatoA = "";

type Linha = {
  professional_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
};

type Par = { professional_id: string; insurance_id: string | null };

type Extras = {
  planos: string[];
  vinculosNaAbertura: Par[];
  planosNaAbertura: string[];
  confirmar: boolean;
};

type Oferta = {
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `conv-acao-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
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

async function criarUsuario(
  chave: string,
  clinicId: string,
  role: Papel,
): Promise<void> {
  const email = `conv-acao-${chave}-${sufixo}@teste.dev`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: chave },
  });
  if (error || !data.user) {
    throw new Error(`criar ${chave}: ${error?.message ?? "sem usuário"}`);
  }
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user.id,
      role,
      status: "ativo",
    })
    .throwOnError();
  const cliente = anonClient();
  const login = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (login.error) {
    throw new Error(`login ${chave}: ${login.error.message}`);
  }
  usuarios[chave] = { id: data.user.id, cliente };
}

/** As actions passam a rodar como este usuario, nesta clinica, neste papel. */
function agirComo(chave: string, clinicId: string, role: Papel): void {
  const usuario = usuarios[chave]!;
  sessaoDaAcao.userId = usuario.id;
  sessaoDaAcao.userEmail = `conv-acao-${chave}-${sufixo}@teste.dev`;
  sessaoDaAcao.active = {
    clinicId,
    clinicName: "Clínica Convênio",
    slug: `conv-acao-${sufixo}`,
    timezone: "America/Fortaleza",
    role,
    status: "ativo",
  };
  clienteDaSessao = usuario.cliente;
}

function profissional(nome: string) {
  return {
    name: `${nome} ${crypto.randomUUID().slice(0, 4)}`,
    council_type: "CRM",
    council_number: "1234",
    specialties: ["Endocrinologia"],
    calendar_color: null,
    active: true,
  };
}

async function novoProcedimento(
  nome: string,
  duracao: number,
  precoBase: number | null,
): Promise<string> {
  return inserirId("procedure", {
    clinic_id: clinicaA,
    name: `${nome} ${sufixo} ${crypto.randomUUID().slice(0, 4)}`,
    default_duration_min: duracao,
    base_price_cents: precoBase,
    bookable_by_ai: true,
  });
}

function particular(
  professionalId: string,
  preco: number | null,
  duracao: number,
): Linha {
  return {
    professional_id: professionalId,
    insurance_id: null,
    price_cents: preco,
    covered_by_insurance: false,
    duration_min: duracao,
  };
}

function coberto(
  professionalId: string,
  insuranceId: string,
  duracao: number,
): Linha {
  return {
    professional_id: professionalId,
    insurance_id: insuranceId,
    price_cents: null,
    covered_by_insurance: true,
    duration_min: duracao,
  };
}

/** O que um modal do Procedimento recem aberto mandaria como abertura. */
async function abertura(
  procedureId: string,
  planos: string[],
  confirmar = false,
): Promise<Extras> {
  const [vinculos, cobrem] = await Promise.all([
    admin
      .from("service_link")
      .select("professional_id, insurance_id")
      .eq("procedure_id", procedureId)
      .eq("active", true)
      .throwOnError(),
    admin
      .from("procedure_insurance")
      .select("insurance_id")
      .eq("procedure_id", procedureId)
      .throwOnError(),
  ]);
  return {
    planos,
    vinculosNaAbertura: (vinculos.data ?? []) as Par[],
    planosNaAbertura: ((cobrem.data ?? []) as { insurance_id: string }[]).map(
      (p) => p.insurance_id,
    ),
    confirmar,
  };
}

/** Procedimento novo: nada na abertura. */
function novo(planos: string[]): Extras {
  return {
    planos,
    vinculosNaAbertura: [],
    planosNaAbertura: [],
    confirmar: false,
  };
}

async function paresDe(professionalId: string): Promise<string[]> {
  const { data } = await admin
    .from("professional_insurance")
    .select("insurance_id")
    .eq("professional_id", professionalId)
    .throwOnError();
  return ((data ?? []) as { insurance_id: string }[])
    .map((p) => p.insurance_id)
    .sort();
}

async function cobremDe(procedureId: string): Promise<string[]> {
  const { data } = await admin
    .from("procedure_insurance")
    .select("insurance_id")
    .eq("procedure_id", procedureId)
    .throwOnError();
  return ((data ?? []) as { insurance_id: string }[])
    .map((p) => p.insurance_id)
    .sort();
}

const porConvenio = (a: Oferta, b: Oferta) =>
  (a.insurance_id ?? "").localeCompare(b.insurance_id ?? "");

/**
 * O que a Agenda oferece para este profissional neste procedimento: os
 * vinculos ATIVOS, lidos pela sessao da recepcao (RLS de verdade).
 */
async function ofertaDe(
  procedureId: string,
  professionalId: string,
): Promise<Oferta[]> {
  const { data, error } = await usuarios["recepcao-a"]!.cliente.from(
    "service_link",
  )
    .select("insurance_id, price_cents, covered_by_insurance, duration_min")
    .eq("procedure_id", procedureId)
    .eq("professional_id", professionalId)
    .eq("active", true);
  expect(error).toBeNull();
  return ((data ?? []) as Oferta[]).sort(porConvenio);
}

function ofertas(...lista: Oferta[]): Oferta[] {
  return [...lista].sort(porConvenio);
}

const particularDe = (preco: number, duracao: number): Oferta => ({
  insurance_id: null,
  price_cents: preco,
  covered_by_insurance: false,
  duration_min: duracao,
});

const cobertoPor = (insuranceId: string, duracao: number): Oferta => ({
  insurance_id: insuranceId,
  price_cents: null,
  covered_by_insurance: true,
  duration_min: duracao,
});

async function vinculoDe(
  professionalId: string,
  procedureId: string,
  insuranceId: string | null,
): Promise<{
  id: string;
  active: boolean;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
} | null> {
  let consulta = admin
    .from("service_link")
    .select("id, active, price_cents, covered_by_insurance, duration_min")
    .eq("professional_id", professionalId)
    .eq("procedure_id", procedureId);
  consulta =
    insuranceId === null
      ? consulta.is("insurance_id", null)
      : consulta.eq("insurance_id", insuranceId);
  const { data } = await consulta.maybeSingle().throwOnError();
  return data as {
    id: string;
    active: boolean;
    price_cents: number | null;
    covered_by_insurance: boolean;
    duration_min: number;
  } | null;
}

/** Instante futuro em hora cheia UTC: dias a partir de agora. */
function instante(dias: number, horaUtc: number, minutos = 0): string {
  const base = new Date(Date.now() + dias * 86_400_000);
  base.setUTCHours(horaUtc, minutos, 0, 0);
  return base.toISOString();
}

async function novaConsulta(
  professionalId: string,
  serviceLinkId: string,
  inicio: string,
  minutos: number,
): Promise<string> {
  return inserirId("appointment", {
    clinic_id: clinicaA,
    contact_id: contatoA,
    professional_id: professionalId,
    service_link_id: serviceLinkId,
    starts_at: inicio,
    ends_at: new Date(Date.parse(inicio) + minutos * 60_000).toISOString(),
    status: "agendado",
    created_by: "usuario",
  });
}

/** Cria o profissional pela action, com os convenios que ele atende. */
async function criarPelaAcao(
  nome: string,
  convenios: string[],
): Promise<{ id: string; dados: ReturnType<typeof profissional> }> {
  const dados = profissional(nome);
  const resultado = await acoes.salvarProfissionalAction({
    ...dados,
    insurance_ids: convenios,
    insurance_ids_na_abertura: [],
  });
  expect(resultado.ok, resultado.error).toBe(true);
  return { id: resultado.id!, dados };
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("admin-b", clinicaB, "admin");

  unimed = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Unimed",
  });
  bradesco = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Bradesco Saúde",
  });
  amil = await inserirId("insurance", { clinic_id: clinicaA, name: "Amil" });
  sulamerica = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "SulAmérica",
    active: false,
  });
  convenioB = await inserirId("insurance", {
    clinic_id: clinicaB,
    name: "Convênio B",
  });
  contatoA = await inserirId("contact", {
    clinic_id: clinicaA,
    phone_e164: `+55849${String(Date.now()).slice(-8)}`,
    name: "Paciente Convênio",
  });

  vi.doMock("@/lib/auth/active-clinic", () => ({
    getSessionContext: async () => sessaoDaAcao,
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => clienteDaSessao,
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => undefined }));
  acoes = await import("@/app/(app)/cadastros/actions");
  agenda = await import("@/app/(app)/agenda/actions");
  catalogo = await import("@/lib/queries/catalogo");
});

afterAll(async () => {
  vi.doUnmock("@/lib/auth/active-clinic");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("next/cache");
  // As clinicas antes dos usuarios: a trilha (audit_log) aponta para eles.
  for (const clinicId of [clinicaA, clinicaB]) {
    if (clinicId) {
      await admin.from("clinic").delete().eq("id", clinicId);
    }
  }
  for (const usuario of Object.values(usuarios)) {
    await admin.auth.admin.deleteUser(usuario.id);
  }
});

describe("o aceite do Dr. João (spec 3.5), cadastrado pela action como a tela faz", () => {
  it("cenário 1, Nutrologia sem cobertura: Endocrinologia com Unimed e Bradesco, Nutrologia só particular", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const endo = await novoProcedimento("Endocrinologia", 40, 40000);
    const nutro = await novoProcedimento("Nutrologia", 60, 50000);

    // 1) O cadastro do medico diz quais convenios ele atende. Ele ainda nao
    // faz nada: os pares sao gravados e nenhum procedimento muda.
    const dadosDoJoao = profissional("Dr. João Pereira");
    const criado = await acoes.salvarProfissionalAction({
      ...dadosDoJoao,
      insurance_ids: [unimed, bradesco],
      insurance_ids_na_abertura: [],
    });
    expect(criado.ok, criado.error).toBe(true);
    const joao = criado.id!;
    expect(await paresDe(joao)).toEqual([unimed, bradesco].sort());
    expect(criado.convenios?.entram).toEqual(
      expect.arrayContaining([
        { insuranceId: unimed, procedureIds: [] },
        { insuranceId: bradesco, procedureIds: [] },
      ]),
    );
    expect(criado.convenios?.saem).toEqual([]);

    // 2) Endocrinologia: Unimed e Bradesco cobrem; o Joao entra com os dois
    // ja marcados (a pre-marcacao e da tela).
    const naEndo = await acoes.sincronizarVinculosDoProcedimentoAction(
      endo,
      [
        particular(joao, 40000, 40),
        coberto(joao, unimed, 40),
        coberto(joao, bradesco, 40),
      ],
      novo([unimed, bradesco]),
    );
    expect(naEndo.ok, naEndo.error).toBe(true);
    expect(naEndo.resumo).toMatchObject({ criados: 3, desativados: 0 });
    expect([...(naEndo.resumo?.planosEntram ?? [])].sort()).toEqual(
      [unimed, bradesco].sort(),
    );
    expect(await cobremDe(endo)).toEqual([unimed, bradesco].sort());

    // 3) Nutrologia: nenhum convenio cobre. So particular, R$ 500 / 60 min.
    const naNutro = await acoes.sincronizarVinculosDoProcedimentoAction(
      nutro,
      [particular(joao, 50000, 60)],
      novo([]),
    );
    expect(naNutro.ok, naNutro.error).toBe(true);
    expect(await cobremDe(nutro)).toEqual([]);

    // O aceite: o que a Agenda oferece do Joao em cada procedimento.
    expect(await ofertaDe(endo, joao)).toEqual(
      ofertas(
        particularDe(40000, 40),
        cobertoPor(unimed, 40),
        cobertoPor(bradesco, 40),
      ),
    );
    expect(await ofertaDe(nutro, joao)).toEqual([particularDe(50000, 60)]);

    // 4) A Amil passa a cobrir a Endocrinologia (o Joao ainda nao atende).
    const amilCobre = await acoes.sincronizarVinculosDoProcedimentoAction(
      endo,
      [
        particular(joao, 40000, 40),
        coberto(joao, unimed, 40),
        coberto(joao, bradesco, 40),
      ],
      await abertura(endo, [unimed, bradesco, amil]),
    );
    expect(amilCobre.ok, amilCobre.error).toBe(true);
    expect(amilCobre.resumo).toMatchObject({ criados: 0, desativados: 0 });

    // 5) Marcar a Amil no cadastro dele: entra SO onde ela cobre e ele faz
    // (Endocrinologia), como Coberto com a duracao do procedimento. A
    // Nutrologia, que nenhum convenio cobre, nao recebe nada.
    const comAmil = await acoes.salvarProfissionalAction({
      ...dadosDoJoao,
      id: joao,
      insurance_ids: [unimed, bradesco, amil],
      insurance_ids_na_abertura: [unimed, bradesco],
    });
    expect(comAmil.ok, comAmil.error).toBe(true);
    expect(comAmil.convenios).toEqual({
      entram: [{ insuranceId: amil, procedureIds: [endo] }],
      saem: [],
      deixaDeFazer: [],
      consultasFuturas: 0,
      primeiraConsulta: null,
    });
    expect(await ofertaDe(endo, joao)).toEqual(
      ofertas(
        particularDe(40000, 40),
        cobertoPor(unimed, 40),
        cobertoPor(bradesco, 40),
        cobertoPor(amil, 40),
      ),
    );
    expect(await ofertaDe(nutro, joao)).toEqual([particularDe(50000, 60)]);

    // A trilha do medico: criou, convenios ao criar, convenios e edicao.
    const { data: trilha } = await admin
      .from("audit_log")
      .select("action")
      .eq("clinic_id", clinicaA)
      .eq("entity", "professional")
      .eq("entity_id", joao)
      .throwOnError();
    expect(
      ((trilha ?? []) as { action: string }[]).map((t) => t.action).sort(),
    ).toEqual(
      [
        "criou",
        "editou",
        "editou_convenios_do_profissional",
        "editou_convenios_do_profissional",
      ].sort(),
    );
  });

  it("cenário 2, Nutrologia coberta pela Unimed: o João só particular nela, e a exceção fica", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const endo = await novoProcedimento("Endocrinologia", 40, 40000);
    const nutro = await novoProcedimento("Nutrologia", 60, 50000);
    const { id: joao, dados: dadosDoJoao } = await criarPelaAcao(
      "Dr. João Pereira",
      [unimed, bradesco],
    );
    const { id: ana } = await criarPelaAcao("Dra. Ana Costa", [unimed]);

    // Endocrinologia: Unimed com preco proprio (coparticipacao R$ 80 e 30
    // min, a excecao de preco e duracao) e Bradesco Coberto.
    const naEndo = await acoes.sincronizarVinculosDoProcedimentoAction(
      endo,
      [
        particular(joao, 40000, 40),
        {
          professional_id: joao,
          insurance_id: unimed,
          price_cents: 8000,
          covered_by_insurance: false,
          duration_min: 30,
        },
        coberto(joao, bradesco, 40),
      ],
      novo([unimed, bradesco]),
    );
    expect(naEndo.ok, naEndo.error).toBe(true);

    // Nutrologia: a Unimed cobre. A Ana atende por ela; o Joao, que tambem
    // atende a Unimed, fica SO particular aqui (a excecao, desmarcada no
    // Procedimento).
    const naNutro = await acoes.sincronizarVinculosDoProcedimentoAction(
      nutro,
      [
        particular(joao, 50000, 60),
        particular(ana, 50000, 60),
        coberto(ana, unimed, 60),
      ],
      novo([unimed]),
    );
    expect(naNutro.ok, naNutro.error).toBe(true);
    expect(await cobremDe(nutro)).toEqual([unimed]);

    // O aceite da spec 3.5, com a Nutrologia coberta.
    expect(await ofertaDe(endo, joao)).toEqual(
      ofertas(
        particularDe(40000, 40),
        {
          insurance_id: unimed,
          price_cents: 8000,
          covered_by_insurance: false,
          duration_min: 30,
        },
        cobertoPor(bradesco, 40),
      ),
    );
    expect(await ofertaDe(nutro, joao)).toEqual([particularDe(50000, 60)]);
    expect(await ofertaDe(nutro, ana)).toEqual(
      ofertas(particularDe(50000, 60), cobertoPor(unimed, 60)),
    );

    // Salvar o medico sem mexer nos convenios (sem insurance_ids) nao toca
    // nada.
    const soONome = await acoes.salvarProfissionalAction({
      ...dadosDoJoao,
      id: joao,
      name: `${dadosDoJoao.name} Filho`,
    });
    expect(soONome.ok, soONome.error).toBe(true);
    expect(soONome.convenios).toBeUndefined();
    expect(await paresDe(joao)).toEqual([unimed, bradesco].sort());

    // Tirar o Bradesco (convenio que nao e o da excecao): sai da
    // Endocrinologia; a Nutrologia continua so particular para ele.
    const semBradesco = await acoes.salvarProfissionalAction({
      ...dadosDoJoao,
      id: joao,
      insurance_ids: [unimed],
      insurance_ids_na_abertura: [unimed, bradesco],
    });
    expect(semBradesco.ok, semBradesco.error).toBe(true);
    expect(semBradesco.convenios).toMatchObject({
      entram: [],
      saem: [{ insuranceId: bradesco, procedureIds: [endo] }],
      deixaDeFazer: [],
    });
    expect(await ofertaDe(nutro, joao)).toEqual([particularDe(50000, 60)]);

    // Reabrir a Nutrologia e salvar do jeito que esta: a excecao fica.
    const deNovo = await acoes.sincronizarVinculosDoProcedimentoAction(
      nutro,
      [
        particular(joao, 50000, 60),
        particular(ana, 50000, 60),
        coberto(ana, unimed, 60),
      ],
      await abertura(nutro, [unimed]),
    );
    expect(deNovo.ok, deNovo.error).toBe(true);
    expect(deNovo.resumo).toMatchObject({ criados: 0, desativados: 0 });
    expect(await ofertaDe(nutro, joao)).toEqual([particularDe(50000, 60)]);

    // A excecao so some quando a Unimed SAI do medico e VOLTA: ao voltar,
    // ela entra onde cobre e ele faz. Na Endocrinologia o vinculo antigo e
    // REATIVADO com os valores gravados (D2: R$ 80 e 30 min, o mesmo id);
    // na Nutrologia nasce Coberto com a duracao do procedimento.
    const vinculoAntigo = await vinculoDe(joao, endo, unimed);
    const semUnimed = await acoes.salvarProfissionalAction({
      ...dadosDoJoao,
      id: joao,
      insurance_ids: [],
      insurance_ids_na_abertura: [unimed],
    });
    expect(semUnimed.ok, semUnimed.error).toBe(true);
    expect(semUnimed.convenios?.saem).toEqual([
      { insuranceId: unimed, procedureIds: [endo] },
    ]);
    expect((await vinculoDe(joao, endo, unimed))?.active).toBe(false);

    const comUnimed = await acoes.salvarProfissionalAction({
      ...dadosDoJoao,
      id: joao,
      insurance_ids: [unimed],
      insurance_ids_na_abertura: [],
    });
    expect(comUnimed.ok, comUnimed.error).toBe(true);
    expect(comUnimed.convenios?.entram).toHaveLength(1);
    expect(
      [...(comUnimed.convenios?.entram[0]?.procedureIds ?? [])].sort(),
    ).toEqual([endo, nutro].sort());
    expect(await vinculoDe(joao, endo, unimed)).toEqual({
      ...vinculoAntigo!,
      active: true,
    });
    expect(await ofertaDe(nutro, joao)).toEqual(
      ofertas(particularDe(50000, 60), cobertoPor(unimed, 60)),
    );
  });
});

describe("Convênios que atende: confirmação antes de gravar", () => {
  it("D4: consulta futura no convênio que sai volta o aviso e NADA é gravado; confirmado, grava e a consulta continua", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const proc = await novoProcedimento("Consulta", 40, 40000);
    const { id: carla, dados } = await criarPelaAcao("Dra. Carla", [unimed]);
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(carla, 40000, 40), coberto(carla, unimed, 40)],
          novo([unimed]),
        )
      ).ok,
    ).toBe(true);
    const vinculoUnimed = (await vinculoDe(carla, proc, unimed))!;
    const inicio = instante(3, 13);
    const consulta = await novaConsulta(carla, vinculoUnimed.id, inicio, 40);

    const pedido = await acoes.salvarProfissionalAction({
      ...dados,
      name: `${dados.name} Souza`,
      id: carla,
      insurance_ids: [],
      insurance_ids_na_abertura: [unimed],
    });
    expect(pedido).toMatchObject({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "convenios",
      consultas: 1,
      convenios: {
        saem: [{ insuranceId: unimed, procedureIds: [proc] }],
        deixaDeFazer: [],
        consultasFuturas: 1,
      },
    });
    expect(Date.parse(pedido.primeiraConsulta ?? "")).toBe(Date.parse(inicio));
    // Nada mudou: o par, o vinculo e o nome.
    expect(await paresDe(carla)).toEqual([unimed]);
    expect((await vinculoDe(carla, proc, unimed))?.active).toBe(true);
    const { data: nome } = await admin
      .from("professional")
      .select("name")
      .eq("id", carla)
      .single()
      .throwOnError();
    expect((nome as { name: string }).name).toBe(dados.name);

    const confirmado = await acoes.salvarProfissionalAction({
      ...dados,
      name: `${dados.name} Souza`,
      id: carla,
      insurance_ids: [],
      insurance_ids_na_abertura: [unimed],
      confirmar_convenios: true,
    });
    expect(confirmado.ok, confirmado.error).toBe(true);
    expect(confirmado.convenios?.consultasFuturas).toBe(1);
    expect(await paresDe(carla)).toEqual([]);
    expect((await vinculoDe(carla, proc, unimed))?.active).toBe(false);
    // A consulta continua marcada, no vinculo desativado.
    const { data: aConsulta } = await admin
      .from("appointment")
      .select("service_link_id, status")
      .eq("id", consulta)
      .single()
      .throwOnError();
    expect(aConsulta).toEqual({
      service_link_id: vinculoUnimed.id,
      status: "agendado",
    });
  });

  it("D3: quem só fazia o procedimento pela Unimed sai dele com confirmação, e marcar de novo não o traz de volta", async () => {
    agirComo("gestor-a", clinicaA, "gestor");
    const proc = await novoProcedimento("Retorno", 30, null);
    const { id: davi, dados } = await criarPelaAcao("Dr. Davi", [unimed]);
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [coberto(davi, unimed, 30)],
          novo([unimed]),
        )
      ).ok,
    ).toBe(true);

    const pedido = await acoes.salvarProfissionalAction({
      ...dados,
      id: davi,
      insurance_ids: [],
      insurance_ids_na_abertura: [unimed],
    });
    expect(pedido).toMatchObject({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "convenios",
      consultas: 0,
      convenios: { deixaDeFazer: [proc] },
    });
    expect(await ofertaDe(proc, davi)).toEqual([cobertoPor(unimed, 30)]);

    const confirmado = await acoes.salvarProfissionalAction({
      ...dados,
      id: davi,
      insurance_ids: [],
      insurance_ids_na_abertura: [unimed],
      confirmar_convenios: true,
    });
    expect(confirmado.ok, confirmado.error).toBe(true);
    expect(await ofertaDe(proc, davi)).toEqual([]);

    const deVolta = await acoes.salvarProfissionalAction({
      ...dados,
      id: davi,
      insurance_ids: [unimed],
      insurance_ids_na_abertura: [],
    });
    expect(deVolta.ok, deVolta.error).toBe(true);
    // Ele nao faz mais o procedimento: a Unimed fica so no cadastro.
    expect(deVolta.convenios?.entram).toEqual([
      { insuranceId: unimed, procedureIds: [] },
    ]);
    expect(await ofertaDe(proc, davi)).toEqual([]);
  });
});

describe("aba parada, convênio desativado e o que não muda nada", () => {
  it("D5 no médico: abertura velha recusa com code cadastro_mudou e nada é gravado; com a abertura atual, grava", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const { id: elisa, dados } = await criarPelaAcao("Dra. Elisa", [unimed]);
    // Outra aba ja tinha tirado a Unimed e posto o Bradesco.
    expect(
      (
        await acoes.salvarProfissionalAction({
          ...dados,
          id: elisa,
          insurance_ids: [bradesco],
          insurance_ids_na_abertura: [unimed],
        })
      ).ok,
    ).toBe(true);

    const parada = await acoes.salvarProfissionalAction({
      ...dados,
      name: `${dados.name} Lima`,
      id: elisa,
      insurance_ids: [unimed, amil],
      insurance_ids_na_abertura: [unimed],
    });
    expect(parada).toEqual({
      ok: false,
      code: "cadastro_mudou",
      error: ABA_PARADA,
    });
    expect(await paresDe(elisa)).toEqual([bradesco]);

    const atual = await acoes.salvarProfissionalAction({
      ...dados,
      id: elisa,
      insurance_ids: [bradesco, amil],
      insurance_ids_na_abertura: [bradesco],
    });
    expect(atual.ok, atual.error).toBe(true);
    expect(await paresDe(elisa)).toEqual([bradesco, amil].sort());
  });

  it("D5 no procedimento: vínculos da abertura velhos recusam com code cadastro_mudou", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const proc = await novoProcedimento("Avaliação", 30, 20000);
    const { id: fabio } = await criarPelaAcao("Dr. Fábio", [unimed]);
    const velha = await abertura(proc, [unimed]);
    // Outra aba incluiu o Fabio no meio.
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(fabio, 20000, 30)],
          await abertura(proc, []),
        )
      ).ok,
    ).toBe(true);

    const parada = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [coberto(fabio, unimed, 30)],
      velha,
    );
    expect(parada).toEqual({
      ok: false,
      code: "cadastro_mudou",
      error: ABA_PARADA,
    });
    expect(await ofertaDe(proc, fabio)).toEqual([particularDe(20000, 30)]);
  });

  it("convênio desativado não entra, pelo médico nem pelo procedimento; o ativo entra (anti falso positivo)", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const { id: gabi, dados } = await criarPelaAcao("Dra. Gabi", []);
    const pelaFicha = await acoes.salvarProfissionalAction({
      ...dados,
      id: gabi,
      insurance_ids: [sulamerica],
      insurance_ids_na_abertura: [],
    });
    expect(pelaFicha).toEqual({ ok: false, error: CONVENIO_DESATIVADO });
    expect(await paresDe(gabi)).toEqual([]);

    const proc = await novoProcedimento("Exame", 20, 15000);
    const peloProcedimento =
      await acoes.sincronizarVinculosDoProcedimentoAction(
        proc,
        [particular(gabi, 15000, 20)],
        novo([sulamerica]),
      );
    expect(peloProcedimento).toEqual({
      ok: false,
      error: CONVENIO_DESATIVADO,
    });
    expect(await cobremDe(proc)).toEqual([]);

    const ativo = await acoes.salvarProfissionalAction({
      ...dados,
      id: gabi,
      insurance_ids: [unimed],
      insurance_ids_na_abertura: [],
    });
    expect(ativo.ok, ativo.error).toBe(true);
  });

  it("linha de convênio que o profissional não atende: a frase do banco (23514) chega à tela", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const proc = await novoProcedimento("Consulta", 40, 40000);
    const { id: hugo } = await criarPelaAcao("Dr. Hugo", [unimed]);
    const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(hugo, 40000, 40), coberto(hugo, bradesco, 40)],
      novo([bradesco]),
    );
    expect(resultado).toEqual({
      ok: false,
      error:
        "Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve.",
    });
    expect(await ofertaDe(proc, hugo)).toEqual([]);
  });

  it("consulta futura num vínculo que sai do procedimento: aviso antes (motivo vinculos), confirmado grava", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const proc = await novoProcedimento("Consulta", 40, 40000);
    const { id: iara } = await criarPelaAcao("Dra. Iara", [unimed]);
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(iara, 40000, 40), coberto(iara, unimed, 40)],
          novo([unimed]),
        )
      ).ok,
    ).toBe(true);
    const vinculoUnimed = (await vinculoDe(iara, proc, unimed))!;
    const inicio = instante(4, 14);
    await novaConsulta(iara, vinculoUnimed.id, inicio, 40);

    // Tirar a cobertura da Unimed tira a linha dela.
    const pedido = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(iara, 40000, 40)],
      await abertura(proc, []),
    );
    expect(pedido).toMatchObject({
      ok: false,
      code: "consultas_no_periodo",
      motivo: "vinculos",
      consultas: 1,
      resumo: { desativados: 1, consultasFuturas: 1, planosSaem: [unimed] },
    });
    expect(Date.parse(pedido.primeiraConsulta ?? "")).toBe(Date.parse(inicio));
    expect(await cobremDe(proc)).toEqual([unimed]);
    expect((await vinculoDe(iara, proc, unimed))?.active).toBe(true);

    const confirmado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(iara, 40000, 40)],
      await abertura(proc, [], true),
    );
    expect(confirmado.ok, confirmado.error).toBe(true);
    expect(await cobremDe(proc)).toEqual([]);
    expect((await vinculoDe(iara, proc, unimed))?.active).toBe(false);
  });

  it("sem extras, a action continua no modo legado e não mexe nos convênios que cobrem", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const proc = await novoProcedimento("Consulta", 40, 40000);
    const { id: jonas } = await criarPelaAcao("Dr. Jonas", [unimed]);
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(jonas, 40000, 40), coberto(jonas, unimed, 40)],
          novo([unimed]),
        )
      ).ok,
    ).toBe(true);
    const legado = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(jonas, 42000, 40),
      coberto(jonas, unimed, 40),
    ]);
    expect(legado.ok, legado.error).toBe(true);
    expect(Object.keys(legado.resumo ?? {}).sort()).toEqual(
      [
        "atualizados",
        "consultasFuturas",
        "criados",
        "desativados",
        "reativados",
      ].sort(),
    );
    expect(await cobremDe(proc)).toEqual([unimed]);
  });
});

describe("papel e isolamento", () => {
  it("recepção e leitura não salvam convênios do médico nem do procedimento; nada muda", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const { id: lara, dados } = await criarPelaAcao("Dra. Lara", [unimed]);
    const proc = await novoProcedimento("Consulta", 40, 40000);

    for (const [chave, papel] of [
      ["recepcao-a", "recepcao"],
      ["leitura-a", "leitura"],
    ] as const) {
      agirComo(chave, clinicaA, papel);
      const doMedico = await acoes.salvarProfissionalAction({
        ...dados,
        id: lara,
        insurance_ids: [],
        insurance_ids_na_abertura: [unimed],
        confirmar_convenios: true,
      });
      expect(doMedico, papel).toEqual({
        ok: false,
        error: "Somente administradores e gestores alteram os cadastros.",
      });
      const doProcedimento =
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(lara, 40000, 40), coberto(lara, unimed, 40)],
          novo([unimed]),
        );
      expect(doProcedimento.ok, papel).toBe(false);
    }
    expect(await paresDe(lara)).toEqual([unimed]);
    expect(await cobremDe(proc)).toEqual([]);
  });

  it("a recepção LÊ a matriz da clínica dela; a clínica B não lê a da A", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const { id: mara } = await criarPelaAcao("Dra. Mara", [unimed, bradesco]);
    const proc = await novoProcedimento("Consulta", 40, 40000);
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(mara, 40000, 40)],
          novo([bradesco]),
        )
      ).ok,
    ).toBe(true);

    const daRecepcao = await catalogo.fetchMatrizDeConvenios(
      usuarios["recepcao-a"]!.cliente,
      clinicaA,
    );
    expect(
      daRecepcao.atendimentos
        .filter((p) => p.professional_id === mara)
        .map((p) => p.insurance_id)
        .sort(),
    ).toEqual([unimed, bradesco].sort());
    expect(
      daRecepcao.coberturas.filter((c) => c.procedure_id === proc),
    ).toEqual([{ procedure_id: proc, insurance_id: bradesco }]);

    const daOutraClinica = await catalogo.fetchMatrizDeConvenios(
      usuarios["admin-b"]!.cliente,
      clinicaA,
    );
    expect(daOutraClinica).toEqual({ atendimentos: [], coberturas: [] });
  });

  it("a clínica B não grava convênio no médico da A, nem a A usa convênio da B", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const { id: nina, dados } = await criarPelaAcao("Dra. Nina", [unimed]);

    const comConvenioB = await acoes.salvarProfissionalAction({
      ...dados,
      id: nina,
      insurance_ids: [unimed, convenioB],
      insurance_ids_na_abertura: [unimed],
    });
    expect(comConvenioB).toEqual({
      ok: false,
      error: "Um convênio escolhido não é desta clínica.",
    });

    agirComo("admin-b", clinicaB, "admin");
    const daB = await acoes.salvarProfissionalAction({
      ...dados,
      id: nina,
      insurance_ids: [],
      insurance_ids_na_abertura: [unimed],
      confirmar_convenios: true,
    });
    expect(daB).toEqual({ ok: false, error: "Profissional não encontrado." });
    expect(await paresDe(nina)).toEqual([unimed]);
  });
});

describe("D8: a Agenda não marca consulta nova em vínculo desativado", () => {
  it("o vínculo que saiu pelo cadastro do médico é recusado; o ativo marca (anti falso positivo)", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const proc = await novoProcedimento("Consulta", 40, 40000);
    const { id: otavio, dados } = await criarPelaAcao("Dr. Otávio", [unimed]);
    expect(
      (
        await acoes.sincronizarVinculosDoProcedimentoAction(
          proc,
          [particular(otavio, 40000, 40), coberto(otavio, unimed, 40)],
          novo([unimed]),
        )
      ).ok,
    ).toBe(true);
    const vinculoUnimed = (await vinculoDe(otavio, proc, unimed))!;
    const vinculoParticular = (await vinculoDe(otavio, proc, null))!;
    // A recepcao abriu o modal antes; o gestor tira a Unimed do medico.
    expect(
      (
        await acoes.salvarProfissionalAction({
          ...dados,
          id: otavio,
          insurance_ids: [],
          insurance_ids_na_abertura: [unimed],
        })
      ).ok,
    ).toBe(true);

    agirComo("recepcao-a", clinicaA, "recepcao");
    const pedido = {
      contact_id: contatoA,
      professional_id: otavio,
      unit_id: null,
      resource_id: null,
      starts_at: instante(5, 15),
      is_overbooking: false,
      send_confirmation: false,
      notes: null,
    };
    const recusada = await agenda.criarAgendamentoAction({
      ...pedido,
      service_link_id: vinculoUnimed.id,
    });
    expect(recusada).toEqual({
      ok: false,
      code: "sem_vinculo",
      error:
        "Este profissional não atende mais este procedimento por este convênio. A lista já foi atualizada: escolha de novo.",
    });
    const { data: nenhuma } = await admin
      .from("appointment")
      .select("id")
      .eq("service_link_id", vinculoUnimed.id)
      .throwOnError();
    expect(nenhuma).toEqual([]);

    const marcada = await agenda.criarAgendamentoAction({
      ...pedido,
      service_link_id: vinculoParticular.id,
    });
    expect(marcada.ok, marcada.error).toBe(true);
  });
});
