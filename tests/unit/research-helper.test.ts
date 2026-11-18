import { describe, expect, it } from "vitest";
import { questionTerms, HELPER_BOUNDARY, HELPER_CHECKS } from "@/lib/research/helper";

describe("recovered research helper", () => {
  it("deduplicates and bounds question terms", () => {
    expect(questionTerms("City CITY and platforms?")).toEqual(["city", "platforms"]);
    expect(questionTerms(Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "))).toHaveLength(
      12,
    );
  });
  it("does not claim inference or human gameplay approval", () => {
    expect(HELPER_BOUNDARY).toContain("not a verified answer");
    expect(HELPER_CHECKS.join(" ")).toContain("accepted human-owned gameplay test");
    expect(HELPER_CHECKS.join(" ")).toContain("UNKNOWN or STALE_OR_CONTRADICTED");
  });
});
