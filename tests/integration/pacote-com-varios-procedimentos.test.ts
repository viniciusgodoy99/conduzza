import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { saldoDescontadoAoComparecer } from "@/lib/domain/appointment-status";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import { descontoDoPacote } from "@/lib/domain/pacotes";
import { fetchCatalogo } from "@/lib/queries/catalogo";
import {
  fetchFichaPaciente,
  fetchSaldosParaComparecimento,
} from "@/lib/queries/pacientes";

import { adminClient, anonClient } from "../rls/stack";

// Pacote com varios procedimentos (pedido do dono em 29/09/2026; migration
// 20260929120000_pacote_com_varios_procedimentos.sql), contra o banco REAL.
// O exemplo do dono: Botox 2 sessoes + Facelift 1 sessao. O cadastro mostra
// o preco avulso (calculado do preco base) ao lado do preco do pacote; a
// venda COPIA os itens para o saldo do paciente; o Compareceu desconta o
// item do procedimento da consulta (mesma regra de antes: dentro da
// validade, com saldo, do que vence primeiro); item de pacote vendido fica
// congelado; ajuste e cancelamento sao por item.
//
// Pela porta de producao: as Server Actions rodam de verdade, com
// getSessionContext e createClient dublados (fora do Next nao ha cookie) e
// usuarios REAIS logados por senha, entao o JWT, a RLS e o papel sao os de
// verdade. As RPCs tambem sao chamadas direto pela sessao, para provar que a
// trava vive no banco e nao so na action.
//
// Clinicas e_de_teste. Padrao da suite: toda negacao tem o caso positivo ao
// lado (anti falso positivo).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const SENHA = `PacoteVarios!${sufixo}`;
const FUSO = "America/Fortaleza";

const CHECK_VIOLATION = "23514";
const RLS_VIOLATION = "42501";
const NAO_ENCONTRADO = "P0002";

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
  userName: "Pacotes",
  userEmail: "",
  memberships: [],
  active: null,
  isProductAdmin: false,
  vinculoIndisponivel: false,
};
let clienteDaSessao: SupabaseClient | null = null;

let cadastros: typeof import("@/app/(app)/cadastros/actions");
let pacientes: typeof import("@/app/(app)/pacientes/actions");

let clinicaA = "";
let clinicaB = "";
const usuarios: Record<string, { id: string; cliente: SupabaseClient }> = {};

let profA = "";
let botox = "";
let facelift = "";
let outro = "";
let procB = "";
let vinculoBotox = "";
let vinculoFacelift = "";
let vinculoOutro = "";
let combo = "";
let botoxCurto = "";
let contatoB = "";

let slotSeguinte = 0;

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `pacote-varios-${nome.toLowerCase()}-${sufixo}`,
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
  const email = `pacote-varios-${chave}-${sufixo}@teste.dev`;
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
  sessaoDaAcao.userEmail = `pacote-varios-${chave}-${sufixo}@teste.dev`;
  sessaoDaAcao.active = {
    clinicId,
    clinicName: "Clínica Pacotes",
    slug: `pacote-varios-${sufixo}`,
    timezone: FUSO,
    role,
    status: "ativo",
  };
  clienteDaSessao = usuario.cliente;
}

function sessao(chave: string): SupabaseClient {
  return usuarios[chave]!.cliente;
}

async function novoContato(nome: string): Promise<string> {
  return inserirId("contact", {
    clinic_id: clinicaA,
    phone_e164: `+55849${String(Date.now() + slotSeguinte++).slice(-8)}`,
    name: nome,
    kind: "paciente",
  });
}

/** Consulta num horario que nenhuma outra deste arquivo usa. */
async function consultar(contactId: string, vinculo: string): Promise<string> {
  const inicio = Date.UTC(2026, 10, 10, 11, 0) + slotSeguinte++ * 3_600_000;
  return inserirId("appointment", {
    clinic_id: clinicaA,
    contact_id: contactId,
    professional_id: profA,
    service_link_id: vinculo,
    starts_at: new Date(inicio).toISOString(),
    ends_at: new Date(inicio + 30 * 60_000).toISOString(),
  });
}

async function marcarCompareceu(appointmentId: string): Promise<void> {
  await admin
    .from("appointment")
    .update({ status: "compareceu" })
    .eq("id", appointmentId)
    .throwOnError();
}

async function descontoDa(appointmentId: string): Promise<{
  package_balance_id: string | null;
  package_balance_item_id: string | null;
}> {
  const { data } = await admin
    .from("appointment")
    .select("package_balance_id, package_balance_item_id")
    .eq("id", appointmentId)
    .single()
    .throwOnError();
  return data as {
    package_balance_id: string | null;
    package_balance_item_id: string | null;
  };
}

type ItemLido = {
  id: string;
  procedure_id: string;
  sessions_total: number;
  sessions_used: number;
};

async function itensDaVenda(balanceId: string): Promise<ItemLido[]> {
  const { data } = await admin
    .from("package_balance_item")
    .select("id, procedure_id, sessions_total, sessions_used")
    .eq("package_balance_id", balanceId)
    .throwOnError();
  return (data ?? []) as ItemLido[];
}

function itemDe(itens: ItemLido[], procedureId: string): ItemLido {
  const item = itens.find((i) => i.procedure_id === procedureId);
  if (!item) {
    throw new Error("item do procedimento não encontrado na venda");
  }
  return item;
}

/** Vende pela action, como a recepcao, e devolve o id da venda. */
async function vender(
  contactId: string,
  packageId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  agirComo("recepcao-a", clinicaA, "recepcao");
  const resultado = await pacientes.venderPacoteAction({
    contact_id: contactId,
    package_id: packageId,
    ...extra,
  });
  expect(resultado).toEqual({ ok: true });
  const { data } = await admin
    .from("package_balance")
    .select("id")
    .eq("contact_id", contactId)
    .eq("package_id", packageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

const hoje = () => diaCivil(FUSO, new Date());

beforeAll(async () => {
  clinicaA = await criarClinica("A");
  clinicaB = await criarClinica("B");

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("admin-b", clinicaB, "admin");

  profA = await inserirId("professional", {
    clinic_id: clinicaA,
    name: "Dra. Pacotes",
  });
  botox = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Botox",
    default_duration_min: 30,
    base_price_cents: 100_000,
  });
  facelift = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Facelift",
    default_duration_min: 30,
    base_price_cents: 500_000,
  });
  outro = await inserirId("procedure", {
    clinic_id: clinicaA,
    name: "Limpeza de pele",
    default_duration_min: 30,
  });
  procB = await inserirId("procedure", {
    clinic_id: clinicaB,
    name: "Procedimento B",
    default_duration_min: 30,
  });
  const vincular = (procedimento: string) =>
    inserirId("service_link", {
      clinic_id: clinicaA,
      professional_id: profA,
      procedure_id: procedimento,
      duration_min: 30,
      price_cents: 10_000,
    });
  vinculoBotox = await vincular(botox);
  vinculoFacelift = await vincular(facelift);
  vinculoOutro = await vincular(outro);
  contatoB = await inserirId("contact", {
    clinic_id: clinicaB,
    phone_e164: `+55849${String(Date.now()).slice(-7)}9`,
    name: "Paciente B",
    kind: "paciente",
  });

  vi.doMock("@/lib/auth/active-clinic", () => ({
    getSessionContext: async () => sessaoDaAcao,
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => clienteDaSessao,
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => undefined }));
  cadastros = await import("@/app/(app)/cadastros/actions");
  pacientes = await import("@/app/(app)/pacientes/actions");
});

afterAll(async () => {
  vi.doUnmock("@/lib/auth/active-clinic");
  vi.doUnmock("@/lib/supabase/server");
  vi.doUnmock("next/cache");
  // As clinicas antes dos usuarios: a trilha (audit_log e o historico de
  // ajuste) aponta para eles.
  for (const clinicId of [clinicaA, clinicaB]) {
    if (clinicId) {
      await admin.from("clinic").delete().eq("id", clinicId);
    }
  }
  for (const usuario of Object.values(usuarios)) {
    await admin.auth.admin.deleteUser(usuario.id);
  }
});

describe("cadastro do pacote (salvarPacoteAction)", () => {
  it("cria o pacote com dois procedimentos, e o catálogo calcula o preço avulso", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const resultado = await cadastros.salvarPacoteAction({
      name: "Botox + Facelift",
      itens: [
        { procedure_id: botox, sessions: 2 },
        { procedure_id: facelift, sessions: 1 },
      ],
      price_cents: 560_000,
      validity_days: 90,
      active: true,
    });
    expect(resultado.ok).toBe(true);
    combo = resultado.id!;

    const { data: gravado } = await admin
      .from("package")
      .select(
        "name, price_cents, validity_days, active, procedure_id, sessions",
      )
      .eq("id", combo)
      .single()
      .throwOnError();
    // procedure_id e sessions sao legado: o codigo novo grava null.
    expect(gravado).toEqual({
      name: "Botox + Facelift",
      price_cents: 560_000,
      validity_days: 90,
      active: true,
      procedure_id: null,
      sessions: null,
    });

    const catalogo = await fetchCatalogo(sessao("admin-a"), clinicaA);
    const pacote = catalogo.pacotes.find((p) => p.id === combo)!;
    expect(
      pacote.itens.map(({ procedure_id, sessions }) => ({
        procedure_id,
        sessions,
      })),
    ).toEqual([
      { procedure_id: botox, sessions: 2 },
      { procedure_id: facelift, sessions: 1 },
    ]);
    // 2 x R$ 1.000 + 1 x R$ 5.000 = R$ 7.000 avulso; pacote R$ 5.600.
    expect(pacote.preco_avulso).toEqual({
      centavos: 700_000,
      itensSemPreco: 0,
    });
    expect(descontoDoPacote(pacote.price_cents, pacote.preco_avulso)).toEqual({
      centavos: 140_000,
      fracao: 0.2,
    });
  });

  it("procedimento sem preço base deixa o avulso incompleto, sem inventar desconto", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const resultado = await cadastros.salvarPacoteAction({
      name: "Botox + Limpeza",
      itens: [
        { procedure_id: botox, sessions: 1 },
        { procedure_id: outro, sessions: 3 },
      ],
      price_cents: 150_000,
      validity_days: null,
      active: true,
    });
    expect(resultado.ok).toBe(true);
    const catalogo = await fetchCatalogo(sessao("admin-a"), clinicaA);
    const pacote = catalogo.pacotes.find((p) => p.id === resultado.id)!;
    expect(pacote.preco_avulso).toEqual({
      centavos: 100_000,
      itensSemPreco: 1,
    });
    expect(
      descontoDoPacote(pacote.price_cents, pacote.preco_avulso),
    ).toBeNull();
  });

  it("recusa procedimento repetido e procedimento de outra clínica", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const repetido = await cadastros.salvarPacoteAction({
      name: "Repetido",
      itens: [
        { procedure_id: botox, sessions: 1 },
        { procedure_id: botox, sessions: 2 },
      ],
      price_cents: 1,
      validity_days: null,
      active: true,
    });
    expect(repetido).toEqual({
      ok: false,
      error: "O mesmo procedimento aparece duas vezes no pacote.",
    });
    // A mesma recusa mora no banco, sem a action na frente.
    const direto = await sessao("admin-a").rpc("salvar_pacote", {
      p_clinic_id: clinicaA,
      p_name: "Repetido",
      p_itens: [
        { procedure_id: botox, sessions: 1 },
        { procedure_id: botox, sessions: 2 },
      ],
      p_price_cents: 1,
      p_validity_days: null,
      p_active: true,
    });
    expect(direto.error?.code).toBe(CHECK_VIOLATION);

    const deFora = await cadastros.salvarPacoteAction({
      name: "Com procedimento da B",
      itens: [{ procedure_id: procB, sessions: 1 }],
      price_cents: 1,
      validity_days: null,
      active: true,
    });
    expect(deFora).toEqual({
      ok: false,
      error: "Um procedimento escolhido não é desta clínica.",
    });
    const { data } = await admin
      .from("package")
      .select("id")
      .eq("clinic_id", clinicaA)
      .in("name", ["Repetido", "Com procedimento da B"]);
    expect(data).toEqual([]);
  });

  it("recepção não salva pacote, nem pela action nem pela RPC", async () => {
    agirComo("recepcao-a", clinicaA, "recepcao");
    const pelaAction = await cadastros.salvarPacoteAction({
      name: "Da recepção",
      itens: [{ procedure_id: botox, sessions: 1 }],
      price_cents: 1,
      validity_days: null,
      active: true,
    });
    expect(pelaAction.ok).toBe(false);
    const pelaRpc = await sessao("recepcao-a").rpc("salvar_pacote", {
      p_clinic_id: clinicaA,
      p_name: "Da recepção",
      p_itens: [{ procedure_id: botox, sessions: 1 }],
      p_price_cents: 1,
      p_validity_days: null,
      p_active: true,
    });
    expect(pelaRpc.error?.code).toBe(RLS_VIOLATION);
  });

  it("admin da B não enxerga nem edita os itens da A", async () => {
    const daB = sessao("admin-b");
    const editar = await daB.rpc("salvar_pacote", {
      p_clinic_id: clinicaB,
      p_name: "Invasão",
      p_itens: [{ procedure_id: procB, sessions: 1 }],
      p_price_cents: 1,
      p_validity_days: null,
      p_active: true,
      p_package_id: combo,
    });
    expect(editar.error?.code).toBe(NAO_ENCONTRADO);
    const { data: itensDaA } = await daB
      .from("package_item")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(itensDaA).toEqual([]);

    // Anti falso positivo: a B cria e enxerga o proprio item.
    const proprio = await daB.rpc("salvar_pacote", {
      p_clinic_id: clinicaB,
      p_name: "Pacote B",
      p_itens: [{ procedure_id: procB, sessions: 3 }],
      p_price_cents: 30_000,
      p_validity_days: null,
      p_active: true,
    });
    expect(proprio.error).toBeNull();
    const { data: daPropria } = await daB
      .from("package_item")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(daPropria).toHaveLength(1);
    const venda = await daB.rpc("vender_pacote", {
      p_contact_id: contatoB,
      p_package_id: proprio.data as string,
    });
    expect(venda.error).toBeNull();
  });
});

describe("venda (venderPacoteAction)", () => {
  it("copia os itens do pacote para o saldo, com a validade no dia da clínica", async () => {
    const contato = await novoContato("Paciente Venda");
    const venda = await vender(contato, combo);

    const itens = await itensDaVenda(venda);
    expect(itemDe(itens, botox)).toMatchObject({
      sessions_total: 2,
      sessions_used: 0,
    });
    expect(itemDe(itens, facelift)).toMatchObject({
      sessions_total: 1,
      sessions_used: 0,
    });
    const { data } = await admin
      .from("package_balance")
      .select("expires_at")
      .eq("id", venda)
      .single()
      .throwOnError();
    expect((data as { expires_at: string }).expires_at).toBe(
      somarDias(hoje(), 90),
    );
  });

  it("em andamento: sessões já usadas por procedimento e a data de início", async () => {
    const contato = await novoContato("Paciente Em Andamento");
    const inicio = somarDias(hoje(), -10);
    const venda = await vender(contato, combo, {
      usadas: [{ procedure_id: botox, sessions_used: 1 }],
      inicio,
    });
    const itens = await itensDaVenda(venda);
    expect(itemDe(itens, botox).sessions_used).toBe(1);
    expect(itemDe(itens, facelift).sessions_used).toBe(0);
    const { data } = await admin
      .from("package_balance")
      .select("expires_at")
      .eq("id", venda)
      .single()
      .throwOnError();
    expect((data as { expires_at: string }).expires_at).toBe(
      somarDias(inicio, 90),
    );
  });

  it("recusa venda sem sessão sobrando e procedimento fora do pacote", async () => {
    const contato = await novoContato("Paciente Recusa");
    agirComo("recepcao-a", clinicaA, "recepcao");
    const tudoUsado = await pacientes.venderPacoteAction({
      contact_id: contato,
      package_id: combo,
      usadas: [
        { procedure_id: botox, sessions_used: 2 },
        { procedure_id: facelift, sessions_used: 1 },
      ],
    });
    expect(tudoUsado).toEqual({
      ok: false,
      error:
        "Com essas sessões já usadas não sobra nenhuma para descontar. Confira as sessões.",
    });
    const foraDoPacote = await pacientes.venderPacoteAction({
      contact_id: contato,
      package_id: combo,
      usadas: [{ procedure_id: outro, sessions_used: 1 }],
    });
    expect(foraDoPacote).toEqual({
      ok: false,
      error: "Um procedimento informado não faz parte deste pacote.",
    });
    const { data } = await admin
      .from("package_balance")
      .select("id")
      .eq("contact_id", contato);
    expect(data).toEqual([]);
  });

  it("leitura não vende, e a clínica B não vende o pacote da A", async () => {
    const contato = await novoContato("Paciente Sem Venda");
    agirComo("leitura-a", clinicaA, "leitura");
    const pelaAction = await pacientes.venderPacoteAction({
      contact_id: contato,
      package_id: combo,
    });
    expect(pelaAction.ok).toBe(false);
    const leitura = await sessao("leitura-a").rpc("vender_pacote", {
      p_contact_id: contato,
      p_package_id: combo,
    });
    expect(leitura.error?.code).toBe(RLS_VIOLATION);
    const daB = await sessao("admin-b").rpc("vender_pacote", {
      p_contact_id: contato,
      p_package_id: combo,
    });
    expect(daB.error?.code).toBe(NAO_ENCONTRADO);
    const { data } = await admin
      .from("package_balance")
      .select("id")
      .eq("contact_id", contato);
    expect(data).toEqual([]);
  });
});

describe("item de pacote vendido fica congelado", () => {
  it("os itens não mudam, mas nome, preço, validade e à venda mudam", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const mudarItens = await cadastros.salvarPacoteAction({
      id: combo,
      name: "Botox + Facelift",
      itens: [
        { procedure_id: botox, sessions: 3 },
        { procedure_id: facelift, sessions: 1 },
      ],
      price_cents: 560_000,
      validity_days: 90,
      active: true,
    });
    expect(mudarItens).toEqual({
      ok: false,
      error:
        "Este pacote já foi vendido. Os procedimentos e as sessões não mudam: para mudar, crie um pacote novo.",
    });

    const mesmosItens = await cadastros.salvarPacoteAction({
      id: combo,
      name: "Combo rosto",
      itens: [
        { procedure_id: facelift, sessions: 1 },
        { procedure_id: botox, sessions: 2 },
      ],
      price_cents: 540_000,
      validity_days: 90,
      active: true,
    });
    expect(mesmosItens).toEqual({ ok: true, id: combo });
    const { data } = await admin
      .from("package")
      .select("name, price_cents")
      .eq("id", combo)
      .single()
      .throwOnError();
    expect(data).toEqual({ name: "Combo rosto", price_cents: 540_000 });

    // Pela API direta o banco recusa do mesmo jeito.
    const direto = await sessao("admin-a")
      .from("package_item")
      .update({ sessions: 9 })
      .eq("package_id", combo)
      .eq("procedure_id", botox);
    expect(direto.error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("Compareceu desconta por item", () => {
  it("Botox desconta o item Botox, outro procedimento não desconta e o saldo acaba", async () => {
    const contato = await novoContato("Paciente Compareceu");
    const venda = await vender(contato, combo);
    const itens = await itensDaVenda(venda);

    // A tela preve o item antes de marcar (espelho do gatilho).
    const saldos = await fetchSaldosParaComparecimento(
      sessao("recepcao-a"),
      clinicaA,
      contato,
    );
    const previsto = saldoDescontadoAoComparecer(saldos, botox, hoje());
    expect(previsto?.id).toBe(itemDe(itens, botox).id);

    const consultaBotox = await consultar(contato, vinculoBotox);
    await marcarCompareceu(consultaBotox);
    expect(await descontoDa(consultaBotox)).toEqual({
      package_balance_id: venda,
      package_balance_item_id: itemDe(itens, botox).id,
    });

    const consultaOutra = await consultar(contato, vinculoOutro);
    await marcarCompareceu(consultaOutra);
    expect(await descontoDa(consultaOutra)).toEqual({
      package_balance_id: null,
      package_balance_item_id: null,
    });

    const face1 = await consultar(contato, vinculoFacelift);
    await marcarCompareceu(face1);
    expect((await descontoDa(face1)).package_balance_item_id).toBe(
      itemDe(itens, facelift).id,
    );
    // O Facelift acabou: a segunda e avulsa, e o Botox da venda nao cobre.
    const face2 = await consultar(contato, vinculoFacelift);
    await marcarCompareceu(face2);
    expect((await descontoDa(face2)).package_balance_item_id).toBeNull();

    const depois = await itensDaVenda(venda);
    expect(itemDe(depois, botox).sessions_used).toBe(1);
    expect(itemDe(depois, facelift).sessions_used).toBe(1);
  });

  it("dois pacotes com o mesmo procedimento: desconta o que vence primeiro", async () => {
    agirComo("admin-a", clinicaA, "admin");
    const curto = await cadastros.salvarPacoteAction({
      name: "Botox curto",
      itens: [{ procedure_id: botox, sessions: 5 }],
      price_cents: 400_000,
      validity_days: 30,
      active: true,
    });
    expect(curto.ok).toBe(true);
    botoxCurto = curto.id!;

    const contato = await novoContato("Paciente Dois Pacotes");
    await vender(contato, combo); // vence em 90 dias
    const vendaCurta = await vender(contato, botoxCurto); // vence em 30

    const saldos = await fetchSaldosParaComparecimento(
      sessao("recepcao-a"),
      clinicaA,
      contato,
    );
    expect(
      saldoDescontadoAoComparecer(saldos, botox, hoje())?.package_balance_id,
    ).toBe(vendaCurta);

    const consulta = await consultar(contato, vinculoBotox);
    await marcarCompareceu(consulta);
    expect((await descontoDa(consulta)).package_balance_id).toBe(vendaCurta);
  });
});

describe("ajuste e cancelamento por item", () => {
  it("o ajuste muda o item e a trilha guarda o item e o procedimento", async () => {
    const contato = await novoContato("Paciente Ajuste");
    const venda = await vender(contato, combo);
    const itens = await itensDaVenda(venda);
    const { data: validade } = await admin
      .from("package_balance")
      .select("expires_at")
      .eq("id", venda)
      .single()
      .throwOnError();
    const expiresAt = (validade as { expires_at: string | null }).expires_at;

    agirComo("recepcao-a", clinicaA, "recepcao");
    const ajuste = await pacientes.ajustarSaldoDePacoteAction({
      balance_id: venda,
      itens: [{ item_id: itemDe(itens, facelift).id, sessions_used: 1 }],
      expires_at: expiresAt,
      motivo: "Sessão feita antes do sistema",
    });
    expect(ajuste).toEqual({ ok: true });
    expect(itemDe(await itensDaVenda(venda), facelift).sessions_used).toBe(1);

    const { data: trilha } = await admin
      .from("package_balance_adjustment")
      .select(
        "kind, package_balance_item_id, procedure_id, sessions_total, sessions_used_before, sessions_used_after, user_id",
      )
      .eq("package_balance_id", venda)
      .throwOnError();
    expect(trilha).toEqual([
      {
        kind: "ajuste",
        package_balance_item_id: itemDe(itens, facelift).id,
        procedure_id: facelift,
        sessions_total: 1,
        sessions_used_before: 0,
        sessions_used_after: 1,
        user_id: usuarios["recepcao-a"]!.id,
      },
    ]);

    const nadaMudou = await pacientes.ajustarSaldoDePacoteAction({
      balance_id: venda,
      itens: [{ item_id: itemDe(itens, facelift).id, sessions_used: 1 }],
      expires_at: expiresAt,
      motivo: "Sem mudança",
    });
    expect(nadaMudou).toEqual({ ok: false, error: "Nada mudou no saldo." });

    const acima = await pacientes.ajustarSaldoDePacoteAction({
      balance_id: venda,
      itens: [{ item_id: itemDe(itens, botox).id, sessions_used: 3 }],
      expires_at: expiresAt,
      motivo: "Acima do total",
    });
    expect(acima.ok).toBe(false);

    // Leitura nao ajusta; a B nem enxerga a venda.
    const leitura = await sessao("leitura-a").rpc("ajustar_saldo_de_pacote", {
      p_balance_id: venda,
      p_itens: [{ item_id: itemDe(itens, botox).id, sessions_used: 1 }],
      p_expires_at: expiresAt,
      p_reason: "Leitura tentando",
    });
    expect(leitura.error?.code).toBe(NAO_ENCONTRADO);
    const daB = await sessao("admin-b").rpc("ajustar_saldo_de_pacote", {
      p_balance_id: venda,
      p_itens: [{ item_id: itemDe(itens, botox).id, sessions_used: 1 }],
      p_expires_at: expiresAt,
      p_reason: "Outra clínica",
    });
    expect(daB.error?.code).toBe(NAO_ENCONTRADO);
    expect(itemDe(await itensDaVenda(venda), botox).sessions_used).toBe(0);
  });

  it("venda que já descontou não se cancela; sem desconto, a gestão cancela e a trilha guarda cada procedimento", async () => {
    const contato = await novoContato("Paciente Cancelamento");
    const debitada = await vender(contato, combo);
    const consulta = await consultar(contato, vinculoFacelift);
    await marcarCompareceu(consulta);
    expect((await descontoDa(consulta)).package_balance_id).toBe(debitada);

    agirComo("admin-a", clinicaA, "admin");
    const recusada = await pacientes.cancelarVendaDePacoteAction({
      balance_id: debitada,
      motivo: "Tentando apagar o débito",
    });
    expect(recusada).toEqual({
      ok: false,
      error:
        "Esta venda já descontou sessão de consulta e não pode ser cancelada. Para corrigir, ajuste o saldo.",
    });

    const limpa = await vender(contato, combo);
    agirComo("recepcao-a", clinicaA, "recepcao");
    const pelaRecepcao = await pacientes.cancelarVendaDePacoteAction({
      balance_id: limpa,
      motivo: "Recepção tentando",
    });
    expect(pelaRecepcao.ok).toBe(false);

    agirComo("admin-a", clinicaA, "admin");
    const cancelada = await pacientes.cancelarVendaDePacoteAction({
      balance_id: limpa,
      motivo: "Vendido no paciente errado",
    });
    expect(cancelada).toEqual({ ok: true });
    expect(await itensDaVenda(limpa)).toEqual([]);
    const { data: trilha } = await admin
      .from("package_balance_adjustment")
      .select("kind, package_balance_id, procedure_id, sessions_total")
      .eq("contact_id", contato)
      .eq("kind", "cancelamento")
      .throwOnError();
    expect(
      ((trilha ?? []) as { procedure_id: string }[])
        .map((linha) => linha.procedure_id)
        .sort(),
    ).toEqual([botox, facelift].sort());
    expect(
      ((trilha ?? []) as { package_balance_id: string | null }[]).every(
        (linha) => linha.package_balance_id === null,
      ),
    ).toBe(true);
  });
});

describe("contagens e ficha somam pelos itens", () => {
  it("pacientes_resumo e a ficha contam igual, e a B não vê nada da A", async () => {
    const contato = await novoContato("Paciente Contagem");
    const venda = await vender(contato, combo);
    const consulta = await consultar(contato, vinculoBotox);
    await marcarCompareceu(consulta);

    // Combo: 3 sessoes vendidas (Botox 2 + Facelift 1), 1 usada: 2 livres.
    const { data, error } = await sessao("admin-a").rpc("pacientes_resumo", {
      p_clinic_id: clinicaA,
    });
    expect(error).toBeNull();
    const linha = (
      data as {
        contact_id: string;
        saldo_sessoes: number;
        saldo_total: number;
      }[]
    ).find((paciente) => paciente.contact_id === contato);
    expect(linha).toMatchObject({ saldo_sessoes: 2, saldo_total: 3 });

    const ficha = await fetchFichaPaciente(
      sessao("admin-a"),
      clinicaA,
      contato,
    );
    const saldo = ficha!.pacotes.find((p) => p.id === venda)!;
    expect(saldo.package_name).toBe("Combo rosto");
    expect(
      saldo.itens.map(({ procedure_name, sessions_total, sessions_used }) => ({
        procedure_name,
        sessions_total,
        sessions_used,
      })),
    ).toEqual([
      { procedure_name: "Botox", sessions_total: 2, sessions_used: 1 },
      { procedure_name: "Facelift", sessions_total: 1, sessions_used: 0 },
    ]);
    const consultaNaFicha = ficha!.consultas.find((c) => c.id === consulta)!;
    expect(consultaNaFicha.package_balance_id).toBe(venda);
    expect(consultaNaFicha.package_balance_item_id).toBe(
      saldo.itens.find((item) => item.procedure_name === "Botox")!.id,
    );

    const { data: uso } = await sessao("recepcao-a").rpc("uso_dos_pacotes", {
      p_clinic_id: clinicaA,
    });
    const usoDoCombo = (
      uso as {
        package_id: string;
        vendas: number;
        pacientes_com_saldo: number;
      }[]
    ).find((u) => u.package_id === combo);
    expect(usoDoCombo?.vendas).toBeGreaterThan(0);
    expect(usoDoCombo?.pacientes_com_saldo).toBeGreaterThan(0);

    const daB = sessao("admin-b");
    const resumoAlheio = await daB.rpc("pacientes_resumo", {
      p_clinic_id: clinicaA,
    });
    expect(resumoAlheio.data).toEqual([]);
    const usoAlheio = await daB.rpc("uso_dos_pacotes", {
      p_clinic_id: clinicaA,
    });
    expect(usoAlheio.data).toEqual([]);
    const { data: itensAlheios } = await daB
      .from("package_balance_item")
      .select("id")
      .eq("clinic_id", clinicaA);
    expect(itensAlheios).toEqual([]);
    // Anti falso positivo: a B enxerga o proprio item de saldo.
    const { data: itensProprios } = await daB
      .from("package_balance_item")
      .select("id")
      .eq("clinic_id", clinicaB);
    expect(itensProprios).toHaveLength(1);
  });
});

describe("código publicado antes da troca (modo expand)", () => {
  it("o caminho antigo cria o item, vende com item e ajusta pela assinatura antiga", async () => {
    // Pacote antigo: procedure_id + sessions, sem nome.
    const legado = await inserirId("package", {
      clinic_id: clinicaA,
      procedure_id: outro,
      sessions: 4,
      price_cents: 100_000,
    });
    const { data: pacote } = await admin
      .from("package")
      .select("name")
      .eq("id", legado)
      .single()
      .throwOnError();
    expect((pacote as { name: string }).name).toBe("Limpeza de pele");
    const { data: itemDoPacote } = await admin
      .from("package_item")
      .select("procedure_id, sessions")
      .eq("package_id", legado)
      .throwOnError();
    expect(itemDoPacote).toEqual([{ procedure_id: outro, sessions: 4 }]);

    // Venda antiga: INSERT direto com sessions_total e sessions_used.
    const contato = await novoContato("Paciente Legado");
    const { data: venda, error } = await sessao("recepcao-a")
      .from("package_balance")
      .insert({
        clinic_id: clinicaA,
        contact_id: contato,
        package_id: legado,
        sessions_total: 4,
        sessions_used: 1,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const vendaId = (venda as { id: string }).id;
    expect(await itensDaVenda(vendaId)).toMatchObject([
      { procedure_id: outro, sessions_total: 4, sessions_used: 1 },
    ]);

    // Ajuste pela assinatura antiga: venda de um procedimento so.
    const antigo = await sessao("recepcao-a").rpc("ajustar_saldo_de_pacote", {
      p_balance_id: vendaId,
      p_sessions_used: 2,
      p_expires_at: null,
      p_reason: "Pela tela antiga",
    });
    expect(antigo.error).toBeNull();
    expect((await itensDaVenda(vendaId))[0]?.sessions_used).toBe(2);
    // A soma legada acompanha, para a ficha antiga.
    const { data: legadoSaldo } = await admin
      .from("package_balance")
      .select("sessions_total, sessions_used")
      .eq("id", vendaId)
      .single()
      .throwOnError();
    expect(legadoSaldo).toEqual({ sessions_total: 4, sessions_used: 2 });

    // Venda de varios procedimentos pela assinatura antiga: recusa.
    const combinada = await vender(contato, combo);
    const recusa = await sessao("recepcao-a").rpc("ajustar_saldo_de_pacote", {
      p_balance_id: combinada,
      p_sessions_used: 1,
      p_expires_at: null,
      p_reason: "Pela tela antiga",
    });
    expect(recusa.error?.code).toBe(CHECK_VIOLATION);
  });
});
