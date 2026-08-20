import { seedClient } from "./seed/lib";

// Apaga os dados de demonstracao e deixa o sistema pronto para operacao real.
// DESTRUTIVO: exige a flag --confirmar. Sem ela, so mostra o que seria apagado.
//
//   npx tsx scripts/limpar-demonstracao.ts             (simulacao)
//   npx tsx scripts/limpar-demonstracao.ts --confirmar (executa)
//
// Preserva: nada de clinica. Cria o dono do produto informado em DONO_EMAIL.

const DONO_EMAIL = process.env.DONO_EMAIL ?? "viniciusrodrigues@grupoclimb.ai";

// Usuarios do seed de demonstracao (dominios ficticios).
const DOMINIOS_DEMO = ["@vitalis.dev", "@belezapura.dev", "@conduzza.dev"];
// Usuarios criados pelas suites de teste.
const PADROES_TESTE = ["@teste.dev"];

const confirmar = process.argv.includes("--confirmar");

async function main() {
  const admin = seedClient();

  const contagem = async (tabela: string) => {
    const { count } = await admin
      .from(tabela)
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  };

  const tabelas = [
    "clinic",
    "unit",
    "contact",
    "contact_consent",
    "conversation",
    "message",
    "ai_decision_log",
    "message_template",
    "audit_log",
  ];

  console.log("Situação atual do banco:");
  for (const tabela of tabelas) {
    console.log(`  ${tabela.padEnd(20)} ${await contagem(tabela)}`);
  }

  const { data: usuarios } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const alvos = (usuarios?.users ?? []).filter((user) => {
    const email = (user.email ?? "").toLowerCase();
    if (email === DONO_EMAIL.toLowerCase()) {
      return false;
    }
    return [...DOMINIOS_DEMO, ...PADROES_TESTE].some((sufixo) =>
      email.endsWith(sufixo),
    );
  });

  console.log(`\nUsuários que seriam removidos (${alvos.length}):`);
  for (const user of alvos) {
    console.log(`  ${user.email}`);
  }

  const outros = (usuarios?.users ?? []).filter(
    (user) =>
      !alvos.includes(user) &&
      (user.email ?? "").toLowerCase() !== DONO_EMAIL.toLowerCase(),
  );
  if (outros.length > 0) {
    console.log(`\nUsuários que NÃO serão tocados (${outros.length}):`);
    for (const user of outros) {
      console.log(`  ${user.email}`);
    }
  }

  if (!confirmar) {
    console.log(
      "\nSimulação: nada foi apagado. Rode de novo com --confirmar para executar.",
    );
    return;
  }

  console.log("\nApagando...");

  // Apagar clinicas derruba em cascata: branding, membros, unidades, contatos,
  // consentimentos, conversas, mensagens, decisoes da IA, contas de WhatsApp,
  // segredos, modelos e auditoria.
  const { error: erroClinicas } = await admin
    .from("clinic")
    .delete()
    .not("id", "is", null);
  if (erroClinicas) {
    throw new Error(`clinic: ${erroClinicas.message}`);
  }
  console.log("  ✔ clínicas e todos os dados vinculados");

  for (const user of alvos) {
    await admin.auth.admin.deleteUser(user.id);
  }
  console.log(`  ✔ ${alvos.length} usuários de demonstração e de teste`);

  // Dono do produto: cria se nao existir, sem senha definida (ele define pelo
  // link de recuperacao, sem senha trafegando por aqui).
  const existente = (usuarios?.users ?? []).find(
    (user) => (user.email ?? "").toLowerCase() === DONO_EMAIL.toLowerCase(),
  );
  let donoId = existente?.id;
  if (!donoId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: DONO_EMAIL,
      email_confirm: true,
      user_metadata: { name: "Vinicius Rodrigues" },
    });
    if (error || !data.user) {
      throw new Error(`dono do produto: ${error?.message}`);
    }
    donoId = data.user.id;
    console.log(`  ✔ usuário do dono do produto criado: ${DONO_EMAIL}`);
  } else {
    console.log(`  ✔ usuário do dono do produto já existia: ${DONO_EMAIL}`);
  }

  const { error: erroAdmin } = await admin
    .from("product_admin")
    .upsert({ user_id: donoId }, { onConflict: "user_id" });
  if (erroAdmin) {
    throw new Error(`product_admin: ${erroAdmin.message}`);
  }
  console.log("  ✔ acesso de dono do produto concedido");

  console.log("\nSituação final:");
  for (const tabela of tabelas) {
    console.log(`  ${tabela.padEnd(20)} ${await contagem(tabela)}`);
  }
  console.log(
    `\nPronto. Defina a senha de ${DONO_EMAIL} pela tela de recuperação de senha.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
