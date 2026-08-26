import { hostname } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { garantirBucketDeMidia, processarLote } from "../lib/jobs/worker";
import { log } from "../lib/log";

// Processo do worker da job_queue. Roda ao lado do servidor web no mesmo
// servidor 24/7 (decisao de deploy de 21/08/2026):
//
//   npm run worker
//
// Concorrencia segura: pode haver mais de um worker (claim_jobs usa FOR
// UPDATE SKIP LOCKED), e o espacamento anti-ban vive no banco, entao mais
// workers NAO furam o limite por numero.

function carregarEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const igual = line.indexOf("=");
    if (igual <= 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    const chave = line.slice(0, igual).trim();
    if (!/^[A-Z0-9_]+$/.test(chave) || process.env[chave] !== undefined) {
      continue;
    }
    // Valor: aspas delimitam quando presentes; sem aspas vale a linha
    // inteira (senhas podem conter # e aspas, entao nada de regex esperta).
    let valor = line.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (valor) {
      process.env[chave] = valor;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  carregarEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Worker precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.",
    );
  }
  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await garantirBucketDeMidia(admin);

  const workerId = `${hostname()}:${process.pid}`;
  log.info("worker_iniciou", { path: workerId });

  // Higiene da agenda: apaga holds vencidos com folga de ~60s. A expiracao
  // LOGICA nao depende disto (toda leitura filtra expires_at > agora); isto
  // so evita acumulo fisico.
  let ultimaLimpezaDeHolds = 0;

  // Planner das reguas (Fase 4.6): materializa os toques devidos e enfileira,
  // numa transacao so. Carimbo PROPRIO, separado do carimbo dos holds: com um
  // so, uma passagem lenta atrasaria a outra tarefa.
  let ultimoPlanejamentoDeReguas = 0;

  let ativo = true;
  process.on("SIGINT", () => {
    ativo = false;
  });
  process.on("SIGTERM", () => {
    ativo = false;
  });

  while (ativo) {
    if (Date.now() - ultimaLimpezaDeHolds > 60_000) {
      ultimaLimpezaDeHolds = Date.now();
      const { error: erroHolds } = await admin.rpc("limpar_holds_vencidos");
      if (erroHolds) {
        log.warn("limpeza_de_holds_falhou", {
          error_code: erroHolds.code ?? null,
        });
      }
    }
    if (Date.now() - ultimoPlanejamentoDeReguas > 60_000) {
      ultimoPlanejamentoDeReguas = Date.now();
      const { data: plano, error: erroPlano } =
        await admin.rpc("planejar_reguas");
      if (erroPlano) {
        // Falha aqui nao derruba o laco: o proximo minuto tenta de novo e o
        // horizonte do planner (30 minutos atras) recupera o que ficou.
        log.warn("planejamento_de_reguas_falhou", {
          error_code: erroPlano.code ?? null,
        });
      } else {
        const contas = (plano ?? {}) as {
          confirmacao?: number;
          pos_falta?: number;
        };
        for (const kind of ["confirmacao", "pos_falta"] as const) {
          const count = contas[kind] ?? 0;
          if (count > 0) {
            log.info("reguas_planejadas", { kind, count });
          }
        }
      }
    }
    let processados = 0;
    try {
      processados = await processarLote(admin, workerId, {
        deveParar: () => !ativo,
      });
    } catch {
      log.error("worker_lote_falhou");
      await sleep(5_000);
      continue;
    }
    if (processados === 0) {
      await sleep(3_000);
    }
  }
  log.info("worker_encerrou", { path: workerId });
}

main().catch((error: unknown) => {
  log.error("worker_morreu");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
