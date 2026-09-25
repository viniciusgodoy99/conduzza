import { expect, test } from "@playwright/test";

import { caminhoDoWebhook } from "../rls/numeros";
import { adminClient } from "../rls/stack";
import { dados } from "./dados";

// Aceite da tarefa 1.3 pela porta HTTP real: autenticacao por secret,
// payload invalido e idempotencia visivel. Usa a clinica do seed com um
// telefone proprio e limpa no fim. Roda so no desktop-1600.
//
// Varios numeros por clinica (Fase 2, docs/07): a URL do webhook passou a
// carregar o numero (?clinic=&account=&secret=). A URL ANTIGA (?clinic=&
// secret=) continua valendo para as instancias configuradas antes: a rota acha,
// entre os segredos da clinica, o que bate. As duas sao provadas aqui.

const suffix = Date.now().toString(36);
const PHONE = `+5584913${suffix.slice(-6)}`;
const PHONE_LEGADO = `+5584914${suffix.slice(-6)}`;

function numeroDaSuite() {
  return {
    clinicId: dados().clinicId,
    id: dados().whatsappAccountId,
    webhookSecret: dados().webhookSecret,
  };
}

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "webhook independe de viewport",
  );
});

test.afterAll(async () => {
  const admin = adminClient();
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .in("phone_e164", [PHONE, PHONE_LEGADO]);
});

test("secret errado é recusado com 401 genérico", async ({ request }) => {
  const response = await request.post(
    caminhoDoWebhook(numeroDaSuite(), { segredo: "errado" }),
    { data: { kind: "connection_update", status: "conectado" } },
  );
  expect(response.status()).toBe(401);
});

test("secret errado na URL legada também é 401", async ({ request }) => {
  const response = await request.post(
    caminhoDoWebhook(numeroDaSuite(), { legado: true, segredo: "errado" }),
    { data: { kind: "connection_update", status: "conectado" } },
  );
  expect(response.status()).toBe(401);
});

test("número que não é da clínica é 401, mesmo com o secret certo", async ({
  request,
}) => {
  const response = await request.post(
    caminhoDoWebhook({ ...numeroDaSuite(), id: crypto.randomUUID() }),
    { data: { kind: "connection_update", status: "conectado" } },
  );
  expect(response.status()).toBe(401);
});

test("payload que não é JSON é recusado com 400", async ({ request }) => {
  const response = await request.post(dados().webhookUrl, {
    headers: { "Content-Type": "application/json" },
    data: Buffer.from("isto nao e json{"),
  });
  expect(response.status()).toBe(400);
});

test("o mesmo evento 3 vezes cria 1 mensagem", async ({ request }) => {
  const event = {
    kind: "message_received",
    phone: PHONE,
    name: "Paciente Webhook",
    waMessageId: `e2e:${suffix}:1`,
    contentType: "texto",
    body: "Olá, teste de webhook",
  };
  const url = dados().webhookUrl;

  const first = await request.post(url, { data: event });
  expect(first.status()).toBe(200);
  expect((await first.json()).inserted).toBe(true);

  for (let i = 0; i < 2; i++) {
    const repeat = await request.post(url, { data: event });
    expect(repeat.status()).toBe(200);
    expect((await repeat.json()).inserted).toBe(false);
  }

  const admin = adminClient();
  const { data: mensagens } = await admin
    .from("message")
    .select("whatsapp_account_id")
    .eq("clinic_id", dados().clinicId)
    .eq("wa_message_id", `e2e:${suffix}:1`);
  // Uma mensagem so, e do numero que a URL nomeia.
  expect(mensagens).toEqual([
    { whatsapp_account_id: dados().whatsappAccountId },
  ]);
});

test("a URL legada (sem o número) continua entregando no número certo", async ({
  request,
}) => {
  const waMessageId = `e2e:${suffix}:legado`;
  const response = await request.post(dados().webhookUrlLegada, {
    data: {
      kind: "message_received",
      phone: PHONE_LEGADO,
      name: "Paciente URL Antiga",
      waMessageId,
      contentType: "texto",
      body: "Olá, teste da URL antiga",
    },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).inserted).toBe(true);

  const admin = adminClient();
  const { data: mensagem } = await admin
    .from("message")
    .select("whatsapp_account_id, conversation_id")
    .eq("clinic_id", dados().clinicId)
    .eq("wa_message_id", waMessageId)
    .single();
  expect(mensagem?.whatsapp_account_id).toBe(dados().whatsappAccountId);
  const { data: conversa } = await admin
    .from("conversation")
    .select("whatsapp_account_id")
    .eq("id", mensagem!.conversation_id as string)
    .single();
  expect(conversa?.whatsapp_account_id).toBe(dados().whatsappAccountId);
});
