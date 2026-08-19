import { expect, test } from "@playwright/test";

test("a página inicial responde", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
});
