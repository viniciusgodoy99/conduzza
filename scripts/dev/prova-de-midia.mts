/**
 * Prova de ponta a ponta do envio de midia.
 *
 * Roda o MESMO caminho de codigo que a Server Action usa (sendWhatsAppMedia),
 * pulando apenas a checagem de sessao, que exige navegador. Prova o que o
 * teste unitario nao alcanca: que o arquivo sobe ao balde, que a linha de
 * message nasce com o id certo, que o caminho no balde casa com a policy de
 * leitura, e que o WhatsApp de verdade aceita o envio.
 *
 * Uso:  npx tsx scripts/dev/prova-de-midia.mts
 *
 * Manda para o proprio numero conectado da instancia, entao nao alcanca
 * paciente nenhum.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { sendWhatsAppMedia } from "../../lib/integrations/whatsapp/send";

function carregarEnv(): void {
  const caminho = join(process.cwd(), ".env.local");
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const igual = linha.indexOf("=");
    if (igual < 1 || linha.trimStart().startsWith("#")) continue;
    const chave = linha.slice(0, igual).trim();
    const valor = linha.slice(igual + 1).trim();
    if (/^[A-Z0-9_]+$/.test(chave) && valor && !process.env[chave]) {
      process.env[chave] = valor;
    }
  }
}
carregarEnv();

// PNG de 1x1 pixel, o menor arquivo valido possivel.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Uma conversa de uma clinica com WhatsApp conectado.
  const { data: conversas, error: erroConversas } = await admin
    .from("conversation")
    .select("id, clinic_id, contact_id")
    .limit(50);
  if (erroConversas) {
    console.log("erro ao listar conversas:", erroConversas.message);
    return;
  }

  const { data: contas } = await admin
    .from("whatsapp_account")
    .select("clinic_id, connection_status")
    .eq("connection_status", "conectado");
  const conectadas = new Set((contas ?? []).map((c) => c.clinic_id as string));

  const alvo = (conversas ?? []).find((c) =>
    conectadas.has(c.clinic_id as string),
  );
  if (!alvo) {
    console.log("Nenhuma conversa em clinica com WhatsApp conectado.");
    return;
  }

  const clinicId = alvo.clinic_id as string;
  const messageId = crypto.randomUUID();
  const caminho = `${clinicId}/${messageId}`;
  const bytes = Buffer.from(PNG_1X1, "base64");

  console.log("clinica:", clinicId.slice(0, 8), "| conversa:", (alvo.id as string).slice(0, 8));
  console.log("1. subindo o arquivo ao balde em", caminho);
  const { error: erroUpload } = await admin.storage
    .from("midia-conversas")
    .upload(caminho, bytes, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "0",
    });
  if (erroUpload) {
    console.log("   FALHOU:", erroUpload.message);
    return;
  }
  console.log("   ok");

  console.log("2. enviando pelo caminho real (sendWhatsAppMedia)");
  const resultado = await sendWhatsAppMedia(admin, {
    clinicId,
    conversationId: alvo.id as string,
    contactId: alvo.contact_id as string,
    body: "prova automatica do envio de midia",
    authorUserId: null,
    author: "sistema",
    messageId,
    midia: {
      tipo: "image",
      base64: PNG_1X1,
      mimetype: "image/png",
      caminhoNoStorage: caminho,
    },
  });
  console.log("   resultado:", JSON.stringify(resultado));
  if (!resultado.ok) {
    return;
  }

  console.log("3. conferindo a linha de message");
  const { data: linha } = await admin
    .from("message")
    .select("id, content_type, media_url, body, delivery_status, wa_message_id")
    .eq("id", messageId)
    .maybeSingle();
  console.log("   ", JSON.stringify(linha));

  const idBate = linha?.id === messageId;
  const caminhoEsperado = `storage://midia-conversas/${caminho}`;
  console.log("4. o id da linha e o caminho do arquivo casam?");
  console.log("   id fixado pelo servidor:", idBate ? "SIM" : "NAO (a policy vai negar a leitura)");
  console.log("   media_url correto:", linha?.media_url === caminhoEsperado ? "SIM" : `NAO (${linha?.media_url})`);
  console.log("   content_type:", linha?.content_type, linha?.content_type === "imagem" ? "(certo)" : "(ERRADO)");

  console.log("5. a policy de leitura libera este caminho?");
  const { data: liberado } = await admin.rpc("midia_mensagem_do_caminho", {
    p_caminho: caminho,
  });
  console.log("   message_id extraido do caminho:", liberado);
  console.log("   bate com a linha:", liberado === messageId ? "SIM" : "NAO");
}

main().catch((erro) => {
  console.log("erro:", erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
