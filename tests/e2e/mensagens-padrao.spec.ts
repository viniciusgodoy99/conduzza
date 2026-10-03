import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Mensagens padrao (spec 1.11; "Mensagens padrão" na tela, decisao do dono
// em 02/10/2026): o cadastro na aba de Configuracoes e o "/" no compositor.
//
// O risco principal e o Enter: com a lista aberta ele ESCOLHE e nunca envia
// (nem Ctrl+Enter), e o Esc fecha so a lista, sem cancelar a citacao. Nao
// havia teste de teclado do compositor antes deste.
//
// O spec cria a propria conversa (atribuida a recepcao, com autorizacao) e as
// proprias mensagens padrao pelo service role, e limpa tudo no fim. Nao muta
// o seed.

const suffix = Date.now().toString(36);
const CONTACT_NAME = `Paciente Barra ${suffix}`;
const PHONE = `+5584916${suffix.slice(-6)}`;
const PRIMEIRA_FALA = "Oi, queria confirmar meu horário";

// Atalho no alfabeto do banco (^[a-z0-9_]{1,30}$): o sufixo e base 36.
const ATALHO = `e2econf${suffix}`;
const TITULO = `Confirmação E2E ${suffix}`;
const CORPO = "Olá, {{nome}}! Seu horário está confirmado.";
const RENDERIZADO = `Olá, ${CONTACT_NAME}! Seu horário está confirmado.`;
// A cadastrada pela tela, no primeiro teste.
const ATALHO_DA_TELA = `e2etela${suffix}`;

const admin = adminClient();
let conversationId = "";

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "teclado de verdade: o Enter so envia com apontador preciso",
  );
});

test.beforeAll(async () => {
  if (test.info().project.name !== "desktop-1600") {
    return;
  }
  const clinicId = dados().clinicId;
  const ingest = await admin.rpc("ingest_inbound_message", {
    p_clinic_id: clinicId,
    p_phone_e164: PHONE,
    p_name: CONTACT_NAME,
    p_wa_message_id: `barra:${suffix}:1`,
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

  const { data: recepcao } = await admin
    .from("clinic_member")
    .select("user_id")
    .eq("clinic_id", clinicId)
    .eq("role", "recepcao")
    .eq("status", "ativo")
    .limit(1)
    .single()
    .throwOnError();
  await admin
    .from("conversation")
    .update({
      status: "em_atendimento",
      assignee_user_id: (recepcao as { user_id: string }).user_id,
    })
    .eq("id", conversationId)
    .throwOnError();

  // Autorizado: a unica trava que este spec exercita e a da lista.
  const { data: contato } = await admin
    .from("conversation")
    .select("contact_id")
    .eq("id", conversationId)
    .single()
    .throwOnError();
  await admin
    .from("contact_consent")
    .insert({
      clinic_id: clinicId,
      contact_id: (contato as { contact_id: string }).contact_id,
      source: "recepcao",
      evidence: "Autorização registrada no cadastro E2E",
    })
    .throwOnError();

  await admin
    .from("resposta_rapida")
    .insert([
      {
        clinic_id: clinicId,
        atalho: ATALHO,
        titulo: TITULO,
        corpo: CORPO,
        // Insert de varias linhas: coluna ausente em uma delas vira null
        // (nao o default) no PostgREST, por isso o ativo vai explicito.
        ativo: true,
        posicao: 10,
      },
      {
        // Desativada: nunca aparece no compositor.
        clinic_id: clinicId,
        atalho: `${ATALHO}x`,
        titulo: `Desativada E2E ${suffix}`,
        corpo: "Não deveria aparecer.",
        ativo: false,
        posicao: 20,
      },
    ])
    .throwOnError();
});

test.afterAll(async () => {
  const clinicId = dados().clinicId;
  await admin
    .from("resposta_rapida")
    .delete()
    .eq("clinic_id", clinicId)
    .in("atalho", [ATALHO, `${ATALHO}x`, ATALHO_DA_TELA]);
  await admin
    .from("contact")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("phone_e164", PHONE);
});

async function abrirConversa(page: Page) {
  await login(page, dados().emails.recepcao);
  await page.goto(`/atendimento?conversa=${conversationId}`);
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(fio.getByText(PRIMEIRA_FALA)).toBeVisible();
  return fio;
}

// O banco grava direction 'entrada' ou 'saida' (docs/04). Com "outbound",
// como estava, a contagem dava sempre zero: os "nada saiu" passavam sem
// conferir nada e o "o Enter seguinte envia" nunca chegava a antes + 1.
async function enviadasPelaClinica(): Promise<number> {
  const { data } = await admin
    .from("message")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "saida")
    .eq("is_internal_note", false)
    .neq("content_type", "evento");
  return (data ?? []).length;
}

/** O texto da ultima mensagem que a clinica mandou nesta conversa. */
async function ultimaEnviada(): Promise<string | null> {
  const { data } = await admin
    .from("message")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("direction", "saida")
    .eq("is_internal_note", false)
    .neq("content_type", "evento")
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0] as { body: string | null } | undefined)?.body ?? null;
}

test("administrador cadastra uma mensagem padrão em Configurações", async ({
  page,
}) => {
  await login(page, dados().emails.admin);
  await page.goto("/configuracoes?aba=mensagens");
  await expect(
    page.getByRole("tab", { name: /^Mensagens padrão/ }),
  ).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Nova mensagem" }).click();
  // "Ativa" so vale com o Salvar: Checkbox, e nao Switch (docs/06, C31).
  await expect(
    page.getByRole("checkbox", {
      name: "Ativa: aparece na lista do Atendimento",
    }),
  ).toBeChecked();
  await page.getByLabel("Título").fill(`Endereço E2E ${suffix}`);
  await page.getByLabel("Atalho").fill(ATALHO_DA_TELA);
  await page
    .getByLabel("Texto", { exact: true })
    .fill("Oi, {{nome}}! Rua A, 10.");
  // A previa usa o nome ficticio, nunca o de um paciente.
  await expect(page.getByText("Oi, Maria! Rua A, 10.")).toBeVisible();
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByText("Mensagem criada.")).toBeVisible();
  await expect(page.getByText(`Endereço E2E ${suffix}`)).toBeVisible();
  await expect(page.getByText(`/${ATALHO_DA_TELA}`)).toBeVisible();

  // Atalho repetido e recusado com o motivo.
  await page.getByRole("button", { name: "Nova mensagem" }).click();
  await page.getByLabel("Título").fill(`Outro título ${suffix}`);
  await page.getByLabel("Atalho").fill(ATALHO_DA_TELA);
  await page.getByLabel("Texto", { exact: true }).fill("Qualquer texto.");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(
    page.getByText("Já existe uma mensagem padrão com esse atalho."),
  ).toBeVisible();
});

test('"/" + seta + Enter insere a mensagem sem enviar; o Enter seguinte envia', async ({
  page,
}) => {
  const fio = await abrirConversa(page);
  const caixa = fio.getByRole("textbox", { name: "Resposta ao paciente" });
  await caixa.click();
  await caixa.pressSequentially(`/${ATALHO}`);

  const lista = page.getByRole("listbox", { name: "Mensagens padrão" });
  await expect(lista).toBeVisible();
  // So a ativa: a desativada com o mesmo comeco de atalho nao aparece.
  await expect(lista.getByRole("option")).toHaveCount(1);
  await expect(lista.getByRole("option").first()).toContainText(TITULO);
  await expect(caixa).toHaveAttribute("aria-autocomplete", "list");
  await expect(caixa).toHaveAttribute(
    "aria-activedescendant",
    (await lista.getByRole("option").first().getAttribute("id")) ?? "",
  );

  const antes = await enviadasPelaClinica();
  await caixa.press("ArrowDown");
  await caixa.press("Enter");

  // Entrou ja renderizada (nome do contato), editavel, e a lista fechou.
  await expect(caixa).toHaveValue(RENDERIZADO);
  await expect(lista).toHaveCount(0);
  await expect(caixa).toBeFocused();
  // Nada saiu: nem bolha nem linha no banco.
  await page.waitForTimeout(1500);
  expect(await enviadasPelaClinica()).toBe(antes);

  // Editavel: o texto e da pessoa a partir daqui.
  await caixa.press("End");
  await caixa.pressSequentially(" Até lá!");
  await expect(caixa).toHaveValue(`${RENDERIZADO} Até lá!`);

  // Agora sim, o Enter envia.
  await caixa.press("Enter");
  await expect(caixa).toHaveValue("");
  await expect.poll(enviadasPelaClinica, { timeout: 10_000 }).toBe(antes + 1);
});

test("Enter e Ctrl+Enter com a lista aberta e sem resultado não enviam", async ({
  page,
}) => {
  const fio = await abrirConversa(page);
  const caixa = fio.getByRole("textbox", { name: "Resposta ao paciente" });
  await caixa.click();
  await caixa.pressSequentially("/naoexiste");
  // O texto existe duas vezes de proposito: o visivel da lista e o aviso
  // so para o leitor de tela (role status). Confere o visivel.
  await expect(
    page.getByText("Nenhuma mensagem com esse atalho.").first(),
  ).toBeVisible();

  const antes = await enviadasPelaClinica();
  await caixa.press("Enter");
  await caixa.press("Control+Enter");
  await expect(caixa).toHaveValue("/naoexiste");
  await page.waitForTimeout(1500);
  expect(await enviadasPelaClinica()).toBe(antes);
});

test("Esc fecha só a lista e mantém a citação", async ({ page }) => {
  const fio = await abrirConversa(page);
  // Cita a fala do paciente.
  await fio.getByText(PRIMEIRA_FALA).hover();
  await fio.getByRole("button", { name: "Ações da mensagem" }).first().click();
  await page.getByRole("menuitem", { name: "Responder" }).click();
  const cancelarCitacao = page.getByRole("button", {
    name: "Cancelar a resposta a esta mensagem",
  });
  await expect(cancelarCitacao).toBeVisible();

  const caixa = fio.getByRole("textbox", { name: "Resposta ao paciente" });
  await caixa.pressSequentially("/e2e");
  const lista = page.getByRole("listbox", { name: "Mensagens padrão" });
  await expect(lista).toBeVisible();

  await caixa.press("Escape");
  await expect(lista).toHaveCount(0);
  await expect(cancelarCitacao).toBeVisible();
  await expect(caixa).toHaveValue("/e2e");

  // O termo mudou: a lista volta.
  await caixa.pressSequentially("c");
  await expect(lista).toBeVisible();

  // Fechada a lista, o Esc volta a cancelar a citacao, como antes.
  await caixa.press("Escape");
  await expect(lista).toHaveCount(0);
  await caixa.press("Escape");
  await expect(cancelarCitacao).toHaveCount(0);
});

test("URL, data e e/ou não abrem a lista", async ({ page }) => {
  const fio = await abrirConversa(page);
  const caixa = fio.getByRole("textbox", { name: "Resposta ao paciente" });
  await caixa.click();
  for (const trecho of ["veja https://x.com/a", " dia 12/10", " e/ou", " //"]) {
    await caixa.pressSequentially(trecho);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByText("Enter escolhe, Esc fecha")).toHaveCount(0);
  }
});

test("na nota interna a barra é texto comum", async ({ page }) => {
  const fio = await abrirConversa(page);
  await fio.getByRole("button", { name: "Nota interna" }).click();
  const caixa = fio.getByRole("textbox", { name: "Nota interna" });
  await caixa.click();
  await caixa.pressSequentially(`/${ATALHO}`);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(caixa).not.toHaveAttribute("aria-autocomplete", "list");
  await expect(caixa).toHaveValue(`/${ATALHO}`);
});

test("o botão da barra abre a mesma lista e a escolha entra no campo", async ({
  page,
}) => {
  const fio = await abrirConversa(page);
  const botao = fio.getByRole("button", { name: "Mensagens padrão" });
  await botao.click();
  const lista = page.getByRole("listbox", { name: "Mensagens padrão" });
  await expect(lista).toBeVisible();
  await expect(botao).toHaveAttribute("aria-expanded", "true");
  await lista.getByRole("option", { name: new RegExp(TITULO) }).click();
  await expect(
    fio.getByRole("textbox", { name: "Resposta ao paciente" }),
  ).toHaveValue(RENDERIZADO);
  await expect(lista).toHaveCount(0);
});

test("a lista aberta pelo botão não volta sozinha quando o foco sai e volta; o Enter envia", async ({
  page,
}) => {
  const fio = await abrirConversa(page);
  const caixa = fio.getByRole("textbox", { name: "Resposta ao paciente" });
  const botao = fio.getByRole("button", { name: "Mensagens padrão" });
  const lista = page.getByRole("listbox", { name: "Mensagens padrão" });
  const rascunho = `Pode vir amanhã às 10h? ${suffix}`;
  await caixa.click();
  await caixa.pressSequentially(rascunho);

  await botao.click();
  await expect(lista).toBeVisible();

  // Desiste e clica fora do compositor (o nome no cabecalho do fio, longe da
  // lista, que abre por cima das bolhas): a lista some.
  await fio.getByText(CONTACT_NAME, { exact: true }).first().click();
  await expect(lista).toHaveCount(0);
  await expect(botao).toHaveAttribute("aria-expanded", "false");

  // Volta ao campo para enviar: a lista NAO reaparece sozinha.
  await caixa.click();
  await expect(caixa).toBeFocused();
  await expect(lista).toHaveCount(0);
  await expect(botao).toHaveAttribute("aria-expanded", "false");

  // E o Enter envia o rascunho como esta, sem mensagem padrao no meio.
  const antes = await enviadasPelaClinica();
  await caixa.press("Enter");
  await expect(caixa).toHaveValue("");
  await expect.poll(enviadasPelaClinica, { timeout: 10_000 }).toBe(antes + 1);
  expect(await ultimaEnviada()).toBe(rascunho);
});

test("abrir pelo botão e clicar em Enviar fecha a lista; o Enter seguinte não escolhe", async ({
  page,
}) => {
  const fio = await abrirConversa(page);
  const caixa = fio.getByRole("textbox", { name: "Resposta ao paciente" });
  const lista = page.getByRole("listbox", { name: "Mensagens padrão" });
  const rascunho = `Confirmado, até amanhã. ${suffix}`;
  await caixa.click();
  await caixa.pressSequentially(rascunho);

  await fio.getByRole("button", { name: "Mensagens padrão" }).click();
  await expect(lista).toBeVisible();

  const antes = await enviadasPelaClinica();
  await fio.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(caixa).toHaveValue("");
  await expect(lista).toHaveCount(0);
  await expect.poll(enviadasPelaClinica, { timeout: 10_000 }).toBe(antes + 1);

  // Com a lista aberta, este Enter escolheria a primeira mensagem padrao.
  await caixa.press("Enter");
  await expect(caixa).toHaveValue("");
  await expect(lista).toHaveCount(0);
});
