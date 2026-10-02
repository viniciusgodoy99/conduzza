import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  diaCivil,
  instanteLocal,
  limitesDoDia,
  somarDias,
} from "@/lib/domain/horarios";

import { adminClient, anonClient } from "./stack";

// Fase 3, metricas (migration 20261002110000): as RPCs novas sao SECURITY
// INVOKER, entao a RLS recorta clinica e papel; o que esta em jogo aqui e
// quem recebe o que:
// - agregado da clinica (resumo_do_dia, funil_da_jornada,
//   serie_diaria_do_periodo) volta null para o profissional, nunca numero
//   parcial sem rotulo;
// - metricas_de_pacientes para o profissional e "na sua agenda" (a RLS de
//   appointment recorta);
// - valor em reais (faturamento_do_periodo inteiro, metricas_da_espera.
//   receita_cents e agenda_do_periodo.recuperadas.receita_cents) so para
//   admin e gestor; recepcao, leitura e profissional recebem null;
// - a clinica A nunca le numero da B (zeros, lista vazia ou null);
// - cadence_run.motivo_da_falha e lido pelo membro e nao e escrito pela
//   sessao.
// Toda negacao tem o caso positivo ao lado (anti falso positivo).

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);
const SENHA = "MetricasF3!Rls2026";
const TZ = "America/Fortaleza";

const hoje = diaCivil(TZ, new Date());
const local = (dia: string, hora: string) =>
  instanteLocal(TZ, dia, hora).toISOString();
const dia = (deslocamento: number) => somarDias(hoje, deslocamento);

let clinicaA = "";
let clinicaB = "";
let profissionalA = "";
let runComFalha = "";
const usuarios: string[] = [];

const email = (papel: string) => `metr-f3-${papel}-${sufixo}@teste.dev`;

async function criarUsuario(
  papelNoEmail: string,
  clinicId: string,
  role: string,
  professionalId?: string,
): Promise<void> {
  const { data } = await admin.auth.admin.createUser({
    email: email(papelNoEmail),
    password: SENHA,
    email_confirm: true,
    user_metadata: { name: papelNoEmail },
  });
  usuarios.push(data.user!.id);
  await admin
    .from("clinic_member")
    .insert({
      clinic_id: clinicId,
      user_id: data.user!.id,
      role,
      status: "ativo",
      ...(professionalId ? { professional_id: professionalId } : {}),
    })
    .throwOnError();
}

// Uma sessao por papel, reaproveitada: o arquivo pede 26 logins, e o Auth
// limita a taxa de login (o 26o caia com "Request rate limit reached").
const sessoes = new Map<string, ReturnType<typeof anonClient>>();

async function logado(papelNoEmail: string) {
  const pronta = sessoes.get(papelNoEmail);
  if (pronta) {
    return pronta;
  }
  const cliente = anonClient();
  const { error } = await cliente.auth.signInWithPassword({
    email: email(papelNoEmail),
    password: SENHA,
  });
  if (error) {
    throw new Error(`login ${papelNoEmail}: ${error.message}`);
  }
  sessoes.set(papelNoEmail, cliente);
  return cliente;
}

/** Os argumentos de resumo_do_dia como o TS do Inicio monta. */
function argsDoResumo(clinicId: string) {
  return {
    p_clinic_id: clinicId,
    p_inicios: [6, 5, 4, 3, 2, 1, 0].map((k) =>
      limitesDoDia(TZ, dia(-k)).inicio.toISOString(),
    ),
    p_fim: limitesDoDia(TZ, hoje).fim.toISOString(),
    p_semana_passada_de: limitesDoDia(TZ, dia(-7)).inicio.toISOString(),
    p_semana_passada_ate: limitesDoDia(TZ, dia(-7)).fim.toISOString(),
  };
}

const PERIODO = {
  p_de: local(dia(-30), "00:00"),
  p_ate: local(dia(1), "00:00"),
};
const PERIODO_DA_AGENDA = {
  p_de: local(dia(-30), "00:00"),
  p_ate: local(dia(60), "00:00"),
};

type ResumoDoDia = {
  hoje: { total: number; confirmadas: number };
  ultimo_disparo: string | null;
};
type Etapa = { chave: string; total: number };
type MetricasDePacientes = { ativos: number };
type MetricasDaEspera = {
  vagas_oferecidas: number;
  vagas_preenchidas: number;
  receita_cents: number | null;
};
type Faturamento = { atual: { valor_cents: number; comparecimentos: number } };
type Agenda = {
  atual: { recuperadas: { total: number; receita_cents: number | null } };
};

async function montarClinica(
  nome: string,
  preco: number,
  telefone: string,
): Promise<{
  clinicId: string;
  profissional: string;
  vinculo: string;
  contato: string;
}> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `${nome} ${sufixo}`,
      slug: `metr-f3-${nome.toLowerCase()}-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: `Dra. ${nome}` })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Avaliação", base_price_cents: 20000 })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      price_cents: preco,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: contato } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone })
    .select("id")
    .single()
    .throwOnError();
  const consulta = (
    inicio: string,
    status: string,
    canal: string | null = null,
  ) => ({
    clinic_id: clinicId,
    contact_id: contato!.id,
    professional_id: prof!.id,
    service_link_id: vinculo!.id,
    starts_at: inicio,
    ends_at: new Date(new Date(inicio).getTime() + 60_000).toISOString(),
    status,
    confirmation_channel: canal,
  });
  // Uma consulta hoje (confirmada) e um comparecimento ha 10 dias.
  await admin
    .from("appointment")
    .insert([
      consulta(local(hoje, "12:00"), "confirmado_paciente", "whatsapp"),
      consulta(local(dia(-10), "09:00"), "compareceu"),
    ])
    .throwOnError();
  // Uma vaga da lista de espera preenchida neste mes, pelo vinculo com preco.
  const { data: vaga } = await admin
    .from("appointment")
    .insert([
      consulta(local(dia(30), "08:00"), "cancelado_clinica"),
      consulta(local(dia(31), "10:00"), "agendado"),
    ])
    .select("id, status")
    .throwOnError();
  const origem = vaga!.find((v) => v.status === "cancelado_clinica")!
    .id as string;
  const nova = vaga!.find((v) => v.status === "agendado")!.id as string;
  await admin
    .from("waitlist_offer")
    .insert({
      clinic_id: clinicId,
      source_appointment_id: origem,
      professional_id: prof!.id,
      slot_starts_at: local(dia(31), "10:00"),
      slot_ends_at: local(dia(31), "10:01"),
      offered_to: [contato!.id],
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: "preenchida",
      responded_by: contato!.id,
      responded_at: new Date().toISOString(),
      appointment_id: nova,
    })
    .throwOnError();
  return {
    clinicId,
    profissional: prof!.id as string,
    vinculo: vinculo!.id as string,
    contato: contato!.id as string,
  };
}

beforeAll(async () => {
  const a = await montarClinica("A", 15000, "+5584970030001");
  const b = await montarClinica("B", 50000, "+5584970030002");
  clinicaA = a.clinicId;
  clinicaB = b.clinicId;
  profissionalA = a.profissional;

  await criarUsuario("admin-a", clinicaA, "admin");
  await criarUsuario("gestor-a", clinicaA, "gestor");
  await criarUsuario("recepcao-a", clinicaA, "recepcao");
  await criarUsuario("leitura-a", clinicaA, "leitura");
  await criarUsuario("prof-a", clinicaA, "profissional", profissionalA);
  await criarUsuario("admin-b", clinicaB, "admin");

  // Disparo da regua de confirmacao hoje e um toque fechado por falha.
  const { data: passo } = await admin
    .from("cadence_step")
    .select("id, cadence:cadence_id!inner(kind)")
    .eq("clinic_id", clinicaA)
    .eq("cadence.kind", "confirmacao")
    .order("offset_minutes", { ascending: true })
    .limit(1)
    .single()
    .throwOnError();
  const agora = new Date().toISOString();
  const { data: runs } = await admin
    .from("cadence_run")
    .insert([
      {
        clinic_id: clinicaA,
        cadence_step_id: passo!.id,
        contact_id: a.contato,
        scheduled_for: agora,
        sent_at: agora,
      },
      {
        clinic_id: clinicaA,
        cadence_step_id: passo!.id,
        contact_id: a.contato,
        scheduled_for: new Date(Date.now() + 60_000).toISOString(),
        skipped_reason: "falha_envio",
        motivo_da_falha: "uazapi_500",
      },
    ])
    .select("id, skipped_reason")
    .throwOnError();
  runComFalha = runs!.find((r) => r.skipped_reason === "falha_envio")!
    .id as string;
});

afterAll(async () => {
  await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
  for (const id of usuarios) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("resumo_do_dia: o dia do Início", () => {
  it("admin, gestor, recepção e leitura veem o mesmo número; profissional recebe null", async () => {
    const respostas: unknown[] = [];
    for (const papel of ["admin-a", "gestor-a", "recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc(
        "resumo_do_dia",
        argsDoResumo(clinicaA),
      );
      expect(error).toBeNull();
      respostas.push(data);
    }
    const doAdmin = respostas[0] as ResumoDoDia;
    expect(doAdmin.hoje.total).toBe(1);
    expect(doAdmin.hoje.confirmadas).toBe(1);
    expect(doAdmin.ultimo_disparo).not.toBeNull();
    for (const resposta of respostas.slice(1)) {
      expect(resposta).toEqual(doAdmin);
    }

    const prof = await logado("prof-a");
    const doProf = await prof.rpc("resumo_do_dia", argsDoResumo(clinicaA));
    expect(doProf.error).toBeNull();
    expect(doProf.data).toBeNull();
  });

  it("A pedindo a B recebe zeros; B vê o dela (contraprova)", async () => {
    const clienteA = await logado("admin-a");
    const { data: deA } = await clienteA.rpc(
      "resumo_do_dia",
      argsDoResumo(clinicaB),
    );
    expect((deA as ResumoDoDia).hoje.total).toBe(0);
    expect((deA as ResumoDoDia).ultimo_disparo).toBeNull();

    const clienteB = await logado("admin-b");
    const { data: deB } = await clienteB.rpc(
      "resumo_do_dia",
      argsDoResumo(clinicaB),
    );
    expect((deB as ResumoDoDia).hoje.total).toBe(1);
  });

  it("sem sessão (anon) não executa", async () => {
    const { error } = await anonClient().rpc(
      "resumo_do_dia",
      argsDoResumo(clinicaA),
    );
    expect(error).not.toBeNull();
  });
});

describe("funil_da_jornada", () => {
  it("recepção vê as etapas com o total atual; profissional recebe null", async () => {
    const recepcao = await logado("recepcao-a");
    const { data, error } = await recepcao.rpc("funil_da_jornada", {
      p_clinic_id: clinicaA,
    });
    expect(error).toBeNull();
    const etapas = data as Etapa[];
    expect(etapas.length).toBeGreaterThan(0);
    // O contato da fixture agendou (gatilho avancar_funil_ao_agendar).
    expect(etapas.reduce((soma, e) => soma + e.total, 0)).toBe(1);
    expect(etapas.find((e) => e.chave === "agendou")?.total).toBe(1);

    const prof = await logado("prof-a");
    const doProf = await prof.rpc("funil_da_jornada", {
      p_clinic_id: clinicaA,
    });
    expect(doProf.error).toBeNull();
    expect(doProf.data).toBeNull();
  });

  it("A pedindo a B recebe lista vazia; B vê a dela", async () => {
    const clienteA = await logado("admin-a");
    const { data: deA } = await clienteA.rpc("funil_da_jornada", {
      p_clinic_id: clinicaB,
    });
    expect(deA).toEqual([]);
    const clienteB = await logado("admin-b");
    const { data: deB } = await clienteB.rpc("funil_da_jornada", {
      p_clinic_id: clinicaB,
    });
    expect((deB as Etapa[]).reduce((soma, e) => soma + e.total, 0)).toBe(1);
  });
});

describe("metricas_de_pacientes", () => {
  it("profissional vê a própria agenda (não null); recepção vê a clínica", async () => {
    for (const papel of ["recepcao-a", "prof-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("metricas_de_pacientes", {
        p_clinic_id: clinicaA,
      });
      expect(error).toBeNull();
      expect((data as MetricasDePacientes[])[0]!.ativos).toBe(1);
    }
  });

  it("A pedindo a B recebe zeros; B vê o dela", async () => {
    const clienteA = await logado("admin-a");
    const { data: deA } = await clienteA.rpc("metricas_de_pacientes", {
      p_clinic_id: clinicaB,
    });
    expect((deA as MetricasDePacientes[])[0]!.ativos).toBe(0);
    const clienteB = await logado("admin-b");
    const { data: deB } = await clienteB.rpc("metricas_de_pacientes", {
      p_clinic_id: clinicaB,
    });
    expect((deB as MetricasDePacientes[])[0]!.ativos).toBe(1);
  });
});

describe("valor em reais só para admin e gestor", () => {
  it("metricas_da_espera: receita para admin e gestor, null para os outros", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data } = await cliente.rpc("metricas_da_espera", {
        p_clinic_id: clinicaA,
      });
      const linha = (data as MetricasDaEspera[])[0]!;
      expect(linha.vagas_preenchidas).toBe(1);
      expect(linha.receita_cents).toBe(15000);
    }
    for (const papel of ["recepcao-a", "leitura-a", "prof-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("metricas_da_espera", {
        p_clinic_id: clinicaA,
      });
      expect(error).toBeNull();
      const linha = (data as MetricasDaEspera[])[0]!;
      // O resto do desempenho continua visível; só o valor some.
      expect(linha.vagas_preenchidas).toBe(1);
      expect(linha.receita_cents).toBeNull();
    }
  });

  it("faturamento_do_periodo: número para admin e gestor, null para recepção, leitura e profissional", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("faturamento_do_periodo", {
        p_clinic_id: clinicaA,
        ...PERIODO,
      });
      expect(error).toBeNull();
      expect((data as Faturamento).atual.valor_cents).toBe(15000);
    }
    for (const papel of ["recepcao-a", "leitura-a", "prof-a"]) {
      const cliente = await logado(papel);
      const { data, error } = await cliente.rpc("faturamento_do_periodo", {
        p_clinic_id: clinicaA,
        ...PERIODO,
      });
      expect(error).toBeNull();
      expect(data).toBeNull();
    }
  });

  it("agenda_do_periodo: receita das recuperadas some para recepção, leitura e profissional", async () => {
    for (const papel of ["admin-a", "gestor-a"]) {
      const cliente = await logado(papel);
      const { data } = await cliente.rpc("agenda_do_periodo", {
        p_clinic_id: clinicaA,
        ...PERIODO_DA_AGENDA,
      });
      expect((data as Agenda).atual.recuperadas).toEqual({
        total: 1,
        receita_cents: 15000,
        sem_preco: 0,
      });
    }
    for (const papel of ["recepcao-a", "leitura-a"]) {
      const cliente = await logado(papel);
      const { data } = await cliente.rpc("agenda_do_periodo", {
        p_clinic_id: clinicaA,
        ...PERIODO_DA_AGENDA,
      });
      expect((data as Agenda).atual.recuperadas).toEqual({
        total: 1,
        receita_cents: null,
        sem_preco: 0,
      });
    }
    const prof = await logado("prof-a");
    const { data: doProf } = await prof.rpc("agenda_do_periodo", {
      p_clinic_id: clinicaA,
      ...PERIODO_DA_AGENDA,
      p_professional_id: profissionalA,
    });
    expect((doProf as Agenda).atual.recuperadas.total).toBe(1);
    expect((doProf as Agenda).atual.recuperadas.receita_cents).toBeNull();
  });

  it("A pedindo a B: faturamento null e espera sem número; B vê o dela", async () => {
    const clienteA = await logado("admin-a");
    const fat = await clienteA.rpc("faturamento_do_periodo", {
      p_clinic_id: clinicaB,
      ...PERIODO,
    });
    expect(fat.data).toBeNull();
    const esp = await clienteA.rpc("metricas_da_espera", {
      p_clinic_id: clinicaB,
    });
    expect((esp.data as MetricasDaEspera[])[0]).toMatchObject({
      vagas_oferecidas: 0,
      receita_cents: null,
    });

    const clienteB = await logado("admin-b");
    const fatB = await clienteB.rpc("faturamento_do_periodo", {
      p_clinic_id: clinicaB,
      ...PERIODO,
    });
    expect((fatB.data as Faturamento).atual.valor_cents).toBe(50000);
    const espB = await clienteB.rpc("metricas_da_espera", {
      p_clinic_id: clinicaB,
    });
    expect((espB.data as MetricasDaEspera[])[0]!.receita_cents).toBe(50000);
  });
});

describe("serie_diaria_do_periodo", () => {
  it("recepção recebe a série; profissional recebe null; A pedindo a B recebe zeros", async () => {
    const janela = {
      p_de: local(dia(-2), "00:00"),
      p_ate: local(dia(1), "00:00"),
    };
    const recepcao = await logado("recepcao-a");
    const { data, error } = await recepcao.rpc("serie_diaria_do_periodo", {
      p_clinic_id: clinicaA,
      ...janela,
    });
    expect(error).toBeNull();
    const pontos = data as { dia: string; leads: number; agendadas: number }[];
    expect(pontos.map((p) => p.dia)).toEqual([dia(-2), dia(-1), hoje]);
    expect(pontos.reduce((soma, p) => soma + p.leads, 0)).toBe(1);

    const prof = await logado("prof-a");
    const doProf = await prof.rpc("serie_diaria_do_periodo", {
      p_clinic_id: clinicaA,
      ...janela,
    });
    expect(doProf.data).toBeNull();

    const clienteA = await logado("admin-a");
    const { data: deB } = await clienteA.rpc("serie_diaria_do_periodo", {
      p_clinic_id: clinicaB,
      ...janela,
    });
    const pontosDeB = deB as { leads: number; agendadas: number }[];
    expect(pontosDeB).toHaveLength(3);
    expect(pontosDeB.every((p) => p.leads === 0 && p.agendadas === 0)).toBe(
      true,
    );
  });
});

describe("cadence_run.motivo_da_falha", () => {
  it("o membro lê o motivo, a sessão não escreve, a outra clínica não vê", async () => {
    const recepcao = await logado("recepcao-a");
    const { data: lida } = await recepcao
      .from("cadence_run")
      .select("motivo_da_falha")
      .eq("id", runComFalha)
      .single();
    expect(lida?.motivo_da_falha).toBe("uazapi_500");

    const { data: escrita } = await recepcao
      .from("cadence_run")
      .update({ motivo_da_falha: "desconhecido" })
      .eq("id", runComFalha)
      .select("id");
    expect(escrita ?? []).toEqual([]);
    const { data: depois } = await admin
      .from("cadence_run")
      .select("motivo_da_falha")
      .eq("id", runComFalha)
      .single();
    expect(depois?.motivo_da_falha).toBe("uazapi_500");

    const clienteB = await logado("admin-b");
    const { data: deB } = await clienteB
      .from("cadence_run")
      .select("id")
      .eq("id", runComFalha);
    expect(deB).toEqual([]);
  });

  it("o CHECK recusa motivo fora de 'falha_envio' e fora do formato", async () => {
    const { data: run } = await admin
      .from("cadence_run")
      .select("cadence_step_id, contact_id")
      .eq("id", runComFalha)
      .single()
      .throwOnError();
    const base = {
      clinic_id: clinicaA,
      cadence_step_id: run!.cadence_step_id,
      contact_id: run!.contact_id,
    };
    const semPulo = await admin.from("cadence_run").insert({
      ...base,
      scheduled_for: new Date(Date.now() + 120_000).toISOString(),
      motivo_da_falha: "uazapi_500",
    });
    expect(semPulo.error?.code).toBe("23514");
    const outroPulo = await admin.from("cadence_run").insert({
      ...base,
      scheduled_for: new Date(Date.now() + 180_000).toISOString(),
      skipped_reason: "condicao_parada",
      motivo_da_falha: "uazapi_500",
    });
    expect(outroPulo.error?.code).toBe("23514");
    const foraDoFormato = await admin.from("cadence_run").insert({
      ...base,
      scheduled_for: new Date(Date.now() + 240_000).toISOString(),
      skipped_reason: "falha_envio",
      motivo_da_falha: "Uazapi 500",
    });
    expect(foraDoFormato.error?.code).toBe("23514");
  });
});
