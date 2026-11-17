import { describe, it, expect } from "vitest";
import {
  CLIP_MAX_SEC,
  CLIP_MIN_SEC,
  clampWindowSec,
  overlaps,
  shortlistWindows,
  snapBoundaries,
} from "@/lib/clipper/moments";
import type { SignalBin } from "@/lib/media/highlights";
import type { TimedWord } from "@/lib/media/align";

// Pure selection logic for the long-session clipper. ffmpeg/whisper-backed
// pieces (scene-cut detection, transcription) are exercised in the
// integration/browser tests; this file is hand-built inputs only.

describe("clampWindowSec", () => {
  it("leaves a window already inside [15, 60] untouched", () => {
    expect(clampWindowSec(100, 130, 1000)).toEqual({ startSec: 100, endSec: 130 });
  });

  it("grows a window shorter than the minimum, centred on its middle", () => {
    const { startSec, endSec } = clampWindowSec(100, 104, 1000);
    expect(endSec - startSec).toBeCloseTo(CLIP_MIN_SEC, 1);
    expect((startSec + endSec) / 2).toBeCloseTo(102, 1);
  });

  it("shrinks a window longer than the maximum, centred on its middle", () => {
    // rankHighlights pads a sustained region by up to ~4s beyond maxWindowSec.
    const { startSec, endSec } = clampWindowSec(100, 164, 1000);
    expect(endSec - startSec).toBeCloseTo(CLIP_MAX_SEC, 1);
    expect((startSec + endSec) / 2).toBeCloseTo(132, 1);
  });

  it("never starts before 0", () => {
    const { startSec, endSec } = clampWindowSec(2, 10, 1000);
    expect(startSec).toBe(0);
    expect(endSec - startSec).toBeCloseTo(CLIP_MIN_SEC, 1);
  });

  it("never ends after the file's duration", () => {
    const { startSec, endSec } = clampWindowSec(990, 998, 1000);
    expect(endSec).toBe(1000);
    expect(endSec - startSec).toBeCloseTo(CLIP_MIN_SEC, 1);
  });

  it("always returns a window inside [CLIP_MIN_SEC, CLIP_MAX_SEC] when the file is long enough", () => {
    for (const [s, e] of [
      [0, 1],
      [50, 51],
      [0, 200],
      [500, 505],
    ] as const) {
      const w = clampWindowSec(s, e, 10_000);
      const len = w.endSec - w.startSec;
      expect(len).toBeGreaterThanOrEqual(CLIP_MIN_SEC - 0.1);
      expect(len).toBeLessThanOrEqual(CLIP_MAX_SEC + 0.1);
    }
  });
});

describe("overlaps", () => {
  it("detects overlap and non-overlap", () => {
    expect(overlaps({ startSec: 0, endSec: 10 }, { startSec: 5, endSec: 15 })).toBe(true);
    expect(overlaps({ startSec: 0, endSec: 10 }, { startSec: 10, endSec: 20 })).toBe(false);
    expect(overlaps({ startSec: 0, endSec: 10 }, { startSec: 20, endSec: 30 })).toBe(false);
  });
});

function words(specs: [string, number, number][]): TimedWord[] {
  return specs.map(([text, startSec, endSec]) => ({ text, startSec, endSec }));
}

describe("snapBoundaries", () => {
  it("snaps the start forward to a silence end within tolerance", () => {
    const got = snapBoundaries({
      startSec: 10.0,
      endSec: 40,
      silences: [{ startSec: 8, endSec: 10.6 }],
      sceneCuts: [],
      words: [],
    });
    expect(got.startSec).toBeCloseTo(10.6, 1);
  });

  it("snaps the end backward to a silence start within tolerance", () => {
    const got = snapBoundaries({
      startSec: 10,
      endSec: 40.0,
      silences: [{ startSec: 39.4, endSec: 42 }],
      sceneCuts: [],
      words: [],
    });
    expect(got.endSec).toBeCloseTo(39.4, 1);
  });

  it("snaps to the nearest scene cut when it is closer than any silence", () => {
    const got = snapBoundaries({
      startSec: 10,
      endSec: 40,
      silences: [{ startSec: 7, endSec: 9.0 }],
      sceneCuts: [10.2],
      words: [],
    });
    expect(got.startSec).toBeCloseTo(10.2, 1);
  });

  it("never lands inside a spoken word, even after snapping there", () => {
    // The nearest silence end is 10.1s, which falls inside the word "five" (10.0-10.5).
    const got = snapBoundaries({
      startSec: 10.0,
      endSec: 40,
      silences: [{ startSec: 9.5, endSec: 10.1 }],
      sceneCuts: [],
      words: words([
        ["four", 9.4, 9.9],
        ["five", 10.0, 10.5],
        ["six", 10.6, 11.0],
      ]),
    });
    // Pushed to the word's own start, not left mid-word.
    expect(got.startSec).toBeCloseTo(10.0, 1);
    expect(got.startSec).not.toBeGreaterThan(10.0 + 1e-6);
    expect(got.startSec).not.toBeLessThan(9.99);
  });

  it("pushes an end boundary landing mid-word to that word's end, not before it", () => {
    const got = snapBoundaries({
      startSec: 10,
      endSec: 40.3,
      silences: [],
      sceneCuts: [40.3],
      words: words([["word", 40.0, 40.6]]),
    });
    expect(got.endSec).toBeCloseTo(40.6, 1);
  });

  it("falls back to the original boundary when nothing is within tolerance", () => {
    const got = snapBoundaries({
      startSec: 10,
      endSec: 40,
      silences: [{ startSec: 0, endSec: 1 }],
      sceneCuts: [100],
      words: [],
    });
    expect(got.startSec).toBe(10);
    expect(got.endSec).toBe(40);
  });

  it("falls back to the original window if snapping would invert start and end", () => {
    const got = snapBoundaries({
      startSec: 10,
      endSec: 10.4,
      silences: [{ startSec: 9, endSec: 9.2 }], // start candidate would be 9.2
      sceneCuts: [10.3], // end candidate 10.3, which is before the snapped start
      words: [],
    });
    expect(got.startSec).toBe(10);
    expect(got.endSec).toBe(10.4);
  });
});

function flatBins(n: number, fill: Partial<SignalBin> = {}): SignalBin[] {
  return Array.from({ length: n }, (_, t) => ({
    t,
    motion: 0,
    luma: 128,
    cuts: 0,
    rmsDb: -60,
    ...fill,
  }));
}

describe("shortlistWindows", () => {
  it("asks rankHighlights for 3x the final count, widened to the clip ceiling", () => {
    const bins = flatBins(120);
    // Plant two bursts well above the noise floor.
    for (const center of [20, 80]) {
      for (let i = center - 2; i <= center + 2; i++) {
        bins[i] = { ...bins[i]!, motion: 10, rmsDb: -10 };
      }
    }
    const top = shortlistWindows(bins, 8);
    expect(top.length).toBeLessThanOrEqual(24);
    expect(top.length).toBeGreaterThan(0);
    for (const c of top) expect(c.endSec - c.startSec).toBeLessThanOrEqual(CLIP_MAX_SEC + 5);
  });

  it("returns nothing for a silent, motionless file", () => {
    expect(shortlistWindows(flatBins(60), 8)).toEqual([]);
  });
});
