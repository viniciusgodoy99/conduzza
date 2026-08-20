import { seedClient } from "./lib";
import { seedNucleo } from "./000-nucleo";
import { seedConversas } from "./010-conversas";

// Orquestrador do seed (npm run seed).
//
// ATENCAO, MUDANCA DE 20/08/2026: o banco remoto passou a ser o ambiente de
// OPERACAO REAL, com clinicas de verdade criadas pelo cadastro. Rodar o seed
// de demonstracao aqui repovoaria o banco com 2 clinicas ficticias, 18
// contatos, 15 conversas e 6 administradores cuja senha esta publicada no
// repositorio. Por isso o seed agora EXIGE confirmacao dupla:
//
//   npx tsx scripts/seed/index.ts --demonstracao --confirmo-poluir-o-banco
//
// A guarda SEED_ALLOW_REMOTE sozinha NAO basta: ela existe desde que este
// projeto remoto era o ambiente de desenvolvimento e continua ligada.
//
// Incrementos futuros (nao criar arquivo antes da fase):
// - 020-catalogo.ts    (Fase 2, tarefa 2.1)
// - 030-agenda.ts      (Fase 2, tarefa 2.3)
// - 040-contatos.ts    (Fase 4, tarefa 4.1)
// - 050-reguas.ts      (Fase 4, tarefa 4.6)

const querDemonstracao = process.argv.includes("--demonstracao");
const confirmou = process.argv.includes("--confirmo-poluir-o-banco");

async function main() {
  if (!querDemonstracao || !confirmou) {
    console.error(
      [
        "Seed de demonstração bloqueado.",
        "",
        "Este comando cria clínicas, contatos e conversas FICTÍCIOS, além de",
        "usuários administradores com senha conhecida. O banco configurado hoje",
        "é o de operação real: rodar isto aqui polui os dados da clínica e",
        "abre acesso indevido.",
        "",
        "Se você tem certeza de que este banco é descartável, rode:",
        "  npx tsx scripts/seed/index.ts --demonstracao --confirmo-poluir-o-banco",
        "",
        "Para criar uma clínica de teste isolada, sem ficção, prefira:",
        '  npx tsx scripts/dev/criar-clinica-teste.ts "Nome da Clínica"',
      ].join("\n"),
    );
    process.exit(1);
  }

  const admin = seedClient();

  const probe = await admin.from("clinic").select("id").limit(1);
  if (probe.error?.code === "PGRST205") {
    throw new Error(
      "As tabelas ainda não existem neste banco. Aplique as migrations primeiro (supabase db push).",
    );
  }

  // Segunda barreira: se o banco JA tem clinica real, nao mistura ficcao.
  const { count } = await admin
    .from("clinic")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    console.error(
      `Bloqueado: este banco já tem ${count} clínica(s). O seed de demonstração só roda em banco vazio, para não misturar ficção com dado real.`,
    );
    process.exit(1);
  }

  console.log("Semeando o núcleo de demonstração...");
  for (const line of await seedNucleo(admin)) {
    console.log(`  ✔ ${line}`);
  }

  console.log("Semeando conversas de demonstração...");
  for (const line of await seedConversas(admin)) {
    console.log(`  ✔ ${line}`);
  }

  console.log("Seed concluído. Rodar de novo não duplica nada.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
