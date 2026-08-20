import { seedClient } from "../seed/lib";

// Cria uma clinica de teste com administrador, exercitando o mesmo gatilho do
// cadastro publico. Util para validar o webhook e a conexao do WhatsApp sem
// depender de envio de e-mail.
//
//   npx tsx scripts/dev/criar-clinica-teste.ts "Nome da Clínica" email@dominio

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
    .select("name, access_code")
    .eq("id", clinicId)
    .single();

  await admin.from("whatsapp_account").upsert(
    {
      clinic_id: clinicId,
      provider: process.env.WHATSAPP_PROVIDER ?? "fake",
    },
    { onConflict: "clinic_id", ignoreDuplicates: true },
  );
  await admin
    .from("whatsapp_account_secret")
    .upsert(
      { clinic_id: clinicId },
      { onConflict: "clinic_id", ignoreDuplicates: true },
    );
  const { data: segredo } = await admin
    .from("whatsapp_account_secret")
    .select("webhook_secret")
    .eq("clinic_id", clinicId)
    .single();

  const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log("Clínica criada:");
  console.log(`  Nome:     ${clinica?.name}`);
  console.log(`  Id:       ${clinicId}`);
  console.log(`  Código:   ${clinica?.access_code}`);
  console.log(`  Login:    ${email}`);
  console.log(`  Senha:    ${senha}`);
  console.log(
    `  Webhook:  ${base}/api/webhooks/whatsapp?clinic=${clinicId}&secret=${segredo?.webhook_secret}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
