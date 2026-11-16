import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
// Second server: same build and database, but with the real local Shorts
// providers, for tests/e2e/local-media.spec.ts.
const LOCAL_PORT = 3101;
const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;
// The browser suite RESEEDS (wipes) its database. It used to fall back to the
// development database when E2E_DATABASE_URL was unset; now it refuses to run.
const DB_URL = process.env.E2E_DATABASE_URL ?? "";
if (!DB_URL) {
  throw new Error(
    "E2E_DATABASE_URL is not set. The browser tests wipe their database; point it at a disposable one.",
  );
}

function serverEnv(baseUrl: string) {
  return {
    DATABASE_URL: DB_URL,
    AUTH_SECRET: "e2e-secret-not-for-production-use-only-testing-0123456789",
    APP_BASE_URL: baseUrl,
    AI_PROVIDER: "mock",
    AI_ENABLED: "true",
    PUBLIC_SITE_INDEXABLE: "false",
    NODE_ENV: "production",
  };
}
// Explicit, so a developer's .env (which may select the local pipeline) never
// changes what a test server runs.
function providers(script: string, tts: string, video: string) {
  return { SHORTS_SCRIPT_PROVIDER: script, TTS_PROVIDER: tts, VIDEO_COMPOSITOR_PROVIDER: video };
}

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
      testIgnore: /local-media\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        // The environment pre-installs a Chromium build that differs from this
        // Playwright version's default; point directly at the installed binary.
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    {
      name: "local-media",
      testMatch: /local-media\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: LOCAL_URL,
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: `pnpm start -p ${PORT}`,
      url: BASE_URL,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...serverEnv(BASE_URL), ...providers("mock", "mock", "mock") },
    },
    {
      command: `pnpm start -p ${LOCAL_PORT}`,
      url: LOCAL_URL,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...serverEnv(LOCAL_URL),
        ...providers("local-operator", "local-say-fixture", "local-ffmpeg"),
        CAPTURE_INGEST_DIR: "./.data/ingest-e2e",
      },
    },
  ],
});
