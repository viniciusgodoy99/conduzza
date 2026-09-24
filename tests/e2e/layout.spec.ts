import { expect, test } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceite da tarefa 0.6 nos 4 viewports do config, com o menu lateral do
// Conduzza Design System (docs/06 secao 5.1): aberto em 248px a partir de
// 1600px, recolhido em 64px de 1024 a 1599px (so icones, com o nome do link
// ainda acessivel) e gaveta abaixo de 1024px.
test("menu lateral conforme o viewport", async ({ page, context }) => {
  // Sem preferencia gravada: o menu segue a largura da tela.
  await context.clearCookies({ name: "cz_rail" });
  await login(page, dados().emails.admin);
  await page.goto("/cadastros");
  await expect(page.getByRole("heading", { name: "Cadastros" })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 0;
  const sidebar = page.locator("aside#menu-lateral");
  const drawerButton = page.getByRole("button", { name: "Abrir menu" });
  const navegacao = page.getByRole("navigation", {
    name: "Navegação principal",
  });

  if (viewportWidth >= 1600) {
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(248);
    await expect(drawerButton).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Recolher menu" }),
    ).toBeVisible();
    await expect(
      navegacao.getByRole("link", { name: "Atendimento" }),
    ).toBeVisible();
  } else if (viewportWidth >= 1024) {
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(64);
    await expect(drawerButton).toBeHidden();
    // Recolhido, o rotulo sai da tela mas continua no nome do link.
    await expect(
      navegacao.getByRole("link", { name: "Atendimento" }),
    ).toBeVisible();

    // O botao expande para 248px e a escolha vale ate ser desfeita.
    await page.getByRole("button", { name: "Expandir menu" }).click();
    await expect
      .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0))
      .toBe(248);
    await page.getByRole("button", { name: "Recolher menu" }).click();
    await expect
      .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0))
      .toBe(64);
  } else {
    await expect(sidebar).toBeHidden();
    await expect(drawerButton).toBeVisible();
    await drawerButton.click();
    await expect(
      navegacao.getByRole("link", { name: "Atendimento" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fechar menu" }).click();
    await expect(navegacao).toBeHidden();
  }
});
