import { seedClient } from "./lib";
import { seedNucleo } from "./000-nucleo";
import { seedConversas } from "./010-conversas";

// Orquestrador do seed (npm run seed). Estrategia incremental registrada no
// plano da Fase 0: cada fase do backlog estende o seed no proprio aceite, ate
// cobrir a secao 10 de docs/04 por completo.
//
// Incrementos futuros (nao criar arquivo antes da fase):
// - 020-catalogo.ts    (Fase 2, tarefa 2.1: profissionais, procedimentos,
//                       convenios, vinculos, pacotes, recursos)
// - 030-agenda.ts      (Fase 2, tarefa 2.3: 40 agendamentos nos 10 status)
// - 040-contatos.ts    (Fase 4, tarefa 4.1: completar 60 contatos nas 6
//                       etapas e package_balance)
// - 050-reguas.ts      (Fase 4, tarefa 4.6: regua de confirmacao ativa)

async function main() {
  const admin = seedClient();

  // As tabelas existem? Sem migrations aplicadas, orientar em vez de falhar feio.
  const probe = await admin.from("clinic").select("id").limit(1);
  if (probe.error?.code === "PGRST205") {
    throw new Error(
      "As tabelas ainda não existem neste banco. Aplique as migrations primeiro (supabase db push --db-url ...).",
    );
  }

  console.log("Semeando o núcleo...");
  for (const line of await seedNucleo(admin)) {
    console.log(`  ✔ ${line}`);
  }

  console.log("Semeando conversas...");
  for (const line of await seedConversas(admin)) {
    console.log(`  ✔ ${line}`);
  }

  console.log("Seed concluído. Rodar de novo não duplica nada.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
