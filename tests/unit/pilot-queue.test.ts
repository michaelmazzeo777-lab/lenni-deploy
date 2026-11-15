import { describe, it, expect } from "vitest";
import { PILOT_QUEUE, REJECTED, score } from "../../prisma/pilot-queue-v1_3";

// Canonical v1.3 pilot shape (APP-PILOT-001) and charter scoring bounds.
describe("pilot queue v1.3", () => {
  const long = PILOT_QUEUE.filter((i) => i.format === "LONG");
  const shorts = PILOT_QUEUE.filter((i) => i.format === "SHORT");

  it("is exactly four long-form and eight Shorts, with one long + two Shorts selected first", () => {
    expect(long).toHaveLength(4);
    expect(shorts).toHaveLength(8);
    expect(long.filter((i) => i.initialSelection)).toHaveLength(1);
    expect(shorts.filter((i) => i.initialSelection)).toHaveLength(2);
    expect(new Set(PILOT_QUEUE.map((i) => i.id)).size).toBe(12);
  });

  it("scores within the charter's factor maxima and penalty cap, with claim IDs", () => {
    const max = [20, 20, 15, 15, 10, 10, 10];
    for (const i of PILOT_QUEUE) {
      i.factors.forEach((f, k) => expect(f).toBeLessThanOrEqual(max[k]!));
      expect(i.penalty).toBeGreaterThanOrEqual(0);
      expect(i.penalty).toBeLessThanOrEqual(40);
      expect(i.claimIds.length).toBeGreaterThan(0);
      expect(i.promise.length).toBeGreaterThan(10);
    }
  });

  it("ranks every scored reject below the accepted items of its format", () => {
    for (const [format, accepted] of [
      ["LONG", long],
      ["SHORT", shorts],
    ] as const) {
      const floor = Math.min(...accepted.map(score));
      for (const r of REJECTED.filter((x) => x.format === format && x.score !== null)) {
        expect(r.score!).toBeLessThan(floor);
      }
    }
    expect(REJECTED.every((r) => r.rule.length > 0 && r.reason.length > 0)).toBe(true);
  });
});
