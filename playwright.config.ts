import { defineConfig, devices } from "@playwright/test";
import { assertDisposableDbUrl } from "./lib/testing/db-guard";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Second server: same build and database, but with the real local Shorts
// providers, for tests/e2e/local-media.spec.ts and explainer.spec.ts.
const LOCAL_PORT = 3101;
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
// The browser suite RESEEDS (wipes) its database, so it only accepts the
// candidate's disposable fgcand_e2e on localhost:5433.
const DB_URL = assertDisposableDbUrl(
  process.env.E2E_DATABASE_URL,
  "E2E_DATABASE_URL",
  "fgcand_e2e",
);

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
// The clipper needs word-level timestamps (A3: never a mid-word cut), which
// needs a real speech model. Forwarded explicitly, same reasoning as above -
// not inherited from .env - so tests/e2e/clipper.spec.ts skips cleanly (never
// a false pass) when the environment running this suite has none configured.
function whisperEnv() {
  const env: Record<string, string> = {};
  if (process.env.WHISPER_MODEL_PATH) env.WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH;
  if (process.env.WHISPER_CLI_PATH) env.WHISPER_CLI_PATH = process.env.WHISPER_CLI_PATH;
  return env;
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
      testIgnore: /(local-media|explainer|premium|clipper)\.spec/,
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
      testMatch: /(local-media|explainer|premium|clipper)\.spec/,
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
      command: `pnpm start -H 127.0.0.1 -p ${PORT}`,
      url: BASE_URL,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...serverEnv(BASE_URL), ...providers("mock", "mock", "mock") },
    },
    {
      command: `pnpm start -H 127.0.0.1 -p ${LOCAL_PORT}`,
      url: LOCAL_URL,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...serverEnv(LOCAL_URL),
        ...providers("local-operator", "local-say-fixture", "local-ffmpeg"),
        CAPTURE_INGEST_DIR: "./.data/ingest-e2e",
        ...whisperEnv(),
      },
    },
  ],
});
