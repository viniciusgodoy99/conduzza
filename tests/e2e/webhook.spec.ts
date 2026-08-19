import { expect, test } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { DEV_WEBHOOK_SECRET_VITALIS } from "../../scripts/seed/010-conversas";

// Aceite da tarefa 1.3 pela porta HTTP real: autenticacao por secret,
// payload invalido e idempotencia visivel. Usa a clinica do seed com um
// telefone proprio e limpa no fim. Roda so no desktop-1600.

const VITALIS = "00000000-0000-4000-a000-000000000001";
const suffix = Date.now().toString(36);
const PHONE = `+5584913${suffix.slice(-6)}`;

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
    .eq("clinic_id", VITALIS)
    .eq("phone_e164", PHONE);
});

test("secret errado é recusado com 401 genérico", async ({ request }) => {
  const response = await request.post(
    `/api/webhooks/whatsapp?clinic=${VITALIS}&secret=errado`,
    { data: { kind: "connection_update", status: "conectado" } },
  );
  expect(response.status()).toBe(401);
});

test("payload que não é JSON é recusado com 400", async ({ request }) => {
  const response = await request.post(
    `/api/webhooks/whatsapp?clinic=${VITALIS}&secret=${DEV_WEBHOOK_SECRET_VITALIS}`,
    {
      headers: { "Content-Type": "application/json" },
      data: Buffer.from("isto nao e json{"),
    },
  );
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
  const url = `/api/webhooks/whatsapp?clinic=${VITALIS}&secret=${DEV_WEBHOOK_SECRET_VITALIS}`;

  const first = await request.post(url, { data: event });
  expect(first.status()).toBe(200);
  expect((await first.json()).inserted).toBe(true);

  for (let i = 0; i < 2; i++) {
    const repeat = await request.post(url, { data: event });
    expect(repeat.status()).toBe(200);
    expect((await repeat.json()).inserted).toBe(false);
  }

  const admin = adminClient();
  const { count } = await admin
    .from("message")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", VITALIS)
    .eq("wa_message_id", `e2e:${suffix}:1`);
  expect(count).toBe(1);
});
