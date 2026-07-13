import { contentPacketSchema, type ContentPacket } from "@/lib/ai/schema";

export type ValidationStatus = "VALID" | "QUARANTINED" | "FAILED";

export interface ValidationResult {
  status: ValidationStatus;
  packet?: ContentPacket;
  reasons: string[];
}

// Phrases that indicate prohibited affiliation or leaked-material promotion.
const AFFILIATION_PATTERNS = [
  /\bofficial(?:ly)?\s+(?:partner|affiliat|endorse|sponsor)/i,
  /\bin\s+partnership\s+with\s+rockstar/i,
  /\bendorsed\s+by\s+(?:rockstar|take-?two)/i,
];
const LEAK_PATTERNS = [/\bleaked\b/i, /\bdata-?mined?\b/i, /\bhacked\b/i, /\bearly[-\s]?copy\b/i];

function collectClaimIds(packet: ContentPacket): string[] {
  const ids = new Set<string>();
  for (const s of packet.scriptDraft.sections) s.claimIds.forEach((id) => ids.add(id));
  for (const s of packet.shorts) s.claimIds.forEach((id) => ids.add(id));
  for (const s of packet.websiteDraft.sections) s.claimIds.forEach((id) => ids.add(id));
  return [...ids];
}

// Validation pipeline (docs/05_AI_CONTENT_ENGINE.md).
export function validateContentPacket(
  rawText: string,
  allowed: {
    sourceIds: string[];
    claimIds: string[];
    // Ids that were classified LEAKED and must never appear.
    leakedClaimIds: string[];
  },
): ValidationResult {
  const reasons: string[] = [];

  // 1. Parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { status: "FAILED", reasons: ["Output was not valid JSON"] };
  }

  // 2. Schema validation.
  const result = contentPacketSchema.safeParse(parsed);
  if (!result.success) {
    return {
      status: "FAILED",
      reasons: ["Output failed schema validation", ...result.error.issues.map((i) => i.message)],
    };
  }
  const packet = result.data;

  // 3. Every cited claim ID must be in the allowed set (no invented IDs).
  const allowedClaims = new Set(allowed.claimIds);
  const cited = collectClaimIds(packet);
  const invented = cited.filter((id) => !allowedClaims.has(id));
  if (invented.length > 0) {
    reasons.push(`Cited claim IDs not in allowed set: ${invented.join(", ")}`);
  }

  // 4. Reject any LEAKED reference.
  const leaked = new Set(allowed.leakedClaimIds);
  const leakedCited = cited.filter((id) => leaked.has(id));
  if (leakedCited.length > 0) {
    reasons.push(`Output references LEAKED claim IDs: ${leakedCited.join(", ")}`);
  }

  // 5. Affiliation / leak language scan across the whole document.
  const flat = rawText;
  if (AFFILIATION_PATTERNS.some((re) => re.test(flat))) {
    reasons.push("Output implies prohibited Rockstar/Take-Two affiliation");
  }
  if (
    LEAK_PATTERNS.some((re) =>
      re.test(flat.replace(/"(rightsWarnings|rumorWarnings)"[\s\S]*?\]/g, "")),
    )
  ) {
    // Warnings arrays legitimately mention "leaked" as something to avoid; ignore those.
    reasons.push("Output promotes or references leaked/hacked material");
  }

  // 6. Flag factual script sections that cite no claim -> move to unsupportedStatements.
  const enriched = { ...packet, unsupportedStatements: [...packet.unsupportedStatements] };
  for (const s of packet.scriptDraft.sections) {
    if (s.claimIds.length === 0) {
      enriched.unsupportedStatements.push(`Uncited section "${s.heading}": ${s.narration}`);
    }
  }

  if (reasons.length > 0) {
    return { status: "QUARANTINED", packet: enriched, reasons };
  }
  return { status: "VALID", packet: enriched, reasons: [] };
}
