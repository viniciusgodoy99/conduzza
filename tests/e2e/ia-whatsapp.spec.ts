import { expect, test } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// E3 (13/10/2026): a IA no WhatsApp so com os telefones da equipe, so na
// teste123 e na Conduzza Teste. A clinica do e2e NAO esta na lista da fase
// controlada (a lista nao aceita clinica e_de_teste; so o banco aceita, para
// as suites de RLS e integracao), entao aqui se confere o que a tela mostra
// FORA da fase, que e o que a salud-care e todas as outras clinicas veem:
// nada muda para elas. Os estados de dentro da fase (cada motivo do
// Devolver, "Conferindo...", o erro com "Tentar de novo", a confirmacao, a
// aba Agente de IA com os controles do administrador desabilitados, a linha
// do telefone que nao aciona o assistente, "Não deu para conferir agora",
// "Em uso no WhatsApp") estao nos testes de unidade:
// tests/unit/atendimento/devolver-para-ia.test.tsx, cartao-de-bloqueio,
// fio-da-ia, tests/unit/agente/whatsapp/*.test.ts(x) (a aba WhatsApp da
// Tela 6 desde a onda 2) e tests/unit/agente/tela-em-uso-no-whatsapp.test.tsx.
//
// Leitura pura: nenhum botao que muda dado e clicado. Escrito na leva do E3
// e ainda NAO rodado (depende das migrations aplicadas e do seed sem
// blocked_draft).

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "conteudo identico em todos os viewports",
  );
});

test("fora da fase, Devolver para a IA fica visível, desabilitado e com a dica de sempre", async ({
  page,
}) => {
  // Roberto Recibo esta com a recepcao: a conversa e "minha".
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Roberto Recibo").click();
  const devolver = page.getByRole("button", { name: "Devolver para a IA" });
  await expect(devolver).toBeDisabled();
  // Fora da fase a tela nem pergunta ao servidor: nunca "Conferindo...".
  await expect(page.getByText("Conferindo...")).toHaveCount(0);
  await page.locator("span[tabindex='0']", { has: devolver }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Chega com o agente de IA. Até lá, use Resolver quando terminar o atendimento.",
  );
});

test("o rascunho bloqueado fica fechado para quem não é da equipe Conduzza (D25)", async ({
  page,
}) => {
  for (const email of [
    dados().emails.recepcao,
    dados().emails.gestor,
    dados().emails.admin,
  ]) {
    await login(page, email);
    await page.goto("/atendimento");
    await page.getByText("Patrícia Sintoma").click();
    await expect(
      page.getByText("Resposta da IA bloqueada pela conformidade"),
    ).toBeVisible();
    await expect(
      page.getByText(/A conversa foi passada para a equipe\./),
    ).toBeVisible();
    const ver = page.getByRole("button", {
      name: "Ver o que a IA ia responder",
    });
    await expect(ver).toBeDisabled();
    await page.locator("span[tabindex='0']", { has: ver }).hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Só a equipe Conduzza vê o rascunho bloqueado.",
    );
    // O texto do rascunho nunca chega ao navegador de quem nao le.
    await expect(page.getByText(/pomada cicatrizante/)).toHaveCount(0);
    await page.context().clearCookies();
  }
});

test("Sem atendente não conta a conversa da IA (D27)", async ({ page }) => {
  // Seed: Patricia (aguardando, sem ninguem) e Juliana (com a IA). So a
  // Patricia esta sem atendente; a Juliana mora em "IA atendendo".
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await expect(
    page.getByRole("button", { name: /Sem atendente 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /IA atendendo 1/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Sem atendente 1/ }).click();
  const lista = page.getByRole("complementary", { name: "Conversas" });
  await expect(lista.getByText("Patrícia Sintoma")).toBeVisible();
  await expect(lista.getByText("Juliana Dermato")).toHaveCount(0);
});

test("a conversa com a IA continua com o aviso do compositor e Assumir conversa", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Juliana Dermato").click();
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(
    fio.getByText("A IA está atendendo esta conversa."),
  ).toBeVisible();
  await expect(
    fio.getByText("Para responder, use Assumir conversa, no topo da conversa."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Assumir conversa" }),
  ).toBeEnabled();
  // So existe na conversa "minha".
  await expect(
    page.getByRole("button", { name: "Devolver para a IA" }),
  ).toHaveCount(0);
});

test("fora da fase, o link antigo de Configurações leva ao vazio da tela Agente de IA", async ({
  page,
}) => {
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=ia");
  await expect(page).toHaveURL(/\/agente\?aba=whatsapp/);
  await expect(page.getByRole("tab", { name: "WhatsApp" })).toHaveCount(0);
  await expect(
    page.getByText(
      "Nesta fase, só a equipe Conduzza liga o atendimento pelo WhatsApp.",
    ),
  ).toHaveCount(0);
});
