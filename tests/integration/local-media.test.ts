import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { FIXTURES, makeFixture, truthWindows } from "../helpers/fixtures";
import { createContent } from "@/domain/content";
import { submitCapture, reviewCapture } from "@/domain/capture";
import { attachCaptureMedia, analyzeHighlights, reviewHighlight } from "@/domain/captureMedia";
import {
  draftShortsScript,
  synthesizeVoiceover,
  renderShort,
  reviewRender,
  publishShort,
} from "@/domain/shorts";
import { LocalAssetStorage } from "@/lib/storage/local-provider";
import { meanVolumeDb, probeVideo } from "@/lib/media/ffmpeg";

// Real local pipeline, end to end, on synthetic fixtures: ingest -> highlight
// analysis -> approve/trim -> operator script -> narration -> real MP4 render.
// Requires ffmpeg (with libass) and macOS `say` for the fixture narration.

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A;
const INGEST = path.resolve("./.data/ingest-test");
const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
const ENV = {
  CAPTURE_INGEST_DIR: INGEST,
  SHORTS_SCRIPT_PROVIDER: "local-operator",
  TTS_PROVIDER: "local-say-fixture",
  VIDEO_COMPOSITOR_PROVIDER: "local-ffmpeg",
};
const saved: Record<string, string | undefined> = {};
const [FIX_A, FIX_B] = [FIXTURES[0]!, FIXTURES[1]!];
const SCALE = 0.5;

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  await rm(INGEST, { recursive: true, force: true });
  await mkdir(INGEST, { recursive: true });
  await makeFixture(FIX_A, path.join(INGEST, "a.mp4"), SCALE);
  await makeFixture(FIX_B, path.join(INGEST, "b.mp4"), SCALE);
  await makeFixture(FIXTURES[2]!, path.join(INGEST, "c.mp4"), 0.3);
  await writeFile(path.join(INGEST, "garbage.mp4"), "this is not a video");
  // The mock compositor's ftyp-only placeholder must never pass as real video.
  await writeFile(
    path.join(INGEST, "placeholder.mp4"),
    Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isomiso2mp41"),
    ]),
  );
  await symlink("/etc/hosts", path.join(INGEST, "link.mp4")).catch(() => undefined);

  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
}, 120_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(INGEST, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function capture(opts: { approve?: boolean; music?: boolean } = {}) {
  const content = await createContent(editor, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: "Local media test",
  });
  const c = await submitCapture(owner, {
    contentId: content.id,
    platform: "PlayStation 5",
    gameVersion: "fixture",
    targetsShorts: true,
    containsLicensedMusic: opts.music ?? false,
    fileReference: opts.music ? "music.mp4" : undefined,
  });
  if (opts.approve !== false)
    await reviewCapture(editor, { captureId: c.id, decision: "APPROVED" });
  return c;
}

const fixtureMeta = {
  operator: "Test Operator",
  captureMethod: "SYNTHETIC_FIXTURE" as const,
  sourceDevice: "ffmpeg lavfi",
  rightsStatus: "INTERNAL_FIXTURE" as const,
};

// Shared across the ordered tests below (files run sequentially).
let capA = "";
let cutA = "";
let capB = "";
let cutB = "";

const SCRIPT = {
  hookText: "Internal technical fixture.",
  lines: ["This is synthetic test footage.", "It is not gameplay."],
};

describe("capture media ingest", () => {
  it("rejects traversal, symlinks, non-video and placeholder files", async () => {
    const c = await capture();
    for (const fileName of ["../a.mp4", "link.mp4", "garbage.mp4", "placeholder.mp4", "nope.mp4"]) {
      await expect(
        attachCaptureMedia(owner, { captureSessionId: c.id, fileName, ...fixtureMeta }),
      ).rejects.toThrow(/Ingest rejected/);
    }
    expect(await prisma.captureMedia.count({ where: { captureSessionId: c.id } })).toBe(0);
  });

  it("ingests a real file with provenance and SHA-256, and refuses a duplicate", async () => {
    const c = await capture();
    capA = c.id;
    const media = await attachCaptureMedia(owner, {
      captureSessionId: c.id,
      fileName: "a.mp4",
      ...fixtureMeta,
    });
    const stored = await readFile(storage.absolutePath(media.storagePath));
    expect(createHash("sha256").update(stored).digest("hex")).toBe(media.checksumSha256);
    expect(media.width).toBe(1280);
    expect(media.videoCodec).toBe("h264");
    expect(media.durationSec).toBeGreaterThan(25);

    const other = await capture();
    await expect(
      attachCaptureMedia(owner, { captureSessionId: other.id, fileName: "a.mp4", ...fixtureMeta }),
    ).rejects.toThrow(/already ingested/);
    // A fixture cannot be declared as an owned capture.
    await expect(
      attachCaptureMedia(owner, {
        captureSessionId: other.id,
        fileName: "b.mp4",
        ...fixtureMeta,
        rightsStatus: "OWNED_ORIGINAL_CAPTURE",
      }),
    ).rejects.toThrow(/INTERNAL_FIXTURE/);
  });
});

describe("highlight analysis and review", () => {
  it("ranks real timecodes with reasons; approve/trim persists; unapproved capture refused", async () => {
    const pending = await capture({ approve: false });
    await expect(analyzeHighlights(editor, pending.id)).rejects.toThrow(/APPROVED/);

    const c = await capture();
    capB = c.id;
    await attachCaptureMedia(owner, { captureSessionId: c.id, fileName: "b.mp4", ...fixtureMeta });
    await analyzeHighlights(editor, c.id);
    const cands = await prisma.highlightCandidate.findMany({
      where: { captureSessionId: c.id },
      orderBy: { rank: "asc" },
    });
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const truth = truthWindows(FIX_B).map((w) => ({
      startSec: w.startSec * SCALE,
      endSec: w.endSec * SCALE,
    }));
    for (const cand of cands.slice(0, 2)) {
      expect(truth.some((w) => cand.peakSec >= w.startSec && cand.peakSec <= w.endSec)).toBe(true);
      expect((cand.signalsJson as { reasons: string[] }).reasons.length).toBeGreaterThan(0);
      expect(await storage.exists(cand.thumbnailPath!)).toBe(true);
    }
    // The loud still "menu" at the start is never a candidate.
    expect(cands.every((cand) => cand.peakSec > 8 * SCALE)).toBe(true);

    const first = cands[0]!;
    cutB = first.id;
    await reviewHighlight(editor, {
      candidateId: first.id,
      decision: "APPROVED",
      trimStartSec: first.startSec + 1,
      trimEndSec: first.endSec,
    });
    await reviewHighlight(editor, {
      candidateId: cands[1]!.id,
      decision: "REJECTED",
      notes: "dull",
    });
    const reread = await prisma.highlightCandidate.findUniqueOrThrow({ where: { id: first.id } });
    expect(reread.status).toBe("APPROVED");
    expect(reread.trimStartSec).toBe(first.startSec + 1);

    // Rejected footage never reaches a script, let alone a master.
    await expect(
      draftShortsScript(owner, c.id, { highlightCandidateId: cands[1]!.id, ...SCRIPT }),
    ).rejects.toThrow(/APPROVED highlight cut/);
    await expect(
      reviewHighlight(editor, { candidateId: first.id, decision: "APPROVED", trimEndSec: 9999 }),
    ).rejects.toThrow(/Trim range/);
  });
});

describe("real local render", () => {
  it("blocks uncleared rights, licensed music, leak references and empty scripts", async () => {
    await analyzeHighlights(editor, capA);
    const top = await prisma.highlightCandidate.findFirstOrThrow({
      where: { captureSessionId: capA },
      orderBy: { rank: "asc" },
    });
    await reviewHighlight(editor, { candidateId: top.id, decision: "APPROVED" });
    cutA = top.id;
    const [captureId, cutId] = [capA, cutA];
    await expect(
      draftShortsScript(owner, captureId, { highlightCandidateId: cutId }),
    ).rejects.toThrow(/hook and at least one script line/);
    const quarantined = await draftShortsScript(owner, captureId, {
      highlightCandidateId: cutId,
      hookText: "Leaked footage shows this.",
      lines: ["Nope."],
    });
    expect(quarantined.status).toBe("QUARANTINED");
    await expect(synthesizeVoiceover(owner, quarantined.id, "default")).rejects.toThrow(/VALID/);

    await prisma.captureMedia.update({
      where: { captureSessionId: captureId },
      data: { rightsStatus: "UNCLEARED" },
    });
    await expect(
      draftShortsScript(owner, captureId, { highlightCandidateId: cutId, ...SCRIPT }),
    ).rejects.toThrow(/UNCLEARED/);
    await prisma.captureMedia.update({
      where: { captureSessionId: captureId },
      data: { rightsStatus: "INTERNAL_FIXTURE" },
    });

    const music = await capture({ music: true });
    await expect(draftShortsScript(owner, music.id, SCRIPT)).rejects.toThrow(/licensed music/);
  });

  it("renders two distinct playable 9:16 masters and a 16:9, with bundle; fixtures never publish", async () => {
    const b = { captureId: capB, cutId: cutB };
    const renders = [];
    for (const [captureId, cutId] of [
      [capA, cutA],
      [capB, cutB],
    ] as const) {
      const script = await draftShortsScript(owner, captureId, {
        highlightCandidateId: cutId,
        ...SCRIPT,
      });
      expect(script.status).toBe("VALID");
      expect(script.provider).toBe("local-operator");
      const vo = await synthesizeVoiceover(owner, script.id, "default");
      expect(vo.isFixture).toBe(true);
      expect(await meanVolumeDb(storage.absolutePath(vo.assetPath))).toBeGreaterThan(-45);
      renders.push({ vo, render: await renderShort(owner, vo.id, "Leonida Field Guide (test)") });
    }

    for (const { render } of renders) {
      const file = storage.absolutePath(render.storagePath);
      const probe = await probeVideo(file);
      expect([probe.width, probe.height]).toEqual([1080, 1920]);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.audioCodec).toBe("aac");
      expect(probe.durationSec).toBeGreaterThan(3);
      expect(await meanVolumeDb(file)).toBeGreaterThan(-45);
      expect(render.isFixture).toBe(true);
      const bytes = await readFile(file);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(render.checksumSha256);
      const dir = path.dirname(render.storagePath);
      const srt = (await storage.read(`${dir}/captions.srt`)).toString();
      expect(srt).toMatch(/00:00:0\d,\d{3} --> 00:00:\d\d,\d{3}\nInternal technical fixture\./);
      for (const f of ["transcript.txt", "cover.jpg", "manifest.json", "bundle.zip"]) {
        expect(await storage.exists(`${dir}/${f}`)).toBe(true);
      }
      const manifest = render.manifestJson as {
        publication: string;
        source: { sha256: string; rightsStatus: string };
        edl: { sourceInSec: number; sourceOutSec: number }[];
      };
      expect(manifest.publication).toBe("PUBLICATION_BLOCKED");
      expect(manifest.source.rightsStatus).toBe("INTERNAL_FIXTURE");
      expect(manifest.edl[0]!.sourceOutSec).toBeGreaterThan(manifest.edl[0]!.sourceInSec);
    }
    expect(renders[0]!.render.checksumSha256).not.toBe(renders[1]!.render.checksumSha256);

    // 16:9 path from the same narration.
    const wide = await renderShort(owner, renders[0]!.vo.id, "Leonida Field Guide (test)", "16:9");
    const wideProbe = await probeVideo(storage.absolutePath(wide.storagePath));
    expect([wideProbe.width, wideProbe.height]).toEqual([1920, 1080]);
    expect(wide.format).toBe("16:9");

    // Human approval does not make a fixture publishable.
    await reviewRender(editor, renders[0]!.render.id, "APPROVED");
    await expect(
      publishShort(owner, { renderId: renders[0]!.render.id, title: "Nope", description: "Nope" }),
    ).rejects.toThrow(/fixture/i);

    // A cut rejected after scripting, or a missing source file, fails the render
    // cleanly and records nothing.
    const before = await prisma.shortsRender.count({ where: { workspaceId: owner.workspaceId } });
    await prisma.highlightCandidate.update({
      where: { id: b.cutId },
      data: { status: "REJECTED" },
    });
    await expect(renderShort(owner, renders[1]!.vo.id, "x")).rejects.toThrow(/not APPROVED/);
    await prisma.highlightCandidate.update({
      where: { id: b.cutId },
      data: { status: "APPROVED" },
    });
    const mediaB = await prisma.captureMedia.findUniqueOrThrow({
      where: { captureSessionId: b.captureId },
    });
    await storage.remove(mediaB.storagePath);
    await expect(renderShort(owner, renders[1]!.vo.id, "x")).rejects.toThrow(/Render failed/);
    expect(await prisma.shortsRender.count({ where: { workspaceId: owner.workspaceId } })).toBe(
      before,
    );
  }, 180_000);

  it("refuses a silent mock narration for a real render", async () => {
    const c = await capture();
    await attachCaptureMedia(owner, { captureSessionId: c.id, fileName: "c.mp4", ...fixtureMeta });
    await analyzeHighlights(editor, c.id);
    const cut = await prisma.highlightCandidate.findFirstOrThrow({
      where: { captureSessionId: c.id },
      orderBy: { rank: "asc" },
    });
    await reviewHighlight(editor, { candidateId: cut.id, decision: "APPROVED" });
    const script = await draftShortsScript(owner, c.id, {
      highlightCandidateId: cut.id,
      ...SCRIPT,
    });
    process.env.TTS_PROVIDER = "mock";
    const vo = await synthesizeVoiceover(owner, script.id, "default");
    process.env.TTS_PROVIDER = ENV.TTS_PROVIDER;
    await expect(renderShort(owner, vo.id, "x")).rejects.toThrow(/mock voiceover is silent/);
  }, 60_000);
});
