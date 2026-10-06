import { expect, test, type Route } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// A previa do cartao de quem envia nao volta para a do paciente (defeito
// achado em 06/10/2026, docs/05). Assumir a conversa de um lead em "Novo" anda
// o lead e revalida /leads, e a resposta do Assumir traz um retrato da pagina
// tirado ANTES do envio. A fila de actions do Next e serial: com o Enviar
// clicado antes de o Assumir voltar, esse retrato so entra quando o envio
// termina, depois de o tempo real ja ter posto "Voce:" no cartao, e o
// useDadosDoServidor gravava a lista velha por cima.
//
// Aqui a corrida e forcada, sem depender da sorte: a resposta do Assumir fica
// presa ate o Enviar ser clicado, e a do envio atrasa 1,5 s (os eventos de
// tempo real da previa chegam antes dela). Antes da correcao, o cartao ficava
// com a previa do paciente em toda execucao.

const sufixo = Date.now().toString(36);
const NOME = `Paciente Prévia ${sufixo}`;
const TELEFONE = `+5584916${sufixo.slice(-6)}`;

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
    .eq("clinic_id", dados().clinicId)
    .eq("phone_e164", TELEFONE);
});

test("a prévia de quem envia não volta para a do paciente quando o Assumir demora", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Lead novo (o padrao do contato), conversa com a IA: o Assumir anda o lead
  // para "Em contato" e revalida /leads.
  const entrada = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: dados().clinicId,
    p_phone_e164: TELEFONE,
    p_name: NOME,
    p_wa_message_id: `previa:${sufixo}:1`,
    p_content_type: "texto",
    p_body: "Oi, queria saber o preço da consulta",
    p_media_url: null,
    p_transcript: null,
  });
  expect(entrada.error).toBeNull();
  const conversaId = (entrada.data as { conversation_id: string })
    .conversation_id;
  await admin
    .from("conversation")
    .update({ status: "ia_atendendo" })
    .eq("id", conversaId)
    .throwOnError();

  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText(NOME).click();
  await expect(
    page.getByText("A IA está atendendo esta conversa."),
  ).toBeVisible();
  // A abertura dispara a action de marcar como lida: so depois dela a proxima
  // action e a do Assumir.
  await page.waitForTimeout(1500);

  let liberarAssumir: () => void = () => undefined;
  const assumirLiberado = new Promise<void>((resolver) => {
    liberarAssumir = resolver;
  });
  let actions = 0;
  await page.route("**/atendimento**", async (route: Route) => {
    const pedido = route.request();
    if (pedido.method() !== "POST" || !pedido.headers()["next-action"]) {
      await route.fallback();
      return;
    }
    actions += 1;
    if (actions === 1) {
      // Assumir: o servidor executa agora (o tempo real avisa a tela), mas a
      // resposta, com o retrato da pagina, so volta depois do Enviar.
      const resposta = await route.fetch();
      await assumirLiberado;
      await route.fulfill({ response: resposta });
      return;
    }
    if (actions === 2) {
      // Envio: os eventos de tempo real da previa chegam antes da resposta.
      const resposta = await route.fetch();
      await new Promise((resolver) => setTimeout(resolver, 1500));
      await route.fulfill({ response: resposta });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "Assumir conversa" }).click();
  // O compositor abre pelo evento de tempo real do Assumir, antes da resposta.
  const campo = page.getByLabel("Resposta ao paciente");
  await expect(campo).toBeEditable({ timeout: 8000 });
  await campo.fill("Já te passo os valores!");
  await page.getByRole("button", { name: "Enviar" }).click();
  liberarAssumir();

  await expect(
    page
      .getByRole("region", { name: "Conversa aberta" })
      .getByText("Já te passo os valores!"),
  ).toBeVisible({ timeout: 10_000 });
  // O banco tem a previa nova, de quem enviou.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("conversation")
        .select("last_preview_author")
        .eq("id", conversaId)
        .single();
      return (data as { last_preview_author: string | null } | null)
        ?.last_preview_author;
    })
    .toBe("usuario");
  // E o cartao tambem, mesmo depois de o retrato do Assumir chegar.
  const cartao = page
    .getByRole("complementary", { name: "Conversas" })
    .getByRole("button", { name: new RegExp(NOME) });
  await page.waitForTimeout(3000);
  await expect(cartao.getByText("Você:", { exact: true })).toBeVisible({
    timeout: 8000,
  });
  await expect(cartao).toContainText("Já te passo os valores!");
});
