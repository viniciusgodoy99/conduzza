import { provisionarDemonstracaoClinica } from "./demo-catalogo";
import { seedClient } from "../seed/lib";

// Cria uma clinica de teste com administrador, exercitando o mesmo gatilho do
// cadastro publico. Util para validar o webhook e a conexao do WhatsApp sem
// depender de envio de e-mail.
//
//   npx tsx scripts/dev/criar-clinica-teste.ts "Nome da Clínica" email@dominio
//   npx tsx scripts/dev/criar-clinica-teste.ts "Nome" email --com-demonstracao
//     (tambem provisiona o catalogo do Dr. Joao, agenda de amanha, encaixe da
//      IA pendente e hold, para ver as Telas 3 e 8 com dados)

async function main() {
  const nomeClinica = process.argv[2] ?? `Clínica Teste ${Date.now()}`;
  const email =
    process.argv[3] ?? `teste-${Date.now().toString(36).slice(-6)}@teste.dev`;
  const senha = "Conduzza!Teste2026";

  const admin = seedClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: {
      tipo: "clinica",
      nome: "Administrador de Teste",
      nome_clinica: nomeClinica,
      name: "Administrador de Teste",
    },
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário: ${error?.message}`);
  }

  const { data: membro } = await admin
    .from("clinic_member")
    .select("clinic_id")
    .eq("user_id", data.user.id)
    .single();
  const clinicId = membro!.clinic_id as string;

  const { data: clinica } = await admin
    .from("clinic")
    .select("name")
    .eq("id", clinicId)
    .single();
  // Entrada por codigo nasce desligada (padrao seguro): liga para o teste.
  await admin
    .from("clinic")
    .update({ allow_code_signup: true })
    .eq("id", clinicId);
  const { data: acesso } = await admin
    .from("clinic_access_code")
    .select("code")
    .eq("clinic_id", clinicId)
    .single();

  // O numero principal da clinica e o segredo dele, chaveado pelo numero
  // (varios numeros por clinica, docs/07). Sem depender do unique temporario
  // (clinic_id), que sai na Fase 3: usa o principal ativo se ja existir.
  const { data: existentes } = await admin
    .from("whatsapp_account")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("principal", true)
    .is("removido_em", null)
    .limit(1)
    .throwOnError();
  let accountId = (existentes?.[0]?.id as string | undefined) ?? null;
  if (!accountId) {
    const { data: novo } = await admin
      .from("whatsapp_account")
      .insert({
        clinic_id: clinicId,
        provider: process.env.WHATSAPP_PROVIDER ?? "fake",
      })
      .select("id")
      .single()
      .throwOnError();
    accountId = novo!.id as string;
  }
  await admin
    .from("whatsapp_account_secret")
    .upsert(
      { clinic_id: clinicId, account_id: accountId },
      { onConflict: "account_id", ignoreDuplicates: true },
    )
    .throwOnError();
  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .select("webhook_secret")
    .eq("account_id", accountId)
    .single();

  if (process.argv.includes("--com-demonstracao")) {
    console.log("Provisionando a demonstração do catálogo e da agenda...");
    for (const linha of await provisionarDemonstracaoClinica(admin, clinicId)) {
      console.log(`  ✔ ${linha}`);
    }
  }

  const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log("Clínica criada:");
  console.log(`  Nome:     ${clinica?.name}`);
  console.log(`  Id:       ${clinicId}`);
  console.log(`  Código:   ${acesso?.code}`);
  console.log(`  Login:    ${email}`);
  console.log(`  Senha:    ${senha}`);
  console.log(`  Número:   ${accountId}`);
  console.log(
    `  Webhook:  ${base}/api/webhooks/whatsapp?clinic=${clinicId}&account=${accountId}&secret=${segredo?.webhook_secret}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
