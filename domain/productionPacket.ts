import { z } from "zod";
import { prisma } from "@/lib/db";
import { require_ } from "@/lib/permissions";
import { DomainError, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import {
  toCanonicalRecord,
  blocksProduction,
  type CanonicalClass,
} from "@/domain/canonicalTaxonomy";

// Pre-production check of a planning packet (viewer promise plus timed beats).
//
// Moved out of the Gemini v3.1 sandbox module and adapted. The original trusted
// the packet's own claim states and approval flags. Here a packet is untrusted
// input: its shape and beat timing are checked, and every claim it cites is
// looked up in this workspace and classified by the same canonical mapping and
// stale gate the Shorts pipeline uses (toCanonicalRecord / blocksProduction).
// Anything in the packet that asserts approval, rights clearance or a claim
// state is refused rather than believed.
//
// Passing this check approves nothing. Script, capture, rights and render
// approvals remain the existing Studio workflows; publication stays blocked.

const beat = z
  .object({
    beatId: z.string().min(1),
    startSec: z.number().finite().nonnegative(),
    endSec: z.number().finite().positive(),
    narrationText: z.string(),
    onScreenText: z.string(),
    claimIds: z.array(z.string().min(1)),
  })
  .strict();

const packetSchema = z
  .object({
    packetId: z.string().min(1),
    version: z.string().min(1),
    targetViewer: z.string().min(1),
    viewerProblem: z.string().min(1),
    singlePromise: z.string().min(1),
    spoilerCeiling: z.enum(["none", "mild", "major"]),
    claimIds: z.array(z.string().min(1)).min(1),
    beats: z.array(beat).min(1),
    totalRuntimeSec: z.number().finite().positive(),
  })
  // .strict(): self-declared fields such as approvals, rights flags, claim
  // states or a publication state are rejected as unknown keys.
  .strict();

export type ProductionPacket = z.infer<typeof packetSchema>;

const validation = (msg: string, details?: unknown) => new DomainError("VALIDATION", msg, details);

/** Shape and timing only. Pure; no database, no authority. */
export function parseProductionPacket(raw: unknown): ProductionPacket {
  const parsed = packetSchema.safeParse(raw);
  if (!parsed.success) {
    throw validation(
      `Production packet rejected: ${parsed.error.issues.map((i) => `${i.path.join(".") || "packet"}: ${i.message}`).join("; ")}`,
    );
  }
  const packet = parsed.data;
  const declared = new Set(packet.claimIds);
  let prevEnd = 0;
  for (const b of packet.beats) {
    if (b.endSec <= b.startSec) throw validation(`Beat ${b.beatId} ends at or before it starts`);
    if (Math.abs(b.startSec - prevEnd) > 0.001) {
      throw validation(
        `Beat ${b.beatId} starts at ${b.startSec}s but the previous beat ends at ${prevEnd}s`,
      );
    }
    for (const id of b.claimIds) {
      if (!declared.has(id)) throw validation(`Beat ${b.beatId} cites undeclared claim ${id}`);
    }
    prevEnd = b.endSec;
  }
  if (Math.abs(prevEnd - packet.totalRuntimeSec) > 0.05) {
    throw validation(`Beats end at ${prevEnd}s but totalRuntimeSec is ${packet.totalRuntimeSec}s`);
  }
  return packet;
}

export interface PacketCheck {
  packetId: string;
  runtimeSec: number;
  claims: { claimId: string; canonical: CanonicalClass }[];
  publication: "PUBLICATION_BLOCKED";
  approves: "nothing";
}

/** Shape, timing, and every cited claim resolved from this workspace's records. */
export async function checkProductionPacket(actor: Actor, raw: unknown): Promise<PacketCheck> {
  require_(actor, "content.edit");
  const packet = parseProductionPacket(raw);
  const ids = [...new Set(packet.claimIds)];
  const rows = await prisma.claim.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId },
    include: { sources: { include: { source: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const claims: PacketCheck["claims"] = [];
  for (const id of ids) {
    const row = byId.get(id);
    // Unknown and other-workspace ids are indistinguishable on purpose.
    if (!row) throw precondition(`Claim ${id} is not a claim in this workspace`);
    const mapping = toCanonicalRecord(row);
    if (blocksProduction(mapping) || mapping.canonical === null) {
      throw precondition(
        `Claim ${id} is stale, contradicted or quarantined; refresh its sources before production`,
      );
    }
    claims.push({ claimId: id, canonical: mapping.canonical });
  }
  return {
    packetId: packet.packetId,
    runtimeSec: packet.totalRuntimeSec,
    claims,
    publication: "PUBLICATION_BLOCKED",
    approves: "nothing",
  };
}
