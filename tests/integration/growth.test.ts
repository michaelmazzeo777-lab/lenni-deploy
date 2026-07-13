import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createSource, createClaim, reviewClaim, linkClaimToContent } from "@/domain/evidence";
import { createContent } from "@/domain/content";
import { assignRole, removeRole } from "@/domain/admin";
import { markSourceStale, resolveUpdateTask } from "@/domain/updates";
import { importAnalyticsSnapshot } from "@/domain/analytics";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, researcher: A;
let plainUserId: string;

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  researcher = await ws.actor([Role.RESEARCHER], "researcher");
  const plain = await ws.actor([Role.READ_ONLY], "plain");
  plainUserId = plain.userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("role management", () => {
  it("assigns and removes roles (Owner only) and audits", async () => {
    await assignRole(owner, plainUserId, Role.ANALYST);
    let roles = await prisma.roleAssignment.findMany({ where: { userId: plainUserId } });
    expect(roles.some((r) => r.role === "ANALYST")).toBe(true);

    await removeRole(owner, plainUserId, Role.ANALYST);
    roles = await prisma.roleAssignment.findMany({ where: { userId: plainUserId } });
    expect(roles.some((r) => r.role === "ANALYST")).toBe(false);

    const audited = await prisma.auditEvent.count({
      where: { workspaceId: owner.workspaceId, action: { in: ["role.assigned", "role.removed"] } },
    });
    expect(audited).toBeGreaterThanOrEqual(2);
  });

  it("forbids non-owners from managing roles", async () => {
    await expect(assignRole(editor, plainUserId, Role.WRITER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses to remove the last Owner", async () => {
    await expect(removeRole(owner, owner.userId, Role.OWNER)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

describe("stale sources create update tasks", () => {
  it("opens an update task for content relying on the stale source", async () => {
    const src = await createSource(researcher, {
      title: "Official page",
      publisher: "Rockstar Games (official)",
      sourceClass: "OFFICIAL_SOURCE",
      sourceType: "press release",
      supportNotes: "Set in Leonida.",
    });
    const claim = await createClaim(researcher, {
      statement: "GTA VI is set in Leonida.",
      classification: "CONFIRMED",
      sourceIds: [src.id],
    });
    await reviewClaim(editor, claim.id);
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Stale-source content",
    });
    await linkClaimToContent(editor, content.id, claim.id);

    const res = await markSourceStale(editor, src.id, "Superseded");
    expect(res.updateTasksCreated).toBe(1);

    const source = await prisma.source.findUnique({ where: { id: src.id } });
    expect(source?.status).toBe("STALE");

    const task = await prisma.updateTask.findFirst({
      where: { contentId: content.id, status: "OPEN" },
    });
    expect(task).toBeTruthy();

    // Re-marking does not duplicate the open task.
    const again = await markSourceStale(editor, src.id, "again");
    expect(again.updateTasksCreated).toBe(0);

    await resolveUpdateTask(editor, task!.id);
    const done = await prisma.updateTask.findUnique({ where: { id: task!.id } });
    expect(done?.status).toBe("DONE");
  });
});

describe("analytics import", () => {
  it("stores a snapshot and audits it", async () => {
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Analytics content",
    });
    const snap = await importAnalyticsSnapshot(owner, {
      contentId: content.id,
      platform: "youtube",
      views: 1000,
      ctr: 0.09,
      firstThirtySecondRetention: 0.72,
    });
    expect(snap.id).toBeTruthy();
    const stored = await prisma.analyticsSnapshot.findMany({ where: { contentId: content.id } });
    expect(stored.length).toBe(1);
    const audited = await prisma.auditEvent.count({
      where: { entityId: content.id, action: "analytics.imported" },
    });
    expect(audited).toBe(1);
  });

  it("forbids roles without analytics.import", async () => {
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Analytics forbidden",
    });
    await expect(
      importAnalyticsSnapshot(researcher, { contentId: content.id, views: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
