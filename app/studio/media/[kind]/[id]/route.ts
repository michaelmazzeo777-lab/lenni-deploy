import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getAssetStorage } from "@/lib/storage/local-provider";

// Authenticated, workspace-scoped streaming of locally stored media (source
// captures, highlight thumbnails, rendered masters, review bundles). Supports
// HTTP Range so <video> can seek. Paths come from the database, never the URL.

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".zip": "application/zip",
};

async function resolve(kind: string, id: string, workspaceId: string) {
  if (kind === "capture") {
    const m = await prisma.captureMedia.findUnique({ where: { captureSessionId: id } });
    return m?.workspaceId === workspaceId ? { path: m.storagePath } : null;
  }
  if (kind === "thumb") {
    const c = await prisma.highlightCandidate.findUnique({ where: { id } });
    return c?.workspaceId === workspaceId && c.thumbnailPath ? { path: c.thumbnailPath } : null;
  }
  if (kind === "render" || kind === "bundle" || kind === "cover") {
    const r = await prisma.shortsRender.findUnique({ where: { id } });
    // Only local renders have a bundle; mock renders are placeholders.
    if (r?.workspaceId !== workspaceId || !r.bundlePath || r.status === "REJECTED") return null;
    if (kind === "render") return { path: r.storagePath };
    if (kind === "cover") return { path: `${path.dirname(r.storagePath)}/cover.jpg` };
    return { path: r.bundlePath, download: `leonida-short-${r.id}.zip` };
  }
  return null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> },
) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (
    !can(actor, "capture.review") &&
    !can(actor, "ai.generate") &&
    !can(actor, "capture.submit")
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const { kind, id } = await ctx.params;
  const target = await resolve(kind, id, actor.workspaceId);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const abs = getAssetStorage().absolutePath(target.path);
  const info = await stat(abs).catch(() => null);
  if (!info) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });
  const size = info.size;

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    status = 206;
    if (start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  if (target.download) headers["Content-Disposition"] = `attachment; filename="${target.download}"`;
  // Hand-rolled bridge (not Readable.toWeb): browsers routinely abort range
  // requests while seeking, and the file stream must be destroyed on cancel
  // instead of enqueueing into a closed controller.
  const file = createReadStream(abs, { start, end });
  let done = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk) => {
        if (done) return;
        controller.enqueue(chunk as Buffer);
        if ((controller.desiredSize ?? 1) <= 0) file.pause();
      });
      file.on("end", () => {
        if (!done) controller.close();
        done = true;
      });
      file.on("error", (e) => {
        if (!done) controller.error(e);
        done = true;
      });
    },
    pull() {
      file.resume();
    },
    cancel() {
      done = true;
      file.destroy();
    },
  });
  return new NextResponse(body, { status, headers });
}
