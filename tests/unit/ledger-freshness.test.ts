import { describe, it, expect } from "vitest";
import { evaluateLedgerRowFreshness, type Contradiction } from "@/domain/ledgerFreshness";

const NOW = new Date("2026-11-15T17:00:00Z");
const row = (over: Partial<Parameters<typeof evaluateLedgerRowFreshness>[0]> = {}) => ({
  claim_id: "X-1",
  claim_state: "OFFICIAL_CONFIRMED",
  accessed_utc: "2026-11-14T12:00:00Z",
  freshness_ttl: "14d",
  ...over,
});

describe("ledger row freshness", () => {
  it("keeps a row inside its TTL and expires one outside it, at the boundary", () => {
    expect(evaluateLedgerRowFreshness(row(), NOW)).toMatchObject({
      effectiveState: "OFFICIAL_CONFIRMED",
      expired: false,
      contradicted: false,
      reasons: [],
    });
    const at = (iso: string) =>
      evaluateLedgerRowFreshness(row({ accessed_utc: "2026-11-01T17:00:00Z" }), new Date(iso));
    expect(at("2026-11-15T17:00:00Z").expired).toBe(false); // exactly 14 days
    expect(at("2026-11-15T17:00:01Z")).toMatchObject({
      expired: true,
      effectiveState: "STALE_OR_CONTRADICTED",
    });
    expect(evaluateLedgerRowFreshness(row({ freshness_ttl: "24h" }), NOW).expired).toBe(true);
    expect(evaluateLedgerRowFreshness(row({ freshness_ttl: "1w" }), NOW).expired).toBe(false);
  });

  it("fails closed on an unreadable date, TTL or state", () => {
    for (const over of [{ accessed_utc: "not a date" }, { freshness_ttl: "soon" }]) {
      const r = evaluateLedgerRowFreshness(row(over), NOW);
      expect(r).toMatchObject({ expired: true, effectiveState: "STALE_OR_CONTRADICTED" });
      expect(r.reasons[0]).toMatch(/unreadable; treated as expired/);
    }
    expect(evaluateLedgerRowFreshness(row({ claim_state: "CONFIRMED" }), NOW)).toMatchObject({
      effectiveState: "UNKNOWN",
    });
  });

  it("has no built-in knowledge of any claim id", () => {
    for (const claim_id of ["GTA6-PRE-002", "GTA6-PHYS-001", "ANYTHING"]) {
      expect(evaluateLedgerRowFreshness(row({ claim_id }), NOW).reasons).toEqual([]);
    }
  });

  // Regression fixture: the known preload-date conflict found on 2026-11-15
  // (ledger: preload Nov 12; Rockstar Newswire then showed Nov 10).
  it("marks a fresh row contradicted by newer evidence, and ignores older or unrelated evidence", () => {
    const preload: Contradiction = {
      claimId: "GTA6-PRE-002",
      observedAt: new Date("2026-11-15T16:00:00Z"),
      source: "Rockstar Newswire",
      note: "preload shown as Nov 10, ledger says Nov 12",
    };
    const fresh = row({ claim_id: "GTA6-PRE-002" });
    const r = evaluateLedgerRowFreshness(fresh, NOW, [preload]);
    expect(r).toMatchObject({
      expired: false,
      contradicted: true,
      effectiveState: "STALE_OR_CONTRADICTED",
    });
    expect(r.reasons).toEqual([
      "contradicted by Rockstar Newswire: preload shown as Nov 10, ledger says Nov 12",
    ]);
    const older = { ...preload, observedAt: new Date("2026-11-01T00:00:00Z") };
    expect(evaluateLedgerRowFreshness(fresh, NOW, [older]).contradicted).toBe(false);
    expect(evaluateLedgerRowFreshness(row(), NOW, [preload]).contradicted).toBe(false);
  });
});
