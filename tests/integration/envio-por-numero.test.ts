import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fakeSentMessages,
  resetFakeProvider,
} from "@/lib/integrations/whatsapp/fake";
import {
  carregarInstancia,
  sendWhatsAppText,
} from "@/lib/integrations/whatsapp/send";
import { criarNumeroDeTeste, type NumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";

// Varios numeros por clinica, Fase 2 (docs/07): o orquestrador de envio
// trabalha por NUMERO, contra o banco REAL. Prova o que o teste de unidade
// (tests/unit/whatsapp/send-por-numero.test.ts) nao alcanca: o embed do
// numero na leitura da conversa (com a dica de FK), o slot anti-ban na linha
// DAQUELE numero, o segredo por account_id e o numero herdado pela mensagem.
//
// Aqui a clinica tem um numero so; o caso de dois numeros na mesma clinica
// (a conversa do segundo sai pelo segundo) vive em numeros-fase-2.test.ts,
// ativo desde o contrato da Fase 3.
// Clinica e_de_teste: o motor de producao nao pega nada daqui.

const admin = adminClient();
const sufixo = crypto.randomUUID().slice(0, 8);

let clinicId: string;
let contatoId: string;
let conversaId: string;
let numero: NumeroDeTeste;

beforeAll(async () => {
  resetFakeProvider();

  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Envio por numero ${sufixo}`,
      slug: `envio-numero-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = (clinica as { id: string }).id;

  numero = await criarNumeroDeTeste(admin, clinicId, {
    nome: "Recepção",
    connection_status: "conectado",
    instance_token: `tok-${sufixo}`,
  });

  const { data: contato } = await admin
    .from("contact")
    .insert({
      clinic_id: clinicId,
      phone_e164: `+5584977${sufixo.replace(/\D/g, "0").slice(0, 6)}`,
      name: "Paciente",
    })
    .select("id")
    .single()
    .throwOnError();
  contatoId = (contato as { id: string }).id;

  await admin
    .from("contact_consent")
    .insert({ clinic_id: clinicId, contact_id: contatoId, source: "conversa" })
    .throwOnError();

  // Sem numero no insert: o gatilho conversa_ganha_numero da o principal.
  const { data: conversa } = await admin
    .from("conversation")
    .insert({
      clinic_id: clinicId,
      contact_id: contatoId,
      status: "em_atendimento",
    })
    .select("id, whatsapp_account_id")
    .single()
    .throwOnError();
  conversaId = (conversa as { id: string }).id;
  expect(
    (conversa as { whatsapp_account_id: string | null }).whatsapp_account_id,
  ).toBe(numero.id);
});

afterAll(async () => {
  await admin.from("clinic").delete().eq("id", clinicId);
});

describe("envio pelo número da conversa (banco real)", () => {
  it("sai pelo número da conversa e a mensagem herda o número", async () => {
    const resultado = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversaId,
      contactId: contatoId,
      body: `Envio por número ${sufixo}`,
      authorUserId: null,
      whatsappAccountId: numero.id,
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) {
      return;
    }

    const { data: linha } = await admin
      .from("message")
      .select("whatsapp_account_id, delivery_status")
      .eq("id", resultado.messageId)
      .single()
      .throwOnError();
    expect(linha).toMatchObject({
      whatsapp_account_id: numero.id,
      delivery_status: "enviada",
    });

    const enviada = fakeSentMessages().find(
      (m) => m.body === `Envio por número ${sufixo}`,
    );
    expect(enviada?.accountId).toBe(numero.id);

    // O slot anti-ban andou na linha DESTE numero.
    const { data: conta } = await admin
      .from("whatsapp_account")
      .select("next_send_at")
      .eq("id", numero.id)
      .single()
      .throwOnError();
    expect((conta as { next_send_at: string | null }).next_send_at).not.toBe(
      null,
    );
  });

  it("número esperado divergente não grava nem envia", async () => {
    const corpo = `Divergente ${sufixo}`;
    const resultado = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversaId,
      contactId: contatoId,
      body: corpo,
      authorUserId: null,
      whatsappAccountId: crypto.randomUUID(),
    });
    expect(resultado).toMatchObject({
      ok: false,
      reason: "falha_envio",
      code: "conta_divergente",
    });

    const { count } = await admin
      .from("message")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversaId)
      .eq("body", corpo);
    expect(count).toBe(0);
    expect(fakeSentMessages().some((m) => m.body === corpo)).toBe(false);
  });

  it("carregarInstancia lê o token do número pedido", async () => {
    const { ref } = await carregarInstancia(admin, clinicId, numero.id);
    expect(ref).toMatchObject({
      clinicId,
      accountId: numero.id,
      instanceToken: `tok-${sufixo}`,
    });
  });

  it("carregarInstancia não entrega número de outra clínica", async () => {
    const { ref } = await carregarInstancia(
      admin,
      crypto.randomUUID(),
      numero.id,
    );
    expect(ref.instanceToken).toBeNull();
    expect(ref.instanceId).toBeNull();
  });

  // Por ultimo: remover encerra a conversa e o numero nao volta.
  it("número removido: desconectado com numero_removido, nada sai", async () => {
    await admin
      .rpc("remover_numero", {
        p_clinic_id: clinicId,
        p_account_id: numero.id,
        p_removido_por: null,
      })
      .throwOnError();

    const corpo = `Depois de remover ${sufixo}`;
    const resultado = await sendWhatsAppText(admin, {
      clinicId,
      conversationId: conversaId,
      contactId: contatoId,
      body: corpo,
      authorUserId: null,
    });
    expect(resultado).toMatchObject({
      ok: false,
      reason: "desconectado",
      code: "numero_removido",
    });
    expect(fakeSentMessages().some((m) => m.body === corpo)).toBe(false);
  });
});
