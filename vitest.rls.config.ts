import { defineConfig, type Plugin } from "vitest/config";
import { transform } from "esbuild";
import path from "node:path";

// Mesmo plugin do vitest.config.ts e do vitest.integration.config.ts: o
// tsconfig do Next usa jsx "preserve", e qualquer cadeia de import que
// alcance um .tsx quebraria sem a transformacao. Desde 20/10/2026 um teste
// de RLS usa as funcoes de Resultados (lib/queries/relatorios.ts ->
// lib/design/status -> icone customizado .tsx).
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

// Testes de RLS rodam contra o stack local do Supabase (supabase start).
// Sem paralelismo de arquivos para o setup e o teardown serem determinísticos.
export default defineConfig({
  plugins: [tsxAutomatico],
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
