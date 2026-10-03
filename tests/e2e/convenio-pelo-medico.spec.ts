import { expect, test, type Locator, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Convenio pelo medico (pedido do dono em 02/10/2026): os convenios sao
// cadastrados no Profissional ("Convênios que atende") e entram sozinhos so
// nos procedimentos que o convenio cobre. Aceites, pela tela:
// - o medico novo grava os convenios que atende, e o Particular vale sempre
//   (texto fixo, sem caixa);
// - ao colocar o medico num procedimento que a Unimed cobre, a Unimed dele ja
//   vem marcada; no Botox, que nenhum convenio cobre, so o Particular;
// - o caso do Dr. Joao (spec 3.5): Endocrinologia com Unimed e Bradesco,
//   Nutrologia so particular (excecao desmarcada no Procedimento). Um
//   convenio novo no cadastro dele entra so onde cobre, e a excecao fica;
// - tirar um convenio com consulta futura avisa ANTES de gravar (D4), e
//   Cancelar nao grava nada; com a confirmacao, o vinculo e desativado e a
//   consulta continua marcada;
// - tirar um convenio sem consulta futura, mas que tira o medico de um
//   procedimento (D3), pede so a confirmacao: sem falar de consulta e sem o
//   atalho da Agenda;
// - na criacao, se o convenio marcado e desativado em outra aba antes do
//   Salvar, o profissional e a jornada sao gravados e o erro diz o que faltou
//   (o parcial nao perde a jornada);
// - a recepcao ve os convenios que o profissional atende, desabilitados e
//   com a dica, sem Salvar.
//
// Os testes que gravam MUTAM dados em cadeia (modo serial, ordem do
// arquivo) e rodam so no desktop-1600. O que eles criam (convenios,
// procedimentos, o medico, o paciente e a consulta) tem prefixo proprio e
// sai do banco no fim, e tambem antes de comecar, caso uma execucao anterior
// tenha morrido no meio. A cobertura (procedure_insurance) entra direto no
// banco: a tela dela e da frente do Procedimento, com os testes dela.

const PROJETO_QUE_RODA = "desktop-1600";
const PREFIXO = "CPM E2E";
// Faixa de telefone so deste arquivo: o paciente e achado e apagado por ela.
const FONE_DO_PACIENTE = "+5584970009921";

const sufixo = Date.now().toString(36);
const NOMES = {
  unimed: `Unimed ${PREFIXO} ${sufixo}`,
  bradesco: `Bradesco ${PREFIXO} ${sufixo}`,
  amil: `Amil ${PREFIXO} ${sufixo}`,
  endo: `Endocrinologia ${PREFIXO} ${sufixo}`,
  nutro: `Nutrologia ${PREFIXO} ${sufixo}`,
  botox: `Botox ${PREFIXO} ${sufixo}`,
  joao: `Dr. João ${PREFIXO} ${sufixo}`,
  paciente: `Paciente ${PREFIXO} ${sufixo}`,
  // So dos dois ultimos testes: o procedimento que o Dr. Joao faz so pelo
  // Bradesco (D3 sem consulta), e a medica nova com o convenio desativado no
  // meio do caminho (parcial da criacao).
  checkup: `Check-up ${PREFIXO} ${sufixo}`,
  golden: `Golden ${PREFIXO} ${sufixo}`,
  ana: `Dra. Ana ${PREFIXO} ${sufixo}`,
};

// Rotulos fixos do contrato (lib/domain/convenios-do-medico.ts).
const ROTULO_CONVENIOS_QUE_ATENDE = "Convênios que atende";
const ROTULO_TIRAR_CONVENIO = "Tirar o convênio mesmo assim";
const DICA_DE_QUEM_SO_VE =
  "Somente administradores e gestores alteram os cadastros";

const ids = {
  unimed: "",
  bradesco: "",
  amil: "",
  endo: "",
  nutro: "",
  botox: "",
  paciente: "",
};

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

function conveniosQueAtende(dialogo: Locator): Locator {
  return dialogo.getByRole("group", {
    name: ROTULO_CONVENIOS_QUE_ATENDE,
    exact: true,
  });
}

function caixa(escopo: Locator, convenio: string): Locator {
  return escopo.getByRole("checkbox", { name: convenio, exact: true });
}

/** Cartao do profissional em "Quem faz e convênios" do Procedimento */
function cartaoDe(dialogo: Locator, profissional: string): Locator {
  return dialogo.getByRole("group", { name: profissional, exact: true });
}

async function abrirOJoao(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: `Editar ${NOMES.joao}`, exact: true })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Editar profissional" }),
  ).toBeVisible();
  await expect(conveniosQueAtende(dialogo)).toBeVisible();
  return dialogo;
}

async function abrirProcedimento(page: Page, nome: string): Promise<Locator> {
  await page
    .getByRole("button", { name: `Editar ${nome}`, exact: true })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Editar procedimento" }),
  ).toBeVisible();
  return dialogo;
}

async function colocarOJoao(page: Page, dialogo: Locator): Promise<Locator> {
  await dialogo.getByRole("combobox", { name: "Adicionar quem faz" }).click();
  await page.getByRole("option", { name: NOMES.joao, exact: true }).click();
  const cartao = cartaoDe(dialogo, NOMES.joao);
  await expect(cartao).toBeVisible();
  return cartao;
}

async function salvarOModal(dialogo: Locator): Promise<void> {
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialogo).toBeHidden();
}

async function idDoJoao(): Promise<string> {
  const { data } = await adminClient()
    .from("professional")
    .select("id")
    .eq("clinic_id", dados().clinicId)
    .eq("name", NOMES.joao)
    .single()
    .throwOnError();
  return data!.id as string;
}

/** professional_insurance do Dr. Joao (os pares crus) */
async function conveniosGravadosDoJoao(): Promise<string[]> {
  const { data } = await adminClient()
    .from("professional_insurance")
    .select("insurance_id")
    .eq("professional_id", await idDoJoao())
    .throwOnError();
  return (data ?? []).map((par) => par.insurance_id as string).sort();
}

/** Vinculos ATIVOS do Dr. Joao, como "procedimento convenio", em ordem */
async function vinculosAtivosDoJoao(): Promise<string[]> {
  const { data } = await adminClient()
    .from("service_link")
    .select("procedure_id, insurance_id")
    .eq("professional_id", await idDoJoao())
    .eq("active", true)
    .throwOnError();
  const procedimento = new Map([
    [ids.endo, "endo"],
    [ids.nutro, "nutro"],
    [ids.botox, "botox"],
  ]);
  const convenio = new Map([
    [ids.unimed, "unimed"],
    [ids.bradesco, "bradesco"],
    [ids.amil, "amil"],
  ]);
  return (data ?? [])
    .map(
      (v) =>
        `${procedimento.get(v.procedure_id as string) ?? "outro"} ${
          v.insurance_id === null
            ? "particular"
            : (convenio.get(v.insurance_id as string) ?? "outro")
        }`,
    )
    .sort();
}

// Apaga tudo o que este arquivo cria, na ordem das chaves: as consultas
// antes (appointment.professional_id, contact_id e service_link_id nao tem
// cascata), o paciente, os procedimentos e o medico (levam os vinculos, os
// pares de convenio e a jornada) e, por ultimo, os convenios
// (service_link.insurance_id nao tem cascata).
async function limparOQueEsteArquivoCria(): Promise<void> {
  const admin = adminClient();
  const clinicId = dados().clinicId;
  const comPrefixo = `%${PREFIXO}%`;
  const { data: profissionais } = await admin
    .from("professional")
    .select("id")
    .eq("clinic_id", clinicId)
    .like("name", comPrefixo);
  const idsDosProfissionais = (profissionais ?? []).map((p) => p.id as string);
  if (idsDosProfissionais.length > 0) {
    await admin
      .from("appointment")
      .delete()
      .in("professional_id", idsDosProfissionais);
  }
  const { data: pacientes } = await admin
    .from("contact")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("phone_e164", FONE_DO_PACIENTE);
  const idsDosPacientes = (pacientes ?? []).map((p) => p.id as string);
  if (idsDosPacientes.length > 0) {
    await admin.from("appointment").delete().in("contact_id", idsDosPacientes);
    await admin.from("contact").delete().in("id", idsDosPacientes);
  }
  await admin
    .from("procedure")
    .delete()
    .eq("clinic_id", clinicId)
    .like("name", comPrefixo);
  if (idsDosProfissionais.length > 0) {
    await admin.from("professional").delete().in("id", idsDosProfissionais);
  }
  await admin
    .from("insurance")
    .delete()
    .eq("clinic_id", clinicId)
    .like("name", comPrefixo);
}

// ---------------------------------------------------------------------------
// Recepcao: so le (roda em todos os tamanhos, com o seed, sem gravar nada)
// ---------------------------------------------------------------------------

test("recepção vê os convênios que o profissional atende, desabilitados e com a dica", async ({
  page,
}) => {
  await login(page, dados().emails.recepcao);
  await page.goto("/cadastros");

  // A acao de editar continua visivel e desabilitada.
  await expect(
    page.getByRole("button", { name: "Editar Dr. João Pereira", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Ver detalhes de Dr. João Pereira",
      exact: true,
    })
    .click();
  const dialogo = page.getByRole("dialog");
  await expect(
    dialogo.getByRole("heading", { name: "Dr. João Pereira" }),
  ).toBeVisible();

  const convenios = conveniosQueAtende(dialogo);
  await expect(convenios).toBeVisible();
  await expect(convenios).toContainText("O Particular vale sempre");
  // O seed da ao Dr. Joao a Unimed (na Endocrinologia), nao o Bradesco.
  await expect(caixa(convenios, "Unimed")).toBeChecked();
  await expect(caixa(convenios, "Unimed")).toBeDisabled();
  await expect(caixa(convenios, "Bradesco Saúde")).not.toBeChecked();
  await expect(caixa(convenios, "Bradesco Saúde")).toBeDisabled();
  await expect(
    dialogo.getByRole("button", { name: "Salvar", exact: true }),
  ).toHaveCount(0);

  // A dica explica o porque ao focar o involucro da lista desabilitada.
  await convenios.locator('span[tabindex="0"]').focus();
  await expect(page.getByText(DICA_DE_QUEM_SO_VE).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Gestor: grava (serial, so no desktop-1600)
// ---------------------------------------------------------------------------

test.describe("convênio pelo médico, de ponta a ponta", () => {
  test.describe.configure({ mode: "serial" });

  // Os ganchos recebem o testInfo pelo segundo argumento (o primeiro tem de
  // ser a desestruturacao das fixtures, mesmo vazia).
  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== PROJETO_QUE_RODA) {
      return;
    }
    await limparOQueEsteArquivoCria();
    const admin = adminClient();
    const clinicId = dados().clinicId;

    const { data: convenios } = await admin
      .from("insurance")
      .insert([
        { clinic_id: clinicId, name: NOMES.unimed },
        { clinic_id: clinicId, name: NOMES.bradesco },
        { clinic_id: clinicId, name: NOMES.amil },
      ])
      .select("id, name")
      .throwOnError();
    const convenio = (nome: string) =>
      convenios!.find((c) => c.name === nome)!.id as string;
    ids.unimed = convenio(NOMES.unimed);
    ids.bradesco = convenio(NOMES.bradesco);
    ids.amil = convenio(NOMES.amil);

    const { data: procedimentos } = await admin
      .from("procedure")
      .insert([
        {
          clinic_id: clinicId,
          name: NOMES.endo,
          default_duration_min: 40,
          base_price_cents: 40000,
        },
        {
          clinic_id: clinicId,
          name: NOMES.nutro,
          default_duration_min: 60,
          base_price_cents: 50000,
        },
        {
          clinic_id: clinicId,
          name: NOMES.botox,
          default_duration_min: 30,
          base_price_cents: 120000,
        },
      ])
      .select("id, name")
      .throwOnError();
    const procedimento = (nome: string) =>
      procedimentos!.find((p) => p.name === nome)!.id as string;
    ids.endo = procedimento(NOMES.endo);
    ids.nutro = procedimento(NOMES.nutro);
    ids.botox = procedimento(NOMES.botox);

    // Quem cobre o que: Endocrinologia pela Unimed, Bradesco e Amil;
    // Nutrologia so pela Unimed; Botox por nenhum (so Particular).
    await admin
      .from("procedure_insurance")
      .insert([
        {
          clinic_id: clinicId,
          procedure_id: ids.endo,
          insurance_id: ids.unimed,
        },
        {
          clinic_id: clinicId,
          procedure_id: ids.endo,
          insurance_id: ids.bradesco,
        },
        { clinic_id: clinicId, procedure_id: ids.endo, insurance_id: ids.amil },
        {
          clinic_id: clinicId,
          procedure_id: ids.nutro,
          insurance_id: ids.unimed,
        },
      ])
      .throwOnError();

    const { data: paciente } = await admin
      .from("contact")
      .insert({
        clinic_id: clinicId,
        phone_e164: FONE_DO_PACIENTE,
        name: NOMES.paciente,
        kind: "paciente",
        funnel_stage: "compareceu",
        no_show_count: 0,
      })
      .select("id")
      .single()
      .throwOnError();
    ids.paciente = paciente!.id as string;
  });

  test.afterAll(async ({}, testInfo) => {
    if (testInfo.project.name !== PROJETO_QUE_RODA) {
      return;
    }
    await limparOQueEsteArquivoCria();
  });

  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== PROJETO_QUE_RODA,
      "grava no banco em cadeia: roda uma vez, no desktop",
    );
  });

  test("o médico novo grava os convênios que atende, e o Particular vale sempre", async ({
    page,
  }) => {
    await login(page, dados().emails.gestor);
    await page.goto("/cadastros");

    await page.getByRole("button", { name: "Novo profissional" }).click();
    const dialogo = page.getByRole("dialog");
    await expect(
      dialogo.getByRole("heading", { name: "Novo profissional" }),
    ).toBeVisible();
    await dialogo.getByLabel("Nome", { exact: true }).fill(NOMES.joao);

    const convenios = conveniosQueAtende(dialogo);
    await expect(convenios).toBeVisible();
    // D7: o Particular e texto fixo, sem caixa de marcar.
    await expect(convenios).toContainText("O Particular vale sempre");
    await expect(caixa(convenios, "Particular")).toHaveCount(0);

    await caixa(convenios, NOMES.unimed).check();
    await caixa(convenios, NOMES.bradesco).check();
    await expect(caixa(convenios, NOMES.amil)).not.toBeChecked();
    // Profissional novo nao faz procedimento nenhum: sem previa.
    await expect(dialogo.getByText("Ao salvar", { exact: true })).toHaveCount(
      0,
    );

    await salvarOModal(dialogo);
    await expect(page.getByText("Profissional criado")).toBeVisible();
    expect(await conveniosGravadosDoJoao()).toEqual(
      [ids.unimed, ids.bradesco].sort(),
    );
    // Sem procedimento, nenhum vinculo.
    expect(await vinculosAtivosDoJoao()).toEqual([]);

    // Reaberto, o modal mostra o que foi gravado.
    const reaberto = await abrirOJoao(page);
    const gravados = conveniosQueAtende(reaberto);
    await expect(caixa(gravados, NOMES.unimed)).toBeChecked();
    await expect(caixa(gravados, NOMES.bradesco)).toBeChecked();
    await expect(caixa(gravados, NOMES.amil)).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(reaberto).toBeHidden();
  });

  test("ao colocar o médico, o procedimento coberto recebe o convênio dele sozinho; o Botox, sem cobertura, não", async ({
    page,
  }) => {
    await login(page, dados().emails.gestor);
    await page.goto("/cadastros?aba=procedimentos");

    // Endocrinologia: Unimed, Bradesco e Amil cobrem. Ele atende Unimed e
    // Bradesco, que ja vem marcados; o Amil ele nao atende e nem aparece.
    const endo = await abrirProcedimento(page, NOMES.endo);
    const joaoNaEndo = await colocarOJoao(page, endo);
    await expect(caixa(joaoNaEndo, "Particular")).toBeChecked();
    await expect(caixa(joaoNaEndo, NOMES.unimed)).toBeChecked();
    await expect(caixa(joaoNaEndo, NOMES.bradesco)).toBeChecked();
    await expect(caixa(joaoNaEndo, NOMES.amil)).toHaveCount(0);
    await salvarOModal(endo);

    // Nutrologia: so a Unimed cobre, e vem marcada. O Dr. Joao faz
    // Nutrologia so particular: a excecao, desmarcada so aqui.
    const nutro = await abrirProcedimento(page, NOMES.nutro);
    const joaoNaNutro = await colocarOJoao(page, nutro);
    await expect(caixa(joaoNaNutro, NOMES.unimed)).toBeChecked();
    await expect(caixa(joaoNaNutro, NOMES.bradesco)).toHaveCount(0);
    await caixa(joaoNaNutro, NOMES.unimed).uncheck();
    await expect(caixa(joaoNaNutro, "Particular")).toBeChecked();
    await salvarOModal(nutro);

    // Botox: nenhum convenio cobre, entra so o Particular.
    const botox = await abrirProcedimento(page, NOMES.botox);
    const joaoNoBotox = await colocarOJoao(page, botox);
    await expect(caixa(joaoNoBotox, "Particular")).toBeChecked();
    await expect(caixa(joaoNoBotox, NOMES.unimed)).toHaveCount(0);
    await expect(caixa(joaoNoBotox, NOMES.bradesco)).toHaveCount(0);
    await salvarOModal(botox);

    expect(await vinculosAtivosDoJoao()).toEqual(
      [
        "botox particular",
        "endo bradesco",
        "endo particular",
        "endo unimed",
        "nutro particular",
      ].sort(),
    );
  });

  test("aceite do Dr. João: convênio novo no cadastro dele entra só onde cobre, e a exceção fica", async ({
    page,
  }) => {
    await login(page, dados().emails.gestor);
    await page.goto("/cadastros");

    const dialogo = await abrirOJoao(page);
    const convenios = conveniosQueAtende(dialogo);
    await caixa(convenios, NOMES.amil).check();
    // Previa ao vivo, antes de salvar: o Amil so cobre a Endocrinologia.
    const entra = `${NOMES.amil} entra em 1 procedimento: ${NOMES.endo}.`;
    await expect(dialogo.getByText(entra)).toBeVisible();

    await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Profissional atualizado")).toBeVisible();
    // O resumo vem do que a RPC gravou.
    await expect(page.getByText(entra)).toBeVisible();

    // A Unimed nao volta para a Nutrologia (a excecao fica) e o Botox
    // continua so particular.
    expect(await vinculosAtivosDoJoao()).toEqual(
      [
        "botox particular",
        "endo amil",
        "endo bradesco",
        "endo particular",
        "endo unimed",
        "nutro particular",
      ].sort(),
    );
    expect(await conveniosGravadosDoJoao()).toEqual(
      [ids.unimed, ids.bradesco, ids.amil].sort(),
    );

    // O Amil entrou como Coberto, na duracao do procedimento.
    const { data: amil } = await adminClient()
      .from("service_link")
      .select("price_cents, covered_by_insurance, duration_min")
      .eq("professional_id", await idDoJoao())
      .eq("procedure_id", ids.endo)
      .eq("insurance_id", ids.amil)
      .eq("active", true)
      .single()
      .throwOnError();
    expect(amil).toEqual({
      price_cents: null,
      covered_by_insurance: true,
      duration_min: 40,
    });

    // Na tela da Nutrologia, a Unimed dele continua desmarcada.
    await page.goto("/cadastros?aba=procedimentos");
    const nutro = await abrirProcedimento(page, NOMES.nutro);
    const joao = cartaoDe(nutro, NOMES.joao);
    await expect(caixa(joao, "Particular")).toBeChecked();
    await expect(caixa(joao, NOMES.unimed)).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(nutro).toBeHidden();
  });

  test("tirar um convênio com consulta futura avisa antes e só grava com a confirmação", async ({
    page,
  }) => {
    const admin = adminClient();
    const d = dados();
    const joaoId = await idDoJoao();

    // Consulta pela Unimed na Endocrinologia, daqui a 30 dias, as 10:00 de
    // Fortaleza (direto no banco: o que importa aqui e o aviso).
    const { data: vinculo } = await admin
      .from("service_link")
      .select("id")
      .eq("professional_id", joaoId)
      .eq("procedure_id", ids.endo)
      .eq("insurance_id", ids.unimed)
      .eq("active", true)
      .single()
      .throwOnError();
    const vinculoId = vinculo!.id as string;
    const dia = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await admin
      .from("appointment")
      .insert({
        clinic_id: d.clinicId,
        contact_id: ids.paciente,
        professional_id: joaoId,
        service_link_id: vinculoId,
        starts_at: `${dia}T10:00:00-03:00`,
        ends_at: `${dia}T10:40:00-03:00`,
        status: "agendado",
        confirmation_channel: null,
        is_overbooking: false,
        created_by: "usuario",
        approval_status: null,
      })
      .throwOnError();

    await login(page, d.emails.gestor);
    await page.goto("/cadastros");

    const sai = `${NOMES.unimed} sai de 1 procedimento: ${NOMES.endo}.`;
    const dialogo = await abrirOJoao(page);
    await caixa(conveniosQueAtende(dialogo), NOMES.unimed).uncheck();
    await expect(dialogo.getByText(sai)).toBeVisible();
    await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();

    // D4: o aviso vem ANTES de gravar, com a primeira consulta, e toma o
    // lugar do Salvar.
    const aviso = dialogo
      .getByRole("alert")
      .filter({ hasText: "pelo convênio desmarcado" });
    await expect(aviso).toContainText(
      "Há 1 consulta marcada com este profissional pelo convênio desmarcado.",
    );
    await expect(aviso).toContainText("A primeira é em");
    await expect(
      aviso.getByRole("button", { name: ROTULO_TIRAR_CONVENIO }),
    ).toBeVisible();
    await expect(
      dialogo.getByRole("button", { name: "Salvar", exact: true }),
    ).toHaveCount(0);

    // Cancelar fecha sem gravar nada.
    await dialogo
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await expect(dialogo).toBeHidden();
    expect(await vinculosAtivosDoJoao()).toContain("endo unimed");
    expect(await conveniosGravadosDoJoao()).toContain(ids.unimed);

    // Reaberto, a Unimed continua marcada. Agora com a confirmacao.
    const reaberto = await abrirOJoao(page);
    const convenios = conveniosQueAtende(reaberto);
    await expect(caixa(convenios, NOMES.unimed)).toBeChecked();
    await caixa(convenios, NOMES.unimed).uncheck();
    await reaberto.getByRole("button", { name: "Salvar", exact: true }).click();
    await reaberto
      .getByRole("button", { name: ROTULO_TIRAR_CONVENIO, exact: true })
      .click();
    await expect(reaberto).toBeHidden();
    await expect(page.getByText("Profissional atualizado")).toBeVisible();
    await expect(page.getByText(sai)).toBeVisible();

    // O vinculo foi desativado (nunca apagado) e a consulta continua valendo.
    const { data: depois } = await admin
      .from("service_link")
      .select("active")
      .eq("id", vinculoId)
      .single()
      .throwOnError();
    expect(depois!.active).toBe(false);
    const { data: consulta } = await admin
      .from("appointment")
      .select("status")
      .eq("service_link_id", vinculoId)
      .single()
      .throwOnError();
    expect(consulta!.status).toBe("agendado");
    expect(await conveniosGravadosDoJoao()).not.toContain(ids.unimed);
    expect(await vinculosAtivosDoJoao()).not.toContain("endo unimed");
  });

  test("tirar o único convênio de um procedimento, sem consulta futura, pede só a confirmação (D3)", async ({
    page,
  }) => {
    const admin = adminClient();
    const d = dados();
    const joaoId = await idDoJoao();

    // Check-up: so o Bradesco cobre e o Dr. Joao faz so pelo Bradesco, sem
    // Particular (direto no banco: a tela do procedimento tem os testes
    // dela). Nenhuma consulta nesse vinculo.
    const { data: checkup } = await admin
      .from("procedure")
      .insert({
        clinic_id: d.clinicId,
        name: NOMES.checkup,
        default_duration_min: 30,
        base_price_cents: 30000,
      })
      .select("id")
      .single()
      .throwOnError();
    const checkupId = checkup!.id as string;
    await admin
      .from("procedure_insurance")
      .insert({
        clinic_id: d.clinicId,
        procedure_id: checkupId,
        insurance_id: ids.bradesco,
      })
      .throwOnError();
    const { data: vinculo } = await admin
      .from("service_link")
      .insert({
        clinic_id: d.clinicId,
        professional_id: joaoId,
        procedure_id: checkupId,
        insurance_id: ids.bradesco,
        price_cents: null,
        covered_by_insurance: true,
        duration_min: 30,
      })
      .select("id")
      .single()
      .throwOnError();
    const vinculoId = vinculo!.id as string;

    await login(page, d.emails.gestor);
    await page.goto("/cadastros");

    const dialogo = await abrirOJoao(page);
    // Ninguem mexeu: o Salvar nao manda a lista, entao nao ha previa.
    await expect(dialogo.getByText("Ao salvar", { exact: true })).toHaveCount(
      0,
    );
    await caixa(conveniosQueAtende(dialogo), NOMES.bradesco).uncheck();
    await expect(dialogo.getByText("Ao salvar", { exact: true })).toBeVisible();
    // Pelo teclado: o Salvar sai com o foco quando o aviso entra.
    await dialogo.getByRole("button", { name: "Salvar", exact: true }).focus();
    await page.keyboard.press("Enter");

    // Sem consulta: o aviso so diz quem deixa de fazer e pede a confirmacao.
    // Nada de "as consultas continuam valendo" nem do atalho da Agenda (que
    // sairia de Cadastros perdendo a edicao).
    const aviso = dialogo
      .getByRole("alert")
      .filter({ hasText: "deixa de fazer 1 procedimento" });
    await expect(aviso).toContainText(NOMES.checkup);
    await expect(aviso).not.toContainText("não desmarca nada");
    await expect(aviso.getByRole("link", { name: /Agenda/u })).toHaveCount(0);
    await expect(
      dialogo.getByRole("button", { name: "Salvar", exact: true }),
    ).toHaveCount(0);
    // Nada foi gravado antes da confirmacao.
    expect(await conveniosGravadosDoJoao()).toContain(ids.bradesco);

    // O foco vai para o aviso (nao para o topo do modal) e, sem o atalho da
    // Agenda, o proximo Tab ja cai na confirmacao.
    await expect(dialogo.locator("#prof-aviso-de-consultas")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      aviso.getByRole("button", { name: ROTULO_TIRAR_CONVENIO, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Profissional atualizado")).toBeVisible();

    const { data: depois } = await admin
      .from("service_link")
      .select("active")
      .eq("id", vinculoId)
      .single()
      .throwOnError();
    expect(depois!.active).toBe(false);
    expect(await conveniosGravadosDoJoao()).not.toContain(ids.bradesco);
  });

  test("na criação, o convênio desativado no meio do caminho não leva a jornada junto", async ({
    page,
  }) => {
    const admin = adminClient();
    const d = dados();
    const { data: golden } = await admin
      .from("insurance")
      .insert({ clinic_id: d.clinicId, name: NOMES.golden })
      .select("id")
      .single()
      .throwOnError();
    const goldenId = golden!.id as string;

    await login(page, d.emails.gestor);
    await page.goto("/cadastros");

    await page.getByRole("button", { name: "Novo profissional" }).click();
    const dialogo = page.getByRole("dialog");
    await expect(
      dialogo.getByRole("heading", { name: "Novo profissional" }),
    ).toBeVisible();
    await dialogo.getByLabel("Nome", { exact: true }).fill(NOMES.ana);
    await caixa(conveniosQueAtende(dialogo), NOMES.golden).check();
    // Faixa padrao: segunda, das 08:00 as 12:00.
    await dialogo.getByRole("button", { name: "Adicionar faixa" }).click();

    // Outra aba desativa o convenio antes do Salvar.
    await admin
      .from("insurance")
      .update({ active: false })
      .eq("id", goldenId)
      .throwOnError();

    await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();

    // O profissional e a jornada foram gravados; os convenios nao. O erro
    // diz as tres coisas e o modal continua aberto.
    const erro = dialogo
      .getByRole("alert")
      .filter({ hasText: "O profissional foi criado" });
    await expect(erro).toContainText(
      "mas os convênios que ele atende não. Um convênio desativado não pode ser marcado.",
    );
    await expect(erro).toContainText("A jornada foi salva.");
    await expect(erro).toContainText(
      "Confira os convênios e clique em Salvar de novo.",
    );
    await expect(dialogo).toBeVisible();

    const { data: ana } = await admin
      .from("professional")
      .select("id")
      .eq("clinic_id", d.clinicId)
      .eq("name", NOMES.ana)
      .single()
      .throwOnError();
    const anaId = ana!.id as string;
    const { data: jornada } = await admin
      .from("professional_schedule")
      .select("weekday, starts_at, ends_at")
      .eq("professional_id", anaId)
      .throwOnError();
    expect(jornada).toEqual([
      { weekday: 1, starts_at: "08:00:00", ends_at: "12:00:00" },
    ]);
    const { data: pares } = await admin
      .from("professional_insurance")
      .select("insurance_id")
      .eq("professional_id", anaId)
      .throwOnError();
    expect(pares).toEqual([]);

    // O catalogo recarregou: o convenio desativado aparece com o selo e
    // pode sair. Sem ele, o Salvar seguinte atualiza a mesma medica (sem
    // duplicar) e fecha.
    const desativado = conveniosQueAtende(dialogo).getByRole("checkbox", {
      name: NOMES.golden,
    });
    await expect(desativado).toBeChecked();
    await desativado.uncheck();
    await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Profissional atualizado")).toBeVisible();
    const { data: medicas } = await admin
      .from("professional")
      .select("id")
      .eq("clinic_id", d.clinicId)
      .eq("name", NOMES.ana)
      .throwOnError();
    expect(medicas).toHaveLength(1);
  });
});
