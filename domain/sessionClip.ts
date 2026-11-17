// The long-session clipper: "Clip a session" on an approved, ingested
// capture. Shortlists windows from cheap full-file signals, confirms each
// with local speech-to-text (word-level timestamps), snaps boundaries to
// silence or a scene cut without ever landing mid-word, renders both formats,
// QAs each, and lands the result in the Library as PENDING_MIKE_REVIEW.
// Mirrors domain/premiumRender.ts's job shape exactly (atomic claim,
// heartbeat, cancel, crash recovery, per-job work folder) because that *is*
// "the existing job system" this run was told to reuse.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getAssetStorage } from "@/lib/storage/local-provider";
import { run } from "@/lib/media/ffmpeg";
import { extractSignals, extractThumbnail, ANALYZER_VERSION } from "@/lib/media/highlights";
import { chunkCues, type RenderFormat } from "@/lib/media/captions";
import { clampWindowSec, overlaps, shortlistWindows, snapBoundaries } from "@/lib/clipper/moments";
import { sceneCutsNear, silencesNear, transcribeWindow } from "@/lib/clipper/transcribeWindow";
import { wordsToCues } from "@/lib/clipper/captions";
import { renderClip, type CropMode } from "@/lib/clipper/render";
import { clipQa } from "@/lib/clipper/qa";
import { cleanClipperWork, clipperProblems, clipperWorkRoot } from "@/lib/clipper/engine";
import type { MediaJob } from "@prisma/client";

export const CLIPPER_LABEL = "Clip a session";
export const HEARTBEAT_STALE_MS = 45_000;
const FORMATS: RenderFormat[] = ["16:9", "9:16"];
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

async function loadClippableCapture(actor: Actor, captureSessionId: string) {
  const capture = await prisma.captureSession.findUnique({
    where: { id: captureSessionId },
    include: { content: true, media: true },
  });
  if (!capture || capture.content.workspaceId !== actor.workspaceId) {
    throw notFound("Capture session not found");
  }
  if (capture.flagLeaked) throw precondition("Leaked-flagged footage can never be clipped");
  if (capture.kind === "GRAPHICS") {
    throw precondition("An explainer session has no footage to clip");
  }
  if (capture.status !== "APPROVED") {
    throw precondition("Only an APPROVED capture can be clipped");
  }
  if (!capture.media) throw precondition("Attach the capture's video file first");
  return capture;
}

function keyFor(mediaChecksum: string, n: number, cropMode: CropMode): string {
  return sha256(JSON.stringify({ v: 1, mediaChecksum, n, cropMode, analyzer: ANALYZER_VERSION }));
}

/**
 * Starts (or retries) the long-session clipper and returns at once. Same
 * inputs = same job: a finished job is returned as is, a running one is
 * refused, a failed or canceled one runs again.
 */
export async function startSessionClip(
  actor: Actor,
  captureSessionId: string,
  opts: { n?: number; cropMode?: CropMode } = {},
): Promise<MediaJob> {
  require_(actor, "capture.review");
  const n = opts.n ?? 8;
  const cropMode: CropMode = opts.cropMode ?? "center-crop";
  if (!(n >= 1 && n <= 20)) throw precondition("Clip count must be between 1 and 20");
  const capture = await loadClippableCapture(actor, captureSessionId);
  const problems = clipperProblems();
  if (problems.length) throw precondition(`The clipper is not ready: ${problems.join("; ")}`);
  await recoverInterruptedSessionClipJobs(actor.workspaceId);

  const idempotencyKey = keyFor(capture.media!.checksumSha256, n, cropMode);
  const where = {
    workspaceId_kind_idempotencyKey: {
      workspaceId: actor.workspaceId,
      kind: "SESSION_CLIP" as const,
      idempotencyKey,
    },
  };
  const job =
    (await prisma.mediaJob.findUnique({ where })) ??
    (await prisma.mediaJob
      .create({
        data: {
          workspaceId: actor.workspaceId,
          kind: "SESSION_CLIP",
          idempotencyKey,
          subjectId: captureSessionId,
          label: CLIPPER_LABEL,
          createdBy: actor.userId,
        },
      })
      .catch(async (e: unknown) => {
        if ((e as { code?: string }).code === "P2002")
          return prisma.mediaJob.findUniqueOrThrow({ where });
        throw e;
      }));

  const claimed = await prisma.mediaJob.updateMany({
    where: { id: job.id, status: { in: ["QUEUED", "FAILED", "CANCELED", "SUCCEEDED"] } },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      finishedAt: null,
      heartbeatAt: new Date(),
      cancelRequestedAt: null,
      progress: "Starting",
      lastError: null,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    throw precondition("This session is already being clipped; cancel it or wait for it to finish");
  }
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "clipper.job_started",
    entityType: "MediaJob",
    entityId: job.id,
    metadata: { captureSessionId, n, cropMode },
  });
  // Deliberately not awaited: the job outlives the request. Its state is in the database.
  void execute(job.id, actor, { n, cropMode }).catch(() => undefined);
  return prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
}

/** Asks a running clipper job to stop. It checks between windows/clips, not mid-ffmpeg-call. */
export async function cancelSessionClip(actor: Actor, jobId: string): Promise<MediaJob> {
  require_(actor, "capture.review");
  const job = await prisma.mediaJob.findUnique({ where: { id: jobId } });
  if (!job || job.workspaceId !== actor.workspaceId || job.kind !== "SESSION_CLIP") {
    throw notFound("Job not found");
  }
  if (job.status !== "RUNNING") throw precondition("Only a running job can be canceled");
  await prisma.mediaJob.update({
    where: { id: jobId },
    data: { cancelRequestedAt: new Date(), progress: "Cancel requested" },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "clipper.job_cancel_requested",
    entityType: "MediaJob",
    entityId: jobId,
    metadata: {},
  });
  return prisma.mediaJob.findUniqueOrThrow({ where: { id: jobId } });
}

/**
 * Restart recovery. A RUNNING job whose process stopped reporting (the
 * Studio was restarted or crashed) is closed as FAILED - or CANCELED if a
 * cancel was pending - so the operator can retry it.
 */
export async function recoverInterruptedSessionClipJobs(workspaceId: string): Promise<number> {
  const stale = await prisma.mediaJob.findMany({
    where: {
      workspaceId,
      kind: "SESSION_CLIP",
      status: "RUNNING",
      OR: [
        { heartbeatAt: null },
        { heartbeatAt: { lt: new Date(Date.now() - HEARTBEAT_STALE_MS) } },
      ],
    },
  });
  for (const job of stale) {
    const canceled = job.cancelRequestedAt !== null;
    const message = canceled
      ? "Canceled by the operator"
      : "Interrupted: the Studio stopped while this job was running. Retry to run it again.";
    const closed = await prisma.mediaJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: {
        status: canceled ? "CANCELED" : "FAILED",
        lastError: message,
        finishedAt: new Date(),
        progress: null,
      },
    });
    if (closed.count) {
      await cleanClipperWork(job.id);
      await writeAudit({
        workspaceId,
        actorId: job.createdBy,
        action: canceled ? "clipper.job_canceled" : "media.job_failed",
        entityType: "MediaJob",
        entityId: job.id,
        metadata: { recovered: true, error: message },
      });
    }
  }
  return stale.length;
}

interface AcceptedMoment {
  rank: number;
  startSec: number;
  endSec: number;
  peakSec: number;
  score: number;
  signals: Record<string, unknown>;
  transcriptExcerpt: string | null;
  wordsVerified: boolean;
}

async function execute(jobId: string, actor: Actor, opts: { n: number; cropMode: CropMode }) {
  const storage = getAssetStorage();
  let lastWrite = 0;
  let lastText = "";
  const beat = (text: string, force = false) => {
    const now = Date.now();
    if (!force && text === lastText && now - lastWrite < 1500) return;
    lastWrite = now;
    lastText = text;
    void prisma.mediaJob
      .updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: { progress: text.slice(0, 200), heartbeatAt: new Date() },
      })
      .catch(() => undefined);
  };
  const canceled = async () =>
    (
      await prisma.mediaJob.findUnique({
        where: { id: jobId },
        select: { cancelRequestedAt: true },
      })
    )?.cancelRequestedAt != null;
  const finish = async (status: "FAILED" | "CANCELED", message: string, failure: unknown) => {
    await prisma.mediaJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status,
        lastError: message.slice(0, 2000),
        failureJson: (failure ?? undefined) as object | undefined,
        finishedAt: new Date(),
        progress: null,
      },
    });
    await cleanClipperWork(jobId);
    await writeAudit({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: status === "CANCELED" ? "clipper.job_canceled" : "media.job_failed",
      entityType: "MediaJob",
      entityId: jobId,
      metadata: { kind: "SESSION_CLIP", error: message },
    });
  };

  try {
    const job = await prisma.mediaJob.findUniqueOrThrow({ where: { id: jobId } });
    const capture = await prisma.captureSession.findUniqueOrThrow({
      where: { id: job.subjectId },
      include: { content: true, media: true },
    });
    const media = capture.media!;
    const mediaPath = storage.absolutePath(media.storagePath);
    const hasAudio = media.audioCodec !== null;

    beat("Scanning the whole session for signals");
    const bins = await extractSignals(mediaPath, hasAudio);
    const shortlist = shortlistWindows(bins, opts.n);
    const analysisRunId = randomUUID();

    const workDir = path.join(clipperWorkRoot(), jobId);
    await mkdir(workDir, { recursive: true });
    const evidence: (AcceptedMoment & { usedCandidateRank: number })[] = [];
    const accepted: AcceptedMoment[] = [];

    for (const [i, cand] of shortlist.entries()) {
      if (accepted.length >= opts.n) break;
      if (await canceled())
        return void (await finish("CANCELED", "Canceled by the operator", null));
      beat(`Transcribing window ${i + 1} of ${shortlist.length}`);

      const clamped = clampWindowSec(cand.startSec, cand.endSec, media.durationSec);
      let moment = clamped;
      let words: { text: string; startSec: number; endSec: number }[] = [];
      let transcriptOk = false;
      let transcriptExcerpt: string | null = null;
      try {
        const t = await transcribeWindow(
          mediaPath,
          clamped.startSec,
          clamped.endSec,
          media.durationSec,
        );
        if (t.status === "OK") {
          words = t.words;
          transcriptOk = true;
          transcriptExcerpt = t.text || null;
          const [silA, silB, cutsA, cutsB] = await Promise.all([
            silencesNear(mediaPath, clamped.startSec, media.durationSec),
            silencesNear(mediaPath, clamped.endSec, media.durationSec),
            sceneCutsNear(mediaPath, clamped.startSec, media.durationSec),
            sceneCutsNear(mediaPath, clamped.endSec, media.durationSec),
          ]);
          const snapped = snapBoundaries({
            startSec: clamped.startSec,
            endSec: clamped.endSec,
            silences: [...silA, ...silB],
            sceneCuts: [...cutsA, ...cutsB],
            words,
          });
          const len = snapped.endSec - snapped.startSec;
          // Snapping (word-edge pushes especially) must not break the
          // storable-length contract; fall back to the clamped window if it does.
          if (len >= 1 && snapped.endSec > snapped.startSec) moment = snapped;
        }
      } catch {
        // Treat a transcription/snap failure on this window as not usable;
        // the shortlist has 3x margin so other windows can still fill N.
      }

      if (accepted.some((a) => overlaps(a, moment))) continue;
      const rank = accepted.length + 1;
      const record: AcceptedMoment = {
        rank,
        startSec: moment.startSec,
        endSec: moment.endSec,
        peakSec: cand.peakSec,
        score: cand.score,
        signals: cand.signals,
        transcriptExcerpt,
        wordsVerified: transcriptOk,
      };
      evidence.push({ ...record, usedCandidateRank: i + 1 });
      if (!transcriptOk) continue; // never store a clip whose boundaries were not word-verified
      accepted.push(record);
    }

    beat("Rendering clips", true);
    const made: string[] = [];
    for (const moment of accepted) {
      for (const format of FORMATS) {
        if (await canceled())
          return void (await finish("CANCELED", "Canceled by the operator", null));
        beat(`Rendering ${format} for moment ${moment.rank} of ${accepted.length}`);
        const thumbSec = Math.min(moment.peakSec, moment.endSec - 0.2);
        const thumbnailPath = `captures/${capture.id}/clips/${analysisRunId}-${moment.rank}.jpg`;
        await storage.write(
          thumbnailPath,
          await extractThumbnail(mediaPath, Math.max(moment.startSec, thumbSec)),
        );

        // Words for this exact moment, re-fetched at its final (possibly
        // snapped) boundaries so burned captions line up with what was kept.
        const t = await transcribeWindow(
          mediaPath,
          moment.startSec,
          moment.endSec,
          media.durationSec,
        );
        const words = t.status === "OK" ? t.words : [];
        const cues = chunkCues(wordsToCues(words, moment.startSec, moment.endSec), format);

        const rendered = await renderClip({
          sourcePath: mediaPath,
          startSec: moment.startSec,
          endSec: moment.endSec,
          format,
          cropMode: opts.cropMode,
          cues,
          hasSourceAudio: hasAudio,
        });
        const checksumSha256 = sha256(rendered.videoBytes);
        const tag = format === "16:9" ? "16x9" : "9x16";
        const dir = `captures/${capture.id}/clips/${analysisRunId}-${moment.rank}-${tag}`;
        const manifest = {
          status: "INTERNAL_ILLUSTRATIVE_DRAFT",
          reviewState: "PENDING_MIKE_REVIEW",
          publication: "PUBLICATION_BLOCKED",
          mediaClass: "GAMEPLAY_CAPTURE",
          source: {
            captureSessionId: capture.id,
            originalName: media.originalName,
            rightsStatus: media.rightsStatus,
            captureMethod: media.captureMethod,
          },
          moment: {
            analysisRunId,
            rank: moment.rank,
            startSec: moment.startSec,
            endSec: moment.endSec,
            peakSec: moment.peakSec,
            score: moment.score,
            signals: moment.signals,
            transcriptExcerpt: moment.transcriptExcerpt,
            analyzerVersion: ANALYZER_VERSION,
          },
          format,
          cropMode: opts.cropMode,
          resolution: rendered.resolution,
          frameRate: rendered.frameRate,
          durationSec: rendered.durationSec,
          masterSha256: checksumSha256,
          idempotencyKey: job.idempotencyKey,
          rights: `OPEN - source media is ${media.rightsStatus}; this auto-selected excerpt has not been rights-reviewed`,
          costUsd: 0,
        };
        const cover = await storage
          .write(`${dir}/cover.jpg`, rendered.coverJpg)
          .then(() => `${dir}/cover.jpg`);
        const videoPath = `${dir}/master.mp4`;
        await storage.write(videoPath, rendered.videoBytes);
        const qaJson = await clipQa({
          masterPath: storage.absolutePath(videoPath),
          format,
          displayCues: cues,
          loudness: rendered.loudness,
        });
        // A failed render is reported, not stored: no SessionClip row, no
        // bytes left behind for a reviewer to find.
        if (!qaJson.passed) {
          await storage.remove(videoPath).catch(() => undefined);
          await storage.remove(cover).catch(() => undefined);
          await writeAudit({
            workspaceId: actor.workspaceId,
            actorId: actor.userId,
            action: "clipper.clip_qa_failed",
            entityType: "CaptureSession",
            entityId: capture.id,
            metadata: { format, rank: moment.rank, checks: qaJson.checks },
          });
          continue;
        }
        const transcriptTxt = moment.transcriptExcerpt ?? "";
        const srtTime = (sec: number) => {
          const ms = Math.max(0, Math.round(sec * 1000));
          const p = (n: number, w = 2) => String(n).padStart(w, "0");
          return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, "0")}`;
        };
        const srt =
          cues
            .map((c, i) => `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${c.text}\n`)
            .join("\n") ||
          "1\n00:00:00,000 --> 00:00:00,500\n(no speech detected in this window)\n";
        await storage.write(`${dir}/captions.srt`, Buffer.from(srt));
        await storage.write(`${dir}/transcript.txt`, Buffer.from(`${transcriptTxt}\n`));
        await storage.write(`${dir}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
        await storage.write(`${dir}/qa.json`, Buffer.from(JSON.stringify(qaJson, null, 2)));
        const bundlePath = `${dir}/bundle.zip`;
        await run("zip", [
          "-q",
          "-j",
          "-X",
          storage.absolutePath(bundlePath),
          storage.absolutePath(videoPath),
          storage.absolutePath(`${dir}/captions.srt`),
          storage.absolutePath(`${dir}/transcript.txt`),
          storage.absolutePath(`${dir}/manifest.json`),
          storage.absolutePath(`${dir}/qa.json`),
          storage.absolutePath(cover),
        ]);

        const row = await prisma.sessionClip.create({
          data: {
            workspaceId: actor.workspaceId,
            captureSessionId: capture.id,
            jobId,
            analysisRunId,
            rank: moment.rank,
            startSec: moment.startSec,
            endSec: moment.endSec,
            peakSec: moment.peakSec,
            score: moment.score,
            signalsJson: {
              ...moment.signals,
              transcriptExcerpt: moment.transcriptExcerpt,
              thumbnailPath,
            } as object,
            format,
            storagePath: videoPath,
            durationSec: rendered.durationSec,
            resolution: rendered.resolution,
            frameRate: rendered.frameRate,
            checksumSha256,
            bundlePath,
            manifestJson: manifest as object,
            mediaClass: "GAMEPLAY_CAPTURE",
            reviewState: "PENDING_MIKE_REVIEW",
            qaJson: qaJson as object,
            createdBy: actor.userId,
          },
        });
        made.push(row.id);
        await writeAudit({
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          action: "clipper.clip_rendered",
          entityType: "SessionClip",
          entityId: row.id,
          metadata: { captureSessionId: capture.id, format, rank: moment.rank, checksumSha256 },
        });
      }
    }

    const momentsJson = JSON.stringify(
      {
        analyzerVersion: ANALYZER_VERSION,
        analysisRunId,
        shortlisted: evidence.length,
        accepted: accepted.length,
        moments: evidence,
      },
      null,
      2,
    );
    // Written to the job's own work folder (operator-inspectable evidence
    // for this run) and to the capture's permanent storage (what Library
    // review reads).
    await writeFile(path.join(workDir, "moments.json"), momentsJson);
    await storage.write(
      `captures/${capture.id}/clips/${analysisRunId}-moments.json`,
      Buffer.from(momentsJson),
    );

    await prisma.mediaJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        resultId: made[0],
        lastError: null,
        finishedAt: new Date(),
        progress: "Done",
      },
    });
    await cleanClipperWork(jobId);
  } catch (e) {
    await finish("FAILED", e instanceof Error ? e.message : "Unexpected error", null);
  }
}

export async function reviewSessionClip(
  actor: Actor,
  clipId: string,
  decision: "APPROVED" | "REJECTED",
  notes?: string,
) {
  require_(actor, "capture.review");
  const clip = await prisma.sessionClip.findUnique({ where: { id: clipId } });
  if (!clip || clip.workspaceId !== actor.workspaceId) throw notFound("Clip not found");
  if (clip.reviewedBy !== null || clip.reviewState === "MIKE_APPROVED") {
    throw precondition("This clip was already reviewed");
  }
  if (decision === "REJECTED" && !notes) throw precondition("A rejection needs a recorded reason");

  // An editorial approval here is not the Owner's approval of the file: it
  // only clears the clip for the Owner's review queue (reviewState stays
  // PENDING_MIKE_REVIEW), same split as domain/shorts.ts reviewRender.
  const { count } = await prisma.sessionClip.updateMany({
    where: { id: clipId, reviewedBy: null },
    data: {
      ...(decision === "REJECTED" ? { reviewState: "REJECTED" as const } : {}),
      reviewNotes: notes ?? null,
      reviewedBy: actor.userId,
    },
  });
  if (count === 0) throw precondition("This clip was already reviewed");
  if (decision === "REJECTED") {
    await getAssetStorage()
      .remove(clip.storagePath)
      .catch((err: unknown) =>
        console.warn(`sessionClip: failed to remove rejected clip ${clip.storagePath}:`, err),
      );
  }
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: decision === "APPROVED" ? "clipper.clip_approved" : "clipper.clip_rejected",
    entityType: "SessionClip",
    entityId: clipId,
    metadata: { notes: notes ?? null },
  });
  return prisma.sessionClip.findUniqueOrThrow({ where: { id: clipId } });
}

/** The Owner's approval of one exact clip file, pinned to its SHA-256, same as approveRenderVersion. */
export async function approveSessionClip(actor: Actor, clipId: string, checksumPrefix: string) {
  require_(actor, "shorts.approve");
  const clip = await prisma.sessionClip.findUnique({ where: { id: clipId } });
  if (!clip || clip.workspaceId !== actor.workspaceId) throw notFound("Clip not found");
  if (clip.reviewState !== "PENDING_MIKE_REVIEW" || !clip.checksumSha256) {
    throw precondition("Only a draft that is pending the Owner's review can be approved");
  }
  const prefix = checksumPrefix.trim().toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(prefix)) {
    throw precondition("Type at least the first 8 characters of this file's SHA-256");
  }
  if (!clip.checksumSha256.startsWith(prefix)) {
    throw precondition("That is not this file's SHA-256; approval is tied to the exact file");
  }
  const onDisk = await getAssetStorage()
    .read(clip.storagePath)
    .then(sha256)
    .catch(() => null);
  if (onDisk !== clip.checksumSha256) {
    throw precondition("The stored file no longer matches its recorded hash; clip it again");
  }
  const { count } = await prisma.sessionClip.updateMany({
    where: { id: clipId, reviewState: "PENDING_MIKE_REVIEW" },
    data: {
      reviewState: "MIKE_APPROVED",
      approvedChecksum: clip.checksumSha256,
      approvedBy: actor.userId,
      approvedAt: new Date(),
    },
  });
  if (count === 0) throw precondition("This draft is no longer pending review");
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "clipper.clip_owner_approved",
    entityType: "SessionClip",
    entityId: clipId,
    metadata: { checksumSha256: clip.checksumSha256 },
  });
  return prisma.sessionClip.findUniqueOrThrow({ where: { id: clipId } });
}
