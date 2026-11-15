// Generates the synthetic test clips into the capture ingest folder.
// Usage: pnpm fixtures
import path from "node:path";
import { makeAllFixtures } from "../tests/helpers/fixtures";

const dir = path.resolve(process.env.CAPTURE_INGEST_DIR ?? "./.data/ingest");
makeAllFixtures(dir).then(
  () => console.log(`Fixtures written to ${dir}`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
