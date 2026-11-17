// One heavy media job at a time on this machine, and a liveness signal that
// does not depend on the job reporting progress.
//
// A job holds the heavy slot while it is RUNNING and its heartbeat is fresh.
// The heartbeat is refreshed on a timer (not only at stage boundaries), so a
// long ffmpeg/whisper/engine step no longer looks dead. A job whose process
// died stops beating and loses the slot after HEAVY_STALE_MS. Each refresh is
// fenced by the job's attempt number, so a stale runner can never keep alive
// (or finish) a newer attempt of the same job.
import { prisma } from "@/lib/db";
import type { MediaJobKind, Prisma } from "@prisma/client";

/** Every job kind that runs ffmpeg, speech synthesis/recognition or the premium engine. */
export const HEAVY_KINDS: MediaJobKind[] = ["NARRATION", "RENDER", "PREMIUM_RENDER"];
export const HEARTBEAT_INTERVAL_MS = Number(process.env.JOB_HEARTBEAT_INTERVAL_MS ?? 10_000);
/** A RUNNING job whose heartbeat is older than this has lost its process. */
export const HEAVY_STALE_MS = Number(process.env.JOB_HEARTBEAT_STALE_MS ?? 45_000);

// Arbitrary constant key for the Postgres advisory lock that serializes slot claims.
const SLOT_LOCK_KEY = 726_150_001;

export const staleBefore = () => new Date(Date.now() - HEAVY_STALE_MS);

/** Another job (not `exceptId`) that currently holds the heavy slot, if any. */
export async function heavySlotHolder(exceptId?: string, tx: Prisma.TransactionClient = prisma) {
  return tx.mediaJob.findFirst({
    where: {
      kind: { in: HEAVY_KINDS },
      status: "RUNNING",
      heartbeatAt: { gte: staleBefore() },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, label: true, kind: true },
  });
}

export type ClaimResult =
  | { ok: true; attempt: number }
  | { ok: false; reason: "busy"; holder: string }
  | { ok: false; reason: "not-claimable" };

/**
 * Atomically moves job `jobId` to RUNNING (if `claimable` matches it) and gives
 * it the heavy slot - or does neither. Claims are serialized machine-wide with
 * a transaction-scoped advisory lock, so two requests can never both win.
 */
export async function claimHeavySlot(
  jobId: string,
  claimable: Prisma.MediaJobWhereInput,
  data: Prisma.MediaJobUpdateManyMutationInput,
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SLOT_LOCK_KEY})`;
    const holder = await heavySlotHolder(jobId, tx);
    if (holder) return { ok: false, reason: "busy", holder: holder.label };
    const claimed = await tx.mediaJob.updateMany({
      where: { AND: [{ id: jobId }, claimable] },
      data: { ...data, status: "RUNNING", heartbeatAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, reason: "not-claimable" };
    const row = await tx.mediaJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { attempts: true },
    });
    return { ok: true, attempt: row.attempts };
  });
}

/**
 * Refreshes the job's heartbeat every HEARTBEAT_INTERVAL_MS while this attempt
 * is still the running one. Returns a function that stops the timer.
 */
export function startHeartbeat(jobId: string, attempt: number): () => void {
  const beat = () =>
    void prisma.mediaJob
      .updateMany({
        where: { id: jobId, status: "RUNNING", attempts: attempt },
        data: { heartbeatAt: new Date() },
      })
      .catch(() => undefined);
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Waits (polling) until the slot can be claimed, up to `maxWaitMs`. */
export async function claimHeavySlotWaiting(
  jobId: string,
  claimable: Prisma.MediaJobWhereInput,
  data: Prisma.MediaJobUpdateManyMutationInput,
  opts: { maxWaitMs: number; pollMs?: number },
): Promise<ClaimResult> {
  const deadline = Date.now() + opts.maxWaitMs;
  for (;;) {
    const r = await claimHeavySlot(jobId, claimable, data);
    if (r.ok || r.reason === "not-claimable" || Date.now() >= deadline) return r;
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 2000));
  }
}
