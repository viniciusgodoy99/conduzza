import {
  expect,
  test,
  type Page,
  type Response as RespostaDaRede,
} from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";

// Rastreio do site (F1 do Google) num Chromium de verdade, ponta a ponta:
// o site da clinica (uma pagina servida pelo PROPRIO teste, em outra origem),
// a linha de script carregada do servidor de desenvolvimento, o clique no
// link do WhatsApp (interceptado: nada sai para o WhatsApp de verdade) e o
// aviso chegando na rota publica e virando linha em clique_do_site.
//
// O que se prova:
// - /rastreio/v1.js e /api/publico/clique respondem SEM sessao (o matcher de
//   middleware.ts exclui os dois; sem isso, redirecionariam para /login);
// - com gclid, o codigo vai no texto do wa.me e o clique chega ao banco com
//   o host do site e a campanha;
// - sem sinal do Google, o link fica intacto e nada e avisado;
// - o sinal da pagina do anuncio vale na pagina seguinte (sessionStorage);
// - o sinal guardado e da chave: a pagina de OUTRA clinica no mesmo site
//   (mesma origem, mesma aba) nao leva o anuncio da primeira;
// - com sessionStorage bloqueado, o link continua funcionando;
// - frases da clinica (04/10/2026): o link sem texto pronto leva a frase que
//   a clinica cadastrou, o script sorteia entre duas, e se a busca das
//   frases falhar vai a frase de fabrica. A rota GET das frases responde sem
//   sessao, so as frases, e 404 sem corpo para chave que nao serve.
//
// Banco: a suite roda no banco de operacao real (global-setup.ts). Este
// arquivo liga o rastreio da clinica E2E, troca as frases dela e, no fim,
// apaga os cliques que criou e devolve o rastreio (ligado e frases) como
// estava. Precisa das migrations 20261005100000_clique_do_site e
// 20261005110000_frases_do_rastreio aplicadas. Roda so no desktop-1600.
//
// Por que 127.0.0.1 para o site e localhost para o sistema: sao origens
// diferentes (o aviso e entre sites, como na clinica de verdade) e as duas
// sao loopback, entao o Chromium nao bloqueia o pedido do site ao sistema
// como acesso a rede privada.

// O endereco do app vem do ambiente (E2E_APP_URL) quando a suite roda em
// outra porta; o padrao e o do playwright.config.ts. O "site da clinica" e o
// mesmo servidor por 127.0.0.1, para ser outra origem.
const APP = process.env.E2E_APP_URL ?? "http://localhost:3000";
const SITE = APP.replace("localhost", "127.0.0.1");
const PAGINAS_DO_SITE = new RegExp(
  `^${SITE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/site-de-teste/`,
);
const WHATSAPP = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//;
/** A rota GET das frases (no sistema, nao no site). */
const ROTA_DAS_FRASES = new RegExp(
  `^${APP.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/api/publico/rastreio/`,
);

const WA = "https://wa.me/5584999990000?text=Quero%20agendar";
const WA_SEM_TEXTO = "https://wa.me/5584999990000";
// Pagina de outra clinica do Conduzza no MESMO site (agencia com varias
// clinicas no mesmo dominio). Chave no formato, mas de clinica nenhuma: se o
// script dela avisasse, o banco responderia chave_invalida; o teste prova que
// ela nem chega a avisar.
const PAGINA_DE_OUTRA_CLINICA = "/site-de-teste/outra-clinica/";
const CHAVE_DE_OUTRA_CLINICA = "ffffffffffffffffffff";

// Mesmos formatos de lib/domain/rastreio-do-site.ts (a suite e2e nao importa
// codigo da aplicacao).
const CODIGO_NO_TEXTO = / \[#([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6})\]$/;
// FRASE_PADRAO de lib/domain/rastreio-do-site.ts e default da coluna no banco.
const FRASE_PADRAO = "Olá! Vim pelo site e gostaria de agendar uma consulta.";
const FRASE_DA_CLINICA =
  "Oi! Vi o anúncio no site. Quero marcar uma avaliação, pode ser à tarde?";
const OUTRA_FRASE = "Bom dia! Gostaria de saber os horários & valores.";

let chave = "";
let rastreioAntes: { ativo: boolean; frases: string[] } | null = null;
// So desfaz o que este arquivo fez: se o beforeAll falhar antes de ligar, o
// afterAll nao mexe no rastreio da clinica.
let liguei = false;

test.beforeAll(async () => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "rastreio independe de viewport",
  );
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const antes = await admin
    .from("rastreio_do_site")
    .select("ativo, frases")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (antes.error) {
    throw new Error(
      `rastreio_do_site ilegivel (${antes.error.code}): as migrations 20261005100000 e 20261005110000 foram aplicadas?`,
    );
  }
  rastreioAntes =
    (antes.data as { ativo: boolean; frases: string[] } | null) ?? null;
  const ligar = rastreioAntes
    ? await admin
        .from("rastreio_do_site")
        .update({ ativo: true })
        .eq("clinic_id", clinicId)
    : await admin
        .from("rastreio_do_site")
        .insert({ clinic_id: clinicId, ativo: true });
  if (ligar.error) {
    throw new Error(
      `nao liguei o rastreio da clinica E2E (${ligar.error.code})`,
    );
  }
  liguei = true;
  const linha = await admin
    .from("rastreio_do_site")
    .select("chave")
    .eq("clinic_id", clinicId)
    .single();
  chave = (linha.data as { chave: string } | null)?.chave ?? "";
  expect(chave).toMatch(/^[0-9a-f]{20}$/);
});

test.afterAll(async () => {
  if (!liguei) {
    return;
  }
  const admin = adminClient();
  const clinicId = dados().clinicId;
  // A clinica E2E e da suite: todos os cliques dela sao deste arquivo.
  await admin.from("clique_do_site").delete().eq("clinic_id", clinicId);
  if (rastreioAntes) {
    await admin
      .from("rastreio_do_site")
      .update({ ativo: rastreioAntes.ativo, frases: rastreioAntes.frases })
      .eq("clinic_id", clinicId);
  } else {
    await admin.from("rastreio_do_site").delete().eq("clinic_id", clinicId);
  }
});

/** Grava as frases da clinica E2E (service role, como a acao gravaria). */
async function gravarFrases(frases: string[]): Promise<void> {
  const { error } = await adminClient()
    .from("rastreio_do_site")
    .update({ frases })
    .eq("clinic_id", dados().clinicId);
  if (error) {
    throw new Error(`nao gravei as frases da clinica E2E (${error.code})`);
  }
}

/**
 * Espera o script receber as frases (a busca sai logo que ele carrega) e
 * terminar de ler a resposta. Registrar ANTES do goto.
 */
async function esperarFrases(
  page: Page,
  pronta: Promise<RespostaDaRede>,
): Promise<void> {
  const resposta = await pronta;
  expect(resposta.status()).toBe(200);
  await resposta.finished();
  // O .then do script roda depois da resposta: uma volta no navegador.
  await page.evaluate(() => new Promise((fim) => setTimeout(fim, 100)));
}

function paginaDoSite(chaveDoSite: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8"><title>Clinica de teste</title></head>
  <body>
    <a id="whatsapp" href="${WA}">Falar no WhatsApp</a>
    <a id="whatsapp-sem-texto" href="${WA_SEM_TEXTO}"><span>WhatsApp</span></a>
    <a id="servicos" href="/site-de-teste/servicos">Servicos</a>
    <a id="outra-clinica" href="${PAGINA_DE_OUTRA_CLINICA}">Outra clinica</a>
    <script src="${APP}/rastreio/v1.js" data-chave="${chaveDoSite}" referrerpolicy="no-referrer" async></script>
  </body>
</html>`;
}

type Aviso = { url: string; corpo: string };

/**
 * Monta o site falso e o WhatsApp falso na pagina e devolve a lista dos
 * avisos que o script mandou. O sendBeacon original continua sendo chamado
 * (o aviso chega de verdade na rota); a copia so serve para o teste ler o
 * corpo mesmo depois de a pagina navegar para o WhatsApp.
 */
async function prepararSite(page: Page): Promise<Aviso[]> {
  // O Chromium novo (Local Network Access) bloqueia a pagina em 127.0.0.1 de
  // carregar o script de localhost sem permissao. Isso so acontece no teste,
  // onde site e sistema sao enderecos locais; no site real da clinica, que e
  // publico, carregando o script do sistema, nao ha esse bloqueio. Navegador
  // que nao conhece a permissao ignora.
  await page
    .context()
    .grantPermissions(["local-network-access"])
    .catch(() => undefined);
  const avisos: Aviso[] = [];
  await page.exposeFunction(
    "__avisoDoRastreio",
    (url: string, corpo: string) => {
      avisos.push({ url, corpo });
    },
  );
  await page.addInitScript(() => {
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, corpo?: BodyInit | null) => {
      try {
        (
          window as unknown as {
            __avisoDoRastreio: (u: string, c: string) => void;
          }
        ).__avisoDoRastreio(String(url), String(corpo));
      } catch {
        // so a copia do teste falha; o aviso de verdade segue abaixo
      }
      return original(url, corpo);
    };
  });
  await page.route(PAGINAS_DO_SITE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: paginaDoSite(
        new URL(route.request().url()).pathname === PAGINA_DE_OUTRA_CLINICA
          ? CHAVE_DE_OUTRA_CLINICA
          : chave,
      ),
    }),
  );
  await page.route(WHATSAPP, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>WhatsApp falso</title><p>WhatsApp falso</p>",
    }),
  );
  return avisos;
}

/** Clica no link e devolve o endereco que o navegador abriu. */
async function clicarNoWhatsApp(page: Page, seletor: string): Promise<string> {
  const pedido = page.waitForRequest(WHATSAPP);
  await page.locator(seletor).click();
  return (await pedido).url();
}

function textoDoLink(endereco: string): string {
  return new URL(endereco).searchParams.get("text") ?? "";
}

async function cliqueNoBanco(codigo: string) {
  let linha: Record<string, unknown> | null = null;
  await expect
    .poll(
      async () => {
        const { data } = await adminClient()
          .from("clique_do_site")
          .select(
            "codigo, gclid, gbraid, wbraid, gad_source, google_campaign_id, google_adgroup_id, site_host, contact_id",
          )
          .eq("clinic_id", dados().clinicId)
          .eq("codigo", codigo)
          .maybeSingle();
        linha = (data as Record<string, unknown> | null) ?? null;
        return linha !== null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return linha as unknown as Record<string, unknown>;
}

test.describe("rota e script sem sessao", () => {
  test("o script responde 200, sem redirecionar para /login", async ({
    request,
  }) => {
    const resposta = await request.get(`${APP}/rastreio/v1.js`, {
      maxRedirects: 0,
    });
    expect(resposta.status()).toBe(200);
    expect(resposta.headers()["content-type"] ?? "").toMatch(/javascript/);
    expect(await resposta.text()).toContain("api/publico/clique");
  });

  test("a rota responde 204 a qualquer corpo e ao OPTIONS", async ({
    request,
  }) => {
    const lixo = await request.post(`${APP}/api/publico/clique`, {
      headers: { "content-type": "text/plain" },
      data: "nao e json",
      maxRedirects: 0,
    });
    expect(lixo.status()).toBe(204);

    const grande = await request.post(`${APP}/api/publico/clique`, {
      headers: { "content-type": "text/plain" },
      data: JSON.stringify({
        chave,
        codigo: "K7Q2MX",
        gclid: "a".repeat(4000),
      }),
      maxRedirects: 0,
    });
    expect(grande.status()).toBe(204);

    const pergunta = await request.fetch(`${APP}/api/publico/clique`, {
      method: "OPTIONS",
      maxRedirects: 0,
    });
    expect(pergunta.status()).toBe(204);
    expect(pergunta.headers()["access-control-allow-origin"]).toBe("*");
  });
});

test.describe("rota das frases sem sessao", () => {
  test("200 so com as frases da chave ligada; 404 sem corpo para chave que nao serve", async ({
    request,
  }) => {
    await gravarFrases([FRASE_DA_CLINICA, OUTRA_FRASE]);
    const resposta = await request.get(`${APP}/api/publico/rastreio/${chave}`, {
      maxRedirects: 0,
    });
    expect(resposta.status()).toBe(200);
    expect(await resposta.json()).toEqual({
      frases: [FRASE_DA_CLINICA, OUTRA_FRASE],
    });
    expect(resposta.headers()["cache-control"]).toBe("public, max-age=300");
    expect(resposta.headers()["access-control-allow-origin"]).toBe("*");
    expect(resposta.headers()["set-cookie"]).toBeUndefined();

    for (const chaveRuim of [
      CHAVE_DE_OUTRA_CLINICA,
      chave.toUpperCase(),
      "slug-da-clinica",
    ]) {
      const ruim = await request.get(
        `${APP}/api/publico/rastreio/${chaveRuim}`,
        { maxRedirects: 0 },
      );
      expect(ruim.status(), chaveRuim).toBe(404);
      expect(await ruim.text(), chaveRuim).toBe("");
      expect(ruim.headers()["cache-control"]).toBe("no-store");
    }

    const pergunta = await request.fetch(
      `${APP}/api/publico/rastreio/${chave}`,
      { method: "OPTIONS", maxRedirects: 0 },
    );
    expect(pergunta.status()).toBe(204);
    expect(pergunta.headers()["access-control-allow-origin"]).toBe("*");
  });

  test("rastreio desligado: 404 sem corpo, igual a chave que nao existe", async ({
    request,
  }) => {
    const admin = adminClient();
    const clinicId = dados().clinicId;
    await admin
      .from("rastreio_do_site")
      .update({ ativo: false })
      .eq("clinic_id", clinicId)
      .throwOnError();
    try {
      const resposta = await request.get(
        `${APP}/api/publico/rastreio/${chave}`,
        { maxRedirects: 0 },
      );
      expect(resposta.status()).toBe(404);
      expect(await resposta.text()).toBe("");
    } finally {
      await admin
        .from("rastreio_do_site")
        .update({ ativo: true })
        .eq("clinic_id", clinicId)
        .throwOnError();
    }
  });
});

test.describe("site da clinica", () => {
  test("com gclid, o codigo vai no texto e o clique chega ao banco", async ({
    page,
  }) => {
    const avisos = await prepararSite(page);
    await page.goto(
      `${SITE}/site-de-teste/?gclid=E2Eteste_gclid-1&gad_campaignid=111&cz_campanha=222&cz_grupo=333`,
    );
    const endereco = await clicarNoWhatsApp(page, "#whatsapp");

    const texto = textoDoLink(endereco);
    const codigo = CODIGO_NO_TEXTO.exec(texto)?.[1] ?? "";
    expect(texto).toBe(`Quero agendar [#${codigo}]`);
    expect(endereco.startsWith("https://wa.me/5584999990000?text=")).toBe(true);

    await expect.poll(() => avisos.length).toBe(1);
    expect(avisos[0]?.url).toBe(`${APP}/api/publico/clique`);
    expect(JSON.parse(avisos[0]?.corpo ?? "{}")).toEqual({
      chave,
      codigo,
      gclid: "E2Eteste_gclid-1",
      gad_campaignid: "111",
      cz_campanha: "222",
      cz_grupo: "333",
    });

    const linha = await cliqueNoBanco(codigo);
    expect(linha).toMatchObject({
      gclid: "E2Eteste_gclid-1",
      gbraid: null,
      wbraid: null,
      gad_source: null,
      // cz_campanha vence gad_campaignid.
      google_campaign_id: "222",
      google_adgroup_id: "333",
      site_host: "127.0.0.1",
      contact_id: null,
    });
  });

  test("sem sinal do Google, o link fica intacto e nada e avisado", async ({
    page,
  }) => {
    const avisos = await prepararSite(page);
    await page.goto(`${SITE}/site-de-teste/?utm_source=instagram`);
    const endereco = await clicarNoWhatsApp(page, "#whatsapp");
    expect(endereco).toBe(WA);
    // Tempo para um aviso indevido aparecer, se existisse.
    await page.waitForTimeout(500);
    expect(avisos).toHaveLength(0);
  });

  test("link sem texto pronto, com as frases de fabrica: a frase padrao com o codigo", async ({
    page,
  }) => {
    await gravarFrases([FRASE_PADRAO]);
    await prepararSite(page);
    const pronta = page.waitForResponse(ROTA_DAS_FRASES);
    await page.goto(`${SITE}/site-de-teste/?gad_source=1&gad_campaignid=444`);
    await esperarFrases(page, pronta);
    const endereco = await clicarNoWhatsApp(page, "#whatsapp-sem-texto span");
    const texto = textoDoLink(endereco);
    const codigo = CODIGO_NO_TEXTO.exec(texto)?.[1] ?? "";
    expect(texto).toBe(`${FRASE_PADRAO} [#${codigo}]`);
    const linha = await cliqueNoBanco(codigo);
    expect(linha).toMatchObject({
      gclid: null,
      gad_source: "1",
      google_campaign_id: "444",
    });
  });

  test("o sinal da pagina do anuncio vale na pagina seguinte", async ({
    page,
  }) => {
    const avisos = await prepararSite(page);
    await page.goto(`${SITE}/site-de-teste/?gbraid=E2Egbraid_1`);
    await page.locator("#servicos").click();
    await page.waitForURL(`${SITE}/site-de-teste/servicos`);
    const endereco = await clicarNoWhatsApp(page, "#whatsapp");
    const codigo = CODIGO_NO_TEXTO.exec(textoDoLink(endereco))?.[1] ?? "";
    expect(codigo).not.toBe("");
    await expect.poll(() => avisos.length).toBe(1);
    expect(JSON.parse(avisos[0]?.corpo ?? "{}")).toMatchObject({
      codigo,
      gbraid: "E2Egbraid_1",
    });
    expect(await cliqueNoBanco(codigo)).toMatchObject({
      gbraid: "E2Egbraid_1",
    });
  });

  test("a pagina de outra clinica no mesmo site nao leva o anuncio da primeira", async ({
    page,
  }) => {
    expect(chave).not.toBe(CHAVE_DE_OUTRA_CLINICA);
    const avisos = await prepararSite(page);
    await page.goto(
      `${SITE}/site-de-teste/?gclid=E2Eteste_outra&gad_campaignid=555`,
    );
    await page.locator("#outra-clinica").click();
    await page.waitForURL(`${SITE}${PAGINA_DE_OUTRA_CLINICA}`);
    const endereco = await clicarNoWhatsApp(page, "#whatsapp");
    expect(endereco).toBe(WA);
    await page.waitForTimeout(500);
    expect(avisos).toHaveLength(0);

    // Controle: o script roda na pagina da outra clinica e, com sinal na
    // propria URL, age com a propria chave e o proprio sinal (o banco recusa
    // a chave falsa com chave_invalida e nada e gravado).
    await page.goto(`${SITE}${PAGINA_DE_OUTRA_CLINICA}?gclid=E2Eteste_deB`);
    const comSinal = await clicarNoWhatsApp(page, "#whatsapp");
    expect(textoDoLink(comSinal)).toMatch(CODIGO_NO_TEXTO);
    await expect.poll(() => avisos.length).toBe(1);
    expect(JSON.parse(avisos[0]?.corpo ?? "{}")).toMatchObject({
      chave: CHAVE_DE_OUTRA_CLINICA,
      gclid: "E2Eteste_deB",
    });
    expect(avisos[0]?.corpo).not.toContain("E2Eteste_outra");
  });

  test("a frase da clinica vai no link sem texto pronto, e o clique chega ao banco", async ({
    page,
  }) => {
    await gravarFrases([FRASE_DA_CLINICA]);
    const avisos = await prepararSite(page);
    const pronta = page.waitForResponse(ROTA_DAS_FRASES);
    await page.goto(`${SITE}/site-de-teste/?gclid=E2Eteste_frase-1`);
    await esperarFrases(page, pronta);
    const endereco = await clicarNoWhatsApp(page, "#whatsapp-sem-texto span");
    expect(endereco.startsWith(`${WA_SEM_TEXTO}?text=`)).toBe(true);
    const texto = textoDoLink(endereco);
    const codigo = CODIGO_NO_TEXTO.exec(texto)?.[1] ?? "";
    expect(texto).toBe(`${FRASE_DA_CLINICA} [#${codigo}]`);
    await expect.poll(() => avisos.length).toBe(1);
    expect(await cliqueNoBanco(codigo)).toMatchObject({
      gclid: "E2Eteste_frase-1",
    });
  });

  test("link com texto pronto: a frase da clinica nao entra", async ({
    page,
  }) => {
    await gravarFrases([FRASE_DA_CLINICA]);
    await prepararSite(page);
    const pronta = page.waitForResponse(ROTA_DAS_FRASES);
    await page.goto(`${SITE}/site-de-teste/?gclid=E2Eteste_frase-2`);
    await esperarFrases(page, pronta);
    const endereco = await clicarNoWhatsApp(page, "#whatsapp");
    const texto = textoDoLink(endereco);
    const codigo = CODIGO_NO_TEXTO.exec(texto)?.[1] ?? "";
    expect(texto).toBe(`Quero agendar [#${codigo}]`);
  });

  test("com duas frases, o script sorteia uma por clique", async ({ page }) => {
    await gravarFrases([FRASE_DA_CLINICA, OUTRA_FRASE]);
    await prepararSite(page);
    // Os cliques deste teste nao vao ao banco (o aviso para aqui): sao 24 e
    // o banco limita 30 por minuto por clinica, o que derrubaria os outros
    // testes. O que se prova aqui e so o texto do link.
    await page.addInitScript(() => {
      navigator.sendBeacon = () => true;
    });
    const pronta = page.waitForResponse(ROTA_DAS_FRASES);
    await page.goto(`${SITE}/site-de-teste/?gclid=E2Eteste_sorteio`);
    await esperarFrases(page, pronta);
    // Segura a navegacao DEPOIS do script (ele ouve na captura; este ouvinte
    // e da fase de bolha) e guarda o endereco que o navegador abriria.
    await page.evaluate(() => {
      const enderecos: string[] = [];
      (window as unknown as { __enderecos: string[] }).__enderecos = enderecos;
      document.addEventListener("click", (evento) => {
        const alvo = evento.target as Element | null;
        const link = alvo?.closest("a");
        if (link?.id === "whatsapp-sem-texto") {
          evento.preventDefault();
          enderecos.push(link.href);
        }
      });
    });
    for (let vez = 0; vez < 24; vez++) {
      await page.locator("#whatsapp-sem-texto span").click();
    }
    const enderecos = await page.evaluate(
      () => (window as unknown as { __enderecos: string[] }).__enderecos,
    );
    expect(enderecos).toHaveLength(24);
    const frases = new Set<string>();
    const codigos = new Set<string>();
    for (const endereco of enderecos) {
      const texto = textoDoLink(endereco);
      const codigo = CODIGO_NO_TEXTO.exec(texto)?.[1] ?? "";
      expect(codigo).not.toBe("");
      codigos.add(codigo);
      frases.add(texto.slice(0, -` [#${codigo}]`.length));
    }
    // Um codigo novo por clique e, em 24 cliques, as duas frases (a chance
    // de uma nao sair e de 2 em 16 milhoes).
    expect(codigos.size).toBe(24);
    expect([...frases].sort()).toEqual([FRASE_DA_CLINICA, OUTRA_FRASE].sort());
  });

  test("se a busca das frases falha, vai a frase de fabrica e o link funciona", async ({
    page,
  }) => {
    await gravarFrases([FRASE_DA_CLINICA]);
    const avisos = await prepararSite(page);
    await page.route(ROTA_DAS_FRASES, (route) => route.abort("failed"));
    const falhou = page.waitForEvent("requestfailed", (pedido) =>
      ROTA_DAS_FRASES.test(pedido.url()),
    );
    await page.goto(`${SITE}/site-de-teste/?gclid=E2Eteste_frase-falha`);
    await falhou;
    await page.evaluate(() => new Promise((fim) => setTimeout(fim, 100)));
    const endereco = await clicarNoWhatsApp(page, "#whatsapp-sem-texto span");
    const texto = textoDoLink(endereco);
    const codigo = CODIGO_NO_TEXTO.exec(texto)?.[1] ?? "";
    expect(texto).toBe(`${FRASE_PADRAO} [#${codigo}]`);
    expect(texto).not.toContain(FRASE_DA_CLINICA);
    // O aviso do clique nao depende da busca das frases.
    await expect.poll(() => avisos.length).toBe(1);
    expect(await cliqueNoBanco(codigo)).toMatchObject({
      gclid: "E2Eteste_frase-falha",
    });
  });

  test.describe("com sessionStorage bloqueado", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          get() {
            throw new DOMException("bloqueado", "SecurityError");
          },
        });
      });
    });

    test("com gclid, o link funciona e leva o codigo", async ({ page }) => {
      await prepararSite(page);
      await page.goto(`${SITE}/site-de-teste/?gclid=E2Eteste_bloqueado`);
      const endereco = await clicarNoWhatsApp(page, "#whatsapp");
      expect(textoDoLink(endereco)).toMatch(CODIGO_NO_TEXTO);
    });

    test("sem gclid, o link funciona intacto", async ({ page }) => {
      const avisos = await prepararSite(page);
      await page.goto(`${SITE}/site-de-teste/`);
      const endereco = await clicarNoWhatsApp(page, "#whatsapp");
      expect(endereco).toBe(WA);
      await page.waitForTimeout(500);
      expect(avisos).toHaveLength(0);
    });
  });
});
