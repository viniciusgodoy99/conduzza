import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp/send";
import { adminClient } from "../rls/stack";

// Aceite da tarefa 1.4: envio para contato sem consentimento ativo e
// RECUSADO e REGISTRADO (audit_log), sem criar message. Com consentimento,
// envia pelo provedor falso e grava a saida com custo zero.
// Clinica descartavel propria; provider fake via env padrao.

const suffix = crypto.randomUUID().slice(0, 8);
const admin = adminClient();

let clinicId: string;
let userId: string;
let contactComConsent: string;
let contactSemConsent: string;
let conversationId: string;

beforeAll(async () => {
  resetFakeProvider();

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: `send-${suffix}@teste.dev`,
    password: `Send-${suffix}!1`,
    email_confirm: true,
  });
  if (userError || !user.user) {
    throw new Error(`usuário: ${userError?.message}`);
  }
  userId = user.user.id;

  const { data: clinic, error: clinicError } = await admin
    .from("clinic")
    .insert({ name: `Send ${suffix}`, slug: `send-${suffix}` })
    .select("id")
    .single();
  if (clinicError || !clinic) {
    throw new Error(`clinic: ${clinicError?.message}`);
  }
  clinicId = clinic.id;

  await admin.from("whatsapp_account").insert({
    clinic_id: clinicId,
    provider: "fake",
    connection_status: "conectado",
  });
  await admin.from("whatsapp_account_secret").insert({ clinic_id: clinicId });

  const { data: contacts, error: contactError } = await admin
    .from("contact")
    .insert([
      {
        clinic_id: clinicId,
        phone_e164: `+5584914${suffix.slice(0, 5)}1`,
        name: "Com Consentimento",
      },
      {
        clinic_id: clinicId,
        phone_e164: `+5584914${suffix.slice(0, 5)}2`,
        name: "Sem Consentimento",
      },
    ])
    .select("id, name");
  if (contactError || contacts?.length !== 2) {
    throw new Error(`contact: ${contactError?.message}`);
  }
  contactComConsent = contacts.find((c) => c.name === "Com Consentimento")!.id;
  contactSemConsent = contacts.find((c) => c.name === "Sem Consentimento")!.id;

  await admin.from("contact_consent").insert({
    clinic_id: clinicId,
    contact_id: contactComConsent,
    source: "conversa",
  });

  const { data: conversation } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contactComConsent,
      status: "em_atendimento",
      assignee_user_id: userId,
    })
    .select("id")
    .single();
  conversationId = conversation!.id;

  // Conversa tambem para o contato sem consent (o bloqueio e no envio, nao
  // na existencia da conversa: importado pode ter conversa aberta pela
  // recepcao sem nunca ter recebido mensagem).
  await admin.from("conversation").insert({
    clinic_id: clinicId,
    contact_id: contactSemConsent,
    status: "em_atendimento",
    assignee_user_id: userId,
  });
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
  await admin.auth.admin.deleteUser(userId);
});

describe("bloqueio sem consentimento", () => {
  it("recusa, não cria message e registra em audit_log", async () => {
    const { data: conversa } = await admin
      .from("conversation")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("contact_id", contactSemConsent)
      .single();

    const result = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversa!.id,
      contactId: contactSemConsent,
      body: "Olá! Temos horários disponíveis esta semana.",
      authorUserId: userId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("sem_consentimento");
    }

    const { count: messages } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("conversation_id", conversa!.id);
    expect(messages).toBe(0);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, entity, entity_id")
      .eq("clinic_id", clinicId)
      .eq("action", "envio_bloqueado_sem_autorizacao");
    expect(audit).toHaveLength(1);
    expect(audit?.[0]?.entity_id).toBe(contactSemConsent);
  });
});

describe("envio com consentimento", () => {
  it("envia pelo provedor e grava a saída com custo zero", async () => {
    const result = await sendWhatsAppText(admin, {
      clinicId,
      conversationId,
      contactId: contactComConsent,
      body: "Podemos confirmar sua consulta de quinta?",
      authorUserId: userId,
    });

    expect(result.ok).toBe(true);

    const { data: rows } = await admin
      .from("message")
      .select(
        "author, direction, delivery_status, billable, cost_cents, wa_message_id",
      )
      .eq("clinic_id", clinicId)
      .eq("conversation_id", conversationId);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      author: "usuario",
      direction: "saida",
      delivery_status: "enviada",
      billable: false,
      cost_cents: 0,
    });
    expect(rows?.[0]?.wa_message_id).toMatch(/^fake:/);

    expect(
      fakeSentMessages().some(
        (sent) => sent.body === "Podemos confirmar sua consulta de quinta?",
      ),
    ).toBe(true);
  });
});
