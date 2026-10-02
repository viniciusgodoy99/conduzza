import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Tela 11, Resultados (Fase 3): as 4 vistas do design como abas de verdade
// (role=tab, ?aba=), o link antigo abrindo a vista que recebeu o conteudo, o
// objetivo de conversao definido por quem administra e os valores em reais
// fechados para a recepcao (visiveis, desabilitados, com dica).

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

async function removerObjetivo(): Promise<void> {
  await adminClient()
    .from("objetivo_de_conversao")
    .delete()
    .eq("clinic_id", dados().clinicId);
}

function cartao(page: Page, rotulo: string) {
  return page.getByRole("group", { name: rotulo, exact: true });
}

test("as 4 vistas são abas de verdade e a URL guarda a aba", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/relatorios");

  const lista = page.getByRole("tablist", { name: "Vistas de Resultados" });
  await expect(lista.getByRole("tab")).toHaveText([
    "Visão geral",
    "Marketing",
    "Comercial",
    "Agente de IA",
  ]);
  await expect(page.getByRole("tab", { name: "Visão geral" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const rotulo of [
    "Leads recebidos",
    "Consultas agendadas",
    "Taxa de conversão",
    "Custo por lead",
    "Faturamento estimado",
  ]) {
    await expect(cartao(page, rotulo)).toBeVisible();
  }
  // Sem rosca: a origem e em barras com o numero escrito.
  await expect(
    page.getByRole("heading", { name: "Origem dos leads" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Comercial" }).click();
  await expect(page).toHaveURL(/aba=comercial/);
  await expect(page.getByRole("tab", { name: "Comercial" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(cartao(page, "Consultas recuperadas")).toBeVisible();

  await page.getByRole("tab", { name: "Agente de IA" }).click();
  await expect(page).toHaveURL(/aba=ia/);
  await expect(
    page.getByRole("heading", { name: "Desempenho da recepcionista de IA" }),
  ).toBeVisible();
  // Clinica de e2e usa o provedor fake: nada de custo por mensagem.
  await expect(cartao(page, "Custo do período")).toHaveCount(0);
});

test("link antigo ?aba=confirmacao abre Comercial com a confirmação completa", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/relatorios?aba=confirmacao");

  await expect(page.getByRole("tab", { name: "Comercial" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Contra a linha de base" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Antes e depois da primeira mensagem de régua",
    }),
  ).toBeVisible();
});

test("admin define o objetivo de conversão e o rodapé mostra Objetivo: X%", async ({
  page,
}) => {
  apenasDesktop();
  await removerObjetivo();
  try {
    await login(page, dados().emails.admin);
    await page.goto("/relatorios");

    const taxa = cartao(page, "Taxa de conversão");
    await expect(taxa).toBeVisible();
    await expect(taxa).not.toContainText("Objetivo:");

    await taxa.getByRole("button", { name: "Definir objetivo" }).click();
    const dialogo = page.getByRole("dialog", { name: "Objetivo de conversão" });
    await dialogo.getByLabel("Objetivo (%)").fill("35,5");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    await expect(dialogo).toBeHidden();
    await expect(taxa).toContainText("Objetivo: 35,5%");

    // Remover devolve o cartao ao estado sem objetivo (o rodape some).
    await taxa.getByRole("button", { name: "Alterar objetivo" }).click();
    await dialogo.getByRole("button", { name: "Remover objetivo" }).click();
    await expect(dialogo).toBeHidden();
    await expect(taxa).not.toContainText("Objetivo:");
  } finally {
    await removerObjetivo();
  }
});

test("recepção vê Faturamento e o objetivo desabilitados, com dica", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.recepcao);
  await page.goto("/relatorios");

  // Faturamento: visivel, sem numero nenhum em reais, com a dica.
  const faturamento = cartao(page, "Faturamento estimado");
  await expect(faturamento).toContainText("Sem acesso");
  await expect(faturamento).not.toContainText("R$");
  await faturamento.locator("span[tabindex='0']").hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Só administrador e gestor veem valores em reais.",
  );

  // Objetivo: o botao existe, desabilitado, e diz por que.
  const botao = cartao(page, "Taxa de conversão").getByRole("button", {
    name: /(Definir|Alterar) objetivo/,
  });
  await expect(botao).toBeDisabled();
  // Tira o mouse da primeira dica (em passos, como um mouse de verdade) e
  // espera ela fechar antes de passar no botao.
  await page.mouse.move(8, 8, { steps: 12 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // O `has` e relativo ao envoltorio da dica: um seletor que comeca pelo
  // cartao nunca casaria dentro dele.
  await cartao(page, "Taxa de conversão")
    .locator("span[tabindex='0']", {
      has: page.getByRole("button", { name: /(Definir|Alterar) objetivo/ }),
    })
    .hover();
  // A dica do Faturamento pode seguir aberta um instante: espera a do botao.
  await expect(
    page
      .getByRole("tooltip")
      .filter({ hasText: "Só administrador e gestor definem o objetivo de conversão." }),
  ).toBeVisible();

  // Custo por lead tambem e valor em reais.
  await expect(cartao(page, "Custo por lead")).toContainText("Sem acesso");
});
