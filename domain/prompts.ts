import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";

// Prompt-template administration (Owner-only). Versions are APPEND-ONLY:
// a change is always a new row so past AIGeneration.promptTemplateVersion
// values keep pointing at exactly the text that was used. Version 0 means
// the built-in code prompt (lib/ai/prompt.ts). Template systemText is
// appended AFTER the fixed safety rules — it can add editorial guidance but
// can never remove injection-containment / no-leak / no-affiliation rules.

export const PROMPT_TEMPLATE_KEYS = ["content_packet"] as const;

const createSchema = z.object({
  key: z.enum(PROMPT_TEMPLATE_KEYS),
  systemText: z.string().min(10, "Guidance must be at least 10 characters"),
  userTemplate: z.string().default(""),
  outputSchema: z.string().default(""),
});

export async function listPromptTemplates(actor: Actor) {
  require_(actor, "prompt.manage");
  return prisma.promptTemplate.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
}

// Creates the next version for a key (1 for the first). The new version is
// active; earlier versions stay in place for history/rollback.
export async function createPromptTemplateVersion(actor: Actor, raw: z.input<typeof createSchema>) {
  require_(actor, "prompt.manage");
  const input = createSchema.parse(raw);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.promptTemplate.findFirst({
      where: { workspaceId: actor.workspaceId, key: input.key },
      orderBy: { version: "desc" },
    });
    const version = (latest?.version ?? 0) + 1;
    const created = await tx.promptTemplate.create({
      data: {
        workspaceId: actor.workspaceId,
        key: input.key,
        version,
        systemText: input.systemText,
        userTemplate: input.userTemplate,
        outputSchema: input.outputSchema,
        active: true,
        createdBy: actor.userId,
      },
    });
    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "prompt.version_created",
        entityType: "PromptTemplate",
        entityId: created.id,
        metadata: { key: created.key, version: created.version },
      },
      tx,
    );
    return created;
  });
}

// Activate/deactivate one version. Deactivating the newest active version is
// the rollback path — generation falls back to the next-highest active
// version, or the built-in prompt (version 0) when none is active.
export async function setPromptTemplateActive(actor: Actor, id: string, active: boolean) {
  require_(actor, "prompt.manage");
  const tpl = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!tpl || tpl.workspaceId !== actor.workspaceId) throw notFound("Prompt template not found");
  if (tpl.active === active) {
    throw precondition(`Version ${tpl.version} is already ${active ? "active" : "inactive"}`);
  }
  const updated = await prisma.promptTemplate.update({ where: { id }, data: { active } });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: active ? "prompt.activated" : "prompt.deactivated",
    entityType: "PromptTemplate",
    entityId: id,
    metadata: { key: tpl.key, version: tpl.version },
  });
  return updated;
}

// Internal lookup used by generation (no actor: system behavior). Returns the
// highest active version for the key, or null (= use the built-in prompt).
export async function activePromptTemplate(workspaceId: string, key: string) {
  return prisma.promptTemplate.findFirst({
    where: { workspaceId, key, active: true },
    orderBy: { version: "desc" },
  });
}
