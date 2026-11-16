import { CANONICAL_CLASSES, type CanonicalClass } from "@/domain/canonicalTaxonomy";

// Freshness of one row of the canonical claim ledger (reference file 10), read
// only: the ledger files 01-20 are never edited. Claims stored in the Studio
// database already get this treatment from toCanonical(); this covers rows that
// exist only in the ledger CSV.
//
// Adapted from the Gemini v3.1 candidate's evaluateLedgerRowFreshness(), which
// hardcoded two claim ids, defaulted "now" to a fixed date, and treated an
// unreadable access date as fresh. Here contradictions are supplied as dated
// evidence, "now" is required, and anything unreadable fails closed.

export interface LedgerRow {
  claim_id: string;
  claim_state: string;
  accessed_utc: string;
  freshness_ttl: string;
}

/** Newer authoritative evidence that disagrees with a ledger row. */
export interface Contradiction {
  claimId: string;
  observedAt: Date;
  source: string;
  note: string;
}

export interface LedgerFreshness {
  claimId: string;
  recordedState: string;
  effectiveState: CanonicalClass;
  expired: boolean;
  contradicted: boolean;
  reasons: string[];
}

const TTL = /^(\d+)\s*(h|d|w)$/i;
const HOURS = { h: 1, d: 24, w: 168 } as const;

export function evaluateLedgerRowFreshness(
  row: LedgerRow,
  now: Date,
  contradictions: Contradiction[] = [],
): LedgerFreshness {
  const reasons: string[] = [];
  const known = (CANONICAL_CLASSES as readonly string[]).includes(row.claim_state);
  if (!known) reasons.push(`"${row.claim_state}" is not a canonical claim state`);

  const accessed = new Date(row.accessed_utc);
  const ttl = TTL.exec(row.freshness_ttl.trim());
  let expired = true;
  if (Number.isNaN(accessed.getTime())) {
    reasons.push(`access date "${row.accessed_utc}" is unreadable; treated as expired`);
  } else if (!ttl) {
    reasons.push(`freshness TTL "${row.freshness_ttl}" is unreadable; treated as expired`);
  } else {
    const ttlHours = Number(ttl[1]) * HOURS[ttl[2]!.toLowerCase() as keyof typeof HOURS];
    const ageHours = (now.getTime() - accessed.getTime()) / 3_600_000;
    expired = ageHours > ttlHours;
    if (expired) {
      reasons.push(
        `last checked ${row.accessed_utc}; ${row.freshness_ttl} freshness window passed`,
      );
    }
  }

  // Only evidence gathered after the ledger's own check can contradict it.
  const against = contradictions.filter(
    (c) =>
      c.claimId === row.claim_id &&
      (Number.isNaN(accessed.getTime()) || c.observedAt.getTime() > accessed.getTime()),
  );
  for (const c of against) reasons.push(`contradicted by ${c.source}: ${c.note}`);

  const contradicted = against.length > 0;
  const effectiveState: CanonicalClass = !known
    ? "UNKNOWN"
    : expired || contradicted
      ? "STALE_OR_CONTRADICTED"
      : (row.claim_state as CanonicalClass);
  return {
    claimId: row.claim_id,
    recordedState: row.claim_state,
    effectiveState,
    expired,
    contradicted,
    reasons,
  };
}
