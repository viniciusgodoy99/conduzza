import { expect, test, type Page } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da Fase 2 sobre o catalogo (tela de Cadastros): os tres estados de
// preco do vinculo (o caso do Dr. Joao), criacao de vinculo pela interface,
// papel de leitura com acao visivel e desabilitada, e bloqueio em lote.

const NOME_JOAO = "Dr. João Pereira · CRM 12345 · Endocrinologia, Nutrologia";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo completo roda uma vez, no desktop",
  );
}

function itemJoao(page: Page) {
  return page
    .locator('[data-slot="accordion-item"]')
    .filter({ hasText: "Dr. João Pereira" });
}

async function abrirAcordeaoJoao(page: Page): Promise<void> {
  const gatilho = page.getByRole("button", { name: NOME_JOAO });
  await expect(gatilho).toBeVisible();
  if ((await gatilho.getAttribute("aria-expanded")) !== "true") {
    await gatilho.click();
  }
}

test("o caso do Dr. João aparece sem gambiarra na aba Vínculos", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=vinculos");
  await abrirAcordeaoJoao(page);

  const linhas = itemJoao(page).getByRole("row");

  // Coberto pelo convênio é rótulo, nunca moeda.
  const linhaUnimed = linhas.filter({ hasText: "Unimed" });
  await expect(linhaUnimed).toContainText("Coberto");
  await expect(linhaUnimed).not.toContainText("0,00");

  // Particular tem preço de verdade.
  const linhaParticular = linhas
    .filter({ hasText: "Consulta endocrinologia" })
    .filter({ hasText: "Particular" });
  await expect(linhaParticular).toContainText(/R\$\s?400,00/u);

  // Gratuito de verdade é R$ 0,00, diferente de coberto.
  const linhaGratuita = linhas.filter({ hasText: "Avaliação gratuita" });
  await expect(linhaGratuita).toContainText(/R\$\s?0,00/u);
});

test("criar um vínculo novo pela interface", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=vinculos");
  await abrirAcordeaoJoao(page);

  await itemJoao(page)
    .getByRole("button", { name: "Adicionar", exact: true })
    .click();

  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Adicionar vínculo" }),
  ).toBeVisible();

  await dialogo.getByLabel("Procedimento").click();
  await page.getByRole("option", { name: "Consulta endocrinologia" }).click();

  await dialogo.getByLabel("Convênio").click();
  await page.getByRole("option", { name: "Bradesco Saúde" }).click();

  await dialogo.getByRole("button", { name: "Coberto pelo convênio" }).click();
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialogo).toBeHidden();

  const linhaNova = itemJoao(page)
    .getByRole("row")
    .filter({ hasText: "Bradesco Saúde" });
  await expect(linhaNova).toBeVisible();
  await expect(linhaNova).toContainText("Coberto");
});

test("recepção vê tudo mas com as ações desabilitadas", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/cadastros?aba=vinculos");

  // O conteúdo aparece: nada de esconder do papel que só lê.
  await expect(page.getByRole("button", { name: NOME_JOAO })).toBeVisible();

  const adicionar = page
    .getByRole("button", { name: "Adicionar", exact: true })
    .first();
  await expect(adicionar).toBeVisible();
  await expect(adicionar).toBeDisabled();

  // A dica explica o porquê ao focar o invólucro do botão desabilitado.
  await adicionar.locator("..").focus();
  await expect(
    page.getByText("Somente administradores e gestores alteram os cadastros"),
  ).toBeVisible();
});

test("bloqueio em lote cria uma linha por profissional", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=bloqueios");

  await page.getByRole("button", { name: "Novo bloqueio" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Novo bloqueio" }),
  ).toBeVisible();

  const marcarTodos = dialogo
    .locator("label", { hasText: "Selecionar todos" })
    .getByRole("checkbox");
  await marcarTodos.click();
  await expect(marcarTodos).toBeChecked();

  // Amanhã, calculado sobre o dia provisionado pela fixture.
  const [ano, mes, dia] = dados().agenda.diaISO.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const amanha = new Date(ano, mes - 1, dia + 1);
  const amanhaISO = [
    amanha.getFullYear(),
    String(amanha.getMonth() + 1).padStart(2, "0"),
    String(amanha.getDate()).padStart(2, "0"),
  ].join("-");

  await dialogo.getByLabel("Início").fill(`${amanhaISO}T08:00`);
  await dialogo.getByLabel("Fim").fill(`${amanhaISO}T09:00`);
  await dialogo.getByLabel("Motivo").fill("Reunião de equipe");
  await dialogo.getByRole("button", { name: "Criar bloqueio" }).click();
  await expect(dialogo).toBeHidden();

  await expect(
    page.getByRole("row").filter({ hasText: "Reunião de equipe" }),
  ).toHaveCount(2);
});
