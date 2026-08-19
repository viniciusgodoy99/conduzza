import { expect, test } from "@playwright/test";

import { login } from "./helpers";

// Aceites da tarefa 0.5 contra o banco real com os usuarios do seed:
// recepcao nao acessa /configuracoes; gestor ve com edicao travada e dica;
// quem pertence a 2 clinicas escolhe qual abrir; sem sessao nao entra.
// Roda so no projeto desktop-1600: o que se testa aqui nao depende de viewport.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
});

test("sem sessão, a área logada redireciona para o login", async ({ page }) => {
  await page.goto("/agenda");
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("recepção não vê nem acessa Configurações", async ({ page }) => {
  await login(page, "recepcao@vitalis.dev");
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Atendimento" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Configurações" })).toHaveCount(0);

  await page.goto("/configuracoes");
  await page.waitForURL(/\/inicio/);
});

test("gestor vê Configurações com edição travada e dica", async ({ page }) => {
  await login(page, "gestor@vitalis.dev");
  await page.goto("/configuracoes");
  await expect(
    page.getByRole("heading", { name: "Configurações" }),
  ).toBeVisible();

  const inviteButton = page.getByRole("button", {
    name: "Convidar por e-mail",
  });
  await expect(inviteButton).toBeVisible();
  await expect(inviteButton).toBeDisabled();

  await inviteButton.locator("..").focus();
  await expect(
    page.getByText("Somente administradores alteram as configurações"),
  ).toBeVisible();
});

test("admin vê o convite habilitado e o time listado", async ({ page }) => {
  await login(page, "admin@vitalis.dev");
  await page.goto("/configuracoes");
  await expect(
    page.getByRole("button", { name: "Convidar por e-mail" }),
  ).toBeEnabled();
  await expect(page.getByText("recepcao@vitalis.dev")).toBeVisible();
});

test("quem pertence a duas clínicas escolhe qual abrir", async ({ page }) => {
  await login(page, "agencia@conduzza.dev");
  await page.waitForURL(/\/selecionar-clinica/);
  await expect(page.getByText("Clínica Vitalis")).toBeVisible();
  await expect(page.getByText("Espaço Beleza Pura")).toBeVisible();

  await page.getByRole("button", { name: /Clínica Vitalis/ }).click();
  await page.waitForURL(/\/inicio/);
  await expect(
    page.getByRole("banner").getByText("Clínica Vitalis"),
  ).toBeVisible();
});
