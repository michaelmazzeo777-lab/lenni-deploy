import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against the TEST database. Point Prisma at it before any
// test module imports lib/db.
// It used to fall back to a hardcoded default (port 5432) when
// TEST_DATABASE_URL was unset; now it refuses to run, same as
// playwright.config.ts's E2E_DATABASE_URL guard. A worktree whose .env points
// its real dev/test databases at a different port (to avoid colliding with
// another worktree's live baseline on 5432) must export TEST_DATABASE_URL
// before running tests - .env is not auto-loaded by vitest.
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Integration tests write to this database; " +
      "export it (e.g. from .env) before running tests, so a silent default never points at a live database.",
  );
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: testDbUrl,
      AUTH_SECRET: "test-secret-key-not-for-production-use-only-testing",
      AI_PROVIDER: "mock",
      AI_ENABLED: "true",
      APP_BASE_URL: "http://localhost:3000",
      STORAGE_ROOT: "./.data/storage-test",
      // Deterministic mocks by default; tests/integration/local-media.test.ts
      // switches to the local providers itself.
      SHORTS_SCRIPT_PROVIDER: "mock",
      TTS_PROVIDER: "mock",
      VIDEO_COMPOSITOR_PROVIDER: "mock",
    },
  },
});
