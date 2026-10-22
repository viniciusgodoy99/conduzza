import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Reguas de follow-up por etiqueta (onda 4, item 16; contrato, secao 6):
// o gestor cria pela tela a segunda (e a terceira) regua de uma etapa que ja
// tem a regua geral, com etiqueta, e muda a ordem entre elas. O que se prova
// pela tela (o renderToStaticMarkup dos testes de unidade nao clica):
//   - "Nova régua" oferece a etapa que ja tem a geral e pede as etiquetas;
//   - a etiqueta escrita no seletor ("Usar") vira o filtro, e o nome
//     sugerido diz a etapa e a etiqueta;
//   - a regua nasce desligada, no FIM da ordem das com etiqueta da etapa, e
//     com as mensagens copiadas da geral;
//   - Descer e Subir gravam a ordem (prioridade) pela RPC
//     ordenar_reguas_de_followup, e as pontas ficam desabilitadas;
//   - a geral continua por ultimo, sem Subir e Descer;
//   - "Para quem": duas etiquetas com "Todas" gravam o modo; tirar uma volta
//     o modo para "qualquer uma" (com uma etiqueta so, os dois sao o mesmo
//     filtro: o check cadence_modo_so_com_varias_etiquetas e a action
//     normalizam).
//
// ESCRITO NA ONDA 4 E AINDA NAO RODADO: depende da migration
// 20261024100000 aplicada e do codigo da onda 4 no ar. Tudo nasce DESLIGADO
// (nenhuma mensagem sai). Usa a etapa Novo da jornada padrao da Clinica E2E:
// se ela nao tem regua geral de follow-up, o spec cria uma (desligada, com
// uma mensagem) e a apaga no fim; as reguas com etiqueta deste spec levam o
// sufixo na etiqueta e saem no fim.
test.describe.configure({ mode: "serial" });

const suffix = Date.now().toString(36);
// Sem espaco: a etiqueta vai crua no filtro "ov" do PostgREST da limpeza.
const VIP = `VIP-${suffix}`;
const RETORNO = `Retorno-${suffix}`;
const EXTRA = `Extra-${suffix}`;
const ETAPA = "novo";

const admin = adminClient();
let geralCriadaAqui: string | null = null;

type ReguaGravada = {
  id: string;
  name: string;
  active: boolean;
  etiquetas: string[];
  prioridade: number;
};

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "dialogo e reordenacao: um tamanho de tela basta",
  );
});

test.beforeAll(async () => {
  if (test.info().project.name !== "desktop-1600") {
    return;
  }
  const { data: geral } = await admin
    .from("cadence")
    .select("id")
    .eq("clinic_id", dados().clinicId)
    .eq("kind", "followup")
    .eq("trigger_stage", ETAPA)
    .eq("etiquetas", "{}")
    .maybeSingle()
    .throwOnError();
  if (geral) {
    return;
  }
  const { data: criada } = await admin
    .from("cadence")
    .insert({
      clinic_id: dados().clinicId,
      kind: "followup",
      name: `Follow-up de Novo e2e ${suffix}`,
      trigger_stage: ETAPA,
      active: false,
    })
    .select("id")
    .single()
    .throwOnError();
  geralCriadaAqui = (criada as { id: string }).id;
  await admin
    .from("cadence_step")
    .insert({
      clinic_id: dados().clinicId,
      cadence_id: geralCriadaAqui,
      offset_minutes: 60,
      fixed_body: "Oi, {{nome}}! Mensagem de teste da Clínica E2E.",
    })
    .throwOnError();
});

test.afterAll(async () => {
  await admin
    .from("cadence")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("kind", "followup")
    .eq("trigger_stage", ETAPA)
    .overlaps("etiquetas", [VIP, RETORNO]);
  if (geralCriadaAqui) {
    await admin.from("cadence").delete().eq("id", geralCriadaAqui);
  }
});

async function abrirAba(page: Page) {
  await login(page, dados().emails.gestor);
  await page.goto("/automacoes?aba=followup");
  await expect(
    page.getByRole("tab", { name: "Follow-up de leads" }),
  ).toHaveAttribute("aria-selected", "true");
}

/** As reguas com etiqueta deste spec, na ordem gravada. */
async function comEtiqueta(): Promise<ReguaGravada[]> {
  const { data } = await admin
    .from("cadence")
    .select("id, name, active, etiquetas, prioridade")
    .eq("clinic_id", dados().clinicId)
    .eq("kind", "followup")
    .eq("trigger_stage", ETAPA)
    .overlaps("etiquetas", [VIP, RETORNO])
    .order("prioridade")
    .throwOnError();
  return (data ?? []) as ReguaGravada[];
}

async function criarRegua(page: Page, etiqueta: string) {
  await page.getByRole("button", { name: "Nova régua" }).click();
  const dialogo = page.getByRole("dialog", {
    name: "Nova régua de follow-up",
  });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel("Etapa da jornada").click();
  await page.getByRole("option", { name: "Novo", exact: true }).click();
  // A etapa ja tem a geral: a tela pede as etiquetas.
  await expect(
    dialogo.getByText(
      "Novo já tem a régua geral: escolha as etiquetas de quem recebe esta.",
    ),
  ).toBeVisible();
  await dialogo.getByRole("button", { name: "Adicionar etiqueta" }).click();
  await page.getByLabel("Buscar ou escrever uma etiqueta").fill(etiqueta);
  await page.getByRole("button", { name: "Usar", exact: true }).click();
  await expect(dialogo.getByLabel("Nome da régua")).toHaveValue(
    `Follow-up de Novo: ${etiqueta}`,
  );
  await dialogo.getByRole("button", { name: "Criar régua" }).click();
  await expect(
    page.getByText("Régua criada, desligada. Confira as mensagens e ligue."),
  ).toBeVisible();
}

test("gestor cria a segunda e a terceira régua da etapa, com etiqueta, desligadas e no fim da ordem", async ({
  page,
}) => {
  await abrirAba(page);
  await criarRegua(page, VIP);
  await criarRegua(page, RETORNO);

  const reguas = await comEtiqueta();
  expect(
    reguas.map((regua) => [regua.etiquetas, regua.active, regua.name]),
  ).toEqual([
    [[VIP], false, `Follow-up de Novo: ${VIP}`],
    [[RETORNO], false, `Follow-up de Novo: ${RETORNO}`],
  ]);
  // As mensagens vieram copiadas da geral da etapa.
  const { count } = await admin
    .from("cadence_step")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", dados().clinicId)
    .in(
      "cadence_id",
      reguas.map((regua) => regua.id),
    );
  expect(count ?? 0).toBeGreaterThanOrEqual(reguas.length);

  // Na etapa: as com etiqueta na ordem (VIP em cima), a geral por ultimo,
  // sem Subir e Descer; as pontas desabilitadas.
  const etapa = page.getByRole("region", { name: "Novo", exact: true });
  await expect(
    etapa.getByRole("button", {
      name: `Subir a régua Follow-up de Novo: ${VIP}`,
    }),
  ).toBeDisabled();
  await expect(
    etapa.getByRole("button", {
      name: `Descer a régua Follow-up de Novo: ${RETORNO}`,
    }),
  ).toBeDisabled();
  await expect(
    etapa.getByText(
      "Se o lead tiver as etiquetas de mais de uma régua, vale a de cima.",
    ),
  ).toBeVisible();
});

test("gestor muda a ordem: Descer grava a prioridade pela RPC e as pontas acompanham", async ({
  page,
}) => {
  await abrirAba(page);
  const etapa = page.getByRole("region", { name: "Novo", exact: true });
  await etapa
    .getByRole("button", { name: `Descer a régua Follow-up de Novo: ${VIP}` })
    .click();
  await expect(page.getByText("Ordem das réguas salva.")).toBeVisible();

  // A ordem gravada (a RPC numera toda a etapa a partir de 1): Retorno em
  // cima de VIP, logo acima.
  const reguas = await comEtiqueta();
  expect(reguas.map((regua) => regua.etiquetas[0])).toEqual([RETORNO, VIP]);
  expect(reguas[1]!.prioridade - reguas[0]!.prioridade).toBe(1);
  await expect(
    etapa.getByRole("button", {
      name: `Subir a régua Follow-up de Novo: ${RETORNO}`,
    }),
  ).toBeDisabled();
  await expect(
    etapa.getByRole("button", {
      name: `Descer a régua Follow-up de Novo: ${VIP}`,
    }),
  ).toBeDisabled();

  // E volta pelo Subir.
  await etapa
    .getByRole("button", { name: `Subir a régua Follow-up de Novo: ${VIP}` })
    .click();
  await expect(page.getByText("Ordem das réguas salva.")).toBeVisible();
  expect((await comEtiqueta()).map((regua) => regua.etiquetas[0])).toEqual([
    VIP,
    RETORNO,
  ]);
});

test("Para quem: duas etiquetas com Todas; tirando uma, o modo volta a qualquer uma", async ({
  page,
}) => {
  await abrirAba(page);
  const etapa = page.getByRole("region", { name: "Novo", exact: true });
  const nome = `Follow-up de Novo: ${VIP}`;
  // Abre o cartao (o cabecalho e o botao do acordeao) e o "Para quem".
  await etapa
    .getByRole("button", { name: new RegExp(`^${nome}`), expanded: false })
    .click();
  await etapa.getByRole("button", { name: "Editar para quem" }).click();
  let dialogo = page.getByRole("dialog", { name: `Para quem é ${nome}` });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole("button", { name: "Adicionar etiqueta" }).click();
  await page.getByLabel("Buscar ou escrever uma etiqueta").fill(EXTRA);
  await page.getByRole("button", { name: "Usar", exact: true }).click();
  // Com duas, a escolha aparece; "Todas" grava o modo.
  await dialogo.getByRole("button", { name: "Todas", exact: true }).click();
  await expect(
    dialogo.getByRole("button", { name: "Todas", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Régua salva.")).toBeVisible();

  const filtro = async () => {
    const { data } = await admin
      .from("cadence")
      .select("etiquetas, etiquetas_modo")
      .eq("clinic_id", dados().clinicId)
      .eq("kind", "followup")
      .eq("trigger_stage", ETAPA)
      .contains("etiquetas", [VIP])
      .single()
      .throwOnError();
    return data as { etiquetas: string[]; etiquetas_modo: string };
  };
  expect(await filtro()).toEqual({
    etiquetas: [VIP, EXTRA],
    etiquetas_modo: "todas",
  });

  // Tira a segunda: com uma etiqueta so, o modo volta a qualquer uma.
  await etapa.getByRole("button", { name: "Editar para quem" }).click();
  dialogo = page.getByRole("dialog", { name: `Para quem é ${nome}` });
  await dialogo
    .getByRole("button", { name: `Remover etiqueta ${EXTRA}` })
    .click();
  await expect(
    dialogo.getByRole("button", { name: "Todas", exact: true }),
  ).toHaveCount(0);
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Régua salva.")).toBeVisible();
  expect(await filtro()).toEqual({
    etiquetas: [VIP],
    etiquetas_modo: "qualquer",
  });
});
