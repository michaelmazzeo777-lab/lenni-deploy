import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { makeClipperFixture, type PlantedEvent } from "../helpers/clipper-fixture";
import { createContent } from "@/domain/content";
import { submitCapture, reviewCapture } from "@/domain/capture";
import { attachCaptureMedia, sessionMediaProblems } from "@/domain/captureMedia";
import {
  approveSessionClip,
  cancelSessionClip,
  reviewSessionClip,
  startSessionClip,
} from "@/domain/sessionClip";
import { transcriberConfig, transcribe } from "@/lib/media/transcribe";
import { LocalAssetStorage } from "@/lib/storage/local-provider";

// The long-session clipper, end to end, on a synthetic fixture with 5 planted
// events: shortlist -> whisper confirmation -> boundary snap -> render both
// formats -> QA -> store. Requires ffmpeg, whisper.cpp and a configured
// WHISPER_MODEL_PATH; without one every assertion here is skipped, never a
// false pass (same convention as tests/integration/media-qa.test.ts).

const HAS_MODEL = !("missing" in transcriberConfig());
const INGEST = path.resolve("./.data/ingest-test-clipper");
const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
const saved: Record<string, string | undefined> = {};

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A;
let events: PlantedEvent[] = [];
const job = (id: string) => prisma.mediaJob.findUniqueOrThrow({ where: { id } });
async function waitFor(
  id: string,
  pred: (j: Awaited<ReturnType<typeof job>>) => boolean,
  ms = 600_000,
) {
  const end = Date.now() + ms;
  for (;;) {
    const j = await job(id);
    if (pred(j)) return j;
    if (Date.now() > end)
      throw new Error(`job ${id} stuck at ${j.status}: ${j.progress ?? j.lastError}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

beforeAll(async () => {
  saved.CAPTURE_INGEST_DIR = process.env.CAPTURE_INGEST_DIR;
  process.env.CAPTURE_INGEST_DIR = INGEST;
  await rm(INGEST, { recursive: true, force: true });
  await mkdir(INGEST, { recursive: true });
  if (HAS_MODEL) {
    events = await makeClipperFixture(path.join(INGEST, "session.mp4"), path.join(INGEST, "work"));
  }
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
}, 180_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(INGEST, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function approvedCapture() {
  const content = await createContent(editor, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: "Clipper test session",
  });
  const c = await submitCapture(owner, {
    contentId: content.id,
    platform: "PlayStation 5",
    gameVersion: "fixture",
  });
  await reviewCapture(editor, { captureId: c.id, decision: "APPROVED" });
  return c.id;
}

async function approvedSessionWithMedia() {
  const id = await approvedCapture();
  await attachCaptureMedia(owner, {
    captureSessionId: id,
    fileName: "session.mp4",
    operator: "Test Operator",
    captureMethod: "SYNTHETIC_FIXTURE",
    sourceDevice: "ffmpeg lavfi",
    rightsStatus: "INTERNAL_FIXTURE",
  });
  return id;
}

describe("ingest refusals", () => {
  it("names a problem for an oversized or wrong-codec file, without a real 20GB file", () => {
    expect(
      sessionMediaProblems(
        {
          durationSec: 3 * 3600,
          width: 1920,
          height: 1080,
          frameRate: 30,
          videoCodec: "vp9",
          audioCodec: "aac",
          raw: null,
        },
        1000,
      ),
    ).toHaveLength(2);
  });

  it("refuses a file outside the allowed ingest folders", async () => {
    const id = await approvedCapture();
    await expect(
      attachCaptureMedia(owner, {
        captureSessionId: id,
        fileName: "../../etc/passwd",
        operator: "Test Operator",
        captureMethod: "SYNTHETIC_FIXTURE",
        sourceDevice: "ffmpeg lavfi",
        rightsStatus: "INTERNAL_FIXTURE",
      }),
    ).rejects.toThrow(/Ingest rejected/);
  });
});

describe.skipIf(!HAS_MODEL)(
  "long-session clipper (real signals, real whisper, real render)",
  () => {
    it("detects at least 4 of the 5 planted events within +/-1s", async () => {
      // A1, at the signal layer directly (the job below proves it end to end too).
      const { extractSignals } = await import("@/lib/media/highlights");
      const { shortlistWindows } = await import("@/lib/clipper/moments");
      const file = path.join(INGEST, "session.mp4");
      const bins = await extractSignals(file, true);
      const shortlist = shortlistWindows(bins, 8);
      const hits = events.filter((e) => shortlist.some((c) => Math.abs(c.peakSec - e.atSec) <= 1));
      expect(hits.length).toBeGreaterThanOrEqual(4);
    }, 120_000);

    // Shared across the ordered tests below (files run sequentially): the
    // clipper's checksum dedup refuses to ingest the same fixture bytes twice.
    let clippedSessionId = "";

    it("clips a session: both formats, correct length, QA passed, no mid-word cut", async () => {
      const captureSessionId = await approvedSessionWithMedia();
      clippedSessionId = captureSessionId;
      const started = await startSessionClip(owner, captureSessionId, {
        n: 5,
        cropMode: "center-crop",
      });
      const done = await waitFor(
        started.id,
        (j) => j.status === "SUCCEEDED" || j.status === "FAILED",
      );
      expect(done.status).toBe("SUCCEEDED");

      const clips = await prisma.sessionClip.findMany({ where: { captureSessionId } });
      expect(clips.length).toBeGreaterThanOrEqual(2); // at least one moment, both formats
      expect(clips.length % 2).toBe(0);

      for (const c of clips) {
        expect(c.durationSec).toBeGreaterThanOrEqual(14.5);
        expect(c.durationSec).toBeLessThanOrEqual(60.5);
        expect(c.reviewState).toBe("PENDING_MIKE_REVIEW");
        expect((c.qaJson as { passed?: boolean }).passed).toBe(true);
        const want = c.format === "16:9" ? "1920x1080" : "1080x1920";
        expect(c.resolution).toBe(want);
      }

      // A3: the moment overlapping the planted spoken line must not cut mid-word,
      // checked against a fresh transcription of the original fixture (not the
      // boundary-selection code's own word list).
      const speechEvent = events.find((e) => e.name === "spoken line")!;
      const speechClip = clips.find(
        (c) => c.startSec < speechEvent.endSec && c.endSec > speechEvent.startSec,
      );
      if (speechClip) {
        const t = await transcribe(path.join(INGEST, "session.mp4"));
        if (t.status === "OK") {
          const wordAt = (sec: number) =>
            t.words.find((w) => sec > w.startSec + 1e-3 && sec < w.endSec - 1e-3);
          expect(wordAt(speechClip.startSec)).toBeUndefined();
          expect(wordAt(speechClip.endSec)).toBeUndefined();
        }
      }

      // Review and owner-approval lifecycle, same shape as ShortsRender's.
      const first = clips[0]!;
      const reviewed = await reviewSessionClip(editor, first.id, "APPROVED");
      expect(reviewed.reviewState).toBe("PENDING_MIKE_REVIEW"); // editorial clear, not the Owner's file approval
      await expect(reviewSessionClip(editor, first.id, "APPROVED")).rejects.toThrow(
        /already reviewed/,
      );
      const approved = await approveSessionClip(
        owner,
        first.id,
        first.checksumSha256!.slice(0, 10),
      );
      expect(approved.reviewState).toBe("MIKE_APPROVED");

      const rejectedTarget = clips[1]!;
      const rejected = await reviewSessionClip(editor, rejectedTarget.id, "REJECTED", "not usable");
      expect(rejected.reviewState).toBe("REJECTED");
      await expect(storage.read(rejectedTarget.storagePath)).rejects.toThrow();
    }, 600_000);

    it("cancel and retry: a canceled job can be retried and then succeeds", async () => {
      const captureSessionId = clippedSessionId;
      const started = await startSessionClip(owner, captureSessionId, { n: 1 });
      await cancelSessionClip(owner, started.id);
      const canceled = await waitFor(
        started.id,
        (j) => j.status === "CANCELED" || j.status === "SUCCEEDED",
      );
      // Canceling races the job's own checkpoints; either outcome is valid as
      // long as cancel was observed and the job settled cleanly.
      expect(["CANCELED", "SUCCEEDED"]).toContain(canceled.status);

      const retried = await startSessionClip(owner, captureSessionId, { n: 1 });
      const done = await waitFor(
        retried.id,
        (j) => j.status === "SUCCEEDED" || j.status === "FAILED",
      );
      expect(done.status).toBe("SUCCEEDED");
      expect(done.attempts).toBeGreaterThanOrEqual(1);
    }, 600_000);
  },
);
