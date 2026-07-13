import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against the TEST database. Point Prisma at it before any
// test module imports lib/db.
const testDbUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/fieldguide_test";

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
    },
  },
});
