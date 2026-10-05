// Simulador de mensagem recebida (e, com --do-celular, da enviada pelo
// celular da clinica): faz o papel do uazapi chamando o webhook local com o
// formato canonico.
//
// Uso:
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "Oi, quero agendar"
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "..." --name "Maria" --clinic beleza
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "..." --account principal
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "..." --account <id do numero>
//   npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "Pode vir as 15h" --do-celular
//
// Com --do-celular, simula a mensagem que a CLINICA mandou pelo celular
// pareado, fora do sistema (formato canonico clinic_device_reply): --phone e
// o PACIENTE (o destino), e a mensagem aparece na conversa como "Pelo
// WhatsApp". O horario de envio e o de agora, entao uma mensagem do paciente
// enviada ha menos de 8 s faz esta contar como resposta automatica do app.
// So grava para contato que ja existe (senao a resposta diz
// contato_desconhecido, depois das novas tentativas de ate 3 s da saudacao
// para paciente novo); --name nao se aplica.
//
// A mensagem do paciente tambem leva o horario de envio (o de agora), como o
// uazapi: o banco o grava na linha e decide pelos horarios de envio dos dois
// lados quem e resposta automatica.
//
// Sem --account, usa a URL LEGADA (?clinic=&secret=) com o webhook_secret fixo
// do seed: e o caminho das instancias configuradas antes dos varios numeros
// por clinica (docs/07), que continua valendo.
//
// Com --account, usa a URL NOVA (?clinic=&account=&secret=) do numero que
// recebe. O segredo do numero e lido no banco (service role, com a guarda
// anti-producao do seed). "--account principal" escolhe o numero principal
// da clinica de --clinic; um id escolhe aquele numero, de qualquer clinica.
//
// Tambem serve de demonstracao: a mensagem aparece no Inbox em tempo real.

import {
  DEV_WEBHOOK_SECRET_BELEZA,
  DEV_WEBHOOK_SECRET_VITALIS,
} from "../seed/010-conversas";
import { seedClient } from "../seed/lib";

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * O numero que recebe a mensagem simulada e o segredo dele, lidos por id do
 * numero (nunca "o numero da clinica": a clinica pode ter varios).
 */
async function numeroDoWebhook(
  conta: string,
  clinicId: string,
): Promise<{ clinicId: string; accountId: string; secret: string }> {
  const admin = seedClient();
  let accountId = conta;
  if (conta === "principal") {
    const { data } = await admin
      .from("whatsapp_account")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("principal", true)
      .is("removido_em", null)
      .limit(1)
      .throwOnError();
    const principal = data?.[0]?.id as string | undefined;
    if (!principal) {
      throw new Error("Esta clínica não tem número principal ativo.");
    }
    accountId = principal;
  } else if (!UUID_PATTERN.test(conta)) {
    throw new Error('--account espera "principal" ou o id de um número.');
  }

  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .select("clinic_id, webhook_secret")
    .eq("account_id", accountId)
    .maybeSingle()
    .throwOnError();
  if (!segredo) {
    throw new Error("Número sem segredo de webhook (ou inexistente).");
  }
  return {
    clinicId: segredo.clinic_id as string,
    accountId,
    secret: segredo.webhook_secret as string,
  };
}

async function main() {
  const phone = argValue("--phone");
  const text = argValue("--text");
  const name = argValue("--name") ?? null;
  const clinicKey = (argValue("--clinic") ?? "vitalis") as keyof typeof CLINICS;
  const conta = argValue("--account");
  const baseUrl = argValue("--url") ?? "http://localhost:3000";
  const doCelular = process.argv.includes("--do-celular");

  if (!phone || !text) {
    console.error(
      'Uso: npx tsx scripts/dev/simulate-inbound.ts --phone +5584999998888 --text "mensagem" [--name "Nome"] [--clinic vitalis|beleza] [--account principal|<id do número>] [--do-celular]',
    );
    process.exit(1);
  }
  const clinic = CLINICS[clinicKey];
  if (!clinic) {
    console.error(`Clínica desconhecida: ${String(clinicKey)}`);
    process.exit(1);
  }

  let url: string;
  if (conta) {
    const numero = await numeroDoWebhook(conta, clinic.id);
    const parametros = new URLSearchParams({
      clinic: numero.clinicId,
      account: numero.accountId,
      secret: numero.secret,
    });
    url = `${baseUrl}/api/webhooks/whatsapp?${parametros.toString()}`;
  } else {
    const parametros = new URLSearchParams({
      clinic: clinic.id,
      secret: clinic.secret,
    });
    url = `${baseUrl}/api/webhooks/whatsapp?${parametros.toString()}`;
  }
  const sorteio = `${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
  const evento = doCelular
    ? {
        kind: "clinic_device_reply",
        phone,
        waMessageId: `sim:celular:${sorteio}`,
        contentType: "texto",
        body: text,
        enviadaEm: new Date().toISOString(),
      }
    : {
        kind: "message_received",
        phone,
        name,
        waMessageId: `sim:${sorteio}`,
        contentType: "texto",
        body: text,
        enviadaEm: new Date().toISOString(),
      };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(evento),
  });
  const result = await response.text();
  console.log(`HTTP ${response.status}: ${result}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
