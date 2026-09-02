import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { adminClient } from "../rls/stack";
import { provisionar } from "./fixtures";

// Provisiona os dados da suite de navegador antes de tudo e grava o resultado
// num arquivo que os testes leem. O banco e de operacao real, entao a suite
// cria e apaga o proprio universo em vez de depender do seed.
export default async function globalSetup() {
  await exigirMotorVivo();
  const dados = await provisionar();
  writeFileSync(
    join(process.cwd(), "tests", "e2e", ".dados-e2e.json"),
    JSON.stringify(dados, null, 2),
  );
}

/**
 * A suite roda contra o sistema INTEIRO, e o sistema inteiro inclui o motor de
 * automacao: com ele parado, toda tela ganha a faixa "as mensagens automaticas
 * estao paradas" e dezenas de testes falham por um motivo que nao tem nada a
 * ver com o que eles testam. Falhar aqui, com a instrucao, vale mais do que
 * deixar a pessoa caçar o motivo em vinte relatorios.
 */
async function exigirMotorVivo(): Promise<void> {
  // Os DOIS papeis, nao "a batida mais recente de qualquer um": o planner roda
  // dentro do banco e continuaria batendo com a rota da fila fora do ar, entao
  // a suite passaria com o motor pela metade.
  const { data } = await adminClient()
    .from("worker_heartbeat")
    .select("worker_id, batida_em")
    .in("worker_id", ["motor-fila", "motor-planner"]);
  const batidas = new Map(
    ((data ?? []) as { worker_id: string; batida_em: string }[]).map((b) => [
      b.worker_id,
      Date.now() - new Date(b.batida_em).getTime(),
    ]),
  );
  const mortos = ["motor-fila", "motor-planner"].filter(
    (papel) => (batidas.get(papel) ?? Infinity) > 2 * 60_000,
  );
  if (mortos.length > 0) {
    throw new Error(
      `O motor de automação não está batendo ponto: ${mortos.join(" e ")}.` +
        " Em produção quem dispara é o pg_cron dentro do Supabase; confira com" +
        " `select * from cron.job` e `select saude_do_motor()`." +
        " Localmente, suba o laço com `npm run worker` em outro terminal." +
        " Sem o motor, a faixa de motor parado aparece em todas as telas e a suíte falha em massa.",
    );
  }
}
