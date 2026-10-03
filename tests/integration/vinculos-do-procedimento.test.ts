import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { adminClient, anonClient } from "../rls/stack";

// "Quem faz e convenios" dentro do modal do Procedimento (decisao do dono em
// 29/09/2026; migration 20260929100000_vinculos_do_procedimento.sql), contra
// o banco REAL. A tela manda o estado desejado do procedimento inteiro e a
// RPC sincronizar_vinculos_do_procedimento (SECURITY INVOKER) cria, reativa e
// atualiza o que esta na lista e DESATIVA, sem apagar, o que saiu.
//
// Pela porta de producao: a Server Action sincronizarVinculosDoProcedimento
// Action roda de verdade, com getSessionContext e createClient dublados (fora
// do Next nao ha cookie) e um usuario REAL logado por senha, entao o JWT, a
// RLS e o papel sao os de verdade. A RPC tambem e chamada direto pela sessao,
// para provar que a trava vive no banco e nao so na action.
//
// Clinicas e_de_teste. Padrao da suite: toda negacao tem o caso positivo ao
// lado (anti falso positivo).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const SENHA = `VinculosProc!${sufixo}`;

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
  userName: "Vínculos",
  userEmail: "",
  memberships: [],
  active: null,
  isProductAdmin: false,
  vinculoIndisponivel: false,
};
let clienteDaSessao: SupabaseClient | null = null;

let acoes: typeof import("@/app/(app)/cadastros/actions");

let clinicaA = "";
let clinicaB = "";
const usuarios: Record<string, { id: string; cliente: SupabaseClient }> = {};

let joao = "";
let ana = "";
let profB = "";
let unimed = "";
let bradesco = "";
let convenioB = "";
let contatoA = "";

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `vinc-proc-${nome.toLowerCase()}-${sufixo}`,
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
  const email = `vinc-proc-${chave}-${sufixo}@teste.dev`;
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

/** A action passa a rodar como este usuario, nesta clinica, neste papel. */
function agirComo(chave: string, clinicId: string, role: Papel): void {
  const usuario = usuarios[chave]!;
  sessaoDaAcao.userId = usuario.id;
  sessaoDaAcao.userEmail = `vinc-proc-${chave}-${sufixo}@teste.dev`;
  sessaoDaAcao.active = {
    clinicId,
    clinicName: "Clínica Vínculos",
    slug: `vinc-proc-${sufixo}`,
    timezone: "America/Fortaleza",
    role,
    status: "ativo",
  };
  clienteDaSessao = usuario.cliente;
}

async function novoProcedimento(
  campos: Partial<{
    name: string;
    default_duration_min: number;
    base_price_cents: number | null;
    bookable_by_ai: boolean;
  }> = {},
): Promise<string> {
  return inserirId("procedure", {
    clinic_id: clinicaA,
    name: campos.name ?? `Consulta ${crypto.randomUUID().slice(0, 6)}`,
    default_duration_min: campos.default_duration_min ?? 40,
    base_price_cents: campos.base_price_cents ?? 40000,
    bookable_by_ai: campos.bookable_by_ai ?? true,
  });
}

type Linha = {
  professional_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
};

function particular(
  professionalId: string,
  priceCents: number | null,
  duracao = 40,
): Linha {
  return {
    professional_id: professionalId,
    insurance_id: null,
    price_cents: priceCents,
    covered_by_insurance: false,
    duration_min: duracao,
  };
}

function coberto(
  professionalId: string,
  insuranceId: string,
  duracao = 40,
): Linha {
  return {
    professional_id: professionalId,
    insurance_id: insuranceId,
    price_cents: null,
    covered_by_insurance: true,
    duration_min: duracao,
  };
}

type VinculoLido = {
  id: string;
  professional_id: string;
  insurance_id: string | null;
  price_cents: number | null;
  covered_by_insurance: boolean;
  duration_min: number;
  bookable_by_ai: boolean;
  active: boolean;
};

async function vinculosDo(procedureId: string): Promise<VinculoLido[]> {
  const { data } = await admin
    .from("service_link")
    .select(
      "id, professional_id, insurance_id, price_cents, covered_by_insurance, duration_min, bookable_by_ai, active",
    )
    .eq("procedure_id", procedureId)
    .throwOnError();
  return (data ?? []) as VinculoLido[];
}

function achar(
  vinculos: VinculoLido[],
  professionalId: string,
  insuranceId: string | null,
): VinculoLido | undefined {
  return vinculos.find(
    (v) =>
      v.professional_id === professionalId && v.insurance_id === insuranceId,
  );
}

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("admin-b", clinicaB, "admin");

  joao = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dr. João Pereira",
    specialties: ["Endocrinologia"],
  });
  ana = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dra. Ana Costa",
    specialties: ["Endocrinologia"],
  });
  profB = await inserirId("professional", {
    clinic_id: clinicaB,
    name: "Dr. B",
  });
  unimed = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Unimed",
  });
  bradesco = await inserirId("insurance", {
    clinic_id: clinicaA,
    name: "Bradesco Saúde",
  });
  convenioB = await inserirId("insurance", {
    clinic_id: clinicaB,
    name: "Convênio B",
  });
  contatoA = await inserirId("contact", {
    clinic_id: clinicaA,
    phone_e164: `+55849${String(Date.now()).slice(-8)}`,
    name: "Paciente Vínculos",
  });

  vi.doMock("@/lib/auth/active-clinic", () => ({
    getSessionContext: async () => sessaoDaAcao,
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => clienteDaSessao,
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => undefined }));
  acoes = await import("@/app/(app)/cadastros/actions");
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

describe("sincronizar os vínculos do procedimento (a Server Action de verdade)", () => {
  it("cria os vínculos e grava a trilha", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");

    const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [
        particular(joao, 40000),
        coberto(joao, unimed),
        particular(ana, 35000, 45),
      ],
    );
    expect(resultado.ok).toBe(true);
    expect(resultado.resumo).toEqual({
      criados: 3,
      reativados: 0,
      atualizados: 0,
      desativados: 0,
      consultasFuturas: 0,
    });

    const vinculos = await vinculosDo(proc);
    expect(vinculos).toHaveLength(3);
    expect(vinculos.every((v) => v.active && v.bookable_by_ai)).toBe(true);
    // "Coberto" e preco nulo com cobertura, nunca R$ 0,00.
    expect(achar(vinculos, joao, unimed)).toMatchObject({
      price_cents: null,
      covered_by_insurance: true,
    });
    expect(achar(vinculos, ana, null)).toMatchObject({
      price_cents: 35000,
      duration_min: 45,
    });

    const { data: trilha } = await admin
      .from("audit_log")
      .select("action, entity")
      .eq("clinic_id", clinicaA)
      .eq("entity_id", proc)
      .throwOnError();
    expect(trilha).toEqual([
      { action: "editou_vinculos_do_procedimento", entity: "procedure" },
    ]);

    // Mesma lista de novo: nada muda.
    const denovo = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
      coberto(joao, unimed),
      particular(ana, 35000, 45),
    ]);
    expect(denovo.resumo).toEqual({
      criados: 0,
      reativados: 0,
      atualizados: 0,
      desativados: 0,
      consultasFuturas: 0,
    });
  });

  it("gestor também grava (a mesma regra das outras ações de cadastro)", async () => {
    const proc = await novoProcedimento();
    agirComo("gestor-a", clinicaA, "gestor");
    const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(ana, 30000)],
    );
    expect(resultado.ok).toBe(true);
    expect(await vinculosDo(proc)).toHaveLength(1);
  });

  it("desativa sem apagar o vínculo que tem consulta, e avisa das consultas futuras", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
      coberto(joao, unimed),
    ]);
    const vinculoParticular = achar(await vinculosDo(proc), joao, null)!;

    const inicio = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const fim = new Date(inicio.getTime() + 40 * 60_000);
    const consulta = await inserirId("appointment", {
      clinic_id: clinicaA,
      contact_id: contatoA,
      professional_id: joao,
      service_link_id: vinculoParticular.id,
      starts_at: inicio.toISOString(),
      ends_at: fim.toISOString(),
      status: "agendado",
      created_by: "usuario",
    });

    // Joao deixa de atender Particular neste procedimento.
    const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [coberto(joao, unimed)],
    );
    expect(resultado.ok).toBe(true);
    expect(resultado.resumo).toMatchObject({
      desativados: 1,
      consultasFuturas: 1,
    });

    const depois = await vinculosDo(proc);
    expect(depois).toHaveLength(2);
    expect(achar(depois, joao, null)).toMatchObject({
      id: vinculoParticular.id,
      active: false,
    });
    const { data: aConsulta } = await admin
      .from("appointment")
      .select("service_link_id, status")
      .eq("id", consulta)
      .single()
      .throwOnError();
    expect(aConsulta).toEqual({
      service_link_id: vinculoParticular.id,
      status: "agendado",
    });

    // Tirar TODO mundo tambem nao apaga nada.
    const vazio = await acoes.sincronizarVinculosDoProcedimentoAction(proc, []);
    expect(vazio.resumo).toMatchObject({ desativados: 1 });
    const nada = await vinculosDo(proc);
    expect(nada).toHaveLength(2);
    expect(nada.every((v) => !v.active)).toBe(true);
  });

  it("reativa o mesmo vínculo (sem duplicar) com o preço novo", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
    ]);
    const original = achar(await vinculosDo(proc), joao, null)!;
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, []);

    const volta = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 42000, 50),
    ]);
    expect(volta.resumo).toMatchObject({ criados: 0, reativados: 1 });

    const vinculos = await vinculosDo(proc);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0]).toMatchObject({
      id: original.id,
      active: true,
      price_cents: 42000,
      duration_min: 50,
    });
  });

  it("o caso do Dr. João: no mesmo procedimento, ele aceita Unimed e a Dra. Ana não", async () => {
    const proc = await novoProcedimento({
      name: `Consulta endocrinologia ${sufixo}`,
    });
    agirComo("admin-a", clinicaA, "admin");
    const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [
        particular(joao, 40000),
        coberto(joao, unimed),
        coberto(joao, bradesco),
        particular(ana, 40000),
      ],
    );
    expect(resultado.ok).toBe(true);

    // O que o modal de agendamento pergunta: quem faz este procedimento
    // pela Unimed (vinculo ativo). A resposta e so o Joao.
    const pelaUnimed = await usuarios["recepcao-a"]!.cliente.from(
      "service_link",
    )
      .select("professional_id")
      .eq("procedure_id", proc)
      .eq("insurance_id", unimed)
      .eq("active", true);
    expect(pelaUnimed.error).toBeNull();
    expect(pelaUnimed.data?.map((v) => v.professional_id)).toEqual([joao]);

    // E pelo Particular, os dois (anti falso positivo).
    const peloParticular = await usuarios["recepcao-a"]!.cliente.from(
      "service_link",
    )
      .select("professional_id")
      .eq("procedure_id", proc)
      .is("insurance_id", null)
      .eq("active", true);
    expect(peloParticular.data?.map((v) => v.professional_id).sort()).toEqual(
      [joao, ana].sort(),
    );
  });

  it("a IA do vínculo segue a chave do procedimento", async () => {
    const proc = await novoProcedimento({ bookable_by_ai: false });
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
      coberto(joao, unimed),
    ]);
    expect((await vinculosDo(proc)).every((v) => !v.bookable_by_ai)).toBe(true);

    await admin
      .from("procedure")
      .update({ bookable_by_ai: true })
      .eq("id", proc)
      .throwOnError();
    const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), coberto(joao, unimed)],
    );
    expect(resultado.resumo).toMatchObject({ atualizados: 2 });
    expect((await vinculosDo(proc)).every((v) => v.bookable_by_ai)).toBe(true);
  });

  it("recusa linha inválida antes do banco", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    const repetido = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 1),
      particular(joao, 2),
    ]);
    expect(repetido.ok).toBe(false);
    const cobertoSemConvenio =
      await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
        { ...particular(joao, null), covered_by_insurance: true },
      ]);
    expect(cobertoSemConvenio.ok).toBe(false);
    const duracaoCurta = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 1, 2)],
    );
    expect(duracaoCurta.ok).toBe(false);
    expect(await vinculosDo(proc)).toHaveLength(0);
  });
});

describe("isolamento entre clínicas", () => {
  it("recusa profissional ou convênio de outra clínica e não muda nada", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
    ]);

    const comProfB = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(profB, 40000),
    ]);
    expect(comProfB).toMatchObject({
      ok: false,
      error: "Um profissional ou convênio escolhido não é desta clínica.",
    });
    const comConvB = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
      coberto(joao, convenioB),
    ]);
    expect(comConvB.ok).toBe(false);

    // A recusa volta a transacao inteira: o Particular do Joao continua ativo
    // (a lista com o profissional da B nao o tinha, e ele nao foi desativado).
    const vinculos = await vinculosDo(proc);
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0]).toMatchObject({ professional_id: joao, active: true });
  });

  it("administrador da clínica B não mexe no procedimento da A", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
    ]);

    // Pela RPC direta, com a sessao da B: o procedimento nao existe para ela.
    const { error } = await usuarios["admin-b"]!.cliente.rpc(
      "sincronizar_vinculos_do_procedimento",
      { p_procedure_id: proc, p_linhas: [] },
    );
    expect(error?.code).toBe("P0002");

    // Pela action, com a B ativa na sessao: mesma recusa.
    agirComo("admin-b", clinicaB, "admin");
    const pelaAcao = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [],
    );
    expect(pelaAcao.ok).toBe(false);

    const vinculos = await vinculosDo(proc);
    expect(vinculos.filter((v) => v.active)).toHaveLength(1);
  });
});

describe("papel: recepção e leitura não gravam", () => {
  it("a action recusa antes de chegar ao banco", async () => {
    const proc = await novoProcedimento();
    for (const [chave, papel] of [
      ["recepcao-a", "recepcao"],
      ["leitura-a", "leitura"],
    ] as const) {
      agirComo(chave, clinicaA, papel);
      const resultado = await acoes.sincronizarVinculosDoProcedimentoAction(
        proc,
        [particular(joao, 40000)],
      );
      expect(resultado).toMatchObject({
        ok: false,
        error: "Somente administradores e gestores alteram os cadastros.",
      });
    }
    expect(await vinculosDo(proc)).toHaveLength(0);
  });

  it("a RPC direta pela sessão também recusa (42501), e nada muda", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
    ]);

    for (const chave of ["recepcao-a", "leitura-a"]) {
      const { error } = await usuarios[chave]!.cliente.rpc(
        "sincronizar_vinculos_do_procedimento",
        { p_procedure_id: proc, p_linhas: [] },
      );
      expect(error?.code, chave).toBe("42501");
    }
    // A lista vazia teria desativado o Particular do Joao: continua ativo.
    const antes = await vinculosDo(proc);
    expect(antes).toHaveLength(1);
    expect(antes[0]!.active).toBe(true);

    // Anti falso positivo: o administrador, pela mesma porta, grava.
    const { error: doAdmin } = await usuarios["admin-a"]!.cliente.rpc(
      "sincronizar_vinculos_do_procedimento",
      {
        p_procedure_id: proc,
        p_linhas: [particular(joao, 40000), particular(ana, 30000)],
      },
    );
    expect(doAdmin).toBeNull();

    const vinculos = await vinculosDo(proc);
    expect(vinculos.filter((v) => v.active)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Com `extras` (convenio pelo medico, 02/10/2026; migration
// 20261002140000_convenio_pelo_medico.sql): o terceiro argumento da action
// leva a RPC ao modo novo, que grava tambem "Convenios que cobrem este
// procedimento" (procedure_insurance), recusa a aba parada e as regras da
// cobertura. Os casos acima (sem extras) provam que o modo legado continua
// identico. A action do lado do medico esta em
// tests/integration/convenio-pelo-medico.test.ts.
// ---------------------------------------------------------------------------

type ExtrasDoTeste = {
  planos: string[];
  vinculosNaAbertura: {
    professional_id: string;
    insurance_id: string | null;
  }[];
  planosNaAbertura: string[];
  confirmar: boolean;
};

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

/** O que um modal recem aberto mandaria: o banco de agora. */
async function aberturaDe(
  procedureId: string,
  planos: string[],
  confirmar = false,
): Promise<ExtrasDoTeste> {
  const vinculos = (await vinculosDo(procedureId)).filter((v) => v.active);
  return {
    planos,
    vinculosNaAbertura: vinculos.map((v) => ({
      professional_id: v.professional_id,
      insurance_id: v.insurance_id,
    })),
    planosNaAbertura: await cobremDe(procedureId),
    confirmar,
  };
}

describe("com extras: os convênios que cobrem este procedimento (modo novo)", () => {
  // No modo novo, a linha de convenio que ENTRA exige que o profissional o
  // atenda: o Joao atende Unimed e Bradesco; a Ana, so a Unimed.
  beforeAll(async () => {
    await admin
      .from("professional_insurance")
      .upsert(
        [
          { clinic_id: clinicaA, professional_id: joao, insurance_id: unimed },
          {
            clinic_id: clinicaA,
            professional_id: joao,
            insurance_id: bradesco,
          },
          { clinic_id: clinicaA, professional_id: ana, insurance_id: unimed },
        ],
        { onConflict: "professional_id,insurance_id", ignoreDuplicates: true },
      )
      .throwOnError();
  });

  it("grava procedure_insurance igual a planos, devolve o que entra e sai, e a trilha é a mesma", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");

    const criado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [
        particular(joao, 40000),
        coberto(joao, unimed),
        coberto(joao, bradesco),
        particular(ana, 40000),
        coberto(ana, unimed),
      ],
      {
        planos: [unimed, bradesco],
        vinculosNaAbertura: [],
        planosNaAbertura: [],
        confirmar: false,
      },
    );
    expect(criado.ok, criado.error).toBe(true);
    expect(criado.resumo).toMatchObject({
      criados: 5,
      desativados: 0,
      consultasFuturas: 0,
      primeiraConsulta: null,
      planosSaem: [],
    });
    expect([...(criado.resumo?.planosEntram ?? [])].sort()).toEqual(
      [unimed, bradesco].sort(),
    );
    expect(await cobremDe(proc)).toEqual([unimed, bradesco].sort());

    // O Bradesco deixa de cobrir: sai dele e da linha do Joao.
    const semBradesco = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [
        particular(joao, 40000),
        coberto(joao, unimed),
        particular(ana, 40000),
        coberto(ana, unimed),
      ],
      await aberturaDe(proc, [unimed]),
    );
    expect(semBradesco.ok, semBradesco.error).toBe(true);
    expect(semBradesco.resumo).toMatchObject({
      desativados: 1,
      planosEntram: [],
      planosSaem: [bradesco],
    });
    expect(await cobremDe(proc)).toEqual([unimed]);
    expect(achar(await vinculosDo(proc), joao, bradesco)?.active).toBe(false);

    const { data: trilha } = await admin
      .from("audit_log")
      .select("action")
      .eq("clinic_id", clinicaA)
      .eq("entity_id", proc)
      .throwOnError();
    expect(trilha).toEqual([
      { action: "editou_vinculos_do_procedimento" },
      { action: "editou_vinculos_do_procedimento" },
    ]);
  });

  it("o legado depois do modo novo não mexe nos convênios que cobrem", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), coberto(joao, unimed)],
      {
        planos: [unimed],
        vinculosNaAbertura: [],
        planosNaAbertura: [],
        confirmar: false,
      },
    );
    const legado = await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 45000),
      coberto(joao, unimed),
    ]);
    expect(legado.resumo).toEqual({
      criados: 0,
      reativados: 0,
      atualizados: 1,
      desativados: 0,
      consultasFuturas: 0,
    });
    expect(await cobremDe(proc)).toEqual([unimed]);
  });

  it("aba parada: code cadastro_mudou e nada muda; com a abertura de agora, grava", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000)],
      {
        planos: [],
        vinculosNaAbertura: [],
        planosNaAbertura: [],
        confirmar: false,
      },
    );
    const velha = await aberturaDe(proc, [unimed]);
    // Outra aba inclui a Ana no meio.
    await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), particular(ana, 40000)],
      await aberturaDe(proc, []),
    );

    const parada = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), coberto(joao, unimed)],
      velha,
    );
    expect(parada).toEqual({
      ok: false,
      code: "cadastro_mudou",
      error:
        "O cadastro mudou enquanto você editava. Feche, abra de novo e salve.",
    });
    // A Ana nao foi desativada e a Unimed nao entrou.
    expect(achar(await vinculosDo(proc), ana, null)?.active).toBe(true);
    expect(await cobremDe(proc)).toEqual([]);

    const atual = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), coberto(joao, unimed), particular(ana, 40000)],
      await aberturaDe(proc, [unimed]),
    );
    expect(atual.ok, atual.error).toBe(true);
    expect(await cobremDe(proc)).toEqual([unimed]);
  });

  it("convênio de linha fora dos que cobrem: a action recusa antes do banco, e a RPC direta recusa com 23514", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    const linhas = [particular(joao, 40000), coberto(joao, bradesco)];
    const pelaAcao = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      linhas,
      {
        planos: [unimed],
        vinculosNaAbertura: [],
        planosNaAbertura: [],
        confirmar: false,
      },
    );
    expect(pelaAcao).toEqual({
      ok: false,
      error:
        "Um convênio marcado para um profissional não está entre os convênios que cobrem este procedimento.",
    });

    const { error } = await usuarios["admin-a"]!.cliente.rpc(
      "sincronizar_vinculos_do_procedimento",
      {
        p_procedure_id: proc,
        p_linhas: linhas,
        p_planos: [unimed],
        p_vinculos_na_abertura: [],
        p_planos_na_abertura: [],
        p_confirmar: false,
      },
    );
    expect(error?.code).toBe("23514");
    expect(await vinculosDo(proc)).toHaveLength(0);
  });

  it("a cura: convênio desativado em uso num vínculo ativo passa e só ganha a cobertura; o desativado sem uso não entra", async () => {
    const proc = await novoProcedimento();
    agirComo("admin-a", clinicaA, "admin");
    const antigo = await inserirId("insurance", {
      clinic_id: clinicaA,
      name: `Convênio antigo ${sufixo}`,
    });
    const semUso = await inserirId("insurance", {
      clinic_id: clinicaA,
      name: `Convênio sem uso ${sufixo}`,
      active: false,
    });
    // Dado de antes da leva: o vinculo pelo modo legado (sem par, sem
    // cobertura), e depois o convenio e desativado.
    await acoes.sincronizarVinculosDoProcedimentoAction(proc, [
      particular(joao, 40000),
      coberto(joao, antigo),
    ]);
    await admin
      .from("insurance")
      .update({ active: false })
      .eq("id", antigo)
      .throwOnError();

    // A tela abre com o antigo marcado em "cobrem" (a cura) e salva.
    const curado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), coberto(joao, antigo)],
      await aberturaDe(proc, [antigo]),
    );
    expect(curado.ok, curado.error).toBe(true);
    expect(curado.resumo).toMatchObject({ planosEntram: [antigo] });
    expect(await cobremDe(proc)).toEqual([antigo]);
    expect(achar(await vinculosDo(proc), joao, antigo)?.active).toBe(true);

    // O desativado sem uso nenhum neste procedimento nao entra.
    const recusado = await acoes.sincronizarVinculosDoProcedimentoAction(
      proc,
      [particular(joao, 40000), coberto(joao, antigo)],
      await aberturaDe(proc, [antigo, semUso]),
    );
    expect(recusado).toEqual({
      ok: false,
      error: "Um convênio desativado não pode ser marcado.",
    });
    expect(await cobremDe(proc)).toEqual([antigo]);
  });
});
