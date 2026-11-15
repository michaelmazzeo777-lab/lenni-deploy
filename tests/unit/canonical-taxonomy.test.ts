import { describe, it, expect } from "vitest";
import { ClaimClassification, SourceClass } from "@prisma/client";
import {
  toCanonical,
  blocksProduction,
  CANONICAL_CLASSES,
  type ClaimForMapping,
} from "@/domain/canonicalTaxonomy";

const NOW = new Date("2026-11-15T00:00:00Z");
const src = (sourceClass: SourceClass, over: Partial<ClaimForMapping["sources"][number]> = {}) => ({
  sourceClass,
  status: "ACTIVE" as const,
  staleAfter: null,
  ...over,
});
const claim = (
  classification: ClaimClassification,
  sources: ClaimForMapping["sources"] = [src("OFFICIAL_SOURCE")],
  over: Partial<ClaimForMapping> = {},
): ClaimForMapping => ({
  classification,
  status: "REVIEWED",
  contradictionGroupId: null,
  sources,
  ...over,
});

describe("legacy -> canonical claim taxonomy", () => {
  it("maps the unambiguous classes", () => {
    expect(toCanonical(claim("CONFIRMED"), NOW)).toMatchObject({
      canonical: "OFFICIAL_CONFIRMED",
      needsReview: false,
    });
    expect(toCanonical(claim("ANALYSIS"), NOW).canonical).toBe("INFERENCE");
    expect(toCanonical(claim("RUMOR"), NOW).canonical).toBe("COMMUNITY_CLAIM");
    expect(toCanonical(claim("UNVERIFIED"), NOW).canonical).toBe("UNKNOWN");
  });

  it("never turns repo OBSERVED into OBSERVED_IN_GAME, for any class or source mix", () => {
    const observed = toCanonical(claim("OBSERVED"), NOW);
    expect(observed.canonical).toBe("INFERENCE");
    expect(observed.needsReview).toBe(true);
    expect(observed.legacy).toBe("OBSERVED");
    for (const c of Object.values(ClaimClassification)) {
      for (const s of Object.values(SourceClass)) {
        expect(toCanonical(claim(c, [src(s)]), NOW).canonical).not.toBe("OBSERVED_IN_GAME");
      }
    }
  });

  it("keeps LEAKED quarantined with no canonical class", () => {
    const m = toCanonical(claim("LEAKED"), NOW);
    expect(m).toMatchObject({ canonical: null, quarantined: true, legacy: "LEAKED" });
    expect(blocksProduction(m)).toBe(true);
  });

  it("does not trust CONFIRMED without an official source", () => {
    expect(toCanonical(claim("CONFIRMED", []), NOW)).toMatchObject({
      canonical: "UNKNOWN",
      needsReview: true,
    });
    expect(
      toCanonical(claim("CONFIRMED", [src("WEB_CORROBORATED"), src("WEB_CORROBORATED")]), NOW),
    ).toMatchObject({ canonical: "SECONDARY_VERIFIED", needsReview: true });
  });

  it("marks stale, expired and retired claims STALE_OR_CONTRADICTED and blocks them", () => {
    const cases = [
      claim("CONFIRMED", [src("OFFICIAL_SOURCE", { status: "STALE" })]),
      claim("CONFIRMED", [
        src("OFFICIAL_SOURCE", { staleAfter: new Date("2026-07-21T00:00:00Z") }),
      ]),
      claim("CONFIRMED", undefined, { status: "RETIRED" }),
    ];
    for (const c of cases) {
      const m = toCanonical(c, NOW);
      expect(m.canonical).toBe("STALE_OR_CONTRADICTED");
      expect(blocksProduction(m)).toBe(true);
    }
    const fresh = claim("CONFIRMED", [
      src("OFFICIAL_SOURCE", { staleAfter: new Date("2027-01-01T00:00:00Z") }),
    ]);
    expect(blocksProduction(toCanonical(fresh, NOW))).toBe(false);
  });

  it("flags contradictions and forecasts for review, and only emits canonical classes", () => {
    expect(
      toCanonical(claim("CONFIRMED", undefined, { contradictionGroupId: "g1" }), NOW).needsReview,
    ).toBe(true);
    expect(toCanonical(claim("PREDICTION"), NOW)).toMatchObject({
      canonical: "INFERENCE",
      needsReview: true,
    });
    for (const c of Object.values(ClaimClassification)) {
      const m = toCanonical(claim(c), NOW);
      if (m.canonical !== null) expect(CANONICAL_CLASSES).toContain(m.canonical);
    }
  });
});
