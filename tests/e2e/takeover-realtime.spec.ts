import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { login } from "./helpers";

// Aceite da tarefa 1.7 com duas sessoes reais: uma assume, a outra reflete o
// estado em menos de 2 segundos; mensagem enviada aparece na outra tela; e
// mensagem recebida numa conversa assumida NAO devolve a posse para a IA.
// O spec cria a propria conversa (nao muta o seed) e limpa no fim.

const VITALIS = "00000000-0000-4000-a000-000000000001";
const suffix = Date.now().toString(36);
const CONTACT_NAME = `Paciente Tempo Real ${suffix}`;
const PHONE = `+5584915${suffix.slice(-6)}`;

const admin = adminClient();

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
});

test.afterAll(async () => {
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", VITALIS)
    .eq("phone_e164", PHONE);
});

async function openConversation(page: Page): Promise<void> {
  await page.goto("/atendimento");
  await page.getByText(CONTACT_NAME).click();
  await expect(
    page
      .getByRole("heading", { name: CONTACT_NAME })
      .or(page.getByText(CONTACT_NAME).nth(1)),
  ).toBeVisible();
}

test("assumir reflete na outra sessão em menos de 2s e a IA não volta sozinha", async ({
  browser,
}) => {
  // Conversa propria do teste, nascendo com a IA (estado que exercita o takeover).
  const ingest = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: VITALIS,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `rt:${suffix}:1`,
    p_content_type: "texto",
    p_body: "Oi, queria informações sobre limpeza de pele",
    p_media_url: null,
    p_transcript: null,
  });
  expect(ingest.error).toBeNull();
  const conversationId = (ingest.data as { conversation_id: string })
    .conversation_id;
  await admin
    .from("conversation")
    .update({ status: "ia_atendendo" })
    .eq("id", conversationId);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await login(pageA, "recepcao@vitalis.dev");
  await login(pageB, "gestor@vitalis.dev");
  await openConversation(pageA);
  await openConversation(pageB);

  await expect(
    pageB.getByText("A IA está atendendo esta conversa."),
  ).toBeVisible();

  // A assume; B reflete em < 2s sem qualquer acao.
  await pageA.getByRole("button", { name: "Assumir conversa" }).click();
  await expect(
    pageB.getByText("Outra pessoa está com esta conversa."),
  ).toBeVisible({ timeout: 2000 });
  await expect(pageB.getByText(/assumiu a conversa/)).toBeVisible({
    timeout: 2000,
  });

  // A responde; B ve a bolha em < 2s.
  await pageA.getByLabel("Resposta ao paciente").fill("Já te atendo por aqui!");
  await pageA.getByRole("button", { name: "Enviar" }).click();
  await expect(pageB.getByText("Já te atendo por aqui!")).toBeVisible({
    timeout: 2000,
  });

  // Mensagem recebida numa conversa assumida NAO devolve para a IA.
  const second = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: VITALIS,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `rt:${suffix}:2`,
    p_content_type: "texto",
    p_body: "Perfeito, aguardo",
    p_media_url: null,
    p_transcript: null,
  });
  expect(second.error).toBeNull();
  await expect(pageA.getByText("Perfeito, aguardo")).toBeVisible({
    timeout: 3000,
  });

  const { data: after } = await admin
    .from("conversation")
    .select("status")
    .eq("id", conversationId)
    .single();
  expect(after?.status).toBe("em_atendimento");
  await expect(pageA.getByLabel("Resposta ao paciente")).toBeVisible();

  await contextA.close();
  await contextB.close();
});
