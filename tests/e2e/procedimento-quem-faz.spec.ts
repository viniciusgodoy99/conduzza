import { expect, test, type Locator, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Vinculo dentro do Procedimento (decisao do dono em 29/09/2026: a aba
// Vinculos saiu de Cadastros). Aceites portados da antiga aba para a secao
// "Quem faz e convênios" do modal do Procedimento:
// - o caso do Dr. Joao (spec 3.5): Coberto e rotulo, nunca R$ 0,00; o
//   Particular tem preco de verdade; o gratuito e R$ 0,00;
// - um procedimento novo com dois profissionais em que so um aceita Unimed,
//   com excecao de preco e duracao para o outro, e a consulta marcada na
//   Agenda com o procedimento recem configurado (pela Unimed so aparece quem
//   aceita Unimed);
// - quem so ve Cadastros le quem faz e por quanto, sem Salvar.

const PREFIXO_DO_PROCEDIMENTO = "Retorno endócrino E2E";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo completo roda uma vez, no desktop",
  );
}

async function abrirProcedimento(page: Page, nome: string): Promise<Locator> {
  await page
    .getByRole("button", { name: `Editar ${nome}`, exact: true })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Editar procedimento" }),
  ).toBeVisible();
  await expect(
    dialogo.getByRole("heading", { name: "Quem faz e convênios" }),
  ).toBeVisible();
  return dialogo;
}

function cartaoDe(dialogo: Locator, profissional: string): Locator {
  return dialogo.getByRole("group", { name: profissional, exact: true });
}

function linhaDoConvenio(cartao: Locator, convenio: string): Locator {
  return cartao.getByRole("listitem").filter({ hasText: convenio });
}

test.afterAll(async () => {
  // O procedimento criado pelo teste (e a consulta marcada com ele) sai do
  // banco: os specs seguintes veem a Clinica E2E como o setup deixou. A
  // consulta antes, porque appointment.service_link_id nao tem cascata.
  const admin = adminClient();
  const { data: procedimentos } = await admin
    .from("procedure")
    .select("id")
    .eq("clinic_id", dados().clinicId)
    .like("name", `${PREFIXO_DO_PROCEDIMENTO}%`);
  const ids = (procedimentos ?? []).map((p) => p.id as string);
  if (ids.length === 0) {
    return;
  }
  const { data: vinculos } = await admin
    .from("service_link")
    .select("id")
    .in("procedure_id", ids);
  const idsDosVinculos = (vinculos ?? []).map((v) => v.id as string);
  if (idsDosVinculos.length > 0) {
    await admin
      .from("appointment")
      .delete()
      .in("service_link_id", idsDosVinculos);
  }
  await admin.from("procedure").delete().in("id", ids);
});

test("o caso do Dr. João no modal do Procedimento", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=procedimentos");

  // A tabela ja diz quem faz e por quais convenios.
  const linhaEndo = page
    .getByRole("row")
    .filter({ hasText: "Consulta endocrinologia" });
  await expect(linhaEndo).toContainText("Dr. João Pereira");
  await expect(linhaEndo).toContainText("Particular, Unimed");

  const dialogo = await abrirProcedimento(page, "Consulta endocrinologia");
  const joao = cartaoDe(dialogo, "Dr. João Pereira");
  await expect(joao).toBeVisible();

  // Ele aceita Unimed; Bradesco nao.
  await expect(
    joao.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toBeChecked();
  await expect(
    joao.getByRole("checkbox", { name: "Bradesco Saúde", exact: true }),
  ).not.toBeChecked();

  // Coberto pelo convênio é rótulo, nunca moeda.
  const unimed = linhaDoConvenio(joao, "Unimed");
  await expect(unimed).toContainText("Coberto");
  await expect(unimed).not.toContainText("0,00");

  // Particular tem preço de verdade.
  await expect(linhaDoConvenio(joao, "Particular")).toContainText(
    /R\$\s?400,00/u,
  );

  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();

  // Gratuito de verdade é R$ 0,00, diferente de coberto.
  const gratis = await abrirProcedimento(page, "Avaliação gratuita");
  await expect(
    linhaDoConvenio(cartaoDe(gratis, "Dr. João Pereira"), "Particular"),
  ).toContainText(/R\$\s?0,00/u);
});

test("procedimento novo com quem faz, e a consulta marcada na Agenda", async ({
  page,
}) => {
  apenasDesktop();
  const nome = `${PREFIXO_DO_PROCEDIMENTO} ${Date.now().toString(36)}`;
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=procedimentos");

  await page.getByRole("button", { name: "Novo procedimento" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Novo procedimento" }),
  ).toBeVisible();
  await dialogo.getByLabel("Nome", { exact: true }).fill(nome);
  await dialogo.getByLabel("Duração (min)", { exact: true }).fill("30");
  await dialogo.getByLabel("Preço base (R$)").fill("300,00");

  // Ninguem ainda: o vazio explica o que falta.
  await expect(
    dialogo.getByText("Ninguém faz este procedimento ainda."),
  ).toBeVisible();

  // Dr. Joao: Particular pelo padrao e Unimed (Coberto pelo padrao).
  await dialogo.getByRole("combobox", { name: "Adicionar quem faz" }).click();
  await page.getByRole("option", { name: "Dr. João Pereira" }).click();
  const joao = cartaoDe(dialogo, "Dr. João Pereira");
  await expect(
    joao.getByRole("checkbox", { name: "Particular", exact: true }),
  ).toBeChecked();
  await joao.getByRole("checkbox", { name: "Unimed", exact: true }).click();
  await expect(linhaDoConvenio(joao, "Unimed")).toContainText("Coberto");
  await expect(linhaDoConvenio(joao, "Particular")).toContainText(
    /R\$\s?300,00/u,
  );

  // Dra. Ana: so Particular, com preco e duracao proprios.
  await dialogo.getByRole("combobox", { name: "Adicionar quem faz" }).click();
  await page.getByRole("option", { name: "Dra. Ana Costa" }).click();
  const ana = cartaoDe(dialogo, "Dra. Ana Costa");
  await ana
    .getByRole("button", { name: "Personalizar Particular de Dra. Ana Costa" })
    .click();
  await ana.getByLabel("Valor (R$) de Particular").fill("350,00");
  await ana.getByLabel("Duração (min) de Particular").fill("45");

  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialogo).toBeHidden();

  const linha = page.getByRole("row").filter({ hasText: nome });
  await expect(linha).toContainText("Dr. João Pereira");
  await expect(linha).toContainText("Dra. Ana Costa");
  await expect(linha).toContainText("Particular, Unimed");

  // Reaberto, o modal mostra o que foi gravado.
  const reaberto = await abrirProcedimento(page, nome);
  const joaoGravado = cartaoDe(reaberto, "Dr. João Pereira");
  const anaGravada = cartaoDe(reaberto, "Dra. Ana Costa");
  await expect(
    joaoGravado.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toBeChecked();
  await expect(
    anaGravada.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).not.toBeChecked();
  await expect(linhaDoConvenio(anaGravada, "Particular")).toContainText(
    "Personalizado",
  );
  await expect(anaGravada.getByLabel("Valor (R$) de Particular")).toHaveValue(
    "350,00",
  );
  await expect(
    anaGravada.getByLabel("Duração (min) de Particular"),
  ).toHaveValue("45");
  await page.keyboard.press("Escape");
  await expect(reaberto).toBeHidden();

  // Agenda: pela Unimed, este procedimento so oferece o Dr. Joao.
  await page.goto("/agenda");
  await expect(page.getByText("Dr. João Pereira").first()).toBeVisible();
  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const modal = page.getByRole("dialog", { name: "Nova consulta" });
  await modal.getByLabel("Paciente").fill("Roberto");
  await modal.getByRole("button", { name: /Roberto Recibo/ }).click();
  await modal.getByRole("combobox", { name: "Convênio" }).click();
  await page.getByRole("option", { name: "Unimed" }).click();
  await modal.getByRole("combobox", { name: "Procedimento" }).click();
  await page.getByRole("option", { name: nome }).click();
  await modal.getByRole("combobox", { name: "Profissional" }).click();
  await expect(
    page.getByRole("option", { name: /Dr\. João Pereira/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /Dra\. Ana Costa/ }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: /Dr\. João Pereira/ }).click();

  await modal
    .getByRole("button", { name: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  await modal.getByRole("button", { name: "Marcar consulta" }).click();
  await expect(page.getByText(/Consulta marcada para/)).toBeVisible();
  await expect(modal).not.toBeVisible();
});

test("recepção lê quem faz e por quanto, sem poder salvar", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/cadastros?aba=procedimentos");

  // A acao de editar continua visivel e desabilitada.
  await expect(
    page.getByRole("button", {
      name: "Editar Consulta endocrinologia",
      exact: true,
    }),
  ).toBeDisabled();

  await page
    .getByRole("button", {
      name: "Ver detalhes de Consulta endocrinologia",
      exact: true,
    })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Consulta endocrinologia" }),
  ).toBeVisible();
  await expect(dialogo.getByText("Quem faz e convênios")).toBeVisible();
  // A linha do convenio (a do profissional tambem contem o texto, mas
  // comeca pelo nome dele).
  const unimed = dialogo.getByRole("listitem").filter({ hasText: /^Unimed:/u });
  await expect(unimed).toContainText("Coberto");
  await expect(unimed).not.toContainText("0,00");
  await expect(
    dialogo.getByRole("listitem").filter({ hasText: /^Particular:/u }),
  ).toContainText(/R\$\s?400,00/u);
  await expect(
    dialogo.getByRole("button", { name: "Salvar", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialogo.getByRole("combobox", { name: "Adicionar quem faz" }),
  ).toHaveCount(0);
});
