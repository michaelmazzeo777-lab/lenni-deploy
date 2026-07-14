import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";
import { AssetOwnership, AssetStatus, RightsRisk, RightsDecision } from "@prisma/client";

const createAssetSchema = z.object({
  contentId: z.string(),
  name: z.string().min(1),
  mediaType: z.string().min(1),
  ownership: z.enum(["ORIGINAL", "THIRD_PARTY"]).default("ORIGINAL"),
  ownerName: z.string().optional(),
  sourceUrl: z.string().optional(),
  intendedUse: z.string().optional(),
  licenseBasis: z.string().optional(),
  amountUsed: z.string().optional(),
  transformation: z.string().optional(),
  containsMusic: z.boolean().default(false),
  flagLeaked: z.boolean().default(false),
  flagFakeTrailer: z.boolean().default(false),
  flagIsolatedCutscene: z.boolean().default(false),
  flagUnlicensedMusic: z.boolean().default(false),
  flagMassProducedAI: z.boolean().default(false),
  flagDeceptive: z.boolean().default(false),
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;

export async function createAsset(actor: Actor, raw: CreateAssetInput) {
  require_(actor, "asset.create");
  const input = createAssetSchema.parse(raw);
  const asset = await prisma.asset.create({
    data: {
      ...input,
      ownership: input.ownership as AssetOwnership,
      status: AssetStatus.PENDING,
      createdBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "asset.created",
    entityType: "Asset",
    entityId: asset.id,
    after: { name: asset.name, ownership: asset.ownership },
    metadata: { contentId: input.contentId },
  });
  return asset;
}

const reviewSchema = z.object({
  assetId: z.string(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "BLOCKED"]),
  decision: z.enum(["APPROVED", "NEEDS_WORK", "BLOCKED"]),
  notes: z.string().optional(),
});

export async function reviewAsset(actor: Actor, raw: z.input<typeof reviewSchema>) {
  require_(actor, "rights.review");
  const input = reviewSchema.parse(raw);

  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw notFound("Asset not found");

    // A prohibited-use flag forces a blocked outcome regardless of reviewer input.
    const hasProhibited =
      asset.flagLeaked ||
      asset.flagFakeTrailer ||
      asset.flagIsolatedCutscene ||
      asset.flagUnlicensedMusic ||
      asset.flagMassProducedAI ||
      asset.flagDeceptive;

    const effectiveDecision = hasProhibited ? RightsDecision.BLOCKED : input.decision;
    const effectiveRisk = hasProhibited ? RightsRisk.BLOCKED : input.riskLevel;

    await tx.rightsReview.create({
      data: {
        assetId: asset.id,
        riskLevel: effectiveRisk as RightsRisk,
        decision: effectiveDecision as RightsDecision,
        notes: input.notes,
        reviewerId: actor.userId,
      },
    });

    const newStatus =
      effectiveDecision === RightsDecision.APPROVED ? AssetStatus.REVIEWED : AssetStatus.BLOCKED;
    await tx.asset.update({ where: { id: asset.id }, data: { status: newStatus } });

    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "rights.reviewed",
        entityType: "Asset",
        entityId: asset.id,
        before: { status: asset.status },
        after: { status: newStatus, decision: effectiveDecision, risk: effectiveRisk },
        metadata: { forcedBlock: hasProhibited },
      },
      tx,
    );

    return { assetId: asset.id, status: newStatus, decision: effectiveDecision };
  });
}

// Returns human-readable reasons a content item is rights-blocked from READY.
export async function rightsBlockers(
  contentId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<string[]> {
  const assets = await tx.asset.findMany({ where: { contentId } });
  const blockers: string[] = [];
  for (const a of assets) {
    if (a.status === AssetStatus.BLOCKED) blockers.push(`Asset "${a.name}" is blocked`);
    else if (a.status === AssetStatus.PENDING) blockers.push(`Asset "${a.name}" is unreviewed`);
    if (a.flagLeaked) blockers.push(`Asset "${a.name}": leaked material`);
    if (a.flagFakeTrailer) blockers.push(`Asset "${a.name}": fake trailer`);
    if (a.flagIsolatedCutscene) blockers.push(`Asset "${a.name}": isolated cutscene`);
    if (a.flagUnlicensedMusic) blockers.push(`Asset "${a.name}": unlicensed music`);
    if (a.flagMassProducedAI) blockers.push(`Asset "${a.name}": mass-produced AI`);
    if (a.flagDeceptive) blockers.push(`Asset "${a.name}": deceptive`);
  }

  // A submitted/approved contributor deliverable without a received rights
  // release blocks readiness.
  const missingReleases = await tx.assignment.count({
    where: {
      contentId,
      status: { in: ["SUBMITTED", "APPROVED"] },
      rightsReleaseStatus: "PENDING",
    },
  });
  if (missingReleases > 0) {
    blockers.push(`${missingReleases} contributor deliverable(s) missing a rights release`);
  }

  // Blocked (e.g. leaked-flagged) capture footage blocks readiness.
  const blockedCaptures = await tx.captureSession.count({
    where: { contentId, status: "BLOCKED" },
  });
  if (blockedCaptures > 0) blockers.push(`${blockedCaptures} blocked capture session(s)`);

  // Imported visual assets that have not passed disclosure + rights review block
  // readiness (blocked ones too); rejected assets are unused and do not block.
  const unresolvedVisuals = await tx.visualAsset.count({
    where: { brief: { contentId }, status: { in: ["PENDING_REVIEW", "BLOCKED"] } },
  });
  if (unresolvedVisuals > 0)
    blockers.push(`${unresolvedVisuals} unreviewed/blocked visual asset(s)`);

  // Uploaded files still in quarantine (or rejected by the content scan)
  // block readiness — the asset's real location is not yet trustworthy.
  const unresolvedFiles = await tx.storedFile.count({
    where: {
      OR: [{ asset: { contentId } }, { visualAsset: { brief: { contentId } } }],
      quarantineStatus: { in: ["PENDING", "REJECTED"] },
    },
  });
  if (unresolvedFiles > 0) {
    blockers.push(`${unresolvedFiles} uploaded file(s) awaiting or failing content scan`);
  }

  return [...new Set(blockers)];
}
