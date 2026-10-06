import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Mensagem enviada direto pelo WhatsApp do numero conectado (celular,
// WhatsApp Web), fora do sistema (05/10/2026). O uazapi entrega no webhook o
// evento "messages" com fromMe e sem wasSentByApi; a rota grava a mensagem na
// conversa daquele numero, e o fio aberto mostra a bolha SEM recarregar
// (tempo real), a direita, na pele da atendente, assinada "Pelo WhatsApp" com
// o icone do aparelho: lado, pele, icone e texto, nos temas claro e escuro.
//
// O spec cria o proprio contato e a propria conversa (nao muta o seed) e
// limpa no fim. O numero e2e tem instance_token nulo, entao o payload do
// uazapi passa sem token; a URL leva o numero e o segredo.

const suffix = Date.now().toString(36);
// So digitos: o telefone sai do chatid do evento e precisa cair na mesma
// chave do contato criado aqui.
const DIGITOS = Date.now().toString().slice(-6);
const PHONE = `+5584918${DIGITOS}`;
const CONTACT_NAME = `Paciente do Celular ${suffix}`;
const TEXTO_DO_PACIENTE = "Oi, tem horário amanhã de manhã?";
const TEXTO_DO_CELULAR = `Tem sim, às 9h. Posso marcar? ${suffix}`;
const EXPLICACAO = "Enviada direto pelo WhatsApp da clínica, fora do sistema";
const DICA_DE_APAGAR =
  "Mensagem enviada direto pelo WhatsApp da clínica: só um administrador ou gestor pode apagar.";

const admin = adminClient();

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
});

async function limpar(): Promise<void> {
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("phone_e164", PHONE);
}

test.afterAll(limpar);

async function idDoMembro(papel: string): Promise<string> {
  const { data, error } = await admin
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", dados().clinicId)
    .eq("role", papel)
    .eq("status", "ativo")
    .limit(1)
    .single();
  expect(error).toBeNull();
  return (data as { user_id: string }).user_id;
}

/** A linha da mensagem no fio passa no axe (contraste) no tema da tela. */
async function semViolacaoDeContraste(
  page: Page,
  messageId: string,
): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .include(`#mensagem-${messageId}`)
    .withRules(["color-contrast"])
    .analyze();
  expect(resultado.violations).toEqual([]);
}

test("mensagem enviada pelo WhatsApp da clínica aparece no fio como Pelo WhatsApp, sem recarregar", async ({
  page,
  request,
}) => {
  const tentativa = test.info().retry;
  try {
    // Conversa propria, no numero e2e (o mesmo da URL do webhook).
    const ingest = await admin.rpc("ingest_inbound_message", {
      p_clinic_id: dados().clinicId,
      p_phone_e164: PHONE,
      p_name: CONTACT_NAME,
      p_wa_message_id: `e2e-celular:${suffix}:${tentativa}:entrada`,
      p_content_type: "texto",
      p_body: TEXTO_DO_PACIENTE,
      p_media_url: null,
      p_transcript: null,
      p_whatsapp_account_id: dados().whatsappAccountId,
    });
    expect(ingest.error).toBeNull();
    const conversationId = (ingest.data as { conversation_id: string })
      .conversation_id;

    // Com a recepcao, para o menu da bolha mostrar a dica do Apagar (sem a
    // posse ele mostra "Assuma a conversa"). A fala do paciente fica 3
    // horas para tras: a mensagem do celular e de uma PESSOA, nao a
    // resposta automatica do app (que sai ate 8 s depois do paciente).
    const { error: erroDaConversa } = await admin
      .from("conversation")
      .update({
        status: "em_atendimento",
        assignee_user_id: await idDoMembro("recepcao"),
        last_inbound_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        // A conversa fica 3 horas para tras na lista: a mensagem do celular
        // tem de traze-la para o topo (ordem do WhatsApp, 06/10/2026).
        last_message_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      })
      .eq("id", conversationId);
    expect(erroDaConversa).toBeNull();

    await login(page, dados().emails.recepcao);
    await page.goto("/atendimento");
    await page.getByText(CONTACT_NAME).click();
    const fio = page.getByRole("region", { name: "Conversa aberta" });
    await expect(fio.getByText(TEXTO_DO_PACIENTE)).toBeVisible();

    // Marca na janela: se a pagina recarregar, ela some.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__semRecarregar = true;
    });

    // O evento do celular, no formato do uazapi.
    const resposta = await request.post(dados().webhookUrl, {
      data: {
        EventType: "messages",
        message: {
          messageid: `E2ECELULAR${suffix.toUpperCase()}${tentativa}`,
          chatid: `${PHONE.slice(1)}@s.whatsapp.net`,
          fromMe: true,
          messageType: "Conversation",
          text: TEXTO_DO_CELULAR,
          messageTimestamp: Date.now(),
        },
      },
    });
    expect(resposta.status()).toBe(200);
    const corpo = (await resposta.json()) as {
      inserted?: boolean;
      message_id?: string;
      conversation_id?: string;
      automatica?: boolean;
    };
    expect(corpo.inserted).toBe(true);
    expect(corpo.conversation_id).toBe(conversationId);
    expect(corpo.automatica).toBe(false);
    const messageId = corpo.message_id!;

    // Gravada como saida de pessoa da clinica, sem pessoa no sistema, sem
    // custo (regra 3.3).
    const { data: linhaNoBanco } = await admin
      .from("message")
      .select(
        "direction, author, author_user_id, pelo_celular, billable, cost_cents, delivery_status",
      )
      .eq("id", messageId)
      .single();
    expect(linhaNoBanco).toEqual({
      direction: "saida",
      author: "usuario",
      author_user_id: null,
      pelo_celular: true,
      billable: false,
      cost_cents: 0,
      delivery_status: "enviada",
    });

    // A bolha chega pelo tempo real, sem recarregar.
    const linha = fio.locator(`#mensagem-${messageId}`);
    await expect(linha).toBeVisible({ timeout: 8000 });
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__semRecarregar,
      ),
    ).toBe(true);

    // Lado, pele, icone e texto.
    await expect(linha.getByText(TEXTO_DO_CELULAR)).toBeVisible();
    await expect(linha).toHaveClass(/justify-end/);
    await expect(linha.locator("[data-bolha]")).toHaveClass(/bg-bubble-out/);
    await expect(
      linha.getByText("Pelo WhatsApp", { exact: true }),
    ).toBeVisible();
    await expect(linha.locator("svg.lucide-smartphone")).toBeVisible();
    // O leitor de tela ouve a frase inteira.
    await expect(linha.getByText(EXPLICACAO, { exact: true })).toHaveCount(1);

    // O cartao da lista: a previa e da clinica, nao do paciente.
    const cartao = page
      .getByRole("complementary", { name: "Conversas" })
      .getByRole("button", { name: new RegExp(CONTACT_NAME) });
    await expect(cartao.getByText("Clínica:", { exact: true })).toBeVisible({
      timeout: 8000,
    });
    // Como no WhatsApp (pedido do dono em 06/10/2026): a mensagem mandada
    // pelo celular sobe a conversa para o topo e a hora do cartao passa a ser
    // a dela, sem recarregar.
    const primeiro = page
      .getByRole("complementary", { name: "Conversas" })
      .getByRole("button", { name: /Última mensagem (às|em) / })
      .first();
    await expect(primeiro).toHaveAccessibleName(new RegExp(CONTACT_NAME), {
      timeout: 8000,
    });
    await expect(cartao).toHaveAccessibleName(/Última mensagem às \d{2}:\d{2}/);

    // Sem pessoa no sistema: so a chefia apaga, e a dica diz isso.
    await linha.hover();
    await linha.getByRole("button", { name: "Ações da mensagem" }).click();
    await expect(page.getByRole("menuitem", { name: "Apagar" })).toBeDisabled();
    await expect(page.getByText(DICA_DE_APAGAR)).toBeVisible();
    await page.keyboard.press("Escape");

    // Tema claro (padrao) e escuro: o rotulo continua la e passa no contraste.
    await semViolacaoDeContraste(page, messageId);
    await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      linha.getByText("Pelo WhatsApp", { exact: true }),
    ).toBeVisible();
    await expect(linha.locator("svg.lucide-smartphone")).toBeVisible();
    await semViolacaoDeContraste(page, messageId);

    // A reentrega do mesmo evento nao duplica a bolha.
    const repetida = await request.post(dados().webhookUrl, {
      data: {
        EventType: "messages",
        message: {
          messageid: `E2ECELULAR${suffix.toUpperCase()}${tentativa}`,
          chatid: `${PHONE.slice(1)}@s.whatsapp.net`,
          fromMe: true,
          messageType: "Conversation",
          text: TEXTO_DO_CELULAR,
          messageTimestamp: Date.now(),
        },
      },
    });
    expect(repetida.status()).toBe(200);
    expect(((await repetida.json()) as { inserted?: boolean }).inserted).toBe(
      false,
    );
    await expect(fio.getByText(TEXTO_DO_CELULAR)).toHaveCount(1);
  } finally {
    await limpar();
  }
});
