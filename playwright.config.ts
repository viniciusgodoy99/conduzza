import { defineConfig } from "@playwright/test";

// Viewports do aceite da tarefa 0.6: 1600, 1366, 1024 e 768 (seção 6 do brief de telas).
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  testMatch: "**/*.spec.ts",
  // 1 worker: o teste de white-label muda o branding no banco compartilhado;
  // paralelismo entre arquivos criaria corrida entre os specs.
  fullyParallel: false,
  workers: 1,
  // 1 repeticao: os criterios de tempo (posse < 2s) sao de produto e ficam
  // apertados sob a carga da suite inteira; regressao real falha DUAS vezes.
  retries: 1,
  use: {
    baseURL: "http://localhost:3000",
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "desktop-1600", use: { viewport: { width: 1600, height: 900 } } },
    { name: "desktop-1366", use: { viewport: { width: 1366, height: 768 } } },
    { name: "tablet-1024", use: { viewport: { width: 1024, height: 768 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
