import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarNumeroDeTeste } from "./numeros";
import { adminClient, anonClient } from "./stack";

// Fase 5.1/5.2: as RPCs de agregado por periodo (SECURITY INVOKER) e a
// linha de base de no-show. O que esta em jogo: isolamento entre clinicas
// nos agregados, a trava do papel profissional NO BANCO (agregado da
// clinica devolvido a um profissional seria numero enganoso: a RPC devolve
// null, nunca numeros parciais sem rotulo) e o append-only da linha de base
// (so admin insere, ninguem atualiza nem apaga).

const RLS_VIOLATION = "42501";

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "Relatorios!Rls2026";

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
const usuarios: string[] = [];

const JANELA = {
  p_de: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  // Uma hora no futuro: os contatos da fixture nascem DEPOIS deste modulo
  // carregar, e a janela semiaberta [de, ate) nao pode exclui-los.
  p_ate: new Date(Date.now() + 3_600_000).toISOString(),
};

async function criarUsuario(
  email: string,
  clinicId: string,
  role: string,
  professionalId?: string,
): Promise<string> {
  const { data } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: email.split("@")[0] },
  });
  usuarios.push(data.user!.id);
  await admin.from("clinic_member").insert({
    clinic_id: clinicId,
    user_id: data.user!.id,
    role,
    status: "ativo",
    ...(professionalId ? { professional_id: professionalId } : {}),
  });
  return data.user!.id;
}

async function logado(email: string) {
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${email}: ${error.message}`);
  }
  return cliente;
}

const email = (papel: string) => `relat-${papel}-${sufixo}@teste.dev`;

beforeAll(async () => {
  const { data: clinicas } = await admin
    .from("clinic")
    .insert([
      { name: `Relat A ${sufixo}`, slug: `relat-a-${sufixo}`, e_de_teste: true },
      { name: `Relat B ${sufixo}`, slug: `relat-b-${sufixo}`, e_de_teste: true },
    ])
    .select("id, slug")
    .throwOnError();
  clinicaA = clinicas!.find((c) => c.slug === `relat-a-${sufixo}`)!.id as string;
  clinicaB = clinicas!.find((c) => c.slug === `relat-b-${sufixo}`)!.id as string;

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicaA, name: "Dra. Propria" })
    .select("id")
    .single()
    .throwOnError();
  profissionalA = prof!.id as string;

  await criarUsuario(email("admin-a"), clinicaA, "admin");
  await criarUsuario(email("recepcao-a"), clinicaA, "recepcao");
  await criarUsuario(email("prof-a"), clinicaA, "profissional", profissionalA);
  await criarUsuario(email("gestor-b"), clinicaB, "gestor");

  // Contraprova do isolamento: cada clinica tem UM lead proprio.
  await admin
    .from("contact")
    .insert([
      { clinic_id: clinicaA, phone_e164: `+558498${sufixo.slice(0, 2)}0001` },
      { clinic_id: clinicaB, phone_e164: `+558498${sufixo.slice(0, 2)}0002` },
    ])
    .throwOnError();
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("agregados por período: isolamento entre clínicas", () => {
  it("admin da A vê os números da A", async () => {
    const cliente = await logado(email("admin-a"));
    const { data, error } = await cliente.rpc("funil_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(error).toBeNull();
    expect((data as { atual: { leads: number } }).atual.leads).toBe(1);
  });

  it("admin da A pedindo a B recebe zeros; gestor da B vê o dela (contraprova)", async () => {
    const clienteA = await logado(email("admin-a"));
    const { data: deA } = await clienteA.rpc("funil_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    // A RLS zera as linhas da B para quem e da A: nada vaza.
    expect((deA as { atual: { leads: number } }).atual.leads).toBe(0);

    const clienteB = await logado(email("gestor-b"));
    const { data: deB } = await clienteB.rpc("funil_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect((deB as { atual: { leads: number } }).atual.leads).toBe(1);
  });
});

describe("papel profissional: trava no banco", () => {
  it("agregados gerais devolvem null para o profissional, nunca números parciais", async () => {
    const cliente = await logado(email("prof-a"));
    const funil = await cliente.rpc("funil_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(funil.error).toBeNull();
    expect(funil.data).toBeNull();
    const atendimento = await cliente.rpc("atendimento_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(atendimento.data).toBeNull();
  });

  it("agenda só sai com o PRÓPRIO recorte; o de outro profissional é null", async () => {
    const cliente = await logado(email("prof-a"));
    const propria = await cliente.rpc("agenda_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
      p_professional_id: profissionalA,
    });
    expect(propria.error).toBeNull();
    expect(propria.data).not.toBeNull();

    const semRecorte = await cliente.rpc("agenda_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(semRecorte.data).toBeNull();

    const alheia = await cliente.rpc("agenda_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
      p_professional_id: crypto.randomUUID(),
    });
    expect(alheia.data).toBeNull();
  });
});

// O bloco "agente" de atendimento_do_periodo (migration 20261104120000). Escrito
// em 04/11/2026 com a migration NAO aplicada e NAO rodado: bate no banco de
// verdade e so passa depois dela (npm run test:rls -- relatorios).
describe("desempenho do agente: isolamento entre clínicas e papel", () => {
  type Corpo = { atual: { agente: Record<string, number | null> } };
  const ZERADO = {
    atendidas: 0,
    resolvidas_sem_humano: 0,
    transferidas: 0,
    insatisfacao: 0,
    primeira_resposta_mediana_segundos: null,
    agendamentos: 0,
  };

  beforeAll(async () => {
    // A atividade da IA so na B: respondeu em 60 s e passou para a equipe.
    await criarNumeroDeTeste(admin, clinicaB);
    const { data: contato } = await admin
      .from("contact")
      .select("id")
      .eq("clinic_id", clinicaB)
      .single()
      .throwOnError();
    const { data: conversa } = await admin
      .from("conversation")
      .insert({ clinic_id: clinicaB, contact_id: contato!.id })
      .select("id")
      .single()
      .throwOnError();
    const entrada = Date.now() - 2 * 86_400_000;
    await admin
      .from("message")
      .insert([
        {
          clinic_id: clinicaB,
          conversation_id: conversa!.id,
          direction: "entrada",
          author: "paciente",
          body: "Oi",
          created_at: new Date(entrada).toISOString(),
        },
        {
          clinic_id: clinicaB,
          conversation_id: conversa!.id,
          direction: "saida",
          author: "ia",
          body: "Olá!",
          delivery_status: "enviada",
          created_at: new Date(entrada + 60_000).toISOString(),
        },
      ])
      .throwOnError();
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicaB,
        conversation_id: conversa!.id,
        escalation_reason: "insatisfacao",
      })
      .throwOnError();
  });

  it("admin da A pedindo a B recebe o bloco zerado; gestor da B vê o dela (contraprova)", async () => {
    const clienteA = await logado(email("admin-a"));
    const deA = await clienteA.rpc("atendimento_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(deA.error).toBeNull();
    expect((deA.data as Corpo).atual.agente).toEqual(ZERADO);

    const clienteB = await logado(email("gestor-b"));
    const deB = await clienteB.rpc("atendimento_do_periodo", {
      p_clinic_id: clinicaB,
      ...JANELA,
    });
    expect(deB.error).toBeNull();
    expect((deB.data as Corpo).atual.agente).toEqual({
      atendidas: 1,
      resolvidas_sem_humano: 0,
      transferidas: 1,
      insatisfacao: 1,
      primeira_resposta_mediana_segundos: 60,
      agendamentos: 0,
    });
  });

  it("recepção e profissional: a recepção lê as decisões pelas colunas com grant; o profissional recebe null", async () => {
    const recepcao = await logado(email("recepcao-a"));
    const lida = await recepcao.rpc("atendimento_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(lida.error).toBeNull();
    expect((lida.data as Corpo).atual.agente).toEqual(ZERADO);

    const profissional = await logado(email("prof-a"));
    const nula = await profissional.rpc("atendimento_do_periodo", {
      p_clinic_id: clinicaA,
      ...JANELA,
    });
    expect(nula.error).toBeNull();
    expect(nula.data).toBeNull();
  });
});

describe("linha de base: só admin registra, ninguém reescreve", () => {
  it("admin registra em nome próprio; em nome de outro é recusado", async () => {
    const cliente = await logado(email("admin-a"));
    const { data: sessao } = await cliente.auth.getUser();
    const meuId = sessao.user!.id;

    const ok = await cliente.from("no_show_baseline").insert({
      clinic_id: clinicaA,
      rate_percent: 18,
      measured_from: "2026-08-01",
      measured_to: "2026-08-31",
      registered_by: meuId,
    });
    expect(ok.error).toBeNull();

    const emNomeDeOutro = await cliente.from("no_show_baseline").insert({
      clinic_id: clinicaA,
      rate_percent: 10,
      measured_from: "2026-08-01",
      measured_to: "2026-08-31",
      registered_by: crypto.randomUUID(),
    });
    expect(emNomeDeOutro.error?.code).toBe(RLS_VIOLATION);
  });

  it("recepção lê mas não registra; update e delete não existem nem para admin", async () => {
    const recepcao = await logado(email("recepcao-a"));
    const { data: sessao } = await recepcao.auth.getUser();
    const leitura = await recepcao
      .from("no_show_baseline")
      .select("rate_percent")
      .eq("clinic_id", clinicaA);
    expect(leitura.error).toBeNull();
    expect(leitura.data).toHaveLength(1);

    const escrita = await recepcao.from("no_show_baseline").insert({
      clinic_id: clinicaA,
      rate_percent: 12,
      measured_from: "2026-08-01",
      measured_to: "2026-08-31",
      registered_by: sessao.user!.id,
    });
    expect(escrita.error?.code).toBe(RLS_VIOLATION);

    const adminA = await logado(email("admin-a"));
    // Sem policy de UPDATE/DELETE o PostgREST devolve zero linhas afetadas:
    // a linha continua intacta (conferido pelo select do service role).
    await adminA
      .from("no_show_baseline")
      .update({ rate_percent: 1 })
      .eq("clinic_id", clinicaA);
    await adminA.from("no_show_baseline").delete().eq("clinic_id", clinicaA);
    const { data: intacta } = await admin
      .from("no_show_baseline")
      .select("rate_percent")
      .eq("clinic_id", clinicaA);
    expect(intacta).toHaveLength(1);
    expect(Number(intacta![0]!.rate_percent)).toBe(18);
  });

  it("gestor da B não lê a linha de base da A", async () => {
    const clienteB = await logado(email("gestor-b"));
    const { data } = await clienteB
      .from("no_show_baseline")
      .select("rate_percent")
      .eq("clinic_id", clinicaA);
    expect(data).toHaveLength(0);
  });
});
