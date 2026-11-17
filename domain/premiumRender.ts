// Premium renders: both formats (16:9 and native 9:16) of an explainer, made by
// the vendored premium engine. Unlike the title-card compositor these take
// minutes, so they run in the background as a durable job the operator can
// watch, cancel and retry. The request only starts the job.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getAssetStorage } from "@/lib/storage/local-provider";
import { run, probeVideo } from "@/lib/media/ffmpeg";
import { cardProblems, type CardSpec } from "@/lib/media/cards";
import type { CaptionCue } from "@/lib/shorts";
import { assertClaimsCurrent, loadVoiceover } from "@/domain/shorts";
import { buildEpisode, PREMIUM_ART_FILES, PREMIUM_ENGINE_VERSION } from "@/lib/premium/episode";
import {
  cleanWork,
  EngineFailure,
  ENGINE_DIR,
  engineFingerprint,
  engineProblems,
  runEngine,
  workRoot,
} from "@/lib/premium/engine";
import { claimHeavySlot, HEAVY_STALE_MS, staleBefore, startHeartbeat } from "@/lib/jobs/heavy";
import { QuarantineStatus, type MediaJob } from "@prisma/client";

export const PREMIUM_LABEL = "Premium render (16:9 + 9:16)";
/** A running job whose process has not reported for this long has lost its process. */
export const HEARTBEAT_STALE_MS = HEAVY_STALE_MS;

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
type Loaded = NonNullable<Awaited<ReturnType<typeof loadVoiceover>>>;

function linesOf(v: Loaded): string[] {
  const sections = v.script.sectionsJson as { text: string }[];
  return [v.script.hookText, ...sections.map((s) => s.text)];
}

/** Every gate, checked when the job is requested and again when it runs. */
async function assertRenderable(v: Loaded) {
  const capture = v.script.captureSession;
  if (capture.kind !== "GRAPHICS") {
    throw precondition(
      "Premium renders are for explainers (original graphics); footage uses the standard render",
    );
  }
  if (capture.flagLeaked) throw precondition("This session is flagged as leaked material");
  if (v.provider === "mock")
    throw precondition("A premium render needs a real narration; the mock voiceover is silent");
  const cards = (v.script.cardsJson as CardSpec[] | null) ?? [];
  const cues = (v.cuesJson as CaptionCue[] | null) ?? [];
  const lines = linesOf(v);
  if (cards.length !== lines.length || cues.length !== lines.length) {
    throw precondition("This explainer's title cards do not match its narration lines");
  }
  const problems = cards.flatMap((c, i) => cardProblems(c, i));
  if (problems.length) throw precondition(problems.join("; "));
  await assertClaimsCurrent(capture.contentId, true);
  return { cards, cues, lines, capture };
}

function keyFor(v: Loaded): string {
  return sha256(
    JSON.stringify({
      v: 1,
      voiceoverId: v.id,
      voice: [v.assetPath, v.durationSec, v.cuesJson],
      cards: v.script.cardsJson ?? null,
      lines: linesOf(v),
      engine: [PREMIUM_ENGINE_VERSION, engineFingerprint()],
    }),
  );
}

const liveRenders = (voiceoverId: string, key: string) =>
  prisma.shortsRender.findMany({
    where: { voiceoverId, idempotencyKey: key, status: { not: "REJECTED" } },
    orderBy: { format: "asc" },
  });

/**
 * Starts (or retries) the premium render of a narrated explainer and returns
 * at once. Same inputs = same job: a finished job is returned as it is, a
 * running one is refused, a failed or canceled one runs again.
 */
export async function startPremiumRender(actor: Actor, voiceoverId: string): Promise<MediaJob> {
  require_(actor, "ai.generate");
  const v = await loadVoiceover(voiceoverId);
  if (!v || v.workspaceId !== actor.workspaceId) throw notFound("Voiceover not found");
  await assertRenderable(v);
  const problems = engineProblems();
  if (problems.length)
    throw precondition(`The premium engine is not ready: ${problems.join("; ")}`);
  await recoverInterruptedJobs(actor.workspaceId);

  const idempotencyKey = keyFor(v);
  const where = {
    workspaceId_kind_idempotencyKey: {
      workspaceId: actor.workspaceId,
      kind: "PREMIUM_RENDER" as const,
      idempotencyKey,
    },
  };
  const job =
    (await prisma.mediaJob.findUnique({ where })) ??
    (await prisma.mediaJob
      .create({
        data: {
          workspaceId: actor.workspaceId,
          kind: "PREMIUM_RENDER",
          idempotencyKey,
          subjectId: voiceoverId,
          label: PREMIUM_LABEL,
          createdBy: actor.userId,
        },
      })
      .catch(async (e: unknown) => {
        if ((e as { code?: string }).code === "P2002")
          return prisma.mediaJob.findUniqueOrThrow({ where });
        throw e;
      }));
  if (job.status === "SUCCEEDED" && (await liveRenders(voiceoverId, idempotencyKey)).length === 2)
    return job;

  // Atomic claim: only one request can move the row to RUNNING, and only
  // while no other heavy media job holds the machine. A background start
  // refuses rather than waits: the operator can start it again afterwards.
  const claim = await claimHeavySlot(
    job.id,
    { status: { in: ["QUEUED", "FAILED", "CANCELED", "SUCCEEDED"] } },
    {
      startedAt: new Date(),
      finishedAt: null,
      cancelRequestedAt: null,
      pid: null,
      progress: "Starting",
      lastError: null,
      attempts: { increment: 1 },
    },
  );
  if (!claim.ok && claim.reason === "busy")
    throw precondition(
      `Another media job is running ("${claim.holder}"); start the premium render when it finishes`,
    );
  if (!claim.ok)
    throw precondition(
      "This premium render is already running; cancel it or wait for it to finish",
    );
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "premium.job_started",
    entityType: "MediaJob",
    entityId: job.id,
    metadata: { voiceoverId, attempt: claim.attempt },
  });
  // Deliberately not awaited: the job outlives the request. Its state is in the database.
  void execute(job.id, actor, claim.attempt).catch(() => undefined);
  return prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
}

/** Asks a running job to stop. The runner kills the engine's process group within about two seconds. */
export async function cancelPremiumRender(actor: Actor, jobId: string): Promise<MediaJob> {
  require_(actor, "ai.generate");
  const job = await prisma.mediaJob.findUnique({ where: { id: jobId } });
  if (!job || job.workspaceId !== actor.workspaceId || job.kind !== "PREMIUM_RENDER")
    throw notFound("Job not found");
  if (job.status !== "RUNNING") throw precondition("Only a running job can be canceled");
  await prisma.mediaJob.update({
    where: { id: jobId },
    data: { cancelRequestedAt: new Date(), progress: "Cancel requested" },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "premium.job_cancel_requested",
    entityType: "MediaJob",
    entityId: jobId,
    metadata: {},
  });
  await recoverInterruptedJobs(actor.workspaceId); // a job with no live process is closed right away
  return prisma.mediaJob.findUniqueOrThrow({ where: { id: jobId } });
}

/**
 * Restart recovery. A RUNNING job whose process stopped reporting (the Studio
 * was restarted or crashed) is closed as FAILED - or CANCELED if a cancel was
 * pending - so the operator can retry it. Any engine process left behind is killed.
 */
export async function recoverInterruptedJobs(workspaceId: string): Promise<number> {
  const stale = await prisma.mediaJob.findMany({
    where: {
      workspaceId,
      kind: "PREMIUM_RENDER",
      status: "RUNNING",
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore() } }],
    },
  });
  for (const job of stale) {
    if (job.pid) killIfOurs(job.pid, job.id);
    const canceled = job.cancelRequestedAt !== null;
    const message = canceled
      ? "Canceled by the operator"
      : "Interrupted: the Studio stopped while this job was running. Retry to run it again.";
    // Closes only the attempt that was found stale, and only if it is still
    // stale now - a runner that beat in the meantime keeps its job.
    const closed = await prisma.mediaJob.updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        attempts: job.attempts,
        OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore() } }],
      },
      data: {
        status: canceled ? "CANCELED" : "FAILED",
        lastError: message,
        finishedAt: new Date(),
        pid: null,
        progress: null,
      },
    });
    if (closed.count) {
      await cleanWork(job.id);
      await writeAudit({
        workspaceId,
        actorId: job.createdBy,
        action: canceled ? "premium.job_canceled" : "media.job_failed",
        entityType: "MediaJob",
        entityId: job.id,
        metadata: { recovered: true, error: message },
      });
    }
  }
  return stale.length;
}

/** Kills a leftover engine process group, but only if it really is this job's engine. */
function killIfOurs(pid: number, jobId: string) {
  try {
    const cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    if (cmd.includes(path.join(workRoot(), jobId))) process.kill(-pid, "SIGKILL");
  } catch {
    /* no such process */
  }
}

async function execute(jobId: string, actor: Actor, attempt: number) {
  const storage = getAssetStorage();
  // This runner owns attempt `attempt` only; every write below is fenced by it.
  const mine = { id: jobId, status: "RUNNING" as const, attempts: attempt };
  const stopHeartbeat = startHeartbeat(jobId, attempt);
  let lastWrite = 0;
  let lastText = "";
  const beat = (text: string, force = false) => {
    const now = Date.now();
    if (!force && text === lastText && now - lastWrite < 5000) return;
    if (!force && now - lastWrite < 1500) return;
    lastWrite = now;
    lastText = text;
    void prisma.mediaJob
      .updateMany({
        where: mine,
        data: { progress: text.slice(0, 200), heartbeatAt: new Date() },
      })
      .catch(() => undefined);
  };
  const finish = async (status: "FAILED" | "CANCELED", message: string, failure: unknown) => {
    await prisma.mediaJob.updateMany({
      where: mine,
      data: {
        status,
        lastError: message.slice(0, 2000),
        failureJson: (failure ?? undefined) as object | undefined,
        finishedAt: new Date(),
        pid: null,
        progress: null,
      },
    });
    await cleanWork(jobId);
    await writeAudit({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: status === "CANCELED" ? "premium.job_canceled" : "media.job_failed",
      entityType: "MediaJob",
      entityId: jobId,
      metadata: { kind: "PREMIUM_RENDER", error: message },
    });
  };
  try {
    const job = await prisma.mediaJob.findUniqueOrThrow({ where: { id: jobId } });
    const v = await loadVoiceover(job.subjectId);
    if (!v) throw precondition("The narration no longer exists");
    const { cards, cues, lines, capture } = await assertRenderable(v); // gates re-checked at run time
    const content = await prisma.contentItem.findUniqueOrThrow({
      where: { id: capture.contentId },
    });
    const links = await prisma.contentClaim.findMany({
      where: { contentId: capture.contentId },
      include: { claim: { include: { sources: { include: { source: true } } } } },
    });
    const voicePath = storage.absolutePath(v.assetPath); // confined to the storage root
    const synthetic = v.isSynthetic || v.provider === "local-say-fixture";
    const episode = buildEpisode({
      id: `studio-${capture.contentId}`,
      title: content.workingTitle,
      factsAsOf: new Date().toISOString().slice(0, 10),
      lines,
      cards,
      claimIds: links.map((l) => l.claimId),
      assetsDir: path.join(ENGINE_DIR, "assets"),
      soundBed: path.join(ENGINE_DIR, "assets/sound-bed.wav"),
    });
    const result = await runEngine({
      jobId,
      episode,
      voicePath,
      voiceKind: synthetic ? "synthetic" : "human",
      voiceNote: `${v.voiceName ?? v.provider}${v.voiceLicenseNote ? ` - ${v.voiceLicenseNote}` : ""}`,
      lineTimes: cues.map((c) => [c.startSec, c.endSec]),
      onStart: (pid) =>
        prisma.mediaJob.update({ where: { id: jobId }, data: { pid } }).then(() => undefined),
      onProgress: (t) => beat(t),
      shouldCancel: async () =>
        (
          await prisma.mediaJob.findUnique({
            where: { id: jobId },
            select: { cancelRequestedAt: true },
          })
        )?.cancelRequestedAt != null,
    });

    beat("Storing the finished files", true);
    const now = new Date().toISOString();
    const made: string[] = [];
    for (const format of ["16:9", "9:16"] as const) {
      const tag = format === "16:9" ? "16x9" : "9x16";
      const bytes = await readFile(result.masters[format]);
      const checksumSha256 = sha256(bytes);
      const probe = await probeVideo(result.masters[format]);
      const want = format === "16:9" ? [1920, 1080] : [1080, 1920];
      if (probe.width !== want[0] || probe.height !== want[1] || !probe.audioCodec) {
        throw new EngineFailure(
          `The ${format} file is ${probe.width}x${probe.height}${probe.audioCodec ? "" : " with no audio"}`,
          "qa",
          "",
        );
      }
      const mine = (c: { check: string }) =>
        !/^(16x9|9x16) /.test(c.check) || c.check.startsWith(`${tag} `);
      const checks = result.acceptance.checks.filter(mine).map((c) => ({
        name: c.check.replace(/^(16x9|9x16) /, ""),
        status: c.status === "UNRUN" ? "NOT_VERIFIED" : c.status,
        detail: c.detail,
      }));
      const file = result.acceptance.files[tag]!;
      const qaRecord = {
        passed: true,
        verified: checks.every(
          (c) => c.status === "PASS" || c.name === "human listening and viewing",
        ),
        checks: checks.filter((c) => c.name !== "human listening and viewing"),
        measurements: {
          loudness: {
            integratedLufs: file.loudness.integrated_lufs,
            truePeakDb: file.loudness.true_peak_dbtp,
          },
        },
        humanValidation: [
          "Listen to the narration: voice quality, pronunciation and pacing",
          "Watch the whole video in this format",
          "Editorial accuracy and tone against the cited sources",
        ],
        stateHistory: [
          { state: "RENDERED", at: now },
          { state: "QA_CHECKED", at: now },
          { state: "PENDING_MIKE_REVIEW", at: now },
        ],
      };
      const manifest = {
        status: "INTERNAL_ILLUSTRATIVE_DRAFT",
        reviewState: "PENDING_MIKE_REVIEW",
        publication: "PUBLICATION_BLOCKED",
        mediaClass: "ILLUSTRATIVE_DRAFT",
        renderer: "premium-engine",
        engine: { version: PREMIUM_ENGINE_VERSION, fingerprint: engineFingerprint() },
        burnedLabel: `ORIGINAL ART · NOT GAMEPLAY · ${synthetic ? "SYNTHETIC VOICE" : "RECORDED VOICE"}`,
        format,
        resolution: `${probe.width}x${probe.height}`,
        frameRate: 30,
        durationSec: probe.durationSec,
        masterSha256: checksumSha256,
        idempotencyKey: job.idempotencyKey,
        narration: {
          isFixture: v.isFixture,
          isSynthetic: synthetic,
          voiceName: v.voiceName,
          voiceLicenseNote: v.voiceLicenseNote,
          provider: v.provider,
        },
        episode,
        captions: result.cues,
        evidence: links.map((l) => ({
          claimId: l.claimId,
          statement: l.claim.statement,
          classification: l.claim.classification,
          status: l.claim.status,
          sources: l.claim.sources.map((s) => ({
            title: s.source.title,
            publisher: s.source.publisher,
            url: s.source.url,
            factualAsOf: s.source.factualAsOfDate,
          })),
        })),
        assets: [
          ...PREMIUM_ART_FILES.map((f) => ({
            file: f,
            role: "background art",
            origin: "Stated: OpenAI image generation (Motion V2 package)",
            rights: "OPEN - provenance unproven; not cleared for publication",
          })),
          {
            file: "sound-bed.wav",
            role: "sound bed",
            origin: "Stated: original voice-free ambient audio",
            rights: "OPEN - origin is a statement only",
          },
          {
            file: "Ubuntu typeface",
            role: "all text",
            origin: "Ubuntu Font Family",
            rights: "Ubuntu Font Licence 1.0 (not a legal review)",
          },
          {
            file: v.assetPath,
            role: "narration",
            origin: v.voiceName ?? v.provider,
            rights: v.voiceLicenseNote ?? "OPEN - not reviewed",
          },
        ],
        costUsd: 0,
      };
      const dir = `shorts/render/${v.id}-premium-${tag}-${Date.now()}`;
      const cover = path.join(result.runDir, `cover-${tag}.jpg`);
      await run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-ss",
        String(Math.min(2, probe.durationSec / 2)),
        "-i",
        result.masters[format],
        "-frames:v",
        "1",
        "-q:v",
        "3",
        cover,
      ]);
      const files: [string, Buffer][] = [
        ["master.mp4", bytes],
        ["captions.srt", Buffer.from(result.srt)],
        ["transcript.txt", Buffer.from(`${lines.join("\n")}\n`)],
        ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2))],
        ["qa.json", Buffer.from(JSON.stringify(qaRecord, null, 2))],
        ["contact.jpg", await readFile(path.join(result.runDir, "checks", `contact-${tag}.jpg`))],
        ["cover.jpg", await readFile(cover)],
      ];
      for (const [name, b] of files) await storage.write(`${dir}/${name}`, b);
      const bundlePath = `${dir}/bundle.zip`;
      await run("zip", [
        "-q",
        "-j",
        "-X",
        storage.absolutePath(bundlePath),
        ...files.map(([n]) => storage.absolutePath(`${dir}/${n}`)),
      ]);
      const render = await prisma.shortsRender.create({
        data: {
          workspaceId: actor.workspaceId,
          scriptId: v.scriptId,
          voiceoverId: v.id,
          storagePath: `${dir}/master.mp4`,
          durationSec: Math.round(probe.durationSec * 100) / 100,
          resolution: `${probe.width}x${probe.height}`,
          frameRate: 30,
          renderCostUsd: 0,
          format,
          isFixture: v.isFixture,
          checksumSha256,
          bundlePath,
          manifestJson: manifest as object,
          mediaClass: "ILLUSTRATIVE_DRAFT",
          reviewState: "PENDING_MIKE_REVIEW",
          qaJson: qaRecord as object,
          idempotencyKey: job.idempotencyKey,
          status: QuarantineStatus.PENDING,
          createdBy: actor.userId,
        },
      });
      made.push(render.id);
      await writeAudit({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "shorts.rendered",
        entityType: "ShortsRender",
        entityId: render.id,
        metadata: {
          voiceoverId: v.id,
          provider: "premium-engine",
          format,
          checksumSha256,
          costUsd: 0,
        },
      });
    }
    await prisma.mediaJob.updateMany({
      where: mine,
      data: {
        status: "SUCCEEDED",
        resultId: made[0],
        lastError: null,
        finishedAt: new Date(),
        pid: null,
        progress: "Done",
      },
    });
    await cleanWork(jobId);
  } catch (e) {
    if (e instanceof EngineFailure) {
      await finish(e.kind === "canceled" ? "CANCELED" : "FAILED", e.message, {
        kind: e.kind,
        log: e.log.slice(-3000),
      });
    } else {
      await finish("FAILED", e instanceof Error ? e.message : "Unexpected error", null);
    }
  } finally {
    stopHeartbeat();
  }
}
