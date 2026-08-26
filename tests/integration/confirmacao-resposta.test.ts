import { afterAll, describe, expect, it } from "vitest";

import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
import { adminClient } from "../rls/stack";

// Aceite da tarefa 4.7 contra o banco REAL: "o paciente toca em Confirmar e o
// status da agenda muda sozinho, com autoria registrada".
//
// Toda clínica daqui nasce com whatsapp_account provider 'fake': o canal desta
// máquina é real (uazapi) e nenhum teste pode encostar nele. O interceptador
// não envia nada por conta própria (só enfileira o eco), mas a clínica de
// teste é isolada mesmo assim.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

type Cenario = {
  clinicId: string;
  contactId: string;
  conversationId: string;
  appointmentId: string;
  stepId: string;
};

/**
 * Clínica descartável com uma consulta futura já TOCADA: a cadence_run com
 * sent_at é exatamente o estado em que o toque de confirmação deixa o mundo.
 */
async function montarCenario(
  nome: string,
  telefone: string,
  opcoes: { comToque?: boolean } = {},
): Promise<Cenario> {
  const { comToque = true } = opcoes;
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Resposta ${nome} ${sufixo}`,
      slug: `resposta-${nome}-${sufixo}`,
    })
    .select("id")
    .single()
    .throwOnError();
  const clinicId = clinica!.id as string;
  clinicasCriadas.push(clinicId);

  await admin
    .from("whatsapp_account")
    .insert({
      clinic_id: clinicId,
      provider: "fake",
      connection_status: "conectado",
    })
    .throwOnError();

  const { data: profissional } = await admin
    .from("professional")
    .insert({ clinic_id: clinicId, name: "Dra. Resposta" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procedimento } = await admin
    .from("procedure")
    .insert({
      clinic_id: clinicId,
      name: "Consulta",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: clinicId,
      professional_id: profissional!.id,
      procedure_id: procedimento!.id,
      insurance_id: null,
      price_cents: 10000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: telefone,
      name: "Paciente Resposta",
    })
    .select("id")
    .single()
    .throwOnError();
  const contactId = contato!.id as string;
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      channel: "whatsapp",
      source: "recepcao",
    })
    .throwOnError();

  const inicio = new Date(Date.now() + 3 * HORA);
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      professional_id: profissional!.id,
      service_link_id: vinculo!.id,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      status: "aguardando_confirmacao",
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: conversationId } = await admin
    .rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    })
    .throwOnError();

  const { data: passo } = await admin
    .from("cadence_step")
    .select("id, cadence:cadence_id!inner ( kind )")
    .eq("clinic_id", clinicId)
    .eq("offset_minutes", -180)
    .single()
    .throwOnError();

  if (comToque) {
    await admin
      .from("cadence_run")
      .insert({
        clinic_id: clinicId,
        cadence_step_id: passo!.id,
        contact_id: contactId,
        appointment_id: consulta!.id,
        scheduled_for: new Date(inicio.getTime() - 180 * MINUTO).toISOString(),
        sent_at: new Date().toISOString(),
      })
      .throwOnError();
  }

  return {
    clinicId,
    contactId,
    conversationId: conversationId as unknown as string,
    appointmentId: consulta!.id as string,
    stepId: passo!.id as string,
  };
}

async function responder(cenario: Cenario, body: string): Promise<void> {
  await interceptarRespostaDePaciente(admin, {
    clinicId: cenario.clinicId,
    contactId: cenario.contactId,
    conversationId: cenario.conversationId,
    body,
    contentType: "texto",
  });
}

async function statusDaConsulta(cenario: Cenario) {
  const { data } = await admin
    .from("appointment")
    .select("status, confirmation_channel, confirmed_by_user_id")
    .eq("id", cenario.appointmentId)
    .single();
  return data as {
    status: string;
    confirmation_channel: string | null;
    confirmed_by_user_id: string | null;
  };
}

async function ecosDaClinica(clinicId: string) {
  const { data } = await admin
    .from("job_queue")
    .select("payload")
    .eq("clinic_id", clinicId)
    .eq("kind", "enviar_mensagem_ativa");
  return (data ?? []) as { payload: { body?: string } }[];
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("resposta do paciente ao toque de confirmação", () => {
  it("'Confirmar' muda o status sozinho, com autoria do paciente", async () => {
    const cenario = await montarCenario("confirma", "+5584962000001");

    await responder(cenario, "Confirmar");

    const consulta = await statusDaConsulta(cenario);
    expect(consulta.status).toBe("confirmado_paciente");
    expect(consulta.confirmation_channel).toBe("whatsapp");
    // Paciente não é usuário: a autoria vive no status e na trilha.
    expect(consulta.confirmed_by_user_id).toBeNull();

    const { data: historico } = await admin
      .from("appointment_status_history")
      .select("status, changed_by, changed_by_user_id")
      .eq("appointment_id", cenario.appointmentId)
      .eq("status", "confirmado_paciente");
    expect(historico).toHaveLength(1);
    expect(historico?.[0]).toMatchObject({
      changed_by: "paciente",
      changed_by_user_id: null,
    });

    // Eco na fila, nunca envio direto no webhook.
    const ecos = await ecosDaClinica(cenario.clinicId);
    expect(ecos).toHaveLength(1);
    expect(ecos[0]?.payload.body).toContain("confirmada");
  });

  it("resposta repetida não confirma duas vezes nem manda dois ecos", async () => {
    const cenario = await montarCenario("repete", "+5584962000002");

    await responder(cenario, "1");
    await responder(cenario, "sim");

    const { data: historico } = await admin
      .from("appointment_status_history")
      .select("id")
      .eq("appointment_id", cenario.appointmentId)
      .eq("status", "confirmado_paciente");
    expect(historico).toHaveLength(1);
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(1);
  });

  it("'3' cancela a consulta pelo paciente", async () => {
    const cenario = await montarCenario("cancela", "+5584962000003");

    await responder(cenario, "3");

    const consulta = await statusDaConsulta(cenario);
    expect(consulta.status).toBe("cancelado_paciente");
    const ecos = await ecosDaClinica(cenario.clinicId);
    expect(ecos).toHaveLength(1);
    expect(ecos[0]?.payload.body).toContain("cancelada");
  });

  it("'2' (remarcar) NÃO mexe no status e chama a recepção", async () => {
    const cenario = await montarCenario("remarca", "+5584962000004");

    await responder(cenario, "2");

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    const ecos = await ecosDaClinica(cenario.clinicId);
    expect(ecos).toHaveLength(1);
    expect(ecos[0]?.payload.body).toContain("recepção");
  });

  it("sem toque enviado não existe contexto: nada muda", async () => {
    const cenario = await montarCenario("semcontexto", "+5584962000005", {
      comToque: false,
    });

    await responder(cenario, "Confirmar");

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);
  });

  it("frase que não é resposta de menu cai para a recepção", async () => {
    const cenario = await montarCenario("naolida", "+5584962000006");

    await responder(cenario, "não vou poder confirmar agora, depois eu falo");

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);
  });

  // O achado mais perigoso da revisão: o paciente responde ao toque de
  // RECUPERAÇÃO DEPOIS DA FALTA ("Ainda dá tempo de remarcar?") e, como ele
  // também tem uma consulta futura com confirmação enviada na semana, o "sim"
  // era lido como confirmação daquela outra consulta. A pessoa nunca disse que
  // vem, e a agenda passava a contar com ela.
  it("resposta ao toque de pós falta não confirma a consulta futura", async () => {
    const cenario = await montarCenario("posfalta", "+5584964000090");

    // O toque de recuperação sai DEPOIS do de confirmação: é o último que o
    // paciente leu, então é a ele que a resposta se refere.
    const { data: passoPosFalta } = await admin
      .from("cadence_step")
      .select("id, cadence:cadence_id!inner ( kind )")
      .eq("clinic_id", cenario.clinicId)
      .eq("offset_minutes", 2880)
      .single()
      .throwOnError();
    await admin
      .from("cadence_run")
      .insert({
        clinic_id: cenario.clinicId,
        cadence_step_id: passoPosFalta!.id,
        contact_id: cenario.contactId,
        appointment_id: null,
        scheduled_for: new Date().toISOString(),
        sent_at: new Date(Date.now() + MINUTO).toISOString(),
      })
      .throwOnError();

    await responder(cenario, "sim");

    const consulta = await statusDaConsulta(cenario);
    expect(consulta.status).toBe("aguardando_confirmacao");
    expect(consulta.confirmation_channel).toBeNull();
    // Nada de eco automático: a conversa fica com a recepção, que é o
    // comportamento seguro quando o sistema não sabe do que se fala.
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);
  });

  it("áudio nunca vira decisão automática", async () => {
    const cenario = await montarCenario("audio", "+5584962000007");

    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: cenario.contactId,
      conversationId: cenario.conversationId,
      body: "confirmar",
      contentType: "audio",
    });

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);
  });
});
