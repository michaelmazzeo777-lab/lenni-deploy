import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createSource, createClaim, reviewClaim } from "@/domain/evidence";
import { createContent } from "@/domain/content";
import { grantApproval } from "@/domain/approval";
import { publishPublicArticle } from "@/domain/publication";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let readOnly: A, researcher: A, rights: A, editor: A;

beforeAll(async () => {
  const ws = await makeWorkspace();
  readOnly = await ws.actor([Role.READ_ONLY], "ro");
  researcher = await ws.actor([Role.RESEARCHER], "res");
  rights = await ws.actor([Role.RIGHTS_REVIEWER], "rr");
  editor = await ws.actor([Role.EDITOR], "ed");
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Authorization is enforced in the domain services themselves, so a direct
// service call (bypassing the UI) is subject to the same checks (docs/11 test 15).

describe("authorization boundaries (server-enforced)", () => {
  it("Read Only cannot create content or sources", async () => {
    await expect(
      createContent(readOnly, { type: "SHORT", pillar: "BRIEFING", workingTitle: "nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createSource(readOnly, {
        title: "x",
        publisher: "y",
        sourceClass: "OFFICIAL_SOURCE",
        sourceType: "z",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Researcher can create sources/claims but cannot review or approve", async () => {
    const src = await createSource(researcher, {
      title: "Official",
      publisher: "Rockstar (official)",
      sourceClass: "OFFICIAL_SOURCE",
      sourceType: "press",
    });
    const claim = await createClaim(researcher, {
      statement: "Set in Leonida.",
      classification: "CONFIRMED",
      sourceIds: [src.id],
    });
    // Researcher lacks claim.review.
    await expect(reviewClaim(researcher, claim.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "auth content",
    });
    await expect(
      grantApproval(researcher, content.id, "PUBLIC_WEBSITE", "APPROVED"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Rights Reviewer can grant RIGHTS but not EDITORIAL_FACTS or publish", async () => {
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "rights auth",
    });
    await expect(
      grantApproval(rights, content.id, "EDITORIAL_FACTS", "APPROVED"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(publishPublicArticle(rights, content.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("Editor cannot publish (owner-only)", async () => {
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "publish auth",
    });
    await expect(publishPublicArticle(editor, content.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
