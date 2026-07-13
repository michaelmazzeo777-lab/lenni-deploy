import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { Actor } from "@/lib/auth/context";
import { Role } from "@prisma/client";

let counter = 0;

// Creates an isolated workspace so integration tests don't collide even though
// they share one database.
export async function makeWorkspace() {
  counter++;
  const slug = `test-ws-${Date.now()}-${counter}`;
  const workspace = await prisma.workspace.create({
    data: { name: `Test WS ${slug}`, slug, disclaimer: "Independent fan publication (test)." },
  });

  async function actor(roles: Role[], label = "user"): Promise<Actor> {
    const email = `${label}-${slug}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const user = await prisma.user.create({
      data: {
        workspaceId: workspace.id,
        displayName: `${label} ${roles.join("/")}`,
        email,
        passwordHash: hashPassword("pw-123456"),
        roles: { create: roles.map((role) => ({ workspaceId: workspace.id, role })) },
      },
    });
    return {
      userId: user.id,
      workspaceId: workspace.id,
      displayName: user.displayName,
      email,
      roles,
    };
  }

  return { workspace, actor };
}
