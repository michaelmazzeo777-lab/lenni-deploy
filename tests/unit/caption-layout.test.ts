import { describe, it, expect } from "vitest";
import {
  CAPTION_STYLE,
  captionBand,
  captionLineCount,
  captionMaxChars,
  chunkCues,
  validateCaptionContract,
} from "@/lib/media/captions";
import { captionFitProblems } from "@/lib/media/qa";

const LONG =
  "Anything beyond that is not confirmed here. This is an independent fan guide, not affiliated with Rockstar Games.";

describe("on-screen caption layout", () => {
  it("keeps 9:16 captions above the player's bottom interface zone and off the edges", () => {
    const s = CAPTION_STYLE["9:16"];
    // Bottom 20% of a Shorts frame carries the title and channel.
    expect(s.marginV).toBeGreaterThanOrEqual(0.2 * s.frameH);
    expect(s.marginH).toBeGreaterThanOrEqual(100);
    const band = captionBand("9:16");
    expect(band.y + band.h).toBeLessThanOrEqual(s.frameH - s.marginV + 30);
    expect(band.y).toBeGreaterThan(1230); // below the card content area
  });

  it("splits a long narration line into captions that each fit, without a stranded word", () => {
    for (const format of ["9:16", "16:9"] as const) {
      const out = chunkCues([{ startSec: 10, endSec: 20, text: LONG }], format);
      expect(out.every((c) => c.text.length <= captionMaxChars(format))).toBe(true);
      expect(
        out.every((c) => captionLineCount(c.text, format) <= CAPTION_STYLE[format].maxLines),
      ).toBe(true);
      expect(out.every((c) => c.text.split(" ").length >= 2)).toBe(true);
      // Same words, same order, contiguous times, same overall span.
      expect(out.map((c) => c.text).join(" ")).toBe(LONG);
      expect(out[0]!.startSec).toBe(10);
      expect(out[out.length - 1]!.endSec).toBe(20);
      for (let i = 1; i < out.length; i++)
        expect(out[i]!.startSec).toBeCloseTo(out[i - 1]!.endSec, 6);
      expect(captionFitProblems(out, format)).toEqual([]);
    }
    expect(chunkCues([{ startSec: 0, endSec: 9, text: LONG }], "9:16").length).toBeGreaterThan(
      chunkCues([{ startSec: 0, endSec: 9, text: LONG }], "16:9").length,
    );
  });

  it("prefers to break after punctuation", () => {
    const out = chunkCues(
      [
        {
          startSec: 0,
          endSec: 6,
          text: "Grand Theft Auto Six. What Rockstar has officially confirmed.",
        },
      ],
      "9:16",
    );
    expect(out.map((c) => c.text)).toEqual([
      "Grand Theft Auto Six.",
      "What Rockstar has officially confirmed.",
    ]);
  });

  it("leaves short captions untouched and keeps the caption contract valid", () => {
    const cues = [
      { startSec: 0, endSec: 2, text: "Short one." },
      { startSec: 2.2, endSec: 9, text: LONG },
    ];
    const out = chunkCues(cues, "9:16");
    expect(out[0]).toEqual(cues[0]);
    const t = (s: number) => `00:00:${s.toFixed(3).padStart(6, "0").replace(".", ",")}`;
    const srt = out
      .map((c, i) => `${i + 1}\n${t(c.startSec)} --> ${t(c.endSec)}\n${c.text}\n`)
      .join("\n");
    expect(
      validateCaptionContract({
        srt,
        transcript: `Short one.\n${LONG}\n`,
        clipDurationSec: 10,
        format: "9:16",
      }).cueCount,
    ).toBe(out.length);
  });

  it("refuses a caption that would spill out of the safe area", () => {
    const problems = captionFitProblems([{ startSec: 0, endSec: 5, text: LONG }], "9:16");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /caption 1 needs \d lines; 9:16 allows 3 before it leaves the safe area/,
    );
    expect(captionFitProblems([{ startSec: 0, endSec: 5, text: "Fits." }], "9:16")).toEqual([]);
  });
});
