import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DadosE2E } from "./fixtures";

// Dados provisionados pelo global-setup, lidos pelos testes.
export function dados(): DadosE2E {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "tests", "e2e", ".dados-e2e.json"),
      "utf-8",
    ),
  ) as DadosE2E;
}
