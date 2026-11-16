import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { FIXTURES, makeFixture } from "../helpers/fixtures";
import { createContent } from "@/domain/content";
import { submitCapture, reviewCapture } from "@/domain/capture";
import { attachCaptureMedia } from "@/domain/captureMedia";
import { createSource, createClaim } from "@/domain/evidence";
import { markSourceStale } from "@/domain/updates";
import { assessObservedInGameEvidence } from "@/domain/gameplayEvidence";
import { checkProductionPacket, parseProductionPacket } from "@/domain/productionPacket";

// Claim-evidence eligibility and the production-packet check, against real
// Studio records. The "owned capture" below is a synthetic clip labelled as an
// owned capture only so the positive path can be exercised; it is not gameplay.

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, producer: A, readOnly: A, outsider: A;
const INGEST = path.resolve("./.data/ingest-final-test");
let savedIngest: string | undefined;

beforeAll(async () => {
  savedIngest = process.env.CAPTURE_INGEST_DIR;
  process.env.CAPTURE_INGEST_DIR = INGEST;
  await rm(INGEST, { recursive: true, force: true });
  await mkdir(INGEST, { recursive: true });
  await makeFixture(FIXTURES[0]!, path.join(INGEST, "own.mp4"), 0.12);
  await makeFixture(FIXTURES[1]!, path.join(INGEST, "fix.mp4"), 0.12);
  await makeFixture(FIXTURES[2]!, path.join(INGEST, "fx2.mp4"), 0.12);
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  producer = await ws.actor([Role.PRODUCER], "producer");
  readOnly = await ws.actor([Role.READ_ONLY], "ro");
  outsider = await (await makeWorkspace()).actor([Role.OWNER], "other");
}, 60_000);

afterAll(async () => {
  if (savedIngest === undefined) delete process.env.CAPTURE_INGEST_DIR;
  else process.env.CAPTURE_INGEST_DIR = savedIngest;
  await rm(INGEST, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function submit(over: Record<string, unknown> = {}) {
  const content = await createContent(editor, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: "Evidence test",
  });
  return submitCapture(producer, {
    contentId: content.id,
    platform: "PlayStation 5",
    gameVersion: "1.00",
    settings: "Performance mode, default HUD",
    testConditions: "Three timed runs, same route",
    ...over,
  });
}
const owned = {
  operator: "Test Operator",
  gameMode: "Story",
  captureMethod: "PS5_NATIVE_USB" as const,
  sourceDevice: "PS5 (test label)",
  rightsStatus: "OWNED_ORIGINAL_CAPTURE" as const,
};

describe("OBSERVED_IN_GAME eligibility is read from Studio records", () => {
  it("is not eligible until a different, real reviewer approves a hashed, owned, fully described capture", async () => {
    const c = await submit();
    let f = await assessObservedInGameEvidence(editor, c.id);
    expect(f.eligible).toBe(false);
    expect(f.supports).toBe("UNKNOWN");
    expect(f.evidence).toBeNull();
    expect(f.missing).toEqual(
      expect.arrayContaining([
        "capture review decision is not APPROVED",
        "no active reviewer account is recorded on the capture",
        "no ingested video file (and therefore no file hash) is attached",
      ]),
    );

    await reviewCapture(editor, { captureId: c.id, decision: "APPROVED" });
    await attachCaptureMedia(producer, { captureSessionId: c.id, fileName: "own.mp4", ...owned });
    f = await assessObservedInGameEvidence(editor, c.id);
    expect(f.missing).toEqual([]);
    expect(f.eligible).toBe(true);
    expect(f.supports).toBe("OBSERVED_IN_GAME");
    expect(f.evidence).toMatchObject({
      captureSessionId: c.id,
      platform: "PlayStation 5",
      gameVersion: "1.00",
      gameMode: "Story",
      reviewedBy: editor.userId,
      submittedBy: producer.userId,
    });
    expect(f.evidence!.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.limitations.join(" ")).toMatch(/not approval/);

    // Eligibility never rewrites a stored claim or capture.
    const fact = await createClaim(owner, {
      statement: "Observed behaviour (test).",
      classification: "OBSERVED",
      sourceIds: [
        (
          await createSource(owner, {
            title: "Own capture (test)",
            publisher: "Test",
            sourceClass: "OFFICIAL_SOURCE",
            sourceType: "official-page",
          })
        ).id,
      ],
    });
    await assessObservedInGameEvidence(editor, c.id);
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: fact.id } })).classification).toBe(
      "OBSERVED",
    );
  }, 60_000);

  it("a forged approval written straight into the record does not pass", async () => {
    const c = await submit();
    await attachCaptureMedia(producer, { captureSessionId: c.id, fileName: "fix.mp4", ...owned });
    // Someone marks it APPROVED with a reviewer id that is not an account here,
    // then with the submitter's own id, then with a reviewer who lost the role.
    for (const [reviewedBy, reason] of [
      ["user_mike", "no active reviewer account is recorded on the capture"],
      [outsider.userId, "no active reviewer account is recorded on the capture"],
      [producer.userId, "the capture was reviewed by the person who submitted it"],
      [readOnly.userId, "the recorded reviewer no longer holds a reviewing role"],
    ] as const) {
      await prisma.captureSession.update({
        where: { id: c.id },
        data: { status: "APPROVED", reviewedBy },
      });
      const f = await assessObservedInGameEvidence(editor, c.id);
      expect(f.eligible).toBe(false);
      expect(f.supports).toBe("UNKNOWN");
      expect(f.missing).toContain(reason);
    }
  });

  it("fixtures, leaks, mods and missing test details are never eligible", async () => {
    const fx = await submit();
    await reviewCapture(editor, { captureId: fx.id, decision: "APPROVED" });
    await attachCaptureMedia(producer, {
      captureSessionId: fx.id,
      fileName: "fx2.mp4",
      ...owned,
      captureMethod: "SYNTHETIC_FIXTURE",
      rightsStatus: "INTERNAL_FIXTURE",
    });
    expect((await assessObservedInGameEvidence(editor, fx.id)).missing).toEqual(
      expect.arrayContaining([
        "the footage is an internal fixture, not gameplay",
        "footage rights are not recorded as an owned original capture",
      ]),
    );

    const bare = await submit({ settings: undefined, testConditions: " ", modsDeclared: true });
    await reviewCapture(editor, { captureId: bare.id, decision: "APPROVED" });
    await prisma.captureSession.update({
      where: { id: bare.id },
      data: { flagLeaked: true, status: "BLOCKED" },
    });
    expect((await assessObservedInGameEvidence(editor, bare.id)).missing).toEqual(
      expect.arrayContaining([
        "capture is flagged as leaked material",
        "mods were declared for this capture",
        "game settings are not recorded",
        "test method/conditions are not recorded",
      ]),
    );
  });

  it("is permissioned and workspace-scoped", async () => {
    const c = await submit();
    await expect(assessObservedInGameEvidence(readOnly, c.id)).rejects.toThrow(
      /Missing capability/,
    );
    await expect(assessObservedInGameEvidence(outsider, c.id)).rejects.toThrow(/not found/);
  });
});

describe("production packet check", () => {
  const packet = (claimIds: string[], over: Record<string, unknown> = {}) => ({
    packetId: "PKT-TEST",
    version: "1.0",
    targetViewer: "New players",
    viewerProblem: "Unsure about a setting",
    singlePromise: "One verified answer",
    spoilerCeiling: "none",
    claimIds,
    beats: [
      { beatId: "B1", startSec: 0, endSec: 6, narrationText: "a", onScreenText: "b", claimIds },
      {
        beatId: "B2",
        startSec: 6,
        endSec: 12,
        narrationText: "c",
        onScreenText: "d",
        claimIds: [],
      },
    ],
    totalRuntimeSec: 12,
    ...over,
  });
  let claimId = "";
  let sourceId = "";

  it("resolves claim states from the workspace, not from the packet", async () => {
    const source = await createSource(owner, {
      title: "Official page (packet test)",
      publisher: "Rockstar Games",
      sourceClass: "OFFICIAL_SOURCE",
      sourceType: "official-page",
    });
    sourceId = source.id;
    claimId = (
      await createClaim(owner, {
        statement: "A confirmed fact (test).",
        classification: "CONFIRMED",
        sourceIds: [source.id],
      })
    ).id;
    const res = await checkProductionPacket(editor, packet([claimId]));
    expect(res).toEqual({
      packetId: "PKT-TEST",
      runtimeSec: 12,
      claims: [{ claimId, canonical: "OFFICIAL_CONFIRMED" }],
      publication: "PUBLICATION_BLOCKED",
      approves: "nothing",
    });
  });

  it("refuses self-declared approvals, rights flags, claim states and publication states", async () => {
    for (const extra of [
      { rightsApprovedByHumanReviewer: true },
      { selfCertifiedByGenerator: false },
      { approved: true },
      { publicationState: "READY" },
      { claims: [{ claimId, state: "OFFICIAL_CONFIRMED" }] },
    ]) {
      await expect(checkProductionPacket(editor, packet([claimId], extra))).rejects.toThrow(
        /Unrecognized key/,
      );
    }
  });

  it("refuses unknown, other-workspace, stale and leaked claims", async () => {
    await expect(checkProductionPacket(editor, packet(["nope"]))).rejects.toThrow(
      /not a claim in this workspace/,
    );
    await expect(checkProductionPacket(outsider, packet([claimId]))).rejects.toThrow(
      /not a claim in this workspace/,
    );
    await markSourceStale(owner, sourceId, "date changed");
    await expect(checkProductionPacket(editor, packet([claimId]))).rejects.toThrow(
      /stale, contradicted or quarantined/,
    );
    await prisma.source.update({ where: { id: sourceId }, data: { status: "ACTIVE" } });
    const leaked = await createClaim(owner, {
      statement: "Leaked thing (test).",
      classification: "LEAKED",
      sourceIds: [sourceId],
    }).catch(() => null);
    if (leaked) {
      await expect(checkProductionPacket(editor, packet([leaked.id]))).rejects.toThrow(
        /stale, contradicted or quarantined/,
      );
    }
    await expect(checkProductionPacket(readOnly, packet([claimId]))).rejects.toThrow(
      /Missing capability/,
    );
  });

  it("checks beat timing and declared claims without touching the database", () => {
    const p = packet(["c1"]);
    expect(parseProductionPacket(p).beats).toHaveLength(2);
    const beats = p.beats;
    const bad =
      (b: unknown[], over = {}) =>
      () =>
        parseProductionPacket({ ...p, beats: b, ...over });
    expect(bad([{ ...beats[0]!, startSec: 1 }, beats[1]!])).toThrow(/B1 starts at 1s/);
    expect(bad([beats[0]!, { ...beats[1]!, startSec: 5 }])).toThrow(/B2 starts at 5s/);
    expect(bad([beats[0]!, { ...beats[1]!, startSec: 7 }])).toThrow(/B2 starts at 7s/);
    expect(bad([{ ...beats[0]!, endSec: 0 }, beats[1]!])).toThrow(
      /packet rejected|ends at or before/,
    );
    expect(bad([{ ...beats[0]!, claimIds: ["zz"] }, beats[1]!])).toThrow(/undeclared claim zz/);
    expect(bad(beats, { totalRuntimeSec: 20 })).toThrow(/Beats end at 12s/);
    expect(bad([])).toThrow(/packet rejected/);
    expect(() => parseProductionPacket("not an object")).toThrow(/packet rejected/);
    expect(() => parseProductionPacket({ ...p, claimIds: [] })).toThrow(/packet rejected/);
  });
});
