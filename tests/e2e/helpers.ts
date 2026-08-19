import type { Page } from "@playwright/test";

// Senha compartilhada dos usuarios do seed de desenvolvimento.
export const SEED_PASSWORD = "Conduzza!Dev2026";

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(inicio|selecionar-clinica)/);
}
