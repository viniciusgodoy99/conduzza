import { expect, test } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da tarefa 0.5 contra o banco real com os usuarios do seed:
// recepcao nao acessa /configuracoes; gestor gerencia a equipe mas nao encosta
// em administrador; quem pertence a 2 clinicas escolhe qual abrir; sem sessao
// nao entra.
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
  await login(page, dados().emails.recepcao);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Atendimento" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Configurações" })).toHaveCount(0);

  await page.goto("/configuracoes");
  await page.waitForURL(/\/inicio/);
});

test("gestor gerencia a equipe, menos quem é administrador", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/configuracoes");
  await expect(
    page.getByRole("heading", { name: "Configurações" }),
  ).toBeVisible();

  // Decisao do dono em 25/08/2026: administrador E gestor gerenciam a equipe,
  // os papeis e a conexao do WhatsApp. O gestor edita de verdade.
  await expect(
    page.getByRole("button", { name: "Convidar por e-mail" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("combobox", { name: "Papel de Marina Recepção" }),
  ).toBeEnabled();

  // A linha de um administrador continua travada para ele: visivel e
  // desabilitada, com a dica explicando por que.
  const seletorDoAdmin = page.getByRole("combobox", {
    name: "Papel de Ana Admin",
  });
  await expect(seletorDoAdmin).toBeVisible();
  await expect(seletorDoAdmin).toBeDisabled();

  await seletorDoAdmin.locator("..").focus();
  await expect(
    page.getByText(
      "Somente um administrador altera o acesso de outro administrador",
    ),
  ).toBeVisible();
});

test("admin vê o convite habilitado e o time listado", async ({ page }) => {
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes");
  await expect(
    page.getByRole("button", { name: "Convidar por e-mail" }),
  ).toBeEnabled();
  await expect(page.getByText(dados().emails.recepcao)).toBeVisible();
});

test("quem pertence a duas clínicas escolhe qual abrir", async ({ page }) => {
  await login(page, dados().emails.duasClinicas);
  await page.waitForURL(/\/selecionar-clinica/);
  await expect(page.getByText("Clínica E2E")).toBeVisible();
  await expect(page.getByText("Espaço E2E Offline")).toBeVisible();

  await page.getByRole("button", { name: /Clínica E2E/ }).click();
  await page.waitForURL(/\/inicio/);
  await expect(page.getByRole("banner").getByText("Clínica E2E")).toBeVisible();
});
