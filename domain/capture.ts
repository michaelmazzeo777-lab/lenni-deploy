import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { assertAssignmentAccess } from "@/domain/contributors";
import { z } from "zod";
import { CaptureStatus, SpoilerLevel } from "@prisma/client";

const shotSchema = z.object({
  contentId: z.string(),
  order: z.number().int().positive(),
  title: z.string().min(2),
  description: z.string().optional(),
  captureNotes: z.string().optional(),
  spoilerLevel: z.nativeEnum(SpoilerLevel).default("NONE"),
});

export async function createShot(actor: Actor, raw: z.input<typeof shotSchema>) {
  require_(actor, "content.edit");
  const input = shotSchema.parse(raw);
  const content = await prisma.contentItem.findFirst({
    where: { id: input.contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");
  const shot = await prisma.shot.create({ data: { ...input, createdBy: actor.userId } });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "shot.created",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { shotId: shot.id, order: shot.order, title: shot.title },
  });
  return shot;
}

const submitSchema = z.object({
  contentId: z.string(),
  assignmentId: z.string().optional(),
  shotId: z.string().optional(),
  platform: z.string().min(2),
  gameVersion: z.string().min(1),
  settings: z.string().optional(),
  testConditions: z.string().optional(),
  trialCount: z.number().int().positive().optional(),
  hudVisible: z.boolean().default(true),
  containsLicensedMusic: z.boolean().default(false),
  modsDeclared: z.boolean().default(false),
  modsNotes: z.string().optional(),
  spoilerLevel: z.nativeEnum(SpoilerLevel).default("NONE"),
  fileReference: z.string().optional(),
  flagLeaked: z.boolean().default(false),
  supersedesId: z.string().optional(),
});

// Submits capture footage metadata. Leaked-flagged footage is stored BLOCKED
// (the DB CHECK also enforces this) and can never be approved.
export async function submitCapture(actor: Actor, raw: z.input<typeof submitSchema>) {
  require_(actor, "capture.submit");
  const input = submitSchema.parse(raw);
  const content = await prisma.contentItem.findFirst({
    where: { id: input.contentId, workspaceId: actor.workspaceId },
  });
  if (!content) throw notFound("Content item not found");
  if (input.assignmentId) await assertAssignmentAccess(actor, input.assignmentId);

  const capture = await prisma.captureSession.create({
    data: {
      ...input,
      status: input.flagLeaked ? CaptureStatus.BLOCKED : CaptureStatus.SUBMITTED,
      submittedBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: input.flagLeaked ? "capture.blocked_leaked" : "capture.submitted",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: {
      captureId: capture.id,
      platform: capture.platform,
      supersedes: input.supersedesId ?? null,
    },
  });
  return capture;
}

const reviewSchema = z.object({
  captureId: z.string(),
  decision: z.enum(["APPROVED", "RETAKE_REQUESTED", "REJECTED", "BLOCKED"]),
  reviewNotes: z.string().optional(),
});

export async function reviewCapture(actor: Actor, raw: z.input<typeof reviewSchema>) {
  require_(actor, "capture.review");
  const input = reviewSchema.parse(raw);
  const capture = await prisma.captureSession.findUnique({
    where: { id: input.captureId },
    include: { content: true },
  });
  if (!capture || capture.content.workspaceId !== actor.workspaceId) {
    throw notFound("Capture session not found");
  }
  if (capture.flagLeaked && input.decision === "APPROVED") {
    throw precondition("Leaked-flagged footage cannot be approved");
  }
  if (input.decision === "RETAKE_REQUESTED" && !input.reviewNotes) {
    throw precondition("A retake request needs review notes explaining what to redo");
  }
  const updated = await prisma.captureSession.update({
    where: { id: input.captureId },
    data: {
      status: input.decision as CaptureStatus,
      reviewNotes: input.reviewNotes,
      reviewedBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "capture.reviewed",
    entityType: "ContentItem",
    entityId: capture.contentId,
    metadata: { captureId: input.captureId, decision: input.decision },
  });
  return updated;
}
