import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_PREFIXO } from "./fixtures";
import { login } from "./helpers";

// AG6b (desenho da AG6b, secoes 6 e 8.5): a midia na conversa com a IA na
// tela. O que este spec confere e o que da para conferir com a suite de
// navegador como ela e:
//   - a clinica do e2e NAO esta na lista da fase controlada do agente (a
//     lista nao aceita clinica e_de_teste; tests/e2e/ia-whatsapp.spec.ts),
//     entao a Tela 6 e o vazio de sempre: as duas habilidades, a nota do
//     simulador, o aviso novo, o dialogo do "Ligar de novo" e o chip "Sem
//     áudio, foto e documento" estao nos testes de unidade
//     (tests/unit/agente/telas-ag6b.test.tsx e telefone-aviso-novo.test.tsx);
//   - ia_leitura_da_midia so aceita gravacao pela RPC gravar_leitura_da_midia
//     (job em execucao com posse, ai_turno, conversa com a IA, habilidade
//     publicada, telefone com o aviso 2): nem a service role grava direto
//     (42501). As duas linhas na bolha ("Transcrição do assistente:" e "Lido
//     pelo assistente:"), o sem fala, a figurinha e o "indisponível agora"
//     estao em tests/unit/atendimento/leitura-da-midia.test.tsx.
// Aqui: o audio do paciente na conversa de uma clinica fora da fase continua
// como era (nada do assistente embaixo, nem no erro), e a bolha passa no
// contraste nos dois temas. O MP3 e sintetico (silencio), como no
// tests/e2e/audio.spec.ts; nenhum dado de paciente.
//
// Escrito na leva da AG6b e ainda NAO rodado (depende da migration
// 20261030100000 aplicada; sem ela, a consulta das leituras so volta vazia,
// e este spec passa do mesmo jeito).

const BALDE = "midia-conversas";

test.beforeEach(() => {
  test.skip(
    test.info().project.name !== "desktop-1600",
    "conteudo identico em todos os viewports",
  );
});

function mp3DeSilencio(segundos: number): Buffer {
  const quadro = Buffer.alloc(192);
  quadro[0] = 0xff;
  quadro[1] = 0xfb;
  quadro[2] = 0x54;
  quadro[3] = 0xc0;
  const quadros = Math.ceil((segundos * 48_000) / 1152);
  return Buffer.concat(Array.from({ length: quadros }, () => quadro));
}

async function criarAudio(): Promise<{ id: string; caminho: string }> {
  const admin = adminClient();
  const d = dados();
  const { data } = await admin
    .from("message")
    .insert({
      clinic_id: d.clinicId,
      conversation_id: d.conversas.comAudio,
      wa_message_id: `${E2E_PREFIXO}:midia-ia-${test.info().project.name}-${Date.now()}`,
      direction: "entrada",
      author: "paciente",
      content_type: "audio",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  const id = (data as { id: string }).id;
  const caminho = `${d.clinicId}/${id}`;
  const { error } = await admin.storage
    .from(BALDE)
    .upload(caminho, mp3DeSilencio(3), {
      contentType: "audio/mpeg",
      upsert: true,
    });
  if (error) {
    throw new Error(`upload: ${error.message}`);
  }
  await admin
    .from("message")
    .update({
      media_url: `storage://${BALDE}/${caminho}`,
      media_mimetype: "audio/mpeg",
    })
    .eq("id", id)
    .throwOnError();
  return { id, caminho };
}

async function apagarAudio(audio: { id: string; caminho: string }) {
  const admin = adminClient();
  await admin.storage.from(BALDE).remove([audio.caminho]);
  await admin.from("message").delete().eq("id", audio.id);
}

async function semViolacaoDeContraste(page: Page, messageId: string) {
  const resultado = await new AxeBuilder({ page })
    .include(`#mensagem-${messageId}`)
    .withRules(["color-contrast"])
    .analyze();
  expect(resultado.violations).toEqual([]);
}

test("fora da fase do agente, o áudio do paciente continua sem nada do assistente, nos dois temas", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const audio = await criarAudio();
  try {
    await login(page, dados().emails.recepcao);
    await page.goto(`/atendimento?conversa=${dados().conversas.comAudio}`);
    const fio = page.getByRole("region", { name: "Conversa aberta" });
    const linha = fio.locator(`#mensagem-${audio.id}`);
    await expect(
      linha.getByRole("button", { name: "Tocar o áudio" }),
    ).toBeVisible();

    // Nenhuma linha do assistente: nem leitura, nem o erro dela.
    for (const texto of [
      "Transcrição do assistente:",
      "Lido pelo assistente:",
      "Leitura do assistente indisponível agora.",
    ]) {
      await expect(linha.getByText(texto)).toHaveCount(0);
    }
    await expect(linha.locator("[data-leitura]")).toHaveCount(0);

    // Claro (padrao) e escuro: a bolha do audio passa no contraste.
    await semViolacaoDeContraste(page, audio.id);
    await page.getByRole("button", { name: "Mudar para tema escuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      linha.getByRole("button", { name: "Tocar o áudio" }),
    ).toBeVisible();
    await semViolacaoDeContraste(page, audio.id);
  } finally {
    await apagarAudio(audio);
  }
});
