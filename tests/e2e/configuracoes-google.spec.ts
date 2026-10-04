import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// F1 do Google: aba "Anúncios do Google" de Configuracoes, com o cartao
// "Rastreio do site". Ligar e desligar pela sessao (update e, sem linha,
// insert), a linha do site com a chave do banco e o endereco de producao,
// "Gerar nova chave" com confirmacao (a chave antiga passa a dar
// chave_invalida), a situacao so com totais e o lead casado com a origem do
// Google. "Conectar com o Google (em breve)" fica visivel e desabilitado.
//
// NADA AQUI CHAMA O GOOGLE NEM A ROTA PUBLICA: os cliques entram pela funcao
// registrar_clique_do_site com o cliente de servico (o que a rota publica
// faz) e o casamento pela casar_clique_do_site (o que a ingestao faz). Tudo
// na Clinica E2E, que e so de teste: o estado do rastreio volta ao que era e
// os cliques e o contato criados saem no fim.
//
// O endereco da linha e o PUBLIC_APP_URL do servidor de desenvolvimento
// (process.env ou .env.local, a mesma precedencia do Next). Sem https (ou
// http em localhost), a tela nao monta a linha e avisa: o teste confere o
// caso que valer.
//
// Recepcao, profissional e leitura nem chegam em Configuracoes (o layout
// redireciona); o caso do papel leitura esta no fim.

const TITULO_DO_CARTAO = "Rastreio do site";
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CAMPANHA_DO_GOOGLE = "21987654321";
const FONE_DO_LEAD = "+5584970009310";
const NOME_DO_LEAD = "Gabriel Google E2E";
const SEM_ENDERECO =
  "O endereço público do sistema não está configurado, então a linha do site ainda não pode ser montada. Fale com o suporte.";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

function variavelDoServidor(nome: string): string | undefined {
  if (process.env[nome]) {
    return process.env[nome];
  }
  const caminho = join(process.cwd(), ".env.local");
  if (!existsSync(caminho)) {
    return undefined;
  }
  for (const linha of readFileSync(caminho, "utf-8").split("\n")) {
    const casamento = linha.match(/^([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (casamento?.[1] === nome && casamento[2]) {
      return casamento[2].trim();
    }
  }
  return undefined;
}

/**
 * A origem que a tela usa na linha, ou nula (a tela avisa): https, ou http
 * so em localhost (a regra de origemDoSistema do cartao).
 */
function origemEsperada(): string | null {
  const valor = variavelDoServidor("PUBLIC_APP_URL");
  if (!valor) {
    return null;
  }
  try {
    const url = new URL(valor);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.username || url.password) {
      return null;
    }
    return url.protocol === "https:" || (url.protocol === "http:" && local)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function codigoAleatorio(): string {
  return Array.from(
    { length: 6 },
    () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)],
  ).join("");
}

type LinhaDoRastreio = {
  clinic_id: string;
  chave: string;
  ativo: boolean;
  chave_trocada_em: string;
  ultimo_clique_em: string | null;
};

type EstadoAnterior = { linha: LinhaDoRastreio | null; inicio: string };

async function lerLinha(): Promise<LinhaDoRastreio | null> {
  return (
    await adminClient()
      .from("rastreio_do_site")
      .select("*")
      .eq("clinic_id", dados().clinicId)
      .maybeSingle()
      .throwOnError()
  ).data as LinhaDoRastreio | null;
}

async function lerEstadoAnterior(): Promise<EstadoAnterior> {
  return { linha: await lerLinha(), inicio: new Date().toISOString() };
}

async function apagarLeadDoTeste(): Promise<void> {
  // A cascata leva o clique casado junto (FK com on delete cascade).
  await adminClient()
    .from("contact")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("phone_e164", FONE_DO_LEAD)
    .throwOnError();
}

async function restaurar(anterior: EstadoAnterior): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  await apagarLeadDoTeste();
  await admin
    .from("clique_do_site")
    .delete()
    .eq("clinic_id", clinicId)
    .gte("criado_em", anterior.inicio);
  if (anterior.linha === null) {
    await admin.from("rastreio_do_site").delete().eq("clinic_id", clinicId);
  } else {
    await admin
      .from("rastreio_do_site")
      .upsert(anterior.linha, { onConflict: "clinic_id" });
  }
}

/**
 * Monta o rastreio pelo cliente de servico: nulo apaga a linha; senao cria
 * (ou deixa) a linha com o ativo pedido, sem clique registrado. Os cliques
 * da Clinica E2E (so de teste) saem, para os totais da tela serem os do
 * teste.
 */
async function montar(opcoes: { ativo: boolean } | null): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  await apagarLeadDoTeste();
  await admin
    .from("clique_do_site")
    .delete()
    .eq("clinic_id", clinicId)
    .throwOnError();
  if (opcoes === null) {
    await admin
      .from("rastreio_do_site")
      .delete()
      .eq("clinic_id", clinicId)
      .throwOnError();
    return;
  }
  await admin
    .from("rastreio_do_site")
    .upsert(
      { clinic_id: clinicId, ativo: opcoes.ativo, ultimo_clique_em: null },
      { onConflict: "clinic_id" },
    )
    .throwOnError();
}

function cartaoDoRastreio(page: Page): Locator {
  return page.getByRole("region", { name: TITULO_DO_CARTAO });
}

/** A regiao aria-live do resultado das acoes do cartao. */
function resultado(cartao: Locator): Locator {
  return cartao.locator('[aria-live="polite"]');
}

async function abrirAba(page: Page, email: string): Promise<Locator> {
  await login(page, email);
  await page.goto("/configuracoes?aba=google");
  await expect(
    page.getByRole("tab", { name: "Anúncios do Google" }),
  ).toHaveAttribute("aria-selected", "true");
  const cartao = cartaoDoRastreio(page);
  await expect(cartao).toBeVisible();
  return cartao;
}

async function verDica(
  page: Page,
  escopo: Locator,
  botao: string,
  texto: string,
): Promise<void> {
  await page.mouse.move(8, 8, { steps: 8 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await escopo
    .locator("span[tabindex='0']", {
      has: page.getByRole("button", { name: botao, exact: true }),
    })
    .hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: texto }),
  ).toBeVisible();
}

async function acoesNaTrilha(
  inicio: string,
): Promise<{ action: string; entity: string; entity_id: string }[]> {
  return (
    await adminClient()
      .from("audit_log")
      .select("action, entity, entity_id")
      .eq("clinic_id", dados().clinicId)
      .eq("entity", "rastreio_do_site")
      .gte("created_at", inicio)
      .order("created_at", { ascending: true })
      .throwOnError()
  ).data as { action: string; entity: string; entity_id: string }[];
}

test("sem linha: Desligado, ações presas com a dica; ligar cria a linha com a chave do banco e desligar mantém a linha", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  const origem = origemEsperada();
  try {
    await montar(null);
    const cartao = await abrirAba(page, dados().emails.admin);

    await expect(cartao).toContainText("Desligado");
    await expect(cartao).toContainText(
      "Ligue o rastreio para gerar a linha do site.",
    );
    await expect(cartao.locator("pre")).toHaveCount(0);
    await expect(
      cartao.getByRole("button", { name: "Copiar a linha", exact: true }),
    ).toBeDisabled();
    await expect(
      cartao.getByRole("button", { name: "Gerar nova chave", exact: true }),
    ).toBeDisabled();
    await verDica(
      page,
      cartao,
      "Copiar a linha",
      "Ligue o rastreio para gerar a linha do site.",
    );
    await verDica(
      page,
      cartao,
      "Gerar nova chave",
      "A chave nasce quando o rastreio é ligado pela primeira vez.",
    );

    // "Conectar com o Google (em breve)": visivel, desabilitado e com dica.
    const conectar = page.getByRole("button", {
      name: "Conectar com o Google",
      exact: true,
    });
    await expect(conectar).toBeVisible();
    await expect(conectar).toBeDisabled();
    await verDica(
      page,
      page.locator("body"),
      "Conectar com o Google",
      "Em breve.",
    );

    // Ligar: a linha nasce no banco com a chave e o estado espera o clique.
    const chave = cartao.getByRole("switch");
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await chave.click();
    await expect(cartao).toContainText("Esperando o primeiro clique");
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(cartao).toContainText("Rastreando os cliques do site");

    const linha = await lerLinha();
    expect(linha?.ativo).toBe(true);
    expect(linha?.chave).toMatch(/^[0-9a-f]{20}$/);
    if (origem) {
      await expect(cartao.locator("pre")).toHaveText(
        `<script src="${origem}/rastreio/v1.js" data-chave="${linha?.chave}" referrerpolicy="no-referrer" async></script>`,
      );
      await expect(
        cartao.getByRole("button", { name: "Copiar a linha", exact: true }),
      ).toBeEnabled();
    } else {
      await expect(cartao).toContainText(SEM_ENDERECO);
      await expect(
        cartao.getByRole("button", { name: "Copiar a linha", exact: true }),
      ).toBeDisabled();
    }
    await expect(
      cartao.getByRole("button", { name: "Gerar nova chave", exact: true }),
    ).toBeEnabled();

    // Desligar: a linha fica no banco. O aviso diz que nada e registrado,
    // mas que a linha no site continua pondo o codigo na mensagem.
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await expect(cartao).toContainText("Desligado");
    await expect(cartao).toContainText(
      "Com o rastreio desligado, nenhum clique é registrado, mas a linha que está no site continua acrescentando o código",
    );
    await expect(cartao).toContainText("Para parar de vez, tire a linha do site.");
    const desligada = await lerLinha();
    expect(desligada?.ativo).toBe(false);
    expect(desligada?.chave).toBe(linha?.chave);

    // A trilha: quem ligou e desligou, sem a chave.
    const trilha = await acoesNaTrilha(anterior.inicio);
    expect(trilha.map((t) => t.action)).toEqual([
      "ligou_rastreio_do_site",
      "desligou_rastreio_do_site",
    ]);
    expect(JSON.stringify(trilha)).not.toContain(linha?.chave ?? "?");
  } finally {
    await restaurar(anterior);
  }
});

test("gerar nova chave pede confirmação; cancelar mantém, confirmar troca e a chave antiga para de valer", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  const origem = origemEsperada();
  try {
    await montar({ ativo: true });
    const antiga = (await lerLinha())?.chave ?? "";
    expect(antiga).toMatch(/^[0-9a-f]{20}$/);
    const cartao = await abrirAba(page, dados().emails.admin);

    const gerar = cartao.getByRole("button", {
      name: "Gerar nova chave",
      exact: true,
    });
    const confirmacao = cartao.getByRole("group", {
      name: "Confirmar a troca da chave do rastreio",
    });

    // Teclado: a confirmacao recebe o foco ao aparecer (no grupo, nao no
    // botao de confirmar) e, ao cancelar, o foco volta ao "Gerar nova chave".
    await gerar.focus();
    await page.keyboard.press("Enter");
    await expect(confirmacao).toBeFocused();
    await expect(confirmacao).toContainText(
      "A linha que está no site para de valer na hora",
    );
    await page.keyboard.press("Tab");
    await expect(
      confirmacao.getByRole("button", { name: "Gerar a chave nova" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmacao.getByRole("button", { name: "Cancelar" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmacao).toHaveCount(0);
    await expect(gerar).toBeFocused();
    expect((await lerLinha())?.chave).toBe(antiga);

    // Confirmar troca a chave no banco e na tela.
    await gerar.click();
    await confirmacao
      .getByRole("button", { name: "Gerar a chave nova" })
      .click();
    await expect(resultado(cartao)).toContainText(
      "Chave nova gerada. Troque a linha no site: a anterior parou de valer.",
    );
    const nova = (await lerLinha())?.chave ?? "";
    expect(nova).toMatch(/^[0-9a-f]{20}$/);
    expect(nova).not.toBe(antiga);
    // A tela nova, pelo texto visivel. page.content() nao serve aqui: o
    // payload RSC do primeiro carregamento (com a chave antiga nas props do
    // cliente) fica nos <script> do DOM depois do revalidatePath, e o
    // textContent do body tambem os inclui (dai o useInnerText).
    if (origem) {
      await expect(cartao.locator("pre")).toContainText(`data-chave="${nova}"`);
      await expect(cartao.locator("pre")).not.toContainText(antiga);
    }
    await expect(page.locator("body")).not.toContainText(antiga, {
      useInnerText: true,
    });
    // Recarregar descarta aquele payload: dai, nenhum lugar do documento tem
    // a chave antiga. O cartao e um Locator, resolvido de novo na hora.
    await page.reload();
    await expect(cartao).toBeVisible();
    expect(await page.content()).not.toContain(antiga);
    // Continua ligado, e espera o primeiro clique com a chave nova.
    await expect(cartao).toContainText("Esperando o primeiro clique");

    // A chave antiga passa a dar chave_invalida (nada e gravado).
    const { data: respostaDaAntiga, error } = await adminClient().rpc(
      "registrar_clique_do_site",
      { p_chave: antiga, p_codigo: codigoAleatorio(), p_gclid: "E2E-antiga" },
    );
    expect(error).toBeNull();
    expect(respostaDaAntiga).toBe("chave_invalida");

    const trilha = await acoesNaTrilha(anterior.inicio);
    expect(trilha).toEqual([
      {
        action: "trocou_chave_do_rastreio",
        entity: "rastreio_do_site",
        entity_id: dados().clinicId,
      },
    ]);
  } finally {
    await restaurar(anterior);
  }
});

test("a situação mostra só totais, e o lead casado chega como Tráfego pago, Google pelo Clique no site", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const gclid = `E2E-gclid-${Date.now()}`;
  const codigos = [codigoAleatorio(), codigoAleatorio()];
  try {
    await montar({ ativo: true });
    const chave = (await lerLinha())?.chave ?? "";

    // Antes de qualquer clique: zero e "Nenhum clique recebido ainda".
    let cartao = await abrirAba(page, dados().emails.admin);
    await expect(cartao).toContainText("Nenhum clique recebido ainda");

    // Dois cliques pelo caminho da rota publica (service role).
    for (const codigo of codigos) {
      const { data, error } = await admin.rpc("registrar_clique_do_site", {
        p_chave: chave,
        p_codigo: codigo,
        p_gclid: gclid,
        p_google_campaign_id: CAMPANHA_DO_GOOGLE,
        p_google_adgroup_id: "1234567",
        p_site_host: "site-e2e.conduzza.test",
      });
      expect(error).toBeNull();
      expect(data).toBe("ok");
    }

    // Um deles chega ao WhatsApp: a ingestao casa o codigo com o contato.
    const contato = (
      await admin
        .from("contact")
        .insert({
          clinic_id: clinicId,
          phone_e164: FONE_DO_LEAD,
          name: NOME_DO_LEAD,
          kind: "lead",
          funnel_stage: "novo",
        })
        .select("id")
        .single()
        .throwOnError()
    ).data as { id: string };
    const { data: casou, error: erroDoCasamento } = await admin.rpc(
      "casar_clique_do_site",
      { p_clinic_id: clinicId, p_contact_id: contato.id, p_codigo: codigos[0] },
    );
    expect(erroDoCasamento).toBeNull();
    expect(casou).toBe("origem_gravada");

    await page.reload();
    cartao = cartaoDoRastreio(page);
    await expect(cartao).toContainText("Recebendo cliques");
    const totais = cartao.locator("dl");
    await expect(
      totais
        .locator("div", { hasText: "Cliques nos últimos 7 dias" })
        .locator("dd"),
    ).toHaveText("2");
    await expect(
      totais
        .locator("div", { hasText: "Chegaram ao WhatsApp nos últimos 7 dias" })
        .locator("dd"),
    ).toHaveText("1");
    await expect(
      totais
        .locator("div", { hasText: "Último clique recebido" })
        .locator("dd"),
    ).not.toHaveText("Nenhum clique recebido ainda");

    // So totais: nem o gclid, nem os codigos, nem quem clicou.
    const html = await page.content();
    expect(html).not.toContain(gclid);
    for (const codigo of codigos) {
      expect(html).not.toContain(codigo);
    }
    expect(html).not.toContain(NOME_DO_LEAD);

    // O lead: origem e metodo do Google no drawer.
    await page.goto("/leads?visao=lista");
    await page.getByRole("button", { name: `Abrir ${NOME_DO_LEAD}` }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Tráfego pago, Google");
    await expect(drawer).toContainText("Clique no site");
  } finally {
    await restaurar(anterior);
  }
});

// A campanha do Google no drawer: lib/queries/leads.ts le
// source_google_campaign_id (LEAD_SELECT), e a tela mostra o numero, nunca
// "Campanha do Google não informada" com o id gravado.
test("o drawer do lead do clique no site mostra Campanha do Google com o número", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const codigo = codigoAleatorio();
  try {
    await montar({ ativo: true });
    const chave = (await lerLinha())?.chave ?? "";
    const { data: registrou, error: erroDoRegistro } = await admin.rpc(
      "registrar_clique_do_site",
      {
        p_chave: chave,
        p_codigo: codigo,
        p_gclid: `E2E-gclid-${Date.now()}`,
        p_google_campaign_id: CAMPANHA_DO_GOOGLE,
      },
    );
    expect(erroDoRegistro).toBeNull();
    expect(registrou).toBe("ok");
    const contato = (
      await admin
        .from("contact")
        .insert({
          clinic_id: clinicId,
          phone_e164: FONE_DO_LEAD,
          name: NOME_DO_LEAD,
          kind: "lead",
          funnel_stage: "novo",
        })
        .select("id")
        .single()
        .throwOnError()
    ).data as { id: string };
    const { data: casou, error: erroDoCasamento } = await admin.rpc(
      "casar_clique_do_site",
      { p_clinic_id: clinicId, p_contact_id: contato.id, p_codigo: codigo },
    );
    expect(erroDoCasamento).toBeNull();
    expect(casou).toBe("origem_gravada");

    await login(page, dados().emails.admin);
    await page.goto("/leads?visao=lista");
    await page.getByRole("button", { name: `Abrir ${NOME_DO_LEAD}` }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(
      `Campanha do Google ${CAMPANHA_DO_GOOGLE}`,
    );
    await expect(drawer).not.toContainText("Campanha do Google não informada");
  } finally {
    await restaurar(anterior);
  }
});

test("último clique há mais de 7 dias: o chip sai do verde e avisa para conferir o site", async ({
  page,
}) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({ ativo: true });
    // O clique antigo veio com a chave atual (nasceu antes dele). So o
    // cliente de servico grava estas datas.
    const dia = 24 * 60 * 60 * 1000;
    await adminClient()
      .from("rastreio_do_site")
      .update({
        chave_trocada_em: new Date(Date.now() - 60 * dia).toISOString(),
        ultimo_clique_em: new Date(Date.now() - 10 * dia).toISOString(),
      })
      .eq("clinic_id", dados().clinicId)
      .throwOnError();

    const cartao = await abrirAba(page, dados().emails.admin);
    const chip = cartao.locator("[data-slot=card-action] span[data-size]");
    await expect(chip).toContainText("Sem cliques nos últimos 7 dias");
    await expect(chip.locator("svg")).toHaveCount(1);
    await expect(cartao).not.toContainText("Recebendo cliques");
    await expect(cartao).toContainText(
      "Nenhum clique chegou nos últimos 7 dias. Confira se a linha continua no site e se os anúncios do Google estão no ar.",
    );
  } finally {
    await restaurar(anterior);
  }
});

test("o gestor também liga, desliga e gera chave nova", async ({ page }) => {
  apenasDesktop();
  const anterior = await lerEstadoAnterior();
  try {
    await montar({ ativo: false });
    const cartao = await abrirAba(page, dados().emails.gestor);
    await expect(cartao.getByRole("switch")).toBeEnabled();
    await expect(
      cartao.getByRole("button", { name: "Gerar nova chave", exact: true }),
    ).toBeEnabled();
    await cartao.getByRole("switch").click();
    await expect(cartao).toContainText("Esperando o primeiro clique");
    expect((await lerLinha())?.ativo).toBe(true);
  } finally {
    await restaurar(anterior);
  }
});

test("o papel leitura não chega à aba: Configurações é só da gestão", async ({
  page,
}) => {
  apenasDesktop();
  await login(page, dados().emails.leitura);
  await page.goto("/configuracoes?aba=google");
  await page.waitForURL(/\/inicio/);
  await expect(
    page.getByRole("tab", { name: "Anúncios do Google" }),
  ).toHaveCount(0);
  await expect(cartaoDoRastreio(page)).toHaveCount(0);
});

/**
 * Razao de contraste entre a cor do texto do elemento e o fundo dele, com as
 * cores convertidas pelo proprio navegador (o tema usa oklch e color-mix).
 */
async function contrasteDoElemento(alvo: Locator): Promise<number> {
  return alvo.evaluate((no) => {
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
    const estilo = getComputedStyle(no);
    const texto = luminancia(paraRgb(estilo.color));
    const fundo = luminancia(paraRgb(estilo.backgroundColor));
    return (Math.max(texto, fundo) + 0.05) / (Math.min(texto, fundo) + 0.05);
  });
}

for (const tema of ["claro", "escuro"] as const) {
  test(`tema ${tema}: o chip tem as três camadas e contraste AA`, async ({
    page,
  }) => {
    apenasDesktop();
    const anterior = await lerEstadoAnterior();
    try {
      await montar({ ativo: true });
      if (tema === "escuro") {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("theme", "dark");
          } catch {
            // sem armazenamento, a conferencia da classe logo abaixo falha
          }
        });
      }
      const cartao = await abrirAba(page, dados().emails.admin);
      if (tema === "escuro") {
        await expect(page.locator("html")).toHaveClass(/dark/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/dark/);
      }
      const chip = cartao.locator("[data-slot=card-action] span[data-size]");
      // Forma (o icone), rotulo em texto e cor.
      await expect(chip).toContainText("Esperando o primeiro clique");
      await expect(chip.locator("svg")).toHaveCount(1);
      expect(await contrasteDoElemento(chip)).toBeGreaterThanOrEqual(4.5);
      if (origemEsperada()) {
        expect(
          await contrasteDoElemento(cartao.locator("pre")),
        ).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await restaurar(anterior);
    }
  });
}
