import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Pacote com varios procedimentos (pedido do dono em 29/09/2026), de ponta a
// ponta pela tela: o gestor cria "Botox 2 sessoes + Facelift 1 sessao" com
// preco menor que o avulso e ve o desconto; a recepcao vende o pacote a um
// paciente na ficha; o Compareceu de uma consulta de Botox na Agenda desconta
// 1 sessao do BOTOX (e so dele), e a ficha mostra o saldo do Botox caindo.
//
// Os testes deste arquivo MUTAM dados em cadeia (modo serial, ordem do
// arquivo) e rodam so no desktop-1600. O que eles criam (procedimentos,
// vinculo, paciente, consulta e pacote) tem prefixo proprio e sai do banco
// no fim, e tambem antes de comecar, caso uma execucao anterior tenha
// morrido no meio.

test.describe.configure({ mode: "serial" });

const PREFIXO = "E2E Pacote";
const PACIENTE = "Bruna Pacote";
// Faixa de telefone so deste arquivo: o paciente e achado e apagado por ela.
const FONE_DO_PACIENTE = "+5584970009901";
// Horario livre da Dra. Ana no dia do teste (o seed usa 09:00 a 11:30).
const INICIO = "21:00";
const FIM = "21:30";

const sufixo = Date.now().toString(36);
const BOTOX = `Botox ${PREFIXO} ${sufixo}`;
const FACELIFT = `Facelift ${PREFIXO} ${sufixo}`;
const PACOTE = `Harmonização ${PREFIXO} ${sufixo}`;

let pacienteId = "";

const PROJETO_QUE_RODA = "desktop-1600";

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bloco da ficha pelo titulo: section com o h2 do BlocoFicha. */
function bloco(page: Page, titulo: string) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: titulo, exact: true }),
  });
}

// Apaga tudo o que este arquivo cria, na ordem das chaves: a consulta antes
// (appointment.contact_id e service_link_id nao tem cascata), o paciente
// (leva as vendas, os itens do saldo e a trilha de ajuste), o pacote (leva os
// itens), o vinculo e os procedimentos.
async function limparOQueEsteArquivoCria(): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const { data: pacientes } = await admin
    .from("contact")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("phone_e164", FONE_DO_PACIENTE);
  const idsDosPacientes = (pacientes ?? []).map((p) => p.id as string);
  if (idsDosPacientes.length > 0) {
    await admin.from("appointment").delete().in("contact_id", idsDosPacientes);
    await admin.from("contact").delete().in("id", idsDosPacientes);
  }
  await admin
    .from("package")
    .delete()
    .eq("clinic_id", clinicId)
    .like("name", `%${PREFIXO}%`);
  const { data: procedimentos } = await admin
    .from("procedure")
    .select("id")
    .eq("clinic_id", clinicId)
    .like("name", `%${PREFIXO}%`);
  const idsDosProcedimentos = (procedimentos ?? []).map((p) => p.id as string);
  if (idsDosProcedimentos.length > 0) {
    await admin
      .from("service_link")
      .delete()
      .in("procedure_id", idsDosProcedimentos);
    await admin.from("procedure").delete().in("id", idsDosProcedimentos);
  }
}

// Os ganchos recebem o testInfo pelo segundo argumento (o primeiro tem de
// ser a desestruturacao das fixtures, mesmo vazia).
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== PROJETO_QUE_RODA) {
    return;
  }
  await limparOQueEsteArquivoCria();
  const d = dados();
  const admin = adminClient();

  // Preco base: Botox R$ 1.000,00 e Facelift R$ 5.000,00. Avulso do pacote
  // (2 Botox + 1 Facelift) = R$ 7.000,00.
  const { data: procedimentos } = await admin
    .from("procedure")
    .insert([
      {
        clinic_id: d.clinicId,
        name: BOTOX,
        default_duration_min: 30,
        base_price_cents: 100000,
      },
      {
        clinic_id: d.clinicId,
        name: FACELIFT,
        default_duration_min: 60,
        base_price_cents: 500000,
      },
    ])
    .select("id, name")
    .throwOnError();
  const botoxId = procedimentos!.find((p) => p.name === BOTOX)!.id as string;

  const { data: vinculo } = await admin
    .from("service_link")
    .insert({
      clinic_id: d.clinicId,
      professional_id: d.agenda.profAnaId,
      procedure_id: botoxId,
      insurance_id: null,
      price_cents: 100000,
      covered_by_insurance: false,
      duration_min: 30,
    })
    .select("id")
    .single()
    .throwOnError();

  const { data: paciente } = await admin
    .from("contact")
    .insert({
      clinic_id: d.clinicId,
      phone_e164: FONE_DO_PACIENTE,
      name: PACIENTE,
      kind: "paciente",
      funnel_stage: "compareceu",
      no_show_count: 0,
    })
    .select("id")
    .single()
    .throwOnError();
  pacienteId = paciente!.id as string;

  // Consulta de Botox HOJE: o Compareceu so vale a partir do dia da
  // consulta. Direto no banco, com status agendado (o debito e gatilho do
  // UPDATE para compareceu, entao semear nao desconta nada).
  await admin
    .from("appointment")
    .insert({
      clinic_id: d.clinicId,
      contact_id: pacienteId,
      professional_id: d.agenda.profAnaId,
      service_link_id: vinculo!.id,
      starts_at: `${d.agenda.diaISO}T${INICIO}:00-03:00`,
      ends_at: `${d.agenda.diaISO}T${FIM}:00-03:00`,
      status: "agendado",
      confirmation_channel: null,
      is_overbooking: false,
      created_by: "usuario",
      approval_status: null,
    })
    .throwOnError();
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== PROJETO_QUE_RODA) {
    return;
  }
  await limparOQueEsteArquivoCria();
});

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== PROJETO_QUE_RODA,
    "fluxo mutavel em cadeia, roda uma vez so",
  );
});

test("o gestor cria o pacote Botox 2 + Facelift 1 e vê o desconto sobre o avulso", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=pacotes");

  await page.getByRole("button", { name: "Novo pacote" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Novo pacote" }),
  ).toBeVisible();

  await dialogo.getByLabel("Nome do pacote").fill(PACOTE);

  const adicionar = dialogo.getByRole("combobox", {
    name: "Adicionar procedimento",
  });
  await adicionar.click();
  await page.getByRole("option", { name: BOTOX, exact: true }).click();
  await dialogo.getByLabel(`Sessões de ${BOTOX}`).fill("2");
  await adicionar.click();
  await page.getByRole("option", { name: FACELIFT, exact: true }).click();
  // O Facelift entra com 1 sessao.
  await expect(dialogo.getByLabel(`Sessões de ${FACELIFT}`)).toHaveValue("1");

  // O mesmo procedimento entra uma vez so: o Botox saiu das opcoes.
  await adicionar.click();
  await expect(
    page.getByRole("option", { name: BOTOX, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Preco avulso calculado: 2 x R$ 1.000,00 + 1 x R$ 5.000,00.
  await expect(
    dialogo.getByRole("status", { name: "Preço avulso" }),
  ).toContainText(/R\$\s?7\.000,00/u);

  // Preco do pacote menor que o avulso: o desconto aparece.
  await dialogo.getByLabel("Preço do pacote (R$)").fill("6.000,00");
  await expect(dialogo.getByText("14,3% de desconto")).toBeVisible();

  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialogo).toBeHidden();

  const linha = page.getByRole("row").filter({ hasText: PACOTE });
  await expect(linha).toContainText(`${BOTOX} 2x + ${FACELIFT} 1x`);
  await expect(linha).toContainText(/R\$\s?7\.000,00/u);
  await expect(linha).toContainText(/R\$\s?6\.000,00/u);
  await expect(linha).toContainText("14,3% de desconto");
});

test("a recepção vende o pacote na ficha, com um saldo por procedimento", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto(`/pacientes/${pacienteId}`);

  const saldo = bloco(page, "Saldo de pacote");
  await expect(saldo).toContainText(
    "Nenhum pacote vendido para este paciente.",
  );
  await saldo.getByRole("button", { name: "Vender pacote" }).click();

  const venda = page.getByRole("dialog", { name: "Vender pacote" });
  await venda.getByRole("combobox", { name: "Pacote", exact: true }).click();
  // A opcao traz o nome e o que o pacote inclui.
  await page
    .getByRole("option", {
      name: new RegExp(
        `^${escapar(PACOTE)} \\(${escapar(`${BOTOX} 2x + ${FACELIFT} 1x`)}\\)$`,
      ),
    })
    .click();
  const itens = venda.getByRole("list", { name: `Procedimentos de ${PACOTE}` });
  await expect(itens.getByRole("listitem")).toHaveCount(2);
  await expect(itens).toContainText(BOTOX);
  await expect(itens).toContainText(FACELIFT);

  await venda.getByRole("button", { name: "Registrar venda" }).click();
  await expect(page.getByText("Pacote registrado")).toBeVisible({
    timeout: 20_000,
  });

  // Um cartao para a venda, uma barra para cada procedimento.
  await expect(saldo.getByRole("heading", { name: PACOTE })).toBeVisible();
  await expect(saldo).toContainText("3 sessões restantes");
  await expect(
    saldo.getByRole("img", { name: `${BOTOX}: 0 de 2 sessões usadas` }),
  ).toBeVisible();
  await expect(
    saldo.getByRole("img", { name: `${FACELIFT}: 0 de 1 sessão usada` }),
  ).toBeVisible();
});

test("o Compareceu de Botox desconta 1 sessão do Botox, e só dele", async ({
  page,
}) => {
  // Gestor: pode cancelar venda, entao o Cancelar desabilitado no fim prova
  // a trava da venda que ja descontou, nao a falta de permissao.
  await login(page, dados().emails.gestor);
  await page.goto("/agenda");
  await expect(
    page.getByRole("complementary", { name: "Pendente de você" }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: new RegExp(`${escapar(PACIENTE)}, ${INICIO}, Agendado`),
    })
    .click();
  await page.getByRole("menuitem", { name: "Compareceu" }).click();

  // O dialogo nomeia o procedimento e o pacote, com o saldo depois de marcar.
  const confirmar = page.getByRole("dialog", {
    name: `Confirmar que ${PACIENTE} compareceu?`,
  });
  await expect(confirmar).toContainText(
    `Desconta 1 sessão de ${BOTOX} do pacote ${PACOTE} (1 de 2 usadas).`,
  );
  await expect(confirmar).toContainText(
    `Depois de marcar, sobra 1 sessão de ${BOTOX} neste pacote.`,
  );
  await confirmar
    .getByRole("button", { name: "Confirmar comparecimento" })
    .click();
  // A troca de rotulo passa por action + refetch: orcamento maior que o
  // padrao de 5s para nao falhar sob carga.
  await expect(
    page.getByRole("button", {
      name: new RegExp(`${escapar(PACIENTE)}, ${INICIO}, Compareceu`),
    }),
  ).toBeVisible({ timeout: 10_000 });

  // Na ficha, o Botox caiu e o Facelift ficou como estava.
  await page.goto(`/pacientes/${pacienteId}`);
  const saldo = bloco(page, "Saldo de pacote");
  await expect(
    saldo.getByRole("img", { name: `${BOTOX}: 1 de 2 sessões usadas` }),
  ).toBeVisible();
  await expect(
    saldo.getByRole("img", { name: `${FACELIFT}: 0 de 1 sessão usada` }),
  ).toBeVisible();
  await expect(saldo).toContainText("2 sessões restantes");

  // A venda ja descontou: nao se cancela, so se ajusta (visivel, com dica).
  await expect(
    saldo.getByRole("button", { name: "Cancelar venda" }),
  ).toBeDisabled();
  await expect(
    saldo.getByRole("button", { name: "Ajustar saldo" }),
  ).toBeEnabled();
});

test("pacote vendido: os procedimentos ficam travados, com a dica", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/cadastros?aba=pacotes");

  await page
    .getByRole("button", { name: `Editar pacote ${PACOTE}`, exact: true })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Editar pacote" }),
  ).toBeVisible();
  await expect(
    dialogo.getByText(
      "Pacote já vendido: os procedimentos e as sessões não mudam; crie um pacote novo.",
    ),
  ).toBeVisible();
  await expect(dialogo.getByLabel(`Sessões de ${BOTOX}`)).toBeDisabled();
  await expect(
    dialogo.getByRole("button", { name: `Remover ${BOTOX} do pacote` }),
  ).toBeDisabled();
  // O nome continua editavel.
  await expect(dialogo.getByLabel("Nome do pacote")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
});
