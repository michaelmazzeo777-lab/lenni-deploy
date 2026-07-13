import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { precondition, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { Role } from "@prisma/client";

export async function assignRole(actor: Actor, targetUserId: string, role: Role) {
  require_(actor, "role.manage");
  const user = await prisma.user.findFirst({
    where: { id: targetUserId, workspaceId: actor.workspaceId },
  });
  if (!user) throw notFound("User not found in this workspace");

  const assignment = await prisma.roleAssignment.upsert({
    where: {
      userId_workspaceId_role: { userId: targetUserId, workspaceId: actor.workspaceId, role },
    },
    create: { userId: targetUserId, workspaceId: actor.workspaceId, role, createdBy: actor.userId },
    update: {},
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "role.assigned",
    entityType: "User",
    entityId: targetUserId,
    metadata: { role },
  });
  return assignment;
}

export async function removeRole(actor: Actor, targetUserId: string, role: Role) {
  require_(actor, "role.manage");

  // Never remove the last remaining Owner in a workspace.
  if (role === Role.OWNER) {
    const owners = await prisma.roleAssignment.count({
      where: { workspaceId: actor.workspaceId, role: Role.OWNER },
    });
    if (owners <= 1) {
      throw precondition("Cannot remove the last Owner of the workspace");
    }
  }

  await prisma.roleAssignment.deleteMany({
    where: { userId: targetUserId, workspaceId: actor.workspaceId, role },
  });

  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "role.removed",
    entityType: "User",
    entityId: targetUserId,
    metadata: { role },
  });
}
