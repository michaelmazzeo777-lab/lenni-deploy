// Canonical v1.3 internal packet pilot: exactly four long-form + eight Shorts
// (APP-PILOT-001), scored with the Channel Strategy Charter rubric (reference
// 02, "Topic score and rejection"). PROPOSED - pending editor-in-chief / Mike
// review. Internal packets only; nothing here authorizes publication.
//
// Single source for both the app queue (prisma/seed-pilot-v1_3.ts) and the
// generated 21_Pilot_Content_Queue_v1_0.md.

import type { Pillar } from "@prisma/client";

// Charter factors, in order: problem/promise 20, evidence 20, visual proof 15,
// distinct value 15, audience/pillar fit 10, retention 10, feasibility 10.
export type Factors = [number, number, number, number, number, number, number];

export interface PilotItem {
  id: string;
  format: "LONG" | "SHORT";
  title: string;
  canonicalPillar: string;
  repoPillar: Pillar;
  viewer: string;
  problem: string;
  promise: string;
  targetLength: string;
  claimIds: string[];
  visualPlan: string;
  factors: Factors;
  penalty: number;
  penaltyReason: string;
  initialSelection?: boolean;
}

export interface RejectedItem {
  format: "LONG" | "SHORT";
  title: string;
  score: number | null; // null = rejected regardless of score
  rule: string;
  reason: string;
}

export const score = (i: Pick<PilotItem, "factors" | "penalty">) =>
  i.factors.reduce((a, b) => a + b, 0) - i.penalty;

const BUYER = "Adult buyer deciding how to purchase GTA VI";
const NEWCOMER = "Adult newcomer or returning GTA player";

export const PILOT_QUEUE: PilotItem[] = [
  {
    id: "PILOT-L1",
    format: "LONG",
    title: "GTA's 2D, 3D and HD Universes: Why GTA VI's Vice City Is Not 2002's Vice City",
    canonicalPillar: "GTA History That Matters",
    repoPillar: "LEONIDA_STORIES",
    viewer: NEWCOMER,
    problem: "Official Vice City and Vercetti references make continuity confusing.",
    promise: "Separate what Rockstar has said about its universes from what is still unknown.",
    targetLength: "8-10 min",
    claimIds: ["GTA-UNI-001", "GTA6-VERCETTI-001", "GTA6-CONTINUITY-001"],
    visualPlan: "Original timeline/universe graphics only; no official footage or trade dress.",
    factors: [16, 15, 11, 14, 9, 8, 8],
    penalty: 5,
    penaltyReason: "continuity contradiction still OPEN; nostalgia imagery rights",
    initialSelection: true,
  },
  {
    id: "PILOT-L2",
    format: "LONG",
    title: "GTA VI Before Launch: What Is Officially Confirmed and What Is Still Unknown",
    canonicalPillar: "Leonida Field Guide",
    repoPillar: "BRIEFING",
    viewer: NEWCOMER,
    problem: "Confirmed facts, inference and rumor are mixed together everywhere.",
    promise: "A graded record: confirmed, unknown, and not announced.",
    targetLength: "10-12 min",
    claimIds: [
      "GTA6-REL-001",
      "GTA6-PLAT-001",
      "GTA6-MODE-001",
      "GTA6-CHAR-001",
      "GTA6-LOC-001",
      "GTA6-PC-001",
      "GTA6-MAP-001",
    ],
    visualPlan: "Original evidence-board graphics with claim IDs and as-of dates.",
    factors: [17, 17, 10, 11, 10, 8, 8],
    penalty: 8,
    penaltyReason: "prerelease framing expires at launch (Nov 19); overlaps PILOT-L4",
  },
  {
    id: "PILOT-L3",
    format: "LONG",
    title: "GTA VI Standard vs Ultimate: What Each Edition Actually Includes",
    canonicalPillar: "Smart Start",
    repoPillar: "FIELD_MANUAL",
    viewer: BUYER,
    problem: "Edition names sound similar but contents, bonuses and terms differ.",
    promise: "Exactly what each current official edition includes, with no value claims.",
    targetLength: "7-9 min",
    claimIds: [
      "GTA6-PRICE-001",
      "GTA6-PRICE-002",
      "GTA6-UPGRADE-001",
      "GTA6-ULT-001",
      "GTA6-VVC-001",
      "GTA6-PHYS-001",
      "GTA6-GTAPLUS-RENEW-001",
    ],
    visualPlan: "Original comparison tables; no storefront screenshots or product art.",
    factors: [19, 15, 11, 12, 9, 7, 8],
    penalty: 10,
    penaltyReason:
      "prices/promotions are 24h-TTL facts last checked in July; preorder terms end at launch",
  },
  {
    id: "PILOT-L4",
    format: "LONG",
    title: "Welcome to Leonida: The Six Officially Named Regions So Far",
    canonicalPillar: "Leonida Field Guide",
    repoPillar: "EVIDENCE_BOARD",
    viewer: NEWCOMER,
    problem: "Fan maps blur what Rockstar has actually named.",
    promise: "Only the officially named destinations, with map size left explicitly unknown.",
    targetLength: "8-10 min",
    claimIds: ["GTA6-LOC-001", "GTA6-MAP-001"],
    visualPlan: "Original name cards; official stills only if a rights review clears them.",
    factors: [15, 16, 8, 11, 10, 7, 7],
    penalty: 8,
    penaltyReason: "official-media usage rights unresolved; thin visual proof without it",
  },
  {
    id: "PILOT-S1",
    format: "SHORT",
    title: "GTA VI's Physical Copy Is a Download Code, Not a Disc",
    canonicalPillar: "Smart Start",
    repoPillar: "FIELD_MANUAL",
    viewer: BUYER,
    problem: "Buyers expect a disc in the box.",
    promise: "What the physical Standard Edition actually contains.",
    targetLength: "30-45 s",
    claimIds: ["GTA6-PHYS-001"],
    visualPlan: "Original box/code graphic.",
    factors: [17, 18, 10, 12, 9, 7, 9],
    penalty: 3,
    penaltyReason: "24h-TTL claim; preload date inside it is now contradicted (see recheck)",
    initialSelection: true,
  },
  {
    id: "PILOT-S2",
    format: "SHORT",
    title: "Do You Need to Play GTA V Before GTA VI?",
    canonicalPillar: "Welcome to GTA / Returner's Reset",
    repoPillar: "FIELD_MANUAL",
    viewer: NEWCOMER,
    problem: "Newcomers think GTA V is required homework.",
    promise: "No prerequisite has been announced; GTA V is optional familiarity.",
    targetLength: "60-90 s (VIDEO-001 packet, reference 18)",
    claimIds: [
      "GTA6-PREM-001",
      "GTA6-CHAR-001",
      "GTA6-LOC-001",
      "GTA6-PREREQ-001",
      "GTA6-GTAV-BRIDGE-001",
    ],
    visualPlan: "Original graphics; optional owned GTA V capture via the capture intake.",
    factors: [18, 14, 11, 13, 10, 8, 8],
    penalty: 4,
    penaltyReason:
      "core answer is INFERENCE with an OPEN contradiction entry; qualified wording only",
    initialSelection: true,
  },
  {
    id: "PILOT-S3",
    format: "SHORT",
    title: "PlayStation GTA VI Codes Are Region-Sensitive: Check Before You Buy",
    canonicalPillar: "Smart Start",
    repoPillar: "FIELD_MANUAL",
    viewer: BUYER,
    problem: "An imported code may not redeem on the buyer's account region.",
    promise: "The official PlayStation vs Xbox region rule in one check.",
    targetLength: "30-45 s",
    claimIds: ["GTA6-CODE-REGION-001"],
    visualPlan: "Original region checklist graphic.",
    factors: [17, 17, 9, 13, 8, 7, 9],
    penalty: 4,
    penaltyReason: "platform- and region-specific 24h-TTL claim",
  },
  {
    id: "PILOT-S4",
    format: "SHORT",
    title: "GTA VI Launch Platforms: What Is Announced and What Is Not",
    canonicalPillar: "Leonida Field Guide",
    repoPillar: "BRIEFING",
    viewer: BUYER,
    problem: "PC players keep hearing a PC date is confirmed.",
    promise: "Announced platforms, and 'not currently announced' for PC.",
    targetLength: "30-45 s",
    claimIds: ["GTA6-PLAT-001", "GTA6-PC-001"],
    visualPlan: "Original platform cards with as-of date.",
    factors: [17, 17, 9, 11, 9, 6, 9],
    penalty: 3,
    penaltyReason: "24h-TTL; PC wording must stay UNKNOWN",
  },
  {
    id: "PILOT-S5",
    format: "SHORT",
    title: "Is GTA VI Single-Player? What the Official Description Says",
    canonicalPillar: "Welcome to GTA",
    repoPillar: "BRIEFING",
    viewer: NEWCOMER,
    problem: "Viewers conflate GTA VI with GTA Online.",
    promise: "Exactly how the official product description characterizes the game.",
    targetLength: "30-45 s",
    claimIds: ["GTA6-MODE-001", "GTAO-PROD-001"],
    visualPlan: "Original quote card with source and date.",
    factors: [16, 16, 8, 12, 9, 6, 9],
    penalty: 4,
    penaltyReason: "must not imply anything about an unannounced online mode",
  },
  {
    id: "PILOT-S6",
    format: "SHORT",
    title: "Six Named Places in Leonida in 45 Seconds",
    canonicalPillar: "Leonida Field Guide",
    repoPillar: "EVIDENCE_BOARD",
    viewer: NEWCOMER,
    problem: "Which places are official and which are fan labels?",
    promise: "The six officially named destinations, nothing else.",
    targetLength: "40-50 s",
    claimIds: ["GTA6-LOC-001"],
    visualPlan: "Original name cards.",
    factors: [13, 18, 8, 10, 10, 6, 8],
    penalty: 6,
    penaltyReason: "official imagery rights unresolved; overlaps PILOT-L4",
  },
  {
    id: "PILOT-S7",
    format: "SHORT",
    title: "Jason and Lucia: Who the Official Premise Says They Are",
    canonicalPillar: "Story Without Spoilers",
    repoPillar: "LEONIDA_STORIES",
    viewer: NEWCOMER,
    problem: "Newcomers want the premise without spoilers.",
    promise: "The official premise only, spoiler ceiling S0.",
    targetLength: "40-50 s",
    claimIds: ["GTA6-CHAR-001", "GTA6-PREM-001"],
    visualPlan: "Original title cards; no character art without rights review.",
    factors: [14, 18, 7, 10, 9, 7, 7],
    penalty: 6,
    penaltyReason: "character imagery rights unresolved; spoiler ceiling tightens at launch",
  },
  {
    id: "PILOT-S8",
    format: "SHORT",
    title: "Standard vs Ultimate in 45 Seconds",
    canonicalPillar: "Smart Start",
    repoPillar: "FIELD_MANUAL",
    viewer: BUYER,
    problem: "What is the difference in one glance?",
    promise: "Listed U.S. prices and the official contents difference, no value judgment.",
    targetLength: "40-50 s",
    claimIds: ["GTA6-PRICE-001", "GTA6-PRICE-002", "GTA6-ULT-001"],
    visualPlan: "Original two-column card.",
    factors: [17, 14, 10, 10, 9, 7, 8],
    penalty: 10,
    penaltyReason: "volatile U.S.-only prices last checked in July; cut-down of PILOT-L3",
  },
];

export const REJECTED: RejectedItem[] = [
  {
    format: "LONG",
    title: "Do You Need GTA V Before GTA VI? (long-form version)",
    score: null,
    rule: "duplicates an existing item without material new value",
    reason:
      "Same single promise as PILOT-S2 (VIDEO-001); a long version adds length, not evidence.",
  },
  {
    format: "LONG",
    title: "Your First 10 Hours in GTA VI",
    score: null,
    rule: "core claim unsupported / required capture cannot be completed",
    reason: "Needs OBSERVED_IN_GAME on a release build; none exists before launch.",
  },
  {
    format: "LONG",
    title: "GTA VI Map Size vs GTA V",
    score: null,
    rule: "core claim unsupported; only useful visual is fan/leak reconstruction",
    reason: "GTA6-MAP-001 is UNKNOWN.",
  },
  {
    format: "LONG",
    title: "GTA VI PC Release Date Explained",
    score: null,
    rule: "the promise is deceptive",
    reason: "GTA6-PC-001 is UNKNOWN: no PC version or date is announced.",
  },
  {
    format: "LONG",
    title: "GTA Online Kortz Center Heist: Setup Guide",
    score: 62,
    rule: "ranked below the four accepted (70 before a 8-point penalty)",
    reason: "July patch facts likely superseded; no assigned contributor or owned capture yet.",
  },
  {
    format: "LONG",
    title: "Launch-Week Setup: Preload, Codes and Day-One Mistakes",
    score: 61,
    rule: "ranked below the four accepted (73 before a 12-point stale-evidence penalty)",
    reason:
      "Preload claim GTA6-PRE-002 is contradicted by the Nov 3 newswire; topic expires within days.",
  },
  {
    format: "SHORT",
    title: "The Free GTA+ Month Auto-Renews",
    score: 60,
    rule: "ranked below the eight accepted (72 before a 12-point penalty)",
    reason: "Promotional window closes at launch; terms are storefront-specific.",
  },
  {
    format: "SHORT",
    title: "When Does GTA VI Preload Start?",
    score: null,
    rule: "core claim unsupported (stale/contradicted)",
    reason:
      "Ledger says November 12; the official newswire now says November 10, and it has passed.",
  },
  {
    format: "SHORT",
    title: "GTA VI's Rating",
    score: null,
    rule: "core claim unsupported (stale/contradicted)",
    reason:
      "Ledger says 'not yet rated'; the official page now shows an ESRB Mature mark. Re-source first.",
  },
  {
    format: "SHORT",
    title: "Leaked Map vs Official Trailer",
    score: null,
    rule: "the only useful visual is leaked/fake/unlicensed",
    reason: "Leaked material is never ingested.",
  },
  {
    format: "SHORT",
    title: "First Chase: Action Highlight Reel",
    score: null,
    rule: "required capture/rights work cannot be completed (yet)",
    reason:
      "Needs an owned release-build PS5 capture through Capture intake; revisit after launch.",
  },
];
