import { expect, test, type Page } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceite da tarefa 2.7 sobre o seed da agenda: as duas confirmacoes sao
// status distintos e visiveis ao mesmo tempo, falta exige confirmacao
// explicita, o historico registra autoria e momento, o encaixe da IA passa
// por aprovacao humana e a mudanca de status reflete em outra sessao.
//
// Os testes deste arquivo MUTAM o seed em cadeia (workers 1, ordem do
// arquivo): o Roberto Recibo vai de Agendado para Confirmado pela recepção
// (teste 1) e depois para Faltou (teste 2); o teste 3 le o historico dele.
// Por isso o arquivo roda so no desktop-1600: repetir por viewport quebraria
// as precondicoes.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo mutavel em cadeia, roda uma vez so",
  );
});

// aria-label do bloco: "Nome, HH:MM, Rotulo do status". Selecionar por ele
// evita colidir com a legenda de situações do painel lateral, que repete os
// mesmos rotulos.
function bloco(page: Page, rotuloAcessivel: RegExp) {
  return page.getByRole("button", { name: rotuloAcessivel });
}

async function abrirAgenda(page: Page, email: string): Promise<void> {
  await login(page, email);
  await page.goto("/agenda");
  await expect(
    page.getByRole("complementary", { name: "Pendente de você" }),
  ).toBeVisible();
}

test("chip diferencia confirmado por WhatsApp de confirmado pela recepção", async ({
  page,
}) => {
  await abrirAgenda(page, dados().emails.recepcao);

  // Estado do seed: Camila 09:00 confirmada pelo WhatsApp, Roberto 08:00
  // apenas agendado.
  await expect(
    bloco(page, /Camila Áudio, 09:00, Confirmado por WhatsApp/),
  ).toBeVisible();
  await expect(bloco(page, /Roberto Recibo, 08:00, Agendado/)).toBeVisible();

  // Recepcao confirma por telefone: o status pergunta o canal antes de mudar.
  await bloco(page, /Roberto Recibo, 08:00, Agendado/).click();
  await page
    .getByRole("menuitem", { name: "Confirmado pela recepção" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Como a confirmação chegou?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Telefone" }).click();

  // Os DOIS rotulos distintos na tela ao mesmo tempo: autoria no status.
  await expect(
    bloco(page, /Roberto Recibo, 08:00, Confirmado pela recepção/),
  ).toBeVisible();
  await expect(
    bloco(page, /Camila Áudio, 09:00, Confirmado por WhatsApp/),
  ).toBeVisible();
});

test("faltou exige confirmação explícita", async ({ page }) => {
  await abrirAgenda(page, dados().emails.recepcao);
  const blocoRoberto = bloco(
    page,
    /Roberto Recibo, 08:00, Confirmado pela recepção/,
  );
  await expect(blocoRoberto).toBeVisible();

  // Primeira tentativa: cancelar NAO muda nada.
  await blocoRoberto.click();
  await page.getByRole("menuitem", { name: "Faltou" }).click();
  await expect(
    page.getByRole("heading", { name: "Marcar falta de Roberto Recibo?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Falta é sempre uma ação registrada, nunca automática."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(blocoRoberto).toBeVisible();

  // Segunda tentativa: confirmar de fato muda o chip.
  await blocoRoberto.click();
  await page.getByRole("menuitem", { name: "Faltou" }).click();
  await page.getByRole("button", { name: "Confirmar falta" }).click();
  // A troca de rotulo passa por action + refetch: orcamento maior que o
  // padrao de 5s para nao falhar sob carga.
  await expect(bloco(page, /Roberto Recibo, 08:00, Faltou/)).toBeVisible({
    timeout: 10_000,
  });
});

test("histórico mostra quem mudou o que e quando", async ({ page }) => {
  await abrirAgenda(page, dados().emails.recepcao);

  await bloco(page, /Roberto Recibo, 08:00, Faltou/).click();
  await page.getByRole("menuitem", { name: "Ver histórico" }).click();

  const folha = page.getByRole("dialog");
  await expect(
    folha.getByRole("heading", { name: "Histórico da consulta" }),
  ).toBeVisible();

  // Linha inicial gravada pelo gatilho do INSERT e a mudanca do teste 1,
  // cada uma com autoria e momento no fuso da clinica.
  await expect(folha.getByText("Agendado", { exact: true })).toBeVisible();
  await expect(folha.getByText("Confirmado pela recepção")).toBeVisible();
  await expect(folha.getByText("por Equipe").first()).toBeVisible();
  await expect(
    folha.getByText(/\d{2}\/\d{2} às \d{2}:\d{2}/).first(),
  ).toBeVisible();
});

test("aprovar encaixe da IA", async ({ page }) => {
  await abrirAgenda(page, dados().emails.recepcao);

  const painel = page.getByRole("complementary", { name: "Pendente de você" });
  const cartao = painel.getByText("Juliana Dermato");
  await expect(cartao).toBeVisible();
  await expect(painel.getByText("Encaixe da IA")).toBeVisible();

  await painel.getByRole("button", { name: "Aprovar" }).click();

  // O cartao some do painel, mas a consulta continua na grade das 10:00
  // (bloco tracejado de encaixe).
  await expect(cartao).toBeHidden();
  await expect(painel.getByText("Nada pendente de você")).toBeVisible();
  await expect(bloco(page, /Juliana Dermato, 10:00/)).toBeVisible();
});

test("tempo real em outra sessão", async ({ browser }) => {
  const contextoA = await browser.newContext();
  const contextoB = await browser.newContext();
  const pageA = await contextoA.newPage();
  const pageB = await contextoB.newPage();

  await abrirAgenda(pageA, dados().emails.recepcao);
  await abrirAgenda(pageB, dados().emails.gestor);

  const camilaConfirmada = /Camila Áudio, 09:00, Confirmado por WhatsApp/;
  await expect(bloco(pageB, camilaConfirmada)).toBeVisible();

  // Sessao A muda o status da consulta confirmada
  // (dados().agenda.consultaConfirmadaWhatsId, Camila 09:00).
  await bloco(pageA, camilaConfirmada).click();
  await pageA.getByRole("menuitem", { name: "Na recepção" }).click();
  await expect(bloco(pageA, /Camila Áudio, 09:00, Na recepção/)).toBeVisible({
    timeout: 10_000,
  });

  // Sessao B reflete sem nenhuma acao, no padrao do takeover.
  await expect(bloco(pageB, /Camila Áudio, 09:00, Na recepção/)).toBeVisible({
    timeout: 10_000,
  });

  await contextoA.close();
  await contextoB.close();
});
