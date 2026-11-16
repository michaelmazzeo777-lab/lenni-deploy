import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rename, rm, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { FIXTURES, makeFixture } from "../helpers/fixtures";
import { createContent } from "@/domain/content";
import { createSource, createClaim, linkClaimToContent } from "@/domain/evidence";
import { markSourceStale } from "@/domain/updates";
import { startGraphicsSession, submitCapture, reviewCapture } from "@/domain/capture";
import { attachCaptureMedia, analyzeHighlights, reviewHighlight } from "@/domain/captureMedia";
import {
  approveRenderVersion,
  draftShortsScript,
  publishShort,
  renderShort,
  reviewRender,
  synthesizeVoiceover,
} from "@/domain/shorts";
import { LocalAssetStorage } from "@/lib/storage/local-provider";
import { ffmpeg, probeVideo, run } from "@/lib/media/ffmpeg";
import { measureLoudness } from "@/lib/media/audio-qa";
import { transcriberConfig } from "@/lib/media/transcribe";

// The explainer workflow end to end on the real local pipeline (system voice,
// ffmpeg, local transcription): source -> claim -> script with title cards ->
// narration -> native 16:9 and 9:16 renders -> QA -> pending the Owner's
// review. Also: failure recording and recovery, duplicate prevention, and the
// approval and publish boundaries.

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, producer: A, outsider: A;
const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
const INGEST = path.resolve("./.data/ingest-explainer-test");
const ENV = {
  CAPTURE_INGEST_DIR: INGEST,
  SHORTS_SCRIPT_PROVIDER: "local-operator",
  TTS_PROVIDER: "local-say-fixture",
  VIDEO_COMPOSITOR_PROVIDER: "local-ffmpeg",
};
const saved: Record<string, string | undefined> = {};
const HAS_MODEL = !("missing" in transcriberConfig());
const ATTR = "Leonida Field Guide - independent fan guide (test)";

const HOOK =
  "This is a test explainer. || TEST EXPLAINER :: WHAT THE PAGE SAYS :: Checked for this test";
const LINES = [
  "The first fact is shown on the test page. || FACT ONE :: THE FIRST FACT :: As shown on the page",
  "The second fact closes the video. || FACT TWO :: THE SECOND FACT :: Also shown on the page",
];
const SPOKEN = [
  "This is a test explainer.",
  "The first fact is shown on the test page.",
  "The second fact closes the video.",
];

let contentId = "";
let sessionId = "";
let sourceId = "";
let scriptId = "";
let voId = "";
let wideId = "";
let tallId = "";

const renderJob = (voiceoverId: string, label: string) =>
  prisma.mediaJob.findFirstOrThrow({
    where: { workspaceId: owner.workspaceId, kind: "RENDER", subjectId: voiceoverId, label },
  });
const renders = (voiceoverId: string, format?: string) =>
  prisma.shortsRender.count({ where: { voiceoverId, ...(format ? { format } : {}) } });

async function explainer(title: string) {
  const content = await createContent(editor, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: title,
  });
  const session = await startGraphicsSession(producer, content.id);
  const source = await createSource(owner, {
    title: "Official page (explainer test)",
    publisher: "Test Publisher",
    sourceClass: "OFFICIAL_SOURCE",
    sourceType: "official-page",
  });
  const claim = await createClaim(owner, {
    statement: "The page shows the first fact.",
    classification: "CONFIRMED",
    sourceIds: [source.id],
  });
  await linkClaimToContent(owner, content.id, claim.id);
  return { content, session, source };
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  await rm(INGEST, { recursive: true, force: true });
  await mkdir(INGEST, { recursive: true });
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  producer = await ws.actor([Role.PRODUCER], "producer");
  outsider = await (await makeWorkspace()).actor([Role.OWNER], "outsider");
}, 60_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(INGEST, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("explainer workflow", () => {
  it("starts from a session with no footage, and needs claims and a card for every line", async () => {
    const content = await createContent(editor, {
      type: "SHORT",
      pillar: "BRIEFING",
      workingTitle: "Explainer pipeline test",
    });
    contentId = content.id;
    const session = await startGraphicsSession(producer, contentId);
    sessionId = session.id;
    expect([session.kind, session.status, session.targetsShorts, session.reviewedBy]).toEqual([
      "GRAPHICS",
      "SUBMITTED", // nothing was captured, so nothing is "approved"
      true,
      null,
    ]);
    // Asking again returns the same session: no duplicates.
    expect((await startGraphicsSession(producer, contentId)).id).toBe(sessionId);
    expect(await prisma.captureSession.count({ where: { contentId } })).toBe(1);
    await expect(startGraphicsSession(editor, contentId)).rejects.toThrow(/Missing capability/);
    await expect(startGraphicsSession(outsider, contentId)).rejects.toThrow(/not found/);
    await expect(
      attachCaptureMedia(owner, {
        captureSessionId: sessionId,
        fileName: "x.mp4",
        operator: "Test Operator",
        captureMethod: "OTHER",
        sourceDevice: "Test device",
        rightsStatus: "OWNED_ORIGINAL_CAPTURE",
      }),
    ).rejects.toThrow(/no footage/);

    // No claim yet: an explainer must rest on a linked, current claim.
    await expect(
      draftShortsScript(owner, sessionId, { hookText: HOOK, lines: LINES }),
    ).rejects.toThrow(/at least one linked claim/);
    const source = await createSource(owner, {
      title: "Official page (explainer test)",
      publisher: "Test Publisher",
      sourceClass: "OFFICIAL_SOURCE",
      sourceType: "official-page",
    });
    sourceId = source.id;
    const claim = await createClaim(owner, {
      statement: "The page shows the first fact.",
      classification: "CONFIRMED",
      sourceIds: [source.id],
    });
    await linkClaimToContent(owner, contentId, claim.id);

    await expect(
      draftShortsScript(owner, sessionId, {
        hookText: HOOK,
        lines: ["A line with no card.", LINES[1]!],
      }),
    ).rejects.toThrow(
      /Line 1 has no title card\. Write it as: spoken sentence \|\| LABEL :: STATEMENT :: note/,
    );
    await expect(
      draftShortsScript(owner, sessionId, {
        hookText: `Hook. || ${"L".repeat(31)} :: VALUE :: note`,
        lines: LINES,
      }),
    ).rejects.toThrow(/Card 1: label is 31 characters; the limit is 30/);
    expect(await prisma.shortsScript.count({ where: { captureSessionId: sessionId } })).toBe(0);

    const script = await draftShortsScript(owner, sessionId, { hookText: HOOK, lines: LINES });
    scriptId = script.id;
    expect(script.status).toBe("VALID");
    expect(script.hookText).toBe(SPOKEN[0]);
    expect((script.sectionsJson as { text: string }[]).map((s) => s.text)).toEqual(SPOKEN.slice(1));
    expect(script.cardsJson).toEqual([
      { label: "TEST EXPLAINER", value: "WHAT THE PAGE SAYS", note: "Checked for this test" },
      { label: "FACT ONE", value: "THE FIRST FACT", note: "As shown on the page" },
      { label: "FACT TWO", value: "THE SECOND FACT", note: "Also shown on the page" },
    ]);
    expect(script.highlightCandidateId).toBeNull(); // no highlight ranker involved
    await expect(
      draftShortsScript(owner, sessionId, { hookText: HOOK, lines: LINES }),
    ).rejects.toThrow(/already has a script/);
  });

  it("checks the narration and records what the voice is", async () => {
    const vo = await synthesizeVoiceover(owner, scriptId, "default");
    voId = vo.id;
    expect([vo.isSynthetic, vo.isFixture]).toEqual([true, true]);
    expect(vo.voiceName).toMatch(/macOS system default voice/);
    expect(vo.voiceLicenseNote).toMatch(/has not been reviewed/);
    const qa = vo.qaJson as {
      passed: boolean;
      verified: boolean;
      checks: { name: string; status: string }[];
      measurements: { wer: number | null };
    };
    expect(qa.passed).toBe(true);
    expect(qa.verified).toBe(HAS_MODEL);
    expect(qa.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    if (HAS_MODEL) expect(qa.measurements.wer).toBeLessThanOrEqual(0.15);
    const job = await prisma.mediaJob.findFirstOrThrow({
      where: { kind: "NARRATION", subjectId: scriptId },
    });
    expect([job.status, job.attempts, job.resultId]).toEqual(["SUCCEEDED", 1, vo.id]);
    await expect(synthesizeVoiceover(owner, scriptId, "default")).rejects.toThrow(/already exists/);
    expect(await prisma.shortsVoiceover.count({ where: { scriptId } })).toBe(1);
  }, 120_000);

  it("records a failure and recovers: a stale source, then a failed media process", async () => {
    // 1. A gate refuses: the linked source went stale. Recorded, not retried.
    await markSourceStale(owner, sourceId, "date changed on the official page");
    await expect(renderShort(owner, voId, ATTR, "16:9")).rejects.toThrow(
      /stale, contradicted or quarantined/,
    );
    let job = await renderJob(voId, "Render 16:9");
    expect([job.status, job.attempts]).toEqual(["FAILED", 1]);
    expect(job.lastError).toMatch(/stale/);
    await prisma.source.update({ where: { id: sourceId }, data: { status: "ACTIVE" } });

    // 2. A media process fails: the narration file is missing. Tried twice, then recorded.
    const vo = await prisma.shortsVoiceover.findUniqueOrThrow({ where: { id: voId } });
    const wavPath = storage.absolutePath(vo.assetPath);
    await rename(wavPath, `${wavPath}.hidden`);
    await expect(renderShort(owner, voId, ATTR, "16:9")).rejects.toThrow(
      /Render 16:9 failed after 2 attempts: Render failed:/,
    );
    job = await renderJob(voId, "Render 16:9");
    expect([job.status, job.attempts, job.resultId]).toEqual(["FAILED", 3, null]);
    expect(await renders(voId)).toBe(0);
    // Nothing half-written was left behind in storage.
    const left = (await readdir(storage.absolutePath("shorts/render")).catch(() => [])).filter(
      (d) => d.startsWith(voId),
    );
    expect(left).toEqual([]);

    // 3. Recovery: put the file back and ask again. Same job, one render.
    await rename(`${wavPath}.hidden`, wavPath);
    const render = await renderShort(owner, voId, ATTR, "16:9");
    wideId = render.id;
    job = await renderJob(voId, "Render 16:9");
    expect([job.status, job.attempts, job.resultId, job.lastError]).toEqual([
      "SUCCEEDED",
      4,
      render.id,
      null,
    ]);
    expect(await renders(voId, "16:9")).toBe(1);
    expect(
      await prisma.mediaJob.count({
        where: { kind: "RENDER", subjectId: voId, label: "Render 16:9" },
      }),
    ).toBe(1);
  }, 180_000);

  it("delivers a QA-checked 16:9 draft, pending the Owner's review, with its evidence", async () => {
    const r = await prisma.shortsRender.findUniqueOrThrow({ where: { id: wideId } });
    expect([r.format, r.resolution, r.mediaClass, r.reviewState, r.status]).toEqual([
      "16:9",
      "1920x1080",
      "ILLUSTRATIVE_DRAFT",
      "PENDING_MIKE_REVIEW",
      "PENDING",
    ]);
    expect(r.isFixture).toBe(true); // synthetic voice: still never publishable
    expect([r.approvedBy, r.approvedAt, r.approvedChecksum, r.reviewedBy]).toEqual([
      null,
      null,
      null,
      null,
    ]);

    const file = storage.absolutePath(r.storagePath);
    const probe = await probeVideo(file);
    expect([probe.width, probe.height, probe.videoCodec, probe.audioCodec]).toEqual([
      1920,
      1080,
      "h264",
      "aac",
    ]);
    const loud = await measureLoudness(file);
    expect(Math.abs(loud.integratedLufs + 16)).toBeLessThanOrEqual(1);
    expect(loud.truePeakDb).toBeLessThanOrEqual(-1);

    const qa = r.qaJson as {
      passed: boolean;
      verified: boolean;
      checks: { name: string; status: string }[];
      humanValidation: string[];
      stateHistory: { state: string; at: string }[];
    };
    expect(qa.passed).toBe(true);
    expect(qa.verified).toBe(HAS_MODEL);
    expect(
      qa.checks.every(
        (c) =>
          c.status === "PASS" || c.status === "WARN" || (!HAS_MODEL && c.status === "NOT_VERIFIED"),
      ),
    ).toBe(true);
    expect(qa.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "Loudness",
        "Speech matches script",
        "Every card is on screen",
        "Captions are burned in",
      ]),
    );
    expect(qa.stateHistory.map((s) => s.state)).toEqual([
      "RENDERED",
      "QA_CHECKED",
      "PENDING_MIKE_REVIEW",
    ]);
    expect(qa.humanValidation.join(" ")).toMatch(/Listen to the narration/);

    const manifest = r.manifestJson as {
      status: string;
      publication: string;
      mediaClass: string;
      burnedLabel: string;
      reviewState: string;
      narration: { isSynthetic: boolean; voiceName: string };
      source: { kind: string; generator: string; cards: unknown[] };
    };
    expect(manifest.burnedLabel).toBe(
      "INTERNAL DRAFT - ILLUSTRATIVE GRAPHICS - SYNTHETIC VOICE - NOT GAMEPLAY - NOT FOR PUBLICATION",
    );
    expect(manifest.burnedLabel).not.toMatch(/FIXTURE/);
    expect([
      manifest.status,
      manifest.publication,
      manifest.mediaClass,
      manifest.reviewState,
    ]).toEqual([
      "INTERNAL_ILLUSTRATIVE_DRAFT",
      "PUBLICATION_BLOCKED",
      "ILLUSTRATIVE_DRAFT",
      "PENDING_MIKE_REVIEW",
    ]);
    expect(manifest.narration.isSynthetic).toBe(true);
    expect([manifest.source.kind, manifest.source.generator, manifest.source.cards.length]).toEqual(
      ["STUDIO_TITLE_CARDS", "cards-1", 3],
    );

    const dir = path.dirname(r.storagePath);
    for (const f of [
      "master.mp4",
      "captions.srt",
      "transcript.txt",
      "manifest.json",
      "qa.json",
      "contact.jpg",
      "cover.jpg",
      "bundle.zip",
    ]) {
      expect(await storage.exists(`${dir}/${f}`)).toBe(true);
    }
    const { stdout } = await run("unzip", ["-Z1", storage.absolutePath(r.bundlePath!)]);
    expect(stdout.trim().split("\n").sort()).toEqual(
      [
        "captions.srt",
        "contact.jpg",
        "cover.jpg",
        "manifest.json",
        "master.mp4",
        "qa.json",
        "transcript.txt",
      ].sort(),
    );
    expect((await storage.read(`${dir}/transcript.txt`)).toString().trim().split("\n")).toEqual(
      SPOKEN,
    );
    expect(
      await prisma.auditEvent.count({
        where: { action: "shorts.render_qa_checked", entityId: wideId },
      }),
    ).toBe(1);
  }, 60_000);

  it("returns the same render for the same request, and makes one render from two simultaneous requests", async () => {
    const jobBefore = await renderJob(voId, "Render 16:9");
    const again = await renderShort(owner, voId, ATTR, "16:9");
    expect(again.id).toBe(wideId);
    expect(await renders(voId, "16:9")).toBe(1);
    expect((await renderJob(voId, "Render 16:9")).attempts).toBe(jobBefore.attempts);

    const settled = await Promise.allSettled([
      renderShort(owner, voId, ATTR, "9:16"),
      renderShort(owner, voId, ATTR, "9:16"),
    ]);
    const done = settled.filter((s) => s.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
    }>[];
    const refused = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect([done.length, refused.length]).toEqual([1, 1]);
    expect(String(refused[0]!.reason.message)).toMatch(/Render 9:16 is already running/);
    tallId = done[0]!.value.id;
    expect(await renders(voId, "9:16")).toBe(1);
    expect((await renderShort(owner, voId, ATTR, "9:16")).id).toBe(tallId);

    // The vertical draft is its own native file.
    const tall = await prisma.shortsRender.findUniqueOrThrow({ where: { id: tallId } });
    const probe = await probeVideo(storage.absolutePath(tall.storagePath));
    expect([probe.width, probe.height]).toEqual([1080, 1920]);
    expect([tall.mediaClass, tall.reviewState]).toEqual([
      "ILLUSTRATIVE_DRAFT",
      "PENDING_MIKE_REVIEW",
    ]);
    expect(tall.checksumSha256).not.toBe(
      (await prisma.shortsRender.findUniqueOrThrow({ where: { id: wideId } })).checksumSha256,
    );
  }, 240_000);

  it("keeps approval with the Owner, on the exact file, and never publishes a draft", async () => {
    const wide = await prisma.shortsRender.findUniqueOrThrow({ where: { id: wideId } });
    const sha = wide.checksumSha256!;
    const publish = (id: string) =>
      publishShort(owner, { renderId: id, title: "Test", description: "Test" });

    // An editor's review is not the Owner's approval of the file.
    const reviewed = await reviewRender(editor, wideId, "APPROVED");
    expect([reviewed.status, reviewed.reviewState, reviewed.approvedBy]).toEqual([
      "CLEAN",
      "PENDING_MIKE_REVIEW",
      null,
    ]);
    await expect(publish(wideId)).rejects.toThrow(/fixture/i);

    await expect(approveRenderVersion(editor, wideId, sha.slice(0, 8))).rejects.toThrow(
      /Missing capability/,
    );
    await expect(approveRenderVersion(outsider, wideId, sha.slice(0, 8))).rejects.toThrow(
      /not found/,
    );
    await expect(approveRenderVersion(owner, wideId, "abc")).rejects.toThrow(/first 8 characters/);
    const wrong = (sha[0] === "0" ? "1" : "0") + sha.slice(1, 8);
    await expect(approveRenderVersion(owner, wideId, wrong)).rejects.toThrow(
      /not this file's SHA-256/,
    );
    expect(
      (await prisma.shortsRender.findUniqueOrThrow({ where: { id: wideId } })).reviewState,
    ).toBe("PENDING_MIKE_REVIEW");

    const approved = await approveRenderVersion(owner, wideId, sha.slice(0, 8).toUpperCase());
    expect([approved.reviewState, approved.approvedChecksum, approved.approvedBy]).toEqual([
      "MIKE_APPROVED",
      sha,
      owner.userId,
    ]);
    expect(approved.approvedAt).toBeInstanceOf(Date);
    await expect(approveRenderVersion(owner, wideId, sha.slice(0, 8))).rejects.toThrow(
      /pending the Owner's review/,
    );
    expect(
      await prisma.auditEvent.count({
        where: { action: "shorts.render_owner_approved", entityId: wideId },
      }),
    ).toBe(1);

    // Approved or not, a draft with a synthetic voice or illustrative picture cannot be published.
    await expect(publish(wideId)).rejects.toThrow(/fixture/i);
    await prisma.shortsRender.update({ where: { id: wideId }, data: { isFixture: false } });
    await expect(publish(wideId)).rejects.toThrow(/Illustrative drafts cannot be published/);
    await prisma.shortsRender.update({ where: { id: wideId }, data: { isFixture: true } });

    // An unapproved file stays unpublishable even with every other flag cleared,
    // and a file that changed on disk cannot be approved.
    const tall = await prisma.shortsRender.findUniqueOrThrow({ where: { id: tallId } });
    await prisma.shortsRender.update({
      where: { id: tallId },
      data: { isFixture: false, mediaClass: "GAMEPLAY_CAPTURE", status: "CLEAN" },
    });
    await expect(publish(tallId)).rejects.toThrow(/has not been approved by the Owner/);
    await prisma.shortsRender.update({
      where: { id: tallId },
      data: { isFixture: true, mediaClass: "ILLUSTRATIVE_DRAFT", status: "PENDING" },
    });
    const master = await storage.read(tall.storagePath);
    await storage.write(tall.storagePath, Buffer.concat([master, Buffer.from("tampered")]));
    await expect(
      approveRenderVersion(owner, tallId, tall.checksumSha256!.slice(0, 8)),
    ).rejects.toThrow(/no longer matches its recorded hash/);
    await storage.write(tall.storagePath, master);
    expect(
      await prisma.youTubePublication.count({ where: { workspaceId: owner.workspaceId } }),
    ).toBe(0);
  }, 60_000);

  it("renders a rejected draft again as a new file", async () => {
    const rejected = await reviewRender(editor, tallId, "REJECTED", "test rejection");
    expect([rejected.status, rejected.reviewState]).toEqual(["REJECTED", "REJECTED"]);
    await expect(
      approveRenderVersion(owner, tallId, rejected.checksumSha256!.slice(0, 8)),
    ).rejects.toThrow(/pending the Owner's review/);
    const fresh = await renderShort(owner, voId, ATTR, "9:16");
    expect(fresh.id).not.toBe(tallId);
    expect([fresh.reviewState, fresh.status]).toEqual(["PENDING_MIKE_REVIEW", "PENDING"]);
    expect(await renders(voId, "9:16")).toBe(2);
  }, 120_000);
});

describe("each kind of draft is labelled for what it is, and none can be published", () => {
  it("an operator's own capture with the system voice: 'synthetic voice', not 'fixture'", async () => {
    await makeFixture(FIXTURES[0]!, path.join(INGEST, "own.mp4"), 0.25);
    const content = await createContent(editor, {
      type: "SHORT",
      pillar: "BRIEFING",
      workingTitle: "Owned capture test",
    });
    // A synthetic clip filed as an owned capture ONLY so this path can be exercised.
    const cap = await submitCapture(producer, {
      contentId: content.id,
      platform: "PlayStation 5",
      gameVersion: "1.00",
      targetsShorts: true,
      fileReference: "own.mp4",
    });
    await reviewCapture(editor, { captureId: cap.id, decision: "APPROVED" });
    await attachCaptureMedia(producer, {
      captureSessionId: cap.id,
      fileName: "own.mp4",
      operator: "Test Operator",
      captureMethod: "PS5_NATIVE_USB",
      sourceDevice: "PS5 (test label)",
      rightsStatus: "OWNED_ORIGINAL_CAPTURE",
    });
    await analyzeHighlights(editor, cap.id);
    const cut = await prisma.highlightCandidate.findFirstOrThrow({
      where: { captureSessionId: cap.id },
      orderBy: { rank: "asc" },
    });
    await reviewHighlight(editor, { candidateId: cut.id, decision: "APPROVED" });
    const script = await draftShortsScript(owner, cap.id, {
      highlightCandidateId: cut.id,
      hookText: "A short test line.",
      lines: ["It has one more sentence."],
    });
    const vo = await synthesizeVoiceover(owner, script.id, "default");
    const r = await renderShort(owner, vo.id, ATTR, "9:16");
    expect([r.mediaClass, r.isFixture, r.reviewState]).toEqual([
      "GAMEPLAY_CAPTURE",
      true,
      "PENDING_MIKE_REVIEW",
    ]);
    expect((r.manifestJson as { burnedLabel: string }).burnedLabel).toBe(
      "INTERNAL DRAFT - SYNTHETIC VOICE - NOT FOR PUBLICATION",
    );
    await reviewRender(editor, r.id, "APPROVED");
    await approveRenderVersion(owner, r.id, r.checksumSha256!.slice(0, 8));
    await expect(
      publishShort(owner, { renderId: r.id, title: "Test", description: "Test" }),
    ).rejects.toThrow(/fixture/i);
  }, 240_000);

  it("illustrative graphics with a recorded voice: aligned captions, labelled, still not publishable", async () => {
    // A stand-in "recording": the same lines spoken at another rate with uneven pauses.
    const parts: string[] = [];
    const pauses = [0.3, 1.6, 0.6];
    for (const [i, line] of SPOKEN.entries()) {
      const raw = path.join(INGEST, `r${i}.aiff`);
      await run("say", ["-r", "160", "-o", raw, "--", line]);
      parts.push(
        `anullsrc=r=48000:cl=mono,atrim=0:${pauses[i]}[s${i}];[${i}:a]aresample=48000[p${i}]`,
      );
    }
    await ffmpeg([
      ...SPOKEN.flatMap((_, i) => ["-i", path.join(INGEST, `r${i}.aiff`)]),
      "-filter_complex",
      `${parts.join(";")};${SPOKEN.map((_, i) => `[s${i}][p${i}]`).join("")}concat=n=6:v=0:a=1[o]`,
      "-map",
      "[o]",
      path.join(INGEST, "narration.wav"),
    ]);
    for (const i of [0, 1, 2]) await rm(path.join(INGEST, `r${i}.aiff`));

    const { session } = await explainer("Recorded narration explainer test");
    const script = await draftShortsScript(owner, session.id, { hookText: HOOK, lines: LINES });
    process.env.TTS_PROVIDER = "operator-recording";
    let vo;
    try {
      vo = await synthesizeVoiceover(owner, script.id, "narration.wav");
    } finally {
      process.env.TTS_PROVIDER = ENV.TTS_PROVIDER;
    }
    expect([vo.isSynthetic, vo.isFixture]).toEqual([false, false]);
    expect(vo.voiceName).toBe('Recording "narration.wav"');
    const nqa = vo.qaJson as { passed: boolean; measurements: { cueTiming: string } };
    expect(nqa.passed).toBe(true);
    expect(nqa.measurements.cueTiming).toBe(HAS_MODEL ? "TRANSCRIPT_ALIGNED" : "APPROXIMATE");

    const r = await renderShort(owner, vo.id, ATTR, "16:9");
    expect([r.mediaClass, r.isFixture, r.reviewState]).toEqual([
      "ILLUSTRATIVE_DRAFT",
      false,
      "PENDING_MIKE_REVIEW",
    ]);
    expect((r.manifestJson as { burnedLabel: string }).burnedLabel).toBe(
      "INTERNAL DRAFT - ILLUSTRATIVE GRAPHICS - NOT GAMEPLAY - NOT FOR PUBLICATION",
    );
    await reviewRender(editor, r.id, "APPROVED");
    await approveRenderVersion(owner, r.id, r.checksumSha256!.slice(0, 8));
    await expect(
      publishShort(owner, { renderId: r.id, title: "Test", description: "Test" }),
    ).rejects.toThrow(/Illustrative drafts cannot be published/);
    await writeFile(path.join(INGEST, ".done"), "");
  }, 240_000);
});
