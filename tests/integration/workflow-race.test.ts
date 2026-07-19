import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createContent } from "@/domain/content";
import { transition } from "@/domain/workflow";

let editor: Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;

beforeAll(async () => {
  const ws = await makeWorkspace();
  editor = await ws.actor([Role.EDITOR], "editor");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("transition concurrency", () => {
  it("two concurrent transitions from the same status: exactly one wins, one history row", async () => {
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Concurrent transition race",
    });

    // Stage a real interleaving: hold a row lock so both transitions read the
    // same `from` status, block on the write, then race once the lock releases.
    let racing!: Promise<PromiseSettledResult<unknown>[]>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${content.id} FOR UPDATE`;
      racing = Promise.allSettled([
        transition(editor, content.id, "TRIAGE"),
        transition(editor, content.id, "TRIAGE"),
      ]);
      // Both calls read status IDEA and queue on the locked row before commit.
      await new Promise((r) => setTimeout(r, 750));
    });
    const results = await racing;

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    const item = await prisma.contentItem.findUniqueOrThrow({ where: { id: content.id } });
    expect(item.status).toBe("TRIAGE");

    const history = await prisma.contentStatusHistory.findMany({
      where: { contentId: content.id, fromStatus: "IDEA", toStatus: "TRIAGE" },
    });
    expect(history).toHaveLength(1);
  });
});
