import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_PREFIXO, E2E_SENHA } from "./fixtures";
import { login } from "./helpers";

// A area do super admin (decisao do dono de 03/11/2026, "Conta propria so
// para o painel"): o Painel geral fora da clinica, com menu proprio, nas
// mesmas URLs.
// - Sem sessao, /painel-geral vai para o login (o middleware), sem banco.
// - Quem nao e super admin (o administrador da clinica do e2e) e abre
//   /painel-geral vai para o Inicio, e o menu da clinica nao tem o item.
// - O super admin SO com E2E_COM_SUPER_ADMIN=1 (opt-in, como o
//   RLS_COM_SUPER_ADMIN dos testes de RLS): o teste cria um super admin
//   sintetico SEM clinica NO BANCO DE PRODUCAO, com o e-mail em example.com
//   (dominio reservado, nenhuma caixa recebe) e o prefixo do e2e, e apaga a
//   conta no fim (o product_admin vai junto, em cascata; o teardown da
//   suite apaga o que sobrar com o prefixo). Ele entra direto no Painel
//   geral (nunca em "Criar clinica"), ve o menu proprio com o e-mail e Sair,
//   e qualquer tela da clinica o devolve ao painel. Sem a variavel, esse
//   bloco e pulado: NAO crie super admin na producao sem o ok do dono.
// Roda so no projeto desktop-1600: o que se testa aqui nao depende de
// largura (o menu em 64px, a gaveta e os 40px estao nos testes de unidade).

const COM_SUPER_ADMIN = process.env.E2E_COM_SUPER_ADMIN === "1";

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
});

test("sem sessão, o Painel geral manda para o login", async ({ page }) => {
  await page.goto("/painel-geral");
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("quem não é super admin abre o Painel geral e vai para o Início", async ({
  page,
}) => {
  await login(page, dados().emails.admin);
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link", { name: "Atendimento" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Painel geral" })).toHaveCount(0);

  await page.goto("/painel-geral");
  await page.waitForURL(/\/inicio/);
  // De volta ao menu da clinica (o da area do super admin nao abriu).
  await expect(nav.getByRole("link", { name: "Atendimento" })).toBeVisible();

  // O detalhe de uma clinica tambem (a guarda e a da area inteira).
  await page.goto(`/painel-geral/${dados().clinicId}`);
  await page.waitForURL(/\/inicio/);
});

test.describe("o super admin sem clínica (opt-in)", () => {
  test.skip(!COM_SUPER_ADMIN, "só com E2E_COM_SUPER_ADMIN=1");

  const sufixo = crypto.randomUUID().slice(0, 8);
  const EMAIL = `${E2E_PREFIXO}-super-${sufixo}@example.com`;
  let superAdmin = "";

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: E2E_SENHA,
      email_confirm: true,
      user_metadata: { name: "Super admin sintético" },
    });
    if (error || !data.user) {
      throw new Error(`criar super admin: ${error?.message ?? "sem usuário"}`);
    }
    superAdmin = data.user.id;
    await admin
      .from("product_admin")
      .insert({ user_id: superAdmin })
      .throwOnError();
  });

  test.afterAll(async () => {
    if (superAdmin) {
      // O product_admin sai em cascata com a conta.
      const { error } = await adminClient().auth.admin.deleteUser(superAdmin);
      expect(error, "apagar o super admin sintético").toBeNull();
    }
  });

  async function entrarComoSuperAdmin(page: Page): Promise<void> {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha", { exact: true }).fill(E2E_SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/painel-geral$/);
  }

  test("entra direto no Painel geral, com o menu próprio, o e-mail e Sair", async ({
    page,
  }) => {
    await entrarComoSuperAdmin(page);
    await expect(
      page.getByRole("heading", { name: "Painel geral", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Crie a primeira clínica")).toHaveCount(0);

    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    const item = nav.getByRole("link", { name: "Painel geral" });
    await expect(item).toHaveAttribute("aria-current", "page");
    // Nada do menu da clinica, nem "Abrir a clinica" (a conta nao e membro).
    await expect(nav.getByRole("link", { name: "Atendimento" })).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Abrir a clínica" }),
    ).toHaveCount(0);
    await expect(page.getByText(EMAIL).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
  });

  test("qualquer tela da clínica devolve ao Painel geral", async ({ page }) => {
    await entrarComoSuperAdmin(page);
    for (const rota of [
      "/",
      "/inicio",
      "/atendimento",
      "/selecionar-clinica",
    ]) {
      await page.goto(rota);
      await page.waitForURL(/\/painel-geral$/);
    }
  });

  test("Sair leva ao login e o painel volta a exigir sessão", async ({
    page,
  }) => {
    await entrarComoSuperAdmin(page);
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL(/\/login/);
    await page.goto("/painel-geral");
    await page.waitForURL(/\/login/);
  });
});
