import { expect, test, type Page } from "@playwright/test";

import { adminClient } from "../rls/stack";
import { dados } from "./dados";
import { E2E_PREFIXO } from "./fixtures";
import { login } from "./helpers";

// Audio recebido do paciente toca ATE O FIM pelo sistema (o dono viu so 2
// segundos tocarem, 02/10/2026). O arquivo e um MP3 sintetico de silencio no
// formato que a uazapi entrega (generate_mp3: MPEG-1 Layer III, 64 kbps,
// 48 kHz, mono): quadros de 192 bytes com a side info zerada, que decodificam
// como silencio. Nenhum dado de paciente.

const BALDE = "midia-conversas";

function mp3DeSilencio(segundos: number): Buffer {
  const quadro = Buffer.alloc(192);
  quadro[0] = 0xff; // sincronia
  quadro[1] = 0xfb; // MPEG-1, Layer III, sem CRC
  quadro[2] = 0x54; // 64 kbps, 48 kHz, sem padding
  quadro[3] = 0xc0; // mono
  const quadros = Math.ceil((segundos * 48_000) / 1152);
  return Buffer.concat(Array.from({ length: quadros }, () => quadro));
}

async function criarAudio(segundos: number): Promise<{
  id: string;
  caminho: string;
}> {
  const admin = adminClient();
  const d = dados();
  const { data } = await admin
    .from("message")
    .insert({
      clinic_id: d.clinicId,
      conversation_id: d.conversas.comAudio,
      wa_message_id: `${E2E_PREFIXO}:audio-${test.info().project.name}-${Date.now()}`,
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
    .upload(caminho, mp3DeSilencio(segundos), {
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

async function estadoDoAudio(page: Page) {
  return page
    .locator("audio")
    .last()
    .evaluate((a: HTMLAudioElement) => ({
      tempo: a.currentTime,
      duracao: a.duration,
      erro: a.error?.code ?? null,
      pausado: a.paused,
      terminou: a.ended,
    }));
}

test("áudio recebido toca além dos primeiros segundos, até o fim", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const audio = await criarAudio(12);
  const pedidos: string[] = [];
  page.on("response", (resposta) => {
    const url = resposta.url();
    if (url.includes("/api/atendimento/midia/")) {
      pedidos.push(
        `rota ${resposta.status()} range=${resposta.request().headers()["range"] ?? "-"}`,
      );
    } else if (url.includes("/storage/v1/object/")) {
      pedidos.push(
        `storage ${resposta.status()} range=${resposta.request().headers()["range"] ?? "-"}`,
      );
    }
  });
  try {
    await login(page, dados().emails.admin);
    await page.goto(`/atendimento?conversa=${dados().conversas.comAudio}`);
    const tocar = page.getByRole("button", { name: "Tocar o áudio" }).last();
    await expect(tocar).toBeVisible();
    await tocar.click();

    // Passa dos 2 segundos que o dono viu, e segue tocando.
    await expect
      .poll(async () => (await estadoDoAudio(page)).tempo, {
        timeout: 15_000,
        message: `pedidos: ${pedidos.join(" | ")}`,
      })
      .toBeGreaterThan(5);
    // E chega ao fim (12 s): o player volta ao "Tocar".
    await expect(
      page.getByRole("button", { name: "Tocar o áudio" }).last(),
    ).toBeVisible({ timeout: 20_000 });
    const fim = await estadoDoAudio(page);
    expect(fim.erro, `pedidos: ${pedidos.join(" | ")}`).toBeNull();
    // A correcao, e nao so o preload: o navegador nunca recebe a URL
    // assinada (nenhum pedido direto ao Storage), so 206 da propria rota.
    expect(pedidos.some((p) => p.startsWith("rota 206"))).toBe(true);
    expect(pedidos.filter((p) => p.startsWith("storage"))).toEqual([]);
  } finally {
    test.info().annotations.push({
      type: "pedidos",
      description: pedidos.join(" | "),
    });
    await apagarAudio(audio);
  }
});

test("áudio em 2x toca mais rápido e a escolha fica para os próximos", async ({
  page,
}) => {
  // Velocidade como no WhatsApp (pedido do dono em 06/10/2026).
  test.setTimeout(90_000);
  const audio = await criarAudio(12);
  try {
    await login(page, dados().emails.admin);
    await page.evaluate(() =>
      window.localStorage.removeItem("cz-audio-velocidade"),
    );
    await page.goto(`/atendimento?conversa=${dados().conversas.comAudio}`);
    const velocidade = page
      .getByRole("button", { name: /^Velocidade do áudio: / })
      .last();
    await expect(velocidade).toHaveAccessibleName(
      "Velocidade do áudio: 1x. Trocar para 1,5x",
    );
    await velocidade.click();
    await expect(velocidade).toHaveAccessibleName(
      "Velocidade do áudio: 1,5x. Trocar para 2x",
    );
    await velocidade.click();
    await expect(velocidade).toHaveText("2x");

    await page.getByRole("button", { name: "Tocar o áudio" }).last().click();
    await expect
      .poll(async () => (await estadoDoAudio(page)).tempo, { timeout: 15_000 })
      .toBeGreaterThan(1);
    const rate = await page
      .locator("audio")
      .last()
      .evaluate((a: HTMLAudioElement) => a.playbackRate);
    expect(rate).toBe(2);

    // A conversa aberta de novo (o Inbox limpa o ?conversa= depois de
    // abrir, entao e pelo link outra vez): continua em 2x.
    await page.goto(`/atendimento?conversa=${dados().conversas.comAudio}`);
    await expect(
      page.getByRole("button", { name: /^Velocidade do áudio: / }).last(),
    ).toHaveText("2x");
  } finally {
    await page
      .evaluate(() => window.localStorage.removeItem("cz-audio-velocidade"))
      .catch(() => undefined);
    await apagarAudio(audio);
  }
});

test("áudio longo tocado um tempo depois de abrir a conversa não para no que já carregou", async ({
  page,
}) => {
  test.setTimeout(Number(process.env.ESPERA_DO_AUDIO_MS ?? 20_000) + 150_000);
  // 150 s a 64 kbps = 1,2 MB: mais de um pedaco de 1 MiB, entao o
  // navegador encadeia pelo menos dois 206 da rota.
  const audio = await criarAudio(150);
  const pedidos: string[] = [];
  page.on("response", (resposta) => {
    const url = resposta.url();
    if (
      url.includes("/api/atendimento/midia/") ||
      url.includes("/storage/v1/object/")
    ) {
      pedidos.push(
        `${url.includes("/api/") ? "rota" : "storage"} ${resposta.status()} range=${resposta.request().headers()["range"] ?? "-"}`,
      );
    }
  });
  page.on("requestfailed", (pedido) => {
    if (
      pedido.url().includes("/storage/v1/object/") ||
      pedido.url().includes("/api/atendimento/midia/")
    ) {
      pedidos.push(`FALHOU ${pedido.failure()?.errorText ?? "?"}`);
    }
  });
  try {
    await login(page, dados().emails.admin);
    await page.goto(`/atendimento?conversa=${dados().conversas.comAudio}`);
    const tocar = page.getByRole("button", { name: "Tocar o áudio" }).last();
    await expect(tocar).toBeVisible();
    // A recepcao abre a conversa e so toca depois. Ate 02/10/2026 o navegador
    // ja tinha o comeco do audio e pedia o resto a uma URL assinada de 5
    // minutos: depois disso o audio parava em uns 4 segundos (reproduzido
    // com ESPERA_DO_AUDIO_MS=330000). Agora a rota entrega cada pedaco com a
    // sessao, e nada expira. O padrao (20 s) mantem a suite rapida.
    await page.waitForTimeout(Number(process.env.ESPERA_DO_AUDIO_MS ?? 20_000));
    await tocar.click();
    await expect
      .poll(async () => (await estadoDoAudio(page)).tempo, {
        timeout: 30_000,
        message: `pedidos: ${pedidos.join(" | ")}`,
      })
      .toBeGreaterThan(15);
    const estado = await estadoDoAudio(page);
    expect(estado.erro, `pedidos: ${pedidos.join(" | ")}`).toBeNull();
    await expect
      .poll(() => pedidos.filter((p) => p.startsWith("rota 206")).length, {
        timeout: 30_000,
        message: `pedidos: ${pedidos.join(" | ")}`,
      })
      .toBeGreaterThanOrEqual(2);
    expect(pedidos.filter((p) => p.startsWith("storage"))).toEqual([]);
  } finally {
    console.log("PEDIDOS", test.info().project.name, pedidos.join(" | "));
    await apagarAudio(audio);
  }
});
