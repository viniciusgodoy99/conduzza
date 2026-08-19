import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Regra permanente do projeto (CLAUDE.md seção 5): nenhum travessão em texto
// de interface. Este teste transforma a regra em verificação automatizada.
const EM_DASH = "—";
const SCANNED_DIRS = ["app", "components", "lib"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css"];

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("texto de interface", () => {
  it("não contém travessão em app/, components/ e lib/", () => {
    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of collectFiles(dir)) {
        const content = readFileSync(file, "utf-8");
        if (content.includes(EM_DASH)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
