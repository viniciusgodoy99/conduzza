import { defineConfig } from "vitest/config";
import path from "node:path";

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
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
