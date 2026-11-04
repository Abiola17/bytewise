import { defineConfig, devices } from "@playwright/test";

// Dedicated ports (uncommon, to avoid other local apps), database, build directory
// and project copy: an e2e run never touches a running `pnpm dev` (3000/4000), the
// dev database or examples/.
const SERVER_PORT = 4217;
const WEB_PORT = 3217;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The full loop calls the real model twice and runs real tests.
  timeout: 6 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/prepare.mjs && pnpm --filter @bytewise/server start",
      url: `http://127.0.0.1:${SERVER_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        SERVER_PORT: String(SERVER_PORT),
        WEB_ORIGIN: WEB_URL,
        DATABASE_PATH: ".data/e2e/bytewise.db",
        PROJECTS_DIR: ".data/e2e/projects",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `pnpm --filter @bytewise/web exec next dev --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${SERVER_PORT}`,
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
