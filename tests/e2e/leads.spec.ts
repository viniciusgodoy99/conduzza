import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da Fase 4 sobre a Tela 4 (Leads): arrastar para Perdido exige
// motivo (e cancelar nao grava nada), o cartao do Kanban nunca mostra rotulo
// de campo vazio, alternar entre lista e kanban preserva o filtro na URL,
// papel leitura ve a tela com as acoes desabilitadas e com dica, e a
// autorizacao aparece em texto na lista (3 camadas, nunca so cor).

const NOME_COM_ORIGEM = "Otávio Origem";
const FONE_SEM_ORIGEM = "+5584970000022";

/** Coluna do Kanban pela etapa: section com aria-label "Etapa, N leads". */
function coluna(page: Page, etapa: string) {
  return page.locator(`section[aria-label^="${etapa},"]`);
}

test("arrastar para Perdido exige motivo, e cancelar devolve o cartão", async ({
  page,
}) => {
  // O arrasto persiste mudanca de etapa: roda uma vez so, no viewport de
  // referencia, como os fluxos mutaveis da agenda e de cadastros.
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo mutavel de arrasto roda uma vez, no desktop",
  );

  const d = dados();
  // Reset idempotente: retry do Playwright encontraria o lead ja em perdido.
  const admin = adminClient();
  await admin
    .from("contact")
    .update({ funnel_stage: "novo", lost_reason: null, lost_reason_note: null })
    .eq("id", d.leads.comOrigemId)
    .throwOnError();

  // As 6 colunas visiveis de uma vez: sem scroll horizontal o arrasto nao
  // depende do autoscroll do dnd-kit, que e fragil em teste.
  await page.setViewportSize({ width: 2000, height: 900 });
  await login(page, d.emails.gestor);
  await page.goto("/leads");

  const cartao = page.getByRole("button", { name: `Abrir ${NOME_COM_ORIGEM}` });
  await expect(cartao).toBeVisible();
  const colunaNovo = coluna(page, "Novo");
  const colunaPerdido = coluna(page, "Perdido");
  await expect(colunaPerdido).toBeVisible();
  const rotuloNovoAntes = await colunaNovo.getAttribute("aria-label");

  const dialogo = page.getByRole("dialog");
  const tituloDoModal = dialogo.getByRole("heading", {
    name: "Motivo da perda",
  });

  // PointerSensor com distancia de ativacao de 8px: desce no centro do
  // cartao, anda 12px para ativar o arrasto e so entao ruma ao destino.
  const arrastarParaPerdido = async () => {
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      const origem = await cartao.boundingBox();
      const destino = await colunaPerdido.boundingBox();
      expect(origem).not.toBeNull();
      expect(destino).not.toBeNull();
      const x0 = origem!.x + origem!.width / 2;
      const y0 = origem!.y + origem!.height / 2;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + 12, y0, { steps: 3 });
      await page.mouse.move(
        destino!.x + destino!.width / 2,
        destino!.y + Math.min(destino!.height / 2, 160),
        { steps: 12 },
      );
      await page.mouse.up();
      try {
        await tituloDoModal.waitFor({ state: "visible", timeout: 2_000 });
        return;
      } catch {
        // Solta fora da area de soltura: tenta o arrasto de novo.
      }
    }
    throw new Error("O arrasto não abriu o modal de motivo da perda");
  };

  await arrastarParaPerdido();

  // Sem motivo escolhido, confirmar fica desabilitado.
  await expect(
    dialogo.getByRole("button", { name: "Marcar como perdido" }),
  ).toBeDisabled();

  // Cancelar devolve o cartao: nada foi gravado e a contagem nao mudou.
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toBeHidden();
  await expect(colunaNovo).toContainText(NOME_COM_ORIGEM);
  await expect(colunaPerdido).not.toContainText(NOME_COM_ORIGEM);
  await expect(colunaNovo).toHaveAttribute("aria-label", rotuloNovoAntes!);

  // Repete o arrasto, escolhe o motivo e confirma: o cartao muda de coluna.
  await arrastarParaPerdido();
  await dialogo.getByRole("radio", { name: "Preço" }).check();
  await dialogo.getByRole("button", { name: "Marcar como perdido" }).click();
  await expect(dialogo).toBeHidden();
  await expect(colunaPerdido).toContainText(NOME_COM_ORIGEM);
  await expect(colunaNovo).not.toContainText(NOME_COM_ORIGEM);
});

test("cartão sem nome e sem origem mostra o telefone, nunca rótulo órfão", async ({
  page,
}) => {
  test.skip(
    test.info().project.name === "tablet-768",
    "abaixo de 1024px a tela forca a lista e o cartao do Kanban nao existe",
  );
  await login(page, dados().emails.gestor);
  await page.goto("/leads");

  const cartao = page.getByRole("button", { name: `Abrir ${FONE_SEM_ORIGEM}` });
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText(FONE_SEM_ORIGEM);
  // Campo vazio some por inteiro: sem "Origem", "Campanha" ou "Sem nome"
  // pendurados no cartao.
  await expect(cartao).not.toContainText("Origem");
  await expect(cartao).not.toContainText("Campanha");
  await expect(cartao).not.toContainText("Sem nome");
  await expect(cartao).not.toContainText("Responsável");
});

test("alternar da lista para o kanban preserva o filtro de etapa", async ({
  page,
}) => {
  test.skip(
    test.info().project.name === "tablet-768",
    "abaixo de 1024px a tela forca a lista e o alternador nao existe",
  );
  await login(page, dados().emails.gestor);
  await page.goto("/leads?visao=lista");

  await page.getByRole("combobox", { name: "Etapa" }).click();
  await page.getByRole("option", { name: "Em contato" }).click();
  await expect(page).toHaveURL(/etapa=em_contato/);
  await expect(
    page.getByRole("row").filter({ hasText: FONE_SEM_ORIGEM }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Larissa Perdida" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Kanban" }).click();
  await expect(page).toHaveURL(/visao=kanban/);
  await expect(page).toHaveURL(/etapa=em_contato/);
  // O filtro segue aplicado: so a etapa filtrada tem cartao.
  await expect(coluna(page, "Em contato")).toContainText(FONE_SEM_ORIGEM);
  await expect(coluna(page, "Perdido")).toContainText(
    "Nenhum lead nesta etapa",
  );
});

test("papel leitura vê a tela com Novo lead desabilitado e com dica", async ({
  page,
}) => {
  await login(page, dados().emails.leitura);
  await page.goto("/leads");

  await expect(
    page.getByRole("heading", { name: "Leads", exact: true }),
  ).toBeVisible();

  const novoLead = page.getByRole("button", { name: "Novo lead" });
  await expect(novoLead).toBeVisible();
  await expect(novoLead).toBeDisabled();

  // A dica explica o porque ao focar o involucro do botao desabilitado.
  await novoLead.locator("..").focus();
  await expect(
    page.getByText("Seu perfil não pode editar leads e pacientes"),
  ).toBeVisible();
});

test("a lista mostra a autorização em texto, nunca só cor", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/leads?visao=lista");

  const linhaSemAutorizacao = page
    .getByRole("row")
    .filter({ hasText: "Sandro Silêncio" });
  await expect(linhaSemAutorizacao).toContainText("Sem autorização");

  const linhaAutorizada = page
    .getByRole("row")
    .filter({ hasText: "Larissa Perdida" });
  await expect(linhaAutorizada).toContainText("Autorizado");
  await expect(linhaAutorizada).not.toContainText("Sem autorização");
});
