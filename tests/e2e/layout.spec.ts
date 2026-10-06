import { expect, test, type Page } from "@playwright/test";

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

// Nenhuma tela rola de lado (defeito de 06/10/2026). A grade das paginas
// tinha uma coluna automatica, que nunca encolhe abaixo do conteudo mais
// largo: a fileira de abas de Configuracoes (com a 10a, Agente de IA, nas
// duas clinicas da fase controlada) empurrava tudo para fora da tela e
// cortava a coluna da direita. A fileira de abas rola por dentro (docs/06,
// abas "line"); a pagina nunca. Quem rola e o <main> do shell (a janela
// nunca rola), entao a medida vale nos dois.
async function conferirSemRolagemLateral(page: Page, onde: string) {
  const medida = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      main: main ? main.scrollWidth - main.clientWidth : -1,
      janela:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(medida.main, `<main> ausente em ${onde}`).toBeGreaterThanOrEqual(0);
  expect(medida.main, `rolagem lateral em ${onde}`).toBe(0);
  expect(medida.janela, `janela rolando em ${onde}`).toBe(0);
}

for (const rota of [
  "/inicio",
  "/cadastros",
  "/relatorios",
  "/automacoes",
  "/configuracoes",
]) {
  test(`${rota} não rola de lado em nenhuma aba`, async ({ page }) => {
    await login(page, dados().emails.admin);
    await page.goto(rota);
    await expect(page.locator("main h1").first()).toBeVisible();
    await conferirSemRolagemLateral(page, rota);

    const abas = page.locator("main").getByRole("tab");
    const total = await abas.count();
    for (let i = 0; i < total; i++) {
      const aba = abas.nth(i);
      const nome = (await aba.textContent())?.trim() || `aba ${i + 1}`;
      await aba.click();
      await expect(aba).toHaveAttribute("aria-selected", "true");
      await conferirSemRolagemLateral(page, `${rota}, aba ${nome}`);
    }
  });
}

test("aba aberta por link aparece na fileira mesmo quando a fileira rola", async ({
  page,
}) => {
  // A ultima aba de Configuracoes, aberta pela URL: sem rolar a fileira ate
  // ela, a aba ativa nasceria escondida depois da borda.
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=google");
  const lista = page.locator("main").getByRole("tablist").first();
  const ativa = lista.getByRole("tab", { selected: true });
  await expect(ativa).toHaveText(/Anúncios do Google/);
  await expect
    .poll(async () => {
      const caixa = await lista.boundingBox();
      const aba = await ativa.boundingBox();
      if (!caixa || !aba) return false;
      // 1px de folga: a largura da fileira e fracionaria e a rolagem nao.
      return (
        aba.x >= caixa.x - 1 && aba.x + aba.width <= caixa.x + caixa.width + 1
      );
    })
    .toBe(true);
});
