import { defineConfig } from "vitest/config";
import path from "node:path";

// Testes de integracao contra o banco remoto (service role), sem servidor
// HTTP: provam idempotencia e concorrencia da ingestao no proprio Postgres.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // O marcador "server-only" lanca erro fora do React Server Components:
      // trocado por um modulo vazio para testar o codigo de servidor real
      // (trilha de leitura) sem tirar o marcador da aplicacao.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
