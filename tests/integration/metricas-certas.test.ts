import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nascerDeMensagem } from "../rls/lead-de-verdade";
import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Metricas certas (decisao do dono de 23/11/2026) contra o banco REAL:
// contato_e_lead (lead de verdade), o Agendou da Jornada, a remarcacao pela
// IA contada uma vez, o divisor Meta Ads do custo por lead,
// passagens_da_ia_do_periodo e a trilha da IA que fica com a conversa
// apagada (migration 20261123100000). Escrito em 23/11/2026 com a migration
// NAO aplicada e NAO rodado: so passa depois dela
// (npm run test:integration -- metricas-certas).
//
// Clinica e_de_teste (o motor de producao a ignora), apagada no fim. Datas
// fixas de outubro de 2026 em America/Fortaleza (UTC-3), periodo dos dias
// 10 a 13.
//
// Contatos do periodo:
//   L1   nasceu de mensagem, sem origem            dia 10  lead (nao rastreada)
//   L2   nasceu de mensagem, origem Meta sem ids   dia 11  lead (Meta Ads)
//   L3   nasceu de mensagem, clique do anuncio     dia 12  lead (Meta Ads)
//   IMP  importado (mesmo com a autorizacao)       dia 10  nao e lead
//   AG   paciente novo da Agenda (sem autorizacao) dia 11  nao e lead
//   MAN  cadastro manual, autorizacao 'conversa'
//        registrada DEPOIS pela equipe             dia 12  nao e lead
// Consultas:
//   A1  L1, da equipe, criada dia 10, para dia 12: remarcada pela IA (A4)
//   A4  L1, da IA, remarcacao_de A1, criada dia 11, para dia 13, aprovada
//       (o gatilho cancela A1 como cancelado_paciente)
//   A2  L2, da IA, pendente, criada dia 11, para dia 13
//   A3  L3, da IA, recusada, criada dia 12, para dia 13
//   A5  AG, da equipe, criada dia 11, para dia 12

const admin = adminClient();
const sufixo = Date.now().toString(36);
const TZ = "America/Fortaleza";
const JANELA = {
  p_de: "2026-10-10T03:00:00.000Z",
  p_ate: "2026-10-14T03:00:00.000Z",
};

let clinicId = "";
let conversaId = "";
const decisoes: Record<string, string> = {};

type Funil = {
  leads: number;
  agendamentos_criados: number;
  coorte: { leads: number; agendaram: number; compareceram: number };
  por_grupo: Record<string, number>;
};

async function rpc<T>(nome: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(nome, {
    p_clinic_id: clinicId,
    ...JANELA,
    ...extra,
  });
  expect(error).toBeNull();
  return data as T;
}

beforeAll(async () => {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Metricas certas ${sufixo}`,
      slug: `metricas-certas-${sufixo}`,
      timezone: TZ,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;

  const contato = async (
    final: string,
    chegada: string,
    campos: Record<string, unknown> = {},
  ): Promise<string> => {
    const { data } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: `+55849900623${final}`,
        first_contact_at: chegada,
        ...campos,
      })
      .select("id")
      .single()
      .throwOnError();
    return data!.id as string;
  };

  const l1 = await contato("01", "2026-10-10T15:00:00.000Z");
  const l2 = await contato("02", "2026-10-11T15:00:00.000Z", {
    source_method: "anuncio_ctwa",
    source_channel: "trafego_pago",
    source_origin: "Meta",
  });
  const l3 = await contato("03", "2026-10-12T15:00:00.000Z", {
    ctwa_clid: `clid-certas-${sufixo}`,
  });
  const imp = await contato("04", "2026-10-10T16:00:00.000Z", {
    criado_por_importacao: true,
  });
  const ag = await contato("05", "2026-10-11T16:00:00.000Z", {
    kind: "paciente",
  });
  const man = await contato("06", "2026-10-12T16:00:00.000Z");
  // Os tres leads (e o importado, que tem a linha e continua fora) nasceram
  // de mensagem, como a ingestao grava.
  await nascerDeMensagem(admin, [clinicId], [l1, l2, l3, imp]);
  // O cadastro manual ganha a autorizacao 'conversa' DEPOIS, pela equipe.
  const { data: criadoMan } = await admin
    .from("contact")
    .select("created_at")
    .eq("id", man)
    .single()
    .throwOnError();
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: man,
      channel: "whatsapp",
      source: "conversa",
      evidence: "Autorizou na conversa",
      created_at: new Date(
        Date.parse(criadoMan!.created_at as string) + 60_000,
      ).toISOString(),
    })
    .throwOnError();

  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Certa" })
    .select("id")
    .single()
    .throwOnError();
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
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: prof!.id,
      procedure_id: proc!.id,
      insurance_id: null,
      price_cents: 10000,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const consulta = async (
    contatoId: string,
    inicio: string,
    criadaEm: string,
    campos: Record<string, unknown> = {},
  ): Promise<string> => {
    const { data } = await admin
      .from("appointment")
      .insert({
        clinic_id: clinicId,
        contact_id: contatoId,
        professional_id: prof!.id,
        service_link_id: vinculo!.id,
        status: "agendado",
        starts_at: inicio,
        ends_at: new Date(Date.parse(inicio) + 30 * 60_000).toISOString(),
        created_at: criadaEm,
        ...campos,
      })
      .select("id")
      .single()
      .throwOnError();
    return data!.id as string;
  };

  const a1 = await consulta(
    l1,
    "2026-10-12T12:00:00.000Z",
    "2026-10-10T15:30:00.000Z",
  );
  const a4 = await consulta(
    l1,
    "2026-10-13T12:00:00.000Z",
    "2026-10-11T15:30:00.000Z",
    { created_by: "ia", approval_status: "pendente", remarcacao_de: a1 },
  );
  // A aprovacao cancela a antiga (remarcacao_na_aprovacao).
  await admin
    .from("appointment")
    .update({ approval_status: "aprovado" })
    .eq("id", a4)
    .throwOnError();
  await consulta(l2, "2026-10-13T13:00:00.000Z", "2026-10-11T15:40:00.000Z", {
    created_by: "ia",
    approval_status: "pendente",
  });
  await consulta(l3, "2026-10-13T14:00:00.000Z", "2026-10-12T15:30:00.000Z", {
    created_by: "ia",
    approval_status: "recusado",
    status: "cancelado_clinica",
  });
  await consulta(ag, "2026-10-12T13:00:00.000Z", "2026-10-11T16:30:00.000Z");

  // As passagens da IA: uma por camada, o pedido humano duas vezes, uma sem
  // motivo (nao conta) e uma fora do periodo.
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: l1,
      whatsapp_account_id: (await criarNumeroDeTeste(admin, clinicId)).id,
    })
    .select("id")
    .single()
    .throwOnError();
  conversaId = conversa!.id as string;
  const { data: mensagem } = await admin
    .from("message")
    .insert({
      clinic_id: clinicId,
      conversation_id: conversaId,
      direction: "entrada",
      author: "paciente",
      body: "Oi",
      created_at: "2026-10-11T12:00:00.000Z",
    })
    .select("id")
    .single()
    .throwOnError();
  const decisao = async (
    chave: string,
    criadaEm: string,
    campos: Record<string, unknown>,
  ) => {
    const { data } = await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: clinicId,
        conversation_id: conversaId,
        created_at: criadaEm,
        ...campos,
      })
      .select("id")
      .single()
      .throwOnError();
    decisoes[chave] = data!.id as string;
  };
  await decisao("portao", "2026-10-11T12:01:00.000Z", {
    gatilho_entrada: "sintoma",
    escalation_reason: "sintoma",
    desfecho: "escalou",
  });
  await decisao("filtro", "2026-10-11T12:02:00.000Z", {
    compliance_blocked: true,
    compliance_rule: "promessa_resultado",
    escalation_reason: "conformidade",
    desfecho: "bloqueou",
  });
  // A linha que a varredura de 3 minutos grava (ia_tirar_conversa).
  await decisao("falha", "2026-10-11T12:03:00.000Z", {
    escalation_reason: "falha_tecnica",
    desfecho: "falhou",
    motivo_da_falha: "prazo",
  });
  await decisao("agente1", "2026-10-12T12:00:00.000Z", {
    escalation_reason: "pedido_humano",
    desfecho: "escalou",
    message_id: mensagem!.id,
  });
  await decisao("agente2", "2026-10-13T12:00:00.000Z", {
    escalation_reason: "pedido_humano",
    desfecho: "escalou",
  });
  await decisao("sem_motivo", "2026-10-12T12:30:00.000Z", {});
  await decisao("fora", "2026-10-20T12:00:00.000Z", {
    escalation_reason: "sintoma",
    desfecho: "escalou",
  });
  await admin
    .from("ai_rascunho_bloqueado")
    .insert({
      clinic_id: clinicId,
      decision_id: decisoes.filtro,
      conversation_id: conversaId,
      job_id: randomUUID(),
      texto: "rascunho barrado de teste",
    })
    .throwOnError();
}, 60_000);

afterAll(async () => {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("lead de verdade (contato_e_lead)", () => {
  it("funil: só os três que nasceram de mensagem; importado, Agenda e cadastro manual fora", async () => {
    const funil = await rpc<{ atual: Funil }>("funil_do_periodo");
    expect(funil.atual.leads).toBe(3);
    expect(funil.atual.coorte.leads).toBe(3);
    expect(funil.atual.por_grupo).toEqual({ meta: 2, nao_rastreada: 1 });
  });

  it("série, campanhas e anúncios contam os mesmos três", async () => {
    const serie = await rpc<{ leads: number; agendadas: number }[]>(
      "serie_diaria_do_periodo",
    );
    expect(serie.reduce((soma, ponto) => soma + ponto.leads, 0)).toBe(3);
    const campanhas = await rpc<{ atual: { leads: number } }>(
      "campanhas_do_periodo",
    );
    expect(campanhas.atual.leads).toBe(3);
    const anuncios = await rpc<{ leads: number }>("anuncios_do_periodo");
    expect(anuncios.leads).toBe(3);
  });

  it("custo por lead: o divisor é o grupo Meta Ads (a origem Meta sem ids conta)", async () => {
    const campanhas = await rpc<{
      atual: {
        leads_de_anuncio: number;
        leads_de_anuncio_sem_campanha: number;
      };
    }>("campanhas_do_periodo");
    expect(campanhas.atual.leads_de_anuncio).toBe(2);
    expect(campanhas.atual.leads_de_anuncio_sem_campanha).toBe(2);
  });
});

describe("Agendou da Jornada e a remarcação pela IA", () => {
  it("funil: a pendente, a recusada e a nova da remarcação não são agendamento", async () => {
    const funil = await rpc<{ atual: Funil }>("funil_do_periodo");
    // A1 (da equipe) e A5 (da Agenda).
    expect(funil.atual.agendamentos_criados).toBe(2);
    // Dos leads, so L1 agendou: L2 esta pendente e L3 foi recusada.
    expect(funil.atual.coorte.agendaram).toBe(1);
    const serie = await rpc<{ agendadas: number }[]>("serie_diaria_do_periodo");
    expect(serie.reduce((soma, ponto) => soma + ponto.agendadas, 0)).toBe(2);
  });

  it("agenda: a antiga remarcada não é cancelamento e a nova não é criada no período", async () => {
    const agenda = await rpc<{
      atual: {
        total: number;
        criados: number;
        por_status: Record<string, number>;
      };
    }>("agenda_do_periodo");
    // Com inicio no periodo: A4 (a nova, aprovada) e A5. A1, cancelada pela
    // remarcacao, A2 pendente e A3 recusada ficam fora.
    expect(agenda.atual.total).toBe(2);
    expect(agenda.atual.criados).toBe(2);
    expect(agenda.atual.por_status).toEqual({ agendado: 2 });
  });

  it("agendamentos pela IA: nenhum (remarcação, pendente e recusada)", async () => {
    const atendimento = await rpc<{
      atual: { agente: { agendamentos: number } };
    }>("atendimento_do_periodo");
    expect(atendimento.atual.agente.agendamentos).toBe(0);
  });
});

describe("Por que foi para a equipe (passagens_da_ia_do_periodo)", () => {
  it("conta por motivo e camada, só com motivo e só no período", async () => {
    const passagens = await rpc<{
      total: number;
      por_motivo: { camada: string; motivo: string; passagens: number }[];
    }>("passagens_da_ia_do_periodo");
    expect(passagens.total).toBe(5);
    expect(passagens.por_motivo).toEqual([
      { camada: "agente", motivo: "pedido_humano", passagens: 2 },
      { camada: "falha", motivo: "falha_tecnica", passagens: 1 },
      { camada: "filtro", motivo: "conformidade", passagens: 1 },
      { camada: "portao", motivo: "sintoma", passagens: 1 },
    ]);
  });

  it("período sem passagem: total zero e lista vazia", async () => {
    const { data, error } = await admin.rpc("passagens_da_ia_do_periodo", {
      p_clinic_id: clinicId,
      p_de: "2026-01-01T03:00:00.000Z",
      p_ate: "2026-01-02T03:00:00.000Z",
    });
    expect(error).toBeNull();
    expect(data).toEqual({ total: 0, por_motivo: [] });
  });
});

describe("a trilha da IA não some com a conversa", () => {
  it("apagar a conversa deixa as decisões (sem conversa e sem mensagem) e tira o rascunho barrado", async () => {
    await admin
      .from("conversation")
      .delete()
      .eq("id", conversaId)
      .throwOnError();
    const { data: linhas } = await admin
      .from("ai_decision_log")
      .select("id, conversation_id, message_id")
      .eq("clinic_id", clinicId)
      .throwOnError();
    expect(linhas).toHaveLength(Object.keys(decisoes).length);
    for (const linha of linhas ?? []) {
      expect(linha.conversation_id).toBeNull();
      expect(linha.message_id).toBeNull();
    }
    const { data: rascunhos } = await admin
      .from("ai_rascunho_bloqueado")
      .select("id")
      .eq("clinic_id", clinicId)
      .throwOnError();
    expect(rascunhos).toEqual([]);
    // As passagens continuam na conta.
    const passagens = await rpc<{ total: number }>(
      "passagens_da_ia_do_periodo",
    );
    expect(passagens.total).toBe(5);
    // E cada decisao de conversa apagada conta sozinha nas transferidas.
    const atendimento = await rpc<{
      atual: { agente: { transferidas: number } };
    }>("atendimento_do_periodo");
    expect(atendimento.atual.agente.transferidas).toBe(5);
  });

  it("apagar a clínica continua levando as decisões (clinic_id em cascata)", async () => {
    const { data: outra } = await admin
      .from("clinic")
      .insert({
        name: `Metricas certas cascata ${sufixo}`,
        slug: `metricas-certas-cascata-${sufixo}`,
        e_de_teste: true,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: contato } = await admin
      .from("contact")
      .insert({ clinic_id: outra!.id, phone_e164: "+5584990062399" })
      .select("id")
      .single()
      .throwOnError();
    const { data: conversa } = await admin
      .from("conversation")
      .insert({
        clinic_id: outra!.id,
        contact_id: contato!.id,
        whatsapp_account_id: (await criarNumeroDeTeste(admin, outra!.id)).id,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("ai_decision_log")
      .insert({
        clinic_id: outra!.id,
        conversation_id: conversa!.id,
        escalation_reason: "sintoma",
      })
      .throwOnError();
    await admin.from("clinic").delete().eq("id", outra!.id).throwOnError();
    const { data: sobrou } = await admin
      .from("ai_decision_log")
      .select("id")
      .eq("clinic_id", outra!.id)
      .throwOnError();
    expect(sobrou).toEqual([]);
  });
});
