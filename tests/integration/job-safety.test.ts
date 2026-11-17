import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

// Short timings so liveness and staleness can be observed in seconds. Set
// before any module reads them (vi.hoisted runs ahead of the imports).
vi.hoisted(() => {
  process.env.JOB_HEARTBEAT_INTERVAL_MS = "100";
  process.env.JOB_HEARTBEAT_STALE_MS = "500";
  process.env.JOB_HEAVY_WAIT_MS = "2500";
});

import { Role, type MediaJobKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { claimHeavySlot, heavySlotHolder, startHeartbeat } from "@/lib/jobs/heavy";
import { runMediaJob } from "@/domain/mediaJobs";
import { recoverInterruptedJobs } from "@/domain/premiumRender";
import { run } from "@/lib/media/ffmpeg";
import type { Actor } from "@/lib/auth/context";

// Audit F02/F03/F10: periodic heartbeat fenced by attempt, one heavy job at a
// time on the machine, and a hard timeout on media tools.

let actor: Actor;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const made: string[] = [];

async function job(kind: MediaJobKind, extra: Record<string, unknown> = {}) {
  const row = await prisma.mediaJob.create({
    data: {
      workspaceId: actor.workspaceId,
      kind,
      idempotencyKey: `job-safety-${Date.now()}-${Math.random()}`,
      subjectId: "test-subject",
      label: `test ${kind}`,
      createdBy: actor.userId,
      ...extra,
    },
  });
  made.push(row.id);
  return row;
}
const reload = (id: string) => prisma.mediaJob.findUniqueOrThrow({ where: { id } });
const free = (id: string) =>
  prisma.mediaJob.update({ where: { id }, data: { status: "FAILED", finishedAt: new Date() } });

beforeAll(async () => {
  const ws = await makeWorkspace();
  actor = await ws.actor([Role.OWNER], "owner");
});

// Every job a test leaves RUNNING is closed, so none can hold the slot for the
// next test or for any later test file.
afterEach(async () => {
  await prisma.mediaJob.updateMany({
    where: { id: { in: made }, status: "RUNNING" },
    data: { status: "FAILED", finishedAt: new Date() },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("heavy slot: one heavy job at a time", () => {
  it("lets exactly one of two simultaneous claims win", async () => {
    const a = await job("PREMIUM_RENDER");
    const b = await job("RENDER");
    const claimable = { status: { in: ["QUEUED" as const] } };
    const [ra, rb] = await Promise.all([
      claimHeavySlot(a.id, claimable, { startedAt: new Date() }),
      claimHeavySlot(b.id, claimable, { startedAt: new Date() }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    expect(loser).toMatchObject({ ok: false, reason: "busy" });
  });

  it("does not let a job whose heartbeat stopped keep the machine", async () => {
    await job("PREMIUM_RENDER", {
      status: "RUNNING",
      heartbeatAt: new Date(Date.now() - 60_000),
    });
    const next = await job("NARRATION");
    const r = await claimHeavySlot(next.id, { status: "QUEUED" }, {});
    expect(r.ok).toBe(true);
  });

  it("refuses to claim a job that is not in a claimable state", async () => {
    const a = await job("RENDER", { status: "SUCCEEDED" });
    const r = await claimHeavySlot(a.id, { status: "QUEUED" }, {});
    expect(r).toMatchObject({ ok: false, reason: "not-claimable" });
  });
});

describe("heartbeat: periodic and fenced by attempt", () => {
  it("keeps a long stage alive without any progress reports", async () => {
    const a = await job("PREMIUM_RENDER");
    const r = await claimHeavySlot(a.id, { status: "QUEUED" }, { attempts: { increment: 1 } });
    if (!r.ok) throw new Error("claim failed");
    const stop = startHeartbeat(a.id, r.attempt);
    try {
      await sleep(1200); // well past the 500 ms staleness window
      expect((await heavySlotHolder())?.id).toBe(a.id);
      expect(await recoverInterruptedJobs(actor.workspaceId)).toBe(0);
      expect((await reload(a.id)).status).toBe("RUNNING");
    } finally {
      stop();
    }
  });

  it("stops refreshing once a newer attempt owns the job", async () => {
    const a = await job("PREMIUM_RENDER", { status: "RUNNING", attempts: 1 });
    const stop = startHeartbeat(a.id, 1);
    try {
      await prisma.mediaJob.update({
        where: { id: a.id },
        data: { attempts: 2, heartbeatAt: new Date(0) },
      });
      await sleep(400);
      expect((await reload(a.id)).heartbeatAt?.getTime()).toBe(0);
    } finally {
      stop();
    }
  });
});

describe("crash and retry", () => {
  it("recovery closes a stale premium job so it can be retried", async () => {
    const a = await job("PREMIUM_RENDER", {
      status: "RUNNING",
      attempts: 1,
      heartbeatAt: new Date(Date.now() - 60_000),
    });
    await recoverInterruptedJobs(actor.workspaceId);
    const after = await reload(a.id);
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/Interrupted/);
  });

  it("an in-request job takes over a row whose runner died, and succeeds", async () => {
    const key = `takeover-${Date.now()}`;
    const dead = await job("NARRATION", {
      idempotencyKey: key,
      status: "RUNNING",
      attempts: 1,
      heartbeatAt: new Date(Date.now() - 60_000),
    });
    const out = await runMediaJob(actor, {
      kind: "NARRATION",
      idempotencyKey: key,
      subjectId: "test-subject",
      label: "takeover test",
      findExisting: async () => null,
      work: async () => ({ id: "result-1" }),
    });
    expect(out.job.id).toBe(dead.id);
    expect(out.job.status).toBe("SUCCEEDED");
    expect(out.job.attempts).toBe(2);
  });

  it("a stale runner cannot finish a job another request has taken over", async () => {
    const key = `fence-${Date.now()}`;
    const p = runMediaJob(actor, {
      kind: "RENDER",
      idempotencyKey: key,
      subjectId: "test-subject",
      label: "fenced render",
      findExisting: async () => null,
      work: async () => {
        // While this runner works, another request takes the row over.
        await prisma.mediaJob.updateMany({
          where: { idempotencyKey: key },
          data: { attempts: { increment: 5 } },
        });
        return { id: "late-result" };
      },
    });
    await expect(p).rejects.toThrow(/taken over/);
    const row = await prisma.mediaJob.findFirstOrThrow({ where: { idempotencyKey: key } });
    made.push(row.id);
    expect(row.resultId).toBeNull();
  });
});

describe("two heavy jobs started at once", () => {
  it("an in-request job waits for the running one, then proceeds", async () => {
    const holder = await job("PREMIUM_RENDER", {
      status: "RUNNING",
      heartbeatAt: new Date(),
    });
    const stop = startHeartbeat(holder.id, 0);
    setTimeout(() => {
      stop();
      void free(holder.id);
    }, 700);
    const started = Date.now();
    const out = await runMediaJob(actor, {
      kind: "NARRATION",
      idempotencyKey: `wait-${Date.now()}`,
      subjectId: "test-subject",
      label: "waiting narration",
      findExisting: async () => null,
      work: async () => ({ id: "narration-1" }),
    });
    made.push(out.job.id);
    expect(out.job.status).toBe("SUCCEEDED");
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  });

  it("an in-request job gives up with a clear message if the machine stays busy", async () => {
    const holder = await job("PREMIUM_RENDER", { status: "RUNNING", heartbeatAt: new Date() });
    const stop = startHeartbeat(holder.id, 0);
    try {
      await expect(
        runMediaJob(actor, {
          kind: "NARRATION",
          idempotencyKey: `giveup-${Date.now()}`,
          subjectId: "test-subject",
          label: "blocked narration",
          findExisting: async () => null,
          work: async () => ({ id: "never" }),
        }),
      ).rejects.toThrow(/waiting for another media job \("test PREMIUM_RENDER"\)/);
    } finally {
      stop();
    }
    const rows = await prisma.mediaJob.findMany({ where: { label: "blocked narration" } });
    made.push(...rows.map((r) => r.id));
  }, 10_000);
});

describe("media tool timeout", () => {
  it("kills a wedged tool and says so", async () => {
    const started = Date.now();
    await expect(run("sleep", ["5"], { timeoutMs: 300 })).rejects.toThrow(/timed out after 0s/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
