import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Tela 2, Confirmacoes (tarefa 4.7): o painel do dia seguinte, o chip que
// separa quem confirmou pelo WhatsApp de quem confirmou pela recepcao, o
// alerta de quem ja faltou, a aba de faltas e o painel da regua.
//
// O canal desta maquina e REAL: o teste que liga a regua devolve a clinica ao
// estado desligado no final, e a clinica de e2e usa provider fake.

const NOME_PENDENTE = "Fátima Faltas";
const NOME_WHATSAPP = "Roberto Recibo";
const NOME_RECEPCAO = "Camila Áudio";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

async function desligarRegua(
  kind: "confirmacao" | "pos_falta" = "confirmacao",
): Promise<void> {
  const admin = adminClient();
  await admin
    .from("cadence")
    .update({
      active: false,
      send_window_start: null,
      send_window_end: null,
      send_weekdays: null,
    })
    .eq("clinic_id", dados().clinicId)
    .eq("kind", kind);
}

async function reguaAtiva(kind: "confirmacao" | "pos_falta"): Promise<boolean> {
  const { data } = await adminClient()
    .from("cadence")
    .select("active")
    .eq("clinic_id", dados().clinicId)
    .eq("kind", kind)
    .is("procedure_id", null)
    .eq("for_no_show_history", false)
    .single();
  return Boolean(data?.active);
}

/** Preenche a janela de envio e salva. O interruptor só libera depois disto. */
async function preencherJanela(page: Page): Promise<void> {
  await page.getByLabel("Começa às").fill("08:00");
  await page.getByLabel("Termina às").fill("20:00");
  for (const dia of [
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
  ]) {
    await page.getByRole("button", { name: dia }).click();
  }
  await page.getByRole("button", { name: "Salvar horário" }).click();
}

test("abre no dia seguinte e o painel mostra as situações do dia", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/confirmacoes");

  // O cartao heroi e o de pendentes, com o total do dia ao lado.
  await expect(page.getByText("Pendentes", { exact: true })).toBeVisible();
  await expect(page.getByText(/de \d+ consultas? no dia/)).toBeVisible();
  await expect(page.getByText("Confirmadas", { exact: true })).toBeVisible();
  await expect(page.getByText("Canceladas", { exact: true })).toBeVisible();

  // As consultas de amanha aparecem na lista.
  await expect(page.getByText(NOME_PENDENTE)).toBeVisible();
  await expect(page.getByText(NOME_WHATSAPP)).toBeVisible();
});

test("Recuperadas não inventa número enquanto a lista de espera não existe", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/confirmacoes");

  await expect(page.getByText("Recuperadas", { exact: true })).toBeVisible();
  await expect(page.getByText("Chega com a lista de espera")).toBeVisible();
  await expect(page.getByText("ainda sem número")).toBeAttached();
});

test("o chip diferencia quem confirmou pelo WhatsApp de quem confirmou na recepção", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/confirmacoes");

  // Duas coisas diferentes precisam parecer diferentes (brief da Tela 2).
  await expect(page.getByText("Confirmado por WhatsApp").first()).toBeVisible();
  await expect(
    page.getByText("Confirmado pela recepção").first(),
  ).toBeVisible();
  await expect(page.getByText(NOME_RECEPCAO)).toBeVisible();
});

test("paciente com histórico de falta aparece com alerta antes do nome", async ({
  page,
}) => {
  await login(page, dados().emails.gestor);
  await page.goto("/confirmacoes");

  await expect(page.getByText(NOME_PENDENTE)).toBeVisible();
  await expect(page.getByText(/faltas? anterior/i).first()).toBeAttached();
});

test("a aba de faltas de hoje lista quem faltou", async ({ page }) => {
  await login(page, dados().emails.gestor);
  await page.goto("/confirmacoes?aba=faltas");

  await expect(page.getByRole("tab", { name: /Faltas de hoje/ })).toBeVisible();
  await expect(page.getByText("Paulo Pacote")).toBeVisible();
});

test("a régua não liga sem a clínica informar o horário, e liga depois", async ({
  page,
}) => {
  apenasDesktop();
  await desligarRegua();

  await login(page, dados().emails.admin);
  await page.goto("/confirmacoes");
  await page.getByRole("button", { name: "Mensagens automáticas" }).click();

  const interruptor = page.getByRole("switch", {
    name: "Ligar a régua de confirmação",
  });
  await expect(interruptor).toBeVisible();
  await expect(interruptor).toBeDisabled();

  // A dica explica o que falta, ao focar o involucro do controle desabilitado.
  await interruptor.locator("..").focus();
  await expect(
    page.getByText(/Preencha e salve a hora de início/),
  ).toBeVisible();

  // Com a janela preenchida e salva, o interruptor libera.
  await preencherJanela(page);
  await expect(interruptor).toBeEnabled({ timeout: 10_000 });

  try {
    // A primeira ativação da clínica avisa sobre a linha de base.
    await interruptor.click();
    await expect(
      page.getByText("Antes de ligar, anote a taxa de falta"),
    ).toBeVisible();
    expect(await reguaAtiva("confirmacao")).toBe(false);

    // E o aviso não é decoração: confirmar LIGA a régua de verdade. Enquanto
    // este teste parava no aviso, alternarReguaAction com ativar: true nunca
    // rodava em teste nenhum.
    await page.getByRole("button", { name: "Anotei, pode ligar" }).click();
    await expect(interruptor).toBeChecked({ timeout: 10_000 });
    // exact: true separa o rótulo do painel do aviso momentâneo ("Régua
    // ligada."), que diz quase a mesma coisa.
    await expect(page.getByText("Régua ligada", { exact: true })).toBeVisible();
    expect(await reguaAtiva("confirmacao")).toBe(true);

    // Desligar pela tela também precisa funcionar.
    await interruptor.click();
    await expect(interruptor).not.toBeChecked({ timeout: 10_000 });
    expect(await reguaAtiva("confirmacao")).toBe(false);
  } finally {
    // O canal desta máquina é real: nenhuma régua fica ligada ao fim.
    await desligarRegua();
  }
});

test("a recuperação depois da falta tem caminho de ativação própria", async ({
  page,
}) => {
  apenasDesktop();
  await desligarRegua("pos_falta");

  await login(page, dados().emails.admin);
  await page.goto("/confirmacoes");
  await page.getByRole("button", { name: "Mensagens automáticas" }).click();

  // O motor executa as duas réguas; sem esta aba a de pós falta era código
  // que nunca podia rodar.
  await page.getByRole("button", { name: "Depois da falta" }).click();

  const interruptor = page.getByRole("switch", {
    name: "Ligar a régua de recuperação depois da falta",
  });
  await expect(interruptor).toBeVisible();
  await expect(interruptor).toBeDisabled();
  await expect(page.getByText("Recuperação desligada")).toBeVisible();

  await preencherJanela(page);
  await expect(interruptor).toBeEnabled({ timeout: 10_000 });

  try {
    await interruptor.click();
    // Já houve primeira ativação nesta clínica ou não: o aviso da linha de
    // base só aparece antes do primeiro envio, então aceita os dois caminhos.
    const aviso = page.getByRole("button", { name: "Anotei, pode ligar" });
    if (await aviso.isVisible().catch(() => false)) {
      await aviso.click();
    }
    await expect(interruptor).toBeChecked({ timeout: 10_000 });
    expect(await reguaAtiva("pos_falta")).toBe(true);
  } finally {
    await desligarRegua("pos_falta");
  }
});

test("recepção opera a tela, mas não mexe na régua", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.recepcao);
  await page.goto("/confirmacoes");

  await expect(page.getByText(NOME_PENDENTE)).toBeVisible();

  await page.getByRole("button", { name: "Mensagens automáticas" }).click();
  const interruptor = page.getByRole("switch", {
    name: "Ligar a régua de confirmação",
  });
  await expect(interruptor).toBeVisible();
  await expect(interruptor).toBeDisabled();
});
