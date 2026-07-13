import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { precondition, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";

const createSchema = z.object({
  contentId: z.string(),
  hypothesis: z.string().min(3),
  variantAId: z.string().min(1),
  variantBId: z.string().min(1),
});

// A packaging experiment compares two title variants of the same content item.
export async function createPackagingExperiment(actor: Actor, raw: z.input<typeof createSchema>) {
  require_(actor, "packaging.create");
  const input = createSchema.parse(raw);
  if (input.variantAId === input.variantBId) {
    throw precondition("An experiment needs two different variants");
  }

  const content = await prisma.contentItem.findFirst({
    where: { id: input.contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");

  const variants = await prisma.titleVariant.findMany({
    where: { id: { in: [input.variantAId, input.variantBId] }, contentId: input.contentId },
  });
  if (variants.length !== 2) {
    throw precondition("Both variants must be title variants of this content item");
  }

  const experiment = await prisma.packagingExperiment.create({
    data: {
      contentId: input.contentId,
      hypothesis: input.hypothesis,
      variantAId: input.variantAId,
      variantBId: input.variantBId,
      startAt: new Date(),
      createdBy: actor.userId,
    },
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "experiment.created",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { experimentId: experiment.id },
  });

  return experiment;
}

const concludeSchema = z.object({
  experimentId: z.string(),
  result: z.enum(["SUPPORTED", "CONTRADICTED", "INCONCLUSIVE"]),
  conclusion: z.string().min(3),
});

// Recording a result separates the measured outcome from the interpretation
// (docs/spec/06 experiment workflow).
export async function concludePackagingExperiment(
  actor: Actor,
  raw: z.input<typeof concludeSchema>,
) {
  require_(actor, "packaging.approve");
  const input = concludeSchema.parse(raw);

  const experiment = await prisma.packagingExperiment.findUnique({
    where: { id: input.experimentId },
    include: { content: true },
  });
  if (!experiment || experiment.content.workspaceId !== actor.workspaceId) {
    throw notFound("Experiment not found");
  }
  if (experiment.result) {
    throw precondition("Experiment already concluded");
  }

  const updated = await prisma.packagingExperiment.update({
    where: { id: input.experimentId },
    data: { result: input.result, conclusion: input.conclusion, endAt: new Date() },
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "experiment.concluded",
    entityType: "ContentItem",
    entityId: experiment.contentId,
    metadata: { experimentId: experiment.id, result: input.result },
  });

  return updated;
}
