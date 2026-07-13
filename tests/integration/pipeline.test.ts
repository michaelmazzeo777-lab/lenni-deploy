import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createSource, createClaim, reviewClaim, linkClaimToContent } from "@/domain/evidence";
import { createContent } from "@/domain/content";
import { saveScriptVersion } from "@/domain/script";
import { createAsset, reviewAsset } from "@/domain/rights";
import { createTitleVariant, createThumbnailVariant } from "@/domain/packaging";
import { grantApproval, evaluateReadyReadiness } from "@/domain/approval";
import { generateContentPacket } from "@/domain/aiContent";
import { publishPublicArticle } from "@/domain/publication";
import { createCorrection } from "@/domain/correction";
import { isDomainError } from "@/lib/errors";

let owner: Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let editor: typeof owner;
let researcher: typeof owner;

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  researcher = await ws.actor([Role.RESEARCHER], "researcher");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function officialSource() {
  return createSource(researcher, {
    title: "Official announcement",
    publisher: "Rockstar Games (official)",
    sourceClass: "OFFICIAL_SOURCE",
    sourceType: "press release",
    supportNotes: "GTA VI is set in Leonida.",
  });
}

describe("evidence rules", () => {
  it("CONFIRMED claim cannot be reviewed without an official source", async () => {
    const web = await createSource(researcher, {
      title: "Blog",
      publisher: "Some blog",
      sourceClass: "WEB_CORROBORATED",
      sourceType: "article",
    });
    const claim = await createClaim(researcher, {
      statement: "A confirmed-looking claim with only a blog source.",
      classification: "CONFIRMED",
      sourceIds: [web.id],
    });
    await expect(reviewClaim(editor, claim.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("CONFIRMED claim reviews once an official source is attached", async () => {
    const src = await officialSource();
    const claim = await createClaim(researcher, {
      statement: "GTA VI is set in Leonida.",
      classification: "CONFIRMED",
      publicWording: "Set in Leonida.",
      sourceIds: [src.id],
    });
    const reviewed = await reviewClaim(editor, claim.id);
    expect(reviewed.status).toBe("REVIEWED");
  });

  it("LEAKED claim is auto-quarantined, cannot be reviewed, cannot be linked", async () => {
    const leaked = await createClaim(researcher, {
      statement: "Alleged leaked detail.",
      classification: "LEAKED",
    });
    expect(leaked.status).toBe("QUARANTINED");
    await expect(reviewClaim(editor, leaked.id)).rejects.toBeTruthy();

    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Leak containment test",
    });
    // DB trigger blocks linking a LEAKED claim to content.
    await expect(linkClaimToContent(editor, content.id, leaked.id)).rejects.toBeTruthy();
  });
});

describe("full publish pipeline + gates", () => {
  async function buildReadyContent() {
    const src = await officialSource();
    const claim = await createClaim(researcher, {
      statement: "GTA VI is set in Leonida.",
      classification: "CONFIRMED",
      publicWording: "Set in Leonida.",
      sourceIds: [src.id],
    });
    await reviewClaim(editor, claim.id);

    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Confirmed facts pilot",
      viewerPromise: "Direct answers.",
    });
    await linkClaimToContent(editor, content.id, claim.id, true);
    await saveScriptVersion(editor, { contentId: content.id, body: "## Intro\nConfirmed facts." });
    const asset = await createAsset(editor, {
      contentId: content.id,
      name: "Original title card",
      mediaType: "image",
      ownership: "ORIGINAL",
    });
    await reviewAsset(owner, { assetId: asset.id, riskLevel: "LOW", decision: "APPROVED" });
    await createTitleVariant(editor, {
      contentId: content.id,
      text: "Confirmed GTA VI facts",
      deceptionCheck: true,
    });
    await createThumbnailVariant(editor, {
      contentId: content.id,
      name: "board",
      brief: "Original graphic.",
    });
    return { content, claim, src };
  }

  it("READY fails before approvals and succeeds after all scopes", async () => {
    const { content } = await buildReadyContent();
    let r = await evaluateReadyReadiness(content.id);
    expect(r.ready).toBe(false);
    expect(r.missingScopes.length).toBe(5);

    await grantApproval(editor, content.id, "EDITORIAL_FACTS", "APPROVED");
    await grantApproval(editor, content.id, "SCRIPT", "APPROVED");
    await grantApproval(owner, content.id, "RIGHTS", "APPROVED");
    await grantApproval(editor, content.id, "PACKAGING", "APPROVED");
    await grantApproval(owner, content.id, "PUBLIC_WEBSITE", "APPROVED");

    r = await evaluateReadyReadiness(content.id);
    expect(r.ready).toBe(true);
  });

  it("AI generation grounds only in selected claims and is stored VALID as draft", async () => {
    const { content, claim, src } = await buildReadyContent();
    const { generation, validation } = await generateContentPacket(editor, {
      contentId: content.id,
      sourceIds: [src.id],
      claimIds: [claim.id],
    });
    expect(validation.status).toBe("VALID");
    expect(generation.validationStatus).toBe("VALID");
    expect(generation.reviewDecision).toBeNull(); // requires human review
  });

  it("publishes an immutable public revision and is idempotent", async () => {
    const { content } = await buildReadyContent();
    await grantApproval(editor, content.id, "EDITORIAL_FACTS", "APPROVED");
    await grantApproval(editor, content.id, "SCRIPT", "APPROVED");
    await grantApproval(owner, content.id, "RIGHTS", "APPROVED");
    await grantApproval(editor, content.id, "PACKAGING", "APPROVED");
    await grantApproval(owner, content.id, "PUBLIC_WEBSITE", "APPROVED");

    const first = await publishPublicArticle(owner, content.id);
    expect(first.idempotent).toBe(false);
    expect(first.revision.revision).toBe(1);

    const second = await publishPublicArticle(owner, content.id);
    expect(second.idempotent).toBe(true);
    const revs = await prisma.publicArticleRevision.count({ where: { contentId: content.id } });
    expect(revs).toBe(1);

    // Public revisions are immutable (DB trigger blocks UPDATE).
    await expect(
      prisma.publicArticleRevision.update({
        where: { id: first.revision.id },
        data: { title: "hacked" },
      }),
    ).rejects.toBeTruthy();
  });

  it("a material script edit invalidates prior approvals and blocks READY", async () => {
    const { content } = await buildReadyContent();
    await grantApproval(editor, content.id, "EDITORIAL_FACTS", "APPROVED");
    await grantApproval(editor, content.id, "SCRIPT", "APPROVED");
    await grantApproval(owner, content.id, "RIGHTS", "APPROVED");
    await grantApproval(editor, content.id, "PACKAGING", "APPROVED");
    await grantApproval(owner, content.id, "PUBLIC_WEBSITE", "APPROVED");
    expect((await evaluateReadyReadiness(content.id)).ready).toBe(true);

    const res = await saveScriptVersion(editor, {
      contentId: content.id,
      body: "## Rewrite\nNew thesis.",
    });
    expect(res.invalidatedApprovals).toBeGreaterThan(0);
    expect((await evaluateReadyReadiness(content.id)).ready).toBe(false);
  });

  it("records a correction and issues a new immutable revision", async () => {
    const { content } = await buildReadyContent();
    await grantApproval(editor, content.id, "EDITORIAL_FACTS", "APPROVED");
    await grantApproval(editor, content.id, "SCRIPT", "APPROVED");
    await grantApproval(owner, content.id, "RIGHTS", "APPROVED");
    await grantApproval(editor, content.id, "PACKAGING", "APPROVED");
    await grantApproval(owner, content.id, "PUBLIC_WEBSITE", "APPROVED");
    await publishPublicArticle(owner, content.id);

    const { newRevision } = await createCorrection(editor, {
      contentId: content.id,
      severity: "MINOR",
      originalText: "Confirmed facts.",
      correctedText: "Confirmed facts (as of the trailer).",
      reason: "clarity",
      publicNotice: "Clarified the as-of date.",
    });
    expect(newRevision).toBe(2);
    const latest = await prisma.publicArticleRevision.findFirst({
      where: { contentId: content.id },
      orderBy: { revision: "desc" },
    });
    expect(latest?.body).toMatch(/## Corrections/);
  });

  it("blocks publication when a used asset is leaked/blocked", async () => {
    const { content } = await buildReadyContent();
    const bad = await createAsset(editor, {
      contentId: content.id,
      name: "leaked clip",
      mediaType: "video",
      ownership: "THIRD_PARTY",
      flagLeaked: true,
    });
    await reviewAsset(owner, { assetId: bad.id, riskLevel: "BLOCKED", decision: "BLOCKED" });
    await grantApproval(editor, content.id, "EDITORIAL_FACTS", "APPROVED");
    await grantApproval(editor, content.id, "SCRIPT", "APPROVED");
    // RIGHTS approval must itself be refused while a blocker exists.
    await expect(grantApproval(owner, content.id, "RIGHTS", "APPROVED")).rejects.toBeTruthy();
    const r = await evaluateReadyReadiness(content.id);
    expect(r.ready).toBe(false);
    expect(r.rightsBlockers.length).toBeGreaterThan(0);
    await expect(publishPublicArticle(owner, content.id)).rejects.toBeTruthy();
  });
});

describe("audit log is append-only", () => {
  it("rejects UPDATE and DELETE on AuditEvent", async () => {
    const ev = await prisma.auditEvent.findFirst({ where: { workspaceId: owner.workspaceId } });
    expect(ev).toBeTruthy();
    await expect(
      prisma.auditEvent.update({ where: { id: ev!.id }, data: { action: "tamper" } }),
    ).rejects.toBeTruthy();
    await expect(prisma.auditEvent.delete({ where: { id: ev!.id } })).rejects.toBeTruthy();
  });

  it("wrote consequential events across the pipeline", async () => {
    const actions = await prisma.auditEvent.findMany({
      where: { workspaceId: owner.workspaceId },
      select: { action: true },
    });
    const set = new Set(actions.map((a) => a.action));
    for (const a of [
      "content.created",
      "claim.reviewed",
      "script.version_saved",
      "rights.reviewed",
      "approval.granted",
      "publication.published",
    ]) {
      expect(set.has(a), `expected audit action ${a}`).toBe(true);
    }
  });
});

// Referenced to satisfy the unused-import guard when isDomainError is unused.
void isDomainError;
