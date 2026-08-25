import { afterAll, describe, expect, it } from "vitest";

import { ingerirMensagemRecebida } from "@/lib/integrations/whatsapp/ingest";
import type { InboundEvent } from "@/lib/integrations/whatsapp/inbound";
import { adminClient } from "../rls/stack";

// Fase 4, tarefas 4.1 e 4.2, contra o banco REAL. ACEITE 4.2 do backlog:
// "lead vindo de anuncio com parametro chega com campanha preenchida sem
// ninguem digitar nada". Cobre a atribuicao pela ingestao, a origem
// preservada para sempre, os triggers de funil (agendar e comparecer), o
// consumo de sessao de pacote e a constraint de motivo de perda, todos da
// migration 20260825100000. Cada cenario usa a propria clinica descartavel.

const CHECK_VIOLATION = "23514";

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

type MensagemRecebida = Extract<InboundEvent, { kind: "message_received" }>;

type AgendaMinima = {
  profissionalId: string;
  procedimentoId: string;
  vinculoId: string;
};

async function criarClinica(nome: string): Promise<string> {
  const { data } = await admin
    .from("clinic")
    .insert({ name: `Funil ${nome} ${sufixo}`, slug: `fun-${nome}-${sufixo}` })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = data!.id as string;
  clinicasCriadas.push(clinicId);
  return clinicId;
}

async function criarContato(
  clinicId: string,
  telefone: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const { data } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Contato Funil",
      ...extras,
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

// Molde minimo de agenda: profissional + procedimento + vinculo particular.
async function criarAgendaMinima(clinicId: string): Promise<AgendaMinima> {
  const { data: prof } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Funil" })
    .select("id")
    .single()
    .throwOnError();
  const { data: proc } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Sessao de teste",
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
      price_cents: 20000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    profissionalId: prof!.id as string,
    procedimentoId: proc!.id as string,
    vinculoId: vinculo!.id as string,
  };
}

function slot(horaInicio: string, horaFim: string) {
  return {
    starts_at: `2026-11-10T${horaInicio}:00-03:00`,
    ends_at: `2026-11-10T${horaFim}:00-03:00`,
  };
}

async function agendar(
  clinicId: string,
  contactId: string,
  agenda: AgendaMinima,
  horaInicio: string,
  horaFim: string,
  vinculoId?: string,
): Promise<string> {
  const { data } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      professional_id: agenda.profissionalId,
      service_link_id: vinculoId ?? agenda.vinculoId,
      ...slot(horaInicio, horaFim),
    })
    .select("id")
    .single()
    .throwOnError();
  return data!.id as string;
}

async function marcarCompareceu(appointmentId: string): Promise<void> {
  await admin
    .from("appointment")
    .update({ status: "compareceu" })
    .eq("id", appointmentId)
    .throwOnError();
}

async function funilDe(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select("funnel_stage, lost_reason, lost_reason_note")
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!;
}

async function origemDe(contactId: string) {
  const { data } = await admin
    .from("contact")
    .select(
      "source_channel, source_campaign, source_method, source_captured_at",
    )
    .eq("id", contactId)
    .single()
    .throwOnError();
  return data!;
}

function evento(
  phone: string,
  waMessageId: string,
  body: string,
): MensagemRecebida {
  return {
    kind: "message_received",
    phone,
    name: "Paciente Funil",
    waMessageId,
    contentType: "texto",
    body,
    mediaUrl: null,
    instanceToken: null,
  };
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("aceite 4.2: atribuição de origem na ingestão", () => {
  it("lead de anúncio com token chega com campanha preenchida sem ninguém digitar nada", async () => {
    const clinicId = await criarClinica("token");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Botox Setembro",
        token: "C7K3F9",
        channel: "trafego_pago",
        campaign: "Botox Setembro",
      })
      .throwOnError();

    const { data, error } = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento(
        "+5584971100001",
        `fun:${sufixo}:a1`,
        "Ola! Quero agendar uma avaliacao [#c7k3f9]",
      ),
    );
    expect(error).toBeNull();
    expect(data?.inserted).toBe(true);
    expect(data?.contact_created).toBe(true);

    const origem = await origemDe(data!.contact_id!);
    expect(origem).toMatchObject({
      source_campaign: "Botox Setembro",
      source_channel: "trafego_pago",
      source_method: "link_token",
    });
    expect(origem.source_captured_at).not.toBeNull();
  });

  it("segunda mensagem com OUTRO token válido não reatribui a origem", async () => {
    const clinicId = await criarClinica("reatr");
    await admin
      .from("campaign_link")
      .insert([
        {
          clinic_id: clinicId,
          name: "Campanha Um",
          token: "C7K3F9",
          channel: "trafego_pago",
          campaign: "Campanha Um",
        },
        {
          clinic_id: clinicId,
          name: "Campanha Dois",
          token: "D8M4G2",
          channel: "redes_sociais",
          campaign: "Campanha Dois",
        },
      ])
      .throwOnError();

    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento("+5584971100002", `fun:${sufixo}:b1`, "Oi [#C7K3F9]"),
    );
    expect(primeira.error).toBeNull();
    expect(primeira.data?.contact_created).toBe(true);

    const segunda = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento(
        "+5584971100002",
        `fun:${sufixo}:b2`,
        "Vi outro anuncio tambem [#D8M4G2]",
      ),
    );
    expect(segunda.error).toBeNull();
    expect(segunda.data?.contact_created).toBe(false);
    expect(segunda.data?.contact_id).toBe(primeira.data?.contact_id);

    // A origem da primeira campanha ficou intacta.
    const origem = await origemDe(primeira.data!.contact_id!);
    expect(origem.source_campaign).toBe("Campanha Um");
    expect(origem.source_channel).toBe("trafego_pago");
  });

  it("nem o service role troca origem já capturada (trigger preserva)", async () => {
    const clinicId = await criarClinica("origem");
    const contatoId = await criarContato(clinicId, "+5584971100003", {
      source_channel: "indicacao",
      source_method: "manual",
      source_captured_at: new Date().toISOString(),
    });

    const { error } = await admin
      .from("contact")
      .update({ source_channel: "trafego_pago" })
      .eq("id", contatoId);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("preservada");
  });
});

describe("funil automático (triggers de appointment)", () => {
  it("agendar avança para 'agendou', comparecer vai ao topo e nunca regride", async () => {
    const clinicId = await criarClinica("etapas");
    const agenda = await criarAgendaMinima(clinicId);
    const contatoId = await criarContato(clinicId, "+5584971200001");

    const consultaId = await agendar(
      clinicId,
      contatoId,
      agenda,
      "09:00",
      "09:30",
    );
    expect((await funilDe(contatoId)).funnel_stage).toBe("agendou");

    await marcarCompareceu(consultaId);
    expect((await funilDe(contatoId)).funnel_stage).toBe("compareceu");

    // Nova consulta de quem ja compareceu NAO rebaixa a etapa.
    await agendar(clinicId, contatoId, agenda, "10:00", "10:30");
    expect((await funilDe(contatoId)).funnel_stage).toBe("compareceu");
  });

  it("lead perdido que agenda deixa de estar perdido e o motivo é limpo", async () => {
    const clinicId = await criarClinica("perdido");
    const agenda = await criarAgendaMinima(clinicId);
    const contatoId = await criarContato(clinicId, "+5584971200002", {
      funnel_stage: "perdido",
      lost_reason: "preco",
    });

    await agendar(clinicId, contatoId, agenda, "09:00", "09:30");

    const funil = await funilDe(contatoId);
    expect(funil.funnel_stage).toBe("agendou");
    expect(funil.lost_reason).toBeNull();
    expect(funil.lost_reason_note).toBeNull();
  });
});

describe("consumo de sessão de pacote no comparecimento", () => {
  it("debita a sessão certa, ignora procedimento diferente e para no saldo cheio", async () => {
    const clinicId = await criarClinica("pacote");
    const agenda = await criarAgendaMinima(clinicId);
    const contatoId = await criarContato(clinicId, "+5584971300001");

    // Segundo procedimento do MESMO profissional, fora do pacote.
    const { data: procOutro } = await admin
      .from("procedure")
      .insert({ clinic_id: clinicId, name: "Outro procedimento" })
      .select("id")
      .single()
      .throwOnError();
    const { data: vinculoOutro } = await admin
      .from("service_link")
      .insert({
        clinic_id: clinicId,
        professional_id: agenda.profissionalId,
        procedure_id: procOutro!.id,
        insurance_id: null,
        price_cents: 10000,
        covered_by_insurance: false,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();

    const { data: pacote } = await admin
      .from("package")
      .insert({
        clinic_id: clinicId,
        procedure_id: agenda.procedimentoId,
        sessions: 2,
        price_cents: 100000,
      })
      .select("id")
      .single()
      .throwOnError();
    const { data: saldo } = await admin
      .from("package_balance")
      .insert({
        clinic_id: clinicId,
        contact_id: contatoId,
        package_id: pacote!.id,
        sessions_total: 2,
      })
      .select("id")
      .single()
      .throwOnError();
    const saldoId = saldo!.id as string;

    const sessoesUsadas = async (): Promise<number> => {
      const { data } = await admin
        .from("package_balance")
        .select("sessions_used")
        .eq("id", saldoId)
        .single()
        .throwOnError();
      return data!.sessions_used as number;
    };
    const saldoDebitado = async (consultaId: string) => {
      const { data } = await admin
        .from("appointment")
        .select("package_balance_id")
        .eq("id", consultaId)
        .single()
        .throwOnError();
      return data!.package_balance_id as string | null;
    };

    // 1a sessao do procedimento do pacote: debita e vincula.
    const consulta1 = await agendar(
      clinicId,
      contatoId,
      agenda,
      "09:00",
      "09:30",
    );
    await marcarCompareceu(consulta1);
    expect(await sessoesUsadas()).toBe(1);
    expect(await saldoDebitado(consulta1)).toBe(saldoId);

    // Procedimento diferente NAO consome, mesmo com saldo disponivel.
    const consultaOutra = await agendar(
      clinicId,
      contatoId,
      agenda,
      "10:00",
      "10:30",
      vinculoOutro!.id as string,
    );
    await marcarCompareceu(consultaOutra);
    expect(await sessoesUsadas()).toBe(1);
    expect(await saldoDebitado(consultaOutra)).toBeNull();

    // 2a sessao do pacote: esgota o saldo.
    const consulta2 = await agendar(
      clinicId,
      contatoId,
      agenda,
      "11:00",
      "11:30",
    );
    await marcarCompareceu(consulta2);
    expect(await sessoesUsadas()).toBe(2);
    expect(await saldoDebitado(consulta2)).toBe(saldoId);

    // 3a: saldo cheio, a consulta e avulsa e o saldo nao estoura.
    const consulta3 = await agendar(
      clinicId,
      contatoId,
      agenda,
      "12:00",
      "12:30",
    );
    await marcarCompareceu(consulta3);
    expect(await sessoesUsadas()).toBe(2);
    expect(await saldoDebitado(consulta3)).toBeNull();
  });
});

describe("constraint de motivo de perda", () => {
  it("mover para 'perdido' sem motivo falha com 23514", async () => {
    const clinicId = await criarClinica("motivo");
    const contatoId = await criarContato(clinicId, "+5584971400001");

    const { error } = await admin
      .from("contact")
      .update({ funnel_stage: "perdido" })
      .eq("id", contatoId);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

// Regressoes da revisao adversarial do bloco (25/08/2026).
describe("correções da revisão: descadastro, coerência de clínica e token tardio", () => {
  it("mensagem recebida DEPOIS da revogação não reativa o consentimento", async () => {
    const clinicId = await criarClinica("revog");
    const telefone = "+5584971500001";

    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento(telefone, `fun:${sufixo}:r1`, "Oi, quero informacoes"),
    );
    const contatoId = primeira.data!.contact_id!;

    const vigente = async (): Promise<boolean> => {
      const { data } = await admin.rpc("consentimento_vigente", {
        p_clinic_id: clinicId,
        p_contact_id: contatoId,
        p_channel: "whatsapp",
      });
      return data === true;
    };
    expect(await vigente()).toBe(true);

    // Descadastro (mesmo update da revogarConsentimentoAction).
    await admin
      .from("contact_consent")
      .update({ revoked_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
      .eq("contact_id", contatoId)
      .is("revoked_at", null)
      .throwOnError();
    expect(await vigente()).toBe(false);

    // O paciente escreve de novo: a ingestao NAO recria o consentimento.
    const segunda = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento(telefone, `fun:${sufixo}:r2`, "Por que voces pararam de responder?"),
    );
    expect(segunda.error).toBeNull();
    expect(segunda.data?.inserted).toBe(true);
    expect(await vigente()).toBe(false);
  });

  it("consulta e saldo de pacote não nascem referenciando contato de OUTRA clínica", async () => {
    const clinicA = await criarClinica("coera");
    const clinicB = await criarClinica("coerb");
    const agendaA = await criarAgendaMinima(clinicA);
    const contatoDeB = await criarContato(clinicB, "+5584971500002");

    const { error: erroConsulta } = await admin.from("appointment").insert({
      clinic_id: clinicA,
      contact_id: contatoDeB,
      professional_id: agendaA.profissionalId,
      service_link_id: agendaA.vinculoId,
      ...slot("14:00", "14:30"),
    });
    expect(erroConsulta?.message).toContain("não pertence");

    const { data: pacote } = await admin
      .from("package")
      .insert({
        clinic_id: clinicA,
        procedure_id: agendaA.procedimentoId,
        sessions: 5,
        price_cents: 50000,
      })
      .select("id")
      .single()
      .throwOnError();
    const { error: erroSaldo } = await admin.from("package_balance").insert({
      clinic_id: clinicA,
      contact_id: contatoDeB,
      package_id: pacote!.id,
      sessions_total: 5,
    });
    expect(erroSaldo?.message).toContain("não pertence");
  });

  it("contato pré-existente sem origem ganha atribuição por token, mas não por palavra-chave", async () => {
    const clinicId = await criarClinica("tardio");
    await admin
      .from("campaign_link")
      .insert({
        clinic_id: clinicId,
        name: "Campanha Tardia",
        token: "H5N7P2",
        channel: "trafego_pago",
        campaign: "Campanha Tardia",
        keywords: ["botox"],
      })
      .throwOnError();

    // Nasce SEM token (sem origem).
    const primeira = await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento("+5584971500003", `fun:${sufixo}:t1`, "Oi, tudo bem?"),
    );
    const contatoId = primeira.data!.contact_id!;
    expect((await origemDe(contatoId)).source_channel).toBeNull();

    // Palavra-chave em mensagem posterior NAO atribui (conversa comum).
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento("+5584971500003", `fun:${sufixo}:t2`, "Quanto custa o botox?"),
    );
    expect((await origemDe(contatoId)).source_channel).toBeNull();

    // Token em mensagem posterior atribui: sinal explicito vale sempre.
    await ingerirMensagemRecebida(
      admin,
      clinicId,
      evento("+5584971500003", `fun:${sufixo}:t3`, "Vim pelo anuncio [#H5N7P2]"),
    );
    const origem = await origemDe(contatoId);
    expect(origem.source_channel).toBe("trafego_pago");
    expect(origem.source_method).toBe("link_token");
  });
});
