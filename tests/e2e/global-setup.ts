import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { FIXTURES, makeFixture } from "../helpers/fixtures";
import { makeClipperFixture } from "../helpers/clipper-fixture";
import { transcriberConfig } from "@/lib/media/transcribe";
import { assertDisposableDbUrl } from "../../lib/testing/db-guard";

// Reseed the e2e database to a known state before the browser suite runs, and
// generate the synthetic clips the local-media and clipper specs ingest.
export default async function globalSetup() {
  // Checked first, before anything is generated or the seed wipes it.
  const DB_URL = assertDisposableDbUrl(
    process.env.E2E_DATABASE_URL,
    "E2E_DATABASE_URL",
    "fgcand_e2e",
  );
  const ingest = path.resolve("./.data/ingest-e2e");
  await rm(ingest, { recursive: true, force: true });
  await makeFixture(FIXTURES[0]!, path.join(ingest, "e2e_fixture.mp4"), 0.5);
  if (!("missing" in transcriberConfig())) {
    await makeClipperFixture(
      path.join(ingest, "e2e_session.mp4"),
      path.join(ingest, "clipper-fixture-work"),
    );
  }
  execSync("tsx prisma/seed.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
}
