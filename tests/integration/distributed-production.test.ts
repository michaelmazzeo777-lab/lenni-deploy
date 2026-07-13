import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createSource, createClaim, reviewClaim, linkClaimToContent } from "@/domain/evidence";
import { createContent } from "@/domain/content";
import { saveScriptVersion } from "@/domain/script";
import { createAsset, reviewAsset, rightsBlockers } from "@/domain/rights";
import { createTitleVariant, createThumbnailVariant } from "@/domain/packaging";
import { grantApproval, evaluateReadyReadiness } from "@/domain/approval";
import { generateContentPacket } from "@/domain/aiContent";
import { publishPublicArticle } from "@/domain/publication";
import { createCorrection } from "@/domain/correction";
import {
  createContributor,
  createAssignment,
  submitAssignment,
  recordRelease,
  assertAssignmentAccess,
  listAssignmentsFor,
} from "@/domain/contributors";
import { createShot, submitCapture, reviewCapture } from "@/domain/capture";
import {
  createVisualBrief,
  approveVisualPrompt,
  exportPromptPacket,
  generateWithMock,
  importVisualResult,
  reviewVisualAsset,
} from "@/domain/visuals";
import { getVisualProvider } from "@/lib/visuals/providers";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A,
  editor: A,
  researcher: A,
  producer: A,
  writer: A,
  designer: A,
  rights: A,
  contributorA: A,
  contributorB: A;

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  researcher = await ws.actor([Role.RESEARCHER], "res");
  producer = await ws.actor([Role.PRODUCER], "prod");
  writer = await ws.actor([Role.WRITER], "writer");
  designer = await ws.actor([Role.DESIGNER], "designer");
  rights = await ws.actor([Role.RIGHTS_REVIEWER], "rights");
  contributorA = await ws.actor([Role.CONTRIBUTOR], "contribA");
  contributorB = await ws.actor([Role.CONTRIBUTOR], "contribB");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("distributed production end-to-end chain", () => {
  it("runs the full owner-led multi-role workflow (steps 1–16)", async () => {
    // 1. Owner creates a video idea.
    const content = await createContent(owner, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Distributed production pilot",
      viewerPromise: "Evidence only.",
    });

    // 2. Researcher adds official evidence; editor reviews the claim.
    const src = await createSource(researcher, {
      title: "Official announcement",
      publisher: "Rockstar Games (official)",
      sourceClass: "OFFICIAL_SOURCE",
      sourceType: "press release",
      supportNotes: "GTA VI is set in Leonida.",
    });
    const claim = await createClaim(researcher, {
      statement: "GTA VI is set in Leonida.",
      classification: "CONFIRMED",
      publicWording: "Set in Leonida.",
      sourceIds: [src.id],
    });
    await reviewClaim(editor, claim.id);
    await linkClaimToContent(editor, content.id, claim.id, true);

    // 3. Mock AI generates a grounded packet.
    const { validation } = await generateContentPacket(editor, {
      contentId: content.id,
      sourceIds: [src.id],
      claimIds: [claim.id],
    });
    expect(validation.status).toBe("VALID");

    // 4. Owner assigns gameplay capture to a contributor (via profile).
    const profile = await createContributor(owner, {
      displayName: "Cam Capture",
      specialty: "Gameplay capture",
      userId: contributorA.userId,
    });
    const assignment = await createAssignment(owner, {
      contentId: content.id,
      contributorId: profile.id,
      kind: "GAMEPLAY_CAPTURE",
      deliverableNotes: "Capture shots 1-2 at launch settings",
    });
    await createShot(editor, { contentId: content.id, order: 1, title: "Beach flyover" });

    // 5. Producer/contributor submits footage.
    const take1 = await submitCapture(contributorA, {
      contentId: content.id,
      assignmentId: assignment.id,
      platform: "PlayStation 5",
      gameVersion: "1.0",
      fileReference: "take1.mp4",
      trialCount: 3,
    });
    expect(take1.status).toBe("SUBMITTED");

    // 6. Reviewer requests a retake (notes required).
    const retake = await reviewCapture(editor, {
      captureId: take1.id,
      decision: "RETAKE_REQUESTED",
      reviewNotes: "HUD covered the landmark; re-shoot at dusk.",
    });
    expect(retake.status).toBe("RETAKE_REQUESTED");

    // 7. Replacement footage is submitted and approved.
    const take2 = await submitCapture(contributorA, {
      contentId: content.id,
      assignmentId: assignment.id,
      platform: "PlayStation 5",
      gameVersion: "1.0",
      fileReference: "take2.mp4",
      supersedesId: take1.id,
    });
    const approvedTake = await reviewCapture(owner, { captureId: take2.id, decision: "APPROVED" });
    expect(approvedTake.status).toBe("APPROVED");

    // Contributor deliverable submitted + release received (clears rights blocker).
    await submitAssignment(contributorA, assignment.id, "Both takes delivered");
    await recordRelease(rights, assignment.id);

    // 8. Editor creates a visual brief; owner approves prompt + cost ceiling.
    const brief = await createVisualBrief(editor, {
      contentId: content.id,
      kind: "DIAGRAM",
      title: "Leonida evidence map",
      prompt: "Original stylized diagram of confirmed Leonida locations, evidence-graded.",
      negativePrompt: "No gameplay imitation, no Rockstar marks",
      costCeiling: 5,
    });
    await approveVisualPrompt(owner, brief.id, 5);
    const packet = await exportPromptPacket(editor, brief.id, "manual");
    expect(packet.constraints.length).toBeGreaterThan(0);

    // 9. Manual provider result is imported with actual provider/model metadata.
    const { asset: manualAsset } = await importVisualResult(designer, {
      briefId: brief.id,
      provider: "manual",
      model: "external-image-tool-3",
      jobId: "job-777",
      cost: 2.5,
      location: "local://imports/diagram-1.png",
    });
    // Plus a deterministic mock generation on the same brief.
    const { asset: mockAsset } = await generateWithMock(designer, brief.id);

    // 10. Rights Reviewer approves both assets with disclosure decisions.
    for (const a of [manualAsset, mockAsset]) {
      const reviewed = await reviewVisualAsset(rights, {
        assetId: a.id,
        decision: "APPROVED",
        disclosureDecision: "PRODUCTION_ASSISTANCE_ONLY",
        finalUsage: "Supporting diagram",
      });
      expect(reviewed.status).toBe("APPROVED");
    }

    // 11. Writer saves the final script.
    await saveScriptVersion(writer, {
      contentId: content.id,
      body: "## Final\nConfirmed: set in Leonida.",
    });

    // 12. Designer-adjacent packaging: title + thumbnail variants (editor role
    //     holds packaging.create; designers submit via visual briefs).
    await createTitleVariant(editor, {
      contentId: content.id,
      text: "GTA VI confirmed facts",
      deceptionCheck: true,
    });
    await createThumbnailVariant(editor, {
      contentId: content.id,
      name: "board",
      brief: "Original graphic.",
    });

    // Physical asset ledger entry + rights review (existing core requirement).
    const asset = await createAsset(editor, {
      contentId: content.id,
      name: "Original title card",
      mediaType: "image",
      ownership: "ORIGINAL",
    });
    await reviewAsset(owner, { assetId: asset.id, riskLevel: "LOW", decision: "APPROVED" });

    // 13. Owner grants all scoped approvals.
    await grantApproval(editor, content.id, "EDITORIAL_FACTS", "APPROVED");
    await grantApproval(editor, content.id, "SCRIPT", "APPROVED");
    await grantApproval(owner, content.id, "RIGHTS", "APPROVED");
    await grantApproval(editor, content.id, "PACKAGING", "APPROVED");
    await grantApproval(owner, content.id, "PUBLIC_WEBSITE", "APPROVED");
    expect((await evaluateReadyReadiness(content.id)).ready).toBe(true);

    // 14. Public article publishes locally.
    const { revision } = await publishPublicArticle(owner, content.id);
    expect(revision.revision).toBe(1);

    // 15. A correction is recorded (new immutable revision).
    const { newRevision } = await createCorrection(editor, {
      contentId: content.id,
      severity: "MINOR",
      originalText: "set in Leonida",
      correctedText: "set in the state of Leonida",
      reason: "precision",
      publicNotice: "Clarified the state name.",
    });
    expect(newRevision).toBe(2);

    // 16. Audit history shows the full chain.
    const actions = new Set(
      (
        await prisma.auditEvent.findMany({
          where: { entityId: content.id, entityType: "ContentItem" },
          select: { action: true },
        })
      ).map((e) => e.action),
    );
    for (const expected of [
      "content.created",
      "assignment.created",
      "shot.created",
      "capture.submitted",
      "capture.reviewed",
      "assignment.release_received",
      "visual.brief_created",
      "visual.prompt_approved",
      "visual.packet_exported",
      "visual.result_imported",
      "visual.reviewed",
      "script.version_saved",
      "approval.granted",
      "publication.published",
      "correction.recorded",
    ]) {
      expect(actions.has(expected), `missing audit action ${expected}`).toBe(true);
    }
  });
});

describe("negative controls", () => {
  async function baseContent() {
    return createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Negative controls",
    });
  }

  it("leaked capture footage is auto-blocked and cannot be approved", async () => {
    const content = await baseContent();
    const leaked = await submitCapture(producer, {
      contentId: content.id,
      platform: "PC",
      gameVersion: "pre-release",
      flagLeaked: true,
    });
    expect(leaked.status).toBe("BLOCKED");
    await expect(
      reviewCapture(owner, { captureId: leaked.id, decision: "APPROVED" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await rightsBlockers(content.id)).join(" ")).toMatch(/blocked capture/i);
  });

  it("a missing contributor release creates a rights blocker; receipt clears it", async () => {
    const content = await baseContent();
    const profile = await createContributor(owner, {
      displayName: "Rel Test",
      userId: contributorB.userId,
    });
    const assignment = await createAssignment(owner, {
      contentId: content.id,
      contributorId: profile.id,
      kind: "NARRATION",
    });
    await submitAssignment(contributorB, assignment.id, "VO delivered");
    expect((await rightsBlockers(content.id)).join(" ")).toMatch(/rights release/i);
    await recordRelease(owner, assignment.id);
    expect((await rightsBlockers(content.id)).join(" ")).not.toMatch(/rights release/i);
  });

  it("AI visuals cannot be labeled as real gameplay (domain + DB)", async () => {
    const content = await baseContent();
    const brief = await createVisualBrief(editor, {
      contentId: content.id,
      kind: "B_ROLL",
      title: "Contextual beach b-roll",
      prompt: "Generic stylized coastal b-roll, clearly original.",
    });
    await approveVisualPrompt(owner, brief.id);
    const { asset } = await generateWithMock(designer, brief.id);
    await expect(
      reviewVisualAsset(rights, {
        assetId: asset.id,
        decision: "APPROVED",
        disclosureDecision: "DISCLOSE_SYNTHETIC",
        presentedAsRealGameplay: true,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // DB CHECK also refuses a direct write.
    await expect(
      prisma.visualAsset.update({
        where: { id: asset.id },
        data: { presentedAsRealGameplay: true },
      }),
    ).rejects.toBeTruthy();
  });

  it("unreviewed visual assets block readiness", async () => {
    const content = await baseContent();
    const brief = await createVisualBrief(editor, {
      contentId: content.id,
      kind: "CHANNEL_GRAPHIC",
      title: "Bumper",
      prompt: "Original channel bumper graphic.",
    });
    await approveVisualPrompt(owner, brief.id);
    await generateWithMock(designer, brief.id);
    expect((await rightsBlockers(content.id)).join(" ")).toMatch(/visual asset/i);
  });

  it("contributors cannot access other contributors' assignments", async () => {
    const content = await baseContent();
    const profileA = await prisma.contributor.findFirst({
      where: { userId: contributorA.userId },
    });
    const assignment = await createAssignment(owner, {
      contentId: content.id,
      contributorId: profileA!.id,
      kind: "EDITING",
    });
    // contributorB (restricted) is not the assignee.
    await expect(assertAssignmentAccess(contributorB, assignment.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(submitAssignment(contributorB, assignment.id, "not mine")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Listing shows only their own.
    const visible = await listAssignmentsFor(contributorB);
    expect(visible.every((a) => a.contributor.userId === contributorB.userId)).toBe(true);
    // Staff (owner) sees everything.
    const all = await listAssignmentsFor(owner);
    expect(all.some((a) => a.id === assignment.id)).toBe(true);
  });

  it("direct service calls cannot bypass permissions", async () => {
    const content = await baseContent();
    await expect(createContributor(contributorA, { displayName: "Sneaky" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      reviewCapture(producer, { captureId: "any", decision: "APPROVED" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reviewVisualAsset(designer, {
        assetId: "any",
        decision: "APPROVED",
        disclosureDecision: "NOT_APPLICABLE",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createVisualBrief(researcher, {
        contentId: content.id,
        kind: "DIAGRAM",
        title: "x",
        prompt: "not allowed",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("duplicate imports are idempotent and cost above ceiling is refused", async () => {
    const content = await baseContent();
    const brief = await createVisualBrief(editor, {
      contentId: content.id,
      kind: "TIMELINE",
      title: "Announce timeline",
      prompt: "Original timeline graphic.",
      costCeiling: 1,
    });
    await approveVisualPrompt(owner, brief.id, 1);
    const first = await importVisualResult(designer, {
      briefId: brief.id,
      provider: "manual",
      model: "tool-1",
      jobId: "dup-1",
      cost: 0.5,
    });
    const second = await importVisualResult(designer, {
      briefId: brief.id,
      provider: "manual",
      model: "tool-1",
      jobId: "dup-1",
      cost: 0.5,
    });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    await expect(
      importVisualResult(designer, {
        briefId: brief.id,
        provider: "manual",
        model: "tool-1",
        jobId: "over-budget",
        cost: 2,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("disabled providers throw and mock/manual work without credentials", async () => {
    for (const name of ["higgsfield", "gemini-image", "gemini-video"]) {
      const provider = getVisualProvider(name);
      expect(provider.enabled).toBe(false);
      await expect(
        provider.generate(
          provider.preparePacket({
            briefId: "b",
            kind: "DIAGRAM",
            title: "t",
            prompt: "p",
            negativePrompt: "",
            styleNotes: "",
            costCeiling: 0,
          }),
        ),
      ).rejects.toThrow(/DISABLED/);
    }
    expect(getVisualProvider("mock").enabled).toBe(true);
    expect(getVisualProvider("manual").enabled).toBe(true);
  });
});
