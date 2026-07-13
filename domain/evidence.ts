import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { precondition, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";
import { SourceClass, ClaimClassification, ClaimStatus, SourceStatus } from "@prisma/client";

const sourceSchema = z.object({
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  sourceClass: z.enum([
    "OFFICIAL_SOURCE",
    "WEB_CORROBORATED",
    "USER_PROVIDED",
    "UNVERIFIED",
    "STALE_RISK",
    "CONFLICT",
  ]),
  sourceType: z.string().min(1),
  publicationDate: z.coerce.date().optional(),
  factualAsOfDate: z.coerce.date().optional(),
  inspectedLocation: z.string().optional(),
  supportNotes: z.string().optional(),
  staleAfter: z.coerce.date().optional(),
});

export async function createSource(actor: Actor, raw: z.input<typeof sourceSchema>) {
  require_(actor, "source.create");
  const input = sourceSchema.parse(raw);
  const source = await prisma.source.create({
    data: {
      workspaceId: actor.workspaceId,
      ...input,
      sourceClass: input.sourceClass as SourceClass,
      retrievalDate: new Date(),
      status: SourceStatus.ACTIVE,
      createdBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "source.created",
    entityType: "Source",
    entityId: source.id,
    after: { title: source.title, sourceClass: source.sourceClass },
  });
  return source;
}

const claimSchema = z.object({
  statement: z.string().min(3),
  classification: z.enum([
    "CONFIRMED",
    "OBSERVED",
    "ANALYSIS",
    "PREDICTION",
    "RUMOR",
    "UNVERIFIED",
    "LEAKED",
  ]),
  confidence: z.number().int().min(1).max(5).default(3),
  publicWording: z.string().optional(),
  contradictionGroupId: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
  supportText: z.string().optional(),
});

// Creating a LEAKED claim immediately quarantines it (DB CHECK enforces this too).
export async function createClaim(actor: Actor, raw: z.input<typeof claimSchema>) {
  require_(actor, "claim.create");
  const input = claimSchema.parse(raw);
  const isLeaked = input.classification === "LEAKED";

  return prisma.$transaction(async (tx) => {
    const claim = await tx.claim.create({
      data: {
        workspaceId: actor.workspaceId,
        statement: input.statement,
        classification: input.classification as ClaimClassification,
        confidence: input.confidence,
        publicWording: input.publicWording,
        contradictionGroupId: input.contradictionGroupId,
        status: isLeaked ? ClaimStatus.QUARANTINED : ClaimStatus.PROPOSED,
        createdBy: actor.userId,
      },
    });
    for (const sourceId of input.sourceIds) {
      await tx.claimSource.create({
        data: {
          claimId: claim.id,
          sourceId,
          supportType: "SUPPORTS",
          supportText: input.supportText,
        },
      });
    }
    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: isLeaked ? "claim.quarantined" : "claim.created",
        entityType: "Claim",
        entityId: claim.id,
        after: { classification: claim.classification, status: claim.status },
      },
      tx,
    );
    return claim;
  });
}

// Marks a claim REVIEWED. CONFIRMED requires >=1 active OFFICIAL source.
// LEAKED can never be reviewed.
export async function reviewClaim(actor: Actor, claimId: string) {
  require_(actor, "claim.review");
  return prisma.$transaction(async (tx) => {
    const claim = await tx.claim.findUnique({
      where: { id: claimId },
      include: { sources: { include: { source: true } } },
    });
    if (!claim) throw notFound("Claim not found");
    if (claim.classification === "LEAKED") {
      throw precondition("LEAKED claims cannot be reviewed; they remain quarantined");
    }
    if (claim.classification === "CONFIRMED") {
      const hasOfficial = claim.sources.some(
        (s) => s.source.sourceClass === "OFFICIAL_SOURCE" && s.source.status === "ACTIVE",
      );
      if (!hasOfficial) {
        throw precondition("A CONFIRMED claim requires at least one active official source");
      }
    }
    const updated = await tx.claim.update({
      where: { id: claimId },
      data: { status: ClaimStatus.REVIEWED, lastReviewedAt: new Date() },
    });
    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "claim.reviewed",
        entityType: "Claim",
        entityId: claimId,
        after: { status: updated.status },
      },
      tx,
    );
    return updated;
  });
}

// Links a reviewed claim to a content item. The DB trigger blocks LEAKED claims.
export async function linkClaimToContent(
  actor: Actor,
  contentId: string,
  claimId: string,
  required = false,
) {
  require_(actor, "content.edit");
  const link = await prisma.contentClaim.upsert({
    where: { contentId_claimId: { contentId, claimId } },
    create: { contentId, claimId, required },
    update: { required },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "content.claim_linked",
    entityType: "ContentItem",
    entityId: contentId,
    metadata: { claimId, required },
  });
  return link;
}
