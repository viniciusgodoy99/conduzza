import { expect, test, type Page } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da tela de Cadastros depois da decisao do dono de 29/09/2026: as
// abas Vinculos, Recursos e Bloqueios sairam (link antigo redireciona), todo
// cadastro abre em modal central, e o papel que so le ve o conteudo com a
// acao visivel e desabilitada. Os aceites do vinculo (o caso do Dr. Joao,
// agora no modal do Procedimento) e do bloqueio em lote (agora na Agenda)
// vivem nos arquivos das frentes que os levaram para la.

const DICA_DE_QUEM_SO_VE =
  "Somente administradores e gestores alteram os cadastros";

// Distancia maxima, em px, entre o centro do modal e o centro da tela para
// ele contar como central (um painel lateral fica centenas de px fora).
const FOLGA_DO_CENTRO_PX = 24;

async function esperarModalCentral(page: Page): Promise<void> {
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  // Espera a animacao de entrada (zoom e deslize) assentar antes de medir.
  await expect
    .poll(async () => {
      const caixa = await dialogo.boundingBox();
      const tela = page.viewportSize();
      if (!caixa || !tela) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.max(
        Math.abs(caixa.x + caixa.width / 2 - tela.width / 2),
        Math.abs(caixa.y + caixa.height / 2 - tela.height / 2),
      );
    })
    .toBeLessThanOrEqual(FOLGA_DO_CENTRO_PX);
}

test("as abas que saíram de Cadastros não aparecem e o link antigo leva ao lugar novo", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);

  // Vínculo agora é feito dentro do Procedimento.
  await page.goto("/cadastros?aba=vinculos");
  await page.waitForURL(/\/cadastros\?aba=procedimentos$/);
  await expect(
    page.getByRole("tab", { name: /^Procedimentos/ }),
  ).toHaveAttribute("aria-selected", "true");

  // Recursos e Bloqueios caem na aba padrão.
  for (const antiga of ["recursos", "bloqueios"]) {
    await page.goto(`/cadastros?aba=${antiga}`);
    await page.waitForURL(/\/cadastros$/);
    await expect(
      page.getByRole("tab", { name: /^Profissionais/ }),
    ).toHaveAttribute("aria-selected", "true");
  }

  await expect(page.getByRole("tab")).toHaveCount(5);
  for (const nome of [/^Vínculos/, /^Recursos/, /^Bloqueios/]) {
    await expect(page.getByRole("tab", { name: nome })).toHaveCount(0);
  }
});

test("cadastro abre em modal central, com Salvar no rodapé e Esc fechando", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=convenios");

  await page.getByRole("button", { name: "Novo convênio" }).click();
  await esperarModalCentral(page);

  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Novo convênio" }),
  ).toBeVisible();
  await expect(dialogo.getByLabel("Nome", { exact: true })).toBeVisible();
  await expect(
    dialogo.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeVisible();
  await expect(
    dialogo.getByRole("button", { name: "Cancelar", exact: true }),
  ).toBeVisible();

  // Nada foi gravado: Esc fecha sem salvar.
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
});

test("recepção vê tudo mas com as ações desabilitadas", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/cadastros?aba=convenios");

  // O conteúdo aparece: nada de esconder do papel que só lê.
  await expect(
    page.getByRole("row").filter({ hasText: "Unimed" }).first(),
  ).toBeVisible();

  const novo = page.getByRole("button", { name: "Novo convênio" });
  await expect(novo).toBeVisible();
  await expect(novo).toBeDisabled();

  // A dica explica o porquê ao focar o invólucro do botão desabilitado.
  await novo.locator("..").focus();
  await expect(page.getByText(DICA_DE_QUEM_SO_VE)).toBeVisible();

  // "Ver detalhes" abre o mesmo modal central, só para ler: sem Salvar.
  await page
    .getByRole("button", { name: "Ver detalhes de Unimed", exact: true })
    .click();
  await esperarModalCentral(page);
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Unimed", exact: true }),
  ).toBeVisible();
  await expect(
    dialogo.getByRole("button", { name: "Salvar", exact: true }),
  ).toHaveCount(0);
});
