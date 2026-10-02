import type { Page } from "@playwright/test";

import { E2E_SENHA } from "./fixtures";

export { E2E_SENHA };

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  // exact: o botao do olho se chama "Mostrar senha", e o getByLabel sem
  // exact acharia o campo e o botao ao mesmo tempo (erro de modo estrito).
  await page.getByLabel("Senha", { exact: true }).fill(E2E_SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/(inicio|selecionar-clinica|atendimento)/);
}
