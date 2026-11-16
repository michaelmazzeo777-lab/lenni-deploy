import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { DomainError, isDomainError, precondition } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import type { MediaJob, MediaJobKind } from "@prisma/client";

// Narration and render requests run inside the request that asked for them
// (there is no worker). This wrapper gives them the properties a job needs:
//
//   one row per distinct request   same real inputs = same idempotency key
//   duplicate prevention           a finished request returns its result; a
//                                  second request while one runs is refused
//   bounded automatic retry        a failed media process is tried again, up
//                                  to MAX_AUTO_ATTEMPTS per request
//   failure recording              the reason (and any QA report) is stored
//   recovery                       a failed or abandoned job can be retried
//
// A deterministic refusal (a gate, a QA failure) is recorded and not retried
// automatically: the same input would fail the same way.

export const MAX_AUTO_ATTEMPTS = 2;
/** A RUNNING job older than this was abandoned (crash, restart) and may be taken over. */
export const STALE_RUNNING_MS = 15 * 60 * 1000;

/** A media tool failed (ffmpeg, say, zip). Worth one automatic retry. */
export class MediaProcessError extends Error {}

/** QA refused the output. Carries the report so it can be stored with the job. */
export class QaRefusal extends DomainError {
  constructor(
    message: string,
    readonly report: unknown,
  ) {
    super("PRECONDITION_FAILED", message, report);
  }
}

export interface JobOutcome<T> {
  result: T;
  /** True when an earlier identical request's result was returned. */
  reused: boolean;
  job: MediaJob;
}

export async function runMediaJob<T extends { id: string }>(
  actor: Actor,
  spec: {
    kind: MediaJobKind;
    idempotencyKey: string;
    subjectId: string;
    label: string;
    /** The stored result if it still exists and has not been rejected. */
    findExisting: (resultId: string) => Promise<T | null>;
    work: (attempt: number) => Promise<T>;
  },
): Promise<JobOutcome<T>> {
  const where = {
    workspaceId_kind_idempotencyKey: {
      workspaceId: actor.workspaceId,
      kind: spec.kind,
      idempotencyKey: spec.idempotencyKey,
    },
  };
  let job =
    (await prisma.mediaJob.findUnique({ where })) ??
    (await prisma.mediaJob
      .create({
        data: {
          workspaceId: actor.workspaceId,
          kind: spec.kind,
          idempotencyKey: spec.idempotencyKey,
          subjectId: spec.subjectId,
          label: spec.label,
          createdBy: actor.userId,
        },
      })
      .catch(async (e: unknown) => {
        // A concurrent identical request created the row first.
        if ((e as { code?: string }).code === "P2002") {
          return prisma.mediaJob.findUniqueOrThrow({ where });
        }
        throw e;
      }));

  if (job.status === "SUCCEEDED" && job.resultId) {
    const existing = await spec.findExisting(job.resultId);
    if (existing) return { result: existing, reused: true, job };
  }

  // Atomic claim: only one request can move the row to RUNNING.
  const now = new Date();
  const claimed = await prisma.mediaJob.updateMany({
    where: {
      id: job.id,
      OR: [
        { status: { in: ["QUEUED", "FAILED", "SUCCEEDED"] } },
        { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
      ],
    },
    data: { status: "RUNNING", startedAt: now, finishedAt: null },
  });
  if (claimed.count === 0) {
    throw precondition(`${spec.label} is already running; wait for it to finish`);
  }

  const fail = async (message: string, failure: unknown) => {
    job = await prisma.mediaJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        lastError: message.slice(0, 2000),
        failureJson: (failure ?? undefined) as object | undefined,
        finishedAt: new Date(),
      },
    });
    await writeAudit({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: "media.job_failed",
      entityType: "MediaJob",
      entityId: job.id,
      metadata: { kind: spec.kind, label: spec.label, attempts: job.attempts, error: message },
    });
  };

  let lastMessage = "unknown error";
  for (let attempt = 1; attempt <= MAX_AUTO_ATTEMPTS; attempt++) {
    await prisma.mediaJob.update({ where: { id: job.id }, data: { attempts: { increment: 1 } } });
    try {
      const result = await spec.work(attempt);
      job = await prisma.mediaJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          resultId: result.id,
          lastError: null,
          failureJson: undefined,
          finishedAt: new Date(),
        },
      });
      return { result, reused: false, job };
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : "unknown error";
      if (isDomainError(e)) {
        await fail(lastMessage, e instanceof QaRefusal ? e.report : (e.details ?? null));
        throw e;
      }
      if (!(e instanceof MediaProcessError) || attempt === MAX_AUTO_ATTEMPTS) break;
    }
  }
  job = await prisma.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
  const message = `${spec.label} failed after ${MAX_AUTO_ATTEMPTS} attempts: ${lastMessage}`;
  await fail(message, null);
  throw precondition(message);
}
