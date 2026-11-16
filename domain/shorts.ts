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
  chunkCues,
  durationCeilingSec,
  validateCaptionContract,
} from "@/lib/media/captions";
import type { CaptionCue, RenderFormat } from "@/lib/shorts";
import { toCanonicalRecord, blocksProduction } from "@/domain/canonicalTaxonomy";
import { CARDS_VERSION, cardProblems, type CardSpec } from "@/lib/media/cards";
import { narrationQa, qaFailures, renderQa } from "@/lib/media/qa";
import { MediaProcessError, QaRefusal, runMediaJob } from "@/domain/mediaJobs";
import type { MediaClass } from "@prisma/client";

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

// What gets burned into the picture. Three separate facts - the footage is an
// engineering fixture, the picture is illustrative graphics, the voice is
// synthetic - each named for what it is. Nothing labelled here is publishable.
export function burnedLabel(f: {
  engineeringFixture: boolean;
  graphics: boolean;
  syntheticVoice: boolean;
}): string | undefined {
  if (f.engineeringFixture) return FIXTURE_LABEL;
  const parts = [
    ...(f.graphics ? ["ILLUSTRATIVE GRAPHICS"] : []),
    ...(f.syntheticVoice ? ["SYNTHETIC VOICE"] : []),
    ...(f.graphics ? ["NOT GAMEPLAY"] : []),
  ];
  return parts.length ? `INTERNAL DRAFT - ${parts.join(" - ")} - NOT FOR PUBLICATION` : undefined;
}

// Explainer script lines carry their title card after "||":
//   spoken sentence || LABEL :: STATEMENT :: supporting note
export function parseCardLine(raw: string): { text: string; card: CardSpec | null } {
  const at = raw.indexOf("||");
  if (at < 0) return { text: raw.trim(), card: null };
  const [label = "", value = "", note = ""] = raw
    .slice(at + 2)
    .split("::")
    .map((x) => x.trim());
  return { text: raw.slice(0, at).trim(), card: { label, value, note } };
}

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
async function assertClaimsCurrent(contentId: string, requireOne = false) {
  const links = await prisma.contentClaim.findMany({
    where: { contentId },
    include: { claim: { include: { sources: { include: { source: true } } } } },
  });
  if (requireOne && links.length === 0) {
    throw precondition("An explainer needs at least one linked claim with a current source");
  }
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

  // An explainer session has no footage: there is nothing to review or ingest.
  const graphics = capture.kind === "GRAPHICS";
  if (capture.flagLeaked) throw precondition("Leaked-flagged footage can never enter the pipeline");
  if (!graphics && capture.status !== "APPROVED") {
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
  let operatorScript = { hookText: opts.hookText ?? "", lines: opts.lines ?? [] };
  let cards: CardSpec[] | null = null;
  if (graphics) {
    if (provider.name === "mock") {
      throw precondition("An explainer needs the local pipeline (operator-written script)");
    }
    await assertClaimsCurrent(capture.contentId, true);
    const already = await prisma.shortsScript.findFirst({
      where: { captureSessionId, status: "VALID" },
    });
    if (already) throw precondition("This explainer already has a script");
    const parsed = [operatorScript.hookText, ...operatorScript.lines].map(parseCardLine);
    const noCard = parsed.findIndex((x) => !x.card);
    if (noCard >= 0) {
      throw precondition(
        `${noCard === 0 ? "The hook" : `Line ${noCard}`} has no title card. Write it as: spoken sentence || LABEL :: STATEMENT :: note`,
      );
    }
    cards = parsed.map((x) => x.card!);
    const problems = cards.flatMap((c, i) => cardProblems(c, i));
    if (problems.length) throw precondition(problems.join("; "));
    operatorScript = { hookText: parsed[0]!.text, lines: parsed.slice(1).map((x) => x.text) };
  } else if (provider.name !== "mock") {
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
      operatorScript,
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
      cardsJson: cards ? (cards as unknown as object) : undefined,
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
  const lines = [script.hookText, ...sections.map((s) => s.text)];
  const provider = getTTSProvider();
  const storage = getAssetStorage();
  const assetPath = `shorts/voiceover/${scriptId}.wav`;

  const make = async () => {
    const result = await provider
      .synthesize({ scriptText: lines.join(" "), voiceProfileId, segments: lines })
      .catch((e: unknown) => {
        throw precondition(e instanceof Error ? e.message : "Narration failed");
      });
    await storage.write(assetPath, result.audioBytes);

    // Real narration is checked before it is recorded: clipping, dead air, a
    // cut-off ending, speech against the script, captions against the speech.
    let qa: object | undefined;
    if (provider.name !== "mock" && result.cues) {
      const report = await narrationQa({
        wavPath: storage.absolutePath(assetPath),
        lines,
        cues: result.cues,
        cueTiming: result.cueTiming ?? "APPROXIMATE",
      });
      if (!report.passed) {
        await storage.remove(assetPath).catch(() => undefined);
        throw new QaRefusal(`Narration failed QA: ${qaFailures(report).join("; ")}`, report);
      }
      qa = report as unknown as object;
    }

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
          isSynthetic: result.isSynthetic ?? false,
          voiceName: result.voiceName ?? null,
          voiceLicenseNote: result.voiceLicenseNote ?? null,
          qaJson: qa,
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
  };

  // The mock is a deterministic placeholder; real narration runs as a job so
  // a failure is recorded and can be retried.
  if (provider.name === "mock") return make();
  const { result } = await runMediaJob(actor, {
    kind: "NARRATION",
    idempotencyKey: sha256(
      Buffer.from(
        JSON.stringify({ v: 1, scriptId, lines, provider: provider.name, voiceProfileId }),
      ),
    ),
    subjectId: scriptId,
    label: "Narration",
    findExisting: (id) => prisma.shortsVoiceover.findUnique({ where: { id } }),
    work: make,
  });
  return result;
}

const loadVoiceover = (voiceoverId: string) =>
  prisma.shortsVoiceover.findUnique({
    where: { id: voiceoverId },
    include: {
      script: {
        include: { captureSession: { include: { media: true } }, highlightCandidate: true },
      },
    },
  });
type LoadedVoiceover = NonNullable<Awaited<ReturnType<typeof loadVoiceover>>>;

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
  const voiceover = await loadVoiceover(voiceoverId);
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

  // ---- Real local render ---------------------------------------------------
  // One job per distinct request (domain/mediaJobs.ts): the same inputs return
  // the render that already exists; a failure is recorded and can be retried.
  const media = capture.media;
  const cut = voiceover.script.highlightCandidate;
  const idempotencyKey = sha256(
    Buffer.from(
      JSON.stringify({
        v: 1,
        voiceoverId,
        voice: [voiceover.assetPath, voiceover.durationSec, voiceover.cuesJson],
        format,
        attributionText,
        media: media ? [media.checksumSha256, media.rightsStatus] : null,
        cut: cut
          ? [cut.id, cut.status, cut.trimStartSec ?? cut.startSec, cut.trimEndSec ?? cut.endSec]
          : null,
        kind: capture.kind,
        cards: voiceover.script.cardsJson ?? null,
        compositor: [provider.name, CARDS_VERSION],
        editorialMaxSec: process.env.SHORTS_EDITORIAL_MAX_SEC ?? null,
      }),
    ),
  );
  const { result } = await runMediaJob(actor, {
    kind: "RENDER",
    idempotencyKey,
    subjectId: voiceoverId,
    label: `Render ${format}`,
    findExisting: async (id) => {
      const r = await prisma.shortsRender.findUnique({ where: { id } });
      return r && r.status !== "REJECTED" ? r : null;
    },
    work: () => renderLocal(actor, voiceover, attributionText, format, idempotencyKey),
  });
  return result;
}

// The real render. Every gate is re-checked here, at render time; the file is
// inspected and passed through QA before anything is recorded.
async function renderLocal(
  actor: Actor,
  voiceover: LoadedVoiceover,
  attributionText: string,
  format: RenderFormat,
  idempotencyKey: string,
) {
  const provider = getVideoCompositorProvider();
  const storage = getAssetStorage();
  const capture = voiceover.script.captureSession;
  const media = capture.media;
  const cut = voiceover.script.highlightCandidate;
  const graphics = capture.kind === "GRAPHICS";
  const cards = graphics ? ((voiceover.script.cardsJson as CardSpec[] | null) ?? null) : null;
  const lineCues = (voiceover.cuesJson as CaptionCue[] | null) ?? [];
  const sections = voiceover.script.sectionsJson as { text: string }[];
  const lines = [voiceover.script.hookText, ...sections.map((s) => s.text)];

  if (capture.flagLeaked || (!graphics && capture.status !== "APPROVED")) {
    throw precondition("The capture is no longer approved for use");
  }
  if (!graphics && (!media || media.rightsStatus === "UNCLEARED")) {
    throw precondition("Capture media is missing or its rights are UNCLEARED");
  }
  if (!graphics && (!cut || cut.status !== "APPROVED")) {
    throw precondition("The highlight cut is not APPROVED; rejected footage cannot be rendered");
  }
  if (voiceover.provider === "mock") {
    throw precondition("A real render needs a real narration; the mock voiceover is silent");
  }
  await assertClaimsCurrent(capture.contentId, graphics);

  // Long enough for the narration, never past the source or the ceiling for the
  // format (Shorts platform limit or a stricter editorial limit; see captions.ts).
  const ceiling = durationCeilingSec(format);
  let durationSec: number;
  let startSec = 0;
  if (graphics) {
    if (!cards || cards.length !== lineCues.length) {
      throw precondition("This explainer's title cards do not match its narration lines");
    }
    // The cards are generated to the narration: its length plus a one-second hold.
    durationSec = Math.round((voiceover.durationSec + 1) * 100) / 100;
    if (durationSec > ceiling) {
      throw precondition(
        `Narration (${voiceover.durationSec.toFixed(1)}s) does not fit the ${ceiling.toFixed(1)}s available; shorten the script`,
      );
    }
  } else {
    const inSec = cut!.trimStartSec ?? cut!.startSec;
    const outSec = cut!.trimEndSec ?? cut!.endSec;
    durationSec = Math.min(
      ceiling,
      media!.durationSec,
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
    startSec = Math.max(0, Math.min(inSec, media!.durationSec - durationSec));
  }

  // What this render is. Kept as separate facts; `isFixture` remains the
  // "can never be published" taint exactly as before.
  const engineeringFixture = media?.rightsStatus === "INTERNAL_FIXTURE";
  const syntheticVoice = voiceover.isSynthetic || voiceover.provider === "local-say-fixture";
  const isFixture = engineeringFixture || voiceover.isFixture;
  const mediaClass: MediaClass = engineeringFixture
    ? "ENGINEERING_FIXTURE"
    : graphics
      ? "ILLUSTRATIVE_DRAFT"
      : "GAMEPLAY_CAPTURE";
  const label = burnedLabel({ engineeringFixture, graphics, syntheticVoice });

  // Captions as they will be burned in: narration lines split to fit the
  // frame. The caption and transcript files are checked before any render
  // time is spent.
  const displayCues = chunkCues(
    lineCues
      .filter((c) => c.startSec < durationSec)
      .map((c) => ({ ...c, endSec: Math.min(c.endSec, durationSec) })),
    format,
  );
  const srt = displayCues
    .map((c, i) => `${i + 1}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${c.text}\n`)
    .join("\n");
  const transcript = lines.join("\n") + "\n";
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

  const cardsPlan =
    graphics && cards
      ? { format, cards, startsSec: lineCues.map((c) => c.startSec), durationSec }
      : undefined;
  const result = await provider
    .render({
      sourceVideoReference: capture.fileReference ?? "",
      voiceoverAssetPath: voiceover.assetPath,
      attributionText,
      sourceVideoPath: media ? storage.absolutePath(media.storagePath) : undefined,
      sourceHasAudio: media ? media.audioCodec !== null : false,
      voiceoverPath: storage.absolutePath(voiceover.assetPath),
      clip: { startSec, durationSec },
      cues: displayCues,
      format,
      fixtureLabel: label,
      cards: cardsPlan ? { cards: cardsPlan.cards, startsSec: cardsPlan.startsSec } : undefined,
    })
    .catch((e: unknown) => {
      // A media tool failed: worth one automatic retry (see mediaJobs.ts).
      throw new MediaProcessError(
        `Render failed: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    });

  // Review bundle: master + captions + transcript + cover + provenance + QA.
  const dir = `shorts/render/${voiceover.id}-${format.replace(":", "x")}-${Date.now()}`;
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
  const renderedAt = new Date().toISOString();

  // Automatic QA on the finished file. A master that fails is deleted and
  // never recorded as a render; the report is kept with the failed job.
  const qa = await renderQa({
    masterPath,
    format,
    durationSec: probe.durationSec,
    lineCues,
    displayCues,
    lines,
    hasSourceAudio: media ? media.audioCodec !== null : false,
    cards: cardsPlan,
  });
  if (!qa.report.passed) {
    await storage.remove(`${dir}/master.mp4`);
    throw new QaRefusal(`Render failed QA: ${qaFailures(qa.report).join("; ")}`, qa.report);
  }
  const qaAt = new Date().toISOString();
  const qaRecord = {
    ...qa.report,
    stateHistory: [
      { state: "RENDERED", at: renderedAt },
      { state: "QA_CHECKED", at: qaAt },
      { state: "PENDING_MIKE_REVIEW", at: qaAt },
    ],
  };

  const manifest = {
    status: engineeringFixture
      ? "INTERNAL_TECHNICAL_FIXTURE"
      : graphics
        ? "INTERNAL_ILLUSTRATIVE_DRAFT"
        : "PENDING_HUMAN_REVIEW",
    reviewState: "PENDING_MIKE_REVIEW",
    publication: "PUBLICATION_BLOCKED",
    mediaClass,
    burnedLabel: label ?? null,
    format,
    resolution: result.resolution,
    frameRate: result.frameRate,
    durationSec: result.durationSec,
    masterSha256: checksumSha256,
    idempotencyKey,
    providers: {
      script: voiceover.script.provider,
      narration: voiceover.provider,
      compositor: provider.name,
    },
    narration: {
      isFixture: voiceover.isFixture,
      isSynthetic: syntheticVoice,
      voiceName: voiceover.voiceName,
      voiceLicenseNote: voiceover.voiceLicenseNote,
      voiceProfileId: voiceover.voiceProfileId,
    },
    source: media
      ? {
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
        }
      : {
          sessionId: capture.id,
          kind: "STUDIO_TITLE_CARDS",
          generator: CARDS_VERSION,
          note: "Original graphics generated by the Studio. Not gameplay.",
          cards,
        },
    edl: cut
      ? [
          {
            event: 1,
            sourceInSec: startSec,
            sourceOutSec: startSec + durationSec,
            highlightCandidateId: cut.id,
            analyzer: cut.analyzerVersion,
            score: cut.score,
            approvedBy: cut.reviewedBy,
          },
        ]
      : [{ event: 1, generated: true, durationSec }],
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
      loudness: qa.loudness,
      loudnormFirstPass: result.loudnorm ?? null,
      qaPassed: qa.report.passed,
      qaFullyVerified: qa.report.verified,
      humanValidation: qa.report.humanValidation,
    },
  };
  const files: [string, Buffer][] = [
    ["master.mp4", result.videoBytes],
    ["captions.srt", Buffer.from(srt)],
    ["transcript.txt", Buffer.from(transcript)],
    ["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2))],
    ["qa.json", Buffer.from(JSON.stringify(qaRecord, null, 2))],
    ["contact.jpg", qa.contactSheet],
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

  const render = await recordRender(actor, voiceover, provider.name, {
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
    mediaClass,
    reviewState: "PENDING_MIKE_REVIEW",
    qaJson: qaRecord,
    idempotencyKey,
  });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "shorts.render_qa_checked",
    entityType: "ShortsRender",
    entityId: render.id,
    metadata: {
      checksumSha256,
      mediaClass,
      reviewState: "PENDING_MIKE_REVIEW",
      fullyVerified: qa.report.verified,
      loudnessLufs: qa.loudness.integratedLufs,
    },
  });
  return render;
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
    mediaClass?: MediaClass;
    reviewState?: "PENDING_MIKE_REVIEW";
    qaJson?: object;
    idempotencyKey?: string;
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
      // An editorial approval here is not the Owner's approval of the file:
      // reviewState only moves to MIKE_APPROVED through approveRenderVersion.
      ...(decision === "REJECTED" && render.reviewState ? { reviewState: "REJECTED" } : {}),
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

// The Owner's approval of one exact file. It is the only way a locally
// rendered draft reaches MIKE_APPROVED: it must be pending review, the
// approver types the start of the file's SHA-256, and the file on disk must
// still hash to the recorded value. Automation never calls this.
export async function approveRenderVersion(actor: Actor, renderId: string, checksumPrefix: string) {
  require_(actor, "shorts.approve");
  const render = await prisma.shortsRender.findUnique({ where: { id: renderId } });
  if (!render || render.workspaceId !== actor.workspaceId) throw notFound("Render not found");
  if (render.reviewState !== "PENDING_MIKE_REVIEW" || !render.checksumSha256) {
    throw precondition("Only a draft that is pending the Owner's review can be approved");
  }
  const prefix = checksumPrefix.trim().toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(prefix)) {
    throw precondition("Type at least the first 8 characters of this file's SHA-256");
  }
  if (!render.checksumSha256.startsWith(prefix)) {
    throw precondition("That is not this file's SHA-256; approval is tied to the exact file");
  }
  const onDisk = await getAssetStorage()
    .read(render.storagePath)
    .then(sha256)
    .catch(() => null);
  if (onDisk !== render.checksumSha256) {
    throw precondition("The stored file no longer matches its recorded hash; render it again");
  }
  const { count } = await prisma.shortsRender.updateMany({
    where: { id: renderId, reviewState: "PENDING_MIKE_REVIEW" },
    data: {
      reviewState: "MIKE_APPROVED",
      approvedChecksum: render.checksumSha256,
      approvedBy: actor.userId,
      approvedAt: new Date(),
      ...(render.status === "PENDING"
        ? { status: QuarantineStatus.CLEAN, reviewedBy: actor.userId }
        : {}),
    },
  });
  if (count === 0) throw precondition("This draft is no longer pending review");
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "shorts.render_owner_approved",
    entityType: "ShortsRender",
    entityId: renderId,
    metadata: { checksumSha256: render.checksumSha256 },
  });
  return prisma.shortsRender.findUniqueOrThrow({ where: { id: renderId } });
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
  if (render.mediaClass === "ILLUSTRATIVE_DRAFT") {
    throw precondition("Illustrative drafts cannot be published");
  }
  if (render.reviewState && render.reviewState !== "MIKE_APPROVED") {
    throw precondition("This file has not been approved by the Owner");
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
