import { defineConfig, type Plugin } from "vitest/config";
import { transform } from "esbuild";
import path from "node:path";

// O tsconfig do Next usa jsx "preserve", que o vitest respeita e deixa JSX
// cru no output, quebrando qualquer teste que importe um componente .tsx
// (ex.: os icones de status). Este plugin transforma .tsx com o runtime
// automatico ANTES do pipeline padrao, usando o esbuild que ja acompanha o
// vite. Sem dependencia nova.
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

export default defineConfig({
  plugins: [tsxAutomatico],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
