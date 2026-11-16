import { describe, it, expect } from "vitest";
import { rankHighlights, type SignalBin } from "@/lib/media/highlights";
import { HELD_OUT_CLIPS, makeBins } from "../helpers/heldout-bins";

// Independent re-measurement of the Gemini v3.1 ranker claim, plus the negative
// cases its benchmark did not include. Everything here is hand-written signal
// bins: it says nothing about accuracy on real video or on GTA VI gameplay.

const OPTS = { maxCandidates: 5, minScore: 0.22 };
const inAny = (peak: number, ws: { startSec: number; endSec: number }[], pad = 0) =>
  ws.some((w) => peak >= w.startSec - pad && peak <= w.endSec + pad);

export function measure(experimental: boolean) {
  let tp = 0;
  let fp = 0;
  let missed = 0;
  let windows = 0;
  let trapHits = 0;
  for (const clip of HELD_OUT_CLIPS) {
    const cands = rankHighlights(clip.bins, { ...OPTS, experimentalMenuFilter: experimental });
    // One hit per labeled window: two candidates in one window are not two finds.
    const found = clip.groundTruthWindows.filter((w) =>
      cands.some((c) => inAny(c.peakSec, [w], 1)),
    );
    tp += found.length;
    fp += cands.filter((c) => !inAny(c.peakSec, clip.groundTruthWindows, 1)).length;
    missed += clip.groundTruthWindows.length - found.length;
    windows += clip.groundTruthWindows.length;
    trapHits += cands.filter((c) => inAny(c.peakSec, clip.trapWindows)).length;
  }
  return { tp, fp, missed, windows, trapHits };
}

describe("Gemini v3.1 ranker claim, re-measured", () => {
  it("default ranking ignores the experimental fields entirely", () => {
    for (const clip of HELD_OUT_CLIPS) {
      const stripped = clip.bins.map(({ lumaVariance: _v, voiceCallout: _c, ...b }) => b);
      expect(rankHighlights(clip.bins, OPTS)).toEqual(rankHighlights(stripped, OPTS));
    }
  });

  it("reproduces the reported numbers on the supplied bins: 6 found / 2 false vs 6 found / 0 false", () => {
    expect(measure(false)).toEqual({ tp: 6, fp: 2, missed: 0, windows: 6, trapHits: 2 });
    expect(measure(true)).toEqual({ tp: 6, fp: 0, missed: 0, windows: 6, trapHits: 0 });
  });
});

describe("cases the supplied benchmark left out (experimental filter on)", () => {
  const rank = (bins: SignalBin[], experimental: boolean) =>
    rankHighlights(bins, { ...OPTS, experimentalMenuFilter: experimental });

  // A slow, tense night or fog sequence: low contrast, little motion, no cuts,
  // loud. Numerically identical to the "spinner" trap except that it is gameplay.
  const lowContrastGameplay = makeBins(40, (t) =>
    t >= 15 && t <= 24 ? { motion: 1.2, luma: 34, rmsDb: -8, lumaVariance: 4.5 } : {},
  );

  it("REGRESSION RISK: discards genuine low-contrast, low-motion gameplay that the default keeps", () => {
    expect(rank(lowContrastGameplay, false).some((c) => c.peakSec >= 15 && c.peakSec <= 24)).toBe(
      true,
    );
    expect(rank(lowContrastGameplay, true)).toEqual([]);
  });

  it("a voice callout over idle visuals does not, alone, create a candidate", () => {
    const idle = makeBins(40, (t) => (t === 20 ? { voiceCallout: true, rmsDb: -30 } : {}));
    expect(rank(idle, false)).toEqual([]);
    expect(rank(idle, true)).toEqual([]);
  });

  it("a detailed static screen (map, tutorial text) is not caught by the filter either way", () => {
    // High spatial variance, small animated element, loud music: a real pause map.
    const map = makeBins(40, (t) =>
      t >= 10 && t <= 20 ? { motion: 1.1, luma: 70, rmsDb: -6, lumaVariance: 55 } : {},
    );
    expect(rank(map, false).length).toBeGreaterThan(0);
    expect(rank(map, true).length).toBeGreaterThan(0);
  });

  it("quiet, clearly moving action survives in both modes", () => {
    const quiet = makeBins(40, (t) =>
      t >= 12 && t <= 20 ? { motion: 4.2, luma: 80, rmsDb: -40, lumaVariance: 50 } : {},
    );
    for (const mode of [false, true]) {
      expect(rank(quiet, mode).some((c) => c.peakSec >= 12 && c.peakSec <= 20)).toBe(true);
    }
  });
});
