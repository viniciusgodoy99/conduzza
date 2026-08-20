import { rmSync } from "node:fs";
import { join } from "node:path";

import { limpar } from "./fixtures";

export default async function globalTeardown() {
  await limpar();
  rmSync(join(process.cwd(), "tests", "e2e", ".dados-e2e.json"), {
    force: true,
  });
}
