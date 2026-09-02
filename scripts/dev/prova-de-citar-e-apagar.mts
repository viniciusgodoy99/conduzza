/**
 * Prova de ponta a ponta de responder citando e de apagar para todos.
 *
 * O que os testes automatizados NAO alcancam: se o servidor uazapi de verdade
 * aceita o campo `replyid` e a rota /message/delete com o nosso token. O
 * contrato veio da especificacao oficial, e especificacao ja divergiu do
 * servidor antes (foi assim que descobrimos que /send/media quer base64 e nao
 * URL).
 *
 * Uso:  npx tsx scripts/dev/prova-de-citar-e-apagar.mts
 *
 * Manda para o PROPRIO NUMERO conectado da instancia, entao nao alcanca
 * paciente nenhum. Voce vai ver, no seu WhatsApp: uma mensagem chegar, uma
 * segunda chegar CITANDO a primeira, e a segunda virar "mensagem apagada".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { getWhatsAppProvider } from "../../lib/integrations/whatsapp/provider";

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

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: conta } = await admin
    .from("whatsapp_account")
    .select("clinic_id, provider, server_url, instance_id, display_phone")
    .eq("connection_status", "conectado")
    .limit(1)
    .maybeSingle();
  if (!conta) {
    console.log("Nenhuma clínica com WhatsApp conectado. Nada a provar.");
    return;
  }
  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .select("instance_token")
    .eq("clinic_id", conta.clinic_id)
    .maybeSingle();

  // O numero conectado vem de /instance/status (campo `owner`), e nao de
  // whatsapp_account.display_phone: aquela coluna guarda o nome do perfil,
  // porque e o que a tela de conexao mostra.
  let base =
    (conta.server_url as string | null) ?? process.env.UAZAPI_SERVER_URL ?? "";
  if (!/^https?:\/\//.test(base)) base = `https://${base}`;
  const status = (await fetch(`${base.replace(/\/+$/, "")}/instance/status`, {
    headers: { token: segredo?.instance_token as string },
  }).then((r) => r.json())) as { instance?: { owner?: string } };
  const destino = status.instance?.owner?.replace(/\D/g, "");
  if (!destino) {
    console.log("A instância não informa o próprio número; abortando.");
    return;
  }

  const provider = getWhatsAppProvider(conta.provider as string);
  const ref = {
    clinicId: conta.clinic_id as string,
    serverUrl: (conta.server_url as string | null) ?? null,
    instanceToken: (segredo?.instance_token as string | null) ?? null,
    instanceId: (conta.instance_id as string | null) ?? null,
  };

  console.log("provedor:", provider.name, "| destino:", destino);

  console.log("1. enviando a mensagem que será citada");
  const primeira = await provider.sendText(
    ref,
    destino,
    "Prova do Conduzza: esta é a mensagem original.",
  );
  console.log("  ", JSON.stringify(primeira));
  if (!primeira.ok) {
    return;
  }
  await esperar(2_500);

  console.log("2. enviando uma resposta CITANDO a primeira (replyid)");
  const segunda = await provider.sendText(
    ref,
    destino,
    "Prova do Conduzza: esta responde a de cima, e vai ser apagada em 5 segundos.",
    { replyToWaMessageId: primeira.waMessageId },
  );
  console.log("  ", JSON.stringify(segunda));
  console.log(
    "   Confira no celular: a segunda deve aparecer com a primeira citada em cima.",
  );
  if (!segunda.ok) {
    return;
  }

  await esperar(5_000);

  console.log("3. apagando a segunda para todos (/message/delete)");
  const apagou = await provider.deleteMessage(ref, segunda.waMessageId);
  console.log("  ", JSON.stringify(apagou));
  console.log(
    apagou.ok
      ? "   Confira no celular: a segunda deve ter virado 'mensagem apagada'."
      : "   FALHOU: o apagar para todos não funcionou com este servidor.",
  );
}

main().catch((erro) => {
  console.log("erro:", erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
