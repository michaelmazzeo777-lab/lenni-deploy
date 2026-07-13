import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";
import { z } from "zod";

const titleSchema = z.object({
  contentId: z.string(),
  text: z.string().min(3).max(120),
  strategy: z.enum(["SEARCH_FIRST", "BROWSE_FIRST"]).default("SEARCH_FIRST"),
  classificationBadge: z.string().optional(),
  // Editor confirms the title is not deceptive/clickbait beyond the evidence.
  deceptionCheck: z.boolean().default(false),
});

export async function createTitleVariant(actor: Actor, raw: z.input<typeof titleSchema>) {
  require_(actor, "packaging.create");
  const input = titleSchema.parse(raw);
  const v = await prisma.titleVariant.create({ data: { ...input, createdBy: actor.userId } });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "packaging.title_created",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { titleVariantId: v.id, text: v.text },
  });
  return v;
}

const thumbSchema = z.object({
  contentId: z.string(),
  name: z.string().min(1),
  brief: z.string().min(3),
  imageLocation: z.string().optional(),
  strategy: z.enum(["SEARCH_FIRST", "BROWSE_FIRST"]).default("BROWSE_FIRST"),
  mobileCheck: z.boolean().default(false),
  deceptionCheck: z.boolean().default(false),
  trademarkCheck: z.boolean().default(false),
});

export async function createThumbnailVariant(actor: Actor, raw: z.input<typeof thumbSchema>) {
  require_(actor, "packaging.create");
  const input = thumbSchema.parse(raw);
  const v = await prisma.thumbnailVariant.create({ data: { ...input, createdBy: actor.userId } });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "packaging.thumbnail_created",
    entityType: "ContentItem",
    entityId: input.contentId,
    metadata: { thumbnailVariantId: v.id, name: v.name },
  });
  return v;
}
