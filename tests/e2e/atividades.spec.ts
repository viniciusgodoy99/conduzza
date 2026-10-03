import { expect, test } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Atividades (escopo de 02/10/2026): criar pelo drawer do lead, ver na tela
// Atividades (Minhas), concluir com "Desfazer", o link do Inicio abrindo a
// tela ja filtrada nas atrasadas e o papel leitura vendo a atividade, com
// "Nova atividade" e o concluir da linha desabilitados e com dica. O fluxo
// muda dado: roda uma vez, no desktop.

const NOME_DO_LEAD = "Otávio Origem";

async function idDoMembro(papel: string): Promise<string> {
  const d = dados();
  const { data } = await adminClient()
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", d.clinicId)
    .eq("role", papel)
    .eq("status", "ativo")
    .limit(1)
    .single()
    .throwOnError();
  return (data as { user_id: string }).user_id;
}

async function apagarAtividades(titulo: string): Promise<void> {
  // So o service role apaga (a sessao nao tem DELETE): limpeza do teste.
  await adminClient()
    .from("contact_activity")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("titulo", titulo)
    .throwOnError();
}

function soNoDesktop() {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo mutavel roda uma vez, no desktop",
  );
}

test.describe("Atividades", () => {
  test("criar pelo drawer, ver em Minhas, concluir e desfazer", async ({
    page,
  }) => {
    soNoDesktop();
    const d = dados();
    const titulo = `Ligar para confirmar retorno ${Date.now()}`;
    try {
      await login(page, d.emails.recepcao);
      await page.goto("/leads");
      await page.getByRole("button", { name: `Abrir ${NOME_DO_LEAD}` }).click();

      const drawer = page.getByRole("dialog", { name: NOME_DO_LEAD });
      await expect(
        drawer.getByRole("heading", { name: "Atividades" }),
      ).toBeVisible();
      await drawer.getByRole("button", { name: "Nova atividade" }).click();

      const dialogo = page.getByRole("dialog", { name: "Nova atividade" });
      await dialogo.getByLabel("O que fazer").fill(titulo);
      // Padrao: Amanha, e o responsavel e quem cria.
      await expect(
        dialogo.getByRole("button", { name: "Amanhã" }),
      ).toHaveAttribute("aria-pressed", "true");
      await dialogo.getByRole("button", { name: "Criar atividade" }).click();
      await expect(dialogo).toBeHidden();

      await expect(drawer.getByText(titulo)).toBeVisible();
      await expect(drawer.getByText("Amanhã").first()).toBeVisible();

      await page.goto("/atividades");
      await expect(
        page.getByRole("heading", { level: 1, name: "Atividades" }),
      ).toBeVisible();
      const grupoAmanha = page.getByRole("region", { name: /Amanhã/ });
      await expect(grupoAmanha.getByText(titulo)).toBeVisible();

      await page.getByRole("button", { name: `Concluir: ${titulo}` }).click();
      await expect(page.getByText("Atividade concluída")).toBeVisible();
      await expect(page.getByText(titulo)).toBeHidden();

      await page.getByRole("button", { name: "Desfazer" }).click();
      await expect(page.getByText(titulo)).toBeVisible();
    } finally {
      await apagarAtividades(titulo);
    }
  });

  test("o Início leva às suas atrasadas, já filtradas", async ({ page }) => {
    soNoDesktop();
    const d = dados();
    const titulo = `Retornar orçamento ${Date.now()}`;
    const recepcao = await idDoMembro("recepcao");
    // Semeada pelo service role (sem sessao): origem manual exige autor.
    await adminClient()
      .from("contact_activity")
      .insert({
        clinic_id: d.clinicId,
        contact_id: d.leads.comOrigemId,
        titulo,
        due_on: "2026-01-05",
        assignee_user_id: recepcao,
        created_by: recepcao,
      })
      .throwOnError();
    try {
      await login(page, d.emails.recepcao);
      await page.goto("/inicio");
      const linha = page.getByRole("link", {
        name: /Suas atividades atrasadas/,
      });
      await expect(linha).toBeVisible();
      await linha.click();
      await page.waitForURL(/\/atividades\?filtro=atrasadas/);
      await expect(
        page.getByRole("combobox", { name: "Situação" }),
      ).toContainText("Atrasadas");
      const grupo = page.getByRole("region", { name: /Atrasadas/ });
      await expect(grupo.getByText(titulo)).toBeVisible();
      await expect(grupo.getByText("Atrasada").first()).toBeVisible();
    } finally {
      await apagarAtividades(titulo);
    }
  });

  test("papel leitura vê, mas cria e conclui desabilitados com dica", async ({
    page,
  }) => {
    soNoDesktop();
    const d = dados();
    const titulo = `Conferir retorno pela leitura ${Date.now()}`;
    const recepcao = await idDoMembro("recepcao");
    // Sem uma atividade na lista nao ha concluir para conferir: semeada pelo
    // service role (sem sessao), com autor, como no teste do Inicio.
    await adminClient()
      .from("contact_activity")
      .insert({
        clinic_id: d.clinicId,
        contact_id: d.leads.comOrigemId,
        titulo,
        due_on: "2026-01-05",
        assignee_user_id: recepcao,
        created_by: recepcao,
      })
      .throwOnError();
    try {
      await login(page, d.emails.leitura);
      await page.goto("/atividades?quem=todas");

      // Ve: a atividade da equipe aparece para quem so le.
      await expect(page.getByText(titulo)).toBeVisible();

      // Cria: "Nova atividade" visivel, desabilitado e com a dica.
      const nova = page.getByRole("button", { name: "Nova atividade" }).first();
      await expect(nova).toBeVisible();
      await expect(nova).toBeDisabled();
      await nova.locator("..").hover();
      await expect(page.getByRole("tooltip")).toContainText(
        "Seu perfil não pode",
      );

      // Tira o mouse da primeira dica (em passos, como um mouse de verdade) e
      // espera ela fechar: as duas dicas tem o mesmo texto.
      await page.mouse.move(8, 8, { steps: 12 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);

      // Conclui: o botao da linha visivel, desabilitado e com a dica.
      const concluir = page.getByRole("button", {
        name: `Concluir: ${titulo}`,
      });
      await expect(concluir).toBeVisible();
      await expect(concluir).toBeDisabled();
      await concluir.locator("..").hover();
      await expect(page.getByRole("tooltip")).toContainText(
        "Seu perfil não pode",
      );
    } finally {
      await apagarAtividades(titulo);
    }
  });
});
