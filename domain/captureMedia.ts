import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getAssetStorage } from "@/lib/storage/local-provider";
import { probeVideo } from "@/lib/media/ffmpeg";
import { resolveIngestFile, VIDEO_EXT } from "@/lib/media/ingest";
import {
  ANALYZER_VERSION,
  extractSignals,
  extractThumbnail,
  rankHighlights,
} from "@/lib/media/highlights";
import { CaptureMethod, MediaRightsStatus, HighlightStatus } from "@prisma/client";

// Real local capture media: ingest with provenance (who/what/how/rights/hash),
// explainable highlight analysis, and the human approve/reject/trim gate.
// First-mile is manual: PS5 Create button -> Media Gallery -> USB -> copy the
// file into the ingest folder. Nothing here talks to a console or account.

async function loadCapture(actor: Actor, captureSessionId: string) {
  const capture = await prisma.captureSession.findUnique({
    where: { id: captureSessionId },
    include: { content: true, media: true },
  });
  if (!capture || capture.content.workspaceId !== actor.workspaceId) {
    throw notFound("Capture session not found");
  }
  return capture;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

const attachSchema = z.object({
  captureSessionId: z.string().min(1),
  fileName: z.string().min(1),
  operator: z.string().trim().min(2),
  gameMode: z.string().trim().optional(),
  captureMethod: z.nativeEnum(CaptureMethod),
  sourceDevice: z.string().trim().min(2),
  audioNotes: z.string().trim().optional(),
  rightsStatus: z.nativeEnum(MediaRightsStatus),
});

export async function attachCaptureMedia(actor: Actor, raw: z.input<typeof attachSchema>) {
  require_(actor, "capture.submit");
  const input = attachSchema.parse(raw);
  const capture = await loadCapture(actor, input.captureSessionId);
  if (capture.flagLeaked || capture.status === "BLOCKED") {
    throw precondition("Blocked or leaked-flagged captures cannot have media attached");
  }
  if (capture.media) throw precondition("This capture already has media attached");
  // A synthetic fixture is always INTERNAL_FIXTURE and nothing else may claim to be.
  const fixtureMethod = input.captureMethod === "SYNTHETIC_FIXTURE";
  const fixtureRights = input.rightsStatus === "INTERNAL_FIXTURE";
  if (fixtureMethod !== fixtureRights) {
    throw precondition("Synthetic fixtures must be marked INTERNAL_FIXTURE (and only they may be)");
  }

  let source: string;
  let probe: Awaited<ReturnType<typeof probeVideo>>;
  try {
    source = await resolveIngestFile(input.fileName, VIDEO_EXT);
    probe = await probeVideo(source);
  } catch (e) {
    throw precondition(`Ingest rejected: ${e instanceof Error ? e.message : "unreadable file"}`);
  }
  const checksumSha256 = await sha256File(source);
  const duplicate = await prisma.captureMedia.findUnique({
    where: { workspaceId_checksumSha256: { workspaceId: actor.workspaceId, checksumSha256 } },
  });
  if (duplicate) {
    throw precondition("This exact file is already ingested for another capture (same SHA-256)");
  }

  const storage = getAssetStorage();
  const storagePath = `captures/${capture.id}/${checksumSha256.slice(0, 16)}${path.extname(input.fileName).toLowerCase()}`;
  const dest = storage.absolutePath(storagePath);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(source, dest);

  const media = await prisma.captureMedia
    .create({
      data: {
        workspaceId: actor.workspaceId,
        captureSessionId: capture.id,
        operator: input.operator,
        gameMode: input.gameMode || null,
        captureMethod: input.captureMethod,
        sourceDevice: input.sourceDevice,
        audioNotes: input.audioNotes || null,
        rightsStatus: input.rightsStatus,
        originalName: input.fileName,
        storagePath,
        checksumSha256,
        sizeBytes: BigInt((await stat(dest)).size),
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        frameRate: probe.frameRate,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        probeJson: probe.raw as object,
        ingestedBy: actor.userId,
      },
    })
    .catch(async (e: unknown) => {
      // Lost a concurrent-ingest race: remove the copied file, report cleanly.
      // ...unless the winner ingested this very file (double submit): then the
      // stored copy is theirs and must stay.
      const owned = await prisma.captureMedia.findFirst({ where: { storagePath } });
      if (!owned) await storage.remove(storagePath).catch(() => undefined);
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw precondition("This capture or file was just ingested by someone else");
      }
      throw e;
    });
  if (!capture.fileReference) {
    await prisma.captureSession.update({
      where: { id: capture.id },
      data: { fileReference: input.fileName },
    });
  }
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "capture.media_ingested",
    entityType: "ContentItem",
    entityId: capture.contentId,
    metadata: {
      captureId: capture.id,
      checksumSha256,
      captureMethod: input.captureMethod,
      rightsStatus: input.rightsStatus,
    },
  });
  return media;
}

// Runs the signal analysis on an APPROVED capture's stored video and replaces
// any still-PENDING candidates. Reviewed candidates are kept as history.
export async function analyzeHighlights(actor: Actor, captureSessionId: string) {
  require_(actor, "capture.review");
  const capture = await loadCapture(actor, captureSessionId);
  if (capture.flagLeaked) throw precondition("Leaked-flagged footage can never be analyzed");
  if (capture.status !== "APPROVED") {
    throw precondition("Only an APPROVED capture can be analyzed for highlights");
  }
  if (!capture.media) throw precondition("Attach the capture's video file first");

  const storage = getAssetStorage();
  const file = storage.absolutePath(capture.media.storagePath);
  const started = Date.now();
  const bins = await extractSignals(file, capture.media.audioCodec !== null);
  const ranked = rankHighlights(bins);
  const analysisRunId = randomUUID();

  // Already-reviewed cuts are kept as history; a new candidate that mostly
  // covers one is dropped so the same footage is never listed twice.
  const reviewed = await prisma.highlightCandidate.findMany({
    where: { captureSessionId, status: { not: HighlightStatus.PENDING } },
  });
  const covered = (c: { startSec: number; endSec: number }) =>
    reviewed.some(
      (r) =>
        Math.min(c.endSec, r.endSec) - Math.max(c.startSec, r.startSec) >
        0.5 * (c.endSec - c.startSec),
    );
  const rows = [];
  for (const c of ranked.filter((x) => !covered(x))) {
    const thumbnailPath = `captures/${capture.id}/thumbs/${analysisRunId}-${c.rank}.jpg`;
    await storage.write(thumbnailPath, await extractThumbnail(file, c.peakSec));
    rows.push({
      workspaceId: actor.workspaceId,
      captureSessionId,
      analysisRunId,
      rank: c.rank,
      startSec: c.startSec,
      endSec: Math.min(c.endSec, capture.media.durationSec),
      peakSec: c.peakSec,
      score: c.score,
      signalsJson: c.signals as unknown as object,
      thumbnailPath,
      analyzerVersion: ANALYZER_VERSION,
    });
  }
  await prisma.$transaction([
    prisma.highlightCandidate.deleteMany({
      where: { captureSessionId, status: HighlightStatus.PENDING },
    }),
    prisma.highlightCandidate.createMany({ data: rows }),
  ]);
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "capture.highlights_analyzed",
    entityType: "ContentItem",
    entityId: capture.contentId,
    metadata: {
      captureId: capture.id,
      analysisRunId,
      analyzer: ANALYZER_VERSION,
      candidates: rows.length,
      analysisMs: Date.now() - started,
    },
  });
  return { analysisRunId, candidates: rows.length };
}

const reviewSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  trimStartSec: z.number().min(0).optional(),
  trimEndSec: z.number().positive().optional(),
  notes: z.string().trim().optional(),
});

// Approve / reject / trim. The decision can be revised until a script is
// built on the cut; after that the cut cannot be rejected out from under it.
export async function reviewHighlight(actor: Actor, raw: z.input<typeof reviewSchema>) {
  require_(actor, "capture.review");
  const input = reviewSchema.parse(raw);
  const candidate = await prisma.highlightCandidate.findUnique({
    where: { id: input.candidateId },
    include: { captureSession: { include: { media: true } }, shortsScripts: { take: 1 } },
  });
  if (!candidate || candidate.workspaceId !== actor.workspaceId) {
    throw notFound("Highlight candidate not found");
  }
  const media = candidate.captureSession.media;
  if (!media) throw precondition("Capture media is missing");
  if (candidate.shortsScripts.length > 0) {
    throw precondition("A script already uses this cut; it can no longer be changed");
  }
  const start = input.trimStartSec ?? candidate.startSec;
  const end = input.trimEndSec ?? candidate.endSec;
  if (!(end > start) || end > media.durationSec + 0.05) {
    throw precondition("Trim range must be inside the clip with out after in");
  }
  const updated = await prisma.highlightCandidate.update({
    where: { id: candidate.id },
    data: {
      status: input.decision,
      trimStartSec: input.trimStartSec ?? null,
      trimEndSec: input.trimEndSec ?? null,
      reviewNotes: input.notes || null,
      reviewedBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action:
      input.decision === "APPROVED" ? "capture.highlight_approved" : "capture.highlight_rejected",
    entityType: "ContentItem",
    entityId: candidate.captureSession.contentId,
    metadata: { candidateId: candidate.id, inSec: start, outSec: end },
  });
  return updated;
}
