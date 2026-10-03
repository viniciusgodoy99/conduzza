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
// Convenio pelo profissional (decisao do dono em 02/10/2026): acima de "Quem
// faz" fica "Convênios que cobrem este procedimento", e cada profissional so
// mostra os convenios que cobrem E que ele atende no cadastro dele, ja
// marcados ao entrar; desmarcar no cartao dele e a excecao deste
// procedimento. A fixture grava os pares coerentes com os vinculos (Joao e
// Ana atendem Unimed; Endocrinologia e Dermatologia cobertas pela Unimed).
// Tirar uma combinacao com consulta marcada pede confirmacao ANTES de
// gravar (D4).

const PREFIXO_DO_PROCEDIMENTO = "Retorno endócrino E2E";
const COBREM = "Convênios que cobrem este procedimento";
const FORA_DO_CADASTRO = "Fora do cadastro do profissional";
const NOTA_DA_CURA = "Marcado porque já está em uso em Quem faz e convênios.";

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

function cobremDe(dialogo: Locator): Locator {
  return dialogo.getByRole("group", { name: COBREM, exact: true });
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

  // A Unimed cobre a consulta; o Bradesco nao. Os pares da fixture batem com
  // os vinculos: nada vem marcado so pela auto cura.
  const cobrem = cobremDe(dialogo);
  await expect(
    cobrem.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toBeChecked();
  await expect(
    cobrem.getByRole("checkbox", { name: "Bradesco Saúde", exact: true }),
  ).not.toBeChecked();
  await expect(dialogo.getByText(NOTA_DA_CURA)).toHaveCount(0);

  const joao = cartaoDe(dialogo, "Dr. João Pereira");
  await expect(joao).toBeVisible();

  // Ele atende a Unimed e ela cobre: marcada. O Bradesco nao cobre este
  // procedimento: nem aparece para marcar.
  await expect(
    joao.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toBeChecked();
  await expect(
    joao.getByRole("checkbox", { name: "Bradesco Saúde", exact: true }),
  ).toHaveCount(0);
  await expect(joao.getByText(FORA_DO_CADASTRO)).toHaveCount(0);

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

  // Dr. Joao entra pelo Particular. Nenhum convenio cobre ainda: so
  // Particular para ele.
  await dialogo.getByRole("combobox", { name: "Adicionar quem faz" }).click();
  await page.getByRole("option", { name: "Dr. João Pereira" }).click();
  const joao = cartaoDe(dialogo, "Dr. João Pereira");
  await expect(
    joao.getByRole("checkbox", { name: "Particular", exact: true }),
  ).toBeChecked();
  await expect(
    dialogo.getByText(
      "Nenhum convênio marcado: este procedimento é só Particular.",
    ),
  ).toBeVisible();
  await expect(
    joao.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toHaveCount(0);

  // A Unimed passa a cobrir: ele a atende no cadastro dele, entao ela entra
  // ja marcada, Coberto pelo padrao. O Bradesco continua fora.
  const cobrem = cobremDe(dialogo);
  await cobrem.getByRole("checkbox", { name: "Unimed", exact: true }).click();
  await expect(
    joao.getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toBeChecked();
  await expect(linhaDoConvenio(joao, "Unimed")).toContainText("Coberto");
  await expect(linhaDoConvenio(joao, "Particular")).toContainText(
    /R\$\s?300,00/u,
  );
  await expect(
    joao.getByRole("checkbox", { name: "Bradesco Saúde", exact: true }),
  ).toHaveCount(0);

  // Dra. Ana tambem atende a Unimed e entra com ela marcada. Aqui ela so
  // faz Particular: desmarcar no cartao dela e a excecao deste
  // procedimento. Particular com preco e duracao proprios.
  await dialogo.getByRole("combobox", { name: "Adicionar quem faz" }).click();
  await page.getByRole("option", { name: "Dra. Ana Costa" }).click();
  const ana = cartaoDe(dialogo, "Dra. Ana Costa");
  const unimedDaAna = ana.getByRole("checkbox", {
    name: "Unimed",
    exact: true,
  });
  await expect(unimedDaAna).toBeChecked();
  await unimedDaAna.click();
  await expect(unimedDaAna).not.toBeChecked();
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

  // Reaberto, o modal mostra o que foi gravado: a Unimed cobre, o Joao
  // atende por ela e a excecao da Ana continua (a caixa existe, desmarcada).
  const reaberto = await abrirProcedimento(page, nome);
  await expect(
    cobremDe(reaberto).getByRole("checkbox", { name: "Unimed", exact: true }),
  ).toBeChecked();
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

  // Tirar a Unimed de "cobrem" com essa consulta marcada: o aviso vem ANTES
  // de gravar (D4) e nada muda ate a confirmacao.
  await page.goto("/cadastros?aba=procedimentos");
  const semUnimed = await abrirProcedimento(page, nome);
  await cobremDe(semUnimed)
    .getByRole("checkbox", { name: "Unimed", exact: true })
    .click();
  await expect(
    semUnimed.getByText(
      "Ao tirar Unimed, Dr. João Pereira deixa de atender por este convênio neste procedimento.",
    ),
  ).toBeVisible();
  // Pelo teclado: o Salvar sai com o foco quando o aviso entra.
  await semUnimed.getByRole("button", { name: "Salvar", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(semUnimed.getByText(/Há 1 consulta marcada/u)).toBeVisible();
  await expect(semUnimed.getByText(/não desmarca nada/u)).toBeVisible();
  // O rodape fica so com Cancelar; quem confirma e o aviso.
  await expect(
    semUnimed.getByRole("button", { name: "Salvar", exact: true }),
  ).toHaveCount(0);
  // O foco vai para o aviso (nao para o topo do modal): o proximo Tab cai em
  // "Abrir a Agenda" e o seguinte na confirmacao.
  await expect(semUnimed.locator("#proc-aviso-de-consultas")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    semUnimed.getByRole("link", { name: "Abrir a Agenda" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const salvarMesmoAssim = semUnimed.getByRole("button", {
    name: "Salvar mesmo assim",
  });
  await expect(salvarMesmoAssim).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(semUnimed).toBeHidden();
  await expect(
    page.getByText("1 combinação de quem faz e convênio saiu da agenda."),
  ).toBeVisible();
  // A Unimed saiu da agenda deste procedimento (a consulta continua).
  await expect(
    page.getByRole("row").filter({ hasText: nome }),
  ).not.toContainText("Unimed");
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
  // O que cobre aparece em texto, sem caixa de marcar.
  await expect(dialogo.getByText(COBREM)).toBeVisible();
  await expect(dialogo.getByText("Unimed", { exact: true })).toBeVisible();
  await expect(dialogo.getByRole("checkbox")).toHaveCount(0);
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
