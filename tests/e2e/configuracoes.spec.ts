import { expect, test, type Locator, type Page } from "@playwright/test";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_PREFIXO, E2E_SENHA } from "./fixtures";
import { login } from "./helpers";

// Tela 12, Configuracoes: as duas abas na URL, os cartoes dos numeros de
// WhatsApp (um por numero; docs/07, Telas), a troca de papel pela lista da
// equipe, a trava da propria linha e a tabela de quem pode o que.
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

// O cartao do numero e um article nomeado pelo nome do numero. O das
// fixtures nasce com o nome padrao do banco (D1).
const NUMERO_PRINCIPAL = "Número principal";

function cartaoDoNumero(page: Page, nome: string): Locator {
  return page.getByRole("article", { name: nome, exact: true });
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
  const principal = cartaoDoNumero(page, NUMERO_PRINCIPAL);
  await expect(principal).toBeVisible();
  await expect(principal.getByText("Conectado", { exact: true })).toBeVisible();
});

test("abrir a URL da aba de WhatsApp já cai na aba certa", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=whatsapp");

  await expect(
    page.getByRole("tab", { name: "WhatsApp", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("Cada número é um WhatsApp separado.", { exact: false }),
  ).toBeVisible();
  const principal = cartaoDoNumero(page, NUMERO_PRINCIPAL);
  await expect(principal.getByText("Conectado", { exact: true })).toBeVisible();
  await expect(principal.getByText("Principal", { exact: true })).toBeVisible();
});

test("clínica desconectada vê o cartão do número com Conectar liberado", async ({
  page,
}) => {
  apenasDesktop();
  // Bruno Offline administra so a clinica que nasce desconectada nas fixtures.
  // O teste NAO clica em Conectar: o numero dela e 'fake' e conectaria na
  // hora, e as outras suites esperam essa clinica desconectada.
  await login(page, dados().emails.offline);
  await page.goto("/configuracoes?aba=whatsapp");

  const cartao = cartaoDoNumero(page, NUMERO_PRINCIPAL);
  // Status em 3 camadas: o rotulo e texto, nunca so a cor.
  await expect(cartao.getByText("Desconectado", { exact: true })).toBeVisible();
  const conectar = cartao.getByRole("button", {
    name: new RegExp(`^(Conectar|Reconectar) ${NUMERO_PRINCIPAL}$`),
  });
  await expect(conectar).toBeVisible();
  await expect(conectar).toBeEnabled();
});

// Varios numeros (docs/07, Telas). O segundo numero nasce pelo helper, com o
// provedor 'fake': o "Criar e conectar" da tela cria o numero com o provedor
// do AMBIENTE, e o servidor de desenvolvimento local usa o uazapi de verdade
// (servidor compartilhado). O dialogo de adicionar e conferido sem enviar.
//
// Roda com o contrato aplicado (20260925140000): sem o unique temporario de
// um numero por clinica, o segundo numero entra. Recusa do banco aqui e
// defeito, nunca motivo para pular.
test("com dois números, a aba mostra um cartão por número, renomeia e remove pelo menu", async ({
  page,
}) => {
  apenasDesktop();
  const admin = adminClient();
  const d = dados();
  const sufixo = Date.now().toString(36);
  const nome = `Recepção ${sufixo}`;
  const novoNome = `Recepção Sul ${sufixo}`;

  const { data: unidade } = await admin
    .from("unit")
    .select("id")
    .eq("clinic_id", d.clinicId)
    .eq("name", "Unidade E2E")
    .maybeSingle()
    .throwOnError();

  let segundoId: string | null = null;
  try {
    const segundo = await criarNumeroDeTeste(admin, d.clinicId, {
      nome,
      connection_status: "desconectado",
      unit_id: (unidade as { id: string } | null)?.id ?? null,
    });
    segundoId = segundo.id;

    await login(page, d.emails.admin);
    await page.goto("/configuracoes?aba=whatsapp");

    const lista = page.getByRole("list", {
      name: "Números de WhatsApp da clínica",
    });
    await expect(lista.getByRole("article")).toHaveCount(2);

    const principal = cartaoDoNumero(page, NUMERO_PRINCIPAL);
    const recepcao = cartaoDoNumero(page, nome);
    await expect(
      principal.getByText("Principal", { exact: true }),
    ).toBeVisible();
    await expect(
      principal.getByText("Conectado", { exact: true }),
    ).toBeVisible();
    await expect(
      recepcao.getByText("Desconectado", { exact: true }),
    ).toBeVisible();
    await expect(
      recepcao.getByText("Unidade E2E", { exact: true }),
    ).toBeVisible();
    await expect(recepcao.getByText("Principal", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      recepcao.getByRole("button", { name: `Conectar ${nome}` }),
    ).toBeEnabled();

    // O dialogo de adicionar: nome com o exemplo, unidade opcional (a clinica
    // tem unidade) e "Criar e conectar". Fecha sem criar (ver o topo).
    await lista.getByRole("button", { name: "Adicionar número" }).click();
    const dialogoNovo = page.getByRole("dialog", { name: "Adicionar número" });
    await expect(
      dialogoNovo.getByRole("textbox", { name: "Nome do número" }),
    ).toHaveAttribute("placeholder", "Ex.: Recepção");
    await expect(
      dialogoNovo.getByRole("combobox", { name: "Unidade (opcional)" }),
    ).toBeVisible();
    await expect(
      dialogoNovo.getByRole("button", { name: "Criar e conectar" }),
    ).toBeVisible();
    await dialogoNovo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogoNovo).toBeHidden();

    // O principal nao sai enquanto houver outro numero: o item fica visivel e
    // desabilitado, com o motivo escrito dentro dele.
    await principal
      .getByRole("button", { name: `Mais ações do número ${NUMERO_PRINCIPAL}` })
      .click();
    const removerPrincipal = page.getByRole("menuitem", {
      name: /^Remover número/,
    });
    await expect(removerPrincipal).toBeDisabled();
    await expect(removerPrincipal).toContainText(
      "Escolha outro número como principal antes de remover este.",
    );
    await page.keyboard.press("Escape");

    // Renomear pelo menu do cartao.
    await recepcao
      .getByRole("button", { name: `Mais ações do número ${nome}` })
      .click();
    await page.getByRole("menuitem", { name: "Renomear", exact: true }).click();
    const dialogoRenomear = page.getByRole("dialog", {
      name: `Renomear ${nome}`,
    });
    await dialogoRenomear
      .getByRole("textbox", { name: "Nome do número" })
      .fill(novoNome);
    await dialogoRenomear.getByRole("button", { name: "Salvar" }).click();
    const renomeado = cartaoDoNumero(page, novoNome);
    await expect(renomeado).toBeVisible();

    // Remover (administrador, numero que nao e o principal nem o fixo das
    // automaticas): o dialogo diz o que acontece, e o cartao sai da lista.
    await renomeado
      .getByRole("button", { name: `Mais ações do número ${novoNome}` })
      .click();
    await page
      .getByRole("menuitem", { name: "Remover número", exact: true })
      .click();
    const dialogoRemover = page.getByRole("dialog", {
      name: `Remover o número ${novoNome}?`,
    });
    await expect(dialogoRemover).toContainText(
      "deixa de receber e enviar mensagens pelo Conduzza. As conversas abertas dele são encerradas e o histórico continua.",
    );
    await dialogoRemover
      .getByRole("button", { name: "Remover número" })
      .click();
    await expect(dialogoRemover).toBeHidden();
    await expect(lista.getByRole("article")).toHaveCount(1);
    await expect(renomeado).toHaveCount(0);

    // Remocao logica (D3): a linha fica, com removido_em, e o principal
    // continua o mesmo.
    const { data: linha } = await admin
      .from("whatsapp_account")
      .select("removido_em, principal")
      .eq("id", segundoId)
      .single()
      .throwOnError();
    expect(
      (linha as { removido_em: string | null; principal: boolean }).removido_em,
    ).not.toBeNull();
  } finally {
    // Se o teste parou no meio, o segundo numero sai pela mesma RPC da tela
    // (chamar de novo para um numero ja removido nao faz nada).
    if (segundoId) {
      await admin.rpc("remover_numero", {
        p_clinic_id: d.clinicId,
        p_account_id: segundoId,
      });
    }
  }
});

test("gestor vê Remover número desabilitado, com a dica de que só o administrador remove", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.gestor);
  await page.goto("/configuracoes?aba=whatsapp");

  const principal = cartaoDoNumero(page, NUMERO_PRINCIPAL);
  await principal
    .getByRole("button", { name: `Mais ações do número ${NUMERO_PRINCIPAL}` })
    .click();
  const remover = page.getByRole("menuitem", { name: /^Remover número/ });
  await expect(remover).toBeDisabled();
  await expect(remover).toContainText(
    "Somente administradores removem um número de WhatsApp.",
  );
  // D8: o resto do cadastro do numero e do gestor tambem.
  await expect(
    page.getByRole("menuitem", { name: "Renomear", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
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
