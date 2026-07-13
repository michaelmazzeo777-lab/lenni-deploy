import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getVisualProvider, type VisualPromptPacket } from "@/lib/visuals/providers";
import { z } from "zod";
import {
  VisualKind,
  VisualBriefStatus,
  VisualAssetStatus,
  RealismClass,
  DisclosureDecision,
} from "@prisma/client";

const briefSchema = z.object({
  contentId: z.string(),
  kind: z.nativeEnum(VisualKind),
  title: z.string().min(2),
  prompt: z.string().min(5),
  negativePrompt: z.string().optional(),
  styleNotes: z.string().optional(),
  costCeiling: z.number().min(0).default(0),
});

export async function createVisualBrief(actor: Actor, raw: z.input<typeof briefSchema>) {
  require_(actor, "visual.brief");
  const input = briefSchema.parse(raw);
  const content = await prisma.contentItem.findFirst({
    where: { id: input.contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");
  const brief = await prisma.visualBrief.create({
    data: { ...input, createdBy: actor.userId },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "visual.brief_created",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { briefId: brief.id, kind: brief.kind },
  });
  return brief;
}

// Owner/editor approves the prompt and cost ceiling before any export.
export async function approveVisualPrompt(actor: Actor, briefId: string, costCeiling?: number) {
  require_(actor, "packaging.approve");
  const brief = await loadBrief(actor, briefId);
  const updated = await prisma.visualBrief.update({
    where: { id: briefId },
    data: {
      status: VisualBriefStatus.PROMPT_APPROVED,
      approvedBy: actor.userId,
      ...(costCeiling != null ? { costCeiling } : {}),
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "visual.prompt_approved",
    entityType: "ContentItem",
    entityId: brief.contentId,
    metadata: { briefId, costCeiling: updated.costCeiling },
  });
  return updated;
}

// Exports a provider-ready prompt packet (no external call is made).
export async function exportPromptPacket(actor: Actor, briefId: string, providerName = "manual") {
  require_(actor, "visual.brief");
  const brief = await loadBrief(actor, briefId);
  if (brief.status === VisualBriefStatus.DRAFT) {
    throw precondition("Approve the prompt and cost ceiling before exporting");
  }
  const provider = getVisualProvider(providerName);
  const packet = provider.preparePacket({
    briefId: brief.id,
    kind: brief.kind,
    title: brief.title,
    prompt: brief.prompt,
    negativePrompt: brief.negativePrompt ?? "",
    styleNotes: brief.styleNotes ?? "",
    costCeiling: brief.costCeiling,
  });
  await prisma.visualBrief.update({
    where: { id: briefId },
    data: { status: VisualBriefStatus.EXPORTED },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "visual.packet_exported",
    entityType: "ContentItem",
    entityId: brief.contentId,
    metadata: { briefId, provider: providerName },
  });
  return packet;
}

const importSchema = z.object({
  briefId: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1), // ACTUAL configured model identifier, never assumed
  jobId: z.string().optional(),
  cost: z.number().min(0).default(0),
  location: z.string().optional(),
  aiGenerated: z.boolean().default(true),
  realismClassification: z.nativeEnum(RealismClass).default("ORIGINAL_GRAPHIC"),
});

// Imports/links an externally generated result (or records the mock provider's
// deterministic result). Idempotent per (brief, jobId).
export async function importVisualResult(actor: Actor, raw: z.input<typeof importSchema>) {
  require_(actor, "visual.import");
  const input = importSchema.parse(raw);
  const brief = await loadBrief(actor, input.briefId);
  if (brief.status === VisualBriefStatus.DRAFT) {
    throw precondition("Approve and export the brief before importing a result");
  }
  if (input.cost > brief.costCeiling) {
    throw precondition(
      `Recorded cost ${input.cost} exceeds the approved ceiling ${brief.costCeiling}`,
    );
  }
  if (input.jobId) {
    const existing = await prisma.visualAsset.findFirst({
      where: { briefId: input.briefId, jobId: input.jobId },
    });
    if (existing) return { asset: existing, idempotent: true };
  }
  const asset = await prisma.visualAsset.create({
    data: { ...input, importedBy: actor.userId },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "visual.result_imported",
    entityType: "ContentItem",
    entityId: brief.contentId,
    metadata: {
      briefId: brief.id,
      assetId: asset.id,
      provider: asset.provider,
      model: asset.model,
    },
  });
  return { asset, idempotent: false };
}

// Convenience path for the deterministic mock provider (no credentials, no cost).
export async function generateWithMock(actor: Actor, briefId: string) {
  require_(actor, "visual.import");
  const brief = await loadBrief(actor, briefId);
  if (brief.status === VisualBriefStatus.DRAFT) {
    throw precondition("Approve the prompt before generating");
  }
  const provider = getVisualProvider("mock");
  const packet: VisualPromptPacket = provider.preparePacket({
    briefId: brief.id,
    kind: brief.kind,
    title: brief.title,
    prompt: brief.prompt,
    negativePrompt: brief.negativePrompt ?? "",
    styleNotes: brief.styleNotes ?? "",
    costCeiling: brief.costCeiling,
  });
  const result = await provider.generate(packet);
  return importVisualResult(actor, {
    briefId,
    provider: result.provider,
    model: result.model,
    jobId: result.jobId ?? undefined,
    cost: result.cost,
    location: result.location ?? undefined,
  });
}

const reviewSchema = z.object({
  assetId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED", "BLOCKED"]),
  disclosureDecision: z.nativeEnum(DisclosureDecision),
  reviewNotes: z.string().optional(),
  rejectionReason: z.string().optional(),
  finalUsage: z.string().optional(),
  presentedAsRealGameplay: z.boolean().default(false),
});

// AI-disclosure + rights review. AI output can never be marked as real gameplay
// (domain check + DB CHECK); nothing is auto-approved.
export async function reviewVisualAsset(actor: Actor, raw: z.input<typeof reviewSchema>) {
  require_(actor, "visual.review");
  const input = reviewSchema.parse(raw);
  const asset = await prisma.visualAsset.findUnique({
    where: { id: input.assetId },
    include: { brief: { include: { content: true } } },
  });
  if (!asset || asset.brief.content.workspaceId !== actor.workspaceId) {
    throw notFound("Visual asset not found");
  }
  if (asset.aiGenerated && input.presentedAsRealGameplay) {
    throw precondition("AI-generated visuals cannot be presented as real gameplay");
  }
  if (input.decision === "APPROVED" && input.disclosureDecision === "BLOCKED") {
    throw precondition("Cannot approve an asset whose disclosure decision is BLOCKED");
  }
  if (input.decision !== "APPROVED" && !input.rejectionReason && !input.reviewNotes) {
    throw precondition("A rejection or block needs a recorded reason");
  }
  const updated = await prisma.visualAsset.update({
    where: { id: input.assetId },
    data: {
      status: input.decision as VisualAssetStatus,
      disclosureDecision: input.disclosureDecision,
      reviewNotes: input.reviewNotes,
      rejectionReason: input.rejectionReason,
      finalUsage: input.finalUsage,
      presentedAsRealGameplay: input.presentedAsRealGameplay,
      rightsReviewerId: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "visual.reviewed",
    entityType: "ContentItem",
    entityId: asset.brief.contentId,
    metadata: {
      assetId: asset.id,
      decision: input.decision,
      disclosure: input.disclosureDecision,
    },
  });
  return updated;
}

async function loadBrief(actor: Actor, briefId: string) {
  const brief = await prisma.visualBrief.findUnique({
    where: { id: briefId },
    include: { content: true },
  });
  if (!brief || brief.content.workspaceId !== actor.workspaceId) {
    throw notFound("Visual brief not found");
  }
  return brief;
}
