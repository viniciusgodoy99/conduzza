import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Camada complementar do aceite da 0.3: o axe valida o contraste renderizado
// da pagina /dev/tokens nos dois temas. O app abre no claro (handoff).
// Contraste nao muda com viewport: roda so no desktop-1600.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "contraste independe de viewport",
  );
});

test.describe("/dev/tokens", () => {
  test("sem violação de contraste no tema claro (padrão)", async ({ page }) => {
    await page.goto("/dev/tokens");
    await expect(
      page.getByRole("heading", { name: "Design system" }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("sem violação de contraste no tema escuro", async ({ page }) => {
    await page.goto("/dev/tokens");
    await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
