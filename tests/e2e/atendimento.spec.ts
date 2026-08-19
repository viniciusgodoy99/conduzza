import { expect, test } from "@playwright/test";

import { login } from "./helpers";

// Aceite da tarefa 1.5 sobre o seed: lista com segmentos e chips, fio com
// selo de IA, nota interna, cartao de bloqueio de conformidade com o rascunho
// auditavel, e a faixa vermelha de desconectado. Leitura pura, nao muta nada.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "conteudo identico em todos os viewports",
  );
});

test("lista com segmentos de posse e chips de status contados", async ({
  page,
}) => {
  await login(page, "recepcao@vitalis.dev");
  await page.goto("/atendimento");
  await expect(page.getByRole("button", { name: /Todas 15/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /IA atendendo 5/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Aguardando você 3/ }),
  ).toBeVisible();
});

test("bloqueio de conformidade aparece no fio com o rascunho auditável", async ({
  page,
}) => {
  await login(page, "recepcao@vitalis.dev");
  await page.goto("/atendimento");
  await page.getByText("Patrícia Nogueira").click();
  await expect(
    page.getByText("Resposta da IA bloqueada pela conformidade"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver o que a IA ia responder" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rascunho bloqueado" }),
  ).toBeVisible();
  await expect(page.getByText(/pomada cicatrizante/)).toBeVisible();
});

test("bolha da IA carrega selo textual, nunca só cor", async ({ page }) => {
  await login(page, "recepcao@vitalis.dev");
  await page.goto("/atendimento");
  await page.getByText("Juliana Freitas").click();
  await expect(
    page.getByText("Atendemos sim. A consulta dermatológica", { exact: false }),
  ).toBeVisible();
  const bolhaIa = page
    .locator("div", { hasText: "Quer ver os próximos horários?" })
    .locator("span", { hasText: "IA" });
  await expect(bolhaIa.first()).toBeVisible();
});

test("nota interna é âmbar e avisa que o paciente não vê", async ({ page }) => {
  await login(page, "recepcao@vitalis.dev");
  await page.goto("/atendimento");
  await page.getByText("Roberto Lima").click();
  await expect(
    page.getByText("Nota interna, o paciente não vê", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/recibo sai com o CNPJ novo/)).toBeVisible();
});

test("áudio mostra a transcrição colapsada", async ({ page }) => {
  await login(page, "recepcao@vitalis.dev");
  await page.goto("/atendimento");
  await page.getByText("Camila Duarte").click();
  await expect(page.getByText("Transcrição:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "ver mais" }).click();
  await expect(page.getByText(/vou viajar na quarta/)).toBeVisible();
});

test("clínica com WhatsApp desconectado vê a faixa vermelha fixa", async ({
  page,
}) => {
  await login(page, "admin@belezapura.dev");
  await expect(
    page.getByText("WhatsApp desconectado", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconectar" })).toBeVisible();
});
