import { expect, test } from "@playwright/test";

import { criarNumeroDeTeste } from "../rls/numeros";
import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_PREFIXO, E2E_SENHA } from "./fixtures";
import { login } from "./helpers";

// Aceite da tarefa 1.5 sobre o seed: lista com segmentos e chips, fio com
// selo de IA, nota interna, cartao de bloqueio de conformidade com o rascunho
// auditavel, e a faixa vermelha de desconectado. Leitura pura, nao muta nada.

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "conteudo identico em todos os viewports",
  );
});

test("lista com segmentos de posse e chips de status contados", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await expect(page.getByRole("button", { name: /Todas 4/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /IA atendendo 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Aguardando você 1/ }),
  ).toBeVisible();
});

test("cartão mostra a última mensagem que o paciente vê, nunca a nota interna", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  const lista = page.getByRole("complementary", { name: "Conversas" });
  const cartao = (nome: string) =>
    lista.getByRole("button", { name: new RegExp(nome) });
  // Roberto: a última linha é uma nota interna; a prévia fica na mensagem
  // anterior do paciente, sem prefixo de autoria (quem falou foi ele).
  await expect(
    cartao("Roberto Recibo").getByText("Preciso do recibo da consulta"),
  ).toBeVisible();
  await expect(lista.getByText(/CNPJ novo/)).toHaveCount(0);
  await expect(
    cartao("Roberto Recibo").getByText(/^(Você|Clínica|IA):$/),
  ).toHaveCount(0);
  // Camila mandou áudio: a prévia diz o tipo em texto, sem a transcrição.
  // A asserção positiva prova que a prévia existe (sem ela, só o "sem
  // transcrição" passaria com o cartão vazio).
  await expect(
    cartao("Camila Áudio").getByText("Áudio", { exact: true }),
  ).toBeVisible();
  await expect(lista.getByText(/viajar na quarta/)).toHaveCount(0);
});

test("prévia escrita pela clínica ou pela IA diz quem escreveu", async ({
  page,
}) => {
  // Juliana: a última mensagem é a resposta da IA. Sem o prefixo, o cartão
  // mostraria a fala da IA como se fosse da paciente.
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  const cartao = page
    .getByRole("complementary", { name: "Conversas" })
    .getByRole("button", { name: /Juliana Dermato/ });
  await expect(cartao.getByText("IA:", { exact: true })).toBeVisible();
  await expect(cartao.getByText(/Quer ver os próximos horários/)).toBeVisible();
  // A hora é a da última fala da PACIENTE (a que ordena a lista), e diz isso.
  await expect(cartao).toHaveAccessibleName(/Última mensagem do paciente/);
});

test("link ?conversa= abre a conversa já selecionada (Confirmações, ficha)", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto(`/atendimento?conversa=${dados().conversas.comNotaInterna}`);
  await expect(
    page
      .getByRole("region", { name: "Conversa aberta" })
      .getByText(/CNPJ novo/),
  ).toBeVisible();
  // O link é aplicado uma vez: a URL volta a ser só /atendimento.
  await expect(page).toHaveURL(/\/atendimento$/);
});

test("link do Início com ?filtro=aguardando chega com o chip marcado", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento?filtro=aguardando");
  await expect(
    page.getByRole("button", { name: /Aguardando você 1/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const lista = page.getByRole("complementary", { name: "Conversas" });
  await expect(lista.getByText("Patrícia Sintoma")).toBeVisible();
  await expect(lista.getByText("Roberto Recibo")).toHaveCount(0);
});

test("bloqueio de conformidade aparece no fio com o rascunho auditável", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Patrícia Sintoma").click();
  await expect(
    page.getByText("Resposta da IA bloqueada pela conformidade"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver o que a IA ia responder" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rascunho bloqueado" }),
  ).toBeVisible();
  await expect(page.getByText(/pomada cicatrizante/)).toBeVisible();
});

test("bolha da IA carrega selo textual, nunca só cor", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Juliana Dermato").click();
  // No fio: o cartão da lista mostra a mesma frase como prévia.
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(fio.getByText("Atendemos sim!", { exact: false })).toBeVisible();
  // O selo preso à LINHA da mensagem da IA, com o texto exato "IA". Antes o
  // localizador subia até a raiz da página e casava "Juliana" ou o item
  // "Agente de IA" do menu: passava mesmo sem o selo na bolha.
  const linhaDaIa = fio.locator('[id^="mensagem-"]', {
    hasText: "Quer ver os próximos horários?",
  });
  await expect(linhaDaIa).toHaveCount(1);
  await expect(linhaDaIa.getByText("IA", { exact: true })).toBeVisible();
});

test("nota interna é âmbar e avisa que o paciente não vê", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Roberto Recibo").click();
  // Presa à linha da nota no fio: o aviso textual acompanha a própria nota.
  const linhaDaNota = page
    .getByRole("region", { name: "Conversa aberta" })
    .locator('[id^="mensagem-"]', { hasText: /CNPJ novo/ });
  await expect(linhaDaNota).toHaveCount(1);
  await expect(
    linhaDaNota.getByText("Nota interna, o paciente não vê", { exact: false }),
  ).toBeVisible();
});

test("as ações da conversa moram no cabeçalho do fio (decisão C29)", async ({
  page,
}) => {
  // Roberto Recibo está com a recepção no seed: Resolver e Transferir no
  // topo, e "Devolver para a IA" visível e desabilitado enquanto o agente de
  // IA não existe. Leitura pura: nenhum botão é clicado.
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Roberto Recibo").click();
  await expect(page.getByRole("button", { name: "Resolver" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Transferir" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Devolver para a IA" }),
  ).toBeDisabled();
  // O compositor ficou só com a escrita, e os dois planos se distinguem
  // pelo texto do botão.
  await expect(page.getByLabel("Resposta ao paciente")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
});

test("somente leitura vê Assumir e Transferir desabilitados, com o motivo", async ({
  page,
}) => {
  await login(page, dados().emails.leitura);
  await page.goto("/atendimento");
  await page.getByText("Patrícia Sintoma").click();
  const assumir = page.getByRole("button", { name: "Assumir conversa" });
  await expect(assumir).toBeDisabled();
  await expect(page.getByRole("button", { name: "Transferir" })).toBeDisabled();
  // O compositor diz o estado sem mandar assumir (o Assumir dela está
  // desabilitado): nada de "Assuma para responder" para quem só acompanha.
  const fio = page.getByRole("region", { name: "Conversa aberta" });
  await expect(fio.getByText("Ninguém está atendendo.")).toBeVisible();
  await expect(fio.getByText(/Assuma para responder/)).toHaveCount(0);
  await expect(
    fio.getByText("Seu perfil acompanha o atendimento, sem responder."),
  ).toBeVisible();
  // O motivo também está na dica do botão desabilitado, com a mesma frase.
  await page.locator("span[tabindex='0']", { has: assumir }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Seu perfil acompanha o atendimento, sem responder.",
  );
});

test("áudio mostra a transcrição colapsada", async ({ page }) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/atendimento");
  await page.getByText("Camila Áudio").click();
  await expect(page.getByText("Transcrição:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "ver mais" }).click();
  await expect(page.getByText(/viajar na quarta/)).toBeVisible();
});

test("clínica com WhatsApp desconectado vê a faixa vermelha fixa", async ({
  page,
}) => {
  await login(page, dados().emails.offline);
  await expect(
    page.getByText("WhatsApp desconectado", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconectar" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Varios numeros de WhatsApp (docs/07, Fase 4), com o provedor fake. Clinica
// e pessoa PROPRIAS (prefixo e2e, apagadas pelo teardown), para os dois
// numeros nao mudarem o que os outros testes veem na Clinica E2E.
//
// Roda com o contrato aplicado (20260925140000): sem o unique temporario de
// um numero por clinica, o segundo numero entra. Recusa do banco aqui e
// defeito, nunca motivo para pular. O unico pulo e o de viewport (o
// provisionamento so roda no desktop-1600).
// ---------------------------------------------------------------------------

test.describe("clínica com dois números", () => {
  const SLUG = `${E2E_PREFIXO}-numeros-fixo`;
  const EMAIL = `${E2E_PREFIXO}-numeros-fixo@teste.dev`;
  let motivoParaPular: string | null =
    "provisionamento não rodou neste projeto";

  function minutosAtras(minutos: number): string {
    return new Date(Date.now() - minutos * 60_000).toISOString();
  }

  async function garantirPessoa(
    admin: ReturnType<typeof adminClient>,
  ): Promise<string> {
    const criado = await admin.auth.admin.createUser({
      email: EMAIL,
      password: E2E_SENHA,
      email_confirm: true,
      user_metadata: { name: "Nina Números" },
    });
    if (criado.data.user) {
      return criado.data.user.id;
    }
    const { data } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const existente = data.users.find(
      (usuario) => usuario.email?.toLowerCase() === EMAIL,
    );
    if (!existente) {
      throw new Error(`Não foi possível criar nem localizar ${EMAIL}`);
    }
    await admin.auth.admin.updateUserById(existente.id, {
      password: E2E_SENHA,
    });
    return existente.id;
  }

  test.beforeAll(async () => {
    if (test.info().project.name !== "desktop-1600") {
      return;
    }
    const admin = adminClient();
    // Idempotente: uma repeticao (retries) comeca do zero.
    await admin.from("clinic").delete().eq("slug", SLUG).throwOnError();
    const clinicId = (
      await admin
        .from("clinic")
        .insert({
          name: "Clínica E2E Números",
          slug: SLUG,
          // Fora do motor: o envio pendente abaixo existe so para a faixa
          // contar, e nunca pode ser reivindicado.
          e_de_teste: true,
        })
        .select("id")
        .single()
        .throwOnError()
    ).data!.id as string;
    await admin
      .from("clinic_branding")
      .insert({ clinic_id: clinicId })
      .throwOnError();
    const pessoa = await garantirPessoa(admin);
    await admin
      .from("clinic_member")
      .insert({
        clinic_id: clinicId,
        user_id: pessoa,
        role: "admin",
        status: "ativo",
      })
      .throwOnError();

    const recepcao = await criarNumeroDeTeste(admin, clinicId, {
      nome: "Recepção",
      connection_status: "conectado",
      display_phone: "+55 84 90000-0101",
    });
    const centroId = (
      await criarNumeroDeTeste(admin, clinicId, {
        nome: "Unidade Centro",
        principal: false,
        connection_status: "desconectado",
        display_phone: "+55 84 90000-0102",
      })
    ).id;
    // Ja conectou uma vez: e vigiado pela faixa (D6).
    await admin
      .from("whatsapp_account")
      .update({ connected_at: minutosAtras(120) })
      .eq("id", centroId)
      .throwOnError();

    const contatos = (
      await admin
        .from("contact")
        .insert([
          {
            clinic_id: clinicId,
            phone_e164: "+5584970000101",
            name: "Ana Pela Recepção",
            kind: "paciente",
          },
          {
            clinic_id: clinicId,
            phone_e164: "+5584970000102",
            name: "Bruno Pelo Centro",
            kind: "paciente",
          },
        ])
        .select("id, name")
        .throwOnError()
    ).data as { id: string; name: string }[];
    const contatoDe = (nome: string) =>
      contatos.find((contato) => contato.name === nome)!.id;
    // Autorizados: a unica trava da resposta que este bloco prova e a do
    // numero (sem autorizacao, a caixa travaria pelos dois).
    await admin
      .from("contact_consent")
      .insert(
        contatos.map((contato) => ({
          clinic_id: clinicId,
          contact_id: contato.id,
          source: "recepcao",
          evidence: "Autorização registrada no cadastro E2E",
        })),
      )
      .throwOnError();

    const conversas = (
      await admin
        .from("conversation")
        .insert([
          {
            clinic_id: clinicId,
            contact_id: contatoDe("Ana Pela Recepção"),
            whatsapp_account_id: recepcao.id,
            status: "em_atendimento",
            assignee_user_id: pessoa,
            unread_count: 0,
            awaiting_reply: false,
            last_message_at: minutosAtras(5),
            last_inbound_at: minutosAtras(5),
          },
          {
            clinic_id: clinicId,
            contact_id: contatoDe("Bruno Pelo Centro"),
            whatsapp_account_id: centroId,
            status: "em_atendimento",
            assignee_user_id: pessoa,
            unread_count: 0,
            awaiting_reply: false,
            last_message_at: minutosAtras(15),
            last_inbound_at: minutosAtras(15),
          },
        ])
        .select("id, contact_id")
        .throwOnError()
    ).data as { id: string; contact_id: string }[];
    const conversaDe = (nome: string) =>
      conversas.find((conversa) => conversa.contact_id === contatoDe(nome))!.id;

    await admin
      .from("message")
      .insert([
        {
          clinic_id: clinicId,
          conversation_id: conversaDe("Ana Pela Recepção"),
          wa_message_id: `${E2E_PREFIXO}:numeros:1`,
          direction: "entrada",
          author: "paciente",
          content_type: "texto",
          body: "Oi, tem horário amanhã?",
          created_at: minutosAtras(5),
        },
        {
          clinic_id: clinicId,
          conversation_id: conversaDe("Bruno Pelo Centro"),
          wa_message_id: `${E2E_PREFIXO}:numeros:2`,
          direction: "entrada",
          author: "paciente",
          content_type: "texto",
          body: "Quero remarcar minha consulta",
          created_at: minutosAtras(15),
        },
      ])
      .throwOnError();

    // Um envio automatico ja devolvido pela fila (devolucoes > 0) com a
    // proxima tentativa no futuro: e o retrato de um toque esperando a
    // reconexao, e nenhum motor encosta nele (clinica de teste, hora futura).
    await admin
      .from("job_queue")
      .insert({
        clinic_id: clinicId,
        kind: "enviar_mensagem_ativa",
        payload: { contact_id: contatoDe("Bruno Pelo Centro") },
        whatsapp_account_id: centroId,
        run_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        devolucoes: 1,
      })
      .throwOnError();

    motivoParaPular = null;
  });

  test("lista mostra o número de cada conversa e filtra por número", async ({
    page,
  }) => {
    test.skip(motivoParaPular !== null, motivoParaPular ?? "");
    await login(page, EMAIL);
    await page.goto("/atendimento");
    const lista = page.getByRole("complementary", { name: "Conversas" });
    const filtro = lista.getByRole("group", { name: "Filtrar por número" });
    await expect(filtro.getByRole("button", { name: /Todos 2/ })).toBeVisible();
    await expect(
      lista
        .getByRole("button", { name: /Ana Pela Recepção/ })
        .getByText("Recepção", { exact: true }),
    ).toBeVisible();
    await filtro.getByRole("button", { name: /Unidade Centro 1/ }).click();
    await expect(lista.getByText("Bruno Pelo Centro")).toBeVisible();
    await expect(lista.getByText("Ana Pela Recepção")).toHaveCount(0);
  });

  test("número desconectado trava a resposta com o motivo, e a faixa conta o que espera", async ({
    page,
  }) => {
    test.skip(motivoParaPular !== null, motivoParaPular ?? "");
    await login(page, EMAIL);
    // A faixa nomeia o numero que caiu e diz quantas automaticas esperam.
    await expect(
      page.getByText("WhatsApp Unidade Centro desconectado", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("1 mensagem automática espera a reconexão", {
        exact: false,
      }),
    ).toBeVisible();

    await page.goto("/atendimento");
    await page
      .getByRole("complementary", { name: "Conversas" })
      .getByText("Bruno Pelo Centro")
      .click();
    const fio = page.getByRole("region", { name: "Conversa aberta" });
    // Cabecalho: o nome do numero da conversa, e o telefone dele na dica (no
    // fio estreito o telefone sai da linha para o nome do paciente caber).
    const selo = fio.getByTitle("Número Unidade Centro, (84) 90000-0102");
    await expect(selo).toBeVisible();
    await expect(selo.getByText("Unidade Centro")).toBeVisible();
    // Compositor: o motivo, a caixa travada e o caminho para reconectar.
    await expect(
      fio.getByText("O número Unidade Centro está desconectado."),
    ).toBeVisible();
    await expect(fio.getByLabel("Resposta ao paciente")).toBeDisabled();
    await expect(fio.getByRole("link", { name: "Reconectar" })).toBeVisible();

    // A conversa do numero conectado responde normalmente.
    await page
      .getByRole("complementary", { name: "Conversas" })
      .getByText("Ana Pela Recepção")
      .click();
    await expect(fio.getByLabel("Resposta ao paciente")).toBeEnabled();
  });
});
