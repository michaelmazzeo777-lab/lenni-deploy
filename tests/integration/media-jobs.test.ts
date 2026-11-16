import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { precondition } from "@/lib/errors";
import { makeWorkspace } from "../helpers/factory";
import {
  MAX_AUTO_ATTEMPTS,
  MediaProcessError,
  QaRefusal,
  STALE_RUNNING_MS,
  runMediaJob,
} from "@/domain/mediaJobs";

// The job wrapper on its own, with stand-in work functions: duplicate
// prevention, bounded automatic retry, failure recording, recovery.

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A;
let other: A;
let n = 0;
const spec = (
  key: string,
  work: (attempt: number) => Promise<{ id: string }>,
  existing = true,
) => ({
  kind: "RENDER" as const,
  idempotencyKey: key,
  subjectId: "subject-1",
  label: "Render 9:16",
  findExisting: async (id: string) => (existing ? { id } : null),
  work,
});
const job = (key: string) =>
  prisma.mediaJob.findFirstOrThrow({
    where: { workspaceId: owner.workspaceId, idempotencyKey: key },
  });
const key = () => `key-${Date.now()}-${n++}`;

beforeAll(async () => {
  owner = await (await makeWorkspace()).actor([Role.OWNER], "owner");
  other = await (await makeWorkspace()).actor([Role.OWNER], "other");
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("media jobs", () => {
  it("runs once, then returns the stored result for the same request", async () => {
    const k = key();
    let calls = 0;
    const work = async () => ({ id: `result-${++calls}` });
    const first = await runMediaJob(owner, spec(k, work));
    expect([first.reused, first.result.id, first.job.status, first.job.attempts]).toEqual([
      false,
      "result-1",
      "SUCCEEDED",
      1,
    ]);
    const second = await runMediaJob(owner, spec(k, work));
    expect([second.reused, second.result.id, calls]).toEqual([true, "result-1", 1]);
    expect((await job(k)).attempts).toBe(1);
    // The same key in another workspace is a different job.
    const elsewhere = await runMediaJob(other, spec(k, work));
    expect(elsewhere.reused).toBe(false);
  });

  it("runs again when the stored result was rejected or is gone", async () => {
    const k = key();
    let calls = 0;
    const work = async () => ({ id: `r-${++calls}` });
    await runMediaJob(owner, spec(k, work));
    const again = await runMediaJob(owner, spec(k, work, false));
    expect([again.reused, again.result.id, (await job(k)).attempts]).toEqual([false, "r-2", 2]);
  });

  it("lets only one of two simultaneous identical requests run", async () => {
    const k = key();
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 300));
      return { id: "only" };
    };
    const settled = await Promise.allSettled([
      runMediaJob(owner, spec(k, slow)),
      runMediaJob(owner, spec(k, slow)),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const refused = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(String(refused.reason.message)).toMatch(/Render 9:16 is already running/);
    expect(calls).toBe(1);
    expect(await prisma.mediaJob.count({ where: { idempotencyKey: k } })).toBe(1);
  });

  it("retries a failed media process once, then records the failure", async () => {
    const k = key();
    let calls = 0;
    await expect(
      runMediaJob(
        owner,
        spec(k, async () => {
          calls++;
          throw new MediaProcessError("Render failed: ffmpeg exited 1");
        }),
      ),
    ).rejects.toThrow(/Render 9:16 failed after 2 attempts: Render failed: ffmpeg exited 1/);
    expect(calls).toBe(MAX_AUTO_ATTEMPTS);
    const failed = await job(k);
    expect([failed.status, failed.attempts, failed.resultId]).toEqual(["FAILED", 2, null]);
    expect(failed.lastError).toMatch(/ffmpeg exited 1/);
    expect(failed.finishedAt).not.toBeNull();
    expect(
      await prisma.auditEvent.count({ where: { action: "media.job_failed", entityId: failed.id } }),
    ).toBe(1);

    // Recovery: the next request for the same thing runs and succeeds.
    const ok = await runMediaJob(
      owner,
      spec(k, async () => ({ id: "recovered" })),
    );
    expect([ok.reused, ok.job.status, ok.job.attempts, ok.job.lastError]).toEqual([
      false,
      "SUCCEEDED",
      3,
      null,
    ]);
  });

  it("succeeds on the automatic second attempt after one transient failure", async () => {
    const k = key();
    const r = await runMediaJob(
      owner,
      spec(k, async (attempt) => {
        if (attempt === 1) throw new MediaProcessError("transient");
        return { id: "second-try" };
      }),
    );
    expect([r.result.id, r.job.status, r.job.attempts]).toEqual(["second-try", "SUCCEEDED", 2]);
  });

  it("does not retry a refusal, and keeps a QA report with the failed job", async () => {
    const k = key();
    let calls = 0;
    await expect(
      runMediaJob(
        owner,
        spec(k, async () => {
          calls++;
          throw precondition("2 linked claim(s) are stale");
        }),
      ),
    ).rejects.toThrow(/stale/);
    expect([calls, (await job(k)).attempts, (await job(k)).status]).toEqual([1, 1, "FAILED"]);

    const q = key();
    const report = {
      passed: false,
      checks: [{ name: "Loudness", status: "FAIL", detail: "-23 LUFS" }],
    };
    await expect(
      runMediaJob(
        owner,
        spec(q, async () => {
          throw new QaRefusal("Render failed QA: Loudness: -23 LUFS", report);
        }),
      ),
    ).rejects.toThrow(/failed QA/);
    expect((await job(q)).failureJson).toEqual(report);
  });

  it("refuses a second run while one is running, but takes over an abandoned one", async () => {
    const k = key();
    await runMediaJob(
      owner,
      spec(k, async () => ({ id: "x" }), false),
    );
    const row = await job(k);
    await prisma.mediaJob.update({
      where: { id: row.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await expect(
      runMediaJob(
        owner,
        spec(k, async () => ({ id: "y" }), false),
      ),
    ).rejects.toThrow(/already running/);
    await prisma.mediaJob.update({
      where: { id: row.id },
      data: { startedAt: new Date(Date.now() - STALE_RUNNING_MS - 1000) },
    });
    const taken = await runMediaJob(
      owner,
      spec(k, async () => ({ id: "after-crash" }), false),
    );
    expect([taken.result.id, taken.job.status]).toEqual(["after-crash", "SUCCEEDED"]);
  });
});
