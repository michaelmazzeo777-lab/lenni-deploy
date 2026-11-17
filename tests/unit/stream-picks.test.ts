import { describe, it, expect } from "vitest";
import { parsePicks, parsePicksText, selectPicks, type Pick } from "@/lib/clipper/picks";

const pick = (over: Partial<Pick> = {}): Pick => ({
  start: 1000,
  end: 1025,
  category: "reaction",
  hook_title: "He did not expect that payout",
  why: "Cold-opens on the reaction; the stake is clear from the screen alone.",
  standalone: true,
  energy: 8,
  shareability: 9,
  total: 17,
  ...over,
});

const file = (picks: Pick[]) => ({ runId: "run_abc", rubricVersion: 1, picks });

describe("parsePicks — strict schema", () => {
  it("accepts a well-formed file", () => {
    const parsed = parsePicks(file([pick()]));
    expect(parsed.picks).toHaveLength(1);
    expect(parsed.runId).toBe("run_abc");
  });

  it("rejects unknown keys rather than ignoring them", () => {
    expect(() => parsePicks(file([{ ...pick(), confidence: 0.9 } as Pick]))).toThrow(
      /does not match the required shape/i,
    );
  });

  it("rejects a missing runId or rubricVersion", () => {
    expect(() => parsePicks({ rubricVersion: 1, picks: [pick()] })).toThrow(/runId/);
    expect(() => parsePicks({ runId: "r", picks: [pick()] })).toThrow(/rubricVersion/);
  });

  it("rejects an empty picks array", () => {
    expect(() => parsePicks(file([]))).toThrow(/picks/);
  });

  it("rejects a category outside the fixed set", () => {
    expect(() => parsePicks(file([pick({ category: "epic" as Pick["category"] })]))).toThrow(
      /category/,
    );
  });

  it("rejects end before or equal to start", () => {
    expect(() => parsePicks(file([pick({ start: 1000, end: 1000 })]))).toThrow(
      /end must be after start|under the 15s minimum/,
    );
    expect(() => parsePicks(file([pick({ start: 1000, end: 900 })]))).toThrow(/end must be after/);
  });

  it("rejects a clip under 15s or over 60s, naming the length", () => {
    expect(() => parsePicks(file([pick({ start: 100, end: 110 })]))).toThrow(
      /10\.0s is under the 15s minimum/,
    );
    expect(() => parsePicks(file([pick({ start: 100, end: 200 })]))).toThrow(
      /100\.0s is over the 60s maximum/,
    );
  });

  it("accepts exactly 15s and exactly 60s", () => {
    expect(parsePicks(file([pick({ start: 100, end: 115 })])).picks).toHaveLength(1);
    expect(parsePicks(file([pick({ start: 100, end: 160 })])).picks).toHaveLength(1);
  });

  it("rejects a total that does not equal energy + shareability", () => {
    expect(() => parsePicks(file([pick({ energy: 5, shareability: 5, total: 20 })]))).toThrow(
      /total 20 does not equal energy 5 \+ shareability 5/,
    );
  });

  it("rejects scores outside 1..10 and non-integers", () => {
    expect(() => parsePicks(file([pick({ energy: 0 })]))).toThrow(/energy/);
    expect(() => parsePicks(file([pick({ energy: 11 })]))).toThrow(/energy/);
    expect(() => parsePicks(file([pick({ shareability: 7.5, total: 15.5 } as Pick)]))).toThrow(
      /shareability/,
    );
  });

  it("rejects a negative or non-finite timestamp", () => {
    expect(() => parsePicks(file([pick({ start: -5 })]))).toThrow(/start/);
    expect(() => parsePicks(file([pick({ end: Number.NaN })]))).toThrow(/end/);
  });

  it("rejects an empty or absurdly long hook title", () => {
    expect(() => parsePicks(file([pick({ hook_title: "" })]))).toThrow(/hook_title/);
    expect(() => parsePicks(file([pick({ hook_title: "x".repeat(81) })]))).toThrow(/hook_title/);
  });

  it("rejects a why that is too short to be a real reason", () => {
    expect(() => parsePicks(file([pick({ why: "good" })]))).toThrow(/why/);
  });

  it("reports every invalid pick in one message, not just the first", () => {
    try {
      parsePicks(file([pick({ start: 0, end: 5 }), pick({ start: 100, end: 300 })]));
      throw new Error("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      expect(msg).toMatch(/pick\[0\]/);
      expect(msg).toMatch(/pick\[1\]/);
    }
  });
});

describe("parsePicksText", () => {
  it("names the JSON error rather than throwing a raw SyntaxError", () => {
    expect(() => parsePicksText("{ not json")).toThrow(/not valid JSON/i);
  });

  it("round-trips a valid file", () => {
    expect(parsePicksText(JSON.stringify(file([pick()]))).picks).toHaveLength(1);
  });
});

describe("selectPicks", () => {
  it("orders by total and ranks from 1", () => {
    const sel = selectPicks(
      parsePicks(
        file([
          pick({ start: 100, end: 120, energy: 5, shareability: 5, total: 10 }),
          pick({ start: 300, end: 320, energy: 9, shareability: 9, total: 18 }),
        ]),
      ),
      3,
    );
    expect(sel.map((p) => p.start)).toEqual([300, 100]);
    expect(sel.map((p) => p.rank)).toEqual([1, 2]);
  });

  it("drops picks that fail the standalone test", () => {
    const sel = selectPicks(
      parsePicks(file([pick({ standalone: false }), pick({ start: 300, end: 320 })])),
      3,
    );
    expect(sel).toHaveLength(1);
    expect(sel[0]!.start).toBe(300);
  });

  it("keeps the better-scoring pick when two overlap, and drops the other", () => {
    const sel = selectPicks(
      parsePicks(
        file([
          pick({ start: 100, end: 130, energy: 9, shareability: 9, total: 18 }),
          pick({ start: 120, end: 150, energy: 4, shareability: 4, total: 8 }),
        ]),
      ),
      3,
    );
    expect(sel).toHaveLength(1);
    expect(sel[0]!.start).toBe(100);
  });

  it("keeps adjacent but non-overlapping picks", () => {
    const sel = selectPicks(
      parsePicks(file([pick({ start: 100, end: 130 }), pick({ start: 130, end: 160 })])),
      3,
    );
    expect(sel).toHaveLength(2);
  });

  it("takes at most n", () => {
    const sel = selectPicks(
      parsePicks(
        file([
          pick({ start: 100, end: 130 }),
          pick({ start: 200, end: 230 }),
          pick({ start: 300, end: 330 }),
        ]),
      ),
      2,
    );
    expect(sel).toHaveLength(2);
  });

  it("returns nothing when every pick fails standalone", () => {
    expect(selectPicks(parsePicks(file([pick({ standalone: false })])), 3)).toEqual([]);
  });
});
