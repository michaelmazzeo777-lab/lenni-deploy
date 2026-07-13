import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_, can } from "@/lib/permissions";
import { forbidden, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";
import { Role, AssignmentKind, AssignmentStatus, ReleaseStatus } from "@prisma/client";

// Roles that make an actor a "restricted contributor": they may act only on
// assignments belonging to their own contributor profile.
const CONTRIBUTOR_ROLES: Role[] = [
  Role.CONTRIBUTOR,
  Role.NARRATOR,
  Role.VIDEO_EDITOR,
  Role.DESIGNER,
];
const STAFF_ROLES: Role[] = [Role.OWNER, Role.EDITOR, Role.PRODUCER];

export function isRestrictedContributor(actor: Pick<Actor, "roles">): boolean {
  return (
    actor.roles.some((r) => CONTRIBUTOR_ROLES.includes(r)) &&
    !actor.roles.some((r) => STAFF_ROLES.includes(r))
  );
}

const profileSchema = z.object({
  displayName: z.string().min(2),
  specialty: z.string().optional(),
  userId: z.string().optional(),
  notes: z.string().optional(),
});

// Profiles never store payment credentials, bank data, tax IDs, or identity docs.
export async function createContributor(actor: Actor, raw: z.input<typeof profileSchema>) {
  require_(actor, "contributor.manage");
  const input = profileSchema.parse(raw);
  if (input.userId) {
    const user = await prisma.user.findFirst({
      where: { id: input.userId, workspaceId: actor.workspaceId },
    });
    if (!user) throw notFound("Linked user not found in this workspace");
  }
  const contributor = await prisma.contributor.create({
    data: { workspaceId: actor.workspaceId, ...input },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "contributor.created",
    entityType: "Contributor",
    entityId: contributor.id,
    after: { displayName: contributor.displayName, specialty: contributor.specialty },
  });
  return contributor;
}

const assignSchema = z.object({
  contentId: z.string(),
  contributorId: z.string(),
  kind: z.nativeEnum(AssignmentKind),
  dueAt: z.coerce.date().optional(),
  deliverableNotes: z.string().optional(),
  releaseRequired: z.boolean().default(true),
});

export async function createAssignment(actor: Actor, raw: z.input<typeof assignSchema>) {
  require_(actor, "contributor.manage");
  const input = assignSchema.parse(raw);

  const [content, contributor] = await Promise.all([
    prisma.contentItem.findFirst({
      where: { id: input.contentId, workspaceId: actor.workspaceId },
    }),
    prisma.contributor.findFirst({
      where: { id: input.contributorId, workspaceId: actor.workspaceId },
    }),
  ]);
  if (!content || !contributor) throw notFound("Content or contributor not found");

  const assignment = await prisma.assignment.create({
    data: {
      contentId: input.contentId,
      contributorId: input.contributorId,
      kind: input.kind,
      dueAt: input.dueAt,
      deliverableNotes: input.deliverableNotes,
      rightsReleaseStatus: input.releaseRequired
        ? ReleaseStatus.PENDING
        : ReleaseStatus.NOT_REQUIRED,
      createdBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "assignment.created",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { assignmentId: assignment.id, kind: input.kind, contributorId: contributor.id },
  });
  return assignment;
}

// Loads an assignment and enforces contributor scoping: restricted contributors
// may only touch assignments linked to their own profile.
export async function assertAssignmentAccess(actor: Actor, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { contributor: true, content: true },
  });
  if (!assignment || assignment.content.workspaceId !== actor.workspaceId) {
    throw notFound("Assignment not found");
  }
  if (isRestrictedContributor(actor) && assignment.contributor.userId !== actor.userId) {
    throw forbidden("Contributors may access only their own assignments");
  }
  return assignment;
}

export async function submitAssignment(
  actor: Actor,
  assignmentId: string,
  deliverableNotes: string,
) {
  require_(actor, "assignment.submit");
  const assignment = await assertAssignmentAccess(actor, assignmentId);
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: AssignmentStatus.SUBMITTED, deliverableNotes },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "assignment.submitted",
    entityType: "ContentItem",
    entityId: assignment.contentId,
    metadata: { assignmentId },
  });
  return updated;
}

const reviewSchema = z.object({
  assignmentId: z.string(),
  decision: z.enum(["APPROVED", "REVISION_REQUESTED", "REJECTED"]),
  reviewNotes: z.string().optional(),
});

export async function reviewAssignment(actor: Actor, raw: z.input<typeof reviewSchema>) {
  require_(actor, "contributor.manage");
  const input = reviewSchema.parse(raw);
  const assignment = await assertAssignmentAccess(actor, input.assignmentId);
  const updated = await prisma.assignment.update({
    where: { id: input.assignmentId },
    data: { status: input.decision as AssignmentStatus, reviewNotes: input.reviewNotes },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "assignment.reviewed",
    entityType: "ContentItem",
    entityId: assignment.contentId,
    metadata: { assignmentId: input.assignmentId, decision: input.decision },
  });
  return updated;
}

// Records receipt of a contributor rights release (rights reviewers or managers).
export async function recordRelease(actor: Actor, assignmentId: string) {
  if (!can(actor, "contributor.manage") && !can(actor, "rights.review")) {
    throw forbidden("Not permitted to record rights releases");
  }
  const assignment = await assertAssignmentAccess(actor, assignmentId);
  const updated = await prisma.assignment.update({
    where: { id: assignmentId },
    data: { rightsReleaseStatus: ReleaseStatus.RECEIVED },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "assignment.release_received",
    entityType: "ContentItem",
    entityId: assignment.contentId,
    metadata: { assignmentId },
  });
  return updated;
}

// Assignments visible to the actor: restricted contributors see only their own.
export async function listAssignmentsFor(actor: Actor) {
  if (isRestrictedContributor(actor)) {
    return prisma.assignment.findMany({
      where: {
        contributor: { userId: actor.userId },
        content: { workspaceId: actor.workspaceId },
      },
      include: { content: true, contributor: true },
      orderBy: { createdAt: "desc" },
    });
  }
  return prisma.assignment.findMany({
    where: { content: { workspaceId: actor.workspaceId } },
    include: { content: true, contributor: true },
    orderBy: { createdAt: "desc" },
  });
}
