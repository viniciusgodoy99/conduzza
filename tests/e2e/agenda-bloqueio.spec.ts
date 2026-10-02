import { expect, test, type Locator, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// "Bloquear horário" na Agenda (decisão do dono de 29/09/2026: o bloqueio
// saiu de Cadastros e virou ação da Agenda). Aceites: criar pela barra da
// Agenda, ver a faixa hachurada com o motivo em texto, o horário sumir da
// oferta (contador "N de M horários" do cabeçalho da coluna), remover pela
// própria faixa com confirmação e o horário voltar. Também pelo clique no
// vão da grade: o modal da consulta nova oferece "Bloquear este horário",
// que abre o bloqueio já com o profissional da coluna e a hora clicada. Quem
// não grava bloqueio (recepção) vê as ações visíveis, desabilitadas e com o
// porquê. O bloqueio criado "mesmo assim" por cima de uma consulta fica
// coberto pelo bloco dela e sai pelo menu da consulta (revisão de 02/10).

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxos completos rodam no viewport de referência",
  );
});

/** Soma dias a um aaaa-mm-dd, sem fuso (aritmética de calendário). */
function somarDiasISO(diaISO: string, dias: number): string {
  const [ano, mes, dia] = diaISO.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return [
    data.getUTCFullYear(),
    String(data.getUTCMonth() + 1).padStart(2, "0"),
    String(data.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function lerLivres(contador: Locator): Promise<number> {
  const texto = await contador.innerText();
  const achado = /(\d+) de (\d+) horários/.exec(texto);
  if (!achado) {
    throw new Error("contador de horários não encontrado");
  }
  return Number(achado[1]);
}

/** Altura de uma hora na visão Dia (ALTURA_HORA_PX de day-grid.tsx). */
const ALTURA_HORA_PX = 96;

/**
 * Clica no vão da coluna da Ana na hora dada. A jornada E2E vai de 00:00 às
 * 23:59, então a grade começa em 00:00 e a hora H fica em H * 96px; os 4px a
 * mais caem dentro do mesmo quarto de hora (o clique arredonda para 15 min).
 */
async function clicarNoVaoDaAna(page: Page, hora: number): Promise<void> {
  await page
    .getByRole("button", { name: "Marcar horário com Dra. Ana Costa" })
    .click({ position: { x: 24, y: hora * ALTURA_HORA_PX + 4 } });
}

async function abrirDiaDaAna(page: Page, dia: string): Promise<void> {
  await page.goto("/agenda");
  await expect(page.getByText("Dra. Ana Costa")).toBeVisible();
  // Só a coluna da Ana: o contador e o bloqueio ficam sem ambiguidade.
  await page.getByRole("combobox", { name: "Profissional" }).click();
  await page.getByRole("option", { name: "Dra. Ana Costa" }).click();
  await page.getByRole("button", { name: /^\d{2}\/\d{2}\/\d{2}$/ }).click();
  await page.getByLabel("Escolher data").fill(dia);
  await page.keyboard.press("Escape");
  // A barra já mostra o dia escolhido (dd/mm/aa) antes de ler o contador.
  const [ano, mes, d] = dia.split("-") as [string, string, string];
  await expect(
    page.getByRole("button", { name: `${d}/${mes}/${ano.slice(2)}` }),
  ).toBeVisible();
}

test("bloquear horário pela Agenda, ver a faixa, o horário sai da oferta e volta ao remover", async ({
  page,
}) => {
  const d = dados();
  // Dois dias depois do dia provisionado: longe das consultas e do hold da
  // fixture. 03:00 às 04:00 cabe na jornada E2E (00:00 às 23:59) e não tem
  // consulta, então o teste mede o bloqueio e não o aviso de consultas.
  const alvo = somarDiasISO(d.agenda.diaISO, 2);
  const motivo = `Congresso E2E ${Date.now()}`;

  try {
    await login(page, d.emails.gestor);
    await abrirDiaDaAna(page, alvo);

    const contador = page.getByText(/\d+ de \d+ horários/);
    await expect(contador).toBeVisible();
    const livresAntes = await lerLivres(contador);

    await page.getByRole("button", { name: "Bloquear horário" }).click();
    const dialogo = page.getByRole("dialog", { name: "Bloquear horário" });
    await expect(dialogo).toBeVisible();
    // O profissional do filtro e o dia da grade já vêm preenchidos.
    await expect(
      dialogo
        .locator("label", { hasText: "Dra. Ana Costa" })
        .getByRole("checkbox"),
    ).toBeChecked();
    await expect(dialogo.getByLabel("Data de início")).toHaveValue(alvo);
    await expect(dialogo.getByLabel("Data de fim")).toHaveValue(alvo);

    await dialogo.getByLabel("Hora de início").fill("03:00");
    await dialogo.getByLabel("Hora de fim").fill("04:00");
    await dialogo.getByLabel("Motivo").fill(motivo);
    await dialogo.getByRole("button", { name: "Criar bloqueio" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Bloqueio criado")).toBeVisible();

    // A faixa hachurada aparece com o motivo em texto (nunca só cor).
    const faixa = page.getByRole("button", {
      name: `Bloqueio de Dra. Ana Costa: ${motivo}`,
    });
    await expect(faixa).toBeVisible();
    await expect(faixa).toContainText(motivo);

    // 03:00 e 03:30 saem da oferta (grade de 30 minutos do contador).
    await expect.poll(() => lerLivres(contador)).toBe(livresAntes - 2);

    // Detalhe do bloqueio e remoção com confirmação.
    await faixa.click();
    await expect(page.getByText("das 03:00 às 04:00")).toBeVisible();
    await expect(page.getByText("Impede encaixe")).toBeVisible();
    await page.getByRole("button", { name: "Remover bloqueio" }).click();
    const confirmacao = page.getByRole("dialog", { name: "Remover bloqueio" });
    await expect(confirmacao).toBeVisible();
    await confirmacao.getByRole("button", { name: "Remover" }).click();
    await expect(confirmacao).toBeHidden();
    await expect(page.getByText("Bloqueio removido")).toBeVisible();

    await expect(faixa).toHaveCount(0);
    await expect.poll(() => lerLivres(contador)).toBe(livresAntes);
  } finally {
    // Higiene: nada de bloqueio sobrando para os specs seguintes, mesmo se o
    // teste cair no meio.
    await adminClient()
      .from("professional_block")
      .delete()
      .eq("clinic_id", d.clinicId)
      .eq("reason", motivo);
  }
});

test("recepção vê bloquear e remover visíveis, desabilitados e com o porquê", async ({
  page,
}) => {
  const d = dados();
  await login(page, d.emails.recepcao);
  await page.goto("/agenda");
  await expect(page.getByText("Dr. João Pereira")).toBeVisible();

  const bloquear = page.getByRole("button", { name: "Bloquear horário" });
  await expect(bloquear).toBeVisible();
  await expect(bloquear).toBeDisabled();
  await bloquear.locator("..").focus();
  await expect(
    page.getByText("Somente administradores e gestores bloqueiam horários"),
  ).toBeVisible();

  // A faixa do bloqueio da fixture abre o detalhe para qualquer papel; o
  // remover fica desabilitado, com a dica escrita logo abaixo.
  await page
    .getByRole("button", {
      name: /Bloqueio de Dr\. João Pereira: Almoço estendido/,
    })
    .click();
  const remover = page.getByRole("button", { name: "Remover bloqueio" });
  await expect(remover).toBeVisible();
  await expect(remover).toBeDisabled();
  await expect(
    page.getByText("Somente administradores e gestores removem bloqueios"),
  ).toBeVisible();
});

test("bloquear este horário a partir do clique no vão da grade", async ({
  page,
}) => {
  const d = dados();
  // Três dias depois do dia provisionado: longe da fixture e do outro teste
  // de bloqueio. 03:00 cabe na jornada E2E e não tem consulta.
  const alvo = somarDiasISO(d.agenda.diaISO, 3);
  const motivo = `Imprevisto E2E ${Date.now()}`;

  try {
    await login(page, d.emails.gestor);
    await abrirDiaDaAna(page, alvo);

    // O clique no vão continua abrindo a consulta nova (caminho principal).
    await clicarNoVaoDaAna(page, 3);
    const modal = page.getByRole("dialog", { name: "Nova consulta" });
    await expect(modal).toBeVisible();

    // A ação secundária fecha a consulta nova e abre o bloqueio.
    await modal.getByRole("button", { name: "Bloquear este horário" }).click();
    await expect(modal).toBeHidden();
    const dialogo = page.getByRole("dialog", { name: "Bloquear horário" });
    await expect(dialogo).toBeVisible();

    // Profissional da coluna, dia e hora do clique já preenchidos; o fim
    // fica em branco para quem bloqueia escolher.
    await expect(
      dialogo
        .locator("label", { hasText: "Dra. Ana Costa" })
        .getByRole("checkbox"),
    ).toBeChecked();
    await expect(
      dialogo
        .locator("label", { hasText: "Dr. João Pereira" })
        .getByRole("checkbox"),
    ).not.toBeChecked();
    await expect(dialogo.getByLabel("Data de início")).toHaveValue(alvo);
    await expect(dialogo.getByLabel("Hora de início")).toHaveValue("03:00");
    await expect(dialogo.getByLabel("Hora de fim")).toHaveValue("");

    await dialogo.getByLabel("Hora de fim").fill("04:00");
    await dialogo.getByLabel("Motivo").fill(motivo);
    await dialogo.getByRole("button", { name: "Criar bloqueio" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Bloqueio criado")).toBeVisible();

    // A faixa nasce no horário clicado.
    const faixa = page.getByRole("button", {
      name: `Bloqueio de Dra. Ana Costa: ${motivo}`,
    });
    await expect(faixa).toBeVisible();
    await faixa.click();
    await expect(page.getByText("das 03:00 às 04:00")).toBeVisible();
  } finally {
    await adminClient()
      .from("professional_block")
      .delete()
      .eq("clinic_id", d.clinicId)
      .eq("reason", motivo);
  }
});

test("recepção vê o bloquear este horário do vão visível, desabilitado e com o porquê", async ({
  page,
}) => {
  const d = dados();
  await login(page, d.emails.recepcao);
  await abrirDiaDaAna(page, somarDiasISO(d.agenda.diaISO, 3));

  // A recepção agenda: o clique no vão abre a consulta nova normalmente.
  await clicarNoVaoDaAna(page, 3);
  const modal = page.getByRole("dialog", { name: "Nova consulta" });
  await expect(modal).toBeVisible();

  const bloquear = modal.getByRole("button", {
    name: "Bloquear este horário",
  });
  await expect(bloquear).toBeVisible();
  await expect(bloquear).toBeDisabled();
  await bloquear.locator("..").focus();
  await expect(
    page.getByText("Somente administradores e gestores bloqueiam horários"),
  ).toBeVisible();

  // Nada foi gravado: a consulta nova segue aberta até a pessoa cancelar.
  await modal.getByRole("button", { name: "Cancelar" }).click();
  await expect(modal).toBeHidden();
});

/** Escapa o texto para usar dentro de uma RegExp. */
function literal(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("bloqueio criado mesmo assim por cima de uma consulta sai pelo menu dela", async ({
  page,
}) => {
  // Revisão de 02/10/2026: o bloqueio que cabe dentro de uma consulta fica
  // todo por baixo do bloco dela e a faixa não dá mais clique. O menu da
  // consulta mostra o "Horário bloqueado" com o mesmo "Remover bloqueio".
  const d = dados();
  // Quatro dias depois do dia provisionado: longe da fixture e dos outros
  // testes de bloqueio (dois e três dias depois).
  const alvo = somarDiasISO(d.agenda.diaISO, 4);
  const motivo = `Reunião E2E ${Date.now()}`;
  const admin = adminClient();

  const { data: vinculo } = await admin
    .from("service_link")
    .select("id, duration_min")
    .eq("clinic_id", d.clinicId)
    .eq("professional_id", d.agenda.profAnaId)
    .eq("active", true)
    .limit(1)
    .single()
    .throwOnError();
  const { data: contato } = await admin
    .from("contact")
    .select("name")
    .eq("id", d.contatos.comBloqueio)
    .single()
    .throwOnError();
  const duracao = vinculo!.duration_min as number;
  const inicio = new Date(`${alvo}T03:00:00-03:00`);
  const fim = new Date(inicio.getTime() + duracao * 60_000);
  const minutosDoFim = 3 * 60 + duracao;
  const horaFim = `${String(Math.floor(minutosDoFim / 60)).padStart(2, "0")}:${String(minutosDoFim % 60).padStart(2, "0")}`;
  const { data: consulta } = await admin
    .from("appointment")
    .insert({
      clinic_id: d.clinicId,
      contact_id: d.contatos.comBloqueio,
      professional_id: d.agenda.profAnaId,
      service_link_id: vinculo!.id,
      starts_at: inicio.toISOString(),
      ends_at: fim.toISOString(),
      status: "agendado",
      is_overbooking: false,
      created_by: "usuario",
    })
    .select("id")
    .single()
    .throwOnError();

  try {
    await login(page, d.emails.gestor);
    await abrirDiaDaAna(page, alvo);

    // O bloqueio cobre exatamente o horário da consulta.
    await page.getByRole("button", { name: "Bloquear horário" }).click();
    const dialogo = page.getByRole("dialog", { name: "Bloquear horário" });
    await expect(dialogo).toBeVisible();
    await dialogo.getByLabel("Hora de início").fill("03:00");
    await dialogo.getByLabel("Hora de fim").fill(horaFim);
    await dialogo.getByLabel("Motivo").fill(motivo);
    await dialogo.getByRole("button", { name: "Criar bloqueio" }).click();
    // Há consulta no período: o aviso pede confirmação.
    const mesmoAssim = dialogo.getByRole("button", {
      name: "Criar o bloqueio mesmo assim",
    });
    await expect(mesmoAssim).toBeVisible();
    await mesmoAssim.click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Bloqueio criado")).toBeVisible();

    // O menu da consulta mostra o bloqueio e o remove com confirmação.
    const bloco = page.getByRole("button", {
      name: new RegExp(`^${literal(contato?.name ?? "Paciente")}, 03:00`),
    });
    await bloco.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Horário bloqueado")).toBeVisible();
    await expect(menu.getByText(motivo)).toBeVisible();
    await expect(menu.getByText("Impede encaixe")).toBeVisible();
    await menu.getByRole("menuitem", { name: "Remover bloqueio" }).click();
    const confirmacao = page.getByRole("dialog", { name: "Remover bloqueio" });
    await expect(confirmacao).toBeVisible();
    await confirmacao.getByRole("button", { name: "Remover" }).click();
    await expect(confirmacao).toBeHidden();
    await expect(page.getByText("Bloqueio removido")).toBeVisible();

    // Removido: nem faixa nem seção no menu da consulta.
    await expect(
      page.getByRole("button", {
        name: `Bloqueio de Dra. Ana Costa: ${motivo}`,
      }),
    ).toHaveCount(0);
    await bloco.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Remover bloqueio" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    await admin
      .from("professional_block")
      .delete()
      .eq("clinic_id", d.clinicId)
      .eq("reason", motivo);
    await admin.from("appointment").delete().eq("id", consulta!.id);
  }
});
