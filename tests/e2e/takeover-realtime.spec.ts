import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_SENHA, login } from "./helpers";

// Aceite da tarefa 1.7 com duas sessoes reais: uma assume, a outra reflete o
// estado em menos de 2 segundos; mensagem enviada aparece na outra tela; e
// mensagem recebida numa conversa assumida NAO devolve a posse para a IA.
// O spec cria a propria conversa (nao muta o seed) e limpa no fim.

const suffix = Date.now().toString(36);
const CONTACT_NAME = `Paciente Tempo Real ${suffix}`;
const PHONE = `+5584915${suffix.slice(-6)}`;

const admin = adminClient();

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independe de viewport",
  );
});

test.afterAll(async () => {
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("phone_e164", PHONE);
});

async function openConversation(page: Page): Promise<void> {
  await page.goto("/atendimento");
  await page.getByText(CONTACT_NAME).click();
  await expect(
    page
      .getByRole("heading", { name: CONTACT_NAME })
      .or(page.getByText(CONTACT_NAME).nth(1)),
  ).toBeVisible();
}

test("assumir reflete na outra sessão em menos de 2s e a IA não volta sozinha", async ({
  browser,
}) => {
  // Conversa propria do teste, nascendo com a IA (estado que exercita o takeover).
  const ingest = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: dados().clinicId,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `rt:${suffix}:1`,
    p_content_type: "texto",
    p_body: "Oi, queria informações sobre limpeza de pele",
    p_media_url: null,
    p_transcript: null,
  });
  expect(ingest.error).toBeNull();
  const conversationId = (ingest.data as { conversation_id: string })
    .conversation_id;
  await admin
    .from("conversation")
    .update({ status: "ia_atendendo" })
    .eq("id", conversationId);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await login(pageA, dados().emails.recepcao);
  await login(pageB, dados().emails.gestor);
  await openConversation(pageA);
  await openConversation(pageB);

  await expect(
    pageB.getByText("A IA está atendendo esta conversa."),
  ).toBeVisible();

  // A assume; B reflete em < 2s sem qualquer acao. O "Assumir conversa" mora
  // no cabecalho do fio desde a adocao do design system (decisao C29); o
  // compositor so diz o estado e aponta para ele.
  await pageA.getByRole("button", { name: "Assumir conversa" }).click();
  await expect(
    pageB.getByText("Outra pessoa está com esta conversa."),
  ).toBeVisible({ timeout: 2000 });
  await expect(pageB.getByText(/assumiu a conversa/)).toBeVisible({
    timeout: 2000,
  });

  // A responde; B ve a bolha. O criterio de aceite do backlog e sobre a
  // MUDANCA DE POSSE refletir em menos de 2 segundos (afirmado acima, sem
  // folga). A propagacao da bolha depende tambem do envio pelo provedor, e
  // sob carga (quatro viewports em sequencia) 2 segundos ficam apertados
  // demais e geram falha intermitente sem defeito real.
  await pageA.getByLabel("Resposta ao paciente").fill("Já te atendo por aqui!");
  await pageA.getByRole("button", { name: "Enviar" }).click();
  // No fio: o cartão da lista também mostra a frase, como prévia.
  await expect(
    pageB
      .getByRole("region", { name: "Conversa aberta" })
      .getByText("Já te atendo por aqui!"),
  ).toBeVisible({
    timeout: 8000,
  });
  // A prévia diz QUEM escreveu (achado L2): para quem mandou, "Você:"; para
  // o resto da equipe, "Clínica:". Chega pelo tempo real, com a autoria.
  const cartaoEm = (pagina: Page) =>
    pagina
      .getByRole("complementary", { name: "Conversas" })
      .getByRole("button", { name: new RegExp(CONTACT_NAME) });
  await expect(cartaoEm(pageA).getByText("Você:", { exact: true })).toBeVisible(
    { timeout: 8000 },
  );
  await expect(
    cartaoEm(pageB).getByText("Clínica:", { exact: true }),
  ).toBeVisible({ timeout: 8000 });

  // Mensagem recebida numa conversa assumida NAO devolve para a IA.
  const second = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: dados().clinicId,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `rt:${suffix}:2`,
    p_content_type: "texto",
    p_body: "Perfeito, aguardo",
    p_media_url: null,
    p_transcript: null,
  });
  expect(second.error).toBeNull();
  await expect(
    pageA
      .getByRole("region", { name: "Conversa aberta" })
      .getByText("Perfeito, aguardo"),
  ).toBeVisible({
    timeout: 3000,
  });

  const { data: after } = await admin
    .from("conversation")
    .select("status")
    .eq("id", conversationId)
    .single();
  expect(after?.status).toBe("em_atendimento");
  await expect(pageA.getByLabel("Resposta ao paciente")).toBeVisible();
  // A fala nova do paciente volta a prévia para ele: sem prefixo.
  await expect(cartaoEm(pageA).getByText("Perfeito, aguardo")).toBeVisible({
    timeout: 3000,
  });
  await expect(cartaoEm(pageA).getByText(/^(Você|Clínica|IA):$/)).toHaveCount(
    0,
  );

  await contextA.close();
  await contextB.close();
});

// Conversa propria de cada teste abaixo, atribuida direto pelo service role.
async function conversaAtribuida(
  telefone: string,
  nome: string,
  assignee: string,
): Promise<string> {
  const ingest = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: dados().clinicId,
    p_phone_e164: telefone,
    p_name: nome,
    p_wa_message_id: `rt:${suffix}:${telefone}`,
    p_content_type: "texto",
    p_body: "Oi, preciso falar sobre o meu retorno",
    p_media_url: null,
    p_transcript: null,
  });
  expect(ingest.error).toBeNull();
  const conversationId = (ingest.data as { conversation_id: string })
    .conversation_id;
  const { error } = await admin
    .from("conversation")
    .update({ status: "em_atendimento", assignee_user_id: assignee })
    .eq("id", conversationId);
  expect(error).toBeNull();
  return conversationId;
}

async function idDoMembro(papel: string): Promise<string> {
  const { data, error } = await admin
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", dados().clinicId)
    .eq("role", papel)
    .eq("status", "ativo")
    .limit(1)
    .single();
  expect(error).toBeNull();
  return (data as { user_id: string }).user_id;
}

test("profissional de quem a conversa foi passada deixa de vê-la como dele", async ({
  browser,
}) => {
  // Achado L4: a RLS do profissional so mostra as conversas dele, entao o
  // tempo real NAO entrega a ele o evento da transferencia. A tela precisa
  // perceber sozinha (conferencia periodica, ou a recusa do servidor ao
  // responder) e sair da conversa com o motivo.
  const telefone = `+5584916${suffix.slice(-6)}`;
  const nome = `Paciente Transferido ${suffix}`;
  const emailProf = `e2e-prof-rt-${suffix}@teste.dev`;
  const criado = await admin.auth.admin.createUser({
    email: emailProf,
    password: E2E_SENHA,
    email_confirm: true,
    user_metadata: { name: `Dra. Tempo Real ${suffix}` },
  });
  expect(criado.error).toBeNull();
  const profId = criado.data.user!.id;
  try {
    const { error } = await admin.from("clinic_member").insert({
      clinic_id: dados().clinicId,
      user_id: profId,
      role: "profissional",
      status: "ativo",
    });
    expect(error).toBeNull();
    await conversaAtribuida(telefone, nome, profId);

    const contextoProf = await browser.newContext();
    const contextoRecepcao = await browser.newContext();
    const pageProf = await contextoProf.newPage();
    const pageRecepcao = await contextoRecepcao.newPage();
    await login(pageProf, emailProf);
    await login(pageRecepcao, dados().emails.recepcao);

    await pageProf.goto("/atendimento");
    await pageProf.getByText(nome).click();
    const caixa = pageProf.getByLabel("Resposta ao paciente");
    await expect(caixa).toBeVisible();

    // A recepção passa a conversa para o gestor, pelo Transferir do topo.
    await pageRecepcao.goto("/atendimento");
    await pageRecepcao.getByText(nome).click();
    await pageRecepcao.getByRole("button", { name: "Transferir" }).click();
    await pageRecepcao
      .getByRole("menuitem", { name: /Gustavo Gestor/ })
      .click();
    await expect(
      pageRecepcao.getByText("Conversa passada para Gustavo Gestor."),
    ).toBeVisible();

    // O profissional tenta responder. Se a conferencia periodica ja tiver
    // tirado a conversa da tela, a caixa sumiu e nao ha o que enviar: os dois
    // caminhos terminam no mesmo aviso.
    await caixa
      .fill("Ainda estou por aqui", { timeout: 2000 })
      .then(() =>
        pageProf
          .getByRole("button", { name: "Enviar" })
          .click({ timeout: 2000 }),
      )
      .catch(() => undefined);
    await expect(
      pageProf.getByText("Esta conversa não está mais disponível para você."),
    ).toBeVisible({ timeout: 35_000 });
    // O fio fechou e a conversa saiu da lista dele.
    await expect(pageProf.getByLabel("Resposta ao paciente")).toHaveCount(0);
    await expect(
      pageProf
        .getByRole("complementary", { name: "Conversas" })
        .getByText(nome),
    ).toHaveCount(0);

    await contextoProf.close();
    await contextoRecepcao.close();
  } finally {
    await admin
      .from("contact")
      .delete()
      .eq("clinic_id", dados().clinicId)
      .eq("phone_e164", telefone);
    await admin
      .from("clinic_member")
      .delete()
      .eq("clinic_id", dados().clinicId)
      .eq("user_id", profId);
    await admin.auth.admin.deleteUser(profId);
  }
});

test("quem está com a conversa mas só acompanha vê Resolver e Enviar desabilitados", async ({
  page,
}) => {
  // Achado L5: o papel virou Somente leitura com a conversa atribuida. O
  // cabecalho e o compositor mostram as acoes, desabilitadas, com o motivo.
  const telefone = `+5584917${suffix.slice(-6)}`;
  const nome = `Paciente da Leitura ${suffix}`;
  try {
    await conversaAtribuida(telefone, nome, await idDoMembro("leitura"));
    await login(page, dados().emails.leitura);
    await page.goto("/atendimento");
    await page.getByText(nome).click();

    const resolver = page.getByRole("button", { name: "Resolver" });
    await expect(resolver).toBeDisabled();
    await expect(page.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await expect(page.getByLabel("Resposta ao paciente")).toBeDisabled();
    await expect(
      page.getByText(
        "Esta conversa está com você, mas seu perfil só acompanha.",
      ),
    ).toBeVisible();
    await page.locator("span[tabindex='0']", { has: resolver }).hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Seu perfil acompanha o atendimento, sem responder.",
    );
  } finally {
    await admin
      .from("contact")
      .delete()
      .eq("clinic_id", dados().clinicId)
      .eq("phone_e164", telefone);
  }
});
