import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { SourceStatus, UpdateTaskStatus } from "@prisma/client";

// Marks a source STALE and opens update tasks for every content item that relies
// on a claim citing it (docs/spec/01: "Source status changes should surface
// affected content"; "Stale claims create update tasks").
export async function markSourceStale(actor: Actor, sourceId: string, reason: string) {
  require_(actor, "source.edit");

  return prisma.$transaction(async (tx) => {
    const source = await tx.source.findFirst({
      where: { id: sourceId, workspaceId: actor.workspaceId },
    });
    if (!source) throw notFound("Source not found");

    await tx.source.update({ where: { id: sourceId }, data: { status: SourceStatus.STALE } });

    // Content items linked (via claims) to this source.
    const affected = await tx.contentClaim.findMany({
      where: { claim: { sources: { some: { sourceId } } } },
      select: { contentId: true },
      distinct: ["contentId"],
    });

    let created = 0;
    for (const { contentId } of affected) {
      const existing = await tx.updateTask.findFirst({
        where: {
          contentId,
          triggerType: "STALE_SOURCE",
          triggerReference: sourceId,
          status: "OPEN",
        },
      });
      if (!existing) {
        await tx.updateTask.create({
          data: {
            contentId,
            triggerType: "STALE_SOURCE",
            triggerReference: sourceId,
            status: UpdateTaskStatus.OPEN,
          },
        });
        created++;
      }
    }

    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "source.marked_stale",
        entityType: "Source",
        entityId: sourceId,
        metadata: { reason, updateTasksCreated: created },
      },
      tx,
    );

    return { sourceId, updateTasksCreated: created };
  });
}

export async function resolveUpdateTask(actor: Actor, taskId: string) {
  require_(actor, "content.edit");
  const task = await prisma.updateTask.findUnique({
    where: { id: taskId },
    include: { content: true },
  });
  if (!task || task.content.workspaceId !== actor.workspaceId)
    throw notFound("Update task not found");

  const updated = await prisma.updateTask.update({
    where: { id: taskId },
    data: { status: UpdateTaskStatus.DONE },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "update_task.resolved",
    entityType: "ContentItem",
    entityId: task.contentId,
    metadata: { taskId, triggerType: task.triggerType },
  });
  return updated;
}
