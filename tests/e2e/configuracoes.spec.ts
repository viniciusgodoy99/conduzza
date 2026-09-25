import { expect, test } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_PREFIXO, E2E_SENHA } from "./fixtures";
import { login } from "./helpers";

// Tela 12, Configuracoes: as duas abas na URL, o cartao de conexao do
// WhatsApp, a troca de papel pela lista da equipe, a trava da propria linha e
// a tabela de quem pode o que.
//
// Recepcao nem chega nesta tela (o layout redireciona): o aceite desse
// redirect mora em auth-permissions.spec.ts e nao se repete aqui.

const PAPEIS = [
  "Administrador",
  "Gestor",
  "Recepção",
  "Profissional",
  "Somente leitura",
];

const MODULOS = [
  "Atendimento",
  "Agenda",
  "Leads e pacientes",
  "Confirmações e lista de espera",
  "Resultados",
  "Agente de IA",
  "Automações",
  "Cadastros",
  "Configurações",
];

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

test("as abas de Configurações vivem na URL", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes");

  // A aba leva contadores (quem tem acesso e quem aguarda liberação), entao
  // o nome acessivel e "Equipe e permissões 4 com acesso ...": casa pelo
  // comeco.
  const abaEquipe = page.getByRole("tab", { name: /^Equipe e permissões/ });
  const abaWhats = page.getByRole("tab", { name: "WhatsApp", exact: true });
  await expect(abaEquipe).toBeVisible();
  await expect(abaWhats).toBeVisible();
  await expect(abaEquipe).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Usuários e permissões")).toBeVisible();

  await abaWhats.click();
  await page.waitForURL(/\/configuracoes\?aba=whatsapp/);
  await expect(abaWhats).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("WhatsApp conectado")).toBeVisible();
});

test("abrir a URL da aba de WhatsApp já cai na aba certa", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=whatsapp");

  await expect(
    page.getByRole("tab", { name: "WhatsApp", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("WhatsApp conectado")).toBeVisible();
});

test("clínica desconectada vê o cartão de conexão com Conectar liberado", async ({
  page,
}) => {
  apenasDesktop();
  // Bruno Offline administra so a clinica que nasce desconectada nas fixtures.
  await login(page, dados().emails.offline);
  await page.goto("/configuracoes?aba=whatsapp");

  await expect(page.getByText("Conectar o número da clínica")).toBeVisible();
  await expect(page.getByText("Situação atual: Desconectado")).toBeVisible();
  const conectar = page.getByRole("button", { name: "Conectar WhatsApp" });
  await expect(conectar).toBeVisible();
  await expect(conectar).toBeEnabled();
});

test("administrador troca o papel de alguém da equipe pela lista", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes");

  const seletor = page.getByRole("combobox", { name: "Papel de Lia Leitura" });
  await expect(seletor).toBeEnabled();

  // Destino calculado a partir do estado atual: a repeticao do Playwright
  // pode comecar com o papel ja trocado, e o teste continua valendo.
  const atual = (await seletor.textContent())?.trim();
  const destino = atual === "Recepção" ? "Somente leitura" : "Recepção";

  await seletor.click();
  await page.getByRole("option", { name: destino, exact: true }).click();
  await expect(page.getByText("Papel de Lia Leitura atualizado")).toBeVisible();
  await expect(seletor).toHaveText(destino);

  // Devolve o papel de leitura, que as outras suites esperam encontrar.
  if (destino !== "Somente leitura") {
    await seletor.click();
    await page
      .getByRole("option", { name: "Somente leitura", exact: true })
      .click();
    await expect(seletor).toHaveText("Somente leitura");
  }
});

test("a própria linha fica visível e desabilitada, com dica", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes");

  const meuSeletor = page.getByRole("combobox", { name: "Papel de Ana Admin" });
  await expect(meuSeletor).toBeVisible();
  await expect(meuSeletor).toBeDisabled();

  await meuSeletor.locator("..").focus();
  await expect(page.getByText("Você não altera o próprio papel")).toBeVisible();
});

test("o painel de papéis mostra os 9 módulos e os 5 papéis em texto", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes");

  const tabela = page.getByRole("table");
  // 1 cabecalho + 9 modulos.
  await expect(tabela.getByRole("row")).toHaveCount(MODULOS.length + 1);

  for (const papel of PAPEIS) {
    await expect(
      tabela.getByRole("columnheader", { name: papel, exact: true }),
    ).toBeVisible();
  }
  for (const modulo of MODULOS) {
    await expect(
      tabela.getByRole("cell", { name: modulo, exact: true }),
    ).toBeVisible();
  }

  // O nivel de acesso e TEXTO, nunca so cor: a linha de Configuracoes tem
  // "Vê e edita" para administrador e gestor e "Sem acesso" para os outros 3.
  const linhaConfiguracoes = tabela
    .getByRole("row")
    .filter({ hasText: "Configurações" });
  await expect(
    linhaConfiguracoes.getByRole("cell", { name: "Vê e edita", exact: true }),
  ).toHaveCount(2);
  await expect(
    linhaConfiguracoes.getByRole("cell", { name: "Sem acesso", exact: true }),
  ).toHaveCount(3);
});

// Achados L17/L20 da revisao da leva 2: o cadastro e publico, entao qualquer
// pessoa vira administradora. Convidar o e-mail de quem ja tem conta cria o
// vinculo na hora, mas a tela responde como num convite comum e a lista da
// equipe mostra o comeco do e-mail (o nome de uma conta nova), nunca o nome
// que a pessoa escolheu, ate ela usar a clinica.
test("convite de conta que já existe responde como convite comum e não mostra o nome dela", async ({
  page,
}) => {
  apenasDesktop();
  const admin = adminClient();
  const d = dados();
  const endereco = `${E2E_PREFIXO}-conta-existente-${Date.now()}@teste.dev`;
  const comecoDoEmail = endereco.split("@")[0] ?? "";
  const nomeEscolhido = "Nome Escolhido Pela Pessoa";
  const criada = await admin.auth.admin.createUser({
    email: endereco,
    password: E2E_SENHA,
    email_confirm: true,
    user_metadata: { name: nomeEscolhido },
  });
  const userId = criada.data.user?.id;
  if (!userId) {
    throw new Error(`Não foi possível criar ${endereco}`);
  }

  try {
    await login(page, d.emails.admin);
    await page.goto("/configuracoes");

    await page.locator("#invite-email").fill(endereco);
    await page.getByRole("button", { name: "Convidar por e-mail" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `Convite registrado para ${endereco}` }),
    ).toBeVisible();
    await expect(page.getByText(/já tinha conta/)).toHaveCount(0);

    // O vinculo entrou ativo, e a trilha tem o convite.
    const vinculo = await admin
      .from("clinic_member")
      .select("status")
      .eq("clinic_id", d.clinicId)
      .eq("user_id", userId)
      .maybeSingle()
      .throwOnError();
    expect(vinculo.data?.status).toBe("ativo");
    const trilha = await admin
      .from("audit_log")
      .select("action, entity")
      .eq("clinic_id", d.clinicId)
      .eq("entity_id", userId)
      .throwOnError();
    expect(trilha.data).toEqual([
      { action: "convidou_membro", entity: "clinic_member" },
    ]);

    // Na lista, o comeco do e-mail; o nome escolhido nao aparece em lugar
    // nenhum da tela.
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: `Papel de ${comecoDoEmail}` }),
    ).toBeVisible();
    await expect(page.getByText(nomeEscolhido)).toHaveCount(0);
  } finally {
    // O vinculo sai com a conta (on delete cascade). A linha da trilha tem
    // user_id de quem convidou e sai com a clinica no teardown.
    await admin.auth.admin.deleteUser(userId);
  }
});
