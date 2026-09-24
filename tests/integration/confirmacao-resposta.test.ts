import { afterAll, describe, expect, it } from "vitest";

import { RESPOSTA_OFERTA_PERDIDA } from "@/lib/domain/textos-padrao";
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
  professionalId: string;
  serviceLinkId: string;
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
    professionalId: profissional!.id as string,
    serviceLinkId: vinculo!.id as string,
  };
}

/** A recepcionista escreve para o paciente DEPOIS do toque. */
async function mensagemDaRecepcao(cenario: Cenario): Promise<void> {
  await admin
    .from("message")
    .insert({
      clinic_id: cenario.clinicId,
      conversation_id: cenario.conversationId,
      direction: "saida",
      author: "usuario",
      content_type: "texto",
      body: "Tenho 1) terça 10h, 2) quarta 14h, 3) quinta 9h",
      created_at: new Date(Date.now() + 1000).toISOString(),
      billable: false,
      cost_cents: 0,
    })
    .throwOnError();
}

/** Segunda consulta do mesmo paciente, com o toque dela enviado DEPOIS. */
async function outraConsultaComToque(
  cenario: Cenario,
  emMs: number,
): Promise<string> {
  const inicio = new Date(Date.now() + emMs);
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: cenario.contactId,
      professional_id: cenario.professionalId,
      service_link_id: cenario.serviceLinkId,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * MINUTO).toISOString(),
      status: "aguardando_confirmacao",
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("cadence_run")
    .insert({
      clinic_id: cenario.clinicId,
      cadence_step_id: cenario.stepId,
      contact_id: cenario.contactId,
      appointment_id: consulta!.id,
      scheduled_for: new Date(inicio.getTime() - 180 * MINUTO).toISOString(),
      sent_at: new Date(Date.now() + 1000).toISOString(),
    })
    .throwOnError();
  return consulta!.id as string;
}

/**
 * A mensagem do menu do toque desta consulta, como a régua deixa o mundo:
 * cadence_run.message_id aponta para ela. Devolve o wa_message_id que o
 * botão tocado cita.
 */
async function menuDoToque(
  cenario: Cenario,
  appointmentId: string,
): Promise<string> {
  const waId = `wa-menu-${appointmentId}`;
  const { data: menu } = await admin
    .from("message")
    .insert({
      clinic_id: cenario.clinicId,
      conversation_id: cenario.conversationId,
      wa_message_id: waId,
      direction: "saida",
      author: "sistema",
      content_type: "texto",
      body: "Menu do toque (teste)",
      billable: false,
      cost_cents: 0,
    })
    .select("id")
    .single()
    .throwOnError();
  await admin
    .from("cadence_run")
    .update({ message_id: menu!.id })
    .eq("clinic_id", cenario.clinicId)
    .eq("appointment_id", appointmentId)
    .not("sent_at", "is", null)
    .throwOnError();
  return waId;
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
    // Um toque ainda por sair desta consulta: o pedido tem de fechá-lo.
    const { data: pendente } = await admin
      .from("cadence_run")
      .insert({
        clinic_id: cenario.clinicId,
        cadence_step_id: cenario.stepId,
        contact_id: cenario.contactId,
        appointment_id: cenario.appointmentId,
        scheduled_for: new Date(Date.now() + HORA).toISOString(),
      })
      .select("id")
      .single()
      .throwOnError();

    await responder(cenario, "2");

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    const ecos = await ecosDaClinica(cenario.clinicId);
    expect(ecos).toHaveLength(1);
    expect(ecos[0]?.payload.body).toContain("recepção");
    // O eco diz QUAL consulta (achado 61).
    expect(ecos[0]?.payload.body).toMatch(/\d{2}\/\d{2} às \d{2}:\d{2}/);

    // Achado 56: o pedido fica registrado, a régua para e a trilha mostra.
    const { data: consulta } = await admin
      .from("appointment")
      .select("remarcacao_pedida_em")
      .eq("id", cenario.appointmentId)
      .single();
    expect(consulta?.remarcacao_pedida_em).not.toBeNull();
    const { data: toque } = await admin
      .from("cadence_run")
      .select("skipped_reason")
      .eq("id", pendente!.id as string)
      .single();
    expect(toque?.skipped_reason).toBe("remarcacao_pedida");
    const { data: trilha } = await admin
      .from("appointment_status_history")
      .select("status, changed_by, event")
      .eq("appointment_id", cenario.appointmentId)
      .eq("event", "remarcacao_pedida");
    expect(trilha).toEqual([
      {
        status: "aguardando_confirmacao",
        changed_by: "paciente",
        event: "remarcacao_pedida",
      },
    ]);

    // "ok" para "nossa recepção vai falar com você" não confirma nada, e o
    // segundo "Remarcar" não repete eco.
    await responder(cenario, "ok");
    await responder(cenario, "Remarcar");
    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(1);

    // Mover a consulta atende o pedido: a marca some sozinha.
    await admin
      .from("appointment")
      .update({
        starts_at: new Date(Date.now() + 26 * HORA).toISOString(),
        ends_at: new Date(Date.now() + 26 * HORA + 30 * MINUTO).toISOString(),
      })
      .eq("id", cenario.appointmentId)
      .throwOnError();
    const { data: movida } = await admin
      .from("appointment")
      .select("remarcacao_pedida_em")
      .eq("id", cenario.appointmentId)
      .single();
    expect(movida?.remarcacao_pedida_em).toBeNull();
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

  // Achado 55: a recepcionista oferece horários numerados e o paciente
  // responde "3". Antes, "3" cancelava a consulta original.
  it("a recepção escreveu depois do toque: '3' e 'ok' são dela", async () => {
    const cenario = await montarCenario("humano", "+5584962000008");
    await mensagemDaRecepcao(cenario);

    await responder(cenario, "3");
    await responder(cenario, "ok");

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);
  });

  it("conversa assumida por alguém da clínica: nada é interpretado", async () => {
    const cenario = await montarCenario("assumida", "+5584962000009");
    await admin
      .from("conversation")
      .update({ status: "em_atendimento" })
      .eq("id", cenario.conversationId)
      .throwOnError();

    await responder(cenario, "Cancelar");

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);
  });

  // Achado 61: consulta e exame no mesmo dia, dois toques.
  it("duas consultas: sem citação fica com a recepção; com citação cancela a CERTA", async () => {
    const cenario = await montarCenario("duas", "+5584962000010");
    const outra = await outraConsultaComToque(cenario, 4 * HORA);

    await responder(cenario, "Cancelar");
    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
    expect(await ecosDaClinica(cenario.clinicId)).toHaveLength(0);

    // O botão tocado cita o menu do toque da PRIMEIRA consulta, mesmo com o
    // toque da segunda sendo o mais recente.
    const menu = await menuDoToque(cenario, cenario.appointmentId);
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: cenario.contactId,
      conversationId: cenario.conversationId,
      body: "cancelar",
      contentType: "texto",
      quotedWaMessageId: menu,
    });

    expect((await statusDaConsulta(cenario)).status).toBe("cancelado_paciente");
    const { data: segunda } = await admin
      .from("appointment")
      .select("status")
      .eq("id", outra)
      .single();
    expect(segunda?.status).toBe("aguardando_confirmacao");
    const ecos = await ecosDaClinica(cenario.clinicId);
    expect(ecos).toHaveLength(1);
    expect(ecos[0]?.payload.body).toMatch(/\d{2}\/\d{2} às \d{2}:\d{2}/);
    const { data: evento } = await admin
      .from("message")
      .select("id")
      .eq("conversation_id", cenario.conversationId)
      .eq("content_type", "evento")
      .like("body", "O paciente cancelou a consulta de %");
    expect(evento).toHaveLength(1);
  });

  // Achado 60: a oferta da lista de espera expirou, depois saiu o toque de
  // confirmação e o paciente tocou "Confirmar". Antes ele ouvia "esse
  // horário não está mais disponível" e a consulta ficava pendente.
  it("toque mais recente que a oferta: 'Confirmar' confirma a consulta", async () => {
    const cenario = await montarCenario("oferta", "+5584962000012");
    const duasHorasAtras = new Date(Date.now() - 2 * HORA).toISOString();
    const { data: oferta } = await admin
      .from("waitlist_offer")
      .insert({
        clinic_id: cenario.clinicId,
        source_appointment_id: cenario.appointmentId,
        professional_id: cenario.professionalId,
        slot_starts_at: new Date(Date.now() + 5 * HORA).toISOString(),
        slot_ends_at: new Date(Date.now() + 5 * HORA + 30 * MINUTO).toISOString(),
        expires_at: new Date(Date.now() - HORA).toISOString(),
        offered_to: [cenario.contactId],
        matched_waitlist_ids: [],
        status: "expirada",
        created_at: duasHorasAtras,
      })
      .select("id")
      .single()
      .throwOnError();
    // A mensagem da oferta SAIU para este contato (antes do toque).
    const { data: envio } = await admin
      .from("job_queue")
      .insert({
        clinic_id: cenario.clinicId,
        kind: "enviar_mensagem_ativa",
        status: "concluido",
        payload: {
          contact_id: cenario.contactId,
          body: "Oferta (teste)",
          offer_id: oferta!.id,
        },
        created_at: duasHorasAtras,
      })
      .select("id")
      .single()
      .throwOnError();
    await admin
      .from("message")
      .insert({
        clinic_id: cenario.clinicId,
        conversation_id: cenario.conversationId,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Oferta (teste)",
        job_id: envio!.id,
        delivery_status: "entregue",
        created_at: duasHorasAtras,
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();

    await responder(cenario, "Confirmar");

    expect((await statusDaConsulta(cenario)).status).toBe("confirmado_paciente");
    const ecos = (await ecosDaClinica(cenario.clinicId)).filter(
      (eco) => eco.payload.body !== "Oferta (teste)",
    );
    expect(ecos).toHaveLength(1);
    expect(ecos[0]?.payload.body).not.toBe(RESPOSTA_OFERTA_PERDIDA);
    expect(ecos[0]?.payload.body).toContain("Presença confirmada");
  });

  it("citar uma mensagem que não é o toque cala o interceptador", async () => {
    const cenario = await montarCenario("citaoutra", "+5584962000011");
    const waId = `wa-outra-${sufixo}`;
    await admin
      .from("message")
      .insert({
        clinic_id: cenario.clinicId,
        conversation_id: cenario.conversationId,
        wa_message_id: waId,
        direction: "saida",
        author: "sistema",
        content_type: "texto",
        body: "Mensagem qualquer do teste",
        billable: false,
        cost_cents: 0,
      })
      .throwOnError();

    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: cenario.contactId,
      conversationId: cenario.conversationId,
      body: "sim",
      contentType: "texto",
      quotedWaMessageId: waId,
    });

    expect((await statusDaConsulta(cenario)).status).toBe(
      "aguardando_confirmacao",
    );
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
