import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { precondition, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getAIProvider, isAIEnabled, validateContentPacket } from "@/lib/ai";
import type { AIExecutionContext, AISourceRecord, AIClaimRecord } from "@/lib/ai/types";
import { AIValidationStatus, AITaskType, AIReviewDecision } from "@prisma/client";

const DISCLAIMER =
  "Independent fan publication. Not affiliated with or endorsed by Rockstar Games or Take-Two.";

export interface GeneratePacketInput {
  contentId: string;
  sourceIds: string[];
  claimIds: string[];
  editorialTone?: string;
}

export async function generateContentPacket(actor: Actor, input: GeneratePacketInput) {
  require_(actor, "ai.generate");
  if (!isAIEnabled()) {
    throw precondition("AI generation is disabled by the workspace owner");
  }

  const content = await prisma.contentItem.findFirst({
    where: { id: input.contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");

  const sources = await prisma.source.findMany({
    where: { id: { in: input.sourceIds }, workspaceId: actor.workspaceId },
  });
  const claims = await prisma.claim.findMany({
    where: { id: { in: input.claimIds }, workspaceId: actor.workspaceId },
    include: { sources: true },
  });

  // Separate any LEAKED claim: it is never sent to the provider, and its ID is
  // tracked so validation rejects output that references it.
  const leakedClaimIds = claims.filter((c) => c.classification === "LEAKED").map((c) => c.id);
  const usableClaims = claims.filter((c) => c.classification !== "LEAKED");

  const aiSources: AISourceRecord[] = sources.map((s) => ({
    id: s.id,
    title: s.title,
    publisher: s.publisher,
    sourceClass: s.sourceClass,
    factualAsOfDate: s.factualAsOfDate?.toISOString().slice(0, 10) ?? null,
    excerpt: s.supportNotes ?? s.inspectedLocation ?? "",
  }));
  const aiClaims: AIClaimRecord[] = usableClaims.map((c) => ({
    id: c.id,
    statement: c.statement,
    classification: c.classification,
    publicWording: c.publicWording,
    sourceIds: c.sources.map((cs) => cs.sourceId),
  }));

  const ctx: AIExecutionContext = {
    taskType: "CONTENT_PACKET",
    contentId: content.id,
    currentAsOf: new Date().toISOString().slice(0, 10),
    allowedSources: aiSources,
    allowedClaims: aiClaims,
    prohibitedAssertions: [],
    spoilerLevel: content.spoilerLevel,
    disclaimer: DISCLAIMER,
    editorialTone: input.editorialTone ?? "Clear, careful, evidence-first.",
    requestedByUserId: actor.userId,
    workingTitle: content.workingTitle,
    viewerPromise: content.viewerPromise ?? "",
  };

  const provider = getAIProvider();
  const result = await provider.generateContentPacket(ctx);

  const validation = validateContentPacket(result.rawText, {
    sourceIds: aiSources.map((s) => s.id),
    claimIds: aiClaims.map((c) => c.id),
    leakedClaimIds,
  });

  const inputHash = createHash("sha256")
    .update(JSON.stringify({ sids: input.sourceIds.sort(), cids: input.claimIds.sort() }))
    .digest("hex");

  const validationStatus =
    validation.status === "VALID"
      ? AIValidationStatus.VALID
      : validation.status === "QUARANTINED"
        ? AIValidationStatus.QUARANTINED
        : AIValidationStatus.FAILED;

  const generation = await prisma.aIGeneration.create({
    data: {
      workspaceId: actor.workspaceId,
      contentId: content.id,
      taskType: AITaskType.CONTENT_PACKET,
      provider: result.provider,
      model: result.model,
      promptTemplateKey: "content_packet",
      promptTemplateVersion: 1,
      inputHash,
      sourceIds: input.sourceIds,
      claimIds: input.claimIds,
      requestJson: { taskType: ctx.taskType, spoilerLevel: ctx.spoilerLevel } as object,
      responseJson: (validation.packet ?? { raw: result.rawText }) as object,
      validationStatus,
      quarantineReason: validation.reasons.length ? validation.reasons.join("; ") : null,
      tokenUsage: result.usage.tokens ?? null,
      estimatedCost: result.usage.estimatedCost ?? null,
      createdBy: actor.userId,
    },
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "ai.generated",
    entityType: "AIGeneration",
    entityId: generation.id,
    metadata: {
      contentId: content.id,
      provider: result.provider,
      validationStatus,
      reasons: validation.reasons,
    },
  });

  return { generation, validation };
}

export async function reviewGeneration(
  actor: Actor,
  generationId: string,
  decision: AIReviewDecision,
  notes?: string,
) {
  require_(actor, "ai.review");
  const gen = await prisma.aIGeneration.findFirst({
    where: { id: generationId, workspaceId: actor.workspaceId },
  });
  if (!gen) throw notFound("Generation not found");

  const updated = await prisma.aIGeneration.update({
    where: { id: generationId },
    data: { reviewedBy: actor.userId, reviewedAt: new Date(), reviewDecision: decision },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "ai.reviewed",
    entityType: "AIGeneration",
    entityId: generationId,
    metadata: { decision, notes: notes ?? null },
  });
  return updated;
}
