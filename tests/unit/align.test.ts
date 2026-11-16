import { describe, it, expect } from "vitest";
import {
  alignWords,
  compareScript,
  cuesFromComparison,
  lineOnset,
  scriptProblems,
  spokenWords,
  type TimedWord,
} from "@/lib/media/align";

// Script-versus-speech comparison and caption timing. Pure logic: the heard
// words here are written by hand; real transcription is exercised in
// tests/integration/media-qa.test.ts.

const heard = (text: string, startSec = 0, step = 0.4): TimedWord[] =>
  text.split(/\s+/).map((w, i) => ({
    text: w,
    startSec: startSec + i * step,
    endSec: startSec + (i + 1) * step,
  }));

describe("spoken-word normalization", () => {
  it("treats numerals, ordinals and number words as the same sound", () => {
    expect(spokenWords("November 15th, 2026")).toEqual(spokenWords("november fifteen 2026"));
    expect(spokenWords("PlayStation 5")).toEqual(spokenWords("playstation five"));
    expect(spokenWords("twenty-six")).toEqual(["26"]);
    expect(spokenWords("the third card")).toEqual(["the", "3", "card"]);
    expect(spokenWords("1,200 players")).toEqual(["1200", "players"]);
  });

  it("ignores case and punctuation and joins letters spoken one by one", () => {
    expect(spokenWords("Xbox Series X|S.")).toEqual(["xbox", "series", "xs"]);
    expect(spokenWords("Xbox Series XS")).toEqual(["xbox", "series", "xs"]);
    expect(spokenWords("Jason & Lucia")).toEqual(["jason", "and", "lucia"]);
    // "a" and "I" are words, not spelled letters.
    expect(spokenWords("I saw a car")).toEqual(["i", "saw", "a", "car"]);
  });
});

describe("alignment", () => {
  it("scores an exact reading as zero errors and tolerates one slip in a long name", () => {
    const ref = spokenWords("The story is set in Vice City and the state of Leonida");
    expect(alignWords(ref, ref).wer).toBe(0);
    const slip = alignWords(
      ref,
      spokenWords("the story is set in vice city and the state of leonita"),
    );
    expect(slip.wer).toBe(0);
  });

  it("counts substitutions, deletions and insertions, and names what was heard instead", () => {
    const a = alignWords(
      spokenWords("Xbox Series X and S"),
      spokenWords("Xbox Series 10 and S really"),
    );
    expect([a.substitutions, a.deletions, a.insertions]).toEqual([1, 0, 1]);
    expect(a.mismatches).toEqual([["x", "10"]]);
    expect(a.wer).toBeCloseTo(2 / 5);
  });

  it("never treats two different numbers as the same word", () => {
    expect(alignWords(["2026"], ["2025"]).wer).toBe(1);
  });
});

describe("script comparison", () => {
  const lines = [
    "The release date shown is November 19, 2026.",
    "The platforms listed are PlayStation 5 and Xbox Series X|S.",
    "You play as Jason and Lucia.",
  ];

  it("passes a faithful reading and reports where each line was heard", () => {
    const c = compareScript(lines, [
      ...heard("The release date shown is November 19th, 2026.", 0),
      ...heard("The platforms listed are PlayStation five and Xbox Series XS.", 5),
      ...heard("You play as Jason and Lucia.", 10),
    ]);
    expect(scriptProblems(c)).toEqual([]);
    expect(c.wer).toBe(0);
    expect(c.lines.map((l) => l.startSec)).toEqual([0, 5, 10]);
    expect(c.lines.every((l) => l.recall === 1)).toBe(true);
  });

  it("fails when a sentence is missing, even though most words match", () => {
    const c = compareScript(lines, [
      ...heard("The release date shown is November 19, 2026.", 0),
      ...heard("You play as Jason and Lucia.", 10),
    ]);
    expect(scriptProblems(c).join(" ")).toMatch(
      /Line 2: only 0 of \d+ words were heard \(line missing\)/,
    );
  });

  it("fails when a sentence was read as something else", () => {
    const c = compareScript(lines, [
      ...heard("The release date shown is November 19, 2026.", 0),
      ...heard("This sentence talks about something else entirely today okay.", 5),
      ...heard("You play as Jason and Lucia.", 10),
    ]);
    expect(scriptProblems(c).join(" ")).toMatch(/Line 2: only [0-2] of/);
  });

  it("lets a single mispronounced word through as a note, not a failure", () => {
    const c = compareScript(
      ["The platforms listed are PlayStation 5 and Xbox Series X and S."],
      heard("The platforms listed are PlayStation 5 and Xbox Series 10 and S."),
    );
    expect(scriptProblems(c)).toEqual([]);
    expect(c.mismatches).toEqual([["x", "10"]]);
  });
});

describe("caption timing from a recording", () => {
  const lines = ["First line here.", "Second line follows.", "Third line ends."];
  const words = [
    ...heard("First line here.", 0.5),
    ...heard("Second line follows.", 4.0),
    ...heard("Third line ends.", 9.0),
  ];
  // Silence before each line: 0-0.42, 1.9-5.05 (a long pause), 6.4-9.05.
  const silences = [
    { startSec: 0, endSec: 0.42 },
    { startSec: 1.9, endSec: 5.05 },
    { startSec: 6.4, endSec: 9.05 },
  ];

  it("moves a word reported inside a pause to the moment the pause ends", () => {
    // A transcriber put line 2's first word at 4.0s, inside the pause; the voice starts at 5.05s.
    expect(lineOnset(4.0, silences)).toBe(5.05);
    expect(lineOnset(0.5, silences)).toBe(0.42); // just after a pause: snap back to it
    expect(lineOnset(5.3, silences)).toBe(5.05);
    expect(lineOnset(5.9, silences)).toBe(5.9); // mid-speech, no pause nearby: keep the word time
    expect(lineOnset(3, [])).toBe(3);
  });

  it("starts each caption at its line's real speech onset", () => {
    const cues = cuesFromComparison(lines, compareScript(lines, words), 12, silences)!;
    expect(cues.map((c) => c.startSec)).toEqual([0.42, 5.05, 9.05]);
    expect(cues.map((c) => c.text)).toEqual(lines);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.startSec).toBeGreaterThanOrEqual(cues[i - 1]!.endSec);
    }
    expect(cues[2]!.endSec).toBeLessThanOrEqual(12);
  });

  it("fills an unheard line from its neighbours and keeps word times when there is no pause", () => {
    const partial = [...heard("First line here.", 0.5), ...heard("Third line ends.", 9.0)];
    const cues = cuesFromComparison(lines, compareScript(lines, partial), 12)!;
    expect(cues[0]!.startSec).toBe(0.5);
    expect(cues[1]!.startSec).toBeGreaterThanOrEqual(cues[0]!.endSec);
    expect(cues[1]!.endSec).toBeLessThanOrEqual(cues[2]!.startSec);
    expect(cues[2]!.startSec).toBe(9.0);
  });

  it("returns nothing when no line was heard at all", () => {
    expect(
      cuesFromComparison(lines, compareScript(lines, heard("unrelated words only")), 12),
    ).toBeNull();
  });
});

describe("compound words", () => {
  it("matches a compound heard as two words, and two words heard as one", () => {
    const a = alignWords(spokenWords("It is not gameplay."), spokenWords("It is not game play."));
    expect([a.wer, a.mismatches]).toEqual([0, []]);
    expect(a.map).toEqual([0, 1, 2, 3]);
    const b = alignWords(
      spokenWords("the play station console"),
      spokenWords("the playstation console"),
    );
    expect(b.wer).toBe(0);
    expect(b.map).toEqual([0, 1, 1, 2]);
  });
});
