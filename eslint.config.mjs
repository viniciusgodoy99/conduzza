import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["scripts/**", "tests/**"],
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // O servidor de desenvolvimento grava aqui (NEXT_DIST_DIR no script dev),
      // para nao disputar a pasta .next com o build de producao.
      ".next-dev/**",
      // Qualquer outra pasta de build separada (ex.: um servidor de conferencia
      // com NEXT_DIST_DIR proprio).
      ".next-*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "test-results/**",
      "playwright-report/**",
      "design_handoff_conduzza_atendimento_ia/**",
      // Design system novo (24/09/2026): prototipo em JSX de navegador, referencia visual.
      "Conduzza Design System/**",
    ],
  },
  prettier,
];

export default eslintConfig;
