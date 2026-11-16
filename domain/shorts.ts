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
import { createHash } from "node:crypto";
import { run, probeVideo, meanVolumeDb } from "@/lib/media/ffmpeg";
import {
  CaptionError,
  SHORTS_RIGHTS_SENSITIVE_SEC,
  durationCeilingSec,
  validateCaptionContract,
} from "@/lib/media/captions";
import type { CaptionCue, RenderFormat } from "@/lib/shorts";
import { toCanonicalRecord, blocksProduction } from "@/domain/canonicalTaxonomy";

// YouTube Shorts pipeline (docs/YOUTUBE_SHORTS_PIPELINE_BLUEPRINT.md).
// Every stage is gated:
//   draft    — only from an APPROVED, shorts-targeted, non-leaked capture
//   voiceover— only from a VALID (not quarantined/failed) script
//   render   — lands PENDING; a human must approve it (CLEAN) or reject it
//   publish  — Owner-only; render must be CLEAN; disclosure flags always sent
// Providers default to deterministic mocks. With the local-* providers the
// same gates apply, plus: real ingested media with cleared rights, an APPROVED
// highlight cut, an audible narration, and a fixture taint that blocks publish.

const FIXTURE_LABEL = "INTERNAL TECHNICAL FIXTURE - NOT GAMEPLAY - NOT FOR PUBLICATION";

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

// Stale-fact gate: a real (local) Short cannot be scripted or rendered while
// its content item relies on a claim that is stale, contradicted, retired or
// quarantined under the canonical taxonomy. Refresh the source first.
async function assertClaimsCurrent(contentId: string) {
  const links = await prisma.contentClaim.findMany({
    where: { contentId },
    include: { claim: { include: { sources: { include: { source: true } } } } },
  });
  const blocked = links.filter((l) => blocksProduction(toCanonicalRecord(l.claim)));
  if (blocked.length > 0) {
    throw precondition(
      `${blocked.length} linked claim(s) are stale, contradicted or quarantined; refresh sources before production`,
    );
  }
}

export interface DraftOptions {
  highlightCandidateId?: string;
  hookText?: string;
  lines?: string[];
}

export async function draftShortsScript(
  actor: Actor,
  captureSessionId: string,
  opts: DraftOptions = {},
) {
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
  if (capture.containsLicensedMusic) {
    throw precondition("Captures containing licensed music cannot enter the Shorts pipeline");
  }

  const provider = getShortsScriptProvider();
  let highlightCandidateId: string | null = null;
  let highlights: { timestampSec: number; label: string; confidence: number }[] | undefined;
  if (provider.name !== "mock") {
    if (!capture.media) throw precondition("Attach the capture's real video file first");
    if (capture.media.rightsStatus === "UNCLEARED") {
      throw precondition("Capture media rights are UNCLEARED; it cannot be used");
    }
    await assertClaimsCurrent(capture.contentId);
    const cut = opts.highlightCandidateId
      ? await prisma.highlightCandidate.findUnique({ where: { id: opts.highlightCandidateId } })
      : null;
    if (!cut || cut.captureSessionId !== captureSessionId) {
      throw precondition("Choose a highlight cut from this capture");
    }
    if (cut.status !== "APPROVED") {
      throw precondition("Only an APPROVED highlight cut can be scripted");
    }
    highlightCandidateId = cut.id;
    highlights = [
      { timestampSec: cut.peakSec, label: `cut-rank-${cut.rank}`, confidence: cut.score },
    ];
  }
  const result = await provider
    .analyzeAndDraft({
      videoReference: capture.fileReference,
      durationCeilingSec: durationCeilingSec("9:16"),
      operatorScript: { hookText: opts.hookText ?? "", lines: opts.lines ?? [] },
      highlights,
    })
    .catch((e: unknown) => {
      throw precondition(e instanceof Error ? e.message : "Script draft failed");
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
      highlightCandidateId,
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
  const result = await provider
    .synthesize({
      scriptText,
      voiceProfileId,
      segments: [script.hookText, ...sections.map((s) => s.text)],
    })
    .catch((e: unknown) => {
      throw precondition(e instanceof Error ? e.message : "Narration failed");
    });

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
        cuesJson: (result.cues as unknown as object) ?? undefined,
        isFixture: result.isFixture ?? false,
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

const srtTime = (sec: number) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function renderShort(
  actor: Actor,
  voiceoverId: string,
  attributionText: string,
  format: RenderFormat = "9:16",
) {
  require_(actor, "ai.generate");
  const voiceover = await prisma.shortsVoiceover.findUnique({
    where: { id: voiceoverId },
    include: {
      script: {
        include: { captureSession: { include: { media: true } }, highlightCandidate: true },
      },
    },
  });
  if (!voiceover || voiceover.workspaceId !== actor.workspaceId) {
    throw notFound("Voiceover not found");
  }

  const provider = getVideoCompositorProvider();
  const storage = getAssetStorage();
  const capture = voiceover.script.captureSession;

  if (provider.name === "mock") {
    const result = await provider.render({
      sourceVideoReference: capture.fileReference ?? "",
      voiceoverAssetPath: voiceover.assetPath,
      attributionText,
    });
    const storagePath = `shorts/render/${voiceoverId}-${Date.now()}.mp4`;
    await storage.write(storagePath, result.videoBytes);
    return recordRender(actor, voiceover, provider.name, {
      storagePath,
      durationSec: result.durationSec,
      resolution: result.resolution,
      frameRate: result.frameRate,
      renderCostUsd: result.renderCostUsd,
    });
  }

  // ---- Real local render. Every gate is re-checked at render time. ----
  const media = capture.media;
  const cut = voiceover.script.highlightCandidate;
  if (capture.flagLeaked || capture.status !== "APPROVED") {
    throw precondition("The capture is no longer approved for use");
  }
  if (!media || media.rightsStatus === "UNCLEARED") {
    throw precondition("Capture media is missing or its rights are UNCLEARED");
  }
  if (!cut || cut.status !== "APPROVED") {
    throw precondition("The highlight cut is not APPROVED; rejected footage cannot be rendered");
  }
  if (voiceover.provider === "mock") {
    throw precondition("A real render needs a real narration; the mock voiceover is silent");
  }
  await assertClaimsCurrent(capture.contentId);
  const cues = (voiceover.cuesJson as CaptionCue[] | null) ?? [];
  const inSec = cut.trimStartSec ?? cut.startSec;
  const outSec = cut.trimEndSec ?? cut.endSec;
  // Long enough for the narration, never past the source or the ceiling for the
  // format (Shorts platform limit or a stricter editorial limit; see captions.ts).
  const ceiling = durationCeilingSec(format);
  const durationSec = Math.min(
    ceiling,
    media.durationSec,
    Math.max(outSec - inSec, voiceover.durationSec + 0.5),
  );
  if (voiceover.durationSec + 0.5 > durationSec) {
    throw precondition(
      `Narration (${voiceover.durationSec.toFixed(1)}s) does not fit the ${durationSec.toFixed(1)}s available; shorten the script`,
    );
  }
  // A Short over one minute is blocked on YouTube by any Content ID claim, so
  // the music gate is re-checked here (UNCLEARED media was refused above).
  if (
    format === "9:16" &&
    durationSec > SHORTS_RIGHTS_SENSITIVE_SEC &&
    capture.containsLicensedMusic
  ) {
    throw precondition("A Short longer than 60s cannot use footage with licensed music");
  }
  const startSec = Math.max(0, Math.min(inSec, media.durationSec - durationSec));
  const isFixture = media.rightsStatus === "INTERNAL_FIXTURE" || voiceover.isFixture;

  // Caption and transcript files are checked before any render time is spent.
  const sections = voiceover.script.sectionsJson as { text: string }[];
  const srt = cues
    .filter((c) => c.startSec < durationSec)
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(Math.min(c.endSec, durationSec))}\n${c.text}\n`,
    )
    .join("\n");
  const transcript = [voiceover.script.hookText, ...sections.map((s) => s.text)].join("\n") + "\n";
  let captionCheck: { cueCount: number; lastCueEndSec: number };
  try {
    captionCheck = validateCaptionContract({
      srt,
      transcript,
      clipDurationSec: durationSec,
      narrationDurationSec: voiceover.durationSec,
      format,
    });
  } catch (e) {
    if (e instanceof CaptionError) throw precondition(`Captions rejected: ${e.message}`);
    throw e;
  }

  const result = await provider
    .render({
      sourceVideoReference: capture.fileReference ?? "",
      voiceoverAssetPath: voiceover.assetPath,
      attributionText,
      sourceVideoPath: storage.absolutePath(media.storagePath),
      sourceHasAudio: media.audioCodec !== null,
      voiceoverPath: storage.absolutePath(voiceover.assetPath),
      clip: { startSec, durationSec },
      cues,
      format,
      fixtureLabel: isFixture ? FIXTURE_LABEL : undefined,
    })
    .catch((e: unknown) => {
      throw precondition(`Render failed: ${e instanceof Error ? e.message : "unknown error"}`);
    });

  // Review bundle: master + captions + transcript + cover + provenance manifest.
  const dir = `shorts/render/${voiceoverId}-${format.replace(":", "x")}-${Date.now()}`;
  const checksumSha256 = sha256(result.videoBytes);
  // Inspect the file that was actually produced, not the request that made it.
  await storage.write(`${dir}/master.mp4`, result.videoBytes);
  const masterPath = storage.absolutePath(`${dir}/master.mp4`);
  const probe = await probeVideo(masterPath);
  const meanDb = await meanVolumeDb(masterPath);
  const wanted = format === "9:16" ? "1080x1920" : "1920x1080";
  if (
    `${probe.width}x${probe.height}` !== wanted ||
    probe.audioCodec === null ||
    Math.abs(probe.durationSec - durationSec) > 1 ||
    !(meanDb > -60)
  ) {
    await storage.remove(`${dir}/master.mp4`);
    throw precondition(
      `Rendered master failed inspection (${probe.width}x${probe.height}, ${probe.durationSec.toFixed(1)}s, audio ${probe.audioCodec ?? "none"} at ${meanDb} dB)`,
    );
  }
  const manifest = {
    status: isFixture ? "INTERNAL_TECHNICAL_FIXTURE" : "PENDING_HUMAN_REVIEW",
    publication: "PUBLICATION_BLOCKED",
    format,
    resolution: result.resolution,
    frameRate: result.frameRate,
    durationSec: result.durationSec,
    masterSha256: checksumSha256,
    providers: {
      script: voiceover.script.provider,
      narration: voiceover.provider,
      compositor: provider.name,
    },
    narration: { isFixture: voiceover.isFixture, voiceProfileId: voiceover.voiceProfileId },
    source: {
      captureId: capture.id,
      originalName: media.originalName,
      sha256: media.checksumSha256,
      operator: media.operator,
      platform: capture.platform,
      gameVersion: capture.gameVersion,
      gameMode: media.gameMode,
      captureDate: capture.captureDate.toISOString(),
      captureMethod: media.captureMethod,
      sourceDevice: media.sourceDevice,
      resolution: `${media.width}x${media.height}@${media.frameRate}`,
      hudVisible: capture.hudVisible,
      spoilerLevel: capture.spoilerLevel,
      rightsStatus: media.rightsStatus,
    },
    edl: [
      {
        event: 1,
        sourceInSec: startSec,
        sourceOutSec: startSec + durationSec,
        highlightCandidateId: cut.id,
        analyzer: cut.analyzerVersion,
        score: cut.score,
        approvedBy: cut.reviewedBy,
      },
    ],
    script: { hookText: voiceover.script.hookText, sections: sections.map((s) => s.text) },
    attributionText,
    costUsd: result.renderCostUsd,
    verification: {
      captionCues: captionCheck.cueCount,
      lastCueEndSec: captionCheck.lastCueEndSec,
      probedDurationSec: probe.durationSec,
      probedResolution: `${probe.width}x${probe.height}`,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      meanVolumeDb: meanDb,
      note: "File checks only. Audible speech and burned-in captions still need a human look.",
    },
  };
  const files: [string, Buffer][] = [
    ["master.mp4", result.videoBytes],
    ["captions.srt", Buffer.from(srt)],
    ["transcript.txt", Buffer.from(transcript)],
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2))],
  ];
  if (result.coverJpg) files.push(["cover.jpg", result.coverJpg]);
  for (const [name, bytes] of files) await storage.write(`${dir}/${name}`, bytes);
  const bundlePath = `${dir}/bundle.zip`;
  await run("zip", [
    "-q",
    "-j",
    "-X",
    storage.absolutePath(bundlePath),
    ...files.map(([n]) => storage.absolutePath(`${dir}/${n}`)),
  ]);

  return recordRender(actor, voiceover, provider.name, {
    storagePath: `${dir}/master.mp4`,
    durationSec: result.durationSec,
    resolution: result.resolution,
    frameRate: result.frameRate,
    renderCostUsd: result.renderCostUsd,
    format,
    isFixture,
    checksumSha256,
    bundlePath,
    manifestJson: manifest,
  });
}

async function recordRender(
  actor: Actor,
  voiceover: { id: string; scriptId: string },
  providerName: string,
  data: {
    storagePath: string;
    durationSec: number;
    resolution: string;
    frameRate: number;
    renderCostUsd: number;
    format?: string;
    isFixture?: boolean;
    checksumSha256?: string;
    bundlePath?: string;
    manifestJson?: object;
  },
) {
  const render = await prisma.shortsRender.create({
    data: {
      workspaceId: actor.workspaceId,
      scriptId: voiceover.scriptId,
      voiceoverId: voiceover.id,
      ...data,
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
    metadata: { voiceoverId: voiceover.id, provider: providerName, costUsd: data.renderCostUsd },
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
  if (render.isFixture) {
    throw precondition("Technical fixture renders can never be published");
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
