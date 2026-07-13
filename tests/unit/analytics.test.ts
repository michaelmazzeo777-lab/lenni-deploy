import { describe, it, expect } from "vitest";
import { scorecardSignals } from "@/domain/analytics";

describe("scorecardSignals", () => {
  it("returns no signals when there is no snapshot", () => {
    expect(scorecardSignals(null)).toEqual([]);
  });

  it("grades strong metrics as good and weak metrics as weak", () => {
    const good = scorecardSignals({
      ctr: 0.1,
      firstThirtySecondRetention: 0.75,
      averagePercentageViewed: 0.5,
    });
    expect(good.map((s) => s.status)).toEqual(["good", "good", "good"]);

    const weak = scorecardSignals({
      ctr: 0.02,
      firstThirtySecondRetention: 0.4,
      averagePercentageViewed: 0.2,
    });
    expect(weak.map((s) => s.status)).toEqual(["weak", "weak", "weak"]);
  });

  it("marks missing metrics as na and formats percentages", () => {
    const signals = scorecardSignals({
      ctr: null,
      firstThirtySecondRetention: 0.6,
      averagePercentageViewed: null,
    });
    expect(signals[0]!.status).toBe("na");
    expect(signals[0]!.value).toBe("—");
    expect(signals[1]!.value).toBe("60.0%");
    expect(signals[1]!.status).toBe("watch");
  });
});
