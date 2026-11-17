import { describe, it, expect } from "vitest";
import {
  CHUNK_OVERLAP_SEC,
  CHUNK_SEC,
  buildChunkMarkdown,
  chunkRanges,
  energyPeaksFromBins,
  timecode,
  transcriptLines,
} from "@/lib/clipper/pickChunks";
import {
  SLICE_OVERLAP_SEC,
  SLICE_SEC,
  mergeSliceWords,
  planTranscriptSlices,
} from "@/lib/clipper/longTranscribe";
import type { TimedWord } from "@/lib/media/align";

const word = (text: string, startSec: number, endSec: number): TimedWord => ({
  text,
  startSec,
  endSec,
});

describe("chunkRanges — 12 minutes with 60s overlap", () => {
  it("uses a 12-minute window and a 60-second overlap by default", () => {
    expect(CHUNK_SEC).toBe(720);
    expect(CHUNK_OVERLAP_SEC).toBe(60);
  });

  it("returns one chunk for a stream shorter than the window", () => {
    expect(chunkRanges(600)).toEqual([{ index: 0, startSec: 0, endSec: 600 }]);
  });

  it("advances by window minus overlap", () => {
    const r = chunkRanges(3600);
    expect(r[0]).toEqual({ index: 0, startSec: 0, endSec: 720 });
    expect(r[1]!.startSec).toBe(660); // 720 - 60
    expect(r[1]!.endSec).toBe(1380);
    expect(r[2]!.startSec).toBe(1320);
  });

  it("overlaps every consecutive pair by exactly 60s", () => {
    const r = chunkRanges(4 * 3600);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.endSec - r[i]!.startSec, `pair ${i}`).toBe(60);
    }
  });

  it("covers the whole stream with no gap, ending exactly at the duration", () => {
    const duration = 4 * 3600 + 137;
    const r = chunkRanges(duration);
    expect(r[0]!.startSec).toBe(0);
    expect(r.at(-1)!.endSec).toBe(duration);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.startSec).toBeLessThan(r[i - 1]!.endSec);
    }
  });

  it("produces a sane chunk count for a 4h stream", () => {
    // 4h at 11-minute steps: enough to read, not hundreds of files.
    const r = chunkRanges(4 * 3600);
    expect(r.length).toBeGreaterThanOrEqual(20);
    expect(r.length).toBeLessThanOrEqual(24);
  });

  it("returns nothing for a zero or negative duration", () => {
    expect(chunkRanges(0)).toEqual([]);
    expect(chunkRanges(-5)).toEqual([]);
  });

  it("degrades sanely when the overlap meets or exceeds the window", () => {
    // The step floors at half the window, so a degenerate overlap gives
    // redundant chunks but not thousands of them.
    const r = chunkRanges(3600, 100, 100);
    expect(r.length).toBeLessThan(100);
    expect(r.at(-1)!.endSec).toBe(3600);
  });

  it("leaves the default 12-minute/60-second grid unaffected by that floor", () => {
    const r = chunkRanges(4 * 3600);
    expect(r[1]!.startSec).toBe(660);
  });
});

describe("transcript rendering", () => {
  it("formats timecodes, adding hours only when needed", () => {
    expect(timecode(0)).toBe("00:00");
    expect(timecode(95)).toBe("01:35");
    expect(timecode(3725)).toBe("1:02:05");
  });

  it("keeps only words starting inside the window", () => {
    const words = [word("before", 10, 11), word("inside", 100, 101), word("after", 900, 901)];
    const lines = transcriptLines(words, { index: 0, startSec: 50, endSec: 800 });
    expect(lines.map((l) => l.text)).toEqual(["inside"]);
  });

  it("breaks lines on a pause and timestamps each with absolute stream time", () => {
    const words = [
      word("that", 100, 100.3),
      word("was", 100.4, 100.7),
      word("wild", 100.8, 101.2),
      word("okay", 110, 110.4), // 8.8s gap -> new line
      word("next", 110.5, 110.9),
    ];
    const lines = transcriptLines(words, { index: 0, startSec: 0, endSec: 720 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ atSec: 100, text: "that was wild" });
    expect(lines[1]!.atSec).toBe(110);
  });

  it("writes a chunk that states its absolute-time contract and its source", () => {
    const md = buildChunkMarkdown({
      range: { index: 3, startSec: 1980, endSec: 2700 },
      words: [word("hello", 2000, 2000.5)],
      energyPeaks: [{ atSec: 2100, level: 0.91 }],
      chatSpikes: [{ atSec: 2105, rate: 7.5 }],
      sourceLabel: "Some Streamer — 4 hour GTA 6 session",
    });
    expect(md).toMatch(/# Chunk 003 — Some Streamer/);
    expect(md).toMatch(/absolute stream time/);
    expect(md).toMatch(/33:00 to 45:00/);
    expect(md).toMatch(/energy 0\.91/);
    expect(md).toMatch(/7\.5 msg\/s/);
    expect(md).toMatch(/\*\*\[33:20\]\*\* hello/);
  });

  it("says plainly when a window has no chat replay or no speech", () => {
    const md = buildChunkMarkdown({
      range: { index: 0, startSec: 0, endSec: 720 },
      words: [],
      energyPeaks: [],
      chatSpikes: [],
      sourceLabel: "s",
    });
    expect(md).toMatch(/No speech transcribed/i);
    expect(md).toMatch(/No chat replay available/i);
  });
});

describe("energyPeaksFromBins", () => {
  it("normalises against the loudest bin and spaces peaks out", () => {
    const bins = [
      { atSec: 10, audioRms: 0.9 },
      { atSec: 11, audioRms: 0.85 }, // within the 20s gap, dropped
      { atSec: 100, audioRms: 0.95 },
      { atSec: 200, audioRms: 0.1 }, // below the level threshold
    ];
    const peaks = energyPeaksFromBins(bins);
    expect(peaks.map((p) => p.atSec)).toEqual([10, 100]);
    expect(peaks[1]!.level).toBeCloseTo(1, 5);
  });

  it("returns nothing for silence or no bins", () => {
    expect(energyPeaksFromBins([])).toEqual([]);
    expect(energyPeaksFromBins([{ atSec: 1, audioRms: 0 }])).toEqual([]);
  });
});

describe("planTranscriptSlices — a different grid from the picking chunks", () => {
  it("is a distinct, finer grid so a slice edge cannot corrupt a word time", () => {
    expect(SLICE_SEC).toBe(600);
    expect(SLICE_OVERLAP_SEC).toBe(5);
    expect(SLICE_SEC).not.toBe(CHUNK_SEC);
  });

  it("overlaps slices and gives each a non-overlapping claim boundary", () => {
    const s = planTranscriptSlices(1800);
    expect(s[0]).toMatchObject({ startSec: 0, endSec: 600, claimFromSec: 0 });
    expect(s[1]!.startSec).toBe(595);
    expect(s[1]!.claimFromSec).toBe(600);
    expect(s[1]!.startSec).toBeLessThan(s[0]!.endSec); // audio overlaps
    expect(s[1]!.claimFromSec).toBe(s[0]!.endSec); // claims do not
  });

  it("covers a 4h stream and ends exactly at its duration", () => {
    const s = planTranscriptSlices(4 * 3600);
    expect(s.at(-1)!.endSec).toBe(4 * 3600);
    expect(s.length).toBeGreaterThan(20);
  });

  it("returns nothing for a zero duration", () => {
    expect(planTranscriptSlices(0)).toEqual([]);
  });
});

describe("mergeSliceWords — a word on a slice edge survives exactly once", () => {
  const ranges = planTranscriptSlices(1200);

  it("keeps a word spanning the edge once, from the slice that claims it", () => {
    // "boundary" straddles 600s: slice 0 heard it (its audio runs to 600),
    // slice 1 also heard it (its audio starts at 595). Only one may survive.
    const spanning = word("boundary", 599.6, 600.4);
    const merged = mergeSliceWords([
      { range: ranges[0]!, words: [word("before", 500, 500.5), spanning] },
      { range: ranges[1]!, words: [spanning, word("after", 601, 601.5)] },
    ]);
    expect(merged.filter((w) => w.text === "boundary")).toHaveLength(1);
    expect(merged.map((w) => w.text)).toEqual(["before", "boundary", "after"]);
  });

  it("drops the duplicate heard in the overlap by the slice that does not claim it", () => {
    const dup = word("overlap", 597, 597.5); // inside slice 1's audio, slice 0's claim
    const merged = mergeSliceWords([
      { range: ranges[0]!, words: [dup] },
      { range: ranges[1]!, words: [dup] },
    ]);
    expect(merged).toHaveLength(1);
  });

  it("returns words in time order across slices", () => {
    const merged = mergeSliceWords([
      { range: ranges[1]!, words: [word("second", 700, 700.5)] },
      { range: ranges[0]!, words: [word("first", 100, 100.5)] },
    ]);
    expect(merged.map((w) => w.text)).toEqual(["first", "second"]);
  });
});
