import type { Page } from "@playwright/test";

import { E2E_SENHA } from "./fixtures";

export { E2E_SENHA };

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(E2E_SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(inicio|selecionar-clinica|atendimento)/);
}
