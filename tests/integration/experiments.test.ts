import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createContent } from "@/domain/content";
import { createTitleVariant } from "@/domain/packaging";
import { createPackagingExperiment, concludePackagingExperiment } from "@/domain/experiments";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, researcher: A;

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  researcher = await ws.actor([Role.RESEARCHER], "researcher");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function contentWithTwoTitles() {
  const content = await createContent(editor, {
    type: "LONG_VIDEO",
    pillar: "BRIEFING",
    workingTitle: "Experiment content",
  });
  const a = await createTitleVariant(editor, { contentId: content.id, text: "Title A search" });
  const b = await createTitleVariant(editor, {
    contentId: content.id,
    text: "Title B browse",
    strategy: "BROWSE_FIRST",
  });
  return { content, a, b };
}

describe("packaging experiments", () => {
  it("creates an A/B experiment and records a separated result + interpretation", async () => {
    const { content, a, b } = await contentWithTwoTitles();
    const ex = await createPackagingExperiment(editor, {
      contentId: content.id,
      hypothesis: "Browse-first title lifts CTR",
      variantAId: a.id,
      variantBId: b.id,
    });
    expect(ex.result).toBeNull();
    expect(ex.startAt).toBeTruthy();

    const done = await concludePackagingExperiment(owner, {
      experimentId: ex.id,
      result: "SUPPORTED",
      conclusion: "B beat A by 1.8 CTR points over 7 days.",
    });
    expect(done.result).toBe("SUPPORTED");
    expect(done.endAt).toBeTruthy();

    const audited = await prisma.auditEvent.count({
      where: {
        entityId: content.id,
        action: { in: ["experiment.created", "experiment.concluded"] },
      },
    });
    expect(audited).toBe(2);
  });

  it("rejects two identical variants and variants from other content", async () => {
    const { content, a } = await contentWithTwoTitles();
    await expect(
      createPackagingExperiment(editor, {
        contentId: content.id,
        hypothesis: "same",
        variantAId: a.id,
        variantBId: a.id,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const other = await contentWithTwoTitles();
    await expect(
      createPackagingExperiment(editor, {
        contentId: content.id,
        hypothesis: "foreign variant",
        variantAId: a.id,
        variantBId: other.a.id,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("cannot conclude an experiment twice", async () => {
    const { content, a, b } = await contentWithTwoTitles();
    const ex = await createPackagingExperiment(editor, {
      contentId: content.id,
      hypothesis: "Testing double conclusion is rejected.",
      variantAId: a.id,
      variantBId: b.id,
    });
    await concludePackagingExperiment(owner, {
      experimentId: ex.id,
      result: "INCONCLUSIVE",
      conclusion: "Not enough data.",
    });
    await expect(
      concludePackagingExperiment(owner, {
        experimentId: ex.id,
        result: "SUPPORTED",
        conclusion: "retry",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("forbids roles without packaging capability", async () => {
    const { content, a, b } = await contentWithTwoTitles();
    await expect(
      createPackagingExperiment(researcher, {
        contentId: content.id,
        hypothesis: "nope",
        variantAId: a.id,
        variantBId: b.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
