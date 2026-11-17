import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { FIXTURES, makeFixture } from "../helpers/fixtures";
import { makeClipperFixture } from "../helpers/clipper-fixture";
import { transcriberConfig } from "@/lib/media/transcribe";

// Reseed the e2e database to a known state before the browser suite runs, and
// generate the synthetic clips the local-media and clipper specs ingest.
export default async function globalSetup() {
  const ingest = path.resolve("./.data/ingest-e2e");
  await rm(ingest, { recursive: true, force: true });
  await makeFixture(FIXTURES[0]!, path.join(ingest, "e2e_fixture.mp4"), 0.5);
  if (!("missing" in transcriberConfig())) {
    await makeClipperFixture(
      path.join(ingest, "e2e_session.mp4"),
      path.join(ingest, "clipper-fixture-work"),
    );
  }
  const DB_URL = process.env.E2E_DATABASE_URL;
  if (!DB_URL)
    throw new Error("E2E_DATABASE_URL is not set; refusing to reseed a default database");
  execSync("tsx prisma/seed.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
}
