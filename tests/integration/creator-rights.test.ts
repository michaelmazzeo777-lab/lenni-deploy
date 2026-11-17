import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import {
  createAgreementDraft,
  createCreator,
  expireDueAgreements,
  linkMediaToAgreement,
  qualifyCreator,
  reviewMediaRights,
  transitionAgreement,
  updateAgreementTerms,
} from "@/domain/creatorRights";
import type { Actor } from "@/lib/auth/context";
import { createContent } from "@/domain/content";
import { submitCapture } from "@/domain/capture";

// Creator records and agreements persist with evidence; expiry and
// revocation record affected assets; nothing becomes cleared by a status alone.

let owner: Actor, reviewer: Actor, editor: Actor;
const ev = "Recorded by Mike; reference kept in the rights folder.";
const day = 86_400_000;

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  reviewer = await ws.actor([Role.RIGHTS_REVIEWER], "rights");
  editor = await ws.actor([Role.EDITOR], "editor");
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function creator(name = `Creator ${Date.now()}-${Math.random()}`) {
  return createCreator(reviewer, {
    name,
    platform: "youtube",
    profileUrl: `https://www.youtube.com/@test-${Math.random().toString(36).slice(2)}`,
    tier: "REALISTIC_PARTNER",
    games: ["GTA Online"],
    sourceUrl: "https://www.youtube.com/",
    retrievedAt: new Date(),
    confidence: "LOW",
  });
}

async function mediaRow() {
  const content = await createContent(owner, {
    type: "SHORT",
    pillar: "BRIEFING",
    workingTitle: `rights test ${Date.now()}`,
  });
  const session = await submitCapture(owner, {
    contentId: content.id,
    platform: "PlayStation 5",
    gameVersion: "test",
  });
  return prisma.captureMedia.create({
    data: {
      workspaceId: owner.workspaceId,
      captureSessionId: session.id,
      operator: "Creator",
      captureMethod: "OTHER",
      sourceDevice: "creator upload",
      rightsStatus: "UNCLEARED",
      originalName: "creator.mp4",
      storagePath: "captures/x/creator.mp4",
      checksumSha256: `${Date.now()}${Math.random()}`,
      sizeBytes: BigInt(1),
      durationSec: 60,
      width: 1920,
      height: 1080,
      frameRate: 60,
      videoCodec: "h264",
      probeJson: {},
      ingestedBy: owner.userId,
    },
  });
}

/** Walks a new agreement all the way to ACTIVE with full evidence. */
async function activeAgreement(expiresAt: Date | null = new Date(Date.now() + 30 * day)) {
  const c = await creator();
  await qualifyCreator(
    reviewer,
    c.id,
    "Original GTA Online footage; publishes a business contact.",
  );
  const a = await createAgreementDraft(reviewer, c.id, {
    rightsOwner: "The creator",
    ownershipEvidence: "Creator's own channel uploads, verified by Mike",
    footageScope: "Raw recordings of session 2026-11-10",
    editingAllowed: true,
    derivativesAllowed: true,
    approvedDestinations: ["youtube"],
  });
  await transitionAgreement(reviewer, a.id, "LEGAL_REVIEW", ev);
  await transitionAgreement(owner, a.id, "APPROVED_TO_CONTACT", ev, {
    legalReviewer: "Outside counsel (name on file)",
    legalReviewNote: "Template acceptable for this scope",
  });
  await transitionAgreement(owner, a.id, "SENT", ev);
  await transitionAgreement(owner, a.id, "EXECUTED_VERIFIED", ev, {
    signatureEvidence: "Signed PDF in rights folder; signature verified by email from the creator",
    effectiveAt: new Date(Date.now() - day),
    expiresAt,
  });
  return transitionAgreement(owner, a.id, "ACTIVE", ev);
}

describe("creator records", () => {
  it("persists a prospect with its source and refuses an unsourced business contact", async () => {
    const c = await creator();
    expect(c.status).toBe("PROSPECT");
    await expect(
      createCreator(reviewer, {
        name: "x",
        platform: "twitch",
        profileUrl: "https://www.twitch.tv/x-test",
        businessContact: "biz@example.com",
        sourceUrl: "https://www.twitch.tv/",
        retrievedAt: new Date(),
        confidence: "LOW",
      }),
    ).rejects.toThrow(/public page/);
  });

  it("refuses people without the rights capability", async () => {
    await expect(
      createCreator(editor, {
        name: "y",
        platform: "youtube",
        profileUrl: "https://www.youtube.com/@y-test",
        sourceUrl: "https://www.youtube.com/",
        retrievedAt: new Date(),
        confidence: "LOW",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("will not draft an agreement for an unqualified prospect", async () => {
    const c = await creator();
    await expect(createAgreementDraft(reviewer, c.id, {})).rejects.toThrow(/Qualify/);
  });
});

describe("agreement lifecycle", () => {
  it("walks to ACTIVE only with evidence at each step, and records every step", async () => {
    const a = await activeAgreement();
    expect(a.status).toBe("ACTIVE");
    const events = await prisma.agreementEvent.findMany({ where: { agreementId: a.id } });
    expect(events.map((e) => e.toStatus)).toEqual([
      "AGREEMENT_DRAFT",
      "LEGAL_REVIEW",
      "APPROVED_TO_CONTACT",
      "SENT",
      "EXECUTED_VERIFIED",
      "ACTIVE",
    ]);
    expect(events.every((e) => e.evidence.length >= 10)).toBe(true);
  });

  it("refuses to mark a sent draft executed without signature evidence", async () => {
    const c = await creator();
    await qualifyCreator(reviewer, c.id, "Qualified for this test case.");
    const a = await createAgreementDraft(reviewer, c.id, {});
    await transitionAgreement(reviewer, a.id, "LEGAL_REVIEW", ev);
    await transitionAgreement(owner, a.id, "APPROVED_TO_CONTACT", ev, {
      legalReviewer: "Counsel",
      legalReviewNote: "OK",
    });
    await transitionAgreement(owner, a.id, "SENT", ev);
    await expect(transitionAgreement(owner, a.id, "EXECUTED_VERIFIED", ev)).rejects.toThrow(
      /signed agreement/,
    );
    expect((await prisma.creatorAgreement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "SENT",
    );
  });

  it("does not let a rights reviewer record the Owner's steps", async () => {
    const c = await creator();
    await qualifyCreator(reviewer, c.id, "Qualified for this test case.");
    const a = await createAgreementDraft(reviewer, c.id, {});
    await transitionAgreement(reviewer, a.id, "LEGAL_REVIEW", ev);
    await expect(
      transitionAgreement(reviewer, a.id, "APPROVED_TO_CONTACT", ev, {
        legalReviewer: "Counsel",
        legalReviewNote: "OK",
      }),
    ).rejects.toThrow(/Only the Owner/);
  });

  it("freezes terms once the agreement leaves draft", async () => {
    const a = await activeAgreement();
    await expect(updateAgreementTerms(reviewer, a.id, { commercialUse: true })).rejects.toThrow(
      /Terms can only change/,
    );
  });
});

describe("rights-aware footage, expiry and revocation", () => {
  it("links footage, needs a fresh human review, and refuses approval while uncovered", async () => {
    const m = await mediaRow();
    await expect(
      reviewMediaRights(reviewer, m.id, "APPROVED", "Looks fine to me today."),
    ).rejects.toThrow(/linked creator agreement/);
    const a = await activeAgreement();
    await linkMediaToAgreement(reviewer, m.id, a.id, "Contains in-game radio; mute before use");
    const approved = await reviewMediaRights(
      reviewer,
      m.id,
      "APPROVED",
      "Covered by the active licence.",
    );
    expect(approved.rightsReviewDecision).toBe("APPROVED");
    const relinked = await linkMediaToAgreement(reviewer, m.id, a.id);
    expect(relinked.rightsReviewDecision).toBeNull();
  });

  it("revocation records the affected assets and blocks further rights approval", async () => {
    const m = await mediaRow();
    const a = await activeAgreement();
    await linkMediaToAgreement(reviewer, m.id, a.id);
    const revoked = await transitionAgreement(
      owner,
      a.id,
      "REVOKED",
      "Creator withdrew permission by email.",
    );
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).toBeTruthy();
    const event = await prisma.agreementEvent.findFirstOrThrow({
      where: { agreementId: a.id, toStatus: "REVOKED" },
    });
    expect((event.affectedJson as { media: { id: string }[] }).media.map((x) => x.id)).toContain(
      m.id,
    );
    await expect(
      reviewMediaRights(reviewer, m.id, "APPROVED", "Trying again after revoke."),
    ).rejects.toThrow(/not active/);
  });

  it("records the expiry of an agreement past its end date", async () => {
    const a = await activeAgreement(new Date(Date.now() + 1000));
    const later = new Date(Date.now() + 5000);
    expect(await expireDueAgreements(owner, later)).toBeGreaterThanOrEqual(1);
    expect((await prisma.creatorAgreement.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "EXPIRED",
    );
    const ev2 = await prisma.agreementEvent.findFirstOrThrow({
      where: { agreementId: a.id, toStatus: "EXPIRED" },
    });
    expect(ev2.evidence).toMatch(/expiry date/);
  });
});
