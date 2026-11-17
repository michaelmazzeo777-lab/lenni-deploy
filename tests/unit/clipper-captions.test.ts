import { describe, it, expect } from "vitest";
import { buildClipAss, wordsToCues } from "@/lib/clipper/captions";
import type { TimedWord } from "@/lib/media/align";

const w = (text: string, startSec: number, endSec: number): TimedWord => ({
  text,
  startSec,
  endSec,
});

describe("wordsToCues", () => {
  it("groups closely spaced words into one cue, relative to the clip start", () => {
    const words = [w("nice", 100.0, 100.3), w("shot", 100.35, 100.6), w("there", 100.65, 101.0)];
    const cues = wordsToCues(words, 100, 110);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("nice shot there");
    expect(cues[0]!.startSec).toBeCloseTo(0, 2);
    expect(cues[0]!.endSec).toBeCloseTo(1.0, 2);
  });

  it("starts a new cue after a long pause", () => {
    const words = [w("hello", 100, 100.3), w("world", 105, 105.3)];
    const cues = wordsToCues(words, 100, 110);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe("hello");
    expect(cues[1]!.text).toBe("world");
  });

  it("splits a cue once it reaches the max word count", () => {
    const words = Array.from({ length: 10 }, (_, i) =>
      w(`w${i}`, 100 + i * 0.3, 100 + i * 0.3 + 0.2),
    );
    const cues = wordsToCues(words, 100, 110);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.text.split(" ")).toHaveLength(7);
  });

  it("drops words outside the clip window and clamps at its edges", () => {
    const words = [w("before", 90, 90.5), w("inside", 100.5, 100.8), w("after", 120, 120.5)];
    const cues = wordsToCues(words, 100, 110);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("inside");
  });

  it("returns nothing for a window with no words", () => {
    expect(wordsToCues([], 100, 110)).toEqual([]);
  });
});

describe("buildClipAss", () => {
  it("includes the draft label and every cue, in the format's frame size", () => {
    const ass = buildClipAss({
      format: "9:16",
      durationSec: 20,
      cues: [{ startSec: 1, endSec: 2, text: "nice shot" }],
    });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("DRAFT");
    expect(ass).toContain("nice shot");
  });

  it("drops a cue that starts at or after the clip's duration", () => {
    const ass = buildClipAss({
      format: "16:9",
      durationSec: 10,
      cues: [{ startSec: 11, endSec: 12, text: "too late" }],
    });
    expect(ass).not.toContain("too late");
  });

  it("strips characters the ASS format treats specially", () => {
    const ass = buildClipAss({
      format: "16:9",
      durationSec: 10,
      cues: [{ startSec: 1, endSec: 2, text: "a {weird} \\line" }],
    });
    expect(ass).toContain("a weird line");
  });
});
