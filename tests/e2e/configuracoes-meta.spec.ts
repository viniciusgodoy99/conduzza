import { expect, test, type Locator, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Fase 4: cartao "Investimento nos anuncios" na aba Anuncios da Meta de
// Configuracoes. Chips em tres camadas, botoes desabilitados com a dica,
// token write-only, conta normalizada para act_ e o pedido cedo demais.
//
// NENHUM TESTE CHAMA A META REAL:
// - "Salvar token" so e clicado com a conta vazia (sem conta, a action
//   guarda o token e nao testa);
// - "Testar leitura" nunca e clicado;
// - os estados da leitura sao montados pelo cliente de servico;
// - "Atualizar agora" so e clicado no caso "aguarde", que a funcao do banco
//   recusa ANTES de criar job (o motor de producao roda neste banco e leria
//   a Meta com o token falso);
// - com conta e token montados, ultimo_diario_dia = hoje no fuso da clinica,
//   para o diario (motor_manutencao) nao enfileirar a clinica E2E no meio do
//   teste.
// Recepcao nem chega em Configuracoes (auth-permissions.spec.ts).

const CONTA_E2E = "act_9876543210";
const TITULO_DO_CARTAO = "Investimento nos anúncios";
const DICA_SEM_CONFIGURACAO =
  "Salve a conta de anúncios e o token de leitura antes de testar.";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

/** Um token falso com o formato aceito, diferente a cada execucao. */
function tokenFalso(): string {
  return `EAAE2Eleitura${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
}

/** Dia civil (aaaa-mm-dd) no fuso informado. */
function hojeNoFuso(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function minutosAtras(minutos: number): string {
  return new Date(Date.now() - minutos * 60_000).toISOString();
}

type EstadoAnterior = {
  conta: Record<string, unknown> | null;
  temSegredo: boolean;
  token: string | null;
  leitura: Record<string, unknown> | null;
  inicio: string;
};

async function lerEstadoAnterior(): Promise<EstadoAnterior> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const inicio = new Date().toISOString();
  const conta = (
    await admin
      .from("meta_ads_account")
      .select("*")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .throwOnError()
  ).data as Record<string, unknown> | null;
  const segredo = (
    await admin
      .from("meta_ads_account_secret")
      .select("insights_access_token")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .throwOnError()
  ).data as { insights_access_token: string | null } | null;
  const leitura = (
    await admin
      .from("meta_gasto_leitura")
      .select("*")
      .eq("clinic_id", clinicId)
      .maybeSingle()
      .throwOnError()
  ).data as Record<string, unknown> | null;
  return {
    conta,
    temSegredo: segredo !== null,
    token: segredo?.insights_access_token ?? null,
    leitura,
    inicio,
  };
}

async function restaurar(anterior: EstadoAnterior): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  // Rede de seguranca: nenhum teste cria job, mas se um escapar ele nao
  // pode ficar pendente para o motor de producao ler a Meta.
  await admin
    .from("job_queue")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("kind", "sincronizar_gasto_meta")
    .eq("status", "pendente")
    .gte("created_at", anterior.inicio);
  if (anterior.conta === null) {
    await admin.from("meta_ads_account").delete().eq("clinic_id", clinicId);
  } else {
    await admin
      .from("meta_ads_account")
      .upsert(anterior.conta, { onConflict: "clinic_id" });
  }
  if (anterior.temSegredo) {
    // So a coluna de leitura: o token da CAPI nunca e tocado.
    await admin
      .from("meta_ads_account_secret")
      .update({ insights_access_token: anterior.token })
      .eq("clinic_id", clinicId);
  } else {
    // A linha nasceu no teste (so com o token de leitura).
    await admin
      .from("meta_ads_account_secret")
      .delete()
      .eq("clinic_id", clinicId);
  }
  // Depois da conta: o gatilho dela mexeria na leitura restaurada.
  await admin.from("meta_gasto_leitura").delete().eq("clinic_id", clinicId);
  if (anterior.leitura !== null) {
    await admin.from("meta_gasto_leitura").upsert(anterior.leitura);
  }
}

/**
 * Monta conta, token e situacao da leitura. `leitura` nula apaga a linha;
 * as colunas passadas sobrepoem uma leitura funcionando.
 */
async function montar(opcoes: {
  conta: string | null;
  token: string | null;
  leitura: Record<string, unknown> | null;
}): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const { timezone } = (
    await admin
      .from("clinic")
      .select("timezone")
      .eq("id", clinicId)
      .single()
      .throwOnError()
  ).data as { timezone: string };

  if (opcoes.conta === null) {
    await admin
      .from("meta_ads_account")
      .delete()
      .eq("clinic_id", clinicId)
      .throwOnError();
  } else {
    await admin
      .from("meta_ads_account")
      .upsert(
        { clinic_id: clinicId, ad_account_id: opcoes.conta },
        { onConflict: "clinic_id" },
      )
      .throwOnError();
  }
  await admin
    .from("meta_ads_account_secret")
    .upsert(
      { clinic_id: clinicId, insights_access_token: opcoes.token },
      { onConflict: "clinic_id" },
    )
    .throwOnError();
  // Depois da conta (o gatilho dela volta a leitura para nao_testada).
  await admin
    .from("meta_gasto_leitura")
    .delete()
    .eq("clinic_id", clinicId)
    .throwOnError();
  if (opcoes.leitura !== null) {
    await admin
      .from("meta_gasto_leitura")
      .insert({
        clinic_id: clinicId,
        situacao: "funcionando",
        problema: null,
        codigo_da_meta: null,
        nome_da_conta: "Conta E2E",
        moeda: "BRL",
        fuso_da_conta: timezone,
        conta_ativa: true,
        testada_em: minutosAtras(60 * 24),
        sincronizado_em: minutosAtras(120),
        tentado_em: minutosAtras(120),
        // O diario de producao pula a clinica hoje.
        ultimo_diario_dia: hojeNoFuso(timezone),
        ...opcoes.leitura,
      })
      .throwOnError();
  }
}

function cartaoDoInvestimento(page: Page): Locator {
  return page.getByRole("region", { name: TITULO_DO_CARTAO });
}

/** A regiao aria-live do resultado das acoes do cartao. */
function resultado(cartao: Locator): Locator {
  return cartao.locator('[aria-live="polite"]');
}

async function abrirAba(page: Page): Promise<Locator> {
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=meta");
  await expect(
    page.getByRole("tab", { name: "Anúncios da Meta" }),
  ).toHaveAttribute("aria-selected", "true");
  const cartao = cartaoDoInvestimento(page);
  await expect(cartao).toBeVisible();
  return cartao;
}

async function verDica(
  page: Page,
  cartao: Locator,
  botao: string,
  texto: string,
): Promise<void> {
  await page.mouse.move(8, 8, { steps: 8 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await cartao
    .locator("span[tabindex='0']", {
      has: page.getByRole("button", { name: botao, exact: true }),
    })
    .hover();
  await expect(page.getByRole("tooltip").filter({ hasText: texto })).toBeVisible();
}

async function jobsDeGasto(): Promise<number> {
  const { count } = await adminClient()
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", dados().clinicId)
    .eq("kind", "sincronizar_gasto_meta")
    .throwOnError();
  return count ?? 0;
}

test("sem conta nem token: Leitura não configurada, botões presos com a dica e um campo de conta só", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({ conta: null, token: null, leitura: null });
    const cartao = await abrirAba(page);

    await expect(cartao).toContainText("Leitura não configurada");
    await expect(cartao).toContainText("Sem token");
    await expect(
      cartao.getByRole("button", { name: "Testar leitura", exact: true }),
    ).toBeDisabled();
    await expect(
      cartao.getByRole("button", { name: "Atualizar agora", exact: true }),
    ).toBeDisabled();
    await expect(
      cartao.getByRole("button", { name: "Salvar token", exact: true }),
    ).toBeDisabled();
    await verDica(page, cartao, "Testar leitura", DICA_SEM_CONFIGURACAO);
    await verDica(page, cartao, "Atualizar agora", DICA_SEM_CONFIGURACAO);

    // Campo de senha sem o olho; a conta nao se repete no cartao.
    const campo = cartao.getByLabel("Token de leitura de anúncios");
    await expect(campo).toHaveAttribute("type", "password");
    await expect(campo).toHaveValue("");
    await expect(cartao.getByRole("button", { name: /Mostrar/ })).toHaveCount(0);
    await expect(page.getByLabel("Conta de anúncios", { exact: true })).toHaveCount(1);
    await expect(cartao.getByLabel("Conta de anúncios", { exact: true })).toHaveCount(0);
  } finally {
    await restaurar(anterior);
  }
});

test("salvar o token sem conta grava o segredo, não testa, e o valor nunca volta para a tela", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  const token = tokenFalso();
  try {
    await montar({ conta: null, token: null, leitura: null });
    const cartao = await abrirAba(page);

    await cartao.getByLabel("Token de leitura de anúncios").fill(token);
    await cartao.getByRole("button", { name: "Salvar token", exact: true }).click();

    await expect(resultado(cartao)).toContainText(
      "O token foi salvo. Salve a conta de anúncios para testar a leitura.",
    );
    await expect(cartao.getByLabel("Token de leitura de anúncios")).toHaveValue("");
    await expect(cartao).toContainText("Token salvo");
    // Sem conta, continua nao configurada.
    await expect(cartao).toContainText("Leitura não configurada");
    expect(await page.content()).not.toContain(token);

    const admin = adminClient();
    const clinicId = dados().clinicId;
    const segredo = (
      await admin
        .from("meta_ads_account_secret")
        .select("insights_access_token")
        .eq("clinic_id", clinicId)
        .single()
        .throwOnError()
    ).data as { insights_access_token: string | null };
    expect(segredo.insights_access_token).toBe(token);
    const leitura = (
      await admin
        .from("meta_gasto_leitura")
        .select("situacao, problema, testada_em")
        .eq("clinic_id", clinicId)
        .single()
        .throwOnError()
    ).data as { situacao: string; problema: string | null; testada_em: string | null };
    expect(leitura).toEqual({ situacao: "nao_testada", problema: null, testada_em: null });

    // Auditoria sem o valor, e nenhum teste (nao houve chamada a Meta).
    const trilha = (
      await admin
        .from("audit_log")
        .select("action, entity, entity_id")
        .eq("clinic_id", clinicId)
        .gte("created_at", anterior.inicio)
        .in("action", ["atualizou_token_leitura_meta", "testou_leitura_meta"])
        .throwOnError()
    ).data as { action: string; entity: string; entity_id: string }[];
    expect(trilha).toEqual([
      {
        action: "atualizou_token_leitura_meta",
        entity: "meta_ads_account_secret",
        entity_id: clinicId,
      },
    ]);
    expect(JSON.stringify(trilha)).not.toContain(token);

    // Teclado: a confirmacao recebe o foco ao aparecer (no grupo, nao no
    // Remover) e, ao cancelar, o foco volta ao "Remover token".
    const removerToken = cartao.getByRole("button", {
      name: "Remover token",
      exact: true,
    });
    const confirmacao = cartao.getByRole("group", {
      name: "Confirmar a remoção do token de leitura",
    });
    await removerToken.focus();
    await page.keyboard.press("Enter");
    await expect(confirmacao).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmacao.getByRole("button", { name: "Remover", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmacao.getByRole("button", { name: "Cancelar", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmacao).toHaveCount(0);
    await expect(removerToken).toBeFocused();

    // Remover pede confirmacao e zera so o token de leitura.
    await removerToken.click();
    await expect(confirmacao).toBeVisible();
    await confirmacao.getByRole("button", { name: "Remover", exact: true }).click();
    await expect(resultado(cartao)).toContainText(
      "Token de leitura removido. O investimento já lido continua guardado.",
    );
    await expect(cartao).toContainText("Sem token");
    const depois = (
      await admin
        .from("meta_ads_account_secret")
        .select("insights_access_token")
        .eq("clinic_id", clinicId)
        .single()
        .throwOnError()
    ).data as { insights_access_token: string | null };
    expect(depois.insights_access_token).toBeNull();
  } finally {
    await restaurar(anterior);
  }
});

test("a conta digitada só com números volta como act_, e a conta inválida explica o formato", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({ conta: null, token: null, leitura: null });
    await abrirAba(page);

    const campoDaConta = page.getByLabel("Conta de anúncios", { exact: true });
    await campoDaConta.fill("9876543210");
    await page.getByRole("button", { name: "Salvar conta", exact: true }).click();
    await expect(campoDaConta).toHaveValue(CONTA_E2E);
    const conta = (
      await adminClient()
        .from("meta_ads_account")
        .select("ad_account_id")
        .eq("clinic_id", dados().clinicId)
        .single()
        .throwOnError()
    ).data as { ad_account_id: string | null };
    expect(conta.ad_account_id).toBe(CONTA_E2E);

    await campoDaConta.fill("conta da clínica");
    await page.getByRole("button", { name: "Salvar conta", exact: true }).click();
    // Filtrado: o anunciador de rotas do Next tambem tem role="alert".
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Confira a conta de anúncios: são só números, com ou sem act_ na frente.",
      }),
    ).toBeVisible();
    // Nada gravado: a conta continua a normalizada.
    const depois = (
      await adminClient()
        .from("meta_ads_account")
        .select("ad_account_id")
        .eq("clinic_id", dados().clinicId)
        .single()
        .throwOnError()
    ).data as { ad_account_id: string | null };
    expect(depois.ad_account_id).toBe(CONTA_E2E);
  } finally {
    await restaurar(anterior);
  }
});

test("conta e token sem teste: Ainda não testada, com Testar leitura liberado", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({ conta: CONTA_E2E, token: tokenFalso(), leitura: null });
    const cartao = await abrirAba(page);
    await expect(cartao).toContainText("Ainda não testada");
    await expect(cartao).toContainText("Token salvo");
    // So confere que esta liberado: clicar falaria com a Meta.
    await expect(
      cartao.getByRole("button", { name: "Testar leitura", exact: true }),
    ).toBeEnabled();
  } finally {
    await restaurar(anterior);
  }
});

test("leitura funcionando: Lendo o investimento, Atualizado em e o pedido cedo demais sem criar job", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    // Pedido manual ha 3 minutos e meio, ja tentado depois: nao esta
    // atualizando, e o proximo pedido cai no intervalo de 10 minutos.
    await montar({
      conta: CONTA_E2E,
      token: tokenFalso(),
      leitura: {
        atualizacao_pedida_em: minutosAtras(3.5),
        tentado_em: minutosAtras(3),
        sincronizado_em: minutosAtras(3),
      },
    });
    const cartao = await abrirAba(page);

    await expect(cartao).toContainText("Lendo o investimento");
    await expect(cartao).toContainText(/Atualizado em \d{2}\/\d{2} às \d{2}:\d{2}/);
    await expect(cartao).toContainText("Conta lida: Conta E2E · BRL");

    const antes = await jobsDeGasto();
    const atualizar = cartao.getByRole("button", {
      name: "Atualizar agora",
      exact: true,
    });
    await expect(atualizar).toBeEnabled();
    await atualizar.click();
    await expect(resultado(cartao)).toContainText(
      /O investimento foi atualizado há [34] minutos\. Tente de novo daqui a pouco\./,
    );
    expect(await jobsDeGasto()).toBe(antes);
  } finally {
    await restaurar(anterior);
  }
});

test("leitura com problema: o texto da Meta e Atualizar agora parado, com a dica", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({
      conta: CONTA_E2E,
      token: tokenFalso(),
      leitura: {
        situacao: "com_problema",
        problema: "token_invalido",
        codigo_da_meta: 190,
      },
    });
    const cartao = await abrirAba(page);

    await expect(cartao).toContainText("Leitura com problema");
    await expect(cartao).toContainText("A leitura diária está parada.");
    await expect(cartao).toContainText(
      "A Meta recusou o token: ele expirou, foi revogado ou foi colado pela metade. Gere um novo e cole aqui.",
    );
    await expect(
      cartao.getByRole("button", { name: "Atualizar agora", exact: true }),
    ).toBeDisabled();
    await verDica(
      page,
      cartao,
      "Atualizar agora",
      "A leitura está parada porque a Meta recusou o token ou a conta. Corrija e use Testar leitura.",
    );
    // E pelo teste que a pausa sai: ele continua liberado.
    await expect(
      cartao.getByRole("button", { name: "Testar leitura", exact: true }),
    ).toBeEnabled();
  } finally {
    await restaurar(anterior);
  }
});

test("Atualizando enquanto o pedido é mais novo que a última tentativa", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({
      conta: CONTA_E2E,
      token: tokenFalso(),
      leitura: {
        atualizacao_pedida_em: minutosAtras(1),
        tentado_em: minutosAtras(120),
      },
    });
    const cartao = await abrirAba(page);

    await expect(cartao).toContainText("Atualizando");
    await expect(
      cartao.getByRole("button", { name: "Atualizar agora", exact: true }),
    ).toBeDisabled();
    await verDica(
      page,
      cartao,
      "Atualizar agora",
      "A atualização já foi pedida. O investimento novo aparece em alguns minutos.",
    );
  } finally {
    await restaurar(anterior);
  }
});
