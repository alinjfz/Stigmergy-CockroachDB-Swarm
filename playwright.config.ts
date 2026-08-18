import { defineConfig, devices } from "@playwright/test";

// Overridable so the suite can run against a server that is already up on another
// port, instead of failing when 3000 is occupied by something unrelated.
const PORT = process.env.E2E_PORT ?? "3000";
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 45000,
  use: {
    baseURL: BASE,
    trace: "off",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `STIGMERGY_STORE=memory npx next dev -p ${PORT}`,
        url: BASE,
        reuseExistingServer: true,
        timeout: 90000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
