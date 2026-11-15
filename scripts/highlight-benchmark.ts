// Scores the highlight ranker against the labeled synthetic fixtures.
// Usage: pnpm fixtures && pnpm benchmark:highlights
// This measures pipeline sanity on generated clips with known ground truth. It
// is NOT a calibration on real gameplay; rerun with labeled PS5 captures (add
// them to fixtures.labels.json) before trusting the ranking editorially.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { probeVideo } from "../lib/media/ffmpeg";
import { extractSignals, rankHighlights, ANALYZER_VERSION, WEIGHTS } from "../lib/media/highlights";

type Win = { startSec: number; endSec: number };

async function main() {
  const dir = path.resolve(process.env.CAPTURE_INGEST_DIR ?? "./.data/ingest");
  const { labels } = JSON.parse(await readFile(path.join(dir, "fixtures.labels.json"), "utf8")) as {
    labels: Record<string, Win[]>;
  };
  const rows = [];
  for (const [name, truth] of Object.entries(labels)) {
    const file = path.join(dir, name);
    const probe = await probeVideo(file);
    const t0 = Date.now();
    const bins = await extractSignals(file, probe.audioCodec !== null);
    const top = rankHighlights(bins).slice(0, 5);
    const analysisMs = Date.now() - t0;
    const hit = (c: { peakSec: number }) =>
      truth.some((w) => c.peakSec >= w.startSec && c.peakSec <= w.endSec);
    const truePos = top.filter(hit).length;
    const misses = truth.filter(
      (w) => !top.some((c) => c.peakSec >= w.startSec && c.peakSec <= w.endSec),
    ).length;
    rows.push({
      clip: name,
      durationSec: Math.round(probe.durationSec),
      labeledWindows: truth.length,
      candidates: top.length,
      truePositives: truePos,
      falsePositives: top.length - truePos,
      misses,
      precisionAt5: top.length ? Number((truePos / top.length).toFixed(2)) : 0,
      analysisMs,
      reviewSeconds: Math.round(top.reduce((a, c) => a + (c.endSec - c.startSec), 0)),
      top: top.map((c) => ({
        in: c.startSec,
        out: c.endSec,
        score: c.score,
        why: c.signals.reasons.join("; "),
      })),
    });
  }
  console.log(
    JSON.stringify({ analyzer: ANALYZER_VERSION, weights: WEIGHTS, clips: rows }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
