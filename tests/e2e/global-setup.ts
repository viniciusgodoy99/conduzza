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
  const { data } = await adminClient()
    .from("worker_heartbeat")
    .select("batida_em")
    .order("batida_em", { ascending: false })
    .limit(1);
  const ultima = (data ?? [])[0]?.batida_em as string | undefined;
  const idadeMs = ultima ? Date.now() - new Date(ultima).getTime() : Infinity;
  if (idadeMs > 2 * 60_000) {
    throw new Error(
      "O motor de automação não está batendo ponto" +
        (ultima
          ? ` (última batida há ${Math.round(idadeMs / 1000)}s).`
          : " (nenhuma batida registrada).") +
        " Suba o worker em outro terminal com `npm run worker` e rode a suíte de novo." +
        " Sem ele, a faixa de motor parado aparece em todas as telas e a suíte falha em massa.",
    );
  }
}
