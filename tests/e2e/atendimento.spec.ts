import { expect, test } from "@playwright/test";

import { dados } from "./dados";
import { login } from "./helpers";

// Aceite da tarefa 1.5 sobre o seed: lista com segmentos e chips, fio com
// selo de IA, nota interna, cartao de bloqueio de conformidade com o rascunho
// auditavel, e a faixa vermelha de desconectado. Leitura pura, nao muta nada.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "conteudo identico em todos os viewports",
  );
});

test("lista com segmentos de posse e chips de status contados", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await expect(page.getByRole("button", { name: /Todas 4/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /IA atendendo 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Aguardando você 1/ }),
  ).toBeVisible();
});

test("cartão mostra a última mensagem que o paciente vê, nunca a nota interna", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  const lista = page.getByRole("complementary", { name: "Conversas" });
  const cartao = (nome: string) =>
    lista.getByRole("button", { name: new RegExp(nome) });
  // Roberto: a última linha é uma nota interna; a prévia fica na mensagem
  // anterior do paciente, sem prefixo de autoria (quem falou foi ele).
  await expect(
    cartao("Roberto Recibo").getByText("Preciso do recibo da consulta"),
  ).toBeVisible();
  await expect(lista.getByText(/CNPJ novo/)).toHaveCount(0);
  await expect(
    cartao("Roberto Recibo").getByText(/^(Você|Clínica|IA):$/),
  ).toHaveCount(0);
  // Camila mandou áudio: a prévia diz o tipo em texto, sem a transcrição.
  // A asserção positiva prova que a prévia existe (sem ela, só o "sem
  // transcrição" passaria com o cartão vazio).
  await expect(
    cartao("Camila Áudio").getByText("Áudio", { exact: true }),
  ).toBeVisible();
  await expect(lista.getByText(/viajar na quarta/)).toHaveCount(0);
});

test("prévia escrita pela clínica ou pela IA diz quem escreveu", async ({
  page,
}) => {
  // Juliana: a última mensagem é a resposta da IA. Sem o prefixo, o cartão
  // mostraria a fala da IA como se fosse da paciente.
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  const cartao = page
    .getByRole("complementary", { name: "Conversas" })
    .getByRole("button", { name: /Juliana Dermato/ });
  await expect(cartao.getByText("IA:", { exact: true })).toBeVisible();
  await expect(cartao.getByText(/Quer ver os próximos horários/)).toBeVisible();
  // A hora é a da última fala da PACIENTE (a que ordena a lista), e diz isso.
  await expect(cartao).toHaveAccessibleName(/Última mensagem do paciente/);
});

test("link ?conversa= abre a conversa já selecionada (Confirmações, ficha)", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto(`/atendimento?conversa=${dados().conversas.comNotaInterna}`);
  await expect(
    page
      .getByRole("region", { name: "Conversa aberta" })
      .getByText(/CNPJ novo/),
  ).toBeVisible();
  // O link é aplicado uma vez: a URL volta a ser só /atendimento.
  await expect(page).toHaveURL(/\/atendimento$/);
});

test("link do Início com ?filtro=aguardando chega com o chip marcado", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento?filtro=aguardando");
  await expect(
    page.getByRole("button", { name: /Aguardando você 1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const lista = page.getByRole("complementary", { name: "Conversas" });
  await expect(lista.getByText("Patrícia Sintoma")).toBeVisible();
  await expect(lista.getByText("Roberto Recibo")).toHaveCount(0);
});

test("bloqueio de conformidade aparece no fio com o rascunho auditável", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Patrícia Sintoma").click();
  await expect(
    page.getByText("Resposta da IA bloqueada pela conformidade"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver o que a IA ia responder" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rascunho bloqueado" }),
  ).toBeVisible();
  await expect(page.getByText(/pomada cicatrizante/)).toBeVisible();
});

test("bolha da IA carrega selo textual, nunca só cor", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Juliana Dermato").click();
  // No fio: o cartão da lista mostra a mesma frase como prévia.
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(fio.getByText("Atendemos sim!", { exact: false })).toBeVisible();
  // O selo preso à LINHA da mensagem da IA, com o texto exato "IA". Antes o
  // localizador subia até a raiz da página e casava "Juliana" ou o item
  // "Agente de IA" do menu: passava mesmo sem o selo na bolha.
  const linhaDaIa = fio.locator('[id^="mensagem-"]', {
    hasText: "Quer ver os próximos horários?",
  });
  await expect(linhaDaIa).toHaveCount(1);
  await expect(linhaDaIa.getByText("IA", { exact: true })).toBeVisible();
});

test("nota interna é âmbar e avisa que o paciente não vê", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Roberto Recibo").click();
  // Presa à linha da nota no fio: o aviso textual acompanha a própria nota.
  const linhaDaNota = page
    .getByRole("region", { name: "Conversa aberta" })
    .locator('[id^="mensagem-"]', { hasText: /CNPJ novo/ });
  await expect(linhaDaNota).toHaveCount(1);
  await expect(
    linhaDaNota.getByText("Nota interna, o paciente não vê", { exact: false }),
  ).toBeVisible();
});

test("as ações da conversa moram no cabeçalho do fio (decisão C29)", async ({
  page,
}) => {
  // Roberto Recibo está com a recepção no seed: Resolver e Transferir no
  // topo, e "Devolver para a IA" visível e desabilitado enquanto o agente de
  // IA não existe. Leitura pura: nenhum botão é clicado.
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Roberto Recibo").click();
  await expect(page.getByRole("button", { name: "Resolver" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Transferir" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Devolver para a IA" }),
  ).toBeDisabled();
  // O compositor ficou só com a escrita, e os dois planos se distinguem
  // pelo texto do botão.
  await expect(page.getByLabel("Resposta ao paciente")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
});

test("somente leitura vê Assumir e Transferir desabilitados, com o motivo", async ({
  page,
}) => {
  await login(page, dados().emails.leitura);
  await page.goto("/atendimento");
  await page.getByText("Patrícia Sintoma").click();
  const assumir = page.getByRole("button", { name: "Assumir conversa" });
  await expect(assumir).toBeDisabled();
  await expect(page.getByRole("button", { name: "Transferir" })).toBeDisabled();
  // O compositor diz o estado sem mandar assumir (o Assumir dela está
  // desabilitado): nada de "Assuma para responder" para quem só acompanha.
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(fio.getByText("Ninguém está atendendo.")).toBeVisible();
  await expect(fio.getByText(/Assuma para responder/)).toHaveCount(0);
  await expect(
    fio.getByText("Seu perfil acompanha o atendimento, sem responder."),
  ).toBeVisible();
  // O motivo também está na dica do botão desabilitado, com a mesma frase.
  await page.locator("span[tabindex='0']", { has: assumir }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Seu perfil acompanha o atendimento, sem responder.",
  );
});

test("áudio mostra a transcrição colapsada", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Camila Áudio").click();
  await expect(page.getByText("Transcrição:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "ver mais" }).click();
  await expect(page.getByText(/viajar na quarta/)).toBeVisible();
});

test("clínica com WhatsApp desconectado vê a faixa vermelha fixa", async ({
  page,
}) => {
  await login(page, dados().emails.offline);
  await expect(
    page.getByText("WhatsApp desconectado", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconectar" })).toBeVisible();
});
