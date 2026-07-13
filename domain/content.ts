import { prisma, type Tx } from "@/lib/db";
import { contentRevisionHash, writeAudit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { require_ } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";
import type { ContentType, Pillar, SpoilerLevel } from "@prisma/client";

const createContentSchema = z.object({
  type: z.enum([
    "LONG_VIDEO",
    "SHORT",
    "WEBSITE_GUIDE",
    "NEWS_BRIEFING",
    "EVIDENCE_ANALYSIS",
    "EXPERIMENT",
    "DOCUMENTARY",
    "COMMUNITY_POST",
    "NEWSLETTER_ISSUE",
  ]),
  pillar: z.enum(["BRIEFING", "EVIDENCE_BOARD", "FIELD_MANUAL", "FIELD_LAB", "LEONIDA_STORIES"]),
  workingTitle: z.string().min(3).max(200),
  viewerPromise: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  spoilerLevel: z
    .enum(["NONE", "PREMISE_ONLY", "EARLY_GAME", "MIDGAME", "MAJOR_STORY", "ENDING"])
    .optional(),
});

export type CreateContentInput = z.infer<typeof createContentSchema>;

export async function createContent(actor: Actor, raw: CreateContentInput) {
  require_(actor, "content.create");
  const input = createContentSchema.parse(raw);

  const content = await prisma.contentItem.create({
    data: {
      workspaceId: actor.workspaceId,
      type: input.type as ContentType,
      pillar: input.pillar as Pillar,
      workingTitle: input.workingTitle,
      viewerPromise: input.viewerPromise,
      priority: input.priority ?? 3,
      spoilerLevel: (input.spoilerLevel ?? "NONE") as SpoilerLevel,
      ownerId: actor.userId,
      status: "IDEA",
    },
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "content.created",
    entityType: "ContentItem",
    entityId: content.id,
    after: { workingTitle: content.workingTitle, status: content.status },
  });

  return content;
}

// Gathers the material state of a content item and its current revision hash.
export async function gatherContentState(contentId: string, tx: Tx | typeof prisma = prisma) {
  const content = await tx.contentItem.findUnique({
    where: { id: contentId },
    include: {
      claims: { include: { claim: true } },
      scripts: { orderBy: { version: "desc" }, take: 1 },
      assets: true,
      thumbnails: true,
      titleVariants: true,
      approvals: true,
    },
  });
  if (!content) throw notFound("Content item not found");

  const currentScript = content.scripts[0] ?? null;
  const hash = contentRevisionHash({
    workingTitle: content.workingTitle,
    publicTitle: content.publicTitle,
    spoilerLevel: content.spoilerLevel,
    scriptBody: currentScript?.body ?? null,
    claimIds: content.claims.map((c) => c.claimId),
    assetIds: content.assets.map((a) => a.id),
    thumbnailIds: content.thumbnails.map((t) => t.id),
  });

  return { content, currentScript, hash };
}

export async function getContentForActor(actor: Actor, contentId: string) {
  const content = await prisma.contentItem.findFirst({
    where: { id: contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");
  return content;
}
