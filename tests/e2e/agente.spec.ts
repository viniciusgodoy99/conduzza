import { expect, test, type Page } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Tela 6, Agente de IA. O painel (persona, habilidades, conhecimento, regras,
// versoes e o simulador) so existe nas duas clinicas da fase controlada
// (teste123 e Conduzza Teste), decidido no servidor pela mesma lista da aba
// de Configuracoes (abaDaIaVisivel). A clinica do e2e nao esta na lista, e
// a lista NAO aceita clinica e_de_teste (so o banco aceita, para as suites
// de RLS e integracao): aqui a tela e o vazio de sempre, sem ler nada do
// agente. A renderizacao do painel esta nos testes de unidade
// (tests/unit/agente/tela-*.test.tsx).
//
// O que se confere aqui:
// - fora da fase, o vazio honesto, sem abas, sem simulador e sem o rodape
//   de publicacao, para administrador e para a recepcao ("ver");
// - a guarda de papel da rota: "Somente leitura" (acesso "nada" na matriz)
//   vai para o Inicio, nem pelo menu nem pela URL.
// Roda so no desktop-1600: nada aqui depende da largura.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
});

async function conferirVazio(page: Page) {
  await page.goto("/agente");
  await expect(
    page.getByRole("heading", { level: 1, name: "Agente de IA" }),
  ).toBeVisible();
  await expect(
    page.getByText("A recepcionista de IA ainda não está ligada nesta clínica"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Abrir Atendimento" }),
  ).toBeVisible();
  // Nada do painel: nem abas, nem simulador, nem publicacao.
  await expect(page.getByRole("tab", { name: "Persona" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Versões" })).toHaveCount(0);
  await expect(page.getByText("Simulador", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publicar alterações" }),
  ).toHaveCount(0);
}

test("fora da fase controlada, o administrador vê o vazio sem painel", async ({
  page,
}) => {
  await login(page, dados().emails.admin);
  await conferirVazio(page);
  // ?aba= de uma aba do painel nao muda nada fora da fase.
  await page.goto("/agente?aba=instrucoes");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("Prévia do prompt")).toHaveCount(0);
});

test("a recepção entra no Agente de IA e vê o mesmo vazio", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Agente de IA" })).toBeVisible();
  await conferirVazio(page);
});

test("somente leitura não vê nem abre o Agente de IA", async ({ page }) => {
  await login(page, dados().emails.leitura);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Agente de IA" })).toHaveCount(0);

  await page.goto("/agente");
  await page.waitForURL(/\/inicio/);
});
