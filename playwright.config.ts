import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/fieldguide";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The environment pre-installs a Chromium build that differs from this
        // Playwright version's default; point directly at the installed binary.
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: DB_URL,
      AUTH_SECRET: "e2e-secret-not-for-production-use-only-testing-0123456789",
      APP_BASE_URL: BASE_URL,
      AI_PROVIDER: "mock",
      AI_ENABLED: "true",
      PUBLIC_SITE_INDEXABLE: "false",
      NODE_ENV: "production",
    },
  },
});
