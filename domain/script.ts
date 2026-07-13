import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";
import { invalidateStaleApprovals } from "@/domain/approval";
import { z } from "zod";

const saveSchema = z.object({
  contentId: z.string(),
  body: z.string().min(1),
  authorType: z.enum(["HUMAN", "AI"]).default("HUMAN"),
  generationId: z.string().optional(),
  // Words-per-minute assumption for narration duration estimate.
  wpm: z.number().int().positive().default(150),
});

function countWords(body: string): number {
  const m = body.trim().match(/\S+/g);
  return m ? m.length : 0;
}

// Creates a NEW script version (reviewed scripts are never overwritten, docs/01
// Epic 4). Any new version is a material change and invalidates prior approvals.
export async function saveScriptVersion(actor: Actor, raw: z.input<typeof saveSchema>) {
  require_(actor, "script.write");
  const input = saveSchema.parse(raw);
  const wordCount = countWords(input.body);
  const estimatedDuration = Math.round((wordCount / input.wpm) * 60); // seconds

  return prisma.$transaction(async (tx) => {
    const latest = await tx.scriptVersion.findFirst({
      where: { contentId: input.contentId },
      orderBy: { version: "desc" },
    });
    const version = (latest?.version ?? 0) + 1;

    const script = await tx.scriptVersion.create({
      data: {
        contentId: input.contentId,
        version,
        body: input.body,
        wordCount,
        estimatedDuration,
        authorType: input.authorType,
        generationId: input.generationId,
        createdBy: actor.userId,
      },
    });

    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "script.version_saved",
        entityType: "ContentItem",
        entityId: input.contentId,
        metadata: { version, wordCount, authorType: input.authorType },
      },
      tx,
    );

    const invalidated = await invalidateStaleApprovals(
      actor,
      input.contentId,
      tx,
      `Script updated to v${version}`,
    );

    return { script, invalidatedApprovals: invalidated };
  });
}
