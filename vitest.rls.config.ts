import { defineConfig } from "vitest/config";
import path from "node:path";

// Guarda da Fase 3: "@anthropic-ai/sdk" (so o nome EXATO) vira um modulo cujo
// construtor lanca. Nenhum teste chama a Anthropic; subcaminhos como
// "@anthropic-ai/sdk/helpers/zod" continuam reais.
const guardaDaAnthropic = {
  find: /^@anthropic-ai\/sdk$/,
  replacement: path.resolve(__dirname, "tests/stubs/anthropic-proibido.ts"),
};

// Testes de RLS rodam contra o stack local do Supabase (supabase start).
// Sem paralelismo de arquivos para o setup e o teardown serem determinísticos.
export default defineConfig({
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      guardaDaAnthropic,
      { find: "@", replacement: path.resolve(__dirname, ".") },
    ],
  },
});
