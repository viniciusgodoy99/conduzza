// Simulador de mensagem recebida: faz o papel do uazapi chamando o webhook
// local com o formato canonico e o webhook_secret fixo do seed.
//
// Uso:
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "Oi, quero agendar"
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "..." --name "Maria" --clinic beleza
//
// Tambem serve de demonstracao: a mensagem aparece no Inbox em tempo real.

import {
  DEV_WEBHOOK_SECRET_BELEZA,
  DEV_WEBHOOK_SECRET_VITALIS,
} from "../seed/010-conversas";

const CLINICS = {
  vitalis: {
    id: "00000000-0000-4000-a000-000000000001",
    secret: DEV_WEBHOOK_SECRET_VITALIS,
  },
  beleza: {
    id: "00000000-0000-4000-a000-000000000002",
    secret: DEV_WEBHOOK_SECRET_BELEZA,
  },
} as const;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const phone = argValue("--phone");
  const text = argValue("--text");
  const name = argValue("--name") ?? null;
  const clinicKey = (argValue("--clinic") ?? "vitalis") as keyof typeof CLINICS;
  const baseUrl = argValue("--url") ?? "http://localhost:3000";

  if (!phone || !text) {
    console.error(
      'Uso: npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "mensagem" [--name "Nome"] [--clinic vitalis|beleza]',
    );
    process.exit(1);
  }
  const clinic = CLINICS[clinicKey];
  if (!clinic) {
    console.error(`Clínica desconhecida: ${String(clinicKey)}`);
    process.exit(1);
  }

  const url = `${baseUrl}/api/webhooks/whatsapp?clinic=${clinic.id}&secret=${clinic.secret}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "message_received",
      phone,
      name,
      waMessageId: `sim:${Date.now()}:${Math.floor(Math.random() * 1e6)}`,
      contentType: "texto",
      body: text,
    }),
  });
  const result = await response.text();
  console.log(`HTTP ${response.status}: ${result}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
