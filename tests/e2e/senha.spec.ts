import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { dados } from "./dados";
import { E2E_SENHA, login } from "./helpers";

// Olho para mostrar a senha e senha digitada duas vezes (pedido do dono em
// 02/10/2026). A suite roda contra o banco de operacao real
// (global-setup.ts), entao NADA aqui conclui um cadastro (o signUp criaria
// conta de verdade e mandaria e-mail pelo Resend) nem salva senha em
// /redefinir-senha (trocaria a senha do usuario do e2e). Os testes param na
// conferencia do navegador e contam os POST para provar que nada saiu. Mesmo
// que a conferencia do navegador falhasse, o servidor recusaria as senhas
// diferentes (lib/auth/senha.ts): nenhum caminho daqui grava nada.
// Roda so no desktop-1600: o comportamento nao depende de viewport.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "comportamento independente de viewport",
  );
});

const SENHAS_DIFERENTES =
  "As senhas não são iguais. Digite a mesma senha nos dois campos.";

// Conta os POST da propria aplicacao (Server Actions sao POST para a pagina).
function contarPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (pedido) => {
    if (
      pedido.method() === "POST" &&
      pedido.url().startsWith("http://localhost:3000")
    ) {
      posts.push(pedido.url());
    }
  });
  return posts;
}

// Razao de contraste entre a cor do olho e o fundo do campo, com as cores
// convertidas pelo proprio navegador (o tema usa oklch e color-mix).
async function contrasteDoOlho(page: Page): Promise<number> {
  return page.evaluate(() => {
    const botao = document.querySelector<HTMLElement>(
      'button[aria-label="Mostrar senha"]',
    );
    const campo = document.getElementById("password");
    if (!botao || !campo) {
      return 0;
    }
    const paraRgb = (cor: string): number[] => {
      const tela = document.createElement("canvas");
      tela.width = 1;
      tela.height = 1;
      const contexto = tela.getContext("2d");
      if (!contexto) {
        return [0, 0, 0];
      }
      contexto.fillStyle = cor;
      contexto.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = contexto.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    const luminancia = ([r = 0, g = 0, b = 0]: number[]): number => {
      const canal = (valor: number) => {
        const v = valor / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
    };
    const olho = luminancia(paraRgb(getComputedStyle(botao).color));
    const fundo = luminancia(paraRgb(getComputedStyle(campo).backgroundColor));
    return (Math.max(olho, fundo) + 0.05) / (Math.min(olho, fundo) + 0.05);
  });
}

test.describe("login", () => {
  test("o olho mostra e oculta a senha sem enviar nada", async ({ page }) => {
    await page.goto("/login");
    const posts = contarPosts(page);
    const senha = page.getByLabel("Senha", { exact: true });
    await senha.fill("uma-senha-qualquer");
    await expect(senha).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(senha).toHaveAttribute("type", "text");
    await expect(senha).toHaveValue("uma-senha-qualquer");
    const ocultar = page.getByRole("button", { name: "Ocultar senha" });
    await expect(ocultar).toBeVisible();
    await expect(ocultar).not.toHaveAttribute("aria-pressed", /.*/);
    await expect(ocultar).toHaveAttribute("aria-controls", "password");

    await ocultar.click();
    await expect(senha).toHaveAttribute("type", "password");
    await expect(senha).toHaveValue("uma-senha-qualquer");
    await expect(page).toHaveURL(/\/login$/);
    expect(posts).toEqual([]);
  });

  test("Tab do e-mail cai na senha e depois no olho", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Senha", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Mostrar senha" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Esqueci minha senha" }),
    ).toBeFocused();
  });

  test("Enter no campo de senha continua entrando, com a senha a mostra", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(dados().emails.admin);
    const senha = page.getByLabel("Senha", { exact: true });
    await senha.fill(E2E_SENHA);
    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await senha.press("Enter");
    await page.waitForURL(/\/(inicio|selecionar-clinica|atendimento)/);
  });

  for (const tema of ["claro", "escuro"] as const) {
    test(`o olho tem contraste no tema ${tema}`, async ({ page }) => {
      if (tema === "escuro") {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("theme", "dark");
          } catch {
            // sem armazenamento, o teste do tema escuro falha na conferencia
            // da classe logo abaixo
          }
        });
      }
      await page.goto("/login");
      if (tema === "escuro") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/dark/);
      }
      await expect(
        page.getByRole("button", { name: "Mostrar senha" }),
      ).toBeVisible();
      // Elemento grafico de controle: 3:1 (WCAG 1.4.11).
      expect(await contrasteDoOlho(page)).toBeGreaterThanOrEqual(3);
      const resultado = await new AxeBuilder({ page })
        .include("main form")
        .withRules(["color-contrast"])
        .analyze();
      expect(resultado.violations).toEqual([]);
    });
  }
});

test.describe("cadastro", () => {
  test("senhas diferentes param no navegador, sem criar conta", async ({
    page,
  }) => {
    await page.goto("/cadastro?tipo=clinica");
    const posts = contarPosts(page);
    await page.getByLabel("Nome da clínica").fill("Clínica e2e senha");
    await page.getByLabel("Seu nome").fill("Pessoa e2e");
    await page
      .getByLabel("E-mail")
      .fill("e2e-senha-nunca-enviado@exemplo.test");
    await page.getByLabel("Senha", { exact: true }).fill("senha-certa-123");
    const repita = page.getByLabel("Repita a senha", { exact: true });
    await repita.fill("senha-errada-123");

    await page.getByRole("button", { name: "Criar clínica e conta" }).click();

    await expect(page.getByText(SENHAS_DIFERENTES)).toBeVisible();
    await expect(repita).toHaveAttribute("aria-invalid", "true");
    await expect(repita).toBeFocused();
    await expect(page).toHaveURL(/\/cadastro\?tipo=clinica$/);
    expect(posts).toEqual([]);

    // Corrigir tira a mensagem na hora. Conferido sem enviar.
    await repita.fill("senha-certa-123");
    await expect(page.getByText(SENHAS_DIFERENTES)).toHaveCount(0);
    await expect(repita).not.toHaveAttribute("aria-invalid", /.*/);
    expect(
      await repita.evaluate(
        (campo) => (campo as HTMLInputElement).validity.valid,
      ),
    ).toBe(true);
    expect(posts).toEqual([]);
  });

  test("cada campo tem o seu olho", async ({ page }) => {
    await page.goto("/cadastro?tipo=clinica");
    const senha = page.getByLabel("Senha", { exact: true });
    const repita = page.getByLabel("Repita a senha", { exact: true });
    await senha.fill("senha-certa-123");
    await repita.fill("senha-certa-123");

    await page
      .getByRole("button", { name: "Mostrar a senha repetida" })
      .click();
    await expect(repita).toHaveAttribute("type", "text");
    await expect(senha).toHaveAttribute("type", "password");
    await expect(
      page.getByRole("button", { name: "Ocultar a senha repetida" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mostrar senha" }),
    ).toBeVisible();
  });
});

test.describe("redefinir senha", () => {
  test("senhas diferentes nao salvam nada", async ({ page }) => {
    await login(page, dados().emails.admin);
    await page.goto("/redefinir-senha");
    await expect(
      page.getByRole("heading", { name: "Redefinir senha" }),
    ).toBeVisible();
    const posts = contarPosts(page);

    await page.getByLabel("Nova senha", { exact: true }).fill("senha-nova-123");
    const repita = page.getByLabel("Repita a senha", { exact: true });
    await repita.fill("senha-nova-124");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();

    await expect(page.getByText(SENHAS_DIFERENTES)).toBeVisible();
    await expect(repita).toBeFocused();
    await expect(page).toHaveURL(/\/redefinir-senha$/);
    expect(posts).toEqual([]);
  });
});
