import { execSync } from "node:child_process";

// Reseed the e2e database to a known state before the browser suite runs.
export default function globalSetup() {
  const DB_URL =
    process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/fieldguide";
  execSync("tsx prisma/seed.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
}
