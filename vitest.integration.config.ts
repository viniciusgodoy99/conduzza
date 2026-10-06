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

export default defineConfig({
  plugins: [tsxAutomatico],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: [travaDeRede],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      guardaDaOpenAi,
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
