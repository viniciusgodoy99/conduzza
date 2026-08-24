import { expect, test } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceite da tarefa 0.6 nos 4 viewports do config: sidebar fixa de 236px em
// 1024 ou mais (layout do handoff) e gaveta abaixo disso.
test("sidebar conforme o viewport", async ({ page }) => {
  await login(page, dados().emails.admin);
  await page.goto("/cadastros");
  await expect(page.getByRole("heading", { name: "Cadastros" })).toBeVisible();

  const viewportWidth = page.viewportSize()?.width ?? 0;
  const sidebar = page.locator("aside");
  const drawerButton = page.getByRole("button", { name: "Abrir menu" });

  if (viewportWidth >= 1024) {
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(236);
    await expect(drawerButton).toBeHidden();
  } else {
    await expect(sidebar).toBeHidden();
    await expect(drawerButton).toBeVisible();
    await drawerButton.click();
    await expect(
      page
        .getByRole("navigation", { name: "Navegação principal" })
        .getByRole("link", { name: "Atendimento" }),
    ).toBeVisible();
  }
});
