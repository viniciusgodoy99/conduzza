import { defineConfig } from "@playwright/test";

// Viewports do aceite da tarefa 0.6: 1600, 1366, 1024 e 768 (seção 6 do brief de telas).
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  retries: 0,
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
