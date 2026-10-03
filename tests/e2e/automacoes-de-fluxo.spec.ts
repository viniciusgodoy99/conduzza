import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Automacoes de fluxo (pedido do dono em 02/10/2026; migration
// 20261002130000): a aba de Configuracoes logo depois de "Jornada e
// conversoes". O que se prova pela tela:
//   - administrador cria uma regra pelo dialogo (campos conforme gatilho e
//     acao) e a linha mostra Quando e Faz em portugues, desligada;
//   - o ciclo com outra regra ligada e avisado ANTES de salvar (Salvar
//     desabilitado) e some ao salvar desligada;
//   - ligar pela lista pede confirmacao com a previa (nao e retroativa) e,
//     com ciclo, o botao Ligar fica desabilitado;
//   - excluir pergunta antes;
//   - o atalho leva para Automacoes > Follow-up.
//
// O spec cria as proprias regras (nome com sufixo) e limpa no fim. Nao muta
// o seed. Usa as etapas da jornada padrao da Clinica E2E (Em contato e
// Aguardando resposta).
//
// Os testes 2 e 3 usam a regra que o teste 1 cria pela tela: modo serial,
// para a repeticao (retries do playwright.config) refazer a cadeia inteira
// desde o teste 1. Fora dele, o teste que falha derruba o worker, o afterAll
// apaga as regras e o worker novo nasce com outro sufixo, sem a regra da
// tela (mesmo padrao de pacote-varios-procedimentos.spec.ts).
test.describe.configure({ mode: "serial" });

const suffix = Date.now().toString(36);
const NOME_DA_TELA = `Parado vira aguardando ${suffix}`;
const NOME_DA_VOLTA = `Volta para em contato ${suffix}`;

const admin = adminClient();

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "dialogo com varios seletores: um tamanho de tela basta",
  );
});

test.beforeAll(async () => {
  if (test.info().project.name !== "desktop-1600") {
    return;
  }
  // A regra de volta, LIGADA: Aguardando resposta -> Em contato por tempo.
  // Com ela, uma regra ligada Em contato -> Aguardando resposta fecha ciclo.
  await admin
    .from("automacao_fluxo")
    .insert({
      clinic_id: dados().clinicId,
      nome: NOME_DA_VOLTA,
      ativa: true,
      gatilho: "tempo_na_etapa",
      etapa: "aguardando_resposta",
      espera_minutos: 4320,
      acao: "mover_etapa",
      etapa_destino: "em_contato",
    })
    .throwOnError();
});

test.afterAll(async () => {
  await admin
    .from("automacao_fluxo")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .in("nome", [NOME_DA_TELA, NOME_DA_VOLTA]);
});

async function abrirAba(page: Page) {
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=fluxo");
  await expect(
    page.getByRole("tab", { name: /^Automações de fluxo/ }),
  ).toHaveAttribute("aria-selected", "true");
}

async function escolher(page: Page, rotulo: string, opcao: string) {
  await page.getByLabel(rotulo, { exact: true }).click();
  await page.getByRole("option", { name: opcao, exact: true }).click();
}

test("cria uma automação; o ciclo é avisado antes de salvar", async ({
  page,
}) => {
  await abrirAba(page);
  await expect(page.getByText(NOME_DA_VOLTA)).toBeVisible();
  await expect(
    page.getByText("Ficou 3 dias em Aguardando resposta"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Nova automação" }).click();
  const dialogo = page.getByRole("dialog", {
    name: "Nova automação de fluxo",
  });
  await expect(dialogo).toBeVisible();

  await dialogo.getByLabel("Nome da automação").fill(NOME_DA_TELA);
  await escolher(page, "O lead está na etapa", "Em contato");
  // Gatilho padrao: tempo na etapa, 3 dias.
  await expect(dialogo.getByLabel("Tempo na etapa")).toHaveValue("3");
  await escolher(page, "Para a etapa", "Aguardando resposta");

  // Agendou e Compareceu nunca aparecem como destino.
  await dialogo.getByLabel("Para a etapa", { exact: true }).click();
  await expect(page.getByRole("option", { name: "Agendou" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Compareceu" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A previa: nao e retroativa.
  await expect(dialogo.getByText("Não é retroativa")).toBeVisible();

  // Ligada fecharia ciclo com a regra de volta: avisa e nao deixa salvar.
  // No dialogo, "Ligada" e Checkbox (so vale depois do Salvar, docs/06 C31).
  const ligada = dialogo.getByRole("checkbox", { name: "Ligada" });
  await ligada.click();
  await expect(ligada).toBeChecked();
  await expect(
    dialogo.getByText("Fecha um ciclo com outra automação"),
  ).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Salvar" })).toBeDisabled();

  // Desligada, salva.
  await ligada.click();
  await expect(ligada).not.toBeChecked();
  await expect(
    dialogo.getByText("Fecha um ciclo com outra automação"),
  ).toHaveCount(0);
  await dialogo.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByText("Automação criada.")).toBeVisible();
  const linha = page.getByRole("listitem").filter({ hasText: NOME_DA_TELA });
  await expect(linha.getByText("Ficou 3 dias em Em contato")).toBeVisible();
  await expect(linha.getByText("Move para Aguardando resposta")).toBeVisible();
  await expect(linha.getByText("Desligada")).toBeVisible();
});

test("ligar pede confirmação com a prévia; com ciclo, não liga", async ({
  page,
}) => {
  await abrirAba(page);
  const interruptor = page.getByRole("switch", {
    name: `Ligar ${NOME_DA_TELA}`,
  });
  await interruptor.click();
  const confirmacao = page.getByRole("dialog", {
    name: `Ligar ${NOME_DA_TELA}?`,
  });
  await expect(confirmacao.getByText("Não é retroativa")).toBeVisible();
  await expect(
    confirmacao.getByText("Fecha um ciclo com outra automação"),
  ).toBeVisible();
  await expect(
    confirmacao.getByRole("button", { name: "Ligar" }),
  ).toBeDisabled();
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();

  // Desliga a de volta: agora liga.
  await page.getByRole("switch", { name: `Desligar ${NOME_DA_VOLTA}` }).click();
  await expect(page.getByText("Automação desligada.")).toBeVisible();
  await page.getByRole("switch", { name: `Ligar ${NOME_DA_TELA}` }).click();
  await page
    .getByRole("dialog", { name: `Ligar ${NOME_DA_TELA}?` })
    .getByRole("button", { name: "Ligar" })
    .click();
  await expect(page.getByText("Automação ligada.")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: `Desligar ${NOME_DA_TELA}` }),
  ).toBeChecked();
});

test("excluir pergunta antes; o atalho leva ao follow-up", async ({ page }) => {
  await abrirAba(page);
  await page.getByRole("button", { name: `Excluir ${NOME_DA_TELA}` }).click();
  const confirmacao = page.getByRole("dialog", {
    name: `Excluir ${NOME_DA_TELA}?`,
  });
  await expect(
    confirmacao.getByText("O histórico de execuções dela é apagado junto."),
  ).toBeVisible();
  await confirmacao.getByRole("button", { name: "Excluir automação" }).click();
  await expect(page.getByText("Automação excluída.")).toBeVisible();
  await expect(page.getByText(NOME_DA_TELA)).toHaveCount(0);

  await page.getByRole("link", { name: "Abrir o follow-up" }).click();
  await page.waitForURL(/\/automacoes\?aba=followup/);
});

test("gestor também gerencia; recepção nem chega à aba", async ({ page }) => {
  await login(page, dados().emails.gestor);
  await page.goto("/configuracoes?aba=fluxo");
  await expect(
    page.getByRole("button", { name: "Nova automação" }),
  ).toBeEnabled();

  await page.context().clearCookies();
  await login(page, dados().emails.recepcao);
  await page.goto("/configuracoes?aba=fluxo");
  await page.waitForURL(/\/inicio/);
});
