import { describe, it, expect } from "vitest";
import {
  CaptionError,
  durationCeilingSec,
  parseSrt,
  validateCaptionContract,
} from "@/lib/media/captions";

const srt = (cues: [string, string, string][]) =>
  cues.map(([a, b, t], i) => `${i + 1}\n${a} --> ${b}\n${t}\n`).join("\n");

const TWO = srt([
  ["00:00:00,000", "00:00:03,000", "First caption cue."],
  ["00:00:03,000", "00:00:06,000", "Second caption cue."],
]);
const TRANSCRIPT = "First caption cue.\nSecond caption cue.\n";
const ok = (over: Partial<Parameters<typeof validateCaptionContract>[0]> = {}) =>
  validateCaptionContract({ srt: TWO, transcript: TRANSCRIPT, clipDurationSec: 6, ...over });

describe("duration ceiling", () => {
  it("uses the 180s Shorts platform limit for 9:16, not a hardcoded 60s", () => {
    expect(durationCeilingSec("9:16", undefined)).toBe(180);
    for (const sec of [60, 61, 64, 180]) {
      expect(() => ok({ clipDurationSec: sec, format: "9:16" })).not.toThrow();
    }
    expect(() => ok({ clipDurationSec: 180.5, format: "9:16" })).toThrow(/limit for 9:16 is 180s/);
    expect(() => ok({ clipDurationSec: 181, format: "9:16" })).toThrow(CaptionError);
  });

  it("does not apply the Shorts limit to 16:9", () => {
    expect(durationCeilingSec("16:9", 58)).toBe(600);
    expect(() => ok({ clipDurationSec: 300, format: "16:9" })).not.toThrow();
    expect(() => ok({ clipDurationSec: 601, format: "16:9" })).toThrow(/limit for 16:9 is 600s/);
  });

  it("honours a stricter editorial limit and never lets one raise the platform limit", () => {
    expect(durationCeilingSec("9:16", 58)).toBe(58);
    expect(durationCeilingSec("9:16", 600)).toBe(180);
    expect(() => ok({ clipDurationSec: 58, format: "9:16", editorialMaxSec: 58 })).not.toThrow();
    expect(() => ok({ clipDurationSec: 60, format: "9:16", editorialMaxSec: 58 })).toThrow(
      /limit for 9:16 is 58s/,
    );
    expect(() => durationCeilingSec("9:16", Number.NaN)).toThrow(/Invalid editorial/);
    expect(() => durationCeilingSec("9:16", 0)).toThrow(/Invalid editorial/);
  });

  it("reads SHORTS_EDITORIAL_MAX_SEC when no limit is passed", () => {
    process.env.SHORTS_EDITORIAL_MAX_SEC = "58";
    try {
      expect(durationCeilingSec("9:16")).toBe(58);
      expect(durationCeilingSec("16:9")).toBe(600);
    } finally {
      delete process.env.SHORTS_EDITORIAL_MAX_SEC;
    }
    expect(durationCeilingSec("9:16")).toBe(180);
  });
});

describe("caption and transcript contract", () => {
  it("accepts well-formed captions and reports the cue count", () => {
    expect(ok({ narrationDurationSec: 5.2 })).toEqual({ cueCount: 2, lastCueEndSec: 6 });
  });

  it("accepts a BOM, CRLF line endings, missing counters and dot milliseconds", () => {
    const crlf = "﻿" + TWO.replace(/\n/g, "\r\n");
    expect(ok({ srt: crlf }).cueCount).toBe(2);
    const bare = "00:00:00.000 --> 00:00:03.000\nFirst caption cue.";
    expect(ok({ srt: bare }).cueCount).toBe(1);
  });

  it("does not require identical punctuation, case or line breaks", () => {
    const loose = srt([
      ["00:00:00,000", "00:00:03,000", "first caption\ncue"],
      ["00:00:03,000", "00:00:06,000", "SECOND caption cue!"],
    ]);
    expect(ok({ srt: loose }).cueCount).toBe(2);
  });

  it("rejects text that is not in the transcript, or is out of order", () => {
    expect(() => ok({ transcript: "First caption cue." })).toThrow(/Caption 2: .*not in the/);
    const swapped = srt([
      ["00:00:00,000", "00:00:03,000", "Second caption cue."],
      ["00:00:03,000", "00:00:06,000", "First caption cue."],
    ]);
    expect(() => ok({ srt: swapped })).toThrow(/Caption 2: .*out of order/);
    // "cue" alone must not match inside another word.
    expect(() =>
      ok({ srt: srt([["00:00:00,000", "00:00:01,000", "cu"]]), transcript: "cue" }),
    ).toThrow(/not in the transcript/);
  });

  it("rejects overlapping, reversed, zero-length and out-of-bounds cues", () => {
    const overlap = srt([
      ["00:00:00,000", "00:00:04,000", "First caption cue."],
      ["00:00:03,000", "00:00:06,000", "Second caption cue."],
    ]);
    expect(() => ok({ srt: overlap })).toThrow(/Caption 2: starts before the previous/);
    expect(() =>
      ok({ srt: srt([["00:00:03,000", "00:00:03,000", "First caption cue."]]) }),
    ).toThrow(/Caption 1: ends at or before it starts/);
    expect(() => ok({ clipDurationSec: 5 })).toThrow(/Caption 2: ends at 6\.00s, after the 5\.00s/);
  });

  it("rejects empty and malformed captions with the cue number", () => {
    expect(() => ok({ srt: "  \n" })).toThrow(/Captions are empty/);
    expect(() => ok({ srt: "1\n00:00:00,000 00:00:03,000\nx" })).toThrow(
      /Caption 1: missing "-->"/,
    );
    expect(() => ok({ srt: "1\n0:00:00,000 --> 00:00:03,000\nx" })).toThrow(
      /Caption 1: malformed timestamp "0:00:00,000"/,
    );
    expect(() => ok({ srt: "1\n00:00:00,000 --> 00:00:03,000\n" })).toThrow(/Caption 1: no text/);
    expect(() => ok({ srt: "1\n00:00:00,000 --> 00:00:03,000\n...\n" })).toThrow(/no words/);
    expect(() => ok({ clipDurationSec: 0 })).toThrow(/must be positive/);
  });

  it("rejects a narration longer than the clip", () => {
    expect(() => ok({ narrationDurationSec: 6.5 })).toThrow(
      /Narration \(6\.5s\) is longer than the clip \(6\.0s\)/,
    );
  });

  it("parses hours and multi-line text", () => {
    const [cue] = parseSrt("7\n01:02:03,500 --> 01:02:04,000\nline one\nline two\n");
    expect(cue).toEqual({ index: 1, startSec: 3723.5, endSec: 3724, text: "line one line two" });
  });
});
