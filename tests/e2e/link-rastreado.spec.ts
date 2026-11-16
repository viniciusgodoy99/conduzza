import { expect, test } from "@playwright/test";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Link rastreado da origem (etapa 3a do plano de 16/11/2026, o link da bio
// com endereco proprio), no app de verdade e SEM SESSAO: quem toca no link
// nao esta logado. Confere o que a unidade e a integracao nao veem juntas: o
// middleware deixa l/ passar, a rota chama o banco e redireciona para o
// wa.me com o codigo do clique, e o link que nao serve cai na pagina de
// indisponivel (em portugues, nunca um erro).
//
// Usa uma clinica de teste propria (e_de_teste), apagada no afterAll.
// Depende da migration 20261116120000 aplicada.

const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";
const MENSAGEM = "Olá! Vi o perfil da clínica e quero agendar uma avaliação.";
const NAVEGADOR =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";

const admin = adminClient();
const sufixo = Date.now().toString(36);
let clinicId = "";
let codigoPublico = "";
let origemId = "";

test.beforeAll(async () => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "o link independe de viewport",
  );
  const { data: clinica } = await admin
    .from("clinic")
    .insert({
      name: `Link E2E ${sufixo}`,
      slug: `link-e2e-${sufixo}`,
      e_de_teste: true,
    })
    .select("id")
    .single()
    .throwOnError();
  clinicId = clinica!.id as string;
  await criarNumeroDeTeste(admin, clinicId, {
    display_phone: "+55 (84) 97777-0009",
  });
  const { data: origem } = await admin
    .from("campaign_link")
    .insert({
      clinic_id: clinicId,
      name: "Link da bio",
      token: "E2E7K3",
      channel: "redes_sociais",
      origin: "Instagram",
      default_message: MENSAGEM,
    })
    .select("id, codigo_publico")
    .single()
    .throwOnError();
  origemId = origem!.id as string;
  codigoPublico = origem!.codigo_publico as string;
});

test.afterAll(async () => {
  if (clinicId) {
    await admin.from("clinic").delete().eq("id", clinicId);
  }
});

test("sem sessao: o link grava o clique e manda ao WhatsApp com o codigo do clique", async ({
  request,
}) => {
  const resposta = await request.get(
    `${APP}/l/${codigoPublico}?utm_source=instagram&utm_medium=bio`,
    { maxRedirects: 0, headers: { "user-agent": NAVEGADOR } },
  );
  expect(resposta.status()).toBe(302);
  const destino = new URL(resposta.headers().location ?? "");
  expect(destino.origin + destino.pathname).toBe("https://wa.me/5584977770009");
  const texto = destino.searchParams.get("text") ?? "";
  const codigo = /\[#([23456789A-HJKMNP-Z]{6})\]$/.exec(texto)?.[1] ?? "";
  expect(texto).toBe(`${MENSAGEM} [#${codigo}]`);
  // E o codigo do clique, nao o fixo da origem.
  expect(codigo).not.toBe("E2E7K3");
  expect(resposta.headers()["cache-control"]).toBe("no-store");

  const { data: clique } = await admin
    .from("clique_do_site")
    .select("codigo, via, campaign_link_id, utm_source, utm_medium")
    .eq("clinic_id", clinicId)
    .single()
    .throwOnError();
  expect(clique).toEqual({
    codigo,
    via: "link",
    campaign_link_id: origemId,
    utm_source: "instagram",
    utm_medium: "bio",
  });
});

test("previa de link (robo) chega ao destino com o codigo fixo e nao conta clique", async ({
  request,
}) => {
  const antes = await admin
    .from("clique_do_site")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  const resposta = await request.get(`${APP}/l/${codigoPublico}`, {
    maxRedirects: 0,
    headers: { "user-agent": "WhatsApp/2.23.20.0 A" },
  });
  expect(resposta.status()).toBe(302);
  const destino = new URL(resposta.headers().location ?? "");
  expect(destino.searchParams.get("text")).toBe(`${MENSAGEM} [#E2E7K3]`);
  const depois = await admin
    .from("clique_do_site")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  expect(depois.count).toBe(antes.count);
});

test("link que nao existe: a pagina de indisponivel, em portugues e sem login", async ({
  page,
}) => {
  await page.goto(`${APP}/l/22222222`);
  await expect(page).toHaveURL(`${APP}/l/indisponivel`);
  await expect(
    page.getByRole("heading", { name: "Este link não está disponível" }),
  ).toBeVisible();
  // Nada de tela de login nem de erro do framework.
  await expect(page.getByText("Entrar", { exact: true })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// A tela: o bloco "Link rastreado" e o QR Code (etapa 4), com sessao
// ---------------------------------------------------------------------------

test.describe("aba Origem dos leads", () => {
  const NOME = `Bio E2E ${sufixo}`;
  let codigoDaTela = "";
  let origemDaTela = "";

  test.beforeAll(async () => {
    const { data } = await admin
      .from("campaign_link")
      .insert({
        clinic_id: dados().clinicId,
        name: NOME,
        token: "E2E8M4",
        channel: "redes_sociais",
        default_message: MENSAGEM,
      })
      .select("id, codigo_publico")
      .single()
      .throwOnError();
    origemDaTela = data!.id as string;
    codigoDaTela = data!.codigo_publico as string;
  });

  test.afterAll(async () => {
    if (origemDaTela) {
      await admin.from("campaign_link").delete().eq("id", origemDaTela);
    }
  });

  test("mostra o link rastreado com a contagem, e o QR Code leva o mesmo link e baixa em PNG", async ({
    page,
  }) => {
    await login(page, dados().emails.admin);
    await page.goto("/configuracoes?aba=origem");

    const bloco = page
      .getByRole("group", { name: "Link rastreado" })
      .filter({ hasText: codigoDaTela });
    await expect(bloco).toContainText(`/l/${codigoDaTela}`);
    await expect(bloco).toContainText("0 cliques e 0 leads nos últimos 30 dias");
    const link = (await bloco.locator("p.select-all").first().textContent()) ?? "";
    expect(link.endsWith(`/l/${codigoDaTela}`)).toBe(true);

    await page
      .getByRole("button", { name: `Ver QR Code de ${NOME}` })
      .click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toContainText("QR Code do link rastreado");
    const codigo = dialogo.getByRole("img", {
      name: `QR Code do link rastreado de ${NOME}`,
    });
    await expect(codigo).toBeVisible();

    // O QR Code tem de dizer exatamente o link. O leitor do proprio navegador
    // (BarcodeDetector) nao existe em todo Chromium: quando existe, confere.
    const lido = await codigo.evaluate(async (canvas) => {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (opcoes: { formats: string[] }) => {
            detect: (alvo: Element) => Promise<{ rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        return null;
      }
      try {
        const achados = await new Detector({ formats: ["qr_code"] }).detect(
          canvas,
        );
        return achados[0]?.rawValue ?? "nada lido";
      } catch {
        return null;
      }
    });
    test.info().annotations.push({
      type: "qr",
      description: lido === null ? "sem leitor no navegador" : `lido: ${lido}`,
    });
    if (lido !== null) {
      expect(lido).toBe(link);
    }

    const baixando = page.waitForEvent("download");
    await dialogo.getByRole("button", { name: "Baixar PNG" }).click();
    const arquivo = await baixando;
    expect(arquivo.suggestedFilename()).toBe(
      `qr-bio-e2e-${sufixo.toLowerCase()}.png`,
    );
    if (process.env.FOTO_DO_QR) {
      await arquivo.saveAs(`${process.env.FOTO_DO_QR}/qr-baixado.png`);
      await page.screenshot({
        path: `${process.env.FOTO_DO_QR}/qr-dialogo-claro.png`,
      });
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
      await page.reload();
      await bloco.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${process.env.FOTO_DO_QR}/aba-origem-escuro.png`,
      });
      await page.evaluate(() => window.localStorage.setItem("theme", "light"));
      await page.reload();
      await bloco.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${process.env.FOTO_DO_QR}/aba-origem-claro.png`,
      });
    }
  });
});
