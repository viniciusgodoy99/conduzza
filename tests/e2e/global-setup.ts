import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { provisionar } from "./fixtures";

// Provisiona os dados da suite de navegador antes de tudo e grava o resultado
// num arquivo que os testes leem. O banco e de operacao real, entao a suite
// cria e apaga o proprio universo em vez de depender do seed.
export default async function globalSetup() {
  const dados = await provisionar();
  writeFileSync(
    join(process.cwd(), "tests", "e2e", ".dados-e2e.json"),
    JSON.stringify(dados, null, 2),
  );
}
