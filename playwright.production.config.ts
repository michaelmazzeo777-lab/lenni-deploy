import { defineConfig, devices } from "@playwright/test";

// Drives an already-running Studio through its screens to produce real drafts.
// It starts no server and seeds nothing. It refuses to run without an explicit
// target so it can never be pointed at a Studio by accident.
const BASE_URL = process.env.PRODUCTION_BASE_URL ?? "";
if (!BASE_URL) {
  throw new Error("PRODUCTION_BASE_URL is not set (for example http://127.0.0.1:3200).");
}

export default defineConfig({
  testDir: "./tests/production",
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL,
    trace: "off",
    actionTimeout: 30_000,
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
});
