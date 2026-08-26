import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da tarefa 4.4 (assistente de importacao de planilha): e impossivel
// importar sem declarar como os contatos autorizaram receber mensagens, e o
// alerta sobre a nota do numero aparece no passo da declaracao.

// CSV gerado no proprio teste: 2 linhas validas e 1 com telefone invalido.
const CSV = [
  "Nome;Telefone",
  "Ilda Importada;84 97111-0001",
  "Igor Importado;+55 84 97111-0002",
  "Linha Errada;sem numero",
].join("\n");

const TELEFONES_IMPORTADOS = ["+5584971110001", "+5584971110002"];

/** Abre o modal, sobe o CSV e devolve o dialogo ja com o arquivo lido. */
async function abrirComArquivo(page: Page) {
  await page.goto("/leads");
  await page.getByRole("button", { name: "Importar planilha" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Importar contatos" }),
  ).toBeVisible();
  await dialogo.locator('input[type="file"]').setInputFiles({
    name: "contatos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf-8"),
  });
  await expect(dialogo.getByText(/3 linhas de contato/)).toBeVisible();
  return dialogo;
}

test("é impossível importar sem declarar a autorização", async ({ page }) => {
  const d = dados();
  // Idempotente entre viewports e retries: apaga o que uma rodada anterior
  // importou, para "Contatos novos" valer 2 de novo.
  const admin = adminClient();
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", d.clinicId)
    .in("phone_e164", TELEFONES_IMPORTADOS)
    .throwOnError();

  await login(page, d.emails.gestor);
  const dialogo = await abrirComArquivo(page);
  const continuar = dialogo.getByRole("button", { name: "Continuar" });
  await continuar.click();

  // Passo de colunas: o pre-mapeamento pelo cabecalho Nome;Telefone resolve.
  await expect(
    dialogo.getByText("Diga de qual coluna da planilha vem cada informação"),
  ).toBeVisible();
  await continuar.click();

  // Passo da declaracao: sem escolher, continuar fica DESABILITADO.
  await expect(
    dialogo.getByText(
      "Como estas pessoas autorizaram receber mensagens da clínica",
    ),
  ).toBeVisible();
  await expect(continuar).toBeDisabled();
  await expect(
    dialogo.getByText(
      "Escolha como estes contatos autorizaram receber mensagens.",
    ),
  ).toBeVisible();

  await dialogo
    .getByRole("radio", { name: "Cadastro presencial na recepção" })
    .check();
  await expect(continuar).toBeEnabled();
  await continuar.click();

  // Previa: 2 validas e 1 invalida.
  await expect(
    dialogo.getByText("2 contatos prontos para importar"),
  ).toBeVisible();
  await expect(dialogo.getByText("1 linha inválida")).toBeVisible();

  await dialogo.getByRole("button", { name: "Importar 2 contatos" }).click();
  await expect(dialogo.getByText("Importação concluída")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    dialogo.locator("dl > div").filter({ hasText: "Contatos novos" }),
  ).toContainText("2");
  await expect(
    dialogo.locator("dl > div").filter({ hasText: "Linhas inválidas" }),
  ).toContainText("1");

  await dialogo.getByRole("button", { name: "Fechar" }).click();
  await expect(dialogo).toBeHidden();

  // Os contatos importados aparecem na lista de leads.
  await page.goto("/leads?visao=lista");
  await expect(
    page.getByRole("row").filter({ hasText: "Ilda Importada" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Igor Importado" }),
  ).toBeVisible();
});

test("o alerta sobre a nota do número aparece no passo da declaração", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  const dialogo = await abrirComArquivo(page);
  const continuar = dialogo.getByRole("button", { name: "Continuar" });
  await continuar.click();
  await expect(
    dialogo.getByText("Diga de qual coluna da planilha vem cada informação"),
  ).toBeVisible();
  await continuar.click();

  const aviso = dialogo.getByRole("note");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("derruba a nota do seu número no WhatsApp");
});
