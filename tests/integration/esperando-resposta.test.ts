import { afterAll, describe, expect, it } from "vitest";

import { resetFakeProvider } from "@/lib/integrations/whatsapp/fake";
import { interceptarRespostaDePaciente } from "@/lib/integrations/whatsapp/interceptar-resposta";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp/send";
import { adminClient } from "../rls/stack";

// conversation.awaiting_reply é o sinal que o contador de Atendimento usa e que
// ordena o Inbox: "a última mensagem veio do paciente e ninguém respondeu".
//
// Ele existe porque as duas colunas óbvias respondem outra pergunta:
// - status 'aguardando_humano' conta também a conversa que a RÉGUA abriu só
//   para enviar a confirmação, e numa manhã de 40 disparos o contador mostrava
//   40 com a mensagem de paciente de verdade enterrada;
// - unread_count zera quando alguém apenas ABRE a conversa para ler, e a
//   recepcionista que leu e saiu para o balcão perdia o lembrete.
//
// Cada it() abaixo é uma dessas armadilhas.

const admin = adminClient();
const sufixo = Date.now().toString(36);
const clinicasCriadas: string[] = [];

type Cenario = {
  clinicId: string;
  contactId: string;
  conversationId: string;
};

async function montarCenario(nome: string, telefone: string): Promise<Cenario> {
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Espera ${nome} ${sufixo}`,
      slug: `espera-${nome}-${sufixo}`,
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

  const { data: contato } = await admin
    .from("contact")
    .insert({ clinic_id: clinicId, phone_e164: telefone, name: "Paciente" })
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

  const { data: conversationId } = await admin
    .rpc("garantir_conversa_aberta", {
      p_clinic_id: clinicId,
      p_contact_id: contactId,
    })
    .throwOnError();

  return {
    clinicId,
    contactId,
    conversationId: conversationId as unknown as string,
  };
}

async function conversa(cenario: Cenario) {
  const { data } = await admin
    .from("conversation")
    .select("status, unread_count, awaiting_reply")
    .eq("id", cenario.conversationId)
    .single();
  return data as {
    status: string;
    unread_count: number;
    awaiting_reply: boolean;
  };
}

async function pacienteEscreve(
  cenario: Cenario,
  telefone: string,
  waId: string,
): Promise<void> {
  await admin
    .rpc("ingest_inbound_message", {
      p_clinic_id: cenario.clinicId,
      p_phone_e164: telefone,
      p_name: "Paciente",
      p_wa_message_id: waId,
      p_content_type: "texto",
      p_body: "Preciso remarcar",
    })
    .throwOnError();
}

/** Consulta futura com o toque de confirmação já enviado, que é o contexto que
 * o interceptador procura para saber a que pergunta o paciente respondeu. */
async function consultaComToque(cenario: Cenario): Promise<string> {
  const { data: profissional } = await admin
    .from("professional")
    .insert({ clinic_id: cenario.clinicId, name: "Dr. Espera" })
    .select("id")
    .single()
    .throwOnError();
  const { data: procedimento } = await admin
    .from("procedure")
    .insert({
      clinic_id: cenario.clinicId,
      name: "Consulta",
      default_duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();
  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: cenario.clinicId,
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

  const inicio = new Date(Date.now() + 20 * 60 * 60_000);
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: cenario.clinicId,
      contact_id: cenario.contactId,
      professional_id: profissional!.id,
      service_link_id: vinculo!.id,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      status: "aguardando_confirmacao",
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: passo } = await admin
    .from("cadence_step")
    .select("id")
    .eq("clinic_id", cenario.clinicId)
    .eq("offset_minutes", -1440)
    .single()
    .throwOnError();

  await admin
    .from("cadence_run")
    .insert({
      clinic_id: cenario.clinicId,
      cadence_step_id: passo!.id,
      contact_id: cenario.contactId,
      appointment_id: consulta!.id,
      scheduled_for: new Date(inicio.getTime() - 1440 * 60_000).toISOString(),
      sent_at: new Date().toISOString(),
    })
    .throwOnError();

  return consulta!.id as string;
}

afterAll(async () => {
  for (const clinicId of clinicasCriadas) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

describe("conversation.awaiting_reply", () => {
  it("conversa aberta pela régua não conta como esperando resposta", async () => {
    const cenario = await montarCenario("regua", "+5584965000001");

    // garantir_conversa_aberta é o que o executor da régua chama antes de
    // enviar. A conversa nasce aguardando_humano por causa do compositor, mas
    // ninguém está esperando por ninguém: o paciente nem escreveu.
    const antes = await conversa(cenario);
    expect(antes.status).toBe("aguardando_humano");
    expect(antes.awaiting_reply).toBe(false);
  });

  it("o paciente escrevendo liga a espera", async () => {
    const telefone = "+5584965000002";
    const cenario = await montarCenario("paciente", telefone);

    await pacienteEscreve(cenario, telefone, `wa-espera-${sufixo}-1`);

    const depois = await conversa(cenario);
    expect(depois.awaiting_reply).toBe(true);
    expect(depois.unread_count).toBe(1);
  });

  it("marcar como lida NÃO desliga a espera", async () => {
    const telefone = "+5584965000003";
    const cenario = await montarCenario("lida", telefone);
    await pacienteEscreve(cenario, telefone, `wa-espera-${sufixo}-2`);

    // É o que o Inbox faz quando alguém abre a conversa.
    await admin
      .from("conversation")
      .update({ unread_count: 0 })
      .eq("id", cenario.conversationId)
      .throwOnError();

    const depois = await conversa(cenario);
    expect(depois.unread_count).toBe(0);
    expect(depois.awaiting_reply).toBe(true);
  });

  it("o toque automático da régua não apaga a pergunta do paciente", async () => {
    resetFakeProvider();
    const telefone = "+5584965000004";
    const cenario = await montarCenario("automatico", telefone);
    await pacienteEscreve(cenario, telefone, `wa-espera-${sufixo}-3`);

    await sendWhatsAppText(admin, {
      clinicId: cenario.clinicId,
      conversationId: cenario.conversationId,
      contactId: cenario.contactId,
      body: "Sua consulta é amanhã às 10:00. Podemos confirmar?",
      authorUserId: null,
      author: "sistema",
    });

    // A máquina falou por cima; a pergunta da pessoa continua sem resposta.
    expect((await conversa(cenario)).awaiting_reply).toBe(true);
  });

  it("resposta que a máquina resolveu sozinha sai do contador", async () => {
    resetFakeProvider();
    const telefone = "+5584965000006";
    const cenario = await montarCenario("resolvido", telefone);
    const consultaId = await consultaComToque(cenario);
    await pacienteEscreve(cenario, telefone, `wa-espera-${sufixo}-5`);
    expect((await conversa(cenario)).awaiting_reply).toBe(true);

    // O paciente toca "Confirmar": o sistema muda o status e responde sozinho.
    // Ninguém da clínica precisa agir, então a conversa não pode continuar
    // inflando o contador de Atendimento. Numa manhã com 30 confirmações, o
    // badge mostraria 31 e a única conversa que precisa de gente ficaria
    // perdida no meio.
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: cenario.contactId,
      conversationId: cenario.conversationId,
      body: "1",
      contentType: "texto",
    });

    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("id", consultaId)
      .single();
    expect(consulta?.status).toBe("confirmado_paciente");
    expect((await conversa(cenario)).awaiting_reply).toBe(false);
  });

  it("pedido de remarcação CONTINUA esperando, porque alguém precisa agir", async () => {
    resetFakeProvider();
    const telefone = "+5584965000007";
    const cenario = await montarCenario("remarcar", telefone);
    await consultaComToque(cenario);
    await pacienteEscreve(cenario, telefone, `wa-espera-${sufixo}-6`);

    // "Nossa recepção vai falar com você": a promessa só se cumpre se a
    // conversa continuar no contador.
    await interceptarRespostaDePaciente(admin, {
      clinicId: cenario.clinicId,
      contactId: cenario.contactId,
      conversationId: cenario.conversationId,
      body: "2",
      contentType: "texto",
    });

    expect((await conversa(cenario)).awaiting_reply).toBe(true);
  });

  it("resposta de uma PESSOA desliga a espera", async () => {
    resetFakeProvider();
    const telefone = "+5584965000005";
    const cenario = await montarCenario("humano", telefone);
    await pacienteEscreve(cenario, telefone, `wa-espera-${sufixo}-4`);

    await sendWhatsAppText(admin, {
      clinicId: cenario.clinicId,
      conversationId: cenario.conversationId,
      contactId: cenario.contactId,
      body: "Oi! Consigo te encaixar na quinta às 15:00, serve?",
      authorUserId: null,
      author: "usuario",
    });

    expect((await conversa(cenario)).awaiting_reply).toBe(false);
  });
});
