import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, anonClient } from "../rls/stack";

// Convenio pelo medico (pedido do dono em 02/10/2026; migration
// 20261002140000_convenio_pelo_medico.sql), contra o banco REAL, pela RPC
// direta com a sessao de um usuario logado por senha (JWT, RLS e papel de
// verdade). A Server Action fica para tests/integration/convenio-pelo-medico
// .test.ts (parte 2).
//
//   sincronizar_convenios_do_profissional(p_professional_id, p_convenios,
//     p_convenios_na_abertura, p_confirmar): lado do medico, com cascata.
//   sincronizar_vinculos_do_procedimento(p_procedure_id, p_linhas, p_planos,
//     p_vinculos_na_abertura, p_planos_na_abertura, p_confirmar): lado do
//     procedimento; p_planos nulo = modo legado (identico ao de 29/09).
//
// O que se prova aqui: a cascata (entra so onde ele faz E o convenio cobre,
// como Coberto com duracao e IA do procedimento), a cura sem cascata, a
// excecao que fica, a reativacao com os valores gravados, deixa_de_fazer,
// aplicado:false sem gravar nada, consulta futura e primeira_consulta,
// convenio desativado (22023, menos o que ja estava em uso num vinculo ativo
// do procedimento, que a cura grava), aba parada (CZ409) dos dois lados, as regras
// do modo novo do procedimento (23514), a concorrencia (trava por clinica) e
// o modo legado com 2 argumentos. Mesmos cenarios do ensaio (scratchpad
// convenio/banco/asserts.sql).
//
// Clinicas e_de_teste. Padrao da suite: toda negacao tem o caso positivo ao
// lado (anti falso positivo).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const SENHA = `ConvenioRpc!${sufixo}`;
const ABA_PARADA =
  "O cadastro mudou enquanto você editava. Feche, abra de novo e salve.";
const CONVENIO_DESATIVADO = "Um convênio desativado não pode ser marcado.";

type Papel = "admin" | "gestor" | "recepcao" | "leitura";

type ResumoDoMedico = {
  aplicado: boolean;
  entram: { insurance_id: string; procedure_ids: string[] }[];
  saem: { insurance_id: string; procedure_ids: string[] }[];
  deixa_de_fazer: string[];
  consultas_futuras: number;
  primeira_consulta: string | null;
  vinculos_criados: number;
  vinculos_reativados: number;
  vinculos_desativados: number;
};

type ResumoDoProcedimento = {
  aplicado: boolean;
  criados: number;
  reativados: number;
  atualizados: number;
  desativados: number;
  consultas_futuras: number;
  primeira_consulta: string | null;
  planos_entram: string[];
  planos_saem: string[];
};

type Linha = {
  professional_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
};

type Par = { professional_id: string; insurance_id: string | null };

type VinculoLido = {
  id: string;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
  bookable_by_ai: boolean;
  active: boolean;
};

let clinicaA = "";
let clinicaB = "";
const sessoes: Record<string, { id: string; cliente: SupabaseClient }> = {};

let unimed = "";
let bradesco = "";
let sulamerica = "";
let contatoA = "";

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `conv-rpc-${nome.toLowerCase()}-${sufixo}`,
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
  const email = `conv-rpc-${chave}-${sufixo}@teste.dev`;
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
  sessoes[chave] = { id: data.user.id, cliente };
}

const como = (chave: string) => sessoes[chave]!.cliente;

async function novoProfissional(nome: string): Promise<string> {
  return inserirId("professional", { clinic_id: clinicaA, name: nome });
}

async function novoProcedimento(
  nome: string,
  duracao: number,
  precoBase: number | null = null,
): Promise<string> {
  return inserirId("procedure", {
    clinic_id: clinicaA,
    name: `${nome} ${crypto.randomUUID().slice(0, 4)}`,
    default_duration_min: duracao,
    base_price_cents: precoBase,
  });
}

function particular(
  profissional: string,
  preco: number,
  duracao: number,
): Linha {
  return {
    professional_id: profissional,
    insurance_id: null,
    price_cents: preco,
    covered_by_insurance: false,
    duration_min: duracao,
  };
}

function coberto(
  profissional: string,
  convenio: string,
  duracao: number,
): Linha {
  return {
    professional_id: profissional,
    insurance_id: convenio,
    price_cents: null,
    covered_by_insurance: true,
    duration_min: duracao,
  };
}

/** O que a tela leu na abertura do modal do Procedimento. */
async function vinculosAtivos(procedureId: string): Promise<Par[]> {
  const { data } = await admin
    .from("service_link")
    .select("professional_id, insurance_id")
    .eq("procedure_id", procedureId)
    .eq("active", true)
    .throwOnError();
  return (data ?? []) as Par[];
}

async function planosDe(procedureId: string): Promise<string[]> {
  const { data } = await admin
    .from("procedure_insurance")
    .select("insurance_id")
    .eq("procedure_id", procedureId)
    .throwOnError();
  return ((data ?? []) as { insurance_id: string }[])
    .map((p) => p.insurance_id)
    .sort();
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

async function vinculo(
  professionalId: string,
  procedureId: string,
  insuranceId: string | null,
): Promise<VinculoLido | null> {
  let consulta = admin
    .from("service_link")
    .select(
      "id, price_cents, covered_by_insurance, duration_min, bookable_by_ai, active",
    )
    .eq("professional_id", professionalId)
    .eq("procedure_id", procedureId);
  consulta =
    insuranceId === null
      ? consulta.is("insurance_id", null)
      : consulta.eq("insurance_id", insuranceId);
  const { data } = await consulta.maybeSingle().throwOnError();
  return (data as VinculoLido | null) ?? null;
}

async function ativosDe(
  professionalId: string,
  procedureId: string,
): Promise<number> {
  const { data } = await admin
    .from("service_link")
    .select("id")
    .eq("professional_id", professionalId)
    .eq("procedure_id", procedureId)
    .eq("active", true)
    .throwOnError();
  return (data ?? []).length;
}

/** Fotografia da clinica A: vinculos, pares e coberturas, sem RLS. */
async function foto(): Promise<string> {
  const [vinculos, pares, coberturas, consultas] = await Promise.all([
    admin
      .from("service_link")
      .select(
        "id, active, price_cents, covered_by_insurance, duration_min, bookable_by_ai",
      )
      .eq("clinic_id", clinicaA)
      .order("id")
      .throwOnError(),
    admin
      .from("professional_insurance")
      .select("professional_id, insurance_id")
      .eq("clinic_id", clinicaA)
      .order("professional_id")
      .order("insurance_id")
      .throwOnError(),
    admin
      .from("procedure_insurance")
      .select("procedure_id, insurance_id")
      .eq("clinic_id", clinicaA)
      .order("procedure_id")
      .order("insurance_id")
      .throwOnError(),
    admin
      .from("appointment")
      .select("id, status, service_link_id")
      .eq("clinic_id", clinicaA)
      .order("id")
      .throwOnError(),
  ]);
  return JSON.stringify([
    vinculos.data,
    pares.data,
    coberturas.data,
    consultas.data,
  ]);
}

/** Instante futuro (ou passado) em hora cheia UTC: dias a partir de agora. */
function instante(dias: number, horaUtc: number, minutos = 0): string {
  const base = new Date(Date.now() + dias * 86_400_000);
  base.setUTCHours(horaUtc, minutos, 0, 0);
  return base.toISOString();
}

async function novaConsulta(
  professionalId: string,
  serviceLinkId: string,
  inicio: string,
  fim: string,
  status = "agendado",
): Promise<string> {
  return inserirId("appointment", {
    clinic_id: clinicaA,
    contact_id: contatoA,
    professional_id: professionalId,
    service_link_id: serviceLinkId,
    starts_at: inicio,
    ends_at: fim,
    status,
  });
}

async function medico(
  sessao: string,
  professionalId: string,
  convenios: string[],
  naAbertura: string[] | null,
  confirmar = false,
) {
  const { data, error } = await como(sessao).rpc(
    "sincronizar_convenios_do_profissional",
    {
      p_professional_id: professionalId,
      p_convenios: convenios,
      p_convenios_na_abertura: naAbertura,
      p_confirmar: confirmar,
    },
  );
  return { resumo: (data ?? null) as ResumoDoMedico | null, error };
}

async function procedimento(
  sessao: string,
  procedureId: string,
  linhas: Linha[],
  planos: string[],
  abertura: { vinculos: Par[]; planos: string[] } | null,
  confirmar = false,
) {
  const { data, error } = await como(sessao).rpc(
    "sincronizar_vinculos_do_procedimento",
    {
      p_procedure_id: procedureId,
      p_linhas: linhas,
      p_planos: planos,
      p_vinculos_na_abertura: abertura?.vinculos ?? null,
      p_planos_na_abertura: abertura?.planos ?? null,
      p_confirmar: confirmar,
    },
  );
  return { resumo: (data ?? null) as ResumoDoProcedimento | null, error };
}

/** A abertura de agora (o que um modal recem aberto mandaria). */
async function aberturaDe(procedureId: string) {
  return {
    vinculos: await vinculosAtivos(procedureId),
    planos: await planosDe(procedureId),
  };
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
  sulamerica = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "SulAmérica",
    active: false,
  });
  contatoA = await inserirId("contact", {
    clinic_id: clinicaA,
    phone_e164: `+55849${String(Date.now()).slice(-8)}`,
    name: "Paciente Convênio",
  });
});

afterAll(async () => {
  // As clinicas antes dos usuarios: a trilha (audit_log) aponta para eles.
  for (const clinicId of [clinicaA, clinicaB]) {
    if (clinicId) {
      await admin.from("clinic").delete().eq("id", clinicId);
    }
  }
  for (const sessao of Object.values(sessoes)) {
    await admin.auth.admin.deleteUser(sessao.id);
  }
});

describe("aceite do Dr. João (spec 3.5): o cadastro do médico é o padrão", () => {
  let joao = "";
  let ana = "";
  let endocrino = "";
  let nutrologia = "";
  let botox = "";

  beforeAll(async () => {
    joao = await novoProfissional("Dr. João");
    ana = await novoProfissional("Dra. Ana");
    endocrino = await novoProcedimento("Endocrinologia", 40, 40000);
    nutrologia = await novoProcedimento("Nutrologia", 60, 50000);
    botox = await novoProcedimento("Botox", 30, 30000);
    // A chave da IA da Nutrologia desligada: o Coberto novo tem de segui-la.
    await admin
      .from("procedure")
      .update({ bookable_by_ai: false })
      .eq("id", nutrologia)
      .throwOnError();
    // Endocrinologia coberta por Unimed e Bradesco; Nutrologia e Botox por
    // nenhum. O Joao faz os tres pelo Particular.
    for (const [proc, linha, planos] of [
      [endocrino, particular(joao, 40000, 40), [unimed, bradesco]],
      [nutrologia, particular(joao, 50000, 60), []],
      [botox, particular(joao, 30000, 30), []],
    ] as const) {
      const { error } = await procedimento(
        "admin-a",
        proc,
        [linha],
        [...planos],
        { vinculos: [], planos: [] },
      );
      expect(error).toBeNull();
    }
  });

  it("cenário 1: Unimed e Bradesco no médico entram só na Endocrinologia, como Coberto de 40 min", async () => {
    const { resumo, error } = await medico(
      "admin-a",
      joao,
      [unimed, bradesco],
      [],
    );
    expect(error).toBeNull();
    expect(resumo).toEqual({
      aplicado: true,
      // Ordem pelo nome do convenio, depois pelo nome do procedimento.
      entram: [
        { insurance_id: bradesco, procedure_ids: [endocrino] },
        { insurance_id: unimed, procedure_ids: [endocrino] },
      ],
      saem: [],
      deixa_de_fazer: [],
      consultas_futuras: 0,
      primeira_consulta: null,
      vinculos_criados: 2,
      vinculos_reativados: 0,
      vinculos_desativados: 0,
    });

    for (const convenio of [unimed, bradesco]) {
      expect(await vinculo(joao, endocrino, convenio)).toMatchObject({
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 40,
        bookable_by_ai: true,
        active: true,
      });
    }
    expect(await vinculo(joao, endocrino, null)).toMatchObject({
      price_cents: 40000,
      duration_min: 40,
      active: true,
    });
    // Nutrologia R$ 500 / 60 min so particular; Botox sem cobertura.
    expect(await ativosDe(joao, nutrologia)).toBe(1);
    expect(await vinculo(joao, nutrologia, null)).toMatchObject({
      price_cents: 50000,
      duration_min: 60,
    });
    expect(await ativosDe(joao, botox)).toBe(1);
    expect(await paresDe(joao)).toEqual([unimed, bradesco].sort());

    // Repetir a chamada (mesma lista, com repeticao) nao muda nada.
    const antes = await foto();
    const repetida = await medico(
      "admin-a",
      joao,
      [bradesco, unimed, unimed],
      [unimed, bradesco],
    );
    expect(repetida.error).toBeNull();
    expect(repetida.resumo).toMatchObject({
      aplicado: true,
      entram: [],
      vinculos_criados: 0,
    });
    expect(await foto()).toBe(antes);
  });

  it("cenário 2: Nutrologia coberta pela Unimed (pela Dra. Ana), com a exceção do João, que fica", async () => {
    expect((await medico("admin-a", ana, [unimed], [])).error).toBeNull();
    // A tela pre-marca a Unimed para os dois; a recepcao desmarca a do Joao.
    const { resumo, error } = await procedimento(
      "admin-a",
      nutrologia,
      [
        particular(joao, 50000, 60),
        particular(ana, 52000, 60),
        coberto(ana, unimed, 60),
      ],
      [unimed],
      await aberturaDe(nutrologia),
    );
    expect(error).toBeNull();
    expect(resumo).toMatchObject({
      aplicado: true,
      criados: 2,
      planos_entram: [unimed],
      planos_saem: [],
    });
    expect(await planosDe(nutrologia)).toEqual([unimed]);
    expect(await ativosDe(joao, nutrologia)).toBe(1);
    expect((await vinculo(ana, nutrologia, unimed))?.active).toBe(true);

    // Salvar o cadastro do Joao de novo (com e sem confirmar) nao desfaz.
    const antes = await foto();
    for (const confirmar of [false, true]) {
      const salvo = await medico(
        "admin-a",
        joao,
        [unimed, bradesco],
        [unimed, bradesco],
        confirmar,
      );
      expect(salvo.error).toBeNull();
      expect(salvo.resumo?.entram).toEqual([]);
    }
    expect(await foto()).toBe(antes);
    expect(await ativosDe(joao, nutrologia)).toBe(1);
  });

  it("a reativação pelo médico volta com os valores gravados; a exceção só some quando o convênio sai e entra de novo", async () => {
    // Preco proprio na Unimed do Joao na Endocrinologia.
    const ajuste = await procedimento(
      "admin-a",
      endocrino,
      [
        particular(joao, 40000, 40),
        {
          ...coberto(joao, unimed, 45),
          price_cents: 8000,
          covered_by_insurance: false,
        },
        coberto(joao, bradesco, 40),
      ],
      [unimed, bradesco],
      await aberturaDe(endocrino),
    );
    expect(ajuste.resumo?.atualizados).toBe(1);

    const tirou = await medico("admin-a", joao, [bradesco], [unimed, bradesco]);
    expect(tirou.error).toBeNull();
    expect(tirou.resumo).toMatchObject({
      aplicado: true,
      saem: [{ insurance_id: unimed, procedure_ids: [endocrino] }],
      deixa_de_fazer: [],
      vinculos_desativados: 1,
    });
    // Desativado, nunca apagado.
    expect(await vinculo(joao, endocrino, unimed)).toMatchObject({
      active: false,
      price_cents: 8000,
    });
    expect(await paresDe(joao)).toEqual([bradesco]);

    await admin
      .from("procedure")
      .update({ bookable_by_ai: false })
      .eq("id", endocrino)
      .throwOnError();
    const voltou = await medico(
      "admin-a",
      joao,
      [unimed, bradesco],
      [bradesco],
    );
    expect(voltou.error).toBeNull();
    expect(voltou.resumo).toMatchObject({
      aplicado: true,
      entram: [
        { insurance_id: unimed, procedure_ids: [endocrino, nutrologia] },
      ],
      vinculos_reativados: 1,
      vinculos_criados: 1,
    });
    expect(await vinculo(joao, endocrino, unimed)).toMatchObject({
      active: true,
      price_cents: 8000,
      covered_by_insurance: false,
      duration_min: 45,
      bookable_by_ai: false,
    });
    expect(await vinculo(joao, nutrologia, unimed)).toMatchObject({
      active: true,
      price_cents: null,
      covered_by_insurance: true,
      duration_min: 60,
      bookable_by_ai: false,
    });
  });
});

describe("cura sem cascata", () => {
  it("o convênio que só existia num vínculo antigo ganha o par, sem se espalhar", async () => {
    const bia = await novoProfissional("Dra. Bia");
    const dermato = await novoProcedimento("Dermatologia", 30);
    const consulta = await novoProcedimento("Consulta", 40, 40000);
    for (const proc of [dermato, consulta]) {
      await inserirId("procedure_insurance", {
        clinic_id: clinicaA,
        procedure_id: proc,
        insurance_id: unimed,
      });
    }
    // Vinculo gravado como antes desta leva (sem o par do medico).
    await inserirId("service_link", {
      clinic_id: clinicaA,
      professional_id: bia,
      procedure_id: dermato,
      insurance_id: unimed,
      covered_by_insurance: true,
      duration_min: 30,
    });
    await inserirId("service_link", {
      clinic_id: clinicaA,
      professional_id: bia,
      procedure_id: consulta,
      price_cents: 40000,
      duration_min: 40,
    });

    // A tela curou na abertura (Unimed marcada) e salvou sem mexer.
    const { resumo, error } = await medico("admin-a", bia, [unimed], []);
    expect(error).toBeNull();
    expect(resumo).toMatchObject({
      aplicado: true,
      entram: [],
      vinculos_criados: 0,
    });
    expect(await paresDe(bia)).toEqual([unimed]);
    expect(await ativosDe(bia, consulta)).toBe(1);
    expect((await vinculo(bia, dermato, unimed))?.active).toBe(true);
  });
});

describe("deixa de fazer e aviso sem gravar nada", () => {
  it("quem só fazia o procedimento por um convênio sai dele com confirmação, e não volta sozinho", async () => {
    const caio = await novoProfissional("Dr. Caio");
    const dermato = await novoProcedimento("Dermatologia", 30);
    const novo = await medico("admin-a", caio, [unimed], []);
    // Medico novo: o par entra e nada mais acontece.
    expect(novo.resumo?.entram).toEqual([
      { insurance_id: unimed, procedure_ids: [] },
    ]);
    const entrada = await procedimento(
      "admin-a",
      dermato,
      [coberto(caio, unimed, 30)],
      [unimed],
      await aberturaDe(dermato),
    );
    expect(entrada.resumo?.criados).toBe(1);

    const antes = await foto();
    const aviso = await medico("admin-a", caio, [], [unimed]);
    expect(aviso.error).toBeNull();
    expect(aviso.resumo).toMatchObject({
      aplicado: false,
      deixa_de_fazer: [dermato],
      saem: [{ insurance_id: unimed, procedure_ids: [dermato] }],
      consultas_futuras: 0,
      vinculos_desativados: 0,
    });
    expect(await foto()).toBe(antes);

    const confirmado = await medico("admin-a", caio, [], [unimed], true);
    expect(confirmado.resumo).toMatchObject({
      aplicado: true,
      deixa_de_fazer: [dermato],
      vinculos_desativados: 1,
    });
    expect(await ativosDe(caio, dermato)).toBe(0);
    expect(await paresDe(caio)).toEqual([]);

    const marcouDeNovo = await medico("admin-a", caio, [unimed], []);
    expect(marcouDeNovo.resumo).toMatchObject({
      entram: [{ insurance_id: unimed, procedure_ids: [] }],
      vinculos_reativados: 0,
      vinculos_criados: 0,
    });
    expect(await ativosDe(caio, dermato)).toBe(0);
  });

  it("trocar Unimed por Bradesco onde os dois cobrem não pede confirmação", async () => {
    const duda = await novoProfissional("Dra. Duda");
    const dermato = await novoProcedimento("Dermatologia", 30);
    await medico("admin-a", duda, [unimed], []);
    await procedimento(
      "admin-a",
      dermato,
      [coberto(duda, unimed, 30)],
      [unimed, bradesco],
      await aberturaDe(dermato),
    );
    const troca = await medico("admin-a", duda, [bradesco], [unimed]);
    expect(troca.error).toBeNull();
    expect(troca.resumo).toMatchObject({
      aplicado: true,
      deixa_de_fazer: [],
      vinculos_criados: 1,
      vinculos_desativados: 1,
    });
    expect((await vinculo(duda, dermato, bradesco))?.active).toBe(true);
    expect((await vinculo(duda, dermato, unimed))?.active).toBe(false);
  });
});

describe("consulta futura: aviso antes de gravar, com a primeira consulta", () => {
  it("lado do médico: tirar o convênio com consultas marcadas", async () => {
    const joao = await novoProfissional("Dr. João Consultas");
    const endocrino = await novoProcedimento("Endocrinologia", 40, 40000);
    await procedimento(
      "admin-a",
      endocrino,
      [particular(joao, 40000, 40)],
      [bradesco],
      { vinculos: [], planos: [] },
    );
    await medico("admin-a", joao, [bradesco], []);
    const comBradesco = (await vinculo(joao, endocrino, bradesco))!;
    const primeira = instante(2, 13);
    const consulta1 = await novaConsulta(
      joao,
      comBradesco.id,
      primeira,
      instante(2, 13, 40),
    );
    const consulta2 = await novaConsulta(
      joao,
      comBradesco.id,
      instante(5, 13),
      instante(5, 13, 40),
    );
    await novaConsulta(
      joao,
      comBradesco.id,
      instante(1, 13),
      instante(1, 13, 40),
      "cancelado_clinica",
    );
    await novaConsulta(
      joao,
      comBradesco.id,
      instante(-3, 13),
      instante(-3, 13, 40),
    );

    const antes = await foto();
    const aviso = await medico("admin-a", joao, [], [bradesco]);
    expect(aviso.error).toBeNull();
    expect(aviso.resumo).toMatchObject({
      aplicado: false,
      consultas_futuras: 2,
      saem: [{ insurance_id: bradesco, procedure_ids: [endocrino] }],
      deixa_de_fazer: [],
    });
    expect(new Date(aviso.resumo!.primeira_consulta!).toISOString()).toBe(
      primeira,
    );
    expect(await foto()).toBe(antes);

    const confirmado = await medico("admin-a", joao, [], [bradesco], true);
    expect(confirmado.resumo).toMatchObject({
      aplicado: true,
      consultas_futuras: 2,
      vinculos_desativados: 1,
    });
    expect((await vinculo(joao, endocrino, bradesco))?.active).toBe(false);
    // As consultas continuam marcadas, no mesmo vinculo.
    const { data: consultas } = await admin
      .from("appointment")
      .select("status, service_link_id")
      .in("id", [consulta1, consulta2])
      .throwOnError();
    expect(consultas).toEqual([
      { status: "agendado", service_link_id: comBradesco.id },
      { status: "agendado", service_link_id: comBradesco.id },
    ]);
  });

  it("lado do procedimento: desmarcar com consulta marcada não grava nada sem confirmar", async () => {
    const ana = await novoProfissional("Dra. Ana Consultas");
    const nutrologia = await novoProcedimento("Nutrologia", 60, 50000);
    await medico("admin-a", ana, [unimed], []);
    await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60), coberto(ana, unimed, 60)],
      [unimed],
      { vinculos: [], planos: [] },
    );
    const comUnimed = (await vinculo(ana, nutrologia, unimed))!;
    const primeira = instante(4, 15);
    await novaConsulta(ana, comUnimed.id, primeira, instante(4, 16));

    const antes = await foto();
    const aviso = await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60)],
      [unimed, bradesco],
      await aberturaDe(nutrologia),
    );
    expect(aviso.error).toBeNull();
    expect(aviso.resumo).toMatchObject({
      aplicado: false,
      consultas_futuras: 1,
      desativados: 1,
      planos_entram: [bradesco],
    });
    expect(new Date(aviso.resumo!.primeira_consulta!).toISOString()).toBe(
      primeira,
    );
    expect(await foto()).toBe(antes);

    const confirmado = await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60)],
      [unimed],
      await aberturaDe(nutrologia),
      true,
    );
    expect(confirmado.resumo).toMatchObject({
      aplicado: true,
      desativados: 1,
      consultas_futuras: 1,
    });
    expect((await vinculo(ana, nutrologia, unimed))?.active).toBe(false);
  });
});

describe("convênio desativado não entra (22023)", () => {
  it("no médico, na cobertura e na linha nova; o que já estava marcado pode ficar", async () => {
    const novo = await novoProfissional("Dr. Novo");
    const checkup = await novoProcedimento("Check-up", 30);

    const doMedico = await medico("admin-a", novo, [sulamerica], []);
    expect(doMedico.error?.code).toBe("22023");
    expect(doMedico.error?.message).toBe(CONVENIO_DESATIVADO);
    const daCobertura = await procedimento(
      "admin-a",
      checkup,
      [],
      [sulamerica],
      null,
    );
    expect(daCobertura.error?.code).toBe("22023");

    // Marcado quando estava ativo, depois desativado.
    const amil = await inserirId("insurance", {
      clinic_id: clinicaA,
      name: "Amil",
    });
    expect((await medico("admin-a", novo, [amil], [])).error).toBeNull();
    await inserirId("procedure_insurance", {
      clinic_id: clinicaA,
      procedure_id: checkup,
      insurance_id: amil,
    });
    await admin
      .from("insurance")
      .update({ active: false })
      .eq("id", amil)
      .throwOnError();

    expect(
      (await medico("admin-a", novo, [amil], [amil])).resumo?.aplicado,
    ).toBe(true);
    const linhaNova = await procedimento(
      "admin-a",
      checkup,
      [coberto(novo, amil, 30)],
      [amil],
      null,
    );
    expect(linhaNova.error?.code).toBe("22023");
    const continuaCobrindo = await procedimento(
      "admin-a",
      checkup,
      [particular(novo, 1000, 30)],
      [amil],
      await aberturaDe(checkup),
    );
    expect(continuaCobrindo.error).toBeNull();
    expect(continuaCobrindo.resumo?.planos_saem).toEqual([]);

    expect((await medico("admin-a", novo, [], [amil])).resumo?.aplicado).toBe(
      true,
    );
    const deNovo = await medico("admin-a", novo, [amil], []);
    expect(deNovo.error?.code).toBe("22023");
  });

  it("o convênio em uso num vínculo ativo do procedimento conta como já marcado, mesmo desativado: a cura grava a cobertura", async () => {
    const drM = await novoProfissional("Dr. M Cura");
    const draN = await novoProfissional("Dra. N Cura");
    const proc = await novoProcedimento("Cura", 30);
    const amil2 = await inserirId("insurance", {
      clinic_id: clinicaA,
      name: "Amil Cura",
    });
    // O codigo publicado (modo legado, 2 argumentos) grava depois da carga
    // inicial: o vinculo fica ativo sem cobertura e sem o par do medico.
    const legado = await como("admin-a").rpc(
      "sincronizar_vinculos_do_procedimento",
      {
        p_procedure_id: proc,
        p_linhas: [coberto(drM, amil2, 30), particular(draN, 20000, 30)],
      },
    );
    expect(legado.error).toBeNull();
    expect(await planosDe(proc)).toEqual([]);
    expect(await paresDe(drM)).toEqual([]);
    // Depois a clinica desativa o convenio.
    await admin
      .from("insurance")
      .update({ active: false })
      .eq("id", amil2)
      .throwOnError();

    // A tela cura (a Amil vem marcada, do vinculo ativo) e a pessoa muda so
    // o preco da Dra. N. A abertura leva os planos crus: nenhum.
    const abertura = await aberturaDe(proc);
    expect(abertura.planos).toEqual([]);
    const linhas = [coberto(drM, amil2, 30), particular(draN, 25000, 30)];

    // Negativo ao lado: outro convenio desativado, sem vinculo no
    // procedimento, entrando como plano continua recusado.
    const inativoNovo = await inserirId("insurance", {
      clinic_id: clinicaA,
      name: "Bradesco Cura",
      active: false,
    });
    const recusado = await procedimento(
      "admin-a",
      proc,
      linhas,
      [amil2, inativoNovo],
      abertura,
    );
    expect(recusado.error?.code).toBe("22023");
    expect(recusado.error?.message).toBe(CONVENIO_DESATIVADO);

    const curado = await procedimento(
      "admin-a",
      proc,
      linhas,
      [amil2],
      abertura,
    );
    expect(curado.error).toBeNull();
    expect(curado.resumo).toMatchObject({
      aplicado: true,
      criados: 0,
      atualizados: 1,
      desativados: 0,
      planos_entram: [amil2],
      planos_saem: [],
    });
    expect(await planosDe(proc)).toEqual([amil2]);
    expect((await vinculo(drM, proc, amil2))?.active).toBe(true);
    expect((await vinculo(draN, proc, null))?.price_cents).toBe(25000);

    // Reabrir (agora com a cobertura gravada) e salvar: nada entra nem sai.
    const reaberto = await procedimento(
      "admin-a",
      proc,
      linhas,
      [amil2],
      await aberturaDe(proc),
    );
    expect(reaberto.error).toBeNull();
    expect(reaberto.resumo).toMatchObject({
      aplicado: true,
      planos_entram: [],
      planos_saem: [],
    });

    // Continua desmarcavel; desmarcado, nao volta (agora ele ENTRA de verdade).
    const desmarcou = await procedimento(
      "admin-a",
      proc,
      [particular(draN, 25000, 30)],
      [],
      await aberturaDe(proc),
    );
    expect(desmarcou.resumo).toMatchObject({
      aplicado: true,
      desativados: 1,
      planos_saem: [amil2],
    });
    const voltou = await procedimento(
      "admin-a",
      proc,
      linhas,
      [amil2],
      await aberturaDe(proc),
    );
    expect(voltou.error?.code).toBe("22023");
    expect(voltou.error?.message).toBe(CONVENIO_DESATIVADO);
  });
});

describe("aba parada: CZ409 dos dois lados", () => {
  it("médico: a lista mudou depois da abertura", async () => {
    const prof = await novoProfissional("Dra. Parada");
    await medico("admin-a", prof, [unimed], []);
    const parado = await medico("gestor-a", prof, [unimed, bradesco], []);
    expect(parado.error?.code).toBe("CZ409");
    expect(parado.error?.message).toBe(ABA_PARADA);
    expect(await paresDe(prof)).toEqual([unimed]);
    const atual = await medico("gestor-a", prof, [unimed, bradesco], [unimed]);
    expect(atual.error).toBeNull();
  });

  it("procedimento: o médico ganhou o convênio depois da abertura (sem a trava, o Salvar desativaria calado)", async () => {
    const ana = await novoProfissional("Dra. Ana Parada");
    const nutrologia = await novoProcedimento("Nutrologia", 60, 50000);
    await inserirId("procedure_insurance", {
      clinic_id: clinicaA,
      procedure_id: nutrologia,
      insurance_id: unimed,
    });
    await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60)],
      [unimed],
      { vinculos: [], planos: [unimed] },
    );
    const abertura = await aberturaDe(nutrologia);
    // Outra aba: a Ana passa a atender Unimed e entra na Nutrologia.
    const cascata = await medico("gestor-a", ana, [unimed], []);
    expect(cascata.resumo?.entram).toEqual([
      { insurance_id: unimed, procedure_ids: [nutrologia] },
    ]);

    const parado = await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60)],
      [unimed],
      abertura,
      true,
    );
    expect(parado.error?.code).toBe("CZ409");
    expect(parado.error?.message).toBe(ABA_PARADA);
    expect((await vinculo(ana, nutrologia, unimed))?.active).toBe(true);

    const planosParados = await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60), coberto(ana, unimed, 60)],
      [unimed],
      { vinculos: await vinculosAtivos(nutrologia), planos: [] },
    );
    expect(planosParados.error?.code).toBe("CZ409");

    const atual = await procedimento(
      "admin-a",
      nutrologia,
      [particular(ana, 50000, 60), coberto(ana, unimed, 60)],
      [unimed],
      await aberturaDe(nutrologia),
    );
    expect(atual.error).toBeNull();
    expect(atual.resumo?.aplicado).toBe(true);
  });
});

describe("regras do modo novo do procedimento", () => {
  it("convênio fora dos que cobrem, e linha nova de quem não atende, dão 23514; a linha antiga ativa passa", async () => {
    const joao = await novoProfissional("Dr. João Regras");
    const ana = await novoProfissional("Dra. Ana Regras");
    const endocrino = await novoProcedimento("Endocrinologia", 40, 40000);
    await medico("admin-a", joao, [unimed], []);

    const fora = await procedimento(
      "admin-a",
      endocrino,
      [particular(joao, 40000, 40), coberto(joao, unimed, 40)],
      [],
      null,
    );
    expect(fora.error?.code).toBe("23514");
    expect(fora.error?.message).toBe(
      "Um convênio marcado para um profissional não está entre os convênios que cobrem este procedimento.",
    );

    const naoAtende = await procedimento(
      "admin-a",
      endocrino,
      [particular(joao, 40000, 40), coberto(ana, bradesco, 40)],
      [unimed, bradesco],
      null,
    );
    expect(naoAtende.error?.code).toBe("23514");
    expect(naoAtende.error?.message).toBe(
      "Um profissional não atende um dos convênios marcados. Feche, abra de novo e salve.",
    );

    // Vinculo antigo (sem par) que ja estava ativo: tolerado.
    await inserirId("service_link", {
      clinic_id: clinicaA,
      professional_id: ana,
      procedure_id: endocrino,
      insurance_id: bradesco,
      covered_by_insurance: true,
      duration_min: 40,
    });
    const antigo = await procedimento(
      "admin-a",
      endocrino,
      [
        particular(joao, 40000, 40),
        coberto(joao, unimed, 40),
        coberto(ana, bradesco, 40),
      ],
      [unimed, bradesco],
      await aberturaDe(endocrino),
    );
    expect(antigo.error).toBeNull();
    expect(antigo.resumo).toMatchObject({
      aplicado: true,
      criados: 2,
      planos_entram: [unimed, bradesco].sort(),
    });
    expect(await planosDe(endocrino)).toEqual([unimed, bradesco].sort());

    // Tirar um convenio: a tela tira as linhas dele, o vinculo sai e a
    // cobertura sai.
    const tirou = await procedimento(
      "admin-a",
      endocrino,
      [particular(joao, 40000, 40), coberto(joao, unimed, 40)],
      [unimed],
      await aberturaDe(endocrino),
    );
    expect(tirou.resumo).toMatchObject({
      aplicado: true,
      desativados: 1,
      planos_saem: [bradesco],
    });
    expect(await planosDe(endocrino)).toEqual([unimed]);
  });

  it("recepção e leitura recebem 42501; a B recebe P0002", async () => {
    const prof = await novoProfissional("Dr. Papel");
    const proc = await novoProcedimento("Papel", 30);
    for (const sessao of ["recepcao-a", "leitura-a"]) {
      expect((await medico(sessao, prof, [], null)).error?.code).toBe("42501");
      expect((await procedimento(sessao, proc, [], [], null)).error?.code).toBe(
        "42501",
      );
    }
    expect((await medico("admin-b", prof, [], null)).error?.code).toBe("P0002");
    expect(
      (await procedimento("admin-b", proc, [], [], null)).error?.code,
    ).toBe("P0002");
    expect((await medico("gestor-a", prof, [], null)).error).toBeNull();
  });
});

describe("concorrência: a trava da clínica põe as gravações em fila", () => {
  it("dois Salvar do mesmo médico ao mesmo tempo: um cria, o outro não faz nada, sem 23505", async () => {
    const prof = await novoProfissional("Dr. Simultâneo");
    const proc = await novoProcedimento("Simultâneo", 30);
    await procedimento(
      "admin-a",
      proc,
      [particular(prof, 1000, 30)],
      [bradesco],
      { vinculos: [], planos: [] },
    );
    const [um, dois] = await Promise.all([
      medico("admin-a", prof, [bradesco], null),
      medico("gestor-a", prof, [bradesco], null),
    ]);
    expect(um.error).toBeNull();
    expect(dois.error).toBeNull();
    expect(
      (um.resumo?.vinculos_criados ?? 0) + (dois.resumo?.vinculos_criados ?? 0),
    ).toBe(1);
    const { data } = await admin
      .from("service_link")
      .select("id")
      .eq("professional_id", prof)
      .eq("procedure_id", proc)
      .eq("insurance_id", bradesco)
      .throwOnError();
    expect(data ?? []).toHaveLength(1);
    expect(await paresDe(prof)).toEqual([bradesco]);
  });

  it("médicos e procedimento ao mesmo tempo: sem erro, sem deadlock, e a invariante vale no fim", async () => {
    const joao = await novoProfissional("Dr. João Fila");
    const ana = await novoProfissional("Dra. Ana Fila");
    const proc = await novoProcedimento("Fila", 30);
    await procedimento(
      "admin-a",
      proc,
      [particular(joao, 1000, 30), particular(ana, 1000, 30)],
      [unimed],
      { vinculos: [], planos: [] },
    );
    const resultados = await Promise.all([
      medico("admin-a", joao, [unimed], null),
      medico("gestor-a", ana, [unimed], null),
      procedimento(
        "admin-a",
        proc,
        [particular(joao, 1000, 30), particular(ana, 1000, 30)],
        [unimed],
        null,
        true,
      ),
    ]);
    for (const resultado of resultados) {
      expect(resultado.error).toBeNull();
    }
    expect(await paresDe(joao)).toEqual([unimed]);
    expect(await paresDe(ana)).toEqual([unimed]);
    // Qualquer ordem em serie e valida; em todas, todo vinculo ativo de
    // convenio tem o par do medico e a cobertura do procedimento, e nenhum
    // vinculo aparece duas vezes.
    const { data } = await admin
      .from("service_link")
      .select("professional_id, insurance_id, active")
      .eq("procedure_id", proc)
      .throwOnError();
    const vinculos = (data ?? []) as {
      professional_id: string;
      insurance_id: string | null;
      active: boolean;
    }[];
    const chaves = vinculos.map(
      (v) => `${v.professional_id}:${v.insurance_id ?? ""}`,
    );
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(await planosDe(proc)).toEqual([unimed]);
    for (const v of vinculos.filter((x) => x.active && x.insurance_id)) {
      expect(await paresDe(v.professional_id)).toContain(v.insurance_id);
    }
  });
});

describe("modo legado: a chamada de 2 argumentos (código publicado) continua idêntica", () => {
  it("devolve as mesmas 5 chaves, não confere pares e não grava cobertura", async () => {
    const prof = await novoProfissional("Dr. Legado");
    const proc = await novoProcedimento("Legado", 40, 40000);
    const { data, error } = await como("admin-a").rpc(
      "sincronizar_vinculos_do_procedimento",
      {
        p_procedure_id: proc,
        p_linhas: [particular(prof, 40000, 40), coberto(prof, bradesco, 40)],
      },
    );
    expect(error).toBeNull();
    expect(data).toEqual({
      criados: 2,
      reativados: 0,
      atualizados: 0,
      desativados: 0,
      consultas_futuras: 0,
    });
    // O Dr. Legado nao atende Bradesco e o procedimento nao e coberto: o
    // legado nao confere (como antes desta leva) e nao grava pares.
    expect((await vinculo(prof, proc, bradesco))?.active).toBe(true);
    expect(await planosDe(proc)).toEqual([]);
    expect(await paresDe(prof)).toEqual([]);

    const { data: saiu } = await como("admin-a").rpc(
      "sincronizar_vinculos_do_procedimento",
      { p_procedure_id: proc, p_linhas: [particular(prof, 45000, 40)] },
    );
    expect(saiu).toEqual({
      criados: 0,
      reativados: 0,
      atualizados: 1,
      desativados: 1,
      consultas_futuras: 0,
    });

    // Parametro novo sem p_planos e engano de quem chama.
    const { error: semPlanos } = await como("admin-a").rpc(
      "sincronizar_vinculos_do_procedimento",
      {
        p_procedure_id: proc,
        p_linhas: [],
        p_vinculos_na_abertura: [],
      },
    );
    expect(semPlanos?.code).toBe("22023");
    expect(semPlanos?.message).toBe(
      "Informe os convênios que cobrem este procedimento.",
    );
  });
});
