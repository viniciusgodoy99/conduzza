import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Camada complementar do aceite da 0.3: o axe valida o contraste renderizado
// da pagina /dev/tokens nos dois temas.
test.describe("/dev/tokens", () => {
  test("sem violação de contraste no tema escuro (padrão)", async ({
    page,
  }) => {
    await page.goto("/dev/tokens");
    await expect(
      page.getByRole("heading", { name: "Design system" }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("sem violação de contraste no tema claro", async ({ page }) => {
    await page.goto("/dev/tokens");
    await page.getByRole("button", { name: "Mudar para tema claro" }).click();
    await expect(page.locator("html")).toHaveClass(/light/);
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
