import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { executarPassagemDoMotor } from "../lib/jobs/motor";
import { log } from "../lib/log";

// O motor de automacao num laco local: o MESMO motor de producao, fora do
// pg_cron.
//
//   npm run worker
//
// Em producao quem dispara e o pg_cron, dentro do Supabase (ver
// supabase/operacao/motor-por-cron.md): a cada 20 segundos ele chama a rota
// /api/webhooks/motor, que roda executarPassagemDoMotor, e a cada 60 roda
// motor_manutencao() no proprio banco. Este laco faz as duas coisas, na mesma
// cadencia e com o mesmo codigo, para dois usos:
//
// 1. Desenvolvimento e testes de navegador num banco sem pg_cron.
// 2. Ponte de emergencia, depois de motor_desagendar(), enquanto o cron ou a
//    Vercel sao consertados. Ele bate ponto como motor-fila (dentro de
//    executarPassagemDoMotor) e como motor-planner (dentro de
//    motor_manutencao), entao a faixa "as mensagens automaticas estao
//    paradas" some de verdade e o monitor externo volta a responder 200.
//
// Ao lado do pg_cron ligado ele nao duplica envio: o claim usa FOR UPDATE
// SKIP LOCKED e o espacamento anti-ban vive no banco, como ja acontece com as
// duas invocacoes da rota que se sobrepoem em producao. Mas as batidas se
// misturam: com este laco de pe, nem a faixa nem o monitor enxergam o cron
// parado. Contra o banco de producao, so durante incidente.
//
// Clinicas e_de_teste ficam de fora, como no motor de producao: as suites de
// integracao executam os proprios jobs.

/** Cadencia do pg_cron para a entrada motor-fila. */
const CADENCIA_DA_FILA_MS = 20_000;
/** Cadencia do pg_cron para a entrada motor-manutencao. */
const CADENCIA_DA_MANUTENCAO_MS = 60_000;

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

/** O que motor_manutencao() devolve, so as partes que viram log. */
type ResultadoDaManutencao = {
  reguas?: Record<string, unknown> | null;
  erros?: string[] | null;
};

/** O papel motor-planner: a manutencao inteira, dentro do banco. */
async function manutencao(admin: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await admin.rpc("motor_manutencao");
    if (error) {
      // Falha aqui nao derruba o laco: o proximo minuto tenta de novo e o
      // horizonte do planner (30 minutos atras) recupera o que ficou.
      log.warn("motor_manutencao_falhou", { error_code: error.code ?? null });
      return;
    }
    const resultado = (data ?? {}) as ResultadoDaManutencao;
    for (const [kind, count] of Object.entries(resultado.reguas ?? {})) {
      if (typeof count === "number" && count > 0) {
        log.info("reguas_planejadas", { kind, count });
      }
    }
    // Cada erro ja e um codigo curto ("planejar_reguas:42P01"). A funcao
    // engole a excecao de cada rotina para as outras seguirem, entao sem este
    // log o erro so apareceria em saude_do_motor().
    for (const erro of resultado.erros ?? []) {
      log.warn("motor_manutencao_com_erro", { error_code: erro });
    }
  } catch (erro) {
    log.error("motor_manutencao_falhou", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
  }
}

/** O papel motor-fila: uma passagem, como a rota faz a cada tick. */
async function passagem(admin: SupabaseClient): Promise<void> {
  try {
    await executarPassagemDoMotor(admin, { executorId: "motor-fila" });
  } catch (erro) {
    // A passagem trata o erro de cada job; isto cobre a rede caindo nas RPCs
    // de claim ou de fechamento. Um job que ficou 'executando' volta pelo
    // lease.
    log.error("motor_passagem_falhou", {
      error_code: erro instanceof Error ? erro.name : "desconhecido",
    });
  }
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

  // O balde de midia nao e mais criado aqui: nasce na migration
  // 20260902120000 e motor_manutencao() reafirma que ele e privado.
  log.info("worker_iniciou", { path: "motor-fila" });

  // Ctrl+C (ou SIGTERM) nao corta a passagem em voo: abandonar um job no meio
  // deixaria uma mensagem saindo sem ninguem para gravar o resultado. O sinal
  // so acorda a espera e impede a proxima volta.
  let ativo = true;
  let acordar: (() => void) | null = null;
  const parar = () => {
    ativo = false;
    acordar?.();
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
  const esperar = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        acordar = null;
        resolve();
      }, ms);
      acordar = () => {
        clearTimeout(timer);
        acordar = null;
        resolve();
      };
    });

  // Cadencia contada do INICIO de cada tarefa, como o cron: uma passagem de
  // 30 segundos nao empurra a seguinte para 50. Se a passagem passa da
  // cadencia, a proxima comeca na hora (o cron sobreporia as duas; aqui elas
  // so encostam).
  let proximaManutencao = 0;
  let proximaFila = 0;
  while (ativo) {
    // Manutencao primeiro: o que o planner acabou de enfileirar ja sai na
    // passagem logo em seguida.
    if (Date.now() >= proximaManutencao) {
      proximaManutencao = Date.now() + CADENCIA_DA_MANUTENCAO_MS;
      await manutencao(admin);
    }
    if (ativo && Date.now() >= proximaFila) {
      proximaFila = Date.now() + CADENCIA_DA_FILA_MS;
      await passagem(admin);
    }
    const espera = Math.min(proximaManutencao, proximaFila) - Date.now();
    if (ativo && espera > 0) {
      await esperar(espera);
    }
  }
  log.info("worker_encerrou", { path: "motor-fila" });
}

main().catch((error: unknown) => {
  log.error("worker_morreu");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
