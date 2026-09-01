import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da Fase 4 sobre a Tela 9 (Pacientes e ficha): a etiqueta de risco de
// falta nasce sozinha das consultas, a ficha mostra os indicadores e a linha do
// tempo, o cadastro persiste, quem pediu para nao receber mensagens so volta com
// evidencia, a lista de espera aparece desabilitada com dica, o papel leitura ve
// tudo sem editar nada e o filtro de pacote separa quem tem saldo.

const NOME_COM_FALTAS = "Fátima Faltas";
const NOME_COM_PACOTE = "Paulo Pacote";

/** Bloco da ficha pelo titulo: section com o h2 do BlocoFicha. */
function bloco(page: Page, titulo: string) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: titulo, exact: true }),
  });
}

/** Cartao de indicador pelo rotulo: o rotulo e o valor moram no mesmo pai. */
function cartao(page: Page, rotulo: string) {
  return page.getByText(rotulo, { exact: true }).locator("..");
}

function linhaDaLista(page: Page, nome: string) {
  return page.getByRole("row").filter({ hasText: nome });
}

test("paciente com 2 faltas recebe a etiqueta sozinho", async ({ page }) => {
  // O fixture semeia duas consultas "faltou" e nenhuma etiqueta em
  // contact.tags: a de "Risco de falta" e DERIVADA na leitura, ninguem marcou.
  const d = dados();
  await login(page, d.emails.gestor);
  await page.goto("/pacientes");

  const linha = linhaDaLista(page, NOME_COM_FALTAS);
  await expect(linha).toBeVisible();
  await expect(linha.getByText("Risco de falta")).toBeVisible();

  await page.goto(`/pacientes/${d.pacientes.comFaltasId}`);
  await expect(
    page.getByRole("heading", { name: NOME_COM_FALTAS, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Risco de falta")).toBeVisible();
  await expect(cartao(page, "Faltas")).toContainText("2");
});

test("a ficha abre pelo teclado: o nome do paciente é um link", async ({
  page,
}) => {
  // Sem isto a ficha so abriria com o mouse (clique na linha da tabela), e
  // quem navega por teclado ou usa leitor de tela nao chegaria nela.
  const d = dados();
  await login(page, d.emails.gestor);
  await page.goto("/pacientes");

  const link = page.getByRole("link", {
    name: `Abrir a ficha de ${NOME_COM_FALTAS}`,
  });
  await expect(link).toHaveAttribute(
    "href",
    `/pacientes/${d.pacientes.comFaltasId}`,
  );

  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(
    new RegExp(`/pacientes/${d.pacientes.comFaltasId}`),
  );
  await expect(
    page.getByRole("heading", { name: NOME_COM_FALTAS, level: 1 }),
  ).toBeVisible();
});

test("a ficha mostra os três indicadores e a linha do tempo das consultas", async ({
  page,
}) => {
  const d = dados();
  await login(page, d.emails.gestor);
  await page.goto(`/pacientes/${d.pacientes.comFaltasId}`);

  // 1 compareceu e 2 faltou: cancelada nao entra na conta, e a taxa existe.
  await expect(cartao(page, "Total de consultas")).toContainText("3");
  await expect(cartao(page, "Faltas")).toContainText("2");
  await expect(cartao(page, "Taxa de comparecimento")).toContainText("33%");

  // A linha do tempo mostra TUDO, inclusive o que ainda vai acontecer: além
  // das 3 realizadas, esta paciente é a pendente de amanhã da Tela 2. O cartão
  // acima conta só as realizadas, por isso os dois números diferem de
  // propósito.
  const consultas = bloco(page, "Consultas").getByRole("listitem");
  await expect(consultas).toHaveCount(4);
  // Da mais recente para a mais antiga: a primeira é a de amanhã, a única que
  // ainda não aconteceu. Provado pelo que ela NÃO é, para não depender do
  // rótulo exato do status.
  await expect(consultas.first()).not.toContainText("Compareceu");
  await expect(consultas.first()).not.toContainText("Faltou");

  // A linha é buscada pelo estado, não pela posição: consulta nova no seed não
  // pode quebrar a asserção do que a ficha mostra de uma consulta realizada.
  const compareceu = consultas.filter({ hasText: "Compareceu" });
  await expect(compareceu).toHaveCount(1);
  await expect(compareceu).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  await expect(compareceu).toContainText("Consulta endocrinologia");
  await expect(compareceu).toContainText("Dr. João Pereira");
  // Valor do vinculo ATUAL, nunca preco inventado.
  await expect(compareceu).toContainText(/R\$\s?400,00/u);
  await expect(consultas.filter({ hasText: "Faltou" })).toHaveCount(2);
});

test("editar o cadastro persiste depois de recarregar", async ({ page }) => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo mutavel de escrita roda uma vez, no desktop",
  );

  const d = dados();
  // Reset idempotente: o retry do Playwright encontraria a observacao trocada.
  const admin = adminClient();
  await admin
    .from("contact")
    .update({ notes: "Prefere o turno da manhã." })
    .eq("id", d.pacientes.comPacoteId)
    .throwOnError();

  await login(page, d.emails.recepcao);
  await page.goto(`/pacientes/${d.pacientes.comPacoteId}`);

  const observacoes = page.getByLabel("Observações");
  await expect(observacoes).toHaveValue("Prefere o turno da manhã.");

  // Preencher e CONFERIR, repetindo até pegar. O textarea vem do servidor já
  // com o texto dentro, então ele tem valor antes de a página hidratar: um
  // fill que chegue nessa janela é desfeito quando o react-hook-form assume o
  // campo com o valor inicial, e o resultado era o texto novo grudado no
  // antigo. Esperar o valor "colar" é esperar o campo ser de verdade nosso.
  const TEXTO_NOVO = "Prefere o fim da tarde, depois das 17h.";
  await expect(async () => {
    await observacoes.fill(TEXTO_NOVO);
    await expect(observacoes).toHaveValue(TEXTO_NOVO);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  // Prazo folgado so aqui: esta e a primeira chamada da Server Action na
  // suite, e o servidor de desenvolvimento compila a rota na hora.
  await expect(page.getByText("Cadastro atualizado")).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();
  await expect(page.getByLabel("Observações")).toHaveValue(TEXTO_NOVO, {
    timeout: 20_000,
  });
});

test("paciente descadastrado mostra o pedido, e a nova autorização exige evidência", async ({
  page,
}) => {
  const d = dados();
  await login(page, d.emails.gestor);
  await page.goto(`/pacientes/${d.pacientes.descadastradoId}`);

  const autorizacao = bloco(page, "Autorização para receber mensagens");
  await expect(autorizacao).toContainText("Pediu para não receber mensagens");
  await expect(autorizacao).toContainText("Descadastrada em");

  await autorizacao
    .getByRole("button", { name: "Registrar nova autorização" })
    .click();
  const dialogo = page.getByRole("dialog");
  const confirmar = dialogo.getByRole("button", {
    name: "Registrar",
    exact: true,
  });
  await expect(confirmar).toBeDisabled();

  await dialogo
    .getByLabel("Evidência (obrigatória)")
    .fill("Pediu no balcão, na frente da recepção");
  await expect(confirmar).toBeEnabled();

  // Sai sem confirmar: a ficha segue descadastrada para as proximas execucoes.
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toBeHidden();
});

test("a lista de espera aparece visível e desabilitada, com a dica", async ({
  page,
}) => {
  const d = dados();
  await login(page, d.emails.gestor);
  await page.goto(`/pacientes/${d.pacientes.comFaltasId}`);

  const espera = page.getByRole("button", {
    name: "Adicionar à lista de espera",
  });
  await expect(espera).toBeVisible();
  await expect(espera).toBeDisabled();

  await espera.locator("..").focus();
  await expect(page.getByText("Chega com a lista de espera")).toBeVisible();
});

test("papel leitura abre a ficha inteira com as ações desabilitadas e com dica", async ({
  page,
}) => {
  const d = dados();
  await login(page, d.emails.leitura);
  await page.goto(`/pacientes/${d.pacientes.comFaltasId}`);

  // Ve tudo: identidade, etiqueta, indicadores e historico.
  await expect(
    page.getByRole("heading", { name: NOME_COM_FALTAS, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Risco de falta")).toBeVisible();
  await expect(cartao(page, "Total de consultas")).toContainText("3");
  // 3 realizadas no cartão, 4 na linha do tempo: a de amanhã aparece na lista
  // e não entra na conta de realizadas.
  await expect(bloco(page, "Consultas").getByRole("listitem")).toHaveCount(4);

  const vender = page.getByRole("button", { name: "Vender pacote" });
  await expect(vender).toBeVisible();
  await expect(vender).toBeDisabled();

  const salvar = page.getByRole("button", { name: "Salvar cadastro" });
  await expect(salvar).toBeVisible();
  await expect(salvar).toBeDisabled();

  await salvar.locator("..").focus();
  await expect(
    page.getByText("Seu perfil não pode editar leads e pacientes"),
  ).toBeVisible();
});

test("o filtro Com pacote deixa na lista quem tem saldo", async ({ page }) => {
  const d = dados();
  await login(page, d.emails.gestor);
  await page.goto("/pacientes");

  await expect(linhaDaLista(page, NOME_COM_PACOTE)).toBeVisible();
  await expect(linhaDaLista(page, NOME_COM_FALTAS)).toBeVisible();

  await page.getByRole("button", { name: "Com pacote" }).click();
  await expect(page).toHaveURL(/pacote=1/);
  await expect(linhaDaLista(page, NOME_COM_PACOTE)).toBeVisible();
  await expect(linhaDaLista(page, NOME_COM_FALTAS)).toHaveCount(0);
});
