import { expect, test, type Page } from "@playwright/test";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Tela 7, Automacoes: numero das mensagens automaticas POR TIPO (decisao do
// dono de 29/09/2026, docs/07). Com dois numeros (os dois 'fake', nenhum
// envio real), o cartao mostra uma linha por tipo, cada uma com o seletor
// "Ultimo numero usado pelo paciente (recomendado)" ou um numero. O gestor
// fixa a confirmacao no segundo numero, deixa o follow-up no ultimo usado,
// salva e confere no banco; depois devolve. A recepcao ve tudo desabilitado,
// com a dica.
//
// Depende da migration 20260929130000_numero_por_tipo.sql aplicada no banco
// da suite. O segundo numero sai no fim pela mesma RPC da tela, que tambem
// devolve ao ultimo usado a escolha que apontava para ele, e as linhas da
// politica da clinica de e2e sao apagadas: outro spec nao pode herdar a
// escolha.

const TIPOS = [
  "Confirmação de consulta e Cobrar agora",
  "Recuperação depois da falta",
  "Follow-up de leads",
  "Oferta da lista de espera",
  "Aviso de remarcação",
];
const ULTIMO_USADO = "Último número usado pelo paciente (recomendado)";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

function cartao(page: Page) {
  return page.locator("[data-slot=card]").filter({
    has: page.getByRole("heading", {
      name: "Número das mensagens automáticas",
    }),
  });
}

async function limparPolitica(): Promise<void> {
  await adminClient()
    .from("whatsapp_envio_automatico")
    .delete()
    .eq("clinic_id", dados().clinicId);
}

async function removerSegundo(segundoId: string | null): Promise<void> {
  if (segundoId) {
    await adminClient().rpc("remover_numero", {
      p_clinic_id: dados().clinicId,
      p_account_id: segundoId,
    });
  }
}

test("o gestor escolhe o número de cada tipo de mensagem automática", async ({
  page,
}) => {
  apenasDesktop();
  const admin = adminClient();
  const d = dados();
  const nome = `Recepção ${Date.now().toString(36)}`;
  await limparPolitica();

  let segundoId: string | null = null;
  try {
    const segundo = await criarNumeroDeTeste(admin, d.clinicId, {
      nome,
      connection_status: "conectado",
    });
    segundoId = segundo.id;

    await login(page, d.emails.gestor);
    await page.goto("/automacoes");

    const card = cartao(page);
    await expect(card).toBeVisible();
    // Uma linha por tipo, todas no ultimo usado (nenhuma escolha gravada).
    for (const tipo of TIPOS) {
      const seletor = card.getByRole("combobox", { name: tipo, exact: true });
      await expect(seletor).toBeEnabled();
      await expect(seletor).toContainText(ULTIMO_USADO);
    }
    await expect(
      card.getByText(
        "Se o número escolhido estiver desconectado, as mensagens esperam a reconexão. Elas nunca saem por outro número sozinhas.",
      ),
    ).toBeVisible();
    await expect(
      card.getByText(
        "A resposta a quem respondeu uma mensagem sai pelo número em que o paciente respondeu.",
      ),
    ).toBeVisible();
    const salvar = card.getByRole("button", { name: "Salvar escolhas" });
    await expect(salvar).toBeDisabled();

    // Confirmacao sempre pelo segundo numero; follow-up fica no ultimo usado.
    await card
      .getByRole("combobox", {
        name: "Confirmação de consulta e Cobrar agora",
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: new RegExp(`^${nome}`) }).click();
    await expect(card.getByText("Há escolhas ainda não salvas.")).toBeVisible();
    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(
      page.getByText(
        "Escolha salva para Confirmação de consulta e Cobrar agora.",
      ),
    ).toBeVisible();

    // No banco: so a linha da confirmacao, fixa no segundo numero.
    const { data: linhas } = await admin
      .from("whatsapp_envio_automatico")
      .select("tipo, modo, conta_fixa_id")
      .eq("clinic_id", d.clinicId)
      .throwOnError();
    expect(linhas).toEqual([
      { tipo: "confirmacao", modo: "fixo", conta_fixa_id: segundo.id },
    ]);

    // Depois de recarregar, a escolha continua na tela.
    await page.reload();
    await expect(
      cartao(page).getByRole("combobox", {
        name: "Confirmação de consulta e Cobrar agora",
        exact: true,
      }),
    ).toContainText(nome);
    await expect(
      cartao(page).getByRole("combobox", {
        name: "Follow-up de leads",
        exact: true,
      }),
    ).toContainText(ULTIMO_USADO);

    // Devolve ao ultimo usado.
    await cartao(page)
      .getByRole("combobox", {
        name: "Confirmação de consulta e Cobrar agora",
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: ULTIMO_USADO }).click();
    await cartao(page).getByRole("button", { name: "Salvar escolhas" }).click();
    await expect(
      page.getByText(
        "Escolha salva para Confirmação de consulta e Cobrar agora.",
      ),
    ).toBeVisible();
    const { data: depois } = await admin
      .from("whatsapp_envio_automatico")
      .select("tipo, modo, conta_fixa_id")
      .eq("clinic_id", d.clinicId)
      .throwOnError();
    expect(depois).toEqual([
      { tipo: "confirmacao", modo: "ultimo_usado", conta_fixa_id: null },
    ]);
  } finally {
    await removerSegundo(segundoId);
    await limparPolitica();
  }
});

test("a recepção vê a escolha de cada tipo, desabilitada, com a dica", async ({
  page,
}) => {
  apenasDesktop();
  const admin = adminClient();
  const d = dados();
  const nome = `Recepção ${Date.now().toString(36)}`;
  await limparPolitica();

  let segundoId: string | null = null;
  try {
    const segundo = await criarNumeroDeTeste(admin, d.clinicId, {
      nome,
      connection_status: "desconectado",
    });
    segundoId = segundo.id;
    // Aviso de remarcacao fixo num numero desconectado: a tela avisa que
    // essas mensagens esperam a reconexao.
    await admin
      .from("whatsapp_envio_automatico")
      .insert({
        clinic_id: d.clinicId,
        tipo: "aviso_remarcacao",
        modo: "fixo",
        conta_fixa_id: segundo.id,
      })
      .throwOnError();

    await login(page, d.emails.recepcao);
    await page.goto("/automacoes");

    const card = cartao(page);
    for (const tipo of TIPOS) {
      await expect(
        card.getByRole("combobox", { name: tipo, exact: true }),
      ).toBeDisabled();
    }
    await expect(
      card.getByRole("combobox", { name: "Aviso de remarcação", exact: true }),
    ).toContainText(nome);
    await expect(
      card.getByText(`O número "${nome}" não está conectado.`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Salvar escolhas" }),
    ).toBeDisabled();
  } finally {
    await removerSegundo(segundoId);
    await limparPolitica();
  }
});
