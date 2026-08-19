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
    },
  },
});
