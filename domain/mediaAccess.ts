import path from "node:path";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { Actor } from "@/lib/auth/context";

// Decides which stored file (if any) an actor may fetch through
// /studio/media/[kind]/[id]. Returns null for anything not allowed, so the
// route answers 404 without revealing whether a record exists elsewhere.
// Rules: production capability required; same workspace only; storage paths
// come from the database, never from the request.

export interface MediaTarget {
  path: string;
  download?: string;
}

export async function resolveMediaTarget(
  actor: Actor,
  kind: string,
  id: string,
): Promise<MediaTarget | null> {
  if (
    !can(actor, "capture.review") &&
    !can(actor, "ai.generate") &&
    !can(actor, "capture.submit")
  ) {
    return null;
  }
  const workspaceId = actor.workspaceId;
  if (kind === "capture") {
    const m = await prisma.captureMedia.findUnique({ where: { captureSessionId: id } });
    return m?.workspaceId === workspaceId ? { path: m.storagePath } : null;
  }
  if (kind === "thumb") {
    const c = await prisma.highlightCandidate.findUnique({ where: { id } });
    return c?.workspaceId === workspaceId && c.thumbnailPath ? { path: c.thumbnailPath } : null;
  }
  if (
    kind === "render" ||
    kind === "bundle" ||
    kind === "cover" ||
    kind === "contact" ||
    kind === "captions" ||
    kind === "qa"
  ) {
    const r = await prisma.shortsRender.findUnique({ where: { id } });
    // Only local renders have a bundle; mock renders are placeholders, and a
    // rejected render's bytes are purged.
    if (r?.workspaceId !== workspaceId || !r.bundlePath || r.status === "REJECTED") return null;
    if (kind === "render") return { path: r.storagePath };
    if (kind === "cover") return { path: `${path.dirname(r.storagePath)}/cover.jpg` };
    if (kind === "contact") return { path: `${path.dirname(r.storagePath)}/contact.jpg` };
    if (kind === "qa") return { path: `${path.dirname(r.storagePath)}/qa.json` };
    if (kind === "captions") {
      return {
        path: `${path.dirname(r.storagePath)}/captions.srt`,
        download: `captions-${r.id}.srt`,
      };
    }
    return { path: r.bundlePath, download: `leonida-short-${r.id}.zip` };
  }
  return null;
}
