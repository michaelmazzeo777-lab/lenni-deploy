import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createContent } from "@/domain/content";
import { createSource, createClaim, linkClaimToContent } from "@/domain/evidence";
import { startGraphicsSession } from "@/domain/capture";
import {
  approveRenderVersion,
  draftShortsScript,
  publishShort,
  reviewRender,
  synthesizeVoiceover,
} from "@/domain/shorts";
import {
  cancelPremiumRender,
  recoverInterruptedJobs,
  startPremiumRender,
} from "@/domain/premiumRender";
import { resolveMediaTarget } from "@/domain/mediaAccess";
import { LocalAssetStorage } from "@/lib/storage/local-provider";
import { probeVideo } from "@/lib/media/ffmpeg";
import { engineProblems, workRoot } from "@/lib/premium/engine";

// The premium path end to end against the real engine (Python, ffmpeg, system
// voice): a Studio explainer becomes two rendered formats through a background
// job that can be watched, canceled, retried and recovered after a restart.

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, producer: A, outsider: A;
const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
const ENV = {
  SHORTS_SCRIPT_PROVIDER: "local-operator",
  TTS_PROVIDER: "local-say-fixture",
  VIDEO_COMPOSITOR_PROVIDER: "local-ffmpeg",
};
const saved: Record<string, string | undefined> = {};
const READY = engineProblems().length === 0;

async function explainer(title: string, hook: string, lines: string[]) {
  const content = await createContent(editor, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: title,
  });
  const session = await startGraphicsSession(producer, content.id);
  const source = await createSource(owner, {
    title: `Official page for ${title}`,
    publisher: "Test Publisher",
    sourceClass: "OFFICIAL_SOURCE",
    sourceType: "official-page",
    url: "https://example.test/page",
  });
  const claim = await createClaim(owner, {
    statement: `${title}: the page states the facts shown.`,
    classification: "CONFIRMED",
    sourceIds: [source.id],
  });
  await linkClaimToContent(owner, content.id, claim.id);
  const script = await draftShortsScript(owner, session.id, { hookText: hook, lines });
  const vo = await synthesizeVoiceover(owner, script.id, "default");
  return { content, script, vo, claim };
}
const job = (id: string) => prisma.mediaJob.findUniqueOrThrow({ where: { id } });
async function waitFor(
  id: string,
  pred: (j: Awaited<ReturnType<typeof job>>) => boolean,
  ms = 300_000,
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
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let a: Awaited<ReturnType<typeof explainer>>;
let b: Awaited<ReturnType<typeof explainer>>;

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  producer = await ws.actor([Role.PRODUCER], "producer");
  outsider = await (await makeWorkspace()).actor([Role.OWNER], "outsider");
  a = await explainer(
    "Harbor ferry timetable",
    "The harbor ferry now runs every twenty minutes from the north pier. || NEW TIMETABLE :: EVERY TWENTY MINUTES :: From the north pier",
    [
      "The first boat leaves at six in the morning, and the last one at midnight. || OPERATING HOURS :: SIX TO MIDNIGHT :: First and last departures",
      "Tickets are sold at the pier, and children under five travel free of charge. || TICKETS :: SOLD AT THE PIER :: Under fives travel free",
    ],
  );
  b = await explainer(
    "Mountain trail conditions",
    "Four trails on the east ridge reopened this week after the spring repairs. || TRAIL REPORT :: FOUR TRAILS REOPENED :: East ridge, after repairs",
    [
      "The summit path stays closed, because the upper bridge is still being rebuilt. || STILL CLOSED :: SUMMIT PATH :: Upper bridge under repair",
      "Rangers ask every visitor to sign the logbook at the lower gate before starting. || BEFORE YOU START :: $(touch PWNED) `id` :: Sign the logbook at the gate",
      "Weather on the ridge changes quickly, so carry water, layers, and a paper map. || BE PREPARED :: WATER, LAYERS, MAP :: Weather changes quickly",
    ],
  );
}, 240_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await prisma.$disconnect();
});

describe.skipIf(!READY)("premium render job", () => {
  let jobA = "";
  it("starts in the background, reports progress, refuses a duplicate, and can be canceled", async () => {
    await expect(startPremiumRender(outsider, a.vo.id)).rejects.toThrow(/not found/i);
    const started = await startPremiumRender(editor, a.vo.id);
    jobA = started.id;
    expect([started.status, started.kind, started.attempts]).toEqual([
      "RUNNING",
      "PREMIUM_RENDER",
      1,
    ]);
    const rendering = await waitFor(
      jobA,
      (j) => /Rendering picture/.test(j.progress ?? "") && j.pid !== null,
      120_000,
    );
    expect(rendering.status).toBe("RUNNING");
    expect(rendering.heartbeatAt!.getTime()).toBeGreaterThan(Date.now() - 15_000);
    await expect(startPremiumRender(editor, a.vo.id)).rejects.toThrow(/already running/);
    const pid = rendering.pid!;
    expect(alive(pid)).toBe(true);
    await cancelPremiumRender(editor, jobA);
    const canceled = await waitFor(jobA, (j) => j.status !== "RUNNING", 30_000);
    expect([canceled.status, canceled.lastError]).toEqual(["CANCELED", "Canceled by the operator"]);
    await new Promise((r) => setTimeout(r, 500));
    expect(alive(pid)).toBe(false); // the whole engine process group is gone
    expect(existsSync(path.join(workRoot(), jobA))).toBe(false); // and so is its work folder
    expect(await prisma.shortsRender.count({ where: { voiceoverId: a.vo.id } })).toBe(0);
    await expect(cancelPremiumRender(editor, jobA)).rejects.toThrow(/Only a running job/);
  }, 200_000);

  it("retries a canceled job to two checked, playable masters left pending the Owner's review", async () => {
    const again = await startPremiumRender(editor, a.vo.id);
    expect([again.id, again.attempts]).toEqual([jobA, 2]);
    const done = await waitFor(jobA, (j) => j.status !== "RUNNING");
    expect([done.status, done.lastError]).toEqual(["SUCCEEDED", null]);
    const renders = await prisma.shortsRender.findMany({
      where: { voiceoverId: a.vo.id },
      orderBy: { format: "asc" },
    });
    expect(
      renders.map((r) => [
        r.format,
        r.resolution,
        r.reviewState,
        r.mediaClass,
        r.status,
        r.isFixture,
        r.approvedBy,
      ]),
    ).toEqual([
      ["16:9", "1920x1080", "PENDING_MIKE_REVIEW", "ILLUSTRATIVE_DRAFT", "PENDING", true, null],
      ["9:16", "1080x1920", "PENDING_MIKE_REVIEW", "ILLUSTRATIVE_DRAFT", "PENDING", true, null],
    ]);
    for (const r of renders) {
      const probe = await probeVideo(storage.absolutePath(r.storagePath));
      expect([probe.videoCodec, probe.audioCodec, `${probe.width}x${probe.height}`]).toEqual([
        "h264",
        "aac",
        r.resolution,
      ]);
      expect(Math.abs(probe.durationSec - r.durationSec)).toBeLessThan(0.2);
      const qa = r.qaJson as {
        passed: boolean;
        checks: { name: string; status: string }[];
        measurements: { loudness: { integratedLufs: number; truePeakDb: number } };
        humanValidation: string[];
      };
      expect(qa.passed).toBe(true);
      expect(qa.checks.filter((c) => c.status === "FAIL")).toEqual([]);
      expect(qa.checks.map((c) => c.name)).toEqual(
        expect.arrayContaining([
          "full decode",
          "loudness",
          "true peak",
          "black frames",
          "burned captions follow the caption file",
          "caption starts vs measured speech onset",
        ]),
      );
      expect(Math.abs(qa.measurements.loudness.integratedLufs + 16)).toBeLessThanOrEqual(0.5);
      expect(qa.measurements.loudness.truePeakDb).toBeLessThanOrEqual(-1);
      expect(qa.humanValidation.join(" ")).toMatch(/Listen to the narration/);
      const m = r.manifestJson as {
        renderer: string;
        publication: string;
        evidence: { statement: string; sources: { url: string }[] }[];
        assets: { rights: string }[];
        episode: { beats: { picture: { title: string[] } }[] };
      };
      expect([m.renderer, m.publication]).toEqual(["premium-engine", "PUBLICATION_BLOCKED"]);
      expect(m.evidence[0]!.statement).toMatch(/Harbor ferry timetable/);
      expect(m.evidence[0]!.sources[0]!.url).toBe("https://example.test/page");
      expect(m.assets.some((x) => /OPEN/.test(x.rights))).toBe(true);
      // every stored file is reachable only by a member of the workspace
      expect((await resolveMediaTarget(editor, "render", r.id))?.path).toBe(r.storagePath);
      expect(await resolveMediaTarget(outsider, "render", r.id)).toBeNull();
      const srt = (await storage.read(`${path.dirname(r.storagePath)}/captions.srt`)).toString();
      expect(srt).toMatch(/The harbor ferry now runs/);
    }
    expect(existsSync(path.join(workRoot(), jobA))).toBe(false);
  }, 400_000);

  it("returns the finished job for the same request and makes nothing new", async () => {
    const same = await startPremiumRender(editor, a.vo.id);
    expect([same.id, same.status, same.attempts]).toEqual([jobA, "SUCCEEDED", 2]);
    expect(await prisma.shortsRender.count({ where: { voiceoverId: a.vo.id } })).toBe(2);
  });

  it("keeps approval with the Owner on the exact file, records a revision request, and never publishes", async () => {
    const [wide, tall] = await prisma.shortsRender.findMany({
      where: { voiceoverId: a.vo.id },
      orderBy: { format: "asc" },
    });
    await expect(
      approveRenderVersion(editor, wide!.id, wide!.checksumSha256!.slice(0, 8)),
    ).rejects.toThrow();
    await expect(approveRenderVersion(owner, wide!.id, "00000000")).rejects.toThrow(/SHA-256/);
    const ok = await approveRenderVersion(owner, wide!.id, wide!.checksumSha256!.slice(0, 8));
    expect([ok.reviewState, ok.approvedChecksum]).toEqual(["MIKE_APPROVED", wide!.checksumSha256]);
    await expect(
      publishShort(owner, { renderId: wide!.id, title: "x", description: "y" }),
    ).rejects.toThrow();
    const rejected = await reviewRender(
      editor,
      tall!.id,
      "REJECTED",
      "Revision: the pacing is too fast",
    );
    expect([rejected.status, rejected.reviewState, rejected.reviewNotes]).toEqual([
      "REJECTED",
      "REJECTED",
      "Revision: the pacing is too fast",
    ]);
    expect(await resolveMediaTarget(owner, "render", tall!.id)).toBeNull(); // a rejected file is no longer served
  }, 60_000);

  let jobB = "";
  it("recovers a job whose process died with the Studio, then runs it again", async () => {
    const started = await startPremiumRender(editor, b.vo.id);
    jobB = started.id;
    await cancelPremiumRender(editor, jobB);
    await waitFor(jobB, (j) => j.status === "CANCELED", 30_000);
    // Simulate a crash: the row says RUNNING, the heartbeat is old, and an engine process was left behind.
    const orphan = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 300000)", path.join(workRoot(), jobB)],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    orphan.unref();
    await prisma.mediaJob.update({
      where: { id: jobB },
      data: {
        status: "RUNNING",
        heartbeatAt: new Date(Date.now() - 120_000),
        cancelRequestedAt: null,
        pid: orphan.pid!,
        progress: "Rendering picture",
      },
    });
    expect(await recoverInterruptedJobs(editor.workspaceId)).toBe(1);
    const recovered = await job(jobB);
    expect(recovered.status).toBe("FAILED");
    expect(recovered.lastError).toMatch(/Interrupted: the Studio stopped/);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(orphan.pid!)).toBe(false);
    const retried = await startPremiumRender(editor, b.vo.id);
    expect(retried.attempts).toBe(2);
    const done = await waitFor(jobB, (j) => j.status !== "RUNNING");
    expect(done.status).toBe("SUCCEEDED");
  }, 400_000);

  it("renders a second, different episode differently, and treats card text as text", async () => {
    const ra = await prisma.shortsRender.findMany({
      where: { voiceoverId: a.vo.id },
      orderBy: { format: "asc" },
    });
    const rb = await prisma.shortsRender.findMany({
      where: { voiceoverId: b.vo.id, status: { not: "REJECTED" } },
      orderBy: { format: "asc" },
    });
    expect(rb.map((r) => r.format)).toEqual(["16:9", "9:16"]);
    type M = {
      episode: {
        id: string;
        title: string;
        beats: { phrases: string[]; picture: { title: string[]; eyebrow: string } }[];
      };
    };
    const ma = ra[0]!.manifestJson as M,
      mb = rb[0]!.manifestJson as M;
    expect([ma.episode.beats.length, mb.episode.beats.length]).toEqual([3, 4]);
    expect(ma.episode.title).toBe("Harbor ferry timetable");
    expect(mb.episode.title).toBe("Mountain trail conditions");
    expect(mb.episode.beats[0]!.picture.eyebrow).toBe("TRAIL REPORT");
    expect(mb.episode.beats[2]!.picture.title.join(" ")).toBe("$(TOUCH PWNED) `ID`"); // drawn as text
    expect(rb[0]!.checksumSha256).not.toBe(ra[0]!.checksumSha256);
    expect(Math.abs(rb[0]!.durationSec - ra[0]!.durationSec)).toBeGreaterThan(1);
    const srt = (await storage.read(`${path.dirname(rb[0]!.storagePath)}/captions.srt`)).toString();
    expect(srt).toMatch(/Four trails on the east ridge/);
    expect(srt).not.toMatch(/harbor ferry/i);
    // the picture really differs: the same moment of each film is not the same image
    const frame = async (p: string) => {
      const { execFileSync } = await import("node:child_process");
      return execFileSync("ffmpeg", [
        "-v",
        "error",
        "-ss",
        "2",
        "-i",
        storage.absolutePath(p),
        "-frames:v",
        "1",
        "-vf",
        "scale=64:36,format=gray",
        "-f",
        "rawvideo",
        "-",
      ]);
    };
    const fa = await frame(ra[0]!.storagePath),
      fb = await frame(rb[0]!.storagePath);
    const diff = fa.reduce((s, v, i) => s + Math.abs(v - fb[i]!), 0) / fa.length;
    expect(diff).toBeGreaterThan(4);
    // nothing in the card text was executed
    for (const dir of [process.cwd(), workRoot(), path.resolve("premium-engine")])
      expect(existsSync(path.join(dir, "PWNED"))).toBe(false);
  }, 60_000);

  it("records a failure the operator can read when a scene is too short, and keeps it failed on retry", async () => {
    const c = await explainer(
      "Too short for a scene",
      "This opening line is long enough to hold a title on screen for a while. || OPENING :: LONG ENOUGH :: Holds the title",
      [
        "Too short. || SHORT :: TOO SHORT :: Not enough time",
        "This closing line is also long enough to hold its title on the screen. || CLOSING :: LONG ENOUGH :: Holds the title",
      ],
    );
    const j1 = await startPremiumRender(editor, c.vo.id);
    const failed = await waitFor(j1.id, (j) => j.status !== "RUNNING", 120_000);
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toMatch(/B02 lasts \d\.\ds; scenes need at least 3/);
    expect(await prisma.shortsRender.count({ where: { voiceoverId: c.vo.id } })).toBe(0);
    await startPremiumRender(editor, c.vo.id);
    const again = await waitFor(j1.id, (j) => j.status !== "RUNNING", 120_000);
    expect([again.status, again.attempts]).toEqual(["FAILED", 2]);
    const audits = await prisma.auditEvent.count({
      where: { entityId: j1.id, action: "media.job_failed" },
    });
    expect(audits).toBe(2);
  }, 300_000);

  it("refuses footage sessions, a missing engine, and people without the right role", async () => {
    const reader = await (await makeWorkspace()).actor([Role.READ_ONLY], "reader");
    await expect(startPremiumRender(reader, a.vo.id)).rejects.toThrow();
    const keep = process.env.PREMIUM_PYTHON;
    process.env.PREMIUM_PYTHON = "/nonexistent/python";
    try {
      await expect(startPremiumRender(editor, a.vo.id)).rejects.toThrow(
        /premium engine is not ready/,
      );
    } finally {
      if (keep === undefined) delete process.env.PREMIUM_PYTHON;
      else process.env.PREMIUM_PYTHON = keep;
    }
    expect(
      JSON.stringify(await readFile(path.resolve("premium-engine/PROVENANCE.md"), "utf8")),
    ).toMatch(/RIGHTS OPEN/);
  });
});
