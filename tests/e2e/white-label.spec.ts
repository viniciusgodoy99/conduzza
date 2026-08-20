import { expect, test } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Aceite da tarefa 0.7: trocar labels e cor primaria no banco muda a
// interface inteira sem recompilar nem alterar codigo. O teste altera o
// branding da Clinica Vitalis via service role, confere na tela e restaura.
// Roda so no desktop-1600.

const DEFAULT_LABELS = {
  profissional: "profissional",
  procedimento: "procedimento",
  paciente: "paciente",
  consulta: "consulta",
};

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "white-label independe de viewport",
  );
});

test.afterEach(async () => {
  const admin = adminClient();
  await admin
    .from("clinic_branding")
    .update({ labels: DEFAULT_LABELS, primary_color: "#A8D318" })
    .eq("clinic_id", dados().clinicId);
});

test("labels e cor primária vêm do banco, sem rebuild", async ({ page }) => {
  const admin = adminClient();
  const { error } = await admin
    .from("clinic_branding")
    .update({
      labels: {
        ...DEFAULT_LABELS,
        paciente: "cliente",
        profissional: "advogado",
      },
      primary_color: "#7C3AED",
    })
    .eq("clinic_id", dados().clinicId);
  expect(error).toBeNull();

  await login(page, dados().emails.admin);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Clientes" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Pacientes" })).toHaveCount(0);

  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim()
      .toLowerCase(),
  );
  expect(primary).toBe("#7c3aed");
});
