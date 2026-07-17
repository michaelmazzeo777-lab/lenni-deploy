import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getAssetStorage } from "@/lib/storage/local-provider";
import {
  getShortsScriptProvider,
  getTTSProvider,
  getVideoCompositorProvider,
  getYouTubePublisher,
} from "@/lib/shorts";
import { AIValidationStatus, QuarantineStatus, PublicationStatus } from "@prisma/client";

// YouTube Shorts pipeline (docs/YOUTUBE_SHORTS_PIPELINE_BLUEPRINT.md).
// Every stage is gated:
//   draft    — only from an APPROVED, shorts-targeted, non-leaked capture
//   voiceover— only from a VALID (not quarantined/failed) script
//   render   — lands PENDING; a human must approve it (CLEAN) or reject it
//   publish  — Owner-only; render must be CLEAN; disclosure flags always sent
// All providers are deterministic mocks until real credentials are configured.

const DURATION_CEILING_SEC = 60;

async function loadCapture(actor: Actor, captureSessionId: string) {
  const capture = await prisma.captureSession.findUnique({
    where: { id: captureSessionId },
    include: { content: true },
  });
  if (!capture || capture.content.workspaceId !== actor.workspaceId) {
    throw notFound("Capture session not found");
  }
  return capture;
}

export async function draftShortsScript(actor: Actor, captureSessionId: string) {
  require_(actor, "ai.generate");
  const capture = await loadCapture(actor, captureSessionId);

  if (capture.flagLeaked) throw precondition("Leaked-flagged footage can never enter the pipeline");
  if (capture.status !== "APPROVED") {
    throw precondition("Only an APPROVED capture can be used for a Short");
  }
  if (!capture.targetsShorts) {
    throw precondition("This capture is not marked for Shorts use");
  }
  if (!capture.fileReference) {
    throw precondition("Capture has no file reference to analyze");
  }

  const provider = getShortsScriptProvider();
  const result = await provider.analyzeAndDraft({
    videoReference: capture.fileReference,
    durationCeilingSec: DURATION_CEILING_SEC,
  });

  // Any positive safety flag quarantines the script for human review — the
  // pipeline never silently auto-filters or auto-passes flagged content.
  const status =
    result.safetyFlags.length > 0 ? AIValidationStatus.QUARANTINED : AIValidationStatus.VALID;

  const script = await prisma.shortsScript.create({
    data: {
      workspaceId: actor.workspaceId,
      captureSessionId,
      provider: provider.name,
      model: result.model,
      hookText: result.script.hookText,
      sectionsJson: result.script.sections as unknown as object,
      highlightsJson: result.detectedHighlights as unknown as object,
      safetyFlagsJson: result.safetyFlags as unknown as object,
      status,
      createdBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: status === "QUARANTINED" ? "shorts.script_quarantined" : "shorts.script_drafted",
    entityType: "ShortsScript",
    entityId: script.id,
    metadata: { captureSessionId, provider: provider.name, safetyFlags: result.safetyFlags.length },
  });
  return script;
}

export async function synthesizeVoiceover(actor: Actor, scriptId: string, voiceProfileId: string) {
  require_(actor, "ai.generate");
  const script = await prisma.shortsScript.findUnique({ where: { id: scriptId } });
  if (!script || script.workspaceId !== actor.workspaceId) throw notFound("Script not found");
  if (script.status !== "VALID") {
    throw precondition(
      "Voiceover requires a VALID script (quarantined/failed scripts are blocked)",
    );
  }
  // The @unique(scriptId) constraint is the real duplicate guard (this
  // pre-check just gives a friendlier message; a concurrent duplicate is
  // converted from a raw P2002 below).
  const existing = await prisma.shortsVoiceover.findUnique({ where: { scriptId } });
  if (existing) throw precondition("A voiceover already exists for this script");

  const sections = script.sectionsJson as { text: string }[];
  const scriptText = [script.hookText, ...sections.map((s) => s.text)].join(" ");

  const provider = getTTSProvider();
  const result = await provider.synthesize({ scriptText, voiceProfileId });

  const storage = getAssetStorage();
  const assetPath = `shorts/voiceover/${scriptId}.wav`;
  await storage.write(assetPath, result.audioBytes);

  const voiceover = await prisma.shortsVoiceover
    .create({
      data: {
        workspaceId: actor.workspaceId,
        scriptId,
        provider: provider.name,
        voiceProfileId,
        assetPath,
        durationSec: result.durationSec,
        duckingJson: result.duckingCurve as unknown as object,
        createdBy: actor.userId,
      },
    })
    .catch((e: unknown) => {
      // Concurrent duplicate lost the unique(scriptId) race.
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw precondition("A voiceover already exists for this script");
      }
      throw e;
    });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "shorts.voiceover_synthesized",
    entityType: "ShortsVoiceover",
    entityId: voiceover.id,
    metadata: { scriptId, provider: provider.name, durationSec: result.durationSec },
  });
  return voiceover;
}

export async function renderShort(actor: Actor, voiceoverId: string, attributionText: string) {
  require_(actor, "ai.generate");
  const voiceover = await prisma.shortsVoiceover.findUnique({
    where: { id: voiceoverId },
    include: { script: { include: { captureSession: true } } },
  });
  if (!voiceover || voiceover.workspaceId !== actor.workspaceId) {
    throw notFound("Voiceover not found");
  }

  const provider = getVideoCompositorProvider();
  const result = await provider.render({
    sourceVideoReference: voiceover.script.captureSession.fileReference ?? "",
    voiceoverAssetPath: voiceover.assetPath,
    attributionText,
  });

  const storage = getAssetStorage();
  const storagePath = `shorts/render/${voiceoverId}-${Date.now()}.mp4`;
  await storage.write(storagePath, result.videoBytes);

  const render = await prisma.shortsRender.create({
    data: {
      workspaceId: actor.workspaceId,
      scriptId: voiceover.scriptId,
      voiceoverId,
      storagePath,
      durationSec: result.durationSec,
      resolution: result.resolution,
      frameRate: result.frameRate,
      renderCostUsd: result.renderCostUsd,
      status: QuarantineStatus.PENDING,
      createdBy: actor.userId,
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "shorts.rendered",
    entityType: "ShortsRender",
    entityId: render.id,
    metadata: { voiceoverId, provider: provider.name, costUsd: result.renderCostUsd },
  });
  return render;
}

// Human quality gate (blueprint Module 5). Reuses capture.review authority
// (Owner/Editor) — the same people who review raw captures review renders.
export async function reviewRender(
  actor: Actor,
  renderId: string,
  decision: "APPROVED" | "REJECTED",
  notes?: string,
) {
  require_(actor, "capture.review");
  const render = await prisma.shortsRender.findUnique({ where: { id: renderId } });
  if (!render || render.workspaceId !== actor.workspaceId) throw notFound("Render not found");
  if (render.status !== "PENDING") throw precondition("This render was already reviewed");
  if (decision === "REJECTED" && !notes) {
    throw precondition("A rejection needs a recorded reason");
  }

  // Atomic status guard: the WHERE includes PENDING so two concurrent
  // reviewers cannot both win — the loser matches zero rows.
  const { count } = await prisma.shortsRender.updateMany({
    where: { id: renderId, status: QuarantineStatus.PENDING },
    data: {
      status: decision === "APPROVED" ? QuarantineStatus.CLEAN : QuarantineStatus.REJECTED,
      reviewNotes: notes ?? null,
      reviewedBy: actor.userId,
    },
  });
  if (count === 0) throw precondition("This render was already reviewed");
  const updated = await prisma.shortsRender.findUniqueOrThrow({ where: { id: renderId } });

  // Reject & purge (blueprint Module 5): a rejected render's bytes are
  // removed from storage (the DB record stays for the audit trail). Failure
  // is non-fatal but must be visible — silent failure leaks disk.
  if (decision === "REJECTED") {
    await getAssetStorage()
      .remove(render.storagePath)
      .catch((err: unknown) => {
        console.warn(`shorts: failed to remove rejected render ${render.storagePath}:`, err);
      });
  }
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: decision === "APPROVED" ? "shorts.render_approved" : "shorts.render_rejected",
    entityType: "ShortsRender",
    entityId: renderId,
    metadata: { notes: notes ?? null },
  });
  return updated;
}

// YouTube Data API metadata limits (title 100 chars, description 5000 bytes,
// tags 500 chars total) validated up front so a real provider can never be
// called with a payload the platform would reject.
const publishSchema = z.object({
  renderId: z.string().min(1),
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(3).max(5000),
  tags: z
    .array(z.string().trim().min(1).max(100))
    .max(30)
    .default([])
    .refine((tags) => tags.join(",").length <= 500, "Tags exceed 500 characters total"),
});

export type PublishShortInput = z.input<typeof publishSchema>;

export async function publishShort(actor: Actor, raw: PublishShortInput) {
  require_(actor, "shorts.publish");
  const input = publishSchema.parse(raw);
  const render = await prisma.shortsRender.findUnique({
    where: { id: input.renderId },
    include: { script: true, publication: true },
  });
  if (!render || render.workspaceId !== actor.workspaceId) throw notFound("Render not found");
  if (render.status !== "CLEAN") {
    throw precondition("Only a human-approved (CLEAN) render may be published");
  }
  if (render.publication) {
    throw precondition(
      render.publication.status === "PUBLISHED"
        ? "This render is already published"
        : "A publish attempt for this render is already in progress",
    );
  }

  // Synthetic-content disclosure is always sent — the voiceover is synthesized
  // and the composition is automated (blueprint compliance requirement).
  const disclosureFlags = { alteredOrSynthetic: true, syntheticVoiceover: true };

  // Resolve the publisher BEFORE creating the claim: a configuration error
  // (non-mock provider without credentials) must fail without touching the DB.
  const publisher = getYouTubePublisher();

  // Idempotency claim BEFORE the external call: the unique(renderId) DRAFT row
  // is the lock. Two concurrent publishes race on this create; the loser gets
  // P2002 and no second external upload can ever happen. On external failure
  // the claim is released so a retry is possible.
  const claim = await prisma.youTubePublication
    .create({
      data: {
        workspaceId: actor.workspaceId,
        renderId: input.renderId,
        title: input.title,
        description: input.description,
        tags: input.tags,
        disclosureJson: disclosureFlags,
        status: PublicationStatus.DRAFT,
      },
    })
    .catch((e: unknown) => {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw precondition("A publish attempt for this render is already in progress");
      }
      throw e;
    });

  let result: { youtubeVideoId: string };
  try {
    result = await publisher.publish({
      videoAssetPath: render.storagePath,
      title: input.title,
      description: input.description,
      tags: input.tags,
      disclosureFlags,
    });
  } catch (e) {
    await prisma.youTubePublication.delete({ where: { id: claim.id } }).catch(() => {
      console.warn(`shorts: failed to release publish claim ${claim.id}`);
    });
    throw e;
  }

  const publication = await prisma.youTubePublication.update({
    where: { id: claim.id },
    data: {
      youtubeVideoId: result.youtubeVideoId,
      status: PublicationStatus.PUBLISHED,
      publishedBy: actor.userId,
      publishedAt: new Date(),
    },
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "shorts.published",
    entityType: "YouTubePublication",
    entityId: publication.id,
    metadata: {
      renderId: input.renderId,
      publisher: publisher.name,
      youtubeVideoId: result.youtubeVideoId,
      disclosureFlags,
    },
  });
  return publication;
}
