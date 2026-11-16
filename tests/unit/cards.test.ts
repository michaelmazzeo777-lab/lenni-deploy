import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GUIDE_LINE,
  NOT_GAMEPLAY_LINE,
  buildCardsGraph,
  cardProblems,
  cardWindow,
  valueBand,
  wrapText,
  type CardsPlan,
} from "@/lib/media/cards";
import { captionBand } from "@/lib/media/captions";
import { burnedLabel, parseCardLine } from "@/domain/shorts";

const CARDS = [
  { label: "RELEASE DATE", value: "NOVEMBER 19, 2026", note: "As shown on the official page" },
  {
    label: "PLATFORMS",
    value: "PlayStation 5 + Xbox Series X|S",
    note: "The two platforms listed",
  },
];
const plan = (format: "16:9" | "9:16", cards = CARDS): CardsPlan => ({
  format,
  cards,
  startsSec: cards.map((_, i) => i * 5),
  durationSec: cards.length * 5 + 1,
});

async function graph(p: CardsPlan) {
  const dir = await mkdtemp(path.join(tmpdir(), "cards-test-"));
  try {
    const g = await buildCardsGraph(dir, p);
    const files = await readdir(dir);
    const texts = await Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8")));
    return { g, texts };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("title cards", () => {
  it("draws each card only in its own time span, in both layouts", async () => {
    for (const format of ["16:9", "9:16"] as const) {
      const { g, texts } = await graph(plan(format));
      expect(g).toContain("between(t\\,0.000\\,5.000)");
      expect(g).toContain("between(t\\,5.000\\,11.000)");
      expect(g.endsWith("format=yuv420p[cards]")).toBe(true);
      expect(texts).toEqual(
        expect.arrayContaining([GUIDE_LINE, NOT_GAMEPLAY_LINE, "RELEASE DATE", "1 / 2", "2 / 2"]),
      );
      expect(texts.join(" ")).toContain("NOVEMBER 19,");
    }
    expect(cardWindow(plan("16:9"), 1)).toEqual([5, 11]);
  });

  it("composes 9:16 natively: its own frame, stacked header, statement above the captions", async () => {
    const wide = (await graph(plan("16:9"))).g;
    const tall = (await graph(plan("9:16"))).g;
    expect(wide).toContain("gradients=size=1920x1080");
    expect(tall).toContain("gradients=size=1080x1920");
    // 16:9 puts the not-gameplay line at the right edge; 9:16 centres both header lines.
    expect(wide).toContain("x=w-tw-60");
    expect(tall).not.toContain("x=w-tw-60");
    const band = valueBand("9:16");
    expect(band.y + band.h).toBeLessThan(captionBand("9:16").y);
    expect(valueBand("16:9").y + valueBand("16:9").h).toBeLessThan(captionBand("16:9").y);
  });

  it("never puts script text into the filter graph", async () => {
    const nasty = "Bad' text: with, [filter]; drawbox=x=0 \\ %{pts}";
    const { g, texts } = await graph(
      plan("16:9", [{ label: "L", value: nasty.slice(0, 55), note: "n" }]),
    );
    expect(g).not.toContain("Bad");
    expect(g).not.toContain("%{pts}");
    expect(texts.join("")).toContain("Bad' text:");
    expect(g).toMatch(/textfile=card_\d+\.txt/);
  });

  it("refuses cards that are too long, empty, or do not fit either layout", () => {
    expect(cardProblems(CARDS[0]!, 0)).toEqual([]);
    expect(cardProblems({ label: "x".repeat(31), value: "ok", note: "" }, 2)).toEqual([
      "Card 3: label is 31 characters; the limit is 30",
    ]);
    expect(cardProblems({ label: "", value: "  ", note: "" }, 0)).toContain(
      "Card 1: the main statement is empty",
    );
    expect(
      cardProblems(
        { label: "", value: "Supercalifragilisticexpialidocious-and-then-some-more", note: "" },
        0,
      )[0],
    ).toMatch(/does not fit the (16:9|9:16) layout/);
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("rejects a plan whose cards and start times disagree", async () => {
    await expect(graph({ ...plan("16:9"), startsSec: [0] })).rejects.toThrow(/do not match/);
  });
});

describe("burned-in labels say what the picture and the voice are", () => {
  it("names each class separately and never calls a draft a technical fixture", () => {
    const fixture = burnedLabel({
      engineeringFixture: true,
      graphics: false,
      syntheticVoice: true,
    });
    expect(fixture).toBe("INTERNAL TECHNICAL FIXTURE - NOT GAMEPLAY - NOT FOR PUBLICATION");
    const draft = burnedLabel({ engineeringFixture: false, graphics: true, syntheticVoice: true });
    expect(draft).toBe(
      "INTERNAL DRAFT - ILLUSTRATIVE GRAPHICS - SYNTHETIC VOICE - NOT GAMEPLAY - NOT FOR PUBLICATION",
    );
    expect(draft).not.toMatch(/FIXTURE/);
    expect(burnedLabel({ engineeringFixture: false, graphics: true, syntheticVoice: false })).toBe(
      "INTERNAL DRAFT - ILLUSTRATIVE GRAPHICS - NOT GAMEPLAY - NOT FOR PUBLICATION",
    );
    expect(burnedLabel({ engineeringFixture: false, graphics: false, syntheticVoice: true })).toBe(
      "INTERNAL DRAFT - SYNTHETIC VOICE - NOT FOR PUBLICATION",
    );
    // Only an operator's own capture with a recorded voice carries no label.
    expect(
      burnedLabel({ engineeringFixture: false, graphics: false, syntheticVoice: false }),
    ).toBeUndefined();
  });

  it("reads a script line and its card; the statement may contain a pipe", () => {
    expect(
      parseCardLine(
        "Listed platforms are PS5 and Xbox Series X|S. || PLATFORMS :: PlayStation 5 + Xbox Series X|S :: Two listed",
      ),
    ).toEqual({
      text: "Listed platforms are PS5 and Xbox Series X|S.",
      card: { label: "PLATFORMS", value: "PlayStation 5 + Xbox Series X|S", note: "Two listed" },
    });
    expect(parseCardLine("No card here.")).toEqual({ text: "No card here.", card: null });
    expect(parseCardLine("Just a statement || :: ONLY VALUE").card).toEqual({
      label: "",
      value: "ONLY VALUE",
      note: "",
    });
  });
});
