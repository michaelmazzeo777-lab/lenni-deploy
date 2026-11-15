import type { ClaimClassification, ClaimStatus, SourceClass, SourceStatus } from "@prisma/client";

// Read-only adapter from this repo's July claim classes to the canonical
// v1.3 evidence classes (reference 06 Source Research SOP / 09 Knowledge
// Schema). It never rewrites a stored claim: the legacy class is always
// returned alongside, and anything the mapping cannot decide on its own is
// flagged for human review rather than guessed.
//
// Hard rules:
//  - repo OBSERVED means "visible in official media". It is NEVER mapped to
//    OBSERVED_IN_GAME, which requires an accepted, version-stamped gameplay
//    test. This adapter cannot produce OBSERVED_IN_GAME at all.
//  - LEAKED stays quarantined: no canonical class, never usable.

export const CANONICAL_CLASSES = [
  "OFFICIAL_CONFIRMED",
  "OBSERVED_IN_GAME",
  "SECONDARY_VERIFIED",
  "INFERENCE",
  "COMMUNITY_CLAIM",
  "UNKNOWN",
  "STALE_OR_CONTRADICTED",
] as const;
export type CanonicalClass = (typeof CANONICAL_CLASSES)[number];

export interface ClaimForMapping {
  classification: ClaimClassification;
  status: ClaimStatus;
  contradictionGroupId: string | null;
  sources: { sourceClass: SourceClass; status: SourceStatus; staleAfter: Date | null }[];
}

export interface CanonicalMapping {
  legacy: ClaimClassification;
  canonical: CanonicalClass | null; // null only when quarantined
  quarantined: boolean;
  needsReview: boolean;
  reasons: string[];
}

export function toCanonical(claim: ClaimForMapping, now: Date = new Date()): CanonicalMapping {
  const base = { legacy: claim.classification, quarantined: false, needsReview: false };
  const reasons: string[] = [];

  if (claim.classification === "LEAKED") {
    return {
      ...base,
      canonical: null,
      quarantined: true,
      reasons: ["LEAKED is prohibited material; it has no canonical class and stays quarantined"],
    };
  }

  const stale = claim.sources.some(
    (s) => s.status !== "ACTIVE" || (s.staleAfter !== null && s.staleAfter <= now),
  );
  if (claim.status === "RETIRED" || stale) {
    return {
      ...base,
      canonical: "STALE_OR_CONTRADICTED",
      needsReview: true,
      reasons: [
        claim.status === "RETIRED"
          ? "claim is retired"
          : "a supporting source is stale, retired or past its stale-after date",
      ],
    };
  }

  let needsReview = false;
  if (claim.contradictionGroupId || claim.sources.some((s) => s.sourceClass === "CONFLICT")) {
    needsReview = true;
    reasons.push("claim is in a contradiction group or has a conflicting source");
  }

  let canonical: CanonicalClass;
  switch (claim.classification) {
    case "CONFIRMED": {
      const official = claim.sources.some((s) => s.sourceClass === "OFFICIAL_SOURCE");
      const corroborated = claim.sources.filter((s) => s.sourceClass === "WEB_CORROBORATED");
      if (official) canonical = "OFFICIAL_CONFIRMED";
      else if (corroborated.length >= 2) {
        canonical = "SECONDARY_VERIFIED";
        needsReview = true;
        reasons.push("CONFIRMED without an official source; two corroborating sources found");
      } else {
        canonical = "UNKNOWN";
        needsReview = true;
        reasons.push("CONFIRMED without an official source on record");
      }
      break;
    }
    case "OBSERVED":
      canonical = "INFERENCE";
      needsReview = true;
      reasons.push(
        "repo OBSERVED = seen in official media, not an accepted gameplay test; " +
          "OBSERVED_IN_GAME needs platform/edition/build/date evidence",
      );
      break;
    case "ANALYSIS":
      canonical = "INFERENCE";
      break;
    case "PREDICTION":
      canonical = "INFERENCE";
      needsReview = true;
      reasons.push("forecast: must carry its literal evidence and limitations");
      break;
    case "RUMOR":
      canonical = "COMMUNITY_CLAIM";
      break;
    case "UNVERIFIED":
      canonical = "UNKNOWN";
      break;
  }
  return { ...base, canonical, needsReview, reasons };
}

// Same mapping for a Prisma claim loaded with `sources: { include: { source } }`.
export type ClaimRecord = Omit<ClaimForMapping, "sources"> & {
  sources: { source: ClaimForMapping["sources"][number] }[];
};
export function toCanonicalRecord(c: ClaimRecord, now: Date = new Date()): CanonicalMapping {
  return toCanonical(
    {
      classification: c.classification,
      status: c.status,
      contradictionGroupId: c.contradictionGroupId,
      sources: c.sources.map((cs) => cs.source),
    },
    now,
  );
}

// A claim blocks production use when it is quarantined or no longer current.
export function blocksProduction(m: CanonicalMapping): boolean {
  return m.quarantined || m.canonical === "STALE_OR_CONTRADICTED";
}
