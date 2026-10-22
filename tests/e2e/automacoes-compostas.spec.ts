import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Automacoes de fluxo compostas (onda 4, itens 14 e 15; contrato, secao 6):
// o gestor cria pela tela uma automacao com varias acoes e uma condicao de
// etiqueta, e a ordem que a tela grava e a que o executor roda. O que se
// prova pela tela (o renderToStaticMarkup dos testes de unidade nao clica):
//   - "Adicionar ação" entra ANTES do mover (o mover e sempre o ultimo);
//   - Subir e Descer nunca passam do mover, e reordenam as outras;
//   - trocar o tipo de uma acao recem-criada mantem a ordem;
//   - "Mover para outra etapa" aparece indisponivel numa segunda acao;
//   - a condicao escrita no seletor (etiqueta livre, "Usar") vai como o
//     nome escrito;
//   - o que fica gravado (automacao_acao e automacao_condicao, lidos pelo
//     servico) e a ordem da tela, com o mover na ultima posicao; e a linha
//     da lista diz Quando, Se e Faz nessa ordem;
//   - editar: remover uma acao renumera as posicoes.
//
// ESCRITO NA ONDA 4 E AINDA NAO RODADO: depende das migrations
// 20261024100000 e 20261024110000 aplicadas (a RPC salvar_automacao_de_fluxo
// e as tabelas filhas) e do codigo da onda 4 no ar. A regra nasce
// DESLIGADA (o "Ligada" do dialogo fica desmarcado), entao nao disputa ciclo
// com automacoes-de-fluxo.spec.ts nem roda para lead nenhum. Usa as etapas
// da jornada padrao da Clinica E2E (Novo e Em contato). Limpa no fim.
test.describe.configure({ mode: "serial" });

const suffix = Date.now().toString(36);
const NOME = `Composta e2e ${suffix}`;
// Etiqueta livre (a do lead e texto livre; o filtro casa pelo nome).
const ETIQUETA = `Psiquiatria ${suffix}`;

const admin = adminClient();

type AcaoGravada = {
  posicao: number;
  acao: string;
  etapa_destino: string | null;
  atividade_titulo: string | null;
  atividade_prazo_dias: number | null;
  nota_texto: string | null;
};
type CondicaoGravada = { posicao: number; tipo: string; etiqueta: string };

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "dialogo com varios seletores: um tamanho de tela basta",
  );
});

test.afterAll(async () => {
  await admin
    .from("automacao_fluxo")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("nome", NOME);
});

async function abrirAba(page: Page) {
  await login(page, dados().emails.gestor);
  await page.goto("/automacoes?aba=fluxo");
  await expect(
    page.getByRole("tab", { name: /^Automações de fluxo/ }),
  ).toHaveAttribute("aria-selected", "true");
}

async function escolher(page: Page, rotulo: string, opcao: string) {
  await page.getByLabel(rotulo, { exact: true }).click();
  await page.getByRole("option", { name: opcao, exact: true }).click();
}

/** A regra gravada, com as filhas, lida pelo servico (sem sessao). */
async function gravada() {
  const { data } = await admin
    .from("automacao_fluxo")
    .select(
      "ativa, combinar, acoes:automacao_acao(posicao, acao, etapa_destino, atividade_titulo, atividade_prazo_dias, nota_texto), condicoes:automacao_condicao(posicao, tipo, etiqueta)",
    )
    .eq("clinic_id", dados().clinicId)
    .eq("nome", NOME)
    .single()
    .throwOnError();
  const regra = data as unknown as {
    ativa: boolean;
    combinar: string;
    acoes: AcaoGravada[];
    condicoes: CondicaoGravada[];
  };
  return {
    ...regra,
    acoes: [...regra.acoes].sort((a, b) => a.posicao - b.posicao),
    condicoes: [...regra.condicoes].sort((a, b) => a.posicao - b.posicao),
  };
}

test("gestor cria uma automação com três ações e uma condição; o mover fica por último", async ({
  page,
}) => {
  await abrirAba(page);
  await page.getByRole("button", { name: "Nova automação" }).click();
  const dialogo = page.getByRole("dialog", {
    name: "Nova automação de fluxo",
  });
  await expect(dialogo).toBeVisible();

  await dialogo.getByLabel("Nome da automação").fill(NOME);
  await escolher(page, "O lead está na etapa", "Novo");
  // A primeira acao nasce "Mover para outra etapa".
  await escolher(page, "Para a etapa", "Em contato");

  // O Se: uma condicao com a etiqueta escrita no seletor.
  await dialogo.getByRole("button", { name: "Adicionar condição" }).click();
  await dialogo
    .getByRole("button", { name: "Etiqueta da condição 1", exact: true })
    .click();
  await page.getByLabel("Buscar ou escrever uma etiqueta").fill(ETIQUETA);
  await page.getByRole("button", { name: "Usar", exact: true }).click();
  await expect(
    dialogo.getByRole("button", {
      name: `Etiqueta da condição 1: ${ETIQUETA}`,
    }),
  ).toBeVisible();

  // O Faz: "Adicionar ação" entra ANTES do mover. A acao 1 e a atividade
  // nova; o mover passou para a 2 e nao sobe; a 1 nao desce para depois dele.
  await dialogo.getByRole("button", { name: "Adicionar ação" }).click();
  await expect(dialogo.getByLabel("Ação 2", { exact: true })).toContainText(
    "Mover para outra etapa",
  );
  await dialogo.getByLabel("O que fazer").fill("Ligar para o lead");
  await dialogo.getByLabel("Vence em (dias)").fill("1");
  await expect(
    dialogo.getByRole("button", { name: "Descer a ação 1" }),
  ).toBeDisabled();
  await expect(
    dialogo.getByRole("button", { name: "Subir a ação 2" }),
  ).toBeDisabled();
  await expect(
    dialogo.getByText("Mover roda sempre por último, depois das outras ações"),
  ).toBeVisible();

  // A terceira tambem entra antes do mover; vira nota e sobe para o topo.
  await dialogo.getByRole("button", { name: "Adicionar ação" }).click();
  await expect(dialogo.getByLabel("Ação 3", { exact: true })).toContainText(
    "Mover para outra etapa",
  );
  // Um mover so: na acao 2 ele aparece indisponivel.
  await dialogo.getByLabel("Ação 2", { exact: true }).click();
  await expect(
    page.getByRole("option", {
      name: "Mover para outra etapa (a automação já move o lead)",
    }),
  ).toHaveAttribute("aria-disabled", "true");
  await page
    .getByRole("option", { name: "Deixar nota interna", exact: true })
    .click();
  await dialogo
    .getByLabel("Texto da nota")
    .fill("Lead parado. Ofereça um horário.");
  await dialogo.getByRole("button", { name: "Subir a ação 2" }).click();
  await expect(dialogo.getByLabel("Ação 1", { exact: true })).toContainText(
    "Deixar nota interna",
  );
  await expect(dialogo.getByLabel("Ação 2", { exact: true })).toContainText(
    "Criar atividade",
  );
  await expect(dialogo.getByLabel("Ação 3", { exact: true })).toContainText(
    "Mover para outra etapa",
  );

  // Desligada (o padrao): salva sem conferir ciclo nem rodar.
  await expect(
    dialogo.getByRole("checkbox", { name: "Ligada" }),
  ).not.toBeChecked();
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Automação criada.")).toBeVisible();

  // O que ficou gravado e a ordem da tela, com o mover por ultimo.
  const regra = await gravada();
  expect(regra.ativa).toBe(false);
  expect(regra.combinar).toBe("todas");
  expect(regra.condicoes).toEqual([
    { posicao: 1, tipo: "tem_etiqueta", etiqueta: ETIQUETA },
  ]);
  expect(regra.acoes).toEqual([
    {
      posicao: 1,
      acao: "nota_interna",
      etapa_destino: null,
      atividade_titulo: null,
      atividade_prazo_dias: null,
      nota_texto: "Lead parado. Ofereça um horário.",
    },
    {
      posicao: 2,
      acao: "criar_atividade",
      etapa_destino: null,
      atividade_titulo: "Ligar para o lead",
      atividade_prazo_dias: 1,
      nota_texto: null,
    },
    {
      posicao: 3,
      acao: "mover_etapa",
      etapa_destino: "em_contato",
      atividade_titulo: null,
      atividade_prazo_dias: null,
      nota_texto: null,
    },
  ]);

  // A linha da lista: Quando, Se e Faz, nessa ordem.
  const linha = page.getByRole("listitem").filter({ hasText: NOME });
  await expect(linha.getByText("Ficou 3 dias em Novo")).toBeVisible();
  await expect(
    linha.getByText(`O lead tem a etiqueta ${ETIQUETA}`),
  ).toBeVisible();
  await expect(
    linha.getByText(
      "Deixa uma nota interna, cria a atividade Ligar para o lead, em 1 dia, e move para Em contato",
    ),
  ).toBeVisible();
  await expect(linha.getByText("Desligada")).toBeVisible();
});

test("editar: remover uma ação renumera as posições, e o mover continua o último", async ({
  page,
}) => {
  await abrirAba(page);
  await page.getByRole("button", { name: `Editar ${NOME}` }).click();
  const dialogo = page.getByRole("dialog", { name: `Editar ${NOME}` });
  await expect(dialogo).toBeVisible();
  // A ordem gravada volta para o dialogo.
  await expect(dialogo.getByLabel("Ação 1", { exact: true })).toContainText(
    "Deixar nota interna",
  );
  await dialogo.getByRole("button", { name: "Remover a ação 1" }).click();
  await expect(dialogo.getByLabel("Ação 1", { exact: true })).toContainText(
    "Criar atividade",
  );
  await expect(dialogo.getByLabel("Ação 2", { exact: true })).toContainText(
    "Mover para outra etapa",
  );
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Automação salva.")).toBeVisible();

  const regra = await gravada();
  expect(regra.acoes.map((acao) => [acao.posicao, acao.acao])).toEqual([
    [1, "criar_atividade"],
    [2, "mover_etapa"],
  ]);
  expect(regra.condicoes).toHaveLength(1);
});
