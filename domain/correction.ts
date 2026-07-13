import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";
import { CorrectionSeverity, CorrectionStatus } from "@prisma/client";

const schema = z.object({
  contentId: z.string(),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
  originalText: z.string().min(1),
  correctedText: z.string().min(1),
  reason: z.string().min(1),
  publicNotice: z.string().min(1),
  sourceId: z.string().optional(),
});

// Records a correction. If the content already has a published public revision,
// a NEW immutable revision is issued that surfaces the correction notice, and an
// update task is created (docs/06 correction workflow).
export async function createCorrection(actor: Actor, raw: z.input<typeof schema>) {
  require_(actor, "correction.create");
  const input = schema.parse(raw);

  return prisma.$transaction(async (tx) => {
    const content = await tx.contentItem.findUnique({ where: { id: input.contentId } });
    if (!content || content.workspaceId !== actor.workspaceId)
      throw notFound("Content item not found");

    const correction = await tx.correction.create({
      data: {
        contentId: input.contentId,
        severity: input.severity as CorrectionSeverity,
        originalText: input.originalText,
        correctedText: input.correctedText,
        reason: input.reason,
        publicNotice: input.publicNotice,
        sourceId: input.sourceId,
        status: CorrectionStatus.RESOLVED,
        createdBy: actor.userId,
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
      },
    });

    // Issue a new public revision that displays the correction, if published.
    const latest = await tx.publicArticleRevision.findFirst({
      where: { contentId: input.contentId },
      orderBy: { revision: "desc" },
    });
    let newRevisionNumber: number | null = null;
    if (latest) {
      const corrections = await tx.correction.findMany({
        where: { contentId: input.contentId, status: CorrectionStatus.RESOLVED },
        orderBy: { createdAt: "asc" },
      });
      const correctionsSection = [
        "",
        "## Corrections",
        ...corrections.map(
          (c) =>
            `- **${c.severity}** (${c.resolvedAt?.toISOString().slice(0, 10)}): ${c.publicNotice}`,
        ),
      ].join("\n");

      // Strip any prior corrections section before appending the current one.
      const baseBody = latest.body.split("\n## Corrections")[0];
      newRevisionNumber = latest.revision + 1;
      await tx.publicArticleRevision.create({
        data: {
          contentId: input.contentId,
          revision: newRevisionNumber,
          title: latest.title,
          slug: latest.slug,
          summary: latest.summary,
          body: `${baseBody}${correctionsSection}`,
          sourceSnapshot: latest.sourceSnapshot as object,
          claimSnapshot: latest.claimSnapshot as object,
          disclaimer: latest.disclaimer,
          spoilerLevel: latest.spoilerLevel,
          pillar: latest.pillar,
          lastVerifiedAt: new Date(),
          approvedBy: actor.userId,
          approvedAt: new Date(),
        },
      });
    }

    // Create an update task so related content is re-checked.
    await tx.updateTask.create({
      data: {
        contentId: input.contentId,
        triggerType: "CORRECTION",
        triggerReference: correction.id,
        ownerId: content.ownerId,
      },
    });

    await writeAudit(
      {
        workspaceId: content.workspaceId,
        actorId: actor.userId,
        action: "correction.recorded",
        entityType: "ContentItem",
        entityId: input.contentId,
        metadata: {
          correctionId: correction.id,
          severity: input.severity,
          newRevision: newRevisionNumber,
        },
      },
      tx,
    );

    return { correction, newRevision: newRevisionNumber };
  });
}
