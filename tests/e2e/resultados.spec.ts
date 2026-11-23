import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Tela 11, Resultados (Fase 3): as 4 vistas do design como abas de verdade
// (role=tab, ?aba=), o link antigo abrindo a vista que recebeu o conteudo, o
// objetivo de conversao definido por quem administra e os valores em reais
// fechados para a recepcao (visiveis, desabilitados, com dica).

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

async function removerObjetivo(): Promise<void> {
  await adminClient()
    .from("objetivo_de_conversao")
    .delete()
    .eq("clinic_id", dados().clinicId);
}

function cartao(page: Page, rotulo: string) {
  return page.getByRole("group", { name: rotulo, exact: true });
}

test("as 4 vistas são abas de verdade e a URL guarda a aba", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/relatorios");

  const lista = page.getByRole("tablist", { name: "Vistas de Resultados" });
  await expect(lista.getByRole("tab")).toHaveText([
    "Visão geral",
    "Marketing",
    "Comercial",
    "Agente de IA",
  ]);
  await expect(page.getByRole("tab", { name: "Visão geral" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const rotulo of [
    "Leads recebidos",
    "Consultas agendadas",
    "Taxa de conversão",
    "Custo por lead",
    "Faturamento estimado",
  ]) {
    await expect(cartao(page, rotulo)).toBeVisible();
  }
  // Sem rosca: a origem e em barras com o numero escrito.
  await expect(
    page.getByRole("heading", { name: "Origem dos leads" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Comercial" }).click();
  await expect(page).toHaveURL(/aba=comercial/);
  await expect(page.getByRole("tab", { name: "Comercial" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(cartao(page, "Consultas recuperadas")).toBeVisible();

  await page.getByRole("tab", { name: "Agente de IA" }).click();
  await expect(page).toHaveURL(/aba=ia/);
  await expect(
    page.getByRole("heading", { name: "Desempenho da recepcionista de IA" }),
  ).toBeVisible();
  // Clinica de e2e usa o provedor fake: nada de custo por mensagem.
  await expect(cartao(page, "Custo do período")).toHaveCount(0);
});

test("link antigo ?aba=confirmacao abre Comercial com a confirmação completa", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/relatorios?aba=confirmacao");

  await expect(page.getByRole("tab", { name: "Comercial" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Contra a linha de base" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Antes e depois da primeira mensagem de régua",
    }),
  ).toBeVisible();
});

test("admin define o objetivo de conversão e o rodapé mostra Objetivo: X%", async ({
  page,
}) => {
  apenasDesktop();
  await removerObjetivo();
  try {
    await login(page, dados().emails.admin);
    await page.goto("/relatorios");

    const taxa = cartao(page, "Taxa de conversão");
    await expect(taxa).toBeVisible();
    await expect(taxa).not.toContainText("Objetivo:");

    await taxa.getByRole("button", { name: "Definir objetivo" }).click();
    const dialogo = page.getByRole("dialog", { name: "Objetivo de conversão" });
    await dialogo.getByLabel("Objetivo (%)").fill("35,5");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    await expect(dialogo).toBeHidden();
    await expect(taxa).toContainText("Objetivo: 35,5%");

    // Remover devolve o cartao ao estado sem objetivo (o rodape some).
    await taxa.getByRole("button", { name: "Alterar objetivo" }).click();
    await dialogo.getByRole("button", { name: "Remover objetivo" }).click();
    await expect(dialogo).toBeHidden();
    await expect(taxa).not.toContainText("Objetivo:");
  } finally {
    await removerObjetivo();
  }
});

test("recepção vê Faturamento e o objetivo desabilitados, com dica", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.recepcao);
  await page.goto("/relatorios");

  // Faturamento: visivel, sem numero nenhum em reais, com a dica.
  const faturamento = cartao(page, "Faturamento estimado");
  await expect(faturamento).toContainText("Sem acesso");
  await expect(faturamento).not.toContainText("R$");
  await faturamento.locator("span[tabindex='0']").hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Só administrador e gestor veem valores em reais.",
  );

  // Objetivo: o botao existe, desabilitado, e diz por que.
  const botao = cartao(page, "Taxa de conversão").getByRole("button", {
    name: /(Definir|Alterar) objetivo/,
  });
  await expect(botao).toBeDisabled();
  // Tira o mouse da primeira dica (em passos, como um mouse de verdade) e
  // espera ela fechar antes de passar no botao.
  await page.mouse.move(8, 8, { steps: 12 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // O `has` e relativo ao envoltorio da dica: um seletor que comeca pelo
  // cartao nunca casaria dentro dele.
  await cartao(page, "Taxa de conversão")
    .locator("span[tabindex='0']", {
      has: page.getByRole("button", { name: /(Definir|Alterar) objetivo/ }),
    })
    .hover();
  // A dica do Faturamento pode seguir aberta um instante: espera a do botao.
  await expect(
    page
      .getByRole("tooltip")
      .filter({ hasText: "Só administrador e gestor definem o objetivo de conversão." }),
  ).toBeVisible();

  // Custo por lead tambem e valor em reais.
  await expect(cartao(page, "Custo por lead")).toContainText("Sem acesso");
});

// ---------------------------------------------------------------------------
// Fase 4: investimento da Meta montado pelo cliente de servico (sem Meta
// real). Dois leads de anuncio casados com uma campanha pelo anuncio, uma
// campanha com gasto e sem lead, e o total da conta. Admin ve o numero e as
// colunas; recepcao nao ve nenhum R$ (tela e CSV).
// ---------------------------------------------------------------------------

const CONTA_E2E = "act_9876543210";
const ANUNCIO_COM_LEAD = "120000000000009901";
const CAMPANHA_COM_LEAD = "120000000000009910";
const ANUNCIO_SEM_LEAD = "120000000000009902";
const CAMPANHA_SEM_LEAD = "120000000000009920";
const TELEFONES_DE_ANUNCIO = ["+5584970000091", "+5584970000092"];

/** Dia civil (aaaa-mm-dd) no fuso informado, deslocado em dias. */
function diaNoFuso(timezone: string, dias: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + dias * 24 * 60 * 60_000));
}

type EstadoMetaAnterior = {
  conta: { ad_account_id: string | null } | null;
  /** A linha de leitura inteira, para voltar como estava (outro e2e). */
  leitura: Record<string, unknown> | null;
};

async function limparInvestimento(anterior: EstadoMetaAnterior): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", clinicId)
    .in("phone_e164", TELEFONES_DE_ANUNCIO);
  for (const tabela of [
    "meta_gasto_diario",
    "meta_gasto_conta_diario",
    "meta_anuncio",
    "meta_gasto_leitura",
  ]) {
    await admin.from(tabela).delete().eq("clinic_id", clinicId);
  }
  if (anterior.conta === null) {
    await admin.from("meta_ads_account").delete().eq("clinic_id", clinicId);
  } else {
    await admin
      .from("meta_ads_account")
      .update({ ad_account_id: anterior.conta.ad_account_id })
      .eq("clinic_id", clinicId);
  }
  // Depois da conta: o gatilho dela mexeria na leitura restaurada.
  if (anterior.leitura !== null) {
    await admin.from("meta_gasto_leitura").upsert(anterior.leitura);
  }
}

/** O que existia antes do teste, para a limpeza restaurar. */
async function lerEstadoMetaAnterior(): Promise<EstadoMetaAnterior> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const conta = (
    await admin
      .from("meta_ads_account")
      .select("ad_account_id")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .throwOnError()
  ).data as EstadoMetaAnterior["conta"];
  const leitura = (
    await admin
      .from("meta_gasto_leitura")
      .select("*")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .throwOnError()
  ).data as EstadoMetaAnterior["leitura"];
  return { conta, leitura };
}

/**
 * Monta conta, leitura, anuncios, gasto e os dois leads de anuncio. `leitura`
 * sobrepoe colunas da linha de leitura (recebe o fuso da clinica), para os
 * casos de leitura com problema.
 */
async function montarInvestimento(
  leitura: (fuso: string) => Record<string, unknown> = () => ({}),
): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const clinica = (
    await admin
      .from("clinic")
      .select("timezone")
      .eq("id", clinicId)
      .single()
      .throwOnError()
  ).data as { timezone: string };
  const fuso = clinica.timezone;

  // A conta primeiro: o gatilho dela volta a leitura para "nao_testada".
  await admin
    .from("meta_ads_account")
    .upsert({ clinic_id: clinicId, ad_account_id: CONTA_E2E }, { onConflict: "clinic_id" })
    .throwOnError();
  await admin
    .from("meta_gasto_leitura")
    .upsert(
      {
        clinic_id: clinicId,
        situacao: "funcionando",
        problema: null,
        codigo_da_meta: null,
        ad_account_id: CONTA_E2E,
        nome_da_conta: "Conta E2E",
        moeda: "BRL",
        fuso_da_conta: fuso,
        conta_ativa: true,
        lido_desde: diaNoFuso(fuso, -59),
        lido_ate: diaNoFuso(fuso, 0),
        sincronizado_em: new Date().toISOString(),
        tentado_em: new Date().toISOString(),
        ...leitura(fuso),
      },
      { onConflict: "clinic_id" },
    )
    .throwOnError();
  const diaDoGasto = diaNoFuso(fuso, -2);
  // upsert: na repeticao, a tentativa interrompida pode ter gravado as
  // mesmas linhas depois da limpeza (requisicao em voo).
  await admin
    .from("meta_anuncio")
    .upsert([
      {
        clinic_id: clinicId,
        ad_id: ANUNCIO_COM_LEAD,
        ad_account_id: CONTA_E2E,
        campaign_id: CAMPANHA_COM_LEAD,
        campaign_name: "Campanha E2E Implante",
        ultimo_dia_com_entrega: diaDoGasto,
      },
      {
        clinic_id: clinicId,
        ad_id: ANUNCIO_SEM_LEAD,
        ad_account_id: CONTA_E2E,
        campaign_id: CAMPANHA_SEM_LEAD,
        campaign_name: "Campanha E2E Sem Lead",
        ultimo_dia_com_entrega: diaDoGasto,
      },
    ], { onConflict: "clinic_id,ad_id" })
    .throwOnError();
  await admin
    .from("meta_gasto_diario")
    .upsert([
      {
        clinic_id: clinicId,
        ad_account_id: CONTA_E2E,
        dia: diaDoGasto,
        ad_id: ANUNCIO_COM_LEAD,
        campaign_id: CAMPANHA_COM_LEAD,
        campaign_name: "Campanha E2E Implante",
        spend_cents: 342_000,
        currency: "BRL",
      },
      {
        clinic_id: clinicId,
        ad_account_id: CONTA_E2E,
        dia: diaDoGasto,
        ad_id: ANUNCIO_SEM_LEAD,
        campaign_id: CAMPANHA_SEM_LEAD,
        campaign_name: "Campanha E2E Sem Lead",
        spend_cents: 50_000,
        currency: "BRL",
      },
    ], { onConflict: "clinic_id,dia,ad_id" })
    .throwOnError();
  // Total da conta (level=account): R$ 3.920,00.
  await admin
    .from("meta_gasto_conta_diario")
    .upsert({
      clinic_id: clinicId,
      ad_account_id: CONTA_E2E,
      dia: diaDoGasto,
      spend_cents: 392_000,
      currency: "BRL",
    }, { onConflict: "clinic_id,dia" })
    .throwOnError();
  // Dois leads que chegaram pelo anuncio (service role: a atribuicao de
  // anuncio so e protegida contra a sessao).
  const chegada = new Date(Date.now() - 60 * 60_000).toISOString();
  await admin
    .from("contact")
    .insert(
      TELEFONES_DE_ANUNCIO.map((telefone, indice) => ({
        clinic_id: clinicId,
        phone_e164: telefone,
        name: null,
        kind: "lead",
        ctwa_clid: `e2e-clid-${indice + 1}`,
        source_ad_id: ANUNCIO_COM_LEAD,
        first_contact_at: chegada,
      })),
    )
    .throwOnError();
}

function secaoDeCampanhas(page: Page) {
  return page.locator('[data-slot="card"]', {
    has: page.getByRole("heading", { name: "Campanhas", exact: true }),
  });
}

test("admin vê o custo por lead e as colunas de investimento com o gasto lido", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoMetaAnterior();
  try {
    await montarInvestimento();
    await login(page, dados().emails.admin);
    await page.goto("/relatorios");

    // R$ 3.920,00 / 2 leads de anuncio = R$ 1.960,00
    const custo = cartao(page, "Custo por lead");
    await expect(custo).toContainText(/R\$\s1\.960,00/);
    await expect(custo).toContainText(/R\$\s3\.920,00 em 2 leads do Meta Ads/);
    await expect(custo).toContainText(/Atualizado em \d{2}\/\d{2} às \d{2}:\d{2}/);

    const campanhas = secaoDeCampanhas(page);
    for (const coluna of [
      "Campanha",
      "Investimento",
      "Leads",
      "Custo por lead",
      "Agendados",
      "Conversão",
    ]) {
      await expect(
        campanhas.getByRole("columnheader", { name: coluna, exact: true }),
      ).toBeVisible();
    }
    const comLead = campanhas.getByRole("row", { name: /Campanha E2E Implante/ });
    await expect(comLead).toContainText(/R\$\s3\.420,00/);
    // R$ 3.420,00 / 2 leads casados = R$ 1.710,00
    await expect(comLead).toContainText(/R\$\s1\.710,00/);
    const semLead = campanhas.getByRole("row", { name: /Campanha E2E Sem Lead/ });
    await expect(semLead).toContainText(/R\$\s500,00/);
    await expect(semLead).toContainText("Sem leads");
    // Campanha digitada no contato (fixture "Campanha E2E"): fora da Meta.
    await expect(campanhas).toContainText("Fora da Meta");
    await expect(campanhas).toContainText(
      /Investimento sem lead casado: R\$\s500,00 em 1 campanha/,
    );
    await expect(campanhas).toContainText(/Leads sem campanha: \d+ de \d+/);
    await expect(campanhas).not.toContainText(
      "Investimento, custo por lead, custo por consulta realizada, faturamento, retorno, vendas e valor das vendas: só administrador e gestor.",
    );

    // Marketing: o mesmo cartao e a mesma tabela.
    await page.getByRole("tab", { name: "Marketing" }).click();
    await expect(page).toHaveURL(/aba=marketing/);
    await expect(cartao(page, "Custo por lead")).toContainText(/R\$\s1\.960,00/);
    await expect(
      secaoDeCampanhas(page).getByRole("columnheader", {
        name: "Investimento",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await limparInvestimento(anterior);
  }
});

test("admin com a leitura parada há 10 dias vê Ainda não medido, nunca custo baixo demais", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoMetaAnterior();
  try {
    // Token vencido: a ultima leitura que deu certo foi ha 10 dias e o
    // diario parou. O gasto gravado continua no banco, mas o periodo padrao
    // (ultimos 30 dias) nao esta lido ate o fim.
    await montarInvestimento((fuso) => ({
      situacao: "com_problema",
      problema: "token_invalido",
      codigo_da_meta: 190,
      lido_ate: diaNoFuso(fuso, -10),
    }));
    await login(page, dados().emails.admin);
    await page.goto("/relatorios");

    const custo = cartao(page, "Custo por lead");
    await expect(custo).toContainText("Ainda não medido");
    await expect(custo).not.toContainText("R$");
    await expect(custo).not.toContainText("Sem investimento no período");

    const campanhas = secaoDeCampanhas(page);
    await expect(campanhas).toContainText(/O investimento foi lido até \d{2}\/\d{2}\/\d{4}\./);
    await expect(campanhas).toContainText("A última leitura do investimento teve problema.");
    const comLead = campanhas.getByRole("row", { name: /Campanha E2E Implante/ });
    await expect(comLead).toContainText("Não medido");
    await expect(comLead).not.toContainText("R$");
    await expect(campanhas).not.toContainText("Investimento sem lead casado");
  } finally {
    await limparInvestimento(anterior);
  }
});

test("recepção não vê nenhum R$ em Resultados nem no CSV, com o investimento lido", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoMetaAnterior();
  try {
    await montarInvestimento();
    await login(page, dados().emails.recepcao);
    await page.goto("/relatorios");

    await expect(cartao(page, "Custo por lead")).toContainText("Sem acesso");
    const campanhas = secaoDeCampanhas(page);
    // As contagens sim: a campanha casada pelo anuncio aparece com os leads.
    await expect(
      campanhas.getByRole("row", { name: /Campanha E2E Implante/ }),
    ).toBeVisible();
    // A campanha so com gasto e as colunas em reais nao existem no DOM.
    await expect(
      campanhas.getByRole("row", { name: /Campanha E2E Sem Lead/ }),
    ).toHaveCount(0);
    await expect(
      campanhas.getByRole("columnheader", { name: "Investimento", exact: true }),
    ).toHaveCount(0);
    await expect(
      campanhas.getByRole("columnheader", { name: "Custo por lead", exact: true }),
    ).toHaveCount(0);
    await expect(campanhas).toContainText(
      "Investimento, custo por lead, custo por consulta realizada, faturamento, retorno, vendas e valor das vendas: só administrador e gestor.",
    );
    await expect(page.locator("main")).not.toContainText("R$");

    // CSV da aba: nenhuma celula em reais.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar" }).click();
    await page.getByRole("menuitem", { name: "Planilha (CSV)" }).click();
    const arquivo = await download;
    const caminho = await arquivo.path();
    const { readFile } = await import("node:fs/promises");
    const csv = await readFile(caminho, "utf-8");
    expect(csv).toContain("Campanhas");
    expect(csv).toContain("Campanha E2E Implante");
    expect(csv).not.toContain("R$");
    expect(csv).not.toContain("Custo por lead;");

    await page.getByRole("tab", { name: "Marketing" }).click();
    await expect(page).toHaveURL(/aba=marketing/);
    await expect(cartao(page, "Custo por lead")).toContainText("Sem acesso");
    await expect(page.locator("main")).not.toContainText("R$");
  } finally {
    await limparInvestimento(anterior);
  }
});

// ---------------------------------------------------------------------------
// Origem real do anuncio (frente E, 04/10/2026): o lead de anuncio aparece
// em Leads com a origem escrita ("Tráfego pago, Meta (Instagram)") e com a
// campanha e o conjunto tirados de meta_anuncio pelo id do anuncio, nunca de
// source_campaign. Pelo papel leitura: todo membro ativo le o mapa (RLS) e a
// origem e so leitura na tela. A origem e o conjunto entram pelo cliente de
// servico, como a ingestao (frente D) e o resolvedor (frente C) gravam.
// ---------------------------------------------------------------------------

const CONJUNTO_E2E = "120000000000009911";

test("lead de anúncio mostra Tráfego pago, a campanha e o conjunto da Meta na lista e no drawer", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoMetaAnterior();
  try {
    await montarInvestimento();
    const admin = adminClient();
    const clinicId = dados().clinicId;
    await admin
      .from("meta_anuncio")
      .update({ adset_id: CONJUNTO_E2E, adset_name: "Conjunto E2E Mulheres 30+" })
      .eq("clinic_id", clinicId)
      .eq("ad_id", ANUNCIO_COM_LEAD)
      .throwOnError();
    // So o primeiro dos dois ganha a origem real; o segundo fica so com o id
    // do anuncio (contato anterior a ingestao nova) e mesmo assim mostra a
    // campanha da Meta, que sai do mapa pelo id.
    await admin
      .from("contact")
      .update({
        source_channel: "trafego_pago",
        source_origin: "Meta",
        source_medium: "Instagram",
        source_method: "anuncio_ctwa",
        source_captured_at: new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
      .eq("phone_e164", TELEFONES_DE_ANUNCIO[0]!)
      .throwOnError();

    await login(page, dados().emails.leitura);
    await page.goto("/leads?visao=lista");

    const comOrigem = page
      .getByRole("row")
      .filter({ hasText: "(84) 97000-0091" });
    await expect(comOrigem).toContainText("Tráfego pago, Meta (Instagram)");
    await expect(comOrigem).toContainText("Campanha E2E Implante");
    await expect(comOrigem).not.toContainText("trafego_pago");

    const soComAnuncio = page
      .getByRole("row")
      .filter({ hasText: "(84) 97000-0092" });
    await expect(soComAnuncio).toContainText("Campanha E2E Implante");

    await page
      .getByRole("button", { name: "Abrir Sem nome, (84) 97000-0091" })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Tráfego pago, Meta (Instagram)");
    await expect(drawer).toContainText("Campanha E2E Implante");
    await expect(drawer).toContainText("Conjunto E2E Mulheres 30+");
    await expect(drawer).toContainText("Anúncio de clique para WhatsApp");
    await expect(drawer).not.toContainText("trafego_pago");
    await expect(drawer).not.toContainText("ainda não identificada");
  } finally {
    await limparInvestimento(anterior);
  }
});

// ---------------------------------------------------------------------------
// Conversoes para o Google Ads (etapa 6A, 16/11/2026): o item do menu
// "Exportar" baixa o arquivo no modelo do Google para administrador e gestor;
// para os outros papeis ele fica visivel e desabilitado, com o motivo.
// ---------------------------------------------------------------------------

test("admin baixa as conversões para o Google Ads; recepção vê o item desabilitado, com o motivo", async ({
  page,
  browser,
}) => {
  apenasDesktop();
  const admin = adminClient();
  const codigo = "GEE234";
  const gclid = `gclid-e2e-${Date.now().toString(36)}`;
  const iso = (ms: number) => new Date(ms).toISOString();
  const agora = Date.now();
  const HORA = 3_600_000;
  // Etapa so deste teste: (clinica, contato, etapa) e unico em conversion_event.
  const ETAPA = "e2e_google";
  const limpar = async () => {
    await admin
      .from("conversion_event")
      .delete()
      .eq("clinic_id", dados().clinicId)
      .eq("contact_id", dados().leads.comOrigemId)
      .eq("stage_chave", ETAPA);
    await admin
      .from("clique_do_site")
      .delete()
      .eq("clinic_id", dados().clinicId)
      .eq("codigo", codigo);
  };
  try {
    await limpar();
    await admin
      .from("clique_do_site")
      .insert({
        clinic_id: dados().clinicId,
        codigo,
        criado_em: iso(agora - 2 * HORA),
        valido_ate: iso(agora + 24 * HORA),
        contact_id: dados().leads.comOrigemId,
        casado_em: iso(agora - 2 * HORA + 60_000),
        gclid,
      })
      .throwOnError();
    const { data } = await admin
      .from("conversion_event")
      .insert({
        clinic_id: dados().clinicId,
        contact_id: dados().leads.comOrigemId,
        stage_chave: ETAPA,
        event_name: "Schedule",
        value_cents: 25000,
        created_at: iso(agora - HORA),
      })
      .select("event_id")
      .single()
      .throwOnError();
    const eventoId = data!.event_id as string;

    await login(page, dados().emails.admin);
    await page.goto("/relatorios");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar" }).click();
    await page
      .getByRole("menuitem", { name: "Conversões para o Google Ads (CSV)" })
      .click();
    const arquivo = await download;
    expect(arquivo.suggestedFilename()).toMatch(
      /^conversoes-google-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const { readFile } = await import("node:fs/promises");
    const csv = await readFile(await arquivo.path(), "utf-8");
    expect(csv.split("\r\n")[0]).toBe(
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID",
    );
    expect(csv).toContain(`${gclid},${ETAPA},`);
    expect(csv).toContain(`,250.00,BRL,${eventoId}`);
    await expect(page.getByText("1 conversão exportada.")).toBeVisible();

    // Recepcao: o item aparece, desabilitado, com o porque escrito.
    const outra = await browser.newContext();
    try {
      const tela = await outra.newPage();
      await login(tela, dados().emails.recepcao);
      await tela.goto("/relatorios");
      await tela.getByRole("button", { name: "Exportar" }).click();
      const item = tela.getByRole("menuitem", {
        name: /Conversões para o Google Ads/,
      });
      await expect(item).toBeDisabled();
      await expect(item).toContainText(
        "Só administrador e gestor exportam as conversões para o Google.",
      );
    } finally {
      await outra.close();
    }
  } finally {
    await limpar();
  }
});

// ---------------------------------------------------------------------------
// Painel por origem (decisao do dono de 17/11/2026): o seletor "Origem" poe
// ?origem= no endereco, o filtro sobrevive ao recarregar, o aviso diz o que
// acompanha a origem na aba aberta e os leads sao os do grupo escolhido.
// Escrito em 17/11/2026 com a migration 20261117110000 NAO aplicada e NAO
// rodado: so passa depois dela.
// ---------------------------------------------------------------------------

test("escolher Meta Ads filtra os leads, guarda a origem na URL, avisa o que acompanha e Todas as origens desfaz", async ({
  page,
}) => {
  apenasDesktop();
  const admin = adminClient();
  const clinicId = dados().clinicId;
  // Dois leads da Meta e um do Google.
  const TELEFONES = ["+5584970000081", "+5584970000082", "+5584970000083"];
  const limpar = async () => {
    await admin
      .from("contact")
      .delete()
      .eq("clinic_id", clinicId)
      .in("phone_e164", TELEFONES);
  };
  try {
    await limpar();
    const clinica = (
      await admin
        .from("clinic")
        .select("timezone")
        .eq("id", clinicId)
        .single()
        .throwOnError()
    ).data as { timezone: string };
    // Um dia so, de tres anos atras: nenhum outro lead da clinica de e2e
    // chegou nele, entao os numeros da tela sao os destes tres contatos.
    const chegada = new Date(Date.now() - 1100 * 24 * 60 * 60_000);
    const dia = new Intl.DateTimeFormat("en-CA", {
      timeZone: clinica.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(chegada);
    // Service role: a atribuicao de anuncio so e protegida contra a sessao.
    const daMeta = {
      source_method: "anuncio_ctwa",
      source_channel: "trafego_pago",
      source_origin: "Meta",
    };
    const doGoogle = {
      source_method: "clique_site",
      source_channel: "trafego_pago",
      source_origin: "Google",
    };
    await admin
      .from("contact")
      .insert(
        [daMeta, daMeta, doGoogle].map((origem, indice) => ({
          clinic_id: clinicId,
          phone_e164: TELEFONES[indice]!,
          name: null,
          kind: "lead",
          first_contact_at: chegada.toISOString(),
          ...origem,
        })),
      )
      .throwOnError();

    await login(page, dados().emails.admin);
    await page.goto(`/relatorios?de=${dia}&ate=${dia}`);

    const leads = () =>
      cartao(page, "Leads recebidos").locator("span.cz-num").first();
    const seletor = page.getByRole("combobox", { name: "Origem" });
    const aviso = page
      .getByRole("status")
      .filter({ hasText: "Origem escolhida: Meta Ads" });

    // Sem filtro: os tres leads, "Todas as origens" e nenhum aviso.
    await expect(leads()).toHaveText("3");
    await expect(seletor).toContainText("Todas as origens");
    await expect(page.getByText("Origem escolhida:")).toHaveCount(0);

    // As opcoes mostram os leads do periodo em cada origem.
    await seletor.click();
    await expect(page.getByRole("option")).toHaveText([
      /Todas as origens\s*3 leads/,
      /Meta Ads\s*2 leads/,
      /Google Ads\s*1 lead$/,
      /Outras origens\s*0 leads/,
      /Não rastreada\s*0 leads/,
    ]);
    await page.getByRole("option", { name: /Meta Ads/ }).click();

    // Com Meta Ads: a origem no endereco, os dois leads da Meta e o aviso.
    await expect(page).toHaveURL(/[?&]origem=meta(&|$)/);
    await expect(leads()).toHaveText("2");
    await expect(aviso).toContainText("Acompanham a origem: Leads recebidos");
    await expect(aviso).toContainText(
      "Continuam com todas as origens: Custo por lead",
    );

    // Recarregar mantem o filtro.
    await page.reload();
    await expect(page).toHaveURL(/[?&]origem=meta(&|$)/);
    await expect(seletor).toContainText("Meta Ads");
    await expect(leads()).toHaveText("2");
    await expect(aviso).toBeVisible();

    // Em Marketing o filtro continua, o aviso fala da aba e o grafico por
    // dia desenha so a serie da Meta.
    await page.getByRole("tab", { name: "Marketing" }).click();
    await expect(page).toHaveURL(/aba=marketing/);
    await expect(page).toHaveURL(/[?&]origem=meta(&|$)/);
    await expect(aviso).toContainText("Origem dos leads por dia");
    const porDia = page.locator('[data-slot="card"]', {
      has: page.getByRole("heading", { name: "Origem dos leads por dia" }),
    });
    await expect(porDia.locator("[data-legenda]")).toHaveText([
      /Meta Ads\s*2 leads/,
    ]);

    // Na aba do agente nada acompanha, e o aviso diz isso.
    await page.getByRole("tab", { name: "Agente de IA" }).click();
    await expect(aviso).toContainText(
      "Nada nesta aba acompanha a origem escolhida",
    );

    // "Todas as origens" tira o parametro e o aviso, e os tres voltam.
    await page.getByRole("tab", { name: "Visão geral" }).click();
    await seletor.click();
    await page.getByRole("option", { name: /Todas as origens/ }).click();
    await expect(page).not.toHaveURL(/origem=/);
    await expect(page.getByText("Origem escolhida:")).toHaveCount(0);
    await expect(leads()).toHaveText("3");
  } finally {
    await limpar();
  }
});
