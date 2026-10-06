import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Mensagem agendada na conversa (desenho revisado de 06/10/2026, secoes 4.1
// a 4.6, com A1 a A5 do desenho final): agendar pelo compositor e ver na
// lista acima da caixa de escrever; editar; excluir com confirmacao (o foco
// volta para a caixa quando a lista esvazia); enviar agora ate a bolha;
// Somente leitura ve as acoes desabilitadas com a dica; a lista aberta em
// 1366px nao espreme o fio; axe da lista e do dialogo nos temas claro e
// escuro.
//
// Correcoes da revisao de 06/10/2026: a agendada nao esta mais no tempo real
// (a lista rele com o evento de mensagem da conversa aberta, F9); fechada,
// ela mostra o aviso de quem escreveu depois (F6) com teto de altura (F8); o
// dialogo nao fecha com Esc no meio do agendamento (F20); e a falha de rede
// no Enviar agora rele a lista antes de devolver o texto (F17).
//
// O spec cria o proprio contato, a propria conversa (com a recepcao, e com
// autorizacao) e limpa no fim (o contato leva as agendadas em cascata). Nao
// muta o seed. As agendadas montadas direto no banco entram pelo service
// role: o gatilho deixa o sistema gravar (auth.uid() nulo).

const suffix = Date.now().toString(36);
const DIGITOS = Date.now().toString().slice(-6);
const PHONE = `+5584917${DIGITOS}`;
const CONTACT_NAME = `Paciente Agendada ${suffix}`;
const PRIMEIRA_FALA = "Oi, queria lembrar do meu retorno";
const TEXTO_AGENDADO = `Bom dia! Passando para lembrar do seu retorno. ${suffix}`;
const TEXTO_EDITADO = `Bom dia! Seu retorno é amanhã às 10h30. ${suffix}`;
const TEXTO_AGORA = `Mensagem para sair agora. ${suffix}`;
const SO_ACOMPANHA = "Seu perfil acompanha o atendimento, sem responder.";

const admin = adminClient();
let conversationId = "";
let contactId = "";
let recepcaoId = "";

// So os dois projetos que rodam algum teste daqui montam a conversa.
const PROJETOS_DO_SPEC = ["desktop-1600", "desktop-1366"];

test.beforeAll(async () => {
  if (!PROJETOS_DO_SPEC.includes(test.info().project.name)) {
    return;
  }
  const clinicId = dados().clinicId;
  const ingest = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `agendada:${suffix}:1`,
    p_content_type: "texto",
    p_body: PRIMEIRA_FALA,
    p_whatsapp_account_id: dados().whatsappAccountId,
  });
  expect(ingest.error).toBeNull();
  const resultado = ingest.data as {
    conversation_id: string;
    contact_id: string;
  };
  conversationId = resultado.conversation_id;
  contactId = resultado.contact_id;

  const { data: recepcao } = await admin
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", clinicId)
    .eq("role", "recepcao")
    .eq("status", "ativo")
    .limit(1)
    .single()
    .throwOnError();
  recepcaoId = (recepcao as { user_id: string }).user_id;
  await admin
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: recepcaoId })
    .eq("id", conversationId)
    .throwOnError();
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: contactId,
      source: "recepcao",
      evidence: "Autorização registrada no cadastro E2E",
    })
    .throwOnError();
});

test.afterAll(async () => {
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("phone_e164", PHONE);
});

/** Uma agendada montada direto no banco, para a recepcao, daqui a `horas`. */
async function agendadaNoBanco(texto: string, horas: number): Promise<string> {
  const { data } = await admin
    .from("mensagem_agendada")
    .insert({
      clinic_id: dados().clinicId,
      contact_id: contactId,
      whatsapp_account_id: dados().whatsappAccountId,
      conversation_id: conversationId,
      texto,
      enviar_em: new Date(Date.now() + horas * 3_600_000).toISOString(),
      criada_por: recepcaoId,
    })
    .select("id")
    .single()
    .throwOnError();
  return (data as { id: string }).id;
}

/** O paciente escreve na conversa (entrada pelo mesmo numero). */
async function pacienteEscreve(texto: string, n: number): Promise<void> {
  const { error } = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: dados().clinicId,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `agendada:${suffix}:${test.info().project.name}:${n}`,
    p_content_type: "texto",
    p_body: texto,
    p_whatsapp_account_id: dados().whatsappAccountId,
  });
  expect(error).toBeNull();
}

/** O pedido de Server Action cujo corpo leva este trecho (e nao o contato). */
function ehAcaoCom(route: Route, trecho: string): boolean {
  const pedido = route.request();
  const corpo = pedido.postData() ?? "";
  return (
    pedido.method() === "POST" &&
    Boolean(pedido.headers()["next-action"]) &&
    corpo.includes(trecho) &&
    !corpo.includes("contactId")
  );
}

async function apagarAgendadas(): Promise<void> {
  // Sem DELETE para a sessao; o service role limpa entre os testes.
  if (contactId) {
    await admin.from("mensagem_agendada").delete().eq("contact_id", contactId);
  }
}

async function abrirConversa(page: Page, email: string) {
  await login(page, email);
  await page.goto(`/atendimento?conversa=${conversationId}`);
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(fio.getByText(PRIMEIRA_FALA)).toBeVisible();
  return fio;
}

function listaDeAgendadas(page: Page) {
  return page.getByRole("region", { name: "Mensagens agendadas" });
}

test.describe.serial("agendar, editar e excluir", () => {
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== "desktop-1600",
      "fluxo independe de viewport",
    );
  });

  test.afterAll(apagarAgendadas);

  test("agenda pelo compositor e ve na lista", async ({ page }) => {
    await abrirConversa(page, dados().emails.recepcao);
    const caixa = page.getByLabel("Resposta ao paciente");
    await caixa.fill(TEXTO_AGENDADO);

    await page.getByRole("button", { name: "Agendar mensagem" }).click();
    const dialogo = page.getByRole("dialog", { name: "Agendar mensagem" });
    await expect(dialogo).toBeVisible();
    // O texto vem do campo; o campo so esvazia no sucesso.
    await expect(dialogo.getByLabel("Mensagem", { exact: true })).toHaveValue(
      TEXTO_AGENDADO,
    );
    await expect(caixa).toHaveValue(TEXTO_AGENDADO);

    const atalhos = dialogo.getByRole("group", { name: "Atalhos de data" });
    await atalhos.getByRole("button", { name: "Amanhã" }).click();
    await expect(
      atalhos.getByRole("button", { name: "Amanhã" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Sem hora, nao agenda.
    await dialogo.getByRole("button", { name: "Agendar" }).click();
    await expect(dialogo.getByText("Escolha a hora.")).toBeVisible();

    await dialogo.getByLabel("Hora", { exact: true }).fill("09:00");
    await expect(
      dialogo.getByText(
        /^Sai \S+, \d{2}\/\d{2}\/\d{4}, às 09:00, horário da clínica \(pode levar alguns minutos\)\.$/,
      ),
    ).toBeVisible();
    await dialogo.getByRole("button", { name: "Agendar" }).click();

    await expect(dialogo).toBeHidden();
    await expect(
      page.getByText(/^Mensagem agendada para \d{2}\/\d{2}\/\d{4} às 09:00\.$/),
    ).toBeVisible();
    await expect(caixa).toHaveValue("");

    const lista = listaDeAgendadas(page);
    await expect(lista.getByText("Sai amanhã às 09:00")).toBeVisible();
    await expect(lista.getByText("Agendada por você")).toBeVisible();
    await expect(lista.getByText(TEXTO_AGENDADO)).toBeVisible();
    await expect(lista.getByText("Agendada", { exact: true })).toBeVisible();

    const { data } = await admin
      .from("mensagem_agendada")
      .select("situacao, criada_por, texto")
      .eq("contact_id", contactId);
    expect(data).toEqual([
      { situacao: "agendada", criada_por: recepcaoId, texto: TEXTO_AGENDADO },
    ]);
  });

  test("edita o texto e a hora", async ({ page }) => {
    await abrirConversa(page, dados().emails.recepcao);
    const lista = listaDeAgendadas(page);
    await lista
      .getByRole("button", {
        name: "Editar a mensagem agendada para amanhã às 09:00",
      })
      .click();
    const dialogo = page.getByRole("dialog", {
      name: "Editar mensagem agendada",
    });
    await expect(
      dialogo.getByText(
        "Mude o texto, a data ou a hora. A mensagem continua marcada.",
      ),
    ).toBeVisible();
    await dialogo.getByLabel("Mensagem", { exact: true }).fill(TEXTO_EDITADO);
    await dialogo.getByLabel("Hora", { exact: true }).fill("10:30");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    await expect(dialogo).toBeHidden();

    await expect(lista.getByText("Sai amanhã às 10:30")).toBeVisible();
    await expect(lista.getByText(TEXTO_EDITADO)).toBeVisible();
  });

  test("exclui com confirmacao e o foco volta para a caixa", async ({
    page,
  }) => {
    await abrirConversa(page, dados().emails.recepcao);
    const lista = listaDeAgendadas(page);
    await lista
      .getByRole("button", {
        name: "Excluir a mensagem agendada para amanhã às 10:30",
      })
      .click();
    const dialogo = page.getByRole("dialog", {
      name: "Excluir esta mensagem agendada?",
    });
    await expect(
      dialogo.getByText(
        `Ela não vai ser enviada para ${CONTACT_NAME}. Não dá para desfazer.`,
      ),
    ).toBeVisible();
    await dialogo.getByRole("button", { name: "Excluir mensagem" }).click();
    await expect(dialogo).toBeHidden();

    await expect(listaDeAgendadas(page)).toHaveCount(0);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Mensagem agendada excluída." }),
    ).toHaveCount(1);
    await expect(page.getByLabel("Resposta ao paciente")).toBeFocused();

    const { data } = await admin
      .from("mensagem_agendada")
      .select("situacao, texto")
      .eq("contact_id", contactId);
    expect(data).toEqual([{ situacao: "cancelada", texto: null }]);
  });
});

test("enviar agora sai pelo 1:1 e vira bolha da recepcao", async ({ page }) => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
  try {
    await agendadaNoBanco(TEXTO_AGORA, 30);
    const fio = await abrirConversa(page, dados().emails.recepcao);
    const lista = listaDeAgendadas(page);
    await expect(lista.getByText(TEXTO_AGORA)).toBeVisible();
    await lista
      .getByRole("button", { name: /^Enviar agora a mensagem agendada para / })
      .click();
    const dialogo = page.getByRole("dialog", {
      name: `Enviar agora para ${CONTACT_NAME}?`,
    });
    await expect(
      dialogo.getByText(
        /^A mensagem marcada para .+ sai agora, em seu nome\.$/,
      ),
    ).toBeVisible();
    await dialogo.getByRole("button", { name: "Enviar agora" }).click();
    await expect(dialogo).toBeHidden();

    // A bolha aparece no fio, em nome de quem clicou (resposta digitada).
    await expect(fio.getByText(TEXTO_AGORA)).toBeVisible({ timeout: 10_000 });
    const { data: mensagem } = await admin
      .from("message")
      .select("author, author_user_id, cost_cents, billable")
      .eq("conversation_id", conversationId)
      .eq("body", TEXTO_AGORA)
      .single();
    expect(mensagem).toEqual({
      author: "usuario",
      author_user_id: recepcaoId,
      cost_cents: 0,
      billable: false,
    });
    // Retirada antes de enviar: cancelada com o motivo, sem o texto.
    const { data: agendada } = await admin
      .from("mensagem_agendada")
      .select("situacao, motivo, texto")
      .eq("contact_id", contactId);
    expect(agendada).toEqual([
      { situacao: "cancelada", motivo: "enviada_agora", texto: null },
    ]);
  } finally {
    await apagarAgendadas();
  }
});

test("somente leitura ve a lista com as acoes desabilitadas e a dica", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
  try {
    await agendadaNoBanco(TEXTO_AGENDADO, 30);
    await abrirConversa(page, dados().emails.leitura);
    const lista = listaDeAgendadas(page);
    await expect(lista.getByText(TEXTO_AGENDADO)).toBeVisible();
    for (const acao of ["Editar", "Enviar agora", "Excluir"]) {
      const botao = lista.getByRole("button", {
        name: new RegExp(`^${acao} a mensagem agendada para `),
      });
      await expect(botao).toBeVisible();
      await expect(botao).toBeDisabled();
    }
    // O alvo da dica e o involucro focavel do botao desabilitado, DENTRO da
    // lista; o "has" e relativo ao involucro (um localizador encadeado na
    // lista exigiria a lista inteira dentro do span).
    await lista
      .locator("span[tabindex='0']", {
        has: page.getByRole("button", {
          name: /^Excluir a mensagem agendada para /,
        }),
      })
      .hover();
    await expect(page.getByRole("tooltip")).toHaveText(SO_ACOMPANHA);
    // O compositor nao oferece o botao a quem so acompanha uma conversa de
    // colega: so o aviso de estado.
    await expect(
      page.getByRole("button", { name: "Agendar mensagem" }),
    ).toHaveCount(0);
  } finally {
    await apagarAgendadas();
  }
});

test("a lista aberta em 1366px nao espreme o fio", async ({ page }) => {
  test.skip(
    test.info().project.name !== "desktop-1366",
    "o teto de altura importa na tela menor",
  );
  try {
    for (let i = 1; i <= 6; i += 1) {
      await agendadaNoBanco(`${TEXTO_AGENDADO} (${i})`, 24 + i);
    }
    const fio = await abrirConversa(page, dados().emails.recepcao);
    const lista = listaDeAgendadas(page);
    await expect(
      lista.getByText(/^6 mensagens agendadas\. A próxima sai /),
    ).toBeVisible();
    const verTodas = lista.getByRole("button", { name: "Ver todas" });
    await expect(verTodas).toHaveAttribute("aria-expanded", "false");
    await verTodas.click();
    await expect(
      lista.getByRole("button", { name: "Ocultar" }),
    ).toHaveAttribute("aria-expanded", "true");

    const viewport = page.viewportSize();
    const caixaDaLista = await lista.getByRole("list").boundingBox();
    expect(viewport).not.toBeNull();
    expect(caixaDaLista).not.toBeNull();
    // Teto de 40% da altura, com rolagem propria.
    expect(caixaDaLista!.height).toBeLessThanOrEqual(
      viewport!.height * 0.4 + 1,
    );
    // O fio continua com espaco para ler a conversa.
    await expect(fio.getByText(PRIMEIRA_FALA)).toBeVisible();
    // E nada rola de lado.
    const rolaDeLado = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(rolaDeLado).toBe(false);
  } finally {
    await apagarAgendadas();
  }
});

test("fechada, a lista rele com mensagem nova, mostra quem escreveu depois e tem teto", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "desktop-1366",
    "o teto de altura importa na tela menor",
  );
  try {
    const fio = await abrirConversa(page, dados().emails.recepcao);
    // A tabela da agendada saiu do tempo real: as que entram agora no banco
    // so aparecem quando chega evento da conversa aberta (ou na releitura
    // de 30 segundos, que o prazo abaixo nao alcanca).
    for (let i = 1; i <= 6; i += 1) {
      await agendadaNoBanco(`${TEXTO_AGENDADO} [${i}]`, 24 + i);
    }
    const FALA = `Acho que vou remarcar ${suffix}`;
    await pacienteEscreve(FALA, 2);
    await expect(fio.getByText(FALA)).toBeVisible({ timeout: 10_000 });

    const lista = listaDeAgendadas(page);
    await expect(
      lista.getByText(/^6 mensagens agendadas\. A próxima sai /),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      lista.getByRole("button", { name: "Ver todas" }),
    ).toHaveAttribute("aria-expanded", "false");
    // Todas ainda vao sair e o paciente escreveu depois: o aviso de cada
    // uma fica a vista com a lista fechada (F6).
    await expect(
      lista.getByText(/escreveu depois que esta mensagem foi agendada\./),
    ).toHaveCount(6);

    // Fechada, a lista tem o mesmo teto de 40% e rolagem propria (F8).
    const viewport = page.viewportSize();
    const caixaDaLista = await lista.getByRole("list").boundingBox();
    expect(viewport).not.toBeNull();
    expect(caixaDaLista).not.toBeNull();
    expect(caixaDaLista!.height).toBeLessThanOrEqual(
      viewport!.height * 0.4 + 1,
    );
    // O fio continua com altura para ler a conversa.
    const alturaDoFio = await fio
      .locator("div.cz-scroll")
      .first()
      .evaluate((elemento) => elemento.clientHeight);
    expect(alturaDoFio).toBeGreaterThan(80);
  } finally {
    await apagarAgendadas();
  }
});

test("o dialogo nao fecha com Esc nem clique fora enquanto agenda", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
  const TEXTO = `Lembrete com Esc no meio. ${suffix}`;
  try {
    await abrirConversa(page, dados().emails.recepcao);
    const caixa = page.getByLabel("Resposta ao paciente");
    await caixa.fill(TEXTO);
    await page.getByRole("button", { name: "Agendar mensagem" }).click();
    const dialogo = page.getByRole("dialog", { name: "Agendar mensagem" });
    await dialogo
      .getByRole("group", { name: "Atalhos de data" })
      .getByRole("button", { name: "Amanhã" })
      .click();
    await dialogo.getByLabel("Hora", { exact: true }).fill("09:00");

    // O servidor grava agora; a resposta so volta quando o teste liberar.
    let liberar: () => void = () => undefined;
    const liberado = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    await page.route("**/atendimento**", async (route: Route) => {
      if (!ehAcaoCom(route, TEXTO)) {
        await route.fallback();
        return;
      }
      const resposta = await route.fetch();
      await liberado;
      await route.fulfill({ response: resposta });
    });

    await dialogo.getByRole("button", { name: "Agendar" }).click();
    await expect(
      dialogo.getByRole("button", { name: "Agendando..." }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.click(8, 8);
    await expect(dialogo).toBeVisible();
    await expect(
      dialogo.getByRole("button", { name: "Agendando..." }),
    ).toBeVisible();

    liberar();
    await expect(dialogo).toBeHidden();
    await expect(
      page.getByText(/^Mensagem agendada para \d{2}\/\d{2}\/\d{4} às 09:00\.$/),
    ).toBeVisible();
    await expect(caixa).toHaveValue("");
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await apagarAgendadas();
  }
});

test("enviar agora sem resposta: a lista rele antes de devolver o texto", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
  const TEXTO = `Enviar agora com a rede caindo. ${suffix}`;
  try {
    const id = await agendadaNoBanco(TEXTO, 30);
    const fio = await abrirConversa(page, dados().emails.recepcao);
    const caixa = page.getByLabel("Resposta ao paciente");
    const lista = listaDeAgendadas(page);
    await expect(lista.getByText(TEXTO)).toBeVisible();

    // 1) O pedido nem chega ao servidor: a releitura acha a agendada
    //    marcada, nada mudou e o texto NAO vai para o campo.
    let modo: "cortar" | "perder_resposta" = "cortar";
    await page.route("**/atendimento**", async (route: Route) => {
      if (!ehAcaoCom(route, id)) {
        await route.fallback();
        return;
      }
      if (modo === "perder_resposta") {
        // O servidor executa (retira e envia), e a resposta se perde.
        await route.fetch();
      }
      await route.abort("failed");
    });

    const enviarAgora = lista.getByRole("button", {
      name: /^Enviar agora a mensagem agendada para /,
    });
    await enviarAgora.click();
    const dialogo = page.getByRole("dialog", {
      name: `Enviar agora para ${CONTACT_NAME}?`,
    });
    await dialogo.getByRole("button", { name: "Enviar agora" }).click();
    await expect(
      dialogo.getByText(
        "Não foi possível falar com o servidor. A mensagem continua agendada.",
      ),
    ).toBeVisible();
    await expect(caixa).toHaveValue("");
    const { data: marcada } = await admin
      .from("mensagem_agendada")
      .select("situacao")
      .eq("id", id)
      .single();
    expect(marcada).toEqual({ situacao: "agendada" });
    await dialogo.getByRole("button", { name: "Manter agendada" }).click();
    await expect(dialogo).toBeHidden();

    // 2) O servidor retira e envia, e a resposta se perde: a agendada saiu
    //    da lista, o texto volta para o campo com o aviso de conferir.
    modo = "perder_resposta";
    await enviarAgora.click();
    await dialogo.getByRole("button", { name: "Enviar agora" }).click();
    await expect(dialogo).toBeHidden({ timeout: 10_000 });
    await expect(
      page.getByText(
        "Não foi possível confirmar o envio. Confira a conversa antes de mandar de novo.",
      ),
    ).toBeVisible();
    await expect(caixa).toHaveValue(TEXTO);
    await expect(caixa).toBeFocused();
    // A mensagem saiu de fato: a bolha esta no fio (a caixa tambem tem o
    // texto, por isso a bolha pelo marcador).
    await expect(
      fio.locator("[data-bolha]").filter({ hasText: TEXTO }),
    ).toBeVisible({ timeout: 10_000 });
    const { data: retirada } = await admin
      .from("mensagem_agendada")
      .select("situacao, motivo, texto")
      .eq("id", id)
      .single();
    expect(retirada).toEqual({
      situacao: "cancelada",
      motivo: "enviada_agora",
      texto: null,
    });
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await apagarAgendadas();
  }
});

test("axe da lista e do dialogo nos temas claro e escuro", async ({ page }) => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "contraste independe de viewport",
  );
  try {
    await agendadaNoBanco(TEXTO_AGENDADO, 30);
    await abrirConversa(page, dados().emails.recepcao);
    const lista = listaDeAgendadas(page);
    await expect(lista.getByText(TEXTO_AGENDADO)).toBeVisible();

    const conferir = async () => {
      const daLista = await new AxeBuilder({ page })
        .include("section[aria-labelledby]")
        .analyze();
      expect(daLista.violations).toEqual([]);
      await page.getByRole("button", { name: "Agendar mensagem" }).click();
      const dialogo = page.getByRole("dialog", { name: "Agendar mensagem" });
      await expect(dialogo).toBeVisible();
      const doDialogo = await new AxeBuilder({ page })
        .include("[role='dialog']")
        .analyze();
      expect(doDialogo.violations).toEqual([]);
      await dialogo.getByRole("button", { name: "Voltar" }).click();
      await expect(dialogo).toBeHidden();
    };

    await conferir();
    await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await conferir();
  } finally {
    await apagarAgendadas();
  }
});
