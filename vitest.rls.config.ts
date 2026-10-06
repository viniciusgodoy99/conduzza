import { defineConfig } from "vitest/config";
import path from "node:path";

// Guarda da Fase 3: "openai" (so o nome EXATO) vira um modulo cujo
// construtor lanca. Nenhum teste chama a OpenAI; subcaminhos como
// "openai/helpers/zod" continuam reais.
const guardaDaOpenAi = {
  find: /^openai$/,
  replacement: path.resolve(__dirname, "tests/stubs/openai-proibido.ts"),
};

// Segunda guarda, independente do caminho de import: o fetch dos testes
// lanca para qualquer host da OpenAI ou da Anthropic (tests/setup).
const travaDeRede = path.resolve(__dirname, "tests/setup/sem-rede-de-llm.ts");

// Testes de RLS rodam contra o stack local do Supabase (supabase start).
// Sem paralelismo de arquivos para o setup e o teardown serem determinísticos.
export default defineConfig({
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    setupFiles: [travaDeRede],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      guardaDaOpenAi,
      { find: "@", replacement: path.resolve(__dirname, ".") },
    ],
  },
});
