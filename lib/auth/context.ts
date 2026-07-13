import { prisma } from "@/lib/db";
import { Role } from "@prisma/client";
import { unauthenticated } from "@/lib/errors";
import { readSessionToken, resolveSessionUserId } from "@/lib/auth/session";

export interface Actor {
  userId: string;
  workspaceId: string;
  displayName: string;
  email: string;
  roles: Role[];
}

// Resolves the authenticated actor from the request session, server-side only.
export async function getActor(): Promise<Actor | null> {
  const token = await readSessionToken();
  const userId = await resolveSessionUserId(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return {
    userId: user.id,
    workspaceId: user.workspaceId,
    displayName: user.displayName,
    email: user.email,
    roles: user.roles.map((r) => r.role),
  };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw unauthenticated();
  return actor;
}
