import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Aceites da Fase 2 sobre a Agenda (Tela 3): filtros na ordem do brief
// (especialidade e convenio antes do profissional), estado vazio por filtro
// com limpeza, grade do dia com consulta, bloqueio hachurado, hold da IA e
// painel de pendencias, agendamento completo em menos de 20 segundos e o
// conflito de horario respondido de forma amigavel pela exclusion constraint.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxos completos rodam no viewport de referencia",
  );
});

async function abrirAgenda(page: Page): Promise<void> {
  await login(page, dados().emails.recepcao);
  await page.goto("/agenda");
  // Colunas carregadas: os dois profissionais do catalogo E2E.
  await expect(page.getByText("Dr. João Pereira")).toBeVisible();
  await expect(page.getByText("Dra. Ana Costa")).toBeVisible();
}

async function filtrar(
  page: Page,
  filtro: string,
  opcao: string,
): Promise<void> {
  await page.getByRole("combobox", { name: filtro }).click();
  await page.getByRole("option", { name: opcao }).click();
}

test("quem está livre para dermato pela Unimed, sem tocar no filtro de profissional", async ({
  page,
}) => {
  await abrirAgenda(page);
  await filtrar(page, "Especialidade", "Dermatologia");
  await filtrar(page, "Convênio", "Unimed");
  await expect(page.getByText("Dra. Ana Costa")).toBeVisible();
  await expect(page.getByText("Dr. João Pereira")).not.toBeVisible();
});

test("vazio por filtro com limpar", async ({ page }) => {
  await abrirAgenda(page);
  // Combinacao impossivel: endocrinologista que faca consulta de dermato.
  await filtrar(page, "Especialidade", "Endocrinologia");
  await filtrar(page, "Procedimento", "Consulta dermatologia");
  await expect(
    page.getByText("Nenhum profissional com esses filtros"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByText("Dr. João Pereira")).toBeVisible();
  await expect(page.getByText("Dra. Ana Costa")).toBeVisible();
});

test("a grade do dia mostra consulta, bloqueio, hold e o painel de pendências", async ({
  page,
}) => {
  await abrirAgenda(page);
  // Consulta das 08:00 do Joao.
  await expect(page.getByText("Roberto Recibo")).toBeVisible();
  // Bloqueio hachurado com rotulo em texto, nunca so cor.
  await expect(page.getByText("Almoço estendido")).toBeVisible();
  // Hold da IA (expira sozinho em alguns minutos, este spec roda primeiro).
  await expect(page.getByText(/Reservado pela IA/)).toBeVisible();
  // Painel lateral com o encaixe pendente e as duas acoes.
  const painel = page.getByRole("complementary", { name: "Pendente de você" });
  await expect(
    painel.getByRole("heading", { name: "Pendente de você" }),
  ).toBeVisible();
  await expect(painel.getByText("Juliana Dermato")).toBeVisible();
  await expect(painel.getByRole("button", { name: "Aprovar" })).toBeVisible();
  await expect(painel.getByRole("button", { name: "Recusar" })).toBeVisible();
});

/** Preenche o modal ate a selecao de horario e devolve o dialog. */
async function preencherModal(page: Page) {
  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const modal = page.getByRole("dialog", { name: "Nova consulta" });
  await modal.getByLabel("Paciente").fill("Roberto");
  await modal.getByRole("button", { name: /Roberto Recibo/ }).click();
  await modal.getByRole("combobox", { name: "Convênio" }).click();
  await page.getByRole("option", { name: "Particular" }).click();
  await modal.getByRole("combobox", { name: "Procedimento" }).click();
  await page.getByRole("option", { name: "Consulta endocrinologia" }).click();
  await modal.getByRole("combobox", { name: "Profissional" }).click();
  await page.getByRole("option", { name: /Dr\. João Pereira/ }).click();
  return modal;
}

test("agendar em menos de 20 segundos", async ({ page }) => {
  await abrirAgenda(page);

  const inicio = Date.now();
  const modal = await preencherModal(page);
  // O primeiro dos 3 botoes grandes de horario livre.
  await modal
    .getByRole("button", { name: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  await modal.getByRole("button", { name: "Marcar consulta" }).click();
  await expect(page.getByText(/Consulta marcada para/)).toBeVisible();
  const total = Date.now() - inicio;

  expect(total).toBeLessThan(20000);
  await expect(modal).not.toBeVisible();
  // O bloco novo aparece na grade: Roberto agora tem a consulta das 08:00 e a nova.
  await expect(page.getByText("Roberto Recibo")).toHaveCount(2);
});

test("conflito de horário responde de forma amigável", async ({ page }) => {
  // Caminho mais robusto para provocar o 23P01 real da exclusion constraint:
  // nao da para clicar num horario ja ocupado (a UI so oferece horarios
  // livres), entao selecionamos um horario livre no modal e, ANTES de salvar,
  // ocupamos exatamente esse horario direto no banco com o service role.
  // O clique em "Marcar consulta" cai no conflito de verdade e o modal deve
  // responder com a mensagem amigavel e as saidas de recuperacao.
  const d = dados();
  await abrirAgenda(page);
  const modal = await preencherModal(page);

  const botaoSlot = modal
    .getByRole("button", { name: /^\d{2}:\d{2}$/ })
    .first();
  const horario = (await botaoSlot.innerText()).trim();
  await botaoSlot.click();

  const admin = adminClient();
  const { data: vinculo } = await admin
    .from("service_link")
    .select("id")
    .eq("clinic_id", d.clinicId)
    .eq("professional_id", d.agenda.profJoaoId)
    .is("insurance_id", null)
    .eq("price_cents", 40000)
    .single()
    .throwOnError();
  const inicioConflito = new Date(`${d.agenda.diaISO}T${horario}:00-03:00`);
  const fimConflito = new Date(inicioConflito.getTime() + 40 * 60_000);
  const { data: intruso } = await admin
    .from("appointment")
    .insert({
      clinic_id: d.clinicId,
      contact_id: d.contatos.comBloqueio,
      professional_id: d.agenda.profJoaoId,
      service_link_id: vinculo!.id,
      starts_at: inicioConflito.toISOString(),
      ends_at: fimConflito.toISOString(),
      status: "agendado",
      is_overbooking: false,
      created_by: "usuario",
    })
    .select("id")
    .single()
    .throwOnError();

  await modal.getByRole("button", { name: "Marcar consulta" }).click();
  await expect(
    page.getByText(/Este horário acabou de ser ocupado/),
  ).toBeVisible();
  // Nada quebra: o modal segue aberto com as saidas de recuperacao.
  await expect(
    modal.getByRole("button", { name: "Usar o próximo horário livre" }),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Marcar como encaixe" }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Cancelar" }).click();

  // Higiene: remove a consulta intrusa para nao poluir os specs seguintes.
  await admin.from("appointment").delete().eq("id", intruso!.id);
});
