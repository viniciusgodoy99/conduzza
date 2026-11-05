import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agenteComAtividade } from "@/lib/domain/exportacao-de-resultados";
import { diaCivil, somarDias } from "@/lib/domain/horarios";
import {
  fetchAgendaDoPeriodo,
  fetchAtendimentoDoPeriodo,
  fetchFunilDoPeriodo,
  fetchLinhaDeBase,
} from "@/lib/queries/relatorios";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient, anonClient } from "../rls/stack";

// Fase 5.1/5.2 contra o banco REAL: as tres RPCs de agregados por periodo
// (migration 20260918100000) com fixtures determinadas data a data. O aceite
// do 5.1 e literal: "numeros batem com consulta direta ao banco". Clinica
// e_de_teste: o motor de producao a ignora (reguas semeadas desligadas).

const admin = adminClient();
const sufixo = Date.now().toString(36);
const TZ = "America/Fortaleza";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

const agora = Date.now();
const iso = (deltaMs: number) => new Date(agora + deltaMs).toISOString();

let clinicId = "";
let professionalId = "";
let vinculoComPreco = "";
let vinculoSemPreco = "";
let c1 = ""; // lead do periodo ATUAL
let c2 = ""; // lead do periodo ANTERIOR

const diaAte = diaCivil(TZ, new Date());
const diaDe = somarDias(diaAte, -29);

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Relatorios ${sufixo}`,
      slug: `relatorios-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;
  // Conversa exige numero de WhatsApp (contrato da Fase 3).
  await criarNumeroDeTeste(admin, clinicId);

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Resultado" })
    .select("id")
    .single()
    .throwOnError();
  professionalId = prof!.id as string;

  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Avaliação",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc2 } = await admin
    .from("procedure")
    .insert({ clinic_id: clinicId, name: "Retorno", default_duration_min: 30 })
    .select("id")
    .single()
    .throwOnError();

  const { data: sl1 } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: professionalId,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 10000,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  vinculoComPreco = sl1!.id as string;
  const { data: sl2 } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: professionalId,
      procedure_id: proc2!.id,
      insurance_id: null,
      price_cents: null,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  vinculoSemPreco = sl2!.id as string;

  // Leads: C1 chegou no periodo atual, C2 no anterior.
  const { data: contatos } = await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicId,
        phone_e164: `+5584911${sufixo.slice(0, 6)}1`,
        name: "Atual",
        first_contact_at: iso(-5 * DIA),
      },
      {
        clinic_id: clinicId,
        phone_e164: `+5584911${sufixo.slice(0, 6)}2`,
        name: "Anterior",
        first_contact_at: iso(-40 * DIA),
      },
    ])
    .select("id, name")
    .throwOnError();
  c1 = contatos!.find((c) => c.name === "Atual")!.id as string;
  c2 = contatos!.find((c) => c.name === "Anterior")!.id as string;

  const consulta = (
    contato: string,
    vinculo: string,
    status: string,
    startsDelta: number,
    createdDelta: number,
  ) => ({
    clinic_id: clinicId,
    contact_id: contato,
    professional_id: professionalId,
    service_link_id: vinculo,
    status,
    starts_at: iso(startsDelta),
    ends_at: iso(startsDelta + 30 * MINUTO),
    created_at: iso(createdDelta),
  });

  // A1 compareceu (atual), A2 faltou (anterior), A4 faltou (atual),
  // A5 remarcacao futura criada DEPOIS da falta A4, A3 recuperada sem preco.
  const { data: consultas } = await admin
    .from("appointment")
    .insert([
      consulta(c1, vinculoComPreco, "compareceu", -2 * DIA, -4 * DIA),
      consulta(c2, vinculoComPreco, "faltou", -35 * DIA, -38 * DIA),
      consulta(c2, vinculoComPreco, "faltou", -10 * DIA, -12 * DIA),
      consulta(c2, vinculoComPreco, "agendado", 5 * DIA, -8 * DIA),
      consulta(c1, vinculoSemPreco, "agendado", -3 * DIA, -3 * DIA),
    ])
    .select("id, status, starts_at")
    .throwOnError();
  const porInicio = [...consultas!].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
  // Ordem por inicio: A2 (-35d), A4 (-10d), A3 (-3d), A1 (-2d), A5 (+5d)
  const a2 = porInicio[0]!.id as string;
  const a3 = porInicio[2]!.id as string;
  const a1 = porInicio[3]!.id as string;

  // A1 foi confirmada ANTES de comparecer: so a trilha sabe.
  await admin
    .from("appointment_status_history")
    .insert({
      clinic_id: clinicId,
      appointment_id: a1,
      status: "confirmado_paciente",
      changed_by: "paciente",
      changed_at: iso(-3 * DIA),
    })
    .throwOnError();

  // Recuperadas pela lista de espera: uma com preco, uma sem.
  await admin
    .from("waitlist_offer")
    .insert([
      {
        clinic_id: clinicId,
        source_appointment_id: a2,
        professional_id: professionalId,
        slot_starts_at: iso(-3 * DIA),
        slot_ends_at: iso(-3 * DIA + 30 * MINUTO),
        offered_to: [c1],
        expires_at: iso(-3 * DIA + HORA),
        status: "preenchida",
        responded_by: c1,
        appointment_id: a3,
      },
      {
        clinic_id: clinicId,
        source_appointment_id: a2,
        professional_id: professionalId,
        slot_starts_at: iso(-2 * DIA),
        slot_ends_at: iso(-2 * DIA + 30 * MINUTO),
        offered_to: [c1],
        expires_at: iso(-2 * DIA + HORA),
        status: "preenchida",
        responded_by: c1,
        appointment_id: a1,
      },
    ])
    .throwOnError();

  // Pivo da regua: primeiro toque ha 20 dias (passo da regua semeada).
  const { data: passo } = await admin
    .from("cadence_step")
    .select("id, cadence:cadence_id!inner(clinic_id)")
    .eq("cadence.clinic_id", clinicId)
    .limit(1)
    .single()
    .throwOnError();
  await admin
    .from("cadence_run")
    .insert({
      clinic_id: clinicId,
      cadence_step_id: passo!.id,
      contact_id: c1,
      appointment_id: a1,
      scheduled_for: iso(-20 * DIA),
      sent_at: iso(-20 * DIA),
    })
    .throwOnError();

  // Atendimento: V1 respondida em 10 minutos, V2 sem resposta.
  const { data: conversas } = await admin
    .from("conversation")
    .insert([
      { clinic_id: clinicId, contact_id: c1, created_at: iso(-6 * DIA) },
      { clinic_id: clinicId, contact_id: c2, created_at: iso(-5 * DIA) },
    ])
    .select("id, contact_id")
    .throwOnError();
  const v1 = conversas!.find((v) => v.contact_id === c1)!.id as string;
  const v2 = conversas!.find((v) => v.contact_id === c2)!.id as string;
  await admin
    .from("message")
    .insert([
      {
        clinic_id: clinicId,
        conversation_id: v1,
        direction: "entrada",
        author: "paciente",
        body: "Oi",
        created_at: iso(-6 * DIA),
      },
      {
        clinic_id: clinicId,
        conversation_id: v1,
        direction: "saida",
        author: "usuario",
        body: "Olá!",
        created_at: iso(-6 * DIA + 600_000),
      },
      {
        clinic_id: clinicId,
        conversation_id: v2,
        direction: "entrada",
        author: "paciente",
        body: "Bom dia",
        created_at: iso(-5 * DIA),
      },
    ])
    .throwOnError();
});

afterAll(async () => {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("funil_do_periodo", () => {
  it("recorta leads por chegada e compara com o período anterior", async () => {
    const funil = await fetchFunilDoPeriodo(admin, clinicId, TZ, diaDe, diaAte);
    expect(funil.atual.leads).toBe(1);
    expect(funil.atual.agendamentosCriados).toBe(4);
    expect(funil.atual.comparecimentos).toBe(1);
    expect(funil.atual.faltas).toBe(1);
    expect(funil.atual.coorte).toEqual({
      leads: 1,
      agendaram: 1,
      compareceram: 1,
    });
    expect(funil.anterior).not.toBeNull();
    expect(funil.anterior!.leads).toBe(1);
    expect(funil.anterior!.agendamentosCriados).toBe(1);
    expect(funil.anterior!.comparecimentos).toBe(0);
    expect(funil.anterior!.faltas).toBe(1);
    expect(funil.anterior!.coorte).toEqual({
      leads: 1,
      agendaram: 1,
      compareceram: 0,
    });
    // Sem atribuicao: a linha (null) vem incluida, nunca escondida.
    expect(funil.atual.porCanal).toEqual([
      { canal: null, leads: 1, agendaram: 1, compareceram: 1 },
    ]);
  });
});

describe("agenda_do_periodo", () => {
  it("conta o período, a trilha de confirmação e as recuperadas sem inventar preço", async () => {
    const agenda = await fetchAgendaDoPeriodo(
      admin,
      clinicId,
      TZ,
      diaDe,
      diaAte,
    );
    expect(agenda.atual.total).toBe(3);
    expect(agenda.atual.criados).toBe(4);
    expect(agenda.atual.porStatus.compareceu).toBe(1);
    expect(agenda.atual.porStatus.faltou).toBe(1);
    expect(agenda.atual.porStatus.agendado).toBe(1);
    // Zero-fill: status sem consulta vem 0, nao ausente.
    expect(agenda.atual.porStatus.cancelado_paciente).toBe(0);
    // A1 esta 'compareceu' HOJE; a confirmacao dela so existe na trilha.
    expect(agenda.atual.confirmadasAlgumaVez).toBe(1);
    // Receita: R$ 100,00 da recuperada com preco; a sem preco NAO vira zero
    // em silencio, vira contagem propria.
    expect(agenda.atual.recuperadas).toEqual({
      total: 2,
      receitaCents: 10000,
      semPreco: 1,
    });
    expect(agenda.atual.remarcadasAposFalta).toEqual({
      faltas: 1,
      remarcadas: 1,
    });
    expect(agenda.atual.porProfissional).toHaveLength(1);
    expect(agenda.atual.porProfissional[0]!.total).toBe(3);
    expect(agenda.pivo).not.toBeNull();
    expect(agenda.pivo!.antes).toEqual({ comDesfecho: 1, faltas: 1 });
    expect(agenda.pivo!.depois).toEqual({ comDesfecho: 2, faltas: 1 });
  });

  it("clínica sem toque de régua tem pivô null, nunca zero falso", async () => {
    const { data: outra } = await admin
      .from("clinic")
      .insert({
        name: `Sem regua ${sufixo}`,
        slug: `semregua-${sufixo}`,
        e_de_teste: true,
      })
      .select("id")
      .single()
      .throwOnError();
    try {
      const agenda = await fetchAgendaDoPeriodo(
        admin,
        outra!.id as string,
        TZ,
        diaDe,
        diaAte,
      );
      expect(agenda.pivo).toBeNull();
    } finally {
      await admin.from("clinic").delete().eq("id", outra!.id);
    }
  });
});

describe("atendimento_do_periodo", () => {
  it("mede a primeira resposta humana por mediana, com conversa sem resposta no denominador", async () => {
    const atendimento = await fetchAtendimentoDoPeriodo(
      admin,
      clinicId,
      TZ,
      diaDe,
      diaAte,
    );
    expect(atendimento.atual.conversasIniciadas).toBe(2);
    expect(atendimento.atual.primeiraResposta.conversas).toBe(2);
    expect(atendimento.atual.primeiraResposta.respondidas).toBe(1);
    expect(atendimento.atual.primeiraResposta.medianaSegundos).toBe(600);
    expect(atendimento.atual.primeiraResposta.p90Segundos).toBe(600);
    expect(atendimento.atual.mensagens.entrada).toBe(2);
    expect(atendimento.atual.mensagens.saida).toBe(1);
    expect(atendimento.atual.mensagens.porAutor).toEqual({
      paciente: 2,
      usuario: 1,
    });
    expect(atendimento.anterior!.conversasIniciadas).toBe(0);
    // Zero conversas no anterior: mediana null ("sem dados"), nunca 0.
    expect(atendimento.anterior!.primeiraResposta.medianaSegundos).toBeNull();
  });
});

// O bloco "agente" de atendimento_do_periodo (migration 20261104120000). Escrito
// em 04/11/2026 com a migration NAO aplicada e NAO rodado: bate no banco de
// verdade e so passa depois dela (npm run test:integration -- relatorios). A
// conta inteira, cenario a cenario, esta no ensaio da migration
// (~/.claude/plans/agente-completo/ag0/ensaio-20261104120000.sql).
describe("atendimento_do_periodo: o desempenho do agente", () => {
  const SENHA = "Agente!Relatorios2026";
  const usuarios: string[] = [];
  let clinicaA = "";
  let clinicaB = "";

  async function criarClinica(nome: string): Promise<string> {
    const { data } = await admin
      .from("clinic")
      .insert({
        name: `Agente ${nome} ${sufixo}`,
        slug: `agente-${nome}-${sufixo}`,
        e_de_teste: true,
      })
      .select("id")
      .single()
      .throwOnError();
    await criarNumeroDeTeste(admin, data!.id as string);
    return data!.id as string;
  }

  /** Conversa com contato proprio, a primeira entrada em deltaMs. */
  async function conversa(
    clinica: string,
    telefone: string,
    deltaMs: number,
  ): Promise<{ id: string; contato: string }> {
    const { data: contato } = await admin
      .from("contact")
      .insert({
        clinic_id: clinica,
        phone_e164: `+5584912${sufixo.slice(0, 5)}${telefone}`,
        first_contact_at: iso(deltaMs),
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: linha } = await admin
      .from("conversation")
      .insert({
        clinic_id: clinica,
        contact_id: contato!.id,
        created_at: iso(deltaMs),
      })
      .select("id")
      .single()
      .throwOnError();
    await mensagem(
      clinica,
      linha!.id as string,
      "entrada",
      "paciente",
      deltaMs,
    );
    return { id: linha!.id as string, contato: contato!.id as string };
  }

  async function mensagem(
    clinica: string,
    conversaId: string,
    direction: "entrada" | "saida",
    author: "paciente" | "ia" | "usuario",
    deltaMs: number,
    deliveryStatus: string | null = null,
  ) {
    await admin
      .from("message")
      .insert({
        clinic_id: clinica,
        conversation_id: conversaId,
        direction,
        author,
        body: "Mensagem de teste",
        delivery_status: deliveryStatus,
        created_at: iso(deltaMs),
      })
      .throwOnError();
  }

  async function passagem(
    clinica: string,
    conversaId: string,
    motivo: string,
    deltaMs: number,
  ) {
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinica,
        conversation_id: conversaId,
        escalation_reason: motivo,
        created_at: iso(deltaMs),
      })
      .throwOnError();
  }

  async function logado(papel: string, clinica: string, profissional?: string) {
    const email = `agente-relat-${papel}-${sufixo}@teste.dev`;
    const { data } = await admin.auth.admin.createUser({
      email,
      password: SENHA,
      email_confirm: true,
      user_metadata: { name: papel },
    });
    usuarios.push(data.user!.id);
    await admin
      .from("clinic_member")
      .insert({
        clinic_id: clinica,
        user_id: data.user!.id,
        role: papel,
        status: "ativo",
        ...(profissional ? { professional_id: profissional } : {}),
      })
      .throwOnError();
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

  let profissionalDaA = "";

  beforeAll(async () => {
    clinicaA = await criarClinica("a");
    clinicaB = await criarClinica("b");

    // Periodo atual da A. Resolvida em 60 s.
    const resolvida = await conversa(clinicaA, "1", -5 * DIA);
    await mensagem(
      clinicaA,
      resolvida.id,
      "saida",
      "ia",
      -5 * DIA + 60_000,
      "enviada",
    );
    // Passou para a equipe e ninguem respondeu: nao foi resolvida (180 s).
    const transferida = await conversa(clinicaA, "2", -4 * DIA);
    await mensagem(
      clinicaA,
      transferida.id,
      "saida",
      "ia",
      -4 * DIA + 180_000,
      "enviada",
    );
    await passagem(
      clinicaA,
      transferida.id,
      "pedido_humano",
      -4 * DIA + 200_000,
    );
    // A equipe respondeu depois da IA (300 s).
    const comEquipe = await conversa(clinicaA, "3", -3 * DIA);
    await mensagem(
      clinicaA,
      comEquipe.id,
      "saida",
      "ia",
      -3 * DIA + 300_000,
      "entregue",
    );
    await mensagem(
      clinicaA,
      comEquipe.id,
      "saida",
      "usuario",
      -3 * DIA + 400_000,
      "enviada",
    );
    // O envio da IA falhou: nao foi atendida, nem resolvida, nem entra na mediana.
    const falhou = await conversa(clinicaA, "4", -2 * DIA);
    await mensagem(
      clinicaA,
      falhou.id,
      "saida",
      "ia",
      -2 * DIA + 5_000,
      "falhou",
    );
    // Periodo anterior da A: respondeu em 30 s e passou por insatisfacao.
    const anterior = await conversa(clinicaA, "5", -40 * DIA);
    await mensagem(
      clinicaA,
      anterior.id,
      "saida",
      "ia",
      -40 * DIA + 30_000,
      "enviada",
    );
    await passagem(clinicaA, anterior.id, "insatisfacao", -40 * DIA + 40_000);

    // Consultas da A: a recusada e a da equipe nao contam.
    const { data: prof } = await admin
      .from("professional")
      .insert({ clinic_id: clinicaA, name: "Dra. Agente" })
      .select("id")
      .single()
      .throwOnError();
    profissionalDaA = prof!.id as string;
    const { data: proc } = await admin
      .from("procedure")
      .insert({
        clinic_id: clinicaA,
        name: "Avaliação",
        default_duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicaA,
        professional_id: profissionalDaA,
        procedure_id: proc!.id,
        insurance_id: null,
        price_cents: null,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const consulta = (
      createdBy: string,
      approvalStatus: string | null,
      createdDelta: number,
      horasAFrente: number,
    ) => ({
      clinic_id: clinicaA,
      contact_id: resolvida.contato,
      professional_id: profissionalDaA,
      service_link_id: vinculo!.id,
      status: "agendado",
      starts_at: iso(horasAFrente * HORA),
      ends_at: iso(horasAFrente * HORA + 30 * MINUTO),
      created_at: iso(createdDelta),
      created_by: createdBy,
      approval_status: approvalStatus,
    });
    await admin
      .from("appointment")
      .insert([
        consulta("ia", "pendente", -1 * DIA, 100),
        consulta("ia", "recusado", -1 * DIA, 101),
        consulta("usuario", null, -1 * DIA, 102),
        consulta("ia", "pendente", -40 * DIA, 103),
      ])
      .throwOnError();

    // A B tem atividade da IA: nada disso pode aparecer para quem e da A.
    const daB = await conversa(clinicaB, "6", -5 * DIA);
    await mensagem(
      clinicaB,
      daB.id,
      "saida",
      "ia",
      -5 * DIA + 90_000,
      "enviada",
    );
  });

  afterAll(async () => {
    await admin.from("clinic").delete().in("id", [clinicaA, clinicaB]);
    for (const id of usuarios) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("conta cada número nas duas janelas", async () => {
    const lido = await fetchAtendimentoDoPeriodo(
      admin,
      clinicaA,
      TZ,
      diaDe,
      diaAte,
    );
    expect(lido.atual.agente).toEqual({
      atendidas: 3,
      resolvidasSemHumano: 1,
      transferidas: 1,
      insatisfacao: 0,
      primeiraRespostaMedianaSegundos: 180,
      agendamentos: 1,
    });
    expect(lido.anterior?.agente).toEqual({
      atendidas: 1,
      resolvidasSemHumano: 0,
      transferidas: 1,
      insatisfacao: 1,
      primeiraRespostaMedianaSegundos: 30,
      agendamentos: 1,
    });
  });

  it("um usuário da A não lê o bloco da B: zeros, e a tela lê como Ainda não medido", async () => {
    const recepcao = await logado("recepcao", clinicaA);
    const lido = await fetchAtendimentoDoPeriodo(
      recepcao,
      clinicaB,
      TZ,
      diaDe,
      diaAte,
    );
    expect(lido.atual.agente).toEqual({
      atendidas: 0,
      resolvidasSemHumano: 0,
      transferidas: 0,
      insatisfacao: 0,
      primeiraRespostaMedianaSegundos: null,
      agendamentos: 0,
    });
    expect(agenteComAtividade(lido.atual.agente)).toBe(false);
    // Contraprova: a mesma pessoa le a propria clinica.
    const daPropria = await fetchAtendimentoDoPeriodo(
      recepcao,
      clinicaA,
      TZ,
      diaDe,
      diaAte,
    );
    expect(daPropria.atual.agente?.atendidas).toBe(3);
  });

  it("o profissional recebe null: o recorte fica indisponível, nunca números parciais", async () => {
    const profissional = await logado(
      "profissional",
      clinicaA,
      profissionalDaA,
    );
    const { data, error } = await profissional.rpc("atendimento_do_periodo", {
      p_clinic_id: clinicaA,
      p_de: iso(-29 * DIA),
      p_ate: iso(HORA),
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
    await expect(
      fetchAtendimentoDoPeriodo(profissional, clinicaA, TZ, diaDe, diaAte),
    ).rejects.toThrow("Recorte indisponível");
  });
});

describe("linha de base", () => {
  it("é append-only: a linha mais recente vale", async () => {
    expect(await fetchLinhaDeBase(admin, clinicId)).toBeNull();
    const { data: usuario } = await admin.auth.admin.createUser({
      email: `baseline-${sufixo}@teste.dev`,
      password: "Baseline!2026",
      email_confirm: true,
    });
    await admin
      .from("no_show_baseline")
      .insert({
        clinic_id: clinicId,
        rate_percent: 18,
        measured_from: "2026-08-01",
        measured_to: "2026-08-31",
        registered_by: usuario!.user!.id,
        // Explicito no passado: o proximo insert usa o default now() e a
        // ordem por created_at fica deterministica.
        created_at: iso(-HORA),
      })
      .throwOnError();
    await admin
      .from("no_show_baseline")
      .insert({
        clinic_id: clinicId,
        rate_percent: 21.5,
        measured_from: "2026-08-01",
        measured_to: "2026-08-31",
        note: "corrigida com a planilha da recepção",
        registered_by: usuario!.user!.id,
      })
      .throwOnError();
    const linha = await fetchLinhaDeBase(admin, clinicId);
    expect(linha).not.toBeNull();
    expect(linha!.ratePercent).toBe(21.5);
    expect(linha!.note).toBe("corrigida com a planilha da recepção");
    // A FK registered_by (sem on delete) BLOQUEIA apagar o usuario enquanto
    // as linhas existem, e deleteUser nao lanca: sem esta ordem o teste
    // vazava um usuario auth orfao em producao por execucao (achado da
    // revisao de 18/09). Service role ignora o append-only da RLS.
    await admin
      .from("no_show_baseline")
      .delete()
      .eq("clinic_id", clinicId)
      .throwOnError();
    const { error: erroDeLimpeza } = await admin.auth.admin.deleteUser(
      usuario!.user!.id,
    );
    expect(erroDeLimpeza).toBeNull();
  });
});
