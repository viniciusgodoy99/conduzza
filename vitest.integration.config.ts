import { defineConfig, type Plugin } from "vitest/config";
import { transform } from "esbuild";
import path from "node:path";

// Testes de integracao contra o banco remoto (service role), sem servidor
// HTTP: provam idempotencia e concorrencia da ingestao no proprio Postgres.

// Mesmo plugin do vitest.config.ts: o tsconfig do Next usa jsx "preserve" e
// qualquer cadeia de import que alcance um .tsx (ex.: lib/design/status ->
// icone customizado) quebraria sem a transformacao.
const tsxAutomatico: Plugin = {
  name: "tsx-jsx-automatico",
  enforce: "pre",
  async transform(code, id) {
    if (!id.endsWith(".tsx")) {
      return null;
    }
    const resultado = await transform(code, {
      loader: "tsx",
      jsx: "automatic",
      jsxImportSource: "react",
      sourcemap: true,
    });
    return { code: resultado.code, map: resultado.map || null };
  },
};

// Guarda da Fase 3: "@anthropic-ai/sdk" (so o nome EXATO) vira um modulo cujo
// construtor lanca. Nenhum teste chama a Anthropic; subcaminhos como
// "@anthropic-ai/sdk/helpers/zod" continuam reais.
const guardaDaAnthropic = {
  find: /^@anthropic-ai\/sdk$/,
  replacement: path.resolve(__dirname, "tests/stubs/anthropic-proibido.ts"),
};

export default defineConfig({
  plugins: [tsxAutomatico],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      guardaDaAnthropic,
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // O marcador "server-only" lanca erro fora do React Server Components:
      // trocado por um modulo vazio para testar o codigo de servidor real
      // (trilha de leitura) sem tirar o marcador da aplicacao.
      {
        find: "server-only",
        replacement: path.resolve(__dirname, "tests/stubs/server-only.ts"),
      },
    ],
  },
});
