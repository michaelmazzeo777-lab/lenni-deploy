import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createContent } from "@/domain/content";
import { submitCapture, reviewCapture } from "@/domain/capture";
import {
  draftShortsScript,
  synthesizeVoiceover,
  renderShort,
  reviewRender,
  publishShort,
} from "@/domain/shorts";
import { MOCK_SAFETY_TRIGGER } from "@/lib/shorts";
import { LocalAssetStorage } from "@/lib/storage/local-provider";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, researcher: A;

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  researcher = await ws.actor([Role.RESEARCHER], "res");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function approvedShortsCapture(fileReference = "capture-shorts-001.mp4") {
  const content = await createContent(editor, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: "Shorts pipeline test content",
  });
  const capture = await submitCapture(owner, {
    contentId: content.id,
    platform: "PlayStation 5",
    gameVersion: "1.0",
    fileReference,
    targetsShorts: true,
  });
  await reviewCapture(editor, { captureId: capture.id, decision: "APPROVED" });
  return prisma.captureSession.findUniqueOrThrow({ where: { id: capture.id } });
}

describe("Shorts pipeline (mock providers, end to end)", () => {
  it("runs capture -> script -> voiceover -> render -> review -> publish", async () => {
    const capture = await approvedShortsCapture();

    const script = await draftShortsScript(owner, capture.id);
    expect(script.status).toBe("VALID");
    expect(script.provider).toBe("mock");
    expect(script.model).toBe("mock-shorts-script-1");

    const voiceover = await synthesizeVoiceover(owner, script.id, "default");
    expect(voiceover.durationSec).toBeGreaterThan(0);
    // Real bytes were written via the storage seam.
    const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
    const audio = await storage.read(voiceover.assetPath);
    expect(audio.subarray(0, 4).toString("ascii")).toBe("RIFF");

    const render = await renderShort(owner, voiceover.id, "Leonida Field Guide");
    expect(render.status).toBe("PENDING"); // human gate, not auto-approved
    expect(render.frameRate).toBe(30); // cost decision
    expect(render.renderCostUsd).toBe(0); // mock = $0

    // Publish is refused while the render is un-reviewed.
    await expect(
      publishShort(owner, {
        renderId: render.id,
        title: "Valid title",
        description: "Valid description",
        tags: [],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const approved = await reviewRender(editor, render.id, "APPROVED");
    expect(approved.status).toBe("CLEAN");

    const publication = await publishShort(owner, {
      renderId: render.id,
      title: "One detail everyone missed",
      description: "Verified breakdown. Independent fan content.",
      tags: ["gta6", "leonida"],
    });
    expect(publication.status).toBe("PUBLISHED");
    expect(publication.youtubeVideoId).toMatch(/^mock-/); // clearly fake, never a real upload
    expect(publication.disclosureJson).toMatchObject({
      alteredOrSynthetic: true,
      syntheticVoiceover: true,
    });

    const audit = await prisma.auditEvent.findMany({
      where: { workspaceId: owner.workspaceId, action: { startsWith: "shorts." } },
    });
    const actions = audit.map((a) => a.action);
    for (const expected of [
      "shorts.script_drafted",
      "shorts.voiceover_synthesized",
      "shorts.rendered",
      "shorts.render_approved",
      "shorts.published",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("quarantines safety-flagged footage and blocks voiceover until human action", async () => {
    const capture = await approvedShortsCapture(`clip-${MOCK_SAFETY_TRIGGER}.mp4`);
    const script = await draftShortsScript(owner, capture.id);
    expect(script.status).toBe("QUARANTINED");
    await expect(synthesizeVoiceover(owner, script.id, "default")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("refuses non-approved, non-shorts, and leaked captures", async () => {
    const content = await createContent(editor, {
      type: "SHORT",
      pillar: "BRIEFING",
      workingTitle: "Gate test content",
    });

    // Submitted but not approved.
    const unapproved = await submitCapture(owner, {
      contentId: content.id,
      platform: "PC",
      gameVersion: "1.0",
      fileReference: "clip-a.mp4",
      targetsShorts: true,
    });
    await expect(draftShortsScript(owner, unapproved.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // Approved but not flagged for shorts.
    const notShorts = await submitCapture(owner, {
      contentId: content.id,
      platform: "PC",
      gameVersion: "1.0",
      fileReference: "clip-b.mp4",
    });
    await reviewCapture(editor, { captureId: notShorts.id, decision: "APPROVED" });
    await expect(draftShortsScript(owner, notShorts.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // Leaked: submission itself lands BLOCKED and the pipeline refuses it.
    const leaked = await submitCapture(owner, {
      contentId: content.id,
      platform: "PC",
      gameVersion: "1.0",
      fileReference: "clip-c.mp4",
      flagLeaked: true,
      targetsShorts: true,
    });
    expect(leaked.status).toBe("BLOCKED");
    await expect(draftShortsScript(owner, leaked.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("enforces RBAC: researcher cannot publish; rejection requires notes", async () => {
    const capture = await approvedShortsCapture("clip-rbac.mp4");
    const script = await draftShortsScript(owner, capture.id);
    const voiceover = await synthesizeVoiceover(owner, script.id, "default");
    const render = await renderShort(owner, voiceover.id, "Leonida Field Guide");

    await expect(reviewRender(researcher, render.id, "APPROVED")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(reviewRender(editor, render.id, "REJECTED")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", // no notes
    });
    await reviewRender(editor, render.id, "APPROVED");
    await expect(
      publishShort(researcher, {
        renderId: render.id,
        title: "Test title",
        description: "Test description",
        tags: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      publishShort(editor, {
        renderId: render.id,
        title: "Test title",
        description: "Test description",
        tags: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" }); // Owner-only, like publication.publish
  });

  it("validates publish metadata against YouTube limits (title <= 100 chars)", async () => {
    const capture = await approvedShortsCapture("clip-limits.mp4");
    const script = await draftShortsScript(owner, capture.id);
    const voiceover = await synthesizeVoiceover(owner, script.id, "default");
    const render = await renderShort(owner, voiceover.id, "Leonida Field Guide");
    await reviewRender(editor, render.id, "APPROVED");
    await expect(
      publishShort(owner, {
        renderId: render.id,
        title: "x".repeat(101),
        description: "Valid description",
        tags: [],
      }),
    ).rejects.toThrow();
  });

  it("publish claim blocks a second concurrent attempt; rejection purges render bytes", async () => {
    const capture = await approvedShortsCapture("clip-claim.mp4");
    const script = await draftShortsScript(owner, capture.id);
    const voiceover = await synthesizeVoiceover(owner, script.id, "default");

    // Rejected render: bytes are purged from storage, record kept.
    const rejected = await renderShort(owner, voiceover.id, "Leonida Field Guide");
    await reviewRender(editor, rejected.id, "REJECTED", "Framing is off");
    const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
    await expect(storage.read(rejected.storagePath)).rejects.toThrow();
    const kept = await prisma.shortsRender.findUnique({ where: { id: rejected.id } });
    expect(kept?.status).toBe("REJECTED"); // audit-trail record survives

    // Regenerate after rejection is allowed.
    const render = await renderShort(owner, voiceover.id, "Leonida Field Guide");
    await reviewRender(editor, render.id, "APPROVED");

    // A pre-existing DRAFT claim (simulating a concurrent in-flight publish)
    // blocks a second attempt BEFORE any external call could happen.
    await prisma.youTubePublication.create({
      data: {
        workspaceId: owner.workspaceId,
        renderId: render.id,
        title: "In-flight",
        description: "Simulated concurrent claim",
        tags: [],
        disclosureJson: { alteredOrSynthetic: true },
        status: "DRAFT",
      },
    });
    await expect(
      publishShort(owner, { renderId: render.id, title: "Title", description: "Desc", tags: [] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("a non-mock provider selection without credentials fails loudly, never silently", async () => {
    const prev = process.env.YOUTUBE_PUBLISHER;
    try {
      process.env.YOUTUBE_PUBLISHER = "youtube";
      const capture = await approvedShortsCapture("clip-real-provider.mp4");
      const script = await draftShortsScript(owner, capture.id);
      const voiceover = await synthesizeVoiceover(owner, script.id, "default");
      const render = await renderShort(owner, voiceover.id, "Leonida Field Guide");
      await reviewRender(editor, render.id, "APPROVED");
      await expect(
        publishShort(owner, {
          renderId: render.id,
          title: "Test title",
          description: "Test description",
          tags: [],
        }),
      ).rejects.toThrow(/not available/);
      // Nothing was recorded as published.
      const pub = await prisma.youTubePublication.findUnique({ where: { renderId: render.id } });
      expect(pub).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.YOUTUBE_PUBLISHER;
      else process.env.YOUTUBE_PUBLISHER = prev;
    }
  });
});
