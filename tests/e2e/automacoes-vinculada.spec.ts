import { expect, test } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { login } from "./helpers";

// Tela 7, Automacoes: regua vinculada (decisao do dono em 29/09/2026). Na
// aba Confirmacao, o gestor cria uma regua vinculada ao Dr. Joao Pereira: ela
// nasce DESLIGADA, copiando a janela e as mensagens da geral, aparece na
// lista com o vinculo no cabecalho e o medico sai das opcoes do dialogo. A
// recepcao ve o botao desabilitado.
//
// Depende da migration 20260929110000_regua_vinculada.sql (colunas
// professional_id e specialty de cadence) aplicada no banco da suite.
//
// A regua criada e apagada no fim, sempre: tests/e2e/confirmacoes.spec.ts le
// a regua geral da clinica de e2e, e uma vinculada sobrando nao pode
// atrapalhar outro teste.

const NOME_DA_REGUA = "Confirmação: Dr. João Pereira";

function apenasDesktop(): void {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "fluxo independente de viewport",
  );
}

async function apagarVinculadasDoJoao(): Promise<void> {
  await adminClient()
    .from("cadence")
    .delete()
    .eq("clinic_id", dados().clinicId)
    .eq("professional_id", dados().agenda.profJoaoId);
}

test("o gestor cria uma régua de confirmação vinculada a um médico", async ({
  page,
}) => {
  apenasDesktop();
  await apagarVinculadasDoJoao();

  try {
    await login(page, dados().emails.gestor);
    await page.goto("/automacoes?aba=confirmacao");

    await expect(
      page.getByRole("heading", { name: "Réguas vinculadas" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "A régua mais específica vence: procedimento, depois médico, depois especialidade. Sem vínculo, vale a geral.",
        { exact: false },
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Nova régua vinculada" }).click();
    const dialogo = page.getByRole("dialog", { name: "Nova régua vinculada" });
    await expect(dialogo).toBeVisible();

    // "Vincular a" oferece os tres vinculos e, na confirmacao, a reforcada.
    await dialogo.getByRole("combobox", { name: "Vincular a" }).click();
    for (const opcao of [
      "Médico",
      "Especialidade",
      "Procedimento",
      "Reforçada por histórico de falta",
    ]) {
      await expect(page.getByRole("option", { name: opcao })).toBeVisible();
    }
    await page.getByRole("option", { name: "Médico" }).click();

    // Sem medico escolhido, nada a criar.
    const criar = dialogo.getByRole("button", { name: "Criar régua" });
    await expect(criar).toBeDisabled();

    await dialogo.getByRole("combobox", { name: "Médico" }).click();
    await page.getByRole("option", { name: "Dr. João Pereira" }).click();
    await expect(criar).toBeEnabled();
    await criar.click();

    await expect(
      page.getByText("Régua criada, desligada. Ajuste os textos e ligue."),
    ).toBeVisible();
    await expect(dialogo).toBeHidden();

    // O cabecalho mostra o nome, o vinculo (icone e rotulo) e a situacao.
    const cabecalho = page.getByRole("button", {
      name: new RegExp(`^${NOME_DA_REGUA}`),
    });
    await expect(cabecalho).toBeVisible();
    await expect(cabecalho).toContainText("Médico");
    await expect(cabecalho).toContainText("Desligada");

    // No banco: vinculada ao medico, desligada, com a janela e os passos da
    // geral de confirmacao.
    const admin = adminClient();
    const { data: vinculada } = await admin
      .from("cadence")
      .select(
        "id, name, active, procedure_id, specialty, for_no_show_history, send_window_start, send_window_end, send_weekdays",
      )
      .eq("clinic_id", dados().clinicId)
      .eq("kind", "confirmacao")
      .eq("professional_id", dados().agenda.profJoaoId)
      .single()
      .throwOnError();
    expect(vinculada).toMatchObject({
      name: NOME_DA_REGUA,
      active: false,
      procedure_id: null,
      specialty: null,
      for_no_show_history: false,
    });
    const { data: geral } = await admin
      .from("cadence")
      .select("id, send_window_start, send_window_end, send_weekdays")
      .eq("clinic_id", dados().clinicId)
      .eq("kind", "confirmacao")
      .is("procedure_id", null)
      .is("professional_id", null)
      .is("specialty", null)
      .eq("for_no_show_history", false)
      .single()
      .throwOnError();
    expect(vinculada).toMatchObject({
      send_window_start: geral!.send_window_start,
      send_window_end: geral!.send_window_end,
      send_weekdays: geral!.send_weekdays,
    });
    const contarPassos = async (cadenceId: string) => {
      const { count } = await admin
        .from("cadence_step")
        .select("id", { count: "exact", head: true })
        .eq("cadence_id", cadenceId);
      return count ?? 0;
    };
    expect(await contarPassos(vinculada!.id as string)).toBe(
      await contarPassos(geral!.id as string),
    );

    // O medico que ja tem regua de confirmacao sai das opcoes.
    await page.getByRole("button", { name: "Nova régua vinculada" }).click();
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("combobox", { name: "Médico" }).click();
    await expect(
      page.getByRole("option", { name: "Dra. Ana Costa" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Dr. João Pereira" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toBeHidden();
  } finally {
    await apagarVinculadasDoJoao();
  }
});

test("a recepção vê a régua vinculada, mas não cria", async ({ page }) => {
  apenasDesktop();
  await login(page, dados().emails.recepcao);
  await page.goto("/automacoes?aba=confirmacao");

  await expect(
    page.getByRole("heading", { name: "Réguas vinculadas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nova régua vinculada" }),
  ).toBeDisabled();
});
